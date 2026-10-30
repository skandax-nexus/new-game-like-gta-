# ADR 0003 - Crowd, impostor, VFX, grade and image assets (VAT, impostor, flipbook, lut, image)

- Status: Accepted (Technical Artist G - Pipeline TD, Skies & VFX; ticket TA-07)
- Extends: ADR 0002 (AAA content pipeline). Same principles: assets are deterministic scripts, one runner,
  tiered outputs, typed manifest, never break the game (every loader resolves to `null` when assets are off,
  missing or failed, and the caller keeps its procedural path).
- Context: Sprint 1 needs thousands of animated soldiers on screen (GDD battles), dense vegetation and
  monuments at strategy distance, sun-lit smoke / fire / dust, time-of-day skies and color grades, all in a
  browser on PC and phones, with no GPU in the build environment and no new npm dependencies.

## Decision

Five new asset kinds join `material | model | hdri` in `tools/assets/config.mjs` `KINDS`, each with a Blender
library module, a publisher, a manifest entry type, a typed id union and a ref-counted runtime loader.

| Kind | Blender library | Published files (public/assets/) | Manifest type / id union | Runtime |
|---|---|---|---|---|
| `vat` | `lib/vat.py` | `vat/<id>/<id>.lod<N>.glb` + `.lod<N>.vat` (+ optional impostor sheet) | `VatAssetEntry` / `VatAssetId` | `assets.loadVat()` -> `VatHandle`; `loaders/vat.ts` |
| `impostor` | `lib/impostor.py` | `impostors/<id>/{albedo,normal}_<size>.webp` | `ImpostorAssetEntry` / `ImpostorAssetId` | `assets.loadImpostor()`; `loaders/impostor.ts` |
| `flipbook` | `lib/flipbook.py` | `fx/<id>/{color,normal,emissive}_<size>.webp` | `FlipbookAssetEntry` / `FlipbookAssetId` | `assets.loadFlipbook()`; `loaders/flipbook.ts` |
| `lut` | `assets/luts/_lut.py` | `luts/<id>.png` (lossless) | `LutAssetEntry` / `LutAssetId` | `assets.loadLut()` -> `Data3DTexture`; `loaders/lut.ts` |
| `image` | `assets/images/_image.py` | `images/<id>/<id>_<w>.webp` | `ImageAssetEntry` / `ImageAssetId` | `assets.loadImage()` |

Models gained metadata in the same change: `skinned`, `clipEvents` (`{clip: [{type, time}]}`, types in
`CLIP_EVENT_TYPES`, custom `x_*`), `rootMotion`, `construction` (footprint GLB, scaffold, course heights),
`sockets` (bone-relative), `variants` (named node sets; published with `keepNodes`) and free `meta`
(<= 16 KB JSON). Skinned models load as independent `SkeletonUtils` clones (LOD levels share LOD0's skeleton,
`skeleton.dispose()` on release) and `loadModel(id, { crossFade: true })` returns a dithered `CrossFadeLOD`
(`loaders/lodFade.ts`: Bayer 4x4 discard in a 12 % band, `LOD_DITHER_GLSL` for custom shaders). The shader
measures the same distance as the CPU (LOD root origin / camera zoom, `lodFadeOrigin` uniform kept up to date by
`CrossFadeLOD.update`), so the GPU fade bands line up with the CPU visibility bands; inside a band only the
current level casts a shadow (no double shadow).

### Runner (A1-A3)

- **Publish lock.** `.asset-cache/.publish.lock` holds a JSON owner record (pid, host, start time, nonce, ids),
  stale after 30 min or when the owner pid is gone. Blender runs outside the lock; only "re-read
  published.json -> merge this run's records -> write -> manifest -> budgets" is serialized, so concurrent runs
  by different artists never lose each other's entries. `--check` is lock-free (it warns about DIRTY assets).
  - *Atomic create:* the record is written to a private temp file and **hard-linked** into place (`link(2)`
    fails with EEXIST when the lock exists), so the lock path is never visible empty. (The first version
    opened with O_EXCL and wrote afterwards; an empty file with no flock holder reads as a free flock(1)
    sentinel, so a second runner could take the lock in that window - CTO review, reproduced.)
  - *Stale break:* serialized by a second short-lived lock `.publish.lock.break` (created the same way). Under
    it the breaker re-reads the record (same inode, same text, still stale), renames the file aside (atomic),
    verifies the renamed content is still the stale record and only then deletes it, else links it back. Two
    waiters never break the same record twice or delete a fresh lock created in between.
  - *Release:* rename aside + verify + delete (excl); truncate in place (flock modes).
  - *flock compatibility* (STUDIO W3): an empty lock file is a flock(1) sentinel. An ancestor holding `flock` on
    it (found through `/proc/locks`) means we already own it; otherwise the runner waits for the holder or takes
    the OS lock with a helper `flock -n` process and writes its record in place.
  - *Tests* (`tests/assets/publish-lock.test.ts`): concurrent runs, flock(1)-wrapped runs mixed with plain runs,
    stale recovery, lock-free `--check`, a stall injected right after the lock path appears (3 runners) and two
    waiters breaking the same stale lock; every critical section is traced (`SAMRAJYA_PUBLISH_LOCK_TRACE`) and must
    strictly alternate. The two race tests fail on the first version of the lock and pass on this one.
- **Hashing.** An asset's input hash covers its script, the shared `lib/` modules (`from lib import a, b`, the
  parenthesized multi-line form, `from lib.x import`), sibling `_*.py` helpers it imports (transitively), `@style`
  values (resolved from `src/render/style/*.ts` and passed to Blender as `SAMRAJYA_STYLE`) and `@inputs` files;
  legacy hashes are unchanged when none of those exist. The cache stamp (`.inputhash`) is deleted before Blender
  starts, so an interrupted bake can never be reused under the old hash.
- **Tags.** `@tiers ultra,high` restricts shipping tiers; `@fallback <id>` names the asset the runtime resolves
  instead on other tiers (e.g. `sky_fog` -> `sky_overcast` on mobile). `--previews-dir <dir>` copies the Cycles
  previews of every asset just baked.
- **Budgets.** `PACKAGES` in `config.mjs` assigns categories to work packages with per-tier MB budgets
  (WP7 = hdri, fx, banners, luts, images: 4 / 2 / 0.6 MB); `--list` prints per-asset KB and package totals,
  `--check` fails over budget.

### VAT (vertex animation textures) - crowds

- **Bake** (`lib/vat.py bake()`): every clip of the armature is sampled at 15 fps on each LOD mesh; positions are
  stored as **offsets from the rest pose** (rest = `idle` frame 0, kept in the GLB) in RGB half float, normals
  octahedral-encoded in RG8. One texel column per vertex, rows wrap at <= 4096 px
  (`rowsPerFrame = ceil(vertices / width)`); all clips are stacked in one texture with a clip table
  (start frame, frames, loop, measured `strideMeters` / `speed` from planted feet for foot-locked playback).
  The bake re-evaluates the decoded data against Blender and fails above `max_error_mm` (1.0); the test
  dummy reconstructs within 0.47 mm (LOD0) / 0.42 mm (LOD1).
- **Mesh** GLB: single primitive, `COLOR_0` = R team mask, G cloth seed, B part id (`partColors` in the
  manifest), meshopt **quantize only** (no reordering - vertex i must stay texel column i; the publisher
  verifies positions bit-exact).
- **Data** `.vat`: `gzip(byte-shuffled half-float position planes + RG8 normals)`. Why not WebP/PNG/KTX2: half
  floats do not survive 8-bit image codecs, KTX2/Basis would need a new dependency, and byte-plane shuffling +
  gzip gets 2-3x on smooth animation data; the browser decodes it off the main thread with
  `DecompressionStream`, no library needed.
- **Runtime:** `createVatMaterial(lod, { partColors, teamColor | instanced team, clothVariation, time })` patches a
  `MeshStandardMaterial` (`texelFetch` by `gl_VertexID`, two-frame lerp, loop / clamp);
  `createVatInstancedMesh(lod, count, material, { depth?, prepass? })` builds the InstancedMesh with per-instance
  `vatClip` (start, frames, fps, loop), `vatPlay` (phase, rate) and `vatTeam`, and gives every pass the animated
  pose: `customDepthMaterial` (shadow map), `customDistanceMaterial` (point-light shadows) and the prepass tag
  (below: `'replace'` with a VAT-patched `MeshNormalMaterial` by default, `'skip'` for far LODs).
  `setVatInstance(mesh, i, vat.clip('walk'), phase, rate, team)`; `mesh.userData.dispose()` frees what the helper
  created. **One InstancedMesh per LOD = 1 color draw + 1 shadow draw** regardless of count, + 1 posed draw in
  the GTAO / SSAO pre-pass on high / ultra (500-soldier test crowd, 2 LODs: see docs/sprint1/ta-07/).

### Impostors - distant vegetation and monuments

- **Capture** (`lib/impostor.py capture()`): hemi-octahedral 8 x 8 views (frame k at uv = i / (N - 1) of the
  octahedral domain), orthographic, framing the bounding sphere; per frame albedo + coverage (alpha) and
  object-space normal + depth (`depth = 0.5 + dot(P - C, d) / (2 r)`), emission-override renders in Cycles.
- **Publish:** albedo at 256 / 192 / 128 px per frame (2048 / 1536 / 1024 atlases), normal + depth at half
  resolution (lossy WebP q92 + alpha q95 - normals at full res were 2.8 MB).
- **Runtime:** `createImpostorMesh(handle)` = camera-facing quad whose shader blends the 3 nearest frames
  (barycentric), reprojects the quad into each frame's capture plane, lights with the stored normals
  (`MeshStandardMaterial`, alpha-test 0.5) and carries depth / distance materials for shadows. In the AO
  pre-pass (prepass `'replace'`) it draws the same billboard with its coverage cut-out, the atlas normals and a
  per-pixel **depth relief** from normal.a (`gl_FragDepth`), so GTAO sees the canopy's shape instead of a flat
  card (the main color pass does not offset depth). Switch distance comes from the manifest (`switchDistance`,
  90 m for the test tree). A/B at 220 m (quality high): mean luminance of the crop differs by 2.7 %, of the tree pixels
  alone by 9.3 % (the impostor is a little brighter: baked normals vs the live mesh shading).

### Flipbooks - VFX

- **Authoring** (`lib/flipbook.py`), rework round 1:
  - **Simulation:** `FluidSim`, an Eulerian smoke / fire / dust solver in numpy ("stable fluids": buoyancy from
    temperature, weight from density, vorticity confinement, RK2 semi-Lagrangian advection, an exact spectral
    pressure projection with an optional prescribed divergence for expanding hot gas, a free-slip floor by
    mirroring, sponge layers at the open borders, passive scalars such as a flow-advected detail noise).
    Grids of 1-2.3 M cells (fire 99 x 70 x 141 at 1.35 cm, smoke 136 x 109 x 157 at 2.2 cm), 0.5-1 s per step on
    one CPU, deterministic. It replaces the curl-noise particle splats for fire / smoke / dust, which could not
    make flame tongues or rolling lobes (Technical Art Director / Art Director review). `ParticleVolume` stays
    for light effects.
  - **Rendering:** `integrate_volume` evaluates the emission-absorption integral EXACTLY (front-to-back compositing
    of piecewise-constant voxels, 2 sub-slices per voxel, bilinear resampling to the frame) instead of estimating
    it with Cycles - no sampling grain at any resolution, ~0.1-1 s per frame. The Cycles slice-atlas renderer
    (`render_volumes`) remains in the library and in the selftest as the reference. Lighting: `light_volume`
    (ambient occlusion baked in the colour) + **density-gradient normals** (`density_normals`, the
    transmittance-weighted outward normal along each pixel's ray), so the runtime sun gives a lit top and a
    shaded side; fire uses a temperature ramp with a steep ignition threshold (crisp tongues) and no soot.
  - 2D sprites (sparks, rain, leaves, trails, mist) are drawn in numpy with `frame_window` (exact zero at the
    border). `loop_blend` cross-fades simulated fields for seamless loops.
  Why not Mantaflow: it needs a GUI-era cache and minutes per frame on CPU; the numpy solver is deterministic,
  scriptable and diff-reviewable, and its output is integrated without noise.
- **Format:** atlas `cols x rows` (frame k row-major from the top-left, flipY false), `sequences`
  (name, start, count, fps, loop, optional per-sequence `blend` / `lit` overrides, `openEdges`), `blend` alpha | additive |
  premultiplied, `lit` (normal map present: the particle is lit by the sun - smoke, dust, mist, leaves),
  `emissiveIntensity`, `softFadeMeters`, `sizeMeters`, `groundLine` (grounded books: the fraction of the frame height
  above its bottom edge where the effect meets the ground - fire 0.13, dust 0.023; sink the quad by that much; null
  = free-floating), `tint`. Color is sRGB, alpha linear; normals are
  tangent space (+Y up).
- **Publish:** color atlas at `atlasPx` per tier (lossy WebP q86 + alpha q90; additive-only books drop the
  redundant alpha; `encoding: 'lossless' | 'near_lossless'` overrides it - fx_sparks_embers is lossless because
  4:2:0 chroma put cyan fringes on its thin streaks; fx_lightning / fx_weapon_trail too, see border guard; fx_fire
  and fx_weapon_trail are gradient-mapped and lossless, see below), normal
  atlas at half resolution, lossy q90 (`FLIPBOOK_NORMAL_SCALE`), same grid so the UVs are shared. fx_fire and fx_smoke ship 2048 atlases (256 px
  frames) on ultra (Art Director decision), 1024 on high, 512 on mobile.
- **Border guard:** `flipbook.write()` fails the bake when any frame's outer 2 px carry coverage / emission above
  2/255 (8-bit encoded values), checked at the source resolution and after downsampling to the smallest shipped
  frame size (a puff cut by its frame edge shows as a hard straight line on the particle quad). Sequences that
  must touch an edge opt out per edge with `"open_edges": ["left", ...]` (weapon-trail ribbons, ground-hitting
  bolts), published per sequence as `openEdges`. The runner repeats the check on every **encoded** tier atlas
  after WebP compression (`publish.mjs flipbookBorderProblems`; the encoded file replaces the published one only
  when it passes): lossy ringing, lanczos down-sampling and bleed from a neighbouring frame's open edge only appear
  there (fx_lightning's ground strikes put 8-10/255 on the closed top edge of the frames below them; fx_fire's base
  reached the bottom edge of its 64 px mobile frames). **Layout rule:** an open edge must lie on the atlas border or
  against another open edge - texture filtering and mipmaps blend across frame seams at runtime (the reference
  material also insets its taps by half a texel). fx_lightning is one row of frames (bottoms on the atlas border),
  fx_weapon_trail is [noise | trail] / [noise_b | trail_wide]; both publish lossless. Grounded books keep a
  margin under the ground line (`groundLine`). Covered by the Blender selftest and
  `tests/assets/flipbook-borders.test.ts` (every published tier of every flipbook).
- **Runtime:** `frameAt(seq, t)`, `frameRect(entry, k)` are the contract for the particle system;
  `createFlipbookMaterial(handle, { sequence, lit, tint })` is the reference quad material (two-frame
  cross-fade, derivative-TBN normals, premultiplied blending via `CustomBlending` ONE / ONE_MINUS_SRC_ALPHA with
  `material.premultipliedAlpha` OFF - three's PREMULTIPLIED_ALPHA chunk multiplies rgb by alpha a second time, which
  showed the fire as rgb x occlusion with dark wisps (rework round 1) - additive and premultiplied books multiplied by
  `emissiveIntensity`, opacity fading premultiplied emission too). Premultiplied atlases are published without the
  RGB bleed that straight-alpha atlases get (their RGB under alpha 0 is emission, not filler). It tags the material prepass `'skip'`;
  `createFlipbookMesh(handle, opts, geometry?)` (or `installPrepassGuard(mesh, 'skip')` on the particle system's own
  mesh) enforces it.

#### Lit flipbooks are a participating medium (rework round 2, contract for GFX-04)

Smoke and dust lit with solid-surface normals and plain Lambert read as creased, carved lumps with near-black pockets
under golden light (darkest smoke pixel RGB 9,0,0; dust shadows at 0.1 of the lit side - Art Director R2-B1). Both
halves change:

- **Bake** (`_fxkit.lit_frames`, `lib/flipbook.soften_normals`): the density gradient is taken from the density
  blurred by **3.5 % of the frame side** (`normal_blur_frac`: the puff's big rounded forms, no internal folds), the
  normal is mixed with flat by `normal_strength` (smoke 0.6, dust 0.55) and its tilt **fades with alpha**:
  `n = normalize(mix(+Z, n, smoothstep(0.1, 0.7, alpha)))` - thin fringes face the camera instead of carrying a hard
  silhouette. **Lit-medium guard:** `flipbook.write(min_normal_z=0.8)` fails the bake when the mean decoded normal z
  over covered pixels (alpha > 0.1) of the book or of any frame is below 0.8 (smoke 0.88 / worst frame 0.84, dust
  0.91 / 0.84; round 1 was 0.65 / 0.53). Every lit book logs mean z and its neighbour-angle p99.9.
  `tests/assets/fx-artifacts.test.ts` re-measures it on the shipped ultra and mobile atlases.
- **Runtime lighting** (`createFlipbookMaterial`, lit books; the particle system's own material must match):
  - sun: **wrap lighting** `(N.L + w) / (1 + w)`, `w = FLIP_WRAP = 0.5` (`opts.wrap` overrides; 0 = Lambert);
  - ambient (IBL / hemisphere lights / light probes): sampled along `normalize(N * FLIP_AMBIENT_TILT + up)`,
    `FLIP_AMBIENT_TILT = 0.5` - the **upper hemisphere** only: a puff is lit by the sky above it, never by the dark
    ground below;
  - **no specular** (direct, IBL, multi-scatter): a medium scatters, it does not reflect.
  Implementation: the three r170 physical chunks with three exact text substitutions (`FLIP_CHUNK_HOOKS`; a unit
  test fails if a three upgrade changes them) and `material.specularColor = 0`, `specularF90 = 0`.

#### Gradient-mapped emission (`ramp`, rework round 2)

`FlipbookAssetEntry.ramp` (null for ordinary books): the colour atlas stores **one channel** `v` - the sRGB-encoded
luminance of the emission, R = G = B, loaded **without** colour conversion - plus alpha; the colour is
`rgb = ramp(v)`, 2..33 linear-rgb stops evenly spaced over v (piecewise linear: `rampColor` / GLSL
`flipRampColor`), `ramp[0] = black`, **R >= G >= B at every stop**. Why: fx_fire's lossy 4:2:0 WebP turned dim
emission around the tongues into green / blue / magenta 8x8 blocks (48.6k green-dominant texels at 2048), which x6.5
emission showed on the night sky; fx_weapon_trail's 8-bit RGB x3 showed 6-8 contour bands with red / green fringes
where its channels quantised at different steps (R2-B2b, R2-B3). One channel cannot drift in hue, and is smaller.

- **Bake:** `flipbook.ramp_fit` (fire: the mean simulated colour per v, then R >= G >= B and non-decreasing
  luminance enforced - 33 stops, mean |ramp(v) - simulated| 2.6/255) or `ramp_from_hues` (trail: authored hue stops
  ember red -> saffron -> gold -> warm-white, each scaled to the luminance v encodes); `ramp_encode` quantises v with
  **triangular dither of +-1 LSB** (values below 1 LSB round as before, so empty areas stay 0); `write(ramp=...)`
  checks R = G = B and the ramp rules and publishes `ramp`.
- **Publish:** ramp books must be `encoding: 'lossless'` (`flipbookRampProblems`, and every encoded tier must
  decode with R = G = B exactly - `flipbookChromaSpread`), so the dither and the zero chroma survive. fx_fire:
  ultra 2048 / high 1024 / mobile 512 lossless (smaller than the lossy RGB on mobile); fx_weapon_trail ships its 256
  atlas natively on every tier (frames drawn at 256, area-filtered to 128 and only then dithered - no resampling
  re-quantises the dither away).
- **Runtime:** `loadFlipbook` loads the colour map of a ramp book with `NoColorSpace`; the material adds
  `FLIP_RAMP` (stop count) and `uniform vec3 flipRamp[N]` and sets `flipC.rgb = flipRampColor(flipC.r)` before the
  blend math. Data sequences in a ramp book (the trail noises) are read raw from `.r` by their consumer.

#### Effect artifact gates (rework round 2)

- **fx_fire, no flat-topped blocks:** each hot spot of the fuel bed is a dome whose height follows the continuous
  noise (the slab source with one flat top showed through the ignition threshold as a detached glowing block at the
  rim, and as a flat foot at the base near the loop seam), confined to the inner ~80 % of the bed. The bake measures
  the longest straight horizontal top edge of any emitting shape per frame (`_fxkit.straight_top_edge`) and fails
  above 6 % of the frame width; the test re-measures the shipped atlas against the Art Director's 10 %.
- **parry_flash, never the wheel:** an open burst of 16 irregular streaks (jittered angles, varied length / width /
  curl, they leave the centre as they fly) and a soft gold core gone after 4 frames - no rim, no regular rays (the
  8-spoke wheel is the capital / heraldry motif, ART_BIBLE §1.3 / §1.5 / §8.7). The bake logs and the test checks
  closure (share of angles lit at the best radius beyond the core: 0.20, the old ring 1.00; limit 0.5) and 4- / 8-fold
  angular symmetry (0.22, the old wheel 0.37; limit 0.3).

### Override-material passes (prepass tag)

Passes that render the scene with `scene.overrideMaterial` - in three r170 the `GTAOPass` / `SSAOPass` normal +
depth pre-pass that `src/render/post.ts` runs on high / ultra - draw every mesh with one `MeshNormalMaterial` and
hide only Points and Lines. Without care, VAT crowds land in that buffer in their **rest pose**, impostors as
their raw 1 x 1 m quad at the object origin, and transparent particle quads as **opaque cards** (each flipbook quad
showed a rectangle with a dark AO halo - Art Director review).

- **Contract** (`src/assets/loaders/prepass.ts`): `object.userData.samrajyaPrepass` (or the material's userData) is
  - `'skip'` - never drawn in an override-material pass (transparent particles own no depth / normal);
  - `'replace'` - drawn with `userData.samrajyaPrepassMaterials.normal` when the override is a
    `MeshNormalMaterial` (the AO pre-passes): a normal material running the same vertex patch (VAT pose, impostor
    billboard + coverage cut-out + depth relief); skipped for any other override.
- **Enforcement is self-contained:** `installPrepassGuard(mesh, mode, materials?)` hooks `onBeforeRender` /
  `onAfterRender`; while an override is active it draws the replacement itself (`renderer.renderBufferDirect`) and
  suppresses the override draw (`geometry.drawRange.count = -1` makes three return before any GL call; restored
  in `onAfterRender`). The stock GTAOPass / SSAOPass therefore honour the tag today with no change to post.ts.
  Shadow passes use `customDepthMaterial` / `customDistanceMaterial` and never call `onBeforeRender`.
  Callers that need their own `onBeforeRender` must chain the existing handler.
- **Applied by:** `createVatInstancedMesh` (`'replace'`, or `'skip'` via options), `createImpostorMesh`
  (`'replace'`), `createFlipbookMaterial` (material tag `'skip'`) and `createFlipbookMesh` (guard installed).
- **Measured** (`scripts/shots/ta-07.cjs --only=gtao`, quality=ultra, GTAO on): in the empty corners of every
  flipbook quad the tagged shot matches the backdrop-only shot within 0.93/255 (target 1/255); untagged quads
  (`?prepass=off`, the pre-rework behaviour) differ by 3.5-10.2/255 (visible cards). VAT crowd: one InstancedMesh per
  LOD = 1 draw per pass (color, posed AO pre-pass, shadow); note three re-renders the shadow map in EVERY
  `renderer.render` call, so the GTAO pre-pass also re-renders shadows (change request to Lead Graphics below).
- **Change request to Lead Graphics (src/render/post.ts, optional but cheaper):** before
  `gtao.render()` / `ssao.render()`, hide (and restore after) every object for which
  `prepassModeOf(o) === 'skip'`, and every other transparent mesh with `depthWrite === false` that does not carry
  the tag (procedural particles, water sheets, decals created outside the TA-07 helpers). Tagged objects already
  work without it; the up-front hide saves a program switch per particle mesh. Do not hide `'replace'` objects.
  Also set `renderer.shadowMap.autoUpdate = false` and `needsUpdate = true` once per frame before the main pass:
  the AO pre-pass is a second `renderer.render` call and currently re-renders every shadow caster.

### LUTs and images

- **LUT:** 32^3 strip 1024 x 32, lossless PNG, three `LUTImageLoader` layout (blue slice b at x = 32 b, red along
  x, green 0 on the top row), display-referred (after tone mapping). Interim LUTs are generated from
  `GRADE_PRESETS` (render/style/palette.ts, via `@style`) with the post.ts grade math; an Art Director drop of
  `docs/art/luts/<id>.cube` re-bakes automatically (`@inputs`). Identity is exact (tests/assets/lut.test.ts,
  256^3 inputs within 1/255). Shipped on high / ultra (`@tiers`), applied at 35 % strength (ART_BIBLE §4.7);
  `createLutPassMaterial(texture, size, strength, split)` is the reference pass.
- **Image:** single 2D texture per tier (`tierPx`), `colorSpace`, `alpha`, `hdrScale` (multiply the decoded
  texel: `sun_sprite` stores L / 50 in sRGB, hdrScale 50) and a usage note.

### Skies (WP7)

Time-of-day / weather skies are generated from `LIGHTING_PRESETS` (`hdri/_skykit.py`, `@style
lighting:LIGHTING_PRESETS.<preset>`): Nishita bake via `lib/sky.bake_sky` (without its flat cloud layer), weather
treatment in numpy (night: moonlit dome + stars + Milky Way, moon removed and exported as the manifest `sun`;
overcast: a monsoon **nimbostratus deck** - continuous cover, darker rain-laden bases at ~0.62-0.75 x the deck,
ragged lighter thinning towards az 180, a brighter wet-haze band in the fog family over the last ~8 deg, two
distant rain shafts; dusk: afterglow band + afterglow-lit clouds; haze / fog: blend to the preset fog tone), then
**calibrated so `ambientIrradiance` equals the preset's `sky.irradiance`** (environmentIntensity = 1 under the
matching preset, ART_BIBLE §4.4) and re-encoded as DWAB EXR at DWA quality 40 / 45 / 42 (ultra / high /
mobile) - ~200 KB at 2048 instead of ~600 KB, with no visible artifacts on smooth skies.
- **Clouds** (`hdri/_clouds.py cloud_layer`) are shaded by the sun: domain-warped fBm eroded at the edges (wispy),
  optical depth marched towards the sun through the layer -> a 3-tone lit / mid / shadow ramp, darker thick bases,
  and a forward-scattering silver lining on thin edges within ~35 deg of the sun (dawn: warm lit sides, long
  shadows; noon: white tops, grey bases; dusk: lit from below by the afterglow; night: moonlit).
- **Horizon:** the lower hemisphere is rebuilt after calibration (`lower_hemisphere`): each column continues its
  horizon radiance and blends to the ground bounce (albedo x (E_sky + E_sun) / pi) over 5 deg. The Nishita render
  is black just below the horizon, so the first version baked a dark seam there (Art Director review: noon 0.453
  -> 0.018); now no row within 6 deg below the horizon is darker than 0.6 x the row above it. ambientIrradiance
  integrates only the upper hemisphere and is unchanged.

## Budgets

| | ultra | high | mobile |
|---|---|---|---|
| WP7 (skies, LUTs, VFX, banners, images) | 4 MB | 2 MB | 0.6 MB |
| test (pipeline_test viewer / QA assets) | 4 MB | 3 MB | 1.5 MB |
| VAT texture | <= 4096 px per side | | |
| Impostor atlas | 2048 | 1536 | 1024 |

Measured totals are printed by `npm run assets -- --list` (see the TA-07 report).

## Runtime API summary

```ts
const vat = await ctx.assets.loadVat('vat_test_dummy');            // VatHandle | null
const lod = vat!.lods[0]!;
const mat = createVatMaterial(lod, { partColors: vat!.entry.partColors.map((h) => new THREE.Color(h)) });
const crowd = createVatInstancedMesh(lod, 500, mat);              // shadow / distance / AO-prepass materials included
setVatInstance(crowd, i, vat!.clip('walk')!, phase, 1, teamColor);

const imp = await ctx.assets.loadImpostor('impostor_test_tree');   // ImpostorHandle | null
scene.add(createImpostorMesh(imp!));

const fb = await ctx.assets.loadFlipbook('fx_smoke');              // FlipbookHandle | null
const smoke = createFlipbookMaterial(fb!, { sequence: 'all' });   // or createFlipbookMesh(fb!, { sequence: 'all' })
smoke.userData.flipbookFrame.value = t * fb!.sequence('all')!.fps;   // sequence-relative, fractional (cross-faded)
// particle systems: frameAt(seq, t) -> atlas frame, frameRect(entry, k) -> uv rect

const lut = await ctx.assets.loadLut('lut_golden');                // LutHandle (Data3DTexture) | null
const sun = await ctx.assets.loadImage('sun_sprite');              // ImageHandle | null
const hero = await ctx.assets.loadModel('skin_test_character');    // independent skinned clone + clipEvents
// every handle: .release() (ref-counted; GPU memory freed at 0)
```

## Consequences

- Crowds, impostors and VFX scale with instance count, not with draw calls or unique geometry.
- The single-file build and `?assets=off` keep working: every new loader returns `null` without network
  access or console errors (verified by `scripts/shots/ta-07.cjs`).
- `lib/core.py` `KINDS` still lists only material | model | hdri: the new kinds start a model context and
  retag (`ctx.kind = ...`) until the CTO extends it.
- Override-material passes see the correct shapes (prepass tag above); renderers that add their own override
  passes get it for free as long as their override is a `MeshNormalMaterial` (else tagged objects are skipped).
- Multi-part loads (`loadModel`, `loadVat`, `loadImpostor`, `loadFlipbook`) track every cache acquisition in an
  `AcquireScope` (`loaders/scope.ts`) from the moment it starts: when one part fails, the parts that resolved -
  and those that resolve later - are released, so refs and GPU memory never leak on a flaky network
  (`tests/assets/asset-manager.test.ts`, real loaders against the published test assets with a mocked fetch).
