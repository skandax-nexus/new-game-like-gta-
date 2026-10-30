/**
 * Volumetric sun shafts (ART_BIBLE §4.5 / §13): a screen-space radial scatter of the unoccluded sky around the
 * sun (GPU Gems 3 ch. 13). Mask = sky pixels (depth = far) near the sun, clamped; then QualitySettings.shaftsSamples
 * (24 / 32 / 48) taps toward the sun's screen position with ResolvedLighting.shaftsDecay / shaftsDensity, jittered
 * with interleaved gradient noise. Half resolution unless !shaftsHalfRes (ultra). Active while the sun is below
 * 35 deg or r.shaftsStrength > 0.3, scaled by r.shaftsStrength x ZoomLook.atmosphere.shaftsScale and faded as the
 * sun leaves the screen. Added to the HDR image before tone mapping. OWNER: Graphics Developer - Lighting,
 * Atmosphere & Post (GFX-01).
 */
import * as THREE from 'three';
import { colorTarget, NOISE_GLSL, postMaterial, QuadPass, type PostFrame } from './shared';

/** Shafts run while the sun is lower than this (deg) or the resolved strength exceeds SHAFTS_STRONG. */
export const SHAFTS_MAX_ELEVATION_DEG = 35;
export const SHAFTS_STRONG = 0.3;

/** Is the shafts pass worth running for this sun / lighting / band? (pure; tested) */
export function shaftsActive(samples: number, strength: number, sunElevationDeg: number, bandScale: number, screenVisibility: number): boolean {
  if (samples <= 0 || bandScale <= 0 || strength <= 1e-3 || screenVisibility <= 1e-3) return false;
  return sunElevationDeg < SHAFTS_MAX_ELEVATION_DEG || strength > SHAFTS_STRONG;
}

const MASK_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec3 uSun;
uniform float uAspect;
uniform float uClamp;
varying vec2 vUv;
void main() {
  float d = texture2D( tDepth, vUv ).x;
  float sky = step( 0.999999, d );
  vec2 ds = ( vUv - uSun.xy ) * vec2( uAspect, 1.0 );
  float w = exp( -dot( ds, ds ) * 3.0 );
  vec3 c = min( texture2D( tColor, vUv ).rgb, vec3( uClamp ) );
  gl_FragColor = vec4( c * ( sky * w ), 1.0 );
}
`;

const SCATTER_FRAG = /* glsl */ `
uniform sampler2D tMask;
uniform vec3 uSun;
uniform float uDensity;
uniform float uDecay;
uniform float uWeight;
uniform float uNoiseOffset;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  vec2 delta = ( vUv - uSun.xy ) * ( uDensity / float( SAMPLES ) );
  vec2 uv = vUv - delta * samIGN( gl_FragCoord.xy + uNoiseOffset );
  float decay = 1.0;
  vec3 sum = vec3( 0.0 );
  for ( int i = 0; i < SAMPLES; i++ ) {
    uv -= delta;
    sum += texture2D( tMask, uv ).rgb * decay;
    decay *= uDecay;
  }
  gl_FragColor = vec4( sum * ( uWeight / float( SAMPLES ) ), 1.0 );
}
`;

export class ShaftsPass extends QuadPass {
  readonly name = 'shafts';
  private readonly mask: THREE.WebGLRenderTarget;
  private readonly out: THREE.WebGLRenderTarget;
  private readonly maskMat: THREE.ShaderMaterial;
  private readonly scatterMat: THREE.ShaderMaterial;
  /** Final multiplier (r.shaftsStrength x band x visibility) and the authored decay / density. */
  strength = 0;
  decay = 0.95;
  density = 0.9;
  temporal = false;
  private frameIndex = 0;

  constructor(
    private readonly frame: PostFrame,
    samples: number,
    private readonly scale: number,
  ) {
    super();
    this.needsSwap = false;
    this.mask = colorTarget(1, 1, { name: 'post.shafts.mask' });
    this.out = colorTarget(1, 1, { name: 'post.shafts' });
    this.maskMat = postMaterial('SamrajyaShaftsMask', MASK_FRAG, {
      tColor: { value: null },
      tDepth: { value: null },
      uSun: { value: new THREE.Vector3() },
      uAspect: { value: 1 },
      uClamp: { value: 8 },
    });
    this.scatterMat = postMaterial(
      'SamrajyaShafts',
      SCATTER_FRAG,
      {
        tMask: { value: this.mask.texture },
        uSun: { value: new THREE.Vector3() },
        uDensity: { value: 0.9 },
        uDecay: { value: 0.95 },
        uWeight: { value: 1 },
        uNoiseOffset: { value: 0 },
      },
      { SAMPLES: Math.max(8, Math.round(samples)) },
    );
  }

  override setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width * this.scale));
    const h = Math.max(1, Math.round(height * this.scale));
    // The mask is low frequency: quarter of the scatter target.
    this.mask.setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    this.out.setSize(w, h);
    this.maskMat.uniforms.uAspect!.value = width / Math.max(1, height);
  }

  override render(renderer: THREE.WebGLRenderer): void {
    const f = this.frame;
    if (!f.depth || !f.sceneColor || this.strength <= 0) {
      f.shafts = null;
      return;
    }
    const m = this.maskMat.uniforms;
    m.tColor!.value = f.sceneColor;
    m.tDepth!.value = f.depth;
    (m.uSun!.value as THREE.Vector3).copy(f.sunScreen);
    this.draw(renderer, this.maskMat, this.mask);
    const s = this.scatterMat.uniforms;
    (s.uSun!.value as THREE.Vector3).copy(f.sunScreen);
    s.uDensity!.value = this.density;
    s.uDecay!.value = this.decay;
    // Normalise by the decay series so the strength reads the same for every sample count.
    let series = 0;
    let k = 1;
    const n = this.scatterMat.defines.SAMPLES as number;
    for (let i = 0; i < n; i++) {
      series += k;
      k *= this.decay;
    }
    s.uWeight!.value = (this.strength * n) / Math.max(1, series);
    this.frameIndex = this.temporal ? (this.frameIndex + 1) % 64 : 0;
    s.uNoiseOffset!.value = this.frameIndex * 4.37;
    this.draw(renderer, this.scatterMat, this.out);
    f.shafts = this.out.texture;
  }

  override dispose(): void {
    super.dispose();
    this.mask.dispose();
    this.out.dispose();
    this.maskMat.dispose();
    this.scatterMat.dispose();
  }
}
