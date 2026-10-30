/** Scratch probe (SIM-02): runBattleAI cost per think at 40 formations. */
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
const setup = createSkirmishSetup({ seed: 3, preset: 'plains', totalSoldiers: 4000, playerFactionId: 'kotanagara', enemyFactionId: 'kotanagara', armies: [{ factionId: 'heartland', formations: row }, { factionId: 'heartland', formations: row }], playerSide: 0, hour: 9, season: 'sharad', weather: 'clear', difficulty: 'normal', aiVsAi: true });
const terrain = Heightfield.generate({ ...setup.terrain, resolution: Number(process.argv[2] ?? 129) });
const st: BattleState = createBattle(setup, terrain);
console.log('formations', st.formations.length);
const out: BattleEventRecord[] = [];
const times: number[] = [];
let phaseD = 0;
while (!st.outcome && st.time < 900) {
  if (st.tick % 20 === 0) {
    for (const side of [0, 1] as SideIndex[]) {
      let best = Infinity;
      for (let r = 0; r < 3; r++) {
        const c = { ...structuredClone({ ...st, setup: null }), setup: st.setup } as BattleState;
        delete c.sides[side].aiMemory.next;
        const t0 = performance.now();
        runBattleAI(c, side, terrain);
        best = Math.min(best, performance.now() - t0);
      }
      times.push(best);
      if (st.phase === 'deployment') phaseD++;
    }
  }
  out.length = 0;
  stepBattle(st, BATTLE_DT, terrain, out);
}
times.sort((a, b) => a - b);
const mean = times.reduce((a, b) => a + b, 0) / times.length;
console.log('thinks', times.length, 'deployment thinks', phaseD, 'mean', (mean * 1000).toFixed(1), 'us p50', (times[Math.floor(times.length * 0.5)]! * 1000).toFixed(1), 'p95', (times[Math.floor(times.length * 0.95)]! * 1000).toFixed(1), 'max', (times[times.length - 1]! * 1000).toFixed(1), 'outcome', st.outcome?.reason, st.time.toFixed(0));
