/**
 * Shared post-processing plumbing: the per-frame context passes read, render-target helpers and GLSL snippets
 * (tone mapping copied verbatim from three r170 so authored exposures keep their meaning, depth reconstruction,
 * noise). OWNER: Graphics Developer - Lighting, Atmosphere & Post (GFX-01).
 */
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/** Per-frame data shared by the passes (owned by PostPipeline; passes read it, never allocate per frame). */
export interface PostFrame {
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** Device-pixel size of the full-resolution buffers. */
  width: number;
  height: number;
  /** Depth of the scene pass (valid for the rest of the frame). */
  depth: THREE.DepthTexture | null;
  /** HDR colour as rendered by the scene pass (alpha = 1 - SSR weight). */
  sceneColor: THREE.Texture | null;
  /** Current HDR image for the next pass (scene colour, then composite, then depth of field). */
  hdr: THREE.Texture | null;
  /** Perspective camera? (depth-based passes need one.) */
  perspective: boolean;
  /** Camera near / far (m). */
  near: number;
  far: number;
  /** Unjittered projection / inverse projection of the frame's camera. */
  projection: THREE.Matrix4;
  projectionInverse: THREE.Matrix4;
  /** Results of texture-only passes (null when the pass is off this frame). */
  ao: THREE.Texture | null;
  contact: THREE.Texture | null;
  ssr: THREE.Texture | null;
  shafts: THREE.Texture | null;
  bloom: THREE.Texture | null;
  /** Sun: direction toward it (world), screen uv (xy), visibility 0..1 (z), and colour x intensity (linear). */
  sunDir: THREE.Vector3;
  sunScreen: THREE.Vector3;
  sunColor: THREE.Color;
  /** View-space direction toward the key light (contact shadows). */
  sunView: THREE.Vector3;
  time: number;
  frame: number;
}

export function createPostFrame(): PostFrame {
  return {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    width: 1,
    height: 1,
    depth: null,
    sceneColor: null,
    hdr: null,
    perspective: true,
    near: 0.5,
    far: 2000,
    projection: new THREE.Matrix4(),
    projectionInverse: new THREE.Matrix4(),
    ao: null,
    contact: null,
    ssr: null,
    shafts: null,
    bloom: null,
    sunDir: new THREE.Vector3(0, 1, 0),
    sunScreen: new THREE.Vector3(0.5, 0.5, 0),
    sunColor: new THREE.Color(1, 1, 1),
    sunView: new THREE.Vector3(0, 1, 0),
    time: 0,
    frame: 0,
  };
}

/** HalfFloat colour target without depth (post intermediates). */
export function colorTarget(width: number, height: number, opts: { filter?: THREE.MagnificationTextureFilter; name?: string } = {}): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)), {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
    minFilter: opts.filter ?? THREE.LinearFilter,
    magFilter: opts.filter ?? THREE.LinearFilter,
  });
  rt.texture.name = opts.name ?? 'post';
  return rt;
}

export const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

/** three r170 ACES Filmic (exposure / 0.6) and AgX, plus sRGB encoding. */
export const TONEMAP_GLSL = /* glsl */ `
vec3 samRRTAndODTFit( vec3 v ) {
  vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
  vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
  return a / b;
}
vec3 samACES( vec3 color, float exposure ) {
  const mat3 ACESInputMat = mat3( vec3( 0.59719, 0.07600, 0.02840 ), vec3( 0.35458, 0.90834, 0.13383 ), vec3( 0.04823, 0.01566, 0.83777 ) );
  const mat3 ACESOutputMat = mat3( vec3( 1.60475, -0.10208, -0.00327 ), vec3( -0.53108, 1.10813, -0.07276 ), vec3( -0.07367, -0.00605, 1.07602 ) );
  color *= exposure / 0.6;
  color = ACESInputMat * color;
  color = samRRTAndODTFit( color );
  color = ACESOutputMat * color;
  return clamp( color, 0.0, 1.0 );
}
vec3 samAgxContrast( vec3 x ) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 samAgX( vec3 color, float exposure ) {
  const mat3 toRec2020 = mat3( vec3( 0.6274, 0.0691, 0.0164 ), vec3( 0.3293, 0.9195, 0.0880 ), vec3( 0.0433, 0.0113, 0.8956 ) );
  const mat3 toSRGB = mat3( vec3( 1.6605, -0.1246, -0.0182 ), vec3( -0.5876, 1.1329, -0.1006 ), vec3( -0.0728, -0.0083, 1.1187 ) );
  const mat3 inset = mat3( vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ), vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ), vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 ) );
  const mat3 outset = mat3( vec3( 1.1271005818144368, -0.1413297634984383, -0.14132976349843826 ), vec3( -0.11060664309660323, 1.157823702216272, -0.11060664309660294 ), vec3( -0.016493938717834573, -0.016493938717834257, 1.2519364065950405 ) );
  const float minEv = -12.47393;
  const float maxEv = 4.026069;
  color *= exposure;
  color = toRec2020 * color;
  color = inset * color;
  color = max( color, 1e-10 );
  color = log2( color );
  color = clamp( ( color - minEv ) / ( maxEv - minEv ), 0.0, 1.0 );
  color = samAgxContrast( color );
  color = outset * color;
  color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
  color = toSRGB * color;
  return clamp( color, 0.0, 1.0 );
}
vec3 samLinearToSRGB( vec3 c ) {
  return mix( c * 12.92, 1.055 * pow( max( c, vec3( 1e-9 ) ), vec3( 0.41666 ) ) - 0.055, step( vec3( 0.0031308 ), c ) );
}
float samLuma( vec3 c ) {
  return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
}
`;

/** Perspective depth -> view-space position (uv in [0,1], depth in [0,1]). */
export const DEPTH_GLSL = /* glsl */ `
vec3 samViewPosition( vec2 uv, float depth, mat4 projInv ) {
  vec4 clip = vec4( uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0 );
  vec4 view = projInv * clip;
  return view.xyz / view.w;
}
vec3 samViewNormal( sampler2D depthTex, vec2 uv, vec2 texel, mat4 projInv ) {
  float c = texture2D( depthTex, uv ).x;
  vec3 p = samViewPosition( uv, c, projInv );
  float l = texture2D( depthTex, uv - vec2( texel.x, 0.0 ) ).x;
  float r = texture2D( depthTex, uv + vec2( texel.x, 0.0 ) ).x;
  float b = texture2D( depthTex, uv - vec2( 0.0, texel.y ) ).x;
  float t = texture2D( depthTex, uv + vec2( 0.0, texel.y ) ).x;
  vec3 dx = abs( l - c ) < abs( r - c ) ? p - samViewPosition( uv - vec2( texel.x, 0.0 ), l, projInv ) : samViewPosition( uv + vec2( texel.x, 0.0 ), r, projInv ) - p;
  vec3 dy = abs( b - c ) < abs( t - c ) ? p - samViewPosition( uv - vec2( 0.0, texel.y ), b, projInv ) : samViewPosition( uv + vec2( 0.0, texel.y ), t, projInv ) - p;
  return normalize( cross( dx, dy ) );
}
`;

export const NOISE_GLSL = /* glsl */ `
float samIGN( vec2 p ) {
  return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) );
}
float samHash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
`;

/** A Pass with a fullscreen quad and a render-to helper. */
export abstract class QuadPass extends Pass {
  protected readonly quad = new FullScreenQuad();
  /** Debug / report name. */
  abstract readonly name: string;

  protected draw(renderer: THREE.WebGLRenderer, material: THREE.Material, target: THREE.WebGLRenderTarget | null, clear = false): void {
    renderer.setRenderTarget(target);
    if (clear) renderer.clear();
    this.quad.material = material;
    this.quad.render(renderer);
  }

  override dispose(): void {
    // FullScreenQuad.dispose() would dispose the geometry three shares between every quad; only drop the mesh.
    this.quad.material = null as unknown as THREE.Material;
  }
}

/** ShaderMaterial for a fullscreen pass (no depth test / write, no tone mapping). */
export function postMaterial(name: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>, defines: Record<string, string | number> = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name,
    uniforms,
    defines,
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    toneMapped: false,
  });
}
