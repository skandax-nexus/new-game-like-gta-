/**
 * Faction definitions (GDD §4; DESIGN_SPEC §4). OWNER: Creative Director. Colors agreed with the Art
 * Director (team colors must stay distinct for deutan/protan players: saffron vs indigo vs jade vs violet).
 *
 * All factions are FICTIONAL composites inspired by the political diversity of the ancient subcontinent.
 * None represents a specific historical state, people or dynasty, and none is written as "the villain"
 * (GDD §7): every faction has a legitimate grievance, a strength and a cost.
 *
 * MVP: two playable factions with distinct strategic strengths (heartland, highland); two AI minor powers
 * in the campaign region (forest, frontier); maritime + citystates exist for skirmish/sandbox variety.
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
    name: 'Suvarna Kingdom',
    shortName: 'Suvarna',
    adjective: 'Suvarnan',
    description:
      'A river-plain kingdom of granaries, royal roads and mass levies, ruled from Rajapura near the meeting of two rivers. Its strength is administration and numbers; its burden is the cost of feeding, paying and governing them - and a crown that has just lost its wearer. Its kings have long dreamed of empire.',
    strengths: ['Largest recruitment pool and fastest levies', 'Efficient taxation, royal roads and granaries', 'The only realm fielding elephants, chariots and horse together'],
    weaknesses: ['Governing costs rise with every province', 'Hunger turns into unrest quickly in its crowded plains', 'Elephants must be bought from the forest kingdoms'],
    colors: { primary: '#e0801f', secondary: '#f2cf63', accent: '#7a1f1f' },
    banner: 'sun',
    heraldry: { name: 'The Risen Sun of Suvarna', blazon: 'Saffron field, a golden twelve-rayed sun above a maroon river-wave base.' },
    // Team-color readability (DESIGN_SPEC §5.6): saffron/gold vs indigo/sky are the two playable pairs.
    motto: 'The granary is the root of the kingdom.',
    playstyle: ['Out-produce and out-recruit: many cheap levies, strong supply lines.', 'Watch stability: every new province raises governing costs.', 'Win by conquest, by grain, or by marriage - the court is your second battlefield.'],
    playable: true,
    startingAge: 'mahajanapada',
    modifiers: mods({ recruitmentPool: 1.35, governanceCost: 1.3, taxEfficiency: 1.15, tradeIncome: 1.05, siegeStrength: 1.1, constructionSpeed: 1.1, forestMovement: 0.9, hillMovement: 0.9, supplyEfficiency: 1.15, prolongedEngagement: 0.95, diplomacyOpinion: 0.9, espionage: 1.1 }),
    roster: ['spearmen', 'archers', 'elite_guards', 'cavalry', 'chariots', 'war_elephants', 'engineers', 'scouts', 'supply_train'],
    unitVariants: {
      spearmen: { name: 'Royal Levy', description: 'Raised fast and cheap from the crowded plains; steadier when fed than when proud.', multipliers: { recruitDays: 0.8, upkeepWealth: 0.85, baseMorale: 0.95 } },
      war_elephants: { name: 'Royal Elephant Corps', description: 'Palace-trained bulls with veteran mahouts: tougher and less prone to panic.', multipliers: { hp: 1.1, discipline: 1.25, unruliness: 0.7 } },
    },
    aiPersonality: 'expansionist',
    architectureStyle: 'heartland_brick',
    historicity: 'fictional',
    sourceNote: 'Composite of river-plain polities; administrative flavor drawn loosely from early statecraft texts.',
  },
  highland: {
    id: 'highland',
    archetype: 'highland_confederacy',
    name: 'Giridurga Confederacy',
    shortName: 'Giridurga',
    adjective: 'Giridurgan',
    description:
      'Seven hill clans bound by oath at the Oath Stone of Giridurg, holding the plateau edge with rock-cut forts and cisterns. They elect their war-leader, defend every pass and keep their word - and they want the river crossings their grandfathers lost to Rajapura.',
    strengths: ['Fortresses that hold for months', 'Fast and tireless in the hills', 'Clan oaths and local alliances: better diplomacy'],
    weaknesses: ['Small recruitment base', 'No elephants or chariots', 'Little farmland: grain must come from the plains or from trade'],
    colors: { primary: '#2c4fa3', secondary: '#a9c1ea', accent: '#e9b949' },
    banner: 'mountain',
    heraldry: { name: 'The Seven Peaks', blazon: 'Indigo field, seven white peaks, a gold lamp above the highest.' },
    motto: 'One oath, seven hills.',
    playstyle: ['Defend and bleed the enemy: forts, archers on high ground, raids on supply.', 'Few soldiers, each one precious - fight where the terrain fights for you.', 'Win friends: treaties and marriages come easier to the Confederacy.'],
    playable: true,
    startingAge: 'mahajanapada',
    modifiers: mods({ recruitmentPool: 0.75, governanceCost: 0.8, taxEfficiency: 0.9, tradeIncome: 0.95, fortDefense: 1.4, siegeStrength: 0.9, constructionSpeed: 1.15, hillMovement: 1.35, scoutRange: 1.15, prolongedEngagement: 0.85, diplomacyOpinion: 1.2 }),
    roster: ['spearmen', 'archers', 'elite_guards', 'cavalry', 'engineers', 'scouts', 'supply_train'],
    unitVariants: {
      archers: { name: 'Hill Bowmen', description: 'Raised on the plateau edge, they shoot farther and straighter - and they hunt elephants.', multipliers: { range: 1.15, accuracy: 1.15, baseMorale: 1.1 } },
      spearmen: { name: 'Fort Wardens', description: 'Clan spearmen sworn to a fort; they do not give ground easily.', multipliers: { meleeDefense: 1.1, discipline: 1.1, recruitDays: 1.2 } },
      cavalry: { name: 'Plateau Riders', description: 'Small hardy horses bred in the hills: tireless, nimble, lighter in the charge.', multipliers: { fatigueRate: 0.8, turnRate: 1.15, chargeBonus: 0.9 } },
    },
    aiPersonality: 'defensive',
    architectureStyle: 'highland_stone',
    historicity: 'fictional',
    sourceNote: 'Composite of hill and plateau polities; the clan-council structure is a game simplification.',
  },
  forest: {
    id: 'forest',
    archetype: 'forest_kingdoms',
    name: 'Nilavana Kingdoms',
    shortName: 'Nilavana',
    adjective: 'Nilavanan',
    description:
      'Kingdoms of the blue-green eastern forests, rich in timber, spices and elephant herds, governed through councils of village elders and a crowned queen at Nilavanapura. Every army that wants elephants must deal with them.',
    strengths: ['Elephant herds and timber', 'Scouting and forest mobility', 'Valued trade partner'],
    weaknesses: ['Poor at long sieges', 'No cavalry or chariots'],
    colors: { primary: '#2f8f5b', secondary: '#b5db9a', accent: '#d9a441' },
    banner: 'elephant',
    heraldry: { name: 'The Elephant under the Canopy', blazon: 'Jade field, a gold elephant beneath a green arched bough.' },
    motto: 'The forest gives to those who ask.',
    playstyle: ['Ambush in the woods, never besiege.', 'Sell elephants and timber; buy friends.'],
    playable: false,
    startingAge: 'mahajanapada',
    modifiers: mods({ recruitmentPool: 0.85, governanceCost: 0.9, taxEfficiency: 0.9, fortDefense: 0.9, siegeStrength: 0.7, marchSpeed: 1.1, forestMovement: 1.5, hillMovement: 1.1, scoutRange: 1.4, supplyEfficiency: 0.95, prolongedEngagement: 1.2, diplomacyOpinion: 1.1, espionage: 1.15 }),
    roster: ['spearmen', 'archers', 'elite_guards', 'war_elephants', 'scouts', 'engineers', 'supply_train'],
    unitVariants: {
      scouts: { name: 'Forest Runners', description: 'Barefoot runners who move unseen through the trees.', multipliers: { stealth: 1.35, visionRange: 1.2 } },
      war_elephants: { name: 'Herd Elephants', description: 'Plentiful and quick to raise, but less drilled.', multipliers: { recruitDays: 0.7, upkeepWealth: 0.75, unruliness: 1.3 } },
    },
    aiPersonality: 'opportunist',
    architectureStyle: 'forest_timber',
    historicity: 'fictional',
    sourceNote: 'Avoids portraying forest communities as primitive: a settled, trading, council-governed kingdom.',
  },
  frontier: {
    id: 'frontier',
    archetype: 'frontier_principalities',
    name: 'Marudesha Principalities',
    shortName: 'Marudesha',
    adjective: 'Marudeshi',
    description:
      'Caravan princes of the arid west who hold the salt road and the wells along it. Fast riders, keen eyes and thin reserves: they raid when the plains are weak and trade when they are strong.',
    strengths: ['Reconnaissance and rapid campaigns', 'Horses, salt and caravan trade'],
    weaknesses: ['Vulnerable in prolonged engagements', 'Thin food reserves'],
    colors: { primary: '#7d3c98', secondary: '#d7b8e8', accent: '#2b2b2b' },
    banner: 'chevron',
    heraldry: { name: 'The Dune Chevron', blazon: 'Violet field, a black chevron of dunes, a white well-wheel in chief.' },
    motto: 'Water is the only border.',
    playstyle: ['Raid supply and retreat before the enemy forms.', 'Trade salt and horses when raiding is too costly.'],
    playable: false,
    startingAge: 'janapada',
    modifiers: mods({ recruitmentPool: 0.8, governanceCost: 0.85, taxEfficiency: 0.85, tradeIncome: 1.25, fortDefense: 0.9, siegeStrength: 0.8, constructionSpeed: 0.9, marchSpeed: 1.25, forestMovement: 0.85, scoutRange: 1.3, supplyEfficiency: 1.05, prolongedEngagement: 1.35, diplomacyOpinion: 0.95, espionage: 1.1 }),
    roster: ['spearmen', 'archers', 'cavalry', 'chariots', 'scouts', 'engineers', 'supply_train'],
    unitVariants: {
      cavalry: { name: 'Salt Road Riders', description: 'Desert horsemen: faster, harder-hitting, thirstier in a long fight.', multipliers: { runSpeed: 1.1, chargeBonus: 1.15, fatigueRate: 1.15 } },
    },
    aiPersonality: 'raider',
    architectureStyle: 'frontier_mud',
    historicity: 'fictional',
  },
  maritime: {
    id: 'maritime',
    archetype: 'maritime_league',
    name: 'Samudra League',
    shortName: 'Samudra',
    adjective: 'Samudran',
    description: 'Merchant ports and river harbors bound by guild charters; their wealth rides on secure water routes and their armies are hired as often as raised.',
    strengths: ['Trade income', 'Coastal and river supply'],
    weaknesses: ['Depends on open trade routes', 'Small levies'],
    colors: { primary: '#1c8c99', secondary: '#9fd8cf', accent: '#f0e2b6' },
    banner: 'wave',
    heraldry: { name: 'The Twin Waves', blazon: 'Teal field, two white waves, a gold lamp-tower between.' },
    motto: 'Every river leads to the sea.',
    playstyle: ['Buy what others must build.', 'Keep the river open and the treasury full.'],
    playable: false,
    startingAge: 'janapada',
    modifiers: mods({ recruitmentPool: 0.85, tradeIncome: 1.5, hillMovement: 0.85, forestMovement: 0.9, siegeStrength: 0.9, constructionSpeed: 1.05, supplyEfficiency: 1.25, diplomacyOpinion: 1.15, espionage: 1.2 }),
    roster: ['spearmen', 'archers', 'elite_guards', 'cavalry', 'engineers', 'scouts', 'supply_train'],
    unitVariants: {
      archers: { name: 'Deck Archers', description: 'Marines used to shooting from moving decks: steady but lightly armed.', multipliers: { accuracy: 1.1, reloadSec: 0.9, meleeDefense: 0.9 } },
    },
    aiPersonality: 'mercantile',
    architectureStyle: 'coastal_timber',
    historicity: 'fictional',
  },
  citystates: {
    id: 'citystates',
    archetype: 'fortified_city_states',
    name: 'Kotanagara City-States',
    shortName: 'Kotanagara',
    adjective: 'Kotanagari',
    description: 'Walled cities of guilds and engineers with deep treasuries and little farmland; they would rather out-build an enemy than out-fight him.',
    strengths: ['Engineering and siegecraft', 'Concentrated wealth', 'Strong walls'],
    weaknesses: ['Limited hinterland and food', 'Smallest recruitment base'],
    colors: { primary: '#b03a2e', secondary: '#e6a79e', accent: '#e9b949' },
    banner: 'tower',
    heraldry: { name: 'The Gate Tower', blazon: 'Crimson field, a white gate-tower, a gold coin on the gate.' },
    motto: 'Walls outlast kings.',
    playstyle: ['Turtle, build, buy - then batter the gates of whoever is left.'],
    playable: false,
    startingAge: 'mahajanapada',
    modifiers: mods({ recruitmentPool: 0.7, governanceCost: 0.9, taxEfficiency: 1.2, tradeIncome: 1.2, fortDefense: 1.3, siegeStrength: 1.35, constructionSpeed: 1.35, marchSpeed: 0.95, forestMovement: 0.9, hillMovement: 0.9, prolongedEngagement: 0.9, diplomacyOpinion: 1.05 }),
    roster: ['spearmen', 'archers', 'elite_guards', 'cavalry', 'engineers', 'scouts', 'supply_train'],
    unitVariants: {
      engineers: { name: 'Guild Engineers', description: 'Master builders who batter a gate in half the time.', multipliers: { siege: 1.4, recruitDays: 0.8 } },
    },
    aiPersonality: 'diplomatic',
    architectureStyle: 'city_sandstone',
    historicity: 'fictional',
  },
};

/** MVP: exactly two playable factions. */
export const PLAYABLE_FACTION_IDS: readonly FactionId[] = Object.values(FACTIONS)
  .filter((f) => f.playable)
  .map((f) => f.id);

/** AI minor powers present in the campaign region (DESIGN_SPEC §4.3). */
export const MINOR_FACTION_IDS: readonly FactionId[] = ['forest', 'frontier'];

export function getFaction(id: FactionId): FactionDef {
  const f = FACTIONS[id];
  if (!f) throw new Error(`Unknown faction ${id}`);
  return f;
}
