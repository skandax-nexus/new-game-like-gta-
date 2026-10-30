/**
 * Rain wetness and puddles (ART_BIBLE §4 monsoon_wet: darkened porous albedo, glossy surfaces, puddle
 * reflections). OWNER: Graphics Developer - Lighting, Atmosphere & Post (GFX-01).
 *
 * One chunk for every surface shader: createPbrMaterial (pbr.ts) uses it; the terrain splat material
 * (materials/splat.ts) and custom shaders call the same functions so wet stone, earth and plaster agree:
 *
 *   ${WETNESS_GLSL}                                       // global scope of the fragment shader
 *   float wet = samWetAmount( uWetness, porosity, samUpFacing( normal ) );   // normal in view space
 *   samApplyWetness( diffuseColor.rgb, roughnessFactor, wet );
 *   float puddle = samPuddleMask( worldPos.xz, uWetness, samUpDot( normal ) );   // 0..1 (flat ground only)
 *   samApplyPuddle( diffuseColor.rgb, roughnessFactor, puddle );          // and flatten the normal by `puddle`
 *
 * Wetness 0..1 is MATERIAL_GLOBALS.wetness (uniform object) = max(ResolvedLighting.wetness, weather wetness), also
 * mirrored to samG MATERIAL_BOOST.w each frame by the EnvironmentRig. Puddles turn roughness to ~0.04, which puts
 * them under the SSR cut-off on ultra (screen-space puddle reflections) and into the env-map mirror elsewhere.
 */

/** Darkening of fully wet porous albedo and the gloss it reaches (calibrated on lookdev, ART_BIBLE §8). */
export const WETNESS = { albedo: 0.58, roughness: 0.12, roughnessWeight: 0.85, puddleRoughness: 0.04, puddleAlbedo: 0.42, puddleFrom: 0.45 } as const;

export const WETNESS_GLSL = /* glsl */ `
#ifndef SAM_WETNESS_GLSL
#define SAM_WETNESS_GLSL
// Cosine between the surface normal (view space) and world up.
float samUpDot( vec3 normalView ) {
  vec3 upView = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
  return dot( normalize( normalView ), upView );
}
// 0.6 .. 1: up-facing surfaces collect more water than walls.
float samUpFacing( vec3 normalView ) {
  return clamp( samUpDot( normalView ) * 0.5 + 0.6, 0.0, 1.0 );
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

/** CPU mirror of samApplyWetness (tests, lookdev tables). */
export function wetSurface(albedo: number, roughness: number, wet: number): { albedo: number; roughness: number } {
  const w = Math.min(1, Math.max(0, wet));
  return { albedo: albedo * (1 + (WETNESS.albedo - 1) * w), roughness: roughness + (WETNESS.roughness - roughness) * w * WETNESS.roughnessWeight };
}
