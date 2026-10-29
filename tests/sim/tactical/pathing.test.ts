/**
 * Battle pathing (GP-01): flow fields on the 8 m battle grid route formations across rivers through the nearest ford
 * or bridge, never through deep water; fords close in flood; engineer bridges open a crossing; a new order costs
 * < 2 ms in node. OWNER: Gameplay Engineer - Tactical Battle Simulation.
 */
import { describe, expect, it } from 'vitest';
import type { BattleEventRecord, TerrainClass } from '../../../src/core/types';
import { BATTLE_DT } from '../../../src/core/constants';
import { Heightfield } from '../../../src/core/terrain/heightfield';
import { createBattle, createSkirmishSetup, issueBattleCommand, stepBattle } from '../../../src/sim/tactical/battle';
import { battleContext } from '../../../src/sim/tactical/context';
import { BattleGrid, FLOW_INF } from '../../../src/sim/tactical/pathing';
import { moveProfile } from '../../../src/sim/tactical/stats';
import { testSetup, TestTerrain } from './helpers';

/** River 48 m wide along x (|z| < 24), a ford at x 180..230 and a road bridge at x -330..-300. */
function riverClass(x: number, z: number): TerrainClass {
  if (Math.abs(z) >= 24) return 'open';
  if (x >= -330 && x <= -300) return 'road';
  if (x >= 180 && x <= 230) return 'shallow_water';
  return 'deep_water';
}

function crossing(order: { fromX: number; toX: number }, flood = 0): { maxDeep: number; crossX: number[]; arrived: boolean } {
  const terrain = new TestTerrain({ classAt: riverClass });
  const setup = testSetup({ terrain, sides: [[{ cls: 'spearmen', x: order.fromX, z: -200, facing: 0, shape: 'column' }], [{ cls: 'scouts', x: 480, z: 480, facing: 0 }]] });
  setup.environment.weather.flood = flood;
  const state = createBattle(setup, terrain);
  expect(issueBattleCommand(state, 0, { kind: 'order', formations: [0], order: { type: 'move_to', x: order.toX, z: 200, facing: 0, run: false }, queue: false })).toBeNull();
  const out: BattleEventRecord[] = [];
  let maxDeep = 0;
  const crossX: number[] = [];
  const f = state.formations[0]!;
  let prevZ = f.z;
  for (let i = 0; i < 20 * 900 && f.order.type === 'move_to'; i++) {
    out.length = 0;
    stepBattle(state, BATTLE_DT, terrain, out);
    if (terrain.terrainClassAt(f.x, f.z) === 'deep_water') maxDeep++;
    if (prevZ < 0 && f.z >= 0) crossX.push(f.x);
    prevZ = f.z;
  }
  return { maxDeep, crossX, arrived: Math.abs(f.z - 200) < 2 && Math.abs(f.x - order.toX) < 2 };
}

describe('battle pathing: rivers, fords, bridges', () => {
  it('a formation ordered across the river from the west crosses at the nearest crossing (the bridge), never in deep water', () => {
    const r = crossing({ fromX: -250, toX: -250 });
    console.log(`[pathing] west order crossed at x = ${r.crossX.map((x) => x.toFixed(0)).join(', ')}; ticks in deep water: ${r.maxDeep}`);
    expect(r.arrived).toBe(true);
    expect(r.maxDeep).toBe(0);
    expect(r.crossX.length).toBe(1);
    expect(r.crossX[0]!).toBeGreaterThanOrEqual(-334);
    expect(r.crossX[0]!).toBeLessThanOrEqual(-296);
  });

  it('from the east it wades the ford (nearest), never in deep water', () => {
    const r = crossing({ fromX: 300, toX: 300 });
    console.log(`[pathing] east order crossed at x = ${r.crossX.map((x) => x.toFixed(0)).join(', ')}; ticks in deep water: ${r.maxDeep}`);
    expect(r.arrived).toBe(true);
    expect(r.maxDeep).toBe(0);
    expect(r.crossX[0]!).toBeGreaterThanOrEqual(176);
    expect(r.crossX[0]!).toBeLessThanOrEqual(234);
  });

  it('fords close in flood (> 0.5): the same order goes round by the bridge', () => {
    const r = crossing({ fromX: 300, toX: 300 }, 0.8);
    console.log(`[pathing] flood: crossed at x = ${r.crossX.map((x) => x.toFixed(0)).join(', ')}`);
    expect(r.arrived).toBe(true);
    expect(r.maxDeep).toBe(0);
    expect(r.crossX[0]!).toBeLessThanOrEqual(-296);
  });

  it('no route through deep water: the flow field leaves every deep cell unreachable', () => {
    const terrain = new TestTerrain({ classAt: riverClass });
    const grid = new BattleGrid(terrain, false);
    const p = moveProfile('spearmen');
    const dist = grid.flowField(p, 0, grid.cellAt(-250, 200));
    let deepReached = 0;
    for (let c = 0; c < grid.n; c++) if (grid.tclass[c] === 8 && dist[c]! < FLOW_INF) deepReached++;
    expect(deepReached).toBe(0);
    expect(dist[grid.cellAt(-250, -200)]!).toBeLessThan(FLOW_INF);
    // Elephants wade shallows too, but deep water stays closed to every profile.
    const pe = moveProfile('war_elephants');
    const de = grid.flowField(pe, 0, grid.cellAt(0, 200));
    expect(de[grid.cellAt(0, 0)]!).toBe(FLOW_INF);
  });

  it('the straight-line memo never answers for another cell pair (cache history cannot change a route)', () => {
    // Reviewer regression: pairs (from, to) and (from - 2, to + 62) shared the memo key from * 31 + to. A clear pair
    // on the west bank was cached first and the river crossing then read "clear" - the formation would aim straight
    // across deep water, and a resumed battle (cold memo) could path differently from the uninterrupted run.
    const terrain = new TestTerrain({ classAt: (x) => (x >= 0 && x < 8 ? 'deep_water' : 'open') });
    const p = moveProfile('spearmen');
    const cols = new BattleGrid(terrain, false).cols;
    const cell = (x: number, z: number): number => z * cols + x;
    const clear = [cell(10, 10), cell(50, 10)] as const;
    const across = [cell(8, 10), cell(112, 10)] as const;
    const cold = new BattleGrid(terrain, false);
    expect(cold.directClear(across[0], across[1], p, 0)).toBe(false);
    const warm = new BattleGrid(terrain, false);
    expect(warm.directClear(clear[0], clear[1], p, 0)).toBe(true);
    expect(warm.directClear(across[0], across[1], p, 0)).toBe(false);
    // And the waypoint from the west bank to the east bank never goes direct.
    const wp = { x: 0, z: 0 };
    expect(warm.waypoint(p, 0, warm.centerX(across[0]), warm.centerZ(across[0]), warm.centerX(across[1]), warm.centerZ(across[1]), wp)).not.toBe(0);
  });

  it('engineers bridge an unfordable river (90 s) and the waiting column then crosses on it', () => {
    const terrain = new TestTerrain({ classAt: (_x, z) => (Math.abs(z) < 14 ? 'deep_water' : 'open') });
    const setup = testSetup({
      terrain,
      sides: [
        [
          { cls: 'engineers', x: 0, z: -40, facing: 0 },
          { cls: 'spearmen', x: 60, z: -60, facing: 0, shape: 'column' },
        ],
        [{ cls: 'scouts', x: 480, z: 480, facing: 0 }],
      ],
    });
    const state = createBattle(setup, terrain);
    const ctx = battleContext(state, terrain);
    expect(issueBattleCommand(state, 0, { kind: 'order', formations: [1], order: { type: 'move_to', x: 60, z: 120, facing: 0, run: false }, queue: false })).toBeNull();
    expect(issueBattleCommand(state, 0, { kind: 'order', formations: [0], order: { type: 'construct', work: 'bridge', x: 0, z: -18, facing: 0 }, queue: false })).toBeNull();
    // Then the engineers clear the bridgehead.
    expect(issueBattleCommand(state, 0, { kind: 'order', formations: [0], order: { type: 'move_to', x: -40, z: -45, facing: 0, run: false }, queue: true })).toBeNull();
    const out: BattleEventRecord[] = [];
    const spears = state.formations[1]!;
    const eng = state.formations[0]!;
    let started = -1;
    let built = -1;
    let deep = 0;
    for (let i = 0; i < 20 * 400 && spears.order.type === 'move_to'; i++) {
      out.length = 0;
      stepBattle(state, BATTLE_DT, terrain, out);
      if (started < 0 && eng.activity === 'constructing') started = state.time;
      if (built < 0 && state.works.some((w) => w.work === 'bridge' && w.progress >= 1)) built = state.time;
      if (terrain.terrainClassAt(spears.x, spears.z) === 'deep_water' && ctx.grid.road[ctx.grid.cellAt(spears.x, spears.z)] === 0) deep++;
      if (built < 0) expect(spears.z).toBeLessThan(-12);
    }
    console.log(`[pathing] bridge: work started t=${started.toFixed(1)} s, built t=${built.toFixed(1)} s (${(built - started).toFixed(1)} s); column arrived at ${spears.x.toFixed(0)},${spears.z.toFixed(0)} t=${state.time.toFixed(0)} s`);
    expect(Math.abs(built - started - 90)).toBeLessThan(2);
    expect(deep).toBe(0);
    expect(spears.z).toBeGreaterThan(118);
  });

  it('the river_crossing skirmish map: both AI hosts reach each other through the ford without entering deep water', () => {
    const setup = createSkirmishSetup({ seed: 11, preset: 'river_crossing', totalSoldiers: 600, playerFactionId: 'heartland', enemyFactionId: 'highland', armies: null, playerSide: 0, hour: 9, season: 'sharad', weather: 'clear', difficulty: 'normal', aiVsAi: true, compositions: ['balanced', 'balanced'] });
    const hf = Heightfield.generate({ ...setup.terrain, resolution: 257 });
    const state = createBattle(setup, hf);
    const ctx = battleContext(state, hf);
    const out: BattleEventRecord[] = [];
    let deep = 0;
    let contacts = 0;
    for (let i = 0; i < 20 * 240 && !state.outcome; i++) {
      out.length = 0;
      stepBattle(state, BATTLE_DT, hf, out);
      for (const f of state.formations) if (f.soldiers > 0 && f.panicUntil <= state.time && f.activity !== 'routing' && ctx.grid.classAt(f.x, f.z) === 'deep_water') deep++;
      contacts += out.filter((e) => e.kind === 'contact').length;
    }
    console.log(`[pathing] river_crossing seed 11: ${contacts} contacts in 4 min, formation-ticks in deep water: ${deep}`);
    expect(contacts).toBeGreaterThan(0);
    expect(deep).toBe(0);
  });

  it('a new order costs < 2 ms in node (flow field on the 128 x 128 grid, fresh destination)', () => {
    const terrain = new TestTerrain({ classAt: riverClass });
    const grid = new BattleGrid(terrain, false);
    const p = moveProfile('spearmen');
    for (let k = 0; k < 4; k++) grid.flowField(p, 0, grid.cellAt(-400 + k * 7, 300)); // warm-up (JIT)
    // Algorithmic cost: best of 3 fresh computations per destination (the overlay reset drops the cache), so CPU
    // contention from parallel test files does not decide the result; median over 30 destinations.
    const times: number[] = [];
    const wp = { x: 0, z: 0 };
    for (let k = 0; k < 30; k++) {
      const dest = grid.cellAt(-450 + k * 31, k % 2 === 0 ? 300 : -300);
      let best = Infinity;
      for (let r = 0; r < 3; r++) {
        grid.resetOverlay();
        const t0 = performance.now();
        grid.flowField(p, k % 2, dest);
        grid.waypoint(p, k % 2, 0, -300, grid.centerX(dest), grid.centerZ(dest), wp);
        best = Math.min(best, performance.now() - t0);
      }
      times.push(best);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)]!;
    console.log(`[pathing] new-order cost: median ${median.toFixed(3)} ms, p90 ${times[Math.floor(times.length * 0.9)]!.toFixed(3)} ms, min ${times[0]!.toFixed(3)} ms (budget 2 ms)`);
    expect(median).toBeLessThan(2);
  });
});
