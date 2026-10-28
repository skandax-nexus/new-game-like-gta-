/**
 * Deterministic id + key helpers. Owned by the CTO. Three-free, DOM-free.
 */
import type { FactionId, WorldState } from './types';

/** Allocate a deterministic id from the world counter, e.g. nextWorldId(w, 'army') -> "army_17". */
export function nextWorldId(world: { nextId: number }, prefix: string): string {
  const id = `${prefix}_${world.nextId}`;
  world.nextId += 1;
  return id;
}

/** Key into DiplomacyState.relations for an unordered faction pair ("a|b" with a < b). */
export function relationKey(a: FactionId, b: FactionId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Whole days elapsed since campaign start. */
export function worldDay(world: Pick<WorldState, 'calendar'>): number {
  return Math.floor(world.calendar.totalHours / 24);
}

/**
 * Deterministic iteration order over a Record: ALWAYS iterate sim records via sortedKeys() (or keep
 * insertion order identical) so that runs, saves and loads produce identical results.
 */
export function sortedKeys<T>(rec: Record<string, T>): string[] {
  return Object.keys(rec).sort();
}

export function sortedValues<T>(rec: Record<string, T>): T[] {
  const keys = sortedKeys(rec);
  const out: T[] = new Array(keys.length);
  for (let i = 0; i < keys.length; i++) out[i] = rec[keys[i]] as T;
  return out;
}
