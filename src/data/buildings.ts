/**
 * Settlement building definitions. OWNER: Creative Director (content/balance).
 * Placeholder values by the CTO. `architecture` tells render/architecture which procedural pieces
 * represent the building in settlement layouts.
 */
import type { BuildingDef, BuildingType, SettlementKind } from '../core/types';

const ALL: SettlementKind[] = ['village', 'town', 'city', 'capital', 'fort', 'port', 'temple_town'];
const URBAN: SettlementKind[] = ['town', 'city', 'capital', 'port', 'temple_town'];
const BIG: SettlementKind[] = ['city', 'capital'];

type Partial0 = Omit<BuildingDef, 'historicity' | 'requires' | 'unlocksUnits' | 'maxLevel' | 'allowedIn'> &
  Partial<Pick<BuildingDef, 'requires' | 'unlocksUnits' | 'maxLevel' | 'allowedIn' | 'historicity'>>;

const B = (d: Partial0): BuildingDef => ({
  historicity: 'reconstruction',
  requires: [],
  unlocksUnits: [],
  maxLevel: 3,
  allowedIn: ALL,
  ...d,
});

export const BUILDINGS: Readonly<Record<BuildingType, BuildingDef>> = {
  farm_fields: B({ id: 'farm_fields', name: 'Farm Fields', description: 'Cleared and bunded fields for rice, wheat, millet and pulses.', cost: { wealth: 80, labor: 200 }, buildDays: 20, upkeepWealth: 0, effects: { foodProduction: 0.15 }, maxLevel: 5, architecture: ['field_plot'] }),
  irrigation_canal: B({ id: 'irrigation_canal', name: 'Irrigation Canal', description: 'Channels river water to the fields; softens drought.', cost: { wealth: 300, labor: 600 }, buildDays: 45, upkeepWealth: 2, effects: { irrigation: 0.25, foodProduction: 0.1, disasterResistance: 0.1 }, architecture: ['field_plot'] }),
  granary: B({ id: 'granary', name: 'Granary', description: 'Raised storehouses protect the harvest from damp and rats.', cost: { wealth: 200, labor: 300 }, buildDays: 25, upkeepWealth: 1, effects: { foodCapacity: 4000 }, architecture: ['granary'] }),
  stepwell: B({ id: 'stepwell', name: 'Stepwell', description: 'Terraced steps down to the water table - water through the dry months.', cost: { wealth: 260, labor: 400, stone: 120 }, buildDays: 40, upkeepWealth: 1, effects: { waterAvailability: 0.25, disasterResistance: 0.1 }, architecture: ['stepwell'], historicity: 'reconstruction', sourceNote: 'Monumental stepwells are mostly later; simple step-tanks are earlier.' }),
  water_tank: B({ id: 'water_tank', name: 'Village Tank', description: 'An embanked reservoir catching monsoon rain.', cost: { wealth: 150, labor: 500 }, buildDays: 30, upkeepWealth: 0.5, effects: { waterAvailability: 0.2, irrigation: 0.1 }, architecture: ['well'] }),
  market: B({ id: 'market', name: 'Market', description: 'Stalls and caravan yards that draw traders and coin.', cost: { wealth: 250, labor: 250 }, buildDays: 25, upkeepWealth: 1, effects: { tradeIncome: 0.25, wealth: 0.1 }, allowedIn: URBAN, architecture: ['market_stall'] }),
  workshop: B({ id: 'workshop', name: 'Workshops', description: 'Smiths, potters and weavers - equipment and trade goods.', cost: { wealth: 220, labor: 250 }, buildDays: 25, upkeepWealth: 1, effects: { wealth: 0.15 }, allowedIn: URBAN, architecture: ['workshop'] }),
  barracks: B({ id: 'barracks', name: 'Barracks', description: 'Training grounds for levies and archers.', cost: { wealth: 300, labor: 300 }, buildDays: 30, upkeepWealth: 3, effects: { recruitmentPotential: 0.2 }, unlocksUnits: ['spearmen', 'archers', 'engineers'], architecture: ['barracks'] }),
  stables: B({ id: 'stables', name: 'Stables', description: 'Horses for cavalry, scouts and chariots.', cost: { wealth: 400, labor: 300 }, buildDays: 35, upkeepWealth: 4, effects: {}, unlocksUnits: ['cavalry', 'scouts', 'chariots'], requires: ['barracks'], architecture: ['stable'] }),
  elephant_stables: B({ id: 'elephant_stables', name: 'Elephant Stables', description: 'Mahouts, forage and enclosures for war elephants.', cost: { wealth: 900, labor: 500 }, buildDays: 60, upkeepWealth: 12, effects: {}, unlocksUnits: ['war_elephants'], requires: ['stables'], allowedIn: ['town', 'city', 'capital', 'fort'], maxLevel: 2, architecture: ['stable'] }),
  temple: B({ id: 'temple', name: 'Temple', description: 'A shrine and gathering place; steadies hearts in hard seasons.', cost: { wealth: 350, labor: 400, stone: 150 }, buildDays: 50, upkeepWealth: 2, effects: { publicOrder: 0.1, loyalty: 0.05, culture: 0.2 }, architecture: ['shikhara_temple', 'shrine'], sourceNote: 'Shikhara form is a later architectural style used for visual identity; flagged as stylization.' }),
  stupa: B({ id: 'stupa', name: 'Stupa', description: 'A domed reliquary mound and monastery - learning and pilgrimage.', cost: { wealth: 400, labor: 500, stone: 200 }, buildDays: 60, upkeepWealth: 2, effects: { publicOrder: 0.08, culture: 0.3, tradeIncome: 0.05 }, maxLevel: 2, architecture: ['stupa'], historicity: 'documented' }),
  fort_walls: B({ id: 'fort_walls', name: 'Fort Walls', description: 'Earth ramparts faced with brick or stone, gates and towers.', cost: { wealth: 600, labor: 900, stone: 300 }, buildDays: 70, upkeepWealth: 5, effects: { fortLevel: 1, publicOrder: 0.05 }, architecture: ['fort_wall', 'fort_gate', 'tower'] }),
  watchtower: B({ id: 'watchtower', name: 'Watchtower', description: 'Signals approaching armies and raiders.', cost: { wealth: 120, labor: 150 }, buildDays: 15, upkeepWealth: 1, effects: { publicOrder: 0.03 }, maxLevel: 1, architecture: ['tower'] }),
  road_station: B({ id: 'road_station', name: 'Road Station', description: 'Rest house, well and depot along the royal road.', cost: { wealth: 180, labor: 200 }, buildDays: 20, upkeepWealth: 1, effects: { tradeIncome: 0.08 }, maxLevel: 1, architecture: ['pavilion', 'well'] }),
  harbor: B({ id: 'harbor', name: 'River Harbor', description: 'Jetties and boatyards for river trade and supply.', cost: { wealth: 450, labor: 500 }, buildDays: 45, upkeepWealth: 3, effects: { tradeIncome: 0.3 }, allowedIn: ['port', 'city', 'capital', 'town'], architecture: ['harbor_jetty'] }),
  mine: B({ id: 'mine', name: 'Mine', description: 'Iron, copper or stone quarried from the hills.', cost: { wealth: 350, labor: 600 }, buildDays: 40, upkeepWealth: 2, effects: { wealth: 0.2 }, allowedIn: ['village', 'town', 'fort'], architecture: ['workshop'] }),
  palace: B({ id: 'palace', name: 'Palace', description: 'Seat of the court, its halls and pavilions.', cost: { wealth: 2000, labor: 2000, stone: 800, timber: 400 }, buildDays: 180, upkeepWealth: 15, effects: { publicOrder: 0.1, loyalty: 0.08, taxEfficiency: 0.1 }, allowedIn: BIG, maxLevel: 2, architecture: ['palace', 'chhatri', 'pavilion'] }),
  ghat: B({ id: 'ghat', name: 'Ghat', description: 'Stone steps down to the river for bathing, rites and boats.', cost: { wealth: 260, labor: 400, stone: 200 }, buildDays: 40, upkeepWealth: 1, effects: { publicOrder: 0.04, sanitation: 0.05, culture: 0.1 }, maxLevel: 2, architecture: ['ghat'] }),
  housing: B({ id: 'housing', name: 'Housing Quarter', description: 'New lanes of mud-brick and thatch homes.', cost: { wealth: 150, labor: 300 }, buildDays: 20, upkeepWealth: 0, effects: { housing: 1500 }, maxLevel: 6, architecture: ['mud_house', 'thatch_hut', 'brick_house'] }),
  sanitation: B({ id: 'sanitation', name: 'Drains & Wells', description: 'Covered drains and clean wells keep sickness at bay.', cost: { wealth: 200, labor: 300 }, buildDays: 25, upkeepWealth: 1, effects: { sanitation: 0.2 }, architecture: ['well'], historicity: 'documented', sourceNote: 'Urban drainage is well attested in the subcontinent from early periods.' }),
};

export function getBuilding(t: BuildingType): BuildingDef {
  return BUILDINGS[t];
}
