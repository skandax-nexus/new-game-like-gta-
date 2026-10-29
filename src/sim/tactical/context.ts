/**
 * Derived per-battle context: effective stats, pathing grid, fortification geometry and per-tick scratch arrays.
 * OWNER: Gameplay Engineer - Tactical Battle Simulation (GP-01).
 *
 * Everything here is a pure function of (BattleState.setup, terrain) plus overlays rebuilt from the current state,
 * so it is never saved and a battle resumed from JSON rebuilds an identical context. One context per setup object
 * (WeakMap), rebuilt if the battle is stepped with a different terrain (scene quality vs autoresolve windows).
 * Scratch arrays are preallocated: the step loops allocate nothing.
 */
import type { BattleSetup, BattleState, FormationState, TerrainQuery, UnitStats } from '../../core/types';
import { ENGINEER_WORKS } from '../../core/types';
import { dcos, dsin, facingOf } from '../../core/math';
import { BattleGrid } from './pathing';
import { createFortGeometry, segmentOfAngle, WALL_HALF_BAND, GATE_HALF_WIDTH, angle01 } from './fort';
import type { FortGeometry } from './fort';
import { moveProfile, variantStats } from './stats';

export interface BattleContext {
  readonly setup: BattleSetup;
  readonly terrain: TerrainQuery;
  readonly grid: BattleGrid;
  readonly fort: FortGeometry | null;
  /** Effective (variant) stats per formation index. */
  readonly stats: UnitStats[];
  /** Movement profile per formation index. */
  readonly profile: Uint8Array;
  readonly n: number;
  /** Squared centroid distances, n x n, rebuilt each tick. */
  readonly d2: Float64Array;
  /** Soldiers lost this tick per formation (heavy-casualty shock, commander checks). */
  readonly loss: Float32Array;
  /** 1 = formation takes part in movement/collision this tick. */
  readonly active: Uint8Array;
  /** Melee damage taken this tick (supply-threatened, reinforced logic). */
  readonly hurt: Uint8Array;
  /** Formation was engaged at the start of this tick (reinforced / contact events). */
  readonly wasEngaged: Uint8Array;
  /** Positions at the start of the tick (trample / router pass-through entry detection). */
  readonly prevX: Float64Array;
  readonly prevZ: Float64Array;
  /** Per-tick geometry cache (computeDistances): footprint half-diagonal, sin / cos of the facing. */
  readonly radius: Float64Array;
  readonly sin: Float64Array;
  readonly cos: Float64Array;
}

const contexts = new WeakMap<BattleSetup, BattleContext>();

function buildContext(state: BattleState, terrain: TerrainQuery): BattleContext {
  const setup = state.setup;
  const n = state.formations.length;
  const stats: UnitStats[] = [];
  const profile = new Uint8Array(Math.max(1, n));
  for (const f of state.formations) {
    stats[f.index] = variantStats(setup.sides[f.side].factionId, f.unitClass);
    profile[f.index] = moveProfile(f.unitClass);
  }
  return {
    setup,
    terrain,
    grid: new BattleGrid(terrain, setup.environment.weather.flood > 0.5),
    fort: createFortGeometry(setup),
    stats,
    profile,
    n,
    d2: new Float64Array(Math.max(1, n * n)),
    loss: new Float32Array(Math.max(1, n)),
    active: new Uint8Array(Math.max(1, n)),
    hurt: new Uint8Array(Math.max(1, n)),
    wasEngaged: new Uint8Array(Math.max(1, n)),
    prevX: new Float64Array(Math.max(1, n)),
    prevZ: new Float64Array(Math.max(1, n)),
    radius: new Float64Array(Math.max(1, n)),
    sin: new Float64Array(Math.max(1, n)),
    cos: new Float64Array(Math.max(1, n)),
  };
}

/** Rules-only view (stats + fort geometry) for command validation when no terrain is at hand. */
export type RulesContext = Pick<BattleContext, 'stats' | 'fort'>;

/** Existing context of a battle, or a rules-only view built from the setup (no terrain needed). */
export function rulesContext(state: BattleState): RulesContext {
  const ctx = contexts.get(state.setup);
  if (ctx && ctx.n === state.formations.length) return ctx;
  const stats: UnitStats[] = [];
  for (const f of state.formations) stats[f.index] = variantStats(state.setup.sides[f.side].factionId, f.unitClass);
  return { stats, fort: createFortGeometry(state.setup) };
}

/** The derived context of a battle (created on first use). */
export function battleContext(state: BattleState, terrain: TerrainQuery): BattleContext {
  let ctx = contexts.get(state.setup);
  if (!ctx || ctx.terrain !== terrain || ctx.n !== state.formations.length) {
    ctx = buildContext(state, terrain);
    contexts.set(state.setup, ctx);
  }
  refreshOverlay(state, ctx);
  return ctx;
}

/** Recompute the squared distance matrix and the geometry cache (after any movement). */
export function computeDistances(state: BattleState, ctx: BattleContext): void {
  const fs = state.formations;
  const n = ctx.n;
  const d2 = ctx.d2;
  for (let i = 0; i < n; i++) {
    const a = fs[i] as FormationState;
    ctx.radius[i] = 0.5 * Math.sqrt(a.width * a.width + a.depth * a.depth);
    ctx.sin[i] = dsin(a.facing);
    ctx.cos[i] = dcos(a.facing);
  }
  for (let i = 0; i < n; i++) {
    const a = fs[i] as FormationState;
    d2[i * n + i] = 0;
    for (let j = i + 1; j < n; j++) {
      const b = fs[j] as FormationState;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const v = dx * dx + dz * dz;
      d2[i * n + j] = v;
      d2[j * n + i] = v;
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// Pathing overlay (works, walls, gates, breaches, ladders)
// ---------------------------------------------------------------------------------------------------

function mix(h: number, v: number): number {
  return Math.imul(h ^ (v | 0), 16777619) >>> 0;
}

/**
 * (x, z) in f's local frame (x right, z forward) using the facing cached by computeDistances - valid until f turns
 * again this tick (morale / contact code runs after all movement).
 */
export function localOf(ctx: BattleContext, f: FormationState, x: number, z: number, out: { x: number; z: number }): void {
  const dx = x - f.x;
  const dz = z - f.z;
  const s = ctx.sin[f.index]!;
  const c = ctx.cos[f.index]!;
  out.x = dx * -c + dz * s;
  out.z = dx * s + dz * c;
}

/** Which aspect of f a point lies on: 0 front, 1 left, 2 right, 3 rear (box-normalized; cached facing). */
export function aspectOf(ctx: BattleContext, f: FormationState, x: number, z: number): 0 | 1 | 2 | 3 {
  const dx = x - f.x;
  const dz = z - f.z;
  const s = ctx.sin[f.index]!;
  const c = ctx.cos[f.index]!;
  const nx = (dx * -c + dz * s) / Math.max(1, f.width / 2);
  const nz = (dx * s + dz * c) / Math.max(1, f.depth / 2);
  if (Math.abs(nz) >= Math.abs(nx)) return nz >= 0 ? 0 : 3;
  return nx < 0 ? 1 : 2;
}

/** Signature of everything the overlay depends on (cheap; no allocation). */
export function overlaySignature(state: BattleState): number {
  let h = 2166136261;
  for (const w of state.works) {
    if (w.progress < 1 || w.hp <= 0) continue;
    if (w.work !== 'palisade' && w.work !== 'ditch' && w.work !== 'bridge') continue;
    h = mix(h, ENGINEER_WORKS.indexOf(w.work) + 1);
    h = mix(h, Math.round(w.x * 4));
    h = mix(h, Math.round(w.z * 4));
    h = mix(h, Math.round(w.facing * 1000));
  }
  const s = state.siege;
  if (s) {
    for (let i = 0; i < s.segments.length; i++) {
      const seg = s.segments[i]!;
      h = mix(h, (seg.hp > 0 ? 1 : 2) + (seg.ladder ? 4 : 0) + i * 8);
    }
    for (let i = 0; i < s.gates.length; i++) h = mix(h, (s.gates[i]!.hp > 0 ? 16 : 32) + i * 64);
  }
  return h;
}

/** Ditch speed factor (§6.6.5: crossers slowed to 0.4x) as a cost multiplier x10. */
const DITCH_MUL = 25;
const RUBBLE_MUL = 15;
const LADDER_MUL = 40;
const GATE_OPEN_MUL = 12;

function refreshOverlay(state: BattleState, ctx: BattleContext): void {
  const sig = overlaySignature(state);
  const grid = ctx.grid;
  if (sig === grid.overlaySig) return;
  grid.overlaySig = sig;
  grid.resetOverlay();
  const fort = ctx.fort;
  const siege = state.siege;
  if (fort && siege) {
    const both = 3;
    const attackerBit = 1 << fort.attackerSide;
    const defenderBit = 1 << fort.defenderSide;
    const r = fort.radius;
    const minX = fort.cx - r - 12;
    const maxX = fort.cx + r + 12;
    const minZ = fort.cz - r - 12;
    const maxZ = fort.cz + r + 12;
    for (let cz = grid.cellZ(minZ); cz <= grid.cellZ(maxZ); cz++) {
      for (let cx = grid.cellX(minX); cx <= grid.cellX(maxX); cx++) {
        const c = cz * grid.cols + cx;
        const px = grid.centerX(c);
        const pz = grid.centerZ(c);
        const dx = px - fort.cx;
        const dz = pz - fort.cz;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (Math.abs(d - r) > WALL_HALF_BAND) continue;
        const a = angle01(facingOf(dx, dz));
        const segIdx = segmentOfAngle(a, fort.segments);
        const seg = siege.segments[segIdx];
        if (!seg) continue;
        if (seg.hp <= 0) {
          grid.costMul[c] = RUBBLE_MUL;
          continue;
        }
        // Gate in this segment?
        let gate = -1;
        for (let g = 0; g < fort.gateAngle.length; g++) {
          if (fort.gateSegment[g] !== segIdx) continue;
          const da = Math.abs(angle01(a - fort.gateAngle[g]! + Math.PI) - Math.PI);
          if (da * r <= GATE_HALF_WIDTH + 4) gate = g;
        }
        if (gate >= 0) {
          const gs = siege.gates[gate];
          if (gs && gs.hp <= 0) grid.costMul[c] = GATE_OPEN_MUL;
          else grid.block[c] = attackerBit;
          continue;
        }
        if (seg.ladder) {
          grid.block[c] = defenderBit;
          grid.costMul[c] = LADDER_MUL;
          continue;
        }
        grid.block[c] = both;
      }
    }
  }
  for (const w of state.works) {
    if (w.progress < 1 || w.hp <= 0) continue;
    const s = dsin(w.facing);
    const c = dcos(w.facing);
    if (w.work === 'palisade' || w.work === 'ditch') {
      // 20 m line across the facing (right vector = (-cos, sin)).
      const ax = w.x + c * 10;
      const az = w.z - s * 10;
      const bx = w.x - c * 10;
      const bz = w.z + s * 10;
      if (w.work === 'palisade') grid.rasterSegment(ax, az, bx, bz, 1.5, (k) => (grid.block[k] = 3));
      else grid.rasterSegment(ax, az, bx, bz, 2, (k) => (grid.costMul[k] = Math.max(grid.costMul[k]!, DITCH_MUL)));
    } else if (w.work === 'bridge') {
      // 40 m span along the facing, 8 m wide.
      grid.rasterSegment(w.x - s * 20, w.z - c * 20, w.x + s * 20, w.z + c * 20, 3, (k) => {
        grid.road[k] = 1;
        grid.block[k] = 0;
      });
    }
  }
}
