/**
 * Ranged volleys (formation level, authoritative). OWNER: Lead Gameplay Engineer. Baseline by the CTO.
 *
 * A Volley is launched by a shooting formation, flies on a parabola, and applies damage at impact time.
 * Render (render/fx/projectiles.ts) spawns instanced arrows per volley using `volleyPoint()` so the
 * visuals match the authoritative timing. Required (owner): line of sight / visibility, friendly-fire
 * risk when shooting into melee, rain + wind penalties, fire arrows (morale + fire FX), ammo resupply.
 */
import type { BattleEventRecord, BattleState, FormationState, TerrainQuery, Vec3, Volley } from '../../core/types';
import type { Rng } from '../../core/rng';
import { clamp01 } from '../../core/math';
import { BALANCE } from '../../data/balance';
import { UNITS } from '../../data/units';
import { applyDamage } from './combat';
import { addMoraleEvent } from './morale';

export const ARROW_SPEED = 55;

export function launchVolley(state: BattleState, shooter: FormationState, target: FormationState, rng: Rng, out: BattleEventRecord[]): Volley {
  const st = UNITS[shooter.unitClass].stats;
  const flight = 0.3 + Math.sqrt((target.x - shooter.x) * (target.x - shooter.x) + (target.z - shooter.z) * (target.z - shooter.z)) / ARROW_SPEED;
  // Lead the target by its velocity.
  const toX = target.x + target.vx * flight + rng.range(-2, 2);
  const toZ = target.z + target.vz * flight + rng.range(-2, 2);
  const dx = toX - shooter.x;
  const dz = toZ - shooter.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const v: Volley = {
    id: state.nextVolleyId++,
    kind: shooter.unitClass === 'scouts' ? 'javelin' : 'arrow',
    shooter: shooter.index,
    target: target.index,
    count: Math.min(shooter.soldiers, 400),
    launchTime: state.time,
    impactTime: state.time + flight,
    fromX: shooter.x,
    fromZ: shooter.z,
    toX,
    toZ,
    arcHeight: Math.max(4, dist * 0.22),
    resolved: false,
  };
  state.volleys.push(v);
  shooter.ammo = Math.max(0, shooter.ammo - 1);
  shooter.reload = st.reloadSec * rng.range(0.9, 1.1);
  out.push({ time: state.time, kind: 'volley', side: shooter.side, formation: shooter.index, other: target.index, x: toX, z: toZ, value: v.count, text: null });
  if (shooter.ammo === 0) out.push({ time: state.time, kind: 'ammo_depleted', side: shooter.side, formation: shooter.index, other: null, x: null, z: null, value: null, text: null });
  return v;
}

/** Resolve volleys whose impact time has passed; drop resolved volleys after a short linger. */
export function updateVolleys(state: BattleState, terrain: TerrainQuery, rng: Rng, out: BattleEventRecord[]): void {
  const vs = state.volleys;
  for (let i = 0; i < vs.length; i++) {
    const v = vs[i] as Volley;
    if (v.resolved || v.impactTime > state.time) continue;
    v.resolved = true;
    const shooter = state.formations[v.shooter];
    const target = state.formations[v.target];
    if (!shooter || !target || target.soldiers <= 0) continue;
    const st = UNITS[shooter.unitClass].stats;
    const miss = Math.sqrt((target.x - v.toX) * (target.x - v.toX) + (target.z - v.toZ) * (target.z - v.toZ));
    const spreadArea = Math.max(1, target.width * target.depth);
    const density = clamp01((target.soldiers * 2.2) / spreadArea);
    const onTarget = clamp01(1 - miss / (Math.max(target.width, target.depth) * 0.5 + 6));
    const weather = 1 - state.setup.environment.weather.rain * 0.4;
    const hits = v.count * st.accuracy * (0.4 + density * 0.6) * onTarget * weather * (0.8 + rng.next() * 0.4);
    const armor = UNITS[target.unitClass].stats.armor;
    const dmg = (hits * st.rangedAttack * BALANCE.combat.rangedDamageScale * 10) / (1 + armor * 0.5);
    applyDamage(state, target, dmg, out);
    if (hits > target.soldiers * 0.05) addMoraleEvent(target, 'volley_hit', state.time, -0.08, 10);
    void terrain;
  }
  // Keep the array small: drop volleys resolved more than 2 s ago (render fades them).
  let w = 0;
  for (let i = 0; i < vs.length; i++) {
    const v = vs[i] as Volley;
    if (v.resolved && state.time - v.impactTime > 2) continue;
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
