/**
 * Recruitment (DESIGN_SPEC §7.6, §5.3, §5.7-§5.8). OWNER: Simulation Engineer - Strategic World Simulation (SIM-01).
 *
 * Needs: a building in the settlement that unlocks the class, the class in the faction roster, its age reached and not
 * retired, an elephant source for elephants (own an `elephants` settlement, a trade treaty with a faction that does, or
 * the Elephant Fair's breeding rights), recruitPool >= recruits. Cost (wealth from the treasury, grain from the
 * settlement store, recruits from the pool) is paid when queued; mounted classes cost 20% less wealth with a `horses`
 * resource; AI factions pay x DIFFICULTY aiRecruitCost (cost and time). 1-4 formations per job; jobs run one at a time;
 * days = recruitDays x variant recruitDays (x0.7 elephants with the Elephant Grove). Besieged settlements do not
 * recruit. New formations: experience 0.1 + 0.1 per Barracks level above 1 + age recruitBonus; morale = baseMorale x
 * variant + age morale; output to the job's target army, else the rally point, else the garrison. A Supply Train is
 * loaded with up to 3,600 grain from the store when it joins an army.
 */
import type { ArmyUnitState, FactionId, ResourceKind, SettlementState, SimEvent, UnitClass, WorldState } from '../../core/types';
import { UNIT_CLASSES } from '../../core/types';
import { nextWorldId } from '../../core/ids';
import { AGES } from '../../data/ages';
import { BUILDINGS } from '../../data/buildings';
import { DIFFICULTY_DEFS } from '../../data/difficulty';
import { FACTIONS } from '../../data/factions';
import { RULES } from '../../data/rules';
import { UNITS } from '../../data/units';
import { unitAgeReason } from './ages';
import { makeArmy, makeArmyUnit, orderArmy } from './armies';
import { buildingLevel } from './modifiers';
import { activeTreaty } from './treaties';
import { addMonthToDate, addStat, notifyPlayer, regionTerrain, stableKeys, today } from './state';

export const RECRUIT_REASONS = {
  noSettlement: 'No such settlement',
  notOwned: 'Not your settlement',
  unknownClass: 'Unknown unit class',
  notInRoster: 'Your realm does not field this class',
  noBuilding: (cls: string) => `Needs a building that trains ${cls}`,
  elephantSource: 'War elephants need an elephant forest, a trade treaty with one, or breeding rights',
  formations: `Raise 1 to ${RULES.recruitment.maxFormationsPerJob} formations at a time`,
  pool: (n: number) => `Need ${Math.ceil(n)} recruits`,
  grain: (n: number) => `Need ${Math.ceil(n)} grain in the store`,
  wealth: (n: number) => `Need ${Math.ceil(n)} wealth`,
  queueFull: 'The recruitment queue is full (5)',
  besieged: 'A besieged settlement cannot recruit',
  noArmy: 'That army is not yours',
} as const;

const MAX_QUEUE = 5;
/** "Elephants raised 30% faster" (Elephant Grove) - rule without a data field (see report). */
export const LM_ELEPHANT_GROVE = 'lm_elephant_grove';
const ELEPHANT_GROVE_DAYS = 0.7;

function ownsResource(world: WorldState, factionId: FactionId, res: ResourceKind): boolean {
  for (const id of stableKeys('settlements', world.settlements as Record<string, unknown>)) {
    const s = world.settlements[id]!;
    if (s.ownerFactionId === factionId && s.resources.includes(res)) return true;
  }
  return false;
}

/**
 * Faction flag: the day an elephant source bought by event ends (exclusive). Written by events.applyEffect for the event
 * flag 'elephant_source' (The Elephant Fair, 'Buy breeding rights': today + 360).
 */
export const ELEPHANT_SOURCE_UNTIL_FLAG = 'elephant_source_until';

/** War-elephant source (§5.8): an own elephant forest, a trade treaty with a realm that has one, or breeding rights. */
export function hasElephantSource(world: WorldState, factionId: FactionId): boolean {
  if (ownsResource(world, factionId, 'elephants')) return true;
  const until = world.factions[factionId]?.flags[ELEPHANT_SOURCE_UNTIL_FLAG];
  if (typeof until === 'number' && until > today(world)) return true;
  for (const id of stableKeys('settlements', world.settlements as Record<string, unknown>)) {
    const s = world.settlements[id]!;
    const o = s.ownerFactionId;
    if (!o || o === factionId || !s.resources.includes('elephants')) continue;
    if (activeTreaty(world, factionId, o, 'trade')) return true;
  }
  return false;
}

function holdsLandmark(world: WorldState, factionId: FactionId, id: string): boolean {
  if (!world.factions[factionId]?.landmarks.includes(id)) return false;
  for (const sid of stableKeys('settlements', world.settlements as Record<string, unknown>)) {
    const s = world.settlements[sid]!;
    for (const l of s.landmarks) if (l.id === id && l.builtBy === factionId) return s.ownerFactionId === factionId;
  }
  return false;
}

function variantMul(factionId: FactionId, cls: UnitClass, key: 'recruitDays' | 'upkeepWealth' | 'baseMorale'): number {
  return FACTIONS[factionId]?.unitVariants?.[cls]?.multipliers[key] ?? 1;
}

function aiMul(world: WorldState, factionId: FactionId): number {
  return world.factions[factionId]?.isPlayer ? 1 : DIFFICULTY_DEFS[world.difficulty].aiRecruitCost;
}

export interface RecruitCost {
  wealth: number;
  grain: number;
  recruits: number;
  days: number;
}

export function recruitCost(world: WorldState, factionId: FactionId, cls: UnitClass, formations: number): RecruitCost {
  const st = UNITS[cls].stats;
  const mounted = UNITS[cls].category === 'mounted' && ownsResource(world, factionId, 'horses') ? 1 - RULES.recruitment.horsesDiscount : 1;
  const ai = aiMul(world, factionId);
  let days = st.recruitDays * variantMul(factionId, cls, 'recruitDays') * ai;
  if (cls === 'war_elephants' && holdsLandmark(world, factionId, LM_ELEPHANT_GROVE)) days *= ELEPHANT_GROVE_DAYS;
  return { wealth: st.recruitCost.wealth * formations * mounted * ai, grain: st.recruitCost.food * formations, recruits: st.recruitCost.population * formations, days };
}

/** Classes this settlement can train right now (building unlock only). */
export function unlockedHere(s: SettlementState, cls: UnitClass): boolean {
  for (const b of s.buildings) if (b.level > 0 && BUILDINGS[b.type].unlocksUnits.includes(cls)) return true;
  return false;
}

export interface RecruitCheck {
  ok: boolean;
  reason: string | null;
  cost: RecruitCost;
}

export function validateRecruit(world: WorldState, factionId: FactionId, settlementId: string, cls: UnitClass, formations: number, targetArmyId: string | null): RecruitCheck {
  const R = RECRUIT_REASONS;
  const zero: RecruitCost = { wealth: 0, grain: 0, recruits: 0, days: 0 };
  const s = world.settlements[settlementId];
  if (!s) return { ok: false, reason: R.noSettlement, cost: zero };
  if (s.ownerFactionId !== factionId) return { ok: false, reason: R.notOwned, cost: zero };
  if (!(UNIT_CLASSES as readonly string[]).includes(cls)) return { ok: false, reason: R.unknownClass, cost: zero };
  const cost = recruitCost(world, factionId, cls, Math.max(1, Math.floor(formations)));
  const fail = (reason: string): RecruitCheck => ({ ok: false, reason, cost });
  if (!Number.isInteger(formations) || formations < 1 || formations > RULES.recruitment.maxFormationsPerJob) return fail(R.formations);
  if (!(FACTIONS[factionId]?.roster ?? []).includes(cls)) return fail(R.notInRoster);
  const ageReason = unitAgeReason(world, factionId, cls);
  if (ageReason) return fail(ageReason);
  if (!unlockedHere(s, cls)) return fail(R.noBuilding(UNITS[cls].name));
  if (cls === 'war_elephants' && RULES.recruitment.elephantsNeedSource && !hasElephantSource(world, factionId)) return fail(R.elephantSource);
  if (s.besiegedBy) return fail(R.besieged);
  if (s.recruitment.length >= MAX_QUEUE) return fail(R.queueFull);
  if (targetArmyId !== null && world.armies[targetArmyId]?.factionId !== factionId) return fail(R.noArmy);
  if (s.recruitPool < cost.recruits) return fail(R.pool(cost.recruits));
  if (s.foodStored < cost.grain) return fail(R.grain(cost.grain));
  if ((world.factions[factionId]?.treasury ?? 0) < cost.wealth) return fail(R.wealth(cost.wealth));
  return { ok: true, reason: null, cost };
}

export function queueRecruit(world: WorldState, factionId: FactionId, settlementId: string, cls: UnitClass, formations: number, targetArmyId: string | null): RecruitCheck {
  const chk = validateRecruit(world, factionId, settlementId, cls, formations, targetArmyId);
  if (!chk.ok) return chk;
  const s = world.settlements[settlementId]!;
  const f = world.factions[factionId]!;
  f.treasury -= chk.cost.wealth;
  s.foodStored -= chk.cost.grain;
  s.recruitPool -= chk.cost.recruits;
  addMonthToDate(world, factionId, 'recruitment', chk.cost.wealth);
  s.recruitment.push({ unitClass: cls, formations, progress: 0, startedDay: today(world), targetArmyId });
  return chk;
}

/** A newly raised formation with its experience and morale bonuses (§7.6). */
export function newRecruit(world: WorldState, factionId: FactionId, s: SettlementState, cls: UnitClass): ArmyUnitState {
  const u = makeArmyUnit(world, cls);
  const age = AGES[world.factions[factionId]?.age ?? 'janapada'];
  const barracks = buildingLevel(s, 'barracks');
  u.experience = Math.min(1, RULES.recruitment.baseExperience + RULES.recruitment.barracksExperiencePerLevel * Math.max(0, barracks - 1) + age.recruitBonus.experience);
  u.morale = Math.min(100, UNITS[cls].stats.baseMorale * variantMul(factionId, cls, 'baseMorale') + age.recruitBonus.morale);
  return u;
}

/** Advance the settlement's first recruitment job by a day; complete it when done. */
export function progressRecruitment(world: WorldState, s: SettlementState, out: SimEvent[]): void {
  if (s.recruitment.length === 0 || s.besiegedBy) return;
  const fid = s.ownerFactionId;
  if (!fid || !world.factions[fid]) {
    s.recruitment.length = 0;
    return;
  }
  const job = s.recruitment[0]!;
  const days = recruitCost(world, fid, job.unitClass, job.formations).days;
  job.progress += 1 / Math.max(1, days);
  if (job.progress < 1) return;
  s.recruitment.shift();
  const units: ArmyUnitState[] = [];
  for (let i = 0; i < job.formations; i++) units.push(newRecruit(world, fid, s, job.unitClass));
  let army = job.targetArmyId ? world.armies[job.targetArmyId] ?? null : null;
  if (army && army.factionId !== fid) army = null;
  if (!army && s.rallyPoint?.kind === 'army') {
    const ra = world.armies[s.rallyPoint.armyId];
    if (ra && ra.factionId === fid) army = ra;
  }
  if (!army && s.rallyPoint?.kind === 'point') {
    const id = nextWorldId(world, 'army');
    army = makeArmy(world, id, `Levy of ${s.name}`, fid, s.x + s.radius * 0.5, s.z + s.radius * 0.5, [], null);
    world.armies[id] = army;
    orderArmy(world, id, { kind: 'move', x: s.rallyPoint.x, z: s.rallyPoint.z }, regionTerrain(world));
  }
  if (army) {
    for (const u of units) army.units.push(u);
    // Supply trains carry 12 carts x 300 grain from the store.
    let carts = 0;
    for (const u of units) if (u.unitClass === 'supply_train') carts += u.soldiers;
    const capAdd = carts * RULES.supply.cartLoad;
    if (capAdd > 0) {
      const load = Math.min(capAdd, Math.max(0, s.foodStored));
      s.foodStored -= load;
      army.supply.food += load;
    }
    recomputeArmySupplyCapacity(army);
  } else {
    for (const u of units) s.garrison.push(u);
  }
  let soldiers = 0;
  for (const u of units) soldiers += u.soldiers;
  addStat(world, fid, 'soldiers_raised', soldiers);
  out.push({ kind: 'recruitment_complete', settlementId: s.id, unitClass: job.unitClass, armyId: army?.id ?? null });
  notifyPlayer(world, out, fid, 'success', `${job.formations} ${FACTIONS[fid]?.unitVariants?.[job.unitClass]?.name ?? UNITS[job.unitClass].name} raised at ${s.name}.`, { x: s.x, z: s.z });
}

/** Carried capacity = soldiers x upkeepFood x 5 days + carts x 300 (§7.8). */
export function recomputeArmySupplyCapacity(army: WorldState['armies'][string]): void {
  let cap = 0;
  for (const u of army.units) {
    cap += u.soldiers * UNITS[u.unitClass].stats.upkeepFood * RULES.supply.carriedRationDays;
    if (u.unitClass === 'supply_train') cap += u.soldiers * RULES.supply.cartLoad;
  }
  army.supply.foodCapacity = cap;
  if (army.supply.food > cap) army.supply.food = cap;
}
