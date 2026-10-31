# GFX-01 - Lighting, atmosphere, post, materials, renderer

OWNER: Graphics Developer - Lighting, Atmosphere & Post. Reviewer: Lead Graphics Engineer (Art Director co-signs
the look). Evidence: `NODE_PATH=$(npm root -g) node scripts/shots/gfx-01.cjs` (port 4403, dist `.build/gfx-01`)
writes every PNG here plus `report.json` (draw calls, passes, checks). SwiftShader frame times mean nothing; judge
draw calls, passes and pixels.

## What landed (by step)

| Step | Commit | Content |
|---|---|---|
| S1+S2 | af10031 | Calibrated IBL (disc-free Preetham sky, 32 px float cube readback, `environmentIntensity = r.skyIrradiance / source`), baked WP7 skies rotated to the solar azimuth with a 2 s cross-fade, sun / moon sprites, night sky; `EnvironmentRig` on `resolveLighting` (moods, lightning, practicals, wetness) |
| S3 | 42b606b | Cascaded sun shadows 1 / 2 / 3 / 4 (one shadowed light per cascade), texel snapping, PCF from the sun's angular size, PCSS (Vogel + IGN) on high / ultra, `?csm=1` debug colours |
| S4 | fabef9f | Global height fog (analytic, overflow-safe), mist slab + 2-octave noise, sky-dome fog (20 km, clamp 0.6), FogExp2 x0.6 on low, aerial perspective + map-edge fade to the horizon ring |
| S5 | 45241e1 | HDR post stack in ART_BIBLE §4.7 order (see below) + `?scene=lab&lab=post-hero` |
| S6 | ff9f0e0 (swept into a Studio Head WIP snapshot before my commit) | Material chunks: preset clearcoat / sheen, subsurface + foliage translucency (ORM.b), wetness + puddles, ZoomLook detail fade + spec AA, emissive / baked-AO tier boosts, per-instance LOD dither; `?scene=lab&lab=surface` |
| S7+S8 | 6714658 | Renderer stats (shadow draws, post passes), proportional dynamic resolution, context loss / restore, leak-free tier switches; ART_BIBLE §13 table asserted in `tests/core/quality.test.ts` |

## Post stack (`src/render/post.ts`, passes in `src/render/post/`)

scene (HalfFloat + float depth texture, Halton TAA jitter) -> GTAO (high half res 2 slices, ultra full res 3 slices,
depth-aware denoise) -> contact shadows (ultra, close / hero bands) -> SSR (ultra; standard / physical opaque
materials write 1 - weight to alpha) -> composite -> shafts (24 / 32 / 48, half res unless ultra; sun < 35 deg or
strength > 0.3) -> dual-filter bloom (scene-linear soft knee = `r.bloomThreshold / r.exposure`, lens dirt on ultra)
-> gather-bokeh DoF (hero + cutscenes on high, close bands on ultra) -> final `SamrajyaGrade` (ACES r170 maths or
AgX, sRGB, grade x ZoomLook, 32^3 LUT 35 % on high / ultra, vignette, grain, CA, sharpen, dither) -> TAA (ultra hero
band / `setTaa(true)`) | SMAA | FXAA. Low: scene + ONE fullscreen pass (grade + vignette + FXAA on tone-mapped taps).

API for scenes: `post.setFocus(distanceM | null, fStop, maxBlurPx)`, `post.setTaa(true | false | 'auto')`,
`post.setToneMapping('aces' | 'agx')`, `post.applyZoomLook(look, focusDistanceM?)`, `post.info()`;
the rig drives `setGrade / setBloom / setAmbientOcclusion / setSun / setLut / setLensDirt`.

## Results

All numbers from `report.json` (generated 2026-10-30T13:41Z); `failures: []`.

### Lighting presets on ultra (ART_BIBLE §4.1), battle `preset=plains` tactical + hero (Rajapura)

| Preset | Battle | Hero | Resolved dominant |
|---|---|---|---|
| dawn | `battle-dawn-ultra.png` (89 draws, 52 shadow) | `hero-dawn-ultra.png` (115 / 65) | dawn |
| noon | `battle-noon-ultra.png` (89 draws, 52 shadow) | `hero-noon-ultra.png` (117 / 67) | noon |
| golden | `battle-golden-ultra.png` (89 draws, 52 shadow) | `hero-golden-ultra.png` (114 / 64) | golden |
| dusk | `battle-dusk-ultra.png` (89 draws, 52 shadow) | `hero-dusk-ultra.png` (114 / 64) | night (the resolver hands 18.9 h in sharad to the night preset) |
| night | `battle-night-ultra.png` (89 draws, 52 shadow) | `hero-night-ultra.png` (118 / 68) | night |
| monsoon | `battle-monsoon-ultra.png` (90 draws, 52 shadow) | `hero-monsoon-ultra.png` (119 / 69) | monsoon |
| dry_haze | `battle-dry_haze-ultra.png` (89 draws, 52 shadow) | `hero-dry_haze-ultra.png` (119 / 69) | dry_haze |
| winter_fog | `battle-winter_fog-ultra.png` (89 draws, 52 shadow) | `hero-winter_fog-ultra.png` (117 / 67) | winter_fog |

Low tier (single merged post pass, hard 1 cascade, FogExp2 x0.6): `battle-noon-low.png` (24), `hero-noon-low.png` (41); `battle-golden-low.png` (24), `hero-golden-low.png` (41); `battle-night-low.png` (24), `hero-night-low.png` (41).

### Checks

- Night readability, tactical battle lower half (the armies), mean sRGB luma: ultra **0.141**, low **0.149** (>= 0.12 required).
- Cascades (`?csm=1`, `battle-csm-*.png`): ultra 4 x pcss (579 m), high 3 x pcss (386 m), medium 2 x pcf (258 m); low 1 x hard (tests). Contact shadows run only on ultra in the close / hero bands (`contact` pass in every hero-ultra shot, never at tactical zoom or below ultra).
- Zoomed out (`zoom-battle-operational.png` 650 m, `zoom-world-strategic.png` 4.2 km): no seam - the largest row-to-row jump of the mean colour over the top 45 % is 1.13 / 0.74 (8-bit levels); the map edge melts into the horizon haze (fog.test.ts covers the edge-fade maths).
- Post-hero lab (`?scene=lab&lab=post-hero`, assets attached: baked sky_golden, `lut_golden` at 35 %, WP7 lens dirt): TAA on `scene+gtao+contact+ssr+composite+shafts+bloom+dof+final+taa` vs off `scene+gtao+contact+ssr+composite+shafts+bloom+dof+final+smaa` (`lab-post-hero-taa-on/off.png`); DoF focus override 12 m (`lab-post-hero-dof-focus12.png`); AgX (`lab-post-hero-agx.png`); battle view SMAA on ultra `scene+gtao+ssr+composite+bloom+final+smaa`; low tier `scene+final` = ONE fullscreen pass after the scene.
- Surface lab (`lab-surface-wet-ultra.png`, `lab-surface-dry-high.png`): clearcoat polish, silk sheen, skin subsurface, back-lit foliage, wet plaza + puddles on the ground disc, per-instance LOD dither ramp.
- Tier cycling low -> medium -> high -> ultra -> high -> medium -> low x3 (battle, 600 soldiers): start: 11 tex / 30 geo / 3 RT, cycle1:low: 11 tex / 30 geo / 3 RT, cycle2:low: 11 tex / 30 geo / 3 RT, cycle3:low: 11 tex / 30 geo / 3 RT - unchanged.
- Context loss (WEBGL_lose_context): reported lost yes, restored yes, post `scene+final`, 53 draws on the first frame after restore (sky / PMREM re-bake), no errors.

### Draw calls (SwiftShader, same deep links as the baseline)

| Bench | Before GFX-01 | After | Budget | | Post passes |
|---|---|---|---|---|---|
| battle-1000-high | 81 | 70 (36 shadow) | < 400 | pass | scene+gtao+composite+bloom+final+smaa |
| battle-river-5000-high | 81 | 70 (36 shadow) | < 500 | pass | scene+gtao+composite+bloom+final+smaa |
| battle-mobile-low | 26 | 24 (5 shadow) | < 150 | pass | scene+final |

Post adds 1 (low) to ~20 (ultra hero) fullscreen draws; the cascades dominate (`shadowDrawCalls`).

### Builds and smoke

`npm run typecheck` clean; `npm test`: all GFX-01 suites green (tests/render/lighting 58, tests/core/quality 11); the
remaining failures are pre-existing sim / contracts tests that also fail on a clean HEAD export (migration battles,
construction Palace, politics careful year, siege x3; `sim/tactical/perf` is CPU-timing flaky under load).
`vite build --outDir .build/gfx-01` and `vite build --mode single --outDir .build/gfx-01-single` OK.
`SMOKE_PORT=4403 SMOKE_OUT=docs/sprint1/gfx-01/smoke SMOKE_DIST=.build/gfx-01-smoke npm run smoke`: 14 / 14 shots, no
console errors.

### Self-critique (read against ART_BIBLE §4 / §13; Art Director sign-off still to be recorded)

- Golden / dawn / night / fog / monsoon read as their presets; armies stay readable at night (moonlit key + hemi fill).
- Dusk at 18.9 h reads closer to early night than to an afterglow from the default battle camera (it faces away from
  the western glow); the AD may want more horizon warmth in `sky_dusk` / dusk preset.
- Hero DoF (aperture K 0.5 at f/2.8) keeps the background readable; the near ground in front of the hero still blurs
  (max 10 px at 1080p x strength) - tune `ZOOM_BANDS.hero.post.dof` if the AD wants less.
- At the operational / strategic zooms the finite map shows as a hazy tile: no seam, but an outer terrain skirt
  (GFX-02) would sell the horizon better.
- Shafts are strong against the low sun (lab): `r.shaftsStrength` x band is the AD's knob.

## Lead Graphics Engineer review - round 1

Re-run on HEAD by the reviewer: `npm run typecheck`, `npm test`, `vite build --outDir .build/gfx-01-review`,
`vite build --mode single --outDir .build/gfx-01-review-single`, the capture script
(`SHOTS_DIST=.build/gfx-01-review SHOTS_PORT=4454 SHOTS_OUT=docs/sprint1/gfx-01/review`, every PNG + `report.json`
in `review/`) and smoke (`SMOKE_DIST=.build/gfx-01-review SMOKE_PORT=4453 SMOKE_OUT=docs/sprint1/gfx-01/review-smoke`).
Every PNG in this folder, `review/`, `smoke/` and `review-smoke/` was opened and compared with
`docs/art/lookdev_presets.jpg` and the baseline `docs/screenshots/battle.png` / `hero.png` / `world-overview.png`.

### Results (reviewer re-run)

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | GFX-01 suites green: `tests/render/lighting` 68 / 68 (incl. the review tests), `tests/core/quality` 11 / 11; guards green (purity, integration determinism, data). The full run has 10 failures, all in sim / contracts suites that no GFX-01 file touches (the purity guard keeps render out of sim): contracts migration battles, construction Palace, politics careful year, siege logistics x3 (pre-existing, listed by the developer), tactical determinism mid-siege (siege code of GP-01 / SIM-02 in flux), AI perf x2 and tactical perf (CPU timing while the capture ran). |
| Builds | `vite build` and `vite build --mode single` OK (`.build/gfx-01-review*`, `.build/gfx-01-review-final*`) |
| Capture | 38 PNGs in `review/`, `review/report.json` failures `[]`, every shot 0 console errors; zoom / budgets / tiers / context re-captured on the final build |
| Smoke | 14 / 14, no console errors - run on the build with the first three fixes and again on the final build (cascade cap) |
| Night tactical lower half | sRGB luma 0.141 ultra / 0.149 low (>= 0.12) |
| Zoomed-out seam | largest row jump 1.14 (battle operational) / 0.74 (world strategic) 8-bit levels - no seam |
| `?csm=1` | ultra 4 PCSS (579 m), high 3 PCSS (386 m), medium 2 PCF (258 m); low 1 hard; contact pass only in ultra hero / close views |
| Tier cycling x3 | 11 textures / 30 geometries / 3 post RTs at every return to low |
| Context loss | lost -> restored, `scene+final`, 53 draws on the first frame, no errors |

Draw calls incl. shadow passes (SwiftShader, `__SAMRAJYA_GFX__.info()` / `getProfile()`):

| View | Before GFX-01 | GFX-01 as delivered | After review | Budget (ARCHITECTURE §15) |
|---|---|---|---|---|
| battle 1,000 @high (tactical) | 81 | 70 (36 shadow) | 70 (36 shadow) | < 400 |
| battle river 5,000 @high | 81 | 70 (36 shadow) | 70 (36 shadow) | < 500 |
| battle mobile @low | 26 | 24 (5 shadow) | 24 (5 shadow) | < 150 |
| battle operational @high | - | 70 (36 shadow) | 58 (24 shadow) | < 400 |
| world default (operational) @high | - | 185 (74 shadow) | 162 (51 shadow) | < 300 |
| world default (operational) @ultra | - | 241 (147 shadow) | 182 (88 shadow) | < 300 |
| **world overview (strategic) @high** | - | **343 (162 shadow)** | 246 (65 shadow) | < 300 |
| **world overview (strategic) @ultra** | - | **475 (311 shadow)** | 293 (129 shadow) | < 300 |


### Post passes per tier (`planPasses`, ART_BIBLE §13 "Post" row)

| Tier | Passes built (in order) | Notes |
|---|---|---|
| low | scene + final | ONE fullscreen pass: grade + vignette + FXAA on tone-mapped taps |
| medium | scene + shafts + bloom + final + fxaa | shafts 24 samples half res; separate FXAA |
| high | scene + gtao + composite + shafts + bloom + dof + final + smaa | GTAO half res 2 slices; shafts 32 half; DoF hero / cutscenes; LUT 35 % |
| ultra | scene + gtao + contact + ssr + composite + shafts + bloom + dof + final + taa / smaa | GTAO full 3 slices; contact shadows close / hero bands; SSR; shafts 48 full res; lens dirt; DoF close bands; TAA hero band or `setTaa(true)`, SMAA otherwise |

Built passes disable themselves per frame when idle (shafts need the sun on screen and below 35 deg or strength
> 0.3; contact / DoF follow the zoom band), so the frame's list (`post.info().passes`) can be shorter.

### Reviewer fixes (inside GFX-01's paths)

| Commit | Fix |
|---|---|
| dad8e27 | Cascade memory: outer cascades half size with 3+ cascades (high 3 x 4096^2 ~384 MiB -> 192 MiB); allocation-free rig and sky per frame; baked-sky horizon ring feeds aerial perspective / map-edge fade when assets are attached; `copyZoomLookInto` (no aliasing of caller looks) |
| eb19a84 | `PostPipeline.setView` on a new scene resets per-scene inputs (focus override, forced TAA, zoom look, AgX): a hero / cutscene focus can no longer leak DoF + TAA into the next battle |
| d480114 | Lightning: the flash light is anchored at focus + bearing every frame (from the second strike on it sat near the world origin: wrong direction away from the map centre); the light joins the scene at `setEnvironment` for storm / monsoon rain, so the first strike no longer recompiles every lit material mid-storm |
| c4e8fe2 | Allocation-free per-frame profiler stats feed |
| 800ef43 (swept into a Studio Head WIP snapshot before the reviewer's commit) | Far zoom bands use fewer cascades (`activeCascadesFor`: strategic 1, operational 2; tactical and closer keep the tier's 1 / 2 / 3 / 4). Idle cascades keep their light and map (no recompile, no re-allocation when zooming), are weighted 0 in the shader and skip their shadow render. Fixes the world-map budget miss above; the operational / strategic frames are pixel-identical (row means equal before / after) |

### Open items outside GFX-01's paths (not blocking this ticket)

- **Art Director co-sign** of the look (this folder + `review/`). Questions from the developer stand: 18.9 h in
  sharad resolves to the night preset (`style/lighting.ts`), hero-band DoF strength (`style/zoom.ts`), shaft
  strength against a low sun, LUT strength.
- **CTO**: `render.attachAssets(assets)` in `src/main.ts` so game scenes get the baked WP7 skies, LUTs, lens dirt
  and sun sprite (today only the labs show them).
- **GFX-02**: outer terrain skirt (operational / strategic zoom still reads as a tile in haze, no seam);
  `WETNESS_GLSL` in `splat.ts`; water writes its SSR weight to alpha and uses `injectHeightFog`; weather calls
  `env.triggerLightning()`.
- **GFX-05 / GP-02**: pass ZoomLook into `env.update(dt, camera, look)`; hero / cutscene focus via `post.setFocus`.

## Rework round 1 - Art Director blockers (`docs/art/reviews/gfx-01.md`)

Every PNG in this folder and `report.json` were re-captured after the fixes (`scripts/shots/gfx-01.cjs`, 46 PNGs,
`failures: []`, 0 console errors in every shot). The resolution scale is now pinned to 1 in every capture, so the
low / medium / high shots show the tier rather than SwiftShader speed. The `review/` folder holds the round-1 state
(the "before" of each blocker).

| # | Blocker | Fix (commit) | Evidence |
|---|---|---|---|
| 1 | Monsoon not wet in today's scenes | a2c5418. A global chunk patch on `metalnessmap_fragment` reaches every MeshStandard/Physical (W15, like the fog chunk). Porosity = `smoothstep(0.35, 0.9, roughness) x (1 - metalness)`; orientation weights walls 0.9 / up 1 / overhangs 0.6; albedo `x mix(1, 0.52, wet)`; roughness toward 0.12 (weight 0.85). Puddles stay with `createPbrMaterial` and the splat hook. Opt-outs: `SAM_OWN_WETNESS` (pbr, splat, the legacy terrain shader, which keeps its own 0.28 x wetness) and `SAM_WET_POROSITY` (the vegetation group: 0.45). Weather dampness below 0.15 no longer shows. | Albedo at wetness 0.85 (unit-tested CPU mirror): plaster / sandstone walls x0.63-0.68, roughness 0.39-0.44; foliage 18 % darker; terrain 24 % darker; nothing changes at 0, on metals or on polish. Rendered A/B in the same frozen frame (`hero-monsoon-ultra.png` vs `hero-monsoon-ultra-dry.png`), linear luminance wet / dry: plaster near 0.71, plaster far 0.74, red base 0.69. The tone curve and the added gloss compress the 0.63-0.68 albedo ratio on screen. Against `hero-noon-ultra.png`: plaster 0.62-0.75, red base 0.51, terrain 0.40 (light changes too). |
| 2 | Low-tier acne / saw-tooth | e859dc9. The low tier's 'hard' cascade now uses `samShadowTent`: nine bilinear 2x2 compares folded into one 4x4 fetch (16 taps, the cost of three's PCF). The footprint is fixed, so there is no penumbra growth. A slope-scaled depth bias (0.6 texel x tan, capped at 6) from `dot(N, L)`. Normal bias 2.2 texels and depth bias 0.8 texel on low. Back faces render into the map (three's default for FrontSide). The cascade is fitted to the hero band (49 m). | `hero-noon-low.png`: no streaks on the red building and no eave comb on the plaster house. `hero-golden-low.png`: the ridge shadow on the red wall is a soft ramp, no teeth. Also `hero-night-low.png`, phone portrait `hero-noon-low-phone.png` / `hero-golden-low-phone.png` (390x844), and `battle-*-low.png` at the same 24 draws. |
| 3 | Near-field DoF hard silhouette | 2910c9f. A near layer: near CoC tile max over 8x8 px, 3x3 dilation, half-res near gather with the dilated radius (near-field samples only), composited with `alpha = coverage x smoothstep(0, 1, dilatedNearCoc / 2 px)`. The far-field rule is unchanged. `post.setDofNearField(on)`; lab `&dofnear=0` gives the single layer, `&near=1` a pillar 1.6 m in front of the lens. | `lab-post-hero-dof-focus12.png` vs `-single.png`: luminance just outside the cape edge 0.624 -> 0.607 (the foreground now spreads over the column); just inside 0.148 -> 0.125 (fewer background bites). `lab-post-hero-dof-nearpillar.png` vs `-single.png`: the pillar edge melts over the railing. |
| 4 | Low-sun shafts + bloom clip 8 % | 09f351c. Measured first: with shafts off the frame still clipped 4.95 %, also with bloom off. 68-96 % of clipped pixels were red-only: the warm display-referred grade + LUT pushed a cream sky past 1 in one channel. Shafts are now `luminance x fog in-scatter tint`, soft-clamped to 1.5x the local pre-shaft radiance (pixel or +-0.04 uv neighbourhood, display-relative floor), and fade inside the sun sprite's glow. The occlusion mask clamps display-relatively, so the sprite does not feed the scatter. A hue-preserving highlight shoulder follows grade + LUT (knee 0.9). `shaftsStrength` is unchanged as authored. | `lab-post-hero-taa-on/off.png`: clipped 7.9-8.0 % -> **0.00 %**, p98 luma 249 -> **240.2**. The sky between the columns keeps its warm-to-pale gradient; lamp bloom and lens dirt stay. Both in `report.json` `checks.labHeroClip`. The script fails above 2 % or p98 > 245. |

Non-blocking notes:
- **Dusk:** the procedural sky keeps a warm afterglow band on the solar-azimuth horizon, fading through plum. Full
  strength down to -4 deg, gone at -10 deg; part of the sky radiance, so the IBL follows (48b77b1). Re-shot at
  18.4 h: `battle-dusk184-ultra.png`, `hero-dusk184-ultra.png`. The resolver now returns `dusk` there. The default
  cameras face away from the western glow; the band shows toward the sun.
- **Dawn mist:** the fog base and the mist-slab top follow the ground under the camera focus (eased 2 s). They were
  absolute y = 0 while Rajapura sits well above it. See `hero-dawn-ultra.png`.
- **Evidence hygiene:** resolution scale pinned to 1 in the shots script (`__SAMRAJYA_GFX__.pinResolutionScale`).
  `scripts/smoke.cjs` belongs to the CTO (request filed).
- **Dark band at the strategic map's left edge** (`zoom-world-strategic.png`): not lighting. It is in the same
  place at 12 h and 16 h, on low (no GTAO, a different shadow filter) and inside the single cascade under `?csm=1`.
  Most likely cause: terrain below the water level, darkened x0.55 by `terrain.ts` with no water plane over it
  near the edge. Owner: GFX-02 / terrain. The grey wedge is the map-edge fade into the horizon colour; the outer
  terrain skirt is GFX-02's.
- **Low-tier detached tree shadows** (`battle-golden-low.png`): the tent filter softens them. The hero has no
  shadow on low because `soldierRenderer.ts` disables `castShadow` on low (GP-01's file; request filed).

Rework results (`report.json`): night lower-half luma 0.140 ultra / 0.148 low. Seam row-jump 1.14 / 1.09.
Cascades 4 PCSS / 3 PCSS / 2 PCF / 1 tent. Tier cycling x3: 11 tex / 30 geo / 3 RT at every return to low.
Context loss: restored, 53 draws.

Draw calls, before -> after:

| Bench | Before GFX-01 | Now |
|---|---|---|
| battle 1,000 @high | 81 | 72 (36 shadow) |
| battle river 5,000 @high | 81 | 72 (36 shadow) |
| battle mobile @low | 26 | 24 (5 shadow) |

The post-stack draw count rises by 3 when DoF runs (tiles, dilation, near gather).
