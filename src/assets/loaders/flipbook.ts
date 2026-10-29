/**
 * Flipbook (particle VFX atlas) handles and a reference playback material. OWNER: Technical Artist G (TA-07).
 * Format: docs/adr/0003-crowd-impostor-fx-assets.md (kind `flipbook`).
 *
 *   const fb = await ctx.assets.loadFlipbook('fx_smoke');             // null when off / failed
 *   const mat = createFlipbookMaterial(fb, { sequence: 'all' });      // lit (normal map) or unlit by entry
 *   mat.userData.flipbookFrame.value = frame;                         // fractional frame (cross-faded)
 *   const quad = new THREE.Mesh(new THREE.PlaneGeometry(4, 5), mat);
 *
 * Frame k (row-major from the top-left) covers u in [(k % cols) / cols, ...], v in [floor(k / cols) / rows, ...]
 * with flipY = false (v = 0 is the top row). The particle system (GFX-04 FxSystem) drives the frame per particle
 * (instanced attribute) - the frame / uv math below is the contract; soft particles fade over softFadeMeters.
 */
import * as THREE from 'three';
import type { FlipbookAssetEntry, FlipbookSequenceEntry } from '../types';

export interface FlipbookHandle {
  readonly entry: FlipbookAssetEntry;
  /** sRGB color + linear alpha (premultiplied when entry.blend === 'premultiplied'). */
  readonly color: THREE.Texture;
  readonly normal: THREE.Texture | null;
  readonly emissive: THREE.Texture | null;
  sequence(name: string): FlipbookSequenceEntry | null;
  release(): void;
}

/** UV rectangle [u0, v0, u1, v1] (flipY = false: v = 0 at the top) of atlas frame `k`. */
export function frameRect(entry: Pick<FlipbookAssetEntry, 'cols' | 'rows'>, k: number): [number, number, number, number] {
  const c = k % entry.cols;
  const r = Math.floor(k / entry.cols);
  return [c / entry.cols, r / entry.rows, (c + 1) / entry.cols, (r + 1) / entry.rows];
}

/** Frame index at time `t` (seconds) of a sequence (loops wrap, one-shots hold the last frame). */
export function frameAt(seq: FlipbookSequenceEntry, t: number): number {
  const f = Math.max(0, t) * seq.fps;
  const i = seq.loop ? Math.floor(f) % seq.count : Math.min(seq.count - 1, Math.floor(f));
  return seq.start + i;
}

export interface FlipbookMaterialOptions {
  /** Sequence name (default: the first). */
  sequence?: string;
  /** Override entry.lit. */
  lit?: boolean;
  /** Multiplies the color map (particle tint), linear. */
  tint?: THREE.ColorRepresentation;
  opacity?: number;
}

const FLIP_HEADER = /* glsl */ `
uniform float flipFrame;
uniform vec4 flipSeq;      // start, count, loop, unused
uniform vec2 flipGrid;     // cols, rows
uniform sampler2D flipColor;
uniform float flipEmissive;
#ifdef FLIP_NORMAL
uniform sampler2D flipNormal;
#endif
vec2 flipUv( float k, vec2 uv ) {
  float c = mod( k, flipGrid.x );
  float r = floor( k / flipGrid.x );
  return ( vec2( c, r ) + vec2( uv.x, 1.0 - uv.y ) ) / flipGrid;
}
void flipFrames( out float k0, out float k1, out float a ) {
  float f = flipSeq.z > 0.5 ? mod( flipFrame, flipSeq.y ) : clamp( flipFrame, 0.0, flipSeq.y - 1.0 );
  float i0 = floor( f );
  a = f - i0;
  float i1 = flipSeq.z > 0.5 ? mod( i0 + 1.0, flipSeq.y ) : min( i0 + 1.0, flipSeq.y - 1.0 );
  k0 = flipSeq.x + i0;
  k1 = flipSeq.x + i1;
}
`;

const FLIP_COLOR = /* glsl */ `
  float flipK0; float flipK1; float flipA;
  flipFrames( flipK0, flipK1, flipA );
  vec4 flipC = mix( texture2D( flipColor, flipUv( flipK0, vUv ) ), texture2D( flipColor, flipUv( flipK1, vUv ) ), flipA );
  #ifdef FLIP_PREMULTIPLIED
    diffuseColor.rgb *= flipC.rgb * flipEmissive;
    diffuseColor.a *= flipC.a;
  #else
    diffuseColor.rgb *= flipC.rgb;
    diffuseColor.a *= flipC.a;
  #endif
`;

const FLIP_NORMAL = /* glsl */ `
  #ifdef FLIP_NORMAL
  {
    vec3 fn = mix( texture2D( flipNormal, flipUv( flipK0, vUv ) ).xyz, texture2D( flipNormal, flipUv( flipK1, vUv ) ).xyz, flipA ) * 2.0 - 1.0;
    vec3 fpos = -vViewPosition;
    vec3 fdx = dFdx( fpos );
    vec3 fdy = dFdy( fpos );
    vec2 fuvx = dFdx( vUv );
    vec2 fuvy = dFdy( vUv );
    vec3 ft = normalize( fdx * fuvy.y - fdy * fuvx.y );
    vec3 fb = normalize( -fdx * fuvy.x + fdy * fuvx.x );
    normal = normalize( mat3( ft, fb, normal ) * normalize( fn ) );
  }
  #endif
`;

/**
 * Reference material for one flipbook sequence on a quad: lit (MeshStandardMaterial + atlas normal) or unlit
 * (MeshBasicMaterial, additive / premultiplied for fire and sparks). Frame in `userData.flipbookFrame`.
 */
export function createFlipbookMaterial(h: FlipbookHandle, opts: FlipbookMaterialOptions = {}): THREE.Material {
  const e = h.entry;
  const seq = (opts.sequence ? h.sequence(opts.sequence) : null) ?? e.sequences[0]!;
  const lit = (opts.lit ?? seq.lit ?? e.lit) && !!h.normal;
  const frame = { value: 0 };
  const uniforms: Record<string, THREE.IUniform> = {
    flipFrame: frame,
    flipSeq: { value: new THREE.Vector4(seq.start, seq.count, seq.loop ? 1 : 0, 0) },
    flipGrid: { value: new THREE.Vector2(e.cols, e.rows) },
    flipColor: { value: h.color },
    flipNormal: { value: h.normal },
    flipEmissive: { value: e.emissiveIntensity },
  };
  const blend = seq.blend ?? e.blend;
  const premul = blend === 'premultiplied';
  const additive = blend === 'additive';
  const params = {
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    color: new THREE.Color(opts.tint ?? 0xffffff),
    opacity: opts.opacity ?? 1,
    blending: additive ? THREE.AdditiveBlending : premul ? THREE.CustomBlending : THREE.NormalBlending,
  };
  const mat: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial = lit
    ? new THREE.MeshStandardMaterial({ ...params, roughness: 1, metalness: 0 })
    : new THREE.MeshBasicMaterial(params);
  if (premul) {
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneMinusSrcAlphaFactor;
    mat.premultipliedAlpha = true;
  }
  mat.name = `${e.id}:${seq.name}`;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.defines = { ...(shader.defines ?? {}), USE_UV: '', ...(lit ? { FLIP_NORMAL: '' } : {}), ...(premul ? { FLIP_PREMULTIPLIED: '' } : {}) };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n#ifndef USE_UV\n#define USE_UV\n#endif');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FLIP_HEADER}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${FLIP_COLOR}`);
    if (lit) shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', FLIP_NORMAL);
  };
  mat.customProgramCacheKey = () => `samrajya-flipbook|${lit ? 'l' : ''}${premul ? 'p' : ''}${additive ? 'a' : ''}`;
  mat.userData.flipbookFrame = frame;
  mat.userData.flipbookUniforms = uniforms;
  return mat;
}
