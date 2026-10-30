# TA-01 - WP1 PBR materials & terrain library (evidence)

Owner: Technical Artist A - Materials & Terrain Library. Ticket TA-01 (docs/STUDIO.md), asset list WP1 (docs/ASSET_LIST.md).
Reproduce: `npx vite build --outDir .build/ta-01/dist --emptyOutDir` then
`NODE_PATH=$(npm root -g) node scripts/shots/ta-01.cjs` (port 4404; `--only=<groups>` / `--ids=<ids>` for partial runs).

## What shipped

37 texture sets (WP1-01..29 and WP1-31..38: 20 materials incl. ground_dry_earth, 17 terrain layers) + 1 decal atlas
(WP1-30) = 38 published ids, all published with `flock .asset-cache/.publish.lock npm run assets -- <id>`:

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
| [deltas.md](deltas.md) | mean baseColor of every PUBLISHED WebP (all tiers) vs the Art Director target - all within +-6 % (worst: terrain_grass_lush mobile 4.7 %) |
| [budgets.md](budgets.md) | WP1 bytes per set and tier from the manifest: **24.57 / 12.69 / 3.09 MB** of 36 / 16 / 5.3 |
| [tiling_sheet.jpg](tiling_sheet.jpg), `tiling/<id>.jpg` | 3 x 3 repeats, orthographic, raking golden sun (11 deg), Cycles, shipped maps - every set |
| `viewer/<id>.jpg` | asset viewer lookdev (wall corner, column, sphere) at ~1.2 m (`camera=detail`) and ~9 m (`camera=overview`) under sky_day and sky_golden, ultra textures - every architecture set |
| [splat_sheet_golden.jpg](splat_sheet_golden.jpg), [splat_sheet_day.jpg](splat_sheet_day.jpg), `splat/<biome>_<sky>.jpg` | 4-layer height-blended splat lookdev (`?splat=a,b,c,d`) of every BIOME_TERRAIN recipe, 18 % grey card |
| [stupa_reskin.jpg](stupa_reskin.jpg) | stupa_sanchi as published (samrajya_set sandstone_carved_red) and re-skinned to sandstone_buff by rewriting only `samrajya_set` in the GLB (6 references) - same trim bands |
| [swatches.png](swatches.png), [palette.png](palette.png) | 256 px swatch of every set with target / measured chips; palette board per tier |
| [decals_atlas.png](decals_atlas.png) | the shipped decal atlas composited by its ORM.b opacity over wall / ground backdrops, regions labelled |
| [report.json](report.json) | all numbers (per-tier means and deltas, budgets, splat recipes, shot timings and errors) |
| `../../screenshots/pipeline/wp1/` | Cycles previews of every set: lookdev (`_cycles`), close-up (`_cycles_closeup`), 3 x 3 tiling (`_cycles_tiling`) |

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

## Art Director co-sign (requested)

Items for the Art Director to co-sign (not yet signed at the time of this report):
1. Rising damp / soot foot bands are NOT baked into tiling wall sets (they would repeat every tile up a wall); they come
   from the model macro maps (uv1) and the `decals_settlement` `damp_rising` strip.
2. Preset saturation above the large-surface limit 0.45 on brick_fired_old, roof_tile_terracotta, laterite_block,
   sandstone_carved_red, terrain_laterite_soil and terrain_grass_lush (the presets themselves exceed it; the sets
   follow the presets).
3. terrain_mud_wet / terrain_paddy_mud water masks ship as cache files until publish keeps baseColor alpha.
4. Mandana / kolam motif vocabulary in `decals_settlement` (period check).
