/** Scratch probe (SIM-02): why does the highland host not go home? */
import { campaign, runDays } from '../../strategic/helpers';
import { situate } from '../../../../src/sim/strategic/ai/core';
import { planMilitary } from '../../../../src/sim/strategic/ai/military';
import { aiSchedule, resetAiJournal, aiJournal } from '../../../../src/sim/strategic/ai';
import { totalDays } from '../../../../src/sim/strategic/seasons';
resetAiJournal(true);
const w = campaign(2);
runDays(w, 200);
for (let d = 0; d < 6; d++) {
  runDays(w, 1);
  const day = totalDays(w.calendar);
  const sch = aiSchedule(day, w.calendar.day, 3);
  const sit = situate(w, 'highland');
  console.log('day', day, 'cal', w.calendar.day, JSON.stringify(sch), 'armies', sit.armies.map((a) => `${a.id}:${a.status}:${a.engagementId}`).join(','), 'threats', sit.threats.filter((t) => t.threat > 0).map((t) => `${t.s.id}:${Math.round(t.threat)}/${Math.round(t.defense)}:${t.enemy?.id}`).join(','));
  planMilitary(sit, true);
  console.log('   cmds', JSON.stringify(sit.commands.map((c) => c.cmd)));
}
console.log(aiJournal().filter((j) => j.factionId === 'highland' && j.day >= 200).map((j) => `${j.day} ${j.text}`).join('\n'));
