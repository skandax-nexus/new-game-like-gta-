/** Scratch probe (SIM-02): SIM-01 fedSiege with the AI on / off. */
import { campaign, runDays } from '../../strategic/helpers';
import { makeArmy } from '../../../../src/sim/strategic/armies';
import { beginSiege } from '../../../../src/sim/strategic/siege';
import { getRegionHeightfield } from '../../../../src/sim/strategic/world';
import { RULES } from '../../../../src/data/rules';
import { aiJournal, resetAiJournal } from '../../../../src/sim/strategic/ai';
for (const passive of [true, false]) {
  resetAiJournal(true);
  const w = campaign(5);
  if (passive) for (const f of Object.values(w.factions)) f.ai.memory.passive = true;
  for (const x of Object.values(w.armies)) if (x.factionId === 'highland') delete w.armies[x.id];
  const s = w.settlements.giridurg!;
  const a = makeArmy(w, 'army_eng', 'army_eng', 'heartland', s.x + s.radius + 100, s.z, [{ unitClass: 'engineers', formations: 1 }], null);
  w.armies.army_eng = a;
  a.order = { kind: 'besiege', settlementId: 'giridurg' };
  beginSiege(w, a, s, [], getRegionHeightfield(w));
  w.factions.heartland!.foodReserve = 0;
  w.depots.depot_siege = { id: 'depot_siege', factionId: 'heartland', x: a.x + 70, z: a.z, settlementId: null, food: RULES.supply.depot.capacity, capacity: RULES.supply.depot.capacity, condition: 1, escortArmyId: null, raided: false, readyOnDay: 0 };
  let day = 0;
  const sold: number[] = [];
  while (s.wallHp > 0 && day < 120) { runDays(w, 1); day++; sold.push(a.units[0]!.soldiers); }
  console.log(passive ? 'passive' : 'active', 'day', day, 'soldiers', sold.filter((_, i) => i % 5 === 0).map((x) => x.toFixed(1)).join(' '), 'treasury', Math.round(w.factions.heartland!.treasury), 'morale', a.morale.toFixed(0));
  if (!passive) for (const j of aiJournal()) if (j.factionId === 'highland' || j.kind === 'spy' || j.kind === 'war') console.log(j.day, j.factionId, j.kind, j.text);
}
