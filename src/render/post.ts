/**
 * Post-processing pipeline (ART_BIBLE §4.7, ARCHITECTURE §19). OWNER: Graphics Developer - Lighting, Atmosphere &
 * Post (GFX-01; baseline by the CTO).
 *
 * Frame order (HDR linear until the final pass; every pass in src/render/post/):
 *   scene (HDR HalfFloat + depth texture; TAA jitter) -> GTAO (high half res / ultra full) -> contact shadows
 *   (ultra, close / hero bands) -> SSR (ultra) -> composite -> volumetric shafts (24 / 32 / 48 samples) -> bloom
 *   (medium+, lens dirt on ultra) -> DoF (hero + cutscenes on high, close bands on ultra) -> final 'SamrajyaGrade'
 *   (exposure, ACES | AgX, sRGB, grade x ZoomLook, LUT 35 % on high / ultra, vignette, grain, CA, dither)
 *   -> TAA (ultra in hero mode / cutscenes) | SMAA (high / ultra) | FXAA (medium) -> UI.
 *   Low (postMerged): scene + ONE fullscreen pass (grade + vignette + FXAA on tone-mapped taps).
 * Height fog lives in the materials (environment/atmosphere/heightFog.ts), not here.
 *
 * Tier knobs come from QualitySettings (rebuild on change, leak-free); per-frame inputs come from the
 * EnvironmentRig (setGrade / setBloom / setAmbientOcclusion / setSun / setLut / applyZoomLook) and from scenes:
 *   post.setFocus(distanceM, fStop, maxBlurPx)  hero camera / cutscene focus (null = follow the zoom band)
 *   post.setTaa(true | false | 'auto')          force TAA (cutscenes) / off / hero band only (default)
 *   post.setToneMapping('aces' | 'agx')         ACES Filmic (default, authored) or AgX (lookdev comparison)
 *   post.setDofNearField(on)                    near-field DoF layer (default on; off = single layer, lab A/B)
 * Debug: info() lists the passes that ran last frame with their key parameters.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import type { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import type { QualitySettings } from '../core/types';
import type { ZoomLook } from './style/zoom';
import { createPostFrame, type PostFrame } from './post/shared';
import { ScenePass } from './post/scenePass';
import { AoPass } from './post/ao';
import { ContactShadowPass } from './post/contact';
import { setSsrCutoff, SsrPass, SSR_ROUGHNESS_CUTOFF } from './post/ssr';
import { CompositePass, neutralTexture } from './post/composite';
import { shaftsActive, ShaftsPass } from './post/shafts';
import { BloomPass, createLensDirtTexture } from './post/bloom';
import { DofPass } from './post/dof';
import { FinalPass, identityLut, LUT_STRENGTH, type FinalFeatures, type ToneMapper } from './post/final';
import { TaaPass } from './post/taa';

export type { ToneMapper } from './post/final';

export interface GradeParams {
  contrast: number;
  saturation: number;
  /** -1 cool .. +1 warm white balance shift. */
  warmth: number;
  /** Shadows lift (adds to dark tones), e.g. 0.02. */
  lift: number;
  /** 0..1 */
  vignette: number;
  /** Tint multiplied in, linear-ish RGB (1,1,1 = none). */
  tint: [number, number, number];
}

/** A 32^3 grading LUT as the AssetManager returns it (loadLut): display-referred, applied after the grade. */
export interface PostLutHandle {
  readonly texture: THREE.Data3DTexture;
  readonly size: number;
  readonly strength: number;
  release(): void;
}

/** Sun / shafts inputs from the EnvironmentRig (copied; reuse the object). */
export interface PostSunInput {
  /** World direction toward the sun (normalised). */
  toSun: THREE.Vector3;
  /** World direction toward the key light (sun, or moon at night) for contact shadows. */
  toKey: THREE.Vector3;
  elevationDeg: number;
  shaftsStrength: number;
  shaftsDecay: number;
  shaftsDensity: number;
  /** Linear in-scatter tint of the shafts (luminance-normalised by the pipeline). */
  shaftsTint: [number, number, number];
  /** Key light's share of the lighting (contact shadows darken only that part), 0..1. */
  keyShare: number;
}

export type TaaMode = boolean | 'auto';

export const DEFAULT_GRADE: GradeParams = { contrast: 1.06, saturation: 1.08, warmth: 0.08, lift: 0.01, vignette: 0.32, tint: [1, 1, 1] };

/** Lens-dirt intensity on bloom (ultra). */
export const LENS_DIRT_INTENSITY = 0.9;

/** Which passes a tier builds (pure; ART_BIBLE §13 "Post" row; tested in tests/render/lighting/post.test.ts). */
export interface PostPlan {
  /** Low: scene + one merged fullscreen pass. */
  merged: boolean;
  ao: { scale: number; slices: number } | null;
  contact: boolean;
  ssr: boolean;
  composite: boolean;
  shafts: { samples: number; scale: number } | null;
  bloom: boolean;
  dof: boolean;
  final: Omit<FinalFeatures, 'toneMapper'>;
  taa: boolean;
  smaa: boolean;
  /** Separate FXAA pass (medium); the merged low pass carries its own FXAA (final.fxaa). */
  fxaa: boolean;
}

export function planPasses(q: QualitySettings): PostPlan {
  const merged = q.postMerged;
  const ao = !merged && q.ao !== 'off' ? { scale: q.aoHalfRes ? 0.5 : 1, slices: q.aoHalfRes ? 2 : 3 } : null;
  const contact = !merged && q.shadows.enabled && q.shadows.contact;
  const ssr = !merged && q.ssr;
  const shafts = !merged && q.shaftsSamples > 0 ? { samples: q.shaftsSamples, scale: q.shaftsHalfRes ? 0.5 : 1 } : null;
  const bloom = !merged && q.bloom;
  return {
    merged,
    ao,
    contact,
    ssr,
    composite: !!ao || contact || ssr,
    shafts,
    bloom,
    dof: !merged && q.dof !== 'off',
    final: {
      bloom,
      shafts: !!shafts,
      dirt: bloom && q.lensEffects,
      lut: q.colorGrading && (q.tier === 'high' || q.tier === 'ultra'),
      chromaticAberration: !merged && (q.lensEffects || q.dof !== 'off'),
      grade: q.colorGrading,
      vignette: q.vignette,
      fxaa: merged && q.antialias !== 'none',
    },
    taa: !merged && q.antialias === 'taa',
    smaa: !merged && (q.antialias === 'smaa' || q.antialias === 'taa'),
    fxaa: !merged && q.antialias === 'fxaa',
  };
}

/** Pass instances of the current tier (null = not on this tier). */
interface Passes {
  scene: ScenePass;
  ao: AoPass | null;
  contact: ContactShadowPass | null;
  ssr: SsrPass | null;
  composite: CompositePass | null;
  shafts: ShaftsPass | null;
  bloom: BloomPass | null;
  dof: DofPass | null;
  final: FinalPass;
  taa: TaaPass | null;
  smaa: SMAAPass | null;
  fxaa: ShaderPass | null;
}

interface Neutral {
  white: THREE.DataTexture;
  black: THREE.DataTexture;
  clear: THREE.DataTexture;
  lut: THREE.Data3DTexture;
  dirt: THREE.DataTexture | null;
}

export class PostPipeline {
  readonly composer: EffectComposer;
  private readonly frame: PostFrame;
  private passes: Passes;
  private neutral: Neutral;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private quality: QualitySettings;
  grade: GradeParams = { ...DEFAULT_GRADE, tint: [...DEFAULT_GRADE.tint] };
  /** Lighting-driven post parameters (EnvironmentRig). threshold is scene-linear (r.bloomThreshold / r.exposure). */
  readonly lighting = { bloomStrength: 0.22, bloomRadius: 0.4, bloomThreshold: 4.5 / 0.8, aoIntensity: 1, aoRadiusM: 1.5 };
  /** ZoomLook post multipliers (AO, bloom, vignette, saturation, contrast...). */
  private look: ZoomLook | null = null;
  private focusDistance = 220;
  private focusOverride: { distance: number; fStop: number; maxBlurPx: number; strength: number } | null = null;
  private taaMode: TaaMode = 'auto';
  private toneMapper: ToneMapper = 'aces';
  private dofNearField = true;
  private readonly sun = {
    toSun: new THREE.Vector3(0, 1, 0),
    toKey: new THREE.Vector3(0, 1, 0),
    elevationDeg: 45,
    shaftsStrength: 0,
    shaftsDecay: 0.95,
    shaftsDensity: 0.9,
    tint: new THREE.Vector3(1, 1, 1),
    keyShare: 0.7,
  };
  private lutA: PostLutHandle | null = null;
  private lutB: PostLutHandle | null = null;
  private lutMix = 1;
  private lutFadeS = 1.5;
  private externalDirt: THREE.Texture | null = null;
  private readonly scratch = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private readonly camFwd = new THREE.Vector3();
  /** What ran last frame (info / tests). */
  private readonly active = { ao: false, contact: false, ssr: false, composite: false, shafts: false, bloom: false, dof: false, taa: false, smaa: false, fxaa: false, merged: false };

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    quality: QualitySettings,
  ) {
    this.quality = quality;
    this.frame = createPostFrame();
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 0, depthBuffer: false });
    this.composer = new EffectComposer(renderer, rt);
    this.neutral = this.createNeutral();
    this.passes = this.build();
  }

  // ------------------------------------------------------------------------------------------- inputs

  /**
   * Bind the scene/camera to render. A new scene starts from neutral per-scene inputs: the focus override, the TAA
   * mode, the zoom look and the tone mapper are the previous scene's choices (the post pipeline outlives scenes), so a
   * hero / cutscene focus or a forced TAA never leaks into the next scene. A camera change in the same scene keeps
   * them (cutscene cameras).
   */
  setView(scene: THREE.Scene, camera: THREE.Camera): void {
    if (scene === this.frame.scene && camera === this.frame.camera) return;
    if (scene !== this.frame.scene) this.resetSceneInputs();
    this.frame.scene = scene;
    this.frame.camera = camera;
    this.passes.taa?.reset();
  }

  /** Neutral per-scene inputs (setView on a new scene). */
  private resetSceneInputs(): void {
    this.focusOverride = null;
    this.taaMode = 'auto';
    this.look = null;
    this.focusDistance = 220;
    if (this.toneMapper !== 'aces') this.setToneMapping('aces');
  }

  setQuality(q: QualitySettings): void {
    this.quality = q;
    this.rebuild();
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.pixelRatio = pixelRatio;
    this.frame.width = Math.max(1, Math.round(this.width * pixelRatio));
    this.frame.height = Math.max(1, Math.round(this.height * pixelRatio));
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(this.width, this.height);
    this.updateFxaaResolution();
  }

  setGrade(g: Partial<GradeParams>): void {
    this.grade = { ...this.grade, ...g };
  }

  /** Bloom from the resolved lighting: strength, radius, threshold in scene-linear units. */
  setBloom(strength: number, radius: number, thresholdLinear: number): void {
    this.lighting.bloomStrength = strength;
    this.lighting.bloomRadius = radius;
    this.lighting.bloomThreshold = thresholdLinear;
  }

  /** GTAO intensity and world radius (m) from the resolved lighting. */
  setAmbientOcclusion(intensity: number, radiusM: number): void {
    this.lighting.aoIntensity = intensity;
    this.lighting.aoRadiusM = radiusM;
  }

  /**
   * Camera-distance look (ART_BIBLE §2): post multipliers for AO, bloom, DoF, vignette / saturation / contrast,
   * grain, CA, sharpen. `focusDistanceM` (camera to focus point) drives the automatic DoF focus (default
   * look.distanceM, which resolveZoomLook sets to that distance).
   */
  applyZoomLook(look: ZoomLook, focusDistanceM?: number): void {
    this.look = look;
    this.focusDistance = focusDistanceM ?? look.distanceM;
  }

  /** Hero camera / cutscene focus: distance (m), f-stop, max blur (px at 1080p). null = follow the zoom band. */
  setFocus(distanceM: number | null, fStop = 2.8, maxBlurPx = 10, strength = 1): void {
    this.focusOverride = distanceM === null ? null : { distance: Math.max(0.1, distanceM), fStop, maxBlurPx, strength };
  }

  /**
   * Near-field DoF layer (an out-of-focus foreground spreads over the scene behind it; AD round 1). On by default;
   * off reproduces the single-layer DoF (lab before / after comparisons).
   */
  setDofNearField(on: boolean): void {
    this.dofNearField = on;
    if (this.passes.dof) this.passes.dof.nearField = on;
  }

  /** TAA: true = on (cutscenes), false = off, 'auto' = hero band only. Needs QualitySettings.antialias 'taa'. */
  setTaa(mode: TaaMode): void {
    if (mode !== this.taaMode) this.passes.taa?.reset();
    this.taaMode = mode;
  }

  setToneMapping(mapper: ToneMapper): void {
    if (mapper === this.toneMapper) return;
    this.toneMapper = mapper;
    this.rebuild();
  }

  get toneMapping(): ToneMapper {
    return this.toneMapper;
  }

  /**
   * Grading LUT of the dominant lighting preset (high / ultra, 35 %). The pipeline owns the handle from here on
   * (released when replaced or on dispose). Cross-fades from the previous LUT over `fadeS` seconds.
   */
  setLut(handle: PostLutHandle | null, fadeS = 1.5): void {
    if (handle === this.lutA) return;
    this.lutB?.release();
    this.lutB = this.lutA;
    this.lutA = handle;
    this.lutFadeS = Math.max(0, fadeS);
    this.lutMix = this.lutB && handle && fadeS > 0 ? 0 : 1;
    if (this.lutMix >= 1) {
      this.lutB?.release();
      this.lutB = null;
    }
  }

  /** Lens-dirt texture (WP7 `lens_dirt`); null = procedural. Not owned by the pipeline. */
  setLensDirt(texture: THREE.Texture | null): void {
    this.externalDirt = texture;
  }

  /** Sun direction, elevation and shafts parameters for this frame (EnvironmentRig). */
  setSun(s: PostSunInput): void {
    const o = this.sun;
    o.toSun.copy(s.toSun);
    o.toKey.copy(s.toKey);
    o.elevationDeg = s.elevationDeg;
    o.shaftsStrength = s.shaftsStrength;
    o.shaftsDecay = s.shaftsDecay;
    o.shaftsDensity = s.shaftsDensity;
    const t = s.shaftsTint;
    const l = Math.max(1e-4, 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2]);
    o.tint.set(t[0] / l, t[1] / l, t[2] / l);
    o.keyShare = Math.min(1, Math.max(0, s.keyShare));
  }

  /** Plain-data state (pass list, key parameters) for diagnostics. */
  info(): Record<string, unknown> {
    const p = this.passes;
    // Minified builds rename three's pass classes: name them from the pass table.
    const label = (x: Pass): string => (x === p.smaa ? 'smaa' : x === p.fxaa ? 'fxaa' : ((x as { name?: string }).name ?? x.constructor.name));
    const ran = this.composer.passes.filter((x) => x.enabled).map(label);
    return {
      passes: ran,
      active: { ...this.active },
      tier: this.quality.tier,
      toneMapping: this.toneMapper,
      taaMode: this.taaMode,
      lighting: { ...this.lighting },
      look: this.look?.id ?? null,
      focus: this.focusOverride ? { ...this.focusOverride } : { distance: this.focusDistance, auto: true },
      ao: p.ao ? { radius: p.ao.radius, intensity: p.ao.intensity } : null,
      shafts: p.shafts ? { strength: p.shafts.strength, decay: p.shafts.decay, density: p.shafts.density } : null,
      bloom: p.bloom ? { threshold: p.bloom.threshold, radius: p.bloom.radius } : null,
      dof: p.dof && this.active.dof ? { focus: p.dof.focus, fStop: p.dof.fStop, maxBlurPx: p.dof.maxBlurPx, strength: p.dof.strength } : null,
      lut: { loaded: !!this.lutA, mix: this.lutMix },
      renderTargets: this.renderTargetCount(),
    };
  }

  /** Passes that will run this frame (profiler counter). */
  enabledPassCount(): number {
    let n = 0;
    for (const p of this.composer.passes) if (p.enabled) n++;
    return n;
  }

  /** Render targets owned by the pipeline (composer ping-pong + passes). */
  renderTargetCount(): number {
    let n = 2; // composer
    const p = this.passes;
    n += 1; // scene
    if (p.ao) n += 2;
    if (p.contact) n += 1;
    if (p.ssr) n += 1;
    if (p.composite) n += 1;
    if (p.shafts) n += 2;
    if (p.bloom) n += (p.bloom as unknown as { down: unknown[]; up: unknown[] }).down.length + (p.bloom as unknown as { up: unknown[] }).up.length;
    if (p.dof) n += 6; // half, blur, out, tile, tileMax, near
    if (p.taa) n += 2;
    if (p.smaa) n += 2;
    return n;
  }

  // ------------------------------------------------------------------------------------------- build

  private createNeutral(): Neutral {
    return {
      white: neutralTexture(255, 255, 255, 255, 'post.white'),
      black: neutralTexture(0, 0, 0, 255, 'post.black'),
      clear: neutralTexture(0, 0, 0, 0, 'post.clear'),
      lut: identityLut(),
      dirt: this.quality.lensEffects && this.quality.bloom && !this.quality.postMerged ? createLensDirtTexture() : null,
    };
  }

  private build(): Passes {
    const plan = planPasses(this.quality);
    const f = this.frame;
    const scene = new ScenePass(f);
    const ao = plan.ao ? new AoPass(f, plan.ao.scale, plan.ao.slices) : null;
    const contact = plan.contact ? new ContactShadowPass(f) : null;
    const ssr = plan.ssr ? new SsrPass(f) : null;
    const composite = plan.composite ? new CompositePass(f, { ao: !!ao, contact: !!contact, ssr: !!ssr }, this.neutral.white, this.neutral.clear) : null;
    const shafts = plan.shafts ? new ShaftsPass(f, plan.shafts.samples, plan.shafts.scale) : null;
    const bloom = plan.bloom ? new BloomPass(f) : null;
    const dof = plan.dof ? new DofPass(f) : null;
    if (dof) dof.nearField = this.dofNearField;
    const final = new FinalPass(f, { ...plan.final, toneMapper: this.toneMapper }, { black: this.neutral.black, lut: this.neutral.lut });
    if (this.neutral.dirt) final.uniforms.tDirt!.value = this.neutral.dirt;
    const w = Math.max(1, this.width * this.pixelRatio);
    const h = Math.max(1, this.height * this.pixelRatio);
    const taa = plan.taa ? new TaaPass(f) : null;
    const smaa = plan.smaa ? new SMAAPass(w, h) : null;
    const fxaa = plan.fxaa ? new ShaderPass(FXAAShader) : null;
    const passes: Passes = { scene, ao, contact, ssr, composite, shafts, bloom, dof, final, taa, smaa, fxaa };
    for (const p of [scene, ao, contact, ssr, composite, shafts, bloom, dof, final, taa, smaa, fxaa]) if (p) this.composer.addPass(p);
    this.passes = passes;
    this.updateFxaaResolution();
    return passes;
  }

  private disposePasses(): void {
    for (const p of [...this.composer.passes]) {
      this.composer.removePass(p);
      p.dispose();
    }
    const n = this.neutral;
    n.white.dispose();
    n.black.dispose();
    n.clear.dispose();
    n.lut.dispose();
    n.dirt?.dispose();
  }

  private rebuild(): void {
    this.disposePasses();
    // Free the composer's ping-pong buffers too: they are re-allocated lazily by the tiers that use them (the low
    // tier's merged pass draws straight to the screen), so tier cycling leaves GPU memory exactly as it was.
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
    this.neutral = this.createNeutral();
    this.build();
  }

  private updateFxaaResolution(): void {
    const fx = this.passes?.fxaa;
    if (!fx) return;
    const res = fx.material.uniforms.resolution;
    if (res) (res.value as THREE.Vector2).set(1 / Math.max(1, this.width * this.pixelRatio), 1 / Math.max(1, this.height * this.pixelRatio));
  }

  // ------------------------------------------------------------------------------------------- frame

  render(dt: number): void {
    const f = this.frame;
    const p = this.passes;
    const q = this.quality;
    const look = this.look;
    const lp = look?.post;
    const cam = f.camera;
    const persp = (cam as THREE.PerspectiveCamera).isPerspectiveCamera === true;
    f.perspective = persp;
    f.near = (cam as THREE.PerspectiveCamera).near ?? 0.1;
    f.far = (cam as THREE.PerspectiveCamera).far ?? 2000;
    f.time += Math.min(Math.max(dt, 0), 0.25);
    f.frame++;
    f.ao = f.contact = f.ssr = f.shafts = f.bloom = null;
    f.bloomIntensity = 0;
    cam.updateMatrixWorld();
    cam.getWorldPosition(this.camPos);
    cam.getWorldDirection(this.camFwd);

    // Cinematic features (DoF, grain, CA): hero + cutscenes on high, every close band on ultra.
    const override = this.focusOverride;
    const cinematic = q.dof === 'close' ? !!override || (lp?.dof.strength ?? 0) > 0 : q.dof === 'hero' ? !!override || look?.id === 'hero' : false;
    // TAA (ultra): hero band or forced; SMAA otherwise.
    const taaOn = !!p.taa && persp && (this.taaMode === true || (this.taaMode === 'auto' && look?.id === 'hero'));
    p.scene.jitter = taaOn;

    // GTAO.
    const aoOn = !!p.ao && persp && (lp ? lp.aoScale : 1) > 0 && this.lighting.aoIntensity > 0;
    if (p.ao) {
      p.ao.enabled = aoOn;
      p.ao.radius = (lp ? lp.aoRadiusM : 1.5) * (this.lighting.aoRadiusM / 1.5);
      p.ao.intensity = this.lighting.aoIntensity * (lp ? lp.aoScale : 1);
      p.ao.temporal = taaOn;
    }
    // Contact shadows (band-gated) toward the key light.
    const contactOn = !!p.contact && persp && !!look?.shadows.contact && this.sun.toKey.y > 0.02;
    if (p.contact) {
      p.contact.enabled = contactOn;
      p.contact.temporal = taaOn;
      p.contact.length = 0.45;
      f.sunView.copy(this.sun.toKey).transformDirection(cam.matrixWorldInverse);
    }
    // SSR (material mask on while active).
    const ssrOn = !!p.ssr && persp;
    if (p.ssr) {
      p.ssr.enabled = ssrOn;
      p.ssr.temporal = taaOn;
    }
    setSsrCutoff(ssrOn ? SSR_ROUGHNESS_CUTOFF : 0);
    const compositeOn = !!p.composite && (aoOn || contactOn || ssrOn);
    if (p.composite) {
      p.composite.enabled = compositeOn;
      p.composite.contactStrength = this.sun.keyShare;
    }
    // Shafts: sun position on screen.
    const s = this.sun;
    f.sunDir.copy(s.toSun);
    this.scratch.copy(this.camPos).addScaledVector(s.toSun, Math.max(10, f.far * 0.5)).project(cam);
    const facing = this.camFwd.dot(s.toSun);
    const sx = this.scratch.x * 0.5 + 0.5;
    const sy = this.scratch.y * 0.5 + 0.5;
    const off = Math.max(0, Math.max(-sx, sx - 1, -sy, sy - 1));
    const visibility = facing <= 0 ? 0 : Math.min(1, facing * 4) * Math.max(0, 1 - off / 0.6);
    f.sunScreen.set(sx, sy, visibility);
    const shaftScale = look ? look.atmosphere.shaftsScale : 1;
    const shaftsOn = !!p.shafts && persp && shaftsActive(q.shaftsSamples, s.shaftsStrength, s.elevationDeg, shaftScale, visibility);
    if (p.shafts) {
      p.shafts.enabled = shaftsOn;
      p.shafts.strength = s.shaftsStrength * shaftScale * visibility;
      p.shafts.decay = s.shaftsDecay;
      p.shafts.density = s.shaftsDensity;
      p.shafts.temporal = taaOn;
    }
    // Bloom.
    const bloomOn = !!p.bloom;
    if (p.bloom) {
      p.bloom.threshold = Math.max(1e-3, this.lighting.bloomThreshold);
      p.bloom.radius = this.lighting.bloomRadius;
      p.bloom.strength = this.lighting.bloomStrength * (lp ? lp.bloomScale : 1);
    }
    // Depth of field.
    let dofOn = false;
    if (p.dof) {
      const d = p.dof;
      if (override) {
        d.focus = override.distance;
        d.fStop = override.fStop;
        d.maxBlurPx = override.maxBlurPx;
        d.strength = override.strength;
      } else if (lp) {
        d.focus = this.focusDistance;
        d.fStop = lp.dof.fStop;
        d.maxBlurPx = lp.dof.maxBlurPx;
        d.strength = lp.dof.strength;
      } else d.strength = 0;
      dofOn = persp && cinematic && d.maxCocPx() >= 0.5;
      d.enabled = dofOn;
    }
    // AA.
    if (p.taa) {
      p.taa.enabled = taaOn;
      p.taa.grain = cinematic && lp ? lp.grain : 0;
    }
    if (p.smaa) p.smaa.enabled = !taaOn;

    // Final pass uniforms.
    const u = p.final.uniforms;
    const g = this.grade;
    u.uExposure!.value = this.renderer.toneMappingExposure;
    u.uContrast!.value = q.colorGrading ? g.contrast * (lp ? lp.contrastMul : 1) : 1;
    u.uSaturation!.value = q.colorGrading ? g.saturation * (lp ? lp.saturationMul : 1) : 1;
    u.uWarmth!.value = q.colorGrading ? g.warmth : 0;
    u.uLift!.value = q.colorGrading ? g.lift : 0;
    u.uVignette!.value = q.vignette ? Math.max(0, g.vignette + (lp ? lp.vignetteAdd : 0)) : 0;
    (u.uTint!.value as THREE.Vector3).set(g.tint[0], g.tint[1], g.tint[2]);
    u.uGrain!.value = cinematic && lp && !taaOn ? lp.grain : 0;
    u.uCA!.value = cinematic && lp ? lp.chromaticAberration : 0;
    u.uSharpen!.value = lp && !q.postMerged ? lp.sharpen * 0.5 : 0;
    (u.uShaftTint!.value as THREE.Vector3).copy(s.tint);
    // LUT cross-fade.
    if (this.lutB && this.lutMix < 1) {
      this.lutMix = Math.min(1, this.lutMix + Math.max(0, dt) / Math.max(1e-3, this.lutFadeS));
      if (this.lutMix >= 1) {
        this.lutB.release();
        this.lutB = null;
      }
    }
    u.tLutA!.value = this.lutA?.texture ?? this.neutral.lut;
    u.uLutSizeA!.value = this.lutA?.size ?? 2;
    u.tLutB!.value = this.lutB?.texture ?? this.neutral.lut;
    u.uLutSizeB!.value = this.lutB?.size ?? 2;
    u.uLutMix!.value = this.lutB ? this.lutMix : 1;
    u.uLutStrength!.value = p.final.features.lut ? LUT_STRENGTH : 0;
    if (p.final.features.dirt) u.tDirt!.value = this.externalDirt ?? this.neutral.dirt ?? this.neutral.black;
    p.final.dirtIntensity = p.final.features.dirt ? LENS_DIRT_INTENSITY : 0;

    const a = this.active;
    a.ao = aoOn;
    a.contact = contactOn;
    a.ssr = ssrOn;
    a.composite = compositeOn;
    a.shafts = shaftsOn;
    a.bloom = bloomOn;
    a.dof = dofOn;
    a.taa = taaOn;
    a.smaa = !!p.smaa && !taaOn;
    a.fxaa = !!p.fxaa || (q.postMerged && q.antialias !== 'none');
    a.merged = q.postMerged;

    this.composer.render(dt);
  }

  dispose(): void {
    this.disposePasses();
    this.lutA?.release();
    this.lutB?.release();
    this.lutA = this.lutB = null;
    this.composer.dispose();
  }
}
