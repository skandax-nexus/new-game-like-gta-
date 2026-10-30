/** Scratch probe (SIM-02): SIM-01 perf world - where does the time go. */
import type { SimEvent } from '../../../../src/core/types';
import { campaign, runDays } from '../../strategic/helpers';
import { makeArmy } from '../../../../src/sim/strategic/armies';
import { getRegionHeightfield, tickWorld } from '../../../../src/sim/strategic/world';
import { aiJournal, resetAiJournal } from '../../../../src/sim/strategic/ai';
resetAiJournal(true);
const w = campaign(5);
for (let i = 0; i < 3; i++) {
  const a = makeArmy(w, `army_perf${i}`, 'Perf Host', i % 2 ? 'forest' : 'frontier', -500 + i * 700, 1500, [{ unitClass: 'spearmen', formations: 3 }], null);
  w.armies[a.id] = a;
}
runDays(w, 30);
const hf = getRegionHeightfield(w);
const out: SimEvent[] = [];
let tot = 0, battleT = 0, dayT = 0, n = 0, battles = 0, worst = 0;
for (let h = 0; h < 24 * 60; h++) {
  out.length = 0;
  const t0 = performance.now();
  tickWorld(w, [], out, hf);
  const dt = performance.now() - t0;
  tot += dt; n++;
  const b = out.some((e) => e.kind === 'engagement_started' || e.kind === 'engagement_resolved');
  if (b) { battleT += dt; battles++; for (const e of out) if (e.kind === 'engagement_started') { const g = w.engagements[e.engagementId]!; console.log('day', Math.floor(w.calendar.totalHours / 24), 'eng', g.kind, g.sides.map((s) => s.map((id) => `${id}(${w.armies[id]?.factionId}:${w.armies[id]?.units.length})`).join('+')).join(' vs '), dt.toFixed(0), 'ms'); } }
  if (w.calendar.hour === 0) { dayT += dt; if (!b) worst = Math.max(worst, dt); }
  for (const inst of w.events.pending.slice()) if (inst.scope.factionId === w.playerFactionId) w.events.pending.splice(w.events.pending.indexOf(inst), 1);
  for (const e of Object.values(w.engagements)) if (e.status === 'pending_player') e.status = 'auto';
}
console.log('avg', (tot / n).toFixed(3), 'battle hours', battles, 'battle ms', battleT.toFixed(0), 'day ms', dayT.toFixed(0), 'worst day', worst.toFixed(2), 'total', tot.toFixed(0));
for (const j of aiJournal()) if (j.day >= 30 && (j.kind === 'army' || j.kind === 'war')) console.log(j.day, j.factionId, j.text);
