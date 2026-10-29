/**
 * AUD-01 SFX catalog: every SFX_KINDS entry (and the internal effects) renders offline in node without
 * NaN / denormals, peaks <= -1 dBFS, is audible, ends cleanly, varies per variant, is deterministic, and
 * the families have distinct timbres. OWNER: Audio Developer (AUD-01).
 */
import { describe, expect, it } from 'vitest';
import { SFX_KINDS } from '../../src/core/events';
import { ALL_SFX, INTERNAL_SFX, SFX_META, variantsForTier } from '../../src/audio/sfx/meta';
import { hasSfxRenderer, renderSfx } from '../../src/audio/sfx/render';
import { measure, rms } from '../../src/audio/synth/buffer';
import { spectralCentroid } from '../../src/audio/synth/analysis';

const SR = 48000;
const cache = new Map<string, Float32Array>();
function get(id: (typeof ALL_SFX)[number], v: number): Float32Array {
  const k = `${id}#${v}`;
  let b = cache.get(k);
  if (!b) {
    b = renderSfx(id, v, SR, 1);
    cache.set(k, b);
  }
  return b;
}

describe('SFX catalog', () => {
  it('covers every SFX_KINDS entry with metadata and a renderer', () => {
    for (const k of SFX_KINDS) {
      expect(SFX_META[k], k).toBeDefined();
      expect(hasSfxRenderer(k), k).toBe(true);
    }
    for (const k of INTERNAL_SFX) expect(hasSfxRenderer(k), k).toBe(true);
    for (const id of ALL_SFX) {
      const m = SFX_META[id];
      expect(m.peakDb).toBeLessThanOrEqual(-1);
      expect(m.maxDistance).toBeGreaterThanOrEqual(m.refDistance);
      expect(variantsForTier(m, 'low')).toBeGreaterThanOrEqual(2);
    }
  });

  it.each(ALL_SFX.map((id) => [id]))('%s renders clean: finite, no denormals, peak <= -1 dBFS, audible, clean tail', (id) => {
    for (const v of [0, 1]) {
      const b = get(id, v);
      const st = measure(b);
      expect(st.nan, `${id}#${v} NaN`).toBe(0);
      expect(st.denormals, `${id}#${v} denormals`).toBe(0);
      expect(st.peakDb, `${id}#${v} peak`).toBeLessThanOrEqual(-1);
      expect(st.peakDb, `${id}#${v} too quiet`).toBeGreaterThan(-6);
      expect(Math.abs(st.dc), `${id}#${v} DC`).toBeLessThan(0.01);
      expect(b.length / SR, `${id}#${v} length`).toBeLessThan(12);
      // Ends quietly (no truncation click): last 5 ms at least 40 dB under the peak.
      const tail = rms(b, Math.max(0, b.length - Math.round(0.005 * SR)));
      expect(20 * Math.log10(tail + 1e-12) - st.peakDb, `${id}#${v} tail`).toBeLessThan(-40);
    }
  });

  it('variants differ and renders are deterministic', () => {
    for (const id of ['clash', 'sword_light', 'footstep_stone', 'conch', 'build', 'coins'] as const) {
      const a = get(id, 0);
      const b = get(id, 1);
      const n = Math.min(a.length, b.length);
      let dot = 0;
      let ea = 0;
      let eb = 0;
      for (let i = 0; i < n; i++) {
        dot += a[i] * b[i];
        ea += a[i] * a[i];
        eb += b[i] * b[i];
      }
      expect(Math.abs(dot / Math.sqrt(ea * eb)), id).toBeLessThan(0.9);
      expect(renderSfx(id, 0, SR, 1)).toEqual(a);
    }
  });

  it('families have distinct timbres (spectral centroid ordering)', () => {
    const c = (id: (typeof ALL_SFX)[number]): number => spectralCentroid(get(id, 0), SR);
    expect(c('footstep_stone')).toBeGreaterThan(c('footstep_dirt'));
    expect(c('sword_light')).toBeGreaterThan(c('sword_heavy'));
    expect(c('drum_hit')).toBeLessThan(900);
    expect(c('fx_thunder_far')).toBeLessThan(c('thunder'));
    expect(c('coins')).toBeGreaterThan(c('build'));
    expect(c('parry_ring')).toBeGreaterThan(c('block_thud'));
  });

  it('renders at 44.1 kHz too', () => {
    for (const id of ['ui_click', 'parry_ring', 'river_splash'] as const) {
      const st = measure(renderSfx(id, 0, 44100, 1));
      expect(st.nan).toBe(0);
      expect(st.peakDb).toBeLessThanOrEqual(-1);
    }
  });
});
