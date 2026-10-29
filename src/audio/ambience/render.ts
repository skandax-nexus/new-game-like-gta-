/**
 * Ambience renderers (worker / node only): seamless mono bed loops and spot one-shots for every
 * AMBIENCE_DEFS key, plus `simulateAmbience` - an offline mix of a layer exactly as the runtime plays it
 * (two offset bed playheads for decorrelated stereo + Poisson-scheduled spots placed around the listener
 * with the spatial model's distance gain, air absorption and reverb send). Used by tests/audio and
 * scripts/audio/render.mjs.
 * OWNER: Audio Developer (AUD-01).
 */
import { addInto, frames, mono, rms, type Stereo, stereoOf } from '../synth/buffer';
import { dbToGain, hashSeed, Rand } from '../synth/core';
import { Biquad, Svf } from '../synth/filters';
import { farAway, finishMono, foldLoop, limit, wrapAdd } from '../synth/mix';
import { Brown, Drift, Pink } from '../synth/osc';
import { FdnReverb } from '../synth/reverb';
import { handBellRinging, jingles, oxBell, templeBell } from '../synth/sources/bells';
import { drumStroke } from '../synth/sources/drums';
import { bladeRing, clothRustle, creak, debris, metalClang, noiseBurst, thud, woodKnock } from '../synth/sources/impacts';
import { birdCall, type BirdSpecies, cicadaBed, cricketsBed, frogsBed, rainBed, thunder, windBed } from '../synth/sources/nature';
import { chant, children, crowCaws, crowd, elephantRumble, elephantTrumpet, grunt, shout, streetCall } from '../synth/sources/voices';
import { voice } from '../synth/voice';
import { drip, splash, waterBed } from '../synth/sources/water';
import { swish } from '../synth/sources/whoosh';
import { conch, warHorn } from '../synth/sources/winds';
import { airAbsorptionHz, distanceGain, reverbSend } from '../spatial/model';
import { type AmbienceDef, ambienceDef, BATTLE_DRUM_BPM, bedSeconds, firstSpotDelay, SPOT_ROLLOFF, type SpotSpec } from './meta';

const SA = 138.59;
/** RMS every bed is normalized to before its `gainDb` trim. */
export const BED_RMS_DB = -22;

type BedRenderer = (rng: Rand, sr: number, seconds: number) => Float32Array;
type SpotRenderer = (rng: Rand, sr: number) => Float32Array;

/** Render `seconds + xf` of a continuous process and fold it into a seamless loop. */
function folded(seconds: number, sr: number, fill: (b: Float32Array) => void, xfSec = 2): Float32Array {
  const loop = frames(seconds, sr);
  const xf = frames(Math.min(xfSec, seconds * 0.3), sr);
  const b = new Float32Array(loop + xf);
  fill(b);
  return foldLoop(b, loop, xf);
}

/** Render events into [0, seconds) (+ tail) and wrap the tail onto the head. */
function wrapped(seconds: number, tailSec: number, sr: number, fill: (b: Float32Array) => void): Float32Array {
  const loop = frames(seconds, sr);
  const b = new Float32Array(loop + frames(tailSec, sr));
  fill(b);
  return wrapAdd(b, loop);
}

function birdField(b: Float32Array, rng: Rand, sr: number, perSec: number, species: readonly BirdSpecies[], gain: number, far: boolean): void {
  const dur = b.length / sr;
  let t = rng.next() * 0.5;
  while (t < dur - 1.5) {
    const tmp = mono(3, sr);
    birdCall(tmp, 0, rng, sr, rng.pick(species), 1);
    if (far) new Biquad('lowpass', 2500 + rng.next() * 2500, 0.6, sr).run(tmp);
    addInto(b, tmp, t * sr, gain * (0.3 + 0.7 * rng.next()));
    t += rng.expo(perSec);
  }
}

function drumPattern(b: Float32Array, rng: Rand, sr: number, bars: number, bpm: number): void {
  const beat = 60 / bpm;
  // War march: nagara on 1 and 3 (accent on 1), dhol eighths with rim accents, a flam into each 4th bar.
  for (let bar = 0; bar < bars; bar++) {
    const t0 = bar * 4 * beat;
    drumStroke(b, t0 * sr, rng, sr, 'nagara', 'boom', SA, 0.95);
    drumStroke(b, (t0 + 2 * beat) * sr, rng, sr, 'nagara', 'boom', SA, 0.7);
    for (let e = 0; e < 8; e++) {
      const tt = t0 + e * beat * 0.5 + rng.gauss() * 0.006;
      const accent = e === 3 || e === 7;
      if (e % 2 === 1 || accent) drumStroke(b, tt * sr, rng, sr, 'dhol', accent ? 'rim' : 'boom', SA, accent ? 0.85 : 0.45 + 0.15 * rng.next());
    }
    if (bar % 4 === 3) drumStroke(b, (t0 + 3.5 * beat) * sr, rng, sr, 'nagara', 'flam', SA, 0.8);
  }
}

/** Mono reverb wash (stone hall / stepwell) baked into a mono buffer. */
function hall(buf: Float32Array, sr: number, rt60: number, wet: number, size = 1.6, damping = 4500): Float32Array {
  const rv = new FdnReverb(sr, { rt60, damping, size, predelayMs: 18 });
  const o = new Float64Array(2);
  for (let i = 0; i < buf.length; i++) {
    rv.tick(buf[i], buf[i], o);
    buf[i] = buf[i] * (1 - wet * 0.5) + (o[0] + o[1]) * 0.5 * wet;
  }
  return buf;
}

function toMonoFar(src: Float32Array, sr: number, distance: number, rng: Rand, tail = 2.5): Float32Array {
  const s = farAway(src, sr, distance, rng, tail);
  const out = new Float32Array(s.L.length);
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * (s.L[i] + s.R[i]);
  return out;
}

// ------------------------------------------------------------------------------------------------ beds

const BEDS: Record<string, BedRenderer> = {
  river_lap: (rng, sr, s) => folded(s, sr, (b) => waterBed(b, rng, sr, 'lap')),
  scribes_counting: (rng, sr, s) =>
    wrapped(s, 3, sr, (b) => {
      crowd(b, 0, rng, sr, { dur: s, voices: 4, mood: 'court', excite: 0.1, gain: 0.6, women: 0, swell: false });
      hall(b, sr, 1.2, 0.35, 0.9);
    }),
  bazaar_crowd: (rng, sr, s) =>
    wrapped(s, 3, sr, (b) => {
      crowd(b, 0, rng, sr, { dur: s, voices: 14, mood: 'murmur', excite: 0.55, women: 0.4, swell: false });
      // Distant market activity: pans, baskets, a far coin or two.
      for (let k = 0; k < Math.round(s * 1.5); k++) {
        const t = rng.next() * s * sr;
        if (rng.chance(0.5)) woodKnock(b, t, rng, sr, { size: 0.5, tone: 0.2, gain: 0.08 });
        else metalClang(b, t, rng, sr, { f0: 900 + rng.next() * 1500, ring: 0.2, gain: 0.04, count: 6 });
      }
    }),
  chanting_low: (rng, sr, s) =>
    wrapped(s, 2, sr, (b) => {
      chant(b, 0, rng, sr, { dur: s + 1, voices: 4, tonic: SA * 0.75, gain: 1 });
      hall(b, sr, 2.4, 0.45, 1.8, 3500);
    }),
  water_drip: (rng, sr, s) =>
    folded(s, sr, (b) => {
      // Stepwell room tone: a low, resonant hush.
      const br = new Brown();
      const bp = new Biquad('bandpass', 180, 1.5, sr);
      for (let i = 0; i < b.length; i++) b[i] = bp.process(br.process(rng.bi())) * 0.5 + br.process(rng.bi()) * 0.05;
    }),
  court_murmur: (rng, sr, s) =>
    wrapped(s, 3, sr, (b) => {
      crowd(b, 0, rng, sr, { dur: s, voices: 9, mood: 'court', excite: 0.3, women: 0.35, swell: false });
      hall(b, sr, 2.2, 0.5, 2.0, 4000);
    }),
  fountain: (rng, sr, s) => folded(s, sr, (b) => waterBed(b, rng, sr, 'fountain')),
  potters_wheel: (rng, sr, s) =>
    folded(s, sr, (b) => {
      // A stick-spun potter's wheel: the heavy stone-weighted rim whirrs (a low hum with a rhythmic
      // "swish" each turn from its uneven rim), wet clay hisses under the hands, the pivot ticks.
      const turn = 1.4 + rng.next() * 0.6;
      const br = new Brown();
      const hum = new Svf(sr, 140, 3);
      const whirr = new Svf(sr, 520, 2.5);
      const clay = new Biquad('bandpass', 2400, 0.9, sr);
      const pink = new Pink();
      const hands = new Drift(rng, 1.5, sr, 0.2, 1);
      for (let i = 0; i < b.length; i++) {
        const ph = ((i / sr) * turn) % 1;
        const swish = Math.pow(Math.sin(Math.PI * ph), 8);
        const x = pink.process(rng.bi());
        hum.process(br.process(rng.bi()));
        whirr.process(x);
        b[i] = hum.band * 1.2 + whirr.band * (0.15 + 0.6 * swish) + clay.process(x) * 0.08 * hands.next();
      }
      for (let t = 0; t < b.length / sr; t += 1 / turn) woodKnock(b, (t + 0.5 / turn) * sr, rng, sr, { f0: 900 + rng.next() * 100, size: 0.1, tone: 0.3, gain: 0.05 });
    }),
  river_wide: (rng, sr, s) => folded(s, sr, (b) => waterBed(b, rng, sr, 'river')),
  chanting_far: (rng, sr, s) =>
    wrapped(s, 3, sr, (b) => {
      const tmp = mono(s + 1, sr);
      chant(tmp, 0, rng, sr, { dur: s + 1, voices: 6, tonic: SA, gain: 1 });
      addInto(b, toMonoFar(tmp, sr, 260, rng, 3), 0, 1);
    }),
  wind: (rng, sr, s) => folded(s, sr, (b) => windBed(b, rng, sr, 0.35), 3),
  wind_storm: (rng, sr, s) => folded(s, sr, (b) => windBed(b, rng, sr, 0.95), 3),
  rain_light: (rng, sr, s) => folded(s, sr, (b) => rainBed(b, rng, sr, 0.25)),
  rain_monsoon: (rng, sr, s) => folded(s, sr, (b) => rainBed(b, rng, sr, 0.92)),
  dawn_birds: (rng, sr, s) => wrapped(s, 3, sr, (b) => birdField(b, rng, sr, 2.2, ['bulbul', 'sparrow', 'myna', 'koel', 'dove'], 0.6, true)),
  cicadas: (rng, sr, s) => folded(s, sr, (b) => cicadaBed(b, rng, sr)),
  night_crickets: (rng, sr, s) => folded(s, sr, (b) => cricketsBed(b, rng, sr, 16)),
  night_frogs: (rng, sr, s) => folded(s, sr, (b) => frogsBed(b, rng, sr, 10)),
  battle_roar: (rng, sr, s) =>
    folded(s, sr, (b) => {
      crowd(b, 0, rng, sr, { dur: b.length / sr, voices: 16, mood: 'roar', excite: 0.85, women: 0, swell: false });
      // The melee itself: a constant patter of distant blades, shields and trampling.
      const dur = b.length / sr;
      let t = 0;
      while (t < dur) {
        const at = t * sr;
        const k = rng.weighted([3, 3, 2]);
        if (k === 0) metalClang(b, at, rng, sr, { f0: 900 + rng.next() * 1800, ring: 0.15, gain: 0.12, count: 8 });
        else if (k === 1) woodKnock(b, at, rng, sr, { size: 0.6, tone: 0.2, gain: 0.15 });
        else thud(b, at, rng, sr, { f: 90, dur: 0.1, gain: 0.15, noise: 0.8 });
        t += rng.expo(14);
      }
      const br = new Brown();
      const lp = new Biquad('lowpass', 160, 0.7, sr);
      for (let i = 0; i < b.length; i++) b[i] += lp.process(br.process(rng.bi())) * 0.5;
    }, 1.5),
  battle_drums: (rng, sr, s) =>
    wrapped(s, 3, sr, (b) => {
      const tmp = mono(s + 3, sr);
      drumPattern(tmp, rng, sr, 8, BATTLE_DRUM_BPM);
      addInto(b, toMonoFar(tmp.subarray(0, Math.round(s * sr)), sr, 180, rng, 2.5), 0, 1);
      // Re-add the pattern's own overhang (strokes ringing past the loop end) through the same distance.
      addInto(b, toMonoFar(tmp.subarray(Math.round(s * sr)), sr, 180, rng, 1), Math.round(s * sr), 1);
    }),
};

// ----------------------------------------------------------------------------------------------- spots

const NOTE = (r: number, oct = 0): number => SA * r * Math.pow(2, oct);

function adultLaugh(b: Float32Array, rng: Rand, sr: number): void {
  const female = rng.chance(0.5);
  const n = 3 + rng.int(4);
  const f0 = female ? 230 + rng.next() * 60 : 130 + rng.next() * 40;
  const pd = 0.13 + rng.next() * 0.05;
  const dur = n * pd + 0.1;
  const amp: [number, number][] = [[0, 0]];
  for (let k = 0; k < n; k++) amp.push([k * pd + 0.012, 1 - k * 0.1], [k * pd + pd * 0.55, 0.04]);
  amp.push([dur, 0]);
  voice(b, 0, { duration: dur, f0: [[0, f0 * 1.2], [dur, f0 * 0.85]], amp, vowels: [[0, 'a']], kind: female ? 'female' : 'male', breath: 0.4, jitter: 0.02 }, rng, sr);
}

const SPOTS: Record<string, SpotRenderer> = {
  'river_lap:lap_splash': (rng, sr) => {
    const b = mono(1.2, sr);
    splash(b, 0, rng, sr, 0.05 + rng.next() * 0.12, 1);
    return b;
  },
  'temple_bells_far:handbell_far': (rng, sr) => {
    const b = mono(5, sr);
    handBellRinging(b, 0, rng, sr, { f0: 1000 + rng.next() * 700, dur: 1.5 + rng.next() * 2.5 });
    return b;
  },
  'temple_bells_far:ghanta_far': (rng, sr) => {
    const b = mono(7, sr);
    templeBell(b, 0, rng, sr, { f0: NOTE(rng.pick([1, 4 / 3, 3 / 2]), 1), t60: 6 });
    return b;
  },
  'boatmen_calls:boatman_call': (rng, sr) => {
    const b = mono(4, sr);
    const base = NOTE(rng.pick([1, 9 / 8, 4 / 3]), 1);
    const melodies = [
      [1, 1, 5 / 4, 9 / 8],
      [1, 9 / 8, 4 / 3, 9 / 8, 1],
      [4 / 3, 5 / 4, 9 / 8, 1],
    ];
    const m = rng.pick(melodies);
    streetCall(b, 0, rng, sr, { notes: m.map((r) => base * r), vowels: ['o', 'o', 'a', 'e', 'o'], noteDur: 0.42 + rng.next() * 0.15 });
    return b;
  },
  'boatmen_calls:oar': (rng, sr) => {
    const b = mono(1.4, sr);
    creak(b, 0, rng, sr, { dur: 0.35, f: 220 + rng.next() * 120, gain: 0.5, formant: 700 });
    splash(b, 0.3 * sr, rng, sr, 0.12 + rng.next() * 0.1, 0.8);
    return b;
  },
  'crows:crow': (rng, sr) => {
    const b = mono(2.5, sr);
    crowCaws(b, 0, rng, sr, 1);
    return b;
  },
  'threshing:flail': (rng, sr) => {
    const b = mono(3, sr);
    const n = 3 + rng.int(4);
    const period = 0.55 + rng.next() * 0.2;
    for (let k = 0; k < n; k++) {
      const t = k * period * sr;
      swish(b, t - 0.12 * sr, rng, sr, { dur: 0.14, f: [500, 1500, 700], q: 2, gain: 0.2 });
      thud(b, t, rng, sr, { f: 110 + rng.next() * 40, dur: 0.12, gain: 1, noise: 0.85 });
      debris(b, t, rng, sr, { count: 10, dur: 0.15, material: 'earth', size: 0.04, gain: 0.25 });
    }
    return b;
  },
  'threshing:winnow': (rng, sr) => {
    const b = mono(3.2, sr);
    const n = 3 + rng.int(3);
    for (let k = 0; k < n; k++) {
      const t = k * (0.6 + rng.next() * 0.15) * sr;
      clothRustle(b, t, rng, sr, { dur: 0.35, f: 2200, gain: 0.7, grain: 0.06 });
      debris(b, t + 0.1 * sr, rng, sr, { count: 18, dur: 0.3, material: 'earth', size: 0.02, gain: 0.2 });
    }
    return b;
  },
  'scribes_counting:count_voice': (rng, sr) => {
    const b = mono(3.5, sr);
    const syl = 4 + rng.int(4);
    const sd = 0.26 + rng.next() * 0.08;
    const dur = syl * sd;
    const f0 = 120 + rng.next() * 30;
    const vowels: (readonly [number, 'a' | 'e' | 'i' | 'o' | 'u'])[] = [];
    const amp: [number, number][] = [[0, 0]];
    const pitch: [number, number][] = [];
    for (let k = 0; k < syl; k++) {
      vowels.push([k * sd, rng.pick(['e', 'a', 'i', 'a', 'u'] as const)]);
      amp.push([k * sd + 0.02, 0.9], [k * sd + sd * 0.6, 0.6], [k * sd + sd * 0.9, 0.05]);
      pitch.push([k * sd, f0 * (k === syl - 1 ? 0.9 : 1.05)], [k * sd + sd * 0.8, f0 * 0.97]);
    }
    voice(b, 0, { duration: dur, f0: pitch, amp, vowels, breath: 0.2, jitter: 0.01, glide: 0.03 }, rng, sr);
    return hall(b, sr, 1, 0.25, 0.8);
  },
  'scribes_counting:stylus': (rng, sr) => {
    const b = mono(1.2, sr);
    const n = 2 + rng.int(4);
    for (let k = 0; k < n; k++) noiseBurst(b, (k * 0.18 + rng.next() * 0.05) * sr, rng, sr, { dur: 0.08 + rng.next() * 0.1, f: 4500 + rng.next() * 2000, q: 1.5, gain: 0.6, attack: 0.02 });
    return b;
  },
  'scribes_counting:weights': (rng, sr) => {
    const b = mono(1.5, sr);
    woodKnock(b, 0, rng, sr, { size: 0.3, tone: 0.4, gain: 0.4 });
    for (let k = 0; k < 2 + rng.int(2); k++) metalClang(b, (0.08 + k * 0.12 + rng.next() * 0.05) * sr, rng, sr, { f0: 1400 + rng.next() * 900, ring: 0.3, gain: 0.5, count: 7, spread: 3 });
    return b;
  },
  'oxcarts:oxcart': (rng, sr) => {
    const dur = 5.5;
    const b = mono(dur + 0.5, sr);
    const turn = 0.9 + rng.next() * 0.3;
    for (let t = 0; t < dur - 0.4; t += turn) creak(b, t * sr, rng, sr, { dur: 0.35 + rng.next() * 0.2, f: 150 + rng.next() * 120, gain: 0.5, formant: 650 });
    for (let t = 0.2; t < dur - 0.3; t += 0.45 + rng.next() * 0.1) thud(b, t * sr, rng, sr, { f: 120, dur: 0.06, gain: 0.35, noise: 0.85 });
    for (let t = 0.1; t < dur - 0.5; t += 1.2 + rng.next() * 0.8) woodKnock(b, t * sr, rng, sr, { size: 0.7, tone: 0.3, gain: 0.35 });
    oxBell(b, 0.3 * sr, rng, sr, { strikes: 4 + rng.int(3), gain: 0.6 });
    // Pass-by envelope.
    for (let i = 0; i < b.length; i++) {
      const u = i / b.length;
      b[i] *= 0.25 + 0.75 * Math.sin(Math.PI * u);
    }
    return b;
  },
  'bazaar_crowd:laugh': (rng, sr) => {
    const b = mono(1.5, sr);
    adultLaugh(b, rng, sr);
    return b;
  },
  'bazaar_crowd:bargain': (rng, sr) => {
    const b = mono(3, sr);
    crowd(b, 0, rng, sr, { dur: 2.6, voices: 2, mood: 'murmur', excite: 0.7, women: 0.5 });
    return b;
  },
  'hawkers:hawker': (rng, sr) => {
    const b = mono(4, sr);
    const female = rng.chance(0.35);
    const base = (female ? 2 : 1) * NOTE(rng.pick([1, 9 / 8, 5 / 4, 4 / 3]), 1);
    const shapes = [
      [1, 5 / 4, 5 / 4, 1],
      [4 / 3, 5 / 4, 9 / 8, 1, 1],
      [1, 1, 9 / 8, 5 / 4, 9 / 8],
      [3 / 2, 4 / 3, 5 / 4],
      [1, 9 / 8, 1],
    ];
    const m = rng.pick(shapes);
    streetCall(b, 0, rng, sr, { notes: m.map((r) => base * r * 0.5), vowels: rng.pick([['a', 'o', 'e', 'a'], ['e', 'a', 'o'], ['o', 'a', 'a', 'e']] as const), noteDur: 0.22 + rng.next() * 0.12, kind: female ? 'female' : 'male' });
    return b;
  },
  'copper_beaten:copper': (rng, sr) => {
    const b = mono(3, sr);
    const n = 5 + rng.int(6);
    const f0 = 650 + rng.next() * 700;
    const per = 0.18 + rng.next() * 0.08;
    for (let k = 0; k < n; k++) {
      const accent = k % 3 === 2;
      metalClang(b, (k * per + rng.gauss() * 0.01) * sr, rng, sr, { f0: f0 * (accent ? 0.92 : 1) * (1 + rng.bi() * 0.02), ring: 0.45, gain: accent ? 1 : 0.6, count: 12, spread: 5 });
    }
    return b;
  },
  'cart_bells:cartbell': (rng, sr) => {
    const b = mono(4, sr);
    jingles(b, 0, rng, sr, { dur: 2.5 + rng.next(), gain: 0.8 });
    oxBell(b, 0.2 * sr, rng, sr, { strikes: 3, gain: 0.5 });
    return b;
  },
  'temple_bells:handbell': (rng, sr) => {
    const b = mono(6, sr);
    handBellRinging(b, 0, rng, sr, { f0: 1100 + rng.next() * 800, dur: 2 + rng.next() * 3 });
    return b;
  },
  'temple_bells:ghanta': (rng, sr) => {
    const b = mono(8, sr);
    templeBell(b, 0, rng, sr, { f0: NOTE(rng.pick([2, 3 / 2, 4 / 3, 5 / 3]), 1), t60: 6.5 });
    if (rng.chance(0.5)) templeBell(b, (1.6 + rng.next()) * sr, rng, sr, { f0: NOTE(2, 1), t60: 6, gain: 0.7 });
    return b;
  },
  'water_drip:drip': (rng, sr) => {
    // One drip "plink", its echo in the stone shaft.
    const b = mono(1.8, sr);
    drip(b, 0, rng, sr, 1);
    return hall(b, sr, 1.6, 0.55, 1.3, 5000);
  },
  'court_murmur:bangles': (rng, sr) => {
    const b = mono(1.4, sr);
    jingles(b, 0, rng, sr, { dur: 0.6 + rng.next() * 0.4, shakes: 2 + rng.int(3), gain: 0.8 });
    return b;
  },
  'court_murmur:herald': (rng, sr) => {
    const b = mono(4, sr);
    const base = NOTE(rng.pick([1, 9 / 8]), 1) * 0.5 * 2;
    streetCall(b, 0, rng, sr, { notes: [base, base * 9 / 8, base * 5 / 4, base * 5 / 4, base * 9 / 8], vowels: ['a', 'a', 'o', 'a', 'e'], noteDur: 0.45 });
    return hall(b, sr, 2, 0.4, 2, 4000);
  },
  'conch_far:conch_far': (rng, sr) => {
    const tmp = mono(3.2, sr);
    conch(tmp, 0, rng, sr, { dur: 2.5 + rng.next() * 0.6, f0: 300 + rng.next() * 60, power: 0.8 });
    return toMonoFar(tmp, sr, 450, rng, 3);
  },
  'drill_drums:drill': (rng, sr) => {
    const bpm = 112 + rng.next() * 16;
    const beat = 60 / bpm;
    const bars = 2;
    const b = mono(bars * 4 * beat + 1.5, sr);
    for (let bar = 0; bar < bars; bar++) {
      const t0 = bar * 4 * beat;
      for (let q = 0; q < 4; q++) drumStroke(b, (t0 + q * beat) * sr, rng, sr, 'dhol', q === 0 ? 'boom' : q === 2 ? 'rim' : 'boom', SA, q === 0 ? 0.9 : 0.55);
      drumStroke(b, (t0 + 3.5 * beat) * sr, rng, sr, 'dhol', 'rim', SA, 0.6);
      // Unison drill shout and stamp on 1 and 3.
      for (const q of [0, 2]) {
        for (let m = 0; m < 8; m++) shout(b, (t0 + q * beat + rng.gauss() * 0.02) * sr, rng, sr, { word: ['a'], dur: 0.22, gain: 0.12 });
        for (let m = 0; m < 8; m++) thud(b, (t0 + q * beat + rng.gauss() * 0.02) * sr, rng, sr, { f: 100, dur: 0.07, gain: 0.12, noise: 0.85 });
      }
    }
    return b;
  },
  'elephant_rumble:rumble': (rng, sr) => {
    const b = mono(3.5, sr);
    elephantRumble(b, 0, rng, sr, 1);
    return b;
  },
  'elephant_rumble:trumpet_far': (rng, sr) => {
    const tmp = mono(2.2, sr);
    elephantTrumpet(tmp, 0, rng, sr, 1);
    return toMonoFar(tmp, sr, 120, rng, 1.8);
  },
  'elephant_rumble:chains': (rng, sr) => {
    const b = mono(1.6, sr);
    const n = 4 + rng.int(6);
    for (let k = 0; k < n; k++) metalClang(b, (k * 0.07 + rng.next() * 0.05) * sr, rng, sr, { f0: 900 + rng.next() * 1200, ring: 0.15, gain: 0.5, count: 6 });
    return b;
  },
  'blades_clash:sparring': (rng, sr) => {
    const b = mono(4, sr);
    let t = 0;
    const n = 3 + rng.int(4);
    for (let k = 0; k < n; k++) {
      const at = t * sr;
      if (rng.chance(0.6)) bladeRing(b, at, rng, sr, { f0: 1300 + rng.next() * 700, ring: 0.35, gain: 0.8, scrape: 0.4 });
      else woodKnock(b, at, rng, sr, { size: 0.7, tone: 0.3, gain: 0.8 });
      if (rng.chance(0.3)) grunt(b, at + 0.05 * sr, rng, sr, 0.6, 0.35);
      thud(b, at - 0.1 * sr, rng, sr, { f: 110, dur: 0.06, gain: 0.25, noise: 0.85 });
      t += 0.35 + rng.next() * 0.4;
    }
    return b;
  },
  'potters_wheel:clay_slap': (rng, sr) => {
    const b = mono(0.6, sr);
    thud(b, 0, rng, sr, { f: 180 + rng.next() * 60, dur: 0.08, gain: 0.8, noise: 0.6 });
    noiseBurst(b, 0, rng, sr, { dur: 0.05, f: 900, q: 0.8, gain: 0.6 });
    return b;
  },
  'looms:loom': (rng, sr) => {
    const cycles = 3 + rng.int(3);
    const per = 0.85 + rng.next() * 0.2;
    const b = mono(cycles * per + 0.6, sr);
    const beater = 420 + rng.next() * 120;
    for (let c = 0; c < cycles; c++) {
      const t0 = c * per;
      swish(b, t0 * sr, rng, sr, { dur: 0.18, f: [1200, 2600, 1500], q: 2.5, gain: 0.35 });
      woodKnock(b, (t0 + 0.3) * sr, rng, sr, { f0: beater, size: 0.4, tone: 0.55, gain: 0.9 });
      woodKnock(b, (t0 + 0.37) * sr, rng, sr, { f0: beater * 1.1, size: 0.3, tone: 0.4, gain: 0.35 });
      thud(b, (t0 + 0.55) * sr, rng, sr, { f: 95, dur: 0.08, gain: 0.5, noise: 0.6 });
    }
    return b;
  },
  'children:child': (rng, sr) => {
    const b = mono(2, sr);
    children(b, 0, rng, sr, 1);
    return b;
  },
  'river_wide:fish_jump': (rng, sr) => {
    const b = mono(1.2, sr);
    splash(b, 0, rng, sr, 0.08 + rng.next() * 0.1, 1);
    return b;
  },
  'river_wide:kingfisher': (rng, sr) => {
    const b = mono(1.5, sr);
    birdCall(b, 0, rng, sr, 'kingfisher');
    return b;
  },
  'conch:conch_near': (rng, sr) => {
    const b = mono(3.2, sr);
    conch(b, 0, rng, sr, { dur: 2.4 + rng.next() * 0.6, f0: 310 + rng.next() * 60, power: 0.8 });
    return b;
  },
  'rain_monsoon:peacock': (rng, sr) => {
    const b = mono(1.4, sr);
    birdCall(b, 0, rng, sr, 'peacock');
    return b;
  },
  'thunder_far:thunder': (rng, sr) => {
    const b = mono(10, sr);
    thunder(b, 0, rng, sr, 3 + rng.next() * 5, 1);
    return b;
  },
  'dawn_birds:koel': (rng, sr) => {
    const b = mono(4.5, sr);
    birdCall(b, 0, rng, sr, 'koel');
    return b;
  },
  'dawn_birds:bulbul': (rng, sr) => {
    const b = mono(1.5, sr);
    birdCall(b, 0, rng, sr, 'bulbul');
    return b;
  },
  'dawn_birds:sparrows': (rng, sr) => {
    const b = mono(1.2, sr);
    birdCall(b, 0, rng, sr, 'sparrow');
    return b;
  },
  'dawn_birds:dove': (rng, sr) => {
    const b = mono(1.6, sr);
    birdCall(b, 0, rng, sr, 'dove');
    return b;
  },
  'day_birds:myna': (rng, sr) => {
    const b = mono(1.8, sr);
    birdCall(b, 0, rng, sr, 'myna');
    return b;
  },
  'day_birds:sparrows': (rng, sr) => {
    const b = mono(1.2, sr);
    birdCall(b, 0, rng, sr, 'sparrow');
    return b;
  },
  'day_birds:dove': (rng, sr) => {
    const b = mono(1.6, sr);
    birdCall(b, 0, rng, sr, 'dove');
    return b;
  },
  'day_birds:kingfisher': (rng, sr) => {
    const b = mono(1.5, sr);
    birdCall(b, 0, rng, sr, 'kingfisher');
    return b;
  },
  'night_crickets:owl': (rng, sr) => {
    // Spotted owlet / hawk-owl: soft "hoo-hoo".
    const b = mono(1.6, sr);
    const f = 420 + rng.next() * 120;
    for (const [t, d] of [[0, 0.22], [0.42, 0.3]] as const) {
      const n = Math.round(d * sr);
      for (let i = 0; i < n; i++) {
        const u = i / n;
        b[Math.round(t * sr) + i] += Math.sin((2 * Math.PI * f * (1 + 0.04 * u) * i) / sr) * Math.sin(Math.PI * u) * 0.8;
      }
    }
    return b;
  },
  'night_crickets:jackals': (rng, sr) => {
    const b = mono(4, sr);
    const n = 3 + rng.int(4);
    for (let k = 0; k < n; k++) {
      const d = 0.8 + rng.next() * 1.2;
      const f0 = 500 + rng.next() * 350;
      voice(b, (k * 0.35 + rng.next() * 0.3) * sr, {
        duration: d,
        f0: [[0, f0 * 0.7], [d * 0.4, f0 * 1.2], [d, f0 * 0.8]],
        amp: [[0, 0], [0.1, 0.8], [d * 0.7, 1], [d, 0]],
        vowels: [[0, 'u'], [d * 0.4, 'a'], [d * 0.8, 'o']],
        kind: 'animal',
        formantShift: 1.5,
        breath: 0.3,
        jitter: 0.02,
        vibrato: [6, 50],
      }, rng, sr, 0.6);
    }
    return b;
  },
  'battle_roar:war_cry': (rng, sr) => {
    const b = mono(2.2, sr);
    crowd(b, 0, rng, sr, { dur: 1.8, voices: 8, mood: 'roar', excite: 1, women: 0 });
    return b;
  },
  'battle_roar:melee': (rng, sr) => {
    const b = mono(1.4, sr);
    const n = 3 + rng.int(5);
    for (let k = 0; k < n; k++) {
      const t = rng.next() * 0.8 * sr;
      if (rng.chance(0.5)) bladeRing(b, t, rng, sr, { f0: 1100 + rng.next() * 1200, ring: 0.2, gain: 0.5, scrape: 0.3 });
      else woodKnock(b, t, rng, sr, { size: 0.6, tone: 0.25, gain: 0.6 });
    }
    if (rng.chance(0.5)) grunt(b, rng.next() * 0.6 * sr, rng, sr, 0.8, 0.4);
    return b;
  },
  'battle_drums:horn_far': (rng, sr) => {
    const tmp = mono(2.6, sr);
    const f0 = 135 + rng.next() * 30;
    warHorn(tmp, 0, rng, sr, { dur: 2, f0, f1: f0 * 1.5, leapAt: 0.35 });
    return toMonoFar(tmp, sr, 350, rng, 2.5);
  },
};

// ------------------------------------------------------------------------------------------- public

export function bedSampleRate(def: AmbienceDef, sr: number): number {
  return def.bed?.rate === 'half' ? Math.round(sr / 2) : sr;
}

/** Render the seamless mono loop of an ambience bed at the context rate (halved for 'half' beds). */
export function renderBed(key: string, sr: number, seed = 0): { data: Float32Array; sampleRate: number } {
  const def = ambienceDef(key);
  const fn = BEDS[key];
  if (!def?.bed || !fn) throw new Error(`ambience: no bed for "${key}"`);
  const rate = bedSampleRate(def, sr);
  const rng = new Rand(hashSeed('bed', key, seed));
  const data = fn(rng, rate, bedSeconds(def));
  // Loudness-normalize (RMS), then keep the peak under the ceiling. A seamless loop must not be faded.
  const r = rms(data);
  if (r > 1e-9) {
    const g = dbToGain(BED_RMS_DB) / r;
    for (let i = 0; i < data.length; i++) data[i] *= g;
  }
  limit([data], rate, -1.5, 2, 400);
  for (let i = 0; i < data.length; i++) if (!(Math.abs(data[i]) > 1e-20)) data[i] = 0;
  return { data, sampleRate: rate };
}

export function renderSpot(key: string, name: string, variant: number, sr: number, seed = 0): Float32Array {
  const fn = SPOTS[`${key}:${name}`];
  if (!fn) throw new Error(`ambience: no spot "${key}:${name}"`);
  const rng = new Rand(hashSeed('spot', key, name, variant, seed));
  return finishMono(fn(rng, sr), sr, -3);
}

export function hasBedRenderer(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(BEDS, key);
}

export function hasSpotRenderer(key: string, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(SPOTS, `${key}:${name}`);
}

/**
 * Offline mix of one ambience layer as the runtime plays it, at layer gain 1: bed (L/R playheads half a
 * loop apart, 70% decorrelated) + spots (Poisson schedule, random azimuth and distance from the spot
 * spec, distance gain / air absorption / reverb send from the spatial model).
 */
export function simulateAmbience(key: string, seconds: number, sr: number, seed = 0): Stereo {
  const def = ambienceDef(key);
  if (!def) throw new Error(`ambience: unknown key "${key}"`);
  const out = stereoOf(frames(seconds, sr));
  const n = out.L.length;
  if (def.bed) {
    const bed = renderBed(key, sr, seed);
    const g = dbToGain(def.bed.gainDb);
    const ratio = bed.sampleRate / sr;
    const len = bed.data.length;
    const half = Math.floor(len / 2);
    for (let i = 0; i < n; i++) {
      const p = i * ratio;
      const k = Math.floor(p);
      const f = p - k;
      const a = bed.data[k % len] * (1 - f) + bed.data[(k + 1) % len] * f;
      const b = bed.data[(k + half) % len] * (1 - f) + bed.data[(k + half + 1) % len] * f;
      out.L[i] += (a * 0.85 + b * 0.15) * g;
      out.R[i] += (b * 0.85 + a * 0.15) * g;
    }
  }
  const rng = new Rand(hashSeed('sim', key, seed));
  const rv = new FdnReverb(sr, { rt60: 1.8, damping: 5000, size: 1.4 });
  const sendL = new Float32Array(n);
  const sendR = new Float32Array(n);
  const cache = new Map<string, Float32Array>();
  for (const spot of def.spots) {
    let t = firstSpotDelay(spot, rng.next());
    while (t < seconds) {
      const v = rng.int(spot.variants);
      const ck = `${spot.name}#${v}`;
      let src = cache.get(ck);
      if (!src) {
        src = renderSpot(key, spot.name, v, sr, seed);
        cache.set(ck, src);
      }
      placeSpot(out, sendL, sendR, src, t, spot, rng, sr);
      t += rng.expo(spot.perMinute / 60);
    }
  }
  const o = new Float64Array(2);
  for (let i = 0; i < n; i++) {
    rv.tick(sendL[i], sendR[i], o);
    out.L[i] += o[0];
    out.R[i] += o[1];
  }
  limit([out.L, out.R], sr, -1.2);
  return out;
}

function placeSpot(out: Stereo, sendL: Float32Array, sendR: Float32Array, src: Float32Array, t: number, spot: SpotSpec, rng: Rand, sr: number): void {
  const d = spot.distance[0] + (spot.distance[1] - spot.distance[0]) * rng.next();
  const az = rng.bi() * Math.PI;
  const gDb = spot.gainDb[0] + (spot.gainDb[1] - spot.gainDb[0]) * rng.next();
  const near = spot.distance[0];
  const g = dbToGain(gDb) * distanceGain(d, near, spot.distance[1] * 4, SPOT_ROLLOFF);
  const lp = new Biquad('lowpass', airAbsorptionHz(d), 0.6, sr);
  const send = reverbSend(0.15, d, near) * 0.6;
  const pan = Math.sin(az);
  const p = (pan + 1) * 0.25 * Math.PI;
  const gl = Math.cos(p);
  const gr = Math.sin(p);
  const o = Math.round(t * sr);
  for (let i = 0; i < src.length && o + i < out.L.length; i++) {
    const x = lp.process(src[i]) * g;
    out.L[o + i] += x * gl;
    out.R[o + i] += x * gr;
    sendL[o + i] += x * send * gl;
    sendR[o + i] += x * send * gr;
  }
}

/** Every spot sound id an ambience key needs (bank warm-up lists). */
export function spotNames(key: string): string[] {
  return (ambienceDef(key)?.spots ?? []).map((s) => s.name);
}

