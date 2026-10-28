/**
 * Uniform-grid spatial hash for thousands of points (soldiers). Owned by the CTO. Three-free.
 *
 * Rebuilt each step with a counting sort: O(n + cells), zero allocations after construction.
 * Typical use (soldier sim):
 *   hash.build(buf.count, buf.posX, buf.posZ, buf.alive);
 *   const n = hash.queryRadius(x, z, 3, tmp, buf.posX, buf.posZ);
 */
import type { Rect } from './types';

export class SpatialHash2D {
  readonly cellSize: number;
  readonly minX: number;
  readonly minZ: number;
  readonly cols: number;
  readonly rows: number;
  readonly capacity: number;
  private readonly invCell: number;
  private readonly cellStart: Int32Array;
  private readonly cellFill: Int32Array;
  private readonly items: Int32Array;
  private readonly cellOf: Int32Array;
  private _count = 0;

  constructor(bounds: Rect, cellSize: number, capacity: number) {
    this.cellSize = cellSize;
    this.invCell = 1 / cellSize;
    this.minX = bounds.minX;
    this.minZ = bounds.minZ;
    this.cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cellSize));
    this.rows = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / cellSize));
    this.capacity = capacity;
    this.cellStart = new Int32Array(this.cols * this.rows + 1);
    this.cellFill = new Int32Array(this.cols * this.rows);
    this.items = new Int32Array(capacity);
    this.cellOf = new Int32Array(capacity);
  }

  /** Number of items inserted by the last build(). */
  get count(): number {
    return this._count;
  }

  cellX(x: number): number {
    const c = Math.floor((x - this.minX) * this.invCell);
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  cellZ(z: number): number {
    const c = Math.floor((z - this.minZ) * this.invCell);
    return c < 0 ? 0 : c >= this.rows ? this.rows - 1 : c;
  }

  /**
   * Rebuild from SoA arrays. Items i in [0, n) with `mask[i] !== 0` (if a mask is given) are inserted.
   */
  build(n: number, xs: ArrayLike<number>, zs: ArrayLike<number>, mask?: ArrayLike<number>): void {
    if (n > this.capacity) throw new Error(`SpatialHash2D capacity ${this.capacity} < ${n}`);
    const cells = this.cols * this.rows;
    const start = this.cellStart;
    const fill = this.cellFill;
    start.fill(0);
    let inserted = 0;
    for (let i = 0; i < n; i++) {
      if (mask && mask[i] === 0) {
        this.cellOf[i] = -1;
        continue;
      }
      const c = this.cellZ(zs[i] as number) * this.cols + this.cellX(xs[i] as number);
      this.cellOf[i] = c;
      start[c + 1]++;
      inserted++;
    }
    for (let c = 0; c < cells; c++) start[c + 1] += start[c];
    for (let c = 0; c < cells; c++) fill[c] = start[c];
    for (let i = 0; i < n; i++) {
      const c = this.cellOf[i];
      if (c < 0) continue;
      this.items[fill[c]++] = i;
    }
    this._count = inserted;
  }

  /**
   * Write indices of items within radius r of (x, z) into `out`. Returns how many were written
   * (capped at out.length). Requires the same position arrays passed to build().
   */
  queryRadius(x: number, z: number, r: number, out: Int32Array, xs: ArrayLike<number>, zs: ArrayLike<number>): number {
    const r2 = r * r;
    const cx0 = this.cellX(x - r);
    const cx1 = this.cellX(x + r);
    const cz0 = this.cellZ(z - r);
    const cz1 = this.cellZ(z + r);
    let n = 0;
    const max = out.length;
    for (let cz = cz0; cz <= cz1; cz++) {
      const row = cz * this.cols;
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = row + cx;
        const end = this.cellStart[c + 1];
        for (let k = this.cellStart[c]; k < end; k++) {
          const i = this.items[k];
          const dx = (xs[i] as number) - x;
          const dz = (zs[i] as number) - z;
          if (dx * dx + dz * dz <= r2) {
            out[n++] = i;
            if (n >= max) return n;
          }
        }
      }
    }
    return n;
  }

  /**
   * Nearest item to (x, z) within maxR passing `accept` (optional). Returns index or -1.
   */
  nearest(
    x: number,
    z: number,
    maxR: number,
    xs: ArrayLike<number>,
    zs: ArrayLike<number>,
    accept?: (i: number) => boolean,
  ): number {
    let best = -1;
    let bestD2 = maxR * maxR;
    const cx0 = this.cellX(x - maxR);
    const cx1 = this.cellX(x + maxR);
    const cz0 = this.cellZ(z - maxR);
    const cz1 = this.cellZ(z + maxR);
    for (let cz = cz0; cz <= cz1; cz++) {
      const row = cz * this.cols;
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = row + cx;
        const end = this.cellStart[c + 1];
        for (let k = this.cellStart[c]; k < end; k++) {
          const i = this.items[k];
          const dx = (xs[i] as number) - x;
          const dz = (zs[i] as number) - z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestD2 && (!accept || accept(i))) {
            bestD2 = d2;
            best = i;
          }
        }
      }
    }
    return best;
  }

  /** Visit every item in cells overlapping the rect (no distance filtering). */
  forEachInRect(minX: number, minZ: number, maxX: number, maxZ: number, fn: (i: number) => void): void {
    const cx0 = this.cellX(minX);
    const cx1 = this.cellX(maxX);
    const cz0 = this.cellZ(minZ);
    const cz1 = this.cellZ(maxZ);
    for (let cz = cz0; cz <= cz1; cz++) {
      const row = cz * this.cols;
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = row + cx;
        const end = this.cellStart[c + 1];
        for (let k = this.cellStart[c]; k < end; k++) fn(this.items[k]);
      }
    }
  }
}
