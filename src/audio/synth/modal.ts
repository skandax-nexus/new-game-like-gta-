/**
 * Modal synthesis: struck bells, bars, membranes, wood and metal as sums of exponentially decaying
 * sinusoids. Two forms:
 *  - `addModes`: impulse response (recursive damped oscillators, 2 mul + 1 add per mode per sample);
 *  - `ResonatorBank`: driven 2-pole resonators excited by a mallet / noise signal (hardness and
 *    contact time shape the spectrum naturally), optional pitch glide for tension-modulated heads.
 * Mode ratio tables for the instruments of the score and the SFX live here too.
 * OWNER: Audio Developer (AUD-01). Pure DSP (see synth/core.ts).
 */
import { clamp, type Rand } from './core';

export interface Mode {
  /** Frequency in Hz. */
  f: number;
  /** Seconds for a 60 dB decay. */
  t60: number;
  /** Linear amplitude. */
  a: number;
  /** Start phase in radians (0 = sine start, avoids a click). */
  ph?: number;
}

/** Add the impulse response of `modes` into out[offset ...]. Modes above 0.45 sr are skipped. */
export function addModes(out: Float32Array, offset: number, modes: readonly Mode[], sr: number, gain = 1, maxSec = Infinity): void {
  const o = Math.max(0, Math.round(offset));
  for (const m of modes) {
    if (m.f <= 0 || m.f >= sr * 0.45 || m.a === 0) continue;
    const w = (2 * Math.PI * m.f) / sr;
    const r = Math.pow(10, -3 / (Math.max(1e-3, m.t60) * sr));
    const len = Math.min(out.length - o, Math.ceil(Math.min(maxSec, m.t60 * 1.05) * sr));
    const ph = m.ph ?? 0;
    const A = m.a * gain;
    // y[n] = A r^n sin(n w + ph):  y[0] = A sin ph, y[-1] = A r^-1 sin(ph - w)
    let y1 = A * Math.sin(ph);
    let y2 = (A / r) * Math.sin(ph - w);
    const c = 2 * r * Math.cos(w);
    const r2 = r * r;
    for (let i = 0; i < len; i++) {
      out[o + i] += y1;
      const y = c * y1 - r2 * y2;
      y2 = y1;
      y1 = y;
    }
  }
}

/**
 * Driven resonator bank. Each mode is a two-pole band-pass resonator with zeros at DC and Nyquist,
 * y = b0 (x - x2) + c y1 - r2 y2 with b0 = a / 2, so an impulse rings at amplitude ~a and a mallet
 * pulse leaks no DC "thump" (an all-pole resonator's DC gain grows as 1 / w for low modes).
 */
export class ResonatorBank {
  private readonly n: number;
  private readonly c: Float64Array;
  private readonly r2: Float64Array;
  private readonly b0: Float64Array;
  private readonly y1: Float64Array;
  private readonly y2: Float64Array;
  private x1 = 0;
  private x2 = 0;
  private readonly baseW: Float64Array;
  private readonly r: Float64Array;
  private readonly amp: Float64Array;

  constructor(modes: readonly Mode[], sr: number) {
    const usable = modes.filter((m) => m.f > 0 && m.f < sr * 0.45);
    this.n = usable.length;
    this.c = new Float64Array(this.n);
    this.r2 = new Float64Array(this.n);
    this.b0 = new Float64Array(this.n);
    this.y1 = new Float64Array(this.n);
    this.y2 = new Float64Array(this.n);
    this.baseW = new Float64Array(this.n);
    this.r = new Float64Array(this.n);
    this.amp = new Float64Array(this.n);
    usable.forEach((m, i) => {
      this.baseW[i] = (2 * Math.PI * m.f) / sr;
      this.r[i] = Math.pow(10, -3 / (Math.max(1e-3, m.t60) * sr));
      this.amp[i] = m.a;
    });
    this.setPitch(1);
  }

  /** Scale every mode frequency by `ratio` (tension glide); call every ~32 samples while gliding. */
  setPitch(ratio: number): void {
    for (let i = 0; i < this.n; i++) {
      const w = clamp(this.baseW[i] * ratio, 1e-4, Math.PI * 0.9);
      const r = this.r[i];
      this.c[i] = 2 * r * Math.cos(w);
      this.r2[i] = r * r;
      this.b0[i] = this.amp[i] * 0.5;
    }
  }

  process(x: number): number {
    let s = 0;
    const dx = x - this.x2;
    this.x2 = this.x1;
    this.x1 = x;
    for (let i = 0; i < this.n; i++) {
      const y = this.b0[i] * dx + this.c[i] * this.y1[i] - this.r2[i] * this.y2[i];
      this.y2[i] = this.y1[i];
      this.y1[i] = y;
      s += y;
    }
    return s;
  }
}

/**
 * Mallet / stick contact pulse: raised-cosine of `contactSec` (shorter = harder = brighter), normalized to
 * unit area so low modes ring at their nominal amplitude. Optional noise for a gritty contact.
 */
export function malletPulse(sr: number, contactSec: number, rng?: Rand, noise = 0): Float32Array {
  const n = Math.max(2, Math.round(contactSec * sr));
  const out = new Float32Array(n);
  let area = 0;
  for (let i = 0; i < n; i++) {
    const v = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / n);
    out[i] = v;
    area += v;
  }
  for (let i = 0; i < n; i++) out[i] = out[i] / area + (rng ? rng.bi() * noise / n : 0);
  return out;
}

/** Excite a resonator bank with `exc`, rendering `seconds` into out[offset..]. Optional pitch curve (ratio over time). */
export function strike(
  out: Float32Array,
  offset: number,
  bank: ResonatorBank,
  exc: Float32Array,
  seconds: number,
  sr: number,
  gain = 1,
  pitch?: (t: number) => number,
): void {
  const o = Math.max(0, Math.round(offset));
  const len = Math.min(out.length - o, Math.round(seconds * sr));
  for (let i = 0; i < len; i++) {
    if (pitch && (i & 31) === 0) bank.setPitch(pitch(i / sr));
    out[o + i] += bank.process(i < exc.length ? exc[i] : 0) * gain;
  }
}

// ------------------------------------------------------------------------------------ mode ratio tables

/** Ideal circular membrane (Bessel zeros / first): dhol bass head, nagara, war drums. */
export const MEMBRANE_RATIOS = [1.0, 1.594, 2.136, 2.296, 2.653, 2.918, 3.156, 3.501, 3.6, 3.652, 4.06, 4.154] as const;
/** Syahi-loaded head (mridangam / pakhawaj treble): nearly harmonic first five modes (Raman 1934). */
export const LOADED_HEAD_RATIOS = [1.0, 2.0, 2.98, 4.01, 5.03, 6.1, 7.2, 8.45, 9.7, 11.2, 12.9, 14.6] as const;
/** Free-free bar (wood or steel blade): parry rings, wooden clappers. */
export const BAR_RATIOS = [1.0, 2.756, 5.404, 8.933, 13.344] as const;
/** Bronze temple bell (ghanta): hum, prime, tierce, quint, nominal and upper partials. */
export const BELL_RATIOS = [0.5, 1.0, 1.183, 1.506, 2.0, 2.514, 2.662, 3.011, 4.166, 5.433, 6.796] as const;
/** Small brass hand bell (ghanti) / cart bell: bright, sparse partials. */
export const HANDBELL_RATIOS = [1.0, 2.32, 4.25, 6.63, 9.38, 12.6] as const;
/** Wooden plank / beam (gate, ram, cart): inharmonic, low. */
export const WOOD_RATIOS = [1.0, 2.57, 4.21, 5.83, 7.95, 9.3] as const;

/**
 * Bell modes with doublet splitting: each partial is two close modes (`beatHz` apart), which gives
 * the slow "wah-wah" beating of real cast bells.
 */
export function bellModes(f0: number, ratios: readonly number[], opts: { t60: number; brightness: number; beatHz: number; rng: Rand; t60Tilt?: number; zeroPhase?: boolean }): Mode[] {
  const modes: Mode[] = [];
  const tilt = opts.t60Tilt ?? 0.55;
  const ph = (): number => (opts.zeroPhase ? 0 : opts.rng.next() * 6.283);
  ratios.forEach((r, k) => {
    const f = f0 * r * (1 + opts.rng.bi() * 0.002);
    const amp = Math.pow(opts.brightness, k * 0.6) * (k === 0 ? 0.6 : 1) * (0.8 + 0.4 * opts.rng.next());
    const t60 = opts.t60 * Math.pow(r / Math.max(0.5, ratios[1] ?? 1), -tilt);
    const beat = opts.beatHz * (0.5 + opts.rng.next());
    modes.push({ f, t60, a: amp * 0.6, ph: ph() });
    modes.push({ f: f + beat, t60: t60 * 0.92, a: amp * 0.4, ph: ph() });
  });
  return modes;
}

/** Generic inharmonic metal (copper vessel, armour plate, blade): dense random partials above f0. */
export function metalModes(f0: number, count: number, rng: Rand, t60: number, spread = 7, tilt = 0.7): Mode[] {
  const modes: Mode[] = [];
  for (let i = 0; i < count; i++) {
    const r = i === 0 ? 1 : 1 + Math.pow(rng.next(), 0.8) * spread;
    modes.push({ f: f0 * r, t60: t60 * Math.pow(r, -tilt) * (0.6 + 0.8 * rng.next()), a: Math.pow(r, -0.5) * (0.5 + rng.next()), ph: rng.next() * 6.283 });
  }
  return modes;
}

/** Modes from a ratio table with simple amplitude / decay tilts. */
export function ratioModes(f0: number, ratios: readonly number[], t60: number, ampTilt = 0.8, decayTilt = 0.6, jitter = 0, rng?: Rand): Mode[] {
  return ratios.map((r, k) => ({
    f: f0 * r * (1 + (rng ? rng.bi() * jitter : 0)),
    t60: t60 * Math.pow(r, -decayTilt),
    a: Math.pow(ampTilt, k),
    ph: rng ? rng.next() * 6.283 : 0,
  }));
}
