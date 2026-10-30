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
