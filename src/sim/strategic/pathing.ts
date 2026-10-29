/**
 * Strategic route planning and march speed (DESIGN_SPEC §7.7, §3.4). OWNER: Simulation Engineer - Strategic World
 * Simulation (SIM-01).
 *
 * Route = optional off-road leg to a road node (or, within 400 m, to the nearest vertex of a road) -> shortest road path
 * (Dijkstra over world.roads; 16 nodes) -> optional off-road leg to the target, or a direct off-road leg - whichever
 * takes fewer hours. Bridge / ford crossings are off-road waypoints too.
 *   edge hours  = length x travelScale / (marchKmPerDay[q] x 1000 / 24) / roadCondition, roadCondition =
 *                 0.5 + 0.5 x condition (x0.25 below 0.3); excluded: edges held by a hostile army, fords while
 *                 flood > 0.5, bridges below 0.3 condition for armies with carts, elephants or chariots.
 *   off-road    = 12 km/day x terrain factor per 50 m sample (forest/marsh 0.6 x forestMovement, hills/rough 0.7 x
 *                 hillMovement, shallow water 0.4, deep water impassable except at a usable bridge/ford crossing).
 *   Monsoon (varsha) x0.6 (x0.8 on royal roads) and wet ground (x(1 - 0.3 wetness x (road ? 0.4 : 1))) enter the costs.
 * March speed per hour (armies.ts) = marchKmPerDay[segment] x pace(slowest category) x faction marchSpeed x monsoon x
 * wetness x (1 - 0.3 fatigue) x forced march 1.3 (x terrain factor off-road; x roadCondition on roads).
 *
 * The planned path starts at the army's position (path[0]); `segmentInfo(world, path)` recovers which segments run
 * along which road edge (cached per path array; recomputed after a load).
 */
import type { ArmyState, RoadEdge, RoadQuality, TerrainClass, TerrainQuery, UnitCategory, Vec2, WorldState } from '../../core/types';
import { TERRAIN_CLASSES } from '../../core/types';
import { sortedKeys } from '../../core/ids';
import { BALANCE } from '../../data/balance';
import { RULES } from '../../data/rules';
import { UNITS } from '../../data/units';
import { factionMod } from './modifiers';
import { seasonOf } from './seasons';
import { hostileToArmy } from './state';

const M = BALANCE.military;
/** Map meters between off-road terrain samples. */
export const OFFROAD_SAMPLE = 50;
/** An off-road leg may cross deep water within this distance (map m) of a usable bridge / ford crossing. */
export const CROSSING_RADIUS = 160;
/** Flood stage above which fords close (DESIGN_SPEC §3.4). */
export const FORD_FLOOD_LIMIT = 0.5;
/** Bridges below this condition do not carry carts, elephants or chariots. */
export const BRIDGE_MIN_CONDITION = 0.3;

export function metersPerHourFromKmDay(kmPerDay: number): number {
  return (kmPerDay * 1000) / 24 / M.travelScale;
}

export function roadConditionFactor(condition: number): number {
  const f = 0.5 + 0.5 * condition;
  return condition < 0.3 ? f * 0.25 : f;
}

/** Monsoon x wetness factor for a road quality (null = off-road). */
export function weatherFactor(world: WorldState, q: RoadQuality | null): number {
  let f = 1;
  if (seasonOf(world.calendar) === 'varsha') f *= q === 'royal_road' ? M.monsoonMarchFactor + 0.2 : M.monsoonMarchFactor;
  f *= 1 - 0.3 * world.weather.wetness * (q ? 0.4 : 1);
  return f;
}

/** Heavy units that a weak bridge does not carry. */
export function hasHeavyUnits(army: Pick<ArmyState, 'units'>): boolean {
  for (const u of army.units) if (u.unitClass === 'supply_train' || u.unitClass === 'war_elephants' || u.unitClass === 'chariots') return true;
  return false;
}

/** Slowest category pace (§7.7): infantry/ranged 1, mounted-only 1.5, beasts 0.95, support 0.85. */
export function armyPace(army: Pick<ArmyState, 'units'>, offRoadRough: boolean): number {
  const pace = RULES.armies.pace;
  let p = Infinity;
  let any = false;
  for (const u of army.units) {
    any = true;
    const cat: UnitCategory = UNITS[u.unitClass].category;
    let v = pace[cat];
    if (u.unitClass === 'chariots' && offRoadRough) v = Math.min(v, RULES.armies.chariotOffroadPace);
    if (v < p) p = v;
  }
  return any ? p : 1;
}

/** Off-road terrain speed factor for an army's faction (§7.7). 0 = impassable (deep water). */
export function terrainFactor(world: WorldState, factionId: string, tc: TerrainClass): number {
  switch (tc) {
    case 'forest':
    case 'marsh':
      return 0.6 * factionMod(world, factionId, 'forestMovement');
    case 'hills':
    case 'rough':
      return 0.7 * factionMod(world, factionId, 'hillMovement');
    case 'shallow_water':
      return 0.4;
    case 'deep_water':
      return 0;
    default:
      return 1;
  }
}

export function isRoughTerrain(tc: TerrainClass): boolean {
  return tc !== 'open' && tc !== 'road' && tc !== 'farmland' && tc !== 'urban';
}

// ---------------------------------------------------------------------------------------------------
// Crossings
// ---------------------------------------------------------------------------------------------------

interface Crossing {
  x: number;
  z: number;
  edgeId: string;
}
const crossingCache = new WeakMap<WorldState['roads'], Crossing[]>();

/** Points where bridge / ford edges pass over water. */
export function crossingsOf(world: WorldState, terrain: TerrainQuery): Crossing[] {
  let c = crossingCache.get(world.roads);
  if (c) return c;
  c = [];
  for (const id of sortedKeys(world.roads.edges)) {
    const e = world.roads.edges[id] as RoadEdge;
    if (!e.bridge && !e.ford) continue;
    for (const p of e.points) if (terrain.isWater(p.x, p.z)) c.push({ x: p.x, z: p.z, edgeId: e.id });
  }
  crossingCache.set(world.roads, c);
  return c;
}

/** Can this army use the edge right now (blocked roads, flooded fords, weak bridges)? */
export function edgeUsable(world: WorldState, army: Pick<ArmyState, 'factionId' | 'units'>, e: RoadEdge): boolean {
  if (e.blockedBy) {
    const b = world.armies[e.blockedBy];
    if (b && hostileToArmy(world, army.factionId, b)) return false;
  }
  if (e.ford && world.weather.flood > FORD_FLOOD_LIMIT) return false;
  if (e.bridge && e.condition < BRIDGE_MIN_CONDITION && hasHeavyUnits(army)) return false;
  return true;
}

function nearUsableCrossing(world: WorldState, army: Pick<ArmyState, 'factionId' | 'units'>, terrain: TerrainQuery, x: number, z: number): boolean {
  const r2 = CROSSING_RADIUS * CROSSING_RADIUS;
  for (const c of crossingsOf(world, terrain)) {
    if ((c.x - x) * (c.x - x) + (c.z - z) * (c.z - z) > r2) continue;
    const e = world.roads.edges[c.edgeId];
    if (e && edgeUsable(world, army, e)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------
// Terrain class lookup grid (route planning samples thousands of points per plan)
// ---------------------------------------------------------------------------------------------------

/** Cell size (map m) of the lazily filled terrain-class grid used by route planning. */
export const CLASS_CELL = 20;
interface ClassGrid {
  minX: number;
  minZ: number;
  nx: number;
  nz: number;
  /** 0 = not yet sampled, else TERRAIN_CLASSES index + 1. */
  codes: Uint8Array;
}
const classGrids = new WeakMap<TerrainQuery, ClassGrid>();

/**
 * Terrain class at the centre of the 20 m cell holding (x, z) - deterministic (each cell is a pure function of the
 * terrain), filled on first use. A cell is deep water only when its centre and corners all are (river banks read as
 * shallow water). Outside the region: deep water.
 */
export function plannerClassAt(terrain: TerrainQuery, x: number, z: number): TerrainClass {
  let g = classGrids.get(terrain);
  if (!g) {
    const b = terrain.bounds;
    const nx = Math.max(1, Math.ceil((b.maxX - b.minX) / CLASS_CELL));
    const nz = Math.max(1, Math.ceil((b.maxZ - b.minZ) / CLASS_CELL));
    g = { minX: b.minX, minZ: b.minZ, nx, nz, codes: new Uint8Array(nx * nz) };
    classGrids.set(terrain, g);
  }
  const i = Math.floor((x - g.minX) / CLASS_CELL);
  const j = Math.floor((z - g.minZ) / CLASS_CELL);
  if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) return 'deep_water';
  const k = j * g.nx + i;
  let c = g.codes[k] as number;
  if (c === 0) {
    const cx = g.minX + (i + 0.5) * CLASS_CELL;
    const cz = g.minZ + (j + 0.5) * CLASS_CELL;
    let tc: TerrainClass = terrain.inBounds(cx, cz) ? terrain.terrainClassAt(cx, cz) : 'deep_water';
    // Deep water only when the whole cell is (banks read as shallow): a coarse cell must never invent a river.
    if (tc === 'deep_water' && terrain.inBounds(cx, cz)) {
      const h = CLASS_CELL / 2 - 1;
      for (let q = 0; q < 4; q++) {
        const qx = cx + (q & 1 ? h : -h);
        const qz = cz + (q & 2 ? h : -h);
        if (terrain.inBounds(qx, qz) && terrain.terrainClassAt(qx, qz) !== 'deep_water') {
          tc = 'shallow_water';
          break;
        }
      }
    }
    c = TERRAIN_CLASSES.indexOf(tc) + 1;
    g.codes[k] = c;
  }
  return TERRAIN_CLASSES[c - 1] as TerrainClass;
}

/** Hours for an off-road leg (Infinity when it would cross deep water away from a usable crossing). */
export function offRoadHours(world: WorldState, army: Pick<ArmyState, 'factionId' | 'units'>, terrain: TerrainQuery, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 1e-6) return 0;
  const n = Math.max(1, Math.ceil(d / OFFROAD_SAMPLE));
  const seg = d / n;
  const base = metersPerHourFromKmDay(M.marchKmPerDay.offroad) * weatherFactor(world, null);
  // Terrain factors once per leg (factionMod is not free).
  const fForest = terrainFactor(world, army.factionId, 'forest');
  const fHill = terrainFactor(world, army.factionId, 'hills');
  let inv = 0; // Σ 1 / factor
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = ax + dx * t;
    const z = az + dz * t;
    const tc = plannerClassAt(terrain, x, z);
    let f: number;
    switch (tc) {
      case 'forest':
      case 'marsh':
        f = fForest;
        break;
      case 'hills':
      case 'rough':
        f = fHill;
        break;
      case 'shallow_water':
        f = 0.4;
        break;
      case 'deep_water':
        if (!terrain.inBounds(x, z) || !nearUsableCrossing(world, army, terrain, x, z)) return Infinity;
        f = 0.4;
        break;
      default:
        f = 1;
    }
    inv += 1 / f;
  }
  return (seg * inv) / base;
}

/** Hours to march an edge end to end (Infinity when unusable). */
export function edgeHours(world: WorldState, army: Pick<ArmyState, 'factionId' | 'units'>, e: RoadEdge): number {
  if (!edgeUsable(world, army, e)) return Infinity;
  return e.length / (metersPerHourFromKmDay(M.marchKmPerDay[e.quality]) * weatherFactor(world, e.quality) * roadConditionFactor(e.condition));
}

// ---------------------------------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------------------------------

export interface RoutePlan {
  /** Waypoints starting at the start position. */
  points: Vec2[];
  /** Estimated hours at pace 1 (no faction / fatigue / forced-march factors). */
  hours: number;
  /** Road edges used, in order. */
  edges: string[];
  /** False when no route exists (straight-line fallback). */
  ok: boolean;
}

export interface RouteOptions {
  /** Use roads (default true); false = cross-country only (still via fords/bridges when the water demands). */
  roads?: boolean;
}

/** One waypoint per bridge / ford edge: its middle water point (cross-country routes ford or bridge rivers there). */
const crossingWaypointCache = new WeakMap<WorldState['roads'], Crossing[]>();
export function crossingWaypoints(world: WorldState, terrain: TerrainQuery): Crossing[] {
  let w = crossingWaypointCache.get(world.roads);
  if (w) return w;
  w = [];
  const all = crossingsOf(world, terrain);
  let i = 0;
  while (i < all.length) {
    let j = i;
    while (j < all.length && (all[j] as Crossing).edgeId === (all[i] as Crossing).edgeId) j++;
    w.push(all[(i + j - 1) >> 1] as Crossing);
    i = j;
  }
  crossingWaypointCache.set(world.roads, w);
  return w;
}

/** Start / target points within this distance (map m) of a road join it at its nearest polyline vertex. */
export const ROAD_JOIN_DISTANCE = 400;

/** Cumulative polyline length at each vertex (cached per points array). */
const cumCache = new WeakMap<Vec2[], Float64Array>();
function cumulative(e: RoadEdge): Float64Array {
  let c = cumCache.get(e.points);
  if (c) return c;
  c = new Float64Array(e.points.length);
  for (let i = 1; i < e.points.length; i++) {
    const a = e.points[i - 1] as Vec2;
    const b = e.points[i] as Vec2;
    c[i] = (c[i - 1] as number) + Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
  }
  cumCache.set(e.points, c);
  return c;
}

/** Nearest polyline vertex of an edge to (x, z) and its distance. */
function nearestVertex(e: RoadEdge, x: number, z: number): { k: number; d: number } {
  let k = 0;
  let bd = Infinity;
  for (let i = 0; i < e.points.length; i++) {
    const p = e.points[i] as Vec2;
    const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
    if (d < bd) {
      bd = d;
      k = i;
    }
  }
  return { k, d: Math.sqrt(bd) };
}

/** Hours along an edge between two of its vertices (share of the full edge hours by length). */
function partialHours(world: WorldState, army: Pick<ArmyState, 'factionId' | 'units'>, e: RoadEdge, from: number, to: number): number {
  const full = edgeHours(world, army, e);
  if (full === Infinity) return Infinity;
  const c = cumulative(e);
  const total = c[c.length - 1] as number;
  return total > 0 ? (full * Math.abs((c[to] as number) - (c[from] as number))) / total : 0;
}

interface Join {
  edgeId: string;
  /** Vertex where the off-road leg meets the road. */
  k: number;
  /** Off-road hours between the point and that vertex. */
  leg: number;
}

function roadJoins(world: WorldState, army: Pick<ArmyState, 'factionId' | 'units'>, terrain: TerrainQuery, x: number, z: number, toRoad: boolean, edgeIds: readonly string[]): Join[] {
  const out: Join[] = [];
  for (const id of edgeIds) {
    const e = world.roads.edges[id] as RoadEdge;
    const v = nearestVertex(e, x, z);
    if (v.d > ROAD_JOIN_DISTANCE || v.k === 0 || v.k === e.points.length - 1) continue; // ends are the nodes themselves
    const p = e.points[v.k] as Vec2;
    const leg = toRoad ? offRoadHours(world, army, terrain, x, z, p.x, p.z) : offRoadHours(world, army, terrain, p.x, p.z, x, z);
    if (leg !== Infinity) out.push({ edgeId: id, k: v.k, leg });
  }
  return out;
}

/**
 * Plan a route for `army` from (sx, sz) to (tx, tz). Dijkstra over road nodes with off-road legs from the start to
 * every node and from every node to the target; the direct off-road leg competes. A start / target within 400 m of a
 * road also joins it at the road's nearest vertex (and may run along part of that road). Usable bridge / ford
 * crossings are extra off-road waypoints (start -> crossing -> target; cross-country also crossing -> crossing), so a river is crossed
 * where it can be. With `roads: false` only off-road legs connect the waypoints (cross-country estimate).
 */
export function planRoute(world: WorldState, army: Pick<ArmyState, 'factionId' | 'units'>, sx: number, sz: number, tx: number, tz: number, terrain: TerrainQuery, opts: RouteOptions = {}): RoutePlan {
  const useRoads = opts.roads !== false;
  const nodeIds = sortedKeys(world.roads.nodes);
  const edgeIds = sortedKeys(world.roads.edges);
  const N = nodeIds.length;
  const index = new Map<string, number>();
  nodeIds.forEach((id, i) => index.set(id, i));
  const crossings: Crossing[] = [];
  for (const c of crossingWaypoints(world, terrain)) {
    const e = world.roads.edges[c.edgeId];
    if (e && edgeUsable(world, army, e)) crossings.push(c);
  }
  const C = crossings.length;
  const W = N + C; // waypoints: road nodes then crossings
  const START = W;
  const GOAL = W + 1;
  const px = new Float64Array(W);
  const pz = new Float64Array(W);
  for (let i = 0; i < N; i++) {
    const n = world.roads.nodes[nodeIds[i] as string]!;
    px[i] = n.x;
    pz[i] = n.z;
  }
  for (let k = 0; k < C; k++) {
    px[N + k] = (crossings[k] as Crossing).x;
    pz[N + k] = (crossings[k] as Crossing).z;
  }
  const dist = new Float64Array(W + 2).fill(Infinity);
  const prev = new Int32Array(W + 2).fill(-1);
  // How each waypoint was reached: along a road edge from vertex viaFrom to vertex viaTo (null edge = off-road).
  const viaEdge: (string | null)[] = new Array(W + 2).fill(null);
  const viaFrom = new Int32Array(W + 2).fill(-1);
  const viaTo = new Int32Array(W + 2).fill(-1);
  const done = new Uint8Array(W + 2);
  dist[START] = 0;
  const legToNode = new Float64Array(W);
  const legFromNode = new Float64Array(W);
  for (let i = 0; i < W; i++) {
    legToNode[i] = offRoadHours(world, army, terrain, sx, sz, px[i] as number, pz[i] as number);
    legFromNode[i] = offRoadHours(world, army, terrain, px[i] as number, pz[i] as number, tx, tz);
  }
  const direct = offRoadHours(world, army, terrain, sx, sz, tx, tz);
  const startJoins = useRoads ? roadJoins(world, army, terrain, sx, sz, true, edgeIds) : [];
  const goalJoins = useRoads ? roadJoins(world, army, terrain, tx, tz, false, edgeIds) : [];
  const relaxFrom = (u: number, v: number, cost: number, edge: string | null, from: number, to: number): void => {
    if (cost === Infinity || done[v]) return;
    const nd = (dist[u] as number) + cost;
    if (nd < (dist[v] as number)) {
      dist[v] = nd;
      prev[v] = u;
      viaEdge[v] = edge;
      viaFrom[v] = from;
      viaTo[v] = to;
    }
  };
  for (;;) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < W + 2; i++) {
      if (!done[i] && (dist[i] as number) < best) {
        best = dist[i] as number;
        u = i;
      }
    }
    if (u < 0 || u === GOAL) break;
    done[u] = 1;
    if (u === START) {
      for (let i = 0; i < W; i++) relaxFrom(u, i, legToNode[i] as number, null, -1, -1);
      relaxFrom(u, GOAL, direct, null, -1, -1);
      for (const j of startJoins) {
        const e = world.roads.edges[j.edgeId] as RoadEdge;
        const last = e.points.length - 1;
        const ia = index.get(e.a);
        const ib = index.get(e.b);
        if (ia !== undefined) relaxFrom(u, ia, j.leg + partialHours(world, army, e, j.k, 0), e.id, j.k, 0);
        if (ib !== undefined) relaxFrom(u, ib, j.leg + partialHours(world, army, e, j.k, last), e.id, j.k, last);
        // Start and target beside the same road: along it between the two join vertices.
        for (const g of goalJoins) {
          if (g.edgeId !== j.edgeId) continue;
          relaxFrom(u, GOAL, j.leg + partialHours(world, army, e, j.k, g.k) + g.leg, e.id, j.k, g.k);
        }
      }
      continue;
    }
    relaxFrom(u, GOAL, legFromNode[u] as number, null, -1, -1);
    const offRoad = (v: number): void => {
      if (v === u || done[v]) return;
      relaxFrom(u, v, offRoadHours(world, army, terrain, px[u] as number, pz[u] as number, px[v] as number, pz[v] as number), null, -1, -1);
    };
    if (u >= N) {
      // Crossing waypoint: cross-country it links to every waypoint; with roads it only bridges start -> target (a
      // road node reaches the far bank over the bridge / ford edge itself).
      if (!useRoads) for (let v = 0; v < W; v++) offRoad(v);
      continue;
    }
    const nid = nodeIds[u] as string;
    if (useRoads) {
      for (const eid of world.roads.adjacency[nid] ?? []) {
        const e = world.roads.edges[eid];
        if (!e) continue;
        const last = e.points.length - 1;
        const fromK = e.a === nid ? 0 : last;
        const other = e.a === nid ? e.b : e.a;
        const v = index.get(other);
        if (v !== undefined) relaxFrom(u, v, edgeHours(world, army, e), eid, fromK, last - fromK);
        for (const g of goalJoins) {
          if (g.edgeId !== eid) continue;
          relaxFrom(u, GOAL, partialHours(world, army, e, fromK, g.k) + g.leg, eid, fromK, g.k);
        }
      }
    } else {
      for (let v = 0; v < W; v++) offRoad(v);
    }
  }
  if ((dist[GOAL] as number) === Infinity) {
    return { points: [{ x: sx, z: sz }, { x: tx, z: tz }], hours: Math.sqrt((tx - sx) * (tx - sx) + (tz - sz) * (tz - sz)) / metersPerHourFromKmDay(M.marchKmPerDay.offroad), edges: [], ok: false };
  }
  // Rebuild: GOAL <- ... <- START.
  const chain: number[] = [];
  for (let v = GOAL; v !== -1; v = prev[v] as number) chain.push(v);
  chain.reverse();
  const points: Vec2[] = [{ x: sx, z: sz }];
  const edges: string[] = [];
  for (let k = 1; k < chain.length; k++) {
    const v = chain[k] as number;
    const eid = viaEdge[v];
    if (eid) {
      const e = world.roads.edges[eid]!;
      edges.push(eid);
      const f = viaFrom[v] as number;
      const t = viaTo[v] as number;
      const step = t >= f ? 1 : -1;
      for (let i = f; ; i += step) {
        const p = e.points[i] as Vec2;
        points.push({ x: p.x, z: p.z });
        if (i === t) break;
      }
    }
    if (v === GOAL) points.push({ x: tx, z: tz });
    else if (!eid) points.push({ x: px[v] as number, z: pz[v] as number });
  }
  return { points: dedupe(points), hours: dist[GOAL] as number, edges, ok: true };
}

function dedupe(points: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    const q = out[out.length - 1];
    if (q && Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.z - p.z) < 1e-6) continue;
    out.push(p);
  }
  return out;
}

/** Days for an army to march a planned route at its current pace, speed modifiers and fatigue. */
export function routeDays(world: WorldState, army: ArmyState, plan: RoutePlan): number {
  return plan.hours / 24 / armySpeedMultiplier(world, army, false);
}

/** Army-wide multiplier on base road/off-road speed: pace x faction marchSpeed x fatigue x forced march. */
export function armySpeedMultiplier(world: WorldState, army: ArmyState, offRoadRough: boolean): number {
  return armyPace(army, offRoadRough) * factionMod(world, army.factionId, 'marchSpeed') * (1 - 0.3 * army.fatigue) * (army.forcedMarch ? RULES.armies.forcedMarch.speed : 1);
}

// ---------------------------------------------------------------------------------------------------
// Segment kinds of a stored path
// ---------------------------------------------------------------------------------------------------

/** Per segment i (path[i-1] -> path[i]): road edge index into sortedKeys(edges), or -1 off-road. */
const segCache = new WeakMap<Vec2[], Int16Array>();
const pointIndexCache = new WeakMap<WorldState['roads'], { edgeIds: string[]; map: Map<string, number[]> }>();

function pointIndex(world: WorldState): { edgeIds: string[]; map: Map<string, number[]> } {
  let c = pointIndexCache.get(world.roads);
  if (c) return c;
  const edgeIds = sortedKeys(world.roads.edges);
  const map = new Map<string, number[]>();
  edgeIds.forEach((id, ei) => {
    const e = world.roads.edges[id] as RoadEdge;
    e.points.forEach((p, pi) => {
      const k = `${p.x},${p.z}`;
      let l = map.get(k);
      if (!l) map.set(k, (l = []));
      l.push(ei * 65536 + pi);
    });
  });
  c = { edgeIds, map };
  pointIndexCache.set(world.roads, c);
  return c;
}

/** Segment kinds of a path (cached per array). */
export function segmentInfo(world: WorldState, path: Vec2[]): Int16Array {
  let s = segCache.get(path);
  if (s) return s;
  const idx = pointIndex(world);
  s = new Int16Array(path.length).fill(-1);
  for (let i = 1; i < path.length; i++) {
    const a = idx.map.get(`${(path[i - 1] as Vec2).x},${(path[i - 1] as Vec2).z}`);
    const b = idx.map.get(`${(path[i] as Vec2).x},${(path[i] as Vec2).z}`);
    if (!a || !b) continue;
    let found = -1;
    for (const ka of a) {
      for (const kb of b) {
        if (Math.floor(ka / 65536) === Math.floor(kb / 65536) && Math.abs((ka % 65536) - (kb % 65536)) === 1) found = Math.floor(ka / 65536);
      }
    }
    s[i] = found;
  }
  segCache.set(path, s);
  return s;
}

/** Road edge of segment i of the path (null = off-road). */
export function segmentEdge(world: WorldState, path: Vec2[], i: number): RoadEdge | null {
  if (i <= 0 || i >= path.length) return null;
  const k = segmentInfo(world, path)[i] as number;
  if (k < 0) return null;
  const id = pointIndex(world).edgeIds[k];
  return id ? (world.roads.edges[id] ?? null) : null;
}
