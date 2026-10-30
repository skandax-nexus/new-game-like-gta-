/**
 * GFX-01 renderer helpers: the dynamic-resolution controller. OWNER: Graphics Developer - Lighting, Atmosphere &
 * Post (GFX-01).
 */
import { describe, expect, it } from 'vitest';
import { dynamicResolutionStep, DYNRES_QUANTUM } from '../../../src/render/renderer';

describe('dynamic resolution', () => {
  it('holds inside the dead band, drops when over budget, recovers when under, in 0.05 steps within [min, max]', () => {
    const budget = 1000 / 60;
    expect(dynamicResolutionStep(1, budget, budget, 0.6, 1)).toBe(1);
    expect(dynamicResolutionStep(1, budget * 1.1, budget, 0.6, 1)).toBe(1);
    const down = dynamicResolutionStep(1, budget * 1.6, budget, 0.6, 1);
    expect(down).toBeLessThan(1);
    expect(down).toBeGreaterThanOrEqual(0.9 - 1e-9);
    expect(Math.abs(down / DYNRES_QUANTUM - Math.round(down / DYNRES_QUANTUM))).toBeLessThan(1e-9);
    expect(dynamicResolutionStep(0.7, budget * 0.5, budget, 0.6, 1)).toBeCloseTo(0.8, 9);
    expect(dynamicResolutionStep(0.6, budget * 4, budget, 0.6, 1)).toBe(0.6);
    expect(dynamicResolutionStep(1, budget * 0.3, budget, 0.6, 1)).toBe(1);
  });

  it('converges: a GPU-bound frame (cost ~ pixels) settles inside the dead band', () => {
    const budget = 1000 / 30;
    let s = 1;
    const frameAt = (scale: number): number => 52 * scale * scale; // 52 ms at native
    for (let i = 0; i < 12; i++) s = dynamicResolutionStep(s, frameAt(s), budget, 0.5, 1);
    const load = frameAt(s) / budget;
    expect(load).toBeLessThanOrEqual(1.15);
    expect(load).toBeGreaterThan(0.75);
  });
});
