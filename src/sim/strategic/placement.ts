/**
 * AoE-style building placement on the settlement grid (DESIGN_SPEC §8.2, Contracts v2 GridCell/Rotation).
 * OWNER: Simulation Engineer - Strategic World Simulation (SIM-01). Pure and deterministic; consumed by GP-03 (placement
 * ghost), GFX-06 (layout v2: footprints, deposit markers, gates), SIM-02 (AI building) and createWorld.
 *
 * Grid: 4 m cells (RULES.construction.gridCell), cell (0, 0) spans [s.x, s.x + 4) x [s.z, s.z + 4); +i east, +j south;
 * the grid is the SQUARE of half-size r + 60 m around the centre. A footprint's `cell` is its north-west (minimum) cell
 * and covers w/4 x d/4 cells (swapped for odd `rot`).
 *
 * Placement classes (BuildingFootprint.placement):
 *   inner      every footprint cell centre within 0.85 r
 *   outer      every footprint cell centre in the ring r .. r + 60 m
 *   perimeter  the wall ring - never placed manually (walls / Citadel; cell ignored)
 *   shore      land on the settlement's side of the water, touching a cell within 20 m of water
 *   road       touching a road (cells within 8 m of a polyline; may sit on it), centre within 200 m of the settlement
 *   resource   centre within 120 m of the settlement's deposit marker (one per stone / iron / copper resource)
 * Blocked: other footprints (+1 cell margin, incl. queued sites), water, slope > 0.25, roads (except `road` placement).
 *
 * The terrain-derived grid (water, slope, roads, shore, same-bank flood fill, deposit markers) is cached per
 * settlement; occupancy is rebuilt from state on every query (cheap).
 */
import type {
  BuildingFootprint,
  BuildingType,
  GridCell,
  LandmarkDef,
  Rect,
  Rotation,
  SettlementState,
  Vec2,
  WorldState,
} from '../../core/types';
import { BUILDING_TYPES } from '../../core/types';
import { dcos, dsin, facingOf, hash1, TWO_PI } from '../../core/math';
import { BUILDINGS } from '../../data/buildings';
import { RULES } from '../../data/rules';
import { landmarkDef } from './modifiers';
import { regionTerrain } from './state';

export const GRID_CELL = RULES.construction.gridCell;
/** Grid half-size beyond the settlement radius (m). */
export const GRID_MARGIN = 60;
export const INNER_SHARE = 0.85;
export const SHORE_DISTANCE = 20;
export const ROAD_TOUCH_DISTANCE = 8;
export const ROAD_CELL_DISTANCE = 3;
export const ROAD_MAX_DISTANCE = 200;
export const RESOURCE_DISTANCE = 120;
export const MAX_SLOPE = 0.25;
/** Footprint used for a building without one (never happens with current data). */
const DEFAULT_FOOTPRINT: BuildingFootprint = { w: 8, d: 8, placement: 'inner' };

/** User-facing reasons (UI shows them under the ghost; tests assert them). */
export const PLACEMENT_REASONS = {
  noSettlement: 'No such settlement',
  unknownBuilding: 'Unknown building',
  noCell: 'Choose a place on the settlement grid',
  outsideGrid: 'Outside the settlement grounds',
  inner: 'Must be inside the walls',
  outer: 'Must be in the fields outside the walls',
  shore: 'Needs the river bank',
  road: 'Must be beside a road',
  roadTooFar: 'Too far from the settlement',
  noDeposit: 'Needs a stone, iron or copper deposit',
  resource: 'Must be near the deposit',
  water: 'Cannot build on water',
  steep: 'Too steep',
  onRoad: 'Blocked by a road',
  occupied: 'Blocked by another building',
  noRoom: 'No room left for this building',
} as const;

const F_WATER = 1;
const F_STEEP = 2;
const F_ROAD = 4;
const F_ROAD_ADJ = 8;
const F_SHORE = 16;
const F_SAME_SIDE = 32;

export interface SettlementGrid {
  settlementId: string;
  /** Settlement centre (world m) and radius. */
  x: number;
  z: number;
  radius: number;
  /** Cells from the centre to the edge: i, j in [-n, n - 1]. */
  n: number;
  /** Cells per side (2n). */
  size: number;
  /** Per-cell flags (index = (i + n) + (j + n) * size). */
  flags: Uint8Array;
  /** Distance (m) from the settlement centre to each cell centre. */
  dist: Float32Array;
  /** Deposit markers (world m) - one per stone / iron / copper resource of the settlement. */
  deposits: Vec2[];
  /** Cell indices sorted by distance from the centre (ties by index). */
  order: Int32Array;
}

export interface PlacementResult {
  ok: boolean;
  reason: string | null;
}

export interface PlacedFootprint {
  cell: GridCell;
  rot: Rotation;
}

// ---------------------------------------------------------------------------------------------------
// Footprints
// ---------------------------------------------------------------------------------------------------

/** Footprint of a building type or a landmark id. */
export function footprintOf(building: BuildingType | string): BuildingFootprint | null {
  if ((BUILDING_TYPES as readonly string[]).includes(building)) return BUILDINGS[building as BuildingType].footprint ?? DEFAULT_FOOTPRINT;
  const lm: LandmarkDef | undefined = landmarkDef(building);
  return lm ? lm.footprint : null;
}

/** Footprint size in cells for a rotation (odd rot swaps width and depth). */
export function footprintCells(fp: BuildingFootprint, rot: Rotation): { wc: number; dc: number } {
  const wc = Math.max(1, Math.round(fp.w / GRID_CELL));
  const dc = Math.max(1, Math.round(fp.d / GRID_CELL));
  return rot % 2 === 1 ? { wc: dc, dc: wc } : { wc, dc };
}

/** World-space rectangle of a placed footprint. */
export function footprintRect(s: Pick<SettlementState, 'x' | 'z'>, fp: BuildingFootprint, cell: GridCell, rot: Rotation): Rect {
  const { wc, dc } = footprintCells(fp, rot);
  const minX = s.x + cell[0] * GRID_CELL;
  const minZ = s.z + cell[1] * GRID_CELL;
  return { minX, minZ, maxX: minX + wc * GRID_CELL, maxZ: minZ + dc * GRID_CELL };
}

/** World centre of a cell. */
export function cellCenter(s: Pick<SettlementState, 'x' | 'z'>, cell: GridCell): Vec2 {
  return { x: s.x + cell[0] * GRID_CELL + GRID_CELL / 2, z: s.z + cell[1] * GRID_CELL + GRID_CELL / 2 };
}

/** Cell containing a world point. */
export function worldToCell(s: Pick<SettlementState, 'x' | 'z'>, x: number, z: number): GridCell {
  return [Math.floor((x - s.x) / GRID_CELL), Math.floor((z - s.z) / GRID_CELL)];
}

/** Facing angle of a rotation (0 = model front faces +Z). */
export function rotationFacing(rot: Rotation): number {
  return (rot * Math.PI) / 2;
}

// ---------------------------------------------------------------------------------------------------
// Terrain grid (cached)
// ---------------------------------------------------------------------------------------------------

const gridCache = new Map<string, SettlementGrid>();

function gridKey(world: WorldState, s: SettlementState): string {
  return `${world.region.terrain.seed}|${s.id}|${s.x}|${s.z}|${s.radius}`;
}

/** Deterministic deposit markers: in the outer ring at a hashed angle, nudged onto dry, gentle ground. */
function depositMarkers(s: SettlementState, flagsAt: (x: number, z: number) => number): Vec2[] {
  const out: Vec2[] = [];
  let k = 0;
  for (const res of s.resources) {
    if (res !== 'stone' && res !== 'iron' && res !== 'copper') continue;
    let seed = 0;
    for (let i = 0; i < s.id.length; i++) seed = (seed * 31 + s.id.charCodeAt(i)) >>> 0;
    const base = hash1(k + res.length * 7, seed) * TWO_PI;
    const r = s.radius + GRID_MARGIN / 2;
    let best: Vec2 = { x: s.x + dsin(base) * r, z: s.z + dcos(base) * r };
    for (let step = 0; step < 24; step++) {
      const a = base + (step % 2 === 0 ? 1 : -1) * Math.ceil(step / 2) * (TWO_PI / 24);
      const p = { x: s.x + dsin(a) * r, z: s.z + dcos(a) * r };
      if ((flagsAt(p.x, p.z) & (F_WATER | F_STEEP)) === 0) {
        best = p;
        break;
      }
    }
    out.push(best);
    k++;
  }
  return out;
}

/** The terrain-derived placement grid of a settlement (cached; terrain and road geometry never change). */
export function getSettlementGrid(world: WorldState, s: SettlementState): SettlementGrid {
  const key = gridKey(world, s);
  const hit = gridCache.get(key);
  if (hit) return hit;
  const hf = regionTerrain(world);
  const n = Math.ceil((s.radius + GRID_MARGIN) / GRID_CELL);
  const size = n * 2;
  const total = size * size;
  const flags = new Uint8Array(total);
  const dist = new Float32Array(total);
  for (let j = -n; j < n; j++) {
    for (let i = -n; i < n; i++) {
      const idx = i + n + (j + n) * size;
      const cx = s.x + i * GRID_CELL + GRID_CELL / 2;
      const cz = s.z + j * GRID_CELL + GRID_CELL / 2;
      dist[idx] = Math.sqrt((cx - s.x) * (cx - s.x) + (cz - s.z) * (cz - s.z));
      let f = 0;
      if (hf.isWater(cx, cz)) f |= F_WATER;
      else if (hf.slopeAt(cx, cz) > MAX_SLOPE) f |= F_STEEP;
      flags[idx] = f;
    }
  }
  // Roads: rasterize polylines of every edge touching the grid.
  const minX = s.x - n * GRID_CELL;
  const minZ = s.z - n * GRID_CELL;
  const maxX = s.x + n * GRID_CELL;
  const maxZ = s.z + n * GRID_CELL;
  for (const eid of Object.keys(world.roads.edges).sort()) {
    const e = world.roads.edges[eid]!;
    for (let p = 1; p < e.points.length; p++) {
      const a = e.points[p - 1]!;
      const b = e.points[p]!;
      const sx0 = Math.min(a.x, b.x) - ROAD_TOUCH_DISTANCE;
      const sx1 = Math.max(a.x, b.x) + ROAD_TOUCH_DISTANCE;
      const sz0 = Math.min(a.z, b.z) - ROAD_TOUCH_DISTANCE;
      const sz1 = Math.max(a.z, b.z) + ROAD_TOUCH_DISTANCE;
      if (sx1 < minX || sx0 > maxX || sz1 < minZ || sz0 > maxZ) continue;
      const i0 = Math.max(-n, Math.floor((sx0 - s.x) / GRID_CELL));
      const i1 = Math.min(n - 1, Math.floor((sx1 - s.x) / GRID_CELL));
      const j0 = Math.max(-n, Math.floor((sz0 - s.z) / GRID_CELL));
      const j1 = Math.min(n - 1, Math.floor((sz1 - s.z) / GRID_CELL));
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l2 = dx * dx + dz * dz;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const cx = s.x + i * GRID_CELL + GRID_CELL / 2;
          const cz = s.z + j * GRID_CELL + GRID_CELL / 2;
          let t = l2 > 0 ? ((cx - a.x) * dx + (cz - a.z) * dz) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = a.x + dx * t - cx;
          const pz = a.z + dz * t - cz;
          const d = Math.sqrt(px * px + pz * pz);
          const idx = i + n + (j + n) * size;
          if (d <= ROAD_CELL_DISTANCE) flags[idx] = (flags[idx] as number) | F_ROAD | F_ROAD_ADJ;
          else if (d <= ROAD_TOUCH_DISTANCE) flags[idx] = (flags[idx] as number) | F_ROAD_ADJ;
        }
      }
    }
  }
  // Same side of the water: flood fill land from the centre cell (4-connected, crossing no water cell).
  const start = n + n * size;
  const stack: number[] = [];
  if (((flags[start] as number) & F_WATER) === 0) {
    flags[start] = (flags[start] as number) | F_SAME_SIDE;
    stack.push(start);
  }
  while (stack.length) {
    const idx = stack.pop() as number;
    const ci = idx % size;
    const cj = (idx - ci) / size;
    const nb = [ci > 0 ? idx - 1 : -1, ci < size - 1 ? idx + 1 : -1, cj > 0 ? idx - size : -1, cj < size - 1 ? idx + size : -1];
    for (const k of nb) {
      if (k < 0) continue;
      const f = flags[k] as number;
      if (f & (F_WATER | F_SAME_SIDE)) continue;
      flags[k] = f | F_SAME_SIDE;
      stack.push(k);
    }
  }
  // Shore: land cells within 20 m of a water cell (chessboard distance in cells).
  const reach = Math.ceil(SHORE_DISTANCE / GRID_CELL);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const idx = i + j * size;
      if (((flags[idx] as number) & F_WATER) === 0) continue;
      for (let dj = -reach; dj <= reach; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= size) continue;
        for (let di = -reach; di <= reach; di++) {
          const ii = i + di;
          if (ii < 0 || ii >= size) continue;
          if (di * di + dj * dj > reach * reach) continue;
          const k = ii + jj * size;
          if (((flags[k] as number) & F_WATER) === 0) flags[k] = (flags[k] as number) | F_SHORE;
        }
      }
    }
  }
  const flagsAt = (x: number, z: number): number => {
    const i = Math.floor((x - s.x) / GRID_CELL);
    const j = Math.floor((z - s.z) / GRID_CELL);
    if (i < -n || i >= n || j < -n || j >= n) return F_STEEP;
    return flags[i + n + (j + n) * size] as number;
  };
  const deposits = depositMarkers(s, flagsAt);
  const order = new Int32Array(total);
  for (let k = 0; k < total; k++) order[k] = k;
  const sorted = Array.from(order).sort((a, b) => (dist[a] as number) - (dist[b] as number) || a - b);
  for (let k = 0; k < total; k++) order[k] = sorted[k] as number;
  const grid: SettlementGrid = { settlementId: s.id, x: s.x, z: s.z, radius: s.radius, n, size, flags, dist, deposits, order };
  gridCache.set(key, grid);
  return grid;
}

/** Flag helpers for the renderer's grid overlay. */
export const GRID_FLAGS = { water: F_WATER, steep: F_STEEP, road: F_ROAD, roadAdjacent: F_ROAD_ADJ, shore: F_SHORE, sameSide: F_SAME_SIDE } as const;

// ---------------------------------------------------------------------------------------------------
// Occupancy
// ---------------------------------------------------------------------------------------------------

interface Footprinted {
  key: string;
  fp: BuildingFootprint;
  cell: GridCell;
  rot: Rotation;
}

/** Every placed footprint in the settlement (buildings, landmarks, queued construction sites). */
export function placedFootprints(s: SettlementState): Footprinted[] {
  const out: Footprinted[] = [];
  for (const b of s.buildings) {
    if (!b.cell) continue;
    const fp = footprintOf(b.type);
    if (fp && fp.placement !== 'perimeter') out.push({ key: b.type, fp, cell: b.cell, rot: b.rot ?? 0 });
  }
  for (const l of s.landmarks) {
    if (!l.cell) continue;
    const fp = footprintOf(l.id);
    if (fp && fp.placement !== 'perimeter') out.push({ key: l.id, fp, cell: l.cell, rot: l.rot ?? 0 });
  }
  for (const j of s.construction) {
    if (!j.cell) continue;
    const fp = footprintOf(j.landmarkId ?? j.type);
    if (fp && fp.placement !== 'perimeter') out.push({ key: j.landmarkId ?? j.type, fp, cell: j.cell, rot: j.rot ?? 0 });
  }
  return out;
}

function occupancy(grid: SettlementGrid, s: SettlementState, ignoreKey: string | null): Uint8Array {
  const occ = new Uint8Array(grid.size * grid.size);
  for (const p of placedFootprints(s)) {
    if (ignoreKey !== null && p.key === ignoreKey) continue;
    const { wc, dc } = footprintCells(p.fp, p.rot);
    for (let j = p.cell[1] - 1; j <= p.cell[1] + dc; j++) {
      for (let i = p.cell[0] - 1; i <= p.cell[0] + wc; i++) {
        if (i < -grid.n || i >= grid.n || j < -grid.n || j >= grid.n) continue;
        occ[i + grid.n + (j + grid.n) * grid.size] = 1;
      }
    }
  }
  return occ;
}

// ---------------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------------

function checkCells(grid: SettlementGrid, occ: Uint8Array, s: SettlementState, fp: BuildingFootprint, cell: GridCell, rot: Rotation): PlacementResult {
  const R = PLACEMENT_REASONS;
  const { wc, dc } = footprintCells(fp, rot);
  const n = grid.n;
  if (cell[0] < -n || cell[1] < -n || cell[0] + wc > n || cell[1] + dc > n) return { ok: false, reason: R.outsideGrid };
  let touchesRoad = false;
  let touchesShore = false;
  // Class geometry first (most informative reason), then blocking.
  for (let j = cell[1]; j < cell[1] + dc; j++) {
    for (let i = cell[0]; i < cell[0] + wc; i++) {
      const idx = i + n + (j + n) * grid.size;
      const d = grid.dist[idx] as number;
      const f = grid.flags[idx] as number;
      switch (fp.placement) {
        case 'inner':
          if (d > INNER_SHARE * s.radius) return { ok: false, reason: R.inner };
          break;
        case 'outer':
          if (d < s.radius || d > s.radius + GRID_MARGIN) return { ok: false, reason: R.outer };
          break;
        case 'shore':
          if ((f & F_WATER) === 0 && (f & F_SAME_SIDE) === 0) return { ok: false, reason: R.shore };
          if (f & F_SHORE) touchesShore = true;
          break;
        case 'road':
          if (f & F_ROAD_ADJ) touchesRoad = true;
          break;
        default:
          break;
      }
    }
  }
  const centerX = s.x + (cell[0] + wc / 2) * GRID_CELL;
  const centerZ = s.z + (cell[1] + dc / 2) * GRID_CELL;
  if (fp.placement === 'shore' && !touchesShore) return { ok: false, reason: R.shore };
  if (fp.placement === 'road') {
    if (!touchesRoad) return { ok: false, reason: R.road };
    const dc2 = (centerX - s.x) * (centerX - s.x) + (centerZ - s.z) * (centerZ - s.z);
    if (dc2 > ROAD_MAX_DISTANCE * ROAD_MAX_DISTANCE) return { ok: false, reason: R.roadTooFar };
  }
  if (fp.placement === 'resource') {
    if (grid.deposits.length === 0) return { ok: false, reason: R.noDeposit };
    let near = false;
    for (const d of grid.deposits) if ((d.x - centerX) * (d.x - centerX) + (d.z - centerZ) * (d.z - centerZ) <= RESOURCE_DISTANCE * RESOURCE_DISTANCE) near = true;
    if (!near) return { ok: false, reason: R.resource };
  }
  for (let j = cell[1]; j < cell[1] + dc; j++) {
    for (let i = cell[0]; i < cell[0] + wc; i++) {
      const idx = i + n + (j + n) * grid.size;
      const f = grid.flags[idx] as number;
      if (f & F_WATER) return { ok: false, reason: R.water };
      if (f & F_STEEP) return { ok: false, reason: R.steep };
      if (fp.placement !== 'road' && f & F_ROAD) return { ok: false, reason: R.onRoad };
      if (occ[idx]) return { ok: false, reason: R.occupied };
    }
  }
  return { ok: true, reason: null };
}

/**
 * Can `building` (a BuildingType or a landmark id) stand at `cell` with `rot` in the settlement? Checks only the
 * placement rules (costs, age, queue: construction.validateBuild). Perimeter buildings are always valid (cell ignored).
 */
export function validatePlacement(world: WorldState, settlementId: string, building: BuildingType | string, cell: GridCell | null | undefined, rot: Rotation = 0): PlacementResult {
  const s = world.settlements[settlementId];
  if (!s) return { ok: false, reason: PLACEMENT_REASONS.noSettlement };
  const fp = footprintOf(building);
  if (!fp) return { ok: false, reason: PLACEMENT_REASONS.unknownBuilding };
  if (fp.placement === 'perimeter') return { ok: true, reason: null };
  if (!cell) return { ok: false, reason: PLACEMENT_REASONS.noCell };
  const grid = getSettlementGrid(world, s);
  return checkCells(grid, occupancy(grid, s, null), s, fp, cell, rot);
}

export interface AutoPlaceOptions {
  /** Rotations to try in order (default [0, 1]). */
  rotations?: Rotation[];
  /** Prefer spots near this world point (touch ghost: closest to the centre by default). */
  near?: Vec2 | null;
  /** Fallback for starting buildings: accept any dry, gentle, free cell of the right class region ignoring shore/road/resource. */
  relaxed?: boolean;
}

/**
 * Best valid spot for `building` (closest to the centre, or to `near`; resource buildings: closest to the deposit).
 * Returns null when nothing fits. Perimeter buildings return null (they need no cell).
 */
export function autoPlace(world: WorldState, settlementId: string, building: BuildingType | string, opts: AutoPlaceOptions = {}): PlacedFootprint | null {
  const s = world.settlements[settlementId];
  if (!s) return null;
  const fp = footprintOf(building);
  if (!fp || fp.placement === 'perimeter') return null;
  const grid = getSettlementGrid(world, s);
  const occ = occupancy(grid, s, null);
  const rots: Rotation[] = opts.rotations ?? (fp.w === fp.d ? [0] : [0, 1]);
  let order: ArrayLike<number> = grid.order;
  const target = opts.near ?? (fp.placement === 'resource' && grid.deposits[0] ? grid.deposits[0] : null);
  if (target) {
    const idx = Array.from(grid.order);
    const d2 = (k: number): number => {
      const i = (k % grid.size) - grid.n;
      const j = Math.floor(k / grid.size) - grid.n;
      const cx = s.x + i * GRID_CELL + GRID_CELL / 2 - target.x;
      const cz = s.z + j * GRID_CELL + GRID_CELL / 2 - target.z;
      return cx * cx + cz * cz;
    };
    idx.sort((a, b) => d2(a) - d2(b) || a - b);
    order = idx;
  }
  const relaxedFp: BuildingFootprint | null = opts.relaxed ? { ...fp, placement: fp.placement === 'outer' ? 'outer' : 'inner' } : null;
  for (const useFp of relaxedFp ? [fp, relaxedFp] : [fp]) {
    for (let k = 0; k < order.length; k++) {
      const c = order[k] as number;
      const ci = (c % grid.size) - grid.n;
      const cj = Math.floor(c / grid.size) - grid.n;
      for (const rot of rots) {
        const { wc, dc } = footprintCells(useFp, rot);
        const cell: GridCell = [ci - Math.floor(wc / 2), cj - Math.floor(dc / 2)];
        if (checkCells(grid, occ, s, useFp, cell, rot).ok) return { cell, rot };
      }
    }
  }
  return null;
}

/**
 * Give every building / landmark without a cell a deterministic place (createWorld starting buildings, v1 saves).
 * Large footprints first. Buildings that fit nowhere keep no cell (procedural layout).
 */
export function assignMissingCells(world: WorldState, s: SettlementState): void {
  const todo = s.buildings
    .filter((b) => !b.cell && footprintOf(b.type)?.placement !== 'perimeter')
    .sort((a, b) => {
      const fa = footprintOf(a.type) as BuildingFootprint;
      const fb = footprintOf(b.type) as BuildingFootprint;
      return fb.w * fb.d - fa.w * fa.d || (a.type < b.type ? -1 : 1);
    });
  for (const b of todo) {
    const p = autoPlace(world, s.id, b.type, { relaxed: true });
    if (p) {
      b.cell = p.cell;
      b.rot = p.rot;
    }
  }
}

/** Deposit markers of a settlement (renderer + placement ghost). */
export function depositMarkersOf(world: WorldState, settlementId: string): Vec2[] {
  const s = world.settlements[settlementId];
  return s ? getSettlementGrid(world, s).deposits.map((d) => ({ x: d.x, z: d.z })) : [];
}

/** Angles (facing convention) of the road exits through the wall ring - gates snap here (DESIGN_SPEC §8.6). */
export function gateAngles(world: WorldState, settlementId: string): number[] {
  const s = world.settlements[settlementId];
  if (!s) return [];
  const node = `node_${s.id}`;
  const out: number[] = [];
  for (const eid of world.roads.adjacency[node] ?? []) {
    const e = world.roads.edges[eid];
    if (!e) continue;
    const pts = e.a === node ? e.points : e.points.slice().reverse();
    let p: Vec2 | null = null;
    for (const q of pts) {
      if ((q.x - s.x) * (q.x - s.x) + (q.z - s.z) * (q.z - s.z) >= s.radius * s.radius) {
        p = q;
        break;
      }
    }
    if (!p) p = pts[pts.length - 1] ?? null;
    if (!p) continue;
    out.push(facingOf(p.x - s.x, p.z - s.z));
  }
  return out.sort((x, y) => x - y);
}
