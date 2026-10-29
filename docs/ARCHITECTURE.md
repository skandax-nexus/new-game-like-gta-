# SAMRAJYA - Technical Architecture

Owner: CTO. Status: v2 (Contracts v2 landed by CORE-01 for Sprint 1, see §21). Source of truth for module
boundaries, contracts, timing, determinism, rendering, persistence, QA hooks and performance budgets. Change
requests go to the CTO.

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
- **Content = code.** Runtime-procedural content (terrain, vegetation, settlement architecture, audio) plus
  an offline **AAA content pipeline** (§18, ADR 0002): Blender-as-Python asset scripts -> Cycles bakes ->
  gltf-transform / WebP tiers -> `public/assets/` + typed `src/assets/manifest.ts`. No hand-made binaries;
  every pipeline asset has a procedural fallback so the game never breaks without it.

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

 tools/blender (asset scripts) --npm run assets--> public/assets/ + src/assets/manifest.ts
                                                       |
                         src/assets/AssetManager (ctx.assets) --> render/materials --> scenes
```

Dependency rules (enforced by `tests/core/purity.test.ts` for the sim side):

| Layer | May import | Must not import |
|---|---|---|
| `core/types, constants, ids, rng, math, events, loop, spatial, save, params, terrain/*` | each other; `core/save` also reads `data/*` (migration defaults, §21.3) | `three`, DOM-only modules, render/ui/scenes/app; `core/terrain/*` never imports `core/save` (worker bundles stay small) |
| `data/*` | core | everything else |
| `sim/*` | core, data, sim | three, DOM, render, ui, scenes, input, audio, app |
| `render/*` | three, core, data, sim (pure helpers e.g. `volleyPoint`) | ui, scenes, app |
| `assets/*` (AssetManager, manifest) | three, core, render/materials, render/architecture (fallbacks) | ui, scenes, app, sim |
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
`GameScene` contract: `app/contracts.ts`. `SceneParams`: `menu | world | battle(setup, state?) | hero |
assetviewer(assetId) | lab(labId)` (feature labs, §21.6). Optional v2 hook: `debugCommand(name, args)`.

## 10. UI

`ui/ui.ts` `UIManager`: layers (fullscreen, hud, panel, modal, toast, loading), lazy screen factories
(`ui/screens/index.ts`: static v1 screens + discovered `*.screen.ts` modules + themed placeholder, §21.5),
`show/update/hide`; UI services discovered from `*.service.ts` (`UI_SERVICES`). Screens are typed by `ScreenPropsMap` (`app/contracts.ts`);
scenes push read-only state; screens call `GameActions` (session) or emit `ui:*` bus events. Theme
tokens (`ui/theme.css`, Art Director) + components (`ui/base.css`): saffron/indigo/gold carved-frame
panels, ornament corners, 44 px touch targets, safe areas, `--ui-scale`.

## 11. Input

`input/input.ts`: contexts (`menu | world | battle | hero | lab`) with key bindings (`input/bindings.ts`,
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
any state shape change. Current: save format **2** / world schema **2**; the v1 -> v2 migration and the
`describeSaveProblems()` shape check are described in §21.3; frozen v1 fixtures live in `tests/fixtures/saves/`.

## 14. Debug, QA and crash reporting

- URL deep links (`core/params.ts`): scene, mode, scenario, seed, quality, soldiers, preset, faction,
  enemy, hour, season, weather, freeze, speed, paused, settlement, camera, aivsai, debug, profiler,
  noaudio, noui, asset, assets, hdri, lod; v2 (§21.2): lab, mission, mood, district, camdist, cine, colorblind,
  reducedmotion, keypreset, bench, age, deploy, csm, splat, clip, count, kit.
- `window.__SAMRAJYA__` (`core/debug.ts`, impl `app/debugApi.ts`): ready flags, state, scene/mode
  control, sim stepping, environment/quality control, commands, profile, errors, frames, freeze,
  screenshot, save/load, state hash; v2: `call(name, ...args)` -> scene `debugCommand`, `showScreen` /
  `hideScreen` / `screens()`, `labs()` (§21.7).
- Profiler (`core/profiler.ts`): FPS, frame ms avg/p95/max, per-system timings
  (`sim`, `sim.tactical`, `sim.soldiers`, `render`, `render.prep`, `frame`), draw calls, triangles,
  textures, programs, counters (visible soldiers), overlay on F3 / `?profiler=1`.
- Crash reporter (`core/crash.ts`): `window.onerror` + `unhandledrejection` + loop/bus/scene errors +
  WebGL context loss -> ring buffer in `localStorage['samrajya.crashes']`, overlay with Copy /
  Download / Continue / Main menu / Reload; reports include build, scene, mode, quality, GPU, recent logs.
- Tests: `npm test` (unit, purity, determinism, asset manifest/budgets). Smoke: `npm run smoke` (14 shots
  incl. 5,000-soldier battle, phone viewports and the asset viewer - stupa hero/close-up, sandstone
  lookdev, mobile, `assets=off` fallback; fails on console errors, page errors, failed requests, crash
  reports).

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

Content pipeline follow-ups (see §18-20): VAT baker (`tools/blender/lib/vat.py`) and crowd shader, impostor
baker, KTX2/Basis textures (needs an encoder), sky bakes per hour + blending, character/animal assets,
landmark set per faction, terrain material sets for the splat hook, Web Worker texture decode.


Road-graph pathfinding for armies and flow-field pathing in battles (fords/bridges), cascaded shadows,
vegetation/soldier LOD + impostors, grass and crops, battle-map apron beyond bounds, planar/SSR water,
volumetric clouds + rain streaks, faction banner emblems, siege fortifications in battles, deeper
economy (harvest cycles, prices, trade routes), politics (succession crises, rebellions spawning
armies), diplomacy AI, espionage effects, campaign content (5 chapters), radial command wheel, terrain
generation in a Web Worker, localization.

## 18. AAA content pipeline (ADR 0002)

```
tools/blender/assets/<category>/<id>.py      deterministic asset script (imports tools/blender/lib)
        |  npm run assets [-- <id>]           tools/assets/build.mjs: discover -> topo-sort deps -> content hash
        v                                     (script + lib/*.py + dependency hashes + PIPELINE_VERSION)
.asset-cache/<id>/                            Blender outputs: PNG/EXR/GLB + asset.json + build.log + previews
        |  publish (tools/assets/publish.mjs)
        v
public/assets/textures/<material>/<map>_<size>.webp        sharp: lossy WebP (color, ORM, macro),
public/assets/models/<model>/<model>.lod<N>.glb            near-lossless WebP (normals)
public/assets/models/<model>/<set>.<map>_<size>.webp       gltf-transform: dedup, flatten, join, weld,
public/assets/hdri/<sky>_<width>.exr                       prune(keep attributes), reorder, quantize, meshopt
        |  record + codegen
        v
tools/assets/published.json (build record)  ->  src/assets/manifest.ts (typed, `as const satisfies AssetManifest`)
        |
        v
src/assets/AssetManager.ts (ctx.assets)  ->  render/materials (PBR / splat)  ->  scenes
```

**Commands.** `npm run assets` (all, incremental) | `-- <id>` (one + dirty deps) | `--force` | `--draft`
(quarter-res, few samples; refused for commits) | `--no-preview` | `--republish` (publish from cache, no
Blender) | `--list` | `--check` (files, sizes, manifest freshness, budgets; CI-safe) | `--selftest`
(library regression test, `tools/blender/selftest.py`). `BLENDER_PY` selects the interpreter
(default `/root/.venvs/blender/bin/python`). Run a script directly for debugging:
`SAMRAJYA_DRAFT=1 /root/.venvs/blender/bin/python tools/blender/assets/models/stupa_sanchi.py`.

**Asset kinds.**

| Kind | Script outputs (asset.json roles) | Published | Manifest entry |
|---|---|---|---|
| `material` | `baseColor` (sRGB), `normal` (16-bit, OpenGL +Y), `orm` (R AO, G rough, B metal), `height` (cache only) | WebP per tier | tile size, average color, roughness, trims (UV v ranges), decals |
| `model` | `lod0`, `lod1`... GLB (texture-less proxy materials, UVMap + UVLightmap, tangents); `{set, map}` textures (e.g. `macro`) | meshopt GLBs + set WebPs | LODs (triangles, draw calls, switch distance), minLod per tier, bounds, clips, materialSets, sets |
| `hdri` | `hdri_<tier>` EXR (half, DWAB, sun disc removed) | EXR per tier | sun direction / color / intensity, ambient irradiance |

**Naming conventions.**
- Asset ids: `snake_case`, `<subject>_<variant>` from general to specific (`sandstone_carved_red`,
  `stupa_sanchi`, `sky_golden`); file name == id; categories = folders (`materials/`, `models/`, `hdri/`,
  later `characters/`, `props/`, `vegetation/`, `fx/`). Dependencies via `@depends a, b` in the docstring.
- Texture maps: `baseColor`, `normal`, `orm`, `macro`, `emissive`, `height`. Blender objects `<id>_lod<N>`;
  UV layers `UVMap` (TEXCOORD_0: sets/trims) and `UVLightmap` (TEXCOORD_1: macro). Bones and clips use the
  standard names in `lib/rig.py` / `lib/anim.py` (`idle walk run attack die ...`, custom = `x_<name>`).
- Units meters; Blender +Z up and models face -Y, which exports to three.js +Y up / facing +Z (south).

**Material binding contract** (`lib/export.py` -> `AssetManager.bindMaterials`): proxy material extras
`samrajya_set` (`"<material id>"` or `"<model id>:<set>"`), `samrajya_tint`, `samrajya_uv_scale`,
`samrajya_macro`, `samrajya_normal_scale`, `samrajya_roughness_scale`, `samrajya_detail_ao`. glTF factors
hold average color x tint so the GLB is plausible without textures. Trim sheets: models map faces onto
named bands (`lib/trim.py` sweeps with automatic band UVs and texture handedness) and decals (single
motifs such as `lotus_medallion`, `spiral_rosette`).

**Tiers and budgets** (enforced by `build.mjs` and `tests/core/assets.test.ts`).

| Asset tier | Quality tiers | Max texture | Payload budget | Notes |
|---|---|---|---|---|
| ultra | ultra | 2048^2 | 80 MB | GTAO full, all LODs |
| high | high | 1024^2 | 40 MB | |
| mobile | medium, low | 512^2 | 15 MB | `minLod` may skip LOD0 |
| off | `?assets=off`, single-file build | - | 0 | procedural fallbacks |

Single shipped file <= 8 MB. Triangle guides: hero landmark LOD0 <= 120k / LOD1 <= 30k; props <= 5k;
soldiers 0.3-0.8k. Measured (ultra / high / mobile): `sandstone_carved_red` 4.39 / 1.29 / 0.33 MB
(normal map near-lossless = 70 %), `ground_dry_earth` 2.90 / 0.85 / 0.26 MB, `stupa_sanchi` 1.83 / 1.49 /
1.30 MB (LOD0 45.1k tris 808 KB, LOD1 12.2k tris 341 KB, 3 draw calls each, + macro maps), skies 0.58 /
0.21 / 0.08 MB each; whole library 10.3 / 4.1 / 2.0 MB. Normal-map WebP study (1024^2): lossy q90 = 4.8 deg
mean / 130 deg max error (unusable), near-lossless 60 = 0.7 / 3.4 deg, lossless = 1.6 MB.

**Blender library (`tools/blender/lib`).** `core` (begin/AssetContext, seeding, units, dependencies,
asset.json), `texgen` (periodic numpy noise, blur, normals, AO, PNG IO, quick relief shading), `ornament`
(carved motif height fields: ashlar, lotus medallion, padma, bead-and-reel, dentil, patra-lata scroll;
sheet composition, trims, decals), `stone` (weathering + sandstone albedo/roughness), `nodes`
(NodeBuilder, seamless 4D torus noise), `materials` (texture-set / material-set preview materials),
`bake` (Cycles texture sets, selected-to-active normals/AO, heightfield AO, ORM packing), `mesh`
(headless modifiers: bevel, solidify, array, subdivide, displace, weld, triangulate; box/cylinder/smart/
lightmap UVs), `trim` (trim-sheet sweep modeling), `lod` (decimate / planar / make_lods), `rig`
(armatures, humanoid/quadruped specs, proximity/heat skinning), `anim` (standard clips, loops, NLA
stash), `export` (GLB + runtime proxies + bounds), `sky` (physical sky -> EXR tiers + sun), `render`
(Cycles previews: sky, sun, camera framing, lookdev set, DoF).

**Runtime API (`src/assets`).** `ctx.assets: AssetManager` - `loadModel(id, {lod, castShadow})` ->
`{object (THREE.LOD), animations, release()}`; `loadMaterial(id, opts)`; `loadTextureSet(ref)`;
`loadHdri(id)` -> `{texture, envMap (PMREM), sun, release()}`; `preload(ids, label)`; `onProgress(cb)`
(+ bus `assets:progress`); `registerModelFallback(id, factory)` (`src/assets/fallbacks.ts`);
`setTier(tier)`; typed getters `material(id)`, `model(id)`, `hdri(id)` with `MaterialAssetId` /
`ModelAssetId` / `HdriAssetId`. Textures load via fetch + `createImageBitmap` (no premultiply/color
conversion, `flipY = false` like glTF) and are uploaded during loading (`renderer.initTexture`).
Everything is ref-counted; GPU memory is freed when the last handle is released. Built-in three.js
geometries need `toGltfUv()` before using set textures.

**Critique loop (mandatory).** Asset scripts render Cycles previews (`.asset-cache/<id>/preview*.png`).
Inspect them with the Read tool, fix, re-run; then check in engine:
`?scene=assetviewer&asset=<id>&hdri=sky_golden&camera=hero|close|detail|overview|turntable&quality=ultra`
(`&assets=off` shows the fallback). Final images live in `docs/screenshots/pipeline/`.

**Distribution.** `dist/` (index.html + `assets/` incl. the published content) is the shipped artifact.
`npm run build:single` stays a lightweight fallback: it cannot inline tens of MB of assets, so it is built
with `publicDir: false` and `__ASSETS_ENABLED__ = false` (procedural fallbacks only).

## 19. AAA rendering pipeline (target: "best of WebGL2")

Reference: AoE-level clarity at strategy zoom, Wukong-level fidelity up close. Status: **done** = in the
codebase, **next** = owner ticket (Lead Graphics Engineer unless noted).

| Feature | Status | Technique / owner notes |
|---|---|---|
| HDR image-based lighting | done (asset viewer), next: World/Battle/Hero | `loadHdri` -> PMREM env + DirectionalLight from the extracted sun (no double counting); per-hour sky bakes + blend for time of day |
| PBR materials from baked sets | done | `render/materials/pbr.ts`: map/normal/ORM, detail AO (ORM.r, uv0) x macro AO (uv1), macro albedo, wetness hook (`MATERIAL_GLOBALS.wetness`) |
| Terrain splatting | hook done, next: content | `render/materials/splat.ts`: 4 height-blended PBR layers, world planar UVs, macro variation; add triplanar cliffs + distance blend |
| Shadows | next | CSM (`three/examples/jsm/csm`) 3-4 cascades on high/ultra with PCSS-style kernel; contact shadows (screen-space ray march) on ultra |
| Ambient occlusion | done | GTAO (high: half res, ultra: full) |
| Reflections | next | SSR for water/wet stone on ultra; planar reflections for rivers on high |
| Volumetrics | next | height fog with sun in-scattering (analytic, in the grade pass), god rays (radial blur of occlusion) |
| Anti-aliasing | done (SMAA/FXAA), next TAA | TAA with velocity for hero/cutscenes (needs motion vectors for instanced crowds) |
| Bloom, grade | done | UnrealBloom (HDR threshold), grade pass; next: per time-of-day LUTs (`LUTPass`), AgX option |
| Depth of field | next | BokehPass in hero mode / cutscenes (focus on the hero, aperture from camera framing) |
| Lens | next | subtle chromatic aberration, vignette (done), lens dirt on bloom |
| Vegetation | partial | instanced + wind (done); next: GPU grass field, tree LOD + octahedral impostors from Blender |
| Weather | partial | rain particles (done); next: wetness (hook done), puddles, rain streaks on glass-like surfaces, lightning flashes |
| Crowds | partial | GPU vertex animation (done); next: VAT (§20) |

Frame order (target): depth pre-pass (ultra) -> opaque (IBL + CSM) -> GTAO -> SSR (ultra) -> transparent
-> volumetric fog/god rays -> bloom -> DoF (hero) -> tone map (ACES/AgX) + LUT grade -> TAA/SMAA -> UI.
Every knob comes from `QualitySettings`; low tier keeps a single merged post pass.

## 20. Crowd rendering (VAT)

Goal: thousands of soldiers with real skeletal animation at InstancedMesh cost (GDD §9, 1,000-5,000).

1. **Author** characters as Blender scripts: modular body + kit meshes (faction gear), `rig.humanoid()`
   skeleton (standard bone names), `rig.skin_proximity()` / `skin_auto()`, clips via `anim.cycle()` /
   keys with the standard names (`idle walk run attack shoot hit die dead brace charge rout cheer work`).
   Export a skinned GLB per unit class for hero/close-up use (already supported, see `selftest.py`).
2. **Bake VAT** (next ticket: `tools/blender/lib/vat.py`): for each clip and frame (15-30 fps), evaluate
   the deformed mesh and write object-space positions (and octahedral-packed normals) into a half-float
   texture: one column per vertex, one row per frame, clips stacked; a clip table (start row, frames, fps,
   loop) goes into the manifest (`clips`). Alternative for prototypes: bake at load time from the
   SkinnedMesh with `AnimationMixer` (same layout, cached per unit class).
3. **Runtime**: one `InstancedMesh` per unit class and LOD; per-instance attributes (clip, phase, speed,
   faction tint index, LOD fade); the vertex shader `texelFetch`es frame N and N+1 by `gl_VertexID`
   and lerps; `customDepthMaterial` uses the same VAT code for shadows. `SoldierBuffers` (SoA) maps each
   soldier's animation state to clip/phase - the formation layer stays authoritative.
4. **LOD chain**: VAT full mesh (0.6-0.8k tris) near -> VAT simplified mesh (150-250 tris, decimated with
   `lod.decimate` so vertex ids are re-baked) mid -> impostor billboards (8 directions x clip frames,
   baked in Blender) far; distances from `QualitySettings.soldierLod`, CPU compaction as today.
5. **Budget**: 700 verts x 12 clips x 24 frames ~ 200k texels x 2 (pos + normal) in RGBA16F ~ 3.2 MB per
   class; keep textures <= 4096 wide (mobile) by wrapping vertex columns. Faction colors via a tint mask
   in vertex color + per-instance color.

## 21. Contracts v2 (Sprint 1)

Landed in one reviewed batch by CORE-01 so the other 23 Sprint-1 tickets work in parallel against stable
interfaces. Nothing here changes gameplay or visuals by itself: every new field holds a neutral default until
its implementing ticket (right-hand column) gives it behaviour. After CORE-01, contract changes go to the CTO
as exact diffs (STUDIO.md W2); never duplicate a contract type locally.

### 21.1 Conventions

- **Optional-member convention (app contracts).** New `GameActions`, `SessionView` and `GameScene` members are
  OPTIONAL and tagged `@sprint1 implemented by <ticket>` in `app/contracts.ts`. Callers feature-detect:
  `ctx.actions.startHeroMission?.(id)`, `if (scene.debugCommand) ...`. New screen props on existing screens
  (`hero_hud.combat`, `battle_hud.anchors`, ...) are optional too, so today's scenes keep compiling.
- **Required-state convention (domain state).** New persistent fields in `core/types.ts` are REQUIRED, set
  where the object is created (CORE-01 compile-fix initialisers: neutral values) and defaulted by the v1 -> v2
  migration with the value a fresh object would get. `?` only where absence means something: placement
  `cell` / `rot`, `ConstructionJob.landmarkId` / `repair`, `SettlementState.rallyPoint`,
  `ArmyState.rebelSettlementId`, `SkirmishSetup.compositions`. Fields marked `@sprint1 <ticket>` in a doc
  comment are contract-only until that ticket lands.
- **Grid placement.** `GridCell = [i, j]` on the settlement's 4 m grid: cell (0, 0) spans
  `[s.x, s.x + 4) x [s.z, s.z + 4)`, +i east, +j south; a footprint's `cell` is its minimum (north-west) cell and
  covers `w/4 x d/4` cells (swapped for odd `rot`); `rot` = quarter turns, facing `rot x PI/2` (0 = +Z).
- **Rebels.** `REBEL_FACTION_ID = 'rebels'` (+ `isRebelFaction()`) is legal as `ArmyState.factionId` with
  `rebelSettlementId`; it is never a `WorldState.factions` key (the save validator rejects it).
- **Landmark jobs.** A `ConstructionJob` with `landmarkId` raises a landmark; its `type` is only a presentation
  hint ('palace'): check `landmarkId` before looking a job up in `BUILDINGS`.

### 21.2 Members and implementing tickets

| Area | Member (file) | Implemented by | Main consumers |
|---|---|---|---|
| Scenes | `SCENE_IDS` + `'lab'`, `SceneParams { scene: 'lab'; labId }`, `LabScene` (types.ts, contracts.ts, scenes/LabScene.ts) | CORE-01 (done) | GFX-01..06, GP tickets (labs) |
| Scenes | `GameScene.debugCommand?(name, args)`, `DEBUG_UNHANDLED` (contracts.ts) | GP-03 (world), GP-04 (battle, `bench.report`), GP-02 (hero), CORE-01 (lab) | QA-01, every shots script |
| Actions | `startHeroMission?`, `completeHeroMission?(HeroMissionResult)`, `abandonHeroMission?`, `decidePrisoners?`, `decideCapture?`, `skipDeployment?` (contracts.ts) | GP-03 | UI-01, UI-02, GP-02, GP-04 |
| Session | `SessionView.heroMission?` (`HeroMissionSession`), `pendingEngagements?`, `difficulty?` | GP-03 | UI-02, GP-02 |
| Screens | `build_placement`, `market`, `age_panel`, `economy_panel` (+ props) | UI-02 (GP-03 pushes) | GP-03 |
| Screens | `mission_card`, `hero_dialogue`, `hero_negotiation`, `mission_result`, `game_stats`, `hint_card` (+ props) | UI-01 (GP-02 / GP-03 push) | GP-02, GP-03 |
| Screens | `hero_hud` optional `combat` (`HeroCombatHud`: hp, stamina, salves, lock-on, enemy bars), `objective`, `compassHeading`, `caption`, `promptAnchor`, `touchControls` | UI-02 renders, GP-02 pushes | - |
| Screens | `battle_hud` optional `deployment`, `rally`, `anchors` (`FormationScreenAnchor[]`); `battle_results.engagementId?` | UI-02 renders, GP-04 pushes | - |
| Screens | `SCREEN_IDS`, `isScreenId()` (contracts.ts) | CORE-01 (done) | registry, debug API |
| World state | `WorldState.monsoon` (`MonsoonState`), `statistics` (END_GAME_STATS counters) | SIM-01 | UI-02 (forecast), UI-01 (game_stats) |
| Faction state | `age`, `landmarks`, `materials`, `policies`, `marketPrices`, `ghosts` (`ArmyGhost`), `counterIntel`, `counterIntelUntilDay`, `protectCourtUntilDay`, `advisorIgnored`, `councilAdvice`, `culturePoints`, `prosperityDays`; `ai.memory` | SIM-01 (`ai.memory`: SIM-02) | UI-02, GFX-06 (age variants), GFX-04 (ghost tokens), GP-03 |
| Settlement state | `initialOwnerFactionId`, `occupiedSinceDay`, `pendingCapture`, `starvationDays`, `revoltSinceDay`, `taxRelief`, `reliefThisMonth`, `ladderProgress`, `landmarks` (`LandmarkInstance`), `rallyPoint?`; `CropState.laborAtSowing` | SIM-01 | UI-02, GFX-06, GP-03 |
| Placement & jobs | `BuildingInstance.cell?/rot?`; `ConstructionJob.cell?/rot?/landmarkId?/repair?/paid/crew` | SIM-01 (placement.ts) | GFX-06 (layout v2, construction stages), GP-03 (ghost) |
| Armies | `ArmyState.forcedMarch`, `rebelSettlementId?`; `ArmyOrder` `resupply`, `assault`; `SupplyDepotState.readyOnDay`; `Engagement.prisonerDecision` | SIM-01 | UI-02, GP-03, SIM-02 |
| Characters | `CharacterState.captiveOf` | SIM-01 | UI-02 |
| Diplomacy, espionage | `RelationState.warWeariness`, `truceUntilDay`; `IntelState.armiesVisibleUntilDay` | SIM-01 | SIM-02, UI-02 |
| Battle state | `BattleState.deploymentEndsAt`, `siege` (`BattleSiegeState`: 12 `segments`, `gates`, `towers`, `breaches`, `breachHold`), `works: EngineerWorkState[]` (+ `maxHp`, `progress`, `formation`); `wallHp` deprecated | GP-01 | GFX-06 (walls), GP-04, SIM-02 |
| Battle state | `BattleSideState.rallyCooldownUntil`; `aiMemory` | GP-01; `aiMemory`: SIM-02 | UI-02 (rally ring), GP-04 |
| Battle state | `FormationState.rallies`, `shapeChangeUntil`, `panicUntil`, `rallyingUntil`, `disengageUntil`, `chargeRun`, `orderTime`, `hidden` | GP-01 | SIM-02, GFX-04, UI-02 |
| Battle setup | `BattleSideSetup.aggression` (autoresolve stance 0.75 / 0.5 / 0.3) | SIM-01 sets, SIM-02 reads | - |
| Outcome | `BattleOutcome.warScore`, `chronicle`, `placeName`, `day`; `BattleSideResult.prisoners`, `routs`, `capturedSupply`, `commanderId`; `FormationResult.routedEnemies` | GP-01 fills, SIM-01 writes back (stamps `day`) | UI-02 (results), UI-01 (stats) |
| Soldiers | `SoldierBuffers.animVariant` (Uint8), `animStart` (Float32); `SOLDIER_ANIM.reload/charge`; `SOLDIER_ANIM_VARIANTS`; `SOLDIER_FLAG.mounted/conch` | GP-01 writes | GFX-04 (VAT clip mapping), AUD-01 |
| Hero | `HeroMissionResult` (types.ts), `HERO_MOODS` | GP-02 builds, GP-03 applies via SIM-01 `applyHeroMissionResult` | UI-01 (mission_result) |
| Commands | `StrategicCommand` `market_trade`, `start_landmark`, `set_policy`, `forced_march`, `prisoners`, `capture_decision`, `set_rally_point`, `repair_building`; `build.cell?/rot?`; `cancel_construction.jobIndex?` | SIM-01 | UI-02, GP-03, SIM-02 |
| Commands | `BattleCommand { kind: 'rally' }` | GP-01 | GP-04, UI-02, SIM-02 |
| Conditions | `age_at_least`, `landmark_built` | SIM-01 (events.ts) | Creative Director data |
| Sim events | `construction_started`, `landmark_started`, `age_advanced`, `monsoon_roll`, `spoilage`, `market_trade`, `rebels_spawned`, `secession`, `governor_demand`, `siege_breach`, `depot_raided`, `army_sighted`, `hero_mission_available` | SIM-01 emits | GP-03 (flow, alerts), UI-02 (feed), AUD-01 |
| Bus | `ui:hint {key}` | GP-03 / GP-04 / GP-02 emit, UI-01 hints service | - |
| Bus | `hero:mission_end`, `hero:combat {kind, x, y, z, strength}` | GP-02 / GP-03 emit | AUD-01, GFX-05 |
| Bus | `world:alert {kind, x, z, severity}` | GP-03 emits | UI-02 (minimap), GFX-05 (3D pings) |
| Bus | `camera:shake {amplitude, durationSec}` | GP-02 / GP-04 emit | GFX-05 (honours reducedMotion) |
| Bus | `audio:listener`, `audio:ambience`, `audio:stinger`; `audio:sfx.position?`; `audio:mood` + `hero_explore`, `hero_combat`, `duel`, `siege` (`AUDIO_MOODS`, `AUDIO_STINGERS`) | scenes emit | AUD-01 |
| Audio | `SFX_KINDS` + `sword_light`, `sword_heavy`, `parry_ring`, `block_thud`, `roll_cloth`, `body_hit`, `stagger_grunt`, `salve`, `bell_temple`, `construction_complete`, `landmark_complete`, `age_up_fanfare`, `market_coins`, `gate_break`, `wall_crumble`, `ram_hit`, `fire_crackle`, `river_splash`, `footstep_stone`, `footstep_dirt` | AUD-01 | GP-02, GP-03, GP-04 |
| Input | `INPUT_ACTIONS` + `shape_loose`, `shape_circle`, `order_stance`, `commander_rally`, `idle_builders_next`, `idle_army_next`, `select_capital`, `placement_rotate`, `card_next_tab`, `card_slot_0..14`, `camera_rotate_left/right`, `hero_attack_light/heavy`, `hero_roll`, `hero_guard`, `hero_salve`, `hero_lock_on`, `hero_skip_cinematic`, `dialogue_choice_1..5` | UI-02 (Classic / Grid bindings) | GP-02, GP-03, GP-04 |
| Settings | `keyPreset` ('classic' / 'grid', `KEY_PRESETS`), `autoPause{battleStart, commanderFallen, formationRouted, narrativeEvents}`, `hintsSeen`, `simpleMode` (boolean / 'auto'), `relationColoring`, `minimapNorthUp`, `holdToToggle{guard, run}`, `subtitles` (defaults + `normalizeSettings` in settings.ts) | UI-01 (settings screen), UI-02 (input, HUD) | GP-02, GP-03, GP-04, GFX-04 |
| Quality | `shadows.contact/pcss`, `ssr`, `dof` ('off' / 'hero' / 'close'), `shaftsSamples`, `shaftsHalfRes`, `heightFog`, `lensEffects`, `grassDensity`, `practicalLights`, `treeImpostorDistance`, `villagerCap`, `crowdLod{vat0, vat1, impostor}`, `emissiveBoost`, `bakedAoBoost`, `postMerged`, `audio{voices, hrtf}`, `antialias` + 'taa' | GFX-01 (owns core/quality.ts, tunes the presets) | GFX-02..06, AUD-01 |
| URL params | `lab`, `mission`, `mood`, `district`, `camdist`, `cine`, `colorblind`, `reducedmotion`, `keypreset`, `bench`, `age`, `deploy` (0 = skip deployment), `csm`, `splat`, `clip`, `count`, `kit` (params.ts) | consumer named in params.ts | all shots scripts |
| Debug API | `call(name, ...args)`, `showScreen(id, props)`, `hideScreen`, `screens()`, `labs()`, `goto('lab')` (core/debug.ts, app/debugApi.ts) | CORE-01 (done) | QA-01, every shots script |
| Terrain | `primeHeightfield(spec, grids)`, `heightfieldFromGrids`, `extractHeightfieldGrids`, `heightfieldTransferList`, `peekHeightfield` (core/terrain/cache.ts) | CORE-01 (done); GFX-02 `loadHeightfieldAsync` uses it | GP-03, GP-04 |
| UI scaffolding | screen registry + placeholder, `UI_SERVICES` (ui/screens/index.ts, registry.ts, placeholder.ts) | CORE-01 (done); UIManager starts services: UI-02 | UI-01, UI-02 |
| Boot | `index.html` splash: Tiro Devanagari Sanskrit (preloaded, Palatino fallback), radial indigo (ART_BIBLE §17) | CORE-01 (done) | - |

### 21.3 Save format 2 and the v1 -> v2 migration

`SAVE_VERSION = 2`, `WORLD_SCHEMA_VERSION = 2`. `core/save.ts` registers `migrateSave` step 1 -> 2:
`migrateWorldV1toV2` / `migrateBattleV1toV2` add every v2 field only where absent (`fill`), with the value a fresh
v2 object gets: faction `age` = `ScenarioDef.startingAges > FactionDef.startingAge > 'janapada'`, `materials` =
`ScenarioDef.materials`, `monsoon.strength` = scenario (start year) / sandbox `monsoonStrength` else 1,
`initialOwnerFactionId` = createWorld's owner rule, a revolt in progress starts its secession clock on load,
`warWeariness` from months at war, v1 jobs were charged nothing (`paid` zero, `crew` 0 = derive from the
definition), outcomes get `prisoners` = the other side's `captured`, `routs`, `chronicle` = first summary line and
the engagement `day`. `SaveSession.hero` (hero-scene autosaves) is added. After migration `validateSave` runs
`describeSaveProblems()` (every v2 field present with the right type, no `rebels` faction entry, schema 2).
Guards (`tests/contracts/migration.test.ts`): the four frozen v1 fixtures (campaign day 30 with jobs in flight,
skirmish saved in melee, sandbox month 6, campaign field battle saved in melee inside its engagement) load,
keep every v1 value, round-trip byte-identically, keep simulating deterministically; a fresh v2 world / battle
stripped of its v2 fields migrates back to an identical hash (migration defaults == creation defaults).

### 21.4 Parallel-work rule (who edits what)

New capabilities arrive as NEW FILES discovered by name, never as edits of a shared registry:

| Kind | File | Export | Discovery |
|---|---|---|---|
| UI screen | `src/ui/screens/<area>/<name>.screen.ts` | `SCREENS: ScreenRegistration[]` (`defineScreen(id, factory)`) | eager `import.meta.glob('./**/*.screen.ts')` in ui/screens/index.ts |
| UI service | `src/ui/<area>/<name>.service.ts` | `SERVICES: UiService[]` (`{ id, start(ctx, ui) => stop }`) | eager glob -> `UI_SERVICES`; the UIManager starts / stops them (UI-02) |
| Feature lab | `src/<your dirs>/<id>.lab.ts` | `LAB: LabModule` (`{ id, title, setup(ctx, host) }`) | lazy `import.meta.glob('/src/**/*.lab.ts')`, one chunk per lab, none in the single-file build |

### 21.5 Screen registry rules

The 18 v1 screens are static (their owners edit them in place). A discovered module may register only ids that
are neither static nor registered by another module - violations are reported (console.error at startup,
`UI_REGISTRY_ERRORS`, failing `tests/contracts/registry.test.ts`) and the first registration wins. Every ScreenId
without a factory resolves to the themed placeholder (`ui/screens/placeholder.ts`): a carved panel with a torana
title, the owner ticket and a parchment sheet listing every prop key with a value summary, so scenes and QA can
show a screen before it exists (`__SAMRAJYA__.showScreen('market', {...})`). `__SAMRAJYA__.screens()` reports
`static | discovered | placeholder` per id.

### 21.6 Feature labs

`?scene=lab&lab=<id>` (LabScene) loads `<id>.lab.ts` and calls `LAB.setup(ctx, host)`. The host
(`scenes/lab/types.ts`) provides the scene, a perspective camera with OrbitControls, the regular `EnvironmentRig`
(URL `?hour/season/weather` applied), an 800 m ground disc, `addTerrain()` (region-terrain window with the
terrain and water renderers), `setEnvironment`, `frame(target, distance, yaw, pitch)`, `own(resource)` (disposed
on exit), `setInfo(lines)` (HUD) and `progress()`. The lab returns `{ update(dt), dispose(), debugCommand? }`.
Labs reach `sceneReady`, freeze and screenshot like every scene; `call('noop' | 'lab.info' | 'lab.list' |
'lab.frame' | 'lab.env')` are built in, other names go to the lab. Unknown ids show a themed error panel listing
the available labs and fall back to the main menu. Example: `src/scenes/lab/example.lab.ts`.

### 21.7 Debug API v2

`__SAMRAJYA__.call(name, ...args)` awaits the active scene's `debugCommand(name, args)`; when the scene has none or
returns `DEBUG_UNHANDLED`, the API answers its built-ins (`noop`, `scene.info`, `ui.screens`, `labs`) or rejects
with "Unknown debug command". Results must be plain, structured-cloneable data. Namespaces in use: `world.*`,
`settlement.*`, `session.*` (GP-03), `bench.*` (GP-04), `hero.*` (GP-02), `lab.*` + lab-specific (labs).
`showScreen(id, props)` / `hideScreen(id)` drive any screen for UI captures.

