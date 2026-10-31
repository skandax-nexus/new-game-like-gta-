/**
 * Watch an AI-only sandbox (or The Broken Crown) for N days (dev tool, not a test; OWNER: SIM-02, rework round 1).
 * Every `every` days, per living realm: soldiers / ceiling, treasury, wars, field armies (soldiers, status, op, food
 * share), towns held; then the captures, the stall audit (longest same-op spell while at war) and journal lines.
 *   node_modules/.bin/vite-node tests/sim/ai/harness/world-watch.ts [seed=1] [days=720] [every=90] [scenario=sandbox|broken_crown] [journal-filter]
 */
import { armySoldiers } from '../../../../src/sim/strategic/armies';
import { aiJournal, resetAiJournal } from '../../../../src/sim/strategic/ai';
import { isFieldArmy, situate } from '../../../../src/sim/strategic/ai/core';
import { soldierCeiling } from '../../../../src/sim/strategic/ai/recruit';
import { warRule } from '../../../../src/sim/strategic/ai/diplomacy';
import { totalDays } from '../../../../src/sim/strategic/seasons';
import { aiSandbox, aiScenario, runAudited } from './campaign';
import { stallWatch } from './stalls';

const seed = Number(process.argv[2] ?? 1);
const days = Number(process.argv[3] ?? 720);
const every = Number(process.argv[4] ?? 90);
const scen = process.argv[5] ?? 'sandbox';
const filter = process.argv[6] ?? '';
resetAiJournal(true, 100000);
const w = scen === 'sandbox' ? aiSandbox(seed) : aiScenario(seed, 'broken_crown');
const stalls = stallWatch();
const audit = runAudited(w, days, (world) => {
  stalls.day(world);
  const day = totalDays(world.calendar);
  if (day % every !== 0) return;
  console.log(`=== day ${day}`);
  for (const fid of Object.keys(world.factions).sort()) {
    const f = world.factions[fid]!;
    if (!f.alive) continue;
    const sit = situate(world, fid);
    const armies = Object.values(world.armies)
      .filter((a) => a.factionId === fid && isFieldArmy(a))
      .map((a) => `${a.name} ${armySoldiers(a)} ${a.status} ${String(f.ai.memory[`op_${a.id}`] ?? '-')} food ${(a.supply.food / Math.max(1, a.supply.foodCapacity)).toFixed(2)}`);
    const rules = Object.keys(world.factions)
      .sort()
      .filter((o) => o !== fid && world.factions[o]!.alive && sit.strength[o]! > 0)
      .map((o) => {
        const r = warRule(sit, o);
        return `${o} ${r.ratio.toFixed(2)}/${r.threshold.toFixed(2)}${r.blocked ? ` (${r.blocked})` : ''}`;
      });
    console.log(`${fid}: soldiers ${Math.round(sit.soldiers)}/${Math.round(soldierCeiling(sit))} treasury ${Math.round(f.treasury)} net ${Math.round(f.ledger.net)} towns ${sit.owned.length} wars [${sit.enemies.join(',')}] | ${armies.join(' | ')} | rule ${rules.join('; ')}`);
  }
});
console.log(`captures: ${audit.captures.map((c) => `d${c.day} ${c.settlementId} ${c.from}->${c.to}`).join(', ')}`);
console.log(`eliminated: ${audit.eliminated.map((e) => `d${e.day} ${e.factionId}${e.landed ? '' : ' (landless)'}`).join(', ')}`);
console.log(`peace made: ${audit.peaceMade.map((p) => `d${p.day} ${p.a}/${p.b}`).join(', ')}`);
console.log(`stalls (longest same op while at war): ${stalls.report().join(', ')}`);
console.log(`tributaries: ${Object.values(w.diplomacy.treaties).filter((t) => t.type === 'tributary').map((t) => `${t.terms.payer} pays ${t.terms.overlord} ${t.terms.tributePerMonth}/month from d${t.startDay}${t.endDay !== null ? ` to d${t.endDay}` : ''}`).join(', ')}`);
if (filter) for (const e of aiJournal()) if (`${e.factionId} ${e.kind} ${e.text}`.includes(filter)) console.log(`d${e.day} ${e.factionId} [${e.kind}] ${e.text}`);
process.exit(0);
