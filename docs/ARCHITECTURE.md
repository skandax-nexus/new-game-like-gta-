# SAMRAJYA - Technical Architecture

Owner: CTO. Status: v1 (MVP architecture). Source of truth for module boundaries, contracts, timing,
determinism, rendering, persistence, QA hooks and performance budgets. Change requests go to the CTO.

## 1. Goals and constraints

- **Browser-first, PC + mobile** (GDD §10): one WebGL2 build, quality tiers auto-detected, touch and
  mouse/keyboard designed in from day one.
- **High visual quality** within WebGL2: PBR + IBL from a physical sky, ACES filmic, soft shadows,
  GTAO, bloom, SMAA/FXAA, grading + vignette, fog, animated water, wind-swayed instanced vegetation,
  procedural Indian-inspired architecture, 1,000-5,000 GPU-animated soldiers.
- **Living, persistent world** (GDD §6-7): economy, seasons/monsoon, logistics, politics, diplomacy,
  espionage and narrative events affect each other; battle outcomes persist.
- **Three-level simulation** (GDD §9) with **deterministic, reproducible** results (GDD §15) so saves,
  replays, autoresolve and tests agree.
- **Engine-agnostic simulation** so a future UE5 port can reuse the sim/data layers (ADR 0001).
- **All content procedural** (no downloaded assets) - geometry, textures, audio generated at runtime.

## 2. Module map

```
                        +---------------------------------------------------+
   index.html --------> | main.ts  (bootstrap, DI container = AppContext)     |
                        +---------------------------------------------------+
                          |            |             |            |
            +-------------+   +--------+-----+   +---+------+  +--+---------+
            | app/session |   | scenes/      |   | ui/      |  | input/     |
            | GameActions |<--| SceneManager |-->| screens  |  | audio/     |
            | SessionView |   | Menu/World/  |   | (DOM)    |  | (WebAudio) |
            +------+------+   | Battle/Hero  |   +----^-----+  +-----^------+
                   |          +---+------+---+        |              |
                   |              |      |            +---- core/events (bus) ----+
                   v              v      v
            +---------------------------+   +-----------------------------------+
            | sim/  (three-free, pure)  |   | render/ (three.js)                |
            |  strategic/  tactical/    |   |  renderer+post, environment/,     |
            +-------------+-------------+   |  architecture/, units/, fx/,      |
                          |                 |  camera/, world/, style/          |
                          v                 +-----------------+-----------------+
            +---------------------------------------------------v---------------+
            | core/  types (CONTRACT), rng, math (deterministic), terrain/,      |
            |        save, loop, spatial, quality, profiler, crash, debug, params|
            +--------------------------------------------------------------------+
            | data/  factions, units, buildings, region, campaign, events, balance |
            +--------------------------------------------------------------------+
```

Dependency rules (enforced by `tests/core/purity.test.ts` for the sim side):

| Layer | May import | Must not import |
|---|---|---|
| `core/types, constants, ids, rng, math, events, loop, spatial, save, params, terrain/*` | each other | `three`, DOM-only modules, render/ui/scenes/app |
| `data/*` | core | everything else |
| `sim/*` | core, data, sim | three, DOM, render, ui, scenes, input, audio, app |
| `render/*` | three, core, data, sim (pure helpers e.g. `volleyPoint`) | ui, scenes, app |
| `ui/*` | core, data, sim (read-only selectors), app/contracts | render internals, scenes |
| `scenes/*` | everything | - |
| `app/*` | everything | - |

## 3. Frame and data flow

```
 pointer/keys/touch --> InputManager --(InputFrame + InputActionEvent)--> active GameScene.update()
                                   \--> bus 'input:action'
 HUD buttons --> ui screens --> ctx.actions (GameSession) --+--> strategic queue --> WorldScene.fixedUpdate
                           \--> bus 'ui:*' (selection,      +--> battle queue ----> BattleScene.fixedUpdate
                                camera focus, overlays)

 GameLoop (rAF)
   accumulator += realDt * timeScale
   while (acc >= fixedStep): SceneManager.fixedUpdate -> scene.fixedUpdate(step)       [deterministic sim]
        World:  tickWorld(world, playerCmds, simEvents, terrain)     (1 game hour / step)
        Battle: issueBattleCommand(...) for queued cmds; stepBattle(state, 0.05s);   (20 Hz)
                SoldierSim.step(state, ...)  (visual layer, LOD by camera focus)
   SceneManager.update -> scene.update(dt, alpha)                                     [presentation]
        input -> camera -> interpolate (prev->cur by alpha) -> renderers -> ctx.render.render()
        HUD props pushed to UIManager at 4-10 Hz
   sim events --> bus 'sim:events' / 'battle:events' --> UI feed, audio, session flow
```

Commands are the only way the player (and AI) change authoritative state. They are applied at step
boundaries, which makes runs replayable (`BattleState.commandLog`, `IssuedStrategicCommand`).

## 4. Three-level simulation (GDD §9)

| Level | Module | State | Rate | Authoritative for |
|---|---|---|---|---|
| Strategic | `sim/strategic/*` | `WorldState` | 1 game hour per step (12 h/s at 1x); daily/monthly systems on rollover | provinces, settlements (all GDD §6 variables), economy, seasons/weather, armies + supply, diplomacy, politics, espionage, events, victory |
| Tactical (formation) | `sim/tactical/battle.ts` + formations, combat, morale, projectiles, battleai | `BattleState` (plain data, inside `Engagement.battle` for world battles) | 20 Hz | movement, contact, melee/charge/volleys, casualties, morale/rout, outcome |
| Local (soldier) | `sim/tactical/soldiers.ts` | `SoldierBuffers` (SoA typed arrays, not saved) | 20 Hz near camera, 10 Hz mid, 5 Hz far | nothing - individual movement, anims, separation, casualty *realization* |

**Same authoritative state at every distance.** Casualties are computed at formation level
(`combat.ts` damage pools) and the soldier layer only chooses *which* soldiers die (front ranks in melee,
random under arrows). Therefore:

- An **active battle** (BattleScene) = formation sim + soldier layer attached to the same `BattleState`.
- A **distant battle** (AI vs AI, or "let the generals decide") = the same `createBattle/stepBattle`
  run headless by `autoresolve.ts` on a coarse terrain window (65^2), both sides AI.
- **Transitions preserve outcomes**: a world battle's `BattleState` is stored in
  `world.engagements[id].battle`; entering/leaving the BattleScene, saving or loading continues the same
  state (`SoldierSim.spawn()` re-creates soldiers from formation strengths). `tests/integration/
  determinism.test.ts` proves resume-from-serialized-state == uninterrupted.

Engagement lifecycle:

```
 armies in contact (armies.detectContacts)
   -> Engagement {status: 'pending_player' | 'auto'}
        auto           -> autoresolve (stepDistantBattles) -> applyBattleOutcome -> 'resolved'
        pending_player -> WorldScene pauses, engagement_prompt
             fight       -> status 'active' -> BattleScene(setup from battleSetupFromEngagement) -> results
                            -> session.continueAfterBattle -> applyBattleOutcome -> WorldScene
             autoresolve -> as auto
             retreat     -> rearguard losses, army falls back
```

Battle AI (`battleai.ts`) and intent translation (hold crossing, protect archers, ...) run *inside*
`stepBattle` every 20 ticks so player battles and autoresolve obey identical rules.

Morale (GDD §5): `target = base + sum(weight_i * input_i)` over leadership, cohesion, fatigue, supply,
tactical position, recent events (decaying `MoraleEvent`s: commander fallen, flank/rear attacked, ally
routed, heavy casualties, charged...) and perceived risk (local odds + losses). Morale drifts toward the
target; rout below `routThreshold`, rally above `rallyThreshold`. Weights live in `data/balance.ts`.
`FormationState.moraleBreakdown` explains the dominant factor for the UI.

## 5. Time, loop and speed

`core/loop.ts`: fixed timestep with accumulator, `timeScale` 0.5x-8x, pause, `MAX_STEPS_PER_FRAME`
(24) spiral guard, `alpha = acc / step` for interpolation, `stepNow(n)` for QA. Speed changes alter
how many steps run, never their size, so results are identical at any speed.

| Scene | Fixed step (real s @1x) | Sim time per step |
|---|---|---|
| World | 1/12 | 1 game hour (day = 2 s, year ~ 12 min at 1x) |
| Battle | 1/20 | 0.05 s battle time |
| Hero | 1/30 | cosmetic villagers only |
| Menu | 1/30 | none |

Rendering interpolates soldiers (prev/current buffers) and army tokens (prev/current tick positions).

## 6. Determinism contract

- Plain-data state; RNG state (`sfc32`, `RngState`) stored in `WorldState.rng` / `BattleState.rng`.
- Deterministic transcendental math (`core/math.ts d*`), no `Math.random/Date/performance` in sim.
- Stable iteration (`sortedKeys`), deterministic ids (`nextWorldId`).
- Tested: same seed+commands => same hash; save->load->continue == uninterrupted; battle resume ==
  uninterrupted; autoresolve reproducible; purity scan of sim sources.

## 7. Terrain

One continuous terrain function per seed (`core/terrain/heightfield.ts`, `TerrainGenerator`):
domain-warped fBm plains, south-west plateau/escarpment (Deccan-like), north-east ridged hills, a
meandering main river with periodic **fords** and a northern tributary, floodplains, moisture
(east wet / west dry), biome + terrain-class classification and flatten pads for settlements.
A `Heightfield` samples a square window into grids (height, biome, moisture):

| Window | Size | Resolution | Cell |
|---|---|---|---|
| Strategic region | 6,144 m | 513 | 12 m |
| Battle map (centered on the engagement) | 1,024 m | 513 (257 on low) | 2 m |
| Hero map / menu backdrop | 768-1,152 m | 385 / 289 | 2-4 m |
| Autoresolve | 1,024 m | 65 | 16 m |

Because every window samples the same function (detail octaves filtered by cell size), battle terrain
matches the strategic map (GDD §5). `heightAt()` (bilinear on the grid) is the canonical query for sim
and render placement. Settlement sites are resolved from authored (u, v) positions
(`terrain/sites.ts`), roads traced with slope/water-aware A* (`terrain/roads.ts`), heightfields cached
(`terrain/cache.ts`). Strategic travel uses `BALANCE.military.travelScale` (map meters are compressed).
Generation: ~0.5 s for 513^2 in V8 (TODO: Web Worker).

## 8. Render pipeline

`render/renderer.ts` (`RenderContext`): WebGL2, sRGB output, ACES Filmic, physically based lights,
PCF(soft) shadows, HalfFloat HDR chain, dynamic resolution (frame-time controller), stats -> profiler,
context-loss reporting, `capture()` for screenshots.

```
RenderPass (HDR) -> GTAO (high+, half-res on high) -> UnrealBloom (medium+, HDR threshold)
  -> OutputPass (ACES + sRGB) -> Grade (contrast, saturation, warmth, lift, tint, vignette) -> SMAA | FXAA
```

| System | Module | Technique |
|---|---|---|
| Sky + IBL | `environment/sky.ts` | Preetham sky, solar position from hour/day/latitude, PMREM env regenerated when the sun moves > 2 deg |
| Lighting/fog/grade | `environment/environment.ts` | sun/moon + hemisphere by time/season/weather; FogExp2 from visibility; texel-snapped shadow frustum follows focus; grade presets (day/golden/night/monsoon) |
| Terrain | `environment/terrain.ts` | chunked meshes (frustum culled), biome vertex colors + slope rock + sand banks, world-space procedural detail albedo + normal map, season tint, wetness |
| Water | `environment/water.ts` | physical material, animated procedural normals, env reflections, flood level |
| Vegetation | `environment/vegetation.ts` | 4 procedural species, biome-driven deterministic placement, spatially tiled InstancedMeshes, vertex-shader wind |
| Architecture | `architecture/*` | pure layouts -> per-(kind, style) InstancedMeshes of merged vertex-colored geometry: huts, mud/brick houses, mansions, granary, stupa (with toranas), shikhara temple (lathe tower + amalaka), palace + chhatris, pavilions, fort walls/gates/towers, ghats, stepwells, wells, markets, barracks, stables, workshops, pillars, jetties, bridges, palisades |
| Soldiers | `units/*` | one InstancedMesh per class (9 silhouettes), per-vertex part ids + pivots, vertex-shader animation (idle/walk/run/attack/shoot/hit/die/dead/rout/cheer/brace/work), team color mask, CPU frustum/LOD compaction every frame, matching depth material for shadows |
| FX | `fx/*` | instanced arrows from authoritative volleys, pooled particles (dust/smoke/fire/sparks), cloth banners on standard bearers |
| Cameras | `camera/*` | RTS camera (smooth pan/zoom-to-cursor/rotate/tilt, edge scroll, pinch/twist/drag), hero third-person, heightfield ray-march picking |
| Strategic map | `world/*`, `units/armyMarkers.ts` | road ribbons, province borders, selection/path/engagement overlays, army tokens |

### Quality tiers (`core/quality.ts`)

| | low | medium | high | ultra |
|---|---|---|---|---|
| Target FPS | 30 | 30 | 60 | 60 |
| Max DPR / dynamic res | 1.0 / 0.6-1 | 1.5 / 0.65-1 | 2 / 0.7-1 | 2 / off |
| Shadows | 1024, hard | 2048 soft | 4096 soft | 4096 soft (CSM TODO) |
| AO / bloom / AA | off / off / FXAA | off / on / FXAA | GTAO half / on / SMAA | GTAO full / on / SMAA |
| Vegetation cap (battle) | 4k | 12k | 26k | 45k |
| Max soldiers | 1,500 | 3,000 | 5,000 | 6,000 |
| Soldier LOD near/mid/far (m) | 35/110/400 | 50/160/600 | 70/220/900 | 100/300/1400 |

Detection: URL `?quality=` > saved setting > heuristics (mobile/touch UA incl. iPadOS, deviceMemory,
cores, WebGL renderer string - SwiftShader/llvmpipe -> low, entry GPUs -> medium, RTX 30-50/RX 6000+
-> ultra, max texture size).

## 9. Scene lifecycle

`scenes/SceneManager.ts` (also the loop target): `go(params)` queues transitions -> loading overlay ->
`old.exit()` (must dispose all GPU/DOM/bus resources) -> `ui.hideAll()` -> `new.enter(params)` (async,
reports `scene:loading`) -> binds `loop.fixedStep` -> after 3 rendered frames sets `sceneReady`,
emits `scene:ready`, hides loading. Enter errors are reported and fall back to the menu.
`GameScene` contract: `app/contracts.ts`. `SceneParams`: `menu | world | battle(setup, state?) | hero`.

## 10. UI

`ui/ui.ts` `UIManager`: layers (fullscreen, hud, panel, modal, toast, loading), lazy screen factories
(`ui/screens/index.ts`), `show/update/hide`. Screens are typed by `ScreenPropsMap` (`app/contracts.ts`);
scenes push read-only state; screens call `GameActions` (session) or emit `ui:*` bus events. Theme
tokens (`ui/theme.css`, Art Director) + components (`ui/base.css`): saffron/indigo/gold carved-frame
panels, ornament corners, 44 px touch targets, safe areas, `--ui-scale`.

## 11. Input

`input/input.ts`: contexts (`menu | world | battle | hero`) with key bindings (`input/bindings.ts`,
user overrides in settings). Produces a per-frame `InputFrame` (pan, grab-drag, rotate, tilt,
zoom + anchor, hero move/look, run, hover pointer, actions). Touch: tap select, drag pan, pinch zoom,
twist rotate, two-finger tilt, long-press = context command + radial menu, double-tap focus, hero
virtual stick (left half) + look (right half). HUD buttons inject the same actions (`injectAction`).

## 12. Audio

`audio/audio.ts`: procedural WebAudio (no files). Buses master/sfx/ambience/music; wind bed, drone,
battle drums driven by `audio:mood`; synthesized one-shots via `audio:sfx` (UI, orders, conch, horns,
drums, volleys, clashes, elephant trumpets). Context resumes on first gesture; `?noaudio=1` disables.

## 13. Persistence and versioning

`core/save.ts`: `SaveGame { format, version, meta, session, world, battle }` serialized as JSON
(+ typed-array and non-finite number encoding) with an FNV-1a checksum line. `deserializeSave()`
verifies, runs registered migrations `v -> v+1` up to `SAVE_VERSION`, validates. Stores:
`LocalStorageSaveStore` (slots + index), `MemorySaveStore` (tests); export/import text for files.
Mid-battle saves keep the formation-level `BattleState` (inside the world engagement for campaign
battles). Autosave on each new month. Bump `SAVE_VERSION`/`WORLD_SCHEMA_VERSION` + add a migration for
any state shape change.

## 14. Debug, QA and crash reporting

- URL deep links (`core/params.ts`): scene, mode, scenario, seed, quality, soldiers, preset, faction,
  enemy, hour, season, weather, freeze, speed, paused, settlement, camera, aivsai, debug, profiler,
  noaudio, noui.
- `window.__SAMRAJYA__` (`core/debug.ts`, impl `app/debugApi.ts`): ready flags, state, scene/mode
  control, sim stepping, environment/quality control, commands, profile, errors, frames, freeze,
  screenshot, save/load, state hash.
- Profiler (`core/profiler.ts`): FPS, frame ms avg/p95/max, per-system timings
  (`sim`, `sim.tactical`, `sim.soldiers`, `render`, `render.prep`, `frame`), draw calls, triangles,
  textures, programs, counters (visible soldiers), overlay on F3 / `?profiler=1`.
- Crash reporter (`core/crash.ts`): `window.onerror` + `unhandledrejection` + loop/bus/scene errors +
  WebGL context loss -> ring buffer in `localStorage['samrajya.crashes']`, overlay with Copy /
  Download / Continue / Main menu / Reload; reports include build, scene, mode, quality, GPU, recent logs.
- Tests: `npm test` (unit, purity, determinism). Smoke: `npm run smoke` (9 shots incl. 5,000-soldier
  battle and phone viewports; fails on console errors, page errors, failed requests, crash reports).

## 15. Performance budgets

Reference PC = mid-range discrete GPU (RTX 3060 class), 1080p, `high`. Reference mobile = mid-range
2023 Android (Adreno 6xx/7xx class), `medium`/`low`. Budgets per frame (CPU ms on main thread, GPU ms):

| Budget | PC high, 1,000 combatants | PC high, 5,000 (stress) | Mobile medium, 1,000 | Mobile low, 1,500 max |
|---|---|---|---|---|
| Frame target | 16.6 ms (60 FPS) | 33 ms (30 FPS acceptable) | 33 ms (30 FPS) | 33 ms |
| `sim.tactical` (formations, 20 Hz, amortized) | < 0.3 ms | < 0.8 ms | < 0.6 ms | < 0.6 ms |
| `sim.soldiers` (LOD-scheduled) | < 1.0 ms | < 3.0 ms | < 2.0 ms | < 2.5 ms |
| `render.prep` (instance writes, culling) | < 1.0 ms | < 3.5 ms | < 2.5 ms | < 3 ms |
| UI + input + audio | < 1.0 ms | < 1.0 ms | < 2.0 ms | < 2.0 ms |
| Draw calls (incl. shadow pass) | < 400 | < 500 | < 250 | < 150 |
| Triangles (main pass) | < 2.5 M | < 5 M | < 800 k | < 400 k |
| Soldier triangles (LOD0 ~0.3-0.8 k/model) | < 0.6 M | < 2.5 M (LOD1/2 required) | < 0.3 M | < 0.2 M |
| Texture + RT memory | < 600 MB | < 700 MB | < 250 MB | < 150 MB |
| JS heap | < 300 MB | < 400 MB | < 200 MB | < 150 MB |

Strategic map: `tickWorld` < 0.2 ms per hour-step for ~20 settlements / 10 armies (measured ~0.01 ms),
< 2 ms worst-case day rollover at 8x; world render < 300 draw calls (vegetation tiles + architecture
kinds + terrain chunks). Measured baseline (headless node): 60 game days = 17 ms; 1,000-soldier battle
formation sim 0.02 ms/step, soldier layer 0.3 ms/step.

## 16. GDD §15 MVP checklist -> modules

| MVP item | Where |
|---|---|
| One strategic region with settlements and resource production | `data/region.ts`, `sim/strategic/world.ts`, `economy.ts`, `WorldScene` |
| Two playable factions with distinct strengths | `data/factions.ts` (heartland, highland) + modifiers used by economy/armies/combat |
| >= 6 combat classes | `data/units.ts` (9 classes), `render/units/unitModels.ts` |
| Formation movement, attack, retreat, morale | `sim/tactical/*`, `BattleScene` orders + HUD |
| Economy and army supply | `economy.ts`, `armies.ts` (`ArmySupplyState`, depots) |
| 1,000 active combatants | `SoldierSim` + `SoldierRenderer`, smoke `battle` (1k) and `battle-river-5000` |
| Simplified distant armies/battles | `autoresolve.ts` (headless tactical sim), army tokens |
| Save/load + reproducible sim tests | `core/save.ts`, `tests/integration/determinism.test.ts` |
| Keyboard/mouse + touch prototypes | `input/*`, touch HUD, smoke mobile shots |
| Profiling + crash reporting | `core/profiler.ts`, `core/crash.ts` |
| Short campaign with multiple outcomes | `data/campaign.ts` (`broken_crown`: 3 outcomes), `sim/strategic/events.ts` |
| Modes: campaign, sandbox, skirmish + hero | `app/session.ts`, `ui/screens/menu.ts`, `HeroScene` |

## 17. Known gaps (owners' backlog)

Road-graph pathfinding for armies and flow-field pathing in battles (fords/bridges), cascaded shadows,
vegetation/soldier LOD + impostors, grass and crops, battle-map apron beyond bounds, planar/SSR water,
volumetric clouds + rain streaks, faction banner emblems, siege fortifications in battles, deeper
economy (harvest cycles, prices, trade routes), politics (succession crises, rebellions spawning
armies), diplomacy AI, espionage effects, campaign content (5 chapters), radial command wheel, terrain
generation in a Web Worker, localization.
