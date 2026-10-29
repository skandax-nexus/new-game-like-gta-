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
(`loaders/lodFade.ts`: Bayer 4x4 discard in a 12 % band, `LOD_DITHER_GLSL` for custom shaders).

### Runner (A1-A3)

- **Publish lock.** `.asset-cache/.publish.lock` (O_EXCL file with pid + timestamp, stale after 30 min,
  `flock`-compatible: an ancestor holding `flock` on the same path is detected through `/proc/locks`).
  Blender runs outside the lock; only "re-read published.json -> merge this run's records -> write ->
  manifest -> budgets" is serialized, so concurrent runs by different artists never lose each other's
  entries. `--check` is lock-free.
- **Hashing.** An asset's input hash covers its script, the shared `lib/` modules, sibling `_*.py` helpers it
  imports (transitively), `@style` values (resolved from `src/render/style/*.ts` and passed to Blender as
  `SAMRAJYA_STYLE`) and `@inputs` files; legacy hashes are unchanged when none of those exist.
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
  dummy reconstructs within 0.47 mm (LOD0) / 0.32 mm (LOD1).
- **Mesh** GLB: single primitive, `COLOR_0` = R team mask, G cloth seed, B part id (`partColors` in the
  manifest), meshopt **quantize only** (no reordering - vertex i must stay texel column i; the publisher
  verifies positions bit-exact).
- **Data** `.vat`: `gzip(byte-shuffled half-float position planes + RG8 normals)`. Why not WebP/PNG/KTX2: half
  floats do not survive 8-bit image codecs, KTX2/Basis would need a new dependency, and byte-plane shuffling +
  gzip gets 2-3x on smooth animation data; the browser decodes it off the main thread with
  `DecompressionStream`, no library needed.
- **Runtime:** `createVatMaterial(lod, { partColors, teamColor | instanced team, clothVariation, time })` patches a
  `MeshStandardMaterial` (`texelFetch` by `gl_VertexID`, two-frame lerp, loop / clamp), `createVatDepthMaterial`
  for shadows, `createVatInstancedMesh(lod, count, ...)` with per-instance `vatClip` (start, frames, fps, loop),
  `vatPlay` (phase, rate) and `vatTeam`; `setVatInstance(mesh, i, vat.clip('walk'), phase, rate, team)`.
  **One InstancedMesh per LOD = 1 color draw + 1 shadow draw per scene pass** regardless of count
  (500-soldier test crowd: 2 LODs -> 2 + 2 draws per pass; see docs/sprint1/ta-07/).

### Impostors - distant vegetation and monuments

- **Capture** (`lib/impostor.py capture()`): hemi-octahedral 8 x 8 views (frame k at uv = i / (N - 1) of the
  octahedral domain), orthographic, framing the bounding sphere; per frame albedo + coverage (alpha) and
  object-space normal + depth (`depth = 0.5 + dot(P - C, d) / (2 r)`), emission-override renders in Cycles.
- **Publish:** albedo at 256 / 192 / 128 px per frame (2048 / 1536 / 1024 atlases), normal + depth at half
  resolution (lossy WebP q92 + alpha q95 - normals at full res were 2.8 MB).
- **Runtime:** `createImpostorMesh(handle)` = camera-facing quad whose shader blends the 3 nearest frames
  (barycentric), reprojects each by its depth so the parallax matches, lights with the stored normals
  (`MeshStandardMaterial`, alpha-test 0.5, depth material for shadows). Switch distance comes from the
  manifest (`switchDistance`, 90 m for the test tree). A/B at 220 m: see the TA-07 report.

### Flipbooks - VFX

- **Authoring** (`lib/flipbook.py`): numpy particle volumes (divergence-free curl noise, age bands blurred
  more as they age = expansion, buoyancy / heat / drag) -> density (+ temperature) grids -> precomputed
  lighting (`light_volume`: optical depth to the key + blurred ambient occlusion) -> **Cycles
  emission-absorption render** of the grid through a 2D slice-atlas volume shader (Blender 5 has no Point
  Density node and no OpenVDB in the bpy wheel). 2D sprites (sparks, rain, leaves, trails) are drawn in numpy.
  `loop_blend` cross-fades simulated fields for seamless loops.
  Why not render particles as meshes or use Mantaflow: Mantaflow needs a GUI-era cache and minutes per
  frame on CPU; the numpy + slice-atlas path is deterministic, ~5 s per 128 px frame, and keeps everything
  scriptable and diff-reviewable.
- **Format:** atlas `cols x rows` (frame k row-major from the top-left, flipY false), `sequences`
  (name, start, count, fps, loop, optional per-sequence `blend` / `lit` overrides), `blend` alpha | additive |
  premultiplied, `lit` (normal map present: the particle is lit by the sun - smoke, dust, mist, leaves),
  `emissiveIntensity`, `softFadeMeters`, `sizeMeters`, `tint`. Color is sRGB, alpha linear; normals are
  tangent space (+Y up).
- **Publish:** color atlas at `atlasPx` per tier (lossy WebP q86 + alpha q90; additive-only books drop the
  redundant alpha), normal atlas at half resolution, lossy q90 (`FLIPBOOK_NORMAL_SCALE`: soft volume normals
  lose nothing visible and the payload halves), same grid so the UVs are shared.
- **Runtime:** `frameAt(seq, t)`, `frameRect(entry, k)` are the contract for the particle system;
  `createFlipbookMaterial(handle, { sequence, lit, tint })` is the reference quad material (two-frame
  cross-fade, derivative-TBN normals, premultiplied blending via `CustomBlending` ONE / ONE_MINUS_SRC_ALPHA).

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
lighting:LIGHTING_PRESETS.<preset>`): Nishita bake via `lib/sky.bake_sky`, weather treatment in numpy (night:
moonlit dome + stars + Milky Way, moon removed and exported as the manifest `sun`; overcast: CIE dome over a
cloud deck; dusk: afterglow band + under-lit clouds; haze / fog: blend to the preset fog tone), then
**calibrated so `ambientIrradiance` equals the preset's `sky.irradiance`** (environmentIntensity = 1 under the
matching preset, ART_BIBLE §4.4) and re-encoded as DWAB EXR at DWA quality 40 / 45 / 42 (ultra / high /
mobile) - ~200 KB at 2048 instead of ~600 KB, with no visible artifacts on smooth skies.

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
const crowd = createVatInstancedMesh(lod, 500, mat, createVatDepthMaterial(lod, time));
setVatInstance(crowd, i, vat!.clip('walk')!, phase, 1, teamColor);

const imp = await ctx.assets.loadImpostor('impostor_test_tree');   // ImpostorHandle | null
scene.add(createImpostorMesh(imp!));

const fb = await ctx.assets.loadFlipbook('fx_smoke');              // FlipbookHandle | null
const smoke = createFlipbookMaterial(fb!, { sequence: 'all' });
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
- Engines that render the scene with an override material (e.g. the GTAO normal pre-pass) see VAT meshes in
  their rest pose; graphics should render VAT meshes with their own normal / depth materials in such passes.
