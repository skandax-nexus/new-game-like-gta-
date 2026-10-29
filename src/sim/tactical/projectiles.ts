/**
 * Ranged volleys (formation level, authoritative; DESIGN_SPEC §6.6.3-§6.6.4). OWNER: Gameplay Engineer - Tactical
 * Battle Simulation (GP-01). Baseline by the CTO.
 *
 * A shooting formation fires one volley per reloadSec x U(0.9, 1.1) (x1.25 with wet bows in monsoon rain / storm)
 * at a target within
 *   range_eff = min(range, 0.5 x visibility) x (1 + 0.1 x max(0, h_A - h_D) / 10) x (on walls 1.2) x (tower 1.2).
 * Volleys fly 0.3 + d / 55 s and lead the target's velocity; the aim scatters by +-(1.5 + 0.025 d) m per axis (archers
 * are less precise at long range: a stationary 24 x 7 m spear block 120 m away is on target ~80% of the time, which is
 * the "24 hits" of the §6.6.3 worked example). At impact:
 *   hits = count x accuracy x (0.4 + 0.6 density) x onTarget x (1 - 0.4 rain) x (night 0.7) x (walls 1.2) x (tower 1.2)
 *          x U(0.8, 1.2); density = clamp01(2.2 n / (w d)), onTarget = clamp01(1 - miss / (max(w, d)/2 + 6))
 *   dmgHP = hits x rangedAttack x bonusVs x Kr / (1 + 0.5 armor) x shape.missileDamageTaken x (forest 0.6)
 * Friendly fire: a volley at a target in melee with the shooter's friends lands 30% of its hits on the friend in
 * contact. volley_hit morale when hits > 5% of the target; elephant panic roll (§6.6.4); ammo -1 per volley, at 0 the
 * formation shows "No arrows" (ammo_depleted) and stops shooting until resupplied.
 * Render (render/fx/projectiles.ts) draws instanced arrows per volley along `volleyPoint()`.
 */
import type { BattleEventRecord, BattleState, FormationState, Vec2, Vec3, Volley } from '../../core/types';
import type { Rng } from '../../core/rng';
import { clamp01, facingOf } from '../../core/math';
import { BALANCE } from '../../data/balance';
import { RULES } from '../../data/rules';
import { UNITS } from '../../data/units';
import type { BattleContext } from './context';
import { applyDamage } from './combat';
import { ringPoint } from './fort';
import { addMoraleEvent, elephantPanicChance, isNight, onWalls } from './morale';
import { shapeMods } from './stats';

export const ARROW_SPEED = 55;
/** Ranged damage constant Kr = 10 x BALANCE.combat.rangedDamageScale (0.45). */
export const RANGED_K = BALANCE.combat.rangedDamageScale * 10;
/** Archers within this distance of an intact tower shoot from it (+20% range / accuracy). */
export const TOWER_REACH = 10;

const tmp: Vec2 = { x: 0, z: 0 };
const pool: Volley[] = [];

/** The formation stands in (or within reach of) an intact tower of its own fortification. */
export function atTower(state: BattleState, ctx: BattleContext, f: FormationState): boolean {
  const g = ctx.fort;
  const s = state.siege;
  if (!g || !s || f.side !== g.defenderSide) return false;
  for (let t = 0; t < s.towers.length; t++) {
    const tw = s.towers[t]!;
    if (tw.hp <= 0) continue;
    ringPoint(g, g.towerAngle[t]!, g.radius, tmp);
    const dx = tmp.x - f.x;
    const dz = tmp.z - f.z;
    const reach = TOWER_REACH + Math.max(f.width, f.depth) * 0.5;
    if (dx * dx + dz * dz <= reach * reach) return true;
  }
  return false;
}

/** Wet bows (§6.6.3): reload x1.25 in monsoon rain or storm. */
export function wetBows(state: BattleState): boolean {
  const k = state.setup.environment.weather.kind;
  return k === 'monsoon_rain' || k === 'storm';
}

/** Effective range of `shooter` against `target` (null = no height term). */
export function effectiveRange(state: BattleState, ctx: BattleContext, shooter: FormationState, target: FormationState | null): number {
  const st = ctx.stats[shooter.index]!;
  const w = RULES.battle.weather;
  let r = Math.min(st.range, w.rangeVsVisibility * state.setup.environment.weather.visibility);
  if (target) {
    const dh = ctx.terrain.heightAt(shooter.x, shooter.z) - ctx.terrain.heightAt(target.x, target.z);
    if (dh > 0) r *= 1 + (0.1 * dh) / 10;
  }
  if (onWalls(ctx, shooter)) r *= RULES.battle.walls.range;
  if (atTower(state, ctx, shooter)) r *= 1.2;
  return r;
}

/** Expected hits of a volley (random factor = 1) - §6.6.3, exported for tests and the AI. */
export function volleyHits(state: BattleState, ctx: BattleContext, shooter: FormationState, target: FormationState, count: number, miss: number): number {
  const st = ctx.stats[shooter.index]!;
  const area = Math.max(1, target.width * target.depth);
  const density = clamp01((2.2 * target.soldiers) / area);
  const onTarget = clamp01(1 - miss / (Math.max(target.width, target.depth) / 2 + 6));
  const w = RULES.battle.weather;
  let hits = count * st.accuracy * (0.4 + 0.6 * density) * onTarget * (1 - w.rainAccuracy * state.setup.environment.weather.rain);
  if (isNight(state)) hits *= w.nightAccuracy;
  if (onWalls(ctx, shooter)) hits *= RULES.battle.walls.accuracy;
  if (atTower(state, ctx, shooter)) hits *= 1.2;
  return hits;
}

/** HP dealt by `hits` missiles of the shooter on the target (§6.6.3). */
export function volleyDamage(ctx: BattleContext, shooter: FormationState, target: FormationState, hits: number): number {
  const st = ctx.stats[shooter.index]!;
  const armor = ctx.stats[target.index]!.armor;
  const bonus = UNITS[shooter.unitClass].bonusVs[target.unitClass] ?? 1;
  const forest = ctx.grid.classAt(target.x, target.z) === 'forest' ? RULES.battle.forestCover : 1;
  return ((hits * st.rangedAttack * bonus * RANGED_K) / (1 + 0.5 * armor)) * shapeMods(target.shape).missileDamageTaken * forest;
}

/** Aim scatter half-width (m per axis) at distance d. */
export function aimScatter(d: number): number {
  return 1.5 + 0.025 * d;
}

export function launchVolley(state: BattleState, ctx: BattleContext, shooter: FormationState, target: FormationState, rng: Rng, out: BattleEventRecord[]): Volley {
  const st = ctx.stats[shooter.index]!;
  const dx0 = target.x - shooter.x;
  const dz0 = target.z - shooter.z;
  const d0 = Math.sqrt(dx0 * dx0 + dz0 * dz0);
  const flight = 0.3 + d0 / ARROW_SPEED;
  const sc = aimScatter(d0);
  // Lead the target by its velocity.
  const toX = target.x + target.vx * flight + rng.range(-sc, sc);
  const toZ = target.z + target.vz * flight + rng.range(-sc, sc);
  const dx = toX - shooter.x;
  const dz = toZ - shooter.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const v = pool.pop() ?? ({} as Volley);
  v.id = state.nextVolleyId++;
  v.kind = shooter.unitClass === 'scouts' ? 'javelin' : 'arrow';
  v.shooter = shooter.index;
  v.target = target.index;
  v.count = Math.min(shooter.soldiers, 400);
  v.launchTime = state.time;
  v.impactTime = state.time + flight;
  v.fromX = shooter.x;
  v.fromZ = shooter.z;
  v.toX = toX;
  v.toZ = toZ;
  v.arcHeight = Math.max(4, dist * 0.22);
  v.resolved = false;
  state.volleys.push(v);
  shooter.ammo = Math.max(0, shooter.ammo - 1);
  shooter.reload = st.reloadSec * rng.range(0.9, 1.1) * (wetBows(state) ? RULES.battle.weather.wetReload : 1);
  shooter.target = target.index;
  shooter.hidden = false;
  out.push({ time: state.time, kind: 'volley', side: shooter.side, formation: shooter.index, other: target.index, x: toX, z: toZ, value: v.count, text: v.kind });
  if (shooter.ammo === 0) out.push({ time: state.time, kind: 'ammo_depleted', side: shooter.side, formation: shooter.index, other: null, x: shooter.x, z: shooter.z, value: null, text: 'No arrows' });
  return v;
}

/** First formation of `side` in melee contact with `f` (friendly-fire recipient), or null. */
function friendInContact(state: BattleState, f: FormationState, side: number): FormationState | null {
  for (const oi of f.engagedWith) {
    const o = state.formations[oi];
    if (o && o.side === side && o.soldiers > 0) return o;
  }
  return null;
}

/** Start an elephant panic away from the shooter (§6.6.4). */
export function startPanic(state: BattleState, ele: FormationState, fromX: number, fromZ: number, out: BattleEventRecord[]): void {
  ele.panicUntil = state.time + RULES.battle.elephantPanic.durationSec;
  ele.facing = facingOf(ele.x - fromX, ele.z - fromZ);
  ele.activity = 'moving';
  ele.chargeRun = 0;
  out.push({ time: state.time, kind: 'elephant_rampage', side: ele.side, formation: ele.index, other: null, x: ele.x, z: ele.z, value: null, text: 'panic' });
}

/** Resolve volleys whose impact time has passed; drop volleys resolved more than 2 s ago (render fades them). */
export function updateVolleys(state: BattleState, ctx: BattleContext, rng: Rng, supplyHit: Uint8Array, out: BattleEventRecord[]): void {
  const vs = state.volleys;
  for (let i = 0; i < vs.length; i++) {
    const v = vs[i] as Volley;
    if (v.resolved || v.impactTime > state.time) continue;
    v.resolved = true;
    const shooter = state.formations[v.shooter];
    const target = state.formations[v.target];
    if (!shooter || !target || target.soldiers <= 0 || target.activity === 'surrendered') continue;
    const miss = Math.sqrt((target.x - v.toX) * (target.x - v.toX) + (target.z - v.toZ) * (target.z - v.toZ));
    let hits = volleyHits(state, ctx, shooter, target, v.count, miss) * rng.range(0.8, 1.2);
    if (hits <= 0) continue;
    // Friendly fire into a melee (not with hold_fire: such shooters never pick engaged targets).
    const friend = shooter.stance === 'hold_fire' ? null : friendInContact(state, target, shooter.side);
    if (friend) {
      const ff = hits * RULES.battle.friendlyFireShare;
      hits -= ff;
      applyDamage(state, ctx, friend, volleyDamage(ctx, shooter, friend, ff), null, out);
    }
    applyDamage(state, ctx, target, volleyDamage(ctx, shooter, target, hits), shooter, out);
    if (target.soldiers <= 0) continue;
    if (hits > target.soldiers * 0.05) addMoraleEvent(target, 'volley_hit', state.time);
    if (target.unitClass === 'supply_train') supplyHit[target.side] = 1;
    if (target.unitClass === 'war_elephants' && target.panicUntil <= state.time) {
      const p = elephantPanicChance(ctx.stats[target.index]!.unruliness, target.morale, hits, target.soldiers);
      if (rng.chance(p)) startPanic(state, target, shooter.x, shooter.z, out);
    }
  }
  // Keep the array small: drop volleys resolved more than 2 s ago (recycled, no allocation).
  let w = 0;
  for (let i = 0; i < vs.length; i++) {
    const v = vs[i] as Volley;
    if (v.resolved && state.time - v.impactTime > 2) {
      if (pool.length < 256) pool.push(v);
      continue;
    }
    vs[w++] = v;
  }
  vs.length = w;
}

/** Point along a volley's arc at battle time t (for rendering). y is relative height above ground. */
export function volleyPoint(v: Volley, t: number, out: Vec3): Vec3 {
  const span = Math.max(1e-3, v.impactTime - v.launchTime);
  const u = clamp01((t - v.launchTime) / span);
  out.x = v.fromX + (v.toX - v.fromX) * u;
  out.z = v.fromZ + (v.toZ - v.fromZ) * u;
  out.y = 4 * v.arcHeight * u * (1 - u) + 1.5 * (1 - u);
  return out;
}
