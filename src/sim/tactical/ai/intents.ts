/**
 * Intent orders -> concrete FormationOrders (DESIGN_SPEC §6.4; GDD §5 "hold a crossing", "protect archers"). OWNER: AI
 * Engineer - Battle AI, Intents & Campaign AI (SIM-02).
 *
 * `translateIntent` runs every 1 s (AI_THINK_TICKS) for every controllable formation carrying an intent, for the player
 * and for AI sides alike. It returns the order the formation should be executing now (battle.ts starts it when it differs
 * from the current one) or null to leave the current order alone. Formations sharing one intent (same type and
 * parameters, same side) are laid out together: slots are assigned by formation index, so the layout is stable.
 *
 * | Intent | Translation |
 * |---|---|
 * | hold_crossing (x, z, r) | Spears / guards (and elephants) in line across the ford axis at the near bank, facing the far bank; archers 25 m behind (centre to centre); mounted 60 m back on the flanks as a reserve. Melee engages only enemies inside r and never past the far bank; the mounted reserve charges enemies that reach the near side; archers shoot enemies inside r. |
 * | protect_formation (target) | Stand between the protected formation and the nearest known threat with a 25 m gap, facing it; intercept (attack_target, run) any enemy melee formation within 120 m of the protected one, then return. |
 * | hold_high_ground (x, z, r) | Move to the highest of 16 samples within r (centre, 5 at r / 2, 10 at r), face the nearest enemy, hold (archers shoot from the height: +10% range per 10 m above the target). |
 * | pin_enemy (target) | Advance to a 60 m gap from the target (ranged: max(60, 0.55 x range) so the archers stay inside their skirmish band) and hold (ranged: shoot it); when it charges, fall back 30 m. |
 * | screen_flank (protect, side) | Stand 40 m beyond the protected formation's chosen flank, facing outward; intercept mounted enemies within 150 m. |
 * | pursue_routers | Mounted and scouts only: ride down the nearest routing enemy within 400 m (not one sheltering by a steady enemy); never engage a steady formation; return to the own lines when none remain. Others: no change. |
 * | scout_area (x, z, r) | Run to the area (stopping 110 m short of known enemies there) and reveal it; fall back whenever an enemy comes within 100 m. |
 * | escort_supply (target) | Follow the target at a 20 m gap on the enemy side; intercept enemies within 80 m of it. |
 */
import type { BattleState, FormationIndex, FormationOrder, FormationState, IntentOrder, TerrainQuery } from '../../../core/types';
import { dcos, dsin, facingOf } from '../../../core/math';
import { UNITS } from '../../../data/units';
import { battleContext } from '../context';
import { isOffField } from '../orders';
import { effectiveRange } from '../projectiles';
import { isMounted, isShooter } from '../stats';
import { gap as gapOf } from './common';
import type { CrossingAxis, HighPoint } from './terrain';
import { crossingAxis, highestPoint } from './terrain';

/** Hold-crossing layout distances (§6.4). */
export const CROSSING = { bankStandoff: 6, archersBehind: 25, mountedBack: 60, supportBehind: 50, gap: 8 } as const;
/** Other intent distances (§6.4). */
export const INTENT = {
  protectGap: 25,
  protectIntercept: 120,
  pinGap: 60,
  pinRetreat: 30,
  screenBeyond: 40,
  screenIntercept: 150,
  pursueRange: 400,
  scoutKeep: 100,
  escortGap: 20,
  escortIntercept: 80,
} as const;

const axis: CrossingAxis = { river: false, cx: 0, cz: 0, nx: 0, nz: 1, nearBank: 0, farBank: 0 };
const high: HighPoint = { x: 0, z: 0, height: 0 };
const group: FormationState[] = [];

function standingEnemy(state: BattleState, f: FormationState, e: FormationState, terrain: TerrainQuery): boolean {
  if (e.side === f.side || e.soldiers <= 0 || e.activity === 'surrendered' || e.activity === 'destroyed' || e.activity === 'routing') return false;
  if (!e.spotted || e.hidden) return false;
  const b = terrain.bounds;
  void state;
  return e.x >= b.minX && e.z >= b.minZ && e.x <= b.maxX && e.z <= b.maxZ;
}

function sameIntent(a: IntentOrder, b: IntentOrder): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'hold_crossing':
    case 'hold_high_ground':
    case 'scout_area': {
      const o = b as typeof a;
      return a.x === o.x && a.z === o.z && a.radius === o.radius;
    }
    case 'protect_formation':
    case 'pin_enemy':
    case 'escort_supply':
      return a.target === (b as typeof a).target;
    case 'screen_flank': {
      const o = b as typeof a;
      return a.protect === o.protect && a.side === o.side;
    }
    default:
      return true;
  }
}

/** Formations of f's side carrying the same intent and matching `pick`, by index (f included when it matches). */
function groupOf(state: BattleState, f: FormationState, intent: IntentOrder, pick: (g: FormationState) => boolean): FormationState[] {
  group.length = 0;
  for (const g of state.formations) {
    if (g.side !== f.side || g.soldiers <= 0 || !g.intent || g.activity === 'routing' || g.activity === 'surrendered') continue;
    if (!sameIntent(g.intent, intent) || !pick(g)) continue;
    group.push(g);
  }
  return group;
}

const isLineClass = (g: FormationState): boolean => g.unitClass === 'spearmen' || g.unitClass === 'elite_guards' || g.unitClass === 'war_elephants';
const isMissileClass = (g: FormationState): boolean => UNITS[g.unitClass].category === 'ranged';
const isMountedClass = (g: FormationState): boolean => UNITS[g.unitClass].category === 'mounted';
const isSupportClass = (g: FormationState): boolean => UNITS[g.unitClass].category === 'support';

/** Lateral offset of f in a row of `list` laid side by side with `gap` m between footprints, centred on 0. */
function rowOffset(list: readonly FormationState[], f: FormationState, gap: number): { lat: number; half: number } {
  let w = -gap;
  for (const g of list) w += g.width + gap;
  let off = -w / 2;
  let lat = 0;
  for (const g of list) {
    if (g === f) lat = off + g.width / 2;
    off += g.width + gap;
  }
  return { lat, half: Math.max(0, w / 2) };
}

function maxDepth(list: readonly FormationState[]): number {
  let d = 0;
  for (const g of list) d = Math.max(d, g.depth);
  return d;
}

function moveTo(x: number, z: number, facing: number | null, run: boolean): FormationOrder {
  return { type: 'move_to', x, z, facing, run };
}

function clampIn(terrain: TerrainQuery, p: { x: number; z: number }): { x: number; z: number } {
  const b = terrain.bounds;
  p.x = Math.min(b.maxX - 15, Math.max(b.minX + 15, p.x));
  p.z = Math.min(b.maxZ - 15, Math.max(b.minZ + 15, p.z));
  return p;
}

const pt = { x: 0, z: 0 };

/** Nearest known standing enemy to (x, z) (footprint-agnostic centroid distance), optionally filtered. */
function nearestEnemyTo(state: BattleState, f: FormationState, terrain: TerrainQuery, x: number, z: number, maxD: number, filter?: (e: FormationState) => boolean): FormationState | null {
  let best: FormationState | null = null;
  let bd = maxD * maxD;
  for (const e of state.formations) {
    if (!standingEnemy(state, f, e, terrain) || (filter && !filter(e))) continue;
    const d = (e.x - x) * (e.x - x) + (e.z - z) * (e.z - z);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

/** Nearest known standing enemy within `maxGap` m (footprint gap) of formation `p`. */
function nearestByGap(state: BattleState, f: FormationState, terrain: TerrainQuery, p: FormationState, maxGap: number, filter?: (e: FormationState) => boolean): FormationState | null {
  let best: FormationState | null = null;
  let bd = maxGap;
  for (const e of state.formations) {
    if (!standingEnemy(state, f, e, terrain) || (filter && !filter(e))) continue;
    const g = gapOf(p, e);
    if (g <= bd) {
      bd = g;
      best = e;
    }
  }
  return best;
}

function zoneCentre(state: BattleState, side: 0 | 1): { x: number; z: number } {
  const z = state.setup.sides[side].deployZone;
  return { x: (z.minX + z.maxX) / 2, z: (z.minZ + z.maxZ) / 2 };
}

/** Translate an intent into the order formation `index` should execute now (null = keep the current order). */
export function translateIntentOrder(state: BattleState, index: FormationIndex, intent: IntentOrder, terrain: TerrainQuery): FormationOrder | null {
  const f = state.formations[index];
  if (!f || f.soldiers <= 0) return null;
  const ctx = battleContext(state, terrain);
  if (isOffField(ctx, f)) return null;
  switch (intent.type) {
    case 'hold_crossing':
      return holdCrossing(state, f, intent, terrain);
    case 'protect_formation':
      return protect(state, f, intent.target, terrain);
    case 'hold_high_ground':
      return holdHighGround(state, f, intent, terrain);
    case 'pin_enemy':
      return pin(state, f, intent.target, terrain);
    case 'screen_flank':
      return screen(state, f, intent.protect, intent.side, terrain);
    case 'pursue_routers':
      return pursueRouters(state, f, terrain);
    case 'scout_area':
      return scout(state, f, intent, terrain);
    case 'escort_supply':
      return escort(state, f, intent.target, terrain);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------------
// hold_crossing
// ---------------------------------------------------------------------------------------------------

/**
 * Crossing layout for a side: the axis (n points from the far bank toward the side's own deploy zone), the line centre
 * at the near bank and the line facing. Exported for tests and the AI.
 */
export function crossingLayout(state: BattleState, side: 0 | 1, intent: Extract<IntentOrder, { type: 'hold_crossing' }>, terrain: TerrainQuery, lineDepth: number): { axis: CrossingAxis; lineX: number; lineZ: number; facing: number } {
  const home = zoneCentre(state, side);
  crossingAxis(terrain, intent.x, intent.z, intent.radius, home.x, home.z, axis);
  const back = axis.nearBank + CROSSING.bankStandoff + lineDepth / 2;
  return { axis, lineX: axis.cx + axis.nx * back, lineZ: axis.cz + axis.nz * back, facing: facingOf(-axis.nx, -axis.nz) };
}

function holdCrossing(state: BattleState, f: FormationState, intent: Extract<IntentOrder, { type: 'hold_crossing' }>, terrain: TerrainQuery): FormationOrder {
  const line = groupOf(state, f, intent, isLineClass).slice();
  const lineDepth = maxDepth(line);
  const lay = crossingLayout(state, f.side, intent, terrain, lineDepth);
  const a = lay.axis;
  const facing = lay.facing;
  const rx = -dcos(facing);
  const rz = dsin(facing);
  // Enemies inside r that have not stayed beyond the far bank.
  const valid = (e: FormationState): boolean => {
    const dx = e.x - intent.x;
    const dz = e.z - intent.z;
    if (dx * dx + dz * dz > intent.radius * intent.radius) return false;
    const proj = (e.x - a.cx) * a.nx + (e.z - a.cz) * a.nz;
    return proj >= -a.farBank;
  };
  const crossed = (e: FormationState): boolean => (e.x - a.cx) * a.nx + (e.z - a.cz) * a.nz > 0;
  if (isLineClass(f)) {
    const e = nearestEnemyTo(state, f, terrain, f.x, f.z, intent.radius * 2 + 50, valid);
    if (e) return { type: 'attack_target', target: e.index, run: false };
    const { lat } = rowOffset(line, f, CROSSING.gap);
    pt.x = lay.lineX + rx * lat;
    pt.z = lay.lineZ + rz * lat;
    clampIn(terrain, pt);
    return moveTo(pt.x, pt.z, facing, false);
  }
  const halfLine = rowOffset(line, f, CROSSING.gap).half;
  if (isMissileClass(f)) {
    const ctx = battleContext(state, terrain);
    const e = nearestEnemyTo(state, f, terrain, f.x, f.z, 1000, valid);
    if (e && isShooter(ctx.stats[f.index]!)) {
      const r = effectiveRange(state, ctx, f, e);
      const dx = e.x - f.x;
      const dz = e.z - f.z;
      if (dx * dx + dz * dz <= r * r * 0.81) return { type: 'skirmish', target: e.index };
    }
    const missiles = groupOf(state, f, intent, isMissileClass).slice();
    const { lat } = rowOffset(missiles, f, CROSSING.gap);
    pt.x = lay.lineX + a.nx * CROSSING.archersBehind + rx * lat;
    pt.z = lay.lineZ + a.nz * CROSSING.archersBehind + rz * lat;
    clampIn(terrain, pt);
    return moveTo(pt.x, pt.z, facing, false);
  }
  if (isMountedClass(f)) {
    const e = nearestEnemyTo(state, f, terrain, f.x, f.z, intent.radius * 2 + 100, (o) => valid(o) && crossed(o));
    if (e) return { type: 'charge', target: e.index };
    const mounted = groupOf(state, f, intent, isMountedClass).slice();
    const k = mounted.indexOf(f);
    const sgn = k % 2 === 0 ? -1 : 1;
    const rank = Math.floor(k / 2);
    const lat = sgn * (halfLine + 10 + f.width / 2 + rank * (f.width + CROSSING.gap));
    pt.x = lay.lineX + a.nx * CROSSING.mountedBack + rx * lat;
    pt.z = lay.lineZ + a.nz * CROSSING.mountedBack + rz * lat;
    clampIn(terrain, pt);
    return moveTo(pt.x, pt.z, facing, false);
  }
  // Engineers and carts: behind the archers.
  const support = groupOf(state, f, intent, isSupportClass).slice();
  const { lat } = rowOffset(support, f, CROSSING.gap);
  pt.x = lay.lineX + a.nx * (CROSSING.archersBehind + CROSSING.supportBehind) + rx * lat;
  pt.z = lay.lineZ + a.nz * (CROSSING.archersBehind + CROSSING.supportBehind) + rz * lat;
  clampIn(terrain, pt);
  return moveTo(pt.x, pt.z, facing, false);
}

// ---------------------------------------------------------------------------------------------------
// protect_formation
// ---------------------------------------------------------------------------------------------------

function protect(state: BattleState, f: FormationState, target: FormationIndex, terrain: TerrainQuery): FormationOrder {
  const p = state.formations[target];
  if (!p || p.soldiers <= 0 || p === f || p.activity === 'surrendered') return { type: 'hold' };
  const melee = (e: FormationState): boolean => {
    const c = UNITS[e.unitClass].category;
    return c !== 'ranged' && c !== 'support';
  };
  const intruder = nearestByGap(state, f, terrain, p, INTENT.protectIntercept, melee);
  if (intruder) return { type: 'attack_target', target: intruder.index, run: true };
  const threat = nearestEnemyTo(state, f, terrain, p.x, p.z, 2000);
  let dx: number;
  let dz: number;
  if (threat) {
    dx = threat.x - p.x;
    dz = threat.z - p.z;
  } else {
    dx = dsin(p.facing);
    dz = dcos(p.facing);
  }
  const d = Math.sqrt(dx * dx + dz * dz) || 1;
  const off = p.depth / 2 + INTENT.protectGap + f.depth / 2;
  pt.x = p.x + (dx / d) * off;
  pt.z = p.z + (dz / d) * off;
  clampIn(terrain, pt);
  return moveTo(pt.x, pt.z, facingOf(dx, dz), false);
}

// ---------------------------------------------------------------------------------------------------
// hold_high_ground
// ---------------------------------------------------------------------------------------------------

function holdHighGround(state: BattleState, f: FormationState, intent: Extract<IntentOrder, { type: 'hold_high_ground' }>, terrain: TerrainQuery): FormationOrder {
  highestPoint(terrain, intent.x, intent.z, intent.radius, high);
  const e = nearestEnemyTo(state, f, terrain, high.x, high.z, 3000);
  const facing = e ? facingOf(e.x - high.x, e.z - high.z) : f.facing;
  const members = groupOf(state, f, intent, () => true).slice();
  const { lat } = rowOffset(members, f, CROSSING.gap);
  pt.x = high.x - dcos(facing) * lat;
  pt.z = high.z + dsin(facing) * lat;
  clampIn(terrain, pt);
  return moveTo(pt.x, pt.z, facing, false);
}

/** The point hold_high_ground chooses for (x, z, r) - exported for tests. */
export function highGroundPoint(terrain: TerrainQuery, x: number, z: number, r: number): HighPoint {
  return highestPoint(terrain, x, z, r, { x: 0, z: 0, height: 0 });
}

// ---------------------------------------------------------------------------------------------------
// pin_enemy
// ---------------------------------------------------------------------------------------------------

function pin(state: BattleState, f: FormationState, target: FormationIndex, terrain: TerrainQuery): FormationOrder {
  const t = state.formations[target];
  // The target was picked by the player (or the AI) explicitly: it is tracked like an attack_target order is, seen or
  // not, while it stands.
  if (!t || t.side === f.side || t.soldiers <= 0 || t.activity === 'routing' || t.activity === 'surrendered' || t.activity === 'destroyed') return { type: 'hold' };
  const ctx = battleContext(state, terrain);
  const shooter = isShooter(ctx.stats[f.index]!) && UNITS[f.unitClass].category === 'ranged' && f.ammo > 0;
  const want = shooter ? Math.max(INTENT.pinGap, 0.55 * effectiveRange(state, ctx, f, t)) : INTENT.pinGap;
  const dx = f.x - t.x;
  const dz = f.z - t.z;
  const d = Math.sqrt(dx * dx + dz * dz) || 1;
  const ux = dx / d;
  const uz = dz / d;
  const g = gapOf(f, t);
  const toward = facingOf(-dx, -dz);
  // Charged: the target comes at us - fall back 30 m, still facing it.
  // (u points from the target to f: positive = the target closes on f.)
  const closingSpeed = t.vx * ux + t.vz * uz;
  const aimed = (t.order.type === 'charge' || t.order.type === 'attack_target' || t.order.type === 'flank') && t.order.target === f.index;
  if (f.engagedWith.length === 0 && g < want + 30 && (closingSpeed > 1 || (aimed && closingSpeed > 0.3))) {
    pt.x = f.x + ux * INTENT.pinRetreat;
    pt.z = f.z + uz * INTENT.pinRetreat;
    clampIn(terrain, pt);
    return moveTo(pt.x, pt.z, toward, true);
  }
  if (Math.abs(g - want) > 10) {
    const off = want + t.depth / 2 + f.depth / 2;
    pt.x = t.x + ux * off;
    pt.z = t.z + uz * off;
    clampIn(terrain, pt);
    return moveTo(pt.x, pt.z, toward, false);
  }
  if (shooter) return { type: 'skirmish', target: t.index };
  return moveTo(f.x, f.z, toward, false);
}

// ---------------------------------------------------------------------------------------------------
// screen_flank
// ---------------------------------------------------------------------------------------------------

/** Screen station: 40 m beyond the protected formation's `side` flank, facing outward. Exported for tests. */
export function screenStation(p: FormationState, f: FormationState, side: 'left' | 'right'): { x: number; z: number; facing: number } {
  const s = side === 'left' ? -1 : 1;
  // Right of p = (-cos, sin).
  const vx = -dcos(p.facing) * s;
  const vz = dsin(p.facing) * s;
  const off = p.width / 2 + INTENT.screenBeyond + f.depth / 2;
  return { x: p.x + vx * off, z: p.z + vz * off, facing: facingOf(vx, vz) };
}

function screen(state: BattleState, f: FormationState, protectIndex: FormationIndex, side: 'left' | 'right', terrain: TerrainQuery): FormationOrder {
  const p = state.formations[protectIndex];
  if (!p || p.soldiers <= 0 || p === f || p.activity === 'surrendered') return { type: 'hold' };
  const mounted = (e: FormationState): boolean => isMounted(e.unitClass);
  const a = nearestByGap(state, f, terrain, f, INTENT.screenIntercept, mounted);
  const b = nearestByGap(state, f, terrain, p, INTENT.screenIntercept, mounted);
  const e = a ?? b;
  if (e) return { type: 'attack_target', target: e.index, run: true };
  const st = screenStation(p, f, side);
  pt.x = st.x;
  pt.z = st.z;
  clampIn(terrain, pt);
  const far = (f.x - pt.x) * (f.x - pt.x) + (f.z - pt.z) * (f.z - pt.z) > 80 * 80;
  return moveTo(pt.x, pt.z, st.facing, far);
}

// ---------------------------------------------------------------------------------------------------
// pursue_routers
// ---------------------------------------------------------------------------------------------------

function pursueRouters(state: BattleState, f: FormationState, terrain: TerrainQuery): FormationOrder | null {
  if (!isMounted(f.unitClass)) return null;
  let best: FormationState | null = null;
  let bd: number = INTENT.pursueRange;
  for (const r of state.formations) {
    if (r.side === f.side || r.activity !== 'routing' || r.soldiers <= 0 || !r.spotted) continue;
    const b = terrain.bounds;
    if (r.x < b.minX || r.z < b.minZ || r.x > b.maxX || r.z > b.maxZ) continue;
    const g = gapOf(f, r);
    if (g >= bd) continue;
    // Never ride into a steady formation: skip routers sheltering within 40 m of one.
    let sheltered = false;
    for (const e of state.formations) if (standingEnemy(state, f, e, terrain) && gapOf(e, r) < 40) sheltered = true;
    if (sheltered) continue;
    bd = g;
    best = r;
  }
  if (best) {
    if (bd > 50) {
      pt.x = best.x + best.vx * 3;
      pt.z = best.z + best.vz * 3;
      clampIn(terrain, pt);
      return moveTo(pt.x, pt.z, null, true);
    }
    return { type: 'attack_target', target: best.index, run: true };
  }
  // None left: back to the own lines (40 m behind the centroid of the side's other standing formations).
  let x = 0;
  let z = 0;
  let n = 0;
  for (const o of state.formations) {
    if (o.side !== f.side || o === f || o.soldiers <= 0 || o.activity === 'routing' || o.activity === 'surrendered') continue;
    x += o.x * o.soldiers;
    z += o.z * o.soldiers;
    n += o.soldiers;
  }
  const home = zoneCentre(state, f.side);
  if (n > 0) {
    x /= n;
    z /= n;
  } else {
    x = home.x;
    z = home.z;
  }
  const dx = home.x - x;
  const dz = home.z - z;
  const d = Math.sqrt(dx * dx + dz * dz) || 1;
  pt.x = x + (dx / d) * Math.min(40, d);
  pt.z = z + (dz / d) * Math.min(40, d);
  clampIn(terrain, pt);
  if ((f.x - pt.x) * (f.x - pt.x) + (f.z - pt.z) * (f.z - pt.z) < 30 * 30) return { type: 'hold' };
  return moveTo(pt.x, pt.z, null, false);
}

// ---------------------------------------------------------------------------------------------------
// scout_area
// ---------------------------------------------------------------------------------------------------

function scout(state: BattleState, f: FormationState, intent: Extract<IntentOrder, { type: 'scout_area' }>, terrain: TerrainQuery): FormationOrder {
  const threat = nearestByGap(state, f, terrain, f, INTENT.scoutKeep);
  if (threat) {
    const dx = f.x - threat.x;
    const dz = f.z - threat.z;
    const d = Math.sqrt(dx * dx + dz * dz) || 1;
    const g = gapOf(f, threat);
    const back = INTENT.scoutKeep - g + 40;
    pt.x = f.x + (dx / d) * back;
    pt.z = f.z + (dz / d) * back;
    clampIn(terrain, pt);
    return moveTo(pt.x, pt.z, facingOf(-dx, -dz), true);
  }
  pt.x = intent.x;
  pt.z = intent.z;
  // Stop short of known enemies inside the area.
  const e = nearestEnemyTo(state, f, terrain, intent.x, intent.z, INTENT.scoutKeep + 10 + 40);
  if (e) {
    const dx = intent.x - e.x;
    const dz = intent.z - e.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const keep = INTENT.scoutKeep + 10 + e.depth / 2 + f.depth / 2;
    if (d < keep) {
      const ux = d > 1e-6 ? dx / d : (f.x - e.x) / (Math.sqrt((f.x - e.x) * (f.x - e.x) + (f.z - e.z) * (f.z - e.z)) || 1);
      const uz = d > 1e-6 ? dz / d : (f.z - e.z) / (Math.sqrt((f.x - e.x) * (f.x - e.x) + (f.z - e.z) * (f.z - e.z)) || 1);
      pt.x = e.x + ux * keep;
      pt.z = e.z + uz * keep;
    }
  }
  clampIn(terrain, pt);
  if ((f.x - pt.x) * (f.x - pt.x) + (f.z - pt.z) * (f.z - pt.z) < 8 * 8) return { type: 'hold' };
  return moveTo(pt.x, pt.z, null, true);
}

// ---------------------------------------------------------------------------------------------------
// escort_supply
// ---------------------------------------------------------------------------------------------------

function escort(state: BattleState, f: FormationState, target: FormationIndex, terrain: TerrainQuery): FormationOrder {
  const p = state.formations[target];
  if (!p || p.soldiers <= 0 || p === f || p.activity === 'surrendered') return { type: 'hold' };
  const attacker = nearestByGap(state, f, terrain, p, INTENT.escortIntercept);
  if (attacker) return { type: 'attack_target', target: attacker.index, run: true };
  const e = nearestEnemyTo(state, f, terrain, p.x, p.z, 3000);
  let dx: number;
  let dz: number;
  if (e) {
    dx = e.x - p.x;
    dz = e.z - p.z;
  } else {
    const z = state.setup.sides[(1 - f.side) as 0 | 1].deployZone;
    dx = (z.minX + z.maxX) / 2 - p.x;
    dz = (z.minZ + z.maxZ) / 2 - p.z;
  }
  const d = Math.sqrt(dx * dx + dz * dz) || 1;
  const off = p.depth / 2 + INTENT.escortGap + f.depth / 2;
  pt.x = p.x + (dx / d) * off;
  pt.z = p.z + (dz / d) * off;
  clampIn(terrain, pt);
  const far = (f.x - pt.x) * (f.x - pt.x) + (f.z - pt.z) * (f.z - pt.z) > 60 * 60;
  return moveTo(pt.x, pt.z, facingOf(dx, dz), far);
}
