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
    const s = buildQualitySettings('high', { shadows: { enabled: false, mapSize: 1024, cascades: 1, distance: 100, soft: false } });
    expect(s.tier).toBe('high');
    expect(s.shadows.enabled).toBe(false);
    expect(s.ao).toBe('gtao');
    expect(lowerTier('ultra')).toBe('high');
    expect(lowerTier('low')).toBe('low');
  });
});
