# UI-02 - In-game HUD, command card, minimap, control groups, battle and hero HUD, input presets and touch

OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI/UX team). Reviewer: Lead UI/UX Engineer
(Art Director co-signs the visuals).

The in-game UI of DESIGN_SPEC §8 / §12 on the ART_BIBLE §11 / §17 theme: the UIManager framework (layers, lazy
screens, discovered `*.screen.ts` / `*.service.ts`, tooltips, HUD command bus, scene feeds, layout modes, UI scale,
accessibility datasets, UI + input CPU counters), the world HUD with the AoE command card, minimap and control
groups, the settlement / army / province drawers, realm screens, prompts, the four AoE screens (build placement,
market, ages, economy), the battle HUD (deployment, cards strip, three card pages, rally ring, simple presets, radial
wheel, floating formation cards) and results, the hero HUD, and the input layer (Classic / Grid key presets, hero
override, rebinding API, touch gestures).

## How to reproduce

| What | Command |
|---|---|
| Typecheck | `npm run typecheck` |
| UI + input tests (DOM shim, no jsdom) | `npx vitest run tests/ui/hud tests/input` |
| Evidence (every image below, audits, profiler) | `NODE_PATH=$(npm root -g) node scripts/shots/ui-02.cjs` (port 4415, builds into `.build/ui-02`; `--only=world,battle,hero,assetsoff`, `--vp=pc,portrait,landscape`, `SHOTS_SKIP_BUILD=1`, `SHOTS_OUT`) |
| Single-file build | `npx vite build --mode single --outDir .build/ui-02-single --emptyOutDir` |
| Smoke | `SMOKE_DIST=.build/ui-02 SMOKE_PORT=4415 SMOKE_OUT=docs/sprint1/ui-02/smoke npm run smoke` |

The capture script also runs the automated checks: text contrast measured on the captured pixels (>= 4.5:1 body,
>= 3:1 large text; disabled controls exempt; with a modal open only the modal layer counts, since the HUD below sits
under its backdrop), every interactive element >= 44 x 44 px on the phone captures, no console / page errors, failed
requests or crash reports, Esc closing the radial wheel without opening the pause menu, `?assets=off`, and the UI +
input CPU budget. All results with observed values: `shots-report.json`.

## Evidence images (every image described)

59 captures: each screen at 1280 x 720 (`-pc`), 390 x 844 portrait (`-portrait`, quality low, touch) and 844 x 390
landscape (`-landscape`). World: The Broken Crown, seed 7, Suvarna Kingdom (Rajapura). Battle: 1,000-soldier plains
skirmish, seed 7. Hero: Rajapura streets. All captured by `scripts/shots/ui-02.cjs` after the critique fixes listed
further down; every one was opened and looked at.

### World HUD and command card

| Image | What it shows |
|---|---|
| `world-settlement-economy-pc` | Full world HUD with Rajapura selected. Top bar: realm emblem, name and age; six resources (grain 2,91,500 -416/d, timber 600 +16/d, stone 300, wealth 4,000 +683/mo, villagers 17,370 with the idle-builders badge 5, recruits 1,158 +191/mo); date, season, weather; pause + 1x/2x/4x/8x; menu. Realm buttons (Chronicle badge 1). Act I objectives. Rotating minimap with terrain, borders, roads and the N marker. Bottom: selection info (population, grain reserve days in reserve colour, loyalty, order) with Govern / Visit, and the Economy tab of the 5 x 3 card: Fields L3, Canal, Granary L2, Tank, Stepwell / Market L2, Workshop L2, Quarry (disabled - no deposit), Harbor, Station / Treasury, Trade; Classic hotkeys Alt+Q..B in the corners. |
| `world-settlement-recruit-pc` | Same, Recruit tab: Spears, Archers, Guards, Horse, Chariots / Elephants, Engineers, Scouts, Supply at their `UnitDef.commandSlot`, Rally point on slot 14. |
| `world-settlement-*-portrait` / `-landscape` | Phone layouts. Portrait: two-row top bar (Grain / Wealth / Recruits + expand chevron + menu; date + pause/1x/2x/4x), minimap and objectives behind 48 px buttons, realm buttons as a right column, the card as a bottom sheet with icon-over-label tabs. Landscape: one-row top bar, realm buttons in a row, compact card docked bottom-right (48 px slots) so the map stays visible. |
| `world-army-card-pc` | Royal Host selected: food / morale meters, and the army card - Move, Attack, Besiege, Garrison, Raid / Forage, Retreat, Bold, Steady (current, highlighted), Wary / Forced, Split, Merge, Disband (confirm), Visit. |

### Drawers, AoE screens, realm screens and prompts

| Image | What it shows |
|---|---|
| `settlement-panel-pc` | Settlement drawer (right, under the realm buttons): eight vitals with a why-tooltip each (population / housing, grain days + stored, grain price, water / irrigation, loyalty, unrest stage, public order, health / sanitation), labor sliders with -/+ steppers (sum <= 100%), tax slider; the command card stays usable on the left with the selection info hidden. Phones: a bottom sheet (portrait) / right panel under the top bar (landscape), steppers instead of range sliders. |
| `army-panel-pc` / phones | Army drawer: commander portrait (monogram on a darkened faction colour, role badge) with skills, supply (27 days, 4,575 / 4,575, 170 a day) with the line state and its source, stances (Steady active) + forced march, unit rows with strength / morale bars and the split selection. |
| `build-placement-*` | Placement HUD for a granary (props pushed by the script until GP-03 drives the ghost): costs, "Needs flat ground inside the walls" (invalid), facing east (rot 1), keys LMB / Shift / R / RMB-Esc on PC; on phones the card, objectives and realm buttons step aside and the cross / rotate / tick buttons (64 px, tick disabled while invalid) sit at the bottom. |
| `market-*` | Market opened from the Economy tab "Trade" slot: grain / timber / stone with stock, buy / sell price per lot, fairness factor, price sparkline (flat at day 0: no history yet), Buy / Sell, x5 lots toggle (Shift-click on PC; the phone hint names the toggle). |
| `age-panel-*` | Ages and landmarks: carved banner (II Mahajanapada Age, next III Samrajya), requirements checklist (met green, unmet red), unlock bonuses in words, the two landmark cards (cost chips, red when short; "The age requirements are not met yet" on the locked Choose site). |
| `economy-panel-*` | Treasury and granaries: ledger last month / projected, tax policy (Lenient / Standard / Heavy / Emergency with factors), royal reserve + Hold the reserve, rationing, granary rows with reserve days by colour. |
| `diplomacy-*` | Realm list with opinion / trust / treaty icons, Giridurga (at war) selected: Peace / Ceasefire composer and the AI reply from `evaluateAcceptance` with its reasons ("They fear your army (+20)", "They think ill of you (-13)", "They are wary of a peace (-10)"). Phones: list and detail as two steps with an "All realms" back button. |
| `minimap-world-*` | The minimap element: terrain hillshade bitmap, faction territories (hatched when contested), roads, settlements by relation (capital star, selection ring), armies, the N marker on the rotating rim, north-up toggle. Phones: opened from its 48 px button. |
| `event-modal-*` | "The Broken Crown" (reached by stepping the campaign): illustration band, narrative text, countdown with the default choice, choice card with its consequence. Parchment modal; full-screen on portrait. |
| `engagement-prompt-*` | Battle is Joined at Shilapur (the Royal Host ordered to attack the Host of the Seven Peaks): both sides with commanders and soldiers, "You" tag, win chance bar with the 50% mark, expected losses, advisor factors, Take command / Let the generals decide / Retreat. Phone toasts wait while the modal is open. |

### Battle HUD, radial wheel, results

| Image | What it shows |
|---|---|
| `battle-deployment-*` | Deployment: forces bar (both realms, soldiers, strength and morale bars), DEPLOYING clock, speeds (0.5x..8x on PC, 1/2/4x on phones), the deployment bar with the countdown and Begin battle, the formation cards strip (class icon, count, strength / morale bars, morale with its cause, fatigue tier, ammo pips, experience chevrons, current order), the Orders page of the card on PC (Hold H, Advance T, Attack X, Charge C, Flank Y / Defend U, Withdraw B, Regroup G, Run N, Stance M / Line J (current), Column I, Square O, Wedge P, Loose K - disabled for these troops) + Select all; simple presets (Line up / Archers behind / Horse to the wings / More) on phones; the battle minimap with both deploy zones; Rally ring button. |
| `battle-live-*` | 30 s into the battle, two Royal Levy blocks selected (gold cards), morale causes ("general nearby"), floating formation cards over the troops and compact bars over the enemy (anchors computed by the capture script from the RTS camera model until GP-04 pushes `battle_hud.anchors`), Rally ring ready. Phones: rally above the strip, presets row, card behind More. |
| `battle-radial-*` | The touch radial wheel (long press): inner ring = the nine orders + stance, outer ring = six shapes + eight intents (Pursue and Loose disabled with their reasons), cancel in the centre; the HUD below dims behind it. 50 px items, no overlap, fits the 390 px phone. Esc closes it without opening the pause menu (checked). |
| `battle-intents-pc` | Tab moved the card to the Intents page: Crossing, Protect, Heights, Pin, Screen / Pursue (disabled: "Only horse, chariots and scouts pursue"), Scout, Escort, Clear (disabled: no intent); Classic Alt+letters. |
| `minimap-battle-*` | Battle minimap: hillshaded battle window, formations by side with facing, selection. |
| `battle-results-*` | The same battle stepped to its end (withdrawal at 9:28): Victory banner with the summary, per-side table (started / survived / killed / captured / in pursuit; the last two columns hidden on portrait), the player's formations (start -> survivors, experience gained, routed), commander fates, chronicle line, Return to Menu. |

### Hero HUD

| Image | What it shows |
|---|---|
| `hero-explore-*` | Exploring Rajapura (v2 props patched until GP-02 pushes them): objective with the place, compass strip on a dark band (E / SE / S), prompt bubble at its anchor ("Speak with the potter", E key / tap), caption with the speaker, key hints on a pill (PC), Leave. Phones: move stick, look-drag hint, 76 px interact button. |
| `hero-combat-*` | Combat with Durjaya: HP / stamina / salve pips, boss bar with poise (name red: unblockable telegraphed, red edge flash), enemy bars with names over their heads, lock-on reticle. Phones: attack (84 px), heavy, roll, guard, salve (charges badge), lock buttons. |

## Critique loop (screenshot -> read -> fix)

Every capture was opened after each run; what the images showed and what changed:

1. Resource bar wrapped to a second row hidden behind the objectives at 1280 px -> recruits show the pool only (limit
   in the tooltip), big trends lose the decimal, season name without the English gloss (in its title), tighter chips
   and speed buttons: one row at 1280.
2. Settlement drawer covered the realm buttons and clipped the right-hand labor sliders -> drawer starts under the
   realm buttons, 460 px wide, labor sliders in one column; the bottom card moves left and drops its selection info
   while a drawer is open.
3. Current stance looked disabled (dimmed) -> active + disabled slots keep full opacity with the gold glow.
4. Placement HUD said "facing west" for rot 1 -> facing labels follow theta = rot x PI/2 (south, east, north, west).
5. Age panel said "Mahajanapada Age Age" and printed camelCase bonus keys -> name used as is, keys in words.
6. Duplicate "Market" slot (building and screen) -> the screen slot is "Trade" with the coins icon.
7. Contrast audit: portrait monogram (2.35:1 on saffron) -> faction colour darkened under the monogram; landmark cards
   (3.6-4.0:1 on the carved gradient) -> deeper sandstone variant; hero HUD text over a bright sky (compass marks
   1.0-2.0:1, key hints 2.6:1, enemy names 3:1) -> dark band / pills behind them; control-group slots over the map ->
   solid backgrounds.
8. Radial wheel: 15 overlapping inner items (shapes duplicated) -> orders + stance inside (10), shapes + intents
   outside (14), radii 94 / 160 px; Esc closed the wheel and opened the pause menu behind it -> the wheel swallows Esc
   in the capture phase.
9. Phones: speed buttons wrapped under the objectives, tabs clipped ("conomy"), landscape card covered 60% of the
   map, toasts covered modal titles, the placement buttons sat on the card, the sheet handle was 22 px tall, objectives
   panel open over the map, rally button over the cards strip -> two-row top bar, icon-over-label tabs, compact
   right-docked landscape card and right-panel drawers, toasts wait while a modal is open, card / objectives / realm
   buttons step aside while placing, 44 px handle, objectives collapsed behind a 48 px button (and hidden while the
   minimap is open), rally above the strip.
10. The audit found the hero touch overlay swallowing every tap (an invisible full-screen box) -> full-width HUD
    containers are `.passive`; the capture script now checks that open map areas reach the game.
11. Second pass on the phones: the portrait deployment bar hid behind the cards strip -> under the top bar; hero vitals
    and boss bar overlapped -> stacked (portrait) / vitals top-left (landscape); landscape slot hotkeys collided with
    level badges -> hidden on touch landscape (kept in tooltips); the landscape engagement prompt pushed its buttons
    below the fold -> no torana ornament, compact sides; a toast covered the prompt title -> toasts drop to the
    bottom edge while a modal is open; the unblockable red boss name measured 4.2:1 over the sky -> opaque band.

## Hand-off: public APIs for the scenes (GP-02 / GP-03 / GP-04) and other screens

- `ctx.ui.commands` (`src/ui/services/hudCommands.ts`): `place_building {settlementId, building, repeat}`,
  `place_landmark {settlementId, landmarkId}`, `placement {action: confirm|cancel|rotate}`, `army_target {armyIds,
  order}`, `rally_point_target {settlementId}`, `battle_target {formations, intent}`, `minimap_move {x, z}` -
  subscribe with `ctx.ui.commands.on(kind, fn)`; enter `ctx.input.setMode('placement' | 'targeting')` meanwhile.
- `ctx.ui.feeds.setCamera(groundQuad, heading)` (RTS camera: heading = yaw + PI) and `setWorldGroups([{group,
  label, count}])` for the minimap frustum and the world control-group row.
- `battle_hud.deployment / rally / anchors` and `hero_hud` v2 fields are rendered as soon as they are pushed (the
  battle HUD derives deployment and rally from BattleState meanwhile).
- `hudOptions.idleHotkeys` (`src/ui/screens/world.ts`): set false if the world scene handles `.` `,` H itself.
- Input: `ctx.input.preset`, `setContext`, `setMode`, `setCardPage`, `setSelectionHitTest`, `injectAction`,
  `pressAction / releaseAction / isHeld / heldFor / releasedFor` (hero holds), `setVirtualStick`; rebinding API
  `rebind / resetBinding / unbind / findConflicts / rebindableActions` in `src/input/bindings.ts`.
- Shared components for other screens: `src/ui/components/index.ts` (icons, meters, tabs, slider / stepper,
  sparkline, portrait, panel frame, tooltips, CommandGrid, Minimap); `clockGate` / `uiClock` in `src/ui/dom.ts`.
- QA: `window.__SAMRAJYA_UI__` (`patch`, `emit`, `action`, `press / release`, `setPreset`, `props`, `visible`,
  `commands`, `setCamera`, `setWorldGroups`, `profile`, `bench`).

## Checks and measurements (from `shots-report.json`)

| Check | Result |
|---|---|
| UI + input CPU, world HUD 1280 x 720, Rajapura selected (60 fps virtual timeline, `__SAMRAJYA_UI__.bench`, 10 s in 2 s chunks, prompts answered between) | 1x: avg 0.077 ms / frame (p95 0.4, max 12.5 when the settlement card recomputes); 4x: avg 0.133 ms (p95 1.5, max 16.9) - budget < 1 ms |
| UI + input CPU, battle HUD 1280 x 720, two formations selected | 1x: avg 0.051 ms / frame (p95 1.5, max 4.7); 4x: avg 0.012 ms (p95 0, max 2.7) |
| Live profiler EMA under SwiftShader (`uiInput.ms`, for transparency) | world 3.23 ms, battle 2.42 ms per frame - SwiftShader renders ~1 frame/s, so every frame carries a full HUD refresh; at 60 fps the throttles spread that work (HUD <= 10 Hz, settlement card <= 2 Hz, top bar <= 2.5 Hz, minimap layers <= 4 Hz world / ~8 Hz battle) |
| Contrast (measured on the pixels, every visible text run) | 1839 text runs on 53 full-screen captures, 0 below the threshold |
| Touch targets on phone captures | 441 interactive elements on the 34 full-screen phone captures, 0 below 44 x 44 px |
| Esc closes the radial wheel without the pause menu | ok on all three viewports |
| Open map areas pass pointer events to the game | ok (world, battle, hero, every viewport) |
| Event modal / engagement prompt reached by stepping the campaign | ok (every viewport) |
| Battle stepped to its outcome, results shown | ok (withdrawal at 9:28) |
| `?assets=off` world HUD | ok, no errors |
| Console errors / page errors / failed requests / crash reports | none in any session |

Builds: `npx vite build --outDir .build/ui-02` and `--mode single --outDir .build/ui-02-single` (2.6 MB one-file
HTML) both succeed. Smoke: `docs/sprint1/ui-02/smoke/` (all 14 smoke shots passed, no console errors).

## Requests to other owners (not edited here)

- Lead Gameplay Engineer / GP-03 (`src/scenes/WorldScene.ts`): consume `ctx.ui.commands` (`place_building` /
  `place_landmark` -> placement ghost with `ctx.input.setMode('placement')` and `ui.show('build_placement', ...)`
  while placing; `placement` confirm / cancel / rotate from the touch buttons; `army_target`, `rally_point_target`,
  `minimap_move` -> targeting mode and the matching strategic command); push `ctx.ui.feeds.setCamera(groundQuad,
  cam.yaw + Math.PI)` at 4-10 Hz and `setWorldGroups(...)` when army control groups change;
  `ctx.input.setSelectionHitTest(...)` for drag-from-selection.
- Lead Gameplay Engineer / GP-04 (`src/scenes/BattleScene.ts`): push `battle_hud.deployment`, `rally` and `anchors`
  (batched worldToScreen at 10 Hz); consume `battle_target` and `minimap_move`; open the pause menu on `menu` only
  (today `cancel` also pauses, so a mode cancel pauses the game - the radial wheel already swallows its own Esc).
- Lead Gameplay Engineer / GP-02 (`src/scenes/HeroScene.ts`, `src/hero/**`): push the `hero_hud` v2 fields
  (`promptAnchor`, `objective`, `compassHeading`, `caption`, `combat`, `touchControls`); read hero holds with
  `ctx.input.isHeld / heldFor / releasedFor` and the touch stick from the input frame.
- CTO (`src/core/profiler.ts`): an API for external per-system milliseconds (e.g. `profiler.addSystemMs('ui', ms)`)
  so UI + input appear in the F3 system list next to the counters `ui.ms`, `input.ms`, `uiInput.ms`, `uiInput.maxMs`.
- Art Director (`src/ui/theme.css`): adopt the HUD icon set (`ICON_PATHS_HUD` in `src/ui/components/icons.ts`) and the
  two contrast variants made locally in `hud.css` (`.panel.carved.landmark-card` deeper sandstone; darkened faction
  colour under portrait monograms) as theme tokens; consider a lighter `--ui-danger` for small text on dark panels
  (measured 4.4-4.6:1 at 12 px).
- Lead AI & Simulation Engineer (SIM-01 `src/sim/strategic/selectors.ts`): memoize `buildOptions` per settlement per
  day - its placement search is the 12-17 ms one-frame spike in the world bench (the HUD already calls it <= 2 Hz).

## Known issues

- The scene pushes the HUD expects are not there yet (GP-02 / GP-03 / GP-04): floating formation cards use anchors the
  capture script computes from the RTS camera model (ground height taken as 0), the build placement HUD and the hero
  v2 fields are pushed by the script, the world control-group row and the minimap camera frustum stay empty until
  the world scene feeds them. Everything renders as soon as the props / feeds arrive.
- The cards strip scrolls sideways when a host has more formations than fit; there is no scroll hint yet.
- `npm test` in this tree has 5 failures outside UI-02 (strategic siege / politics, contracts migration, SIM-02
  campaign AI) that come with the SIM-02 / snapshot commits after `5829cd1` (they pass on a clean export of
  `5829cd1`, fail on a clean export of HEAD); every UI and input suite passes.
