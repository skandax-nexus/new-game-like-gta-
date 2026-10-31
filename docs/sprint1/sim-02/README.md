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
| `battlePlanLog()`, `resetBattlePlanLog()`, `BattlePlanEntry` | `src/sim/tactical/ai/common.ts` | Battle AI plan decisions (debug log, not state): siege phase changes, withdrawal reasons, jam sidesteps - `{ battleId, side, time, text }`. (Rework round 1.) |
| `SIEGE_AI` | `src/sim/tactical/ai/siege.ts` | The siege plan's numbers (stand-off margin 15 m, commit at 60 m, palisade 15 m ahead, corridor 40 m, screen rules, storm staging). |
| `peaceCase(sit, b)`, `PeaceCase`, `tributeTerms`, `TRIBUTE_SHARE` | `src/sim/strategic/ai.ts` / `ai/diplomacy.ts` | Whether a realm owes a peace proposal (below peaceWarScore and field strength < 1.5x) and on tributary terms (below `tributaryRatio`; 10% of monthly income). |
| `recruitRoom(sit)`, `pressed(sit)`, `engineersWanted(sit, host)` | `ai/recruit.ts` | Wartime recruitment budget; engineer formations a host should carry (1, 2 for a fort level 2+ siege target). |

Campaign planners (`src/sim/strategic/ai/`): `goals.ts` (defend / conquer / develop / stabilize / ally /
secure_supply = personality weights x situation, top 6 into `f.ai.goals`), `diplomacy.ts` (war rule, peace below
`peaceWarScore` through SIM-01 `evaluateAcceptance`, treaties only when the receiver accepts), `economy.ts` (labour, tax
policy and rates, grain relief to 60 reserve days at the capital, rationing, market trades, debt crisis),
`build.ts` (needs x weights through `validateBuild` placement cells; landmarks and age-ups), `recruit.ts` (garrisons,
field host up to 0.04 x population, x1.3 expansionist, x0.7 mercantile; demobilisation in a money crisis),
`military.ts` (concentration, supply-aware marches, flood avoidance, sieges with depots, storming, relief, raids for
raiders, defence of threatened towns, pursuit limits), `politics.ts` (rebel negotiations, espionage by personality,
event choices). Difficulty knobs come from `DIFFICULTY_DEFS` / the sandbox aggression slider.

## Rework round 1 (developer) - every review item

Commits: `9aa2c7b` (stage 1: siege battle AI + siege tests), `cfb5715` (stage 2: campaign AI), stage 3 (evidence,
this README). The Studio Head WIP snapshot `5b89370` swept in part of the stage-3 evidence (sieges.md, the AI year,
`siege-report.ts`, `scripts/sim-ai/sieges.mjs`, an interim shots script); history is not rewritten. Tools: `tests/sim/ai/harness/siege-watch.ts` (AI vs AI sieges), `world-watch.ts` (AI sandbox every N
days: realms, armies, ops, the war rule per pair, captures, eliminations, stalls, tributaries), `stalls.ts` (the stall
audit), `siege-report.ts` + `scripts/sim-ai/sieges.mjs` -> [sieges.md](sieges.md).

| Review item | What changed | Evidence |
|---|---|---|
| Lead #1 / CD siege rules a, b, d - siege attack | `ai/siege.ts` attack rewritten in phases prepare / screen / approach / cover / storm. (a) The besiegers' archers stand off beyond every known wall shooter's reach (range x1.2 walls x1.2 tower + height bonus + 15 m) until the ram is within 60 m of the gate or ladders are up. (b) Engineers raise a palisade (40 s, 20 m, 300 HP) 15 m in front of each pair of archer firing slots; the ram waits out of bow shot until they are up (or nobody is left to build them, or 90 s), then goes in. The sim's palisades stop movement and give "behind works" morale, not missile cover, and wall shooters loose at the nearest enemy with 20 volleys each - so the freshest melee blocks screen the ram: they stand in front of the palisade sites while those go up and walk 22 m ahead of the ram beside its lane (a block worn below 60% falls back and another takes over). The screen empties the walls' quivers and keeps friends within 80 m of the crew (its perceived risk), which is what lets the ram reach the gate. (d) Stormers have right of way: every other formation keeps 40 m clear of the approach; the stormers gather 45 m out and go in together. Withdrawals state their reason (`aiMemory.withdrawReason`, new `battlePlanLog()`): nothing left to breach with; the assault spent; the storm thrown back. A jam breaker sidesteps formations that make no headway for 10 s (formations do not pass through each other). | [sieges.md](sieges.md): `engineers` siege_breach on 3/3 seeds (13.6-14.2 min; palisade up at 6.5-7.7 min; attacking archers never closer than 261 m to a wall archer with arrows before the ram was committed); `elephants` attacker wins (rout) 3/3; `ram_only` reasoned withdrawal ("the storm was thrown back") 3/3. Stormer jam <= 5 s everywhere (was 20+ min). |
| Lead #2 / CD siege rule c - defence | Archers man the intact towers nearest the threatened gate / ladder / breach first (nearest free archer to each tower, towers by angular distance), then fan along the wall walk; spears defend one behind the other on the threat's radius (deep enough to leave the wall walk and the archers' ways to the towers free); engineers repair the damaged gate nearest the threat until it is whole (no walking between two gates); sallies unchanged. | `tests/sim/ai/siege.test.ts` towers / repair / sally tests. |
| Lead #3 - siege acceptance test | `tests/sim/ai/siege.test.ts` (7 tests): ram re-crewed; hopeless assault withdraws with its reason; ram built out of bow shot, carried to the gate, gate broken, breach held 60 s (siege_breach); AI vs AI (archer stand-off > wall reach + 15 m, palisade >= 1, ram at the gate, gate broken, no stormer jam >= 20 s, breach or reasoned withdrawal); towers nearest the threatened gate manned; gate repaired; the horse sallies against an unguarded ram crew and comes back. | 7 / 7 pass. |
| Lead #4 / CD wartime recruitment | `recruit.ts recruitRoom`: at war or under threat (hostile strength > 0.3 x a town's defence, or besieged) the treasury less one month of upkeep, the landmark saving ignored; in peace three months of upkeep and the saving (unchanged). | campaign.test.ts "at war the landmark saving and the 3-month floor do not starve recruitment". |
| CD-B2 engineers | Engineers and supply trains are raised one formation per job; the main host carries 1 engineer formation, 2 when its planned siege target (`op_<host>` = `siege:<town>`) has fort level >= 2 (`engineersWanted`). | campaign.test.ts "engineers and supply trains are raised one formation per job ..." |
| CD-B1 a resupply | Resupply goes to the nearest own town with grain to spare over its 30-day floor (explicit `sourceId`), else the nearest town, topped up from the royal reserve (`send_relief`, 20 days of the host's need); done at 60% of the train; no gain in 3 days -> another source; two fruitless tries -> back to operations. | campaign.test.ts "a resupplying host is done at 60% ..."; the seed-2 "camped resupply 248 days" stall is gone (world-watch). |
| CD-B1 b hunts | A hunt (like a defence pursuit) gives up after 10 days and that enemy is not chased for 20; a 15-day defence spell without a battle ends (no shuttling between two threats). | journal "gives up the chase", stall audit. |
| CD-B1 c retake | The main host's first offensive target is the realm's own lost town (held at the start, or for 90+ days - two realms do not both chase a conquest as their own) that it outmatches by the attack ratio. | campaign.test.ts "the main host retakes its own lost town ..."; seed 3 year: Suvarna retakes Kusumpur, Dhanyagram; Giridurga retakes Shilapur twice. |
| CD-B1 d stall audit | `tests/sim/ai/harness/stalls.ts` in the 3-year audits: while at war no AI field army keeps the same op > 45 days. Not stalls: a siege camp (it runs as long as the walls hold, §7.8 pacing) and a home station while the strategy planner found nothing it could take (memory `noTarget`); such a quiet war (no operation either way for 60 days) gets a status-quo peace offer every 30 days. Plus: no landed realm eliminated before day 180. | seeds 1-4 x 1080 days: longest spell 32 days (`hold:setupur`), others 9-29; first landed elimination day 181 / 243 / 273 / 276. |
| CD-B3 a | Every proposal (war, peace, treaty) goes through SIM-01 `validateProposal` before it is issued or journaled (`proposeChecked`); the tribute demand at war (always refused by SIM-01) is gone. | campaign.test.ts "no proposal the world would refuse is issued or journaled". |
| CD-B3 b-d | `peaceCase`: sue only below peaceWarScore and with own field strength < 1.5x the enemy's (otherwise retake); below `tributaryRatio` of the enemy's strength the peace carries tributary terms (overlord = enemy, payer = self, 10% of monthly income). A winner (expansionist / raider, 2.5x, war score > 20) offers peace on tribute. Until SIM-01 signs the tributary with such a peace (request 4), the bound realms propose the tributary itself right after the peace (`planTributeAfterPeace`, validated: it needs the Mahajanapada Age). | campaign.test.ts "peace: sued only below ..."; tributaries in the 3-year runs: seed 1 Giridurga pays Suvarna 34 / month from day 243, seed 2 24 / month from day 78, seed 3 Giridurga pays Nilavana and Suvarna; the seed-3 year below. The peace audit now expects a proposal only when `peaceCase(...).sue`. |
| Lead #5 npm test | Not green yet: requests 1-3 below (other owners' files) are still open. | Full suite numbers below. |

The Broken Crown default run still ends mixed on 6 / 6 seeds and the AI realms stay solvent; the 3-year sandbox audits
pass on seeds 1-4 (campaign.test.ts 27 / 27). Field battle decisions are unchanged (stage 1 touched only the siege
plan): the regression CLI reports `diffs 0` against matchups.json.

## Acceptance and evidence

| Criterion | Evidence |
|---|---|
| typecheck + SIM-02 tests green, purity and determinism | `npm run typecheck` clean for the SIM-02 files. `tests/sim/ai/*`: intents 11, matchups 9 rows x 40 seeds, campaign 27, siege 7 pass; perf 2 - see Performance (machine speed). `tests/core/purity.test.ts` and `tests/integration/determinism.test.ts` pass. Full `npm test` (load average 5-7 on the 4 shared CPUs): 930 / 940 pass in 507 s. Failures: the 6 inert-AI premise tests of requests 1-2 (`tests/contracts/migration.test.ts`, `tests/sim/strategic/{siege x3,construction,politics}.test.ts`), the mid-siege premise of request 3 (`tests/sim/tactical/determinism.test.ts`), and three timing budgets measured on a contended machine: `tests/sim/ai/perf.test.ts` x2 (below) and GP-01's own `tests/sim/tactical/perf.test.ts` 5,000-soldier step (0.807 ms against 0.8 - code SIM-02 does not touch, which shows the machine state). |
| Intents | `tests/sim/ai/intents.test.ts`: each §6.4 intent on synthetic maps (positions, facings, ranges, intercepts). |
| Matchups §13.3 | `tests/sim/ai/matchups.test.ts` (40 seeds) + `node scripts/sim-ai/matchups.mjs` (200 runs) -> [matchups.md](matchups.md): all 9 rows PASS (unchanged; regression CLI diffs 0). |
| Siege AI | `tests/sim/ai/siege.test.ts` (7) + [sieges.md](sieges.md). |
| Campaign AI, 3-year AI-only sandbox, 6 realms, 4 seeds | `tests/sim/ai/campaign.test.ts`: no realm below zero treasury > 60 consecutive days; every AI war declaration had the rule hold (evaluated independently the hour before) and nothing blocked it; peace sued within 31 days whenever owed (below `peaceWarScore`, field strength < 1.5x); landmark started within 150 days of an age's requirements holding; >= 1 age-up across seeds; every planner kind acted; stall audit <= 45 days; no landed realm eliminated before day 180. |
| The Broken Crown default run ends mixed 6/6 seeds | same file: 6 seeds x 545 days, outcome never defeat, AI realms solvent. |
| Perf | `tests/sim/ai/perf.test.ts` (numbers below). |
| Browser evidence | `scripts/shots/sim-02.cjs` (this folder's PNGs + `shots-report.json`) and the smoke run in [smoke/](smoke/). |
| Narrative | [campaign-year.md](campaign-year.md) / `.json` (full journal) from `node scripts/sim-ai/autoplay.mjs`; a short reading below. |

## Performance (tests/sim/ai/perf.test.ts, 4 CPUs shared with another developer)

| Budget | This run (contended) | Same machine, same hour, the round-0 code (`e49554f`, a worktree) | Round 0 (quiet machine) |
|---|---|---|---|
| runCampaignAI < 0.5 ms per realm-day | Broken Crown: mean 170-267 us, p50 108-169, p95 506-695 us | mean 258 us, p50 164, p95 679 us | mean 111 us, p95 334 us |
| runBattleAI < 0.1 ms per think at 40 formations | mean 151-211 us, p50 154-225, p95 234-325 us | mean 175 us, p50 175, p95 303 us | mean 89 us, p95 146 us |

The machine is about twice as slow as in round 0 today (the other developer's Blender bakes and browser captures keep
the load average at 5-7 on 4 CPUs; GP-01's own tactical perf budget fails in the same run). Measured back to back
in the same conditions, the reworked code is not slower than the round-0 code: the campaign planners added this round
(resupply sources, retake, stall / quiet-war bookkeeping) cost less than the run-to-run noise, and the field battle
plan is unchanged (regression CLI diffs 0). Method: identical copies timed, minimum per sample. To be re-measured on a
quiet machine (`npx vitest run tests/sim/ai/perf.test.ts`).

## Matchups (200 runs per row)

All 9 §13.3 rows pass: spears vs frontal horse 100%, horse vs guarded archers loses 100%, mixed vs pure spear 92%,
elephants vs horse 100%, loose archers vs elephants 93.5%, guards vs 2.5 spears 56.5% (45-60%), balanced mirror 45.5%
(45-55%), Giridurga on a hill 95%, commander killed +34 points rout. Details and setups in [matchups.md](matchups.md).
Unchanged by the rework (the field plan was not touched; regression CLI diffs 0).

## An AI-only year (seed 3) - what the journal shows (rework round 1)

Six realms, all AI (the four landed realms of the sandbox map plus two landless ones). Suvarna (expansionist) and
Giridurga (defensive) start at war; every court raises one engineer formation for its host (CD-B2: "raises Engineers
... 300 wealth", day 1-4 - no more batches of four). Suvarna storms Shilapur (day 44) and Kandaravasa; Giridurga sues
for peace (war score -30, field strength 0.77x Suvarna's - Suvarna refuses) and, its host fresh again, retakes its own
Shilapur (marches day 57, storms day 67 through the breach, again on day 105) and Kandaravasa (day 117-127): the
retake-first rule at work on both sides. Nilavana (opportunist, +0.3 against the weakened Giridurga) and Marudesha
declare on Giridurga on days 68 / 71 by the §7.14 rule; Suvarna declares on Marudesha (day 79). Marudesha's host on a
resupply order gains nothing at Dhanyagram for 3 days and moves to Kusumpur (day 148: "no grain gained in 3 days -
resupplies at Kusumpur instead"), full again on day 151. Suvarna, losing to the raiders (war score -44 to -55) but with
a weaker field host (0.29-0.76x), sues Marudesha every 30 days; once its host recovers it retakes Kusumpur (day 241)
and Dhanyagram (245) and storms Lavanapura (261). Nilavana takes Naukapattana, Shilapur, Dvaradurga and Pashanagram
from Giridurga and on day 246 offers peace on tribute; the next day Giridurga is bound as its tributary (23 a month).
Suvarna does the same on day 287-288 (15 a month). 17 captures in the year, 3 wars by the rule, 0 treasury days below
zero; no landmark started this year (Suvarna's Samrajya checklist lost towns to the raiders until day 245).

## Screenshots (scripts/shots/sim-02.cjs, port 4418, build in .build/sim-02/dist)

| File | What it shows |
|---|---|
| `battle-aivsai-deploy.png` | `?aivsai=1` plains battle (1,500 soldiers): both battle AIs deployed (plan memory `deployed`, postures attack / hold). |
| `battle-aivsai-contact.png` | the same battle 75 s into the fight, the camera panned onto the formations in contact (lead note: the melee is no longer a strip at the top under the toasts). |
| `battle-aivsai-river.png` | `?aivsai=1` river crossing (2,000 soldiers), 90 s in: the attacker's blocks in the ford, the defender's line on the bank. |
| `world-ai-year.png` | the world map after the rework's AI-only year (save from `autoplay.mjs` loaded in the game). |
| `world-ai-live.png` | a fresh sandbox run 45 days in the browser: every landed AI realm planned today, build / recruit jobs, farming-heavy labour. |
| `shots-report.json` | every assertion with its observed value (no console errors, page errors, failed requests or crash reports). |

Smoke (`SMOKE_SKIP_BUILD=1 SMOKE_DIST=.build/sim-02/dist SMOKE_PORT=4418 SMOKE_OUT=docs/sprint1/sim-02/smoke npm run
smoke`): all 14 shots passed with no console errors - [smoke/](smoke/) (`smoke-report.json` there).

Builds: production build `vite build --outDir .build/sim-02/dist` (done by the shots script) and the one-file build
`vite build --mode single --outDir .build/sim-02/single` (index.html 2,830.33 kB, gzip 997.41 kB) both succeed.

## Reproduce

```
npm run typecheck && npx vitest run tests/sim/ai
node scripts/sim-ai/matchups.mjs                 # 200-run matchup table -> matchups.md / .json
node scripts/sim-ai/sieges.mjs --seeds=3         # siege AI, AI vs AI -> sieges.md
node scripts/sim-ai/autoplay.mjs --seed=3        # AI year narrative + .build/sim-02/ai-year.sav
NODE_PATH=$(npm root -g) node scripts/shots/sim-02.cjs
node_modules/.bin/vite-node tests/sim/ai/harness/regression-cli.ts 10   # battle AI decisions vs matchups.json (diffs 0)
node_modules/.bin/vite-node tests/sim/ai/harness/siege-watch.ts engineers 30 1800      # one siege, every 30 s
node_modules/.bin/vite-node tests/sim/ai/harness/world-watch.ts 1 1080 120 sandbox     # an AI sandbox, every 120 days
```

## Requests (changes in other owners' files)

1. CTO - `tests/contracts/migration.test.ts`, "battles (incl. a finished one with an outcome)": `toV1Battle` strips
   `sides[].aiMemory` and the migration restores `{}`, while the finished battle holds the battle AI's plan memory
   (play state, like `orderTime`). Before the final hash comparison add
   `done.sides.forEach((s, i) => { s.aiMemory = finished.sides[i]!.aiMemory; });`. (Unchanged from round 0.)
2. QA Lead / SIM-01 - test isolation for premises that need inert AI realms. Add to `tests/sim/strategic/helpers.ts`:
   `import { setAiPassive } from '../../../src/sim/strategic/ai';` and
   `export function passiveAi(w: WorldState): WorldState { for (const id of Object.keys(w.factions)) setAiPassive(w, id, true); return w; }`;
   then `siege.test.ts` `fedSiege`: `const w = passiveAi(campaign(5));` and the same in "a host garrisoned in its
   besieged town ..." and "when the besieged store runs out ..."; `construction.test.ts` palace test:
   `const w = passiveAi(sandbox(5, { startMonth: 6 }));`; `politics.test.ts` careful year:
   `const w = passiveAi(peace(quiet(campaign(5))));`. (Unchanged from round 0.)
3. QA Lead / GP-01 (new, the lead asked for it) - `tests/sim/tactical/determinism.test.ts` "mid-siege": with tower
   manning the AI garrison's lone archer takes the tower by the main gate (x1.44 range / accuracy) and kills or panics
   the elephants, so the final `expect(full.siege!.gates.some((g) => g.hp < g.maxHp)).toBe(true)` fails (the resume
   hash check itself passes). The test is about resuming siege mechanics, not the AI: set `controllers: ['player',
   'player']` in its `testSetup` (checked: the elephants then break gate 0, 0 / 250.5 HP at tick 3200).
4. SIM-01 (CD-B3, the CD asked for it) - peace with tributary terms: in `respondToProposal`, `case 'peace'` with
   `p.terms.overlord` and `p.terms.payer` set and `tributePerMonth > 0`: `makePeace(...)` then
   `createTreaty(world, 'tributary', p.terms.overlord, p.terms.payer, p.terms, out)` (§7.10: a = overlord, b = payer),
   regardless of the tributary age gate (it is a peace term). `evaluateAcceptance(world, from, to, type, terms?)`:
   for 'peace' with `terms.overlord === to` add `{ id: 'tribute', label: 'They gain a tributary', value:
   RULES.diplomacy.acceptance.peace.tributeOffered }` (+30, CD data) and pass `p.terms` from `propose()`. The AI already
   sends these terms; until this lands it proposes the tributary right after the peace (`planTributeAfterPeace`).
5. SIM-01 - `src/sim/strategic/events.ts` (~line 395): `const choice = chooseAiEventChoice(world, scope.factionId, def,
   scope);` with `import { chooseAiEventChoice } from './ai';` (unchanged from round 0).
6. SIM-01 - `src/sim/strategic/autoresolve.ts` side setup: `commanderSkill: (commander?.skills.martial ?? 8) +
   (isPlayer ? 0 : DIFFICULTY_DEFS[world.difficulty]?.aiCommanderSkill ?? 0)` (unchanged from round 0).
7. Creative Director / SIM-01 (balance, optional) - `evaluateAcceptance` 'non_aggression': an expansionist whose war
   rule holds against the proposer accepts every pact from a weaker neighbour (U = 10 + 0.4 opinion), so in the
   3-year runs Suvarna renews a pact with Nilavana at 3-4x its strength and the map can stay at peace for 1-2 years.
   Suggest a term "They have designs on your lands" -30 when the receiver is expansionist and `own / proposer >
   warRatio`.
8. CTO (optional) - `src/app/debugApi.ts`: expose `aiJournal()`, `battlePlanLog()` and `setAiPassive()` on
   `window.__SAMRAJYA__` for QA.

## Known issues

- Perf budget vs machine speed: see Performance. Measured back to back on the same machine the rework is not slower than
  the round-0 code.
- A realm ground down to its capital turns its soldiers into the capital's garrison (levies "to hold" it while an enemy
  host stands near), so its field host stays small (seed 4: Suvarna 1 town from day ~300, host 11-140, 1,330 in the
  garrison) - it survives but does not rebuild a field army.
- Border towns can change hands every 10-20 days for months when two hosts each outmatch the other's garrison
  (seed 4 Dhanyagram / Kusumpur between Suvarna, Giridurga and Nilavana).
- Long peaces: non-aggression pacts renewed by SIM-01 acceptance (request 7) and tributary treaties freeze some
  3-year maps after day 300-400.
- The siege `ram_only` scenario (1 engineer formation, 3 spears against 2 spears + 2 archers on walls) is thrown back:
  the screen pays ~160 men for the walls' 40 volleys and the storm meets fresh defenders; it withdraws with its
  reason. The campaign AI storms only at 1.3x the defenders through a breach.
- The sandbox map has four landed realms; Kotanagara and Samudra take part only diplomatically there.
- Balanced mirror (row 7) sits at the low edge of its band (45.5%, side 0 attacking).

## Lead review, round 1 (Lead AI & Simulation Engineer)

Verdict: **changes requested**. The field battle AI, the eight intents, the matchup suite and most of the campaign AI
are strong; the siege AI and two campaign planners are not yet at the bar, and `npm test` is still red on the six
premise tests in other owners' files (requests 1-2 above, unchanged).

### Re-run (this review)

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` (after the review fixes) | 805 / 811 pass in 275 s; the 6 failures are the inert-AI premise tests of requests 1-2 (`tests/sim/strategic/{siege,construction,politics}.test.ts`, `tests/contracts/migration.test.ts`). Purity and both determinism suites pass. Before the fixes: 801 / 807 in 320 s (`tests/sim/ai/campaign.test.ts` alone 213 s - now 130 s, see fix 1). |
| `tests/sim/ai` | 45 / 45 (intents 11, matchups 9, campaign 21, perf 2, siege 2) |
| Battle AI decisions | `vite-node tests/sim/ai/harness/regression-cli.ts 10`: diffs 0 against `matchups.json` (the review touched no field decision) |
| Perf (review run) | runCampaignAI: Broken Crown mean 106 us, p95 297 us; AI sandbox mean 83 us, p95 337 us. runBattleAI at 40 formations: mean 93 us, p50 86 us, p95 180 us |
| Builds | `vite build --outDir .build/sim-02-review` and `--mode single` (index.html 2,612.55 kB, gzip 927.22 kB) succeed |
| Capture | `SHOTS_PORT=4468 SHOTS_DIST=.build/sim-02-review SHOTS_SKIP_BUILD=1 SHOTS_OUT=docs/sprint1/sim-02/review node scripts/shots/sim-02.cjs`: all checks pass -> [review/](review/) (AI year regenerated with the fixes: `node scripts/sim-ai/autoplay.mjs --seed=3 --out=docs/sprint1/sim-02/review`) |
| Smoke | `SMOKE_DIST=.build/sim-02-review SMOKE_PORT=4468 SMOKE_OUT=docs/sprint1/sim-02/review-smoke npm run smoke -- --scenes=menu,world,battle`: 8 / 8, no console errors -> [review-smoke/](review-smoke/) |

### Fixed by the reviewer (in the SIM-02 paths)

1. **Siege assault stalls for the whole time limit** (`ai/siege.ts`). When the ram crew routed, the finished ram they
   left behind counted as a siege tool forever, so the hopeless rule never fired: in
   `tests/sim/ai/harness/siege-watch.ts engineers` the besiegers stood idle from minute 5 to minute 30 (siege_held). Now
   only a crewed ram counts; a free engineer formation re-crews an abandoned ram (construct 'ram' at it - the GP-01
   rule); with no engineer, elephant, crewed ram, breach or ladder left, the side withdraws after 30 s (5.9 min there).
   The hopeless clock also resets when tools come back. This also took the 3-year sandbox seed 2 from 90 s to ~30 s
   (autoresolved assaults no longer run to the 30-minute limit). New `tests/sim/ai/siege.test.ts` (both cases fail on
   the previous code).
2. **Demobilisation split -> merge loop** (`ai/recruit.ts`, `ai/core.ts`, `ai.ts`). The costliest formations split off
   the main host became the strongest army, so the next strategy run picked them as the main host and merged the rest
   back into them (journal of the previous AI year: days 224 / 227 / 229 / 262, the "(detachment) (detachment)" names) -
   nothing was ever stood down. The split unit ids now go to plan memory (`standDown`); armies made only of them are
   no field army (`Situation.standDown`, never main, never merged) and are disbanded by the daily `planStandDown`.
   Test: "demobilisation: formations split off to be stood down are disbanded the next day, never merged back".
3. **Recruitment past the 0.04 x population ceiling** (`ai/recruit.ts`). Garrison levies were allowed up to 1.4 x the
   ceiling and a field batch could cross it. Every recruit now fits under the ceiling (DESIGN_SPEC §7.14); the peace
   target stays 70% (80% defensive) and the rest is garrison headroom. Tests updated ("at the ceiling nothing is
   raised", "every soldier raised fits under the ceiling").
4. Dead code: the commander-protection branch in `reserveUnit` (unreachable - engaged line formations never reach it),
   `void` suppressors and unused helpers in `field.ts`, `siege.ts`, `intents.ts`, `recruit.ts`.
5. Dev tool `tests/sim/ai/harness/siege-watch.ts` (an AI-vs-AI siege printed every N s) for the siege rework below.

The review fixes were captured in the Studio Head WIP snapshot `db29b1b`; this section and the review evidence are the
reviewer's own commit.

### Blocking - for the developer

1. **Siege attack: palisade work missing; archers duel the walls.** SIM-02 spec 1 lists "engineer works: rams,
   ladders, palisade"; no palisade is ever ordered (the old header claimed it). The besiegers' archers walk to 175 m of
   the wall archers (x1.2 range, x1.2 accuracy, x1.3 defence) and are destroyed before the ram arrives (siege-watch
   engineers: one archer formation destroyed at 2.5 min, the other at 6 men), after which the ram crew is shot off.
   Expected: archers stand off out of the walls' range until the ram / ladders are committed, a palisade screen covers
   them when they must close, and the ram goes in under that cover; the siege-watch 'engineers' scenario should breach
   or withdraw for a reason, not lose its archers for nothing.
2. **Siege defence: towers are not manned.** Spec 1: "man walls and towers". Archers fan on the wall walk; a tower is
   garrisoned only by accident. Expected: archers take the intact towers nearest the threat (a shooter within 10 m of a
   tower garrisons it). The reviewer tried it (greedy nearest-archer assignment, works) but reverted it: it changes the
   premise of `tests/sim/tactical/determinism.test.ts` "mid-siege" (the defender archer then out-shoots the elephants
   and the gate is never damaged) - file a request with QA / GP-01 for that premise when you land it. With towers manned
   the siege-watch 'elephants' scenario also exposed a jam: the besiegers' archers stopped in the broken gate and the
   storming spears queued behind them for 20+ minutes (siege_held) - clear the breach approach for the stormers.
3. **A siege AI acceptance test.** Nothing in `tests/sim/ai` exercised the siege plan before this review. Add
   end-to-end checks: ram built and carried to the gate, gate breached, breach held 60 s (siege_breach); defenders on
   walls / towers, gate repair, a sally against an exposed ram crew.
4. **Wartime recruitment freezes while saving for a landmark.** `spendable()` subtracts `saveWealth` for recruitment
   too (the build.ts header says construction holds it back). Previous AI year, seed 3: Suvarna at war recruited
   nothing from day ~115 to 186 with 3,000-4,700 in the treasury and +1,100 a month, and held 900-1,200 soldiers
   against a 2,300-2,600 target all year (reviewer probe of `situate` / `spendable` every 15 days: room = treasury -
   3 months of upkeep - the 4,000 landmark saving, mostly negative). Expected:
   at war or threatened, the landmark saving and the 3-month floor do not starve the army (e.g. a 1-month floor and no
   saving hold-back for recruitment); re-verify The Broken Crown 6/6 mixed and the sandbox audits (talk to the Creative
   Director if the campaign balance moves).
5. **`npm test` green**: requests 1-2 (CTO, QA / SIM-01) must land; re-run the full suite and update this README.

### Notes (non-blocking)

- `battle-aivsai-contact.png` frames the contact as a thin strip at the top of the image under four identical "The
  enemy wavers" toasts (UI-02 toast de-duplication); move the camera onto the melee for the evidence.
- runBattleAI p95 is 180-199 us at 40 formations (mean 93-97 us); keep an eye on the full re-plan spikes.
- Matchup row 4 (elephants vs horse) is won by the horse's `futile()` withdrawal (200 / 200), row 9 measures "defeated"
  (withdrawal counts) rather than rout; both defensible, say so in matchups.md.
