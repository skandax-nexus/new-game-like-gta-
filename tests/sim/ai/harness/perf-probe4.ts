/** Scratch probe (SIM-02): per-planner cost at real day rollovers (clone of the live world). */
import type { SimEvent } from '../../../../src/core/types';
import { campaign, runDays } from '../../strategic/helpers';
import { makeArmy } from '../../../../src/sim/strategic/armies';
import { getRegionHeightfield, tickWorld } from '../../../../src/sim/strategic/world';
import { resetAiJournal } from '../../../../src/sim/strategic/ai';
import { situate } from '../../../../src/sim/strategic/ai/core';
import { considerPeace, considerTreaties, considerWar } from '../../../../src/sim/strategic/ai/diplomacy';
import { planGrain, planGrainDaily, planLabor, planTaxes, planTreasury } from '../../../../src/sim/strategic/ai/economy';
import { planAge, planConstruction } from '../../../../src/sim/strategic/ai/build';
import { planDemobilize, planRecruitment } from '../../../../src/sim/strategic/ai/recruit';
import { planMilitary } from '../../../../src/sim/strategic/ai/military';
import { planEspionage, planEvents, planRebels } from '../../../../src/sim/strategic/ai/politics';
import { planGoals } from '../../../../src/sim/strategic/ai/goals';
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
const steps: [string, (s: ReturnType<typeof situate>) => void][] = [
  ['events', planEvents], ['peace', considerPeace], ['grainDaily', planGrainDaily], ['war', considerWar], ['goals', planGoals],
  ['militaryFull', (s) => planMilitary(s, true)],
  ['treasury', (s) => void planTreasury(s)], ['taxes', planTaxes], ['labor', planLabor], ['grain', planGrain], ['rebels', planRebels], ['demob', planDemobilize],
  ['recruit', (s) => planRecruitment(s, false)], ['build', (s) => planConstruction(s, false)], ['treaties', considerTreaties], ['spy', planEspionage], ['age', planAge],
];
for (let h = 0; h < 24 * 60; h++) {
  out.length = 0;
  tickWorld(w, [], out, hf);
  for (const inst of w.events.pending.slice()) if (inst.scope.factionId === w.playerFactionId) w.events.pending.splice(w.events.pending.indexOf(inst), 1);
  for (const e of Object.values(w.engagements)) if (e.status === 'pending_player') e.status = 'auto';
  if (w.calendar.hour !== 0) continue;
  for (const fid of Object.keys(w.factions)) {
    if (w.factions[fid]!.isPlayer) continue;
    const c = structuredClone(w);
    let t0 = performance.now();
    const sit = situate(c, fid);
    let dt = performance.now() - t0;
    tot.situate = (tot.situate ?? 0) + dt; mx.situate = Math.max(mx.situate ?? 0, dt);
    for (const [name, fn] of steps) {
      t0 = performance.now();
      fn(sit);
      dt = performance.now() - t0;
      tot[name] = (tot[name] ?? 0) + dt; mx[name] = Math.max(mx[name] ?? 0, dt);
    }
  }
}
for (const k of Object.keys(tot)) console.log(k.padEnd(14), 'avg', ((tot[k]! / 180) * 1000).toFixed(0), 'us  max', (mx[k]! * 1000).toFixed(0), 'us');
