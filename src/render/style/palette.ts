/**
 * Visual style tokens for 3D rendering: master palette, value rules, grading. OWNER: Art Director.
 *
 * Direction (docs/ART_BIBLE.md §3): grounded, sun-baked ancient India circa 300 BCE. Large surfaces are
 * low-chroma earth, stone and lime (the world is 70% ochre, buff, olive and dust); saturated color is
 * reserved for cloth, paint, gold leaf, flowers and team colors (<= 10% of the frame). Shadows keep color:
 * a cool sky fill against warm earth bounce. Monsoon greens are olive-emerald, never lime.
 *
 * Renderers MUST take colors from here (or the other render/style modules), never hard-code them.
 * Existing export names are a stable contract (terrain, water, roads, overlays, architecture, menu).
 * Hex values are sRGB. three.Color(hex) converts to linear for materials; shaders use hexToLinear().
 */
import type { Biome, Season } from '../../core/types';
import type { GradeParams } from '../post';

export type RGB = readonly [number, number, number];
export type Hex = `#${string}`;

/** sRGB hex -> sRGB-encoded RGB triple 0..1 (NOT linear; use hexToLinear for lighting math). */
export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** sRGB transfer function, one channel. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Inverse sRGB transfer function, one channel. */
export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** sRGB hex -> linear RGB triple (three.js working color space; use with Color.setRGB / uniforms). */
export function hexToLinear(hex: string): RGB {
  const s = hexToRgb(hex);
  return [srgbToLinear(s[0]), srgbToLinear(s[1]), srgbToLinear(s[2])];
}

/** Linear RGB -> sRGB hex (for docs/debug UIs). */
export function linearToHex(rgb: RGB): Hex {
  const to = (c: number): string => Math.round(Math.min(1, Math.max(0, linearToSrgb(c))) * 255).toString(16).padStart(2, '0');
  return `#${to(rgb[0])}${to(rgb[1])}${to(rgb[2])}`;
}

/** Rec.709 relative luminance of a linear RGB triple. */
export function luminance(rgb: RGB): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/** Linear interpolation of two RGB triples (do it in linear space). */
export function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Albedo value limits for PBR base colors (linear luminance). Art QA rejects maps whose 2nd/98th
 * percentile falls outside: nothing is darker than charcoal or brighter than fresh lime plaster.
 * Emissive (flames, lamps), sky and UI are exempt.
 */
export const ALBEDO_LIMITS = {
  /** Hard floor - charcoal, wet basalt in cavities. sRGB ~ #1e1e1e. */
  min: 0.012,
  /** Hard ceiling - fresh lime wash, kaolin, white cotton in sun. sRGB ~ #ececec. */
  max: 0.84,
  /** Typical ranges by family (linear luminance). */
  ranges: {
    soilDry: [0.15, 0.32],
    soilWet: [0.05, 0.14],
    grass: [0.08, 0.2],
    foliage: [0.04, 0.14],
    sandstone: [0.18, 0.42],
    limePlaster: [0.5, 0.78],
    brickTerracotta: [0.1, 0.24],
    timber: [0.05, 0.16],
    skin: [0.08, 0.3],
    cottonUndyed: [0.45, 0.7],
    clothDyed: [0.04, 0.35],
  },
} as const;

/**
 * Saturation budget (HSV S of the sRGB albedo). Large surfaces (> 4 m^2 on screen at tactical zoom:
 * ground, walls, roofs, rock, water) stay <= 0.45. Medium (props, timber, foliage) <= 0.6. Accents
 * (cloth, paint, flowers, gold, team colors, banners) may reach 0.85.
 */
export const SATURATION_LIMITS = { large: 0.45, medium: 0.6, accent: 0.85 } as const;

/**
 * Ground albedo per biome (sRGB hex) for vertex-colored / fallback terrain and the minimap. The splat
 * terrain (render/style/terrain.ts BIOME_TERRAIN) uses baked layers; these are their averages.
 */
export const BIOME_COLORS: Readonly<Record<Biome, string>> = {
  river: '#4b5a47',
  floodplain: '#727a4c',
  farmland: '#8a8449',
  grassland: '#6d7a43',
  scrub: '#968659',
  dry_plain: '#b29672',
  forest: '#46582f',
  dense_forest: '#37472a',
  hills: '#867459',
  rocky: '#7f7467',
  plateau: '#9c7c57',
  sandbank: '#cbb894',
  marsh: '#56613f',
};

/**
 * Seasonal tint multipliers for vegetation and ground (applied in linear space, keep within 0.8..1.15).
 * vasanta: fresh spring, mustard/wheat gold | grishma: bleached, dusty | varsha: saturated olive-emerald |
 * sharad: lush but clearing, kash grass white | hemanta: mellow | shishira: cool, slightly desaturated.
 */
export const SEASON_TINT: Readonly<Record<Season, RGB>> = {
  vasanta: [1.03, 1.02, 0.92],
  grishma: [1.13, 1.0, 0.8],
  varsha: [0.86, 1.06, 0.88],
  sharad: [0.96, 1.05, 0.9],
  hemanta: [1.04, 1.0, 0.9],
  shishira: [0.99, 0.98, 0.97],
};

/** Architecture and world material colors (sRGB hex, average albedo of the baked sets). */
export const MATERIALS = {
  mudPlaster: '#a8835f',
  limeWash: '#e4dac6',
  terracotta: '#a65a3c',
  brick: '#9c5a40',
  laterite: '#8f4a34',
  /** Buff sandstone (Sanchi/Chunar) - the default "stone" of the heartland. */
  sandstone: '#c2a985',
  /** Spotted red sandstone (Mathura/Sikri type) - city-state and landmark stone. */
  redSandstone: '#a8604a',
  /** Mauryan mirror-polished buff sandstone (pillars, edict capitals). */
  polishedSandstone: '#cdbb9a',
  granite: '#8a8680',
  basalt: '#57534f',
  thatch: '#a8935e',
  thatchOld: '#857a62',
  teak: '#6b4a2e',
  salWood: '#5e4631',
  bamboo: '#b39a63',
  weatheredWood: '#80776a',
  gold: '#d4a537',
  bronze: '#8c5f34',
  copper: '#b06a3b',
  iron: '#4a4744',
  waterDeep: '#1f3f45',
  waterShallow: '#4a7468',
  waterMonsoon: '#5b5a3e',
  roadDirt: '#9a7e5e',
  roadPaved: '#a09582',
  /** Ox-blood / lac-red lacquer and painted wood. */
  lacquerRed: '#7d2420',
  /** Indigo-dyed cloth and painted plaster. */
  indigoPaint: '#2f3f6e',
  /** Ochre wash on mud walls (village paintings). */
  ochreWash: '#c08a3e',
  /** Rice-paste white (kolam, mandana floor art) - an emissive-free accent. */
  ricePaste: '#ece5d4',
} as const;

/** UI-matched accent colors usable in 3D (selection rings, order markers, map overlays). */
export const ACCENTS = {
  saffron: '#e8892b',
  gold: '#e9b949',
  indigo: '#33407a',
  vermilion: '#d4452b',
  lotus: '#d98aa6',
  peacock: '#1f6f78',
  turmeric: '#e3a82b',
  lapis: '#2f4f8f',
  /** Own selection ring / hover. */
  select: '#ffd36b',
  enemy: '#e0533d',
  ally: '#6fb7e8',
  neutral: '#d8cdb5',
  /** Valid / invalid placement ghost tints. */
  placeValid: '#7fd27a',
  placeInvalid: '#e0533d',
} as const;

/**
 * Natural dyes and pigments of the period (sRGB). Cloth, paint and mural colors are picked from here so
 * the world never shows synthetic hues. Team colors are mapped onto the nearest dye in factions.ts.
 */
export const DYES = {
  cottonUndyed: '#d9cdb3',
  cottonBleached: '#e8e1d0',
  turmeric: '#d9a02c',
  saffron: '#d9772a',
  safflowerRed: '#c2412d',
  madder: '#9c2f25',
  lac: '#8a1f24',
  indigo: '#2b3a6b',
  indigoLight: '#5a72a3',
  woadGreen: '#4f6b4a',
  myrobalanOlive: '#8a7d3c',
  catechuBrown: '#6b4630',
  ironBlack: '#2e2a28',
  violetLac: '#6a3a6e',
} as const;

/**
 * Ajanta-style mural / painted-ornament palette (mineral pigments). Used for painted plaster, the
 * palace interior, chariot and howdah paint, UI illustration and loading-screen art.
 */
export const MURAL = {
  yellowOchre: '#c98f39',
  redOchre: '#9c3b23',
  terreVerte: '#6f8a6a',
  lapis: '#2f4f8f',
  lampBlack: '#2a2622',
  kaolin: '#e9e2d0',
  vermilion: '#c8381f',
  orpiment: '#e2b33c',
} as const;

/** Skin tones (sRGB albedo, before subsurface). Crowds pick 6 tones x +-4% value jitter. */
export const SKIN_TONES = ['#c48a63', '#a8714f', '#8f5d40', '#7a4c33', '#653d29', '#9a6a4c'] as const;

/** Hair (sRGB albedo); grey/white for elders. */
export const HAIR = { black: '#1e1a18', darkBrown: '#2e2420', grey: '#7d7873', white: '#c9c4bc' } as const;

/** Metals (sRGB base color for metalness 1). */
export const METALS = {
  goldLeaf: '#e0b54a',
  goldOld: '#c99a3a',
  bronze: '#b07a4a',
  bronzeAged: '#8c6a45',
  copper: '#c27a52',
  iron: '#8d8a86',
  ironBlackened: '#4f4c49',
  silver: '#c9c6c0',
} as const;

/**
 * Grading presets (render/post.ts GradeParams; display-referred, after ACES). Blend by time of day and
 * weather - see render/style/lighting.ts LIGHTING_PRESETS (each preset names its grade).
 * Rules: saturation <= 1.1 (ACES already compresses highlights); lift <= 0.04 (milky blacks only for
 * haze/fog); vignette 0.2 (strategy) .. 0.45 (night, cinematics); tint channels within 0.88..1.08.
 */
export const GRADE_PRESETS: Readonly<
  Record<'day' | 'golden' | 'dusk' | 'night' | 'monsoon' | 'menu' | 'dawn' | 'haze' | 'fog' | 'interior' | 'cinematic', GradeParams>
> = {
  day: { contrast: 1.05, saturation: 1.0, warmth: 0.08, lift: 0.012, vignette: 0.24, tint: [1.0, 0.995, 0.98] },
  dawn: { contrast: 1.02, saturation: 0.95, warmth: 0.1, lift: 0.028, vignette: 0.3, tint: [0.99, 0.98, 1.02] },
  golden: { contrast: 1.1, saturation: 1.07, warmth: 0.3, lift: 0.014, vignette: 0.32, tint: [1.03, 1.0, 0.95] },
  dusk: { contrast: 1.08, saturation: 1.0, warmth: 0.12, lift: 0.024, vignette: 0.38, tint: [1.0, 0.95, 1.04] },
  night: { contrast: 1.06, saturation: 0.74, warmth: -0.25, lift: 0.018, vignette: 0.45, tint: [0.88, 0.95, 1.08] },
  monsoon: { contrast: 1.04, saturation: 0.9, warmth: -0.12, lift: 0.02, vignette: 0.34, tint: [0.96, 1.0, 1.0] },
  haze: { contrast: 0.98, saturation: 0.92, warmth: 0.2, lift: 0.032, vignette: 0.24, tint: [1.03, 1.0, 0.93] },
  fog: { contrast: 0.97, saturation: 0.85, warmth: 0.0, lift: 0.04, vignette: 0.3, tint: [0.98, 1.0, 1.02] },
  interior: { contrast: 1.12, saturation: 1.02, warmth: 0.28, lift: 0.01, vignette: 0.42, tint: [1.04, 0.99, 0.94] },
  cinematic: { contrast: 1.1, saturation: 1.04, warmth: 0.18, lift: 0.012, vignette: 0.4, tint: [1.02, 0.99, 0.97] },
  menu: { contrast: 1.1, saturation: 1.05, warmth: 0.28, lift: 0.012, vignette: 0.5, tint: [1.02, 0.99, 0.96] },
};

/** Tone-mapping exposure per time-of-day bucket (renderer.toneMappingExposure, ACES). */
export const EXPOSURE = { day: 0.8, golden: 0.95, dusk: 1.1, night: 1.4 } as const;
