/**
 * GP-01 balance / pacing probe harness (not a test): headless AI-vs-AI battles through the real skirmish setup
 * (composeArmy + line-order auto-deploy, or explicit armies), full-resolution battle terrain (the in-engine
 * heightfield), 40-minute limit. Prints one summary line per probe; used for the README tables.
 * OWNER: Gameplay Engineer - Tactical Battle Simulation.
 *
 *   node_modules/.bin/vite-node tests/sim/tactical/tools/probes.ts pace,default,review,all21     (N=<seeds> overrides)
 *
 * Probes: pace (§13.1: Suvarna vs Giridurga, Balanced Host both, 09:00, 10 seeds), default (the in-engine default:
 * Suvarna vs Giridurga, faction defaults, 08:30, plains, 20), defaultford (same on the Ford, 20), review (Giridurga vs
 * Kotanagara, Hill Fort Garrison both, 10), kota / suvarna (Balanced mirrors, 30), riders (Riders of the Frontier,
 * Marudesha mirror, 20), shock (Elephant Shock, Nilavana mirror, 20), chariot (Old Chariot Host, Suvarna mirror, 20),
 * all21 (the 21 faction-default pairings x 4 seeds), and the §13.3 matchups (Kotanagara both sides, explicit armies):
 * horse, horsearch, elehorse, elearch (40), mixed (40), guards.
 */
import type { BattleEventRecord, BattleState, SkirmishSetup, UnitClass } from '../../../../src/core/types';
import { BATTLE_DT } from '../../../../src/core/constants';
import { Heightfield } from '../../../../src/core/terrain/heightfield';
import { createBattle, createSkirmishSetup, stepBattle } from '../../../../src/sim/tactical/battle';

type Army = [UnitClass, number][];
interface RunOpts {
  seed: number;
  preset?: SkirmishSetup['preset'];
  factions?: [string, string];
  armies?: [Army, Army];
  compositions?: [string, string];
  total?: number;
  hour?: number;
}
interface RunResult {
  winner: number | null;
  reason: string;
  min: number;
  loss: [number, number];
  start: [number, number];
  rallies: number;
  formations: [number, number];
}

const hfCache = new Map<string, Heightfield>();

function runBattle(o: RunOpts): RunResult {
  const fa = o.factions?.[0] ?? 'citystates';
  const fb = o.factions?.[1] ?? 'citystates';
  const setup = createSkirmishSetup({
    seed: o.seed,
    preset: o.preset ?? 'plains',
    totalSoldiers: o.total ?? 1000,
    playerFactionId: fa,
    enemyFactionId: fb,
    armies: o.armies
      ? [
          { factionId: fa, formations: o.armies[0].map(([c, n]) => ({ unitClass: c, soldiers: n })) },
          { factionId: fb, formations: o.armies[1].map(([c, n]) => ({ unitClass: c, soldiers: n })) },
        ]
      : null,
    playerSide: 0,
    hour: o.hour ?? 9,
    season: 'sharad',
    weather: 'clear',
    difficulty: 'normal',
    aiVsAi: true,
    compositions: o.compositions,
  });
  const key = JSON.stringify(setup.terrain);
  let hf = hfCache.get(key);
  if (!hf) {
    hf = Heightfield.generate(setup.terrain);
    hfCache.set(key, hf);
  }
  const st: BattleState = createBattle(setup, hf);
  const out: BattleEventRecord[] = [];
  let rallies = 0;
  while (!st.outcome) {
    out.length = 0;
    stepBattle(st, BATTLE_DT, hf, out);
    for (const e of out) if (e.kind === 'formation_rallied') rallies++;
  }
  const oc = st.outcome;
  const start: [number, number] = [0, 0];
  const nf: [number, number] = [0, 0];
  for (const f of st.formations) {
    start[f.side] += f.maxSoldiers;
    nf[f.side]++;
  }
  return {
    winner: oc.winner,
    reason: oc.reason,
    min: oc.durationSec / 60,
    loss: [oc.sides[0].killed + oc.sides[0].captured, oc.sides[1].killed + oc.sides[1].captured],
    start,
    rallies,
    formations: nf,
  };
}

function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

function summary(name: string, rs: RunResult[]): string {
  const n = rs.length;
  const w = [0, 0, 0];
  for (const r of rs) w[r.winner === null ? 2 : r.winner]!++;
  const band = rs.filter((r) => r.min >= 3 && r.min <= 8).length;
  const reasons: Record<string, number> = {};
  for (const r of rs) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  const mins = rs.map((r) => r.min);
  const lossPct = (s: 0 | 1): string => ((rs.reduce((t, r) => t + r.loss[s] / r.start[s], 0) / n) * 100).toFixed(0);
  const rallies = rs.reduce((t, r) => t + r.rallies, 0) / n;
  return `${name.padEnd(12)} A ${w[0]} / B ${w[1]} / draw ${w[2]}  median ${median(mins).toFixed(2)} min (${Math.min(...mins).toFixed(1)}-${Math.max(...mins).toFixed(1)})  in 3-8: ${band}/${n}  loss A ${lossPct(0)}% B ${lossPct(1)}%  rallies ${rallies.toFixed(1)}/battle  formations ${rs[0]!.formations.join('/')}  ${JSON.stringify(reasons)}`;
}

const SP = (n = 120): [UnitClass, number] => ['spearmen', n];
const N0 = process.env.N ? Number(process.env.N) : 0;
function seeds(n: number, f: (s: number) => RunOpts): RunOpts[] {
  const a: RunOpts[] = [];
  for (let s = 1; s <= (N0 || n); s++) a.push(f(s));
  return a;
}
const PROBES: Record<string, () => RunOpts[]> = {
  pace: () => seeds(10, (s) => ({ seed: s, factions: ['heartland', 'highland'], compositions: ['balanced', 'balanced'] })),
  default: () => seeds(20, (s) => ({ seed: s, factions: ['heartland', 'highland'], hour: 8.5 })),
  defaultford: () => seeds(20, (s) => ({ seed: s, preset: 'river_crossing', factions: ['heartland', 'highland'], hour: 8.5 })),
  review: () => seeds(10, (s) => ({ seed: s, factions: ['highland', 'citystates'], compositions: ['fortress', 'fortress'] })),
  kota: () => seeds(30, (s) => ({ seed: s, factions: ['citystates', 'citystates'], compositions: ['balanced', 'balanced'] })),
  suvarna: () => seeds(30, (s) => ({ seed: s, factions: ['heartland', 'heartland'], compositions: ['balanced', 'balanced'] })),
  riders: () => seeds(20, (s) => ({ seed: s, factions: ['frontier', 'frontier'], compositions: ['mobile', 'mobile'] })),
  shock: () => seeds(20, (s) => ({ seed: s, factions: ['forest', 'forest'], compositions: ['shock', 'shock'] })),
  chariot: () => seeds(20, (s) => ({ seed: s, factions: ['heartland', 'heartland'], compositions: ['chariot_age', 'chariot_age'] })),
  horse: () => seeds(20, (s) => ({ seed: s, armies: [[SP(), SP(), SP()], [['cavalry', 60], ['cavalry', 30]]] })),
  horsearch: () => seeds(20, (s) => ({ seed: s, armies: [[SP(), ['archers', 100], ['archers', 100]], [['cavalry', 60], ['cavalry', 30]]] })),
  elehorse: () => seeds(20, (s) => ({ seed: s, armies: [[['war_elephants', 8]], [['cavalry', 60], ['cavalry', 60]]] })),
  elearch: () => seeds(40, (s) => ({ seed: s, armies: [[['war_elephants', 8]], [['archers', 100], ['archers', 100], ['archers', 100], ['archers', 100]]] })),
  mixed: () => seeds(40, (s) => ({ seed: s, armies: [[SP(), SP(), SP(), SP(), ['archers', 100], ['archers', 100]], [SP(), SP(), SP(), SP(), SP(), SP()]] })),
  guards: () => seeds(20, (s) => ({ seed: s, armies: [[['elite_guards', 60]], [SP(), SP(), SP(60)]] })),
};

function all21(): void {
  const F = ['heartland', 'highland', 'forest', 'frontier', 'maritime', 'citystates'];
  const n = N0 || 4;
  let inBand = 0;
  let over = 0;
  let under = 0;
  let limits = 0;
  let draws = 0;
  let total = 0;
  const mins: number[] = [];
  const rows: string[] = [];
  for (let i = 0; i < F.length; i++) {
    for (let j = i; j < F.length; j++) {
      const pm: number[] = [];
      for (let s = 1; s <= n; s++) {
        const r = runBattle({ seed: s, factions: [F[i]!, F[j]!], hour: 9 });
        total++;
        mins.push(r.min);
        pm.push(r.min);
        if (r.reason === 'time_limit') limits++;
        if (r.winner === null) draws++;
        if (r.min >= 3 && r.min <= 8) inBand++;
        else if (r.min > 8) over++;
        else under++;
      }
      rows.push(`${F[i]}-${F[j]} ${median(pm).toFixed(1)}`);
    }
  }
  console.log(`all21 (21 faction-default pairings x ${n}, plains, 09:00): in 3-8 ${inBand}/${total}, <3 ${under}, >8 ${over}, time limits ${limits}, draws ${draws}, median ${median(mins).toFixed(2)} min\n  ${rows.join(' | ')}`);
}

for (const name of (process.argv[2] ?? 'pace').split(',')) {
  if (name === 'all21') all21();
  else if (PROBES[name]) console.log(summary(name, PROBES[name]!().map(runBattle)));
  else console.log(`unknown probe ${name} (known: ${Object.keys(PROBES).join(', ')}, all21)`);
}
