/**
 * Lighting & atmosphere presets (time of day, weather, hero moods) and a pure resolver that blends them
 * from the environment state. OWNER: Art Director. Consumed by render/environment (Lead Graphics) and
 * by HeroScene / cutscenes / the asset viewer. See docs/ART_BIBLE.md §4 for the intent of every knob.
 *
 * Units and conventions
 * - Sun / moon `intensity` is THREE.DirectionalLight.intensity in the game's light scale: clear noon sun
 *   = 3.4 (the sky-bake SUN_TARGET in tools/blender/lib/sky.py), with `color` normalized to max 1.
 * - `exposure` is renderer.toneMappingExposure (ACES Filmic). Eye adaptation is authored, not automatic:
 *   the night is darker than the day on screen, but readable.
 * - Fog is exponential height fog: density(h) = density * exp(-heightFalloff * (h - baseHeight)) per meter.
 *   Analytic integral along the view ray (Quilez). `inscatter` tints fog toward the sun (power = lobe
 *   sharpness). FogExp2 fallback (low tier): density2 = density * 0.6.
 * - Colors are sRGB hex in presets; the resolver outputs LINEAR RGB triples for Color.setRGB / uniforms.
 * - Angles in degrees here (artist-facing); azimuth is a compass bearing (0 = north = -Z, 90 = east = +X).
 *
 * Pure module: no three objects are created, so it is cheap to call when the environment changes.
 */
import type { HeroMood, Season, WeatherKind } from '../../core/types';
import type { GradeParams } from '../post';
import { GRADE_PRESETS, hexToLinear, type Hex, type RGB } from './palette';

export const LIGHTING_PRESET_IDS = ['dawn', 'noon', 'golden', 'dusk', 'night', 'monsoon', 'dry_haze', 'winter_fog'] as const;
export type LightingPresetId = (typeof LIGHTING_PRESET_IDS)[number];

/**
 * Baked HDR skies (manifest ids, WP7 in docs/ASSET_LIST.md). sky_noon is the noon key (WP7-02); sky_day (42 deg SE
 * late morning) stays published as the lookdev / daytime IBL and is not any preset's key.
 */
export type SkyHdriId =
  | 'sky_day'
  | 'sky_golden'
  | 'sky_dawn'
  | 'sky_noon'
  | 'sky_dusk'
  | 'sky_night'
  | 'sky_overcast'
  | 'sky_haze'
  | 'sky_fog';

/** Parameters for tools/blender/lib/sky.py bake_sky() (Blender multiple-scattering sky). */
export interface NishitaParams {
  sunElevationDeg: number;
  sunAzimuthDeg: number;
  /** Blender sky altitude (m). */
  altitude: number;
  air: number;
  aerosol: number;
  ozone: number;
  /** 0..1 procedural cloud cover painted into the bake. */
  clouds: number;
  cloudScale: number;
  /** Lower-hemisphere ground bounce albedo (linear RGB). */
  groundAlbedo: RGB;
}

/** three/examples Sky (Preetham) uniforms for the procedural fallback sky (assets off / no bake). */
export interface PreethamParams {
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
}

export interface SunParams {
  /** Reference position for authored scenes, lookdev and sky bakes (time-of-day scenes use the solar path). */
  elevationDeg: number;
  azimuthDeg: number;
  color: Hex;
  intensity: number;
  /** Apparent angular radius used for the PCSS penumbra / shadow radius (real sun 0.27; haze widens it). */
  softnessDeg: number;
}

export interface FogParams {
  /** Fog color looking away from the sun (aerial perspective color). */
  color: Hex;
  /** Fog color looking into the sun (forward-scattering lobe). */
  inscatter: Hex;
  /** Extinction per meter at baseHeight. */
  density: number;
  /** Per meter; 1 / falloff = scale height. */
  heightFalloff: number;
  /** World height (m) where `density` applies (terrain water level ~ 0). */
  baseHeight: number;
  /** Exponent of max(0, dot(viewDir, sunDir)) for the inscatter lobe. */
  inscatterPower: number;
  /** Clamp so distant terrain never fully disappears (readability). */
  maxOpacity: number;
  /** Optional ground-hugging mist slab (dawn ghats, winter fields): top height (m) and extra density. */
  mist: { topM: number; density: number };
}

export interface LightingPreset {
  id: LightingPresetId;
  label: string;
  sun: SunParams;
  /**
   * Baked sky to use when assets are on, the parameters it was / should be baked with, and the target
   * horizontal sky irradiance (sun excluded, game units). The IBL is calibrated to it whatever the source:
   * scene.environmentIntensity = irradiance / sourceIrradiance (manifest `ambientIrradiance` for baked
   * skies; for the procedural Preetham sky measure it once per PMREM bake with the sun disc masked - the
   * raw Preetham dome is ~8x too bright for this light scale and is invalid below the horizon).
   */
  sky: { hdri: SkyHdriId; nishita: NishitaParams; preetham: PreethamParams; irradiance: number; envRotationDeg: number };
  /** Hemisphere fill. With IBL on, multiply intensity by 0.35 (IBL carries most of the sky fill). */
  hemi: { sky: Hex; ground: Hex; intensity: number };
  fog: FogParams;
  /** Screen-space god rays / volumetric shafts (0 = off). decay 0.9-0.98, density 0.5-1. */
  shafts: { strength: number; decay: number; density: number };
  exposure: number;
  /**
   * UnrealBloom strength, radius and threshold. The threshold is EXPOSED luminance (scene-linear x
   * exposure): pass threshold / exposure to UnrealBloomPass. ~1 = a sunlit white wall, so day values of
   * 4-4.5 keep bloom on the sun, glints, fire and lamps only (never on the sky or plaster).
   */
  bloom: { strength: number; radius: number; threshold: number };
  /** GTAO intensity multiplier and world radius (m). */
  ao: { intensity: number; radiusM: number };
  grade: GradeParams;
  /** Optional 3D LUT id (32^3 .cube baked by the Art Director, WP7) applied after the grade. */
  lut: string | null;
  /** 0..1 surface wetness pushed to MATERIAL_GLOBALS.wetness (dew, rain, puddles). */
  wetness: number;
  /** 0..1 weight of practical lights (oil lamps, torches, braziers, fires). */
  practicals: number;
  /** Ambient VFX densities 0..1 (render/fx): dust motes in shafts, low mist, fireflies, falling leaves. */
  ambientFx: { dustMotes: number; mist: number; fireflies: number; leaves: number };
  /** QA target key:fill = sun luminance (normal incidence) / horizontal sky irradiance (= sun.lum / sky.irradiance). */
  keyFill: number;
}

const DEG = Math.PI / 180;

function grade(id: keyof typeof GRADE_PRESETS): GradeParams {
  const g = GRADE_PRESETS[id];
  return { ...g, tint: [g.tint[0], g.tint[1], g.tint[2]] };
}

const NO_MIST = { topM: 0, density: 0 };

/**
 * Canonical presets. Numbers were authored for the game's light scale (noon sun 3.4, ACES) and checked
 * in the lookdev harness (docs/art/lookdev_*.png). Tune in engine, then copy values back here.
 */
export const LIGHTING_PRESETS: Readonly<Record<LightingPresetId, LightingPreset>> = {
  dawn: {
    id: 'dawn',
    label: 'Dawn - mist on the ghats',
    sun: { elevationDeg: 6, azimuthDeg: 95, color: '#ffc49a', intensity: 1.9, softnessDeg: 0.7 },
    sky: {
      hdri: 'sky_dawn',
      nishita: { sunElevationDeg: 6, sunAzimuthDeg: 95, altitude: 0, air: 1.1, aerosol: 2.4, ozone: 1.4, clouds: 0.25, cloudScale: 0.9, groundAlbedo: [0.2, 0.18, 0.15] },
      preetham: { turbidity: 6, rayleigh: 2.2, mieCoefficient: 0.012, mieDirectionalG: 0.86 },
      irradiance: 0.38,
      envRotationDeg: 0,
    },
    hemi: { sky: '#97a8c8', ground: '#6d5e56', intensity: 0.32 },
    fog: { color: '#b4b2bd', inscatter: '#ffcfa6', density: 0.0008, heightFalloff: 0.03, baseHeight: 0, inscatterPower: 6, maxOpacity: 0.88, mist: { topM: 2, density: 0.012 } },
    shafts: { strength: 0.55, decay: 0.95, density: 0.85 },
    exposure: 1.3,
    bloom: { strength: 0.4, radius: 0.6, threshold: 3.0 },
    ao: { intensity: 0.9, radiusM: 1.4 },
    grade: grade('dawn'),
    lut: 'lut_dawn',
    wetness: 0.25,
    practicals: 0.25,
    ambientFx: { dustMotes: 0.2, mist: 0.85, fireflies: 0, leaves: 0.2 },
    keyFill: 3,
  },
  noon: {
    id: 'noon',
    label: 'Day - clear sharad noon',
    sun: { elevationDeg: 62, azimuthDeg: 170, color: '#fff3e3', intensity: 3.4, softnessDeg: 0.35 },
    sky: {
      hdri: 'sky_noon',
      nishita: { sunElevationDeg: 62, sunAzimuthDeg: 170, altitude: 0, air: 1.0, aerosol: 1.6, ozone: 1.0, clouds: 0.18, cloudScale: 1.0, groundAlbedo: [0.24, 0.2, 0.15] },
      preetham: { turbidity: 3.2, rayleigh: 1.6, mieCoefficient: 0.005, mieDirectionalG: 0.82 },
      irradiance: 0.75,
      envRotationDeg: 0,
    },
    hemi: { sky: '#a9c0e2', ground: '#8a7458', intensity: 0.38 },
    fog: { color: '#c3c6c2', inscatter: '#fff0d4', density: 0.00018, heightFalloff: 0.0025, baseHeight: 0, inscatterPower: 8, maxOpacity: 0.72, mist: NO_MIST },
    shafts: { strength: 0, decay: 0.95, density: 0.7 },
    exposure: 0.8,
    bloom: { strength: 0.22, radius: 0.4, threshold: 4.5 },
    ao: { intensity: 1.0, radiusM: 1.5 },
    grade: grade('day'),
    lut: null,
    wetness: 0,
    practicals: 0,
    ambientFx: { dustMotes: 0.15, mist: 0, fireflies: 0, leaves: 0.25 },
    keyFill: 4.5,
  },
  golden: {
    id: 'golden',
    label: 'Golden hour - warm dust',
    sun: { elevationDeg: 8, azimuthDeg: 262, color: '#ffae66', intensity: 4.2, softnessDeg: 0.6 },
    sky: {
      hdri: 'sky_golden',
      nishita: { sunElevationDeg: 7, sunAzimuthDeg: 258, altitude: 0, air: 1.3, aerosol: 3.2, ozone: 1.2, clouds: 0.38, cloudScale: 0.8, groundAlbedo: [0.26, 0.19, 0.12] },
      preetham: { turbidity: 8, rayleigh: 2.6, mieCoefficient: 0.009, mieDirectionalG: 0.88 },
      irradiance: 0.45,
      envRotationDeg: 0,
    },
    hemi: { sky: '#8ea2cc', ground: '#7a5a3e', intensity: 0.3 },
    fog: { color: '#c9a582', inscatter: '#ffbe78', density: 0.0005, heightFalloff: 0.006, baseHeight: 0, inscatterPower: 5, maxOpacity: 0.8, mist: NO_MIST },
    shafts: { strength: 0.45, decay: 0.96, density: 0.8 },
    exposure: 1.05,
    bloom: { strength: 0.45, radius: 0.55, threshold: 3.2 },
    ao: { intensity: 1.05, radiusM: 1.5 },
    grade: grade('golden'),
    lut: 'lut_golden',
    wetness: 0,
    practicals: 0.15,
    ambientFx: { dustMotes: 0.65, mist: 0, fireflies: 0, leaves: 0.3 },
    keyFill: 5,
  },
  dusk: {
    id: 'dusk',
    label: 'Dusk - lamps are lit',
    sun: { elevationDeg: -2, azimuthDeg: 280, color: '#ff9a6e', intensity: 0.55, softnessDeg: 3 },
    sky: {
      hdri: 'sky_dusk',
      nishita: { sunElevationDeg: -2, sunAzimuthDeg: 280, altitude: 0, air: 1.2, aerosol: 2.6, ozone: 1.6, clouds: 0.3, cloudScale: 0.9, groundAlbedo: [0.2, 0.16, 0.13] },
      preetham: { turbidity: 7, rayleigh: 3, mieCoefficient: 0.008, mieDirectionalG: 0.85 },
      irradiance: 0.16,
      envRotationDeg: 0,
    },
    hemi: { sky: '#62719f', ground: '#4b3b3a', intensity: 0.28 },
    fog: { color: '#7b6f82', inscatter: '#ff9d70', density: 0.0005, heightFalloff: 0.01, baseHeight: 0, inscatterPower: 4, maxOpacity: 0.82, mist: { topM: 1.5, density: 0.008 } },
    shafts: { strength: 0.2, decay: 0.95, density: 0.7 },
    exposure: 1.8,
    bloom: { strength: 0.5, radius: 0.55, threshold: 2.2 },
    ao: { intensity: 0.9, radiusM: 1.4 },
    grade: grade('dusk'),
    lut: 'lut_dusk',
    wetness: 0.05,
    practicals: 0.6,
    ambientFx: { dustMotes: 0.25, mist: 0.2, fireflies: 0.35, leaves: 0.1 },
    keyFill: 1.6,
  },
  night: {
    id: 'night',
    label: 'Night - moon and torches',
    sun: { elevationDeg: 42, azimuthDeg: 150, color: '#9fb6e3', intensity: 0.55, softnessDeg: 0.4 },
    sky: {
      hdri: 'sky_night',
      nishita: { sunElevationDeg: -18, sunAzimuthDeg: 300, altitude: 0, air: 1.0, aerosol: 1.2, ozone: 1.0, clouds: 0.15, cloudScale: 1.0, groundAlbedo: [0.05, 0.05, 0.06] },
      preetham: { turbidity: 2, rayleigh: 0.6, mieCoefficient: 0.002, mieDirectionalG: 0.7 },
      irradiance: 0.08,
      envRotationDeg: 0,
    },
    hemi: { sky: '#2b3654', ground: '#1b1813', intensity: 0.14 },
    fog: { color: '#1c2434', inscatter: '#43506e', density: 0.0004, heightFalloff: 0.008, baseHeight: 0, inscatterPower: 3, maxOpacity: 0.85, mist: { topM: 1.2, density: 0.006 } },
    shafts: { strength: 0, decay: 0.95, density: 0.7 },
    exposure: 2.5,
    bloom: { strength: 0.6, radius: 0.55, threshold: 1.4 },
    ao: { intensity: 0.8, radiusM: 1.2 },
    grade: grade('night'),
    lut: 'lut_night',
    wetness: 0.1,
    practicals: 1,
    ambientFx: { dustMotes: 0, mist: 0.25, fireflies: 0.7, leaves: 0 },
    keyFill: 3,
  },
  monsoon: {
    id: 'monsoon',
    label: 'Monsoon - overcast and rain',
    sun: { elevationDeg: 50, azimuthDeg: 180, color: '#d7dde0', intensity: 0.85, softnessDeg: 8 },
    sky: {
      hdri: 'sky_overcast',
      nishita: { sunElevationDeg: 50, sunAzimuthDeg: 180, altitude: 0, air: 1.4, aerosol: 4, ozone: 1.0, clouds: 0.95, cloudScale: 0.7, groundAlbedo: [0.12, 0.13, 0.1] },
      preetham: { turbidity: 14, rayleigh: 0.9, mieCoefficient: 0.02, mieDirectionalG: 0.6 },
      irradiance: 0.5,
      envRotationDeg: 0,
    },
    hemi: { sky: '#a2abaf', ground: '#4c5040', intensity: 0.55 },
    fog: { color: '#8c989a', inscatter: '#c6cecc', density: 0.0011, heightFalloff: 0.004, baseHeight: 0, inscatterPower: 2, maxOpacity: 0.88, mist: { topM: 3, density: 0.006 } },
    shafts: { strength: 0, decay: 0.95, density: 0.7 },
    exposure: 1.3,
    bloom: { strength: 0.2, radius: 0.4, threshold: 4.0 },
    ao: { intensity: 1.15, radiusM: 1.8 },
    grade: grade('monsoon'),
    lut: 'lut_monsoon',
    wetness: 0.85,
    practicals: 0.2,
    ambientFx: { dustMotes: 0, mist: 0.5, fireflies: 0, leaves: 0.4 },
    keyFill: 1.2,
  },
  dry_haze: {
    id: 'dry_haze',
    label: 'Grishma - dry-season haze',
    sun: { elevationDeg: 55, azimuthDeg: 200, color: '#fff0d4', intensity: 3.0, softnessDeg: 0.9 },
    sky: {
      hdri: 'sky_haze',
      nishita: { sunElevationDeg: 55, sunAzimuthDeg: 200, altitude: 0, air: 1.2, aerosol: 5, ozone: 0.9, clouds: 0.05, cloudScale: 1.0, groundAlbedo: [0.32, 0.26, 0.18] },
      preetham: { turbidity: 12, rayleigh: 1.0, mieCoefficient: 0.014, mieDirectionalG: 0.84 },
      irradiance: 0.9,
      envRotationDeg: 0,
    },
    hemi: { sky: '#c4c2b4', ground: '#957a55', intensity: 0.42 },
    fog: { color: '#cdb995', inscatter: '#fff0c8', density: 0.0012, heightFalloff: 0.0018, baseHeight: 0, inscatterPower: 4, maxOpacity: 0.78, mist: NO_MIST },
    shafts: { strength: 0.1, decay: 0.95, density: 0.7 },
    exposure: 0.74,
    bloom: { strength: 0.3, radius: 0.5, threshold: 4.2 },
    ao: { intensity: 1.0, radiusM: 1.5 },
    grade: grade('haze'),
    lut: 'lut_haze',
    wetness: 0,
    practicals: 0,
    ambientFx: { dustMotes: 0.45, mist: 0, fireflies: 0, leaves: 0.15 },
    keyFill: 3,
  },
  winter_fog: {
    id: 'winter_fog',
    label: 'Shishira - winter morning fog',
    sun: { elevationDeg: 12, azimuthDeg: 125, color: '#ffe0c2', intensity: 1.4, softnessDeg: 2.5 },
    sky: {
      hdri: 'sky_fog',
      nishita: { sunElevationDeg: 12, sunAzimuthDeg: 125, altitude: 0, air: 1.0, aerosol: 6, ozone: 1.0, clouds: 0.5, cloudScale: 1.2, groundAlbedo: [0.2, 0.2, 0.18] },
      preetham: { turbidity: 16, rayleigh: 1.2, mieCoefficient: 0.03, mieDirectionalG: 0.9 },
      irradiance: 0.55,
      envRotationDeg: 0,
    },
    hemi: { sky: '#b3b8bf', ground: '#5c5a50', intensity: 0.45 },
    fog: { color: '#b5b9bd', inscatter: '#ffe2c4', density: 0.0022, heightFalloff: 0.02, baseHeight: 0, inscatterPower: 6, maxOpacity: 0.86, mist: { topM: 4, density: 0.02 } },
    shafts: { strength: 0.7, decay: 0.96, density: 0.9 },
    exposure: 1.05,
    bloom: { strength: 0.35, radius: 0.6, threshold: 3.0 },
    ao: { intensity: 0.85, radiusM: 1.4 },
    grade: grade('fog'),
    lut: 'lut_fog',
    wetness: 0.35,
    practicals: 0.1,
    ambientFx: { dustMotes: 0.1, mist: 1, fireflies: 0, leaves: 0.1 },
    keyFill: 2,
  },
};

/**
 * Weather overlays applied on top of the time-of-day base (resolveLighting). Multipliers keep night dark
 * and noon bright; colors are targets blended by the overlay weight.
 */
export interface WeatherOverlay {
  sunIntensityMul: number;
  sunSoftnessDeg: number;
  /** Multiplier on the sky irradiance (overcast domes are brighter relative to the dimmed sun). */
  envIntensityMul: number;
  fogColor: Hex;
  fogDensityMul: number;
  fogHeightFalloff: number;
  exposureMul: number;
  grade: GradeParams;
  wetness: number;
  keyFill: number;
  bloomStrengthMul: number;
  shaftsMul: number;
}

export const WEATHER_OVERLAYS: Readonly<Record<'monsoon' | 'storm' | 'haze' | 'dust' | 'fog', WeatherOverlay>> = {
  monsoon: { sunIntensityMul: 0.25, sunSoftnessDeg: 8, envIntensityMul: 1.2, fogColor: '#8c989a', fogDensityMul: 4, fogHeightFalloff: 0.004, exposureMul: 1.3, grade: grade('monsoon'), wetness: 0.85, keyFill: 1.4, bloomStrengthMul: 0.6, shaftsMul: 0.2 },
  storm: { sunIntensityMul: 0.12, sunSoftnessDeg: 10, envIntensityMul: 0.85, fogColor: '#6d7779', fogDensityMul: 6, fogHeightFalloff: 0.003, exposureMul: 1.45, grade: grade('monsoon'), wetness: 1, keyFill: 1.2, bloomStrengthMul: 0.5, shaftsMul: 0 },
  haze: { sunIntensityMul: 0.88, sunSoftnessDeg: 0.9, envIntensityMul: 0.95, fogColor: '#cdb995', fogDensityMul: 3, fogHeightFalloff: 0.0018, exposureMul: 0.95, grade: grade('haze'), wetness: 0, keyFill: 3, bloomStrengthMul: 1, shaftsMul: 1.2 },
  dust: { sunIntensityMul: 0.45, sunSoftnessDeg: 4, envIntensityMul: 0.8, fogColor: '#b98f5e', fogDensityMul: 9, fogHeightFalloff: 0.004, exposureMul: 1.1, grade: grade('haze'), wetness: 0, keyFill: 1.8, bloomStrengthMul: 0.7, shaftsMul: 0.6 },
  fog: { sunIntensityMul: 0.5, sunSoftnessDeg: 2.5, envIntensityMul: 1.0, fogColor: '#b5b9bd', fogDensityMul: 10, fogHeightFalloff: 0.02, exposureMul: 1.15, grade: grade('fog'), wetness: 0.35, keyFill: 2, bloomStrengthMul: 0.8, shaftsMul: 1.4 },
};

/** Hero-mode district moods (DESIGN_SPEC §11.2): a base preset plus authored overrides. */
export interface HeroMoodPreset {
  mood: HeroMood;
  label: string;
  base: LightingPresetId;
  /** Reference hour for the mood (gameplay sets the clock; the resolver uses `base` directly). */
  hour: number;
  overrides: {
    fog?: Partial<FogParams>;
    shafts?: Partial<LightingPreset['shafts']>;
    exposure?: number;
    bloom?: Partial<LightingPreset['bloom']>;
    grade?: Partial<GradeParams>;
    wetness?: number;
    practicals?: number;
    ambientFx?: Partial<LightingPreset['ambientFx']>;
  };
  /** Cinematic depth of field defaults for the mood (hero camera, dialogues). */
  dof: { focusM: number; fStop: number; maxBlurPx: number };
  notes: string;
}

export const HERO_MOODS: Readonly<Record<HeroMood, HeroMoodPreset>> = {
  dawn_mist: {
    mood: 'dawn_mist',
    label: 'Dawn mist (ghats, duel)',
    base: 'dawn',
    hour: 6.2,
    overrides: { fog: { mist: { topM: 1.3, density: 0.035 }, density: 0.0012 }, shafts: { strength: 0.75 }, wetness: 0.45, ambientFx: { mist: 1, dustMotes: 0.3 } },
    dof: { focusM: 4.2, fStop: 2.8, maxBlurPx: 10 },
    notes: 'Waist-deep mist on the water, wet stone steps, sun shafts between chhatris; silhouettes against the bright east.',
  },
  golden_dust: {
    mood: 'golden_dust',
    label: 'Golden dust (bazaar, palace)',
    base: 'golden',
    hour: 17.4,
    overrides: { fog: { density: 0.0007 }, shafts: { strength: 0.6 }, ambientFx: { dustMotes: 0.9 }, grade: { warmth: 0.34 } },
    dof: { focusM: 4.2, fStop: 4, maxBlurPx: 8 },
    notes: 'Raking warm light, dust motes in shafts between awnings, long blue-violet shadows, gold leaf glints.',
  },
  noon_haze: {
    mood: 'noon_haze',
    label: 'Noon haze (granary, arms yard)',
    base: 'dry_haze',
    hour: 12.5,
    overrides: { exposure: 0.72, grade: { lift: 0.03 } },
    dof: { focusM: 4.2, fStop: 5.6, maxBlurPx: 6 },
    notes: 'Hard top light, deep eave shadows, bleached plaster, heat shimmer above flat roofs (distortion 0.002).',
  },
  monsoon_wet: {
    mood: 'monsoon_wet',
    label: 'Monsoon wet',
    base: 'monsoon',
    hour: 14,
    overrides: { wetness: 1, ambientFx: { mist: 0.6 } },
    dof: { focusM: 4.2, fStop: 4, maxBlurPx: 8 },
    notes: 'Puddle reflections (SSR), dripping eaves, darkened plaster with rain streaks, saturated foliage.',
  },
  lamp_night: {
    mood: 'lamp_night',
    label: 'Lamp night',
    base: 'night',
    hour: 21,
    overrides: { practicals: 1, bloom: { strength: 0.9 }, ambientFx: { fireflies: 0.5 } },
    dof: { focusM: 3.5, fStop: 2, maxBlurPx: 12 },
    notes: 'Oil-lamp rows (diyas) on ghats and ledges, torch pools on streets, moonlit blue rooftops; never pitch black.',
  },
  incense_dim: {
    mood: 'incense_dim',
    label: 'Incense interior (temple, hall)',
    base: 'golden',
    hour: 16,
    overrides: {
      fog: { color: '#6a5646', inscatter: '#ffcf8c', density: 0.004, heightFalloff: 0.15, baseHeight: 0, maxOpacity: 0.6 },
      shafts: { strength: 0.95, decay: 0.97 },
      exposure: 1.6,
      practicals: 0.8,
      grade: { ...GRADE_PRESETS.interior, tint: [GRADE_PRESETS.interior.tint[0], GRADE_PRESETS.interior.tint[1], GRADE_PRESETS.interior.tint[2]] },
      ambientFx: { dustMotes: 1 },
    },
    dof: { focusM: 3, fStop: 2.8, maxBlurPx: 10 },
    notes: 'Smoke-filled hall, sun shafts from high windows across pillars, lamp glow on bronze, deep warm blacks.',
  },
};

// =====================================================================================================
// Resolved (linear, blended) lighting
// =====================================================================================================

/** Fully resolved lighting state: linear RGB colors, ready for three. */
export interface ResolvedLighting {
  /** Blend weights that produced this result (debug / profiler overlay). */
  weights: { night: number; dusk: number; dawn: number; golden: number; noon: number; monsoon: number; haze: number; fog: number };
  sunColor: [number, number, number];
  sunIntensity: number;
  sunSoftnessDeg: number;
  /** Target horizontal sky irradiance (see LightingPreset.sky.irradiance). */
  skyIrradiance: number;
  hemiSky: [number, number, number];
  hemiGround: [number, number, number];
  hemiIntensity: number;
  fogColor: [number, number, number];
  fogInscatter: [number, number, number];
  fogDensity: number;
  fogHeightFalloff: number;
  fogBaseHeight: number;
  fogInscatterPower: number;
  fogMaxOpacity: number;
  mistTopM: number;
  mistDensity: number;
  shaftsStrength: number;
  shaftsDecay: number;
  shaftsDensity: number;
  exposure: number;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  aoIntensity: number;
  aoRadiusM: number;
  grade: GradeParams;
  wetness: number;
  practicals: number;
  dustMotes: number;
  mist: number;
  fireflies: number;
  leaves: number;
  keyFill: number;
  /** Nearest preset (for the HDRI choice and LUT). */
  dominant: LightingPresetId;
}

export interface LightingInput {
  /** Solar elevation in degrees (negative below the horizon). */
  sunElevationDeg: number;
  /** Fractional hour 0..24 (morning vs evening track). */
  hour: number;
  season: Season;
  weather: { kind: WeatherKind; cloudCover: number; rain: number };
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

function lerpGradeInto(out: GradeParams, a: GradeParams, b: GradeParams, t: number): GradeParams {
  out.contrast = lerp(a.contrast, b.contrast, t);
  out.saturation = lerp(a.saturation, b.saturation, t);
  out.warmth = lerp(a.warmth, b.warmth, t);
  out.lift = lerp(a.lift, b.lift, t);
  out.vignette = lerp(a.vignette, b.vignette, t);
  out.tint = [lerp(a.tint[0], b.tint[0], t), lerp(a.tint[1], b.tint[1], t), lerp(a.tint[2], b.tint[2], t)];
  return out;
}

/** Public helper: blend two grades (allocates). */
export function lerpGrade(a: GradeParams, b: GradeParams, t: number): GradeParams {
  return lerpGradeInto({ contrast: 1, saturation: 1, warmth: 0, lift: 0, vignette: 0, tint: [1, 1, 1] }, a, b, t);
}

function lin(hex: Hex): [number, number, number] {
  const c = hexToLinear(hex);
  return [c[0], c[1], c[2]];
}

function mixLin(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  return [lerp(a[0]!, b[0]!, t), lerp(a[1]!, b[1]!, t), lerp(a[2]!, b[2]!, t)];
}

/** Resolve one preset into linear form. */
export function presetToResolved(p: LightingPreset): ResolvedLighting {
  const w = { night: 0, dusk: 0, dawn: 0, golden: 0, noon: 0, monsoon: 0, haze: 0, fog: 0 };
  if (p.id === 'dry_haze') w.haze = 1;
  else if (p.id === 'winter_fog') w.fog = 1;
  else w[p.id] = 1;
  return {
    weights: w,
    sunColor: lin(p.sun.color),
    sunIntensity: p.sun.intensity,
    sunSoftnessDeg: p.sun.softnessDeg,
    skyIrradiance: p.sky.irradiance,
    hemiSky: lin(p.hemi.sky),
    hemiGround: lin(p.hemi.ground),
    hemiIntensity: p.hemi.intensity,
    fogColor: lin(p.fog.color),
    fogInscatter: lin(p.fog.inscatter),
    fogDensity: p.fog.density,
    fogHeightFalloff: p.fog.heightFalloff,
    fogBaseHeight: p.fog.baseHeight,
    fogInscatterPower: p.fog.inscatterPower,
    fogMaxOpacity: p.fog.maxOpacity,
    mistTopM: p.fog.mist.topM,
    mistDensity: p.fog.mist.density,
    shaftsStrength: p.shafts.strength,
    shaftsDecay: p.shafts.decay,
    shaftsDensity: p.shafts.density,
    exposure: p.exposure,
    bloomStrength: p.bloom.strength,
    bloomRadius: p.bloom.radius,
    bloomThreshold: p.bloom.threshold,
    aoIntensity: p.ao.intensity,
    aoRadiusM: p.ao.radiusM,
    grade: lerpGrade(p.grade, p.grade, 0),
    wetness: p.wetness,
    practicals: p.practicals,
    dustMotes: p.ambientFx.dustMotes,
    mist: p.ambientFx.mist,
    fireflies: p.ambientFx.fireflies,
    leaves: p.ambientFx.leaves,
    keyFill: p.keyFill,
    dominant: p.id,
  };
}

/** Blend two resolved states (geometric for densities/exposure so fog never "pumps"). */
export function lerpResolved(a: ResolvedLighting, b: ResolvedLighting, t: number): ResolvedLighting {
  const geo = (x: number, y: number): number => (x > 0 && y > 0 ? Math.exp(lerp(Math.log(x), Math.log(y), t)) : lerp(x, y, t));
  const wa = a.weights;
  const wb = b.weights;
  return {
    weights: {
      night: lerp(wa.night, wb.night, t),
      dusk: lerp(wa.dusk, wb.dusk, t),
      dawn: lerp(wa.dawn, wb.dawn, t),
      golden: lerp(wa.golden, wb.golden, t),
      noon: lerp(wa.noon, wb.noon, t),
      monsoon: lerp(wa.monsoon, wb.monsoon, t),
      haze: lerp(wa.haze, wb.haze, t),
      fog: lerp(wa.fog, wb.fog, t),
    },
    sunColor: mixLin(a.sunColor, b.sunColor, t),
    sunIntensity: lerp(a.sunIntensity, b.sunIntensity, t),
    sunSoftnessDeg: lerp(a.sunSoftnessDeg, b.sunSoftnessDeg, t),
    skyIrradiance: geo(a.skyIrradiance, b.skyIrradiance),
    hemiSky: mixLin(a.hemiSky, b.hemiSky, t),
    hemiGround: mixLin(a.hemiGround, b.hemiGround, t),
    hemiIntensity: lerp(a.hemiIntensity, b.hemiIntensity, t),
    fogColor: mixLin(a.fogColor, b.fogColor, t),
    fogInscatter: mixLin(a.fogInscatter, b.fogInscatter, t),
    fogDensity: geo(a.fogDensity, b.fogDensity),
    fogHeightFalloff: geo(a.fogHeightFalloff, b.fogHeightFalloff),
    fogBaseHeight: lerp(a.fogBaseHeight, b.fogBaseHeight, t),
    fogInscatterPower: lerp(a.fogInscatterPower, b.fogInscatterPower, t),
    fogMaxOpacity: lerp(a.fogMaxOpacity, b.fogMaxOpacity, t),
    mistTopM: lerp(a.mistTopM, b.mistTopM, t),
    mistDensity: lerp(a.mistDensity, b.mistDensity, t),
    shaftsStrength: lerp(a.shaftsStrength, b.shaftsStrength, t),
    shaftsDecay: lerp(a.shaftsDecay, b.shaftsDecay, t),
    shaftsDensity: lerp(a.shaftsDensity, b.shaftsDensity, t),
    exposure: geo(a.exposure, b.exposure),
    bloomStrength: lerp(a.bloomStrength, b.bloomStrength, t),
    bloomRadius: lerp(a.bloomRadius, b.bloomRadius, t),
    bloomThreshold: lerp(a.bloomThreshold, b.bloomThreshold, t),
    aoIntensity: lerp(a.aoIntensity, b.aoIntensity, t),
    aoRadiusM: lerp(a.aoRadiusM, b.aoRadiusM, t),
    grade: lerpGrade(a.grade, b.grade, t),
    wetness: lerp(a.wetness, b.wetness, t),
    practicals: lerp(a.practicals, b.practicals, t),
    dustMotes: lerp(a.dustMotes, b.dustMotes, t),
    mist: lerp(a.mist, b.mist, t),
    fireflies: lerp(a.fireflies, b.fireflies, t),
    leaves: lerp(a.leaves, b.leaves, t),
    keyFill: lerp(a.keyFill, b.keyFill, t),
    dominant: t < 0.5 ? a.dominant : b.dominant,
  };
}

/** Time-of-day keys along the solar elevation (degrees) for the morning and evening tracks. */
export const TIME_OF_DAY_TRACKS: Readonly<Record<'morning' | 'evening', readonly (readonly [number, LightingPresetId])[]>> = {
  morning: [
    [-12, 'night'],
    [-4, 'dusk'],
    [5, 'dawn'],
    [38, 'noon'],
  ],
  evening: [
    [-12, 'night'],
    [-4, 'dusk'],
    [8, 'golden'],
    [32, 'noon'],
  ],
};

function applyOverlay(base: ResolvedLighting, o: WeatherOverlay, w: number): ResolvedLighting {
  if (w <= 0) return base;
  const r = { ...base };
  r.sunIntensity = base.sunIntensity * lerp(1, o.sunIntensityMul, w);
  r.sunSoftnessDeg = lerp(base.sunSoftnessDeg, Math.max(base.sunSoftnessDeg, o.sunSoftnessDeg), w);
  r.skyIrradiance = base.skyIrradiance * lerp(1, o.envIntensityMul, w);
  // Fog color: weather tints the time-of-day fog but keeps its brightness so night fog stays dark.
  const target = lin(o.fogColor);
  const baseLum = 0.2126 * base.fogColor[0] + 0.7152 * base.fogColor[1] + 0.0722 * base.fogColor[2];
  const tgtLum = 0.2126 * target[0] + 0.7152 * target[1] + 0.0722 * target[2];
  const k = tgtLum > 0 ? Math.min(1.5, baseLum / tgtLum) : 1;
  r.fogColor = mixLin(base.fogColor, [target[0] * k, target[1] * k, target[2] * k], w);
  r.fogInscatter = mixLin(base.fogInscatter, r.fogColor, w * 0.7);
  r.fogDensity = base.fogDensity * lerp(1, o.fogDensityMul, w);
  r.fogHeightFalloff = lerp(base.fogHeightFalloff, o.fogHeightFalloff, w);
  r.exposure = base.exposure * lerp(1, o.exposureMul, w);
  r.grade = lerpGrade(base.grade, o.grade, w * 0.85);
  r.wetness = Math.max(base.wetness, o.wetness * w);
  r.keyFill = lerp(base.keyFill, Math.min(base.keyFill, o.keyFill), w);
  r.bloomStrength = base.bloomStrength * lerp(1, o.bloomStrengthMul, w);
  r.shaftsStrength = base.shaftsStrength * lerp(1, o.shaftsMul, w);
  return r;
}

/**
 * Resolve the lighting for a time of day + season + weather. Pure; allocates one small object - call
 * when the environment changes (not per frame). The renderer then applies:
 *   sun.color.setRGB(...r.sunColor); sun.intensity = r.sunIntensity;
 *   scene.environmentIntensity = environmentIntensityFor(r, sourceIrradiance); hemi (x0.35 when IBL is on);
 *   fog uniforms with fogRadiance(); post.setGrade(r.grade); renderer.toneMappingExposure = r.exposure;
 *   bloom threshold = r.bloomThreshold / r.exposure; MATERIAL_GLOBALS.wetness.value = max(r.wetness, weather.wetness).
 */
export function resolveLighting(input: LightingInput): ResolvedLighting {
  const track = TIME_OF_DAY_TRACKS[input.hour < 12 ? 'morning' : 'evening'];
  const e = input.sunElevationDeg;
  let res: ResolvedLighting;
  const first = track[0]!;
  const last = track[track.length - 1]!;
  if (e <= first[0]) res = presetToResolved(LIGHTING_PRESETS[first[1]]);
  else if (e >= last[0]) res = presetToResolved(LIGHTING_PRESETS[last[1]]);
  else {
    let i = 0;
    while (i < track.length - 2 && e > track[i + 1]![0]) i++;
    const [e0, p0] = track[i]!;
    const [e1, p1] = track[i + 1]!;
    res = lerpResolved(presetToResolved(LIGHTING_PRESETS[p0]), presetToResolved(LIGHTING_PRESETS[p1]), smooth(e0, e1, e));
  }
  const wx = input.weather;
  const monsoonW = clamp01(Math.max((wx.cloudCover - 0.45) / 0.45, wx.rain * 1.25));
  const stormW = wx.kind === 'storm' ? 1 : 0;
  const hazeW = wx.kind === 'hazy' ? 0.85 : input.season === 'grishma' ? 0.45 : 0;
  const dustW = wx.kind === 'dust_storm' ? 1 : 0;
  const fogW = wx.kind === 'fog' ? 1 : input.season === 'shishira' && input.hour < 10 ? 0.45 * (1 - smooth(5, 25, e)) : 0;
  res = applyOverlay(res, WEATHER_OVERLAYS.monsoon, monsoonW * (1 - stormW));
  res = applyOverlay(res, WEATHER_OVERLAYS.storm, stormW);
  res = applyOverlay(res, WEATHER_OVERLAYS.haze, hazeW * (1 - monsoonW));
  res = applyOverlay(res, WEATHER_OVERLAYS.dust, dustW);
  res = applyOverlay(res, WEATHER_OVERLAYS.fog, fogW);
  res.weights.monsoon = Math.max(monsoonW, stormW);
  res.weights.haze = Math.max(hazeW * (1 - monsoonW), dustW);
  res.weights.fog = fogW;
  if (res.weights.monsoon > 0.6) res.dominant = 'monsoon';
  else if (res.weights.fog > 0.6) res.dominant = 'winter_fog';
  else if (res.weights.haze > 0.6 && res.weights.noon > 0.5) res.dominant = 'dry_haze';
  return res;
}

/** Resolve a hero-mode mood (base preset + overrides), linear. */
export function resolveHeroMood(mood: HeroMood): ResolvedLighting {
  const m = HERO_MOODS[mood];
  const p = LIGHTING_PRESETS[m.base];
  const o = m.overrides;
  const fog: FogParams = { ...p.fog, ...(o.fog ?? {}), mist: { ...p.fog.mist, ...(o.fog?.mist ?? {}) } };
  const merged: LightingPreset = {
    ...p,
    fog,
    shafts: { ...p.shafts, ...(o.shafts ?? {}) },
    exposure: o.exposure ?? p.exposure,
    bloom: { ...p.bloom, ...(o.bloom ?? {}) },
    grade: { ...p.grade, ...(o.grade ?? {}) },
    wetness: o.wetness ?? p.wetness,
    practicals: o.practicals ?? p.practicals,
    ambientFx: { ...p.ambientFx, ...(o.ambientFx ?? {}) },
  };
  return presetToResolved(merged);
}

/** Unit vector TOWARD the sun in three.js space (+X east, +Y up, +Z south) from compass angles. */
export function sunDirection(elevationDeg: number, azimuthDeg: number): [number, number, number] {
  const el = elevationDeg * DEG;
  const az = azimuthDeg * DEG;
  const c = Math.cos(el);
  return [c * Math.sin(az), Math.sin(el), -c * Math.cos(az)];
}

/** scene.environmentIntensity that calibrates an IBL source of the given horizontal irradiance. */
export function environmentIntensityFor(r: ResolvedLighting, sourceIrradiance: number): number {
  return sourceIrradiance > 1e-6 ? r.skyIrradiance / sourceIrradiance : 0;
}

/**
 * Fog colors are authored as DISPLAYED colors (what distant haze looks like on screen). Convert to the
 * radiance the fog shader mixes in before tone mapping: ACES in three.js scales by exposure / 0.6.
 */
export function fogRadiance(colorLinear: readonly number[], exposure: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const k = 0.6 / Math.max(1e-3, exposure);
  out[0] = colorLinear[0]! * k;
  out[1] = colorLinear[1]! * k;
  out[2] = colorLinear[2]! * k;
  return out;
}

/**
 * Practical lights (fire, lamps). Color temperatures from the art bible; intensity is a PointLight
 * intensity in the game scale at distance-decay 2. Only the nearest N (quality) are real lights; the rest
 * are emissive sprites + bloom.
 */
export const PRACTICAL_LIGHTS = {
  oilLamp: { color: '#ffa04a', intensity: 1.2, rangeM: 4, flicker: 0.12, maxLights: { low: 0, medium: 2, high: 6, ultra: 12 } },
  torch: { color: '#ff8a3a', intensity: 6, rangeM: 9, flicker: 0.2, maxLights: { low: 1, medium: 4, high: 8, ultra: 16 } },
  brazier: { color: '#ff7a30', intensity: 10, rangeM: 12, flicker: 0.25, maxLights: { low: 1, medium: 2, high: 4, ultra: 8 } },
  burningBuilding: { color: '#ff6a24', intensity: 40, rangeM: 30, flicker: 0.35, maxLights: { low: 1, medium: 2, high: 3, ultra: 4 } },
  lightningFlash: { color: '#d8e2ff', intensity: 9, rangeM: 0, flicker: 0, maxLights: { low: 1, medium: 1, high: 1, ultra: 1 } },
} as const;
