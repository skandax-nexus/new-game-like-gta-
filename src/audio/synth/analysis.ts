/**
 * Analysis: radix-2 FFT, magnitude spectra, log-frequency spectrograms, pitch and loop-seam metrics.
 * Used by tests/audio (pitch accuracy, seamless loops, timbre checks), scripts/audio/render.mjs
 * (spectrogram PNGs) and the audio lab's live analyzer.
 * OWNER: Audio Developer (AUD-01). Pure DSP (see synth/core.ts).
 */
import { gainToDb } from './core';

/** In-place iterative radix-2 complex FFT (re/im length = power of two). */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const ar = re[i + k + half] * cr - im[i + k + half] * ci;
        const ai = re[i + k + half] * ci + im[i + k + half] * cr;
        re[i + k + half] = re[i + k] - ar;
        im[i + k + half] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

const hannCache = new Map<number, Float64Array>();
function hann(n: number): Float64Array {
  let w = hannCache.get(n);
  if (!w) {
    w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    hannCache.set(n, w);
  }
  return w;
}

/** Hann-windowed magnitude spectrum (linear amplitude, bins 0..size/2) of buf[start, start + size). */
export function magnitudeSpectrum(buf: Float32Array, start: number, size: number): Float64Array {
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const w = hann(size);
  for (let i = 0; i < size; i++) {
    const k = start + i;
    re[i] = k >= 0 && k < buf.length ? buf[k] * w[i] : 0;
  }
  fft(re, im);
  const out = new Float64Array(size / 2 + 1);
  const norm = 4 / size;
  for (let i = 0; i <= size / 2; i++) out[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]) * norm;
  return out;
}

/** Average magnitude spectrum over the whole buffer (frames of `size`, hop size/2). */
export function averageSpectrum(buf: Float32Array, size = 8192): Float64Array {
  const acc = new Float64Array(size / 2 + 1);
  let frames = 0;
  for (let s = 0; s + size <= Math.max(size, buf.length); s += size >> 1) {
    const m = magnitudeSpectrum(buf, s, size);
    for (let i = 0; i < acc.length; i++) acc[i] += m[i] * m[i];
    frames++;
  }
  for (let i = 0; i < acc.length; i++) acc[i] = Math.sqrt(acc[i] / Math.max(1, frames));
  return acc;
}

export interface Spectrogram {
  /** Columns (time frames). */
  width: number;
  /** Rows (log-frequency bands, row 0 = highest frequency). */
  height: number;
  /** dBFS per cell, row-major. */
  db: Float32Array;
  fMin: number;
  fMax: number;
  seconds: number;
}

/**
 * Log-frequency spectrogram: `width` time columns x `height` rows from fMin to fMax. Each cell takes the
 * max magnitude of the FFT bins falling in its band (so narrow partials stay visible).
 */
export function spectrogram(buf: Float32Array, sr: number, width: number, height: number, fMin = 30, fMax = 20000, size = 4096): Spectrogram {
  const db = new Float32Array(width * height).fill(-140);
  const hi = Math.min(fMax, sr / 2);
  const lnMin = Math.log(fMin);
  const lnMax = Math.log(hi);
  const binHz = sr / size;
  // Row band edges in bins.
  const rowLo = new Int32Array(height);
  const rowHi = new Int32Array(height);
  for (let r = 0; r < height; r++) {
    const f1 = Math.exp(lnMin + ((lnMax - lnMin) * (height - 1 - r)) / height);
    const f2 = Math.exp(lnMin + ((lnMax - lnMin) * (height - r)) / height);
    rowLo[r] = Math.max(1, Math.floor(f1 / binHz));
    rowHi[r] = Math.max(rowLo[r], Math.ceil(f2 / binHz));
  }
  for (let x = 0; x < width; x++) {
    const center = Math.round(((x + 0.5) / width) * buf.length);
    const m = magnitudeSpectrum(buf, center - size / 2, size);
    for (let r = 0; r < height; r++) {
      let v = 0;
      const lo = rowLo[r];
      const h = Math.min(m.length - 1, rowHi[r]);
      if (h < lo) {
        v = m[Math.min(m.length - 1, lo)];
      } else {
        for (let b = lo; b <= h; b++) if (m[b] > v) v = m[b];
      }
      db[r * width + x] = gainToDb(v);
    }
  }
  return { width, height, db, fMin, fMax: hi, seconds: buf.length / sr };
}

/** Frequency (Hz) of the strongest spectral peak in [fLo, fHi], refined by parabolic interpolation. */
export function peakFrequency(buf: Float32Array, sr: number, fLo: number, fHi: number, start = 0, size = 16384): number {
  const m = magnitudeSpectrum(buf, start, size);
  const binHz = sr / size;
  const lo = Math.max(1, Math.floor(fLo / binHz));
  const hi = Math.min(m.length - 2, Math.ceil(fHi / binHz));
  let best = lo;
  for (let i = lo; i <= hi; i++) if (m[i] > m[best]) best = i;
  const a = m[best - 1];
  const b = m[best];
  const c = m[best + 1];
  const den = a - 2 * b + c;
  const delta = den !== 0 ? (0.5 * (a - c)) / den : 0;
  return (best + delta) * binHz;
}

/** Spectral centroid (Hz) over the buffer - a brightness proxy for "distinct timbres" checks. */
export function spectralCentroid(buf: Float32Array, sr: number, size = 4096): number {
  const m = averageSpectrum(buf, size);
  let num = 0;
  let den = 0;
  for (let i = 1; i < m.length; i++) {
    const f = (i * sr) / size;
    num += f * m[i];
    den += m[i];
  }
  return den > 0 ? num / den : 0;
}

/**
 * Loop-seam score: compares the step across the loop boundary (last -> first sample) with the typical
 * sample-to-sample step inside the loop, and the short-term RMS just before / after the seam.
 * A seamless loop has jumpRatio ~ 1 (no larger than ordinary steps) and levelDiffDb ~ 0.
 */
export function loopSeam(buf: Float32Array, sr: number, windowSec = 0.05): { jumpRatio: number; levelDiffDb: number } {
  const n = buf.length;
  let sumStep = 0;
  for (let i = 1; i < n; i++) sumStep += Math.abs(buf[i] - buf[i - 1]);
  const meanStep = sumStep / Math.max(1, n - 1);
  const jump = Math.abs(buf[0] - buf[n - 1]);
  const w = Math.min(Math.round(windowSec * sr), n >> 2);
  let e1 = 0;
  let e2 = 0;
  for (let i = 0; i < w; i++) {
    e1 += buf[n - w + i] * buf[n - w + i];
    e2 += buf[i] * buf[i];
  }
  const levelDiffDb = Math.abs(gainToDb(Math.sqrt(e1 / w)) - gainToDb(Math.sqrt(e2 / w)));
  return { jumpRatio: meanStep > 0 ? jump / meanStep : 0, levelDiffDb };
}
