/**
 * PBR materials from baked texture sets (content pipeline). OWNER: Graphics Developer - Lighting, Atmosphere &
 * Post (GFX-01; baseline by the Technical Art Director). Used by src/assets/AssetManager.ts to bind runtime
 * textures to the texture-less proxy materials exported from Blender, and by feature code for tiling materials.
 *
 *   const mat = createPbrMaterial({ baseColor, normal, orm, macro }, { tint: '#f0e0d8', uvScale: [2, 1] });
 *
 * Texture conventions (tools/blender, glTF):
 *   baseColor  sRGB, RGB albedo                      -> map
 *   normal     linear, tangent space, OpenGL (+Y)    -> normalMap (flipY = false like glTF)
 *   orm        linear, R = AO, G = roughness, B = metalness -> roughnessMap + metalnessMap (+ detail AO)
 *   macro      linear, on uv1 (TEXCOORD_1): R = macro AO, G = albedo multiplier (grime, streaks)
 * Detail AO (orm.r on uv0) and macro AO (macro.r on uv1) are combined in the shader; both only affect
 * indirect light, like three's aoMap. All variants are distinguished with customProgramCacheKey.
 *
 * Global hooks (shared uniforms, driven by the weather/environment systems):
 *   MATERIAL_GLOBALS.wetness   0..1 rain wetness: darkens porous albedo, lowers roughness, more on
 *                              up-facing surfaces (monsoon look); puddles on flat porous ground (chunks/wetness.ts)
 *
 * GFX-01 surface features (src/render/materials/chunks/):
 *   clearcoat / sheen   MeshPhysicalMaterial from the option or the Art Director's MATERIAL_PRESETS entry whose
 *                       assetId matches the material name (Mauryan polish clearcoat 0.6/0.12, silk sheen 0.9 ...)
 *   subsurface          wrap + back transmission (skin, thin cloth); `foliage: true` reads leaf thickness from ORM.b
 *                       (ART_BIBLE §9: translucency 0.35, metalness forced to 0)
 *   ZoomLook            normal-map detail and macro fade with distance, band-scaled specular AA (samG MATERIAL_LOOK)
 *   quality             emissive / baked-AO boosts on low (global chunks, samG MATERIAL_BOOST)
 */
import * as THREE from 'three';
import { MATERIAL_PRESETS, type MaterialPreset } from '../style/materials';
import { WETNESS_GLSL } from './chunks/wetness';
import { DETAIL_FADE_GLSL, FOLIAGE_THICKNESS_GLSL, SPEC_AA_GLSL, SUBSURFACE_PARS_GLSL } from './chunks/surface';

export interface PbrTextures {
  baseColor?: THREE.Texture | null;
  normal?: THREE.Texture | null;
  orm?: THREE.Texture | null;
  macro?: THREE.Texture | null;
  emissive?: THREE.Texture | null;
}

export interface PbrMaterialOptions {
  /** Multiplies the base color map (or the fallback color when there is no map). sRGB hex/CSS. */
  tint?: THREE.ColorRepresentation;
  /** Base color used when no baseColor map is available (procedural fallback). */
  fallbackColor?: THREE.ColorRepresentation;
  /** Roughness when there is no ORM map, else a multiplier via roughnessScale. */
  roughness?: number;
  roughnessScale?: number;
  metalness?: number;
  normalScale?: number;
  /** Extra UV scale on uv0 maps (KHR_texture_transform-like). */
  uvScale?: readonly [number, number] | readonly number[];
  /** Strength of the ORM red channel (detail AO), 0..1. */
  detailAo?: number;
  /** Strength of the macro map (uv1) albedo multiplier and AO, 0..1. */
  macroStrength?: number;
  /** Geometry carries MikkTSpace tangents (glTF TANGENT). Without them three uses derivatives and
   *  glTF requires flipping the normal map Y (as GLTFLoader does). */
  vertexTangents?: boolean;
  /** How much rain wetness affects this material (0 = sealed/metal, 1 = porous stone/earth). */
  porosity?: number;
  envMapIntensity?: number;
  side?: THREE.Side;
  /** Use MeshPhysicalMaterial (clearcoat, sheen, transmission ... set afterwards). */
  physical?: boolean;
  name?: string;
  /** Clearcoat (polish, lacquer, glaze); null = none. Default: the MATERIAL_PRESETS entry for `name`. */
  clearcoat?: { strength: number; roughness: number } | null;
  /** Fabric sheen; null = none. Default: the MATERIAL_PRESETS entry for `name`. */
  sheen?: { color: THREE.ColorRepresentation; roughness: number; intensity: number } | null;
  /** Wrap + back-transmission lobe (skin, cloth, leaves); null = none. Default: the preset's `subsurface`. */
  subsurface?: { color: THREE.ColorRepresentation; strength: number } | null;
  /** Leaf atlas: ORM.b is translucency (leaf thickness), not metalness; subsurface defaults to 0.35 x leaf colour. */
  foliage?: boolean;
  /** Puddles on flat, up-facing parts when wet (default: porosity >= 0.5). */
  puddles?: boolean;
}

let presetByAsset: Map<string, MaterialPreset> | null = null;
/** The Art Director's preset for a material asset id (or preset id), if any. */
export function materialPresetFor(name: string | undefined): MaterialPreset | null {
  if (!name) return null;
  if (!presetByAsset) {
    presetByAsset = new Map();
    for (const p of Object.values(MATERIAL_PRESETS) as MaterialPreset[]) {
      if (p.assetId && !presetByAsset.has(p.assetId)) presetByAsset.set(p.assetId, p);
      if (!presetByAsset.has(p.id)) presetByAsset.set(p.id, p);
    }
  }
  return presetByAsset.get(name) ?? null;
}

/** Shared uniforms for global material effects (weather, debug). */
export const MATERIAL_GLOBALS = {
  wetness: { value: 0 },
};

/** Texture parameters every set texture must use (call once after loading). */
export function configureSetTexture(tex: THREE.Texture, map: keyof PbrTextures, anisotropy = 1): THREE.Texture {
  tex.flipY = false;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = map === 'baseColor' || map === 'emissive' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = Math.max(1, anisotropy);
  if (map === 'macro') tex.channel = 1;
  tex.needsUpdate = true;
  return tex;
}

function withUvScale(tex: THREE.Texture | null | undefined, uvScale: readonly number[] | undefined): THREE.Texture | null {
  if (!tex) return null;
  if (!uvScale || (uvScale[0] === 1 && uvScale[1] === 1)) return tex;
  // Clone shares the image source (one GPU upload) but has its own transform.
  const t = tex.clone();
  t.repeat.set(uvScale[0] ?? 1, uvScale[1] ?? 1);
  t.needsUpdate = true;
  return t;
}

/**
 * Build a MeshStandardMaterial (or MeshPhysicalMaterial) from a texture set. Missing maps fall back to
 * factors so the result is always renderable. The caller owns the material (dispose it); textures
 * belong to the cache that loaded them (cloned uv-scaled textures are disposed with the material).
 */
export function createPbrMaterial(textures: PbrTextures, opts: PbrMaterialOptions = {}): THREE.MeshStandardMaterial {
  const params: THREE.MeshStandardMaterialParameters = {
    name: opts.name ?? 'pbr',
    side: opts.side ?? THREE.FrontSide,
    envMapIntensity: opts.envMapIntensity ?? 1,
  };
  const preset = materialPresetFor(opts.name);
  const clearcoat = opts.clearcoat !== undefined ? opts.clearcoat : (preset?.clearcoat ?? null);
  const sheen = opts.sheen !== undefined ? opts.sheen : preset?.sheen ? { color: preset.sheen.color, roughness: preset.sheen.roughness, intensity: preset.sheen.intensity } : null;
  const foliage = opts.foliage === true;
  const subsurface =
    opts.subsurface !== undefined ? opts.subsurface : preset?.subsurface ? { color: preset.subsurface.color, strength: preset.subsurface.strength } : foliage ? { color: 0xffffff, strength: 0.35 } : null;
  const physical = opts.physical === true || !!clearcoat || !!sheen;
  const mat = physical ? new THREE.MeshPhysicalMaterial(params) : new THREE.MeshStandardMaterial(params);
  if (mat instanceof THREE.MeshPhysicalMaterial) {
    if (clearcoat) {
      mat.clearcoat = clearcoat.strength;
      mat.clearcoatRoughness = clearcoat.roughness;
    }
    if (sheen) {
      mat.sheen = sheen.intensity;
      mat.sheenRoughness = sheen.roughness;
      mat.sheenColor.set(sheen.color);
    }
  }
  const owned: THREE.Texture[] = [];
  const scaled = (t: THREE.Texture | null | undefined): THREE.Texture | null => {
    const s = withUvScale(t, opts.uvScale);
    if (s && s !== t) owned.push(s);
    return s;
  };
  const tint = new THREE.Color(opts.tint ?? 0xffffff);
  const map = scaled(textures.baseColor);
  if (map) {
    mat.map = map;
    mat.color.copy(tint);
  } else {
    mat.color.set(opts.fallbackColor ?? 0x808080).multiply(tint);
  }
  const orm = scaled(textures.orm);
  if (orm && foliage) {
    // Leaf atlas: B = translucency, so no metalness map.
    mat.roughnessMap = orm;
    mat.roughness = opts.roughnessScale ?? 1;
    mat.metalness = 0;
  } else if (orm) {
    mat.roughnessMap = orm;
    mat.metalnessMap = orm;
    mat.roughness = opts.roughnessScale ?? 1;
    mat.metalness = opts.metalness ?? 1; // metalnessMap (B) is authoritative
  } else {
    mat.roughness = opts.roughness ?? 0.8;
    mat.metalness = opts.metalness ?? 0;
  }
  const normal = scaled(textures.normal);
  if (normal) {
    mat.normalMap = normal;
    const s = opts.normalScale ?? 1;
    mat.normalScale.set(s, opts.vertexTangents === false ? -s : s);
  }
  if (textures.emissive) {
    mat.emissiveMap = scaled(textures.emissive);
    mat.emissive.set(0xffffff);
  }
  const detailAo = THREE.MathUtils.clamp(opts.detailAo ?? 1, 0, 1);
  const macro = textures.macro ?? null;
  const macroStrength = THREE.MathUtils.clamp(opts.macroStrength ?? 1, 0, 1);
  if (macro) {
    mat.aoMap = macro; // channel 1 (uv1), R = macro AO
    mat.aoMapIntensity = macroStrength;
  } else if (orm && detailAo > 0) {
    mat.aoMap = orm; // R = detail AO on uv0
    mat.aoMapIntensity = detailAo;
  }
  const useDetailWithMacro = !!(macro && orm && detailAo > 0);
  const porosity = THREE.MathUtils.clamp(opts.porosity ?? 0.8, 0, 1);
  const puddles = opts.puddles ?? porosity >= 0.5;
  const sss = subsurface ? new THREE.Color(subsurface.color) : null;
  const uniforms = {
    uDetailAo: { value: detailAo },
    uMacroAlbedo: { value: macroStrength },
    uPorosity: { value: porosity },
    uWetness: MATERIAL_GLOBALS.wetness,
    samSubsurfaceColor: { value: sss ?? new THREE.Color(1, 1, 1) },
    samSubsurface: { value: subsurface ? subsurface.strength : 0 },
  };
  mat.userData.samrajyaUniforms = uniforms;
  mat.userData.ownedTextures = owned;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    if (puddles) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSamWorldPos;')
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
{
  vec4 samWp = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    samWp = batchingMatrix * samWp;
  #endif
  #ifdef USE_INSTANCING
    samWp = instanceMatrix * samWp;
  #endif
  vSamWorldPos = ( modelMatrix * samWp ).xyz;
}`,
        );
    }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uDetailAo;
uniform float uMacroAlbedo;
uniform float uPorosity;
uniform float uWetness;
${puddles ? 'varying vec3 vSamWorldPos;' : ''}
${WETNESS_GLSL}
float samPuddle = 0.0;`,
      )
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${SUBSURFACE_PARS_GLSL}`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
#if defined( SAMRAJYA_MACRO ) && defined( USE_AOMAP )
  diffuseColor.rgb *= mix( 1.0, texture2D( aoMap, vAoMapUv ).g, uMacroAlbedo * ( 1.0 - clamp( samG[ SAM_G_MATERIAL_LOOK ].y, 0.0, 1.0 ) ) );
#endif`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
${FOLIAGE_THICKNESS_GLSL}
  // Rain wetness (chunks/wetness.ts): porous surfaces darken and turn glossy, more on up-facing surfaces.
  #ifndef FLAT_SHADED
    float samUp = samUpFacing( vNormal );
    float samUpCos = samUpDot( vNormal );
  #else
    float samUp = 1.0;
    float samUpCos = 1.0;
  #endif
  samApplyWetness( diffuseColor.rgb, roughnessFactor, samWetAmount( uWetness, uPorosity, samUp ) );
  #ifdef SAM_PUDDLES
    samPuddle = samPuddleMask( vSamWorldPos.xz, uWetness * uPorosity, samUpCos );
    samApplyPuddle( diffuseColor.rgb, roughnessFactor, samPuddle );
  #endif`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
${DETAIL_FADE_GLSL}
#ifdef SAM_PUDDLES
  normal = normalize( mix( normal, nonPerturbedNormal, samPuddle ) );
#endif`,
      )
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n${SPEC_AA_GLSL}`)
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
#if defined( SAMRAJYA_DETAIL_AO ) && defined( USE_ROUGHNESSMAP )
  {
    float samDetailAo = mix( 1.0, texture2D( roughnessMap, vRoughnessMapUv ).r, uDetailAo );
    reflectedLight.indirectDiffuse *= samDetailAo;
    #if defined( USE_CLEARCOAT )
      clearcoatSpecularIndirect *= samDetailAo;
    #endif
    #if defined( USE_ENVMAP ) && defined( STANDARD )
      reflectedLight.indirectSpecular *= computeSpecularOcclusion( saturate( dot( geometryNormal, geometryViewDir ) ), samDetailAo, material.roughness );
    #endif
  }
#endif`,
      );
    const defines: Record<string, string> = {};
    if (macro) defines.SAMRAJYA_MACRO = '';
    if (useDetailWithMacro) defines.SAMRAJYA_DETAIL_AO = '';
    if (puddles) defines.SAM_PUDDLES = '';
    if (subsurface) defines.SAM_SUBSURFACE = '';
    if (foliage) defines.SAM_FOLIAGE = '';
    shader.defines = { ...(shader.defines ?? {}), ...defines };
  };
  const key = `samrajya-pbr|${macro ? 'm' : ''}|${useDetailWithMacro ? 'd' : ''}|${puddles ? 'p' : ''}|${subsurface ? 's' : ''}|${foliage ? 'f' : ''}`;
  mat.customProgramCacheKey = () => key;
  mat.userData.samFeatures = { clearcoat: !!clearcoat, sheen: !!sheen, subsurface: !!subsurface, foliage, puddles };
  return mat;
}

/**
 * three.js built-in geometries use v-up UVs (flipY textures); content-pipeline textures follow glTF
 * (flipY = false, v down). Call this on Plane/Box/Cylinder/Sphere geometries before using set textures.
 */
export function toGltfUv(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv) return geometry;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  uv.needsUpdate = true;
  return geometry;
}

/** Dispose a material created by createPbrMaterial (and its cloned uv-scaled textures). */
export function disposePbrMaterial(mat: THREE.Material): void {
  const owned = mat.userData.ownedTextures as THREE.Texture[] | undefined;
  for (const t of owned ?? []) t.dispose();
  mat.dispose();
}
