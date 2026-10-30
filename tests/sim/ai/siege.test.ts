/**
 * Siege battle AI (DESIGN_SPEC §6.6.5, SIM-02 spec 1 "siege attack"): an attacker re-crews a ram whose engineers routed,
 * and gives up (withdraw_all) when nothing is left to breach the walls with - an abandoned ram nobody can carry does not
 * keep a hopeless assault standing for the rest of the time limit.
 * OWNER: AI Engineer - Battle AI, Intents & Campaign AI (SIM-02); added in the SIM-02 lead review.
 *
 * Real battles (createBattle / stepBattle) on the flat test terrain: a town (2 gates, mud-brick walls, 12 towers) of
 * radius 120 m at the centre, the attacker coming from +Z. The attacker is AI-controlled, the garrison holds
 * (player-controlled, no orders) so the AI's own decisions are what moves.
 */
import { describe, expect, it } from 'vitest';
import type { EngineerWorkState, FortificationSpec } from '../../../src/core/types';
import { createFortificationSpec } from '../../../src/sim/tactical/fort';
import { runFor, testBattle } from '../tactical/helpers';
import type { TestBattle, TestFormation } from '../tactical/helpers';

const R = 120;

function fort(): FortificationSpec {
  return createFortificationSpec({ settlementKind: 'town', fortLevel: 2, fortDefense: 1, center: { x: 0, z: 0 }, radius: R, defenderSide: 1 });
}

function siege(attackers: TestFormation[], defenders: TestFormation[], controllers: ['player' | 'ai', 'player' | 'ai']): TestBattle {
  return testBattle({ kind: 'siege', fortification: fort(), attackerSide: 0, controllers, timeLimitSec: 1800, sides: [attackers, defenders] });
}

/** A finished ram of side 0 standing uncrewed at (x, z) (its engineers routed). */
function abandonedRam(b: TestBattle, x: number, z: number): EngineerWorkState {
  const w: EngineerWorkState = { work: 'ram', x, z, facing: Math.PI, side: 0, hp: 150, maxHp: 150, progress: 1, formation: -1 };
  b.state.works.push(w);
  return w;
}

describe('siege attack (AI besiegers)', () => {
  it('a free engineer formation takes over a ram whose crew routed', () => {
    const b = siege(
      [{ cls: 'spearmen', x: -40, z: 440 }, { cls: 'engineers', x: 60, z: 470 }],
      [{ cls: 'spearmen', x: 0, z: 40 }],
      ['ai', 'player'],
    );
    const ram = abandonedRam(b, 0, 380);
    runFor(b, 120, (s) => s.works.some((w) => w === ram && w.formation === 1));
    expect(ram.formation, `ram crew (engineer order ${b.state.formations[1]!.order.type})`).toBe(1);
    // ...and carries it toward the gate (orders.ts moves a crewed finished ram to the nearest intact gate).
    const z0 = ram.z;
    runFor(b, 20);
    expect(ram.z).toBeLessThan(z0 - 5);
  });

  it('with no engineer, elephant, crewed ram, breach or ladder left, the assault is given up (withdraw_all)', () => {
    const b = siege(
      [{ cls: 'spearmen', x: -40, z: 440 }, { cls: 'spearmen', x: 40, z: 440 }, { cls: 'cavalry', x: 120, z: 440 }],
      [{ cls: 'spearmen', x: 0, z: 40 }],
      ['ai', 'player'],
    );
    // A finished ram lies abandoned before the gate (its engineers routed): nobody is left to carry it.
    abandonedRam(b, 0, 300);
    runFor(b, 90, (s) => s.sides[0].withdrawn);
    expect(b.state.sides[0].withdrawn).toBe(true);
    expect(b.state.time).toBeLessThan(45);
  });
});
