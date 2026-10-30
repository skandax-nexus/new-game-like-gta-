/** Scratch probe (SIM-02): live-world per-planner timing via a replica of runCampaignAI (factions passive in tickWorld). */
import type { SimEvent } from '../../../../src/core/types';
import { campaign, runDays } from '../../strategic/helpers';
import { makeArmy } from '../../../../src/sim/strategic/armies';
import { applyStrategicCommand, getRegionHeightfield, tickWorld } from '../../../../src/sim/strategic/world';
import { aiSchedule, resetAiJournal } from '../../../../src/sim/strategic/ai';
import { remember, situate } from '../../../../src/sim/strategic/ai/core';
import { considerPeace, considerTreaties, considerWar } from '../../../../src/sim/strategic/ai/diplomacy';
import { planGrain, planGrainDaily, planLabor, planTaxes, planTreasury } from '../../../../src/sim/strategic/ai/economy';
import { planAge, planConstruction } from '../../../../src/sim/strategic/ai/build';
import { planDemobilize, planRecruitment } from '../../../../src/sim/strategic/ai/recruit';
import { planMilitary } from '../../../../src/sim/strategic/ai/military';
import { planEspionage, planEvents, planRebels } from '../../../../src/sim/strategic/ai/politics';
import { planGoals } from '../../../../src/sim/strategic/ai/goals';
import { totalDays } from '../../../../src/sim/strategic/seasons';
resetAiJournal(false);
const w = campaign(Number(process.argv[2] ?? 5));
for (let i = 0; i < 3; i++) {
  const a = makeArmy(w, `army_perf${i}`, 'Perf Host', i % 2 ? 'forest' : 'frontier', -500 + i * 700, 1500, [{ unitClass: 'spearmen', formations: 3 }], null);
  w.armies[a.id] = a;
}
runDays(w, 30);
const hf = getRegionHeightfield(w);
const out: SimEvent[] = [];
const tot: Record<string, number> = {};
const mx: Record<string, number> = {};
let worstDay = 0;
let worstApply = 0;
const t = (name: string, fn: () => void): void => { const t0 = performance.now(); fn(); const dt = performance.now() - t0; tot[name] = (tot[name] ?? 0) + dt; mx[name] = Math.max(mx[name] ?? 0, dt); };
const ids = Object.keys(w.factions).sort();
for (const f of Object.values(w.factions)) if (!f.isPlayer) f.ai.memory.passive = true;
for (let h = 0; h < 24 * 60 * 3; h++) {
  out.length = 0;
  tickWorld(w, [], out, hf);
  for (const inst of w.events.pending.slice()) if (inst.scope.factionId === w.playerFactionId) w.events.pending.splice(w.events.pending.indexOf(inst), 1);
  for (const e of Object.values(w.engagements)) if (e.status === 'pending_player') e.status = 'auto';
  if (w.calendar.hour !== 0) continue;
  let day = 0; let apply = 0;
  for (const fid of ids) {
    const f = w.factions[fid]!;
    if (f.isPlayer || !f.alive) continue;
    delete f.ai.memory.passive;
    const t0 = performance.now();
    const sit = situate(w, fid);
    remember(sit, 'lastDay', totalDays(w.calendar));
    t('situate', () => {});
    const when = aiSchedule(totalDays(w.calendar), w.calendar.day, ids.indexOf(fid));
    t('events', () => planEvents(sit)); t('peace', () => considerPeace(sit)); t('grainDaily', () => planGrainDaily(sit));
    if (when.strategy) { t('war', () => considerWar(sit)); t('goals', () => planGoals(sit)); }
    t(when.strategy ? 'militaryFull' : 'militaryDaily', () => planMilitary(sit, when.strategy));
    if (when.economy) { let c = false; t('treasury', () => { c = planTreasury(sit); }); t('taxes', () => planTaxes(sit)); t('labor', () => planLabor(sit)); t('grain', () => planGrain(sit)); t('rebels', () => planRebels(sit)); t('demob', () => planDemobilize(sit)); t('recruit', () => planRecruitment(sit, c)); t('build', () => planConstruction(sit, c)); }
    if (when.diplomacy) { t('treaties', () => considerTreaties(sit)); t('spy', () => planEspionage(sit)); t('age', () => planAge(sit)); }
    day += performance.now() - t0;
    const t1 = performance.now();
    for (const c of sit.commands) applyStrategicCommand(w, c, out, hf);
    const dta = performance.now() - t1; apply += dta;
    f.ai.memory.passive = true;
  }
  worstDay = Math.max(worstDay, day); worstApply = Math.max(worstApply, apply);
}
for (const k of Object.keys(tot)) console.log(k.padEnd(14), 'total', tot[k]!.toFixed(1), 'ms  max', (mx[k]! * 1000).toFixed(0), 'us');
console.log('worst AI day (all factions)', worstDay.toFixed(2), 'ms; worst apply', worstApply.toFixed(2));
