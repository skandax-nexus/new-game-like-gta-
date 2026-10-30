/**
 * Shared surface chunks for every lit material (ART_BIBLE §8 / §13). OWNER: Graphics Developer - Lighting,
 * Atmosphere & Post (GFX-01).
 *
 * Global (installed with the shader globals, apply to MeshStandard / Physical / Lambert / Phong / Toon and to
 * ShaderMaterials built on three's chunks):
 *   - `samG` is declared once at global scope in every fragment shader (`common` chunk), so chunks used inside
 *     main() can read it safely;
 *   - emissive x (1 + samG MATERIAL_BOOST.x): QualitySettings.emissiveBoost (low 1.3 compensates for no bloom);
 *   - aoMap strength x (1 + samG MATERIAL_BOOST.y): QualitySettings.bakedAoBoost (low 1.2 compensates for no GTAO).
 * Per material (createPbrMaterial patches, src/render/materials/pbr.ts):
 *   - DETAIL_FADE_GLSL: normal-map detail and macro variation fade with ZoomLook.material (samG MATERIAL_LOOK);
 *   - SPEC_AA_GLSL: extra geometric specular AA x ZoomLook.material.specularAA;
 *   - SUBSURFACE_PARS_GLSL: wrap + back-transmission lobe for leaves (thickness = ORM.b), skin and thin cloth.
 */
import { registerChunkPatch, SAM_G_DECL } from './globals';

/** Fragment-only declaration (three defines gl_FragColor as a macro only in fragment shaders, GLSL1 style). */
export const SAM_G_FRAGMENT_DECL = /* glsl */ `
#ifdef gl_FragColor
${SAM_G_DECL}
#endif
`;

registerChunkPatch('common', 'gfx01-globals-decl', (src) => `${src}\n${SAM_G_FRAGMENT_DECL}`);

const AO_LINE = 'float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;';
registerChunkPatch('aomap_fragment', 'gfx01-baked-ao-boost', (src) => {
  if (!src.includes(AO_LINE)) throw new Error('surface: three.js aomap_fragment changed');
  return src.replace(
    AO_LINE,
    'float ambientOcclusion = clamp( ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity * ( 1.0 + samG[ SAM_G_MATERIAL_BOOST ].y ) + 1.0, 0.0, 1.0 );',
  );
});

registerChunkPatch('emissivemap_fragment', 'gfx01-emissive-boost', (src) => `${src}\ntotalEmissiveRadiance *= 1.0 + samG[ SAM_G_MATERIAL_BOOST ].x;\n`);

/** After `#include <normal_fragment_maps>`: fade the tangent-space detail toward the geometric normal with distance. */
export const DETAIL_FADE_GLSL = /* glsl */ `
#ifdef USE_NORMALMAP
  normal = normalize( mix( normal, nonPerturbedNormal, clamp( samG[ SAM_G_MATERIAL_LOOK ].x, 0.0, 1.0 ) ) );
#endif
`;

/** After `#include <lights_physical_fragment>`: extra roughness from screen-space normal variance (band-scaled). */
export const SPEC_AA_GLSL = /* glsl */ `
material.roughness = min( material.roughness + geometryRoughness * samG[ SAM_G_MATERIAL_LOOK ].w, 1.0 );
`;

/**
 * After `#include <lights_physical_pars_fragment>`: wraps RE_Direct with a subsurface lobe. `samThickness` is 1 by
 * default; foliage sets write ORM.b (leaf thickness / translucency) into it in main().
 */
export const SUBSURFACE_PARS_GLSL = /* glsl */ `
#ifdef SAM_SUBSURFACE
uniform vec3 samSubsurfaceColor;
uniform float samSubsurface;
float samThickness = 1.0;
void RE_Direct_SamSubsurface( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  float ndl = dot( geometryNormal, directLight.direction );
  // Soft terminator (wrap) and light passing through thin matter toward the viewer.
  float wrap = clamp( ( ndl + 0.5 ) / 1.5, 0.0, 1.0 ) - clamp( ndl, 0.0, 1.0 );
  float vdl = clamp( dot( geometryViewDir, -directLight.direction ), 0.0, 1.0 );
  float vdl2 = vdl * vdl;
  float thru = clamp( -ndl, 0.0, 1.0 ) * ( 0.35 + 0.65 * vdl2 * vdl2 );
  reflectedLight.directDiffuse += directLight.color * samSubsurfaceColor * material.diffuseColor * ( samSubsurface * samThickness * ( 0.5 * wrap + thru ) );
}
#undef RE_Direct
#define RE_Direct RE_Direct_SamSubsurface
#endif
`;

/** In main() after `#include <roughnessmap_fragment>` for foliage sets: leaf thickness from ORM.b. */
export const FOLIAGE_THICKNESS_GLSL = /* glsl */ `
#if defined( SAM_SUBSURFACE ) && defined( SAM_FOLIAGE ) && defined( USE_ROUGHNESSMAP )
  samThickness = texture2D( roughnessMap, vRoughnessMapUv ).b;
#endif
`;
