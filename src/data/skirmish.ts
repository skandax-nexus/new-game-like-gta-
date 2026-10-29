/**
 * Skirmish army composition presets (GDD §11; DESIGN_SPEC §10.1). OWNER: Creative Director.
 * `weights` are relative shares of the SOLDIER (model) budget per unit class. Beasts and vehicles are
 * worth many infantry each, so their shares are small: 0.016 of a 500-soldier side = 8 elephants =
 * one elephant formation. Weights are chosen so 500 / 1000 / 2500 per side produce mostly full formations.
 */
import type { UnitClass } from '../core/types';

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
