/**
 * Air sources: blade swishes (light / heavy), arrow flights with fletching flutter, bowstring twangs
 * and generic whooshes (cloth, roll, perfect dodge). A swish is band-passed noise whose centre sweeps
 * like a Doppler pass, with an approach-pass-recede amplitude curve and a faint edge whistle.
 * OWNER: Audio Developer (AUD-01). Pure DSP (see synth/core.ts).
 */
import { clamp, type Rand } from '../core';
import { Biquad, Svf } from '../filters';
import { pluck } from '../string';
import { thud } from './impacts';

export interface SwishOpts {
  dur: number;
  /** Centre frequency at the start, at the closest pass, at the end. */
  f: readonly [number, number, number];
  /** Filter resonance (2-6 airy, 8-14 whistling edge). */
  q?: number;
  /** Fraction of the duration where the blade passes closest (amplitude peak). */
  peakAt?: number;
  /** Extra low-mid body (heavy weapons, big cloth). */
  body?: number;
  /** Edge whistle amount (tonal component). */
  whistle?: number;
  gain?: number;
}

export function swish(out: Float32Array, offset: number, rng: Rand, sr: number, o: SwishOpts): void {
  const n = Math.round(o.dur * sr);
  const off = Math.round(offset);
  const svf = new Svf(sr, o.f[0], o.q ?? 3);
  const wsvf = new Svf(sr, o.f[1] * 1.8, 18);
  const bodyLp = new Biquad('lowpass', 420, 0.7, sr);
  const peak = clamp(o.peakAt ?? 0.45, 0.1, 0.9);
  const g = o.gain ?? 1;
  const body = o.body ?? 0;
  const wh = o.whistle ?? 0.15;
  for (let i = 0; i < n && off + i < out.length; i++) {
    if (off + i < 0) continue;
    const u = i / n;
    if ((i & 7) === 0) {
      // Exponential glide start -> pass -> end.
      const f = u < peak ? o.f[0] * Math.pow(o.f[1] / o.f[0], u / peak) : o.f[1] * Math.pow(o.f[2] / o.f[1], (u - peak) / (1 - peak));
      svf.setFreq(f, o.q ?? 3);
      wsvf.setFreq(f * 1.8, 18);
    }
    // Approach slowly (power rise), recede fast; peak = 1.
    const env = u < peak ? Math.pow(u / peak, 2.2) : Math.pow(1 - (u - peak) / (1 - peak), 1.6);
    const x = rng.bi();
    svf.process(x);
    wsvf.process(x);
    const air = svf.band;
    const tone = wsvf.band * wh * 2;
    const low = body > 0 ? bodyLp.process(x) * body * 1.5 : 0;
    out[off + i] += (air + tone + low) * env * g;
  }
}

/** One arrow passing: whistle + flutter (amplitude modulation from the fletching). */
export function arrowFlight(out: Float32Array, offset: number, rng: Rand, sr: number, opts: { dur?: number; gain?: number; pitch?: number } = {}): void {
  const dur = opts.dur ?? 0.45 + rng.next() * 0.35;
  const n = Math.round(dur * sr);
  const off = Math.round(offset);
  const p = opts.pitch ?? 1;
  const svf = new Svf(sr, 2400 * p, 6);
  const flutterHz = 60 + rng.next() * 90;
  const g = opts.gain ?? 1;
  let ph = rng.next();
  for (let i = 0; i < n && off + i < out.length; i++) {
    if (off + i < 0) continue;
    const u = i / n;
    if ((i & 7) === 0) svf.setFreq(p * (3200 - 1700 * u), 6);
    ph += flutterHz / sr;
    const flutter = 0.65 + 0.35 * Math.sin(2 * Math.PI * ph);
    const env = Math.sin(Math.PI * Math.pow(u, 0.7));
    out[off + i] += svf.process(rng.bi()) * env * flutter * g;
  }
}

/** Bowstring release: damped low pluck + wood thump of the bow limbs + a slap of the string on the bracer. */
export function bowTwang(out: Float32Array, offset: number, rng: Rand, sr: number, gain = 1): void {
  const tmp = new Float32Array(Math.round(0.35 * sr));
  pluck(tmp, 0, { freq: 95 + rng.next() * 70, duration: 0.35, t60: 0.22, brightness: 0.55, hardness: 0.9, pickPosition: 0.5 }, rng, sr);
  const off = Math.round(offset);
  for (let i = 0; i < tmp.length && off + i < out.length; i++) if (off + i >= 0) out[off + i] += tmp[i] * gain * 0.9;
  thud(out, offset, rng, sr, { f: 160, dur: 0.06, gain: 0.35 * gain, noise: 0.7 });
}
