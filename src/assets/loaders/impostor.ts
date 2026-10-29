/**
 * Hemi-octahedral impostors: view math (mirror of tools/blender/lib/impostor.py) and a reference lit
 * billboard material. OWNER: Technical Artist G (TA-07). Format: docs/adr/0003-crowd-impostor-fx-assets.md.
 *
 *   const imp = await ctx.assets.loadImpostor('tree_banyan_impostor');      // null when off / failed
 *   const mesh = createImpostorMesh(imp);                                   // camera-facing quad, 1 draw call
 *   mesh.position.copy(treePosition); scene.add(mesh);
 *   ... mesh.userData.dispose(); imp.release();
 *
 * The vertex shader picks the three atlas frames around the camera direction (barycentric weights on the
 * hemi-octahedral grid), reprojects the quad into each frame's plane, and the fragment shader blends albedo,
 * coverage and the object-space normal, so the impostor is lit by the same sun / IBL / fog as meshes and
 * casts a shadow (the shadow pass faces the billboard to the light). Vegetation (GFX-03) and crowds
 * (GFX-04) may instance it; the per-frame math below is the contract.
 * Override-material passes (GTAO / SSAO normal pre-pass) draw the same billboard with its coverage cut-out and
 * atlas normals (prepass tag 'replace', loaders/prepass.ts) - never the raw 1 x 1 m quad at the origin.
 */
import * as THREE from 'three';
import type { ImpostorAssetEntry } from '../types';
import { createPrepassNormalMaterial, installPrepassGuard } from './prepass';

/** Unit direction (three axes, object center -> camera) of hemi-octahedral grid coordinates (u, v) in [0, 1]. */
export function hemiOctaDecode(u: number, v: number): [number, number, number] {
  const px = u * 2 - 1;
  const py = v * 2 - 1;
  const x = (px + py) * 0.5;
  const z = (px - py) * 0.5;
  const y = Math.max(0, 1 - Math.abs(x) - Math.abs(z));
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/** Inverse of hemiOctaDecode for directions with y >= 0 (lower hemisphere clamps to the horizon). */
export function hemiOctaEncode(d: readonly number[]): [number, number] {
  const y = Math.max(0, d[1]!);
  const s = Math.abs(d[0]!) + y + Math.abs(d[2]!) || 1;
  const x = d[0]! / s;
  const z = d[2]! / s;
  return [(x + z) * 0.5 + 0.5, (x - z) * 0.5 + 0.5];
}

/** Capture-camera basis for view direction d: right = normalize(cross(-d, +Y)), up = cross(right, -d). */
export function frameBasis(d: readonly number[]): { right: [number, number, number]; up: [number, number, number] } {
  const fx = -d[0]!;
  const fy = -d[1]!;
  const fz = -d[2]!;
  const ref = Math.abs(fy) < 0.9999 ? [0, 1, 0] : [0, 0, -1];
  let rx = fy * ref[2]! - fz * ref[1]!;
  let ry = fz * ref[0]! - fx * ref[2]!;
  let rz = fx * ref[1]! - fy * ref[0]!;
  const l = Math.hypot(rx, ry, rz) || 1;
  rx /= l;
  ry /= l;
  rz /= l;
  return { right: [rx, ry, rz], up: [ry * fz - rz * fy, rz * fx - rx * fz, rx * fy - ry * fx] };
}

/** Atlas frame (col, row) nearest to a view direction - CPU helper (tests, far-LOD sorting). */
export function nearestFrame(d: readonly number[], grid: number): [number, number] {
  const [u, v] = hemiOctaEncode(d);
  return [Math.round(u * (grid - 1)), Math.round(v * (grid - 1))];
}

export interface ImpostorHandle {
  readonly entry: ImpostorAssetEntry;
  /** sRGB albedo + coverage alpha. */
  readonly albedo: THREE.Texture;
  /** Object-space normal (xyz * 0.5 + 0.5) + depth alpha. */
  readonly normal: THREE.Texture;
  /** Frame size in pixels for the loaded tier. */
  readonly framePx: number;
  release(): void;
}

// ------------------------------------------------------------------------------------- shader
const IMP_COMMON = /* glsl */ `
uniform vec3 impCenter;
uniform float impRadius;
uniform float impGrid;
vec3 impDecode( vec2 uv ) {
  vec2 p = uv * 2.0 - 1.0;
  float x = ( p.x + p.y ) * 0.5;
  float z = ( p.x - p.y ) * 0.5;
  return normalize( vec3( x, max( 0.0, 1.0 - abs( x ) - abs( z ) ), z ) );
}
vec2 impEncode( vec3 d ) {
  d.y = max( d.y, 0.0 );
  float s = abs( d.x ) + d.y + abs( d.z );
  float x = d.x / s;
  float z = d.z / s;
  return vec2( x + z, x - z ) * 0.5 + 0.5;
}
void impBasis( vec3 d, out vec3 right, out vec3 up ) {
  vec3 f = -d;
  vec3 ref = abs( f.y ) < 0.9999 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 0.0, 0.0, -1.0 );
  right = normalize( cross( f, ref ) );
  up = cross( right, f );
}
`;

const IMP_VERTEX_HEADER = /* glsl */ `
${IMP_COMMON}
varying vec2 vImpUv0;
varying vec2 vImpUv1;
varying vec2 vImpUv2;
varying vec3 vImpW;
varying vec3 vImpN0;
varying vec3 vImpN1;
varying vec3 vImpN2;
vec2 impFrameUv( vec2 cell, vec3 local ) {
  vec3 d = impDecode( cell / ( impGrid - 1.0 ) );
  vec3 r; vec3 u;
  impBasis( d, r, u );
  vec2 f = vec2( dot( local, r ), -dot( local, u ) ) / ( 2.0 * impRadius ) + 0.5;
  return ( cell + clamp( f, 0.0, 1.0 ) ) / impGrid;
}
`;

const IMP_VERTEX_BODY = /* glsl */ `
  mat3 impM = mat3( modelMatrix );
  vec3 impCw = ( modelMatrix * vec4( impCenter, 1.0 ) ).xyz;
  vec3 impV = normalize( inverse( impM ) * ( cameraPosition - impCw ) );
  vec3 impR; vec3 impU;
  impBasis( impV, impR, impU );
  vec3 impLocal = ( position.x * impR + position.y * impU ) * ( 2.0 * impRadius );
  vec3 transformed = impCenter + impLocal;
  vec2 impG = impEncode( impV ) * ( impGrid - 1.0 );
  vec2 impC = min( floor( impG ), vec2( impGrid - 2.0 ) );
  vec2 impF = impG - impC;
  vec2 c0; vec2 c1; vec2 c2;
  if ( impF.x + impF.y < 1.0 ) {
    c0 = impC; c1 = impC + vec2( 1.0, 0.0 ); c2 = impC + vec2( 0.0, 1.0 );
    vImpW = vec3( 1.0 - impF.x - impF.y, impF.x, impF.y );
  } else {
    c0 = impC + vec2( 1.0 ); c1 = impC + vec2( 0.0, 1.0 ); c2 = impC + vec2( 1.0, 0.0 );
    vImpW = vec3( impF.x + impF.y - 1.0, 1.0 - impF.x, 1.0 - impF.y );
  }
  vImpUv0 = impFrameUv( c0, impLocal );
  vImpUv1 = impFrameUv( c1, impLocal );
  vImpUv2 = impFrameUv( c2, impLocal );
  mat3 impNm = mat3( viewMatrix ) * impM;
  vImpN0 = impNm[ 0 ];
  vImpN1 = impNm[ 1 ];
  vImpN2 = impNm[ 2 ];
`;

const IMP_FRAGMENT_HEADER = /* glsl */ `
uniform sampler2D impAlbedo;
uniform sampler2D impNormal;
varying vec2 vImpUv0;
varying vec2 vImpUv1;
varying vec2 vImpUv2;
varying vec3 vImpW;
varying vec3 vImpN0;
varying vec3 vImpN1;
varying vec3 vImpN2;
`;

const IMP_ALBEDO = /* glsl */ `
  vec4 impA0 = texture2D( impAlbedo, vImpUv0 );
  vec4 impA1 = texture2D( impAlbedo, vImpUv1 );
  vec4 impA2 = texture2D( impAlbedo, vImpUv2 );
  vec3 impWa = vImpW * vec3( impA0.a, impA1.a, impA2.a );
  float impCov = impWa.x + impWa.y + impWa.z;
  vec3 impCol = ( impA0.rgb * impWa.x + impA1.rgb * impWa.y + impA2.rgb * impWa.z ) / max( impCov, 1e-4 );
  diffuseColor.rgb *= impCol;
  diffuseColor.a *= impCov;
`;

const IMP_NORMAL = /* glsl */ `
  {
    vec3 impWn = vImpW;
    vec3 impObjN = ( texture2D( impNormal, vImpUv0 ).xyz * 2.0 - 1.0 ) * impWn.x
                 + ( texture2D( impNormal, vImpUv1 ).xyz * 2.0 - 1.0 ) * impWn.y
                 + ( texture2D( impNormal, vImpUv2 ).xyz * 2.0 - 1.0 ) * impWn.z;
    normal = normalize( mat3( vImpN0, vImpN1, vImpN2 ) * normalize( impObjN ) );
  }
`;

// AO pre-pass only: per-pixel depth relief from normal.a (depth = 0.5 + dot(P - C, d) / (2 r), 1 = towards the
// camera) - the billboard fragment moves along the view axis so GTAO / SSAO see the object's shape.
const IMP_PREPASS_VERTEX_HEADER = /* glsl */ `
varying vec3 vImpViewPos;
varying float vImpScale;
`;
const IMP_PREPASS_VERTEX_BODY = /* glsl */ `
  vImpViewPos = mvPosition.xyz;
  vImpScale = length( modelMatrix[ 0 ].xyz );
`;
const IMP_PREPASS_FRAGMENT_HEADER = /* glsl */ `
uniform float impAlphaTest;
uniform float impRadius;
uniform mat4 projectionMatrix;
varying vec3 vImpViewPos;
varying float vImpScale;
`;
const IMP_PREPASS_DEPTH = /* glsl */ `
  {
    float impD = ( texture2D( impNormal, vImpUv0 ).a * impWa.x + texture2D( impNormal, vImpUv1 ).a * impWa.y
                 + texture2D( impNormal, vImpUv2 ).a * impWa.z ) / max( impCov, 1e-4 );
    vec3 impVp = vImpViewPos;
    impVp.z += ( impD - 0.5 ) * 2.0 * impRadius * vImpScale;
    vec4 impClip = projectionMatrix * vec4( impVp, 1.0 );
    gl_FragDepth = clamp( impClip.z / impClip.w * 0.5 + 0.5, 0.0, 1.0 );
  }
`;

function patch(shader: THREE.WebGLProgramParametersWithUniforms, uniforms: Record<string, THREE.IUniform>, depth: boolean): void {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${IMP_VERTEX_HEADER}`)
    .replace('#include <begin_vertex>', IMP_VERTEX_BODY);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${IMP_FRAGMENT_HEADER}`)
    .replace('#include <map_fragment>', `#include <map_fragment>\n${IMP_ALBEDO}`);
  if (!depth) shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', IMP_NORMAL);
}

export interface ImpostorMaterialOptions {
  /** Coverage threshold (alpha test). */
  alphaTest?: number;
  roughness?: number;
  envMapIntensity?: number;
}

function impUniforms(h: ImpostorHandle): Record<string, THREE.IUniform> {
  const e = h.entry;
  return {
    impAlbedo: { value: h.albedo },
    impNormal: { value: h.normal },
    impCenter: { value: new THREE.Vector3(e.center[0], e.center[1], e.center[2]) },
    impRadius: { value: e.radius },
    impGrid: { value: e.grid },
  };
}

export interface ImpostorMaterials {
  /** Lit billboard (MeshStandardMaterial + patch). */
  material: THREE.MeshStandardMaterial;
  /** Directional / spot shadow depth (customDepthMaterial). */
  depth: THREE.MeshDepthMaterial;
  /** Point-light shadow distance (customDistanceMaterial). */
  distance: THREE.MeshDistanceMaterial;
  /** AO pre-pass normal + depth (prepass 'replace'). */
  prepass: THREE.MeshNormalMaterial;
}

/** Lit impostor material (MeshStandardMaterial + patch) and its shadow / distance / AO-prepass variants. */
export function createImpostorMaterials(h: ImpostorHandle, opts: ImpostorMaterialOptions = {}): ImpostorMaterials {
  const uniforms = { ...impUniforms(h), impAlphaTest: { value: opts.alphaTest ?? 0.5 } };
  const material = new THREE.MeshStandardMaterial({
    name: `${h.entry.id}_impostor`,
    roughness: opts.roughness ?? 0.85,
    metalness: 0,
    alphaTest: opts.alphaTest ?? 0.5,
    side: THREE.DoubleSide,
    envMapIntensity: opts.envMapIntensity ?? 1,
  });
  material.onBeforeCompile = (shader) => patch(shader, uniforms, false);
  material.customProgramCacheKey = () => 'samrajya-impostor';
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaTest: opts.alphaTest ?? 0.5 });
  depth.onBeforeCompile = (shader) => patch(shader, uniforms, true);
  depth.customProgramCacheKey = () => 'samrajya-impostor-depth';
  const distance = new THREE.MeshDistanceMaterial({ alphaTest: opts.alphaTest ?? 0.5 });
  distance.onBeforeCompile = (shader) => patch(shader, uniforms, true);
  distance.customProgramCacheKey = () => 'samrajya-impostor-distance';
  const prepass = createPrepassNormalMaterial(
    `${h.entry.id}_impostor_prepass`,
    (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${IMP_VERTEX_HEADER}\n${IMP_PREPASS_VERTEX_HEADER}`)
        .replace('#include <begin_vertex>', IMP_VERTEX_BODY)
        .replace('#include <project_vertex>', `#include <project_vertex>\n${IMP_PREPASS_VERTEX_BODY}`);
      // MeshNormalMaterial has no map / alphatest chunks: blend the coverage, cut out, then the atlas normal, then
      // the per-pixel depth relief (normal.a) so the AO pass sees the canopy's shape, not a flat card.
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <packing>', `#include <packing>\n${IMP_FRAGMENT_HEADER}\n${IMP_PREPASS_FRAGMENT_HEADER}`)
        .replace('#include <normal_fragment_maps>', `${IMP_ALBEDO}\n  if ( diffuseColor.a < impAlphaTest ) discard;\n${IMP_NORMAL}\n${IMP_PREPASS_DEPTH}`);
    },
    'samrajya-impostor-prepass',
    { side: THREE.DoubleSide },
  );
  material.userData.impostorUniforms = uniforms;
  return { material, depth, distance, prepass };
}

/** A camera-facing impostor quad (geometry owned by the mesh; dispose geometry + materials when done). */
export function createImpostorMesh(h: ImpostorHandle, opts: ImpostorMaterialOptions = {}): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(1, 1);
  const r = h.entry.radius;
  const c = h.entry.center;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(c[0], c[1], c[2]), r * 1.5);
  const { material, depth, distance, prepass } = createImpostorMaterials(h, opts);
  const mesh = new THREE.Mesh(geo, material);
  mesh.customDepthMaterial = depth;
  mesh.customDistanceMaterial = distance;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = true;
  mesh.name = `${h.entry.id}_impostor`;
  installPrepassGuard(mesh, 'replace', { normal: prepass });
  mesh.userData.dispose = () => {
    geo.dispose();
    material.dispose();
    depth.dispose();
    distance.dispose();
    prepass.dispose();
  };
  return mesh;
}
