/**
 * Effective unit stats, unit categories and rule accessors for the tactical battle sim (DESIGN_SPEC §5, §6).
 * OWNER: Gameplay Engineer - Tactical Battle Simulation (GP-01).
 *
 *  - Faction variants (§5.7) are applied to `UnitStats` at formation creation: every formation of a side reads
 *    `variantStats(factionId, unitClass)` (cached, pure function of the data), never `UNITS[cls].stats` directly.
 *  - Shape modifiers (§6.2) come from `RULES.battle.shapes`; fatigue tiers (§6.9) from `RULES.battle.fatigueTiers`.
 * Pure data helpers: deterministic and three-free.
 */
import type { FactionId, FormationShape, FormationState, NumericKeys, UnitCategory, UnitClass, UnitStats } from '../../core/types';
import { TERRAIN_CLASSES } from '../../core/types';
import { UNITS } from '../../data/units';
import { FACTIONS } from '../../data/factions';
import { RULES } from '../../data/rules';

/** Shape modifier row (`RULES.battle.shapes[shape]`). */
export type ShapeMods = (typeof RULES.battle.shapes)[FormationShape];

export function shapeMods(shape: FormationShape): ShapeMods {
  return RULES.battle.shapes[shape];
}

const statsCache = new Map<string, UnitStats>();

/** `UnitStats` of a class with the faction's variant multipliers applied (§5.7). Cached; do not mutate. */
export function variantStats(factionId: FactionId, cls: UnitClass): UnitStats {
  const key = `${factionId}|${cls}`;
  const hit = statsCache.get(key);
  if (hit) return hit;
  const base = UNITS[cls].stats;
  const variant = FACTIONS[factionId]?.unitVariants?.[cls];
  let out: UnitStats = base;
  if (variant) {
    out = { ...base, recruitCost: { ...base.recruitCost } };
    for (const k of Object.keys(variant.multipliers) as NumericKeys<UnitStats>[]) {
      const m = variant.multipliers[k];
      if (m !== undefined) out[k] = base[k] * m;
    }
  }
  statsCache.set(key, out);
  return out;
}

/** Variant display name ("Hill Bowmen") or null when the faction fields the plain class. */
export function variantName(factionId: FactionId, cls: UnitClass): string | null {
  return FACTIONS[factionId]?.unitVariants?.[cls]?.name ?? null;
}

export function categoryOf(cls: UnitClass): UnitCategory {
  return UNITS[cls].category;
}

/** Riders and cars: cavalry, chariots, scouts (pursuit share, mud, horse fear of elephants). */
export function isMounted(cls: UnitClass): boolean {
  return UNITS[cls].category === 'mounted';
}

/** Run-in distance class for charges: mounted and elephants start running at 90 m, foot at 40 m. */
export function isMountedOrBeast(cls: UnitClass): boolean {
  const c = UNITS[cls].category;
  return c === 'mounted' || c === 'beast';
}

/** Combat formations decide whether a side is broken (engineers and supply trains do not). */
export function isCombatClass(cls: UnitClass): boolean {
  return cls !== 'engineers' && cls !== 'supply_train';
}

/** Foot soldiers that elephants and chariots trample through (§6.5). */
export function isFoot(cls: UnitClass): boolean {
  const c = UNITS[cls].category;
  return c === 'infantry' || c === 'ranged' || cls === 'engineers';
}

/** Elephants and chariots pass through foot formations (§6.5). */
export function tramples(cls: UnitClass): boolean {
  return cls === 'war_elephants' || cls === 'chariots';
}

/** Spearmen and guards brace against charges from the front (§6.6.2). */
export function canBrace(cls: UnitClass): boolean {
  return cls === 'spearmen' || cls === 'elite_guards';
}

/** Ranged formation (has a ranged attack and ammunition). */
export function isShooter(st: UnitStats): boolean {
  return st.rangedAttack > 0 && st.range > 0 && st.ammo > 0;
}

/** Infantry archers must stand to shoot; chariots, elephants and scouts shoot on the move. */
export function shootsOnTheMove(cls: UnitClass): boolean {
  const c = UNITS[cls].category;
  return c === 'mounted' || c === 'beast';
}

export type FatigueTier = 'fresh' | 'tired' | 'exhausted' | 'spent';

/** Fatigue tier (§6.9): Fresh < 0.25, Tired < 0.5, Exhausted < 0.8 (cannot run), Spent >= 0.8 (cannot charge). */
export function fatigueTier(fatigue: number): FatigueTier {
  const tiers = RULES.battle.fatigueTiers;
  let id: FatigueTier = 'fresh';
  for (const t of tiers) if (fatigue >= t.from) id = t.id as FatigueTier;
  return id;
}

/** Exhausted (>= 0.5) and spent formations cannot run. */
export function canRun(f: FormationState): boolean {
  return f.fatigue < 0.5;
}

/** Spent formations (>= 0.8) cannot charge (§6.9); exhausted ones cannot run, so they cannot charge either. */
export function canCharge(f: FormationState): boolean {
  return f.fatigue < 0.5;
}

/** Movement profiles: unit classes with identical terrain speed rows share pathing costs (§5.4). */
export const MOVE_PROFILES: readonly UnitClass[][] = (() => {
  const groups: UnitClass[][] = [];
  const keys: string[] = [];
  for (const cls of Object.keys(UNITS) as UnitClass[]) {
    const t = UNITS[cls].terrain;
    const key = TERRAIN_CLASSES.map((k) => t[k].speed).join(',');
    const i = keys.indexOf(key);
    if (i >= 0) groups[i]!.push(cls);
    else {
      keys.push(key);
      groups.push([cls]);
    }
  }
  return groups;
})();

const PROFILE_OF: Readonly<Record<UnitClass, number>> = (() => {
  const out = {} as Record<UnitClass, number>;
  MOVE_PROFILES.forEach((g, i) => {
    for (const c of g) out[c] = i;
  });
  return out;
})();

/** Movement profile index of a class (pathing cost tables are per profile). */
export function moveProfile(cls: UnitClass): number {
  return PROFILE_OF[cls];
}
