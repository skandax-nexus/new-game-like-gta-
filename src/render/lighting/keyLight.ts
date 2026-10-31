/**
 * Twilight key-light model: the sun key and the moon key cross-fade by INTENSITY, each on its own direction (Art
 * Director round 2, R2-1). OWNER: Graphics Developer - Lighting, Atmosphere & Post (GFX-01). Pure (no three.js):
 * EnvironmentRig applies it, tests/render/lighting/keylight.test.ts pins it.
 *
 * - Sun key: its own direction (elevation clamped to KEY_MIN_ELEVATION_DEG so a grazing sun never smears the map).
 *   Weight: TWILIGHT_KEY_CAP x smoothstep(-4, 3, solar elevation) while the direction is clamped (true sun below
 *   3 deg: such a key never carries more than 25 % of the resolved intensity), rising from 25 % at 3 deg to full at
 *   SUN_KEY_FULL_DEG (5.5 deg). Golden 17.4 h (sun at 6.2 deg) is unchanged. The Art Director's "no key below 8 deg
 *   above 25 %" cannot hold literally together with "golden 17.4 h unchanged" (that sun is at 6.2 deg at 100 %), so
 *   the cap applies to the clamped (artificial-direction) key; a real sun between 3 and 5.5 deg ramps up.
 * - Moon key: its own 25-62 deg direction (MOON_KEY_ELEVATION_DEG), weight smoothstep over the mirrored solar
 *   elevation MOON_RISE_DEG (6 -> 30 deg): it comes in as twilight ends and is full well before 22 h (night unchanged).
 *   While it is still rising its penumbra stays wide (twilight scatter, TWILIGHT_KEY_SOFTNESS_DEG) and narrows to
 *   the preset's moon softness at full weight.
 * - One shadow caster: the stronger key. The cascades switch direction at the intensity crossover, which lies in
 *   the gap between -4 and -6 deg where both weights are ~0, so the switch is invisible.
 * - Energy: the flat-ground irradiance the previous direction-lerp model delivered (sun phase smoothstep(-8, -2) x
 *   sun key + the rest x moon key) and the new keys no longer carry is returned as `fillIrradiance`; the rig adds it
 *   to the hemisphere fill (diffuse sky light, no shadow). An afterglow frame keeps its level but is nearly
 *   shadowless, as the Art Director asked (twilight lit:shadow <= 1.8:1).
 */

/** The sun key never drops below this elevation (deg); below it the key only fades out. */
export const KEY_MIN_ELEVATION_DEG = 3;
/** Sun key weight below the clamp = TWILIGHT_KEY_CAP x smoothstep(edge0, edge1, solar elevation deg). */
export const SUN_KEY_FADE_DEG: readonly [number, number] = [-4, 3];
/** Max weight of a key whose direction is clamped (true sun below KEY_MIN_ELEVATION_DEG). */
export const TWILIGHT_KEY_CAP = 0.25;
/** Solar elevation (deg) from which the sun key is at full weight (TWILIGHT_KEY_CAP at KEY_MIN_ELEVATION_DEG). */
export const SUN_KEY_FULL_DEG = 5.5;
/** Moon key weight = smoothstep(edge0, edge1, -solar elevation deg). */
export const MOON_RISE_DEG: readonly [number, number] = [6, 30];
/** Moon key elevation range (deg): a readable night key, never grazing, never straight down. */
export const MOON_KEY_ELEVATION_DEG: readonly [number, number] = [25, 62];
/** The previous model's sun -> moon direction hand-over (solar elevation deg), used only for energy bookkeeping. */
export const LEGACY_HANDOVER_DEG: readonly [number, number] = [-8, -2];
/** Penumbra (sun angular radius, deg) of a key that is fading in or out: twilight light is scattered and soft. */
export const TWILIGHT_KEY_SOFTNESS_DEG = 3;
/** Share of the removed key irradiance returned as sky fill (1 = energy-conserving on flat ground). */
export const TWILIGHT_FILL_SHARE = 1;

const DEG = Math.PI / 180;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export interface TwilightKey {
  /** Sun key weight 0..1 (x the resolved sunIntensity). */
  sunWeight: number;
  /** Moon key weight 0..1 (x the resolved sunIntensity, which is the moon's at night). */
  moonWeight: number;
  /** True when the moon key is the stronger one (the cascades cast from the moon direction). */
  moonCasts: boolean;
  /** Weight of the single shadow-casting key light (sun + moon, both on the caster's direction). */
  keyWeight: number;
  /** Sun key elevation (deg, clamped) and moon key elevation (deg). */
  sunKeyElevationDeg: number;
  moonKeyElevationDeg: number;
  /** Flat-ground irradiance (in units of the resolved sunIntensity) moved to the sky fill. */
  fillIrradiance: number;
  /** Penumbra factor 0..1: 1 = fully twilight-soft (TWILIGHT_KEY_SOFTNESS_DEG), 0 = the preset's softness. */
  twilightSoftness: number;
}

export function createTwilightKey(): TwilightKey {
  return { sunWeight: 1, moonWeight: 0, moonCasts: false, keyWeight: 1, sunKeyElevationDeg: 45, moonKeyElevationDeg: 25, fillIrradiance: 0, twilightSoftness: 0 };
}

/** Moon key elevation (deg) for a solar elevation: mirrored, clamped to MOON_KEY_ELEVATION_DEG. */
export function moonKeyElevationDeg(sunElevationDeg: number): number {
  return Math.min(MOON_KEY_ELEVATION_DEG[1], Math.max(MOON_KEY_ELEVATION_DEG[0], -sunElevationDeg));
}

/** Sun key weight for a solar elevation (deg): see the header. Continuous (25 % at the clamp elevation). */
export function sunKeyWeight(sunElevationDeg: number): number {
  const e = sunElevationDeg;
  if (e <= KEY_MIN_ELEVATION_DEG) return TWILIGHT_KEY_CAP * smoothstep(SUN_KEY_FADE_DEG[0], SUN_KEY_FADE_DEG[1], e);
  return TWILIGHT_KEY_CAP + (1 - TWILIGHT_KEY_CAP) * smoothstep(KEY_MIN_ELEVATION_DEG, SUN_KEY_FULL_DEG, e);
}

/** Evaluate the twilight key model for a solar elevation (deg). Allocation-free with `out`. */
export function twilightKey(sunElevationDeg: number, out: TwilightKey = createTwilightKey()): TwilightKey {
  const e = sunElevationDeg;
  const sunW = sunKeyWeight(e);
  const moonW = smoothstep(MOON_RISE_DEG[0], MOON_RISE_DEG[1], -e);
  const sunEl = Math.max(KEY_MIN_ELEVATION_DEG, e);
  const moonEl = moonKeyElevationDeg(e);
  const sinSun = Math.sin(sunEl * DEG);
  const sinMoon = Math.sin(moonEl * DEG);
  out.sunWeight = sunW;
  out.moonWeight = moonW;
  out.moonCasts = moonW > sunW;
  out.keyWeight = Math.min(1, sunW + moonW);
  out.sunKeyElevationDeg = sunEl;
  out.moonKeyElevationDeg = moonEl;
  // Previous model: one key (intensity 1) whose direction moved from the sun to the moon over LEGACY_HANDOVER_DEG.
  const phase = smoothstep(LEGACY_HANDOVER_DEG[0], LEGACY_HANDOVER_DEG[1], e);
  const nominal = phase * sinSun + (1 - phase) * sinMoon;
  const delivered = out.keyWeight * (out.moonCasts ? sinMoon : sinSun);
  out.fillIrradiance = Math.max(0, nominal - delivered) * TWILIGHT_FILL_SHARE;
  out.twilightSoftness = out.moonCasts ? 1 - moonW : sunW < 1 ? 1 - sunW : 0;
  return out;
}

/** Key softness (sun angular radius, deg) for a preset softness under the twilight model. */
export function twilightKeySoftness(presetSoftnessDeg: number, k: TwilightKey): number {
  const tw = Math.max(presetSoftnessDeg, TWILIGHT_KEY_SOFTNESS_DEG);
  return presetSoftnessDeg + (tw - presetSoftnessDeg) * k.twilightSoftness;
}

/** Cast-shadow length in caster heights for a key elevation (deg). */
export function shadowLengthRatio(keyElevationDeg: number): number {
  return 1 / Math.tan(Math.max(0.1, keyElevationDeg) * DEG);
}
