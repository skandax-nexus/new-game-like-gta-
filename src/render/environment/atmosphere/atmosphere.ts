/**
 * Atmosphere frame parameters (ART_BIBLE §4.5): ResolvedLighting + ZoomLook + wind -> the shared fog slots of
 * `samG` read by the material fog chunk, custom shaders (injectHeightFog) and the sky dome. OWNER: Graphics
 * Developer - Lighting, Atmosphere & Post (GFX-01). Called by EnvironmentRig every frame (allocation-free).
 *
 * - Height fog: colours are DISPLAYED colours converted to radiance with fogRadiance(colour, exposure); density x
 *   ZoomLook.atmosphere.fogDensityScale; falloff, base height, in-scatter lobe and max opacity from the resolver.
 * - Mist slab: extra density below base + mist.topM, broken up by 2 octaves of world noise (40 m, 9 m, amplitude
 *   0.5) scrolling with the wind at 0.3x (tier `height_mist` only).
 * - Sky-dome fog: the same fog at d = 20 km, clamp 0.6 (the sky melts into the haze at the horizon).
 * - Aerial perspective (ZoomLook.atmosphere.aerialPerspective) and the map-edge fade blend distant geometry into
 *   the horizon colour ring (8 azimuths of the calibrated sky + sky-dome fog), so the map edge has no seam.
 * - Low tier (`exp2`): mode 0 - three's FogExp2 (density x 0.6, set on scene.fog by the rig) + aerial / edge fade.
 */
import type { QualitySettings } from '../../../core/types';
import { fogRadiance, type ResolvedLighting } from '../../style/lighting';
import { G, g } from '../../materials/chunks/globals';
import { MIST_NOISE, SKY_FOG_CLAMP, SKY_FOG_DISTANCE_M, skyDomeFogAlpha } from './fogMath';

export type FogMode = 0 | 1 | 2;

/** QualitySettings.heightFog -> shader mode (0 classic FogExp2, 1 height fog, 2 height fog + mist noise). */
export function fogModeFor(q: QualitySettings): FogMode {
  if (!q.fog) return 0;
  return q.heightFog === 'height_mist' ? 2 : q.heightFog === 'height' ? 1 : 0;
}

/** Low tier FogExp2 density scale (ART_BIBLE §4.5 / §13). */
export const EXP2_DENSITY_SCALE = 0.6;
/** Map-edge fade: starts / ends at these fractions of the half map size (Chebyshev distance from the centre). */
export const EDGE_FADE = { inner: 0.84, outer: 0.995 } as const;

export interface AtmosphereInputs {
  mode: FogMode;
  /** ZoomLook.atmosphere.fogDensityScale (0.35 strategic .. 1.25 hero). */
  fogDensityScale: number;
  /** ZoomLook.atmosphere.aerialPerspective (0..1). */
  aerialPerspective: number;
  /** Distance (m) at which aerial perspective reaches its full strength. */
  aerialReferenceM: number;
  /** Map bounds for the edge fade (null = unknown: no edge fade). */
  bounds: { cx: number; cz: number; half: number } | null;
  /** Unit vector toward the light the fog scatters (sun by day, moon at night). */
  scatterDir: { x: number; y: number; z: number };
  /** Wind direction (unit xz) and speed (m/s) + clock (s) for the mist-noise scroll. */
  windX: number;
  windZ: number;
  windSpeed: number;
  time: number;
  /** Camera height (m) - the horizon ring's sky-fog amount depends on it. */
  cameraY: number;
  /** Raw (uncalibrated) horizon sky radiance at 8 azimuths (rgb triples), or null when unknown. */
  horizonRaw: ArrayLike<number> | null;
  /** IBL calibration applied to the raw sky (scene.environmentIntensity). */
  calibration: number;
  /** Lightning multiplier on the sky (1 = none). */
  skyMultiplier: number;
}

const tmpFog: [number, number, number] = [0, 0, 0];
const tmpIn: [number, number, number] = [0, 0, 0];

/** Write every fog / atmosphere slot of samG for this frame. */
export function writeAtmosphere(r: ResolvedLighting, inp: AtmosphereInputs): void {
  const fogCol = fogRadiance(r.fogColor, r.exposure, tmpFog);
  const inCol = fogRadiance(r.fogInscatter, r.exposure, tmpIn);
  const density = r.fogDensity * inp.fogDensityScale;
  g(G.FOG_COLOR).set(fogCol[0], fogCol[1], fogCol[2], inp.mode);
  g(G.FOG_INSCATTER).set(inCol[0], inCol[1], inCol[2], r.fogInscatterPower);
  const s = inp.scatterDir;
  g(G.FOG_SUN).set(s.x, s.y, s.z, r.fogMaxOpacity);
  // Mist only exists with height fog (tier medium+); the classic FogExp2 path ignores these slots.
  const mist = inp.mode > 0 ? r.mistDensity * inp.fogDensityScale : 0;
  // Density is always written: the sky dome uses it on every tier (the classic FogExp2 material path ignores it).
  g(G.FOG_DENSITY).set(density, r.fogHeightFalloff, r.fogBaseHeight, r.fogBaseHeight + r.mistTopM);
  const scroll = inp.windSpeed * MIST_NOISE.windScroll * inp.time;
  g(G.FOG_MIST).set(mist, inp.mode === 2 ? MIST_NOISE.amplitude : 0, -inp.windX * scroll, -inp.windZ * scroll);
  const b = inp.bounds;
  g(G.FOG_AERIAL).set(inp.aerialPerspective, b ? b.half * EDGE_FADE.inner : 0, b ? b.half * EDGE_FADE.outer : 1, b ? 1 : 0);
  g(G.FOG_MAP).set(b ? b.cx : 0, b ? b.cz : 0, Math.max(1, inp.aerialReferenceM), SKY_FOG_CLAMP);
  g(G.FOG_SKY).set(density > 0 ? SKY_FOG_DISTANCE_M : 0, 1 / MIST_NOISE.octave1M, 1 / MIST_NOISE.octave2M, inp.time);
  // Horizon ring: calibrated sky at +1.5 deg, fogged exactly like the dome (so dome and distant terrain agree).
  const raw = inp.horizonRaw;
  if (!raw) {
    for (let k = 0; k < 8; k++) g(G.HORIZON_RING + k).set(0, 0, 0, 0);
    return;
  }
  const dirY = Math.sin((1.5 * Math.PI) / 180);
  const ce = Math.cos((1.5 * Math.PI) / 180);
  const alpha = skyDomeFogAlpha(density, r.fogHeightFalloff, r.fogBaseHeight, inp.cameraY, dirY, SKY_FOG_CLAMP, SKY_FOG_DISTANCE_M);
  const power = Math.max(1, r.fogInscatterPower);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 - Math.PI;
    const dx = Math.cos(a) * ce;
    const dz = Math.sin(a) * ce;
    const sun = Math.pow(Math.max(dx * s.x + dirY * s.y + dz * s.z, 1e-6), power);
    const k3 = k * 3;
    const m = inp.calibration * inp.skyMultiplier;
    const sr = (raw[k3] as number) * m;
    const sg = (raw[k3 + 1] as number) * m;
    const sb = (raw[k3 + 2] as number) * m;
    const fr = fogCol[0] + (inCol[0] - fogCol[0]) * sun;
    const fg = fogCol[1] + (inCol[1] - fogCol[1]) * sun;
    const fb = fogCol[2] + (inCol[2] - fogCol[2]) * sun;
    g(G.HORIZON_RING + k).set(sr + (fr - sr) * alpha, sg + (fg - sg) * alpha, sb + (fb - sb) * alpha, k === 0 ? 1 : 0);
  }
}

/** Plain-data view of the fog slots (tests, diagnostics, __SAMRAJYA_GFX__). */
export function atmosphereSnapshot(): {
  mode: number;
  density: number;
  falloff: number;
  baseHeight: number;
  maxOpacity: number;
  mistTop: number;
  mistDensity: number;
  mistNoiseAmplitude: number;
  mistNoiseScalesM: [number, number];
  skyFogDistance: number;
  skyFogClamp: number;
  aerial: number;
  edge: [number, number] | null;
  horizonValid: boolean;
} {
  const d = g(G.FOG_DENSITY);
  const m = g(G.FOG_MIST);
  const sky = g(G.FOG_SKY);
  const a = g(G.FOG_AERIAL);
  return {
    mode: g(G.FOG_COLOR).w,
    density: d.x,
    falloff: d.y,
    baseHeight: d.z,
    maxOpacity: g(G.FOG_SUN).w,
    mistTop: d.w,
    mistDensity: m.x,
    mistNoiseAmplitude: m.y,
    mistNoiseScalesM: [sky.y > 0 ? 1 / sky.y : 0, sky.z > 0 ? 1 / sky.z : 0],
    skyFogDistance: sky.x,
    skyFogClamp: g(G.FOG_MAP).w,
    aerial: a.x,
    edge: a.w > 0.5 ? [a.y, a.z] : null,
    horizonValid: g(G.HORIZON_RING).w > 0.5,
  };
}
