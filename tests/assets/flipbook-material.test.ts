/**
 * Flipbook reference material blending (TA-07 rework round 1) and lighting / gradient map (round 2).
 * OWNER: Technical Artist G (TA-07).
 *
 * Round 2: lit books are lit as a participating medium (wrap lighting, upper-hemisphere ambient, no specular - the
 * three r170 chunk text the patch rewrites must still exist), and gradient-mapped books (`ramp`: fx_fire,
 * fx_weapon_trail) colour one stored channel with the published ramp.
 *
 * Premultiplied books (fx_fire: emission + occlusion alpha) must blend ONE / ONE_MINUS_SRC_ALPHA with
 * material.premultipliedAlpha OFF: three's PREMULTIPLIED_ALPHA chunk multiplies rgb by alpha a second time, which
 * showed the fire as rgb x occlusion (dim tongues, dark wisps where the gas cools). Material opacity must fade the
 * premultiplied emission too. Additive books add rgb x emissiveIntensity; alpha books blend normally.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ASSET_MANIFEST } from '../../src/assets/manifest';
import type { AssetEntry, FlipbookAssetEntry } from '../../src/assets/types';
import {
  createFlipbookMaterial,
  FLIP_CHUNK_HOOKS,
  FLIP_SKY_VISIBILITY,
  FLIP_WRAP,
  rampColor,
  type FlipbookHandle,
} from '../../src/assets/loaders/flipbook';
import { PREPASS_TAG } from '../../src/assets/loaders/prepass';

const assets = ASSET_MANIFEST.assets as unknown as Record<string, AssetEntry>;

function handle(id: string): FlipbookHandle {
  const e = assets[id];
  if (!e || e.kind !== 'flipbook') throw new Error(`${id} is not a published flipbook`);
  const entry = e as FlipbookAssetEntry;
  return {
    entry,
    color: new THREE.Texture(),
    normal: entry.lit ? new THREE.Texture() : null,
    emissive: null,
    sequence: (name) => entry.sequences.find((s) => s.name === name) ?? null,
    release: () => undefined,
  };
}

/** Runs the material's shader patch on a minimal stand-in of the three chunks it hooks. */
function patchedFragment(mat: THREE.Material): { fragment: string; defines: Record<string, unknown>; uniforms: Record<string, THREE.IUniform> } {
  const shader = {
    uniforms: {} as Record<string, THREE.IUniform>,
    defines: {} as Record<string, unknown>,
    vertexShader: '#include <common>\nvoid main() {}',
    fragmentShader:
      '#include <common>\n#include <lights_physical_pars_fragment>\nvoid main() {\n#include <map_fragment>\n#include <normal_fragment_maps>\n' +
      '#include <lights_physical_fragment>\n#include <lights_fragment_begin>\n#include <lights_fragment_maps>\n}',
  };
  // cast: three's onBeforeCompile takes WebGLProgramParametersWithUniforms; the patch only touches the fields above
  mat.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  return { fragment: shader.fragmentShader, defines: shader.defines, uniforms: shader.uniforms };
}

describe('flipbook material blending', () => {
  it('premultiplied (fx_fire): ONE / ONE_MINUS_SRC_ALPHA without three premultipliedAlpha; opacity fades emission', () => {
    const mat = createFlipbookMaterial(handle('fx_fire'));
    expect(mat.blending).toBe(THREE.CustomBlending);
    expect(mat.blendSrc).toBe(THREE.OneFactor);
    expect(mat.blendDst).toBe(THREE.OneMinusSrcAlphaFactor);
    expect(mat.premultipliedAlpha).toBe(false);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    const { fragment, defines } = patchedFragment(mat);
    expect(defines.FLIP_PREMULTIPLIED).toBe('');
    expect(fragment).toContain('diffuseColor.rgb *= flipC.rgb * flipEmissive * diffuseColor.a;');
    expect(mat.userData[PREPASS_TAG]).toBe('skip');
    mat.dispose();
  });

  it('additive (fx_sparks_embers): additive blending, emission x emissiveIntensity', () => {
    const h = handle('fx_sparks_embers');
    const mat = createFlipbookMaterial(h, { sequence: 'finisher_burst' });
    expect(mat.blending).toBe(THREE.AdditiveBlending);
    expect(mat.premultipliedAlpha).toBe(false);
    const { fragment, defines } = patchedFragment(mat);
    expect(defines.FLIP_ADDITIVE).toBe('');
    expect(fragment).toContain('diffuseColor.rgb *= flipC.rgb * flipEmissive;');
    const u = mat.userData.flipbookUniforms as Record<string, THREE.IUniform>;
    expect(u.flipEmissive!.value).toBe(h.entry.emissiveIntensity);
    mat.dispose();
  });

  it('alpha (fx_smoke): normal blending, lit by the atlas normals', () => {
    const mat = createFlipbookMaterial(handle('fx_smoke'));
    expect(mat.blending).toBe(THREE.NormalBlending);
    expect(mat).toBeInstanceOf(THREE.MeshStandardMaterial);
    const { defines } = patchedFragment(mat);
    expect(defines.FLIP_NORMAL).toBe('');
    expect(defines.FLIP_PREMULTIPLIED).toBeUndefined();
    mat.dispose();
  });
});

describe('lit flipbooks are lit as a participating medium (TA-07 R2-B1)', () => {
  it('the three r170 chunk text the patch rewrites still exists', () => {
    expect(THREE.ShaderChunk.lights_physical_pars_fragment).toContain(FLIP_CHUNK_HOOKS.directDotNL);
    expect(THREE.ShaderChunk.lights_fragment_begin).toContain(FLIP_CHUNK_HOOKS.probe);
    expect(THREE.ShaderChunk.lights_fragment_begin).toContain(FLIP_CHUNK_HOOKS.hemi);
    expect(THREE.ShaderChunk.lights_fragment_maps).toContain(FLIP_CHUNK_HOOKS.ibl);
  });

  it('wrap lighting, upper-hemisphere ambient and no specular replace plain Lambert', () => {
    const mat = createFlipbookMaterial(handle('fx_smoke'));
    const { fragment, defines } = patchedFragment(mat);
    expect(defines.FLIP_WRAP).toBe(String(FLIP_WRAP));
    expect(fragment).toContain('( dot( geometryNormal, directLight.direction ) + FLIP_WRAP ) / ( 1.0 + FLIP_WRAP )');
    expect(fragment).not.toContain(FLIP_CHUNK_HOOKS.directDotNL);
    expect(fragment).toContain('getIBLIrradiance( flipAmbientNormal( geometryNormal ) )');
    expect(fragment).toContain('getHemisphereLightIrradiance( hemisphereLights[ i ], flipAmbientNormal( geometryNormal ) )');
    expect(fragment).toContain('getLightProbeIrradiance( lightProbe, flipAmbientNormal( geometryNormal ) )');
    expect(fragment).toContain('material.specularColor = vec3( 0.0 );');
    expect(fragment).not.toContain('#include <lights_fragment_begin>');
    // sky visibility: every ambient source is scaled by flipSkyVis (bounded below by 1 - k: never the ground)
    expect(defines.FLIP_SKY_VIS).toBe(String(FLIP_SKY_VISIBILITY));
    expect(fragment.match(/\* flipSkyVis\( geometryNormal \)/g)?.length).toBe(3);
    expect(fragment).toContain('return 1.0 - FLIP_SKY_VIS * ( 0.5 - 0.5 * dot( n, up ) );');
    expect(FLIP_WRAP).toBeGreaterThanOrEqual(0.4);
    expect(FLIP_WRAP).toBeLessThanOrEqual(0.7);
    mat.dispose();
  });

  it('a wrap override changes the define and the program key; unlit books keep three lighting untouched', () => {
    const a = createFlipbookMaterial(handle('fx_dust'), { wrap: 0, skyVisibility: 0 });
    const b = createFlipbookMaterial(handle('fx_dust'));
    expect(patchedFragment(a).defines.FLIP_WRAP).toBe('0.0');
    expect(patchedFragment(a).defines.FLIP_SKY_VIS).toBe('0.0');
    expect(patchedFragment(b).defines.FLIP_NSCALE).toBe('1.0');
    expect(a.customProgramCacheKey()).not.toBe(b.customProgramCacheKey());
    const fire = createFlipbookMaterial(handle('fx_fire'));
    const { fragment } = patchedFragment(fire);
    expect(fragment).toContain('#include <lights_fragment_begin>');
    for (const m of [a, b, fire]) m.dispose();
  });
});

describe('gradient-mapped flipbooks (TA-07 R2-B2 / R2-B3)', () => {
  for (const id of ['fx_fire', 'fx_weapon_trail']) {
    it(`${id}: ramp uniform + define, colour from one channel`, () => {
      const h = handle(id);
      const ramp = h.entry.ramp;
      expect(ramp).not.toBeNull();
      const mat = createFlipbookMaterial(h);
      const { fragment, defines, uniforms } = patchedFragment(mat);
      expect(defines.FLIP_RAMP).toBe(String(ramp!.length));
      expect(fragment).toContain('flipC.rgb = flipRampColor( flipC.r );');
      const u = uniforms.flipRamp!.value as THREE.Vector3[];
      expect(u.length).toBe(ramp!.length);
      expect(u[0]!.toArray()).toEqual([0, 0, 0]);
      expect(mat.customProgramCacheKey()).toContain(`r${ramp!.length}`);
      mat.dispose();
    });
  }

  it('rampColor interpolates evenly spaced stops and clamps v', () => {
    const ramp = [
      [0, 0, 0],
      [1, 0.5, 0],
      [1, 1, 1],
    ];
    expect(rampColor(ramp, 0)).toEqual([0, 0, 0]);
    expect(rampColor(ramp, 0.25)).toEqual([0.5, 0.25, 0]);
    expect(rampColor(ramp, 0.75)).toEqual([1, 0.75, 0.5]);
    expect(rampColor(ramp, 2)).toEqual([1, 1, 1]);
    expect(rampColor(ramp, -1)).toEqual([0, 0, 0]);
  });

  it('books without a ramp do not get the define', () => {
    const mat = createFlipbookMaterial(handle('fx_sparks_embers'));
    expect(patchedFragment(mat).defines.FLIP_RAMP).toBeUndefined();
    mat.dispose();
  });
});
