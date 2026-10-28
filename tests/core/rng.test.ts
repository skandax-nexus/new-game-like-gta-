import { describe, expect, it } from 'vitest';
import { Rng, deriveSeed, hashString, rngStateFromSeed } from '../../src/core/rng';

describe('Rng (sfc32)', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 1000; i++) expect(a.nextU32()).toBe(b.nextU32());
  });

  it('produces a known sequence (cross-platform regression guard)', () => {
    const r = new Rng(12345);
    const seq = Array.from({ length: 5 }, () => r.nextU32());
    // If this changes, every save/replay breaks: bump SAVE_VERSION and add a migration.
    expect(seq).toEqual([2345461488, 1344865159, 2974739204, 3448212715, 1746298622]);
  });

  it('resumes exactly from a saved state', () => {
    const a = new Rng(7);
    for (let i = 0; i < 37; i++) a.next();
    const st = a.getState();
    const b = Rng.fromState(st);
    for (let i = 0; i < 100; i++) expect(b.next()).toBe(a.next());
    const out: [number, number, number, number] = [0, 0, 0, 0];
    a.saveTo(out);
    expect(out).toEqual(a.getState());
  });

  it('differs between seeds and derived seeds', () => {
    expect(new Rng(1).nextU32()).not.toBe(new Rng(2).nextU32());
    expect(deriveSeed(1, 'a')).not.toBe(deriveSeed(1, 'b'));
    expect(deriveSeed(1, 'a', 3)).toBe(deriveSeed(1, 'a', 3));
    expect(hashString('samrajya')).toBe(hashString('samrajya'));
    expect(rngStateFromSeed(9)).toEqual(rngStateFromSeed(9));
  });

  it('has sane distributions', () => {
    const r = new Rng(99);
    let sum = 0;
    let min = 1;
    let max = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const v = r.next();
      sum += v;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(sum / n).toBeGreaterThan(0.48);
    expect(sum / n).toBeLessThan(0.52);
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
    const ints = new Set(Array.from({ length: 500 }, () => r.int(1, 6)));
    expect([...ints].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    let nsum = 0;
    for (let i = 0; i < 5000; i++) nsum += r.normal();
    expect(Math.abs(nsum / 5000)).toBeLessThan(0.06);
  });

  it('shuffles and picks deterministically', () => {
    const a = new Rng(5).shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    const b = new Rng(5).shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(a).toEqual(b);
    expect(new Rng(3).weightedIndex([0, 0, 1])).toBe(2);
  });
});
