/**
 * Design rules and constants that are not part of `BalanceConfig` (DESIGN_SPEC §6-§8, §10). OWNER:
 * Creative Director. Sim/gameplay/UI developers read these instead of hard-coding numbers; every value is
 * referenced by section in docs/DESIGN_SPEC.md. Plain data (no logic) - deterministic and three-free.
 *
 * Conventions: shares/fractions 0..1; "per day" = per strategic game day; money = wealth (silver coin);
 * food = grain measures (1 measure = rations for 10 person-days); materials = timber loads / stone blocks.
 */
import type { ArmyStance, RebellionStage, Season, TaxPolicy, UnitCategory, VictoryType } from '../core/types';

/** Per-stage consequences of the rebellion escalation ladder (DESIGN_SPEC §7.9). Multipliers on the settlement. */
export interface RebellionStageEffect {
  tax: number;
  trade: number;
  recruitment: number;
  production: number;
  /** Building condition lost per day. */
  conditionLossPerDay: number;
  /** Event fired on entering the stage (null = notification only). */
  eventId: string | null;
}

export const RULES = {
  // ------------------------------------------------------------------------------------------- §7.3
  storage: {
    /** Base storage of a settlement in days of its own consumption (household jars, pits). */
    baseDays: 90,
    /** BuildingDef.effects.foodCapacity and landmark foodCapacity are DAYS of storage per level. */
    capacityEffectUnit: 'days',
    /** Spoilage multiplier when the settlement has a granary (BALANCE.economy.granarySpoilagePerDay x this). */
    granarySpoilageFactor: 0.6,
    /** A settlement never ships grain below this many days of its own consumption. */
    keepDays: 30,
  },
  harvest: {
    /** Share of the annual crop that arrives as a daily trickle (pulses, vegetables, milk) vs harvests. */
    trickleShare: 0.4,
    kharifShare: 0.35,
    rabiShare: 0.25,
    /** Calendar months (0 = Chaitra). Harvest lands on day 15 of the harvest month. */
    kharifSowMonth: 4,
    rabiSowMonth: 8,
    harvestDay: 15,
    /** Trickle multiplier by season (mean 1.0). */
    seasonTrickle: { vasanta: 1.1, grishma: 0.7, varsha: 0.9, sharad: 1.2, hemanta: 1.0, shishira: 1.1 } satisfies Record<Season, number>,
    /** fertilityMult = fertilityBase + fertilityScale x province fertility. */
    fertilityBase: 0.6,
    fertilityScale: 0.5,
    /** Monsoon strength M rolled on day 1 of month 4 (varsha): clamp(normal(mean, sd), min, max). */
    monsoon: { mean: 1.0, sd: 0.18, min: 0.4, max: 1.4, droughtBelow: 0.7, floodAbove: 1.2 },
    /** Share of the kharif/rabi crop protected from a failed monsoon by irrigation (x settlement.irrigation). */
    irrigationShield: 0.6,
    /** Crop health lost when an enemy army camps/forages within 600 m during the sowing month. */
    warSowingPenalty: 0.3,
  },
  // ------------------------------------------------------------------------------------------- §7.4
  prices: {
    /** Reserve days at which the grain price is 1.0. */
    normalReserveDays: 60,
    /** Reserve days above which surplus lowers the price (down to min at 2x this). */
    surplusReserveDays: 180,
    min: 0.5,
    max: 4,
    /** Added to the target while the settlement is starving (store empty and net < 0). */
    faminePremium: 1,
    /** Fraction of the gap closed per day. */
    smoothingPerDay: 0.1,
    /** Unrest per day per 0.1 of price above `unrestAbove`. */
    unrestAbove: 1.3,
    unrestPerTenth: 0.001,
    /** Tax compliance = clamp(min, 1, a - b x price). */
    compliance: { a: 1.3, b: 0.3, min: 0.6 },
  },
  // ------------------------------------------------------------------------------------------- §7.5
  tax: {
    /** Monthly tax per person at 100% rate = BALANCE.economy.baseTaxPerCapitaPerMonth x scale. */
    scale: 10,
    defaultRate: 0.15,
    maxRate: 0.6,
    policy: {
      lenient: { income: 0.7, unrestPerMonth: -0.02, loyalty: 0.05, legitimacyPerMonth: 0 },
      standard: { income: 1, unrestPerMonth: 0, loyalty: 0, legitimacyPerMonth: 0 },
      heavy: { income: 1.35, unrestPerMonth: 0.0135, loyalty: -0.05, legitimacyPerMonth: -0.005 },
      emergency: { income: 1.7, unrestPerMonth: 0.017, loyalty: -0.12, legitimacyPerMonth: -0.015 },
    } satisfies Record<TaxPolicy, { income: number; unrestPerMonth: number; loyalty: number; legitimacyPerMonth: number }>,
    /** Share of a surplus harvest collected in kind into FactionState.foodReserve. */
    grainTaxShare: 0.25,
    /** Administration cost per owned settlement per month (x faction governanceCost). */
    adminPerSettlement: 4,
    /** Extra administration per settlement beyond the age's governorSlots x 2. */
    adminOverextension: 6,
  },
  trade: {
    perCapitaPerMonth: 0.002,
    craftsPerWorkerPerMonth: 0.004,
    /** 1.0 of SettlementModifiers.tradeIncome = this much wealth per month (market L1 0.25 -> 40). */
    effectScale: 160,
    /** Trade treaty: +share of both parties' trade income. */
    treatyBonus: 0.15,
    /** Trade income x (0.5 + 0.5 x connected road share) where an edge counts if condition >= 0.5 and unblocked. */
    roadWeight: 0.5,
  },
  /** AoE-style market exchange (needs a market in any owned settlement). Prices in wealth per lot. */
  market: {
    lot: 100,
    buy: { grain: 14, timber: 60, stone: 90 },
    /** Selling returns this share of the current buy price. */
    sellFactor: 0.7,
    /** Each lot bought raises (sold lowers) that price by this fraction; recovers toward base per day. */
    stepPerLot: 0.03,
    recoveryPerDay: 0.01,
    minFactor: 0.5,
    maxFactor: 3,
  },
  materials: {
    /** Workshops produce timber at this share unless the settlement has the 'timber' resource. */
    workshopTimberWithoutForest: 0.5,
    /** Production requires crafts labor >= this many workers per building level. */
    workersPerLevel: 50,
    /** Mines produce full stone only on a stone/iron/copper deposit; else 0. */
    mineNeedsDeposit: true,
  },
  // ------------------------------------------------------------------------------------------- §7.2
  population: {
    /**
     * Annual growth x housing factor x health; famine deaths per BALANCE. Default labor shares below are
     * tuned so that, with a normal monsoon, annual civilian grain balance is about: Suvarna +15%,
     * Giridurga -9%, Nilavana +3%, Marudesha -15%, free towns -4% (DESIGN_SPEC §13.2).
     */
    overcrowdingGrowthPenalty: 2,
    /** Labor = population x BALANCE.economy.laborPerPopulation x (0.5 + 0.5 x health). */
    laborHealthWeight: 0.5,
    /** Emigration per day when loyalty < 0.3 and price > 2 (to the nearest same-owner settlement). */
    emigrationPerDay: 0.0005,
    defaultLabor: {
      village: { farming: 0.75, construction: 0.1, crafts: 0.1, military: 0.05 },
      urban: { farming: 0.55, construction: 0.1, crafts: 0.25, military: 0.1 },
      fort: { farming: 0.55, construction: 0.1, crafts: 0.1, military: 0.25 },
    },
  },
  // ------------------------------------------------------------------------------------------- §8.2
  construction: {
    /** Settlement build grid cell (m). Footprints are multiples of this. */
    gridCell: 4,
    levelCostMultiplier: 1.6,
    levelTimeMultiplier: 1.3,
    /** Max builders per job as a multiple of the nominal crew (labor / buildDays). */
    maxCrewRatio: 1.25,
    /** Jobs progressing at once per settlement (builders fill jobs in queue order). */
    parallelJobs: 3,
    maxQueue: 5,
    /** Minimum builders every settlement can field (elders, children, hired hands). */
    minBuilders: 20,
    /** Monsoon slows outdoor works (all buildings except housing/workshop). */
    monsoonFactor: 0.7,
    /** Cancelling refunds this share of the unspent cost (cost x (1 - progress)). */
    cancelRefund: 0.9,
    /** Repair cost = this x level cost x (1 - condition); effects scale with condition. */
    repairCostFactor: 0.5,
    /** Visual stages (progress thresholds) for render: foundation -> scaffolding -> roofing -> complete. */
    stages: [
      { id: 'foundation', from: 0, label: 'Laying foundations' },
      { id: 'scaffolding', from: 0.1, label: 'Raising walls' },
      { id: 'roofing', from: 0.6, label: 'Roofing and finishing' },
      { id: 'complete', from: 1, label: 'Complete' },
    ],
  },
  // ------------------------------------------------------------------------------------------- §7.6
  recruitment: {
    /** Recruit pool cap = population x this; regen per month = cap x regenPerMonth x modifiers. */
    poolPerCapita: 0.06,
    regenPerMonth: 0.1,
    /** New formations: experience + barracks level bonus (level 2+). */
    baseExperience: 0.1,
    barracksExperiencePerLevel: 0.1,
    /** Mounted classes cost this much less wealth when the faction owns a 'horses' resource. */
    horsesDiscount: 0.2,
    /** War elephants need an owned 'elephants' resource or a trade treaty with a faction owning one. */
    elephantsNeedSource: true,
    /** Formations per recruitment job. */
    maxFormationsPerJob: 4,
    /** A supply train is loaded from the settlement store when raised (cartLoad x carts). */
    loadSupplyFromStore: true,
  },
  // ------------------------------------------------------------------------------------------- §7.7
  armies: {
    /** Daily march multiplier of the slowest unit category present (x marchKmPerDay). */
    pace: { infantry: 1, ranged: 1, mounted: 1.5, beast: 0.95, support: 0.85 } satisfies Record<UnitCategory, number>,
    /** Chariots count as 'mounted' only on roads/open ground; elsewhere 0.6. */
    chariotOffroadPace: 0.6,
    forcedMarch: { speed: 1.3, fatiguePerDay: 0.1, attritionPerDay: 0.002 },
    stance: {
      aggressive: { contactRadius: 1.3, retreatBelow: 0.2 },
      balanced: { contactRadius: 1, retreatBelow: 0.35 },
      cautious: { contactRadius: 0.8, retreatBelow: 0.6 },
    } satisfies Record<ArmyStance, { contactRadius: number; retreatBelow: number }>,
    /** Strength ratio below which an AI army avoids contact (x stance retreatBelow). */
    maxFormations: 20,
    /** Visibility: base scout radius (map m) + scouts formation bonus; x faction scoutRange. */
    scoutRadius: 350,
    scoutsBonusRadius: 250,
    watchtowerRadius: 900,
  },
  supply: {
    /** Days of rations every soldier carries (soldiers x upkeepFood x days). */
    carriedRationDays: 5,
    /** Grain per supply-train cart (12 carts per formation). */
    cartLoad: 300,
    /** Resupply radius around an own settlement/depot (map m, + settlement radius). */
    resupplyRadius: 400,
    /** Max share of a settlement's store an army may draw per day. */
    maxDrawPerDay: 0.2,
    depot: { costWealth: 150, costTimber: 50, capacity: 6000, buildDays: 5 },
    /** Foraging meets this share of daily need x fertility x season factor; taken from the nearest settlement. */
    forageSeason: { vasanta: 1.4, grishma: 0.5, varsha: 0.7, sharad: 1.5, hemanta: 1.1, shishira: 0.9 } satisfies Record<Season, number>,
    forageRadius: 600,
    /** Foraging in enemy land plunders: x this need met, target settlement unrest/damage. */
    plunderMultiplier: 1.7,
    forageUnrestPerDay: 0.004,
    starvation: { desertionAfterDays: 3, desertionPerDay: 0.01, heavyAfterDays: 10, heavyDesertionPerDay: 0.03 },
    /** Daily attrition (share of soldiers) by condition. */
    attrition: { monsoonOffroad: 0.002, roughOffroad: 0.001, dryHeat: 0.003, siege: 0.004 },
    requisition: { maxShare: 0.6, loyaltyPer1000: -0.02, memoryDecayPerMonth: 0.25 },
  },
  siege: {
    /** wallHp per fort level (x defender fortDefense). */
    wallHpPerLevel: 1000,
    /** Daily wall damage = sum(soldiers x siege stat) x this x attacker siegeStrength. */
    damageScale: 0.5,
    /** Production of a besieged settlement (fields outside the walls are lost). */
    besiegedProduction: 0.3,
    /** Daily surrender chance once the store is empty = this x starvation days / 10 (cap 0.6). */
    surrenderChance: 0.1,
    ladderDays: 5,
    /** Assault without a breach: attacker morale/attack penalty in the siege battle. */
    escaladePenalty: 0.3,
    captureLootShare: 0.3,
    capturedLoyalty: 0.2,
    capturedUnrest: 0.3,
    /** Days after capture during which loyalty is reduced (linear recovery). */
    occupationDays: 360,
  },
  // ------------------------------------------------------------------------------------------- §7.9
  politics: {
    loyaltyBase: 0.5,
    loyaltyLegitimacyWeight: 0.3,
    loyaltyTaxWeight: 1,
    loyaltyHungerWeight: 0.15,
    loyaltyUnrestWeight: 0.3,
    /** loyalty += (target - loyalty) x this per day. */
    loyaltyApproachPerDay: 0.02,
    unrest: {
      starving: 0.02,
      lowLoyaltyBelow: 0.35,
      lowLoyalty: 0.002,
      overcrowding: 0.01,
      poorSanitationBelow: 0.3,
      poorSanitation: 0.001,
      orderRelief: 0.004,
      garrisonRelief: 0.002,
    },
    /** Going DOWN a stage requires unrest below threshold - hysteresis. */
    hysteresis: 0.05,
    secessionAfterDaysInRevolt: 30,
    rebelSoldiersPerCapita: 0.03,
    stageEffects: {
      calm: { tax: 1, trade: 1, recruitment: 1, production: 1, conditionLossPerDay: 0, eventId: null },
      grumbling: { tax: 0.95, trade: 1, recruitment: 0.95, production: 1, conditionLossPerDay: 0, eventId: null },
      protest: { tax: 0.85, trade: 0.9, recruitment: 0.8, production: 1, conditionLossPerDay: 0, eventId: 'evt_protest' },
      tax_refusal: { tax: 0, trade: 0.7, recruitment: 0.5, production: 0.95, conditionLossPerDay: 0, eventId: 'evt_tax_refusal' },
      unrest: { tax: 0, trade: 0.5, recruitment: 0, production: 0.85, conditionLossPerDay: 0.005, eventId: 'evt_riots' },
      revolt: { tax: 0, trade: 0, recruitment: 0, production: 0.7, conditionLossPerDay: 0.01, eventId: 'evt_revolt' },
      secession: { tax: 0, trade: 0, recruitment: 0, production: 0.7, conditionLossPerDay: 0, eventId: null },
    } satisfies Record<RebellionStage, RebellionStageEffect>,
    /** negotiate_rebels offers (DESIGN_SPEC §7.9). */
    offers: {
      relief: { foodDays: 30, wealthPer100Pop: 2, unrest: -0.25, loyalty: 0.1 },
      tax_cut: { rateDelta: -0.05, days: 180, unrest: -0.15, loyalty: 0.05 },
      autonomy: { autonomy: 0.25, unrest: -0.3, taxShare: -0.25, governorLoyalty: 0.2, legitimacy: -0.02 },
      coercion: { unrest: -0.35, loyalty: -0.15, backfireChanceBelowLoyalty: 0.3, backfireChance: 0.3, garrisonPerCapita: 0.02 },
    },
    governor: { stewardshipTaxPerPoint: 0.01, interestLoyalty: 0.05, demandBelowLoyalty: 0.3, secedeBelowLoyalty: 0.15, demandAmbitionAbove: 0.6 },
    /** Legitimacy per month for each governor above the age's governor slots. */
    overSlotLegitimacyPerMonth: -0.02,
  },
  dynasty: {
    /** Yearly health loss by age band. */
    aging: [
      { from: 50, healthPerYear: -0.03 },
      { from: 60, healthPerYear: -0.06 },
      { from: 70, healthPerYear: -0.12 },
    ],
    adultAge: 16,
    regencyBelowAge: 16,
    regencyLegitimacy: -0.1,
    birthChancePerYear: 0.1,
    fertileAges: [18, 40] as const,
    adoptedHeirLegitimacy: -0.2,
    /** Crisis chance = BALANCE.politics.successionCrisisChance x (1 - legitimacy) x (claimant ? 2 : 1), cap 0.9. */
    crisisCap: 0.9,
    newRulerLegitimacy: -0.05,
  },
  council: {
    /** Opinion change for an advisor when the player follows / ignores their recommended choice. */
    followedOpinion: 5,
    ignoredOpinion: -3,
    ignoredStreakForGrievance: 3,
    grievanceOpinion: -10,
  },
  // ------------------------------------------------------------------------------------------- §7.10
  diplomacy: {
    opinionRange: [-100, 100] as const,
    /** War score contributions (from the winner's perspective, -100..100). */
    warScore: { battlePerShare: 20, settlement: 15, capital: 30, occupationPerMonth: 2 },
    truceDays: 360,
    tradeTreatyDays: 720,
    nonAggressionDays: 360,
    marriageOpinion: 30,
    marriageTrust: 0.2,
    breakMarriageOpinion: -60,
    breakMarriageLegitimacy: -0.1,
    breakTreatyTrustAll: -0.15,
    /** AI acceptance: accept when utility > 0. Weights per proposal type (DESIGN_SPEC §7.10 table). */
    acceptance: {
      peace: { constant: -10, opinion: 0.3, losingWarScore: 0.5, warWearinessPerMonth: 1, weakerBonus: 20 },
      trade: { constant: 15, opinion: 0.5, mercantile: 25 },
      military_access: { constant: -20, opinion: 0.6, trust: 20, sharedEnemy: 30 },
      mutual_defense: { constant: -35, opinion: 0.6, trust: 30, sharedThreat: 40 },
      non_aggression: { constant: 10, opinion: 0.4, threat: 30 },
      tributary: { constant: 0, strengthRatioOver: 1.5, strengthWeight: 40, losingWar: 30, pride: -20, opinion: 0.2 },
      marriage_alliance: { constant: 15, opinion: 0.5, prestigePer5: 1, diplomatic: 20 },
    },
    /** Proposals expire after this many days. */
    proposalDays: 30,
  },
  espionage: {
    /** Success/day = base x (0.5 + skill/20) x (1 + network) x espionage / (1 + counterIntel). */
    counterIntelRiskWeight: 1.5,
    missionDays: { gather_intel: 20, counter_intelligence: 30, sabotage_supply: 25, incite_unrest: 35, spread_rumors: 30, protect_court: 30 },
    effects: {
      gather_intel: { intel: 0.4, revealDays: 60 },
      counter_intelligence: { counterIntel: 0.3, days: 90 },
      sabotage_supply: { foodLoss: 0.4, roadDamage: 0.4 },
      incite_unrest: { unrest: 0.2, withClaimant: 0.3 },
      spread_rumors: { legitimacy: -0.05, stability: -0.03, opinion: -10 },
      protect_court: { plotReduction: 0.5, days: 120 },
    },
    caughtOpinion: -20,
    /** What the player sees about a rival at intel level >= threshold. */
    intelTiers: [
      { from: 0, sees: 'Armies within scout range only; settlement owners.' },
      { from: 0.3, sees: 'Approximate army sizes (+/-25%), treasury bracket, stability bracket.' },
      { from: 0.6, sees: 'Exact numbers, governors and loyalty, current AI goal.' },
    ],
  },
  // ------------------------------------------------------------------------------------------- §6
  battle: {
    deploymentSecWorld: 60,
    deploymentSecSkirmish: 30,
    timeLimitSecWorld: 30 * 60,
    timeLimitSecSkirmish: 40 * 60,
    /** Formation shape modifiers (multipliers; 1 = none). */
    shapes: {
      line: { aspect: 5, spread: 1, speed: 1, meleeAttack: 1, meleeDefense: 1, missileDamageTaken: 1, chargeImpact: 1, allRound: false },
      column: { aspect: 0.25, spread: 1, speed: 1.15, meleeAttack: 0.8, meleeDefense: 0.8, missileDamageTaken: 1.1, chargeImpact: 0.8, allRound: false },
      square: { aspect: 1, spread: 1, speed: 0.8, meleeAttack: 0.9, meleeDefense: 1.1, missileDamageTaken: 1.1, chargeImpact: 0.9, allRound: true },
      wedge: { aspect: 1.6, spread: 1.1, speed: 1, meleeAttack: 1.1, meleeDefense: 0.85, missileDamageTaken: 1, chargeImpact: 1.3, allRound: false },
      loose: { aspect: 3, spread: 1.8, speed: 1.1, meleeAttack: 0.85, meleeDefense: 0.75, missileDamageTaken: 0.5, chargeImpact: 0.7, allRound: false },
      circle: { aspect: 1, spread: 1.15, speed: 0.3, meleeAttack: 0.9, meleeDefense: 1.15, missileDamageTaken: 1, chargeImpact: 0.8, allRound: true },
    },
    charge: { minRunMeters: 20, minSpeedShare: 0.6, infantryRunFrom: 40, mountedRunFrom: 90, bracedFactor: 0.35, bracedRecoil: 0.5 },
    withdraw: { backwardsSpeed: 0.5, disengagePenaltySec: 3, disengageDamageTaken: 1.5 },
    regroup: { cohesionRecovery: 2.5, moraleBonus: 5 },
    rout: { meleeDamageTaken: 3, maxRallies: 2, rallyQuietSec: 10, rallyingSec: 15 },
    surrender: { morale: 8, enemyWithinMeters: 30, minEnemyAspects: 2, corneredWithinMeters: 20 },
    pursuit: { base: 0.15, perWinnerMountedShare: 0.1, loserMountedShield: 0.5, capturedShare: 0.3 },
    fatigueTiers: [
      { from: 0, id: 'fresh', label: 'Fresh' },
      { from: 0.25, id: 'tired', label: 'Tired' },
      { from: 0.5, id: 'exhausted', label: 'Exhausted - cannot run' },
      { from: 0.8, id: 'spent', label: 'Spent - cannot charge, -10 morale' },
    ],
    weather: { rainAccuracy: 0.4, wetReload: 1.25, mudMounted: 0.5, mudInfantry: 0.25, rangeVsVisibility: 0.5, heatFatigue: 1.3, heatAboveC: 34, nightVision: 0.4, nightAccuracy: 0.7, nightMorale: -5 },
    commander: { ownFormation: 0.9, nearMeters: 180, near: 0.7, far: 0.5, fallen: 0.35, skillPer100: 1, fallBelowStrength: 0.35, rallyRadius: 120, rallyMorale: 15, rallyCooldownSec: 90 },
    experience: { attackPerExp: 0.25, defensePerExp: 0.15, moralePerExp: 15, winGain: 0.1, lossGain: 0.05 },
    elephantPanic: { chancePerVolleyHitShare: 4, durationSec: 8, friendlyDamageShare: 0.5 },
    prisoners: { ransomPerSoldier: 5, releaseOpinion: 5 },
  },
  // ------------------------------------------------------------------------------------------- §8.4
  ages: {
    /** Landmarks cannot be cancelled once 50% complete; destruction (capture) does not revert the age. */
    landmarkLockAt: 0.5,
    /** One landmark per faction per age; the second option disappears once one is started. */
    exclusive: true,
  },
  // ------------------------------------------------------------------------------------------- §9.4
  victory: {
    /** Sandbox victory thresholds (VictoryState / FactionState.victoryProgress = progress to these). */
    unification: { settlementShare: 0.75, capitalsHeld: 'all_rival_capitals' },
    prosperity: { population: 90000, treasury: 15000, stability: 0.75, reserveDays: 120, sustainDays: 180 },
    diplomatic_hegemony: { treatiesWithAllRivals: ['peace', 'trade'], tributariesOrMarriages: 2, opinionAtLeast: 40 },
    cultural_legacy: { culturePoints: 1500, landmarks: 2, samrajyaAge: true },
  } satisfies Record<Exclude<VictoryType, 'scenario'>, unknown>,
  /** End-of-game score (statistics screen). */
  score: { perSettlement: 100, perThousandPopulation: 10, perHundredWealth: 1, perBattleWon: 50, perEnemyKilled: 0.2, perTreaty: 40, perLandmark: 250, perAge: 300, perObjective: 150 },
} as const;
