/**
 * Terrain reasoning for the battle AI and the intent translation (DESIGN_SPEC §6.1, §6.4, §6.10). OWNER: AI Engineer -
 * Battle AI, Intents & Campaign AI (SIM-02).
 *
 *  - `highestPoint`: the hold_high_ground search - 16 samples within r (the centre, 5 at r / 2, 10 at r), water skipped,
 *    ties broken toward the centre.
 *  - `crossingAxis`: the hold_crossing geometry - the direction across the river at a ford (shortest water run through
 *    the point over 12 headings), the near bank on a given side and the far bank distance. Cached per terrain + query
 *    (a pure function of the terrain, so a resumed battle rebuilds the same answer).
 *  - `siteScore`: deployment site value (height, cover, footing) used by the AI deployment.
 * Pure, deterministic, three-free.
 */
import type { TerrainQuery, Vec2 } from '../../../core/types';
import { dcos, dsin, facingOf, PI } from '../../../core/math';

/** Result of the hold_high_ground search. */
export interface HighPoint {
  x: number;
  z: number;
  height: number;
}

const RING_HALF = 5;
const RING_FULL = 10;

/**
 * Highest terrain point among 16 samples within `r` of (x, z): the centre, 5 points at r / 2 and 10 at r (DESIGN_SPEC §6.4
 * "sample 16 points"). Water samples are skipped; equal heights keep the earlier (more central) sample.
 */
export function highestPoint(terrain: TerrainQuery, x: number, z: number, r: number, out: HighPoint): HighPoint {
  out.x = x;
  out.z = z;
  out.height = terrain.isWater(x, z) ? -Infinity : terrain.heightAt(x, z);
  const b = terrain.bounds;
  const sample = (px: number, pz: number): void => {
    if (px < b.minX + 10 || pz < b.minZ + 10 || px > b.maxX - 10 || pz > b.maxZ - 10) return;
    if (terrain.isWater(px, pz)) return;
    const h = terrain.heightAt(px, pz);
    if (h > out.height + 0.05) {
      out.x = px;
      out.z = pz;
      out.height = h;
    }
  };
  for (let i = 0; i < RING_HALF; i++) {
    const a = (i / RING_HALF) * 2 * PI;
    sample(x + dsin(a) * r * 0.5, z + dcos(a) * r * 0.5);
  }
  for (let i = 0; i < RING_FULL; i++) {
    const a = ((i + 0.5) / RING_FULL) * 2 * PI;
    sample(x + dsin(a) * r, z + dcos(a) * r);
  }
  if (out.height === -Infinity) out.height = terrain.heightAt(x, z);
  return out;
}

/** River crossing geometry around a point. */
export interface CrossingAxis {
  /** True when water was found within the search radius (else the axis is a fallback). */
  river: boolean;
  /** Centre of the crossing (the water point the axis runs through). */
  cx: number;
  cz: number;
  /** Unit vector across the river (ford axis), pointing from the far bank toward the near bank of the asking side. */
  nx: number;
  nz: number;
  /** Distance from the centre to the near bank (first dry ground) and to the far bank, along the axis. */
  nearBank: number;
  farBank: number;
}

const STEP = 4;
const MAX_RUN = 240;
const HEADINGS = 12;
const cache = new WeakMap<TerrainQuery, Map<string, { cx: number; cz: number; ax: number; az: number; plus: number; minus: number; river: boolean }>>();

function waterRun(terrain: TerrainQuery, x: number, z: number, dx: number, dz: number): number {
  let d = 0;
  while (d < MAX_RUN) {
    const px = x + dx * (d + STEP);
    const pz = z + dz * (d + STEP);
    if (!terrain.inBounds(px, pz) || !terrain.isWater(px, pz)) break;
    d += STEP;
  }
  return d;
}

function axisAt(terrain: TerrainQuery, x: number, z: number, r: number): { cx: number; cz: number; ax: number; az: number; plus: number; minus: number; river: boolean } {
  let map = cache.get(terrain);
  if (!map) {
    map = new Map();
    cache.set(terrain, map);
  }
  const key = `${Math.round(x)},${Math.round(z)},${Math.round(r)}`;
  const hit = map.get(key);
  if (hit) return hit;
  // The water point the crossing runs through: the asked point, else the nearest water sample within r.
  let cx = x;
  let cz = z;
  let found = terrain.isWater(x, z);
  for (let ring = 1; ring <= 4 && !found; ring++) {
    const rr = (r * ring) / 4;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * 2 * PI;
      const px = x + dsin(a) * rr;
      const pz = z + dcos(a) * rr;
      if (terrain.inBounds(px, pz) && terrain.isWater(px, pz)) {
        cx = px;
        cz = pz;
        found = true;
        break;
      }
    }
  }
  let res: { cx: number; cz: number; ax: number; az: number; plus: number; minus: number; river: boolean };
  if (!found) {
    res = { cx: x, cz: z, ax: 0, az: 1, plus: 0, minus: 0, river: false };
  } else {
    // Across = the heading with the shortest water run through the crossing point (both directions).
    let best = Infinity;
    let ba = 0;
    let bp = 0;
    let bm = 0;
    for (let k = 0; k < HEADINGS; k++) {
      const a = (k / HEADINGS) * PI;
      const dx = dsin(a);
      const dz = dcos(a);
      const p = waterRun(terrain, cx, cz, dx, dz);
      const m = waterRun(terrain, cx, cz, -dx, -dz);
      if (p + m < best - 1e-9) {
        best = p + m;
        ba = a;
        bp = p;
        bm = m;
      }
    }
    // Re-centre on the middle of the water run so both banks are measured from the river's middle.
    const dx = dsin(ba);
    const dz = dcos(ba);
    const shift = (bp - bm) / 2;
    res = { cx: cx + dx * shift, cz: cz + dz * shift, ax: dx, az: dz, plus: (bp + bm) / 2 + STEP, minus: (bp + bm) / 2 + STEP, river: true };
  }
  map.set(key, res);
  return res;
}

/**
 * Crossing axis at (x, z) within `r` for a side standing around (ownX, ownZ): `n` points across the river toward that
 * side's bank. Without water nearby the axis falls back to the direction from the point toward the side (`river` false).
 */
export function crossingAxis(terrain: TerrainQuery, x: number, z: number, r: number, ownX: number, ownZ: number, out: CrossingAxis): CrossingAxis {
  const a = axisAt(terrain, x, z, Math.max(20, r));
  out.river = a.river;
  out.cx = a.cx;
  out.cz = a.cz;
  if (!a.river) {
    const dx = ownX - x;
    const dz = ownZ - z;
    const d = Math.sqrt(dx * dx + dz * dz) || 1;
    out.nx = dx / d;
    out.nz = dz / d;
    out.nearBank = 0;
    out.farBank = 0;
    return out;
  }
  const s = (ownX - a.cx) * a.ax + (ownZ - a.cz) * a.az >= 0 ? 1 : -1;
  out.nx = a.ax * s;
  out.nz = a.az * s;
  out.nearBank = s > 0 ? a.plus : a.minus;
  out.farBank = s > 0 ? a.minus : a.plus;
  return out;
}

/** Facing (radians) of a direction. */
export function headingOf(v: Vec2): number {
  return facingOf(v.x, v.z);
}

/** Terrain classes that are bad footing for a battle line. */
export function badFooting(terrain: TerrainQuery, x: number, z: number): boolean {
  const c = terrain.terrainClassAt(x, z);
  return c === 'deep_water' || c === 'shallow_water' || c === 'marsh' || c === 'rough';
}

/**
 * Value of a deployment site for a line facing `facing` (+ is better): height over the ground 120 m ahead (the
 * enemy has to climb; archers gain range), footing at the centre and both ends of a `halfWidth` line, and forest cover
 * when the side wants concealment.
 */
export function siteScore(terrain: TerrainQuery, x: number, z: number, facing: number, halfWidth: number, wantCover: boolean): number {
  const fx = dsin(facing);
  const fz = dcos(facing);
  const rx = -dcos(facing);
  const rz = dsin(facing);
  const h = terrain.heightAt(x, z);
  const ahead = terrain.heightAt(x + fx * 120, z + fz * 120);
  let s = Math.max(-1, Math.min(1.5, (h - ahead) / 10));
  for (const k of [-1, 0, 1]) {
    const px = x + rx * halfWidth * k;
    const pz = z + rz * halfWidth * k;
    if (!terrain.inBounds(px, pz)) {
      s -= 2;
      continue;
    }
    if (badFooting(terrain, px, pz)) s -= 0.8;
    if (wantCover && terrain.terrainClassAt(px, pz) === 'forest') s += 0.6;
  }
  return s;
}
