/**
 * Terrain splat-material hook: height-blended PBR layers on a MeshStandardMaterial (onBeforeCompile).
 * OWNER: Technical Art Director (with the Lead Graphics Engineer, who owns render/environment/terrain).
 *
 *   const mat = createSplatMaterial(
 *     [{ textures: grass, tileMeters: 4 }, { textures: dirt, tileMeters: 3 }, { textures: rock, tileMeters: 6 }],
 *     { weights: splatTexture, heightBlend: 0.2 }, // RGBA on uv0 = weights of layers 0..3
 *   );
 *
 * - Layers are sampled with world-space planar UVs (x, z) / tileMeters, so chunks tile seamlessly.
 * - Height blending uses each layer's ORM red channel (baked AO = cavity proxy for height) so pebbles
 *   poke through dirt and grass fills cracks, instead of linear cross-fades.
 * - A low-frequency macro variation (world-space value noise) breaks up tiling.
 * - Sampler budget: 4 layers x (albedo, normal, orm) + weights = 13 of 16 - keep shadows/env in mind.
 * Extend here for triplanar cliffs, wetness puddles (MATERIAL_GLOBALS.wetness) and distance blends.
 */
import * as THREE from 'three';
import { MATERIAL_GLOBALS, type PbrTextures } from './pbr';

export interface SplatLayer {
  textures: PbrTextures;
  /** World meters covered by one texture repeat. */
  tileMeters: number;
  /** Bias added to the layer height before blending (raise to make the layer dominate). */
  heightBias?: number;
}

export interface SplatOptions {
  /** RGBA weights (layer i = channel i) sampled with the mesh uv0. Vertex colors if omitted. */
  weights?: THREE.Texture | null;
  /** Blend sharpness: smaller = crisper height transitions. Default 0.2. */
  heightBlend?: number;
  /** Macro brightness variation amplitude (0..0.5). Default 0.12. */
  macroVariation?: number;
  name?: string;
}

let white: THREE.DataTexture | null = null;
let flatNormal: THREE.DataTexture | null = null;

function solid(r: number, g: number, b: number): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
}

export function createSplatMaterial(layers: readonly SplatLayer[], opts: SplatOptions = {}): THREE.MeshStandardMaterial {
  if (layers.length < 1 || layers.length > 4) throw new Error('createSplatMaterial: 1..4 layers');
  white ??= solid(255, 255, 255);
  flatNormal ??= solid(128, 128, 255);
  const mat = new THREE.MeshStandardMaterial({ name: opts.name ?? 'terrain_splat', color: 0xffffff, roughness: 1, metalness: 1 });
  const n = layers.length;
  const uniforms: Record<string, THREE.IUniform> = {
    uSplatWeights: { value: opts.weights ?? white },
    uSplatTile: { value: new THREE.Vector4(...[0, 1, 2, 3].map((i) => 1 / (layers[i]?.tileMeters ?? 1))) },
    uSplatBias: { value: new THREE.Vector4(...[0, 1, 2, 3].map((i) => layers[i]?.heightBias ?? 0)) },
    uSplatSharp: { value: Math.max(0.01, opts.heightBlend ?? 0.2) },
    uSplatMacro: { value: opts.macroVariation ?? 0.12 },
    uWetness: MATERIAL_GLOBALS.wetness,
  };
  for (let i = 0; i < 4; i++) {
    const t = layers[i]?.textures;
    uniforms[`uSplatAlbedo${i}`] = { value: t?.baseColor ?? white };
    uniforms[`uSplatNormal${i}`] = { value: t?.normal ?? flatNormal };
    uniforms[`uSplatOrm${i}`] = { value: t?.orm ?? white };
  }
  mat.defines = { ...(mat.defines ?? {}), USE_UV: '', SPLAT_LAYERS: String(n), ...(opts.weights ? {} : { SPLAT_VERTEX_WEIGHTS: '' }) };
  if (!opts.weights) mat.vertexColors = true;
  mat.userData.samrajyaUniforms = uniforms;
  const samplerDecl = [0, 1, 2, 3].map((i) => `uniform sampler2D uSplatAlbedo${i}; uniform sampler2D uSplatNormal${i}; uniform sampler2D uSplatOrm${i};`).join('\n');
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSplatWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vSplatWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vSplatWorld;
uniform sampler2D uSplatWeights;
uniform vec4 uSplatTile;
uniform vec4 uSplatBias;
uniform float uSplatSharp;
uniform float uSplatMacro;
uniform float uWetness;
${samplerDecl}
float splatHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float splatNoise( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( splatHash( i ), splatHash( i + vec2( 1, 0 ) ), f.x ), mix( splatHash( i + vec2( 0, 1 ) ), splatHash( i + vec2( 1, 1 ) ), f.x ), f.y );
}
vec4 splatW;
vec4 splatOrm;
vec3 splatN;`,
      )
      .replace(
        '#include <map_fragment>',
        `{
  #ifdef SPLAT_VERTEX_WEIGHTS
    vec4 w = vec4( vColor.rgb, 0.0 );
  #else
    vec4 w = texture2D( uSplatWeights, vUv );
  #endif
  vec2 p = vSplatWorld.xz;
  vec2 uv0 = p * uSplatTile.x; vec2 uv1 = p * uSplatTile.y; vec2 uv2 = p * uSplatTile.z; vec2 uv3 = p * uSplatTile.w;
  vec4 o0 = texture2D( uSplatOrm0, uv0 ); vec4 o1 = texture2D( uSplatOrm1, uv1 );
  vec4 o2 = texture2D( uSplatOrm2, uv2 ); vec4 o3 = texture2D( uSplatOrm3, uv3 );
  vec4 h = vec4( o0.r, o1.r, o2.r, o3.r ) + uSplatBias;
  vec4 b = w * ( 1.0 + h );
  #if SPLAT_LAYERS < 4
    b.w = -1.0;
  #endif
  #if SPLAT_LAYERS < 3
    b.z = -1.0;
  #endif
  #if SPLAT_LAYERS < 2
    b.y = -1.0;
  #endif
  float m = max( max( b.x, b.y ), max( b.z, b.w ) ) - uSplatSharp;
  vec4 f = max( b - m, 0.0 );
  splatW = f / max( dot( f, vec4( 1.0 ) ), 1e-4 );
  vec3 alb = texture2D( uSplatAlbedo0, uv0 ).rgb * splatW.x + texture2D( uSplatAlbedo1, uv1 ).rgb * splatW.y
           + texture2D( uSplatAlbedo2, uv2 ).rgb * splatW.z + texture2D( uSplatAlbedo3, uv3 ).rgb * splatW.w;
  splatOrm = o0 * splatW.x + o1 * splatW.y + o2 * splatW.z + o3 * splatW.w;
  splatN = ( texture2D( uSplatNormal0, uv0 ).xyz * splatW.x + texture2D( uSplatNormal1, uv1 ).xyz * splatW.y
           + texture2D( uSplatNormal2, uv2 ).xyz * splatW.z + texture2D( uSplatNormal3, uv3 ).xyz * splatW.w ) * 2.0 - 1.0;
  float macro = splatNoise( p * 0.031 ) * 0.6 + splatNoise( p * 0.11 ) * 0.4;
  alb *= 1.0 + ( macro - 0.5 ) * 2.0 * uSplatMacro;
  diffuseColor.rgb *= alb * mix( 1.0, 0.6, uWetness );
}`,
      )
      .replace('#include <color_fragment>', '#ifndef SPLAT_VERTEX_WEIGHTS\n#include <color_fragment>\n#endif')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * mix( splatOrm.g, 0.15, uWetness * 0.8 );')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = metalness * splatOrm.b;')
      .replace(
        '#include <normal_fragment_maps>',
        `{
  vec3 T = normalize( ( viewMatrix * vec4( 1.0, 0.0, 0.0, 0.0 ) ).xyz );
  T = normalize( T - normal * dot( normal, T ) );
  vec3 B = normalize( cross( T, normal ) );
  normal = normalize( mat3( T, B, normal ) * splatN );
}`,
      )
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n  reflectedLight.indirectDiffuse *= splatOrm.r;');
  };
  mat.customProgramCacheKey = () => `samrajya-splat|${n}|${opts.weights ? 't' : 'v'}`;
  return mat;
}
