/**
 * Modifier aggregation (DESIGN_SPEC §7.1 SettlementModifiers semantics, §4.5 faction modifiers, §8.4-§8.5 ages and
 * landmarks). OWNER: Simulation Engineer - Strategic World Simulation (SIM-01).
 *
 *  - settlementEffects(world, s): building effects x level x condition + effects of landmarks standing here (only while
 *    the builder owns the settlement) + realm effects of every landmark the owner built and still holds.
 *  - factionMod(world, factionId, key): FactionDef multiplier x the bonuses of every age reached x factionEffects of
 *    the faction's landmarks it still holds (a lost landmark's bonuses are lost while not owned; the age is kept).
 *  - stageEffect(s): RULES.politics.stageEffects multipliers of the settlement's rebellion stage.
 * Pure, deterministic. Results are written into caller-provided scratch objects in hot paths.
 */
import type {
  AgeId,
  BuildingType,
  FactionId,
  FactionModifiers,
  LandmarkDef,
  SettlementModifiers,
  SettlementState,
  WorldState,
} from '../../core/types';
import { AGE_IDS, isRebelFaction } from '../../core/types';
import { sortedKeys } from '../../core/ids';
import { AGES, LANDMARKS } from '../../data/ages';
import { BUILDINGS } from '../../data/buildings';
import { DIFFICULTY_DEFS } from '../../data/difficulty';
import { FACTIONS } from '../../data/factions';
import { RULES } from '../../data/rules';
import type { RebellionStageEffect } from '../../data/rules';

export type ModKey = keyof Required<SettlementModifiers>;
export const MOD_KEYS: readonly ModKey[] = [
  'foodProduction',
  'foodCapacity',
  'waterAvailability',
  'irrigation',
  'housing',
  'sanitation',
  'publicOrder',
  'wealth',
  'tradeIncome',
  'taxEfficiency',
  'recruitmentPotential',
  'loyalty',
  'fortLevel',
  'disasterResistance',
  'culture',
];

/** A fully populated modifier record (all keys present, 0 = none). */
export type ModRecord = Record<ModKey, number>;

export function emptyMods(): ModRecord {
  return {
    foodProduction: 0,
    foodCapacity: 0,
    waterAvailability: 0,
    irrigation: 0,
    housing: 0,
    sanitation: 0,
    publicOrder: 0,
    wealth: 0,
    tradeIncome: 0,
    taxEfficiency: 0,
    recruitmentPotential: 0,
    loyalty: 0,
    fortLevel: 0,
    disasterResistance: 0,
    culture: 0,
  };
}

function resetMods(m: ModRecord): ModRecord {
  for (const k of MOD_KEYS) m[k] = 0;
  return m;
}

function addEffects(m: ModRecord, eff: SettlementModifiers, scale: number): void {
  for (const k of MOD_KEYS) {
    const v = eff[k];
    if (v !== undefined && v !== 0) m[k] += v * scale;
  }
}

const LANDMARK_BY_ID: ReadonlyMap<string, LandmarkDef> = new Map(LANDMARKS.map((l) => [l.id, l]));

export function landmarkDef(id: string): LandmarkDef | undefined {
  return LANDMARK_BY_ID.get(id);
}

export function buildingLevel(s: SettlementState, type: BuildingType): number {
  for (const b of s.buildings) if (b.type === type) return b.level;
  return 0;
}

export function buildingCondition(s: SettlementState, type: BuildingType): number {
  for (const b of s.buildings) if (b.type === type) return b.condition;
  return 0;
}

/** True when the faction holds the settlement where its landmark `id` stands. */
export function holdsLandmark(world: WorldState, factionId: FactionId, landmarkId: string): boolean {
  for (const sid of sortedKeys(world.settlements)) {
    const s = world.settlements[sid] as SettlementState;
    for (const l of s.landmarks) if (l.id === landmarkId && l.builtBy === factionId) return s.ownerFactionId === factionId;
  }
  return false;
}

/**
 * Settlement modifiers (DESIGN_SPEC §7.1): `effect x level x condition` for buildings, landmark settlement effects while
 * the builder owns it, realm effects of the owner's held landmarks. The natural fort level of the site is NOT included
 * (see fortLevelOf()).
 */
export function settlementEffects(world: WorldState, s: SettlementState, out: ModRecord = emptyMods()): ModRecord {
  resetMods(out);
  for (const b of s.buildings) {
    if (b.level <= 0) continue;
    addEffects(out, BUILDINGS[b.type].effects, b.level * b.condition);
  }
  for (const l of s.landmarks) {
    if (l.builtBy !== s.ownerFactionId) continue;
    const def = LANDMARK_BY_ID.get(l.id);
    if (def) addEffects(out, def.settlementEffects, l.condition);
  }
  const owner = s.ownerFactionId;
  if (owner) {
    for (const sid of sortedKeys(world.settlements)) {
      const host = world.settlements[sid] as SettlementState;
      if (host.ownerFactionId !== owner) continue;
      for (const l of host.landmarks) {
        if (l.builtBy !== owner) continue;
        const def = LANDMARK_BY_ID.get(l.id);
        if (def) addEffects(out, def.realmEffects, 1);
      }
    }
  }
  return out;
}

/** Fort level: natural site + Walls & Gates levels + landmark fort levels (integer, condition does not reduce it). */
export function fortLevelOf(world: WorldState, s: SettlementState, natural: number): number {
  let lvl = natural;
  for (const b of s.buildings) {
    const f = BUILDINGS[b.type].effects.fortLevel;
    if (f) lvl += f * b.level;
  }
  for (const l of s.landmarks) {
    if (l.builtBy !== s.ownerFactionId) continue;
    const f = LANDMARK_BY_ID.get(l.id)?.settlementEffects.fortLevel;
    if (f) lvl += f;
  }
  void world;
  return lvl;
}

// ---------------------------------------------------------------------------------------------------
// Faction modifiers
// ---------------------------------------------------------------------------------------------------

export function ageIndex(age: AgeId): number {
  return AGE_IDS.indexOf(age);
}

/**
 * Faction multiplier for `key`: FactionDef.modifiers x AgeDef.bonuses of every age reached (cumulative, the age the
 * faction starts in counts as reached) x factionEffects of its completed landmarks it still holds. Rebels / unknown: 1.
 */
export function factionMod(world: WorldState, factionId: FactionId | null, key: keyof FactionModifiers): number {
  if (!factionId || isRebelFaction(factionId)) return 1;
  const def = FACTIONS[factionId];
  let m = def ? def.modifiers[key] : 1;
  const f = world.factions[factionId];
  if (!f) return m;
  const ai = ageIndex(f.age);
  for (let i = 1; i <= ai; i++) {
    const b = AGES[AGE_IDS[i] as AgeId].bonuses[key];
    if (b !== undefined) m *= b;
  }
  for (const id of f.landmarks) {
    const ld = LANDMARK_BY_ID.get(id);
    const e = ld?.factionEffects[key];
    if (e !== undefined && holdsLandmark(world, factionId, id)) m *= e;
  }
  return m;
}

/** Difficulty income multiplier (§10.3): player income for the player, AI income for everyone else. */
export function incomeMultiplier(world: WorldState, factionId: FactionId): number {
  const d = DIFFICULTY_DEFS[world.difficulty];
  return world.factions[factionId]?.isPlayer ? d.playerIncome : d.aiIncome;
}

export function stageEffect(s: SettlementState): RebellionStageEffect {
  return RULES.politics.stageEffects[s.rebellionStage];
}

/** Sandbox multipliers (1 in campaigns). */
export function sandboxFertility(world: WorldState): number {
  return world.sandbox?.fertility ?? 1;
}

/** Unrest gains are multiplied by `sandbox.rebelliousness x 2` (0.5 = normal) - DESIGN_SPEC §7.9. */
export function rebelliousness(world: WorldState): number {
  return world.sandbox ? world.sandbox.rebelliousness * 2 : 1;
}
