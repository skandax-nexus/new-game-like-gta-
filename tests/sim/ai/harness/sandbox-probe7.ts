/** Scratch probe (SIM-02): highland host plan memory over time (broken_crown seed 2). */
import { campaign, runDays } from '../../strategic/helpers';
const w = campaign(2);
for (let d = 0; d < 420; d += 15) {
  runDays(w, 15);
  if (d < 180) continue;
  const a = w.armies.army_giri;
  const m = w.factions.highland!.ai.memory;
  console.log('day', d + 15, a ? `${a.status} ${JSON.stringify(a.order)} @${Math.round(a.x)},${Math.round(a.z)} food ${Math.round(a.supply.food)}/${Math.round(a.supply.foodCapacity)} src ${a.supply.sourceId} ${a.supply.lineIntact}` : 'gone', 'op', m.op_army_giri, m.opd_army_giri);
}
