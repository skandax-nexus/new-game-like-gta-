# SIM-02 - Battle AI, intents and campaign AI (evidence)

OWNER: AI Engineer - Battle AI, Intents & Campaign AI (SIM-02), reporting to the Lead AI & Simulation Engineer.

Everything here is deterministic simulation code (`src/sim/**` purity rules: no `three`/DOM, no `Math.random`, world /
side RNG streams only, sorted iteration). Plan memory is plain JSON in the state (`BattleSideState.aiMemory`,
`FactionState.ai.memory` / `ai.goals` / `ai.threat`), so saves, hashes and replays carry it.

## What shipped (public APIs)

| API | Where | Use |
|---|---|---|
| `runBattleAI(state, side, terrain): BattleCommand[]` | `src/sim/tactical/battleai.ts` | Called by `stepBattle` every think (1 s) for AI sides, deployment included; re-plans every `DIFFICULTY_DEFS[d].battleAiReplanSec`. Field plan in `ai/field.ts` (deployment, posture, roles, line, missiles, mounted, elephants, reserve, pursuit, rally, withdrawal at `battle.withdrawAt`), sieges in `ai/siege.ts`. Sees only what its side sees. |
| `translateIntent(state, index, intent, terrain): FormationOrder \| null` | same | The 8 DESIGN_SPEC §6.4 intents (`hold_crossing`, `protect_formation`, `hold_high_ground`, `pin_enemy`, `screen_flank`, `pursue_routers`, `scout_area`, `escort_supply`) for player and AI sides alike; `null` keeps the current order. |
| `battleProfile(state, side)` | `src/sim/tactical/ai/common.ts` | Personality battle numbers with `BattleSideSetup.aggression` (autoresolve stance 0.75 / 0.5 / 0.3, set by SIM-01) overriding `aggression`. |
| `runCampaignAI(world, factionId, terrain): IssuedStrategicCommand[]` | `src/sim/strategic/ai.ts` | Called by `tickWorld` once a day per non-player living realm; returns StrategicCommands only (applied by `tickWorld` right after). |
| `aiSchedule(day, dayOfMonth, slot)` | same | Which heavy planners run today (strategy every 5 days, economy every 5, diplomacy every 15; staggered per realm; never on the month-rollover day). |
| `setAiPassive(world, factionId, passive)` | same | Holds a realm's AI (writes `ai.memory.passive`). For tests / tools / a future "AI off" toggle. |
| `aiJournal()`, `resetAiJournal(enabled?, limit?)`, `AiJournalEntry` | same (from `ai/core.ts`) | Module-level decision log (not state): `{ day, factionId, kind, text }`, kinds goal / war / peace / diplomacy / economy / build / recruit / age / army / spy / rebels. Read by the narrative script; a debug panel can show it. |
| `warRule(sit, b)`, `WAR_FORBIDDING_TREATIES`, `WarRuleResult` | same (from `ai/diplomacy.ts`) | DESIGN_SPEC §7.14: ratio = own / target strength x (1 - opinion / 200) against warRatio - aggression bonus, opportunist +0.3 vs a realm weakened by famine, revolt or a battle lost in 60 days; truces and treaties block. |
| `chooseAiEventChoice(world, fid, def, scope)` | same (from `ai/politics.ts`) | Event choice by `aiWeight`, skipping choices whose `requires` fail, on the world RNG. |
| `landmarkScore`, `preferredLandmark` | same (from `ai/build.ts`) | The landmark an AI court picks for an age (top personality weight x region). |

Campaign planners (`src/sim/strategic/ai/`): `goals.ts` (defend / conquer / develop / stabilize / ally /
secure_supply = personality weights x situation, top 6 into `f.ai.goals`), `diplomacy.ts` (war rule, peace below
`peaceWarScore` through SIM-01 `evaluateAcceptance`, treaties only when the receiver accepts), `economy.ts` (labour, tax
policy and rates, grain relief to 60 reserve days at the capital, rationing, market trades, debt crisis),
`build.ts` (needs x weights through `validateBuild` placement cells; landmarks and age-ups), `recruit.ts` (garrisons,
field host up to 0.04 x population, x1.3 expansionist, x0.7 mercantile; demobilisation in a money crisis),
`military.ts` (concentration, supply-aware marches, flood avoidance, sieges with depots, storming, relief, raids for
raiders, defence of threatened towns, pursuit limits), `politics.ts` (rebel negotiations, espionage by personality,
event choices). Difficulty knobs come from `DIFFICULTY_DEFS` / the sandbox aggression slider.

## Acceptance and evidence

| Criterion | Evidence |
|---|---|
| typecheck + SIM-02 tests green, purity and determinism | `npm run typecheck` clean. `tests/sim/ai/*` (intents 11, matchups 9 rows x 40 seeds, campaign 19, perf 2) and `tests/core/purity.test.ts`, `tests/integration/determinism.test.ts` pass. Full `npm test`: 800 / 806 - the 6 failures are tests in other owners' files whose premise is an inert AI (see Requests). |
| Intents | `tests/sim/ai/intents.test.ts`: each §6.4 intent on synthetic maps (positions, facings, ranges, intercepts). |
| Matchups §13.3 | `tests/sim/ai/matchups.test.ts` (40 seeds) + `node scripts/sim-ai/matchups.mjs` (200 runs) -> [matchups.md](matchups.md): all 9 rows PASS. |
| Campaign AI, 3-year AI-only sandbox, 6 realms, 4 seeds | `tests/sim/ai/campaign.test.ts`: no realm below zero treasury > 60 consecutive days; every AI war declaration had the rule hold (evaluated independently the hour before) and nothing blocked it; peace sued within 31 days of a war score below `peaceWarScore`; landmark started within 150 days of an age's requirements holding; >= 1 age-up across seeds; every planner kind acted. |
| The Broken Crown default run ends mixed 6/6 seeds | same file: 6 seeds x 545 days, outcome never defeat, AI realms solvent (SIM-01's own `tests/sim/strategic/campaign.test.ts` default-run check also passes with the AI active). |
| Perf | `tests/sim/ai/perf.test.ts` (numbers below). |
| Browser evidence | `scripts/shots/sim-02.cjs` (this folder's PNGs + `shots-report.json`) and the smoke run in [smoke/](smoke/). |
| Narrative | [campaign-year.md](campaign-year.md) / `.json` (full journal) from `node scripts/sim-ai/autoplay.mjs`; a short reading below. |

## Performance (tests/sim/ai/perf.test.ts, this machine, 4 shared CPUs)

| Budget | Measured |
|---|---|
| runCampaignAI < 0.5 ms per realm-day | The Broken Crown (3 AI realms, 120 days): mean 111 us, p50 71 us, p95 334 us, max 838 us. AI-only sandbox (6 realms): mean 81 us, p50 37 us, p95 323 us, max 1130 us. |
| runBattleAI < 0.1 ms per think at 40 formations | 20 v 20, every second of a 289 s battle, both sides: mean 89 us, p50 88 us, p95 146 us, max 186 us. |

Method: identical copies timed, minimum per sample (GC / parallel test workers only add time). The campaign maxima are
first-time settlement placement-grid builds (SIM-01 `validateBuild` cache warm-up); the battle p95 is the full re-plan
think with melee contact on both wings.

## Matchups (200 runs per row)

All 9 §13.3 rows pass: spears vs frontal horse 100%, horse vs guarded archers loses 100%, mixed vs pure spear 92%,
elephants vs horse 100%, loose archers vs elephants 93.5%, guards vs 2.5 spears 56.5% (45-60%), balanced mirror 45.5%
(45-55%), Giridurga on a hill 95%, commander killed +34 points rout. Details and setups in [matchups.md](matchups.md).
The final re-run (after the battle AI's cost work) reproduced every battle of the previous table exactly (winner, end
reason and length; only the wall-clock seconds in `matchups.json` differ).

## An AI-only year (seed 3) - what the journal shows

Six realms, all AI (the four landed realms of the sandbox map plus two landless ones). Suvarna (expansionist) and
Giridurga (defensive) start at war. Day 1 every court sets labour by its grain outlook (89% in the fields where the
margin is thin), queues granaries and canals, and raises garrisons; Marudesha (raider) and Nilavana (opportunist) race
for the undefended free town Tirthaghat, which Nilavana takes on day 6. Suvarna concentrates one host and storms
Giridurga's walled towns one after another (Shilapur day 41, Kandaravasa 46, Dvaradurga 106, Pashanagram 110);
Giridurga falls back behind its walls when the host is too strong for the field, retakes Shilapur once (day 58) when the
Suvarnan host is away, and from day 47 sues for peace every 30 days as its war score sinks below its peaceWarScore
(-20) - Suvarna refuses each time (the acceptance reasons are logged). Giridurga's treasury runs thin, so it swings its
tax policy between standard and heavy and rations grain before the harvest; it never goes below zero.
Suvarna buys the missing stone (day 181), begins the Pillars of the Spoken Law at Rajapura (day 186) and enters the
Samrajya Age on day 274. With Giridurga reduced to one town, the war rule fires three times late in the year: Suvarna
on Marudesha (ratio 1.80 > 1.30, day 249), Nilavana on Giridurga (1.77 > 1.60, day 253) and Nilavana on a weakened
Marudesha (4.45 with the opportunist +0.3, day 343). Marudesha raids two undefended Suvarnan towns before Suvarna's
host returns and takes them back with Ushtragram. Audit: longest run below zero treasury 0 days; 3 / 3 declarations by
the rule; 12 / 12 peace spells sued within 31 days.

## Screenshots (scripts/shots/sim-02.cjs, port 4418, build in .build/sim-02/dist)

| File | What it shows |
|---|---|
| `battle-aivsai-deploy.png` | `?aivsai=1` plains battle (1,500 soldiers): both battle AIs deployed (plan memory `deployed`, postures attack / hold). |
| `battle-aivsai-contact.png` | the same battle 75 s into the fight: lines in contact, horse on the wings, first routs. |
| `battle-aivsai-river.png` | `?aivsai=1` river crossing (2,000 soldiers), 90 s in: the attacker's blocks in the ford, the defender's line on the bank. |
| `world-ai-year.png` | the world map after the AI-only year (save from `autoplay.mjs` loaded in the game): Suvarna in the Samrajya Age, 10 towns. |
| `world-ai-live.png` | a fresh sandbox run 45 days in the browser: every landed AI realm planned today, 10 build / recruit jobs, farming-heavy labour. |
| `shots-report.json` | every assertion with its observed value (no console errors, page errors, failed requests or crash reports). |

Smoke (`SMOKE_PORT=4418 SMOKE_OUT=docs/sprint1/sim-02/smoke SMOKE_DIST=.build/sim-02/dist npm run smoke`): all 14
shots passed with no console errors - [smoke/](smoke/) (`smoke-report.json` there).

Builds: production build `vite build --outDir .build/sim-02/dist` (done by the shots script) and the one-file build
`vite build --mode single --outDir .build/sim-02/single` (index.html 2,610.77 kB, gzip 926.71 kB) both succeed.

## Reproduce

```
npm run typecheck && npx vitest run tests/sim/ai
node scripts/sim-ai/matchups.mjs                 # 200-run matchup table -> matchups.md / .json
node scripts/sim-ai/autoplay.mjs --seed=3        # AI year narrative + .build/sim-02/ai-year.sav
NODE_PATH=$(npm root -g) node scripts/shots/sim-02.cjs
node_modules/.bin/vite-node tests/sim/ai/harness/regression-cli.ts 10   # battle AI decisions vs matchups.json (diffs 0)
```

## Requests (changes in other owners' files)

With the campaign AI live, six tests elsewhere assume realms that never act or a battle AI that keeps no plan memory:

1. CTO - `tests/contracts/migration.test.ts`, "battles (incl. a finished one with an outcome)": `toV1Battle` strips
   `sides[].aiMemory` and the migration restores `{}`, while the finished battle holds the battle AI's plan memory
   (play state, like `orderTime`). In the `done.formations.forEach` block's neighbourhood add
   `done.sides.forEach((s, i) => { s.aiMemory = finished.sides[i]!.aiMemory; });` before the final hash comparison.
2. QA / SIM-01 - test isolation for premises that need inert AI realms. Add to `tests/sim/strategic/helpers.ts`:
   `import { setAiPassive } from '../../../src/sim/strategic/ai';` and
   `export function passiveAi(w: WorldState): WorldState { for (const id of Object.keys(w.factions)) setAiPassive(w, id, true); return w; }`;
   then `siege.test.ts` `fedSiege`: `const w = passiveAi(campaign(5));` and the same in the two garrisoned-host tests
   ("a host garrisoned in its besieged town ..." and "when the besieged store runs out ..."); `construction.test.ts`
   palace test: `const w = passiveAi(sandbox(5, { startMonth: 6 }));`; `politics.test.ts` careful year:
   `const w = passiveAi(peace(quiet(campaign(5))));` (or set `r.truceUntilDay = 9999` in `peace()`).
3. SIM-01 - `src/sim/strategic/events.ts` (AI factions resolve immediately, line ~395): replace
   `const choice = chooseByWeight(world, def);` with `const choice = chooseAiEventChoice(world, scope.factionId, def, scope);`
   (`import { chooseAiEventChoice } from './ai';` - a function-only import cycle with `ai/politics.ts`, safe), so
   choices whose `requires` fail are never picked and the personality weighting applies.
4. SIM-01 - `src/sim/strategic/autoresolve.ts` side setup: `commanderSkill: (commander?.skills.martial ?? 8) +
   (isPlayer ? 0 : DIFFICULTY_DEFS[world.difficulty]?.aiCommanderSkill ?? 0)` (the skirmish setup already applies it).
5. CTO (optional) - `src/app/debugApi.ts`: expose `aiJournal()` and `setAiPassive()` on `window.__SAMRAJYA__` for QA.

## Known issues

- Battle AI p95 146 us per think is above 0.1 ms (the mean, the budget, is 89 us): full re-plans with melee contact on
  both wings. Re-plans are already spread over 1-3 s by difficulty.
- Campaign AI maxima (0.8-1.1 ms) are first-time placement-grid builds inside SIM-01 `validateBuild`.
- The sandbox map has four landed realms; Kotanagara and Samudra take part only diplomatically there.
- Balanced mirror (row 7) sits at the low edge of its band (45.5%, side 0 attacking).
- A realm ground down to one town (Giridurga above) keeps a field host it cannot pay for well; the demobilisation rule
  now disbands or splits off the costliest formations when the month is in the red and the treasury is below zero or
  under four months of runway.
