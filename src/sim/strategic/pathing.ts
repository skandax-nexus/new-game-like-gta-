/**
 * Strategic route planning and march speed (DESIGN_SPEC §7.7, §3.4). OWNER: Simulation Engineer - Strategic World
 * Simulation (SIM-01).
 *
 * Route = optional off-road leg to a road node -> shortest road path (Dijkstra over world.roads; 16 nodes) -> optional
 * off-road leg to the target, or a direct off-road leg - whichever takes fewer hours.
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

/** Hours for an off-road leg (Infinity when it would cross deep water away from a usable crossing). */
export function offRoadHours(world: WorldState, army: Pick<ArmyState, 'factionId' | 'units'>, terrain: TerrainQuery, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 1e-6) return 0;
  const n = Math.max(1, Math.ceil(d / OFFROAD_SAMPLE));
  const seg = d / n;
  const base = metersPerHourFromKmDay(M.marchKmPerDay.offroad) * weatherFactor(world, null);
  let hours = 0;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = ax + dx * t;
    const z = az + dz * t;
    const tc = terrain.inBounds(x, z) ? terrain.terrainClassAt(x, z) : 'deep_water';
    let f = terrainFactor(world, army.factionId, tc);
    if (f === 0) {
      if (!terrain.inBounds(x, z) || !nearUsableCrossing(world, army, terrain, x, z)) return Infinity;
      f = 0.4;
    }
    hours += seg / (base * f);
  }
  return hours;
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

function nodePos(world: WorldState, id: string): Vec2 {
  const n = world.roads.nodes[id]!;
  return { x: n.x, z: n.z };
}

/**
 * Plan a route for `army` from (sx, sz) to (tx, tz). Dijkstra over road nodes with off-road legs from the start to
 * every node and from every node to the target; the direct off-road leg competes. With `roads: false` the graph's
 * nodes are still waypoints but only off-road legs connect them (cross-country estimate).
 */
export function planRoute(world: WorldState, army: Pick<ArmyState, 'factionId' | 'units'>, sx: number, sz: number, tx: number, tz: number, terrain: TerrainQuery, opts: RouteOptions = {}): RoutePlan {
  const useRoads = opts.roads !== false;
  const nodeIds = sortedKeys(world.roads.nodes);
  const N = nodeIds.length;
  const index = new Map<string, number>();
  nodeIds.forEach((id, i) => index.set(id, i));
  const START = N;
  const GOAL = N + 1;
  const dist = new Float64Array(N + 2).fill(Infinity);
  const prev = new Int32Array(N + 2).fill(-1);
  const prevEdge: (string | null)[] = new Array(N + 2).fill(null);
  const done = new Uint8Array(N + 2);
  dist[START] = 0;
  const legToNode = new Float64Array(N);
  const legFromNode = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const p = nodePos(world, nodeIds[i] as string);
    legToNode[i] = offRoadHours(world, army, terrain, sx, sz, p.x, p.z);
    legFromNode[i] = offRoadHours(world, army, terrain, p.x, p.z, tx, tz);
  }
  const direct = offRoadHours(world, army, terrain, sx, sz, tx, tz);
  for (;;) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < N + 2; i++) {
      if (!done[i] && (dist[i] as number) < best) {
        best = dist[i] as number;
        u = i;
      }
    }
    if (u < 0 || u === GOAL) break;
    done[u] = 1;
    const relax = (v: number, cost: number, edge: string | null): void => {
      if (cost === Infinity) return;
      const nd = (dist[u] as number) + cost;
      if (nd < (dist[v] as number)) {
        dist[v] = nd;
        prev[v] = u;
        prevEdge[v] = edge;
      }
    };
    if (u === START) {
      for (let i = 0; i < N; i++) relax(i, legToNode[i] as number, null);
      relax(GOAL, direct, null);
      continue;
    }
    relax(GOAL, legFromNode[u] as number, null);
    const nid = nodeIds[u] as string;
    if (useRoads) {
      for (const eid of world.roads.adjacency[nid] ?? []) {
        const e = world.roads.edges[eid];
        if (!e) continue;
        const other = e.a === nid ? e.b : e.a;
        const v = index.get(other);
        if (v === undefined) continue;
        relax(v, edgeHours(world, army, e), eid);
      }
    } else {
      const p = nodePos(world, nid);
      for (let v = 0; v < N; v++) {
        if (v === u) continue;
        const q = nodePos(world, nodeIds[v] as string);
        relax(v, offRoadHours(world, army, terrain, p.x, p.z, q.x, q.z), null);
      }
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
    const eid = prevEdge[v];
    if (v === GOAL) {
      points.push({ x: tx, z: tz });
      continue;
    }
    const nid = nodeIds[v] as string;
    if (eid) {
      const e = world.roads.edges[eid]!;
      edges.push(eid);
      const pts = e.b === nid ? e.points : e.points.slice().reverse();
      for (let i = 1; i < pts.length; i++) points.push({ x: (pts[i] as Vec2).x, z: (pts[i] as Vec2).z });
    } else {
      points.push(nodePos(world, nid));
    }
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
