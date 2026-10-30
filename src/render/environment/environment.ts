/**
 * Environment rig: time-of-day / season / weather lighting from the Art Director's resolver (ART_BIBLE §4.2), the
 * calibrated sky + IBL (§4.4), height fog and aerial perspective (§4.5), cascaded sun / moon shadows (§13),
 * practical lights and lightning (§4.6), and the frame-level post inputs (exposure, grade, bloom, AO, shafts, zoom
 * look). One per scene. OWNER: Graphics Developer - Lighting, Atmosphere & Post (GFX-01).
 *
 * Public API (W15: source-compatible with the baseline; new members are additive)
 *   new EnvironmentRig(ctx.render, scene, { sceneSize, bounds?, assets? })
 *   setEnvironment(env)                    time of day, season, weather -> resolveLighting() -> everything
 *   setResolved(r | null, ease?)           override the resolver (cutscenes, interiors); null returns to it
 *   setMoodBlend([{ mood, weight }])       hero districts: resolveHeroMood + lerp (the 40 m cross-fade is the caller's)
 *   triggerLightning(dir?)                 storm flash (#d8e2ff x9, 80-160 ms double flash, sky +2 EV) - GFX-02 weather
 *   addPractical(kind, position)           -> handle { setPosition, setScale, remove } (lamps, torches, braziers, fires)
 *   sunDirection(out?)                     unit vector toward the key light (sun by day, moon at night)
 *   update(dt, focus | camera, look?)      per frame; focus = camera focus point (legacy), look = ZoomLook from GFX-05
 *                                          (else derived from the camera-to-focus distance and capped by tier)
 *   setQuality(q) (automatic on tier changes), setAssets(assets), setBounds(rect), info(), dispose()
 * Read-only: sky, sun (cascade 0 light), hemi, fog (FogExp2: three's fog defines; parameters live in shader globals),
 * wind, windStrength, season, env, resolved, look, shadows, practicals, calibration.
 *
 * Applied exactly as ART_BIBLE §4.2 shows: sun colour / intensity / penumbra from r; scene.environmentIntensity =
 * scene.backgroundIntensity = environmentIntensityFor(r, sourceIrradiance); hemisphere x0.35 when the IBL is on;
 * height fog with fogRadiance colours and density x ZoomLook fogDensityScale; renderer.toneMappingExposure =
 * r.exposure; post grade r.grade; bloom threshold r.bloomThreshold / r.exposure; MATERIAL_GLOBALS.wetness =
 * max(r.wetness, weather.wetness).
 * Per-frame work runs in a RenderContext frame hook (right before this scene renders, with the real camera), so
 * scenes that never call update() still get fitted cascades, fog and post. Allocation-free per frame.
 */
import * as THREE from 'three';
import type { EnvironmentState, HeroMood, QualitySettings, Rect, Season } from '../../core/types';
import { currentUrlParams } from '../../core/params';
import type { RenderContext, RenderAssetSource } from '../renderer';
import { SkySystem, sunDirection as solarDirection } from './sky';
import { LIGHTING_PRESETS, resolveHeroMood, resolveLighting, environmentIntensityFor, type ResolvedLighting } from '../style/lighting';
import { capZoomLook, createZoomLook, resolveZoomLook, type ZoomLook } from '../style/zoom';
import { MATERIAL_GLOBALS } from '../materials/pbr';
import { G, g, installShaderGlobals } from '../materials/chunks/globals';
import { blendResolvedInto, cloneResolved, copyResolvedInto } from '../lighting/resolved';
import { bloomThresholdLinear } from '../lighting/ibl';
import { CascadedShadows } from '../lighting/csm';
import { LightningFlash } from '../lighting/lightning';
import { PracticalLights, type PracticalHandle, type PracticalKind } from '../lighting/practicals';
import { EXP2_DENSITY_SCALE, fogModeFor, writeAtmosphere, atmosphereSnapshot, type AtmosphereInputs } from './atmosphere/atmosphere';

export interface EnvironmentRigOptions {
  /** Approximate scene extent (m): aerial-perspective distance and the fallback map bounds. */
  sceneSize: number;
  /** Map bounds for the edge fade (default: the bounds of an object named 'terrain', found on the first frames). */
  bounds?: Rect;
  /** Content loaders for baked skies / sun sprite (default: ctx.render.assets when main.ts attached them). */
  assets?: RenderAssetSource | null;
}

export interface MoodWeight {
  mood: HeroMood;
  weight: number;
}

const DEG = Math.PI / 180;
/** Key light never drops below this elevation (deg): grazing suns smear shadows across the whole map. */
const MIN_KEY_ELEVATION_DEG = 3;
/** Sun -> moon key-light hand-over (solar elevation, deg). */
const MOON_HANDOVER_DEG: readonly [number, number] = [-2, -8];
/** Moon elevation range (deg) - a readable night key, never grazing, never straight down. */
const MOON_ELEVATION_DEG: readonly [number, number] = [25, 62];
/** Exposure ease time constant (s) for mood / override changes (ART_BIBLE §4.7: 0.6 s). */
const EXPOSURE_EASE_S = 0.6;
/** Hemisphere factor with IBL on (ART_BIBLE §4.2). */
const HEMI_WITH_IBL = 0.35;

export class EnvironmentRig {
  readonly sky: SkySystem;
  readonly hemi: THREE.HemisphereLight;
  readonly fog: THREE.FogExp2;
  readonly shadows: CascadedShadows;
  readonly practicals: PracticalLights;
  readonly lightning: LightningFlash;
  env: EnvironmentState | null = null;
  /** Normalized wind (x, z) and strength 0..1 for vegetation / banners / water. */
  readonly wind = new THREE.Vector3(1, 0, 0);
  windStrength = 0.3;
  season: Season = 'vasanta';
  /** The lighting currently applied (resolver, override or mood blend; exposure eases separately). */
  readonly resolved: ResolvedLighting;
  /** The zoom look used this frame (provided by the caller or derived from the camera distance). */
  readonly look: ZoomLook = createZoomLook();
  /** IBL calibration factor (scene.environmentIntensity) for the active sky. */
  calibration = 1;
  private quality: QualitySettings;
  private readonly base: ResolvedLighting;
  private override: ResolvedLighting | null = null;
  private readonly moodScratch: ResolvedLighting;
  private readonly moodCache = new Map<HeroMood, ResolvedLighting>();
  private readonly sunDir = new THREE.Vector3(0, 1, 0);
  private readonly moonDir = new THREE.Vector3(0, 1, 0);
  private readonly keyDir = new THREE.Vector3(0, 1, 0);
  private readonly scatterDir = new THREE.Vector3(0, 1, 0);
  private readonly keyColor = new THREE.Color();
  private readonly focus = new THREE.Vector3();
  private hasFocus = false;
  private lookOverride: ZoomLook | null = null;
  private readonly camPos = new THREE.Vector3();
  private readonly camDir = new THREE.Vector3();
  private exposure = 1;
  private exposureTarget = 1;
  private easeExposure = false;
  private time = 0;
  private sunElevationDeg = 45;
  private flash = 1;
  private bounds: { cx: number; cz: number; half: number } | null = null;
  private boundsSearch = 0;
  private assets: RenderAssetSource | null = null;
  private sourceIrradiance = 1;
  private envYaw = 0;
  private readonly offHook: () => void;
  private readonly offQuality: () => void;
  private readonly offRestore: () => void;
  private readonly atmosphere: AtmosphereInputs;
  private disposed = false;

  constructor(
    private readonly ctx: RenderContext,
    private readonly scene: THREE.Scene,
    private readonly opts: EnvironmentRigOptions,
  ) {
    installShaderGlobals();
    this.quality = ctx.quality;
    const q = this.quality;
    this.sky = new SkySystem(ctx.pmrem, q.envMapSize, ctx.renderer);
    scene.add(this.sky.mesh);
    this.shadows = new CascadedShadows(q);
    this.shadows.debugColors = currentUrlParams().csm;
    scene.add(this.shadows.group);
    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x6b5a3a, 0.3);
    this.hemi.name = 'sky_fill';
    scene.add(this.hemi);
    this.fog = new THREE.FogExp2(0xc9d6e0, 0.0001);
    this.fog.name = 'height_fog';
    if (q.fog) scene.fog = this.fog;
    this.practicals = new PracticalLights(q.practicalLights, q.emissiveBoost);
    scene.add(this.practicals.object);
    this.lightning = new LightningFlash();
    this.base = cloneResolved(resolveLighting({ sunElevationDeg: 45, hour: 12, season: 'sharad', weather: { kind: 'clear', cloudCover: 0, rain: 0 } }));
    this.resolved = cloneResolved(this.base);
    this.moodScratch = cloneResolved(this.base);
    if (opts.bounds) this.setBounds(opts.bounds);
    this.atmosphere = {
      mode: fogModeFor(q),
      fogDensityScale: 1,
      aerialPerspective: 0,
      aerialReferenceM: opts.sceneSize,
      bounds: null,
      scatterDir: this.scatterDir,
      windX: 1,
      windZ: 0,
      windSpeed: 0,
      time: 0,
      cameraY: 0,
      horizonRaw: null,
      calibration: 1,
      skyMultiplier: 1,
    };
    this.setAssets(opts.assets !== undefined ? opts.assets : (ctx.assets ?? null));
    this.offHook = ctx.addFrameHook({ scene, beforeRender: (camera, dt) => this.beforeRender(camera, dt), info: () => this.info() });
    this.offQuality = ctx.onQualityChange((nq) => this.setQuality(nq));
    this.offRestore = ctx.onContextRestored(() => this.sky.invalidate());
  }

  /** Key light (cascade 0) - kept for source compatibility (`env.sun.shadow...`). */
  get sun(): THREE.DirectionalLight {
    return this.shadows.lights[0]!;
  }

  // ------------------------------------------------------------------------------------------------ inputs

  /** Runtime tier change (called automatically through RenderContext.onQualityChange). */
  setQuality(q: QualitySettings): void {
    this.quality = q;
    this.shadows.setQuality(q);
    this.practicals.setQuality(q.practicalLights, q.emissiveBoost);
    this.sky.setEnvMapSize(q.envMapSize);
    this.atmosphere.mode = fogModeFor(q);
    this.scene.fog = q.fog ? this.fog : null;
    if (this.env) this.applyResolved(false);
  }

  /** Content loaders for baked skies and the sun sprite (null = procedural only). */
  setAssets(assets: RenderAssetSource | null): void {
    this.assets = assets && assets.enabled !== false ? assets : null;
    this.sky.setAssets(this.assets);
    if (this.assets?.loadImage && (!this.assets.has || this.assets.has('sun_sprite'))) {
      void this.assets
        .loadImage('sun_sprite')
        .then((h) => {
          if (this.disposed || !h) {
            h?.release();
            return;
          }
          this.sky.setSunSprite(h);
        })
        .catch(() => undefined);
    }
    if (this.env) this.applyResolved(false);
  }

  /** Map bounds for the aerial-perspective edge fade (world x / z). */
  setBounds(rect: Rect): void {
    const half = Math.max(rect.maxX - rect.minX, rect.maxZ - rect.minZ) * 0.5;
    this.bounds = { cx: (rect.minX + rect.maxX) * 0.5, cz: (rect.minZ + rect.maxZ) * 0.5, half };
  }

  /** Apply an environment state (time of day, season, weather). Cheap; call when it changes. */
  setEnvironment(env: EnvironmentState): void {
    this.env = env;
    this.season = env.season;
    const w = env.weather;
    this.wind.set(Math.sin(w.windDirection), 0, Math.cos(w.windDirection));
    this.windStrength = Math.min(1, w.windSpeed / 12);
    solarDirection(env, this.sunDir);
    this.sunElevationDeg = Math.asin(THREE.MathUtils.clamp(this.sunDir.y, -1, 1)) / DEG;
    copyResolvedInto(this.base, resolveLighting({ sunElevationDeg: this.sunElevationDeg, hour: env.hour, season: env.season, weather: w }));
    this.computeMoon();
    this.applyResolved(false);
  }

  /** Override the resolver (cutscenes, interiors). null returns to the time-of-day lighting. Exposure eases 0.6 s. */
  setResolved(r: ResolvedLighting | null, ease = true): void {
    if (r) {
      this.override ??= cloneResolved(r);
      copyResolvedInto(this.override, r);
    } else this.override = null;
    this.applyResolved(ease);
  }

  /**
   * Hero districts: blend moods by weight (resolveHeroMood + lerpResolved; the 40 m cross-fade is the caller's).
   * An empty list returns to the time-of-day lighting. Allocation-free after each mood's first use.
   */
  setMoodBlend(moods: readonly MoodWeight[]): void {
    let total = 0;
    for (const m of moods) total += Math.max(0, m.weight);
    if (total <= 1e-6) {
      this.setResolved(null);
      return;
    }
    let acc = 0;
    let first = true;
    for (const m of moods) {
      const w = Math.max(0, m.weight);
      if (w <= 0) continue;
      let mr = this.moodCache.get(m.mood);
      if (!mr) {
        mr = resolveHeroMood(m.mood);
        this.moodCache.set(m.mood, mr);
      }
      if (first) {
        copyResolvedInto(this.moodScratch, mr);
        first = false;
      } else blendResolvedInto(this.moodScratch, this.moodScratch, mr, w / (acc + w));
      acc += w;
    }
    this.setResolved(this.moodScratch);
  }

  /** Storm lightning (GFX-02 weather calls this): double flash + sky +2 EV. */
  triggerLightning(direction?: THREE.Vector3): void {
    if (!this.lightning.light.parent) this.scene.add(this.lightning.light, this.lightning.light.target);
    this.lightning.trigger(direction);
  }

  /** Register a practical light (lamp, torch, brazier, burning building). Returns a handle (move / scale / remove). */
  addPractical(kind: PracticalKind, position: THREE.Vector3 | { x: number; y: number; z: number }): PracticalHandle {
    return this.practicals.add(kind, position.x, position.y, position.z);
  }

  /** Unit vector toward the key light (sun by day, moon at night). */
  sunDirection(out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.keyDir);
  }

  /** Unit vector toward the sun itself (below the horizon at night). */
  solarDirection(out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.sunDir);
  }

  /**
   * Per frame. Legacy form `update(dt, focus)` (focus point of the camera); new forms `update(dt, camera, look)` or
   * `update(dt, focus, look)`. Without a look the rig derives it from the camera-to-focus distance.
   */
  update(dt: number, focusOrCamera?: THREE.Vector3 | THREE.Camera, look?: ZoomLook): void {
    void dt;
    if (focusOrCamera instanceof THREE.Vector3) {
      this.focus.copy(focusOrCamera);
      this.hasFocus = true;
    }
    this.lookOverride = look ?? null;
  }

  // ------------------------------------------------------------------------------------------------ apply

  private computeMoon(): void {
    // Full-moon convention: opposite the sun in azimuth, elevation mirrored and clamped to a readable range.
    const az = Math.atan2(this.sunDir.x, -this.sunDir.z) + Math.PI;
    const el = THREE.MathUtils.clamp(-this.sunElevationDeg, MOON_ELEVATION_DEG[0], MOON_ELEVATION_DEG[1]) * DEG;
    this.moonDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    // Key light: the sun (never below MIN_KEY_ELEVATION) handing over to the moon as the sun sets (-2 -> -8 deg).
    const moonW = 1 - THREE.MathUtils.smoothstep(this.sunElevationDeg, MOON_HANDOVER_DEG[1], MOON_HANDOVER_DEG[0]);
    const minEl = MIN_KEY_ELEVATION_DEG * DEG;
    const sunAz = Math.atan2(this.sunDir.x, -this.sunDir.z);
    const sunEl = Math.max(minEl, this.sunElevationDeg * DEG);
    this.keyDir.set(Math.sin(sunAz) * Math.cos(sunEl), Math.sin(sunEl), -Math.cos(sunAz) * Math.cos(sunEl));
    if (moonW > 0) this.keyDir.lerp(this.moonDir, moonW).normalize();
    // Fog in-scatter follows the sun until well after sunset (dusk glow), then the moon.
    const scatterMoon = 1 - THREE.MathUtils.smoothstep(this.sunElevationDeg, -10, -5);
    this.scatterDir.copy(this.sunDir).lerp(this.moonDir, scatterMoon).normalize();
  }

  private applyResolved(ease: boolean): void {
    const r = this.override ?? this.base;
    copyResolvedInto(this.resolved, r);
    const q = this.quality;
    const env = this.env;
    // Key light (cascades share it).
    this.keyColor.setRGB(r.sunColor[0], r.sunColor[1], r.sunColor[2]);
    this.shadows.setLight(this.keyColor, r.sunIntensity, r.sunSoftnessDeg);
    // Hemisphere fill (x0.35 with IBL: the environment map carries most of the sky fill).
    const iblOn = q.envMapSize > 0;
    this.hemi.color.setRGB(r.hemiSky[0], r.hemiSky[1], r.hemiSky[2]);
    this.hemi.groundColor.setRGB(r.hemiGround[0], r.hemiGround[1], r.hemiGround[2]);
    this.hemi.intensity = r.hemiIntensity * (iblOn ? HEMI_WITH_IBL : 1);
    // Sky (procedural; baked when assets are attached).
    const preset = LIGHTING_PRESETS[r.dominant];
    this.sky.setLighting(r, this.sunDir, this.moonDir, env?.weather.cloudCover ?? 0.1, preset.sky.nishita.groundAlbedo);
    if (this.assets) this.sky.requestBaked(preset.sky.hdri);
    // Low tier: three's FogExp2 (density x 0.6, fog colour as radiance); medium+ use the height-fog slots.
    const fr = r.fogColor;
    const k = 0.6 / Math.max(1e-3, r.exposure);
    this.fog.color.setRGB(fr[0] * k, fr[1] * k, fr[2] * k);
    this.fog.density = r.fogDensity * EXP2_DENSITY_SCALE * this.look.atmosphere.fogDensityScale;
    // Exposure, grade, bloom (threshold authored as exposed luminance), AO.
    this.exposureTarget = r.exposure;
    this.easeExposure = ease;
    if (!ease) this.exposure = r.exposure;
    const post = this.ctx.post;
    post.setGrade(r.grade);
    post.setBloom(r.bloomStrength, r.bloomRadius, bloomThresholdLinear(r));
    post.setAmbientOcclusion(r.aoIntensity, r.aoRadiusM);
    // Wetness and practicals.
    MATERIAL_GLOBALS.wetness.value = Math.max(r.wetness, env?.weather.wetness ?? 0);
    g(G.MATERIAL_BOOST).w = MATERIAL_GLOBALS.wetness.value;
    this.practicals.weight = r.practicals;
  }

  // ------------------------------------------------------------------------------------------------ frame

  /** Per-frame work right before this scene renders (RenderContext frame hook). Allocation-free. */
  private beforeRender(camera: THREE.Camera, dt: number): void {
    const step = Math.min(Math.max(dt, 0), 0.25);
    this.time += step;
    const q = this.quality;
    const renderer = this.ctx.renderer;
    camera.getWorldPosition(this.camPos);
    // Focus distance -> zoom look (unless the caller supplies one, e.g. GFX-05's ZoomLookController).
    let focusDist: number;
    if (this.hasFocus) focusDist = this.camPos.distanceTo(this.focus);
    else {
      camera.getWorldDirection(this.camDir);
      focusDist = this.camDir.y < -0.05 ? Math.max(4.5, this.camPos.y / -this.camDir.y) : 220;
    }
    if (this.lookOverride) Object.assign(this.look, this.lookOverride);
    else capZoomLook(resolveZoomLook(focusDist, this.look), q.tier);
    // Exposure (eased for mood / override changes).
    if (this.easeExposure && Math.abs(this.exposure - this.exposureTarget) > 1e-4) {
      const a = 1 - Math.exp(-step / EXPOSURE_EASE_S);
      this.exposure = Math.exp(Math.log(this.exposure) + (Math.log(this.exposureTarget) - Math.log(this.exposure)) * a);
    } else this.exposure = this.exposureTarget;
    renderer.toneMappingExposure = this.exposure;
    // IBL: baked sky (fading) or the procedural sky (re-baked when the sun / weather moved).
    const r = this.resolved;
    const baked = this.sky.updateBaked(renderer, step, (src) => environmentIntensityFor(r, src));
    if (baked) {
      this.scene.environment = baked.envMap;
      this.sourceIrradiance = baked.sourceIrradiance;
      this.envYaw = baked.yaw;
    } else {
      const bake = this.sky.bake(renderer);
      if (bake || this.scene.environment !== this.sky.envMap) this.scene.environment = this.sky.envMap;
      this.sourceIrradiance = this.sky.sourceIrradiance;
      this.envYaw = 0;
    }
    this.calibration = this.sourceIrradiance > 0 ? environmentIntensityFor(r, this.sourceIrradiance) : 1;
    this.scene.environmentIntensity = this.calibration;
    this.scene.backgroundIntensity = this.calibration;
    this.scene.environmentRotation.set(0, this.envYaw, 0);
    // Lightning, sky frame values.
    this.flash = this.lightning.update(step, this.camPos);
    this.sky.setFrame(environmentIntensityFor(r, this.sky.sourceIrradiance || 1), this.flash, this.time, this.wind.x, this.wind.z);
    // Fog / atmosphere slots.
    if (!this.bounds && this.boundsSearch < 240) this.findBounds();
    const a = this.atmosphere;
    a.fogDensityScale = this.look.atmosphere.fogDensityScale;
    a.aerialPerspective = this.look.atmosphere.aerialPerspective;
    a.aerialReferenceM = Math.max(this.opts.sceneSize * 0.75, focusDist * 2.5);
    a.bounds = this.bounds;
    a.windX = this.wind.x;
    a.windZ = this.wind.z;
    a.windSpeed = this.env?.weather.windSpeed ?? 2;
    a.time = this.time;
    a.cameraY = this.camPos.y;
    a.horizonRaw = this.sky.horizonValid && !this.sky.bakedActive ? this.sky.horizonRaw : null;
    a.calibration = environmentIntensityFor(r, this.sky.sourceIrradiance || 1);
    a.skyMultiplier = this.flash;
    writeAtmosphere(r, a);
    this.fog.density = r.fogDensity * EXP2_DENSITY_SCALE * this.look.atmosphere.fogDensityScale;
    // Shadows (cascades fitted to this camera).
    this.shadows.update(camera, this.keyDir, this.look, focusDist);
    // Practicals.
    this.practicals.update(step, this.camPos);
    // Post: zoom-look multipliers.
    this.ctx.post.applyZoomLook(this.look);
  }

  /** Find the map bounds from the terrain group (GFX-02 names it 'terrain'); retried for a few seconds. */
  private findBounds(): void {
    this.boundsSearch++;
    if (this.boundsSearch % 30 !== 1) return;
    const t = this.scene.getObjectByName('terrain');
    if (!t) return;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    t.updateWorldMatrix(true, true);
    t.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      m.geometry.boundingBox ?? m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox;
      if (!bb) return;
      const e = m.matrixWorld.elements;
      minX = Math.min(minX, bb.min.x + e[12]!);
      maxX = Math.max(maxX, bb.max.x + e[12]!);
      minZ = Math.min(minZ, bb.min.z + e[14]!);
      maxZ = Math.max(maxZ, bb.max.z + e[14]!);
    });
    if (Number.isFinite(minX) && maxX - minX > 10) this.setBounds({ minX, minZ, maxX, maxZ });
  }

  // ------------------------------------------------------------------------------------------------ diagnostics

  /** Plain-data state for QA scripts and the lab HUD. */
  info(): Record<string, unknown> {
    const r = this.resolved;
    return {
      dominant: r.dominant,
      sunElevationDeg: Math.round(this.sunElevationDeg * 10) / 10,
      keyDir: [this.keyDir.x, this.keyDir.y, this.keyDir.z].map((v) => Math.round(v * 1000) / 1000),
      exposure: this.exposure,
      skyIrradianceTarget: r.skyIrradiance,
      sourceIrradiance: this.sourceIrradiance,
      calibration: this.calibration,
      effectiveIrradiance: this.sourceIrradiance > 0 ? this.sourceIrradiance * this.calibration : r.skyIrradiance,
      bakedSky: this.sky.bakedId,
      night: this.sky.night,
      look: this.look.id,
      cascades: this.shadows.cascadeCount,
      shadowFilter: this.shadows.filterMode,
      shadowDistance: Math.round(this.shadows.info.distance),
      practicals: this.practicals.size,
      practicalLightsLit: this.practicals.litCount,
      wetness: MATERIAL_GLOBALS.wetness.value,
      fog: atmosphereSnapshot(),
      bounds: this.bounds,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.offHook();
    this.offQuality();
    this.offRestore();
    this.scene.remove(this.sky.mesh, this.shadows.group, this.hemi, this.practicals.object, this.lightning.light, this.lightning.light.target);
    this.sky.dispose();
    this.shadows.dispose();
    this.practicals.dispose();
    this.lightning.dispose();
    this.hemi.dispose();
    if (this.scene.fog === this.fog) this.scene.fog = null;
    this.scene.environment = null;
    MATERIAL_GLOBALS.wetness.value = 0;
  }
}
