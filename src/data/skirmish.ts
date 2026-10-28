/**
 * Skirmish army composition presets (GDD §11). OWNER: Creative Director.
 * `weights` are relative shares of the soldier budget per unit class.
 */
import type { UnitClass } from '../core/types';

export interface SkirmishComposition {
  id: string;
  name: string;
  weights: Partial<Record<UnitClass, number>>;
}

export const SKIRMISH_COMPOSITIONS: readonly SkirmishComposition[] = [
  { id: 'balanced', name: 'Balanced Host', weights: { spearmen: 0.42, archers: 0.24, elite_guards: 0.07, cavalry: 0.12, chariots: 0.04, war_elephants: 0.03, engineers: 0.03, scouts: 0.03, supply_train: 0.02 } },
  { id: 'shock', name: 'Elephant Shock', weights: { spearmen: 0.4, archers: 0.2, war_elephants: 0.1, cavalry: 0.15, elite_guards: 0.1, scouts: 0.05 } },
  { id: 'mobile', name: 'Riders of the Frontier', weights: { cavalry: 0.35, scouts: 0.1, archers: 0.3, spearmen: 0.2, chariots: 0.05 } },
  { id: 'fortress', name: 'Hill Fort Garrison', weights: { spearmen: 0.45, archers: 0.35, elite_guards: 0.1, engineers: 0.1 } },
];

export const DEFAULT_COMPOSITION_ID = 'balanced';
