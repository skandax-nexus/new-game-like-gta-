/**
 * Road network queries shared by the economy (internal grain market, relief, trade road share), supply lines and
 * pathing (DESIGN_SPEC §3.4, §7.3.5, §7.5, §7.8). OWNER: Simulation Engineer - Strategic World Simulation (SIM-01).
 *
 *  - Edge usability for trade: condition >= 0.5 and not blocked by an army hostile to the faction.
 *  - `updateRoadBlocks`: daily, a stationary army (camped / besieging / foraging) within RoadBlockRadius of a road's
 *    polyline blocks it (RoadEdge.blockedBy = first such army by id).
 *  - Realm components: owned settlements linked by usable roads whose both ends the faction owns.
 * Pure, deterministic, three-free.
 */
import type { ArmyState, FactionId, RoadEdge, SettlementId, SettlementState, Vec2, WorldState } from '../../core/types';
import { sortedKeys } from '../../core/ids';
import { distToSegment } from '../../core/math';
import { hostileToArmy } from './state';

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

/** Is the edge blocked for `factionId` (an army hostile to it holds the road)? */
export function blockedFor(world: WorldState, edge: RoadEdge, factionId: FactionId): boolean {
  if (!edge.blockedBy) return false;
  const a = world.armies[edge.blockedBy];
  return !!a && hostileToArmy(world, factionId, a);
}

export function usableForTrade(world: WorldState, edge: RoadEdge, factionId: FactionId): boolean {
  return edge.condition >= TRADE_ROAD_MIN_CONDITION && !blockedFor(world, edge, factionId);
}

function stationary(a: ArmyState): boolean {
  return a.status === 'camped' || a.status === 'besieging' || a.supply.foraging;
}

/** Daily: recompute RoadEdge.blockedBy from stationary armies near each polyline. */
export function updateRoadBlocks(world: WorldState): void {
  const armyIds = sortedKeys(world.armies);
  for (const eid of sortedKeys(world.roads.edges)) {
    const e = world.roads.edges[eid] as RoadEdge;
    let blocker: string | null = null;
    for (const aid of armyIds) {
      const a = world.armies[aid] as ArmyState;
      if (!stationary(a) || a.units.length === 0) continue;
      if (distanceToEdge(e, a.x, a.z) <= ROAD_BLOCK_RADIUS) {
        blocker = a.id;
        break;
      }
    }
    e.blockedBy = blocker;
  }
}

/**
 * Connected components of a faction's owned settlements over usable roads (both ends owned). Returns a map
 * settlementId -> component index (stable: components numbered in sorted settlement order).
 */
export function realmComponents(world: WorldState, factionId: FactionId): Map<SettlementId, number> {
  const ids: SettlementId[] = [];
  for (const id of sortedKeys(world.settlements)) if ((world.settlements[id] as SettlementState).ownerFactionId === factionId) ids.push(id);
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
  for (const eid of sortedKeys(world.roads.edges)) {
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
  for (const id of sortedKeys(world.settlements)) {
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
