/**
 * Procedural fallbacks for content-pipeline models: what the game shows when an asset is unavailable
 * (tier 'off', the single-file build, a failed download). OWNER: CTO + Technical Art Director.
 * Register a fallback for every model the game depends on; the default is a bounds-sized block.
 */
import * as THREE from 'three';
import type { AssetManager } from './AssetManager';
import { buildArchitectureGeometry } from '../render/architecture/buildings';

/** Vertex-colored procedural architecture (render/architecture) as a fallback object. */
function architecture(kind: Parameters<typeof buildArchitectureGeometry>[0]): () => THREE.Object3D {
  return () => {
    const geo = buildArchitectureGeometry(kind, 'city_sandstone');
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.02 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const g = new THREE.Group();
    g.add(mesh);
    // The fallback owns its resources: dispose them when the instance is released.
    g.userData.dispose = () => {
      geo.dispose();
      mat.dispose();
    };
    return g;
  };
}

export function registerDefaultFallbacks(assets: AssetManager): void {
  assets.registerModelFallback('stupa_sanchi', architecture('stupa'));
}
