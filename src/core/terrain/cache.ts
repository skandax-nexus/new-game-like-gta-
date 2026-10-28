/**
 * Heightfield cache: generating a 513^2 window costs ~0.3-0.6 s, so sim and render share instances.
 * Keyed by the canonical spec. Owned by the CTO.
 */
import type { TerrainSpec } from '../types';
import { Heightfield } from './heightfield';
import { canonicalJson, fnv1a } from '../save';

const MAX_ENTRIES = 4;
const cache = new Map<string, Heightfield>();

export function terrainKey(spec: TerrainSpec): string {
  return fnv1a(canonicalJson(spec));
}

/** Get (or generate and cache) the heightfield for a spec. */
export function getHeightfield(spec: TerrainSpec): Heightfield {
  const key = terrainKey(spec);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const hf = Heightfield.generate(spec);
  cache.set(key, hf);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value as string;
    cache.delete(oldest);
  }
  return hf;
}

export function clearHeightfieldCache(): void {
  cache.clear();
}
