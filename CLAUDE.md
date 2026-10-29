# SAMRAJYA: Echoes of Bharat - Studio Handbook

Browser (WebGL2) open-world strategy-action game for PC + mobile, built from `docs/GDD.md`.
Read `docs/ARCHITECTURE.md` before writing code. Contracts live in `src/core/types.ts` (domain) and
`src/app/contracts.ts` (scenes / UI / session). Engine choice: `docs/adr/0001-engine-choice.md`;
content pipeline: `docs/adr/0002-aaa-content-pipeline.md` + ARCHITECTURE §18-20.

## Stack (decided - do not change)

TypeScript 5.6 (strict) · three.js r170 (`three@0.170.0`) · Vite 5 · Vitest 2 · vite-plugin-singlefile.
Content: runtime-procedural (terrain, vegetation, settlement architecture, WebAudio) **plus** the AAA
content pipeline - Blender 5.2 as a Python module (asset scripts in `tools/blender/`) -> gltf-transform /
meshoptimizer / sharp -> `public/assets/` + generated `src/assets/manifest.ts` (dev deps:
`@gltf-transform/*` 4.5.1, `meshoptimizer` 1.2.0, `sharp` 0.35.5, `@pmndrs/assets` 1.7.0). Never
hand-made or downloaded binaries. Post-processing uses `three/examples/jsm` passes. **Never add npm
dependencies** (ask the CTO).

## Commands

| Command | What |
|---|---|
| `npm run dev` | Vite dev server (`--host`), open `http://localhost:5173/?scene=battle` |
| `npm run typecheck` | `tsc --noEmit` (must be clean) |
| `npm test` | Vitest: unit, purity (architecture guard) and determinism tests |
| `npm run build` | Production build to `dist/` |
| `npm run build:single` | One-file HTML build to `dist-single/index.html` |
| `npm run smoke` | Build + `vite preview` + headless Chromium screenshots to `docs/screenshots/`; fails on console errors. Env: `SMOKE_PORT` (default 4317 - pick another if a teammate is running it), `SMOKE_SKIP_BUILD=1`, `--scenes=menu,battle` |
| `npm run assets [-- <id>]` | Build content-pipeline assets (Blender -> `.asset-cache/` -> `public/assets/` + `src/assets/manifest.ts`), incremental. Flags: `--draft`, `--force`, `--no-preview`, `--republish`, `--list`, `--selftest` |
| `npm run assets:check` | Verify published files, manifest freshness and payload budgets (no Blender) |

**Concurrent builds (two employees work at once):** never build into the shared `dist/` / `dist-single/`. Verify builds with
`npx vite build --outDir .build/<ticket-id> --emptyOutDir` and `npx vite build --mode single --outDir .build/<ticket-id>-single --emptyOutDir`,
and run smoke with `SMOKE_DIST=.build/<ticket-id> SMOKE_PORT=<your port> SMOKE_OUT=docs/sprint1/<ticket-id>/smoke npm run smoke` (`.build/` is git-ignored).


Headless Chromium uses SwiftShader (software WebGL): it works but is slow - FPS there means nothing.
Run browser scripts with `NODE_PATH=$(npm root -g) node script.cjs`.

## Org chart and ownership (edit ONLY paths you own)

Sprint 1: the full org chart (incl. Technical Art Director + technical artists), the ticket board with each
ticket's owned paths, CTO grants and working agreements W1-W15 are in `docs/STUDIO.md` - a ticket's owned
paths and grants override this table for the sprint.

| Role | Owns |
|---|---|
| Studio Head / Producer | `docs/GDD.md`, planning docs |
| CTO | `src/core/**`, `src/main.ts`, `src/app/contracts.ts`, `src/app/debugApi.ts`, `src/scenes/SceneManager.ts`, `scripts/smoke.cjs`, `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/adr/**`, configs (`package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`) |
| Creative Director | `src/data/**` (factions, units, buildings, region, campaign, events, names, balance, skirmish), `docs/design/**` |
| Art Director | `src/render/style/**`, `src/ui/theme.css`, `docs/art/**` |
| Technical Art Director (with the CTO) | `tools/blender/**`, `tools/assets/**`, `src/assets/**`, `src/render/materials/**`, `src/scenes/AssetViewerScene.ts`, generated `public/assets/**` + `tools/assets/published.json`, `docs/screenshots/pipeline/` |
| Lead Graphics Engineer (+ graphics devs) | `src/render/**` except `style/` and `materials/` |
| Lead Gameplay Engineer (+ gameplay devs) | `src/sim/tactical/**` except `battleai.ts`, `src/scenes/{WorldScene,BattleScene,HeroScene,common}.ts`, `src/app/session.ts`, `src/hero/**` |
| Lead AI & Simulation Engineer (+ sim devs) | `src/sim/strategic/**`, `src/sim/tactical/battleai.ts` |
| Lead UI/UX Engineer (+ UI/audio devs) | `src/ui/**` except `theme.css`, `src/input/**`, `src/audio/**`, `src/scenes/MenuScene.ts` |
| QA Lead | `tests/**` (CTO seeded `tests/core` + `tests/integration`), `docs/qa/**`; may add shots to `scripts/smoke.cjs` `SHOTS` |

Leads assign sub-paths to their developers. **Need a change outside your paths** (a contract, a type,
an event, a new screen id, a data field)? Do not edit it - write the request in your report to your
lead / the CTO with the exact change. Baseline code from the CTO in your paths is yours to replace;
keep exported signatures stable or coordinate first.

## Hard rules

- Never run `git stash`, `git reset`, `git checkout -- <file>`, `git clean`, or rewrite/delete files you do not own. Others work in the same tree concurrently. Never switch branches, never push.
- Commit ONLY your paths: `git add <paths>` (never `git add -A` / `git add .`). If `.git/index.lock` exists, wait a few seconds and retry.
- Commit message: `[<Your Role>] <summary>` + blank line + body + the two trailer lines given in your task
  (`Co-Authored-By: ...` and `Claude-Session: ...`). Never put model names anywhere else in code or docs.
- Before committing: `npm run typecheck` and `npm test` pass; visual changes: `npm run build` and a smoke run (`--scenes=` your scene) with no console errors. Look at your screenshots.

## Content pipeline rules (tech art; ARCHITECTURE §18)

- **Assets are Python scripts**: `tools/blender/assets/<category>/<id>.py` (docstring tags `@asset <id>`,
  `@kind material|model|hdri`, `@depends a, b`), built on `tools/blender/lib` (see its `__init__.py`).
  Deterministic: seed via `core.begin()` / `ctx.rng`, never `random` without a seed or wall-clock values.
- **Run Blender** headless: `npm run assets -- <id>` (or directly `SAMRAJYA_DRAFT=1
  /root/.venvs/blender/bin/python tools/blender/assets/<cat>/<id>.py`). Cycles CPU baking works;
  Eevee/viewport do not. `BLENDER_PY` overrides the interpreter. After library changes run
  `npm run assets -- --selftest`.
- **Critique loop is mandatory**: look at `.asset-cache/<id>/preview*.png` with the Read tool, iterate until
  it looks premium, then check in engine `?scene=assetviewer&asset=<id>&hdri=sky_golden&quality=ultra`
  (+ `&camera=close|detail|overview`, `&assets=off` for the fallback). Commit final images to
  `docs/screenshots/pipeline/`.
- **Never hand-edit generated files** (`public/assets/**`, `tools/assets/published.json`,
  `src/assets/manifest.ts`); regenerate with `npm run assets`. Never commit `--draft` outputs (the runner
  refuses). Commit the script + library change + regenerated outputs together.
- **Naming**: ids snake_case `<subject>_<variant>` == file name; maps `baseColor normal orm macro emissive
  height`; objects `<id>_lod<N>`; UV layers `UVMap` / `UVLightmap`; standard bone and clip names
  (`lib/rig.py`, `lib/anim.py`). Meters; Blender +Z up, models face -Y (= three.js +Z / south).
- **Budgets**: textures <= 2048 (ultra) / 1024 (high) / 512 (mobile); payload ultra 80 MB, high 40 MB,
  mobile 15 MB; one file <= 8 MB; hero landmark LOD0 <= 120k tris, LOD1 <= 30k. Prefer shared tiling /
  trim-sheet material sets (runtime-bound via proxy-material extras) over unique textures.
- **Runtime**: get assets through `ctx.assets` (`loadModel` / `loadMaterial` / `loadHdri`, ref-counted -
  always `release()`); register a procedural fallback (`src/assets/fallbacks.ts`) for every model the game
  needs. `dist/` (index.html + assets/) is the shipped product; `build:single` has no assets (fallbacks).

## Coding conventions

- **Strict TS.** No `any` (use `unknown` + narrowing); if truly unavoidable add `// any: <reason>`. Named exports. Every file starts with a doc comment naming its OWNER and purpose.
- **Simulation (`src/sim/**`, `src/core/terrain/**`) is engine-agnostic and deterministic** (enforced by `tests/core/purity.test.ts`):
  - no `three`, DOM, `render/`, `ui/`, `scenes/`, `input/`, `audio/`, `app/` imports;
  - no `Math.random`, `Date`, `performance.now`; randomness only from the state's `RngState` (`new Rng(state.rng)` ... `state.rng = rng.getState()` / `withWorldRng`);
  - no `Math.sin/cos/tan/atan2/exp/log/pow/hypot/...` and no `**` - use `dsin/dcos/datan2/dexp/dlog/dpow` from `core/math.ts` (`Math.sqrt/abs/floor/min/max/round/sign/imul` are fine);
  - iterate records with `sortedKeys()` / `sortedValues()`; state is plain JSON data (no classes/Maps in state);
  - same state + same commands => same result (`tests/integration/determinism.test.ts` must stay green).
- **Three-level simulation:** formation level (`sim/tactical/battle.ts`) is authoritative for casualties and outcomes; the soldier layer (`soldiers.ts`) only visualizes. Distant battles use the same code headless (`autoresolve.ts`).
- **Performance:** no allocations in per-frame / per-step hot loops (preallocate, reuse `Vector3`/`Matrix4`, typed arrays). Soldiers are SoA (`SoldierBuffers`) + `InstancedMesh` with GPU vertex animation. Respect the budgets in `docs/ARCHITECTURE.md`. Profile with `profiler.begin/end('system.name')` and F3.
- **GPU resources:** every geometry, material, texture, render target and InstancedMesh you create is disposed in `dispose()` / `GameScene.exit()`. Shared caches (terrain heightfields, architecture geometry) are owned by their module.
- **Quality:** read every visual knob from `QualitySettings` (`ctx.quality.settings`) - never sniff devices in feature code. Colors come from `render/style/palette.ts` (3D) and `ui/theme.css` variables (UI).
- **Mobile first:** touch targets >= 44 px, safe-area insets, no hover-only interactions, test `?quality=low` at 390x844.
- **UI:** vanilla DOM via `ui/dom.ts` `h()`. Screens get state via props from scenes and act via `ctx.actions` (GameActions) or `ui:*` bus events. Stop canvas event propagation (`shield`).
- **Conventions:** meters, seconds (battle) / hours (strategic), radians. +X east, +Z south, +Y up. Facing θ: forward = (sin θ, cos θ); `rotation.y = θ` for +Z-authored models.

## Debugging and QA hooks

- URL params (`src/core/params.ts`): `?scene=menu|world|battle|hero|assetviewer&mode=campaign|sandbox&seed=N&quality=low|medium|high|ultra&soldiers=N&preset=river_crossing&hour=17&season=varsha&weather=monsoon_rain&camera=close|overview&paused=1&speed=4&aivsai=1&profiler=1&noaudio=1&noui=1&asset=<id>&assets=ultra|high|mobile|off&hdri=<id>&lod=N`.
- `window.__SAMRAJYA__` (`src/core/debug.ts`): `ready`, `sceneReady`, `scene`, `getState()`, `goto()`, `startMode()`, `pause/resume/step(n)`, `setTimeScale`, `setQuality`, `setEnvironment`, `issueBattleCommand`, `issueStrategicCommand`, `getProfile()`, `getErrors()`, `waitFrames(n)`, `freeze(true)`, `screenshot()`, `save/load`, `hash()`.
- F3 / backquote: profiler overlay (FPS, frame ms, draw calls, triangles, per-system ms). Crash reports: on-screen overlay + `localStorage['samrajya.crashes']`.

## Directory map

```
src/core/        CTO: types (contract), constants, rng, math, events (bus), loop, spatial, terrain/
                 (heightfield, noise, sites, roads, cache), save, quality, profiler, crash, debug, params, settings, log
src/data/        Creative Director: factions, units, buildings, region, campaign, events, names, balance, skirmish
src/sim/strategic/  world, economy, seasons, armies, diplomacy, politics, espionage, events, ai, autoresolve
src/sim/tactical/   battle, formations, soldiers, combat, morale, projectiles, battleai
src/render/      renderer, post, environment/ (sky, environment, terrain, water, vegetation, weather, textures),
                 architecture/ (layout, buildings, settlement), units/ (unitModels, soldierRenderer,
                 formationMarkers, armyMarkers), fx/ (particles, projectiles, banners), camera/ (rtsCamera,
                 heroCamera, picking), world/ (roads, overlays), style/palette (Art Director),
                 materials/ (pbr, splat - Technical Art Director)
src/assets/      AssetManager (ctx.assets), types, fallbacks, manifest.ts (GENERATED)
src/scenes/      SceneManager (CTO), MenuScene, WorldScene, BattleScene, HeroScene, common, AssetViewerScene
src/app/         contracts (CTO), session (GameActions/SessionView), debugApi
src/ui/          ui (UIManager), dom, base.css, theme.css (Art Director), screens/ (menu, world, battle, hero)
src/input/       input (InputManager), bindings
src/audio/       audio (procedural WebAudio)
src/hero/        hero exploration controller
tests/           core/ unit + purity, integration/ determinism
scripts/smoke.cjs  headless screenshot smoke test
tools/blender/   lib/ (asset helper library), assets/<category>/<id>.py (asset scripts), selftest.py
tools/assets/    build.mjs (npm run assets), publish.mjs, manifest.mjs, config.mjs, published.json (GENERATED)
public/assets/   GENERATED runtime assets: textures/, models/, hdri/   (.asset-cache/ = local Blender outputs)
docs/            GDD.md, ARCHITECTURE.md, adr/, screenshots/ (+ pipeline/)
```
