# SAMRAJYA: Echoes of Bharat - Studio Handbook

Browser (WebGL2) open-world strategy-action game for PC + mobile, built from `docs/GDD.md`.
Read `docs/ARCHITECTURE.md` before writing code. Contracts live in `src/core/types.ts` (domain) and
`src/app/contracts.ts` (scenes / UI / session). Engine choice: `docs/adr/0001-engine-choice.md`.

## Stack (decided - do not change)

TypeScript 5.6 (strict) · three.js r170 (`three@0.170.0`) · Vite 5 · Vitest 2 · vite-plugin-singlefile.
All art is **procedural** (geometry, canvas/DataTexture textures, shaders, WebAudio) - no asset files.
Post-processing uses `three/examples/jsm` passes. **Never add npm dependencies** (ask the CTO).

## Commands

| Command | What |
|---|---|
| `npm run dev` | Vite dev server (`--host`), open `http://localhost:5173/?scene=battle` |
| `npm run typecheck` | `tsc --noEmit` (must be clean) |
| `npm test` | Vitest: unit, purity (architecture guard) and determinism tests |
| `npm run build` | Production build to `dist/` |
| `npm run build:single` | One-file HTML build to `dist-single/index.html` |
| `npm run smoke` | Build + `vite preview` + headless Chromium screenshots to `docs/screenshots/`; fails on console errors. Env: `SMOKE_PORT` (default 4317 - pick another if a teammate is running it), `SMOKE_SKIP_BUILD=1`, `--scenes=menu,battle` |

Headless Chromium uses SwiftShader (software WebGL): it works but is slow - FPS there means nothing.
Run browser scripts with `NODE_PATH=$(npm root -g) node script.cjs`.

## Org chart and ownership (edit ONLY paths you own)

| Role | Owns |
|---|---|
| Studio Head / Producer | `docs/GDD.md`, planning docs |
| CTO | `src/core/**`, `src/main.ts`, `src/app/contracts.ts`, `src/app/debugApi.ts`, `src/scenes/SceneManager.ts`, `scripts/smoke.cjs`, `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/adr/**`, configs (`package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`) |
| Creative Director | `src/data/**` (factions, units, buildings, region, campaign, events, names, balance, skirmish), `docs/design/**` |
| Art Director | `src/render/style/**`, `src/ui/theme.css`, `docs/art/**` |
| Lead Graphics Engineer (+ graphics devs) | `src/render/**` except `style/` |
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

- URL params (`src/core/params.ts`): `?scene=menu|world|battle|hero&mode=campaign|sandbox&seed=N&quality=low|medium|high|ultra&soldiers=N&preset=river_crossing&hour=17&season=varsha&weather=monsoon_rain&camera=close|overview&paused=1&speed=4&aivsai=1&profiler=1&noaudio=1&noui=1`.
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
                 heroCamera, picking), world/ (roads, overlays), style/palette (Art Director)
src/scenes/      SceneManager (CTO), MenuScene, WorldScene, BattleScene, HeroScene, common
src/app/         contracts (CTO), session (GameActions/SessionView), debugApi
src/ui/          ui (UIManager), dom, base.css, theme.css (Art Director), screens/ (menu, world, battle, hero)
src/input/       input (InputManager), bindings
src/audio/       audio (procedural WebAudio)
src/hero/        hero exploration controller
tests/           core/ unit + purity, integration/ determinism
scripts/smoke.cjs  headless screenshot smoke test
docs/            GDD.md, ARCHITECTURE.md, adr/, screenshots/
```
