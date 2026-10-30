/** Scratch probe (SIM-02): campaign AI cost per call and per planner. */
import { campaign, runDays } from '../../strategic/helpers';
import { situate } from '../../../../src/sim/strategic/ai/core';
import { considerPeace, considerTreaties, considerWar } from '../../../../src/sim/strategic/ai/diplomacy';
import { planGrain, planGrainDaily, planLabor, planTaxes, planTreasury } from '../../../../src/sim/strategic/ai/economy';
import { planAge, planConstruction } from '../../../../src/sim/strategic/ai/build';
import { planDemobilize, planRecruitment } from '../../../../src/sim/strategic/ai/recruit';
import { planMilitary } from '../../../../src/sim/strategic/ai/military';
import { planEspionage, planEvents, planRebels } from '../../../../src/sim/strategic/ai/politics';
import { planGoals } from '../../../../src/sim/strategic/ai/goals';
import { resetAiJournal } from '../../../../src/sim/strategic/ai';
resetAiJournal(false);
const w = campaign(5);
runDays(w, 30);
const fids = Object.keys(w.factions).filter((f) => !w.factions[f]!.isPlayer);
const N = 200;
const steps: [string, (s: ReturnType<typeof situate>) => void][] = [
  ['situate', () => {}],
  ['events', planEvents], ['peace', considerPeace], ['grainDaily', planGrainDaily], ['war', considerWar], ['goals', planGoals],
  ['militaryDaily', (s) => planMilitary(s, false)], ['militaryFull', (s) => planMilitary(s, true)],
  ['treasury', (s) => void planTreasury(s)], ['taxes', planTaxes], ['labor', planLabor], ['grain', planGrain], ['rebels', planRebels], ['demob', planDemobilize],
  ['recruit', (s) => planRecruitment(s, false)], ['build', (s) => planConstruction(s, false)], ['treaties', considerTreaties], ['spy', planEspionage], ['age', planAge],
];
const snap = JSON.stringify(w.factions);
for (const [name, fn] of steps) {
  let best = Infinity;
  for (let r = 0; r < 5; r++) {
    const t0 = performance.now();
    for (let i = 0; i < N; i++) for (const fid of fids) {
      const s = situate(w, fid);
      fn(s);
    }
    best = Math.min(best, (performance.now() - t0) / (N * fids.length));
    w.factions = JSON.parse(snap);
  }
  console.log(name.padEnd(14), (best * 1000).toFixed(1), 'us/faction');
}
