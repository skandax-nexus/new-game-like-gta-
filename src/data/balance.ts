/**
 * Global tuning values read by the simulation. OWNER: Creative Director (balance), in consultation with
 * the Lead AI & Simulation Engineer. These numbers are a tunable gameplay model (GDD §5), not history.
 * Formulas that use them are in docs/DESIGN_SPEC.md (§6 battle, §7 strategic); further design constants
 * live in data/rules.ts. Notable scale factors kept from the baseline:
 *  - monthly tax per person at 100% rate = baseTaxPerCapitaPerMonth x RULES.tax.scale (10) = 0.2 wealth;
 *  - melee/ranged damage constant K = damageScale x 10 = 0.45 HP per front soldier-second at odds 1;
 *  - map meters x travelScale = real meters for march times (region 6,144 m -> ~184 km at 30).
 */
import type { BalanceConfig } from '../core/types';

export const BALANCE: BalanceConfig = {
  economy: {
    foodPerPersonPerDay: 0.1,
    foodPerFarmerPerDay: 0.32,
    baseTaxPerCapitaPerMonth: 0.02,
    tradeBasePerMonth: 40,
    priceElasticity: 1.4,
    granarySpoilagePerDay: 0.0008,
    populationGrowthPerYear: 0.012,
    famineDeathRatePerDay: 0.0015,
    kharifHarvestMonth: 7,
    rabiHarvestMonth: 1,
    monsoonYieldBonus: 0.25,
    droughtYieldPenalty: 0.45,
    irrigationYieldBonus: 0.3,
    infrastructureDecayPerDay: 0.0004,
    laborPerPopulation: 0.45,
  },
  military: {
    soldierFoodPerDay: 1,
    marchKmPerDay: { track: 18, road: 24, royal_road: 30, offroad: 12 },
    monsoonMarchFactor: 0.6,
    forageFoodPerDay: 0.35,
    starvationMoralePerDay: 6,
    fatiguePerMarchDay: 0.05,
    recoveryPerRestDay: 0.12,
    travelScale: 30,
    contactRadius: 140,
    siegeAttritionPerDay: 0.004,
  },
  morale: {
    weights: { leadership: 18, cohesion: 22, fatigue: 24, supply: 10, tacticalPosition: 14, recentEvents: 36, perceivedRisk: 50 },
    routThreshold: 30,
    rallyThreshold: 50,
    driftPerSec: 4,
    commanderFallenShock: -0.7,
    flankShock: -0.35,
    rearShock: -0.5,
    allyRoutShock: -0.3,
    allyRoutRadius: 120,
    chargeShock: -0.25,
  },
  combat: {
    meleeDamageScale: 0.045,
    rangedDamageScale: 0.045,
    chargeImpulse: 0.35,
    flankMultiplier: 1.5,
    rearMultiplier: 2,
    heightAdvantagePerMeter: 0.012,
    fatigueRunPerSec: 0.004,
    fatigueFightPerSec: 0.003,
    fatigueRecoverPerSec: 0.0015,
    pursuitKillRate: 0.02,
    surrenderMorale: 8,
    captureFraction: 0.3,
    cohesionLossPerSecMoving: 0.01,
    cohesionRecoverPerSec: 0.02,
  },
  politics: {
    loyaltyDriftPerDay: 0.002,
    unrestFromHunger: 0.02,
    unrestFromTax: 0.01,
    rebellionThresholds: [0.15, 0.3, 0.45, 0.6, 0.75, 0.9],
    successionCrisisChance: 0.35,
    governorAmbitionWeight: 0.5,
  },
  diplomacy: {
    opinionDecayPerMonth: 2,
    tradeOpinionBonus: 1,
    warWearinessPerMonth: 3,
    tributeOpinionPenalty: 5,
    grievanceDecayPerMonth: 0.1,
  },
  espionage: {
    baseSuccessPerDay: 0.03,
    baseRiskPerDay: 0.01,
    intelDecayPerMonth: 0.08,
  },
};
