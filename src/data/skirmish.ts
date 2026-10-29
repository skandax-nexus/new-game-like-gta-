/**
 * Skirmish setup data (GDD §11 skirmish mode; DESIGN_SPEC §10.1). OWNER: Creative Director.
 * `SKIRMISH_COMPOSITIONS[].weights` are relative shares of the SOLDIER (model) budget per unit class.
 * Beasts and vehicles are worth many infantry each, so their shares are small: 0.016 of a 500-soldier side
 * = 8 elephants = one elephant formation. Weights are chosen so 300 / 500 / 1000 / 2500 per side produce
 * mostly full formations (sim/tactical/battle.ts composeArmy drops classes below half a formation).
 * Classes outside a faction's roster are skipped and the remaining weights renormalized.
 */
import type { Season, TerrainPreset, UnitClass, WeatherKind } from '../core/types';

export interface SkirmishComposition {
  id: string;
  name: string;
  description: string;
  weights: Partial<Record<UnitClass, number>>;
}

export const SKIRMISH_COMPOSITIONS: readonly SkirmishComposition[] = [
  { id: 'balanced', name: 'Balanced Host', description: 'Spear line, archers behind, horse on the wings, a few elephants in reserve.', weights: { spearmen: 0.48, archers: 0.2, elite_guards: 0.12, cavalry: 0.12, war_elephants: 0.016, scouts: 0.06, supply_train: 0.024 } },
  { id: 'shock', name: 'Elephant Shock', description: 'A heavy elephant line backed by guards - break them before they break you.', weights: { spearmen: 0.48, archers: 0.2, elite_guards: 0.12, war_elephants: 0.032, cavalry: 0.12, scouts: 0.06 } },
  { id: 'mobile', name: 'Riders of the Frontier', description: 'Horse, chariots and bows: strike the flanks, never stand still.', weights: { cavalry: 0.36, scouts: 0.12, archers: 0.2, spearmen: 0.24, chariots: 0.064 } },
  { id: 'fortress', name: 'Hill Fort Garrison', description: 'Deep spear blocks and massed bows that want to be attacked uphill.', weights: { spearmen: 0.48, archers: 0.4, elite_guards: 0.12, engineers: 0.08 } },
  { id: 'chariot_age', name: 'Old Chariot Host', description: 'Janapada-age warfare: chariots and archers on an open plain.', weights: { chariots: 0.096, archers: 0.4, spearmen: 0.48, scouts: 0.06 } },
];

export const DEFAULT_COMPOSITION_ID = 'balanced';

/** Army-size presets offered by the skirmish setup screen (total soldiers, both sides). */
export const SKIRMISH_SIZES: readonly { id: string; name: string; totalSoldiers: number; minQuality: 'low' | 'medium' | 'high' | 'ultra' }[] = [
  { id: 'clash', name: 'Clash', totalSoldiers: 600, minQuality: 'low' },
  { id: 'battle', name: 'Battle', totalSoldiers: 1000, minQuality: 'low' },
  { id: 'great_battle', name: 'Great Battle', totalSoldiers: 2000, minQuality: 'medium' },
  { id: 'epic', name: 'Field of Kings', totalSoldiers: 5000, minQuality: 'high' },
];

/** Battlefield presets (TerrainPreset windows of the region terrain) with player-facing names. */
export const SKIRMISH_MAPS: readonly { preset: TerrainPreset; name: string; description: string; recommended: string }[] = [
  { preset: 'plains', name: 'The Open Plain', description: 'Farmland and grass: room for chariots, horse and long battle lines.', recommended: 'Mobile hosts; first battles.' },
  { preset: 'river_crossing', name: 'The Ford', description: 'A river with one shallow ford between the armies. Whoever holds the crossing holds the battle.', recommended: 'Intent orders: Hold the crossing.' },
  { preset: 'hills', name: 'Hill Country', description: 'Ridges and valleys: high ground for archers, broken ground for horse.', recommended: 'Defensive hosts; the Giridurga Confederacy.' },
  { preset: 'forest_edge', name: 'The Forest Edge', description: 'Open fields against dense sal forest - ambush ground for light troops.', recommended: 'Scouts and archers; the Nilavana Kingdoms.' },
  { preset: 'plateau_fort', name: 'The Plateau Edge', description: 'The escarpment and its approaches. The defender sits on top.', recommended: 'Hill Fort Garrison vs Elephant Shock.' },
];

export const SKIRMISH_TIMES: readonly { hour: number; label: string }[] = [
  { hour: 6.2, label: 'Dawn (mist)' },
  { hour: 9.5, label: 'Morning' },
  { hour: 13, label: 'Noon' },
  { hour: 17.6, label: 'Golden hour' },
  { hour: 19.2, label: 'Dusk' },
  { hour: 22.5, label: 'Night (torches)' },
];

/** Weather offered per season (first = default). Mirrors the sim's seasonal weather table. */
export const SKIRMISH_WEATHER: Readonly<Record<Season, readonly WeatherKind[]>> = {
  vasanta: ['clear', 'hazy', 'cloudy'],
  grishma: ['clear', 'hazy', 'dust_storm'],
  varsha: ['monsoon_rain', 'overcast', 'light_rain', 'storm'],
  sharad: ['clear', 'cloudy', 'light_rain'],
  hemanta: ['clear', 'hazy', 'fog'],
  shishira: ['clear', 'fog', 'cloudy'],
};

/** Suggested composition per faction for the AI side and the "Random" button. */
export const FACTION_DEFAULT_COMPOSITION: Readonly<Record<string, string>> = {
  heartland: 'balanced',
  highland: 'fortress',
  forest: 'shock',
  frontier: 'mobile',
  maritime: 'balanced',
  citystates: 'fortress',
};
