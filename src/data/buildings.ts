/**
 * Settlement building definitions (DESIGN_SPEC §6.5 construction, §7 AoE layer). OWNER: Creative Director.
 *
 * Units: cost.wealth = wealth; cost.timber / cost.stone = material units; cost.labor = PERSON-DAYS of
 * work. Nominal crew = labor / buildDays; construction runs at min(1.25, builders / crew) speed
 * (RULES.construction). Costs are for level 1; level n costs x levelCostMultiplier^(n-1) and takes
 * buildDays x levelTimeMultiplier^(n-1). `effects` are additive per level (DESIGN_SPEC §7.1 table):
 *   foodCapacity  = DAYS of grain storage (x the settlement's daily consumption), see RULES.storage
 *   housing       = people housed (absolute)
 *   fortLevel     = fort levels (absolute)
 *   waterAvailability / irrigation / sanitation / publicOrder / loyalty / disasterResistance = absolute
 *                   points on their 0..1 scales
 *   foodProduction / wealth / taxEfficiency / recruitmentPotential = fractional bonus (+0.15 = +15%)
 *   tradeIncome   = x RULES.trade.effectScale wealth per month (0.25 = +40/month)
 *   culture       = cultural-legacy points per month x 10 (0.2 = 2 points/month)
 * `commandSlot` = grid slot inside the category tab (Q W E R T / A S D F G / Z X C V B).
 * `footprint` = AoE-style placement on the 4 m grid. `workers` = visible villagers per level (presentation).
 */
import type { BuildingDef, BuildingType, SettlementKind } from '../core/types';

const ALL: SettlementKind[] = ['village', 'town', 'city', 'capital', 'fort', 'port', 'temple_town'];
const URBAN: SettlementKind[] = ['town', 'city', 'capital', 'port', 'temple_town'];
const BIG: SettlementKind[] = ['city', 'capital'];

type BuildingInput = Omit<BuildingDef, 'historicity' | 'requires' | 'unlocksUnits' | 'maxLevel' | 'allowedIn' | 'cost'> &
  Partial<Pick<BuildingDef, 'requires' | 'unlocksUnits' | 'maxLevel' | 'allowedIn' | 'historicity'>> & {
    cost: { wealth: number; labor: number; stone?: number; timber?: number };
  };

const B = (d: BuildingInput): BuildingDef => ({
  historicity: 'reconstruction',
  requires: [],
  unlocksUnits: [],
  maxLevel: 3,
  allowedIn: ALL,
  age: 'janapada',
  ...d,
  cost: { stone: 0, timber: 0, ...d.cost },
});

export const BUILDINGS: Readonly<Record<BuildingType, BuildingDef>> = {
  // ------------------------------------------------------------------ Economy tab (Q)
  farm_fields: B({ id: 'farm_fields', name: 'Farm Fields', description: 'Cleared and bunded fields for rice, millet, wheat and pulses. +15% food per level.', cost: { wealth: 80, timber: 20, labor: 1200 }, buildDays: 20, upkeepWealth: 0, effects: { foodProduction: 0.15 }, maxLevel: 5, architecture: ['field_plot'], category: 'economy', commandSlot: 0, footprint: { w: 24, d: 24, placement: 'outer' }, workers: 4 }),
  irrigation_canal: B({ id: 'irrigation_canal', name: 'Irrigation Canal', description: 'Channels river water to the fields; softens drought and lifts both harvests.', cost: { wealth: 300, timber: 40, stone: 60, labor: 6000 }, buildDays: 45, upkeepWealth: 2, effects: { irrigation: 0.25, foodProduction: 0.1, disasterResistance: 0.1 }, requires: ['farm_fields'], architecture: ['field_plot'], age: 'mahajanapada', category: 'economy', commandSlot: 1, footprint: { w: 8, d: 32, placement: 'outer' }, workers: 3 }),
  granary: B({ id: 'granary', name: 'Granary', description: 'Raised storehouses that keep the harvest from damp and rats: +45 days of grain storage per level and 40% less spoilage.', cost: { wealth: 200, timber: 120, stone: 40, labor: 2500 }, buildDays: 25, upkeepWealth: 1, effects: { foodCapacity: 45 }, architecture: ['granary'], category: 'economy', commandSlot: 2, footprint: { w: 12, d: 16, placement: 'inner' }, workers: 3 }),
  water_tank: B({ id: 'water_tank', name: 'Village Tank', description: 'An earthen embankment catching the monsoon rain for the dry months.', cost: { wealth: 150, stone: 20, labor: 4500 }, buildDays: 30, upkeepWealth: 0.5, effects: { waterAvailability: 0.2, irrigation: 0.1 }, architecture: ['well'], category: 'economy', commandSlot: 3, footprint: { w: 20, d: 20, placement: 'outer' }, workers: 2 }),
  stepwell: B({ id: 'stepwell', name: 'Stepwell', description: 'Terraced steps down to the water table - water through the hottest months.', cost: { wealth: 260, timber: 20, stone: 160, labor: 5000 }, buildDays: 40, upkeepWealth: 1, effects: { waterAvailability: 0.25, disasterResistance: 0.1, publicOrder: 0.02 }, maxLevel: 2, architecture: ['stepwell'], age: 'mahajanapada', category: 'economy', commandSlot: 4, footprint: { w: 12, d: 20, placement: 'inner' }, workers: 1, sourceNote: 'Monumental stepwells are mostly later; simple step-tanks are earlier. Stylized.' }),
  market: B({ id: 'market', name: 'Market', description: 'Stalls and caravan yards that draw traders and coin; lets the realm buy and sell grain, timber and stone.', cost: { wealth: 250, timber: 80, labor: 2000 }, buildDays: 25, upkeepWealth: 1, effects: { tradeIncome: 0.25, wealth: 0.1 }, allowedIn: URBAN, architecture: ['market_stall'], category: 'economy', commandSlot: 5, footprint: { w: 16, d: 20, placement: 'inner' }, workers: 4 }),
  workshop: B({ id: 'workshop', name: 'Workshops', description: 'Carpenters, smiths, potters and weavers. Produces timber (full rate only near forests) and wealth.', cost: { wealth: 220, timber: 100, labor: 2000 }, buildDays: 25, upkeepWealth: 1, effects: { wealth: 0.15 }, allowedIn: URBAN.concat(['fort']), architecture: ['workshop'], category: 'economy', commandSlot: 6, footprint: { w: 12, d: 12, placement: 'inner' }, produces: { timber: 8, wealth: 2 }, workers: 3 }),
  mine: B({ id: 'mine', name: 'Quarry & Mine', description: 'Stone, iron or copper cut from the hills. Requires a stone, iron or copper deposit.', cost: { wealth: 350, timber: 80, labor: 6000 }, buildDays: 40, upkeepWealth: 2, effects: { wealth: 0.1 }, allowedIn: ['village', 'town', 'fort', 'city'], architecture: ['workshop'], category: 'economy', commandSlot: 7, footprint: { w: 12, d: 12, placement: 'resource' }, produces: { stone: 6, wealth: 3 }, workers: 5 }),
  harbor: B({ id: 'harbor', name: 'River Harbor', description: 'Jetties and boatyards for river trade and river-borne supply.', cost: { wealth: 450, timber: 250, stone: 60, labor: 5000 }, buildDays: 45, upkeepWealth: 3, effects: { tradeIncome: 0.3 }, allowedIn: ['port', 'city', 'capital', 'town'], architecture: ['harbor_jetty'], age: 'mahajanapada', category: 'economy', commandSlot: 8, footprint: { w: 12, d: 24, placement: 'shore' }, workers: 4 }),
  road_station: B({ id: 'road_station', name: 'Road Station', description: 'Rest house, well and depot on a road: armies resupply here and caravans pay toll.', cost: { wealth: 180, timber: 60, stone: 20, labor: 1500 }, buildDays: 20, upkeepWealth: 1, effects: { tradeIncome: 0.08 }, maxLevel: 1, architecture: ['pavilion', 'well'], age: 'mahajanapada', category: 'economy', commandSlot: 9, footprint: { w: 8, d: 12, placement: 'road' }, workers: 2 }),

  // ------------------------------------------------------------------ Military tab (W)
  barracks: B({ id: 'barracks', name: 'Barracks', description: 'Drill grounds for levies, archers, engineers and - from the Mahajanapada Age - royal guards. Each level above 1 gives recruits +0.1 experience.', cost: { wealth: 300, timber: 150, labor: 3000 }, buildDays: 30, upkeepWealth: 3, effects: { recruitmentPotential: 0.2 }, unlocksUnits: ['spearmen', 'archers', 'engineers', 'supply_train', 'elite_guards'], allowedIn: ['village', 'town', 'city', 'capital', 'fort', 'port'], architecture: ['barracks'], category: 'military', commandSlot: 0, footprint: { w: 16, d: 24, placement: 'inner' }, workers: 6 }),
  stables: B({ id: 'stables', name: 'Stables', description: 'Horses for scouts and chariots - and, from the Mahajanapada Age, for horsemen.', cost: { wealth: 400, timber: 200, labor: 3500 }, buildDays: 35, upkeepWealth: 4, effects: { recruitmentPotential: 0.05 }, unlocksUnits: ['cavalry', 'scouts', 'chariots'], requires: ['barracks'], allowedIn: ['village', 'town', 'city', 'capital', 'fort'], architecture: ['stable'], category: 'military', commandSlot: 1, footprint: { w: 16, d: 20, placement: 'inner' }, workers: 4 }),
  elephant_stables: B({ id: 'elephant_stables', name: 'Elephant Stables', description: 'Mahouts, fodder and enclosures. Elephants need a source: an elephant forest you own, or a trade treaty with a realm that has one.', cost: { wealth: 900, timber: 300, stone: 100, labor: 8000 }, buildDays: 60, upkeepWealth: 12, effects: {}, unlocksUnits: ['war_elephants'], requires: ['stables'], allowedIn: ['town', 'city', 'capital', 'fort'], maxLevel: 2, architecture: ['stable'], age: 'mahajanapada', category: 'military', commandSlot: 2, footprint: { w: 24, d: 28, placement: 'inner' }, workers: 3, historicity: 'documented', sourceNote: 'Royal control of elephant forests and stables is described in early statecraft texts.' }),

  // ------------------------------------------------------------------ Civic tab (E)
  housing: B({ id: 'housing', name: 'Housing Quarter', description: 'New lanes of mud-brick and thatch homes: +1,500 housing per level.', cost: { wealth: 150, timber: 80, labor: 1500 }, buildDays: 20, upkeepWealth: 0, effects: { housing: 1500 }, maxLevel: 6, architecture: ['mud_house', 'thatch_hut', 'brick_house'], category: 'civic', commandSlot: 0, footprint: { w: 16, d: 16, placement: 'inner' }, workers: 2 }),
  sanitation: B({ id: 'sanitation', name: 'Drains & Wells', description: 'Covered drains, soak pits and clean wells keep sickness at bay.', cost: { wealth: 200, stone: 60, labor: 2500 }, buildDays: 25, upkeepWealth: 1, effects: { sanitation: 0.2, disasterResistance: 0.05 }, architecture: ['well'], age: 'mahajanapada', category: 'civic', commandSlot: 1, footprint: { w: 8, d: 8, placement: 'inner' }, workers: 1, historicity: 'documented', sourceNote: 'Urban drainage is well attested in the subcontinent from early periods.' }),
  temple: B({ id: 'temple', name: 'Temple', description: 'A shrine and gathering place; steadies hearts in hard seasons.', cost: { wealth: 350, timber: 40, stone: 150, labor: 4500 }, buildDays: 50, upkeepWealth: 2, effects: { publicOrder: 0.1, loyalty: 0.05, culture: 0.2 }, architecture: ['shikhara_temple', 'shrine'], category: 'civic', commandSlot: 2, footprint: { w: 16, d: 16, placement: 'inner' }, workers: 2, sourceNote: 'Shikhara form is a later architectural style used for visual identity; flagged as stylization.' }),
  stupa: B({ id: 'stupa', name: 'Stupa & Vihara', description: 'A domed reliquary mound with a monastery - learning, pilgrims and their coin.', cost: { wealth: 400, stone: 200, labor: 6000 }, buildDays: 60, upkeepWealth: 2, effects: { publicOrder: 0.08, culture: 0.3, tradeIncome: 0.05 }, maxLevel: 2, architecture: ['stupa'], age: 'mahajanapada', category: 'civic', commandSlot: 3, footprint: { w: 20, d: 20, placement: 'inner' }, workers: 2, historicity: 'documented' }),
  ghat: B({ id: 'ghat', name: 'Ghat', description: 'Stone steps down to the river for bathing, rites, washing and boats.', cost: { wealth: 260, stone: 200, labor: 4000 }, buildDays: 40, upkeepWealth: 1, effects: { publicOrder: 0.04, sanitation: 0.05, culture: 0.1, tradeIncome: 0.03 }, maxLevel: 2, architecture: ['ghat'], category: 'civic', commandSlot: 4, footprint: { w: 16, d: 12, placement: 'shore' }, workers: 2 }),
  palace: B({ id: 'palace', name: 'Palace', description: 'Seat of the court, its halls and pavilions: order, loyalty and better tax collection.', cost: { wealth: 2000, timber: 400, stone: 800, labor: 30000 }, buildDays: 180, upkeepWealth: 15, effects: { publicOrder: 0.1, loyalty: 0.08, taxEfficiency: 0.1 }, allowedIn: BIG, maxLevel: 2, architecture: ['palace', 'chhatri', 'pavilion'], age: 'mahajanapada', category: 'civic', commandSlot: 5, footprint: { w: 40, d: 40, placement: 'inner' }, workers: 4 }),

  // ------------------------------------------------------------------ Defense tab (R)
  fort_walls: B({ id: 'fort_walls', name: 'Walls & Gates', description: 'Level 1 earth rampart and palisade, level 2 brick walls (Mahajanapada), level 3 stone walls (Samrajya). Each level +1 fort level.', cost: { wealth: 600, timber: 200, stone: 300, labor: 18000 }, buildDays: 70, upkeepWealth: 5, effects: { fortLevel: 1, publicOrder: 0.05 }, architecture: ['fort_wall', 'fort_gate', 'tower'], category: 'defense', commandSlot: 0, footprint: { w: 0, d: 0, placement: 'perimeter' }, workers: 8 }),
  watchtower: B({ id: 'watchtower', name: 'Watchtower', description: 'Signal tower: reveals armies within 900 m of map and warns of raids.', cost: { wealth: 120, timber: 60, labor: 900 }, buildDays: 15, upkeepWealth: 1, effects: { publicOrder: 0.03 }, maxLevel: 1, architecture: ['tower'], category: 'defense', commandSlot: 1, footprint: { w: 4, d: 4, placement: 'outer' }, workers: 1 }),
};

export function getBuilding(t: BuildingType): BuildingDef {
  return BUILDINGS[t];
}
