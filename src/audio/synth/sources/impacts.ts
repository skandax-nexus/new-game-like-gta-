/**
 * Impact sources: wood knocks, metal clangs and blade rings, stone clacks, body thuds, cloth rustle,
 * debris showers and crackles. Physical recipes: a contact transient (mallet pulse + filtered noise)
 * exciting modal resonators of the struck material.
 * OWNER: Audio Developer (AUD-01). Pure DSP (see synth/core.ts).
 */
import { addInto } from '../buffer';
import { clamp, type Rand } from '../core';
import { Biquad, Svf } from '../filters';
import { addModes, BAR_RATIOS, malletPulse, metalModes, type Mode, ResonatorBank, strike, WOOD_RATIOS } from '../modal';

/** Short filtered noise burst (contact / grit). Adds into out. */
export function noiseBurst(out: Float32Array, offset: number, rng: Rand, sr: number, opts: { dur: number; f: number; q?: number; type?: 'bandpass' | 'lowpass' | 'highpass'; gain?: number; attack?: number }): void {
  const n = Math.max(2, Math.round(opts.dur * sr));
  const o = Math.round(offset);
  const bq = new Biquad(opts.type ?? 'bandpass', opts.f, opts.q ?? 0.8, sr);
  const g = opts.gain ?? 1;
  const att = Math.max(1, Math.round((opts.attack ?? 0.0008) * sr));
  for (let i = 0; i < n && o + i < out.length; i++) {
    if (o + i < 0) continue;
    const env = i < att ? i / att : Math.exp((-5 * (i - att)) / (n - att));
    out[o + i] += bq.process(rng.bi()) * env * g;
  }
}

/** Wooden knock: plank / shield / clapper. `size` 0..1 lowers pitch and lengthens decay. */
export function woodKnock(out: Float32Array, offset: number, rng: Rand, sr: number, opts: { f0?: number; size?: number; hardness?: number; gain?: number; damp?: number } = {}): void {
  const size = clamp(opts.size ?? 0.5, 0, 1);
  const f0 = opts.f0 ?? 900 - 700 * size + rng.bi() * 60;
  const t60 = (0.05 + 0.35 * size) * (opts.damp ?? 1);
  const modes: Mode[] = WOOD_RATIOS.map((r, k) => ({ f: f0 * r * (1 + rng.bi() * 0.03), t60: t60 * Math.pow(r, -0.8), a: Math.pow(0.62, k) * (0.7 + 0.6 * rng.next()) }));
  const bank = new ResonatorBank(modes, sr);
  const hard = clamp(opts.hardness ?? 0.6, 0, 1);
  const exc = malletPulse(sr, 0.0045 - 0.0035 * hard, rng, 0.3);
  strike(out, offset, bank, exc, t60 * 1.6 + 0.02, sr, (opts.gain ?? 1) * 6);
  noiseBurst(out, offset, rng, sr, { dur: 0.006 + 0.01 * size, f: 2500 + 2500 * hard, q: 0.7, gain: 0.25 * (opts.gain ?? 1) });
}

/** Metal clang (armour, copper vessel, blade-on-metal). `ring` lengthens decay. */
export function metalClang(out: Float32Array, offset: number, rng: Rand, sr: number, opts: { f0?: number; ring?: number; hardness?: number; gain?: number; count?: number; spread?: number } = {}): void {
  const f0 = opts.f0 ?? 600 + rng.next() * 900;
  const t60 = 0.15 + 1.6 * clamp(opts.ring ?? 0.4, 0, 1);
  const modes = metalModes(f0, opts.count ?? 14, rng, t60, opts.spread ?? 7, 0.6);
  const bank = new ResonatorBank(modes, sr);
  const hard = clamp(opts.hardness ?? 0.8, 0, 1);
  const exc = malletPulse(sr, 0.0018 - 0.0014 * hard, rng, 0.5);
  strike(out, offset, bank, exc, t60 * 1.3, sr, (opts.gain ?? 1) * 3);
  noiseBurst(out, offset, rng, sr, { dur: 0.012, f: 6000, q: 0.6, type: 'highpass', gain: 0.35 * (opts.gain ?? 1) });
}

/**
 * Blade ring (sword on sword / parry): free-free bar modes of a steel blade (sharp, inharmonic), long
 * shimmering ring with slight doublets, and a bright scrape at the contact.
 */
export function bladeRing(out: Float32Array, offset: number, rng: Rand, sr: number, opts: { f0?: number; ring?: number; gain?: number; scrape?: number } = {}): void {
  const f0 = opts.f0 ?? 1450 + rng.next() * 700;
  const ring = clamp(opts.ring ?? 0.7, 0, 1);
  const modes: Mode[] = [];
  BAR_RATIOS.forEach((r, k) => {
    const f = f0 * r * (1 + rng.bi() * 0.01);
    const t60 = (0.4 + 2.2 * ring) * Math.pow(r, -0.45);
    const a = Math.pow(0.7, k) * (0.6 + 0.6 * rng.next());
    modes.push({ f, t60, a, ph: rng.next() * 6.28 }, { f: f * 1.0015 + 1.3, t60: t60 * 0.9, a: a * 0.5, ph: rng.next() * 6.28 });
  });
  // A few plate-like modes of the hilt / guard.
  for (let k = 0; k < 4; k++) modes.push({ f: f0 * (0.37 + rng.next() * 0.5), t60: 0.12 + 0.2 * rng.next(), a: 0.25, ph: rng.next() * 6.28 });
  const g = opts.gain ?? 1;
  addModes(out, offset, modes, sr, 0.5 * g);
  // Scrape: a 30-80 ms descending band of grit as the edges slide.
  const scr = opts.scrape ?? 0.6;
  if (scr > 0) {
    const n = Math.round((0.03 + 0.05 * rng.next()) * sr);
    const svf = new Svf(sr, 7000, 3);
    const o = Math.round(offset);
    for (let i = 0; i < n && o + i < out.length; i++) {
      if ((i & 15) === 0) svf.setFreq(7000 - (4000 * i) / n, 3);
      const env = Math.sin((Math.PI * i) / n);
      out[o + i] += svf.process(rng.bi()) * env * 0.35 * scr * g;
    }
  }
}

/** Stone clack / masonry hit: dense, short, low-Q modes and grit. `size` 0..1. */
export function stoneHit(out: Float32Array, offset: number, rng: Rand, sr: number, opts: { size?: number; gain?: number } = {}): void {
  const size = clamp(opts.size ?? 0.4, 0, 1);
  const f0 = 2600 - 2200 * size + rng.bi() * 200;
  const modes: Mode[] = [];
  for (let k = 0; k < 9; k++) {
    const r = 1 + k * (0.7 + rng.next() * 0.9);
    modes.push({ f: f0 * r, t60: (0.02 + 0.07 * size) * Math.pow(r, -0.4), a: Math.pow(0.75, k) * (0.5 + rng.next()), ph: rng.next() * 6.28 });
  }
  const bank = new ResonatorBank(modes, sr);
  strike(out, offset, bank, malletPulse(sr, 0.0008 + 0.002 * size, rng, 0.8), 0.25 + 0.3 * size, sr, (opts.gain ?? 1) * 3);
  noiseBurst(out, offset, rng, sr, { dur: 0.01 + 0.04 * size, f: 1800 + 1500 * (1 - size), q: 0.5, gain: 0.6 * (opts.gain ?? 1) });
  if (size > 0.5) thud(out, offset, rng, sr, { f: 70 + 40 * (1 - size), dur: 0.15 + 0.25 * size, gain: 0.7 * (opts.gain ?? 1), noise: 0.4 });
}

/** Low body thud: a falling sine "punch" + low-passed noise. Earth, body, sacks, wooden gates. */
export function thud(out: Float32Array, offset: number, rng: Rand, sr: number, opts: { f?: number; dur?: number; gain?: number; noise?: number; drop?: number } = {}): void {
  const f = opts.f ?? 90;
  const dur = opts.dur ?? 0.18;
  const n = Math.round(dur * sr);
  const o = Math.round(offset);
  const g = opts.gain ?? 1;
  const noise = opts.noise ?? 0.5;
  const drop = opts.drop ?? 0.45;
  let ph = 0;
  const lp = new Biquad('lowpass', 260 + 400 * noise, 0.7, sr);
  for (let i = 0; i < n && o + i < out.length; i++) {
    if (o + i < 0) continue;
    const t = i / sr;
    const env = Math.exp((-6 * t) / dur) * Math.min(1, i / (0.0015 * sr));
    const fi = f * (1 - drop * (1 - Math.exp((-t * 9) / dur)));
    ph += fi / sr;
    out[o + i] += (Math.sin(2 * Math.PI * ph) * (1 - noise * 0.5) + lp.process(rng.bi()) * noise * 1.4) * env * g;
  }
}

/** Cloth rustle / flap: crackly band-limited micro-grain noise. `motion` shapes the amplitude curve. */
export function clothRustle(out: Float32Array, offset: number, rng: Rand, sr: number, opts: { dur?: number; gain?: number; f?: number; grain?: number } = {}): void {
  const dur = opts.dur ?? 0.35;
  const n = Math.round(dur * sr);
  const o = Math.round(offset);
  const g = opts.gain ?? 1;
  const bp = new Biquad('bandpass', opts.f ?? 3200, 0.6, sr);
  const hp = new Biquad('highpass', 700, 0.7, sr);
  const grainRate = opts.grain ?? 0.02;
  let grainAmp = 0;
  for (let i = 0; i < n && o + i < out.length; i++) {
    if (o + i < 0) continue;
    const u = i / n;
    const shape = Math.sin(Math.PI * Math.pow(u, 0.6));
    if (rng.next() < grainRate) grainAmp = 0.3 + rng.next() * 1.4;
    grainAmp *= 0.996;
    const x = hp.process(bp.process(rng.bi()));
    out[o + i] += x * shape * (0.35 + grainAmp) * g;
  }
}

/** A shower of small impacts (pebbles, splinters, coins, arrows into earth) with decaying density. */
export function debris(
  out: Float32Array,
  offset: number,
  rng: Rand,
  sr: number,
  opts: { count: number; dur: number; material: 'stone' | 'wood' | 'earth' | 'metal'; size?: number; gain?: number; decay?: number },
): void {
  const g = opts.gain ?? 1;
  for (let k = 0; k < opts.count; k++) {
    const u = Math.pow(rng.next(), opts.decay ?? 1.8);
    const at = offset + u * opts.dur * sr;
    const amp = g * (0.25 + 0.75 * rng.next()) * (1 - 0.6 * u);
    const sz = clamp((opts.size ?? 0.3) * (0.5 + rng.next()), 0, 1);
    switch (opts.material) {
      case 'stone':
        stoneHit(out, at, rng, sr, { size: sz * 0.6, gain: amp });
        break;
      case 'wood':
        woodKnock(out, at, rng, sr, { size: sz * 0.5, hardness: 0.7, gain: amp * 0.7 });
        break;
      case 'metal':
        metalClang(out, at, rng, sr, { f0: 1800 + rng.next() * 2500, ring: 0.15, gain: amp * 0.4, count: 8 });
        break;
      case 'earth':
        thud(out, at, rng, sr, { f: 140 + rng.next() * 120, dur: 0.05 + 0.05 * sz, gain: amp * 0.5, noise: 0.85 });
        break;
    }
  }
}

/**
 * Crackles: sparse, very short resonant clicks (fire, splintering wood, dry thatch). `density` per
 * second; `dur` seconds.
 */
export function crackles(out: Float32Array, offset: number, rng: Rand, sr: number, opts: { dur: number; density: number; gain?: number; fLo?: number; fHi?: number }): void {
  const g = opts.gain ?? 1;
  let t = rng.expo(opts.density);
  while (t < opts.dur) {
    const at = Math.round(offset + t * sr);
    const f = (opts.fLo ?? 900) + rng.next() * ((opts.fHi ?? 6000) - (opts.fLo ?? 900));
    const q = 2 + rng.next() * 6;
    const n = Math.round((0.002 + rng.next() * 0.012) * sr);
    const bq = new Biquad('bandpass', f, q, sr);
    const amp = g * Math.pow(rng.next(), 1.6) * 2.2;
    for (let i = 0; i < n * 4 && at + i < out.length; i++) {
      const x = i < n ? rng.bi() * Math.exp((-4 * i) / n) : 0;
      out[at + i] += bq.process(x) * amp;
    }
    t += rng.expo(opts.density) * (rng.chance(0.2) ? 0.15 : 1);
  }
}

/** Adds `src` copies at random offsets (for layering pre-rendered grains). */
export function scatterInto(out: Float32Array, src: Float32Array, rng: Rand, count: number, startFrame: number, spanFrames: number, gain: number): void {
  for (let k = 0; k < count; k++) addInto(out, src, startFrame + rng.next() * spanFrames, gain * (0.4 + 0.6 * rng.next()));
}
