/** Scratch probe (SIM-02): broken_crown grain network with the AI on/off. */
import { campaign, runDays } from '../../strategic/helpers';
import { reserveDays } from '../../../../src/sim/strategic/economy';
const w = campaign(Number(process.argv[2] ?? 2));
if (process.argv[3] === 'passive') for (const f of Object.values(w.factions)) f.ai.memory.passive = true;
for (let d = 0; d < 400; d += 30) {
  runDays(w, 30);
  const hs = Object.values(w.settlements).filter((s) => s.ownerFactionId === 'heartland');
  const blocked = Object.values(w.roads.edges).filter((e) => e.blockedBy).map((e) => `${e.id}:${w.armies[e.blockedBy!]?.factionId}`);
  const armies = Object.values(w.armies).filter((a) => a.factionId !== 'heartland').map((a) => `${a.factionId.slice(0, 4)}:${a.name.slice(0, 12)}@${Math.round(a.x)},${Math.round(a.z)}/${a.status}`);
  console.log('day', d + 30, hs.map((s) => `${s.id}:rd${Math.round(reserveDays(s))}:${s.rebellionStage.slice(0, 4)}`).join(' '), 'R', Math.round(w.factions.heartland!.foodReserve), 'blocked', blocked.join(','));
  if (d >= 300) console.log('   ', armies.join(' | '));
}
