/**
 * Dithered LOD cross-fade chunks (ART_BIBLE §2 "no popping"). OWNER: Graphics Developer - Lighting, Atmosphere &
 * Post (GFX-01).
 *
 * Two flavours, one 4x4 Bayer pattern so mixed content fades consistently:
 *   1. Per object (THREE.LOD / CrossFadeLOD): TA-07's contract, re-exported unchanged - define
 *      `SAMRAJYA_LOD_DITHER`, uniforms `lodFadeBand` (fade-in / fade-out distance bands) and `lodFadeOrigin`
 *      (assets/loaders/lodFade.ts: installLodDither, makeCrossFadeLod).
 *   2. Per instance (InstancedMesh crowds, trees, impostor swaps; GFX-03 / GFX-04): an instanced float attribute
 *      `instanceLodFade` in [-1, 1]: +f = fading IN with coverage f, -f = fading OUT with coverage 1 - f, 1 = solid
 *      (write 1, not -0, for the outgoing level at f = 0). Two instances swapping LOD with the same f (one +f, one
 *      -f) cover every pixel exactly once:
 *
 *        const fade = createLodFadeAttribute(count);           // all 1 (solid)
 *        geometry.setAttribute('instanceLodFade', fade);
 *        installInstancedLodDither(material);                 // chains onBeforeCompile, cache-key aware
 *        fade.setX(i, +0.3); fade.setX(j, -0.3); fade.needsUpdate = true;   // per frame while swapping
 *
 * Shadows are not dithered (only the current level casts), as in TA-07's contract.
 */
import * as THREE from 'three';

export { LOD_DITHER_GLSL, installLodDither, makeCrossFadeLod } from '../../../assets/loaders/lodFade';

/** Ordered 4x4 Bayer threshold in (0, 1) (same matrix as TA-07's samrajyaBayer4). */
export const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

export const BAYER4_GLSL = /* glsl */ `
#ifndef SAM_BAYER4
#define SAM_BAYER4
float samBayer4( vec2 p ) {
  ivec2 i = ivec2( mod( p, 4.0 ) );
  int idx = i.x + i.y * 4;
  float m[ 16 ] = float[ 16 ]( 0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0 );
  return ( m[ idx ] + 0.5 ) / 16.0;
}
#endif
`;

/** Does a fragment survive the instanced fade? (CPU mirror of the GLSL, tests.) */
export function lodFadeKeeps(fade: number, bayer: number): boolean {
  if (fade >= 1) return true;
  return fade >= 0 ? bayer < fade : bayer >= -fade;
}

export const LOD_FADE_INSTANCED_VERTEX_PARS = /* glsl */ `
#ifdef SAM_LOD_FADE_INSTANCED
attribute float instanceLodFade;
varying float vSamLodFade;
#endif
`;

export const LOD_FADE_INSTANCED_VERTEX = /* glsl */ `
#ifdef SAM_LOD_FADE_INSTANCED
vSamLodFade = instanceLodFade;
#endif
`;

export const LOD_FADE_INSTANCED_FRAGMENT_PARS = /* glsl */ `
#ifdef SAM_LOD_FADE_INSTANCED
varying float vSamLodFade;
${BAYER4_GLSL}
#endif
`;

export const LOD_FADE_INSTANCED_FRAGMENT = /* glsl */ `
#ifdef SAM_LOD_FADE_INSTANCED
if ( vSamLodFade < 0.999 ) {
  float samB = samBayer4( gl_FragCoord.xy );
  if ( vSamLodFade >= 0.0 ? samB >= vSamLodFade : samB < -vSamLodFade ) discard;
}
#endif
`;

/** An InstancedBufferAttribute of fades, all 1 (solid). */
export function createLodFadeAttribute(count: number): THREE.InstancedBufferAttribute {
  const a = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, count)).fill(1), 1);
  a.setUsage(THREE.DynamicDrawUsage);
  return a;
}

/**
 * Add the per-instance dither to a material built on three's chunks (chains any existing onBeforeCompile; the
 * geometry must carry `instanceLodFade`). Idempotent.
 */
export function installInstancedLodDither(mat: THREE.Material): void {
  if (mat.userData.samLodFadeInstanced) return;
  mat.userData.samLodFadeInstanced = true;
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.defines = { ...(shader.defines ?? {}), SAM_LOD_FADE_INSTANCED: '' };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${LOD_FADE_INSTANCED_VERTEX_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${LOD_FADE_INSTANCED_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${LOD_FADE_INSTANCED_FRAGMENT_PARS}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${LOD_FADE_INSTANCED_FRAGMENT}`);
  };
  mat.customProgramCacheKey = () => `${prevKey()}|samLodFadeI`;
  mat.needsUpdate = true;
}
