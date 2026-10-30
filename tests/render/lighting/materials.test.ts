/**
 * GFX-01 material chunks: preset-driven clearcoat / sheen / subsurface, foliage translucency, wetness + puddles,
 * ZoomLook detail fade, tier boosts and the per-instance LOD dither. OWNER: Graphics Developer - Lighting,
 * Atmosphere & Post (GFX-01).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createPbrMaterial, disposePbrMaterial } from '../../../src/render/materials/pbr';
import { BAYER4, lodFadeKeeps, installInstancedLodDither, createLodFadeAttribute } from '../../../src/render/materials/chunks/lodDither';
import { wetSurface, WETNESS } from '../../../src/render/materials/chunks/wetness';
import { installShaderGlobals } from '../../../src/render/materials/chunks/globals';
import '../../../src/render/materials/chunks/surface';

interface Shader {
  uniforms: Record<string, THREE.IUniform>;
  vertexShader: string;
  fragmentShader: string;
  defines?: Record<string, unknown>;
}

function compile(mat: THREE.Material): Shader {
  const lib = THREE.ShaderLib.physical;
  const shader: Shader = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, defines: {} };
  mat.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
  return shader;
}

describe('presets drive the physical features (ART_BIBLE §8)', () => {
  it('Mauryan polish gets clearcoat 0.6 / 0.12; silk gets sheen 0.9; plain stone stays MeshStandard', () => {
    const polish = createPbrMaterial({}, { name: 'sandstone_polished_mauryan' });
    expect(polish).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect((polish as THREE.MeshPhysicalMaterial).clearcoat).toBeCloseTo(0.6, 6);
    expect((polish as THREE.MeshPhysicalMaterial).clearcoatRoughness).toBeCloseTo(0.12, 6);
    const silk = createPbrMaterial({}, { name: 'silk_court' });
    expect((silk as THREE.MeshPhysicalMaterial).sheen).toBeCloseTo(0.9, 6);
    const plain = createPbrMaterial({}, { name: 'sandstone_buff' });
    expect(plain).not.toBeInstanceOf(THREE.MeshPhysicalMaterial);
    const off = createPbrMaterial({}, { name: 'sandstone_polished_mauryan', clearcoat: null });
    expect(off).not.toBeInstanceOf(THREE.MeshPhysicalMaterial);
    for (const m of [polish, silk, plain, off]) disposePbrMaterial(m);
  });

  it('skin gets the subsurface lobe; foliage reads leaf thickness from ORM.b and drops the metalness map', () => {
    const skin = createPbrMaterial({}, { name: 'skin' });
    const s = compile(skin);
    expect(s.defines?.SAM_SUBSURFACE).toBe('');
    expect(s.fragmentShader).toContain('#define RE_Direct RE_Direct_SamSubsurface');
    const orm = new THREE.Texture();
    const leaf = createPbrMaterial({ orm }, { name: 'leaf', foliage: true });
    expect(leaf.metalnessMap).toBeNull();
    expect(leaf.metalness).toBe(0);
    const l = compile(leaf);
    expect(l.defines?.SAM_FOLIAGE).toBe('');
    expect(l.fragmentShader).toContain('samThickness = texture2D( roughnessMap, vRoughnessMapUv ).b;');
    expect(skin.customProgramCacheKey()).not.toBe(leaf.customProgramCacheKey());
    for (const m of [skin, leaf]) disposePbrMaterial(m);
  });
});

describe('wetness, puddles, ZoomLook fade', () => {
  it('porous materials get wetness + puddles (world position varying); sealed ones wetness only', () => {
    const earth = compile(createPbrMaterial({}, { name: 'earth', porosity: 1 }));
    expect(earth.defines?.SAM_PUDDLES).toBe('');
    expect(earth.vertexShader).toContain('vSamWorldPos = ( modelMatrix * samWp ).xyz;');
    expect(earth.fragmentShader).toContain('samPuddleMask( vSamWorldPos.xz');
    const bronze = compile(createPbrMaterial({}, { name: 'bronze', porosity: 0.1 }));
    expect(bronze.defines?.SAM_PUDDLES).toBeUndefined();
    expect(bronze.fragmentShader).toContain('samApplyWetness( diffuseColor.rgb, roughnessFactor');
    // Detail normal fade and band-scaled specular AA read the shared globals.
    expect(bronze.fragmentShader).toContain('mix( normal, nonPerturbedNormal, clamp( samG[ SAM_G_MATERIAL_LOOK ].x');
    expect(bronze.fragmentShader).toContain('geometryRoughness * samG[ SAM_G_MATERIAL_LOOK ].w');
  });

  it('the CPU mirror darkens and glosses porous albedo (fully wet: x0.58, roughness toward 0.12)', () => {
    const dry = wetSurface(0.5, 0.8, 0);
    expect(dry).toEqual({ albedo: 0.5, roughness: 0.8 });
    const wet = wetSurface(0.5, 0.8, 1);
    expect(wet.albedo).toBeCloseTo(0.5 * WETNESS.albedo, 6);
    expect(wet.roughness).toBeCloseTo(0.8 + (0.12 - 0.8) * 0.85, 6);
  });
});

describe('global chunks (installed once)', () => {
  it('samG is declared at global scope in fragment shaders only; emissive and baked-AO boosts read it', () => {
    installShaderGlobals();
    expect(THREE.ShaderChunk.common).toContain('#ifdef gl_FragColor');
    expect(THREE.ShaderChunk.common).toContain('uniform vec4 samG[');
    expect(THREE.ShaderChunk.aomap_fragment).toContain('( 1.0 + samG[ SAM_G_MATERIAL_BOOST ].y )');
    expect(THREE.ShaderChunk.emissivemap_fragment).toContain('totalEmissiveRadiance *= 1.0 + samG[ SAM_G_MATERIAL_BOOST ].x;');
  });
});

describe('per-instance LOD dither', () => {
  it('an instance fading in (+f) and one fading out (-f; 1 at f = 0) cover every Bayer cell exactly once', () => {
    for (const f of [0, 0.1, 0.25, 0.5, 0.77, 0.99]) {
      for (const m of BAYER4) {
        const b = (m + 0.5) / 16;
        expect(Number(lodFadeKeeps(f, b)) + Number(lodFadeKeeps(f === 0 ? 1 : -f, b))).toBe(1);
      }
    }
    expect(BAYER4.every((m) => lodFadeKeeps(1, (m + 0.5) / 16))).toBe(true);
  });

  it('installInstancedLodDither chains onBeforeCompile and the cache key; the attribute starts solid', () => {
    const mat = new THREE.MeshStandardMaterial();
    installInstancedLodDither(mat);
    installInstancedLodDither(mat);
    const s = compile(mat);
    expect(s.defines?.SAM_LOD_FADE_INSTANCED).toBe('');
    expect(s.vertexShader).toContain('vSamLodFade = instanceLodFade;');
    expect(s.fragmentShader.match(/samBayer4\( gl_FragCoord\.xy \)/g)?.length).toBe(1);
    expect(mat.customProgramCacheKey()).toContain('samLodFadeI');
    const a = createLodFadeAttribute(4);
    expect(Array.from(a.array)).toEqual([1, 1, 1, 1]);
    mat.dispose();
  });
});
