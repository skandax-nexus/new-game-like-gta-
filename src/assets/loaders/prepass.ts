/**
 * Override-material pass contract ("prepass tag") for TA-07's runtime helpers. OWNER: Technical Artist G (TA-07).
 * Contract: docs/adr/0003-crowd-impostor-fx-assets.md, "Override-material passes".
 *
 * Problem: passes that render the scene with `scene.overrideMaterial` (three r170 GTAOPass / SSAOPass normal +
 * depth pre-pass, used by src/render/post.ts at high / ultra) draw EVERY mesh with one MeshNormalMaterial and only
 * hide Points and Lines. That material knows nothing about vertex shader patches or blending:
 *   - VAT crowds render in their REST pose (the VAT vertex patch is not applied) -> AO of a T-posed ghost crowd;
 *   - impostors render their raw 1 x 1 m PlaneGeometry at the object origin -> a dark AO square;
 *   - flipbook particle quads (transparent, depthWrite false) render as opaque cards -> every quad shows as a
 *     rectangle with a dark AO halo.
 *
 * Contract: an object carries `userData.samrajyaPrepass` (and/or its material does):
 *   'skip'     never drawn in an override-material pass (transparent particles: they own no depth / normal).
 *   'replace'  drawn with `userData.samrajyaPrepassMaterials.normal` instead when the override is a
 *              MeshNormalMaterial (the AO pre-passes) - a normal material running the same vertex patch (VAT pose,
 *              impostor billboard + coverage cut-out); skipped for any other override.
 * Enforcement is self-contained: installPrepassGuard() hooks onBeforeRender / onAfterRender, so the tag is honoured
 * by the stock GTAOPass / SSAOPass today, without changes to post.ts. While the override is active the guard draws
 * the replacement itself (renderer.renderBufferDirect) and suppresses the override draw (drawRange.count = -1 makes
 * three return before any GL call; restored in onAfterRender). Shadow passes use customDepthMaterial and never
 * call onBeforeRender, so they are unaffected. Callers that also need onBeforeRender must CHAIN the existing
 * handler, never replace it. Post passes may additionally hide tagged objects up front (cheaper): see
 * prepassModeOf() and the Lead Graphics change request in ADR 0003.
 */
import * as THREE from 'three';

/** userData key of the prepass mode (object or material). */
export const PREPASS_TAG = 'samrajyaPrepass';
/** userData key of the replacement materials ({ normal }) for mode 'replace'. */
export const PREPASS_MATERIALS = 'samrajyaPrepassMaterials';

export type PrepassMode = 'skip' | 'replace';

export interface PrepassMaterials {
  /** View-space normal output (packNormalToRGB, like MeshNormalMaterial) with the object's vertex patch. */
  readonly normal: THREE.Material;
}

/** Prepass mode of an object (its own tag first, then its material's), or null for ordinary meshes. */
export function prepassModeOf(object: THREE.Object3D): PrepassMode | null {
  const own = object.userData[PREPASS_TAG] as unknown;
  if (own === 'skip' || own === 'replace') return own;
  const mat = (object as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
  const m = Array.isArray(mat) ? mat[0] : mat;
  const tag = m?.userData?.[PREPASS_TAG] as unknown;
  return tag === 'skip' || tag === 'replace' ? tag : null;
}

/** Replacement materials of a 'replace' object, or null. */
export function prepassMaterialsOf(object: THREE.Object3D): PrepassMaterials | null {
  return (object.userData[PREPASS_MATERIALS] as PrepassMaterials | undefined) ?? null;
}

/**
 * Tag `mesh` and enforce the tag in every override-material pass (see the file header). Chains existing
 * onBeforeRender / onAfterRender handlers. Returns the mesh.
 */
export function installPrepassGuard<T extends THREE.Mesh>(mesh: T, mode: PrepassMode, materials?: PrepassMaterials): T {
  mesh.userData[PREPASS_TAG] = mode;
  if (materials) mesh.userData[PREPASS_MATERIALS] = materials;
  if (mesh.userData.samrajyaPrepassGuard) return mesh;
  mesh.userData.samrajyaPrepassGuard = true;
  const prevBefore = mesh.onBeforeRender;
  const prevAfter = mesh.onAfterRender;
  let suppressed: THREE.BufferGeometry | null = null;
  let savedCount = 0;
  mesh.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
    prevBefore.call(this, renderer, scene, camera, geometry, material, group);
    const override = (scene as THREE.Scene).overrideMaterial;
    if (!override || material !== override) return;
    const m = this.userData[PREPASS_TAG] as PrepassMode;
    const repl = (this.userData[PREPASS_MATERIALS] as PrepassMaterials | undefined)?.normal;
    if (m === 'replace' && repl && (override as THREE.MeshNormalMaterial).isMeshNormalMaterial) {
      // renderObject() updates these after onBeforeRender: compute them for our draw.
      this.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, this.matrixWorld);
      this.normalMatrix.getNormalMatrix(this.modelViewMatrix);
      renderer.renderBufferDirect(camera, scene, geometry, repl, this, group);
    }
    suppressed = geometry;
    savedCount = geometry.drawRange.count;
    geometry.drawRange.count = -1; // drawCount < 0: renderBufferDirect returns before any GL call
  };
  mesh.onAfterRender = function (renderer, scene, camera, geometry, material, group) {
    if (suppressed) {
      suppressed.drawRange.count = savedCount;
      suppressed = null;
    }
    prevAfter.call(this, renderer, scene, camera, geometry, material, group);
  };
  return mesh;
}

/**
 * MeshNormalMaterial for the 'replace' prepass whose vertex / fragment shaders get the same patch as the object's
 * main material (`patch` mutates the shader like onBeforeCompile). NoBlending, like the AO passes' own material.
 */
export function createPrepassNormalMaterial(
  name: string,
  patch: (shader: THREE.WebGLProgramParametersWithUniforms) => void,
  cacheKey: string,
  opts: { side?: THREE.Side } = {},
): THREE.MeshNormalMaterial {
  const mat = new THREE.MeshNormalMaterial({ side: opts.side ?? THREE.FrontSide });
  mat.blending = THREE.NoBlending;
  mat.name = name;
  mat.onBeforeCompile = patch;
  mat.customProgramCacheKey = () => cacheKey;
  return mat;
}
