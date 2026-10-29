/**
 * Strategic armies: creation, orders and routing, hourly movement, arrivals, contacts -> engagements, split / merge /
 * disband (DESIGN_SPEC §7.7). OWNER: Simulation Engineer - Strategic World Simulation (SIM-01). Baseline by the CTO;
 * exported signatures kept (makeArmy, makeArmyUnit, orderArmy, planArmyPath, updateArmiesHourly, updateArmiesDaily,
 * detectContacts, applyBattleOutcome, armySoldiers, armyStrength, isHostile).
 *
 *  - Routes: pathing.ts (road Dijkstra + off-road legs, fords closed in flood, weak bridges, blocked roads).
 *  - Speed per hour: road quality / off-road terrain of the current segment x pace(slowest category) x faction
 *    marchSpeed x monsoon x wetness x (1 - 0.3 fatigue) x forced march 1.3.
 *  - Contacts: hostile armies within 140 m x stance factor (aggressive 1.3, balanced 1, cautious 0.8; the larger of
 *    the two) engage; a cautious army whose strength ratio is < 0.6 and that is >= 10% faster evades; a retreating
 *    army is only caught by an enemy >= 20% faster; garrisons behind walls do not take field contacts. Same-faction
 *    armies near the contact join their side. The marching army attacks.
 * Supply, attrition and foraging: supply.ts. Sieges: siege.ts. Visibility: visibility.ts.
 */
import type {
  ArmyOrder,
  ArmyState,
  ArmyUnitState,
  Engagement,
  EngagementId,
  FactionId,
  SettlementState,
  SimEvent,
  TerrainQuery,
  UnitClass,
  Vec2,
  WorldState,
} from '../../core/types';
import { isRebelFaction } from '../../core/types';
import { nextWorldId, sortedKeys } from '../../core/ids';
import { facingOf } from '../../core/math';
import { BALANCE } from '../../data/balance';
import { FACTIONS } from '../../data/factions';
import { RULES } from '../../data/rules';
import { UNITS } from '../../data/units';
import { totalDays } from './seasons';
import { armiesHostile, atWarWith, notifyPlayer, stableKeys } from './state';
import {
  armySpeedMultiplier,
  isRoughTerrain,
  metersPerHourFromKmDay,
  planRoute,
  roadConditionFactor,
  segmentEdge,
  terrainFactor,
  weatherFactor,
} from './pathing';

// ---------------------------------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------------------------------

/** Make an army unit for a class at full strength. */
export function makeArmyUnit(world: { nextId: number }, unitClass: UnitClass, soldiersOverride?: number): ArmyUnitState {
  const def = UNITS[unitClass];
  const n = soldiersOverride ?? def.stats.menPerFormation;
  return {
    id: nextWorldId(world, 'unit'),
    unitClass,
    soldiers: n,
    maxSoldiers: def.stats.menPerFormation,
    experience: 0.1,
    morale: def.stats.baseMorale,
    fatigue: 0,
    equipment: 1,
    ammo: 1,
  };
}

/** Carried food capacity: soldiers x upkeepFood x 5 days + carts x 300 (DESIGN_SPEC §7.8). */
export function carriedCapacity(units: readonly ArmyUnitState[]): number {
  let cap = 0;
  for (const u of units) {
    cap += u.soldiers * UNITS[u.unitClass].stats.upkeepFood * RULES.supply.carriedRationDays;
    if (u.unitClass === 'supply_train') cap += u.soldiers * RULES.supply.cartLoad;
  }
  return cap;
}

/** Raw daily food need before the faction's supplyEfficiency (Σ soldiers x upkeepFood x soldierFoodPerDay). */
export function rawFoodNeed(units: readonly ArmyUnitState[]): number {
  let n = 0;
  for (const u of units) n += u.soldiers * UNITS[u.unitClass].stats.upkeepFood * BALANCE.military.soldierFoodPerDay;
  return n;
}

export function makeArmy(
  world: WorldState,
  id: string,
  name: string,
  factionId: FactionId,
  x: number,
  z: number,
  units: { unitClass: UnitClass; formations: number }[],
  commanderId: string | null,
): ArmyState {
  const unitStates: ArmyUnitState[] = [];
  for (const u of units) for (let i = 0; i < u.formations; i++) unitStates.push(makeArmyUnit(world, u.unitClass));
  const capacity = carriedCapacity(unitStates);
  return {
    id,
    name,
    factionId,
    commanderId,
    x,
    z,
    facing: 0,
    path: [],
    pathIndex: 0,
    order: { kind: 'idle' },
    stance: isRebelFaction(factionId) ? 'cautious' : 'balanced',
    status: 'camped',
    units: unitStates,
    supply: { food: capacity, foodCapacity: capacity, dailyConsumption: rawFoodNeed(unitStates), sourceId: null, lineIntact: true, foraging: false, starvationDays: 0 },
    morale: 70,
    fatigue: 0,
    speedKmh: 0,
    engagementId: null,
    visibility: {},
    createdDay: totalDays(world.calendar),
    forcedMarch: false,
  };
}

// ---------------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------------

export function armySoldiers(a: ArmyState): number {
  let n = 0;
  for (const u of a.units) n += u.soldiers;
  return n;
}

/** Rough combat power (for AI and predictions): soldiers x attack/defense x morale x hp. */
export function armyStrength(a: ArmyState): number {
  let p = 0;
  for (const u of a.units) {
    const s = UNITS[u.unitClass].stats;
    p += u.soldiers * (s.meleeAttack + s.meleeDefense + s.rangedAttack * 0.8 + s.chargeBonus * 0.3) * (s.hp / 10) * (0.5 + u.morale / 200) * (1 - u.fatigue * 0.3);
  }
  return p;
}

/** Faction-level hostility (wars). Rebel armies: use armiesHostile / hostileToArmy from state.ts. */
export function isHostile(world: WorldState, a: FactionId, b: FactionId): boolean {
  return atWarWith(world, a, b);
}

/** Current march speed (map m / hour) of an army on open ground (for evasion / pursuit comparisons). */
export function potentialSpeed(world: WorldState, a: ArmyState): number {
  return metersPerHourFromKmDay(BALANCE.military.marchKmPerDay.offroad) * armySpeedMultiplier(world, a, false);
}

// ---------------------------------------------------------------------------------------------------
// Orders & pathing
// ---------------------------------------------------------------------------------------------------

/** Plan waypoints from the army to (x, z): path[0] is the army's position (pathIndex starts at 1). */
export function planArmyPath(world: WorldState, army: ArmyState, x: number, z: number, terrain: TerrainQuery): Vec2[] {
  const b = terrain.bounds;
  const tx = Math.min(b.maxX - 50, Math.max(b.minX + 50, x));
  const tz = Math.min(b.maxZ - 50, Math.max(b.minZ + 50, z));
  return planRoute(world, army, army.x, army.z, tx, tz, terrain).points;
}

/** Where an order wants the army to go (null = stay). */
export function orderTarget(world: WorldState, a: ArmyState, order: ArmyOrder): Vec2 | null {
  switch (order.kind) {
    case 'move':
    case 'retreat':
      return { x: order.x, z: order.z };
    case 'attack_army': {
      const t = world.armies[order.targetArmyId];
      return t ? { x: t.x, z: t.z } : null;
    }
    case 'besiege':
    case 'assault':
    case 'raid': {
      const s = world.settlements[order.settlementId];
      if (!s) return null;
      // Camp outside the walls on the side facing the army.
      const dx = a.x - s.x;
      const dz = a.z - s.z;
      const d = Math.sqrt(dx * dx + dz * dz) || 1;
      const r = s.radius + SIEGE_CAMP_OFFSET;
      return { x: s.x + (dx / d) * r, z: s.z + (dz / d) * r };
    }
    case 'garrison': {
      const s = world.settlements[order.settlementId];
      return s ? { x: s.x, z: s.z } : null;
    }
    case 'escort': {
      const d = world.depots[order.depotId];
      return d ? { x: d.x, z: d.z } : null;
    }
    case 'patrol':
      return order.points[0] ? { x: order.points[0].x, z: order.points[0].z } : null;
    case 'resupply': {
      const src = resupplyTarget(world, a, order.sourceId);
      return src;
    }
    default:
      return null;
  }
}

/** Camp distance outside a settlement's radius for besiegers / raiders (map m). */
export const SIEGE_CAMP_OFFSET = 100;

function resupplyTarget(world: WorldState, a: ArmyState, sourceId: string | null): Vec2 | null {
  if (sourceId) {
    const s = world.settlements[sourceId];
    if (s && s.ownerFactionId === a.factionId) return { x: s.x, z: s.z };
    const d = world.depots[sourceId];
    if (d && d.factionId === a.factionId) return { x: d.x, z: d.z };
    return null;
  }
  let best: Vec2 | null = null;
  let bd = Infinity;
  for (const id of sortedKeys(world.settlements)) {
    const s = world.settlements[id]!;
    if (s.ownerFactionId !== a.factionId || s.besiegedBy) continue;
    const d = (s.x - a.x) * (s.x - a.x) + (s.z - a.z) * (s.z - a.z);
    if (d < bd) {
      bd = d;
      best = { x: s.x, z: s.z };
    }
  }
  for (const id of sortedKeys(world.depots)) {
    const dp = world.depots[id]!;
    if (dp.factionId !== a.factionId || dp.food <= 0) continue;
    const d = (dp.x - a.x) * (dp.x - a.x) + (dp.z - a.z) * (dp.z - a.z);
    if (d < bd) {
      bd = d;
      best = { x: dp.x, z: dp.z };
    }
  }
  return best;
}

let siegeHooks: { lift: (world: WorldState, army: ArmyState) => void } | null = null;
/** siege.ts registers how an army leaves a siege (avoids an import cycle). */
export function registerSiegeHooks(h: NonNullable<typeof siegeHooks>): void {
  siegeHooks = h;
}

/** Give an army an order: plans the route and sets the status. Returns false for unknown / engaged armies. */
export function orderArmy(world: WorldState, armyId: string, order: ArmyOrder, terrain: TerrainQuery): boolean {
  const a = world.armies[armyId];
  if (!a || a.status === 'in_battle' || a.engagementId) return false;
  const keepSiege = a.status === 'besieging' && (order.kind === 'besiege' || order.kind === 'assault') && a.order.kind !== 'idle' && 'settlementId' in a.order && a.order.settlementId === order.settlementId;
  if (a.status === 'besieging' && !keepSiege) siegeHooks?.lift(world, a);
  if (a.order.kind === 'escort') {
    const d = world.depots[a.order.depotId];
    if (d && d.escortArmyId === a.id) d.escortArmyId = null;
  }
  a.order = order;
  a.supply.foraging = order.kind === 'forage';
  if (keepSiege) return true;
  const target = orderTarget(world, a, order);
  if (target && (Math.abs(target.x - a.x) > 1 || Math.abs(target.z - a.z) > 1)) {
    a.path = planArmyPath(world, a, target.x, target.z, terrain);
    a.pathIndex = a.path.length > 1 ? 1 : 0;
    a.status = 'marching';
  } else if (target) {
    // Already there: a zero-length march arrives on the next hourly update (arrival effects need the event sink).
    a.path = [{ x: a.x, z: a.z }];
    a.pathIndex = 1;
    a.status = 'marching';
  } else {
    a.path = [];
    a.pathIndex = 0;
    a.status = 'camped';
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------
// Hourly movement + arrivals + contacts
// ---------------------------------------------------------------------------------------------------

/** Advance one marching army by one hour along its path. Returns true when it arrived. */
function advance(world: WorldState, a: ArmyState, terrain: TerrainQuery): boolean {
  let remaining = 1;
  let lastMph = 0;
  const mul = armySpeedMultiplier(world, a, false);
  while (remaining > 1e-9 && a.pathIndex < a.path.length) {
    const wp = a.path[a.pathIndex] as Vec2;
    const edge = segmentEdge(world, a.path, a.pathIndex);
    let mph: number;
    if (edge) {
      mph = metersPerHourFromKmDay(BALANCE.military.marchKmPerDay[edge.quality]) * weatherFactor(world, edge.quality) * roadConditionFactor(edge.condition) * mul;
    } else {
      const tc = terrain.inBounds(a.x, a.z) ? terrain.terrainClassAt(a.x, a.z) : 'open';
      let f = terrainFactor(world, a.factionId, tc);
      if (f <= 0) f = 0.4; // crossing at a bridge / ford
      const rough = isRoughTerrain(tc);
      mph = metersPerHourFromKmDay(BALANCE.military.marchKmPerDay.offroad) * weatherFactor(world, null) * f * (rough ? armySpeedMultiplier(world, a, true) : mul);
    }
    lastMph = mph;
    const dx = wp.x - a.x;
    const dz = wp.z - a.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 0.01) a.facing = facingOf(dx, dz);
    const t = mph > 0 ? d / mph : Infinity;
    if (t <= remaining) {
      a.x = wp.x;
      a.z = wp.z;
      remaining -= t;
      a.pathIndex++;
    } else {
      a.x += (dx / d) * mph * remaining;
      a.z += (dz / d) * mph * remaining;
      remaining = 0;
    }
  }
  a.speedKmh = (lastMph * BALANCE.military.travelScale) / 1000;
  return a.pathIndex >= a.path.length;
}

let arrivalHooks: { besiege: (world: WorldState, a: ArmyState, s: SettlementState, out: SimEvent[], terrain: TerrainQuery) => void; assault: (world: WorldState, a: ArmyState, out: SimEvent[], terrain: TerrainQuery) => void } | null = null;
/** siege.ts registers siege start / assault handlers. */
export function registerArrivalHooks(h: NonNullable<typeof arrivalHooks>): void {
  arrivalHooks = h;
}

function arrive(world: WorldState, a: ArmyState, out: SimEvent[], terrain: TerrainQuery): void {
  a.path = [];
  a.pathIndex = 0;
  a.status = 'camped';
  const o = a.order;
  switch (o.kind) {
    case 'move':
    case 'retreat':
      a.order = { kind: 'idle' };
      out.push({ kind: 'army_arrived', armyId: a.id });
      break;
    case 'garrison': {
      const s = world.settlements[o.settlementId];
      if (s && s.ownerFactionId === a.factionId) {
        a.status = 'garrisoned';
        a.x = s.x;
        a.z = s.z;
      } else a.order = { kind: 'idle' };
      out.push({ kind: 'army_arrived', armyId: a.id });
      break;
    }
    case 'besiege': {
      const s = world.settlements[o.settlementId];
      if (s && arrivalHooks) arrivalHooks.besiege(world, a, s, out, terrain);
      else a.order = { kind: 'idle' };
      break;
    }
    case 'assault':
      if (arrivalHooks) arrivalHooks.assault(world, a, out, terrain);
      break;
    case 'raid':
      a.supply.foraging = true;
      out.push({ kind: 'army_arrived', armyId: a.id });
      break;
    case 'escort': {
      const d = world.depots[o.depotId];
      if (d && d.factionId === a.factionId) d.escortArmyId = a.id;
      break;
    }
    case 'patrol': {
      if (o.points.length > 1) {
        const first = o.points.shift() as Vec2;
        o.points.push(first);
        const next = o.points[0] as Vec2;
        a.path = planArmyPath(world, a, next.x, next.z, terrain);
        a.pathIndex = a.path.length > 1 ? 1 : 0;
        a.status = 'marching';
      }
      break;
    }
    case 'attack_army': {
      const t = world.armies[o.targetArmyId];
      if (!t) a.order = { kind: 'idle' };
      break;
    }
    case 'resupply':
      out.push({ kind: 'army_arrived', armyId: a.id });
      break;
    default:
      break;
  }
}

/** Re-plan pursuit of a moving target every 6 hours. */
function followTarget(world: WorldState, a: ArmyState, terrain: TerrainQuery): void {
  if (a.order.kind !== 'attack_army') return;
  const t = world.armies[a.order.targetArmyId];
  if (!t || t.units.length === 0 || (t.factionId !== a.factionId && !armiesHostile(world, a, t))) {
    a.order = { kind: 'idle' };
    a.status = a.status === 'marching' ? 'camped' : a.status;
    a.path = [];
    a.pathIndex = 0;
    return;
  }
  if (world.calendar.totalHours % 6 !== 0) return;
  const end = a.path[a.path.length - 1];
  if (end && (end.x - t.x) * (end.x - t.x) + (end.z - t.z) * (end.z - t.z) < 100 * 100 && a.status === 'marching') return;
  a.path = planArmyPath(world, a, t.x, t.z, terrain);
  a.pathIndex = a.path.length > 1 ? 1 : 0;
  a.status = 'marching';
}

export function updateArmiesHourly(world: WorldState, out: SimEvent[], terrain: TerrainQuery): void {
  const ids = stableKeys('armies', world.armies as Record<string, unknown>);
  for (let i = 0; i < ids.length; i++) {
    const a = world.armies[ids[i] as string];
    if (!a || a.engagementId) continue;
    if (a.order.kind === 'attack_army') followTarget(world, a, terrain);
    if (a.order.kind === 'assault' && a.status === 'besieging') {
      arrivalHooks?.assault(world, a, out, terrain);
      continue;
    }
    if (a.status !== 'marching') continue;
    if (a.pathIndex >= a.path.length || advance(world, a, terrain)) arrive(world, a, out, terrain);
  }
  detectContacts(world, out, terrain);
}

// ---------------------------------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------------------------------

function contactRadius(a: ArmyState): number {
  return BALANCE.military.contactRadius * RULES.armies.stance[a.stance].contactRadius;
}

function behindWalls(world: WorldState, a: ArmyState): boolean {
  if (a.status !== 'garrisoned' || a.order.kind !== 'garrison') return false;
  const s = world.settlements[a.order.settlementId];
  return !!s && s.fortLevel >= 1;
}

function evades(world: WorldState, a: ArmyState, b: ArmyState): boolean {
  if (a.stance !== 'cautious') return false;
  const sa = armyStrength(a);
  const sb = armyStrength(b);
  return sb > 0 && sa / sb < 0.6 && potentialSpeed(world, a) >= 1.1 * potentialSpeed(world, b);
}

/** Hours after a battle during which the same two armies do not re-engage (they disengage and regroup). */
export const REENGAGE_COOLDOWN_HOURS = 24;

/** Did these two armies fight each other within the cooldown? (derived from resolved engagements - save-safe) */
export function recentlyFought(world: WorldState, a: string, b: string): boolean {
  const now = world.calendar.totalHours;
  for (const id in world.engagements) {
    const e = world.engagements[id]!;
    if (e.status !== 'resolved' || now - e.startedHour > REENGAGE_COOLDOWN_HOURS) continue;
    const inA = e.sides[0].includes(a) || e.sides[1].includes(a);
    const inB = e.sides[0].includes(b) || e.sides[1].includes(b);
    if (inA && inB) return true;
  }
  return false;
}

/** Create engagements for hostile armies in contact range. */
export function detectContacts(world: WorldState, out: SimEvent[], terrain?: TerrainQuery): void {
  const ids = stableKeys('armies', world.armies as Record<string, unknown>);
  for (let i = 0; i < ids.length; i++) {
    const a = world.armies[ids[i] as string];
    if (!a || a.engagementId || a.status === 'in_battle' || a.units.length === 0 || behindWalls(world, a)) continue;
    for (let j = i + 1; j < ids.length; j++) {
      const b = world.armies[ids[j] as string];
      if (!b || b.engagementId || b.status === 'in_battle' || b.units.length === 0 || behindWalls(world, b)) continue;
      if (!armiesHostile(world, a, b)) continue;
      const r = Math.max(contactRadius(a), contactRadius(b));
      const dx = a.x - b.x;
      const dz = a.z - b.z;
      if (dx * dx + dz * dz > r * r) continue;
      // Retreating armies are only caught by an enemy at least 20% faster.
      if (a.order.kind === 'retreat' && potentialSpeed(world, b) < 1.2 * potentialSpeed(world, a)) continue;
      if (b.order.kind === 'retreat' && potentialSpeed(world, a) < 1.2 * potentialSpeed(world, b)) continue;
      if (evades(world, a, b) || evades(world, b, a)) continue;
      if (recentlyFought(world, a.id, b.id)) continue;
      const [att, def] = b.status === 'marching' && a.status !== 'marching' ? [b, a] : [a, b];
      createEngagement(world, att, def, out, terrain ?? null, 'field', null);
      break;
    }
  }
}

/**
 * Open an engagement between two armies (plus same-faction armies near the contact). Siege assaults pass kind
 * 'siege' and the settlement. Player involvement -> 'pending_player' (the world pauses on the prompt), else 'auto'.
 */
export function createEngagement(world: WorldState, att: ArmyState, def: ArmyState, out: SimEvent[], terrain: TerrainQuery | null, kind: Engagement['kind'], settlementId: string | null): Engagement {
  const id: EngagementId = nextWorldId(world, 'eng');
  const x = (att.x + def.x) / 2;
  const z = (att.z + def.z) / 2;
  const join = (lead: ArmyState): string[] => {
    const list = [lead.id];
    const r = contactRadius(lead) * 2;
    for (const oid of sortedKeys(world.armies)) {
      const o = world.armies[oid]!;
      if (o.id === lead.id || o.factionId !== lead.factionId || o.engagementId || o.units.length === 0 || o.status === 'in_battle') continue;
      if (isRebelFaction(o.factionId) && o.rebelSettlementId !== lead.rebelSettlementId) continue;
      if (kind !== 'siege' && behindWalls(world, o)) continue;
      if ((o.x - x) * (o.x - x) + (o.z - z) * (o.z - z) <= r * r) list.push(o.id);
    }
    return list;
  };
  const sides: [string[], string[]] = [join(att), join(def)];
  let eKind = kind;
  if (eKind === 'field' && terrain && terrain.riverDistanceAt(x, z) < 150) eKind = 'river_crossing';
  let near: string | null = settlementId;
  if (!near) {
    let bd = Infinity;
    for (const sid of sortedKeys(world.settlements)) {
      const s = world.settlements[sid]!;
      const d = Math.sqrt((s.x - x) * (s.x - x) + (s.z - z) * (s.z - z));
      if (d <= s.radius + 300 && d < bd) {
        bd = d;
        near = sid;
      }
    }
  }
  const involvesPlayer = [...sides[0], ...sides[1]].some((aid) => world.factions[world.armies[aid]!.factionId]?.isPlayer === true);
  const e: Engagement = {
    id,
    sides,
    x,
    z,
    settlementId: near,
    kind: eKind,
    startedHour: world.calendar.totalHours,
    status: involvesPlayer ? 'pending_player' : 'auto',
    battleId: null,
    battle: null,
    outcome: null,
    prisonerDecision: null,
  };
  world.engagements[id] = e;
  for (const side of sides) {
    for (const aid of side) {
      const a = world.armies[aid]!;
      a.engagementId = id;
      a.status = 'in_battle';
    }
  }
  out.push({ kind: 'engagement_started', engagementId: id, involvesPlayer });
  return e;
}

// ---------------------------------------------------------------------------------------------------
// Split / merge / disband (DESIGN_SPEC §7.7)
// ---------------------------------------------------------------------------------------------------

export const ARMY_REASONS = {
  noArmy: 'No such army',
  notYours: 'Not your army',
  inBattle: 'Army is in battle',
  noUnits: 'Choose the formations to split off',
  keepOne: 'At least one formation must stay',
  unknownUnit: 'That formation is not in this army',
  tooFar: 'The armies must be within 100 m to merge',
  sameArmy: 'Choose another army',
  tooMany: `An army holds at most ${RULES.armies.maxFormations} formations`,
} as const;

export const MERGE_DISTANCE = 100;

export function validateSplit(world: WorldState, factionId: FactionId, armyId: string, unitIds: readonly string[]): string | null {
  const a = world.armies[armyId];
  if (!a) return ARMY_REASONS.noArmy;
  if (a.factionId !== factionId) return ARMY_REASONS.notYours;
  if (a.engagementId || a.status === 'in_battle') return ARMY_REASONS.inBattle;
  if (unitIds.length === 0) return ARMY_REASONS.noUnits;
  for (const u of unitIds) if (!a.units.some((x) => x.id === u)) return ARMY_REASONS.unknownUnit;
  if (unitIds.length >= a.units.length) return ARMY_REASONS.keepOne;
  return null;
}

/** Split selected formations into a new army (commander slot empty; supply split by food need). */
export function splitArmy(world: WorldState, factionId: FactionId, armyId: string, unitIds: readonly string[]): { reason: string | null; armyId: string | null } {
  const reason = validateSplit(world, factionId, armyId, unitIds);
  if (reason) return { reason, armyId: null };
  const a = world.armies[armyId]!;
  const moving = a.units.filter((u) => unitIds.includes(u.id));
  const share = rawFoodNeed(moving) / Math.max(1e-9, rawFoodNeed(a.units));
  const id = nextWorldId(world, 'army');
  const b = makeArmy(world, id, `${a.name} (detachment)`, a.factionId, a.x + 20, a.z + 20, [], null);
  b.units = moving;
  a.units = a.units.filter((u) => !unitIds.includes(u.id));
  b.supply.food = a.supply.food * share;
  a.supply.food -= b.supply.food;
  b.morale = a.morale;
  b.fatigue = a.fatigue;
  b.stance = a.stance;
  b.supply.foodCapacity = carriedCapacity(b.units);
  a.supply.foodCapacity = carriedCapacity(a.units);
  world.armies[id] = b;
  return { reason: null, armyId: id };
}

export function validateMerge(world: WorldState, factionId: FactionId, armyId: string, otherId: string): string | null {
  const a = world.armies[armyId];
  const b = world.armies[otherId];
  if (!a || !b) return ARMY_REASONS.noArmy;
  if (a.factionId !== factionId || b.factionId !== factionId) return ARMY_REASONS.notYours;
  if (a.id === b.id) return ARMY_REASONS.sameArmy;
  if (a.engagementId || b.engagementId || a.status === 'in_battle' || b.status === 'in_battle') return ARMY_REASONS.inBattle;
  if ((a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z) > MERGE_DISTANCE * MERGE_DISTANCE) return ARMY_REASONS.tooFar;
  if (a.units.length + b.units.length > RULES.armies.maxFormations) return ARMY_REASONS.tooMany;
  return null;
}

/** Merge `otherId` into `armyId` (units, food, soldier-weighted morale / fatigue; commander kept if set). */
export function mergeArmies(world: WorldState, factionId: FactionId, armyId: string, otherId: string): string | null {
  const reason = validateMerge(world, factionId, armyId, otherId);
  if (reason) return reason;
  const a = world.armies[armyId]!;
  const b = world.armies[otherId]!;
  const sa = armySoldiers(a);
  const sb = armySoldiers(b);
  const w = sa + sb > 0 ? sb / (sa + sb) : 0;
  a.morale = a.morale * (1 - w) + b.morale * w;
  a.fatigue = a.fatigue * (1 - w) + b.fatigue * w;
  a.units.push(...b.units);
  a.supply.food += b.supply.food;
  a.supply.foodCapacity = carriedCapacity(a.units);
  if (!a.commanderId && b.commanderId) {
    a.commanderId = b.commanderId;
    const c = world.characters[b.commanderId];
    if (c) c.armyId = a.id;
  }
  delete world.armies[b.id];
  return null;
}

/** Disband: 50% of the soldiers return to the nearest own settlement's recruit pool. */
export function disbandArmy(world: WorldState, factionId: FactionId, armyId: string, out: SimEvent[]): string | null {
  const a = world.armies[armyId];
  if (!a) return ARMY_REASONS.noArmy;
  if (a.factionId !== factionId) return ARMY_REASONS.notYours;
  if (a.engagementId || a.status === 'in_battle') return ARMY_REASONS.inBattle;
  removeArmy(world, a, true);
  notifyPlayer(world, out, factionId, 'info', `${a.name} was disbanded.`);
  return null;
}

/** Remove an army (destroyed or disbanded); returns soldiers to a recruit pool when `returnRecruits`. */
export function removeArmy(world: WorldState, a: ArmyState, returnRecruits: boolean): void {
  if (returnRecruits) {
    let best: SettlementState | null = null;
    let bd = Infinity;
    for (const id of sortedKeys(world.settlements)) {
      const s = world.settlements[id]!;
      if (s.ownerFactionId !== a.factionId) continue;
      const d = (s.x - a.x) * (s.x - a.x) + (s.z - a.z) * (s.z - a.z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    if (best) best.recruitPool = Math.min(best.recruitmentPotential, best.recruitPool + 0.5 * armySoldiers(a));
  }
  if (a.commanderId) {
    const c = world.characters[a.commanderId];
    if (c && c.armyId === a.id) c.armyId = null;
  }
  for (const id of sortedKeys(world.settlements)) {
    const s = world.settlements[id]!;
    if (s.besiegedBy === a.id) {
      s.besiegedBy = null;
      s.siegeDays = 0;
      s.ladderProgress = 0;
    }
    if (s.rallyPoint?.kind === 'army' && s.rallyPoint.armyId === a.id) delete s.rallyPoint;
  }
  for (const id of sortedKeys(world.depots)) if (world.depots[id]!.escortArmyId === a.id) world.depots[id]!.escortArmyId = null;
  for (const id of sortedKeys(world.roads.edges)) if (world.roads.edges[id]!.blockedBy === a.id) world.roads.edges[id]!.blockedBy = null;
  delete world.armies[a.id];
}

/** Army display name with the faction variant naming convention ("Rebels of {settlement}"). */
export function armyDisplayName(world: WorldState, a: ArmyState): string {
  if (isRebelFaction(a.factionId)) return a.name;
  return a.name || `${FACTIONS[a.factionId]?.adjective ?? a.factionId} Host`;
}

// Supply / daily systems and the battle write-back live in their own modules (re-exported for existing callers).
export { updateArmiesDaily } from './supply';
export { applyBattleOutcome } from './writeback';
