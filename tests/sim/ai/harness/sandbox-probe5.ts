/** Scratch probe (SIM-02): Rajapura unrest terms in broken_crown. */
import { campaign, runDays } from '../../strategic/helpers';
import { unrestTerms, loyaltyTerms, stabilityTerms } from '../../../../src/sim/strategic/politics';
import { reserveDays } from '../../../../src/sim/strategic/economy';
const w = campaign(Number(process.argv[2] ?? 2));
if (process.argv[3] === 'passive') for (const f of Object.values(w.factions)) f.ai.memory.passive = true;
for (let d = 0; d < 460; d += 10) {
  runDays(w, 10);
  if (d < 330) continue;
  const s = w.settlements.rajapura!;
  const f = w.factions.heartland!;
  console.log('day', d + 10, s.ownerFactionId, s.rebellionStage, 'unrest', s.unrest.toFixed(2), 'loy', s.loyalty.toFixed(2), 'rd', Math.round(reserveDays(s)), 'starv', s.starvationDays, 'stab', f.stability.toFixed(2), 'leg', f.legitimacy.toFixed(2), 'reserve', Math.round(f.foodReserve), 'T', Math.round(f.treasury));
  console.log('   unrest:', unrestTerms(w, s).map((t) => `${t.label} ${t.value.toFixed(4)}`).join('; '));
  console.log('   loyalty:', loyaltyTerms(w, s).map((t) => `${t.label} ${t.value.toFixed(3)}`).join('; '));
  console.log('   stability:', stabilityTerms(w, 'heartland').map((t) => `${t.label} ${t.value.toFixed(3)}`).join('; '));
}
