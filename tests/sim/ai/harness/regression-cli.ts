/**
 * Battle AI regression check (dev tool, OWNER: SIM-02): replays the first N seeds of every §13.3 matchup row and
 * compares winner, end reason and length with the committed 200-run results (docs/sprint1/sim-02/matchups.json).
 * A refactor or optimisation of the battle AI that must not change decisions should report `diffs 0`.
 *   node_modules/.bin/vite-node tests/sim/ai/harness/regression-cli.ts [seeds=10] [row,row...]
 */
import { readFileSync } from 'node:fs';
import { MATCHUPS, runMatchup } from './matchups';
const json = JSON.parse(readFileSync('docs/sprint1/sim-02/matchups.json', 'utf8')) as { rows: { id: string; result: { runs: { seed: number; winner: number | null; reason: string; minutes: number }[] } }[] };
const n = Number(process.argv[2] ?? 10);
let diffs = 0;
for (const row of MATCHUPS) {
  if (process.argv[3] && !process.argv[3].split(',').includes(row.id)) continue;
  const ref = json.rows.find((r) => r.id === row.id)!.result.runs;
  const got: { seed: number; winner: number | null; reason: string; minutes: number }[] = [];
  runMatchup(row, n, (seed, r) => got.push({ seed, winner: r.winner, reason: r.reason, minutes: Number(r.minutes.toFixed(2)) }));
  for (const g of got) {
    const r = ref.find((x) => x.seed === g.seed && Math.abs(x.minutes - g.minutes) < 1e-9 && x.winner === g.winner && x.reason === g.reason);
    if (!r) { diffs++; console.log('DIFF', row.id, JSON.stringify(g), JSON.stringify(ref.filter((x) => x.seed === g.seed))); }
  }
  console.log(row.id, got.length, 'checked');
}
console.log('diffs', diffs);
