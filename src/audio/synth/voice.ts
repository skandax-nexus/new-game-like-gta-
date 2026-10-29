/**
 * Formant (source-filter) synthesis for voices and animal calls: Rosenberg glottal source with jitter,
 * shimmer, breath and roughness, through a cascade of Klatt resonators following vowel keyframes.
 * Used for grunts, battle cries, crowds, hawkers, boatmen, chanting, children, crows, elephants, horses.
 * OWNER: Audio Developer (AUD-01). Pure DSP (see synth/core.ts).
 */
import { clamp, type Rand } from './core';
import { Resonator } from './filters';
import { glottal } from './osc';

/** Vowel formants F1..F5 (Hz) and bandwidths for an adult male; other voices scale them. */
export const VOWELS = {
  a: { f: [730, 1090, 2440, 3400, 4300], bw: [90, 110, 160, 250, 300] },
  aa: { f: [800, 1200, 2500, 3400, 4300], bw: [100, 120, 160, 250, 300] },
  e: { f: [530, 1840, 2480, 3500, 4400], bw: [70, 100, 160, 250, 300] },
  i: { f: [290, 2250, 3010, 3600, 4500], bw: [60, 100, 160, 250, 300] },
  o: { f: [570, 860, 2410, 3400, 4300], bw: [70, 90, 160, 250, 300] },
  u: { f: [320, 870, 2240, 3300, 4300], bw: [60, 90, 160, 250, 300] },
  uh: { f: [560, 1200, 2390, 3400, 4300], bw: [80, 100, 160, 250, 300] },
  m: { f: [260, 1000, 2200, 3300, 4300], bw: [60, 300, 400, 400, 400] },
  ee: { f: [270, 2290, 3010, 3600, 4500], bw: [50, 90, 150, 250, 300] },
  /** Crow / corvid nasal "kaa" body. */
  caw: { f: [1100, 1700, 2600, 3600, 4800], bw: [220, 260, 320, 400, 500] },
  /** Elephant trunk resonances (long tube). */
  trunk: { f: [380, 1000, 1700, 2600, 3500], bw: [120, 160, 220, 300, 400] },
  /** Horse whinny nasal tract. */
  neigh: { f: [700, 1500, 2600, 3800, 4800], bw: [160, 200, 260, 360, 400] },
} as const;
export type VowelId = keyof typeof VOWELS;

export type VoiceKind = 'male' | 'female' | 'child' | 'animal';
const FORMANT_SCALE: Record<VoiceKind, number> = { male: 1, female: 1.17, child: 1.32, animal: 1 };

/** Keyframe [timeSec, value]. Values are linearly interpolated. */
export type Key = readonly [number, number];

export interface VoiceParams {
  duration: number;
  /** f0 contour (Hz). */
  f0: readonly Key[];
  /** Amplitude contour 0..1. */
  amp: readonly Key[];
  /** Vowel timeline: [timeSec, vowel]; formants glide between consecutive entries over `glide` seconds. */
  vowels: readonly (readonly [number, VowelId])[];
  kind?: VoiceKind;
  /** Extra formant scale (1 = nominal). */
  formantShift?: number;
  /** 0..1 aspiration noise (whisper at 1). */
  breath?: number;
  /** Relative period jitter (0.005 natural, 0.05 rough). */
  jitter?: number;
  /** Relative amplitude shimmer per period. */
  shimmer?: number;
  /** 0..1 period-doubling roughness (growl, grunt, elephant rumble). */
  roughness?: number;
  /** Seconds for formant transitions. */
  glide?: number;
  /** Open quotient of the glottal pulse (0.3 pressed .. 0.6 breathy). */
  open?: number;
  /** Vibrato [rateHz, depthCents]. */
  vibrato?: readonly [number, number];
}

function keyAt(keys: readonly Key[], t: number, cursor: { i: number }): number {
  if (keys.length === 0) return 0;
  if (t <= (keys[0] as Key)[0]) return (keys[0] as Key)[1];
  while (cursor.i < keys.length - 1 && t >= (keys[cursor.i + 1] as Key)[0]) cursor.i++;
  if (cursor.i >= keys.length - 1) return (keys[keys.length - 1] as Key)[1];
  const a = keys[cursor.i] as Key;
  const b = keys[cursor.i + 1] as Key;
  return a[1] + ((b[1] - a[1]) * (t - a[0])) / Math.max(1e-9, b[0] - a[0]);
}

/** Render a voiced utterance into out[offset ...] (adds). */
export function voice(out: Float32Array, offset: number, p: VoiceParams, rng: Rand, sr: number, gain = 1): void {
  const o = Math.max(0, Math.round(offset));
  const len = Math.min(out.length - o, Math.round(p.duration * sr));
  if (len <= 0) return;
  const kind = p.kind ?? 'male';
  const fs = FORMANT_SCALE[kind] * (p.formantShift ?? 1);
  const res = [0, 1, 2, 3, 4].map(() => new Resonator(sr));
  const breath = clamp(p.breath ?? 0.08, 0, 1);
  const jitter = p.jitter ?? 0.006;
  const shimmer = p.shimmer ?? 0.04;
  const rough = clamp(p.roughness ?? 0, 0, 1);
  const glide = Math.max(0.005, p.glide ?? 0.06);
  const open = p.open ?? 0.42;
  const vib = p.vibrato;
  const fc = { i: 0 };
  const ac = { i: 0 };
  let vi = 0;
  const vowels = p.vowels.length ? p.vowels : ([[0, 'a']] as const);
  const curF = new Float64Array(5);
  const curB = new Float64Array(5);
  const v0 = VOWELS[(vowels[0] as readonly [number, VowelId])[1]];
  for (let k = 0; k < 5; k++) {
    curF[k] = (v0.f[k] as number) * fs;
    curB[k] = v0.bw[k] as number;
  }
  let phase = rng.next() * 0.2;
  let periodJ = 1;
  let periodA = 1;
  let periodIdx = 0;
  let noiseLp = 0;
  let hiNoise = 0;
  const presence = kind === 'animal' ? 0.5 : 1;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    if ((i & 31) === 0) {
      while (vi < vowels.length - 1 && t >= (vowels[vi + 1] as readonly [number, VowelId])[0]) vi++;
      const target = VOWELS[(vowels[vi] as readonly [number, VowelId])[1]];
      const k1 = 1 - Math.exp(-32 / (glide * sr));
      for (let k = 0; k < 5; k++) {
        curF[k] += ((target.f[k] as number) * fs - curF[k]) * k1;
        curB[k] += ((target.bw[k] as number) - curB[k]) * k1;
        (res[k] as Resonator).set(curF[k], curB[k]);
      }
    }
    let f0 = keyAt(p.f0, t, fc);
    if (vib) f0 *= Math.pow(2, (vib[1] / 1200) * Math.sin(2 * Math.PI * vib[0] * t));
    const amp = keyAt(p.amp, t, ac);
    const inc = (f0 * periodJ) / sr;
    phase += inc;
    if (phase >= 1) {
      phase -= 1;
      periodIdx++;
      periodJ = 1 + rng.bi() * jitter;
      periodA = (1 + rng.bi() * shimmer) * (rough > 0 && periodIdx & 1 ? 1 - rough * 0.7 : 1);
    }
    const src = glottal(phase, open, 0.16) * periodA;
    noiseLp += 0.6 * (rng.bi() - noiseLp);
    const asp = noiseLp * breath * (phase < open ? 1 : 0.45);
    let x = (src * (1 - breath * 0.7) + asp * 1.6) * amp;
    for (let k = 0; k < 5; k++) x = (res[k] as Resonator).process(x);
    // Parallel high-band aspiration (sibilance / breath presence above F5), gated by the glottal cycle.
    const wn = rng.bi();
    const hpN = (wn - hiNoise) * 0.5;
    hiNoise = wn;
    x += hpN * amp * (0.04 + breath * 0.25) * presence * (phase < open ? 1 : 0.5);
    out[o + i] += x * gain;
  }
}

/** Convenience: a short syllable string like "ha", "ho-ya" as vowel keyframes over `dur`. */
export function syllables(vowels: readonly VowelId[], dur: number): (readonly [number, VowelId])[] {
  const step = dur / Math.max(1, vowels.length);
  return vowels.map((v, i) => [i * step, v] as const);
}
