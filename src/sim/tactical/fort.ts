/**
 * Siege fortification geometry (DESIGN_SPEC §6.6.5, §8.6). OWNER: Gameplay Engineer - Tactical Battle Simulation
 * (GP-01). Pure geometry derived from `BattleSetup.fortification`; the mutable wall state is `BattleState.siege`.
 *
 * Conventions (types.ts `BattleSiegeState`): the ring has RULES.battle.walls.segments = 12 segments; segment i covers
 * facing angles [i, i + 1) x (2 PI / 12) measured with the facing convention (0 = +Z, PI/2 = +X) around the
 * fortification center. Gate 0 is the MAIN gate: it sits in the segment facing the attacker's approach; further
 * gates are spread evenly around the ring. Towers stand at even angles starting at the main gate's segment edge.
 * The wall band is |distance - radius| <= WALL_HALF_BAND; defenders "on the walls" stand inside within
 * WALL_WALK_DEPTH of the radius.
 */
import type { BattleSetup, FortificationSpec, SettlementKind, SideIndex, Vec2 } from '../../core/types';
import { dcos, dsin, facingOf, TWO_PI } from '../../core/math';
import { RULES } from '../../data/rules';

/** Half thickness of the wall band in the pathing grid (m): > cell / sqrt(2) so the ring has no diagonal leaks. */
export const WALL_HALF_BAND = 5.8;
/** Defenders whose centroid is inside the ring within this depth of the radius stand on the walls. */
export const WALL_WALK_DEPTH = 15;
/** Arc half-width of a gate (m). */
export const GATE_HALF_WIDTH = 7;
/** Distance (m) from a gate / breach point at which works and formations act on it (rams, elephants, holding). */
export const GATE_REACH = 14;

export interface FortGeometry {
  cx: number;
  cz: number;
  radius: number;
  segments: number;
  defenderSide: SideIndex;
  attackerSide: SideIndex;
  /** Facing angle (from the center) of the main gate / the attacker's approach. */
  mainAngle: number;
  /** Segment index of gate g. */
  gateSegment: number[];
  /** Facing angle of gate g. */
  gateAngle: number[];
  /** Facing angle and segment of tower t. */
  towerAngle: number[];
  towerSegment: number[];
  /** Fort level 1..3 (palisade, mud-brick, stone). */
  level: number;
}

export function fortLevelOf(kind: FortificationSpec['kind']): number {
  return kind === 'stone_wall' ? 3 : kind === 'mud_brick_wall' ? 2 : 1;
}

/** Gates by settlement kind (§6.6.5): 1 fort, 2 town / port / temple town, 4 city / capital (villages: 1). */
export function gatesForSettlement(kind: SettlementKind): number {
  if (kind === 'city' || kind === 'capital') return 4;
  if (kind === 'town' || kind === 'port' || kind === 'temple_town') return 2;
  return 1;
}

/**
 * Fortification spec for a siege battle (helper for setup builders - SIM-01 battleSetupFromEngagement, scripted
 * battles): segment HP = fortLevel x 1000 x fortDefense / 12; towers = 1 per 2 segments per fort level.
 */
export function createFortificationSpec(opts: {
  settlementKind: SettlementKind;
  fortLevel: number;
  fortDefense: number;
  center: Vec2;
  radius: number;
  defenderSide: SideIndex;
  ditch?: boolean;
}): FortificationSpec {
  const level = Math.max(1, Math.min(3, Math.round(opts.fortLevel)));
  const segs = RULES.battle.walls.segments;
  return {
    kind: level >= 3 ? 'stone_wall' : level === 2 ? 'mud_brick_wall' : 'palisade',
    center: { x: opts.center.x, z: opts.center.z },
    radius: Math.max(40, opts.radius),
    gates: gatesForSettlement(opts.settlementKind),
    towers: Math.round((segs / 2) * level),
    wallHp: Math.round((level * RULES.siege.wallHpPerLevel * opts.fortDefense) / segs),
    ditch: opts.ditch ?? level >= 2,
    defenderSide: opts.defenderSide,
  };
}

/** Normalize a facing angle to [0, 2PI). */
export function angle01(a: number): number {
  let x = a % TWO_PI;
  if (x < 0) x += TWO_PI;
  return x;
}

export function segmentOfAngle(a: number, segments: number): number {
  const s = Math.floor((angle01(a) / TWO_PI) * segments);
  return s >= segments ? segments - 1 : s;
}

export function segmentMidAngle(seg: number, segments: number): number {
  return ((seg + 0.5) / segments) * TWO_PI;
}

/** Direction (facing angle from the fort center) the attacker comes from. */
export function attackerApproach(setup: Pick<BattleSetup, 'terrain' | 'fortification' | 'attackerSide'>): number {
  const fort = setup.fortification;
  if (!fort) return 0;
  const dx = setup.terrain.centerX - fort.center.x;
  const dz = setup.terrain.centerZ - fort.center.z;
  if (dx * dx + dz * dz > 50 * 50) return facingOf(dx, dz);
  // Fort at the map center: attackers come across the river axis (side 0 deploys on +axis).
  const a = setup.terrain.river.angle;
  const ax = -dsin(a);
  const az = dcos(a);
  const sign = setup.attackerSide === 0 ? 1 : -1;
  return facingOf(ax * sign, az * sign);
}

export function createFortGeometry(setup: Pick<BattleSetup, 'terrain' | 'fortification' | 'attackerSide'>): FortGeometry | null {
  const fort = setup.fortification;
  if (!fort) return null;
  const segments = RULES.battle.walls.segments;
  const mainAngle = attackerApproach(setup);
  const mainSeg = segmentOfAngle(mainAngle, segments);
  const gates = Math.max(1, Math.min(segments, fort.gates));
  const gateSegment: number[] = [];
  const gateAngle: number[] = [];
  for (let g = 0; g < gates; g++) {
    const seg = (mainSeg + Math.round((g * segments) / gates)) % segments;
    if (gateSegment.includes(seg)) continue;
    gateSegment.push(seg);
    gateAngle.push(segmentMidAngle(seg, segments));
  }
  const towers = Math.max(0, fort.towers);
  const towerAngle: number[] = [];
  const towerSegment: number[] = [];
  const start = (mainSeg / segments) * TWO_PI;
  for (let t = 0; t < towers; t++) {
    const a = angle01(start + (t * TWO_PI) / towers);
    towerAngle.push(a);
    towerSegment.push(segmentOfAngle(a + 1e-6, segments));
  }
  return {
    cx: fort.center.x,
    cz: fort.center.z,
    radius: fort.radius,
    segments,
    defenderSide: fort.defenderSide,
    attackerSide: (1 - fort.defenderSide) as SideIndex,
    mainAngle,
    gateSegment,
    gateAngle,
    towerAngle,
    towerSegment,
    level: fortLevelOf(fort.kind),
  };
}

/** Point on the ring at facing angle `a` and distance `r` from the center. */
export function ringPoint(g: FortGeometry, a: number, r: number, out: Vec2): Vec2 {
  out.x = g.cx + dsin(a) * r;
  out.z = g.cz + dcos(a) * r;
  return out;
}

export function distFromCenter(g: FortGeometry, x: number, z: number): number {
  const dx = x - g.cx;
  const dz = z - g.cz;
  return Math.sqrt(dx * dx + dz * dz);
}

export function angleFromCenter(g: FortGeometry, x: number, z: number): number {
  return facingOf(x - g.cx, z - g.cz);
}

/** Inside the ring (behind the wall band). */
export function insideRing(g: FortGeometry, x: number, z: number): boolean {
  return distFromCenter(g, x, z) < g.radius - WALL_HALF_BAND;
}

/** Index of the gate whose arc contains the point (within the wall band), or -1. */
export function gateAt(g: FortGeometry, x: number, z: number): number {
  const d = distFromCenter(g, x, z);
  if (Math.abs(d - g.radius) > WALL_HALF_BAND + 2) return -1;
  const a = angleFromCenter(g, x, z);
  for (let i = 0; i < g.gateAngle.length; i++) {
    const da = Math.abs(angle01(a - g.gateAngle[i]! + Math.PI) - Math.PI);
    if (da * g.radius <= GATE_HALF_WIDTH) return i;
  }
  return -1;
}
