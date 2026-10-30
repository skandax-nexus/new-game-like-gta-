/**
 * Tuning probe CLI (not a test). OWNER: AI Engineer - Battle AI, Intents & Campaign AI (SIM-02).
 *   node_modules/.bin/vite-node tests/sim/ai/harness/probe.ts <name> [seeds] [trace-seed]
 */
import { runBattle, median } from './battles';
import type { BattleSpec } from './battles';
import { PROBES } from './probes';

const name = process.argv[2] ?? 'pace';
const n = Number(process.argv[3] ?? 6);
const traceSeed = process.argv[4] ? Number(process.argv[4]) : -1;
const mk = PROBES[name];
if (!mk) throw new Error(`unknown probe ${name}: ${Object.keys(PROBES).join(', ')}`);
const rows: string[] = [];
const mins: number[] = [];
const w = [0, 0, 0];
const reasons: Record<string, number> = {};
let band = 0;
for (let s = 1; s <= n; s++) {
  const spec: BattleSpec = { ...mk(s), trace: s === traceSeed };
  const r = runBattle(spec);
  w[r.winner === null ? 2 : r.winner]!++;
  reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  mins.push(r.minutes);
  if (r.minutes >= 3 && r.minutes <= 8) band++;
  rows.push(`seed ${String(s).padStart(3)}: ${r.minutes.toFixed(2)} min winner ${r.winner} (${r.reason}) contact ${r.firstContactSec.toFixed(0)} s loss ${r.loss[0]}/${r.start[0]} ${r.loss[1]}/${r.start[1]}`);
  if (s === traceSeed) console.log(r.trace.join('\n'));
}
console.log(rows.join('\n'));
console.log(`${name}: A ${w[0]} / B ${w[1]} / draw ${w[2]}  median ${median(mins).toFixed(2)} min  in 3-8: ${band}/${n}  ${JSON.stringify(reasons)}`);
