/** Scratch probe (SIM-02): AI-only sandbox. */
import { aiSandbox, runAudited } from './campaign';
import { aiJournal, resetAiJournal } from '../../../../src/sim/strategic/ai';
import { reserveDays } from '../../../../src/sim/strategic/economy';
import { armySoldiers } from '../../../../src/sim/strategic/armies';
const seed = Number(process.argv[2] ?? 1);
const days = Number(process.argv[3] ?? 360);
const filter = process.argv[4] ?? '';
resetAiJournal(true);
const w = aiSandbox(seed);
const t0 = Date.now();
const audit = runAudited(w, days, (w, a) => {
  if (a.days % 60 === 0) {
    console.log('day', a.days, Object.values(w.factions).filter((f) => f.alive).map((f) => `${f.id.slice(0, 5)} T${Math.round(f.treasury)} R${Math.round(f.foodReserve)} ${f.age.slice(0, 4)} sold${Object.values(w.armies).filter((x) => x.factionId === f.id).reduce((s, x) => s + armySoldiers(x), 0)}`).join(' | '));
    console.log('   ', Object.values(w.settlements).map((s) => `${s.id.slice(0, 5)}:${(s.ownerFactionId ?? '-').slice(0, 4)}/${s.rebellionStage.slice(0, 4)}/rd${Math.round(reserveDays(s))}`).join(' '));
  }
});
console.log('ms', Date.now() - t0, 'days', audit.days, 'status', w.victory.status, w.victory.outcomeId);
console.log('owners', Object.values(w.settlements).map((s) => `${s.id}:${s.ownerFactionId}`).join(' '));
console.log('alive', Object.values(w.factions).map((f) => `${f.id}:${f.alive}:${f.age}`).join(' '));
console.log(JSON.stringify({ debt: audit.worstDebtStreak, wars: audit.wars, peace: audit.peace, ageUps: audit.ageUps, ready: audit.worstReadyStreak, lm: audit.landmarkStarts, caps: audit.captures, peaceMade: audit.peaceMade }));
const j = aiJournal();
const counts: Record<string, number> = {};
for (const e of j) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
console.log(JSON.stringify(counts));
for (const e of j) if (!filter || e.kind === filter || e.factionId === filter) console.log(e.day, e.factionId, e.kind, e.text);
