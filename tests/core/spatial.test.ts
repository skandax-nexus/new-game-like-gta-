import { describe, expect, it } from 'vitest';
import { SpatialHash2D } from '../../src/core/spatial';
import { Rng } from '../../src/core/rng';

describe('SpatialHash2D', () => {
  it('matches brute force radius queries', () => {
    const n = 3000;
    const xs = new Float32Array(n);
    const zs = new Float32Array(n);
    const alive = new Uint8Array(n);
    const r = new Rng(3);
    for (let i = 0; i < n; i++) {
      xs[i] = r.range(-500, 500);
      zs[i] = r.range(-500, 500);
      alive[i] = r.chance(0.9) ? 1 : 0;
    }
    const h = new SpatialHash2D({ minX: -512, minZ: -512, maxX: 512, maxZ: 512 }, 8, n);
    h.build(n, xs, zs, alive);
    const out = new Int32Array(n);
    for (let q = 0; q < 50; q++) {
      const qx = r.range(-500, 500);
      const qz = r.range(-500, 500);
      const rad = r.range(2, 40);
      const got = [...out.subarray(0, h.queryRadius(qx, qz, rad, out, xs, zs))].sort((a, b) => a - b);
      const want: number[] = [];
      for (let i = 0; i < n; i++) if (alive[i] && (xs[i]! - qx) ** 2 + (zs[i]! - qz) ** 2 <= rad * rad) want.push(i);
      expect(got).toEqual(want);
    }
    const near = h.nearest(0, 0, 100, xs, zs);
    let best = -1;
    let bd = 100 * 100;
    for (let i = 0; i < n; i++) {
      const d = xs[i]! ** 2 + zs[i]! ** 2;
      if (alive[i] && d < bd) {
        bd = d;
        best = i;
      }
    }
    expect(near).toBe(best);
  });
});
