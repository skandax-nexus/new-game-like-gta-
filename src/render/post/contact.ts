/**
 * Screen-space contact shadows (ultra; ZoomLook.shadows.contact = close / hero bands): a short depth-buffer ray
 * march toward the key light that adds the fine contact the shadow maps cannot resolve (feet, hands, carved
 * reliefs). Half resolution, 12 steps; the composite darkens only sun-facing pixels by the key light's share of
 * the lighting. OWNER: Graphics Developer - Lighting, Atmosphere & Post (GFX-01).
 */
import * as THREE from 'three';
import { colorTarget, DEPTH_GLSL, NOISE_GLSL, postMaterial, QuadPass, type PostFrame } from './shared';

const CONTACT_FRAG = /* glsl */ `
uniform sampler2D tDepth;
uniform mat4 uProj;
uniform mat4 uProjInv;
uniform vec2 uTexel;
uniform vec3 uLightView;
uniform float uLength;
uniform float uThickness;
uniform float uNoiseOffset;
varying vec2 vUv;
${DEPTH_GLSL}
${NOISE_GLSL}
void main() {
  float d = texture2D( tDepth, vUv ).x;
  if ( d >= 1.0 ) { gl_FragColor = vec4( 1.0 ); return; }
  vec3 P = samViewPosition( vUv, d, uProjInv );
  vec3 N = samViewNormal( tDepth, vUv, uTexel, uProjInv );
  float ndl = dot( N, uLightView );
  if ( ndl <= 0.0 ) { gl_FragColor = vec4( 1.0 ); return; }
  float jitter = samIGN( gl_FragCoord.xy + uNoiseOffset );
  float len = uLength * clamp( -P.z / 20.0, 0.25, 2.0 );
  vec3 start = P + N * ( 0.01 * -P.z / 10.0 );
  float occl = 0.0;
  for ( int i = 0; i < STEPS; i++ ) {
    float t = ( float( i ) + jitter ) / float( STEPS );
    vec3 q = start + uLightView * ( len * t );
    vec4 clip = uProj * vec4( q, 1.0 );
    vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
    if ( uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 ) break;
    vec3 s = samViewPosition( uv, texture2D( tDepth, uv ).x, uProjInv );
    float delta = s.z - q.z;
    float thick = uThickness * ( 0.5 + -q.z / 40.0 );
    if ( delta > 0.005 * -q.z / 10.0 && delta < thick ) {
      occl = max( occl, 1.0 - t * t );
    }
  }
  float edge = smoothstep( 0.0, 0.05, min( min( vUv.x, 1.0 - vUv.x ), min( vUv.y, 1.0 - vUv.y ) ) );
  float facing = clamp( ndl * 4.0, 0.0, 1.0 );
  gl_FragColor = vec4( 1.0 - occl * edge * facing, 0.0, 0.0, 1.0 );
}
`;

export class ContactShadowPass extends QuadPass {
  readonly name = 'contact';
  private readonly out: THREE.WebGLRenderTarget;
  private readonly mat: THREE.ShaderMaterial;
  /** Ray length (m) at 20 m from the camera (scaled with distance). */
  length = 0.45;
  private frameIndex = 0;
  temporal = false;

  constructor(private readonly frame: PostFrame) {
    super();
    this.needsSwap = false;
    this.out = colorTarget(1, 1, { name: 'post.contact' });
    this.mat = postMaterial(
      'SamrajyaContactShadows',
      CONTACT_FRAG,
      {
        tDepth: { value: null },
        uProj: { value: new THREE.Matrix4() },
        uProjInv: { value: new THREE.Matrix4() },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uLightView: { value: new THREE.Vector3(0, 1, 0) },
        uLength: { value: 0.45 },
        uThickness: { value: 0.35 },
        uNoiseOffset: { value: 0 },
      },
      { STEPS: 12 },
    );
  }

  override setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width * 0.5));
    const h = Math.max(1, Math.round(height * 0.5));
    this.out.setSize(w, h);
    (this.mat.uniforms.uTexel!.value as THREE.Vector2).set(1 / w, 1 / h);
  }

  override render(renderer: THREE.WebGLRenderer): void {
    const f = this.frame;
    if (!f.depth || !f.perspective || f.sunView.z < -0.999) {
      f.contact = null;
      return;
    }
    const u = this.mat.uniforms;
    u.tDepth!.value = f.depth;
    (u.uProj!.value as THREE.Matrix4).copy(f.projection);
    (u.uProjInv!.value as THREE.Matrix4).copy(f.projectionInverse);
    (u.uLightView!.value as THREE.Vector3).copy(f.sunView);
    u.uLength!.value = this.length;
    this.frameIndex = this.temporal ? (this.frameIndex + 1) % 64 : 0;
    u.uNoiseOffset!.value = this.frameIndex * 7.13;
    this.draw(renderer, this.mat, this.out);
    f.contact = this.out.texture;
  }

  override dispose(): void {
    super.dispose();
    this.out.dispose();
    this.mat.dispose();
  }
}
