/**
 * Spatial audio model (pure): game-tuned distance attenuation, air-absorption low-pass, reverb send by
 * distance, listener-relative azimuth / pan, speed-of-sound delay. The WebAudio adapter (runtime/)
 * applies these to pooled voice chains; the offline ambience renderer uses the same curves so the
 * WAV renders match the game.
 * OWNER: Audio Developer (AUD-01).
 */

export interface ListenerPose {
  x: number;
  y: number;
  z: number;
  /** Forward (unit-ish) vector. */
  fx: number;
  fy: number;
  fz: number;
}

export const DEFAULT_LISTENER: ListenerPose = { x: 0, y: 1.7, z: 0, fx: 0, fy: 0, fz: 1 };

/** Speed of sound (m/s) used for thunder / far events. */
export const SPEED_OF_SOUND = 343;

/**
 * Distance gain: 1 inside `ref`, (ref / d)^rolloff beyond, smoothly faded to 0 between 0.7 max and max.
 * `scale` widens every distance (the strategic camera hears a larger world than the hero).
 */
export function distanceGain(d: number, ref: number, max: number, rolloff: number, scale = 1): number {
  const dd = d / Math.max(1e-6, scale);
  if (rolloff <= 0) return 1;
  if (dd >= max) return 0;
  let g = dd <= ref ? 1 : Math.pow(ref / dd, rolloff);
  const fadeStart = max * 0.7;
  if (dd > fadeStart) {
    const u = (dd - fadeStart) / (max - fadeStart);
    g *= 1 - u * u * (3 - 2 * u);
  }
  return g;
}

/**
 * Air absorption (+ ground / foliage loss) as a low-pass corner: ~20 kHz up close, ~6 kHz at 100 m,
 * ~2.5 kHz at 400 m, floored at 700 Hz for very distant events.
 */
export function airAbsorptionHz(d: number, scale = 1): number {
  const dd = Math.max(0, d / Math.max(1e-6, scale));
  return Math.max(700, Math.min(20000, 20000 / (1 + dd / 45)));
}

/** Reverb send for a source at distance d: the base send at `ref`, rising toward 1 far away. */
export function reverbSend(base: number, d: number, ref: number, scale = 1): number {
  const dd = d / Math.max(1e-6, scale);
  const far = dd <= ref ? 0 : Math.min(1, Math.log2(dd / ref) / 5);
  return Math.min(1, base + (1 - base) * far * 0.6);
}

/**
 * Listener-relative azimuth of a world point (radians; 0 = straight ahead, +PI/2 = to the right) and
 * horizontal distance. Uses +X east, +Z south, forward = (fx, fz); right = forward x up.
 */
export function relativeAzimuth(l: ListenerPose, x: number, z: number): { azimuth: number; distance: number } {
  const dx = x - l.x;
  const dz = z - l.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  let fx = l.fx;
  let fz = l.fz;
  const fl = Math.sqrt(fx * fx + fz * fz);
  if (fl < 1e-6) {
    fx = 0;
    fz = 1;
  } else {
    fx /= fl;
    fz /= fl;
  }
  // right vector for y-up with forward (fx, fz): (-fz, fx) in (x, z)... with +Z south and +X east,
  // forward (0, 1) (south) has its right hand to the west (-X): right = (-fz, fx).
  const rx = -fz;
  const rz = fx;
  const front = dx * fx + dz * fz;
  const side = dx * rx + dz * rz;
  return { azimuth: Math.atan2(side, front), distance: dist };
}

/** Equal-power stereo pan in [-1, 1] for an azimuth (sources behind fold to the sides). */
export function azimuthToPan(azimuth: number): number {
  return Math.max(-1, Math.min(1, Math.sin(azimuth)));
}

/** 3D distance. */
export function distance3(l: ListenerPose, x: number, y: number, z: number): number {
  const dx = x - l.x;
  const dy = y - l.y;
  const dz = z - l.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Thunder heard after its lightning: distance / speed of sound, clamped to the 1-4 s design window. */
export function thunderDelaySec(distanceM: number | null, rand01: number): number {
  if (distanceM === null || !Number.isFinite(distanceM)) return 1 + 3 * rand01;
  return Math.max(1, Math.min(4, distanceM / SPEED_OF_SOUND));
}
