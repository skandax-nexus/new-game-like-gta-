/**
 * Battle pathing: coarse 8 m grid + cached flow fields (Dial's bucket-queue Dijkstra). OWNER: Gameplay Engineer -
 * Tactical Battle Simulation (GP-01). DESIGN_SPEC §6.3 move_to, §6.6.5, §6.10 River.
 *
 *  - The static layer samples the battle terrain once per (setup, terrain): terrain class per cell. Each movement
 *    profile (unit classes with the same §5.4 speed row) gets a cost table `round(10 / speed)`; deep water is
 *    impassable except where a bridge overlay crosses it; shallow water (fords) is passable unless the river is in
 *    flood (> 0.5: "fords close").
 *  - The dynamic overlay is rebuilt from `BattleState` when its signature changes (engineer works, wall breaches,
 *    gates, ladders): per-side block bits (walls block both sides, intact gates only the attacker, ladders let
 *    the attacker climb), a cost multiplier (ditch x2.5, rubble x1.5, ladder x4) and a road flag (bridges).
 *  - Flow fields are full reverse Dijkstra fields to one destination cell for (profile, side), computed with
 *    integer edge costs (mean of the two cells, diagonal x1.414, no corner cutting) and cached LRU per destination.
 *    A formation steers straight at its goal while the straight segment is passable and otherwise toward the
 *    farthest visible cell of the flow descent chain (string pulling), so paths are smooth and deterministic.
 *  - Everything here is derived data: a pure function of (setup, terrain, state overlay). Caches never change
 *    results, so a battle resumed from JSON paths exactly like the uninterrupted one.
 */
import type { TerrainClass, TerrainQuery } from '../../core/types';
import { TERRAIN_CLASSES } from '../../core/types';
import { UNITS } from '../../data/units';
import { MOVE_PROFILES } from './stats';

/** Grid cell size in meters (ticket GP-01: 8 m). */
export const GRID_CELL = 8;
/** Distance value of unreachable cells. */
export const FLOW_INF = 0x3fffffff;
/** Flow-field cache size (LRU, per battle context). */
const FLOW_CACHE = 24;
/** Dial buckets (> max integer edge cost). */
const BUCKETS = 1024;
const BUCKET_MASK = BUCKETS - 1;
/** Max cells of the descent chain examined for string pulling. */
const CHAIN_STEPS = 10;

const DEEP = TERRAIN_CLASSES.indexOf('deep_water');
const SHALLOW = TERRAIN_CLASSES.indexOf('shallow_water');
const ROAD = TERRAIN_CLASSES.indexOf('road');

const NX = [1, -1, 0, 0, 1, 1, -1, -1];
const NZ = [0, 0, 1, -1, 1, -1, 1, -1];

interface FlowEntry {
  key: number;
  profile: number;
  side: number;
  dest: number;
  dist: Int32Array;
  lastUse: number;
}

/** Result of `waypoint()`: how the formation is being routed. */
export const ROUTE_DIRECT = 0;
export const ROUTE_FLOW = 1;
export const ROUTE_BLOCKED = 2;

export class BattleGrid {
  readonly cell = GRID_CELL;
  readonly cols: number;
  readonly rows: number;
  readonly n: number;
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
  /** TERRAIN_CLASSES index sampled at each cell center (static). */
  readonly tclass: Uint8Array;
  /** Overlay: bit (1 << side) set = impassable for that side. */
  readonly block: Uint8Array;
  /** Overlay: movement cost multiplier x10 (10 = none). Also read by movement speed (ditch, rubble, ladder). */
  readonly costMul: Uint8Array;
  /** Overlay: 1 = bridge / causeway (road class, passable over water). */
  readonly road: Uint8Array;
  /** Overlay signature the current overlay was built for (see context.ts). */
  overlaySig = -1;
  /** Fords close in flood (weather.flood > 0.5): shallow water becomes impassable. */
  readonly fordsClosed: boolean;
  private readonly base: Uint16Array[];
  private readonly roadCost: number[];
  private readonly flows: FlowEntry[] = [];
  private useClock = 0;
  private readonly head = new Int32Array(BUCKETS);
  private readonly poolNext: Int32Array;
  private readonly poolCell: Int32Array;
  /** Flow fields computed (stats for tests / profiler). */
  computed = 0;

  constructor(terrain: TerrainQuery, fordsClosed: boolean) {
    const b = terrain.bounds;
    this.minX = b.minX;
    this.minZ = b.minZ;
    this.maxX = b.maxX;
    this.maxZ = b.maxZ;
    this.cols = Math.max(1, Math.ceil((b.maxX - b.minX) / GRID_CELL));
    this.rows = Math.max(1, Math.ceil((b.maxZ - b.minZ) / GRID_CELL));
    this.n = this.cols * this.rows;
    this.fordsClosed = fordsClosed;
    this.tclass = new Uint8Array(this.n);
    this.block = new Uint8Array(this.n);
    this.costMul = new Uint8Array(this.n).fill(10);
    this.road = new Uint8Array(this.n);
    // Conservative sampling: a cell is deep water if its center or any of its four corners is, so a centroid kept on
    // passable cells never stands in deep water, even at a ford's edge.
    const inset = GRID_CELL * 0.5 - 0.25;
    for (let z = 0; z < this.rows; z++) {
      for (let x = 0; x < this.cols; x++) {
        const cx = Math.min(b.maxX - 0.5, this.minX + (x + 0.5) * GRID_CELL);
        const cz = Math.min(b.maxZ - 0.5, this.minZ + (z + 0.5) * GRID_CELL);
        let k = TERRAIN_CLASSES.indexOf(terrain.terrainClassAt(cx, cz));
        if (k !== DEEP) {
          for (let q = 0; q < 4; q++) {
            const sx = Math.min(b.maxX - 0.01, Math.max(b.minX, cx + (q & 1 ? inset : -inset)));
            const sz = Math.min(b.maxZ - 0.01, Math.max(b.minZ, cz + (q & 2 ? inset : -inset)));
            if (terrain.terrainClassAt(sx, sz) === 'deep_water') {
              k = DEEP;
              break;
            }
          }
        }
        this.tclass[z * this.cols + x] = k;
      }
    }
    this.base = [];
    this.roadCost = [];
    for (const group of MOVE_PROFILES) {
      const t = UNITS[group[0]!].terrain;
      const costs = new Uint16Array(this.n);
      for (let c = 0; c < this.n; c++) {
        const k = this.tclass[c]!;
        if (k === DEEP || (k === SHALLOW && fordsClosed)) costs[c] = 0;
        else costs[c] = Math.max(1, Math.round(10 / t[TERRAIN_CLASSES[k]!].speed));
      }
      this.base.push(costs);
      this.roadCost.push(Math.max(1, Math.round(10 / t.road.speed)));
    }
    const padded = (this.cols + 2) * (this.rows + 2);
    this.poolNext = new Int32Array(padded * 8 + 64);
    this.poolCell = new Int32Array(padded * 8 + 64);
    this.padCost = new Int32Array(padded);
    this.padDist = new Int32Array(padded);
  }

  private readonly padCost: Int32Array;
  private readonly padDist: Int32Array;

  // ------------------------------------------------------------------------------------------- cells

  cellX(x: number): number {
    const c = Math.floor((x - this.minX) / GRID_CELL);
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  cellZ(z: number): number {
    const c = Math.floor((z - this.minZ) / GRID_CELL);
    return c < 0 ? 0 : c >= this.rows ? this.rows - 1 : c;
  }

  cellAt(x: number, z: number): number {
    return this.cellZ(z) * this.cols + this.cellX(x);
  }

  centerX(c: number): number {
    return this.minX + ((c % this.cols) + 0.5) * GRID_CELL;
  }

  centerZ(c: number): number {
    return this.minZ + (Math.floor(c / this.cols) + 0.5) * GRID_CELL;
  }

  /** Terrain class at a point including overlays (bridges read as road). */
  classAt(x: number, z: number): TerrainClass {
    const c = this.cellAt(x, z);
    return TERRAIN_CLASSES[this.road[c] ? ROAD : this.tclass[c]!]!;
  }

  /** Cost multiplier (1 = none) of the overlay at a point: ditch 2.5, rubble 1.5, ladder 4. */
  slowAt(x: number, z: number): number {
    return this.costMul[this.cellAt(x, z)]! / 10;
  }

  /** Integer entry cost of a cell for (profile, side); 0 = impassable. */
  cost(c: number, profile: number, side: number): number {
    if (this.block[c]! & (1 << side)) return 0;
    const b = this.road[c] ? this.roadCost[profile]! : this.base[profile]![c]!;
    if (b === 0) return 0;
    const m = this.costMul[c]!;
    return m === 10 ? b : Math.max(1, Math.round((b * m) / 10));
  }

  passableAt(x: number, z: number, profile: number, side: number): boolean {
    if (x < this.minX || z < this.minZ || x > this.maxX || z > this.maxZ) return false;
    return this.cost(this.cellAt(x, z), profile, side) > 0;
  }

  /** Clear the dynamic overlay (before rebuilding it from state). Invalidates cached flow fields. */
  resetOverlay(): void {
    this.block.fill(0);
    this.costMul.fill(10);
    this.road.fill(0);
    for (const f of this.flows) f.key = -1;
  }

  /**
   * Visit the cells covered by a thick segment (a rectangle of half-width `halfWidth` around a->b), calling
   * fn(cellIndex). Used by works (palisade, ditch, bridge) and the wall ring.
   */
  rasterSegment(ax: number, az: number, bx: number, bz: number, halfWidth: number, fn: (c: number) => void): void {
    const minX = Math.min(ax, bx) - halfWidth - GRID_CELL;
    const maxX = Math.max(ax, bx) + halfWidth + GRID_CELL;
    const minZ = Math.min(az, bz) - halfWidth - GRID_CELL;
    const maxZ = Math.max(az, bz) + halfWidth + GRID_CELL;
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const reach = halfWidth + GRID_CELL * 0.5;
    for (let cz = this.cellZ(minZ); cz <= this.cellZ(maxZ); cz++) {
      for (let cx = this.cellX(minX); cx <= this.cellX(maxX); cx++) {
        const c = cz * this.cols + cx;
        const px = this.minX + (cx + 0.5) * GRID_CELL;
        const pz = this.minZ + (cz + 0.5) * GRID_CELL;
        let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = ax + dx * t - px;
        const qz = az + dz * t - pz;
        if (qx * qx + qz * qz <= reach * reach) fn(c);
      }
    }
  }

  // ------------------------------------------------------------------------------------------- flow fields

  /**
   * Flow field (cost-to-go per cell) toward `dest` for (profile, side), cached LRU. If the destination cell is
   * impassable for this profile, the nearest passable cell (ring search) is the goal.
   */
  flowField(profile: number, side: number, dest: number): Int32Array {
    const key = (dest * 16 + profile) * 2 + side;
    this.useClock++;
    let victim: FlowEntry | null = null;
    for (const f of this.flows) {
      if (f.key === key) {
        f.lastUse = this.useClock;
        return f.dist;
      }
      if (!victim || f.lastUse < victim.lastUse) victim = f;
    }
    let entry: FlowEntry;
    if (this.flows.length < FLOW_CACHE) {
      entry = { key, profile, side, dest, dist: new Int32Array(this.n), lastUse: this.useClock };
      this.flows.push(entry);
    } else {
      entry = victim!;
      entry.key = key;
      entry.profile = profile;
      entry.side = side;
      entry.dest = dest;
      entry.lastUse = this.useClock;
    }
    this.computeField(entry.dist, profile, side, dest);
    return entry.dist;
  }

  /** Nearest passable cell to `c` for (profile, side) in growing square rings (deterministic), or -1. */
  nearestPassable(c: number, profile: number, side: number, maxRing = 24): number {
    if (this.cost(c, profile, side) > 0) return c;
    const x0 = c % this.cols;
    const z0 = Math.floor(c / this.cols);
    for (let r = 1; r <= maxRing; r++) {
      let best = -1;
      let bd = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const x = x0 + dx;
          const z = z0 + dz;
          if (x < 0 || z < 0 || x >= this.cols || z >= this.rows) continue;
          const k = z * this.cols + x;
          if (this.cost(k, profile, side) === 0) continue;
          const d = dx * dx + dz * dz;
          if (d < bd) {
            bd = d;
            best = k;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  private computeField(dist: Int32Array, profile: number, side: number, dest: number): void {
    this.computed++;
    dist.fill(FLOW_INF);
    const goal = this.nearestPassable(dest, profile, side);
    if (goal < 0) return;
    // Work on a grid padded with an impassable border (no bounds checks in the relaxation loop). Entry costs for this
    // (profile, side) are computed once per field.
    const cols = this.cols;
    const rows = this.rows;
    const W = cols + 2;
    const cost = this.padCost;
    const pd = this.padDist;
    pd.fill(FLOW_INF);
    for (let z = 0; z < rows; z++) {
      const row = (z + 1) * W + 1;
      for (let x = 0; x < cols; x++) cost[row + x] = this.cost(z * cols + x, profile, side);
    }
    const off0 = 1;
    const off1 = -1;
    const off2 = W;
    const off3 = -W;
    const head = this.head;
    head.fill(-1);
    const pNext = this.poolNext;
    const pCell = this.poolCell;
    const cap = pCell.length;
    const g = (Math.floor(goal / cols) + 1) * W + (goal % cols) + 1;
    pd[g] = 0;
    pCell[0] = g;
    pNext[0] = -1;
    head[0] = 0;
    let used = 1;
    let pending = 1;
    let d = 0;
    while (pending > 0) {
      const bi = d & BUCKET_MASK;
      let e = head[bi]!;
      head[bi] = -1;
      while (e >= 0) {
        pending--;
        const c = pCell[e]!;
        e = pNext[e]!;
        if (pd[c] !== d) continue;
        const cc = cost[c]!;
        const cE = cost[c + off0]!;
        const cW = cost[c + off1]!;
        const cS = cost[c + off2]!;
        const cN = cost[c + off3]!;
        for (let k = 0; k < 8; k++) {
          let nb: number;
          let cn: number;
          let diag = false;
          switch (k) {
            case 0:
              nb = c + off0;
              cn = cE;
              break;
            case 1:
              nb = c + off1;
              cn = cW;
              break;
            case 2:
              nb = c + off2;
              cn = cS;
              break;
            case 3:
              nb = c + off3;
              cn = cN;
              break;
            case 4:
              // No corner cutting: both orthogonal cells must be passable.
              if (cE === 0 || cS === 0) continue;
              nb = c + off0 + off2;
              cn = cost[nb]!;
              diag = true;
              break;
            case 5:
              if (cE === 0 || cN === 0) continue;
              nb = c + off0 + off3;
              cn = cost[nb]!;
              diag = true;
              break;
            case 6:
              if (cW === 0 || cS === 0) continue;
              nb = c + off1 + off2;
              cn = cost[nb]!;
              diag = true;
              break;
            default:
              if (cW === 0 || cN === 0) continue;
              nb = c + off1 + off3;
              cn = cost[nb]!;
              diag = true;
              break;
          }
          if (cn === 0) continue;
          let w = diag ? ((cc + cn) * 0.7071 + 0.5) | 0 : ((cc + cn) * 0.5 + 0.5) | 0;
          if (w < 1) w = 1;
          else if (w > BUCKETS - 2) w = BUCKETS - 2;
          const nd = d + w;
          if (nd < pd[nb]!) {
            pd[nb] = nd;
            if (used >= cap) continue;
            const bj = nd & BUCKET_MASK;
            pCell[used] = nb;
            pNext[used] = head[bj]!;
            head[bj] = used;
            used++;
            pending++;
          }
        }
      }
      d++;
    }
    for (let z = 0; z < rows; z++) {
      const row = (z + 1) * W + 1;
      const out = z * cols;
      for (let x = 0; x < cols; x++) dist[out + x] = pd[row + x]!;
    }
  }

  /** Next cell down the flow field from `c` (steepest descent, no corner cutting), or -1 at the goal / unreachable. */
  descend(dist: Int32Array, c: number, profile: number, side: number): number {
    const cols = this.cols;
    const x = c % cols;
    const z = (c - x) / cols;
    let best = -1;
    let bd = dist[c]!;
    for (let k = 0; k < 8; k++) {
      const nx = x + NX[k]!;
      const nz = z + NZ[k]!;
      if (nx < 0 || nz < 0 || nx >= cols || nz >= this.rows) continue;
      const nb = nz * cols + nx;
      const v = dist[nb]!;
      if (v >= bd) continue;
      if (k >= 4 && (this.cost(z * cols + nx, profile, side) === 0 || this.cost(nz * cols + x, profile, side) === 0)) continue;
      bd = v;
      best = nb;
    }
    return best;
  }

  /**
   * True if the straight segment (x0,z0)->(x1,z1) only crosses passable cells for (profile, side), none of them
   * more than `maxSlow` x the cost of the starting cell (so a straight line never wades a marsh the flow field
   * would avoid). Grid traversal (Amanatides-Woo).
   */
  lineClear(x0: number, z0: number, x1: number, z1: number, profile: number, side: number, maxSlow = 2.5): boolean {
    let cx = this.cellX(x0);
    let cz = this.cellZ(z0);
    const ex = this.cellX(x1);
    const ez = this.cellZ(z1);
    const start = this.cost(cz * this.cols + cx, profile, side);
    const limit = start > 0 ? start * maxSlow : Infinity;
    const dx = x1 - x0;
    const dz = z1 - z0;
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(GRID_CELL / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(GRID_CELL / dz) : Infinity;
    const bx = this.minX + (cx + (stepX > 0 ? 1 : 0)) * GRID_CELL;
    const bz = this.minZ + (cz + (stepZ > 0 ? 1 : 0)) * GRID_CELL;
    let tMaxX = dx !== 0 ? (bx - x0) / dx : Infinity;
    let tMaxZ = dz !== 0 ? (bz - z0) / dz : Infinity;
    let guard = this.cols + this.rows + 4;
    while (guard-- > 0) {
      if (cx === ex && cz === ez) return true;
      if (tMaxX < tMaxZ) {
        tMaxX += tDeltaX;
        cx += stepX;
      } else {
        tMaxZ += tDeltaZ;
        cz += stepZ;
      }
      if (cx < 0 || cz < 0 || cx >= this.cols || cz >= this.rows) return false;
      const k = this.cost(cz * this.cols + cx, profile, side);
      if (k === 0 || k > limit) return false;
    }
    return true;
  }

  /**
   * Steering target for a formation at (x, z) heading for (tx, tz). Writes the point to steer at into `out` and
   * returns ROUTE_DIRECT (straight line clear), ROUTE_FLOW (following the flow field) or ROUTE_BLOCKED (no route
   * from here: `out` = the goal, the mover slides along obstacles).
   */
  waypoint(profile: number, side: number, x: number, z: number, tx: number, tz: number, out: { x: number; z: number }): number {
    out.x = tx;
    out.z = tz;
    if (this.lineClear(x, z, tx, tz, profile, side)) return ROUTE_DIRECT;
    const dest = this.cellAt(tx, tz);
    const dist = this.flowField(profile, side, dest);
    const here = this.cellAt(x, z);
    if (dist[here]! >= FLOW_INF) return ROUTE_BLOCKED;
    let c = here;
    let best = -1;
    for (let i = 0; i < CHAIN_STEPS; i++) {
      const nx = this.descend(dist, c, profile, side);
      if (nx < 0) break;
      c = nx;
      if (dist[c] === 0) {
        // Reached the goal cell: head for the real target if it is visible from here.
        if (this.lineClear(x, z, tx, tz, profile, side, Infinity)) return ROUTE_DIRECT;
      }
      if (this.lineClear(x, z, this.centerX(c), this.centerZ(c), profile, side, Infinity)) best = c;
      else if (best >= 0) break;
    }
    if (best < 0) {
      // Not even the first step is visible from the exact position: aim at the next cell's center.
      best = this.descend(dist, here, profile, side);
      if (best < 0) return ROUTE_DIRECT;
    }
    out.x = this.centerX(best);
    out.z = this.centerZ(best);
    return ROUTE_FLOW;
  }

  /** Path length estimate (cost units / 10 ~ meters on open ground) from (x, z) to `dest` cell, or Infinity. */
  routeCost(profile: number, side: number, x: number, z: number, tx: number, tz: number): number {
    const dist = this.flowField(profile, side, this.cellAt(tx, tz));
    const v = dist[this.cellAt(x, z)]!;
    return v >= FLOW_INF ? Infinity : (v * GRID_CELL) / 10;
  }
}
