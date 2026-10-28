/**
 * Deterministic road tracing over a heightfield (A* on a coarse grid, slope/water aware) + polyline
 * helpers. Used by world creation (road graph geometry, lengths) and by render (road ribbons).
 * Owned by the CTO. Three-free.
 */
import type { Vec2 } from '../types';
import type { Heightfield } from './heightfield';

export interface RoadTrace {
  /** Smoothed polyline from A to B (world meters), endpoints exact. */
  points: Vec2[];
  /** Polyline length in meters. */
  length: number;
  /** True if the road crosses water (needs bridge or ford). */
  crossesWater: boolean;
}

/** Binary min-heap keyed by Float64 priority over int ids (allocation-free after construction). */
class MinHeap {
  private ids: Int32Array;
  private keys: Float64Array;
  size = 0;
  constructor(cap: number) {
    this.ids = new Int32Array(cap);
    this.keys = new Float64Array(cap);
  }
  push(id: number, key: number): void {
    if (this.size >= this.ids.length) {
      const nIds = new Int32Array(this.ids.length * 2);
      nIds.set(this.ids);
      const nKeys = new Float64Array(this.keys.length * 2);
      nKeys.set(this.keys);
      this.ids = nIds;
      this.keys = nKeys;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= key) break;
      this.ids[i] = this.ids[p];
      this.keys[i] = this.keys[p];
      i = p;
    }
    this.ids[i] = id;
    this.keys[i] = key;
  }
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids[--this.size];
    const lastKey = this.keys[this.size];
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      if (l >= this.size) break;
      const r = l + 1;
      const c = r < this.size && this.keys[r] < this.keys[l] ? r : l;
      if (this.keys[c] >= lastKey) break;
      this.ids[i] = this.ids[c];
      this.keys[i] = this.keys[c];
      i = c;
    }
    this.ids[i] = lastId;
    this.keys[i] = lastKey;
    return top;
  }
}

const DIRS: readonly [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * Trace a natural-looking road from A to B. `cell` is the search grid spacing in meters.
 * Cost favors gentle slopes, avoids water (crossings allowed at a premium -> bridges at narrow points).
 */
export function traceRoad(hf: Heightfield, ax: number, az: number, bx: number, bz: number, cell = 48): RoadTrace {
  const b = hf.bounds;
  const cols = Math.max(2, Math.ceil((b.maxX - b.minX) / cell) + 1);
  const rows = Math.max(2, Math.ceil((b.maxZ - b.minZ) / cell) + 1);
  const n = cols * rows;
  const toIx = (x: number): number => Math.min(cols - 1, Math.max(0, Math.round((x - b.minX) / cell)));
  const toIz = (z: number): number => Math.min(rows - 1, Math.max(0, Math.round((z - b.minZ) / cell)));
  const start = toIz(az) * cols + toIx(ax);
  const goal = toIz(bz) * cols + toIx(bx);
  const gScore = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heights = new Float32Array(n);
  const water = new Uint8Array(n);
  for (let iz = 0; iz < rows; iz++) {
    for (let ix = 0; ix < cols; ix++) {
      const x = b.minX + ix * cell;
      const z = b.minZ + iz * cell;
      const i = iz * cols + ix;
      heights[i] = hf.heightAt(x, z);
      water[i] = hf.isWater(x, z) ? 1 : 0;
    }
  }
  const gx = goal % cols;
  const gz = Math.floor(goal / cols);
  const heap = new MinHeap(1024);
  gScore[start] = 0;
  heap.push(start, 0);
  while (heap.size > 0) {
    const cur = heap.pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % cols;
    const cz = Math.floor(cur / cols);
    for (const [dx, dz, dl] of DIRS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
      const ni = nz * cols + nx;
      if (closed[ni]) continue;
      const run = dl * cell;
      const slope = Math.abs(heights[ni] - heights[cur]) / run;
      let cost = run * (1 + slope * 6 + slope * slope * 40);
      if (water[ni]) cost *= 7;
      const g = gScore[cur] + cost;
      if (g < gScore[ni]) {
        gScore[ni] = g;
        came[ni] = cur;
        const hx = (nx - gx) * cell;
        const hz = (nz - gz) * cell;
        heap.push(ni, g + Math.sqrt(hx * hx + hz * hz));
      }
    }
  }
  // Reconstruct.
  const cells: number[] = [];
  let c = goal;
  if (came[goal] === -1 && goal !== start) {
    cells.push(start, goal);
  } else {
    while (c !== -1) {
      cells.push(c);
      if (c === start) break;
      c = came[c];
    }
    cells.reverse();
  }
  let pts: Vec2[] = cells.map((i) => ({ x: b.minX + (i % cols) * cell, z: b.minZ + Math.floor(i / cols) * cell }));
  pts[0] = { x: ax, z: az };
  pts[pts.length - 1] = { x: bx, z: bz };
  pts = simplifyCollinear(pts);
  pts = chaikin(chaikin(pts));
  let crossesWater = false;
  const len = polylineLength(pts);
  const samples = Math.max(2, Math.ceil(len / 8));
  const tmp = { x: 0, z: 0 };
  for (let i = 0; i <= samples; i++) {
    pointAlong(pts, (i / samples) * len, tmp);
    if (hf.isWater(tmp.x, tmp.z)) {
      crossesWater = true;
      break;
    }
  }
  return { points: pts, length: len, crossesWater };
}

/** Remove interior points that continue in the same grid direction. */
export function simplifyCollinear(pts: Vec2[]): Vec2[] {
  if (pts.length < 3) return pts;
  const out: Vec2[] = [pts[0] as Vec2];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1] as Vec2;
    const p = pts[i] as Vec2;
    const q = pts[i + 1] as Vec2;
    const cross = (p.x - a.x) * (q.z - p.z) - (p.z - a.z) * (q.x - p.x);
    if (Math.abs(cross) > 1e-6) out.push(p);
  }
  out.push(pts[pts.length - 1] as Vec2);
  return out;
}

/** One Chaikin corner-cutting pass (keeps endpoints). */
export function chaikin(pts: Vec2[]): Vec2[] {
  if (pts.length < 3) return pts;
  const out: Vec2[] = [pts[0] as Vec2];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i] as Vec2;
    const b = pts[i + 1] as Vec2;
    out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
    out.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
  }
  out.push(pts[pts.length - 1] as Vec2);
  return out;
}

export function polylineLength(pts: readonly Vec2[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Vec2;
    const b = pts[i] as Vec2;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    len += Math.sqrt(dx * dx + dz * dz);
  }
  return len;
}

/** Point at distance `d` along a polyline (clamped). Writes into `out`. */
export function pointAlong(pts: readonly Vec2[], d: number, out: Vec2): Vec2 {
  if (pts.length === 0) {
    out.x = 0;
    out.z = 0;
    return out;
  }
  let rem = d;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Vec2;
    const b = pts[i] as Vec2;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const seg = Math.sqrt(dx * dx + dz * dz);
    if (rem <= seg && seg > 0) {
      const t = rem / seg;
      out.x = a.x + dx * t;
      out.z = a.z + dz * t;
      return out;
    }
    rem -= seg;
  }
  const last = pts[pts.length - 1] as Vec2;
  out.x = last.x;
  out.z = last.z;
  return out;
}
