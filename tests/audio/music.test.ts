/**
 * AUD-01 score: raga / tala data integrity, composer grammar, every mood's RMS inside its target window,
 * clean peaks, stream chunk-size independence (seamless chunk boundaries), determinism, non-repeating
 * variation, clean mood transitions, and every stinger. OWNER: Audio Developer (AUD-01).
 */
import { describe, expect, it } from 'vitest';
import { AUDIO_MOODS, AUDIO_STINGERS } from '../../src/core/events';
import { HERO_MOODS } from '../../src/core/types';
import { Rand } from '../../src/audio/synth/core';
import { measure } from '../../src/audio/synth/buffer';
import { Composer } from '../../src/audio/music/composer';
import { renderMood, ScoreEngine } from '../../src/audio/music/engine';
import { arrangementFor, flavourFromAmbience, ragaForHour, TYPICAL_INTENSITY } from '../../src/audio/music/moods';
import { renderStinger } from '../../src/audio/music/stingers';
import { RAGAS, TALAS } from '../../src/audio/music/theory';

const SR = 24000;
const db = (x: number): number => 20 * Math.log10(Math.max(1e-12, x));

function stereoRms(L: Float32Array, R: Float32Array, from = 0): number {
  let e = 0;
  for (let i = from; i < L.length; i++) e += L[i] * L[i] + R[i] * R[i];
  return db(Math.sqrt(e / (2 * (L.length - from))));
}

describe('music theory data', () => {
  it('ragas are self-consistent', () => {
    for (const r of Object.values(RAGAS)) {
      const pcs = new Set(r.notes);
      const inRaga = (s: number): boolean => pcs.has(((s % 12) + 12) % 12);
      for (const s of [...r.aroha, ...r.avaroha, r.vadi, r.samvadi, ...r.rest, r.tanpura]) expect(inRaga(s), `${r.id} ${s}`).toBe(true);
      for (const p of r.pakad) for (const s of p) expect(inRaga(s), `${r.id} pakad ${s}`).toBe(true);
      expect(pcs.has(0)).toBe(true);
    }
  });

  it('talas: theka and vibhags match the matra count', () => {
    for (const t of Object.values(TALAS)) {
      expect(t.theka.length, t.id).toBe(t.matras);
      expect(t.vibhags.reduce((a, b) => a + b, 0), t.id).toBe(t.matras);
    }
  });

  it('the composer only plays raga notes and ends phrases on nyas notes', () => {
    for (const r of Object.values(RAGAS)) {
      const c = new Composer(r, new Rand(11), 12);
      for (let k = 0; k < 120; k++) {
        const sec = (['alap', 'jor', 'gat'] as const)[k % 3]!;
        const p = c.phrase(sec, (k % 10) / 10);
        for (const n of p.notes) expect(r.notes, `${r.id} note ${n.semis}`).toContain(((n.semis % 12) + 12) % 12);
        expect(p.totalBeats).toBeGreaterThan(0);
        if (p.kind !== 'pakad' && p.kind !== 'tan' && p.kind !== 'hover') {
          const last = p.notes[p.notes.length - 1]!.semis;
          expect(r.rest.map((x) => ((x % 12) + 12) % 12), `${r.id} ${p.kind} ends on nyas`).toContain(((last % 12) + 12) % 12);
        }
      }
    }
  });

  it('moods map to ragas by time, hero lighting and district', () => {
    expect(ragaForHour(6)).toBe('bhairav');
    expect(ragaForHour(13)).toBe('sarang');
    expect(ragaForHour(19)).toBe('yaman');
    expect(ragaForHour(1)).toBe('malkauns');
    expect(ragaForHour(16, 'varsha', 0.8)).toBe('megh');
    for (const m of HERO_MOODS) expect(RAGAS[arrangementFor('hero_explore', { heroMood: m }).raga]).toBeDefined();
    expect(arrangementFor('hero_explore', { district: 'd_temple' }).bells).toBeGreaterThan(0.5);
    expect(flavourFromAmbience(['temple_bells', 'chanting_low'])).toBe('d_temple');
    expect(flavourFromAmbience(['bazaar_crowd'])).toBe('d_bazaar');
  });
});

describe('score engine', () => {
  it.each(AUDIO_MOODS.map((m) => [m]))('%s: 30 s of music sits in its RMS window with clean peaks', (mood) => {
    const r = renderMood(mood, 30, SR, 3);
    const win = arrangementFor(mood, {}).rms;
    for (const ch of [r.L, r.R]) {
      const st = measure(ch);
      expect(st.nan).toBe(0);
      expect(st.denormals).toBe(0);
      expect(st.peakDb).toBeLessThanOrEqual(-1);
    }
    const rms = stereoRms(r.L, r.R, SR * 2);
    expect(rms, `${mood} rms`).toBeGreaterThanOrEqual(win[0]);
    expect(rms, `${mood} rms`).toBeLessThanOrEqual(win[1]);
  });

  it('streaming in arbitrary chunks equals one render (seamless chunk boundaries)', () => {
    const sr = 48000;
    const n = sr * 4;
    const a = new ScoreEngine(sr, 9);
    a.setMood('battle', 0.8);
    const L1 = new Float32Array(n);
    const R1 = new Float32Array(n);
    a.render(L1, R1);
    const b = new ScoreEngine(sr, 9);
    b.setMood('battle', 0.8);
    const L2 = new Float32Array(n);
    const R2 = new Float32Array(n);
    const sizes = [1, 127, 128, 129, 1000, 4096, 777, 12000, 31];
    let o = 0;
    let k = 0;
    while (o < n) {
      const m = Math.min(sizes[k++ % sizes.length]!, n - o);
      b.render(L2, R2, o, m);
      o += m;
    }
    expect(L2).toEqual(L1);
    expect(R2).toEqual(R1);
  });

  it('is deterministic per seed and varies between seeds', () => {
    const a = renderMood('menu', 4, SR, 21);
    const b = renderMood('menu', 4, SR, 21);
    const c = renderMood('menu', 4, SR, 22);
    expect(b.L).toEqual(a.L);
    let diff = 0;
    for (let i = 0; i < a.L.length; i++) diff += Math.abs(a.L[i]! - c.L[i]!);
    expect(diff / a.L.length).toBeGreaterThan(1e-4);
  });

  it('never loops: later windows do not repeat earlier ones', () => {
    for (const mood of ['menu', 'battle', 'hero_explore'] as const) {
      const r = renderMood(mood, 40, SR, 5);
      const w = SR * 8;
      const a = r.L.subarray(SR * 4, SR * 4 + w);
      // Best normalized correlation over coarse lags between window A and every later window.
      let best = 0;
      for (let s = SR * 12; s + w <= r.L.length; s += SR / 4) {
        const b = r.L.subarray(s, s + w);
        let dot = 0;
        let ea = 0;
        let eb = 0;
        for (let i = 0; i < w; i += 2) {
          dot += a[i]! * b[i]!;
          ea += a[i]! * a[i]!;
          eb += b[i]! * b[i]!;
        }
        best = Math.max(best, Math.abs(dot) / Math.sqrt(ea * eb + 1e-12));
      }
      expect(best, mood).toBeLessThan(0.6);
    }
  });

  it('mood changes crossfade cleanly (no gap, no spike) and intensity drives the war layer', () => {
    const e = new ScoreEngine(SR, 4);
    e.setMood('world', TYPICAL_INTENSITY.world);
    const n = SR * 6;
    const L = new Float32Array(n * 3);
    const R = new Float32Array(n * 3);
    e.render(L, R, 0, n);
    e.setMood('battle', 0.9);
    e.cue('battle_start');
    e.render(L, R, n, n);
    expect(e.stats().performers).toBeGreaterThanOrEqual(1);
    e.setMood('victory', 0.6);
    e.render(L, R, 2 * n, n);
    const st = measure(L);
    expect(st.nan).toBe(0);
    expect(st.peakDb).toBeLessThanOrEqual(-1);
    // No dropout across the switch points (short-term RMS stays above -45 dBFS).
    for (const at of [n, 2 * n]) {
      for (let s = at - SR / 2; s < at + SR * 2; s += SR / 4) {
        let e2 = 0;
        for (let i = s; i < s + SR / 4; i++) e2 += L[i]! * L[i]!;
        expect(db(Math.sqrt(e2 / (SR / 4))), `dropout near ${at / SR}s`).toBeGreaterThan(-45);
      }
    }
    expect(e.stats().arrangement).toBe('victory');
  });
});

describe('stingers', () => {
  it.each(AUDIO_STINGERS.map((s) => [s]))('%s renders clean', (id) => {
    const s = renderStinger(id, SR, 1);
    for (const ch of [s.L, s.R]) {
      const st = measure(ch);
      expect(st.nan).toBe(0);
      expect(st.denormals).toBe(0);
      expect(st.peakDb).toBeLessThanOrEqual(-1);
      expect(st.peakDb).toBeGreaterThan(-6);
    }
    expect(s.L.length / SR).toBeLessThan(10);
  });
});
