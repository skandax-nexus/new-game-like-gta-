/** Scratch probe (SIM-02): replicate SIM-01 tests with the AI journal. */
import { campaign, runHours, runDays } from '../../strategic/helpers';
import { makeArmy } from '../../../../src/sim/strategic/armies';
import { aiJournal, resetAiJournal } from '../../../../src/sim/strategic/ai';
resetAiJournal(true);
const which = process.argv[2] ?? 'road';
if (which === 'road') {
  const w = campaign(5);
  const e = w.roads.edges.road_12!;
  const mid = e.points[Math.floor(e.points.length / 2)]!;
  const a = makeArmy(w, 'army_block', 'army_block', 'highland', mid.x, mid.z, [{ unitClass: 'spearmen', formations: 1 }], null);
  w.armies.army_block = a;
  for (const r of Object.values(w.diplomacy.relations)) if ((r.a === 'heartland' && r.b === 'highland') || (r.b === 'heartland' && r.a === 'highland')) r.atWar = true;
  console.log('food', a.supply.food, a.supply.foodCapacity, a.status, a.order.kind);
  runHours(w, 24, { autoEvents: false, autoEngagements: false });
  console.log('after', a.status, JSON.stringify(a.order), e.blockedBy);
} else {
  const w = campaign(Number(process.argv[3] ?? 1));
  if (process.argv[4] === 'passive') for (const f of Object.values(w.factions)) f.ai.memory.passive = true;
  runDays(w, 545, { onHour: (ev) => { for (const e of ev) if (e.kind === 'war_declared' || e.kind === 'settlement_captured' || e.kind === 'peace_made' || e.kind === 'treaty_signed' || (e.kind === 'rebellion_stage' && e.settlementId === 'rajapura') || e.kind === 'secession') console.log('d', Math.floor(w.calendar.totalHours / 24), JSON.stringify(e), e.kind === 'treaty_signed' ? w.diplomacy.treaties[e.treatyId]?.type + ' ' + w.diplomacy.treaties[e.treatyId]?.parties.join('-') : ''); } });
  console.log(w.victory.status, w.victory.outcomeId, w.victory.endedDay);
}
for (const j of aiJournal()) if (which === 'road' || j.kind === 'spy' || j.kind === 'war' || j.kind === 'army') console.log(j.day, j.factionId, j.kind, j.text);
