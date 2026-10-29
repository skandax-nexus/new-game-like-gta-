/**
 * Plucked strings: extended Karplus-Strong with fractional (Hermite) delay for exact tuning and meend
 * glides, a loss/brightness loop filter, pick-position comb, optional stiffness dispersion and a
 * "jawari" curved-bridge contact model (one-sided, amplitude-relative bridge slap, band-limited) that
 * produces the buzzing, sustained overtones of the tanpura and veena.
 * Sympathetic (tarab) strings are a separate `SympatheticBank` of tuned comb resonators.
 * OWNER: Audio Developer (AUD-01). Pure DSP (see synth/core.ts).
 */
import { clamp, type Rand } from './core';
import { CombResonator, DelayLine } from './delay';

export interface PluckParams {
  /** Starting frequency (Hz). */
  freq: number;
  /** Seconds rendered. */
  duration: number;
  /** Seconds for a 60 dB decay of the fundamental. */
  t60: number;
  /** 0..1: loop low-pass openness (1 = very bright and long-ringing highs). */
  brightness: number;
  /** 0..0.5: pluck point along the string (0.1 = near the bridge: bright, nasal). */
  pickPosition?: number;
  /** 0..1 pluck hardness (noise vs smooth shape in the excitation). */
  hardness?: number;
  /** 0..1 curved-bridge buzz. */
  jawari?: number;
  /** Peak amplitude scale. */
  velocity?: number;
  /** Frequency curve (Hz over seconds from note start) for meend; overrides `freq` after t = 0 if given. */
  pitch?: (t: number) => number;
  /** Stiffness dispersion 0..1 (metal strings: slight sharp upper partials). */
  stiffness?: number;
}

/**
 * Render one plucked note, adding it into out[offset ...]. Returns the number of frames written.
 */
export function pluck(out: Float32Array, offset: number, p: PluckParams, rng: Rand, sr: number): number {
  const o = Math.max(0, Math.round(offset));
  const len = Math.min(out.length - o, Math.round(p.duration * sr));
  if (len <= 0) return 0;
  const minF = Math.max(20, p.freq * 0.45);
  const line = new DelayLine(Math.ceil(sr / minF) + 8);
  const bright = clamp(p.brightness, 0, 1);
  // Loop low-pass: y += a (x - y); a near 1 = bright. Its low-frequency phase delay is (1 - a) / a samples.
  const a = 0.25 + 0.74 * bright;
  const lpDelay = (1 - a) / a;
  // First-order allpass with a negative coefficient: more delay at low frequencies, so upper partials
  // run sharp like a stiff metal string. Its DC phase delay is (1 - c) / (1 + c) samples.
  const stiff = clamp(p.stiffness ?? 0, 0, 1) * 0.5;
  const apC = -stiff;
  const apDelay = stiff > 0 ? (1 - apC) / (1 + apC) : 0;
  const jaw = clamp(p.jawari ?? 0, 0, 1);
  const vel = p.velocity ?? 1;

  // Excitation: one period of shaped noise + triangle displacement, comb-filtered at the pick point.
  const period0 = sr / p.freq;
  const exLen = Math.max(4, Math.round(period0));
  const ex = new Float32Array(exLen);
  const hard = clamp(p.hardness ?? 0.6, 0, 1);
  const pick = clamp(p.pickPosition ?? 0.13, 0.02, 0.5);
  let lpN = 0;
  const nA = 0.15 + 0.8 * hard;
  for (let i = 0; i < exLen; i++) {
    const u = i / exLen;
    const tri = u < pick ? u / pick : (1 - u) / (1 - pick);
    lpN += nA * (rng.bi() - lpN);
    ex[i] = (1 - hard) * (tri - 0.5) * 1.6 + hard * lpN * 1.8;
  }
  const pd = Math.max(1, Math.round(pick * exLen));
  for (let i = exLen - 1; i >= pd; i--) ex[i] -= ex[i - pd];
  let mean = 0;
  for (let i = 0; i < exLen; i++) mean += ex[i];
  mean /= exLen;
  for (let i = 0; i < exLen; i++) ex[i] -= mean;

  let lp = 0;
  let ap1 = 0;
  let apx1 = 0;
  let f = p.freq;
  let g = Math.pow(10, -3 / (Math.max(0.05, p.t60) * f));
  let D = Math.max(2.1, sr / f - lpDelay - apDelay);
  const pitchFn = p.pitch;
  // Curved-bridge (jawari) contact, applied outside the loop so the string stays passive: when the
  // displacement exceeds a threshold tied to its own running amplitude, the excess "slaps" the bridge.
  // The slap is rich in high partials and scales with the string's energy, so the buzz blooms with the
  // note and decays with it instead of dying first like ordinary high partials.
  let envAmp = 0;
  const envRel = Math.exp(-1 / (0.05 * sr));
  let slapHp = 0;
  let slapLp = 0;
  const hpA = 1 - Math.exp((-2 * Math.PI * 900) / sr);
  const lpA = 1 - Math.exp((-2 * Math.PI * 7000) / sr);
  let dc = 0;
  for (let i = 0; i < len; i++) {
    if (pitchFn && (i & 15) === 0) {
      f = clamp(pitchFn(i / sr), minF, sr * 0.2);
      g = Math.pow(10, -3 / (Math.max(0.05, p.t60) * f));
      D = Math.max(2.1, sr / f - lpDelay - apDelay);
    }
    let y = line.readHermite(D);
    lp += a * (y - lp);
    y = lp * g;
    if (stiff > 0) {
      const v = apC * y + apx1 - apC * ap1;
      apx1 = y;
      ap1 = v;
      y = v;
    }
    const x = i < exLen ? ex[i] : 0;
    const v = y + x;
    line.write(Math.abs(v) < 1e-22 ? 0 : v);
    dc += 0.0005 * (v - dc);
    let s = v - dc;
    if (jaw > 0) {
      const av = Math.abs(s);
      envAmp = av > envAmp ? av : envAmp * envRel;
      const thr = envAmp * 0.55;
      const slap = s > thr ? s - thr : 0;
      slapLp += lpA * (slap - slapLp);
      slapHp += hpA * (slapLp - slapHp);
      s += jaw * 2.2 * (slapLp - slapHp);
    }
    out[o + i] += s * vel;
  }
  return len;
}

/**
 * Sympathetic strings: comb resonators tuned to the raga's notes, fed by the played string(s). Shared
 * per instrument bus (not per note), so its cost is constant.
 */
export class SympatheticBank {
  private readonly combs: CombResonator[] = [];
  constructor(freqs: readonly number[], sr: number, t60 = 3.5, damp = 0.35) {
    for (const f of freqs) this.combs.push(new CombResonator(f, sr, t60, damp));
  }
  process(x: number): number {
    let s = 0;
    const inp = x * 0.02;
    for (let i = 0; i < this.combs.length; i++) s += (this.combs[i] as CombResonator).process(inp);
    return s;
  }
}
