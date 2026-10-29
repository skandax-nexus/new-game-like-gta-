# SAMRAJYA - Asset Production List

Owner: Art Director. Status: v1. Audience: Technical Art team (Blender asset scripts in
`tools/blender/assets/**`), Lead Graphics (runtime integration), QA. Visual rules: `docs/ART_BIBLE.md`
(the "Bible"); canonical values: `src/render/style/*.ts`; pipeline: `docs/ARCHITECTURE.md` §18-20.

Seven work packages, each sized for one technical artist (plus the Art Director for review and WP7 art).

| WP | Package | Items | Ultra / High / Mobile budget (MB) |
|---|---|---|---|
| WP1 | Materials and terrain library | 37 texture sets + decal atlas | 36 / 16 / 5.3 |
| WP2 | Vernacular and civic architecture kit, construction and damage | 24 pieces + kits + 40 props | 5 / 3.5 / 2 |
| WP3 | Monuments, landmarks, fortifications and waterfront | 16 pieces/kits + 16 landmarks | 9 / 5.5 / 2.3 |
| WP4 | Vegetation, crops and natural props | 13 trees, 6 ground plants, 9 crops, rocks | 9 / 4.5 / 1.8 |
| WP5 | Crowd units, villagers, animals and vehicles (VAT) | 9 classes x 6 factions (masks), 6 villager types, 5 animals, 5 vehicles | 8 / 5 / 2 |
| WP6 | Hero and cinematic characters | hero, rival, envoy, 5 enemies, NPC kit for 22 characters | 6 / 3 / 0.8 |
| WP7 | Skies, LUTs, VFX textures, banners and UI art | 7 skies, 7 LUTs, 14 flipbooks, key art | 4 / 2 / 0.6 |
| | **Total (budget 80 / 40 / 15)** | | **77 / 39.5 / 14.8** (reserve 3 / 0.5 / 0.2) |

Current library (measured): 10.3 / 4.1 / 2.0 MB (`sandstone_carved_red`, `ground_dry_earth` in WP1;
`stupa_sanchi` in WP3; `sky_day`, `sky_golden` in WP7) - already counted in the WP budgets above.

---

## 0. Conventions and global acceptance

### 0.1 Priorities

- **P0 - vertical slice**: Rajapura (capital) in hero mode, the River of Kings region, a Suvarna vs
  Giridurga battle at the Setu crossing, one landmark per playable faction, construction stages,
  villagers working, the opening cinematic and the duel.
- **P1 - MVP content complete**: everything DESIGN_SPEC §1.3 needs (16 settlements, 9 classes, 21
  building types, 3 ages, the two playable factions' 8 landmarks, campaign hero missions).
- **P2 - polish / skirmish factions**: minor and skirmish-only factions' landmarks, extra variants,
  southern peninsula, extra animals.

### 0.2 Texture tiers and set classes (WebP, measured ratios from the existing sets)

| Set class | ultra | high | mobile | Approx MB (ultra / high / mobile) | Use |
|---|---|---|---|---|---|
| **H** hero set | 2048 all maps | 1024 | 512 | 3.6 / 1.1 / 0.3 | Surfaces seen at 1-3 m in hero mode on large areas |
| **S** standard set | 1024 all maps | 1024 albedo, 512 normal/ORM | 512 albedo, 256 normal/ORM | 1.1 / 0.6 / 0.2 | Most architecture |
| **C** compact set | 1024 albedo, 512 normal/ORM | 512 | 256 | 0.6 / 0.3 / 0.1 | Secondary materials, characters' tiling cloth |
| **T** terrain layer | 1024 albedo, 512 normal/ORM | 512 | 512 albedo, 256 normal/ORM | 0.55 / 0.3 / 0.12 | Splat layers (detail normals tile 2-4 m anyway) |
| **A** atlas | 2048 | 1024 | 512 | 1.5-3 / 0.5-1 / 0.15-0.3 | Leaf cards, impostors, flipbooks, decals |

Normals are near-lossless WebP (lossy is unusable, ARCHITECTURE §18). Models carry no textures; they
reference shared sets via `samrajya_set`; per-model maps are limited to the `macro` map (uv1: AO, grime,
rising damp, rain streaks) at 1024 (landmarks 2048 ultra).

### 0.3 Triangle budgets (per instance, LOD0 / LOD1 / LOD2, impostor beyond)

| Kind | LOD0 | LOD1 | LOD2 | Switch distances (m, x `ZoomLook.lodBias`) |
|---|---|---|---|---|
| Landmark / hero monument | <= 120k | <= 30k | <= 6k | 120 / 400 / 1,200 |
| Major building (palace hall, temple, gate complex) | 20-60k | 6-15k | 1.5-3k | 90 / 300 / 900 |
| House / civic building | 2-6k | 0.6-1.5k | 150-400 | 60 / 200 / 600 |
| Wall segment (8-12 m) | 1.5-4k | 400-1k | 100-200 | 80 / 250 / 800 |
| Prop | 0.2-1.5k | 60-400 | - | 25 / 80 |
| Tree | per `TREE_SPECIES.tris` (3-16k) | 1-4.5k | 0.3-0.9k | 35 / 90 / 220, octahedral impostor beyond |
| Crowd soldier / villager (VAT) | 600-800 | 150-250 | impostor | `QualitySettings.soldierLod` |
| Horse / ox (VAT) | 900-1,200 | 300 | impostor | same |
| War elephant (VAT) | 1,500-2,200 | 500 | impostor | same |
| Hero / champion (skinned) | 25-40k | 10k | 3k | cinematic only near |
| Named NPC (skinned) | 8-15k | 3k | 800 | 10 / 30 / 80 |

### 0.4 Definition of done (every asset)

1. Deterministic script `tools/blender/assets/<category>/<id>.py` builds it from scratch
   (`npm run assets -- <id>`), no hand edits, no downloaded binaries.
2. Meets its dimensions (+-5%), triangle and texture budgets; `npm run assets:check` passes.
3. Average base color within +-6% of its `MATERIAL_PRESETS`/`TERRAIN_LAYERS` target; albedo and
   saturation within Bible §3 limits; roughness spans the preset range.
4. Cycles preview + in-engine shots under `sky_day` and `sky_golden`
   (`?scene=assetviewer&asset=<id>&camera=hero|close|overview`) and at tactical zoom; reviewed by the
   Art Director; screenshots in the PR / `docs/screenshots/pipeline/`.
5. LODs cross-fade without visible popping; impostor color within 5% of LOD2.
6. A procedural fallback exists (`registerModelFallback`) so `?assets=off` still shows a plausible shape.
7. Historical check: Bible §1.5 (no anachronisms), period notes in the script docstring.

---

## WP1 - Materials and terrain library (Technical Artist A)

Recipes: Bible §14. Targets: `MATERIAL_PRESETS` (materials.ts), `TERRAIN_LAYERS` (terrain.ts).

| ID | Asset id | Class | Description and acceptance | Prio |
|---|---|---|---|---|
| WP1-01 | `sandstone_buff` | H | Buff Sanchi/Chunar stone as a carved trim sheet with **the same band layout as `sandstone_carved_red`** (ashlar 0.32 m courses, creeper scroll, dentils, lotus petals, bead-and-reel, medallions) so `stupa_sanchi` re-skins by changing `samrajya_set`; chipped arrises, faint pink bands, black lichen on up-faces. The default heartland stone (ghats, plinths, stupa, toranas). Avg `#c2a985`, rough 0.6-0.9 | P0 |
| WP1-02 | `lime_plaster_weathered` | H | Hand-troweled lime with cracks, rain streaks, rising damp 0-0.8 m, 5-12% fallen patches showing brick. Avg `#e4dac6` (never above sRGB 236) | P0 |
| WP1-03 | `brick_fired_old` | S | Flat period bricks 0.42 x 0.07 m, lime joints, overfired bricks, efflorescence | P0 |
| WP1-04 | `roof_tile_terracotta` | S | Flat grooved tiles with hooked lips, lichen rows, 3% broken | P0 |
| WP1-05 | `thatch_grass` | S | Combed straw bundles, rope bands every 0.6 m; weathered-grey variant via macro mask | P0 |
| WP1-06 | `mud_plaster` | S | Finger-smoothed mud/dung plaster with straw flecks, cracks; mandana borders are decals (WP1-30) | P0 |
| WP1-07 | `bamboo_lattice` | S | Bamboo poles (nodes 0.3-0.4 m) + split-lath weave + coir lashing band - scaffolds, fences, cart canopies | P0 |
| WP1-08 | `timber_teak_carved` | S (trim) | Trim sheet: plain beam, lotus bracket, bead row, creeper scroll, fluted shaft + bell capital, door panel with bronze studs | P0 |
| WP1-09 | `sandstone_carved_red` (retune) | S (exists as H) | -12% saturation, per-block hue jitter +-3%, lichen and soot in macro maps; reserve for city-state architecture and accents; downgrade to class S (1024) once WP1-01 lands (saves 3.3 MB ultra) | P1 |
| WP1-10 | `sandstone_polished_mauryan` | C | Mirror polish (rough 0.1-0.32), faint speckle and cloud mottle; used with clearcoat 0.6 | P1 |
| WP1-11 | `timber_sal_weathered` | C | Adze-marked sal, silvering on the weather side - palisades, forest halls | P1 |
| WP1-12 | `granite_rubble` | C | Dry-laid irregular granite, orange lichen - highland forts | P1 |
| WP1-13 | `basalt_dressed` | C | Chisel-dressed basalt, salt bloom - chaitya facades, highland gates | P1 |
| WP1-14 | `laterite_block` | C | Pitted laterite blocks 0.6 x 0.3 m - bastions, parapets | P1 |
| WP1-15 | `mud_brick_sundried` | C | Sun-dried bricks with eroded edges - frontier and village walls | P1 |
| WP1-16 | `timber_weathered_grey` | C | Bleached grey timber with checks | P2 |
| WP1-17 | `stone_slab_roof` | C | Overlapping granite slabs with moss | P2 |
| WP1-18 | `thatch_palm` | C | Woven palm-leaf shingles (coast, forest) | P2 |
| WP1-19 | `sandstone_red_ashlar` | C | Plain spotted red sandstone ashlar - city-state walls | P2 |
| WP1-20 | `terrain_grass_lush` | T | Olive-emerald grass with soil gaps (GPU blades on top) | P0 |
| WP1-21 | `terrain_grass_dry` | T | Straw-khaki tufts with bare patches | P0 |
| WP1-22 | `terrain_alluvial_silt` | T | Grey-brown silt, prints, dried ripples | P0 |
| WP1-23 | `terrain_farmland_tilled` | T | Furrows 0.3 m (UV-rotated per plot), clods, stubble | P0 |
| WP1-24 | `terrain_road_earth` | T | Packed earth with cart ruts 1.4 m apart, hoof prints | P0 |
| WP1-25 | `terrain_river_sand` | T | Pale sand with flow ripples | P0 |
| WP1-26 | `terrain_rock_sandstone` | T (triplanar) | Cross-bedded buff-red cliff strata | P0 |
| WP1-27 | `terrain_flagstone` | T | Irregular buff flagstones, grass in joints (royal roads, courts, ghat landings) | P0 |
| WP1-28 | `terrain_mud_wet` | T | Monsoon overlay: wet churned mud with puddle mask in alpha | P0 |
| WP1-29 | `ground_dry_earth` | T (exists) | Cracked earth - frontier, grishma fields, yards | done |
| WP1-30 | `decals_settlement` | A (1024 ultra) | Decal atlas: plaster cracks, damp stains, soot, charring, mandana borders (ochre/white), rice-paste kolam (4), cart ruts end-caps, puddle masks, footprint trails | P1 |
| WP1-31 | `terrain_laterite_soil` | T | Iron-red gravelly soil | P1 |
| WP1-32 | `terrain_black_soil` | T | Black cotton soil with polygonal cracks (dry) / glossy (wet) | P1 |
| WP1-33 | `terrain_pebbles` | T | River pebbles 2-10 cm / angular scree | P1 |
| WP1-34 | `terrain_rock_granite` | T (triplanar) | Rounded granite with water stains and lichen | P1 |
| WP1-35 | `terrain_rock_basalt` | T (triplanar) | Stepped trap layering, vertical joints - the escarpment | P1 |
| WP1-36 | `terrain_forest_litter` | T | Sal/teak leaf litter, twigs, humus | P1 |
| WP1-37 | `terrain_paddy_mud` | T | Glossy paddy mud with water mask | P1 |
| WP1-38 | `terrain_salt_crust` | T | Salt-flat polygons (White Flats) | P2 |

WP1 estimate: ultra 34.7 MB (2 H, 7 S, 10 C, 17 T, decals), high 15.6, mobile 4.8 (P2 sets are not
shipped on mobile; they fall back to the nearest P0/P1 set).

Acceptance for WP1: tiling invisible at 3x3 repeats under raking golden light; height channel suitable
for the splat height blend (cavities dark, stones bright); every set also delivers its `height` (cache)
and a 256 px swatch for the Art Director's palette board.

---

## WP2 - Vernacular and civic architecture kit, construction and damage (Technical Artist B)

Dimensions and grammar: Bible §8.1-8.5. All pieces support the three architecture styles of the
playable factions via material sets (`heartland_brick`, `highland_stone`) and P2 sets for the others
(`forest_timber`, `frontier_mud`, `coastal_timber`, `city_sandstone`). Age variants: J = Janapada,
M = Mahajanapada, S = Samrajya.

| ID | Asset id | Footprint / height (m) | LOD0 / LOD1 / LOD2 tris | Variants | Prio |
|---|---|---|---|---|---|
| WP2-01 | `hut_thatch` | 4 x 4 / 4.2 | 2k / 600 / 150 | round + square, 3 thatch states | P0 |
| WP2-02 | `house_mud` | 8 x 4 / 4.6 | 3k / 800 / 200 | veranda, courtyard wall, flat/thatch roof (J, M) | P0 |
| WP2-03 | `house_brick_courtyard` | 8 x 8 / 6.5 | 5k / 1.2k / 300 | 1- and 2-storey, balcony, terrace (M, S) | P0 |
| WP2-04 | `mansion` | 12 x 16 / 9 | 12k / 3k / 600 | wagon-vault gatehouse, jharokhas (M, S) | P1 |
| WP2-05 | `granary` | 12 x 16 / 9 | 6k / 1.5k / 350 | J raised timber bins on posts, M brick podium + vault, S stone stepped podium | P0 |
| WP2-06 | `market_stall` | 4 x 4 / 3.2 | 1.5k / 400 / 100 | 4 canopies (dyed cloth), goods dressings: pots, grain, cloth, copper, spices | P0 |
| WP2-07 | `well` + `shaduf` | 4 x 4 / 2.6 | 1.5k / 400 / - | brick ring + pulley (M), timber shaduf lever (J, frontier) | P0 |
| WP2-08 | `village_tank` | 20 x 20 / -2 | 3k / 800 / 200 | earthen embankment, steps, cattle ramp (water via WATER_PRESETS.tank_still) | P1 |
| WP2-09 | `workshop` | 12 x 12 / 5 | 5k / 1.2k / 300 | potter (kiln, wheels), smith (forge, anvil, bellows), weaver (looms, dye vats) | P1 |
| WP2-10 | `barracks` | 16 x 24 / 6 | 7k / 1.8k / 400 | hall + drill yard + weapon racks + standard pole (J, M, S) | P0 |
| WP2-11 | `stable` | 16 x 20 / 5.5 | 6k / 1.5k / 350 | open sheds, hay, troughs | P1 |
| WP2-12 | `elephant_stable` | 24 x 28 / 9 | 9k / 2.2k / 500 | massive posts, chains, fodder stacks, bathing ramp | P1 |
| WP2-13 | `shrine_village` | 4 x 4 / 3.5-5 | 1.5k / 400 / 100 | wagon-vault cella, red-ochre stone, bell, flags; roadside variant | P0 |
| WP2-14 | `assembly_hall` | 12 x 12 / 7 | 6k / 1.5k / 350 | J village sabha (open pillared thatch), M raja's hall (brick + wagon vault) | P1 |
| WP2-15 | `road_station` | 8 x 12 / 5 | 4k / 1k / 250 | rest house + well + depot sheds | P2 |
| WP2-16 | `watchtower` | 4 x 4 / 9-12 | 2.5k / 700 / 150 | J timber frame, M brick, signal platform | P0 |
| WP2-17 | `field_kit` | - | props | bunds, field hut, threshing floor, straw stacks, cattle pen, bird-scaring rattle poles | P0 |
| WP2-18 | `construction_kit` | modular | 0.3-2k each | stakes + string lines, trench decal, brick stacks, log piles, stone blocks, sand heap, bamboo scaffold modules (1.5 m bay; 3, 6, 9 m tall; corner/straight/end), ladders, ramps, coir coils, mortar tubs, landmark scaffold (1.5x, with banner) | P0 |
| WP2-19 | `damage_kit` | modular | - | charred decal set (WP1-30), roof-hole variants of WP2-01..05, collapse variants (walls 40-60%) of house/granary/barracks, rubble piles (3 sizes), smouldering beams | P1 |
| WP2-20 | `props_household` | - | 0.2-1.2k | water jars (3), storage jars, copper lota, baskets (3), sacks (3), charpoy bed, low stools, grinding stone, hearth, firewood stack, cloth lines, oil lamps (diya, standing lamp), lamp niches | P0 |
| WP2-21 | `props_market_craft` | - | 0.2-1.5k | potter's wheel, loom, anvil + bellows, dye vats, scales (balance), coin chests, palm-leaf manuscript bundles, cloth bolts, spice baskets | P1 |
| WP2-22 | `props_military` | - | 0.3-1.5k | weapon racks (spears, bows), shields stacked, drums, conch stand, standards, tents (hide/cotton), fodder | P0 |
| WP2-23 | `palisade_village` | segment 8 m / 4.5 | 1.5k / 400 / 100 | thorn hedge variant for villages | P0 |
| WP2-24 | `boats_river` | 8-14 m | 2-5k | cargo boat, ferry, royal barge (P0 for the cinematic), fishing canoe | P0 (barge) / P1 |

**Construction stages** (DESIGN_SPEC §8.2, Bible §8.5): every building in WP2/WP3 exports (a) its
finished LODs, (b) a `footprint` mesh for the foundation stage (string lines snap to it), (c) a
`scaffold` layout (list of scaffold module transforms in `asset.json`) and (d) per-material "course
height" metadata so the course-reveal clip shader aligns with brick/stone courses.

**Acceptance WP2**: every piece reads at 700 m by its silhouette feature (Bible §8.1); 4 m grid
alignment; doors face +Z (south) by default; variants share textures; a village of 40 pieces renders in
<= 25 draw calls (instancing per piece x style).

---

## WP3 - Monuments, landmarks, fortifications and waterfront (Technical Artist C)

| ID | Asset id | Footprint / height (m) | LOD0 / LOD1 / LOD2 | Notes | Prio |
|---|---|---|---|---|---|
| WP3-01 | `stupa_sanchi` (re-skin) | 25.2 / 11.7 | exists 45k / 12k + new LOD2 2k | buff stone (`sandstone_buff`), weathered lime-plaster dome, harmika gilding traces; town variant 0.8x | P0 |
| WP3-02 | `temple_shikhara` | 16 x 16 / 20 | 60k / 15k / 3k | plinth + mandapa + curvilinear tower, amalaka, gilded kalasha, lamp niches; M brick-and-plaster, S stone | P0 |
| WP3-03 | `pillar_mauryan` | 2 x 2 / 9-14 | 6k / 1.5k / 300 | polished shaft, bell capital, abacus frieze; crowns: bull, elephant, horse, 8-spoke wheel (no lions) | P0 |
| WP3-04 | `palace_kit` | 40 x 40 / 14-18 | modules 5-30k | platform with moldings, pillared audience hall (Hall of Pillars interior for the negotiation mission), tiered timber pavilions with wagon-vault roofs, gate, gardens, chhatris | P0 |
| WP3-05 | `pavilion_mandapa` | 8 x 8 / 7 | 8k / 2k / 400 | open pillared hall | P0 |
| WP3-06 | `chhatri` | 4 x 4 / 6 | 4k / 1k / 200 | umbrella pavilion (flagged stylization) | P0 |
| WP3-07 | `ghat_kit` | modules 4 m | 2-8k | steps 0.30 x 0.45, landings, corner towers, chhatri landings, lamp niches, mooring rings, flood-mark macro; dawn duel arena (Tirthaghat) + oath stone | P0 |
| WP3-08 | `stepwell` | 12 x 20 / -10 | 40k / 10k / 2k | terraced flights with galleries (stylization) | P1 |
| WP3-09 | `bridge_setu` | 9 spans x 18 m | 30k / 8k / 2k | timber trestles on granite piers, railings, toll gate; damaged + broken variants (persistent consequences) | P0 |
| WP3-10 | `harbor_jetty` | 12 x 24 | 8k / 2k / 500 | piles, deck, warehouse, mooring posts | P1 |
| WP3-11 | `walls_L1` | segment 8-12 m | 3k / 800 / 150 | earth rampart + sal palisade, timber towers, timber gate (Janapada) | P0 |
| WP3-12 | `walls_L2` | segment 8-12 m | 4k / 1k / 200 | brick/laterite curtain, bastions every 30-40 m, twin-tower gate | P0 |
| WP3-13 | `walls_L3` | segment 8-12 m | 4k / 1k / 200 | dressed stone, square bastions with galleries, barbican gate complex | P1 |
| WP3-14 | `walls_damage` | per level | - | cracks, broken merlons, breach + rubble ramp | P1 |
| WP3-15 | `siege_kit` | - | 1-6k | hide-roofed rams, ladders, mantlets, siege-camp tents, palisaded camp | P1 |
| WP3-16 | `rock_cut_facade_kit` | modular | 10-40k | chaitya horseshoe arch (gavaksha) with timber-rib screen, pillared veranda, railing friezes, ribbed vault interior (hero interior) | P1 |

### Landmarks (DESIGN_SPEC §8.5; Bible §8.7). Each: LOD0 <= 120k, LOD1 <= 30k, LOD2 <= 6k, macro 2048 ultra, construction scaffold layout 1.5x, banner socket.

| ID | Landmark | Faction / age | Height m | Prio |
|---|---|---|---|---|
| WP3-L1 | Hall of a Hundred Pillars | Suvarna II | 18 | **P0** (one per playable faction) |
| WP3-L2 | Oath Stone of the Seven Clans | Giridurga II | 10 | **P0** (one per playable faction) |
| WP3-L3 | The Royal Granary | Suvarna II | 14 | P1 |
| WP3-L4 | Pillars of the Spoken Law | Suvarna III | 22 | P1 |
| WP3-L5 | The Great Road (gateway + milestone + rest house) | Suvarna III | 12 | P1 |
| WP3-L6 | The Cliff Cistern | Giridurga II | 9 (+12 deep) | P1 |
| WP3-L7 | Citadel of a Thousand Steps | Giridurga III | 26 | P1 |
| WP3-L8 | Assembly Caves of the League (uses WP3-16) | Giridurga III | 16 | P1 |
| WP3-L9 | Elephant Grove of Gajavana | Nilavana II | 15 | P2 |
| WP3-L10 | The Canopy Watch | Nilavana III | 24 | P2 |
| WP3-L11 | Caravanserai of the Salt Road | Marudesha II | 10 | P2 |
| WP3-L12 | Beacon Line of the Western Passes | Marudesha III | 16 | P2 |
| WP3-L13 | Lamp Tower of the River Mouth | Samudra II | 22 | P2 |
| WP3-L14 | Hall of the Guilds | Samudra III | 14 | P2 |
| WP3-L15 | The Coin House | Kotanagara II | 12 | P2 |
| WP3-L16 | Engineers' Arsenal | Kotanagara III | 18 | P2 |

**Age visual upgrades of key buildings** (AoE IV ages; delivered across WP2/WP3): houses (J hut ->
M brick courtyard -> S two-storey with balcony), granary (J timber bins -> M brick vault -> S stone
podium), barracks (J thatch hall -> M brick hall + yard -> S stone gate and colonnade), market (J stalls
-> M canopied ring -> S paved square with a pillar), temple/shrine (J shrine -> M brick shikhara ->
S stone shikhara with mandapa), walls (L1 -> L2 -> L3), assembly (J sabha -> M raja's hall -> palace).

**Acceptance WP3**: landmarks are the tallest silhouette of their settlement and recognizable at 2.6 km
(strategic band) by outline alone; hero-mode close-ups pass the three-scales rule (Bible §1.4);
`stupa_sanchi` re-skin approved against `docs/screenshots/pipeline` (no more all-red stone).

---

## WP4 - Vegetation, crops and natural props (Technical Artist D)

Species data: `TREE_SPECIES`, `GROUND_PLANTS`, `CROPS`, `WIND`, `VEGETATION_LOD` in
`render/style/vegetation.ts`; recipe: Bible §7.2. Each tree: 3 shape variants, LOD0-2, octahedral
impostor (8x8 frames, 256/192/128 px), leaf atlas (A class, shared pages of 4 species), bark set (C).
Vertex colors: R hierarchy, G phase, B flutter, A AO.

| ID | Asset id | LOD0 tris | Seasonal states | Prio |
|---|---|---|---|---|
| WP4-01 | `tree_banyan` | 16k | evergreen; prop-root pillars + aerial root cards; platform variant | P0 |
| WP4-02 | `tree_peepal` | 14k | copper new leaves (vasanta); railing + red threads variant | P0 |
| WP4-03 | `tree_neem` | 9k | white blossom (vasanta) | P0 |
| WP4-04 | `tree_mango` | 10k | flowering (shishira-vasanta), grove planting rows | P0 |
| WP4-05 | `tree_palmyra` | 3.5k | evergreen | P0 |
| WP4-06 | `tree_sal` | 10k | leaf flush (vasanta), partial drop (grishma) | P0 |
| WP4-07 | `tree_teak` | 8k | bare (grishma), flowers (varsha) | P1 |
| WP4-08 | `tree_babul` | 6k | yellow ball flowers (varsha-sharad) | P1 |
| WP4-09 | `tree_palash` | 6k | leafless + orange-red flowers (vasanta) | P1 |
| WP4-10 | `tree_bamboo` | 7k | clump of 30-80 culms | P1 |
| WP4-11 | `tree_date_palm` | 3k | evergreen | P1 |
| WP4-12 | `tree_amaltas` | 6k | yellow flower chains (grishma) | P1 |
| WP4-13 | `tree_coconut` | 3.5k | evergreen (coast only) | P2 |
| WP4-14 | `grass_blades` | GPU cards | 3-blade clumps, 4 seasonal color sets (doob grass) | P0 |
| WP4-15 | `kash_grass` | 400 / clump | white plumes in sharad (backlight translucency) | P1 |
| WP4-16 | `reeds` | 300 / clump | brown seed heads | P1 |
| WP4-17 | `lotus` | 200 / pad cluster | pads + pink/white flowers | P1 |
| WP4-18 | `shrubs` | 0.8-2k | ber thorn scrub, aak, generic shrub x3 | P1 |
| WP4-19 | `crop_rice` | cards | flooded seedlings, tillering, golden heads, stubble, straw stacks | P0 |
| WP4-20 | `crop_wheat` | cards | green, heading, golden, sheaves | P0 |
| WP4-21 | `crop_mustard` | cards | green, yellow bloom, pods | P0 |
| WP4-22 | `crop_millet` / `crop_sugarcane` / `crop_cotton` | cards | growth stages per `CROPS` | P1 |
| WP4-23 | `crop_barley` / `crop_sesame` / `crop_lentil` | cards | growth stages | P2 |
| WP4-24 | `rocks_kit` | 0.5-4k | granite tors (3), basalt blocks (3), sandstone outcrops (3), pebble clusters, fallen logs, stumps | P1 |
| WP4-25 | `forest_floor_decals` | A | leaf litter, twigs, moss patches | P2 |

**Acceptance WP4**: no species in `BANNED_PLANTS`; crowns shade as volumes (bent normals); peepal flutter
visible; impostors indistinguishable beyond 220 m; a 1 km forest at tactical zoom stays within the
vegetation draw-call budget (<= 60 draw calls incl. impostors); seasonal colors switch via parameters.

---

## WP5 - Crowd units, villagers, animals and vehicles (Technical Artist E)

Pipeline: ARCHITECTURE §20 (VAT). Shared humanoid skeleton (`rig.humanoid`, standard bone names);
modular kit meshes per class; **faction differences via tint masks + a few swappable signature pieces**
(headgear, shield shape) - not separate full meshes. Vertex color R = team mask (0..1), G = cloth
variation seed, B = part id. VAT: 15 fps, positions RGBA16F (+ octahedral normals), <= 1.2 MB per class
(ultra), clip table in the manifest. LOD0 600-800 tris, LOD1 150-250 (re-baked VAT), impostor
(8 directions x key frames of walk/idle/attack/die, 128 px frames).

### 5.1 Unit classes (Bible §9.2 silhouettes)

| ID | Asset id | Kit (per Bible §9.2) | Faction signature pieces | Prio |
|---|---|---|---|---|
| WP5-01 | `unit_spearmen` | quilted jacket, antariya, turban; 3.2 m spear; 1.4 m tall shield | turban styles (Suvarna forward knot, Giridurga iron cap), shield emblem paint | P0 |
| WP5-02 | `unit_archers` | 1.8 m bamboo bow, quiver, crossed uttariya | head-cloth / conical palm hat (Samudra) | P0 |
| WP5-03 | `unit_elite_guards` | scale vest, crested helmet, sword, round shield | crest color, shield rim | P0 |
| WP5-04 | `unit_cavalry` | rider + horse (WP5-20), lance, saddle cloth | lance pennon, saddle cloth | P0 |
| WP5-05 | `unit_chariots` | car (WP5-30) + 2 horses + driver + archer + standard | standard, car paint band | P1 |
| WP5-06 | `unit_war_elephants` | elephant (WP5-21) + caparison + railed platform + mahout + 2 archers | caparison, hanging, banner | P0 |
| WP5-07 | `unit_engineers` | axes, mattocks, baskets, rope, ladders | head-cloth | P1 |
| WP5-08 | `unit_scouts` | light rider, javelins, small shield, streamer | streamer | P1 |
| WP5-09 | `unit_supply_train` | ox cart (WP5-31) + 2 oxen + drover | canopy flag | P0 |
| WP5-10 | `standard_bearer` | per class: pole 4.2 m + cloth (banner shapes, `BANNER_DIMENSIONS`), drummer, conch blower | banner from `bannerSvg` | P0 |

**Crowd clips** (standard names, frames @ 30 fps source -> baked at 15): idle 48*, walk 32*, run 20*,
attack 24 (3 variants: thrust, slash, shield bash), shoot 40 (archers: draw-brace-release), reload 24,
hit 12, die 36 (2 variants: slump forward, sit-fall), dead 1*, brace 24* (spear levelled, shields
locked), charge 20*, rout 20* (shield dropped, looking back), cheer 40*, work 32* (engineers dig/hammer).
Riders: idle, walk, trot, canter, gallop, attack (lance couch / sword cut), shoot (scouts javelin), die.
Elephant: idle (ear flap, trunk curl), walk, amble (run), trumpet, charge, panic (rear + turn), attack
(tusk sweep, trample), die. Horses: idle, walk, trot, canter, gallop, rear, die. Oxen: idle, walk, pull.

### 5.2 Villagers (AoE "visible labor", DESIGN_SPEC §8.3)

| ID | Asset id | Variants | Clips (custom `x_` names) | Prio |
|---|---|---|---|---|
| WP5-11 | `villager_farmer` | m/f x 3 garments, sickle, hoe, basket | walk, idle, `x_farm_hoe`, `x_sow_broadcast`, `x_harvest_sickle`, `x_bundle_sheaf`, `x_carry_headload`, `x_carry_yoke`, `x_thresh` | P0 |
| WP5-12 | `villager_builder` | m/f, hammer, basket, brick hod | walk, `x_build_hammer`, `x_build_carry`, `x_climb`, `x_mix_mortar`, `x_lay_brick`, idle sit (idle builders in the shade) | P0 |
| WP5-13 | `villager_carrier` | water carrier (pots on head/yoke), porter | walk, `x_carry_headload`, `x_carry_yoke`, `x_draw_water` | P0 |
| WP5-14 | `villager_crafter` | potter, smith, weaver | `x_potter_wheel`, `x_smith_hammer`, `x_weave` | P1 |
| WP5-15 | `villager_townsfolk` | merchants, priests, children, elders (from the WP6 kit at crowd LOD) | walk, idle, talk, `x_bow` (crowd parts and bows for the prince), `x_protest` (raised arms), `x_queue` | P0 |
| WP5-16 | `villager_soldier_drill` | militia at barracks | `x_drill_thrust`, idle, walk | P1 |

### 5.3 Animals and vehicles

| ID | Asset id | Dimensions | Notes | Prio |
|---|---|---|---|---|
| WP5-20 | `horse` | 1.45 m withers, 2.2 m long | 5 coat variants (`horse_coat`), saddle cloth with team mask, no stirrups | P0 |
| WP5-21 | `elephant` | 3.0 m shoulder, 5.5 m long | tusked/tuskless, caparison + bells + railed platform (war), work harness (stables, logging) | P0 |
| WP5-22 | `zebu_ox` | 1.4 m hump | painted horns, yoke | P0 |
| WP5-23 | `cattle_cow` | 1.3 m | village grazing, ghat scenes | P1 |
| WP5-24 | `camel` | 2.0 m hump | frontier caravans (Marudesha) | P2 |
| WP5-25 | `goats_dogs` | - | ambient life | P2 |
| WP5-30 | `chariot` | car 1.2 x 1.0 m, wheels 1.3 m, 16 spokes | lac-red paint, bronze fittings, standard socket | P1 |
| WP5-31 | `ox_cart` | bed 2.6 x 1.5 m, wheels 1.4 m | hooped bamboo-mat canopy, grain sacks; supply and civilian variants | P0 |
| WP5-32 | `farm_cart` | 2.2 x 1.3 m | open cart, solid wheels | P1 |
| WP5-33 | `palanquin` | 2.4 m | court scenes, cinematic | P2 |

**Acceptance WP5**: silhouettes distinguishable at 200 m in grey-scale; 5,000 soldiers within
ARCHITECTURE §15 budgets; no foot sliding (stride matched); team mask covers 25-35% of the visible
surface; per-instance cloth variation visible; shadows use the same VAT (custom depth material).

---

## WP6 - Hero and cinematic characters (Technical Artist F)

Skinned GLB (not VAT), shared humanoid skeleton + face bones (jaw, eyelids, brows) + cloth/hair chains,
2048 texture sets (body, costume, accessories) on ultra, 1024 high, 512 mobile (mobile hero mode uses
LOD1). Root motion on locomotion and attacks. Frame data: DESIGN_SPEC §11.7.

| ID | Character | LOD0 / LOD1 tris | Textures | Clips | Prio |
|---|---|---|---|---|---|
| WP6-01 | **Kumara Aditya** (hero, 1.74 m) | 35k / 10k | 3 sets (body/face, costume silk+cotton, gold/bronze/leather) | **Exploration**: idle (2 variants, 120 f*), walk 32*, run 22*, sprint 18*, turn_l / turn_r (90 and 180), interact (inspect, pick up, open gate), talk*, `x_bow_namaste`, `x_sit`, `x_step_off_barge`. **Combat**: attack_combo_1, attack_combo_2, attack (light 3 finisher), attack_heavy + `x_heavy_hold`* + `x_heavy_release`, dodge (roll 0.55 s, 4.5 m), block*, parry, `x_riposte`, hit (front/back/left/right), stagger, `x_guard_break`, `x_salve`, strafe_l*/strafe_r* (lock-on), `x_perfect_dodge`, die, `x_get_up` | P0 |
| WP6-02 | Aditya combat outfit | (variant) | lamellar cuirass, bracers | - | P1 |
| WP6-03 | **Vira Durjaya** (rival champion, 1.86 m) | 30k / 9k | 2 sets | idle*, walk*, run*, attack_combo_1/2, attack (shield bash), attack_heavy, `x_leap_overhead` (unblockable, 0.8 s wind-up), `x_sweep_unblockable`, block*, hit, stagger, `x_throw_shield` (phase 3), `x_taunt`, `x_kneel_yield`, die | P0 |
| WP6-04 | **Kumari Meghavati** (1.62 m) | 25k / 8k | 2 sets | idle*, walk*, talk*, `x_bell_ring`, interact, `x_bow_namaste` | P1 |
| WP6-05 | Hired Blade (enemy archetype 1) | 12k / 4k | shared enemy set | idle*, walk*, run*, attack x2, attack_heavy (telegraphed), dodge, hit, stagger, die, `x_circle`* | P0 |
| WP6-06 | Raider Spearman (enemy archetype 2) | 12k / 4k | shared | + `x_spear_thrust_long` | P0 |
| WP6-07 | Raider Archer | 10k / 3k | shared | shoot, reload, `x_roof_crouch`, hit, die | P1 |
| WP6-08 | Raider Captain | 20k / 6k | 1 set | enemy set + `x_unblockable_overhead`, `x_enrage` | P0 |
| WP6-09 | Ugrasena (sparring master) | 15k / 5k | 1 set | guard set + `x_spar_reset`, `x_laugh` | P1 |
| WP6-10 | **NPC modular kit** for the 22 `HERO_CHARACTERS` | 8-15k / 3k / 800 | 2 shared atlases | bodies {noble, warrior, priest, merchant, farmer, scholar, guard, envoy, child} x {m, f}; garments recolored from `appearance.garment/accent` (snapped to `DYES`); headgear {turban, crown, helmet, veil, topknot}; props {staff, palm-leaf ledger, sword, mace, bow, lamp, palm-leaf scroll, basket, spear}; clips: idle (3)*, walk*, talk* (3 gesture sets), `x_bow`, `x_point`, `x_cross_arms`, `x_lean_in` (negotiation reactions), `x_worry`, `x_kneel` | P0 |
| WP6-11 | Named variations | - | - | Rani Vasumati, Mantri Haridatta, Prince Devavarman, the four great houses, Pushkala, Kevala, Ratnakara, Gomati, Kumbha, Gajaratha, Bhadrasena, Nilambari, Vedavrata, Tirthapala - built from WP6-10 with unique head/hair/jewelry | P1 |
| WP6-12 | Weapons and props (hero scale) | 1-4k each | shared | khadga sword + scabbard, curved blade, round shields (3 emblem variants), spear, bow, mace, lamp staff | P0 |
| WP6-13 | Portraits | - | 256 px WebP x 22 | rendered from WP6-10/11 in Blender with the mural-style (outline + wash) look for dialogue and negotiation UI | P1 |

**Acceptance WP6**: reads heroic at 4.2 m camera distance (silhouette, cloth secondary motion, weight);
silk/cotton/gold/skin read as different materials under `golden_dust` and `dawn_mist`; combat clips
match DESIGN_SPEC frame data within 1 frame; telegraphs readable (0.5-0.8 s wind-ups); no clipping in
the 3-hit combo, roll and parry; dialogue two-shot holds up at 1.4 m with DoF.

---

## WP7 - Skies, LUTs, VFX textures, banners and UI art (Technical Artist G + Art Director)

| ID | Asset id | Spec (Bible §4, §10, §11) | Size | Prio |
|---|---|---|---|---|
| WP7-01 | `sky_dawn` | Nishita: sun 6 deg / 95 az, air 1.1, aerosol 2.4, ozone 1.4, clouds 0.25 | 2048/1024/512 EXR | P0 |
| WP7-02 | `sky_noon` | 62 / 170, air 1.0, aerosol 1.6, clouds 0.18 (replaces `sky_day` as the noon key) | idem | P1 |
| WP7-03 | `sky_dusk` | -2 / 280, aerosol 2.6, ozone 1.6, clouds 0.3 (sky-only lighting) | idem | P1 |
| WP7-04 | `sky_night` | moonlit dome, stars, moon removed (given to the light), irradiance 0.08 | idem | P0 |
| WP7-05 | `sky_overcast` | monsoon dome, clouds 0.95, aerosol 4 | idem | P0 |
| WP7-06 | `sky_haze` | grishma, aerosol 5, clouds 0.05 | idem | P1 |
| WP7-07 | `sky_fog` | shishira fog, aerosol 6, clouds 0.5 | idem | P2 |
| WP7-08 | `lut_dawn`, `lut_golden`, `lut_dusk`, `lut_night`, `lut_monsoon`, `lut_haze`, `lut_fog` | 32^3 LUT as 1024 x 32 PNG strip, authored in the lookdev harness by the Art Director | 7 x ~20 KB | P1 |
| WP7-09 | `fx_fire` / `fx_smoke` | 8x8 flipbooks, smoke with normal map for sun lighting | A 1024/1024/512 | P0 |
| WP7-10 | `fx_dust` | 4x4 dust puffs + ring + hoof dust | A | P0 |
| WP7-11 | `fx_sparks_embers` | sparks, embers, slash spark, parry flash, finisher burst | A 512 | P0 |
| WP7-12 | `fx_rain` | streak sprite, splash flipbook 4x4, ripple normal (8 frames), drip | A 512 | P0 |
| WP7-13 | `fx_mist` | 4 mist sprites (soft, tileable edges) | A 512 | P0 |
| WP7-14 | `fx_nature` | falling leaves (sal, peepal), palash petals, kash seeds, fireflies, dust motes | A 512 | P1 |
| WP7-15 | `fx_weapon_trail` | trail gradient + noise for hero weapon arcs | 256 | P0 |
| WP7-16 | `fx_lightning` | 4 bolt sprites | 512 | P2 |
| WP7-17 | `sun_sprite`, `lens_dirt` | HDR sun disc + glow; subtle lens dirt for bloom (ultra) | 512 / 1024 | P1 |
| WP7-18 | `banner_cloth` | banner meshes for the 6 `BannerShape`s with pole + crossbar + tassels, cloth weights; textures are generated at runtime from `bannerSvg` | meshes only | P0 |
| WP7-19 | `key_art_loading` | 3 loading-screen paintings rendered in Blender (Rajapura ghats at dawn, battle at the Setu bridge at golden hour, Giridurg in monsoon), graded with the LUTs, 1920 x 1080 WebP (mobile 960 x 540) | ~0.3 MB each | P1 |
| WP7-20 | `ui_illustrations` | event-card vignettes (12) in the Ajanta outline-and-wash style, 512 x 256 | ~40 KB each | P2 |

**Acceptance WP7**: skies baked with the Bible §4.1 parameters and normalized so their manifest
`ambientIrradiance` is recorded (runtime calibrates to `sky.irradiance`); LUTs neutral at 0 strength;
flipbooks loop without pops and are lit (normal/alpha) where noted; banner emblems are never baked into
textures (they come from `emblems.ts`).

---

## Sequencing (suggested sprint order)

1. **Sprint A (unblocks everything)**: WP1-01..08, 20-28 (P0 materials and terrain); WP4-01..06, 14
   (P0 trees, grass); WP7-01, 04, 05, 09-13, 18 (skies, core VFX, banners); WP5 rig + spearmen/archers
   VAT prototype (with the CTO's VAT baker ticket).
2. **Sprint B (vertical slice)**: WP2-01..07, 10, 13, 16-18, 20, 22-24 (village and capital kit,
   construction); WP3-01..07, 09, 11, 12, L1, L2 (stupa re-skin, temple, pillar, palace, ghats, bridge,
   walls, two landmarks); WP5 remaining P0 + villagers; WP6-01, 03, 05, 06, 08, 10, 12 (hero, rival,
   enemies, NPC kit); WP4-19..21 crops.
3. **Sprint C (MVP complete)**: all P1 items.
4. **Sprint D (polish)**: P2 items, extra variants, southern peninsula.

Engine dependencies (Lead Graphics / CTO): VAT baker + crowd shader (ARCHITECTURE §20), octahedral
impostor baker, course-reveal construction shader, height fog (Bible §4.5), IBL calibration (Bible
§4.4), terrain splat weights generation (Bible §5.3), cloth shader for banners.
