/**
 * End-of-game statistics screen (Age of Empires-style summary; DESIGN_SPEC §8.9). OWNER: Creative Director.
 * `source` documents where each number comes from - values marked (tracked) need the requested
 * `WorldState.statistics` counters (see DESIGN_SPEC §14 handoff); the rest derive from existing state.
 * Score formula: RULES.score.
 */

export type StatCategory = 'summary' | 'military' | 'economy' | 'society' | 'diplomacy';

export interface StatDef {
  id: string;
  category: StatCategory;
  label: string;
  description: string;
  source: string;
  format: 'int' | 'pct' | 'wealth' | 'grain' | 'days' | 'text';
  higherIsBetter: boolean;
}

export const STAT_CATEGORIES: readonly { id: StatCategory; label: string; icon: string }[] = [
  { id: 'summary', label: 'Summary', icon: 'crown' },
  { id: 'military', label: 'Military', icon: 'sword' },
  { id: 'economy', label: 'Economy', icon: 'coins' },
  { id: 'society', label: 'Society', icon: 'lotus' },
  { id: 'diplomacy', label: 'Diplomacy', icon: 'scroll' },
];

export const END_GAME_STATS: readonly StatDef[] = [
  // --- Summary ---
  { id: 'score', category: 'summary', label: 'Score', description: 'Weighted total (RULES.score).', source: 'computed', format: 'int', higherIsBetter: true },
  { id: 'outcome', category: 'summary', label: 'Outcome', description: 'Scenario outcome title or sandbox victory type.', source: 'world.victory.outcomeId', format: 'text', higherIsBetter: true },
  { id: 'days', category: 'summary', label: 'Days reigned', description: 'Game days played.', source: 'totalDays(world.calendar)', format: 'days', higherIsBetter: false },
  { id: 'age', category: 'summary', label: 'Age reached', description: 'Janapada, Mahajanapada or Samrajya.', source: 'faction.age (requested)', format: 'text', higherIsBetter: true },
  // --- Military ---
  { id: 'soldiers_raised', category: 'military', label: 'Soldiers raised', description: 'Soldiers recruited during the game.', source: 'tracked: recruitment_complete x menPerFormation', format: 'int', higherIsBetter: true },
  { id: 'enemies_killed', category: 'military', label: 'Enemies killed', description: 'Enemy soldiers killed in battle (field and autoresolve).', source: 'battleHistory sides[].killed (tracked beyond the history limit)', format: 'int', higherIsBetter: true },
  { id: 'soldiers_lost', category: 'military', label: 'Soldiers lost', description: 'Own soldiers killed, captured, starved or deserted.', source: 'tracked', format: 'int', higherIsBetter: false },
  { id: 'battles_won', category: 'military', label: 'Battles won', description: 'Battles won / fought.', source: 'battleHistory (tracked)', format: 'text', higherIsBetter: true },
  { id: 'largest_battle', category: 'military', label: 'Largest battle', description: 'Most soldiers on the field in one battle.', source: 'tracked', format: 'int', higherIsBetter: true },
  { id: 'settlements_captured', category: 'military', label: 'Settlements taken', description: 'Settlements captured by force.', source: 'tracked: settlement_captured events', format: 'int', higherIsBetter: true },
  { id: 'formations_routed', category: 'military', label: 'Enemy formations routed', description: 'Routs inflicted.', source: 'tracked: formation_routed battle events', format: 'int', higherIsBetter: true },
  // --- Economy ---
  { id: 'grain_harvested', category: 'economy', label: 'Grain harvested', description: 'Total grain produced.', source: 'sum of ledger.foodProduced (tracked)', format: 'grain', higherIsBetter: true },
  { id: 'wealth_earned', category: 'economy', label: 'Wealth earned', description: 'Taxes + trade + tribute received.', source: 'sum of ledger income (tracked)', format: 'wealth', higherIsBetter: true },
  { id: 'trade_income', category: 'economy', label: 'Trade income', description: 'Wealth from trade.', source: 'sum of ledger.tradeIncome (tracked)', format: 'wealth', higherIsBetter: true },
  { id: 'buildings_completed', category: 'economy', label: 'Buildings completed', description: 'Construction jobs finished (including upgrades).', source: 'tracked: construction_complete events', format: 'int', higherIsBetter: true },
  { id: 'landmarks', category: 'economy', label: 'Landmarks raised', description: 'Age landmarks completed.', source: 'tracked', format: 'int', higherIsBetter: true },
  { id: 'peak_treasury', category: 'economy', label: 'Peak treasury', description: 'Highest monthly treasury.', source: 'max(world.stats[].factions[p].treasury)', format: 'wealth', higherIsBetter: true },
  // --- Society ---
  { id: 'peak_population', category: 'society', label: 'Peak population', description: 'Largest population ruled.', source: 'max(world.stats[].factions[p].population)', format: 'int', higherIsBetter: true },
  { id: 'avg_stability', category: 'society', label: 'Average stability', description: 'Mean monthly stability.', source: 'mean(world.stats[].factions[p].stability)', format: 'pct', higherIsBetter: true },
  { id: 'famine_days', category: 'society', label: 'Famine days', description: 'Settlement-days with empty granaries and a deficit.', source: 'tracked: shortage events', format: 'days', higherIsBetter: false },
  { id: 'revolts', category: 'society', label: 'Revolts', description: 'Times a settlement reached revolt.', source: 'tracked: rebellion_stage events', format: 'int', higherIsBetter: false },
  { id: 'events_resolved', category: 'society', label: 'Decisions taken', description: 'Events resolved by the player.', source: 'world.events.history (tracked)', format: 'int', higherIsBetter: true },
  // --- Diplomacy ---
  { id: 'treaties_signed', category: 'diplomacy', label: 'Treaties signed', description: 'Treaties concluded.', source: 'tracked: treaty_signed events', format: 'int', higherIsBetter: true },
  { id: 'treaties_broken', category: 'diplomacy', label: 'Treaties broken', description: 'Treaties you broke.', source: 'tracked: treaty_broken events by player', format: 'int', higherIsBetter: false },
  { id: 'wars', category: 'diplomacy', label: 'Wars fought', description: 'Wars declared on or by you.', source: 'tracked: war_declared events', format: 'int', higherIsBetter: false },
  { id: 'marriages', category: 'diplomacy', label: 'Marriage alliances', description: 'Marriage alliances sealed.', source: 'tracked', format: 'int', higherIsBetter: true },
];

/** Timeline graphs on the statistics screen (one line per faction, colors from FactionDef.colors). */
export const TIMELINE_SERIES: readonly { id: 'population' | 'soldiers' | 'treasury' | 'food' | 'stability' | 'settlements'; label: string }[] = [
  { id: 'population', label: 'Population' },
  { id: 'soldiers', label: 'Soldiers' },
  { id: 'treasury', label: 'Treasury' },
  { id: 'food', label: 'Grain stored' },
  { id: 'stability', label: 'Stability' },
  { id: 'settlements', label: 'Settlements' },
];
