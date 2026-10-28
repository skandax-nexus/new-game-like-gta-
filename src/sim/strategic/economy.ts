/**
 * Settlement economy: food, harvests, prices, water, housing, taxes, trade, construction, recruitment.
 * OWNER: Lead AI & Simulation Engineer. Baseline by the CTO (simple but working numbers).
 *
 * Required behavior (GDD §6):
 *  - Daily: food production (labor x fertility x season x irrigation/water) and consumption,
 *    granary capacity + spoilage, grain price responds to reserves (shortage -> price up -> unrest,
 *    lower recruitment and tax), population growth / famine, construction + recruitment progress.
 *  - Seasonal: kharif sown in varsha, harvested ~BALANCE.economy.kharifHarvestMonth; rabi sown in
 *    hemanta, harvested ~rabiHarvestMonth. Monsoon strength/drought modify yields.
 *  - Monthly: taxes (taxRate x policy x loyalty x faction taxEfficiency), trade income (markets,
 *    roads condition, treaties), upkeep (armies, buildings), administration cost (governanceCost),
 *    write FactionState.ledger.
 *  - Persistent consequences: requisitions (`requisitionedFood`) depress loyalty/prices for months.
 */
import type { FactionLedger, SettlementState, SimEvent, WorldState } from '../../core/types';
import { sortedKeys } from '../../core/ids';
import { clamp01 } from '../../core/math';
import { BALANCE } from '../../data/balance';
import { BUILDINGS } from '../../data/buildings';
import { FACTIONS } from '../../data/factions';
import { UNITS } from '../../data/units';
import { seasonOf, totalDays } from './seasons';
import { makeArmyUnit } from './armies';

export interface SettlementFoodReport {
  production: number;
  consumption: number;
  net: number;
  /** Days the store lasts at the current deficit (Infinity if surplus). */
  daysOfReserve: number;
}

const SEASON_YIELD: Record<string, number> = { vasanta: 1.1, grishma: 0.7, varsha: 1, sharad: 1.2, hemanta: 0.9, shishira: 0.8 };

export function buildingLevel(s: SettlementState, type: SettlementState['buildings'][number]['type']): number {
  return s.buildings.find((b) => b.type === type)?.level ?? 0;
}

/** Daily food production/consumption for a settlement (no mutation). */
export function settlementFoodBalance(world: WorldState, s: SettlementState): SettlementFoodReport {
  const e = BALANCE.economy;
  const season = seasonOf(world.calendar);
  const farmers = s.labor * s.laborAllocation.farming;
  const fieldBonus = 1 + buildingLevel(s, 'farm_fields') * 0.15;
  const water = 0.5 + 0.5 * Math.max(s.waterAvailability, s.irrigation);
  const production = farmers * e.foodPerFarmerPerDay * (SEASON_YIELD[season] ?? 1) * fieldBonus * water * (1 - s.damage * 0.5);
  const consumption = s.population * e.foodPerPersonPerDay;
  const net = production - consumption;
  return { production, consumption, net, daysOfReserve: net >= 0 ? Infinity : s.foodStored / -net };
}

export function updateEconomyDaily(world: WorldState, out: SimEvent[]): void {
  const e = BALANCE.economy;
  const day = totalDays(world.calendar);
  for (const id of sortedKeys(world.settlements)) {
    const s = world.settlements[id] as SettlementState;
    const fb = settlementFoodBalance(world, s);
    s.foodProduction = fb.production;
    s.foodConsumption = fb.consumption;
    s.foodStored = Math.max(0, Math.min(s.foodCapacity, s.foodStored + fb.net - s.foodStored * e.granarySpoilagePerDay));
    // Price: reserves vs 60 days of consumption.
    const ratio = s.foodStored / Math.max(1, fb.consumption * 60);
    const target = Math.max(0.5, Math.min(4, 1 + (1 - Math.min(1, ratio)) * e.priceElasticity));
    s.grainPrice += (target - s.grainPrice) * 0.1;
    if (s.foodStored <= 0 && fb.net < 0) {
      const deaths = Math.floor(s.population * e.famineDeathRatePerDay);
      s.population = Math.max(50, s.population - deaths);
      s.unrest = clamp01(s.unrest + 0.01);
      if (day % 7 === 0) out.push({ kind: 'shortage', settlementId: s.id, severity: clamp01(-fb.net / Math.max(1, fb.consumption)) });
    } else {
      s.population += Math.floor((s.population * e.populationGrowthPerYear) / 360 + (day % 3 === 0 ? 1 : 0));
    }
    s.labor = Math.round(s.population * e.laborPerPopulation);
    s.infrastructure = Math.max(0, s.infrastructure - e.infrastructureDecayPerDay);
    progressConstruction(world, s, out);
    progressRecruitment(world, s, out);
  }
}

function progressConstruction(world: WorldState, s: SettlementState, out: SimEvent[]): void {
  if (s.construction.length === 0) return;
  const job = s.construction[0]!;
  const def = BUILDINGS[job.type];
  const speed = FACTIONS[s.ownerFactionId ?? '']?.modifiers.constructionSpeed ?? 1;
  job.progress += (speed * (0.5 + s.laborAllocation.construction)) / Math.max(1, def.buildDays);
  if (job.progress >= 1) {
    s.construction.shift();
    const existing = s.buildings.find((b) => b.type === job.type);
    if (existing) existing.level = job.targetLevel;
    else s.buildings.push({ type: job.type, level: job.targetLevel, condition: 1 });
    if (def.effects.foodCapacity) s.foodCapacity += def.effects.foodCapacity;
    out.push({ kind: 'construction_complete', settlementId: s.id, building: job.type, level: job.targetLevel });
    void world;
  }
}

function progressRecruitment(world: WorldState, s: SettlementState, out: SimEvent[]): void {
  if (s.recruitment.length === 0) return;
  const job = s.recruitment[0]!;
  const def = UNITS[job.unitClass];
  job.progress += 1 / Math.max(1, def.stats.recruitDays);
  if (job.progress < 1) return;
  s.recruitment.shift();
  const army = job.targetArmyId ? world.armies[job.targetArmyId] : null;
  for (let i = 0; i < job.formations; i++) {
    const unit = makeArmyUnit(world, job.unitClass);
    if (army) army.units.push(unit);
    else s.garrison.push(unit);
  }
  s.recruitPool = Math.max(0, s.recruitPool - def.stats.menPerFormation * job.formations);
  out.push({ kind: 'recruitment_complete', settlementId: s.id, unitClass: job.unitClass, armyId: army?.id ?? null });
}

/** Monthly taxes, trade and upkeep -> treasury + ledger. */
export function updateEconomyMonthly(world: WorldState, out: SimEvent[]): void {
  const e = BALANCE.economy;
  const policyMul = { lenient: 0.7, standard: 1, heavy: 1.35, emergency: 1.7 } as const;
  for (const fid of sortedKeys(world.factions)) {
    const f = world.factions[fid]!;
    const mods = FACTIONS[fid]?.modifiers;
    const ledger: FactionLedger = { taxIncome: 0, tradeIncome: 0, tribute: 0, armyUpkeep: 0, buildingUpkeep: 0, administration: 0, construction: 0, recruitment: 0, other: 0, net: 0, foodProduced: 0, foodConsumed: 0 };
    for (const sid of sortedKeys(world.settlements)) {
      const s = world.settlements[sid]!;
      if (s.ownerFactionId !== fid) continue;
      const tax = s.population * e.baseTaxPerCapitaPerMonth * s.taxRate * 10 * policyMul[f.taxPolicy] * (0.4 + 0.6 * s.loyalty) * (mods?.taxEfficiency ?? 1);
      const markets = buildingLevel(s, 'market') + buildingLevel(s, 'harbor');
      const trade = (e.tradeBasePerMonth * markets + s.population * 0.002) * (mods?.tradeIncome ?? 1) * s.infrastructure;
      s.taxIncome = tax;
      s.tradeIncome = trade;
      ledger.taxIncome += tax;
      ledger.tradeIncome += trade;
      ledger.foodProduced += s.foodProduction * 30;
      ledger.foodConsumed += s.foodConsumption * 30;
      for (const b of s.buildings) ledger.buildingUpkeep += BUILDINGS[b.type].upkeepWealth * b.level;
      ledger.administration += 4 * (mods?.governanceCost ?? 1);
      if (f.taxPolicy === 'heavy' || f.taxPolicy === 'emergency') s.unrest = clamp01(s.unrest + BALANCE.politics.unrestFromTax * policyMul[f.taxPolicy]);
    }
    for (const aid of sortedKeys(world.armies)) {
      const a = world.armies[aid]!;
      if (a.factionId !== fid) continue;
      for (const u of a.units) ledger.armyUpkeep += UNITS[u.unitClass].stats.upkeepWealth * u.soldiers * 0.1;
    }
    ledger.net = ledger.taxIncome + ledger.tradeIncome + ledger.tribute - ledger.armyUpkeep - ledger.buildingUpkeep - ledger.administration;
    f.treasury += ledger.net;
    f.ledger = ledger;
    if (f.treasury < 0 && f.isPlayer) out.push({ kind: 'notification', factionId: fid, severity: 'danger', text: 'The treasury is empty - soldiers and officials go unpaid.', focus: null });
  }
}

/** Projected ledger (UI preview) - baseline returns last month's ledger. */
export function projectLedger(world: WorldState, factionId: string): FactionLedger {
  return { ...(world.factions[factionId]?.ledger ?? ({} as FactionLedger)) };
}
