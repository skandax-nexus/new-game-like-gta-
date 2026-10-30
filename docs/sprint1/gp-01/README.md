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
| Tactical suites (90 tests) | `npx vitest run tests/sim/tactical` |
| Pacing table (printed) | `npx vitest run tests/sim/tactical/pacing.test.ts` |
| Perf numbers (printed) | `npx vitest run tests/sim/tactical/perf.test.ts` |
| Composition examples and statistics (printed) | `npx vitest run tests/sim/tactical/compose.test.ts` |
| Pairing / mirror / §13.3 probes (README tables) | `node_modules/.bin/vite-node tests/sim/tactical/tools/probes.ts pace,default,review,all21,...` (`N=<seeds>`) |
| Headless traces only | `node_modules/.bin/vite-node tests/sim/tactical/tools/trace.ts out.json` |
| All evidence images | `NODE_PATH=$(npm root -g) node scripts/shots/gp-01.cjs` (port 4407, builds into `.build/gp-01`; `--only=maps` / `--only=engine`, `SHOTS_SKIP_BUILD=1`, `SHOTS_DIST`, `SHOTS_OUT`) |
| Smoke | `SMOKE_SKIP_BUILD=1 SMOKE_DIST=.build/gp-01 SMOKE_PORT=4407 SMOKE_OUT=docs/sprint1/gp-01/smoke npm run smoke -- --scenes=battle` |

## Evidence images (every image described)

Re-captured in Creative Director rework round 2. Builds come from a clean export of `9aa38bd`; its tactical code is that of
`f00d04b`. This excludes a teammate's uncommitted `src/sim/strategic/**` work. The capture script is the one committed with
this README. `gp-01.cjs` passes 22 / 22 checks (`shots-report.json`).

In-engine captures use the shipping build. The battle is stepped with `__SAMRAJYA__.step(n)` while paused, then rendered
under SwiftShader. The plains captures run seed 2 with the in-engine defaults: Suvarna vs Giridurga, both on the Balanced
Host (Giridurga's skirmish default since the CD commit `93a1755`), at 08:30. They press `begin_battle` at tick 0, so the
clock shows fighting time and there is no deployment. The melee tick is chosen from the battle state: after 8 % losses, the
script steps 50 ticks at a time until a Suvarna spear or guard block is fighting a Giridurga one. The battle state is read
from a quick save, because the debug state has no positions.

- **battle-melee.png** - The Open Plain, seed 2, 1,000 soldiers, AI vs AI, 1:57 (Suvarna 444, Giridurga 393).
  - Default camera, 165 m behind the Suvarna (orange) line. The selected 114-man spear block is in the foreground.
  - In the middle distance, the Suvarna guards (ring) and the seven remaining elephants have closed on the Giridurga
    (blue) spear blocks. Dust rises over the contact, and a second Suvarna spear line comes up on the left.
  - A routed cavalry clump is on the left edge. The CAV and SCT cards read `ROUT`.
- **battle-melee-close.png** - the same tick. The script selected the engaged Suvarna guards (57) through their HUD
  card, focused the camera with `Home` (`camera_focus`) and wheel-zoomed to 45 m.
  - The orange guards with their standard are locked front to front with a large blue Giridurga spear block.
  - A second blue block stands behind with its ring. A Suvarna elephant (orange howdah) pushes into a blue block on
    the left.
  - Fallen men and horses lie on the right, where the cavalry fought.
  - The focus check: the camera looks 17 m from the guards' centroid.
- **battle-melee-overview.png** - the same tick from the overview camera (650 m). The whole open plain and its forest
  patches are visible; the two hosts are small clusters in the centre.
- **battle-river-melee.png** - The Ford, seed 11, 17:00, overview camera, first clash at 1:24 (476 vs 466).
  - The river crosses the map east-west, with the lighter shallow ford in the middle.
  - The Suvarna blocks stand in the ford and meet the Giridurga line on its north lip. Nobody is in the deep water.
  - Fading toasts ("The enemy wavers", "A formation is breaking!") overlap the speed buttons (noted for UI).
- **battle-result.png** - the plains battle stepped to its end (4:11 of fighting). The Victory screen shows the outcome
  chronicle from `outcome.ts`:
  - "The Battle of The Open Plain: Suvarna defeated Giridurga; 388 fell", and "carried the field after 4 minutes:
    their foes broke and fled".
  - Losses: 96 killed / 0 taken against 292 killed / 7 taken; Suvarna took 7 prisoners.
  - The Giridurga commander was killed, and 31 Giridurga men were cut down or taken in the rout.
  - 404 / 500 vs 201 / 500 remain.
  - Behind the screen: a Suvarna spear block on the left and the dead of the cavalry fight on the right.
- **battle-mobile-melee.png** - 390x844 @low quality, default camera, plains seed 2 at 0:54 (the 8 %-losses tick).
  - The Suvarna elephants (ring) are in the middle, the Giridurga blocks at the top and the Suvarna spear blocks at
    the bottom left.
  - Three toasts overlap the speed buttons, and the order bar covers about 40 % of the screen (noted for UI).
- **smoke/** - `npm run smoke --scenes=battle` against this build: 4 / 4 shots, no console errors
  (`smoke-report.json`).
  - `battle.png`: seed 7, deployment at 0:25. Cards: SPR 118 / 117, ARC 98, GRD 59, CAV 59, ELE 8, SCT 29, SUP 12. The
    Balanced Host at Battle 1,000 is unchanged by the round-2 split rule.
  - `battle-close.png`: 0:35. Eight elephants forward, the 118-man spear line with its standard, the guards in square
    on the right.
  - `battle-river-5000.png`: 5,000 soldiers deploying behind the ford. Cards: SPR 148 / 147 x 7, ARC 123 / 123 / 122 /
    122, GRD 74 / 74 / 73 / 73, CAV 74 ... There are 61 formations; round 1 had 75, with SPR 118 x 7 / 117 x 3.
  - `battle-mobile.png`: Clash 600 @low. Cards: SPR 141 (one block; round 1 split it 71 / 70), ARC 59, GRD 35, CAV
    35, ELE 5, SCT 18, SUP 7.
  - In the first smoke run, `battle-river-5000` came out with a blank 3D view and `battle-mobile` with a stale HUD
    (0:00, 1x). This is the known SwiftShader frozen-frame issue (Known issues); `smoke.cjs` cannot detect it. A
    re-run gave clean frames (dominant colour 1.0-2.2 %); all four were looked at.

The top-down tactical maps come from headless traces of the authoritative sim (`tests/sim/tactical/tools/trace.ts`;
the data is in `traces.json`). Drawing conventions:
- Blue is side 0 and orange is side 1 (a validated categorical pair).
- Trails are sampled every 2 s and are dashed while routing.
- Footprints show the moment when the most soldiers are in melee; a black edge marks the front.
- An x marks a melee contact; a ring marks a rout.

The maps:

- **tactical-plains.png** - The Open Plain, seed 2, Balanced Host vs Balanced Host (09:00).
  - Footprints at 3:02 show the Suvarna guards and two spear blocks locked with the Giridurga guards and a spear block
    in the centre. The Suvarna elephants have pushed north through to the Giridurga archers and supply train. A
    Giridurga spear block routs in the north, and rings on both sides mark 13 routs and 5 rallies.
  - Soldiers standing: Giridurga drops 500 -> 232 before the pursuit, Suvarna 500 -> 404.
  - Average morale: Giridurga dips to the wavering line around 3:10 and recovers with a rally at 3:26. Its commander
    falls at 4:05, its last three formations break between 4:08 and 4:12, and its morale collapses to 0.
  - Outcome: Suvarna wins by rout after 4:12. Giridurga: 292 killed, 7 captured, 31 lost in the pursuit, 7 formation
    routs, commander killed.
- **tactical-river.png** - The Ford, seed 11, 17:00.
  - The map shows the deep river (dark blue) and the shallow ford (light blue). Every trail of both hosts funnels
    through the ford, and the melee is fought on its north lip (footprints at 2:36).
  - The hosts trade evenly: 110 killed each, with 16 routs and 9 rallies back and forth. Both sides' archers are out of
    arrows by 2:20.
  - From 4:46 to 5:24 the Suvarna elephants, a spear block, the scouts, the cavalry, the guards and the last spear
    block break in turn.
  - Only Suvarna's dry archers and supply train are left standing, and those do not hold the field (§6.8 amendment). So
    Giridurga wins by rout after 5:24, although Suvarna has more men on the field (421 vs 390 before the pursuit; 40
    Suvarna men lost in it).
  - Deep water: the trace checks every tick exactly, and 0 of 6,472 ticks had a formation centroid in a deep-water cell
    (see R2-3a below for the check).
- **tactical-siege.png** - a scripted Nilavana assault on a level-2 Kotanagara town wall (radius 120 m, 12 segments, 2
  gates).
  - The elephants batter the main (south) gate open at 1:18 (red X) while the ram engineers are still building under
    arrow fire. The finished ram is abandoned outside the south-west wall when its crew routs at 3:27.
  - Engineers raise ladders on the east wall (`ladders up`), and the spearmen there fight the defenders' reserve spear
    block.
  - The garrison's gate spearmen rout at 2:30 and the gate archers at 2:41. The west-wall archer block (100 men) has
    been out of arrows since 1:55 and stands on its wall.
  - The last defending spear block routs at 3:54. Under the round-2 rule the dry archers on their own wall still hold
    the field, so the garrison is not broken.
  - The attacker's guards have held the inside of the broken gate since 3:23. They win by `siege_breach` at 4:23,
    60 s later; the CD's scratch prototype predicted 4.4 min.
  - The defenders' average morale reads 70 at the end because only the wall archers are still standing.
  - Totals: Nilavana 488 -> 374 standing; Kotanagara 410 -> 254 (150 killed, 6 captured, 25 lost in the pursuit of
    its routers); 70 volleys.

## Numbers

**Worked examples (DESIGN_SPEC §6, all within 10 %)** - `tests/sim/tactical/worked-examples.test.ts` (unchanged in round 2)

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

**Pacing (§13.1)** - the 1,000-soldier balanced skirmish: Balanced Host vs Balanced Host, Suvarna vs Giridurga, open
plain, Minister difficulty, AI vs AI, full-resolution terrain. 10 / 10 seeds end within 3-8 min (median 5.48 min, the
CD's figure). Each row was printed by `pacing.test.ts` after the CD's ally_routed change (-0.15):

| Seed | Minutes | Winner | Lines met | Losses 0 / 1 | Pursuit 0 / 1 | Routs 0 / 1 |
|---|---|---|---|---|---|---|
| 1 | 5.08 | 0 | 124 s | 145 / 211 | 0 / 22 | 3 / 5 |
| 2 | 7.92 | 0 | 136 s | 184 / 261 | 0 / 32 | 5 / 7 |
| 3 | 5.96 | 0 | 67 s | 149 / 227 | 0 / 40 | 4 / 7 |
| 4 | 5.28 | 0 | 126 s | 139 / 205 | 0 / 23 | 4 / 5 |
| 5 | 5.31 | 0 | 50 s | 110 / 197 | 0 / 28 | 4 / 6 |
| 6 | 6.52 | 0 | 119 s | 134 / 265 | 0 / 29 | 5 / 7 |
| 7 | 4.37 | 0 | 134 s | 125 / 181 | 0 / 28 | 3 / 5 |
| 8 | 4.21 | 0 | 99 s | 78 / 188 | 0 / 29 | 2 / 6 |
| 9 | 7.02 | 0 | 61 s | 139 / 254 | 0 / 12 | 3 / 7 |
| 10 | 5.65 | 0 | 142 s | 92 / 206 | 0 / 43 | 2 / 7 |

**Performance** - measured in node by `perf.test.ts`: the median of 100-step chunks over approach and melee, taking the
better of two deterministic runs per chunk, with the camera on the front line and 'high' LOD distances.

| Size | Formations | Formation step (budget) | Soldier layer (budget) |
|---|---|---|---|
| 1,000 soldiers | 15 | 0.045-0.047 ms (0.3) | 0.24-0.25 ms (1.0) |
| 5,000 soldiers | 61 (was 75) | 0.24-0.26 ms (0.8) | 0.92-1.02 ms (3.0) |

- These are two runs in round 2 on the shared 4-core box, with load average 2-5 (a teammate's build and Chromium
  captures were running).
- 5,000 soldiers now form 61 formations instead of 75, because of the round-2 split rule, so the formation step got
  cheaper (round 1: 0.33-0.36 ms).
- The wall-archer exception and the new split add no per-step allocation: `holdsTheField` reads the cached context, and
  `composeArmy` runs once at setup.
- New-order pathing cost: median 0.76 ms, p90 0.80 ms (budget 2 ms).
- The river_crossing skirmish spends 0 formation-ticks in deep water over 4 minutes.

**Determinism** - `determinism.test.ts`:
- Identical runs give equal hashes.
- A battle serialized and resumed equals the uninterrupted run. This is tested during deployment, mid-melee and
  mid-siege (ram being built, gate under attack, ladders up).
- In-engine, two page loads of the same seed stepped to the same tick give the same `__SAMRAJYA__.hash()`: `a185ec15`
  on both loads (`shots-report.json`).

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
  `composeArmy` follows §10.1 as amended for GP-01 (blocks up to 1.25 x `menPerFormation`; round 2 below).

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
The numbers in this section are as of round 1, before the CD data commits `c104339` / `93a1755`. Round 2 below has
the current figures, and its 1.25 x split rule supersedes the per-class split described under A.

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

## Creative Director rework (round 2)

The review raised three items. Two are rule changes the developer asked for, recorded as [REQ GP-01] in the
DESIGN_SPEC; the third is an evidence refresh after the CD's data commits. Every stage passes typecheck and the tests on
its own. The commits:

- `5b8b7bb`, R2-1 code and tests: a Studio Head WIP snapshot swept them in between the stage's green test run and its
  commit. History is not rewritten; the empty commit `44bb5dd` records the stage.
- `f00d04b`: R2-2.
- `9aa38bd`: R2-3a.
- The README commit: R2-3.

**R2-1 - a siege garrison's dry archers on their own walls hold the field** (DESIGN_SPEC §6.8 and §6.6.5 [REQ GP-01],
CD commit `c104339`).
- `outcome.ts` `holdsTheField(f, ctx)` now takes the battle context (`FieldContext = Pick<BattleContext, 'fort'>`).
  An archer-category formation that is out of arrows and not in melee still holds the field while it stands on its own
  walls or towers (`morale.ts` `onWalls`: inside the ring, within `WALL_WALK_DEPTH` = 15 m of the radius).
- `sideBroken(state, side, ctx?)` passes the context through. Without one, it uses `rulesContext(state)` (the cached
  context, or a rules-only view) when the battle has a fortification.
- `checkOutcome` and the `destroy_army` objective pass the step context. `onWalls` only reads `ctx.fort`.
- Tests in `siege.test.ts`:
  - (a) The garrison melee routs while its dry archers stand on intact walls. The side is not broken, the battle goes
    on, and the defender wins `siege_held` at the time limit.
  - (b) The same archers stepped off the walls, into the town square or outside the ring, are broken: the attacker
    wins by `rout` within 10 s.
  - (c) A breach held 60 s still ends a siege whose dry wall archers stand on the far side of the ring
    (`siege_breach`).
  - (a) and (c) fail with the exception disabled (checked).
- The scripted siege trace now ends by `siege_breach` at 4:23; before, the garrison broke by `rout` at 3:54.
- The `gp-01.cjs` siege check now requires `siege_breach`, the garrison's melee routed, and its dry archers still on
  the walls. Observed: formation 8, 100 men.

**R2-2 - skirmish blocks up to 25 % over strength** (DESIGN_SPEC §10.1 [REQ GP-01], CD commit `4752b58`).
- `setup.ts` `splitClassBudget`: `k = max(1, ceil(budget / floor(1.25 x menPerFormation)))`, still capped by the room
  under `MAX_FORMATIONS_PER_SIDE`. The class budget is split evenly.
- New exports: `SKIRMISH_OVERSTRENGTH` (1.25) and `skirmishBlockCap(cls)`. The `composeArmy` signature and the
  largest-remainder class apportionment are unchanged.
- `compose.test.ts` checks every faction x composition x size combination:
  - no formation above 1.25 x per;
  - none below 0.5 x per, except a sole spearmen or archers formation;
  - with k >= 2, none below 62.5 % (floor);
  - k equals the rule for every class;
  - even splits; total <= budget; roster only.
  It prints the examples and the statistics below.

| All 120 combinations (536 class allocations) | Round 1 rule | Round 2 rule |
|---|---|---|
| Overflow splits (more blocks than `round(budget / per)`) | 240 (CD count: 238) | 16 |
| Average fill / range | 86.9 % / 50-100 % | 107.9 % / 55-125 % |
| Formations / soldiers dropped | 1,988 / 0 | 1,604 / 0 |
| Suvarna Riders, 500 a side | spearmen 61/61, archers 51/51, cavalry 46/46/46/45, chariots 16/16, scouts 21/20/20 | spearmen 122, archers 102, cavalry 61 x 3, chariots 16 x 2, scouts 31/30 |
| Nilavana Elephant Shock, 500 a side | 12 formations: spearmen 90/90/89, archers 56/56, guards 34/33, elephants 6/6/6, scouts 17/17 | 7 formations: spearmen 135/134, archers 112, guards 67, elephants 9/9, scouts 34 |
| Suvarna Balanced Host, Clash 600 / Battle 1,000 / Field of Kings 5,000 | SPR 71/70 / SPR 118/117 / 75 formations in all (both sides) | SPR 141 / SPR 118/117 (unchanged) / 61 formations |

The effect of R2-2 alone, measured in the same harness at `44bb5dd` and at `f00d04b` (`tools/probes.ts`, full-resolution
terrain, AI vs AI):

| Probe | Before (`44bb5dd`) | After (`f00d04b`) |
|---|---|---|
| Elephant Shock mirror (Nilavana, 20 seeds) | 12 formations a side; median 4.36 min, 13 / 20 in 3-8; 7.5 rallies a battle | 7 a side; median 5.36 min, 14 / 20; 3.0 rallies |
| Riders mirror (Marudesha, 20 seeds) | 13 a side; median 1.14 min, 2 / 20; wins 8 / 12 | 9 a side; median 1.44 min, 1 / 20; wins 16 / 4 |
| 21 faction-default pairings x 4 | 52 / 84 in 3-8, 24 under 3, 8 over 8; median 4.00 | 50 / 84, 25 under 3, 9 over 8; median 4.30; 0 time limits and 0 draws in both |
| Balanced Host probes (pacing, in-engine default, Balanced mirrors), Old Chariot Host, Hill Fort review pairing | identical | identical (these compositions do not change at 1,000) |

The CD measured the Shock mirror at 3.6 -> 5.2 min and the pairings at 43 / 84 with a 129-resolution terrain harness.
These figures use the in-engine full-resolution terrain; the direction is the same. The pairings that fall in or out of
the band move both ways with only four seeds each. Examples: forest-forest 4.4 -> 5.9, frontier-citystates 3.2 -> 5.6,
forest-citystates 3.1 -> 2.0.

**R2-3 - the evidence refreshed after the CD's data commits.** `c104339` sets `BALANCE.morale.allyRoutShock` to -0.15,
and `93a1755` makes Giridurga's skirmish default the Balanced Host.
- Every table and image above was re-run or re-captured with both commits and R2-1 / R2-2.
- R2-3a (`9aa38bd`):
  - The re-capture changed the river trace. A routing spear block now slides along the river edge, with its centroid
    on the boundary between a passable cell and a deep-water cell (x = -134.6, grid column 61.99999).
  - The old `gp-01.cjs` check classified the 2 s frame samples, whose positions are rounded to 0.1 m, and counted 3 of
    them in deep water.
  - An instrumented replay that checks every tick against the battle grid itself finds that the centroid never enters
    a deep-water cell. So the old check had a rounding artefact; the pathing was not at fault.
  - `trace.ts` now counts deep-water formation-ticks on every tick, with exact positions against the battle grid (0 of
    6,472). `gp-01.cjs` requires that count to be 0 and still re-checks the frames, skipping samples within 0.05 m of
    a cell boundary.
- The close-up no longer uses a fixed screen anchor. It focuses the camera on the player formation that is in melee,
  found from the battle state, so it follows the melee when data changes move it (see the images).

| Probe (`tools/probes.ts`, full-resolution terrain, AI vs AI, plains unless noted) | Round 1 README | Round 2 |
|---|---|---|
| §13.1 pacing, `pacing.test.ts` (10 seeds) | 10 / 10 in 3-8, median 4.97 min, wins 10 / 0 | 10 / 10, median 5.48 min (the CD's figure), wins 10 / 0 |
| In-engine default: Suvarna vs Giridurga, faction defaults, 08:30 (20 seeds) | Balanced vs Hill Fort Garrison: median 2.95 min, 9 / 20 | Balanced vs Balanced: median 5.18 min, 19 / 20, wins 20 / 0 (CD: 4.6 min, 20 / 20 on 129-resolution terrain) |
| Same on The Ford, the `?scene=battle` default preset (20 seeds) | - | median 6.22 min, 16 / 20, wins 19 / 1 |
| Review pairing: Giridurga vs Kotanagara, Hill Fort Garrison both (10 seeds; `outcome.test.ts`) | median 13.2 min, 0 time limits, 0 draws, wins 3 / 7 | median 12.96 min (10.3-14.9), 0 time limits, 0 draws, wins 1 / 9 |
| 21 faction-default pairings x 4 | 44 / 84 in 3-8, 16 over 8, 0 time limits, 0 draws | 50 / 84, 25 under 3, 9 over 8, 0 time limits, 0 draws; median 4.30 min |
| Kotanagara Balanced mirror (30 seeds) | wins 20 / 10, 26 / 30 in band | wins 17 / 13, 26 / 30, median 5.86 min |
| Suvarna Balanced mirror (30 seeds) | wins 15 / 15, 27 / 30 | wins 13 / 17, 30 / 30, median 6.09 min |
| Riders mirror (Marudesha, 20 seeds) | median ~0.9 min | median 1.44 min, 1 / 20 (CD: 1.2 min) |
| Elephant Shock mirror (Nilavana, 20 seeds) | - | median 5.36 min, 14 / 20 |
| Old Chariot Host mirror (Suvarna, 20 seeds) | - | median 3.37 min, 10 / 20 |

§13.3 matchups: Kotanagara on both sides, explicit armies through the skirmish line-order auto-deploy, default shapes,
20 seeds (40 for the two marked *).

| Matchup | Target | Round 1 | Round 2 |
|---|---|---|---|
| 3 spear vs 1.5 horse | spears >= 75 % | 20 / 20 | 20 / 20 |
| 1 spear + 2 archers vs 1.5 horse | horse loses >= 60 % | 19 / 20 | 20 / 20 |
| 1 elephant vs 2 horse | elephants >= 80 % | 16 / 20 | 16 / 20 |
| 1 elephant vs 4 archers* | archers >= 60 % | 35 / 40 | 35 / 40 |
| 4 spear + 2 archers vs 6 spear* | mixed >= 60 % | 3 / 40 | 1 / 40 (CD §14.4: 1-2 / 20) |
| Guards vs 2.5 spear | guards 45-60 % | 0 / 20 | 0 / 20 |

The two failing §13.3 targets, and the fast mounted pairings, are battle-AI / balance debts the CD recorded in §14.4.
They are to be re-measured after SIM-02; neither round-2 rule change touches them, because explicit armies and field
battles are unaffected.

## Known issues

- `tests/contracts/migration.test.ts` > "battles (incl. a finished one with an outcome)" fails. This is the only failing
  test in `npm test` (616 / 617).
  - The test strips the v2 fields from a *finished* battle and expects the migration defaults to restore them.
  - GP-01 writes live values into `orderTime`, `outcome.warScore` and `outcome.sides[].formations[].routedEnemies`.
  - The test is CTO-owned. The exact change has been requested in the GP-01 report since round 0.
- Balance, for the CD and SIM-02 (not rules bugs; measured with the baseline battle AI):
  - Suvarna beats Giridurga on 10 / 10 pacing seeds and 20 / 20 in-engine default seeds. This is a roster asymmetry
    (elephants); the same-faction mirrors split 13 / 17 and 17 / 13.
  - Hill Fort Garrison pairings still take 10-15 min (Kotanagara mirror median 14.9 min), because the guards fight in
    their default square.
  - 25 of 84 faction-default pairings end under 3 min, mostly mounted or elephant matchups (Nilavana-Marudesha 1.3,
    Marudesha mirror 1.5, Nilavana-Kotanagara 2.0). The Riders mirror is 1 / 20 in band.
  - The §13.3 mixed-arms and guards targets fail (see above; CD §14.4).
- The river trace shows a side breaking with more men on the field. Suvarna loses the ford battle with 421 men against
  390, because its last melee block routs while its dry archers and carts do not hold the field. This follows §6.8 as
  amended, and is noted so the CD sees it in play.
- The battle camera cannot be placed from the debug API. The close-up therefore reads the battle state from a quick
  save, which raises a "Chronicle saved" toast; the script waits for it to fade. It then focuses through the HUD card
  and `Home`. The request to the BattleScene owner for a `battle.focus` / `battle.formations` debug command stands.
- Toasts stack over the battle HUD's speed buttons (`battle-mobile-melee.png`, `battle-river-melee.png`), and the
  mobile order bar covers about 40 % of the screen. Noted for UI.
- The soldier renderer does not yet map `SOLDIER_ANIM.reload` (12) / `charge` (13) (request to GFX-04).
- Under SwiftShader load, a frozen frame can present a blank 3D view or a stale HUD. In round 2, 2 of the 4 shots in the
  first smoke run were affected; a re-run was clean.
  - This is likely a dynamic-resolution canvas resize just before `__SAMRAJYA__.freeze(true)`, in renderer / debug-API
    code outside GP-01.
  - `gp-01.cjs` detects and retakes such shots. `scripts/smoke.cjs` (CTO) only checks for errors and accepts them;
    the request to the CTO / GFX-01 stands.
