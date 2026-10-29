/**
 * Pure read-only selectors for the UI (world HUD, settlement / army / realm panels, command card, victory panel,
 * statistics). OWNER: Simulation Engineer - Strategic World Simulation (SIM-01).
 *
 * Nothing here mutates the world; every function returns fresh plain data. The UI calls these with the WorldState it
 * receives from the session (`SessionView`), and enables buttons with `commandReason` (the exact refusal the sim
 * would give). Re-exports gather the lower-level selectors so screens import from one place.
 */
import type {
  AgeId,
  ArmyState,
  BuildingType,
  ConstructionJob,
  FactionId,
  FactionLedger,
  IssuedStrategicCommand,
  MarketResource,
  RebellionStage,
  StrategicCommand,
  UnitClass,
  WorldState,
} from '../../core/types';
import { BUILDING_TYPES, UNIT_CLASSES } from '../../core/types';

const MARKET_RESOURCES: readonly MarketResource[] = ['grain', 'timber', 'stone'];
import { BUILDINGS } from '../../data/buildings';
import { ageChecklist, landmarkOptions, type AgeChecklist, type LandmarkOption } from './ages';
import { validateCommand } from './commands';
import { constructionStage, jobCrew, jobDays, validateBuild } from './construction';
import { reserveColor, reserveDays, projectLedger, settlementFoodBalance, type SettlementFoodReport } from './economy';
import { garrisonSoldiers, loyaltyTerms, unrestTerms, type PoliticsTerm } from './politics';
import { quoteMarketTrade, type MarketQuote } from './market';
import { validateRecruit } from './recruitment';
import { armyFoodNeed, supplyDays } from './supply';
import { maxWallHp } from './construction';
import { surrenderChance } from './siege';
import { villagerAllocation, type VillagerAllocation } from './villagers';
import { victoryBreakdowns, type VictoryBreakdown } from './victory';
import { totalDays } from './seasons';
import { stableKeys } from './state';

export { intelView, type IntelView } from './espionage';
export { predictBattle } from './autoresolve';
export { computeScore, endGameStats } from './statistics';
export { getCouncilRecommendations } from './council';
export { evaluateAcceptance } from './diplomacy';
export { availableHeroMissions } from './hero';
export { stabilityTerms } from './politics';

/** Why a command would be refused right now (null = it would be accepted). */
export function commandReason(world: WorldState, factionId: FactionId, cmd: StrategicCommand): string | null {
  const issued: IssuedStrategicCommand = { factionId, hour: world.calendar.totalHours, cmd };
  return validateCommand(world, issued);
}

// ---------------------------------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------------------------------

export interface ConstructionView {
  index: number;
  type: BuildingType;
  landmarkId: string | null;
  targetLevel: number;
  progress: number;
  stage: ReturnType<typeof constructionStage>;
  daysLeft: number | null;
}

export interface SettlementVitals {
  id: string;
  name: string;
  ownerFactionId: FactionId | null;
  population: number;
  housing: number;
  reserveDays: number;
  reserveColor: 'green' | 'amber' | 'red';
  grainPrice: number;
  food: SettlementFoodReport;
  unrest: number;
  loyalty: number;
  publicOrder: number;
  health: number;
  sanitation: number;
  stage: RebellionStage;
  revoltSinceDay: number | null;
  taxRate: number;
  wealth: number;
  recruitPool: number;
  recruitmentPotential: number;
  garrisonSoldiers: number;
  fortLevel: number;
  wallHp: number;
  maxWallHp: number;
  besiegedBy: string | null;
  surrenderChance: number;
  construction: ConstructionView[];
  recruitment: { unitClass: UnitClass; formations: number; progress: number }[];
  loyaltyTerms: PoliticsTerm[];
  unrestTerms: PoliticsTerm[];
}

export function settlementVitals(world: WorldState, settlementId: string): SettlementVitals | null {
  const s = world.settlements[settlementId];
  if (!s) return null;
  const rd = reserveDays(s);
  return {
    id: s.id,
    name: s.name,
    ownerFactionId: s.ownerFactionId,
    population: s.population,
    housing: s.housing,
    reserveDays: rd,
    reserveColor: reserveColor(rd),
    grainPrice: s.grainPrice,
    food: settlementFoodBalance(world, s),
    unrest: s.unrest,
    loyalty: s.loyalty,
    publicOrder: s.publicOrder,
    health: s.health,
    sanitation: s.sanitation,
    stage: s.rebellionStage,
    revoltSinceDay: s.revoltSinceDay,
    taxRate: s.taxRate,
    wealth: s.wealth,
    recruitPool: s.recruitPool,
    recruitmentPotential: s.recruitmentPotential,
    garrisonSoldiers: garrisonSoldiers(world, s),
    fortLevel: s.fortLevel,
    wallHp: s.wallHp,
    maxWallHp: maxWallHp(world, s),
    besiegedBy: s.besiegedBy,
    surrenderChance: surrenderChance(s),
    construction: s.construction.map((j: ConstructionJob, index) => ({
      index,
      type: j.type,
      landmarkId: j.landmarkId ?? null,
      targetLevel: j.targetLevel,
      progress: j.progress,
      stage: constructionStage(j.progress),
      daysLeft: j.laborAssigned > 0 ? Math.ceil((1 - j.progress) * jobDays(j) * (jobCrew(j) / j.laborAssigned)) : null,
    })),
    recruitment: s.recruitment.map((r) => ({ unitClass: r.unitClass, formations: r.formations, progress: r.progress })),
    loyaltyTerms: s.ownerFactionId ? loyaltyTerms(world, s) : [],
    unrestTerms: s.ownerFactionId ? unrestTerms(world, s) : [],
  };
}

/** Villager counts the renderer shows (§8.3). */
export function settlementVillagers(world: WorldState, settlementId: string, cap: number): VillagerAllocation | null {
  const s = world.settlements[settlementId];
  return s ? villagerAllocation(s, cap) : null;
}

export interface BuildOption {
  building: BuildingType;
  name: string;
  reason: string | null;
  targetLevel: number;
  cost: { wealth: number; timber: number; stone: number; labor: number };
  days: number;
  upgrade: boolean;
}

/** Command-card build options with costs and the refusal reason of each. */
export function buildOptions(world: WorldState, factionId: FactionId, settlementId: string): BuildOption[] {
  return BUILDING_TYPES.map((b) => {
    const chk = validateBuild(world, factionId, settlementId, b);
    return { building: b, name: BUILDINGS[b].name, reason: chk.reason, targetLevel: chk.targetLevel, cost: chk.cost, days: chk.days, upgrade: chk.upgrade };
  });
}

export interface RecruitOption {
  unitClass: UnitClass;
  reason: string | null;
  cost: { wealth: number; grain: number; recruits: number; days: number };
}

export function recruitOptions(world: WorldState, factionId: FactionId, settlementId: string): RecruitOption[] {
  return UNIT_CLASSES.map((cls) => {
    const chk = validateRecruit(world, factionId, settlementId, cls, 1, null);
    return { unitClass: cls, reason: chk.reason, cost: chk.cost };
  });
}

// ---------------------------------------------------------------------------------------------------
// Army
// ---------------------------------------------------------------------------------------------------

export interface ArmySupplyView {
  armyId: string;
  soldiers: number;
  food: number;
  capacity: number;
  needPerDay: number;
  days: number;
  lineIntact: boolean;
  foraging: boolean;
  starvationDays: number;
  morale: number;
  fatigue: number;
  forcedMarch: boolean;
}

export function armySupplyView(world: WorldState, armyId: string): ArmySupplyView | null {
  const a: ArmyState | undefined = world.armies[armyId];
  if (!a) return null;
  return {
    armyId: a.id,
    soldiers: a.units.reduce((t, u) => t + u.soldiers, 0),
    food: a.supply.food,
    capacity: a.supply.foodCapacity,
    needPerDay: armyFoodNeed(world, a),
    days: supplyDays(world, a),
    lineIntact: a.supply.lineIntact,
    foraging: a.supply.foraging,
    starvationDays: a.supply.starvationDays,
    morale: a.morale,
    fatigue: a.fatigue,
    forcedMarch: a.forcedMarch,
  };
}

// ---------------------------------------------------------------------------------------------------
// Realm
// ---------------------------------------------------------------------------------------------------

export interface RealmOverview {
  factionId: FactionId;
  treasury: number;
  foodReserve: number;
  timber: number;
  stone: number;
  stability: number;
  legitimacy: number;
  prestige: number;
  age: AgeId;
  culturePoints: number;
  prosperityDays: number;
  settlements: number;
  population: number;
  soldiers: number;
  wars: FactionId[];
  /** Last completed month and the projection for this month. */
  ledger: FactionLedger;
  projected: FactionLedger;
}

export function realmOverview(world: WorldState, factionId: FactionId): RealmOverview | null {
  const f = world.factions[factionId];
  if (!f) return null;
  let settlements = 0;
  let population = 0;
  for (const id of stableKeys('settlements', world.settlements as Record<string, unknown>)) {
    const s = world.settlements[id]!;
    if (s.ownerFactionId !== factionId) continue;
    settlements++;
    population += s.population;
  }
  let soldiers = 0;
  for (const id of stableKeys('armies', world.armies as Record<string, unknown>)) {
    const a = world.armies[id]!;
    if (a.factionId === factionId) for (const u of a.units) soldiers += u.soldiers;
  }
  const wars: FactionId[] = [];
  for (const key of stableKeys('relations', world.diplomacy.relations as Record<string, unknown>)) {
    const r = world.diplomacy.relations[key]!;
    if (r.atWar && (r.a === factionId || r.b === factionId)) wars.push(r.a === factionId ? r.b : r.a);
  }
  return {
    factionId,
    treasury: f.treasury,
    foodReserve: f.foodReserve,
    timber: f.materials.timber,
    stone: f.materials.stone,
    stability: f.stability,
    legitimacy: f.legitimacy,
    prestige: f.prestige,
    age: f.age,
    culturePoints: f.culturePoints,
    prosperityDays: f.prosperityDays,
    settlements,
    population,
    soldiers,
    wars,
    ledger: f.ledger,
    projected: projectLedger(world, factionId),
  };
}

export function ageView(world: WorldState, factionId: FactionId): { checklist: AgeChecklist; landmarks: LandmarkOption[] } {
  return { checklist: ageChecklist(world, factionId), landmarks: landmarkOptions(world, factionId) };
}

/** One-lot buy and sell quotes for every market resource. */
export function marketQuotes(world: WorldState, factionId: FactionId): { resource: MarketResource; buy: MarketQuote; sell: MarketQuote }[] {
  return MARKET_RESOURCES.map((r) => ({ resource: r, buy: quoteMarketTrade(world, factionId, r, 1, true), sell: quoteMarketTrade(world, factionId, r, 1, false) }));
}

export function victoryProgressView(world: WorldState, factionId: FactionId): VictoryBreakdown[] {
  return victoryBreakdowns(world, factionId);
}

/** Proposals waiting for this faction's answer, with the days left. */
export function pendingProposals(world: WorldState, factionId: FactionId): { id: string; from: FactionId; type: string; reasons: string[]; daysLeft: number }[] {
  const d = totalDays(world.calendar);
  return world.diplomacy.proposals
    .filter((p) => p.to === factionId && p.status === 'pending')
    .map((p) => ({ id: p.id, from: p.from, type: p.type, reasons: p.reasons, daysLeft: Math.max(0, 30 - (d - p.day)) }));
}
