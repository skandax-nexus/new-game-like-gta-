/**
 * Musical stingers for 'audio:stinger' (stereo, in the score's Sa so they sit on any mood):
 *  age_up (DESIGN_SPEC §8.4: conch + drums fanfare, ~5 s), landmark_complete, construction_complete
 *  (§8.2 bell chime), harvest, battle_start (shankha + nagara), duel_phase (§11.6 priests' bells),
 *  mission_success / mission_failure, victory, defeat.
 * Pure DSP (worker / node); the runtime ducks the score under them.
 * OWNER: Audio Developer (AUD-01).
 */
import type { AudioStinger } from '../../core/events';
import { addInto, mono, type Stereo, stereoOf } from '../synth/buffer';
import { hashSeed, Rand } from '../synth/core';
import { finishStereo } from '../synth/mix';
import { FdnReverb } from '../synth/reverb';
import { jingles } from '../synth/sources/bells';
import { type DrumKit, type DrumStroke } from '../synth/sources/drums';
import { warHorn } from '../synth/sources/winds';
import { Bansuri } from './instruments';
import { renderBell, renderChoir, renderConchCall, renderGliss, renderStroke, renderVinaNote } from './instruments';
import { RAGAS, type RagaDef, swaraHz } from './theory';

interface Ctx {
  out: Stereo;
  sr: number;
  rng: Rand;
  seed: number;
}

function place(c: Ctx, src: Float32Array, at: number, gain: number, pan: number): void {
  const p = (Math.max(-1, Math.min(1, pan)) + 1) * 0.25 * Math.PI;
  addInto(c.out.L, src, at * c.sr, gain * Math.cos(p));
  addInto(c.out.R, src, at * c.sr, gain * Math.sin(p));
}

function stroke(c: Ctx, kit: DrumKit, s: DrumStroke, at: number, gain: number, pan = 0): void {
  place(c, renderStroke(kit, s, c.rng.int(3), c.sr, c.seed), at, gain, pan);
}

/** Bansuri phrase: [semis, seconds, meend?] in a raga. */
function flute(c: Ctx, raga: RagaDef, at: number, notes: readonly (readonly [number, number, boolean?])[], gain: number, pan = 0.15): void {
  const total = notes.reduce((s, n) => s + n[1], 0) + 1;
  const buf = mono(total, c.sr);
  const f = new Bansuri(c.sr, hashSeed('stinger-flute', c.seed, at));
  let t = Math.round(0.02 * c.sr);
  notes.forEach(([s, d, meend], i) => {
    const frames = Math.round(d * c.sr);
    f.push({ start: t, frames, hz: swaraHz(raga, s), meend: meend ? Math.min(0.3, d * 0.45) : 0.02, kanHz: 0, andolan: false, vel: 0.9, attack: i === 0 });
    t += frames;
  });
  f.render(buf, 0, 0, buf.length, 1);
  place(c, buf, at, gain, pan);
}

function finish(c: Ctx, rt60: number, wet: number): Stereo {
  const n = c.out.L.length + Math.round(rt60 * c.sr);
  const out = stereoOf(n);
  const rv = new FdnReverb(c.sr, { rt60, damping: 4800, size: 1.6, predelayMs: 20 });
  const o = new Float64Array(2);
  for (let i = 0; i < n; i++) {
    const l = i < c.out.L.length ? c.out.L[i] : 0;
    const r = i < c.out.R.length ? c.out.R[i] : 0;
    rv.tick(l, r, o);
    out.L[i] = l + o[0] * wet;
    out.R[i] = r + o[1] * wet;
  }
  return finishStereo(out, c.sr, -2);
}

type StingerFn = (c: Ctx) => Stereo;

const Y = RAGAS.yaman;
const BH = RAGAS.bhupali;
const K = RAGAS.kafi;
const BV = RAGAS.bhairavi;

const STINGERS: Record<AudioStinger, StingerFn> = {
  age_up(c) {
    // Nagara roll accelerating into the great stroke; two shankhas (Sa, Pa); a bansuri flourish up
    // Bhupali to taar Sa; vina glissando; choir swell; priests' bells.
    let t = 0;
    for (let k = 0; k < 13; k++) {
      stroke(c, 'nagara', 'roll', t, 0.25 + 0.5 * (k / 13), c.rng.bi() * 0.3);
      t += 0.09 - k * 0.0035;
    }
    stroke(c, 'nagara', 'boom', t, 1.1, 0);
    stroke(c, 'dhol', 'boom', t, 0.6, 0.2);
    place(c, renderConchCall(BH, c.sr, c.seed, 2.9), t + 0.05, 0.75, -0.25);
    place(c, renderConchCall(RAGAS.bhupali, c.sr, c.seed + 1, 2.7), t + 0.12, 0.45, 0.3);
    place(c, renderGliss(BH, [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24], 0.055, c.sr, c.rng), t + 0.2, 0.55, 0.35);
    flute(c, BH, t + 0.5, [[12, 0.13], [14, 0.13], [16, 0.13], [19, 0.13], [21, 0.15], [24, 2.2, true]], 0.75);
    place(c, renderChoir(BH, [-12, -5], 3.6, c.sr, c.seed), t + 0.6, 0.55, 0);
    place(c, renderBell('ghanti_ring', 36, BH, c.sr, c.seed), t + 0.9, 0.35, -0.5);
    stroke(c, 'nagara', 'boom', t + 1.6, 0.7, -0.1);
    stroke(c, 'nagara', 'boom', t + 2.0, 0.85, 0.1);
    return finish(c, 3.2, 0.32);
  },
  landmark_complete(c) {
    place(c, renderBell('ghanta', 12, Y, c.sr, c.seed), 0, 0.9, -0.1);
    place(c, renderChoir(Y, [-12, -5], 4.2, c.sr, c.seed + 2, 'o'), 0.2, 0.6, 0);
    place(c, renderGliss(Y, [-1, 2, 4, 6, 9, 11, 12, 14, 16, 18, 21, 23, 24], 0.07, c.sr, c.rng), 0.5, 0.5, 0.3);
    place(c, renderBell('chime', 24, Y, c.sr, c.seed), 1.5, 0.4, -0.4);
    place(c, renderBell('chime', 28, Y, c.sr, c.seed), 1.75, 0.35, 0.4);
    place(c, renderBell('chime', 31, Y, c.sr, c.seed), 2.0, 0.35, 0);
    return finish(c, 3.6, 0.36);
  },
  construction_complete(c) {
    place(c, renderBell('chime', 24, Y, c.sr, c.seed), 0, 0.7, -0.2);
    place(c, renderBell('chime', 31, Y, c.sr, c.seed + 1), 0.22, 0.55, 0.2);
    place(c, renderVinaNote(swaraHz(Y, 0), 1.2, c.sr, c.rng, { vel: 0.8 }), 0.02, 0.45, 0);
    return finish(c, 2, 0.28);
  },
  harvest(c) {
    // A Kafi folk phrase, a light mridangam and ankle-bell jingles: the village has grain.
    flute(c, K, 0.05, [[12, 0.14], [14, 0.14], [15, 0.14], [17, 0.14], [19, 0.6, true], [17, 0.18], [19, 0.9]], 0.7);
    ['na', 'ge', 'na', 'dha', 'na', 'dha'].forEach((s, k) => stroke(c, 'mridangam', s as DrumStroke, 0.05 + k * 0.21, 0.55, 0.2 - k * 0.05));
    const j = mono(1.8, c.sr);
    jingles(j, 0, c.rng, c.sr, { dur: 1.3, shakes: 6, gain: 0.6 });
    place(c, j, 0.1, 0.4, -0.4);
    return finish(c, 2.2, 0.26);
  },
  battle_start(c) {
    place(c, renderConchCall(Y, c.sr, c.seed, 3.0), 0, 0.8, -0.2);
    place(c, renderConchCall(RAGAS.kirwani, c.sr, c.seed + 3, 2.8), 0.15, 0.5, 0.3);
    stroke(c, 'nagara', 'boom', 0.2, 1, 0);
    stroke(c, 'nagara', 'boom', 0.85, 0.85, -0.1);
    stroke(c, 'nagara', 'boom', 1.5, 1, 0.1);
    const h = mono(3, c.sr);
    warHorn(h, 0, c.rng, c.sr, { dur: 2.2, f0: swaraHz(Y, -12), f1: swaraHz(Y, -5), leapAt: 0.3, power: 0.85 });
    place(c, h, 1.7, 0.6, 0.35);
    for (let k = 0; k < 8; k++) stroke(c, 'dhol', k % 2 ? 'rim' : 'boom', 2.2 + k * 0.14, 0.45 + 0.05 * k, 0.15);
    stroke(c, 'nagara', 'boom', 3.35, 1, 0);
    return finish(c, 2.8, 0.3);
  },
  duel_phase(c) {
    // The priests on the temple stair ring their bells; the great bell answers.
    place(c, renderBell('ghanti_ring', 36, RAGAS.marwa, c.sr, c.seed), 0, 0.6, -0.5);
    place(c, renderBell('ghanti_ring', 33, RAGAS.marwa, c.sr, c.seed + 1), 0.12, 0.5, 0.5);
    place(c, renderBell('ghanta', 12, RAGAS.marwa, c.sr, c.seed), 0.05, 0.85, 0);
    stroke(c, 'pakhawaj', 'dha', 0.05, 0.6, 0);
    return finish(c, 3.2, 0.36);
  },
  mission_success(c) {
    flute(c, Y, 0, [[11, 0.16], [14, 0.16], [16, 0.16], [18, 0.16], [21, 0.18], [23, 0.2], [24, 1.6, true]], 0.75);
    place(c, renderVinaNote(swaraHz(Y, 12), 1.5, c.sr, c.rng, { vel: 0.8 }), 1.16, 0.5, -0.2);
    place(c, renderBell('chime', 24, Y, c.sr, c.seed), 1.16, 0.45, 0.3);
    stroke(c, 'pakhawaj', 'dha', 1.16, 0.55, 0);
    return finish(c, 2.6, 0.32);
  },
  mission_failure(c) {
    flute(c, BV, 0, [[24, 0.35], [22, 0.35], [20, 0.35], [19, 0.5, true], [17, 0.35], [15, 0.35], [13, 0.5, true], [12, 1.4]], 0.65);
    stroke(c, 'pakhawaj', 'ge', 0, 0.6, 0);
    stroke(c, 'pakhawaj', 'ge', 2.75, 0.6, 0);
    place(c, renderBell('ghanta', 0, BV, c.sr, c.seed), 2.75, 0.5, -0.2);
    return finish(c, 3.2, 0.36);
  },
  victory(c) {
    place(c, renderConchCall(BH, c.sr, c.seed, 2.8), 0, 0.75, -0.25);
    const pat = [0, 0.45, 0.68, 1.35, 1.8, 2.03, 2.7];
    pat.forEach((t, k) => stroke(c, k % 3 === 0 ? 'nagara' : 'dhol', 'boom', t, k % 3 === 0 ? 1 : 0.6, (k % 2 ? 0.2 : -0.2)));
    flute(c, BH, 1.2, [[16, 0.2], [19, 0.2], [21, 0.2], [24, 0.4], [21, 0.2], [24, 0.2], [26, 0.25], [28, 1.6, true]], 0.7);
    place(c, renderBell('ghanti_ring', 36, BH, c.sr, c.seed), 0.4, 0.35, 0.5);
    place(c, renderChoir(BH, [-12, -5], 4, c.sr, c.seed + 4), 1.2, 0.5, 0);
    return finish(c, 3.2, 0.32);
  },
  defeat(c) {
    [0, 1.6, 3.2].forEach((t, k) => stroke(c, 'nagara', 'boom', t, 0.95 - k * 0.2, 0));
    const h = mono(3.4, c.sr);
    warHorn(h, 0, c.rng, c.sr, { dur: 3, f0: swaraHz(BV, -5), f1: swaraHz(BV, -9), leapAt: 0.45, power: 0.55 });
    place(c, h, 0.6, 0.55, -0.2);
    place(c, renderBell('ghanta', -12 + 12, BV, c.sr, c.seed), 1.6, 0.6, 0.2);
    place(c, renderChoir(BV, [-12, -9], 4.6, c.sr, c.seed + 5, 'u'), 0.8, 0.5, 0);
    return finish(c, 4, 0.4);
  },
};

/** Render a stinger (stereo, finished: peak <= -2 dBFS). */
export function renderStinger(id: AudioStinger, sr: number, seed = 0): Stereo {
  const c: Ctx = { out: stereoOf(Math.round(7 * sr)), sr, rng: new Rand(hashSeed('stinger', id, seed)), seed };
  return STINGERS[id](c);
}

export function hasStinger(id: string): id is AudioStinger {
  return Object.prototype.hasOwnProperty.call(STINGERS, id);
}
