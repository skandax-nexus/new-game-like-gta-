/**
 * Formation morale (GDD §5): Morale = f(leadership, cohesion, fatigue, supply, tactical position,
 * recent events, perceived risk). A tunable gameplay model, not a historical equation.
 * OWNER: Lead Gameplay Engineer (with Creative Director for weights in data/balance.ts).
 * Baseline by the CTO.
 *
 * Required behavior: inputs computed from battle state (commander alive/near, flank/rear attacks,
 * nearby allies routing, high ground, outnumbered locally, supply, fatigue); morale drifts toward the
 * target at BALANCE.morale.driftPerSec; shocks (MoraleEvent) decay over time; rout below routThreshold,
 * rally above rallyThreshold when not engaged; breakdown stored for the UI tooltip.
 * Example from GDD: a formation may retreat after its commander falls, its flank collapses and its
 * supply route is threatened, even if most soldiers remain alive.
 */
import type { BattleEventRecord, BattleState, FormationState, MoraleBreakdown, MoraleEventKind, MoraleInputs, TerrainQuery } from '../../core/types';
import { clamp01 } from '../../core/math';
import { BALANCE } from '../../data/balance';
import { UNITS } from '../../data/units';

export function addMoraleEvent(f: FormationState, kind: MoraleEventKind, time: number, magnitude: number, decaySec = 30): void {
  f.moraleEvents.push({ kind, time, magnitude, decaySec });
  if (f.moraleEvents.length > 12) f.moraleEvents.shift();
}

function recentEventsValue(f: FormationState, time: number): number {
  let v = 0;
  for (const e of f.moraleEvents) {
    const age = time - e.time;
    if (age < 0 || age > e.decaySec) continue;
    v += e.magnitude * (1 - age / e.decaySec);
  }
  return Math.max(-1, Math.min(1, v));
}

export function computeMoraleInputs(state: BattleState, f: FormationState, terrain: TerrainQuery): MoraleInputs {
  let friends = 0;
  let enemies = 0;
  const r = 80;
  for (const o of state.formations) {
    if (o.soldiers <= 0 || o.activity === 'routing') continue;
    const dx = o.x - f.x;
    const dz = o.z - f.z;
    if (dx * dx + dz * dz > r * r) continue;
    const w = o.soldiers * (UNITS[o.unitClass].stats.hp / 10);
    if (o.side === f.side) friends += w;
    else enemies += w;
  }
  const h = terrain.heightAt(f.x, f.z);
  let higher = 0;
  if (f.target >= 0) {
    const t = state.formations[f.target];
    if (t) higher = Math.max(-1, Math.min(1, (h - terrain.heightAt(t.x, t.z)) / 10));
  }
  const tc = terrain.terrainClassAt(f.x, f.z);
  const wet = tc === 'shallow_water' || tc === 'marsh' ? -0.4 : 0;
  return {
    leadership: f.leadership,
    cohesion: f.cohesion,
    fatigue: f.fatigue,
    supply: f.supply,
    tacticalPosition: Math.max(-1, Math.min(1, higher * 0.5 + wet)),
    recentEvents: recentEventsValue(f, state.time),
    perceivedRisk: clamp01(enemies / Math.max(1, friends + enemies) - 0.2),
  };
}

export function computeMoraleBreakdown(f: FormationState, inputs: MoraleInputs): MoraleBreakdown {
  const w = BALANCE.morale.weights;
  const def = UNITS[f.unitClass].stats;
  const contributions = {
    leadership: (inputs.leadership - 0.5) * w.leadership,
    cohesion: (inputs.cohesion - 0.5) * w.cohesion,
    fatigue: -inputs.fatigue * w.fatigue,
    supply: (inputs.supply - 0.5) * w.supply,
    tacticalPosition: inputs.tacticalPosition * w.tacticalPosition,
    recentEvents: inputs.recentEvents * w.recentEvents,
    perceivedRisk: -inputs.perceivedRisk * w.perceivedRisk,
  };
  const base = def.baseMorale + f.experience * 15;
  let target = base;
  let dominant: keyof MoraleInputs = 'cohesion';
  let worst = Infinity;
  for (const k of Object.keys(contributions) as (keyof MoraleInputs)[]) {
    const c = contributions[k] * (k === 'recentEvents' || k === 'perceivedRisk' ? 1 - def.discipline * 0.5 : 1);
    contributions[k] = c;
    target += c;
    if (c < worst) {
      worst = c;
      dominant = k;
    }
  }
  target = Math.max(0, Math.min(100, target));
  const trend = Math.sign(target - f.morale) * BALANCE.morale.driftPerSec;
  return { inputs, contributions, base, target, trend, dominant };
}

/** Update morale + rout/rally for one formation. */
export function updateMorale(state: BattleState, f: FormationState, dt: number, terrain: TerrainQuery, out: BattleEventRecord[]): void {
  if (f.soldiers <= 0 || f.activity === 'destroyed' || f.activity === 'surrendered') return;
  const inputs = computeMoraleInputs(state, f, terrain);
  const b = computeMoraleBreakdown(f, inputs);
  f.moraleBreakdown = b;
  const step = BALANCE.morale.driftPerSec * dt;
  f.morale += Math.max(-step, Math.min(step, b.target - f.morale));
  // Casualty shock: losing > 10% within the event window.
  const m = BALANCE.morale;
  if (f.activity !== 'routing' && f.morale < m.routThreshold) {
    f.activity = 'routing';
    f.order = { type: 'withdraw', x: null, z: null };
    f.engagedWith = [];
    out.push({ time: state.time, kind: 'formation_routed', side: f.side, formation: f.index, other: null, x: f.x, z: f.z, value: f.morale, text: null });
    for (const o of state.formations) {
      if (o === f || o.side !== f.side || o.soldiers <= 0) continue;
      const dx = o.x - f.x;
      const dz = o.z - f.z;
      if (dx * dx + dz * dz < m.allyRoutRadius * m.allyRoutRadius) addMoraleEvent(o, 'ally_routed', state.time, m.allyRoutShock, 40);
    }
    for (const o of state.formations) if (o.side !== f.side && o.soldiers > 0) addMoraleEvent(o, 'enemy_routed', state.time, 0.15, 30);
  } else if (f.activity === 'routing' && f.morale > m.rallyThreshold && state.time - f.lastHitTime > 10) {
    f.activity = 'rallying';
    f.order = { type: 'regroup' };
    addMoraleEvent(f, 'rallied', state.time, 0.2, 20);
    out.push({ time: state.time, kind: 'formation_rallied', side: f.side, formation: f.index, other: null, x: f.x, z: f.z, value: f.morale, text: null });
  }
}
