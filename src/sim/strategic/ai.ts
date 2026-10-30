/**
 * Campaign AI (strategic) - the entry point the world tick calls once a day per living AI realm. OWNER: AI Engineer -
 * Battle AI, Intents & Campaign AI (SIM-02); baseline by the CTO.
 *
 * GDD §9 / DESIGN_SPEC §7.14: hierarchical goals per realm (defend, conquer, develop, stabilize, ally, secure supply)
 * scored by personality weights x situation; war and peace by the §7.14 rule; economy (labour, taxes, grain, market,
 * treasury), construction (SIM-01 placement), recruitment, the age-up landmark, army operations with supply,
 * espionage, rebels and event choices. Modules live in `ai/`:
 *   core.ts      situation, plan memory helpers, the decision journal (`aiJournal()`)
 *   diplomacy.ts war rule (`warRule`), peace, treaties
 *   economy.ts   labour, taxes, grain, market, treasury
 *   build.ts     construction, landmark choice (`landmarkScore`, `preferredLandmark`)
 *   recruit.ts   recruitment ceiling and doctrine, demobilisation
 *   military.ts  army operations
 *   politics.ts  rebels, espionage, event choices (`chooseAiEventChoice`)
 *   goals.ts     goals and perceived threats
 *
 * Contract: returns StrategicCommands only (the world validates and applies them right after); the only state it
 * writes is the realm's own `FactionState.ai` plan memory. Deterministic (sorted iteration, no randomness except the
 * world RNG in event choices). Cheap: every realm runs the daily emergencies (relief, peace, defence, supply); the
 * heavy planners are staggered by the realm's slot - strategy (war, goals, offensives) every 5 days, economy (taxes,
 * labour, grain, rebels, the age landmark, recruitment, construction) every 5 days on another phase, diplomacy and
 * espionage every 15 days - and never on the month-rollover day (the economy's monthly ledger runs then; the run moves to the
 * next day).
 */
import type { FactionId, IssuedStrategicCommand, TerrainQuery, WorldState } from '../../core/types';
import { sortedKeys } from '../../core/ids';
import { totalDays } from './seasons';
import { remember, situate } from './ai/core';
import { considerPeace, considerTreaties, considerWar } from './ai/diplomacy';
import { planGrain, planGrainDaily, planLabor, planTaxes, planTreasury } from './ai/economy';
import { planAge, planConstruction } from './ai/build';
import { planDemobilize, planRecruitment, planStandDown } from './ai/recruit';
import { planMilitary } from './ai/military';
import { planEspionage, planEvents, planRebels } from './ai/politics';
import { planGoals } from './ai/goals';

export { aiJournal, resetAiJournal } from './ai/core';
export type { AiJournalEntry } from './ai/core';
export { warRule, WAR_FORBIDDING_TREATIES } from './ai/diplomacy';
export type { WarRuleResult } from './ai/diplomacy';
export { chooseAiEventChoice } from './ai/politics';
export { landmarkScore, preferredLandmark } from './ai/build';

/** Which planners run today for a realm in `slot` (exported for tests and the perf budget). */
export interface AiSchedule {
  strategy: boolean;
  economy: boolean;
  diplomacy: boolean;
}

/** The staggered schedule: phase by slot, never on day 0 of a month (moved to day 1). */
export function aiSchedule(day: number, dayOfMonth: number, slot: number): AiSchedule {
  const at = (period: number, phase: number): boolean => {
    const p = (((day + slot * 2 + phase) % period) + period) % period;
    if (dayOfMonth === 0) return false;
    if (p === 0) return true;
    // Catch up the run the month rollover skipped.
    return dayOfMonth === 1 && p === 1;
  };
  return { strategy: at(5, 0), economy: at(5, 3), diplomacy: at(15, 7) };
}

/**
 * QA / test hook: a passive realm's AI issues nothing (its armies, economy and diplomacy stand still) - for tests of
 * world rules that need a realm to hold still, and the debug API. Stored in the realm's plan memory (saved, hashed).
 */
export function setAiPassive(world: WorldState, factionId: FactionId, passive: boolean): void {
  const f = world.factions[factionId];
  if (!f) return;
  if (passive) f.ai.memory.passive = true;
  else delete f.ai.memory.passive;
}

function slotOf(world: WorldState, factionId: FactionId): number {
  const ids = sortedKeys(world.factions);
  return Math.max(0, ids.indexOf(factionId));
}

/** Commands an AI faction wants to issue today (called by tickWorld once per day per living AI realm). */
export function runCampaignAI(world: WorldState, factionId: FactionId, terrain: TerrainQuery): IssuedStrategicCommand[] {
  void terrain;
  const f = world.factions[factionId];
  if (!f || !f.alive || f.isPlayer || f.ai.memory.passive === true) return [];
  const day = totalDays(world.calendar);
  if (f.ai.memory.lastDay === day) return [];
  const sit = situate(world, factionId);
  remember(sit, 'lastDay', day);
  f.ai.lastPlanHour = world.calendar.totalHours;
  if (sit.owned.length === 0 && sit.armies.length === 0 && sit.standDown.length === 0) return [];
  const when = aiSchedule(day, world.calendar.day, slotOf(world, factionId));
  // Daily: answers, peace, grain emergencies, supply and defence.
  planEvents(sit);
  considerPeace(sit);
  planGrainDaily(sit);
  planStandDown(sit);
  if (when.strategy) {
    considerWar(sit);
    planGoals(sit);
  }
  planMilitary(sit, when.strategy);
  if (when.economy) {
    const crisis = planTreasury(sit);
    planTaxes(sit);
    planLabor(sit);
    planGrain(sit);
    planRebels(sit);
    planDemobilize(sit);
    planAge(sit);
    planRecruitment(sit, crisis);
    planConstruction(sit, crisis);
  }
  if (when.diplomacy) {
    considerTreaties(sit);
    planEspionage(sit);
  }
  return sit.commands;
}
