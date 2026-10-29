/**
 * Filters: RBJ biquads (TDF-II), Cytomic TPT state-variable filter (stable under fast modulation),
 * one-poles, DC blocker, formant resonator. Per-sample `process(x)` + whole-buffer helpers.
 * OWNER: Audio Developer (AUD-01). Pure DSP (see synth/core.ts).
 */
import { clamp } from './core';

export type BiquadType = 'lowpass' | 'highpass' | 'bandpass' | 'notch' | 'peak' | 'lowshelf' | 'highshelf' | 'allpass';

/** Transposed direct form II biquad with RBJ cookbook designs. */
export class Biquad {
  b0 = 1;
  b1 = 0;
  b2 = 0;
  a1 = 0;
  a2 = 0;
  private z1 = 0;
  private z2 = 0;

  constructor(type?: BiquadType, f?: number, q?: number, sr?: number, gainDb = 0) {
    if (type && f && q && sr) this.set(type, f, q, sr, gainDb);
  }

  set(type: BiquadType, f: number, q: number, sr: number, gainDb = 0): this {
    const fc = clamp(f, 5, sr * 0.49);
    const w0 = (2 * Math.PI * fc) / sr;
    const cw = Math.cos(w0);
    const sw = Math.sin(w0);
    const Q = Math.max(0.05, q);
    const alpha = sw / (2 * Q);
    const A = Math.pow(10, gainDb / 40);
    let b0 = 1;
    let b1 = 0;
    let b2 = 0;
    let a0 = 1;
    let a1 = 0;
    let a2 = 0;
    switch (type) {
      case 'lowpass':
        b0 = (1 - cw) / 2;
        b1 = 1 - cw;
        b2 = (1 - cw) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
      case 'highpass':
        b0 = (1 + cw) / 2;
        b1 = -(1 + cw);
        b2 = (1 + cw) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
      case 'bandpass':
        b0 = alpha;
        b1 = 0;
        b2 = -alpha;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
      case 'notch':
        b0 = 1;
        b1 = -2 * cw;
        b2 = 1;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
      case 'peak':
        b0 = 1 + alpha * A;
        b1 = -2 * cw;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cw;
        a2 = 1 - alpha / A;
        break;
      case 'lowshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 - (A - 1) * cw + s);
        b1 = 2 * A * (A - 1 - (A + 1) * cw);
        b2 = A * (A + 1 - (A - 1) * cw - s);
        a0 = A + 1 + (A - 1) * cw + s;
        a1 = -2 * (A - 1 + (A + 1) * cw);
        a2 = A + 1 + (A - 1) * cw - s;
        break;
      }
      case 'highshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 + (A - 1) * cw + s);
        b1 = -2 * A * (A - 1 + (A + 1) * cw);
        b2 = A * (A + 1 + (A - 1) * cw - s);
        a0 = A + 1 - (A - 1) * cw + s;
        a1 = 2 * (A - 1 - (A + 1) * cw);
        a2 = A + 1 - (A - 1) * cw - s;
        break;
      }
      case 'allpass':
        b0 = 1 - alpha;
        b1 = -2 * cw;
        b2 = 1 + alpha;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
    return this;
  }

  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  /** Filter `buf[start, end)` in place. */
  run(buf: Float32Array, start = 0, end = buf.length): Float32Array {
    let z1 = this.z1;
    let z2 = this.z2;
    const { b0, b1, b2, a1, a2 } = this;
    for (let i = start; i < end; i++) {
      const x = buf[i];
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      buf[i] = y;
    }
    this.z1 = Math.abs(z1) < 1e-25 ? 0 : z1;
    this.z2 = Math.abs(z2) < 1e-25 ? 0 : z2;
    return buf;
  }
}

/** One-shot whole-buffer filtering. `order` cascades the same section (24 dB/oct for lowpass order 2). */
export function filterBuffer(buf: Float32Array, type: BiquadType, f: number, q: number, sr: number, gainDb = 0, order = 1): Float32Array {
  for (let k = 0; k < order; k++) new Biquad(type, f, q, sr, gainDb).run(buf);
  return buf;
}

/**
 * Cytomic (Andrew Simper) TPT state-variable filter: low / band / high outputs, stable for per-sample cutoff
 * modulation. Call `setFreq` as often as needed (it costs one tan()).
 */
export class Svf {
  private ic1 = 0;
  private ic2 = 0;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  private k = 1;
  low = 0;
  band = 0;
  high = 0;

  constructor(
    private readonly sr: number,
    f = 1000,
    q = 0.707,
  ) {
    this.setFreq(f, q);
  }

  setFreq(f: number, q = 1 / this.k): void {
    const g = Math.tan((Math.PI * clamp(f, 5, this.sr * 0.49)) / this.sr);
    this.k = 1 / Math.max(0.05, q);
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  process(x: number): number {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.low = v2;
    this.band = v1;
    this.high = x - this.k * v1 - v2;
    return v2;
  }

  reset(): void {
    this.ic1 = 0;
    this.ic2 = 0;
  }
}

/** One-pole low-pass (y += a (x - y)). */
export class OnePole {
  private y = 0;
  a = 1;
  constructor(f: number, sr: number) {
    this.setFreq(f, sr);
  }
  setFreq(f: number, sr: number): void {
    this.a = 1 - Math.exp((-2 * Math.PI * clamp(f, 1, sr * 0.49)) / sr);
  }
  process(x: number): number {
    this.y += this.a * (x - this.y);
    return this.y;
  }
  /** High-pass output for the same corner (x - lowpass). */
  hp(x: number): number {
    this.y += this.a * (x - this.y);
    return x - this.y;
  }
  reset(v = 0): void {
    this.y = v;
  }
}

export function onePoleLowpass(buf: Float32Array, f: number, sr: number): Float32Array {
  const p = new OnePole(f, sr);
  for (let i = 0; i < buf.length; i++) buf[i] = p.process(buf[i]);
  return buf;
}

export function onePoleHighpass(buf: Float32Array, f: number, sr: number): Float32Array {
  const p = new OnePole(f, sr);
  for (let i = 0; i < buf.length; i++) buf[i] = p.hp(buf[i]);
  return buf;
}

/**
 * Klatt formant resonator (unity gain at DC): y = A x + B y1 + C y2. Used in cascade for vowels,
 * animal calls and conch / horn bodies.
 */
export class Resonator {
  private A = 1;
  private B = 0;
  private C = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(private readonly sr: number) {}
  set(f: number, bw: number): void {
    const T = 1 / this.sr;
    const fc = clamp(f, 20, this.sr * 0.45);
    const r = Math.exp(-Math.PI * Math.max(5, bw) * T);
    this.C = -r * r;
    this.B = 2 * r * Math.cos(2 * Math.PI * fc * T);
    this.A = 1 - this.B - this.C;
  }
  process(x: number): number {
    const y = this.A * x + this.B * this.y1 + this.C * this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
  reset(): void {
    this.y1 = 0;
    this.y2 = 0;
  }
}
