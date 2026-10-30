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
