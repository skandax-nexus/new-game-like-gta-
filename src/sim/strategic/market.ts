/**
 * AoE-style market exchange (DESIGN_SPEC §7.5 "Market exchange", RULES.market). OWNER: Simulation Engineer -
 * Strategic World Simulation (SIM-01).
 *
 * Rules: needs a Market in any owned settlement; lots of 100; base buy prices grain 14 / timber 60 / stone 90 wealth;
 * each lot bought raises that resource's price factor 3% (sold lowers it 3%); selling returns 70% of the current buy
 * price; factors recover 1%/day toward 1 and stay within 0.5x-3x; a trade treaty with a faction owning the resource
 * lowers its buy price 10%; the grain lot price also scales with the realm's grain price (population-weighted).
 * Grain bought goes to (and grain sold comes from) the royal reserve; timber/stone use the faction stockpile.
 */
import type { FactionId, MarketResource, ResourceKind, SettlementState, SimEvent, WorldState } from '../../core/types';
import { RULES } from '../../data/rules';
import { activeTreaty } from './treaties';
import { addMonthToDate, notifyPlayer, stableKeys } from './state';

export const MARKET_RESOURCES: readonly MarketResource[] = ['grain', 'timber', 'stone'];

/** Settlement resources that count as owning a market resource (treaty discount). */
const SOURCES: Readonly<Record<MarketResource, readonly ResourceKind[]>> = {
  grain: ['grain', 'rice'],
  timber: ['timber'],
  stone: ['stone', 'iron', 'copper'],
};

export const MARKET_REASONS = {
  noMarket: 'Build a Market in any of your settlements first',
  badLots: 'Trade 1 to 20 lots at a time',
  needWealth: (n: number) => `Need ${Math.ceil(n)} wealth`,
  needGrain: (n: number) => `Need ${Math.ceil(n)} grain in the royal reserve`,
  needMaterial: (res: string, n: number) => `Need ${Math.ceil(n)} ${res}`,
} as const;

export const MAX_LOTS_PER_TRADE = 20;

export function hasMarket(world: WorldState, factionId: FactionId): boolean {
  for (const id of stableKeys('settlements', world.settlements as Record<string, unknown>)) {
    const s = world.settlements[id] as SettlementState;
    if (s.ownerFactionId !== factionId) continue;
    for (const b of s.buildings) if (b.type === 'market' && b.level > 0) return true;
  }
  return false;
}

/** Population-weighted grain price of the realm (1 = normal). */
export function realmGrainPrice(world: WorldState, factionId: FactionId): number {
  let w = 0;
  let p = 0;
  for (const id of stableKeys('settlements', world.settlements as Record<string, unknown>)) {
    const s = world.settlements[id] as SettlementState;
    if (s.ownerFactionId !== factionId) continue;
    w += s.population;
    p += s.population * s.grainPrice;
  }
  return w > 0 ? p / w : 1;
}

/** True when the faction has an active trade treaty with someone who owns a settlement producing `res`. */
export function treatyDiscount(world: WorldState, factionId: FactionId, res: MarketResource): boolean {
  for (const id of stableKeys('settlements', world.settlements as Record<string, unknown>)) {
    const s = world.settlements[id] as SettlementState;
    const o = s.ownerFactionId;
    if (!o || o === factionId) continue;
    if (!s.resources.some((r) => SOURCES[res].includes(r))) continue;
    if (activeTreaty(world, factionId, o, 'trade')) return true;
  }
  return false;
}

/** Buy price of ONE lot at a given price factor. */
export function lotBuyPrice(world: WorldState, factionId: FactionId, res: MarketResource, factor: number): number {
  const m = RULES.market;
  let price = m.buy[res] * factor;
  if (res === 'grain') price *= realmGrainPrice(world, factionId);
  if (treatyDiscount(world, factionId, res)) price *= 0.9;
  return price;
}

export interface MarketQuote {
  ok: boolean;
  reason: string | null;
  resource: MarketResource;
  lots: number;
  buy: boolean;
  /** Wealth paid (buy) or received (sell) for all lots. */
  wealth: number;
  /** Per-lot wealth in order. */
  perLot: number[];
  /** Price factor after the trade. */
  factorAfter: number;
  /** Current single-lot buy and sell prices (before the trade). */
  buyPrice: number;
  sellPrice: number;
}

function clampFactor(f: number): number {
  return Math.min(RULES.market.maxFactor, Math.max(RULES.market.minFactor, f));
}

/** Quote a trade without executing it (UI market panel, AI planning). */
export function quoteMarketTrade(world: WorldState, factionId: FactionId, res: MarketResource, lots: number, buy: boolean): MarketQuote {
  const m = RULES.market;
  const f = world.factions[factionId];
  let factor = f?.marketPrices[res] ?? 1;
  const buyPrice = lotBuyPrice(world, factionId, res, factor);
  const q: MarketQuote = { ok: false, reason: null, resource: res, lots, buy, wealth: 0, perLot: [], factorAfter: factor, buyPrice, sellPrice: buyPrice * m.sellFactor };
  if (!f) {
    q.reason = 'Unknown faction';
    return q;
  }
  if (!hasMarket(world, factionId)) {
    q.reason = MARKET_REASONS.noMarket;
    return q;
  }
  if (!Number.isInteger(lots) || lots < 1 || lots > MAX_LOTS_PER_TRADE) {
    q.reason = MARKET_REASONS.badLots;
    return q;
  }
  for (let i = 0; i < lots; i++) {
    const p = lotBuyPrice(world, factionId, res, factor);
    const v = buy ? p : p * m.sellFactor;
    q.perLot.push(v);
    q.wealth += v;
    factor = clampFactor(factor * (buy ? 1 + m.stepPerLot : 1 - m.stepPerLot));
  }
  q.factorAfter = factor;
  const amount = lots * m.lot;
  if (buy) {
    if (f.treasury < q.wealth) q.reason = MARKET_REASONS.needWealth(q.wealth);
  } else if (res === 'grain') {
    if (f.foodReserve < amount) q.reason = MARKET_REASONS.needGrain(amount);
  } else if (f.materials[res] < amount) {
    q.reason = MARKET_REASONS.needMaterial(res, amount);
  }
  q.ok = q.reason === null;
  return q;
}

/** Execute a market trade; returns the quote (ok=false with a reason when refused). */
export function executeMarketTrade(world: WorldState, factionId: FactionId, res: MarketResource, lots: number, buy: boolean, out: SimEvent[]): MarketQuote {
  const q = quoteMarketTrade(world, factionId, res, lots, buy);
  if (!q.ok) return q;
  const f = world.factions[factionId]!;
  const amount = lots * RULES.market.lot;
  if (buy) {
    f.treasury -= q.wealth;
    if (res === 'grain') f.foodReserve += amount;
    else f.materials[res] += amount;
    addMonthToDate(world, factionId, 'market', -q.wealth);
  } else {
    f.treasury += q.wealth;
    if (res === 'grain') f.foodReserve -= amount;
    else f.materials[res] -= amount;
    addMonthToDate(world, factionId, 'market', q.wealth);
  }
  f.marketPrices[res] = q.factorAfter;
  out.push({ kind: 'market_trade', factionId, resource: res, lots, buy, wealth: Math.round(q.wealth) });
  notifyPlayer(world, out, factionId, 'info', `${buy ? 'Bought' : 'Sold'} ${amount} ${res} for ${Math.round(q.wealth)} wealth.`);
  return q;
}

/** Daily: every price factor recovers 1% of base toward 1. */
export function recoverMarketPrices(world: WorldState): void {
  const step = RULES.market.recoveryPerDay;
  for (const id of stableKeys('factions', world.factions as Record<string, unknown>)) {
    const p = world.factions[id]!.marketPrices;
    for (const r of MARKET_RESOURCES) {
      const v = p[r];
      p[r] = v > 1 ? Math.max(1, v - step) : v < 1 ? Math.min(1, v + step) : 1;
    }
  }
}
