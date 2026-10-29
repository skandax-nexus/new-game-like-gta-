/**
 * Tactical determinism (GP-01 acceptance): a battle resumed from its serialized state - during deployment, mid-melee
 * and mid-siege - equals the uninterrupted run (state hash after N more ticks), with commands issued at fixed ticks.
 * The derived context (pathing grid, flow-field cache, variant stats) is rebuilt from the decoded state, so this also
 * proves caches never change results. OWNER: Gameplay Engineer - Tactical Battle Simulation.
 */
import { describe, expect, it } from 'vitest';
import type { BattleCommand, BattleEventRecord, BattleSetup, BattleState, SideIndex, TerrainQuery } from '../../../src/core/types';
import { BATTLE_DT } from '../../../src/core/constants';
import { decodeJson, encodeJson, hashState } from '../../../src/core/save';
import { Heightfield } from '../../../src/core/terrain/heightfield';
import { createBattle, createSkirmishSetup, issueBattleCommand, stepBattle } from '../../../src/sim/tactical/battle';
import { createFortificationSpec } from '../../../src/sim/tactical/fort';
import { testSetup, TestTerrain } from './helpers';

type Schedule = Map<number, { side: SideIndex; cmd: BattleCommand }[]>;

function stepTo(state: BattleState, terrain: TerrainQuery, tick: number, schedule: Schedule): void {
  const out: BattleEventRecord[] = [];
  while (state.tick < tick && !state.outcome) {
    for (const c of schedule.get(state.tick) ?? []) issueBattleCommand(state, c.side, c.cmd);
    out.length = 0;
    stepBattle(state, BATTLE_DT, terrain, out);
  }
}

/** Uninterrupted run to `end` vs. a run serialized at `cut` and resumed from JSON. */
function resumeMatches(setup: BattleSetup, terrain: TerrainQuery, cut: number, end: number, schedule: Schedule, probe?: (s: BattleState) => void): { full: BattleState; resumed: BattleState } {
  const full = createBattle(setup, terrain);
  stepTo(full, terrain, end, schedule);
  const half = createBattle(setup, terrain);
  stepTo(half, terrain, cut, schedule);
  probe?.(half);
  const resumed = decodeJson<BattleState>(encodeJson(half));
  stepTo(resumed, terrain, end, schedule);
  expect(hashState(resumed)).toBe(hashState(full));
  return { full, resumed };
}

describe('tactical determinism: resume from serialized state', () => {
  const skirmish = createSkirmishSetup({ seed: 5, preset: 'plains', totalSoldiers: 800, playerFactionId: 'heartland', enemyFactionId: 'highland', armies: null, playerSide: 0, hour: 9, season: 'sharad', weather: 'clear', difficulty: 'normal', aiVsAi: true, compositions: ['balanced', 'balanced'] });
  const hf = Heightfield.generate({ ...skirmish.terrain, resolution: 129 });

  it('same setup + same commands => identical battle', () => {
    const sched: Schedule = new Map([[700, [{ side: 0, cmd: { kind: 'set_shape', formations: [0], shape: 'square' } }]]]);
    const a = createBattle(skirmish, hf);
    const b = createBattle(skirmish, hf);
    stepTo(a, hf, 2400, sched);
    stepTo(b, hf, 2400, sched);
    expect(hashState(a)).toBe(hashState(b));
  });

  it('during deployment (30 s skirmish deployment, AI deploying)', () => {
    resumeMatches(skirmish, hf, 300, 2600, new Map(), (s) => expect(s.phase).toBe('deployment'));
  });

  it('mid-melee', () => {
    const sched: Schedule = new Map([[900, [{ side: 0, cmd: { kind: 'rally' } }]]]);
    // Find a cut inside the melee.
    const probe = createBattle(skirmish, hf);
    let cut = -1;
    const out: BattleEventRecord[] = [];
    while (!probe.outcome && probe.tick < 6000) {
      out.length = 0;
      stepBattle(probe, BATTLE_DT, hf, out);
      const engaged = probe.formations.filter((f) => f.engagedWith.length > 0).length;
      if (engaged >= 4 && probe.tick > 1000) {
        cut = probe.tick + 37;
        break;
      }
    }
    expect(cut).toBeGreaterThan(0);
    resumeMatches(skirmish, hf, cut, cut + 1800, sched, (s) => expect(s.formations.some((f) => f.engagedWith.length > 0)).toBe(true));
  });

  it('mid-siege (ram being built, gate under attack, ladders up)', () => {
    const terrain = new TestTerrain();
    const fortification = createFortificationSpec({ settlementKind: 'town', fortLevel: 2, fortDefense: 1, center: { x: 0, z: 0 }, radius: 120, defenderSide: 1 });
    const setup = testSetup({
      terrain,
      kind: 'siege',
      fortification,
      attackerSide: 0,
      controllers: ['player', 'ai'],
      seed: 77,
      sides: [
        [
          { cls: 'engineers', x: 35, z: 210, facing: Math.PI },
          { cls: 'engineers', x: -60, z: 200, facing: Math.PI },
          { cls: 'spearmen', x: 0, z: 260, facing: Math.PI },
          { cls: 'war_elephants', x: 60, z: 260, facing: Math.PI },
          { cls: 'archers', x: -40, z: 280, facing: Math.PI },
        ],
        [
          { cls: 'archers', x: 30, z: 100, facing: 0 },
          { cls: 'spearmen', x: 0, z: 70, facing: 0 },
          { cls: 'spearmen', x: 0, z: -20, facing: 0 },
        ],
      ],
    });
    const sched: Schedule = new Map([
      [1, [{ side: 0, cmd: { kind: 'order', formations: [0], order: { type: 'construct', work: 'ram', x: 35, z: 210, facing: Math.PI }, queue: false } }]],
      [2, [{ side: 0, cmd: { kind: 'order', formations: [1], order: { type: 'construct', work: 'ladder', x: -70, z: 100, facing: 0 }, queue: false } }]],
      [3, [{ side: 0, cmd: { kind: 'order', formations: [3], order: { type: 'move_to', x: 32, z: 140, facing: Math.PI, run: false }, queue: false } }]],
      [4, [{ side: 0, cmd: { kind: 'order', formations: [4], order: { type: 'skirmish', target: 5 }, queue: false } }]],
    ]);
    const { full } = resumeMatches(setup, terrain, 1000, 3200, sched, (s) => {
      expect(s.siege).not.toBeNull();
      expect(s.works.length).toBeGreaterThan(0);
    });
    expect(full.siege!.gates.some((g) => g.hp < g.maxHp)).toBe(true);
  });
});
