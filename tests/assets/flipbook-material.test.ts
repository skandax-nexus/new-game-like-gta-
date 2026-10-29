/**
 * Flipbook reference material blending (TA-07 rework round 1). OWNER: Technical Artist G (TA-07).
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
import { createFlipbookMaterial, type FlipbookHandle } from '../../src/assets/loaders/flipbook';
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
function patchedFragment(mat: THREE.Material): { fragment: string; defines: Record<string, unknown> } {
  const shader = {
    uniforms: {},
    defines: {} as Record<string, unknown>,
    vertexShader: '#include <common>\nvoid main() {}',
    fragmentShader: '#include <common>\nvoid main() {\n#include <map_fragment>\n#include <normal_fragment_maps>\n}',
  };
  // cast: three's onBeforeCompile takes WebGLProgramParametersWithUniforms; the patch only touches the fields above
  mat.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  return { fragment: shader.fragmentShader, defines: shader.defines };
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
