import { describe, expect, it } from 'vitest';
import { angleDelta, approachAngle, dacos, dasin, datan, datan2, dcos, dexp, dlog, dpow, dsin, facingOf, forward, right, wrapAngle } from '../../src/core/math';

describe('deterministic math', () => {
  it('matches Math.* closely', () => {
    for (let x = -50; x <= 50; x += 0.137) {
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(1e-12);
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(1e-12);
      expect(Math.abs(datan(x) - Math.atan(x))).toBeLessThan(1e-12);
    }
    for (let y = -3; y <= 3; y += 0.31) for (let x = -3; x <= 3; x += 0.29) expect(Math.abs(datan2(y, x) - Math.atan2(y, x))).toBeLessThan(1e-12);
    for (let x = -30; x <= 30; x += 0.173) expect(Math.abs(dexp(x) / Math.exp(x) - 1)).toBeLessThan(1e-12);
    for (let x = 1e-6; x < 1e6; x *= 1.71) expect(Math.abs(dlog(x) - Math.log(x))).toBeLessThan(1e-11);
    expect(Math.abs(dpow(2.5, 3.3) - Math.pow(2.5, 3.3))).toBeLessThan(1e-10);
    expect(dpow(3, 4)).toBe(81);
    expect(Math.abs(dasin(0.3) - Math.asin(0.3))).toBeLessThan(1e-12);
    expect(Math.abs(dacos(-0.7) - Math.acos(-0.7))).toBeLessThan(1e-12);
  });

  it('handles edge values', () => {
    expect(dexp(0)).toBe(1);
    expect(dlog(1)).toBe(0);
    expect(dlog(0)).toBe(-Infinity);
    expect(Number.isNaN(dsin(Infinity))).toBe(true);
    expect(datan2(0, 0)).toBe(0);
  });

  it('follows the facing convention (0 = +Z, right of +Z is -X)', () => {
    const f = forward(0, { x: 0, z: 0 });
    expect(f.x).toBeCloseTo(0);
    expect(f.z).toBeCloseTo(1);
    const r = right(0, { x: 0, z: 0 });
    expect(r.x).toBeCloseTo(-1);
    expect(facingOf(1, 0)).toBeCloseTo(Math.PI / 2);
  });

  it('wraps and approaches angles', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6);
    expect(approachAngle(0, 1, 0.25)).toBeCloseTo(0.25);
  });
});
