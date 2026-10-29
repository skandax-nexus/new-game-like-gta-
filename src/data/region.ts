/**
 * The MVP strategic region: "The River of Kings" (GDD §2, §8 ch.3 setting, §15 one functioning region;
 * DESIGN_SPEC §2). OWNER: Creative Director.
 *
 * Geography (matches the region terrain generated from REGION_SEED - see core/terrain/heightfield.ts):
 *  - The Rajavahini ("she who carries kings") flows west -> east across the middle of the map
 *    (v ~ 0.45-0.58), meandering, with fords; the Kanakavati tributary comes down from the northern hills
 *    (u ~ 0.33) and joins it south-west of Rajapura. Rajapura stands on the EAST bank of the Kanakavati
 *    (water ~280 m west of the centre) with the Rajavahini ~500 m to the south.
 *  - North of the river: the Suvarna heartland plains (grassland/farmland) under low ridged hills.
 *  - West (u < 0.2): Dhanvadesha, dry plains and scrub of the salt road (western frontier).
 *  - South-west (u < 0.45, v > 0.6): the Dakshinagiri plateau and its escarpment (Deccan-like highlands).
 *  - East (u > 0.78): Nilavana, forests and elephant country; the river mouth and its free port.
 *
 * Positions are normalized (u: west->east, v: north->south) and resolved to buildable sites honoring
 * `site` (core/terrain/sites.ts). Order matters: earlier settlements get priority on contested sites.
 * Names are fictional Sanskrit/Prakrit-style compounds; no real dynasty, city or people is depicted.
 */
import type { RegionDef, SettlementId } from '../core/types';
import { createRegionTerrainSpec } from '../core/terrain/heightfield';

/** Fixed seed - the region is hand-authored at the regional level (GDD §2). */
export const REGION_SEED = 1337;

/** River names used by UI labels, events and the hero cinematic. */
export const RIVERS = {
  main: { name: 'Rajavahini', meaning: 'She who carries kings' },
  tributary: { name: 'Kanakavati', meaning: 'The golden one' },
} as const;

export const REGION: RegionDef = {
  id: 'river_of_kings',
  name: 'The River of Kings',
  description:
    'The Rajavahini corridor, from the grain plains of the north to the edge of the southern plateau: two rivers, three crossings, sixteen settlements in eight provinces - grain, trade and the bridges every army must take.',
  terrain: createRegionTerrainSpec(REGION_SEED),
  historicity: 'fictional',
  provinces: [
    { id: 'prov_rajakshetra', name: 'Rajakshetra', zone: 'northern_plains', capitalSettlementId: 'rajapura', fertility: 0.9, resources: ['grain', 'rice', 'cotton'], historicity: 'fictional', sourceNote: 'The crown lands of the capital, ruled directly by the court.' },
    { id: 'prov_dhanyakshetra', name: 'Dhanyakshetra', zone: 'northern_plains', capitalSettlementId: 'dhanyagram', fertility: 0.95, resources: ['grain', 'cotton'], historicity: 'fictional', sourceNote: 'Dhanya-kshetra, "the grain fields": the bread-basket villages west of the capital, under a governor.' },
    { id: 'prov_ratnadesha', name: 'Ratnadesha', zone: 'northern_plains', capitalSettlementId: 'ratnapura', fertility: 0.75, resources: ['cotton', 'gems', 'spices'], historicity: 'fictional', sourceNote: 'Eastern trade province down to the river mouth.' },
    { id: 'prov_tira', name: 'Tira', zone: 'northern_plains', capitalSettlementId: 'setupur', fertility: 0.95, resources: ['rice', 'grain'], historicity: 'fictional', sourceNote: 'The contested river corridor: the bridge fort and the sacred ghats.' },
    { id: 'prov_dakshinagiri', name: 'Dakshinagiri', zone: 'deccan_plateau', capitalSettlementId: 'giridurg', fertility: 0.5, resources: ['iron', 'stone', 'horses'], historicity: 'fictional' },
    { id: 'prov_shilatala', name: 'Shilatala', zone: 'deccan_plateau', capitalSettlementId: 'shilapur', fertility: 0.65, resources: ['stone', 'copper', 'grain'], historicity: 'fictional', sourceNote: 'Quarry country at the foot of the plateau.' },
    { id: 'prov_dhanvadesha', name: 'Dhanvadesha', zone: 'western_frontier', capitalSettlementId: 'lavanapura', fertility: 0.35, resources: ['salt', 'horses'], historicity: 'fictional', sourceNote: 'Dhanvan: dry land. The salt road and its wells.' },
    { id: 'prov_nilavana', name: 'Nilavana', zone: 'eastern_forests', capitalSettlementId: 'nilavanapura', fertility: 0.7, resources: ['timber', 'elephants', 'spices'], historicity: 'fictional' },
  ],
  settlements: [
    // --- Suvarna heartland (5) ---
    {
      id: 'rajapura', name: 'Rajapura', kind: 'capital', provinceId: 'prov_rajakshetra', u: 0.4, v: 0.37, site: 'riverside', population: 24000, defaultOwner: 'heartland',
      buildings: [{ type: 'palace', level: 1 }, { type: 'granary', level: 2 }, { type: 'market', level: 2 }, { type: 'barracks', level: 2 }, { type: 'stables', level: 1 }, { type: 'elephant_stables', level: 1 }, { type: 'temple', level: 2 }, { type: 'fort_walls', level: 2 }, { type: 'ghat', level: 1 }, { type: 'farm_fields', level: 3 }, { type: 'housing', level: 3 }, { type: 'workshop', level: 2 }, { type: 'sanitation', level: 1 }],
      resources: ['grain', 'rice', 'cotton'], fortLevel: 2, historicity: 'fictional',
    },
    {
      id: 'dhanyagram', name: 'Dhanyagram', kind: 'village', provinceId: 'prov_dhanyakshetra', u: 0.22, v: 0.4, site: 'plain', population: 2800, defaultOwner: 'heartland',
      buildings: [{ type: 'farm_fields', level: 3 }, { type: 'granary', level: 2 }, { type: 'water_tank', level: 1 }],
      resources: ['grain', 'cotton'], fortLevel: 0, historicity: 'fictional',
    },
    {
      id: 'kusumpur', name: 'Kusumpur', kind: 'village', provinceId: 'prov_dhanyakshetra', u: 0.28, v: 0.25, site: 'plain', population: 2400, defaultOwner: 'heartland',
      buildings: [{ type: 'farm_fields', level: 3 }, { type: 'water_tank', level: 1 }, { type: 'granary', level: 1 }],
      resources: ['grain'], fortLevel: 0, historicity: 'fictional',
    },
    {
      id: 'ratnapura', name: 'Ratnapura', kind: 'town', provinceId: 'prov_ratnadesha', u: 0.62, v: 0.31, site: 'plain', population: 7200, defaultOwner: 'heartland',
      buildings: [{ type: 'market', level: 2 }, { type: 'workshop', level: 2 }, { type: 'farm_fields', level: 2 }, { type: 'housing', level: 1 }, { type: 'temple', level: 1 }, { type: 'road_station', level: 1 }, { type: 'fort_walls', level: 1 }],
      resources: ['cotton', 'gems'], fortLevel: 1, historicity: 'fictional',
    },
    {
      id: 'setupur', name: 'Setupur', kind: 'fort', provinceId: 'prov_tira', u: 0.48, v: 0.53, site: 'crossing', population: 2200, defaultOwner: 'heartland',
      buildings: [{ type: 'fort_walls', level: 1 }, { type: 'barracks', level: 1 }, { type: 'farm_fields', level: 2 }, { type: 'watchtower', level: 1 }],
      resources: ['grain', 'timber'], fortLevel: 1, historicity: 'fictional',
    },
    // --- Independent (2) ---
    {
      id: 'tirthaghat', name: 'Tirthaghat', kind: 'temple_town', provinceId: 'prov_tira', u: 0.66, v: 0.56, site: 'riverside', population: 6000, defaultOwner: null,
      buildings: [{ type: 'temple', level: 3 }, { type: 'ghat', level: 2 }, { type: 'stupa', level: 1 }, { type: 'farm_fields', level: 2 }, { type: 'market', level: 1 }, { type: 'housing', level: 2 }],
      resources: ['rice'], fortLevel: 0, historicity: 'fictional',
    },
    {
      id: 'naukapattana', name: 'Naukapattana', kind: 'port', provinceId: 'prov_ratnadesha', u: 0.9, v: 0.41, site: 'riverside', population: 5200, defaultOwner: null,
      buildings: [{ type: 'harbor', level: 2 }, { type: 'market', level: 2 }, { type: 'granary', level: 1 }, { type: 'workshop', level: 1 }, { type: 'ghat', level: 1 }, { type: 'fort_walls', level: 1 }, { type: 'farm_fields', level: 1 }],
      resources: ['spices', 'salt'], fortLevel: 1, historicity: 'fictional',
    },
    // --- Giridurga Confederacy (5) ---
    {
      id: 'giridurg', name: 'Giridurg', kind: 'fort', provinceId: 'prov_dakshinagiri', u: 0.23, v: 0.8, site: 'hilltop', population: 6000, defaultOwner: 'highland',
      buildings: [{ type: 'fort_walls', level: 2 }, { type: 'barracks', level: 2 }, { type: 'stables', level: 1 }, { type: 'stepwell', level: 1 }, { type: 'granary', level: 2 }, { type: 'temple', level: 1 }, { type: 'mine', level: 1 }, { type: 'housing', level: 1 }, { type: 'workshop', level: 1 }, { type: 'farm_fields', level: 2 }],
      resources: ['iron', 'stone'], fortLevel: 3, historicity: 'fictional',
    },
    {
      id: 'shilapur', name: 'Shilapur', kind: 'town', provinceId: 'prov_shilatala', u: 0.38, v: 0.72, site: 'plain', population: 5600, defaultOwner: 'highland',
      buildings: [{ type: 'workshop', level: 1 }, { type: 'mine', level: 2 }, { type: 'market', level: 1 }, { type: 'farm_fields', level: 3 }, { type: 'temple', level: 1 }, { type: 'housing', level: 1 }, { type: 'fort_walls', level: 1 }],
      resources: ['stone', 'copper'], fortLevel: 1, historicity: 'fictional',
    },
    {
      id: 'dvaradurga', name: 'Dvaradurga', kind: 'fort', provinceId: 'prov_dakshinagiri', u: 0.12, v: 0.62, site: 'hilltop', population: 2400, defaultOwner: 'highland',
      buildings: [{ type: 'fort_walls', level: 2 }, { type: 'barracks', level: 1 }, { type: 'watchtower', level: 1 }, { type: 'water_tank', level: 1 }, { type: 'farm_fields', level: 2 }, { type: 'mine', level: 1 }],
      resources: ['stone', 'horses'], fortLevel: 2, historicity: 'fictional',
    },
    {
      id: 'pashanagram', name: 'Pashanagram', kind: 'village', provinceId: 'prov_dakshinagiri', u: 0.09, v: 0.78, site: 'hilltop', population: 1600, defaultOwner: 'highland',
      buildings: [{ type: 'farm_fields', level: 2 }, { type: 'barracks', level: 1 }, { type: 'stables', level: 1 }, { type: 'water_tank', level: 1 }],
      resources: ['horses'], fortLevel: 0, historicity: 'fictional',
    },
    {
      id: 'kandaravasa', name: 'Kandaravasa', kind: 'village', provinceId: 'prov_shilatala', u: 0.52, v: 0.86, site: 'plain', population: 1800, defaultOwner: 'highland',
      buildings: [{ type: 'farm_fields', level: 2 }, { type: 'water_tank', level: 1 }],
      resources: ['grain'], fortLevel: 0, historicity: 'fictional',
    },
    // --- Marudesha Principalities (2) ---
    {
      id: 'lavanapura', name: 'Lavanapura', kind: 'town', provinceId: 'prov_dhanvadesha', u: 0.1, v: 0.28, site: 'plain', population: 4400, defaultOwner: 'frontier',
      buildings: [{ type: 'market', level: 2 }, { type: 'barracks', level: 1 }, { type: 'stables', level: 1 }, { type: 'water_tank', level: 2 }, { type: 'fort_walls', level: 1 }, { type: 'farm_fields', level: 3 }],
      resources: ['salt', 'horses'], fortLevel: 1, historicity: 'fictional',
    },
    {
      id: 'ushtragram', name: 'Ushtragram', kind: 'village', provinceId: 'prov_dhanvadesha', u: 0.08, v: 0.46, site: 'plain', population: 1300, defaultOwner: 'frontier',
      buildings: [{ type: 'water_tank', level: 1 }, { type: 'farm_fields', level: 2 }],
      resources: ['salt'], fortLevel: 0, historicity: 'fictional',
    },
    // --- Nilavana Kingdoms (2) ---
    {
      id: 'nilavanapura', name: 'Nilavanapura', kind: 'city', provinceId: 'prov_nilavana', u: 0.85, v: 0.62, site: 'forest_edge', population: 9500, defaultOwner: 'forest',
      buildings: [{ type: 'elephant_stables', level: 1 }, { type: 'stables', level: 1 }, { type: 'barracks', level: 1 }, { type: 'temple', level: 1 }, { type: 'market', level: 1 }, { type: 'fort_walls', level: 1 }, { type: 'workshop', level: 2 }, { type: 'farm_fields', level: 3 }, { type: 'granary', level: 1 }],
      resources: ['timber', 'elephants', 'spices'], fortLevel: 1, historicity: 'fictional',
    },
    {
      id: 'gajavana', name: 'Gajavana', kind: 'village', provinceId: 'prov_nilavana', u: 0.88, v: 0.26, site: 'forest_edge', population: 1400, defaultOwner: 'forest',
      buildings: [{ type: 'farm_fields', level: 2 }, { type: 'watchtower', level: 1 }],
      resources: ['elephants', 'timber'], fortLevel: 0, historicity: 'fictional',
    },
  ],
  roads: [
    // Royal roads radiate from the capital.
    { from: 'rajapura', to: 'ratnapura', quality: 'royal_road' },
    { from: 'rajapura', to: 'setupur', quality: 'royal_road' },
    { from: 'rajapura', to: 'kusumpur', quality: 'road' },
    { from: 'rajapura', to: 'dhanyagram', quality: 'road' },
    { from: 'kusumpur', to: 'dhanyagram', quality: 'track' },
    // East: the trade artery to the river mouth and the forest.
    { from: 'ratnapura', to: 'naukapattana', quality: 'road' },
    { from: 'ratnapura', to: 'gajavana', quality: 'track' },
    { from: 'naukapattana', to: 'gajavana', quality: 'track' },
    { from: 'naukapattana', to: 'nilavanapura', quality: 'road' },
    // The river corridor.
    { from: 'setupur', to: 'tirthaghat', quality: 'road' },
    { from: 'tirthaghat', to: 'ratnapura', quality: 'track' },
    { from: 'tirthaghat', to: 'nilavanapura', quality: 'road' },
    // South to the plateau.
    { from: 'setupur', to: 'shilapur', quality: 'road' },
    { from: 'shilapur', to: 'giridurg', quality: 'road' },
    { from: 'shilapur', to: 'kandaravasa', quality: 'track' },
    { from: 'kandaravasa', to: 'nilavanapura', quality: 'track' },
    { from: 'giridurg', to: 'pashanagram', quality: 'road' },
    { from: 'pashanagram', to: 'dvaradurga', quality: 'track' },
    { from: 'dvaradurga', to: 'shilapur', quality: 'track' },
    // West: the salt road and the western pass.
    { from: 'dvaradurga', to: 'ushtragram', quality: 'track' },
    { from: 'ushtragram', to: 'lavanapura', quality: 'track' },
    { from: 'lavanapura', to: 'dhanyagram', quality: 'road' },
  ],
};

// ---------------------------------------------------------------------------------------------------
// Lore for UI tooltips, the settlement panel header and hero mode (DESIGN_SPEC §3.3).
// ---------------------------------------------------------------------------------------------------

export interface SettlementLore {
  /** Short epithet shown under the name, e.g. "Seat of the Suvarna Kings". */
  epithet: string;
  /** Two-sentence description for the settlement panel. */
  description: string;
  /** Gameplay role tags for the strategic map tooltip. */
  roles: ('capital' | 'granary' | 'crossing' | 'trade' | 'fortress' | 'quarry' | 'horses' | 'elephants' | 'pilgrimage' | 'port' | 'frontier')[];
}

export const SETTLEMENT_LORE: Readonly<Record<SettlementId, SettlementLore>> = {
  rajapura: { epithet: 'Seat of the Suvarna Kings', description: 'A brick-walled city of granaries, palaces and ghats on the east bank of the Kanakavati. Whoever holds its Hall of Pillars holds the crown - and must feed twenty-four thousand mouths.', roles: ['capital', 'granary', 'trade'] },
  dhanyagram: { epithet: 'The Grain Village', description: 'The richest fields of the plain, bunded and canal-fed. Its granaries feed the capital in a good year and starve first in a bad one.', roles: ['granary'] },
  kusumpur: { epithet: 'Village of Flowers', description: 'Orchards and millet fields under the northern ridges. Quiet, loyal and easily forgotten.', roles: ['granary'] },
  ratnapura: { epithet: 'City of Jewels', description: 'Gem-cutters, cotton weavers and caravan yards on the eastern road. Its governor, Prince Devavarman, keeps a household army and a long memory.', roles: ['trade'] },
  setupur: { epithet: 'The Bridge Fort', description: 'A fort and toll-house guarding the only bridge over the Rajavahini. Every army marching between the plains and the plateau crosses here - or wades the fords and drowns.', roles: ['crossing', 'fortress'] },
  tirthaghat: { epithet: 'Ford of the Pilgrims', description: 'A free temple town of stepped ghats where pilgrims of every realm bathe at dawn. Sacred ground: oaths sworn here are kept, and duels fought here are binding.', roles: ['pilgrimage', 'crossing'] },
  naukapattana: { epithet: 'The Boat Harbor', description: 'A free port of guild charters at the river mouth: spices up from the forests, salt in from the west, silver everywhere.', roles: ['port', 'trade'] },
  giridurg: { epithet: 'The Hill Citadel', description: 'Rock-cut walls and cisterns on the plateau edge where the seven clans swear their oaths. It has never been taken by storm.', roles: ['capital', 'fortress', 'quarry'] },
  shilapur: { epithet: 'City of Stone', description: 'Quarry town at the foot of the escarpment; its sandstone builds the temples of three realms. The Confederacy\'s granary - such as it is.', roles: ['quarry', 'trade'] },
  dvaradurga: { epithet: 'Gate Fort of the West', description: 'A fort astride the western pass between the salt road and the plateau, with the best horse pastures in the hills.', roles: ['fortress', 'horses', 'frontier'] },
  pashanagram: { epithet: 'The Stone Village', description: 'Herders and horse-breeders on the high plateau, the first to answer the war-drum.', roles: ['horses'] },
  kandaravasa: { epithet: 'Village of the Ravines', description: 'Terraced fields in the southern ravines, closer to the forest kingdoms than to Giridurg.', roles: ['granary', 'frontier'] },
  lavanapura: { epithet: 'City of Salt', description: 'Salt pans, wells and caravanserais on the edge of the dry west. The Marudeshi princes count their wealth in water.', roles: ['capital', 'trade', 'horses'] },
  ushtragram: { epithet: 'Village of Camels', description: 'Wells and camel lines on the salt road where it turns toward the plateau.', roles: ['frontier'] },
  nilavanapura: { epithet: 'City of the Blue Forest', description: 'Timber halls under a canopy of sal and teak, seat of the forest queen and her council of elders. Its elephant herds are the envy of every king.', roles: ['capital', 'elephants', 'trade'] },
  gajavana: { epithet: 'Elephant Grove', description: 'A forest village where wild herds are caught and trained - the only elephant market north of the river.', roles: ['elephants'] },
};

/** Named map features for labels, events and battle-site names (DESIGN_SPEC §3.4). */
export interface RegionFeature {
  id: string;
  name: string;
  kind: 'bridge' | 'ford' | 'confluence' | 'pass' | 'quarry' | 'salt_pan' | 'forest' | 'escarpment';
  /** Settlement the label anchors to (exact position resolved by the map from roads/terrain). */
  nearSettlement: SettlementId;
  description: string;
}

export const REGION_FEATURES: readonly RegionFeature[] = [
  { id: 'setu_bridge', name: 'The Setu Bridge', kind: 'bridge', nearSettlement: 'setupur', description: 'Timber spans on stone piers: the only bridge over the Rajavahini. Royal and road-grade routes across the river use it.' },
  { id: 'pilgrim_ford', name: 'The Pilgrim Ford', kind: 'ford', nearSettlement: 'tirthaghat', description: 'Waist-deep in the dry season, impassable in the monsoon (fords close when flood > 0.5).' },
  { id: 'kanaka_confluence', name: 'Sangam of the Two Rivers', kind: 'confluence', nearSettlement: 'rajapura', description: 'Where the golden Kanakavati meets the Rajavahini, south-west of the capital.' },
  { id: 'western_pass', name: 'The Dvara Pass', kind: 'pass', nearSettlement: 'dvaradurga', description: 'The only cart road from the salt flats onto the plateau.' },
  { id: 'red_quarries', name: 'The Red Quarries', kind: 'quarry', nearSettlement: 'shilapur', description: 'Sandstone and iron cut from the escarpment face.' },
  { id: 'salt_flats', name: 'The White Flats', kind: 'salt_pan', nearSettlement: 'lavanapura', description: 'Salt pans that glitter like snow in the dry season.' },
  { id: 'blue_forest', name: 'The Nilavana', kind: 'forest', nearSettlement: 'nilavanapura', description: 'Sal and teak forest, elephant country.' },
  { id: 'escarpment', name: 'The Dakshina Scarp', kind: 'escarpment', nearSettlement: 'giridurg', description: 'The cliff edge of the southern plateau, climbed by three roads.' },
];
