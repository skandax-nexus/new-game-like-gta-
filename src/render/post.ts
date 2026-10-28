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
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(Math.max(1, w / 2), Math.max(1, h / 2)), 0.32, 0.55, 0.92);
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
    u.uContrast!.value = q.colorGrading ? g.contrast : 1;
    u.uSaturation!.value = q.colorGrading ? g.saturation : 1;
    u.uWarmth!.value = q.colorGrading ? g.warmth : 0;
    u.uLift!.value = q.colorGrading ? g.lift : 0;
    u.uVignette!.value = q.vignette ? g.vignette : 0;
    (u.uTint!.value as THREE.Vector3).set(g.tint[0], g.tint[1], g.tint[2]);
    this.composer.render(dt);
  }

  dispose(): void {
    this.disposePasses();
    this.composer.dispose();
  }
}
