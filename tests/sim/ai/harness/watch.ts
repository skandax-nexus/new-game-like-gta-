/**
 * Watch one battle (dev tool, not a test): positions / orders of chosen formations every N seconds. OWNER: SIM-02.
 *   node_modules/.bin/vite-node tests/sim/ai/harness/watch.ts <probe> <seed> <every-s> <max-s> [indices]
 */
import type { BattleEventRecord } from '../../../../src/core/types';
import { BATTLE_DT } from '../../../../src/core/constants';
import { Heightfield } from '../../../../src/core/terrain/heightfield';
import { createBattle, createSkirmishSetup, stepBattle } from '../../../../src/sim/tactical/battle';
import { PROBES } from './probes';

const spec = PROBES[process.argv[2] ?? 'pace']!(Number(process.argv[3] ?? 1));
const every = Number(process.argv[4] ?? 10);
const maxS = Number(process.argv[5] ?? 300);
const idx = process.argv[6] ? process.argv[6].split(',').map(Number) : null;
const [fa, fb] = spec.factions;
const setup = createSkirmishSetup({ seed: spec.seed, preset: spec.preset ?? 'plains', totalSoldiers: spec.total ?? 1000, playerFactionId: fa, enemyFactionId: fb,
  armies: spec.armies ? [{ factionId: fa, formations: spec.armies[0] }, { factionId: fb, formations: spec.armies[1] }] : null,
  playerSide: 0, hour: spec.hour ?? 9, season: 'sharad', weather: 'clear', difficulty: 'normal', aiVsAi: true, compositions: spec.compositions });
const hf = Heightfield.generate({ ...setup.terrain, resolution: spec.resolution ?? 65 });
const st = createBattle(setup, hf);
const out: BattleEventRecord[] = [];
let nextT = 0;
while (!st.outcome && st.time < maxS + 30) {
  out.length = 0;
  stepBattle(st, BATTLE_DT, hf, out);
  if (st.time >= nextT) {
    nextT += every;
    const t = (st.time - st.deploymentEndsAt).toFixed(0);
    const parts = st.formations.filter((f) => !idx || idx.includes(f.index)).map((f) => {
      const o = f.order;
      const od = o.type === 'move_to' ? `mv(${o.x.toFixed(0)},${o.z.toFixed(0)})` : 'target' in o ? `${o.type}:${o.target}` : o.type;
      return `${f.index}${f.unitClass.slice(0, 3)}@${f.x.toFixed(0)},${f.z.toFixed(0)} ${od} ${f.activity.slice(0, 4)} m${f.morale.toFixed(0)}`;
    });
    console.log(`t=${t} p0=${st.sides[0].aiMemory.posture} p1=${st.sides[1].aiMemory.posture} | ${parts.join(' | ')}`);
  }
}
console.log(st.outcome ? `${st.outcome.winner} ${st.outcome.reason} ${(st.outcome.durationSec / 60).toFixed(2)}` : 'running');
