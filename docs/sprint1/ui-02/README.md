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

75 captures (round 2 final run, 2026-10-31): each screen at 1280 x 720 (`-pc`), 390 x 844 portrait (`-portrait`, quality low, touch) and 844 x 390
landscape (`-landscape`). World: The Broken Crown, seed 7, Suvarna Kingdom (Rajapura). Battle: 1,000-soldier plains
skirmish, seed 7. Hero: Rajapura streets. All captured by `scripts/shots/ui-02.cjs` after the critique fixes listed
further down; every one was opened and looked at.

### World HUD and command card

| Image | What it shows |
|---|---|
| `world-settlement-economy-pc` | Full world HUD with Rajapura selected. Top bar: realm emblem, name and age; six resources (grain 2,91,500 -416/d, timber 600 +16/d, stone 300, wealth 4,000 +683/mo, villagers 17,370 with the idle-builders badge 5, recruits 1,158 +191/mo); date, season, weather; pause + 1x/2x/4x/8x; menu. Realm buttons (Chronicle badge 1). Act I objectives. Rotating minimap with terrain, borders, roads and the N marker. Bottom: selection info (population, grain reserve days in reserve colour, loyalty, order) with Govern / Visit, and the Economy tab of the 5 x 3 card: Fields L3, Canal, Granary L2, Tank, Stepwell / Market L2, Workshop L2, Quarry (disabled - no deposit), Harbor, Station / Treasury, Trade; Classic hotkeys Alt+Q..B in the corners. |
| `world-settlement-recruit-pc` | Same, Recruit tab: Spears, Archers, Guards, Horse, Chariots / Elephants, Engineers, Scouts, Supply at their `UnitDef.commandSlot`, Rally point on slot 14. |
| `world-settlement-*-portrait` / `-landscape` | Phone layouts (tabs span the slot grid and read in full; landscape slots print the kit's caps codes FLD / CNL / GRN ... with the level badge top-left). Portrait: two-row top bar (Grain / Wealth / Recruits + expand chevron + menu; date + pause/1x/2x/4x), minimap and objectives behind 48 px buttons, realm buttons as a right column, the card as a bottom sheet with icon-over-label tabs. Landscape: one-row top bar, realm buttons in a row, compact card docked bottom-right (52 x 58 px slots) so the map stays visible. |
| `world-army-card-pc` | Royal Host selected: food / morale meters, and the army card - Move, Attack, Besiege, Garrison, Raid / Forage, Retreat, Bold, Steady (current, highlighted), Wary / Forced, Split, Merge, Disband (confirm), Visit. |
| `world-colorblind-{protan,deutan,tritan}-pc` | `settings.colorblind` applied (`<html data-colorblind>`): realm emblem, Recruit badge, card icons and the minimap canvas (territories, settlements, armies) take the Art Director remaps from `theme.css` / `FACTION_ART.colorblind`; the canvas redraws on the attribute change (MutationObserver), paused or not. Protan and deutan share one remap in `theme.css`, so those two captures are identical by design; tritan turns the player saffron to red. |

### Drawers, AoE screens, realm screens and prompts

| Image | What it shows |
|---|---|
| `settlement-panel-pc` | Settlement drawer (right, under the realm buttons): eight vitals with a why-tooltip each (population / housing, grain days + stored, grain price, water / irrigation, loyalty, unrest stage, public order, health / sanitation), labor sliders with -/+ steppers (sum <= 100%), tax slider; the command card stays usable on the left with the selection info hidden. Phones: a bottom sheet (portrait) / right panel under the top bar (landscape), steppers instead of range sliders. |
| `settlement-panel-lower-*` | The same drawer / bottom sheet scrolled to its lower half after the script queued a granary upgrade and two recruitments through `GameActions`: buildings grid (icon, name, level pips, condition bar), Construction (Granary -> 3, progress bar, "no builders · Laying foundations", 48 px cancel), Recruitment (Spearmen x 2, Archers x 1 queued, progress, cancel button disabled with its reason until SIM-01 / CTO add `cancel_recruitment` - see requests), Garrison. |
| `army-panel-pc` / phones | Army drawer: commander portrait (monogram on a darkened faction colour, role badge) with skills, supply (27 days, 4,575 / 4,575, 170 a day) with the line state and its source, stances (Steady active) + forced march, unit rows with strength / morale bars and the split selection. |
| `build-placement-*` | Placement HUD for a granary (props pushed by the script until GP-03 drives the ghost): costs, "Needs flat ground inside the walls" (invalid), facing east (rot 1), keys LMB / Shift / R / RMB-Esc on PC; on phones the card, objectives and realm buttons step aside and the cross / rotate / tick buttons (64 px, tick disabled while invalid) sit at the bottom. |
| `market-*` | Market opened from the Economy tab "Trade" slot: grain / timber / stone with stock, buy / sell price per lot, fairness factor, price sparkline (flat at day 0: no history yet), Buy / Sell, x5 lots toggle (Shift-click on PC; the phone hint names the toggle). |
| `age-panel-*` | Ages and landmarks: carved banner (II Mahajanapada Age, next III Samrajya), requirements checklist (met green, unmet red), unlock bonuses in words, the two landmark cards (cost chips, red when short; "The age requirements are not met yet" on the locked Choose site). |
| `economy-panel-*` | Treasury and granaries: ledger last month / projected, tax policy (Lenient / Standard / Heavy / Emergency with factors), royal reserve + Hold the reserve, rationing, granary rows with reserve days by colour. |
| `diplomacy-*` | Realm list with opinion / trust / treaty icons, Giridurga (at war) selected: Peace / Ceasefire composer and the AI reply from `evaluateAcceptance` with its reasons ("They fear your army (+20)", "They think ill of you (-13)", "They are wary of a peace (-10)"). Phones: list and detail as two steps with an "All realms" back button. |
| `minimap-world-*` | The minimap element: flat biome tint with soft relief, faction territories (hatched when contested), roads, settlements by relation (capital star, selection ring), armies, the N marker on the rotating rim, north-up toggle. Phones: opened from its 48 px button, 232 px (portrait) / 184 px (landscape) with both buttons above the map (checked). |
| `event-modal-*` | "The Broken Crown" (reached by stepping the campaign): illustration band, narrative text, countdown with the default choice, choice card with its consequence. Parchment modal; full-screen on portrait. |
| `event-modal-advisors-*` | "Whispers in the Hall of Pillars" (the succession event, reached by stepping the campaign to the day it fires): countdown with the default choice; choice 1 "Recommended by the Chief Minister, Mantri Haridatta" with his portrait (monogram + seat badge); choice 2 locked - dimmed, "Recommended by the Court Scholar" portrait, and the lock line with its reason ("Requires an earlier decision": the nobles have not been won in the Hall of Pillars); choice 3. Portrait: full-screen parchment that scrolls. |
| `engagement-prompt-*` | Battle is Joined at Shilapur (the Royal Host ordered to attack the Host of the Seven Peaks): both sides with commanders and soldiers, "You" tag, win chance bar with the 50% mark, expected losses, advisor factors, Take command / Let the generals decide / Retreat. Phone toasts wait while the modal is open. |

### Battle HUD, radial wheel, results

| Image | What it shows |
|---|---|
| `battle-deployment-*` | Deployment: forces bar (both realms, soldiers, strength and morale bars), DEPLOYING clock, speeds (0.5x..8x on PC, 1/2/4x on phones), the deployment bar with the countdown and Begin battle, the formation cards strip (class icon, count, strength / morale bars, morale with its cause, fatigue tier, ammo pips, experience chevrons, current order), the Orders page of the card on PC (Hold H, Advance T, Attack X, Charge C, Flank Y / Defend U, Withdraw B, Regroup G, Run N, Stance M / Line J (current), Column I, Square O, Wedge P, Loose K - disabled for these troops) + Select all; simple presets (Line up / Archers behind / Horse to the wings / More) on phones; the battle minimap with both deploy zones; Rally ring button. |
| `battle-live-*` | 30 s into the battle, Levy I and Levy II selected (gold cards). Control-group row above the strip, fed through the real input path (`group_assign` on 1, 2, 4): on PC only the assigned groups ("1 · 2 formations", "2 · Archers", "4 · 2 formations"), on phones all five slots (empty ones read "Hold to set"; tap selects, double-tap centres, long-press assigns). Cards carry short unique titles (Levy I / Levy II / Archers / Guards / Horse / Elephants / Scouts / Supply; full name in the tooltip), men beside the bars, morale + its cause, fatigue only when not fresh, ammo pips; the stance slot reads "Bold". Forces bar: gold "You" badge + 2 px gold underline (no "(you)" text), 3 px faction edge per side. Floating cards over the troops and enemy bars with a 2 px enemy border + emblem (anchors from the camera model until GP-04 pushes them). |
| `battle-radial-*` | The touch radial wheel (long press): inner ring = the nine orders + stance, outer ring = six shapes + eight intents (Pursue and Loose disabled with their reasons), cancel in the centre; the HUD below dims behind it. 50 px items, no overlap, fits the 390 px phone. Esc closes it without opening the pause menu (checked). |
| `battle-colorblind-{protan,deutan,tritan}-pc` | The live battle under each remap: forces-bar faction edges and emblems, card class icons, floating bars and the minimap formations follow it. |
| `battle-intents-pc` | Tab moved the card to the Intents page: Crossing, Protect, Heights, Pin, Screen / Pursue (disabled: "Only horse, chariots and scouts pursue"), Scout, Escort, Clear (disabled: no intent); Classic Alt+letters. |
| `minimap-battle-*` | Battle minimap fitted to both deploy zones + 25 % margin (grow-only), so formations draw as >= 6 x 3 px blocks with a facing tick; soft flat tint (+-15 % relief) at every tier - the low-tier phone map is no longer an empty disc. Phones (expanded): 232 px portrait / 184 px landscape, collapse and north-up buttons side by side above the map (checked). |
| `battle-results-*` | The same battle stepped to its end (withdrawal at 9:28): Victory banner with the summary, per-side table (started / survived / killed / captured / in pursuit; the last two columns hidden on portrait), the player's formations (start -> survivors, experience gained, routed), commander fates, chronicle line, Return to Menu. |
| `battle-results-prisoners-*` | The same outcome shown as a won world battle (the script adds `engagementId`, which the session does not pass yet - GP-03, and keeps the numbers consistent: the men taken leave the foe's survivors and show in the table, the summary line and the header): "N prisoners" with Ransom / Release (`prisoners` strategic command; both disable after a choice), commander fates (the enemy commander taken), Return to the Realm. The event-feed toasts are hidden under every modal (no clipped toasts at the edge); landscape: sticky footer on an opaque lacquer band with a 16 px fade. |

### Hero HUD

| Image | What it shows |
|---|---|
| `hero-explore-*` | Hero HUD on a real target: `?scene=lab&lab=hero-hud` (`src/ui/screens/hero/hero-hud.lab.ts`) projects 3D figures through its camera every frame and pushes the `hero_hud` v2 props exactly as GP-02 will. Prompt bubble on the potter's projected head (checked within a few px), objective with the place, compass strip, caption with the speaker, key hints (PC). Phones: move stick, "Drag to look", 76 px interact button. |
| `hero-combat-*` | Same lab in combat: lock-on reticle on the bandit captain (projected, checked), enemy bars over the bandits' projected heads (clamped inside the screen edge; hidden under the HUD boxes), boss bar with poise and the unblockable red cue, HP / stamina / salve pips. Phones: attack (84 px), heavy, roll, guard, salve (charges badge), lock. `hero-scene-pc`: the live HeroScene with the props GP-02 pushes today. |

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
| UI + input CPU, world HUD 1280 x 720, Rajapura selected (60 fps virtual timeline, `__SAMRAJYA_UI__.bench`, 10 s in 2 s chunks, prompts answered between) | 1x: avg 0.101 ms / frame (p95 3, max 21.5 when the settlement card recomputes SIM-01 `buildOptions`); 4x: avg 0.255 ms (p95 1.3, max 23.7) - budget < 1 ms |
| UI + input CPU, battle HUD 1280 x 720, two formations selected | 1x: avg 0.095 ms / frame (p95 2.9, max 11); 4x: avg 0.082 ms (p95 0.1, max 31.5) |
| Live profiler EMA under SwiftShader (`uiInput.ms`, for transparency) | world 4.17 ms, battle 7.08 ms per frame - SwiftShader renders ~1 frame/s on this shared 4-CPU box, so every frame carries a full HUD refresh; at 60 fps the throttles spread that work (HUD <= 10 Hz, settlement card <= 2 Hz, top bar <= 2.5 Hz, minimap layers <= 4 Hz world / ~8 Hz battle) |
| Contrast (measured on the pixels, every visible text run) | 2,595 text runs on 69 full-screen captures, 0 below the threshold |
| Touch targets on phone captures | 1,233 interactive elements on the 40 full-screen phone captures, 0 below 44 x 44 px |
| Truncation (round 2) | no visible label cut to an ellipsis on the 69 full-screen captures |
| Phone minimap expanded (round 2) | portrait 232 px (canvas 220), landscape 184 px (canvas 172); collapse + north-up buttons end above the canvas (world and battle) |
| Esc closes the radial wheel without the pause menu | ok on all three viewports |
| Open map areas pass pointer events to the game | ok (world, battle, hero, every viewport) |
| Event modal / engagement prompt reached by stepping the campaign | ok (every viewport) |
| Battle stepped to its outcome, results shown | ok (withdrawal at 9:28) |
| `?assets=off` world HUD | ok, no errors |
| Console errors / page errors / failed requests / crash reports | none in any session |

Builds: `npx vite build --outDir .build/ui-02` and `--mode single --outDir .build/ui-02-single` (2.79 MB one-file
HTML) both succeed. Smoke: `docs/sprint1/ui-02/smoke/` (all 14 smoke shots passed, no console errors).

## Requests to other owners (not edited here)

- Lead Gameplay Engineer / GP-03 (`src/scenes/WorldScene.ts`): consume `ctx.ui.commands` (`place_building` /
  `place_landmark` -> placement ghost with `ctx.input.setMode('placement')` and `ui.show('build_placement', ...)`
  while placing; `placement` confirm / cancel / rotate from the touch buttons; `army_target`, `rally_point_target`,
  `minimap_move` -> targeting mode and the matching strategic command); push `ctx.ui.feeds.setCamera(groundQuad,
  cam.yaw + Math.PI)` at 4-10 Hz and `setWorldGroups(...)` when army control groups change;
  `ctx.input.setSelectionHitTest(...)` for drag-from-selection.
- Lead Gameplay Engineer / GP-04 (`src/scenes/BattleScene.ts`): push `battle_hud.deployment`, `rally` and `anchors`
  (batched worldToScreen, `ui.update('battle_hud', ...)` every frame: the full HUD render stays throttled to 10 Hz,
  `Screen.track` moves the floating cards on every push - lead review round 1); consume `battle_target` and `minimap_move`; open the pause menu on `menu` only
  (today `cancel` also pauses, so a mode cancel pauses the game - the radial wheel already swallows its own Esc).
- Lead Gameplay Engineer / GP-02 (`src/scenes/HeroScene.ts`, `src/hero/**`): push the `hero_hud` v2 fields
  (`promptAnchor`, `objective`, `compassHeading`, `caption`, `combat`, `touchControls`) every frame (enemy bars, the
  lock-on reticle and the prompt bubble follow each push through `Screen.track`); read hero holds with
  `ctx.input.isHeld / heldFor / releasedFor` and the touch stick from the input frame.
- CTO (`src/core/profiler.ts`): an API for external per-system milliseconds (e.g. `profiler.addSystemMs('ui', ms)`)
  so UI + input appear in the F3 system list next to the counters `ui.ms`, `input.ms`, `uiInput.ms`, `uiInput.maxMs`.
- Art Director (`src/ui/theme.css`): adopt the HUD icon set (`ICON_PATHS_HUD` in `src/ui/components/icons.ts`) and the
  two contrast variants made locally in `hud.css` (`.panel.carved.landmark-card` deeper sandstone; darkened faction
  colour under portrait monograms) as theme tokens; consider a lighter `--ui-danger` for small text on dark panels
  (measured 4.4-4.6:1 at 12 px).
- Lead AI & Simulation Engineer (SIM-01 `src/sim/strategic/selectors.ts`): memoize `buildOptions` per settlement per
  day - its placement search is the 12-17 ms one-frame spike in the world bench (the HUD already calls it <= 2 Hz).
- CTO (`src/core/types.ts`) + Lead AI & Simulation Engineer (SIM-01, `src/sim/strategic/commands.ts` and the
  recruitment module) - **recruitment cancel** (ticket item 2): add the StrategicCommand member
  `{ kind: 'cancel_recruitment'; settlementId: SettlementId; index: number }` (`index` into
  `SettlementState.recruitment`), validate it (own settlement, index in range: reasons "No such settlement" / "No such
  recruitment"), and apply it with the refund rule of `cancel_construction` (`RULES.construction.cancelRefund` = 0.9):
  the recruits go back to `recruitPool` in full, wealth and grain come back at (1 - progress) x 0.9 of what was paid
  (an unstarted queued job refunds 0.9 of everything); cover it in tests/sim/strategic. The panel needs no change: the
  cancel button (`src/ui/services/recruitCancel.ts`) feature-detects the command through `validateCommand` and enables
  itself; until then it shows disabled with "Recruits already called up cannot be sent home yet". Once the member
  exists, the cast in `cancelRecruitmentCommand` can go.
- Lead Gameplay Engineer / GP-04 (`src/scenes/BattleScene.ts`): push the battle control groups with
  `ctx.ui.feeds.setBattleGroups([{ group, label, count }])` whenever a group is assigned or loses formations (the row
  derives them from `BattleState` meanwhile); the row's taps go through `ctx.input.injectAction('group_select' |
  'group_assign' | 'camera_focus', { group })`.
- Lead Gameplay Engineer / GP-03 (`src/app/session.ts`): pass `engagementId` in the `battle_results` props of a world
  battle so the prisoners choice (Ransom / Release, `prisoners` command) appears in play; today only the capture script
  supplies it.
- Technical Art Director (with the Art Director): golden-hour thumbnails of the landmark models (image assets, about
  192 x 144) for the age panel's illustration band; the cards use one ink silhouette per landmark
  (`src/ui/components/landmarkArt.ts`) until then and take an image by landmark id as soon as one is published.

## Known issues

- The scene pushes the HUD expects are not there yet (GP-02 / GP-03 / GP-04): floating formation cards use anchors the
  capture script computes from the RTS camera model (ground height taken as 0), the build placement HUD and the hero
  v2 fields are pushed by the script, the world control-group row and the minimap camera frustum stay empty until
  the world scene feeds them. Everything renders as soon as the props / feeds arrive.
- The cards strip scrolls sideways when a host has more formations than fit; there is no scroll hint yet.
- `npm test` in this tree (2026-10-31): 906 pass, 10 fail - all outside UI-02 paths: strategic siege x3, construction
  (Palace days), politics (careful year), contracts migration (battles), tactical determinism (mid-siege resume), and
  three CPU budget tests (battle AI cost, tactical perf 1k / 5k soldiers) that are sensitive to the shared 4-CPU box
  while two capture runs render under SwiftShader. Every UI and input suite passes (14 files, 122 tests).
- Recruitment cancel is visible but disabled until the simulation has `cancel_recruitment` (request above).
- The prisoners capture adds `engagementId` itself; in play the choice appears once GP-03 passes it.
- Landmark cards show ink silhouettes; the final golden-hour thumbnails are requested from Technical Art.

## Lead UI/UX review, round 1 (reviewer fixes and re-captures)

Re-captured with the reviewer fixes into `docs/sprint1/ui-02/review/` (same script: `SHOTS_PORT=4465
SHOTS_DIST=.build/ui-02-review SHOTS_OUT=docs/sprint1/ui-02/review`); review smoke in
`docs/sprint1/ui-02/review-smoke/`. Fixed by the reviewer (commits `[Lead UI/UX Engineer] UI-02 review ...`):

| Finding | Fix |
|---|---|
| Live panels (economy, ages, diplomacy, council, market) rebuild their buttons on every refresh (up to 2.5 Hz while the game runs): a click whose pointerdown and pointerup straddle a rebuild was lost, and keyboard focus dropped to `<body>` | `UIManager`: a press inside a panel / modal holds its re-renders until the release and renders after the click; focus is restored on the node at the same place after a re-render. HUD screens are exempt (touch stick, hold buttons). `tests/ui/hud/uiManager.test.ts` |
| Floating formation cards, hero enemy bars, the lock-on reticle and the prompt bubble only moved on the 10 Hz render: they would swim behind a moving camera | `Screen.track(props)`: every throttled push repositions anchored nodes (transform writes only); GP-04 / GP-02 push anchors every frame (requests above updated) |
| Battle HUD at 1280 x 720 stacked the cards strip over the middle of the battlefield (the HUD covered the lower-centre half of the screen) | PC: AoE IV layout - minimap bottom-left, formation cards bottom-centre (wrap, 2 rows, then scroll), command card bottom-right, Rally in the corner |
| Formation cards cut the dominant morale cause to "gener..."; experience shown as `^^` text | lotus icon + `82 · general near`; stacked chevron icons (army panel too) |
| Age requirements met / unmet differed by colour only | check / cross icon per row |
| Phones: keyboard chips on touch portrait slots; hero vitals over the compass band (portrait); landscape tabs "Econo..."; battle results' Return row below the fold (landscape) | chips hidden on touch, vitals under the compass, body face for landscape tabs, sticky results footer |
| Settlement card refresh re-ran SIM-01 `buildOptions` (placement search, 5.6 ms in node) twice a second | memoized on everything `validateBuild` reads + the sim day: 0.5 ms per refresh when nothing changed |
| The event modal printed 1, 2, 3 on its choices but those keys selected control groups | number keys pick the choice while the modal is open |
| The placement HUD's touch rotate sent the HUD command and the `placement_rotate` input action (two turns per tap once GP-03 handles both) | HUD command only; R stays the input action |

Review capture (`docs/sprint1/ui-02/review/shots-report.json`): 59 shots, 34 / 34 checks; 1,827 text runs on 53
captures with 0 below 4.5:1 / 3:1; 867 phone touch targets, 0 under 44 px; no console / page errors. UI + input on the
60 fps bench at 1280 x 720: world 0.064 ms avg at 1x (p95 0.7, max 21.8) and 0.133 ms at 4x; battle 0.040 ms at 1x
(p95 1.1, max 4.3) and 0.018 ms at 4x. The world max is still a sim-day cache miss of SIM-01 `buildOptions` (request
above). Single-file build 2,618 kB.

Still open for the developer (round 2): see the review verdict - battle control-group row on touch, recruitment
queue cancel (needs a command), and evidence for the settlement panel's lower half, an event with advisor
recommendations and a locked choice, and the prisoners choice.

## Rework round 1 (developer): Lead UI/UX blocking items and the Art Director co-sign list

Commits `[UI Engineer ...] UI-02 R1 ...` (part of the code was picked up by the Studio Head WIP snapshots `b23d282`
/ `e65d2ae` before `4edd6b6`). Every item below was re-captured and looked at.

| Item (reviewer) | Fix | Evidence |
|---|---|---|
| L1 Battle HUD has no control-group row | `controlGroupRow` reused in `src/ui/screens/battle/hud.ts`: 5 slots on touch / phones (empty: "Hold to set"), assigned groups only on PC, above the strip and presets (landscape: a column on the left edge). Fed by `ctx.ui.feeds.setBattleGroups` (`src/ui/services/hudCommands.ts`, GP-04 request) else derived from `BattleState`; QA hook `__SAMRAJYA_UI__.setBattleGroups`. Taps: `injectAction('group_select' / 'group_assign' / 'camera_focus', {group})`. `tests/ui/hud/battleGroups.test.ts` | `battle-live-*` (groups assigned through the input path, checked on PC), touch audit |
| L2 Recruitment queue has no cancel, no request filed | Cancel button on every recruitment row (same 48 px `q-cancel` skin and reason tooltip as construction), feature-detected through `validateCommand` (`src/ui/services/recruitCancel.ts`), disabled with its reason until the command exists; exact command + refund rule requested from the CTO and SIM-01 (Requests). `tests/ui/hud/queues.test.ts` (disabled with the reason today; enabled per row with the refund hint once the validator knows the kind; an inconclusive probe is not memoized; both queues' rows carry a cancel button) | `settlement-panel-lower-*` |
| L3 Missing evidence: settlement panel lower half, advisors + locked choice, prisoners | Script queues a build and two recruits, scrolls the drawer / sheet; steps the campaign to the succession event (advisor portraits, a locked choice); shows the battle outcome as a won world battle with consistent prisoner numbers | `settlement-panel-lower-*`, `event-modal-advisors-*`, `battle-results-prisoners-*` (pc, portrait, landscape; contrast + touch audited) |
| AD1 kbd chips collide with level badges and icons | ui_kit slot grammar (`src/ui/components/commandGrid.ts`): 18 x 18 single-key chip top-right; a modifier shared by the whole card printed once as an "Alt" chip at the end of the tab row (and in each tooltip); mixed pages use one-glyph modifiers with a legend; level badge top-left with a 4 px inset; 28 px icon with 6 px clearance. Chip plans tested per card and preset | `world-settlement-*-pc`, `world-army-card-pc`, `battle-intents-pc` |
| AD2 Truncated labels | Formation titles = class short name + roman index when repeated (`src/ui/services/battleLabels.ts`: Levy I / Levy II / Guards / Horse / Elephants / Supply), Mukta 600 13 px, full name in the tooltip; stance slot "Bold"; compact landscape slots use the 700-weight caps codes (SPR / ARC / ELE / ENG / WRK ...); portrait forces bar drops "(you)" for the gold "You" badge / underline. Hero enemy bars near the screen edge are clamped inside it (portrait "ndit", round 2) | `battle-live-*`, `battle-deployment-*`, `world-settlement-*-landscape`, `hero-combat-portrait` |
| AD3 Phone minimap small, buttons on the map, empty low-tier battle map, strip over it | 232 px portrait / 184 px landscape; both buttons side by side above the map - round 2 found the earlier fix defeated by margin collapse (the frame's top margin collapsed through `.minimap`, so the buttons still sat on the map and the toggle jumped when tapped): `.minimap` is now `display: flow-root` on phones, and the capture checks that both buttons end above the canvas. Flat biome tint + deploy-zone fills at every tier; battle bounds fitted to the deploy zones + 25 %; formations >= 6 x 3 px with a facing tick; PC relief reduced to +-15 %; landscape: an open battle minimap hides the strip, presets and groups | `minimap-*-portrait` / `-landscape`, `battle-deployment-pc` |
| AD4 Overlay leaks | (a) HUD feeds hidden under any modal (no clipped toasts behind results); (b) landscape results footer on an opaque lacquer band with a 16 px top fade, scroller padded by the footer; (c) realm buttons step aside under an open drawer (no Chronicle badge through the sheet) | `battle-results-*`, `settlement-panel-*`, `army-panel-*` |
| AD5 Landmark cards have no picture; disabled Choose site a mud blob | 96+ x 72 px illustration band per card with a distinct ink silhouette per landmark (`src/ui/components/landmarkArt.ts`, coverage test); flat-stone disabled skin (ink 60 % on flat sandstone); final thumbnails requested from Technical Art | `age-panel-*` |
| AD6 Evidence: real hero targets, colour-blind captures, minimap following the remaps | Hero HUD lab projects real 3D targets (bubble / reticle positions checked against the projected heads); colour-blind captures of the world and battle HUD per mode; the minimap canvas redraws on `data-colorblind` changes (it did not before) | `hero-*`, `world-colorblind-*-pc`, `battle-colorblind-*-pc` |

Round 2 self-review (this pass, every capture re-opened) found and fixed:

- Phone minimap buttons still on the map (margin collapse, above) - now checked by the capture script.
- Phone command-card tabs cut to "Econ..." / "Milit..." / "Defe..." and only 41 px wide in landscape (below the 44 px
  touch minimum): `.command-card` centres its children, so the tab row shrank to its content. The row now spans the
  slot grid (portrait 334 px: 65 px tabs; landscape: the card's width, 54 px tabs) and every tab reads in full.
- Landscape battle control-group column cut "Hold to set" / "2 formations" in its 52 px slots: it prints the number
  over "×N" formations; an empty slot is the number on the dashed skin (aria-label and long-press keep the hint).
- Phone cards strip hard-cut its last card at the screen edge ("Elepha"): the edge fades over 40 px while more cards
  wait to the right (one rAF read when the card count, layout or scroll position changes).
- Hero enemy bar cut at the portrait screen edge ("ndit"): clamped inside the viewport; off-screen heads hide theirs.
- Prisoners staging said 120 prisoners while the table said 0 captured: the staged outcome is self-consistent.
- The capture script now also audits truncation (any visible label cut to an ellipsis fails the run), waits for
  throttled HUD renders before clicking (a landscape run failed on a starved SwiftShader), and a merged partial
  re-run drops the old checks of the sessions it re-ran.

Final capture (75 shots, 61 / 61 checks): contrast 2,595 text runs on 69 captures, 0 below 4.5:1 / 3:1;
touch 1,233 phone targets, 0 under 44 px; no console / page errors, failed requests or crash reports. UI + input
on the 60 fps bench at 1280 x 720: world 0.101 ms avg at 1x / 0.255 ms at 4x, battle 0.095 / 0.082 ms (budget < 1 ms); truncation 0 on 69 captures. Smoke (`SMOKE_SKIP_BUILD=1 SMOKE_DIST=.build/ui-02 SMOKE_PORT=4415 SMOKE_OUT=docs/sprint1/ui-02/smoke`): 14 / 14 shots, no console errors. Single-file build 2,789.58 kB (`.build/ui-02-single`).
