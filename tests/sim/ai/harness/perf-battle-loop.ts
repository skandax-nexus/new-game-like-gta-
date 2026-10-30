/** Scratch probe (SIM-02): hot loop of battle AI thinks for CPU profiling. */
import type { BattleEventRecord, BattleState, SideIndex } from '../../../../src/core/types';
import { BATTLE_DT } from '../../../../src/core/constants';
import { Heightfield } from '../../../../src/core/terrain/heightfield';
import { createBattle, createSkirmishSetup, stepBattle } from '../../../../src/sim/tactical/battle';
import { runBattleAI } from '../../../../src/sim/tactical/battleai';
const row = [
  ...Array.from({ length: 8 }, () => ({ unitClass: 'spearmen' as const, soldiers: 120 })),
  ...Array.from({ length: 6 }, () => ({ unitClass: 'archers' as const, soldiers: 100 })),
  ...Array.from({ length: 4 }, () => ({ unitClass: 'cavalry' as const, soldiers: 60 })),
  { unitClass: 'war_elephants' as const, soldiers: 8 },
  { unitClass: 'elite_guards' as const, soldiers: 60 },
];
const setup = createSkirmishSetup({ seed: 3, preset: 'plains', totalSoldiers: 4000, playerFactionId: 'heartland', enemyFactionId: 'heartland', armies: [{ factionId: 'heartland', formations: row }, { factionId: 'heartland', formations: row }], playerSide: 0, hour: 9, season: 'sharad', weather: 'clear', difficulty: 'normal', aiVsAi: true });
const terrain = Heightfield.generate({ ...setup.terrain, resolution: 129 });
const st: BattleState = createBattle(setup, terrain);
const out: BattleEventRecord[] = [];
const snaps: BattleState[] = [];
while (!st.outcome && st.time < 600) {
  if (st.tick % 40 === 0 && st.phase === 'active') snaps.push({ ...structuredClone({ ...st, setup: null }), setup: st.setup } as BattleState);
  out.length = 0;
  stepBattle(st, BATTLE_DT, terrain, out);
}
console.log('snaps', snaps.length);
const t0 = performance.now();
let n = 0;
for (let rep = 0; rep < 20; rep++) for (const s of snaps) for (const side of [0, 1] as SideIndex[]) {
  const c = { ...structuredClone({ ...s, setup: null }), setup: s.setup } as BattleState;
  delete c.sides[side].aiMemory.next;
  runBattleAI(c, side, terrain);
  n++;
}
console.log('per think incl clone', ((performance.now() - t0) / n * 1000).toFixed(1), 'us');
