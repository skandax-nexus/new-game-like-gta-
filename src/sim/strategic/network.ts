/**
 * Road network queries shared by the economy (internal grain market, relief, trade road share), supply lines and
 * pathing (DESIGN_SPEC §3.4, §7.3.5, §7.5, §7.8). OWNER: Simulation Engineer - Strategic World Simulation (SIM-01).
 *
 *  - Road blocks (§7.7, SIM-01 review S3): an edge is **blocked for faction F** while a stationary army (camped -
 *    foraging armies are camped - or besieging) hostile to F stands within ROAD_BLOCK_RADIUS (120 m) of its polyline and no
 *    stationary army of F stands on the same edge - an escort keeps its road open. `blockedFor` / `edgeBlocker` evaluate
 *    the rule from the armies themselves, so the answer does not depend on army id order; it cuts grain distribution
 *    (realm components), relief, the trade road share, pathing and repair_road (supply lines: supply.threatenedEdges).
 *  - `updateRoadBlocks`: daily display field RoadEdge.blockedBy = the first army by id that blocks the edge for some
 *    living realm (the map's "road held" marker); the rules never read it.
 *  - Edge usability for trade: condition >= 0.5 and not blocked for the faction.
 *  - Realm components: owned settlements linked by usable roads whose both ends the faction owns.
 * Pure, deterministic, three-free.
 */
import type { ArmyId, ArmyState, FactionId, RoadEdge, SettlementId, SettlementState, Vec2, WorldState } from '../../core/types';
import { sortedKeys } from '../../core/ids';
import { distToSegment } from '../../core/math';
import { hostileToArmy, stableKeys } from './state';

/** Map meters from a road polyline within which a stationary army blocks it. */
export const ROAD_BLOCK_RADIUS = 120;
/** Trade / grain distribution needs roads at least this good. */
export const TRADE_ROAD_MIN_CONDITION = 0.5;

/** Distance (map m) from a point to an edge polyline. */
export function distanceToEdge(edge: RoadEdge, x: number, z: number): number {
  const pts = edge.points;
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Vec2;
    const b = pts[i] as Vec2;
    const d = distToSegment(x, z, a.x, a.z, b.x, b.z);
    if (d < best) best = d;
  }
  return best;
}

/** Settlement id at either end of an edge (null when the node is not a settlement). */
export function edgeEnds(world: WorldState, edge: RoadEdge): [SettlementId | null, SettlementId | null] {
  return [world.roads.nodes[edge.a]?.settlementId ?? null, world.roads.nodes[edge.b]?.settlementId ?? null];
}

/** Polyline bounding box of an edge (cached per points array). */
const boundsCache = new WeakMap<Vec2[], { minX: number; maxX: number; minZ: number; maxZ: number }>();
export function edgeBounds(edge: RoadEdge): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let b = boundsCache.get(edge.points);
  if (b) return b;
  b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const p of edge.points) {
    if (p.x < b.minX) b.minX = p.x;
    if (p.x > b.maxX) b.maxX = p.x;
    if (p.z < b.minZ) b.minZ = p.z;
    if (p.z > b.maxZ) b.maxZ = p.z;
  }
  boundsCache.set(edge.points, b);
  return b;
}

/** Is (x, z) within `r` map m of the edge's polyline? (bounding-box early out) */
export function nearEdge(edge: RoadEdge, x: number, z: number, r: number): boolean {
  const b = edgeBounds(edge);
  if (x < b.minX - r || x > b.maxX + r || z < b.minZ - r || z > b.maxZ + r) return false;
  return distanceToEdge(edge, x, z) <= r;
}

/** Map meters cell of the lazily filled "near a road" grid (army attrition: on a road or off it). */
const ROAD_CELL = 30;
const nearRoadCache = new WeakMap<WorldState['roads'], Map<number, boolean>>();

/** Is (x, z) within `r` (60) map m of any road? Cached per 30 m cell (cell centre test) for the daily systems. */
export function nearAnyRoad(world: WorldState, x: number, z: number, r: number): boolean {
  let m = nearRoadCache.get(world.roads);
  if (!m) {
    m = new Map();
    nearRoadCache.set(world.roads, m);
  }
  const i = Math.floor(x / ROAD_CELL);
  const j = Math.floor(z / ROAD_CELL);
  const key = (i + 100000) * 200003 + (j + 100000) + r * 1e12;
  const hit = m.get(key);
  if (hit !== undefined) return hit;
  const cx = (i + 0.5) * ROAD_CELL;
  const cz = (j + 0.5) * ROAD_CELL;
  let near = false;
  for (const id of stableKeys('edges', world.roads.edges as Record<string, unknown>)) {
    if (nearEdge(world.roads.edges[id] as RoadEdge, cx, cz, r)) {
      near = true;
      break;
    }
  }
  m.set(key, near);
  return near;
}

/**
 * A stationary army holds the roads near it (§7.7): camped (which includes an army foraging or raiding in place) or
 * besieging. Armies on the march, in battle or garrisoned inside their walls hold no road.
 */
export function holdsRoad(a: ArmyState): boolean {
  return a.units.length > 0 && (a.status === 'camped' || a.status === 'besieging');
}

/**
 * The army that blocks `edge` for `factionId` (§7.7): the first by id of the stationary armies hostile to the faction
 * within ROAD_BLOCK_RADIUS of the polyline - null when there is none, or when a stationary army of the faction stands on
 * the same edge (an escort keeps its road open). Every army near the edge is considered, so no army hides another.
 */
export function edgeBlocker(world: WorldState, edge: RoadEdge, factionId: FactionId): ArmyId | null {
  let blocker: ArmyId | null = null;
  const ids = stableKeys('armies', world.armies as Record<string, unknown>);
  for (let i = 0; i < ids.length; i++) {
    const a = world.armies[ids[i] as string];
    if (!a || !holdsRoad(a) || !nearEdge(edge, a.x, a.z, ROAD_BLOCK_RADIUS)) continue;
    if (a.factionId === factionId) return null;
    if (blocker === null && hostileToArmy(world, factionId, a)) blocker = a.id;
  }
  return blocker;
}

/** Is the edge blocked for `factionId` (a hostile stationary army holds it and no escort of the faction does)? */
export function blockedFor(world: WorldState, edge: RoadEdge, factionId: FactionId): boolean {
  return edgeBlocker(world, edge, factionId) !== null;
}

export function usableForTrade(world: WorldState, edge: RoadEdge, factionId: FactionId): boolean {
  return edge.condition >= TRADE_ROAD_MIN_CONDITION && !blockedFor(world, edge, factionId);
}

/**
 * Daily: the display field RoadEdge.blockedBy = the first army (by id) that blocks the edge for some living realm, or
 * null. Rules use blockedFor / edgeBlocker (per faction), never this field.
 */
export function updateRoadBlocks(world: WorldState): void {
  const armyIds = stableKeys('armies', world.armies as Record<string, unknown>);
  const factionIds = stableKeys('factions', world.factions as Record<string, unknown>);
  for (const eid of stableKeys('edges', world.roads.edges as Record<string, unknown>)) {
    const e = world.roads.edges[eid] as RoadEdge;
    let shown: ArmyId | null = null;
    for (let i = 0; i < armyIds.length && shown === null; i++) {
      const a = world.armies[armyIds[i] as string];
      if (!a || !holdsRoad(a) || !nearEdge(e, a.x, a.z, ROAD_BLOCK_RADIUS)) continue;
      for (let j = 0; j < factionIds.length; j++) {
        const fid = factionIds[j] as string;
        if (!world.factions[fid]?.alive || !hostileToArmy(world, fid, a)) continue;
        if (edgeBlocker(world, e, fid) !== null) {
          shown = a.id;
          break;
        }
      }
    }
    e.blockedBy = shown;
  }
}

/**
 * Connected components of a faction's owned settlements over usable roads (both ends owned). Returns a map
 * settlementId -> component index (stable: components numbered in sorted settlement order).
 */
export function realmComponents(world: WorldState, factionId: FactionId): Map<SettlementId, number> {
  const ids: SettlementId[] = [];
  for (const id of stableKeys('settlements', world.settlements as Record<string, unknown>)) if ((world.settlements[id] as SettlementState).ownerFactionId === factionId) ids.push(id);
  const parent = new Map<SettlementId, SettlementId>();
  for (const id of ids) parent.set(id, id);
  const find = (x: SettlementId): SettlementId => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r) as SettlementId;
    let c = x;
    while (parent.get(c) !== r) {
      const n = parent.get(c) as SettlementId;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  for (const eid of stableKeys('edges', world.roads.edges as Record<string, unknown>)) {
    const e = world.roads.edges[eid] as RoadEdge;
    const [sa, sb] = edgeEnds(world, e);
    if (!sa || !sb || !parent.has(sa) || !parent.has(sb)) continue;
    if (!usableForTrade(world, e, factionId)) continue;
    const ra = find(sa);
    const rb = find(sb);
    if (ra !== rb) {
      if (ra < rb) parent.set(rb, ra);
      else parent.set(ra, rb);
    }
  }
  const out = new Map<SettlementId, number>();
  const rootIndex = new Map<SettlementId, number>();
  for (const id of ids) {
    const r = find(id);
    let idx = rootIndex.get(r);
    if (idx === undefined) {
      idx = rootIndex.size;
      rootIndex.set(r, idx);
    }
    out.set(id, idx);
  }
  return out;
}

/** Share of a settlement's adjacent roads usable for trade by its owner (0..1; 1 when it has no roads). */
export function connectedRoadShare(world: WorldState, s: SettlementState): number {
  const node = world.roads.adjacency[`node_${s.id}`];
  if (!node || node.length === 0 || !s.ownerFactionId) return 1;
  let ok = 0;
  for (const eid of node) {
    const e = world.roads.edges[eid];
    if (e && usableForTrade(world, e, s.ownerFactionId)) ok++;
  }
  return ok / node.length;
}

/** Nearest settlement (by straight distance) satisfying `pred`. */
export function nearestSettlement(world: WorldState, x: number, z: number, pred: (s: SettlementState) => boolean): SettlementState | null {
  let best: SettlementState | null = null;
  let bestD = Infinity;
  for (const id of stableKeys('settlements', world.settlements as Record<string, unknown>)) {
    const s = world.settlements[id] as SettlementState;
    if (!pred(s)) continue;
    const d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/** Province containing (x, z): the nearest settlement's province (Voronoi, matching the borders the map draws). */
export function provinceAtPoint(world: WorldState, x: number, z: number): string | null {
  const s = nearestSettlement(world, x, z, () => true);
  return s ? s.provinceId : null;
}

/** Nearest road node id to a point (and its distance in map m). */
export function nearestNode(world: WorldState, x: number, z: number): { id: string | null; dist: number } {
  let best: string | null = null;
  let bd = Infinity;
  for (const id of sortedKeys(world.roads.nodes)) {
    const n = world.roads.nodes[id]!;
    const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
    if (d < bd) {
      bd = d;
      best = id;
    }
  }
  return { id: best, dist: Math.sqrt(bd) };
}
