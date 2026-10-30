/**
 * Exponential height fog math (ART_BIBLE §4.5, reference FOG_FRAG in docs/art/tools/lookdev/lookdev.ts), shared by
 * the sky dome, the global material fog chunk and custom shaders. OWNER: Graphics Developer - Lighting,
 * Atmosphere & Post (GFX-01).
 *
 * GLSL (`FOG_MATH_GLSL`, fragment only, reads the shared `samG` uniform - see materials/chunks/globals.ts):
 *   samFogOpticalDepth(camY, dir, dist)  analytic integral of density * exp(-falloff * (h - base)) along the ray,
 *                                        written in a form that cannot overflow for steep downward rays
 *   samMistFraction(y0, y1, top)         fraction of the ray below the mist-slab top
 *   samFogColor(dir)                     fog colour with the sun in-scatter lobe
 *   samHeightFog(col, ray)               full height fog + mist slab (+ 2-octave world noise in mode 2)
 *   samHorizon(dir)                      horizon sky colour from the 8-entry ring (aerial perspective target)
 *   samAerial(col, ray, worldPos)        aerial perspective + map-edge fade toward the horizon sky colour
 *   samSkyDomeFog(col, dir)              the same fog applied to the sky dome at d = 20 km, clamp 0.6
 * JS mirrors (`fogOpticalDepth`, `skyDomeFogAlpha`) keep the CPU-side horizon ring and the tests in step.
 */
import { SAM_G_DECL } from '../../materials/chunks/globals';

/** Sky-dome fog distance (m) and opacity clamp (ART_BIBLE §4.5: "apply with d = 20 km, clamp 0.6"). */
export const SKY_FOG_DISTANCE_M = 20000;
export const SKY_FOG_CLAMP = 0.6;
/** Mist-slab noise (ART_BIBLE §4.5): two octaves at 40 m and 9 m, amplitude 0.5, scrolling with the wind at 0.3x. */
export const MIST_NOISE = { octave1M: 40, octave2M: 9, amplitude: 0.5, windScroll: 0.3 } as const;

export const FOG_MATH_GLSL = /* glsl */ `
${SAM_G_DECL}
#ifndef SAM_FOG_MATH
#define SAM_FOG_MATH
float samFogOpticalDepth( float camY, vec3 dir, float dist ) {
  vec4 a = samG[ SAM_G_FOG_DENSITY ];
  if ( a.x <= 0.0 ) return 0.0;
  float b = max( a.y, 1e-6 );
  float hS = clamp( -b * ( camY - a.z ), -80.0, 80.0 );
  float endY = camY + dir.y * dist;
  float hE = clamp( -b * ( endY - a.z ), -80.0, 80.0 );
  float bdy = b * dir.y * dist;
  if ( abs( bdy ) < 1e-3 ) return a.x * dist * exp( hS );
  return a.x * dist * ( exp( hS ) - exp( hE ) ) / bdy;
}
float samMistFraction( float y0, float y1, float top ) {
  float lo = min( y0, y1 );
  float hi = max( y0, y1 );
  return ( hi - lo ) < 1e-3 ? step( lo, top ) : clamp( ( top - lo ) / ( hi - lo ), 0.0, 1.0 );
}
vec3 samFogColor( vec3 dir ) {
  // pow base kept > 0 (SwiftShader: pow(0, y) = NaN).
  float s = pow( max( dot( dir, samG[ SAM_G_FOG_SUN ].xyz ), 1e-6 ), max( samG[ SAM_G_FOG_INSCATTER ].w, 1.0 ) );
  return mix( samG[ SAM_G_FOG_COLOR ].rgb, samG[ SAM_G_FOG_INSCATTER ].rgb, s );
}
float samHash12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float samValueNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  float a = samHash12( i );
  float b = samHash12( i + vec2( 1.0, 0.0 ) );
  float c = samHash12( i + vec2( 0.0, 1.0 ) );
  float d = samHash12( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}
vec3 samHeightFog( vec3 col, vec3 ray ) {
  float dist = length( ray );
  vec3 dir = ray / max( dist, 1e-4 );
  float camY = cameraPosition.y;
  float od = samFogOpticalDepth( camY, dir, dist );
  vec4 m = samG[ SAM_G_FOG_MIST ];
  if ( m.x > 0.0 ) {
    float frac = samMistFraction( camY, camY + ray.y, samG[ SAM_G_FOG_DENSITY ].w );
    float mist = m.x * dist * frac;
    if ( samG[ SAM_G_FOG_COLOR ].w > 1.5 && m.y > 0.0 ) {
      vec2 p = cameraPosition.xz + ray.xz + m.zw;
      vec4 s = samG[ SAM_G_FOG_SKY ];
      float n = samValueNoise( p * s.y ) * 0.62 + samValueNoise( p * s.z + 17.31 ) * 0.38;
      mist *= max( 0.0, 1.0 + m.y * ( 2.0 * n - 1.0 ) );
    }
    od += mist;
  }
  float alpha = min( 1.0 - exp( -od ), samG[ SAM_G_FOG_SUN ].w );
  return mix( col, samFogColor( dir ), alpha );
}
vec3 samHorizon( vec3 dir ) {
  float t = ( atan( dir.z, dir.x ) * 0.15915494 + 0.5 ) * 8.0;
  float fi = floor( t );
  float f = t - fi;
  int i0 = int( mod( fi, 8.0 ) );
  int i1 = int( mod( fi + 1.0, 8.0 ) );
  return mix( samG[ SAM_G_HORIZON_RING + i0 ].rgb, samG[ SAM_G_HORIZON_RING + i1 ].rgb, f );
}
vec3 samAerial( vec3 col, vec3 ray, vec3 worldPos ) {
  vec4 a = samG[ SAM_G_FOG_AERIAL ];
  if ( samG[ SAM_G_HORIZON_RING ].w < 0.5 ) return col;
  vec4 mp = samG[ SAM_G_FOG_MAP ];
  float dist = length( ray );
  float x = clamp( dist / max( mp.z, 1.0 ), 0.0, 1.0 );
  float t = a.x * x * x;
  if ( a.w > 0.5 ) {
    vec2 q = abs( worldPos.xz - mp.xy );
    t = max( t, smoothstep( a.y, a.z, max( q.x, q.y ) ) );
  }
  return mix( col, samHorizon( ray / max( dist, 1e-4 ) ), t );
}
vec3 samSkyDomeFog( vec3 col, vec3 dir ) {
  vec4 s = samG[ SAM_G_FOG_SKY ];
  if ( s.x <= 0.0 ) return col;
  float od = samFogOpticalDepth( cameraPosition.y, dir, s.x );
  float alpha = min( 1.0 - exp( -od ), samG[ SAM_G_FOG_MAP ].w );
  return mix( col, samFogColor( dir ), alpha );
}
#endif
`;

/** JS mirror of samFogOpticalDepth (same stable form). */
export function fogOpticalDepth(density: number, falloff: number, baseHeight: number, camY: number, dirY: number, dist: number): number {
  if (density <= 0) return 0;
  const b = Math.max(falloff, 1e-6);
  const clamp = (x: number): number => Math.min(80, Math.max(-80, x));
  const hS = clamp(-b * (camY - baseHeight));
  const hE = clamp(-b * (camY + dirY * dist - baseHeight));
  const bdy = b * dirY * dist;
  if (Math.abs(bdy) < 1e-3) return density * dist * Math.exp(hS);
  return (density * dist * (Math.exp(hS) - Math.exp(hE))) / bdy;
}

/** Opacity of the sky-dome fog in a direction of elevation sine `dirY` (d = 20 km, clamp 0.6). */
export function skyDomeFogAlpha(density: number, falloff: number, baseHeight: number, camY: number, dirY: number, clampTo = SKY_FOG_CLAMP, distance = SKY_FOG_DISTANCE_M): number {
  const od = fogOpticalDepth(density, falloff, baseHeight, camY, dirY, distance);
  return Math.min(1 - Math.exp(-od), clampTo);
}
