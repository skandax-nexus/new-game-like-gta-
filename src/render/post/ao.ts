/**
 * Ground-truth ambient occlusion (GTAO, Jimenez 2016 / XeGTAO slice integration) from the scene depth, with a
 * depth-aware 4x4 denoise. High: half resolution, 2 slices x 4 steps; ultra: full resolution, 3 slices x 4 steps.
 * Radius (m) = ZoomLook.post.aoRadiusM x (ResolvedLighting.aoRadiusM / 1.5); intensity = r.aoIntensity x
 * ZoomLook.post.aoScale. AO fades out with distance (aerial perspective takes over). OWNER: Graphics Developer -
 * Lighting, Atmosphere & Post (GFX-01).
 */
import * as THREE from 'three';
import { colorTarget, DEPTH_GLSL, NOISE_GLSL, postMaterial, QuadPass, type PostFrame } from './shared';

const GTAO_FRAG = /* glsl */ `
uniform sampler2D tDepth;
uniform mat4 uProj;
uniform mat4 uProjInv;
uniform vec2 uTexel;
uniform float uRadius;
uniform float uIntensity;
uniform float uFadeDist;
uniform float uNoiseOffset;
varying vec2 vUv;
${DEPTH_GLSL}
${NOISE_GLSL}
const float PI = 3.14159265;
const float HALF_PI = 1.5707963;
float samACos( float x ) { return acos( clamp( x, -1.0, 1.0 ) ); }
void main() {
  float d = texture2D( tDepth, vUv ).x;
  if ( d >= 1.0 ) { gl_FragColor = vec4( 1.0 ); return; }
  vec3 P = samViewPosition( vUv, d, uProjInv );
  float dist = -P.z;
  float fade = 1.0 - smoothstep( uFadeDist * 0.6, uFadeDist, dist );
  // Screen-space radius (uv) of the world radius at this depth.
  vec2 rUv = vec2( uProj[ 0 ][ 0 ], uProj[ 1 ][ 1 ] ) * ( 0.5 * uRadius / max( dist, 1e-3 ) );
  if ( fade <= 0.0 || rUv.y < uTexel.y * 1.5 ) { gl_FragColor = vec4( 1.0 ); return; }
  rUv = min( rUv, vec2( 0.25 ) );
  vec3 N = samViewNormal( tDepth, vUv, uTexel, uProjInv );
  vec3 V = normalize( -P );
  float noise = samIGN( gl_FragCoord.xy + uNoiseOffset );
  float noise2 = fract( noise * 1.618034 + 0.31 );
  float falloffRange = 0.615 * uRadius;
  float falloffMul = -1.0 / falloffRange;
  float falloffAdd = ( uRadius - falloffRange ) / falloffRange + 1.0;
  float visibility = 0.0;
  for ( int s = 0; s < SLICES; s++ ) {
    float phi = ( float( s ) + noise ) * ( PI / float( SLICES ) );
    vec3 dirV = vec3( cos( phi ), sin( phi ), 0.0 );
    vec2 omega = dirV.xy * rUv;
    vec3 orthoDir = dirV - dot( dirV, V ) * V;
    vec3 axis = normalize( cross( orthoDir, V ) );
    vec3 projN = N - axis * dot( N, axis );
    float projNLen = max( length( projN ), 1e-4 );
    float signN = dot( orthoDir, projN ) >= 0.0 ? 1.0 : -1.0;
    float cosN = clamp( dot( projN, V ) / projNLen, -1.0, 1.0 );
    float n = signN * samACos( cosN );
    float low0 = cos( n + HALF_PI );
    float low1 = cos( n - HALF_PI );
    float hc0 = low0;
    float hc1 = low1;
    for ( int j = 0; j < STEPS; j++ ) {
      float t = ( float( j ) + noise2 ) / float( STEPS );
      t = t * t + uTexel.y / rUv.y;
      vec2 o = omega * t;
      vec2 uv0 = vUv + o;
      vec2 uv1 = vUv - o;
      vec3 d0 = samViewPosition( uv0, texture2D( tDepth, uv0 ).x, uProjInv ) - P;
      vec3 d1 = samViewPosition( uv1, texture2D( tDepth, uv1 ).x, uProjInv ) - P;
      float l0 = max( length( d0 ), 1e-4 );
      float l1 = max( length( d1 ), 1e-4 );
      float w0 = clamp( l0 * falloffMul + falloffAdd, 0.0, 1.0 );
      float w1 = clamp( l1 * falloffMul + falloffAdd, 0.0, 1.0 );
      hc0 = max( hc0, mix( low0, dot( d0 / l0, V ), w0 ) );
      hc1 = max( hc1, mix( low1, dot( d1 / l1, V ), w1 ) );
    }
    float h0 = -samACos( hc1 );
    float h1 = samACos( hc0 );
    h0 = n + clamp( h0 - n, -HALF_PI, HALF_PI );
    h1 = n + clamp( h1 - n, -HALF_PI, HALF_PI );
    float iarc0 = ( cosN + 2.0 * h0 * sin( n ) - cos( 2.0 * h0 - n ) ) * 0.25;
    float iarc1 = ( cosN + 2.0 * h1 * sin( n ) - cos( 2.0 * h1 - n ) ) * 0.25;
    visibility += projNLen * ( iarc0 + iarc1 );
  }
  visibility = clamp( visibility / float( SLICES ), 0.0, 1.0 );
  float ao = exp2( log2( max( visibility, 1e-3 ) ) * uIntensity );
  gl_FragColor = vec4( mix( 1.0, ao, fade ), 0.0, 0.0, 1.0 );
}
`;

const DENOISE_FRAG = /* glsl */ `
uniform sampler2D tAo;
uniform sampler2D tDepth;
uniform mat4 uProjInv;
uniform vec2 uAoTexel;
varying vec2 vUv;
float viewZ( vec2 uv ) {
  float d = texture2D( tDepth, uv ).x;
  vec4 v = uProjInv * vec4( uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 );
  return v.z / v.w;
}
void main() {
  float zc = viewZ( vUv );
  float sum = 0.0;
  float wsum = 0.0;
  for ( int y = -2; y < 2; y++ ) {
    for ( int x = -2; x < 2; x++ ) {
      vec2 uv = vUv + ( vec2( float( x ), float( y ) ) + 0.5 ) * uAoTexel;
      float z = viewZ( uv );
      float w = exp( -abs( z - zc ) / ( abs( zc ) * 0.04 + 0.05 ) );
      sum += texture2D( tAo, uv ).r * w;
      wsum += w;
    }
  }
  gl_FragColor = vec4( sum / max( wsum, 1e-4 ), 0.0, 0.0, 1.0 );
}
`;

export class AoPass extends QuadPass {
  readonly name = 'gtao';
  private readonly raw: THREE.WebGLRenderTarget;
  private readonly out: THREE.WebGLRenderTarget;
  private readonly gtao: THREE.ShaderMaterial;
  private readonly denoise: THREE.ShaderMaterial;
  /** World radius (m) and intensity exponent for this frame. */
  radius = 1.5;
  intensity = 1;
  /** Re-randomise the noise every frame (only while TAA accumulates it). */
  temporal = false;
  private frameIndex = 0;

  constructor(
    private readonly frame: PostFrame,
    private readonly scale: number,
    slices: number,
  ) {
    super();
    this.needsSwap = false;
    this.raw = colorTarget(1, 1, { name: 'post.gtao' });
    this.out = colorTarget(1, 1, { name: 'post.gtao.denoised' });
    this.gtao = postMaterial(
      'SamrajyaGtao',
      GTAO_FRAG,
      {
        tDepth: { value: null },
        uProj: { value: new THREE.Matrix4() },
        uProjInv: { value: new THREE.Matrix4() },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uRadius: { value: 1.5 },
        uIntensity: { value: 1 },
        uFadeDist: { value: 600 },
        uNoiseOffset: { value: 0 },
      },
      { SLICES: slices, STEPS: 4 },
    );
    this.denoise = postMaterial('SamrajyaGtaoDenoise', DENOISE_FRAG, {
      tAo: { value: this.raw.texture },
      tDepth: { value: null },
      uProjInv: { value: new THREE.Matrix4() },
      uAoTexel: { value: new THREE.Vector2(1, 1) },
    });
  }

  override setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width * this.scale));
    const h = Math.max(1, Math.round(height * this.scale));
    this.raw.setSize(w, h);
    this.out.setSize(w, h);
    (this.gtao.uniforms.uTexel!.value as THREE.Vector2).set(1 / w, 1 / h);
    (this.denoise.uniforms.uAoTexel!.value as THREE.Vector2).set(1 / w, 1 / h);
  }

  override render(renderer: THREE.WebGLRenderer): void {
    const f = this.frame;
    if (!f.depth || !f.perspective) {
      f.ao = null;
      return;
    }
    const u = this.gtao.uniforms;
    u.tDepth!.value = f.depth;
    (u.uProj!.value as THREE.Matrix4).copy(f.projection);
    (u.uProjInv!.value as THREE.Matrix4).copy(f.projectionInverse);
    u.uRadius!.value = this.radius;
    u.uIntensity!.value = this.intensity;
    // Fade out where the radius covers less than ~1.5 px anyway (and keep AO off the far landscape).
    u.uFadeDist!.value = Math.min(f.far, this.radius * 400);
    this.frameIndex = this.temporal ? (this.frameIndex + 1) % 64 : 0;
    u.uNoiseOffset!.value = this.frameIndex * 5.588238;
    this.draw(renderer, this.gtao, this.raw);
    const d = this.denoise.uniforms;
    d.tDepth!.value = f.depth;
    (d.uProjInv!.value as THREE.Matrix4).copy(f.projectionInverse);
    this.draw(renderer, this.denoise, this.out);
    f.ao = this.out.texture;
  }

  override dispose(): void {
    super.dispose();
    this.raw.dispose();
    this.out.dispose();
    this.gtao.dispose();
    this.denoise.dispose();
  }
}
