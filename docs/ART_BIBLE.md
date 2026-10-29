# SAMRAJYA: Echoes of Bharat - Art Bible

Owner: Art Director. Status: v1 (pre-production). Audience: Technical Art (Blender asset scripts), Lead
Graphics Engineer and graphics devs, Lead UI/UX, Creative Director, QA.

This document is the visual contract of the game. Every number in it is implementable today:

- **Canonical values live in code**: `src/render/style/*.ts` (3D) and `src/ui/theme.css` (UI). Tables
  marked *generated* below are printed from those constants; when they disagree, the code wins and this
  file is regenerated. Renderers never hard-code a color, light, fog or grade value.
- **Production list**: `docs/ASSET_LIST.md` (work packages, budgets, acceptance).
- **Art references in the repo**: `docs/art/` - UI kit (`ui_kit.html`, `ui_kit.jpg`, `ui_kit_phone.jpg`),
  heraldry and icon sheet (`emblems_icons.png`), lighting lookdev sheet (`lookdev_presets.jpg`) and its
  harness (`docs/art/tools/lookdev/`, which also contains the reference height-fog shader).
- Tags: **[NOW]** implementable with what exists, **[ENG]** needs engine work (Lead Graphics),
  **[WP n]** needs assets from work package *n* of `ASSET_LIST.md`.

Contents: 1 Pillars and references - 2 The look across camera distance - 3 Color - 4 Lighting and
atmosphere - 5 Terrain and biomes - 6 Water - 7 Vegetation and crops - 8 Architecture - 9 Characters,
animals and vehicles - 10 VFX - 11 UI art style - 12 Camera and composition - 13 Quality tiers -
14 Material recipes (Blender) - 15 Review of the current build - 16 Art QA checklist - 17 Requests to
other owners.

---

## 1. Visual pillars and references

### 1.1 The one-line look

**Sun-baked earth and weathered stone of ancient India circa 300 BCE, painted with light and dust:
readable as a board game from the clouds, as dense and atmospheric as a film when you walk its streets.**

### 1.2 Pillars

1. **Sunlit earth, living color.** 70% of any frame is low-chroma earth, buff stone, lime plaster, olive
   vegetation and dust haze. Saturated color is *earned*: cloth, paint, flowers, gold leaf, banners and
   team colors, together <= 10% of the frame. That restraint is what makes a saffron army or a palash
   tree in bloom sing.
2. **Readable from the clouds** (Age of Empires IV). At strategic and battle zoom every unit class,
   building type and faction is identifiable from silhouette and team color alone, in grey-scale and
   for color-blind players. Value separation beats detail.
3. **Weight and weather up close** (Black Myth: Wukong). Near the camera every surface carries three
   scales of detail (macro grime, meso carving/blocks, micro grain), light has direction and mass
   (shafts, contre-jour, deep cool shadows), and weather is a character (dawn mist, monsoon wet, dust).
4. **Hand-made, not machine-made.** Nothing is perfectly straight, clean or repeated: hand-smoothed
   plaster, jittered stone courses, unevenly dyed cloth, irregular fields that follow rivers and roads.
5. **Historically careful, cinematically bold.** Forms are plausible for c. 300 BCE (or flagged as
   stylization, DESIGN_SPEC Appendix B); lighting, framing and grading are as dramatic as we like.

### 1.3 Reference vocabulary (described, not copied)

| Reference | What we take | Where it shows |
|---|---|---|
| **Mauryan polished sandstone** (Chunar buff stone, monolithic pillars, bell capitals, lotus abacus) | Mirror-polished buff stone (`sandstone_polished_mauryan`, roughness 0.18 + clearcoat 0.6) as the empire's signature; tall free-standing pillars with bell/lotus capitals topped by a **bull, elephant or wheel** | Suvarna landmarks (Pillars of the Spoken Law), palace halls, road markers |
| **Sanchi stupa and toranas** | Dome (anda), drum (medhi), railing (vedika) with lens crossbars, harmika, chhatra; gateways of three curved architraves with spiral volutes, dense low-relief panels, lotus medallions | Stupa & Vihara (exists: `stupa_sanchi`), torana arch in the UI, gate kit |
| **Rock-cut chaitya halls** (Bhaja/Karla type) | Horseshoe *gavaksha* arch with ribbed timber-imitating vault, pillared aisles, dark interiors with a single shaft of light | Highland architecture, Assembly Caves landmark, hero interiors |
| **Pataliputra-type timber city** | Timber palisades with towers, pillared timber halls on stone plinths, verandas with carved brackets | Heartland walls L1, palace complex, Hall of a Hundred Pillars |
| **Ajanta-style mural palette** (later, used as a palette only) | Yellow and red ochre, terre verte, lapis, lamp black, kaolin; outline-and-wash figure style | Painted plaster, howdahs/chariots, UI illustration, loading screens |
| **Terracotta plaques and figurines** | Warm fired-clay reds, stamped ornament, toy-like animal forms | Roof finials, village shrines, market props, UI icon flavour |
| **Punch-marked coin symbols** | Sun, arched hill, elephant, tree-in-railing, wheel, taurine | Faction heraldry (`emblems.ts`), coin icon, UI ornaments |
| **Sanchi relief costume** | Large knotted turbans with a frontal knob, draped antariya and uttariya, heavy earrings, armlets, torques | Nobles, hero, court NPCs |
| **Black Myth: Wukong** | Low raking sun through mist and foliage, layered aerial perspective, dense weathered stone with moss and wet sheen, heroic third-person framing, filmic grade, set-piece vistas | Hero mode, cutscenes, zoomed-in battle cams, landmark close-ups |
| **Age of Empires IV** | Chunky readable buildings with exaggerated roofs/finials, strong team color, clean ground, satisfying construction stages, crisp UI with icon-first command card | Strategic and battle zoom, construction, UI |

### 1.4 How Wukong-like realism translates

- **Light**: always a clear key direction. Sun elevation for authored scenes 5-15 deg (dawn/golden) or
  50-65 deg (noon). Shadows are cool (sky fill), lit faces warm. Key:fill targets per preset (§4).
  Light shafts (screen-space god rays) appear whenever the sun is low and there is mist, dust or smoke.
- **Atmosphere**: three depth planes per vista - dark, detailed foreground (often an occluder: torana
  post, foliage, pillar), warm mid-ground subject, pale hazy background. Exponential height fog with
  sun in-scattering does this automatically when tuned per §4.5.
- **Material density**: at hero distance every surface shows macro variation (0.5-10 m: grime, rising
  damp, rain streaks, sun bleaching), meso structure (5-50 cm: blocks, carving, cracks, weave) and micro
  response (roughness breakup, grain). One flat color over > 1 m^2 is a bug.
- **Composition**: frame-within-frame (toranas, colonnades, banyan roots), leading lines (ghat steps,
  roads, rivers, railings), the hero silhouetted against the brightest part of the frame.
- **Grading**: filmic ACES, warm highlights / cool shadows, gentle vignette, lifted blacks only in haze
  and fog. No teal-and-orange cliche: our "teal" comes from real sky fill and peacock-blue paint.

### 1.5 What we never do

- Lime/acid greens, pure white walls (#ffffff), pure black shadows, chrome-gold everywhere.
- **Anachronisms**: Mughal domes, pointed arches, minarets and jali-domed tombs (c. 1,800 years later);
  16th-century Rajput fort silhouettes; marigold garlands, chillies, maize, potatoes, tomatoes, tobacco,
  cacti, eucalyptus, gulmohar trees (full list: `BANNED_PLANTS` in `render/style/vegetation.ts`);
  stirrups on horses; saddles with high pommels; gunpowder; paper books (use palm-leaf and birch-bark).
- Copying the Lion Capital of Sarnath or the 24-spoke Ashoka Chakra (national emblems) - our capitals
  carry bulls, elephants, lotuses or an 8-spoke wheel.
- Orientalist cliches (snake charmers, flying carpets, harem fantasy), caricatured "tribal" costume for
  forest or frontier peoples (DESIGN_SPEC §3.6), sexualized costume, gore (§10.1).

---

## 2. The look across camera distance

The camera distance to its focus point drives one continuous blend, `resolveZoomLook(distance)` in
`render/style/zoom.ts` (log-distance smoothstep between neighbouring bands; allocation-free with a reused
`out` object; `capZoomLook(look, tier)` then clamps by quality tier). **Far = Age of Empires clarity,
near = Wukong fidelity.**

### 2.1 Bands (generated)

<!-- @gen:ZOOM begin (generated from src/render/style; do not edit by hand) -->
| Band | Distance m | FOV / pitch | LOD bias | Detail normal / macro / parallax | Team boost / rim / outline px / banner x | Cards / footprint / tokens | Grass / tree impostor from m | Fog x / aerial / cloud shadows / shafts x |
|---|---|---|---|---|---|---|---|---|
| **strategic** | 2600 | 38 / 58 | 0.8 | 0 / 1 / 0 | 1.35 / 0.3 / 3 / 3 | no / 0 / 1 | 0 / 0 | 0.35 / 0.65 / 0.6 / 0 |
| **operational** | 700 | 40 / 52 | 0.9 | 0.25 / 1 / 0 | 1.25 / 0.25 / 2.5 / 1.8 | yes / 0.55 / 0 | 0.15 / 250 | 0.6 / 0.55 / 0.45 / 0.3 |
| **tactical** | 220 | 42 / 46 | 1 | 0.65 / 0.9 / 0 | 1.12 / 0.15 / 2 / 1.3 | yes / 0.4 / 0 | 0.7 / 180 | 1 / 0.45 / 0.3 / 0.6 |
| **close** | 45 | 45 / 26 | 1.25 | 1 / 0.8 / 0.6 | 1 / 0.06 / 1.5 / 1 | yes / 0.25 / 0 | 1 / 140 | 1.1 / 0.35 / 0.2 / 1 |
| **hero** | 4.5 | 50 / 8 | 1.6 | 1 / 0.7 / 1 | 1 / 0 / 0 / 1 | no / 0 / 0 | 1 / 120 | 1.25 / 0.3 / 0.15 / 1.25 |

| Band | AO x / radius m | Bloom x | DoF strength / f / max px | Vignette + / sat x / contrast x | Sharpen / grain / CA | Shadow dist m / split lambda / softness / contact |
|---|---|---|---|---|---|---|
| **strategic** | 0.6 / 12 | 0.6 | 0 / 16 / 0 | -0.04 / 1.04 / 1.02 | 0.25 / 0 / 0 | 3200 / 0.6 / 2 / no |
| **operational** | 0.8 / 4 | 0.8 | 0 / 16 / 0 | -0.02 / 1.02 / 1.02 | 0.2 / 0 / 0 | 1100 / 0.7 / 1.4 / no |
| **tactical** | 1 / 1.5 | 1 | 0 / 16 / 0 | 0 / 1 / 1 | 0.12 / 0 / 0 | 420 / 0.75 / 1 / no |
| **close** | 1.1 / 0.9 | 1.1 | 0.35 / 8 / 4 | 0.05 / 1 / 1.03 | 0.05 / 0.015 / 0.0006 | 160 / 0.8 / 0.8 / yes |
| **hero** | 1.15 / 0.6 | 1.2 | 1 / 2.8 / 10 | 0.1 / 0.98 / 1.05 | 0 / 0.025 / 0.0012 | 90 / 0.85 / 0.6 / yes |
<!-- @gen:ZOOM end -->

### 2.2 Rules per band

- **strategic (>= 2.6 km, world map)**: an illustrated map you could print. Terrain shows biome macro
  color + cloud shadows; settlements read as clusters of bright lime/sandstone blocks with the
  landmark as the tallest silhouette; armies are tokens with banners at 3x scale; roads are lighter than
  fields; rivers are the darkest large shapes. No grass, trees as impostor clusters. Fog x0.35 so the
  whole map stays readable; aerial perspective 0.65 tints only the far edge. Sharpen 0.25.
- **operational (~700 m, battle overview)**: formations read as team-colored rectangles with
  footprints (0.55 opacity), formation cards on, soldiers at LOD2/impostor. Team color +25% value/sat,
  unit rim 0.25 so dark armies never sink into dark ground.
- **tactical (~220 m, default battle/settlement view)**: the AoE IV framing - 42 deg FOV, 46 deg pitch.
  Every class silhouette readable, banners 1.3x, grass at 70%, detail normals fading in (0.65).
- **close (~45 m, zoomed battle cam, settlement close-up)**: the cinematic threshold. Full detail
  normals, parallax on hero assets, contact shadows (ultra), subtle DoF (f/8, max 4 px), grain 0.015.
  Readability aids fade out (rim 0.06, outlines only on hover/selection).
- **hero (<= 4.5 m, third person, cutscenes)**: Wukong fidelity. No readability aids, DoF on the subject
  (f/2.8, 10 px), grain 0.025, chromatic aberration 0.0012 at the frame edge, fog x1.25 for depth,
  shafts x1.25, LOD bias 1.6.

### 2.3 Transition rules

- No grade, fog or exposure *pop* while zooming: everything numeric is blended; booleans switch at the
  midpoint between bands (formation cards, contact shadows).
- Mesh LODs cross-fade with screen-door dither over 6 m (`VEGETATION_LOD.crossFadeM`) - never pop.
- Soldier crowds swap tokens <-> soldiers between strategic and operational with a 0.4 s dissolve
  (`readability.tokens`).
- Materials: detail normal and parallax fade by band weight, not by a per-material distance, so a wall and
  the ground beside it sharpen together.
- Banners and finials scale smoothly with `bannerScale` (pivot at the pole base).

---

## 3. Color

### 3.1 Value structure

Albedo (linear luminance of the base color, `ALBEDO_LIMITS` in `palette.ts`):

| Family | Linear albedo | sRGB example |
|---|---|---|
| Hard floor / ceiling | 0.012 / 0.84 | `#1e1e1e` / `#ececec` |
| Dry soil | 0.15-0.32 | `#a88a68` |
| Wet soil, black cotton soil | 0.05-0.14 | `#4f4636`, `#3e3a33` |
| Grass | 0.08-0.20 | `#6d7a43` |
| Foliage (leaf cards) | 0.04-0.14 | `#3d5c2b` |
| Sandstone | 0.18-0.42 | `#c2a985` |
| Lime plaster | 0.50-0.78 | `#e4dac6` |
| Brick, terracotta | 0.10-0.24 | `#9c5a40` |
| Timber | 0.05-0.16 | `#6b4a2e` |
| Skin | 0.08-0.30 | `SKIN_TONES` |
| Undyed cotton | 0.45-0.70 | `#d9cdb3` |
| Dyed cloth | 0.04-0.35 | `DYES` |

On screen (after ACES and grade, noon): sunlit lime plaster 85-90% (never clipped), sunlit dry earth
65-75%, sunlit grass 40-50%, shadowed ground 20-30%, deepest cavity 4-8%. Night: moonlit plaster
35-45%, ground 12-18%, torch pools up to 70%.

### 3.2 Saturation budget

HSV saturation of albedo (`SATURATION_LIMITS`): large surfaces <= 0.45 (ground, walls, roofs, rock,
water), medium <= 0.60 (props, timber, foliage), accents <= 0.85 (cloth, paint, flowers, gold, team
color, banners). Grade saturation stays <= 1.10.

### 3.3 Master palette

Canonical hexes are in `palette.ts`; the families:

| Family | Swatches (sRGB) |
|---|---|
| Earth and stone (`MATERIALS`) | mud plaster `#a8835f`, lime wash `#e4dac6`, terracotta `#a65a3c`, brick `#9c5a40`, laterite `#8f4a34`, buff sandstone `#c2a985`, red sandstone `#a8604a`, polished sandstone `#cdbb9a`, granite `#8a8680`, basalt `#57534f`, thatch `#a8935e` / old `#857a62` |
| Timber and fibre | teak `#6b4a2e`, sal `#5e4631`, bamboo `#b39a63`, weathered `#80776a` |
| Water | deep `#1f3f45`, shallow `#4a7468`, monsoon silt `#5b5a3e` |
| Natural dyes (`DYES`) | undyed `#d9cdb3`, bleached `#e8e1d0`, turmeric `#d9a02c`, saffron `#d9772a`, safflower `#c2412d`, madder `#9c2f25`, lac `#8a1f24`, indigo `#2b3a6b` / light `#5a72a3`, woad green `#4f6b4a`, myrobalan olive `#8a7d3c`, catechu `#6b4630`, iron black `#2e2a28`, violet lac `#6a3a6e` |
| Mural pigments (`MURAL`) | yellow ochre `#c98f39`, red ochre `#9c3b23`, terre verte `#6f8a6a`, lapis `#2f4f8f`, lamp black `#2a2622`, kaolin `#e9e2d0`, vermilion `#c8381f`, orpiment `#e2b33c` |
| Metals (`METALS`, metalness 1) | gold leaf `#e0b54a`, old gold `#c99a3a`, bronze `#b07a4a`, aged bronze `#8c6a45`, copper `#c27a52`, iron `#8d8a86`, blackened iron `#4f4c49`, silver `#c9c6c0` |
| Skin (`SKIN_TONES`) | `#c48a63` `#a8714f` `#8f5d40` `#7a4c33` `#653d29` `#9a6a4c` (+-4% value jitter per crowd member) |
| Accents (`ACCENTS`, 3D + UI) | saffron `#e8892b`, gold `#e9b949`, indigo `#33407a`, vermilion `#d4452b`, lotus `#d98aa6`, peacock `#1f6f78`, turmeric `#e3a82b`, lapis `#2f4f8f`; selection `#ffd36b`, ally `#6fb7e8`, enemy `#e0533d`, neutral `#d8cdb5`, placement valid `#7fd27a` / invalid `#e0533d` |

### 3.4 Team color rules

- Team color covers **25-35% of a soldier's visible surface at tactical zoom**: turban/helmet cloth,
  sash, shield face, banner, horse/elephant caparison. Never skin, never weapons, never the ground.
- Cloth uses `FactionArt.clothDye` (a natural-dye version of the team primary) multiplied by the team
  mask with +-6% value variation per soldier; shields and banners use the exact team primary.
- `ZoomLook.readability.teamColorBoost` (1.0 close -> 1.35 strategic) raises value and saturation of
  team masks with distance so armies stay identifiable as they shrink.
- Environment never uses team colors except banners, painted doors of faction buildings (20% max) and
  the minimap/borders.
- Color-blind modes (`GameSettings.colorblind`) remap only the team primary (`FACTION_ART.colorblind`,
  CSS `:root[data-colorblind]`) and always add shape coding: banner emblem + relation ring style
  (`RELATION_STYLES`: own solid, ally dashed, enemy spiked, neutral dotted).
- Verified by simulation (Machado 2009 CVD matrices, CIELAB dE76): the data palette's campaign colors are
  safe for tritanopes (min dE 24.7) but **indigo (Giridurga) vs violet (Marudesha) collapse under
  protanopia (dE 4.1)**; the remaps reach min dE 20.7 (protan), 24.9 (deutan), 25.1 (tritan). See §17
  for the requested default change.

---

## 4. Lighting and atmosphere

Module: `render/style/lighting.ts`. Light scale: **clear noon sun = DirectionalLight intensity 3.4**
(the sky-bake normalization in `tools/blender/lib/sky.py`), ACES Filmic tone mapping (three.js scales by
exposure / 0.6), sRGB output. Lookdev sheet: `docs/art/lookdev_presets.jpg` (all presets, close and
tactical cameras, real PBR materials, calibrated IBL, reference height fog, post pipeline).

### 4.1 Presets (generated)

<!-- @gen:LIGHTING begin (generated from src/render/style; do not edit by hand) -->
| Preset | Sun elev/az (deg) | Sun color | Sun int. | Softness (deg) | Sky HDRI | Sky irradiance | key:fill | Exposure |
|---|---|---|---|---|---|---|---|---|
| **dawn** | 6 / 95 | `#ffc49a` | 1.9 | 0.7 | sky_dawn | 0.38 | 3 | 1.3 |
| **noon** | 62 / 170 | `#fff3e3` | 3.4 | 0.35 | sky_day | 0.75 | 4.5 | 0.8 |
| **golden** | 8 / 262 | `#ffae66` | 4.2 | 0.6 | sky_golden | 0.45 | 5 | 1.05 |
| **dusk** | -2 / 280 | `#ff9a6e` | 0.55 | 3 | sky_dusk | 0.16 | 1.6 | 1.8 |
| **night** | 42 / 150 | `#9fb6e3` | 0.55 | 0.4 | sky_night | 0.08 | 3 | 2.5 |
| **monsoon** | 50 / 180 | `#d7dde0` | 0.85 | 8 | sky_overcast | 0.5 | 1.2 | 1.3 |
| **dry_haze** | 55 / 200 | `#fff0d4` | 3 | 0.9 | sky_haze | 0.9 | 3 | 0.74 |
| **winter_fog** | 12 / 125 | `#ffe0c2` | 1.4 | 2.5 | sky_fog | 0.55 | 2 | 1.05 |

| Preset | Hemi sky / ground / int. | Fog color / inscatter | Fog density (1/m) | Height falloff (1/m) | Max opacity | Mist top m / density | Shafts |
|---|---|---|---|---|---|---|---|
| **dawn** | `#97a8c8` / `#6d5e56` / 0.32 | `#b4b2bd` / `#ffcfa6` | 0.0008 | 0.03 | 0.88 | 2 / 0.012 | 0.55 |
| **noon** | `#a9c0e2` / `#8a7458` / 0.38 | `#c3c6c2` / `#fff0d4` | 0.00018 | 0.0025 | 0.72 | 0 / 0 | 0 |
| **golden** | `#8ea2cc` / `#7a5a3e` / 0.3 | `#c9a582` / `#ffbe78` | 0.0005 | 0.006 | 0.8 | 0 / 0 | 0.45 |
| **dusk** | `#62719f` / `#4b3b3a` / 0.28 | `#7b6f82` / `#ff9d70` | 0.0005 | 0.01 | 0.82 | 1.5 / 0.008 | 0.2 |
| **night** | `#2b3654` / `#1b1813` / 0.14 | `#1c2434` / `#43506e` | 0.0004 | 0.008 | 0.85 | 1.2 / 0.006 | 0 |
| **monsoon** | `#a2abaf` / `#4c5040` / 0.55 | `#8c989a` / `#c6cecc` | 0.0011 | 0.004 | 0.88 | 3 / 0.006 | 0 |
| **dry_haze** | `#c4c2b4` / `#957a55` / 0.42 | `#cdb995` / `#fff0c8` | 0.0012 | 0.0018 | 0.78 | 0 / 0 | 0.1 |
| **winter_fog** | `#b3b8bf` / `#5c5a50` / 0.45 | `#b5b9bd` / `#ffe2c4` | 0.0022 | 0.02 | 0.86 | 4 / 0.02 | 0.7 |

| Preset | Bloom str / radius / thr (exposed) | AO int / radius m | Grade (contrast, sat, warmth, lift, vignette, tint) | LUT | Wetness | Practicals | Ambient FX (dust, mist, fireflies, leaves) |
|---|---|---|---|---|---|---|---|
| **dawn** | 0.4 / 0.6 / 3 | 0.9 / 1.4 | 1.02, 0.95, 0.1, 0.028, 0.3, [0.99, 0.98, 1.02] | lut_dawn | 0.25 | 0.25 | 0.2, 0.85, 0, 0.2 |
| **noon** | 0.22 / 0.4 / 4.5 | 1 / 1.5 | 1.05, 1.03, 0.08, 0.012, 0.24, [1, 0.995, 0.98] | - | 0 | 0 | 0.15, 0, 0, 0.25 |
| **golden** | 0.45 / 0.55 / 3.2 | 1.05 / 1.5 | 1.1, 1.07, 0.3, 0.014, 0.32, [1.03, 1, 0.95] | lut_golden | 0 | 0.15 | 0.65, 0, 0, 0.3 |
| **dusk** | 0.5 / 0.55 / 2.2 | 0.9 / 1.4 | 1.08, 1, 0.12, 0.024, 0.38, [1, 0.95, 1.04] | lut_dusk | 0.05 | 0.6 | 0.25, 0.2, 0.35, 0.1 |
| **night** | 0.6 / 0.55 / 1.4 | 0.8 / 1.2 | 1.06, 0.74, -0.25, 0.018, 0.45, [0.88, 0.95, 1.08] | lut_night | 0.1 | 1 | 0, 0.25, 0.7, 0 |
| **monsoon** | 0.2 / 0.4 / 4 | 1.15 / 1.8 | 1.04, 0.9, -0.12, 0.02, 0.34, [0.96, 1, 1] | lut_monsoon | 0.85 | 0.2 | 0, 0.5, 0, 0.4 |
| **dry_haze** | 0.3 / 0.5 / 4.2 | 1 / 1.5 | 0.98, 0.92, 0.2, 0.032, 0.24, [1.03, 1, 0.93] | lut_haze | 0 | 0 | 0.45, 0, 0, 0.15 |
| **winter_fog** | 0.35 / 0.6 / 3 | 0.85 / 1.4 | 0.97, 0.85, 0, 0.04, 0.3, [0.98, 1, 1.02] | lut_fog | 0.35 | 0.1 | 0.1, 1, 0, 0.1 |

| Preset | Nishita bake (elev/az, air, aerosol, ozone, clouds) | Preetham fallback (turbidity / rayleigh / mie / g) |
|---|---|---|
| **dawn** | 6/95, air 1.1, aerosol 2.4, ozone 1.4, clouds 0.25 | 6 / 2.2 / 0.012 / 0.86 |
| **noon** | 62/170, air 1, aerosol 1.6, ozone 1, clouds 0.18 | 3.2 / 1.6 / 0.005 / 0.82 |
| **golden** | 7/258, air 1.3, aerosol 3.2, ozone 1.2, clouds 0.38 | 8 / 2.6 / 0.009 / 0.88 |
| **dusk** | -2/280, air 1.2, aerosol 2.6, ozone 1.6, clouds 0.3 | 7 / 3 / 0.008 / 0.85 |
| **night** | -18/300, air 1, aerosol 1.2, ozone 1, clouds 0.15 | 2 / 0.6 / 0.002 / 0.7 |
| **monsoon** | 50/180, air 1.4, aerosol 4, ozone 1, clouds 0.95 | 14 / 0.9 / 0.02 / 0.6 |
| **dry_haze** | 55/200, air 1.2, aerosol 5, ozone 0.9, clouds 0.05 | 12 / 1 / 0.014 / 0.84 |
| **winter_fog** | 12/125, air 1, aerosol 6, ozone 1, clouds 0.5 | 16 / 1.2 / 0.03 / 0.9 |
<!-- @gen:LIGHTING end -->

Notes on the columns:

- *Sun color/intensity*: `color` normalized to max 1, `intensity` = `DirectionalLight.intensity`. For
  the night preset the "sun" is the moon. *Softness* = apparent angular radius for the PCSS penumbra
  (real sun 0.27 deg; haze and overcast widen it).
- *Sky irradiance* is the target horizontal irradiance of the sky dome **without the sun**. It is how
  bright the shadows are. The IBL is calibrated to it whatever the source (§4.4).
- *key:fill* = sun luminance at normal incidence / sky irradiance; QA measures it on a grey card.
- *Bloom threshold* is **exposed** luminance (scene-linear x exposure): pass `threshold / exposure` to
  `UnrealBloomPass`. 1.0 ~ a sunlit white wall; day thresholds 4-4.5 bloom only the sun, glints, fire.
- *Fog* colors are **displayed** colors; the shader mixes `fogRadiance(colorLinear, exposure)`.

### 4.2 Time of day and weather (resolver)

`resolveLighting({ sunElevationDeg, hour, season, weather })` returns a linear, blended
`ResolvedLighting`. Time of day follows the solar elevation along two tracks (`TIME_OF_DAY_TRACKS`):
morning `night@-12 -> dusk@-4 -> dawn@5 -> noon@38`, evening `night@-12 -> dusk@-4 -> golden@8 -> noon@32`
(degrees; smoothstep between keys; fog density, falloff, exposure and sky irradiance blend geometrically
so the haze never pumps). Weather overlays are then applied as multipliers and color targets (so a
monsoon night stays dark and a monsoon noon stays bright):

<!-- @gen:OVERLAYS begin (generated from src/render/style; do not edit by hand) -->
| Overlay | Sun x | Softness | Sky irr. x | Fog color | Fog density x | Falloff | Exposure x | Grade | Wetness | Bloom x | Shafts x |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **monsoon** | 0.25 | 8 | 1.2 | `#8c989a` | 4 | 0.004 | 1.3 | c 1.04 s 0.9 w -0.12 | 0.85 | 0.6 | 0.2 |
| **storm** | 0.12 | 10 | 0.85 | `#6d7779` | 6 | 0.003 | 1.45 | c 1.04 s 0.9 w -0.12 | 1 | 0.5 | 0 |
| **haze** | 0.88 | 0.9 | 0.95 | `#cdb995` | 3 | 0.0018 | 0.95 | c 0.98 s 0.92 w 0.2 | 0 | 1 | 1.2 |
| **dust** | 0.45 | 4 | 0.8 | `#b98f5e` | 9 | 0.004 | 1.1 | c 0.98 s 0.92 w 0.2 | 0 | 0.7 | 0.6 |
| **fog** | 0.5 | 2.5 | 1 | `#b5b9bd` | 10 | 0.02 | 1.15 | c 0.97 s 0.85 w 0 | 0.35 | 0.8 | 1.4 |
<!-- @gen:OVERLAYS end -->

Overlay weights: monsoon = max((cloudCover - 0.45) / 0.45, rain x 1.25); storm = 1 for `storm`;
haze = 0.85 for `hazy`, 0.45 in grishma; dust = 1 for `dust_storm`; fog = 1 for `fog`, and up to 0.45
on shishira mornings while the sun is below 25 deg. `dominant` names the preset whose baked sky and LUT
to use. Call it when the environment changes (hour step, weather roll), not per frame.

Apply (Lead Graphics, `render/environment/environment.ts`) **[ENG]**:

```ts
const r = resolveLighting({ sunElevationDeg, hour: env.hour, season: env.season, weather: env.weather });
sun.color.setRGB(...r.sunColor); sun.intensity = r.sunIntensity; sun.shadow.radius = penumbraFrom(r.sunSoftnessDeg);
scene.environmentIntensity = environmentIntensityFor(r, sourceIrradiance);   // §4.4
hemi.color.setRGB(...r.hemiSky); hemi.groundColor.setRGB(...r.hemiGround); hemi.intensity = r.hemiIntensity * (iblOn ? 0.35 : 1);
heightFog.set(fogRadiance(r.fogColor, r.exposure), fogRadiance(r.fogInscatter, r.exposure), r.fogDensity * look.atmosphere.fogDensityScale, ...);
renderer.toneMappingExposure = r.exposure; post.setGrade(r.grade); bloom.threshold = r.bloomThreshold / r.exposure;
MATERIAL_GLOBALS.wetness.value = Math.max(r.wetness, env.weather.wetness);
```

### 4.3 Hero moods (DESIGN_SPEC §11.2, generated)

<!-- @gen:MOODS begin (generated from src/render/style; do not edit by hand) -->
| Mood | Base | Hour | Overrides | DoF focus m / f-stop / max blur px | Notes |
|---|---|---|---|---|---|
| **dawn_mist** | dawn | 6.2 | `{fog:{mist:{topM:1.3,density:0.035},density:0.0012},shafts:{strength:0.75},wetness:0.45,ambientFx:{mist:1,dustMotes:0.3}}` | 4.2 / 2.8 / 10 | Waist-deep mist on the water, wet stone steps, sun shafts between chhatris; silhouettes against the bright east. |
| **golden_dust** | golden | 17.4 | `{fog:{density:0.0007},shafts:{strength:0.6},ambientFx:{dustMotes:0.9},grade:{warmth:0.34}}` | 4.2 / 4 / 8 | Raking warm light, dust motes in shafts between awnings, long blue-violet shadows, gold leaf glints. |
| **noon_haze** | dry_haze | 12.5 | `{exposure:0.72,grade:{lift:0.03}}` | 4.2 / 5.6 / 6 | Hard top light, deep eave shadows, bleached plaster, heat shimmer above flat roofs (distortion 0.002). |
| **monsoon_wet** | monsoon | 14 | `{wetness:1,ambientFx:{mist:0.6}}` | 4.2 / 4 / 8 | Puddle reflections (SSR), dripping eaves, darkened plaster with rain streaks, saturated foliage. |
| **lamp_night** | night | 21 | `{practicals:1,bloom:{strength:0.9},ambientFx:{fireflies:0.5}}` | 3.5 / 2 / 12 | Oil-lamp rows (diyas) on ghats and ledges, torch pools on streets, moonlit blue rooftops; never pitch black. |
| **incense_dim** | golden | 16 | `{fog:{color:#6a5646,inscatter:#ffcf8c,density:0.004,heightFalloff:0.15,baseHeight:0,maxOpacity:0.6},shafts:{strength:0.95,decay:0.97},exposu` | 3 / 2.8 / 10 | Smoke-filled hall, sun shafts from high windows across pillars, lamp glow on bronze, deep warm blacks. |
<!-- @gen:MOODS end -->

Districts blend moods by distance to their anchors (40 m cross-fade) through `lerpResolved`.
`resolveHeroMood(mood)` gives the linear state. The opening cinematic (§12.4) walks from `dawn_mist`
(hour 6.0) to golden morning light at the palace gate (hour 7.0).

### 4.4 Image-based lighting calibration (critical) [ENG]

Measured in the lookdev harness (32 px cube readback, sun disc masked):

| Sky source | Horizontal sky irradiance (game units) |
|---|---|
| Baked `sky_day` (manifest `ambientIrradiance`) | 0.58 |
| Baked `sky_golden` | 0.77 (normalized bake) |
| three.js Preetham, noon preset parameters | 5.4 (+ the sun disc it also contains) |
| Preetham, sun at -18 deg (night) | 3.5 - **invalid**: Preetham does not go dark below the horizon |

So the raw procedural sky is ~8x too bright for our light scale and double-counts the sun, which is why
the current hero and battle shots look washed out. Rules:

1. Remove the sun disc from the sky used for the PMREM (strip `L0 += ( vSunE * 19000.0 * Fex ) * sundisk;`
   from a cloned Sky shader); draw the visible sun as a separate HDR sprite (luminance 50, bloom and
   shaft source).
2. `scene.environmentIntensity = r.skyIrradiance / sourceIrradiance`, where `sourceIrradiance` is the
   manifest `ambientIrradiance` for baked skies or a one-off 16-32 px cube readback per PMREM bake for the
   procedural sky (cheap: once per sky change). Use the same factor for `scene.backgroundIntensity`.
3. Below -4 deg solar elevation switch to the night sky (baked `sky_night` [WP7], fallback: a two-color
   gradient zenith `#0f1326` -> horizon `#1b2236` scaled to `irradiance` 0.08, plus a moon sprite).
4. Prefer baked skies whenever assets are on; per-hour bakes (`sky_dawn`, `sky_noon`, `sky_dusk`,
   `sky_night`, `sky_overcast`, `sky_haze`, `sky_fog` - Nishita parameters in §4.1) blend in the resolver
   by `dominant` with a 2 s PMREM cross-fade.

### 4.5 Height fog and aerial perspective [ENG]

Exponential height fog with sun in-scattering replaces `FogExp2` on medium+ (low keeps `FogExp2` with
`density x 0.6`). Reference implementation (verified): `FOG_FRAG` in
`docs/art/tools/lookdev/lookdev.ts`. Per fragment:

```
ray = worldPos - cameraPos; d = |ray|; dir = ray / d; b = heightFalloff
fog = density * exp(-(cameraPos.y - baseHeight) * b) * d * (1 - exp(-dir.y * d * b)) / (dir.y * d * b)
fog += mist.density * d * fractionOfRayBelow(baseHeight + mist.topM)
alpha = min(1 - exp(-fog), maxOpacity)
color = mix(fogColor, inscatterColor, pow(max(dot(dir, sunDir), 0), inscatterPower))   // radiance
out = mix(out, color, alpha)
```

- Density is scaled by `ZoomLook.atmosphere.fogDensityScale` (0.35 strategic -> 1.25 hero).
- The sky dome gets the same fog toward the horizon (apply with `d = 20 km`, clamp 0.6) so terrain melts
  into the sky with no seam - currently the map edge shows a hard line.
- **Mist slab** (dawn, ghats, winter fields): ground-hugging extra density below `mist.topM`, broken up
  by a 2-octave world-space noise (40 m and 9 m, amplitude 0.5) scrolling with the wind at 0.3x.
- **Volumetric shafts**: screen-space radial blur of an occlusion mask from the sun position
  (`shaftsStrength`, `decay`, `density`, 48 samples high / 32 medium, half-res). Enabled when the sun is
  < 35 deg or `shaftsStrength > 0.3`; scaled by `atmosphere.shaftsScale`. Interior shafts (incense_dim)
  use authored light cards (additive, 0.15 alpha, noise-scrolled) in window openings.

### 4.6 Night and practical lights

- Night is "day for night": moonlit blue key (`#9fb6e3`, 0.55), sky irradiance 0.08, exposure 2.5,
  grade desaturated 0.74 with a cool tint. **Never pitch black at tactical zoom**: QA target ground
  luminance on screen >= 12%.
- Practical lights (`PRACTICAL_LIGHTS`): oil lamp `#ffa04a` (1.2, 4 m), torch `#ff8a3a` (6, 9 m), brazier
  `#ff7a30` (10, 12 m), burning building `#ff6a24` (40, 30 m), flicker 12-35% at 6-12 Hz (two summed
  noises). Only the nearest N per tier are real `PointLight`s (low 1 / medium 4 / high 8 / ultra 16
  torches); the rest are emissive sprites (flame luminance 8-12) that bloom. Weighted by
  `r.practicals` (0 day -> 1 night): lamps are lit from dusk.
- Diya rows on ghats and ledges, torches at gates and along the palace route, braziers in camps.
- Lightning (storm): `lightningFlash` directional `#d8e2ff` intensity 9 for 80-160 ms (double flash),
  sky dome +2 EV for the same frames, thunder 1-4 s later (audio).

### 4.7 Post stack and exposure policy

Frame order (ARCHITECTURE §19): opaque (IBL + CSM) -> GTAO -> SSR (ultra) -> transparent ->
height fog + shafts -> bloom -> DoF (hero/close) -> tone map (ACES) + grade + LUT -> TAA/SMAA -> UI.

- Exposure is authored per preset (no auto-exposure); hero interiors use the `incense_dim` mood
  (exposure 1.6) and a 0.6 s ease when crossing a threshold.
- Grade: `GRADE_PRESETS` (contrast, saturation, warmth, lift, vignette, tint) blended by the resolver,
  then a per-dominant-preset 32^3 LUT (`lut_*`, authored by the Art Director in WP7) at 35% strength on
  high/ultra for the final color "signature" (warm highlights, olive mids, blue-violet shadows).
- Film grain (luminance only, 0.015-0.025) and chromatic aberration only in close/hero bands.
- Vignette 0.24 (strategy day) to 0.45 (night/cinematic); the zoom band adds -0.04 .. +0.10.

---

## 5. Terrain and biomes

Module: `render/style/terrain.ts`. Textures: WP1. Splat material: `render/materials/splat.ts`
(4 height-blended layers, world-planar UVs, macro variation).

### 5.1 GDD §2 zones

| Zone | Look | Dominant layers | Trees | Architecture | Fog tint |
|---|---|---|---|---|---|
| Northern plains | Flat green-gold patchwork to the horizon, mango groves, big rivers with pale sandbanks, dense brick towns, dust haze | alluvial silt, farmland, lush grass, river sand | mango, banyan, peepal, neem, palmyra | heartland_brick | `#c3c6c2` |
| Western frontier | Ochre plains, white salt flats, thorny babul, wells with wheels, long hazy views | cracked earth, dry grass, salt crust, sandstone cliff | babul, wild date palm, neem | frontier_mud | `#cdb995` |
| Deccan plateau | Stepped basalt escarpments, flat-topped hills crowned by forts, black soil and red laterite, granite tors | laterite, black cotton soil, dry grass, basalt | teak, neem, banyan, palash | highland_stone | `#b9b3a6` |
| Eastern forests | Tall sal forest with light shafts, bamboo thickets, red earth paths, valley mist, elephants | forest litter, laterite, lush grass, granite | sal, bamboo, banyan, palash, mango | forest_timber | `#a8b2a2` |
| Southern peninsula [STRETCH] | Coconut coast, laterite and granite, backwaters, timber ports, humid haze | laterite, lush grass, river sand, granite | coconut, palmyra, banyan, mango | coastal_timber | `#b7c4c2` |

### 5.2 Layer library (generated)

<!-- @gen:TERRAIN begin (generated from src/render/style; do not edit by hand) -->
| Layer | Asset id | Base color | Rough | Tile m | Height bias | Normal | Porosity | Triplanar | Notes |
|---|---|---|---|---|---|---|---|---|---|
| **alluvial_silt** | terrain_alluvial_silt | `#8d7d64` | 0.92 | 4 | 0 | 0.7 | 1 | - | Fine grey-brown silt with hoof/foot prints and dried ripple marks. |
| **grass_lush** | terrain_grass_lush | `#5f6f3a` | 0.9 | 3 | 0.05 | 1 | 0.7 | - | Olive-emerald blades with clover and dark soil gaps; never lime. GPU grass blades sit on it. |
| **grass_dry** | terrain_grass_dry | `#9a8a5a` | 0.95 | 3 | 0.05 | 1 | 0.6 | - | Straw-khaki tufts with bare earth patches (grishma, scrub, plateau). |
| **farmland_tilled** | terrain_farmland_tilled | `#7e6a50` | 0.95 | 4 | 0 | 1.3 | 1 | - | Furrows 0.3 m apart along the field axis (uv rotated per plot), clods, straw stubble. |
| **paddy_mud** | terrain_paddy_mud | `#5b5443` | 0.35 | 3 | -0.05 | 0.6 | 0.2 | - | Wet glossy mud with standing-water mask (varsha); seedling rows are geometry/cards. |
| **laterite_soil** | terrain_laterite_soil | `#8e5038` | 0.93 | 4 | 0 | 1 | 0.9 | - | Iron-red gravelly soil of the plateau rim and eastern forest edge. |
| **black_cotton_soil** | terrain_black_soil | `#3e3a33` | 0.9 | 4 | 0 | 1.2 | 0.9 | - | Deccan dark clay with deep polygonal shrinkage cracks in the dry season; turns tar-black and glossy when wet. |
| **dry_earth_cracked** | ground_dry_earth | `#a88a68` | 0.92 | 4 | 0.02 | 1 | 0.9 | - | Exists (ground_dry_earth). Western frontier, grishma fields, settlement yards. |
| **river_sand** | terrain_river_sand | `#c4b18e` | 0.85 | 3 | 0 | 0.8 | 1 | - | Pale fine sand with flow ripples aligned to the river; darker wet band 1.5 m above the water line. |
| **pebbles_gravel** | terrain_pebbles | `#8c8273` | 0.75 | 2 | 0.15 | 1.4 | 0.6 | - | Rounded river pebbles 2-10 cm (fords, stream beds), angular scree under cliffs. |
| **rock_granite** | terrain_rock_granite | `#87827a` | 0.8 | 8 | 0.25 | 1.4 | 0.3 | yes | Rounded exfoliating boulders and sheets (Deccan tors), black water stains, orange lichen. |
| **rock_basalt** | terrain_rock_basalt | `#5a5650` | 0.78 | 10 | 0.25 | 1.5 | 0.4 | yes | Stepped horizontal layering (trap topography) - the plateau escarpment signature; vertical joints. |
| **rock_sandstone_cliff** | terrain_rock_sandstone | `#a88a6c` | 0.82 | 10 | 0.25 | 1.3 | 0.6 | yes | Cross-bedded buff-red strata (quarry hills near Shilapur), honeycomb weathering. |
| **forest_litter** | terrain_forest_litter | `#5a4a35` | 0.9 | 3 | 0.05 | 1.2 | 0.8 | - | Sal and teak leaf litter (large leaves 20-30 cm), twigs, dark humus; moss in varsha. |
| **road_packed_earth** | terrain_road_earth | `#9a7e5e` | 0.88 | 4 | 0.1 | 1 | 1 | - | Two cart ruts 1.4 m apart (track/road), hoof prints, dust; deep mud + puddles in varsha. |
| **flagstone_paving** | terrain_flagstone | `#a09582` | 0.78 | 4 | 0.3 | 1 | 0.6 | - | Royal roads inside cities, palace courts, ghat landings: irregular buff slabs, grass in joints. |
| **mud_wet** | terrain_mud_wet | `#4f4636` | 0.3 | 3 | -0.05 | 0.8 | 0.1 | - | Monsoon overlay layer: footprints, cart-churned ruts, puddle mask in its alpha. |
| **salt_crust** | terrain_salt_crust | `#d9d2c4` | 0.7 | 6 | 0.05 | 0.9 | 0.5 | - | The White Flats near Lavanapura: polygonal crust ridges, pink-grey tint at edges. Albedo <= 0.7. |
<!-- @gen:TERRAIN end -->

### 5.3 Blending rules

Per terrain vertex/texel (weights texture, 1 texel per 2 m on battle maps, 4 m strategic):

1. Start from the biome's `base` weights; biome borders cross-fade over 24 m (world-space noise 60 m
   wavelength, amplitude 12 m, so borders are organic, not Voronoi lines).
2. **Moisture** above `moistureToLayer0` pushes 30% weight to layer 0.
3. **Bank slope** (`bankSlope` start..end, rise/run) moves weight from layer 0 to layer 1 (terrace
   edges, river banks, bunds).
4. **Rock slope** (`rockSlope`) moves weight to layer 3 (rock, triplanar, 8-10 m tiles). The rock layer
   is shared by neighbouring biomes so cliffs are continuous across borders.
5. Height blend (`splat.ts`): `w_i' = max(0, h_i + bias_i + w_i - max_j(h_j + bias_j + w_j) + sharpness)`
   with h = ORM.r (cavity) and sharpness `heightBlend` 0.15-0.2: pebbles poke through dirt, grass fills
   cracks.
6. **Macro variation**: world-space value noise at `macro.wavelengthM` (+-`macro.strength` albedo) plus a
   second octave at 1/4 wavelength; on top, a 1 km "regional" tint (+-4% hue toward ochre or olive) so the
   strategic map never looks uniformly tinted.
7. **Distance**: beyond 250 m the splat samples one averaged layer color (`baseColor`) per layer
   (mip-biased) and the detail normal fades by `ZoomLook.material.detailNormal`.
8. **Seasons** (`SEASON_TERRAIN`): `wetMudOverlay` paints `mud_wet` into roads, yards, field edges and
   low ground (varsha 0.6); `dryGrassShift` swaps lush -> dry grass weight; `puddles` fill height-field
   cavities below a threshold with a flat mirror (roughness 0.05, darkened albedo x0.6 around the rim);
   `dust` drives ambient dust particles and the dust overlay on vertical surfaces (lower 0.4 m).

### 5.4 Biome recipes (generated)

<!-- @gen:BIOMES begin (generated from src/render/style; do not edit by hand) -->
| Biome | Layers 0-3 | Base weights | Rock slope | Bank slope | Macro m / str | Trees / shrubs / grass | Fallback color |
|---|---|---|---|---|---|---|---|
| **river** | river_sand, pebbles_gravel, alluvial_silt, rock_sandstone_cliff | 0.6 / 0.25 / 0.15 / 0 | 0.9-1.3 | 0.25-0.5 | 60 / 0.08 | 0 / 0.05 / 0.05 | `#4b5a47` |
| **floodplain** | alluvial_silt, grass_lush, river_sand, rock_sandstone_cliff | 0.45 / 0.45 / 0.1 / 0 | 0.8-1.2 | 0.2-0.45 | 140 / 0.1 | 0.12 / 0.2 / 0.9 | `#727a4c` |
| **farmland** | farmland_tilled, grass_lush, road_packed_earth, rock_sandstone_cliff | 0.7 / 0.25 / 0.05 / 0 | 0.8-1.2 | 0.15-0.35 | 90 / 0.12 | 0.06 / 0.08 / 0.4 | `#8a8449` |
| **grassland** | grass_lush, grass_dry, alluvial_silt, rock_granite | 0.6 / 0.3 / 0.1 / 0 | 0.75-1.15 | 0.25-0.5 | 180 / 0.12 | 0.1 / 0.2 / 1 | `#6d7a43` |
| **scrub** | grass_dry, dry_earth_cracked, pebbles_gravel, rock_granite | 0.45 / 0.4 / 0.15 / 0 | 0.7-1.1 | 0.2-0.45 | 120 / 0.14 | 0.06 / 0.45 / 0.5 | `#968659` |
| **dry_plain** | dry_earth_cracked, grass_dry, salt_crust, rock_sandstone_cliff | 0.65 / 0.3 / 0.05 / 0 | 0.7-1.1 | 0.2-0.45 | 220 / 0.15 | 0.03 / 0.25 / 0.3 | `#b29672` |
| **forest** | forest_litter, grass_lush, laterite_soil, rock_granite | 0.6 / 0.3 / 0.1 / 0 | 0.75-1.15 | 0.25-0.5 | 80 / 0.1 | 0.75 / 0.5 / 0.4 | `#46582f` |
| **dense_forest** | forest_litter, laterite_soil, grass_lush, rock_basalt | 0.8 / 0.1 / 0.1 / 0 | 0.75-1.15 | 0.25-0.5 | 70 / 0.08 | 1 / 0.7 / 0.2 | `#37472a` |
| **hills** | grass_dry, laterite_soil, pebbles_gravel, rock_granite | 0.5 / 0.35 / 0.15 / 0 | 0.55-0.95 | 0.3-0.55 | 160 / 0.14 | 0.2 / 0.4 / 0.6 | `#867459` |
| **rocky** | pebbles_gravel, grass_dry, laterite_soil, rock_granite | 0.4 / 0.3 / 0.3 / 0 | 0.35-0.7 | 0.2-0.4 | 120 / 0.16 | 0.05 / 0.3 / 0.3 | `#7f7467` |
| **plateau** | laterite_soil, black_cotton_soil, grass_dry, rock_basalt | 0.45 / 0.3 / 0.25 / 0 | 0.5-0.9 | 0.25-0.5 | 240 / 0.15 | 0.1 / 0.35 / 0.55 | `#9c7c57` |
| **sandbank** | river_sand, pebbles_gravel, alluvial_silt, rock_sandstone_cliff | 0.8 / 0.1 / 0.1 / 0 | 0.9-1.3 | 0.3-0.6 | 50 / 0.07 | 0 / 0.03 / 0.15 | `#cbb894` |
| **marsh** | mud_wet, grass_lush, alluvial_silt, rock_sandstone_cliff | 0.45 / 0.45 / 0.1 / 0 | 0.9-1.3 | 0.2-0.4 | 60 / 0.1 | 0.08 / 0.3 / 1 | `#56613f` |
<!-- @gen:BIOMES end -->

### 5.5 Farmland patchwork, roads, settlements

- **Fields** (`FARMLAND`): irregular plots 18-42 m, axes follow the nearest river or road with +-12 deg
  jitter per village, raised bunds 0.6 m wide x 0.35 m, 15% fallow. Crops by season (§7.4) - a village
  mixes 3-4 crops so the patchwork reads in green, gold, ochre and (shishira) mustard yellow. Field
  borders get a 1-2 m grass strip with occasional palmyra palms and babul hedges.
- **Roads** (`ROAD_STYLES`): track 2.2 m (cart ruts, 75% opacity), road 4 m, royal road 7 m flagstone
  with shade trees every 18-25 m; all roads darken and rut with mud in varsha. Road edges blend with
  grass over 0.6-1.5 m - never a hard ribbon edge.
- **Settlement ground**: inside settlements the splat switches to packed earth (`road_packed_earth`)
  with swept yards in front of houses (lighter, smoother, roughness 0.8), rice-paste floor patterns
  (`MATERIALS.ricePaste` decals, 1-2 m) at thresholds, flagstone in palace and temple courts, worn
  paths between wells, granaries and gates (desire lines). No grass inside the walls except courtyards
  and gardens.

### 5.6 Riverbanks and ghats

`RIVERBANK`: wet sand band 1.5 m above the water line (darker, roughness 0.35), dark flood-mark stain at
2.4 m on stone, kash grass with white plumes on sandbanks in sharad (density 0.6), reeds in water
shallower than 0.6 m. Ghats: steps 0.30 m rise x 0.45 m tread, a landing every 8 steps, `sandstone_buff`
darkened 35% and moss-tinted (`#4f5a3a`) below the flood mark, plus chhatri pavilions on landings and
lamp niches. Fords show pebble bars (`pebbles_gravel`) and a ripple band in the water.

---

## 6. Water

Module: `WATER_PRESETS` in `render/style/terrain.ts`.

### 6.1 Presets (generated)

<!-- @gen:WATER begin (generated from src/render/style; do not edit by hand) -->
| Water | Deep / shallow / scatter | Absorption /m | Visibility m | Rough | Normals tile/str/speed | Flow m/s | Foam | Refl. strength / glint | Notes |
|---|---|---|---|---|---|---|---|---|---|
| **river_clear** | `#1f3f45` `#4a7468` `#2e5a52` | 0.45, 0.12, 0.08 | 2.5 | 0.06 | 9+2.3 / 0.6 / 0.35 | 0.6 | 0.6 m, thr 0.7, cov 0.15 | 1 / 1 | Green-teal, sky reflections dominate at grazing angles; sandbank visible under shallows. |
| **river_monsoon** | `#4a4632` `#7a6e4e` `#6b5f42` | 0.9, 0.8, 0.7 | 0.25 | 0.14 | 7+1.8 / 0.9 / 1.1 | 1.8 | 1.4 m, thr 0.45, cov 0.35 | 0.75 / 0.4 | Opaque silt-brown, fast, floating debris (branches, leaf mats), foam lines along banks and bridge piers. |
| **tank_still** | `#1d3530` `#3f5e4c` `#294a3c` | 0.5, 0.2, 0.15 | 1.2 | 0.02 | 5+1.2 / 0.15 / 0.08 | 0 | 0 m, thr 1, cov 0 | 1.1 / 1.2 | Mirror-like; lotus pads and algae film at edges; reflections of steps are the showcase (planar on high+). |
| **ghat_shallows** | `#24453f` `#5d7f6c` `#3a6555` | 0.4, 0.12, 0.09 | 1.6 | 0.05 | 4+1 / 0.5 / 0.4 | 0.35 | 0.35 m, thr 0.8, cov 0.1 | 1 / 1.3 | Wading depth 0.3-0.8 m; splash and ripple rings from feet (VFX); floating offerings are oil lamps on leaf boats and jasmine flowers. |
| **flood_overbank** | `#5b5a3e` `#7d7652` `#706646` | 0.8, 0.7, 0.6 | 0.2 | 0.1 | 8+2 / 0.4 / 0.4 | 0.3 | 0.8 m, thr 0.8, cov 0.1 | 0.9 / 0.6 | Sheet water over fields (WeatherState.flood): crops poke through, bunds as lines, trees reflected. |
<!-- @gen:WATER end -->

### 6.2 Rendering rules [ENG]

- **Color from depth**: Beer-Lambert `T = exp(-absorption * depth)` per channel over the bed color, plus
  `scatterColor` in-scattering toward `deepColor` with depth; `visibilityM` caps how far the bed shows.
  Depth comes from the depth buffer (refraction pre-pass, high+) or from the terrain height (low).
- **Surface**: two scrolling normal maps (tile + second tile, strength, speed) along the flow direction
  (flow map from the river tangent, `flowMps`), roughness 0.02-0.14, Fresnel F0 0.02.
- **Reflection** by tier: env map (low/medium), planar for rivers in view (high, half res), SSR + planar
  fallback (ultra). Reflections of ghats, temples and torches at night are a showcase.
- **Foam**: shoreline band (`shoreWidthM`), around piers and rocks, and where flow accelerates
  (`flowThreshold`); monsoon spate adds floating debris cards (leaf mats, branches).
- **Monsoon / flood**: `river_monsoon` (opaque silt brown, fast) blends in with `weather.flood`;
  `flood_overbank` sheets over low fields with crops poking through and trees reflected.
- **Interaction**: ripple rings (hero feet, rain drops, wading soldiers), splashes at fords, wakes
  behind boats (ultra: displacement; others: normal decals).

---

## 7. Vegetation and crops

Module: `render/style/vegetation.ts`. Assets: WP4.

### 7.1 Trees (generated)

<!-- @gen:TREES begin (generated from src/render/style; do not edit by hand) -->
| Species | Zones | Height m | Crown m | Bark | Leaf vas/gri/var/sha/hem/shi | Foliage gri | Flowering | Wind trunk/branch/leaf (Hz) | Tris LOD0/1/2 | Silhouette |
|---|---|---|---|---|---|---|---|---|---|---|
| **Banyan** (*Ficus benghalensis*) | NP DP EF SP | 14-22 | 28-50 | `#7d7466` | `#46602e` `#4f6232` `#3a5a2a` `#3d5c2b` `#445e2e` `#47602f` | 0.95 | - | 0.004@0.15 / 0.12@0.35 / 0.02@2.2 | 16000 / 4500 / 900 | Very wide low dome, flat underside 4-6 m above ground, dark interior; village meeting tree with a stone platform (chabutra). |
| **Peepal** (*Ficus religiosa*) | NP DP EF SP | 14-24 | 14-24 | `#8a8276` | `#8a6a3e` `#55703a` `#4a6a30` `#4b6a31` `#53703a` `#5a7340` | 1 | - | 0.006@0.18 / 0.14@0.4 / 0.05@4.5 | 14000 / 4000 / 800 | Tall open irregular crown, light through gaps; heart-shaped leaves with drip tips that tremble in the lightest wind; copper-pink new leaves in vasanta. |
| **Neem** (*Azadirachta indica*) | NP WF DP SP | 10-16 | 9-14 | `#5a4a3c` | `#6a8a3c` `#5f7c37` `#4f7330` `#517431` `#587835` `#5c7a38` | 0.9 | vasanta `#e8e2c8` 0.15 | 0.008@0.22 / 0.16@0.5 / 0.03@3 | 9000 / 2800 / 600 | Rounded open crown of fine feathery leaflets, brighter green than mango; lines streets and courtyards. |
| **Sal** (*Shorea robusta*) | EF NP | 22-34 | 8-13 | `#4f4033` | `#9aa04e` `#7a7a3a` `#3f5f2a` `#41612b` `#4f6a30` `#7d7a42` | 0.7 | vasanta `#e3dcb0` 0.2 | 0.003@0.12 / 0.1@0.3 / 0.025@2 | 10000 / 3000 / 600 | Tall columnar trunks with a high narrow crown; forests read as vertical rhythm with a canopy roof 25-30 m up. |
| **Teak** (*Tectona grandis*) | DP EF | 18-28 | 8-12 | `#7a6a58` | `#8a7e45` `#8c6a3a` `#4d6b30` `#557334` `#6f7438` `#8a7840` | 0.15 | varsha `#ece6d2` 0.25 | 0.005@0.16 / 0.14@0.38 / 0.05@1.6 | 8000 / 2500 / 500 | Huge leaves (40-60 cm) on an open crown; bare and brown in grishma, white flower plumes in the monsoon. |
| **Mango** (*Mangifera indica*) | NP EF SP | 9-15 | 11-18 | `#4a3c30` | `#3a5428` `#33502a` `#2f4c26` `#304d27` `#334f28` `#3a5a2e` | 0.95 | shishira+vasanta `#b9a35a` 0.3 | 0.004@0.18 / 0.1@0.4 / 0.02@2 | 10000 / 3000 / 600 | Dense dark dome to the ground; planted in orderly groves (amrakuta) beside villages - deep pools of shade. New flushes copper-red. |
| **Palmyra palm** (*Borassus flabellifer*) | NP DP SP | 15-25 | 5-7 | `#3e3934` | `#4e6640` `#5a6c45` `#465f3a` `#47603b` `#4d6540` `#506842` | 0.95 | - | 0.01@0.2 / 0.3@0.6 / 0.06@2.5 | 3500 / 1200 / 300 | Tall black pole with a tight ball of stiff fan leaves - exclamation marks along field bunds and tanks. |
| **Coconut palm** (*Cocos nucifera*) | SP | 12-22 | 7-10 | `#7a6e60` | `#5c7a38` `#647a3c` `#527234` `#547435` `#587638` `#5c783a` | 0.95 | - | 0.015@0.2 / 0.45@0.55 / 0.08@3 | 3500 / 1200 / 300 | Curved trunk, drooping feather fronds; coast and river mouth only (Naukapattana). |
| **Wild date palm** (*Phoenix sylvestris*) | WF NP | 8-14 | 5-8 | `#6e5f4e` | `#6a7a4c` `#727a50` `#5f7446` `#607547` `#66784a` `#6a7a4c` | 0.95 | - | 0.012@0.22 / 0.35@0.6 / 0.06@2.8 | 3000 / 1000 / 300 | Shorter palm with a dense dusty grey-green fan of feather fronds; wells and caravan stops. |
| **Babul (thorn acacia)** (*Vachellia nilotica*) | WF DP NP | 5-10 | 6-10 | `#3a302a` | `#6b7a44` `#7d7e4c` `#566e3a` `#5a713c` `#647543` `#6b7a46` | 0.8 | varsha+sharad `#e8c33a` 0.2 | 0.006@0.25 / 0.12@0.6 / 0.02@3 | 6000 / 1800 / 400 | Flat-topped umbrella of fine foliage on a dark twisted trunk - the frontier and scrub silhouette. |
| **Palash (flame of the forest)** (*Butea monosperma*) | DP EF NP | 7-12 | 6-9 | `#5d5146` | `#6e6a3a` `#6d7a3e` `#4d6b30` `#4f6c31` `#6d7038` `#7d7440` | 0.7 | vasanta `#e2571e` 0.85 | 0.006@0.24 / 0.12@0.5 / 0.04@2 | 6000 / 1800 / 400 | Leafless crooked crowns blazing orange-red in spring - the strongest seasonal accent of the forest edge (use as 3-6% of trees). |
| **Amaltas (golden shower)** (*Cassia fistula*) | NP DP EF SP | 8-14 | 6-10 | `#6e6458` | `#5f7a38` `#7a8a3e` `#4d6d2f` `#4f6e30` `#587234` `#5e7638` | 0.6 | grishma `#f0c42e` 0.7 | 0.007@0.22 / 0.14@0.5 / 0.04@2.4 | 6000 / 1800 / 400 | Hanging chains of yellow flowers in the hottest month - palace gardens, temple precincts. |
| **Bamboo clump** (*Dendrocalamus strictus / Bambusa*) | EF DP SP | 9-16 | 5-9 | `#8a8a4a` | `#8a9a50` `#a0a05a` `#5c7a3a` `#5f7c3c` `#73833f` `#869048` | 0.7 | - | 0.03@0.3 / 0.4@0.7 / 0.05@3.5 | 7000 / 2200 / 500 | Fountain of arching culms, feathery and light; strongest wind motion of all species; creaks (audio). |
<!-- @gen:TREES end -->

Zone codes: NP northern plains, WF western frontier, DP Deccan plateau, EF eastern forests, SP southern
peninsula. Leaf colors are per season (vasanta, grishma, varsha, sharad, hemanta, shishira).

### 7.2 Modeling recipe (Blender, WP4)

1. **Trunk and branches**: scripted space-colonization or recursive branching (3-4 orders) as curves ->
   mesh with radius taper (Leonardo's rule: child radii^2 sum = parent radius^2); bark from a tiling
   bark set per species family (fig smooth grey, furrowed dark, fibrous light, palm ringed).
   Banyan: 6-20 prop-root pillars + hanging aerial-root alpha cards.
2. **Foliage**: leaf clusters as alpha-tested cards (4-8 leaves per card), cards oriented outward from the
   branch with +-35 deg jitter; card normals bent outward from the crown center (spherical normal
   transfer) so the crown shades as a volume, not as flat cards.
3. **Leaf atlas** per species: 4x4 leaf clusters (front + back variation, flowers/new leaves as
   separate cells), baseColor+alpha, normal (vein relief), translucency (leaf thickness) in ORM.b.
   Two-sided, translucency 0.35 (subsurface color = leaf color x1.4 toward yellow), alpha cut 0.5 with
   alpha-to-coverage on MSAA tiers.
4. **Vertex data for wind**: R = branch hierarchy level (0 trunk..1 tips), G = per-branch phase,
   B = leaf flutter mask; A = baked AO (crown interior darker, 0.35 at the core).
5. **LODs**: LOD0/1/2 per `tris`, then an 8x8 octahedral impostor (hemi-octahedral for ground-level
   views) with baseColor+alpha and normal+depth, 256 px frames on ultra (`VEGETATION_LOD`).
6. Seasonal states are color/foliage parameters on one mesh (`leaf[season]`, `foliage[season]` scales
   card alpha threshold so deciduous crowns thin out), never separate meshes; flowering swaps atlas cells
   for `flowering.coverage` of the cards.

### 7.3 Wind (vertex shader, `WIND`)

Hierarchical, per instance phase-jittered:
`trunk bend = trunkAmp * wind * (0.7 + 0.3 * gust(t, gustPeriodS 6.5)) * h^2` (h = normalized height),
`branch = branchAmp * wind * sin(2 pi branchFreqHz t + phase) * R`,
`leaf = leafAmp * sin(2 pi leafHz t + 13 * phase + uv.x * 7) * B`. Grass and crops add traveling field
waves (`fieldWaveLengthM` 28 m, speed 0.9 x wind speed) - the wheat field "breathing" in golden light is
a key image. Storms multiply by 1.8 with turbulence. Peepal leaves flutter at 4.5 Hz even in light wind.

### 7.4 Crops and ground plants (generated)

<!-- @gen:CROPS begin (generated from src/render/style; do not edit by hand) -->
| Crop | Height m | Row m | vasanta | grishma | varsha | sharad | hemanta | shishira | Notes |
|---|---|---|---|---|---|---|---|---|---|
| **Rice (kharif)** | 1 | 0.25 | `#7e6a50` 0 | `#8a7456` 0 | `#7fa043` -1 | `#b8a24e` 1 | `#a8945c` 0.15 | `#7e6a50` 0 | Flooded paddies with bright seedling rows in varsha (reflections!), gold heads in sharad, stubble and straw stacks in hemanta. |
| **Wheat (rabi)** | 0.9 | 0.2 | `#c9a75a` 1 | `#a8946a` 0.1 | `#6d7a42` 0 | `#7e6a50` 0 | `#7d8a46` 0.25 | `#6f8a40` 0.65 | Blue-green in shishira, gold waves in vasanta (wind waves read strongly), sheaves and threshing at harvest. |
| **Barley (rabi)** | 0.8 | 0.2 | `#c4ae6a` 1 | `#a8946a` 0.1 | `#6d7a42` 0 | `#7e6a50` 0 | `#7a8a48` 0.25 | `#748c48` 0.65 | Paler, bristly heads; mixed with wheat. |
| **Millet (jowar/bajra)** | 2.2 | 0.5 | `#8a7456` 0 | `#8a7456` 0 | `#5d7a36` 0.6 | `#9a8a4a` 1 | `#a8946a` 0.2 | `#7e6a50` 0 | Tall stalks with brown-red seed heads; uplands and plateau. |
| **Sugarcane** | 2.8 | 0.9 | `#6f8a44` 0.4 | `#7a8a48` 0.6 | `#557a34` 0.85 | `#5d7a38` 1 | `#6d7d44` 1 | `#7a8048` 0.3 | Dense tall green walls near tanks and rivers; cane-crushing yards in hemanta. |
| **Cotton (tree cotton)** | 1.5 | 0.8 | `#7e6a50` 0 | `#7e6a50` 0 | `#5d7a3a` 0.5 | `#6a7a44` 0.85 | `#d8d2c2` 1 | `#8a8060` 0.2 | Bushy plants with white bolls in hemanta; pickers with baskets. |
| **Mustard (rabi)** | 1.3 | 0.3 | `#9a9a4a` 0.8 | `#8a7456` 0 | `#6d7a42` 0 | `#7e6a50` 0 | `#6f8a44` 0.4 | `#e8c838` 1 | Electric yellow carpets in shishira - the brightest field color; keep to 10-20% of plots so it accents. |
| **Sesame** | 1.1 | 0.4 | `#7e6a50` 0 | `#7e6a50` 0 | `#5f7c3c` 0.6 | `#6f7a44` 1 | `#a8946a` 0.2 | `#7e6a50` 0 | Upright plants with pale pink-white bell flowers in sharad. |
| **Lentils & chickpea** | 0.45 | 0.3 | `#9a8e5a` 1 | `#8a7456` 0 | `#6d7a42` 0 | `#7e6a50` 0 | `#6f8448` 0.4 | `#6a8648` 0.8 | Low blue-green carpets; purple-white flowers in shishira. |

| Ground plant | Height m | Sharad color | Wind bend | Notes |
|---|---|---|---|---|
| **Doob grass** (*Cynodon dactylon*) | 0.08-0.25 | `#5a7036` | 0.35 | GPU grass field: 3-blade clumps, 6-10 cm wide cards; base darker (AO) and tips lighter. |
| **Kash grass (white plumes)** (*Saccharum spontaneum*) | 1.5-3 | `#e8e4da` | 0.5 | Riverbank and sandbank stands; silver-white plumes in sharad that glow in backlight - signature autumn image. |
| **Reeds & bulrush** (*Phragmites / Typha*) | 1.2-2.5 | `#5c743c` | 0.45 | Shallow water < 0.6 m and marsh; brown seed heads. |
| **Lotus** (*Nelumbo nucifera*) | 0.1-1.2 | `#4c6b37` | 0.2 | Pads (0.4-0.8 m) flat on tanks and stepwells, pink #e08aa8 / white flowers held above water in varsha-sharad. |
| **Aak (milkweed)** (*Calotropis procera*) | 1-2.5 | `#82967c` | 0.1 | Waxy grey-green shrub of wasteland and roadsides, lilac flowers. |
| **Ber thorn scrub** (*Ziziphus mauritiana*) | 1.5-4 | `#5a6d3c` | 0.15 | Thorny bushes used as field hedges and fort glacis thorn belts. |
<!-- @gen:CROPS end -->

Rice in varsha is a mirror: flooded paddy (`paddy_mud` + water plane 5-10 cm) with seedling rows.
Mustard in shishira is the brightest field color - keep it to 10-20% of plots.

### 7.5 Placement rules

- Banyan/peepal: village centers, crossroads, temple yards, ghats - usually with a stone platform.
- Mango groves: orderly rows 10-12 m apart beside villages; neem along streets and in courtyards.
- Palmyra: along field bunds and tanks, 3-7 per hectare of farmland. Palash/amaltas: 3-6% of trees,
  forest edges and gardens. Bamboo: stream banks and forest margins.
- Forests: canopy cover 70-90% (dense forest) with clearings; light shafts are the point.
- Nothing grows on roads, in settlement yards, on ghats, within 3 m of walls (fort glacis is cleared
  and thorn-belted).

---

## 8. Architecture

Palettes: `ARCHITECTURE_STYLES` in `render/style/factions.ts`; materials: `MATERIAL_PRESETS` in
`render/style/materials.ts`; kit and landmarks: WP2 and WP3 in `ASSET_LIST.md`.

### 8.1 Grammar

| Rule | Value |
|---|---|
| Placement grid | 4 m settlement cells (DESIGN_SPEC §8.2); every footprint a multiple of 4 m; kit sub-modules 1 m and 2 m |
| Storey height (floor to floor) | hut eave 2.2-2.4 m; house 3.0 m; mansion 3.6 m; palace hall 6-9 m |
| Plinth | village 0.3 m earth; town 0.45 m brick; temple/palace 0.9-1.8 m stone with 3-5 moldings (torus, fillet, lotus) |
| Wall thickness | mud 0.45 m; brick 0.45-0.6 m; stone 0.6-0.9 m; fort walls see §8.6 |
| Doors | village 0.9 x 1.9 m; town 1.2 x 2.4 m; palace 2.4 x 4 m (timber leaves, bronze studs) |
| Windows | small and few (0.5 x 0.8 m) with timber lattice; upper floors get balconies (jharokha-like timber oriels with railings) |
| Roofs | thatch 40-50 deg; terracotta tile 25-30 deg; flat with 0.6 m parapet (frontier, highland); **wagon-vault** roofs with horseshoe gable ends (chaitya arch) on halls, gates and elite houses - the period's signature silhouette |
| Eaves | overhang 0.6-0.9 m, **+15% for readability** at strategic zoom; deep shadow lines under every eave |
| Finials | terracotta pots (village), kalasha in gilded copper (temples, palace), trident or wheel (faction buildings); +20% size (AoE IV chunkiness) |
| Ornament tiers | village: painted mandana borders (ochre/white), terracotta finials; town: carved timber brackets, bead-and-reel lintels, lotus medallions; elite: vedika railings, toranas, polished pillars, gilded finials, gavaksha (chaitya-arch) gable windows |
| Irregularity | 2-6 deg rotation jitter per building, +-5% scale jitter on houses, never two identical neighbours (variant x material tint x prop dressing) |

Readability rules (AoE IV): every building type has one unique silhouette feature visible at 700 m
(granary: raised vaulted bin on posts; barracks: long hall + drill yard + weapon racks; stable: open
long shed + hay; market: canopied stalls in a ring; temple: tall shikhara; stupa: dome; palace: tiered
pavilion roofs; workshop: kiln/chimney or loom yard; harbor: jetty + boats; watchtower: tall timber
frame). Light values on walls (lime, buff stone) against mid-dark roofs (tile, thatch, slate).

### 8.2 Material library (generated)

<!-- @gen:MATERIALS begin (generated from src/render/style; do not edit by hand) -->
| Preset | Asset id | Base color | Rough (range) | Metal | Normal | Porosity | Tile m | Extras | Notes |
|---|---|---|---|---|---|---|---|---|---|
| **sandstone_carved_red** | sandstone_carved_red | `#a8644c` | 0.78 (0.62-0.92) | 0 | 1 | 0.8 | 2 | - | Exists (2 m sheet). Retune: -12% saturation, per-block hue jitter +-3%, lichen and soot in lower 0.6 m via macro map. |
| **sandstone_red_ashlar** | sandstone_red_ashlar | `#a46450` | 0.8 (0.66-0.92) | 0 | 0.8 | 0.8 | 3 | - | City-state walls and gates. 0.45 x 0.9 m blocks, 4 mm joints, iron-oxide spotting (Sikri type). |
| **sandstone_buff** | sandstone_buff | `#c2a985` | 0.76 (0.6-0.9) | 0 | 0.9 | 0.75 | 2 | - | Default heartland stone: stupas, ghats, plinths, toranas. Grey-buff with faint pink banding and black lichen. |
| **sandstone_polished_mauryan** | sandstone_polished_mauryan | `#cdbb9a` | 0.18 (0.1-0.32) | 0 | 0.25 | 0.15 | 2 | clearcoat 0.6/0.12 | Mirror polish of monolithic pillars and capitals: a signature of the empire. Faint speckle, no joints; dust only on horizontal ledges. |
| **granite_rubble** | granite_rubble | `#8a8680` | 0.82 (0.7-0.95) | 0 | 1.2 | 0.4 | 3 | - | Deccan hill forts: irregular dry-laid blocks 0.3-0.9 m, deep dark joints, orange lichen on upward faces. |
| **basalt_dressed** | basalt_dressed | `#57534f` | 0.7 (0.5-0.88) | 0 | 0.9 | 0.5 | 3 | - | Chaitya arches and highland gates: chisel-dressed dark basalt, smoother where hands touch, white salt bloom at the base. |
| **laterite_block** | laterite_block | `#8f4a34` | 0.9 (0.8-0.98) | 0 | 1.3 | 0.9 | 2 | - | Pitted vesicular red-brown blocks 0.6 x 0.3 m: parapets, bastions, southern walls. |
| **stone_slab_roof** | stone_slab_roof | `#7c7770` | 0.85 (0.72-0.95) | 0 | 1 | 0.5 | 3 | - | Overlapping granite slabs on highland houses; moss in overlaps. |
| **lime_plaster_weathered** | lime_plaster_weathered | `#e4dac6` | 0.86 (0.75-0.95) | 0 | 0.6 | 0.85 | 3 | - | Never pure white: warm off-white with rain streaks, rising damp (0-0.8 m darker, green-grey), patches revealing brick (5-12%). |
| **mud_plaster** | mud_plaster | `#a8835f` | 0.94 (0.86-1) | 0 | 0.8 | 1 | 2.5 | - | Hand-smoothed swirls (finger arcs 0.2 m), straw fibres, cracks; ochre/white mandana borders as decals. |
| **mud_brick_sundried** | mud_brick_sundried | `#a88866` | 0.95 (0.88-1) | 0 | 1.1 | 1 | 2 | - | 0.4 x 0.2 x 0.1 m bricks, eroded arrises, mud mortar flush; frontier and village walls. |
| **brick_fired_old** | brick_fired_old | `#9c5a40` | 0.84 (0.7-0.95) | 0 | 1 | 0.8 | 2 | - | Large period bricks 0.42 x 0.26 x 0.07 m (wide, flat), lime mortar 8 mm, efflorescence and soot near the ground. |
| **roof_tile_terracotta** | roof_tile_terracotta | `#a65a3c` | 0.72 (0.55-0.88) | 0 | 1.2 | 0.7 | 2 | - | Flat grooved tiles with hooked lips (not curved Mediterranean pan tiles), lichen in rows, broken tiles 3%. |
| **thatch_grass** | thatch_grass | `#a8935e` | 0.96 (0.9-1) | 0 | 1.4 | 0.9 | 2 | - | Combed bundles 0.25 m, bound with rope bands every 0.6 m; ages to grey #857a62 on the weather side. |
| **thatch_palm** | thatch_palm | `#9c8a5c` | 0.9 (0.8-0.98) | 0 | 1.2 | 0.8 | 2 | - | Overlapping woven fronds (coast, forest); shingle rhythm 0.3 m, dark gaps. |
| **timber_teak_carved** | timber_teak_carved | `#6b4a2e` | 0.62 (0.45-0.8) | 0 | 1 | 0.5 | 2 | - | Trim bands: plain beam, lotus bracket, bead row, creeper scroll, column shaft with bell capital; oiled sheen on worn edges. |
| **timber_sal_weathered** | timber_sal_weathered | `#5e4631` | 0.8 (0.65-0.92) | 0 | 1.1 | 0.7 | 2 | - | Palisades, forest halls, scaffolds: adze marks, open grain, silvering on the weather side. |
| **timber_weathered_grey** | timber_weathered_grey | `#80776a` | 0.88 (0.78-0.96) | 0 | 1.2 | 0.8 | 2 | - | Frontier doors, carts, old jetties: split checks, nail-free pegged joints. |
| **bamboo_lattice** | bamboo_lattice | `#b39a63` | 0.55 (0.4-0.75) | 0 | 0.8 | 0.4 | 1.5 | - | Scaffolds (lashed with coir rope), fences, walls; nodes every 0.3-0.4 m, glossy skin, split lath variant. |
| **gold_leaf** | - | `#e0b54a` | 0.28 (0.18-0.45) | 1 | 0.4 | 0 | 1 | - | Finials (kalasha), howdah fittings, royal shields. Rubbed through to red bole on edges; use sparingly (<1% of frame). |
| **bronze_aged** | - | `#8c6a45` | 0.45 (0.3-0.7) | 1 | 0.5 | 0 | 1 | - | Lamps, bells, vessels, helmets: polished highs, dark brown-green cavities (no bright verdigris). |
| **iron_forged** | - | `#5a5754` | 0.55 (0.35-0.8) | 1 | 0.6 | 0.1 | 1 | - | Blades, spear points, scale armor: hammer facets, bright edge bevel, rust only in pits. |
| **copper_vessel** | - | `#c27a52` | 0.35 (0.22-0.6) | 1 | 0.4 | 0 | 1 | - | Water pots (lota), market wares; darker tarnish where hands do not polish it. |
| **lacquer_red** | - | `#7d2420` | 0.4 (0.3-0.6) | 0 | 0.3 | 0.2 | 1 | clearcoat 0.4/0.3 | Chariots, palanquins, palace doors; worn to wood on edges. |
| **cotton_undyed** | cloth_cotton | `#d9cdb3` | 0.92 (0.85-1) | 0 | 0.6 | 0.9 | 0.5 | sheen 0.4, sss `#e8dcc2` 0.15 | Hand-spun weave visible only in hero mode; dirt gradient on hems. |
| **cotton_dyed_team** | cloth_cotton | `#d9772a` | 0.9 (0.82-0.98) | 0 | 0.6 | 0.9 | 0.5 | sheen 0.3 | Team color = FactionArt.clothDye x mask; uneven natural dyeing (+-6% value) so armies do not look plastic. |
| **silk_court** | cloth_silk | `#b0482c` | 0.42 (0.3-0.6) | 0 | 0.4 | 0.6 | 0.5 | sheen 0.9 | Nobles and the hero: woven gold borders (zari-like bands via trim), anisotropic look approximated with sheen. |
| **leather_tanned** | - | `#7a5236` | 0.62 (0.45-0.8) | 0 | 0.7 | 0.5 | 0.5 | - | Belts, quivers, shield rims, horse tack; darker and glossier where handled. |
| **hide_shield** | - | `#9c6b44` | 0.7 (0.55-0.85) | 0 | 0.8 | 0.6 | 1 | - | Tall bamboo-framed hide; painted faction emblem (emblems.ts) with chipped paint, never a clean decal. |
| **skin** | - | `#9a6a4c` | 0.55 (0.4-0.7) | 0 | 0.6 | 0.3 | 1 | sss `#c0503a` 0.45 | Tone from palette SKIN_TONES; sweat sheen +0.15 gloss in grishma and battle; sandal paste / ash marks only on priests. |
| **elephant_skin** | elephant_skin | `#6e6660` | 0.82 (0.7-0.95) | 0 | 1.4 | 0.8 | 1 | - | Deep wrinkle normal, pink depigmentation freckles on the trunk and ears, mud-caked legs (lower 0.8 m warmer, rougher). |
| **horse_coat** | horse_coat | `#6a4a33` | 0.5 (0.4-0.65) | 0 | 0.5 | 0.4 | 1 | sheen 0.5 | Variants bay #6a4a33, chestnut #8a4f2c, grey #a8a39c, black #2a2421, dun #a88a5e; darker points (legs, mane). |
| **ox_hide** | horse_coat | `#b8ad9c` | 0.65 (0.5-0.8) | 0 | 0.6 | 0.5 | 1 | - | White-grey zebu with darker hump and neck; painted horns (ochre/indigo) for festive carts. |
<!-- @gen:MATERIALS end -->

### 8.3 Architecture styles (generated)

<!-- @gen:STYLES begin (generated from src/render/style; do not edit by hand) -->
| Style | Wall / wall2 / roof / trim / stone / wood / paint | Material sets | Signature pieces | Look |
|---|---|---|---|---|
| **heartland_brick** | `#e4dac6` `#9c5a40` `#a65a3c` `#d4a537` `#c2a985` `#6b4a2e` `#d9772a` | lime_plaster_weathered, brick_fired_old, roof_tile_terracotta, sandstone_buff, sandstone_polished_mauryan, timber_teak_carved | palace, pavilion, pillar, stupa, granary | Lime-plastered fired brick, terracotta tile roofs, buff sandstone plinths and polished pillars, carved teak verandas. |
| **highland_stone** | `#8a8680` `#8f4a34` `#57534f` `#8c5f34` `#8a8680` `#5e4631` `#2b3a6b` | granite_rubble, basalt_dressed, laterite_block, stone_slab_roof, timber_sal_weathered | fort_wall, fort_gate, tower, stepwell, shrine | Dry-laid granite and basalt, laterite parapets and bastions, flat stone-slab roofs, rock-cut chaitya arches. |
| **coastal_timber** | `#e4dac6` `#6b4a2e` `#a65a3c` `#b06a3b` `#c2a985` `#6b4a2e` `#1c7f8a` | lime_plaster_weathered, timber_teak_carved, thatch_palm, roof_tile_terracotta, brick_fired_old | harbor_jetty, market_stall, tower | Whitewashed timber-frame warehouses on brick plinths, palm-thatch and tile roofs, jetties and lamp towers. |
| **forest_timber** | `#a8835f` `#5e4631` `#a8935e` `#8c5f34` `#8f4a34` `#5e4631` `#3f7f52` | timber_sal_weathered, bamboo_lattice, thatch_grass, thatch_palm, mud_plaster | palisade, stable, pavilion | Raised sal-timber halls with carved posts, bamboo lattice walls, steep palm-leaf and grass thatch, earthen plinths. |
| **frontier_mud** | `#a8835f` `#c08a3e` `#a8835f` `#a65a3c` `#c2a985` `#80776a` `#6a3a6e` | mud_brick_sundried, mud_plaster, sandstone_buff, timber_weathered_grey | well, market_stall, tower | Thick sun-dried mud-brick, flat roofs with parapets, ochre-washed walls with white mandana borders, well-wheels and caravan yards. |
| **city_sandstone** | `#a8604a` `#c2a985` `#a8604a` `#d4a537` `#a8604a` `#6b4a2e` `#9c2f25` | sandstone_carved_red, sandstone_red_ashlar, roof_tile_terracotta, timber_teak_carved | fort_gate, tower, mansion, workshop | Red sandstone ashlar walls and gate towers, carved brackets, jali screens, tiled roofs, painted gates. |
<!-- @gen:STYLES end -->

### 8.4 Building kit (dimensions)

| Piece (`ArchitectureKind`) | Footprint m | Height m | Form and signature | Materials (heartland -> others via style) |
|---|---|---|---|---|
| `thatch_hut` | 4 x 4 (round 3.6 dia) | 4.2 | Round mud walls 2.2 m, conical thatch 45 deg, low door, painted base band | mud_plaster, thatch_grass |
| `mud_house` | 8 x 4 | 4.6 | Rectangular, veranda on 4 timber posts, thatch or flat roof, courtyard wall | mud_plaster, thatch, timber_sal |
| `brick_house` | 8 x 8 | 6.5 (2 storeys) | Courtyard house: blank outer walls, inner veranda, tile roof, timber balcony, rooftop terrace | brick_fired_old, lime_plaster, roof_tile |
| `mansion` | 12 x 16 | 9 | Two courtyards, gatehouse with wagon-vault roof, carved timber facade, jharokha balconies | lime_plaster, timber_teak_carved, roof_tile, sandstone_buff plinth |
| `granary` | 12 x 16 | 9 | Raised bins on 1.2 m posts or a brick podium with vent slits, vaulted roof, ramps, weighing yard | brick, timber, thatch/tile |
| `stupa` | 20 x 20 (asset 25.2) | 11.7 | Exists (`stupa_sanchi`) - dome, drum, vedika, torana, harmika, chhatras; retune to buff stone (§15) | sandstone_buff + lime_plaster dome |
| `shikhara_temple` | 16 x 16 | 18-22 | [Stylization] Curvilinear tower on a 1.5 m plinth, amalaka + kalasha, entrance porch (mandapa) with pillars | sandstone_buff carved trim, lime wash, gilded kalasha |
| `shrine` | 4 x 4 | 3.5-5 | Village/roadside shrine: small cella with wagon-vault roof, red-ochre smeared stone, bell, flags | brick, lime, red ochre |
| `palace` | 40 x 40 | 14-18 | Raised citadel platform, pillared audience hall, tiered timber pavilions with wagon-vault roofs, chhatris at corners, gardens, gate | sandstone_polished_mauryan pillars, timber_teak_carved, roof_tile, gold finials |
| `chhatri` | 4 x 4 | 6 | Domed pavilion on 4 pillars [stylization: early form = umbrella pavilion with wagon-vault or flat roof] | sandstone_buff |
| `pavilion` | 8 x 8 | 7 | Open pillared hall (mandapa), timber roof, railing | timber, tile, stone plinth |
| `fort_wall` / `fort_gate` / `tower` | segment 8-12 m | 4-12 by level | See §8.6 | by level |
| `ghat` | 16 x 12 | -4 to +2 | Steps to water (0.30 x 0.45 m), landings, chhatris, lamp niches, flood marks | sandstone_buff (wet + moss below flood line) |
| `stepwell` | 12 x 20 | -10 | [Stylization] Terraced shaft of flights and landings with pillared galleries, still water | sandstone_buff, basalt in the highland |
| `well` | 4 x 4 | 2.6 | Brick ring with timber frame, pulley, pots; frontier: bucket-and-rope with a counterweighted lever (shaduf) - no Persian wheels | brick, timber |
| `market_stall` | 4 x 4 | 3.2 | Timber frame, cloth canopy (dyed, 30% team-neutral colors), goods dressing (pots, sacks, textiles, copper) | timber, cloth, props |
| `barracks` | 16 x 24 | 6 | Long hall with veranda, drill yard with weapon racks, standard pole | brick/mud, tile/thatch |
| `stable` | 16 x 20 | 5.5 | Open shed rows, hay stacks, water troughs; elephant stables 24 x 28 x 9 m with massive posts and chains | timber, thatch |
| `workshop` | 12 x 12 | 5 | Courtyard with kiln (potters), forge (smiths), looms (weavers) - chosen per settlement resource | mud/brick, thatch |
| `pillar` | 2 x 2 | 9-14 | Monolithic polished pillar, bell capital, abacus with lotus/geese frieze, animal or wheel crown | sandstone_polished_mauryan |
| `harbor_jetty` | 12 x 24 | 2 | Timber piles and deck, mooring posts, small cargo boats, warehouse | timber_weathered, brick |
| `bridge` | span 10-20 m | 4 | Timber trestle on stone piers (Setu Bridge: 9 piers, railings, toll gate) | timber_sal, granite |
| `palisade` | segment 8 m | 4.5 | Sharpened sal logs 0.3 m dia, lashed, earth bank | timber_sal_weathered |
| `field_plot` | 24 x 24 | 0-2.8 (crops) | Bunded plot with crop cards (§7.4), bird-scaring rattles on poles, field hut | terrain + crops |

LOD budgets per piece: see `ASSET_LIST.md` WP2/WP3 (house 2-6k tris LOD0, 600-1.5k LOD1, 150-400 LOD2;
landmarks <= 120k / 30k / 6k).

### 8.5 Construction stages, upgrades, damage (AoE layer)

| Progress (DESIGN_SPEC §8.2) | Visual |
|---|---|
| 0-0.10 Foundation | Stakes and string lines on the footprint (0.5 m stakes every 2 m, white string), trench 0.4 m deep (darker earth decal), material piles: brick stacks (0.6 x 0.6 x 0.5 m), timber logs, stone blocks, sand heap |
| 0.10-0.60 Scaffolding | Bamboo scaffold cage: 3-4 m poles on a 1.5 m bay grid, ledgers every 1.8 m, diagonal braces, coir lashings, ladders, plank platforms. Walls rise with progress using a **course-reveal clip** (world-y clip at `progress / 0.6 x wallHeight` with a +-0.15 m noisy top edge so the top course looks laid, not sliced) |
| 0.60-1.00 Roofing | Roof frame (rafters) appears, then roof material fills from eaves to ridge; scaffold removed at 95% (poles drop in 0.5 s) |
| 1.00 Complete | Dust puff ring (2 s), banner hoisted on landmark/faction buildings, bell chime (audio) |

- Builders: villagers with `work` clips (hammer, carry headload, climb, mix mortar) at 2-8 per site.
- **Upgrades** wrap the existing building in scaffold (no demolition) and swap meshes at 100%.
- **Damage** (condition < 0.5): charred decals around openings, missing roof tiles/thatch holes, smoke
  plume (thin, grey-brown), cracks; < 0.2: partial collapse variant (walls 40-60%, rubble piles, exposed
  rafters). Burning: fire VFX + `burningBuilding` light. Repairs reuse the scaffold stage.
- **Ages** change the *grade* of the same building types (WP2):
  - Janapada (age of clans): mud, thatch, timber; round huts; palisades; painted ornament.
  - Mahajanapada (great realms): fired brick, tile, carved timber, brick walls with bastions, stone
    plinths, first polished pillars.
  - Samrajya (empire): dressed stone, polished sandstone, gilded finials, stone walls and gate complexes,
    paved royal roads with shade trees. Key buildings with age variants: house, granary, barracks,
    market, temple, walls/gates/towers, assembly hall (village sabha -> raja's hall -> palace).

### 8.6 Walls, gates, towers (DESIGN_SPEC §8.6)

| Level | Wall | Towers / bastions | Gate | Silhouette |
|---|---|---|---|---|
| L1 Janapada | Earth rampart 4 m high, 10 m base, grassed; sal-log palisade 4.5 m on the crest; ditch 6 m | Timber watch towers 8 m every ~2 segments | Timber gate tower pair 9 m with a wagon-vault roof bridge | Spiky, organic, warm brown |
| L2 Mahajanapada | Fired-brick (heartland) / laterite (highland) curtain 7 m high, 4 m thick, 1:6 batter, rectangular merlons with rounded tops | Semi-circular bastions 10 m dia, 9 m high, every 30-40 m | Twin towers 11 m, timber gate leaves with iron studs, trabeated (post-and-lintel) gateway, no true arches | Red/ochre bands, rhythmic bastions |
| L3 Samrajya | Dressed stone 9 m (buff sandstone / granite / red sandstone by style), moat 12 m | Square/semi-circular bastions 12 m with roofed fighting galleries | Gate complex with barbican court, 14 m towers, carved lintel, banners | Pale, massive, crisp shadow lines |

Damage per segment: hairline cracks (decal) -> chunks missing from merlons -> breach (wall cut down to
1-2 m with a rubble ramp both sides, dust). Siege presentation: siege camps of hide tents, timber rams
under hide roofs (hide `#8a6a4c`), ladders, mantlets; no counterweight trebuchets or gunpowder.

### 8.7 Landmarks (DESIGN_SPEC §8.5; the tallest silhouette in their settlement, faction banner 2.4 x 4.2 m)

| Faction | Landmark | Height m | Visual spec |
|---|---|---|---|
| Suvarna | Hall of a Hundred Pillars | 18 | 48 x 48 m stone plinth (2 m, 5 moldings), 10 x 10 polished sandstone pillars 9 m with bell capitals, timber roof with a central wagon-vault ridge, gilded kalasha row; saffron awnings |
| Suvarna | The Royal Granary | 14 | 40 x 24 m brick granary on a stepped podium with vent slits, three wagon-vault roofs, ramps with ox-cart queues, edict pillar at the entrance |
| Suvarna | Pillars of the Spoken Law | 22 | Paved square with vedika railing: four 14 m polished pillars (bull, elephant, horse, 8-spoke wheel capitals) around an 18 m central pillar with a gilded wheel |
| Suvarna | The Great Road | 12 | 12 m stone torana at the capital's road exit, milestone pillars and rest houses (dharmashala) along royal roads; roads within 2 links become paved and tree-lined |
| Giridurga | Oath Stone of the Seven Clans | 10 | Hilltop platform with seven basalt standing stones (4-6 m) around a carved oath stone, a 10 m lamp pillar (dipa stambha) lit at night |
| Giridurga | The Cliff Cistern | 9 (+12 deep) | Rock-cut stepped tank 30 x 30 m cut into the hill, chaitya-arch niches, aqueduct channel; pavilion above |
| Giridurga | Citadel of a Thousand Steps | 26 | Three tiers of laterite/basalt walls climbing the hill, zig-zag stair, 20 m gate tower, bastions; torches at every turn |
| Giridurga | Assembly Caves of the League | 16 | Rock-cut chaitya facade in a cliff: 14 m horseshoe arch window with timber-rib screen, pillared veranda, carved railing friezes; interior ribbed vault with one light shaft (hero interior) |
| Nilavana | Elephant Grove of Gajavana | 15 | Sacred grove enclosure around a giant banyan, carved sal-timber elephant stables, raised pavilion with a steep three-tier thatch roof |
| Nilavana | The Canopy Watch | 24 | Timber watch towers in the canopy linked by rope bridges, central lookout platform with banners |
| Marudesha | Caravanserai of the Salt Road | 10 | 44 x 44 m mud-brick courtyard with 10 m corner towers, timber verandas (no arcades), central well-wheel, camels and salt sacks |
| Marudesha | Beacon Line of the Western Passes | 16 | Master stone beacon tower with an iron fire basket and smoke, chain of smaller beacons on the hills |
| Samudra | Lamp Tower of the River Mouth | 22 | Tapered brick-and-stone tower on a jetty with a fire cage, boats moored around |
| Samudra | Hall of the Guilds | 14 | Two-storey timber hall with guild banners around a warehouse court |
| Kotanagara | The Coin House | 12 | Red sandstone mint with a wagon-vault roof, punch-marked coin emblem on the gate, guarded courtyard |
| Kotanagara | Engineers' Arsenal | 18 | Workshop yard with timber cranes, rams and siege towers under construction, timber stacks |

### 8.8 Settlement layout rules (procedural layout + hand-dressed capitals)

| Kind (radius) | Walls | Street pattern | Districts and focal points | Density / green |
|---|---|---|---|---|
| Capital (200 m) | L2-L3 ring + moat, cardinal gates on royal roads | Loosely orthogonal: royal cross-streets (10 m) + lanes (3-4 m) bending with terrain | Palace citadel on high ground; temple precinct; bazaar on the main street; ghats on the river; granary quarter near the river gate; arms yard; artisans' lane (DESIGN_SPEC §11.2) | 40% built; 15% green (courtyard trees, groves, palace garden); 3-6 banyan/peepal landmarks |
| City (150 m) | L1-L2 ring | One main crossroads, market square | Market, temple, mansions, granary, barracks | 35% built, 12% green |
| Town (110 m) | Palisade or partial wall | One main street + lanes | Market, temple/shrine, granary at the edge | 30% built |
| Fort (110 m) | Dominant walls (L2-L3), glacis cleared and thorn-belted | Ring road inside the wall | Barracks, granary, cistern/stepwell, few houses, gate complex | 25% built |
| Village (70 m) | Thorn hedge, no wall | Organic cluster, paths to well, tank and fields | Banyan/peepal + platform, well or tank, threshing floors, cattle pens, shrine | 20% built; fields radiate 200-400 m |
| Port | Partial wall | Shore road | Jetties, warehouses, lamp tower, boatyards, ghats | 35% built |
| Temple town | Low precinct walls | Pilgrim way to the temple and ghats | Temple, ghats, rest houses, market | 30% built |

Every settlement has smoke from cooking fires (2-6 thin plumes at dusk), laundry and cloth drying on
ghats, cattle, carts, and villagers per DESIGN_SPEC §8.3. Owner banners on gates and the landmark.

---

## 9. Characters, animals and vehicles

Assets: WP5 (crowds, villagers, animals, vehicles) and WP6 (hero, rivals, NPC kit).

### 9.1 Proportions

| Body | Height | Heads | Notes |
|---|---|---|---|
| Crowd adult male | 1.70 m | 7.5 | Shoulders 0.44 m; hands and feet +10% for silhouette readability |
| Crowd adult female | 1.58 m | 7.5 | Shoulders 0.38 m |
| Hero / champions | 1.74-1.86 m (`appearance.scale`) | 8 | Heroic but not superhero: shoulders 0.48 m, lean |
| Child | 1.1-1.3 m | 5.5 | |
| Horse (period breed, small) | 1.45 m at withers | - | Length 2.2 m; no stirrups; saddle cloth + girth |
| War elephant (Asian bull) | 3.0 m at shoulder | - | Length 5.5 m incl. trunk; tusks 0.9 m (some tuskless) |
| Zebu ox | 1.4 m at hump | - | Painted horns |

### 9.2 Silhouette sheet (readable at 200 m, `UnitVisualDef`)

| Class | Silhouette signature | Kit (meters) | Team color on |
|---|---|---|---|
| Spearmen (Padati) | Forest of upright spears over a wall of man-high shields | Bamboo spear 3.2 (iron leaf blade 0.25); tall rectangular hide shield 1.4 x 0.55, slightly curved; quilted cotton jacket; turban | turban, sash, shield face |
| Archers (Dhanvin) | Bows taller than the men, quivers, loose spacing, no shields | Bamboo longbow 1.8 (braced against the foot to draw - signature shoot clip), cane arrows 0.9, quiver; bare torso + uttariya crossed | turban, sash, quiver flap |
| Royal Guards (Maula) | Crested helmets + round shields + glint of scale | Iron scale vest, conical helmet with crest 0.3 m, straight sword 0.75 m, round shield 0.6 dia with boss | crest, shield ring, sash |
| Horsemen (Ashvaroha) | Horse + lance | Lance 2.8, sword, padded jacket, turban; horse saddle cloth | saddle cloth, turban, lance pennon |
| Chariots (Ratha) | Two big wheels + standard on a pole | Two-wheeled car 1.2 x 1.0 m, rail 0.9 m, wheels 1.3 dia, 16 spokes, 2 horses (4 for royal), driver + archer, standard 3 m | standard, car paint band, horse plumes |
| War Elephants (Gaja) | Huge mass + low railed platform + banner | Quilted caparison to the knees, bells, iron-capped tusks, low railed platform 0.6 m rail for 2 archers [stylization of the later howdah], mahout on the neck with an ankusha | caparison, platform hanging, banner |
| Engineers (Vishti) | Tool shapes and loads | Axes, mattocks, baskets on heads, coiled rope, ladder pairs, timber on shoulders | head-cloth, sash |
| Scouts (Charaka) | Light riders with fluttering pennants | Light horse, javelins 1.5, small round shield 0.45, streamer pennant | pennant, sash |
| Supply Train (Shakata) | Ox cart with a hooped mat canopy | Cart bed 2.6 x 1.5, spoked wheels 1.4 dia, hooped bamboo-mat canopy 1.6 high, grain sacks, 2 zebu oxen | canopy flag, wheel paint |

### 9.3 Faction schemes (generated)

<!-- @gen:FACTIONS begin (generated from src/render/style; do not edit by hand) -->
| Faction (id) | Team primary / secondary / accent | Cloth dye / 2nd | Garment base | Metal / trim | Banner | Architecture | Colorblind P / D / T |
|---|---|---|---|---|---|---|---|
| **Suvarna Kingdom** (heartland) | `#e0801f` / `#f2cf63` / `#7a1f1f` | `#d9772a` / `#d9a02c` | `#e8e1d0` | `#b07a4a` / `#e0b54a` | sun on swallowtail, trident, tassels | heartland_brick | `#e69f00` / `#e69f00` / `#e0442b` |
| **Giridurga Confederacy** (highland) | `#2c4fa3` / `#a9c1ea` / `#e9b949` | `#2b3a6b` / `#5a72a3` | `#c9bfa8` | `#4f4c49` / `#c99a3a` | mountain on notched, lamp | highland_stone | `#0072b2` / `#0072b2` / `#1b3f8b` |
| **Nilavana Kingdoms** (forest) | `#2f8f5b` / `#b5db9a` / `#d9a441` | `#3f7f52` / `#d9a02c` | `#cbbf9f` | `#8c6a45` / `#c99a3a` | elephant on pennant, spear, tassels | forest_timber | `#006e50` / `#006e50` / `#7fd1a0` |
| **Marudesha Principalities** (frontier) | `#7d3c98` / `#d7b8e8` / `#2b2b2b` | `#6a3a6e` / `#2e2a28` | `#d6c6a6` | `#8d8a86` / `#c9c6c0` | chevron on streamer, crescent_horns | frontier_mud | `#cc79a7` / `#cc79a7` / `#f2a2c0` |
| **Samudra League** (maritime) | `#1c8c99` / `#9fd8cf` / `#f0e2b6` | `#1c7f8a` / `#9fd8cf` | `#e8e1d0` | `#c27a52` / `#b07a4a` | wave on square, disc | coastal_timber | `#56b4e9` / `#56b4e9` / `#2c2c2c` |
| **Kotanagara City-States** (citystates) | `#b03a2e` / `#e6a79e` / `#e9b949` | `#9c2f25` / `#e6a79e` | `#d8cbb0` | `#8d8a86` / `#e0b54a` | tower on fringed, disc, tassels | city_sandstone | `#7f2704` / `#7f2704` / `#8c510a` |

| Faction | Look | Silhouette signature (200 m) |
|---|---|---|
| **Suvarna** | Gangetic court: bleached cotton, saffron turbans and sashes, maroon and gold elephant caparisons, polished buff stone and lime-plastered brick, timber pillared halls. | Tall saffron turbans with a forward knot; man-high hide shields painted with the golden sun; swallowtail standards. |
| **Giridurga** | Deccan hill clans: indigo quilted jackets, iron caps, round shields with white peaks, basalt and granite forts with laterite parapets. | Low rounded iron caps, round shields, quilted short coats that widen the torso; notched rectangular banners. |
| **Nilavana** | Eastern forest realm: leaf-green and turmeric cloth, cane shields, long bows, carved sal timber and palm thatch, elephants garlanded with jasmine and leaf garlands. | Woven cane shields, long bamboo bows taller than the archer, leaf-crest headbands; triangular pennants with tassels. |
| **Marudesha** | Caravan princes of the salt road: long wrapped head-cloths in violet and black, tie-dyed shawls, horse tack with silver studs, flat-roofed mud-brick and well-wheels. | Tall wrapped head-cloths with a trailing tail, light riders, long streamer banners that read the wind. |
| **Samudra** | River-mouth merchants: sea-teal sashes over white cotton, copper fittings, whitewashed timber warehouses, palm-thatch and lamp towers. | Broad conical palm-leaf hats on archers, small round shields, square sail-like flags. |
| **Kotanagara** | Walled guild cities: crimson tunics, iron scale for guards, red sandstone gates and towers, coin and gate motifs, engineers with ropes and timber. | Scale-armored guards with tall crested helmets, square shields, fringed banners hung from a crossbar. |
<!-- @gen:FACTIONS end -->

### 9.4 Costume and materials

- **Garments** (draped, unstitched for most): *antariya* (lower cloth, knee-length for soldiers,
  ankle-length for nobles), *uttariya* (upper shawl, worn crossed, over one shoulder or as a veil),
  *kayabandh* (waist sash, the main team-color carrier), *ushnisha* (turban with a large frontal knot -
  Sanchi relief style for nobles; smaller wraps for soldiers), quilted cotton jackets for armor,
  leather belts and baldrics, iron/bronze scale for guards. Feet bare or in simple sandals.
- **Jewelry**: large disc earrings (*kundala*), torques and bead necklaces, armlets (*keyura*),
  bangles; gold for nobles (gold_leaf / goldOld), bronze and bead for commoners. Rule: jewelry is the
  only "sparkle" on characters - keep it small and bright (roughness 0.25-0.35).
- **Women**: antariya + uttariya + bead girdle (*mekhala*), hair in a low bun with flowers or a gold pin,
  uttariya as veil for court women; no blouses of later cut.
- **Materials**: cotton (roughness 0.9, sheen 0.4), silk (roughness 0.42, sheen 0.9), quilted cotton
  (normal-mapped stitching 4 cm diamonds), leather (0.62), iron (metal, 0.55), skin with subsurface
  (`MATERIAL_PRESETS.skin`), hair (anisotropic approximation: sheen + roughness 0.45).
- **Wear**: dirt gradient on hems and feet (+0.15 roughness, -12% value in the lower 0.3 m), sweat sheen
  in grishma and in battle, mud splashes in varsha.

### 9.5 Hero, rivals, NPCs (WP6)

| Character | Height | Look | Materials / props |
|---|---|---|---|
| **Kumara Aditya** (hero) | 1.74 m (scale 1.02) | Saffron silk uttariya with gold border trailing (cloth secondary motion), cream antariya, maroon-and-gold sash, saffron turban with gold band and jeweled frontal knot, gold kundala, bronze armlets; combat variant adds a leather lamellar cuirass with bronze rivets and bracers | Straight khadga sword with leaf-shaped tip (0.8 m), scabbard; silk, cotton, gold, bronze, leather, skin SSS, hair |
| **Vira Durjaya** (rival champion) | 1.86 m (scale 1.1) | Barefoot, indigo antariya hitched for fighting, bare scarred torso with white clay line marks on the arms, topknot with indigo band, heavy iron armlets | Forward-curved blade, round iron-bossed shield with the seven peaks (phase 3: shield thrown away) |
| **Kumari Meghavati** | 1.62 m (0.97) | Indigo uttariya as veil, gold borders, sky-blue antariya, gold lamp pendant | Bamboo staff with bronze lamp finial |
| **Hired Blade** | 1.70 m | Brown/black cloth, face cloth, leather bracers | Short sword + knife |
| **Raider Spearman** | 1.70 m | Undyed cotton, hide shield, leather cap | Spear 2.6 m |
| **Raider Archer** | 1.68 m | Dark wraps, quiver | Short self bow 1.4 m |
| **Raider Captain** | 1.82 m | Dark red sash, iron scale vest, iron helmet with cheek guards | Heavy curved sword (two-handed swings telegraphed) |
| **22 NPCs** (`HERO_CHARACTERS`) | per `appearance.scale` | Modular kit: body bases {noble, warrior, priest, merchant, farmer, scholar, guard, envoy, child} x {male, female}, garment and accent colors snapped to the nearest `DYES` entry, headgear {none, turban, crown (gold diadem with frontal ornament), helmet, veil, topknot}, props {staff, ledger (palm-leaf manuscript bundle), sword, mace, bow, lamp, scroll (palm-leaf), basket, spear} | Rani Vasumati in white with maroon; Devavarman in plum and gold with a diadem; priests in unbleached cotton with a sacred thread and ash/sandal marks |

### 9.6 Animation style

- **Weight first**: anticipation and follow-through on every action; heels plant; spears and banners lag
  (secondary motion via bone chains or vertex animation on the pole tip).
- **Crowd clips** (VAT, 15 fps, standard names in `tools/blender/lib/anim.py`): idle, walk, run, attack,
  shoot (archers brace the bow tip on the ground), hit, die, dead, brace (spears leveled, shields locked),
  charge, rout (shields dropped, looking back), cheer, work. Phase-randomized per soldier, speed-matched
  to movement (no foot sliding: stride length walk 0.75 m, run 1.4 m).
- **Villagers**: walk, carry_headload, carry_pole (yoke with two pots), farm_hoe, harvest_sickle,
  sow_broadcast, build_hammer, build_carry, climb, sit_idle, talk (custom clips use the `x_` prefix).
- **Hero** (DESIGN_SPEC §11.7 frame data): idle, walk, run, sprint, turn_l/turn_r (in-place 90/180),
  interact, talk, attack_combo_1/2 + attack (light 3 finisher), attack_heavy (+ charge loop `x_heavy_hold`),
  dodge (roll, 0.55 s), block (loop), parry, hit, stagger, die, `x_salve`, `x_lockon_strafe` (strafe_l/r).
  Root motion for lunges and rolls; hit-stop freezes pose for the listed ms; motion blur on weapon trail
  only.
- **Animals**: horse walk/trot/canter/gallop/idle/rear/die; elephant walk/run (amble)/idle (ear flap,
  trunk curl)/trumpet/charge/panic/die; ox walk/idle/pull.

### 9.7 Readability at RTS zoom

- **Rim**: fresnel rim in sun color, `readability.unitRim` (0.3 strategic -> 0 hero).
- **Outlines**: screen-space, only for hover (1.5-3 px, `#ffd36b` at 60%) and selection (relation color);
  never permanent outlines on everything.
- **Selection rings / footprints**: ground decals following terrain, 2.5 px line, relation style
  (`RELATION_STYLES`); footprint fill 8% of the team color; formation card (class icon + short name +
  strength and morale meters with 25% notches) floating 3 m above the standard.
- **Order markers**: move = gold chevron arrows along the path + ghost footprint at the destination;
  attack = red crossed-swords marker pulsing on the target; rally point = small banner pin with the
  faction emblem; waypoint pins numbered; routing formations show backward arrows and a fallen standard.
- **Health on hover**: strength bar above the card (4 px tall, 40 px wide at 1080p).
- **Projectile arcs**: volleys draw faint additive trails (alpha 0.35) so arcs read at 700 m.

---

## 10. VFX

Budgets by tier: `QualitySettings.particles` (low 400 / medium 1,200 / high 3,000 / ultra 6,000) and
`weatherParticles`. All particles are soft (depth fade 0.5 m), lit by the sun and ambient (no unlit
white puffs), and use flipbooks from WP7.

| Effect | Look | Numbers |
|---|---|---|
| Marching / hoof dust | Ground-colored (sample the splat albedo, lighten 15%), low and wide, drifts downwind | 1-2 m puffs, life 2.5 s, alpha 0.25; cavalry and chariots 2x; elephants heavy puffs |
| Construction dust | Ochre puffs at the work face, completion ring | 3 m ring, life 2 s |
| Arrows | Cane shaft 0.9 m, fletching, iron head; motion stretch; faint arc trail at distance | Instanced (exists); trail alpha 0.35; stuck arrows stay 30 s |
| Fire | 8x8 flipbook, `#fff2c0 -> #ffb040 -> #e2571e`, emissive 6-12 | Building fire 3-8 m, torch 0.3 m |
| Smoke | Soft grey-brown `#4a4038` base, sun-lit tops, wind sheared | Plumes 10-40 m, life 8-15 s |
| Embers | Additive sparks `#ffb040`, rise and swirl | 1-2 s, 20-80 per fire |
| Rain | Streaks 1.5-3 cm x 30-60 cm in a 30 m camera volume, angled by wind; splashes on ground; ripples on water and puddles; drips from eaves (hero) | `weatherParticles`; wetness 0.85-1 |
| Mist | Large soft sprites + the fog mist slab; drifting at 0.3x wind | Dawn, ghats, winter fields |
| Fireflies | `#d8ff7a` blinking (0.5-2 Hz) near water and trees | Dusk/night, 30-200 |
| Dust motes | Tiny bright specks visible only inside light shafts | golden_dust, incense_dim |
| Leaves / petals | Falling sal and peepal leaves, palash petals (vasanta), kash seeds (sharad) | 20-60 near the camera |
| Heat shimmer | Screen distortion above hot roofs and roads | grishma noon, amplitude 0.002 |
| Melee (hero) | `slash_spark`: orange-gold sparks + weapon arc trail; `heavy_dust`: ground ring + debris; `parry_flash`: gold radial flash 120 ms + sparks; `finisher_burst`: saffron-gold burst + dust shockwave; water spray in the shallows | Hit-stop and shake per DESIGN_SPEC §11.7 |
| Elephant panic | Dust cloud + trumpet + shaking platform banner | |
| Lightning | Branching bolt sprite 80-160 ms + sky flash (§4.6) | Storms |

### 10.1 Low-gore stance

No blood decals, no dismemberment, no corpse piles. Hits read through dust puffs, cloth flutter,
sparks on metal, stagger and sound. The fallen slump and stay until the battle ends (crowd LOD), then
fade; hero-mode enemies slump and drop their weapon (DESIGN_SPEC §11.7). Burning buildings, broken
carts, fallen standards and riderless horses carry the drama.

---

## 11. UI art style

Tokens: `src/ui/theme.css` (owner: Art Director); components: `src/ui/base.css` (Lead UI/UX). Living
style guide: `docs/art/ui_kit.html` (serve the repo root; `?cb=protan|deutan|tritan` previews the
color-blind remaps). Renders: `docs/art/ui_kit.jpg`, `docs/art/ui_kit_phone.jpg`.

### 11.1 Look

Lacquered indigo-black panels framed in gold leaf; saffron for the one primary action; parchment for
documents (event cards, chronicle, dialogue choices, statistics); carved sandstone for age-up and
landmark cards. Ornament vocabulary is early-historic only: lotus medallions, bead-and-reel,
torana arches, jali lattice, punch-mark symbols - never Mughal arches or later motifs.

### 11.2 Tokens (highlights)

| Group | Tokens |
|---|---|
| Palette | `--c-saffron #e8892b`, `--c-saffron-deep #a8490f`, `--c-gold #e9b949`, `--c-gold-soft`, `--c-gold-dim`, `--c-indigo #2c3470`, `--c-lacquer #1b1830`, `--c-vermilion`, `--c-madder`, `--c-lotus`, `--c-peacock`, `--c-turmeric`, `--c-ivory #f6ecd6`, `--c-parchment #efe0bd`, `--c-sandstone`, `--c-ink #24160f` |
| Semantic | `--ui-panel` (indigo lacquer gradient), `--ui-panel-light` (parchment), `--ui-border #c99a3b`, `--ui-text #f3e8cf`, `--ui-text-dim`, `--ui-text-faint`, `--ui-positive #8ccf72`, `--ui-warning`, `--ui-danger #ec5a40`, `--ui-info` |
| Game | `--rel-own/ally/enemy/neutral`, `--res-grain/timber/stone/wealth/labor/manpower`, `--faction-<id>` (+ `:root[data-colorblind]` remaps), `--meter-strength/morale/fatigue` |
| Type | `--font-display` Tiro Devanagari Sanskrit, `--font-body` Mukta; sizes `--fs-xs 12` .. `--fs-title clamp(36px, 7vw, 80px)`, `--fs-text 16` for prose |
| Shape / motion | `--radius-*`, `--shadow-panel/raised/pressed`, `--glow-gold/saffron/danger`, `--focus-ring`, `--dur-fast 120ms / med 220 / slow 420`, `--ease-out` (reduced motion -> 0 ms) |
| Components | `--btn-*`, `--panel-*`, `--tooltip-*`, `--scroll-*` |
| Ornaments / icons | `--ornament-corner/divider/torana/jali/paper/bullet`, `--icon-*` (21 icons), `--emblem-*` (9 emblems) - generated from `render/style/emblems.ts` by `docs/art/tools/gen-theme-icons.ts` |

### 11.3 Typography

- **Display: Tiro Devanagari Sanskrit** (Tiro Typeworks; made for Sanskrit scholarship): titles,
  headings, buttons, names, numbers in titles. Title: 0.26 em tracking, uppercase only for the logo
  and small section labels. Italic for epigraphs and chronicle quotes.
- **Body: Mukta** (Ek Type, Mumbai): labels, prose, numbers (tabular lining figures enabled on
  `#ui-root`). 400 body, 600 values, 700 short caps codes (SPR, ARC...).
- Shipped locally (`src/render/style/fonts`, SIL OFL 1.1, latin subsets, 117 KB total) - no third-party
  font requests; the single-file build inlines them.
- Minimum sizes: 12 px labels, 13-14 px body on phones, 16 px prose (events, dialogue), 19 px+ headings.

### 11.4 Frames, icons, emblems

- Panel: indigo lacquer gradient + jali lattice at 7% + 2 px gold border + lotus-medallion corners
  (`--ornament-corner`, top-left and bottom-right) + inner gold hairline. Dividers: lotus padma with
  bead tails. Modal and mission titles: `.title-torana` (torana arch above the heading).
- Icons: single-color SVG masks (`.icon.icon-<id>`, inherit `currentColor`) - resources (sheaf, logs,
  block, coins, villager, spear), tactics (wheel, coins, sword, lotus, eye), stats (crown, scroll) and the
  nine unit classes (`icon-unit-*`). Flat, bold, readable at 16 px; resource icons tinted with `--res-*`.
- Emblems: faction heraldry from the blazons in `src/data/factions.ts` (`emblems.ts` `EMBLEMS`,
  `emblemSvg`, `bannerSvg`, `.emblem.emblem-<pattern>` masks, `.faction-chip`). See
  `docs/art/emblems_icons.png`.

### 11.5 States and components

| State | Treatment |
|---|---|
| Default button | Indigo lacquer gradient, gold 1.5 px border, inner top highlight |
| Hover (pointer only) | Gold glow `--glow-gold`; never the only way to reveal information |
| Active / toggled | Burnished bronze gradient + gold glow |
| Pressed | 1 px down, scale 0.98, `--shadow-pressed` |
| Disabled | 45% opacity, no glow, cursor default, tooltip says why |
| Focus (keyboard) | `--focus-ring` (gold ring with a dark gap), always visible |
| Primary | Deep saffron gradient (`--btn-primary-bg`), ivory text (>= 4.5:1 over the body of the button) |
| Danger | Madder gradient, ivory text; Stone (`.btn.stone`): sandstone with ink text (age-up) |
| Tabs, command-card slots, kbd hints, badges, meters with 25% notches, cards, tooltips, lotus lists | Skins in `theme.css` (see the UI kit) |

### 11.6 Mobile and accessibility

- Touch targets >= 44 px (`--touch-min`), 48 px for frequent actions (`--touch-comfort`); command-card
  slots 56 px; safe-area insets on every edge panel.
- Contrast (WCAG): ivory on lacquer 14.1:1, dim text 8.9:1, faint text 5.2:1, gold titles 9.4:1, ink on
  parchment 12.8:1, madder titles on parchment 5.6:1, danger text 5.0:1, ivory on deep saffron 4.97:1.
- Motion: `prefers-reduced-motion` zeroes UI transitions; the game's `reducedMotion` setting should also
  set `<html data-reduced-motion>` (§17).
- Color is never the only signal: meters have notches, relations have ring styles, factions have
  emblems, states have icons.

---

## 12. Camera and composition

### 12.1 RTS camera

Pitch and FOV follow the zoom bands (§2.1): strategic 58 deg / 38 deg FOV, operational 52 / 40,
tactical 46 / 42, close 26 / 45 (the camera tilts toward the horizon as it zooms in so close-ups show
sky and silhouettes, AoE IV-style). Zoom is exponential (each wheel notch x1.18), pans scale with
distance, rotation free on PC (Q/E or drag), snapped to 45 deg steps on double-tap for phones. Near
clip 0.5 m (close) to 5 m (strategic). Never let the horizon cut through a settlement's landmark at the
default framing: the default tactical yaw puts the sun behind-left of the camera (3/4 light).

### 12.2 Hero camera (DESIGN_SPEC §11.8)

Distance 4.2 m explore / 5.5 m combat, height 1.65 m, right shoulder 0.55 m, FOV 50 / 58 deg,
collision pull-in with a 0.2 s ease, auto-recenter after 2 s. DoF from `HERO_MOODS[mood].dof`
(focus on the hero, f/2-5.6, max blur 6-12 px), grain 0.025. Lock-on frames hero and target on the
thirds. Dialogue: over-the-shoulder two-shot at 1.4 m, 2.39:1 letterbox, f/2.8 with the speaker sharp.

### 12.3 Composition rules (cutscenes, photo-mode framing, loading screens)

- Thirds, with the subject against the brightest part of the frame (sky, sunlit wall, water).
- Frame within frame: toranas, colonnades, banyan roots, gate arches, foreground foliage in soft focus.
- Leading lines: ghat steps, roads, rivers, railings, ranks of spears.
- Three depth planes (dark foreground, warm subject, pale background) - the fog does the rest.
- Low camera (0.6-1.2 m) for heroic beats, high crane for scale; slow moves (dolly 0.5-1.5 m/s), no
  shaky cam except impacts.

### 12.4 Opening cinematic ("The Walk to the Hall", DESIGN_SPEC §11.3)

c1 aerial over the sangam in `dawn` with the mist slab (topM 4) and shafts; c2 crane down to the ghats
(`dawn_mist`, diyas still lit, practicals 0.4); c3 tracking behind Aditya stepping off the barge (DoF
f/2.8); c4 the walk - mood blends ghats -> granary (`noon_haze` is too hot for 6:30; use `dawn` with
dust) -> bazaar (`golden_dust` at low intensity) -> temple -> palace; c5 low angle of the shikhara
against the sunrise (contre-jour, bloom on the kalasha); c6 over-the-shoulder at the palace gate;
c7 close-up of Rani Vasumati (key from the gate opening, fill 1:3).

---

## 13. Quality tiers - what scales, what never changes

Never changes: palette, grade and LUT, fog colors and height-fog shape, silhouettes, team colors,
banner emblems, UI. Mobile must look like the same game in a smaller window.

| Feature | low | medium | high | ultra |
|---|---|---|---|---|
| Textures (asset tier) | 512 | 512 | 1024 | 2048 |
| Shadows | 1024, 1 cascade, hard | 2048, 2 cascades, PCF | 4096, 3 cascades, PCSS-style | 4096, 4 cascades + contact shadows |
| AO | baked (vertex/macro AO only) | baked | GTAO half | GTAO full |
| Fog | FogExp2 (density x0.6) | height fog | height fog + mist noise | + volumetric shafts full res |
| Shafts | off | half-res 24 samples | half-res 32 | 48 samples |
| Bloom | off (emissive x1.3) | on | on | on + lens dirt |
| Reflections | env map | env map | planar (rivers) | SSR + planar |
| DoF / grain / CA | off | off | hero + cutscenes | all close bands |
| Grass | off (terrain color) | 18 blades/m^2 | 40 | 70 |
| Trees | impostors beyond 90 m | LOD1 beyond 35 m | full chain | full chain, longer LOD0 |
| Soldiers | VAT LOD1 + impostors | VAT LOD0 near | VAT LOD0 | + skinned hero-quality near cinematic camera |
| Particles / weather | 400 / 1,500 | 1,200 / 4,000 | 3,000 / 9,000 | 6,000 / 15,000 |
| Practical lights (torches) | 1 | 4 | 8 | 16 |
| Banners | static mesh | cloth shader | cloth shader | cloth shader + lit sheen |
| Post | single merged pass (grade + vignette + FXAA) | separate, FXAA | SMAA | SMAA / TAA in hero |

Low tier compensates for missing AO with baked AO in vertex colors and macro maps (stronger by 20%), and
for missing bloom with 30% brighter emissives on flames and lamps.

---

## 14. Material recipes (Blender, numpy texgen)

The pipeline bakes procedural materials to PBR sets (`tools/blender/lib`: `texgen`, `ornament`,
`stone`, `nodes`, `bake`). Recipes below are layer stacks; heights are in meters; "noise(s, o, r)" =
seamless fBm with feature size s m, o octaves, roughness r. Every set must hit its `MATERIAL_PRESETS`
`baseColor` (+-6% average) and `roughnessRange`. Preview at 1 m and 10 m in `?scene=assetviewer`
under `sky_day` and `sky_golden`.

| Set | Height / normal | Albedo | Roughness / AO |
|---|---|---|---|
| `sandstone_buff` (2 m tile) | Ashlar courses 0.32 m with 6 mm joints (`ornament.ashlar`), per-block tilt 1-2 mm, chisel marks noise(0.02, 3, 0.5) x 0.6 mm, edge chipping (block-edge distance < 1.5 cm x noise) -4 mm | Base `#c2a985`; per-block hue jitter +-3%, value +-6%; faint pink bands (sin y x noise, 8% `#c9a08a`); black lichen spots noise(0.15, 4) > 0.72 -> `#3a3630` 70% on upward faces | 0.76 base, joints 0.9, worn tops 0.62; AO from height (`bake.heightfield_ao`, radius 0.05 m) |
| `sandstone_polished_mauryan` | Almost flat; micro speckle noise(0.004, 2) 0.05 mm | `#cdbb9a` with darker speckle 4% and a soft cloud mottle noise(0.4, 3) +-4% | 0.18 (0.10-0.32); dust on horizontal faces raises to 0.5; clearcoat 0.6 / 0.12 in the material |
| `lime_plaster_weathered` (3 m) | Hand-trowel swirls noise(0.6, 3, 0.5) 1.5 mm; cracks = voronoi edge distance < 0.004 at 0.25 m cells, depth 1 mm; patches of fallen plaster (5-12%) revealing brick 8 mm deeper | `#e4dac6` +-3%; rising damp gradient 0-0.8 m -> `#b9b09a` with noisy edge; vertical rain streaks (stretched noise 0.05 x 1.5 m) -10%; exposed brick `#9c5a40` | 0.86; damp zone 0.78; brick 0.84 |
| `mud_plaster` (2.5 m) | Finger arcs (radial arcs 0.2 m, 1 mm), straw fibre speckle, shrinkage cracks | `#a8835f` +-5%, straw `#c4a86a` flecks 3% | 0.94 |
| `brick_fired_old` (2 m) | Bricks 0.42 x 0.07 m (flat period bricks), 8 mm lime joints recessed 3 mm, worn arrises | `#9c5a40` per brick +-8% value, 10% overfired dark bricks `#6e3a2a`; white efflorescence near the base | 0.84; mortar 0.92 |
| `roof_tile_terracotta` (2 m) | Flat grooved tiles 0.3 x 0.45 m with hooked lips, overlap 0.1 m, 3% broken | `#a65a3c` +-7%, lichen `#8a8a5a` dots in rows | 0.72 |
| `thatch_grass` (2 m) | Combed bundles (anisotropic noise 0.25 m along slope), rope bands every 0.6 m, ragged eave edge (alpha on the eave strip) | `#a8935e`, ages to `#857a62` by a weather mask | 0.96 |
| `timber_teak_carved` (trim) | Bands: plain beam, lotus bracket, bead row, creeper scroll, fluted shaft + bell capital (`ornament` motifs, 4-12 mm relief); grain noise stretched 20:1 | `#6b4a2e` +-6%, darker grain lines, oiled edges `#7d5636` | 0.62 (oiled edges 0.45) |
| `bamboo_lattice` | Culms 4-8 cm with nodes every 0.3-0.4 m; split-lath weave variant | `#b39a63`, nodes darker, sun-bleached `#c4b07a` | 0.55 |
| `cloth_cotton` (0.5 m) | Plain weave 1 mm, slubs; folds come from geometry | Neutral `#d9cdb3` (multiplied by dye masks at runtime) | 0.92, sheen 0.4 |
| `cloth_silk` | Fine twill + woven gold border bands as trims (gold metal mask in ORM.b) | `#b0482c` base x dye | 0.42, sheen 0.9; borders metal 1, rough 0.35 |
| `elephant_skin` | Deep wrinkle network (voronoi edges at 3 scales: 5 cm, 1.5 cm, 4 mm) 3 mm, pores | `#6e6660`, pink depigmentation freckles on trunk/ears `#b08a7c`, mud on legs `#7a6650` | 0.82 |
| Terrain layers (`TERRAIN_LAYERS`) | Each 3-4 m tile: base material + scatter (pebbles, cracks, leaves, footprints) with heights for the height blend | Layer `baseColor`, macro-neutral (variation comes from the splat macro) | Layer roughness; puddles masked by height |
| Leaf atlases (WP4) | Procedural leaf cut-outs, no scans (species outline curves: peepal heart + drip tip, mango lanceolate, neem pinnate) with vein relief 0.2 mm | Per-season palette from `TREE_SPECIES.leaf`, back faces +15% lighter, translucency in ORM.b | 0.55 front / 0.7 back |

Node notes for the Blender material previews (`lib/nodes.py`): drive every noise with the seamless 4D
torus noise (`NodeBuilder.seamless_noise`) so bakes tile; bake height to normal at 16 bits; pack ORM
as R = AO, G = roughness, B = metalness (or translucency for foliage, `samrajya_set` extras document it).

---

## 15. Review of the current build (art direction notes)

Screens reviewed: `docs/screenshots/*.png` and `docs/screenshots/pipeline/*.png` (baseline build plus
this pass's palette and theme changes).

| Area | Observation | Direction / owner |
|---|---|---|
| Global lighting | Hero and battle shots look washed out: grey-white haze over everything, flat light | Calibrate the IBL (§4.4: procedural sky ~8x too bright, sun counted twice), raise bloom thresholds to exposed 4-4.5, adopt `resolveLighting` + height fog (§4.5). Lead Graphics |
| Greens | Lime, saturated grass in battle and hero views | Done in `BIOME_COLORS` (olive, lower value); terrain splat layers (WP1) replace vertex colors |
| Horizon | Hard edge where the battle map ends; sky white at the horizon | Fog the sky dome (§4.5), terrain apron beyond the map edge (ARCHITECTURE §17) |
| Settlements | Scattered boxes on grass, no streets, no ground change inside walls | Packed-earth ground, streets and districts (§5.5, §8.8), kit pieces (WP2) |
| Stupa asset | Superb carving, but all red sandstone and over-saturated; Sanchi is buff-grey stone with a plastered dome | Re-skin with `sandstone_buff` (WP1) and a weathered lime-plaster dome; keep red sandstone for city-state architecture. Technical Art |
| Sandstone sheet | Excellent detail; color too uniform, repetition visible on long walls | Per-block hue jitter, lichen and soot in the macro map, a second sheet variant to break repetition |
| Soldiers | Silhouettes read; team color too flat and plastic (saffron boxes) | Natural-dye cloth with value variation, cotton/skin contrast, rim at distance (§3.4, §9.7); VAT characters (WP5) |
| UI | Readable and on-theme | Now on Tiro Devanagari Sanskrit + Mukta, generated icons/emblems, tooltips, scrollbars; base.css should consume the component tokens (§17) |

Priorities for the graphics team (in order): 1 IBL calibration + bloom thresholds; 2 `resolveLighting`
in the environment rig; 3 height fog + sky fog; 4 terrain splat with WP1 layers; 5 CSM shadows;
6 zoom-look integration (`resolveZoomLook`); 7 banners from `bannerSvg`; 8 water presets;
9 vegetation wind and seasonal palettes; 10 shafts and DoF in hero mode.

---

## 16. Art QA checklist (every asset and every scene)

- [ ] Albedo within `ALBEDO_LIMITS` (2nd/98th percentile) and the family range; saturation within budget.
- [ ] Baked set average color within +-6% of its `MATERIAL_PRESETS.baseColor`; roughness spans `roughnessRange`.
- [ ] Reads at its zoom band: silhouette identifiable in grey-scale at 700 m (buildings) / 200 m (units).
- [ ] Team color coverage 25-35% on units; nothing team-colored in the environment except banners/doors.
- [ ] No anachronisms (§1.5, `BANNED_PLANTS`), no copied national emblems.
- [ ] Three detail scales present at hero distance (macro, meso, micro); no flat color over 1 m^2.
- [ ] Under all 8 lighting presets: no clipped whites on plaster at noon, ground >= 12% at night (tactical).
- [ ] LODs cross-fade without popping; impostor matches LOD2 color within 5%.
- [ ] Triangle and texture budgets per `ASSET_LIST.md`; GPU resources disposed.
- [ ] UI: contrast >= 4.5:1 body / 3:1 large, targets >= 44 px, works at 390 x 844 with safe areas.
- [ ] Color-blind modes: factions distinguishable (emblems + ring styles + remapped colors).
- [ ] Lookdev: `docs/art/tools/lookdev` sheet regenerated when lighting presets change; asset viewer shots
      under `sky_day` and `sky_golden` attached to the asset's PR.

---

## 17. Requests to other owners (exact changes)

**Lead Graphics Engineer** (`src/render/**` except `style/`):
1. `environment/environment.ts`: replace the hand-written sun/hemi/fog/exposure/grade logic with
   `resolveLighting()` (§4.2) and call `post` bloom with `threshold = r.bloomThreshold / r.exposure`.
2. `environment/sky.ts`: disc-free sky for the PMREM, measured `sourceIrradiance` and
   `scene.environmentIntensity = environmentIntensityFor(r, sourceIrradiance)`; night sky below -4 deg;
   visible sun sprite (§4.4).
3. Height fog + mist slab + sky-dome fog (§4.5, reference `FOG_FRAG`); volumetric shafts.
4. Camera integration of `resolveZoomLook(distance, out)` + `capZoomLook(look, tier)` for LOD bias,
   team-color boost, rim, banner scale, fog scale, AO radius, DoF and shadow distance (§2).
5. Banner textures from `bannerSvg(pattern, shape, colors)` / `EMBLEMS` (canvas Path2D) per faction.
6. Water: `WATER_PRESETS` (§6); terrain: `BIOME_TERRAIN` + `TERRAIN_LAYERS` through `splat.ts` (§5).
7. Vegetation: `TREE_SPECIES` seasonal leaf colors/foliage, `WIND`, `VEGETATION_LOD`, `CROPS` (§7).
8. Units: team masks multiplied by `FactionArt.clothDye` with +-6% variation; rim and outlines (§9.7).

**Lead UI/UX Engineer** (`src/ui/**` except `theme.css`):
1. `base.css` `.btn`: `background: var(--btn-bg)`, `:hover { background: var(--btn-bg-hover) }`,
   `.btn.active { background: var(--btn-bg-active) }`, `.btn.primary { color: var(--btn-primary-text);
   background: var(--btn-primary-bg); border-color: var(--btn-primary-border); text-shadow:
   var(--btn-primary-shadow-text) }` (fixes 2.4:1 text contrast on the light saffron top of primary buttons).
2. `.panel { padding: var(--panel-pad); backdrop-filter: blur(var(--panel-blur)) }`; modal backdrop
   `background: var(--ui-overlay)`; loading overlay may use `--ornament-torana` above the label.
3. Use `.icon.icon-<id>` for resources, tactics, stats and unit classes, `.faction-chip` + `.emblem-*`
   for factions, `.meter` (notched) for strength/morale, `.tooltip`, `.kbd`, `.badge`, `.btn.slot`
   for the command card, `.panel.parchment` for event and chronicle cards, `.title-torana` for modal
   titles (see `docs/art/ui_kit.html`).
4. Set `document.documentElement.dataset.colorblind = settings.colorblind` (and
   `dataset.reducedMotion`) so the CSS remaps apply.

**CTO**:
1. `index.html` boot splash: `font-family: 'Tiro Devanagari Sanskrit', 'Palatino Linotype', ...` and
   background `radial-gradient(ellipse at 50% 40%, #2a2546 0%, #17142a 55%, #0d0b18 100%)` to match
   the theme (the fonts load with the main bundle; the fallback stays Palatino).
2. Optional `@font-face` preload: `<link rel="preload" as="font" type="font/woff2" crossorigin>` for the
   two Tiro files once their hashed names are known (Vite plugin or a fixed public path).

**Creative Director** (`src/data/**`):
1. Default team color of Marudesha `frontier.colors.primary` `#7d3c98` -> `#a35bc2` (lighter amethyst):
   protan dE vs Giridurga indigo rises from 4.1 to 11.3 and deutan from 16.0 to 21.7 while keeping the
   violet identity (color-blind modes cover the rest).
2. Appearance `prop: 'ledger' | 'scroll'` render as palm-leaf manuscripts (pothi); confirm wording in
   descriptions ("ledger" in UI text is fine).
3. Building footprint for `stupa` is 20 x 20 m but the hero asset is 25.2 m: either 24 x 24 or a scaled
   variant for towns (art can deliver a 0.8x town stupa).

**Technical Art** (WP1-WP7 in `ASSET_LIST.md`): re-skin `stupa_sanchi` with `sandstone_buff` + plaster
dome (WP3-01); per-hour skies with the Nishita parameters of §4.1 (WP7); LUTs `lut_*` (WP7, authored by
the Art Director in the lookdev harness).

---

## Appendix A - Glossary of forms

| Term | Meaning (as used by art) |
|---|---|
| Anda / medhi / vedika / harmika / chhatra | Stupa dome / drum / railing / railed box on top / umbrella discs |
| Torana | Gateway of posts and curved architraves with volute ends |
| Gavaksha | Horseshoe ("chaitya") arch window, timber-rib imitation |
| Wagon-vault roof | Barrel roof with a horseshoe gable; period signature for halls and gates |
| Kalasha / amalaka | Pot finial / ribbed disc crowning a shikhara |
| Shikhara | Curvilinear temple tower [stylization for visual identity] |
| Mandapa | Pillared hall/porch |
| Jharokha | Projecting balcony window (timber oriel here) |
| Dipa stambha | Lamp pillar |
| Antariya / uttariya / kayabandh / ushnisha | Lower cloth / upper shawl / waist sash / turban |
| Kundala / keyura / mekhala | Earrings / armlets / girdle |
| Pothi | Palm-leaf manuscript bundle |
| Mandana / kolam | Painted floor and wall motifs (ochre, white, rice paste) |
