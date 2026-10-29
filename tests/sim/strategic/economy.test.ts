/**
 * Economy rules (DESIGN_SPEC §7.2-§7.5): prices, storage capacity in days, spoilage, harvest pulses, the monsoon roll
 * and flags, distribution (internal market, relief, grain tax), rationing, materials, the AoE market. SIM-01.
 */
import { describe, expect, it } from 'vitest';
import type { SettlementState, SimEvent, WorldState } from '../../../src/core/types';
import { advanceCalendar, floodLevel, monsoonForecastFor, monsoonStrengthFor, monsoonYields, updateMonsoonDaily } from '../../../src/sim/strategic/seasons';
import {
  dailyConsumption,
  materialsProduction,
  reserveColor,
  spoilageRate,
  storageCapacity,
  targetGrainPrice,
  taxCompliance,
  updateEconomyDaily,
  updateEconomyMonthly,
} from '../../../src/sim/strategic/economy';
import { emptyMods, settlementEffects } from '../../../src/sim/strategic/modifiers';
import { executeMarketTrade, quoteMarketTrade, recoverMarketPrices } from '../../../src/sim/strategic/market';
import { RULES } from '../../../src/data/rules';
import { campaign, quiet, sandbox } from './helpers';

const adv = { newDay: false, newMonth: false, newYear: false, seasonChanged: false };

/** Economy-only day driver: calendar + monsoon + daily economy (+ monthly), optionally forcing M. */
function economyDays(w: WorldState, days: number, out: SimEvent[] = [], forceM: number | null = null): SimEvent[] {
  for (let d = 0; d < days; d++) {
    advanceCalendar(w.calendar, 24, adv);
    updateMonsoonDaily(w, out);
    if (forceM !== null) w.monsoon.strength = forceM;
    updateEconomyDaily(w, out);
    if (adv.newMonth) updateEconomyMonthly(w, out);
  }
  return out;
}

const S = (w: WorldState, id: string): SettlementState => w.settlements[id]!;

describe('prices (DESIGN_SPEC §7.4)', () => {
  it('30 reserve days -> ~1.7; empty store while starving -> 3.4; surplus lowers the price', () => {
    expect(targetGrainPrice(30, false)).toBeCloseTo(1.7, 6);
    expect(targetGrainPrice(0, true)).toBeCloseTo(3.4, 6);
    expect(targetGrainPrice(60, false)).toBeCloseTo(1, 6);
    expect(targetGrainPrice(360, false)).toBeCloseTo(0.75, 6);
    expect(targetGrainPrice(10_000, false)).toBeGreaterThanOrEqual(RULES.prices.min);
  });

  it('the price converges to its target at 10% of the gap per day', () => {
    const w = quiet(campaign(3));
    const s = S(w, 'dhanyagram');
    s.grainPrice = 1;
    let p = 1;
    for (let i = 0; i < 40; i++) p += (1.7 - p) * RULES.prices.smoothingPerDay;
    expect(p).toBeGreaterThan(1.68);
  });

  it('tax compliance falls with the price (clamped 0.6..1)', () => {
    expect(taxCompliance(1)).toBe(1);
    expect(taxCompliance(1.7)).toBeCloseTo(0.79, 6);
    expect(taxCompliance(4)).toBe(0.6);
  });
});

describe('storage in days (DESIGN_SPEC §7.3.4)', () => {
  it('capacity = pop x 0.1 x (90 + 45 days per granary level)', () => {
    const w = quiet(campaign(3));
    const dh = S(w, 'dhanyagram'); // Granary L2
    const mods = settlementEffects(w, dh, emptyMods());
    expect(mods.foodCapacity).toBe(90);
    expect(storageCapacity(dh, mods)).toBeCloseTo(dh.population * 0.1 * 180, 6);
    const ush = S(w, 'ushtragram'); // no granary
    expect(storageCapacity(ush, settlementEffects(w, ush, emptyMods()))).toBeCloseTo(ush.population * 0.1 * 90, 6);
    // Rajapura no longer has the baseline ~10 days of storage: 180 days with Granary L2.
    const raj = S(w, 'rajapura');
    expect(raj.foodCapacity / raj.foodConsumption).toBeCloseTo(180, 0);
    expect(reserveColor(120)).toBe('green');
    expect(reserveColor(45)).toBe('amber');
    expect(reserveColor(10)).toBe('red');
  });

  it('grain above capacity spoils at once and is reported', () => {
    const w = quiet(campaign(3));
    const s = S(w, 'kusumpur');
    s.foodStored = s.foodCapacity * 2;
    const out = economyDays(w, 1);
    const spoil = out.find((e) => e.kind === 'spoilage' && e.settlementId === 'kusumpur');
    expect(spoil).toBeDefined();
    expect(s.foodStored).toBeLessThanOrEqual(s.foodCapacity + 1e-6);
  });

  it('daily decay is 0.08% (x0.6 with a granary, x0.5 more with the Royal Granary held)', () => {
    const w = quiet(campaign(3));
    expect(spoilageRate(w, S(w, 'ushtragram'))).toBeCloseTo(0.0008, 12);
    expect(spoilageRate(w, S(w, 'dhanyagram'))).toBeCloseTo(0.0008 * RULES.storage.granarySpoilageFactor, 12);
    const raj = S(w, 'rajapura');
    raj.landmarks.push({ id: 'lm_royal_granary', builtBy: 'heartland', completedDay: 0, condition: 1 });
    w.factions.heartland!.landmarks.push('lm_royal_granary');
    expect(spoilageRate(w, S(w, 'dhanyagram'))).toBeCloseTo(0.0008 * 0.6 * 0.5, 12);
    // A lost landmark loses its effect.
    raj.ownerFactionId = 'highland';
    expect(spoilageRate(w, S(w, 'dhanyagram'))).toBeCloseTo(0.0008 * 0.6, 12);
  });
});

describe('harvests and the monsoon (DESIGN_SPEC §7.3.1-§7.3.3)', () => {
  it('a year delivers the trickle 40% / kharif 35% / rabi 25% of the potential (x yields, crop health)', () => {
    const w = quiet(sandbox(21, { startMonth: 3 }));
    const s = S(w, 'dhanyagram');
    let harvestK = 0;
    let harvestR = 0;
    let total = 0;
    let lastStore = s.foodStored;
    for (let d = 0; d < 360; d++) {
      const out: SimEvent[] = [];
      economyDays(w, 1, out, 1);
      for (const e of out) if (e.kind === 'harvest' && e.settlementId === s.id) e.crop === 'kharif' ? (harvestK += e.amount) : (harvestR += e.amount);
      void lastStore;
      lastStore = s.foodStored;
      total += s.foodProduction;
    }
    const y = monsoonYields(1, s.irrigation);
    const meanP = total / 360 / (RULES.harvest.trickleShare + RULES.harvest.kharifShare * y.kharif + RULES.harvest.rabiShare * y.rabi);
    // Harvests relative to the mean annual potential (labor drifts a little over the year).
    expect(harvestK / (meanP * 360)).toBeCloseTo(RULES.harvest.kharifShare * y.kharif, 1);
    expect(harvestR / (meanP * 360)).toBeCloseTo(RULES.harvest.rabiShare * y.rabi, 1);
    expect(RULES.harvest.trickleShare + RULES.harvest.kharifShare + RULES.harvest.rabiShare).toBeCloseTo(1, 9);
  });

  it('yields follow §7.3.2 (drought penalty 0.45 at M = 0.7, bonus 0.25 at M = 1.4, irrigation shields)', () => {
    expect(monsoonYields(0.7, 0).ym).toBeCloseTo(0.55, 9);
    expect(monsoonYields(1.4, 0).ym).toBeCloseTo(1.25, 9);
    expect(monsoonYields(0.4, 0).ym).toBe(0.3);
    expect(monsoonYields(0.7, 1).kharif).toBeGreaterThan(monsoonYields(0.7, 0).kharif);
  });

  it('the roll happens on day 1 of month 4: flags, event, forecast in month 3', () => {
    const w = quiet(sandbox(5, { startMonth: 3, droughtRisk: 1 }));
    const out = economyDays(w, 31); // 1 Ashadha -> 2 Shravana (month 4, day 1)
    const roll = out.find((e) => e.kind === 'monsoon_roll');
    expect(roll).toBeDefined();
    expect(w.calendar.month).toBe(4);
    expect(w.monsoon.strength).toBeGreaterThanOrEqual(0.45);
    expect(w.monsoon.strength).toBeLessThan(0.7);
    expect(w.events.flags.monsoon_failed).toBe(true);
    // Drought: water -0.2 during varsha.
    const s = S(w, 'rajapura');
    economyDays(w, 1);
    expect(s.waterAvailability).toBeLessThan(RULES.settlement.waterBase + 0.5 * (1 - s.disasterExposure.drought) + 0.01);
    // Flags clear in month 8.
    economyDays(w, 30 * 4);
    expect(w.calendar.month).toBe(8);
    expect(w.events.flags.monsoon_failed).toBeUndefined();
    // Next year's forecast (month 3) is within 0.15 of the roll.
    economyDays(w, 30 * 7 - w.calendar.day + 1);
    expect(w.calendar.month).toBe(3);
    const f = w.monsoon.forecast;
    expect(f).not.toBeNull();
    expect(Math.abs(f! - monsoonStrengthFor(w, w.calendar.year))).toBeLessThanOrEqual(0.15 + 1e-9);
    expect(monsoonForecastFor(w, w.calendar.year)).toBe(f);
  });

  it('a strong monsoon floods: flag, flood > 0.5 at the varsha peak', () => {
    const w = quiet(sandbox(8, { startMonth: 3, droughtRisk: 0, monsoonStrength: 1.5 }));
    economyDays(w, 31);
    expect(w.monsoon.strength).toBeGreaterThan(1.2);
    expect(w.events.flags.monsoon_flood).toBe(true);
    economyDays(w, 30);
    expect(w.calendar.month).toBe(5);
    expect(w.weather.flood).toBeCloseTo(floodLevel(5, w.monsoon.strength), 9);
    expect(w.weather.flood).toBeGreaterThan(0.5);
  });

  it('a scenario fixes the monsoon of its start year (The Broken Crown: 0.7)', () => {
    const w = campaign(2);
    expect(w.monsoon.strength).toBe(0.7);
    expect(monsoonStrengthFor(w, -300)).toBe(0.7);
    const next = monsoonStrengthFor(w, -299);
    expect(next).toBeGreaterThanOrEqual(0.4);
    expect(next).toBeLessThanOrEqual(1.4);
  });
});

describe('consumption and distribution (DESIGN_SPEC §7.3.4-§7.3.5)', () => {
  it('rationing cuts civilian consumption to 85%', () => {
    const w = quiet(campaign(3));
    const s = S(w, 'rajapura');
    const normal = dailyConsumption(w, s);
    w.factions.heartland!.policies.rationingUntilDay = 999;
    expect(dailyConsumption(w, s)).toBeCloseTo(normal * RULES.distribution.rationing.consumption, 6);
  });

  it('relief draws from the royal reserve up to 30 days, unless the reserve is held', () => {
    const w = quiet(campaign(3));
    const f = w.factions.heartland!;
    f.foodReserve = 50_000;
    const s = S(w, 'kusumpur');
    s.foodStored = 0;
    economyDays(w, 1);
    expect(f.foodReserve).toBeLessThan(50_000);
    expect(s.foodStored / s.foodConsumption).toBeGreaterThan(25);
    const w2 = quiet(campaign(3));
    w2.factions.heartland!.foodReserve = 50_000;
    w2.factions.heartland!.policies.holdReserve = true;
    S(w2, 'kusumpur').foodStored = 0;
    S(w2, 'dhanyagram').foodStored = 0;
    S(w2, 'rajapura').foodStored = 0;
    economyDays(w2, 1);
    expect(w2.factions.heartland!.foodReserve).toBe(50_000);
  });

  it('the internal market ships grain from > 120 days to < 60 days, losing 10%', () => {
    const w = quiet(campaign(3));
    const exp = S(w, 'dhanyagram');
    const imp = S(w, 'kusumpur');
    w.factions.heartland!.foodReserve = 0;
    exp.foodStored = exp.foodConsumption * 170;
    imp.foodStored = imp.foodConsumption * 20;
    const before = exp.foodStored;
    const wealth0 = exp.wealth;
    economyDays(w, 1);
    expect(exp.foodStored).toBeLessThan(before);
    expect(imp.foodStored / imp.foodConsumption).toBeGreaterThan(20);
    expect(exp.wealth).toBeGreaterThan(wealth0);
  });

  it('the crown takes a grain tax at harvest from settlements left with >= 90 days', () => {
    const w = quiet(sandbox(4, { startMonth: 6 }));
    const f = w.factions.heartland!;
    const dh = S(w, 'dhanyagram');
    dh.foodStored = dh.foodConsumption * 120;
    const reserve0 = f.foodReserve;
    economyDays(w, 46, [], 1); // kharif on day 15 of month 7
    expect(f.foodReserve).toBeGreaterThan(reserve0);
  });
});

describe('materials (DESIGN_SPEC §7.5)', () => {
  it('workshops make 8 timber/level (x0.5 without forest) + 2 wealth; mines need a deposit', () => {
    const w = quiet(campaign(3));
    const raj = S(w, 'rajapura'); // Workshops L2, no timber resource
    const m = materialsProduction(w, raj);
    expect(m.timber).toBeCloseTo(8 * 2 * 0.5, 6);
    expect(m.wealth).toBeCloseTo(2 * 2, 6);
    const shil = S(w, 'shilapur'); // Mine L2 on stone/copper, Workshops L1
    const ms = materialsProduction(w, shil);
    expect(ms.stone).toBeCloseTo(6 * 2, 6);
    shil.resources = ['grain'];
    expect(materialsProduction(w, shil).stone).toBe(0);
    // Production needs 50 crafts workers per level.
    raj.laborAllocation.crafts = 0;
    expect(materialsProduction(w, raj).timber).toBe(0);
  });
});

describe('AoE market (DESIGN_SPEC §7.5, RULES.market)', () => {
  it('lots of 100: +3% per lot bought, 70% sell-back, clamp, recovery 1%/day', () => {
    const w = campaign(3);
    const f = w.factions.heartland!;
    f.treasury = 100_000;
    const q = quoteMarketTrade(w, 'heartland', 'stone', 3, true);
    expect(q.ok).toBe(true);
    expect(q.perLot[0]).toBeCloseTo(90, 6);
    expect(q.perLot[1]).toBeCloseTo(90 * 1.03, 6);
    expect(q.perLot[2]).toBeCloseTo(90 * 1.03 * 1.03, 6);
    const out: SimEvent[] = [];
    const stone0 = f.materials.stone;
    executeMarketTrade(w, 'heartland', 'stone', 3, true, out);
    expect(f.materials.stone).toBe(stone0 + 300);
    expect(f.marketPrices.stone).toBeCloseTo(1.03 ** 3, 9);
    expect(out.some((e) => e.kind === 'market_trade')).toBe(true);
    const sell = quoteMarketTrade(w, 'heartland', 'stone', 1, false);
    expect(sell.perLot[0]).toBeCloseTo(90 * 1.03 ** 3 * 0.7, 6);
    recoverMarketPrices(w);
    expect(f.marketPrices.stone).toBeCloseTo(1.03 ** 3 - 0.01, 9);
    for (let i = 0; i < 20; i++) executeMarketTrade(w, 'heartland', 'timber', 20, true, out);
    expect(f.marketPrices.timber).toBeLessThanOrEqual(RULES.market.maxFactor);
  });

  it('grain is bought into / sold from the royal reserve; refusals carry reasons', () => {
    const w = campaign(3);
    const f = w.factions.heartland!;
    f.treasury = 10;
    expect(quoteMarketTrade(w, 'heartland', 'grain', 1, true).reason).toMatch(/^Need \d+ wealth$/);
    expect(quoteMarketTrade(w, 'heartland', 'grain', 0, true).reason).toBe('Trade 1 to 20 lots at a time');
    f.foodReserve = 50;
    expect(quoteMarketTrade(w, 'heartland', 'grain', 1, false).reason).toBe('Need 100 grain in the royal reserve');
    // Giridurga's starting towns have a market (Shilapur); Marudesha's Lavanapura too; strip markets -> refused.
    for (const s of Object.values(w.settlements)) if (s.ownerFactionId === 'frontier') s.buildings = s.buildings.filter((b) => b.type !== 'market');
    expect(quoteMarketTrade(w, 'frontier', 'timber', 1, true).reason).toBe('Build a Market in any of your settlements first');
  });

  it('a trade treaty with a timber-owning realm lowers the timber price 10%', () => {
    const w = campaign(3); // Suvarna - Nilavana trade treaty; Nilavana owns timber
    const q = quoteMarketTrade(w, 'heartland', 'timber', 1, true);
    expect(q.perLot[0]).toBeCloseTo(60 * 0.9, 6);
  });
});

describe('monthly ledger (DESIGN_SPEC §7.5)', () => {
  it('debt costs stability and legitimacy every month', () => {
    const w = quiet(campaign(3));
    const f = w.factions.heartland!;
    f.treasury = -5000;
    const st = f.stability;
    const lg = f.legitimacy;
    updateEconomyMonthly(w, []);
    expect(f.stability).toBeLessThan(st);
    expect(f.legitimacy).toBeLessThan(lg);
  });
});
