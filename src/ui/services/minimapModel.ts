/**
 * Minimap model (DESIGN_SPEC §8.7): projection between world metres and the minimap canvas (north-up or rotating with
 * the camera so the view direction points up) and the layer lists the Minimap component draws - settlements by kind /
 * owner / capital star, armies with direction ticks and ghosts, engagements, depots, province borders (contested
 * flagged), roads by quality; battle formations, deploy zones and objectives. Pure (no DOM, no canvas).
 * OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 *
 * Conventions (CLAUDE.md): +X east, +Z south, facing theta: forward = (sin theta, cos theta). North-up: +X right,
 * +Z down. Rotating: the camera heading (facing convention; PI = looking north = north-up) points up.
 */
import type { BattleState, FactionId, FormationIndex, Rect, RoadQuality, SettlementKind, SideIndex, WorldState } from '../../core/types';
import { relationKey } from '../../core/ids';

export type Relation = 'own' | 'ally' | 'enemy' | 'neutral';

export interface MapProjection {
  size: number;
  bounds: Rect;
  /** Rotation applied about the map centre (radians, screen space). */
  rotation: number;
  /** World metres per minimap pixel (before rotation). */
  scale: number;
}

/**
 * Projection of a square map of `size` px over `bounds`. northUp=false rotates so the camera heading (facing
 * convention, PI = looking north) points up.
 */
export function makeProjection(bounds: Rect, size: number, northUp: boolean, cameraHeading: number): MapProjection {
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
  return { size, bounds, rotation: northUp ? 0 : cameraHeading - Math.PI, scale: span / size };
}

/** World (x, z) -> minimap pixel (u, v). */
export function worldToMap(p: MapProjection, x: number, z: number, out: [number, number] = [0, 0]): [number, number] {
  const cx = (p.bounds.minX + p.bounds.maxX) / 2;
  const cz = (p.bounds.minZ + p.bounds.maxZ) / 2;
  const u0 = (x - cx) / p.scale;
  const v0 = (z - cz) / p.scale;
  const c = Math.cos(p.rotation);
  const s = Math.sin(p.rotation);
  out[0] = p.size / 2 + u0 * c - v0 * s;
  out[1] = p.size / 2 + u0 * s + v0 * c;
  return out;
}

/** Minimap pixel (u, v) -> world (x, z) (click / tap jump, right-click move). */
export function mapToWorld(p: MapProjection, u: number, v: number, out: [number, number] = [0, 0]): [number, number] {
  const du = u - p.size / 2;
  const dv = v - p.size / 2;
  const c = Math.cos(-p.rotation);
  const s = Math.sin(-p.rotation);
  const u0 = du * c - dv * s;
  const v0 = du * s + dv * c;
  out[0] = (p.bounds.minX + p.bounds.maxX) / 2 + u0 * p.scale;
  out[1] = (p.bounds.minZ + p.bounds.maxZ) / 2 + v0 * p.scale;
  return out;
}

/** Map-space direction of a world facing (for direction ticks): unit vector (du, dv). */
export function facingToMap(p: MapProjection, facing: number): [number, number] {
  const fx = Math.sin(facing);
  const fz = Math.cos(facing);
  const c = Math.cos(p.rotation);
  const s = Math.sin(p.rotation);
  return [fx * c - fz * s, fx * s + fz * c];
}

/** Settlement square size (px at 220 px map) by kind; capitals add a star. */
export const SETTLEMENT_MARK: Readonly<Record<SettlementKind, number>> = {
  village: 5,
  temple_town: 6,
  port: 7,
  town: 7,
  fort: 7,
  city: 9,
  capital: 10,
};

export function relationOf(world: Readonly<WorldState>, viewer: FactionId, other: FactionId | null): Relation {
  if (!other) return 'neutral';
  if (other === viewer) return 'own';
  const rel = world.diplomacy.relations[relationKey(viewer, other)];
  if (!rel) return other === 'rebels' ? 'enemy' : 'neutral';
  if (rel.atWar) return 'enemy';
  for (const tid of rel.treatyIds) {
    const t = world.diplomacy.treaties[tid];
    if (t && !t.brokenBy && (t.type === 'mutual_defense' || t.type === 'military_access' || t.type === 'marriage_alliance' || t.type === 'tributary')) return 'ally';
  }
  return 'neutral';
}

export interface MapSettlement {
  id: string;
  name: string;
  x: number;
  z: number;
  kind: SettlementKind;
  owner: FactionId | null;
  relation: Relation;
  size: number;
  capital: boolean;
  besieged: boolean;
  selected: boolean;
}

export interface MapArmy {
  id: string;
  x: number;
  z: number;
  facing: number;
  owner: FactionId;
  relation: Relation;
  /** Last-known position of an enemy army out of sight. */
  ghost: boolean;
  moving: boolean;
  selected: boolean;
}

export interface MapBorder {
  provinceId: string;
  points: readonly (readonly [number, number])[];
  owner: FactionId | null;
  relation: Relation;
  /** Mixed owners, a siege or a pending capture inside: hatched. */
  contested: boolean;
}

export interface MapRoad {
  points: readonly (readonly [number, number])[];
  quality: RoadQuality;
  damaged: boolean;
}

export interface WorldMapLayers {
  bounds: Rect;
  settlements: MapSettlement[];
  armies: MapArmy[];
  engagements: { id: string; x: number; z: number }[];
  depots: { id: string; x: number; z: number; owner: FactionId; relation: Relation }[];
  borders: MapBorder[];
  roads: MapRoad[];
}

export interface Selection {
  kind: 'army' | 'settlement' | 'province' | 'none';
  id: string | null;
}

/** Everything the world minimap draws, from the player's point of view (fog: unseen enemy armies hidden). */
export function worldLayers(world: Readonly<WorldState>, selection: Selection): WorldMapLayers {
  const w = world as WorldState;
  const me = w.playerFactionId;
  const settlements: MapSettlement[] = [];
  const capitals = new Set<string>();
  for (const fid of Object.keys(w.factions)) {
    const c = w.factions[fid]!.capitalSettlementId;
    if (c) capitals.add(c);
  }
  for (const id of Object.keys(w.settlements).sort()) {
    const s = w.settlements[id]!;
    settlements.push({
      id,
      name: s.name,
      x: s.x,
      z: s.z,
      kind: s.kind,
      owner: s.ownerFactionId,
      relation: relationOf(w, me, s.ownerFactionId),
      size: SETTLEMENT_MARK[s.kind],
      capital: capitals.has(id) || s.kind === 'capital',
      besieged: !!s.besiegedBy,
      selected: selection.kind === 'settlement' && selection.id === id,
    });
  }
  const armies: MapArmy[] = [];
  for (const id of Object.keys(w.armies).sort()) {
    const a = w.armies[id]!;
    if (a.status === 'disbanded' || a.status === 'garrisoned') continue;
    const own = a.factionId === me;
    if (!own && (a.visibility[me] ?? 0) < 0.5) continue;
    armies.push({ id, x: a.x, z: a.z, facing: a.facing, owner: a.factionId, relation: relationOf(w, me, a.factionId), ghost: false, moving: a.status === 'marching', selected: selection.kind === 'army' && selection.id === id });
  }
  const ghosts = w.factions[me]?.ghosts ?? {};
  for (const gid of Object.keys(ghosts).sort()) {
    const g = ghosts[gid]!;
    if (armies.some((a) => a.id === g.armyId)) continue;
    armies.push({ id: `ghost:${g.armyId}`, x: g.x, z: g.z, facing: g.facing, owner: g.factionId, relation: relationOf(w, me, g.factionId), ghost: true, moving: false, selected: false });
  }
  const engagements = Object.keys(w.engagements)
    .sort()
    .map((id) => w.engagements[id]!)
    .filter((e) => e.status !== 'resolved')
    .map((e) => ({ id: e.id, x: e.x, z: e.z }));
  const depots = Object.keys(w.depots)
    .sort()
    .map((id) => w.depots[id]!)
    .filter((d) => d.factionId === me || relationOf(w, me, d.factionId) === 'ally')
    .map((d) => ({ id: d.id, x: d.x, z: d.z, owner: d.factionId, relation: relationOf(w, me, d.factionId) }));
  const borders: MapBorder[] = [];
  for (const pid of Object.keys(w.provinces).sort()) {
    const p = w.provinces[pid]!;
    if (p.boundary.length < 3) continue;
    const owners = new Set(p.settlementIds.map((sid) => w.settlements[sid]?.ownerFactionId ?? null));
    const contested = owners.size > 1 || p.settlementIds.some((sid) => !!w.settlements[sid]?.besiegedBy || !!w.settlements[sid]?.pendingCapture);
    borders.push({ provinceId: pid, points: p.boundary.map((v) => [v.x, v.z] as const), owner: p.ownerFactionId, relation: relationOf(w, me, p.ownerFactionId), contested });
  }
  const roads: MapRoad[] = [];
  for (const eid of Object.keys(w.roads.edges).sort()) {
    const e = w.roads.edges[eid]!;
    roads.push({ points: e.points.map((v) => [v.x, v.z] as const), quality: e.quality, damaged: e.condition < 0.5 });
  }
  return { bounds: w.region.bounds, settlements, armies, engagements, depots, borders, roads };
}

// ---------------------------------------------------------------------------------------------------
// Battle minimap
// ---------------------------------------------------------------------------------------------------

export interface MapFormation {
  index: FormationIndex;
  x: number;
  z: number;
  facing: number;
  width: number;
  depth: number;
  side: SideIndex;
  relation: Relation;
  selected: boolean;
  routing: boolean;
}

export interface BattleMapLayers {
  bounds: Rect;
  formations: MapFormation[];
  zones: { rect: Rect; own: boolean }[];
  objectives: { x: number; z: number; radius: number; label: string }[];
  fort: { x: number; z: number; radius: number } | null;
}

export function battleBounds(battle: Readonly<BattleState>): Rect {
  const t = battle.setup.terrain;
  const half = t.sizeMeters / 2;
  return { minX: t.centerX - half, minZ: t.centerZ - half, maxX: t.centerX + half, maxZ: t.centerZ + half };
}

export function battleLayers(battle: Readonly<BattleState>, playerSide: SideIndex, selection: readonly FormationIndex[]): BattleMapLayers {
  const sel = new Set(selection);
  const formations: MapFormation[] = [];
  for (const f of battle.formations) {
    if (f.soldiers <= 0 || f.activity === 'destroyed' || f.activity === 'surrendered') continue;
    if (f.side !== playerSide && (!f.spotted || f.hidden)) continue;
    formations.push({ index: f.index, x: f.x, z: f.z, facing: f.facing, width: f.width, depth: f.depth, side: f.side, relation: f.side === playerSide ? 'own' : 'enemy', selected: sel.has(f.index), routing: f.activity === 'routing' });
  }
  const zones = battle.phase === 'deployment' ? battle.setup.sides.map((s, i) => ({ rect: s.deployZone, own: i === playerSide })) : [];
  const objectives: BattleMapLayers['objectives'] = [];
  for (const o of battle.setup.objectives) if (o.kind === 'hold_area') objectives.push({ x: o.x, z: o.z, radius: o.radius, label: o.label });
  const fo = battle.setup.fortification;
  return { bounds: battleBounds(battle), formations, zones, objectives, fort: fo ? { x: fo.center.x, z: fo.center.z, radius: fo.radius } : null };
}
