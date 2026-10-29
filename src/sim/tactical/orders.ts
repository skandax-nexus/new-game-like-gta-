/**
 * Formation orders, stances and movement behaviour (DESIGN_SPEC §6.3, §6.5, §6.6.4, §6.8). OWNER: Gameplay Engineer -
 * Tactical Battle Simulation (GP-01).
 *
 * Orders (`FormationOrder`), executed every tick by `executeFormation`:
 *  - hold: stop, keep facing, fight what contacts; aggressive / defensive formations turn to face a flank threat
 *    when not engaged; aggressive formations engage enemies within 30 m (§6.5).
 *  - advance(distance): becomes move_to along the facing when it starts (default 30 m); halts while in contact.
 *  - move_to(x, z, facing, run [, width]): flow-field path, arrive, turn to `facing`; a right-drag `width` (m) sets
 *    the frontage (files) on arrival.
 *  - attack_target: approach at walk (or run); melee classes engage on contact; ranged classes close to 0.9 x range
 *    and keep 0.4-0.9 x range (as skirmish); routing target: pursue only when aggressive and within 60 m.
 *  - charge: walk until the gap is 40 m (foot) / 90 m (mounted, elephants), then run; >= 20 m of running at >= 60%
 *    run speed arms the impact (FormationState.chargeRun); exhausted formations cannot run, so cannot charge.
 *  - flank(target, side): run to 35 m beyond the target's chosen flank, 10 m behind its front (re-aimed every tick
 *    as the target turns), then charge (the impact lands on the flank); after 30 s it becomes attack_target.
 *  - withdraw(x, z | own zone): back away at 50% speed facing the enemy for 20 m, then turn and walk; disengaging
 *    from melee lets enemies in contact deal x1.5 for 3 s (disengageUntil). No morale penalty, cohesion kept.
 *  - regroup: stop; cohesion recovers x2.5; one-off +5 morale if not engaged.
 *  - defend(x, z, radius 20..150): hold the anchor, engage enemies inside the radius, return when they leave/rout.
 *  - skirmish(target): ranged only; keep the target between 0.4 and 0.9 x range; out of ammo -> hold ("No arrows").
 *  - construct(work, x, z, facing): engineers walk to the site and build (siege.ts); contact interrupts, progress kept.
 *  - resupply(target): supply train within 30 m of a ranged formation; +25% max ammo every 30 s while both stand.
 * Shift-queue: `queue: true` appends; the next order starts when the current one completes.
 * Stances: aggressive (engage within 30 m, pursue 60 m), defensive, skirmish (step back from melee threats within
 * 0.4 x range), hold_fire (as defensive, no fire at will).
 * Routing formations run for their own map edge and leave the battle there; panicking elephants run from the
 * shooter for 8 s ignoring orders; rallying formations regroup for 15 s.
 */
import type { BattleEventRecord, BattleState, FormationOrder, FormationState, SideIndex, Vec2 } from '../../core/types';
import { angleDelta, dcos, dsin, facingOf } from '../../core/math';
import { RULES } from '../../data/rules';
import { UNITS } from '../../data/units';
import type { BattleContext } from './context';
import { footprintRadius, formationSpeed, moveFormation, runAlong, setFrontage, turnInPlace } from './formations';
import { aspectOfPoint, standing } from './morale';
import { effectiveRange } from './projectiles';
import { buildRate, completeWork, gateNear, repairGate, segmentNear, WORK_HP, WORK_SECONDS, workNear } from './siege';
import { angleFromCenter, ringPoint } from './fort';
import { canCharge, isMountedOrBeast, isShooter } from './stats';

/** Default advance distance per key press (§6.3). */
export const ADVANCE_DEFAULT = 30;
/** Aggressive stance engagement and pursuit distances (§6.5). */
export const AGGRESSIVE_ENGAGE = 30;
export const AGGRESSIVE_PURSUIT = 60;
/** Max queued orders per formation. */
export const MAX_QUEUE = 16;

const HALF_PI = 1.5707963267948966;
const tmp: Vec2 = { x: 0, z: 0 };

/** The formation has fled off the map (routers leave the battle at the edge). */
export function isOffField(ctx: BattleContext, f: FormationState): boolean {
  const b = ctx.terrain.bounds;
  return f.x < b.minX || f.z < b.minZ || f.x > b.maxX || f.z > b.maxZ;
}

/** Gap between two footprints along the line of centers (approximate; negative = overlapping). */
export function gapBetween(ctx: BattleContext, a: FormationState, b: FormationState): number {
  const d = Math.sqrt(ctx.d2[a.index * ctx.n + b.index]!);
  return d - a.depth * 0.5 - b.depth * 0.5;
}

/** Unit direction toward a side's own map edge (routers, withdraw_all). Siege defenders fall back into the fort. */
export function retreatDirection(state: BattleState, ctx: BattleContext, side: SideIndex, out: Vec2): Vec2 {
  const g = ctx.fort;
  if (g) {
    const sign = side === g.defenderSide ? -1 : 1;
    out.x = dsin(g.mainAngle) * sign;
    out.z = dcos(g.mainAngle) * sign;
    return out;
  }
  const a = state.setup.terrain.river.angle;
  const sign = side === 0 ? 1 : -1;
  out.x = -dsin(a) * sign;
  out.z = dcos(a) * sign;
  return out;
}

function zoneCenter(state: BattleState, side: SideIndex, out: Vec2): Vec2 {
  const z = state.setup.sides[side].deployZone;
  out.x = (z.minX + z.maxX) / 2;
  out.z = (z.minZ + z.maxZ) / 2;
  return out;
}

/** Nearest standing, spotted enemy within `maxGap` m (footprint gap). `meleeOnly` skips archers. */
export function nearestEnemy(state: BattleState, ctx: BattleContext, f: FormationState, maxGap: number, meleeOnly = false, includeRouting = false): FormationState | null {
  let best: FormationState | null = null;
  let bd = Infinity;
  const n = ctx.n;
  const rf = footprintRadius(f);
  for (const o of state.formations) {
    if (o.side === f.side || o.soldiers <= 0 || o.activity === 'surrendered' || o.activity === 'destroyed') continue;
    if (!includeRouting && o.activity === 'routing') continue;
    if (!o.spotted || isOffField(ctx, o)) continue;
    if (meleeOnly && UNITS[o.unitClass].category === 'ranged') continue;
    const d = Math.sqrt(ctx.d2[f.index * n + o.index]!) - rf - footprintRadius(o) * 0.5;
    if (d <= maxGap && d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

/** Normalize an order when it becomes current (advance -> move_to along the facing, defend radius clamp...). */
export function normalizeOrder(state: BattleState, f: FormationState, o: FormationOrder): FormationOrder {
  switch (o.type) {
    case 'advance': {
      const dist = o.distance > 0 ? o.distance : ADVANCE_DEFAULT;
      return { type: 'move_to', x: f.x + dsin(f.facing) * dist, z: f.z + dcos(f.facing) * dist, facing: f.facing, run: false };
    }
    case 'defend':
      return { type: 'defend', x: o.x, z: o.z, radius: Math.min(150, Math.max(20, o.radius)) };
    case 'withdraw':
      if (o.x === null || o.z === null) {
        zoneCenter(state, f.side, tmp);
        return { type: 'withdraw', x: tmp.x, z: tmp.z };
      }
      return o;
    default:
      return o;
  }
}

/** Make `o` the current order (orderTime, one-off effects). */
export function startOrder(state: BattleState, f: FormationState, o: FormationOrder): void {
  const order = normalizeOrder(state, f, o);
  f.order = order;
  f.orderTime = Math.max(state.time, state.phase === 'deployment' ? state.deploymentEndsAt : 0);
  if (order.type !== 'charge') f.chargeRun = 0;
  if (order.type === 'regroup' && f.engagedWith.length === 0 && f.activity !== 'routing') f.morale = Math.min(100, f.morale + RULES.battle.regroup.moraleBonus);
  if (order.type === 'withdraw' && f.engagedWith.length > 0) f.disengageUntil = state.time + RULES.battle.withdraw.disengagePenaltySec;
  if (order.type === 'attack_target' || order.type === 'charge' || order.type === 'flank' || order.type === 'skirmish') f.target = order.target;
  if (order.type === 'construct') f.workProgress = 0;
}

/** Start the next queued order, or hold. */
export function nextOrder(state: BattleState, f: FormationState): void {
  const q = f.queue.shift();
  startOrder(state, f, q ?? HOLD);
}

const HOLD: FormationOrder = { type: 'hold' };

function targetValid(ctx: BattleContext, t: FormationState | undefined): t is FormationState {
  return !!t && t.soldiers > 0 && t.activity !== 'surrendered' && t.activity !== 'destroyed' && !isOffField(ctx, t);
}

function speedOf(f: FormationState): number {
  return Math.sqrt(f.vx * f.vx + f.vz * f.vz);
}

/** Face an enemy threatening a flank / the rear (hold, defend) - aggressive and defensive stances only. */
function faceThreats(state: BattleState, ctx: BattleContext, f: FormationState, dt: number): void {
  if (f.stance !== 'aggressive' && f.stance !== 'defensive') return;
  const e = nearestEnemy(state, ctx, f, 60, true);
  if (!e) return;
  if (aspectOfPoint(f, e.x, e.z) === 0) return;
  turnInPlace(ctx, f, facingOf(e.x - f.x, e.z - f.z), dt);
}

/** Skirmish-stance evasion: step back from melee threats within 0.4 x range. Returns true if it moved. */
function evade(state: BattleState, ctx: BattleContext, f: FormationState, dt: number): boolean {
  const st = ctx.stats[f.index]!;
  if (f.stance !== 'skirmish' || !isShooter(st) || f.ammo <= 0) return false;
  const r = effectiveRange(state, ctx, f, null) * 0.4;
  const e = nearestEnemy(state, ctx, f, r, true);
  if (!e) return false;
  const dx = f.x - e.x;
  const dz = f.z - e.z;
  const d = Math.sqrt(dx * dx + dz * dz) || 1;
  moveFormation(ctx, f, f.x + (dx / d) * 20, f.z + (dz / d) * 20, true, null, true, 1, dt);
  return true;
}

/** Move a ranged formation to keep `t` between 0.4 and 0.9 x range (skirmish order / ranged attack_target). */
function keepRange(state: BattleState, ctx: BattleContext, f: FormationState, t: FormationState, dt: number): boolean {
  const r = effectiveRange(state, ctx, f, t);
  const dx = t.x - f.x;
  const dz = t.z - f.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d > r * 0.9) {
    moveFormation(ctx, f, t.x - (dx / d) * r * 0.8, t.z - (dz / d) * r * 0.8, false, null, false, 1, dt);
    return true;
  }
  if (d < r * 0.4) {
    moveFormation(ctx, f, f.x - (dx / d) * 20, f.z - (dz / d) * 20, true, null, true, 1, dt);
    return true;
  }
  f.vx = 0;
  f.vz = 0;
  const want = facingOf(dx, dz);
  if (Math.abs(angleDelta(f.facing, want)) > 0.02) turnInPlace(ctx, f, want, dt);
  return false;
}

/**
 * Per-tick behaviour of one formation (before contacts). Sets velocity, position, facing and a provisional
 * activity (moving / charging / withdrawing / constructing / regrouping / idle); contacts and shooting refine it.
 */
export function executeFormation(state: BattleState, ctx: BattleContext, f: FormationState, dt: number, out: BattleEventRecord[]): void {
  if (f.soldiers <= 0 || f.activity === 'destroyed' || f.activity === 'surrendered') {
    f.vx = 0;
    f.vz = 0;
    return;
  }
  if (isOffField(ctx, f)) {
    f.vx = 0;
    f.vz = 0;
    return;
  }
  const st = ctx.stats[f.index]!;
  // --- Elephant panic: run from the shooter, ignoring orders.
  if (f.panicUntil > 0) {
    if (state.time < f.panicUntil) {
      if (!runAlong(ctx, f, f.facing, formationSpeed(ctx, f, true), false, dt)) f.facing += HALF_PI;
      return;
    }
    f.panicUntil = 0;
    f.morale = Math.max(0, f.morale + RULES.battle.elephantPanic.moraleAfter);
    f.queue.length = 0;
    startOrder(state, f, { type: 'regroup' });
  }
  // --- Routing: run for the own map edge (and off it).
  if (f.activity === 'routing') {
    retreatDirection(state, ctx, f.side, tmp);
    let hx = tmp.x;
    let hz = tmp.z;
    const e = nearestEnemy(state, ctx, f, 50, true);
    if (e) {
      const ax = f.x - e.x;
      const az = f.z - e.z;
      const al = Math.sqrt(ax * ax + az * az) || 1;
      hx += (ax / al) * 0.8;
      hz += (az / al) * 0.8;
    }
    runAlong(ctx, f, facingOf(hx, hz), formationSpeed(ctx, f, true), true, dt);
    f.cohesion = Math.max(0, f.cohesion - 0.05 * dt);
    return;
  }
  // --- Rallying: regroup in place for 15 s, then controllable.
  if (f.activity === 'rallying') {
    f.vx = 0;
    f.vz = 0;
    if (state.time >= f.rallyingUntil) {
      f.activity = 'idle';
      f.rallyingUntil = 0;
      startOrder(state, f, HOLD);
    }
    return;
  }
  const engaged = f.engagedWith.length > 0;
  const o = f.order;
  let activity: FormationState['activity'] = 'idle';
  // Engaged formations fight where they stand (only withdrawing ones back out).
  if (engaged && o.type !== 'withdraw') {
    f.vx = 0;
    f.vz = 0;
    if (o.type === 'charge') startOrder(state, f, { type: 'attack_target', target: o.target, run: false });
    f.activity = 'engaged';
    return;
  }
  switch (o.type) {
    case 'hold':
    case 'regroup': {
      if (evade(state, ctx, f, dt)) {
        activity = 'moving';
        break;
      }
      f.vx = 0;
      f.vz = 0;
      faceThreats(state, ctx, f, dt);
      activity = o.type === 'regroup' ? 'regrouping' : 'idle';
      if (f.stance === 'aggressive' && f.unitClass !== 'supply_train' && f.unitClass !== 'engineers' && !isShooter(st)) {
        const e = nearestEnemy(state, ctx, f, AGGRESSIVE_ENGAGE);
        if (e) startOrder(state, f, { type: 'attack_target', target: e.index, run: false });
      }
      break;
    }
    case 'advance':
      startOrder(state, f, o);
      break;
    case 'move_to': {
      const rem = moveFormation(ctx, f, o.x, o.z, o.run, o.facing, false, 1, dt);
      activity = speedOf(f) > 0.05 ? 'moving' : 'idle';
      if (rem <= 0 && (o.facing === null || Math.abs(angleDelta(f.facing, o.facing)) < 0.03)) {
        const w = (o as { width?: unknown }).width;
        if (typeof w === 'number' && w > 0) setFrontage(f, w);
        nextOrder(state, f);
      }
      break;
    }
    case 'attack_target':
    case 'charge': {
      const t = state.formations[o.target];
      if (!targetValid(ctx, t)) {
        nextOrder(state, f);
        break;
      }
      f.target = t.index;
      const gap = gapBetween(ctx, f, t);
      if (t.activity === 'routing' && !(f.stance === 'aggressive' && gap <= AGGRESSIVE_PURSUIT)) {
        nextOrder(state, f);
        break;
      }
      if (UNITS[f.unitClass].category === 'ranged' && isShooter(st)) {
        if (f.ammo <= 0) {
          nextOrder(state, f);
          break;
        }
        activity = keepRange(state, ctx, f, t, dt) ? 'moving' : 'idle';
        break;
      }
      let run = o.type === 'attack_target' ? o.run : false;
      if (o.type === 'charge') {
        const runFrom = isMountedOrBeast(f.unitClass) ? RULES.battle.charge.mountedRunFrom : RULES.battle.charge.infantryRunFrom;
        run = gap <= runFrom && canCharge(f);
      }
      moveFormation(ctx, f, t.x, t.z, run, null, false, 1, dt);
      const sp = speedOf(f);
      if (o.type === 'charge') {
        if (run && sp >= RULES.battle.charge.minSpeedShare * st.runSpeed) f.chargeRun += sp * dt;
        else if (!run) f.chargeRun = 0;
        activity = run ? 'charging' : 'moving';
      } else activity = sp > 0.05 ? 'moving' : 'idle';
      break;
    }
    case 'flank': {
      const t = state.formations[o.target];
      if (!targetValid(ctx, t)) {
        nextOrder(state, f);
        break;
      }
      f.target = t.index;
      if (state.time - f.orderTime > 30) {
        startOrder(state, f, { type: 'attack_target', target: t.index, run: true });
        break;
      }
      const s = o.side === 'left' ? -1 : 1;
      const rx = -dcos(t.facing) * s;
      const rz = dsin(t.facing) * s;
      const back = t.depth * 0.5 - 10;
      const px = t.x + rx * (t.width * 0.5 + 35) + dsin(t.facing) * back;
      const pz = t.z + rz * (t.width * 0.5 + 35) + dcos(t.facing) * back;
      const rem = moveFormation(ctx, f, px, pz, true, null, false, 1, dt);
      activity = 'moving';
      if (rem < 4) startOrder(state, f, { type: 'charge', target: t.index });
      break;
    }
    case 'withdraw': {
      const tx = o.x ?? f.x;
      const tz = o.z ?? f.z;
      const backSec = 20 / Math.max(0.1, RULES.battle.withdraw.backwardsSpeed * st.walkSpeed);
      const backwards = state.time - f.orderTime < backSec;
      const rem = moveFormation(ctx, f, tx, tz, false, null, backwards, 1, dt);
      activity = 'withdrawing';
      if (rem <= 0) nextOrder(state, f);
      break;
    }
    case 'defend': {
      if (evade(state, ctx, f, dt)) {
        activity = 'moving';
        break;
      }
      let threat: FormationState | null = null;
      let bd = o.radius * o.radius;
      for (const e of state.formations) {
        if (e.side === f.side || !standing(e) || !e.spotted || isOffField(ctx, e)) continue;
        const d = (e.x - o.x) * (e.x - o.x) + (e.z - o.z) * (e.z - o.z);
        if (d <= bd) {
          bd = d;
          threat = e;
        }
      }
      const fromAnchor = Math.sqrt((f.x - o.x) * (f.x - o.x) + (f.z - o.z) * (f.z - o.z));
      if (threat && !isShooter(st) && fromAnchor < o.radius + 20) {
        moveFormation(ctx, f, threat.x, threat.z, false, null, false, 1, dt);
        activity = 'moving';
      } else if (fromAnchor > 5) {
        const e = nearestEnemy(state, ctx, f, 300);
        moveFormation(ctx, f, o.x, o.z, false, e ? facingOf(e.x - o.x, e.z - o.z) : null, false, 1, dt);
        activity = speedOf(f) > 0.05 ? 'moving' : 'idle';
      } else {
        f.vx = 0;
        f.vz = 0;
        const e = nearestEnemy(state, ctx, f, 300);
        if (e) {
          const want = facingOf(e.x - f.x, e.z - f.z);
          if (Math.abs(angleDelta(f.facing, want)) > 0.05) turnInPlace(ctx, f, want, dt);
        }
      }
      break;
    }
    case 'skirmish': {
      const t = state.formations[o.target];
      if (!isShooter(st) || f.ammo <= 0 || !targetValid(ctx, t)) {
        startOrder(state, f, HOLD);
        break;
      }
      f.target = t.index;
      activity = keepRange(state, ctx, f, t, dt) ? 'moving' : 'idle';
      break;
    }
    case 'construct':
      activity = executeConstruct(state, ctx, f, o, dt, out);
      break;
    case 'resupply': {
      const t = state.formations[o.target];
      if (!targetValid(ctx, t) || f.unitClass !== 'supply_train') {
        nextOrder(state, f);
        break;
      }
      const dx = t.x - f.x;
      const dz = t.z - f.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > 30) {
        moveFormation(ctx, f, t.x - (dx / d) * 20, t.z - (dz / d) * 20, false, null, false, 1, dt);
        f.workProgress = 0;
        activity = 'moving';
        break;
      }
      f.vx = 0;
      f.vz = 0;
      const maxAmmo = ctx.stats[t.index]!.ammo;
      if (t.vx * t.vx + t.vz * t.vz < 0.04 && t.ammo < maxAmmo) {
        f.workProgress += dt / 30;
        activity = 'constructing';
        if (f.workProgress >= 1) {
          f.workProgress = 0;
          t.ammo = Math.min(maxAmmo, t.ammo + Math.max(1, Math.round(maxAmmo * 0.25)));
        }
      }
      break;
    }
  }
  f.activity = activity;
}

/** Engineers at work (§6.6.5). Returns the activity for this tick. */
function executeConstruct(state: BattleState, ctx: BattleContext, f: FormationState, o: Extract<FormationOrder, { type: 'construct' }>, dt: number, out: BattleEventRecord[]): FormationState['activity'] {
  void out;
  const dx = o.x - f.x;
  const dz = o.z - f.z;
  if (dx * dx + dz * dz > 16) {
    moveFormation(ctx, f, o.x, o.z, false, o.facing, false, 1, dt);
    return 'moving';
  }
  f.vx = 0;
  f.vz = 0;
  if (o.work === 'repair_gate') return repairGate(state, ctx, f, o.x, o.z, dt) ? 'constructing' : 'idle';
  let w = workNear(state, f.side, o.work, o.x, o.z, 6);
  if (!w) {
    const hp = WORK_HP[o.work];
    w = { work: o.work, x: o.x, z: o.z, facing: o.facing, side: f.side, hp, maxHp: hp, progress: 0, formation: f.index };
    state.works.push(w);
  }
  if (w.progress < 1) {
    const st = ctx.stats[f.index]!;
    w.progress = Math.min(1, w.progress + (dt / WORK_SECONDS[o.work]) * buildRate(f, st.siege, UNITS[f.unitClass].stats.menPerFormation));
    w.formation = f.index;
    f.workProgress = w.progress;
    if (w.progress < 1) return 'constructing';
    completeWork(state, ctx, w);
  }
  f.workProgress = 0;
  if (o.work === 'ram') {
    w.formation = f.index;
    const g = ctx.fort;
    if (g && state.siege && f.side === g.attackerSide) {
      const gi = gateNear(state, g, f.x, f.z, 4000);
      if (gi >= 0) {
        ringPoint(g, g.gateAngle[gi]!, g.radius + 4 + f.depth * 0.5, tmp);
        startOrder(state, f, { type: 'move_to', x: tmp.x, z: tmp.z, facing: g.gateAngle[gi]! + Math.PI, run: false });
        return 'moving';
      }
    }
  }
  nextOrder(state, f);
  return 'idle';
}

/**
 * Validate an order for a formation at issue time. Returns an error string or null. Snaps ladder sites onto the wall
 * exterior.
 */
export function validateOrder(state: BattleState, ctx: BattleContext, f: FormationState, o: FormationOrder): string | null {
  const st = ctx.stats[f.index]!;
  switch (o.type) {
    case 'attack_target':
    case 'charge':
    case 'flank':
    case 'skirmish':
    case 'resupply': {
      const t = state.formations[o.target];
      if (!t || t.soldiers <= 0) return 'No such target';
      if (o.type === 'resupply') {
        if (f.unitClass !== 'supply_train') return 'Only supply trains resupply';
        if (t.side !== f.side || !isShooter(ctx.stats[t.index]!)) return 'Resupply a friendly ranged formation';
        return null;
      }
      if (t.side === f.side) return 'That is a friendly formation';
      if (o.type === 'skirmish' && !isShooter(st)) return 'Only ranged formations skirmish';
      if (o.type === 'charge' && !canCharge(f)) return 'Too exhausted to charge';
      return null;
    }
    case 'construct': {
      if (f.unitClass !== 'engineers') return 'Only engineers build works';
      const g = ctx.fort;
      if (o.work === 'ladder' || o.work === 'repair_gate') {
        if (!g || !state.siege) return 'No walls here';
        if (o.work === 'repair_gate' && f.side !== g.defenderSide) return 'Only the defenders repair their gates';
        if (o.work === 'ladder') {
          if (f.side !== g.attackerSide) return 'Ladders are for the assault';
          if (segmentNear(g, o.x, o.z, 40) < 0) return 'Place ladders against the wall';
        }
      }
      return null;
    }
    default:
      return null;
  }
}

/** Ladder sites snap to the outside of the wall at the clicked angle. */
export function snapOrder(ctx: BattleContext, o: FormationOrder): FormationOrder {
  if (o.type !== 'construct' || o.work !== 'ladder' || !ctx.fort) return o;
  const g = ctx.fort;
  const a = angleFromCenter(g, o.x, o.z);
  ringPoint(g, a, g.radius + 8, tmp);
  return { type: 'construct', work: 'ladder', x: tmp.x, z: tmp.z, facing: a + Math.PI };
}
