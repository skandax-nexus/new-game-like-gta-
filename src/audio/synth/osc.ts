/**
 * Oscillators, noise sources and envelopes.
 * OWNER: Audio Developer (AUD-01). Pure DSP (see synth/core.ts).
 */
import { clamp, type Rand } from './core';

// ------------------------------------------------------------------------------------------- sine table

const TABLE_BITS = 12;
const TABLE_SIZE = 1 << TABLE_BITS;
const SIN_TABLE = new Float32Array(TABLE_SIZE + 1);
for (let i = 0; i <= TABLE_SIZE; i++) SIN_TABLE[i] = Math.sin((2 * Math.PI * i) / TABLE_SIZE);

/** sin(2 pi phase) for phase in [0, 1) via a 4096-entry table with linear interpolation (~ -100 dB error). */
export function sin01(phase: number): number {
  const p = (phase - Math.floor(phase)) * TABLE_SIZE;
  const i = p | 0;
  const f = p - i;
  const a = SIN_TABLE[i];
  return a + (SIN_TABLE[i + 1] - a) * f;
}

/** PolyBLEP residual for band-limited discontinuities (t = phase, dt = phase increment). */
export function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/** Band-limited sawtooth / pulse oscillator with free-running phase. */
export class BlepOsc {
  phase: number;
  constructor(phase = 0) {
    this.phase = phase;
  }
  /** Rising saw in [-1, 1]. */
  saw(freq: number, sr: number): number {
    const dt = clamp(freq / sr, 0, 0.5);
    const t = this.phase;
    let y = 2 * t - 1 - polyBlep(t, dt);
    this.phase = t + dt;
    if (this.phase >= 1) this.phase -= 1;
    if (!Number.isFinite(y)) y = 0;
    return y;
  }
  /** Pulse with duty `pw` in (0, 1). */
  pulse(freq: number, sr: number, pw: number): number {
    const dt = clamp(freq / sr, 0, 0.5);
    const t = this.phase;
    let t2 = t + 1 - pw;
    if (t2 >= 1) t2 -= 1;
    const y = (t < pw ? 1 : -1) + polyBlep(t, dt) - polyBlep(t2, dt);
    this.phase = t + dt;
    if (this.phase >= 1) this.phase -= 1;
    return y;
  }
}

/**
 * Rosenberg glottal-flow derivative (the "buzz" of voices, lips on a conch, an elephant's trunk).
 * `open` = open quotient, `close` = closing fraction. Returns roughly [-1, 1].
 */
export function glottal(phase: number, open = 0.42, close = 0.16): number {
  // d/dp of the Rosenberg flow pulse, normalized so the closing (negative) peak is -1.
  const norm = (2 * close) / Math.PI;
  if (phase < open) return ((0.5 * Math.PI) / open) * Math.sin((Math.PI * phase) / open) * norm;
  if (phase < open + close) return (-(0.5 * Math.PI) / close) * Math.sin((0.5 * Math.PI * (phase - open)) / close) * norm;
  return 0;
}

// ------------------------------------------------------------------------------------------------ noise

/** Paul Kellet's economy pink noise filter (-3 dB/oct) over white input. */
export class Pink {
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  process(white: number): number {
    this.b0 = 0.99765 * this.b0 + white * 0.099046;
    this.b1 = 0.963 * this.b1 + white * 0.2965164;
    this.b2 = 0.57 * this.b2 + white * 1.0526913;
    return (this.b0 + this.b1 + this.b2 + white * 0.1848) * 0.22;
  }
}

/** Leaky-integrated (brown, -6 dB/oct) noise. */
export class Brown {
  private y = 0;
  process(white: number): number {
    this.y = this.y * 0.996 + white * 0.06;
    return this.y * 1.6;
  }
}

export function whiteNoise(n: number, rng: Rand, gain = 1): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rng.bi() * gain;
  return out;
}

export function pinkNoise(n: number, rng: Rand, gain = 1): Float32Array {
  const out = new Float32Array(n);
  const p = new Pink();
  for (let i = 0; i < n; i++) out[i] = p.process(rng.bi()) * gain;
  return out;
}

export function brownNoise(n: number, rng: Rand, gain = 1): Float32Array {
  const out = new Float32Array(n);
  const p = new Brown();
  for (let i = 0; i < n; i++) out[i] = p.process(rng.bi()) * gain;
  return out;
}

/**
 * Smooth random control signal ("drift"): piecewise cosine interpolation between random points every
 * `period` seconds, values in [lo, hi]. Cheap organic modulation for wind gusts, crowd swells, river flow.
 */
export class Drift {
  private a: number;
  private b: number;
  private t = 0;
  private readonly step: number;
  constructor(
    private readonly rng: Rand,
    period: number,
    sr: number,
    private readonly lo = 0,
    private readonly hi = 1,
  ) {
    this.step = 1 / Math.max(1, period * sr);
    this.a = rng.range(lo, hi);
    this.b = rng.range(lo, hi);
  }
  next(): number {
    this.t += this.step;
    if (this.t >= 1) {
      this.t -= 1;
      this.a = this.b;
      this.b = this.rng.range(this.lo, this.hi);
    }
    const w = 0.5 - 0.5 * Math.cos(Math.PI * this.t);
    return this.a + (this.b - this.a) * w;
  }
}

// -------------------------------------------------------------------------------------------- envelopes

/** Envelope point: [timeSec, value, curve]; curve 0 = linear, > 0 = exponential-ish ease-out, < 0 = ease-in. */
export type EnvPoint = readonly [number, number, number?];

/** Piecewise envelope evaluator with a monotonic cursor (call `at` with non-decreasing t for O(1)). */
export class Env {
  private idx = 0;
  constructor(private readonly pts: readonly EnvPoint[]) {}
  get duration(): number {
    return this.pts.length ? (this.pts[this.pts.length - 1] as EnvPoint)[0] : 0;
  }
  at(t: number): number {
    const p = this.pts;
    if (p.length === 0) return 0;
    if (t <= (p[0] as EnvPoint)[0]) {
      this.idx = 0;
      return (p[0] as EnvPoint)[1];
    }
    if (this.idx > 0 && t < (p[this.idx] as EnvPoint)[0]) this.idx = 0;
    while (this.idx < p.length - 1 && t >= (p[this.idx + 1] as EnvPoint)[0]) this.idx++;
    if (this.idx >= p.length - 1) return (p[p.length - 1] as EnvPoint)[1];
    const a = p[this.idx] as EnvPoint;
    const b = p[this.idx + 1] as EnvPoint;
    let u = (t - a[0]) / Math.max(1e-9, b[0] - a[0]);
    const c = b[2] ?? 0;
    if (c > 0) u = 1 - Math.pow(1 - u, 1 + c);
    else if (c < 0) u = Math.pow(u, 1 - c);
    return a[1] + (b[1] - a[1]) * u;
  }
}

/** Multiply `buf` by an envelope (points in seconds relative to `offsetSec`). */
export function applyEnv(buf: Float32Array, sr: number, pts: readonly EnvPoint[], offsetSec = 0): Float32Array {
  const e = new Env(pts);
  for (let i = 0; i < buf.length; i++) buf[i] *= e.at(offsetSec + i / sr);
  return buf;
}

/** Attack (linear) then exponential decay to -60 dB at t60. */
export function adEnv(t: number, attack: number, t60: number): number {
  if (t < 0) return 0;
  if (t < attack) return t / attack;
  return Math.pow(10, (-3 * (t - attack)) / Math.max(1e-4, t60));
}
