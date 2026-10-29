/**
 * Internal politics (DESIGN_SPEC §7.9): loyalty, unrest, public order, the rebellion ladder, rebel armies, secession,
 * negotiate_rebels, governors (interests, demands, secession attempts), faction stability and legitimacy.
 * OWNER: Simulation Engineer - Strategic World Simulation (SIM-01).
 *
 * Daily per owned settlement (after economy, armies and sieges):
 *   loyalty += (target - loyalty) x 0.02, target = 0.5 + 0.3 (legitimacy - 0.5) - 1.0 max(0, tax - 0.15) + policy
 *     - 0.15 max(0, price - 1) - min(0.15, requisitioned / (pop x 0.1 x 30) x 0.1) + Σ loyalty effects + governor
 *     - 0.3 unrest - 0.2 occupation (1 -> 0 over 360 days)                                  (`loyaltyTerms`)
 *   unrest += gains x rebelliousness - relief: starving +0.02, +0.01 x (price - 1.3), loyalty < 0.35 +0.002,
 *     overcrowding +0.01 x (pop / housing - 1), sanitation < 0.3 +0.001; order -0.004 x publicOrder, garrison
 *     -min(0.004, soldiers / (pop x 0.02) x 0.002)                                             (`unrestTerms`)
 *   publicOrder drifts 2%/day toward 0.5 + Σ order effects + 0.1 (garrison >= 2% pop) - 0.2 unrest.
 *   Ladder: stage = highest threshold reached (BALANCE.politics.rebellionThresholds); down a stage only below the
 *     threshold - 0.05. Stage effects multiply tax / trade / recruits / production (modifiers.stageEffect, used by
 *     the economy) and wear building condition (riots 0.5%/day, revolt 1%/day).
 *   Revolt: a rebel army (REBEL_FACTION_ID) of pop x 0.03 soldiers, spearmen : archers 2 : 1, besieges the town;
 *     30 days in revolt -> secession (independent; a province capital adds +0.2 unrest to its province). Rebels beaten
 *     in battle -> unrest -0.2 and the revolt ends; appeased below the revolt threshold -> the host disperses.
 * Monthly per faction: stability drifts 10% toward its target, legitimacy (succession settled +0.01 / contested by a
 *   living claimant -0.02), -0.02 per governor above the age's slots, governor loyalty, demands (< 0.3 loyalty and
 *   > 0.6 ambition -> evt_governor_demands) and secession attempts (< 0.15 -> province settlements +0.3 unrest).
 * Player / AI responses: negotiate_rebels (relief / tax cut / autonomy / coercion) and appoint_governor.
 */
import type {
  ArmyState,
  ArmyUnitState,
  CharacterState,
  FactionId,
  FactionState,
  ProvinceState,
  RebellionStage,
  SettlementState,
  SimEvent,
  WorldState,
} from '../../core/types';
import { isRebelFaction, REBEL_FACTION_ID, REBELLION_STAGES } from '../../core/types';
import { nextWorldId, sortedKeys } from '../../core/ids';
import { clamp01 } from '../../core/math';
import { BALANCE } from '../../data/balance';
import { RULES } from '../../data/rules';
import { UNITS } from '../../data/units';
import { makeArmy, makeArmyUnit, removeArmy, SIEGE_CAMP_OFFSET } from './armies';
import { dailyConsumption, governorSlots } from './economy';
import { buildingLevel, emptyMods, rebelliousness, settlementEffects, type ModRecord } from './modifiers';
import { transferOwnership } from './siege';
import { addChronicle, addStat, notifyPlayer, today, worldRandom } from './state';
import { registerWritebackHooks } from './writeback';

const P = RULES.politics;
const TH = BALANCE.politics.rebellionThresholds;

export const POLITICS_REASONS = {
  noSettlement: 'No such settlement',
  notOwned: 'Not your settlement',
  calm: 'The people are calm - there is nothing to negotiate',
  noReserve: (n: number) => `Need ${Math.ceil(n)} grain in the royal reserve`,
  noWealth: (n: number) => `Need ${Math.ceil(n)} wealth`,
  taxCutRunning: 'A tax cut is already in force there',
  noTaxToCut: 'The tax rate is already at zero',
  fullAutonomy: 'The province already rules itself',
  noForce: (n: number) => `Coercion needs a garrison of ${Math.ceil(n)} soldiers or an army at hand`,
  noProvince: 'No such province',
  provinceNotOwned: 'Not your province',
  noCharacter: 'No such character',
  notYourCharacter: 'Not one of your people',
  dead: 'That character is dead',
  captive: 'That character is a prisoner',
  child: 'Governors must be adults',
  ruler: 'The ruler cannot govern a province',
} as const;

// ---------------------------------------------------------------------------------------------------
// Ladder
// ---------------------------------------------------------------------------------------------------

/** Rebellion stage implied by an unrest level alone (no hysteresis). */
export function stageForUnrest(unrest: number): RebellionStage {
  let stage = 0;
  for (let i = 0; i < TH.length; i++) if (unrest >= (TH[i] as number)) stage = i + 1;
  return REBELLION_STAGES[Math.min(stage, REBELLION_STAGES.length - 1)] as RebellionStage;
}

/** Unrest threshold of a stage (0 for calm). */
export function stageThreshold(stage: RebellionStage): number {
  const i = REBELLION_STAGES.indexOf(stage);
  return i <= 0 ? 0 : (TH[i - 1] as number);
}

/** Next stage given the current one (up at once; down one stage at a time below threshold - hysteresis). */
export function nextStage(current: RebellionStage, unrest: number): RebellionStage {
  const raw = REBELLION_STAGES.indexOf(stageForUnrest(unrest));
  let cur = REBELLION_STAGES.indexOf(current);
  if (raw > cur) return REBELLION_STAGES[raw] as RebellionStage;
  while (cur > raw && unrest < (TH[cur - 1] as number) - P.hysteresis) cur--;
  return REBELLION_STAGES[cur] as RebellionStage;
}

export function stageIndex(stage: RebellionStage): number {
  return REBELLION_STAGES.indexOf(stage);
}

// ---------------------------------------------------------------------------------------------------
// Terms (also the UI breakdowns)
// ---------------------------------------------------------------------------------------------------

export interface PoliticsTerm {
  id: string;
  label: string;
  value: number;
}

/** Occupation penalty factor: 1 on the day of capture -> 0 after 360 days. */
export function occupationFactor(world: WorldState, s: SettlementState): number {
  if (s.occupiedSinceDay === null) return 0;
  return Math.max(0, 1 - (today(world) - s.occupiedSinceDay) / RULES.siege.occupationDays);
}

/** Garrison soldiers: garrison formations + own armies garrisoned there. */
export function garrisonSoldiers(world: WorldState, s: SettlementState): number {
  let n = 0;
  for (const u of s.garrison) n += u.soldiers;
  for (const id of sortedKeys(world.armies)) {
    const a = world.armies[id] as ArmyState;
    if (a.factionId !== s.ownerFactionId || a.status !== 'garrisoned' || a.order.kind !== 'garrison' || a.order.settlementId !== s.id) continue;
    for (const u of a.units) n += u.soldiers;
  }
  return n;
}

function provinceOf(world: WorldState, s: SettlementState): ProvinceState | null {
  return world.provinces[s.provinceId] ?? null;
}

/** The governor of a settlement's province when he serves its owner. */
export function governorOf(world: WorldState, s: SettlementState): CharacterState | null {
  const p = provinceOf(world, s);
  const g = p?.governorId ? world.characters[p.governorId] : null;
  if (!g || !g.alive || g.captiveOf || g.factionId !== s.ownerFactionId) return null;
  return g;
}

/** Is a governor's interest satisfied in his province (§7.9)? */
export function interestSatisfied(world: WorldState, gov: CharacterState, p: ProvinceState): boolean {
  const owned = p.settlementIds.map((id) => world.settlements[id]).filter((s): s is SettlementState => !!s && s.ownerFactionId === gov.factionId);
  const f = world.factions[gov.factionId];
  switch (gov.interest) {
    case 'wealth': {
      if (owned.length === 0) return false;
      const avg = owned.reduce((t, s) => t + s.taxRate, 0) / owned.length;
      return avg <= 0.15 + 1e-9;
    }
    case 'power':
      return p.autonomy >= 0.25 || gov.councilSeat !== null;
    case 'faith': {
      const cap = world.settlements[p.capitalSettlementId];
      return !!cap && cap.ownerFactionId === gov.factionId && buildingLevel(cap, 'temple') >= 2;
    }
    case 'family': {
      if (gov.spouseId) return true;
      const heir = f?.heirId ? world.characters[f.heirId] : null;
      return !!heir && (heir.dynastyId !== null && heir.dynastyId === gov.dynastyId || heir.parentIds.includes(gov.id));
    }
    case 'land':
      return owned.length >= 2;
    case 'learning': {
      if (owned.some((s) => buildingLevel(s, 'stupa') > 0)) return true;
      const cap = world.settlements[p.capitalSettlementId];
      return !!cap && settlementEffects(world, cap).culture >= 0.3;
    }
    default:
      return false;
  }
}

/** Governor term of the loyalty target: (loyalty - 0.5) x 0.2 + 0.05 when his interest is satisfied. */
export function governorTerm(world: WorldState, s: SettlementState): number {
  const g = governorOf(world, s);
  const p = provinceOf(world, s);
  if (!g || !p) return 0;
  return (g.loyalty - 0.5) * 0.2 + (interestSatisfied(world, g, p) ? P.governor.interestLoyalty : 0);
}

const scratchMods: ModRecord = emptyMods();

/** Loyalty target terms (§7.9). Sum + 0 = target (unclamped). */
export function loyaltyTerms(world: WorldState, s: SettlementState, mods: ModRecord = settlementEffects(world, s, scratchMods)): PoliticsTerm[] {
  const f = s.ownerFactionId ? world.factions[s.ownerFactionId] : null;
  const legit = f?.legitimacy ?? 0.5;
  const pol = f ? RULES.tax.policy[f.taxPolicy] : null;
  const reqShare = s.requisitionedFood / Math.max(1, s.population * 0.1 * 30);
  return [
    { id: 'base', label: 'Base', value: P.loyaltyBase },
    { id: 'legitimacy', label: 'Legitimacy of the ruler', value: P.loyaltyLegitimacyWeight * (legit - 0.5) },
    { id: 'tax', label: 'Tax above 15%', value: -P.loyaltyTaxWeight * Math.max(0, s.taxRate - 0.15) },
    { id: 'policy', label: 'Tax policy', value: pol?.loyalty ?? 0 },
    { id: 'price', label: 'Grain price', value: -P.loyaltyHungerWeight * Math.max(0, s.grainPrice - 1) },
    { id: 'requisition', label: 'Requisitioned grain', value: -Math.min(0.15, reqShare * 0.1) },
    { id: 'buildings', label: 'Temples and landmarks', value: mods.loyalty },
    { id: 'governor', label: 'Governor', value: governorTerm(world, s) },
    { id: 'unrest', label: 'Unrest', value: -P.loyaltyUnrestWeight * s.unrest },
    { id: 'occupation', label: 'Occupation', value: -0.2 * occupationFactor(world, s) },
  ];
}

export function loyaltyTarget(world: WorldState, s: SettlementState): number {
  let t = 0;
  for (const x of loyaltyTerms(world, s)) t += x.value;
  return clamp01(t);
}

/** Daily unrest terms (§7.9): gains already x sandbox rebelliousness. */
export function unrestTerms(world: WorldState, s: SettlementState): PoliticsTerm[] {
  const U = P.unrest;
  const k = rebelliousness(world);
  const pop = Math.max(1, s.population);
  const garrison = garrisonSoldiers(world, s);
  return [
    { id: 'starving', label: 'Starving', value: s.starvationDays > 0 ? U.starving * k : 0 },
    { id: 'price', label: 'Grain price above 1.3', value: 0.01 * Math.max(0, s.grainPrice - 1.3) * k },
    { id: 'loyalty', label: 'Low loyalty', value: s.loyalty < U.lowLoyaltyBelow ? U.lowLoyalty * k : 0 },
    { id: 'overcrowding', label: 'Overcrowding', value: U.overcrowding * Math.max(0, pop / Math.max(1, s.housing) - 1) * k },
    { id: 'sanitation', label: 'Poor sanitation', value: s.sanitation < U.poorSanitationBelow ? U.poorSanitation * k : 0 },
    { id: 'order', label: 'Public order', value: -U.orderRelief * s.publicOrder },
    { id: 'garrison', label: 'Garrison', value: -Math.min(0.004, (garrison / (pop * 0.02)) * U.garrisonRelief) },
  ];
}

export function unrestDelta(world: WorldState, s: SettlementState): number {
  let d = 0;
  for (const x of unrestTerms(world, s)) d += x.value;
  return d;
}

// ---------------------------------------------------------------------------------------------------
// Rebels and secession
// ---------------------------------------------------------------------------------------------------

/** Rebel armies fighting for a settlement. */
export function rebelArmiesOf(world: WorldState, settlementId: string): ArmyState[] {
  const out: ArmyState[] = [];
  for (const id of sortedKeys(world.armies)) {
    const a = world.armies[id] as ArmyState;
    if (isRebelFaction(a.factionId) && a.rebelSettlementId === settlementId) out.push(a);
  }
  return out;
}

function formationsOf(world: WorldState, unitClass: 'spearmen' | 'archers', soldiers: number): ArmyUnitState[] {
  const per = UNITS[unitClass].stats.menPerFormation;
  const out: ArmyUnitState[] = [];
  let left = soldiers;
  while (left > 0) {
    const n = Math.min(per, left);
    const u = makeArmyUnit(world, unitClass, n);
    u.experience = 0;
    out.push(u);
    left -= n;
  }
  return out;
}

/** Revolt: raise the rebel host (pop x 0.03 soldiers; spearmen : archers 2 : 1) outside the walls. */
export function spawnRebels(world: WorldState, s: SettlementState, out: SimEvent[]): ArmyState | null {
  if (rebelArmiesOf(world, s.id).length > 0) return null;
  const soldiers = Math.max(3, Math.round(s.population * P.rebelSoldiersPerCapita));
  const spears = Math.round((soldiers * 2) / 3);
  const archers = soldiers - spears;
  const id = nextWorldId(world, 'army');
  const a = makeArmy(world, id, `Rebels of ${s.name}`, REBEL_FACTION_ID, s.x + s.radius + SIEGE_CAMP_OFFSET, s.z, [], null);
  a.units = [...formationsOf(world, 'spearmen', spears), ...formationsOf(world, 'archers', archers)];
  a.rebelSettlementId = s.id;
  a.stance = 'cautious';
  a.status = 'besieging';
  a.order = { kind: 'besiege', settlementId: s.id };
  a.morale = 60;
  a.supply.foodCapacity = a.supply.food;
  world.armies[id] = a;
  s.population = Math.max(0, s.population - soldiers);
  if (!s.besiegedBy) {
    s.besiegedBy = id;
    s.siegeDays = 0;
    s.ladderProgress = 0;
  }
  out.push({ kind: 'rebels_spawned', settlementId: s.id, armyId: id, soldiers });
  addChronicle(world, s.ownerFactionId, `${s.name} rose in revolt; ${soldiers} rebels took up arms.`, 2);
  notifyPlayer(world, out, s.ownerFactionId, 'danger', `${s.name} is in revolt - ${soldiers} rebels besiege the town.`, { x: s.x, z: s.z });
  return a;
}

/** The rebel host disperses (appeased): its men go home. */
function disperseRebels(world: WorldState, s: SettlementState): void {
  for (const a of rebelArmiesOf(world, s.id)) {
    for (const u of a.units) s.population += u.soldiers;
    removeArmy(world, a, false);
  }
}

/** Secession: the settlement becomes independent; a province capital unsettles its whole province (+0.2). */
export function secede(world: WorldState, s: SettlementState, out: SimEvent[]): void {
  const from = s.ownerFactionId;
  if (!from) return;
  const prov = provinceOf(world, s);
  const wasCapital = !!prov && prov.capitalSettlementId === s.id;
  // The rebels become the town's garrison.
  for (const a of rebelArmiesOf(world, s.id)) {
    s.garrison.push(...a.units);
    a.units = [];
    removeArmy(world, a, false);
  }
  transferOwnership(world, s, null, out);
  s.revoltSinceDay = null;
  s.occupiedSinceDay = null;
  s.unrest = 0.1;
  s.loyalty = 0.5;
  s.rebellionStage = 'calm';
  s.besiegedBy = null;
  s.siegeDays = 0;
  if (wasCapital && prov) {
    for (const sid of prov.settlementIds) {
      const o = world.settlements[sid];
      if (o && o.id !== s.id && o.ownerFactionId) o.unrest = clamp01(o.unrest + 0.2);
    }
  }
  addStat(world, from, 'settlements_lost_to_rebels', 1);
  out.push({ kind: 'secession', settlementId: s.id, from });
  out.push({ kind: 'rebellion_stage', settlementId: s.id, stage: 'secession' });
  addChronicle(world, from, `${s.name} broke away from the realm.`, 2);
  notifyPlayer(world, out, from, 'danger', `${s.name} has seceded and is now independent.`, { x: s.x, z: s.z });
}

/** Rebels beaten in battle: the revolt collapses (unrest -0.2). */
export function rebelsDefeated(world: WorldState, settlementId: string, out: SimEvent[]): void {
  const s = world.settlements[settlementId];
  if (!s) return;
  disperseRebels(world, s);
  s.unrest = clamp01(Math.min(s.unrest, stageThreshold('revolt') - P.hysteresis - 0.001) - 0.2);
  s.revoltSinceDay = null;
  if (s.besiegedBy && !world.armies[s.besiegedBy]) {
    s.besiegedBy = null;
    s.siegeDays = 0;
  }
  setStage(world, s, nextStage(s.rebellionStage, s.unrest), out);
  addChronicle(world, s.ownerFactionId, `The revolt in ${s.name} was put down.`, 1);
  notifyPlayer(world, out, s.ownerFactionId, 'success', `The rebels of ${s.name} are scattered.`, { x: s.x, z: s.z });
}

registerWritebackHooks({ rebelsDefeated });

/** Apply a stage change with its consequences (notifications, revolt start / end). */
function setStage(world: WorldState, s: SettlementState, stage: RebellionStage, out: SimEvent[]): void {
  const prev = s.rebellionStage;
  if (stage === prev) return;
  s.rebellionStage = stage;
  out.push({ kind: 'rebellion_stage', settlementId: s.id, stage });
  const up = stageIndex(stage) > stageIndex(prev);
  if (up && stage === 'grumbling') notifyPlayer(world, out, s.ownerFactionId, 'warning', `The people of ${s.name} are grumbling.`, { x: s.x, z: s.z });
  const revoltIdx = stageIndex('revolt');
  if (stageIndex(stage) >= revoltIdx && stageIndex(prev) < revoltIdx) {
    s.revoltSinceDay = today(world);
    spawnRebels(world, s, out);
  } else if (stageIndex(stage) < revoltIdx && stageIndex(prev) >= revoltIdx) {
    s.revoltSinceDay = null;
    disperseRebels(world, s);
  }
}

/**
 * Force a stage (event effect `set_rebellion_stage`): unrest rises to the stage's threshold so the ladder holds it;
 * 'secession' secedes at once.
 */
export function forceRebellionStage(world: WorldState, s: SettlementState, stage: RebellionStage, out: SimEvent[]): void {
  if (!s.ownerFactionId) return;
  if (stage === 'secession') {
    secede(world, s, out);
    return;
  }
  s.unrest = Math.max(s.unrest, stageThreshold(stage));
  setStage(world, s, stage, out);
}

// ---------------------------------------------------------------------------------------------------
// Daily
// ---------------------------------------------------------------------------------------------------

export function updatePoliticsDaily(world: WorldState, out: SimEvent[]): void {
  const d = today(world);
  for (const id of sortedKeys(world.settlements)) {
    const s = world.settlements[id] as SettlementState;
    if (!s.ownerFactionId) continue;
    // Expiring tax relief restores the rate.
    if (s.taxRelief && d >= s.taxRelief.untilDay) {
      s.taxRate = Math.min(0.6, s.taxRate + s.taxRelief.points);
      s.taxRelief = null;
    }
    if (s.occupiedSinceDay !== null && occupationFactor(world, s) <= 0) s.occupiedSinceDay = null;
    const mods = settlementEffects(world, s, scratchMods);
    // Public order.
    const pop = Math.max(1, s.population);
    const garrisoned = garrisonSoldiers(world, s) >= pop * P.offers.coercion.garrisonPerCapita;
    const st = RULES.settlement;
    const orderTarget = clamp01(st.orderBase + mods.publicOrder + (garrisoned ? st.orderGarrison : 0) - st.orderUnrest * s.unrest);
    s.publicOrder = clamp01(s.publicOrder + (orderTarget - s.publicOrder) * st.driftPerDay);
    // Unrest, then loyalty toward its target.
    s.unrest = clamp01(s.unrest + unrestDelta(world, s));
    let target = 0;
    for (const t of loyaltyTerms(world, s, mods)) target += t.value;
    s.loyalty = clamp01(s.loyalty + (clamp01(target) - s.loyalty) * P.loyaltyApproachPerDay);
    // Ladder.
    setStage(world, s, nextStage(s.rebellionStage, s.unrest), out);
    if (!s.ownerFactionId) continue;
    const eff = P.stageEffects[s.rebellionStage];
    if (eff.conditionLossPerDay > 0) for (const b of s.buildings) b.condition = Math.max(0.1, b.condition - eff.conditionLossPerDay);
    // A revolt that lasts 30 days ends in secession; rebels who were beaten or dispersed restart the clock.
    if (s.revoltSinceDay !== null && stageIndex(s.rebellionStage) >= stageIndex('revolt')) {
      if (rebelArmiesOf(world, s.id).length === 0 && d > s.revoltSinceDay) spawnRebels(world, s, out);
      if (d - s.revoltSinceDay >= P.secessionAfterDaysInRevolt) secede(world, s, out);
    }
  }
  // Province summaries (UI): worst stage and mean unrest of the owned settlements.
  for (const pid of sortedKeys(world.provinces)) {
    const p = world.provinces[pid] as ProvinceState;
    let n = 0;
    let u = 0;
    let worst = 0;
    for (const sid of p.settlementIds) {
      const s = world.settlements[sid];
      if (!s || !s.ownerFactionId) continue;
      n++;
      u += s.unrest;
      worst = Math.max(worst, stageIndex(s.rebellionStage));
    }
    p.unrest = n > 0 ? u / n : 0;
    p.rebellionStage = REBELLION_STAGES[worst] as RebellionStage;
  }
}

// ---------------------------------------------------------------------------------------------------
// negotiate_rebels
// ---------------------------------------------------------------------------------------------------

export type RebelOffer = 'relief' | 'tax_cut' | 'autonomy' | 'coercion';

/** Costs of a relief offer: 30 days of grain from the royal reserve + 2 wealth per 100 people. */
export function reliefCost(world: WorldState, s: SettlementState): { food: number; wealth: number } {
  const o = P.offers.relief;
  return { food: dailyConsumption(world, s) * o.foodDays, wealth: (s.population / 100) * o.wealthPer100Pop };
}

function forceAtHand(world: WorldState, s: SettlementState): boolean {
  if (garrisonSoldiers(world, s) >= s.population * P.offers.coercion.garrisonPerCapita) return true;
  for (const id of sortedKeys(world.armies)) {
    const a = world.armies[id] as ArmyState;
    if (a.factionId !== s.ownerFactionId || a.units.length === 0) continue;
    const d2 = (a.x - s.x) * (a.x - s.x) + (a.z - s.z) * (a.z - s.z);
    const r = s.radius + RULES.supply.resupplyRadius;
    if (d2 <= r * r) return true;
  }
  return false;
}

export function validateNegotiation(world: WorldState, factionId: FactionId, settlementId: string, offer: RebelOffer): string | null {
  const s = world.settlements[settlementId];
  if (!s) return POLITICS_REASONS.noSettlement;
  if (s.ownerFactionId !== factionId) return POLITICS_REASONS.notOwned;
  if (s.rebellionStage === 'calm' && s.unrest < TH[0]!) return POLITICS_REASONS.calm;
  const f = world.factions[factionId] as FactionState;
  switch (offer) {
    case 'relief': {
      const c = reliefCost(world, s);
      if (f.foodReserve < c.food) return POLITICS_REASONS.noReserve(c.food);
      if (f.treasury < c.wealth) return POLITICS_REASONS.noWealth(c.wealth);
      return null;
    }
    case 'tax_cut':
      if (s.taxRelief) return POLITICS_REASONS.taxCutRunning;
      if (s.taxRate <= 0) return POLITICS_REASONS.noTaxToCut;
      return null;
    case 'autonomy':
      if ((provinceOf(world, s)?.autonomy ?? 0) >= 1) return POLITICS_REASONS.fullAutonomy;
      return null;
    case 'coercion':
      if (!forceAtHand(world, s)) return POLITICS_REASONS.noForce(s.population * P.offers.coercion.garrisonPerCapita);
      return null;
    default:
      return 'Unknown offer';
  }
}

/** negotiate_rebels (§7.9). Returns a refusal reason or null. */
export function negotiateRebels(world: WorldState, factionId: FactionId, settlementId: string, offer: RebelOffer, out: SimEvent[]): string | null {
  const reason = validateNegotiation(world, factionId, settlementId, offer);
  if (reason) return reason;
  const s = world.settlements[settlementId] as SettlementState;
  const f = world.factions[factionId] as FactionState;
  const O = P.offers;
  let text = '';
  switch (offer) {
    case 'relief': {
      const c = reliefCost(world, s);
      f.foodReserve -= c.food;
      f.treasury -= c.wealth;
      s.foodStored += c.food;
      s.unrest = clamp01(s.unrest + O.relief.unrest);
      s.loyalty = clamp01(s.loyalty + O.relief.loyalty);
      text = `Relief reached ${s.name}: grain and silver for the hungry.`;
      break;
    }
    case 'tax_cut': {
      const points = Math.min(-O.tax_cut.rateDelta, s.taxRate);
      s.taxRate -= points;
      s.taxRelief = { points, untilDay: today(world) + O.tax_cut.days };
      s.unrest = clamp01(s.unrest + O.tax_cut.unrest);
      s.loyalty = clamp01(s.loyalty + O.tax_cut.loyalty);
      text = `Taxes in ${s.name} were cut for half a year.`;
      break;
    }
    case 'autonomy': {
      const p = provinceOf(world, s);
      if (p) {
        p.autonomy = Math.min(1, p.autonomy + O.autonomy.autonomy);
        const g = p.governorId ? world.characters[p.governorId] : null;
        if (g && g.alive) g.loyalty = clamp01(g.loyalty + O.autonomy.governorLoyalty);
      }
      s.unrest = clamp01(s.unrest + O.autonomy.unrest);
      f.legitimacy = clamp01(f.legitimacy + O.autonomy.legitimacy);
      text = `${p?.name ?? s.name} was granted a measure of self-rule.`;
      break;
    }
    case 'coercion': {
      const C = O.coercion;
      if (s.loyalty < C.backfireChanceBelowLoyalty && worldRandom(world) < C.backfireChance) {
        const next = REBELLION_STAGES[Math.min(REBELLION_STAGES.length - 1, stageIndex(s.rebellionStage) + 1)] as RebellionStage;
        if (next === 'secession') s.unrest = Math.max(s.unrest, stageThreshold('secession'));
        else forceRebellionStage(world, s, next, out);
        s.loyalty = clamp01(s.loyalty + C.loyalty);
        addChronicle(world, factionId, `Soldiers in ${s.name} only fanned the flames.`, 1);
        notifyPlayer(world, out, factionId, 'danger', `Coercion backfired in ${s.name}!`, { x: s.x, z: s.z });
        return null;
      }
      s.unrest = clamp01(s.unrest + C.unrest);
      s.loyalty = clamp01(s.loyalty + C.loyalty);
      text = `Order was restored in ${s.name} at spear-point.`;
      break;
    }
  }
  addChronicle(world, factionId, text, 1);
  setStage(world, s, nextStage(s.rebellionStage, s.unrest), out);
  notifyPlayer(world, out, factionId, 'info', text, { x: s.x, z: s.z });
  return null;
}

// ---------------------------------------------------------------------------------------------------
// Governors
// ---------------------------------------------------------------------------------------------------

export function governorsOf(world: WorldState, factionId: FactionId): ProvinceState[] {
  const out: ProvinceState[] = [];
  for (const pid of sortedKeys(world.provinces)) {
    const p = world.provinces[pid] as ProvinceState;
    if (p.ownerFactionId !== factionId || !p.governorId) continue;
    const g = world.characters[p.governorId];
    if (g && g.alive && g.factionId === factionId) out.push(p);
  }
  return out;
}

export function validateAppointGovernor(world: WorldState, factionId: FactionId, provinceId: string, characterId: string | null): string | null {
  const p = world.provinces[provinceId];
  if (!p) return POLITICS_REASONS.noProvince;
  if (p.ownerFactionId !== factionId) return POLITICS_REASONS.provinceNotOwned;
  if (characterId === null) return null;
  const c = world.characters[characterId];
  if (!c) return POLITICS_REASONS.noCharacter;
  if (c.factionId !== factionId) return POLITICS_REASONS.notYourCharacter;
  if (!c.alive) return POLITICS_REASONS.dead;
  if (c.captiveOf) return POLITICS_REASONS.captive;
  if (world.calendar.year - c.birthYear < RULES.dynasty.adultAge) return POLITICS_REASONS.child;
  if (world.factions[factionId]?.rulerId === c.id) return POLITICS_REASONS.ruler;
  return null;
}

/** appoint_governor: one governor per province (null dismisses). Moving a governor vacates his old province. */
export function appointGovernor(world: WorldState, factionId: FactionId, provinceId: string, characterId: string | null, out: SimEvent[]): string | null {
  const reason = validateAppointGovernor(world, factionId, provinceId, characterId);
  if (reason) return reason;
  const p = world.provinces[provinceId] as ProvinceState;
  const old = p.governorId ? world.characters[p.governorId] : null;
  if (old) {
    old.governsProvinceId = null;
    old.roles = old.roles.filter((r) => r !== 'governor');
    if (characterId !== old.id) old.loyalty = clamp01(old.loyalty - 0.1); // dismissed
  }
  p.governorId = null;
  if (characterId) {
    const c = world.characters[characterId] as CharacterState;
    if (c.governsProvinceId && c.governsProvinceId !== provinceId) {
      const prev = world.provinces[c.governsProvinceId];
      if (prev && prev.governorId === c.id) prev.governorId = null;
    }
    c.governsProvinceId = provinceId;
    if (!c.roles.includes('governor')) c.roles.push('governor');
    p.governorId = c.id;
    const slots = governorSlots(world, factionId);
    if (governorsOf(world, factionId).length > slots) notifyPlayer(world, out, factionId, 'warning', `More governors than the age allows (${slots}): legitimacy -0.02 a month for each extra one.`);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------
// Monthly: stability, legitimacy, governors
// ---------------------------------------------------------------------------------------------------

/** A living, free claimant pressing against the ruler (role 'claimant', loyalty < 0.5). */
export function pressingClaimant(world: WorldState, factionId: FactionId): CharacterState | null {
  for (const id of sortedKeys(world.characters)) {
    const c = world.characters[id] as CharacterState;
    if (!c.alive || c.captiveOf || !c.roles.includes('claimant') || c.loyalty >= 0.5) continue;
    if (c.factionId === factionId) return c;
  }
  return null;
}

/** Stability target terms (§7.9). */
export function stabilityTerms(world: WorldState, factionId: FactionId): PoliticsTerm[] {
  const f = world.factions[factionId] as FactionState;
  const S = P.stability;
  let n = 0;
  let loyal = 0;
  let troubled = 0;
  for (const id of sortedKeys(world.settlements)) {
    const s = world.settlements[id] as SettlementState;
    if (s.ownerFactionId !== factionId) continue;
    n++;
    loyal += s.loyalty;
    if (stageIndex(s.rebellionStage) >= stageIndex('protest')) troubled++;
  }
  const d = today(world);
  let longWars = 0;
  for (const key of sortedKeys(world.diplomacy.relations)) {
    const r = world.diplomacy.relations[key]!;
    if (!r.atWar || (r.a !== factionId && r.b !== factionId) || r.warStartDay === null) continue;
    if (d - r.warStartDay > S.warWearinessAfterMonths * 30) longWars++;
  }
  let won = 0;
  let lost = 0;
  for (const o of world.battleHistory) {
    if (o.day === null || d - o.day > 90 || o.winner === null) continue;
    const w = o.sides[o.winner].factionId;
    const l = o.sides[o.winner === 0 ? 1 : 0].factionId;
    if (w === factionId) won++;
    else if (l === factionId) lost++;
  }
  return [
    { id: 'base', label: 'Base', value: S.base },
    { id: 'legitimacy', label: 'Legitimacy', value: S.legitimacyWeight * (f.legitimacy - 0.5) },
    { id: 'loyalty', label: 'Loyal settlements', value: S.loyaltyWeight * (n > 0 ? loyal / n : 0.5) },
    { id: 'unrest', label: 'Settlements in protest or worse', value: -S.unrestShareWeight * (n > 0 ? troubled / n : 0) },
    { id: 'wars', label: 'Long wars', value: -S.perWar * longWars },
    { id: 'victories', label: 'Recent victories', value: S.recentVictory * won },
    { id: 'defeats', label: 'Recent defeats', value: S.recentDefeat * lost },
  ];
}

export function stabilityTarget(world: WorldState, factionId: FactionId): number {
  let t = 0;
  for (const x of stabilityTerms(world, factionId)) t += x.value;
  return clamp01(t);
}

function rulerAdult(world: WorldState, f: FactionState): boolean {
  const r = f.rulerId ? world.characters[f.rulerId] : null;
  return !!r && r.alive && world.calendar.year - r.birthYear >= RULES.dynasty.adultAge;
}

/** Governor loyalty drift (monthly, 10% of the gap): 0.5 + 0.15 interest satisfied / -0.1 not, -0.2 x province unrest, + 0.2 x (legitimacy - 0.5). */
export function governorLoyaltyTarget(world: WorldState, g: CharacterState, p: ProvinceState): number {
  const f = world.factions[g.factionId];
  return clamp01(0.5 + (interestSatisfied(world, g, p) ? 0.15 : -0.1) - 0.2 * p.unrest + 0.2 * ((f?.legitimacy ?? 0.5) - 0.5));
}

export function updatePoliticsMonthly(world: WorldState, out: SimEvent[]): void {
  const d = today(world);
  const G = P.governor;
  for (const fid of sortedKeys(world.factions)) {
    const f = world.factions[fid] as FactionState;
    if (!f.alive) continue;
    // Stability.
    f.stability = clamp01(f.stability + (stabilityTarget(world, fid) - f.stability) * P.stability.driftPerMonth);
    // Legitimacy: a settled succession under an adult ruler, or a contested one.
    const heir = f.heirId ? world.characters[f.heirId] : null;
    const claimant = pressingClaimant(world, fid);
    if (claimant && (!heir || !heir.alive)) f.legitimacy = clamp01(f.legitimacy + P.legitimacy.unresolvedWithClaimantPerMonth);
    else if (heir && heir.alive && !claimant && rulerAdult(world, f)) f.legitimacy = clamp01(f.legitimacy + P.legitimacy.resolvedPerMonth);
    // Governors above the age's slots.
    const govs = governorsOf(world, fid);
    const extra = Math.max(0, govs.length - governorSlots(world, fid));
    if (extra > 0) f.legitimacy = clamp01(f.legitimacy + extra * P.overSlotLegitimacyPerMonth);
    // Governor loyalty, demands and secession attempts.
    for (const p of govs) {
      const g = world.characters[p.governorId as string] as CharacterState;
      g.loyalty = clamp01(g.loyalty + (governorLoyaltyTarget(world, g, p) - g.loyalty) * 0.1);
      g.opinionOfRuler = Math.round((g.loyalty - 0.5) * 200);
      const cap = world.settlements[p.capitalSettlementId];
      if (g.loyalty < G.secedeBelowLoyalty) {
        const key = `gov_secession_${g.id}`;
        const last = typeof f.flags[key] === 'number' ? (f.flags[key] as number) : -Infinity;
        if (d - last >= 360) {
          f.flags[key] = d;
          for (const sid of p.settlementIds) {
            const s = world.settlements[sid];
            if (s && s.ownerFactionId === fid) s.unrest = clamp01(s.unrest + 0.3);
          }
          addChronicle(world, fid, `${g.name}, governor of ${p.name}, raised his own banner.`, 2);
          notifyPlayer(world, out, fid, 'danger', `${g.name} is trying to take ${p.name} out of the realm!`, cap ? { x: cap.x, z: cap.z } : null);
        }
      } else if (g.loyalty < G.demandBelowLoyalty && g.ambition > G.demandAmbitionAbove) {
        const key = `gov_demand_${g.id}`;
        const last = typeof f.flags[key] === 'number' ? (f.flags[key] as number) : -Infinity;
        if (d - last >= 90 && !world.events.scheduled.some((e) => e.eventId === 'evt_governor_demands' && e.scope.factionId === fid)) {
          f.flags[key] = d;
          world.events.scheduled.push({ eventId: 'evt_governor_demands', day: d, scope: { factionId: fid, settlementId: p.capitalSettlementId, provinceId: p.id, characterId: g.id, armyId: null } });
          out.push({ kind: 'governor_demand', provinceId: p.id, characterId: g.id });
        }
      }
    }
  }
}

// Characters, succession and the council live in dynasty.ts / council.ts (re-exported for existing callers).
export { checkSuccession, updateCharactersYearly } from './dynasty';
export { getCouncilRecommendations } from './council';
