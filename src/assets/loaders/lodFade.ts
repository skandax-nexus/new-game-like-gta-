/**
 * Dithered LOD cross-fade for THREE.LOD objects (the hook agreed with GFX-01's materials/chunks).
 * OWNER: Technical Artist G (TA-07).
 *
 *   const inst = await ctx.assets.loadModel('stupa_sanchi', { crossFade: true });   // CrossFadeLOD + patched materials
 *   // or for any THREE.LOD built elsewhere:
 *   const lod = makeCrossFadeLod(existingLod, { band: 0.12 });
 *
 * Contract: around each switch distance D the two adjacent levels are both visible over [D - w/2, D + w/2]
 * (w = band x D). Each level's materials get `LOD_DITHER_GLSL`: the fragment computes the object distance
 * from cameraPosition and modelMatrix (per object, so instanced / shared materials still fade per object)
 * and discards with an ordered 4x4 Bayer pattern - the outgoing level keeps pixels where dither >= fade, the
 * incoming one where dither < fade - so every pixel is covered exactly once (no double blending, no holes).
 * GFX-01 may move the chunk into src/render/materials/chunks/ (keep the define SAMRAJYA_LOD_DITHER and the
 * uniform names); materials are cloned per level (textures shared) because the fade bands differ per level.
 */
import * as THREE from 'three';
import { cloneMaterial } from './vat';

/** Uniforms: x = fade-in start, y = fade-in end, z = fade-out start, w = fade-out end (meters; <0 = none). */
export const LOD_DITHER_GLSL = /* glsl */ `
#ifdef SAMRAJYA_LOD_DITHER
uniform vec4 lodFadeBand;
float samrajyaBayer4( vec2 p ) {
  ivec2 i = ivec2( mod( p, 4.0 ) );
  int idx = i.x + i.y * 4;
  float m[ 16 ] = float[ 16 ]( 0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0 );
  return ( m[ idx ] + 0.5 ) / 16.0;
}
void samrajyaLodDither() {
  float d = distance( cameraPosition, vec3( lodFadeCenter ) );
  float b = samrajyaBayer4( gl_FragCoord.xy );
  if ( lodFadeBand.y > lodFadeBand.x ) {
    float fin = clamp( ( d - lodFadeBand.x ) / ( lodFadeBand.y - lodFadeBand.x ), 0.0, 1.0 );
    if ( b >= fin ) discard;
  }
  if ( lodFadeBand.w > lodFadeBand.z ) {
    float fout = clamp( ( d - lodFadeBand.z ) / ( lodFadeBand.w - lodFadeBand.z ), 0.0, 1.0 );
    if ( b < fout ) discard;
  }
}
#endif
`;

const VERTEX_DECL = '#ifdef SAMRAJYA_LOD_DITHER\nvarying vec3 lodFadeCenter;\n#endif';
const VERTEX_BODY = '#ifdef SAMRAJYA_LOD_DITHER\nlodFadeCenter = ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;\n#endif';

/** Patch a material (chaining its onBeforeCompile) with the dither for one LOD level's fade band. */
export function installLodDither(mat: THREE.Material, band: THREE.Vector4): void {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey();
  const uniforms = { lodFadeBand: { value: band } };
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.defines = { ...(shader.defines ?? {}), SAMRAJYA_LOD_DITHER: '' };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_DECL}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n#ifdef SAMRAJYA_LOD_DITHER\nvarying vec3 lodFadeCenter;\n#endif\n${LOD_DITHER_GLSL}`)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n#ifdef SAMRAJYA_LOD_DITHER\nsamrajyaLodDither();\n#endif');
  };
  mat.customProgramCacheKey = () => `${prevKey}|lod-dither`;
  mat.userData.lodFadeBand = band;
}

export interface CrossFadeOptions {
  /** Transition width as a fraction of each switch distance (default 0.12). */
  band?: number;
}

/** THREE.LOD that keeps both adjacent levels visible inside the fade band (materials do the dithering). */
export class CrossFadeLOD extends THREE.LOD {
  band = 0.12;
  private readonly cam = new THREE.Vector3();
  private readonly me = new THREE.Vector3();

  override update(camera: THREE.Camera): void {
    const levels = this.levels;
    if (levels.length <= 1) return;
    this.cam.setFromMatrixPosition(camera.matrixWorld);
    this.me.setFromMatrixPosition(this.matrixWorld);
    const d = this.cam.distanceTo(this.me) / ((camera as THREE.PerspectiveCamera).zoom ?? 1);
    let current = 0;
    for (let i = 0; i < levels.length; i++) {
      const lo = i === 0 ? -Infinity : levels[i]!.distance * (1 - this.band * 0.5);
      const hi = i === levels.length - 1 ? Infinity : levels[i + 1]!.distance * (1 + this.band * 0.5);
      const visible = d >= lo && d < hi;
      levels[i]!.object.visible = visible;
      if (visible && d >= (i === 0 ? 0 : levels[i]!.distance)) current = i;
    }
    (this as unknown as { _currentLevel: number })._currentLevel = current;
  }
}

/**
 * Convert levels into a CrossFadeLOD with per-level dithered material clones. Returns the new LOD and a
 * dispose() for the cloned materials (textures stay owned by their source materials).
 */
export function makeCrossFadeLod(src: THREE.LOD, opts: CrossFadeOptions = {}): { lod: CrossFadeLOD; dispose: () => void } {
  const band = opts.band ?? 0.12;
  const out = new CrossFadeLOD();
  out.band = band;
  out.name = src.name;
  out.position.copy(src.position);
  out.quaternion.copy(src.quaternion);
  out.scale.copy(src.scale);
  const clones: THREE.Material[] = [];
  const levels = [...src.levels];
  levels.forEach((lv, i) => {
    const prevD = lv.distance;
    const nextD = levels[i + 1]?.distance;
    const v = new THREE.Vector4(
      i === 0 ? -1 : prevD * (1 - band * 0.5),
      i === 0 ? -2 : prevD * (1 + band * 0.5),
      nextD === undefined ? -1 : nextD * (1 - band * 0.5),
      nextD === undefined ? -2 : nextD * (1 + band * 0.5),
    );
    const cache = new Map<THREE.Material, THREE.Material>();
    lv.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const swap = (mat: THREE.Material): THREE.Material => {
        let c = cache.get(mat);
        if (!c) {
          c = cloneMaterial(mat);
          installLodDither(c, v);
          cache.set(mat, c);
          clones.push(c);
        }
        return c;
      };
      m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
    });
    out.addLevel(lv.object, lv.distance, lv.hysteresis);
  });
  return { lod: out, dispose: () => clones.forEach((m) => m.dispose()) };
}
