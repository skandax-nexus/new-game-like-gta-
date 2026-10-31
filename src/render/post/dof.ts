/**
 * Depth of field (ART_BIBLE §4.7: hero / cutscenes on high, every close band on ultra), two layers:
 *   far / in-focus field: half-resolution gather bokeh (golden-angle disk, scatter-as-gather weighting so a sharp
 *     foreground never bleeds into a blurred background), then a full-resolution blend by the circle of confusion;
 *   near field (AD round 1, blocker 3): an out-of-focus foreground must spread OVER the sharp scene behind it, or
 *     its outline stays hard and notched. The near CoC (points in front of the focus plane) is max-reduced into
 *     tiles of 8x8 full-res pixels and dilated by a 3x3 tile neighbourhood; the near layer is gathered with that
 *     dilated radius from near-field samples only (colour = mean of the samples whose own disc reaches the pixel,
 *     coverage = their share of the taps) and composited over the far result with
 *     alpha = coverage x smoothstep(0, 1, dilatedNearCoc / 2 px). Focus comes from post.setFocus() (hero
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

/** Near-field CoC (half-res px) of a view distance: only points in front of the focus plane. */
const NEAR_COC_GLSL = /* glsl */ `
float samNearCoc( float z ) {
  return z < uLens.x ? samCoc( z ) * 0.5 : 0.0;
}
`;

/** Tile max: one texel per 8x8 full-res (4x4 half-res) pixels = the largest near CoC in the tile (half-res px). */
const TILE_FRAG = /* glsl */ `
uniform sampler2D tHalf;
uniform vec2 uHalfTexel;
varying vec2 vUv;
${COC_GLSL}
${NEAR_COC_GLSL}
void main() {
  vec2 base = floor( gl_FragCoord.xy ) * 4.0;
  float m = 0.0;
  for ( int j = 0; j < 4; j++ ) {
    for ( int i = 0; i < 4; i++ ) {
      vec2 uv = ( base + vec2( float( i ), float( j ) ) + 0.5 ) * uHalfTexel;
      m = max( m, samNearCoc( texture2D( tHalf, min( uv, vec2( 1.0 ) - 0.5 * uHalfTexel ) ).a ) );
    }
  }
  gl_FragColor = vec4( m, 0.0, 0.0, 1.0 );
}
`;

/** 3x3 neighbourhood max of the tiles (a blurred foreground reaches up to one tile beyond its own). */
const DILATE_FRAG = /* glsl */ `
uniform sampler2D tTile;
uniform vec2 uTileTexel;
varying vec2 vUv;
void main() {
  float m = 0.0;
  for ( int j = -1; j <= 1; j++ ) {
    for ( int i = -1; i <= 1; i++ ) {
      m = max( m, texture2D( tTile, vUv + vec2( float( i ), float( j ) ) * uTileTexel ).r );
    }
  }
  gl_FragColor = vec4( m, 0.0, 0.0, 1.0 );
}
`;

/** Near-field gather (half res): rgb = mean of the near samples that reach this pixel, a = their share of the taps. */
const NEAR_FRAG = /* glsl */ `
uniform sampler2D tHalf;
uniform sampler2D tTileMax;
uniform vec2 uTexel;
varying vec2 vUv;
${COC_GLSL}
${NEAR_COC_GLSL}
const float GOLDEN = 2.39996323;
void main() {
  float R = min( texture2D( tTileMax, vUv ).r, uLens.z * 0.5 );
  if ( R < 0.25 ) {
    gl_FragColor = vec4( 0.0 );
    return;
  }
  vec4 center = texture2D( tHalf, vUv );
  float w0 = step( 0.25, samNearCoc( center.a ) );
  vec3 acc = center.rgb * w0;
  float cov = w0;
  for ( int i = 0; i < TAPS; i++ ) {
    float fi = float( i ) + 0.5;
    float r = R * sqrt( fi / float( TAPS ) );
    float a = fi * GOLDEN;
    vec4 s = texture2D( tHalf, vUv + vec2( cos( a ), sin( a ) ) * r * uTexel );
    float w = smoothstep( r - 0.5, r + 0.5, samNearCoc( s.a ) );
    acc += s.rgb * w;
    cov += w;
  }
  gl_FragColor = vec4( acc / max( cov, 1e-4 ), cov / float( TAPS + 1 ) );
}
`;

const BLEND_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tBlur;
uniform sampler2D tDepth;
uniform sampler2D tNear;
uniform sampler2D tTileMax;
uniform mat4 uProjInv;
varying vec2 vUv;
${COC_GLSL}
void main() {
  vec3 sharp = texture2D( tColor, vUv ).rgb;
  vec4 blur = texture2D( tBlur, vUv );
  float coc = max( samCoc( samViewDist( tDepth, vUv, uProjInv ) ), blur.a * 0.6 );
  float t = smoothstep( 0.6, 2.2, coc );
  vec3 col = mix( sharp, blur.rgb, t );
  // Near field over everything behind it: alpha = coverage x smoothstep( 0, 1, dilated near CoC / 2 px ).
  vec4 near = texture2D( tNear, vUv );
  float dil = texture2D( tTileMax, vUv ).r * 2.0; // full-res px
  float a = clamp( near.a, 0.0, 1.0 ) * smoothstep( 0.0, 1.0, dil / 2.0 );
  gl_FragColor = vec4( mix( col, near.rgb, a ), 1.0 );
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
  private readonly tile: THREE.WebGLRenderTarget;
  private readonly tileMax: THREE.WebGLRenderTarget;
  private readonly near: THREE.WebGLRenderTarget;
  private readonly tileMat: THREE.ShaderMaterial;
  private readonly dilateMat: THREE.ShaderMaterial;
  private readonly nearMat: THREE.ShaderMaterial;
  /** Near-field layer on (default); off reproduces the round-1 single-layer DoF (lab before / after). */
  nearField = true;
  private readonly prevClear = new THREE.Color();
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
    this.tile = colorTarget(1, 1, { name: 'post.dof.tile', filter: THREE.NearestFilter });
    this.tileMax = colorTarget(1, 1, { name: 'post.dof.tileMax' });
    this.near = colorTarget(1, 1, { name: 'post.dof.near' });
    const lens = { value: this.lens };
    this.tileMat = postMaterial('SamrajyaDofTile', TILE_FRAG, { tHalf: { value: this.half.texture }, uHalfTexel: { value: new THREE.Vector2(1, 1) }, uLens: lens });
    this.dilateMat = postMaterial('SamrajyaDofDilate', DILATE_FRAG, { tTile: { value: this.tile.texture }, uTileTexel: { value: new THREE.Vector2(1, 1) } });
    this.nearMat = postMaterial(
      'SamrajyaDofNear',
      NEAR_FRAG,
      { tHalf: { value: this.half.texture }, tTileMax: { value: this.tileMax.texture }, uTexel: { value: new THREE.Vector2(1, 1) }, uLens: lens },
      { TAPS: 24 },
    );
    this.downMat = postMaterial('SamrajyaDofDown', DOWN_FRAG, { tColor: { value: null }, tDepth: { value: null }, uProjInv: { value: new THREE.Matrix4() }, uLens: lens });
    this.gatherMat = postMaterial('SamrajyaDofGather', GATHER_FRAG, { tHalf: { value: this.half.texture }, uTexel: { value: new THREE.Vector2(1, 1) }, uLens: lens }, { TAPS: 24 });
    this.blendMat = postMaterial('SamrajyaDofBlend', BLEND_FRAG, {
      tColor: { value: null },
      tBlur: { value: this.blur.texture },
      tDepth: { value: null },
      tNear: { value: this.near.texture },
      tTileMax: { value: this.tileMax.texture },
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
    // Tiles of 8x8 full-res = 4x4 half-res pixels.
    const tw = Math.max(1, Math.ceil(w / 4));
    const th = Math.max(1, Math.ceil(h / 4));
    this.tile.setSize(tw, th);
    this.tileMax.setSize(tw, th);
    this.near.setSize(w, h);
    (this.tileMat.uniforms.uHalfTexel!.value as THREE.Vector2).set(1 / w, 1 / h);
    (this.dilateMat.uniforms.uTileTexel!.value as THREE.Vector2).set(1 / tw, 1 / th);
    (this.nearMat.uniforms.uTexel!.value as THREE.Vector2).set(1 / w, 1 / h);
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
    if (this.nearField) {
      this.draw(renderer, this.tileMat, this.tile);
      this.draw(renderer, this.dilateMat, this.tileMax);
      this.draw(renderer, this.nearMat, this.near);
    } else {
      // Single-layer DoF: an empty near layer (alpha 0) and zero tiles.
      renderer.getClearColor(this.prevClear);
      const alpha = renderer.getClearAlpha();
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(this.tileMax);
      renderer.clear(true, false, false);
      renderer.setRenderTarget(this.near);
      renderer.clear(true, false, false);
      renderer.setClearColor(this.prevClear, alpha);
    }
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
    this.tile.dispose();
    this.tileMax.dispose();
    this.near.dispose();
    this.tileMat.dispose();
    this.dilateMat.dispose();
    this.nearMat.dispose();
  }

  /** Draws per frame while on (down, far gather, tiles, dilate, near gather, blend). */
  drawCount(): number {
    return this.nearField ? 6 : 3;
  }
}
