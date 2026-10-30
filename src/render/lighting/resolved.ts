/**
 * Allocation-free ResolvedLighting helpers for per-frame blending (hero-district mood cross-fades, exposure eases).
 * OWNER: Graphics Developer - Lighting, Atmosphere & Post (GFX-01).
 *
 * `blendResolvedInto(out, a, b, t)` is the in-place twin of the Art Director's `lerpResolved` (style/lighting.ts):
 * identical maths (geometric blend for sky irradiance, fog density / falloff and exposure so the haze never pumps;
 * the nearer preset names `dominant`), but it writes into a preallocated object. A unit test keeps the two equal.
 */
import { lerpResolved, type ResolvedLighting } from '../style/lighting';

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const geo = (x: number, y: number, t: number): number => (x > 0 && y > 0 ? Math.exp(lerp(Math.log(x), Math.log(y), t)) : lerp(x, y, t));

function mix3(out: [number, number, number], a: readonly number[], b: readonly number[], t: number): void {
  out[0] = lerp(a[0]!, b[0]!, t);
  out[1] = lerp(a[1]!, b[1]!, t);
  out[2] = lerp(a[2]!, b[2]!, t);
}

/** Deep copy (allocates; use once to create a reusable `out`). */
export function cloneResolved(r: ResolvedLighting): ResolvedLighting {
  return lerpResolved(r, r, 0);
}

/** out = lerpResolved(a, b, t) without allocating. `out` may alias `a` (not `b`). */
export function blendResolvedInto(out: ResolvedLighting, a: ResolvedLighting, b: ResolvedLighting, t: number): ResolvedLighting {
  const wo = out.weights;
  const wa = a.weights;
  const wb = b.weights;
  wo.night = lerp(wa.night, wb.night, t);
  wo.dusk = lerp(wa.dusk, wb.dusk, t);
  wo.dawn = lerp(wa.dawn, wb.dawn, t);
  wo.golden = lerp(wa.golden, wb.golden, t);
  wo.noon = lerp(wa.noon, wb.noon, t);
  wo.monsoon = lerp(wa.monsoon, wb.monsoon, t);
  wo.haze = lerp(wa.haze, wb.haze, t);
  wo.fog = lerp(wa.fog, wb.fog, t);
  mix3(out.sunColor, a.sunColor, b.sunColor, t);
  out.sunIntensity = lerp(a.sunIntensity, b.sunIntensity, t);
  out.sunSoftnessDeg = lerp(a.sunSoftnessDeg, b.sunSoftnessDeg, t);
  out.skyIrradiance = geo(a.skyIrradiance, b.skyIrradiance, t);
  mix3(out.hemiSky, a.hemiSky, b.hemiSky, t);
  mix3(out.hemiGround, a.hemiGround, b.hemiGround, t);
  out.hemiIntensity = lerp(a.hemiIntensity, b.hemiIntensity, t);
  mix3(out.fogColor, a.fogColor, b.fogColor, t);
  mix3(out.fogInscatter, a.fogInscatter, b.fogInscatter, t);
  out.fogDensity = geo(a.fogDensity, b.fogDensity, t);
  out.fogHeightFalloff = geo(a.fogHeightFalloff, b.fogHeightFalloff, t);
  out.fogBaseHeight = lerp(a.fogBaseHeight, b.fogBaseHeight, t);
  out.fogInscatterPower = lerp(a.fogInscatterPower, b.fogInscatterPower, t);
  out.fogMaxOpacity = lerp(a.fogMaxOpacity, b.fogMaxOpacity, t);
  out.mistTopM = lerp(a.mistTopM, b.mistTopM, t);
  out.mistDensity = lerp(a.mistDensity, b.mistDensity, t);
  out.shaftsStrength = lerp(a.shaftsStrength, b.shaftsStrength, t);
  out.shaftsDecay = lerp(a.shaftsDecay, b.shaftsDecay, t);
  out.shaftsDensity = lerp(a.shaftsDensity, b.shaftsDensity, t);
  out.exposure = geo(a.exposure, b.exposure, t);
  out.bloomStrength = lerp(a.bloomStrength, b.bloomStrength, t);
  out.bloomRadius = lerp(a.bloomRadius, b.bloomRadius, t);
  out.bloomThreshold = lerp(a.bloomThreshold, b.bloomThreshold, t);
  out.aoIntensity = lerp(a.aoIntensity, b.aoIntensity, t);
  out.aoRadiusM = lerp(a.aoRadiusM, b.aoRadiusM, t);
  const g = out.grade;
  g.contrast = lerp(a.grade.contrast, b.grade.contrast, t);
  g.saturation = lerp(a.grade.saturation, b.grade.saturation, t);
  g.warmth = lerp(a.grade.warmth, b.grade.warmth, t);
  g.lift = lerp(a.grade.lift, b.grade.lift, t);
  g.vignette = lerp(a.grade.vignette, b.grade.vignette, t);
  const tint = g.tint;
  tint[0] = lerp(a.grade.tint[0], b.grade.tint[0], t);
  tint[1] = lerp(a.grade.tint[1], b.grade.tint[1], t);
  tint[2] = lerp(a.grade.tint[2], b.grade.tint[2], t);
  out.wetness = lerp(a.wetness, b.wetness, t);
  out.practicals = lerp(a.practicals, b.practicals, t);
  out.dustMotes = lerp(a.dustMotes, b.dustMotes, t);
  out.mist = lerp(a.mist, b.mist, t);
  out.fireflies = lerp(a.fireflies, b.fireflies, t);
  out.leaves = lerp(a.leaves, b.leaves, t);
  out.keyFill = lerp(a.keyFill, b.keyFill, t);
  out.dominant = t < 0.5 ? a.dominant : b.dominant;
  return out;
}

/** Copy `src` into `out` (no allocation). */
export function copyResolvedInto(out: ResolvedLighting, src: ResolvedLighting): ResolvedLighting {
  return blendResolvedInto(out, src, src, 0);
}
