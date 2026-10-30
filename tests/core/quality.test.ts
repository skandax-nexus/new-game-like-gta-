import { describe, expect, it } from 'vitest';
import { buildQualitySettings, detectTier, lowerTier, type DetectionInput } from '../../src/core/quality';

const base: DetectionInput = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130',
  maxTouchPoints: 0,
  coarsePointer: false,
  deviceMemoryGb: 16,
  cores: 12,
  gpuRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11)',
  gpuVendor: 'Google Inc. (NVIDIA)',
  webgl2: true,
  maxTextureSize: 16384,
  screenMinSide: 1080,
};

describe('quality detection', () => {
  it('rates a desktop RTX as ultra', () => {
    expect(detectTier(base).tier).toBe('ultra');
  });
  it('rates software rendering as low', () => {
    const d = detectTier({ ...base, gpuRenderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))' });
    expect(d.tier).toBe('low');
    expect(d.softwareRenderer).toBe(true);
  });
  it('rates a modern phone as medium and an old phone as low', () => {
    const phone = { ...base, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile', maxTouchPoints: 5, coarsePointer: true, deviceMemoryGb: 8, cores: 8 };
    expect(detectTier({ ...phone, gpuRenderer: 'Adreno (TM) 740' }).tier).toBe('medium');
    expect(detectTier({ ...phone, gpuRenderer: 'Mali-T720', deviceMemoryGb: 2 }).tier).toBe('low');
    expect(detectTier({ ...phone, gpuRenderer: 'Adreno (TM) 740' }).isMobile).toBe(true);
  });
  it('treats iPadOS desktop UA with touch as mobile', () => {
    const d = detectTier({ ...base, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605', maxTouchPoints: 5, gpuRenderer: 'Apple GPU' });
    expect(d.isMobile).toBe(true);
  });
  it('builds settings with overrides and steps tiers down', () => {
    const s = buildQualitySettings('high', { shadows: { enabled: false, mapSize: 1024, cascades: 1, distance: 100, soft: false, contact: false, pcss: false } });
    expect(s.tier).toBe('high');
    expect(s.shadows.enabled).toBe(false);
    expect(s.ao).toBe('gtao');
    expect(lowerTier('ultra')).toBe('high');
    expect(lowerTier('low')).toBe('low');
  });
});

describe('ART_BIBLE §13 tier table (GFX-01)', () => {
  const tiers = ['low', 'medium', 'high', 'ultra'] as const;
  const q = tiers.map((t) => buildQualitySettings(t));
  const col = <T>(f: (s: ReturnType<typeof buildQualitySettings>) => T): T[] => q.map(f);

  it('shadows: 1024 x1 hard, 2048 x2 PCF, 4096 x3 PCSS, 4096 x4 PCSS + contact', () => {
    expect(col((s) => [s.shadows.mapSize, s.shadows.cascades, s.shadows.soft, s.shadows.pcss, s.shadows.contact])).toEqual([
      [1024, 1, false, false, false],
      [2048, 2, true, false, false],
      [4096, 3, true, true, false],
      [4096, 4, true, true, true],
    ]);
  });

  it('AO baked / baked / GTAO half / GTAO full; fog exp2 / height / height + mist; shafts off / 24 / 32 / 48 (full res on ultra)', () => {
    expect(col((s) => [s.ao, s.aoHalfRes])).toEqual([
      ['off', true],
      ['off', true],
      ['gtao', true],
      ['gtao', false],
    ]);
    expect(col((s) => s.heightFog)).toEqual(['exp2', 'height', 'height_mist', 'height_mist']);
    expect(col((s) => [s.shaftsSamples, s.shaftsHalfRes])).toEqual([
      [0, true],
      [24, true],
      [32, true],
      [48, false],
    ]);
  });

  it('bloom off (emissive x1.3, baked AO x1.2) / on / on / on + lens dirt; reflections env / env / planar / SSR + planar', () => {
    expect(col((s) => [s.bloom, s.lensEffects, s.emissiveBoost, s.bakedAoBoost])).toEqual([
      [false, false, 1.3, 1.2],
      [true, false, 1, 1],
      [true, false, 1, 1],
      [true, true, 1, 1],
    ]);
    expect(col((s) => [s.water.reflections, s.ssr])).toEqual([
      ['envmap', false],
      ['envmap', false],
      ['planar', false],
      ['planar', true],
    ]);
  });

  it('DoF / grain / CA off / off / hero / close bands; post merged / FXAA / SMAA / SMAA + TAA in hero', () => {
    expect(col((s) => s.dof)).toEqual(['off', 'off', 'hero', 'close']);
    expect(col((s) => [s.postMerged, s.antialias])).toEqual([
      [true, 'fxaa'],
      [false, 'fxaa'],
      [false, 'smaa'],
      [false, 'taa'],
    ]);
  });

  it('grass 0 / 18 / 40 / 70, tree impostors 90 / 160 / 220 / 300 m, particles, practical lights 1 / 4 / 8 / 16', () => {
    expect(col((s) => s.grassDensity)).toEqual([0, 18, 40, 70]);
    expect(col((s) => s.treeImpostorDistance)).toEqual([90, 160, 220, 300]);
    expect(col((s) => [s.particles, s.weatherParticles])).toEqual([
      [400, 1500],
      [1200, 4000],
      [3000, 9000],
      [6000, 16000],
    ]);
    expect(col((s) => s.practicalLights)).toEqual([1, 4, 8, 16]);
  });

  it('never changes across tiers: grading and vignette stay on (palette / grade / LUT / fog colours are tier-independent)', () => {
    expect(col((s) => [s.colorGrading, s.vignette, s.fog])).toEqual(tiers.map(() => [true, true, true]));
  });
});
