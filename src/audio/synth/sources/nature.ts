/**
 * Nature sources: wind with gusts and whistles, rain (light / monsoon) with drop patter, thunder
 * (crack + rolling rumble), birds of the Gangetic plain (koel, bulbul, sparrows, dove, peacock, myna),
 * night crickets, monsoon frogs and noon cicadas.
 * OWNER: Audio Developer (AUD-01). Pure DSP (see synth/core.ts).
 */
import { clamp, type Rand } from '../core';
import { Biquad, Svf } from '../filters';
import { Brown, Drift, Pink, sin01 } from '../osc';
import { bubble } from './water';

/** Wind bed: `strength` 0..1 (breeze .. dust storm), whistle in gusts, leaf rustle. Adds into out. */
export function windBed(out: Float32Array, rng: Rand, sr: number, strength: number, gain = 1): void {
  const s = clamp(strength, 0, 1);
  const n = out.length;
  const brown = new Brown();
  const pink = new Pink();
  const body = new Svf(sr, 300, 0.7);
  const whistle = new Svf(sr, 900, 9);
  const leaves = new Biquad('highpass', 2500, 0.7, sr);
  const gust = new Drift(rng, 2.8 - 1.4 * s, sr, 0.15, 1);
  const slow = new Drift(rng, 9, sr, 0.5, 1);
  const wfreq = new Drift(rng, 1.7, sr, 0.7, 1.5);
  let leafGrain = 0;
  for (let i = 0; i < n; i++) {
    const g = gust.next() * slow.next();
    if ((i & 31) === 0) {
      body.setFreq(180 + 900 * g * (0.4 + s), 0.6);
      whistle.setFreq((500 + 900 * s) * wfreq.next(), 7 + 6 * s);
    }
    const b = brown.process(rng.bi());
    const p = pink.process(rng.bi());
    body.process(b * 0.8 + p * 0.4);
    whistle.process(p);
    if (rng.next() < 0.003 + 0.02 * g) leafGrain = 0.4 + rng.next();
    leafGrain *= 0.9993;
    const leaf = leaves.process(p) * (0.15 + leafGrain) * g * (1 - 0.5 * s);
    const w = whistle.band * Math.max(0, g - 0.45) * (0.2 + 0.9 * s);
    out[i] += (body.low * 1.2 + body.band * 0.6 + w * 0.9 + leaf * 0.5) * (0.35 + 0.65 * g) * gain;
  }
}

/** Rain bed: drop patter on leaves / roofs / earth + hiss; monsoon adds dense heavy drops and roof roar. */
export function rainBed(out: Float32Array, rng: Rand, sr: number, intensity: number, gain = 1): void {
  const k = clamp(intensity, 0, 1);
  const n = out.length;
  const pink = new Pink();
  const hiss = new Biquad('bandpass', 4500, 0.4, sr);
  const roar = new Svf(sr, 700, 0.6);
  const swell = new Drift(rng, 4, sr, 0.7, 1);
  for (let i = 0; i < n; i++) {
    const p = pink.process(rng.bi());
    roar.process(p);
    out[i] += (hiss.process(p) * (0.3 + 0.5 * k) + roar.band * 0.6 * k) * swell.next() * gain;
  }
  // Drops: tiny clicks (leaves, thatch) and small bubbles (puddles).
  const rate = 250 + 2400 * k;
  const dur = n / sr;
  let t = rng.expo(rate);
  while (t < dur) {
    const at = Math.round(t * sr);
    if (rng.chance(0.35)) {
      bubble(out, at, sr, 0.5 + rng.next() * 2.5, gain * (0.01 + 0.05 * rng.next()), 0.1);
    } else {
      const f = 2000 + rng.next() * 7000;
      const bq = new Biquad('bandpass', f, 1.5 + rng.next() * 3, sr);
      const len = Math.round((0.001 + rng.next() * 0.004) * sr);
      const amp = gain * (0.08 + 0.4 * Math.pow(rng.next(), 2));
      for (let i = 0; i < len * 3 && at + i < n; i++) out[at + i] += bq.process(i < len ? rng.bi() * (1 - i / len) : 0) * amp;
    }
    t += rng.expo(rate);
  }
}

/**
 * Thunder: `distanceKm` 0.3 (crack overhead) .. 8 (low distant roll). Crack = a cluster of sharp
 * broadband ruptures; rumble = brown noise through a low-pass with random rolling swells.
 */
export function thunder(out: Float32Array, offset: number, rng: Rand, sr: number, distanceKm: number, gain = 1): void {
  const d = clamp(distanceKm, 0.2, 10);
  const o = Math.round(offset);
  const dur = Math.min((out.length - o) / sr, 3.5 + d * 0.6 + rng.next() * 2);
  const n = Math.round(dur * sr);
  const brown = new Brown();
  const lp = new Svf(sr, 300, 0.7);
  const cut = clamp(2400 / (1 + d * 1.6), 90, 1800);
  // Rolling: sum of a few decaying swells at random times.
  const rolls: { t: number; a: number; w: number }[] = [];
  const nr = 3 + rng.int(5);
  for (let r = 0; r < nr; r++) rolls.push({ t: Math.pow(rng.next(), 1.4) * dur * 0.6, a: 0.4 + rng.next() * 0.6, w: 0.3 + rng.next() * 1.2 });
  const crack = d < 2 ? 1 - d / 2 : 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 31) === 0) lp.setFreq(cut * (0.6 + 0.8 * Math.exp(-t * 1.5)), 0.7);
    let env = 0;
    for (const r of rolls) {
      const x = t - r.t;
      if (x > 0) env += r.a * (x < 0.08 ? x / 0.08 : Math.exp(-(x - 0.08) / r.w));
    }
    env *= Math.exp(-t / (dur * 0.55)) * Math.min(1, t / (0.02 + d * 0.06));
    lp.process(brown.process(rng.bi()));
    out[o + i] += (lp.low * 1.6 + lp.band * 0.5) * env * gain;
  }
  if (crack > 0) {
    // Ruptures: 3-8 very short, very loud broadband bursts in the first 150 ms, then a tearing tail.
    const hp = new Biquad('highpass', 300, 0.6, sr);
    const nb = 3 + rng.int(6);
    for (let b = 0; b < nb; b++) {
      const at = o + Math.round(rng.next() * 0.15 * sr);
      const len = Math.round((0.005 + rng.next() * 0.03) * sr);
      for (let i = 0; i < len * 6 && at + i < out.length; i++) {
        const e = i < len ? 1 : Math.exp(-(i - len) / (len * 1.5));
        out[at + i] += hp.process(rng.bi()) * e * crack * gain * (0.6 + rng.next() * 0.8);
      }
    }
  }
}

export type BirdSpecies = 'koel' | 'bulbul' | 'sparrow' | 'dove' | 'peacock' | 'myna' | 'kingfisher';

/** Whistled tone along a pitch path (Hz keys over 0..1 of dur) with harmonics and amplitude shape. */
function whistle(out: Float32Array, offset: number, sr: number, dur: number, path: readonly number[], amp: number, h2 = 0.15, h3 = 0.05, vib = 0, vibHz = 30): void {
  const n = Math.round(dur * sr);
  const o = Math.round(offset);
  let ph = 0;
  for (let i = 0; i < n && o + i < out.length; i++) {
    if (o + i < 0) continue;
    const u = i / n;
    const x = u * (path.length - 1);
    const k = Math.min(path.length - 2, Math.floor(x));
    const f0 = (path[k] as number) + ((path[k + 1] as number) - (path[k] as number)) * (x - k);
    const f = f0 * (1 + vib * Math.sin((2 * Math.PI * vibHz * i) / sr));
    ph += f / sr;
    const env = Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 0.7;
    out[o + i] += (sin01(ph) + h2 * sin01(2 * ph) + h3 * sin01(3 * ph)) * env * amp;
  }
}

/** One call (or call sequence) of a bird species. Returns seconds used. */
export function birdCall(out: Float32Array, offset: number, rng: Rand, sr: number, species: BirdSpecies, gain = 1): number {
  const g = gain;
  switch (species) {
    case 'koel': {
      // "ku-OO", repeated 3-6 times, rising in pitch and urgency (the herald of summer).
      const reps = 3 + rng.int(4);
      let t = 0;
      let base = 620 + rng.next() * 80;
      for (let r = 0; r < reps; r++) {
        whistle(out, offset + t * sr, sr, 0.12, [base * 0.8, base * 0.85], 0.35 * g, 0.1, 0.03);
        whistle(out, offset + (t + 0.15) * sr, sr, 0.32, [base, base * 1.32, base * 1.22], 0.6 * g, 0.12, 0.04);
        t += 0.62 - r * 0.03;
        base *= 1.05;
      }
      return t;
    }
    case 'bulbul': {
      // Liquid bubbling phrase of 4-7 short whistles.
      const notes = 4 + rng.int(4);
      let t = 0;
      for (let k = 0; k < notes; k++) {
        const f = 1500 + rng.next() * 1500;
        const d = 0.06 + rng.next() * 0.1;
        whistle(out, offset + t * sr, sr, d, [f, f * (0.8 + rng.next() * 0.5), f * (0.9 + rng.next() * 0.3)], 0.45 * g, 0.2, 0.05);
        t += d + 0.02 + rng.next() * 0.05;
      }
      return t;
    }
    case 'sparrow': {
      // Bursts of 3-8 quick chirps (3-6 kHz FM sweeps).
      const n = 3 + rng.int(6);
      let t = 0;
      for (let k = 0; k < n; k++) {
        const f = 3600 + rng.next() * 1800;
        whistle(out, offset + t * sr, sr, 0.04 + rng.next() * 0.03, [f * 1.2, f, f * 0.85], 0.3 * g, 0.25, 0.1);
        t += 0.07 + rng.next() * 0.09;
      }
      return t;
    }
    case 'dove': {
      // Spotted dove: soft "croo-cuck-crooo" in the 400-600 Hz range with a throaty vibrato.
      const f = 470 + rng.next() * 60;
      whistle(out, offset, sr, 0.35, [f * 0.95, f, f * 0.97], 0.35 * g, 0.3, 0.1, 0.03, 22);
      whistle(out, offset + 0.42 * sr, sr, 0.18, [f * 1.05, f * 0.98], 0.3 * g, 0.3, 0.1, 0.03, 22);
      whistle(out, offset + 0.68 * sr, sr, 0.6, [f * 0.98, f * 1.02, f * 0.9], 0.38 * g, 0.3, 0.1, 0.04, 20);
      return 1.3;
    }
    case 'peacock': {
      // Loud nasal "may-AWW" (two blasts), harsh harmonics - monsoon and dusk.
      const f = 520 + rng.next() * 80;
      const blast = (at: number, d: number, path: readonly number[]): void => {
        const n = Math.round(d * sr);
        const o = Math.round(offset + at * sr);
        let ph = 0;
        const bp = new Biquad('bandpass', 1600, 1.2, sr);
        for (let i = 0; i < n && o + i < out.length; i++) {
          const u = i / n;
          const x = u * (path.length - 1);
          const k = Math.min(path.length - 2, Math.floor(x));
          const fr = (path[k] as number) + ((path[k + 1] as number) - (path[k] as number)) * (x - k);
          ph += fr / sr;
          const saw = 2 * (ph - Math.floor(ph)) - 1;
          const env = Math.sin(Math.PI * Math.min(1, u * 1.1)) ** 0.5;
          out[o + i] += (bp.process(saw) * 1.5 + saw * 0.15) * env * 0.5 * g;
        }
      };
      blast(0, 0.32, [f, f * 1.35, f * 1.25]);
      blast(0.42, 0.5, [f * 1.1, f * 1.5, f * 1.1]);
      return 1.0;
    }
    case 'myna': {
      // Chattering mix of clicks, gurgles and whistles.
      const n = 5 + rng.int(6);
      let t = 0;
      for (let k = 0; k < n; k++) {
        const f = 900 + rng.next() * 2600;
        const d = 0.04 + rng.next() * 0.14;
        whistle(out, offset + t * sr, sr, d, [f, f * (0.6 + rng.next() * 0.9), f * (0.7 + rng.next())], 0.4 * g, 0.35, 0.2, rng.chance(0.4) ? 0.06 : 0, 45);
        t += d + 0.03 + rng.next() * 0.08;
      }
      return t;
    }
    case 'kingfisher': {
      // Rattling descending trill near water.
      const n = 8 + rng.int(8);
      let t = 0;
      for (let k = 0; k < n; k++) {
        const f = 3800 - k * 90 + rng.next() * 200;
        whistle(out, offset + t * sr, sr, 0.035, [f, f * 0.9], 0.35 * g, 0.2, 0.05);
        t += 0.055;
      }
      return t;
    }
  }
  return 0;
}

/** Night crickets: a chorus of chirpers, each with its own carrier, pulse rate and chirp period. */
export function cricketsBed(out: Float32Array, rng: Rand, sr: number, count: number, gain = 1): void {
  const n = out.length;
  for (let c = 0; c < count; c++) {
    const carrier = 3800 + rng.next() * 1600;
    const pulseHz = 25 + rng.next() * 25;
    const pulses = 2 + rng.int(4);
    const period = 0.3 + rng.next() * 0.5;
    const amp = gain * (0.15 + 0.6 * Math.pow(rng.next(), 2));
    const phase0 = rng.next() * period;
    let ph = rng.next();
    for (let i = 0; i < n; i++) {
      const t = i / sr + phase0;
      const inChirp = t % period;
      const pIdx = Math.floor(inChirp * pulseHz);
      ph += carrier / sr;
      if (pIdx >= pulses) continue;
      const pu = inChirp * pulseHz - pIdx;
      const e = pu < 0.6 ? Math.sin((Math.PI * pu) / 0.6) : 0;
      out[i] += sin01(ph) * e * amp;
    }
  }
}

/** Monsoon frogs: pulsed low croaks (formant-like band of a buzzy source). */
export function frogsBed(out: Float32Array, rng: Rand, sr: number, count: number, gain = 1): void {
  const n = out.length;
  for (let c = 0; c < count; c++) {
    const f0 = 180 + rng.next() * 260;
    const bp = new Biquad('bandpass', 700 + rng.next() * 900, 3, sr);
    const period = 0.6 + rng.next() * 1.4;
    const burst = 0.12 + rng.next() * 0.25;
    const pulseHz = 18 + rng.next() * 30;
    const amp = gain * (0.2 + 0.6 * rng.next());
    const off = rng.next() * period;
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = (i / sr + off) % period;
      ph += f0 / sr;
      let x = 0;
      if (t < burst) {
        const pu = (t * pulseHz) % 1;
        x = (2 * (ph - Math.floor(ph)) - 1) * (pu < 0.5 ? 1 : 0.15) * Math.sin((Math.PI * t) / burst);
      }
      out[i] += bp.process(x) * amp;
    }
  }
}

/** Noon cicadas: a shimmering high buzz that swells and fades. */
export function cicadaBed(out: Float32Array, rng: Rand, sr: number, gain = 1): void {
  const n = out.length;
  const bp = new Biquad('bandpass', 5200 + rng.next() * 1500, 2.5, sr);
  const swell = new Drift(rng, 3.5, sr, 0, 1);
  let ph = 0;
  const am = 160 + rng.next() * 80;
  for (let i = 0; i < n; i++) {
    ph += am / sr;
    const s = Math.pow(swell.next(), 2);
    out[i] += bp.process(rng.bi()) * (0.5 + 0.5 * sin01(ph)) * s * gain;
  }
}
