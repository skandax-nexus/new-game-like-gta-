/**
 * Float32Array buffer helpers: allocation, mixing, panning, fades, analysis and finishing.
 * OWNER: Audio Developer (AUD-01). Pure DSP (see synth/core.ts).
 */
import { clamp, dbToGain, FLT_MIN, gainToDb } from './core';

/** Two channels of equal length. */
export interface Stereo {
  L: Float32Array;
  R: Float32Array;
}

export function frames(seconds: number, sr: number): number {
  return Math.max(1, Math.round(seconds * sr));
}

export function mono(seconds: number, sr: number): Float32Array {
  return new Float32Array(frames(seconds, sr));
}

export function stereo(seconds: number, sr: number): Stereo {
  const n = frames(seconds, sr);
  return { L: new Float32Array(n), R: new Float32Array(n) };
}

export function stereoOf(n: number): Stereo {
  return { L: new Float32Array(n), R: new Float32Array(n) };
}

/** dst[offset + i] += src[i] * gain (clipped to dst bounds). */
export function addInto(dst: Float32Array, src: Float32Array, offset = 0, gain = 1): void {
  const o = Math.round(offset);
  const start = Math.max(0, -o);
  const end = Math.min(src.length, dst.length - o);
  for (let i = start; i < end; i++) dst[o + i] += src[i] * gain;
}

/** Equal-power pan gains for pan in [-1, 1]. */
export function panGains(pan: number): [number, number] {
  const p = (clamp(pan, -1, 1) + 1) * 0.25 * Math.PI;
  return [Math.cos(p), Math.sin(p)];
}

/** Mix a mono source into a stereo destination at `pan`. */
export function addPanned(dst: Stereo, src: Float32Array, offset: number, gain: number, pan: number): void {
  const [gl, gr] = panGains(pan);
  addInto(dst.L, src, offset, gain * gl);
  addInto(dst.R, src, offset, gain * gr);
}

export function addStereo(dst: Stereo, src: Stereo, offset = 0, gain = 1): void {
  addInto(dst.L, src.L, offset, gain);
  addInto(dst.R, src.R, offset, gain);
}

export function scale(buf: Float32Array, g: number): Float32Array {
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
  return buf;
}

/** Raised-cosine fade in over the first `n` samples. */
export function fadeIn(buf: Float32Array, n: number): void {
  const m = Math.min(n, buf.length);
  for (let i = 0; i < m; i++) buf[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / m);
}

/** Raised-cosine fade out over the last `n` samples. */
export function fadeOut(buf: Float32Array, n: number): void {
  const m = Math.min(n, buf.length);
  const s = buf.length - m;
  for (let i = 0; i < m; i++) buf[s + i] *= 0.5 + 0.5 * Math.cos((Math.PI * (i + 1)) / m);
}

export function peakAbs(buf: Float32Array, start = 0, end = buf.length): number {
  let p = 0;
  for (let i = start; i < end; i++) {
    const a = Math.abs(buf[i]);
    if (a > p) p = a;
  }
  return p;
}

export function rms(buf: Float32Array, start = 0, end = buf.length): number {
  let s = 0;
  const n = Math.max(1, end - start);
  for (let i = start; i < end; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / n);
}

export interface BufferStats {
  frames: number;
  peak: number;
  peakDb: number;
  rmsDb: number;
  dc: number;
  nan: number;
  denormals: number;
}

export function measure(buf: Float32Array): BufferStats {
  let peak = 0;
  let sum = 0;
  let sum2 = 0;
  let nan = 0;
  let den = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    if (!Number.isFinite(x)) {
      nan++;
      continue;
    }
    const a = Math.abs(x);
    if (a > peak) peak = a;
    if (a !== 0 && a < FLT_MIN) den++;
    sum += x;
    sum2 += x * x;
  }
  const n = Math.max(1, buf.length);
  return { frames: buf.length, peak, peakDb: gainToDb(peak), rmsDb: gainToDb(Math.sqrt(sum2 / n)), dc: sum / n, nan, denormals: den };
}

/** Replace NaN/Inf with 0 and flush values too small to matter (incl. float32 denormals). */
export function sanitize(buf: Float32Array, floor = 1e-20): Float32Array {
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    if (!(x > floor || x < -floor)) buf[i] = 0;
  }
  return buf;
}

/** Scale so the absolute peak hits `targetDb` (no-op for silence). */
export function normalizePeak(buf: Float32Array, targetDb: number): Float32Array {
  const p = peakAbs(buf);
  if (p > 1e-9) scale(buf, dbToGain(targetDb) / p);
  return buf;
}

export function normalizeStereoPeak(s: Stereo, targetDb: number): Stereo {
  const p = Math.max(peakAbs(s.L), peakAbs(s.R));
  if (p > 1e-9) {
    const g = dbToGain(targetDb) / p;
    scale(s.L, g);
    scale(s.R, g);
  }
  return s;
}

/** Remove DC with a gentle one-pole high-pass (~8 Hz). */
export function removeDc(buf: Float32Array, sr: number, hz = 8): Float32Array {
  const R = Math.exp((-2 * Math.PI * hz) / sr);
  let x1 = 0;
  let y1 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    const y = x - x1 + R * y1;
    x1 = x;
    y1 = y;
    buf[i] = y;
  }
  return buf;
}

/**
 * Trim a quiet tail: keeps everything up to the last sample above `thresholdDb` (relative to the peak) plus
 * `padSec`, then fades the last `fadeSec`. Returns a copy (or the same array when nothing is trimmed).
 */
export function trimTail(buf: Float32Array, sr: number, thresholdDb = -66, padSec = 0.02, fadeSec = 0.02): Float32Array {
  const p = peakAbs(buf);
  if (p <= 0) return buf.subarray(0, Math.min(buf.length, 64)).slice();
  const thr = p * dbToGain(thresholdDb);
  let last = buf.length - 1;
  while (last > 0 && Math.abs(buf[last]) < thr) last--;
  const end = Math.min(buf.length, last + 1 + Math.round(padSec * sr));
  const out = end < buf.length ? buf.slice(0, end) : buf;
  fadeOut(out, Math.round(fadeSec * sr));
  return out;
}

export function trimTailStereo(s: Stereo, sr: number, thresholdDb = -66, padSec = 0.02, fadeSec = 0.02): Stereo {
  const p = Math.max(peakAbs(s.L), peakAbs(s.R));
  if (p <= 0) return s;
  const thr = p * dbToGain(thresholdDb);
  let last = s.L.length - 1;
  while (last > 0 && Math.abs(s.L[last]) < thr && Math.abs(s.R[last]) < thr) last--;
  const end = Math.min(s.L.length, last + 1 + Math.round(padSec * sr));
  const out = end < s.L.length ? { L: s.L.slice(0, end), R: s.R.slice(0, end) } : s;
  fadeOut(out.L, Math.round(fadeSec * sr));
  fadeOut(out.R, Math.round(fadeSec * sr));
  return out;
}

export function reverse(buf: Float32Array): Float32Array {
  buf.reverse();
  return buf;
}

export function concat(parts: readonly Float32Array[], gapFrames = 0): Float32Array {
  let n = 0;
  for (const p of parts) n += p.length + gapFrames;
  const out = new Float32Array(Math.max(1, n));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length + gapFrames;
  }
  return out;
}

/** Stereo -> mono average. */
export function toMono(s: Stereo): Float32Array {
  const out = new Float32Array(s.L.length);
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * (s.L[i] + s.R[i]);
  return out;
}

/** Multiply by a gain curve sampled from `fn(tSec)` every `step` samples (linear in between). */
export function applyGainCurve(buf: Float32Array, sr: number, fn: (t: number) => number, offset = 0, step = 32): void {
  let g0 = fn(offset / sr);
  for (let i = 0; i < buf.length; i += step) {
    const g1 = fn((offset + i + step) / sr);
    const m = Math.min(step, buf.length - i);
    for (let k = 0; k < m; k++) buf[i + k] *= g0 + ((g1 - g0) * k) / step;
    g0 = g1;
  }
}
