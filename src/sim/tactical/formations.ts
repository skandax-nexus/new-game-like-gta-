/**
 * Formation geometry, slots, footprints and movement (DESIGN_SPEC §6.2, §6.5). OWNER: Gameplay Engineer - Tactical
 * Battle Simulation (GP-01). Baseline by the CTO.
 *
 * Slot layout convention (shared with sim/tactical/soldiers.ts and render):
 *   slot s -> file = s % files, rank = floor(s / files). Rank 0 is the FRONT rank.
 *   Local offset: x = (file - (files - 1) / 2) * spacingX * spread,  z = ((ranks - 1) / 2 - rank) * spacingZ * spread
 *   (local +Z = forward). World = centroid + rotate(local, facing): world = lx * right + lz * forward with
 *   forward = (sin f, cos f), right = (-cos f, sin f).
 *
 * Rules implemented here:
 *  - files = round(sqrt(n x aspect)), ranks = ceil(n / files), width = files x spacingX x spread, depth = ranks x
 *    spacingZ x spread (§6.2). A right-drag frontage (move_to width) is kept through casualties by preserving the
 *    files:ranks ratio of the custom layout; a shape change restores the shape's aspect.
 *  - Speed = (walk | run) x terrain.speed x (1 - 0.35 fatigue) x shape.speed x mud x ditch (§6.5, §6.10); exhausted
 *    formations (fatigue >= 0.5) cannot run.
 *  - Turning at turnRate; a heading more than 90 deg off the facing is taken by turning in place first, costing
 *    0.1 cohesion per 90 deg turned beyond the first 90 (a full about-face costs 0.1; §6.5 / §6.9).
 *  - Pathing through BattleGrid (flow fields around deep water, walls and works); obstacle sliding.
 *  - No interpenetration (separateFormations, called once per tick): oriented-box overlap resolution, except
 *    routers passing through friends (the friend loses 0.05 cohesion on entry) and elephants / chariots trampling
 *    through foot formations.
 */
import type { FormationShape, FormationState, UnitClass, UnitStats, Vec2 } from '../../core/types';
import { angleDelta, approachAngle, dcos, dsin, facingOf } from '../../core/math';
import { UNITS } from '../../data/units';
import { RULES } from '../../data/rules';
import { BALANCE } from '../../data/balance';
import type { BattleContext } from './context';
import { canRun, isFoot, isMounted, shapeMods, tramples } from './stats';

export interface FormationDims {
  files: number;
  ranks: number;
  width: number;
  depth: number;
  spread: number;
}

const HALF_PI = 1.5707963267948966;

function spacing(cls: UnitClass): UnitStats {
  return UNITS[cls].stats;
}

export function formationDims(unitClass: UnitClass, soldiers: number, shape: FormationShape): FormationDims {
  const st = spacing(unitClass);
  const n = Math.max(1, soldiers);
  const m = shapeMods(shape);
  const files = Math.min(n, Math.max(1, Math.round(Math.sqrt(n * m.aspect))));
  const ranks = Math.ceil(n / files);
  return { files, ranks, width: files * st.spacingX * m.spread, depth: ranks * st.spacingZ * m.spread, spread: m.spread };
}

function defaultFiles(n: number, aspect: number): number {
  return Math.min(Math.max(1, n), Math.max(1, Math.round(Math.sqrt(Math.max(1, n) * aspect))));
}

/** True if the current files count is the shape's default for some strength the current layout could hold. */
function isDefaultLayout(f: FormationState): boolean {
  const a = shapeMods(f.shape).aspect;
  const lo = defaultFiles(f.files * (f.ranks - 1) + 1, a);
  const hi = defaultFiles(f.files * f.ranks, a);
  return f.files >= lo && f.files <= hi;
}

function applyFiles(f: FormationState, files: number): void {
  const st = spacing(f.unitClass);
  const spread = shapeMods(f.shape).spread;
  const n = Math.max(1, f.soldiers);
  f.files = Math.min(n, Math.max(1, files));
  f.ranks = Math.ceil(n / f.files);
  f.width = f.files * st.spacingX * spread;
  f.depth = f.ranks * st.spacingZ * spread;
}

/**
 * Recompute files/ranks/width/depth after a strength change. Default layouts follow the shape aspect; a custom
 * (right-drag) frontage keeps its files:ranks ratio.
 */
export function refreshDims(f: FormationState): void {
  const n = Math.max(1, f.soldiers);
  if (isDefaultLayout(f)) applyFiles(f, defaultFiles(n, shapeMods(f.shape).aspect));
  else applyFiles(f, Math.round(Math.sqrt(n * (f.files / Math.max(1, f.ranks)))));
}

/** Layout for a new shape (shape aspect, default frontage). */
export function resetDims(f: FormationState): void {
  applyFiles(f, defaultFiles(Math.max(1, f.soldiers), shapeMods(f.shape).aspect));
}

/** Right-drag frontage (§6.3): width in meters -> files (at least 2 ranks for > 8 soldiers, all-round shapes keep their aspect). */
export function setFrontage(f: FormationState, widthMeters: number): void {
  if (shapeMods(f.shape).allRound) return;
  const st = spacing(f.unitClass);
  const spread = shapeMods(f.shape).spread;
  const n = Math.max(1, f.soldiers);
  const maxFiles = n > 8 ? Math.ceil(n / 2) : n;
  applyFiles(f, Math.min(maxFiles, Math.max(2, Math.round(widthMeters / (st.spacingX * spread)))));
}

/** Local (unrotated) offset of a slot relative to the formation centroid. +Z = forward. */
export function slotLocalOffset(f: FormationState, slot: number, out: Vec2): Vec2 {
  const st = spacing(f.unitClass);
  const spread = shapeMods(f.shape).spread;
  const files = Math.max(1, f.files);
  const ranks = Math.max(1, f.ranks);
  const file = slot % files;
  const rank = Math.floor(slot / files);
  let lx = (file - (files - 1) / 2) * st.spacingX * spread;
  let lz = ((ranks - 1) / 2 - rank) * st.spacingZ * spread;
  if (f.shape === 'wedge') lz -= Math.abs(lx) * 0.6 - (files * st.spacingX * spread) * 0.15;
  if (f.shape === 'circle' && f.soldiers > 6) {
    // Ring layout: concentric rings facing outward.
    const ringCap = Math.max(6, Math.round(files * 2.2));
    const ring = Math.floor(slot / ringCap);
    const idx = slot % ringCap;
    const r = (1 + ring) * st.spacingZ * 1.4 + 2;
    const a = (idx / ringCap) * 6.283185307179586;
    lx = dsin(a) * r;
    lz = dcos(a) * r;
  }
  out.x = lx;
  out.z = lz;
  return out;
}

/** World position of a slot (centroid + rotated local offset). */
export function slotWorldPosition(f: FormationState, slot: number, out: Vec2): Vec2 {
  slotLocalOffset(f, slot, out);
  const s = dsin(f.facing);
  const c = dcos(f.facing);
  const wx = f.x + out.x * -c + out.z * s;
  const wz = f.z + out.x * s + out.z * c;
  out.x = wx;
  out.z = wz;
  return out;
}

/** Point (x, z) in f's local frame: x = right, z = forward. */
export function toLocal(f: FormationState, x: number, z: number, out: Vec2): Vec2 {
  const dx = x - f.x;
  const dz = z - f.z;
  const s = dsin(f.facing);
  const c = dcos(f.facing);
  out.x = dx * -c + dz * s;
  out.z = dx * s + dz * c;
  return out;
}

/** Half diagonal of the footprint (cheap broad-phase radius). */
export function footprintRadius(f: FormationState): number {
  return 0.5 * Math.sqrt(f.width * f.width + f.depth * f.depth);
}

/** Minimum translation of an oriented-box overlap: `depth` along unit (x, z) pointing from A to B. */
export interface Mtv {
  x: number;
  z: number;
  depth: number;
}

/**
 * Oriented-box overlap (SAT, 4 axes) of two footprints shrunk/grown by `margin` meters on every side. Returns the
 * penetration depth (> 0 = overlapping) and writes the separation axis (A -> B) into `out`.
 */
export function footprintOverlap(a: FormationState, b: FormationState, margin: number, out: Mtv, ctx?: BattleContext): number {
  // The tick's cached sin / cos when a context is given (valid after refreshGeometry).
  const sa = ctx ? ctx.sin[a.index]! : dsin(a.facing);
  const ca = ctx ? ctx.cos[a.index]! : dcos(a.facing);
  const sb = ctx ? ctx.sin[b.index]! : dsin(b.facing);
  const cb = ctx ? ctx.cos[b.index]! : dcos(b.facing);
  const hwA = Math.max(0.5, a.width / 2 + margin);
  const hdA = Math.max(0.5, a.depth / 2 + margin);
  const hwB = Math.max(0.5, b.width / 2 + margin);
  const hdB = Math.max(0.5, b.depth / 2 + margin);
  const tx = b.x - a.x;
  const tz = b.z - a.z;
  let best = Infinity;
  let bx = 0;
  let bz = 1;
  for (let k = 0; k < 4; k++) {
    // Axes: A right, A forward, B right, B forward.
    const ux = k === 0 ? -ca : k === 1 ? sa : k === 2 ? -cb : sb;
    const uz = k === 0 ? sa : k === 1 ? ca : k === 2 ? sb : cb;
    const rA = hwA * Math.abs(-ca * ux + sa * uz) + hdA * Math.abs(sa * ux + ca * uz);
    const rB = hwB * Math.abs(-cb * ux + sb * uz) + hdB * Math.abs(sb * ux + cb * uz);
    const dist = tx * ux + tz * uz;
    const o = rA + rB - Math.abs(dist);
    if (o <= 0) {
      out.depth = o;
      return o;
    }
    if (o < best) {
      best = o;
      const sg = dist >= 0 ? 1 : -1;
      bx = ux * sg;
      bz = uz * sg;
    }
  }
  out.x = bx;
  out.z = bz;
  out.depth = best;
  return best;
}

/** True if the point lies inside f's footprint grown by `margin`. */
export function pointInFootprint(f: FormationState, x: number, z: number, margin: number, ctx?: BattleContext): boolean {
  const dx = x - f.x;
  const dz = z - f.z;
  const s = ctx ? ctx.sin[f.index]! : dsin(f.facing);
  const c = ctx ? ctx.cos[f.index]! : dcos(f.facing);
  const lx = dx * -c + dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) <= f.width / 2 + margin && Math.abs(lz) <= f.depth / 2 + margin;
}

// ---------------------------------------------------------------------------------------------------
// Speed and movement
// ---------------------------------------------------------------------------------------------------

/** Effective speed (m/s) of a formation on its current ground (§6.5). */
export function formationSpeed(ctx: BattleContext, f: FormationState, run: boolean): number {
  const st = ctx.stats[f.index]!;
  const def = UNITS[f.unitClass];
  const base = run && canRun(f) ? st.runSpeed : st.walkSpeed;
  const t = def.terrain[ctx.grid.classAt(f.x, f.z)];
  const wet = ctx.setup.environment.weather.wetness;
  const w = RULES.battle.weather;
  const mud = 1 - (isMounted(f.unitClass) ? w.mudMounted : w.mudInfantry) * wet;
  const slow = ctx.grid.slowAt(f.x, f.z);
  return base * t.speed * (1 - 0.35 * f.fatigue) * shapeMods(f.shape).speed * mud / slow;
}

/**
 * Turn toward `desired` at turnRate. Turning more than 90 deg in place costs 0.1 cohesion per 90 deg turned while
 * the remaining turn exceeds 90 deg.
 */
export function turnInPlace(ctx: BattleContext, f: FormationState, desired: number, dt: number): void {
  const before = Math.abs(angleDelta(f.facing, desired));
  f.facing = approachAngle(f.facing, desired, ctx.stats[f.index]!.turnRate * dt);
  const after = Math.abs(angleDelta(f.facing, desired));
  if (before > HALF_PI) {
    const turned = before - Math.max(HALF_PI, after);
    if (turned > 0) f.cohesion = Math.max(0, f.cohesion - (0.1 * turned) / HALF_PI);
  }
  f.vx = 0;
  f.vz = 0;
}

const wp: Vec2 = { x: 0, z: 0 };
const av: Vec2 = { x: 0, z: 0 };

/**
 * Local avoidance of friendly formations standing between f and its goal (formation level; the soldier layer does
 * the individual separation): the heading is bent sideways around any friend whose footprint lies on the path
 * within ~25 m. Routers / tramplers are ignored (they pass through).
 */
function avoidFriends(ctx: BattleContext, f: FormationState, others: readonly FormationState[], hx: number, hz: number, goalDist: number, out: Vec2): void {
  out.x = hx;
  out.z = hz;
  const n = ctx.n;
  const rf = ctx.radius[f.index]!;
  const look = 25 + f.depth * 0.5;
  let ax = 0;
  let az = 0;
  for (const o of others) {
    if (o === f || o.side !== f.side || o.soldiers <= 0 || o.activity === 'surrendered' || o.activity === 'destroyed') continue;
    const ro = ctx.radius[o.index]!;
    const reach = look + ro + rf;
    if (ctx.d2[f.index * n + o.index]! > reach * reach) continue;
    if (passesThrough(f, o)) continue;
    const rx = o.x - f.x;
    const rz = o.z - f.z;
    const along = rx * hx + rz * hz;
    if (along <= 0 || along > goalDist || along > look + ro) continue;
    const lat = rx * -hz + rz * hx;
    const clear = ro * 0.85 + f.width * 0.5 + 2;
    if (Math.abs(lat) >= clear) continue;
    const away = lat > 0 ? -1 : lat < 0 ? 1 : f.index < o.index ? 1 : -1;
    const w = ((clear - Math.abs(lat)) / clear) * (1 - along / (look + ro + 1));
    ax += -hz * away * w;
    az += hx * away * w;
  }
  if (ax === 0 && az === 0) return;
  const x = hx + ax * 2;
  const z = hz + az * 2;
  const l = Math.sqrt(x * x + z * z) || 1;
  out.x = x / l;
  out.z = z / l;
}

/**
 * Move a formation toward (tx, tz) for dt with pathing (flow field around obstacles), wheeling, turning in place
 * for headings beyond 90 deg, and obstacle sliding. Returns the remaining straight-line distance.
 *  - faceAtEnd: facing on arrival (null keeps the travel facing).
 *  - backwards: back away keeping the current facing at RULES.battle.withdraw.backwardsSpeed (withdraw phase 1).
 *  - speedScale: extra multiplier (formation keeping pace, stepping back...).
 */
export function moveFormation(
  ctx: BattleContext,
  f: FormationState,
  tx: number,
  tz: number,
  run: boolean,
  faceAtEnd: number | null,
  backwards: boolean,
  speedScale: number,
  dt: number,
  others: readonly FormationState[] | null = null,
): number {
  const dx = tx - f.x;
  const dz = tz - f.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 0.6) {
    f.vx = 0;
    f.vz = 0;
    if (faceAtEnd !== null) turnInPlace(ctx, f, faceAtEnd, dt);
    return 0;
  }
  const profile = ctx.profile[f.index]!;
  ctx.grid.waypoint(profile, f.side, f.x, f.z, tx, tz, wp);
  let hx = wp.x - f.x;
  let hz = wp.z - f.z;
  const hl = Math.sqrt(hx * hx + hz * hz);
  if (hl < 1e-6) {
    hx = dx / d;
    hz = dz / d;
  } else {
    hx /= hl;
    hz /= hl;
  }
  if (others && !backwards) {
    avoidFriends(ctx, f, others, hx, hz, d, av);
    hx = av.x;
    hz = av.z;
  }
  const heading = facingOf(hx, hz);
  let speed = formationSpeed(ctx, f, run) * speedScale;
  if (backwards) speed *= RULES.battle.withdraw.backwardsSpeed;
  else {
    const delta = angleDelta(f.facing, heading);
    if (Math.abs(delta) > HALF_PI) {
      turnInPlace(ctx, f, heading, dt);
      return d;
    }
    f.facing = approachAngle(f.facing, heading, ctx.stats[f.index]!.turnRate * dt);
    // Wheeling: a line moving off its facing slows down (full speed straight ahead, half speed at 90 deg).
    speed *= 0.5 + 0.5 * dcos(delta);
  }
  const step = Math.min(d, speed * dt);
  let nx = f.x + hx * step;
  let nz = f.z + hz * step;
  const grid = ctx.grid;
  if (!grid.passableAt(nx, nz, profile, f.side)) {
    if (grid.passableAt(nx, f.z, profile, f.side)) nz = f.z;
    else if (grid.passableAt(f.x, nz, profile, f.side)) nx = f.x;
    else {
      // Try sliding along the obstacle at +-45 and +-90 degrees.
      let moved = false;
      for (let k = 0; k < 4 && !moved; k++) {
        const h = heading + (k === 0 ? 0.785 : k === 1 ? -0.785 : k === 2 ? HALF_PI : -HALF_PI);
        const ax = f.x + dsin(h) * step;
        const az = f.z + dcos(h) * step;
        if (grid.passableAt(ax, az, profile, f.side)) {
          nx = ax;
          nz = az;
          moved = true;
        }
      }
      if (!moved) {
        f.vx = 0;
        f.vz = 0;
        return d;
      }
    }
  }
  const b = ctx.terrain.bounds;
  nx = Math.min(b.maxX - 4, Math.max(b.minX + 4, nx));
  nz = Math.min(b.maxZ - 4, Math.max(b.minZ + 4, nz));
  f.vx = (nx - f.x) / dt;
  f.vz = (nz - f.z) / dt;
  f.x = nx;
  f.z = nz;
  return Math.max(0, d - step);
}

/**
 * Free movement along a fixed heading at `speed` (routers fleeing to their map edge, panicking elephants). Ignores
 * the flow field, slides along deep water / walls and may leave the map when `canLeave` (routers). Returns false
 * if blocked completely.
 */
export function runAlong(ctx: BattleContext, f: FormationState, heading: number, speed: number, canLeave: boolean, dt: number): boolean {
  const profile = ctx.profile[f.index]!;
  const grid = ctx.grid;
  const step = speed * dt;
  const b = ctx.terrain.bounds;
  for (let k = 0; k < 7; k++) {
    const off = k === 0 ? 0 : (k % 2 === 1 ? 1 : -1) * Math.ceil(k / 2) * 0.6;
    const h = heading + off;
    const nx = f.x + dsin(h) * step;
    const nz = f.z + dcos(h) * step;
    const outside = nx < b.minX || nz < b.minZ || nx > b.maxX || nz > b.maxZ;
    if (outside ? canLeave : grid.passableAt(nx, nz, profile, f.side)) {
      f.vx = (nx - f.x) / dt;
      f.vz = (nz - f.z) / dt;
      f.x = nx;
      f.z = nz;
      f.facing = approachAngle(f.facing, h, ctx.stats[f.index]!.turnRate * 2 * dt);
      return true;
    }
  }
  f.vx = 0;
  f.vz = 0;
  return false;
}

/** Facing that points from f toward (x, z). */
export function facingToward(f: FormationState, x: number, z: number): number {
  return facingOf(x - f.x, z - f.z);
}

// ---------------------------------------------------------------------------------------------------
// Separation (no interpenetration)
// ---------------------------------------------------------------------------------------------------

const mtv: Mtv = { x: 0, z: 0, depth: 0 };

function inertia(f: FormationState, st: UnitStats): number {
  const still = f.vx * f.vx + f.vz * f.vz < 0.04 ? 4 : 1;
  const engaged = f.engagedWith.length > 0 ? 4 : 1;
  return Math.max(1, f.soldiers) * st.mass * still * engaged;
}

/** Can friends a and b pass through each other this tick? (§6.5 exceptions) */
export function passesThrough(a: FormationState, b: FormationState): boolean {
  if (a.activity === 'routing' || b.activity === 'routing') return true;
  if (tramples(a.unitClass) && isFoot(b.unitClass)) return true;
  if (tramples(b.unitClass) && isFoot(a.unitClass)) return true;
  return a.panicUntil > 0 || b.panicUntil > 0;
}

/**
 * Push overlapping formations apart (friend-friend and foe-foe both; foes are left touching at the contact margin
 * so melee contact still registers). Router entry into a friend costs the friend 0.05 cohesion (callback).
 */
export function separateFormations(ctx: BattleContext, list: readonly FormationState[], active: Uint8Array): void {
  const n = list.length;
  const grid = ctx.grid;
  for (let i = 0; i < n; i++) {
    if (!active[i]) continue;
    const a = list[i]!;
    const ra = ctx.radius[i]!;
    for (let j = i + 1; j < n; j++) {
      if (!active[j]) continue;
      const b = list[j]!;
      // +3 m: the distance matrix is from the start of the tick (formations move <= 0.5 m per tick).
      const rr = ra + ctx.radius[j]! + 3;
      if (ctx.d2[i * n + j]! > rr * rr) continue;
      const friends = a.side === b.side;
      if (friends && passesThrough(a, b)) continue;
      if (!friends && (a.panicUntil > 0 || b.panicUntil > 0)) continue;
      // Friends keep 1 m apart; foes may close to touching (contact margin is checked separately).
      const o = footprintOverlap(a, b, friends ? 0.5 : -0.75, mtv, ctx);
      if (o <= 0) continue;
      const ia = 1 / inertia(a, ctx.stats[a.index]!);
      const ib = 1 / inertia(b, ctx.stats[b.index]!);
      const push = Math.min(o, 3);
      let sa = (push * ia) / (ia + ib);
      let sb = push - sa;
      const ax = a.x - mtv.x * sa;
      const az = a.z - mtv.z * sa;
      const bx = b.x + mtv.x * sb;
      const bz = b.z + mtv.z * sb;
      const pa = ctx.profile[a.index]!;
      const pb = ctx.profile[b.index]!;
      const okA = grid.passableAt(ax, az, pa, a.side);
      const okB = grid.passableAt(bx, bz, pb, b.side);
      if (okA && okB) {
        a.x = ax;
        a.z = az;
        b.x = bx;
        b.z = bz;
      } else if (okA) {
        sa = push;
        a.x -= mtv.x * sa;
        a.z -= mtv.z * sa;
      } else if (okB) {
        sb = push;
        b.x += mtv.x * sb;
        b.z += mtv.z * sb;
      }
    }
  }
}

/** Moving cohesion loss per second (§6.9): walking at half rate [BASE], running x2, scaled by terrain fatigue. */
export function movingCohesionLoss(f: FormationState, running: boolean, terrainFatigue: number): number {
  return BALANCE.combat.cohesionLossPerSecMoving * (running ? 2 : 0.5) * Math.max(1, terrainFatigue);
}
