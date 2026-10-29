/**
 * Synth core: seeded RNG for sound variation, unit conversions and small math helpers.
 * OWNER: Audio Developer (AUD-01).
 *
 * Everything under `src/audio/synth/**`, `sfx/render*`, `ambience/render*` and `music/**` is PURE DSP over
 * numbers and Float32Array: no WebAudio, no DOM, no three. The same code runs in node (tests,
 * scripts/audio/render.mjs) and inside the audio Web Worker; the WebAudio adapters live in `runtime/`.
 */

export const TAU = Math.PI * 2;
/** Smallest normal float32. Anything smaller (but non-zero) is a denormal. */
export const FLT_MIN = 1.1754943508222875e-38;

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function gainToDb(g: number): number {
  const a = Math.abs(g);
  return a <= 1e-12 ? -240 : 20 * Math.log10(a);
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function centsToRatio(cents: number): number {
  return Math.pow(2, cents / 1200);
}

export function semitonesToRatio(st: number): number {
  return Math.pow(2, st / 12);
}

/** Per-sample multiplier that decays 60 dB in `t60` seconds. */
export function decayCoef(t60: number, sr: number): number {
  return t60 <= 0 ? 0 : Math.pow(10, -3 / (t60 * sr));
}

/** FNV-1a + avalanche over strings / numbers: stable seeds for named sounds and variants. */
export function hashSeed(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    const s = typeof p === 'number' ? `#${p}` : p;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0xff;
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * sfc32 PRNG (fast, 128-bit state). Cosmetic audio randomness only - the simulation uses core/rng.
 * Deterministic for a given seed, so offline renders, tests and the runtime agree.
 */
export class Rand {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private spare = 0;
  private hasSpare = false;

  constructor(seed: number) {
    this.a = 0x9e3779b9 ^ seed;
    this.b = 0x243f6a88 + seed;
    this.c = 0xb7e15162 ^ Math.imul(seed, 0x85ebca6b);
    this.d = 1;
    for (let i = 0; i < 12; i++) this.u32();
  }

  /** Raw 32-bit unsigned value. */
  u32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform [0, 1). */
  next(): number {
    return this.u32() / 4294967296;
  }

  /** Uniform [-1, 1). */
  bi(): number {
    return this.u32() / 2147483648 - 1;
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)] as T;
  }

  /** Pick an index with the given (non-negative) weights. */
  weighted(weights: readonly number[]): number {
    let sum = 0;
    for (const w of weights) sum += w;
    let r = this.next() * sum;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i] as number;
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Standard normal (Box-Muller, cached pair). */
  gauss(): number {
    if (this.hasSpare) {
      this.hasSpare = false;
      return this.spare;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = this.bi();
      v = this.bi();
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    this.spare = v * m;
    this.hasSpare = true;
    return u * m;
  }

  /** x scaled by a random factor in [1 - frac, 1 + frac]. */
  jitter(x: number, frac: number): number {
    return x * (1 + this.bi() * frac);
  }

  /** Exponential inter-arrival time for a Poisson process with `ratePerSec`. */
  expo(ratePerSec: number): number {
    return -Math.log(1 - this.next()) / Math.max(1e-9, ratePerSec);
  }

  /** Independent child generator (stable for a given parent state + tag). */
  fork(tag: string | number): Rand {
    return new Rand(hashSeed(this.u32(), tag));
  }
}
