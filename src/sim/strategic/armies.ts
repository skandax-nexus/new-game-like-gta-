/**
 * Strategic armies: creation, orders, pathing, movement, supply, contact -> engagements, applying
 * battle outcomes. OWNER: Lead AI & Simulation Engineer. Baseline by the CTO.
 *
 * Required behavior:
 *  - planArmyPath: A* over world.roads (edge cost = length / quality speed / condition, blocked edges
 *    excluded) + off-road legs to/from the nearest nodes; straight-line fallback.
 *  - Movement per hour: speed = marchKmPerDay[road quality|offroad] * 1000 / 24 / travelScale map-m/h,
 *    x travelFactor (season/weather/terrain), x faction marchSpeed, slowest unit class.
 *  - Supply (daily): consume food = soldiers x upkeepFood; resupply from own settlements/depots within
 *    reach when the line is intact; forage (reduces local settlement food -> unrest) when allowed;
 *    starvation -> morale loss, desertion.
 *  - Contacts: hostile armies within BALANCE.military.contactRadius create an Engagement (player
 *    involved -> 'pending_player', else 'auto'). Sieges when ordered to besiege an enemy settlement.
 *  - applyBattleOutcome: write casualties back to ArmyUnitState by armyUnitId, morale/experience,
 *    routed armies retreat toward the nearest friendly settlement, commander fates, captured supply.
 */
import type {
  ArmyOrder,
  ArmyState,
  ArmyUnitState,
  BattleOutcome,
  Engagement,
  EngagementId,
  FactionId,
  SimEvent,
  TerrainQuery,
  UnitClass,
  Vec2,
  WorldState,
} from '../../core/types';
import { nextWorldId, relationKey, sortedKeys } from '../../core/ids';
import { facingOf } from '../../core/math';
import { BALANCE } from '../../data/balance';
import { FACTIONS } from '../../data/factions';
import { UNITS } from '../../data/units';
import { seasonOf, totalDays, travelFactor } from './seasons';

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
  const soldiers = unitStates.reduce((s, u) => s + u.soldiers, 0);
  const carts = unitStates.filter((u) => u.unitClass === 'supply_train').reduce((s, u) => s + u.soldiers, 0);
  const capacity = soldiers * 10 + carts * UNITS.supply_train.stats.supplyCapacity;
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
    stance: 'balanced',
    status: 'camped',
    units: unitStates,
    supply: { food: capacity * 0.8, foodCapacity: capacity, dailyConsumption: soldiers, sourceId: null, lineIntact: true, foraging: false, starvationDays: 0 },
    morale: 70,
    fatigue: 0,
    speedKmh: 1,
    engagementId: null,
    visibility: {},
    createdDay: totalDays(world.calendar),
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

export function isHostile(world: WorldState, a: FactionId, b: FactionId): boolean {
  if (a === b) return false;
  return world.diplomacy.relations[relationKey(a, b)]?.atWar ?? false;
}

// ---------------------------------------------------------------------------------------------------
// Orders & pathing
// ---------------------------------------------------------------------------------------------------

/** Plan waypoints from the army to (x, z). Baseline: straight line. TODO(owner): road-graph A*. */
export function planArmyPath(world: WorldState, army: ArmyState, x: number, z: number, terrain: TerrainQuery): Vec2[] {
  void world;
  const b = terrain.bounds;
  const tx = Math.min(b.maxX - 50, Math.max(b.minX + 50, x));
  const tz = Math.min(b.maxZ - 50, Math.max(b.minZ + 50, z));
  void army;
  return [{ x: tx, z: tz }];
}

export function orderArmy(world: WorldState, armyId: string, order: ArmyOrder, terrain: TerrainQuery): boolean {
  const a = world.armies[armyId];
  if (!a || a.status === 'in_battle') return false;
  a.order = order;
  let target: Vec2 | null = null;
  switch (order.kind) {
    case 'move':
    case 'retreat':
      target = { x: order.x, z: order.z };
      break;
    case 'attack_army': {
      const t = world.armies[order.targetArmyId];
      if (t) target = { x: t.x, z: t.z };
      break;
    }
    case 'besiege':
    case 'garrison':
    case 'raid': {
      const s = world.settlements[order.settlementId];
      if (s) target = { x: s.x, z: s.z };
      break;
    }
    default:
      break;
  }
  if (target) {
    a.path = planArmyPath(world, a, target.x, target.z, terrain);
    a.pathIndex = 0;
    a.status = 'marching';
  } else {
    a.path = [];
    a.status = 'camped';
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------
// Hourly movement + contacts
// ---------------------------------------------------------------------------------------------------

function slowestWalk(a: ArmyState): number {
  let s = Infinity;
  for (const u of a.units) s = Math.min(s, UNITS[u.unitClass].stats.walkSpeed);
  return s === Infinity ? 1.4 : s;
}

export function updateArmiesHourly(world: WorldState, out: SimEvent[], terrain: TerrainQuery): void {
  const m = BALANCE.military;
  const season = seasonOf(world.calendar);
  for (const id of sortedKeys(world.armies)) {
    const a = world.armies[id] as ArmyState;
    if (a.status !== 'marching' || a.pathIndex >= a.path.length) continue;
    const tc = terrain.terrainClassAt(a.x, a.z);
    const factor = travelFactor(season, world.weather, tc, null) * (FACTIONS[a.factionId]?.modifiers.marchSpeed ?? 1) * (slowestWalk(a) / 1.4);
    const metersPerHour = ((m.marchKmPerDay.offroad * 1000) / 24 / m.travelScale) * factor;
    a.speedKmh = (metersPerHour * m.travelScale) / 1000;
    let remaining = metersPerHour;
    while (remaining > 0 && a.pathIndex < a.path.length) {
      const wp = a.path[a.pathIndex] as Vec2;
      const dx = wp.x - a.x;
      const dz = wp.z - a.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > 0.01) a.facing = facingOf(dx, dz);
      if (d <= remaining) {
        a.x = wp.x;
        a.z = wp.z;
        remaining -= d;
        a.pathIndex++;
      } else {
        a.x += (dx / d) * remaining;
        a.z += (dz / d) * remaining;
        remaining = 0;
      }
    }
    if (a.pathIndex >= a.path.length) {
      a.status = 'camped';
      a.path = [];
      a.pathIndex = 0;
      if (a.order.kind === 'move' || a.order.kind === 'retreat') a.order = { kind: 'idle' };
      out.push({ kind: 'army_arrived', armyId: a.id });
    }
  }
  detectContacts(world, out);
}

/** Create engagements for hostile armies in contact range. */
export function detectContacts(world: WorldState, out: SimEvent[]): void {
  const r2 = BALANCE.military.contactRadius * BALANCE.military.contactRadius;
  const ids = sortedKeys(world.armies);
  for (let i = 0; i < ids.length; i++) {
    const a = world.armies[ids[i] as string] as ArmyState;
    if (a.engagementId || a.status === 'in_battle' || a.units.length === 0) continue;
    for (let j = i + 1; j < ids.length; j++) {
      const b = world.armies[ids[j] as string] as ArmyState;
      if (b.engagementId || b.status === 'in_battle' || b.units.length === 0) continue;
      // Retreating armies break contact (baseline; TODO(owner): pursuit by faster armies).
      if (a.order.kind === 'retreat' || b.order.kind === 'retreat') continue;
      if (!isHostile(world, a.factionId, b.factionId)) continue;
      const dx = a.x - b.x;
      const dz = a.z - b.z;
      if (dx * dx + dz * dz > r2) continue;
      // Attacker = the one that was marching (or a).
      const [att, def] = b.status === 'marching' && a.status !== 'marching' ? [b, a] : [a, b];
      const id: EngagementId = nextWorldId(world, 'eng');
      const involvesPlayer = world.factions[att.factionId]?.isPlayer || world.factions[def.factionId]?.isPlayer || false;
      const e: Engagement = {
        id,
        sides: [[att.id], [def.id]],
        x: (a.x + b.x) / 2,
        z: (a.z + b.z) / 2,
        settlementId: null,
        kind: 'field',
        startedHour: world.calendar.totalHours,
        status: involvesPlayer ? 'pending_player' : 'auto',
        battleId: null,
        battle: null,
        outcome: null,
      };
      world.engagements[id] = e;
      a.engagementId = id;
      b.engagementId = id;
      a.status = 'in_battle';
      b.status = 'in_battle';
      out.push({ kind: 'engagement_started', engagementId: id, involvesPlayer: !!involvesPlayer });
      break;
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// Daily supply
// ---------------------------------------------------------------------------------------------------

export function updateArmiesDaily(world: WorldState, out: SimEvent[]): void {
  const m = BALANCE.military;
  for (const id of sortedKeys(world.armies)) {
    const a = world.armies[id] as ArmyState;
    let need = 0;
    for (const u of a.units) need += u.soldiers * UNITS[u.unitClass].stats.upkeepFood * m.soldierFoodPerDay;
    a.supply.dailyConsumption = need;
    // Resupply from an owned settlement nearby.
    let resupplied = false;
    for (const sid of sortedKeys(world.settlements)) {
      const s = world.settlements[sid]!;
      if (s.ownerFactionId !== a.factionId) continue;
      const dx = s.x - a.x;
      const dz = s.z - a.z;
      if (dx * dx + dz * dz > (s.radius + 400) * (s.radius + 400)) continue;
      const want = Math.max(0, a.supply.foodCapacity - a.supply.food);
      const give = Math.min(want, s.foodStored * 0.2);
      s.foodStored -= give;
      a.supply.food += give;
      a.supply.sourceId = s.id;
      resupplied = true;
      break;
    }
    a.supply.lineIntact = resupplied || a.supply.lineIntact;
    a.supply.food -= need;
    if (a.supply.food < 0) {
      a.supply.food = 0;
      a.supply.starvationDays++;
      a.morale = Math.max(0, a.morale - m.starvationMoralePerDay);
      out.push({ kind: 'army_starving', armyId: a.id });
    } else {
      a.supply.starvationDays = 0;
      const days = need > 0 ? a.supply.food / need : Infinity;
      if (days < 5 && world.factions[a.factionId]?.isPlayer) out.push({ kind: 'army_supply_low', armyId: a.id, days: Math.floor(days) });
    }
    if (a.status === 'marching') a.fatigue = Math.min(1, a.fatigue + m.fatiguePerMarchDay);
    else a.fatigue = Math.max(0, a.fatigue - m.recoveryPerRestDay);
  }
}

// ---------------------------------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------------------------------

/** Apply a battle outcome to the armies of an engagement (casualties by armyUnitId, retreat). */
export function applyBattleOutcome(world: WorldState, engagementId: EngagementId, outcome: BattleOutcome, out: SimEvent[]): void {
  const e = world.engagements[engagementId];
  if (!e) return;
  e.outcome = outcome;
  e.status = 'resolved';
  for (let side = 0; side < 2; side++) {
    const res = outcome.sides[side as 0 | 1];
    const byUnit = new Map<string, number>();
    for (const f of res.formations) if (f.armyUnitId) byUnit.set(f.armyUnitId, (byUnit.get(f.armyUnitId) ?? 0) + f.survivors);
    for (const armyId of e.sides[side as 0 | 1]) {
      const a = world.armies[armyId];
      if (!a) continue;
      for (const u of a.units) {
        const surv = byUnit.get(u.id);
        if (surv !== undefined) u.soldiers = Math.max(0, Math.min(u.soldiers, surv));
      }
      a.units = a.units.filter((u) => u.soldiers > 0);
      a.engagementId = null;
      a.status = 'camped';
      const won = outcome.winner === side;
      // On a draw the attacker (side 0) falls back so the armies do not re-engage immediately.
      const fallsBack = outcome.winner === null ? side === 0 : !won;
      a.morale = Math.max(5, Math.min(100, a.morale + (won ? 10 : -25)));
      if (a.units.length === 0) {
        delete world.armies[a.id];
        continue;
      }
      if (fallsBack) {
        // Retreat toward the nearest friendly settlement.
        let best: { x: number; z: number } | null = null;
        let bestD = Infinity;
        for (const s of Object.values(world.settlements)) {
          if (s.ownerFactionId !== a.factionId) continue;
          const d = (s.x - a.x) * (s.x - a.x) + (s.z - a.z) * (s.z - a.z);
          if (d < bestD) {
            bestD = d;
            best = s;
          }
        }
        if (best) {
          a.order = { kind: 'retreat', x: best.x, z: best.z };
          a.path = [{ x: best.x + 80, z: best.z + 80 }];
          a.pathIndex = 0;
          a.status = 'marching';
        }
      }
    }
  }
  const winnerFaction = outcome.winner === null ? null : outcome.sides[outcome.winner].factionId;
  out.push({ kind: 'engagement_resolved', engagementId, winnerFactionId: winnerFaction });
}
