/**
 * Material helpers for content-pipeline assets. OWNER: Graphics Developer - Lighting, Atmosphere & Post (GFX-01;
 * baseline by the Technical Art Director). See pbr.ts (baked texture sets -> MeshStandard/Physical), splat.ts
 * (terrain layers) and chunks/ (shared shader globals, wetness, surface lobes, LOD dither).
 */
export { MATERIAL_GLOBALS, configureSetTexture, createPbrMaterial, disposePbrMaterial, materialPresetFor, toGltfUv } from './pbr';
export type { PbrMaterialOptions, PbrTextures } from './pbr';
export { createSplatMaterial } from './splat';
export type { SplatLayer, SplatOptions } from './splat';
export { WETNESS, WETNESS_GLSL, wetSurface } from './chunks/wetness';
export { DETAIL_FADE_GLSL, SPEC_AA_GLSL, SUBSURFACE_PARS_GLSL, FOLIAGE_THICKNESS_GLSL, SAM_G_FRAGMENT_DECL } from './chunks/surface';
export { BAYER4, BAYER4_GLSL, createLodFadeAttribute, installInstancedLodDither, lodFadeKeeps, LOD_DITHER_GLSL, installLodDither, makeCrossFadeLod } from './chunks/lodDither';
export { G, g, SAM_GLOBALS, SAM_G_DECL, injectShaderGlobals, installShaderGlobals } from './chunks/globals';
