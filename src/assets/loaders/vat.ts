/**
 * Vertex animation textures (VAT) - decoding, textures and a reference crowd material / InstancedMesh.
 * OWNER: Technical Artist G (TA-07). Format: docs/adr/0003-crowd-impostor-fx-assets.md, ARCHITECTURE §20.
 *
 *   const vat = await ctx.assets.loadVat('crowd_spearmen');          // null when assets are off / failed
 *   const lod = vat.lods[0];
 *   const mat = createVatMaterial(lod, { partColors });               // MeshStandardMaterial + VAT patch
 *   const crowd = createVatInstancedMesh(lod, 500, mat);              // InstancedMesh + depth material
 *   setVatInstance(crowd, i, vat.clip('walk')!, phaseSeconds, rate, teamColor);
 *   mat.userData.vatTime.value = timeSeconds;                         // every frame (shared by both LODs)
 *   ... crowd.dispose(); mat.dispose(); vat.release();
 *
 * The GPU crowd renderer (GFX-04) may replace the reference material, but must keep this sampling:
 *   frame f of clip c: row = (c.startFrame + f) * rowsPerFrame + vertex / width, column = vertex % width,
 *   position = rest position + texelFetch(vatPos).xyz (RGBA16F offsets), normal = octDecode(texelFetch(vatNrm).xy),
 *   loops wrap f -> 0 after c.frames - 1, one-shots clamp; frames are interpolated linearly.
 */
import * as THREE from 'three';
import type { VatAssetEntry, VatClipEntry, VatLodEntry } from '../types';
import { gunzip, unshuffle16 } from './decode';

/** Half float 1.0. */
const HALF_ONE = 0x3c00;

export interface VatDecoded {
  /** RGBA half floats (A = 1) - rest-relative offsets, three axes, meters. */
  readonly positions: Uint16Array;
  /** RG octahedral normals. */
  readonly normals: Uint8Array;
}

/** Decode a published `.vat` payload (gzip of byte-shuffled RGB16F planes, then RG8 normals). */
export async function decodeVat(bytes: Uint8Array, lod: Pick<VatLodEntry, 'vat'>): Promise<VatDecoded> {
  const { width, height } = lod.vat;
  const texels = width * height;
  const raw = await gunzip(bytes);
  const posBytes = texels * 6;
  if (raw.byteLength !== posBytes + texels * 2) throw new Error(`VAT payload is ${raw.byteLength} bytes, expected ${posBytes + texels * 2}`);
  const rgb = unshuffle16(raw.subarray(0, posBytes), texels * 3);
  const positions = new Uint16Array(texels * 4);
  for (let i = 0; i < texels; i++) {
    positions[i * 4] = rgb[i * 3]!;
    positions[i * 4 + 1] = rgb[i * 3 + 1]!;
    positions[i * 4 + 2] = rgb[i * 3 + 2]!;
    positions[i * 4 + 3] = HALF_ONE;
  }
  return { positions, normals: raw.slice(posBytes, posBytes + texels * 2) };
}

/** Octahedral decode (mirror of tools/blender/lib/vat.py octa_decode); e in [0, 1]^2. */
export function octDecode(ex: number, ey: number): [number, number, number] {
  const px = ex * 2 - 1;
  const py = ey * 2 - 1;
  let z = 1 - Math.abs(px) - Math.abs(py);
  const t = Math.max(-z, 0);
  const x = px + (px >= 0 ? -t : t);
  const y = py + (py >= 0 ? -t : t);
  const l = Math.hypot(x, y, z) || 1;
  z /= l;
  return [x / l, y / l, z];
}

export function createVatTextures(d: VatDecoded, lod: Pick<VatLodEntry, 'vat'>): { positions: THREE.DataTexture; normals: THREE.DataTexture } {
  const { width, height } = lod.vat;
  const positions = new THREE.DataTexture(d.positions, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  const normals = new THREE.DataTexture(d.normals, width, height, THREE.RGFormat, THREE.UnsignedByteType);
  for (const t of [positions, normals]) {
    t.minFilter = THREE.NearestFilter;
    t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.flipY = false;
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
  }
  normals.unpackAlignment = 1;
  positions.name = 'vat_positions';
  normals.name = 'vat_normals';
  return { positions, normals };
}

/** One loaded VAT LOD: rest-pose geometry (vertex i == VAT column i), its bound material, the two textures. */
export interface VatLodData {
  readonly lod: number;
  readonly entry: VatLodEntry;
  /** Rest pose; `vatColor` aliases COLOR_0 (R team, G cloth seed, B part id / 255); bounds = animated bounds. */
  readonly geometry: THREE.BufferGeometry;
  /** Runtime-bound PBR material of the GLB proxy (shared, cached): clone it through createVatMaterial. */
  readonly material: THREE.MeshStandardMaterial;
  readonly positions: THREE.DataTexture;
  readonly normals: THREE.DataTexture;
}

export interface VatHandle {
  readonly entry: VatAssetEntry;
  readonly lods: readonly VatLodData[];
  clip(name: string): VatClipEntry | null;
  release(): void;
}

// ------------------------------------------------------------------------------------- shader patch
const VAT_HEADER = /* glsl */ `
uniform highp sampler2D vatPos;
uniform highp sampler2D vatNrm;
uniform vec2 vatLayout;
uniform float vatTime;
attribute vec4 vatClip;
attribute vec2 vatPlay;
attribute vec4 vatColor;
#ifdef VAT_INSTANCED_TEAM
attribute vec3 vatTeam;
varying vec3 vVatTeam;
#endif
varying vec4 vVatColor;
varying float vVatSeed;
vec3 vatOctDecode( vec2 e ) {
  vec2 p = e * 2.0 - 1.0;
  vec3 n = vec3( p.x, p.y, 1.0 - abs( p.x ) - abs( p.y ) );
  float t = max( -n.z, 0.0 );
  n.x += n.x >= 0.0 ? -t : t;
  n.y += n.y >= 0.0 ? -t : t;
  return normalize( n );
}
void vatSample( out vec3 offset, out vec3 nrm ) {
  float frames = max( vatClip.y, 1.0 );
  float t = ( vatTime * vatPlay.y + vatPlay.x ) * vatClip.z;
  bool loopClip = vatClip.w > 0.5;
  float f = loopClip ? mod( t, frames ) : clamp( t, 0.0, frames - 1.0 );
  float f0 = floor( f );
  float a = f - f0;
  float f1 = loopClip ? mod( f0 + 1.0, frames ) : min( f0 + 1.0, frames - 1.0 );
  int w = int( vatLayout.x );
  int rpf = int( vatLayout.y );
  int vid = gl_VertexID;
  int col = vid - ( vid / w ) * w;
  int sub = vid / w;
  ivec2 c0 = ivec2( col, ( int( vatClip.x + f0 ) ) * rpf + sub );
  ivec2 c1 = ivec2( col, ( int( vatClip.x + f1 ) ) * rpf + sub );
  offset = mix( texelFetch( vatPos, c0, 0 ).xyz, texelFetch( vatPos, c1, 0 ).xyz, a );
  nrm = normalize( mix( vatOctDecode( texelFetch( vatNrm, c0, 0 ).xy ), vatOctDecode( texelFetch( vatNrm, c1, 0 ).xy ), a ) );
}
`;

const VAT_FRAGMENT_HEADER = /* glsl */ `
varying vec4 vVatColor;
varying float vVatSeed;
#ifdef VAT_INSTANCED_TEAM
varying vec3 vVatTeam;
#endif
#ifdef VAT_PART_COLORS
uniform vec3 vatParts[ 8 ];
#endif
uniform vec3 vatTeamColor;
uniform float vatClothVariation;
float vatHash( float n ) { return fract( sin( n ) * 43758.5453123 ); }
`;

const VAT_FRAGMENT = /* glsl */ `
{
  #ifdef VAT_PART_COLORS
    int vatPart = int( floor( vVatColor.b * 255.0 + 0.5 ) );
    diffuseColor.rgb *= vatParts[ clamp( vatPart, 0, 7 ) ];
  #endif
  #ifdef VAT_INSTANCED_TEAM
    vec3 vatTeam = vVatTeam;
  #else
    vec3 vatTeam = vatTeamColor;
  #endif
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vatTeam, clamp( vVatColor.r, 0.0, 1.0 ) );
  float vatVar = vatHash( vVatSeed * 17.0 + floor( vVatColor.g * 255.0 + 0.5 ) );
  diffuseColor.rgb *= 1.0 + vatClothVariation * ( vatVar - 0.5 ) * step( 0.004, vVatColor.g );
}
`;

export interface VatMaterialOptions {
  /** Linear colors per part id (B channel); multiplies the base color (texture-less crowds use the base white). */
  partColors?: readonly THREE.ColorRepresentation[];
  /** Team color for the R mask when instances do not carry `vatTeam` (single-team crowds). */
  teamColor?: THREE.ColorRepresentation;
  /** Per-instance team colors from the `vatTeam` instanced attribute (default true). */
  instancedTeam?: boolean;
  /** Brightness variation of cloth (G seed) per instance, 0..0.3. */
  clothVariation?: number;
  /** Shared time uniform (seconds); default a fresh {value: 0} in material.userData.vatTime. */
  time?: { value: number };
}

interface VatUniforms {
  vatPos: { value: THREE.Texture };
  vatNrm: { value: THREE.Texture };
  vatLayout: { value: THREE.Vector2 };
  vatTime: { value: number };
}

function vatUniforms(lod: VatLodData, time: { value: number }): VatUniforms {
  return {
    vatPos: { value: lod.positions },
    vatNrm: { value: lod.normals },
    vatLayout: { value: new THREE.Vector2(lod.entry.vat.width, lod.entry.vat.rowsPerFrame) },
    vatTime: time,
  };
}

function patchVertex(src: string, normals: boolean): string {
  let s = src.replace('#include <common>', `#include <common>\n${VAT_HEADER}`);
  if (normals)
    s = s.replace(
      '#include <beginnormal_vertex>',
      'vec3 vatO0; vec3 vatN0; vatSample( vatO0, vatN0 );\nvec3 objectNormal = vatN0;\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3( tangent.xyz );\n#endif',
    );
  return s.replace(
    '#include <begin_vertex>',
    `vec3 vatO; vec3 vatN; vatSample( vatO, vatN );
vec3 transformed = vec3( position ) + vatO;
#ifdef USE_ALPHAHASH
  vPosition = vec3( position );
#endif
vVatColor = vatColor;
vVatSeed = float( gl_InstanceID ) + 0.37;
#ifdef VAT_INSTANCED_TEAM
  vVatTeam = vatTeam;
#endif`,
  );
}

/**
 * Clone a material without deep-copying userData (pbr materials keep textures and handles there, which
 * Material.copy would JSON-serialize); the clone shares textures with the source.
 */
export function cloneMaterial<T extends THREE.Material>(src: T): T {
  const ud = src.userData;
  src.userData = {};
  try {
    const m = src.clone() as T;
    m.userData = { ...ud };
    // Material.copy does not carry shader patches: keep the source's (pbr wetness / macro / detail AO).
    m.onBeforeCompile = src.onBeforeCompile;
    m.customProgramCacheKey = src.customProgramCacheKey;
    return m;
  } finally {
    src.userData = ud;
  }
}

/**
 * Clone `lod.material` (or `base`) with the VAT vertex patch, team tint (R mask), cloth variation (G seed) and
 * an optional part palette (B id). Chains any existing onBeforeCompile (e.g. render/materials/pbr.ts).
 */
export function createVatMaterial(lod: VatLodData, opts: VatMaterialOptions = {}, base?: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const src = base ?? lod.material;
  const mat = cloneMaterial(src);
  const prev = src.onBeforeCompile;
  const prevKey = src.customProgramCacheKey();
  const time = opts.time ?? { value: 0 };
  const uniforms = {
    ...vatUniforms(lod, time),
    vatTeamColor: { value: new THREE.Color(opts.teamColor ?? 0xffffff) },
    vatClothVariation: { value: opts.clothVariation ?? 0.16 },
    vatParts: { value: Array.from({ length: 8 }, (_, i) => new THREE.Color(opts.partColors?.[i] ?? 0xffffff)) },
  };
  const instancedTeam = opts.instancedTeam !== false;
  const parts = !!opts.partColors?.length;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(src, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.defines = { ...(shader.defines ?? {}), ...(instancedTeam ? { VAT_INSTANCED_TEAM: '' } : {}), ...(parts ? { VAT_PART_COLORS: '' } : {}) };
    shader.vertexShader = patchVertex(shader.vertexShader, true);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${VAT_FRAGMENT_HEADER}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${VAT_FRAGMENT}`);
  };
  mat.customProgramCacheKey = () => `${prevKey}|vat|${instancedTeam ? 't' : ''}${parts ? 'p' : ''}`;
  mat.userData = { ...mat.userData, vatTime: time, vatUniforms: uniforms };
  mat.name = `${src.name}_vat`;
  return mat;
}

/** Shadow depth material running the same VAT vertex code (assign to mesh.customDepthMaterial). */
export function createVatDepthMaterial(lod: VatLodData, time: { value: number }): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  const uniforms = vatUniforms(lod, time);
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = patchVertex(shader.vertexShader, false);
    // The header declares varyings the depth fragment never reads: harmless.
  };
  mat.customProgramCacheKey = () => 'vat-depth';
  mat.name = 'vat_depth';
  return mat;
}

/**
 * Reference crowd: one InstancedMesh per LOD (1 draw call + 1 shadow draw), instanced attributes
 * vatClip (startFrame, frames, fps, loop), vatPlay (phase s, rate) and vatTeam (linear rgb).
 */
export function createVatInstancedMesh(lod: VatLodData, count: number, material: THREE.Material, depth?: THREE.Material): THREE.InstancedMesh {
  const geo = lod.geometry.clone();
  geo.setAttribute('vatClip', new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4));
  geo.setAttribute('vatPlay', new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2));
  geo.setAttribute('vatTeam', new THREE.InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3));
  const mesh = new THREE.InstancedMesh(geo, material, count);
  if (depth) mesh.customDepthMaterial = depth;
  mesh.name = `vat_lod${lod.lod}`;
  return mesh;
}

/** Point instance `i` at a clip (phase offset in seconds, playback rate) and team color. */
export function setVatInstance(mesh: THREE.InstancedMesh, i: number, clip: VatClipEntry, phase = 0, rate = 1, team?: THREE.Color): void {
  const c = mesh.geometry.getAttribute('vatClip') as THREE.InstancedBufferAttribute;
  const p = mesh.geometry.getAttribute('vatPlay') as THREE.InstancedBufferAttribute;
  c.setXYZW(i, clip.startFrame, clip.frames, clip.fps, clip.loop ? 1 : 0);
  p.setXY(i, phase, rate);
  c.needsUpdate = true;
  p.needsUpdate = true;
  if (team) {
    const t = mesh.geometry.getAttribute('vatTeam') as THREE.InstancedBufferAttribute;
    t.setXYZ(i, team.r, team.g, team.b);
    t.needsUpdate = true;
  }
}

/** Animated-bounds sphere for a VAT geometry (instanced culling must enclose every frame). */
export function applyVatBounds(geo: THREE.BufferGeometry, entry: VatAssetEntry): void {
  const b = entry.bounds;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(b.center[0], b.center[1], b.center[2]), b.radius);
  geo.boundingBox = new THREE.Box3(new THREE.Vector3(b.min[0], b.min[1], b.min[2]), new THREE.Vector3(b.max[0], b.max[1], b.max[2]));
}
