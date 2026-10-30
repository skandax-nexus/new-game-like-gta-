#!/usr/bin/env node
/**
 * SIM-02 evidence: an AI-only sandbox year and its narrative. OWNER: AI Engineer - Battle AI, Intents & Campaign AI
 * (SIM-02).
 *
 *   node scripts/sim-ai/autoplay.mjs                 -> docs/sprint1/sim-02/campaign-year.{md,json}
 *                                                       .build/sim-02/ai-year.sav (+ ai-year.index.json)
 *   node scripts/sim-ai/autoplay.mjs --seed=3 --days=360
 *
 * Loads the real TypeScript simulation through Vite's SSR module loader (no extra dependencies) and runs
 * tests/sim/ai/harness/autoplay.ts: six realms, all AI, the decision journal kept in full. The save of the year's end
 * is what scripts/shots/sim-02.cjs loads in the browser (localStorage slot "sim02").
 */
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (name, def) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const SEED = Number(arg('seed', '3'));
const DAYS = Number(arg('days', '360'));
const OUT = resolve(ROOT, arg('out', 'docs/sprint1/sim-02'));
const BUILD = resolve(ROOT, '.build/sim-02');

const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const mod = await server.ssrLoadModule('/tests/sim/ai/harness/autoplay.ts');
  const y = mod.runAiYear(SEED, DAYS);
  mkdirSync(OUT, { recursive: true });
  mkdirSync(BUILD, { recursive: true });
  writeFileSync(resolve(OUT, 'campaign-year.md'), y.markdown);
  writeFileSync(
    resolve(OUT, 'campaign-year.json'),
    `${JSON.stringify({ seed: SEED, days: DAYS, seconds: y.seconds, rows: y.rows, wars: y.audit.wars, peace: y.audit.peace, captures: y.audit.captures, ageUps: y.audit.ageUps, landmarkStarts: y.audit.landmarkStarts, worstDebtStreak: y.audit.worstDebtStreak, journal: y.journal }, null, 1)}\n`,
  );
  writeFileSync(resolve(BUILD, 'ai-year.sav'), y.saveText);
  writeFileSync(resolve(BUILD, 'ai-year.index.json'), JSON.stringify(y.saveIndex));
  console.log(`seed ${SEED}: ${DAYS} days in ${y.seconds.toFixed(1)} s, ${y.journal.length} journal entries, ${y.audit.wars.length} wars, ${y.audit.captures.length} captures, ${y.audit.ageUps.length} age-ups; save ${(y.saveText.length / 1024).toFixed(0)} KB`);
  console.log(`wrote ${resolve(OUT, 'campaign-year.md')}`);
} finally {
  await server.close();
}
process.exit(0);
