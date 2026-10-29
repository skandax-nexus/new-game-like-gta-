/**
 * 8-line feedback delay network reverb (Hadamard mixing, per-line damping, slow modulation, input
 * diffusion, pre-delay). Used by the score engine (temple hall / open-air), stingers, far ambience and
 * baked into SFX tails. Also renders stereo impulse responses for the runtime ConvolverNode.
 * OWNER: Audio Developer (AUD-01). Pure DSP (see synth/core.ts).
 */
import { type Stereo, stereoOf } from './buffer';
import { Allpass, DelayLine } from './delay';
import { clamp, Rand } from './core';
import { sin01 } from './osc';

export interface ReverbOptions {
  /** Seconds for a 60 dB decay at low/mid frequencies. */
  rt60: number;
  /** Loop low-pass corner (Hz): lower = darker, faster-decaying highs (stone hall ~6 kHz, open air ~3 kHz). */
  damping?: number;
  /** Room size scale of the delay lengths (0.5 small chamber .. 2 vast hall). */
  size?: number;
  predelayMs?: number;
  /** Input allpass diffusion 0..0.75. */
  diffusion?: number;
  /** Delay modulation depth in samples (de-metallizes the tail). */
  modulation?: number;
}

const BASE_MS = [29.7, 37.1, 41.1, 43.7, 53.0, 59.9, 67.7, 73.3];
const DIFF_MS_L = [4.77, 3.59, 12.73, 9.31];
const DIFF_MS_R = [4.31, 3.79, 11.89, 9.67];

export class FdnReverb {
  private readonly lines: DelayLine[] = [];
  private readonly len: number[] = [];
  private readonly g: number[] = [];
  private readonly lp: Float64Array = new Float64Array(8);
  private dampA = 0.5;
  private readonly pre: DelayLine;
  private readonly preDelay: number;
  private readonly diffL: Allpass[];
  private readonly diffR: Allpass[];
  private readonly modDepth: number;
  private modPhase = 0;
  private readonly modInc: number;
  private readonly v = new Float64Array(8);

  constructor(
    private readonly sr: number,
    opts: ReverbOptions,
  ) {
    const size = clamp(opts.size ?? 1, 0.3, 3);
    for (let i = 0; i < 8; i++) {
      const l = Math.round(((BASE_MS[i] as number) * size * sr) / 1000);
      this.len.push(l);
      this.lines.push(new DelayLine(l + 16));
      this.g.push(0);
    }
    this.preDelay = Math.max(1, Math.round(((opts.predelayMs ?? 12) * sr) / 1000));
    this.pre = new DelayLine(this.preDelay + 2);
    const diff = clamp(opts.diffusion ?? 0.6, 0, 0.8);
    this.diffL = DIFF_MS_L.map((ms) => new Allpass(Math.max(1, Math.round((ms * sr) / 1000)), diff));
    this.diffR = DIFF_MS_R.map((ms) => new Allpass(Math.max(1, Math.round((ms * sr) / 1000)), diff));
    this.modDepth = opts.modulation ?? 3;
    this.modInc = 0.37 / sr;
    this.setRt60(opts.rt60);
    this.setDamping(opts.damping ?? 5500);
  }

  setRt60(rt60: number): void {
    const rt = Math.max(0.05, rt60);
    for (let i = 0; i < 8; i++) this.g[i] = Math.pow(10, (-3 * (this.len[i] as number)) / (rt * this.sr));
  }

  setDamping(hz: number): void {
    this.dampA = 1 - Math.exp((-2 * Math.PI * clamp(hz, 200, this.sr * 0.45)) / this.sr);
  }

  /** Process one stereo frame; writes the wet signal to `out` (index 0 = L, 1 = R). */
  tick(inL: number, inR: number, out: Float64Array): void {
    this.pre.write(0.5 * (inL + inR));
    const p = this.pre.read(this.preDelay);
    let dl = p + 0.25 * (inL - inR);
    let dr = p - 0.25 * (inL - inR);
    for (let i = 0; i < 4; i++) {
      dl = (this.diffL[i] as Allpass).process(dl);
      dr = (this.diffR[i] as Allpass).process(dr);
    }
    this.modPhase += this.modInc;
    if (this.modPhase >= 1) this.modPhase -= 1;
    const m0 = this.modDepth * (1 + sin01(this.modPhase));
    const m1 = this.modDepth * (1 + sin01(this.modPhase + 0.31));
    const v = this.v;
    const a = this.dampA;
    for (let i = 0; i < 8; i++) {
      const line = this.lines[i] as DelayLine;
      const d = this.len[i] as number;
      const raw = i === 1 ? line.readLinear(d + m0) : i === 6 ? line.readLinear(d + m1) : line.read(d);
      const lp = this.lp[i] + a * (raw - this.lp[i]);
      this.lp[i] = Math.abs(lp) < 1e-25 ? 0 : lp;
      v[i] = lp * (this.g[i] as number);
    }
    // Fast Walsh-Hadamard (8), normalized by 1/sqrt(8).
    for (let h = 1; h < 8; h <<= 1) {
      for (let i = 0; i < 8; i += h << 1) {
        for (let j = i; j < i + h; j++) {
          const x = v[j];
          const y = v[j + h];
          v[j] = x + y;
          v[j + h] = x - y;
        }
      }
    }
    const n = 0.3535533905932738;
    for (let i = 0; i < 8; i++) {
      const inj = i & 1 ? dr : dl;
      (this.lines[i] as DelayLine).write(v[i] * n + inj * (i < 4 ? 0.5 : -0.5));
    }
    out[0] = (this.lp[0] - this.lp[2] + this.lp[4] - this.lp[6] + 0.6 * (this.lp[1] - this.lp[5])) * 0.5;
    out[1] = (this.lp[1] - this.lp[3] + this.lp[5] - this.lp[7] + 0.6 * (this.lp[2] - this.lp[6])) * 0.5;
  }

  /** Add `wet` x reverb of in[start, start+n) into out (stereo, same indices). */
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, start: number, n: number, wet: number): void {
    const o = new Float64Array(2);
    for (let i = start; i < start + n; i++) {
      this.tick(inL[i], inR[i], o);
      outL[i] += o[0] * wet;
      outR[i] += o[1] * wet;
    }
  }
}

/** Render a mono source through the reverb into a new stereo buffer `tailSec` longer (dry + wet). */
export function reverbate(src: Float32Array, sr: number, opts: ReverbOptions, wet: number, dry = 1, tailSec = opts.rt60): Stereo {
  const n = src.length + Math.round(tailSec * sr);
  const out = stereoOf(n);
  const rv = new FdnReverb(sr, opts);
  const o = new Float64Array(2);
  for (let i = 0; i < n; i++) {
    const x = i < src.length ? src[i] : 0;
    rv.tick(x, x, o);
    out.L[i] = x * dry + o[0] * wet;
    out.R[i] = x * dry + o[1] * wet;
  }
  return out;
}

/** Same for a stereo source. */
export function reverbateStereo(src: Stereo, sr: number, opts: ReverbOptions, wet: number, dry = 1, tailSec = opts.rt60): Stereo {
  const n = src.L.length + Math.round(tailSec * sr);
  const out = stereoOf(n);
  const rv = new FdnReverb(sr, opts);
  const o = new Float64Array(2);
  for (let i = 0; i < n; i++) {
    const l = i < src.L.length ? src.L[i] : 0;
    const r = i < src.R.length ? src.R[i] : 0;
    rv.tick(l, r, o);
    out.L[i] = l * dry + o[0] * wet;
    out.R[i] = r * dry + o[1] * wet;
  }
  return out;
}

/**
 * Stereo impulse response for a ConvolverNode: exponentially decaying, frequency-dependent noise
 * (bright early part darkening over time) with sparse early reflections. Decorrelated channels.
 */
export function impulseResponse(sr: number, rt60: number, opts: { seed: number; predelayMs?: number; brightness?: number; early?: number }): Stereo {
  const n = Math.round(rt60 * 1.1 * sr);
  const out = stereoOf(n);
  const rng = new Rand(opts.seed);
  const pre = Math.round(((opts.predelayMs ?? 8) * sr) / 1000);
  const bright = clamp(opts.brightness ?? 0.6, 0.05, 1);
  const decay = Math.pow(10, -3 / (rt60 * sr));
  for (const ch of [out.L, out.R]) {
    let lp = 0;
    let env = 1;
    for (let i = pre; i < n; i++) {
      // The loop corner falls from ~bright x 12 kHz to ~1 kHz over the tail (air + wall absorption).
      const t = (i - pre) / (n - pre);
      const a = clamp(bright * (1 - 0.85 * t) * 0.9, 0.02, 0.95);
      lp += a * (rng.bi() - lp);
      ch[i] = lp * env;
      env *= decay;
    }
    const early = opts.early ?? 0.5;
    for (let k = 0; k < 14; k++) {
      const at = pre + Math.round(rng.range(0.002, 0.08) * sr);
      if (at < n) ch[at] += rng.bi() * early * (1 - k / 16);
    }
  }
  // Normalize energy so convolution keeps roughly unity loudness.
  let e = 0;
  for (let i = 0; i < n; i++) e += out.L[i] * out.L[i] + out.R[i] * out.R[i];
  const g = 1 / Math.sqrt(Math.max(1e-9, e / 2));
  for (let i = 0; i < n; i++) {
    out.L[i] *= g;
    out.R[i] *= g;
  }
  return out;
}
