/**
 * Screen-space reflections (ultra, ART_BIBLE §13 "SSR + planar"): water and wet / polished stone.
 *
 * Mask: every opaque MeshStandard / MeshPhysical material writes `alpha = 1 - weight` into the HDR scene buffer,
 * weight = 1 - smoothstep(0.4 c, c, roughness) with the cut-off c in samG MATERIAL_BOOST.z (0 = SSR off ->
 * alpha 1 everywhere, so tiers without SSR are unaffected). Wetness lowers roughness, so rain turns SSR on for
 * stone. Custom shaders (GFX-02 water) opt in by writing their own weight: `gl_FragColor.a = 1.0 - w;`.
 * Trace: half resolution, view-space ray from depth-reconstructed normals, 24 linear steps + 4 binary refinements,
 * Schlick fresnel (F0 0.04), faded at screen edges, by distance and for rays toward the camera.
 * OWNER: Graphics Developer - Lighting, Atmosphere & Post (GFX-01).
 */
import * as THREE from 'three';
import { G, g, registerChunkPatch, SAM_G_DECL } from '../materials/chunks/globals';
import { colorTarget, DEPTH_GLSL, NOISE_GLSL, postMaterial, QuadPass, type PostFrame } from './shared';

/** Roughness above which nothing reflects in screen space (written to samG while SSR is active). */
export const SSR_ROUGHNESS_CUTOFF = 0.42;

const OPAQUE_LINE = 'gl_FragColor = vec4( outgoingLight, diffuseColor.a );';

/** Appended to three's opaque_fragment: the SSR weight of standard / physical opaque surfaces. */
export const SSR_MASK_GLSL = /* glsl */ `
#if defined( STANDARD ) && defined( OPAQUE )
${SAM_G_DECL}
{
  float samSsrCut = samG[ SAM_G_MATERIAL_BOOST ].z;
  if ( samSsrCut > 0.0 ) gl_FragColor.a = smoothstep( samSsrCut * 0.4, samSsrCut, material.roughness );
}
#endif
`;

registerChunkPatch('opaque_fragment', 'gfx01-ssr-mask', (src) => {
  if (!src.includes(OPAQUE_LINE)) throw new Error('ssr: three.js opaque_fragment changed');
  return `${src}\n${SSR_MASK_GLSL}`;
});

/** Turn the material-side mask on / off (shared global; reset to 0 each frame by the renderer). */
export function setSsrCutoff(cutoff: number): void {
  g(G.MATERIAL_BOOST).z = cutoff;
}

const SSR_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform mat4 uProj;
uniform mat4 uProjInv;
uniform vec2 uTexel;
uniform float uMaxDistance;
uniform float uNoiseOffset;
varying vec2 vUv;
${DEPTH_GLSL}
${NOISE_GLSL}
void main() {
  vec4 c = texture2D( tColor, vUv );
  float weight = 1.0 - clamp( c.a, 0.0, 1.0 );
  float d = texture2D( tDepth, vUv ).x;
  if ( weight < 0.02 || d >= 1.0 ) { gl_FragColor = vec4( 0.0 ); return; }
  vec3 P = samViewPosition( vUv, d, uProjInv );
  vec3 N = samViewNormal( tDepth, vUv, uTexel, uProjInv );
  vec3 V = normalize( P );
  vec3 R = normalize( reflect( V, N ) );
  float facing = 1.0 - smoothstep( 0.2, 0.7, R.z );
  if ( facing <= 0.0 ) { gl_FragColor = vec4( 0.0 ); return; }
  float maxLen = clamp( -P.z * 0.6, 4.0, uMaxDistance );
  // Clip the ray to the near plane side of the camera.
  if ( R.z > 0.0 ) maxLen = min( maxLen, ( -P.z - 0.6 ) / max( R.z, 1e-4 ) );
  vec3 E = P + R * maxLen;
  vec4 c0 = uProj * vec4( P, 1.0 );
  vec4 c1 = uProj * vec4( E, 1.0 );
  float jitter = samIGN( gl_FragCoord.xy + uNoiseOffset );
  vec2 hitUv = vec2( -1.0 );
  float hitT = 1.0;
  float prevT = 0.0;
  for ( int i = 1; i <= STEPS; i++ ) {
    float t = ( float( i ) - 1.0 + jitter ) / float( STEPS );
    // Perspective-correct interpolation between the clip-space end points.
    vec4 cl = mix( c0, c1, t );
    vec2 uv = cl.xy / cl.w * 0.5 + 0.5;
    if ( uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 ) break;
    float rayZ = mix( P.z, E.z, t );
    float sceneZ = samViewPosition( uv, texture2D( tDepth, uv ).x, uProjInv ).z;
    float thickness = 0.15 + -rayZ * 0.03;
    if ( sceneZ > rayZ && sceneZ - rayZ < thickness ) {
      // Binary refinement between the previous and this step.
      float a = prevT;
      float b = t;
      for ( int k = 0; k < 4; k++ ) {
        float m = 0.5 * ( a + b );
        vec4 cm = mix( c0, c1, m );
        vec2 um = cm.xy / cm.w * 0.5 + 0.5;
        float rz = mix( P.z, E.z, m );
        float sz = samViewPosition( um, texture2D( tDepth, um ).x, uProjInv ).z;
        if ( sz > rz ) b = m; else a = m;
      }
      vec4 cb = mix( c0, c1, b );
      hitUv = cb.xy / cb.w * 0.5 + 0.5;
      hitT = b;
      break;
    }
    prevT = t;
  }
  if ( hitUv.x < 0.0 ) { gl_FragColor = vec4( 0.0 ); return; }
  vec2 e = min( hitUv, 1.0 - hitUv );
  float edge = smoothstep( 0.0, 0.08, min( e.x, e.y ) );
  float ndv = clamp( dot( N, -V ), 0.0, 1.0 );
  float f = 1.0 - ndv;
  float f2 = f * f;
  float fresnel = 0.04 + 0.96 * f2 * f2 * f;
  float conf = edge * facing * ( 1.0 - hitT * hitT );
  vec3 refl = texture2D( tColor, hitUv ).rgb;
  gl_FragColor = vec4( refl, clamp( weight * conf * fresnel * 1.6, 0.0, 1.0 ) );
}
`;

export class SsrPass extends QuadPass {
  readonly name = 'ssr';
  private readonly out: THREE.WebGLRenderTarget;
  private readonly mat: THREE.ShaderMaterial;
  maxDistance = 120;
  temporal = false;
  private frameIndex = 0;

  constructor(private readonly frame: PostFrame) {
    super();
    this.needsSwap = false;
    this.out = colorTarget(1, 1, { name: 'post.ssr' });
    this.mat = postMaterial(
      'SamrajyaSsr',
      SSR_FRAG,
      {
        tColor: { value: null },
        tDepth: { value: null },
        uProj: { value: new THREE.Matrix4() },
        uProjInv: { value: new THREE.Matrix4() },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uMaxDistance: { value: 120 },
        uNoiseOffset: { value: 0 },
      },
      { STEPS: 24 },
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
    if (!f.depth || !f.sceneColor || !f.perspective) {
      f.ssr = null;
      return;
    }
    const u = this.mat.uniforms;
    u.tColor!.value = f.sceneColor;
    u.tDepth!.value = f.depth;
    (u.uProj!.value as THREE.Matrix4).copy(f.projection);
    (u.uProjInv!.value as THREE.Matrix4).copy(f.projectionInverse);
    u.uMaxDistance!.value = this.maxDistance;
    this.frameIndex = this.temporal ? (this.frameIndex + 1) % 64 : 0;
    u.uNoiseOffset!.value = this.frameIndex * 3.71;
    this.draw(renderer, this.mat, this.out);
    f.ssr = this.out.texture;
  }

  override dispose(): void {
    super.dispose();
    this.out.dispose();
    this.mat.dispose();
  }
}
