/**
 * Seeded, serializable PRNG (sfc32). Owned by the CTO. Three-free, DOM-free, deterministic.
 *
 * - Authoritative sim state (world, battle) stores `RngState` so saves resume the exact sequence.
 * - Never use Math.random() in sim code. Cosmetic-only code (render/audio) may use `Rng` too.
 */
import type { RngState } from './types';
import { dcos, dlog, dsin } from './math';

const TWO_POW_32 = 4294967296;

/** splitmix32: expands one 32-bit seed into well-mixed words. */
function splitmix32(state: { s: number }): number {
  state.s = (state.s + 0x9e3779b9) | 0;
  let z = state.s;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  z ^= z >>> 16;
  return z >>> 0;
}

/** Hash an arbitrary string to a 32-bit seed (FNV-1a). */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Combine seeds deterministically (e.g. deriveSeed(worldSeed, 'battle', 3)). */
export function deriveSeed(seed: number, ...parts: (string | number)[]): number {
  let h = (seed >>> 0) ^ 0x5bd1e995;
  for (const p of parts) {
    const v = typeof p === 'number' ? p >>> 0 : hashString(p);
    h = Math.imul(h ^ v, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

export function rngStateFromSeed(seed: number): RngState {
  const st = { s: seed >>> 0 };
  const s: RngState = [splitmix32(st), splitmix32(st), splitmix32(st), splitmix32(st)];
  if ((s[0] | s[1] | s[2] | s[3]) === 0) s[0] = 1;
  // Warm up.
  const r = new Rng(s);
  for (let i = 0; i < 12; i++) r.nextU32();
  return r.getState();
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  /** Create from a seed number or a saved state. */
  constructor(seedOrState: number | RngState) {
    const s = typeof seedOrState === 'number' ? rngStateFromSeed(seedOrState) : seedOrState;
    this.a = s[0] >>> 0;
    this.b = s[1] >>> 0;
    this.c = s[2] >>> 0;
    this.d = s[3] >>> 0;
  }

  static fromState(state: RngState): Rng {
    return new Rng(state);
  }

  getState(): RngState {
    return [this.a >>> 0, this.b >>> 0, this.c >>> 0, this.d >>> 0];
  }

  /** Write state into an existing array (no allocation) - use to persist into BattleState.rng. */
  saveTo(out: RngState): RngState {
    out[0] = this.a >>> 0;
    out[1] = this.b >>> 0;
    out[2] = this.c >>> 0;
    out[3] = this.d >>> 0;
    return out;
  }

  setState(s: RngState): void {
    this.a = s[0] >>> 0;
    this.b = s[1] >>> 0;
    this.c = s[2] >>> 0;
    this.d = s[3] >>> 0;
  }

  /** Uniform unsigned 32-bit integer. */
  nextU32(): number {
    let a = this.a | 0;
    let b = this.b | 0;
    let c = this.c | 0;
    let d = this.d | 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    return t >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextU32() / TWO_POW_32;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Uniform integer in [min, maxInclusive]. */
  int(min: number, maxInclusive: number): number {
    return min + Math.floor(this.next() * (maxInclusive - min + 1));
  }

  /** true with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** -1 or +1 */
  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('Rng.pick on empty array');
    return arr[Math.floor(this.next() * arr.length)] as T;
  }

  /** Weighted pick; weights must be >= 0 with a positive sum. Returns an index. */
  weightedIndex(weights: readonly number[]): number {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) sum += weights[i] as number;
    if (sum <= 0) return 0;
    let r = this.next() * sum;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i] as number;
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  /** In-place Fisher-Yates shuffle. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = arr[i] as T;
      arr[i] = arr[j] as T;
      arr[j] = tmp;
    }
    return arr;
  }

  /** Standard normal via Box-Muller using deterministic math (dlog/dsin/dcos). */
  normal(mean = 0, stdDev = 1): number {
    let u = this.next();
    if (u < 1e-12) u = 1e-12;
    const v = this.next();
    const r = Math.sqrt(-2 * dlog(u));
    return mean + stdDev * r * dcos(6.283185307179586 * v);
  }

  /** Random point in a disc of radius r (uniform). */
  inDisc(r: number, out: { x: number; z: number }): { x: number; z: number } {
    const a = this.next() * 6.283185307179586;
    const d = Math.sqrt(this.next()) * r;
    out.x = dcos(a) * d;
    out.z = dsin(a) * d;
    return out;
  }

  /** Independent child generator (e.g. per-settlement layout) without disturbing this stream. */
  fork(label: string | number): Rng {
    return new Rng(deriveSeed(this.nextU32(), label));
  }
}
