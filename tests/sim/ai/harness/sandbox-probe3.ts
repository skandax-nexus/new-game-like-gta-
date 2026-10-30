/** Scratch probe (SIM-02): politics 'careful year' with the AI journal. */
import { campaign, quiet, runDays } from '../../strategic/helpers';
import { aiJournal, resetAiJournal } from '../../../../src/sim/strategic/ai';
resetAiJournal(true);
const w = quiet(campaign(5));
for (const r of Object.values(w.diplomacy.relations)) r.atWar = false;
w.monsoon.strength = 1;
const max: Record<string, number> = {};
let firstDay: Record<string, number> = {};
runDays(w, 360, { onHour: () => { for (const s of Object.values(w.settlements)) if (s.ownerFactionId === 'heartland') { max[s.id] = Math.max(max[s.id] ?? 0, s.unrest); if (s.unrest >= 0.15 && firstDay[s.id] === undefined) firstDay[s.id] = Math.floor(w.calendar.totalHours / 24); } } });
console.log(JSON.stringify(max), JSON.stringify(firstDay));
for (const j of aiJournal()) if (j.kind === 'war' || j.kind === 'army' || j.kind === 'spy' || j.kind === 'peace') console.log(j.day, j.factionId, j.kind, j.text);
