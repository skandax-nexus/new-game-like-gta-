/**
 * Tactical battle simulation (formation level, AUTHORITATIVE). OWNER: Lead Gameplay Engineer.
 * Baseline by the CTO: deployment, orders, movement, contact, melee/charge, volleys, morale/rout,
 * battle AI hook, outcome. Extend - keep signatures and determinism.
 *
 * Determinism contract:
 *  - stepBattle(state, BATTLE_DT, terrain, out) is a pure function of (state, terrain). All randomness
 *    comes from state.rng. Battle AI runs INSIDE stepBattle for AI-controlled sides (every
 *    AI_THINK_TICKS) so autoresolve and the BattleScene produce identical outcomes for identical
 *    command logs. Player commands go through issueBattleCommand() between steps and are logged.
 *  - The soldier layer (soldiers.ts) reads this state and never writes to it.
 */
import type {
  BattleCommand,
  BattleEventRecord,
  BattleOutcome,
  BattleSetup,
  BattleSideResult,
  BattleSideState,
  BattleState,
  FormationIndex,
  FormationOrder,
  FormationResult,
  FormationSetup,
  FormationState,
  Rect,
  SideIndex,
  SkirmishSetup,
  TerrainQuery,
  UnitClass,
} from '../../core/types';
import { UNIT_CLASSES } from '../../core/types';
import { BATTLE_EVENT_LOG_LIMIT, BATTLE_MAP_RESOLUTION, BATTLE_MAP_SIZE, MAX_FORMATIONS_PER_SIDE } from '../../core/constants';
import { Rng, rngStateFromSeed, deriveSeed } from '../../core/rng';
import { dcos, dsin, facingOf } from '../../core/math';
import { createLocalTerrainSpec, createRegionTerrainSpec, findPresetSite } from '../../core/terrain/heightfield';
import { UNITS } from '../../data/units';
import { FACTIONS } from '../../data/factions';
import { DEFAULT_COMPOSITION_ID, SKIRMISH_COMPOSITIONS } from '../../data/skirmish';
import { makeEnvironment } from '../strategic/seasons';
import { formationDims, moveFormationToward, refreshDims } from './formations';
import { resolveChargeImpact, resolveMelee } from './combat';
import { updateMorale } from './morale';
import { launchVolley, updateVolleys } from './projectiles';
import { runBattleAI, translateIntent } from './battleai';

/** AI think interval in ticks (1 s at 20 Hz). */
export const AI_THINK_TICKS = 20;

const rng = new Rng(1);

// ---------------------------------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------------------------------

/** Unit vector across the river (deploy axis) for a terrain spec. Side 0 deploys on +axis. */
export function deployAxis(setup: BattleSetup): { x: number; z: number } {
  const a = setup.terrain.river.angle;
  return { x: -dsin(a), z: dcos(a) };
}

export function deployZoneFor(setup: Pick<BattleSetup, 'terrain'>, side: SideIndex): Rect {
  const t = setup.terrain;
  const a = t.river.angle;
  const ax = -dsin(a);
  const az = dcos(a);
  const sign = side === 0 ? 1 : -1;
  const cx = t.centerX + ax * 200 * sign;
  const cz = t.centerZ + az * 200 * sign;
  return { minX: cx - 170, minZ: cz - 170, maxX: cx + 170, maxZ: cz + 170 };
}

const LINE_ORDER: Record<UnitClass, number> = {
  war_elephants: 0,
  spearmen: 1,
  elite_guards: 1,
  archers: 2,
  chariots: 3,
  cavalry: 3,
  scouts: 4,
  engineers: 5,
  supply_train: 5,
};

function makeFormation(index: number, side: SideIndex, fs: FormationSetup, sideSupply: number): FormationState {
  const def = UNITS[fs.unitClass];
  const shape = fs.shape ?? def.defaultShape;
  const dims = formationDims(fs.unitClass, fs.soldiers, shape);
  return {
    index,
    side,
    unitClass: fs.unitClass,
    name: fs.name ?? def.name,
    armyUnitId: fs.armyUnitId,
    soldiers: fs.soldiers,
    maxSoldiers: fs.soldiers,
    damagePool: 0,
    killed: 0,
    captured: 0,
    kills: 0,
    x: fs.x ?? 0,
    z: fs.z ?? 0,
    facing: fs.facing ?? 0,
    vx: 0,
    vz: 0,
    shape,
    files: dims.files,
    ranks: dims.ranks,
    width: dims.width,
    depth: dims.depth,
    order: { type: 'hold' },
    queue: [],
    intent: null,
    stance: def.category === 'ranged' ? 'skirmish' : 'aggressive',
    activity: 'idle',
    engagedWith: [],
    target: -1,
    morale: fs.morale,
    cohesion: 1,
    fatigue: fs.fatigue,
    supply: Math.min(fs.supply, sideSupply),
    experience: fs.experience,
    ammo: def.stats.ammo,
    reload: 0,
    hasCommander: fs.hasCommander,
    commanderAlive: fs.hasCommander,
    leadership: 0.6,
    moraleEvents: [],
    moraleBreakdown: null,
    lastHitTime: -100,
    spotted: true,
    workProgress: 0,
  };
}

/** Auto-deploy formations without explicit positions in lines inside the side's deploy zone. */
function autoDeploy(state: BattleState, side: SideIndex, terrain: TerrainQuery): void {
  const setup = state.setup;
  const zone = setup.sides[side].deployZone;
  const cx = (zone.minX + zone.maxX) / 2;
  const cz = (zone.minZ + zone.maxZ) / 2;
  const ax = deployAxis(setup);
  const sign = side === 0 ? 1 : -1;
  // Facing toward the enemy (opposite of our deploy offset).
  const facing = facingOf(-ax.x * sign, -ax.z * sign);
  const rightX = -dcos(facing);
  const rightZ = dsin(facing);
  const fwdX = dsin(facing);
  const fwdZ = dcos(facing);
  const lines = new Map<number, FormationState[]>();
  for (const f of state.formations) {
    if (f.side !== side) continue;
    const fs = setup.sides[side].formations[formationSetupIndex(state, f)];
    if (fs && fs.x !== null && fs.z !== null) continue;
    const line = LINE_ORDER[f.unitClass];
    const arr = lines.get(line) ?? [];
    arr.push(f);
    lines.set(line, arr);
  }
  const lineDepth = [40, 20, 0, 10, -30, -60];
  for (const [line, arr] of [...lines.entries()].sort((a, b) => a[0] - b[0])) {
    if (line === 3) {
      // Mounted wings: split left/right of the main line.
      arr.forEach((f, i) => {
        const wing = i % 2 === 0 ? 1 : -1;
        const off = 150 + Math.floor(i / 2) * (f.width + 12);
        place(f, cx + rightX * off * wing + fwdX * lineDepth[line]!, cz + rightZ * off * wing + fwdZ * lineDepth[line]!, facing, terrain);
      });
      continue;
    }
    const total = arr.reduce((s, f) => s + f.width + 8, -8);
    let off = -total / 2;
    for (const f of arr) {
      const lateral = off + f.width / 2;
      off += f.width + 8;
      const d = lineDepth[line] ?? 0;
      place(f, cx + rightX * lateral + fwdX * d, cz + rightZ * lateral + fwdZ * d, facing, terrain);
    }
  }
}

function place(f: FormationState, x: number, z: number, facing: number, terrain: TerrainQuery): void {
  // Nudge out of water along the facing axis (toward own rear).
  let px = x;
  let pz = z;
  for (let i = 0; i < 40 && terrain.isWater(px, pz); i++) {
    px -= dsin(facing) * 8;
    pz -= dcos(facing) * 8;
  }
  const b = terrain.bounds;
  f.x = Math.min(b.maxX - 20, Math.max(b.minX + 20, px));
  f.z = Math.min(b.maxZ - 20, Math.max(b.minZ + 20, pz));
  f.facing = facing;
}

function formationSetupIndex(state: BattleState, f: FormationState): number {
  let n = 0;
  for (const o of state.formations) {
    if (o === f) return n;
    if (o.side === f.side) n++;
  }
  return -1;
}

function makeSide(setup: BattleSetup, side: SideIndex, formations: FormationState[]): BattleSideState {
  const own = formations.filter((f) => f.side === side);
  const cmd = own.find((f) => f.hasCommander) ?? null;
  return {
    factionId: setup.sides[side].factionId,
    controller: setup.sides[side].controller,
    initialSoldiers: own.reduce((s, f) => s + f.soldiers, 0),
    soldiers: own.reduce((s, f) => s + f.soldiers, 0),
    killed: 0,
    captured: 0,
    routedFormations: 0,
    destroyedFormations: 0,
    commanderFormation: cmd ? cmd.index : -1,
    commanderAlive: !!cmd,
    averageMorale: own.length ? own.reduce((s, f) => s + f.morale, 0) / own.length : 0,
    withdrawn: false,
    surrendered: false,
    groups: Array.from({ length: 10 }, () => []),
  };
}

// ---------------------------------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------------------------------

/** Create the authoritative battle state from a setup. */
export function createBattle(setup: BattleSetup, terrain: TerrainQuery): BattleState {
  const formations: FormationState[] = [];
  for (const side of [0, 1] as const) {
    const sd = setup.sides[side];
    const list = sd.formations.slice(0, MAX_FORMATIONS_PER_SIDE);
    for (const fs of list) formations.push(makeFormation(formations.length, side, fs, sd.supply));
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
  };
  autoDeploy(state, 0, terrain);
  autoDeploy(state, 1, terrain);
  // Commander: explicit, else elite guards, else largest formation.
  for (const side of [0, 1] as const) {
    if (state.sides[side].commanderFormation >= 0) continue;
    const own = formations.filter((f) => f.side === side);
    const pick = own.find((f) => f.unitClass === 'elite_guards') ?? own.slice().sort((a, b) => b.soldiers - a.soldiers)[0];
    if (pick) {
      pick.hasCommander = true;
      pick.commanderAlive = true;
      state.sides[side].commanderFormation = pick.index;
      state.sides[side].commanderAlive = true;
    }
  }
  state.events.push(ev(state, 'battle_started', null, null, null));
  return state;
}

function ev(state: BattleState, kind: BattleEventRecord['kind'], side: SideIndex | null, formation: FormationIndex | null, other: FormationIndex | null): BattleEventRecord {
  const f = formation !== null ? state.formations[formation] : null;
  return { time: state.time, kind, side, formation, other, x: f?.x ?? null, z: f?.z ?? null, value: null, text: null };
}

// ---------------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------------

/**
 * Validate and apply a command for `side` at the current tick (logged for replay).
 * Returns an error string if rejected, else null.
 */
export function issueBattleCommand(state: BattleState, side: SideIndex, cmd: BattleCommand): string | null {
  if (state.outcome) return 'Battle is over';
  const own = (idx: FormationIndex): FormationState | null => {
    const f = state.formations[idx];
    return f && f.side === side ? f : null;
  };
  switch (cmd.kind) {
    case 'order': {
      let n = 0;
      for (const idx of cmd.formations) {
        const f = own(idx);
        if (!f || f.soldiers <= 0 || f.activity === 'routing') continue;
        const order = normalizeOrder(f, cmd.order);
        if (cmd.queue) f.queue.push(order);
        else {
          f.order = order;
          f.queue = [];
          f.intent = null;
        }
        n++;
      }
      if (n === 0) return 'No formation can take that order';
      break;
    }
    case 'intent':
      for (const idx of cmd.formations) {
        const f = own(idx);
        if (f) f.intent = cmd.intent;
      }
      break;
    case 'clear_intent':
      for (const idx of cmd.formations) {
        const f = own(idx);
        if (f) f.intent = null;
      }
      break;
    case 'set_stance':
      for (const idx of cmd.formations) {
        const f = own(idx);
        if (f) f.stance = cmd.stance;
      }
      break;
    case 'set_shape':
      for (const idx of cmd.formations) {
        const f = own(idx);
        if (f && UNITS[f.unitClass].allowedShapes.includes(cmd.shape)) {
          f.shape = cmd.shape;
          refreshDims(f);
          f.cohesion = Math.max(0.3, f.cohesion - 0.15);
        }
      }
      break;
    case 'set_group':
      if (cmd.group < 0 || cmd.group > 9) return 'Bad group';
      state.sides[side].groups[cmd.group] = cmd.formations.filter((i) => own(i));
      break;
    case 'deploy': {
      if (state.phase !== 'deployment') return 'Deployment is over';
      const f = own(cmd.formation);
      const z = state.setup.sides[side].deployZone;
      if (!f) return 'Not your formation';
      f.x = Math.min(z.maxX, Math.max(z.minX, cmd.x));
      f.z = Math.min(z.maxZ, Math.max(z.minZ, cmd.z));
      f.facing = cmd.facing;
      break;
    }
    case 'begin_battle':
      if (state.phase === 'deployment') {
        state.phase = 'active';
        pushEvent(state, ev(state, 'deployment_ended', null, null, null));
      }
      break;
    case 'withdraw_all':
      for (const f of state.formations) if (f.side === side && f.soldiers > 0) f.order = { type: 'withdraw', x: null, z: null };
      state.sides[side].withdrawn = true;
      break;
    case 'surrender':
      state.sides[side].surrendered = true;
      for (const f of state.formations) if (f.side === side && f.soldiers > 0) f.activity = 'surrendered';
      break;
    default:
      return 'Unknown command';
  }
  state.commandLog.push({ tick: state.tick, side, cmd });
  return null;
}

/** Convert relative orders into absolute ones at issue time (advance -> move_to). */
function normalizeOrder(f: FormationState, o: FormationOrder): FormationOrder {
  if (o.type === 'advance') {
    return { type: 'move_to', x: f.x + dsin(f.facing) * o.distance, z: f.z + dcos(f.facing) * o.distance, facing: f.facing, run: false };
  }
  return o;
}

function pushEvent(state: BattleState, e: BattleEventRecord, out?: BattleEventRecord[]): void {
  state.events.push(e);
  if (state.events.length > BATTLE_EVENT_LOG_LIMIT) state.events.splice(0, state.events.length - BATTLE_EVENT_LOG_LIMIT);
  out?.push(e);
}

// ---------------------------------------------------------------------------------------------------
// Step
// ---------------------------------------------------------------------------------------------------

const tmpOut: BattleEventRecord[] = [];

/**
 * Advance the battle by dt seconds (use BATTLE_DT). New battle events are appended to `out`.
 */
export function stepBattle(state: BattleState, dt: number, terrain: TerrainQuery, out: BattleEventRecord[]): void {
  if (state.outcome) return;
  rng.setState(state.rng);
  state.tick++;
  state.time += dt;
  tmpOut.length = 0;
  if (state.phase === 'deployment') {
    if (state.time >= state.setup.deploymentSec) {
      state.phase = 'active';
      pushEvent(state, ev(state, 'deployment_ended', null, null, null), out);
    }
    rng.saveTo(state.rng);
    return;
  }

  // Battle AI + intent translation (part of the deterministic sim).
  if (state.tick % AI_THINK_TICKS === 0) {
    for (const side of [0, 1] as const) {
      if (state.setup.sides[side].controller === 'ai' && !state.sides[side].surrendered) {
        const cmds = runBattleAI(state, side, terrain);
        for (const c of cmds) issueBattleCommand(state, side, c);
      }
    }
    for (const f of state.formations) {
      if (f.intent && f.soldiers > 0 && f.activity !== 'routing') {
        const o = translateIntent(state, f.index, f.intent, terrain);
        if (o) f.order = o;
      }
    }
  }

  updateLeadership(state);
  for (const f of state.formations) executeOrder(state, f, dt, terrain);
  updateContacts(state, tmpOut);
  // Melee (each pair once).
  for (const f of state.formations) {
    if (f.soldiers <= 0) continue;
    for (const oi of f.engagedWith) {
      if (oi <= f.index) continue;
      const o = state.formations[oi];
      if (o && o.soldiers > 0) resolveMelee(state, f, o, dt, terrain, rng, tmpOut);
    }
  }
  // Ranged.
  for (const f of state.formations) updateShooting(state, f, dt, tmpOut);
  updateVolleys(state, terrain, rng, tmpOut);
  // Morale, fatigue, cohesion.
  for (const f of state.formations) {
    updateMorale(state, f, dt, terrain, tmpOut);
    updateCondition(f, dt);
  }
  updateSides(state);
  for (const e of tmpOut) pushEvent(state, e, out);
  const outcome = checkOutcome(state);
  if (outcome) {
    state.outcome = outcome;
    state.phase = 'ended';
    pushEvent(state, ev(state, 'battle_ended', outcome.winner, null, null), out);
  }
  rng.saveTo(state.rng);
}

function updateLeadership(state: BattleState): void {
  for (const side of [0, 1] as const) {
    const s = state.sides[side];
    const cmd = s.commanderFormation >= 0 ? state.formations[s.commanderFormation] : null;
    const skill = state.setup.sides[side].commanderSkill;
    for (const f of state.formations) {
      if (f.side !== side) continue;
      let l = 0.35;
      if (cmd && s.commanderAlive && cmd.soldiers > 0) {
        const dx = cmd.x - f.x;
        const dz = cmd.z - f.z;
        const near = dx * dx + dz * dz < 180 * 180;
        l = f === cmd ? 0.9 : near ? 0.7 : 0.5;
        l += skill / 100;
      }
      f.leadership = Math.min(1, l);
    }
  }
}

function enemyNearest(state: BattleState, f: FormationState, maxDist: number): FormationState | null {
  let best: FormationState | null = null;
  let bd = maxDist * maxDist;
  for (const o of state.formations) {
    if (o.side === f.side || o.soldiers <= 0 || o.activity === 'surrendered') continue;
    const dx = o.x - f.x;
    const dz = o.z - f.z;
    const d = dx * dx + dz * dz;
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

function sideRearPoint(state: BattleState, side: SideIndex): { x: number; z: number } {
  const z = state.setup.sides[side].deployZone;
  const ax = deployAxis(state.setup);
  const sign = side === 0 ? 1 : -1;
  return { x: (z.minX + z.maxX) / 2 + ax.x * sign * 400, z: (z.minZ + z.maxZ) / 2 + ax.z * sign * 400 };
}

function executeOrder(state: BattleState, f: FormationState, dt: number, terrain: TerrainQuery): void {
  if (f.soldiers <= 0 || f.activity === 'destroyed' || f.activity === 'surrendered') {
    f.vx = 0;
    f.vz = 0;
    return;
  }
  if (f.activity === 'routing') {
    const rear = sideRearPoint(state, f.side);
    moveFormationToward(f, rear.x, rear.z, null, dt, terrain, true);
    f.cohesion = Math.max(0, f.cohesion - dt * 0.05);
    return;
  }
  const engaged = f.engagedWith.length > 0;
  const o = f.order;
  let moving = false;
  switch (o.type) {
    case 'hold':
    case 'regroup':
      f.vx = 0;
      f.vz = 0;
      break;
    case 'move_to': {
      if (engaged) break;
      const rem = moveFormationToward(f, o.x, o.z, o.facing, dt, terrain, o.run);
      moving = rem > 0.5;
      if (!moving) nextOrder(f);
      break;
    }
    case 'attack_target':
    case 'charge': {
      const t = state.formations[o.target];
      if (!t || t.soldiers <= 0 || t.activity === 'surrendered') {
        nextOrder(f);
        break;
      }
      f.target = t.index;
      if (engaged && f.engagedWith.includes(t.index)) break;
      const dx = t.x - f.x;
      const dz = t.z - f.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const run = o.type === 'charge' ? d < 90 : o.run;
      moveFormationToward(f, t.x, t.z, null, dt, terrain, run);
      moving = true;
      if (o.type === 'charge' && run) f.activity = 'charging';
      break;
    }
    case 'flank': {
      const t = state.formations[o.target];
      if (!t || t.soldiers <= 0) {
        nextOrder(f);
        break;
      }
      const side = o.side === 'left' ? 1 : -1;
      const rx = -dcos(t.facing) * side;
      const rz = dsin(t.facing) * side;
      const px = t.x + rx * (t.width / 2 + 35) - dsin(t.facing) * 10;
      const pz = t.z + rz * (t.width / 2 + 35) - dcos(t.facing) * 10;
      const rem = moveFormationToward(f, px, pz, null, dt, terrain, true);
      moving = rem > 1;
      if (!moving) f.order = { type: 'charge', target: t.index };
      break;
    }
    case 'withdraw': {
      const rear = o.x !== null && o.z !== null ? { x: o.x, z: o.z } : sideRearPoint(state, f.side);
      const rem = moveFormationToward(f, rear.x, rear.z, null, dt, terrain, false, engaged);
      moving = rem > 1;
      f.activity = 'withdrawing';
      if (!moving) f.order = { type: 'hold' };
      return;
    }
    case 'defend': {
      const dx = o.x - f.x;
      const dz = o.z - f.z;
      if (dx * dx + dz * dz > 25) {
        moveFormationToward(f, o.x, o.z, null, dt, terrain, false);
        moving = true;
      } else {
        const e = enemyNearest(state, f, o.radius);
        if (e && !engaged) {
          moveFormationToward(f, e.x, e.z, null, dt, terrain, false);
          moving = true;
        }
      }
      break;
    }
    case 'skirmish': {
      const t = state.formations[o.target];
      const range = UNITS[f.unitClass].stats.range;
      if (!t || t.soldiers <= 0 || range <= 0) {
        nextOrder(f);
        break;
      }
      f.target = t.index;
      const dx = t.x - f.x;
      const dz = t.z - f.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > range * 0.9) {
        moveFormationToward(f, t.x, t.z, null, dt, terrain, false);
        moving = true;
      } else if (d < range * 0.45) {
        moveFormationToward(f, f.x - dx, f.z - dz, null, dt, terrain, true, true);
        moving = true;
      } else {
        f.facing = facingOf(dx, dz);
        f.vx = 0;
        f.vz = 0;
      }
      break;
    }
    case 'construct': {
      const dx = o.x - f.x;
      const dz = o.z - f.z;
      if (dx * dx + dz * dz > 16) {
        moveFormationToward(f, o.x, o.z, o.facing, dt, terrain, false);
        moving = true;
      } else {
        f.activity = 'constructing';
        f.workProgress += dt / 60;
        if (f.workProgress >= 1) {
          state.works.push({ work: o.work, x: o.x, z: o.z, facing: o.facing, side: f.side, hp: 500 });
          f.workProgress = 0;
          nextOrder(f);
        }
        return;
      }
      break;
    }
    case 'resupply': {
      const t = state.formations[o.target];
      if (!t || t.soldiers <= 0) {
        nextOrder(f);
        break;
      }
      const rem = moveFormationToward(f, t.x, t.z, null, dt, terrain, false);
      moving = rem > 25;
      if (!moving) {
        t.ammo = Math.min(UNITS[t.unitClass].stats.ammo, t.ammo + dt * 0.2);
        t.supply = Math.min(1, t.supply + dt * 0.01);
      }
      break;
    }
    case 'advance':
      f.order = normalizeOrder(f, o);
      break;
  }
  if (f.activity === 'rallying' && state.time - f.lastHitTime > 8) f.activity = 'idle';
  if (f.activity !== 'rallying' && f.activity !== 'charging') {
    f.activity = engaged ? 'engaged' : moving ? 'moving' : f.reload > 0 && f.target >= 0 && UNITS[f.unitClass].stats.range > 0 ? 'shooting' : 'idle';
  } else if (f.activity === 'charging' && !moving) {
    f.activity = engaged ? 'engaged' : 'idle';
  }
  // Idle aggressive formations engage enemies that come close.
  if (!moving && !engaged && f.stance === 'aggressive' && (o.type === 'hold' || o.type === 'regroup') && f.unitClass !== 'supply_train') {
    const e = enemyNearest(state, f, 35);
    if (e) f.order = { type: 'attack_target', target: e.index, run: false };
  }
}

function nextOrder(f: FormationState): void {
  f.order = f.queue.shift() ?? { type: 'hold' };
}

function inContact(a: FormationState, b: FormationState): boolean {
  // b's centroid in a's local frame.
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const s = dsin(a.facing);
  const c = dcos(a.facing);
  const lz = dx * s + dz * c;
  const lx = dx * -c + dz * s;
  return Math.abs(lx) < a.width / 2 + b.width * 0.35 + 1 && Math.abs(lz) < a.depth / 2 + b.depth / 2 + 2;
}

function updateContacts(state: BattleState, out: BattleEventRecord[]): void {
  const fs = state.formations;
  for (const f of fs) f.engagedWith.length = 0;
  for (let i = 0; i < fs.length; i++) {
    const a = fs[i] as FormationState;
    if (a.soldiers <= 0 || a.activity === 'surrendered') continue;
    for (let j = i + 1; j < fs.length; j++) {
      const b = fs[j] as FormationState;
      if (b.side === a.side || b.soldiers <= 0 || b.activity === 'surrendered') continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const reach = Math.max(a.width, a.depth, b.width, b.depth) + 10;
      if (dx * dx + dz * dz > reach * reach) continue;
      if (!inContact(a, b) && !inContact(b, a)) continue;
      const wasEngaged = a.activity === 'engaged' || b.activity === 'engaged';
      a.engagedWith.push(b.index);
      b.engagedWith.push(a.index);
      if (a.activity === 'charging') resolveChargeImpact(state, a, b, rng, out);
      if (b.activity === 'charging') resolveChargeImpact(state, b, a, rng, out);
      if (a.activity === 'charging') a.activity = 'engaged';
      if (b.activity === 'charging') b.activity = 'engaged';
      if (!wasEngaged) out.push({ time: state.time, kind: 'contact', side: a.side, formation: a.index, other: b.index, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, value: null, text: null });
    }
  }
}

function updateShooting(state: BattleState, f: FormationState, dt: number, out: BattleEventRecord[]): void {
  const st = UNITS[f.unitClass].stats;
  if (st.rangedAttack <= 0 || f.soldiers <= 0 || f.ammo <= 0 || f.stance === 'hold_fire') return;
  if (f.activity === 'routing' || f.activity === 'surrendered' || f.engagedWith.length > 0) return;
  if (f.reload > 0) {
    f.reload -= dt;
    return;
  }
  let target: FormationState | null = null;
  const o = f.order;
  if ((o.type === 'attack_target' || o.type === 'skirmish' || o.type === 'charge') && state.formations[o.target]) target = state.formations[o.target]!;
  if (target) {
    const dx = target.x - f.x;
    const dz = target.z - f.z;
    if (dx * dx + dz * dz > st.range * st.range || target.soldiers <= 0) target = null;
  }
  if (!target) target = enemyNearest(state, f, st.range);
  if (!target) return;
  f.target = target.index;
  launchVolley(state, f, target, rng, out);
}

function updateCondition(f: FormationState, dt: number): void {
  if (f.soldiers <= 0) return;
  const speed2 = f.vx * f.vx + f.vz * f.vz;
  const st = UNITS[f.unitClass].stats;
  if (speed2 > st.walkSpeed * st.walkSpeed * 1.3) f.fatigue = Math.min(1, f.fatigue + 0.004 * dt * st.fatigueRate * 100);
  else if (speed2 < 0.01 && f.engagedWith.length === 0) f.fatigue = Math.max(0, f.fatigue - 0.0015 * dt);
  if (speed2 > 0.01) f.cohesion = Math.max(0.2, f.cohesion - 0.01 * dt * (speed2 > st.walkSpeed * st.walkSpeed * 1.3 ? 2 : 0.5));
  else if (f.engagedWith.length === 0) f.cohesion = Math.min(1, f.cohesion + (f.order.type === 'regroup' ? 0.05 : 0.02) * dt);
  // Strength changes alter the block shape.
  if (f.soldiers < f.files * (f.ranks - 1)) refreshDims(f);
}

function updateSides(state: BattleState): void {
  for (const side of [0, 1] as const) {
    const s = state.sides[side];
    let soldiers = 0;
    let killed = 0;
    let routed = 0;
    let destroyed = 0;
    let morale = 0;
    let n = 0;
    for (const f of state.formations) {
      if (f.side !== side) continue;
      soldiers += f.soldiers;
      killed += f.killed;
      if (f.activity === 'routing') routed++;
      if (f.soldiers <= 0) destroyed++;
      else if (f.activity !== 'routing') {
        morale += f.morale;
        n++;
      }
    }
    s.soldiers = soldiers;
    s.killed = killed;
    s.routedFormations = routed;
    s.destroyedFormations = destroyed;
    s.averageMorale = n ? morale / n : 0;
  }
}

/** True if a side can no longer fight (all formations routed/destroyed/surrendered or withdrawn off-field). */
export function sideBroken(state: BattleState, side: SideIndex): boolean {
  const s = state.sides[side];
  if (s.surrendered) return true;
  for (const f of state.formations) {
    if (f.side !== side || f.soldiers <= 0) continue;
    if (f.unitClass === 'supply_train' || f.unitClass === 'engineers') continue;
    if (f.activity !== 'routing' && f.activity !== 'surrendered') return false;
  }
  return true;
}

function checkOutcome(state: BattleState): BattleOutcome | null {
  const b0 = sideBroken(state, 0);
  const b1 = sideBroken(state, 1);
  if (b0 || b1) {
    const winner: SideIndex | null = b0 && b1 ? null : b0 ? 1 : 0;
    const loser = winner === null ? null : ((1 - winner) as SideIndex);
    const reason = loser !== null && state.sides[loser].surrendered ? 'surrender' : loser !== null && state.sides[loser].soldiers === 0 ? 'annihilation' : 'rout';
    return buildOutcome(state, winner, reason);
  }
  const limit = state.setup.timeLimitSec;
  if (limit !== null && state.time >= limit) return forceOutcome(state, 'time_limit');
  for (const side of [0, 1] as const) {
    if (state.sides[side].withdrawn && state.formations.every((f) => f.side !== side || f.soldiers <= 0 || f.order.type === 'hold' || f.activity === 'routing')) {
      return buildOutcome(state, (1 - side) as SideIndex, 'withdrawal');
    }
  }
  return null;
}

/** Strength-based end (time limit / forced end of a distant battle). */
export function forceOutcome(state: BattleState, reason: BattleOutcome['reason']): BattleOutcome {
  const s0 = sideStrength(state, 0);
  const s1 = sideStrength(state, 1);
  const winner: SideIndex | null = Math.abs(s0 - s1) < 0.1 * Math.max(s0, s1, 1) ? null : s0 > s1 ? 0 : 1;
  return buildOutcome(state, winner, reason);
}

export function sideStrength(state: BattleState, side: SideIndex): number {
  let p = 0;
  for (const f of state.formations) {
    if (f.side !== side || f.soldiers <= 0 || f.activity === 'routing') continue;
    const st = UNITS[f.unitClass].stats;
    p += f.soldiers * (st.meleeAttack + st.meleeDefense + st.rangedAttack) * (st.hp / 10) * (0.5 + f.morale / 200);
  }
  return p;
}

function buildOutcome(state: BattleState, winner: SideIndex | null, reason: BattleOutcome['reason']): BattleOutcome {
  const sides = ([0, 1] as const).map((side): BattleSideResult => {
    const s = state.sides[side];
    let pursuit = 0;
    const formations: FormationResult[] = state.formations
      .filter((f) => f.side === side)
      .map((f) => {
        let survivors = f.soldiers;
        if (winner !== null && winner !== side && f.activity === 'routing') {
          const lost = Math.floor(survivors * 0.12);
          survivors -= lost;
          pursuit += lost;
        }
        return {
          index: f.index,
          armyUnitId: f.armyUnitId,
          unitClass: f.unitClass,
          startSoldiers: f.maxSoldiers,
          survivors,
          killed: f.killed,
          captured: f.captured,
          morale: f.morale,
          fatigue: f.fatigue,
          experienceGained: Math.min(0.2, f.kills / Math.max(1, f.maxSoldiers) + 0.02),
          routed: f.activity === 'routing',
        };
      });
    const survivors = formations.reduce((a, f) => a + f.survivors, 0);
    const cmdF = s.commanderFormation >= 0 ? state.formations[s.commanderFormation] : null;
    return {
      factionId: s.factionId,
      startSoldiers: s.initialSoldiers,
      survivors,
      killed: s.initialSoldiers - survivors,
      captured: 0,
      pursuitLosses: pursuit,
      commanderFate: !cmdF ? 'none' : s.commanderAlive ? 'safe' : 'killed',
      formations,
    };
  }) as [BattleSideResult, BattleSideResult];
  const names = sides.map((s) => FACTIONS[s.factionId]?.shortName ?? s.factionId);
  const summary: string[] = [];
  if (winner === null) summary.push(`Neither side could claim the field after ${Math.round(state.time / 60)} minutes.`);
  else summary.push(`The ${names[winner]} host carried the field (${reason.replace('_', ' ')}).`);
  summary.push(`${names[0]} losses: ${sides[0].killed}. ${names[1]} losses: ${sides[1].killed}.`);
  return { battleId: state.id, winner, reason, durationSec: state.time, sides, summary, autoresolved: false };
}

/** Current outcome or null while the battle runs. */
export function getBattleOutcome(state: BattleState): BattleOutcome | null {
  return state.outcome;
}

// ---------------------------------------------------------------------------------------------------
// Skirmish setup
// ---------------------------------------------------------------------------------------------------

function composeArmy(total: number, factionId: string, compositionId: string): { unitClass: UnitClass; soldiers: number }[] {
  const comp = SKIRMISH_COMPOSITIONS.find((c) => c.id === compositionId) ?? SKIRMISH_COMPOSITIONS[0]!;
  const roster = new Set(FACTIONS[factionId]?.roster ?? UNIT_CLASSES);
  const out: { unitClass: UnitClass; soldiers: number }[] = [];
  let sumW = 0;
  for (const cls of UNIT_CLASSES) if (roster.has(cls)) sumW += comp.weights[cls] ?? 0;
  for (const cls of UNIT_CLASSES) {
    const w = roster.has(cls) ? (comp.weights[cls] ?? 0) : 0;
    if (w <= 0) continue;
    const per = UNITS[cls].stats.menPerFormation;
    let budget = Math.round((total * w) / sumW);
    if (budget < per * 0.5 && cls !== 'spearmen' && cls !== 'archers') continue;
    while (budget > 0 && out.length < MAX_FORMATIONS_PER_SIDE) {
      const n = Math.min(per, Math.max(Math.min(per, 4), budget));
      out.push({ unitClass: cls, soldiers: n });
      budget -= n;
    }
  }
  if (out.length === 0) out.push({ unitClass: 'spearmen', soldiers: Math.max(10, total) });
  return out;
}

/** Build a complete BattleSetup for a skirmish (terrain window chosen by preset). */
export function createSkirmishSetup(opts: SkirmishSetup): BattleSetup {
  const seed = opts.seed >>> 0;
  const region = createRegionTerrainSpec(deriveSeed(seed, 'skirmish-terrain'));
  const site = findPresetSite(region, opts.preset);
  const terrain = createLocalTerrainSpec(region, site.x, site.z, BATTLE_MAP_SIZE, BATTLE_MAP_RESOLUTION, opts.preset);
  const perSide = Math.max(2, Math.floor(opts.totalSoldiers / 2));
  const armies = opts.armies ?? [
    { factionId: opts.playerSide === 0 ? opts.playerFactionId : opts.enemyFactionId, formations: composeArmy(perSide, opts.playerSide === 0 ? opts.playerFactionId : opts.enemyFactionId, DEFAULT_COMPOSITION_ID) },
    { factionId: opts.playerSide === 1 ? opts.playerFactionId : opts.enemyFactionId, formations: composeArmy(perSide, opts.playerSide === 1 ? opts.playerFactionId : opts.enemyFactionId, DEFAULT_COMPOSITION_ID) },
  ];
  const partial = { terrain };
  const mkSide = (side: SideIndex): BattleSetup['sides'][number] => {
    const a = armies[side]!;
    const isPlayer = side === opts.playerSide && !opts.aiVsAi;
    return {
      factionId: a.factionId,
      armyIds: [],
      commanderId: null,
      commanderName: side === opts.playerSide ? 'You' : 'Enemy General',
      commanderSkill: opts.difficulty === 'hard' || opts.difficulty === 'very_hard' ? 14 : 10,
      controller: isPlayer ? ('player' as const) : ('ai' as const),
      aiPersonality: FACTIONS[a.factionId]?.aiPersonality ?? 'opportunist',
      difficulty: opts.difficulty,
      formations: a.formations.map(
        (f): FormationSetup => ({
          unitClass: f.unitClass,
          soldiers: f.soldiers,
          experience: 0.2,
          morale: UNITS[f.unitClass].stats.baseMorale,
          fatigue: 0,
          supply: 1,
          name: null,
          x: null,
          z: null,
          facing: null,
          shape: null,
          hasCommander: false,
          armyUnitId: null,
        }),
      ),
      deployZone: deployZoneFor(partial, side),
      supply: 1,
    };
  };
  const sides: BattleSetup['sides'] = [mkSide(0), mkSide(1)];
  return {
    id: `skirmish_${seed}`,
    seed,
    kind: opts.preset === 'river_crossing' ? 'river_crossing' : 'skirmish',
    terrain,
    fortification: null,
    environment: makeEnvironment(opts.hour, opts.season, opts.weather),
    sides,
    attackerSide: 0,
    timeLimitSec: 60 * 40,
    objectives: [],
    deploymentSec: 0,
    origin: { kind: 'skirmish' },
  };
}
