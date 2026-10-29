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
| Tactical suites (86 tests) | `npx vitest run tests/sim/tactical` |
| Pacing table (printed) | `npx vitest run tests/sim/tactical/pacing.test.ts` |
| Perf numbers (printed) | `npx vitest run tests/sim/tactical/perf.test.ts` |
| Headless traces only | `node_modules/.bin/vite-node tests/sim/tactical/tools/trace.ts out.json` |
| All evidence images | `NODE_PATH=$(npm root -g) node scripts/shots/gp-01.cjs` (port 4407, builds into `.build/gp-01`; `--only=maps` / `--only=engine`, `SHOTS_SKIP_BUILD=1`) |
| Smoke | `SMOKE_DIST=.build/gp-01 SMOKE_PORT=4407 SMOKE_OUT=docs/sprint1/gp-01/smoke npm run smoke -- --scenes=battle` |

## Evidence images (every image described)

In-engine (the shipping build, battle stepped with `__SAMRAJYA__.step(n)` while paused, then rendered; SwiftShader):

The plains captures run seed 2 with the in-engine defaults (Suvarna Balanced Host vs Giridurga Hill Fort Garrison,
08:30) and press `begin_battle` at tick 0, so the clock is fighting time (no deployment). Re-captured after the
Creative Director rework (round 1) against a clean export of commit `27c5686` (`.build/gp-01`).

- **battle-melee.png** - The Open Plain, seed 2, 1,000 soldiers, AI vs AI, default camera 165 m behind the Suvarna
  (orange) line at 1:24 (Suvarna 458, Giridurga 460). In the middle distance the forward Suvarna horse, scouts and
  elephants are locked with the Giridurga (blue) line; behind them two Suvarna blocks march up in line. The toast
  "A formation is breaking!" is up and the cavalry card reads `ROUT`. The formation cards show the new §10.1 split
  (SPR 118 / 117, ARC 98, GRD 56, CAV, ELE 8, SCT 29, SUP 12 - no 4-man remainder formations any more).
- **battle-melee-close.png** - the same tick, wheel-zoomed (cursor-anchored) to 45 m: the eight Suvarna elephants
  (orange howdahs) push into a Giridurga block (blue soldiers between the rightmost elephants); on the left the
  Suvarna horse and scouts fight the blue spear line (a fallen horse in the grass); two more Giridurga blocks stand
  on the right; the 118-man Suvarna spear line with its standard and selection ring fills the foreground.
- **battle-melee-overview.png** - the same tick from the overview camera (650 m): the whole open plain with its forest
  patches; the two hosts are small clusters at the centre, the "A formation is breaking!" toast under the clock.
- **battle-river-melee.png** - The Ford, seed 11, 17:00, overview camera, first clash at 1:24 (475 vs 474): the river
  crosses the map east-west with the lighter shallow ford in the middle; the Suvarna host stands in the ford and meets
  the Giridurga line on its north lip. Nobody is in the deep water.
- **battle-result.png** - the plains battle stepped to its end (2:10 of fighting): the Victory screen with the outcome
  chronicle from `outcome.ts` ("The Battle of The Open Plain: Suvarna defeated Giridurga; 190 fell", losses 76 / 114
  killed, 16 taken, the Giridurga commander wounded, 60 men cut down or taken in the rout; 424 / 500 vs 370 / 500
  remain). On the right edge the two Giridurga archer blocks still stand in formation. This end is a plain all-rout
  cascade (a headless replay of the same setup shows both archer blocks routing with 11 arrows left), not the new
  arrowless-archer rule; before this rework the same setup ended after 2:20. Four stacked "The enemy wavers" toasts
  overlap the Victory title (noted for UI).
- **battle-mobile-melee.png** - 390x844 @low quality, default camera, plains seed 2 mid-melee (1:24): Suvarna blocks
  (selection ring) in the middle, the melee top right just under the HUD, the "A formation is breaking!" toast; the
  mobile HUD and order bar cover about half of the screen (noted for UI).
- **smoke/** - `npm run smoke --scenes=battle` against this build (4/4, no console errors in `smoke-report.json`):
  `battle.png` (seed 7, deployment 0:25; cards SPR 118 / 117, ARC 98, GRD 59, CAV 59, ELE 8, SCT 29, SUP 12 -
  exactly the largest-remainder split of 500), `battle-close.png` (0:35: eight elephants forward, the 118-man spear line with its
  standard, the 59 guards in square on the right), `battle-river-5000.png` (5,000 soldiers deploying behind the ford:
  SPR 118 x7 / 117 x3, ARC 98 x5, GRD 59 x3 ...), `battle-mobile.png` (Clash 600 @low: SPR 71 / 70, ARC 59, GRD 35,
  CAV 35, ELE 5, SCT 18, SUP 7 - every formation at least half strength).

Top-down tactical maps from headless traces of the authoritative sim (`tests/sim/tactical/tools/trace.ts`, data in
`traces.json`; blue = side 0, orange = side 1 - validated categorical pair; trails every 2 s, dashed while routing;
footprints at the moment the most soldiers are in melee, black edge = front; x = melee contact, ring = rout):

- **tactical-plains.png** - The Open Plain, seed 2, Balanced Host vs Balanced Host: the Giridurga line comes down
  from the north; footprints at 3:04 (most soldiers in melee) show the Suvarna cavalry / elephant / guard knot in the
  centre locked with Giridurga spears and guards, routs (orange rings) cascading on the Giridurga side, the Giridurga
  cavalry and carts routing off the north edge. Right: soldiers standing (Giridurga drops 500 -> 261 before the
  pursuit, Suvarna 500 -> 412) and average morale (Giridurga stays above the wavering line until its commander falls
  at 4:10; its last three formations break within seven seconds and its morale collapses to 0 at 4:17). Outcome:
  Suvarna by rout after 4:17; Giridurga 267 killed / 7 captured / 35 lost in the pursuit, 6 formation routs,
  commander killed; 13 routs and 5 rallies in all.
- **tactical-river.png** - The Ford, seed 11: the deep river (dark blue) and the shallow ford (light blue). Every
  trail of both hosts funnels through the ford; the melee is fought on the ford's north lip (footprints at 3:46). The
  two hosts trade evenly (378 vs 378 standing before the pursuit, 16 routs and 8 rallies back and forth) until the
  Giridurga commander falls at 5:16 and four Giridurga blocks break within six seconds; Suvarna wins by rout after
  5:22 (Giridurga 147 killed, 7 captured, 32 lost in the pursuit).
  The script asserts that no formation centroid ever sampled a deep-water cell.
- **tactical-siege.png** - scripted assault on a level-2 town wall (radius 120 m, 12 segments, 2 gates). The
  elephants batter the main (south) gate open at 1:18 (red X) while the ram engineers are still building under arrow
  fire; the finished ram is carried off and abandoned outside the south-west wall when its crew routs
  (`ram (abandoned)`). Engineers raise ladders on the east wall (`ladders up`) and the spearmen there fight the
  defenders' reserve spear block. The garrison's gate spearmen rout at 2:30, the gate archers at 2:40; the west-wall
  archer block has been out of arrows since 1:55 and stands idle on the wall. When the last defending spear block
  routs at 3:54 the garrison is broken (CD amendment to §6.8: arrowless archers out of melee no longer hold the field)
  and the attacker wins by rout - §6.6.5 "defenders are broken", which captures the town in the SIM-01 write-back just
  like `siege_breach`. That is why the defenders' average morale still reads 71 at the end: only the intact wall
  archers are left standing. (Before the amendment the same script ran on until the breach was held 60 s -> 
  `siege_breach` at 4:26; the breach-hold path is covered by `siege.test.ts`.)

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

**Pacing (§13.1)** - 1,000-soldier balanced skirmish (Balanced Host vs Balanced Host, Suvarna vs Giridurga), open
plain, Minister, AI vs AI, full-resolution terrain: 10 / 10 seeds within 3-8 min (median 4.97 min). Seed table
printed by `pacing.test.ts` (after the rework):

| Seed | Minutes | Winner | Lines met | Losses 0 / 1 | Pursuit 0 / 1 |
|---|---|---|---|---|---|
| 1 | 6.20 | 0 | 127 s | 138 / 218 | 0 / 22 |
| 2 | 4.51 | 0 | 134 s | 142 / 178 | 0 / 30 |
| 3 | 6.47 | 0 | 67 s | 161 / 298 | 0 / 28 |
| 4 | 5.19 | 0 | 121 s | 147 / 197 | 0 / 24 |
| 5 | 4.86 | 0 | 50 s | 88 / 171 | 0 / 28 |
| 6 | 4.75 | 0 | 120 s | 132 / 179 | 0 / 28 |
| 7 | 4.62 | 0 | 135 s | 116 / 189 | 0 / 28 |
| 8 | 4.16 | 0 | 99 s | 77 / 185 | 0 / 29 |
| 9 | 5.52 | 0 | 61 s | 86 / 235 | 0 / 32 |
| 10 | 5.07 | 0 | 133 s | 116 / 265 | 0 / 31 |

**Performance (node, `perf.test.ts`; median of 100-step chunks over approach + melee, best of two deterministic
runs per chunk; camera on the front line, 'high' LOD distances)**

| Size | Formations | Formation step (budget) | Soldier layer (budget) |
|---|---|---|---|
| 1,000 soldiers | 15 | 0.047-0.057 ms (0.3) | 0.24-0.29 ms (1.0) |
| 5,000 soldiers | 75 | 0.33-0.36 ms (0.8) | 0.94-1.11 ms (3.0) |

After the rework: one solo run and one inside the full `npm test` run on the shared 4-core box (load average ~4);
round-0 ranges were 0.05-0.18 / 0.26-0.44 and 0.30-0.45 / 0.91-1.11 ms. The face fix adds no allocation (shares are
still counted over `engagedWith`). New-order pathing cost: median 0.76-1.14 ms, p90 0.86-1.47 ms (budget 2 ms). The
river_crossing skirmish: 0 formation-ticks in deep water over 4 minutes.

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
- Missiles: arrow 55 m/s, aim scatter 1.5 m + 2.5 % of range; `RULES.battle.friendlyFireShare` of a volley into a
  target's melee hits friends (0.3 -> 0.1 in the Creative Director co-review, commit edca44a).
- Siege: segment HP = level x 1000 x fortDefense / 12; gates 1 / 2 / 4 by settlement; towers 6 x level; ram 4 HP/s x
  engineers / 10 x siege / 4; elephants batter gates at siege x soldiers HP/s; engineers repair 10 HP/s; a routing,
  surrendered or dead ram crew abandons the ram where it stands (a construct 'ram' order at it re-crews it); ladder
  crews step back 25 m when the ladder is up; breach hold radius 30 m, contested within 40 m.
- Outcome: pursuit kills 70 % / captures 30 %; commander fate (§6.11): `safe` while the commander stands, `captured`
  if his formation (or side) surrendered, otherwise a fallen commander is killed 50 % / wounded 30 % / captured 20 %;
  war score +-20 scaled by the loss ratio; `durationSec` counts fighting time only (deployment excluded).
- Skirmish setup: 30 s deployment, 40 min time limit; world battles should pass 60 s / 30 min (request to SIM-01).

## Lead review fixes (first review, Lead Gameplay Engineer)

- `pathing.ts` `directClear`: the straight-line memo key `from * 31 + to` aliased different cell pairs, so a cached
  "clear" answer could be returned for a pair whose line crosses deep water (formation aimed straight at the river
  instead of routing to the ford) and paths depended on cache history (a resumed battle could diverge). The key is
  now exact; regression test in `pathing.test.ts`.
- `soldiers.ts`: once the commander has fallen (§6.11) his figure is the next casualty realized and the commander
  role is never handed to an heir (before, a bodyguard inherited the flag and the fallen commander stayed on screen);
  test in `soldiers.test.ts`.
- `battle.ts` `surrender`: routers that already fled off the map have left the battle (§6.8) and are no longer
  captured by a later side surrender; test in `orders.test.ts`.
- This README: commander-fate line corrected to match `outcome.ts`.
- Review evidence: `review-smoke/` (`SMOKE_PORT=4457`, `.build/gp-01-review`); the images and `traces.json` /
  `shots-report.json` above were re-captured with the fixed code.

## Creative Director rework (round 1)

Three blocking rules items; commits `10fb4db` (A), `c4342e0` (B), `27c5686` (C); each stage green on its own.

**A - `setup.ts` `composeArmy` (§10.1: no formation below half strength).** Class budgets are apportioned by largest
remainder (they now sum to exactly the side budget; the per-class `Math.round` could exceed it). Per class
`k = max(1, round(budget / per))`, raised to `ceil(budget / per)` when `budget / k > per`; the budget is split evenly
(sizes differ by at most one man, each <= per), never with a separate remainder formation; classes below half a
formation are still dropped except a sole spearmen / archers formation; `MAX_FORMATIONS_PER_SIDE` caps k and the rest
is dropped. `compose.test.ts` checks all 120 faction x composition x size combinations (before: 71 had sub-half
formations, CD count). Examples at Battle 1,000: Suvarna Riders spearmen 61 / 61, archers 51 / 51, cavalry
46 / 46 / 46 / 45, chariots 16 / 16, scouts 21 / 20 / 20 (was spearmen:4, archers:4, cavalry:4, chariots:4, scouts:4
remainders); Nilavana Balanced elephants 5 / 4, guards 34 / 33, scouts 17 / 16, carts 7 / 6. Note for the CD: the
rule turns a budget just over one formation into two half-size ones (Riders spearmen 122 -> 61 / 61, Nilavana
elephants 9 -> 5 / 4); a weight nudge (data) gives one full block instead if preferred.

**B - `combat.ts` melee faces (§6.6.1).** `faceToward` now returns the real aspect (0 front, 1 left, 2 right, 3 rear)
and shares are counted per real aspect; `faceSize` = files on the front, ranks on each flank, files / 2 on the rear;
all-round shapes present their files on every aspect. `attackAspect` (the defender-side multiplier) is unchanged.
`faces.test.ts`, on the CD probe (120 spears; 20-horse formations snapped to the front, left and right):

| | Before | After |
|---|---|---|
| Surrounded square, frontage per attacker | 4.58 (11 x 1.25 / 3) | 13.75 (11 x 1.25) |
| Surrounded square, total | 7.7 HP/s (CD probe) | 20.6 HP/s (= 3 x one attacker; 1 s sim 21.4 HP) |
| Same block in line, front + left + right | 22.6 HP/s (CD probe) | 23.6 HP/s (strikers 30 + 6.25 + 6.25) |
| Two attackers on opposite flanks, each | 3.1 (CD probe) | 6.25 (the full 5 ranks x 1.25) |

The surrounded square now strikes with 0.97 x the line's strikers (41.25 vs 42.5) and deals 0.874 x its HP/s. The
gap below 0.9 is entirely the square's own §6.2 `meleeAttack` 0.9 (data); the line also gained from fix (b) (its
flanks now strike with 5 ranks each, not 2.5). The test therefore asserts strikers >= 0.9 x the line and HP/s >=
0.9 x the line x (square / line attack modifier); against the CD probe's line figure (22.6 HP/s) the square deals
0.91 x. The single-attacker worked examples are unchanged (10 / 10 within 10 %).

**C - `outcome.ts` `sideBroken` (CD amendment to §6.8).** `holdsTheField(f)`: a combat class and not an
archer-category formation with ammo 0 that is not in melee. A side left with only arrowless archers, engineers and
carts is broken; both sides at once is a draw. `checkOutcome` reports such a loser as `rout`, not `annihilation`.
`outcome.test.ts` covers the rule, the draw, archers with arrows / in melee, a routed spear block next to dry
archers, and the review pairing.

Measured with all three (plains, 1,000 soldiers, AI vs AI unless noted):

| Probe | Before | After |
|---|---|---|
| Giridurga vs Kotanagara, Hill Fort Garrison (10 seeds) | median 40.0 min, 6 time limits, 5 draws | median 13.2 min, 0 time limits, 0 draws, wins 3 / 7 |
| Same with the guards' default shape set to line (probe only) | - | median 6.8 min, 7 / 10 in 3-8 min, wins 5 / 5 |
| All 21 faction-default pairings x 4 seeds (84 battles) | 28 / 84 in 3-8 min, 27 > 8 min, 6 time limits, 3 draws | 44 / 84 in 3-8 min, 16 > 8 min, 0 time limits, 0 draws |
| §13.1 pacing: Balanced vs Balanced, Suvarna vs Giridurga (10 seeds) | 9 / 10 in band, median 5.38, wins 9 / 1 | 10 / 10 in band, median 4.97, wins 10 / 0 |
| Same-faction Balanced mirror, Kotanagara (30 seeds) | wins 5 / 25, 16 / 30 in band | wins 20 / 10, 26 / 30 in band |
| Same-faction Balanced mirror, Suvarna (30 seeds) | wins 13 / 17, 27 / 30 in band | wins 15 / 15, 27 / 30 in band |
| In-engine default (Suvarna Balanced vs Giridurga Garrison, 08:30, 20 seeds) | median 3.11 min, 9 / 20 in band | median 2.95 min, 9 / 20 in band |

§13.3 matchups (citystates both sides, explicit armies in their default shapes, 20 seeds; 40 for the two marked *):
3 spear vs 1.5 horse 20 / 20 (unchanged); horse vs archers + 1 spear, horse loses 19 / 20 (unchanged); elephants vs 2
horse 16 / 20 (unchanged); elephants vs 4 archer formations*, archers win 40 / 40 -> 35 / 40; 4 spear + 2 archers vs 6
spear*, mixed side wins 8 / 40 -> 3 / 40; guards vs 2.5 spear 0 / 20 (unchanged). Split by fix (base + B alone, base +
C alone, 40 seeds): A does not apply (explicit armies) and B leaves the matchups identical; both moves come from C.
When all of a side's melee blocks are routing at once and its archers are dry, the side is now broken immediately,
so those blocks can no longer rally (§6.8, max 2) and come back. The mixed-arms target (>= 60 %) already failed in
this harness before the rework (8 / 40; the CD's own harness measured 12 / 20 at friendly fire 0.1).

## Lead re-review (round 1, Lead Gameplay Engineer)

Re-run against a clean export of HEAD `2e220f0` (tactical code as of `cd237a6`; a teammate's uncommitted
`src/assets/**` work excluded):

- `tsc --noEmit` clean; `npm test` 602 / 603 (the only failure is the CTO-owned migration test, see Known issues);
  tactical + purity + determinism 93 / 93; all worked examples, the pacing table (median 4.97 min, 10 / 10) and the
  review pairing (0 time limits, 0 draws) reproduce exactly.
- Perf measured with a SwiftShader capture competing for the CPU (load average ~7): 1,000 soldiers 0.070 / 0.468 ms,
  5,000 soldiers 0.595 / 1.382 ms (formation / soldier layer; budgets 0.3 / 1.0 and 0.8 / 3.0); new-order pathing
  median 0.80 ms, p90 0.90 ms.
- `vite build` and `vite build --mode single` (2.27 MB) into `.build/gp-01-review*`; `gp-01.cjs` 16 / 16 against
  that build, in-engine hash `946d4e94` on both loads; smoke `--scenes=battle` on port 4457 4 / 4, no console errors
  (`review-smoke/`, re-captured).
- composeArmy at 2,500 per side (Field of Kings): only Riders of the Frontier reaches `MAX_FORMATIONS_PER_SIDE` (48),
  trimming 35 men; no class is lost.

Reviewer fix: **`scripts/shots/gp-01.cjs` blank-shot guard.** In the re-capture, `battle-mobile-melee.png` came out
with a blank 3D view (HUD over the dark page background, no WebGL frame), and the script still reported "ok". It was
reproduced in a standalone run, with no context loss or errors. Between page loads the canvas backing size changed
(dynamic resolution under load), so the likely cause is a resize clearing the drawing buffer right before `freeze`.
`shot()` now measures the share of the most common colour (every rendered evidence / smoke image: 1.0-2.3 %; the
blank one: 32.7 %), re-renders and retakes at >= 15 % (up to 3 attempts), and records a "3D view rendered" check per
shot. Validated with `--only=engine`: `battle-river-melee` came out blank (70.1 %) on the first attempt and was
retaken correctly; 17 / 17 checks. The committed images above all measure <= 2.3 % (none blank).

## Known issues

- `tests/contracts/migration.test.ts` > "battles (incl. a finished one with an outcome)" fails: the test strips v2
  fields from a *finished* battle and expects the migration defaults to restore them, but GP-01 now writes live values
  into `orderTime`, `outcome.warScore` and `outcome.sides[].formations[].routedEnemies`. CTO-owned; exact change
  requested in the GP-01 report (unchanged since round 0).
- `tests/core/assets.test.ts` > "publishes every referenced file with the recorded size" fails at HEAD itself
  (`public/assets/fx/fx_dust/color_1024.webp` is 71,472 bytes, the manifest says 70,680 - both from the Studio Head WIP
  snapshot a979c44 of TA-07's in-flight flipbook rework). Not tactical code; the TA-07 owner's.
- For the CD (rules): the §6.8 amendment also applies in sieges. A garrison whose wall archers ran dry and whose melee
  blocks all rout is broken, and the attacker takes the town without holding a breach (`tactical-siege.png`).
  Exempting archers standing on the walls (`onWalls`) would keep the old siege behaviour; this is a one-line change
  in `holdsTheField` if wanted.
- For the CD / SIM-02 (balance, not rules bugs): Suvarna beats Giridurga on 10 / 10 balanced plains seeds (a roster
  asymmetry: elephants; same-faction mirrors split); Hill Fort Garrison pairings still take 10-15 min because the
  guards fight in their default square (the probe with guards in line: 6.8 min); the Riders mirror (frontier vs
  frontier) ends in a median 0.9 min in both builds; the in-engine default pairing runs short (median ~3 min).
- The battle camera cannot be placed from the debug API; `battle-melee-close.png` relies on a fixed screen anchor
  for the deterministic seed-2 battle (request to the BattleScene owner for a `battle.focus` debug command).
- The soldier renderer does not yet map `SOLDIER_ANIM.reload` (12) / `charge` (13) (request to GFX-04).
- Under SwiftShader load a frozen frame can present a blank 3D view (3 of 23 frames in the lead re-review). This is
  likely a dynamic-resolution canvas resize just before `__SAMRAJYA__.freeze(true)`, in renderer / debug-API code
  outside GP-01. `gp-01.cjs` now detects and retakes such shots; `scripts/smoke.cjs` (CTO) only checks for errors
  and could accept one (request to the CTO / GFX-01).
