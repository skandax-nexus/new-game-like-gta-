/**
 * Faction visual identity: team-color usage, cloth dyes, metals, banner shapes and heraldry layers,
 * colorblind-safe remaps, relation ring styles and architecture-style palettes. OWNER: Art Director.
 * Docs: docs/ART_BIBLE.md §9.3 (faction schemes) and §3.4 (team-color rules).
 *
 * Team colors themselves live in src/data/factions.ts (FactionDef.colors, Creative Director data, agreed
 * with the Art Director) and are read through factionVisual(); this module adds the art-only fields.
 */
import type { ArchitectureKind, BannerPattern, FactionArchetype, FactionColors, FactionId } from '../../core/types';
import { FACTIONS } from '../../data/factions';
import { ACCENTS, DYES, MATERIALS, METALS, type Hex } from './palette';

export type BannerShape = 'swallowtail' | 'pennant' | 'notched' | 'streamer' | 'square' | 'fringed';
export type ArchitectureStyleId = 'heartland_brick' | 'highland_stone' | 'coastal_timber' | 'forest_timber' | 'frontier_mud' | 'city_sandstone';

export interface FactionArt {
  archetype: FactionArchetype;
  /** One line for artists: what the faction looks like. */
  look: string;
  /** Natural dye that renders the team primary on cloth (team masks multiply toward it). */
  clothDye: Hex;
  clothDyeSecondary: Hex;
  /** Base garment color under the team accents (most of a soldier's cloth area). */
  garmentBase: Hex;
  leather: Hex;
  metal: Hex;
  /** Second metal for trims, finials, howdah fittings. */
  trimMetal: Hex;
  /** Silhouette signature readable at 200 m (headgear / shield / standard). */
  signature: string;
  banner: { shape: BannerShape; poleTop: 'spear' | 'trident' | 'lotus_finial' | 'lamp' | 'crescent_horns' | 'disc'; tassels: boolean };
  architecture: ArchitectureStyleId;
  /** Colorblind-safe replacements for the team primary (GameSettings.colorblind). */
  colorblind: { protan: Hex; deutan: Hex; tritan: Hex };
}

/** Art-only faction fields by archetype (the six GDD §4 archetypes). */
export const FACTION_ART: Readonly<Record<FactionArchetype, FactionArt>> = {
  imperial_heartland: {
    archetype: 'imperial_heartland',
    look: 'Gangetic court: bleached cotton, saffron turbans and sashes, maroon and gold elephant caparisons, polished buff stone and lime-plastered brick, timber pillared halls.',
    clothDye: DYES.saffron,
    clothDyeSecondary: DYES.turmeric,
    garmentBase: DYES.cottonBleached,
    leather: '#7a5236',
    metal: METALS.bronze,
    trimMetal: METALS.goldLeaf,
    signature: 'Tall saffron turbans with a forward knot; man-high hide shields painted with the golden sun; swallowtail standards.',
    banner: { shape: 'swallowtail', poleTop: 'trident', tassels: true },
    architecture: 'heartland_brick',
    colorblind: { protan: '#e69f00', deutan: '#e69f00', tritan: '#e0442b' },
  },
  highland_confederacy: {
    archetype: 'highland_confederacy',
    look: 'Deccan hill clans: indigo quilted jackets, iron caps, round shields with white peaks, basalt and granite forts with laterite parapets.',
    clothDye: DYES.indigo,
    clothDyeSecondary: DYES.indigoLight,
    garmentBase: '#c9bfa8',
    leather: '#5c4330',
    metal: METALS.ironBlackened,
    trimMetal: METALS.goldOld,
    signature: 'Low rounded iron caps, round shields, quilted short coats that widen the torso; notched rectangular banners.',
    banner: { shape: 'notched', poleTop: 'lamp', tassels: false },
    architecture: 'highland_stone',
    colorblind: { protan: '#0072b2', deutan: '#0072b2', tritan: '#1b3f8b' },
  },
  forest_kingdoms: {
    archetype: 'forest_kingdoms',
    look: 'Eastern forest realm: leaf-green and turmeric cloth, cane shields, long bows, carved sal timber and palm thatch, elephants garlanded with jasmine and leaf garlands.',
    clothDye: '#3f7f52',
    clothDyeSecondary: DYES.turmeric,
    garmentBase: '#cbbf9f',
    leather: '#6b4a32',
    metal: METALS.bronzeAged,
    trimMetal: METALS.goldOld,
    signature: 'Woven cane shields, long bamboo bows taller than the archer, leaf-crest headbands; triangular pennants with tassels.',
    banner: { shape: 'pennant', poleTop: 'spear', tassels: true },
    architecture: 'forest_timber',
    colorblind: { protan: '#006e50', deutan: '#006e50', tritan: '#7fd1a0' },
  },
  frontier_principalities: {
    archetype: 'frontier_principalities',
    look: 'Caravan princes of the salt road: long wrapped head-cloths in violet and black, tie-dyed shawls, horse tack with silver studs, flat-roofed mud-brick and well-wheels.',
    clothDye: DYES.violetLac,
    clothDyeSecondary: DYES.ironBlack,
    garmentBase: '#d6c6a6',
    leather: '#86603e',
    metal: METALS.iron,
    trimMetal: METALS.silver,
    signature: 'Tall wrapped head-cloths with a trailing tail, light riders, long streamer banners that read the wind.',
    banner: { shape: 'streamer', poleTop: 'crescent_horns', tassels: false },
    architecture: 'frontier_mud',
    colorblind: { protan: '#cc79a7', deutan: '#cc79a7', tritan: '#f2a2c0' },
  },
  maritime_league: {
    archetype: 'maritime_league',
    look: 'River-mouth merchants: sea-teal sashes over white cotton, copper fittings, whitewashed timber warehouses, palm-thatch and lamp towers.',
    clothDye: '#1c7f8a',
    clothDyeSecondary: '#9fd8cf',
    garmentBase: DYES.cottonBleached,
    leather: '#7a5a3c',
    metal: METALS.copper,
    trimMetal: METALS.bronze,
    signature: 'Broad conical palm-leaf hats on archers, small round shields, square sail-like flags.',
    banner: { shape: 'square', poleTop: 'disc', tassels: false },
    architecture: 'coastal_timber',
    colorblind: { protan: '#56b4e9', deutan: '#56b4e9', tritan: '#2c2c2c' },
  },
  fortified_city_states: {
    archetype: 'fortified_city_states',
    look: 'Walled guild cities: crimson tunics, iron scale for guards, red sandstone gates and towers, coin and gate motifs, engineers with ropes and timber.',
    clothDye: DYES.madder,
    clothDyeSecondary: '#e6a79e',
    garmentBase: '#d8cbb0',
    leather: '#5e3f2c',
    metal: METALS.iron,
    trimMetal: METALS.goldLeaf,
    signature: 'Scale-armored guards with tall crested helmets, square shields, fringed banners hung from a crossbar.',
    banner: { shape: 'fringed', poleTop: 'disc', tassels: true },
    architecture: 'city_sandstone',
    colorblind: { protan: '#7f2704', deutan: '#7f2704', tritan: '#8c510a' },
  },
};

/** Art for factions not in data (independent settlements, rebels). */
export const NEUTRAL_ART: FactionArt = {
  archetype: 'imperial_heartland',
  look: 'Independent towns and temple cities: undyed cotton, ochre and lotus pink accents.',
  clothDye: DYES.cottonUndyed,
  clothDyeSecondary: '#d98aa6',
  garmentBase: DYES.cottonUndyed,
  leather: '#7a5236',
  metal: METALS.bronze,
  trimMetal: METALS.goldOld,
  signature: 'Plain head-cloths; lotus banners.',
  banner: { shape: 'pennant', poleTop: 'lotus_finial', tassels: false },
  architecture: 'heartland_brick',
  colorblind: { protan: '#bbbbbb', deutan: '#bbbbbb', tritan: '#bbbbbb' },
};

/** Colors for independents and rebels (rebels use a torn lotus-less black-red standard). */
export const NEUTRAL_COLORS: FactionColors = { primary: '#d8cdb5', secondary: '#d98aa6', accent: '#9c3b23' };
export const REBEL_COLORS: FactionColors = { primary: '#3a2a26', secondary: '#c8381f', accent: '#d8cdb5' };

export type ColorblindMode = 'none' | 'protan' | 'deutan' | 'tritan';

export interface FactionVisual extends FactionArt {
  id: FactionId;
  /** Team colors after the colorblind remap (primary replaced; secondary/accent kept). */
  colors: FactionColors;
  bannerPattern: BannerPattern;
}

/** Resolve the full visual identity of a faction id (data colors + art fields + colorblind remap). */
export function factionVisual(id: FactionId, colorblind: ColorblindMode = 'none'): FactionVisual {
  const def = FACTIONS[id];
  if (!def) {
    const colors = id === 'rebels' ? REBEL_COLORS : NEUTRAL_COLORS;
    return { ...NEUTRAL_ART, id, colors, bannerPattern: id === 'rebels' ? 'solid' : 'lotus' };
  }
  const art = FACTION_ART[def.archetype];
  const primary = colorblind === 'none' ? def.colors.primary : art.colorblind[colorblind];
  return { ...art, id, colors: { ...def.colors, primary }, bannerPattern: def.banner };
}

/** Relation styles for selection rings, footprints, minimap and nameplates (shape coding, DESIGN_SPEC §4.6). */
export const RELATION_STYLES = {
  own: { color: ACCENTS.select, ring: 'solid', widthPx: 2.5, dash: [0, 0], spikes: 0 },
  ally: { color: ACCENTS.ally, ring: 'dashed', widthPx: 2.5, dash: [10, 6], spikes: 0 },
  enemy: { color: ACCENTS.enemy, ring: 'spiked', widthPx: 2.5, dash: [0, 0], spikes: 12 },
  neutral: { color: ACCENTS.neutral, ring: 'dotted', widthPx: 2, dash: [2, 6], spikes: 0 },
} as const;

/** Banner and standard dimensions (meters). Strategic zoom multiplies by ZoomLook.readability.bannerScale. */
export const BANNER_DIMENSIONS = {
  infantryStandard: { poleM: 4.2, clothW: 1.1, clothH: 1.6 },
  cavalryStandard: { poleM: 3.2, clothW: 0.9, clothH: 1.2 },
  elephantStandard: { poleM: 2.6, clothW: 1.2, clothH: 1.8 },
  chariotStandard: { poleM: 3.0, clothW: 0.8, clothH: 1.2 },
  buildingBanner: { poleM: 6, clothW: 1.6, clothH: 2.6 },
  landmarkBanner: { poleM: 9, clothW: 2.4, clothH: 4.2 },
  /** Cloth shader: wind response and stiffness (render/fx/banners). */
  cloth: { waveAmp: 0.18, waveFreq: 2.4, waveSpeed: 3.2, stiffnessNearPole: 0.85, sheen: 0.35 },
} as const;

export interface ArchitecturePalette {
  id: ArchitectureStyleId;
  look: string;
  wall: Hex;
  wall2: Hex;
  roof: Hex;
  trim: Hex;
  stone: Hex;
  wood: Hex;
  /** Painted accent (doors, eaves, mandana borders). */
  paint: Hex;
  /** Pipeline material ids (docs/ASSET_LIST.md WP1) used by the kit, in priority order. */
  materials: readonly string[];
  /** Signature pieces the style adds to the shared kit (render/architecture). */
  signature: readonly ArchitectureKind[];
}

/** Architecture-style palettes (keys match FactionDef.architectureStyle). */
export const ARCHITECTURE_STYLES: Readonly<Record<ArchitectureStyleId, ArchitecturePalette>> = {
  heartland_brick: {
    id: 'heartland_brick',
    look: 'Lime-plastered fired brick, terracotta tile roofs, buff sandstone plinths and polished pillars, carved teak verandas.',
    wall: MATERIALS.limeWash,
    wall2: MATERIALS.brick,
    roof: MATERIALS.terracotta,
    trim: MATERIALS.gold,
    stone: MATERIALS.sandstone,
    wood: MATERIALS.teak,
    paint: DYES.saffron,
    materials: ['lime_plaster_weathered', 'brick_fired_old', 'roof_tile_terracotta', 'sandstone_buff', 'sandstone_polished_mauryan', 'timber_teak_carved'],
    signature: ['palace', 'pavilion', 'pillar', 'stupa', 'granary'],
  },
  highland_stone: {
    id: 'highland_stone',
    look: 'Dry-laid granite and basalt, laterite parapets and bastions, flat stone-slab roofs, rock-cut chaitya arches.',
    wall: MATERIALS.granite,
    wall2: MATERIALS.laterite,
    roof: MATERIALS.basalt,
    trim: MATERIALS.bronze,
    stone: MATERIALS.granite,
    wood: MATERIALS.salWood,
    paint: DYES.indigo,
    materials: ['granite_rubble', 'basalt_dressed', 'laterite_block', 'stone_slab_roof', 'timber_sal_weathered'],
    signature: ['fort_wall', 'fort_gate', 'tower', 'stepwell', 'shrine'],
  },
  coastal_timber: {
    id: 'coastal_timber',
    look: 'Whitewashed timber-frame warehouses on brick plinths, palm-thatch and tile roofs, jetties and lamp towers.',
    wall: MATERIALS.limeWash,
    wall2: MATERIALS.teak,
    roof: MATERIALS.terracotta,
    trim: MATERIALS.copper,
    stone: MATERIALS.sandstone,
    wood: MATERIALS.teak,
    paint: '#1c7f8a',
    materials: ['lime_plaster_weathered', 'timber_teak_carved', 'thatch_palm', 'roof_tile_terracotta', 'brick_fired_old'],
    signature: ['harbor_jetty', 'market_stall', 'tower'],
  },
  forest_timber: {
    id: 'forest_timber',
    look: 'Raised sal-timber halls with carved posts, bamboo lattice walls, steep palm-leaf and grass thatch, earthen plinths.',
    wall: MATERIALS.mudPlaster,
    wall2: MATERIALS.salWood,
    roof: MATERIALS.thatch,
    trim: MATERIALS.bronze,
    stone: MATERIALS.laterite,
    wood: MATERIALS.salWood,
    paint: '#3f7f52',
    materials: ['timber_sal_weathered', 'bamboo_lattice', 'thatch_grass', 'thatch_palm', 'mud_plaster'],
    signature: ['palisade', 'stable', 'pavilion'],
  },
  frontier_mud: {
    id: 'frontier_mud',
    look: 'Thick sun-dried mud-brick, flat roofs with parapets, ochre-washed walls with white mandana borders, well-wheels and caravan yards.',
    wall: MATERIALS.mudPlaster,
    wall2: MATERIALS.ochreWash,
    roof: MATERIALS.mudPlaster,
    trim: MATERIALS.terracotta,
    stone: MATERIALS.sandstone,
    wood: MATERIALS.weatheredWood,
    paint: DYES.violetLac,
    materials: ['mud_brick_sundried', 'mud_plaster', 'sandstone_buff', 'timber_weathered_grey'],
    signature: ['well', 'market_stall', 'tower'],
  },
  city_sandstone: {
    id: 'city_sandstone',
    look: 'Red sandstone ashlar walls and gate towers, carved brackets, jali screens, tiled roofs, painted gates.',
    wall: MATERIALS.redSandstone,
    wall2: MATERIALS.sandstone,
    roof: MATERIALS.redSandstone,
    trim: MATERIALS.gold,
    stone: MATERIALS.redSandstone,
    wood: MATERIALS.teak,
    paint: DYES.madder,
    materials: ['sandstone_carved_red', 'sandstone_red_ashlar', 'roof_tile_terracotta', 'timber_teak_carved'],
    signature: ['fort_gate', 'tower', 'mansion', 'workshop'],
  },
};
