/**
 * Formation morale (GDD §5, DESIGN_SPEC §6.7): a tunable gameplay model, not a historical equation.
 * OWNER: Gameplay Engineer - Tactical Battle Simulation (GP-01) (weights by the Creative Director in data/balance.ts).
 *
 *   target = baseMorale + 15 x experience + playerMoraleBonus (player side) [- 5 night, non-guards] [- 10 spent]
 *          + (L - 0.5) x 18 + (C - 0.5) x 22 - F x 24 + (S - 0.5) x 10 + T x 14
 *          + R x 36 x (1 - 0.5 discipline) - P x 50 x (1 - 0.5 discipline)          clamped 0..100
 *
 * Morale drifts toward the target at BALANCE.morale.driftPerSec (4 points/s). Inputs:
 *  - L leadership (battle.ts, §6.11), C cohesion, F fatigue (§6.9).
 *  - S supply: the formation's entering supply, -0.3 while the side's supply train is engaged or lost.
 *  - T tactical position: 0.5 x clamp(dh / 10) vs the current target, +0.3 both flanks covered (friend within 30 m
 *    each side), +0.3 behind works / on walls, +0.2 foot in forest, -0.4 in water / marsh, -0.5 surrounded (enemies
 *    on >= 3 aspects within 30 m). Clamped -1..1.
 *  - R recent events: decaying sum of MoraleEvents (table MORALE_EVENTS). Clamped to [RECENT_EVENTS_MIN, 1]: the
 *    floor is -1.5 rather than -1 so that the GDD example (commander fallen + flank + supply = -1.25) is not
 *    saturated - with a -1 floor its target is ~31 (wavering) instead of the specified ~25 (rout).
 *  - P perceived risk: enemyWeight / (friend + enemy) - 0.2 + 0.7 x losses within 80 m, +0.2 if charged by
 *    elephants in the last 10 s, +0.15 enemy mounted within 60 m on a flank / the rear. Clamped 0..1.
 * Events of the same kind refresh instead of stacking (a formation is "flanked", not flanked twelve times), except
 * ally_routed / enemy_routed / reinforced which stack per occurrence. The breakdown (contributions + dominant
 * negative factor) is written in place into `FormationState.moraleBreakdown` for the UI tooltip.
 */
import type { BattleState, FormationState, MoraleBreakdown, MoraleEventKind, MoraleInputs, Vec2 } from '../../core/types';
import { clamp, clamp01 } from '../../core/math';
import { BALANCE } from '../../data/balance';
import { DIFFICULTY_DEFS } from '../../data/difficulty';
import { RULES } from '../../data/rules';
import type { BattleContext } from './context';
import { aspectOf, localOf } from './context';
import { distFromCenter, insideRing, WALL_WALK_DEPTH } from './fort';
import { toLocal } from './formations';
import { fatigueTier, isFoot, isMounted } from './stats';

/** Floor of the recent-events input R (see header). */
export const RECENT_EVENTS_MIN = -1.5;
/** Most morale events a formation keeps (oldest / weakest replaced). */
export const MAX_MORALE_EVENTS = 12;

export interface MoraleEventSpec {
  magnitude: number;
  decaySec: number;
  stacks: boolean;
}

const M = BALANCE.morale;

/** §6.7 event table (magnitude / decay seconds). */
export const MORALE_EVENTS: Readonly<Record<MoraleEventKind, MoraleEventSpec>> = {
  commander_fallen: { magnitude: M.commanderFallenShock, decaySec: 60, stacks: false },
  flank_attacked: { magnitude: M.flankShock, decaySec: 25, stacks: false },
  rear_attacked: { magnitude: M.rearShock, decaySec: 25, stacks: false },
  ally_routed: { magnitude: M.allyRoutShock, decaySec: 40, stacks: true },
  enemy_routed: { magnitude: 0.15, decaySec: 30, stacks: true },
  charged: { magnitude: M.chargeShock, decaySec: 20, stacks: false },
  heavy_casualties: { magnitude: -0.12, decaySec: 20, stacks: false },
  volley_hit: { magnitude: -0.08, decaySec: 10, stacks: false },
  elephant_panic: { magnitude: -0.3, decaySec: 20, stacks: false },
  supply_threatened: { magnitude: -0.2, decaySec: 60, stacks: false },
  reinforced: { magnitude: 0.2, decaySec: 30, stacks: true },
  general_nearby: { magnitude: 0.1, decaySec: 10, stacks: false },
  victory_near: { magnitude: 0.25, decaySec: 30, stacks: false },
  rallied: { magnitude: 0.2, decaySec: 20, stacks: false },
};

function remaining(magnitude: number, age: number, decay: number): number {
  if (age < 0 || age >= decay) return 0;
  return magnitude * (1 - age / decay);
}

/**
 * Add (or refresh) a morale event. `magnitude` defaults to the table value. `minInterval` > 0 skips the event if
 * one of the same kind happened less than that many seconds ago (e.g. horses fearing elephants: once per 20 s).
 */
export function addMoraleEvent(f: FormationState, kind: MoraleEventKind, time: number, magnitude?: number, decaySec?: number, minInterval = 0): void {
  const spec = MORALE_EVENTS[kind];
  const mag = magnitude ?? spec.magnitude;
  const decay = decaySec ?? spec.decaySec;
  const evs = f.moraleEvents;
  if (!spec.stacks) {
    for (const e of evs) {
      if (e.kind !== kind) continue;
      if (minInterval > 0 && time - e.time < minInterval) return;
      const rem = remaining(e.magnitude, time - e.time, e.decaySec);
      if (Math.abs(mag) >= Math.abs(rem)) {
        e.time = time;
        e.magnitude = mag;
        e.decaySec = decay;
      }
      return;
    }
  }
  if (evs.length < MAX_MORALE_EVENTS) {
    evs.push({ kind, time, magnitude: mag, decaySec: decay });
    return;
  }
  // Replace the event with the weakest remaining contribution.
  let wi = 0;
  let wv = Infinity;
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i]!;
    const v = Math.abs(remaining(e.magnitude, time - e.time, e.decaySec));
    if (v < wv) {
      wv = v;
      wi = i;
    }
  }
  const e = evs[wi]!;
  e.kind = kind;
  e.time = time;
  e.magnitude = mag;
  e.decaySec = decay;
}

/** Drop decayed events in place (no allocation). */
export function pruneMoraleEvents(f: FormationState, time: number): void {
  const evs = f.moraleEvents;
  let w = 0;
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i]!;
    if (time - e.time >= e.decaySec) continue;
    evs[w++] = e;
  }
  evs.length = w;
}

/** R: decaying sum of morale events, clamped to [RECENT_EVENTS_MIN, 1]. */
export function recentEventsValue(f: FormationState, time: number): number {
  let v = 0;
  for (const e of f.moraleEvents) v += remaining(e.magnitude, time - e.time, e.decaySec);
  return clamp(v, RECENT_EVENTS_MIN, 1);
}

/** Night (§6.10): hour < 5 or > 20 (setup hour + elapsed battle time). */
export function isNight(state: BattleState): boolean {
  const h = (state.setup.environment.hour + state.time / 3600) % 24;
  return h < 5 || h > 20;
}

/**
 * Defender standing on the walls of a siege (inside the ring within WALL_WALK_DEPTH of the radius). Only the fort
 * geometry is read, so a rules-only context (`rulesContext`) will do.
 */
export function onWalls(ctx: Pick<BattleContext, 'fort'>, f: FormationState): boolean {
  const g = ctx.fort;
  if (!g || f.side !== g.defenderSide) return false;
  const d = distFromCenter(g, f.x, f.z);
  return d <= g.radius && d >= g.radius - WALL_WALK_DEPTH;
}

/** True when the formation is a live, fighting (non-routing, on-field) member of the battle. */
export function standing(f: FormationState): boolean {
  return f.soldiers > 0 && f.activity !== 'routing' && f.activity !== 'surrendered' && f.activity !== 'destroyed';
}

const loc: Vec2 = { x: 0, z: 0 };

/** Which aspect of f an outside point lies on: 0 front, 1 left, 2 right, 3 rear (box-normalized). */
export function aspectOfPoint(f: FormationState, x: number, z: number): 0 | 1 | 2 | 3 {
  toLocal(f, x, z, loc);
  const nx = loc.x / Math.max(1, f.width / 2);
  const nz = loc.z / Math.max(1, f.depth / 2);
  if (Math.abs(nz) >= Math.abs(nx)) return nz >= 0 ? 0 : 3;
  return nx < 0 ? 1 : 2;
}

function weight(ctx: BattleContext, f: FormationState): number {
  return f.soldiers * (ctx.stats[f.index]!.hp / 10);
}

/** Index of the formation f reasons about for height / tactical position: target, else first enemy in contact, else nearest enemy within 250 m. */
export function referenceEnemy(state: BattleState, ctx: BattleContext, f: FormationState): FormationState | null {
  const t = f.target >= 0 ? state.formations[f.target] : undefined;
  if (t && t.side !== f.side && t.soldiers > 0) return t;
  if (f.engagedWith.length) return state.formations[f.engagedWith[0]!] ?? null;
  let best: FormationState | null = null;
  let bd = 250 * 250;
  const n = ctx.n;
  for (const o of state.formations) {
    if (o.side === f.side || !standing(o)) continue;
    const d = ctx.d2[f.index * n + o.index]!;
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

/** Flank cover: friend `o` within 30 m beside `f` (left bit 1 / right bit 2), in f's frame. */
function coverBit(ctx: BattleContext, f: FormationState, o: FormationState): number {
  localOf(ctx, f, o.x, o.z, loc);
  if (Math.abs(loc.z) > Math.max(f.depth, o.depth) / 2 + 25) return 0;
  if (Math.abs(loc.x) - f.width / 2 - o.width / 2 > 30) return 0;
  return loc.x < 0 ? 1 : 2;
}

/** Enemy `o` within 60 m of `f`: aspect bit (within 30 m) and mounted-on-flank bit. */
function threatBits(ctx: BattleContext, f: FormationState, o: FormationState, gap: number, mountedO: boolean): void {
  const asp = aspectOf(ctx, f, o.x, o.z);
  if (gap <= 30) ctx.mAspects[f.index] = ctx.mAspects[f.index]! | (1 << asp);
  if (asp !== 0 && mountedO) ctx.mBits[f.index] = ctx.mBits[f.index]! | 4;
}

/**
 * Per-tick morale preparation: one symmetric pass over formation pairs within 160 m accumulates, for every formation,
 * the friend / enemy weights within 80 m (P), flank cover (T), enemy aspects within 30 m (surrounded) and mounted
 * enemies on a flank (P); one scan of the log tail marks formations charged by elephants in the last 10 s (P).
 * Routing formations do not count as friends, enemies, cover or threats.
 */
export function prepareMorale(state: BattleState, ctx: BattleContext): void {
  const fs = state.formations;
  const n = ctx.n;
  const W = ctx.weight;
  const F = ctx.mflags;
  for (const o of fs) {
    const present = o.soldiers > 0 && o.activity !== 'surrendered' && o.activity !== 'destroyed';
    const w = present ? weight(ctx, o) : 0;
    W[o.index] = w;
    F[o.index] = (present ? 1 : 0) | (o.activity === 'routing' ? 2 : 0) | (isMounted(o.unitClass) ? 4 : 0);
    ctx.mFriends[o.index] = w;
    ctx.mEnemies[o.index] = 0;
    ctx.mAspects[o.index] = 0;
    ctx.mBits[o.index] = 0;
  }
  for (let i = 0; i < n; i++) {
    const fi = F[i]!;
    if (!(fi & 1)) continue;
    const a = fs[i]!;
    const ri = (fi & 2) !== 0;
    const row = i * n;
    for (let j = i + 1; j < n; j++) {
      const fj = F[j]!;
      if (!(fj & 1)) continue;
      const d2 = ctx.d2[row + j]!;
      if (d2 > 160 * 160) continue;
      const rj = (fj & 2) !== 0;
      if (ri && rj) continue;
      const b = fs[j]!;
      const same = a.side === b.side;
      if (d2 <= 80 * 80) {
        if (same) {
          if (!rj) ctx.mFriends[i] += W[j]!;
          if (!ri) ctx.mFriends[j] += W[i]!;
        } else {
          if (!rj) ctx.mEnemies[i] += W[j]!;
          if (!ri) ctx.mEnemies[j] += W[i]!;
        }
      }
      const gap = Math.sqrt(d2) - ctx.radius[i]! - ctx.radius[j]!;
      if (same) {
        if (gap > 30) continue;
        if (!rj) ctx.mBits[i] = ctx.mBits[i]! | coverBit(ctx, a, b);
        if (!ri) ctx.mBits[j] = ctx.mBits[j]! | coverBit(ctx, b, a);
      } else if (gap <= 60) {
        if (!rj) threatBits(ctx, a, b, gap, (fj & 4) !== 0);
        if (!ri) threatBits(ctx, b, a, gap, (fi & 4) !== 0);
      }
    }
  }
  const evs = state.events;
  for (let k = evs.length - 1; k >= 0; k--) {
    const e = evs[k]!;
    if (state.time - e.time > 10) break;
    if ((e.kind === 'charge' || e.kind === 'elephant_rampage') && e.other !== null && e.formation !== null && e.other < n) {
      if (fs[e.formation]?.unitClass === 'war_elephants') ctx.mBits[e.other] = ctx.mBits[e.other]! | 8;
    }
  }
}

/** Fill `out` with the seven morale inputs of f (§6.7); reads the prepareMorale accumulators of this tick. */
export function computeMoraleInputs(state: BattleState, ctx: BattleContext, f: FormationState, supplyHit: Uint8Array, out: MoraleInputs): MoraleInputs {
  const terrain = ctx.terrain;
  const i = f.index;
  const friends = ctx.mFriends[i]!;
  const enemies = ctx.mEnemies[i]!;
  const bits = ctx.mBits[i]!;
  const aspects = ctx.mAspects[i]!;
  const coveredL = (bits & 1) !== 0;
  const coveredR = (bits & 2) !== 0;
  const mountedFlank = (bits & 4) !== 0;
  let aspectCount = 0;
  for (let k = 0; k < 4; k++) if (aspects & (1 << k)) aspectCount++;
  const losses = 1 - f.soldiers / Math.max(1, f.maxSoldiers);
  let p = enemies / Math.max(1, friends + enemies) - 0.2 + 0.7 * losses;
  if (bits & 8) p += 0.2;
  if (mountedFlank) p += 0.15;
  // --- T tactical position ---
  let t = 0;
  const ref = referenceEnemy(state, ctx, f);
  if (ref) t += 0.5 * clamp((terrain.heightAt(f.x, f.z) - terrain.heightAt(ref.x, ref.z)) / 10, -1, 1);
  if (coveredL && coveredR) t += 0.3;
  if (onWalls(ctx, f) || behindWorks(state, f)) t += 0.3;
  const tc = ctx.grid.classAt(f.x, f.z);
  if (tc === 'forest' && isFoot(f.unitClass)) t += 0.2;
  if (tc === 'shallow_water' || tc === 'deep_water' || tc === 'marsh') t -= 0.4;
  if (aspectCount >= 3) t -= 0.5;
  // --- S supply ---
  const s = clamp01(f.supply - (supplyHit[f.side] ? 0.3 : 0));
  out.leadership = f.leadership;
  out.cohesion = f.cohesion;
  out.fatigue = f.fatigue;
  out.supply = s;
  out.tacticalPosition = clamp(t, -1, 1);
  out.recentEvents = recentEventsValue(f, state.time);
  out.perceivedRisk = clamp01(p);
  return out;
}

/** An own completed palisade within 25 m in front of the formation. */
function behindWorks(state: BattleState, f: FormationState): boolean {
  for (const w of state.works) {
    if (w.work !== 'palisade' || w.side !== f.side || w.progress < 1 || w.hp <= 0) continue;
    toLocal(f, w.x, w.z, loc);
    if (loc.z >= -2 && loc.z <= f.depth / 2 + 25 && Math.abs(loc.x) <= f.width / 2 + 10) return true;
  }
  return false;
}

/** Fixed (non-input) morale terms: base + experience + difficulty bonus + night + spent. */
export function moraleBase(ctx: BattleContext, state: BattleState, f: FormationState): number {
  const st = ctx.stats[f.index]!;
  const sideSetup = state.setup.sides[f.side];
  let base = st.baseMorale + RULES.battle.experience.moralePerExp * f.experience;
  if (sideSetup.controller === 'player') base += DIFFICULTY_DEFS[sideSetup.difficulty]?.playerMoraleBonus ?? 0;
  if (f.unitClass !== 'elite_guards' && isNight(state)) base += RULES.battle.weather.nightMorale;
  if (fatigueTier(f.fatigue) === 'spent') base -= 10;
  return base;
}

/** Morale target and breakdown (written in place into f.moraleBreakdown). */
export function updateMoraleBreakdown(ctx: BattleContext, state: BattleState, f: FormationState, supplyHit: Uint8Array): MoraleBreakdown {
  let b = f.moraleBreakdown;
  if (!b) {
    b = {
      inputs: { leadership: 0, cohesion: 0, fatigue: 0, supply: 0, tacticalPosition: 0, recentEvents: 0, perceivedRisk: 0 },
      contributions: { leadership: 0, cohesion: 0, fatigue: 0, supply: 0, tacticalPosition: 0, recentEvents: 0, perceivedRisk: 0 },
      base: 0,
      target: 0,
      trend: 0,
      dominant: 'cohesion',
    };
    f.moraleBreakdown = b;
  }
  computeMoraleInputs(state, ctx, f, supplyHit, b.inputs);
  scoreMorale(ctx, state, f, b);
  return b;
}

/** Fill contributions / target / dominant of a breakdown from its inputs (exported for the worked-example tests). */
export function scoreMorale(ctx: BattleContext, state: BattleState, f: FormationState, b: MoraleBreakdown): void {
  const w = M.weights;
  const st = ctx.stats[f.index]!;
  const disc = 1 - 0.5 * st.discipline;
  const i = b.inputs;
  const c = b.contributions;
  c.leadership = (i.leadership - 0.5) * w.leadership;
  c.cohesion = (i.cohesion - 0.5) * w.cohesion;
  c.fatigue = -i.fatigue * w.fatigue;
  c.supply = (i.supply - 0.5) * w.supply;
  c.tacticalPosition = i.tacticalPosition * w.tacticalPosition;
  c.recentEvents = i.recentEvents * w.recentEvents * disc;
  c.perceivedRisk = -i.perceivedRisk * w.perceivedRisk * disc;
  b.base = moraleBase(ctx, state, f);
  const target = b.base + c.leadership + c.cohesion + c.fatigue + c.supply + c.tacticalPosition + c.recentEvents + c.perceivedRisk;
  b.target = clamp(target, 0, 100);
  let dominant: keyof MoraleInputs = 'cohesion';
  let worst = Infinity;
  if (c.leadership < worst) {
    worst = c.leadership;
    dominant = 'leadership';
  }
  if (c.cohesion < worst) {
    worst = c.cohesion;
    dominant = 'cohesion';
  }
  if (c.fatigue < worst) {
    worst = c.fatigue;
    dominant = 'fatigue';
  }
  if (c.supply < worst) {
    worst = c.supply;
    dominant = 'supply';
  }
  if (c.tacticalPosition < worst) {
    worst = c.tacticalPosition;
    dominant = 'tacticalPosition';
  }
  if (c.recentEvents < worst) {
    worst = c.recentEvents;
    dominant = 'recentEvents';
  }
  if (c.perceivedRisk < worst) {
    worst = c.perceivedRisk;
    dominant = 'perceivedRisk';
  }
  b.dominant = dominant;
  b.trend = Math.sign(b.target - f.morale) * M.driftPerSec;
}

/** Drift morale toward the breakdown target at driftPerSec. */
export function driftMorale(f: FormationState, target: number, dt: number): void {
  const step = M.driftPerSec * dt;
  f.morale += clamp(target - f.morale, -step, step);
  f.morale = clamp(f.morale, 0, 100);
}

/** Morale thresholds (§6.7). */
export const MORALE_WAVERING = 40;
export function isWavering(f: FormationState): boolean {
  return f.morale < MORALE_WAVERING && f.activity !== 'routing';
}

/** Elephant panic chance after a volley (§6.6.4). */
export function elephantPanicChance(unruliness: number, morale: number, hits: number, soldiers: number): number {
  const ep = RULES.battle.elephantPanic;
  return clamp((unruliness * ep.base * (1 - morale / 100) * hits) / Math.max(1, soldiers), 0, ep.maxChance);
}

/** Inside a siege ring (any side). */
export function insideFort(ctx: BattleContext, f: FormationState): boolean {
  return !!ctx.fort && insideRing(ctx.fort, f.x, f.z);
}
