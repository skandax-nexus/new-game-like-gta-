/**
 * Faction definitions (GDD §4). OWNER: Creative Director. Placeholder content by the CTO - names,
 * descriptions, colors (with Art Director) and modifiers are to be authored/tuned.
 * All factions are fictional composites inspired by the political diversity of the ancient
 * subcontinent - never presented as specific historical states.
 */
import type { FactionDef, FactionId, FactionModifiers } from '../core/types';

const NEUTRAL: FactionModifiers = {
  recruitmentPool: 1,
  governanceCost: 1,
  taxEfficiency: 1,
  tradeIncome: 1,
  fortDefense: 1,
  siegeStrength: 1,
  constructionSpeed: 1,
  marchSpeed: 1,
  forestMovement: 1,
  hillMovement: 1,
  scoutRange: 1,
  supplyEfficiency: 1,
  prolongedEngagement: 1,
  diplomacyOpinion: 1,
  espionage: 1,
};

const mods = (m: Partial<FactionModifiers>): FactionModifiers => ({ ...NEUTRAL, ...m });

export const FACTIONS: Readonly<Record<FactionId, FactionDef>> = {
  heartland: {
    id: 'heartland',
    archetype: 'imperial_heartland',
    name: 'Suvarna Empire',
    shortName: 'Suvarna',
    adjective: 'Suvarnan',
    description: 'A river-plain empire of granaries, royal roads and mass levies. Its strength is administration and numbers; its burden is the cost of governing them.',
    strengths: ['Large recruitment pool', 'Efficient taxation and royal roads', 'War elephants'],
    weaknesses: ['Costly to govern', 'Discontent spreads when granaries empty'],
    colors: { primary: '#d9792b', secondary: '#f2d16b', accent: '#7a1f1f' },
    banner: 'sun',
    playable: true,
    modifiers: mods({ recruitmentPool: 1.35, governanceCost: 1.3, taxEfficiency: 1.15, supplyEfficiency: 1.1 }),
    roster: ['spearmen', 'archers', 'elite_guards', 'cavalry', 'chariots', 'war_elephants', 'engineers', 'scouts', 'supply_train'],
    aiPersonality: 'expansionist',
    architectureStyle: 'heartland_brick',
    historicity: 'fictional',
  },
  highland: {
    id: 'highland',
    archetype: 'highland_confederacy',
    name: 'Giridurga Confederacy',
    shortName: 'Giridurga',
    adjective: 'Giridurgan',
    description: 'A league of hill forts and plateau clans bound by oaths. Hard to conquer, slow to gather.',
    strengths: ['Strong forts and defensive terrain', 'Local alliances', 'Hill movement'],
    weaknesses: ['Smaller recruitment base', 'Fewer large beasts'],
    colors: { primary: '#2f4b8a', secondary: '#9fb4d9', accent: '#e9b949' },
    banner: 'mountain',
    playable: true,
    modifiers: mods({ recruitmentPool: 0.75, fortDefense: 1.4, hillMovement: 1.3, diplomacyOpinion: 1.15, governanceCost: 0.85 }),
    roster: ['spearmen', 'archers', 'elite_guards', 'cavalry', 'engineers', 'scouts', 'supply_train', 'war_elephants'],
    aiPersonality: 'defensive',
    architectureStyle: 'highland_stone',
    historicity: 'fictional',
  },
  maritime: {
    id: 'maritime',
    archetype: 'maritime_league',
    name: 'Samudra League',
    shortName: 'Samudra',
    adjective: 'Samudran',
    description: 'Merchant ports and river harbors whose wealth rides on secure water routes.',
    strengths: ['Trade income', 'Coastal and river supply'],
    weaknesses: ['Depends on open trade routes'],
    colors: { primary: '#1f7a7a', secondary: '#9fd8cf', accent: '#f0e2b6' },
    banner: 'wave',
    playable: false,
    modifiers: mods({ tradeIncome: 1.5, supplyEfficiency: 1.2, recruitmentPool: 0.85 }),
    roster: ['spearmen', 'archers', 'elite_guards', 'cavalry', 'engineers', 'scouts', 'supply_train'],
    aiPersonality: 'mercantile',
    architectureStyle: 'coastal_timber',
    historicity: 'fictional',
  },
  forest: {
    id: 'forest',
    archetype: 'forest_kingdoms',
    name: 'Vanya Kingdoms',
    shortName: 'Vanya',
    adjective: 'Vanyan',
    description: 'Forest polities that know every path through the eastern woods. Swift and elusive, ill-suited to long sieges.',
    strengths: ['Scouting', 'Forest mobility', 'Elephant herds'],
    weaknesses: ['Weak at prolonged sieges'],
    colors: { primary: '#3d6b2f', secondary: '#b7d18a', accent: '#d9a441' },
    banner: 'tree',
    playable: false,
    modifiers: mods({ forestMovement: 1.5, scoutRange: 1.4, siegeStrength: 0.7, marchSpeed: 1.1 }),
    roster: ['spearmen', 'archers', 'elite_guards', 'war_elephants', 'scouts', 'supply_train', 'engineers'],
    aiPersonality: 'opportunist',
    architectureStyle: 'forest_timber',
    historicity: 'fictional',
  },
  frontier: {
    id: 'frontier',
    archetype: 'frontier_principalities',
    name: 'Marudesha Principalities',
    shortName: 'Marudesha',
    adjective: 'Marudeshi',
    description: 'Caravan princes of the arid west - fast riders and keen eyes, but thin reserves.',
    strengths: ['Reconnaissance', 'Rapid campaigning', 'Cavalry'],
    weaknesses: ['Vulnerable in prolonged engagements'],
    colors: { primary: '#a8452b', secondary: '#e8b98a', accent: '#2b2b2b' },
    banner: 'chevron',
    playable: false,
    modifiers: mods({ marchSpeed: 1.25, scoutRange: 1.3, prolongedEngagement: 1.35, recruitmentPool: 0.8 }),
    roster: ['spearmen', 'archers', 'cavalry', 'chariots', 'scouts', 'supply_train', 'engineers'],
    aiPersonality: 'raider',
    architectureStyle: 'frontier_mud',
    historicity: 'fictional',
  },
  citystates: {
    id: 'citystates',
    archetype: 'fortified_city_states',
    name: 'Kotanagara City-States',
    shortName: 'Kotanagara',
    adjective: 'Kotanagari',
    description: 'Walled cities of guilds and engineers with deep treasuries and little farmland.',
    strengths: ['Engineering', 'Concentrated wealth', 'Strong walls'],
    weaknesses: ['Limited hinterland and food'],
    colors: { primary: '#6b3d7a', secondary: '#c9a6d6', accent: '#e9b949' },
    banner: 'tower',
    playable: false,
    modifiers: mods({ constructionSpeed: 1.35, fortDefense: 1.25, siegeStrength: 1.3, tradeIncome: 1.2, recruitmentPool: 0.7 }),
    roster: ['spearmen', 'archers', 'elite_guards', 'engineers', 'scouts', 'supply_train', 'cavalry'],
    aiPersonality: 'diplomatic',
    architectureStyle: 'city_sandstone',
    historicity: 'fictional',
  },
};

/** MVP: exactly two playable factions. */
export const PLAYABLE_FACTION_IDS: readonly FactionId[] = Object.values(FACTIONS)
  .filter((f) => f.playable)
  .map((f) => f.id);

export function getFaction(id: FactionId): FactionDef {
  const f = FACTIONS[id];
  if (!f) throw new Error(`Unknown faction ${id}`);
  return f;
}
