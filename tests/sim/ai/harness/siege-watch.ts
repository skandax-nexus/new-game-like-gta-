/**
 * Watch one AI-vs-AI siege battle (dev tool, not a test; OWNER: SIM-02, added in the SIM-02 lead review): a town of
 * radius 120 m (2 gates, mud-brick walls, 12 towers) held by 2 archer + 2 spear formations and engineers; the besiegers
 * come from +Z. Prints gates, breaches, tower garrisons, the breach-hold clock, works and every formation every N s.
 *   node_modules/.bin/vite-node tests/sim/ai/harness/siege-watch.ts [variant=engineers|elephants] [every-s=30] [max-s=1800]
 * 'engineers': 3 spears, 2 archers, 2 engineers, 1 horse - the ram crew is shot off under the walls.
 * 'elephants': the second engineer formation replaced by war elephants - the gates break.
 */
import type { BattleEventRecord } from '../../../../src/core/types';
import { BATTLE_DT } from '../../../../src/core/constants';
import { stepBattle } from '../../../../src/sim/tactical/battle';
import { createFortificationSpec } from '../../../../src/sim/tactical/fort';
import { testBattle } from '../../tactical/helpers';
import type { TestFormation } from '../../tactical/helpers';

const variant = process.argv[2] ?? 'engineers';
const every = Number(process.argv[3] ?? 30);
const maxS = Number(process.argv[4] ?? 1800);
const fort = createFortificationSpec({ settlementKind: 'town', fortLevel: 2, fortDefense: 1, center: { x: 0, z: 0 }, radius: 120, defenderSide: 1 });
const second: TestFormation = variant === 'elephants' ? { cls: 'war_elephants', x: 60, z: 400 } : { cls: 'engineers', x: 60, z: 480 };
const b = testBattle({
  kind: 'siege',
  fortification: fort,
  attackerSide: 0,
  controllers: ['ai', 'ai'],
  timeLimitSec: maxS,
  sides: [
    [
      { cls: 'spearmen', x: -40, z: 420 },
      { cls: 'spearmen', x: 0, z: 420 },
      { cls: 'spearmen', x: 40, z: 420 },
      { cls: 'archers', x: -30, z: 460 },
      { cls: 'archers', x: 30, z: 460 },
      { cls: 'engineers', x: -60, z: 480 },
      second,
      { cls: 'cavalry', x: 120, z: 440 },
    ],
    [
      { cls: 'archers', x: 0, z: 80 },
      { cls: 'archers', x: 40, z: 60 },
      { cls: 'spearmen', x: 0, z: 40 },
      { cls: 'spearmen', x: -30, z: 30 },
      { cls: 'engineers', x: 0, z: 0 },
    ],
  ],
});
const st = b.state;
const sg = st.siege!;
const out: BattleEventRecord[] = [];
let next = 0;
while (!st.outcome && st.time < maxS) {
  out.length = 0;
  stepBattle(st, BATTLE_DT, b.terrain, out);
  if (st.time < next) continue;
  next += every;
  const works = st.works.map((w) => `${w.work}[s${w.side}] ${(w.progress * 100).toFixed(0)}% hp ${w.hp.toFixed(0)} crew ${w.formation}`).join(', ');
  console.log(`t=${st.time.toFixed(0)} gates ${sg.gates.map((x) => x.hp.toFixed(0)).join('/')} breaches ${sg.breaches.length} towers ${sg.towers.map((t) => t.garrison).join(',')} hold ${JSON.stringify(sg.breachHold ?? null)} works ${works}`);
  console.log(`   ${st.formations.map((f) => `${f.index} ${f.unitClass.slice(0, 3)}${f.side} @${f.x.toFixed(0)},${f.z.toFixed(0)} ${f.order.type} ${f.activity} n${f.soldiers}`).join(' | ')}`);
}
console.log(st.outcome ? `outcome: side ${st.outcome.winner} ${st.outcome.reason} after ${(st.outcome.durationSec / 60).toFixed(1)} min` : 'running');
process.exit(0);
