/**
 * Visual style tokens for 3D rendering. OWNER: Art Director. Placeholder values by the CTO.
 *
 * Direction (to be refined by the Art Director): warm, sunlit ancient-Indian palette - terracotta
 * and laterite brick, sandstone, whitewashed lime plaster, teak and thatch, saffron/indigo/gold
 * accents; lush monsoon greens vs. dry-season ochres; golden-hour grading with gentle haze.
 * Renderers MUST take colors from here (not hard-code them) so the look can be tuned in one place.
 */
import type { Biome, Season } from '../../core/types';
import type { GradeParams } from '../post';

export type RGB = readonly [number, number, number];

/** sRGB hex -> linear-ish RGB triple 0..1 for shaders (three.Color handles conversion for materials). */
export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Ground albedo per biome (sRGB hex). */
export const BIOME_COLORS: Readonly<Record<Biome, string>> = {
  river: '#4f6b5a',
  floodplain: '#8a9a52',
  farmland: '#a8a24a',
  grassland: '#7f9a46',
  scrub: '#a39062',
  dry_plain: '#c2a170',
  forest: '#4e6b32',
  dense_forest: '#3a5527',
  hills: '#94805e',
  rocky: '#8c7d6b',
  plateau: '#b08a5c',
  sandbank: '#d8c39a',
  marsh: '#5d7044',
};

/** Seasonal tint multipliers for vegetation/ground (sRGB-ish). */
export const SEASON_TINT: Readonly<Record<Season, RGB>> = {
  vasanta: [1.0, 1.02, 0.95],
  grishma: [1.12, 1.0, 0.82],
  varsha: [0.85, 1.08, 0.88],
  sharad: [0.98, 1.05, 0.9],
  hemanta: [1.04, 1.0, 0.9],
  shishira: [1.0, 0.98, 0.95],
};

/** Architecture material colors (sRGB hex). */
export const MATERIALS = {
  mudPlaster: '#b98b5e',
  limeWash: '#e9e1cf',
  terracotta: '#b5562f',
  brick: '#a5553a',
  laterite: '#9b4a32',
  sandstone: '#d2a874',
  redSandstone: '#b8643f',
  granite: '#8d8a84',
  thatch: '#b59a5a',
  teak: '#6b4426',
  gold: '#d9a441',
  bronze: '#8c5a2b',
  waterDeep: '#1f4a52',
  waterShallow: '#4d8a7a',
  roadDirt: '#9c7f5c',
  roadPaved: '#a89c86',
} as const;

/** UI-matched accent colors usable in 3D (selection rings, order markers). */
export const ACCENTS = {
  saffron: '#e8892b',
  gold: '#e9b949',
  indigo: '#33407a',
  vermilion: '#d4452b',
  lotus: '#d98aa6',
  select: '#ffd36b',
  enemy: '#e0533d',
  ally: '#6fb7e8',
} as const;

/** Grading presets (see render/post.ts). Blend by time of day / weather. */
export const GRADE_PRESETS: Readonly<Record<'day' | 'golden' | 'dusk' | 'night' | 'monsoon' | 'menu', GradeParams>> = {
  day: { contrast: 1.06, saturation: 1.08, warmth: 0.06, lift: 0.01, vignette: 0.28, tint: [1, 1, 1] },
  golden: { contrast: 1.08, saturation: 1.14, warmth: 0.35, lift: 0.015, vignette: 0.34, tint: [1.03, 1.0, 0.95] },
  dusk: { contrast: 1.1, saturation: 1.05, warmth: 0.25, lift: 0.02, vignette: 0.4, tint: [1.0, 0.95, 1.02] },
  night: { contrast: 1.04, saturation: 0.8, warmth: -0.3, lift: 0.025, vignette: 0.45, tint: [0.9, 0.95, 1.1] },
  monsoon: { contrast: 1.02, saturation: 0.92, warmth: -0.12, lift: 0.02, vignette: 0.35, tint: [0.96, 1.0, 1.02] },
  menu: { contrast: 1.1, saturation: 1.12, warmth: 0.3, lift: 0.01, vignette: 0.5, tint: [1.02, 0.99, 0.96] },
};

/** Exposure per time-of-day bucket. */
export const EXPOSURE = { day: 0.8, golden: 0.95, dusk: 1.1, night: 1.4 } as const;
