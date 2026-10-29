/**
 * Bells: the great temple ghanta (inharmonic bronze partials with doublet beating and a long hum),
 * the priest's hand bell (ghanti, re-struck by its clapper while it rings), cart / ox bells and
 * ghungroo jingles, and a bright chime for construction and UI confirmations.
 * OWNER: Audio Developer (AUD-01). Pure DSP (see synth/core.ts).
 */
import { addInto } from '../buffer';
import { type Rand } from '../core';
import { addModes, BELL_RATIOS, bellModes, HANDBELL_RATIOS, type Mode } from '../modal';
import { noiseBurst } from './impacts';

/** Large temple bell strike. f0 = prime (Hz, 220-520); `t60` seconds. */
export function templeBell(out: Float32Array, offset: number, rng: Rand, sr: number, opts: { f0: number; t60?: number; gain?: number; brightness?: number }): void {
  const modes = bellModes(opts.f0, BELL_RATIOS, { t60: opts.t60 ?? 7, brightness: opts.brightness ?? 0.72, beatHz: 0.9, rng, t60Tilt: 0.7 });
  // The hum (0.5) rings longest.
  for (const m of modes) if (m.f < opts.f0 * 0.6) m.t60 *= 1.6;
  addModes(out, offset, modes, sr, 0.45 * (opts.gain ?? 1));
  // Clapper / striker contact.
  noiseBurst(out, offset, rng, sr, { dur: 0.02, f: 3200, q: 0.8, gain: 0.25 * (opts.gain ?? 1) });
}

/** Priest's hand bell rung for `dur` seconds: a ringing bell re-struck at the swing rate. */
export function handBellRinging(out: Float32Array, offset: number, rng: Rand, sr: number, opts: { f0: number; dur: number; rate?: number; gain?: number }): void {
  const one = new Float32Array(Math.round(1.6 * sr));
  // Zero start phase: a re-strike adds to the ringing bell without a broadband discontinuity.
  const modes = bellModes(opts.f0, HANDBELL_RATIOS, { t60: 1.4, brightness: 0.42, beatHz: 3, rng, zeroPhase: true, t60Tilt: 0.9 });
  addModes(one, 0, modes, sr, 0.5);
  noiseBurst(one, 0, rng, sr, { dur: 0.004, f: 6000, q: 0.7, type: 'highpass', gain: 0.08 });
  const rate = opts.rate ?? 5.5 + rng.next() * 2.5;
  let t = 0;
  const g = opts.gain ?? 1;
  let k = 0;
  while (t < opts.dur) {
    // Clapper alternates sides: strong / weak, with human irregularity.
    const strength = (k % 2 === 0 ? 1 : 0.6) * (0.55 + 0.45 * rng.next());
    addInto(out, one, offset + t * sr, strength * g);
    t += (1 / rate) * (k % 2 === 0 ? 0.8 : 1.2) * (0.85 + rng.next() * 0.3);
    k++;
  }
}

/** Single hand-bell / chime strike (construction chime, notify, UI confirm). */
export function chime(out: Float32Array, offset: number, rng: Rand, sr: number, opts: { f0: number; t60?: number; gain?: number; brightness?: number }): void {
  const modes = bellModes(opts.f0, HANDBELL_RATIOS, { t60: opts.t60 ?? 1.8, brightness: opts.brightness ?? 0.45, beatHz: 2.2, rng, zeroPhase: true, t60Tilt: 0.8 });
  addModes(out, offset, modes, sr, 0.5 * (opts.gain ?? 1));
}

/** Ox / cart bell: dull, hollow "tonk" of a wooden-clappered bronze bell, swinging. */
export function oxBell(out: Float32Array, offset: number, rng: Rand, sr: number, opts: { f0?: number; strikes?: number; gain?: number } = {}): number {
  const f0 = opts.f0 ?? 520 + rng.next() * 260;
  const modes: Mode[] = [
    { f: f0, t60: 0.6, a: 1 },
    { f: f0 * 1.52, t60: 0.4, a: 0.5 },
    { f: f0 * 2.43, t60: 0.25, a: 0.35 },
    { f: f0 * 3.6, t60: 0.15, a: 0.2 },
  ];
  const strikes = opts.strikes ?? 2 + rng.int(4);
  let t = 0;
  for (let s = 0; s < strikes; s++) {
    for (const m of modes) m.ph = rng.next() * 6.28;
    addModes(out, offset + t * sr, modes, sr, (opts.gain ?? 1) * (0.5 + 0.5 * rng.next()) * 0.5);
    t += 0.35 + rng.next() * 0.35;
  }
  return t + 0.6;
}

/** Ghungroo / cart jingles: many tiny high bells shaken together. */
export function jingles(out: Float32Array, offset: number, rng: Rand, sr: number, opts: { dur: number; shakes?: number; gain?: number }): void {
  const shakes = opts.shakes ?? Math.round(opts.dur * 3);
  const g = opts.gain ?? 1;
  for (let s = 0; s < shakes; s++) {
    const st = (s / shakes) * opts.dur + rng.next() * 0.05;
    const bells = 4 + rng.int(6);
    for (let b = 0; b < bells; b++) {
      const f = 3800 + rng.next() * 4200;
      addModes(out, offset + (st + rng.next() * 0.04) * sr, [
        { f, t60: 0.12 + rng.next() * 0.15, a: 1, ph: rng.next() * 6.28 },
        { f: f * 1.48, t60: 0.08, a: 0.4, ph: rng.next() * 6.28 },
      ], sr, g * (0.1 + 0.15 * rng.next()));
    }
  }
}
