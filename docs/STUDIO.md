# Samrajya Studio - Organisation and Sprint 1 Board

Owner: CTO. Status: Sprint 1 planned (all tickets TODO). Audience: every employee of the studio.
Inputs: `docs/GDD.md` (what and why), `docs/DESIGN_SPEC.md` (rules and numbers), `docs/ART_BIBLE.md` +
`docs/ASSET_LIST.md` (look and asset production), `docs/ARCHITECTURE.md` (contracts, budgets, pipeline).
Client touchstones: **Age of Empires II DE / IV** for strategy readability and feel, **Black Myth: Wukong**
for close-up fidelity and the hero experience.

Sprint 1 goal: **the full MVP of GDD §15 at the raised graphics bar** - one living region with AoE-style
settlement building and ages, two asymmetric playable factions, formation battles of 1,000-5,000 VAT-animated
soldiers, a short branching campaign, hero mode with a focused Wukong-style melee set, keyboard/mouse and touch,
save/load with reproducible simulation, profiling and crash reporting.

Contents: 1 Org chart - 2 Roles, responsibilities and reporting lines - 3 Sprint 1 ticket board -
4 Working agreements (W1-W15) - 5 Dependency graph and schedule - 6 Review flow and definition of done -
7 GDD §15 coverage - 8 Ticket details.

---

## 1. Org chart

```
Studio Head / Producer (orchestrator: schedules tickets, two developers at a time)
|
+-- CTO ---------------------------------- engine, contracts, pipeline runner, integration, CLAUDE.md
|   |
|   +-- Contracts delegate (CORE-01) ------ one-off: Contracts v2 + scaffolding, reports to the CTO
|   |
|   +-- Technical Art Director ------------ content pipeline + asset quality (dotted line to the Art Director)
|   |   +-- Technical Artist A ------------ TA-01  WP1 materials & terrain library
|   |   +-- Technical Artist B ------------ TA-02  WP2 vernacular & civic architecture kit
|   |   +-- Technical Artist C ------------ TA-03  WP3 monuments, landmarks, fortifications
|   |   +-- Technical Artist D ------------ TA-04  WP4 vegetation, crops, rocks
|   |   +-- Technical Artist E ------------ TA-05  WP5 crowds, villagers, animals, vehicles (VAT)
|   |   +-- Technical Artist F ------------ TA-06  WP6 hero & cinematic characters
|   |   +-- Technical Artist G (Pipeline TD) TA-07  pipeline extensions + WP7 skies, VFX, banners
|   |
|   +-- Lead Graphics Engineer ------------ src/render/** (except style/)
|   |   +-- Graphics Developers ----------- GFX-01 lighting & post, GFX-02 terrain/water/weather,
|   |                                        GFX-03 vegetation, GFX-04 crowds & FX, GFX-05 cameras,
|   |                                        GFX-06 settlements & construction
|   |
|   +-- Lead Gameplay Engineer ------------ tactical sim, scenes, session, hero
|   |   +-- Gameplay Engineers ------------ GP-01 tactical sim, GP-02 hero mode, GP-03 world scene,
|   |                                        GP-04 battle scene
|   |
|   +-- Lead AI & Simulation Engineer ----- strategic sim, battle + campaign AI
|   |   +-- Simulation / AI Engineers ----- SIM-01 strategic world, SIM-02 AI
|   |
|   +-- Lead UI/UX Engineer --------------- UI, input, audio
|   |   +-- UI Engineers ------------------ UI-01 front-end & narrative, UI-02 in-game HUD & input
|   |   +-- Audio Developer --------------- AUD-01 procedural audio
|   |
|   +-- QA Lead ---------------------------- tests, QA automation, performance
|       +-- QA Engineer -------------------- QA-01
|
+-- Creative Director --------------------- design, narrative, balance (src/data/**, DESIGN_SPEC)
|
+-- Art Director -------------------------- visual direction, style code, UI look (src/render/style/**,
                                             src/ui/theme.css, ART_BIBLE, ASSET_LIST)
```

## 2. Roles, responsibilities and reporting lines

| Role | Reports to | Responsibilities | Standing ownership (CLAUDE.md) |
|---|---|---|---|
| Studio Head / Producer | client | Vision, priorities, scheduling (two developers at a time), acceptance of the sprint | `docs/GDD.md`, planning docs |
| CTO | Studio Head | Architecture, contracts, determinism, budgets, pipeline runner, integration after the sprint, change requests to shared files, sprint grants | `src/core/**`, `src/main.ts`, `src/app/contracts.ts`, `src/app/debugApi.ts`, `src/scenes/SceneManager.ts`, `scripts/smoke.cjs`, configs, `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/adr/**`, `docs/STUDIO.md` |
| Technical Art Director | CTO (dotted: Art Director) | Blender pipeline quality, asset reviews (budgets, LODs, bakes, critique loop), technical-art ticket sign-off | `tools/blender/lib/**` and `tools/assets/**` with the CTO (granted to TA-07 for Sprint 1) |
| Technical Artists A-G | Technical Art Director | One ASSET_LIST work package each: deterministic Blender scripts, bakes, LODs, rigs, clips, previews, budgets | their `tools/blender/assets/<dir>/` + generated `public/assets/**` for their ids |
| Creative Director | Studio Head | Game design, narrative, balance numbers, rule clarifications, balance passes after SIM/GP tickets | `src/data/**`, `docs/DESIGN_SPEC.md`, `docs/design/**` |
| Art Director | Studio Head | Visual direction, style code, lighting/grade presets, UI look; co-signs every visual ticket; LUT authoring | `src/render/style/**`, `src/ui/theme.css`, `docs/art/**`, `docs/ART_BIBLE.md`, `docs/ASSET_LIST.md` |
| Lead Graphics Engineer | CTO | Render architecture, frame budget, reviews GFX tickets | `src/render/**` except `style/` |
| Graphics Developers | Lead Graphics Engineer | GFX-01..GFX-06 | per ticket |
| Lead Gameplay Engineer | CTO | Tactical sim, scenes, session, hero; reviews GP tickets and CORE-01 consumers | `src/sim/tactical/**` (not `battleai.ts`), `src/scenes/{World,Battle,Hero}Scene.ts`, `src/scenes/common.ts`, `src/app/session.ts`, `src/hero/**` |
| Gameplay Engineers | Lead Gameplay Engineer | GP-01..GP-04 (CORE-01 reports to the CTO) | per ticket |
| Lead AI & Simulation Engineer | CTO | Strategic sim, AI, determinism of the sim; reviews SIM tickets | `src/sim/strategic/**`, `src/sim/tactical/battleai.ts` |
| Simulation / AI Engineers | Lead AI & Simulation Engineer | SIM-01, SIM-02 | per ticket |
| Lead UI/UX Engineer | CTO | UI framework, screens, input, audio; reviews UI and audio tickets | `src/ui/**` (not `theme.css`), `src/input/**`, `src/audio/**`, `src/scenes/MenuScene.ts` |
| UI Engineers, Audio Developer | Lead UI/UX Engineer | UI-01, UI-02, AUD-01 | per ticket |
| QA Lead | CTO | Test strategy, determinism/balance/perf gates, sign-off of GDD §15 | `tests/**` (CTO seeded `tests/core`, `tests/integration`), `docs/qa/**`, smoke `SHOTS` |
| QA Engineer | QA Lead | QA-01 | per ticket |

Escalation: developer -> reviewing lead -> CTO (technical) or Creative/Art Director (design/look) -> Studio Head.
Change requests to files you do not own go in your ticket report with the exact change (W1).

---

## 3. Sprint 1 ticket board

Priority 1 is scheduled first; a ticket starts when everything in "Depends on" is DONE. "CTO grant" marks
files that normally belong to the CTO and are owned by that ticket for Sprint 1 only. Owned paths are
disjoint across tickets; the generated pipeline files `tools/assets/published.json` and
`src/assets/manifest.ts` belong to no ticket (W3).

| ID | Pri | Title | Team | Developer | Reviewer lead | Owned paths | Depends on | Port | Status |
|---|---|---|---|---|---|---|---|---|---|
| **CORE-01** | 1 | Contracts v2, save-schema migration and parallel-work scaffolding | Gameplay | Engine Developer — Contracts & Save Schema (CTO delegate) | CTO | `src/core/types.ts`<br>`src/core/events.ts`<br>`src/core/constants.ts`<br>`src/core/save.ts`<br>`src/core/settings.ts`<br>`src/core/params.ts`<br>`src/core/debug.ts`<br>`src/core/terrain/cache.ts`<br>`src/app/contracts.ts`<br>`src/app/debugApi.ts`<br>`src/ui/screens/index.ts`<br>`src/ui/screens/registry.ts (new)`<br>`src/ui/screens/placeholder.ts (new)`<br>`index.html`<br>`docs/ARCHITECTURE.md`<br>`tests/contracts/** (new)`<br>`tests/fixtures/** (new)`<br>`tests/core/save.test.ts`<br>`scripts/shots/core-01.cjs (new)`<br>`docs/sprint1/core-01/** (new)`<br>`src/scenes/LabScene.ts (new), src/scenes/lab/** (new, example lab)`<br>`src/main.ts (scene registration line only; CTO grant)` | - | 4401 | TODO |
| **TA-07** | 2 | Pipeline extensions (VAT, impostor, flipbook, LUT, image kinds; publish lock) + WP7 skies, VFX textures and banners | Technical Art | Technical Artist G — Pipeline TD, Skies & VFX | Technical Art Director (CTO co-reviews pipeline code; Art Director co-signs visuals) | `tools/assets/build.mjs, tools/assets/publish.mjs, tools/assets/manifest.mjs, tools/assets/config.mjs (CTO grant)`<br>`src/assets/AssetManager.ts, src/assets/types.ts, src/assets/fallbacks.ts, src/assets/loaders/** (new) (CTO grant)`<br>`src/scenes/AssetViewerScene.ts (CTO grant)`<br>`tools/blender/lib/vat.py, tools/blender/lib/impostor.py, tools/blender/lib/flipbook.py (new, CTO grant), tools/blender/selftest.py`<br>`tools/blender/assets/hdri/**, tools/blender/assets/fx/** (new), tools/blender/assets/banners/** (new), tools/blender/assets/luts/** (new), tools/blender/assets/images/** (new), tools/blender/assets/pipeline_test/** (new)`<br>`public/assets/** files generated for the asset ids whose scripts live in the directories above`<br>`tests/core/assets.test.ts (CTO grant), tests/assets/** (new)`<br>`docs/adr/0003-crowd-impostor-fx-assets.md (new)`<br>`docs/screenshots/pipeline/wp7/** (new)`<br>`scripts/shots/ta-07.cjs (new), docs/sprint1/ta-07/** (new)` | - | 4402 | TODO |
| **GFX-01** | 3 | Lighting & atmosphere: calibrated HDR IBL + time-of-day sky, CSM/PCSS shadows, height fog & god rays, post stack (SSR, TAA/SMAA, DoF, LUT grade, lens), quality tiers | Graphics | Graphics Developer — Lighting, Atmosphere & Post | Lead Graphics Engineer (Art Director co-signs the look) | `src/render/renderer.ts`<br>`src/render/post.ts`<br>`src/render/post/** (new)`<br>`src/render/environment/environment.ts`<br>`src/render/environment/sky.ts`<br>`src/render/environment/atmosphere/** (new)`<br>`src/render/lighting/** (new)`<br>`src/render/materials/pbr.ts, src/render/materials/index.ts, src/render/materials/chunks/** (new)`<br>`src/core/quality.ts (CTO grant), tests/core/quality.test.ts (CTO grant)`<br>`tests/render/lighting/** (new)`<br>`scripts/shots/gfx-01.cjs (new), docs/sprint1/gfx-01/** (new)` | CORE-01, TA-07 | 4403 | TODO |
| **TA-01** | 4 | WP1 PBR materials & terrain library | Technical Art | Technical Artist A — Materials & Terrain Library | Technical Art Director (Art Director co-signs) | `tools/blender/assets/materials/** (incl. existing sandstone_carved_red.py, ground_dry_earth.py)`<br>`tools/blender/assets/terrain/** (new)`<br>`tools/blender/assets/decals/** (new)`<br>`public/assets/textures/<id>/** for the asset ids whose scripts live in the directories above`<br>`docs/screenshots/pipeline/wp1/** (new)`<br>`scripts/shots/ta-01.cjs (new), docs/sprint1/ta-01/** (new)` | TA-07 | 4404 | TODO |
| **SIM-01** | 5 | Strategic world simulation: economy, AoE settlement rules (placement, construction, ages, landmarks, market), armies & supply, sieges, politics, diplomacy, espionage, dynasty, events, autoresolve | AI & Simulation | Simulation Engineer — Strategic World Simulation | Lead AI & Simulation Engineer (Creative Director co-reviews rules and balance) | `src/sim/strategic/** except src/sim/strategic/ai.ts and src/sim/strategic/ai/**`<br>`tests/sim/strategic/** (new)`<br>`scripts/sim/** (new, headless node report scripts)`<br>`docs/sprint1/sim-01/** (new)` | CORE-01 | 4405 | TODO |
| **TA-05** | 6 | WP5 crowd units, standard bearers, villagers, animals & vehicles (rigged, animated, VAT-baked) | Technical Art | Technical Artist E — Crowds, Animals & Vehicles (VAT) | Technical Art Director (Art Director co-signs; Lead Graphics co-reviews runtime fit) | `tools/blender/assets/crowd/** (new)`<br>`tools/blender/assets/animals/** (new)`<br>`tools/blender/assets/vehicles/** (new)`<br>`public/assets/** files generated for the asset ids whose scripts live in the directories above`<br>`docs/screenshots/pipeline/wp5/** (new)`<br>`scripts/shots/ta-05.cjs (new), docs/sprint1/ta-05/** (new)` | TA-07, TA-01 | 4406 | TODO |
| **GP-01** | 7 | Tactical battle simulation: formations, orders, combat, morale, sieges, pathing, outcomes, soldier layer | Gameplay | Gameplay Engineer — Tactical Battle Simulation | Lead Gameplay Engineer (Creative Director co-reviews rules) | `src/sim/tactical/** except src/sim/tactical/battleai.ts and src/sim/tactical/ai/**`<br>`tests/sim/tactical/** (new)`<br>`docs/sprint1/gp-01/** (new)` | CORE-01 | 4407 | TODO |
| **TA-02** | 8 | WP2 vernacular & civic architecture kit, construction & damage kits, props and river boats | Technical Art | Technical Artist B — Vernacular & Civic Architecture Kit | Technical Art Director (Art Director co-signs) | `tools/blender/assets/architecture/** (exists, empty)`<br>`tools/blender/assets/props/** (new)`<br>`tools/blender/assets/boats/** (new)`<br>`public/assets/** files generated for the asset ids whose scripts live in the directories above`<br>`docs/screenshots/pipeline/wp2/** (new)`<br>`scripts/shots/ta-02.cjs (new), docs/sprint1/ta-02/** (new)` | TA-07, TA-01 | 4408 | TODO |
| **GFX-02** | 9 | Terrain (height-blended PBR splat, triplanar cliffs, farmland, roads, apron), water and dynamic weather | Graphics | Graphics Developer — Terrain, Water & Weather | Lead Graphics Engineer (Art Director co-signs) | `src/render/environment/terrain.ts, src/render/environment/terrain/** (new)`<br>`src/render/environment/textures.ts`<br>`src/render/environment/water.ts, src/render/environment/water/** (new)`<br>`src/render/environment/weather.ts, src/render/environment/weather/** (new)`<br>`src/render/materials/splat.ts`<br>`src/render/world/roads.ts`<br>`tests/render/terrain/** (new)`<br>`scripts/shots/gfx-02.cjs (new), docs/sprint1/gfx-02/** (new)` | GFX-01, TA-01, TA-07 | 4409 | TODO |
| **TA-03** | 10 | WP3 monuments, faction landmarks, fortifications (walls L1-L3), waterfront, Setu bridge and siege kit | Technical Art | Technical Artist C — Monuments, Landmarks & Fortifications | Technical Art Director (Art Director co-signs) | `tools/blender/assets/models/** (incl. existing stupa_sanchi.py)`<br>`tools/blender/assets/monuments/** (new)`<br>`tools/blender/assets/landmarks/** (new)`<br>`tools/blender/assets/fortifications/** (new)`<br>`tools/blender/assets/waterfront/** (new)`<br>`public/assets/** files generated for the asset ids whose scripts live in the directories above`<br>`docs/screenshots/pipeline/wp3/** (new)`<br>`scripts/shots/ta-03.cjs (new), docs/sprint1/ta-03/** (new)` | TA-07, TA-01 | 4410 | TODO |
| **GFX-04** | 11 | Crowd renderer (VAT instancing, LOD chain, faction tint), formation readability markers, banners, projectiles and particle/impact VFX | Graphics | Graphics Developer — Crowds, Readability & Battle FX | Lead Graphics Engineer (Art Director co-signs; Lead Gameplay co-reviews readability) | `src/render/units/** (unitModels, soldierRenderer, formationMarkers, armyMarkers + new)`<br>`src/render/fx/** (particles, projectiles, banners + new)`<br>`tests/render/units/** (new)`<br>`scripts/shots/gfx-04.cjs (new), docs/sprint1/gfx-04/** (new)` | GFX-01, TA-05, TA-07, GP-01 | 4411 | TODO |
| **TA-04** | 12 | WP4 vegetation (13 trees with LODs + octahedral impostors), grass cards, crops, ground plants and rocks | Technical Art | Technical Artist D — Vegetation, Crops & Rocks | Technical Art Director (Art Director co-signs) | `tools/blender/assets/vegetation/** (new)`<br>`tools/blender/assets/crops/** (new)`<br>`tools/blender/assets/rocks/** (new)`<br>`public/assets/** files generated for the asset ids whose scripts live in the directories above`<br>`docs/screenshots/pipeline/wp4/** (new)`<br>`scripts/shots/ta-04.cjs (new), docs/sprint1/ta-04/** (new)` | TA-07 | 4412 | TODO |
| **GFX-05** | 13 | Cameras (AoE-style RTS, Wukong-style hero, cinematic director), zoom-look controller, picking and strategic map overlays | Graphics | Graphics Developer — Cameras, Picking & Map Overlays | Lead Graphics Engineer (Lead Gameplay co-reviews camera feel) | `src/render/camera/** (rtsCamera, heroCamera, picking + new cinematic.ts, zoomLook.ts, shake.ts)`<br>`src/render/world/overlays.ts, src/render/world/overlays/** (new)`<br>`tests/render/camera/** (new)`<br>`scripts/shots/gfx-05.cjs (new), docs/sprint1/gfx-05/** (new)` | CORE-01, GFX-01 | 4413 | TODO |
| **TA-06** | 14 | WP6 hero & cinematic characters: Kumara Aditya, rival champion, envoy, enemy archetypes, NPC kit, weapons, portraits | Technical Art | Technical Artist F — Hero & Cinematic Characters | Technical Art Director (Art Director co-signs; Lead Gameplay co-reviews clip frame data) | `tools/blender/assets/characters/** (new)`<br>`tools/blender/assets/weapons/** (new)`<br>`tools/blender/assets/portraits/** (new)`<br>`public/assets/** files generated for the asset ids whose scripts live in the directories above`<br>`docs/screenshots/pipeline/wp6/** (new)`<br>`scripts/shots/ta-06.cjs (new), docs/sprint1/ta-06/** (new)` | TA-07, TA-01, TA-05 | 4414 | TODO |
| **UI-02** | 15 | In-game UI: HUD framework, world HUD & panels, AoE command card, minimap, control groups, battle HUD + radial wheel, hero HUD, input presets & touch | UI/UX | UI Engineer — In-game HUD, Command Card, Minimap & Input | Lead UI/UX Engineer (Art Director co-signs look) | `src/ui/ui.ts, src/ui/dom.ts, src/ui/base.css`<br>`src/ui/components/** (new)`<br>`src/ui/screens/world.ts, src/ui/screens/battle.ts, src/ui/screens/hero.ts`<br>`src/ui/screens/world/**, src/ui/screens/battle/**, src/ui/screens/hero/** (new)`<br>`src/ui/services/** (new)`<br>`src/input/**`<br>`tests/ui/hud/** (new), tests/input/** (new)`<br>`scripts/shots/ui-02.cjs (new), docs/sprint1/ui-02/** (new)` | CORE-01, SIM-01 | 4415 | TODO |
| **GFX-06** | 16 | Settlements: kit-based architecture & layouts (districts, streets, walls L1-L3), construction stages, damage, landmarks, placement ghost and visible villagers | Graphics | Graphics Developer — Settlements, Construction & Villagers | Lead Graphics Engineer (Lead Gameplay co-reviews the AoE feel; Art Director co-signs) | `src/render/architecture/** (layout, buildings, settlement + new)`<br>`tests/render/architecture/** (new)`<br>`scripts/shots/gfx-06.cjs (new), docs/sprint1/gfx-06/** (new)` | GFX-01, GFX-04, TA-02, TA-03, SIM-01 | 4416 | TODO |
| **GFX-03** | 17 | Vegetation rendering: tree LOD + impostors, dense GPU grass with wind, seasonal colour, crops on fields, ground plants and rocks | Graphics | Graphics Developer — Vegetation, Grass & Crops | Lead Graphics Engineer (Art Director co-signs) | `src/render/environment/vegetation.ts`<br>`src/render/vegetation/** (new: trees, grass, crops, impostors, placement)`<br>`tests/render/vegetation/** (new)`<br>`scripts/shots/gfx-03.cjs (new), docs/sprint1/gfx-03/** (new)` | GFX-01, GFX-02, TA-04 | 4417 | TODO |
| **SIM-02** | 18 | AI: battle AI (deployment, tactics, sieges), intent-order translation, campaign AI with personalities and difficulty | AI & Simulation | AI Engineer — Battle AI, Intents & Campaign AI | Lead AI & Simulation Engineer | `src/sim/tactical/battleai.ts, src/sim/tactical/ai/** (new)`<br>`src/sim/strategic/ai.ts, src/sim/strategic/ai/** (new)`<br>`tests/sim/ai/** (new)`<br>`scripts/sim-ai/** (new, headless matchup/autoplay runners)`<br>`docs/sprint1/sim-02/** (new)` | SIM-01, GP-01 | 4418 | TODO |
| **GP-03** | 19 | WorldScene (strategic 3D map) & session flow: selection, placement, command card, control groups, minimap feed, engagements, events, hero missions, ages, autosaves | Gameplay | Gameplay Engineer — World Scene & Session Flow | Lead Gameplay Engineer | `src/scenes/WorldScene.ts, src/scenes/common.ts, src/scenes/world/** (new)`<br>`src/app/session.ts, src/app/session/** (new)`<br>`tests/app/** (new), tests/scenes/world/** (new)`<br>`scripts/shots/gp-03.cjs (new), docs/sprint1/gp-03/** (new)` | SIM-01, UI-02, GFX-02, GFX-04, GFX-05, GFX-06, GFX-01, GFX-03 | 4419 | TODO |
| **UI-01** | 20 | Front-end & narrative UI: main menu + backdrop, loading screen, campaign/sandbox/skirmish setup, settings, save/load, hero dialogue/negotiation/mission screens, end-game statistics, tutorial hints | UI/UX | UI Engineer — Front-end, Narrative Screens & Statistics | Lead UI/UX Engineer (Art Director co-signs look) | `src/ui/screens/menu.ts`<br>`src/ui/screens/frontend/**, src/ui/screens/narrative/**, src/ui/screens/stats/** (new)`<br>`src/ui/frontend/** (new: loading renderer, hints service, chart helpers)`<br>`src/scenes/MenuScene.ts`<br>`tests/ui/frontend/** (new)`<br>`scripts/shots/ui-01.cjs (new), docs/sprint1/ui-01/** (new)` | CORE-01, UI-02 | 4420 | TODO |
| **GP-04** | 21 | BattleScene (field command): deployment, selection & orders, intents, readability, cinematic camera, sieges, results, benchmark mode | Gameplay | Gameplay Engineer — Battle Scene & Field Command | Lead Gameplay Engineer | `src/scenes/BattleScene.ts, src/scenes/battle/** (new)`<br>`tests/scenes/battle/** (new)`<br>`scripts/shots/gp-04.cjs (new), docs/sprint1/gp-04/** (new)` | GP-01, SIM-02, UI-02, GFX-02, GFX-04, GFX-05, GFX-06, GFX-01, GFX-03 | 4421 | TODO |
| **GP-02** | 22 | Hero mode: exploration, dialogue & negotiation runtime, five missions, Wukong-style focused melee (combo, heavy, roll i-frames, guard/parry, stamina, hit-stop), enemy AI, HeroScene | Gameplay | Gameplay Engineer — Hero Mode (Exploration, Missions & Melee) | Lead Gameplay Engineer (Creative Director co-reviews; Art Director co-signs visuals) | `src/hero/** (controller, animation, combat, enemies, dialogue, negotiation, missions + new)`<br>`src/scenes/HeroScene.ts, src/scenes/hero/** (new)`<br>`tests/hero/** (new)`<br>`scripts/shots/gp-02.cjs (new), docs/sprint1/gp-02/** (new)` | TA-06, GFX-05, GFX-06, GFX-04, UI-02, SIM-01, GP-03, UI-01, GFX-01, GFX-03 | 4422 | TODO |
| **AUD-01** | 23 | Procedural audio: adaptive raga-inspired score, district & world ambience, full SFX set, spatial 3D audio and mixing | Audio | Audio Developer — Procedural Score, Ambience & SFX | Lead UI/UX Engineer (audio) | `src/audio/** (audio.ts + new synth/, music/, ambience/, sfx/, spatial/ modules)`<br>`tests/audio/** (new)`<br>`scripts/audio/** (new: offline render + spectrogram tools)`<br>`docs/sprint1/aud-01/** (new)` | CORE-01 | 4423 | TODO |
| **QA-01** | 24 | QA automation: Playwright playthroughs, determinism/save/economy/morale suites, balance harnesses, perf benchmark (1,000 / 5,000 soldiers), smoke shots, GDD §15 sign-off | Tools & QA | QA Engineer — Automation, Determinism, Balance & Performance | QA Lead | `tests/qa/**, tests/perf/** (new)`<br>`tests/integration/** (CTO-seeded; QA owns it per CLAUDE.md)`<br>`scripts/qa/** (new), scripts/bench.cjs (new)`<br>`scripts/smoke.cjs (SHOTS list only; CTO grant)`<br>`docs/qa/** (new), docs/sprint1/qa-01/** (new)` | all other tickets | 4424 | TODO |

---

## 4. Working agreements (every ticket)

- **W1 Ownership.** Edit only your ticket's owned paths (and new files inside them). Need a change elsewhere?
  Put the exact change (file, symbol, diff) in your report for the owner on the board, or for the CTO for
  CTO files (`src/core/**` except grants, `src/main.ts`, `src/scenes/SceneManager.ts`, `src/app/contracts.ts`,
  `tools/blender/lib/**` except TA-07's new modules, configs, `CLAUDE.md`, `docs/ARCHITECTURE.md`,
  `docs/adr/**`). The Art Director owns `src/render/style/**`, `src/ui/theme.css`, `docs/art/**`; the
  Creative Director owns `src/data/**` - send numeric/data requests, do not edit. Sprint grants on the board
  override the CLAUDE.md table for Sprint 1 only.
- **W2 Contracts.** CORE-01 lands Contracts v2 before any other code ticket starts. New GameActions /
  SessionView / GameScene members are optional and tagged `@sprint1 implemented by <ticket>` - feature-detect
  them (`ctx.actions.startHeroMission?.(...)`). After CORE-01, contract changes go to the CTO as exact diffs;
  never duplicate contract types locally. CORE-01 alone has a **compile-fix allowance**: minimal compile-only
  edits in files of tickets that have not started (all of them depend on CORE-01), each listed in its report.
- **W3 Content publishing.** Iterate with direct Blender runs
  (`SAMRAJYA_DRAFT=1 /root/.venvs/blender/bin/python tools/blender/assets/<dir>/<id>.py` writes only
  `.asset-cache/<id>/`). Publish only your ids and always under the lock:
  `flock /home/user/new-game-like-gta-/.asset-cache/.publish.lock npm run assets -- <your ids>` (keep using it
  after TA-07 adds the internal lock). Never run `npm run assets` without ids, never `--force` ids you do not
  own, never commit `--draft` output. `tools/assets/published.json` and `src/assets/manifest.ts` are generated:
  never hand-edit them; commit them together with your `public/assets/**` outputs right after your locked run
  (teammates' entries in them are expected). `npm run assets:check` must pass before committing. Blender bakes
  share 4 CPUs: one bake at a time per ticket, long `--force` rebuilds when the other technical artist is idle.
  Final Cycles previews go to `docs/screenshots/pipeline/wpN/` (TA-07 adds `--previews-dir`; copy by hand
  until then).
- **W4 Asset ids and folders.** Use the exact ASSET_LIST ids; any extra id carries your package prefix
  (`mat_`, `arch_`, `mon_`, `veg_`, `crowd_`, `char_`, `fx_`). Scripts live only in your ticket's
  `tools/blender/assets/<dir>/`; package-local helpers are `_name.py` files beside them. New
  `tools/blender/lib` modules are TA-07's.
- **W5 Fallbacks.** Every runtime consumer of a pipeline asset keeps a procedural fallback
  (`ctx.assets.registerModelFallback(...)` from your own code, or handle null handles). `?assets=off` and
  the single-file build must render every scene with no console errors.
- **W6 Evidence.** Capture scripts at `scripts/shots/<ticket-id>.cjs` (lower case, Playwright with the
  CLAUDE.md launch args; 1280x720 and 390x844 where UI matters); outputs in `docs/sprint1/<ticket-id>/`.
  Smoke runs use `SMOKE_PORT=<your port> SMOKE_OUT=docs/sprint1/<ticket-id>/smoke npm run smoke` - never
  overwrite the baseline `docs/screenshots/*.png`. Features the scenes do not drive yet are shown in labs:
  `?scene=lab&lab=<id>` with `*.lab.ts` modules inside your own directories (CORE-01 LabScene). Reviewers open
  every PNG with the Read tool; describe each image in your report.
- **W7 Ports.** Each ticket uses port 4400 + priority for preview, dev and smoke (board column "Port").
- **W8 Tests.** New tests live in the test directory of your owned paths; existing suites stay green -
  `tests/core/purity.test.ts`, `tests/integration/determinism.test.ts` and `tests/data.test.ts` are guards.
  `npm test` stays under 5 minutes; long harnesses are scripts.
- **W9 Performance evidence.** SwiftShader FPS and GPU ms mean nothing here. Budgets (ARCHITECTURE §15) are
  judged on draw calls and triangles from `__SAMRAJYA__.getProfile()` and on CPU ms of sim/prep code
  (node tests, profiler marks). Report before/after tables.
- **W10 Commits.** `git add <your paths>` only (+ the generated pipeline files per W3). Message:
  `[<developer role>] <summary>`, blank line, body, then the two trailer lines from your task. Commit in
  green stages (typecheck + tests pass at every commit) so an interrupted session resumes from the last
  commit. Never stash, reset, `checkout --`, clean, switch branches or push; retry on `.git/index.lock`.
- **W11 Look values.** Every visual knob from `ctx.quality.settings`; colours, light, fog and grade from
  `src/render/style/**`; UI from `src/ui/theme.css` tokens. Never hard-code look values.
- **W12 Reports.** Finish with a report to your lead: commits, evidence paths, budget numbers, requests to
  other owners (exact changes), known issues, follow-ups.
- **W13 Simulation rules.** `src/sim/**` and `src/core/terrain/**` stay engine-agnostic and deterministic
  (CLAUDE.md); commands are the only way to change authoritative state.
- **W14 Critique loop (visual work).** Blender: Cycles preview -> Read -> fix -> publish -> engine viewer /
  lab / scene shot -> Read -> fix, until it matches the ART_BIBLE targets; the Art Director co-signs. Code:
  screenshot -> Read -> fix.
- **W15 Compatibility.** Public APIs consumed by other tickets stay source-compatible during the sprint (add,
  do not break). Shared contracts: `EnvironmentRig` / `PostPipeline` / material chunks (GFX-01),
  `TerrainRenderer` / `loadHeightfieldAsync` / water / weather (GFX-02), vegetation renderer (GFX-03),
  `CrowdRenderer` / `SoldierRenderer` / `FxSystem` / `BannerRenderer` / markers (GFX-04), camera controllers /
  `ZoomLookController` / picking / overlays (GFX-05), `SettlementLayout` / `ArchitecturePlacement` /
  `SettlementRenderer` / `PlacementGhost` / `VillagerSystem` (GFX-06), placement + selectors +
  `applyHeroMissionResult` (SIM-01), `runBattleAI` / `translateIntent` / `runCampaignAI` (SIM-02),
  `BattleState` / `SoldierSim` (GP-01), `UIManager` / components / input API (UI-02), the asset loaders
  (TA-07).

---

## 5. Dependency graph and schedule

Waves = longest dependency chain (a ticket can start once all its dependencies are DONE):

| Wave | Tickets (priority) |
|---|---|
| 0 | CORE-01 (1), TA-07 (2) |
| 1 | GFX-01 (3), TA-01 (4), SIM-01 (5), GP-01 (7), TA-04 (12), AUD-01 (23) |
| 2 | TA-05 (6), TA-02 (8), GFX-02 (9), TA-03 (10), GFX-05 (13), UI-02 (15), SIM-02 (18) |
| 3 | GFX-04 (11), TA-06 (14), GFX-03 (17), UI-01 (20) |
| 4 | GFX-06 (16) |
| 5 | GP-03 (19), GP-04 (21) |
| 6 | GP-02 (22) |
| 7 | QA-01 (24) |

Direct dependencies:

| Ticket | Needs DONE first | Unblocks |
|---|---|---|
| CORE-01 | - | GFX-01, SIM-01, GP-01, GFX-05, UI-02, UI-01, AUD-01, QA-01 |
| TA-07 | - | GFX-01, TA-01, TA-05, TA-02, GFX-02, TA-03, GFX-04, TA-04, TA-06, QA-01 |
| GFX-01 | CORE-01, TA-07 | GFX-02, GFX-04, GFX-05, GFX-06, GFX-03, GP-03, GP-04, GP-02, QA-01 |
| TA-01 | TA-07 | TA-05, TA-02, GFX-02, TA-03, TA-06, QA-01 |
| SIM-01 | CORE-01 | UI-02, GFX-06, SIM-02, GP-03, GP-02, QA-01 |
| TA-05 | TA-07, TA-01 | GFX-04, TA-06, QA-01 |
| GP-01 | CORE-01 | GFX-04, SIM-02, GP-04, QA-01 |
| TA-02 | TA-07, TA-01 | GFX-06, QA-01 |
| GFX-02 | GFX-01, TA-01, TA-07 | GFX-03, GP-03, GP-04, QA-01 |
| TA-03 | TA-07, TA-01 | GFX-06, QA-01 |
| GFX-04 | GFX-01, TA-05, TA-07, GP-01 | GFX-06, GP-03, GP-04, GP-02, QA-01 |
| TA-04 | TA-07 | GFX-03, QA-01 |
| GFX-05 | CORE-01, GFX-01 | GP-03, GP-04, GP-02, QA-01 |
| TA-06 | TA-07, TA-01, TA-05 | GP-02, QA-01 |
| UI-02 | CORE-01, SIM-01 | GP-03, UI-01, GP-04, GP-02, QA-01 |
| GFX-06 | GFX-01, GFX-04, TA-02, TA-03, SIM-01 | GP-03, GP-04, GP-02, QA-01 |
| GFX-03 | GFX-01, GFX-02, TA-04 | GP-03, GP-04, GP-02, QA-01 |
| SIM-02 | SIM-01, GP-01 | GP-04, QA-01 |
| GP-03 | SIM-01, UI-02, GFX-02, GFX-04, GFX-05, GFX-06, GFX-01, GFX-03 | GP-02, QA-01 |
| UI-01 | CORE-01, UI-02 | GP-02, QA-01 |
| GP-04 | GP-01, SIM-02, UI-02, GFX-02, GFX-04, GFX-05, GFX-06, GFX-01, GFX-03 | QA-01 |
| GP-02 | TA-06, GFX-05, GFX-06, GFX-04, UI-02, SIM-01, GP-03, UI-01, GFX-01, GFX-03 | QA-01 |
| AUD-01 | CORE-01 | QA-01 |
| QA-01 | all other tickets | - |

Scheduling: the producer runs two tickets at a time in priority order, skipping tickets whose dependencies are
not DONE. Priorities interleave technical-art tickets (CPU-heavy Blender bakes) with code tickets so that at
most one bake-heavy ticket usually runs at a time. AUD-01 has no dependency beyond CORE-01 and is the
filler whenever the next ticket is blocked.

## 6. Review flow and definition of done

1. Developer finishes the acceptance list, commits in green stages, writes the report (W12).
2. Reviewer lead (board column) re-runs typecheck/tests/build and the ticket's capture script, **reads every
   screenshot**, checks budgets and ownership (`git show --stat` touches only owned paths + allowed generated
   files).
3. Co-signers: the Art Director for every visual ticket, the Creative Director for rules/balance tickets
   (SIM-01, GP-01, GP-02), the CTO for TA-07 pipeline code and CORE-01.
4. Status moves TODO -> IN PROGRESS -> REVIEW -> DONE on this board (the producer updates it).

Definition of done (all tickets): acceptance list met; `npm run typecheck` clean; `npm test` green;
`npm run build` and `npm run build:single` succeed; smoke passes with no console errors on the ticket's port;
evidence in `docs/sprint1/<ticket-id>/`; budgets met with numbers; no files outside owned paths; fallbacks
work with `?assets=off`; report delivered. Technical-art tickets additionally: `npm run assets:check` passes,
ASSET_LIST §0.4 definition of done for every asset, WP budget met.

## 7. GDD §15 coverage

| GDD §15 item | Tickets |
|---|---|
| One strategic region with settlements and resource production | SIM-01, GFX-02, GFX-06, GP-03, TA-01, TA-02, TA-03 |
| Two playable factions with distinct strategic strengths | SIM-01 (modifiers, variants, landmarks), TA-03 (landmarks L1/L2), TA-05 (faction kits), UI-01 |
| At least six functional combat classes (9 delivered) | GP-01, TA-05, GFX-04, SIM-02 |
| Formation movement, attack, retreat and morale | GP-01, SIM-02, GP-04, GFX-04, UI-02 |
| Working economy and army supply model | SIM-01, UI-02, GP-03 |
| Battle prototype targeting 1,000 active combatants | GP-01, GFX-04, TA-05, GP-04, QA-01 (bench) |
| Simplified simulation for distant armies and battles | SIM-01 (autoresolve), SIM-02, GFX-04 (army tokens) |
| Save/load and reproducible simulation tests | CORE-01, SIM-01, GP-01, GP-03, GP-04, QA-01 |
| Keyboard/mouse and touch-interface prototypes | UI-02, UI-01, GFX-05, GP-03, GP-04, GP-02 |
| Performance profiling and crash reporting | GFX-01, GP-04 (bench mode), QA-01 (bench + gates) |
| Short campaign scenario with multiple viable outcomes | SIM-01, SIM-02, GP-03, GP-02, UI-01, QA-01 (autoplay per path) |
| Client references: AoE layer (placement, construction, villagers, ages, landmarks, walls, minimap, command card, control groups, statistics) | SIM-01, GFX-06, GP-03, UI-02, UI-01, TA-02, TA-03, TA-05 |
| Client references: Wukong fidelity (IBL, shadows, fog, DoF, TAA, materials, hero, melee, VFX) | GFX-01, GFX-02, GFX-03, TA-01, TA-03, TA-06, GP-02, GFX-04, GFX-05, AUD-01 |

---

## 8. Ticket details

Each ticket below is self-contained: spec, acceptance criteria, owned paths and what to read first.

### CORE-01 - Contracts v2, save-schema migration and parallel-work scaffolding

- **Team:** Gameplay - **Developer:** Engine Developer — Contracts & Save Schema (CTO delegate) - **Reviewer:** CTO
- **Priority:** 1 - **Port:** 4401 - **Depends on:** - - **Status:** TODO
- **Owned paths:**
  - `src/core/types.ts`
  - `src/core/events.ts`
  - `src/core/constants.ts`
  - `src/core/save.ts`
  - `src/core/settings.ts`
  - `src/core/params.ts`
  - `src/core/debug.ts`
  - `src/core/terrain/cache.ts`
  - `src/app/contracts.ts`
  - `src/app/debugApi.ts`
  - `src/ui/screens/index.ts`
  - `src/ui/screens/registry.ts (new)`
  - `src/ui/screens/placeholder.ts (new)`
  - `index.html`
  - `docs/ARCHITECTURE.md`
  - `tests/contracts/** (new)`
  - `tests/fixtures/** (new)`
  - `tests/core/save.test.ts`
  - `scripts/shots/core-01.cjs (new)`
  - `docs/sprint1/core-01/** (new)`
  - `src/scenes/LabScene.ts (new), src/scenes/lab/** (new, example lab)`
  - `src/main.ts (scene registration line only; CTO grant)`
- **Read first:**
  - CLAUDE.md
  - docs/STUDIO.md (§4 working agreements, §8 every ticket's spec)
  - docs/ARCHITECTURE.md §2-§6, §9-§14
  - docs/DESIGN_SPEC.md §2.3, §6, §7, §8, §11.5-§11.9, §12, §14.2-§14.3
  - docs/ART_BIBLE.md §13 (quality matrix) and §17 (CTO requests)
  - src/core/types.ts, src/app/contracts.ts, src/core/events.ts, src/core/save.ts, src/core/quality.ts, src/core/settings.ts, src/core/params.ts, src/ui/screens/index.ts

**Spec**

Goal: land, in ONE reviewed batch, every cross-team contract change the other 23 Sprint-1 tickets need, so they can work in parallel against stable interfaces. No gameplay or visual behaviour changes in this ticket. FIRST capture v1 save fixtures from the current build (campaign day 30, a mid-battle skirmish, a sandbox at month 6) into tests/fixtures/saves/ before touching any type.

1. Domain state v2 (src/core/types.ts; SAVE_VERSION = 2, WORLD_SCHEMA_VERSION = 2 in constants.ts; migration v1->v2 with defaults registered in save.ts). Required additions from DESIGN_SPEC §14.3 CTO item 1: FactionState.age (default ScenarioDef.startingAges > FactionDef.startingAge > 'janapada'), FactionState.landmarks: string[], FactionState.materials {timber, stone}, FactionState.policies {holdReserve, rationingUntilDay}, FactionState.marketPrices {grain, timber, stone} (factors, default 1), WorldState.monsoon {strength, year}, WorldState.statistics: Record<FactionId, Record<string, number>> (END_GAME_STATS ids), BuildingInstance.cell?/rot? and the same on ConstructionJob, ArmyState.forcedMarch, SkirmishSetup.compositions?, SettlementState.rallyPoint? ({x,z} or {armyId}). Then AUDIT DESIGN_SPEC §6-§8 against types.ts and add every missing persistent field the formulas need, at least: ConstructionJob landmarkId?/paid cost/crew; SettlementState crop health (kharif/rabi + farming labor at sowing), occupation start day, besieging army, starvation days; FactionState last-known enemy armies (ghost markers: pos + day), counter-intel / protect-court timers, advisor ignored counts; relation war score, war weariness, truce-until day; BattleState phase 'deployment'|'battle'|'ended' + deploymentEndsAt, siege state (12 wall segments HP, gates, towers, breaches, engineer works with progress), rally cooldown, per-formation rally count / shapeChangeUntil / panic timer / charge-run distance / hidden flag; BattleOutcome prisoners per side, pursuit losses, captured supply, commander fate, war-score delta, chronicle line + place name, routs per side, experience gains; SoldierBuffers anim variant (Uint8), anim start time (Float32), role flags (standard bearer, drummer, commander, mounted). All additive; v1 mid-battle saves must still load.

2. Reserved faction id REBEL_FACTION_ID = 'rebels' (§14.3 item 2): legal as ArmyState.factionId, never a WorldState.factions key; helper isRebelFaction().

3. Commands: StrategicCommand market_trade, start_landmark, set_policy, forced_march, prisoners, capture_decision, set_rally_point; build gains cell/rot (§14.3 item 3). BattleCommand rally (item 4). Condition kinds age_at_least, landmark_built (item 6). SimEvent kinds for feedback: construction_started, landmark_started, age_advanced, monsoon_roll, spoilage, market_trade, rebels_spawned, secession, governor_demand, siege_breach, depot_raided, army_sighted, hero_mission_available (small payloads).

4. App contracts (src/app/contracts.ts): ScreenPropsMap ids build_placement, market, age_panel, economy_panel, mission_card, hero_dialogue, hero_negotiation, mission_result, game_stats, hint_card (§12.1); hero_hud props gain an optional combat block (hp, stamina, salve charges, lock-on target screen pos, enemy bars, objective, compass heading, caption) and battle_hud props gain deployment info, rally cooldown and per-formation screen anchors. New GameActions members are OPTIONAL with a JSDoc '@sprint1 implemented by GP-03': startHeroMission(missionId), completeHeroMission(result: HeroMissionResult), abandonHeroMission(), decidePrisoners(engagementId, decision), decideCapture(settlementId, decision), skipDeployment(); SessionView optional heroMission, pendingEngagements, difficulty. GameScene gains optional debugCommand(name, args): unknown; window.__SAMRAJYA__ gains call(name, ...args) (forwards to the active scene) and showScreen(id, props) for UI captures (src/core/debug.ts + src/app/debugApi.ts).

5. Bus (src/core/events.ts): ui:hint {key}, hero:mission_end {missionId, success}, hero:combat {kind: hit|parry|perfect_dodge|guard_break|stagger|finisher, x, y, z, strength}, world:alert {kind, x, z, severity} (minimap pings), camera:shake {amplitude, durationSec}, audio:listener {x,y,z,fx,fy,fz}, audio:ambience {layers: {key, gain}[]}, audio:stinger {stinger}, audio:sfx gains optional position {x,y,z}; audio:mood moods gain hero_explore, hero_combat, duel, siege. SFX_KINDS additions (melee: sword_light, sword_heavy, parry_ring, block_thud, roll_cloth, body_hit, stagger_grunt, salve; world: bell_temple, construction_complete, landmark_complete, age_up_fanfare, market_coins, gate_break, wall_crumble, ram_hit, fire_crackle, river_splash, footstep_stone, footstep_dirt). If a switch in audio.ts needs a default branch, use the compile-fix allowance.

6. Input (INPUT_ACTIONS, DESIGN_SPEC §8.8, §11.8): shape_loose, shape_circle, order_stance, commander_rally, idle_builders_next, idle_army_next, select_capital, card_next_tab, card_slot_0..card_slot_14, camera_rotate_left/right, hero_attack_light, hero_attack_heavy, hero_roll, hero_guard, hero_salve, hero_lock_on, hero_skip_cinematic, dialogue_choice_1..5.

7. Settings & quality: GameSettings additions with defaults in settings.ts: keyPreset 'classic'|'grid', autoPause {battleStart, commanderFallen, formationRouted, narrativeEvents}, hintsSeen: string[], simpleMode, relationColoring, minimapNorthUp, holdToToggle {guard, run}, subtitles. QualitySettings additions (ART_BIBLE §13, ARCHITECTURE §19): shadows.contact, shadows.pcss, ssr, dof, shaftsSamples, heightFog 'exp2'|'height'|'height_mist', lensEffects, grassDensity, practicalLights, treeImpostorDistance, villagerCap, crowdLod {vat0, vat1, impostor}, and 'taa' added to the antialias union. Write initial values for low/medium/high/ultra exactly per ART_BIBLE §13 into src/core/quality.ts under the compile-fix allowance (GFX-01 owns quality.ts afterwards).

8. URL params (params.ts): mission, mood, district, camdist, cine, colorblind, reducedmotion, keypreset, bench, age, deploy (0 = skip deployment), csm, splat, clip, count, kit.

9. Parallel-work scaffolding. (a) Screen registry: keep SCREEN_FACTORIES for existing ids; add discovery of new screen modules with import.meta.glob('./**/*.screen.ts', {eager: true}) - each module exports SCREENS: ScreenRegistration[] ({id, factory}); a discovered id must not already be static (test); ids without a factory resolve to a themed placeholder panel (placeholder.ts) that prints the id and its prop keys. Same discovery for UI services: src/ui/**/*.service.ts exporting SERVICES: UiService[] ({id, start(ctx, ui): () => void}) exposed as UI_SERVICES (UI-02's UIManager starts them). (b) core/terrain/cache.ts: primeHeightfield(spec, grids) so a Web-Worker result (GFX-02) seeds the cache; test primed == generated. (c) LabScene ('lab' added to SCENE_IDS, SceneParams {scene: 'lab'; labId}, registered in main.ts): `?scene=lab&lab=<id>` lazily loads a discovered module (import.meta.glob('/src/**/*.lab.ts') non-eager, excluded from the single-file build) exporting LAB = {id, title, setup(ctx, host): LabInstance} where host provides an EnvironmentRig, a camera with orbit controls, an optional terrain window and a ground plane, and LabInstance = {update(dt), dispose(), debugCommand?}; supports freeze/screenshot/sceneReady like every scene. Graphics tickets use labs to show features that the gameplay scenes do not drive yet. Ship one example lab (src/scenes/lab/example.lab.ts).

10. index.html boot splash per ART_BIBLE §17 CTO item 1 (Tiro Devanagari Sanskrit / Palatino fallback, radial indigo background).

11. docs/ARCHITECTURE.md: new section 'Contracts v2 (Sprint 1)' with a table member -> implementing ticket, the registry/service discovery rule and the optional-member convention.

Compile-fix allowance (STUDIO.md W2): every code ticket depends on CORE-01, so you may make minimal compile-only edits in not-yet-started tickets' files to keep typecheck green (initialise new required state in createWorld in src/sim/strategic/world.ts, preset values in src/core/quality.ts, a default branch in a switch). No behaviour change; list every such edit (file + lines) in your report. Rules: additive only, no renames, deterministic (no new randomness), every new field has a migration default, purity and determinism tests stay green.

**Acceptance**

- [ ] npm run typecheck clean; npm test green: the existing suites (90 tests incl. tests/core/purity.test.ts, tests/integration/determinism.test.ts, tests/data.test.ts) plus new tests/contracts/migration.test.ts (each v1 fixture in tests/fixtures/saves/ loads, migrates to v2, validates, and serialize->deserialize->serialize is byte-identical), tests/contracts/registry.test.ts (every ScreenId resolves to a factory or the placeholder; discovered ids never shadow static ones; prints the placeholder list), tests/contracts/contracts.test.ts (INPUT_ACTIONS and SFX_KINDS unique; default GameSettings contain every new field; QUALITY_PRESETS define every QualitySettings field for all 4 tiers) and tests/contracts/heightfield-prime.test.ts.
- [ ] Game behaviour unchanged: npm run build and npm run build:single succeed; SMOKE_PORT=4401 SMOKE_OUT=docs/sprint1/core-01/smoke npm run smoke passes 14/14 with no console errors; the reviewer compares the smoke PNGs with docs/screenshots/*.png (no visible difference).
- [ ] scripts/shots/core-01.cjs captures the boot splash and two placeholder screens opened with __SAMRAJYA__.showScreen('market', ...) and showScreen('game_stats', ...) to docs/sprint1/core-01/; the reviewer reads the PNGs.
- [ ] ?scene=lab&lab=example renders and reaches sceneReady with no console errors; an unknown lab id shows a themed error panel and falls back to the menu (shots script asserts both).
- [ ] __SAMRAJYA__.call('noop') round-trips to the active scene (debugCommand) without errors (asserted in the shots script).
- [ ] docs/ARCHITECTURE.md contains the 'Contracts v2 (Sprint 1)' section listing every added member and its implementing ticket.
- [ ] Report lists every compile-fix edit made outside owned paths (file, line range, why) - expected only world.ts createWorld defaults, quality.ts preset values and switch default branches.

---

### TA-07 - Pipeline extensions (VAT, impostor, flipbook, LUT, image kinds; publish lock) + WP7 skies, VFX textures and banners

- **Team:** Technical Art - **Developer:** Technical Artist G — Pipeline TD, Skies & VFX - **Reviewer:** Technical Art Director (CTO co-reviews pipeline code; Art Director co-signs visuals)
- **Priority:** 2 - **Port:** 4402 - **Depends on:** - - **Status:** TODO
- **Owned paths:**
  - `tools/assets/build.mjs, tools/assets/publish.mjs, tools/assets/manifest.mjs, tools/assets/config.mjs (CTO grant)`
  - `src/assets/AssetManager.ts, src/assets/types.ts, src/assets/fallbacks.ts, src/assets/loaders/** (new) (CTO grant)`
  - `src/scenes/AssetViewerScene.ts (CTO grant)`
  - `tools/blender/lib/vat.py, tools/blender/lib/impostor.py, tools/blender/lib/flipbook.py (new, CTO grant), tools/blender/selftest.py`
  - `tools/blender/assets/hdri/**, tools/blender/assets/fx/** (new), tools/blender/assets/banners/** (new), tools/blender/assets/luts/** (new), tools/blender/assets/images/** (new), tools/blender/assets/pipeline_test/** (new)`
  - `public/assets/** files generated for the asset ids whose scripts live in the directories above`
  - `tests/core/assets.test.ts (CTO grant), tests/assets/** (new)`
  - `docs/adr/0003-crowd-impostor-fx-assets.md (new)`
  - `docs/screenshots/pipeline/wp7/** (new)`
  - `scripts/shots/ta-07.cjs (new), docs/sprint1/ta-07/** (new)`
- **Read first:**
  - CLAUDE.md
  - docs/STUDIO.md (W3 publishing rules, W4 asset ids)
  - docs/ARCHITECTURE.md §18 (pipeline), §19 (render targets), §20 (VAT plan)
  - docs/adr/0002-aaa-content-pipeline.md
  - docs/ASSET_LIST.md §0 and WP7 (plus WP4/WP5/WP6 to know what the new kinds must carry)
  - docs/ART_BIBLE.md §4.1 (Nishita parameters), §4.4, §10, §11
  - tools/assets/*.mjs, src/assets/*.ts, src/scenes/AssetViewerScene.ts, tools/blender/lib/*.py, tools/blender/selftest.py, tools/blender/assets/hdri/sky_day.py

**Spec**

Two halves: (A) extend the content pipeline so the other technical-art and graphics tickets can ship crowds, impostors, VFX, grades and characters; (B) deliver ASSET_LIST WP7 content. This ticket is the only owner of the runner, src/assets and the new Blender lib modules for the whole sprint; other tickets send you change requests.

A. Pipeline

A1 Publish concurrency: two `npm run assets -- <ids>` runs from different tickets must never lose entries (today each run rewrites published.json from its own start-of-run snapshot). Take an exclusive lock (.asset-cache/.publish.lock, O_EXCL with pid + timestamp, stale after 30 min) only around: re-read tools/assets/published.json, merge THIS run's ids, write it, regenerate src/assets/manifest.ts, check budgets. Blender stages run outside the lock; --check stays lock-free. Keep compatibility with the interim `flock` convention in STUDIO.md W3.

A2 Incremental hashing also covers package-local helper modules (sibling `_*.py` files a script imports) so tickets keep helpers next to their scripts instead of touching tools/blender/lib. Add `--previews-dir <dir>` so each work package copies its Cycles previews into its own docs/screenshots/pipeline/wpN/ folder.

A3 Per-asset tier control: docstring tags @tiers ultra,high and @fallback <id> (P2 sets are not shipped on mobile; the runtime substitutes the fallback; ASSET_LIST WP1 note).

A4 New kinds (src/assets/types.ts + manifest generator + publisher + budgets + typed id unions VatAssetId, ImpostorAssetId, FlipbookAssetId, LutAssetId, ImageAssetId):

- vat (ARCHITECTURE §20): LOD0/LOD1 GLB in rest pose with vertex order matching the bake; VAT position texture storing offsets from rest (precision), half float, lossless (EXR ZIP/PIZ or raw .bin + JSON header - choose and justify in the ADR); octahedral normal texture; vertex-column wrapping so width <= 4096; clip table {name, startFrame, frames, fps (15), loop, strideMeters?, speed?}; animated bounds; vertex-colour convention R team mask, G cloth-variation seed, B part id; optional impostor sheet (8 directions x key frames of idle/walk/attack/die, 128 px).

- impostor: hemi-octahedral 8x8 frames (256/192/128 px per tier) with baseColor+alpha and normal+depth maps, radius, suggested switch distance.

- flipbook: cols x rows atlas, fps, loop, colour/alpha + optional normal (lit smoke) and emissive, blend/soft-particle hints.

- lut: 32^3 as a 1024x32 lossless strip; source docs/art/luts/<id>.cube|png when the Art Director provides it, else generated from GRADE_PRESETS (src/render/style/palette.ts) with the lookdev grade math; identity must be exact.

- image: one sRGB image per tier (portraits, key art, sun sprite, lens dirt, UI vignettes).

- model kind gains typed optional metadata: clipEvents (per clip: hit_start, hit_end, cancel, iframe_start, iframe_end, footstep...), rootMotion, construction {footprint mesh, scaffold module transforms, courseHeights}, sockets (banner, weapon, rider), variants (age / damage) and a validated meta passthrough.

A5 Runtime (src/assets/AssetManager.ts): loadVat, loadImpostor, loadFlipbook, loadLut, loadImage - ref-counted, tier-aware, decoded off the main thread where possible (fetch + createImageBitmap / DataView), returning null when assets are off or a load fails so callers use their procedural fallbacks. Verify skinned GLBs end to end (gltf-transform keeps skins/joints/weights through prune/flatten/join/meshopt; loadModel returns independently animatable clones via SkeletonUtils.clone plus AnimationClips and clipEvents). Expose the dithered LOD cross-fade hook agreed with GFX-01 (materials/chunks) for THREE.LOD objects.

A6 Blender libs: lib/vat.py (armature + actions -> per-frame depsgraph evaluation at 15 fps, rest-relative positions, octahedral normals, LOD1 re-bake after lod.decimate, self-check of reconstruction error), lib/impostor.py (orthographic Cycles captures per view of albedo/alpha and normal/depth, low samples, film transparent, numpy packing), lib/flipbook.py (Mantaflow smoke/fire on CPU or numpy curl-noise volumes rendered with Cycles; atlas packing; normals from density). Extend selftest.py; add pipeline test assets in tools/blender/assets/pipeline_test/ (vat_test_dummy: rigged humanoid with idle/walk/attack; a skinned test character; an impostor test object).

A7 Asset viewer modes: `?asset=<vat>&clip=walk&count=500` crowd grid with phase offsets and two team tints; impostor-vs-mesh A/B with distance slider; flipbook playback; LUT A/B split; skinned clip playback with clipEvents markers; `?splat=a,b,c,d` 4-layer terrain lookdev for TA-01; `?kit=id1,id2,...` multi-asset grid layout (instanced) reporting draw calls for TA-02/TA-03; sky picker for every hdri.

A8 Write docs/adr/0003-crowd-impostor-fx-assets.md (formats, budgets, runtime API, examples).

B. WP7 content (ART_BIBLE §4.1 Nishita parameters, §10, §11; ASSET_LIST WP7)

B1 Skies sky_dawn, sky_noon, sky_dusk, sky_night (stars; moon removed from the dome and exported as the manifest 'sun' = moon light; irradiance ~0.08), sky_overcast, sky_haze (P1), sky_fog (P2); same tiers as sky_day; record ambientIrradiance and sun; keep sky_day and sky_golden.

B2 Flipbooks fx_fire, fx_smoke (+ normal), fx_dust (puffs, ring, hoof dust), fx_sparks_embers (sparks, embers, slash spark, parry flash, finisher burst), fx_rain (streak, 4x4 splash, 8-frame ripple normals, drip), fx_mist, fx_nature (sal/peepal leaves, palash petals, kash seeds, fireflies, dust motes), fx_weapon_trail, fx_lightning (P2).

B3 Images sun_sprite and lens_dirt (ultra only).

B4 banner_cloth: meshes for the 6 BannerShape values at BANNER_DIMENSIONS (src/render/style/factions.ts) with pole, crossbar, tassels; vertex colour = cloth weight (0 at pole, 1 at free edge); UVs for runtime emblem textures (never bake emblems).

B5 LUTs lut_dawn, lut_golden, lut_dusk, lut_night, lut_monsoon, lut_haze, lut_fog (interim from GRADE_PRESETS).

Budget WP7: 4 / 2 / 0.6 MB (ultra/high/mobile). Key art (WP7-19) and UI illustrations (WP7-20) are post-sprint integration items.

Critique loop: Cycles previews (.asset-cache/<id>/preview*.png) -> Read -> fix -> `npm run assets -- --previews <ids>` into docs/screenshots/pipeline/wp7/ -> in-engine viewer shots -> Read -> fix.

**Acceptance**

- [ ] npm run typecheck, npm test, npm run build, npm run build:single (single file <= 8 MB) and SMOKE_PORT=4402 SMOKE_OUT=docs/sprint1/ta-07/smoke npm run smoke pass with no console errors (assetviewer-fallback included).
- [ ] npm run assets -- --selftest passes including new vat/impostor/flipbook cases; npm run assets:check passes; the 5 pre-existing assets still load in the viewer (any hash change justified in the report).
- [ ] tests/assets/publish-lock.test.ts (or an equivalent scripted run logged in docs/sprint1/ta-07/) starts two publish runs of different pipeline_test ids concurrently; both entries end up in tools/assets/published.json and src/assets/manifest.ts.
- [ ] vat_test_dummy: reconstruction error <= 1 mm printed by lib/vat.py; viewer screenshot of 500 instances playing idle/walk/attack with phase offsets and two team tints (docs/sprint1/ta-07/vat_crowd.png); draw calls for the crowd <= 2 per LOD (printed).
- [ ] Impostor A/B at 220 m: mean luminance difference of the object crop < 5% (printed by scripts/shots/ta-07.cjs) with both PNGs saved.
- [ ] Seven sky shots (stupa_sanchi, camera=hero) under sky_dawn/noon/golden/dusk/night/overcast/haze; report table of sun direction and ambientIrradiance per sky; night irradiance within 0.06-0.10.
- [ ] Contact sheets (all frames) for each fx_* flipbook and an in-viewer playback screenshot; fx_smoke lit from two sun directions shows different shading.
- [ ] tests/assets/lut.test.ts: identity LUT reproduces every 8-bit value within 1/255; all 7 lut_* ids published.
- [ ] Skinned test character: two clones play different clips at once (screenshot) and renderer.info.memory returns to baseline after release (printed).
- [ ] ?assets=off and the single-file build: every new loader returns null with no console errors; WP7 totals within 4 / 2 / 0.6 MB (npm run assets -- --list output in the report).

---

### GFX-01 - Lighting & atmosphere: calibrated HDR IBL + time-of-day sky, CSM/PCSS shadows, height fog & god rays, post stack (SSR, TAA/SMAA, DoF, LUT grade, lens), quality tiers

- **Team:** Graphics - **Developer:** Graphics Developer — Lighting, Atmosphere & Post - **Reviewer:** Lead Graphics Engineer (Art Director co-signs the look)
- **Priority:** 3 - **Port:** 4403 - **Depends on:** CORE-01, TA-07 - **Status:** TODO
- **Owned paths:**
  - `src/render/renderer.ts`
  - `src/render/post.ts`
  - `src/render/post/** (new)`
  - `src/render/environment/environment.ts`
  - `src/render/environment/sky.ts`
  - `src/render/environment/atmosphere/** (new)`
  - `src/render/lighting/** (new)`
  - `src/render/materials/pbr.ts, src/render/materials/index.ts, src/render/materials/chunks/** (new)`
  - `src/core/quality.ts (CTO grant), tests/core/quality.test.ts (CTO grant)`
  - `tests/render/lighting/** (new)`
  - `scripts/shots/gfx-01.cjs (new), docs/sprint1/gfx-01/** (new)`
- **Read first:**
  - CLAUDE.md, docs/STUDIO.md
  - docs/ART_BIBLE.md §1.4, §2 (zoom bands), §4 (all of it - lighting, IBL calibration, height fog, night, post), §13, §15, §17 Lead Graphics items 1-4
  - docs/ARCHITECTURE.md §8, §15, §19
  - src/render/style/lighting.ts (resolveLighting, resolveHeroMood, lerpResolved, environmentIntensityFor, fogRadiance, PRACTICAL_LIGHTS), src/render/style/zoom.ts, src/render/style/palette.ts (GRADE_PRESETS)
  - docs/art/tools/lookdev/lookdev.ts (FOG_FRAG reference height fog), docs/art/lookdev_presets.jpg
  - src/render/renderer.ts, src/render/post.ts, src/render/environment/environment.ts, src/render/environment/sky.ts, src/render/materials/pbr.ts, src/core/quality.ts

**Spec**

Own everything about light, atmosphere and the frame. The Art Director measured the current build's IBL at ~8x too bright with the sun counted twice; fixing that is step one and unblocks every visual ticket. Work in this order and commit after each step (each step green).

1. IBL calibration (ART_BIBLE §4.4): sky.ts renders a disc-free Preetham clone for the PMREM (strip the sun-disc term), measures sourceIrradiance with a 16-32 px cube readback once per bake, and the rig sets scene.environmentIntensity = environmentIntensityFor(r, sourceIrradiance) and the same factor for backgroundIntensity. The visible sun is a separate HDR sprite (luminance ~50, WP7 sun_sprite image or procedural) that also feeds bloom and shafts. Below -4 deg solar elevation switch to the night sky (baked sky_night or the gradient fallback #0f1326 -> #1b2236 at irradiance 0.08) + moon sprite. When assets are on prefer the baked skies (sky_dawn/noon/golden/dusk/night/overcast/haze/fog via ctx.assets.loadHdri, manifest ambientIrradiance) chosen by ResolvedLighting.dominant with a 2 s PMREM cross-fade.

2. Environment rig (environment.ts): replace the hand-written sun/hemi/fog/exposure/grade code with resolveLighting() exactly as ART_BIBLE §4.2 shows; hemi x0.35 when IBL is on; wetness -> MATERIAL_GLOBALS.wetness. Public API used by scenes and other tickets: setEnvironment(env), setResolved(r) and setMoodBlend([{mood, weight}]) for hero districts (resolveHeroMood + lerpResolved, 40 m cross-fade is the caller's), triggerLightning() (ART_BIBLE §4.6: #d8e2ff intensity 9 for 80-160 ms double flash, sky +2 EV; called by GFX-02 weather), practical lights manager addPractical(kind, position) -> handle (PRACTICAL_LIGHTS; nearest N per tier as PointLights = QualitySettings.practicalLights, the rest emissive sprites; 12-35% flicker at 6-12 Hz; weighted by r.practicals), sunDirection(), update(dt, camera, look).

3. Shadows (src/render/lighting/): CSM with 1/2/3/4 cascades by tier (ART_BIBLE §13), PCSS-style kernel scaled by r.sunSoftnessDeg, texel snapping, shadow distance / split lambda / softness from ZoomLook, screen-space contact shadows on ultra. Instanced crowds and vegetation supply customDepthMaterial (GFX-04/GFX-03) - document the contract.

4. Height fog (ART_BIBLE §4.5): lift FOG_FRAG into a global fog chunk applied to every MeshStandard/Physical material plus an exported injectHeightFog(shader) for custom ShaderMaterials (water, grass, crowds, particles use it); mist slab with 2-octave world noise (40 m and 9 m, amplitude 0.5) scrolling with the wind at 0.3x; sky-dome fog (d = 20 km, clamp 0.6) so terrain melts into the sky; density x ZoomLook.atmosphere.fogDensityScale; low tier keeps FogExp2 x0.6. Volumetric shafts: screen-space radial blur of a sun occlusion mask (QualitySettings.shaftsSamples 24/32/48, half res), active when the sun is below 35 deg or shaftsStrength > 0.3, x ZoomLook.atmosphere.shaftsScale.

5. Post stack in the ART_BIBLE §4.7 order: HDR render -> GTAO (radius from ZoomLook) -> SSR on ultra (masked to water and wet surfaces via a material flag/roughness threshold; GFX-02 marks water and puddles) -> height fog + shafts -> bloom (threshold = r.bloomThreshold / r.exposure; lens dirt on ultra) -> DoF (gather bokeh; focus distance / f-stop / max blur from ZoomLook or explicit post.setFocus(distance, fStop, maxPx) for hero and cinematics) -> tone map ACES (AgX toggle for lookdev) + grade (r.grade) + LUT (ctx.assets.loadLut, 35% strength high/ultra) + vignette + grain + chromatic aberration (close/hero bands only) -> TAA in hero mode and cutscenes (jittered projection, neighbourhood clamp, off when crowds dominate the frame) | SMAA | FXAA. Low tier = one merged pass (grade + vignette + FXAA). API: post.applyZoomLook(look) (AO, bloom, DoF, vignette/sat/contrast, sharpen, grain, CA), post.setFocus(...), post.setTaa(on).

6. Materials (pbr.ts, materials/chunks/): clearcoat for Mauryan polish, sheen for cloth, foliage translucency (ORM.b), wetness darkening + roughness drop + height-masked puddle hook shared with splat.ts, detail-normal/parallax fade driven by ZoomLook weights (a wall and the ground sharpen together, ART_BIBLE §2.3), dithered LOD cross-fade chunk (lodFade uniform/instance attribute) usable by THREE.LOD (TA-07 AssetManager), instanced vegetation and crowds.

7. Renderer: HDR HalfFloat chain, dynamic-resolution controller per QualitySettings (min/max scale, target fps), stats -> profiler (draw calls incl. shadow passes), capture(), context loss; runtime tier switches rebuild passes without leaks.

8. Quality tiers (src/core/quality.ts): every knob of ART_BIBLE §13 and the CORE-01 additions tuned per tier; detection heuristics unchanged; tests updated.

Budgets (ARCHITECTURE §15): total frame incl. shadows battle 1,000 soldiers high < 400 draw calls, 5,000 < 500, mobile low < 150; pass counts per tier listed in the report; zero per-frame allocations in rig/post update; everything disposed in dispose(). Keep the AssetViewerScene working (it imports post). Compatibility rule (STUDIO.md W15): today's scenes (WorldScene, BattleScene, HeroScene, MenuScene, AssetViewerScene) are owned by other tickets - keep every public class/method they call source-compatible so your improvements show up in them without edits; add new capabilities as new methods/options, and demonstrate what the scenes do not drive yet in your own lab modules (?scene=lab&lab=<id>, *.lab.ts files inside your owned directories, W6).

**Acceptance**

- [ ] npm run typecheck, npm test, npm run build, npm run build:single and SMOKE_PORT=4403 SMOKE_OUT=docs/sprint1/gfx-01/smoke npm run smoke pass with no console errors; every smoke PNG reviewed.
- [ ] scripts/shots/gfx-01.cjs renders the battle (preset=plains, tactical camera) and hero (Rajapura) scenes under the 8 presets (dawn 6.2h, noon 12.5h, golden 17.4h, dusk 18.9h, night 22h, monsoon weather, dry haze, winter fog) at ultra plus noon/golden/night at low: >= 22 PNGs in docs/sprint1/gfx-01/; the reviewer compares them with docs/art/lookdev_presets.jpg and the Art Director's sign-off is recorded in the report; the grey-white wash of docs/screenshots/battle.png and hero.png is gone.
- [ ] tests/render/lighting/ibl.test.ts: environmentIntensity for sky_day (source 0.58) at the noon preset reaches the 0.75 target within 2%; the PMREM sky shader contains no sun-disc term; bloom threshold mapping and PCSS radius-from-softness helpers unit-tested.
- [ ] Night tactical battle shot: mean luminance of the lower half >= 12% (computed with sharp by the shots script and printed) - ART_BIBLE §4.6.
- [ ] Operational-zoom battle shot shows no hard terrain/sky seam (reviewer); tests/render/lighting/fog.test.ts asserts the rig applies the sky-dome fog (d = 20 km, clamp 0.6) and the mist slab parameters from ResolvedLighting.
- [ ] ?csm=1 colours cascades (screenshot); cascade counts per tier 1/2/3/4; contact shadows only on ultra.
- [ ] Lab ?scene=lab&lab=post-hero (src/render/post/*.lab.ts) shows a hero-distance pair with TAA on/off and DoF focused on the subject; battle with SMAA; low tier post = single merged pass (pass list per tier in the report).
- [ ] Draw calls from __SAMRAJYA__.getProfile(): battle 1,000 @high < 400 incl. shadows, battle-river-5000 @high < 500, battle-mobile @low < 150 (before/after table in the report).
- [ ] Tier cycling low->ultra->low three times leaves renderer.info.memory textures/geometries and render-target counts unchanged (script output).

---

### TA-01 - WP1 PBR materials & terrain library

- **Team:** Technical Art - **Developer:** Technical Artist A — Materials & Terrain Library - **Reviewer:** Technical Art Director (Art Director co-signs)
- **Priority:** 4 - **Port:** 4404 - **Depends on:** TA-07 - **Status:** TODO
- **Owned paths:**
  - `tools/blender/assets/materials/** (incl. existing sandstone_carved_red.py, ground_dry_earth.py)`
  - `tools/blender/assets/terrain/** (new)`
  - `tools/blender/assets/decals/** (new)`
  - `public/assets/textures/<id>/** for the asset ids whose scripts live in the directories above`
  - `docs/screenshots/pipeline/wp1/** (new)`
  - `scripts/shots/ta-01.cjs (new), docs/sprint1/ta-01/** (new)`
- **Read first:**
  - CLAUDE.md, docs/STUDIO.md (W3 publishing, W4 ids, W14 critique loop)
  - docs/ASSET_LIST.md §0 and WP1
  - docs/ART_BIBLE.md §3 (colour/value limits), §5 (terrain, BIOME_TERRAIN, blending), §8.2 (material library), §14 (recipes), §16
  - src/render/style/materials.ts (MATERIAL_PRESETS), src/render/style/terrain.ts (TERRAIN_LAYERS, FARMLAND, ROAD_STYLES, RIVERBANK), src/render/style/palette.ts (ALBEDO_LIMITS)
  - docs/ARCHITECTURE.md §18; tools/blender/lib/{texgen,ornament,stone,nodes,materials,bake}.py; tools/blender/assets/materials/sandstone_carved_red.py (reference quality bar)

**Spec**

Deliver every P0 and P1 texture set of ASSET_LIST WP1 (WP1-01..WP1-37; P2 ids WP1-16..19 and WP1-38 if the budget allows, tagged @tiers ultra,high with an @fallback so mobile skips them) as deterministic Blender/numpy scripts baked to PBR sets (baseColor sRGB, normal 16-bit OpenGL +Y near-lossless, ORM = AO/roughness/metalness, height kept in cache for the splat height blend).

Priorities: (1) P0 architecture sets sandstone_buff (H, same trim-band layout as sandstone_carved_red so stupa_sanchi re-skins by changing samrajya_set), lime_plaster_weathered (H), brick_fired_old, roof_tile_terracotta, thatch_grass, mud_plaster, bamboo_lattice, timber_teak_carved (trim sheet); (2) P0 terrain layers terrain_grass_lush, terrain_grass_dry, terrain_alluvial_silt, terrain_farmland_tilled, terrain_road_earth, terrain_river_sand, terrain_rock_sandstone (triplanar), terrain_flagstone, terrain_mud_wet (puddle mask in alpha); (3) WP1-09 retune of sandstone_carved_red (-12% saturation, per-block hue jitter, lichen/soot in macro) and its downgrade to class S; (4) P1 sets WP1-10..15 and terrain WP1-31..37; (5) decals_settlement atlas (cracks, damp, soot, charring, mandana borders, kolam, rut end-caps, puddle masks, footprints) with decal regions in the manifest.

Rules (ASSET_LIST §0, ART_BIBLE §14): recipes are layer stacks of seamless noise + ornament motifs + weathering; every set hits its MATERIAL_PRESETS / TERRAIN_LAYERS baseColor within +-6% average and spans its roughness range; albedo within ALBEDO_LIMITS; three detail scales visible at 1-3 m (macro, meso, micro); tiling invisible at 3x3 repeats under raking golden light; height channel suitable for height-blend (cavities dark, stones bright); terrain layers are macro-neutral (variation comes from the splat macro map); no anachronisms. Class sizes per ASSET_LIST §0.2 (H, S, C, T, A). Put shared generators in package-local helpers (tools/blender/assets/materials/_*.py) - tools/blender/lib is CTO/TA-07 territory (send requests).

Critique loop (mandatory, STUDIO.md W14): Cycles preview -> Read -> fix -> publish under the lock -> viewer at 1 m and 10 m under sky_day and sky_golden (`?scene=assetviewer&asset=<id>&camera=detail|close`) and terrain layers on the 4-layer splat lookdev (`?splat=a,b,c,d`, from TA-07) -> Read -> fix. Produce a 256 px swatch per set and a palette board for the Art Director.

Budget WP1: 36 / 16 / 5.3 MB (ultra/high/mobile); measure as you go (npm run assets -- --list).

Consumers: GFX-02 (terrain splat), TA-02/TA-03 (architecture via samrajya_set), GFX-06 (decals). Asset ids are the contract - use exactly the ASSET_LIST ids.

**Acceptance**

- [ ] All P0 and P1 WP1 ids published via `flock .asset-cache/.publish.lock npm run assets -- <ids>`; npm run assets:check passes; WP1 total <= 36 / 16 / 5.3 MB (table in the report).
- [ ] scripts/shots/ta-01.cjs computes each set's mean baseColor from the published WebP (sharp) and prints the delta to its MATERIAL_PRESETS / TERRAIN_LAYERS target: every set within +-6%.
- [ ] docs/sprint1/ta-01/: 3x3 tiling shots under raking golden light for every P0 set, viewer shots at 1 m and 10 m under sky_day and sky_golden (contact sheets), a 4-layer splat lookdev shot per biome recipe in BIOME_TERRAIN, and the 256 px swatch board; the reviewer reads all of them.
- [ ] stupa_sanchi still renders (no regression); a viewer shot with samrajya_set switched to sandstone_buff proves the trim layout matches.
- [ ] Cycles previews copied to docs/screenshots/pipeline/wp1/; Art Director co-sign noted in the report.
- [ ] npm run typecheck, npm test, npm run build and SMOKE_PORT=4404 SMOKE_OUT=docs/sprint1/ta-01/smoke npm run smoke pass with no console errors.

---

### SIM-01 - Strategic world simulation: economy, AoE settlement rules (placement, construction, ages, landmarks, market), armies & supply, sieges, politics, diplomacy, espionage, dynasty, events, autoresolve

- **Team:** AI & Simulation - **Developer:** Simulation Engineer — Strategic World Simulation - **Reviewer:** Lead AI & Simulation Engineer (Creative Director co-reviews rules and balance)
- **Priority:** 5 - **Port:** 4405 - **Depends on:** CORE-01 - **Status:** TODO
- **Owned paths:**
  - `src/sim/strategic/** except src/sim/strategic/ai.ts and src/sim/strategic/ai/**`
  - `tests/sim/strategic/** (new)`
  - `scripts/sim/** (new, headless node report scripts)`
  - `docs/sprint1/sim-01/** (new)`
- **Read first:**
  - CLAUDE.md (simulation purity rules), docs/STUDIO.md
  - docs/DESIGN_SPEC.md §0, §2.3, §3.4-§3.5, §4.5, §5.3, §5.7-§5.8, §6.12, §6.14, §7 (all), §8.1-§8.6, §8.9, §9.3-§9.6, §10.2-§10.3, §11.9, §13.2, §13.4, §14.3 (Lead AI & Simulation items 1-9), §14.4
  - docs/ARCHITECTURE.md §3-§7 and the 'Contracts v2' section added by CORE-01
  - src/core/types.ts, src/data/{rules,balance,buildings,ages,units,factions,region,campaign,events,difficulty,statistics,resources}.ts
  - src/sim/strategic/*.ts, tests/integration/determinism.test.ts, tests/core/purity.test.ts

**Spec**

Implement DESIGN_SPEC §7 and the simulation side of §8 on the CORE-01 v2 state, deterministically (purity rules, sortedKeys, world RNG, d* math). Work in phases, one green commit each:

A Economy (§7.2-§7.5): settlement variable update rules, storage capacity in DAYS (fixes the baseline bug that starves Rajapura by day ~90), harvest pulses (trickle 40% / kharif 35% / rabi 25%, crop health), monsoon roll on month 4 day 1 with monsoon_failed/monsoon_flood flags and flood level, consumption/spoilage, internal grain market, grain tax, relief draws (hold-the-reserve policy), rationing, price formula and its effects, tax and trade formulas, tax policies, materials (timber/stone production), the AoE market (lots of 100, +-3% per lot, 70% sell-back, recovery 1%/day), ledger projection, debt. Remove the 0.1 army-upkeep factor once rebalanced (§14.3 item 1b).

B AoE settlement layer (§7.6, §8.1-§8.6): pure placement module src/sim/strategic/placement.ts (4 m grid r + 60 m; inner/outer/perimeter/shore/road/resource classes; blocked cells; 90-degree rotation; validatePlacement(world, settlementId, building, cell, rot) -> {ok, reason}; autoPlace(...) used by createWorld for starting buildings and by the AI); construction (costs incl. timber/stone paid at queue with 'Need 120 timber' reasons, level cost x1.6 / time x1.3, crew ratio, 3 parallel jobs, queue max 5, monsoon factor, 90% refunds, age/level caps, requirements); recruitment (age, retired classes, elephant source, horses discount, pool, variants applied at creation, experience bonuses, supply-train loading, rally point output); ages and landmarks (requirements checklist selector, exclusivity, cannot cancel after 50%, age switch + bonuses, landmark settlement/realm/faction effects lost while not owned); walls & gates levels (fortLevel, wallHp, repair); selector villagerAllocation(settlement, cap) implementing §8.3 counts for the renderer.

C Armies, supply, sieges (§7.7-§7.8, §3.4): road A* with the edge-cost formula and off-road legs (forest/hills/water factors, fords closed while flood > 0.5, bridge condition < 0.3 blocks carts/elephants/chariots), pace by slowest category, forced march, stances incl. evade, visibility + ghost markers + intel tiers, split/merge/disband, resupply order, depots, foraging/plunder, starvation desertion, attrition, requisition memory, siege damage, assault availability, starve-out, capture with occupy/plunder/liberate, besieged effects.

D Politics (§7.9): loyalty target, unrest terms, rebellion ladder with hysteresis and stage multipliers, rebel armies (REBEL_FACTION_ID, pop x 0.03 spears:archers 2:1), secession, negotiate_rebels options, governors (interests, demands, secession), stability and legitimacy drift.

E Diplomacy, espionage, dynasty, council (§7.10-§7.12): sign_treaty peace ends the war, tributary direction (a overlord, b payer), treaty effects and breaking costs, truce, opinion and grievances, acceptance utility with the three largest terms as reason lines, war score and weariness, marriages; espionage missions, risk, intel decay; aging, births, succession laws, regency, crisis; council recommendations and competing advice.

F Events, scenarios, results (§7.13, §9, §10.2-§10.3, §6.12, §6.14, §8.9, §11.9): honour ScenarioOutcomeDef.immediate, implement spawn_army and damage_road, scale negative effects by DIFFICULTY_DEFS eventSeverity, battle write-back items 1-8 (casualty merge, morale, retreat, captured supply, prisoners, commander fate, experience, war score, chronicle line with place names, siege capture), autoresolve stance -> AI aggression (0.75/0.5/0.3) and the retreat rule, prediction factor lines, WorldState.statistics counters for END_GAME_STATS + score (RULES.score), sandbox victory progress, and the hero API applyHeroMissionResult(world, factionId, result, out) / applyDialogueEffects used by GP-02/GP-03 (effects applied once, recorded as flags).

G Commands and selectors: implement every StrategicCommand kind (the 29 existing + CORE-01 additions) with validation reasons; export pure read-only selectors the UI needs (settlement vitals with reserve-day colours, ledger, age checklist, landmark availability, market quotes, victory progress, intel-tier views). Campaign AI lives in ai.ts (SIM-02) - keep its entry point and the call order in tickWorld; expose the helpers it needs.

Balance: DESIGN_SPEC §13.2 targets must hold with the real sim. Data files (src/data/**) belong to the Creative Director - send exact numeric change requests, do not edit them.

Perf (ARCHITECTURE §15): tickWorld < 0.2 ms per hour-step average and < 2 ms worst-case day rollover for 16 settlements / 10 armies in node; no per-hour allocations besides event pushes.

**Acceptance**

- [ ] npm run typecheck and npm test green, including tests/core/purity.test.ts and tests/integration/determinism.test.ts (same seed + commands => same hash; save -> load -> continue == uninterrupted, extended by tests/sim/strategic/determinism-v2.test.ts mid-siege, mid-construction, with rebels).
- [ ] tests/sim/strategic/economy.test.ts: price 30 reserve days -> ~1.7, empty store -> 3.4; capacity in days; spoilage; harvest pulse shares; monsoon roll and flags; market lot pricing and recovery.
- [ ] tests/sim/strategic/calibration.test.ts: DESIGN_SPEC §13.2 bands measured with the actual sim (normal monsoon and M = 0.7) and Suvarna month-1 net between +400 and +700 wealth.
- [ ] tests/sim/strategic/construction.test.ts: Granary L1 at Dhanyagram completes in 20 +-1 days; Palace at Rajapura ~144 days; 90% refunds; 3 parallel jobs; every placement class incl. shore/resource/road accepts and rejects with the documented reason strings; starting buildings receive cells.
- [ ] tests/sim/strategic/armies.test.ts: Rajapura->Setupur ~1 day; Rajapura->Giridurg ~3.4 days by road and ~6.8 across country; fords closed in flood; Royal Host eats ~195 grain/day and carries ~23 days.
- [ ] tests/sim/strategic/siege.test.ts: Giridurg wallHp 4,200 falls in ~52 days to one engineer formation; starve-out chance curve; occupy/plunder/liberate effects.
- [ ] tests/sim/strategic/politics.test.ts: a scripted careless run of the GDD §6 chain reaches revolt and spawns a rebel army of pop x 0.03; a careful run keeps settlements calm for 12 months.
- [ ] tests/sim/strategic/diplomacy.test.ts: peace ends war; tributary direction; acceptance reasons list the 3 largest terms.
- [ ] tests/sim/strategic/campaign.test.ts: broken_crown with all events auto-resolved ends 'mixed' (never defeat) on 6/6 seeds; seven_hills and every sandbox preset run 540 days without exceptions; each command kind accepted/rejected as specified.
- [ ] tests/sim/strategic/perf.test.ts: average hour-step < 0.2 ms and worst day rollover < 2 ms (numbers in the report).
- [ ] scripts/sim/campaign-report.mjs writes a 540-day report (monthly ledger, reserve days, unrest per settlement, battles, events) to docs/sprint1/sim-01/; numeric data-change requests for the Creative Director listed in the report.
- [ ] npm run build and SMOKE_PORT=4405 SMOKE_OUT=docs/sprint1/sim-01/smoke npm run smoke pass (world shots) with no console errors.

---

### TA-05 - WP5 crowd units, standard bearers, villagers, animals & vehicles (rigged, animated, VAT-baked)

- **Team:** Technical Art - **Developer:** Technical Artist E — Crowds, Animals & Vehicles (VAT) - **Reviewer:** Technical Art Director (Art Director co-signs; Lead Graphics co-reviews runtime fit)
- **Priority:** 6 - **Port:** 4406 - **Depends on:** TA-07, TA-01 - **Status:** TODO
- **Owned paths:**
  - `tools/blender/assets/crowd/** (new)`
  - `tools/blender/assets/animals/** (new)`
  - `tools/blender/assets/vehicles/** (new)`
  - `public/assets/** files generated for the asset ids whose scripts live in the directories above`
  - `docs/screenshots/pipeline/wp5/** (new)`
  - `scripts/shots/ta-05.cjs (new), docs/sprint1/ta-05/** (new)`
- **Read first:**
  - CLAUDE.md, docs/STUDIO.md (W3, W4, W14)
  - docs/ASSET_LIST.md §0 and WP5 (all tables, crowd clip list, acceptance)
  - docs/ART_BIBLE.md §3.4 (team colour), §9 (proportions, silhouettes §9.2, faction schemes §9.3, costume §9.4, animation style §9.6, readability §9.7), §1.5 (no stirrups, no anachronisms)
  - docs/DESIGN_SPEC.md §5.1, §5.6, §8.3
  - docs/ARCHITECTURE.md §20 and docs/adr/0003-crowd-impostor-fx-assets.md (from TA-07)
  - tools/blender/lib/{rig,anim,lod,export,vat,impostor}.py, src/render/style/{factions,palette}.ts (DYES, SKIN_TONES, FACTION_ART)

**Spec**

Build the crowd cast of the game as VAT assets (TA-07 'vat' kind) so thousands of formation soldiers and villagers animate with real skeletal motion at InstancedMesh cost (ARCHITECTURE §20).

1. Shared humanoid crowd base: one body on rig.humanoid() standard bone names (the same skeleton TA-06 uses for heroes), proportions per ART_BIBLE §9.1, LOD0 600-800 tris, LOD1 150-250 (lod.decimate then VAT re-bake), compact texture atlas per class family (A class; natural-dye cloth, skin, leather, bronze/iron) - crowds do not use the 2048 hero sets. Vertex colours: R team mask (25-35% of the visible surface), G cloth-variation seed, B part id. Faction differences = tint masks + a few swappable signature pieces (headgear, shield shape) baked as variants sharing the clip table, P0 for the two playable factions (Suvarna, Giridurga), others P2.

2. Unit classes WP5-01..WP5-10 (spearmen, archers, elite guards, cavalry rider + horse, chariot crew + car + 2 horses, war elephant + caparison + railed platform + mahout + 2 archers, engineers, scouts, supply train ox cart + 2 oxen + drover, standard bearer + drummer + conch blower) with the silhouettes of ART_BIBLE §9.2 readable at 200 m in greyscale. Mounted/beast units are baked as combined VATs (beast + crew in one mesh) with sockets for banners.

3. Clips (standard names, 30 fps source baked at 15): idle, walk, run, attack (3 variants thrust/slash/shield bash), shoot (draw-brace-release), reload, hit, die (2 variants), dead, brace, charge, rout, cheer, work; riders idle/walk/trot/canter/gallop/attack/shoot/die; elephant idle/walk/amble/trumpet/charge/panic/attack/die; horse idle/walk/trot/canter/gallop/rear/die; ox idle/walk/pull. Locomotion clips carry strideMeters/speed so the runtime can kill foot sliding.

4. Villagers WP5-11..WP5-16 (farmer, builder, carrier, crafter, townsfolk, drill militia) with the custom x_ clips of the ASSET_LIST table (x_farm_hoe, x_sow_broadcast, x_harvest_sickle, x_bundle_sheaf, x_carry_headload, x_carry_yoke, x_thresh, x_build_hammer, x_build_carry, x_climb, x_mix_mortar, x_lay_brick, idle sit, x_draw_water, x_potter_wheel, x_smith_hammer, x_weave, talk, x_bow, x_protest, x_queue, x_drill_thrust); m/f and garment variants via masks.

5. Animals and vehicles: horse (5 coats, no stirrups), elephant (tusked/tuskless, war caparison + bells + platform, work harness), zebu ox, cattle cow (P1), camel and goats/dogs (P2); chariot (16-spoke wheels, lac-red paint, bronze, P1), ox cart (canopy, sacks; supply + civilian variants), farm cart (P1), palanquin (P2).

6. Impostor sheets for every class (8 directions x key frames of walk/idle/attack/die, 128 px) via lib/impostor.py.

Budgets: WP5 total 8 / 5 / 2 MB; per class VAT <= 1.2 MB ultra; triangles per ASSET_LIST §0.3 (soldier 600-800 / 150-250; horse/ox 900-1,200 / 300; elephant 1,500-2,200 / 500). Historical check ART_BIBLE §1.5 in each script docstring.

Critique loop: Cycles turntable + greyscale line-up previews -> Read -> fix; viewer crowds (`?asset=<id>&clip=walk&count=500`) -> Read -> fix. Package-local helpers go in tools/blender/assets/crowd/_*.py. Coordinate the shared humanoid conventions with TA-06 (document them in your script docstrings).

**Acceptance**

- [ ] All P0 and P1 WP5 ids published under the publish lock; npm run assets:check passes; WP5 <= 8 / 5 / 2 MB and every per-class VAT <= 1.2 MB ultra (table in the report).
- [ ] lib/vat.py reconstruction error <= 1 mm for every baked class and LOD (log excerpt in the report).
- [ ] docs/sprint1/ta-05/lineup_200m_grey.png: all 9 classes side by side at 200 m in greyscale - the reviewer can name each one; plus the same in faction colour for Suvarna and Giridurga.
- [ ] Team-mask coverage per class measured by scripts/shots/ta-05.cjs (fraction of team-masked pixels in a front render) within 25-35%.
- [ ] Viewer screenshots: 500 spearmen playing walk/attack/die with phase offsets; cavalry gallop; elephant charge and panic; villagers farming, building and carrying; ox cart pulling - no foot sliding visible at matched speed (stride metadata present in the manifest).
- [ ] Impostor vs LOD1 at 150 m: colour difference < 5% (printed).
- [ ] Cycles previews in docs/screenshots/pipeline/wp5/; Art Director co-sign in the report; npm run typecheck, npm test, npm run build and SMOKE_PORT=4406 SMOKE_OUT=docs/sprint1/ta-05/smoke npm run smoke pass.

---

### GP-01 - Tactical battle simulation: formations, orders, combat, morale, sieges, pathing, outcomes, soldier layer

- **Team:** Gameplay - **Developer:** Gameplay Engineer — Tactical Battle Simulation - **Reviewer:** Lead Gameplay Engineer (Creative Director co-reviews rules)
- **Priority:** 7 - **Port:** 4407 - **Depends on:** CORE-01 - **Status:** TODO
- **Owned paths:**
  - `src/sim/tactical/** except src/sim/tactical/battleai.ts and src/sim/tactical/ai/**`
  - `tests/sim/tactical/** (new)`
  - `docs/sprint1/gp-01/** (new)`
- **Read first:**
  - CLAUDE.md (purity, three-level simulation), docs/STUDIO.md
  - docs/DESIGN_SPEC.md §5 (units, stats, terrain table, counters, variants), §6 (all battlefield rules), §13.1, §13.3, §14.3 Lead Gameplay item 1
  - docs/ARCHITECTURE.md §4-§6, §15 and the 'Contracts v2' section
  - src/core/types.ts (BattleState, FormationState, BattleCommand, SoldierBuffers), src/data/{units,rules,balance,skirmish}.ts
  - src/sim/tactical/*.ts, tests/integration/determinism.test.ts

**Spec**

Make the formation level authoritative for everything in DESIGN_SPEC §6, at 20 Hz, deterministic, headless-capable (autoresolve runs the same code), and make the soldier layer show it faithfully.

1. Setup (§6.1): battle kinds field / river_crossing / siege / ambush with the stated triggers; deploy zones; deployment phase (BattleState.phase, 60 s world / 30 s skirmish; deploy, set_shape, set_stance only inside the zone; begin_battle ends it early); time limits and draw rule; commander placement; variants applied to UnitStats at formation creation (§5.7).

2. Formations and orders (§6.2-§6.5): shape modifiers and shape-change time (3 s + 0.02 s x soldiers, cohesion capped 0.6), files/ranks/frontage, every FormationOrder (hold, advance, move_to with right-drag frontage/facing, attack_target, charge with run-in thresholds and preconditions, flank, withdraw with the disengage penalty, regroup, defend radius, skirmish, construct, resupply) and shift-queues, stances, movement speed formula incl. terrain, fatigue, shape and mud, turning cohesion loss, no interpenetration except routers and trampling beasts.

3. Pathing: flow-field / Dijkstra on a coarse battle grid (8 m cells) honouring deep water (impassable except fords, shallows, engineer bridges), walls and breaches; cached per destination; deterministic; < 2 ms per new order in node.

4. Combat (§6.6): melee per tick exactly as specified (frontage, ATK/DEF, height, aspect, rout x3, side effects), charge impact with bracing and recoil, missiles (range_eff, flight time with leading, hits formula, bonusVs, armour, shape, forest cover, rain, night, friendly fire share unless hold_fire, ammo and 'No arrows', wet reload), elephant panic and trample, siege works (wall ring of 12 segments, gates by settlement kind, towers, engineer works palisade/ditch/bridge/ram/ladder/repair_gate, elephants vs gates, defenders on walls, breach, siege victory after holding a breach 60 s).

5. Morale (§6.7): the full target formula with all seven inputs incl. the T (tactical position) and P (perceived risk) terms, every MoraleEventKind with magnitude/decay, thresholds wavering 40 / rout 30 / rally 50 / surrender 8, moraleBreakdown dominant factor for the UI.

6. Rout, rally (max 2), surrender, capture, pursuit losses, prisoners, side broken (§6.8); fatigue and cohesion tiers with prolongedEngagement after 4 minutes (§6.9); terrain, weather, heat, night (§6.10); leadership, commander fall and fate, the rally BattleCommand with 120 m radius and 90 s cooldown, experience (§6.11); BattleOutcome with every field CORE-01 added (§6.12 - the strategic write-back itself is SIM-01).

7. AI seam: AI acts only through runBattleAI / translateIntent in battleai.ts (SIM-02). Keep calling runBattleAI during deployment too (it may return deploy/set_shape/set_stance commands); keep the current line-order auto-deploy as the initial placement; keep the intent hook every 20 ticks.

8. Soldier layer (soldiers.ts, SoldierSim): realise casualties (front ranks in melee, random under arrows), drive the CORE-01 SoldierBuffers fields (anim variant for attack/die variants, anim start time, role flags for standard bearers, drummers, commander, riders), brace when braced, charge/run, rout with dropped standards, cheer on victory, work for engineers, shoot/reload synced to volleys, separation, LOD scheduling 20/10/5 Hz by distance to camera focus.

Perf (ARCHITECTURE §15): formation sim < 0.3 ms/step at 1,000 soldiers and < 0.8 ms at 5,000; soldier layer < 1.0 / 3.0 ms; zero allocations in step loops.

**Acceptance**

- [ ] npm run typecheck and npm test green incl. purity and determinism; tests/sim/tactical/determinism.test.ts: battle resumed from serialized state (during deployment, mid-melee, mid-siege) equals the uninterrupted run.
- [ ] tests/sim/tactical/worked-examples.test.ts reproduces DESIGN_SPEC numbers within 10%: spear vs spear ~4.7 HP/s each way; 8 elephants into unbraced spears ~378 HP (~38 men), braced ~13 men with ~189 HP recoil; 60 horsemen into archers ~126 HP; 100-archer volley into spears ~32 HP; elephant panic ~8.6% per volley; the GDD morale example target ~25.
- [ ] tests/sim/tactical/orders.test.ts covers every FormationOrder, shift-queue, shape change timing, deployment-zone clamping, rally cooldown/radius, surrender and pursuit formulas.
- [ ] tests/sim/tactical/siege.test.ts: breach a gate with a ram, escalade penalty with ladders, defenders on walls bonuses, siege victory after 60 s holding a breach.
- [ ] tests/sim/tactical/pathing.test.ts: a formation ordered across the river routes through the nearest ford/bridge; no route through deep water; new-order cost < 2 ms.
- [ ] tests/sim/tactical/perf.test.ts: formation step < 0.3 ms (1,000) and < 0.8 ms (5,000); soldier layer < 1.0 / 3.0 ms in node (numbers in the report).
- [ ] A headless 1,000-soldier balanced skirmish at default settings ends in 3-8 minutes of battle time on >= 8 of 10 seeds (DESIGN_SPEC §13.1; printed).
- [ ] npm run build and SMOKE_PORT=4407 SMOKE_OUT=docs/sprint1/gp-01/smoke npm run smoke pass (battle shots) with no console errors.

---

### TA-02 - WP2 vernacular & civic architecture kit, construction & damage kits, props and river boats

- **Team:** Technical Art - **Developer:** Technical Artist B — Vernacular & Civic Architecture Kit - **Reviewer:** Technical Art Director (Art Director co-signs)
- **Priority:** 8 - **Port:** 4408 - **Depends on:** TA-07, TA-01 - **Status:** TODO
- **Owned paths:**
  - `tools/blender/assets/architecture/** (exists, empty)`
  - `tools/blender/assets/props/** (new)`
  - `tools/blender/assets/boats/** (new)`
  - `public/assets/** files generated for the asset ids whose scripts live in the directories above`
  - `docs/screenshots/pipeline/wp2/** (new)`
  - `scripts/shots/ta-02.cjs (new), docs/sprint1/ta-02/** (new)`
- **Read first:**
  - CLAUDE.md, docs/STUDIO.md (W3, W4, W14)
  - docs/ASSET_LIST.md §0 and WP2 (+ the 'Age visual upgrades' paragraph under WP3)
  - docs/ART_BIBLE.md §1.4-§1.5, §8.1 (grammar), §8.2-§8.5 (materials, styles, kit dimensions, construction stages/upgrades/damage), §8.8
  - docs/DESIGN_SPEC.md §8.2 (grid, placement, construction stages), §8.3
  - src/render/style/{factions,materials}.ts (ARCHITECTURE_STYLES, MATERIAL_PRESETS), src/data/buildings.ts (footprints)
  - tools/blender/lib/{mesh,trim,lod,export}.py, tools/blender/assets/models/stupa_sanchi.py (reference)

**Spec**

Model, by script, the everyday architecture of the realm as instanceable GLB kits that read like Age of Empires IV at 700 m and hold up like Black Myth: Wukong at 2 m: WP2-01..WP2-24 (huts, mud and brick courtyard houses, mansion, granary J/M/S, market stalls with goods dressings, well + shaduf, village tank, workshops potter/smith/weaver, barracks J/M/S, stable, elephant stable, village shrine, assembly hall J/M, road station (P2), watchtower J/M, field kit, construction kit, damage kit, household / market-craft / military props, village palisade, river boats incl. the royal barge P0 for the opening cinematic).

Rules: dimensions and triangle budgets per the WP2 table (LOD0/LOD1/LOD2) and ASSET_LIST §0.3; footprints multiples of 4 m aligned to the settlement grid (DESIGN_SPEC §8.2); doors face +Z (south); textures only through shared WP1 sets via samrajya_set (+ a per-model macro map on uv1 for AO, grime, rising damp, rain streaks); variants share textures; architecture styles via material sets (heartland_brick and highland_stone P0; forest_timber, frontier_mud, coastal_timber, city_sandstone P2); age variants J/M/S as manifest 'variants' (AoE IV age upgrades: hut -> brick courtyard -> two-storey; granary timber bins -> brick vault -> stone podium; barracks thatch hall -> brick hall + yard -> stone gate + colonnade; market stalls -> canopied ring -> paved square).

Construction support (ASSET_LIST WP2 note, DESIGN_SPEC §8.2): every building exports (a) its finished LODs, (b) a footprint mesh for the foundation stage, (c) a scaffold layout (bamboo scaffold module transforms) and (d) per-material course heights for the course-reveal shader - through the TA-07 model 'construction' metadata. The construction kit (WP2-18) provides stakes + string lines, trench decal, brick stacks, log piles, stone blocks, sand heap, scaffold modules (1.5 m bays; 3/6/9 m; corner/straight/end), ladders, ramps, coir coils, mortar tubs and the 1.5x landmark scaffold with banner socket. The damage kit (WP2-19) provides roof-hole and 40-60% collapse variants of WP2-01..05 and barracks, rubble piles (3 sizes), smouldering beams.

Historical care: ART_BIBLE §1.5 (no Mughal/pointed arches, period-plausible forms) noted in each docstring. Budget WP2: 5 / 3.5 / 2 MB. Priority order: P0 pieces of the vertical slice first (Rajapura capital and villages: WP2-01..03, 05..07, 10, 13, 16..18, 20, 22..24), then P1.

Critique loop: Cycles previews -> Read -> fix; viewer hero/close/overview shots under sky_day and sky_golden; a 40-piece village via `?scene=assetviewer&kit=...` (TA-07) for draw calls; a greyscale silhouette line-up at 700 m.

**Acceptance**

- [ ] All P0 and P1 WP2 ids published under the publish lock; npm run assets:check passes; WP2 <= 5 / 3.5 / 2 MB; triangle counts per LOD within the WP2 table (manifest table in the report).
- [ ] Every building's manifest entry carries footprint, scaffold layout and course heights (printed by scripts/shots/ta-02.cjs); footprints are multiples of 4 m.
- [ ] docs/sprint1/ta-02/silhouettes_700m_grey.png: every piece identifiable by silhouette at 700 m in greyscale (reviewer).
- [ ] A 40-piece village in the viewer kit mode renders in <= 25 draw calls (printed) - screenshot at tactical and close distance under sky_golden.
- [ ] Close-up shots at 2 m of house, granary and shrine show three detail scales (macro grime, meso blocks/carving, micro grain) - reviewer reads the PNGs; Cycles previews in docs/screenshots/pipeline/wp2/; Art Director co-sign.
- [ ] npm run typecheck, npm test, npm run build and SMOKE_PORT=4408 SMOKE_OUT=docs/sprint1/ta-02/smoke npm run smoke pass.

---

### GFX-02 - Terrain (height-blended PBR splat, triplanar cliffs, farmland, roads, apron), water and dynamic weather

- **Team:** Graphics - **Developer:** Graphics Developer — Terrain, Water & Weather - **Reviewer:** Lead Graphics Engineer (Art Director co-signs)
- **Priority:** 9 - **Port:** 4409 - **Depends on:** GFX-01, TA-01, TA-07 - **Status:** TODO
- **Owned paths:**
  - `src/render/environment/terrain.ts, src/render/environment/terrain/** (new)`
  - `src/render/environment/textures.ts`
  - `src/render/environment/water.ts, src/render/environment/water/** (new)`
  - `src/render/environment/weather.ts, src/render/environment/weather/** (new)`
  - `src/render/materials/splat.ts`
  - `src/render/world/roads.ts`
  - `tests/render/terrain/** (new)`
  - `scripts/shots/gfx-02.cjs (new), docs/sprint1/gfx-02/** (new)`
- **Read first:**
  - CLAUDE.md, docs/STUDIO.md
  - docs/ART_BIBLE.md §2 (zoom bands), §4.2 (weather overlays), §4.5, §5 (terrain, layers, blending rules, biome recipes, farmland, roads, riverbanks), §6 (water), §13, §15 (horizon, settlements ground)
  - docs/ARCHITECTURE.md §7 (terrain windows), §15, §17 known gaps (streaks, apron, worker)
  - src/render/style/terrain.ts (TERRAIN_LAYERS, BIOME_TERRAIN, SEASON_TERRAIN, FARMLAND, ROAD_STYLES, RIVERBANK, WATER_PRESETS), src/render/materials/splat.ts
  - src/core/terrain/*.ts, src/render/environment/{terrain,water,weather,textures}.ts, src/render/world/roads.ts, src/render/architecture/layout.ts (field_plot placements)

**Spec**

Make the ground, rivers and weather of the River of Kings look like a film at 2 m and like a printed map at 2.6 km.

1. Terrain material (ART_BIBLE §5): per-chunk splat weights from BIOME_TERRAIN rules (moisture, slope, height, river distance, settlement grounds, roads, field plots) with up to 4 active layers per chunk plus a global macro map; TERRAIN_LAYERS from WP1 (terrain_* material ids via ctx.assets.loadMaterial) height-blended in splat.ts; triplanar cliffs (terrain_rock_*) on steep slopes; distance blending (macro colour far, detail near; detail-normal fade by ZoomLook); SEASON_TERRAIN (wet-mud overlay, dry-grass shift, puddles); wetness from MATERIAL_GLOBALS (darkening, roughness drop, height-masked puddles with the SSR mask flag for GFX-01); procedural fallback (current vertex colours + detail textures) when assets are off.

2. Farmland and settlements (ART_BIBLE §5.5-§5.6): plots from SettlementLayout field_plot placements (owned by GFX-06; read-only contract) with FARMLAND furrow UV rotation per plot and crop-season tint; packed earth inside settlements, flagstone courts and royal axes; riverbanks (RIVERBANK: sand bars, wet line, ghat interface).

3. Roads (src/render/world/roads.ts + splat): ROAD_STYLES - packed earth with ruts, flagstone royal roads; splatted on battle and hero maps, ribbons with the same look on the strategic map; damaged/blocked road look driven by road condition.

4. Geometry: fix the 12 m-cell streaks on the region map (normals from a smoothed/bicubic field or per-chunk baked normal maps), chunk LOD with skirts/geomorphing (no cracks), a terrain apron beyond every map edge (low-res ring to the horizon that melts into GFX-01 sky fog - no hard line), cloud shadows (ZoomLook.atmosphere.cloudShadows).

5. Load time: generate heightfields in a Web Worker (src/render/environment/terrain/heightfieldWorker.ts importing core/terrain) and seed the cache with CORE-01 primeHeightfield(); export loadHeightfieldAsync(spec) for scenes; main-thread stall < 50 ms; results identical to the synchronous path.

6. Water (ART_BIBLE §6, WATER_PRESETS): river with flow direction from the river path, flow-mapped normals, depth absorption and colour, shoreline foam and soft edges (depth texture), flood level from weather.flood; still water for tanks and stepwells; wet ghat steps; reflections env map (low/medium), planar for rivers (high), SSR on ultra (flag for GFX-01); rain ripples (WP7 fx_rain ripple normals).

7. Weather: GPU rain streaks (camera-relative volume, wind slant, count = QualitySettings.weatherParticles) and splashes (fx_rain flipbook), puddle growth with wetness, monsoon storm lightning (call the GFX-01 rig triggerLightning() and emit audio:sfx thunder 1-4 s later), dust storm sprites, dawn mist sprites near water (fx_mist) - all fogged with injectHeightFog.

Budgets: terrain <= 40 draw calls in battle and <= 60 on the world map incl. shadows, water <= 4, weather <= 4; terrain triangles within ARCHITECTURE §15; zero per-frame allocations; everything disposed. Compatibility rule (STUDIO.md W15): today's scenes (WorldScene, BattleScene, HeroScene, MenuScene, AssetViewerScene) are owned by other tickets - keep every public class/method they call source-compatible so your improvements show up in them without edits; add new capabilities as new methods/options, and demonstrate what the scenes do not drive yet in your own lab modules (?scene=lab&lab=<id>, *.lab.ts files inside your owned directories, W6).

**Acceptance**

- [ ] npm run typecheck, npm test, npm run build, npm run build:single (procedural fallback path) and SMOKE_PORT=4409 SMOKE_OUT=docs/sprint1/gfx-02/smoke npm run smoke pass with no console errors.
- [ ] scripts/shots/gfx-02.cjs produces in docs/sprint1/gfx-02/: river battle at tactical and close zoom (noon, golden), world map at strategic and operational zoom, a riverbank/ghat close-up at dawn, farmland patchwork around Dhanyagram, a monsoon storm (rain + wet ground + puddles + lightning frame; ?weather= or a weather lab), a dust storm and the map edge at operational zoom (no hard line) - reviewed with the Art Director.
- [ ] Region terrain at strategic zoom shows no 12 m streaks on hills (before/after pair).
- [ ] tests/render/terrain/worker.test.ts (or equivalent node test of the worker module): worker-generated heightfield equals the synchronous one byte for byte; main-thread stall during world enter < 50 ms (measured by profiler mark, printed).
- [ ] Draw calls from getProfile(): terrain <= 40 (battle) / <= 60 (world) incl. shadows; water <= 4; weather <= 4.
- [ ] ?assets=off renders the procedural terrain and water without errors (screenshot).

---

### TA-03 - WP3 monuments, faction landmarks, fortifications (walls L1-L3), waterfront, Setu bridge and siege kit

- **Team:** Technical Art - **Developer:** Technical Artist C — Monuments, Landmarks & Fortifications - **Reviewer:** Technical Art Director (Art Director co-signs)
- **Priority:** 10 - **Port:** 4410 - **Depends on:** TA-07, TA-01 - **Status:** TODO
- **Owned paths:**
  - `tools/blender/assets/models/** (incl. existing stupa_sanchi.py)`
  - `tools/blender/assets/monuments/** (new)`
  - `tools/blender/assets/landmarks/** (new)`
  - `tools/blender/assets/fortifications/** (new)`
  - `tools/blender/assets/waterfront/** (new)`
  - `public/assets/** files generated for the asset ids whose scripts live in the directories above`
  - `docs/screenshots/pipeline/wp3/** (new)`
  - `scripts/shots/ta-03.cjs (new), docs/sprint1/ta-03/** (new)`
- **Read first:**
  - CLAUDE.md, docs/STUDIO.md (W3, W4, W14)
  - docs/ASSET_LIST.md §0 and WP3 (+ landmarks table, age upgrades)
  - docs/ART_BIBLE.md §1.3-§1.5, §8 (esp. §8.6 walls, §8.7 landmarks, §8.8), §12.4 (opening cinematic), §15 (stupa review)
  - docs/DESIGN_SPEC.md §3.4 (Setu Bridge, Pilgrim Ford), §6.6.5, §8.5-§8.6, §11.2-§11.6 (Rajapura districts, Hall of Pillars, Tirthaghat ghats, oath stone)
  - tools/blender/assets/models/stupa_sanchi.py, tools/blender/lib/{trim,ornament,mesh,lod,export}.py

**Spec**

Build the set pieces that carry the Wukong-level close-ups and the AoE-level landmark silhouettes: WP3-01..WP3-16 and landmarks WP3-L1..L16.

P0 (vertical slice): stupa_sanchi re-skin (WP3-01: buff stone via sandstone_buff, weathered lime-plaster dome, harmika gilding traces, new LOD2 ~2k, 0.8x town variant - fixes the 'all red' review), temple_shikhara (M brick-plaster, S stone), pillar_mauryan (bull/elephant/horse/8-spoke wheel crowns - never lions or a 24-spoke wheel), palace_kit (platform, the Hall of Pillars INTERIOR used by the negotiation mission, tiered timber pavilions with wagon-vault roofs, gate, gardens, chhatris), pavilion_mandapa, chhatri, ghat_kit (steps 0.30 x 0.45, landings, corner towers, lamp niches, mooring rings, flood-mark macro; the Tirthaghat dawn duel arena with the oath stone half in the water), bridge_setu (9 spans; intact, damaged and broken variants for persistent consequences), walls_L1 (earth rampart + sal palisade, timber towers and gate) and walls_L2 (brick/laterite curtain, bastions every 30-40 m, twin-tower gate) as tileable 8-12 m segments + corners + gates + towers, and the two playable-faction landmarks WP3-L1 Hall of a Hundred Pillars (Suvarna, 18 m) and WP3-L2 Oath Stone of the Seven Clans (Giridurga, 10 m).

P1: stepwell, harbor_jetty, walls_L3 (dressed stone, barbican), walls_damage per level (cracks, broken merlons, breach + rubble ramp), siege_kit (hide-roofed rams, ladders, mantlets, siege-camp tents, palisaded camp), rock_cut_facade_kit (gavaksha arch, ribbed vault interior), landmarks L3..L8 (the rest of Suvarna's and Giridurga's). P2 landmarks L9..L16 only if budget allows (GFX-06 builds fallbacks from architecture pieces otherwise).

Rules: triangle budgets landmark <= 120k / 30k / 6k, major buildings 20-60k / 6-15k / 1.5-3k, wall segment 1.5-4k / 400-1k / 100-200; macro maps 2048 on ultra for landmarks, 1024 otherwise; textures only via WP1 sets (sandstone_buff, lime_plaster_weathered, brick_fired_old, timber_teak_carved, sandstone_polished_mauryan, granite_rubble, basalt_dressed, laterite_block, ...); construction metadata (footprint mesh, 1.5x landmark scaffold layout with banner socket, course heights) via TA-07 'construction'; banner sockets on gates and landmarks; landmarks are the tallest silhouette of their settlement and read at 2.6 km by outline alone; hero close-ups pass the three-scales rule (ART_BIBLE §1.4). Historical notes in each docstring (stylizations flagged: shikhara, monumental stepwells, chhatris). Budget WP3: 9 / 5.5 / 2.3 MB.

Critique loop: Cycles previews (hero, close, overview, 2.6 km silhouette) -> Read -> fix; viewer shots under sky_golden and sky_dawn; the Hall of Pillars interior with the incense_dim mood once GFX-01 lands.

**Acceptance**

- [ ] All P0 and P1 WP3 ids published under the publish lock; npm run assets:check passes; WP3 <= 9 / 5.5 / 2.3 MB; triangle table per LOD in the report within budget.
- [ ] Stupa re-skin: viewer shots at camera=hero and close under sky_golden in docs/sprint1/ta-03/ beside the old docs/screenshots/pipeline images - buff stone, plaster dome, no all-red stone (Art Director sign-off).
- [ ] Landmark silhouettes: a greyscale shot of L1 and L2 at 2.6 km among WP2 houses shows each landmark as the tallest recognisable outline (reviewer).
- [ ] Walls L1/L2 (and L3, damage) tile around a 110 m-radius ring with gates and towers without gaps (viewer kit shot, top and eye level).
- [ ] Hall of Pillars interior and the Tirthaghat ghats + oath stone render at hero distance with three detail scales (close-up PNGs reviewed); bridge_setu intact/damaged/broken variants side by side.
- [ ] Cycles previews in docs/screenshots/pipeline/wp3/; npm run typecheck, npm test, npm run build and SMOKE_PORT=4410 SMOKE_OUT=docs/sprint1/ta-03/smoke npm run smoke pass (assetviewer shots of the stupa still pass).

---

### GFX-04 - Crowd renderer (VAT instancing, LOD chain, faction tint), formation readability markers, banners, projectiles and particle/impact VFX

- **Team:** Graphics - **Developer:** Graphics Developer — Crowds, Readability & Battle FX - **Reviewer:** Lead Graphics Engineer (Art Director co-signs; Lead Gameplay co-reviews readability)
- **Priority:** 11 - **Port:** 4411 - **Depends on:** GFX-01, TA-05, TA-07, GP-01 - **Status:** TODO
- **Owned paths:**
  - `src/render/units/** (unitModels, soldierRenderer, formationMarkers, armyMarkers + new)`
  - `src/render/fx/** (particles, projectiles, banners + new)`
  - `tests/render/units/** (new)`
  - `scripts/shots/gfx-04.cjs (new), docs/sprint1/gfx-04/** (new)`
- **Read first:**
  - CLAUDE.md (performance rules), docs/STUDIO.md
  - docs/ARCHITECTURE.md §4, §8, §15, §20 and docs/adr/0003-crowd-impostor-fx-assets.md
  - docs/ART_BIBLE.md §2 (team boost, rim, outline, banner scale, tokens), §3.4, §9.2, §9.7, §10 (VFX, low gore), §13
  - docs/DESIGN_SPEC.md §5.6, §6.13, §8.7 (army tokens), §11.7 (melee VFX keys)
  - src/render/style/{factions,emblems,zoom}.ts (FACTION_ART, factionVisual, RELATION_STYLES, BANNER_DIMENSIONS, bannerSvg, EMBLEMS), src/core/types.ts (SoldierBuffers, SOLDIER_ANIM)
  - src/render/units/*.ts, src/render/fx/*.ts, src/scenes/BattleScene.ts (current consumer)

**Spec**

Render 1,000-5,000 soldiers with real animation at AoE readability and Wukong fidelity up close, plus everything that makes a battle legible.

1. VAT crowd renderer: one InstancedMesh per (unit asset, LOD); per-instance attributes clip index, start time/phase, speed scale (stride-matched from manifest), tint/variation, LOD fade; vertex shader texelFetches frames N and N+1 by gl_VertexID with column wrapping and lerps positions + octahedral normals; customDepthMaterial / customDistanceMaterial run the same VAT code so shadows animate; height fog via injectHeightFog; dithered LOD cross-fade (GFX-01 chunk). LOD chain VAT LOD0 -> VAT LOD1 -> 8-direction impostor sheets by QualitySettings crowdLod/soldierLod; CPU frustum + LOD compaction every frame, allocation-free. Map SoldierBuffers state, anim variant and role flags (GP-01) to clips; mounted and beast units (cavalry, chariots, elephants, carts) as combined VATs. Fallback: keep the current procedural vertex-animated soldiers (unitModels.ts) when VAT assets are missing or ?assets=off.

2. Generic CrowdRenderer API (same machinery, arbitrary agents with clip per instance) for GFX-06 villagers and GP-02 city crowds: add/remove/update agent (position, facing, clip, phase, tint), budget caps.

3. Faction colour (ART_BIBLE §3.4, §9.7): team mask x FactionArt.clothDye with +-6% per-instance variation, colour-blind remaps (factionVisual), ZoomLook team boost / rim / outline px at distance, relation colouring option.

4. Banners (ART_BIBLE §17 Lead Graphics item 5): canvas Path2D textures from bannerSvg/EMBLEMS per faction and BannerShape, cloth vertex shader on WP7 banner_cloth meshes (static mesh on low), wind from WIND, scale from ZoomLook.bannerScale; standard bearers per formation, fallen standards for routing formations; banners on landmarks/gates exposed for GFX-06.

5. Formation readability (DESIGN_SPEC §6.13): footprint rings with RELATION_STYLES (solid own / dashed ally / spiked enemy), selection highlight, order preview footprint + facing arrow while dragging, queued waypoints as dotted lines with numbered pins, routing red arrows toward the edge, wavering pulse, deployment zones, objective markers (breach_gate), charge motion streak + dust - all batched (<= 10 draw calls).

6. Strategic army tokens (armyMarkers.ts): banner tokens at 3x in the strategic band, direction ticks, ghost outlines for last-known enemies, engagement crossed swords, 0.4 s dissolve between tokens and soldiers at the strategic/operational boundary.

7. Projectiles: instanced arrows and javelins following the authoritative volleyPoint arcs (clear AoE-style arcs), impact puffs.

8. Particles/VFX: pooled GPU billboards using WP7 flipbooks (lit, normal-mapped smoke; fire; dust incl. hoof and charge dust; sparks/embers), soft particles, caps from QualitySettings.particles; FxSystem.spawn(key, position, normal, scale) for keys dust, smoke, fire, sparks, slash_spark, heavy_dust, parry_flash, finisher_burst, water_spray, charge_streak, construction_dust; WeaponTrail (fx_weapon_trail) for the hero.

Budgets (ARCHITECTURE §15): crowd + markers + fx incl. shadow passes <= 120 draw calls at 1,000 soldiers and <= 160 at 5,000; soldier triangles <= 0.6 M (1,000) and <= 2.5 M (5,000); render.prep < 1.0 ms (1,000) and < 3.5 ms (5,000) on the profiler; mobile low (600-1,500) <= 50 draw calls for crowds. Compatibility rule (STUDIO.md W15): today's scenes (WorldScene, BattleScene, HeroScene, MenuScene, AssetViewerScene) are owned by other tickets - keep every public class/method they call source-compatible so your improvements show up in them without edits; add new capabilities as new methods/options, and demonstrate what the scenes do not drive yet in your own lab modules (?scene=lab&lab=<id>, *.lab.ts files inside your owned directories, W6).

**Acceptance**

- [ ] npm run typecheck, npm test, npm run build, npm run build:single and SMOKE_PORT=4411 SMOKE_OUT=docs/sprint1/gfx-04/smoke npm run smoke pass with no console errors (battle, battle-close, battle-river-5000, battle-mobile).
- [ ] docs/sprint1/gfx-04/ (battle scene via URL params + ?advance steps, and your crowd/markers/fx labs for interactions the BattleScene does not drive yet): 1,000-soldier battle at tactical and close zoom, a cinematic close-up (15-30 m) showing VAT animation, shadows that animate, cavalry charge with dust, elephant formation, archers volley arcs, a routing formation with fallen standard and red arrow, selection/relation rings, waypoint pins and order preview, strategic army tokens with banners, a greyscale tactical shot where classes stay readable, and colour-blind (protan) variants - reviewed by the Lead Graphics Engineer and Art Director.
- [ ] Profile table from __SAMRAJYA__.getProfile(): 1,000 soldiers @high <= 120 crowd/marker/fx draw calls incl. shadows, soldier triangles <= 0.6 M, render.prep < 1.0 ms; 5,000 @high <= 160, <= 2.5 M, < 3.5 ms; battle-mobile @low <= 50 crowd draw calls.
- [ ] tests/render/units/*.test.ts: SoldierBuffers -> clip mapping, LOD bucketing and compaction are allocation-free (no array growth after warm-up) and deterministic.
- [ ] ?assets=off battle renders the procedural soldiers without errors (screenshot); FxSystem keys all spawn in a test scene shot (contact sheet).

---

### TA-04 - WP4 vegetation (13 trees with LODs + octahedral impostors), grass cards, crops, ground plants and rocks

- **Team:** Technical Art - **Developer:** Technical Artist D — Vegetation, Crops & Rocks - **Reviewer:** Technical Art Director (Art Director co-signs)
- **Priority:** 12 - **Port:** 4412 - **Depends on:** TA-07 - **Status:** TODO
- **Owned paths:**
  - `tools/blender/assets/vegetation/** (new)`
  - `tools/blender/assets/crops/** (new)`
  - `tools/blender/assets/rocks/** (new)`
  - `public/assets/** files generated for the asset ids whose scripts live in the directories above`
  - `docs/screenshots/pipeline/wp4/** (new)`
  - `scripts/shots/ta-04.cjs (new), docs/sprint1/ta-04/** (new)`
- **Read first:**
  - CLAUDE.md, docs/STUDIO.md (W3, W4, W14)
  - docs/ASSET_LIST.md §0 and WP4
  - docs/ART_BIBLE.md §1.5 (BANNED_PLANTS), §7 (trees, Blender recipe §7.2, wind §7.3, crops §7.4, placement §7.5), §14 (leaf atlases)
  - src/render/style/vegetation.ts (TREE_SPECIES, GROUND_PLANTS, CROPS, WIND, VEGETATION_LOD, BANNED_PLANTS)
  - docs/adr/0003-crowd-impostor-fx-assets.md (impostor kind), tools/blender/lib/{mesh,lod,export,impostor}.py

**Spec**

Grow the subcontinent's flora procedurally in Blender: WP4-01..WP4-25.

Trees (P0 banyan, peepal, neem, mango, palmyra, sal; P1 teak, babul, palash, bamboo, date palm, amaltas; P2 coconut): each with 3 shape variants, LOD0 at TREE_SPECIES.tris (3-16k), LOD1 1-4.5k, LOD2 0.3-0.9k, a hemi-octahedral impostor (8x8 frames, 256/192/128 px by tier, TA-07 'impostor' kind), shared leaf atlases (A class, pages of 4 species, procedural leaf outlines: peepal heart + drip tip, mango lanceolate, neem pinnate; vein relief; back faces +15% lighter; translucency in ORM.b) and bark sets (C class). Vertex colours R hierarchy, G phase, B flutter, A AO for the WIND shader; crowns shade as volumes (bent normals); species signatures (banyan prop roots and aerial root cards + platform variant; peepal railing + red threads variant and visible flutter; palash leafless + flowers). Seasonal states (flush, flowering, bare, partial drop) as parameters/atlas regions, not separate meshes, so GFX-03 switches them by season.

Ground: grass_blades (GPU cards, 3-blade clumps, 4 seasonal colour sets - doob grass), kash_grass (sharad plumes with backlight translucency), reeds, lotus, shrubs (ber, aak, generic x3).

Crops: rice, wheat, mustard (P0); millet, sugarcane, cotton (P1); barley, sesame, lentil (P2) as card sets with growth stages per CROPS (seedling, tillering/green, heading/bloom, golden, stubble, sheaves/straw stacks).

Rocks kit: granite tors, basalt blocks, sandstone outcrops, pebble clusters, fallen logs, stumps (textures via WP1 terrain rock sets). forest_floor_decals (P2).

Rules: no species in BANNED_PLANTS; impostors indistinguishable beyond 220 m (impostor colour within 5% of LOD2); LOD cross-fades without popping; textures within class sizes; budget WP4 9 / 4.5 / 1.8 MB.

Critique loop: Cycles previews (hero distance, 30 m, 220 m; front-lit and back-lit) -> Read -> fix; viewer impostor A/B mode; a 1 km forest test via the viewer kit mode for draw calls.

**Acceptance**

- [ ] All P0 and P1 WP4 ids published under the publish lock; npm run assets:check passes; WP4 <= 9 / 4.5 / 1.8 MB; triangle table per tree LOD within TREE_SPECIES targets.
- [ ] For every tree: impostor vs LOD2 at 220 m colour difference < 5% (printed by scripts/shots/ta-04.cjs) and an A/B screenshot pair.
- [ ] docs/sprint1/ta-04/: species line-up (summer and the signature season of each), a backlit peepal/kash close-up showing translucency, crop growth-stage contact sheets for rice/wheat/mustard, rocks kit line-up - reviewed with the Art Director.
- [ ] A 1 km forest in the viewer kit mode at tactical zoom renders in <= 60 draw calls incl. impostors (printed).
- [ ] No BANNED_PLANTS species (script docstrings list the species basis); Cycles previews in docs/screenshots/pipeline/wp4/; npm run typecheck, npm test, npm run build and SMOKE_PORT=4412 SMOKE_OUT=docs/sprint1/ta-04/smoke npm run smoke pass.

---

### GFX-05 - Cameras (AoE-style RTS, Wukong-style hero, cinematic director), zoom-look controller, picking and strategic map overlays

- **Team:** Graphics - **Developer:** Graphics Developer — Cameras, Picking & Map Overlays - **Reviewer:** Lead Graphics Engineer (Lead Gameplay co-reviews camera feel)
- **Priority:** 13 - **Port:** 4413 - **Depends on:** CORE-01, GFX-01 - **Status:** TODO
- **Owned paths:**
  - `src/render/camera/** (rtsCamera, heroCamera, picking + new cinematic.ts, zoomLook.ts, shake.ts)`
  - `src/render/world/overlays.ts, src/render/world/overlays/** (new)`
  - `tests/render/camera/** (new)`
  - `scripts/shots/gfx-05.cjs (new), docs/sprint1/gfx-05/** (new)`
- **Read first:**
  - CLAUDE.md, docs/STUDIO.md
  - docs/ART_BIBLE.md §2 (zoom bands and transitions), §12 (RTS camera, hero camera, composition, opening cinematic)
  - docs/DESIGN_SPEC.md §2.2, §6.13 (cinematic camera), §8.7 (minimap frustum, alerts), §11.3 (shot list), §11.7 (shake, hit-stop), §11.8 (camera numbers), §12.5 (reduced motion)
  - src/render/style/zoom.ts (resolveZoomLook, capZoomLook, ZOOM_BANDS, QUALITY_CAPS), src/data/hero.ts (HERO_MISSIONS cinematic shots)
  - src/render/camera/*.ts, src/render/world/overlays.ts, src/input/input.ts (InputFrame)

**Spec**

Give every scene a camera that frames like Age of Empires IV at strategy zoom and like Black Myth: Wukong up close, plus the zoom-look signal that drives LOD/post everywhere.

1. RTS camera (ART_BIBLE §12.1): FOV/pitch blended by zoom band (ZOOM_BANDS), zoom-to-cursor, smooth rotate/tilt, edge scroll, keyboard pan per key preset (InputFrame), touch pinch/twist/drag/two-finger tilt, terrain collision and min height, bounds incl. the apron, ranges 120 m - 6 km (world) and 15-700 m (battle); flyTo(target, distance, durationSec) with ease (age-up swoop, alert jumps, minimap clicks), follow(target), north-up/rotating option for the minimap; honour ?camdist= and ?camera= at construction so captures can pick a band.

2. Zoom look: ZoomLookController.update(camera, tier) -> ZoomLook via resolveZoomLook(distance, out) + capZoomLook(look, tier), allocation-free; scenes hand it to post (GFX-01 applyZoomLook), crowds (GFX-04), architecture/vegetation LOD bias (GFX-06/GFX-03), fog scale. No pops: numeric values blend, booleans switch at band midpoints (ART_BIBLE §2.3).

3. Hero camera (DESIGN_SPEC §11.8): explore 4.2 m, combat 5.5 m, height 1.65 m, right shoulder 0.55 m, FOV 50/58, collision pull-in (sphere cast vs layout colliders + heightfield), auto-recenter after 2 s without look input, lock-on framing of hero + target, dialogue over-the-shoulder two-shot at 1.4 m exposing a DoF focus target, damped-noise shake (amplitude m over 0.2 s; bus camera:shake; disabled by settings.reducedMotion), freeze support for hit-stop.

4. Cinematic director: plays CinematicShotDef lists (aerial, crane down, tracking behind, low angle, over shoulder, close up; durations; subjects resolved by scene callbacks) along splines with eases, exposes letterbox state and DoF focus, skippable (hold Esc / long-press), player-control shots (c4 steadicam framing); battle cinematic camera (camera_toggle_cinematic): frames the selected formation at 15-30 m with DoF, shake 0.05 within 60 m of an elephant charge.

5. Picking: ground ray-march (existing), formation footprint picking, army and settlement picking, screen-space box selection, batched worldToScreen for HUD anchors (formation cards, prompt bubbles), frustum ground quad for the minimap.

6. Strategic map overlays (overlays.ts, ART_BIBLE §2.2): province borders in faction colour with contested hatching, selection highlight, army route polylines (from SIM-01 path data), ghost markers, engagement markers, supply overlay (line intact, depots, radii), terrain overlay (movement classes), alert pings for world:alert as expanding 3D rings (red/amber/gold).

Tests: pure math (band blending, collision pull-in, spline shot timing, frustum quad). No per-frame allocations. Compatibility rule (STUDIO.md W15): today's scenes (WorldScene, BattleScene, HeroScene, MenuScene, AssetViewerScene) are owned by other tickets - keep every public class/method they call source-compatible so your improvements show up in them without edits; add new capabilities as new methods/options, and demonstrate what the scenes do not drive yet in your own lab modules (?scene=lab&lab=<id>, *.lab.ts files inside your owned directories, W6).

**Acceptance**

- [ ] npm run typecheck, npm test (tests/render/camera/*.test.ts for band blending, collision pull-in, shot timing and frustum quad) and npm run build pass; SMOKE_PORT=4413 SMOKE_OUT=docs/sprint1/gfx-05/smoke npm run smoke passes.
- [ ] scripts/shots/gfx-05.cjs saves world camera shots at 2.6 km / 700 m / 220 m / 45 m (the RTS controller honours ?camdist= at construction) showing the AoE IV framing per band, battle tactical + cinematic shots (lab until GP-04 binds camera_toggle_cinematic), hero explore / combat / lock-on / dialogue two-shot framings and the 7 opening-cinematic shots c1-c7 as stills (camera labs in src/render/camera/*.lab.ts until HeroScene adopts the API) in docs/sprint1/gfx-05/ - reviewed with the Lead Gameplay Engineer.
- [ ] A zoom sweep capture (10 frames from 2.6 km to 45 m) shows no grade/fog/exposure pop (reviewer + numeric dump of ZoomLook per frame).
- [ ] Overlays shot (world scene or an overlays lab fed with SIM-01 data): province borders with contested hatching, army routes, ghosts, engagement markers, supply overlay and an alert ping on the world map.
- [ ] Reduced motion: camera:shake produces zero displacement when settings.reducedMotion is true (unit test).

---

### TA-06 - WP6 hero & cinematic characters: Kumara Aditya, rival champion, envoy, enemy archetypes, NPC kit, weapons, portraits

- **Team:** Technical Art - **Developer:** Technical Artist F — Hero & Cinematic Characters - **Reviewer:** Technical Art Director (Art Director co-signs; Lead Gameplay co-reviews clip frame data)
- **Priority:** 14 - **Port:** 4414 - **Depends on:** TA-07, TA-01, TA-05 - **Status:** TODO
- **Owned paths:**
  - `tools/blender/assets/characters/** (new)`
  - `tools/blender/assets/weapons/** (new)`
  - `tools/blender/assets/portraits/** (new)`
  - `public/assets/** files generated for the asset ids whose scripts live in the directories above`
  - `docs/screenshots/pipeline/wp6/** (new)`
  - `scripts/shots/ta-06.cjs (new), docs/sprint1/ta-06/** (new)`
- **Read first:**
  - CLAUDE.md, docs/STUDIO.md (W3, W4, W14)
  - docs/ASSET_LIST.md §0 and WP6
  - docs/ART_BIBLE.md §1.3-§1.5, §9 (proportions, costume §9.4, hero/rivals/NPCs §9.5, animation style §9.6), §12.2
  - docs/DESIGN_SPEC.md §11.4 (characters), §11.6-§11.8 (missions, melee frame data table, controls/camera)
  - src/data/hero.ts (HERO_CHARACTERS appearances, HERO_COMBAT, HERO_ENEMIES), src/render/style/palette.ts (DYES, SKIN_TONES, HAIR, METALS)
  - tools/blender/lib/{rig,anim,export}.py, tools/blender/selftest.py, TA-05 crowd humanoid conventions (tools/blender/assets/crowd/ docstrings)

**Spec**

Create the skinned (not VAT) characters of hero mode and the cutscenes at Wukong-level fidelity, on the shared humanoid skeleton + face bones (jaw, eyelids, brows) + cloth/hair chains (bones named x_cloth_* / x_hair_* with suggested stiffness in extras for GP-02's runtime spring bones), root motion on locomotion and attacks, 2048 sets on ultra / 1024 high / 512 mobile (mobile uses LOD1).

P0: WP6-01 Kumara Aditya (1.74 m, 35k / 10k tris; body/face, silk+cotton costume, gold/bronze/leather) with the full exploration set (idle x2, walk, run, sprint, turn_l/turn_r 90 and 180, interact inspect/pick up/open gate, talk, x_bow_namaste, x_sit, x_step_off_barge) and combat set (attack_combo_1, attack_combo_2, attack (light 3 finisher), attack_heavy + x_heavy_hold + x_heavy_release, dodge roll 0.55 s / 4.5 m, block, parry, x_riposte, hit front/back/left/right, stagger, x_guard_break, x_salve, strafe_l/r, x_perfect_dodge, die, x_get_up); WP6-03 Vira Durjaya (1.86 m, incl. x_leap_overhead with 0.8 s wind-up, x_sweep_unblockable, x_throw_shield, x_taunt, x_kneel_yield); WP6-05 Hired Blade, WP6-06 Raider Spearman, WP6-08 Raider Captain (x_unblockable_overhead, x_enrage); WP6-10 NPC modular kit (bodies noble/warrior/priest/merchant/farmer/scholar/guard/envoy/child x m/f; garments recoloured from appearance.garment/accent snapped to DYES; headgear turban/crown/helmet/veil/topknot; props staff, palm-leaf ledger (pothi), sword, mace, bow, lamp, scroll, basket, spear; clips idle x3, walk, talk x3 gesture sets, x_bow, x_point, x_cross_arms, x_lean_in, x_worry, x_kneel); WP6-12 weapons and props (khadga + scabbard, curved blade, round shields x3 emblem variants, spear, bow, mace, lamp staff).

P1: WP6-02 Aditya combat outfit, WP6-04 Kumari Meghavati, WP6-07 Raider Archer, WP6-09 Ugrasena, WP6-11 named variations, WP6-13 portraits (22 x 256 px, mural outline-and-wash, TA-07 'image' kind).

Frame data: combat clips match DESIGN_SPEC §11.7 startup/active/recovery/cancel within 1 frame and carry clipEvents (hit_start, hit_end, cancel, iframe_start 0.05 s, iframe_end 0.35 s for the roll, parry_window, footstep) via TA-07 model metadata; telegraphed attacks have 0.5-0.8 s readable wind-ups. Character-specific shared sets (char_cloth_cotton, char_cloth_silk, char_leather, char_metal_gilt, char_skin variants) live in this package and count against WP6. Materials read as different under golden_dust and dawn_mist: silk sheen, cotton matte, gold metal, skin with wrap/SSS-like look (material extras flag for GFX-01). Historical care per ART_BIBLE §1.5 (no stirrups, no anachronistic armour). Budget WP6: 6 / 3 / 0.8 MB.

Critique loop: Cycles turntables at the 4.2 m hero-camera distance under sky_dawn and sky_golden, combat clip contact sheets (every 2nd frame) with event markers, close-ups at 1.4 m for dialogue -> Read -> fix; viewer skinned playback.

**Acceptance**

- [ ] All P0 and P1 WP6 ids published under the publish lock; npm run assets:check passes; WP6 <= 6 / 3 / 0.8 MB; triangle table within ASSET_LIST §0.3 (hero 25-40k / 10k / 3k, NPC 8-15k / 3k / 800).
- [ ] scripts/shots/ta-06.cjs prints each combat clip's event times vs DESIGN_SPEC §11.7 (startup, active, recovery, cancel, i-frames): all within 1 frame (1/30 s).
- [ ] docs/sprint1/ta-06/: Aditya and Durjaya turntables at 4.2 m under dawn and golden skies, dialogue close-ups at 1.4 m, combat contact sheets (combo, heavy, roll, parry, Durjaya leap), NPC kit line-up of 9 bodies x 2 with garment recolours - reviewed with the Art Director; no clipping in combo, roll and parry (reviewer).
- [ ] Viewer: two clones of Aditya play different clips simultaneously and secondary chains (x_cloth/x_hair) are present in the skeleton (screenshot + bone list).
- [ ] Cycles previews in docs/screenshots/pipeline/wp6/; npm run typecheck, npm test, npm run build and SMOKE_PORT=4414 SMOKE_OUT=docs/sprint1/ta-06/smoke npm run smoke pass.

---

### UI-02 - In-game UI: HUD framework, world HUD & panels, AoE command card, minimap, control groups, battle HUD + radial wheel, hero HUD, input presets & touch

- **Team:** UI/UX - **Developer:** UI Engineer — In-game HUD, Command Card, Minimap & Input - **Reviewer:** Lead UI/UX Engineer (Art Director co-signs look)
- **Priority:** 15 - **Port:** 4415 - **Depends on:** CORE-01, SIM-01 - **Status:** TODO
- **Owned paths:**
  - `src/ui/ui.ts, src/ui/dom.ts, src/ui/base.css`
  - `src/ui/components/** (new)`
  - `src/ui/screens/world.ts, src/ui/screens/battle.ts, src/ui/screens/hero.ts`
  - `src/ui/screens/world/**, src/ui/screens/battle/**, src/ui/screens/hero/** (new)`
  - `src/ui/services/** (new)`
  - `src/input/**`
  - `tests/ui/hud/** (new), tests/input/** (new)`
  - `scripts/shots/ui-02.cjs (new), docs/sprint1/ui-02/** (new)`
- **Read first:**
  - CLAUDE.md (UI and mobile rules), docs/STUDIO.md
  - docs/DESIGN_SPEC.md §8.1 (resource bar), §8.2 (placement UX), §8.4 (age panel), §8.7 (minimap), §8.8 (command card, Classic/Grid presets, control groups, touch), §6.4 (intents page), §6.13, §11.7-§11.8 (hero controls), §12.2-§12.6
  - docs/ART_BIBLE.md §11 (UI style, tokens, components, mobile), §17 Lead UI/UX items 1-4; docs/art/ui_kit.html + ui_kit.jpg + ui_kit_phone.jpg
  - src/ui/theme.css (Art Director tokens - read only), src/ui/*.ts, src/ui/screens/*.ts, src/input/*.ts, src/app/contracts.ts (ScreenPropsMap, UI_SERVICES contract from CORE-01)
  - src/data/{resources,units,buildings,ages,tutorial}.ts, src/sim/strategic selectors exported by SIM-01

**Spec**

Own the UI framework and every in-world screen so world command and field command feel like Age of Empires IV on PC and on a 390 x 844 phone.

1. Framework: UIManager (layers, lazy screens incl. CORE-01's discovered *.screen.ts modules, start/stop UI_SERVICES, setLoadingRenderer(fn) hook for UI-01, safe areas, --ui-scale, document.documentElement dataset colorblind/reducedMotion per ART_BIBLE §17 item 4); dom.ts h(); base.css adopting the theme tokens exactly per ART_BIBLE §17 items 1-3 (buttons fix the 2.4:1 contrast, panels, icons, notched meters, tooltips with tap-and-hold on touch, kbd chips, badges, slot buttons, parchment, torana titles); shared components in src/ui/components/ (meter, tooltip, icon, faction chip + emblem, tabs, slider/stepper, sparkline, portrait frame, command-card grid, minimap canvas) for UI-01 to reuse.

2. World HUD (§8.1, §12.2): six-resource bar in RESOURCE_BAR_ORDER with icons, trends and the stated tooltips (phone: Grain/Wealth/Recruits + chevron), date + season + weather + monsoon forecast in month 3, speed controls, realm buttons with alert badges, notification feed (max 5, click to focus), objectives tracker by act; settlement panel (vitals incl. reserve-day colours, labor sliders summing <= 100%, tax slider, buildings grid with level pips/condition, construction and recruitment queues with progress/cancel, garrison); army panel; province panel; build placement UI (cost tooltip, reason text, Shift repeat, touch tick/cross); market; age panel (requirements checklist, two landmark cards with 'Choose site', unlock preview); economy panel (ledger + projection, tax policy, hold-the-reserve, rationing); diplomacy (composer + AI reply reason lines); council; event modal (advisor portraits 'Recommended by', disabled choices with reasons, auto-resolve countdown); engagement prompt (prediction bar + factor lines, queue + 'autoresolve all'); scenario results (epilogue, link to game_stats) and chronicle.

3. AoE command card (§8.8): 5 x 3 grid with hotkeys per preset, tabs per selection (settlement Economy/Military/Civic/Defense/Recruit by BuildingDef.category/commandSlot and UnitDef.commandSlot; army orders incl. stance, forced march, split/merge/disband, visit; battle Orders/Shapes/Intents pages), disabled states with reasons, cost tooltips; phone bottom sheet; control-group row (5 slots on touch; long-press assign).

4. Minimap (§8.7) for world and battle: terrain tint from biomes, rivers, roads by quality, borders with contested hatching, settlements by kind/owner/star, armies with direction ticks and ghosts, engagements, depots, camera frustum quad (GFX-05), alert pings, click/tap jump, right-click move, north-up toggle, phone 56 px collapse.

5. Battle HUD (§12.2, §6.13): side strength/morale bars, battle time, speed; deployment bar (timer, 'Begin battle'); formation cards strip (icon, strength, morale with dominant factor, fatigue tier, ammo pips, experience chevrons, order); floating formation cards + hover health/morale bars anchored at screen positions supplied in props (GP-04); rally button with cooldown ring; event feed; long-press radial wheel (orders inner ring, shapes/intents outer) and simple-mode presets on phones; battle results with prisoners choice and commander fate.

6. Hero HUD: objective line, prompt bubble at the target, compass strip, captions; combat HUD (HP, stamina, salve charges, lock-on reticle, enemy bars, unblockable red-flash cue); touch virtual stick, look area and combat buttons only during combat missions.

7. Input (src/input/**): contexts, Classic and Grid presets exactly per §8.8 (speed keys off ',' and '.'; idle cycling; Ctrl+1..9 / 1..9 / double-tap / Shift), hero context overriding RTS keys (Q guard, E interact, R salve, Space roll, Tab lock-on, LMB/RMB with hold-to-charge), the CORE-01 actions, touch gestures (tap select, drag pan, drag on selection = move, pinch, twist, two-finger tilt, long-press radial, two-finger tap pause, double-tap focus), rebinding API with conflict detection for UI-01's settings, hold-to-toggle options.

Accessibility & perf: contrast >= 4.5:1 body / 3:1 large, targets >= 44 px (48 primary), safe areas, UI scale 80-150%, colour-blind shape coding (emblems + ring styles), no hover-only info; HUD prop pushes diffed at 4-10 Hz; UI + input < 1 ms/frame PC, < 2 ms mobile; no layout thrash.

**Acceptance**

- [ ] npm run typecheck, npm test (tests/ui/hud/*.test.ts with a DOM shim for command-card slot mapping per selection and preset, resource-bar formatting, minimap layer projection; tests/input/*.test.ts for Classic/Grid bindings, conflicts, hero override and gesture recognition from synthetic pointer sequences) and npm run build pass; SMOKE_PORT=4415 SMOKE_OUT=docs/sprint1/ui-02/smoke npm run smoke passes.
- [ ] scripts/shots/ui-02.cjs (opening screens via the real scenes or __SAMRAJYA__.showScreen) saves at 1280x720 and 390x844 (portrait + 844x390 landscape) in docs/sprint1/ui-02/: world HUD with settlement selected (command card Economy tab + Recruit tab), army panel, build placement UI, market, age panel, economy panel, diplomacy with AI reasons, event modal, engagement prompt, battle HUD in deployment and in battle (cards strip, rally, radial wheel open on phone), battle results, hero HUD exploration and combat, minimap world + battle - reviewed with the Art Director against docs/art/ui_kit.jpg.
- [ ] Automated contrast check (script) on the rendered pages: no text below 4.5:1 (3:1 large); every interactive element >= 44 px on the phone captures.
- [ ] Keyboard: every battle order, shape and intent reachable via both presets; touch: every order reachable without keys (asserted in tests).
- [ ] Profiler: UI + input time < 1 ms/frame at 1280x720 in the world and battle captures (printed).

---

### GFX-06 - Settlements: kit-based architecture & layouts (districts, streets, walls L1-L3), construction stages, damage, landmarks, placement ghost and visible villagers

- **Team:** Graphics - **Developer:** Graphics Developer — Settlements, Construction & Villagers - **Reviewer:** Lead Graphics Engineer (Lead Gameplay co-reviews the AoE feel; Art Director co-signs)
- **Priority:** 16 - **Port:** 4416 - **Depends on:** GFX-01, GFX-04, TA-02, TA-03, SIM-01 - **Status:** TODO
- **Owned paths:**
  - `src/render/architecture/** (layout, buildings, settlement + new)`
  - `tests/render/architecture/** (new)`
  - `scripts/shots/gfx-06.cjs (new), docs/sprint1/gfx-06/** (new)`
- **Read first:**
  - CLAUDE.md, docs/STUDIO.md
  - docs/DESIGN_SPEC.md §3.3 (settlements), §8.2 (grid, placement, construction stages), §8.3 (villagers), §8.4-§8.6 (ages, landmarks, walls/siege presentation), §11.2 (Rajapura districts), §11.9 (visit shows current state)
  - docs/ART_BIBLE.md §2, §5.5-§5.6, §8 (all: grammar, styles, kit, construction/upgrades/damage, walls, landmarks, settlement layout rules §8.8), §9.7
  - docs/ASSET_LIST.md WP2 and WP3 (ids, construction metadata), docs/adr/0003-crowd-impostor-fx-assets.md
  - src/render/architecture/*.ts, src/scenes/common.ts, src/sim/strategic/placement.ts (SIM-01), src/data/{buildings,ages,hero}.ts (HERO_DISTRICTS)

**Spec**

Turn settlements into living AoE IV towns that hold up in hero mode.

1. Kit rendering: buildings from WP2/WP3 GLBs via ctx.assets.loadModel, instanced per piece x style x LOD with distance bucketing and dithered cross-fades (GFX-01 chunk), LOD bias from ZoomLook; procedural fallbacks for every kind registered with ctx.assets.registerModelFallback from the existing buildings.ts generators (?assets=off and the single-file build keep working); age variants (J/M/S) chosen by the owner's FactionState.age; architecture styles by owner (heartland_brick, highland_stone; others fall back).

2. Layout v2 (layout.ts; SettlementLayout / ArchitecturePlacement are a shared read-only contract for GFX-02 terrain, GFX-03 vegetation and GP-02 hero - keep them additive): placed buildings at their BuildingInstance.cell/rot (SIM-01 placement), procedural dressing around them per ART_BIBLE §8.8 - streets (packed earth, flagstone royal axes), house infill by population/housing, props, district concentration around HERO_DISTRICTS anchors (Rajapura's seven districts; Tirthaghat's two), field_plot ring with crop type and rotation, shore pieces (ghats, harbor), tanks/stepwells, wall ring by fort level following terrain with gates at road exits and towers per level, deterministic by seed; Rajapura gets hand-tuned overrides (src/render/architecture/capital.ts) so the opening walk route ghats -> granary quarter -> bazaar -> temple -> palace reads.

3. Construction (DESIGN_SPEC §8.2, ART_BIBLE §8.5) from ConstructionJob.progress: foundation (stakes + string lines on the asset footprint mesh, trench decal, material piles) 0-0.10; scaffolding 0.10-0.60 (WP2 scaffold modules from the asset's scaffold layout; walls rise with a course-reveal clip shader aligned to course heights, height = progress / 0.6); roofing 0.60-1.00 (roof appears, scaffold removed at 95%); complete (construction_dust via GFX-04 FxSystem, emits a hook for chime/toast). Upgrades wrap the existing building in scaffold; landmarks use 1.5x scaffolds with a banner; repairs reuse the scaffold stage.

4. Damage (§8.2, §8.6): condition < 0.5 -> charred decals (WP1 decals) + smoke; roof-hole/collapse variants (WP2-19); wall segments crack -> breach rubble (WP3-14) from wallHp / battle segment HP; burning buildings with GFX-01 practical lights; siege camps (WP3-15: rams, ladders, tents, palisade) around besieged settlements; Setu bridge state from road condition.

5. Landmarks: WP3 landmark models (L1/L2 P0) or composites of architecture pieces at LandmarkDef.heightMeters as fallback; faction banners on landmarks and gates via the GFX-04 BannerRenderer; expose landmark world positions for the age-up camera swoop.

6. Placement ghost: PlacementGhost.show(building, rot) / moveToCell / setValidity: building mesh tinted green/red (shader), 4 m grid overlay within r + 60 m with blocked cells hatched, rotation in 90-degree steps; validity and reason strings come from SIM-01 validatePlacement (the scene ticket GP-03 drives it).

7. Villagers (DESIGN_SPEC §8.3): VillagerSystem spawns cosmetic villagers through the GFX-04 CrowdRenderer (WP5 villager VATs) up to QualitySettings.villagerCap per settlement in view, split by SIM-01 villagerAllocation: farmers in field plots with season-correct clips (sowing months 4 and 8, harvest months 7 and 1, ox ploughs in vasanta), builders on active sites (hammer, carry, climb; idle builders sitting in the shade near the well), crafters at workshops, drill and sentries, water carriers well/ghat <-> houses, harvest-day carts to the granary, starving queues at the granary, protest crowds at the governor's house, riot fires; seeded deterministic paths along streets; culled and LOD'd.

Budgets: 40-piece village <= 25 draw calls; Rajapura at tactical zoom <= 150 draw calls + villagers <= 20; all 16 settlements on the world map <= 120 draw calls; zero per-frame allocations. Compatibility rule (STUDIO.md W15): today's scenes (WorldScene, BattleScene, HeroScene, MenuScene, AssetViewerScene) are owned by other tickets - keep every public class/method they call source-compatible so your improvements show up in them without edits; add new capabilities as new methods/options, and demonstrate what the scenes do not drive yet in your own lab modules (?scene=lab&lab=<id>, *.lab.ts files inside your owned directories, W6).

**Acceptance**

- [ ] npm run typecheck, npm test (tests/render/architecture/*.test.ts: layout determinism by seed, placed cells respected, no overlaps, gates at road exits, construction stage mapping) and npm run build, npm run build:single pass; SMOKE_PORT=4416 SMOKE_OUT=docs/sprint1/gfx-06/smoke npm run smoke passes.
- [ ] scripts/shots/gfx-06.cjs saves in docs/sprint1/gfx-06/ (existing scenes via URL params plus settlement/construction/ghost labs in src/render/architecture/*.lab.ts): Rajapura at strategic, operational, tactical and close zoom; a village with farmers at harvest; a construction site at progress 0.05 / 0.3 / 0.55 / 0.8 / 1.0; an upgrade scaffold wrap; damaged and burning buildings; walls L1/L2/L3 with gates; a besieged settlement with siege camp; landmarks L1 and L2 as the tallest silhouette; placement ghost valid and invalid with the grid; the same Rajapura view with ?assets=off - reviewed with the Art Director and Lead Gameplay.
- [ ] Profile table: 40-piece village <= 25 draw calls; Rajapura tactical <= 150 + villagers <= 20; world map settlements <= 120 (getProfile numbers).
- [ ] Villager counts match SIM-01 villagerAllocation for the quality cap (asserted in the settlement lab via __SAMRAJYA__.call('settlement.villagers', id), which the lab forwards to VillagerSystem; GP-03 adds the same hook to WorldScene).

---

### GFX-03 - Vegetation rendering: tree LOD + impostors, dense GPU grass with wind, seasonal colour, crops on fields, ground plants and rocks

- **Team:** Graphics - **Developer:** Graphics Developer — Vegetation, Grass & Crops - **Reviewer:** Lead Graphics Engineer (Art Director co-signs)
- **Priority:** 17 - **Port:** 4417 - **Depends on:** GFX-01, GFX-02, TA-04 - **Status:** TODO
- **Owned paths:**
  - `src/render/environment/vegetation.ts`
  - `src/render/vegetation/** (new: trees, grass, crops, impostors, placement)`
  - `tests/render/vegetation/** (new)`
  - `scripts/shots/gfx-03.cjs (new), docs/sprint1/gfx-03/** (new)`
- **Read first:**
  - CLAUDE.md, docs/STUDIO.md
  - docs/ART_BIBLE.md §2 (grass/impostor distances per band), §5.4 (biome recipes), §7 (trees, wind, crops, placement rules §7.5), §13
  - docs/ASSET_LIST.md WP4 (ids, LOD and impostor contract, acceptance), docs/adr/0003-crowd-impostor-fx-assets.md
  - src/render/style/vegetation.ts (TREE_SPECIES, GROUND_PLANTS, CROPS, WIND, VEGETATION_LOD, BANNED_PLANTS), src/render/environment/vegetation.ts
  - src/render/architecture/layout.ts (field_plot placements), src/core/terrain/heightfield.ts (biome, moisture)

**Spec**

Make the land feel alive and seasonal without breaking the draw-call budget.

1. Trees: WP4 GLBs (3 variants per species) via ctx.assets.loadModel with an instanced LOD chain LOD0/1/2 + hemi-octahedral impostors (TA-07 loadImpostor) beyond QualitySettings.treeImpostorDistance, dithered cross-fades over VEGETATION_LOD.crossFadeM (6 m), species chosen per biome and GeoZone (TREE_SPECIES), seasonal states (flush, flowering, bare, partial drop) and leaf colours switched by season parameters, wind per WIND (trunk sway, branch, leaf flutter from vertex colours R hierarchy / G phase / B flutter; peepal flutter visible), foliage translucency, shadows (LOD1/impostor depth for far casters), height fog via injectHeightFog. Placement (ART_BIBLE §7.5): mango groves near villages, banyans/peepals at crossroads and shrines, palmyras along banks, sal/teak forests by moisture and biome, clearing settlement footprints, roads, field plots and water; deterministic tiles. Fallback: the existing procedural species when assets are off.

2. GPU grass: instanced clumps of WP4 grass_blades cards with density QualitySettings.grassDensity (18 / 40 / 70 per m^2; off on low) within grassDistance, colour sampled from the terrain splat/biome so it blends, 4 seasonal colour sets, wind, distance fade, GPU-side culling by tile; optional flattening under formations (stretch).

3. Ground plants: kash grass (sharad plumes, backlight), reeds on banks, lotus on tanks/ponds, shrubs; rocks kit on hills/rough terrain.

4. Crops: on SettlementLayout field_plot placements (GFX-06 contract) by CROPS growth stage for the current month/season (sowing months, harvest, stubble, straw stacks after harvest), with the farmland furrow orientation of GFX-02.

Budgets: a 1 km forest at tactical zoom <= 60 draw calls incl. impostors and shadows; vegetation caps per tier (ARCHITECTURE §8 table); zero per-frame allocations; everything disposed. Compatibility rule (STUDIO.md W15): today's scenes (WorldScene, BattleScene, HeroScene, MenuScene, AssetViewerScene) are owned by other tickets - keep every public class/method they call source-compatible so your improvements show up in them without edits; add new capabilities as new methods/options, and demonstrate what the scenes do not drive yet in your own lab modules (?scene=lab&lab=<id>, *.lab.ts files inside your owned directories, W6).

**Acceptance**

- [ ] npm run typecheck, npm test (tests/render/vegetation/*.test.ts: deterministic placement per tile, exclusion of settlements/roads/water, crop stage by month), npm run build and npm run build:single pass; SMOKE_PORT=4417 SMOKE_OUT=docs/sprint1/gfx-03/smoke npm run smoke passes.
- [ ] scripts/shots/gfx-03.cjs saves in docs/sprint1/gfx-03/: eastern forest edge at tactical and close zoom, a mango grove by Dhanyagram at golden hour, grass at hero distance (dawn backlight), the same field in four seasons (sowing, green, golden, stubble; ?season= or a vegetation lab), kash plumes in sharad, palash bloom in vasanta, impostor transition sweep (no popping), mobile low - reviewed with the Art Director.
- [ ] Profile: 1 km forest at tactical zoom <= 60 vegetation draw calls incl. impostors (printed); battle 1,000 @high total frame still < 400 draw calls.
- [ ] ?assets=off renders the procedural vegetation without errors (screenshot).

---

### SIM-02 - AI: battle AI (deployment, tactics, sieges), intent-order translation, campaign AI with personalities and difficulty

- **Team:** AI & Simulation - **Developer:** AI Engineer — Battle AI, Intents & Campaign AI - **Reviewer:** Lead AI & Simulation Engineer
- **Priority:** 18 - **Port:** 4418 - **Depends on:** SIM-01, GP-01 - **Status:** TODO
- **Owned paths:**
  - `src/sim/tactical/battleai.ts, src/sim/tactical/ai/** (new)`
  - `src/sim/strategic/ai.ts, src/sim/strategic/ai/** (new)`
  - `tests/sim/ai/** (new)`
  - `scripts/sim-ai/** (new, headless matchup/autoplay runners)`
  - `docs/sprint1/sim-02/** (new)`
- **Read first:**
  - CLAUDE.md (purity), docs/STUDIO.md
  - docs/DESIGN_SPEC.md §6.1 (AI deployment), §6.3-§6.5, §6.4 (intent table), §6.14, §7.14, §10.3-§10.4 (difficulty, AI personalities), §13.3-§13.4
  - docs/GDD.md §9 (utility AI, hierarchical planning)
  - src/sim/tactical/battleai.ts, src/sim/tactical/battle.ts (runBattleAI/translateIntent call sites), src/sim/strategic/ai.ts, src/sim/strategic/world.ts
  - src/data/difficulty.ts (DIFFICULTY_DEFS, AI_PERSONALITY_DEFS), src/data/units.ts (counters)

**Spec**

Write the brains: same rules for player battles and autoresolve, readable intent orders, and rivals that feel like real kingdoms.

1. Battle AI (runBattleAI, called every AI_THINK_TICKS and during deployment): re-plan interval by difficulty (3 / 2 / 1.5 / 1 s); terrain-aware deployment (elephants front, spears line, archers 20 m behind, horse on wings, carts rear; high ground, river banks, forest concealment for ambushes); battle plans using the AI_PERSONALITY_DEFS battle profile (aggression = chance to attack vs hold, flanking share of mounted, reserve share held 150 m back until committed, withdrawAt -> withdraw_all); counters-aware target selection (bonusVs), protect archers, cavalry to flanks and against archers/engineers/carts, keep elephants off braced spears, archers focus elephants and chariots, skirmishers keep distance, pursuit of routers by mounted only, commander rally when it swings morale; siege attack (engineer works: rams, ladders, palisade; breach the gate; hold the breach 60 s) and defence (man walls and towers, repair gate, sally against rams); no cheating (forest-hidden formations unknown until 60 m unless scouted).

2. Intent translation (translateIntent, every 1 s, §6.4): hold_crossing, protect_formation, hold_high_ground (16-sample search), pin_enemy, screen_flank, pursue_routers, scout_area, escort_supply exactly as tabled.

3. Autoresolve: both sides AI; player-side aggression from army stance (0.75 / 0.5 / 0.3).

4. Campaign AI (runCampaignAI, daily): goal scoring defend / conquer / develop / stabilize / ally / secure_supply = personality weights x situation (threat, opportunity, hunger, unrest); war declaration rule (strength ratio x opinion term vs warRatio - aggression bonus; opportunist +0.3 against famine/revolt/recent defeat; respects truces/treaties); peace below peaceWarScore and acceptance via SIM-01 utility; economy (60 reserve days in the capital, granaries when spoilage occurs, labor and tax policy, market trades), construction via SIM-01 placement.autoPlace, recruitment up to 0.04 x population (x1.3 expansionist, x0.7 mercantile), age-up landmark choice by top weight, army operations (concentrate, supply-aware routes, avoid floods, sieges and relief, raids for raiders, defend threatened settlements), espionage by personality, event choices by aiWeight, rebel handling, difficulty knobs (aiIncome, recruit cost, aggression bonus, commander skill). Only StrategicCommands - never mutate state directly.

5. Determinism and perf: world/battle RNG only; runCampaignAI < 0.5 ms/day/faction; runBattleAI < 0.1 ms per think at 40 formations.

**Acceptance**

- [ ] npm run typecheck and npm test green incl. purity and determinism.
- [ ] tests/sim/ai/intents.test.ts: each of the 8 intents produces the tabled placement/behaviour on synthetic maps (e.g. hold_crossing puts spears across the ford axis at the near bank with archers 25 m behind).
- [ ] tests/sim/ai/matchups.test.ts (CI-light, >= 40 seeds each) meets DESIGN_SPEC §13.3 expectations; scripts/sim-ai/matchups.mjs runs the full 200-run version and writes docs/sprint1/sim-02/matchups.md with win rates and confidence intervals for every row.
- [ ] tests/sim/ai/campaign.test.ts: 3-year AI-only sandbox runs (6 factions, 4 seeds) with no treasury death spirals (treasury < 0 for > 60 consecutive days never happens), wars declared only per the rule, peace sued below peaceWarScore, at least one AI ages up when requirements hold; broken_crown default run still ends mixed on 6/6 seeds.
- [ ] tests/sim/ai/perf.test.ts: runCampaignAI < 0.5 ms/day/faction and runBattleAI < 0.1 ms/think (numbers in the report).
- [ ] An ?aivsai=1 battle and an AI-only sandbox year captured by SMOKE_PORT=4418 SMOKE_OUT=docs/sprint1/sim-02/smoke npm run smoke plus a short narrative of AI decisions (from the debug log) in docs/sprint1/sim-02/.

---

### GP-03 - WorldScene (strategic 3D map) & session flow: selection, placement, command card, control groups, minimap feed, engagements, events, hero missions, ages, autosaves

- **Team:** Gameplay - **Developer:** Gameplay Engineer — World Scene & Session Flow - **Reviewer:** Lead Gameplay Engineer
- **Priority:** 19 - **Port:** 4419 - **Depends on:** SIM-01, UI-02, GFX-02, GFX-04, GFX-05, GFX-06, GFX-01, GFX-03 - **Status:** TODO
- **Owned paths:**
  - `src/scenes/WorldScene.ts, src/scenes/common.ts, src/scenes/world/** (new)`
  - `src/app/session.ts, src/app/session/** (new)`
  - `tests/app/** (new), tests/scenes/world/** (new)`
  - `scripts/shots/gp-03.cjs (new), docs/sprint1/gp-03/** (new)`
- **Read first:**
  - CLAUDE.md, docs/STUDIO.md (§8 specs of GFX-01..06, UI-02, SIM-01)
  - docs/DESIGN_SPEC.md §2 (loop, transitions, autosaves, engagement queue), §8 (AoE layer UX end to end), §9.3-§9.6 (acts, objectives, outcomes), §11.1, §11.9, §12.1, §12.4 (world hint triggers), §12.6 (notifications, auto-pause)
  - docs/ARCHITECTURE.md §3, §9, §13 and 'Contracts v2'
  - src/scenes/WorldScene.ts, src/scenes/common.ts, src/app/session.ts, src/app/contracts.ts
  - the public APIs of render/environment, render/architecture, render/units, render/camera, render/world, ui/screens/world, sim/strategic selectors

**Spec**

Wire world command end to end (sim <-> render <-> UI) and implement the session that moves the player between modes.

1. Scene composition: environment rig driven by calendar hour, season and weather (GFX-01), terrain/water/weather/roads (GFX-02, loadHeightfieldAsync), vegetation (GFX-03), settlements with construction stages, damage, walls, landmarks and villagers (GFX-06), army tokens and banners (GFX-04), overlays (GFX-05), RTS camera with zoom bands and ZoomLookController feeding post/renderers; progressive loading behind the loading screen with ctx.assets.preload and per-asset fallbacks; audio listener/ambience/mood events.

2. Interaction: selection of settlements, armies and provinces; command card wiring (UI-02 props/actions) for building, recruiting, army orders; building placement controller (PC: ghost follows the cursor snapped to the grid, R rotates, left-click places, Shift-click queues, right-click/Esc cancels; touch: ghost at the best valid spot, drag, twist, tick/cross) using GFX-06 PlacementGhost + SIM-01 validatePlacement and issuing build with cell/rot; landmark placement via start_landmark; control groups for armies (Ctrl+1..9 etc.), idle hotkeys ('.' next settlement with idle builders, ',' next idle army, H capital); minimap data feed at 4 Hz + camera frustum; right-click minimap move; alerts (world:alert) from sim events.

3. Flow: engagement queue (oldest first, 'autoresolve all' when > 1; prompt pauses the world; fight -> BattleScene; retreat), event modal pausing per settings.autoPause, objectives tracker data, hint triggers (world.* keys of §12.4 via ui:hint), notifications and auto-pause rules (§12.6), age-up fanfare (camera flyTo the landmark, conch + drums stinger, new buttons light; a card instead under reduced motion), construction-complete feedback (dust, chime, toast), harvest/monsoon moments, hero mission availability -> mission card -> startHeroMission, scenario end -> scenario_results -> game_stats.

4. Session (src/app/session.ts): implement every GameActions/SessionView member incl. the CORE-01 optional ones (startHeroMission, completeHeroMission applying effects through SIM-01 applyHeroMissionResult exactly once, abandonHeroMission applying nothing, decidePrisoners, decideCapture, skipDeployment, pendingEngagements, heroMission, difficulty); autosaves on entering a battle, leaving a battle, entering hero mode and each new month (§2.3); load routes to the scene of the save; skirmish and sandbox flows; the world clock frozen during battle/hero.

5. debugCommand hooks for QA: 'world.select', 'world.place', 'world.flyTo', 'settlement.villagers', 'session.state'.

Perf: world render < 300 draw calls at strategic zoom and < 400 at settlement close zoom; 8x speed without sim spikes (sim < 2 ms/frame).

**Acceptance**

- [ ] npm run typecheck, npm test (tests/app/session.test.ts: engagement queue order, autosave triggers, hero mission effects applied once and only on completion, abandon applies nothing, load routes to the saved scene; tests/scenes/world/placement.test.ts for the placement controller state machine) and npm run build, npm run build:single pass.
- [ ] SMOKE_PORT=4419 SMOKE_OUT=docs/sprint1/gp-03/smoke npm run smoke passes (world, world-overview).
- [ ] scripts/shots/gp-03.cjs drives a scripted session and saves in docs/sprint1/gp-03/: world at strategic/operational/close zoom, settlement selected with the command card, placement ghost valid/invalid, the same building at 3 construction stages over time, an army route and engagement prompt, an event modal, the age-up fanfare frame, a mission card, phone 390x844 world HUD - reviewed by the Lead Gameplay Engineer.
- [ ] End-to-end script: start campaign -> resolve the prologue -> place a granary at Dhanyagram -> it completes -> recruit -> move the Royal Host -> engagement -> autoresolve -> save -> load: state hash identical before/after load (printed).
- [ ] Profile: world draw calls < 300 strategic, < 400 at Rajapura close zoom; no console errors throughout.

---

### UI-01 - Front-end & narrative UI: main menu + backdrop, loading screen, campaign/sandbox/skirmish setup, settings, save/load, hero dialogue/negotiation/mission screens, end-game statistics, tutorial hints

- **Team:** UI/UX - **Developer:** UI Engineer — Front-end, Narrative Screens & Statistics - **Reviewer:** Lead UI/UX Engineer (Art Director co-signs look)
- **Priority:** 20 - **Port:** 4420 - **Depends on:** CORE-01, UI-02 - **Status:** TODO
- **Owned paths:**
  - `src/ui/screens/menu.ts`
  - `src/ui/screens/frontend/**, src/ui/screens/narrative/**, src/ui/screens/stats/** (new)`
  - `src/ui/frontend/** (new: loading renderer, hints service, chart helpers)`
  - `src/scenes/MenuScene.ts`
  - `tests/ui/frontend/** (new)`
  - `scripts/shots/ui-01.cjs (new), docs/sprint1/ui-01/** (new)`
- **Read first:**
  - CLAUDE.md, docs/STUDIO.md
  - docs/DESIGN_SPEC.md §8.9 (statistics), §10.1-§10.3 (setup options), §11.5 (dialogue/negotiation UI), §11.6 (mission card/result, retry), §12.1-§12.5 (flows, screens, phone, hints, accessibility)
  - docs/ART_BIBLE.md §11, §12.3 (loading-screen composition); docs/art/ui_kit.html
  - src/ui/screens/menu.ts, src/scenes/MenuScene.ts, src/ui/components/** (UI-02), src/app/contracts.ts
  - src/data/{campaign,skirmish,statistics,tutorial,hero,difficulty,factions}.ts

**Spec**

Everything around play and the narrative cards of hero mode.

1. Main menu (§12.2): animated backdrop in MenuScene (Rajapura ghats at golden hour using the GFX-01/02/03/06 renderers at low cost, slow camera drift), buttons Continue / Campaign / Sandbox / Skirmish / Walk Rajapura / Load / Settings, version; phone stack >= 48 px.

2. Setup flows: campaign (scenario cards with heraldry, chapter, description, estimated length; difficulty segmented control with DIFFICULTY_DEFS descriptions), sandbox (SANDBOX_PRESETS chips, SANDBOX_RANGES sliders with help, faction picker with heraldry + playstyle, rivals multi-select, victory toggles), skirmish (two faction columns with composition previews, SKIRMISH_MAPS, sizes limited by tier, time, season/weather, difficulty, AI vs AI); phone wizard/accordion/bottom-sheet layouts.

3. Loading screen via UIManager.setLoadingRenderer (UI-02): key art when an 'image' asset exists, else a procedural composition (torana ornament, faction emblem, theme gradient); progress from scene:loading + assets:progress (bytes), rotating lore tips (SETTLEMENT_LORE, hints), a settlement card for hero visits.

4. Pause menu, settings (graphics: tier + 'auto' + detection reasons + per-knob QualitySettings overrides; audio buses; controls: Classic/Grid preset + rebinding with conflict detection via the UI-02 input API + hold-to-toggle; UI scale; accessibility: colour-blind mode, reduced motion, subtitles, relation colouring; hints; auto-pause options), save/load (slots with thumbnails and summaries, delete, export/import text).

5. Narrative screens (new *.screen.ts modules): mission_card (title, art, objectives, time of day, Begin/Later), hero_dialogue (letterbox, speaker names, subtitles, up to 5 choice cards with keys 1-5, clue-gated choices glow, disabled reasons), hero_negotiation (stance bar with win/lose marks, patience pips, noble portrait reactions, tactic cards with TACTIC_INFO icons, Reveal glow when a relevant clue is held, interests tooltip), mission_result (success/failure, effects summary, Try again / Accept the outcome).

6. Statistics (§8.9): game_stats with STAT_CATEGORIES tabs, every faction side by side (player first, best highlighted), TIMELINE_SERIES graphs (SVG/canvas), score breakdown (RULES.score); reachable from scenario results and the sandbox pause menu.

7. Tutorial hints (§12.4) as a UI service (*.service.ts): listens to ui:hint, TUTORIAL_HINTS priority order, once per profile (settings.hintsSeen), at most one per 20 s, card with an arrow anchored to the target element, default on for Chronicler/Minister.

Accessibility/perf as UI-02 (contrast, 44 px, safe areas, scale, no hover-only info).

**Acceptance**

- [ ] npm run typecheck, npm test (tests/ui/frontend/*.test.ts: setup forms produce valid SandboxSetup/SkirmishSetup, hint scheduler order/once/20 s rule, statistics table and score math, rebinding conflict detection) and npm run build, npm run build:single pass; SMOKE_PORT=4420 SMOKE_OUT=docs/sprint1/ui-01/smoke npm run smoke passes (menu, menu-mobile).
- [ ] scripts/shots/ui-01.cjs saves at 1280x720 and 390x844 in docs/sprint1/ui-01/: main menu with backdrop, the three setup flows, loading screen mid-progress, settings (graphics, controls rebinding, accessibility), save/load, mission card, dialogue with a clue-gated choice, negotiation mid-argument, mission result with retry, game_stats with a timeline graph, a tutorial hint card - reviewed with the Art Director.
- [ ] Automated contrast (>= 4.5:1 / 3:1) and touch-target (>= 44 px) checks on all captures pass (script output).
- [ ] Hints fire once per profile and never more than one per 20 s in a scripted session (asserted).

---

### GP-04 - BattleScene (field command): deployment, selection & orders, intents, readability, cinematic camera, sieges, results, benchmark mode

- **Team:** Gameplay - **Developer:** Gameplay Engineer — Battle Scene & Field Command - **Reviewer:** Lead Gameplay Engineer
- **Priority:** 21 - **Port:** 4421 - **Depends on:** GP-01, SIM-02, UI-02, GFX-02, GFX-04, GFX-05, GFX-06, GFX-01, GFX-03 - **Status:** TODO
- **Owned paths:**
  - `src/scenes/BattleScene.ts, src/scenes/battle/** (new)`
  - `tests/scenes/battle/** (new)`
  - `scripts/shots/gp-04.cjs (new), docs/sprint1/gp-04/** (new)`
- **Read first:**
  - CLAUDE.md, docs/STUDIO.md (§8 specs of GP-01, SIM-02, GFX-01..06, UI-02)
  - docs/DESIGN_SPEC.md §6 (esp. §6.1 deployment, §6.3-§6.5 orders/intents/stances, §6.6.5 sieges, §6.13 readability), §8.7-§8.8 (battle minimap, card, groups, touch), §12.2 battle rows, §12.4 battle hint triggers, §12.6
  - docs/ART_BIBLE.md §2 (bands), §12.1, §15
  - src/scenes/BattleScene.ts, src/sim/tactical/battle.ts, src/app/contracts.ts

**Spec**

Make field command play like a formation-based Age of Empires battle with Wukong-grade close-ups.

1. Composition: battle terrain window via loadHeightfieldAsync, environment from setup (hour/season/weather) through the GFX-01 rig, terrain/water/weather (GFX-02), vegetation (GFX-03), crowds/markers/banners/projectiles/FX (GFX-04), siege walls/gates/towers and segment damage from BattleState siege data rendered with GFX-06 wall kits, RTS + cinematic cameras and ZoomLook (GFX-05), audio battle intensity and listener.

2. Deployment (§6.1): scene starts paused; drag formations inside the zone (clamped), set facing/shape, 'Begin battle' or timer; deploy zones and hints.

3. Selection and orders: click, box, double-click same class, Ctrl+1..9 groups, select all; right-click move with right-drag frontage + facing preview; right-click enemy = attack; card/hotkey orders (hold, advance, attack, charge, flank with side, defend radius, withdraw, regroup, run toggle, stance) and shapes; Shift-queue with waypoint pins; intents page (8 intents with targets); radial wheel and simple presets on touch; commander Rally; speed/pause and auto-pause options (battle start, commander fallen, own formation routed).

4. Readability: formation cards and hover bars anchored via batched worldToScreen into battle_hud props at 10 Hz; selection/relation rings; routing arrows; minimap feed; event feed (routs, commander fallen); hint triggers (battle.* keys).

5. Cinematics: camera_toggle_cinematic frames the selected formation at 15-30 m with DoF; elephant charge shake within 60 m (reduced motion respected); impacts get sparks/dust.

6. Results and persistence: battle_results with prisoners decision and commander fate -> session.continueAfterBattle; mid-battle save/load (state lives in the engagement); world battles return to the world, skirmish to the menu.

7. Benchmark mode (?bench=1): deterministic scripted camera path over a ?soldiers=1000|5000 battle for 30 s of sim; debugCommand('bench.report') returns {drawCalls, triangles, renderPrepMs, simTacticalMs, simSoldiersMs, frameMs percentiles}; used by QA-01.

Budgets (ARCHITECTURE §15): 1,000 soldiers @high < 400 draw calls and < 2.5 M triangles; 5,000 @high < 500 and < 5 M; mobile medium 1,000 < 250 and < 800 k; mobile low 600 < 150 and < 400 k.

**Acceptance**

- [ ] npm run typecheck, npm test (tests/scenes/battle/*.test.ts: order gesture -> BattleCommand mapping incl. frontage from right-drag, deployment clamping, selection groups) and npm run build, npm run build:single pass.
- [ ] SMOKE_PORT=4421 SMOKE_OUT=docs/sprint1/gp-04/smoke npm run smoke passes (battle, battle-close, battle-river-5000, battle-mobile).
- [ ] scripts/shots/gp-04.cjs saves in docs/sprint1/gp-04/: deployment phase, order preview while dragging, queued waypoints, a cavalry flank in progress, a rout with arrows, an intent (hold_crossing) executing, a siege assault with ram at the gate and a breach, the cinematic camera on a melee, results screen, phone landscape with radial wheel - reviewed by the Lead Gameplay Engineer.
- [ ] Bench table from ?bench=1 at high and low for 1,000 and 5,000 soldiers meets the budgets above (draw calls, triangles; CPU ms reported, GPU ms not meaningful in SwiftShader).
- [ ] Scripted battle: deploy -> begin -> issue 10 orders -> save mid-battle -> load -> finish; outcome identical to an uninterrupted run with the same commands (hash printed).

---

### GP-02 - Hero mode: exploration, dialogue & negotiation runtime, five missions, Wukong-style focused melee (combo, heavy, roll i-frames, guard/parry, stamina, hit-stop), enemy AI, HeroScene

- **Team:** Gameplay - **Developer:** Gameplay Engineer — Hero Mode (Exploration, Missions & Melee) - **Reviewer:** Lead Gameplay Engineer (Creative Director co-reviews; Art Director co-signs visuals)
- **Priority:** 22 - **Port:** 4422 - **Depends on:** TA-06, GFX-05, GFX-06, GFX-04, UI-02, SIM-01, GP-03, UI-01, GFX-01, GFX-03 - **Status:** TODO
- **Owned paths:**
  - `src/hero/** (controller, animation, combat, enemies, dialogue, negotiation, missions + new)`
  - `src/scenes/HeroScene.ts, src/scenes/hero/** (new)`
  - `tests/hero/** (new)`
  - `scripts/shots/gp-02.cjs (new), docs/sprint1/gp-02/** (new)`
- **Read first:**
  - CLAUDE.md, docs/STUDIO.md (§8 specs of TA-06, GFX-01, GFX-04, GFX-05, GFX-06, UI-01, UI-02, SIM-01)
  - docs/DESIGN_SPEC.md §11 (all), §12.4 hero hints, §13.1 mission lengths, §10.3 hero difficulty columns, §1.2 Wukong table and scope guardrails
  - docs/ART_BIBLE.md §4.3 (hero moods), §9.5-§9.6, §12.2-§12.4 (hero camera, composition, opening cinematic)
  - src/data/hero.ts (HERO_DISTRICTS, HERO_CHARACTERS, DIALOGUES, NEGOTIATION_RULES, TACTIC_INFO, HERO_MISSIONS, HERO_COMBAT, HERO_ENEMIES, TRAINING_STEPS, MISSION_INSPECTABLES)
  - src/hero/hero.ts, src/scenes/HeroScene.ts

**Spec**

Build the cinematic showcase: walk Rajapura (and Tirthaghat) as Kumara Aditya, talk, negotiate and fight a small, polished melee set - inspection, negotiation and missions only (GDD §3 scope; no loot, levels or open traversal).

1. Avatar and locomotion: TA-06 skinned characters via ctx.assets.loadModel (procedural fallback rig when assets are off); AnimationMixer blend tree idle/walk/run/sprint with speed-matched blending and turn-in-place (turn_l/turn_r), root motion for attacks/roll, foot IK on steps/ghats (simple two-bone), runtime spring bones for x_cloth/x_hair chains; collision against layout colliders + heightfield; Meghavati exploration-only avatar for Giridurga (HERO_AVATARS).

2. City life: 22 HERO_CHARACTERS at district anchors +-30 m with idle loops; barks within 6 m (max one per 8 s); crowd density by district via the GFX-04 CrowdRenderer (WP5 townsfolk) that parts and bows (x_bow) for the prince; district mood blending (resolveHeroMood + lerpResolved, 40 m cross-fade) pushed to the GFX-01 rig with DoF focus; ambience layers per district (audio:ambience).

3. Interaction: Talk/Inspect prompts within 3 m; MISSION_INSPECTABLES set clue flags; dialogue runtime (DIALOGUES: requiresClue, effects applied once and recorded as dlg_<tree>_<choice>, startsMission) through UI-01 hero_dialogue; negotiation runtime exactly per NEGOTIATION_RULES (§11.5 table and formula: stance, patience, strong/weak/backfire/reveal, repeat penalty, hero diplomacy bonus) through UI-01 hero_negotiation; noble reactions (x_lean_in, x_cross_arms).

4. Missions (HERO_MISSIONS): The Walk to the Hall (shots c1-c7 via the GFX-05 cinematic director; time of day 6.2 -> 7.0 tied to route progress; three soft points of interest), The Hall of Pillars (win 3 of 4 houses), The Arms Yard (TRAINING_STEPS vs Ugrasena), Blades at the Royal Ghat (cinematic, 3 waves, 3 grain carts at 300 HP, palace guard allies on easy/normal, search the captain), Duel at the Oath Stone (dawn mist, Durjaya phases at 66% / 33% with bells, shallows spray, oath stone obstacle). Objectives, retry ('Try again' from the last wave / 'Accept the outcome'), mission_card/mission_result screens (UI-01), session.completeHeroMission(result) at the end only (GP-03).

5. Melee set (HERO_COMBAT / §11.7, frame data within 1 frame using TA-06 clipEvents): light 1-2-3 combo with cancels, tap and charged heavy, dodge roll 0.55 s / 4.5 m with i-frames 0.05-0.35 s and perfect dodge (0.6 s slow motion at 0.35x, next light counts as a finisher), guard (-75%, stamina cost per damage, regen x0.3, guard break 1.2 s), parry window by difficulty (0.28 / 0.18 / 0.14 / 0.11 s) with 1.4 s stagger, x2.5 riposte, 120 ms hit-stop and gold flash, salve (3 charges, +160 HP over 1.2 s, interruptible), lock-on (14 m, 1.2 rad, flick to switch), stamina 100 with regen 30/s after 0.6 s, hero HP 400 x difficulty, hit reaction 0.35 s, poise/stagger/finisher prompt; hit-stop freezes attacker and target animation for the listed ms; camera shake via camera:shake; impact VFX through GFX-04 FxSystem keys and weapon trails; hero:combat bus events for audio; reduced motion disables shake and slow motion and halves hit-stop.

6. Enemies (HERO_ENEMIES): Hired Blade, Raider Spearman (reach), Raider Archer (roof shots every 3 s), Raider Captain (unblockable, enrage at 50%), Vira Durjaya (3 phases: measured combos + shield bash; leaping unblockable overhead with red flash; shield thrown, faster, +20% damage, sweeping unblockable), Ugrasena (gentle sparring); attack tokens (max 2 attackers, others circle at 4-6 m and shout); every heavy/unblockable telegraphed 0.5-0.8 s.

7. HeroScene: Rajapura/Tirthaghat layouts from GFX-06 (districts), terrain/water from GFX-02, vegetation GFX-03, hero/cinematic cameras GFX-05, TAA + DoF (GFX-01), free 'Walk Rajapura' from the menu (no missions), hint triggers (hero.* keys), debugCommand hooks ('hero.startMission', 'hero.teleport', 'hero.setMood', 'hero.godmode').

Combat logic lives in pure, unit-testable modules (fixed 1/60 s combat step; no three imports in src/hero/combat/**).

Budgets: hero scene @high < 700 draw calls and < 3.5 M triangles; @medium < 350 and < 1.2 M.

**Acceptance**

- [ ] npm run typecheck and npm test (tests/hero/combat.test.ts: combo timing and cancels, i-frame window, perfect dodge, parry window per difficulty, guard stamina and guard break, poise/stagger, attack tokens; tests/hero/negotiation.test.ts: two well-chosen arguments (or reveal + strong) always win, wrong tactics exhaust patience; tests/hero/missions.test.ts: objectives, retry, effects only on completion) and npm run build, npm run build:single pass.
- [ ] SMOKE_PORT=4422 SMOKE_OUT=docs/sprint1/gp-02/smoke npm run smoke passes (hero shot).
- [ ] scripts/shots/gp-02.cjs saves in docs/sprint1/gp-02/: the 7 opening-cinematic shots, Aditya walking the ghats at dawn mist, the bazaar at golden dust with the crowd bowing, temple incense_dim interior, dialogue two-shot, negotiation screen mid-argument, ambush wave 2 with archers on roofs, parry flash frame, perfect-dodge slow motion frame, Durjaya phase-2 leap telegraph, phone landscape with combat buttons - reviewed by the Lead Gameplay Engineer and Art Director.
- [ ] Scripted playthrough via debugCommand: complete The Walk to the Hall, win the Hall of Pillars, finish the ambush and the duel; world flags/effects (court_won, seal_ring, duel_won, grain/legitimacy deltas) appear exactly once in the world state after returning (printed diff).
- [ ] Profile: hero scene @high < 700 draw calls / < 3.5 M triangles, @medium < 350 / < 1.2 M (getProfile numbers).

---

### AUD-01 - Procedural audio: adaptive raga-inspired score, district & world ambience, full SFX set, spatial 3D audio and mixing

- **Team:** Audio - **Developer:** Audio Developer — Procedural Score, Ambience & SFX - **Reviewer:** Lead UI/UX Engineer (audio)
- **Priority:** 23 - **Port:** 4423 - **Depends on:** CORE-01 - **Status:** TODO
- **Owned paths:**
  - `src/audio/** (audio.ts + new synth/, music/, ambience/, sfx/, spatial/ modules)`
  - `tests/audio/** (new)`
  - `scripts/audio/** (new: offline render + spectrogram tools)`
  - `docs/sprint1/aud-01/** (new)`
- **Read first:**
  - CLAUDE.md (no asset files - procedural WebAudio), docs/STUDIO.md
  - docs/ARCHITECTURE.md §12; src/core/events.ts (SFX_KINDS, audio:* events incl. CORE-01 additions)
  - docs/DESIGN_SPEC.md §8.4 (age-up fanfare), §8.2 (construction chime), §6.13, §11.2 (district ambience keys), §11.6-§11.7 (duel bells, melee sounds), §12.5 (hearing accessibility), §14.3 Lead UI/UX item 5
  - src/data/hero.ts (HeroDistrictDef.ambience), src/audio/audio.ts

**Spec**

All sound is synthesized at runtime with WebAudio (no files) and must feel cinematic and period-appropriate.

1. Music: a procedural score engine - raga-inspired modes per mood (e.g. a Bhairav-like dawn, Yaman-like evening, Kafi-like calm), tanpura drone (additive/Karplus), bansuri (noise-excited sine with vibrato and meend glides), plucked veena/sitar-like voices (Karplus-Strong with sympathetic strings), pakhawaj/mridangam/dhol membranes, conch, temple bells (inharmonic partials); tala cycles (teental 16, rupak 7); adaptive layers driven by audio:mood + intensity (menu, world calm/war, battle rising with engagement, siege, hero_explore by district, hero_combat, duel with phase bells, victory/defeat), audio:stinger (age_up, landmark_complete, construction_complete, harvest, battle-start conch, duel phase bells); seeded variation so loops never feel repeated.

2. Ambience: layers from audio:ambience keys (all HeroDistrictDef.ambience values: river, far bells, boatmen, crows, threshing, scribes, ox-carts, crowds, hawkers, copper, cart bells, low chanting, dripping water, court murmur, fountain, far conch, drill drums, elephant rumble, blades, potters' wheels, looms, children), world beds by season/weather/time (wind, monsoon rain, thunder 1-4 s after lightning, dawn birds, night crickets), battle bed (crowd roar scaled by engaged soldiers, distant drums).

3. SFX: every SFX_KINDS entry incl. the CORE-01 additions (melee light/heavy swings, hits on cloth/metal, parry ring, block thud, roll cloth, stagger grunt, salve; UI; orders; volleys/impacts; elephant trumpets; construction, market, harvest; gate break, wall crumble, ram hits; fire; footsteps by surface), with per-trigger random variation.

4. Spatial: PannerNode HRTF on high/ultra, equalpower on low/medium; listener from audio:listener; distance attenuation + air absorption low-pass; positional audio:sfx; voice pooling and priorities (cap 16 low / 32 medium / 48 high), ducking (dialogue and UI duck music), buses master/music/sfx/ambience/ui from settings; resume on first gesture; ?noaudio=1.

5. Keep DSP in pure functions over Float32Array (testable in node) with thin WebAudio adapters (AudioWorklet where it helps).

Budget: audio CPU < 1 ms/frame main thread on PC, < 2 ms mobile; no allocations per sfx trigger after warm-up.

**Acceptance**

- [ ] npm run typecheck, npm test (tests/audio/*.test.ts: every SFX_KINDS entry renders offline in node without NaN/denormals, peak <= -1 dBFS, music bus RMS within the target window per mood, loops seamless at their boundaries, voice cap and priority stealing) and npm run build, npm run build:single pass.
- [ ] scripts/audio/render.mjs writes WAV renders (30 s per music mood, each ambience key, all SFX) and spectrogram PNGs to docs/sprint1/aud-01/; the reviewer inspects the spectrograms (no clipping bands, distinct timbres) and the Lead UI/UX listens to the WAVs.
- [ ] SMOKE_PORT=4423 SMOKE_OUT=docs/sprint1/aud-01/smoke npm run smoke passes with no console errors (audio enabled in the headless run must not throw).
- [ ] Main-thread audio time < 1 ms/frame in a battle capture (profiler 'audio' system, printed).

---

### QA-01 - QA automation: Playwright playthroughs, determinism/save/economy/morale suites, balance harnesses, perf benchmark (1,000 / 5,000 soldiers), smoke shots, GDD §15 sign-off

- **Team:** Tools & QA - **Developer:** QA Engineer — Automation, Determinism, Balance & Performance - **Reviewer:** QA Lead
- **Priority:** 24 - **Port:** 4424 - **Depends on:** CORE-01, TA-07, GFX-01, TA-01, SIM-01, TA-05, GP-01, TA-02, GFX-02, TA-03, GFX-04, TA-04, GFX-05, TA-06, UI-02, GFX-06, GFX-03, SIM-02, GP-03, GP-04, GP-02, UI-01, AUD-01 - **Status:** TODO
- **Owned paths:**
  - `tests/qa/**, tests/perf/** (new)`
  - `tests/integration/** (CTO-seeded; QA owns it per CLAUDE.md)`
  - `scripts/qa/** (new), scripts/bench.cjs (new)`
  - `scripts/smoke.cjs (SHOTS list only; CTO grant)`
  - `docs/qa/** (new), docs/sprint1/qa-01/** (new)`
- **Read first:**
  - CLAUDE.md, docs/STUDIO.md (whole board + every acceptance list)
  - docs/GDD.md §15 (MVP checklist), docs/DESIGN_SPEC.md §13 (balance targets and QA checks), §12.5 (accessibility)
  - docs/ARCHITECTURE.md §6, §14, §15 (budgets), §16 (MVP -> modules)
  - scripts/smoke.cjs, tests/integration/determinism.test.ts, src/core/debug.ts / src/app/debugApi.ts (window.__SAMRAJYA__ incl. call/showScreen)

**Spec**

Prove the MVP works, stays deterministic and meets budgets, and leave automation the integration engineer can rerun.

1. Playwright playthroughs (scripts/qa/*.cjs, headless Chromium SwiftShader args from CLAUDE.md, unique port 4424): (a) campaign: menu -> campaign setup -> prologue event -> place and complete a granary -> recruit -> move army -> engagement -> fight the battle (deploy, orders) -> results -> hero mission (Walk to the Hall) -> save -> load (hash equal) -> quit; (b) skirmish 1,000 and 5,000; (c) sandbox one year at 8x; (d) phone 390x844 low tier versions of (a) and (b) with touch events; (e) colour-blind and reduced-motion passes; every run fails on console errors, page errors, crash reports or missing requests (except ?assets=off runs) and saves screenshots to docs/sprint1/qa-01/.

2. Determinism and save suites (tests/integration/**): world 2 years same hash across runs and across timeScale 1/4/8; save -> load -> continue == uninterrupted at day 100 with sieges, rebels and construction in flight; battle resume during deployment / melee / siege; autoresolve reproducible; v1 fixture saves (CORE-01) still load; hero mission results deterministic.

3. Balance harnesses (tests/qa + scripts/qa): DESIGN_SPEC §13.2 economy targets on the real sim; §13.3 matchup table (200 runs per row via SIM-02's runner) with pass/fail; §13.4 campaign autoplay per victory path (conquest, hegemony, prosperity sketches of §9.7) and the default run; morale model checks (commander killed at minute 2 raises rout probability by ~30 points).

4. Perf benchmark (scripts/bench.cjs): drives ?scene=battle&bench=1&soldiers=1000|5000 at high and low (GP-04 bench mode), the world at strategic and close zoom and the hero scene; collects draw calls, triangles, render.prep, sim.tactical, sim.soldiers, UI ms via getProfile/debugCommand; writes docs/qa/perf/<date>.md + .json; exits non-zero when ARCHITECTURE §15 draw-call/triangle budgets are exceeded (CPU ms are recorded, GPU ms flagged as not representative in SwiftShader).

5. Smoke: extend scripts/smoke.cjs SHOTS with stable names for the new features (world-close, placement, construction, siege, cinematic, hero-combat, hero-dialogue, negotiation, stats, settings-mobile, assets-off-world) without renaming existing shots.

6. docs/qa/SPRINT1_QA.md: GDD §15 checklist with evidence links, defects filed per owning ticket with repro steps, budget table, balance table.

**Acceptance**

- [ ] npm run typecheck and npm test green including the new tests/integration/** and tests/qa/** suites (runtime of npm test stays < 5 minutes; long harnesses live in scripts/qa).
- [ ] node scripts/qa/playthrough-campaign.cjs, playthrough-skirmish.cjs, playthrough-sandbox.cjs and the phone/accessibility variants pass with no console errors; screenshots in docs/sprint1/qa-01/ reviewed.
- [ ] node scripts/bench.cjs produces docs/qa/perf/<date>.md/.json and passes the ARCHITECTURE §15 draw-call/triangle budgets for 1,000 and 5,000 soldiers at high and 600/1,000 at low/medium.
- [ ] Balance report: §13.2 targets, §13.3 matchup rows and §13.4 campaign paths each marked pass/fail with numbers; failures filed to SIM-01/SIM-02/GP-01 with exact repro seeds.
- [ ] npm run smoke (SMOKE_PORT=4424) passes with the extended SHOTS list; docs/qa/SPRINT1_QA.md maps every GDD §15 item to evidence.


## 9. Client change request 2026-10-30 (Studio Head)

Client: "Need real humans and maps should be like real country." Changes to Sprint 1:

| ID | Change |
|---|---|
| **MAP-01** (new, pri 5, port 4425) | Real Indian subcontinent geodata pipeline (Natural Earth, public domain) -> strategic heightfield, rivers, coast, biome masks. Developer: Geodata & World Terrain Engineer; reviewer: CTO; co-signs: Art Director, Creative Director. Depends on CORE-01. |
| **MAP-02** (new, pri 7, port 4426) | Real places: janapadas, ancient cities at real coordinates, trade routes, campaign/presets remapped; ruling houses stay fictional (GDD §7). Developer: World Designer (Creative Director team); reviewer: Lead AI & Simulation Engineer; co-sign: Creative Director. Depends on MAP-01, SIM-01. |
| TA-05, TA-06 (amended) | Realistic humans from the MakeHuman CC0 base mesh/targets; crowd LOD0 4-6k tris, hero LOD0 40-70k with facial blendshapes, eyes, hair cards; realistic motion. |
| GFX-04 (amended) | Human skin/cloth shading for VAT crowds; LOD policy and re-measured budgets. |
| GFX-02, GFX-05, GFX-06, GP-03, GP-04, QA-01 | Now also depend on MAP-01/MAP-02; render/use the real map. |

Source-data policy (CLAUDE.md): CC0 / public-domain source data may be vendored under `tools/vendor/<source>/` with LICENSE + PROVENANCE.md.
