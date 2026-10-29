/**
 * Membranes: pakhawaj and mridangam (syahi-loaded treble head with Raman's harmonic modes + a dough-
 * or ink-loaded bass head with palm glides), dhol (stick-beaten boom + tilli crack) and the nagara /
 * bheri war kettle drums. One stroke vocabulary ("bols") shared by the score's tala engine and SFX.
 * OWNER: Audio Developer (AUD-01). Pure DSP (see synth/core.ts).
 */
import { clamp, type Rand } from '../core';
import { LOADED_HEAD_RATIOS, malletPulse, MEMBRANE_RATIOS, type Mode, ResonatorBank, strike } from '../modal';
import { noiseBurst, thud } from './impacts';

export type DrumKit = 'pakhawaj' | 'mridangam' | 'dhol' | 'nagara';

/**
 * Strokes. Treble: 'na' (rim, ringing), 'tin' (open, between rim and syahi), 'tun' (centre, sustained
 * fundamental), 'te' (closed, dry). Bass: 'ge' (open boom), 'ghe' (open, palm glide up), 'ke' (closed
 * slap). Compounds: 'dha' = ge + na, 'dhin' = ge + tin, 'dhi' = ghe + tin. War drums: 'boom' (centre),
 * 'rim' (edge / tilli crack), 'roll' (single soft roll stroke), 'flam' (two quick strokes).
 */
export type DrumStroke = 'na' | 'tin' | 'tun' | 'te' | 'ge' | 'ghe' | 'ke' | 'dha' | 'dhin' | 'dhi' | 'boom' | 'rim' | 'roll' | 'flam';

/** Timpani-like kettle ratios (air loading pulls the membrane modes toward harmonic). */
const KETTLE_RATIOS = [1, 1.504, 1.742, 2.0, 2.245, 2.494, 2.8, 2.98] as const;

interface HeadSpec {
  f0: number;
  ratios: readonly number[];
  t60: number;
  ampTilt: number;
  decayTilt: number;
}

function headModes(h: HeadSpec, rng: Rand, emphasis?: (k: number) => number, t60Scale = 1): Mode[] {
  return h.ratios.map((r, k) => ({
    f: h.f0 * r * (1 + rng.bi() * 0.004),
    t60: h.t60 * t60Scale * Math.pow(r, -h.decayTilt),
    a: Math.pow(h.ampTilt, k) * (emphasis ? emphasis(k) : 1) * (0.85 + 0.3 * rng.next()),
  }));
}

/** Tuning for a kit: `tonic` = Sa in Hz (treble heads are tuned to Sa). */
export function kitHeads(kit: DrumKit, tonic: number): { treble: HeadSpec; bass: HeadSpec } {
  switch (kit) {
    case 'pakhawaj':
      return {
        treble: { f0: tonic, ratios: LOADED_HEAD_RATIOS, t60: 0.9, ampTilt: 0.8, decayTilt: 0.55 },
        bass: { f0: 58, ratios: MEMBRANE_RATIOS.slice(0, 6), t60: 0.45, ampTilt: 0.45, decayTilt: 1.2 },
      };
    case 'mridangam':
      return {
        treble: { f0: tonic * 2, ratios: LOADED_HEAD_RATIOS, t60: 0.7, ampTilt: 0.85, decayTilt: 0.5 },
        bass: { f0: 88, ratios: MEMBRANE_RATIOS.slice(0, 6), t60: 0.35, ampTilt: 0.45, decayTilt: 1.1 },
      };
    case 'dhol':
      return {
        treble: { f0: 330, ratios: MEMBRANE_RATIOS, t60: 0.28, ampTilt: 0.85, decayTilt: 0.6 },
        bass: { f0: 72, ratios: MEMBRANE_RATIOS.slice(0, 8), t60: 0.5, ampTilt: 0.6, decayTilt: 0.9 },
      };
    case 'nagara':
      return {
        treble: { f0: 165, ratios: KETTLE_RATIOS, t60: 0.6, ampTilt: 0.75, decayTilt: 0.7 },
        bass: { f0: 52, ratios: KETTLE_RATIOS, t60: 2.2, ampTilt: 0.7, decayTilt: 0.8 },
      };
  }
}

function hit(out: Float32Array, offset: number, rng: Rand, sr: number, modes: Mode[], contact: number, seconds: number, gain: number, pitch?: (t: number) => number): void {
  const bank = new ResonatorBank(modes, sr);
  strike(out, offset, bank, malletPulse(sr, contact, rng, 0.4), seconds, sr, gain, pitch);
}

/** Render one stroke into out[offset ...]. `vel` 0..1. */
export function drumStroke(out: Float32Array, offset: number, rng: Rand, sr: number, kit: DrumKit, stroke: DrumStroke, tonic: number, vel = 0.8): void {
  const { treble, bass } = kitHeads(kit, tonic);
  const v = clamp(vel, 0.05, 1) * (0.9 + 0.2 * rng.next());
  const war = kit === 'dhol' || kit === 'nagara';
  switch (stroke) {
    case 'na': {
      // Rim stroke: the fundamental is damped by the ring finger; harmonics 2-4 ring brilliantly.
      const m = headModes(treble, rng, (k) => (k === 0 ? 0.25 : k <= 3 ? 1.25 : 0.7));
      hit(out, offset, rng, sr, m, 0.0012, treble.t60 * 1.3, 5 * v);
      noiseBurst(out, offset, rng, sr, { dur: 0.008, f: 5000, q: 0.7, gain: 0.25 * v });
      break;
    }
    case 'tin': {
      const m = headModes(treble, rng, (k) => (k === 0 ? 1 : k === 1 ? 0.8 : 0.45));
      hit(out, offset, rng, sr, m, 0.002, treble.t60 * 1.1, 5 * v);
      noiseBurst(out, offset, rng, sr, { dur: 0.006, f: 3500, q: 0.8, gain: 0.15 * v });
      break;
    }
    case 'tun': {
      const m = headModes(treble, rng, (k) => (k === 0 ? 1.4 : 0.25), 1.4);
      hit(out, offset, rng, sr, m, 0.004, treble.t60 * 1.6, 5 * v);
      break;
    }
    case 'te': {
      const m = headModes(treble, rng, (k) => (k < 2 ? 0.8 : 0.3), 0.08);
      hit(out, offset, rng, sr, m, 0.003, 0.08, 5 * v);
      noiseBurst(out, offset, rng, sr, { dur: 0.012, f: 2200, q: 0.6, gain: 0.35 * v });
      break;
    }
    case 'ge':
    case 'ghe': {
      const m = headModes(bass, rng);
      const glide = stroke === 'ghe' ? 0.25 + rng.next() * 0.15 : -0.04;
      // Palm pressure raises tension after the strike ("ghe" sweeps up); open strokes droop slightly.
      const pitch = (t: number): number => 1 + glide * (1 - Math.exp(-t / 0.09));
      hit(out, offset, rng, sr, m, 0.006, bass.t60 * 2, 7 * v, pitch);
      thud(out, offset, rng, sr, { f: bass.f0 * 1.4, dur: 0.06, gain: 0.25 * v, noise: 0.6 });
      break;
    }
    case 'ke': {
      const m = headModes(bass, rng, undefined, 0.12);
      hit(out, offset, rng, sr, m, 0.009, 0.1, 5 * v);
      noiseBurst(out, offset, rng, sr, { dur: 0.03, f: 900, q: 0.7, gain: 0.5 * v });
      break;
    }
    case 'dha':
      drumStroke(out, offset, rng, sr, kit, 'ge', tonic, vel);
      drumStroke(out, offset + rng.next() * 0.004 * sr, rng, sr, kit, 'na', tonic, vel * 0.9);
      break;
    case 'dhin':
      drumStroke(out, offset, rng, sr, kit, 'ge', tonic, vel);
      drumStroke(out, offset + rng.next() * 0.004 * sr, rng, sr, kit, 'tin', tonic, vel * 0.9);
      break;
    case 'dhi':
      drumStroke(out, offset, rng, sr, kit, 'ghe', tonic, vel);
      drumStroke(out, offset + rng.next() * 0.004 * sr, rng, sr, kit, 'tin', tonic, vel * 0.85);
      break;
    case 'boom': {
      const m = headModes(bass, rng);
      hit(out, offset, rng, sr, m, war ? 0.007 : 0.006, bass.t60 * 1.8, 7 * v, (t) => 1 + 0.06 * Math.exp(-t / 0.05));
      thud(out, offset, rng, sr, { f: bass.f0 * 1.25, dur: 0.12, gain: 0.55 * v, noise: 0.5, drop: 0.3 });
      // Skin slap and the upper head: the presence that lets a war drum read on small speakers.
      noiseBurst(out, offset, rng, sr, { dur: 0.025, f: 1100, q: 0.8, gain: 0.55 * v });
      hit(out, offset, rng, sr, headModes(treble, rng, (k) => (k < 3 ? 0.6 : 0.3), 0.35), 0.004, 0.4, 1.6 * v);
      break;
    }
    case 'rim': {
      const m = headModes(treble, rng, (k) => (k === 0 ? 0.6 : 1));
      hit(out, offset, rng, sr, m, 0.0008, treble.t60 * 1.2, 4 * v);
      noiseBurst(out, offset, rng, sr, { dur: 0.01, f: 4200, q: 0.9, gain: 0.55 * v });
      break;
    }
    case 'roll': {
      const m = headModes(bass, rng);
      hit(out, offset, rng, sr, m, 0.008, bass.t60 * 1.2, 4 * v);
      break;
    }
    case 'flam':
      drumStroke(out, offset, rng, sr, kit, 'boom', tonic, vel * 0.55);
      drumStroke(out, offset + (0.018 + rng.next() * 0.012) * sr, rng, sr, kit, 'boom', tonic, vel);
      break;
  }
}

/** Seconds a stroke needs (render length). */
export function strokeLength(kit: DrumKit, stroke: DrumStroke): number {
  if (stroke === 'te' || stroke === 'ke') return 0.25;
  if (kit === 'nagara') return 3.2;
  if (kit === 'dhol') return 1.6;
  return stroke === 'na' || stroke === 'tin' || stroke === 'tun' ? 1.4 : 1.2;
}
