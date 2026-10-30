/**
 * DESIGN_SPEC §13.3 battle matchups (autoresolve QA: plains, equal wealth unless noted, AI vs AI) - the row definitions
 * shared by tests/sim/ai/matchups.test.ts (CI-light, 40 seeds) and scripts/sim-ai/matchups.mjs (200 runs each, writes
 * docs/sprint1/sim-02/matchups.md). OWNER: AI Engineer - Battle AI, Intents & Campaign AI (SIM-02).
 *
 * Every row runs the real skirmish setup on the seed's 'plains' map at the autoresolve terrain resolution, Kotanagara
 * on both sides unless the row names factions (Kotanagara fields no variants on the classes involved), Minister
 * difficulty, 40-minute limit. A "win" is the outcome's winner; withdrawal is a defeat (withdraw_all at the
 * personality's withdrawAt), a draw is nobody's win.
 */
import type { SideIndex } from '../../../../src/core/types';
import { composeArmy } from '../../../../src/sim/tactical/setup';
import type { ArmyRow, BattleRun, BattleSpec } from './battles';
import { armyCost, armyOfCost, median, runBattle, wilson } from './battles';

export interface MatchupRow {
  id: string;
  /** The §13.3 matchup text. */
  matchup: string;
  /** The §13.3 expectation text. */
  expected: string;
  /** How the row is set up here. */
  setup: string;
  spec: (seed: number) => BattleSpec;
  /** The measured event of one run (e.g. "spearmen win"). */
  success: (r: BattleRun) => boolean;
  /** Target band on the success rate (or on the rate difference for paired rows). */
  min?: number;
  max?: number;
  /** Paired row: the measure is rate(this) - rate(baseline row with the same seeds). */
  baseline?: (seed: number) => BattleSpec;
}

const K: [string, string] = ['citystates', 'citystates'];
const SP = (n = 120): ArmyRow[number] => ({ unitClass: 'spearmen', soldiers: n });
const ARC = (shape?: 'loose'): ArmyRow[number] => ({ unitClass: 'archers', soldiers: 100, ...(shape ? { shape } : {}) });
const CAV = (n: number): ArmyRow[number] => ({ unitClass: 'cavalry', soldiers: n });
const SUVARNA = composeArmy(500, 'heartland', 'balanced');
const GIRIDURGA_EQUAL_COST = armyOfCost('highland', armyCost(SUVARNA), 'balanced');
const won = (side: SideIndex) => (r: BattleRun): boolean => r.winner === side;
/** The side was defeated (broke - rout / annihilation / surrender - or withdrew beaten). */
const defeated = (side: SideIndex) => (r: BattleRun): boolean => r.winner !== null && r.winner !== side;

export const MATCHUPS: MatchupRow[] = [
  {
    id: 'spear_vs_horse_frontal',
    matchup: '3 spearmen vs 1.5 horsemen (equal cost), horse attacks frontally',
    expected: 'spearmen win >= 75%',
    setup: 'spearmen 120 x 3 (AI) vs horsemen 60 + 30 scripted to charge the nearest spear block head-on every second',
    spec: (seed) => ({ seed, factions: K, armies: [[SP(), SP(), SP()], [CAV(60), CAV(30)]], script: { side: 1, kind: 'frontal_charge' } }),
    success: won(0),
    min: 0.75,
  },
  {
    id: 'horse_vs_guarded_archers',
    matchup: 'Same, horse attacks archers guarded by 1 spear',
    expected: 'horse loses >= 60%',
    setup: 'spearmen 120 + archers 100 x 2 (AI) vs horsemen 60 + 30 (AI: the counters-aware targeting sends the horse at the archers)',
    spec: (seed) => ({ seed, factions: K, armies: [[SP(), ARC(), ARC()], [CAV(60), CAV(30)]] }),
    success: won(0),
    min: 0.6,
  },
  {
    id: 'mixed_vs_spears',
    matchup: '4 spear + 2 archers vs 6 spearmen',
    expected: 'mixed side wins >= 60%',
    setup: 'spearmen 120 x 4 + archers 100 x 2 vs spearmen 120 x 6, both AI',
    spec: (seed) => ({ seed, factions: K, armies: [[SP(), SP(), SP(), SP(), ARC(), ARC()], [SP(), SP(), SP(), SP(), SP(), SP()]] }),
    success: won(0),
    min: 0.6,
  },
  {
    id: 'elephants_vs_horse',
    matchup: '1 elephant formation vs 2 horsemen',
    expected: 'elephants win >= 80%',
    setup: 'war elephants 8 vs horsemen 60 x 2, both AI',
    spec: (seed) => ({ seed, factions: K, armies: [[{ unitClass: 'war_elephants', soldiers: 8 }], [CAV(60), CAV(60)]] }),
    success: won(0),
    min: 0.8,
  },
  {
    id: 'elephants_vs_loose_archers',
    matchup: '1 elephant formation vs 4 archers in loose',
    expected: 'archers win >= 60%',
    setup: 'war elephants 8 vs archers 100 x 4 deployed in loose order, both AI',
    spec: (seed) => ({ seed, factions: K, armies: [[{ unitClass: 'war_elephants', soldiers: 8 }], [ARC('loose'), ARC('loose'), ARC('loose'), ARC('loose')]] }),
    success: won(1),
    min: 0.6,
  },
  {
    id: 'guards_vs_spears',
    matchup: 'Royal guards vs 2.5 spearmen (equal cost)',
    expected: 'guards win 45-60%',
    setup: 'royal guards 60 (900 wealth) vs spearmen 120 + 120 + 60 (900 wealth), both AI',
    spec: (seed) => ({ seed, factions: K, armies: [[{ unitClass: 'elite_guards', soldiers: 60 }], [SP(), SP(), SP(60)]] }),
    success: won(0),
    min: 0.45,
    max: 0.6,
  },
  {
    id: 'balanced_mirror',
    matchup: 'Balanced Host vs Balanced Host, same faction',
    expected: '45-55%',
    setup: 'Kotanagara Balanced Host vs Kotanagara Balanced Host, 1,000 soldiers; the rate is side 0 (the attacker) winning',
    spec: (seed) => ({ seed, factions: K, compositions: ['balanced', 'balanced'] }),
    success: won(0),
    min: 0.45,
    max: 0.55,
  },
  {
    id: 'giridurga_hill',
    matchup: 'Giridurga on a hill (+15 m) vs Suvarna on the plain, equal cost',
    expected: 'Giridurga wins >= 60%',
    setup: `Suvarna Balanced Host 500 (${Math.round(armyCost(SUVARNA))} wealth) vs Giridurga Balanced Host of equal cost (${GIRIDURGA_EQUAL_COST.reduce((a, f) => a + f.soldiers, 0)} soldiers) on a 15 m plateau under its deploy zone`,
    spec: (seed) => ({ seed, factions: ['heartland', 'highland'], armies: [SUVARNA, GIRIDURGA_EQUAL_COST], hill: 15, hillSide: 1 }),
    success: won(1),
    min: 0.6,
  },
  {
    id: 'commander_killed',
    matchup: 'Commander killed at minute 2 (scripted)',
    expected: "that side's rout probability +30 points",
    setup: 'Kotanagara Balanced mirror; side 0 loses its commander 120 s after deployment (the battle.ts commanderFalls effects) vs the same seeds untouched; the rate is side 0 defeated',
    spec: (seed) => ({ seed, factions: K, compositions: ['balanced', 'balanced'], script: { side: 0, kind: 'kill_commander', atSec: 120 } }),
    baseline: (seed) => ({ seed, factions: K, compositions: ['balanced', 'balanced'] }),
    success: defeated(0),
    min: 0.3,
  },
];

export interface MatchupResult {
  row: MatchupRow;
  n: number;
  k: number;
  rate: number;
  ci: [number, number];
  /** Paired rows: the baseline rate and the difference (rate - baseline). */
  baseRate?: number;
  baseCi?: [number, number];
  diff?: number;
  medianMin: number;
  reasons: Record<string, number>;
  pass: boolean;
}

/** Run one row over seeds 1..n (and its baseline). */
export function runMatchup(row: MatchupRow, n: number, onRun?: (seed: number, r: BattleRun) => void): MatchupResult {
  let k = 0;
  let kb = 0;
  const mins: number[] = [];
  const reasons: Record<string, number> = {};
  for (let seed = 1; seed <= n; seed++) {
    const r = runBattle(row.spec(seed));
    onRun?.(seed, r);
    if (row.success(r)) k++;
    mins.push(r.minutes);
    reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
    if (row.baseline && row.success(runBattle(row.baseline(seed)))) kb++;
  }
  const rate = k / n;
  const res: MatchupResult = { row, n, k, rate, ci: wilson(k, n), medianMin: median(mins), reasons, pass: false };
  if (row.baseline) {
    res.baseRate = kb / n;
    res.baseCi = wilson(kb, n);
    res.diff = rate - res.baseRate;
    res.pass = res.diff >= (row.min ?? -Infinity) && res.diff <= (row.max ?? Infinity);
  } else {
    res.pass = rate >= (row.min ?? -Infinity) && rate <= (row.max ?? Infinity);
  }
  return res;
}

/**
 * The 95% interval of the measured rate overlaps the target band - what a sample of `n` can show about a band target
 * (the 200-run script reports the point estimates against the bands).
 */
export function consistentWithTarget(res: MatchupResult): boolean {
  if (res.diff !== undefined) return res.diff >= (res.row.min ?? -Infinity) && res.diff <= (res.row.max ?? Infinity);
  return res.ci[1] >= (res.row.min ?? -Infinity) && res.ci[0] <= (res.row.max ?? Infinity);
}

export function formatRate(r: number): string {
  return `${(r * 100).toFixed(1)}%`;
}
