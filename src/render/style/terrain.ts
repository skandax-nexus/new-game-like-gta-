/**
 * Terrain look: splat layer library, per-biome blend rules, GDD §2 zone looks, farmland patchwork,
 * roads/riverbanks, and water presets. OWNER: Art Director. Consumed by render/environment/terrain.ts
 * and water.ts (Lead Graphics) through render/materials/splat.ts; textures are WP1 in docs/ASSET_LIST.md.
 * Rules and rationale: docs/ART_BIBLE.md §5 (terrain) and §6 (water).
 *
 * Slopes are in rise/run (0 = flat, 1 = 45 degrees). Heights in meters above the river datum.
 */
import type { Biome, Season } from '../../core/types';
import type { Hex } from './palette';

export const TERRAIN_LAYER_IDS = [
  'alluvial_silt',
  'grass_lush',
  'grass_dry',
  'farmland_tilled',
  'paddy_mud',
  'laterite_soil',
  'black_cotton_soil',
  'dry_earth_cracked',
  'river_sand',
  'pebbles_gravel',
  'rock_granite',
  'rock_basalt',
  'rock_sandstone_cliff',
  'forest_litter',
  'road_packed_earth',
  'flagstone_paving',
  'mud_wet',
  'salt_crust',
] as const;
export type TerrainLayerId = (typeof TERRAIN_LAYER_IDS)[number];

export interface TerrainLayer {
  id: TerrainLayerId;
  label: string;
  /** Pipeline material id (exists: ground_dry_earth). */
  assetId: string;
  baseColor: Hex;
  roughness: number;
  /** World meters per repeat (splat uses world-planar UVs). */
  tileMeters: number;
  /** Height-blend bias (ORM.r as height proxy): raise so the layer wins at transitions. */
  heightBias: number;
  normalScale: number;
  /** Rain response 0..1. */
  porosity: number;
  /** Project triplanar instead of planar (cliffs). */
  triplanar: boolean;
  notes: string;
}

const L = (l: TerrainLayer): TerrainLayer => l;

export const TERRAIN_LAYERS: Readonly<Record<TerrainLayerId, TerrainLayer>> = {
  alluvial_silt: L({ id: 'alluvial_silt', label: 'Gangetic alluvium', assetId: 'terrain_alluvial_silt', baseColor: '#8d7d64', roughness: 0.92, tileMeters: 4, heightBias: 0, normalScale: 0.7, porosity: 1, triplanar: false, notes: 'Fine grey-brown silt with hoof/foot prints and dried ripple marks.' }),
  grass_lush: L({ id: 'grass_lush', label: 'Monsoon grass', assetId: 'terrain_grass_lush', baseColor: '#5f6f3a', roughness: 0.9, tileMeters: 3, heightBias: 0.05, normalScale: 1, porosity: 0.7, triplanar: false, notes: 'Olive-emerald blades with clover and dark soil gaps; never lime. GPU grass blades sit on it.' }),
  grass_dry: L({ id: 'grass_dry', label: 'Dry grass', assetId: 'terrain_grass_dry', baseColor: '#9a8a5a', roughness: 0.95, tileMeters: 3, heightBias: 0.05, normalScale: 1, porosity: 0.6, triplanar: false, notes: 'Straw-khaki tufts with bare earth patches (grishma, scrub, plateau).' }),
  farmland_tilled: L({ id: 'farmland_tilled', label: 'Ploughed field', assetId: 'terrain_farmland_tilled', baseColor: '#7e6a50', roughness: 0.95, tileMeters: 4, heightBias: 0, normalScale: 1.3, porosity: 1, triplanar: false, notes: 'Furrows 0.3 m apart along the field axis (uv rotated per plot), clods, straw stubble.' }),
  paddy_mud: L({ id: 'paddy_mud', label: 'Paddy mud', assetId: 'terrain_paddy_mud', baseColor: '#5b5443', roughness: 0.35, tileMeters: 3, heightBias: -0.05, normalScale: 0.6, porosity: 0.2, triplanar: false, notes: 'Wet glossy mud with standing-water mask (varsha); seedling rows are geometry/cards.' }),
  laterite_soil: L({ id: 'laterite_soil', label: 'Laterite red soil', assetId: 'terrain_laterite_soil', baseColor: '#8e5038', roughness: 0.93, tileMeters: 4, heightBias: 0, normalScale: 1, porosity: 0.9, triplanar: false, notes: 'Iron-red gravelly soil of the plateau rim and eastern forest edge.' }),
  black_cotton_soil: L({ id: 'black_cotton_soil', label: 'Black cotton soil (regur)', assetId: 'terrain_black_soil', baseColor: '#3e3a33', roughness: 0.9, tileMeters: 4, heightBias: 0, normalScale: 1.2, porosity: 0.9, triplanar: false, notes: 'Deccan dark clay with deep polygonal shrinkage cracks in the dry season; turns tar-black and glossy when wet.' }),
  dry_earth_cracked: L({ id: 'dry_earth_cracked', label: 'Cracked dry earth', assetId: 'ground_dry_earth', baseColor: '#a88a68', roughness: 0.92, tileMeters: 4, heightBias: 0.02, normalScale: 1, porosity: 0.9, triplanar: false, notes: 'Exists (ground_dry_earth). Western frontier, grishma fields, settlement yards.' }),
  river_sand: L({ id: 'river_sand', label: 'River sand', assetId: 'terrain_river_sand', baseColor: '#c4b18e', roughness: 0.85, tileMeters: 3, heightBias: 0, normalScale: 0.8, porosity: 1, triplanar: false, notes: 'Pale fine sand with flow ripples aligned to the river; darker wet band 1.5 m above the water line.' }),
  pebbles_gravel: L({ id: 'pebbles_gravel', label: 'Pebbles & gravel', assetId: 'terrain_pebbles', baseColor: '#8c8273', roughness: 0.75, tileMeters: 2, heightBias: 0.15, normalScale: 1.4, porosity: 0.6, triplanar: false, notes: 'Rounded river pebbles 2-10 cm (fords, stream beds), angular scree under cliffs.' }),
  rock_granite: L({ id: 'rock_granite', label: 'Granite outcrop', assetId: 'terrain_rock_granite', baseColor: '#87827a', roughness: 0.8, tileMeters: 8, heightBias: 0.25, normalScale: 1.4, porosity: 0.3, triplanar: true, notes: 'Rounded exfoliating boulders and sheets (Deccan tors), black water stains, orange lichen.' }),
  rock_basalt: L({ id: 'rock_basalt', label: 'Basalt cliff (traps)', assetId: 'terrain_rock_basalt', baseColor: '#5a5650', roughness: 0.78, tileMeters: 10, heightBias: 0.25, normalScale: 1.5, porosity: 0.4, triplanar: true, notes: 'Stepped horizontal layering (trap topography) - the plateau escarpment signature; vertical joints.' }),
  rock_sandstone_cliff: L({ id: 'rock_sandstone_cliff', label: 'Sandstone cliff', assetId: 'terrain_rock_sandstone', baseColor: '#a88a6c', roughness: 0.82, tileMeters: 10, heightBias: 0.25, normalScale: 1.3, porosity: 0.6, triplanar: true, notes: 'Cross-bedded buff-red strata (quarry hills near Shilapur), honeycomb weathering.' }),
  forest_litter: L({ id: 'forest_litter', label: 'Forest floor', assetId: 'terrain_forest_litter', baseColor: '#5a4a35', roughness: 0.9, tileMeters: 3, heightBias: 0.05, normalScale: 1.2, porosity: 0.8, triplanar: false, notes: 'Sal and teak leaf litter (large leaves 20-30 cm), twigs, dark humus; moss in varsha.' }),
  road_packed_earth: L({ id: 'road_packed_earth', label: 'Packed earth road', assetId: 'terrain_road_earth', baseColor: '#9a7e5e', roughness: 0.88, tileMeters: 4, heightBias: 0.1, normalScale: 1, porosity: 1, triplanar: false, notes: 'Two cart ruts 1.4 m apart (track/road), hoof prints, dust; deep mud + puddles in varsha.' }),
  flagstone_paving: L({ id: 'flagstone_paving', label: 'Flagstone paving', assetId: 'terrain_flagstone', baseColor: '#a09582', roughness: 0.78, tileMeters: 4, heightBias: 0.3, normalScale: 1, porosity: 0.6, triplanar: false, notes: 'Royal roads inside cities, palace courts, ghat landings: irregular buff slabs, grass in joints.' }),
  mud_wet: L({ id: 'mud_wet', label: 'Wet mud', assetId: 'terrain_mud_wet', baseColor: '#4f4636', roughness: 0.3, tileMeters: 3, heightBias: -0.05, normalScale: 0.8, porosity: 0.1, triplanar: false, notes: 'Monsoon overlay layer: footprints, cart-churned ruts, puddle mask in its alpha.' }),
  salt_crust: L({ id: 'salt_crust', label: 'Salt flat crust', assetId: 'terrain_salt_crust', baseColor: '#d9d2c4', roughness: 0.7, tileMeters: 6, heightBias: 0.05, normalScale: 0.9, porosity: 0.5, triplanar: false, notes: 'The White Flats near Lavanapura: polygonal crust ridges, pink-grey tint at edges. Albedo <= 0.7.' }),
};

/**
 * Per-biome splat recipe: up to 4 layers (splat.ts limit) plus slope/height/moisture rules. Layer 3 is the
 * steep-slope rock layer for every biome so cliffs are consistent across biome borders.
 */
export interface BiomeTerrainRule {
  layers: readonly [TerrainLayerId, TerrainLayerId, TerrainLayerId, TerrainLayerId];
  /** Weights before rules (sum 1). */
  base: readonly [number, number, number, number];
  /** Slope where rock (layer 3) starts and fully covers. */
  rockSlope: readonly [number, number];
  /** Slope where layer 1 (secondary) replaces layer 0 on banks and terrace edges. */
  bankSlope: readonly [number, number];
  /** Low-frequency macro variation (m wavelength) and strength (albedo +-). */
  macro: { wavelengthM: number; strength: number };
  /** Moisture > threshold pushes toward layer 0 (wetter ground). */
  moistureToLayer0: number;
  /** Vegetation density 0..1 (trees, shrubs, grass) for render/environment/vegetation. */
  vegetation: { trees: number; shrubs: number; grass: number };
}

export const BIOME_TERRAIN: Readonly<Record<Biome, BiomeTerrainRule>> = {
  river: { layers: ['river_sand', 'pebbles_gravel', 'alluvial_silt', 'rock_sandstone_cliff'], base: [0.6, 0.25, 0.15, 0], rockSlope: [0.9, 1.3], bankSlope: [0.25, 0.5], macro: { wavelengthM: 60, strength: 0.08 }, moistureToLayer0: 0.5, vegetation: { trees: 0, shrubs: 0.05, grass: 0.05 } },
  floodplain: { layers: ['alluvial_silt', 'grass_lush', 'river_sand', 'rock_sandstone_cliff'], base: [0.45, 0.45, 0.1, 0], rockSlope: [0.8, 1.2], bankSlope: [0.2, 0.45], macro: { wavelengthM: 140, strength: 0.1 }, moistureToLayer0: 0.6, vegetation: { trees: 0.12, shrubs: 0.2, grass: 0.9 } },
  farmland: { layers: ['farmland_tilled', 'grass_lush', 'road_packed_earth', 'rock_sandstone_cliff'], base: [0.7, 0.25, 0.05, 0], rockSlope: [0.8, 1.2], bankSlope: [0.15, 0.35], macro: { wavelengthM: 90, strength: 0.12 }, moistureToLayer0: 0.7, vegetation: { trees: 0.06, shrubs: 0.08, grass: 0.4 } },
  grassland: { layers: ['grass_lush', 'grass_dry', 'alluvial_silt', 'rock_granite'], base: [0.6, 0.3, 0.1, 0], rockSlope: [0.75, 1.15], bankSlope: [0.25, 0.5], macro: { wavelengthM: 180, strength: 0.12 }, moistureToLayer0: 0.5, vegetation: { trees: 0.1, shrubs: 0.2, grass: 1 } },
  scrub: { layers: ['grass_dry', 'dry_earth_cracked', 'pebbles_gravel', 'rock_granite'], base: [0.45, 0.4, 0.15, 0], rockSlope: [0.7, 1.1], bankSlope: [0.2, 0.45], macro: { wavelengthM: 120, strength: 0.14 }, moistureToLayer0: 0.45, vegetation: { trees: 0.06, shrubs: 0.45, grass: 0.5 } },
  dry_plain: { layers: ['dry_earth_cracked', 'grass_dry', 'salt_crust', 'rock_sandstone_cliff'], base: [0.65, 0.3, 0.05, 0], rockSlope: [0.7, 1.1], bankSlope: [0.2, 0.45], macro: { wavelengthM: 220, strength: 0.15 }, moistureToLayer0: 0.35, vegetation: { trees: 0.03, shrubs: 0.25, grass: 0.3 } },
  forest: { layers: ['forest_litter', 'grass_lush', 'laterite_soil', 'rock_granite'], base: [0.6, 0.3, 0.1, 0], rockSlope: [0.75, 1.15], bankSlope: [0.25, 0.5], macro: { wavelengthM: 80, strength: 0.1 }, moistureToLayer0: 0.6, vegetation: { trees: 0.75, shrubs: 0.5, grass: 0.4 } },
  dense_forest: { layers: ['forest_litter', 'laterite_soil', 'grass_lush', 'rock_basalt'], base: [0.8, 0.1, 0.1, 0], rockSlope: [0.75, 1.15], bankSlope: [0.25, 0.5], macro: { wavelengthM: 70, strength: 0.08 }, moistureToLayer0: 0.6, vegetation: { trees: 1, shrubs: 0.7, grass: 0.2 } },
  hills: { layers: ['grass_dry', 'laterite_soil', 'pebbles_gravel', 'rock_granite'], base: [0.5, 0.35, 0.15, 0], rockSlope: [0.55, 0.95], bankSlope: [0.3, 0.55], macro: { wavelengthM: 160, strength: 0.14 }, moistureToLayer0: 0.5, vegetation: { trees: 0.2, shrubs: 0.4, grass: 0.6 } },
  rocky: { layers: ['pebbles_gravel', 'grass_dry', 'laterite_soil', 'rock_granite'], base: [0.4, 0.3, 0.3, 0], rockSlope: [0.35, 0.7], bankSlope: [0.2, 0.4], macro: { wavelengthM: 120, strength: 0.16 }, moistureToLayer0: 0.5, vegetation: { trees: 0.05, shrubs: 0.3, grass: 0.3 } },
  plateau: { layers: ['laterite_soil', 'black_cotton_soil', 'grass_dry', 'rock_basalt'], base: [0.45, 0.3, 0.25, 0], rockSlope: [0.5, 0.9], bankSlope: [0.25, 0.5], macro: { wavelengthM: 240, strength: 0.15 }, moistureToLayer0: 0.55, vegetation: { trees: 0.1, shrubs: 0.35, grass: 0.55 } },
  sandbank: { layers: ['river_sand', 'pebbles_gravel', 'alluvial_silt', 'rock_sandstone_cliff'], base: [0.8, 0.1, 0.1, 0], rockSlope: [0.9, 1.3], bankSlope: [0.3, 0.6], macro: { wavelengthM: 50, strength: 0.07 }, moistureToLayer0: 0.4, vegetation: { trees: 0, shrubs: 0.03, grass: 0.15 } },
  marsh: { layers: ['mud_wet', 'grass_lush', 'alluvial_silt', 'rock_sandstone_cliff'], base: [0.45, 0.45, 0.1, 0], rockSlope: [0.9, 1.3], bankSlope: [0.2, 0.4], macro: { wavelengthM: 60, strength: 0.1 }, moistureToLayer0: 0.5, vegetation: { trees: 0.08, shrubs: 0.3, grass: 1 } },
};

/** Season overrides of layer weights / tints on top of SEASON_TINT. */
export const SEASON_TERRAIN: Readonly<Record<Season, { wetMudOverlay: number; dryGrassShift: number; puddles: number; dust: number; notes: string }>> = {
  vasanta: { wetMudOverlay: 0, dryGrassShift: 0.25, puddles: 0, dust: 0.2, notes: 'Rabi harvest: golden wheat, mustard fields fading, palash flowers on the forest edge.' },
  grishma: { wetMudOverlay: 0, dryGrassShift: 0.75, puddles: 0, dust: 0.8, notes: 'Bleached grass, cracked fields, black soil cracks, dust devils, heat shimmer.' },
  varsha: { wetMudOverlay: 0.6, dryGrassShift: 0, puddles: 0.8, dust: 0, notes: 'Wet mud on roads and fields, standing water in paddies and ruts, brimming tanks, swollen silty rivers.' },
  sharad: { wetMudOverlay: 0.15, dryGrassShift: 0, puddles: 0.2, dust: 0.1, notes: 'Lushest greens, white kash grass plumes on riverbanks, kharif rice turning gold.' },
  hemanta: { wetMudOverlay: 0, dryGrassShift: 0.2, puddles: 0, dust: 0.25, notes: 'Harvested stubble, threshing floors, smoke from stubble fires at dusk.' },
  shishira: { wetMudOverlay: 0.05, dryGrassShift: 0.3, puddles: 0.05, dust: 0.1, notes: 'Morning fog, dew, green wheat and yellow mustard patchwork.' },
};

/** GDD §2 regional zones: the art direction per zone (palette, dominant layers, vegetation, architecture). */
export const ZONE_LOOKS = {
  northern_plains: { palette: ['#727a4c', '#8a8449', '#8d7d64', '#c4b18e'] as const, fogTint: '#c3c6c2' as Hex, layers: ['alluvial_silt', 'farmland_tilled', 'grass_lush', 'river_sand'] as const, trees: ['mango', 'banyan', 'peepal', 'neem', 'palmyra'] as const, architecture: 'heartland_brick', look: 'Flat green-gold patchwork to the horizon, mango groves, big rivers with pale sandbanks, dense brick towns, dust haze.' },
  western_frontier: { palette: ['#b29672', '#968659', '#d9d2c4', '#a88a68'] as const, fogTint: '#cdb995' as Hex, layers: ['dry_earth_cracked', 'grass_dry', 'salt_crust', 'rock_sandstone_cliff'] as const, trees: ['babul', 'date_palm', 'neem'] as const, architecture: 'frontier_mud', look: 'Ochre plains, white salt flats, thorny babul, wells with wheels, long views through hot haze.' },
  deccan_plateau: { palette: ['#9c7c57', '#3e3a33', '#87827a', '#5a5650'] as const, fogTint: '#b9b3a6' as Hex, layers: ['laterite_soil', 'black_cotton_soil', 'grass_dry', 'rock_basalt'] as const, trees: ['teak', 'neem', 'banyan', 'palash'] as const, architecture: 'highland_stone', look: 'Stepped basalt escarpments, flat-topped hills crowned by forts, black soil and red laterite, granite tors.' },
  eastern_forests: { palette: ['#46582f', '#37472a', '#5a4a35', '#8e5038'] as const, fogTint: '#a8b2a2' as Hex, layers: ['forest_litter', 'laterite_soil', 'grass_lush', 'rock_granite'] as const, trees: ['sal', 'bamboo', 'banyan', 'palash', 'mango'] as const, architecture: 'forest_timber', look: 'Tall sal forest with shafts of light, bamboo thickets, red earth paths, mist in valleys, elephants.' },
  southern_peninsula: { palette: ['#5f6f3a', '#8e5038', '#c4b18e', '#1f6f78'] as const, fogTint: '#b7c4c2' as Hex, layers: ['laterite_soil', 'grass_lush', 'river_sand', 'rock_granite'] as const, trees: ['coconut', 'palmyra', 'banyan', 'mango'] as const, architecture: 'coastal_timber', look: '[STRETCH] Coconut coast, laterite and granite, backwaters, timber ports, humid haze.' },
} as const;

/** Farmland patchwork (field_plot pieces and the terrain field mask). */
export const FARMLAND = {
  /** Plot sizes (m) - small irregular fields, not a modern grid. */
  plotSizeM: [18, 42] as const,
  /** Earthen bunds (raised field edges). */
  bund: { widthM: 0.6, heightM: 0.35, color: '#7e6a50' as Hex },
  /** Rotation jitter of plot axes per settlement (deg) - fields follow the river/roads, not world axes. */
  axisJitterDeg: 12,
  /** Fraction of plots fallow / grazing (grass_dry) to break the pattern. */
  fallow: 0.15,
  /** Crop assignment by season (vegetation.ts CROPS); mixed within a village. */
  rotation: { kharif: ['rice', 'millet', 'cotton', 'sesame', 'sugarcane'], rabi: ['wheat', 'barley', 'mustard', 'lentil'] } as const,
};

/** Road presentation by quality (render/world/roads.ts). Widths in meters. */
export const ROAD_STYLES = {
  track: { widthM: 2.2, layer: 'road_packed_earth' as TerrainLayerId, ruts: true, edgeGrass: 0.6, opacity: 0.75 },
  road: { widthM: 4, layer: 'road_packed_earth' as TerrainLayerId, ruts: true, edgeGrass: 0.4, opacity: 0.9 },
  royal_road: { widthM: 7, layer: 'flagstone_paving' as TerrainLayerId, ruts: false, edgeGrass: 0.2, opacity: 1, trees: 'shade trees every 18-25 m, wells and rest houses every ~8 km (strategic scale)' },
} as const;

/** Riverbanks and ghats. */
export const RIVERBANK = {
  /** Wet sand band above the water line (m, vertical). */
  wetBandM: 1.5,
  /** Flood-mark line on stone (m above normal level) - dark stain. */
  floodMarkM: 2.4,
  /** Kash grass (white plumes) density on sandbanks in sharad. */
  kashGrassSharad: 0.6,
  /** Reeds in shallow water (depth < 0.6 m). */
  reedsMaxDepthM: 0.6,
  ghat: { stepRiseM: 0.3, stepTreadM: 0.45, landingEveryNSteps: 8, materialId: 'sandstone_buff', wetDarkening: 0.35, moss: '#4f5a3a' as Hex },
} as const;

// ===================================================================================================== water

export interface WaterPreset {
  id: 'river_clear' | 'river_monsoon' | 'tank_still' | 'ghat_shallows' | 'flood_overbank';
  label: string;
  deepColor: Hex;
  shallowColor: Hex;
  /** Beer-Lambert absorption per meter (linear RGB) - red goes first. */
  absorption: readonly [number, number, number];
  /** In-water scattering color (silt/plankton). */
  scatterColor: Hex;
  /** Depth (m) at which the bed is no longer visible. */
  visibilityM: number;
  roughness: number;
  normal: { tileM: number; strength: number; speed: number; secondTileM: number };
  /** Flow speed along the river tangent (m/s), for flow-mapped normals and foam. */
  flowMps: number;
  foam: { color: Hex; shoreWidthM: number; flowThreshold: number; coverage: number };
  /** Fresnel F0 (water 0.02) and reflection strength scale (planar/SSR/env). */
  reflection: { f0: number; strength: number };
  /** Sun specular glint (sun-disc highlight) gain. */
  sunGlint: number;
  notes: string;
}

export const WATER_PRESETS: Readonly<Record<WaterPreset['id'], WaterPreset>> = {
  river_clear: { id: 'river_clear', label: 'River (dry season)', deepColor: '#1f3f45', shallowColor: '#4a7468', absorption: [0.45, 0.12, 0.08], scatterColor: '#2e5a52', visibilityM: 2.5, roughness: 0.06, normal: { tileM: 9, strength: 0.6, speed: 0.35, secondTileM: 2.3 }, flowMps: 0.6, foam: { color: '#e8e4d8', shoreWidthM: 0.6, flowThreshold: 0.7, coverage: 0.15 }, reflection: { f0: 0.02, strength: 1 }, sunGlint: 1, notes: 'Green-teal, sky reflections dominate at grazing angles; sandbank visible under shallows.' },
  river_monsoon: { id: 'river_monsoon', label: 'River (monsoon spate)', deepColor: '#4a4632', shallowColor: '#7a6e4e', absorption: [0.9, 0.8, 0.7], scatterColor: '#6b5f42', visibilityM: 0.25, roughness: 0.14, normal: { tileM: 7, strength: 0.9, speed: 1.1, secondTileM: 1.8 }, flowMps: 1.8, foam: { color: '#d8cdb4', shoreWidthM: 1.4, flowThreshold: 0.45, coverage: 0.35 }, reflection: { f0: 0.02, strength: 0.75 }, sunGlint: 0.4, notes: 'Opaque silt-brown, fast, floating debris (branches, leaf mats), foam lines along banks and bridge piers.' },
  tank_still: { id: 'tank_still', label: 'Tank / stepwell (still)', deepColor: '#1d3530', shallowColor: '#3f5e4c', absorption: [0.5, 0.2, 0.15], scatterColor: '#294a3c', visibilityM: 1.2, roughness: 0.02, normal: { tileM: 5, strength: 0.15, speed: 0.08, secondTileM: 1.2 }, flowMps: 0, foam: { color: '#e8e4d8', shoreWidthM: 0, flowThreshold: 1, coverage: 0 }, reflection: { f0: 0.02, strength: 1.1 }, sunGlint: 1.2, notes: 'Mirror-like; lotus pads and algae film at edges; reflections of steps are the showcase (planar on high+).' },
  ghat_shallows: { id: 'ghat_shallows', label: 'Ghat shallows (hero/duel)', deepColor: '#24453f', shallowColor: '#5d7f6c', absorption: [0.4, 0.12, 0.09], scatterColor: '#3a6555', visibilityM: 1.6, roughness: 0.05, normal: { tileM: 4, strength: 0.5, speed: 0.4, secondTileM: 1 }, flowMps: 0.35, foam: { color: '#efeadc', shoreWidthM: 0.35, flowThreshold: 0.8, coverage: 0.1 }, reflection: { f0: 0.02, strength: 1 }, sunGlint: 1.3, notes: 'Wading depth 0.3-0.8 m; splash and ripple rings from feet (VFX); floating offerings are oil lamps on leaf boats and jasmine flowers.' },
  flood_overbank: { id: 'flood_overbank', label: 'Flood over fields', deepColor: '#5b5a3e', shallowColor: '#7d7652', absorption: [0.8, 0.7, 0.6], scatterColor: '#706646', visibilityM: 0.2, roughness: 0.1, normal: { tileM: 8, strength: 0.4, speed: 0.4, secondTileM: 2 }, flowMps: 0.3, foam: { color: '#d8cdb4', shoreWidthM: 0.8, flowThreshold: 0.8, coverage: 0.1 }, reflection: { f0: 0.02, strength: 0.9 }, sunGlint: 0.6, notes: 'Sheet water over fields (WeatherState.flood): crops poke through, bunds as lines, trees reflected.' },
};
