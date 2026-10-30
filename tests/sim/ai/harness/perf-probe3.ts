/** Scratch probe (SIM-02): day rollover cost with vs without the campaign AI (same state). */
import type { SimEvent, WorldState } from '../../../../src/core/types';
import { campaign, runDays } from '../../strategic/helpers';
import { makeArmy } from '../../../../src/sim/strategic/armies';
import { getRegionHeightfield, tickWorld } from '../../../../src/sim/strategic/world';
import { resetAiJournal, runCampaignAI } from '../../../../src/sim/strategic/ai';
resetAiJournal(false);
const w = campaign(5);
for (let i = 0; i < 3; i++) {
  const a = makeArmy(w, `army_perf${i}`, 'Perf Host', i % 2 ? 'forest' : 'frontier', -500 + i * 700, 1500, [{ unitClass: 'spearmen', formations: 3 }], null);
  w.armies[a.id] = a;
}
runDays(w, 30);
const hf = getRegionHeightfield(w);
const out: SimEvent[] = [];
const rows: string[] = [];
for (let h = 0; h < 24 * 60; h++) {
  if (w.calendar.hour === 23) {
    // Day rollover next: measure on clones (AI on, AI off) and the AI decision alone.
    const time = (fn: () => void): number => { let best = Infinity; for (let r = 0; r < 3; r++) { const t0 = performance.now(); fn(); best = Math.min(best, performance.now() - t0); } return best; };
    const on = time(() => { const c = structuredClone(w); out.length = 0; tickWorld(c, [], out, hf); });
    const off = time(() => { const c = structuredClone(w); for (const f of Object.values(c.factions)) f.ai.memory.passive = true; out.length = 0; tickWorld(c, [], out, hf); });
    const clone = time(() => { structuredClone(w); });
    let ai = 0; let n = 0;
    const c2 = structuredClone(w);
    const day = Math.floor((c2.calendar.totalHours + 1) / 24);
    c2.calendar.totalHours += 1; c2.calendar.hour = 0; c2.calendar.day = (c2.calendar.day + 1) % 30;
    for (const f of Object.values(c2.factions)) { if (f.isPlayer || !f.alive) continue; const t0 = performance.now(); const cmds = runCampaignAI(c2, f.id, hf); ai += performance.now() - t0; n += cmds.length; }
    rows.push(`day ${day}: on ${(on - clone).toFixed(2)} off ${(off - clone).toFixed(2)} ai ${ai.toFixed(2)} cmds ${n}`);
  }
  out.length = 0;
  tickWorld(w, [], out, hf);
  for (const inst of w.events.pending.slice()) if (inst.scope.factionId === w.playerFactionId) w.events.pending.splice(w.events.pending.indexOf(inst), 1);
  for (const e of Object.values(w.engagements)) if (e.status === 'pending_player') e.status = 'auto';
}
console.log(rows.join('\n'));
