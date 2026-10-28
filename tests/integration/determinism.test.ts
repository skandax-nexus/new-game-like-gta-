/**
 * Reproducible simulation tests (GDD §15 "Save/load and reproducible simulation tests").
 * These guard the determinism contract for every sim developer:
 *  - same setup + same commands => identical state hashes,
 *  - save -> load -> continue == uninterrupted run,
 *  - battles resolve identically when re-run or resumed from a serialized state.
 */
import { describe, expect, it } from 'vitest';
import type { BattleEventRecord, IssuedStrategicCommand, SimEvent, WorldState } from '../../src/core/types';
import { BATTLE_DT } from '../../src/core/constants';
import { decodeJson, encodeJson, hashState } from '../../src/core/save';
import { Heightfield } from '../../src/core/terrain/heightfield';
import { createWorld, getRegionHeightfield, tickWorld } from '../../src/sim/strategic/world';
import { createBattle, createSkirmishSetup, issueBattleCommand, stepBattle } from '../../src/sim/tactical/battle';
import { autoresolveBattle } from '../../src/sim/strategic/autoresolve';
import { defaultSandbox } from '../../src/data/campaign';

function runWorld(world: WorldState, hours: number, cmdsAt: Map<number, IssuedStrategicCommand[]> = new Map()): void {
  const hf = getRegionHeightfield(world);
  const out: SimEvent[] = [];
  for (let h = 0; h < hours; h++) {
    out.length = 0;
    const cmds = cmdsAt.get(world.calendar.totalHours) ?? [];
    tickWorld(world, cmds, out, hf);
    // Auto-handle player prompts deterministically so the sim keeps running.
    for (const e of world.events.pending.slice()) {
      if (e.scope.factionId !== world.playerFactionId) continue;
      tickWorld(world, [{ factionId: world.playerFactionId, hour: 0, cmd: { kind: 'event_choice', eventInstanceId: e.id, choiceId: 'name_heir' } }], out, hf);
    }
    for (const eng of Object.values(world.engagements)) {
      if (eng.status === 'pending_player') tickWorld(world, [{ factionId: world.playerFactionId, hour: 0, cmd: { kind: 'engagement_decision', engagementId: eng.id, decision: 'autoresolve' } }], out, hf);
    }
  }
}

describe('strategic determinism', () => {
  it('same scenario + commands => same state', () => {
    const cmds = new Map<number, IssuedStrategicCommand[]>([[20, [{ factionId: 'heartland', hour: 0, cmd: { kind: 'move_army', armyId: 'army_royal', x: 0, z: 400 } }]]]);
    const a = createWorld({ kind: 'scenario', scenarioId: 'broken_crown', seed: 42, difficulty: 'normal' });
    const b = createWorld({ kind: 'scenario', scenarioId: 'broken_crown', seed: 42, difficulty: 'normal' });
    expect(hashState(a)).toBe(hashState(b));
    runWorld(a, 24 * 20, cmds);
    runWorld(b, 24 * 20, cmds);
    expect(hashState(a)).toBe(hashState(b));
    const c = createWorld({ kind: 'scenario', scenarioId: 'broken_crown', seed: 43, difficulty: 'normal' });
    runWorld(c, 24 * 20, cmds);
    expect(hashState(c)).not.toBe(hashState(a));
  });

  it('save -> load -> continue equals an uninterrupted run', () => {
    const a = createWorld({ kind: 'sandbox', sandbox: defaultSandbox(7) });
    const b = createWorld({ kind: 'sandbox', sandbox: defaultSandbox(7) });
    runWorld(a, 24 * 12);
    runWorld(b, 24 * 6);
    const restored = decodeJson<WorldState>(encodeJson(b));
    runWorld(restored, 24 * 6);
    expect(hashState(restored)).toBe(hashState(a));
  });
});

describe('tactical determinism', () => {
  const setup = createSkirmishSetup({
    seed: 9,
    preset: 'plains',
    totalSoldiers: 800,
    playerFactionId: 'heartland',
    enemyFactionId: 'highland',
    armies: null,
    playerSide: 0,
    hour: 9,
    season: 'sharad',
    weather: 'clear',
    difficulty: 'normal',
    aiVsAi: true,
  });
  const terrain = Heightfield.generate({ ...setup.terrain, resolution: 129 });

  function run(steps: number, state = createBattle(setup, terrain)): ReturnType<typeof createBattle> {
    const out: BattleEventRecord[] = [];
    for (let i = 0; i < steps && !state.outcome; i++) {
      out.length = 0;
      if (state.tick === 100) issueBattleCommand(state, 0, { kind: 'order', formations: [0], order: { type: 'hold' }, queue: false });
      stepBattle(state, BATTLE_DT, terrain, out);
    }
    return state;
  }

  it('same setup + commands => identical battle', () => {
    expect(hashState(run(1500))).toBe(hashState(run(1500)));
  });

  it('resuming from a serialized mid-battle state preserves the outcome', () => {
    const full = run(4000);
    const half = run(1200);
    const resumed = run(4000 - 1200, decodeJson(encodeJson(half)));
    expect(hashState(resumed)).toBe(hashState(full));
  });

  it('autoresolve is reproducible and reaches an outcome', () => {
    const a = autoresolveBattle(setup);
    const b = autoresolveBattle(setup);
    expect(a.outcome).not.toBeNull();
    expect(hashState(a.outcome)).toBe(hashState(b.outcome));
    expect(a.outcome!.autoresolved).toBe(true);
  });
});
