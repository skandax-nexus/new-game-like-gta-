/**
 * The MVP strategic region: "The River of Kings" (GDD §8 chapter 3 setting, §15 one functioning region).
 * OWNER: Creative Director. Placeholder layout by the CTO.
 *
 * Positions are normalized (u: west->east, v: north->south). Exact sites are resolved on the terrain at
 * world creation (core/terrain/sites.ts). Terrain layout reminder: the main river crosses west->east near
 * the middle (v ~ 0.45-0.55) with a northern tributary; plateau country to the south-west, hills to
 * the north-east, dry scrub to the west, forests to the east.
 */
import type { RegionDef } from '../core/types';
import { createRegionTerrainSpec } from '../core/terrain/heightfield';

/** Fixed seed - the region is hand-authored at the regional level (GDD §2). */
export const REGION_SEED = 1337;

export const REGION: RegionDef = {
  id: 'river_of_kings',
  name: 'The River of Kings',
  description: 'A fertile river corridor between the northern plains and the southern plateau - grain, trade and the crossings every army must take.',
  terrain: createRegionTerrainSpec(REGION_SEED),
  historicity: 'fictional',
  provinces: [
    { id: 'prov_rajapura', name: 'Rajapura', zone: 'northern_plains', capitalSettlementId: 'rajapura', fertility: 0.9, resources: ['grain', 'rice', 'cotton'], historicity: 'fictional' },
    { id: 'prov_dakshina', name: 'Dakshina Plateau', zone: 'deccan_plateau', capitalSettlementId: 'giridurg', fertility: 0.55, resources: ['iron', 'stone', 'horses'], historicity: 'fictional' },
    { id: 'prov_marusthali', name: 'Marusthali', zone: 'western_frontier', capitalSettlementId: 'marupur', fertility: 0.4, resources: ['salt', 'horses'], historicity: 'fictional' },
    { id: 'prov_vanapradesh', name: 'Vanapradesh', zone: 'eastern_forests', capitalSettlementId: 'vanapura', fertility: 0.65, resources: ['timber', 'elephants', 'spices'], historicity: 'fictional' },
    { id: 'prov_tira', name: 'Tira Corridor', zone: 'northern_plains', capitalSettlementId: 'tirthaghat', fertility: 0.95, resources: ['rice', 'grain'], historicity: 'fictional' },
  ],
  settlements: [
    { id: 'rajapura', name: 'Rajapura', kind: 'capital', provinceId: 'prov_rajapura', u: 0.42, v: 0.36, site: 'riverside', population: 24000, defaultOwner: 'heartland', buildings: [{ type: 'palace', level: 1 }, { type: 'granary', level: 2 }, { type: 'market', level: 2 }, { type: 'barracks', level: 1 }, { type: 'stables', level: 1 }, { type: 'elephant_stables', level: 1 }, { type: 'temple', level: 1 }, { type: 'fort_walls', level: 1 }, { type: 'ghat', level: 1 }, { type: 'farm_fields', level: 3 }], resources: ['grain', 'rice'], fortLevel: 2, historicity: 'fictional' },
    { id: 'kusumpur', name: 'Kusumpur', kind: 'village', provinceId: 'prov_rajapura', u: 0.3, v: 0.2, site: 'plain', population: 2200, defaultOwner: 'heartland', buildings: [{ type: 'farm_fields', level: 2 }, { type: 'water_tank', level: 1 }], resources: ['grain'], fortLevel: 0, historicity: 'fictional' },
    { id: 'shalivana', name: 'Shalivana', kind: 'village', provinceId: 'prov_rajapura', u: 0.55, v: 0.2, site: 'plain', population: 1800, defaultOwner: 'heartland', buildings: [{ type: 'farm_fields', level: 2 }], resources: ['rice'], fortLevel: 0, historicity: 'fictional' },
    { id: 'dhanyagram', name: 'Dhanyagram', kind: 'village', provinceId: 'prov_rajapura', u: 0.24, v: 0.36, site: 'plain', population: 2600, defaultOwner: 'heartland', buildings: [{ type: 'farm_fields', level: 3 }, { type: 'granary', level: 1 }], resources: ['grain'], fortLevel: 0, historicity: 'fictional' },
    { id: 'ratnapur', name: 'Ratnapur', kind: 'town', provinceId: 'prov_rajapura', u: 0.6, v: 0.34, site: 'riverside', population: 7000, defaultOwner: 'heartland', buildings: [{ type: 'market', level: 1 }, { type: 'workshop', level: 1 }, { type: 'farm_fields', level: 2 }, { type: 'ghat', level: 1 }], resources: ['cotton'], fortLevel: 0, historicity: 'fictional' },
    { id: 'tirthaghat', name: 'Tirthaghat', kind: 'temple_town', provinceId: 'prov_tira', u: 0.66, v: 0.55, site: 'riverside', population: 6000, defaultOwner: null, buildings: [{ type: 'temple', level: 2 }, { type: 'ghat', level: 2 }, { type: 'stupa', level: 1 }, { type: 'farm_fields', level: 2 }, { type: 'market', level: 1 }], resources: ['rice'], fortLevel: 0, historicity: 'fictional' },
    { id: 'setupur', name: 'Setupur', kind: 'village', provinceId: 'prov_tira', u: 0.47, v: 0.6, site: 'crossing', population: 2000, defaultOwner: null, buildings: [{ type: 'farm_fields', level: 2 }], resources: ['grain'], fortLevel: 0, historicity: 'fictional' },
    { id: 'naukapattana', name: 'Naukapattana', kind: 'port', provinceId: 'prov_tira', u: 0.82, v: 0.44, site: 'riverside', population: 5200, defaultOwner: null, buildings: [{ type: 'harbor', level: 1 }, { type: 'market', level: 1 }, { type: 'granary', level: 1 }], resources: ['spices'], fortLevel: 0, historicity: 'fictional' },
    { id: 'giridurg', name: 'Giridurg', kind: 'fort', provinceId: 'prov_dakshina', u: 0.24, v: 0.78, site: 'hilltop', population: 5000, defaultOwner: 'highland', buildings: [{ type: 'fort_walls', level: 3 }, { type: 'barracks', level: 1 }, { type: 'stables', level: 1 }, { type: 'stepwell', level: 1 }, { type: 'granary', level: 1 }], resources: ['iron', 'stone'], fortLevel: 3, historicity: 'fictional' },
    { id: 'shilapur', name: 'Shilapur', kind: 'town', provinceId: 'prov_dakshina', u: 0.38, v: 0.72, site: 'plain', population: 5500, defaultOwner: 'highland', buildings: [{ type: 'workshop', level: 1 }, { type: 'mine', level: 1 }, { type: 'market', level: 1 }, { type: 'farm_fields', level: 1 }], resources: ['stone', 'copper'], fortLevel: 1, historicity: 'fictional' },
    { id: 'pashanagram', name: 'Pashanagram', kind: 'village', provinceId: 'prov_dakshina', u: 0.12, v: 0.64, site: 'hilltop', population: 1500, defaultOwner: 'highland', buildings: [{ type: 'farm_fields', level: 1 }, { type: 'watchtower', level: 1 }], resources: ['horses'], fortLevel: 0, historicity: 'fictional' },
    { id: 'vindhyavasa', name: 'Vindhyavasa', kind: 'village', provinceId: 'prov_dakshina', u: 0.48, v: 0.86, site: 'plain', population: 1700, defaultOwner: 'highland', buildings: [{ type: 'farm_fields', level: 2 }, { type: 'water_tank', level: 1 }], resources: ['grain'], fortLevel: 0, historicity: 'fictional' },
    { id: 'marupur', name: 'Marupur', kind: 'town', provinceId: 'prov_marusthali', u: 0.1, v: 0.28, site: 'plain', population: 4200, defaultOwner: 'frontier', buildings: [{ type: 'market', level: 1 }, { type: 'stables', level: 1 }, { type: 'stepwell', level: 1 }], resources: ['salt', 'horses'], fortLevel: 1, historicity: 'fictional' },
    { id: 'ushtragram', name: 'Ushtragram', kind: 'village', provinceId: 'prov_marusthali', u: 0.08, v: 0.47, site: 'plain', population: 1200, defaultOwner: 'frontier', buildings: [{ type: 'water_tank', level: 1 }], resources: ['salt'], fortLevel: 0, historicity: 'fictional' },
    { id: 'vanapura', name: 'Vanapura', kind: 'city', provinceId: 'prov_vanapradesh', u: 0.86, v: 0.6, site: 'forest_edge', population: 11000, defaultOwner: 'forest', buildings: [{ type: 'elephant_stables', level: 1 }, { type: 'barracks', level: 1 }, { type: 'temple', level: 1 }, { type: 'market', level: 1 }, { type: 'fort_walls', level: 1 }], resources: ['timber', 'elephants'], fortLevel: 1, historicity: 'fictional' },
    { id: 'gajavana', name: 'Gajavana', kind: 'village', provinceId: 'prov_vanapradesh', u: 0.9, v: 0.26, site: 'forest_edge', population: 1300, defaultOwner: 'forest', buildings: [{ type: 'farm_fields', level: 1 }], resources: ['elephants', 'timber'], fortLevel: 0, historicity: 'fictional' },
    { id: 'madhuvana', name: 'Madhuvana', kind: 'village', provinceId: 'prov_vanapradesh', u: 0.74, v: 0.8, site: 'forest_edge', population: 1500, defaultOwner: 'forest', buildings: [{ type: 'farm_fields', level: 1 }], resources: ['spices'], fortLevel: 0, historicity: 'fictional' },
  ],
  roads: [
    { from: 'rajapura', to: 'ratnapur', quality: 'royal_road' },
    { from: 'ratnapur', to: 'naukapattana', quality: 'royal_road' },
    { from: 'naukapattana', to: 'vanapura', quality: 'road' },
    { from: 'rajapura', to: 'kusumpur', quality: 'road' },
    { from: 'rajapura', to: 'dhanyagram', quality: 'road' },
    { from: 'dhanyagram', to: 'marupur', quality: 'road' },
    { from: 'rajapura', to: 'shalivana', quality: 'road' },
    { from: 'rajapura', to: 'setupur', quality: 'royal_road' },
    { from: 'setupur', to: 'tirthaghat', quality: 'road' },
    { from: 'ratnapur', to: 'tirthaghat', quality: 'road' },
    { from: 'setupur', to: 'shilapur', quality: 'road' },
    { from: 'shilapur', to: 'giridurg', quality: 'road' },
    { from: 'shilapur', to: 'vindhyavasa', quality: 'track' },
    { from: 'giridurg', to: 'pashanagram', quality: 'track' },
    { from: 'marupur', to: 'ushtragram', quality: 'track' },
    { from: 'ushtragram', to: 'pashanagram', quality: 'track' },
    { from: 'vanapura', to: 'gajavana', quality: 'track' },
    { from: 'vanapura', to: 'madhuvana', quality: 'track' },
    { from: 'madhuvana', to: 'vindhyavasa', quality: 'track' },
    { from: 'shalivana', to: 'gajavana', quality: 'track' },
    { from: 'tirthaghat', to: 'vanapura', quality: 'road' },
  ],
};
