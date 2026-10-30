/**
 * Battle AI core: what one side knows, its persistent memory and RNG, and how it issues orders. OWNER: AI Engineer -
 * Battle AI, Intents & Campaign AI (SIM-02).
 *
 * Everything the battle AI decides is a pure function of the BattleState (+ terrain): the AI keeps its plan in
 * `BattleSideState.aiMemory` (plain values; saved, hashed) and draws randomness from its own sfc32 stream stored in that
 * memory (`r0..r3`, seeded from the battle seed), so a battle resumed from JSON thinks exactly like the uninterrupted one
 * and the AI never perturbs the combat RNG (`BattleState.rng`).
 *
 * No cheating (DESIGN_SPEC §6.10, SIM-02 spec 1): the AI reasons only about enemy formations its side can see -
 * `spotted` (within some own formation's vision, capped by weather and night) and not `hidden` (forest ambushers stay
 * unknown until an own formation comes within 60 m or scouts see them). Siege walls and gates are public knowledge.
 */
import type { BattleCommand, BattleState, FormationIndex, FormationOrder, FormationState, SideIndex, TerrainQuery } from '../../../core/types';
import type { RngState } from '../../../core/types';
import { UNIT_CLASSES } from '../../../core/types';
import { Rng, deriveSeed, rngStateFromSeed } from '../../../core/rng';
import { dcos, dlog, dsin, facingOf } from '../../../core/math';
import { AI_PERSONALITY_DEFS, DIFFICULTY_DEFS } from '../../../data/difficulty';
import { UNITS } from '../../../data/units';
import type { BattleContext } from '../context';
import { battleContext } from '../context';
import { isOffField } from '../orders';
import { variantStats, isShooter } from '../stats';
import { sideFacing } from '../setup';

/** Persistent per-side AI memory (BattleSideState.aiMemory). */
export type AiMemory = Record<string, number | string | boolean>;

/** The battle profile a side fights with (AI_PERSONALITY_DEFS battle + the setup's aggression override). */
export interface BattleProfile {
  aggression: number;
  flanking: number;
  reserve: number;
  withdrawAt: number;
}

/** Formation roles of the field plan (one char per formation index in memory key `roles`). */
export const ROLE = {
  none: '-',
  line: 'L',
  reserve: 'R',
  missile: 'M',
  shock: 'E',
  flankLeft: 'F',
  flankRight: 'G',
  screen: 'S',
  skirmisher: 'K',
  engineer: 'N',
  cart: 'C',
} as const;
export type Role = (typeof ROLE)[keyof typeof ROLE];

/** One side's view of the battle for one think. Built by `perceive`; arrays are reused between calls. */
export interface AiSide {
  state: BattleState;
  ctx: BattleContext;
  terrain: TerrainQuery;
  side: SideIndex;
  enemySide: SideIndex;
  mem: AiMemory;
  rng: Rng;
  profile: BattleProfile;
  replanSec: number;
  /** Own formations that can take orders (alive, on the field, not routing / rallying / panicking / surrendered). */
  own: FormationState[];
  /** Own formations still standing (incl. routing / rallying) - strength, rally decisions. */
  ownAlive: FormationState[];
  /** Known (spotted, not hidden) standing enemy formations. */
  known: FormationState[];
  /** Known routing enemy formations still on the field. */
  routers: FormationState[];
  /** Weighted centroids of own controllable and known standing enemy formations. */
  ownX: number;
  ownZ: number;
  enemyX: number;
  enemyZ: number;
  /** Battle axis: unit vector from own centroid toward the enemy (falls back to the deploy facing). */
  fwdX: number;
  fwdZ: number;
  /** Right of the axis: (-cos f, sin f). */
  rightX: number;
  rightZ: number;
  facing: number;
  /** Fighting strength (outcome.sideStrength formula) of own and known enemy formations. */
  ownStr: number;
  enemyStr: number;
  /** Missile weight (soldiers x ranged attack of shooters with arrows) per side. */
  ownMissile: number;
  enemyMissile: number;
  /** Commands issued this think. */
  cmds: BattleCommand[];
}

const own: FormationState[] = [];
const ownAlive: FormationState[] = [];
const known: FormationState[] = [];
const routers: FormationState[] = [];
const rngTmp = new Rng(1);
const rngState: RngState = [0, 0, 0, 0];

/** Battle profile of a side: personality battle numbers, aggression overridden by the setup (autoresolve stance). */
export function battleProfile(state: BattleState, side: SideIndex): BattleProfile {
  const sd = state.setup.sides[side];
  const p = AI_PERSONALITY_DEFS[sd.aiPersonality]?.battle ?? AI_PERSONALITY_DEFS.opportunist.battle;
  const aggression = typeof sd.aggression === 'number' ? Math.min(1, Math.max(0, sd.aggression)) : p.aggression;
  return { aggression, flanking: p.flanking, reserve: p.reserve, withdrawAt: p.withdrawAt };
}

/** Seconds between full re-plans for a side (DIFFICULTY_DEFS.battleAiReplanSec: 3 / 2 / 1.5 / 1). */
export function replanSeconds(state: BattleState, side: SideIndex): number {
  return DIFFICULTY_DEFS[state.setup.sides[side].difficulty]?.battleAiReplanSec ?? 2;
}

/** The battle whose context stats `formationStrength` may use (set by `perceive`; the same values variantStats gives). */
let statsState: BattleState | null = null;
let statsCtx: BattleContext | null = null;

/** Fighting strength of one formation (the sideStrength formula of outcome.ts). */
export function formationStrength(state: BattleState, f: FormationState): number {
  const st = (state === statsState && statsCtx ? statsCtx.stats[f.index] : undefined) ?? variantStats(state.setup.sides[f.side].factionId, f.unitClass);
  return f.soldiers * (st.meleeAttack + st.meleeDefense + st.rangedAttack) * (st.hp / 10) * (0.5 + f.morale / 200);
}

/** Can the formation take orders (the battle.ts `controllable` rule). */
export function controllable(state: BattleState, f: FormationState): boolean {
  if (f.soldiers <= 0 || f.activity === 'routing' || f.activity === 'rallying' || f.activity === 'surrendered' || f.activity === 'destroyed') return false;
  return f.panicUntil <= state.time;
}

/** Load the side's AI RNG from memory (seeded from the battle seed on first use). */
function loadRng(state: BattleState, side: SideIndex, mem: AiMemory): Rng {
  if (typeof mem.r0 !== 'number') {
    const s = rngStateFromSeed(deriveSeed(state.setup.seed, 'battle-ai', side));
    mem.r0 = s[0];
    mem.r1 = s[1];
    mem.r2 = s[2];
    mem.r3 = s[3];
  }
  rngState[0] = mem.r0 as number;
  rngState[1] = mem.r1 as number;
  rngState[2] = mem.r2 as number;
  rngState[3] = mem.r3 as number;
  rngTmp.setState(rngState);
  return rngTmp;
}

/** Persist the AI RNG back into memory. */
export function saveRng(ai: AiSide): void {
  ai.rng.saveTo(rngState);
  ai.mem.r0 = rngState[0];
  ai.mem.r1 = rngState[1];
  ai.mem.r2 = rngState[2];
  ai.mem.r3 = rngState[3];
}

const view: AiSide = {
  state: null as unknown as BattleState,
  ctx: null as unknown as BattleContext,
  terrain: null as unknown as TerrainQuery,
  side: 0,
  enemySide: 1,
  mem: {},
  rng: rngTmp,
  profile: { aggression: 0.5, flanking: 0.5, reserve: 0.1, withdrawAt: 0.4 },
  replanSec: 2,
  own,
  ownAlive,
  known,
  routers,
  ownX: 0,
  ownZ: 0,
  enemyX: 0,
  enemyZ: 0,
  fwdX: 0,
  fwdZ: 1,
  rightX: -1,
  rightZ: 0,
  facing: 0,
  ownStr: 0,
  enemyStr: 0,
  ownMissile: 0,
  enemyMissile: 0,
  cmds: [],
};

function missileWeight(state: BattleState, ctx: BattleContext, f: FormationState): number {
  const st = ctx.stats[f.index]!;
  if (!isShooter(st) || f.ammo <= 0) return 0;
  return f.soldiers * st.rangedAttack;
}

/**
 * Build the side's view for this think (reuses module arrays: valid until the next call). `cmds` is a fresh array the
 * caller returns.
 */
export function perceive(state: BattleState, side: SideIndex, terrain: TerrainQuery): AiSide {
  const ctx = battleContext(state, terrain);
  statsState = state;
  statsCtx = ctx;
  const mem = state.sides[side].aiMemory;
  const v = view;
  v.state = state;
  v.ctx = ctx;
  v.terrain = terrain;
  v.side = side;
  v.enemySide = (1 - side) as SideIndex;
  v.mem = mem;
  v.rng = loadRng(state, side, mem);
  v.profile = battleProfile(state, side);
  v.replanSec = replanSeconds(state, side);
  v.cmds = [];
  own.length = 0;
  ownAlive.length = 0;
  known.length = 0;
  routers.length = 0;
  let ox = 0;
  let oz = 0;
  let ow = 0;
  let ex = 0;
  let ez = 0;
  let ew = 0;
  let ownStr = 0;
  let enemyStr = 0;
  let ownMissile = 0;
  let enemyMissile = 0;
  for (const f of state.formations) {
    if (f.soldiers <= 0 || f.activity === 'surrendered' || f.activity === 'destroyed' || isOffField(ctx, f)) continue;
    if (f.side === side) {
      ownAlive.push(f);
      if (f.activity === 'routing') continue;
      ownStr += formationStrength(state, f);
      ownMissile += missileWeight(state, ctx, f);
      if (!controllable(state, f)) continue;
      own.push(f);
      ox += f.x * f.soldiers;
      oz += f.z * f.soldiers;
      ow += f.soldiers;
    } else {
      if (!f.spotted || f.hidden) continue;
      if (f.activity === 'routing') {
        routers.push(f);
        continue;
      }
      known.push(f);
      enemyStr += formationStrength(state, f);
      enemyMissile += missileWeight(state, ctx, f);
      ex += f.x * f.soldiers;
      ez += f.z * f.soldiers;
      ew += f.soldiers;
    }
  }
  const deployFacing = sideFacing(state.setup, side);
  if (ow > 0) {
    v.ownX = ox / ow;
    v.ownZ = oz / ow;
  } else {
    const zone = state.setup.sides[side].deployZone;
    v.ownX = (zone.minX + zone.maxX) / 2;
    v.ownZ = (zone.minZ + zone.maxZ) / 2;
  }
  if (ew > 0) {
    v.enemyX = ex / ew;
    v.enemyZ = ez / ew;
  } else {
    // Unknown enemy: the far deploy zone (where it must be coming from).
    const zone = state.setup.sides[v.enemySide].deployZone;
    v.enemyX = (zone.minX + zone.maxX) / 2;
    v.enemyZ = (zone.minZ + zone.maxZ) / 2;
  }
  const dx = v.enemyX - v.ownX;
  const dz = v.enemyZ - v.ownZ;
  v.facing = dx * dx + dz * dz > 100 ? facingOf(dx, dz) : deployFacing;
  v.fwdX = dsin(v.facing);
  v.fwdZ = dcos(v.facing);
  v.rightX = -dcos(v.facing);
  v.rightZ = dsin(v.facing);
  v.ownStr = ownStr;
  v.enemyStr = enemyStr;
  v.ownMissile = ownMissile;
  v.enemyMissile = enemyMissile;
  return v;
}

// ---------------------------------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------------------------------

/** Centroid distance. */
export function dist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Approximate footprint gap between two formations (centroid distance minus half depths). */
export function gap(a: FormationState, b: FormationState): number {
  return dist(a, b) - a.depth * 0.5 - b.depth * 0.5;
}

/** Projection of a point on the side's battle axis (forward) relative to its own centroid. */
export function along(ai: AiSide, x: number, z: number): number {
  return (x - ai.ownX) * ai.fwdX + (z - ai.ownZ) * ai.fwdZ;
}

/** Projection of a point on the side's right vector relative to its own centroid. */
export function lateral(ai: AiSide, x: number, z: number): number {
  return (x - ai.ownX) * ai.rightX + (z - ai.ownZ) * ai.rightZ;
}

/** Speed (m/s) of a formation. */
export function speedOf(f: FormationState): number {
  return Math.sqrt(f.vx * f.vx + f.vz * f.vz);
}

/** Speed at which `e` closes on `f` (positive = approaching). */
export function closing(f: FormationState, e: FormationState): number {
  const dx = f.x - e.x;
  const dz = f.z - e.z;
  const d = Math.sqrt(dx * dx + dz * dz) || 1;
  return (e.vx * dx + e.vz * dz) / d;
}

/** ln(bonusVs) for every class pair, built once (the unit table is static data). */
const CLASS_INDEX: Readonly<Record<string, number>> = Object.fromEntries(UNIT_CLASSES.map((c, i) => [c, i]));
const COUNTER_LOG = new Float64Array(UNIT_CLASSES.length * UNIT_CLASSES.length);
for (let i = 0; i < UNIT_CLASSES.length; i++) {
  for (let j = 0; j < UNIT_CLASSES.length; j++) {
    const m = UNITS[UNIT_CLASSES[i]!].bonusVs[UNIT_CLASSES[j]!] ?? 1;
    COUNTER_LOG[i * UNIT_CLASSES.length + j] = m === 1 ? 0 : dlog(m);
  }
}

/** Natural log of a counter multiplier (bonusVs a -> b, 1 when absent). */
export function counterLog(a: FormationState, b: FormationState): number {
  return COUNTER_LOG[(CLASS_INDEX[a.unitClass] ?? 0) * UNIT_CLASSES.length + (CLASS_INDEX[b.unitClass] ?? 0)] as number;
}

/** The enemy formation in front of / at the front face of `e` toward `f`: is `f` in e's frontal arc (|angle| < 50 deg)? */
export function facesToward(e: FormationState, f: FormationState): boolean {
  const dx = f.x - e.x;
  const dz = f.z - e.z;
  const d = Math.sqrt(dx * dx + dz * dz) || 1;
  return (dx * dsin(e.facing) + dz * dcos(e.facing)) / d > 0.64;
}

/** Would a charge by `f` on `e` hit braced spears (spear / guards, standing, facing f, or in an all-round shape)? */
export function bracedAgainst(e: FormationState, f: FormationState): boolean {
  if (e.unitClass !== 'spearmen' && e.unitClass !== 'elite_guards') return false;
  if (e.activity === 'routing') return false;
  if (e.shape === 'square' || e.shape === 'circle') return true;
  if (e.engagedWith.length > 0) return false;
  return speedOf(e) < 0.3 && facesToward(e, f);
}

// ---------------------------------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------------------------------

function q(v: number, step: number): number {
  return Math.round(v / step);
}

/** Signature of an order for change detection (positions quantized to `posStep` m). */
export function orderSignature(o: FormationOrder, posStep = 8): string {
  switch (o.type) {
    case 'move_to':
      return `m${q(o.x, posStep)},${q(o.z, posStep)},${o.run ? 1 : 0},${o.facing === null ? 'n' : q(o.facing, 0.2)}`;
    case 'attack_target':
      return `a${o.target}`;
    case 'charge':
      return `c${o.target}`;
    case 'flank':
      return `f${o.target}${o.side}`;
    case 'skirmish':
      return `s${o.target}`;
    case 'defend':
      return `d${q(o.x, posStep)},${q(o.z, posStep)},${q(o.radius, 10)}`;
    case 'withdraw':
      return `w${o.x === null ? 'n' : q(o.x, 20)},${o.z === null ? 'n' : q(o.z, 20)}`;
    case 'construct':
      return `k${o.work}${q(o.x, 4)},${q(o.z, 4)}`;
    case 'resupply':
      return `r${o.target}`;
    case 'advance':
      return `v${q(o.distance, 5)}`;
    default:
      return o.type;
  }
}

/** Does the formation's current order still carry out `sig` (orders evolve: flank -> charge -> attack_target)? */
function stillExecuting(f: FormationState, o: FormationOrder): boolean {
  const cur = f.order;
  switch (o.type) {
    case 'flank':
      return (cur.type === 'flank' || cur.type === 'charge' || cur.type === 'attack_target') && cur.target === o.target;
    case 'charge':
      // A charge that ended in melee continues as attack_target; once contact is lost the charge is renewed (run-in).
      if (cur.type === 'charge') return cur.target === o.target;
      return cur.type === 'attack_target' && cur.target === o.target && f.engagedWith.length > 0;
    case 'attack_target':
    case 'skirmish':
    case 'resupply':
      return cur.type === o.type && cur.target === o.target;
    case 'move_to': {
      // A frontage change that has not happened yet needs the order (setFrontage applies on arrival).
      if (typeof o.width === 'number' && Math.abs(f.width - o.width) > 3 && !(cur.type === 'move_to' && typeof cur.width === 'number' && Math.abs(cur.width - o.width) < 3)) return false;
      if (cur.type === 'move_to') return Math.abs(cur.x - o.x) < 6 && Math.abs(cur.z - o.z) < 6 && cur.run === o.run;
      // Arrived (the order completed into hold): standing within 8 m of the point counts as done.
      return cur.type === 'hold' && Math.abs(f.x - o.x) < 8 && Math.abs(f.z - o.z) < 8;
    }
    case 'defend':
      return cur.type === 'defend' && Math.abs(cur.x - o.x) < 6 && Math.abs(cur.z - o.z) < 6;
    case 'construct':
      return cur.type === 'construct' && cur.work === o.work && Math.abs(cur.x - o.x) < 6 && Math.abs(cur.z - o.z) < 6;
    case 'withdraw':
      return cur.type === 'withdraw';
    case 'hold':
      return cur.type === 'hold';
    case 'regroup':
      return cur.type === 'regroup' || cur.type === 'hold';
    default:
      return cur.type === o.type;
  }
}

/**
 * Give `f` an order unless it is already carrying it out (no command, no log entry, no restarted order timers).
 * Formations holding an intent are left to the intent translation. Returns true when a command was issued.
 */
export function give(ai: AiSide, f: FormationState, o: FormationOrder): boolean {
  if (f.intent) return false;
  if (stillExecuting(f, o)) return false;
  ai.cmds.push({ kind: 'order', formations: [f.index], order: o, queue: false });
  // Mirror the change locally so later decisions this think see it (the command applies right after).
  return true;
}

/** Order a set_shape when the formation is not already in that shape (and the class allows it). */
export function shape(ai: AiSide, f: FormationState, s: FormationState['shape']): void {
  if (f.shape === s || !UNITS[f.unitClass].allowedShapes.includes(s)) return;
  if (f.shapeChangeUntil > ai.state.time) return;
  ai.cmds.push({ kind: 'set_shape', formations: [f.index], shape: s });
}

/** Order a stance change when needed. */
export function stance(ai: AiSide, f: FormationState, s: FormationState['stance']): void {
  if (f.stance === s) return;
  ai.cmds.push({ kind: 'set_stance', formations: [f.index], stance: s });
}

/** Point `d` m from (x, z) along facing `a`. */
export function offset(x: number, z: number, a: number, d: number, out: { x: number; z: number }): { x: number; z: number } {
  out.x = x + dsin(a) * d;
  out.z = z + dcos(a) * d;
  return out;
}

/** Index lookup: the formation at `i` (typed). */
export function formationAt(state: BattleState, i: FormationIndex): FormationState | null {
  return i >= 0 ? (state.formations[i] ?? null) : null;
}
