/**
 * Voice and animal sources built on the formant synthesizer: effort grunts, battle cries, crowds
 * (murmur, cheer, panic, battle roar), street calls (hawkers, boatmen), Vedic-style chant, children,
 * crows, elephants (trumpet + rumble) and horses.
 * OWNER: Audio Developer (AUD-01). Pure DSP (see synth/core.ts).
 */
import { clamp, type Rand } from '../core';
import { Biquad } from '../filters';
import { type Key, voice, type VoiceKind, type VowelId } from '../voice';
import { noiseBurst } from './impacts';

/** Effort / pain grunt ("hnh!", "uh!"). */
export function grunt(out: Float32Array, offset: number, rng: Rand, sr: number, effort = 0.7, gain = 1): void {
  const dur = 0.16 + 0.18 * effort + rng.next() * 0.08;
  const f0 = 105 + rng.next() * 45 + effort * 25;
  const v: VowelId = rng.pick(['uh', 'a', 'o', 'uh'] as const);
  voice(out, offset, {
    duration: dur,
    f0: [[0, f0 * 1.1], [dur * 0.3, f0 * 1.15], [dur, f0 * 0.7]],
    amp: [[0, 0], [0.012, 1], [dur * 0.5, 0.75], [dur, 0]],
    vowels: [[0, v], [dur * 0.7, 'm']],
    breath: 0.25 + 0.15 * rng.next(),
    roughness: 0.35 + 0.4 * effort,
    jitter: 0.02,
    shimmer: 0.12,
    open: 0.35,
  }, rng, sr, gain);
  noiseBurst(out, offset, rng, sr, { dur: 0.05, f: 1400, q: 0.5, gain: 0.08 * gain });
}

/** Battle cry / command shout: syllables like "ha!", "jaya!", "ho!" */
export function shout(out: Float32Array, offset: number, rng: Rand, sr: number, opts: { word?: readonly VowelId[]; dur?: number; kind?: VoiceKind; pitch?: number; gain?: number } = {}): void {
  const word = opts.word ?? (rng.pick([['a'], ['i', 'a', 'a'], ['o'], ['a', 'aa']] as const) as readonly VowelId[]);
  const dur = opts.dur ?? 0.35 + rng.next() * 0.35;
  const f0 = (opts.pitch ?? 1) * (150 + rng.next() * 60);
  const keys: (readonly [number, VowelId])[] = word.map((w, i) => [(dur * i) / word.length, w] as const);
  voice(out, offset, {
    duration: dur,
    f0: [[0, f0 * 0.9], [dur * 0.25, f0 * 1.15], [dur, f0 * 0.85]],
    amp: [[0, 0], [0.02, 1], [dur * 0.7, 0.85], [dur, 0]],
    vowels: keys,
    kind: opts.kind ?? 'male',
    breath: 0.18,
    roughness: 0.25,
    jitter: 0.015,
    shimmer: 0.08,
    open: 0.33,
    glide: 0.04,
  }, rng, sr, opts.gain ?? 1);
}

export type CrowdMood = 'murmur' | 'cheer' | 'panic' | 'roar' | 'court';

/**
 * Crowd: `voices` independent talkers / shouters over `dur`. Murmur = short syllables at speech pitch
 * with pauses; cheer = sustained rising "aa"/"ee"; panic = high falling wails; roar = low sustained
 * shouting with breath. `excite` 0..1 raises pitch, effort and density.
 */
export function crowd(out: Float32Array, offset: number, rng: Rand, sr: number, opts: { dur: number; voices: number; mood: CrowdMood; excite?: number; gain?: number; women?: number; swell?: boolean }): void {
  // Render into a scratch buffer so the group can swell in and die away together (no hard group cut).
  const tmp = new Float32Array(Math.round((opts.dur + 0.3) * sr));
  crowdInto(tmp, rng, sr, opts);
  const n = tmp.length;
  const fadeIn = Math.round(0.12 * sr);
  const fadeOutStart = opts.swell === false ? n - Math.round(0.1 * sr) : Math.round(n * 0.55);
  const o = Math.round(offset);
  for (let i = 0; i < n && o + i < out.length; i++) {
    let e = i < fadeIn ? i / fadeIn : 1;
    if (i > fadeOutStart) e *= Math.pow(1 - (i - fadeOutStart) / (n - fadeOutStart), 1.6);
    if (o + i >= 0) out[o + i] += tmp[i] * e;
  }
}

function crowdInto(out: Float32Array, rng: Rand, sr: number, opts: { dur: number; voices: number; mood: CrowdMood; excite?: number; gain?: number; women?: number }): void {
  const offset = 0;
  const ex = clamp(opts.excite ?? 0.5, 0, 1);
  const g = opts.gain ?? 1;
  for (let v = 0; v < opts.voices; v++) {
    const kind: VoiceKind = rng.next() < (opts.women ?? 0.3) ? 'female' : 'male';
    const base = (kind === 'female' ? 210 : 120) * (0.85 + rng.next() * 0.3) * (1 + ex * 0.35);
    const vg = g * (0.35 + 0.65 * rng.next()) / Math.sqrt(opts.voices);
    let t = rng.next() * (opts.mood === 'cheer' ? 0.25 : 0.8);
    while (t < opts.dur - 0.05) {
      const at = offset + t * sr;
      switch (opts.mood) {
        case 'murmur':
        case 'court': {
          // A phrase of 2-7 syllables, then a pause.
          const syl = 2 + rng.int(6);
          const sd = opts.mood === 'court' ? 0.16 : 0.13;
          const d = Math.min(opts.dur - t, syl * sd * (0.8 + rng.next() * 0.5));
          const vowels: (readonly [number, VowelId])[] = [];
          const amp: Key[] = [[0, 0]];
          for (let s = 0; s < syl; s++) {
            const st = (s * d) / syl;
            vowels.push([st, rng.pick(['a', 'e', 'i', 'o', 'u', 'uh'] as const)]);
            amp.push([st + 0.02, 0.7 + rng.next() * 0.3], [st + (d / syl) * 0.75, 0.5], [st + (d / syl) * 0.95, 0.05]);
          }
          amp.push([d, 0]);
          const f1 = base * (1 + rng.bi() * 0.1);
          voice(out, at, { duration: d, f0: [[0, f1 * 1.08], [d * 0.4, f1 * 1.12], [d, f1 * 0.86]], amp, vowels, kind, breath: 0.2, jitter: 0.012, glide: 0.035 }, rng, sr, vg);
          t += d + 0.15 + rng.next() * (opts.mood === 'court' ? 1.6 : 0.9) * (1 - ex * 0.6);
          break;
        }
        case 'cheer': {
          const d = Math.min(opts.dur - t, 0.6 + rng.next() * 1.1);
          const f1 = base * 1.4;
          const v1 = rng.pick(['a', 'aa', 'e', 'o'] as const);
          voice(out, at, {
            duration: d,
            f0: [[0, f1 * 0.85], [d * 0.3, f1 * 1.15], [d, f1 * 0.95]],
            amp: [[0, 0], [0.05, 1], [d * 0.8, 0.8], [d, 0]],
            vowels: [[0, rng.pick(['i', 'e'] as const)], [0.08, v1]],
            kind,
            breath: 0.25,
            roughness: 0.2,
            jitter: 0.02,
            vibrato: [5 + rng.next() * 2, 25],
          }, rng, sr, vg * 1.2);
          t += d * (0.4 + rng.next() * 0.5);
          break;
        }
        case 'panic': {
          const d = Math.min(opts.dur - t, 0.5 + rng.next() * 0.9);
          const f1 = base * 1.8;
          voice(out, at, {
            duration: d,
            f0: [[0, f1 * 1.2], [d * 0.2, f1 * 1.3], [d, f1 * 0.6]],
            amp: [[0, 0], [0.04, 1], [d * 0.6, 0.7], [d, 0]],
            vowels: [[0, rng.pick(['a', 'aa', 'e'] as const)], [d * 0.6, 'o']],
            kind,
            breath: 0.35,
            roughness: 0.35,
            jitter: 0.03,
            vibrato: [7, 40],
          }, rng, sr, vg);
          t += d * (0.5 + rng.next() * 0.8);
          break;
        }
        case 'roar': {
          const d = Math.min(opts.dur - t, 0.8 + rng.next() * 1.6);
          const f1 = base * (1.05 + ex * 0.4);
          voice(out, at, {
            duration: d,
            f0: [[0, f1 * 0.9], [d * 0.3, f1 * 1.1], [d, f1 * 0.9]],
            amp: [[0, 0], [0.08, 1], [d * 0.85, 0.8], [d, 0]],
            vowels: [[0, rng.pick(['a', 'aa', 'o', 'uh'] as const)], [d * 0.5, rng.pick(['a', 'o'] as const)]],
            kind,
            breath: 0.4,
            roughness: 0.45,
            jitter: 0.03,
            shimmer: 0.12,
            open: 0.3,
          }, rng, sr, vg);
          t += d * (0.3 + rng.next() * 0.5);
          break;
        }
      }
    }
  }
}

/** Sung street call (hawker / boatman): a short melodic phrase with vowels, ends in a falling glide. */
export function streetCall(out: Float32Array, offset: number, rng: Rand, sr: number, opts: { notes: readonly number[]; vowels: readonly VowelId[]; noteDur?: number; kind?: VoiceKind; gain?: number }): number {
  const nd = opts.noteDur ?? 0.28;
  const dur = nd * opts.notes.length + 0.35;
  const f0: Key[] = [];
  opts.notes.forEach((f, i) => {
    f0.push([i * nd, f], [i * nd + nd * 0.8, f]);
  });
  const last = opts.notes[opts.notes.length - 1] as number;
  f0.push([dur, last * 0.78]);
  const vowels: (readonly [number, VowelId])[] = opts.vowels.map((v, i) => [(i * dur) / opts.vowels.length, v] as const);
  voice(out, offset, {
    duration: dur,
    f0,
    amp: [[0, 0], [0.04, 0.9], [dur * 0.85, 1], [dur, 0]],
    vowels,
    kind: opts.kind ?? 'male',
    breath: 0.12,
    jitter: 0.008,
    vibrato: [5.2, 22],
    glide: 0.05,
  }, rng, sr, opts.gain ?? 1);
  return dur;
}

/**
 * Vedic-style chant: syllables on three pitch accents (anudatta low, udatta middle, svarita rising
 * then falling) by `voices` men in near-unison, phrases ending on a long "om".
 */
export function chant(out: Float32Array, offset: number, rng: Rand, sr: number, opts: { dur: number; voices: number; tonic: number; gain?: number }): void {
  const g = (opts.gain ?? 1) / Math.sqrt(opts.voices);
  // One shared "text": phrase plan (syllable accents and durations), sung by every voice with drift.
  const syl: { t: number; d: number; acc: number; v: VowelId; om: boolean }[] = [];
  let t = 0.2;
  while (t < opts.dur - 1) {
    const n = 6 + rng.int(9);
    for (let k = 0; k < n && t < opts.dur - 1; k++) {
      const d = rng.pick([0.22, 0.22, 0.3, 0.44] as const);
      syl.push({ t, d, acc: rng.weighted([3, 4, 2]), v: rng.pick(['a', 'a', 'i', 'u', 'e', 'o'] as const), om: false });
      t += d;
    }
    const omD = Math.min(opts.dur - t - 0.2, 1.2 + rng.next() * 1.2);
    if (omD > 0.5) syl.push({ t, d: omD, acc: 0, v: 'o', om: true });
    t += omD + 0.5 + rng.next() * 0.7;
  }
  const ratio = [1, 9 / 8, 6 / 5];
  for (let v = 0; v < opts.voices; v++) {
    const det = 1 + rng.bi() * 0.006;
    const late = rng.next() * 0.03;
    const f0: Key[] = [];
    const amp: Key[] = [[0, 0]];
    const vowels: (readonly [number, VowelId])[] = [];
    for (const s of syl) {
      const base = opts.tonic * det * (ratio[s.acc] as number);
      const st = s.t + late;
      if (s.acc === 2) f0.push([st, base * 0.95], [st + s.d * 0.4, base * 1.06], [st + s.d, base * 0.92]);
      else f0.push([st, base], [st + s.d * 0.9, base]);
      if (s.om) {
        vowels.push([st, 'o'], [st + s.d * 0.45, 'u'], [st + s.d * 0.7, 'm']);
        amp.push([st + 0.05, 0.9], [st + s.d * 0.8, 0.7], [st + s.d, 0]);
      } else {
        vowels.push([st, s.v]);
        amp.push([st + 0.03, 0.85], [st + s.d * 0.8, 0.7], [st + s.d * 0.97, 0.25]);
      }
    }
    amp.push([opts.dur, 0]);
    voice(out, offset, { duration: opts.dur, f0, amp, vowels, kind: 'male', breath: 0.12, jitter: 0.006, shimmer: 0.05, glide: 0.05, open: 0.45 }, rng, sr, g);
  }
}

/** Children playing: laughs ("ha-ha-ha" pulses), calls and squeals. */
export function children(out: Float32Array, offset: number, rng: Rand, sr: number, gain = 1): number {
  const kind = rng.weighted([3, 2, 2]);
  if (kind === 0) {
    const n = 3 + rng.int(4);
    const f0 = 320 + rng.next() * 90;
    const pd = 0.11 + rng.next() * 0.04;
    const dur = n * pd + 0.1;
    const amp: Key[] = [[0, 0]];
    for (let k = 0; k < n; k++) amp.push([k * pd + 0.01, 1 - k * 0.08], [k * pd + pd * 0.55, 0.05]);
    amp.push([dur, 0]);
    voice(out, offset, { duration: dur, f0: [[0, f0 * 1.15], [dur, f0 * 0.85]], amp, vowels: [[0, 'a']], kind: 'child', breath: 0.45, jitter: 0.02 }, rng, sr, gain);
    return dur;
  }
  if (kind === 1) {
    const f0 = 360 + rng.next() * 100;
    return streetCall(out, offset, rng, sr, { notes: [f0, f0 * 1.25, f0 * 1.12], vowels: ['a', 'e', 'o'], noteDur: 0.16, kind: 'child', gain });
  }
  const d = 0.25 + rng.next() * 0.3;
  const f0 = 520 + rng.next() * 200;
  voice(out, offset, { duration: d, f0: [[0, f0], [d * 0.3, f0 * 1.3], [d, f0 * 0.9]], amp: [[0, 0], [0.03, 1], [d, 0]], vowels: [[0, 'ee']], kind: 'child', breath: 0.3 }, rng, sr, gain * 0.7);
  return d;
}

/** House crow "kaa" calls (2-4 in a row): nasal, harsh, falling. */
export function crowCaws(out: Float32Array, offset: number, rng: Rand, sr: number, gain = 1): number {
  const n = 1 + rng.int(4);
  let t = 0;
  const f0 = 520 + rng.next() * 160;
  for (let k = 0; k < n; k++) {
    const d = 0.22 + rng.next() * 0.12;
    voice(out, offset + t * sr, {
      duration: d,
      f0: [[0, f0 * 1.05], [d * 0.3, f0], [d, f0 * 0.8]],
      amp: [[0, 0], [0.015, 1], [d * 0.6, 0.8], [d, 0]],
      vowels: [[0, 'caw']],
      kind: 'animal',
      breath: 0.45,
      roughness: 0.8,
      jitter: 0.06,
      shimmer: 0.25,
      open: 0.3,
    }, rng, sr, gain);
    t += d + 0.12 + rng.next() * 0.15;
  }
  return t;
}

/** War elephant trumpet: a strident, rough blare that swells, peaks and breaks downward. */
export function elephantTrumpet(out: Float32Array, offset: number, rng: Rand, sr: number, gain = 1): number {
  const d = 1.1 + rng.next() * 0.8;
  const f0 = 420 + rng.next() * 220;
  const peak = 0.25 + rng.next() * 0.2;
  voice(out, offset, {
    duration: d,
    f0: [[0, f0 * 0.7], [d * peak, f0 * 1.25], [d * 0.7, f0 * 1.1], [d, f0 * 0.55]],
    amp: [[0, 0], [0.05, 0.7], [d * peak, 1], [d * 0.8, 0.7], [d, 0]],
    vowels: [[0, 'trunk']],
    kind: 'animal',
    formantShift: 1.6,
    breath: 0.22,
    roughness: 0.3,
    jitter: 0.012,
    shimmer: 0.08,
    open: 0.22,
    vibrato: [6 + rng.next() * 4, 35],
  }, rng, sr, gain);
  // Brassy edge (a second, higher tract resonance).
  const tmp = new Float32Array(Math.round(d * sr));
  voice(tmp, 0, {
    duration: d,
    f0: [[0, f0 * 1.4], [d * peak, f0 * 2.5], [d, f0 * 1.1]],
    amp: [[0, 0], [d * peak, 1], [d, 0]],
    vowels: [[0, 'neigh']],
    kind: 'animal',
    formantShift: 1.5,
    roughness: 0.25,
    jitter: 0.015,
    open: 0.2,
  }, rng, sr, 0.5 * gain);
  const hp = new Biquad('highpass', 1500, 0.7, sr);
  const o = Math.round(offset);
  for (let i = 0; i < tmp.length && o + i < out.length; i++) out[o + i] += hp.process(tmp[i]);
  return d;
}

/** Elephant rumble: very low, long, breathy, rough (most energy 20-200 Hz). */
export function elephantRumble(out: Float32Array, offset: number, rng: Rand, sr: number, gain = 1): number {
  const d = 1.6 + rng.next() * 1.6;
  const f0 = 18 + rng.next() * 12;
  voice(out, offset, {
    duration: d,
    f0: [[0, f0], [d * 0.5, f0 * 1.2], [d, f0 * 0.9]],
    amp: [[0, 0], [0.3, 0.8], [d * 0.6, 1], [d, 0]],
    vowels: [[0, 'u'], [d * 0.5, 'o']],
    kind: 'animal',
    formantShift: 0.35,
    breath: 0.3,
    roughness: 0.6,
    jitter: 0.04,
    open: 0.5,
  }, rng, sr, gain * 2.2);
  return d;
}

/** Horse whinny: high nasal trill descending, then a snort. */
export function horseNeigh(out: Float32Array, offset: number, rng: Rand, sr: number, gain = 1): number {
  const d = 0.9 + rng.next() * 0.5;
  const f0 = 850 + rng.next() * 250;
  voice(out, offset, {
    duration: d,
    f0: [[0, f0 * 0.8], [0.08, f0 * 1.15], [d * 0.5, f0 * 0.85], [d, f0 * 0.45]],
    amp: [[0, 0], [0.05, 1], [d * 0.6, 0.8], [d, 0]],
    vowels: [[0, 'neigh'], [d * 0.6, 'a']],
    kind: 'animal',
    breath: 0.35,
    roughness: 0.4,
    jitter: 0.03,
    vibrato: [16 + rng.next() * 8, 160],
  }, rng, sr, gain);
  noiseBurst(out, offset + (d + 0.05) * sr, rng, sr, { dur: 0.25, f: 900, q: 0.6, gain: 0.35 * gain, attack: 0.01 });
  return d + 0.3;
}
