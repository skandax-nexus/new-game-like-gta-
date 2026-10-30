/**
 * Rain wetness and puddles (ART_BIBLE §4.1 monsoon wetness 0.85, §4.3 monsoon_wet: darkened porous albedo, glossy
 * surfaces, puddle reflections). OWNER: Graphics Developer - Lighting, Atmosphere & Post (GFX-01).
 *
 * ONE wetness model for every lit surface (so wet stone, earth, plaster and cloth agree):
 *
 * 1. GLOBAL (W15 - reaches today's scenes without edits): a chunk patch appended to three's
 *    `metalnessmap_fragment` darkens and glosses EVERY MeshStandardMaterial / MeshPhysicalMaterial (and
 *    ShaderMaterials built on those chunks) from samG MATERIAL_BOOST.w, which the EnvironmentRig writes each frame:
 *      porosity = smoothstep(0.35, 0.9, roughness) x (1 - metalness)    (rough lime plaster ~0.9-1, polish ~0, metal 0)
 *      wet      = wetness x porosity x orientation(normal)              (walls 0.9, up-facing 1, overhangs 0.6)
 *      albedo  *= mix(1, 0.52, wet);  roughness = mix(roughness, 0.12, 0.85 x wet)
 *    => at wetness 0.85: plaster / sandstone walls x0.60-0.70 luminance, porous roughness 0.35-0.45; no change at 0.
 *    Per-material control (defines; set them before the first compile or set needsUpdate):
 *      SAM_OWN_WETNESS          the material applies wetness itself (createPbrMaterial, splat, the legacy terrain shader)
 *      SAM_WET_POROSITY <float> fixed porosity instead of the roughness-derived one (foliage 0.45: waxy leaves shed water)
 *    setWetnessClass(material, 'own' | number | 'auto') writes them. The rig tags the legacy groups it knows by name
 *    ('terrain' -> own: it darkens by its own 0.28 x weather wetness; 'vegetation' -> 0.45) until GFX-02/03 move to
 *    the shared hook.
 * 2. PER MATERIAL: createPbrMaterial (explicit porosity, puddles) and the terrain splat call the same functions:
 *
 *   ${WETNESS_GLSL}                                       // global scope of the fragment shader (already in `common`)
 *   float wet = samWetAmount( uWetness, porosity, samUpFacing( normal ) );   // normal in view space
 *   samApplyWetness( diffuseColor.rgb, roughnessFactor, wet );
 *   float puddle = samPuddleMask( worldPos.xz, uWetness, samUpDot( normal ) );   // 0..1 (flat ground only)
 *   samApplyPuddle( diffuseColor.rgb, roughnessFactor, puddle );          // and flatten the normal by `puddle`
 *
 * Wetness 0..1 is MATERIAL_GLOBALS.wetness (uniform object) = max(ResolvedLighting.wetness, rain wetness of the
 * weather), mirrored to samG MATERIAL_BOOST.w each frame by the EnvironmentRig. Puddles (the up-facing pooling term)
 * stay with createPbrMaterial and the GFX-02 splat hook; the global patch only darkens and glosses. Puddles turn
 * roughness to ~0.04, which puts them under the SSR cut-off on ultra and into the env-map mirror elsewhere.
 */
import * as THREE from 'three';
import { registerChunkPatch } from './globals';
import './surface'; // samG at global scope of every fragment shader (the global patch reads it)

/**
 * Darkening of fully wet porous albedo, the gloss it reaches, and the orientation weights (calibrated against the
 * Art Director's round-1 targets: plaster x0.60-0.70 and roughness 0.35-0.45 at wetness 0.85).
 */
export const WETNESS = {
  albedo: 0.52,
  roughness: 0.12,
  roughnessWeight: 0.85,
  /** Orientation: vertical walls / up-facing / down-facing (overhangs, eaves). */
  wall: 0.9,
  up: 1,
  down: 0.6,
  /** Porosity from roughness when the material has none: smoothstep(lo, hi, roughness). */
  porosityFrom: [0.35, 0.9] as readonly [number, number],
  /** Foliage porosity (vegetation): waxy leaves shed water (ART_BIBLE §9). */
  foliagePorosity: 0.45,
  puddleRoughness: 0.04,
  puddleAlbedo: 0.42,
  puddleFrom: 0.45,
} as const;

export const WETNESS_GLSL = /* glsl */ `
#ifndef SAM_WETNESS_GLSL
#define SAM_WETNESS_GLSL
// Cosine between the surface normal (view space) and world up.
float samUpDot( vec3 normalView ) {
  vec3 upView = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
  return dot( normalize( normalView ), upView );
}
// Orientation weight: walls ${WETNESS.wall.toFixed(2)}, up-facing ${WETNESS.up.toFixed(2)}, down-facing (eaves, overhangs) ${WETNESS.down.toFixed(2)}.
float samUpFacing( vec3 normalView ) {
  float u = clamp( samUpDot( normalView ), -1.0, 1.0 );
  return u >= 0.0 ? mix( ${WETNESS.wall.toFixed(2)}, ${WETNESS.up.toFixed(2)}, u ) : mix( ${WETNESS.wall.toFixed(2)}, ${WETNESS.down.toFixed(2)}, -u );
}
// Porosity of a material without an authored one: rough matter soaks, polish and metal shed water.
float samPorosityFrom( float roughness, float metalness ) {
  return smoothstep( ${WETNESS.porosityFrom[0].toFixed(2)}, ${WETNESS.porosityFrom[1].toFixed(2)}, roughness ) * ( 1.0 - clamp( metalness, 0.0, 1.0 ) );
}
float samWetAmount( float wetness, float porosity, float up ) {
  return clamp( wetness * porosity * up, 0.0, 1.0 );
}
void samApplyWetness( inout vec3 albedo, inout float roughness, float wet ) {
  albedo *= mix( 1.0, ${WETNESS.albedo.toFixed(2)}, wet );
  roughness = mix( roughness, ${WETNESS.roughness.toFixed(2)}, wet * ${WETNESS.roughnessWeight.toFixed(2)} );
}
float samPuddleHash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float samPuddleNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  float a = samPuddleHash( i );
  float b = samPuddleHash( i + vec2( 1.0, 0.0 ) );
  float c = samPuddleHash( i + vec2( 0.0, 1.0 ) );
  float d = samPuddleHash( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}
// Puddles: low spots of a 2-octave noise on flat, up-facing ground once wetness passes ~0.45.
float samPuddleMask( vec2 worldXZ, float wetness, float upDot ) {
  float level = smoothstep( 0.93, 0.985, upDot );
  float fill = smoothstep( ${WETNESS.puddleFrom.toFixed(2)}, 1.0, wetness );
  if ( level * fill <= 0.0 ) return 0.0;
  float n = samPuddleNoise( worldXZ * 0.31 ) * 0.7 + samPuddleNoise( worldXZ * 1.3 + 7.1 ) * 0.3;
  return level * smoothstep( 0.78 - 0.3 * fill, 0.84 - 0.3 * fill, n );
}
void samApplyPuddle( inout vec3 albedo, inout float roughness, float puddle ) {
  albedo *= mix( 1.0, ${WETNESS.puddleAlbedo.toFixed(2)}, puddle );
  roughness = mix( roughness, ${WETNESS.puddleRoughness.toFixed(2)}, puddle );
}
#endif
`;

/**
 * The global patch appended to `metalnessmap_fragment` (roughnessFactor and metalnessFactor are final there; normals
 * come later, so the orientation uses the interpolated vNormal). STANDARD = MeshStandard / MeshPhysical programs;
 * lit flipbooks (TA-07, FLIP_NORMAL) are participating media, not surfaces, and stay dry.
 */
export const GLOBAL_WETNESS_GLSL = /* glsl */ `
#if defined( STANDARD ) && !defined( SAM_OWN_WETNESS ) && !defined( FLIP_NORMAL )
{
  float samWetG = samG[ SAM_G_MATERIAL_BOOST ].w;
  if ( samWetG > 0.0 ) {
    #ifdef SAM_WET_POROSITY
      float samPorG = float( SAM_WET_POROSITY ) * ( 1.0 - clamp( metalnessFactor, 0.0, 1.0 ) );
    #else
      float samPorG = samPorosityFrom( roughnessFactor, metalnessFactor );
    #endif
    #ifndef FLAT_SHADED
      float samOrG = samUpFacing( vNormal );
    #else
      float samOrG = ${WETNESS.up.toFixed(2)};
    #endif
    samApplyWetness( diffuseColor.rgb, roughnessFactor, samWetAmount( samWetG, samPorG, samOrG ) );
  }
}
#endif
`;

/** three r170 `metalnessmap_fragment` ends with this line (a three upgrade that changes it fails loudly). */
const METALNESS_LINE = 'float metalnessFactor = metalness;';

// Shared functions at global scope of every fragment shader (next to samG, guarded so pbr.ts can include them too).
registerChunkPatch('common', 'gfx01-wetness-functions', (src) => `${src}\n#ifdef gl_FragColor\n${WETNESS_GLSL}\n#endif\n`);
registerChunkPatch('metalnessmap_fragment', 'gfx01-global-wetness', (src) => {
  if (!src.includes(METALNESS_LINE)) throw new Error('wetness: three.js metalnessmap_fragment changed');
  return `${src}\n${GLOBAL_WETNESS_GLSL}`;
});

/** Has the global wetness patch been applied to three's chunks? */
export function globalWetnessInstalled(): boolean {
  return THREE.ShaderChunk.metalnessmap_fragment.includes('SAM_OWN_WETNESS');
}

/**
 * Wetness class of a material for the global patch: 'own' (applies wetness itself), a fixed porosity 0..1, or 'auto'
 * (porosity from roughness). Recompiles the material when the class changes. Returns the material.
 */
export function setWetnessClass<T extends THREE.Material>(material: T, cls: 'own' | 'auto' | number): T {
  const defines = (material.defines ??= {}) as Record<string, unknown>;
  const before = `${String(defines.SAM_OWN_WETNESS)}|${String(defines.SAM_WET_POROSITY)}`;
  delete defines.SAM_OWN_WETNESS;
  delete defines.SAM_WET_POROSITY;
  if (cls === 'own') defines.SAM_OWN_WETNESS = '';
  else if (typeof cls === 'number') defines.SAM_WET_POROSITY = Math.min(1, Math.max(0, cls)).toFixed(3);
  if (`${String(defines.SAM_OWN_WETNESS)}|${String(defines.SAM_WET_POROSITY)}` !== before) material.needsUpdate = true;
  return material;
}

/** Debug / evidence override of the surface wetness (-1 = off; __SAMRAJYA_GFX__.setWetnessOverride). */
export const WETNESS_DEBUG = { override: -1 };

/** CPU mirror of samApplyWetness (tests, lookdev tables). */
export function wetSurface(albedo: number, roughness: number, wet: number): { albedo: number; roughness: number } {
  const w = Math.min(1, Math.max(0, wet));
  return { albedo: albedo * (1 + (WETNESS.albedo - 1) * w), roughness: roughness + (WETNESS.roughness - roughness) * w * WETNESS.roughnessWeight };
}

/** CPU mirror of samPorosityFrom. */
export function porosityFrom(roughness: number, metalness = 0): number {
  const [lo, hi] = WETNESS.porosityFrom;
  const t = Math.min(1, Math.max(0, (roughness - lo) / (hi - lo)));
  return t * t * (3 - 2 * t) * (1 - Math.min(1, Math.max(0, metalness)));
}

/** CPU mirror of samUpFacing for a world-space normal's up component (-1..1). */
export function wetOrientation(upDot: number): number {
  const u = Math.min(1, Math.max(-1, upDot));
  return u >= 0 ? WETNESS.wall + (WETNESS.up - WETNESS.wall) * u : WETNESS.wall + (WETNESS.down - WETNESS.wall) * -u;
}

/** CPU mirror of the global patch: a material of this roughness / metalness under `wetness`, facing `upDot`. */
export function globalWetSurface(albedo: number, roughness: number, metalness: number, wetness: number, upDot = 0, porosity?: number): { albedo: number; roughness: number } {
  const por = porosity !== undefined ? porosity * (1 - Math.min(1, Math.max(0, metalness))) : porosityFrom(roughness, metalness);
  return wetSurface(albedo, roughness, Math.min(1, Math.max(0, wetness * por * wetOrientation(upDot))));
}

/**
 * Rain wetness of the weather as a surface wetness: ground dampness under ~0.15 (dew, a dry spell after rain) does not
 * show; heavy rain (0.85) reads as 0.85 (ART_BIBLE §4.1 monsoon).
 */
export function surfaceWetnessFromWeather(weatherWetness: number): number {
  const w = Math.min(1, Math.max(0, weatherWetness));
  return Math.min(1, Math.max(0, ((w - 0.15) / 0.7) * 0.85));
}
