/**
 * Settlement economy (DESIGN_SPEC §7.2-§7.5): settlement variables, food (trickle + kharif/rabi harvests, crop health,
 * monsoon yields), consumption, storage capacity in DAYS, spoilage, the internal grain market, grain tax, relief draws,
 * rationing, prices and their effects, population, labor, materials (timber/stone), monthly tax/trade/tribute/upkeep/
 * administration, the ledger + projection and debt.
 * OWNER: Simulation Engineer - Strategic World Simulation (SIM-01). Replaces the CTO baseline (whose fixed capacity of
 * `3,000 + 0.6 pop + 4,000 granary` starved Rajapura by day ~90).
 *
 * Daily order (§7.1): derived variables -> production (trickle, harvest) -> consumption -> distribution (internal
 * market, relief) -> storage (capacity, spoilage) -> prices -> population -> labor -> materials -> construction ->
 * recruitment. Monthly: taxes, trade, tribute, upkeep, administration, ledger, policies, recruit pool regen, debt.
 * Deterministic: sorted iteration, no RNG.
 */
import type {
  FactionId,
  FactionLedger,
  FactionState,
  ProvinceState,
  ResourceKind,
  SettlementState,
  SimEvent,
  UnitClass,
  WorldState,
} from '../../core/types';
import { isRebelFaction } from '../../core/types';
import { clamp01 } from '../../core/math';
import { BALANCE } from '../../data/balance';
import { BUILDINGS } from '../../data/buildings';
import { SANDBOX_MATERIALS } from '../../data/campaign';
import { FACTIONS } from '../../data/factions';
import { RULES } from '../../data/rules';
import { UNITS } from '../../data/units';
import { monsoonResult, monsoonYields, seasonOf } from './seasons';
import { addMonthToDate, addStat, foundingPopulation, getStat, MTD_PREFIX, notifyPlayer, stableKeys, today } from './state';
import { buildingLevel, emptyMods, factionMod, incomeMultiplier, sandboxFertility, settlementEffects, stageEffect, type ModRecord } from './modifiers';
import { connectedRoadShare, realmComponents } from './network';
import { countTreaties, paysTributeTo } from './treaties';
import { recoverMarketPrices } from './market';
import { progressConstruction, repairWallsDaily } from './construction';
import { progressRecruitment } from './recruitment';
import { assignMissingCells, footprintOf } from './placement';

/** v1 saves (and buildings the layout could not place yet) lack cells. */
function needsCells(s: SettlementState): boolean {
  for (const b of s.buildings) if (!b.cell && footprintOf(b.type)?.placement !== 'perimeter') return true;
  return false;
}

export { buildingLevel };

// ---------------------------------------------------------------------------------------------------
// Constants and landmark rules without a data field (requested from the Creative Director, see report)
// ---------------------------------------------------------------------------------------------------

/** "Realm spoilage -50%" (The Royal Granary). */
export const LM_ROYAL_GRANARY = 'lm_royal_granary';
/** "Besieged settlements eat 40% less" (The Cliff Cistern). */
export const LM_CLIFF_CISTERN = 'lm_cliff_cistern';
const CISTERN_SIEGE_CONSUMPTION = 0.6;

const LUXURY: readonly ResourceKind[] = ['salt', 'cotton', 'spices'];
const DEPOSITS: readonly ResourceKind[] = ['stone', 'iron', 'copper'];
const WATER_BUILDINGS = ['water_tank', 'stepwell', 'irrigation_canal'] as const;

/** Harvest months (kharif in Kartika, rabi in Vaishakha) and days from sowing to harvest (105 / 165). */
export const KHARIF_HARVEST_MONTH = BALANCE.economy.kharifHarvestMonth;
export const RABI_HARVEST_MONTH = BALANCE.economy.rabiHarvestMonth;
const cropDays = (sow: number, harvest: number): number => ((harvest - sow + 12) % 12) * 30 + RULES.harvest.harvestDay;
const KHARIF_DAYS = cropDays(RULES.harvest.kharifSowMonth, KHARIF_HARVEST_MONTH);
const RABI_DAYS = cropDays(RULES.harvest.rabiSowMonth, RABI_HARVEST_MONTH);

export interface SettlementFoodReport {
  /** Expected average production per day over the year (trickle + harvests at current yields and crop health). */
  production: number;
  consumption: number;
  net: number;
  /** Days the store lasts at the current deficit (Infinity if surplus). */
  daysOfReserve: number;
}

// ---------------------------------------------------------------------------------------------------
// Settlement formulas (pure)
// ---------------------------------------------------------------------------------------------------

const scratch: ModRecord = emptyMods();

export function provinceOf(world: WorldState, s: SettlementState): ProvinceState | null {
  return world.provinces[s.provinceId] ?? null;
}

/** Terrain moisture carried in disasterExposure.drought (= 1 - moisture at the site, fixed at creation). */
export function siteMoisture(s: SettlementState): number {
  return clamp01(1 - s.disasterExposure.drought);
}

export function isRationing(world: WorldState, s: SettlementState): boolean {
  const owner = s.ownerFactionId ? world.factions[s.ownerFactionId] : null;
  return !!owner && owner.policies.rationingUntilDay !== null && owner.policies.rationingUntilDay > today(world);
}

/** Is the monsoon failing this season (drought: M < 0.7 during grishma/varsha)? */
export function droughtActive(world: WorldState): boolean {
  const season = seasonOf(world.calendar);
  return monsoonResult(world.monsoon.strength) === 'failed' && (season === 'grishma' || season === 'varsha');
}

/** Labor = pop x laborPerPopulation x ((1 - w) + w x health), w = RULES.population.laborHealthWeight. */
export function laborFor(pop: number, health: number): number {
  const w = RULES.population.laborHealthWeight;
  return pop * BALANCE.economy.laborPerPopulation * (1 - w + w * health);
}

/** Annual production potential P (DESIGN_SPEC §7.3.1) given current settlement variables and modifiers. */
export function annualPotential(world: WorldState, s: SettlementState, mods: ModRecord): number {
  const e = BALANCE.economy;
  const h = RULES.harvest;
  const farmers = s.labor * s.laborAllocation.farming;
  const prov = provinceOf(world, s);
  const fert = (prov?.fertility ?? 0.7) * sandboxFertility(world);
  const besieged = s.besiegedBy ? RULES.siege.besiegedProduction : 1;
  return (
    farmers *
    e.foodPerFarmerPerDay *
    360 *
    (1 + mods.foodProduction) *
    (0.5 + 0.5 * Math.max(s.waterAvailability, s.irrigation)) *
    (h.fertilityBase + h.fertilityScale * fert) *
    (1 - 0.5 * s.damage) *
    stageEffect(s).production *
    besieged
  );
}

/** Garrison soldiers stationed in the settlement (garrison units only; field armies supply themselves). */
export function garrisonSoldiers(s: SettlementState): number {
  let n = 0;
  for (const u of s.garrison) n += u.soldiers;
  return n;
}

function garrisonFood(s: SettlementState): number {
  let f = 0;
  for (const u of s.garrison) f += u.soldiers * UNITS[u.unitClass].stats.upkeepFood * BALANCE.military.soldierFoodPerDay;
  return f;
}

function holdsLandmarkId(world: WorldState, factionId: FactionId | null, id: string): boolean {
  if (!factionId) return false;
  const f = world.factions[factionId];
  if (!f || !f.landmarks.includes(id)) return false;
  for (const sid of stableKeys('settlements', world.settlements as Record<string, unknown>)) {
    const s = world.settlements[sid] as SettlementState;
    for (const l of s.landmarks) if (l.id === id && l.builtBy === factionId) return s.ownerFactionId === factionId;
  }
  return false;
}

/** Daily grain consumption: pop x 0.1 (x0.85 rationing; x0.6 besieged with the Cliff Cistern) + garrison. */
export function dailyConsumption(world: WorldState, s: SettlementState): number {
  let civ = s.population * BALANCE.economy.foodPerPersonPerDay;
  if (isRationing(world, s)) civ *= RULES.distribution.rationing.consumption;
  if (s.besiegedBy && holdsLandmarkId(world, s.ownerFactionId, LM_CLIFF_CISTERN)) civ *= CISTERN_SIEGE_CONSUMPTION;
  return civ + garrisonFood(s);
}

/** Storage capacity in measures: pop x 0.1 x (baseDays + Σ foodCapacity days). */
export function storageCapacity(s: SettlementState, mods: ModRecord): number {
  return s.population * BALANCE.economy.foodPerPersonPerDay * (RULES.storage.baseDays + mods.foodCapacity);
}

/** Reserve days = stored / consumption. */
export function reserveDays(s: SettlementState): number {
  return s.foodConsumption > 0 ? s.foodStored / s.foodConsumption : Infinity;
}

/** UI color of reserve days (green > 90, amber 30-90, red < 30). */
export function reserveColor(days: number): 'green' | 'amber' | 'red' {
  return days > 90 ? 'green' : days >= 30 ? 'amber' : 'red';
}

/** Target grain price for a reserve level (DESIGN_SPEC §7.4). */
export function targetGrainPrice(rd: number, starving: boolean): number {
  const p = RULES.prices;
  const shortage = 1 - Math.min(1, rd / p.normalReserveDays);
  const surplus = clamp01((rd - p.surplusReserveDays) / p.surplusReserveDays);
  const t = 1 + BALANCE.economy.priceElasticity * shortage - 0.25 * surplus + (starving ? p.faminePremium : 0);
  return Math.min(p.max, Math.max(p.min, t));
}

/** Tax compliance from the grain price: clamp(1.3 - 0.3 price, 0.6, 1). */
export function taxCompliance(price: number): number {
  const c = RULES.prices.compliance;
  return Math.min(1, Math.max(c.min, c.a - c.b * price));
}

/** Expected daily production (state field `foodProduction`) and balance; no mutation. */
export function settlementFoodBalance(world: WorldState, s: SettlementState): SettlementFoodReport {
  const mods = settlementEffects(world, s, scratch);
  const P = annualPotential(world, s, mods);
  const y = monsoonYields(world.monsoon.strength, s.irrigation);
  const h = RULES.harvest;
  const production = (P / 360) * (h.trickleShare + h.kharifShare * y.kharif * s.kharif.health + h.rabiShare * y.rabi * s.rabi.health);
  const consumption = dailyConsumption(world, s);
  const net = production - consumption;
  return { production, consumption, net, daysOfReserve: net >= 0 ? Infinity : s.foodStored / -net };
}

// ---------------------------------------------------------------------------------------------------
// Daily
// ---------------------------------------------------------------------------------------------------

interface DayScratch {
  /** Food produced today per faction (statistics). */
  produced: Map<string, number>;
}

/**
 * Sandbox realms start with SANDBOX_MATERIALS (DESIGN_SPEC §7.5 / CTO request 7). createWorld must keep the v1->v2
 * migration default (0 in sandbox until core/save uses initialMaterials), so the stockpile is delivered once on the
 * first day, flagged per faction. Idempotent; v1 sandbox saves receive it once on load too.
 */
function deliverSandboxStockpiles(world: WorldState): void {
  if (world.mode !== 'sandbox') return;
  for (const fid of stableKeys('factions', world.factions as Record<string, unknown>)) {
    const f = world.factions[fid] as FactionState;
    if (f.flags.start_stockpile) continue;
    const m = SANDBOX_MATERIALS[fid];
    if (m) {
      f.materials.timber += m.timber;
      f.materials.stone += m.stone;
    }
    f.flags.start_stockpile = true;
  }
}

/** Update the derived settlement variables (§7.2) for today. */
function updateDerived(world: WorldState, s: SettlementState, mods: ModRecord): void {
  const st = RULES.settlement;
  const pop = s.population;
  s.housing = Math.round(foundingPopulation(s) * st.initialHousingPerCapita + mods.housing);
  const overcrowd = Math.max(0, pop / Math.max(1, s.housing) - 1);
  s.waterAvailability = clamp01(st.waterBase + st.waterMoistureWeight * siteMoisture(s) + mods.waterAvailability - (droughtActive(world) ? st.droughtWaterPenalty : 0));
  s.irrigation = clamp01(st.irrigationBase + mods.irrigation);
  let wc = 0;
  let wn = 0;
  for (const b of s.buildings) {
    if ((WATER_BUILDINGS as readonly string[]).includes(b.type)) {
      wc += b.condition;
      wn++;
    }
  }
  s.waterInfrastructure = wn > 0 ? wc / wn : 0.3;
  s.sanitation = clamp01(st.sanitationBase + mods.sanitation - st.sanitationOvercrowding * overcrowd);
  const hunger = s.starvationDays > 0 ? 1 : 0;
  const healthTarget = clamp01(st.healthBase + st.healthSanitation * s.sanitation + st.healthWater * s.waterAvailability - st.healthHunger * hunger);
  s.health = clamp01(s.health + (healthTarget - s.health) * st.driftPerDay + (isRationing(world, s) ? RULES.distribution.rationing.healthPerDay : 0));
  s.labor = laborFor(pop, s.health);
  const resist = clamp01(mods.disasterResistance);
  s.disasterExposure.fire = (0.15 + 0.1 * overcrowd) * (1 - resist);
  s.disasterExposure.epidemic = (0.1 + 0.3 * (1 - s.sanitation)) * (1 - resist);
  const recruitCap = pop * RULES.recruitment.poolPerCapita * (1 + mods.recruitmentPotential) * factionMod(world, s.ownerFactionId, 'recruitmentPool');
  s.recruitmentPotential = recruitCap;
  if (s.recruitPool > recruitCap) s.recruitPool = recruitCap;
}

/** Crops: sowing, growth, war-sowing penalty. */
function updateCrops(world: WorldState, s: SettlementState): void {
  const h = RULES.harvest;
  const cal = world.calendar;
  const farmers = s.labor * s.laborAllocation.farming;
  if (cal.day === 0 && cal.month === h.kharifSowMonth) {
    s.kharif.sown = farmers;
    s.kharif.growth = 0;
    s.kharif.health = 1;
    s.kharif.laborAtSowing = farmers;
  }
  if (cal.day === 0 && cal.month === h.rabiSowMonth) {
    s.rabi.sown = farmers;
    s.rabi.growth = 0;
    s.rabi.health = 1;
    s.rabi.laborAtSowing = farmers;
  }
  if (s.kharif.sown > 0) s.kharif.growth = Math.min(1, s.kharif.growth + 1 / KHARIF_DAYS);
  if (s.rabi.sown > 0) s.rabi.growth = Math.min(1, s.rabi.growth + 1 / RABI_DAYS);
  // An enemy army camping or foraging within 600 m during the sowing month costs the crop 0.3 health (once).
  const sowing = cal.month === h.kharifSowMonth ? s.kharif : cal.month === h.rabiSowMonth ? s.rabi : null;
  if (sowing && s.ownerFactionId && hostileArmyNear(world, s, 600)) sowing.health = Math.min(sowing.health, 1 - h.warSowingPenalty);
}

function hostileArmyNear(world: WorldState, s: SettlementState, radius: number): boolean {
  const owner = s.ownerFactionId;
  if (!owner) return false;
  const r2 = radius * radius;
  for (const id of stableKeys('armies', world.armies as Record<string, unknown>)) {
    const a = world.armies[id]!;
    if (a.status === 'marching' || a.units.length === 0) continue;
    if ((a.x - s.x) * (a.x - s.x) + (a.z - s.z) * (a.z - s.z) > r2) continue;
    if (isRebelFaction(a.factionId) ? a.rebelSettlementId === s.id : (world.diplomacy.relations[relKey(owner, a.factionId)]?.atWar ?? false)) return true;
  }
  return false;
}

function relKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Harvest (if due) and the trickle; returns grain produced today. Emits `harvest` and applies the grain tax. */
function produceFood(world: WorldState, s: SettlementState, mods: ModRecord, out: SimEvent[]): number {
  const h = RULES.harvest;
  const cal = world.calendar;
  const P = annualPotential(world, s, mods);
  const y = monsoonYields(world.monsoon.strength, s.irrigation);
  const season = seasonOf(cal);
  const trickle = (P / 360) * h.trickleShare * h.seasonTrickle[season];
  s.foodProduction = (P / 360) * (h.trickleShare + h.kharifShare * y.kharif * s.kharif.health + h.rabiShare * y.rabi * s.rabi.health);
  let harvest = 0;
  let crop: 'kharif' | 'rabi' | null = null;
  if (cal.day === h.harvestDay && cal.month === KHARIF_HARVEST_MONTH) crop = 'kharif';
  else if (cal.day === h.harvestDay && cal.month === RABI_HARVEST_MONTH) crop = 'rabi';
  if (crop) {
    const c = crop === 'kharif' ? s.kharif : s.rabi;
    const farmers = s.labor * s.laborAllocation.farming;
    const laborCut = c.laborAtSowing > 0 ? Math.min(1, farmers / c.laborAtSowing) : 1;
    harvest = P * (crop === 'kharif' ? h.kharifShare * y.kharif : h.rabiShare * y.rabi) * c.health * laborCut;
    s.lastHarvest = harvest;
    c.sown = 0;
    c.growth = 0;
    c.health = 1;
    c.laborAtSowing = 0;
    out.push({ kind: 'harvest', settlementId: s.id, crop, amount: Math.round(harvest) });
  }
  s.foodStored += trickle + harvest;
  if (harvest > 0 && s.ownerFactionId) grainTax(world, s, harvest);
  return trickle + harvest;
}

/** Crown share of a harvest into the royal reserve, from settlements left with >= 90 reserve days (§7.3.5 item 2). */
function grainTax(world: WorldState, s: SettlementState, harvest: number): void {
  const d = RULES.distribution;
  const f = s.ownerFactionId ? world.factions[s.ownerFactionId] : null;
  if (!f) return;
  const cons = Math.max(1, dailyConsumption(world, s));
  if (s.foodStored / cons < d.grainTaxMinReserveDays) return;
  const take = Math.min(s.foodStored - d.grainTaxMinReserveDays * cons, d.grainTaxShareOfHarvest * harvest * (s.taxRate / RULES.tax.defaultRate) * taxCompliance(s.grainPrice));
  if (take <= 0) return;
  s.foodStored -= take;
  f.foodReserve += take;
}

/** Internal grain market and relief draws for one faction (§7.3.5 items 1 and 3). Stores may be negative on entry. */
function distribute(world: WorldState, factionId: FactionId): void {
  const d = RULES.distribution;
  const f = world.factions[factionId];
  if (!f) return;
  const comps = realmComponents(world, factionId);
  if (comps.size === 0) return;
  // Group by component (skip besieged settlements: no trade in or out).
  const groups = new Map<number, SettlementState[]>();
  for (const [sid, ci] of comps) {
    const s = world.settlements[sid] as SettlementState;
    if (s.besiegedBy) continue;
    let g = groups.get(ci);
    if (!g) groups.set(ci, (g = []));
    g.push(s);
  }
  for (const ci of [...groups.keys()].sort((a, b) => a - b)) {
    const g = groups.get(ci) as SettlementState[];
    let exportable = 0;
    let need = 0;
    for (const s of g) {
      const c = s.foodConsumption;
      if (c <= 0) continue;
      const rd = s.foodStored / c;
      if (rd > d.exportAboveDays) exportable += d.exportSharePerDay * (s.foodStored - d.exportAboveDays * c);
      else if (rd < d.importBelowDays) need += d.importBelowDays * c - s.foodStored;
    }
    if (exportable > 0 && need > 0) {
      const shipped = Math.min(exportable, need / (1 - d.transportLoss));
      const delivered = shipped * (1 - d.transportLoss);
      for (const s of g) {
        const c = s.foodConsumption;
        if (c <= 0) continue;
        const rd = s.foodStored / c;
        if (rd > d.exportAboveDays) {
          const amt = (shipped * (d.exportSharePerDay * (s.foodStored - d.exportAboveDays * c))) / exportable;
          s.foodStored -= amt;
          s.wealth += 0.1 * s.grainPrice * amt;
        } else if (rd < d.importBelowDays) {
          s.foodStored += (delivered * (d.importBelowDays * c - s.foodStored)) / need;
        }
      }
    }
  }
  // Relief from the royal reserve to connected settlements below 30 days (unless "Hold the reserve").
  if (f.policies.holdReserve || f.foodReserve <= 0) return;
  const capComp = f.capitalSettlementId !== null ? comps.get(f.capitalSettlementId) : undefined;
  for (const s of [...comps.keys()].sort().map((id) => world.settlements[id] as SettlementState)) {
    if (s.besiegedBy) continue;
    if (capComp !== undefined && comps.get(s.id) !== capComp) continue;
    const c = s.foodConsumption;
    if (c <= 0 || s.foodStored >= d.reliefBelowDays * c) continue;
    const cap = d.reliefDaysPerMonth * c - s.reliefThisMonth;
    const want = Math.min(d.reliefBelowDays * c - s.foodStored, cap, f.foodReserve);
    if (want <= 0) continue;
    s.foodStored += want;
    s.reliefThisMonth += want;
    f.foodReserve -= want;
    if (f.foodReserve <= 0) break;
  }
}

/** Daily spoilage share of the store: 0.0008 x (granary ? 0.6 : 1) x (Royal Granary held ? 0.5 : 1). */
export function spoilageRate(world: WorldState, s: SettlementState): number {
  return (
    BALANCE.economy.granarySpoilagePerDay *
    (buildingLevel(s, 'granary') > 0 ? RULES.storage.granarySpoilageFactor : 1) *
    (holdsLandmarkId(world, s.ownerFactionId, LM_ROYAL_GRANARY) ? 0.5 : 1)
  );
}

/** Storage, spoilage, prices, starvation, population (after distribution). */
function settleStores(world: WorldState, s: SettlementState, mods: ModRecord, out: SimEvent[]): void {
  const e = BALANCE.economy;
  const cons = s.foodConsumption;
  let deficitShare = 0;
  if (s.foodStored < 0) {
    deficitShare = Math.min(1, -s.foodStored / Math.max(1, cons));
    s.foodStored = 0;
  }
  const starving = s.foodStored <= 0 && deficitShare > 0;
  if (starving) {
    if (s.starvationDays === 0 || s.starvationDays % 7 === 0) out.push({ kind: 'shortage', settlementId: s.id, severity: deficitShare });
    s.starvationDays += 1;
    addStat(world, s.ownerFactionId, 'famine_days', 1);
  } else if (s.foodStored > 0) {
    s.starvationDays = 0;
  }
  // Capacity (days of consumption) - grain above it spoils at once.
  s.foodCapacity = storageCapacity(s, mods);
  if (s.foodStored > s.foodCapacity) {
    const lost = s.foodStored - s.foodCapacity;
    s.foodStored = s.foodCapacity;
    if (lost >= 1) {
      out.push({ kind: 'spoilage', settlementId: s.id, amount: Math.round(lost), reason: 'capacity' });
      addStat(world, s.ownerFactionId, 'grain_spoiled', lost);
    }
  }
  // Daily decay: x0.6 with a granary, x0.5 when the owner holds the Royal Granary.
  s.foodStored -= s.foodStored * spoilageRate(world, s);
  // Prices.
  const rd = cons > 0 ? s.foodStored / cons : 999;
  s.grainPrice += (targetGrainPrice(rd, starving) - s.grainPrice) * RULES.prices.smoothingPerDay;
  // Population: growth x health x housing factor; famine; emigration.
  const pop = s.population;
  const housingFactor = pop <= s.housing ? 1 : Math.max(-1, 1 - RULES.population.overcrowdingGrowthPenalty * (pop / Math.max(1, s.housing) - 1));
  let delta = ((pop * e.populationGrowthPerYear) / 360) * s.health * housingFactor;
  if (starving) delta -= pop * e.famineDeathRatePerDay * deficitShare;
  if (s.ownerFactionId && s.loyalty < 0.3 && s.grainPrice > 2) {
    const emig = pop * RULES.population.emigrationPerDay;
    const dest = nearestOwned(world, s);
    if (dest) {
      dest.population += emig;
      delta -= emig;
    }
  }
  s.population = Math.max(50, pop + delta);
  s.growthRate = pop > 0 ? (delta * 360) / pop : 0;
}

function nearestOwned(world: WorldState, s: SettlementState): SettlementState | null {
  let best: SettlementState | null = null;
  let bd = Infinity;
  for (const id of stableKeys('settlements', world.settlements as Record<string, unknown>)) {
    const o = world.settlements[id] as SettlementState;
    if (o === s || o.ownerFactionId !== s.ownerFactionId) continue;
    const d = (o.x - s.x) * (o.x - s.x) + (o.z - s.z) * (o.z - s.z);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

/** Local wealth, infrastructure and damage upkeep (§7.2). Idle builders repair. */
function updateLocal(world: WorldState, s: SettlementState, mods: ModRecord, idleBuilders: number): void {
  const crafts = s.labor * s.laborAllocation.crafts;
  s.wealth += crafts * 0.004 * (1 + mods.wealth + (s.resources.includes('gems') ? 0.1 : 0));
  const owner = s.ownerFactionId ? world.factions[s.ownerFactionId] : null;
  s.infrastructure = Math.max(0, s.infrastructure - BALANCE.economy.infrastructureDecayPerDay);
  if (idleBuilders > 0 && (!owner || owner.treasury > 0)) {
    s.infrastructure = Math.min(1, s.infrastructure + RULES.settlement.infrastructureRepairPerDay);
    s.damage = Math.max(0, s.damage - RULES.settlement.damageRepairPerDay);
  }
}

/** Workshops (timber + wealth) and Quarry & Mine (stone + wealth) production into the owner's stockpile. */
export function materialsProduction(world: WorldState, s: SettlementState): { timber: number; stone: number; wealth: number } {
  const res = { timber: 0, stone: 0, wealth: 0 };
  if (!s.ownerFactionId || !world.factions[s.ownerFactionId]) return res;
  const crafts = s.labor * s.laborAllocation.crafts;
  const factor = stageEffect(s).production * (s.besiegedBy ? RULES.siege.besiegedProduction : 1);
  let staffBudget = Math.floor(crafts / RULES.materials.workersPerLevel);
  for (const b of s.buildings) {
    if (b.type !== 'workshop' && b.type !== 'mine') continue;
    const def = BUILDINGS[b.type];
    if (!def.produces) continue;
    if (b.type === 'mine' && RULES.materials.mineNeedsDeposit && !s.resources.some((r) => DEPOSITS.includes(r))) continue;
    const staffed = Math.min(b.level, staffBudget);
    staffBudget -= staffed;
    if (staffed <= 0) continue;
    const k = staffed * b.condition * factor;
    const timberShare = b.type === 'workshop' && !s.resources.includes('timber') ? RULES.materials.workshopTimberWithoutForest : 1;
    res.timber += (def.produces.timber ?? 0) * k * timberShare;
    res.stone += (def.produces.stone ?? 0) * k;
    res.wealth += (def.produces.wealth ?? 0) * k;
  }
  return res;
}

/** The whole daily economy. */
export function updateEconomyDaily(world: WorldState, out: SimEvent[]): void {
  deliverSandboxStockpiles(world);
  const ids = stableKeys('settlements', world.settlements as Record<string, unknown>);
  const day: DayScratch = { produced: new Map() };
  const modsById = new Map<string, ModRecord>();
  // 1. Derived variables, crops, production, consumption.
  for (const id of ids) {
    const s = world.settlements[id] as SettlementState;
    const mods = settlementEffects(world, s, emptyMods());
    modsById.set(id, mods);
    updateDerived(world, s, mods);
    updateCrops(world, s);
    const produced = produceFood(world, s, mods, out);
    if (s.ownerFactionId) day.produced.set(s.ownerFactionId, (day.produced.get(s.ownerFactionId) ?? 0) + produced);
    s.foodConsumption = dailyConsumption(world, s);
    s.foodStored -= s.foodConsumption;
  }
  // 2. Distribution inside each realm.
  for (const fid of stableKeys('factions', world.factions as Record<string, unknown>)) if (world.factions[fid]!.alive) distribute(world, fid);
  // 3. Storage, prices, population, local wealth, materials, jobs.
  for (const id of ids) {
    const s = world.settlements[id] as SettlementState;
    const mods = modsById.get(id) as ModRecord;
    settleStores(world, s, mods, out);
    s.labor = laborFor(s.population, s.health);
    const m = materialsProduction(world, s);
    if (s.ownerFactionId && (m.timber > 0 || m.stone > 0 || m.wealth > 0)) {
      const f = world.factions[s.ownerFactionId]!;
      f.materials.timber += m.timber;
      f.materials.stone += m.stone;
      f.treasury += m.wealth;
      addMonthToDate(world, f.id, 'other_income', m.wealth);
    }
    if (needsCells(s)) assignMissingCells(world, s);
    const idle = progressConstruction(world, s, out);
    repairWallsDaily(world, s);
    updateLocal(world, s, mods, idle);
    progressRecruitment(world, s, out);
  }
  for (const [fid, v] of day.produced) addStat(world, fid, 'grain_harvested', v);
  recoverMarketPrices(world);
  expirePolicies(world, out);
}

function expirePolicies(world: WorldState, out: SimEvent[]): void {
  const d = today(world);
  let anyRationing = false;
  for (const fid of stableKeys('factions', world.factions as Record<string, unknown>)) {
    const f = world.factions[fid] as FactionState;
    const until = f.policies.rationingUntilDay;
    if (until !== null && until <= d) {
      f.policies.rationingUntilDay = null;
      notifyPlayer(world, out, fid, 'info', 'Rationing has ended.');
    }
    if (f.policies.rationingUntilDay !== null) anyRationing = true;
  }
  if (!anyRationing && world.events.flags.rationing !== undefined) delete world.events.flags.rationing;
}

// ---------------------------------------------------------------------------------------------------
// Monthly
// ---------------------------------------------------------------------------------------------------

export interface SettlementMonthly {
  settlementId: string;
  tax: number;
  trade: number;
  buildingUpkeep: number;
}

export interface LedgerComputation {
  ledger: FactionLedger;
  settlements: SettlementMonthly[];
  tributeIn: number;
  tributeOut: number;
}

/** Province governor's stewardship tax term ((stewardship - 10) x 0.01) when a living, free governor serves. */
export function governorTaxTerm(world: WorldState, s: SettlementState): number {
  const prov = provinceOf(world, s);
  const gov = prov?.governorId ? world.characters[prov.governorId] : null;
  if (!gov || !gov.alive || gov.captiveOf || gov.factionId !== s.ownerFactionId) return 0;
  return (gov.skills.stewardship - 10) * RULES.politics.governor.stewardshipTaxPerPoint;
}

/** Effective province autonomy for tax: province autonomy + 0.25 when the owner pays tribute. */
export function effectiveAutonomy(world: WorldState, s: SettlementState): number {
  const base = provinceOf(world, s)?.autonomy ?? 0;
  const trib = s.ownerFactionId && paysTributeTo(world, s.ownerFactionId).length > 0 ? 0.25 : 0;
  return Math.min(1, base + trib);
}

/** Monthly tax of one settlement (DESIGN_SPEC §7.5 tax_s). */
export function settlementTax(world: WorldState, s: SettlementState, mods: ModRecord): number {
  const fid = s.ownerFactionId;
  const f = fid ? world.factions[fid] : null;
  if (!f || !fid) return 0;
  const pol = RULES.tax.policy[f.taxPolicy];
  return (
    s.population *
    BALANCE.economy.baseTaxPerCapitaPerMonth *
    RULES.tax.scale *
    s.taxRate *
    pol.income *
    taxCompliance(s.grainPrice) *
    (0.4 + 0.6 * s.loyalty) *
    factionMod(world, fid, 'taxEfficiency') *
    (1 + mods.taxEfficiency + governorTaxTerm(world, s)) *
    stageEffect(s).tax *
    (1 - 0.5 * effectiveAutonomy(world, s)) *
    incomeMultiplier(world, fid)
  );
}

/** Monthly trade of one settlement (DESIGN_SPEC §7.5 trade_s). */
export function settlementTrade(world: WorldState, s: SettlementState, mods: ModRecord): number {
  const fid = s.ownerFactionId;
  if (!fid || !world.factions[fid] || s.besiegedBy) return 0;
  const t = RULES.trade;
  const crafts = s.labor * s.laborAllocation.crafts;
  let luxury = 0;
  for (const r of LUXURY) if (s.resources.includes(r)) luxury++;
  return (
    (s.population * t.perCapitaPerMonth + crafts * t.craftsPerWorkerPerMonth + t.effectScale * mods.tradeIncome) *
    factionMod(world, fid, 'tradeIncome') *
    s.infrastructure *
    (1 - t.roadWeight + t.roadWeight * connectedRoadShare(world, s)) *
    (1 + t.treatyBonus * countTreaties(world, fid, 'trade')) *
    (1 + 0.1 * luxury) *
    stageEffect(s).trade *
    incomeMultiplier(world, fid)
  );
}

/** Army upkeep per month (soldiers x upkeepWealth x variant multiplier) for armies and garrisons. */
export function armyUpkeep(world: WorldState, factionId: FactionId): number {
  const variants = FACTIONS[factionId]?.unitVariants;
  const unitCost = (cls: UnitClass, soldiers: number): number => soldiers * UNITS[cls].stats.upkeepWealth * (variants?.[cls]?.multipliers.upkeepWealth ?? 1);
  let sum = 0;
  for (const aid of stableKeys('armies', world.armies as Record<string, unknown>)) {
    const a = world.armies[aid]!;
    if (a.factionId !== factionId) continue;
    for (const u of a.units) sum += unitCost(u.unitClass, u.soldiers);
  }
  for (const sid of stableKeys('settlements', world.settlements as Record<string, unknown>)) {
    const s = world.settlements[sid]!;
    if (s.ownerFactionId !== factionId) continue;
    for (const u of s.garrison) sum += unitCost(u.unitClass, u.soldiers);
  }
  return sum;
}

/** Governor slots of the faction's current age. */
export function governorSlots(world: WorldState, factionId: FactionId): number {
  const f = world.factions[factionId];
  if (!f) return 0;
  return f.age === 'samrajya' ? 7 : f.age === 'mahajanapada' ? 4 : 2;
}

/**
 * Compute a faction's monthly ledger with the current state (pure). Tribute uses the payer's last monthly income
 * (tax + trade) unless the treaty fixes tributePerMonth.
 */
export function computeLedger(world: WorldState, factionId: FactionId): LedgerComputation {
  const f = world.factions[factionId];
  const ledger: FactionLedger = { taxIncome: 0, tradeIncome: 0, tribute: 0, armyUpkeep: 0, buildingUpkeep: 0, administration: 0, construction: 0, recruitment: 0, other: 0, net: 0, foodProduced: 0, foodConsumed: 0 };
  const res: LedgerComputation = { ledger, settlements: [], tributeIn: 0, tributeOut: 0 };
  if (!f) return res;
  const mods = emptyMods();
  let owned = 0;
  for (const sid of stableKeys('settlements', world.settlements as Record<string, unknown>)) {
    const s = world.settlements[sid] as SettlementState;
    if (s.ownerFactionId !== factionId) continue;
    owned++;
    settlementEffects(world, s, mods);
    const tax = settlementTax(world, s, mods);
    const trade = settlementTrade(world, s, mods);
    let bu = 0;
    for (const b of s.buildings) bu += BUILDINGS[b.type].upkeepWealth * b.level;
    ledger.taxIncome += tax;
    ledger.tradeIncome += trade;
    ledger.buildingUpkeep += bu;
    ledger.foodProduced += s.foodProduction * 30;
    ledger.foodConsumed += s.foodConsumption * 30;
    res.settlements.push({ settlementId: s.id, tax, trade, buildingUpkeep: bu });
  }
  ledger.armyUpkeep = armyUpkeep(world, factionId);
  const gov = factionMod(world, factionId, 'governanceCost');
  ledger.administration = owned * RULES.tax.adminPerSettlement * gov + Math.max(0, owned - 2 * governorSlots(world, factionId)) * RULES.tax.adminOverextension;
  // Tribute (payer -> overlord).
  for (const tid of stableKeys('treaties', world.diplomacy.treaties as Record<string, unknown>)) {
    const t = world.diplomacy.treaties[tid]!;
    if (t.type !== 'tributary' || t.brokenBy !== null || (t.endDay !== null && t.endDay <= today(world))) continue;
    const payer = t.terms.payer;
    const overlord = t.terms.overlord;
    if (!payer || !overlord || (payer !== factionId && overlord !== factionId)) continue;
    const pf = world.factions[payer];
    if (!pf) continue;
    const amount = t.terms.tributePerMonth > 0 ? t.terms.tributePerMonth : 0.1 * Math.max(0, pf.ledger.taxIncome + pf.ledger.tradeIncome);
    if (payer === factionId) res.tributeOut += amount;
    else res.tributeIn += amount;
  }
  ledger.tribute = res.tributeIn - res.tributeOut;
  ledger.construction = getStat(world, factionId, MTD_PREFIX + 'construction');
  ledger.recruitment = getStat(world, factionId, MTD_PREFIX + 'recruitment');
  ledger.other = getStat(world, factionId, MTD_PREFIX + 'other_income') + getStat(world, factionId, MTD_PREFIX + 'market') - getStat(world, factionId, MTD_PREFIX + 'other_cost');
  ledger.net = ledger.taxIncome + ledger.tradeIncome + ledger.tribute - ledger.armyUpkeep - ledger.buildingUpkeep - ledger.administration;
  return res;
}

/** Projected ledger for the coming month (treasury tooltip). */
export function projectLedger(world: WorldState, factionId: string): FactionLedger {
  return computeLedger(world, factionId).ledger;
}

/** Monthly economy for every faction + settlement bookkeeping. */
export function updateEconomyMonthly(world: WorldState, out: SimEvent[]): void {
  // Compute every ledger first so tribute uses last month's ledgers consistently.
  const comps = new Map<string, LedgerComputation>();
  for (const fid of stableKeys('factions', world.factions as Record<string, unknown>)) if (world.factions[fid]!.alive) comps.set(fid, computeLedger(world, fid));
  for (const fid of stableKeys('factions', world.factions as Record<string, unknown>)) {
    const f = world.factions[fid] as FactionState;
    const c = comps.get(fid);
    if (!c) continue;
    const L = c.ledger;
    for (const sm of c.settlements) {
      const s = world.settlements[sm.settlementId] as SettlementState;
      s.taxIncome = sm.tax;
      s.tradeIncome = sm.trade;
      s.tradeVolume = sm.trade * 10;
    }
    f.treasury += L.net;
    f.ledger = L;
    addStat(world, fid, 'wealth_earned', L.taxIncome + L.tradeIncome + Math.max(0, c.tributeIn) + getStat(world, fid, MTD_PREFIX + 'other_income'));
    addStat(world, fid, 'trade_income', L.tradeIncome);
    // Reset month-to-date accumulators.
    for (const k of ['construction', 'recruitment', 'other_income', 'other_cost', 'market']) {
      const row = world.statistics[fid];
      if (row) delete row[MTD_PREFIX + k];
    }
    // Tax policy: unrest per month on every owned settlement, legitimacy per month.
    const pol = RULES.tax.policy[f.taxPolicy];
    if (pol.legitimacyPerMonth !== 0) f.legitimacy = clamp01(f.legitimacy + pol.legitimacyPerMonth);
    // Debt (§7.5): stability -0.01 per 1,000 of debt, legitimacy -0.01 per month.
    if (f.treasury < 0) {
      f.stability = clamp01(f.stability + RULES.tax.debt.stabilityPer1000PerMonth * (-f.treasury / 1000));
      f.legitimacy = clamp01(f.legitimacy + RULES.tax.debt.legitimacyPerMonth);
      notifyPlayer(world, out, fid, 'danger', 'The treasury is empty - soldiers and officials go unpaid.');
    }
    let manpower = 0;
    for (const sid of stableKeys('settlements', world.settlements as Record<string, unknown>)) {
      const s = world.settlements[sid] as SettlementState;
      if (s.ownerFactionId !== fid) continue;
      if (pol.unrestPerMonth !== 0) s.unrest = clamp01(s.unrest + pol.unrestPerMonth);
      manpower += s.recruitPool;
    }
    f.manpower = manpower;
  }
  // Settlement monthly: recruit pool regen, requisition memory decay, relief counter, tax relief expiry.
  for (const sid of stableKeys('settlements', world.settlements as Record<string, unknown>)) {
    const s = world.settlements[sid] as SettlementState;
    const cap = s.recruitmentPotential;
    const regen = cap * RULES.recruitment.regenPerMonth * (0.5 + 0.5 * s.loyalty) * (1 / Math.max(0.5, s.grainPrice)) * stageEffect(s).recruitment;
    s.recruitPool = Math.min(cap, s.recruitPool + regen);
    s.requisitionedFood *= 1 - RULES.supply.requisition.memoryDecayPerMonth;
    if (s.requisitionedFood < 1) s.requisitionedFood = 0;
    s.reliefThisMonth = 0;
  }
}
