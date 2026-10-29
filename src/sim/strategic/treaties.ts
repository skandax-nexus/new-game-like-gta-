/**
 * Treaty queries (DESIGN_SPEC §7.10) without diplomacy side effects - safe to import from any strategic module.
 * OWNER: Simulation Engineer - Strategic World Simulation (SIM-01).
 *
 * A treaty is active when it was not broken and its end day (if any) has not passed. Marriage alliances also end
 * when a spouse dies (diplomacy daily). Tributary terms: `overlord` receives, `payer` pays (sign_treaty a,b ->
 * a overlord, b payer).
 */
import type { FactionId, RelationState, Treaty, TreatyType, WorldState } from '../../core/types';
import { relationKey } from '../../core/ids';
import { totalDays } from './seasons';

export function relationOf(world: WorldState, a: FactionId, b: FactionId): RelationState | null {
  return world.diplomacy.relations[relationKey(a, b)] ?? null;
}

export function isTreatyActive(world: WorldState, t: Treaty): boolean {
  return t.brokenBy === null && (t.endDay === null || t.endDay > totalDays(world.calendar));
}

/** The first active treaty of `type` between a and b (null if none). */
export function activeTreaty(world: WorldState, a: FactionId, b: FactionId, type: TreatyType): Treaty | null {
  const rel = relationOf(world, a, b);
  if (!rel) return null;
  for (const id of rel.treatyIds) {
    const t = world.diplomacy.treaties[id];
    if (t && t.type === type && isTreatyActive(world, t)) return t;
  }
  return null;
}

/** Active treaties between a and b. */
export function activeTreaties(world: WorldState, a: FactionId, b: FactionId): Treaty[] {
  const rel = relationOf(world, a, b);
  const out: Treaty[] = [];
  if (!rel) return out;
  for (const id of rel.treatyIds) {
    const t = world.diplomacy.treaties[id];
    if (t && isTreatyActive(world, t)) out.push(t);
  }
  return out;
}

/** Number of active treaties of `type` the faction holds with anyone. */
export function countTreaties(world: WorldState, factionId: FactionId, type: TreatyType): number {
  let n = 0;
  for (const key of Object.keys(world.diplomacy.relations).sort()) {
    const rel = world.diplomacy.relations[key] as RelationState;
    if (rel.a !== factionId && rel.b !== factionId) continue;
    for (const id of rel.treatyIds) {
      const t = world.diplomacy.treaties[id];
      if (t && t.type === type && isTreatyActive(world, t)) n++;
    }
  }
  return n;
}

/** Tributary treaties where `factionId` pays (as payer) - for tax autonomy and tribute. */
export function paysTributeTo(world: WorldState, factionId: FactionId): Treaty[] {
  const out: Treaty[] = [];
  for (const id of Object.keys(world.diplomacy.treaties).sort()) {
    const t = world.diplomacy.treaties[id] as Treaty;
    if (t.type === 'tributary' && t.terms.payer === factionId && isTreatyActive(world, t)) out.push(t);
  }
  return out;
}
