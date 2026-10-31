# GFX-01 - Art Director visual co-sign, round 1

OWNER: Art Director. Ticket GFX-01 (lighting, atmosphere, post, materials, renderer, quality tiers), reviewed
against ART_BIBLE §2, §3, §4, §13, §15, §16, `docs/art/lookdev_presets.jpg` and the client touchstones
(Wukong fidelity up close, AoE readability from afar).

**Verdict: not approved yet (7/10).** This ticket did its main job. The grey-white wash in `docs/screenshots/battle.png`
and `hero.png` is gone. All eight presets now read as different times and weathers, and the tactical battle reads
like AoE at every hour.

The best frames are as good as anything the studio has produced:
- `battle-golden-ultra` and my close-band golden capture: long raking unit shadows, warm haze;
- moonlit `battle-night-ultra` and my close-band night capture: clearly blue, never black;
- `battle-winter_fog-ultra`: noise-broken mist;
- the post-hero lab: shafts through the columns, wet floor, backlit figure;
- the asset-viewer stupa and torana under the baked golden sky.

Four defects still keep it from ship quality. Each one is visible in the shipped game frames, not only in the
labs.

## What I looked at

- Every PNG in `docs/sprint1/gfx-01/review/`. This is the latest set: 38 shots, the same framing as the developer
  set, which I spot-compared shot for shot.
- Every PNG in `docs/sprint1/gfx-01/`, `smoke/` and `review-smoke/`.
- `docs/art/lookdev_presets.jpg`, plus the baseline `docs/screenshots/battle.png`, `hero.png` and
  `world-overview.png`.
- Pixel crops, at 2-3x nearest-neighbour:
  - low-tier walls;
  - the DoF lab silhouette;
  - golden-hour ground;
  - the strategic map edge.
- Clip and value statistics measured with PIL.
- My own captures, built from HEAD `e8b9d13` into `.build/gfx-01-ad` and served on port 4473. They are not
  committed; regenerate them from the deep links below with `&paused=1&noaudio=1`:

| Capture | Deep link | Why |
|---|---|---|
| hero noon low | `scene=hero&quality=low&noui=1&hour=12.5&season=sharad&weather=clear` | low tier, reporting the real resolution scale (0.8) |
| hero golden low, phone 390x844 | same at `hour=17.4` | mobile tier |
| battle close golden ultra | `scene=battle&seed=7&soldiers=1000&preset=plains&quality=ultra&noui=1&camera=close&hour=17.4&season=sharad&weather=clear` (step 200) | no close-band preset shot in the evidence |
| battle close night ultra | same at `hour=22` | close-band night readability |
| battle dusk 18.5 h ultra | tactical at `hour=18.5` | does the dusk preset ever appear? |
| hero monsoon high | `scene=hero&quality=high&noui=1&hour=13&season=varsha&weather=monsoon_rain` | wetness on high |

## Blocking (round 2)

1. **Monsoon is not wet in the game.**
   - `hero-monsoon-ultra.png` and my `hero-monsoon-high` capture report `wetness 0.85`. Yet the lime plaster stays
     bright and dry, the red bases are unchanged and the ground is unchanged. Set them beside `hero-noon-ultra`:
     only the sky and the grade differ.
   - Cause: `WETNESS_GLSL` is only compiled into `createPbrMaterial` (`materials/pbr.ts`). Every plain
     `MeshStandardMaterial` in today's scenes ignores `MATERIAL_GLOBALS.wetness`, even though height fog and shadows
     reach those same materials globally.
   - Fix: register the wetness darkening and gloss as a global chunk patch on every MeshStandard/Physical material,
     in the same way as the fog chunk (W15: it must show up without scene edits).
     - Porosity defaults to `smoothstep(0.35, 0.9, roughness)` when the material has no ORM porosity.
     - Metals are excluded.
     - The up-facing term only darkens and glosses; puddles remain the splat / GFX-02 hook.
   - Targets at `r.wetness = 0.85`:
     - lime plaster and sandstone albedo luminance x0.60-0.70;
     - roughness falls to 0.35-0.45 on porous surfaces;
     - grass / terrain darkens by 15-25%;
     - no change at wetness 0.
   - Evidence: `hero-monsoon-ultra` beside `hero-noon-ultra`, same camera, with the measured plaster luminance
     drop printed by the shots script.

2. **Low-tier shadow acne and saw-tooth edges (mobile).** Visible in `review/hero-noon-low.png`, `hero-night-low.png`,
   `hero-golden-low.png` and my 0.8-scale capture:
   - vertical dark streaks down the grazing-lit left face of the large red building (classic acne);
   - a saw-tooth comb along the lower wall of the white plaster house;
   - stair-stepped sun / shadow boundaries on the ground at hero distance.

   Ultra and high are clean. ART_BIBLE §13 says low is "1024, 1 cascade, hard". "Hard" means no penumbra growth,
   not aliased.

   Fix on low:
   - Use 2x2 hardware PCF (`PCFShadowMap`, radius 1: one hardware-compare tap on WebGL2) instead of an unfiltered
     compare.
   - Use a normal bias of at least 2 texels plus a slope-scaled depth bias on the single cascade.
   - Render back faces into the map (`shadowSide = BackSide`) for closed architecture.
   - Fit the cascade to the hero band (`shadowDistanceFor` already gives about 45 m there).

   Target: no streaks or teeth at 1280x720 or 390x844 in `hero-noon-low`, `hero-golden-low` and `hero-night-low`,
   and `battle-*-low` unchanged or better. Add a phone-portrait (390x844) low hero shot to the shots script.

3. **Near-field DoF has a hard, notched silhouette.**
   - In `lab-post-hero-dof-focus12.png` the out-of-focus foreground figure is blurred inside, but its outline stays
     hard and bitten where it crosses the in-focus column and railing (left cape edge, crop at 2x).
   - An out-of-focus foreground must spread over a sharp background. Today the gather explicitly prevents bleeding in
     both directions (`dof.ts` header). This is the first thing a Wukong-style over-the-shoulder cutscene shows.
   - Fix: a near-field layer.
     - Dilate the near CoC with a tile max (1/8 res plus a 3x3 neighbourhood max).
     - Gather the near field with that dilated CoC.
     - Composite over the far / in-focus result with alpha = `smoothstep(0, 1, dilatedNearCoc / 2px)`.
     - Keep the current "sharp foreground never bleeds into blurred background" rule for the far field only.
   - Evidence: the focus-12 lab pair before/after, plus a hero shot with a near pillar or foliage card in front of the
     camera.

4. **Low-sun shafts plus bloom clip the cinematic frame.**
   - `lab-post-hero-taa-on/off.png` have 7.9-8.0% of all pixels clipped (any channel >= 250) and p98 luma 249.
   - Between the columns the sky becomes a flat cream slab with no gradient: the wash this ticket removed, back in
     the flagship shot. AgX halves the clipping (4.3%), which shows the energy is in the HDR buffer, not the tone
     curve.
   - My ruling on the developer's question: the preset `shaftsStrength` values stay as authored (golden 0.45,
     golden_dust 0.6). The shaft composite must conserve energy:
     - Tint toward the fog in-scatter colour, weighted by the occlusion mask.
     - Soft-clamp the added radiance to at most 1.5x the local pre-shaft value.
     - Shafts never add on top of the sun sprite's own bloom.
   - Targets, in `lab-post-hero` golden at ultra:
     - at most 2% of pixels clipped, all of them at the sun sprite and its immediate glow;
     - the sky between the columns keeps a visible warm-to-pale gradient (p98 luma <= 245);
     - the lens-dirt and bloom halo stays.
   - Print the clip percentage in `report.json`.

## Non-blocking (track; please fix in GFX-01 round 2 if cheap, otherwise hand to the owner named)

- **Dusk never appears in game.** 18.5 h and 18.9 h in sharad both resolve to `night` (exposure 2.2-2.5), so the
  afterglow preset of the lookdev sheet (warm plum horizon, lamps lit) is never seen. *Art Director action (mine):*
  re-key `TIME_OF_DAY_TRACKS` in `render/style/lighting.ts` so dusk dominates from -2 to -9 deg. *GFX-01:* the
  procedural evening sky should keep a warm band on the solar-azimuth horizon down to -10 deg. Re-shoot dusk at
  18.4 h.
- **Dawn mist slab is invisible.** Dawn mist is 2 m / 0.012. `hero-dawn-ultra` and `battle-dawn-ultra` show no
  ground mist, while the lookdev dawn row and winter fog both show it. Check that the mist base follows the local
  ground height at the focus (Rajapura sits well above y = 0), not world zero.
- **Map edge at operational / strategic zoom** (`zoom-battle-operational`, `zoom-world-strategic`):
  - There is no seam, but the map reads as a tile floating in a light-grey void.
  - The strategic frame has a grey wedge across about 30% of the top-left and a dark 60 px band parallel to the left
    map edge. That band looks like a shadow or AO from an edge step; please identify it.
  - Owners: GFX-02 for the outer skirt, GFX-01 for the band.
- **The house signature needs assets attached.** Every game-scene shot reports `bakedSky: null`, so neither the 35%
  LUT nor the baked skies are on screen. That is why golden shadows are saturated dark olive (`hero-golden-ultra`
  ground #1e2909, S 0.76) rather than the bible's blue-violet. CTO: `render.attachAssets(assets)` in `main.ts`. I will
  re-judge the golden, dusk and night shadow colour once it lands.
- **Practicals:** night Rajapura has no lamps at all; the `lamp_night` mood needs `env.addPractical` calls from the
  hero and settlement scenes (Lead Gameplay / GFX-02).
- **Evidence hygiene:** dynamic resolution was on in every non-ultra capture: 0.6-0.8 scale (my capture: 0.8 on low
  desktop, 0.6 on phone). Pin the scale to 1 in `scripts/shots/gfx-01.cjs` (and smoke) so the low, medium and high
  shots show the tier, not SwiftShader speed.
- **Low-tier battle at golden:** tree crowns cast detached parallelogram shadows with no trunk (`battle-golden-low`,
  lower right). Item 2's fitting should mostly cure this; otherwise give trunks a minimum shadow thickness of 1 texel.
- **Rulings on the developer's other questions:**
  - Hero DoF strength (f/2.8, 10 px) stays.
  - LUT strength stays at 35%.
  - The hero ground blur in front of the camera is acceptable.

## Signed off as-is

- IBL calibration.
- Exposure per preset; night is at least 12% on both tiers.
- CSM cascades and the `?csm=1` debug view.
- Contact shadows (ultra close/hero only).
- Fog colours and the sky-dome fog.
- Winter-fog mist noise.
- Grade per preset.
- TAA vs SMAA choice per band.
- The low-tier single merged pass (the look matches ultra minus effects: same game in a smaller window).
- The surface lab:
  - clearcoat spheres, silk sheen, back-lit foliage cards, wet plaza reflections;
  - the LOD dither ramp, which is visible only as a deliberate ramp.

---

# Round 2 - Art Director re-review of rework round 1

**Verdict: not approved yet (8/10).** All four round-1 blockers are fixed. The ticket is close. Two visible defects
remain in shipped game frames, and both can be fixed inside GFX-01's paths.

## What I looked at

- Every PNG in `docs/sprint1/gfx-01/`: 46 shots, re-captured with the resolution scale pinned to 1.
- `smoke/` and `review-smoke/` as contact sheets, plus the round-1 "before" set in `review/`, compared shot for shot.
- `report.json`: wetness, clip, night, csm and budget checks.
- Pixel crops at 2-4x nearest-neighbour:
  - low-tier walls at noon and golden, desktop and phone;
  - the DoF cape edge and the near pillar;
  - the twilight hero ground.
- Linear-luminance region statistics (PIL) for wet/dry/noon and for the twilight shadows.

## Round-1 blockers

| # | Status | Notes |
|---|---|---|
| B1 monsoon wetness | **Met** | Linear wet/dry in the same frozen frame: plaster 0.71-0.74, red bases 0.69 (albedo x0.63-0.68 from the unit-tested mirror). The darkening reaches every scene MeshStandard, and nothing changes at 0. The terrain's own 0.28 term covers the ground; the A/B shows ground 1.00 because that term is not overridable (fine). On screen the walls read as damp rather than soaked under overcast light; acceptable for the overcast monsoon preset. |
| B2 low-tier acne / saw-tooth | **Partly met** | The noon eave comb and the grazing-wall streaks are gone (`hero-noon-low`, `-night-low`, `-noon-low-phone`). The golden ridge teeth on the red wall are only blurred, not removed. See blocker R2-1. |
| B3 near-field DoF | **Met** | The cape edge no longer bites into the column; the pillar edge melts slightly over the railing. The effect is small because of my own f/2.8 / 10 px hero cap (data, mine; see follow-ups). |
| B4 shaft clipping | **Met** | 7.9 % -> 0.00 % clipped, p98 240. The warm-to-pale gradient between the columns is back, and the lens dirt and lamp bloom remain. The frame lost about 6 % saturation and the columns glow less, but it still reads as golden hour. |

Non-blocking items from round 1:
- The dusk afterglow appears at 18.4 h.
- The dawn mist slab now sits on the ground.
- Evidence is captured at scale 1.
- The strategic band is diagnosed as terrain below the water level (GFX-02).

## Blocking (round 2)

### R2-1. Twilight key light: hard, near-black shadow streaks across the hero frame (18.4-18.9 h)

Seen in `hero-dusk184-ultra.png` and `hero-dusk-ultra.png`; also present in round 1's `review/hero-dusk-ultra.png`, which I
missed then. The new 18.4 h shot that I asked for makes it obvious:
- A 10 px black ribbon runs about 600 px from the hero's feet to the frame edge.
- Two full-width black bands cross the street from the buildings.
- `battle-dusk184-ultra` shows the same smears behind the elephants.

What is wrong:
- **The sun is at or below the horizon, but the key still casts shadows from 3 deg.** `environment.ts` clamps the
  sun to `MIN_KEY_ELEVATION_DEG = 3`, which makes every shadow about 19x its caster's height. It then lerps that
  near-horizon direction toward the moon, so the key lingers low through the whole -2 to -8 deg handover.
- **The shadows are hard.** The dusk preset's 3 deg softness should give a penumbra of metres at the tip of a 30 m
  shadow, yet the ribbon has a 2-3 px edge along its whole length. The PCSS max penumbra (28 texels on ultra,
  18 on the others) clamps it.
- **The shadows are too dark.** Lit ground to shadow measures about 3-4:1 linear (lit ~0.016-0.018, shadow
  ~0.004-0.007). The dusk preset's key:fill is 1.6 and the sun barely grazes the ground, so an afterglow frame
  should be nearly shadowless.

Fix (environment.ts / csm.ts):
1. Cross-fade the key light's intensity, not its direction:
   - The sun key keeps its own (clamped) direction and fades to 0 by `smoothstep(3, -4, sunElevationDeg)`.
   - The moon key comes in on its own 25-62 deg direction.
   - The single shadow-casting light snaps from sun to moon at the intensity crossover, when both are weak.
   - At no time should a key below 8 deg elevation carry more than 25 % of the preset's sun intensity.
2. Let PCSS honour the softness: scale the max penumbra with `sunSoftnessDeg`, or raise it to at least 64 texels
   in the cascades where softness > 1.5 deg, so dusk / monsoon / winter-fog penumbrae can grow.

Targets:
- `hero-dusk184-ultra` and `hero-dusk-ultra`: no cast shadow longer than 7x its caster's height.
- Lit-to-shadow ratio on flat ground at most 1.8:1 linear (print it from the shots script, like the night check).
- Any remaining hero shadow edge widens visibly with distance from the feet.
- The golden (17.4 h) and night (22 h) shots must not change.

### R2-2. Golden-hour low tier: the tooth pattern on the red wall survives, blurred (mobile hero frame)

- `hero-golden-low.png`, at x 790-860 and y 255-285: six soft "flame" teeth along the ridge shadow on the lit red
  face.
- `hero-golden-low-phone.png` at x 355-390 and y 310-350: three teeth, visible at 1x on the phone.

These are the same stair-steps as in `review/hero-golden-low.png`, softened by the tent filter. My round-1 target was
"no streaks or teeth at 1280x720 or 390x844". A soft edge is fine; a readable comb is not.

The Lead's diagnosis (one 1024^2 cascade over the bounding sphere of the hero band, about 8 screen px per texel) is
right. Fix:
- Fit the single low cascade tightly: a light-space AABB of the hero-band frustum slice, quantised to whole texels,
  instead of the bounding sphere.
- Pull its far split in to 30 m on the hero band. Beyond it, fall back to the existing distance fade.

Target: at most 4 screen px per shadow texel on the red wall in `hero-golden-low` (print the texel size). No discernible
tooth pattern at 1x in `hero-golden-low` and `-phone`. `hero-noon-low` and `hero-night-low` stay as clean as now, and
`battle-*-low` stays at or below 24 draws.

Evidence for round 3:
- re-shot `hero-dusk184-ultra`, `hero-dusk-ultra`, `battle-dusk184-ultra`, `hero-golden-low` and
  `hero-golden-low-phone`;
- a 3x crop of the red-wall ridge;
- the printed twilight lit:shadow ratio and the low cascade's texel size in `report.json`.

## Non-blocking (follow-ups, named owners)

- **Art Director (mine):** I will raise the cutscene DoF in `style/zoom.ts` (`setFocus` cinematic preset, maxBlurPx
  about 24) so the new near-field layer gets a Wukong-style foreground melt. The hero gameplay band stays at f/2.8 /
  10 px.
- **CTO:**
  - `render.attachAssets(assets)` in `main.ts`. I still have to judge the golden, dusk and night shadow colour against
    the baked skies and the 35 % LUT; game shots still report `bakedSky: null`.
  - The smoke `pinResolutionScale(1)` call.
- **GFX-02:**
  - The terrain adopts the shared wetness model, so the ground reads wet beside the walls.
  - The outer skirt / map edge at operational and strategic zoom.
  - The dark band below the water level.
- **GP-01:** the hero casts a shadow on low.
- **Lead Graphics:** watch the `LEGACY_WETNESS` tagging window (10 s) until GFX-02 / GFX-03 call `setWetnessClass`.

## Signed off as-is (in addition to round 1)

- The global wetness chunk and its opt-outs.
- The low-tier tent filter and biases at noon and night.
- The near-field DoF layer.
- Energy-conserving shafts plus the hue-preserving shoulder.
- The dusk afterglow band.
- The ground-relative dawn mist.
- Every preset at ultra apart from the twilight shadows above.
- The battle labs (SMAA ultra, merged low).
- The surface lab.
- CSM debug views.
- The draw-call budgets.
