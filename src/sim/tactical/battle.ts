/**
 * Tactical battle simulation (formation level, AUTHORITATIVE; DESIGN_SPEC §6). OWNER: Gameplay Engineer - Tactical
 * Battle Simulation (GP-01). Baseline by the CTO; public signatures kept (createBattle, issueBattleCommand, stepBattle,
 * forceOutcome, sideStrength, sideBroken, deployZoneFor, deployAxis, createSkirmishSetup, AI_THINK_TICKS).
 *
 * Determinism contract:
 *  - stepBattle(state, BATTLE_DT, terrain, out) is a pure function of (state, terrain). All randomness comes from
 *    state.rng. Battle AI (battleai.ts, SIM-02) runs INSIDE stepBattle for AI-controlled sides every AI_THINK_TICKS -
 *    also during deployment - so autoresolve and the BattleScene produce identical outcomes for identical command
 *    logs. Player commands go through issueBattleCommand() between steps and are logged.
 *  - Derived data (pathing grid, flow fields, variant stats, scratch arrays) lives in context.ts and is rebuilt
 *    identically from the state, so a battle resumed from JSON equals the uninterrupted run.
 *  - The soldier layer (soldiers.ts) reads this state and never writes to it. Step loops allocate nothing (events,
 *    new works and new morale events excepted).
 *
 * Tick order (20 Hz): AI + intents -> leadership -> orders & movement -> trample / router pass-through / horse fear ->
 * separation -> contacts + charge impacts -> melee -> siege works -> shooting + volleys -> casualty effects (heavy
 * casualties, commander falls, block reshaping) -> periodic morale events -> morale, rout / rally / surrender ->
 * fatigue & cohesion -> spotting -> side totals -> objectives -> outcome.
 */
import type {
  BattleCommand,
  BattleEventRecord,
  BattleOutcome,
  BattleSetup,
  BattleSideState,
  BattleState,
  FormationIndex,
  FormationState,
  SideIndex,
  TerrainQuery,
  Vec2,
} from '../../core/types';
import { BATTLE_EVENT_LOG_LIMIT, MAX_FORMATIONS_PER_SIDE } from '../../core/constants';
import { Rng, rngStateFromSeed } from '../../core/rng';
import { angleDelta } from '../../core/math';
import { BALANCE } from '../../data/balance';
import { RULES } from '../../data/rules';
import { UNITS } from '../../data/units';
import { runBattleAI, translateIntent } from './battleai';
import { battleContext, computeDistances, refreshGeometry, rulesContext } from './context';
import type { BattleContext } from './context';
import { footprintOverlap, movingCohesionLoss, pointInFootprint, refreshDims, resetDims, separateFormations } from './formations';
import type { Mtv } from './formations';
import { fatigueGainMultiplier, isEscalade, resolveChargeImpact, resolveMelee, resolveTrample } from './combat';
import { addMoraleEvent, aspectOfPoint, driftMorale, isNight, prepareMorale, pruneMoraleEvents, standing, updateMoraleBreakdown } from './morale';
import { effectiveRange, launchVolley, updateVolleys } from './projectiles';
import { gapBetween, isOffField, MAX_QUEUE, nearestEnemy, executeFormation, retreatDirection, snapOrder, startOrder, validateOrder } from './orders';
import { autoDeploy, makeFormation } from './setup';
import { breachHeld, createSiegeState, updateSiegeWorks, wallBetween } from './siege';
import { buildOutcome, forceOutcome, sideBroken } from './outcome';
import { canCharge, isCombatClass, isMounted, isShooter, shootsOnTheMove } from './stats';

export { deployAxis, deployZoneFor, createSkirmishSetup, composeArmy, battleKindFor } from './setup';
export { forceOutcome, sideBroken, sideStrength } from './outcome';

/** AI think interval in ticks (1 s at 20 Hz). */
export const AI_THINK_TICKS = 20;
/** Periodic morale events (general nearby, victory near) every 10 s. */
const PERIODIC_TICKS = 200;

const rng = new Rng(1);
const tmpOut: BattleEventRecord[] = [];
/** Side's supply train attacked this tick (supply_threatened). */
const supplyHit = new Uint8Array(2);
/** Side's supply train engaged or lost (S -0.3). */
const supplyDown = new Uint8Array(2);
const mtv: Mtv = { x: 0, z: 0, depth: 0 };
const v2: Vec2 = { x: 0, z: 0 };

// ---------------------------------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------------------------------

function makeSide(setup: BattleSetup, side: SideIndex, formations: FormationState[]): BattleSideState {
  let soldiers = 0;
  let morale = 0;
  let n = 0;
  let cmd: FormationState | null = null;
  for (const f of formations) {
    if (f.side !== side) continue;
    soldiers += f.soldiers;
    morale += f.morale;
    n++;
    if (!cmd && f.hasCommander) cmd = f;
  }
  return {
    factionId: setup.sides[side].factionId,
    controller: setup.sides[side].controller,
    initialSoldiers: soldiers,
    soldiers,
    killed: 0,
    captured: 0,
    routedFormations: 0,
    destroyedFormations: 0,
    commanderFormation: cmd ? cmd.index : -1,
    commanderAlive: !!cmd,
    averageMorale: n ? morale / n : 0,
    withdrawn: false,
    surrendered: false,
    groups: Array.from({ length: 10 }, () => []),
    rallyCooldownUntil: 0,
    aiMemory: {},
  };
}

/** Create the authoritative battle state from a setup. */
export function createBattle(setup: BattleSetup, terrain: TerrainQuery): BattleState {
  const formations: FormationState[] = [];
  for (const side of [0, 1] as const) {
    const sd = setup.sides[side];
    for (const fs of sd.formations.slice(0, MAX_FORMATIONS_PER_SIDE)) formations.push(makeFormation(formations.length, side, fs, sd.supply, sd.factionId));
  }
  const state: BattleState = {
    id: setup.id,
    setup,
    phase: setup.deploymentSec > 0 ? 'deployment' : 'active',
    time: 0,
    tick: 0,
    rng: rngStateFromSeed(setup.seed),
    formations,
    sides: [makeSide(setup, 0, formations), makeSide(setup, 1, formations)],
    volleys: [],
    nextVolleyId: 1,
    objectives: setup.objectives.map((o) => ({ id: o.id, progress: 0, status: 'pending' as const })),
    events: [],
    commandLog: [],
    works: [],
    wallHp: [],
    outcome: null,
    deploymentEndsAt: setup.deploymentSec,
    siege: createSiegeState(setup),
  };
  const ctx = battleContext(state, terrain);
  autoDeploy(state, ctx, 0, terrain);
  autoDeploy(state, ctx, 1, terrain);
  // Commander (§6.1): explicit, else the elite guards, else the largest formation.
  for (const side of [0, 1] as const) {
    if (state.sides[side].commanderFormation >= 0) continue;
    let pick: FormationState | null = null;
    for (const f of formations) {
      if (f.side !== side) continue;
      if (f.unitClass === 'elite_guards' && (!pick || pick.unitClass !== 'elite_guards')) pick = f;
      else if (!pick || (pick.unitClass !== 'elite_guards' && f.soldiers > pick.soldiers)) pick = f;
    }
    if (pick) {
      pick.hasCommander = true;
      pick.commanderAlive = true;
      state.sides[side].commanderFormation = pick.index;
      state.sides[side].commanderAlive = true;
    }
  }
  // Ambush (§6.1, §6.10): the defender deploys hidden in forest.
  if (setup.kind === 'ambush') {
    const defender = (1 - setup.attackerSide) as SideIndex;
    for (const f of formations) if (f.side === defender && ctx.grid.classAt(f.x, f.z) === 'forest') f.hidden = true;
  }
  computeDistances(state, ctx);
  updateSpotting(state, ctx);
  state.events.push(ev(state, 'battle_started', null, null, null));
  return state;
}

function ev(state: BattleState, kind: BattleEventRecord['kind'], side: SideIndex | null, formation: FormationIndex | null, other: FormationIndex | null): BattleEventRecord {
  const f = formation !== null ? state.formations[formation] : null;
  return { time: state.time, kind, side, formation, other, x: f?.x ?? null, z: f?.z ?? null, value: null, text: null };
}

function pushEvent(state: BattleState, e: BattleEventRecord, out?: BattleEventRecord[]): void {
  // Volleys are frequent presentation events: they go to `out` (audio / FX) but not into the persistent log.
  if (e.kind !== 'volley') {
    state.events.push(e);
    if (state.events.length > BATTLE_EVENT_LOG_LIMIT) state.events.splice(0, state.events.length - BATTLE_EVENT_LOG_LIMIT);
  }
  out?.push(e);
}

// ---------------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------------

/** Formation can take orders (alive, not routing / rallying / panicking / surrendered / fled). */
function controllable(state: BattleState, f: FormationState): boolean {
  if (f.soldiers <= 0 || f.activity === 'routing' || f.activity === 'rallying' || f.activity === 'surrendered' || f.activity === 'destroyed') return false;
  if (f.panicUntil > state.time) return false;
  return true;
}

function clampToZone(state: BattleState, f: FormationState, x: number, z: number, out: Vec2): Vec2 {
  const zone = state.setup.sides[f.side].deployZone;
  out.x = Math.min(zone.maxX, Math.max(zone.minX, x));
  out.z = Math.min(zone.maxZ, Math.max(zone.minZ, z));
  const fort = state.setup.fortification;
  if (fort && f.side === fort.defenderSide) {
    // Defenders stay inside the wall ring.
    const dx = out.x - fort.center.x;
    const dz = out.z - fort.center.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const max = fort.radius - 9 - f.depth / 2;
    if (d > max && d > 0) {
      out.x = fort.center.x + (dx / d) * max;
      out.z = fort.center.z + (dz / d) * max;
    }
  }
  return out;
}

function startRally(state: BattleState, f: FormationState, out: BattleEventRecord[]): void {
  f.activity = 'rallying';
  f.rallyingUntil = state.time + RULES.battle.rout.rallyingSec;
  f.rallies++;
  f.queue.length = 0;
  startOrder(state, f, { type: 'regroup' });
  addMoraleEvent(f, 'rallied', state.time);
  out.push({ time: state.time, kind: 'formation_rallied', side: f.side, formation: f.index, other: null, x: f.x, z: f.z, value: f.morale, text: null });
}

/**
 * Validate and apply a command for `side` at the current tick (logged for replay).
 * Returns an error string if rejected, else null.
 */
export function issueBattleCommand(state: BattleState, side: SideIndex, cmd: BattleCommand): string | null {
  if (state.outcome) return 'Battle is over';
  if (state.sides[side].surrendered) return 'This side has surrendered';
  const own = (idx: FormationIndex): FormationState | null => {
    const f = state.formations[idx];
    return f && f.side === side ? f : null;
  };
  const deploying = state.phase === 'deployment';
  switch (cmd.kind) {
    case 'order': {
      const rc = rulesContext(state);
      let n = 0;
      let firstError: string | null = null;
      for (const idx of cmd.formations) {
        const f = own(idx);
        if (!f || !controllable(state, f)) continue;
        const err = validateOrder(state, rc, f, cmd.order);
        if (err) {
          firstError ??= err;
          continue;
        }
        const order = snapOrder(rc, cmd.order);
        if (cmd.queue && !(f.order.type === 'hold' && f.queue.length === 0)) {
          if (f.queue.length >= MAX_QUEUE) {
            firstError ??= 'Too many queued orders';
            continue;
          }
          f.queue.push(order);
        } else {
          f.queue.length = 0;
          f.intent = null;
          startOrder(state, f, order);
        }
        n++;
      }
      if (n === 0) return firstError ?? 'No formation can take that order';
      break;
    }
    case 'intent': {
      let n = 0;
      for (const idx of cmd.formations) {
        const f = own(idx);
        if (f && controllable(state, f)) {
          f.intent = cmd.intent;
          n++;
        }
      }
      if (n === 0) return 'No formation can take that intent';
      break;
    }
    case 'clear_intent':
      for (const idx of cmd.formations) {
        const f = own(idx);
        if (f) f.intent = null;
      }
      break;
    case 'set_stance':
      for (const idx of cmd.formations) {
        const f = own(idx);
        if (f && f.soldiers > 0) f.stance = cmd.stance;
      }
      break;
    case 'set_shape': {
      let n = 0;
      for (const idx of cmd.formations) {
        const f = own(idx);
        if (!f || !controllable(state, f) || !UNITS[f.unitClass].allowedShapes.includes(cmd.shape)) continue;
        n++;
        if (f.shape === cmd.shape) continue;
        f.shape = cmd.shape;
        resetDims(f);
        // §6.2: 3 s + 0.02 s per soldier, cohesion capped at 0.6 meanwhile.
        f.shapeChangeUntil = state.time + 3 + 0.02 * f.soldiers;
        f.cohesion = Math.min(f.cohesion, 0.6);
      }
      if (n === 0) return 'That formation cannot take this shape';
      break;
    }
    case 'set_group':
      if (cmd.group < 0 || cmd.group > 9) return 'Bad group';
      state.sides[side].groups[cmd.group] = cmd.formations.filter((i) => own(i));
      break;
    case 'deploy': {
      if (!deploying) return 'Deployment is over';
      const f = own(cmd.formation);
      if (!f) return 'Not your formation';
      clampToZone(state, f, cmd.x, cmd.z, v2);
      f.x = v2.x;
      f.z = v2.z;
      f.facing = cmd.facing;
      break;
    }
    case 'begin_battle': {
      if (!deploying) return 'The battle has begun';
      // An AI side may not cut a human opponent's deployment short.
      if (state.setup.sides[side].controller === 'ai' && state.setup.sides[(1 - side) as SideIndex].controller === 'player') return 'Waiting for the opponent';
      endDeployment(state, tmpOut);
      for (const e of tmpOut) pushEvent(state, e);
      tmpOut.length = 0;
      break;
    }
    case 'withdraw_all': {
      const ax = state.setup.terrain;
      for (const f of state.formations) {
        if (f.side !== side || !controllable(state, f)) continue;
        // Toward the own map edge (behind the deploy zone).
        const zone = state.setup.sides[side].deployZone;
        const cx = (zone.minX + zone.maxX) / 2;
        const cz = (zone.minZ + zone.maxZ) / 2;
        const half = ax.sizeMeters / 2 - 10;
        const dirX = cx - ax.centerX;
        const dirZ = cz - ax.centerZ;
        const dl = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
        f.queue.length = 0;
        f.intent = null;
        startOrder(state, f, { type: 'withdraw', x: ax.centerX + (dirX / dl) * half, z: ax.centerZ + (dirZ / dl) * half });
      }
      state.sides[side].withdrawn = true;
      pushEvent(state, ev(state, 'side_withdrew', side, null, null));
      break;
    }
    case 'surrender':
      state.sides[side].surrendered = true;
      for (const f of state.formations) if (f.side === side && f.soldiers > 0) surrenderFormation(state, f, tmpOut);
      for (const e of tmpOut) pushEvent(state, e);
      tmpOut.length = 0;
      break;
    case 'rally': {
      const err = commanderRally(state, side, tmpOut);
      for (const e of tmpOut) pushEvent(state, e);
      tmpOut.length = 0;
      if (err) return err;
      break;
    }
    default:
      return 'Unknown command';
  }
  state.commandLog.push({ tick: state.tick, side, cmd });
  return null;
}

/** Commander's Rally (§6.11): own formations within 120 m +15 morale and 'rallied'; routers there (> 35) rally; 90 s cooldown. */
function commanderRally(state: BattleState, side: SideIndex, out: BattleEventRecord[]): string | null {
  const s = state.sides[side];
  const c = RULES.battle.commander;
  const cmd = s.commanderFormation >= 0 ? state.formations[s.commanderFormation] : undefined;
  if (!cmd || !s.commanderAlive || cmd.soldiers <= 0) return 'The commander has fallen';
  if (cmd.activity === 'routing' || cmd.activity === 'surrendered') return 'The commander is fleeing';
  if (cmd.engagedWith.length > 0) return 'The commander is in the fight';
  if (state.phase === 'deployment') return 'The battle has not begun';
  if (state.time < s.rallyCooldownUntil) return `Rally ready in ${Math.ceil(s.rallyCooldownUntil - state.time)} s`;
  for (const f of state.formations) {
    if (f.side !== side || f.soldiers <= 0 || f.activity === 'surrendered') continue;
    const dx = f.x - cmd.x;
    const dz = f.z - cmd.z;
    if (dx * dx + dz * dz > c.rallyRadius * c.rallyRadius) continue;
    f.morale = Math.min(100, f.morale + c.rallyMorale);
    addMoraleEvent(f, 'rallied', state.time);
    if (f.activity === 'routing' && f.morale > 35 && f.rallies < RULES.battle.rout.maxRallies) startRally(state, f, out);
  }
  s.rallyCooldownUntil = state.time + c.rallyCooldownSec;
  return null;
}

function endDeployment(state: BattleState, out: BattleEventRecord[]): void {
  state.phase = 'active';
  // Early start (begin_battle) moves the mark; a timed-out deployment keeps setup.deploymentSec exactly (no tick drift).
  state.deploymentEndsAt = Math.min(state.deploymentEndsAt, state.time);
  for (const f of state.formations) f.orderTime = state.time;
  out.push(ev(state, 'deployment_ended', null, null, null));
}

// ---------------------------------------------------------------------------------------------------
// Step
// ---------------------------------------------------------------------------------------------------

/**
 * Advance the battle by dt seconds (use BATTLE_DT). New battle events are appended to `out`.
 */
export function stepBattle(state: BattleState, dt: number, terrain: TerrainQuery, out: BattleEventRecord[]): void {
  if (state.outcome) return;
  const ctx = battleContext(state, terrain);
  rng.setState(state.rng);
  state.tick++;
  state.time += dt;
  tmpOut.length = 0;
  computeDistances(state, ctx);

  if (state.phase === 'deployment') {
    // The battle AI deploys too (deploy / set_shape / set_stance / pre-orders).
    if (state.tick % AI_THINK_TICKS === 0) runAI(state, terrain);
    updateSpotting(state, ctx);
    if (state.time >= state.deploymentEndsAt) endDeployment(state, tmpOut);
    flush(state, out);
    rng.saveTo(state.rng);
    return;
  }

  // Battle AI + intent translation (part of the deterministic sim).
  if (state.tick % AI_THINK_TICKS === 0) {
    runAI(state, terrain);
    for (const f of state.formations) {
      if (f.intent && controllable(state, f)) {
        const o = translateIntent(state, f.index, f.intent, terrain);
        if (o && !sameOrder(f.order, o)) startOrder(state, f, o);
      }
    }
  }

  const n = ctx.n;
  const fs = state.formations;
  supplyHit.fill(0);
  for (let i = 0; i < n; i++) {
    const f = fs[i] as FormationState;
    ctx.loss[i] = 0;
    ctx.hurt[i] = 0;
    ctx.wasEngaged[i] = f.engagedWith.length > 0 ? 1 : 0;
    ctx.prevX[i] = f.x;
    ctx.prevZ[i] = f.z;
    ctx.prevFacing[i] = f.facing;
  }
  updateLeadership(state, ctx);

  // Orders and movement.
  for (const f of fs) executeFormation(state, ctx, f, dt, tmpOut);
  for (let i = 0; i < n; i++) {
    const f = fs[i] as FormationState;
    ctx.active[i] = f.soldiers > 0 && f.activity !== 'surrendered' && f.activity !== 'destroyed' && !isOffField(ctx, f) ? 1 : 0;
  }
  refreshGeometry(state, ctx);
  passThroughEffects(state, ctx);
  separateFormations(ctx, fs, ctx.active);
  // Velocity = actual displacement this tick (after collisions): arrows lead it, bracing and fatigue read it.
  const inv = 1 / dt;
  for (let i = 0; i < n; i++) {
    const f = fs[i] as FormationState;
    if (!ctx.active[i]) continue;
    f.vx = (f.x - ctx.prevX[i]!) * inv;
    f.vz = (f.z - ctx.prevZ[i]!) * inv;
  }

  // Contacts, charges, melee.
  updateContacts(state, ctx);
  for (const f of fs) {
    if (f.soldiers <= 0) continue;
    for (const oi of f.engagedWith) {
      if (oi <= f.index) continue;
      const o = fs[oi];
      if (o && o.soldiers > 0) resolveMelee(state, ctx, f, o, dt, rng, tmpOut);
    }
  }
  updateSiegeWorks(state, ctx, dt, tmpOut);

  // Missiles.
  for (const f of fs) updateShooting(state, ctx, f, dt);
  updateVolleys(state, ctx, rng, supplyHit, tmpOut);

  casualtyEffects(state, ctx, dt);
  periodicMorale(state, ctx);
  prepareMorale(state, ctx);
  for (const f of fs) updateMoraleState(state, ctx, f, dt);
  for (const f of fs) updateCondition(state, ctx, f, dt);
  updateSpotting(state, ctx);
  updateSides(state);
  updateObjectives(state, ctx, dt);
  flush(state, out);
  rng.saveTo(state.rng);
  const outcome = checkOutcome(state, ctx);
  if (outcome) {
    state.outcome = outcome;
    state.phase = 'ended';
    pushEvent(state, ev(state, 'battle_ended', outcome.winner, null, null), out);
  }
}

function flush(state: BattleState, out: BattleEventRecord[]): void {
  for (const e of tmpOut) pushEvent(state, e, out);
  tmpOut.length = 0;
}

function sameOrder(a: BattleState['formations'][number]['order'], b: BattleState['formations'][number]['order']): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'attack_target':
    case 'charge':
    case 'skirmish':
    case 'resupply':
      return a.target === (b as typeof a).target;
    case 'flank':
      return a.target === (b as typeof a).target && a.side === (b as typeof a).side;
    case 'move_to': {
      const o = b as typeof a;
      return Math.abs(a.x - o.x) < 4 && Math.abs(a.z - o.z) < 4 && a.run === o.run;
    }
    case 'defend': {
      const o = b as typeof a;
      return Math.abs(a.x - o.x) < 4 && Math.abs(a.z - o.z) < 4 && a.radius === o.radius;
    }
    case 'withdraw':
      return true;
    default:
      return true;
  }
}

function runAI(state: BattleState, terrain: TerrainQuery): void {
  for (const side of [0, 1] as const) {
    if (state.setup.sides[side].controller !== 'ai' || state.sides[side].surrendered) continue;
    const cmds = runBattleAI(state, side, terrain);
    for (const c of cmds) issueBattleCommand(state, side, c);
  }
}

function updateLeadership(state: BattleState, ctx: BattleContext): void {
  const c = RULES.battle.commander;
  for (const side of [0, 1] as const) {
    const s = state.sides[side];
    const cmd = s.commanderFormation >= 0 ? state.formations[s.commanderFormation] : null;
    const skill = state.setup.sides[side].commanderSkill;
    const alive = !!cmd && s.commanderAlive && cmd.soldiers > 0;
    for (const f of state.formations) {
      if (f.side !== side) continue;
      let l = c.fallen;
      if (alive) {
        const near = ctx.d2[f.index * ctx.n + cmd!.index]! < c.nearMeters * c.nearMeters;
        l = (f === cmd ? c.ownFormation : near ? c.near : c.far) + (skill / 100) * c.skillPer100;
      } else if (!cmd) l = c.far + (skill / 100) * c.skillPer100;
      f.leadership = Math.min(1, l);
    }
  }
}

/** Panicking elephants trample whoever they cross; routers passing through friends; horses fearing elephants. */
function passThroughEffects(state: BattleState, ctx: BattleContext): void {
  const fs = state.formations;
  const n = ctx.n;
  const ep = RULES.battle.elephantPanic;
  for (let i = 0; i < n; i++) {
    const a = fs[i] as FormationState;
    if (!ctx.active[i]) continue;
    const panicking = a.panicUntil > state.time;
    const routing = a.activity === 'routing';
    const elephants = a.unitClass === 'war_elephants' && standing(a) && !panicking;
    if (!panicking && !routing && !elephants) continue;
    for (let j = 0; j < n; j++) {
      if (j === i || !ctx.active[j]) continue;
      const o = fs[j] as FormationState;
      if (o.activity === 'surrendered') continue;
      const reach = ctx.radius[j]! + ep.trampleRadius + 30;
      if (ctx.d2[i * n + j]! > reach * reach) continue;
      if (panicking) {
        if (pointInFootprint(o, a.x, a.z, ep.trampleRadius, ctx) && !pointInFootprint(o, ctx.prevX[i]!, ctx.prevZ[i]!, ep.trampleRadius, ctx)) resolveTrample(state, ctx, a, o, rng, tmpOut);
      } else if (routing) {
        if (o.side === a.side && o.activity !== 'routing' && pointInFootprint(o, a.x, a.z, 0, ctx) && !pointInFootprint(o, ctx.prevX[i]!, ctx.prevZ[i]!, 0, ctx)) {
          o.cohesion = Math.max(0, o.cohesion - 0.05);
          addMoraleEvent(o, 'ally_routed', state.time);
        }
      } else if (o.side !== a.side && isMounted(o.unitClass) && standing(o) && gapBetween(ctx, a, o) <= 30) {
        // Horses fear elephants: -0.2 'charged' shock once per 20 s (§6.6.4).
        addMoraleEvent(o, 'charged', state.time, -0.2, 20, 20);
      }
    }
  }
}

function canFight(state: BattleState, ctx: BattleContext, f: FormationState): boolean {
  return f.soldiers > 0 && f.activity !== 'surrendered' && f.activity !== 'destroyed' && f.panicUntil <= state.time && !isOffField(ctx, f);
}

/** Melee contact margins per footprint (m): new contact / held contact. */
const CONTACT_MARGIN = 0.75;
const CONTACT_HOLD_MARGIN = 2;

function updateContacts(state: BattleState, ctx: BattleContext): void {
  const fs = state.formations;
  const n = ctx.n;
  // Hysteresis: a pair already in melee stays in contact until it opens a 4 m gap (2 m margin each), a new pair
  // closes to 1.5 m (0.75 m each) - formations jostling on the contact line no longer flicker in and out.
  const pairWas = ctx.pairWas;
  pairWas.fill(0);
  for (const f of fs) {
    for (const oi of f.engagedWith) pairWas[f.index * n + oi] = 1;
    f.engagedWith.length = 0;
  }
  const minRun = RULES.battle.charge.minRunMeters;
  for (let i = 0; i < n; i++) {
    const a = fs[i] as FormationState;
    if (!canFight(state, ctx, a)) continue;
    const ra = ctx.radius[i]!;
    for (let j = i + 1; j < n; j++) {
      const b = fs[j] as FormationState;
      if (b.side === a.side) continue;
      const rr = ra + ctx.radius[j]! + 4;
      if (ctx.d2[i * n + j]! > rr * rr || !canFight(state, ctx, b)) continue;
      const held = pairWas[i * n + j] === 1;
      if (footprintOverlap(a, b, held ? CONTACT_HOLD_MARGIN : CONTACT_MARGIN, mtv, ctx) <= 0) continue;
      if (wallBetween(state, ctx, a, b)) continue;
      a.engagedWith.push(b.index);
      b.engagedWith.push(a.index);
      a.hidden = false;
      b.hidden = false;
      const fresh = !held && (!ctx.wasEngaged[i] || !ctx.wasEngaged[j]);
      if (a.activity === 'charging' && a.chargeRun >= minRun && canCharge(a)) {
        resolveChargeImpact(state, ctx, a, b, rng, tmpOut);
        a.chargeRun = 0;
      }
      if (b.activity === 'charging' && b.chargeRun >= minRun && canCharge(b)) {
        resolveChargeImpact(state, ctx, b, a, rng, tmpOut);
        b.chargeRun = 0;
      }
      if (fresh) {
        tmpOut.push({ time: state.time, kind: 'contact', side: a.side, formation: a.index, other: b.index, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, value: null, text: null });
        reinforce(state, ctx, a, b);
        reinforce(state, ctx, b, a);
        escaladeShock(state, ctx, a, b);
        escaladeShock(state, ctx, b, a);
      }
    }
  }
  for (const f of fs) {
    if (f.engagedWith.length > 0 && f.activity !== 'routing' && f.activity !== 'rallying') {
      f.activity = 'engaged';
      f.chargeRun = 0;
    }
  }
}

/** A fresh formation joining a melee lifts the friends already fighting that enemy ('reinforced', §6.7). */
function reinforce(state: BattleState, ctx: BattleContext, joiner: FormationState, enemy: FormationState): void {
  if (ctx.wasEngaged[joiner.index] || joiner.fatigue >= 0.25 || joiner.soldiers < joiner.maxSoldiers * 0.6) return;
  for (const oi of enemy.engagedWith) {
    const o = state.formations[oi];
    if (o && o !== joiner && o.side === joiner.side && ctx.wasEngaged[o.index]) addMoraleEvent(o, 'reinforced', state.time);
  }
}

/** Climbing the ladders against defenders on the walls: morale -0.15 on the climb (§6.6.5). */
function escaladeShock(state: BattleState, ctx: BattleContext, climber: FormationState, def: FormationState): void {
  if (ctx.wasEngaged[climber.index] || !isEscalade(state, ctx, climber, def)) return;
  const st = ctx.stats[climber.index]!;
  climber.morale = Math.max(0, climber.morale - RULES.siege.escaladePenalty * 0.5 * 36 * (1 - 0.5 * st.discipline));
}

/** Fire at will / at the ordered target (§6.6.3). */
function updateShooting(state: BattleState, ctx: BattleContext, f: FormationState, dt: number): void {
  const st = ctx.stats[f.index]!;
  if (!isShooter(st) || f.soldiers <= 0) return;
  if (f.reload > 0) {
    f.reload -= dt;
    if (f.reload > 0) return;
  }
  if (f.ammo <= 0 || !standing(f) || f.activity === 'rallying' || f.panicUntil > state.time || f.engagedWith.length > 0) return;
  if (!shootsOnTheMove(f.unitClass) && f.vx * f.vx + f.vz * f.vz > 0.25) return;
  if (isOffField(ctx, f)) return;
  const o = f.order;
  let target: FormationState | null = null;
  if (o.type === 'attack_target' || o.type === 'skirmish' || o.type === 'charge') {
    const t = state.formations[o.target];
    if (t && t.soldiers > 0 && t.spotted && t.activity !== 'surrendered' && !isOffField(ctx, t)) {
      const r = effectiveRange(state, ctx, f, t);
      if (ctx.d2[f.index * ctx.n + t.index]! <= r * r) target = t;
    }
  }
  if (f.stance === 'hold_fire') {
    // Only at an ordered target, and never into a melee with friends.
    if (!target) return;
    for (const oi of target.engagedWith) if (state.formations[oi]?.side === f.side) return;
  }
  if (!target) {
    let bd = Infinity;
    let routingBest: FormationState | null = null;
    let rbd = Infinity;
    // Upper bound of range_eff (walls x1.2, tower x1.2, +50% for 50 m of height) to skip far pairs cheaply.
    const st2 = ctx.stats[f.index]!;
    const bound = Math.min(st2.range, RULES.battle.weather.rangeVsVisibility * state.setup.environment.weather.visibility) * 1.44 * 1.5;
    const bound2 = bound * bound;
    for (const e of state.formations) {
      if (e.side === f.side || e.soldiers <= 0 || !e.spotted || e.activity === 'surrendered') continue;
      const d = ctx.d2[f.index * ctx.n + e.index]!;
      if (d > bound2 || isOffField(ctx, e)) continue;
      const r = effectiveRange(state, ctx, f, e);
      if (d > r * r) continue;
      if (e.activity === 'routing') {
        if (d < rbd) {
          rbd = d;
          routingBest = e;
        }
      } else if (d < bd) {
        bd = d;
        target = e;
      }
    }
    target ??= routingBest;
  }
  if (!target) return;
  launchVolley(state, ctx, f, target, rng, tmpOut);
  if (f.activity === 'idle') f.activity = 'shooting';
}

/** Heavy casualties, supply train threats, commander falls, block reshaping. */
function casualtyEffects(state: BattleState, ctx: BattleContext, dt: number): void {
  supplyDown.fill(0);
  for (const f of state.formations) {
    if (f.unitClass === 'supply_train') {
      if (f.engagedWith.length > 0 || ctx.hurt[f.index]) supplyHit[f.side] = 1;
      if (f.engagedWith.length > 0 || (f.maxSoldiers > 0 && (f.soldiers <= 0 || f.activity === 'surrendered'))) supplyDown[f.side] = 1;
    }
    if (f.soldiers <= 0) continue;
    const loss = ctx.loss[f.index]!;
    if (loss > 0 && loss >= f.maxSoldiers * 0.02) addMoraleEvent(f, 'heavy_casualties', state.time, undefined, undefined, 3);
    if (loss > 0 && (f.soldiers < f.files * (f.ranks - 1) || f.soldiers < f.files)) refreshDims(f);
  }
  for (const side of [0, 1] as const) {
    if (supplyHit[side]) for (const f of state.formations) if (f.side === side && f.soldiers > 0) addMoraleEvent(f, 'supply_threatened', state.time);
    const s = state.sides[side];
    if (!s.commanderAlive || s.commanderFormation < 0) continue;
    const c = state.formations[s.commanderFormation]!;
    let falls = c.soldiers <= 0 || c.activity === 'surrendered' || c.soldiers < c.maxSoldiers * RULES.battle.commander.fallBelowStrength;
    if (!falls && c.activity === 'routing') {
      for (const e of state.formations) {
        if (e.side === side || !standing(e) || !isMounted(e.unitClass)) continue;
        if (gapBetween(ctx, c, e) <= 20) {
          falls = rng.chance(0.25 * dt);
          break;
        }
      }
    }
    if (falls) commanderFalls(state, side);
  }
}

function commanderFalls(state: BattleState, side: SideIndex): void {
  const s = state.sides[side];
  const c = state.formations[s.commanderFormation]!;
  s.commanderAlive = false;
  c.commanderAlive = false;
  tmpOut.push({ time: state.time, kind: 'commander_fallen', side, formation: c.index, other: null, x: c.x, z: c.z, value: null, text: c.activity === 'surrendered' ? 'captured' : null });
  for (const o of state.formations) if (o.side === side && o.soldiers > 0) addMoraleEvent(o, 'commander_fallen', state.time);
}

/** General nearby (+0.1, refreshed every 10 s within 60 m) and victory near (enemy below 35% of its start). */
function periodicMorale(state: BattleState, ctx: BattleContext): void {
  if (state.tick % PERIODIC_TICKS !== 0) return;
  for (const side of [0, 1] as const) {
    const s = state.sides[side];
    const cmd = s.commanderAlive && s.commanderFormation >= 0 ? state.formations[s.commanderFormation] : null;
    let enemyStanding = 0;
    for (const e of state.formations) if (e.side !== side && standing(e) && !isOffField(ctx, e)) enemyStanding += e.soldiers;
    const near = enemyStanding < 0.35 * state.sides[(1 - side) as SideIndex].initialSoldiers;
    for (const f of state.formations) {
      if (f.side !== side || !standing(f)) continue;
      if (cmd && cmd.soldiers > 0 && ctx.d2[f.index * ctx.n + cmd.index]! <= 60 * 60) addMoraleEvent(f, 'general_nearby', state.time);
      if (near) addMoraleEvent(f, 'victory_near', state.time);
    }
  }
}

/** Morale drift and the rout / rally / surrender thresholds (§6.7, §6.8). */
function updateMoraleState(state: BattleState, ctx: BattleContext, f: FormationState, dt: number): void {
  pruneMoraleEvents(f, state.time);
  if (f.soldiers <= 0 || f.activity === 'surrendered' || f.activity === 'destroyed') return;
  const b = updateMoraleBreakdown(ctx, state, f, supplyDown);
  driftMorale(f, b.target, dt);
  const m = RULES.battle.rout;
  if (f.activity !== 'routing') {
    if (f.morale < BALANCE.morale.routThreshold) rout(state, ctx, f);
    return;
  }
  if (f.morale < RULES.battle.surrender.morale && shouldSurrender(state, ctx, f)) {
    surrenderFormation(state, f, tmpOut);
    return;
  }
  if (f.morale > BALANCE.morale.rallyThreshold && state.time - f.lastHitTime >= m.rallyQuietSec && f.rallies < m.maxRallies && !isOffField(ctx, f)) startRally(state, f, tmpOut);
}

function rout(state: BattleState, ctx: BattleContext, f: FormationState): void {
  f.activity = 'routing';
  f.queue.length = 0;
  f.intent = null;
  f.order = { type: 'withdraw', x: null, z: null };
  f.chargeRun = 0;
  f.rallyingUntil = 0;
  // Credit: the strongest enemy in contact, else the nearest enemy within 150 m.
  let credit: FormationState | null = null;
  for (const oi of f.engagedWith) {
    const o = state.formations[oi];
    if (o && (!credit || o.soldiers > credit.soldiers)) credit = o;
  }
  credit ??= nearestEnemy(state, ctx, f, 150, false, true);
  tmpOut.push({ time: state.time, kind: 'formation_routed', side: f.side, formation: f.index, other: credit ? credit.index : null, x: f.x, z: f.z, value: f.morale, text: f.rallies >= RULES.battle.rout.maxRallies ? 'shattered' : null });
  const ar = BALANCE.morale.allyRoutRadius * BALANCE.morale.allyRoutRadius;
  for (const o of state.formations) {
    if (o === f || o.soldiers <= 0 || o.activity === 'surrendered') continue;
    if (o.side === f.side) {
      if (ctx.d2[f.index * ctx.n + o.index]! < ar) addMoraleEvent(o, 'ally_routed', state.time);
    } else addMoraleEvent(o, 'enemy_routed', state.time);
  }
}

/** Surrender (§6.8): enemies within 30 m on >= 2 aspects, or cornered (water / wall within 20 m ahead). */
function shouldSurrender(state: BattleState, ctx: BattleContext, f: FormationState): boolean {
  let aspects = 0;
  const rs = RULES.battle.surrender;
  for (const e of state.formations) {
    if (e.side === f.side || !standing(e)) continue;
    if (gapBetween(ctx, f, e) <= rs.enemyWithinMeters) aspects |= 1 << aspectOfPoint(f, e.x, e.z);
  }
  let count = 0;
  for (let k = 0; k < 4; k++) if (aspects & (1 << k)) count++;
  if (count >= rs.minEnemyAspects) return true;
  if (count === 0) return false;
  retreatDirection(state, ctx, f.side, v2);
  const profile = ctx.profile[f.index]!;
  for (let d = 5; d <= rs.corneredWithinMeters; d += 5) {
    const x = f.x + v2.x * (f.depth * 0.5 + d);
    const z = f.z + v2.z * (f.depth * 0.5 + d);
    const b = ctx.terrain.bounds;
    if (x < b.minX || z < b.minZ || x > b.maxX || z > b.maxZ) return false; // the exit, not a corner
    if (!ctx.grid.passableAt(x, z, profile, f.side)) return true;
  }
  return false;
}

function surrenderFormation(state: BattleState, f: FormationState, out: BattleEventRecord[]): void {
  if (f.soldiers <= 0) return;
  f.captured += f.soldiers;
  f.soldiers = 0;
  f.damagePool = 0;
  f.activity = 'surrendered';
  f.vx = 0;
  f.vz = 0;
  f.queue.length = 0;
  f.intent = null;
  f.engagedWith.length = 0;
  out.push({ time: state.time, kind: 'formation_surrendered', side: f.side, formation: f.index, other: null, x: f.x, z: f.z, value: f.captured, text: null });
}

/** Fatigue and cohesion (§6.9). */
function updateCondition(state: BattleState, ctx: BattleContext, f: FormationState, dt: number): void {
  if (f.soldiers <= 0 || f.activity === 'surrendered') return;
  const st = ctx.stats[f.index]!;
  const speed = Math.sqrt(f.vx * f.vx + f.vz * f.vz);
  const running = speed > st.walkSpeed * 1.3;
  const engaged = f.engagedWith.length > 0;
  const gain = fatigueGainMultiplier(state, ctx, f);
  const c = st.fatigueRate * 100;
  if (running) f.fatigue += BALANCE.combat.fatigueRunPerSec * dt * c * gain;
  if (engaged) f.fatigue += BALANCE.combat.fatigueFightPerSec * dt * c * gain;
  if (!running && !engaged && speed < 0.25) f.fatigue -= BALANCE.combat.fatigueRecoverPerSec * dt;
  f.fatigue = Math.min(1, Math.max(0, f.fatigue));
  if (f.activity === 'routing') return;
  // Wheeling / turning in place is not standing still: no cohesion recovery while the facing changes.
  const turning = Math.abs(angleDelta(ctx.prevFacing[f.index]!, f.facing)) > 1e-3;
  if (speed > 0.25 && f.order.type !== 'withdraw') {
    if (f.cohesion > 0.2) f.cohesion = Math.max(0.2, f.cohesion - movingCohesionLoss(f, running, UNITS[f.unitClass].terrain[ctx.grid.classAt(f.x, f.z)].fatigue) * dt);
  } else if (!engaged && speed <= 0.25 && !turning) {
    const regroup = f.order.type === 'regroup' || f.activity === 'rallying';
    f.cohesion = Math.min(1, f.cohesion + BALANCE.combat.cohesionRecoverPerSec * (regroup ? RULES.battle.regroup.cohesionRecovery : 1) * dt);
  }
  if (f.shapeChangeUntil > 0) {
    if (state.time < f.shapeChangeUntil) f.cohesion = Math.min(f.cohesion, 0.6);
    else f.shapeChangeUntil = 0;
  }
}

/** Visibility (§6.10): enemies see a formation within their vision (x0.4 at night, <= weather visibility). */
function updateSpotting(state: BattleState, ctx: BattleContext): void {
  const fs = state.formations;
  const n = ctx.n;
  const night = isNight(state);
  const vis = state.setup.environment.weather.visibility;
  const nightVision = night ? RULES.battle.weather.nightVision : 1;
  for (const f of fs) ctx.vision[f.index] = Math.min(ctx.stats[f.index]!.visionRange * nightVision, vis);
  for (const f of fs) {
    if (f.soldiers <= 0) {
      f.spotted = true;
      continue;
    }
    if (f.hidden) {
      let reveal = ctx.grid.classAt(f.x, f.z) !== 'forest';
      for (const e of fs) {
        if (reveal) break;
        if (e.side === f.side || e.soldiers <= 0 || e.activity === 'surrendered') continue;
        const d2 = ctx.d2[f.index * n + e.index]!;
        const scoutR = e.unitClass === 'scouts' ? ctx.stats[e.index]!.visionRange * 0.5 : 0;
        if (d2 <= 60 * 60 || d2 <= scoutR * scoutR) reveal = true;
      }
      if (reveal) f.hidden = false;
      else {
        f.spotted = false;
        continue;
      }
    }
    const stealth = f.unitClass === 'scouts' ? 1 - 0.5 * ctx.stats[f.index]!.stealth : 1;
    const rf = ctx.radius[f.index]!;
    let seen = false;
    for (const e of fs) {
      if (e.side === f.side || e.soldiers <= 0 || e.activity === 'surrendered') continue;
      const r = ctx.vision[e.index]! * stealth + rf;
      if (ctx.d2[f.index * n + e.index]! <= r * r) {
        seen = true;
        break;
      }
    }
    f.spotted = seen;
  }
}

function updateSides(state: BattleState): void {
  for (const side of [0, 1] as const) {
    const s = state.sides[side];
    let soldiers = 0;
    let killed = 0;
    let captured = 0;
    let routed = 0;
    let destroyed = 0;
    let morale = 0;
    let n = 0;
    for (const f of state.formations) {
      if (f.side !== side) continue;
      soldiers += f.soldiers;
      killed += f.killed;
      captured += f.captured;
      if (f.activity === 'routing') routed++;
      if (f.soldiers <= 0) destroyed++;
      else if (f.activity !== 'routing') {
        morale += f.morale;
        n++;
      }
    }
    s.soldiers = soldiers;
    s.killed = killed;
    s.captured = captured;
    s.routedFormations = routed;
    s.destroyedFormations = destroyed;
    s.averageMorale = n ? morale / n : 0;
  }
}

/** Scripted objectives (hold_area, survive, destroy_army, protect_formation, breach_gate). */
function updateObjectives(state: BattleState, ctx: BattleContext, dt: number): void {
  const defs = state.setup.objectives;
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i]!;
    const o = state.objectives[i];
    if (!o || o.status !== 'pending') continue;
    const before = o.progress;
    switch (d.kind) {
      case 'hold_area': {
        let own = false;
        let enemy = false;
        for (const f of state.formations) {
          if (!standing(f) || isOffField(ctx, f)) continue;
          const dx = f.x - d.x;
          const dz = f.z - d.z;
          if (dx * dx + dz * dz > d.radius * d.radius) continue;
          if (f.side === d.side) own = true;
          else enemy = true;
        }
        if (own && !enemy) o.progress = Math.min(1, o.progress + dt / Math.max(1, d.durationSec));
        break;
      }
      case 'survive':
        o.progress = Math.min(1, (state.time - state.deploymentEndsAt) / Math.max(1, d.durationSec));
        break;
      case 'destroy_army': {
        const enemy = state.sides[(1 - d.side) as SideIndex];
        o.progress = Math.min(1, 1 - enemy.soldiers / Math.max(1, enemy.initialSoldiers));
        if (sideBroken(state, (1 - d.side) as SideIndex)) o.progress = 1;
        break;
      }
      case 'protect_formation': {
        const f = state.formations[d.formation];
        if (!f || f.soldiers <= 0 || f.activity === 'routing' || f.activity === 'surrendered') o.status = 'failed';
        break;
      }
      case 'breach_gate': {
        const s = state.siege;
        if (s && s.gates.length) {
          let best = 0;
          for (const g of s.gates) best = Math.max(best, 1 - g.hp / Math.max(1, g.maxHp));
          o.progress = s.breaches.length ? 1 : best;
        }
        break;
      }
    }
    if (o.progress >= 1 && o.status === 'pending') {
      o.status = 'complete';
      pushEvent(state, { time: state.time, kind: 'objective_complete', side: d.side, formation: null, other: null, x: null, z: null, value: i, text: d.label });
    } else if (Math.floor(o.progress * 4) > Math.floor(before * 4)) {
      pushEvent(state, { time: state.time, kind: 'objective_progress', side: d.side, formation: null, other: null, x: null, z: null, value: o.progress, text: d.label });
    }
  }
}

function checkOutcome(state: BattleState, ctx: BattleContext): BattleOutcome | null {
  const fort = state.setup.fortification;
  if (state.siege && fort && breachHeld(state)) return buildOutcome(state, (1 - fort.defenderSide) as SideIndex, 'siege_breach');
  const b0 = sideBroken(state, 0);
  const b1 = sideBroken(state, 1);
  if (b0 || b1) {
    if (b0 && b1) return buildOutcome(state, null, 'rout');
    const loser: SideIndex = b0 ? 0 : 1;
    const winner = (1 - loser) as SideIndex;
    let reason: BattleOutcome['reason'] = state.sides[loser].surrendered ? 'surrender' : 'rout';
    let anyRouting = false;
    let anyCaptured = false;
    for (const f of state.formations) {
      if (f.side !== loser || !isCombatClass(f.unitClass)) continue;
      if (f.activity === 'routing') anyRouting = true;
      if (f.activity === 'surrendered') anyCaptured = true;
    }
    if (!state.sides[loser].surrendered && !anyRouting) reason = anyCaptured ? 'surrender' : 'annihilation';
    if (state.siege && fort && loser !== fort.defenderSide) reason = 'siege_held';
    return buildOutcome(state, winner, reason);
  }
  // Scripted objectives.
  const defs = state.setup.objectives;
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i]!;
    const o = state.objectives[i]!;
    if (o.status === 'complete' && (d.kind === 'hold_area' || d.kind === 'survive')) return buildOutcome(state, d.side, 'objective');
    if (o.status === 'failed' && d.kind === 'protect_formation') return buildOutcome(state, (1 - d.side) as SideIndex, 'objective');
  }
  // Withdrawal: the side has withdrawn and disengaged.
  for (const side of [0, 1] as const) {
    if (!state.sides[side].withdrawn) continue;
    let disengaged = true;
    for (const f of state.formations) {
      if (f.side !== side || f.soldiers <= 0 || f.activity === 'surrendered' || isOffField(ctx, f)) continue;
      if (f.engagedWith.length > 0) {
        disengaged = false;
        break;
      }
      if (f.order.type === 'withdraw' && f.activity !== 'routing' && nearestEnemy(state, ctx, f, 150)) {
        disengaged = false;
        break;
      }
    }
    if (disengaged) return buildOutcome(state, (1 - side) as SideIndex, 'withdrawal');
  }
  const limit = state.setup.timeLimitSec;
  if (limit !== null && state.time - state.deploymentEndsAt >= limit) return forceOutcome(state, 'time_limit');
  return null;
}

/** Current outcome or null while the battle runs. */
export function getBattleOutcome(state: BattleState): BattleOutcome | null {
  return state.outcome;
}
