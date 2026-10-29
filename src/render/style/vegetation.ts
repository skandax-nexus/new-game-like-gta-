/**
 * Vegetation and crops: species looks, seasonal colors, flowering, wind response and LOD rules.
 * OWNER: Art Director. Consumed by render/environment/vegetation.ts (Lead Graphics) and the vegetation
 * work package (docs/ASSET_LIST.md WP4). Rationale and modeling recipes: docs/ART_BIBLE.md §7.
 *
 * Historical care: only plants present in the subcontinent c. 300 BCE. Never show maize, chilli, potato,
 * tomato, tobacco, cashew, papaya, guava, pineapple, cacti/agave/prickly pear, marigold (Tagetes),
 * eucalyptus, lantana, gulmohar (Delonix), jacaranda, casuarina or tea gardens (see BANNED_PLANTS).
 */
import type { Season } from '../../core/types';
import type { Hex } from './palette';

export type GeoZone = 'northern_plains' | 'western_frontier' | 'deccan_plateau' | 'eastern_forests' | 'southern_peninsula';

export interface WindResponse {
  /** Trunk bend at the crown (radians) at full wind (WeatherState.windSpeed >= 12 m/s). */
  trunkAmp: number;
  trunkFreqHz: number;
  /** Branch sway (m at branch tips) and frequency. */
  branchAmp: number;
  branchFreqHz: number;
  /** Leaf flutter (m) and frequency - high for peepal (constantly trembling leaves). */
  leafAmp: number;
  leafHz: number;
}

export interface TreeSpecies {
  id: string;
  label: string;
  botanical: string;
  zones: readonly GeoZone[];
  heightM: readonly [number, number];
  crownDiameterM: readonly [number, number];
  trunk: { diameterM: number; bark: Hex; notes: string };
  /** Leaf albedo per season (sRGB; leaf cards are two-sided with subsurface). */
  leaf: Readonly<Record<Season, Hex>>;
  /** Fraction of foliage present per season (deciduous species drop leaves in grishma). */
  foliage: Readonly<Record<Season, number>>;
  flowering: { seasons: readonly Season[]; color: Hex; coverage: number } | null;
  wind: WindResponse;
  /** Silhouette description the impostor must preserve. */
  silhouette: string;
  /** Triangles per LOD (LOD0 hero, LOD1 near, LOD2 mid); LOD3 = octahedral impostor. */
  tris: readonly [number, number, number];
  /** Leaf-card atlas resolution (ultra / high / mobile) - shared atlas pages, see ASSET_LIST WP4. */
  atlasPx: readonly [number, number, number];
}

const evergreen = { vasanta: 1, grishma: 0.95, varsha: 1, sharad: 1, hemanta: 1, shishira: 1 } as const;

export const TREE_SPECIES: Readonly<Record<string, TreeSpecies>> = {
  banyan: {
    id: 'banyan', label: 'Banyan', botanical: 'Ficus benghalensis', zones: ['northern_plains', 'deccan_plateau', 'eastern_forests', 'southern_peninsula'],
    heightM: [14, 22], crownDiameterM: [28, 50],
    trunk: { diameterM: 2.4, bark: '#7d7466', notes: 'Fused buttress trunk plus 6-20 pillar prop-roots and hanging aerial-root curtains (alpha cards).' },
    leaf: { vasanta: '#46602e', grishma: '#4f6232', varsha: '#3a5a2a', sharad: '#3d5c2b', hemanta: '#445e2e', shishira: '#47602f' },
    foliage: evergreen, flowering: null,
    wind: { trunkAmp: 0.004, trunkFreqHz: 0.15, branchAmp: 0.12, branchFreqHz: 0.35, leafAmp: 0.02, leafHz: 2.2 },
    silhouette: 'Very wide low dome, flat underside 4-6 m above ground, dark interior; village meeting tree with a stone platform (chabutra).',
    tris: [16000, 4500, 900], atlasPx: [2048, 1024, 512],
  },
  peepal: {
    id: 'peepal', label: 'Peepal', botanical: 'Ficus religiosa', zones: ['northern_plains', 'deccan_plateau', 'eastern_forests', 'southern_peninsula'],
    heightM: [14, 24], crownDiameterM: [14, 24],
    trunk: { diameterM: 1.6, bark: '#8a8276', notes: 'Smooth grey fluted trunk; sacred ones carry red threads and a railing (vedika).' },
    leaf: { vasanta: '#8a6a3e', grishma: '#55703a', varsha: '#4a6a30', sharad: '#4b6a31', hemanta: '#53703a', shishira: '#5a7340' },
    foliage: { vasanta: 0.75, grishma: 1, varsha: 1, sharad: 1, hemanta: 1, shishira: 0.95 },
    flowering: null,
    wind: { trunkAmp: 0.006, trunkFreqHz: 0.18, branchAmp: 0.14, branchFreqHz: 0.4, leafAmp: 0.05, leafHz: 4.5 },
    silhouette: 'Tall open irregular crown, light through gaps; heart-shaped leaves with drip tips that tremble in the lightest wind; copper-pink new leaves in vasanta.',
    tris: [14000, 4000, 800], atlasPx: [2048, 1024, 512],
  },
  neem: {
    id: 'neem', label: 'Neem', botanical: 'Azadirachta indica', zones: ['northern_plains', 'western_frontier', 'deccan_plateau', 'southern_peninsula'],
    heightM: [10, 16], crownDiameterM: [9, 14],
    trunk: { diameterM: 0.8, bark: '#5a4a3c', notes: 'Dark furrowed bark, short trunk forking low.' },
    leaf: { vasanta: '#6a8a3c', grishma: '#5f7c37', varsha: '#4f7330', sharad: '#517431', hemanta: '#587835', shishira: '#5c7a38' },
    foliage: { vasanta: 1, grishma: 0.9, varsha: 1, sharad: 1, hemanta: 1, shishira: 0.85 },
    flowering: { seasons: ['vasanta'], color: '#e8e2c8', coverage: 0.15 },
    wind: { trunkAmp: 0.008, trunkFreqHz: 0.22, branchAmp: 0.16, branchFreqHz: 0.5, leafAmp: 0.03, leafHz: 3 },
    silhouette: 'Rounded open crown of fine feathery leaflets, brighter green than mango; lines streets and courtyards.',
    tris: [9000, 2800, 600], atlasPx: [1024, 1024, 512],
  },
  sal: {
    id: 'sal', label: 'Sal', botanical: 'Shorea robusta', zones: ['eastern_forests', 'northern_plains'],
    heightM: [22, 34], crownDiameterM: [8, 13],
    trunk: { diameterM: 0.9, bark: '#4f4033', notes: 'Straight clear bole to 15-20 m, deeply fissured dark bark - forest columns for light shafts.' },
    leaf: { vasanta: '#9aa04e', grishma: '#7a7a3a', varsha: '#3f5f2a', sharad: '#41612b', hemanta: '#4f6a30', shishira: '#7d7a42' },
    foliage: { vasanta: 0.85, grishma: 0.7, varsha: 1, sharad: 1, hemanta: 1, shishira: 0.8 },
    flowering: { seasons: ['vasanta'], color: '#e3dcb0', coverage: 0.2 },
    wind: { trunkAmp: 0.003, trunkFreqHz: 0.12, branchAmp: 0.1, branchFreqHz: 0.3, leafAmp: 0.025, leafHz: 2 },
    silhouette: 'Tall columnar trunks with a high narrow crown; forests read as vertical rhythm with a canopy roof 25-30 m up.',
    tris: [10000, 3000, 600], atlasPx: [1024, 1024, 512],
  },
  teak: {
    id: 'teak', label: 'Teak', botanical: 'Tectona grandis', zones: ['deccan_plateau', 'eastern_forests'],
    heightM: [18, 28], crownDiameterM: [8, 12],
    trunk: { diameterM: 0.7, bark: '#7a6a58', notes: 'Light grey-brown fibrous bark, fluted base.' },
    leaf: { vasanta: '#8a7e45', grishma: '#8c6a3a', varsha: '#4d6b30', sharad: '#557334', hemanta: '#6f7438', shishira: '#8a7840' },
    foliage: { vasanta: 0.5, grishma: 0.15, varsha: 1, sharad: 1, hemanta: 0.8, shishira: 0.55 },
    flowering: { seasons: ['varsha'], color: '#ece6d2', coverage: 0.25 },
    wind: { trunkAmp: 0.005, trunkFreqHz: 0.16, branchAmp: 0.14, branchFreqHz: 0.38, leafAmp: 0.05, leafHz: 1.6 },
    silhouette: 'Huge leaves (40-60 cm) on an open crown; bare and brown in grishma, white flower plumes in the monsoon.',
    tris: [8000, 2500, 500], atlasPx: [1024, 1024, 512],
  },
  mango: {
    id: 'mango', label: 'Mango', botanical: 'Mangifera indica', zones: ['northern_plains', 'eastern_forests', 'southern_peninsula'],
    heightM: [9, 15], crownDiameterM: [11, 18],
    trunk: { diameterM: 0.9, bark: '#4a3c30', notes: 'Dark thick trunk, low heavy limbs.' },
    leaf: { vasanta: '#3a5428', grishma: '#33502a', varsha: '#2f4c26', sharad: '#304d27', hemanta: '#334f28', shishira: '#3a5a2e' },
    foliage: evergreen,
    flowering: { seasons: ['shishira', 'vasanta'], color: '#b9a35a', coverage: 0.3 },
    wind: { trunkAmp: 0.004, trunkFreqHz: 0.18, branchAmp: 0.1, branchFreqHz: 0.4, leafAmp: 0.02, leafHz: 2 },
    silhouette: 'Dense dark dome to the ground; planted in orderly groves (amrakuta) beside villages - deep pools of shade. New flushes copper-red.',
    tris: [10000, 3000, 600], atlasPx: [1024, 1024, 512],
  },
  palmyra: {
    id: 'palmyra', label: 'Palmyra palm', botanical: 'Borassus flabellifer', zones: ['northern_plains', 'deccan_plateau', 'southern_peninsula'],
    heightM: [15, 25], crownDiameterM: [5, 7],
    trunk: { diameterM: 0.6, bark: '#3e3934', notes: 'Black straight trunk, leaf-base scars on the upper third.' },
    leaf: { vasanta: '#4e6640', grishma: '#5a6c45', varsha: '#465f3a', sharad: '#47603b', hemanta: '#4d6540', shishira: '#506842' },
    foliage: evergreen, flowering: null,
    wind: { trunkAmp: 0.01, trunkFreqHz: 0.2, branchAmp: 0.3, branchFreqHz: 0.6, leafAmp: 0.06, leafHz: 2.5 },
    silhouette: 'Tall black pole with a tight ball of stiff fan leaves - exclamation marks along field bunds and tanks.',
    tris: [3500, 1200, 300], atlasPx: [1024, 512, 256],
  },
  coconut: {
    id: 'coconut', label: 'Coconut palm', botanical: 'Cocos nucifera', zones: ['southern_peninsula'],
    heightM: [12, 22], crownDiameterM: [7, 10],
    trunk: { diameterM: 0.4, bark: '#7a6e60', notes: 'Curved grey ringed trunk leaning toward light/water.' },
    leaf: { vasanta: '#5c7a38', grishma: '#647a3c', varsha: '#527234', sharad: '#547435', hemanta: '#587638', shishira: '#5c783a' },
    foliage: evergreen, flowering: null,
    wind: { trunkAmp: 0.015, trunkFreqHz: 0.2, branchAmp: 0.45, branchFreqHz: 0.55, leafAmp: 0.08, leafHz: 3 },
    silhouette: 'Curved trunk, drooping feather fronds; coast and river mouth only (Naukapattana).',
    tris: [3500, 1200, 300], atlasPx: [1024, 512, 256],
  },
  date_palm: {
    id: 'date_palm', label: 'Wild date palm', botanical: 'Phoenix sylvestris', zones: ['western_frontier', 'northern_plains'],
    heightM: [8, 14], crownDiameterM: [5, 8],
    trunk: { diameterM: 0.45, bark: '#6e5f4e', notes: 'Rough diamond-patterned leaf bases.' },
    leaf: { vasanta: '#6a7a4c', grishma: '#727a50', varsha: '#5f7446', sharad: '#607547', hemanta: '#66784a', shishira: '#6a7a4c' },
    foliage: evergreen, flowering: null,
    wind: { trunkAmp: 0.012, trunkFreqHz: 0.22, branchAmp: 0.35, branchFreqHz: 0.6, leafAmp: 0.06, leafHz: 2.8 },
    silhouette: 'Shorter palm with a dense dusty grey-green fan of feather fronds; wells and caravan stops.',
    tris: [3000, 1000, 300], atlasPx: [1024, 512, 256],
  },
  babul: {
    id: 'babul', label: 'Babul (thorn acacia)', botanical: 'Vachellia nilotica', zones: ['western_frontier', 'deccan_plateau', 'northern_plains'],
    heightM: [5, 10], crownDiameterM: [6, 10],
    trunk: { diameterM: 0.35, bark: '#3a302a', notes: 'Black cracked bark, twisted trunk.' },
    leaf: { vasanta: '#6b7a44', grishma: '#7d7e4c', varsha: '#566e3a', sharad: '#5a713c', hemanta: '#647543', shishira: '#6b7a46' },
    foliage: { vasanta: 1, grishma: 0.8, varsha: 1, sharad: 1, hemanta: 1, shishira: 0.9 },
    flowering: { seasons: ['varsha', 'sharad'], color: '#e8c33a', coverage: 0.2 },
    wind: { trunkAmp: 0.006, trunkFreqHz: 0.25, branchAmp: 0.12, branchFreqHz: 0.6, leafAmp: 0.02, leafHz: 3 },
    silhouette: 'Flat-topped umbrella of fine foliage on a dark twisted trunk - the frontier and scrub silhouette.',
    tris: [6000, 1800, 400], atlasPx: [1024, 512, 256],
  },
  palash: {
    id: 'palash', label: 'Palash (flame of the forest)', botanical: 'Butea monosperma', zones: ['deccan_plateau', 'eastern_forests', 'northern_plains'],
    heightM: [7, 12], crownDiameterM: [6, 9],
    trunk: { diameterM: 0.4, bark: '#5d5146', notes: 'Crooked trunk and branches.' },
    leaf: { vasanta: '#6e6a3a', grishma: '#6d7a3e', varsha: '#4d6b30', sharad: '#4f6c31', hemanta: '#6d7038', shishira: '#7d7440' },
    foliage: { vasanta: 0.1, grishma: 0.7, varsha: 1, sharad: 1, hemanta: 0.8, shishira: 0.35 },
    flowering: { seasons: ['vasanta'], color: '#e2571e', coverage: 0.85 },
    wind: { trunkAmp: 0.006, trunkFreqHz: 0.24, branchAmp: 0.12, branchFreqHz: 0.5, leafAmp: 0.04, leafHz: 2 },
    silhouette: 'Leafless crooked crowns blazing orange-red in spring - the strongest seasonal accent of the forest edge (use as 3-6% of trees).',
    tris: [6000, 1800, 400], atlasPx: [1024, 512, 256],
  },
  amaltas: {
    id: 'amaltas', label: 'Amaltas (golden shower)', botanical: 'Cassia fistula', zones: ['northern_plains', 'deccan_plateau', 'eastern_forests', 'southern_peninsula'],
    heightM: [8, 14], crownDiameterM: [6, 10],
    trunk: { diameterM: 0.4, bark: '#6e6458', notes: 'Smooth grey trunk.' },
    leaf: { vasanta: '#5f7a38', grishma: '#7a8a3e', varsha: '#4d6d2f', sharad: '#4f6e30', hemanta: '#587234', shishira: '#5e7638' },
    foliage: { vasanta: 0.8, grishma: 0.6, varsha: 1, sharad: 1, hemanta: 1, shishira: 0.85 },
    flowering: { seasons: ['grishma'], color: '#f0c42e', coverage: 0.7 },
    wind: { trunkAmp: 0.007, trunkFreqHz: 0.22, branchAmp: 0.14, branchFreqHz: 0.5, leafAmp: 0.04, leafHz: 2.4 },
    silhouette: 'Hanging chains of yellow flowers in the hottest month - palace gardens, temple precincts.',
    tris: [6000, 1800, 400], atlasPx: [1024, 512, 256],
  },
  bamboo: {
    id: 'bamboo', label: 'Bamboo clump', botanical: 'Dendrocalamus strictus / Bambusa', zones: ['eastern_forests', 'deccan_plateau', 'southern_peninsula'],
    heightM: [9, 16], crownDiameterM: [5, 9],
    trunk: { diameterM: 0.08, bark: '#8a8a4a', notes: '30-80 culms per clump, nodes every 0.3 m, arching tops.' },
    leaf: { vasanta: '#8a9a50', grishma: '#a0a05a', varsha: '#5c7a3a', sharad: '#5f7c3c', hemanta: '#73833f', shishira: '#869048' },
    foliage: { vasanta: 0.9, grishma: 0.7, varsha: 1, sharad: 1, hemanta: 1, shishira: 0.9 },
    flowering: null,
    wind: { trunkAmp: 0.03, trunkFreqHz: 0.3, branchAmp: 0.4, branchFreqHz: 0.7, leafAmp: 0.05, leafHz: 3.5 },
    silhouette: 'Fountain of arching culms, feathery and light; strongest wind motion of all species; creaks (audio).',
    tris: [7000, 2200, 500], atlasPx: [1024, 512, 256],
  },
};

export interface GroundPlant {
  id: string;
  label: string;
  botanical: string;
  heightM: readonly [number, number];
  color: Readonly<Record<Season, Hex>>;
  /** Bend at full wind (radians) - grass fields show traveling wind waves. */
  windBend: number;
  notes: string;
}

export const GROUND_PLANTS: Readonly<Record<string, GroundPlant>> = {
  doob_grass: { id: 'doob_grass', label: 'Doob grass', botanical: 'Cynodon dactylon', heightM: [0.08, 0.25], color: { vasanta: '#6f7f43', grishma: '#9a8f5c', varsha: '#566d34', sharad: '#5a7036', hemanta: '#6c7a42', shishira: '#727c48' }, windBend: 0.35, notes: 'GPU grass field: 3-blade clumps, 6-10 cm wide cards; base darker (AO) and tips lighter.' },
  kash_grass: { id: 'kash_grass', label: 'Kash grass (white plumes)', botanical: 'Saccharum spontaneum', heightM: [1.5, 3], color: { vasanta: '#8a8a52', grishma: '#a8986a', varsha: '#5f7a3c', sharad: '#e8e4da', hemanta: '#cfc6b0', shishira: '#a89e7c' }, windBend: 0.5, notes: 'Riverbank and sandbank stands; silver-white plumes in sharad that glow in backlight - signature autumn image.' },
  reeds: { id: 'reeds', label: 'Reeds & bulrush', botanical: 'Phragmites / Typha', heightM: [1.2, 2.5], color: { vasanta: '#6f7a40', grishma: '#8a8450', varsha: '#55703a', sharad: '#5c743c', hemanta: '#7a7a48', shishira: '#857f50' }, windBend: 0.45, notes: 'Shallow water < 0.6 m and marsh; brown seed heads.' },
  lotus: { id: 'lotus', label: 'Lotus', botanical: 'Nelumbo nucifera', heightM: [0.1, 1.2], color: { vasanta: '#4f6b3a', grishma: '#55703c', varsha: '#4a6a36', sharad: '#4c6b37', hemanta: '#5a6e3e', shishira: '#66704a' }, windBend: 0.2, notes: 'Pads (0.4-0.8 m) flat on tanks and stepwells, pink #e08aa8 / white flowers held above water in varsha-sharad.' },
  aak: { id: 'aak', label: 'Aak (milkweed)', botanical: 'Calotropis procera', heightM: [1, 2.5], color: { vasanta: '#8a9a80', grishma: '#8e9c84', varsha: '#7f947a', sharad: '#82967c', hemanta: '#879a80', shishira: '#8a9a82' }, windBend: 0.1, notes: 'Waxy grey-green shrub of wasteland and roadsides, lilac flowers.' },
  ber_scrub: { id: 'ber_scrub', label: 'Ber thorn scrub', botanical: 'Ziziphus mauritiana', heightM: [1.5, 4], color: { vasanta: '#6a7444', grishma: '#7a7a4c', varsha: '#566b3a', sharad: '#5a6d3c', hemanta: '#647042', shishira: '#6a7446' }, windBend: 0.15, notes: 'Thorny bushes used as field hedges and fort glacis thorn belts.' },
};

export interface CropDef {
  id: string;
  label: string;
  botanical: string;
  /** Plant height (m) at maturity. */
  heightM: number;
  /** Row spacing (m) and plant spacing. */
  rowM: number;
  /** Visual state per season: color and growth 0..1 (0 = bare/ploughed, -1 = flooded paddy, 1 = mature). */
  states: Readonly<Record<Season, { color: Hex; growth: number }>>;
  notes: string;
}

export const CROPS: Readonly<Record<string, CropDef>> = {
  rice: { id: 'rice', label: 'Rice (kharif)', botanical: 'Oryza sativa', heightM: 1.0, rowM: 0.25, states: { vasanta: { color: '#7e6a50', growth: 0 }, grishma: { color: '#8a7456', growth: 0 }, varsha: { color: '#7fa043', growth: -1 }, sharad: { color: '#b8a24e', growth: 1 }, hemanta: { color: '#a8945c', growth: 0.15 }, shishira: { color: '#7e6a50', growth: 0 } }, notes: 'Flooded paddies with bright seedling rows in varsha (reflections!), gold heads in sharad, stubble and straw stacks in hemanta.' },
  wheat: { id: 'wheat', label: 'Wheat (rabi)', botanical: 'Triticum aestivum', heightM: 0.9, rowM: 0.2, states: { vasanta: { color: '#c9a75a', growth: 1 }, grishma: { color: '#a8946a', growth: 0.1 }, varsha: { color: '#6d7a42', growth: 0 }, sharad: { color: '#7e6a50', growth: 0 }, hemanta: { color: '#7d8a46', growth: 0.25 }, shishira: { color: '#6f8a40', growth: 0.65 } }, notes: 'Blue-green in shishira, gold waves in vasanta (wind waves read strongly), sheaves and threshing at harvest.' },
  barley: { id: 'barley', label: 'Barley (rabi)', botanical: 'Hordeum vulgare', heightM: 0.8, rowM: 0.2, states: { vasanta: { color: '#c4ae6a', growth: 1 }, grishma: { color: '#a8946a', growth: 0.1 }, varsha: { color: '#6d7a42', growth: 0 }, sharad: { color: '#7e6a50', growth: 0 }, hemanta: { color: '#7a8a48', growth: 0.25 }, shishira: { color: '#748c48', growth: 0.65 } }, notes: 'Paler, bristly heads; mixed with wheat.' },
  millet: { id: 'millet', label: 'Millet (jowar/bajra)', botanical: 'Sorghum bicolor / Pennisetum glaucum', heightM: 2.2, rowM: 0.5, states: { vasanta: { color: '#8a7456', growth: 0 }, grishma: { color: '#8a7456', growth: 0 }, varsha: { color: '#5d7a36', growth: 0.6 }, sharad: { color: '#9a8a4a', growth: 1 }, hemanta: { color: '#a8946a', growth: 0.2 }, shishira: { color: '#7e6a50', growth: 0 } }, notes: 'Tall stalks with brown-red seed heads; uplands and plateau.' },
  sugarcane: { id: 'sugarcane', label: 'Sugarcane', botanical: 'Saccharum officinarum', heightM: 2.8, rowM: 0.9, states: { vasanta: { color: '#6f8a44', growth: 0.4 }, grishma: { color: '#7a8a48', growth: 0.6 }, varsha: { color: '#557a34', growth: 0.85 }, sharad: { color: '#5d7a38', growth: 1 }, hemanta: { color: '#6d7d44', growth: 1 }, shishira: { color: '#7a8048', growth: 0.3 } }, notes: 'Dense tall green walls near tanks and rivers; cane-crushing yards in hemanta.' },
  cotton: { id: 'cotton', label: 'Cotton (tree cotton)', botanical: 'Gossypium arboreum', heightM: 1.5, rowM: 0.8, states: { vasanta: { color: '#7e6a50', growth: 0 }, grishma: { color: '#7e6a50', growth: 0 }, varsha: { color: '#5d7a3a', growth: 0.5 }, sharad: { color: '#6a7a44', growth: 0.85 }, hemanta: { color: '#d8d2c2', growth: 1 }, shishira: { color: '#8a8060', growth: 0.2 } }, notes: 'Bushy plants with white bolls in hemanta; pickers with baskets.' },
  mustard: { id: 'mustard', label: 'Mustard (rabi)', botanical: 'Brassica juncea', heightM: 1.3, rowM: 0.3, states: { vasanta: { color: '#9a9a4a', growth: 0.8 }, grishma: { color: '#8a7456', growth: 0 }, varsha: { color: '#6d7a42', growth: 0 }, sharad: { color: '#7e6a50', growth: 0 }, hemanta: { color: '#6f8a44', growth: 0.4 }, shishira: { color: '#e8c838', growth: 1 } }, notes: 'Electric yellow carpets in shishira - the brightest field color; keep to 10-20% of plots so it accents.' },
  sesame: { id: 'sesame', label: 'Sesame', botanical: 'Sesamum indicum', heightM: 1.1, rowM: 0.4, states: { vasanta: { color: '#7e6a50', growth: 0 }, grishma: { color: '#7e6a50', growth: 0 }, varsha: { color: '#5f7c3c', growth: 0.6 }, sharad: { color: '#6f7a44', growth: 1 }, hemanta: { color: '#a8946a', growth: 0.2 }, shishira: { color: '#7e6a50', growth: 0 } }, notes: 'Upright plants with pale pink-white bell flowers in sharad.' },
  lentil: { id: 'lentil', label: 'Lentils & chickpea', botanical: 'Lens culinaris / Cicer arietinum', heightM: 0.45, rowM: 0.3, states: { vasanta: { color: '#9a8e5a', growth: 1 }, grishma: { color: '#8a7456', growth: 0 }, varsha: { color: '#6d7a42', growth: 0 }, sharad: { color: '#7e6a50', growth: 0 }, hemanta: { color: '#6f8448', growth: 0.4 }, shishira: { color: '#6a8648', growth: 0.8 } }, notes: 'Low blue-green carpets; purple-white flowers in shishira.' },
};

/** Never place these (New World or post-period introductions). Art QA checks scene manifests against it. */
export const BANNED_PLANTS = [
  'maize', 'chilli', 'potato', 'tomato', 'tobacco', 'cashew', 'papaya', 'guava', 'pineapple', 'cactus', 'agave',
  'prickly pear', 'marigold (Tagetes)', 'eucalyptus', 'lantana', 'gulmohar (Delonix regia)', 'jacaranda', 'casuarina',
  'silver oak', 'rubber tree', 'tea gardens', 'peanut', 'sunflower',
] as const;

/** Global wind look (shader). Speeds from WeatherState.windSpeed. */
export const WIND = {
  /** Gust envelope period (s) and strength added on top of the base wind. */
  gustPeriodS: 6.5,
  gustStrength: 0.35,
  /** Traveling waves over grass and crop fields: wavelength (m) and speed factor x windSpeed. */
  fieldWaveLengthM: 28,
  fieldWaveSpeed: 0.9,
  /** Monsoon squall multiplier and storm turbulence. */
  stormMultiplier: 1.8,
  /** Phase variation per instance (0..1) so trees never move in unison. */
  phaseJitter: 1,
} as const;

/** Vegetation LOD policy (meters; scaled by ZoomLook.lodBias and QualitySettings.vegetation). */
export const VEGETATION_LOD = {
  tree: { lod0ToM: 35, lod1ToM: 90, lod2ToM: 220, impostorBeyond: true, impostor: { frames: '8x8 octahedral (hemi-octahedral for ground views)', framePx: { ultra: 256, high: 192, mobile: 128 }, maps: ['baseColor+alpha', 'normal+depth'] } },
  shrub: { lod0ToM: 20, lod1ToM: 60, cullM: 260 },
  grass: { fadeStartFraction: 0.75, bladesPerM2: { low: 0, medium: 18, high: 40, ultra: 70 } },
  crops: { cardsToM: 140, beyondUseTerrainColor: true },
  /** Dither cross-fade between LODs (screen-door) over this many meters. */
  crossFadeM: 6,
} as const;
