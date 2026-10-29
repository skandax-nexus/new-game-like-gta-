/**
 * Ages and landmarks - read-only rules and selectors (DESIGN_SPEC §8.4-§8.5). OWNER: Simulation Engineer - Strategic
 * World Simulation (SIM-01). Landmark jobs themselves (start, progress, completion, age switch) live in construction.ts.
 *
 *  - ageChecklist(world, factionId): the next age's requirements as UI rows (current / required / met).
 *  - landmarkOptions(world, factionId): every landmark of the faction for the next age with its status
 *    ('available' | 'locked' | 'in_progress' | 'completed' | 'hidden') and a reason. One landmark per faction per age:
 *    starting one hides the other option (exclusivity); a landmark cannot be cancelled after 50%.
 *  - Unlock helpers: building / unit / treaty availability by age.
 */
import type { AgeId, BuildingType, ConstructionJob, FactionId, LandmarkDef, SettlementState, TreatyType, UnitClass, WorldState } from '../../core/types';
import { AGE_IDS } from '../../core/types';
import { sortedKeys } from '../../core/ids';
import { AGES, LANDMARKS, nextAge } from '../../data/ages';
import { BUILDINGS } from '../../data/buildings';
import { UNITS } from '../../data/units';

export function ageIdx(age: AgeId): number {
  return AGE_IDS.indexOf(age);
}

export interface AgeRequirementItem {
  id: 'previous' | 'settlements' | 'provinces' | 'population' | 'buildingTypes' | 'legitimacy' | 'stability';
  label: string;
  current: number;
  required: number;
  met: boolean;
}

export interface AgeChecklist {
  factionId: FactionId;
  currentAge: AgeId;
  nextAge: AgeId | null;
  items: AgeRequirementItem[];
  allMet: boolean;
}

export function ownedSettlementCount(world: WorldState, factionId: FactionId): number {
  let n = 0;
  for (const id of sortedKeys(world.settlements)) if (world.settlements[id]!.ownerFactionId === factionId) n++;
  return n;
}

export function ownedProvinceCount(world: WorldState, factionId: FactionId): number {
  let n = 0;
  for (const id of sortedKeys(world.provinces)) if (world.provinces[id]!.ownerFactionId === factionId) n++;
  return n;
}

export function realmPopulation(world: WorldState, factionId: FactionId): number {
  let n = 0;
  for (const id of sortedKeys(world.settlements)) {
    const s = world.settlements[id]!;
    if (s.ownerFactionId === factionId) n += s.population;
  }
  return n;
}

/** Distinct building types (any level) across the faction's settlements. */
export function distinctBuildingTypes(world: WorldState, factionId: FactionId): number {
  const seen = new Set<BuildingType>();
  for (const id of sortedKeys(world.settlements)) {
    const s = world.settlements[id]!;
    if (s.ownerFactionId !== factionId) continue;
    for (const b of s.buildings) if (b.level > 0) seen.add(b.type);
  }
  return seen.size;
}

export function ageChecklist(world: WorldState, factionId: FactionId): AgeChecklist {
  const f = world.factions[factionId];
  const current: AgeId = f?.age ?? 'janapada';
  const next = nextAge(current);
  const out: AgeChecklist = { factionId, currentAge: current, nextAge: next, items: [], allMet: false };
  if (!f || !next) return out;
  const r = AGES[next].requirements;
  const row = (id: AgeRequirementItem['id'], label: string, cur: number, req: number): AgeRequirementItem => ({ id, label, current: cur, required: req, met: cur >= req - 1e-9 });
  out.items.push(row('previous', `In the ${AGES[r.previous ?? current].name}`, ageIdx(current), ageIdx(r.previous ?? current)));
  out.items.push(row('settlements', 'Settlements', ownedSettlementCount(world, factionId), r.minSettlements));
  out.items.push(row('provinces', 'Provinces', ownedProvinceCount(world, factionId), r.minProvinces));
  out.items.push(row('population', 'People', Math.floor(realmPopulation(world, factionId)), r.minPopulation));
  out.items.push(row('buildingTypes', 'Building types', distinctBuildingTypes(world, factionId), r.minBuildingTypes));
  out.items.push(row('legitimacy', 'Legitimacy', f.legitimacy, r.minLegitimacy));
  out.items.push(row('stability', 'Stability', f.stability, r.minStability));
  out.allMet = out.items.every((i) => i.met);
  return out;
}

/** Landmark jobs of a faction currently queued anywhere. */
export function landmarkJobs(world: WorldState, factionId: FactionId): { settlement: SettlementState; index: number; job: ConstructionJob }[] {
  const out: { settlement: SettlementState; index: number; job: ConstructionJob }[] = [];
  for (const id of sortedKeys(world.settlements)) {
    const s = world.settlements[id]!;
    if (s.ownerFactionId !== factionId) continue;
    s.construction.forEach((job, index) => {
      if (job.landmarkId) out.push({ settlement: s, index, job });
    });
  }
  return out;
}

export interface LandmarkOption {
  landmark: LandmarkDef;
  status: 'available' | 'locked' | 'in_progress' | 'completed' | 'hidden';
  reason: string | null;
  /** Where it is being raised / stands. */
  settlementId: string | null;
  progress: number;
  /** Settlements of the faction whose kind allows it. */
  allowedSettlements: string[];
}

export const AGE_REASONS = {
  finalAge: 'Your realm has reached the last age',
  requirements: 'The age requirements are not met yet',
  otherChosen: 'Another landmark was chosen for this age',
  notYours: 'This landmark belongs to another realm',
  wrongAge: 'Not the landmark of your next age',
  noSite: 'None of your settlements can host it',
  kind: (kinds: readonly string[]) => `Must be raised in a ${kinds.join(', ').replace(/_/g, ' ')}`,
} as const;

/** Every landmark of the faction (both ages) with its status for the UI's age panel. */
export function landmarkOptions(world: WorldState, factionId: FactionId): LandmarkOption[] {
  const f = world.factions[factionId];
  if (!f) return [];
  const next = nextAge(f.age);
  const checklist = ageChecklist(world, factionId);
  const jobs = landmarkJobs(world, factionId);
  const out: LandmarkOption[] = [];
  for (const lm of LANDMARKS) {
    if (lm.factionId !== factionId) continue;
    const allowed = sortedKeys(world.settlements).filter((id) => world.settlements[id]!.ownerFactionId === factionId && lm.allowedIn.includes(world.settlements[id]!.kind));
    const opt: LandmarkOption = { landmark: lm, status: 'locked', reason: null, settlementId: null, progress: 0, allowedSettlements: allowed };
    const job = jobs.find((j) => j.job.landmarkId === lm.id);
    if (f.landmarks.includes(lm.id)) {
      opt.status = 'completed';
      for (const id of sortedKeys(world.settlements)) if (world.settlements[id]!.landmarks.some((l) => l.id === lm.id && l.builtBy === factionId)) opt.settlementId = id;
      opt.progress = 1;
    } else if (job) {
      opt.status = 'in_progress';
      opt.settlementId = job.settlement.id;
      opt.progress = job.job.progress;
    } else if (landmarkChosenForAge(world, factionId, lm.age)) {
      opt.status = 'hidden';
      opt.reason = AGE_REASONS.otherChosen;
    } else if (lm.age !== next) {
      opt.status = ageIdx(lm.age) <= ageIdx(f.age) ? 'hidden' : 'locked';
      opt.reason = next === null ? AGE_REASONS.finalAge : AGE_REASONS.wrongAge;
    } else if (!checklist.allMet) {
      opt.reason = AGE_REASONS.requirements;
    } else if (allowed.length === 0) {
      opt.reason = AGE_REASONS.noSite;
    } else {
      opt.status = 'available';
    }
    out.push(opt);
  }
  return out;
}

/** True when the faction started or completed any landmark of `age` (exclusivity). */
export function landmarkChosenForAge(world: WorldState, factionId: FactionId, age: AgeId): boolean {
  const f = world.factions[factionId];
  if (!f) return false;
  for (const id of f.landmarks) if (LANDMARKS.find((l) => l.id === id)?.age === age) return true;
  return landmarkJobs(world, factionId).some((j) => LANDMARKS.find((l) => l.id === j.job.landmarkId)?.age === age);
}

// ---------------------------------------------------------------------------------------------------
// Unlocks
// ---------------------------------------------------------------------------------------------------

export function buildingAge(type: BuildingType): AgeId {
  return BUILDINGS[type].age ?? 'janapada';
}

/** Max level a building may reach in the faction's age (AgeDef caps, BuildingDef.maxLevel). */
export function buildingLevelCap(world: WorldState, factionId: FactionId, type: BuildingType): number {
  const f = world.factions[factionId];
  const age = AGES[f?.age ?? 'janapada'];
  return Math.min(BUILDINGS[type].maxLevel, age.buildingLevelCaps[type] ?? age.maxBuildingLevel);
}

/** Unit availability by age: introduced in `age`, retired from `retiredInAge` (§5.8). */
export function unitAgeReason(world: WorldState, factionId: FactionId, cls: UnitClass): string | null {
  const f = world.factions[factionId];
  if (!f) return 'Unknown realm';
  const def = UNITS[cls];
  const need = def.age ?? 'janapada';
  if (ageIdx(f.age) < ageIdx(need)) return `Requires the ${AGES[need].name}`;
  if (def.retiredInAge && ageIdx(f.age) >= ageIdx(def.retiredInAge)) return `Retired in the ${AGES[def.retiredInAge].name}`;
  return null;
}

/** Treaty types a faction may propose in its age (cumulative AgeDef.unlockTreaties). */
export function treatyUnlocked(world: WorldState, factionId: FactionId, type: TreatyType): boolean {
  const f = world.factions[factionId];
  if (!f) return false;
  for (let i = 0; i <= ageIdx(f.age); i++) if (AGES[AGE_IDS[i] as AgeId].unlockTreaties.includes(type)) return true;
  return false;
}

/** Age in which a treaty type unlocks (for reasons). */
export function treatyAge(type: TreatyType): AgeId {
  for (const a of AGE_IDS) if (AGES[a].unlockTreaties.includes(type)) return a;
  return 'janapada';
}
