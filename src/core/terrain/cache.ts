/**
 * Heightfield cache. OWNER: CTO (primeHeightfield / grids hand-off added by CORE-01 for GFX-02's Web Worker).
 *
 * Generating a 513^2 window costs ~0.3-0.6 s, so sim and render share instances keyed by the canonical spec.
 *
 * Worker hand-off (GFX-02, docs/ARCHITECTURE.md "Contracts v2"):
 *   worker:  const hf = Heightfield.generate(spec); postMessage(extractHeightfieldGrids(hf), transferList(grids))
 *   main:    primeHeightfield(spec, grids)  -> the same Heightfield every later getHeightfield(spec) returns
 * A primed heightfield is identical to a generated one (tests/contracts/heightfield-prime.test.ts), so the sim
 * stays deterministic whichever path filled the cache. This module deliberately does not import core/save
 * (which pulls content data) so a terrain worker bundle stays small.
 */
import type { TerrainSpec } from '../types';
import { Heightfield, type HeightfieldGrids } from './heightfield';

/** Defined beside Heightfield (Heightfield.fromGrids); re-exported here for the worker hand-off API. */
export type { HeightfieldGrids } from './heightfield';

const MAX_ENTRIES = 4;
const cache = new Map<string, Heightfield>();

/** Stable JSON of plain data with sorted object keys (key insertion order never changes the key). */
function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(',')}}`;
}

/** FNV-1a 32-bit (same function as core/save.ts fnv1a). */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Cache key of a terrain spec (8 hex chars + resolution, collision-safe for the handful of live windows). */
export function terrainKey(spec: TerrainSpec): string {
  return `${fnv1a(stableJson(spec))}:${spec.resolution}`;
}

function remember(key: string, hf: Heightfield): Heightfield {
  cache.delete(key);
  cache.set(key, hf);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value as string;
    cache.delete(oldest);
  }
  return hf;
}

/** Get (or generate and cache) the heightfield for a spec. */
export function getHeightfield(spec: TerrainSpec): Heightfield {
  const key = terrainKey(spec);
  const hit = cache.get(key);
  if (hit) return remember(key, hit);
  return remember(key, Heightfield.generate(spec));
}

/** The cached heightfield for a spec without generating one (null on a miss). */
export function peekHeightfield(spec: TerrainSpec): Heightfield | null {
  return cache.get(terrainKey(spec)) ?? null;
}

export function clearHeightfieldCache(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------------------------------
// Worker hand-off
// ---------------------------------------------------------------------------------------------------

/** Grids of a generated heightfield (worker side). Shares the arrays - transfer or copy as needed. */
export function extractHeightfieldGrids(hf: Heightfield): HeightfieldGrids {
  return { heights: hf.heights, biomes: hf.biomes, moistureGrid: hf.moistureGrid, minHeight: hf.minHeight, maxHeight: hf.maxHeight };
}

/** Buffers to pass as the postMessage transfer list. */
export function heightfieldTransferList(g: HeightfieldGrids): ArrayBuffer[] {
  return [g.heights.buffer, g.biomes.buffer, g.moistureGrid.buffer].filter((b): b is ArrayBuffer => b instanceof ArrayBuffer);
}

/**
 * Rebuild a Heightfield from grids produced elsewhere (identical to Heightfield.generate(spec) for the same
 * spec). Same as `Heightfield.fromGrids(spec, grids)`; kept as the CORE-01 hand-off entry point.
 * Throws if the grids do not match the spec.
 */
export function heightfieldFromGrids(spec: TerrainSpec, grids: HeightfieldGrids): Heightfield {
  return Heightfield.fromGrids(spec, grids);
}

/**
 * Seed the cache with a heightfield computed off the main thread (GFX-02 `loadHeightfieldAsync`). Later
 * `getHeightfield(spec)` calls - sim and render alike - return this instance. An existing entry wins (it is
 * already shared by callers), so priming twice is harmless. Returns the cached heightfield.
 */
export function primeHeightfield(spec: TerrainSpec, grids: HeightfieldGrids): Heightfield {
  const key = terrainKey(spec);
  const hit = cache.get(key);
  if (hit) return remember(key, hit);
  return remember(key, heightfieldFromGrids(spec, grids));
}
