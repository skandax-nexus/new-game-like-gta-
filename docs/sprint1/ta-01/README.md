# TA-01 - WP1 PBR materials & terrain library (evidence)

Owner: Technical Artist A - Materials & Terrain Library. Ticket TA-01 (docs/STUDIO.md), asset list WP1 (docs/ASSET_LIST.md).
Reproduce: `npx vite build --outDir .build/ta-01/dist --emptyOutDir` then
`NODE_PATH=$(npm root -g) node scripts/shots/ta-01.cjs` (port 4404; `--only=<groups>` / `--ids=<ids>` for partial runs).

## What shipped

37 texture sets (WP1-01..29 and WP1-31..38: 20 materials incl. ground_dry_earth, 17 terrain layers) + 1 decal atlas
(WP1-30) = 38 published ids. Round 1 rework (below): every id rebuilt and republished with
`flock .asset-cache/.publish.lock npm run assets -- <id>`:

| group | ids | class |
|---|---|---|
| P0 architecture | sandstone_buff, lime_plaster_weathered | H |
| | brick_fired_old, roof_tile_terracotta, thatch_grass, mud_plaster, bamboo_lattice, timber_teak_carved (trim sheet) | S |
| WP1-09 retune | sandstone_carved_red (now class S: 1024 from a 2048 master) | S |
| P1 architecture | sandstone_polished_mauryan, timber_sal_weathered, granite_rubble, basalt_dressed, laterite_block, mud_brick_sundried | C |
| P0 terrain | terrain_grass_lush, terrain_grass_dry, terrain_alluvial_silt, terrain_farmland_tilled, terrain_road_earth, terrain_river_sand, terrain_rock_sandstone (triplanar), terrain_flagstone, terrain_mud_wet; ground_dry_earth rebuilt as class T | T |
| P1 terrain | terrain_laterite_soil, terrain_black_soil, terrain_pebbles, terrain_rock_granite (triplanar), terrain_rock_basalt (triplanar), terrain_forest_litter, terrain_paddy_mud | T |
| P2 (`@tiers ultra,high` + `@fallback`) | timber_weathered_grey -> timber_sal_weathered, stone_slab_roof -> granite_rubble, thatch_palm -> thatch_grass, sandstone_red_ashlar -> sandstone_carved_red, terrain_salt_crust -> terrain_river_sand | C / T |
| decals | decals_settlement (17 regions, opacity in ORM.b) | A |

Scripts: `tools/blender/assets/materials/`, `terrain/`, `decals/` with the shared package-local kit
`materials/_matkit.py` (calibration, QA, class sizes, Cycles previews), `materials/_sandstone.py` (the one trim-band
layout of both carved sandstones), `terrain/_terrainkit.py`, `decals/_decalkit.py`.

## Evidence index

| file | what |
|---|---|
| [deltas.md](deltas.md) | mean baseColor of every PUBLISHED WebP (all tiers) vs the Art Director target - all 37 targeted sets within +-6 % (worst tier: terrain_mud_wet 1.49 %) |
| [stats.md](stats.md) | round 1 checks: cache QA mean == shipped mean (B2), HSV saturation / value p98 and lime share (AD-4), ORM.r span of every terrain layer (B6) |
| [budgets.md](budgets.md) | WP1 bytes per set and tier from the manifest: **25.05 / 12.95 / 3.14 MB** of 36 / 16 / 5.3 |
| [tiling_sheet.jpg](tiling_sheet.jpg), `tiling/<id>.jpg` | 3 x 3 repeats, orthographic, raking golden sun (11 deg), Cycles, shipped maps - every set |
| `viewer/<id>.jpg` | asset viewer lookdev (wall corner, column, sphere) at ~1.2 m (`camera=detail`, cropped to the ~85 % of the frame that is material) and ~9 m (`camera=overview`) under sky_day and sky_golden, ultra textures - every architecture set |
| [mobile_sheet.jpg](mobile_sheet.jpg), `mobile/<id>_<cam>.jpg` | every P0 set on the MOBILE tier (`assets=mobile`, `quality=low`, sky_day): architecture at ~1.2 m and ~9 m, terrain layers as a splat patch (AD-9) |
| [splat_sheet_golden.jpg](splat_sheet_golden.jpg), [splat_sheet_day.jpg](splat_sheet_day.jpg), `splat/<biome>_<sky>.jpg` | 4-layer height-blended splat lookdev (`?splat=a,b,c,d`) of every BIOME_TERRAIN recipe, 18 % grey card |
| [varsha_sheet.jpg](varsha_sheet.jpg) | monsoon lookdev (AD-9): marsh and farmland splats dry vs splat wetness 0.85 under sky_overcast |
| [stupa_reskin.jpg](stupa_reskin.jpg) | stupa_sanchi as published (samrajya_set sandstone_carved_red) and re-skinned to sandstone_buff by rewriting only `samrajya_set` in the GLB (6 references) - same trim bands; golden hero, golden close and sky_day hero (AD-9) |
| [swatches.png](swatches.png), [palette.png](palette.png) | 256 px swatch of every set with target / measured chips; palette board per tier |
| [decals_atlas.png](decals_atlas.png) | the shipped decal atlas composited by its ORM.b opacity over wall / ground backdrops, regions labelled |
| [report.json](report.json) | all numbers (per-tier means and deltas, budgets, splat recipes, shot timings and errors) |
| `../../screenshots/pipeline/wp1/` | Cycles previews of every set: lookdev (`_cycles`), close-up (`_cycles_closeup`, now also bamboo_lattice and the three rock layers - AD-9), 3 x 3 tiling (`_cycles_tiling`) |

## Method (shared kit)

- Calibration: linear mean per channel hits the preset baseColor while every texel stays inside ALBEDO_LIMITS;
  roughness is remapped monotonically so its 5th..95th percentiles span the preset range and its mean is the preset.
  QA statistics per set in `tools/assets/published.json` (`meta.qa`).
- Detail scales: macro (0.5-2 m: weathering zones, lichen, damp), meso (block / brick / stone / tuft), micro
  (grain, pores, straw, speckle). Everything is periodic over the tile (integer cells and integer wave vectors),
  checked with a seam metric and the 3 x 3 shots.
- Terrain layers are macro-neutral (luminance above ~0.6 m divided out - the splat macro map supplies it), the
  height is high-passed and ORM.r = AO x normalized height so the splat height blend lets stones poke through and soil
  fill cracks. Rock layers are authored for triplanar (v = world up).
- Class sizes (ASSET_LIST 0.2) via file `tierScale`: H 2048 all maps; S albedo 1024 / normal + ORM 1024 x 0.5;
  C and T albedo 1024 x 0.5 / data 512 x 0.5; A 1024 x 0.5.
- Normals 16-bit OpenGL from the height at the 2048 master, box-filtered (Toksvig roughness for the lost variance);
  ORM roughness softened 0.8 px and H heights 0.5 px before encoding (payload: -33 % ORM bytes, no visible loss).

## Critique loop notes (W14)

Each set went through Cycles preview -> fix -> publish -> viewer -> fix. Notable fixes: buff patchwork tints
(chroma compression); lime plaster "measles" -> clustered two-depth losses; brick looked modern -> eroded arrises,
irregular pores, patina; roof lichen polka dots -> rosettes; thatch flat planks -> thick shaggy butt ends, buried
ropes; carved red patchwork hue -> per-block jitter +-3 %; granite rubble pale chinking specks -> wedge stones;
granite tor cobbled -> 3 m whalebacks with partly open joints; sandstone cliff regular joints read as masonry ->
irregular joints per bed; silt cross-hatch -> one current direction per zone; mud ruts as continuous stripes ->
grooves that come and go; dry grass patchy -> denser tufts; laterite polka dots -> vermicular tubes and clay fills;
mud brick glyph-like spalls -> soft dishes; non-integer sinusoid phases (seams) removed everywhere; positional foot
bands removed from tiling sets (rising damp is the model macro map's + the `damp_rising` decal).

## Art Director co-sign (round 1 rulings, docs/art/reviews/ta-01.md)

Signed by the Art Director in round 1: (1) no foot bands in tiling wall sets, (4) the mandana / kolam vocabulary.
(2) was ruled by the AD-8 desk change (applied here, see below); (3) the water masks stay an interim step until
publish keeps baseColor alpha (CTO request still open). The original round 0 list, for reference:
1. Rising damp / soot foot bands are NOT baked into tiling wall sets (they would repeat every tile up a wall); they come
   from the model macro maps (uv1) and the `decals_settlement` `damp_rising` strip.
2. Preset saturation above the large-surface limit 0.45 on brick_fired_old, roof_tile_terracotta, laterite_block,
   sandstone_carved_red, terrain_laterite_soil and terrain_grass_lush (the presets themselves exceed it; the sets
   follow the presets).
3. terrain_mud_wet / terrain_paddy_mud water masks ship as cache files until publish keeps baseColor alpha.
4. Mandana / kolam motif vocabulary in `decals_settlement` (period check).

## Review round 1 rework (Technical Art Director B1-B7, Art Director AD-1..AD-9)

Every WP1 id was rebuilt and republished under the publish lock (the shared-kit hash changed, so all of them were
dirty). Numbers below are measured on the shipped files by `scripts/shots/ta-01.cjs` (deltas.md, stats.md).

| item | fix | evidence |
|---|---|---|
| B1 lime_plaster_weathered | no large clusters: ~8 % losses as flakes bounded by warped crack nets at three scales (16 / 9 / 4 cm cells, the largest scale only 1.8 % of cells), even spread; the deepest (scratch coat) losses no darker than the render; overlapping trowel-stroke arcs with squeezed-out lime ridges and drag lines; -10 % rain streaks with paler washed runs | `tiling/lime_plaster_weathered.jpg`, `../../screenshots/pipeline/wp1/lime_plaster_weathered_cycles_closeup.jpg`, `viewer/lime_plaster_weathered.jpg` |
| B2 float32 means | every mean / sum in `_matkit` (calibration, QA, chroma compression, averageColor meta, coverage solves) is float64; all ids republished | stats.md: cache QA mean == shipped ultra WebP mean for all 38 ids (max difference 0 levels); lime plaster ships at #e4dac6 (hue 40 deg) |
| B3 terrain_rock_granite | hierarchical joint-bounded blocks (2.4 / 1.1 / 0.55 m, split per parent block: sizes vary ~5x, no lattice), joint openness varying along each joint (open clefts with grus, closed hairlines), whaleback crowns of different height per block, exfoliation as a few broad, broken sheet steps following the dome (never rings), spalls, speckled grain, black streaks, crustose lichen | `tiling/terrain_rock_granite.jpg`, `..._cycles_closeup.jpg`, splat grassland / scrub / forest / hills / rocky |
| B4 terrain_rock_basalt | flat-faced angular prisms (planar facets, sharp creases, widths 0.45-1.6 m, joints that branch and stop, a few fallen segments), cross-joints only on ~40 % of the column segments (no course lines), two flows of clearly unequal thickness (64 / 36 %), colonnade vs hackly entablature whose boundary wanders strongly along u, recessed rubbly flow tops with soil / talus ledges in basalt grey (no orange band) | `tiling/terrain_rock_basalt.jpg`, `..._cycles_closeup.jpg`, splat dense_forest / plateau |
| B5 terrain_rock_sandstone | sets 0.4-2.8 m with undulating, pinching boundaries; cross-bedded foresets (18-32 deg, 7-16 cm laminae, alternating dip) as etched ribs and lamina tones; recessed soft beds under overhanging lips; widely spaced joints that show along only part of their length and rarely in thin beds; sparse small tafoni clusters | `tiling/terrain_rock_sandstone.jpg`, `..._cycles_closeup.jpg` (cross-bedding), splat river / floodplain / farmland / dry_plain / sandbank / marsh |
| B6 height-blend proxy | `finish_terrain` raises the AO x height mix until ORM.r spans >= 0.32 between p5 and p95 | stats.md: every planar layer 0.31-0.69 (alluvial 0.345, laterite 0.329, grass_lush 0.329, ground_dry_earth 0.306); splat sheets |
| B7 terrain_paddy_mud | puddle pattern below 0.3 m (0.13 m pockets dominate), low-contrast silty water, faint algae film | `tiling/terrain_paddy_mud.jpg` |
| AD-1 thatch_grass | 0.25 m courses with 3-4 cm butt relief and shaggy cut ends casting a stepped shadow line, bundles bulging, raised 3-ply rope bands (3 per 2 m), weather mask toward #857a62 | `viewer/thatch_grass.jpg`, `..._cycles_closeup.jpg` |
| AD-2 terrain_flagstone | dressed buff slabs 0.5-1.4 m in irregular wandering courses, joints 5-30 mm varying along each joint with soil / grass / moss, worn arrises, sunken and cracked slabs, subtle per-slab tone | `tiling/terrain_flagstone.jpg` |
| AD-3 terrain_mud_wet | no continuous ruts: short curving churn in random directions; anatomical bare feet (heel, arch band, ball, toes) and cloven hooves | `tiling/terrain_mud_wet.jpg`, varsha_sheet.jpg |
| AD-4 terrain_grass_lush | olive-emerald blades, soil gaps lighter, clover olive; every texel S <= 0.5, V <= 0.55 in the master | stats.md and the known issue below (the lossy WebP encode adds saturation spikes) |
| AD-5 polka dots | `Kit.lichen` (crustose patches with fractal margins on upward faces + clustered lobed rosettes), `Kit.specks` (clustered power-law grains, coverage solved to <= 1 %); granite_rubble joints near the stone value so stones sit at V p50 140 / p90 149 vs #8a8680 = 138 (+-10 %) | `viewer/granite_rubble.jpg`, `viewer/stone_slab_roof.jpg`, `tiling/terrain_black_soil.jpg`, `viewer/sandstone_red_ashlar.jpg` |
| AD-6 litter / dry grass | ovate sal / teak leaves 20-30 cm with acute tips, cupped lifted edges, twigs and humus (no voids); dry grass as clumped tufts and lodged stems | `tiling/terrain_forest_litter.jpg`, `tiling/terrain_grass_dry.jpg` |
| AD-7 P2 ashlar / palm | red ashlar: 4 mm recessed dark joints, point-tooled faces, soft rust bleeds; palm thatch: two leaflet layers of random widths / lengths / splay, small irregular gaps showing the older mat below (no comb) | `viewer/sandstone_red_ashlar.jpg`, `viewer/thatch_palm.jpg` |
| AD-8 desk rulings | roof_tile_terracotta #a6644a, terrain_laterite_soil #8e5a44, laterite_block #8f5240 (`_matkit.AD_RULINGS`, applied while the preset still holds the old value; ta-01.cjs measures against the same table) | deltas.md |
| AD-9 evidence | Cycles close-ups for bamboo and the rocks; mobile-tier sheet; varsha splats; sky_day buff stupa; 1.2 m frames cropped to ~85 % material | this index |
| non-blocking | basalt_dressed point-chisel dressing and polished arrises, river_sand bifurcating ripples of varied wavelength, ground_dry_earth smaller soil-tinted pebbles, mud_plaster finger arcs of varied radius / count / pressure, roof tile lip shadows | Cycles previews |

### Open after round 1 (known issues and requests)

- **AD-4 in the shipped WebP.** The grass_lush master meets the target (stats from the cache PNG: lime 0 %, HSV
  saturation p98 0.504, value p98 0.55). The shipped lossy WebP does not: its YUV 4:2:0 chroma re-attaches blade chroma
  to brighter luma, giving lime 5.3 % and p98 0.59 on ultra (1.8 % / 0.56 on high). I measured the encoder options on
  the same master:

  | encoder | lime | sat p98 | size |
  |---|---|---|---|
  | lossy q88 (current) | 5.3 % | 0.59 | 316 KB |
  | lossy q95 | 5.5 % | 0.59 | 478 KB |
  | chroma pre-blur 1.5 px, then q88 | 3.4 % | 0.58 | - |
  | near-lossless 60 | **0 %** | **0.515** | 541 KB |

  Only an RGB encode fixes it, which needs a publish option (CTO request below). With it, ultra grows by about 0.23 MB
  and stays within the WP1 budget.
- **B6 border width.** Every planar layer now spans ORM.r >= 0.31, and the splat borders interlock texel by texel:
  grains, cracks and stones poke through, so they no longer read as airbrushed. The overall transition is still
  1-2 m wide. That width comes from the lookdev's linear weight bands and the splat `heightBlend` default (0.2) in
  `src/render/materials/splat.ts`, not from the layers. Request to GFX-02 / Technical Art Director: use
  heightBlend ~0.08 for terrain, plus noise-perturbed weights.
- **Rock repeats.** The 8 / 10 m rock tiles still show their tile period in the 24-30 m 3 x 3 shot as horizontal strata
  (basalt, sandstone) or block scale (granite). No single salient feature repeats (no lattice, logs, planks, stamps or
  outlines). Trap and sandstone strata are horizontal by nature. Fully hiding the period needs the splat's world-space
  macro / stochastic tiling (GFX-02).
- **Water masks and decal regions** in the manifest, and the T-class 512 mobile albedo: these CTO requests from
  round 0 are still open, so I changed nothing for them.
- **Publishing note.** Early in the rework, a local quick-look helper mis-invoked the runner. It built and published
  terrain_flagstone, terrain_mud_wet, granite_rubble, stone_slab_roof and two rock drafts through the runner's
  internal lock instead of the outer `flock`. All of them were superseded by `flock` publishes or republished with
  `flock ... npm run assets -- --republish`. assets:check passes, and no WP1 id is DIRTY.
