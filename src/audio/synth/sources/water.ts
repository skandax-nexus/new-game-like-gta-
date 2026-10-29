/**
 * Water sources: Minnaert bubbles (van den Doel's rising-pitch damped sinusoid), drips, splashes,
 * river lapping and flowing water beds, fountains.
 * OWNER: Audio Developer (AUD-01). Pure DSP (see synth/core.ts).
 */
import { clamp, type Rand } from '../core';
import { Biquad, Svf } from '../filters';
import { Brown, Drift, Pink } from '../osc';
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
 * Flowing water beds (adds into out):
 *  - 'river': a slow, wide river - a dark flow body (brown noise < 600 Hz, breathing), a gurgle field of
 *    Minnaert bubbles (400-1600 Hz) and a faint surface ripple band; almost nothing above 4 kHz.
 *  - 'lap': water slapping the ghat steps - a quiet flow body plus a slosh every 2-4 s (a band-limited
 *    swell with a bubble cluster at its crest and a few drips after).
 *  - 'fountain': water falling onto water and stone - dense granular splatter (short band-passed grains
 *    1.5-6 kHz with log-normal levels), a mid hiss and fine bubbles.
 */
export function waterBed(out: Float32Array, rng: Rand, sr: number, kind: 'lap' | 'river' | 'fountain', gain = 1): void {
  const n = out.length;
  const dur = n / sr;
  if (kind === 'fountain') {
    const hiss = new Svf(sr, 2200, 0.7);
    const pink = new Pink();
    const flick = new Drift(rng, 0.35, sr, 0.75, 1);
    for (let i = 0; i < n; i++) {
      hiss.process(pink.process(rng.bi()));
      out[i] += hiss.band * 0.35 * flick.next() * gain;
    }
    // Splatter grains.
    const rate = 900;
    let t = rng.expo(rate);
    const bq = new Biquad('bandpass', 3000, 2.5, sr);
    while (t < dur) {
      const at = Math.round(t * sr);
      const len = Math.round((0.0015 + rng.next() * 0.006) * sr);
      bq.set('bandpass', 1500 + Math.pow(rng.next(), 1.5) * 4500, 2 + rng.next() * 3, sr);
      bq.reset();
      const amp = gain * Math.exp(rng.gauss() * 0.8) * 0.05;
      for (let i = 0; i < len * 3 && at + i < n; i++) out[at + i] += bq.process(i < len ? rng.bi() * (1 - i / len) : 0) * amp;
      t += rng.expo(rate);
    }
    let b = rng.expo(60);
    while (b < dur) {
      bubble(out, b * sr, sr, 0.5 + Math.pow(rng.next(), 2) * 2.5, gain * (0.01 + 0.04 * rng.next()), 0.1);
      b += rng.expo(60);
    }
    return;
  }
  // Flow body (both river and lap).
  const brown = new Brown();
  const body = new Svf(sr, 500, 0.6);
  const breath = new Drift(rng, kind === 'river' ? 4.5 : 3, sr, 0.45, 1);
  const ripple = new Svf(sr, 1800, 1.2);
  const ripAmp = new Drift(rng, 0.25, sr, 0, 1);
  const pink = new Pink();
  const bodyGain = kind === 'river' ? 1.4 : 0.45;
  for (let i = 0; i < n; i++) {
    body.process(brown.process(rng.bi()));
    ripple.process(pink.process(rng.bi()));
    const r = ripAmp.next();
    out[i] += (body.low * bodyGain * breath.next() + ripple.band * 0.18 * r * r) * gain;
  }
  // Gurgle field.
  const rate = kind === 'river' ? 45 : 14;
  let t = rng.expo(rate);
  while (t < dur) {
    bubble(out, t * sr, sr, 2 + Math.pow(rng.next(), 1.5) * 6, gain * (0.03 + 0.1 * rng.next()), 0.08 + rng.next() * 0.1);
    t += rng.expo(rate) * (rng.chance(0.3) ? 0.2 : 1);
  }
  if (kind === 'lap') {
    // Sloshes against the steps.
    let s = rng.next() * 1.5;
    while (s < dur) {
      const len = Math.round((0.7 + rng.next() * 0.6) * sr);
      const at = Math.round(s * sr);
      const sv = new Svf(sr, 700, 0.8);
      const pk = 0.25 + rng.next() * 0.15;
      const amp = gain * (0.5 + 0.5 * rng.next());
      for (let i = 0; i < len && at + i < n; i++) {
        const u = i / len;
        if ((i & 31) === 0) sv.setFreq(400 + 1400 * Math.sin(Math.PI * Math.min(1, u * 1.4)), 0.8);
        const e = u < pk ? Math.pow(u / pk, 2) : Math.pow(1 - (u - pk) / (1 - pk), 2.2);
        sv.process(pink.process(rng.bi()));
        out[at + i] += sv.band * e * amp * 0.9;
      }
      const crest = s + pk * (len / sr);
      for (let k = 0; k < 10 + rng.int(14); k++) bubble(out, (crest + rng.next() * 0.35) * sr, sr, 1 + Math.pow(rng.next(), 2) * 5, gain * (0.04 + 0.1 * rng.next()), 0.12);
      for (let k = 0; k < 2 + rng.int(4); k++) drip(out, (crest + 0.3 + rng.next() * 0.6) * sr, rng, sr, gain * 0.15);
      s += 2.1 + rng.next() * 1.8;
    }
  }
}
