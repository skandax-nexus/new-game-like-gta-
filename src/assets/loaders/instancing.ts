/**
 * Kit layout helper: turn a loaded model (one LOD level) into InstancedMeshes - one per (geometry, material)
 * pair - so N copies cost one draw call per primitive. Used by the asset viewer `?kit=` mode (TA-02 / TA-03
 * draw-call checks) and as a reference for settlement instancing (GFX-06). OWNER: Technical Artist G (TA-07).
 */
import * as THREE from 'three';

export interface InstancedKit {
  readonly group: THREE.Group;
  /** InstancedMeshes created (= draw calls per pass). */
  readonly meshes: readonly THREE.InstancedMesh[];
  dispose(): void;
}

/**
 * Instance every mesh under `source` (world transforms baked relative to `source`) at the given matrices.
 * Geometry / materials stay owned by the source (shared); dispose() only frees the InstancedMeshes.
 */
export function instanceObject(source: THREE.Object3D, matrices: readonly THREE.Matrix4[]): InstancedKit {
  const group = new THREE.Group();
  const meshes: THREE.InstancedMesh[] = [];
  source.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(source.matrixWorld).invert();
  const local = new THREE.Matrix4();
  const m = new THREE.Matrix4();
  source.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return;
    local.multiplyMatrices(inv, mesh.matrixWorld);
    const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, matrices.length);
    matrices.forEach((mat, i) => im.setMatrixAt(i, m.multiplyMatrices(mat, local)));
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = mesh.castShadow;
    im.receiveShadow = mesh.receiveShadow;
    im.name = `${mesh.name}_x${matrices.length}`;
    im.computeBoundingSphere();
    group.add(im);
    meshes.push(im);
  });
  return {
    group,
    meshes,
    dispose: () => {
      group.removeFromParent();
      for (const im of meshes) im.dispose();
    },
  };
}
