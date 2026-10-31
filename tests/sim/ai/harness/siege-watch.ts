/**
 * Watch AI-vs-AI siege battles (dev tool, not a test; OWNER: SIM-02, added in the SIM-02 lead review, rebuilt in rework
 * round 1 on harness/sieges.ts). Prints the attacker's plan phase, gates, breaches, tower garrisons, the breach-hold
 * clock, works and every formation (shape, order, activity, soldiers, arrows) every N s, then the summary.
 *   node_modules/.bin/vite-node tests/sim/ai/harness/siege-watch.ts [variant=engineers|elephants|ram_only|all] [every-s=30] [max-s=1800] [seeds=1]
 * With `all` or seeds > 1 only the summaries are printed.
 */
import type { SiegeVariant } from './sieges';
import { SIEGE_VARIANTS, siegeBattle, summarize } from './sieges';

const arg = process.argv[2] ?? 'engineers';
const every = Number(process.argv[3] ?? 30);
const maxS = Number(process.argv[4] ?? 1800);
const seeds = Number(process.argv[5] ?? 1);
const variants = arg === 'all' ? SIEGE_VARIANTS : [arg as SiegeVariant];
const quiet = variants.length > 1 || seeds > 1;
for (const v of variants) {
  for (let seed = 1; seed <= seeds; seed++) {
    const b = siegeBattle(v, { timeLimitSec: maxS, seed });
    const s = summarize(b, maxS, quiet ? undefined : (l) => console.log(l), every);
    const r = (x: number | null): string => (x === null ? '-' : `${(x / 60).toFixed(1)}m`);
    console.log(
      `${v} seed ${seed}: ${s.outcome} (winner ${s.winner}) after ${s.minutes.toFixed(1)} min${s.withdrawReason ? ` - withdrew: ${s.withdrawReason}` : ''}\n` +
        `   ram built ${r(s.ramBuilt)}, at gate ${r(s.ramAtGate)} (closest ${s.ramClosest.toFixed(0)} m), gate broken ${r(s.gateBroken)}, breach held from ${r(s.breachHoldSince)}; palisades ${s.palisades} (first ${r(s.palisadesBuilt)}), ladders ${s.ladders}\n` +
        `   archers: nearest wall archer before commit ${s.archerExposure.toFixed(0)} m, ${s.archersAtCommit} men at commit; towers manned (max) ${s.maxTowersManned}; gate repaired ${s.gateRepaired.toFixed(0)} HP; sallies ${s.sallies}; stormer jam ${s.stormerJam.toFixed(0)} s; losses ${s.losses.join(' / ')}`,
    );
  }
}
process.exit(0);
