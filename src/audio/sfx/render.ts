/**
 * SFX renderers: every SFX_KINDS entry + internal effects, as pure functions (rng, sampleRate) -> mono
 * Float32Array. Each variant gets its own seeded RNG, so variants differ in pitch, timing, material
 * and layering; the runtime adds per-trigger pitch / gain jitter on top.
 * Runs in the audio worker and in node (tests, scripts/audio/render.mjs) - never on the main thread.
 * OWNER: Audio Developer (AUD-01).
 */
import { hashSeed, Rand } from '../synth/core';
import { addInto, mono, reverse } from '../synth/buffer';
import { Biquad } from '../synth/filters';
import { finishMono, saturate } from '../synth/mix';
import { Drift } from '../synth/osc';
import { pluck } from '../synth/string';
import { chime, handBellRinging, templeBell } from '../synth/sources/bells';
import { drumStroke } from '../synth/sources/drums';
import { bladeRing, clothRustle, crackles, debris, metalClang, noiseBurst, stoneHit, thud, woodKnock } from '../synth/sources/impacts';
import { thunder } from '../synth/sources/nature';
import { crowd, elephantRumble, elephantTrumpet, grunt, horseNeigh, shout } from '../synth/sources/voices';
import { bubble, splash } from '../synth/sources/water';
import { arrowFlight, bowTwang, swish } from '../synth/sources/whoosh';
import { conch, warHorn } from '../synth/sources/winds';
import { SFX_META, type SfxSoundId } from './meta';

type Renderer = (rng: Rand, sr: number) => Float32Array;

/** Sa of the score (C#3). UI plucks and chimes are tuned to it so they never clash with the music. */
export const SA = 138.59;
const S = (ratio: number, oct = 0): number => SA * ratio * Math.pow(2, oct);

function kspluck(out: Float32Array, at: number, rng: Rand, sr: number, f: number, t60: number, gain: number, bright = 0.8): void {
  const tmp = new Float32Array(Math.round(Math.min(2.5, t60 + 0.2) * sr));
  pluck(tmp, 0, { freq: f, duration: tmp.length / sr, t60, brightness: bright, hardness: 0.55, pickPosition: 0.12, jawari: 0.25 }, rng, sr);
  addInto(out, tmp, at, gain);
}

/** Many feet: `steps` stomps of a body of `men`, each foot a thud + grit + gear jingle. */
function feet(out: Float32Array, at: number, rng: Rand, sr: number, men: number, steps: number, period: number, gain: number, gear = 0.3): void {
  for (let s = 0; s < steps; s++) {
    for (let k = 0; k < men; k++) {
      const t = at + (s * period + rng.gauss() * 0.035) * sr;
      thud(out, t, rng, sr, { f: 90 + rng.next() * 60, dur: 0.07 + rng.next() * 0.05, gain: gain * (0.4 + 0.6 * rng.next()), noise: 0.75 });
      if (rng.chance(gear)) metalClang(out, t + rng.next() * 0.03 * sr, rng, sr, { f0: 2500 + rng.next() * 3000, ring: 0.05, gain: gain * 0.08, count: 5 });
    }
  }
}

const R: Record<SfxSoundId, Renderer> = {
  // ------------------------------------------------------------------------------------------ UI
  ui_click(rng, sr) {
    const b = mono(0.2, sr);
    woodKnock(b, 0, rng, sr, { size: 0.08 + rng.next() * 0.08, hardness: 0.85, gain: 1 });
    chime(b, 0.002 * sr, rng, sr, { f0: S(9 / 8, 4) * (1 + rng.bi() * 0.01), t60: 0.18, gain: 0.25 });
    return b;
  },
  ui_hover(rng, sr) {
    // A barely-there bamboo tick: high, short, soft.
    const b = mono(0.08, sr);
    woodKnock(b, 0, rng, sr, { f0: 2300 + rng.next() * 400, size: 0, hardness: 0.4, gain: 0.6, damp: 0.4 });
    return b;
  },
  ui_open(rng, sr) {
    const b = mono(0.9, sr);
    clothRustle(b, 0, rng, sr, { dur: 0.16, f: 3800, gain: 0.07, grain: 0.05 });
    kspluck(b, 0.02 * sr, rng, sr, S(1, 2), 0.6, 0.8);
    kspluck(b, 0.11 * sr, rng, sr, S(3 / 2, 2), 0.7, 0.75);
    return b;
  },
  ui_close(rng, sr) {
    const b = mono(0.8, sr);
    clothRustle(b, 0, rng, sr, { dur: 0.14, f: 3400, gain: 0.06, grain: 0.05 });
    kspluck(b, 0.02 * sr, rng, sr, S(3 / 2, 2), 0.5, 0.7);
    kspluck(b, 0.1 * sr, rng, sr, S(1, 2), 0.55, 0.65);
    return b;
  },
  ui_confirm(rng, sr) {
    const b = mono(1.6, sr);
    woodKnock(b, 0, rng, sr, { size: 0.12, hardness: 0.8, gain: 0.5 });
    chime(b, 0.005 * sr, rng, sr, { f0: S(1, 3), t60: 1.1, gain: 0.8 });
    chime(b, 0.09 * sr, rng, sr, { f0: S(3 / 2, 3), t60: 1.2, gain: 0.6 });
    return b;
  },
  ui_error(rng, sr) {
    const b = mono(0.45, sr);
    woodKnock(b, 0, rng, sr, { size: 0.75, hardness: 0.3, gain: 1, damp: 0.35 });
    woodKnock(b, 0.11 * sr, rng, sr, { size: 0.8, hardness: 0.3, gain: 0.8, damp: 0.35 });
    return b;
  },
  notify(rng, sr) {
    const b = mono(2.2, sr);
    chime(b, 0, rng, sr, { f0: S(3 / 2, 3) * (1 + rng.bi() * 0.005), t60: 1.7, gain: 1, brightness: 0.35 });
    chime(b, 0.16 * sr, rng, sr, { f0: S(2, 3) * 1.0015, t60: 1.4, gain: 0.5, brightness: 0.35 });
    return b;
  },
  // ------------------------------------------------------------------------------- orders, battle
  order_ack(rng, sr) {
    const b = mono(0.9, sr);
    drumStroke(b, 0, rng, sr, 'dhol', 'rim', SA, 0.7);
    drumStroke(b, 0.12 * sr, rng, sr, 'dhol', 'boom', SA, 0.9);
    const men = 5 + rng.int(4);
    for (let k = 0; k < men; k++) shout(b, (0.1 + rng.next() * 0.04) * sr, rng, sr, { word: [rng.pick(['a', 'o', 'aa'] as const)], dur: 0.22 + rng.next() * 0.1, gain: 0.35 / Math.sqrt(men) * 2.2 });
    return b;
  },
  march(rng, sr) {
    const b = mono(1.6, sr);
    feet(b, 0.02 * sr, rng, sr, 14, 3, 0.48, 0.45, 0.35);
    clothRustle(b, 0, rng, sr, { dur: 1.5, f: 1800, gain: 0.03, grain: 0.01 });
    return b;
  },
  charge_horn(rng, sr) {
    const b = mono(2.6, sr);
    const f0 = 130 + rng.next() * 35;
    warHorn(b, 0, rng, sr, { dur: 1.7 + rng.next() * 0.6, f0, f1: f0 * (rng.chance(0.6) ? 1.5 : 2), leapAt: 0.3 + rng.next() * 0.15, power: 0.85 });
    if (rng.chance(0.5)) warHorn(b, 0.05 * sr, rng, sr, { dur: 1.6, f0: f0 * 1.005, f1: f0 * 1.5 * 1.004, leapAt: 0.35, power: 0.7, gain: 0.6 });
    return b;
  },
  conch(rng, sr) {
    const b = mono(3.4, sr);
    const f0 = 300 + rng.next() * 70;
    conch(b, 0, rng, sr, { dur: 2.3 + rng.next() * 0.7, f0, power: 0.75 + rng.next() * 0.25 });
    if (rng.chance(0.5)) conch(b, (0.08 + rng.next() * 0.2) * sr, rng, sr, { dur: 2.2, f0: f0 * (rng.chance(0.5) ? 1.006 : 1.498), power: 0.6, gain: 0.55 });
    return b;
  },
  drum_hit(rng, sr) {
    const b = mono(3, sr);
    drumStroke(b, 0, rng, sr, 'nagara', rng.chance(0.7) ? 'boom' : 'flam', SA, 0.9);
    if (rng.chance(0.5)) drumStroke(b, 0.002 * sr, rng, sr, 'dhol', 'boom', SA, 0.6);
    return saturate(b, 2.5, 0.45);
  },
  arrow_volley(rng, sr) {
    const b = mono(1.8, sr);
    const archers = 26 + rng.int(20);
    for (let k = 0; k < archers; k++) bowTwang(b, (rng.gauss() * 0.05 + 0.12) * sr, rng, sr, 0.18);
    const arrows = 40 + rng.int(25);
    for (let k = 0; k < arrows; k++) arrowFlight(b, (0.16 + rng.next() * 0.35) * sr, rng, sr, { dur: 0.55 + rng.next() * 0.7, gain: 0.25, pitch: 0.8 + rng.next() * 0.5 });
    return b;
  },
  arrow_impact(rng, sr) {
    const b = mono(0.9, sr);
    const n = 18 + rng.int(18);
    for (let k = 0; k < n; k++) {
      const t = Math.pow(rng.next(), 1.3) * 0.45 * sr;
      const kind = rng.weighted([5, 4, 1]);
      if (kind === 0) woodKnock(b, t, rng, sr, { size: 0.3 + rng.next() * 0.5, hardness: 0.9, gain: 0.35 + rng.next() * 0.4, tone: 0.1 + 0.3 * rng.next() });
      else if (kind === 1) thud(b, t, rng, sr, { f: 120 + rng.next() * 80, dur: 0.06, gain: 0.4, noise: 0.85 });
      else metalClang(b, t, rng, sr, { f0: 1500 + rng.next() * 1500, ring: 0.12, gain: 0.25, count: 8 });
    }
    return b;
  },
  clash(rng, sr) {
    const b = mono(1.4, sr);
    const n = 6 + rng.int(7);
    for (let k = 0; k < n; k++) {
      const t = rng.next() * 0.7 * sr;
      const kind = rng.weighted([3, 3, 2, 2]);
      if (kind === 0) bladeRing(b, t, rng, sr, { f0: 1200 + rng.next() * 1300, ring: 0.2 + rng.next() * 0.3, gain: 0.35 + rng.next() * 0.4, scrape: 0.3 });
      else if (kind === 1) woodKnock(b, t, rng, sr, { size: 0.5 + rng.next() * 0.3, hardness: 0.7, gain: 0.6, tone: 0.2 });
      else if (kind === 2) metalClang(b, t, rng, sr, { f0: 500 + rng.next() * 800, ring: 0.2, gain: 0.4 });
      else thud(b, t, rng, sr, { f: 100 + rng.next() * 50, dur: 0.1, gain: 0.5, noise: 0.6 });
    }
    for (let k = 0; k < 2 + rng.int(3); k++) grunt(b, rng.next() * 0.8 * sr, rng, sr, 0.8, 0.25);
    if (rng.chance(0.6)) shout(b, rng.next() * 0.5 * sr, rng, sr, { gain: 0.3 });
    return b;
  },
  elephant_trumpet(rng, sr) {
    const b = mono(3, sr);
    elephantRumble(b, 0, rng, sr, 0.12);
    elephantTrumpet(b, 0.15 * sr, rng, sr, 1);
    return b;
  },
  horse_neigh(rng, sr) {
    const b = mono(2.2, sr);
    const d = horseNeigh(b, 0, rng, sr, 1);
    thud(b, (d + 0.05) * sr, rng, sr, { f: 140, dur: 0.06, gain: 0.35, noise: 0.8 });
    thud(b, (d + 0.22) * sr, rng, sr, { f: 130, dur: 0.06, gain: 0.3, noise: 0.8 });
    return b;
  },
  cheer(rng, sr) {
    const b = mono(2.8, sr);
    crowd(b, 0, rng, sr, { dur: 2.6, voices: 12 + rng.int(6), mood: 'cheer', excite: 0.75 + rng.next() * 0.25 });
    for (let k = 0; k < 3; k++) shout(b, (0.1 + rng.next() * 1.4) * sr, rng, sr, { word: ['i', 'a', 'a'], dur: 0.5, gain: 0.25 });
    return b;
  },
  rout_cry(rng, sr) {
    const b = mono(2.6, sr);
    crowd(b, 0, rng, sr, { dur: 2.4, voices: 10 + rng.int(5), mood: 'panic', excite: 0.9 });
    feet(b, 0.1 * sr, rng, sr, 8, 7, 0.27, 0.3, 0.4);
    return b;
  },
  // ------------------------------------------------------------------------------------- economy
  build(rng, sr) {
    // Four kinds of site work: mallet on timber joints, chisel on stone, a saw, a plank dropped on a pile.
    const b = mono(1.4, sr);
    const kind = rng.int(4);
    if (kind === 0) {
      const f0 = 280 + rng.next() * 260;
      const hits = 3 + rng.int(3);
      for (let k = 0; k < hits; k++) woodKnock(b, k * (0.2 + rng.next() * 0.08) * sr, rng, sr, { f0: f0 * (0.9 + rng.next() * 0.2), size: 0.5, hardness: 0.85, gain: 1, tone: 0.45 });
    } else if (kind === 1) {
      const hits = 4 + rng.int(4);
      for (let k = 0; k < hits; k++) {
        const t = k * (0.14 + rng.next() * 0.06) * sr;
        metalClang(b, t, rng, sr, { f0: 1900 + rng.next() * 900, ring: 0.12, gain: 0.45, count: 7, spread: 4 });
        stoneHit(b, t, rng, sr, { size: 0.12 + rng.next() * 0.1, gain: 0.6 });
      }
    } else if (kind === 2) {
      // Two-man pit saw: rasping strokes (teeth at ~40-70 per second), push/pull alternating pitch.
      const strokes = 3;
      for (let k = 0; k < strokes; k++) {
        const st = k * 0.38 * sr;
        const n = Math.round(0.34 * sr);
        const bp = new Biquad('bandpass', k % 2 ? 2600 : 3300, 1.2, sr);
        const teeth = 45 + rng.next() * 25;
        let ph = 0;
        for (let i = 0; i < n && st + i < b.length; i++) {
          ph += teeth / sr;
          const tooth = Math.pow(1 - (ph - Math.floor(ph)), 6);
          const env = Math.sin((Math.PI * i) / n);
          b[st + i] += bp.process(rng.bi()) * (0.25 + 0.75 * tooth) * env * 0.9;
        }
      }
    } else {
      woodKnock(b, 0, rng, sr, { size: 0.8, hardness: 0.6, gain: 1, tone: 0.35 });
      debris(b, 0.04 * sr, rng, sr, { count: 5, dur: 0.4, material: 'wood', size: 0.5, gain: 0.5 });
    }
    return b;
  },
  coins(rng, sr) {
    const b = mono(0.9, sr);
    const n = 6 + rng.int(8);
    for (let k = 0; k < n; k++) metalClang(b, Math.pow(rng.next(), 1.5) * 0.4 * sr, rng, sr, { f0: 1700 + rng.next() * 2200, ring: 0.16 + rng.next() * 0.12, gain: 0.35 + 0.4 * rng.next(), count: 5, spread: 3 });
    return b;
  },
  harvest(rng, sr) {
    const b = mono(1.2, sr);
    swish(b, 0, rng, sr, { dur: 0.22, f: [1500, 4200, 2500], q: 5, whistle: 0.3, gain: 0.6 });
    clothRustle(b, 0.15 * sr, rng, sr, { dur: 0.6, f: 1800, gain: 0.5, grain: 0.03 });
    debris(b, 0.22 * sr, rng, sr, { count: 25, dur: 0.5, material: 'earth', size: 0.1, gain: 0.3 });
    return b;
  },
  thunder(rng, sr) {
    const b = mono(9, sr);
    thunder(b, 0, rng, sr, 0.4 + rng.next() * 1.6, 1);
    return b;
  },
  bell(rng, sr) {
    const b = mono(2.4, sr);
    const f0 = S(rng.pick([2, 3 / 2, 5 / 3]), 3);
    chime(b, 0, rng, sr, { f0, t60: 1.8, gain: 1 });
    if (rng.chance(0.6)) chime(b, (0.25 + rng.next() * 0.1) * sr, rng, sr, { f0: f0 * 1.001, t60: 1.5, gain: 0.5 });
    return b;
  },
  // --------------------------------------------------------------------------------------- melee
  sword_light(rng, sr) {
    const b = mono(0.45, sr);
    const p = 0.85 + rng.next() * 0.3;
    swish(b, 0, rng, sr, { dur: 0.2 + rng.next() * 0.1, f: [900 * p, 3300 * p, 1500 * p], q: 3 + rng.next() * 2, whistle: 0.22, peakAt: 0.5 });
    clothRustle(b, 0, rng, sr, { dur: 0.15, f: 2600, gain: 0.12 });
    return b;
  },
  sword_heavy(rng, sr) {
    const b = mono(0.9, sr);
    const p = 0.85 + rng.next() * 0.3;
    swish(b, 0.03 * sr, rng, sr, { dur: 0.48 + rng.next() * 0.14, f: [280 * p, 1350 * p, 480 * p], q: 1.8, whistle: 0.12, body: 0.95, peakAt: 0.55 });
    clothRustle(b, 0, rng, sr, { dur: 0.35, f: 2000, gain: 0.2 });
    // Exhaled effort.
    noiseBurst(b, 0.05 * sr, rng, sr, { dur: 0.2, f: 1100, q: 0.6, gain: 0.08, attack: 0.04 });
    return b;
  },
  parry_ring(rng, sr) {
    const b = mono(2.2, sr);
    bladeRing(b, 0, rng, sr, { f0: 1350 + rng.next() * 800, ring: 0.7 + rng.next() * 0.3, gain: 1, scrape: 0.7 });
    metalClang(b, 0, rng, sr, { f0: 700 + rng.next() * 500, ring: 0.15, gain: 0.45 });
    thud(b, 0, rng, sr, { f: 140, dur: 0.07, gain: 0.3, noise: 0.4 });
    return b;
  },
  block_thud(rng, sr) {
    const b = mono(0.6, sr);
    woodKnock(b, 0, rng, sr, { size: 0.75 + rng.next() * 0.2, hardness: 0.55, gain: 1, damp: 0.6 });
    thud(b, 0, rng, sr, { f: 105 + rng.next() * 30, dur: 0.16, gain: 0.8, noise: 0.45 });
    noiseBurst(b, 0, rng, sr, { dur: 0.04, f: 1300, q: 0.9, gain: 0.35 });
    if (rng.chance(0.35)) metalClang(b, 0.002 * sr, rng, sr, { f0: 900 + rng.next() * 600, ring: 0.1, gain: 0.25 });
    return b;
  },
  roll_cloth(rng, sr) {
    const b = mono(0.8, sr);
    clothRustle(b, 0, rng, sr, { dur: 0.45 + rng.next() * 0.1, f: 2400, gain: 0.8, grain: 0.03 });
    thud(b, (0.22 + rng.next() * 0.08) * sr, rng, sr, { f: 75, dur: 0.15, gain: 0.7, noise: 0.75 });
    debris(b, 0.25 * sr, rng, sr, { count: 10, dur: 0.25, material: 'earth', size: 0.1, gain: 0.25 });
    return b;
  },
  body_hit(rng, sr) {
    const b = mono(0.5, sr);
    thud(b, 0, rng, sr, { f: 85 + rng.next() * 50, dur: 0.12 + rng.next() * 0.06, gain: 1, noise: 0.5, drop: 0.5 });
    noiseBurst(b, 0, rng, sr, { dur: 0.035, f: 2400 + rng.next() * 1200, q: 0.6, gain: 0.45 });
    crackles(b, 0, rng, sr, { dur: 0.05, density: 120, gain: 0.25, fLo: 800, fHi: 3000 });
    return b;
  },
  stagger_grunt(rng, sr) {
    const b = mono(0.8, sr);
    grunt(b, 0, rng, sr, 0.7 + rng.next() * 0.3, 1);
    thud(b, (0.12 + rng.next() * 0.1) * sr, rng, sr, { f: 110, dur: 0.07, gain: 0.25, noise: 0.85 });
    return b;
  },
  salve(rng, sr) {
    const b = mono(2.2, sr);
    // Clay stopper pop, two gulps of the medicinal draught, then a soft rising shimmer (healing cue).
    noiseBurst(b, 0, rng, sr, { dur: 0.02, f: 900, q: 1.2, gain: 0.5 });
    bubble(b, 0.01 * sr, sr, 6, 0.5, 0.3);
    bubble(b, 0.28 * sr, sr, 9, 0.5, 0.2);
    bubble(b, 0.52 * sr, sr, 8, 0.45, 0.2);
    const notes = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2];
    notes.forEach((r, i) => chime(b, (0.6 + i * 0.07) * sr, rng, sr, { f0: S(r, 3), t60: 1, gain: 0.22 + i * 0.02 }));
    return b;
  },
  // ------------------------------------------------------------------- world, construction, siege
  bell_temple(rng, sr) {
    const b = mono(9, sr);
    templeBell(b, 0, rng, sr, { f0: S(rng.pick([2, 3 / 2, 4 / 3]), 1) * (1 + rng.bi() * 0.01), t60: 6.5 + rng.next() * 2 });
    return b;
  },
  construction_complete(rng, sr) {
    const b = mono(3, sr);
    thud(b, 0, rng, sr, { f: 60, dur: 0.5, gain: 0.7, noise: 0.85, drop: 0.2 });
    noiseBurst(b, 0, rng, sr, { dur: 0.6, f: 900, q: 0.4, gain: 0.25, attack: 0.03 });
    chime(b, 0.12 * sr, rng, sr, { f0: S(2, 2), t60: 2, gain: 0.9 });
    chime(b, 0.36 * sr, rng, sr, { f0: S(3, 2), t60: 2, gain: 0.7 });
    crowd(b, 0.35 * sr, rng, sr, { dur: 1.5, voices: 6, mood: 'cheer', excite: 0.5, gain: 0.16 });
    return b;
  },
  landmark_complete(rng, sr) {
    const b = mono(6, sr);
    drumStroke(b, 0, rng, sr, 'nagara', 'boom', SA, 1);
    templeBell(b, 0.05 * sr, rng, sr, { f0: S(2, 1), t60: 6, gain: 0.9 });
    conch(b, 0.5 * sr, rng, sr, { dur: 2.6, f0: S(2, 1) * 1.003, power: 0.7, gain: 0.5 });
    crowd(b, 0.6 * sr, rng, sr, { dur: 3.4, voices: 16, mood: 'cheer', excite: 0.85, gain: 0.32 });
    handBellRinging(b, 0.8 * sr, rng, sr, { f0: S(3, 3), dur: 2.4, gain: 0.25 });
    return b;
  },
  age_up_fanfare(rng, sr) {
    const b = mono(6.5, sr);
    // Nagara roll crescendo into a great stroke, two conches (Sa and Pa), drums answering, the city roars.
    let t = 0;
    for (let k = 0; k < 14; k++) {
      drumStroke(b, t * sr, rng, sr, 'nagara', 'roll', SA, 0.25 + (k / 14) * 0.6);
      t += 0.085 - k * 0.002;
    }
    drumStroke(b, t * sr, rng, sr, 'nagara', 'boom', SA, 1);
    drumStroke(b, t * sr, rng, sr, 'dhol', 'boom', SA, 1);
    conch(b, (t + 0.05) * sr, rng, sr, { dur: 3.2, f0: S(2, 1), power: 0.95, gain: 0.8 });
    conch(b, (t + 0.12) * sr, rng, sr, { dur: 3.0, f0: S(3, 1), power: 0.85, gain: 0.55 });
    [1.1, 1.55, 1.75, 2.3].forEach((dt, i) => drumStroke(b, (t + dt) * sr, rng, sr, i % 2 ? 'dhol' : 'nagara', 'boom', SA, 0.8));
    crowd(b, (t + 0.4) * sr, rng, sr, { dur: 3.4, voices: 18, mood: 'cheer', excite: 1, gain: 0.6 });
    return b;
  },
  market_coins(rng, sr) {
    const b = mono(1.3, sr);
    woodKnock(b, 0, rng, sr, { f0: 260 + rng.next() * 60, size: 0.8, hardness: 0.4, gain: 0.5, damp: 0.6 });
    const n = 20 + rng.int(20);
    for (let k = 0; k < n; k++) metalClang(b, (0.02 + Math.pow(rng.next(), 0.8) * 0.75) * sr, rng, sr, { f0: 1600 + rng.next() * 2400, ring: 0.14 + rng.next() * 0.12, gain: 0.2 + 0.3 * rng.next(), count: 5, spread: 3 });
    return b;
  },
  gate_break(rng, sr) {
    const b = mono(3.2, sr);
    woodKnock(b, 0, rng, sr, { f0: 55 + rng.next() * 15, size: 1, hardness: 0.6, gain: 1.2, tone: 0.6 });
    thud(b, 0, rng, sr, { f: 48, dur: 0.7, gain: 1, noise: 0.7, drop: 0.3 });
    // The splintering crack: a dense burst of fibre snaps over the first half second.
    crackles(b, 0.005 * sr, rng, sr, { dur: 0.5, density: 600, gain: 1.6, fLo: 500, fHi: 4500 });
    noiseBurst(b, 0, rng, sr, { dur: 0.25, f: 1800, q: 0.7, gain: 0.7, attack: 0.002 });
    debris(b, 0.15 * sr, rng, sr, { count: 40, dur: 1.8, material: 'wood', size: 0.6, gain: 0.7 });
    metalClang(b, 0.25 * sr, rng, sr, { f0: 380 + rng.next() * 200, ring: 0.5, gain: 0.35 });
    noiseBurst(b, 0, rng, sr, { dur: 1.6, f: 700, q: 0.4, gain: 0.25, attack: 0.05 });
    return b;
  },
  wall_crumble(rng, sr) {
    const b = mono(3.8, sr);
    thunder(b, 0, rng, sr, 0.9, 0.7);
    stoneHit(b, 0, rng, sr, { size: 1, gain: 1 });
    debris(b, 0.05 * sr, rng, sr, { count: 90 + rng.int(40), dur: 2.6, material: 'stone', size: 0.7, gain: 0.55, decay: 1.4 });
    noiseBurst(b, 0.2 * sr, rng, sr, { dur: 2.2, f: 2500, q: 0.4, gain: 0.12, attack: 0.3 });
    return b;
  },
  ram_hit(rng, sr) {
    const b = mono(1.8, sr);
    woodKnock(b, 0, rng, sr, { f0: 62 + rng.next() * 20, size: 1, hardness: 0.5, gain: 1.3 });
    thud(b, 0, rng, sr, { f: 52, dur: 0.55, gain: 1, noise: 0.5, drop: 0.35 });
    debris(b, 0.02 * sr, rng, sr, { count: 10, dur: 0.6, material: 'wood', size: 0.25, gain: 0.35 });
    metalClang(b, 0.04 * sr, rng, sr, { f0: 300 + rng.next() * 150, ring: 0.35, gain: 0.3 });
    if (rng.chance(0.6)) shout(b, 0.15 * sr, rng, sr, { word: ['a'], dur: 0.35, gain: 0.25 });
    return saturate(b, 2, 0.35);
  },
  fire_crackle(rng, sr) {
    const dur = 2.6;
    const b = mono(dur + 0.2, sr);
    // Roar of the flames (slowly breathing low noise) + crackles + occasional resin pops.
    const lp = new Biquad('lowpass', 380, 0.7, sr);
    const breath = new Drift(rng, 0.6, sr, 0.3, 1);
    const n = Math.round(dur * sr);
    for (let i = 0; i < n; i++) b[i] += lp.process(rng.bi()) * breath.next() * 0.6 * Math.min(1, i / (0.15 * sr), (n - i) / (0.3 * sr));
    crackles(b, 0, rng, sr, { dur: dur - 0.2, density: 30 + rng.next() * 20, gain: 0.7 });
    crackles(b, 0, rng, sr, { dur: dur - 0.2, density: 3, gain: 1.6, fLo: 400, fHi: 2000 });
    return b;
  },
  river_splash(rng, sr) {
    const b = mono(1.6, sr);
    splash(b, 0, rng, sr, 0.25 + rng.next() * 0.5, 1);
    return b;
  },
  footstep_stone(rng, sr) {
    const b = mono(0.22, sr);
    // Leather sandal / bare heel on stone: a short slap, a firm heel tick, grit.
    noiseBurst(b, 0, rng, sr, { dur: 0.018, f: 1700 + rng.next() * 1300, q: 0.9, gain: 0.8 });
    thud(b, 0.004 * sr, rng, sr, { f: 150 + rng.next() * 60, dur: 0.045, gain: 0.6, noise: 0.3 });
    if (rng.chance(0.6)) noiseBurst(b, (0.03 + rng.next() * 0.03) * sr, rng, sr, { dur: 0.05, f: 4500, q: 0.6, gain: 0.12, attack: 0.01 });
    return b;
  },
  footstep_dirt(rng, sr) {
    const b = mono(0.25, sr);
    thud(b, 0, rng, sr, { f: 95 + rng.next() * 40, dur: 0.08, gain: 0.8, noise: 0.8 });
    debris(b, 0.005 * sr, rng, sr, { count: 6 + rng.int(6), dur: 0.06, material: 'earth', size: 0.05, gain: 0.35 });
    noiseBurst(b, 0.01 * sr, rng, sr, { dur: 0.08, f: 3000, q: 0.5, gain: 0.12, attack: 0.01 });
    return b;
  },
  // ------------------------------------------------------------------------------------- internal
  fx_perfect_dodge(rng, sr) {
    const b = mono(1.4, sr);
    swish(b, 0, rng, sr, { dur: 0.7, f: [180, 650, 140], q: 1.5, body: 1, whistle: 0.05, peakAt: 0.4, gain: 0.9 });
    const sh = mono(1.2, sr);
    chime(sh, 0, rng, sr, { f0: S(3, 3), t60: 1, gain: 0.6 });
    chime(sh, 0, rng, sr, { f0: S(2, 4), t60: 0.8, gain: 0.4 });
    reverse(sh);
    addInto(b, sh, 0, 0.6);
    return b;
  },
  fx_finisher_boom(rng, sr) {
    const b = mono(1.4, sr);
    thud(b, 0, rng, sr, { f: 46 + rng.next() * 10, dur: 0.7, gain: 1, noise: 0.35, drop: 0.4 });
    noiseBurst(b, 0, rng, sr, { dur: 0.15, f: 1600, q: 0.5, gain: 0.5 });
    metalClang(b, 0, rng, sr, { f0: 900 + rng.next() * 400, ring: 0.3, gain: 0.3 });
    return saturate(b, 2, 0.35);
  },
  fx_hit_metal(rng, sr) {
    const b = mono(0.8, sr);
    metalClang(b, 0, rng, sr, { f0: 700 + rng.next() * 700, ring: 0.25, gain: 0.8, count: 12 });
    // Scale-coat jingle.
    debris(b, 0.005 * sr, rng, sr, { count: 8, dur: 0.12, material: 'metal', gain: 0.5 });
    return b;
  },
  fx_thunder_far(rng, sr) {
    const b = mono(10, sr);
    thunder(b, 0, rng, sr, 3.5 + rng.next() * 5, 1);
    return b;
  },
};

/** Render one variant of an SFX sound id (finished: DC-free, trimmed, peak-normalized, limited). */
export function renderSfx(id: SfxSoundId, variant: number, sr: number, seed = 0): Float32Array {
  const rng = new Rand(hashSeed('sfx', id, variant, seed));
  const raw = R[id](rng, sr);
  return finishMono(raw, sr, SFX_META[id].peakDb);
}

export function hasSfxRenderer(id: string): id is SfxSoundId {
  return Object.prototype.hasOwnProperty.call(R, id);
}
