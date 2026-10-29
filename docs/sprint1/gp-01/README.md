# GP-01 - Tactical battle simulation: evidence and hand-off

OWNER: Gameplay Engineer - Tactical Battle Simulation (Gameplay team). Rules co-review: Creative Director.

The formation-level battle simulation of DESIGN_SPEC §6 (formations, orders, combat, missiles, elephants, morale,
rout / rally / surrender / pursuit, fatigue and cohesion, sieges, battle pathing, outcomes) and the visual soldier
layer, in `src/sim/tactical/**` (all of it except `battleai.ts` and `ai/**`, which belong to SIM-02). The formation
level is authoritative at 20 Hz (`BATTLE_DT` 0.05 s); the soldier layer only visualizes it; `autoresolve` runs the
same code headless. Everything is deterministic (all randomness from `state.rng`; caches are derived from state and
never change results - proven by the resume tests below).

## How to reproduce

| What | Command |
|---|---|
| Typecheck | `npm run typecheck` |
| Tactical suites (69 tests) | `npx vitest run tests/sim/tactical` |
| Pacing table (printed) | `npx vitest run tests/sim/tactical/pacing.test.ts` |
| Perf numbers (printed) | `npx vitest run tests/sim/tactical/perf.test.ts` |
| Headless traces only | `node_modules/.bin/vite-node tests/sim/tactical/tools/trace.ts out.json` |
| All evidence images | `NODE_PATH=$(npm root -g) node scripts/shots/gp-01.cjs` (port 4407, builds into `.build/gp-01`; `--only=maps` / `--only=engine`, `SHOTS_SKIP_BUILD=1`) |
| Smoke | `SMOKE_DIST=.build/gp-01 SMOKE_PORT=4407 SMOKE_OUT=docs/sprint1/gp-01/smoke npm run smoke -- --scenes=battle` |

## Evidence images (every image described)

In-engine (the shipping build, battle stepped with `__SAMRAJYA__.step(n)` while paused, then rendered; SwiftShader):

- **battle-melee.png** - The Open Plain, seed 2, 1,000 soldiers, AI vs AI, default camera 165 m behind the
  Suvarna (orange) line, 1:14 into the battle. In the middle distance the forward Suvarna horse and scouts are locked
  with the Giridurga (blue) line: mixed orange/blue soldiers, dust from the charge, one Giridurga block already
  pulled back. In the foreground the two Suvarna spear blocks (selection rings) are still marching up in line. The
  HUD cards show the Suvarna cavalry routed (`ROUT`) and the strengths 466 vs 433.
- **battle-melee-close.png** - the same tick, wheel-zoomed (cursor-anchored) to 45 m: the Suvarna elephant line
  (orange howdahs) and its horse (left) are locked with a Giridurga block whose blue soldiers are mixed in between
  the elephants; two more Giridurga spear blocks wait in line on the right; the selection rings of the Suvarna
  spear blocks run across the foreground.
- **battle-melee-overview.png** - the same tick from the overview camera (650 m): the whole open plain with the
  forest patches; the two armies are small clusters at the centre, the toast "A formation is breaking!" (the
  routed cavalry) under the clock.
- **battle-river-melee.png** - The Ford, seed 11, 17:00, overview camera, first clash (1:29): the river crosses the
  map east-west with the lighter shallow ford in the middle; the Suvarna host has walked into the ford and meets the
  Giridurga line on the north bank. Nobody is in the deep water.
- **battle-result.png** - the plains battle stepped to its end (3:27): the Victory screen with the outcome
  chronicle built by `outcome.ts` ("The Battle of The Open Plain: Suvarna defeated Giridurga; 349 fell", losses
  116 / 233 killed, 61 taken, the Giridurga commander captured, 34 men cut down in the pursuit).
- **battle-mobile-melee.png** - 390x844 @low quality, default camera, plains seed 2 mid-melee (1:54): a Suvarna
  spear block (selection ring) in the middle, the melee (orange and blue mixed) top right just under the HUD, the
  "A formation is breaking!" toast; the mobile HUD and order bar cover about half of the screen (noted for UI).
- **smoke/** - `npm run smoke --scenes=battle` against this build: `battle.png` (deployment, 0:25), `battle-close.png`
  (elephants forward, spear blocks with standards, archers), `battle-river-5000.png` (5,000 soldiers at the ford during
  deployment), `battle-mobile.png`; `smoke-report.json` has no console errors.

Top-down tactical maps from headless traces of the authoritative sim (`tests/sim/tactical/tools/trace.ts`, data in
`traces.json`; blue = side 0, orange = side 1 - validated categorical pair; trails every 2 s, dashed while routing;
footprints at the moment the most soldiers are in melee, black edge = front; x = melee contact, ring = rout):

- **tactical-plains.png** - The Open Plain, seed 2: the Giridurga line comes down from the north, its forward
  blocks hit the Suvarna scouts and horse first (0:38, most soldiers in melee); routs cascade on the Giridurga side
  (orange rings). Right: soldiers standing (Giridurga drops 501 -> 170; the step at 3:39 is a broken spear block
  surrendering, right after the Giridurga commander fell at 3:31) and average morale (Giridurga sinks under the
  wavering line at 4:00 and its last formation breaks at 4:06). Outcome: Suvarna by rout after 4:06; 254 killed /
  99 captured on the losing side.
- **tactical-river.png** - The Ford, seed 11: the deep river (dark blue) and the shallow ford (light blue). Every
  trail of both hosts funnels through the ford; the melee is fought on the ford's north lip (1:40). Both hosts take
  similar losses (436 vs 420 standing) but the Suvarna morale collapses after its commander falls (2:35) and
  Giridurga wins by rout after 2:59. The script asserts that no formation centroid ever sampled a deep-water cell.
- **tactical-siege.png** - scripted assault on a level-2 town wall (radius 120 m, 12 segments, 2 gates). The
  elephants batter the main (south) gate open at 1:18 (red X) while the ram engineers are still building under arrow
  fire (their crew falls from 40 to 18, so the 60 s build takes longer); the finished ram is carried toward the
  next gate and abandoned outside the wall when its crew routs (`ram (abandoned)`). Engineers raise ladders on the
  east wall (`ladders up`); the escalade spearmen meet the defenders' reserve, which sallies out of the north gate.
  Spearmen and guards go in through the broken gate; the guards hold the breach for 60 s uncontested ->
  `siege_breach` after 4:26.

## Numbers

**Worked examples (DESIGN_SPEC §6, all within 10 %)** - `tests/sim/tactical/worked-examples.test.ts`

| Example | Spec | Simulated |
|---|---|---|
| Spear vs spear melee, HP/s each | 4.7 | 4.71 / 4.71 (1 s sim: 4.68 / 4.70) |
| Elephant charge into unbraced spears | 378 HP = 38 men | 378.0 HP = 37.8 men |
| Elephant charge into braced spears: men lost / recoil HP / elephants | 13 / 189 / 1.2 | 13.2 / 189 / 1.18 (24-seed sim run: 12.8 / 183) |
| Horse into archers (shape-neutral) | 126 HP = 16 men | 126.0 HP = 15.7 men (wedge 163.8) |
| Volley at 120 m | 32 HP = 3.2 men | 32.5 HP = 3.25 men |
| Elephant panic per volley / after six | 8.6 % / 40 % | 8.64 % / 41.9 % |
| GDD morale example (target) | ~25 | 25.0 (R = -1.25) |
| Ram vs gate (level 2) | 251 HP at 16 HP/s | broken 15.7 s after arrival |
| Archers on the wall: range / hits | x1.44 hits | 230 m vs 160 m, x1.44 |

**Pacing (§13.1)** - 1,000-soldier balanced skirmish, open plain, Minister, AI vs AI, full-resolution terrain:
9 / 10 seeds within 3-8 min (median 4.76 min). Seed table printed by `pacing.test.ts`:

| Seed | Minutes | Winner | Lines met | Losses 0 / 1 |
|---|---|---|---|---|
| 1 | 5.66 | 0 | 121 s | 113 / 236 |
| 2 | 5.92 | 0 | 138 s | 121 / 214 |
| 3 | 3.12 | 1 | 67 s | 174 / 139 |
| 4 | 3.96 | 0 | 123 s | 97 / 188 |
| 5 | 2.54 | 0 | 45 s | 78 / 132 |
| 6 | 5.24 | 0 | 121 s | 119 / 232 |
| 7 | 4.95 | 0 | 133 s | 109 / 205 |
| 8 | 4.56 | 0 | 99 s | 85 / 219 |
| 9 | 3.87 | 0 | 61 s | 45 / 212 |
| 10 | 4.98 | 0 | 125 s | 119 / 253 |

**Performance (node, `perf.test.ts`; median of 100-step chunks over approach + melee, best of two deterministic
runs per chunk; camera on the front line, 'high' LOD distances)**

| Size | Formations | Formation step (budget) | Soldier layer (budget) |
|---|---|---|---|
| 1,000 soldiers | 15 | 0.05-0.18 ms (0.3) | 0.26-0.44 ms (1.0) |
| 5,000 soldiers | 75 | 0.30-0.45 ms (0.8) | 0.91-1.11 ms (3.0) |

Ranges are across runs on the shared 4-core box (a teammate's headless Chromium was using ~3 cores during most
runs). New-order pathing cost: median 0.87 ms, p90 1.5 ms (budget 2 ms). The river_crossing skirmish: 0
formation-ticks in deep water over 4 minutes.

**Determinism** - `determinism.test.ts`: identical runs hash-equal; a battle serialized and resumed during deployment,
mid-melee and mid-siege (ram being built, gate under attack, ladders up) equals the uninterrupted run. In-engine,
two page loads of the same seed stepped to the same tick give the same `__SAMRAJYA__.hash()` (shots-report.json).

## Decisions taken where the spec is silent (for Creative Director review)

- Battle grid 8 m; movement-profile costs `round(10 / speed)`; a cell is deep water if its centre or any corner is
  (conservative: centroids never enter rivers); fords close when `weather.flood > 0.5`.
- Melee contact: footprints within 0.75 m each to start, kept until they open past 2 m each (hysteresis - formations
  jostling on the contact line no longer flicker in and out of melee or spam `contact` events).
- Orders: `advance` default 30 m; aggressive stance engages within 30 m and pursues 60 m, but never steps out of a
  brace against an enemy that is closing at >= 0.5 m/s; shift-queue max 16; flank point = width / 2 + 35 m + depth / 2
  (so a flank charge has its 20 m run-in); withdraw = walk backwards while in contact, then turn.
- Shape change: 3 s + 0.02 s per soldier, cohesion capped at 0.6 meanwhile. Turning in place beyond 90 deg costs
  0.1 cohesion per further 90 deg; no cohesion recovery while turning.
- Rally (commander): 120 m, +15 morale, rallies routers above 35, 90 s cooldown; refused while the commander fights.
- Missiles: arrow 55 m/s, aim scatter 1.5 m + 2.5 % of range, 30 % of the volley hits friends in a target's melee.
- Siege: segment HP = level x 1000 x fortDefense / 12; gates 1 / 2 / 4 by settlement; towers 6 x level; ram 4 HP/s x
  engineers / 10 x siege / 4; elephants batter gates at siege x soldiers HP/s; engineers repair 10 HP/s; a routing,
  surrendered or dead ram crew abandons the ram where it stands (a construct 'ram' order at it re-crews it); ladder
  crews step back 25 m when the ladder is up; breach hold radius 30 m, contested within 40 m.
- Outcome: pursuit kills 70 % / captures 30 %; commander fate of the loser 50 % safe / 30 % captured / 20 % killed;
  war score +-20 scaled by the loss ratio; `durationSec` counts fighting time only (deployment excluded).
- Skirmish setup: 30 s deployment, 40 min time limit; world battles should pass 60 s / 30 min (request to SIM-01).

## Known issues

- `tests/contracts/migration.test.ts` > "battles (incl. a finished one with an outcome)" fails: the test strips v2
  fields from a *finished* battle and expects the migration defaults to restore them, but GP-01 now writes live values
  into `orderTime`, `outcome.warScore` and `outcome.sides[].formations[].routedEnemies`. CTO-owned; exact change
  requested in the GP-01 report.
- Balance: Suvarna (heartland) beats Giridurga (highland) on 9 / 10 balanced plains seeds - a roster asymmetry
  for the Creative Director, not a rules bug (mirror matches split).
- The battle camera cannot be placed from the debug API; `battle-melee-close.png` relies on a fixed screen anchor
  for the deterministic seed-2 battle (request to the BattleScene owner for a `battle.focus` debug command).
- The soldier renderer does not yet map `SOLDIER_ANIM.reload` (12) / `charge` (13) (request to GFX-04).
