/**
 * Post-processing pipeline. OWNER: Lead Graphics Engineer. Baseline by the CTO.
 *
 * Order (HDR linear until OutputPass):
 *   RenderPass -> GTAO/SSAO (high+) -> UnrealBloom (medium+) -> OutputPass (ACES tone map + sRGB)
 *   -> Grade (contrast/saturation/warmth/lift + vignette, display space) -> SMAA | FXAA
 * Every knob comes from QualitySettings; grading values come from the Art Director's presets
 * (render/style/palette.ts GRADE_PRESETS) and are set per scene / time of day via setGrade().
 *
 * TODO(owner): depth-aware atmospheric fog/god rays, temporal AA option, half-res AO upsample,
 * lens dirt on bloom, color LUTs per time of day, low tier single merged pass.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import type { QualitySettings } from '../core/types';
import type { ZoomLook } from './style/zoom';

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

export const DEFAULT_GRADE: GradeParams = { contrast: 1.06, saturation: 1.08, warmth: 0.08, lift: 0.01, vignette: 0.32, tint: [1, 1, 1] };

const GradeShader = {
  name: 'SamrajyaGrade',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uContrast: { value: 1 },
    uSaturation: { value: 1 },
    uWarmth: { value: 0 },
    uLift: { value: 0 },
    uVignette: { value: 0 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uContrast, uSaturation, uWarmth, uLift, uVignette, uAspect;
    uniform vec3 uTint;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      col *= uTint;
      col += vec3(uWarmth * 0.04, uWarmth * 0.012, -uWarmth * 0.04) * (0.5 + col);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;
      col += uLift * (1.0 - col);
      vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
      float v = smoothstep(0.95, 0.25, length(p) * 1.05);
      col *= mix(1.0, v, uVignette);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }
  `,
};

export class PostPipeline {
  readonly composer: EffectComposer;
  private renderPass: RenderPass;
  private aoPass: GTAOPass | SSAOPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private outputPass: OutputPass;
  private gradePass: ShaderPass;
  private aaPass: SMAAPass | ShaderPass | null = null;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private quality: QualitySettings;
  grade: GradeParams = { ...DEFAULT_GRADE, tint: [...DEFAULT_GRADE.tint] };

  constructor(renderer: THREE.WebGLRenderer, quality: QualitySettings) {
    this.quality = quality;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera();
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 0 });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.outputPass = new OutputPass();
    this.gradePass = new ShaderPass(GradeShader);
    this.rebuild();
  }

  /** Bind the scene/camera to render. */
  setView(scene: THREE.Scene, camera: THREE.Camera): void {
    if (scene === this.scene && camera === this.camera) return;
    this.scene = scene;
    this.camera = camera;
    this.rebuild();
  }

  setQuality(q: QualitySettings): void {
    this.quality = q;
    this.rebuild();
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.pixelRatio = pixelRatio;
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(this.width, this.height);
    this.updateAaResolution();
    this.gradePass.uniforms.uAspect!.value = this.width / this.height;
  }

  setGrade(g: Partial<GradeParams>): void {
    this.grade = { ...this.grade, ...g };
  }

  /** Lighting-driven post parameters (EnvironmentRig). threshold is scene-linear (r.bloomThreshold / r.exposure). */
  readonly lighting = { bloomStrength: 0.22, bloomRadius: 0.4, bloomThreshold: 4.5 / 0.8, aoIntensity: 1, aoRadiusM: 1.5 };
  /** ZoomLook post multipliers (AO, bloom, vignette, saturation, contrast...). */
  private look: ZoomLook | null = null;

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

  /** Plain-data state (pass list, key parameters) for diagnostics. */
  info(): Record<string, unknown> {
    return {
      passes: this.composer.passes.filter((p) => p.enabled).map((p) => (p as { name?: string }).name ?? p.constructor.name),
      lighting: { ...this.lighting },
      look: this.look?.id ?? null,
    };
  }

  /** Camera-distance look (ART_BIBLE §2): post multipliers for AO, bloom, DoF, vignette / saturation / contrast. */
  applyZoomLook(look: ZoomLook): void {
    this.look = look;
  }

  private disposePasses(): void {
    for (const p of [...this.composer.passes]) this.composer.removePass(p);
    this.outputPass.dispose();
    this.aoPass?.dispose();
    this.bloomPass?.dispose();
    if (this.aaPass) this.aaPass.dispose();
    this.aoPass = null;
    this.bloomPass = null;
    this.aaPass = null;
  }

  private rebuild(): void {
    this.disposePasses();
    const q = this.quality;
    const w = this.width * this.pixelRatio;
    const h = this.height * this.pixelRatio;
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    if (q.ao === 'gtao' && this.camera instanceof THREE.PerspectiveCamera) {
      const scale = q.aoHalfRes ? 0.5 : 1;
      const gtao = new GTAOPass(this.scene, this.camera, Math.max(1, w * scale), Math.max(1, h * scale));
      gtao.output = GTAOPass.OUTPUT.Default;
      gtao.blendIntensity = 0.85;
      gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.6, thickness: 4, scale: 1, samples: 12 });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      this.aoPass = gtao;
      this.composer.addPass(gtao);
    } else if (q.ao === 'ssao' && this.camera instanceof THREE.PerspectiveCamera) {
      const ssao = new SSAOPass(this.scene, this.camera, Math.max(1, w), Math.max(1, h));
      ssao.kernelRadius = 1.2;
      ssao.minDistance = 0.001;
      ssao.maxDistance = 0.05;
      this.aoPass = ssao;
      this.composer.addPass(ssao);
    }
    if (q.bloom) {
      // HDR threshold well above the sky's luminance so only the sun, fire and highlights bloom.
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(Math.max(1, w / 2), Math.max(1, h / 2)), 0.18, 0.45, 6);
      this.composer.addPass(this.bloomPass);
    }
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
    if (q.colorGrading || q.vignette) this.composer.addPass(this.gradePass);
    if (q.antialias === 'smaa') {
      this.aaPass = new SMAAPass(Math.max(1, w), Math.max(1, h));
      this.composer.addPass(this.aaPass);
    } else if (q.antialias === 'fxaa') {
      this.aaPass = new ShaderPass(FXAAShader);
      this.composer.addPass(this.aaPass);
    }
    this.updateAaResolution();
  }

  private updateAaResolution(): void {
    const w = Math.max(1, this.width * this.pixelRatio);
    const h = Math.max(1, this.height * this.pixelRatio);
    if (this.aaPass instanceof ShaderPass) {
      const res = this.aaPass.material.uniforms.resolution;
      if (res) (res.value as THREE.Vector2).set(1 / w, 1 / h);
    }
  }

  render(dt: number): void {
    const u = this.gradePass.uniforms;
    const g = this.grade;
    const q = this.quality;
    const lp = this.look?.post;
    u.uContrast!.value = q.colorGrading ? g.contrast * (lp ? lp.contrastMul : 1) : 1;
    u.uSaturation!.value = q.colorGrading ? g.saturation * (lp ? lp.saturationMul : 1) : 1;
    u.uWarmth!.value = q.colorGrading ? g.warmth : 0;
    u.uLift!.value = q.colorGrading ? g.lift : 0;
    u.uVignette!.value = q.vignette ? Math.max(0, g.vignette + (lp ? lp.vignetteAdd : 0)) : 0;
    if (this.bloomPass) {
      const l = this.lighting;
      this.bloomPass.strength = l.bloomStrength * (lp ? lp.bloomScale : 1);
      this.bloomPass.radius = l.bloomRadius;
      this.bloomPass.threshold = l.bloomThreshold;
    }
    (u.uTint!.value as THREE.Vector3).set(g.tint[0], g.tint[1], g.tint[2]);
    this.composer.render(dt);
  }

  dispose(): void {
    this.disposePasses();
    this.composer.dispose();
  }
}
