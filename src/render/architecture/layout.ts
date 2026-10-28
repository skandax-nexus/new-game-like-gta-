/**
 * Procedural settlement layout (pure data, deterministic, three-free) shared by the world scene,
 * hero scene (collision footprints) and battle scenes (sieges). OWNER: Lead Graphics Engineer
 * (with Art Director for composition). Baseline by the CTO.
 *
 * TODO(owner): street network (main road through gates, lanes), plazas + market square, district
 * zoning (palace quarter, artisans, outskirts huts), river-facing ghats aligned to the bank,
 * fields/orchards ring, wall shape following terrain, size from population + buildings.
 */
import type { ArchitectureKind, BuildingType, FactionDef, SettlementKind, TerrainQuery } from '../../core/types';
import { Rng } from '../../core/rng';
import { BUILDINGS } from '../../data/buildings';

export type ArchitectureStyle = FactionDef['architectureStyle'];

export interface ArchitecturePlacement {
  kind: ArchitectureKind;
  x: number;
  z: number;
  /** Facing angle (types.ts convention). */
  rot: number;
  scale: number;
  /** 0..255 cosmetic variant. */
  variant: number;
  /** Footprint half extents (m) for collision / spacing. */
  hx: number;
  hz: number;
}

export interface SettlementLayoutInput {
  id: string;
  kind: SettlementKind;
  x: number;
  z: number;
  radius: number;
  population: number;
  seed: number;
  buildings: readonly { type: BuildingType; level: number }[];
  fortLevel: number;
  style: ArchitectureStyle;
}

export interface SettlementLayout {
  id: string;
  style: ArchitectureStyle;
  centerX: number;
  centerZ: number;
  radius: number;
  pieces: ArchitecturePlacement[];
}

/** Approximate footprint half-extents per kind (m), used for spacing + collisions. */
export const FOOTPRINT: Readonly<Record<ArchitectureKind, [number, number]>> = {
  mud_house: [3, 2.5],
  thatch_hut: [2.6, 2.6],
  brick_house: [3.4, 3],
  mansion: [6, 5.5],
  granary: [5, 3.5],
  stupa: [11, 11],
  shikhara_temple: [8, 9],
  shrine: [3, 3],
  palace: [22, 17],
  chhatri: [2.6, 2.6],
  pavilion: [5, 5],
  fort_wall: [7, 2],
  fort_gate: [9, 5],
  tower: [4, 4],
  ghat: [11, 6],
  stepwell: [7, 7],
  well: [1.6, 1.6],
  market_stall: [2, 2],
  barracks: [9.5, 4],
  stable: [8.5, 3.5],
  workshop: [4, 3.5],
  pillar: [1, 1],
  harbor_jetty: [2.5, 10],
  bridge: [3.5, 15],
  palisade: [5, 0.6],
  field_plot: [15, 10],
};

class Occupancy {
  private cells = new Set<number>();
  constructor(private readonly cell = 4) {}
  private key(ix: number, iz: number): number {
    return (ix + 4096) * 8192 + (iz + 4096);
  }
  fits(x: number, z: number, hx: number, hz: number): boolean {
    const r = Math.max(hx, hz) + 1;
    for (let iz = Math.floor((z - r) / this.cell); iz <= Math.floor((z + r) / this.cell); iz++)
      for (let ix = Math.floor((x - r) / this.cell); ix <= Math.floor((x + r) / this.cell); ix++) if (this.cells.has(this.key(ix, iz))) return false;
    return true;
  }
  mark(x: number, z: number, hx: number, hz: number): void {
    const r = Math.max(hx, hz);
    for (let iz = Math.floor((z - r) / this.cell); iz <= Math.floor((z + r) / this.cell); iz++)
      for (let ix = Math.floor((x - r) / this.cell); ix <= Math.floor((x + r) / this.cell); ix++) this.cells.add(this.key(ix, iz));
  }
}

const CENTER_PIECE: Partial<Record<SettlementKind, ArchitectureKind>> = {
  capital: 'palace',
  city: 'mansion',
  temple_town: 'shikhara_temple',
  fort: 'tower',
  port: 'market_stall',
  town: 'shrine',
  village: 'well',
};

export function generateSettlementLayout(input: SettlementLayoutInput, terrain: TerrainQuery): SettlementLayout {
  const rng = new Rng(input.seed);
  const pieces: ArchitecturePlacement[] = [];
  const occ = new Occupancy(4);
  const R = input.radius;
  const tryPlace = (kind: ArchitectureKind, x: number, z: number, rot: number, scale = 1): boolean => {
    const [hx, hz] = FOOTPRINT[kind];
    const sx = hx * scale;
    const sz = hz * scale;
    if (!occ.fits(x, z, sx, sz)) return false;
    if (terrain.isWater(x, z) || terrain.slopeAt(x, z) > 0.45) return false;
    occ.mark(x, z, sx, sz);
    pieces.push({ kind, x, z, rot, scale, variant: rng.int(0, 255), hx: sx, hz: sz });
    return true;
  };
  const placeNear = (kind: ArchitectureKind, minR: number, maxR: number, tries = 40, scale = 1): boolean => {
    for (let t = 0; t < tries; t++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(minR, maxR);
      const x = input.x + Math.sin(a) * r;
      const z = input.z + Math.cos(a) * r;
      const rot = Math.atan2(input.x - x, input.z - z);
      if (tryPlace(kind, x, z, rot, scale)) return true;
    }
    return false;
  };

  // Center piece.
  const center = CENTER_PIECE[input.kind] ?? 'well';
  tryPlace(center, input.x, input.z, rng.range(-0.3, 0.3));
  if (input.kind === 'capital') {
    for (const [dx, dz] of [
      [-26, -21],
      [26, -21],
      [-26, 21],
      [26, 21],
    ] as const)
      tryPlace('chhatri', input.x + dx, input.z + dz, 0);
    tryPlace('pillar', input.x, input.z + 34, 0);
  }
  // Buildings -> architecture pieces.
  for (const b of input.buildings) {
    const def = BUILDINGS[b.type];
    for (const kind of def.architecture) {
      if (kind === 'fort_wall' || kind === 'fort_gate' || kind === 'tower' || kind === 'field_plot' || kind === center) continue;
      if (kind === 'mud_house' || kind === 'thatch_hut' || kind === 'brick_house') continue;
      const count = kind === 'market_stall' ? 3 + b.level * 2 : kind === 'chhatri' ? 0 : 1;
      for (let i = 0; i < count; i++) placeNear(kind, R * 0.25, R * 0.8);
    }
  }
  // Houses on rings.
  const houseKinds: ArchitectureKind[] =
    input.kind === 'village' ? ['thatch_hut', 'mud_house', 'thatch_hut'] : input.kind === 'capital' || input.kind === 'city' ? ['brick_house', 'brick_house', 'mud_house', 'mansion'] : ['mud_house', 'brick_house', 'thatch_hut'];
  const houses = Math.max(6, Math.min(input.kind === 'capital' ? 170 : 110, Math.round(input.population / 110)));
  let placed = 0;
  for (let attempt = 0; attempt < houses * 8 && placed < houses; attempt++) {
    const kind = houseKinds[rng.int(0, houseKinds.length - 1)] as ArchitectureKind;
    if (placeNear(kind, R * 0.15, R * 0.92, 1, rng.range(0.85, 1.15))) placed++;
  }
  // Walls.
  if (input.fortLevel > 0) {
    const wallR = R * 1.02;
    const segLen = 14;
    const n = Math.max(12, Math.round((Math.PI * 2 * wallR) / segLen));
    const gates = input.fortLevel >= 2 ? 4 : 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = input.x + Math.sin(a) * wallR;
      const z = input.z + Math.cos(a) * wallR;
      const rot = a; // local +Z faces outward; the long side (local X) is tangent
      const isGate = i % Math.round(n / gates) === 0;
      const kind: ArchitectureKind = isGate ? 'fort_gate' : i % 4 === 2 ? 'tower' : 'fort_wall';
      if (terrain.isWater(x, z)) continue;
      const [hx, hz] = FOOTPRINT[kind];
      occ.mark(x, z, hx, hz);
      pieces.push({ kind, x, z, rot, scale: 1, variant: rng.int(0, 255), hx, hz });
    }
  }
  return { id: input.id, style: input.style, centerX: input.x, centerZ: input.z, radius: R, pieces };
}
