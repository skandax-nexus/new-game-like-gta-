/**
 * Army supply, foraging, attrition, depots and requisition (DESIGN_SPEC §7.8). OWNER: Simulation Engineer - Strategic
 * World Simulation (SIM-01).
 *
 *   consumption/day = Σ soldiers x upkeepFood x soldierFoodPerDay / faction supplyEfficiency
 *   carried         = Σ soldiers x upkeepFood x 5 days + carts x 300
 * Resupply each day, first match: (1) an own, unbesieged settlement within 400 m + its radius gives up to 20% of its
 * store, never below 30 days; (2) an own, ready depot within 400 m; (3) the royal reserve through a supply line - the
 * army stands in an owned (or military-access) province and roads through owned / neutral settlements with no enemy
 * army within 300 m connect it to an own settlement; deliveries lose 10% per 30 km (lineIntact). Otherwise (or on a
 * forage / raid order) it forages need x 0.35 x fertility x season from the nearest settlement within 600 m: own land
 * -> unrest +0.004/day and loyalty -0.002/day there; enemy / independent -> plunder x1.7, damage +0.01/day, a `raid`
 * grievance. Starvation: morale -6/day, desertion 1%/day after 3 days and 3%/day after 10. Attrition: monsoon
 * off-road 0.2%, hills/forest off-road 0.1%, dry plain in grishma away from settlements 0.3%, besieging 0.4%, forced
 * march 0.2%. Debt: morale -2/day and 0.5%/day desertion. Losses use stochastic rounding from the world RNG.
 */
import type { ArmyState, DepotId, FactionId, RoadEdge, SettlementState, SimEvent, SupplyDepotState, TerrainQuery, WorldState } from '../../core/types';
import { isRebelFaction } from '../../core/types';
import { nextWorldId, sortedKeys } from '../../core/ids';
import { getHeightfield } from '../../core/terrain/cache';
import { BALANCE } from '../../data/balance';
import { RULES } from '../../data/rules';
import { carriedCapacity, rawFoodNeed, removeArmy } from './armies';
import { factionMod } from './modifiers';
import { distanceToEdge, nearestNode, provinceAtPoint } from './network';
import { seasonOf } from './seasons';
import { activeTreaty, relationOf } from './treaties';
import { addMonthToDate, addStat, atWarWith, hostileToArmy, notifyPlayer, today, worldRandom } from './state';

const SUP = RULES.supply;
/** An enemy army within this distance of a road breaks the supply line along it. */
export const SUPPLY_LINE_THREAT = 300;
/** Daily convoy from the royal reserve: at most this many days of the army's need. */
export const RESERVE_CONVOY_DAYS = 3;
/** Map meters from a road polyline within which an army counts as on the road (attrition). */
const ON_ROAD = 60;

export const SUPPLY_REASONS = {
  noSettlement: 'No such settlement',
  notOwned: 'Not your settlement',
  badAmount: 'Choose an amount above zero',
  tooMuch: (n: number) => `At most ${Math.floor(n)} grain can be requisitioned (60% of the store)`,
  noTarget: 'No such army or depot',
  notYourTarget: 'That army or depot is not yours',
  tooFar: 'Too far away - bring them within 600 m',
  noReserve: (n: number) => `Need ${Math.ceil(n)} grain in the royal reserve`,
  noWealth: (n: number) => `Need ${Math.ceil(n)} wealth`,
  noTimber: (n: number) => `Need ${Math.ceil(n)} timber`,
  depotWater: 'A depot cannot stand in water',
  depotEnemy: 'Too close to an enemy army',
  noSource: 'Nothing to transfer from there',
  full: 'No room for more grain',
} as const;

// ---------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------

/** Daily food need of an army after its faction's supply efficiency. */
export function armyFoodNeed(world: WorldState, a: ArmyState): number {
  return rawFoodNeed(a.units) / factionMod(world, a.factionId, 'supplyEfficiency');
}

/** Days of food carried at the current need. */
export function supplyDays(world: WorldState, a: ArmyState): number {
  const need = armyFoodNeed(world, a);
  return need > 0 ? a.supply.food / need : Infinity;
}

function settlementInRange(world: WorldState, a: ArmyState, extra: number, pred: (s: SettlementState) => boolean): SettlementState | null {
  let best: SettlementState | null = null;
  let bd = Infinity;
  for (const id of sortedKeys(world.settlements)) {
    const s = world.settlements[id]!;
    if (!pred(s)) continue;
    const d = Math.sqrt((s.x - a.x) * (s.x - a.x) + (s.z - a.z) * (s.z - a.z));
    if (d <= s.radius + extra && d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

function onRoad(world: WorldState, a: ArmyState): boolean {
  for (const id of sortedKeys(world.roads.edges)) if (distanceToEdge(world.roads.edges[id] as RoadEdge, a.x, a.z) <= ON_ROAD) return true;
  return false;
}

/** Remove `share` of every unit's soldiers (stochastic rounding). Returns soldiers lost. */
export function loseShare(world: WorldState, a: ArmyState, share: number): number {
  if (share <= 0) return 0;
  let lost = 0;
  for (const u of a.units) {
    const x = u.soldiers * share;
    let n = Math.floor(x);
    if (worldRandom(world) < x - n) n++;
    n = Math.min(n, u.soldiers);
    u.soldiers -= n;
    lost += n;
  }
  a.units = a.units.filter((u) => u.soldiers > 0);
  if (lost > 0) addStat(world, a.factionId, 'soldiers_lost', lost);
  return lost;
}

/** Supply-line threat per faction: edges with a hostile army within 300 m (computed once per day). */
function threatenedEdges(world: WorldState, factionId: FactionId, cache: Map<string, Set<string>>): Set<string> {
  let s = cache.get(factionId);
  if (s) return s;
  s = new Set();
  const armies = sortedKeys(world.armies).map((id) => world.armies[id]!).filter((o) => o.units.length > 0 && hostileToArmy(world, factionId, o));
  for (const eid of sortedKeys(world.roads.edges)) {
    const e = world.roads.edges[eid] as RoadEdge;
    for (const o of armies) {
      if (distanceToEdge(e, o.x, o.z) <= SUPPLY_LINE_THREAT) {
        s.add(eid);
        break;
      }
    }
  }
  cache.set(factionId, s);
  return s;
}

function friendlyTerritory(world: WorldState, factionId: FactionId, owner: FactionId | null): boolean {
  return owner === null || owner === factionId || !!activeTreaty(world, factionId, owner, 'military_access');
}

/**
 * Supply line to the royal reserve (§7.8 step 3). Returns the road distance (map m) to the nearest own settlement or
 * null when there is no safe line.
 */
export function supplyLine(world: WorldState, a: ArmyState, threatCache: Map<string, Set<string>> = new Map()): { distance: number; settlementId: string } | null {
  const pid = provinceAtPoint(world, a.x, a.z);
  const prov = pid ? world.provinces[pid] : null;
  if (!prov || !prov.ownerFactionId) return null;
  if (prov.ownerFactionId !== a.factionId && !activeTreaty(world, a.factionId, prov.ownerFactionId, 'military_access')) return null;
  const start = nearestNode(world, a.x, a.z);
  if (!start.id) return null;
  const threats = threatenedEdges(world, a.factionId, threatCache);
  // Dijkstra over usable roads through friendly / neutral settlements.
  const dist = new Map<string, number>([[start.id, start.dist]]);
  const done = new Set<string>();
  for (;;) {
    let u: string | null = null;
    let bd = Infinity;
    for (const [k, v] of dist) if (!done.has(k) && v < bd) {
      bd = v;
      u = k;
    }
    if (!u) return null;
    done.add(u);
    const sid = world.roads.nodes[u]?.settlementId ?? null;
    const s = sid ? world.settlements[sid] : null;
    if (s && s.ownerFactionId === a.factionId && !s.besiegedBy) return { distance: bd, settlementId: s.id };
    if (s && !friendlyTerritory(world, a.factionId, s.ownerFactionId)) continue;
    for (const eid of world.roads.adjacency[u] ?? []) {
      const e = world.roads.edges[eid];
      if (!e || threats.has(eid) || e.condition < 0.3) continue;
      const v = e.a === u ? e.b : e.a;
      const nd = bd + e.length;
      if (nd < (dist.get(v) ?? Infinity)) dist.set(v, nd);
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// Daily
// ---------------------------------------------------------------------------------------------------

function resupply(world: WorldState, a: ArmyState, threatCache: Map<string, Set<string>>): boolean {
  const room = a.supply.foodCapacity - a.supply.food;
  // 1. Own settlement nearby.
  const s = settlementInRange(world, a, SUP.resupplyRadius, (x) => x.ownerFactionId === a.factionId && !x.besiegedBy);
  if (s) {
    const keep = RULES.storage.keepDays * Math.max(0, s.foodConsumption);
    const give = Math.max(0, Math.min(room, s.foodStored * SUP.maxDrawPerDay, s.foodStored - keep));
    if (give > 0 || room <= 1e-6) {
      s.foodStored -= give;
      a.supply.food += give;
      a.supply.sourceId = s.id;
      return true;
    }
  }
  // 2. Own depot nearby.
  for (const id of sortedKeys(world.depots)) {
    const d = world.depots[id]!;
    if (d.factionId !== a.factionId || d.readyOnDay > today(world) || d.food <= 0) continue;
    if ((d.x - a.x) * (d.x - a.x) + (d.z - a.z) * (d.z - a.z) > SUP.resupplyRadius * SUP.resupplyRadius) continue;
    const give = Math.min(room, d.food);
    d.food -= give;
    a.supply.food += give;
    a.supply.sourceId = d.id;
    return true;
  }
  // 3. Royal reserve through a supply line.
  const f = world.factions[a.factionId];
  if (!f) return false;
  const line = supplyLine(world, a, threatCache);
  if (!line) return false;
  a.supply.sourceId = line.settlementId;
  if (room <= 1e-6 || f.foodReserve <= 0) return true;
  const km = (line.distance * BALANCE.military.travelScale) / 1000;
  const keep = Math.max(0, 1 - 0.1 * (km / 30));
  if (keep <= 0) return true;
  const delivered = Math.min(room, armyFoodNeed(world, a) * RESERVE_CONVOY_DAYS, f.foodReserve * keep);
  f.foodReserve -= delivered / keep;
  a.supply.food += delivered;
  return true;
}

function forage(world: WorldState, a: ArmyState, need: number, out: SimEvent[]): number {
  const s0 = seasonOf(world.calendar);
  const pid = provinceAtPoint(world, a.x, a.z);
  const fert = (pid ? (world.provinces[pid]?.fertility ?? 0.7) : 0.7) * (world.sandbox?.fertility ?? 1);
  const yieldFood = need * BALANCE.military.forageFoodPerDay * fert * SUP.forageSeason[s0];
  const s = settlementInRange(world, a, SUP.forageRadius, () => true);
  a.supply.foraging = true;
  if (!s) return yieldFood;
  const own = s.ownerFactionId === a.factionId;
  const enemy = s.ownerFactionId === null || atWarWith(world, a.factionId, s.ownerFactionId) || (isRebelFaction(a.factionId) && s.id !== a.rebelSettlementId);
  if (own) {
    const take = Math.min(yieldFood, Math.max(0, s.foodStored));
    s.foodStored -= take;
    s.unrest = Math.min(1, s.unrest + SUP.forageUnrestPerDay);
    s.loyalty = Math.max(0, s.loyalty - 0.002);
    return yieldFood;
  }
  if (enemy) {
    const plunder = yieldFood * SUP.plunderMultiplier;
    s.foodStored = Math.max(0, s.foodStored - plunder);
    s.damage = Math.min(1, s.damage + 0.01);
    if (s.ownerFactionId) raidGrievance(world, s.ownerFactionId, a.factionId);
    if (s.ownerFactionId && world.factions[s.ownerFactionId]?.isPlayer) notifyPlayer(world, out, s.ownerFactionId, 'danger', `Enemy foragers are plundering ${s.name}.`, { x: s.x, z: s.z });
    return plunder;
  }
  // Neutral land of another realm: take the produce without plunder.
  const take = Math.min(yieldFood, Math.max(0, s.foodStored));
  s.foodStored -= take;
  return yieldFood;
}

/** A `raid` grievance (-10 opinion) held by `victim` against `raider`, at most one per 30 days. */
export function raidGrievance(world: WorldState, victim: FactionId, raider: FactionId): void {
  if (isRebelFaction(raider) || !world.factions[raider]) return;
  const rel = relationOf(world, victim, raider);
  if (!rel) return;
  const d = today(world);
  if (rel.grievances.some((g) => g.kind === 'raid' && d - g.day < 30)) return;
  rel.grievances.push({ kind: 'raid', day: d, amount: -10 });
}

function attritionShare(world: WorldState, a: ArmyState, terrain: TerrainQuery): number {
  const at = SUP.attrition;
  let share = 0;
  const season = seasonOf(world.calendar);
  const inSettlement = !!settlementInRange(world, a, SUP.resupplyRadius, () => true);
  const road = inSettlement || onRoad(world, a);
  if (!road) {
    if (season === 'varsha') share += at.monsoonOffroad;
    const tc = terrain.inBounds(a.x, a.z) ? terrain.terrainClassAt(a.x, a.z) : 'open';
    if (tc === 'hills' || tc === 'rough' || tc === 'forest' || tc === 'marsh') share += at.roughOffroad;
  }
  if (season === 'grishma' && !settlementInRange(world, a, SUP.forageRadius, () => true)) {
    const biome = terrain.inBounds(a.x, a.z) ? terrain.biomeAt(a.x, a.z) : 'grassland';
    if (biome === 'dry_plain' || biome === 'scrub') share += at.dryHeat;
  }
  if (a.status === 'besieging') share += at.siege;
  if (a.forcedMarch && a.status === 'marching') share += RULES.armies.forcedMarch.attritionPerDay;
  return share;
}

/** Daily supply, foraging, starvation, attrition, fatigue and morale for every army; depots. */
export function updateArmiesDaily(world: WorldState, out: SimEvent[]): void {
  const terrain = getHeightfield(world.region.terrain);
  const threatCache = new Map<string, Set<string>>();
  for (const id of sortedKeys(world.armies)) {
    const a = world.armies[id];
    if (!a) continue;
    if (a.units.length === 0) {
      removeArmy(world, a, false);
      continue;
    }
    a.supply.foodCapacity = carriedCapacity(a.units);
    if (isRebelFaction(a.factionId)) {
      // Rebels are locals: fed by their own villages.
      a.supply.food = a.supply.foodCapacity;
      a.supply.dailyConsumption = 0;
      continue;
    }
    if (a.status === 'in_battle' || a.engagementId) continue;
    const need = armyFoodNeed(world, a);
    a.supply.dailyConsumption = need;
    a.supply.foraging = false;
    const sourced = a.status === 'besieging' ? false : resupply(world, a, threatCache);
    a.supply.lineIntact = sourced;
    if (!sourced) a.supply.sourceId = null;
    if (!sourced || a.order.kind === 'forage' || a.order.kind === 'raid') a.supply.food += forage(world, a, need, out);
    // Eat.
    const f = world.factions[a.factionId];
    if (a.supply.food >= need) {
      a.supply.food -= need;
      a.supply.starvationDays = 0;
    } else {
      a.supply.food = 0;
      a.supply.starvationDays++;
      a.morale = Math.max(0, a.morale - BALANCE.military.starvationMoralePerDay);
      const st = SUP.starvation;
      const desert = a.supply.starvationDays > st.heavyAfterDays ? st.heavyDesertionPerDay : a.supply.starvationDays > st.desertionAfterDays ? st.desertionPerDay : 0;
      loseShare(world, a, desert);
      out.push({ kind: 'army_starving', armyId: a.id });
    }
    if (a.supply.food > a.supply.foodCapacity) a.supply.food = a.supply.foodCapacity;
    // Attrition.
    loseShare(world, a, attritionShare(world, a, terrain));
    // Unpaid soldiers.
    if (f && f.treasury < 0) {
      a.morale = Math.max(0, a.morale + RULES.tax.debt.armyMoralePerDay);
      loseShare(world, a, RULES.tax.debt.desertionPerDay);
    }
    // Fatigue and morale.
    if (a.status === 'marching') a.fatigue = Math.min(1, a.fatigue + BALANCE.military.fatiguePerMarchDay + (a.forcedMarch ? RULES.armies.forcedMarch.fatiguePerDay : 0));
    else a.fatigue = Math.max(0, a.fatigue - BALANCE.military.recoveryPerRestDay);
    if (a.supply.starvationDays === 0 && (!f || f.treasury >= 0)) {
      const target = a.status === 'marching' ? 65 : 70;
      a.morale += (target - a.morale) * 0.1;
    }
    for (const u of a.units) {
      u.morale += (Math.min(100, Math.max(5, a.morale + 10)) - u.morale) * 0.2;
      u.fatigue = a.fatigue;
    }
    if (a.order.kind === 'resupply' && a.status !== 'marching' && a.supply.food >= a.supply.foodCapacity * 0.95) a.order = { kind: 'idle' };
    if (a.units.length === 0) {
      removeArmy(world, a, false);
      continue;
    }
    const days = need > 0 ? a.supply.food / need : Infinity;
    if (days < 5 && a.supply.starvationDays === 0 && f?.isPlayer) out.push({ kind: 'army_supply_low', armyId: a.id, days: Math.floor(days) });
  }
  updateDepotsDaily(world, out);
}

/** Depots become usable after 5 days; enemy armies in contact range raid them (food lost, grievance). */
function updateDepotsDaily(world: WorldState, out: SimEvent[]): void {
  for (const id of sortedKeys(world.depots)) {
    const d = world.depots[id]!;
    if (d.food <= 0 && d.raided) continue;
    for (const aid of sortedKeys(world.armies)) {
      const a = world.armies[aid]!;
      if (a.units.length === 0 || !hostileToArmy(world, d.factionId, a)) continue;
      const r = BALANCE.military.contactRadius * RULES.armies.stance[a.stance].contactRadius;
      if ((a.x - d.x) * (a.x - d.x) + (a.z - d.z) * (a.z - d.z) > r * r) continue;
      // An escort or any own army close by defends it (the armies will meet in battle instead).
      let defended = false;
      for (const oid of sortedKeys(world.armies)) {
        const o = world.armies[oid]!;
        if (o.factionId === d.factionId && (o.x - d.x) * (o.x - d.x) + (o.z - d.z) * (o.z - d.z) <= 150 * 150) defended = true;
      }
      if (defended) break;
      a.supply.food = Math.min(a.supply.foodCapacity, a.supply.food + d.food);
      d.food = 0;
      d.raided = true;
      d.condition = Math.max(0, d.condition - 0.5);
      raidGrievance(world, d.factionId, a.factionId);
      out.push({ kind: 'depot_raided', depotId: d.id, armyId: a.id, factionId: a.factionId });
      notifyPlayer(world, out, d.factionId, 'danger', 'A supply depot was raided.', { x: d.x, z: d.z });
      break;
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------------

/** requisition_grain: up to 60% of an own settlement's store to an army, a depot or the royal reserve. */
export function requisitionGrain(world: WorldState, factionId: FactionId, settlementId: string, amount: number, toArmyId: string | null, toDepotId: string | null, out: SimEvent[]): string | null {
  const R = SUPPLY_REASONS;
  const s = world.settlements[settlementId];
  if (!s) return R.noSettlement;
  if (s.ownerFactionId !== factionId) return R.notOwned;
  if (!(amount > 0)) return R.badAmount;
  const max = Math.max(0, s.foodStored) * SUP.requisition.maxShare;
  if (amount > max + 1e-6) return R.tooMuch(max);
  if (toArmyId) {
    const a = world.armies[toArmyId];
    if (!a) return R.noTarget;
    if (a.factionId !== factionId) return R.notYourTarget;
    if ((a.x - s.x) * (a.x - s.x) + (a.z - s.z) * (a.z - s.z) > (s.radius + 600) * (s.radius + 600)) return R.tooFar;
    a.supply.food += amount;
  } else if (toDepotId) {
    const d = world.depots[toDepotId];
    if (!d) return R.noTarget;
    if (d.factionId !== factionId) return R.notYourTarget;
    d.food = Math.min(d.capacity, d.food + amount);
  } else {
    world.factions[factionId]!.foodReserve += amount;
  }
  s.foodStored -= amount;
  s.requisitionedFood += amount;
  s.loyalty = Math.max(0, s.loyalty + SUP.requisition.loyaltyPer1000 * (amount / 1000));
  notifyPlayer(world, out, factionId, 'warning', `${Math.round(amount)} grain requisitioned from ${s.name}. The farmers will remember.`, { x: s.x, z: s.z });
  return null;
}

/** create_depot: 150 wealth + 50 timber, usable after 5 days, holds 6,000 grain. */
export function createDepot(world: WorldState, factionId: FactionId, x: number, z: number, settlementId: string | null, out: SimEvent[]): { reason: string | null; depotId: DepotId | null } {
  const R = SUPPLY_REASONS;
  const f = world.factions[factionId];
  const dc = SUP.depot;
  if (!f) return { reason: R.notOwned, depotId: null };
  const terrain = getHeightfield(world.region.terrain);
  if (!terrain.inBounds(x, z) || terrain.isWater(x, z)) return { reason: R.depotWater, depotId: null };
  for (const id of sortedKeys(world.armies)) {
    const a = world.armies[id]!;
    if (hostileToArmy(world, factionId, a) && (a.x - x) * (a.x - x) + (a.z - z) * (a.z - z) < 300 * 300) return { reason: R.depotEnemy, depotId: null };
  }
  if (f.treasury < dc.costWealth) return { reason: R.noWealth(dc.costWealth), depotId: null };
  if (f.materials.timber < dc.costTimber) return { reason: R.noTimber(dc.costTimber), depotId: null };
  f.treasury -= dc.costWealth;
  f.materials.timber -= dc.costTimber;
  addMonthToDate(world, factionId, 'other_cost', dc.costWealth);
  const id = nextWorldId(world, 'depot');
  const depot: SupplyDepotState = { id, factionId, x, z, settlementId, food: 0, capacity: dc.capacity, condition: 1, escortArmyId: null, raided: false, readyOnDay: today(world) + dc.buildDays };
  world.depots[id] = depot;
  notifyPlayer(world, out, factionId, 'info', 'A supply depot is being built (5 days).', { x, z });
  return { reason: null, depotId: id };
}

interface Holder {
  get: () => number;
  room: () => number;
  add: (n: number) => void;
  x: number;
  z: number;
}

function holder(world: WorldState, factionId: FactionId, id: string): Holder | string {
  const R = SUPPLY_REASONS;
  const a = world.armies[id];
  if (a) {
    if (a.factionId !== factionId) return R.notYourTarget;
    return { get: () => a.supply.food, room: () => Math.max(0, a.supply.foodCapacity - a.supply.food), add: (n) => (a.supply.food += n), x: a.x, z: a.z };
  }
  const d = world.depots[id];
  if (d) {
    if (d.factionId !== factionId) return R.notYourTarget;
    return { get: () => d.food, room: () => Math.max(0, d.capacity - d.food), add: (n) => (d.food += n), x: d.x, z: d.z };
  }
  const s = world.settlements[id];
  if (s) {
    if (s.ownerFactionId !== factionId) return R.notYourTarget;
    return { get: () => Math.max(0, s.foodStored - RULES.storage.keepDays * s.foodConsumption), room: () => Math.max(0, s.foodCapacity - s.foodStored), add: (n) => (s.foodStored += n), x: s.x, z: s.z };
  }
  return R.noTarget;
}

/** transfer_supply between own armies / depots / settlements within 600 m of each other. */
export function transferSupply(world: WorldState, factionId: FactionId, fromId: string, toId: string, amount: number): string | null {
  const R = SUPPLY_REASONS;
  if (!(amount > 0)) return R.badAmount;
  const from = holder(world, factionId, fromId);
  if (typeof from === 'string') return from;
  const to = holder(world, factionId, toId);
  if (typeof to === 'string') return to;
  if ((from.x - to.x) * (from.x - to.x) + (from.z - to.z) * (from.z - to.z) > 600 * 600) return R.tooFar;
  const n = Math.min(amount, from.get(), to.room());
  if (n <= 0) return from.get() <= 0 ? R.noSource : R.full;
  from.add(-n);
  to.add(n);
  return null;
}

/** send_relief: grain from the royal reserve and wealth from the treasury to an own settlement. */
export function sendRelief(world: WorldState, factionId: FactionId, settlementId: string, food: number, wealth: number, out: SimEvent[]): string | null {
  const R = SUPPLY_REASONS;
  const s = world.settlements[settlementId];
  const f = world.factions[factionId];
  if (!s || !f) return R.noSettlement;
  if (s.ownerFactionId !== factionId) return R.notOwned;
  if (food < 0 || wealth < 0 || food + wealth <= 0) return R.badAmount;
  if (f.foodReserve < food) return R.noReserve(food);
  if (f.treasury < wealth) return R.noWealth(wealth);
  f.foodReserve -= food;
  f.treasury -= wealth;
  addMonthToDate(world, factionId, 'other_cost', wealth);
  s.foodStored += food;
  s.wealth += wealth;
  const daysOfFood = s.foodConsumption > 0 ? food / s.foodConsumption : 0;
  const k = Math.min(1, daysOfFood / 30) + Math.min(1, wealth / Math.max(1, s.population * 0.02));
  s.unrest = Math.max(0, s.unrest - 0.05 * k);
  s.loyalty = Math.min(1, s.loyalty + 0.03 * k);
  notifyPlayer(world, out, factionId, 'success', `Relief reached ${s.name}.`, { x: s.x, z: s.z });
  return null;
}
