/**
 * Score instruments (pure DSP): tanpura strings (cached jawari plucks), vina notes with meend (Karplus-
 * Strong + jawari, rendered per note), the vamsha / bansuri (a real-time breath-excited voice with
 * vibrato, meend glides, andolan and kan grace notes), drum strokes (cached per kit / bol / variant),
 * bells, war horns, conch and a formant choir drone.
 * OWNER: Audio Developer (AUD-01).
 */
import { hashSeed, Rand } from '../synth/core';
import { mono, removeDc, sanitize, trimTail } from '../synth/buffer';
import { Svf } from '../synth/filters';
import { addModes, bellModes, HANDBELL_RATIOS } from '../synth/modal';
import { sin01 } from '../synth/osc';
import { pluck } from '../synth/string';
import { handBellRinging, templeBell } from '../synth/sources/bells';
import { type DrumKit, type DrumStroke, drumStroke, strokeLength } from '../synth/sources/drums';
import { conch, warHorn } from '../synth/sources/winds';
import { voice } from '../synth/voice';
import { type RagaDef, SA_HZ, swaraHz } from './theory';

/** One tanpura string pluck (~6.5 s): long, buzzing, blooming. Peak ~0.5. */
export function renderTanpuraString(freq: number, sr: number, seed: number): Float32Array {
  const rng = new Rand(hashSeed('tanpura', Math.round(freq * 100), seed));
  const b = mono(6.5, sr);
  pluck(b, 0, { freq, duration: 6.5, t60: 11, brightness: 0.93, jawari: 0.95, pickPosition: 0.22, hardness: 0.25, velocity: 1 }, rng, sr);
  removeDc(b, sr, 20);
  // Gentle fade of the last 0.6 s so the cached pluck never ends with a step.
  const f = Math.round(0.6 * sr);
  for (let i = 0; i < f; i++) b[b.length - f + i] *= 0.5 + 0.5 * Math.cos((Math.PI * i) / f);
  return scaleTo(b, 0.5);
}

/** A vina note: pluck + optional meend (pitch glide from `fromHz` over `glideSec`) + optional andolan. */
export function renderVinaNote(
  toHz: number,
  durSec: number,
  sr: number,
  rng: Rand,
  opts: { fromHz?: number; glideSec?: number; glideAt?: number; andolan?: boolean; bright?: number; vel?: number; hardness?: number } = {},
): Float32Array {
  const len = Math.min(4.5, Math.max(0.6, durSec + 1.6));
  const b = mono(len, sr);
  const from = opts.fromHz ?? toHz;
  const gs = opts.glideSec ?? 0;
  const ga = opts.glideAt ?? 0.04;
  const andolan = opts.andolan ?? false;
  const pitch = gs > 0 || andolan
    ? (t: number): number => {
        let f = toHz;
        if (gs > 0) {
          const u = Math.max(0, Math.min(1, (t - ga) / gs));
          const s = u * u * (3 - 2 * u);
          f = from * Math.pow(toHz / from, s);
        }
        if (andolan && t > 0.25) f *= Math.pow(2, (14 / 1200) * Math.sin(2 * Math.PI * 1.6 * (t - 0.25)));
        return f;
      }
    : undefined;
  pluck(b, 0, { freq: from, duration: len, t60: 2.6, brightness: opts.bright ?? 0.86, jawari: 0.45, pickPosition: 0.13, hardness: opts.hardness ?? 0.5, velocity: opts.vel ?? 1, pitch, stiffness: 0.15 }, rng, sr);
  removeDc(b, sr, 30);
  const out = trimTail(b, sr, -54, 0.02, 0.05);
  return scaleTo(out, 0.5 * (opts.vel ?? 1));
}

/** Fast swarmandal-like glissando: `notes` plucked in quick succession (bright, short). */
export function renderGliss(raga: RagaDef, notes: readonly number[], stepSec: number, sr: number, rng: Rand): Float32Array {
  const b = mono(notes.length * stepSec + 2.2, sr);
  notes.forEach((n, i) => {
    const tmp = mono(2.2, sr);
    pluck(tmp, 0, { freq: swaraHz(raga, n), duration: 2.2, t60: 1.8, brightness: 0.95, jawari: 0.2, pickPosition: 0.1, hardness: 0.8, velocity: 0.6 + 0.4 * (i / notes.length) }, rng, sr);
    const o = Math.round(i * stepSec * sr);
    for (let k = 0; k < tmp.length && o + k < b.length; k++) b[o + k] += tmp[k];
  });
  removeDc(b, sr, 30);
  return scaleTo(trimTail(b, sr, -54), 0.5);
}

/** Cached drum stroke (kit / stroke / variant), peak ~0.5 * vel scale is applied at playback. */
export function renderStroke(kit: DrumKit, stroke: DrumStroke, variant: number, sr: number, seed: number): Float32Array {
  const rng = new Rand(hashSeed('stroke', kit, stroke, variant, seed));
  const b = mono(strokeLength(kit, stroke), sr);
  drumStroke(b, 0, rng, sr, kit, stroke, SA_HZ, 0.85);
  removeDc(b, sr, 20);
  // Kits are balanced by their stroke energy, not peak: normalize to a common peak then trim by kind.
  const out = trimTail(b, sr, -60, 0.01, 0.03);
  const trim: Record<DrumKit, number> = { pakhawaj: 0.5, mridangam: 0.42, dhol: 0.5, nagara: 0.6 };
  return scaleTo(out, trim[kit]);
}

export type BellKind = 'ghanta' | 'ghanti_ring' | 'chime';

export function renderBell(kind: BellKind, semis: number, raga: RagaDef, sr: number, seed: number): Float32Array {
  const rng = new Rand(hashSeed('bell', kind, semis, seed));
  if (kind === 'ghanta') {
    const b = mono(7, sr);
    templeBell(b, 0, rng, sr, { f0: swaraHz(raga, semis), t60: 6 });
    return scaleTo(trimTail(b, sr, -60), 0.5);
  }
  if (kind === 'ghanti_ring') {
    const b = mono(4, sr);
    handBellRinging(b, 0, rng, sr, { f0: swaraHz(raga, semis), dur: 1.6 + rng.next() * 1.2 });
    return scaleTo(trimTail(b, sr, -60), 0.5);
  }
  const b = mono(3, sr);
  addModes(b, 0, bellModes(swaraHz(raga, semis), HANDBELL_RATIOS, { t60: 2.2, brightness: 0.4, beatHz: 1.5, rng, zeroPhase: true, t60Tilt: 0.9 }), sr);
  return scaleTo(trimTail(b, sr, -60), 0.5);
}

export function renderConchCall(raga: RagaDef, sr: number, seed: number, durSec = 2.6): Float32Array {
  const rng = new Rand(hashSeed('conch', seed));
  const b = mono(durSec + 0.4, sr);
  conch(b, 0, rng, sr, { dur: durSec, f0: swaraHz(raga, 12), power: 0.85 });
  return scaleTo(trimTail(b, sr, -60), 0.5);
}

/** War horn "wah-WAAH" from Sa to Pa (or Sa to taar Sa). */
export function renderHornCall(raga: RagaDef, sr: number, seed: number, leapTo = 7): Float32Array {
  const rng = new Rand(hashSeed('horn', seed, leapTo));
  const b = mono(2.6, sr);
  warHorn(b, 0, rng, sr, { dur: 2.2, f0: swaraHz(raga, 0), f1: swaraHz(raga, leapTo), leapAt: 0.32, power: 0.8 });
  return scaleTo(trimTail(b, sr, -60), 0.5);
}

/**
 * Choir drone: `voices` men holding an open vowel on the given swaras (e.g. [0, 7] = Sa + Pa) for
 * `durSec`, with soft attack / release - the "cinematic" war and temple pad.
 */
export function renderChoir(raga: RagaDef, swaras: readonly number[], durSec: number, sr: number, seed: number, vowel: 'a' | 'o' | 'u' = 'a'): Float32Array {
  const rng = new Rand(hashSeed('choir', swaras.join(','), seed, vowel));
  // Voices live below ~5 kHz: synthesize at half rate (half the cost) and upsample.
  const hr = Math.round(sr / 2);
  const half = mono(durSec + 0.5, hr);
  const per = 2;
  for (const s of swaras) {
    for (let k = 0; k < per; k++) {
      const f0 = swaraHz(raga, s) * (1 + rng.bi() * 0.004);
      const att = 0.8 + rng.next() * 0.6;
      voice(half, 0, {
        duration: durSec,
        f0: [[0, f0], [durSec, f0 * (1 + rng.bi() * 0.003)]],
        amp: [[0, 0], [att, 0.9], [durSec - 1.2, 0.8], [durSec, 0]],
        vowels: [[0, vowel], [durSec * 0.6, vowel === 'a' ? 'o' : vowel]],
        kind: 'male',
        breath: 0.18,
        jitter: 0.005,
        shimmer: 0.03,
        vibrato: [4.6 + rng.next(), 12],
        glide: 0.8,
        presence: 0.3,
      }, rng, hr, 1 / Math.sqrt(per * swaras.length));
    }
  }
  const b = new Float32Array(Math.round((half.length * sr) / hr));
  const k = hr / sr;
  for (let i = 0; i < b.length; i++) {
    const p = i * k;
    const j = Math.floor(p);
    const f = p - j;
    const a0 = half[j] ?? 0;
    const a1 = half[j + 1] ?? a0;
    b[i] = a0 + (a1 - a0) * f;
  }
  removeDc(b, sr, 30);
  return scaleTo(b, 0.5);
}

function scaleTo(b: Float32Array, peak: number): Float32Array {
  let p = 0;
  for (let i = 0; i < b.length; i++) p = Math.max(p, Math.abs(b[i]));
  if (p > 1e-9) {
    const g = peak / p;
    for (let i = 0; i < b.length; i++) b[i] *= g;
  }
  return sanitize(b);
}

// ------------------------------------------------------------------------------------------- bansuri

/** A note for the bansuri: absolute frame start, length, target frequency and ornaments. */
export interface FluteNote {
  start: number;
  frames: number;
  hz: number;
  /** Seconds of meend (glide) from the previous pitch into this one (0 = clean change). */
  meend: number;
  /** Grace note frequency (kan) flicked just before the note, or 0. */
  kanHz: number;
  andolan: boolean;
  vel: number;
  /** First note after a breath: re-articulated with a breathy "chiff". */
  attack: boolean;
}

/**
 * Real-time bamboo flute. A sine fundamental with a weak 2nd / 3rd harmonic, breath noise through two
 * resonant band-passes tracking the pitch, delayed vibrato on long notes, meend glides, andolan and kan
 * flicks, breath attacks and phrase-end releases. Renders sample by sample into a mono buffer.
 */
export class Bansuri {
  private readonly notes: FluteNote[] = [];
  private cur: FluteNote | null = null;
  private f = 0;
  private fStart = 0;
  private ph = 0;
  private amp = 0;
  private readonly bp1: Svf;
  private readonly bp2: Svf;
  private readonly air: Svf;
  private noteFrame = 0;
  private readonly rng: Rand;
  private vibPh = 0;

  constructor(
    private readonly sr: number,
    seed: number,
  ) {
    this.bp1 = new Svf(sr, 600, 9);
    this.bp2 = new Svf(sr, 1200, 7);
    this.air = new Svf(sr, 4000, 0.7);
    this.rng = new Rand(hashSeed('bansuri', seed));
  }

  /** Queue notes (must be in start order and after any queued note). */
  push(n: FluteNote): void {
    this.notes.push(n);
  }

  get pending(): number {
    return this.notes.length + (this.cur ? 1 : 0);
  }

  /** Last scheduled note end frame (for the composer). */
  get endFrame(): number {
    const last = this.notes.length ? this.notes[this.notes.length - 1] : this.cur;
    return last ? last.start + last.frames : 0;
  }

  /** Render frames [frame, frame + n) adding into out[o ...]. */
  render(out: Float32Array, o: number, frame: number, n: number, gain: number): void {
    const sr = this.sr;
    for (let i = 0; i < n; i++) {
      const fr = frame + i;
      if (this.notes.length && (this.notes[0] as FluteNote).start <= fr) {
        const nx = this.notes.shift() as FluteNote;
        const legato = this.cur !== null && this.cur.start + this.cur.frames >= nx.start - Math.round(0.03 * sr) && !nx.attack;
        this.cur = nx;
        this.noteFrame = 0;
        this.fStart = legato && this.f > 0 ? this.f : nx.hz;
        if (!legato) this.f = nx.hz;
      }
      const c = this.cur;
      let target = 0;
      if (c) {
        const t = this.noteFrame / sr;
        const end = c.frames / sr;
        // Pitch: kan flick, meend glide, delayed vibrato or andolan.
        let hz = c.hz;
        if (c.kanHz > 0 && t < 0.045) hz = c.kanHz;
        else if (c.meend > 0 && t < c.meend) {
          const u = t / c.meend;
          const s = u * u * (3 - 2 * u);
          hz = this.fStart * Math.pow(c.hz / this.fStart, s);
        }
        this.vibPh += 5.2 / sr;
        if (c.andolan && t > 0.3) hz *= Math.pow(2, (18 / 1200) * Math.sin(2 * Math.PI * 1.4 * (t - 0.3)));
        else if (end > 0.7 && t > 0.45) hz *= Math.pow(2, (Math.min(1, (t - 0.45) / 0.6) * 14 / 1200) * sin01(this.vibPh));
        this.f = hz;
        // Breath envelope: attack (with chiff), gentle swell, release at the note end if a gap follows.
        // Breath attack only after a breath; a tongued note dips slightly; a meend flows without a dip.
        const att = c.attack ? 0.09 : 0.035;
        const floor = c.attack ? 0 : c.meend > 0.05 ? 1 : 0.62;
        const nextStart = this.notes.length ? (this.notes[0] as FluteNote).start : Infinity;
        const gapAfter = nextStart - (c.start + c.frames) > Math.round(0.05 * sr);
        const rel = gapAfter ? Math.min(0.18, end * 0.4) : 0.0;
        let e = t < att ? floor + (1 - floor) * (t / att) : 1;
        if (rel > 0 && t > end - rel) e *= Math.max(0, (end - t) / rel);
        if (t >= end && gapAfter) e = 0;
        e *= 0.85 + 0.15 * Math.sin(Math.PI * Math.min(1, t / Math.max(0.2, end)));
        target = e * c.vel;
        this.noteFrame++;
        if (t >= end + 0.25 && gapAfter) this.cur = null;
      }
      this.amp += (target - this.amp) * 0.004;
      if (this.amp < 1e-5 && !c) {
        this.amp = 0;
        continue;
      }
      const f = this.f;
      this.ph += f / sr;
      if (this.ph >= 1) this.ph -= 1;
      if ((fr & 63) === 0) {
        this.bp1.setFreq(f, 9);
        this.bp2.setFreq(f * 2, 7);
      }
      const wn = this.rng.bi();
      this.bp1.process(wn);
      this.bp2.process(wn);
      this.air.process(wn);
      const attackChiff = c && c.attack && this.noteFrame < 0.06 * sr ? 1 - this.noteFrame / (0.06 * sr) : 0;
      const tone = sin01(this.ph) + 0.16 * sin01(2 * this.ph + 0.1) + 0.05 * sin01(3 * this.ph + 0.3);
      const breath = this.bp1.band * 0.11 + this.bp2.band * 0.05 + this.air.band * (0.02 + 0.12 * attackChiff);
      out[o + i] += (tone * 0.55 + breath) * this.amp * gain;
    }
  }
}
