/**
 * Tactical performance budgets in node (ARCHITECTURE §15; GP-01): formation sim < 0.3 ms per step at 1,000 soldiers
 * and < 0.8 ms at 5,000; soldier layer < 1.0 / 3.0 ms with the 'high' LOD distances and the camera on the front line.
 * Measured as the median of 100-step chunk averages over the approach and melee. The battle is deterministic, so it
 * is run twice and each chunk keeps its faster run: contention from parallel test files or a teammate's headless
 * browser only ever inflates a chunk. OWNER: Gameplay Engineer - Tactical Battle Simulation.
 */
import { describe, expect, it } from 'vitest';
import type { BattleEventRecord } from '../../../src/core/types';
import { BATTLE_DT } from '../../../src/core/constants';
import { Heightfield } from '../../../src/core/terrain/heightfield';
import { createBattle, createSkirmishSetup, issueBattleCommand, stepBattle } from '../../../src/sim/tactical/battle';
import { SoldierSim } from '../../../src/sim/tactical/soldiers';

interface PerfResult {
  formations: number;
  soldiers: number;
  formationMs: number;
  soldierMs: number;
  steps: number;
}

interface Chunks {
  formations: number;
  f: number[];
  s: number[];
  steps: number;
}

function measure(total: number): PerfResult {
  const a = run(total);
  const b = run(total);
  const k = Math.min(a.f.length, b.f.length);
  const f: number[] = [];
  const s: number[] = [];
  for (let i = 0; i < k; i++) {
    f.push(Math.min(a.f[i]!, b.f[i]!));
    s.push(Math.min(a.s[i]!, b.s[i]!));
  }
  const med = (x: number[]): number => x.slice().sort((p, q) => p - q)[Math.floor(x.length / 2)]!;
  return { formations: a.formations, soldiers: total, formationMs: med(f), soldierMs: med(s), steps: a.steps };
}

function run(total: number): Chunks {
  const setup = createSkirmishSetup({ seed: 7, preset: 'plains', totalSoldiers: total, playerFactionId: 'heartland', enemyFactionId: 'highland', armies: null, playerSide: 0, hour: 9, season: 'sharad', weather: 'clear', difficulty: 'normal', aiVsAi: true, compositions: ['balanced', 'balanced'] });
  const hf = Heightfield.generate({ ...setup.terrain, resolution: 257 });
  const state = createBattle(setup, hf);
  expect(issueBattleCommand(state, 0, { kind: 'begin_battle' })).toBeNull();
  const sim = new SoldierSim(state, hf.bounds);
  sim.spawn(state, hf);
  const out: BattleEventRecord[] = [];
  const lod = { lodNear: 70, lodMid: 220, lodFar: 900 }; // QualitySettings 'high'
  const fChunks: number[] = [];
  const sChunks: number[] = [];
  let fAcc = 0;
  let sAcc = 0;
  let steps = 0;
  for (let i = 0; i < 3400 && !state.outcome; i++) {
    out.length = 0;
    // Camera on the front line: midpoint of the two armies.
    let fx = 0;
    let fz = 0;
    let k = 0;
    for (const f of state.formations) {
      if (f.soldiers <= 0) continue;
      fx += f.x;
      fz += f.z;
      k++;
    }
    fx /= Math.max(1, k);
    fz /= Math.max(1, k);
    const t0 = performance.now();
    stepBattle(state, BATTLE_DT, hf, out);
    const t1 = performance.now();
    sim.step(state, BATTLE_DT, hf, fx, fz, lod);
    const t2 = performance.now();
    if (i < 200) continue; // JIT warm-up
    fAcc += t1 - t0;
    sAcc += t2 - t1;
    steps++;
    if (steps % 100 === 0) {
      fChunks.push(fAcc / 100);
      sChunks.push(sAcc / 100);
      fAcc = 0;
      sAcc = 0;
    }
  }
  return { formations: state.formations.length, f: fChunks, s: sChunks, steps };
}

describe('tactical performance budgets (node)', () => {
  it('1,000 soldiers: formation step < 0.3 ms, soldier layer < 1.0 ms', () => {
    const r = measure(1000);
    console.log(`[perf] 1,000 soldiers (${r.formations} formations, ${r.steps} steps): formation ${r.formationMs.toFixed(3)} ms/step, soldiers ${r.soldierMs.toFixed(3)} ms/step`);
    expect(r.steps).toBeGreaterThan(1000);
    expect(r.formationMs).toBeLessThan(0.3);
    expect(r.soldierMs).toBeLessThan(1.0);
  });

  it('5,000 soldiers: formation step < 0.8 ms, soldier layer < 3.0 ms', () => {
    const r = measure(5000);
    console.log(`[perf] 5,000 soldiers (${r.formations} formations, ${r.steps} steps): formation ${r.formationMs.toFixed(3)} ms/step, soldiers ${r.soldierMs.toFixed(3)} ms/step`);
    expect(r.steps).toBeGreaterThan(1000);
    expect(r.formationMs).toBeLessThan(0.8);
    expect(r.soldierMs).toBeLessThan(3.0);
  });
});
