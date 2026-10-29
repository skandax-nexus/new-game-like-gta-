/**
 * Material helpers for content-pipeline assets. OWNER: Technical Art Director (with the Lead Graphics
 * Engineer). See pbr.ts (baked texture sets -> MeshStandard/Physical) and splat.ts (terrain layers).
 */
export { MATERIAL_GLOBALS, configureSetTexture, createPbrMaterial, disposePbrMaterial, toGltfUv } from './pbr';
export type { PbrMaterialOptions, PbrTextures } from './pbr';
export { createSplatMaterial } from './splat';
export type { SplatLayer, SplatOptions } from './splat';
