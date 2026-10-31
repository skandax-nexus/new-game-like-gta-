/**
 * Global shader patches for cascaded sun shadows and PCSS (ART_BIBLE §13, ARCHITECTURE §19). OWNER: Graphics
 * Developer - Lighting, Atmosphere & Post (GFX-01). Registered on import; installed by installShaderGlobals().
 *
 * - `shadowmap_pars_fragment` gains `samDirShadow()`: for directional shadow light i below the cascade count
 *   (samG CSM_PARAMS.x, written by CascadedShadows every frame; 0 when no rig drives the frame) it returns the
 *   cascade weight for the fragment's view depth (cascades blend over the last CSM_BLEND of each slice; the weights
 *   of all cascade lights sum to 1, so N lights still light like one sun) times that cascade's shadow:
 *   hard (low tier: samShadowTentSoft - a tent of nine bilinear compares (16 fetches) plus a slope-scaled depth bias,
 *   no stair steps; 8 blocker taps widen its lattice step with the receiver-blocker distance, so distant casters soften
 *   like PCSS (16 more fetches on those penumbra pixels only)), PCF through three's getShadow(), or PCSS (Vogel-disk blocker search, penumbra = receiver-blocker
 *   distance x tan(sun angular radius), filtered with up to 32 rotated taps). Shadows fade out at the last split.
 *   Idle cascades (far zoom bands use fewer, csm.ts activeCascadesFor) carry texel 0 in their slot: weight 0, and the
 *   cascade before them is the last one in use.
 *   Lights at or above the count behave exactly like stock three.js (asset viewer suns, future rim lights).
 * - `lights_fragment_begin`: only the directional `getShadow( directionalShadowMap[ i ] ...)` line is replaced;
 *   every other line (incl. the light-probe / hemisphere calls TA-07's flipbook patches by string) is untouched.
 * - ?csm=1 (CSM_PARAMS.z) tints each cascade (red, green, blue, yellow) for the debug screenshot.
 */
import * as THREE from 'three';
import { registerChunkPatch, SAM_G_DECL } from '../materials/chunks/globals';
import { CSM_DEBUG_COLORS, LOW_MAX_TENT_STEP, LOW_SEARCH_BLOCKER_M, LOW_SEARCH_MAX_TEXELS, SLOPE_BIAS_MAX_TAN, SLOPE_BIAS_TEXELS } from './csm';

const vec3 = (c: readonly number[]): string => `vec3( ${c.map((v) => v.toFixed(3)).join(', ')} )`;

export const CSM_PARS_GLSL = /* glsl */ `
#if NUM_DIR_LIGHT_SHADOWS > 0
${SAM_G_DECL}
float samShadowIGN( vec2 p ) {
  return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) );
}
vec2 samShadowVogel( int i, int n, float phi ) {
  float r = sqrt( ( float( i ) + 0.5 ) / float( n ) );
  float th = float( i ) * 2.39996323 + phi;
  return r * vec2( cos( th ), sin( th ) );
}
// PCSS for an orthographic cascade: casc = ( split near, split far, texel world size, depth range ).
float samShadowPCSS( sampler2D map, vec2 mapSize, float bias, vec4 coord, vec4 casc ) {
  coord.xyz /= coord.w;
  coord.z += bias;
  if ( coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z > 1.0 ) return 1.0;
  vec4 p = samG[ SAM_G_CSM_PCSS ];
  float texel = 1.0 / mapSize.x;
  float frustumW = max( casc.z * mapSize.x, 1e-3 );
  float phi = samShadowIGN( gl_FragCoord.xy ) * 6.2831853;
  // Blocker search over the penumbra an occluder up to 30 m above the receiver could cast.
  float searchUv = clamp( p.x * 30.0 / frustumW, texel * 2.0, texel * p.w );
  float zSum = 0.0;
  float nB = 0.0;
  int nS = int( p.y );
  for ( int k = 0; k < 16; k++ ) {
    if ( k >= nS ) break;
    float d = unpackRGBAToDepth( texture2D( map, coord.xy + samShadowVogel( k, nS, phi ) * searchUv ) );
    if ( d < coord.z ) {
      zSum += d;
      nB += 1.0;
    }
  }
  if ( nB < 0.5 ) return 1.0;
  float dist = ( coord.z - zSum / nB ) * casc.w;
  float pen = clamp( dist * p.x / frustumW, texel, texel * p.w );
  int nF = int( p.z );
  float lit = 0.0;
  for ( int k = 0; k < 32; k++ ) {
    if ( k >= nF ) break;
    lit += step( coord.z, unpackRGBAToDepth( texture2D( map, coord.xy + samShadowVogel( k, nF, phi + 1.7 ) * pen ) ) );
  }
  return lit / float( nF );
}
// Low tier 'hard' filter: nine bilinear (2x2) depth compares at -1 / 0 / +1 lattice step, folded into one 4x4 fetch
// with weights (1 - f, 1, 1, f) per axis (16 fetches, like three's PCF). The lattice step is s texels: s = 1 is the
// fixed ~3-texel tent (AD round 1, blocker 2: no stair steps); s > 1 is the same tent on a coarser lattice (a wider,
// still noise-free and continuous footprint). Occluding fetches are accumulated into blk = (sum depth, count).
float samShadowTentS( sampler2D map, vec2 size, float z, vec2 uv, float s, inout vec2 blk ) {
  vec2 texel = 1.0 / size;
  vec2 st = ( uv * size - 0.5 ) / s;
  vec2 f = fract( st );
  vec2 base = ( ( floor( st ) - 1.0 ) * s + 0.5 ) * texel;
  vec2 stepUv = s * texel;
  vec4 wx = vec4( 1.0 - f.x, 1.0, 1.0, f.x );
  vec4 wy = vec4( 1.0 - f.y, 1.0, 1.0, f.y );
  float sum = 0.0;
  for ( int j = 0; j < 4; j++ ) {
    vec4 row;
    for ( int i = 0; i < 4; i++ ) {
      float d = unpackRGBAToDepth( texture2D( map, base + vec2( float( i ), float( j ) ) * stepUv ) );
      row[ i ] = step( z, d );
      if ( d < z ) blk += vec2( d, 1.0 );
    }
    sum += dot( row, wx ) * wy[ j ];
  }
  return sum / 9.0;
}
float samShadowTent( sampler2D map, vec2 size, float bias, vec4 coord ) {
  coord.xyz /= coord.w;
  coord.z += bias;
  if ( coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z > 1.0 ) return 1.0;
  vec2 blk = vec2( 0.0 );
  return samShadowTentS( map, size, coord.z, coord.xy, 1.0, blk );
}
// Low tier with a blocker-distance footprint (AD round 2, R2-2): the tent above, plus 8 blocker-search taps (a ring
// of 2-${LOW_SEARCH_MAX_TEXELS} texels). With blockers found, the penumbra radius
// (receiver-blocker distance x tan(sun angular radius), like PCSS) sets the lattice step s = radius / 1.5 texels
// (1-${LOW_MAX_TENT_STEP}); s > 1 re-filters with the wider tent (16 more fetches, penumbra pixels only) and a slope bias grown by s. Near
// blockers keep s = 1 (unchanged crisp contact shadows); a distant battlement softens like it does under PCSS
// instead of printing its merlons as a comb. casc = ( split near, split far, texel world size, depth range ).
float samShadowTentSoft( sampler2D map, vec2 size, float bias, float slopeBias, vec4 coord, vec4 casc ) {
  coord.xyz /= coord.w;
  float z = coord.z + bias - slopeBias;
  if ( coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || z > 1.0 ) return 1.0;
  vec2 blk = vec2( 0.0 );
  float sh = samShadowTentS( map, size, z, coord.xy, 1.0, blk );
  float softTan = samG[ SAM_G_CSM_PCSS ].x;
  float texelM = max( casc.z, 1e-4 );
  // Search radius: 1.33 x the penumbra radius of a blocker ${LOW_SEARCH_BLOCKER_M} m away (the widened tent's support), so lit
  // pixels outside a soft edge find the blocker too (the penumbra spreads both ways).
  vec2 r = clamp( softTan * ${LOW_SEARCH_BLOCKER_M.toFixed(1)} * 1.33 / texelM, 2.0, ${LOW_SEARCH_MAX_TEXELS.toFixed(1)} ) / size;
  vec2 q = r * 0.7071;
  float d;
  d = unpackRGBAToDepth( texture2D( map, coord.xy + vec2( r.x, 0.0 ) ) ); if ( d < z ) blk += vec2( d, 1.0 );
  d = unpackRGBAToDepth( texture2D( map, coord.xy - vec2( r.x, 0.0 ) ) ); if ( d < z ) blk += vec2( d, 1.0 );
  d = unpackRGBAToDepth( texture2D( map, coord.xy + vec2( 0.0, r.y ) ) ); if ( d < z ) blk += vec2( d, 1.0 );
  d = unpackRGBAToDepth( texture2D( map, coord.xy - vec2( 0.0, r.y ) ) ); if ( d < z ) blk += vec2( d, 1.0 );
  d = unpackRGBAToDepth( texture2D( map, coord.xy + q ) ); if ( d < z ) blk += vec2( d, 1.0 );
  d = unpackRGBAToDepth( texture2D( map, coord.xy - q ) ); if ( d < z ) blk += vec2( d, 1.0 );
  d = unpackRGBAToDepth( texture2D( map, coord.xy + vec2( q.x, - q.y ) ) ); if ( d < z ) blk += vec2( d, 1.0 );
  d = unpackRGBAToDepth( texture2D( map, coord.xy + vec2( - q.x, q.y ) ) ); if ( d < z ) blk += vec2( d, 1.0 );
  if ( blk.y < 0.5 ) return sh;
  float dist = ( z - blk.x / blk.y ) * casc.w;
  float s = clamp( dist * softTan / texelM / 1.5, 1.0, ${LOW_MAX_TENT_STEP.toFixed(1)} );
  if ( s <= 1.001 ) return sh;
  vec2 unused = vec2( 0.0 );
  return samShadowTentS( map, size, z - slopeBias * ( s - 1.0 ), coord.xy, s, unused );
}
// Is cascade i the last one in use? (the tier's last, or the one before an idle cascade: texel 0 in its slot)
bool samCsmLast( int i ) {
  return float( i ) >= samG[ SAM_G_CSM_PARAMS ].x - 1.0 || samG[ SAM_G_CSM_CASCADE + i + 1 ].z <= 0.0;
}
// Fraction of the key light already handed to cascades after j at view depth d (1 for j < 0, 0 for the last).
float samCsmOut( int j, float d ) {
  if ( j < 0 ) return 1.0;
  vec4 prm = samG[ SAM_G_CSM_PARAMS ];
  if ( samCsmLast( j ) ) return 0.0;
  vec4 c = samG[ SAM_G_CSM_CASCADE + j ];
  float band = prm.w * ( c.y - c.x );
  return smoothstep( c.y - band, c.y, d );
}
vec3 samCsmTint( int i ) {
  return i == 0 ? ${vec3(CSM_DEBUG_COLORS[0]!)} : i == 1 ? ${vec3(CSM_DEBUG_COLORS[1]!)} : i == 2 ? ${vec3(CSM_DEBUG_COLORS[2]!)} : ${vec3(CSM_DEBUG_COLORS[3]!)};
}
// depth = view-space depth of the fragment (the caller passes -geometryPosition.z; no view-position varying is
// assumed here, so materials without one - three's ShadowMaterial - still compile).
// ndl = dot( normal, toLight ): the hard (low tier) filter adds a slope-scaled depth bias (SLOPE_BIAS_TEXELS texels x
// tan(angle), capped at SLOPE_BIAS_MAX_TAN) so grazing-lit walls do not streak with acne.
vec3 samDirShadow( const in int i, sampler2D map, DirectionalLightShadow s, vec4 coord, bool receive, float depth, float ndl ) {
  vec4 prm = samG[ SAM_G_CSM_PARAMS ];
  if ( float( i ) >= prm.x ) {
    // Not a cascade of the rig's sun: stock three.js behaviour.
    return vec3( receive ? getShadow( map, s.shadowMapSize, s.shadowIntensity, s.shadowBias, s.shadowRadius, coord ) : 1.0 );
  }
  vec4 c = samG[ SAM_G_CSM_CASCADE + i ];
  // Idle cascade (a far zoom band uses fewer than the tier's cascades): no light, no lookup.
  if ( c.z <= 0.0 ) return vec3( 0.0 );
  float w = samCsmOut( i - 1, depth ) - samCsmOut( i, depth );
  if ( w <= 0.0 ) return vec3( 0.0 );
  float sh = 1.0;
  if ( receive ) {
    if ( prm.y > 1.5 ) sh = samShadowPCSS( map, s.shadowMapSize, s.shadowBias, coord, c );
    else {
      if ( prm.y < 0.5 ) {
        float cs = clamp( ndl, 0.02, 1.0 );
        float tanT = min( sqrt( max( 1.0 - cs * cs, 0.0 ) ) / cs, ${SLOPE_BIAS_MAX_TAN.toFixed(1)} );
        sh = samShadowTentSoft( map, s.shadowMapSize, s.shadowBias, ${SLOPE_BIAS_TEXELS.toFixed(2)} * tanT * c.z / max( c.w, 1e-3 ), coord, c );
      } else sh = getShadow( map, s.shadowMapSize, 1.0, s.shadowBias, s.shadowRadius, coord );
    }
    if ( samCsmLast( i ) ) {
      float band = prm.w * ( c.y - c.x );
      sh = mix( sh, 1.0, smoothstep( c.y - band, c.y, depth ) );
    }
    sh = mix( 1.0, sh, s.shadowIntensity );
  }
  vec3 tint = prm.z > 0.5 ? samCsmTint( i ) : vec3( 1.0 );
  return tint * ( w * sh );
}
#endif
`;

/** The exact three r170 line replaced in lights_fragment_begin (a three upgrade that changes it fails loudly). */
export const DIR_SHADOW_LINE =
  'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';
export const DIR_SHADOW_REPLACEMENT =
  'directLight.color *= samDirShadow( UNROLLED_LOOP_INDEX, directionalShadowMap[ i ], directionalLightShadow, vDirectionalShadowCoord[ i ], directLight.visible && receiveShadow, - geometryPosition.z, dot( geometryNormal, directLight.direction ) );';

registerChunkPatch('shadowmap_pars_fragment', 'gfx01-csm-pars', (src) => {
  // Insert just before the #endif that closes USE_SHADOWMAP (getShadow / DirectionalLightShadow are declared above).
  const idx = src.lastIndexOf('#endif');
  if (idx < 0) return src;
  return `${src.slice(0, idx)}${CSM_PARS_GLSL}\n${src.slice(idx)}`;
});

registerChunkPatch('lights_fragment_begin', 'gfx01-csm-weights', (src) => {
  if (!src.includes(DIR_SHADOW_LINE)) throw new Error('gfx01-csm-weights: three.js lights_fragment_begin changed (directional shadow line not found)');
  return src.replace(DIR_SHADOW_LINE, DIR_SHADOW_REPLACEMENT);
});

/** For tests / diagnostics: has the cascade patch been applied to three's chunks? */
export function cascadeChunksInstalled(): boolean {
  return (THREE.ShaderChunk.lights_fragment_begin as string).includes('samDirShadow(');
}
