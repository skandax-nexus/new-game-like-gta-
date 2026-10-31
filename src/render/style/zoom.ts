/**
 * "Far = Age of Empires clarity, near = Wukong fidelity": the look as a function of camera distance.
 * OWNER: Art Director. Consumed by the RTS/hero cameras, post pipeline, LOD systems and materials
 * (Lead Graphics). Intent and rules: docs/ART_BIBLE.md §2.
 *
 * Bands are keyed by the camera's distance to its focus point (orbit radius, meters). The resolver blends
 * neighbouring bands in log-distance, so zooming is continuous (no popping grade or fog). Quality tiers
 * clamp what a band may enable (see QUALITY_CAPS); bands never override QualitySettings upwards.
 */
import type { QualityTier } from '../../core/types';

export const ZOOM_BAND_IDS = ['strategic', 'operational', 'tactical', 'close', 'hero'] as const;
export type ZoomBandId = (typeof ZOOM_BAND_IDS)[number];

export interface ZoomLook {
  id: ZoomBandId;
  label: string;
  /** Camera-to-focus distance (m) at which this band is fully active. */
  distanceM: number;
  /** Recommended camera framing at this distance (RTS camera blends pitch/FOV along the zoom curve). */
  camera: { fovDeg: number; pitchDeg: number };
  /** Multiplies every LOD switch distance (>1 keeps detail longer). */
  lodBias: number;
  /** Material detail weights (0..1): tiling detail normal, macro variation, specular AA (roughness widen). */
  material: { detailNormal: number; macro: number; specularAA: number; parallax: number };
  /** Readability aids (AoE layer). */
  readability: {
    /** Extra saturation/value applied to team-colored cloth masks (1 = as dyed). */
    teamColorBoost: number;
    /** Sun-colored fresnel rim on units (0..1) to separate them from the ground. */
    unitRim: number;
    /** Screen-space outline for hovered/selected units and buildings (px at 1080p). */
    outlinePx: number;
    /** Scale of banners/standards and building finials (1 = real size). */
    bannerScale: number;
    /** Formation cards (class icon + strength/morale bars) visible. */
    formationCards: boolean;
    /** Ground decal footprints for formations (0..1 opacity). */
    footprintOpacity: number;
    /** Strategic tokens (army markers) instead of soldiers, 0..1 crossfade. */
    tokens: number;
  };
  vegetation: { grassDensity: number; treeImpostorFromM: number; cropDetail: number; windAmp: number };
  atmosphere: {
    /** Multiplier on the lighting preset fog density (strategic view keeps the map readable). */
    fogDensityScale: number;
    /** 0..1 strength of aerial perspective tint at the far plane. */
    aerialPerspective: number;
    /** Cloud shadows scrolling on the ground (0..1). */
    cloudShadows: number;
    /** Multiplier on volumetric shaft strength. */
    shaftsScale: number;
  };
  post: {
    aoScale: number;
    aoRadiusM: number;
    bloomScale: number;
    /** Depth of field: 0 = off. Hero/cutscenes focus on the subject, the close band uses a subtle blur (never a tilt-shift miniature look). */
    dof: { strength: number; fStop: number; maxBlurPx: number };
    vignetteAdd: number;
    saturationMul: number;
    contrastMul: number;
    /** Post sharpen (0..0.5) - helps readability at distance after TAA/FXAA. */
    sharpen: number;
    /** Film grain amplitude (0..0.05). */
    grain: number;
    /** Chromatic aberration at the frame edge (UV units, 0..0.003). */
    chromaticAberration: number;
  };
  shadows: { distanceM: number; cascadeSplitLambda: number; softnessScale: number; contact: boolean };
}

export const ZOOM_BANDS: readonly ZoomLook[] = [
  {
    id: 'strategic',
    label: 'Strategic map (world command)',
    distanceM: 2600,
    camera: { fovDeg: 38, pitchDeg: 58 },
    lodBias: 0.8,
    material: { detailNormal: 0, macro: 1, specularAA: 1, parallax: 0 },
    readability: { teamColorBoost: 1.35, unitRim: 0.3, outlinePx: 3, bannerScale: 3, formationCards: false, footprintOpacity: 0, tokens: 1 },
    vegetation: { grassDensity: 0, treeImpostorFromM: 0, cropDetail: 0, windAmp: 0.3 },
    atmosphere: { fogDensityScale: 0.35, aerialPerspective: 0.65, cloudShadows: 0.6, shaftsScale: 0 },
    post: { aoScale: 0.6, aoRadiusM: 12, bloomScale: 0.6, dof: { strength: 0, fStop: 16, maxBlurPx: 0 }, vignetteAdd: -0.04, saturationMul: 1.04, contrastMul: 1.02, sharpen: 0.25, grain: 0, chromaticAberration: 0 },
    shadows: { distanceM: 3200, cascadeSplitLambda: 0.6, softnessScale: 2, contact: false },
  },
  {
    id: 'operational',
    label: 'Battle overview / province view',
    distanceM: 700,
    camera: { fovDeg: 40, pitchDeg: 52 },
    lodBias: 0.9,
    material: { detailNormal: 0.25, macro: 1, specularAA: 0.8, parallax: 0 },
    readability: { teamColorBoost: 1.25, unitRim: 0.25, outlinePx: 2.5, bannerScale: 1.8, formationCards: true, footprintOpacity: 0.55, tokens: 0 },
    vegetation: { grassDensity: 0.15, treeImpostorFromM: 250, cropDetail: 0.4, windAmp: 0.6 },
    atmosphere: { fogDensityScale: 0.6, aerialPerspective: 0.55, cloudShadows: 0.45, shaftsScale: 0.3 },
    post: { aoScale: 0.8, aoRadiusM: 4, bloomScale: 0.8, dof: { strength: 0, fStop: 16, maxBlurPx: 0 }, vignetteAdd: -0.02, saturationMul: 1.02, contrastMul: 1.02, sharpen: 0.2, grain: 0, chromaticAberration: 0 },
    shadows: { distanceM: 1100, cascadeSplitLambda: 0.7, softnessScale: 1.4, contact: false },
  },
  {
    id: 'tactical',
    label: 'Default battle / settlement view (AoE IV framing)',
    distanceM: 220,
    camera: { fovDeg: 42, pitchDeg: 46 },
    lodBias: 1,
    material: { detailNormal: 0.65, macro: 0.9, specularAA: 0.5, parallax: 0 },
    readability: { teamColorBoost: 1.12, unitRim: 0.15, outlinePx: 2, bannerScale: 1.3, formationCards: true, footprintOpacity: 0.4, tokens: 0 },
    vegetation: { grassDensity: 0.7, treeImpostorFromM: 180, cropDetail: 0.8, windAmp: 1 },
    atmosphere: { fogDensityScale: 1, aerialPerspective: 0.45, cloudShadows: 0.3, shaftsScale: 0.6 },
    post: { aoScale: 1, aoRadiusM: 1.5, bloomScale: 1, dof: { strength: 0, fStop: 16, maxBlurPx: 0 }, vignetteAdd: 0, saturationMul: 1, contrastMul: 1, sharpen: 0.12, grain: 0, chromaticAberration: 0 },
    shadows: { distanceM: 420, cascadeSplitLambda: 0.75, softnessScale: 1, contact: false },
  },
  {
    id: 'close',
    label: 'Zoomed-in battle cam / settlement close-up',
    distanceM: 45,
    camera: { fovDeg: 45, pitchDeg: 26 },
    lodBias: 1.25,
    material: { detailNormal: 1, macro: 0.8, specularAA: 0.2, parallax: 0.6 },
    readability: { teamColorBoost: 1, unitRim: 0.06, outlinePx: 1.5, bannerScale: 1, formationCards: true, footprintOpacity: 0.25, tokens: 0 },
    vegetation: { grassDensity: 1, treeImpostorFromM: 140, cropDetail: 1, windAmp: 1 },
    atmosphere: { fogDensityScale: 1.1, aerialPerspective: 0.35, cloudShadows: 0.2, shaftsScale: 1 },
    post: { aoScale: 1.1, aoRadiusM: 0.9, bloomScale: 1.1, dof: { strength: 0.35, fStop: 8, maxBlurPx: 4 }, vignetteAdd: 0.05, saturationMul: 1, contrastMul: 1.03, sharpen: 0.05, grain: 0.015, chromaticAberration: 0.0006 },
    shadows: { distanceM: 160, cascadeSplitLambda: 0.8, softnessScale: 0.8, contact: true },
  },
  {
    id: 'hero',
    label: 'Hero third-person / cutscene (Wukong fidelity)',
    distanceM: 4.5,
    camera: { fovDeg: 50, pitchDeg: 8 },
    lodBias: 1.6,
    material: { detailNormal: 1, macro: 0.7, specularAA: 0.1, parallax: 1 },
    readability: { teamColorBoost: 1, unitRim: 0, outlinePx: 0, bannerScale: 1, formationCards: false, footprintOpacity: 0, tokens: 0 },
    vegetation: { grassDensity: 1, treeImpostorFromM: 120, cropDetail: 1, windAmp: 1 },
    atmosphere: { fogDensityScale: 1.25, aerialPerspective: 0.3, cloudShadows: 0.15, shaftsScale: 1.25 },
    post: { aoScale: 1.15, aoRadiusM: 0.6, bloomScale: 1.2, dof: { strength: 1, fStop: 2.8, maxBlurPx: 10 }, vignetteAdd: 0.1, saturationMul: 0.98, contrastMul: 1.05, sharpen: 0, grain: 0.025, chromaticAberration: 0.0012 },
    shadows: { distanceM: 90, cascadeSplitLambda: 0.85, softnessScale: 0.6, contact: true },
  },
];

/**
 * Cutscene / cinematic-camera focus (AD GFX-01 round 3): pass to `post.setFocus(subjectDistanceM, fStop, maxBlurPx,
 * strength)` while a scripted shot runs, then `setFocus(null)` to return to the band. A wider aperture and more blur
 * than the hero gameplay band (f/2.8, 10 px) give a Wukong-style foreground melt through the near-field layer; never use
 * it during play. Quality caps still apply (no DoF below high).
 */
export const CINEMATIC_DOF: Readonly<{ strength: number; fStop: number; maxBlurPx: number }> = { strength: 1, fStop: 2, maxBlurPx: 24 };

/** What each quality tier may enable regardless of the band (bands only scale down from QualitySettings). */
export const QUALITY_CAPS: Readonly<Record<QualityTier, { dof: boolean; grain: boolean; chromaticAberration: boolean; contactShadows: boolean; parallax: boolean; shafts: boolean; maxOutlinePx: number }>> = {
  low: { dof: false, grain: false, chromaticAberration: false, contactShadows: false, parallax: false, shafts: false, maxOutlinePx: 2 },
  medium: { dof: false, grain: false, chromaticAberration: false, contactShadows: false, parallax: false, shafts: true, maxOutlinePx: 2.5 },
  high: { dof: true, grain: true, chromaticAberration: false, contactShadows: false, parallax: true, shafts: true, maxOutlinePx: 3 },
  ultra: { dof: true, grain: true, chromaticAberration: true, contactShadows: true, parallax: true, shafts: true, maxOutlinePx: 3 },
};

function cloneLook(b: ZoomLook): ZoomLook {
  return {
    ...b,
    camera: { ...b.camera },
    material: { ...b.material },
    readability: { ...b.readability },
    vegetation: { ...b.vegetation },
    atmosphere: { ...b.atmosphere },
    post: { ...b.post, dof: { ...b.post.dof } },
    shadows: { ...b.shadows },
  };
}

/** A mutable look to reuse with resolveZoomLook (allocation-free per frame). */
export function createZoomLook(): ZoomLook {
  return cloneLook(ZOOM_BANDS[2]!);
}

const l = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Blend the look for a camera-to-focus distance. Writes into `out` (reuse it per frame) and returns it.
 * Blending is linear in log(distance) between the two neighbouring bands with a smoothstep.
 */
export function resolveZoomLook(distanceM: number, out: ZoomLook = createZoomLook()): ZoomLook {
  const bands = ZOOM_BANDS;
  const d = Math.max(0.5, distanceM);
  // Bands are ordered far -> near.
  let i = 0;
  while (i < bands.length - 1 && d < bands[i + 1]!.distanceM) i++;
  const a = bands[i]!;
  const b = bands[Math.min(i + 1, bands.length - 1)]!;
  let t = 0;
  if (a !== b && d < a.distanceM) {
    const la = Math.log(a.distanceM);
    const lb = Math.log(b.distanceM);
    const x = Math.min(1, Math.max(0, (la - Math.log(d)) / (la - lb)));
    t = x * x * (3 - 2 * x);
  } else if (a === b && d < a.distanceM) {
    t = 0;
  }
  const near = t >= 0.5 ? b : a;
  out.id = near.id;
  out.label = near.label;
  out.distanceM = d;
  out.camera.fovDeg = l(a.camera.fovDeg, b.camera.fovDeg, t);
  out.camera.pitchDeg = l(a.camera.pitchDeg, b.camera.pitchDeg, t);
  out.lodBias = l(a.lodBias, b.lodBias, t);
  out.material.detailNormal = l(a.material.detailNormal, b.material.detailNormal, t);
  out.material.macro = l(a.material.macro, b.material.macro, t);
  out.material.specularAA = l(a.material.specularAA, b.material.specularAA, t);
  out.material.parallax = l(a.material.parallax, b.material.parallax, t);
  const ra = a.readability;
  const rb = b.readability;
  out.readability.teamColorBoost = l(ra.teamColorBoost, rb.teamColorBoost, t);
  out.readability.unitRim = l(ra.unitRim, rb.unitRim, t);
  out.readability.outlinePx = l(ra.outlinePx, rb.outlinePx, t);
  out.readability.bannerScale = l(ra.bannerScale, rb.bannerScale, t);
  out.readability.formationCards = near.readability.formationCards;
  out.readability.footprintOpacity = l(ra.footprintOpacity, rb.footprintOpacity, t);
  out.readability.tokens = l(ra.tokens, rb.tokens, t);
  out.vegetation.grassDensity = l(a.vegetation.grassDensity, b.vegetation.grassDensity, t);
  out.vegetation.treeImpostorFromM = l(a.vegetation.treeImpostorFromM, b.vegetation.treeImpostorFromM, t);
  out.vegetation.cropDetail = l(a.vegetation.cropDetail, b.vegetation.cropDetail, t);
  out.vegetation.windAmp = l(a.vegetation.windAmp, b.vegetation.windAmp, t);
  out.atmosphere.fogDensityScale = l(a.atmosphere.fogDensityScale, b.atmosphere.fogDensityScale, t);
  out.atmosphere.aerialPerspective = l(a.atmosphere.aerialPerspective, b.atmosphere.aerialPerspective, t);
  out.atmosphere.cloudShadows = l(a.atmosphere.cloudShadows, b.atmosphere.cloudShadows, t);
  out.atmosphere.shaftsScale = l(a.atmosphere.shaftsScale, b.atmosphere.shaftsScale, t);
  const pa = a.post;
  const pb = b.post;
  out.post.aoScale = l(pa.aoScale, pb.aoScale, t);
  out.post.aoRadiusM = Math.exp(l(Math.log(pa.aoRadiusM), Math.log(pb.aoRadiusM), t));
  out.post.bloomScale = l(pa.bloomScale, pb.bloomScale, t);
  out.post.dof.strength = l(pa.dof.strength, pb.dof.strength, t);
  out.post.dof.fStop = l(pa.dof.fStop, pb.dof.fStop, t);
  out.post.dof.maxBlurPx = l(pa.dof.maxBlurPx, pb.dof.maxBlurPx, t);
  out.post.vignetteAdd = l(pa.vignetteAdd, pb.vignetteAdd, t);
  out.post.saturationMul = l(pa.saturationMul, pb.saturationMul, t);
  out.post.contrastMul = l(pa.contrastMul, pb.contrastMul, t);
  out.post.sharpen = l(pa.sharpen, pb.sharpen, t);
  out.post.grain = l(pa.grain, pb.grain, t);
  out.post.chromaticAberration = l(pa.chromaticAberration, pb.chromaticAberration, t);
  out.shadows.distanceM = Math.exp(l(Math.log(a.shadows.distanceM), Math.log(b.shadows.distanceM), t));
  out.shadows.cascadeSplitLambda = l(a.shadows.cascadeSplitLambda, b.shadows.cascadeSplitLambda, t);
  out.shadows.softnessScale = l(a.shadows.softnessScale, b.shadows.softnessScale, t);
  out.shadows.contact = near.shadows.contact;
  return out;
}

/** Apply the tier caps to a resolved look in place. */
export function capZoomLook(look: ZoomLook, tier: QualityTier): ZoomLook {
  const c = QUALITY_CAPS[tier];
  if (!c.dof) look.post.dof.strength = 0;
  if (!c.grain) look.post.grain = 0;
  if (!c.chromaticAberration) look.post.chromaticAberration = 0;
  if (!c.contactShadows) look.shadows.contact = false;
  if (!c.parallax) look.material.parallax = 0;
  if (!c.shafts) look.atmosphere.shaftsScale = 0;
  look.readability.outlinePx = Math.min(look.readability.outlinePx, c.maxOutlinePx);
  return look;
}
