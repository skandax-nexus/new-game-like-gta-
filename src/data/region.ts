/**
 * The MVP strategic region: "The River of Kings" (GDD §2, §8 ch.3 setting, §15 one functioning region;
 * DESIGN_SPEC §2). OWNER: Creative Director.
 *
 * Geography (matches the region terrain generated from REGION_SEED - see core/terrain/heightfield.ts):
 *  - The Rajavahini ("she who carries kings") flows west -> east across the middle of the map
 *    (v ~ 0.45-0.57), meandering, with fords; the Kanakavati tributary comes down from the northern hills
 *    and joins it just south-west of Rajapura (the confluence, u ~ 0.37 v ~ 0.48).
 *  - North of the river: the Suvarna heartland plains (grassland/farmland) under low ridged hills.
 *  - West (u < 0.2): Dhanvadesha, dry plains and scrub of the salt road (western frontier).
 *  - South-west (u < 0.45, v > 0.6): the Dakshinagiri plateau and its escarpment (Deccan-like highlands).
 *  - East (u > 0.78): Nilavana, forests and elephant country; the river mouth and its free port.
 *
 * Positions are normalized (u: west->east, v: north->south) and resolved to buildable sites honoring
 * `site` (core/terrain/sites.ts). Order matters: earlier settlements get priority on contested sites.
 * Names are fictional Sanskrit/Prakrit-style compounds; no real dynasty, city or people is depicted.
 */
import type { RegionDef } from '../core/types';
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
    'The Rajavahini corridor, from the grain plains of the north to the edge of the southern plateau: two rivers, three crossings, sixteen settlements - grain, trade and the bridges every army must take.',
  terrain: createRegionTerrainSpec(REGION_SEED),
  historicity: 'fictional',
  provinces: [
    { id: 'prov_rajakshetra', name: 'Rajakshetra', zone: 'northern_plains', capitalSettlementId: 'rajapura', fertility: 0.9, resources: ['grain', 'rice', 'cotton'], historicity: 'fictional', sourceNote: 'The crown lands around the confluence.' },
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
      id: 'dhanyagram', name: 'Dhanyagram', kind: 'village', provinceId: 'prov_rajakshetra', u: 0.22, v: 0.4, site: 'plain', population: 2800, defaultOwner: 'heartland',
      buildings: [{ type: 'farm_fields', level: 3 }, { type: 'granary', level: 2 }, { type: 'water_tank', level: 1 }],
      resources: ['grain', 'cotton'], fortLevel: 0, historicity: 'fictional',
    },
    {
      id: 'kusumpur', name: 'Kusumpur', kind: 'village', provinceId: 'prov_rajakshetra', u: 0.28, v: 0.25, site: 'plain', population: 2400, defaultOwner: 'heartland',
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
      buildings: [{ type: 'harbor', level: 2 }, { type: 'market', level: 2 }, { type: 'granary', level: 1 }, { type: 'workshop', level: 1 }, { type: 'ghat', level: 1 }, { type: 'fort_walls', level: 1 }],
      resources: ['spices', 'salt'], fortLevel: 1, historicity: 'fictional',
    },
    // --- Giridurga Confederacy (5) ---
    {
      id: 'giridurg', name: 'Giridurg', kind: 'fort', provinceId: 'prov_dakshinagiri', u: 0.23, v: 0.8, site: 'hilltop', population: 6000, defaultOwner: 'highland',
      buildings: [{ type: 'fort_walls', level: 2 }, { type: 'barracks', level: 2 }, { type: 'stables', level: 1 }, { type: 'stepwell', level: 1 }, { type: 'granary', level: 2 }, { type: 'temple', level: 1 }, { type: 'mine', level: 1 }, { type: 'housing', level: 1 }, { type: 'workshop', level: 1 }],
      resources: ['iron', 'stone'], fortLevel: 3, historicity: 'fictional',
    },
    {
      id: 'shilapur', name: 'Shilapur', kind: 'town', provinceId: 'prov_shilatala', u: 0.38, v: 0.72, site: 'plain', population: 5600, defaultOwner: 'highland',
      buildings: [{ type: 'workshop', level: 1 }, { type: 'mine', level: 2 }, { type: 'market', level: 1 }, { type: 'farm_fields', level: 2 }, { type: 'temple', level: 1 }, { type: 'housing', level: 1 }, { type: 'fort_walls', level: 1 }],
      resources: ['stone', 'copper'], fortLevel: 1, historicity: 'fictional',
    },
    {
      id: 'dvaradurga', name: 'Dvaradurga', kind: 'fort', provinceId: 'prov_dakshinagiri', u: 0.12, v: 0.62, site: 'hilltop', population: 2400, defaultOwner: 'highland',
      buildings: [{ type: 'fort_walls', level: 2 }, { type: 'barracks', level: 1 }, { type: 'watchtower', level: 1 }, { type: 'water_tank', level: 1 }, { type: 'farm_fields', level: 1 }, { type: 'mine', level: 1 }],
      resources: ['stone', 'horses'], fortLevel: 2, historicity: 'fictional',
    },
    {
      id: 'pashanagram', name: 'Pashanagram', kind: 'village', provinceId: 'prov_dakshinagiri', u: 0.09, v: 0.78, site: 'hilltop', population: 1600, defaultOwner: 'highland',
      buildings: [{ type: 'farm_fields', level: 1 }, { type: 'barracks', level: 1 }, { type: 'stables', level: 1 }, { type: 'water_tank', level: 1 }],
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
      buildings: [{ type: 'market', level: 2 }, { type: 'barracks', level: 1 }, { type: 'stables', level: 1 }, { type: 'water_tank', level: 2 }, { type: 'fort_walls', level: 1 }],
      resources: ['salt', 'horses'], fortLevel: 1, historicity: 'fictional',
    },
    {
      id: 'ushtragram', name: 'Ushtragram', kind: 'village', provinceId: 'prov_dhanvadesha', u: 0.08, v: 0.46, site: 'plain', population: 1300, defaultOwner: 'frontier',
      buildings: [{ type: 'water_tank', level: 1 }, { type: 'farm_fields', level: 1 }],
      resources: ['salt'], fortLevel: 0, historicity: 'fictional',
    },
    // --- Nilavana Kingdoms (2) ---
    {
      id: 'nilavanapura', name: 'Nilavanapura', kind: 'city', provinceId: 'prov_nilavana', u: 0.85, v: 0.62, site: 'forest_edge', population: 9500, defaultOwner: 'forest',
      buildings: [{ type: 'elephant_stables', level: 1 }, { type: 'stables', level: 1 }, { type: 'barracks', level: 1 }, { type: 'temple', level: 1 }, { type: 'market', level: 1 }, { type: 'fort_walls', level: 1 }, { type: 'workshop', level: 2 }, { type: 'farm_fields', level: 2 }, { type: 'granary', level: 1 }],
      resources: ['timber', 'elephants', 'spices'], fortLevel: 1, historicity: 'fictional',
    },
    {
      id: 'gajavana', name: 'Gajavana', kind: 'village', provinceId: 'prov_nilavana', u: 0.88, v: 0.26, site: 'forest_edge', population: 1400, defaultOwner: 'forest',
      buildings: [{ type: 'farm_fields', level: 1 }, { type: 'watchtower', level: 1 }],
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
