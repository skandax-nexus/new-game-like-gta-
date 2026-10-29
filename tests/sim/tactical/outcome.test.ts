/**
 * Side broken (DESIGN_SPEC §6.8) with the Creative Director's stalemate backstop (GP-01 rework round 1, CD blocking
 * item 3): an archer-category formation with no arrows that is not in melee counts as non-combat, like engineers and
 * supply trains. A side left with only arrowless archers, engineers and carts is broken; both sides at once is a draw.
 * OWNER: Gameplay Engineer - Tactical Battle Simulation.
 */
import { describe, expect, it } from 'vitest';
import type { BattleEventRecord } from '../../../src/core/types';
import { BATTLE_DT } from '../../../src/core/constants';
import { Heightfield } from '../../../src/core/terrain/heightfield';
import { createBattle, createSkirmishSetup, sideBroken, stepBattle } from '../../../src/sim/tactical/battle';
import { holdsTheField } from '../../../src/sim/tactical/outcome';
import type { TestBattle } from './helpers';
import { runFor, testBattle } from './helpers';

const PI = Math.PI;

function emptyQuivers(b: TestBattle, ...indices: number[]): void {
  for (const i of indices) b.state.formations[i]!.ammo = 0;
}

describe('§6.8 side broken: arrowless archers do not hold the field', () => {
  it('a side left with arrowless archers, engineers and carts is broken; the other side wins (rout, no pursuit of them)', () => {
    const b = testBattle({
      sides: [
        [
          { cls: 'archers', x: 0, z: 0, facing: 0 },
          { cls: 'engineers', x: 40, z: -30, facing: 0 },
          { cls: 'supply_train', x: -40, z: -40, facing: 0 },
        ],
        [{ cls: 'spearmen', x: 0, z: 300, facing: PI }],
      ],
    });
    expect(sideBroken(b.state, 0)).toBe(false);
    emptyQuivers(b, 0);
    expect(holdsTheField(b.state.formations[0]!)).toBe(false);
    expect(holdsTheField(b.state.formations[1]!)).toBe(false);
    expect(holdsTheField(b.state.formations[3]!)).toBe(true);
    expect(sideBroken(b.state, 0)).toBe(true);
    expect(sideBroken(b.state, 1)).toBe(false);
    runFor(b, BATTLE_DT);
    const o = b.state.outcome!;
    expect(o).not.toBeNull();
    expect(o.winner).toBe(1);
    // The archers stand intact: the host is broken, not destroyed.
    expect(o.reason).toBe('rout');
    expect(o.sides[0].pursuitLosses).toBe(0);
    expect(o.sides[0].survivors).toBe(b.state.sides[0].initialSoldiers);
  });

  it('both sides left with only arrowless archers -> a draw at once (the CD stalemate: idle bowmen 160 m apart)', () => {
    const b = testBattle({
      sides: [
        [{ cls: 'archers', x: 0, z: 0, facing: 0 }, { cls: 'archers', x: 60, z: 0, facing: 0 }],
        [{ cls: 'archers', x: 0, z: 160, facing: PI }, { cls: 'archers', x: 60, z: 160, facing: PI }],
      ],
    });
    emptyQuivers(b, 0, 1, 2, 3);
    runFor(b, BATTLE_DT);
    const o = b.state.outcome!;
    expect(o).not.toBeNull();
    expect(o.winner).toBeNull();
    expect(b.state.phase).toBe('ended');
  });

  it('archers with arrows, or arrowless archers in melee, still hold the field', () => {
    // Arrows left: no outcome.
    const shooting = testBattle({ sides: [[{ cls: 'archers', x: 0, z: 0, facing: 0 }], [{ cls: 'archers', x: 0, z: 400, facing: PI }]] });
    shooting.state.formations[0]!.ammo = 1;
    emptyQuivers(shooting, 1);
    runFor(shooting, BATTLE_DT);
    expect(shooting.state.outcome?.winner).toBe(0);
    // Arrowless archers fighting hand to hand hold the field.
    const melee = testBattle({
      sides: [
        [{ cls: 'archers', x: 0, z: 0, facing: 0 }],
        [{ cls: 'spearmen', x: 0, z: 0, facing: PI }],
      ],
    });
    const arch = melee.state.formations[0]!;
    const spear = melee.state.formations[1]!;
    spear.z = arch.depth / 2 + spear.depth / 2 + 0.3;
    emptyQuivers(melee, 0);
    runFor(melee, BATTLE_DT);
    expect(arch.engagedWith).toEqual([1]);
    expect(holdsTheField(arch)).toBe(true);
    expect(sideBroken(melee.state, 0)).toBe(false);
    expect(melee.state.outcome).toBeNull();
  });

  it('arrowless archers left standing when their melee formations rout: the battle ends instead of waiting for the time limit', () => {
    const b = testBattle({
      sides: [
        [{ cls: 'spearmen', x: 0, z: 0, facing: 0 }, { cls: 'archers', x: 0, z: -60, facing: 0 }],
        [{ cls: 'spearmen', x: 0, z: 400, facing: PI }, { cls: 'archers', x: 0, z: 460, facing: PI }],
      ],
      timeLimitSec: 2400,
    });
    emptyQuivers(b, 1, 3);
    // Side 0's spear block routs (morale collapse); its arrowless archers no longer keep the side in the battle.
    b.state.formations[0]!.morale = 5;
    runFor(b, 5);
    const o = b.state.outcome!;
    expect(o).not.toBeNull();
    expect(o.winner).toBe(1);
    expect(o.reason).toBe('rout');
    expect(o.durationSec).toBeLessThan(10);
  });

  it('the review pairing (Giridurga vs Kotanagara, both Hill Fort Garrison, plains, 1,000) no longer reaches the 40-minute limit', () => {
    const rows: string[] = [];
    let timeLimits = 0;
    let draws = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const setup = createSkirmishSetup({ seed, preset: 'plains', totalSoldiers: 1000, playerFactionId: 'highland', enemyFactionId: 'citystates', armies: null, playerSide: 0, hour: 9, season: 'sharad', weather: 'clear', difficulty: 'normal', aiVsAi: true, compositions: ['fortress', 'fortress'] });
      const hf = Heightfield.generate(setup.terrain);
      const state = createBattle(setup, hf);
      const out: BattleEventRecord[] = [];
      while (!state.outcome) {
        out.length = 0;
        stepBattle(state, BATTLE_DT, hf, out);
      }
      const o = state.outcome;
      if (o.reason === 'time_limit') timeLimits++;
      if (o.winner === null) draws++;
      const idle = state.formations.filter((f) => f.unitClass === 'archers' && f.soldiers > 0 && f.ammo <= 0 && f.activity !== 'routing').length;
      rows.push(`seed ${String(seed).padStart(2)}: ${(o.durationSec / 60).toFixed(2)} min  winner ${o.winner} (${o.reason})  arrowless archers standing ${idle}`);
    }
    console.log(`[outcome] Giridurga vs Kotanagara, Hill Fort Garrison mirror (plains, 1,000, AI vs AI):\n  ${rows.join('\n  ')}\n  time limits ${timeLimits}, draws ${draws} (before the amendment: 6 time limits, 5 draws)`);
    expect(timeLimits).toBe(0);
  });
});
