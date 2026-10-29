/**
 * AUD-01 DSP primitives: tuning accuracy, filter response, modal partials, reverb decay, limiter
 * ceiling, seamless loop folding, determinism. OWNER: Audio Developer (AUD-01).
 */
import { describe, expect, it } from 'vitest';
import { hashSeed, Rand } from '../../src/audio/synth/core';
import { measure, mono, peakAbs } from '../../src/audio/synth/buffer';
import { Biquad, Svf } from '../../src/audio/synth/filters';
import { addModes, bellModes, HANDBELL_RATIOS } from '../../src/audio/synth/modal';
import { pluck } from '../../src/audio/synth/string';
import { FdnReverb } from '../../src/audio/synth/reverb';
import { foldLoop, limit } from '../../src/audio/synth/mix';
import { loopSeam, peakFrequency } from '../../src/audio/synth/analysis';
import { pinkNoise } from '../../src/audio/synth/osc';

const cents = (a: number, b: number): number => 1200 * Math.log2(a / b);

describe('audio synth primitives', () => {
  it('Rand is deterministic, uniform in range and forks independently', () => {
    const a = new Rand(42);
    const b = new Rand(42);
    let sum = 0;
    for (let i = 0; i < 10000; i++) {
      const x = a.next();
      expect(x).toBe(b.next());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      sum += x;
    }
    expect(Math.abs(sum / 10000 - 0.5)).toBeLessThan(0.02);
    expect(new Rand(1).next()).not.toBe(new Rand(2).next());
    expect(hashSeed('sfx', 'clash', 0)).not.toBe(hashSeed('sfx', 'clash', 1));
  });

  it.each([44100, 48000])('Karplus-Strong strings are in tune within 4 cents at %i Hz', (sr) => {
    for (const f of [110, 138.59, 220, 415.3, 880]) {
      const buf = mono(1.2, sr);
      pluck(buf, 0, { freq: f, duration: 1.2, t60: 3, brightness: 0.85, hardness: 0.6 }, new Rand(7), sr);
      const got = peakFrequency(buf, sr, f * 0.8, f * 1.2, Math.round(0.2 * sr), 32768);
      expect(Math.abs(cents(got, f))).toBeLessThan(4);
    }
  });

  it('jawari bridge buzz stays passive (no energy growth) and adds upper partials', () => {
    const sr = 48000;
    const plain = mono(4, sr);
    const buzz = mono(4, sr);
    pluck(plain, 0, { freq: 138.59, duration: 4, t60: 8, brightness: 0.95, jawari: 0 }, new Rand(3), sr);
    pluck(buzz, 0, { freq: 138.59, duration: 4, t60: 8, brightness: 0.95, jawari: 0.9 }, new Rand(3), sr);
    const early = peakAbs(buzz, 0, sr);
    const late = peakAbs(buzz, 3 * sr, 4 * sr);
    expect(late).toBeLessThan(early);
    // Relative high-band (2-6 kHz) content late in the note is larger with the jawari.
    const band = (b: Float32Array): number => {
      const x = b.slice(2 * sr, 3 * sr);
      new Biquad('bandpass', 3500, 0.5, sr).run(x);
      return peakAbs(x) / peakAbs(b, 2 * sr, 3 * sr);
    };
    expect(band(buzz)).toBeGreaterThan(band(plain) * 1.1);
  });

  it('biquad and SVF low-passes attenuate above the corner', () => {
    const sr = 48000;
    const tone = (f: number): Float32Array => {
      const b = new Float32Array(sr);
      for (let i = 0; i < b.length; i++) b[i] = Math.sin((2 * Math.PI * f * i) / sr);
      return b;
    };
    const hi = new Biquad('lowpass', 1000, 0.707, sr).run(tone(8000));
    expect(peakAbs(hi, sr / 2)).toBeLessThan(0.03);
    const lo = new Biquad('lowpass', 1000, 0.707, sr).run(tone(200));
    expect(peakAbs(lo, sr / 2)).toBeGreaterThan(0.95);
    const svf = new Svf(sr, 1000, 0.707);
    const t = tone(8000);
    let m = 0;
    for (let i = 0; i < t.length; i++) {
      const y = svf.process(t[i]);
      if (i > sr / 2) m = Math.max(m, Math.abs(y));
    }
    expect(m).toBeLessThan(0.03);
  });

  it('bell modes ring at their prime with doublet beating', () => {
    const sr = 48000;
    const b = mono(3, sr);
    addModes(b, 0, bellModes(1000, HANDBELL_RATIOS, { t60: 2, brightness: 0.5, beatHz: 2, rng: new Rand(5) }), sr);
    const f = peakFrequency(b, sr, 900, 1100, 0, 65536);
    expect(Math.abs(cents(f, 1000))).toBeLessThan(10);
    expect(measure(b).nan).toBe(0);
  });

  it('FDN reverb decays at roughly the requested RT60 and stays finite', () => {
    const sr = 48000;
    const rv = new FdnReverb(sr, { rt60: 2, damping: 8000, size: 1 });
    const o = new Float64Array(2);
    const n = 4 * sr;
    const env = new Float64Array(Math.ceil(n / 4800));
    for (let i = 0; i < n; i++) {
      rv.tick(i === 0 ? 1 : 0, i === 0 ? 1 : 0, o);
      expect(Number.isFinite(o[0])).toBe(true);
      env[Math.floor(i / 4800)] += o[0] * o[0] + o[1] * o[1];
    }
    // Energy drop between 0.3 s and 1.3 s should be ~30 dB for RT60 = 2 s (allow the loop damping).
    const db = 10 * Math.log10(env[3] / env[13]);
    expect(db).toBeGreaterThan(18);
    expect(db).toBeLessThan(45);
  });

  it('limiter guarantees the -1 dBFS ceiling', () => {
    const sr = 48000;
    const b = new Float32Array(sr);
    const r = new Rand(9);
    for (let i = 0; i < b.length; i++) b[i] = r.bi() * 3 * Math.sin(i / 3000);
    limit([b], sr);
    expect(measure(b).peakDb).toBeLessThanOrEqual(-1);
  });

  it('foldLoop makes a seamless loop out of continuous noise', () => {
    const sr = 48000;
    const src = pinkNoise(sr * 3, new Rand(4));
    const loop = foldLoop(src, sr * 2, Math.round(sr * 0.5));
    const seam = loopSeam(loop, sr);
    expect(seam.jumpRatio).toBeLessThan(4);
    expect(seam.levelDiffDb).toBeLessThan(3);
  });
});
