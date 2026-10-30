/**
 * Environment rig: sky, sun/moon + hemisphere light, IBL, fog, shadows, exposure and grading by
 * time of day / season / weather. One per scene. OWNER: Lead Graphics Engineer. Baseline by the CTO.
 *
 * TODO(owner): cascaded shadows (three/examples/jsm/csm) on high+, height fog shader chunk,
 * lightning flashes in storms, moonlight + torches at night, wet-ground darkening via env.weather.wetness.
 */
import * as THREE from 'three';
import type { EnvironmentState, QualitySettings, Season } from '../../core/types';
import type { RenderContext } from '../renderer';
import { SkySystem } from './sky';
import { EXPOSURE, GRADE_PRESETS, SEASON_TINT } from '../style/palette';
import { resolveLighting, environmentIntensityFor, sunDirection as presetSunDirection } from '../style/lighting';
import type { GradeParams } from '../post';

export interface EnvironmentRigOptions {
  /** Approximate scene extent (m) - sets fog scale and far plane hints. */
  sceneSize: number;
}

function lerpGrade(a: GradeParams, b: GradeParams, t: number): GradeParams {
  const l = (x: number, y: number): number => x + (y - x) * t;
  return {
    contrast: l(a.contrast, b.contrast),
    saturation: l(a.saturation, b.saturation),
    warmth: l(a.warmth, b.warmth),
    lift: l(a.lift, b.lift),
    vignette: l(a.vignette, b.vignette),
    tint: [l(a.tint[0], b.tint[0]), l(a.tint[1], b.tint[1]), l(a.tint[2], b.tint[2])],
  };
}

export class EnvironmentRig {
  readonly sky: SkySystem;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly fog: THREE.FogExp2;
  env: EnvironmentState | null = null;
  private quality: QualitySettings;
  private readonly tmp = new THREE.Vector3();
  private readonly sunColor = new THREE.Color();
  /** Normalized wind (x, z) and strength 0..1 for vegetation/banners/water. */
  readonly wind = new THREE.Vector3(1, 0, 0);
  windStrength = 0.3;
  season: Season = 'vasanta';

  constructor(
    private readonly ctx: RenderContext,
    private readonly scene: THREE.Scene,
    private readonly opts: EnvironmentRigOptions,
  ) {
    this.quality = ctx.quality;
    this.sky = new SkySystem(ctx.pmrem, this.quality.envMapSize, ctx.renderer);
    scene.add(this.sky.mesh);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.name = 'sun';
    this.sun.castShadow = this.quality.shadows.enabled;
    this.configureShadow();
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x6b5a3a, 0.6);
    scene.add(this.hemi);
    this.fog = new THREE.FogExp2(0xc9d6e0, 0.00012);
    if (this.quality.fog) scene.fog = this.fog;
  }

  private configureShadow(): void {
    const q = this.quality.shadows;
    const s = this.sun.shadow;
    s.mapSize.set(q.mapSize, q.mapSize);
    const cam = s.camera as THREE.OrthographicCamera;
    const half = Math.min(q.distance, this.opts.sceneSize) * 0.5;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 1;
    cam.far = 4000;
    cam.updateProjectionMatrix();
    s.bias = -0.0004;
    s.normalBias = 0.6;
    s.radius = q.soft ? 2.5 : 1;
    s.map?.dispose();
    s.map = null as unknown as THREE.WebGLRenderTarget;
  }

  setQuality(q: QualitySettings): void {
    this.quality = q;
    this.sun.castShadow = q.shadows.enabled;
    this.configureShadow();
    this.scene.fog = q.fog ? this.fog : null;
  }

  /** Apply an environment state (time of day, season, weather). Cheap; call when it changes. */
  setEnvironment(env: EnvironmentState): void {
    this.env = env;
    this.season = env.season;
    this.sky.setEnvironment(env);
    const dir = this.sky.sunDir;
    const elev = dir.y;
    const w = env.weather;
    const day = THREE.MathUtils.smoothstep(elev, -0.05, 0.25);
    const golden = 1 - THREE.MathUtils.smoothstep(elev, 0.05, 0.35);
    // Sun color: white at noon -> orange near horizon.
    this.sunColor.setRGB(1, 0.92 - golden * 0.28, 0.82 - golden * 0.5);
    this.sun.color.copy(this.sunColor);
    const overcast = 1 - w.cloudCover * 0.75;
    this.sun.intensity = Math.max(0.0, day * 3.4 * overcast);
    if (elev < 0) {
      // Moonlight
      this.sun.color.setRGB(0.6, 0.7, 1);
      this.sun.intensity = 0.25;
    }
    const lightDir = elev < 0 ? this.tmp.set(-dir.x, Math.max(0.3, -dir.y), -dir.z).normalize() : this.tmp.copy(dir);
    this.sun.position.copy(lightDir).multiplyScalar(1500);
    const tint = SEASON_TINT[env.season];
    this.hemi.color.setRGB(0.72 * tint[0], 0.76 * tint[1], 0.86 * tint[2]).multiplyScalar(0.6 + day * 0.6);
    this.hemi.groundColor.setRGB(0.42 * tint[0], 0.34 * tint[1], 0.22 * tint[2]).multiplyScalar(0.5 + day * 0.5);
    this.hemi.intensity = 0.3 + day * 0.4 + w.cloudCover * 0.35;
    // Fog: visibility -> density (exp2: ~ e^-(d*density)^2, 2% at visibility).
    const vis = Math.max(200, Math.min(w.visibility, this.opts.sceneSize * 2.5));
    this.fog.density = 1.98 / vis;
    const fogDay = new THREE.Color().setRGB(0.74 + golden * 0.15, 0.8 - golden * 0.02, 0.86 - golden * 0.22);
    const fogNight = new THREE.Color(0x1a2233);
    const fogGrey = new THREE.Color(0x9aa3a8);
    this.fog.color.copy(fogNight).lerp(fogDay, day).lerp(fogGrey, w.cloudCover * 0.6 * day);
    // Exposure + grade presets.
    const r = this.ctx.renderer;
    let grade: GradeParams;
    if (elev < -0.02) {
      r.toneMappingExposure = EXPOSURE.night;
      grade = GRADE_PRESETS.night;
    } else if (golden > 0.5) {
      r.toneMappingExposure = EXPOSURE.golden;
      grade = lerpGrade(GRADE_PRESETS.day, GRADE_PRESETS.golden, (golden - 0.5) * 2);
    } else {
      r.toneMappingExposure = EXPOSURE.day;
      grade = GRADE_PRESETS.day;
    }
    if (w.rain > 0.2 || w.cloudCover > 0.7) grade = lerpGrade(grade, GRADE_PRESETS.monsoon, Math.min(1, w.cloudCover));
    this.ctx.post.setGrade(grade);
    // Wind.
    this.wind.set(Math.sin(w.windDirection), 0, Math.cos(w.windDirection));
    this.windStrength = Math.min(1, w.windSpeed / 12);
    // Calibrated IBL (ART_BIBLE §4.4): disc-free sky, measured source irradiance, preset sky irradiance target.
    const elevDeg = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)));
    const res = resolveLighting({ sunElevationDeg: elevDeg, hour: env.hour, season: env.season, weather: w });
    const md = presetSunDirection(42, 150);
    this.moonDir.set(md[0], md[1], md[2]);
    this.sky.setLighting(res, dir, this.moonDir, w.cloudCover);
    const bake = this.sky.bake(this.ctx.renderer, true);
    this.scene.environment = bake?.envMap ?? this.sky.envMap;
    this.calibration = environmentIntensityFor(res, this.sky.sourceIrradiance);
    this.scene.environmentIntensity = this.calibration;
    this.scene.backgroundIntensity = this.calibration;
    this.sky.setFrame(this.calibration, 1, 0, this.wind.x, this.wind.z);
  }

  private readonly moonDir = new THREE.Vector3(0, 1, 0);
  /** IBL calibration factor (scene.environmentIntensity) of the current sky. */
  calibration = 1;

  /** Per frame: keep the shadow frustum around the camera focus (texel-snapped). */
  update(dt: number, focus: THREE.Vector3): void {
    void dt;
    const s = this.sun;
    const q = this.quality.shadows;
    const texel = (Math.min(q.distance, this.opts.sceneSize) / q.mapSize) * 2;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    const dir = this.tmp.copy(s.position).normalize();
    s.target.position.set(fx, focus.y, fz);
    s.position.set(fx + dir.x * 1500, focus.y + dir.y * 1500, fz + dir.z * 1500);
    s.target.updateMatrixWorld();
  }

  dispose(): void {
    this.scene.remove(this.sky.mesh, this.sun, this.sun.target, this.hemi);
    this.sky.dispose();
    this.sun.shadow.map?.dispose();
    this.sun.dispose();
    this.hemi.dispose();
    if (this.scene.fog === this.fog) this.scene.fog = null;
    this.scene.environment = null;
  }
}
