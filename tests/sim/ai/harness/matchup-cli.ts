/**
 * Run the §13.3 matchup rows from the command line (dev tool). OWNER: SIM-02.
 *   node_modules/.bin/vite-node tests/sim/ai/harness/matchup-cli.ts [seeds] [row,row...]
 */
import { MATCHUPS, formatRate, runMatchup } from './matchups';

const n = Number(process.argv[2] ?? 40);
const only = process.argv[3] ? process.argv[3].split(',') : null;
for (const row of MATCHUPS) {
  if (only && !only.includes(row.id)) continue;
  const t0 = Date.now();
  const r = runMatchup(row, n);
  const extra = r.diff !== undefined ? ` base ${formatRate(r.baseRate!)} diff ${formatRate(r.diff)}` : '';
  console.log(`${row.id.padEnd(28)} ${formatRate(r.rate)} [${formatRate(r.ci[0])}, ${formatRate(r.ci[1])}]${extra} ${r.pass ? 'PASS' : 'FAIL'} median ${r.medianMin.toFixed(2)} min ${JSON.stringify(r.reasons)} ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
