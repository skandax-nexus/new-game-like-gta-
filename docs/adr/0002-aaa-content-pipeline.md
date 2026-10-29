# ADR 0002 - AAA content pipeline: Blender-as-code -> gltf-transform -> tiered runtime assets

- Status: Accepted (CTO + Technical Art Director)
- Supersedes: the "all art is procedural at runtime, no asset files" rule of ADR 0001 / CLAUDE.md v1.
- Context: the client's references are *Black Myth: Wukong* (close-up fidelity: weathered carved stone,
  dense materials, cinematic light) and *Age of Empires IV* (readable strategy layer). Runtime-generated
  vertex-colored geometry (render/architecture) reads well at strategy zoom but cannot reach that bar
  up close. We have no Unreal Engine and no GPU here, but Blender 5.2 runs headless as a Python module
  (Cycles CPU baking works), and npm offers gltf-transform, meshoptimizer and sharp.

## Decision

1. **Assets are code.** Every asset is a deterministic Python script in `tools/blender/assets/<category>/<id>.py`
   built on the shared library `tools/blender/lib/` (scene reset + seeding, numpy texture synthesis,
   ornament height fields, stone weathering, trim-sheet sweep modeling, Cycles baking, LODs, rigs,
   animation clips, glTF export, physical sky bakes, preview renders). No hand-made binary sources;
   reviews happen on diffs of scripts plus preview PNGs.
2. **One runner.** `npm run assets [-- <id>]` (`tools/assets/build.mjs`) runs the scripts (incremental by a
   content hash of script + library + dependency hashes), then publishes optimized tiered files to
   `public/assets/` and generates the typed `src/assets/manifest.ts`. Budgets are enforced by the runner
   (`--check`) and by `tests/core/assets.test.ts`.
3. **Shared materials, not baked-in textures.** Models ship texture-less (meshopt GLB); their proxy
   materials carry `extras.samrajya_set` etc. and the runtime binds shared tiling sets / trim sheets
   (e.g. `sandstone_carved_red`) for the active tier. Per-model uniqueness comes from a small macro map on
   UV2 (AO + grime). This keeps the payload small and lets a texture update re-skin every building.
4. **Tiers.** ultra / high / mobile = 2048 / 1024 / 512 px textures (WebP: lossy for color/ORM, near-lossless
   for normals), DWAB half-float EXR skies (2048 / 1024 / 512 wide), LOD selection per tier. Quality tier
   -> asset tier: ultra -> ultra, high -> high, medium/low -> mobile; `?assets=` overrides, `off` forces the
   procedural fallbacks.
5. **Never break the game.** `AssetManager` falls back per asset: registered procedural factories (e.g. the
   render/architecture stupa), bounds-sized blocks, factor-only PBR materials, the procedural sky. The
   single-file build ships without assets (fallbacks only); **`dist/` (index.html + assets/) is the shipped
   product.**
6. **Critique loop.** Every asset script renders Cycles previews; artists (agents) must inspect them with
   the Read tool, iterate, and check the in-engine view (`?scene=assetviewer&asset=<id>`) before committing.

## Options considered

| Option | Verdict |
|---|---|
| Keep runtime-procedural art only | Cheap and tiny, but cannot reach carved-stone / hero close-up fidelity. Kept as the fallback layer and for strategy-zoom crowds of buildings. |
| Hand-authored DCC assets | Not possible for an AI-agent studio without a GUI; not reviewable as text. |
| Blender scripts + Cycles bakes (chosen) | Deterministic, diffable, reproducible on any machine with Blender; Cycles CPU bakes AO/normals/texture sets; previews give a visual review loop. |
| KTX2/Basis textures | Best GPU memory, but no encoder (toktx/basisu) in the toolchain; WebP + per-tier sizes now, KTX2 is a future drop-in in `publish.mjs` + `AssetManager.fetchTexture`. |
| Draco geometry | Unavailable in the headless exporter; meshopt (EXT_meshopt_compression + quantization) is equal or better for web and decodes faster. |
| Downloaded CC0 libraries (Poly Haven, ambientCG) | Blocked by network policy. `@pmndrs/assets` (npm) provides small CC0 HDRIs usable for lookdev; our skies are baked from Blender's physical sky so they match the time-of-day system. |

## Consequences

- New dependencies (dev only): `@gltf-transform/{cli,core,extensions,functions}`, `meshoptimizer`, `sharp`,
  `@pmndrs/assets`. Blender itself is a machine prerequisite (`BLENDER_PY`, default
  `/root/.venvs/blender/bin/python`); CI without Blender still builds the game from committed outputs.
- Generated files are committed (`public/assets/**`, `tools/assets/published.json`, `src/assets/manifest.ts`)
  and must never be edited by hand. The `.asset-cache/` is local and ignored.
- Repository size grows with binary outputs; the per-tier payload budget (ultra 80 MB, high 40 MB,
  mobile 15 MB; single file <= 8 MB) bounds it.
- Bakes are slow on CPU (a 2048 material ~7 min, the stupa ~10 min); use `--draft` while iterating and
  never publish drafts (the runner refuses).
