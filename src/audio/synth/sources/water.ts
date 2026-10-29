/**
 * Water sources: Minnaert bubbles (van den Doel's rising-pitch damped sinusoid), drips, splashes,
 * river lapping and flowing water beds, fountains.
 * OWNER: Audio Developer (AUD-01). Pure DSP (see synth/core.ts).
 */
import { clamp, type Rand } from '../core';
import { Biquad, Svf } from '../filters';
import { Drift, Pink } from '../osc';
import { noiseBurst, thud } from './impacts';

/**
 * One bubble of radius `rMm` (mm): f0 ~ 3.26 kHz / r, damping and upward chirp from van den Doel (2005).
 */
export function bubble(out: Float32Array, offset: number, sr: number, rMm: number, amp: number, chirp = 0.1): void {
  const f0 = clamp(3260 / Math.max(0.15, rMm), 150, 15000);
  const beta = 0.043 * f0 + 0.0014 * Math.pow(f0, 1.5);
  const n = Math.min(out.length - Math.round(offset), Math.round((7 / beta) * sr));
  const o = Math.round(offset);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    if (o + i < 0) continue;
    const t = i / sr;
    const f = f0 * (1 + chirp * beta * t);
    ph += f / sr;
    const env = Math.exp(-beta * t) * Math.min(1, i / (0.0004 * sr));
    out[o + i] += Math.sin(2 * Math.PI * ph) * env * amp;
  }
}

/** A single drip into still water (stepwell / eaves): a pluck of surface + one or two bubbles. */
export function drip(out: Float32Array, offset: number, rng: Rand, sr: number, gain = 1): void {
  noiseBurst(out, offset, rng, sr, { dur: 0.004, f: 4000, q: 1, gain: 0.15 * gain });
  bubble(out, offset + 0.002 * sr, sr, 1.6 + rng.next() * 2.2, 0.8 * gain, 0.12 + rng.next() * 0.1);
  if (rng.chance(0.5)) bubble(out, offset + (0.01 + rng.next() * 0.03) * sr, sr, 0.8 + rng.next() * 1.2, 0.3 * gain);
}

/** Splash: impact burst + a cloud of bubbles + droplets falling back. `size` 0..1 (oar .. body). */
export function splash(out: Float32Array, offset: number, rng: Rand, sr: number, size: number, gain = 1): void {
  const s = clamp(size, 0, 1);
  noiseBurst(out, offset, rng, sr, { dur: 0.05 + 0.25 * s, f: 1800 - 900 * s, q: 0.45, gain: 0.9 * gain });
  noiseBurst(out, offset, rng, sr, { dur: 0.12 + 0.5 * s, f: 5200, q: 0.4, type: 'highpass', gain: 0.35 * gain });
  if (s > 0.35) thud(out, offset, rng, sr, { f: 70 + 40 * (1 - s), dur: 0.2 + 0.3 * s, gain: 0.5 * gain * s, noise: 0.7 });
  const nb = Math.round(25 + 140 * s);
  for (let k = 0; k < nb; k++) {
    const t = Math.pow(rng.next(), 1.7) * (0.12 + 0.6 * s);
    bubble(out, offset + t * sr, sr, 0.6 + Math.pow(rng.next(), 2) * (2 + 6 * s), gain * (0.05 + 0.2 * rng.next()) * (1 - t), 0.1 + rng.next() * 0.15);
  }
  const nd = Math.round(6 + 30 * s);
  for (let k = 0; k < nd; k++) {
    const t = 0.15 + s * 0.4 + rng.next() * (0.3 + 0.6 * s);
    drip(out, offset + t * sr, rng, sr, gain * (0.04 + 0.12 * rng.next()));
  }
}

/**
 * Flowing water bed: band-limited noise "sheet" with slow flow modulation + a field of bubbles and
 * small laps. `kind`: 'lap' (river edge lapping, rhythmic swells), 'river' (broad flow), 'fountain'
 * (bright splashing fall).
 */
export function waterBed(out: Float32Array, rng: Rand, sr: number, kind: 'lap' | 'river' | 'fountain', gain = 1): void {
  const n = out.length;
  const pink = new Pink();
  const svf = new Svf(sr, 900, 0.6);
  const hi = new Biquad('highpass', kind === 'fountain' ? 1200 : 250, 0.6, sr);
  const flow = new Drift(rng, kind === 'lap' ? 1.6 : 3.5, sr, 0.35, 1);
  const tone = new Drift(rng, 2.7, sr, 0.6, 1.4);
  const lapPeriod = 2.2 + rng.next() * 1.2;
  const base = kind === 'fountain' ? 2600 : kind === 'river' ? 700 : 1100;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 31) === 0) svf.setFreq(base * tone.next(), 0.55);
    const f = flow.next();
    let amp = f;
    if (kind === 'lap') {
      // Soft swells as small waves reach the steps.
      const ph = (t / lapPeriod) % 1;
      amp *= 0.35 + 0.65 * Math.pow(Math.sin(Math.PI * ph), 3);
    }
    svf.process(pink.process(rng.bi()));
    const x = hi.process(svf.band * 1.2 + svf.low * (kind === 'river' ? 0.9 : 0.3));
    out[i] += x * amp * gain * (kind === 'fountain' ? 0.9 : 1.1);
  }
  // Bubble field.
  const rate = kind === 'fountain' ? 110 : kind === 'river' ? 55 : 30;
  let t = rng.expo(rate);
  const dur = n / sr;
  while (t < dur) {
    const r = kind === 'fountain' ? 0.4 + Math.pow(rng.next(), 2) * 2.2 : 0.8 + Math.pow(rng.next(), 2) * 5;
    bubble(out, t * sr, sr, r, gain * (0.02 + 0.08 * rng.next()), 0.08 + rng.next() * 0.12);
    t += rng.expo(rate);
  }
  if (kind === 'lap') {
    let s = rng.next() * 2;
    while (s < dur) {
      splash(out, s * sr, rng, sr, 0.05 + rng.next() * 0.1, gain * 0.25);
      s += lapPeriod * (0.8 + rng.next() * 0.9);
    }
  }
}
