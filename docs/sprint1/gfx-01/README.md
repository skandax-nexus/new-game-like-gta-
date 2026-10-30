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

RESULTS_PLACEHOLDER
