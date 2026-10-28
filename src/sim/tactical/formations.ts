/**
 * Formation geometry, slots and movement. OWNER: Lead Gameplay Engineer. Baseline by the CTO.
 *
 * Slot layout convention (shared with sim/tactical/soldiers.ts and render):
 *   slot s -> file = s % files, rank = floor(s / files). Rank 0 is the FRONT rank.
 *   Local offset: x = (file - (files - 1) / 2) * spacingX * spread,  z = -rank * spacingZ * spread
 *   (local +Z = forward). World = formation center + rotate(local, facing), where the center is the
 *   middle of the front rank shifted back by depth/2 (i.e. (x, z) is the formation's centroid).
 *
 * Required behavior (owner): wheeling vs. turning-in-place costs, pathing around water/obstacles
 * (fords/bridges), collision avoidance between friendly formations, cohesion loss while moving through
 * rough terrain, shape-specific spacing (loose = 1.8x), wedge geometry, circle/square all-round facing.
 */
import type { FormationShape, FormationState, TerrainQuery, UnitClass, Vec2 } from '../../core/types';
import { approachAngle, dcos, dsin, facingOf } from '../../core/math';
import { UNITS } from '../../data/units';

export interface FormationDims {
  files: number;
  ranks: number;
  width: number;
  depth: number;
  spread: number;
}

/** Aspect (files : ranks) per shape. */
/** Detour headings (radians) tried when the direct step is blocked. */
const DETOURS = [0.5, -0.5, 1.0, -1.0, 1.5, -1.5];

const SHAPE_ASPECT: Record<FormationShape, number> = { line: 5, column: 0.25, square: 1, wedge: 1.6, loose: 3, circle: 1 };
const SHAPE_SPREAD: Record<FormationShape, number> = { line: 1, column: 1, square: 1, wedge: 1.1, loose: 1.8, circle: 1.15 };

export function formationDims(unitClass: UnitClass, soldiers: number, shape: FormationShape): FormationDims {
  const st = UNITS[unitClass].stats;
  const n = Math.max(1, soldiers);
  const aspect = SHAPE_ASPECT[shape];
  let files = Math.max(1, Math.round(Math.sqrt(n * aspect)));
  files = Math.min(files, n);
  const ranks = Math.ceil(n / files);
  const spread = SHAPE_SPREAD[shape];
  return { files, ranks, width: files * st.spacingX * spread, depth: ranks * st.spacingZ * spread, spread };
}

/** Recompute files/ranks/width/depth after strength or shape change. */
export function refreshDims(f: FormationState): void {
  const d = formationDims(f.unitClass, Math.max(1, f.soldiers), f.shape);
  f.files = d.files;
  f.ranks = d.ranks;
  f.width = d.width;
  f.depth = d.depth;
}

/** Local (unrotated) offset of a slot relative to the formation centroid. +Z = forward. */
export function slotLocalOffset(f: FormationState, slot: number, out: Vec2): Vec2 {
  const st = UNITS[f.unitClass].stats;
  const spread = f.shape === 'loose' ? 1.8 : f.shape === 'circle' ? 1.15 : f.shape === 'wedge' ? 1.1 : 1;
  const file = slot % f.files;
  const rank = Math.floor(slot / f.files);
  let lx = (file - (f.files - 1) / 2) * st.spacingX * spread;
  let lz = ((f.ranks - 1) / 2 - rank) * st.spacingZ * spread;
  if (f.shape === 'wedge') lz -= Math.abs(lx) * 0.6;
  if (f.shape === 'circle' && f.soldiers > 6) {
    // Ring layout: distribute slots on concentric rings.
    const ringCap = Math.max(6, Math.round(f.files * 2.2));
    const ring = Math.floor(slot / ringCap);
    const idx = slot % ringCap;
    const r = (1 + ring) * st.spacingZ * 1.4 + 2;
    const a = (idx / ringCap) * 6.283185307179586;
    lx = dsin(a) * r;
    lz = dcos(a) * r;
  }
  out.x = lx;
  out.z = lz;
  return out;
}

/** World position of a slot (centroid + rotated local offset). */
export function slotWorldPosition(f: FormationState, slot: number, out: Vec2): Vec2 {
  slotLocalOffset(f, slot, out);
  const s = dsin(f.facing);
  const c = dcos(f.facing);
  // Local (lx, lz) with +Z forward rotated by facing: world = lx * right + lz * forward,
  // forward = (sin, cos), right = (-cos, sin).
  const wx = f.x + out.x * -c + out.z * s;
  const wz = f.z + out.x * s + out.z * c;
  out.x = wx;
  out.z = wz;
  return out;
}

/** Effective speed (m/s) of a formation on its current ground. */
export function formationSpeed(f: FormationState, terrain: TerrainQuery, run: boolean): number {
  const def = UNITS[f.unitClass];
  const base = run ? def.stats.runSpeed : def.stats.walkSpeed;
  const tc = terrain.terrainClassAt(f.x, f.z);
  const t = def.terrain[tc];
  return base * t.speed * (1 - f.fatigue * 0.35);
}

/**
 * Move a formation toward (tx, tz), turning at its turn rate. Returns remaining distance.
 * `faceTarget` = desired facing on arrival (null keeps the travel direction).
 */
export function moveFormationToward(
  f: FormationState,
  tx: number,
  tz: number,
  faceTarget: number | null,
  dt: number,
  terrain: TerrainQuery,
  run: boolean,
  backwards = false,
): number {
  const dx = tx - f.x;
  const dz = tz - f.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  const turn = UNITS[f.unitClass].stats.turnRate * dt;
  if (d < 0.5) {
    f.vx = 0;
    f.vz = 0;
    if (faceTarget !== null) f.facing = approachAngle(f.facing, faceTarget, turn);
    return 0;
  }
  const travelFacing = facingOf(dx, dz);
  const desired = backwards ? travelFacing + Math.PI : travelFacing;
  f.facing = approachAngle(f.facing, desired, turn);
  const speed = formationSpeed(f, terrain, run) * (backwards ? 0.5 : 1);
  const step = Math.min(d, speed * dt);
  let nx = f.x + (dx / d) * step;
  let nz = f.z + (dz / d) * step;
  // Baseline obstacle avoidance: deep water blocks; slide along the bank looking for a ford.
  // TODO(Lead Gameplay): replace with a flow-field / grid path planner (fords, bridges, works).
  if (terrain.terrainClassAt(nx, nz) === 'deep_water') {
    let found = false;
    for (const turnBy of DETOURS) {
      const h = travelFacing + turnBy;
      const ax = f.x + dsin(h) * step;
      const az = f.z + dcos(h) * step;
      if (terrain.terrainClassAt(ax, az) !== 'deep_water') {
        nx = ax;
        nz = az;
        found = true;
        break;
      }
    }
    if (!found) {
      f.vx = 0;
      f.vz = 0;
      return d;
    }
  }
  f.vx = (nx - f.x) / dt;
  f.vz = (nz - f.z) / dt;
  f.x = nx;
  f.z = nz;
  return d - step;
}
