/**
 * Campaign AI economy: labour, taxes, grain, the royal reserve, the market and the treasury (DESIGN_SPEC §7.3-§7.5,
 * SIM-02 spec 4). OWNER: AI Engineer - Battle AI, Intents & Campaign AI (SIM-02).
 *
 *  - Labour (`set_labor`): crafters enough to staff the workshops and mines (+ a little for local wealth), builders while
 *    something is being built, the rest in the fields - more of them when the grain outlook to the next harvest is
 *    short (the harvest and the daily trickle both scale with the farmers). Only changes of 3+ points are issued.
 *  - Taxes (`set_tax_policy`, `set_tax_rate`): standard; heavy when the projected month is in the red and the
 *    treasury will not cover six such months; emergency when already in debt; lenient when rich and the realm is
 *    restless. Restless settlements get a lighter rate, loyal ones a slightly heavier one when money is short.
 *  - Grain: keeps 60 reserve days in the capital (relief from the royal reserve, `send_relief`), relieves cut-off
 *    settlements the automatic relief cannot reach, rations (`set_policy rationing`) when the realm's stores will not
 *    last to the next harvest, and buys grain on the market (`market_trade`) for a starving realm it can afford.
 *  - Treasury: in debt it sells surplus timber / stone / grain and, if the month is still in the red, disbands its
 *    smallest field army (military.ts keeps the main host).
 */
import type { LaborAllocation, SettlementState, TaxPolicy } from '../../../core/types';
import { RULES } from '../../../data/rules';
import { BUILDINGS } from '../../../data/buildings';
import { KHARIF_HARVEST_MONTH, RABI_HARVEST_MONTH, isRationing, projectLedger } from '../economy';
import { hasMarket, quoteMarketTrade } from '../market';
import type { Situation } from './core';
import { forget, issue, note, num, recently, remember } from './core';

const DAYS_PER_MONTH = 30;

/** Days until the next harvest (kharif or rabi, day 15 of the harvest month). */
export function daysToNextHarvest(sit: Pick<Situation, 'world'>): number {
  const cal = sit.world.calendar;
  const now = cal.month * DAYS_PER_MONTH + cal.day;
  let best = 360;
  for (const m of [KHARIF_HARVEST_MONTH, RABI_HARVEST_MONTH]) {
    let d = m * DAYS_PER_MONTH + RULES.harvest.harvestDay - now;
    if (d <= 0) d += 360;
    best = Math.min(best, d);
  }
  return best;
}

/** Daily grain income before the harvest: the trickle share of the expected production. */
function trickle(s: SettlementState): number {
  return RULES.harvest.trickleShare * s.foodProduction;
}

export interface GrainOutlook {
  /** Days to the next harvest. */
  days: number;
  /** Realm stores + royal reserve expected at the harvest (negative = shortfall). */
  atHarvest: number;
  /** Daily realm consumption. */
  consumption: number;
  /** atHarvest in days of consumption. */
  marginDays: number;
}

/** Will the realm's grain last to the next harvest? */
export function grainOutlook(sit: Situation): GrainOutlook {
  const days = daysToNextHarvest(sit) + 5;
  let stored = sit.f.foodReserve;
  let cons = 0;
  let net = 0;
  for (const s of sit.owned) {
    stored += Math.max(0, s.foodStored);
    cons += s.foodConsumption;
    net += trickle(s) - s.foodConsumption;
  }
  const atHarvest = stored + net * days;
  return { days, atHarvest, consumption: cons, marginDays: cons > 0 ? atHarvest / cons : 999 };
}

/** One settlement's margin at the next harvest, in days of its consumption. */
function settlementMargin(s: SettlementState, days: number): number {
  const c = Math.max(1e-6, s.foodConsumption);
  return (Math.max(0, s.foodStored) + (trickle(s) - c) * days) / c;
}

// ---------------------------------------------------------------------------------------------------
// Labour
// ---------------------------------------------------------------------------------------------------

function laborTarget(sit: Situation, s: SettlementState, realmMargin: number, days: number): LaborAllocation {
  const labor = Math.max(1, s.labor);
  let staffed = 0;
  for (const b of s.buildings) if (b.type === 'workshop' || b.type === 'mine') staffed += b.level;
  const own = settlementMargin(s, days);
  const hungry = realmMargin < 30 || own < 15;
  const plenty = realmMargin > 90 && own > 60 && s.foodStored > 0.85 * s.foodCapacity;
  let crafts = Math.min(0.3, (staffed * RULES.materials.workersPerLevel * 1.1) / labor + (hungry ? 0.02 : 0.05));
  if (plenty) crafts = Math.min(0.35, crafts + 0.1);
  crafts = Math.max(0.04, crafts);
  const construction = s.construction.length > 0 ? (hungry ? 0.08 : 0.12) : 0.04;
  const military = s.kind === 'fort' ? 0.04 : 0.02;
  const farming = 1 - crafts - construction - military;
  return { farming: round2(farming), construction: round2(construction), crafts: round2(crafts), military: round2(1 - round2(farming) - round2(construction) - round2(crafts)) };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function planLabor(sit: Situation): void {
  const o = grainOutlook(sit);
  for (const s of sit.owned) {
    const t = laborTarget(sit, s, o.marginDays, o.days);
    const a = s.laborAllocation;
    const diff = Math.max(Math.abs(a.farming - t.farming), Math.abs(a.crafts - t.crafts), Math.abs(a.construction - t.construction));
    if (diff < 0.03) continue;
    issue(sit, { kind: 'set_labor', settlementId: s.id, allocation: t });
    if (Math.abs(a.farming - t.farming) >= 0.1) note(sit, 'economy', `${s.name}: ${Math.round(t.farming * 100)}% of the hands to the fields (grain margin ${Math.round(o.marginDays)} days at the next harvest)`);
  }
}

// ---------------------------------------------------------------------------------------------------
// Taxes
// ---------------------------------------------------------------------------------------------------

/** The projected month (computed once per run). */
function ledgerOf(sit: Situation): ReturnType<typeof projectLedger> {
  if (!sit.ledger) sit.ledger = projectLedger(sit.world, sit.fid);
  return sit.ledger;
}

export function planTaxes(sit: Situation): void {
  const { f } = sit;
  const ledger = ledgerOf(sit);
  const net = ledger.net;
  remember(sit, 'net', Math.round(net));
  let restless = 0;
  for (const s of sit.owned) if (s.rebellionStage !== 'calm' && s.rebellionStage !== 'grumbling') restless++;
  let policy: TaxPolicy = 'standard';
  if (f.treasury < 0) policy = f.stability > 0.3 && restless === 0 ? 'emergency' : 'heavy';
  else if (net < 0 && f.treasury < -6 * net) policy = 'heavy';
  else if (restless > 0 && f.treasury > 12 * Math.max(50, ledger.armyUpkeep + ledger.buildingUpkeep)) policy = 'lenient';
  if (policy !== f.taxPolicy) {
    issue(sit, { kind: 'set_tax_policy', policy });
    note(sit, 'economy', `tax policy ${policy} (treasury ${Math.round(f.treasury)}, projected month ${net >= 0 ? '+' : ''}${Math.round(net)}${restless ? `, ${restless} restless settlement(s)` : ''})`);
  }
  const short = f.treasury < 0 || (net < 0 && f.treasury < -12 * net);
  for (const s of sit.owned) {
    let rate: number = RULES.tax.defaultRate;
    const stage = s.rebellionStage;
    if (stage === 'protest' || stage === 'tax_refusal' || stage === 'unrest' || stage === 'revolt') rate = 0.1;
    else if (s.loyalty < 0.35) rate = 0.12;
    else if (short && s.loyalty > 0.6 && stage === 'calm') rate = 0.2;
    if (s.taxRelief) continue; // a negotiated cut runs its course
    if (Math.abs(s.taxRate - rate) > 0.009) issue(sit, { kind: 'set_tax_rate', settlementId: s.id, rate });
  }
}

// ---------------------------------------------------------------------------------------------------
// Grain: capital reserve, relief, rationing, market
// ---------------------------------------------------------------------------------------------------

/** Daily: emergencies only (cheap). Relief for starving or cut-off settlements and the capital's 60 days. */
export function planGrainDaily(sit: Situation): void {
  const { f } = sit;
  let reserve = f.foodReserve;
  for (const s of sit.owned) {
    if (s.besiegedBy || s.foodConsumption <= 0) continue;
    const rd = s.foodStored / s.foodConsumption;
    const isCapital = sit.capital?.id === s.id;
    const want = isCapital ? 60 : 15;
    if (rd >= want) continue;
    if (recently(sit, `relief_${s.id}`, 10)) continue;
    const food = Math.floor(Math.min(reserve - 0.25 * f.foodReserve, (want + 15 - rd) * s.foodConsumption));
    if (food < 200) continue;
    reserve -= food;
    remember(sit, `relief_${s.id}`, sit.day);
    issue(sit, { kind: 'send_relief', settlementId: s.id, food, wealth: 0 });
    note(sit, 'economy', `sends ${food} grain from the royal granaries to ${s.name} (${Math.round(rd)} days left${isCapital ? ', capital kept at 60 days' : ''})`);
  }
}

/** Rationing and grain purchases (economy runs). */
export function planGrain(sit: Situation): void {
  const { world, f } = sit;
  const o = grainOutlook(sit);
  remember(sit, 'grainMargin', Math.round(o.marginDays));
  const rationing = sit.owned.length > 0 && isRationing(world, sit.owned[0]!);
  if (!rationing && o.marginDays < 10 && o.days > 20) {
    issue(sit, { kind: 'set_policy', policy: 'rationing', on: true });
    note(sit, 'economy', `orders rationing: the stores will be ${Math.round(-Math.min(0, o.marginDays))} days short at the harvest in ${o.days} days`);
  } else if (rationing && o.marginDays > 45) {
    issue(sit, { kind: 'set_policy', policy: 'rationing', on: false });
    note(sit, 'economy', 'ends rationing: the stores will last');
  }
  if (f.policies.holdReserve) issue(sit, { kind: 'set_policy', policy: 'hold_reserve', on: false });
  // Buy grain when the realm will run dry and the treasury can carry it (the market raises its price 3% a lot).
  if (o.marginDays < 0 && hasMarket(world, sit.fid)) {
    const need = Math.ceil(-o.atHarvest / RULES.market.lot);
    const floor = wealthFloor(sit);
    const lots = Math.min(20, need);
    if (lots >= 1) {
      const q = quoteMarketTrade(world, sit.fid, 'grain', lots, true);
      if (q.ok && f.treasury - q.wealth > floor && q.factorAfter < 2) {
        issue(sit, { kind: 'market_trade', resource: 'grain', lots, buy: true });
        note(sit, 'economy', `buys ${lots * RULES.market.lot} grain on the market for ${Math.round(q.wealth)}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// Treasury
// ---------------------------------------------------------------------------------------------------

/** Wealth the realm keeps in hand: three months of upkeep, at least 300. */
export function wealthFloor(sit: Situation): number {
  const upkeep = Math.max(0, num(sit, 'upkeep', 150));
  return Math.max(300, 3 * upkeep);
}

/** Spending room: treasury above the floor (and above what a landmark saving plan holds back). */
export function spendable(sit: Situation): number {
  return sit.f.treasury - wealthFloor(sit) - num(sit, 'saveWealth', 0);
}

/** In debt or heading there: sell what can be spared. Returns true when the realm is in a money crisis. */
export function planTreasury(sit: Situation): boolean {
  const { world, f } = sit;
  const ledger = ledgerOf(sit);
  remember(sit, 'upkeep', Math.round(ledger.armyUpkeep + ledger.buildingUpkeep + ledger.administration));
  remember(sit, 'net', Math.round(ledger.net));
  const crisis = f.treasury < 0 || (ledger.net < 0 && f.treasury < -3 * ledger.net);
  if (crisis) {
    if (num(sit, 'crisisSince', -1) < 0) remember(sit, 'crisisSince', sit.day);
  } else forget(sit, 'crisisSince');
  if (!crisis || !hasMarket(world, sit.fid)) return crisis;
  // Sell materials beyond 400 of each, and grain beyond 120 days of the realm's consumption.
  let cons = 0;
  for (const s of sit.owned) cons += s.foodConsumption;
  const sells: [('timber' | 'stone' | 'grain'), number][] = [
    ['timber', Math.floor((f.materials.timber - 400) / RULES.market.lot)],
    ['stone', Math.floor((f.materials.stone - 400) / RULES.market.lot)],
    ['grain', Math.floor((f.foodReserve - 120 * cons) / RULES.market.lot)],
  ];
  for (const [res, n] of sells) {
    const lots = Math.min(20, n);
    if (lots < 1) continue;
    const q = quoteMarketTrade(world, sit.fid, res, lots, false);
    if (!q.ok) continue;
    issue(sit, { kind: 'market_trade', resource: res, lots, buy: false });
    note(sit, 'economy', `sells ${lots * RULES.market.lot} ${res} for ${Math.round(q.wealth)} (treasury ${Math.round(f.treasury)})`);
  }
  return crisis;
}

/** Monthly upkeep a building level adds. */
export function buildingUpkeep(type: keyof typeof BUILDINGS): number {
  return BUILDINGS[type].upkeepWealth;
}
