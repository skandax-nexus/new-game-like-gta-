/**
 * Cascaded sun shadows (ART_BIBLE §13: 1 / 2 / 3 / 4 cascades low..ultra; ARCHITECTURE §19). OWNER: Graphics
 * Developer - Lighting, Atmosphere & Post (GFX-01). Owned by EnvironmentRig (`rig.shadows`).
 *
 * Design
 * - One THREE.DirectionalLight per cascade, each with its own three.js shadow map. Using three's shadow pipeline
 *   (not a custom atlas) means every caster's `customDepthMaterial` is honoured: instanced crowds (GFX-04, VAT) and
 *   vegetation with wind (GFX-03) cast animated shadows without extra work. CONTRACT for those tickets: give every
 *   vertex-animated InstancedMesh a `customDepthMaterial` (MeshDepthMaterial, RGBADepthPacking) running the same
 *   vertex code; set `castShadow` from QualitySettings; nothing else is needed for cascades.
 * - The cascade lights share the key light's colour / intensity. A global chunk (lighting/shadowChunks.ts) makes
 *   lit materials take each cascade light only where its cascade owns the fragment (weights by view depth, blended
 *   over `CSM_BLEND` of a cascade), so N lights still add up to one sun. Lights are created shadow-first and
 *   before any other shadowed directional light, so cascade i is directional shadow index i.
 * - Splits: practical scheme (lambda from ZoomLook.shadows.cascadeSplitLambda) between the camera near plane and the
 *   shadow distance (ZoomLook.shadows.distanceM x tier scale, never closer than 1.25 x the focus distance).
 * - Stability: each cascade is fitted with the bounding sphere of its frustum slice (rotation-invariant size,
 *   radius quantised) and its centre is snapped to whole shadow texels in light space (no shimmering when panning).
 * - Biases scale with the cascade texel: normalBias = 1.4 texels (world m), depth bias = 0.6 texel / depth range;
 *   low's hard cascade 2.2 / 0.8 texels plus a slope-scaled depth bias (NORMAL_BIAS_TEXELS, SLOPE_BIAS_TEXELS).
 * - Casters render back faces into the map (three's default shadowSide for FrontSide materials: closed architecture
 *   self-shadows from its far side, so lit faces never compare against themselves).
 * - Filter per tier: low hard = a fixed tent of nine bilinear (2x2) depth compares in one 4x4 fetch (shadowChunks.ts
 *   samShadowTent: no penumbra growth, but no aliased saw-tooth edges either - AD round 1), medium PCF with a radius from the sun's angular size, high / ultra
 *   PCSS (blocker search + penumbra from r.sunSoftnessDeg x ZoomLook softnessScale).
 * - Far bands use fewer cascades than the tier allows (activeCascadesFor: strategic 1, operational 2). From far away
 *   every caster on the map falls inside every cascade, so each extra cascade re-draws the whole map for detail
 *   nobody can see (world overview @ultra: 475 draws, 311 of them shadow; ARCHITECTURE §15 world < 300). Idle
 *   cascades keep their light and map (same light count: no recompiles, no re-allocation when zooming), are
 *   weighted 0 in the shader (cascade texel 0) and skip their shadow render (shadow.autoUpdate = false).
 * Allocation-free per frame.
 */
import * as THREE from 'three';
import type { QualitySettings } from '../../core/types';
import type { ZoomBandId, ZoomLook } from '../style/zoom';
import { G, g } from '../materials/chunks/globals';
import { pcfRadiusFromSoftness } from './ibl';

/** Fraction of each cascade over which it blends into the next one. */
export const CSM_BLEND = 0.12;
/** How far beyond a cascade's slice (toward the light) casters are captured (m). */
export const CSM_CASTER_EXTENT_M = 220;
/** First split starts at this fraction of the camera-to-focus distance (RTS cameras, focus > 12 m). */
export const SPLIT_NEAR_OF_FOCUS = 0.3;
/**
 * Biases per filter (in shadow texels of the cascade). The low tier's single 'hard' cascade covers the whole hero /
 * close band with 1024^2 texels (~0.1 m each in the hero band), so it gets a wider normal offset and a slope-scaled
 * depth bias (shadowChunks.ts) against acne on grazing-lit walls (AD round 1, blocker 2).
 */
export const NORMAL_BIAS_TEXELS: Readonly<Record<ShadowFilter, number>> = { hard: 2.2, pcf: 1.4, pcss: 1.4 };
export const DEPTH_BIAS_TEXELS: Readonly<Record<ShadowFilter, number>> = { hard: 0.8, pcf: 0.6, pcss: 0.6 };
/** Slope-scaled depth bias of the hard filter: texels per unit tan(light angle), tan capped (grazing light). */
export const SLOPE_BIAS_TEXELS = 0.6;
export const SLOPE_BIAS_MAX_TAN = 6;

/** Debug cascade tints (?csm=1): red, green, blue, yellow. */
export const CSM_DEBUG_COLORS: readonly (readonly [number, number, number])[] = [
  [1, 0.35, 0.35],
  [0.35, 1, 0.35],
  [0.4, 0.55, 1],
  [1, 1, 0.3],
];

/** Max cascades in use per zoom band (bands not listed use the tier's count). See the design notes above. */
export const CASCADE_CAP_BY_BAND: Readonly<Partial<Record<ZoomBandId, number>>> = { strategic: 1, operational: 2 };

/** Cascades in use for a view: the tier's count, capped for far zoom bands (CASCADE_CAP_BY_BAND). */
export function activeCascadesFor(count: number, look: ZoomLook): number {
  const cap = CASCADE_CAP_BY_BAND[look.id];
  return Math.max(1, Math.min(count, cap ?? count));
}

/** Shadow filter mode written to samG (GLSL reads CSM_PARAMS.y). */
export type ShadowFilter = 'hard' | 'pcf' | 'pcss';
const FILTER_CODE: Record<ShadowFilter, number> = { hard: 0, pcf: 1, pcss: 2 };

/** Cascade count for a tier (ART_BIBLE §13), 1 when shadows are off. */
export function cascadeCountFor(q: QualitySettings): number {
  if (!q.shadows.enabled) return 1;
  return Math.max(1, Math.min(4, Math.round(q.shadows.cascades)));
}

/**
 * Shadow-map size (texels per side) of cascade `i`. The first cascade gets the tier's full
 * QualitySettings.shadows.mapSize; with 3+ cascades the outer ones, which cover much larger and more distant slices,
 * get half of it (min 1024). Without this, high (3 x 4096^2) would allocate ~400 MB of shadow maps - more than ultra
 * and two thirds of the PC-high texture + render-target budget (ARCHITECTURE §15: < 600 MB).
 */
export function cascadeMapSize(q: QualitySettings, i: number): number {
  const full = q.shadows.mapSize;
  if (i === 0 || cascadeCountFor(q) < 3) return full;
  return Math.max(1024, Math.floor(full / 2));
}

/** Bytes per shadow-map texel in three r170: RGBA8 colour (packed depth) + 32-bit depth renderbuffer. */
export const SHADOW_BYTES_PER_TEXEL = 8;

/** GPU memory (bytes) of every cascade shadow map of a tier (0 when shadows are off). */
export function shadowMapBytes(q: QualitySettings): number {
  if (!q.shadows.enabled) return 0;
  let n = 0;
  for (let i = 0; i < cascadeCountFor(q); i++) n += cascadeMapSize(q, i) ** 2 * SHADOW_BYTES_PER_TEXEL;
  return n;
}

/** Filter for a tier: low hard, medium PCF, high / ultra PCSS. */
export function shadowFilterFor(q: QualitySettings): ShadowFilter {
  if (!q.shadows.enabled) return 'hard';
  if (q.shadows.pcss) return 'pcss';
  return q.shadows.soft ? 'pcf' : 'hard';
}

/**
 * Practical split distances (view depth, m) into `out` (length count + 1): out[0] = near, out[count] = far.
 * lambda 0 = uniform, 1 = logarithmic.
 */
export function practicalSplits(near: number, far: number, count: number, lambda: number, out: Float32Array | number[]): Float32Array | number[] {
  const n = Math.max(1e-3, near);
  const f = Math.max(n * 1.01, far);
  for (let i = 0; i <= count; i++) {
    const p = i / count;
    const log = n * Math.pow(f / n, p);
    const uni = n + (f - n) * p;
    out[i] = lambda * log + (1 - lambda) * uni;
  }
  return out;
}

/**
 * Shadow distance for a view: ZoomLook distance scaled by the tier (QualitySettings.shadows.distance / 600, 0.5..1.5),
 * never closer than 1.25 x the focus distance so the subject is always shadowed (strategic camera 2.6 km away).
 */
export function shadowDistanceFor(look: ZoomLook, q: QualitySettings, focusDistance: number, cameraFar: number): number {
  const tierScale = Math.min(1.5, Math.max(0.5, q.shadows.distance / 600));
  const d = Math.max(look.shadows.distanceM * tierScale, focusDistance * 1.25);
  return Math.min(d, cameraFar * 0.98);
}

export class CascadedShadows {
  /** Cascade lights (index = cascade). lights[0] doubles as the rig's `sun`. */
  lights: THREE.DirectionalLight[] = [];
  readonly group = new THREE.Group();
  private quality: QualitySettings;
  private count = 1;
  /** Cascades in use this frame (<= count; far zoom bands use fewer). */
  private active = 1;
  private filter: ShadowFilter = 'hard';
  /** Max cascades honoured (4 = every tier as authored in ART_BIBLE §13). */
  maxCascades = 4;
  debugColors = false;
  private readonly splits = new Float32Array(5);
  private readonly corners: THREE.Vector3[] = Array.from({ length: 8 }, () => new THREE.Vector3());
  private readonly center = new THREE.Vector3();
  private readonly lightDir = new THREE.Vector3(0, 1, 0);
  private readonly axisX = new THREE.Vector3();
  private readonly axisY = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private readonly camQuat = new THREE.Quaternion();
  private color = new THREE.Color(1, 1, 1);
  private intensity = 3.4;
  private softnessDeg = 0.35;
  /** Last computed shadow distance (m) and texel sizes, for diagnostics. */
  readonly info = { distance: 0, texels: [0, 0, 0, 0], radii: [0, 0, 0, 0], splits: [0, 0, 0, 0, 0] };

  constructor(quality: QualitySettings) {
    this.group.name = 'sun_cascades';
    this.quality = quality;
    this.rebuild();
  }

  get cascadeCount(): number {
    return this.count;
  }

  /** Cascades in use last frame (the rest are idle: weight 0, not re-rendered). */
  get activeCascadeCount(): number {
    return this.active;
  }

  get filterMode(): ShadowFilter {
    return this.filter;
  }

  /** Runtime tier change: rebuild lights when the cascade count or map size changed (old maps disposed). */
  setQuality(q: QualitySettings): void {
    const prev = this.quality;
    this.quality = q;
    const n = Math.min(this.maxCascades, cascadeCountFor(q));
    if (n !== this.count || prev.shadows.mapSize !== q.shadows.mapSize || prev.shadows.enabled !== q.shadows.enabled) this.rebuild();
    this.filter = shadowFilterFor(q);
  }

  /** Re-create the cascade lights (count from quality). */
  rebuild(): void {
    for (const l of this.lights) {
      this.group.remove(l, l.target);
      l.shadow.map?.dispose();
      l.dispose();
    }
    const q = this.quality;
    this.count = Math.min(this.maxCascades, cascadeCountFor(q));
    this.active = this.count;
    this.filter = shadowFilterFor(q);
    this.lights = [];
    for (let i = 0; i < this.count; i++) {
      const l = new THREE.DirectionalLight(this.color, this.intensity);
      l.name = i === 0 ? 'sun' : `sun_cascade_${i}`;
      l.castShadow = q.shadows.enabled;
      const size = cascadeMapSize(q, i);
      l.shadow.mapSize.set(size, size);
      l.shadow.bias = -0.0004;
      l.shadow.normalBias = 0.6;
      l.shadow.radius = 1;
      const cam = l.shadow.camera as THREE.OrthographicCamera;
      cam.near = 0.5;
      cam.far = 2000;
      cam.updateProjectionMatrix();
      this.group.add(l, l.target);
      this.lights.push(l);
    }
  }

  /** Key-light colour (linear), intensity and sun angular radius (deg) for every cascade. */
  setLight(color: THREE.Color, intensity: number, softnessDeg: number): void {
    this.color.copy(color);
    this.intensity = intensity;
    this.softnessDeg = softnessDeg;
    for (const l of this.lights) {
      l.color.copy(color);
      l.intensity = intensity;
    }
  }

  /**
   * Fit every cascade to the camera (call each frame before rendering). `toLight` = unit vector toward the key
   * light. Writes the cascade table into the shared shader globals. Allocation-free.
   */
  update(camera: THREE.Camera, toLight: THREE.Vector3, look: ZoomLook, focusDistance: number): void {
    this.lightDir.copy(toLight).normalize();
    const q = this.quality;
    const persp = camera instanceof THREE.PerspectiveCamera ? camera : null;
    // RTS cameras see no geometry in the first ~30 % of the focus distance: start the splits there so the first
    // cascade covers visible ground (hero / close cameras keep the near plane).
    const camNear = persp ? Math.max(0.05, persp.near) : 0.1;
    const near = focusDistance > 12 ? Math.max(camNear, focusDistance * SPLIT_NEAR_OF_FOCUS) : camNear;
    const camFar = persp ? persp.far : 2000;
    const far = shadowDistanceFor(look, q, focusDistance, camFar);
    this.info.distance = far;
    const active = activeCascadesFor(this.count, look);
    this.active = active;
    practicalSplits(near, far, active, look.shadows.cascadeSplitLambda, this.splits);
    camera.matrixWorld.decompose(this.camPos, this.camQuat, this.tmp);
    // Light basis matching three's lookAt(eye = target + dir, target, up = +Y): z = dir, x = up x z, y = z x x.
    const up = Math.abs(this.lightDir.y) > 0.999 ? this.tmp.set(0, 0, 1) : this.tmp.set(0, 1, 0);
    this.axisX.crossVectors(up, this.lightDir).normalize();
    this.axisY.crossVectors(this.lightDir, this.axisX).normalize();
    const tanY = persp ? Math.tan(THREE.MathUtils.degToRad(persp.fov * 0.5)) / Math.max(1e-3, persp.zoom) : 1;
    const tanX = tanY * (persp ? persp.aspect : 1);
    const softTan = Math.tan(THREE.MathUtils.degToRad(Math.max(0.05, this.softnessDeg * look.shadows.softnessScale)));
    for (let i = 0; i < this.count; i++) {
      const l = this.lights[i]!;
      if (i >= active) {
        // Idle cascade (far band): keep its light and map, weight 0 in the shader (texel 0), skip its shadow render.
        l.shadow.autoUpdate = false;
        l.shadow.needsUpdate = false;
        g(G.CSM_CASCADE + i).set(0, 0, 0, 0);
        this.info.texels[i] = 0;
        this.info.radii[i] = 0;
        continue;
      }
      l.shadow.autoUpdate = true;
      const s0 = i === 0 ? this.splits[0]! : this.splits[i]! - CSM_BLEND * (this.splits[i]! - this.splits[i - 1]!);
      const s1 = this.splits[i + 1]!;
      // Slice corners in world space.
      for (let k = 0; k < 8; k++) {
        const z = k < 4 ? s0 : s1;
        const sx = k & 1 ? 1 : -1;
        const sy = k & 2 ? 1 : -1;
        this.corners[k]!.set(sx * tanX * z, sy * tanY * z, -z).applyQuaternion(this.camQuat).add(this.camPos);
      }
      this.center.set(0, 0, 0);
      for (const c of this.corners) this.center.add(c);
      this.center.multiplyScalar(1 / 8);
      let r = 0;
      for (const c of this.corners) r = Math.max(r, c.distanceTo(this.center));
      // Quantise the radius (rotation-invariant cascade size; avoids sub-texel size jitter).
      r = Math.ceil(r * 4) / 4;
      const mapSize = l.shadow.mapSize.x;
      const texel = (2 * r) / mapSize;
      // Snap the centre to whole texels in light space.
      const cx = Math.round(this.center.dot(this.axisX) / texel) * texel;
      const cy = Math.round(this.center.dot(this.axisY) / texel) * texel;
      const cz = this.center.dot(this.lightDir);
      this.center.copy(this.axisX).multiplyScalar(cx).addScaledVector(this.axisY, cy).addScaledVector(this.lightDir, cz);
      const back = r + CSM_CASTER_EXTENT_M;
      l.target.position.copy(this.center);
      l.position.copy(this.center).addScaledVector(this.lightDir, back);
      l.target.updateMatrixWorld();
      l.updateMatrixWorld();
      const cam = l.shadow.camera as THREE.OrthographicCamera;
      cam.left = -r;
      cam.right = r;
      cam.top = r;
      cam.bottom = -r;
      cam.near = 0.5;
      cam.far = back + r;
      cam.updateProjectionMatrix();
      const depthRange = cam.far - cam.near;
      l.shadow.normalBias = texel * NORMAL_BIAS_TEXELS[this.filter];
      l.shadow.bias = -(texel * DEPTH_BIAS_TEXELS[this.filter]) / depthRange;
      l.shadow.radius = this.filter === 'pcf' ? pcfRadiusFromSoftness(this.softnessDeg * look.shadows.softnessScale, texel) : 1;
      g(G.CSM_CASCADE + i).set(s0, s1, texel, depthRange);
      this.info.texels[i] = texel;
      this.info.radii[i] = r;
    }
    for (let i = 0; i < this.info.splits.length; i++) this.info.splits[i] = i <= active ? this.splits[i]! : 0;
    g(G.CSM_PARAMS).set(q.shadows.enabled ? this.count : 0, FILTER_CODE[this.filter], this.debugColors ? 1 : 0, CSM_BLEND);
    // PCSS: light size, blocker / filter samples (ultra more), max penumbra in texels.
    const ultra = q.tier === 'ultra';
    g(G.CSM_PCSS).set(softTan, ultra ? 16 : 12, ultra ? 32 : 20, ultra ? 28 : 18);
  }

  /** Total shadow-map texels (diagnostics / memory). */
  shadowMapTexels(): number {
    let n = 0;
    for (const l of this.lights) if (l.castShadow) n += l.shadow.mapSize.x * l.shadow.mapSize.y;
    return n;
  }

  dispose(): void {
    for (const l of this.lights) {
      l.shadow.map?.dispose();
      l.dispose();
    }
    this.lights = [];
    this.group.clear();
  }
}
