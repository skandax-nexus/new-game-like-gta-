/**
 * Strategic sieges and captures (DESIGN_SPEC §7.8 "Sieges", §8.6). OWNER: Simulation Engineer - Strategic World
 * Simulation (SIM-01).
 *
 *  - `besiege` an enemy (or independent) settlement: with fort level >= 1 it becomes besieged (trade 0, production
 *    x0.3, no resupply or recruitment - economy.ts); its store feeds population, garrison units and the field armies
 *    garrisoned in it (supply.garrisonedArmyFood); an unwalled one is taken at once, or fought for if defended.
 *  - Siege logistics (supply.ts): besiegers eat from an own depot within 400 m of the camp, else forage / plunder.
 *  - Wall damage/day = Σ soldiers x siege x 0.5 x siegeStrength over the besieging armies (one engineer formation:
 *    40 x 4 x 0.5 = 80/day; Giridurg's 4,200 falls in 52.5 days at siegeStrength 1 at full strength; the 0.4%/day
 *    siege attrition thins a fed formation to ~33 men and the walls fall on days 49-55 for Suvarna, 1.1).
 *  - Assault when wallHp <= 50% (breach, `siege_breach` event) or ladders are ready (engineers, 5 days): a siege
 *    battle against the garrison (garrison units fight as army `garrison_<id>`); undefended -> captured.
 *  - Starve-out: once the store is empty, daily surrender chance 0.1 x starvationDays / 10 (cap 0.6).
 *  - Capture: owner changes; loyalty 0.2, unrest +0.3, building condition -0.2, 30% of local wealth looted; occupation
 *    penalty to loyalty for 360 days; the captor's player chooses Occupy (default, auto after 10 days), Plunder (loot x2,
 *    population -10%, unrest +0.3, legitimacy -0.03, opinion -10 with everyone) or - for a settlement independent at
 *    scenario start - Liberate (independent again; opinion +10 with all; prestige +10). War score +15 (capital +30).
 */
import type { ArmyState, FactionId, SettlementState, SimEvent, TerrainQuery, WorldState } from '../../core/types';
import { isRebelFaction } from '../../core/types';
import { FACTIONS } from '../../data/factions';
import { RULES } from '../../data/rules';
import { UNITS } from '../../data/units';
import { createEngagement, makeArmy, orderArmy, registerArrivalHooks, registerSiegeHooks, removeArmy, SIEGE_CAMP_OFFSET } from './armies';
import { maxWallHp } from './construction';
import { factionMod } from './modifiers';
import { addChronicle, addStat, atWarWith, notifyPlayer, regionTerrain, stableKeys, today, worldRandom } from './state';
import { relationOf } from './treaties';
import { registerWritebackHooks, retreatDestination } from './writeback';

/** Exit directions tried (E, W, S, N) when a garrison is evicted from a settlement that changed hands. */
const EXIT_DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const SG = RULES.siege;
/** Days a player has to choose occupy / plunder / liberate before Occupy applies. */
export const CAPTURE_DECISION_DAYS = 10;

export const SIEGE_REASONS = {
  notHostile: 'You are not at war with its owner',
  own: 'It is already yours',
  noBreach: 'No breach and no ladders yet - keep up the siege',
  notBesieging: 'The army must be besieging that settlement',
  noCapture: 'Nothing to decide there',
  notCaptor: 'You did not take this settlement',
  noLiberate: 'Only a settlement that was free at the start can be liberated',
} as const;

// ---------------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------------

/** Can `factionId` attack this settlement? (independent, or its owner is at war with the faction) */
export function settlementHostile(world: WorldState, factionId: FactionId, s: SettlementState): boolean {
  if (s.ownerFactionId === factionId) return false;
  if (s.ownerFactionId === null) return true;
  return atWarWith(world, factionId, s.ownerFactionId);
}

/** Armies of `factionId` besieging `s` (status besieging with a besiege / assault order on it). */
export function besiegers(world: WorldState, s: SettlementState, factionId: FactionId | null = null): ArmyState[] {
  const out: ArmyState[] = [];
  for (const id of stableKeys('armies', world.armies as Record<string, unknown>)) {
    const a = world.armies[id]!;
    if (a.status !== 'besieging') continue;
    if (!('settlementId' in a.order) || a.order.settlementId !== s.id) continue;
    if (factionId !== null && a.factionId !== factionId) continue;
    out.push(a);
  }
  return out;
}

/** Daily wall damage an army does (§7.8). */
export function wallDamagePerDay(world: WorldState, a: ArmyState): number {
  const variants = FACTIONS[a.factionId]?.unitVariants;
  let d = 0;
  for (const u of a.units) d += u.soldiers * UNITS[u.unitClass].stats.siege * (variants?.[u.unitClass]?.multipliers.siege ?? 1);
  return d * SG.damageScale * factionMod(world, a.factionId, 'siegeStrength');
}

/** Starve-out surrender chance per day (0 while the store holds grain). */
export function surrenderChance(s: SettlementState): number {
  if (s.starvationDays <= 0) return 0;
  return Math.min(0.6, SG.surrenderChance * (s.starvationDays / 10));
}

export interface AssaultState {
  breach: boolean;
  ladders: boolean;
  available: boolean;
  wallHp: number;
  maxWallHp: number;
  surrenderChance: number;
  daysOfFood: number;
}

export function assaultState(world: WorldState, s: SettlementState): AssaultState {
  const max = maxWallHp(world, s);
  const breach = s.fortLevel < 1 || s.wallHp <= 0.5 * max;
  const ladders = s.ladderProgress >= 1;
  return { breach, ladders, available: breach || ladders, wallHp: s.wallHp, maxWallHp: max, surrenderChance: surrenderChance(s), daysOfFood: s.foodConsumption > 0 ? s.foodStored / s.foodConsumption : Infinity };
}

function defendersOf(world: WorldState, s: SettlementState): ArmyState[] {
  const out: ArmyState[] = [];
  for (const id of stableKeys('armies', world.armies as Record<string, unknown>)) {
    const a = world.armies[id]!;
    if (a.factionId !== s.ownerFactionId || a.engagementId) continue;
    if (a.status === 'garrisoned' && a.order.kind === 'garrison' && a.order.settlementId === s.id) out.push(a);
  }
  return out;
}

/** The garrison units fight as an army `garrison_<id>` (survivors return to the garrison after the battle). */
function garrisonArmy(world: WorldState, s: SettlementState): ArmyState | null {
  if (!s.ownerFactionId || s.garrison.length === 0) return null;
  const id = `garrison_${s.id}`;
  const existing = world.armies[id];
  if (existing) return existing;
  const a = makeArmy(world, id, `Garrison of ${s.name}`, s.ownerFactionId, s.x, s.z, [], null);
  a.units = s.garrison;
  s.garrison = [];
  a.status = 'garrisoned';
  a.order = { kind: 'garrison', settlementId: s.id };
  a.morale = 70;
  world.armies[id] = a;
  return a;
}

// ---------------------------------------------------------------------------------------------------
// Siege lifecycle
// ---------------------------------------------------------------------------------------------------

/** An army arriving with a besiege order. */
export function beginSiege(world: WorldState, a: ArmyState, s: SettlementState, out: SimEvent[], terrain: TerrainQuery): void {
  if (s.ownerFactionId === a.factionId) {
    a.order = { kind: 'idle' };
    return;
  }
  if (!isRebelFaction(a.factionId) && !settlementHostile(world, a.factionId, s)) {
    a.order = { kind: 'idle' };
    notifyPlayer(world, out, a.factionId, 'warning', `${SIEGE_REASONS.notHostile}: ${s.name}.`);
    return;
  }
  if (s.fortLevel < 1) {
    // Unwalled: taken at once unless defended.
    if (defendersOf(world, s).length === 0 && s.garrison.length === 0) {
      captureSettlement(world, s, a.factionId, out, 'undefended');
      a.order = { kind: 'idle' };
      return;
    }
    assault(world, a, s, out, terrain);
    return;
  }
  a.status = 'besieging';
  if (!s.besiegedBy || !world.armies[s.besiegedBy]) {
    s.besiegedBy = a.id;
    s.siegeDays = 0;
    s.ladderProgress = 0;
    out.push({ kind: 'siege_started', settlementId: s.id, armyId: a.id });
    addChronicle(world, a.factionId, `${a.name} laid siege to ${s.name}.`, 1);
    notifyPlayer(world, out, s.ownerFactionId, 'danger', `${s.name} is besieged!`, { x: s.x, z: s.z });
  }
}

/** An army leaves a siege (new order, destroyed): the siege passes to another besieger or ends. */
export function liftSiege(world: WorldState, a: ArmyState): void {
  for (const id of stableKeys('settlements', world.settlements as Record<string, unknown>)) {
    const s = world.settlements[id]!;
    if (s.besiegedBy !== a.id) continue;
    const others = besiegers(world, s, a.factionId).filter((o) => o.id !== a.id);
    s.besiegedBy = others[0]?.id ?? null;
    if (!s.besiegedBy) {
      s.siegeDays = 0;
      s.ladderProgress = 0;
    }
  }
}

/** Assault (§7.8): a siege battle when breached or laddered; undefended walls are simply taken. */
function assault(world: WorldState, a: ArmyState, s: SettlementState, out: SimEvent[], terrain: TerrainQuery): void {
  const st = assaultState(world, s);
  if (s.fortLevel >= 1 && !st.available) {
    a.order = { kind: 'besiege', settlementId: s.id };
    a.status = 'besieging';
    notifyPlayer(world, out, a.factionId, 'warning', `${SIEGE_REASONS.noBreach} at ${s.name}.`);
    return;
  }
  const defenders = defendersOf(world, s);
  const g = garrisonArmy(world, s);
  if (g) defenders.unshift(g);
  if (defenders.length === 0) {
    captureSettlement(world, s, a.factionId, out, 'undefended');
    a.order = { kind: 'idle' };
    a.status = 'camped';
    return;
  }
  a.order = { kind: 'besiege', settlementId: s.id };
  createEngagement(world, a, defenders[0]!, out, terrain, 'siege', s.id);
  // Every other defender joins the defence.
  const e = world.engagements[a.engagementId as string];
  if (e) {
    for (const d of defenders.slice(1)) {
      if (d.engagementId) continue;
      e.sides[1].push(d.id);
      d.engagementId = e.id;
      d.status = 'in_battle';
    }
  }
}

registerArrivalHooks({
  besiege: beginSiege,
  assault: (world, a, out, terrain) => {
    if (a.order.kind !== 'assault') return;
    const s = world.settlements[a.order.settlementId];
    if (!s) {
      a.order = { kind: 'idle' };
      return;
    }
    if (a.status !== 'besieging' && s.fortLevel >= 1) {
      // Walk to the walls first; the assault happens on arrival.
      if (a.status !== 'marching') orderArmy(world, a.id, { kind: 'assault', settlementId: s.id }, terrain);
      return;
    }
    assault(world, a, s, out, terrain);
  },
});
registerSiegeHooks({ lift: liftSiege });

/** Daily: wall damage, ladders, starve-out, besieger checks, capture decision timeouts. */
export function updateSiegesDaily(world: WorldState, out: SimEvent[]): void {
  for (const id of stableKeys('settlements', world.settlements as Record<string, unknown>)) {
    const s = world.settlements[id]!;
    if (s.pendingCapture && today(world) - s.pendingCapture.day >= CAPTURE_DECISION_DAYS) s.pendingCapture = null; // Occupy by default.
    if (!s.besiegedBy) continue;
    const lead = world.armies[s.besiegedBy];
    if (!lead || lead.units.length === 0 || (lead.status !== 'besieging' && lead.status !== 'in_battle') || !lead.order || !('settlementId' in lead.order) || lead.order.settlementId !== s.id) {
      const others = lead ? besiegers(world, s, lead.factionId).filter((o) => o.id !== lead.id) : [];
      s.besiegedBy = others[0]?.id ?? null;
      if (!s.besiegedBy) {
        s.siegeDays = 0;
        s.ladderProgress = 0;
        continue;
      }
    }
    const att = world.armies[s.besiegedBy]!;
    s.siegeDays++;
    if (isRebelFaction(att.factionId)) continue; // Rebels hold the town; politics decides secession.
    if (att.status === 'in_battle') continue;
    const max = maxWallHp(world, s);
    const prev = s.wallHp;
    let damage = 0;
    let engineers = false;
    for (const a of besiegers(world, s, att.factionId)) {
      damage += wallDamagePerDay(world, a);
      if (a.units.some((u) => u.unitClass === 'engineers' && u.soldiers > 0)) engineers = true;
    }
    s.wallHp = Math.max(0, s.wallHp - damage);
    if (prev > 0.5 * max && s.wallHp <= 0.5 * max) {
      out.push({ kind: 'siege_breach', settlementId: s.id, armyId: att.id });
      notifyPlayer(world, out, att.factionId, 'success', `The walls of ${s.name} are breached - the assault can begin.`, { x: s.x, z: s.z });
      notifyPlayer(world, out, s.ownerFactionId, 'danger', `The walls of ${s.name} are breached!`, { x: s.x, z: s.z });
    }
    if (engineers && s.ladderProgress < 1) s.ladderProgress = Math.min(1, s.ladderProgress + 1 / SG.ladderDays);
    // Starve-out.
    const chance = surrenderChance(s);
    if (chance > 0 && worldRandom(world) < chance) {
      captureSettlement(world, s, att.factionId, out, 'surrender');
      for (const a of besiegers(world, s, att.factionId)) {
        a.order = { kind: 'idle' };
        a.status = 'camped';
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------------------------------

/** Faction's new capital after losing one: capital > city > fort > town > the largest. */
export function chooseCapital(world: WorldState, factionId: FactionId): string | null {
  const owned = stableKeys('settlements', world.settlements as Record<string, unknown>).map((id) => world.settlements[id]!).filter((s) => s.ownerFactionId === factionId);
  const rank = (k: SettlementState['kind']): number => (k === 'capital' ? 0 : k === 'city' ? 1 : k === 'fort' ? 2 : k === 'town' || k === 'port' || k === 'temple_town' ? 3 : 4);
  owned.sort((a, b) => rank(a.kind) - rank(b.kind) || b.population - a.population || (a.id < b.id ? -1 : 1));
  return owned[0]?.id ?? null;
}

/** Recompute province owners (owner of the capital settlement) and governors of foreign provinces. */
export function refreshProvinces(world: WorldState): void {
  for (const pid of stableKeys('provinces', world.provinces as Record<string, unknown>)) {
    const p = world.provinces[pid]!;
    const cap = world.settlements[p.capitalSettlementId];
    p.ownerFactionId = cap?.ownerFactionId ?? null;
    const gov = p.governorId ? world.characters[p.governorId] : null;
    if (gov && (gov.factionId !== p.ownerFactionId || !gov.alive)) {
      gov.governsProvinceId = null;
      p.governorId = null;
    }
  }
}

/**
 * Change a settlement's owner (capture, surrender, secession, event transfers, liberation): jobs, queues, rally point,
 * relief and capture choice reset; the old owner's garrison - and, unless `fieldArmiesFallBack` is false (a captor
 * liberating the town it just took), its field armies at the town - fall back to the realm; provinces, capitals and
 * fallen realms update.
 */
export function transferOwnership(world: WorldState, s: SettlementState, to: FactionId | null, out: SimEvent[], fieldArmiesFallBack = true): void {
  const from = s.ownerFactionId;
  if (from === to) return;
  s.ownerFactionId = to;
  s.ownerSinceDay = today(world);
  for (const j of s.construction) j.laborAssigned = 0;
  s.construction = [];
  s.recruitment = [];
  delete s.rallyPoint;
  s.taxRelief = null;
  s.pendingCapture = null;
  s.requisitionedFood = 0;
  // The old owner's armies at the town fall back to the realm: its garrison is evicted, and field armies camped
  // within radius + FIELD_ARMY_FALLBACK_RANGE (or marching in to garrison it) would otherwise sit beside a foreign town
  // with no supply line (SIM-01 review B3: the Household of Devavarman starved at Ratnapura after 'Let him go').
  if (from) {
    const terrain = regionTerrain(world);
    const range = s.radius + FIELD_ARMY_FALLBACK_RANGE;
    for (const id of stableKeys('armies', world.armies as Record<string, unknown>)) {
      const a = world.armies[id]!;
      if (a.factionId !== from) continue;
      const garrisoned = a.status === 'garrisoned' && a.order.kind === 'garrison' && a.order.settlementId === s.id;
      const inbound = a.status === 'marching' && a.order.kind === 'garrison' && a.order.settlementId === s.id;
      const dx = a.x - s.x;
      const dz = a.z - s.z;
      const camped = a.status === 'camped' && dx * dx + dz * dz <= range * range;
      if (!garrisoned && !((inbound || camped) && fieldArmiesFallBack)) continue;
      const evicted = garrisoned || (camped && dx * dx + dz * dz < s.radius * s.radius);
      fallBack(world, a, s, evicted, terrain);
      notifyPlayer(world, out, from, 'warning', `${a.name} falls back from ${s.name}.`, { x: a.x, z: a.z });
    }
  }
  refreshProvinces(world);
  if (from && world.factions[from]) {
    const f = world.factions[from]!;
    if (f.capitalSettlementId === s.id) f.capitalSettlementId = chooseCapital(world, from);
    if (!stableKeys('settlements', world.settlements as Record<string, unknown>).some((id) => world.settlements[id]!.ownerFactionId === from)) {
      f.alive = false;
      for (const id of stableKeys('armies', world.armies as Record<string, unknown>)) if (world.armies[id]!.factionId === from) removeArmy(world, world.armies[id]!, false);
      addChronicle(world, from, `${f.name} has fallen.`, 2);
      notifyPlayer(world, out, null, 'danger', `${f.name} has fallen.`);
    }
  }
  if (to && world.factions[to] && !world.factions[to]!.capitalSettlementId) world.factions[to]!.capitalSettlementId = s.id;
  if (to && world.factions[to] && !world.factions[to]!.alive) world.factions[to]!.alive = true;
}

/** Field armies of a settlement's previous owner camped this far beyond its radius fall back when it changes hands (m). */
export const FIELD_ARMY_FALLBACK_RANGE = 300;

/**
 * An army of a settlement's previous owner leaves it: if `evict` (garrison, or camped inside the walls) it first steps
 * out of the gates onto dry ground; then it marches back to the realm - the nearest own walls (garrison), else the
 * nearest own settlement or depot (retreatDestination, the battle-retreat rule).
 */
function fallBack(world: WorldState, a: ArmyState, s: SettlementState, evict: boolean, terrain: TerrainQuery): void {
  a.status = 'camped';
  a.order = { kind: 'idle' };
  a.path = [];
  if (evict) {
    const r = s.radius + SIEGE_CAMP_OFFSET;
    for (const [dx, dz] of EXIT_DIRECTIONS) {
      if (terrain.inBounds(s.x + dx * r, s.z + dz * r) && !terrain.isWater(s.x + dx * r, s.z + dz * r)) {
        a.x = s.x + dx * r;
        a.z = s.z + dz * r;
        break;
      }
    }
  }
  const to = retreatDestination(world, a);
  if (to?.kind === 'garrison') orderArmy(world, a.id, { kind: 'garrison', settlementId: to.settlementId }, terrain);
  else if (to) orderArmy(world, a.id, { kind: 'retreat', x: to.x, z: to.z }, terrain);
}

/** Capture by force or surrender (§7.8). */
export function captureSettlement(world: WorldState, s: SettlementState, captor: FactionId, out: SimEvent[], how: 'assault' | 'surrender' | 'undefended'): void {
  const from = s.ownerFactionId;
  const lost = s.garrison.reduce((n, u) => n + u.soldiers, 0);
  if (lost > 0) addStat(world, from, 'soldiers_lost', lost);
  s.garrison = [];
  transferOwnership(world, s, captor, out);
  s.occupiedSinceDay = today(world);
  s.besiegedBy = null;
  s.siegeDays = 0;
  s.ladderProgress = 0;
  s.loyalty = SG.capturedLoyalty;
  s.unrest = Math.min(1, s.unrest + SG.capturedUnrest);
  for (const b of s.buildings) b.condition = Math.max(0.1, b.condition - 0.2);
  for (const l of s.landmarks) l.condition = Math.max(0.1, l.condition - 0.2);
  const loot = s.wealth * SG.captureLootShare;
  s.wealth -= loot;
  const cf = world.factions[captor];
  if (cf) cf.treasury += loot;
  addStat(world, captor, 'settlements_captured', 1);
  // War score: +15 (capital +30) for the captor against the former owner.
  if (from && world.factions[from]) {
    const rel = relationOf(world, captor, from);
    if (rel && rel.atWar) {
      const capital = world.factions[from]!.capitalSettlementId === s.id || s.kind === 'capital';
      const v = capital ? RULES.diplomacy.warScore.capital : RULES.diplomacy.warScore.settlement;
      rel.warScore = Math.max(-100, Math.min(100, rel.warScore + (rel.a === captor ? v : -v)));
    }
  }
  out.push({ kind: 'settlement_captured', settlementId: s.id, from, to: captor });
  addChronicle(world, captor, `${s.name} ${how === 'surrender' ? 'surrendered to' : 'fell to'} ${FACTIONS[captor]?.shortName ?? captor}.`, 2);
  if (cf?.isPlayer) {
    s.pendingCapture = { factionId: captor, day: today(world) };
    notifyPlayer(world, out, captor, 'success', `${s.name} is ours. Occupy, plunder${s.initialOwnerFactionId === null ? ' or liberate' : ''}?`, { x: s.x, z: s.z });
  } else if (cf && cf.ai.personality === 'raider') {
    decideCapture(world, captor, s.id, 'plunder', out, true);
  }
  notifyPlayer(world, out, from, 'danger', `${s.name} has fallen to ${FACTIONS[captor]?.shortName ?? captor}.`, { x: s.x, z: s.z });
}

/** capture_decision: occupy / plunder / liberate a settlement just taken (§7.8). */
export function validateCaptureDecision(world: WorldState, factionId: FactionId, settlementId: string, decision: 'occupy' | 'plunder' | 'liberate'): string | null {
  const s = world.settlements[settlementId];
  if (!s) return 'No such settlement';
  if (!s.pendingCapture) return SIEGE_REASONS.noCapture;
  if (s.pendingCapture.factionId !== factionId || s.ownerFactionId !== factionId) return SIEGE_REASONS.notCaptor;
  if (decision === 'liberate' && s.initialOwnerFactionId !== null) return SIEGE_REASONS.noLiberate;
  return null;
}

export function decideCapture(world: WorldState, factionId: FactionId, settlementId: string, decision: 'occupy' | 'plunder' | 'liberate', out: SimEvent[], force = false): string | null {
  const s = world.settlements[settlementId];
  if (!s) return 'No such settlement';
  if (!force) {
    const reason = validateCaptureDecision(world, factionId, settlementId, decision);
    if (reason) return reason;
  }
  if (decision === 'liberate' && s.initialOwnerFactionId !== null) return SIEGE_REASONS.noLiberate;
  s.pendingCapture = null;
  const f = world.factions[factionId];
  if (decision === 'plunder') {
    const extra = Math.min(s.wealth, (s.wealth * SG.captureLootShare) / (1 - SG.captureLootShare));
    s.wealth -= extra;
    if (f) {
      f.treasury += extra;
      f.legitimacy = Math.max(0, f.legitimacy - 0.03);
    }
    s.population *= 0.9;
    s.unrest = Math.min(1, s.unrest + 0.3);
    for (const key of stableKeys('relations', world.diplomacy.relations as Record<string, unknown>)) {
      const r = world.diplomacy.relations[key]!;
      if (r.a === factionId || r.b === factionId) r.opinion = Math.max(-100, r.opinion - 10);
    }
    addChronicle(world, factionId, `${s.name} was plundered.`, 1);
  } else if (decision === 'liberate') {
    // The liberating army stays where its commander put it.
    transferOwnership(world, s, null, out, false);
    s.occupiedSinceDay = null;
    s.loyalty = 0.5;
    for (const key of stableKeys('relations', world.diplomacy.relations as Record<string, unknown>)) {
      const r = world.diplomacy.relations[key]!;
      if (r.a === factionId || r.b === factionId) r.opinion = Math.min(100, r.opinion + 10);
    }
    if (f) f.prestige += 10;
    addChronicle(world, factionId, `${s.name} was set free.`, 2);
  }
  return null;
}

registerWritebackHooks({ capture: captureSettlement });
