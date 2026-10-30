/**
 * Global exponential height fog for every material (ART_BIBLE §4.5; reference FOG_FRAG in
 * docs/art/tools/lookdev/lookdev.ts, lifted here). OWNER: Graphics Developer - Lighting, Atmosphere & Post (GFX-01).
 *
 * three's four fog chunks are patched once (installShaderGlobals): every material with `fog: true` that includes
 * them - MeshStandard / Physical / Lambert / Phong / Toon / Basic / Points / Sprite and ShaderMaterials built on the
 * chunks - gets, when the rig drives the frame:
 *   mode 1 (tier medium)  analytic height fog with the sun in-scatter lobe + mist slab;
 *   mode 2 (high / ultra) + mist-slab world noise (40 m / 9 m octaves, amplitude 0.5, scrolling with the wind 0.3x);
 *   mode 0 (low tier, or no rig: asset viewer) three's own Fog / FogExp2, unchanged;
 *   all modes: aerial perspective toward the horizon sky colour + the map-edge fade (no terrain / sky seam).
 * The world-space view ray comes from mvPosition (so instancing, skinning, VAT and wind displacement are included).
 *
 * Custom shaders (water, grass, crowds, particles; GFX-02/03/04):
 *   - built on three's fog chunks (`fog: true`, `#include <fog_pars_*>` / `<fog_vertex>` / `<fog_fragment>`): only
 *     the uniforms are needed - merge UniformsLib.fog (it already carries `samG`) or call injectHeightFog(shader);
 *   - hand-written: injectHeightFog(shader) adds the uniforms and prepends FOG_MATH_GLSL to the fragment shader;
 *     then call `col = samApplyFogWorld( col, worldPos );` at the end of main() (worldPos = fragment world position).
 */
import * as THREE from 'three';
import { injectShaderGlobals, registerChunkPatch, SAM_GLOBALS } from '../../materials/chunks/globals';
import { FOG_MATH_GLSL } from './fogMath';

/** Height fog + aerial perspective for a hand-written shader (world position in, colour out). */
export const SAM_APPLY_FOG_WORLD_GLSL = /* glsl */ `
#ifndef SAM_APPLY_FOG_WORLD
#define SAM_APPLY_FOG_WORLD
vec3 samApplyFogWorld( vec3 col, vec3 worldPos ) {
  vec3 ray = worldPos - cameraPosition;
  if ( samG[ SAM_G_FOG_COLOR ].w > 0.5 ) col = samHeightFog( col, ray );
  else if ( samG[ SAM_G_FOG_DENSITY ].x > 0.0 ) {
    // Low tier: the FogExp2 look (density x 0.6) for shaders without three's fog uniforms.
    float d = length( ray ) * samG[ SAM_G_FOG_DENSITY ].x * 0.6;
    col = mix( col, samG[ SAM_G_FOG_COLOR ].rgb, 1.0 - exp( -d * d ) );
  }
  return samAerial( col, ray, worldPos );
}
#endif
`;

const FOG_PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
	varying float vFogDepth;
	varying vec3 vSamFogRay;
#endif
`;

const FOG_VERTEX = /* glsl */ `
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	// World-space camera -> vertex vector (view rotation is orthonormal: inverse = transpose).
	vSamFogRay = mvPosition.xyz * mat3( viewMatrix );
#endif
`;

const FOG_PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vSamFogRay;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
${FOG_MATH_GLSL}
#endif
`;

const FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	if ( samG[ SAM_G_FOG_COLOR ].w > 0.5 ) {
		gl_FragColor.rgb = samHeightFog( gl_FragColor.rgb, vSamFogRay );
	} else {
		gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
	}
	gl_FragColor.rgb = samAerial( gl_FragColor.rgb, vSamFogRay, cameraPosition + vSamFogRay );
#endif
`;

/** three r170 chunk texts this module replaces (a three upgrade that changes them fails loudly at install). */
const EXPECT = {
  fog_vertex: 'vFogDepth = - mvPosition.z;',
  fog_pars_vertex: 'varying float vFogDepth;',
  fog_pars_fragment: 'uniform vec3 fogColor;',
  fog_fragment: 'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );',
} as const;

function replaceChunk(name: keyof typeof EXPECT, body: string): (src: string) => string {
  return (src) => {
    if (!src.includes(EXPECT[name])) throw new Error(`height fog: three.js ${name} changed`);
    return body;
  };
}

registerChunkPatch('fog_pars_vertex', 'gfx01-fog-pars-vertex', replaceChunk('fog_pars_vertex', FOG_PARS_VERTEX));
registerChunkPatch('fog_vertex', 'gfx01-fog-vertex', replaceChunk('fog_vertex', FOG_VERTEX));
registerChunkPatch('fog_pars_fragment', 'gfx01-fog-pars-fragment', replaceChunk('fog_pars_fragment', FOG_PARS_FRAGMENT));
registerChunkPatch('fog_fragment', 'gfx01-fog-fragment', replaceChunk('fog_fragment', FOG_FRAGMENT));

/** Has the height-fog patch been applied to three's chunks? */
export function heightFogInstalled(): boolean {
  return THREE.ShaderChunk.fog_fragment.includes('samHeightFog');
}

interface ShaderLike {
  uniforms: Record<string, THREE.IUniform>;
  vertexShader: string;
  fragmentShader: string;
  defines?: Record<string, unknown>;
}

/**
 * Give a custom shader (ShaderMaterial or onBeforeCompile `shader`) the shared height fog. Shaders that include
 * three's fog chunks only need the uniforms (added here, with neutral fogColor / fogDensity when absent); hand-written
 * shaders additionally get FOG_MATH_GLSL + samApplyFogWorld() prepended to the fragment shader and must call
 * `col = samApplyFogWorld( col, worldPos );` themselves. Idempotent.
 */
export function injectHeightFog<T extends ShaderLike>(shader: T): T {
  injectShaderGlobals(shader.uniforms);
  const u = shader.uniforms;
  u.fogColor ??= { value: new THREE.Color(0, 0, 0) };
  u.fogDensity ??= { value: 0 };
  u.fogNear ??= { value: 1 };
  u.fogFar ??= { value: 2000 };
  const usesChunks = shader.fragmentShader.includes('#include <fog_fragment>');
  if (!usesChunks && !shader.fragmentShader.includes('#define SAM_APPLY_FOG_WORLD')) {
    shader.fragmentShader = `${FOG_MATH_GLSL}\n${SAM_APPLY_FOG_WORLD_GLSL}\n${shader.fragmentShader}`;
  }
  return shader;
}

/** The shared uniform object (for materials that build their uniforms by hand). */
export const HEIGHT_FOG_UNIFORMS = { samG: SAM_GLOBALS } as const;
