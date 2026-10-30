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
 *
 * Particles are transparent and write no depth: they must never reach an override-material pass (the GTAO / SSAO
 * normal + depth pre-pass draws every mesh opaque - each quad became a visible card with an AO halo).
 * createFlipbookMaterial tags the material `userData.samrajyaPrepass = 'skip'`; createFlipbookMesh (or
 * installPrepassGuard(mesh, 'skip') on the particle system's own InstancedMesh) enforces it - loaders/prepass.ts.
 *
 * Lit books (smoke, dust, mist, leaves) are lit as a PARTICIPATING MEDIUM, not a solid (ADR 0003 "Lit flipbooks",
 * the contract for GFX-04): wrap lighting for the sun, (N.L + w) / (1 + w) with w = FLIP_WRAP (0.6), ambient from
 * the UPPER hemisphere (the IBL / hemisphere / probe irradiance is sampled along normalize(N * FLIP_AMBIENT_TILT + up),
 * never the dark ground below a puff) scaled by the sky visibility 1 - k (1 - N.up) / 2 (k = FLIP_SKY_VISIBILITY: the
 * underside of a puff sees less sky, so a high sun still gives darker bases) and no specular. Plain Lambert on a solid-looking normal turned lit smoke into
 * creased lumps with near-black pockets under golden light (Art Director TA-07 R2-B1).
 *
 * Gradient-mapped books (`entry.ramp`, fx_fire / fx_weapon_trail): the color atlas stores ONE channel - v, the
 * sRGB-encoded luminance of the emission (R = G = B, loaded without colour conversion) - plus alpha; the shader
 * colours it with rgb = ramp(v) (evenly spaced linear stops, R >= G >= B, ramp(0) = 0). No chroma is ever stored, so
 * lossy / quantised texels cannot drift towards green or blue (R2-B2, R2-B3).
 */
import * as THREE from 'three';
import type { FlipbookAssetEntry, FlipbookSequenceEntry } from '../types';
import { installPrepassGuard, PREPASS_TAG } from './prepass';

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
  /** Lit books: sun wrap w in (N.L + w) / (1 + w); default FLIP_WRAP. 0 = Lambert. */
  wrap?: number;
  /** Lit books: sky visibility k - ambient x (1 - k (1 - N.up) / 2); default FLIP_SKY_VISIBILITY. 0 = uniform. */
  skyVisibility?: number;
  /** Lit books, lookdev only: scales the atlas normals' tilt (xy) before normalising; default 1 (as baked). */
  normalScale?: number;
}

/**
 * Sun wrap of lit (participating-medium) books: (N.L + w) / (1 + w). 0.6 (the Art Director asked for ~0.5): with the
 * baked sun-lit tops, 0.5 put golden-hour smoke's shadow / lit ratio just under 0.35 (TA-07 R2 measurements).
 */
export const FLIP_WRAP = 0.6;
/** Lit books sample ambient irradiance along normalize(N * FLIP_AMBIENT_TILT + up): upper hemisphere only. */
export const FLIP_AMBIENT_TILT = 0.5;
/**
 * Lit books: sky visibility of the medium - ambient x (1 - k (1 - N.up) / 2): a puff's underside sees less of the sky
 * than its top (darker bases under a high sun), bounded below by (1 - k) of the sky irradiance (never the ground).
 */
export const FLIP_SKY_VISIBILITY = 0.5;
/** Stops of a gradient-map ramp (`entry.ramp`), evenly spaced over v in [0, 1]. */
export const FLIP_RAMP_MAX_STOPS = 33;

/**
 * Exact text the lit-book patch rewrites in three r170 chunks (tests/assets/flipbook-material.test.ts checks they
 * still exist, so a three upgrade cannot silently drop the medium lighting).
 */
export const FLIP_CHUNK_HOOKS = {
  directDotNL: 'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );',
  probe: 'getLightProbeIrradiance( lightProbe, geometryNormal )',
  hemi: 'getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal )',
  ibl: 'getIBLIrradiance( geometryNormal )',
} as const;

/** Linear rgb of a gradient-map ramp at v (piecewise linear over evenly spaced stops) - the shader's flipRampColor. */
export function rampColor(ramp: readonly (readonly number[])[], v: number): [number, number, number] {
  const n = ramp.length;
  if (n === 0) return [0, 0, 0];
  if (n === 1) return [ramp[0]![0]!, ramp[0]![1]!, ramp[0]![2]!];
  const x = Math.min(1, Math.max(0, v)) * (n - 1);
  const i = Math.min(Math.floor(x), n - 2);
  const f = x - i;
  const a = ramp[i]!;
  const b = ramp[i + 1]!;
  return [a[0]! + (b[0]! - a[0]!) * f, a[1]! + (b[1]! - a[1]!) * f, a[2]! + (b[2]! - a[2]!) * f];
}

const FLIP_HEADER = /* glsl */ `
uniform float flipFrame;
uniform vec4 flipSeq;      // start, count, loop, unused
uniform vec2 flipGrid;     // cols, rows
uniform sampler2D flipColor;
uniform float flipEmissive;
#ifdef FLIP_NORMAL
uniform sampler2D flipNormal;
// participating medium: ambient irradiance from the upper hemisphere (sky above the puff), never the dark ground
vec3 flipAmbientNormal( vec3 n ) {
  vec3 up = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
  return normalize( n * FLIP_AMBIENT_TILT + up );
}
// sky visibility: the underside of a puff sees less sky than its top (bounded: never below 1 - FLIP_SKY_VIS)
float flipSkyVis( vec3 n ) {
  vec3 up = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
  return 1.0 - FLIP_SKY_VIS * ( 0.5 - 0.5 * dot( n, up ) );
}
#endif
#ifdef FLIP_RAMP
// gradient map: the atlas stores v (sRGB-encoded emission luminance), the colour comes from evenly spaced stops
uniform vec3 flipRamp[ FLIP_RAMP ];
vec3 flipRampColor( float v ) {
  float x = clamp( v, 0.0, 1.0 ) * float( FLIP_RAMP - 1 );
  float i = min( floor( x ), float( FLIP_RAMP - 2 ) );
  int k = int( i );
  return mix( flipRamp[ k ], flipRamp[ k + 1 ], x - i );
}
#endif
// hp = half a texel in frame units: bilinear taps stay inside the frame, so a neighbouring frame never bleeds across
// the seam (e.g. a ground-strike bolt's open bottom edge into the closed top edge of the frame below)
vec2 flipUv( float k, vec2 uv, vec2 hp ) {
  float c = mod( k, flipGrid.x );
  float r = floor( k / flipGrid.x );
  return ( vec2( c, r ) + clamp( vec2( uv.x, 1.0 - uv.y ), hp, 1.0 - hp ) ) / flipGrid;
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
  vec2 flipHp = 0.5 * flipGrid / vec2( textureSize( flipColor, 0 ) );
  #ifdef FLIP_NORMAL
    flipHp = max( flipHp, 0.5 * flipGrid / vec2( textureSize( flipNormal, 0 ) ) );
  #endif
  vec4 flipC = mix( texture2D( flipColor, flipUv( flipK0, vUv, flipHp ) ), texture2D( flipColor, flipUv( flipK1, vUv, flipHp ) ), flipA );
  #ifdef FLIP_RAMP
    flipC.rgb = flipRampColor( flipC.r );
  #endif
  #if defined( FLIP_PREMULTIPLIED )
    // premultiplied books store emission + occlusion: x emissiveIntensity (fire 6.5); material opacity fades both
    diffuseColor.rgb *= flipC.rgb * flipEmissive * diffuseColor.a;
    diffuseColor.a *= flipC.a;
  #elif defined( FLIP_ADDITIVE )
    // additive books store emission: x emissiveIntensity (sparks 6, trails 3, lightning 10); blending applies alpha
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
    vec3 fn = mix( texture2D( flipNormal, flipUv( flipK0, vUv, flipHp ) ).xyz, texture2D( flipNormal, flipUv( flipK1, vUv, flipHp ) ).xyz, flipA ) * 2.0 - 1.0;
    fn.xy *= FLIP_NSCALE;
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

/** Lit-book lighting: three's physical chunks with wrap lighting, upper-hemisphere ambient and no specular. */
function patchMediumLighting(fragment: string): string {
  const H = FLIP_CHUNK_HOOKS;
  const pars = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
    H.directDotNL,
    'float dotNL = saturate( ( dot( geometryNormal, directLight.direction ) + FLIP_WRAP ) / ( 1.0 + FLIP_WRAP ) );',
  );
  const begin = THREE.ShaderChunk.lights_fragment_begin
    .replace(H.probe, 'getLightProbeIrradiance( lightProbe, flipAmbientNormal( geometryNormal ) ) * flipSkyVis( geometryNormal )')
    .replace(H.hemi, 'getHemisphereLightIrradiance( hemisphereLights[ i ], flipAmbientNormal( geometryNormal ) ) * flipSkyVis( geometryNormal )');
  const maps = THREE.ShaderChunk.lights_fragment_maps.replace(
    H.ibl,
    'getIBLIrradiance( flipAmbientNormal( geometryNormal ) ) * flipSkyVis( geometryNormal )',
  );
  return fragment
    .replace('#include <lights_physical_pars_fragment>', pars)
    .replace(
      '#include <lights_physical_fragment>',
      // a medium scatters, it does not reflect: no direct / IBL specular, no multi-scatter energy taken from diffuse
      '#include <lights_physical_fragment>\n  material.specularColor = vec3( 0.0 );\n  material.specularF90 = 0.0;',
    )
    .replace('#include <lights_fragment_begin>', begin)
    .replace('#include <lights_fragment_maps>', maps);
}

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
  const ramp = e.ramp && e.ramp.length >= 2 ? e.ramp.slice(0, FLIP_RAMP_MAX_STOPS) : null;
  if (ramp) uniforms.flipRamp = { value: ramp.map((c) => new THREE.Vector3(c[0], c[1], c[2])) };
  const wrap = opts.wrap ?? FLIP_WRAP;
  const skyVis = opts.skyVisibility ?? FLIP_SKY_VISIBILITY;
  const nScale = opts.normalScale ?? 1;
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
  // Scene fog mixes rgb towards the fog color, which ADDS that color wherever an additive / premultiplied quad is
  // transparent (white boxes at distance): emissive books fade with distance in the particle system instead.
  if (additive || premul) mat.fog = false;
  if (premul) {
    // The atlas is ALREADY premultiplied (emission + occlusion alpha): blend ONE / ONE_MINUS_SRC_ALPHA, and do NOT set
    // material.premultipliedAlpha - three's PREMULTIPLIED_ALPHA chunk multiplies rgb by alpha again, which turned the
    // fire into rgb x occlusion (dim, sparse tongues and dark "soot" wisps where the gas cools).
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneMinusSrcAlphaFactor;
    mat.blendEquation = THREE.AddEquation;
    mat.premultipliedAlpha = false;
  }
  mat.name = `${e.id}:${seq.name}`;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.defines = {
      ...(shader.defines ?? {}),
      USE_UV: '',
      ...(lit
        ? {
            FLIP_NORMAL: '',
            FLIP_WRAP: glslFloat(wrap),
            FLIP_AMBIENT_TILT: glslFloat(FLIP_AMBIENT_TILT),
            FLIP_SKY_VIS: glslFloat(skyVis),
            FLIP_NSCALE: glslFloat(nScale),
          }
        : {}),
      ...(premul ? { FLIP_PREMULTIPLIED: '' } : {}),
      ...(additive ? { FLIP_ADDITIVE: '' } : {}),
      ...(ramp ? { FLIP_RAMP: String(ramp.length) } : {}),
    };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n#ifndef USE_UV\n#define USE_UV\n#endif');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FLIP_HEADER}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${FLIP_COLOR}`);
    if (lit) shader.fragmentShader = patchMediumLighting(shader.fragmentShader.replace('#include <normal_fragment_maps>', FLIP_NORMAL));
  };
  mat.customProgramCacheKey = () =>
    `samrajya-flipbook|${lit ? `l${glslFloat(wrap)}s${glslFloat(skyVis)}n${glslFloat(nScale)}` : ''}${premul ? 'p' : ''}${additive ? 'a' : ''}${ramp ? `r${ramp.length}` : ''}`;
  mat.userData.flipbookFrame = frame;
  mat.userData.flipbookUniforms = uniforms;
  mat.userData[PREPASS_TAG] = 'skip';
  return mat;
}

function glslFloat(v: number): string {
  const s = String(Math.round(v * 1e4) / 1e4);
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
}

/**
 * A particle quad (or the caller's geometry) with a flipbook material, guarded against override-material passes
 * (prepass 'skip'). Geometry ownership: a geometry passed in stays the caller's; the default 1 x 1 quad is freed by
 * `mesh.userData.dispose()` together with the material.
 */
export function createFlipbookMesh(h: FlipbookHandle, opts: FlipbookMaterialOptions = {}, geometry?: THREE.BufferGeometry): THREE.Mesh {
  const mat = createFlipbookMaterial(h, opts);
  const geo = geometry ?? new THREE.PlaneGeometry(1, 1);
  const mesh = installPrepassGuard(new THREE.Mesh(geo, mat), 'skip');
  mesh.name = mat.name;
  mesh.userData.dispose = (): void => {
    mat.dispose();
    if (!geometry) geo.dispose();
  };
  return mesh;
}
