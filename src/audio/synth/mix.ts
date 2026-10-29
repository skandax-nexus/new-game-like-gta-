/**
 * Finishing: look-ahead peak limiter, soft clip, seamless loop folding, stereo decorrelation, distance
 * ("far") processing and the final `finish*` passes every rendered sound goes through.
 * OWNER: Audio Developer (AUD-01). Pure DSP (see synth/core.ts).
 */
import { type Stereo, normalizePeak, normalizeStereoPeak, peakAbs, removeDc, sanitize, stereoOf, trimTail, trimTailStereo } from './buffer';
import { clamp, dbToGain, type Rand } from './core';
import { Allpass } from './delay';
import { Biquad } from './filters';
import { FdnReverb } from './reverb';

/** Hard ceiling every rendered sound respects (acceptance: peak <= -1 dBFS). */
export const CEILING_DB = -1.2;

/**
 * Look-ahead peak limiter (stereo-linked). Gain follows the max |x| over the next `lookMs` with an
 * instant attack and an exponential release, then a final clamp guarantees the ceiling.
 */
export function limit(chs: readonly Float32Array[], sr: number, ceilingDb = CEILING_DB, lookMs = 2.5, releaseMs = 90): void {
  const n = chs[0]?.length ?? 0;
  if (n === 0) return;
  const ceil = dbToGain(ceilingDb);
  const look = Math.max(1, Math.round((lookMs * sr) / 1000));
  const rel = Math.exp(-1 / ((releaseMs * sr) / 1000));
  // Peak envelope per sample.
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (const c of chs) {
      const a = Math.abs(c[i]);
      if (a > m) m = a;
    }
    env[i] = m;
  }
  // Required gain at each sample, smoothed: min over the look-ahead window, released exponentially.
  const req = new Float32Array(n);
  for (let i = 0; i < n; i++) req[i] = env[i] > ceil ? ceil / env[i] : 1;
  // Sliding minimum over [i, i + look] with a monotonic deque (O(n)).
  const gmin = new Float32Array(n);
  const dq = new Int32Array(n + look + 1);
  let head = 0;
  let tail = 0;
  for (let j = 0; j < n + look; j++) {
    if (j < n) {
      while (tail > head && req[dq[tail - 1]] >= req[j]) tail--;
      dq[tail++] = j;
    }
    const i = j - look;
    if (i >= 0) {
      while (dq[head] < i) head++;
      gmin[i] = req[dq[head]];
    }
  }
  let g = 1;
  for (let i = 0; i < n; i++) {
    const target = gmin[i];
    g = target < g ? target : target + (g - target) * rel;
    for (const c of chs) {
      let y = c[i] * g;
      if (y > ceil) y = ceil;
      else if (y < -ceil) y = -ceil;
      c[i] = y;
    }
  }
}

/** tanh-like soft saturation (cheap rational approximation). */
export function softClip(x: number): number {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

/**
 * Parallel saturation for small-speaker translation: adds 2nd/3rd harmonics of low fundamentals so a war
 * drum or a ram still reads on a phone speaker (the ear infers the missing fundamental). `mix` 0..1.
 */
export function saturate(buf: Float32Array, drive: number, mix: number, asym = 0.25): Float32Array {
  let peak = 0;
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
  if (peak <= 0) return buf;
  const pre = drive / peak;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i] * pre;
    const y = softClip(x + asym * x * x * 0.3) / drive;
    buf[i] = buf[i] * (1 - mix) + y * peak * mix * 1.4;
  }
  return buf;
}

/**
 * Seamless loop: `src` holds loopFrames + xfadeFrames samples; the extra tail is crossfaded (equal-power)
 * over the head, so out[loopFrames - 1] -> out[0] continues exactly like src[loopFrames - 1] -> src[loopFrames].
 */
export function foldLoop(src: Float32Array, loopFrames: number, xfadeFrames: number): Float32Array {
  const out = src.slice(0, loopFrames);
  const x = Math.min(xfadeFrames, src.length - loopFrames, loopFrames);
  for (let i = 0; i < x; i++) {
    const u = (i + 0.5) / x;
    const fin = Math.sin(0.5 * Math.PI * u);
    const fout = Math.cos(0.5 * Math.PI * u);
    out[i] = src[i] * fin + src[loopFrames + i] * fout;
  }
  return out;
}

/**
 * Circular rendering for event-based loops (drum patterns, chant, crowds): everything that rings past the
 * loop end is added onto the head, exactly as it would overlap when the loop repeats. Returns a copy of
 * length `loopFrames`.
 */
export function wrapAdd(src: Float32Array, loopFrames: number): Float32Array {
  const out = src.slice(0, loopFrames);
  for (let i = loopFrames; i < src.length; i++) out[(i - loopFrames) % loopFrames] += src[i];
  return out;
}

export function foldLoopStereo(src: Stereo, loopFrames: number, xfadeFrames: number): Stereo {
  return { L: foldLoop(src.L, loopFrames, xfadeFrames), R: foldLoop(src.R, loopFrames, xfadeFrames) };
}

/** Decorrelated stereo from mono: two different allpass chains (+ optional width mix). */
export function widen(src: Float32Array, sr: number, width = 0.7): Stereo {
  const out = stereoOf(src.length);
  const ms = (x: number): number => Math.max(1, Math.round((x * sr) / 1000));
  const apL = [new Allpass(ms(3.1), 0.55), new Allpass(ms(7.3), 0.5), new Allpass(ms(11.9), 0.45)];
  const apR = [new Allpass(ms(4.3), 0.55), new Allpass(ms(6.1), 0.5), new Allpass(ms(13.7), 0.45)];
  const w = clamp(width, 0, 1);
  for (let i = 0; i < src.length; i++) {
    let l = src[i];
    let r = src[i];
    for (const a of apL) l = a.process(l);
    for (const a of apR) r = a.process(r);
    out.L[i] = src[i] * (1 - w) + l * w;
    out.R[i] = src[i] * (1 - w) + r * w;
  }
  return out;
}

/**
 * Distance colouring for pre-rendered far sounds (far bells, far conch, distant drums): air-absorption
 * low-pass, a little low cut and a reverb-dominant mix.
 */
export function farAway(src: Float32Array, sr: number, distanceM: number, rng: Rand, tailSec = 2.5): Stereo {
  const cutoff = clamp(16000 / (1 + distanceM / 60), 700, 16000);
  const n = src.length + Math.round(tailSec * sr);
  const dry = new Float32Array(n);
  dry.set(src);
  new Biquad('lowpass', cutoff, 0.6, sr).run(dry);
  new Biquad('highpass', 90, 0.6, sr).run(dry);
  const out = stereoOf(n);
  const rv = new FdnReverb(sr, { rt60: tailSec, damping: Math.min(4000, cutoff), size: 1.6, predelayMs: 20 + rng.next() * 30 });
  const wet = clamp(0.25 + distanceM / 600, 0.25, 0.85);
  const dryG = 1 - wet * 0.7;
  const o = new Float64Array(2);
  for (let i = 0; i < n; i++) {
    rv.tick(dry[i], dry[i], o);
    out.L[i] = dry[i] * dryG + o[0] * wet;
    out.R[i] = dry[i] * dryG + o[1] * wet;
  }
  return out;
}

/** Final pass for mono one-shots: DC removal, tail trim, peak normalize, limit, sanitize. */
export function finishMono(buf: Float32Array, sr: number, peakDb = -3, trim = true): Float32Array {
  removeDc(buf, sr, 12);
  let out = trim ? trimTail(buf, sr) : buf;
  normalizePeak(out, peakDb);
  limit([out], sr);
  sanitize(out);
  if (peakAbs(out) === 0 && out.length > 1) out = out.slice(0, 1);
  return out;
}

/** Final pass for stereo renders. */
export function finishStereo(s: Stereo, sr: number, peakDb = -3, trim = true): Stereo {
  removeDc(s.L, sr, 10);
  removeDc(s.R, sr, 10);
  const out = trim ? trimTailStereo(s, sr) : s;
  normalizeStereoPeak(out, peakDb);
  limit([out.L, out.R], sr);
  sanitize(out.L);
  sanitize(out.R);
  return out;
}
