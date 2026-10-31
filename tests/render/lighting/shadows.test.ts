/**
 * GFX-01 cascaded sun shadows (ART_BIBLE §13) and the global shadow chunk. OWNER: Graphics Developer - Lighting,
 * Atmosphere & Post (GFX-01).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildQualitySettings } from '../../../src/core/quality';
import { activeCascadesFor, DEPTH_BIAS_TEXELS, NORMAL_BIAS_TEXELS, SLOPE_BIAS_TEXELS, CascadedShadows, cascadeCountFor, cascadeMapSize, practicalSplits, shadowDistanceFor, shadowFilterFor, shadowMapBytes, CSM_BLEND } from '../../../src/render/lighting/csm';
import { CSM_PARS_GLSL } from '../../../src/render/lighting/shadowChunks';
import { DIR_SHADOW_LINE, cascadeChunksInstalled } from '../../../src/render/lighting/shadowChunks';
import { installShaderGlobals, G, g } from '../../../src/render/materials/chunks/globals';
import { createZoomLook, resolveZoomLook, capZoomLook } from '../../../src/render/style/zoom';
import { FLIP_CHUNK_HOOKS } from '../../../src/assets/loaders/flipbook';

describe('tiers (ART_BIBLE §13)', () => {
  it('cascades 1 / 2 / 3 / 4, filters hard / PCF / PCSS / PCSS, contact shadows on ultra only', () => {
    const tiers = ['low', 'medium', 'high', 'ultra'] as const;
    expect(tiers.map((t) => cascadeCountFor(buildQualitySettings(t)))).toEqual([1, 2, 3, 4]);
    expect(tiers.map((t) => shadowFilterFor(buildQualitySettings(t)))).toEqual(['hard', 'pcf', 'pcss', 'pcss']);
    expect(tiers.map((t) => buildQualitySettings(t).shadows.contact)).toEqual([false, false, false, true]);
    expect(tiers.map((t) => buildQualitySettings(t).shadows.mapSize)).toEqual([1024, 2048, 4096, 4096]);
    // Bands only scale down: contact shadows survive capZoomLook on ultra only.
    for (const t of tiers) expect(capZoomLook(resolveZoomLook(20, createZoomLook()), t).shadows.contact).toBe(t === 'ultra');
  });

  it('CascadedShadows builds one shadowed light per cascade and rebuilds on tier change (old maps disposed)', () => {
    const csm = new CascadedShadows(buildQualitySettings('ultra'));
    csm.maxCascades = 4;
    csm.rebuild();
    expect(csm.lights.length).toBe(4);
    expect(csm.lights.every((l) => l.castShadow)).toBe(true);
    expect(csm.lights[0]!.name).toBe('sun');
    csm.setQuality(buildQualitySettings('low'));
    expect(csm.lights.length).toBe(1);
    expect(csm.lights[0]!.shadow.mapSize.x).toBe(1024);
    csm.dispose();
  });
});

describe('shadow-map memory (review: ARCHITECTURE §15 texture + RT budget)', () => {
  it('cascade 0 keeps the tier map size; with 3+ cascades the outer ones are half size', () => {
    const sizes = (t: 'low' | 'medium' | 'high' | 'ultra'): number[] => {
      const q = buildQualitySettings(t);
      return Array.from({ length: cascadeCountFor(q) }, (_, i) => cascadeMapSize(q, i));
    };
    expect(sizes('low')).toEqual([1024]);
    expect(sizes('medium')).toEqual([2048, 2048]);
    expect(sizes('high')).toEqual([4096, 2048, 2048]);
    expect(sizes('ultra')).toEqual([4096, 2048, 2048, 2048]);
    const csm = new CascadedShadows(buildQualitySettings('high'));
    expect(csm.lights.map((l) => l.shadow.mapSize.x)).toEqual([4096, 2048, 2048]);
    csm.dispose();
  });

  it('high never allocates more shadow memory than ultra and stays under a third of the PC-high budget', () => {
    const mb = (t: 'low' | 'medium' | 'high' | 'ultra'): number => shadowMapBytes(buildQualitySettings(t)) / (1024 * 1024);
    expect(mb('low')).toBeLessThan(mb('medium'));
    expect(mb('medium')).toBeLessThan(mb('high'));
    expect(mb('high')).toBeLessThanOrEqual(mb('ultra'));
    expect(mb('high')).toBeLessThan(600 / 3);
    expect(mb('medium')).toBeLessThan(250 / 3);
  });
});

describe('splits and fitting', () => {
  it('practical splits run near -> far, uniform at lambda 0 and logarithmic at 1', () => {
    const s = practicalSplits(1, 1000, 4, 0, new Float32Array(5));
    expect(Array.from(s)).toEqual([1, 250.75, 500.5, 750.25, 1000].map((v) => expect.closeTo(v, 3)));
    const l = practicalSplits(1, 1000, 3, 1, new Float32Array(4));
    expect(Array.from(l)).toEqual([1, 10, 100, 1000].map((v) => expect.closeTo(v, 3)));
    const m = practicalSplits(0.5, 420, 3, 0.75, new Float32Array(4));
    for (let i = 1; i < 4; i++) expect(m[i]!).toBeGreaterThan(m[i - 1]!);
  });

  it('the shadow distance follows the zoom band and always covers the focus', () => {
    const q = buildQualitySettings('high');
    const strategic = resolveZoomLook(2600, createZoomLook());
    expect(shadowDistanceFor(strategic, q, 2600, 20000)).toBeGreaterThanOrEqual(2600 * 1.25);
    const tactical = resolveZoomLook(220, createZoomLook());
    expect(shadowDistanceFor(tactical, q, 220, 12000)).toBeCloseTo(420, 0);
    const lowQ = buildQualitySettings('low');
    expect(shadowDistanceFor(tactical, lowQ, 220, 12000)).toBeLessThan(shadowDistanceFor(tactical, q, 220, 12000));
  });

  it('texel snapping: sub-texel camera moves keep every cascade on the same texel grid; rotation keeps sizes', () => {
    const q = buildQualitySettings('high');
    const csm = new CascadedShadows(q);
    csm.maxCascades = 4;
    csm.rebuild();
    const cam = new THREE.PerspectiveCamera(42, 16 / 9, 0.5, 12000);
    const look = resolveZoomLook(220, createZoomLook());
    const toLight = new THREE.Vector3(0.3, 0.8, 0.5).normalize();
    const place = (x: number, yaw: number): void => {
      cam.position.set(x + Math.sin(yaw) * 150, 160, Math.cos(yaw) * 150);
      cam.lookAt(x, 0, 0);
      cam.updateMatrixWorld();
      csm.update(cam, toLight, look, 220);
    };
    place(0, 0);
    const radii = csm.info.radii.slice(0, csm.cascadeCount);
    // Light-space x of every cascade target must be a multiple of its texel.
    const axisX = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), toLight).normalize();
    for (let i = 0; i < csm.cascadeCount; i++) {
      const t = csm.lights[i]!.target.position.dot(axisX) / csm.info.texels[i]!;
      expect(Math.abs(t - Math.round(t))).toBeLessThan(1e-3);
    }
    place(0, 1.1);
    expect(csm.info.radii.slice(0, csm.cascadeCount)).toEqual(radii);
    // Cascade table in the shader globals: monotonic, overlapping by the blend band.
    const c0 = g(G.CSM_CASCADE);
    const c1 = g(G.CSM_CASCADE + 1);
    expect(c1.x).toBeLessThan(c0.y);
    expect(c0.y - c1.x).toBeCloseTo(CSM_BLEND * (c0.y - c0.x), 3);
    expect(g(G.CSM_PARAMS).x).toBe(3);
    expect(g(G.CSM_PARAMS).y).toBe(2);
    csm.dispose();
  });
});

describe('far zoom bands use fewer cascades (review: ARCHITECTURE §15 world < 300 draw calls)', () => {
  it('strategic 1, operational 2, tactical and closer the tier count', () => {
    const at = (d: number) => resolveZoomLook(d, createZoomLook());
    expect([1, 2, 3, 4].map((n) => activeCascadesFor(n, at(2600)))).toEqual([1, 1, 1, 1]);
    expect([1, 2, 3, 4].map((n) => activeCascadesFor(n, at(700)))).toEqual([1, 2, 2, 2]);
    for (const d of [220, 45, 4.5]) expect([1, 2, 3, 4].map((n) => activeCascadesFor(n, at(d)))).toEqual([1, 2, 3, 4]);
  });

  it('idle cascades keep their light (no recompile) but are weighted 0 and skip their shadow render', () => {
    const csm = new CascadedShadows(buildQualitySettings('ultra'));
    csm.maxCascades = 4;
    csm.rebuild();
    const cam = new THREE.PerspectiveCamera(42, 16 / 9, 0.5, 20000);
    const toLight = new THREE.Vector3(0.3, 0.8, 0.5).normalize();
    const view = (d: number): void => {
      cam.position.set(0, d * 0.75, d * 0.66);
      cam.lookAt(0, 0, 0);
      cam.updateMatrixWorld();
      csm.update(cam, toLight, resolveZoomLook(d, createZoomLook()), d);
    };
    view(2600);
    expect(csm.lights.length).toBe(4);
    expect(csm.activeCascadeCount).toBe(1);
    expect(csm.lights.map((l) => l.shadow.autoUpdate)).toEqual([true, false, false, false]);
    expect(g(G.CSM_PARAMS).x).toBe(4);
    expect(g(G.CSM_CASCADE).z).toBeGreaterThan(0);
    for (let i = 1; i < 4; i++) expect(g(G.CSM_CASCADE + i).z).toBe(0);
    // The one cascade in use covers the whole shadow distance.
    expect(g(G.CSM_CASCADE).y).toBeCloseTo(csm.info.distance, 3);
    view(700);
    expect(csm.activeCascadeCount).toBe(2);
    expect(csm.lights.map((l) => l.shadow.autoUpdate)).toEqual([true, true, false, false]);
    expect(g(G.CSM_CASCADE + 1).y).toBeCloseTo(csm.info.distance, 3);
    // Back to tactical: every cascade re-renders again.
    view(220);
    expect(csm.activeCascadeCount).toBe(4);
    expect(csm.lights.every((l) => l.shadow.autoUpdate)).toBe(true);
    for (let i = 0; i < 4; i++) expect(g(G.CSM_CASCADE + i).z).toBeGreaterThan(0);
    csm.dispose();
  });

  it('the shader gives idle cascades no light and fades out at the last cascade in use', () => {
    expect(CSM_PARS_GLSL).toContain('if ( c.z <= 0.0 ) return vec3( 0.0 );');
    expect(CSM_PARS_GLSL).toContain('samG[ SAM_G_CSM_CASCADE + i + 1 ].z <= 0.0');
    expect(CSM_PARS_GLSL).toContain('if ( samCsmLast( i ) ) {');
  });
});

describe('low tier: no acne, no saw-tooth (AD round 1, blocker 2)', () => {
  it('the hard filter is a fixed tent of bilinear compares with a slope-scaled bias, not an unfiltered compare', () => {
    // Nine bilinear compares folded into one 4x4 fetch, weights (1 - f, 1, 1, f) per axis, normalised by 9.
    expect(CSM_PARS_GLSL).toContain('float samShadowTent( sampler2D map, vec2 size, float bias, vec4 coord )');
    expect(CSM_PARS_GLSL).toContain('vec4 wx = vec4( 1.0 - f.x, 1.0, 1.0, f.x );');
    expect(CSM_PARS_GLSL).toContain('return sum / 9.0;');
    // Hard filter (CSM_PARAMS.y = 0) -> tent with slope bias; PCF / PCSS unchanged.
    expect(CSM_PARS_GLSL).toContain('if ( prm.y < 0.5 ) {');
    expect(CSM_PARS_GLSL).toMatch(/sh = samShadowTentSoft\( map, s\.shadowMapSize, s\.shadowBias, [0-9.]+ \* tanT \* c\.z/);
    // Round 2 (R2-2): blocker-distance footprint - 8 search taps, lattice step from the penumbra radius, wider tent.
    expect(CSM_PARS_GLSL).toContain('float samShadowTentS( sampler2D map, vec2 size, float z, vec2 uv, float s, inout vec2 blk )');
    expect(CSM_PARS_GLSL).toContain('float s = clamp( dist * softTan / texelM / 1.5, 1.0, 8.0 );');
    expect(CSM_PARS_GLSL).toContain('if ( s <= 1.001 ) return sh;');
    expect(SLOPE_BIAS_TEXELS).toBeGreaterThan(0);
  });

  it('the single low cascade gets >= 2 texels of normal bias and a larger depth bias than the filtered tiers', () => {
    expect(NORMAL_BIAS_TEXELS.hard).toBeGreaterThanOrEqual(2);
    expect(DEPTH_BIAS_TEXELS.hard).toBeGreaterThan(DEPTH_BIAS_TEXELS.pcf);
    const csm = new CascadedShadows(buildQualitySettings('low'));
    const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 3000);
    cam.position.set(0, 2.2, 5);
    cam.lookAt(0, 1.5, 0);
    cam.updateMatrixWorld();
    const look = resolveZoomLook(4.5, createZoomLook());
    csm.update(cam, new THREE.Vector3(0.3, 0.8, 0.2).normalize(), look, 4.5);
    const texel = csm.info.texels[0]!;
    expect(csm.lights[0]!.shadow.normalBias).toBeCloseTo(texel * NORMAL_BIAS_TEXELS.hard, 9);
    // Fitted to the hero band: the far split is pulled in to 30 m on low (AD round 2, R2-2; was ~45 m).
    expect(csm.info.distance).toBeGreaterThan(25);
    expect(csm.info.distance).toBeLessThanOrEqual(30);
    csm.dispose();
  });
});

describe('global shadow chunk', () => {
  it('replaces only the directional shadow line and keeps the flipbook hook strings (TA-07)', () => {
    installShaderGlobals();
    expect(cascadeChunksInstalled()).toBe(true);
    const begin = THREE.ShaderChunk.lights_fragment_begin;
    expect(begin.includes(DIR_SHADOW_LINE)).toBe(false);
    expect(begin).toContain('samDirShadow( UNROLLED_LOOP_INDEX');
    expect(begin).toContain('dot( geometryNormal, directLight.direction ) );');
    expect(begin).toContain(FLIP_CHUNK_HOOKS.probe);
    expect(begin).toContain(FLIP_CHUNK_HOOKS.hemi);
    expect(THREE.ShaderChunk.lights_physical_pars_fragment).toContain(FLIP_CHUNK_HOOKS.directDotNL);
    const pars = THREE.ShaderChunk.shadowmap_pars_fragment;
    expect(pars).toContain('samShadowPCSS');
    // Inserted inside the USE_SHADOWMAP block, after three's own getShadow().
    expect(pars.indexOf('samShadowPCSS')).toBeGreaterThan(pars.indexOf('float getShadow('));
    expect(pars.includes('vViewPosition')).toBe(false);
  });
});
