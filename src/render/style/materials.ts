/**
 * Surface material presets (PBR parameters) for architecture, props, characters and animals.
 * OWNER: Art Director. Used by render/materials (createPbrMaterial options), procedural fallbacks, and by
 * the Technical Art team as the target for baked texture sets (docs/ASSET_LIST.md WP1).
 *
 * baseColor = average sRGB albedo of the set (fallback color and manifest averageColor target, +-6%).
 * roughness = average; roughnessRange = the 5th..95th percentile the ORM.g channel should span.
 * porosity  = rain response 0..1 (PbrMaterialOptions.porosity): 1 darkens and glosses fully when wet.
 * tileMeters = world meters per texture repeat for tiling sets (trim sheets give band heights instead).
 * Docs: docs/ART_BIBLE.md §8.2 (material library) and §14 (Blender node recipes).
 */
import type { Hex } from './palette';

export interface MaterialPreset {
  id: string;
  label: string;
  /** Pipeline material id when a baked set exists or is planned; null = procedural only. */
  assetId: string | null;
  baseColor: Hex;
  roughness: number;
  roughnessRange: readonly [number, number];
  metalness: number;
  normalScale: number;
  porosity: number;
  tileMeters: number;
  /** Fabric sheen (MeshPhysicalMaterial.sheen*). */
  sheen?: { color: Hex; roughness: number; intensity: number };
  /** Thin-surface transmission / subsurface approximation (leaves, skin, wax, thin cloth). */
  subsurface?: { color: Hex; strength: number };
  /** Clearcoat for Mauryan polish, lacquer and wet glaze. */
  clearcoat?: { strength: number; roughness: number };
  /** Multiplier on scene IBL for this surface (cavity-heavy carving < 1). */
  envMapIntensity?: number;
  notes: string;
}

const P = (p: MaterialPreset): MaterialPreset => p;

export const MATERIAL_PRESETS = {
  // ------------------------------------------------------------------------------------ stone
  sandstone_carved_red: P({ id: 'sandstone_carved_red', label: 'Carved red sandstone (trim sheet)', assetId: 'sandstone_carved_red', baseColor: '#a8644c', roughness: 0.78, roughnessRange: [0.62, 0.92], metalness: 0, normalScale: 1, porosity: 0.8, tileMeters: 2, envMapIntensity: 0.9, notes: 'Exists (2 m sheet). Retune: -12% saturation, per-block hue jitter +-3%, lichen and soot in lower 0.6 m via macro map.' }),
  sandstone_red_ashlar: P({ id: 'sandstone_red_ashlar', label: 'Red sandstone ashlar (plain)', assetId: 'sandstone_red_ashlar', baseColor: '#a46450', roughness: 0.8, roughnessRange: [0.66, 0.92], metalness: 0, normalScale: 0.8, porosity: 0.8, tileMeters: 3, notes: 'City-state walls and gates. 0.45 x 0.9 m blocks, 4 mm joints, iron-oxide spotting (Sikri type).' }),
  sandstone_buff: P({ id: 'sandstone_buff', label: 'Buff sandstone (Sanchi/Chunar)', assetId: 'sandstone_buff', baseColor: '#c2a985', roughness: 0.76, roughnessRange: [0.6, 0.9], metalness: 0, normalScale: 0.9, porosity: 0.75, tileMeters: 2, notes: 'Default heartland stone: stupas, ghats, plinths, toranas. Grey-buff with faint pink banding and black lichen.' }),
  sandstone_polished_mauryan: P({ id: 'sandstone_polished_mauryan', label: 'Mauryan polished sandstone', assetId: 'sandstone_polished_mauryan', baseColor: '#cdbb9a', roughness: 0.18, roughnessRange: [0.1, 0.32], metalness: 0, normalScale: 0.25, porosity: 0.15, tileMeters: 2, clearcoat: { strength: 0.6, roughness: 0.12 }, notes: 'Mirror polish of monolithic pillars and capitals: a signature of the empire. Faint speckle, no joints; dust only on horizontal ledges.' }),
  granite_rubble: P({ id: 'granite_rubble', label: 'Granite rubble masonry', assetId: 'granite_rubble', baseColor: '#8a8680', roughness: 0.82, roughnessRange: [0.7, 0.95], metalness: 0, normalScale: 1.2, porosity: 0.4, tileMeters: 3, notes: 'Deccan hill forts: irregular dry-laid blocks 0.3-0.9 m, deep dark joints, orange lichen on upward faces.' }),
  basalt_dressed: P({ id: 'basalt_dressed', label: 'Dressed basalt (rock-cut)', assetId: 'basalt_dressed', baseColor: '#57534f', roughness: 0.7, roughnessRange: [0.5, 0.88], metalness: 0, normalScale: 0.9, porosity: 0.5, tileMeters: 3, notes: 'Chaitya arches and highland gates: chisel-dressed dark basalt, smoother where hands touch, white salt bloom at the base.' }),
  laterite_block: P({ id: 'laterite_block', label: 'Laterite block', assetId: 'laterite_block', baseColor: '#8f4a34', roughness: 0.9, roughnessRange: [0.8, 0.98], metalness: 0, normalScale: 1.3, porosity: 0.9, tileMeters: 2, notes: 'Pitted vesicular red-brown blocks 0.6 x 0.3 m: parapets, bastions, southern walls.' }),
  stone_slab_roof: P({ id: 'stone_slab_roof', label: 'Stone slab roof', assetId: 'stone_slab_roof', baseColor: '#7c7770', roughness: 0.85, roughnessRange: [0.72, 0.95], metalness: 0, normalScale: 1, porosity: 0.5, tileMeters: 3, notes: 'Overlapping granite slabs on highland houses; moss in overlaps.' }),
  // ------------------------------------------------------------------------------------ earth, plaster, brick
  lime_plaster_weathered: P({ id: 'lime_plaster_weathered', label: 'Weathered lime plaster', assetId: 'lime_plaster_weathered', baseColor: '#e4dac6', roughness: 0.86, roughnessRange: [0.75, 0.95], metalness: 0, normalScale: 0.6, porosity: 0.85, tileMeters: 3, notes: 'Never pure white: warm off-white with rain streaks, rising damp (0-0.8 m darker, green-grey), patches revealing brick (5-12%).' }),
  mud_plaster: P({ id: 'mud_plaster', label: 'Mud & cow-dung plaster', assetId: 'mud_plaster', baseColor: '#a8835f', roughness: 0.94, roughnessRange: [0.86, 1], metalness: 0, normalScale: 0.8, porosity: 1, tileMeters: 2.5, notes: 'Hand-smoothed swirls (finger arcs 0.2 m), straw fibres, cracks; ochre/white mandana borders as decals.' }),
  mud_brick_sundried: P({ id: 'mud_brick_sundried', label: 'Sun-dried mud brick', assetId: 'mud_brick_sundried', baseColor: '#a88866', roughness: 0.95, roughnessRange: [0.88, 1], metalness: 0, normalScale: 1.1, porosity: 1, tileMeters: 2, notes: '0.4 x 0.2 x 0.1 m bricks, eroded arrises, mud mortar flush; frontier and village walls.' }),
  brick_fired_old: P({ id: 'brick_fired_old', label: 'Fired brick, aged', assetId: 'brick_fired_old', baseColor: '#9c5a40', roughness: 0.84, roughnessRange: [0.7, 0.95], metalness: 0, normalScale: 1, porosity: 0.8, tileMeters: 2, notes: 'Large period bricks 0.42 x 0.26 x 0.07 m (wide, flat), lime mortar 8 mm, efflorescence and soot near the ground.' }),
  roof_tile_terracotta: P({ id: 'roof_tile_terracotta', label: 'Terracotta roof tiles', assetId: 'roof_tile_terracotta', baseColor: '#a65a3c', roughness: 0.72, roughnessRange: [0.55, 0.88], metalness: 0, normalScale: 1.2, porosity: 0.7, tileMeters: 2, notes: 'Flat grooved tiles with hooked lips (not curved Mediterranean pan tiles), lichen in rows, broken tiles 3%.' }),
  thatch_grass: P({ id: 'thatch_grass', label: 'Grass/straw thatch', assetId: 'thatch_grass', baseColor: '#a8935e', roughness: 0.96, roughnessRange: [0.9, 1], metalness: 0, normalScale: 1.4, porosity: 0.9, tileMeters: 2, notes: 'Combed bundles 0.25 m, bound with rope bands every 0.6 m; ages to grey #857a62 on the weather side.' }),
  thatch_palm: P({ id: 'thatch_palm', label: 'Palm-leaf thatch', assetId: 'thatch_palm', baseColor: '#9c8a5c', roughness: 0.9, roughnessRange: [0.8, 0.98], metalness: 0, normalScale: 1.2, porosity: 0.8, tileMeters: 2, notes: 'Overlapping woven fronds (coast, forest); shingle rhythm 0.3 m, dark gaps.' }),
  // ------------------------------------------------------------------------------------ timber, bamboo
  timber_teak_carved: P({ id: 'timber_teak_carved', label: 'Carved teak (trim sheet)', assetId: 'timber_teak_carved', baseColor: '#6b4a2e', roughness: 0.62, roughnessRange: [0.45, 0.8], metalness: 0, normalScale: 1, porosity: 0.5, tileMeters: 2, notes: 'Trim bands: plain beam, lotus bracket, bead row, creeper scroll, column shaft with bell capital; oiled sheen on worn edges.' }),
  timber_sal_weathered: P({ id: 'timber_sal_weathered', label: 'Weathered sal timber', assetId: 'timber_sal_weathered', baseColor: '#5e4631', roughness: 0.8, roughnessRange: [0.65, 0.92], metalness: 0, normalScale: 1.1, porosity: 0.7, tileMeters: 2, notes: 'Palisades, forest halls, scaffolds: adze marks, open grain, silvering on the weather side.' }),
  timber_weathered_grey: P({ id: 'timber_weathered_grey', label: 'Sun-bleached grey timber', assetId: 'timber_weathered_grey', baseColor: '#80776a', roughness: 0.88, roughnessRange: [0.78, 0.96], metalness: 0, normalScale: 1.2, porosity: 0.8, tileMeters: 2, notes: 'Frontier doors, carts, old jetties: split checks, nail-free pegged joints.' }),
  bamboo_lattice: P({ id: 'bamboo_lattice', label: 'Bamboo poles & lattice', assetId: 'bamboo_lattice', baseColor: '#b39a63', roughness: 0.55, roughnessRange: [0.4, 0.75], metalness: 0, normalScale: 0.8, porosity: 0.4, tileMeters: 1.5, notes: 'Scaffolds (lashed with coir rope), fences, walls; nodes every 0.3-0.4 m, glossy skin, split lath variant.' }),
  // ------------------------------------------------------------------------------------ metal, paint, fabric
  gold_leaf: P({ id: 'gold_leaf', label: 'Gold leaf on lacquer', assetId: null, baseColor: '#e0b54a', roughness: 0.28, roughnessRange: [0.18, 0.45], metalness: 1, normalScale: 0.4, porosity: 0, tileMeters: 1, notes: 'Finials (kalasha), howdah fittings, royal shields. Rubbed through to red bole on edges; use sparingly (<1% of frame).' }),
  bronze_aged: P({ id: 'bronze_aged', label: 'Aged bronze', assetId: null, baseColor: '#8c6a45', roughness: 0.45, roughnessRange: [0.3, 0.7], metalness: 1, normalScale: 0.5, porosity: 0, tileMeters: 1, notes: 'Lamps, bells, vessels, helmets: polished highs, dark brown-green cavities (no bright verdigris).' }),
  iron_forged: P({ id: 'iron_forged', label: 'Forged iron', assetId: null, baseColor: '#5a5754', roughness: 0.55, roughnessRange: [0.35, 0.8], metalness: 1, normalScale: 0.6, porosity: 0.1, tileMeters: 1, notes: 'Blades, spear points, scale armor: hammer facets, bright edge bevel, rust only in pits.' }),
  copper_vessel: P({ id: 'copper_vessel', label: 'Copper vessels', assetId: null, baseColor: '#c27a52', roughness: 0.35, roughnessRange: [0.22, 0.6], metalness: 1, normalScale: 0.4, porosity: 0, tileMeters: 1, notes: 'Water pots (lota), market wares; darker tarnish where hands do not polish it.' }),
  lacquer_red: P({ id: 'lacquer_red', label: 'Lac-red painted wood', assetId: null, baseColor: '#7d2420', roughness: 0.4, roughnessRange: [0.3, 0.6], metalness: 0, normalScale: 0.3, porosity: 0.2, tileMeters: 1, clearcoat: { strength: 0.4, roughness: 0.3 }, notes: 'Chariots, palanquins, palace doors; worn to wood on edges.' }),
  cotton_undyed: P({ id: 'cotton_undyed', label: 'Undyed cotton (dhoti, uttariya)', assetId: 'cloth_cotton', baseColor: '#d9cdb3', roughness: 0.92, roughnessRange: [0.85, 1], metalness: 0, normalScale: 0.6, porosity: 0.9, tileMeters: 0.5, sheen: { color: '#f2ead8', roughness: 0.6, intensity: 0.4 }, subsurface: { color: '#e8dcc2', strength: 0.15 }, notes: 'Hand-spun weave visible only in hero mode; dirt gradient on hems.' }),
  cotton_dyed_team: P({ id: 'cotton_dyed_team', label: 'Team-dyed cotton (mask)', assetId: 'cloth_cotton', baseColor: '#d9772a', roughness: 0.9, roughnessRange: [0.82, 0.98], metalness: 0, normalScale: 0.6, porosity: 0.9, tileMeters: 0.5, sheen: { color: '#ffffff', roughness: 0.6, intensity: 0.3 }, notes: 'Team color = FactionArt.clothDye x mask; uneven natural dyeing (+-6% value) so armies do not look plastic.' }),
  silk_court: P({ id: 'silk_court', label: 'Court silk', assetId: 'cloth_silk', baseColor: '#b0482c', roughness: 0.42, roughnessRange: [0.3, 0.6], metalness: 0, normalScale: 0.4, porosity: 0.6, tileMeters: 0.5, sheen: { color: '#ffd9a8', roughness: 0.35, intensity: 0.9 }, notes: 'Nobles and the hero: woven gold borders (zari-like bands via trim), anisotropic look approximated with sheen.' }),
  leather_tanned: P({ id: 'leather_tanned', label: 'Tanned leather', assetId: null, baseColor: '#7a5236', roughness: 0.62, roughnessRange: [0.45, 0.8], metalness: 0, normalScale: 0.7, porosity: 0.5, tileMeters: 0.5, notes: 'Belts, quivers, shield rims, horse tack; darker and glossier where handled.' }),
  hide_shield: P({ id: 'hide_shield', label: 'Painted hide shield', assetId: null, baseColor: '#9c6b44', roughness: 0.7, roughnessRange: [0.55, 0.85], metalness: 0, normalScale: 0.8, porosity: 0.6, tileMeters: 1, notes: 'Tall bamboo-framed hide; painted faction emblem (emblems.ts) with chipped paint, never a clean decal.' }),
  // ------------------------------------------------------------------------------------ bodies
  skin: P({ id: 'skin', label: 'Skin', assetId: null, baseColor: '#9a6a4c', roughness: 0.55, roughnessRange: [0.4, 0.7], metalness: 0, normalScale: 0.6, porosity: 0.3, tileMeters: 1, subsurface: { color: '#c0503a', strength: 0.45 }, notes: 'Tone from palette SKIN_TONES; sweat sheen +0.15 gloss in grishma and battle; sandal paste / ash marks only on priests.' }),
  elephant_skin: P({ id: 'elephant_skin', label: 'Elephant skin', assetId: 'elephant_skin', baseColor: '#6e6660', roughness: 0.82, roughnessRange: [0.7, 0.95], metalness: 0, normalScale: 1.4, porosity: 0.8, tileMeters: 1, notes: 'Deep wrinkle normal, pink depigmentation freckles on the trunk and ears, mud-caked legs (lower 0.8 m warmer, rougher).' }),
  horse_coat: P({ id: 'horse_coat', label: 'Horse coat', assetId: 'horse_coat', baseColor: '#6a4a33', roughness: 0.5, roughnessRange: [0.4, 0.65], metalness: 0, normalScale: 0.5, porosity: 0.4, tileMeters: 1, sheen: { color: '#c09a78', roughness: 0.5, intensity: 0.5 }, notes: 'Variants bay #6a4a33, chestnut #8a4f2c, grey #a8a39c, black #2a2421, dun #a88a5e; darker points (legs, mane).' }),
  ox_hide: P({ id: 'ox_hide', label: 'Zebu ox', assetId: 'horse_coat', baseColor: '#b8ad9c', roughness: 0.65, roughnessRange: [0.5, 0.8], metalness: 0, normalScale: 0.6, porosity: 0.5, tileMeters: 1, notes: 'White-grey zebu with darker hump and neck; painted horns (ochre/indigo) for festive carts.' }),
} as const satisfies Record<string, MaterialPreset>;

export type MaterialPresetId = keyof typeof MATERIAL_PRESETS;
