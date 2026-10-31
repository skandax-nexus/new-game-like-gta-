#!/usr/bin/env node
/**
 * SIM-02 evidence: the siege battle AI, AI against AI (OWNER: AI Engineer - Battle AI, Intents & Campaign AI).
 *
 *   node scripts/sim-ai/sieges.mjs [--seeds=3]        -> docs/sprint1/sim-02/sieges.md
 *
 * Loads the real TypeScript simulation through Vite's SSR module loader (no extra dependencies) and runs
 * tests/sim/ai/harness/siege-report.ts.
 */
import { createServer } from 'vite';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (name, def) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const SEEDS = Number(arg('seeds', '3'));
const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const mod = await server.ssrLoadModule('/tests/sim/ai/harness/siege-report.ts');
  const r = mod.siegeReport(SEEDS);
  writeFileSync(resolve(ROOT, 'docs/sprint1/sim-02/sieges.md'), r.markdown);
  for (const x of r.rows) console.log(`${x.variant} seed ${x.seed}: ${x.s.outcome} (side ${x.s.winner}) ${x.s.minutes.toFixed(1)} min${x.s.withdrawReason ? ` - ${x.s.withdrawReason}` : ''}`);
  console.log('wrote docs/sprint1/sim-02/sieges.md');
} finally {
  await server.close();
}
process.exit(0);
