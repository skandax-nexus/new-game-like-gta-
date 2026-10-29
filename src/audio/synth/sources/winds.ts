/**
 * Lip-buzzed wind sources: shankha (conch) and narsingha / turya war horns. A pulse "lip" source whose
 * brightness follows blowing pressure, a pitch that pops up into the note and wobbles, breath noise,
 * and fixed body resonances (the conch's spiral bore, the horn's flare).
 * OWNER: Audio Developer (AUD-01). Pure DSP (see synth/core.ts).
 */
import { clamp, type Rand } from '../core';
import { Biquad, Resonator, Svf } from '../filters';
import { BlepOsc, Drift } from '../osc';

export interface ConchOpts {
  dur: number;
  /** Fundamental (Hz). Shankha ~ 280-420 Hz. */
  f0: number;
  /** 0..1 blowing power: brightness and overblown octave. */
  power?: number;
  /** Final fall-off in semitones (the characteristic droop at the end of a blast). */
  fall?: number;
  gain?: number;
}

/** Shankha blast. */
export function conch(out: Float32Array, offset: number, rng: Rand, sr: number, o: ConchOpts): void {
  const n = Math.round(o.dur * sr);
  const off = Math.round(offset);
  const pw = clamp(o.power ?? 0.7, 0, 1);
  const osc = new BlepOsc(rng.next());
  const osc2 = new BlepOsc(rng.next());
  const bright = new Svf(sr, 800, 0.8);
  const body = [new Resonator(sr), new Resonator(sr), new Resonator(sr)];
  body[0]?.set(o.f0 * 2.05, 180);
  body[1]?.set(1450 + rng.next() * 150, 260);
  body[2]?.set(2900 + rng.next() * 300, 420);
  const wob = new Drift(rng, 0.45, sr, -1, 1);
  const breathBp = new Biquad('bandpass', o.f0 * 3, 0.8, sr);
  const fall = o.fall ?? 1.5;
  const g = o.gain ?? 1;
  const attack = 0.12 + rng.next() * 0.08;
  const release = Math.min(0.5, o.dur * 0.25);
  for (let i = 0; i < n && off + i < out.length; i++) {
    if (off + i < 0) continue;
    const t = i / sr;
    // Pressure envelope: fast swell, slight sag, sustain, release.
    const pres = t < attack ? Math.pow(t / attack, 1.5) : t > o.dur - release ? Math.max(0, (o.dur - t) / release) : 1 - 0.08 * Math.sin(Math.min(1, (t - attack) / 0.5) * Math.PI);
    // Pitch: scoops up ~1.2 semitones into the note, wobbles, droops at the end.
    let st = -1.2 * Math.exp(-t / 0.09) + 0.18 * wob.next();
    if (t > o.dur - release) st -= fall * Math.pow((t - (o.dur - release)) / release, 1.5);
    const f = o.f0 * Math.pow(2, st / 12);
    // Lip pulse narrows with pressure (brighter), plus the overblown octave at high power.
    const pwDuty = 0.5 - 0.32 * pres * (0.5 + 0.5 * pw);
    const src = osc.pulse(f, sr, pwDuty) + 0.35 * pw * pres * osc2.saw(f * 2.003, sr);
    if ((i & 15) === 0) bright.setFreq(500 + 3200 * pres * (0.4 + 0.6 * pw), 0.7);
    bright.process(src);
    let x = bright.low;
    let y = 0;
    for (const r of body) y += r.process(x);
    x = x * 0.5 + y * 0.35;
    const br = breathBp.process(rng.bi()) * (0.18 + 0.25 * (1 - pres));
    out[off + i] += (x + br) * pres * g;
  }
}

export interface HornOpts {
  dur: number;
  /** Starting and target fundamentals (Hz); narsingha "wah-WAAH" leaps up. */
  f0: number;
  f1?: number;
  /** When the leap happens (fraction of dur). */
  leapAt?: number;
  power?: number;
  gain?: number;
}

/** Narsingha / turya: a long copper horn - darker, buzzier and more nasal than the conch. */
export function warHorn(out: Float32Array, offset: number, rng: Rand, sr: number, o: HornOpts): void {
  const n = Math.round(o.dur * sr);
  const off = Math.round(offset);
  const osc = new BlepOsc(rng.next());
  const lp = new Svf(sr, 600, 0.9);
  const flare = [new Resonator(sr), new Resonator(sr)];
  flare[0]?.set(520 + rng.next() * 80, 160);
  flare[1]?.set(1250 + rng.next() * 120, 240);
  const pw = clamp(o.power ?? 0.8, 0, 1);
  const f1 = o.f1 ?? o.f0;
  const leap = clamp(o.leapAt ?? 0.3, 0, 1) * o.dur;
  const wob = new Drift(rng, 0.3, sr, -1, 1);
  const g = o.gain ?? 1;
  const release = Math.min(0.4, o.dur * 0.2);
  for (let i = 0; i < n && off + i < out.length; i++) {
    if (off + i < 0) continue;
    const t = i / sr;
    const pres = t < 0.15 ? t / 0.15 : t > o.dur - release ? Math.max(0, (o.dur - t) / release) : 1;
    const lw = clamp((t - leap) / 0.08, 0, 1);
    const fbase = o.f0 + (f1 - o.f0) * lw * lw * (3 - 2 * lw);
    const f = fbase * Math.pow(2, (0.12 * wob.next() - 0.8 * Math.exp(-t / 0.06)) / 12);
    const src = osc.saw(f, sr);
    if ((i & 15) === 0) lp.setFreq(300 + 2600 * pres * pw * (0.6 + 0.4 * lw), 1.1);
    lp.process(src);
    let y = 0;
    for (const r of flare) y += r.process(lp.low);
    out[off + i] += (lp.low * 0.6 + y * 0.4 + rng.bi() * 0.02 * pres) * pres * g;
  }
}
