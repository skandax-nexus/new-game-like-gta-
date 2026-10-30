/**
 * Depth of field (ART_BIBLE §4.7: hero / cutscenes on high, every close band on ultra): half-resolution gather
 * bokeh (golden-angle disk, scatter-as-gather weighting so sharp foreground never bleeds into a blurred
 * background), then a full-resolution blend by the circle of confusion. Focus comes from post.setFocus() (hero
 * camera / cutscenes) or the ZoomLook band (camera-to-focus distance, fStop, maxBlurPx at 1080p x strength).
 * CoC model (thin-lens shape |z - focus| / z, artistic aperture; never a tilt-shift miniature):
 * coc = maxPx x strength x min(1, DOF_APERTURE_K x (2.8 / fStop) x |z - focus| / z) - at f/2.8 the background at
 * infinity gets half the band's max blur, the near ground in front of a hero ~3/4. OWNER: Graphics Developer - Lighting, Atmosphere & Post (GFX-01).
 */
import * as THREE from 'three';
import { colorTarget, postMaterial, QuadPass, type PostFrame } from './shared';

/** Aperture scale of the artistic CoC at f/2.8. */
export const DOF_APERTURE_K = 0.5;

/** Circle of confusion (px) of a point at view distance z for a lens focused at `focus` (pure; tested). */
export function circleOfConfusionPx(z: number, focus: number, fStop: number, maxPx: number, strength: number): number {
  if (maxPx <= 0 || strength <= 0) return 0;
  const k = (DOF_APERTURE_K * 2.8) / Math.max(0.5, fStop);
  return maxPx * strength * Math.min(1, (k * Math.abs(z - focus)) / Math.max(1e-3, z));
}

const COC_GLSL = /* glsl */ `
uniform vec4 uLens; // focus (m), k = DOF_APERTURE_K x 2.8 / fStop, max CoC (px at this resolution), unused
float samCoc( float z ) {
  return uLens.z * min( 1.0, uLens.y * abs( z - uLens.x ) / max( z, 1e-3 ) );
}
float samViewDist( sampler2D depthTex, vec2 uv, mat4 projInv ) {
  float d = texture2D( depthTex, uv ).x;
  vec4 v = projInv * vec4( uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 );
  return -v.z / v.w;
}
`;

const DOWN_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform mat4 uProjInv;
varying vec2 vUv;
${COC_GLSL}
void main() {
  vec3 c = texture2D( tColor, vUv ).rgb;
  float z = samViewDist( tDepth, vUv, uProjInv );
  gl_FragColor = vec4( c, z );
}
`;

const GATHER_FRAG = /* glsl */ `
uniform sampler2D tHalf;
uniform vec2 uTexel;
varying vec2 vUv;
${COC_GLSL}
const float GOLDEN = 2.39996323;
void main() {
  vec4 center = texture2D( tHalf, vUv );
  float cz = center.a;
  float cc = samCoc( cz ) * 0.5;
  vec3 acc = center.rgb;
  float tot = 1.0;
  float maxR = uLens.z * 0.5;
  for ( int i = 0; i < TAPS; i++ ) {
    float fi = float( i ) + 0.5;
    float r = maxR * sqrt( fi / float( TAPS ) );
    float a = fi * GOLDEN;
    vec2 uv = vUv + vec2( cos( a ), sin( a ) ) * r * uTexel;
    vec4 s = texture2D( tHalf, uv );
    float sc = samCoc( s.a ) * 0.5;
    // A sample behind the centre cannot blur over it by more than the centre's own CoC.
    if ( s.a > cz ) sc = min( sc, cc * 2.0 );
    float m = smoothstep( r - 0.5, r + 0.5, sc );
    // Gustafsson's single-pass bokeh: a sample that does not reach the centre repeats the running average.
    acc += mix( acc / tot, s.rgb, m );
    tot += 1.0;
  }
  gl_FragColor = vec4( acc / tot, cc * 2.0 );
}
`;

const BLEND_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tBlur;
uniform sampler2D tDepth;
uniform mat4 uProjInv;
varying vec2 vUv;
${COC_GLSL}
void main() {
  vec3 sharp = texture2D( tColor, vUv ).rgb;
  vec4 blur = texture2D( tBlur, vUv );
  float coc = max( samCoc( samViewDist( tDepth, vUv, uProjInv ) ), blur.a * 0.6 );
  float t = smoothstep( 0.6, 2.2, coc );
  gl_FragColor = vec4( mix( sharp, blur.rgb, t ), 1.0 );
}
`;

export class DofPass extends QuadPass {
  readonly name = 'dof';
  private readonly half: THREE.WebGLRenderTarget;
  private readonly blur: THREE.WebGLRenderTarget;
  private readonly out: THREE.WebGLRenderTarget;
  private readonly downMat: THREE.ShaderMaterial;
  private readonly gatherMat: THREE.ShaderMaterial;
  private readonly blendMat: THREE.ShaderMaterial;
  private readonly lens = new THREE.Vector4(10, 1, 0, 0);
  /** Lens for this frame: focus distance (m), f-stop, max blur (px at 1080p), strength 0..1. */
  focus = 10;
  fStop = 2.8;
  maxBlurPx = 10;
  strength = 0;

  constructor(private readonly frame: PostFrame) {
    super();
    this.needsSwap = false;
    this.half = colorTarget(1, 1, { name: 'post.dof.half' });
    this.blur = colorTarget(1, 1, { name: 'post.dof.blur' });
    this.out = colorTarget(1, 1, { name: 'post.dof' });
    const lens = { value: this.lens };
    this.downMat = postMaterial('SamrajyaDofDown', DOWN_FRAG, { tColor: { value: null }, tDepth: { value: null }, uProjInv: { value: new THREE.Matrix4() }, uLens: lens });
    this.gatherMat = postMaterial('SamrajyaDofGather', GATHER_FRAG, { tHalf: { value: this.half.texture }, uTexel: { value: new THREE.Vector2(1, 1) }, uLens: lens }, { TAPS: 24 });
    this.blendMat = postMaterial('SamrajyaDofBlend', BLEND_FRAG, {
      tColor: { value: null },
      tBlur: { value: this.blur.texture },
      tDepth: { value: null },
      uProjInv: { value: new THREE.Matrix4() },
      uLens: lens,
    });
  }

  /** Largest CoC (px at the current resolution) this lens can produce; the pipeline skips the pass below ~0.5. */
  maxCocPx(): number {
    // Near field (a quarter of the focus distance) blurs more than infinity: |z - f| / z = 3.
    const near = circleOfConfusionPx(this.focus * 0.25, this.focus, this.fStop, this.maxBlurPx, this.strength);
    return near * (this.frame.height / 1080);
  }

  override setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width / 2));
    const h = Math.max(1, Math.round(height / 2));
    this.half.setSize(w, h);
    this.blur.setSize(w, h);
    this.out.setSize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
    (this.gatherMat.uniforms.uTexel!.value as THREE.Vector2).set(1 / w, 1 / h);
  }

  override render(renderer: THREE.WebGLRenderer): void {
    const f = this.frame;
    if (!f.hdr || !f.depth || !f.perspective) return;
    const resScale = f.height / 1080;
    this.lens.set(Math.max(0.1, this.focus), (DOF_APERTURE_K * 2.8) / Math.max(0.5, this.fStop), this.maxBlurPx * this.strength * resScale, 0);
    const d = this.downMat.uniforms;
    d.tColor!.value = f.hdr;
    d.tDepth!.value = f.depth;
    (d.uProjInv!.value as THREE.Matrix4).copy(f.projectionInverse);
    this.draw(renderer, this.downMat, this.half);
    this.draw(renderer, this.gatherMat, this.blur);
    const b = this.blendMat.uniforms;
    b.tColor!.value = f.hdr;
    b.tDepth!.value = f.depth;
    (b.uProjInv!.value as THREE.Matrix4).copy(f.projectionInverse);
    this.draw(renderer, this.blendMat, this.out);
    f.hdr = this.out.texture;
  }

  override dispose(): void {
    super.dispose();
    this.half.dispose();
    this.blur.dispose();
    this.out.dispose();
    this.downMat.dispose();
    this.gatherMat.dispose();
    this.blendMat.dispose();
  }
}
