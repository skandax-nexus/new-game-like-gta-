/**
 * Temporal anti-aliasing (ultra `antialias: 'taa'`: hero mode and cutscenes; the RTS bands keep SMAA until TAA
 * shows no ghosting on crowds / spears / banners, ART_BIBLE §13). Display-referred resolve after the grade:
 * camera reprojection from depth (closest depth of the 3x3 neighbourhood), Catmull-Rom history fetch, YCoCg
 * neighbourhood clipping, 0.1 feedback (0.25 on disocclusion / first frame). Jitter is applied by the scene pass.
 * Grain is added after the resolve so TAA does not average it away. OWNER: Graphics Developer - Lighting,
 * Atmosphere & Post (GFX-01).
 */
import * as THREE from 'three';
import { colorTarget, NOISE_GLSL, postMaterial, QuadPass, type PostFrame } from './shared';

const RESOLVE_FRAG = /* glsl */ `
uniform sampler2D tCurrent;
uniform sampler2D tHistory;
uniform sampler2D tDepth;
uniform mat4 uReproject; // previous viewProjection x inverse(current viewProjection)
uniform vec2 uTexel;
uniform float uFeedback;
uniform float uReset;
varying vec2 vUv;
vec3 toYCoCg( vec3 c ) {
  return vec3( dot( c, vec3( 0.25, 0.5, 0.25 ) ), dot( c, vec3( 0.5, 0.0, -0.5 ) ), dot( c, vec3( -0.25, 0.5, -0.25 ) ) );
}
vec3 fromYCoCg( vec3 c ) {
  return vec3( c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z );
}
vec3 historyCatmullRom( vec2 uv ) {
  vec2 res = 1.0 / uTexel;
  vec2 pos = uv * res;
  vec2 c = floor( pos - 0.5 ) + 0.5;
  vec2 f = pos - c;
  vec2 w0 = f * ( -0.5 + f * ( 1.0 - 0.5 * f ) );
  vec2 w1 = 1.0 + f * f * ( -2.5 + 1.5 * f );
  vec2 w2 = f * ( 0.5 + f * ( 2.0 - 1.5 * f ) );
  vec2 w3 = f * f * ( -0.5 + 0.5 * f );
  vec2 w12 = w1 + w2;
  vec2 tc0 = ( c - 1.0 ) * uTexel;
  vec2 tc3 = ( c + 2.0 ) * uTexel;
  vec2 tc12 = ( c + w2 / max( w12, vec2( 1e-4 ) ) ) * uTexel;
  vec3 r = texture2D( tHistory, vec2( tc12.x, tc0.y ) ).rgb * ( w12.x * w0.y );
  r += texture2D( tHistory, vec2( tc0.x, tc12.y ) ).rgb * ( w0.x * w12.y );
  r += texture2D( tHistory, tc12 ).rgb * ( w12.x * w12.y );
  r += texture2D( tHistory, vec2( tc3.x, tc12.y ) ).rgb * ( w3.x * w12.y );
  r += texture2D( tHistory, vec2( tc12.x, tc3.y ) ).rgb * ( w12.x * w3.y );
  float wsum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max( r / max( wsum, 1e-4 ), vec3( 0.0 ) );
}
void main() {
  vec3 cur = texture2D( tCurrent, vUv ).rgb;
  // Neighbourhood (YCoCg) and closest depth.
  vec3 m1 = vec3( 0.0 );
  vec3 m2 = vec3( 0.0 );
  float closest = 1.0;
  for ( int y = -1; y <= 1; y++ ) {
    for ( int x = -1; x <= 1; x++ ) {
      vec2 uv = vUv + vec2( float( x ), float( y ) ) * uTexel;
      vec3 c = toYCoCg( texture2D( tCurrent, uv ).rgb );
      m1 += c;
      m2 += c * c;
      float d = texture2D( tDepth, uv ).x;
      closest = min( closest, d );
    }
  }
  vec3 mean = m1 / 9.0;
  vec3 sigma = sqrt( max( m2 / 9.0 - mean * mean, vec3( 0.0 ) ) );
  vec3 boxMin = mean - sigma * 1.25;
  vec3 boxMax = mean + sigma * 1.25;
  vec4 prev = uReproject * vec4( vUv * 2.0 - 1.0, closest * 2.0 - 1.0, 1.0 );
  vec2 prevUv = prev.xy / prev.w * 0.5 + 0.5;
  float offscreen = ( prevUv.x < 0.0 || prevUv.y < 0.0 || prevUv.x > 1.0 || prevUv.y > 1.0 ) ? 1.0 : 0.0;
  vec3 hist = toYCoCg( historyCatmullRom( prevUv ) );
  // Clip toward the neighbourhood centre.
  vec3 cc = 0.5 * ( boxMax + boxMin );
  vec3 ext = max( 0.5 * ( boxMax - boxMin ), vec3( 1e-4 ) );
  vec3 v = hist - cc;
  vec3 a = abs( v / ext );
  float ma = max( a.x, max( a.y, a.z ) );
  if ( ma > 1.0 ) hist = cc + v / ma;
  float feedback = mix( uFeedback, 1.0, max( uReset, offscreen ) );
  vec3 res = mix( fromYCoCg( hist ), cur, feedback );
  gl_FragColor = vec4( clamp( res, 0.0, 1.0 ), 1.0 );
}
`;

const OUTPUT_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform float uGrain;
uniform float uTime;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  vec3 col = texture2D( tColor, vUv ).rgb;
  if ( uGrain > 0.0 ) {
    float gn = samHash( gl_FragCoord.xy + fract( uTime * 13.17 ) * 811.0 ) - 0.5;
    float lum = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
    col += gn * uGrain * 2.0 * ( 1.0 - lum * 0.6 );
  }
  gl_FragColor = vec4( clamp( col, 0.0, 1.0 ), 1.0 );
}
`;

export class TaaPass extends QuadPass {
  readonly name = 'taa';
  private readonly history: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private readonly resolve: THREE.ShaderMaterial;
  private readonly output: THREE.ShaderMaterial;
  private readonly prevViewProj = new THREE.Matrix4();
  private readonly viewProj = new THREE.Matrix4();
  private readonly tmp = new THREE.Matrix4();
  private readonly prevCamPos = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private index = 0;
  private valid = false;
  /** Feedback weight of the current frame. */
  feedback = 0.1;
  /** Grain (display units) added after the resolve. */
  grain = 0;

  constructor(private readonly frame: PostFrame) {
    super();
    this.needsSwap = true;
    this.history = [colorTarget(1, 1, { name: 'post.taa.a' }), colorTarget(1, 1, { name: 'post.taa.b' })];
    this.resolve = postMaterial('SamrajyaTaa', RESOLVE_FRAG, {
      tCurrent: { value: null },
      tHistory: { value: null },
      tDepth: { value: null },
      uReproject: { value: new THREE.Matrix4() },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uFeedback: { value: 0.1 },
      uReset: { value: 1 },
    });
    this.output = postMaterial('SamrajyaTaaOutput', OUTPUT_FRAG, { tColor: { value: null }, uGrain: { value: 0 }, uTime: { value: 0 } });
  }

  /** Drop the history (camera cut, resize, TAA switched on). */
  reset(): void {
    this.valid = false;
  }

  override setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    this.history[0].setSize(w, h);
    this.history[1].setSize(w, h);
    (this.resolve.uniforms.uTexel!.value as THREE.Vector2).set(1 / w, 1 / h);
    this.valid = false;
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const f = this.frame;
    const cam = f.camera;
    this.viewProj.multiplyMatrices(f.projection, cam.matrixWorldInverse);
    cam.getWorldPosition(this.camPos);
    // A jump of more than 25 m between frames is a cut.
    if (this.valid && this.camPos.distanceToSquared(this.prevCamPos) > 625) this.valid = false;
    const u = this.resolve.uniforms;
    const src = this.history[this.index]!;
    const dst = this.history[1 - this.index]!;
    u.tCurrent!.value = readBuffer.texture;
    u.tHistory!.value = src.texture;
    u.tDepth!.value = f.depth;
    (u.uReproject!.value as THREE.Matrix4).multiplyMatrices(this.valid ? this.prevViewProj : this.viewProj, this.tmp.copy(this.viewProj).invert());
    u.uFeedback!.value = this.feedback;
    u.uReset!.value = this.valid ? 0 : 1;
    this.draw(renderer, this.resolve, dst);
    const o = this.output.uniforms;
    o.tColor!.value = dst.texture;
    o.uGrain!.value = this.grain;
    o.uTime!.value = f.time;
    this.draw(renderer, this.output, this.renderToScreen ? null : writeBuffer);
    this.index = 1 - this.index;
    this.prevViewProj.copy(this.viewProj);
    this.prevCamPos.copy(this.camPos);
    this.valid = true;
  }

  override dispose(): void {
    super.dispose();
    this.history[0].dispose();
    this.history[1].dispose();
    this.resolve.dispose();
    this.output.dispose();
  }
}
