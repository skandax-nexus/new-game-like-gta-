/**
 * Construction, landmarks, repairs and fortifications (DESIGN_SPEC §7.6, §8.2, §8.4-§8.6).
 * OWNER: Simulation Engineer - Strategic World Simulation (SIM-01).
 *
 * Rules:
 *   cost(level n) = L1 cost x 1.6^(n-1) (wealth, timber, stone, labor); days(n) = buildDays x 1.3^(n-1)
 *   crew = labor / days; builders = max(20, labor x laborAllocation.construction)
 *   progress/day = min(1.25, assigned / crew) / days x faction constructionSpeed x (varsha ? 0.7 : 1)
 *   (housing and workshops ignore the monsoon). Builders fill the first 3 jobs in queue order, each capped at
 *   1.25 x crew; queue max 5. Wealth + materials are paid when queued ("Need 120 timber"); labor over time.
 *   Cancel refunds 90% of the unspent cost; landmarks cannot be cancelled after 50%. Construction pauses while the
 *   treasury is negative. Repairs cost 0.5 x level cost x (1 - condition) and restore condition to 1.
 *   Landmarks: one per faction per age (starting one hides the other); completion advances the age at once, applies
 *   onComplete effects and adds the landmark's settlement / realm / faction effects while the settlement is held.
 *   Walls: fortLevel = natural site + Walls & Gates levels + landmark fort levels; wallHp max = fortLevel x 1,000 x
 *   fortDefense; walls repair 2%/day when not besieged.
 */
import type {
  BuildingType,
  ConstructionJob,
  EventScope,
  Effect,
  FactionId,
  GridCell,
  LandmarkDef,
  MaterialCost,
  Rotation,
  SettlementState,
  SimEvent,
  WorldState,
} from '../../core/types';
import { BUILDING_TYPES } from '../../core/types';
import { AGES } from '../../data/ages';
import { BUILDINGS } from '../../data/buildings';
import { RULES } from '../../data/rules';
import { ageChecklist, ageIdx, buildingAge, buildingLevelCap, landmarkChosenForAge, AGE_REASONS } from './ages';
import { factionMod, fortLevelOf, landmarkDef } from './modifiers';
import { autoPlace, footprintOf, PLACEMENT_REASONS, validatePlacement } from './placement';
import { seasonOf } from './seasons';
import { addChronicle, addMonthToDate, addStat, naturalFortLevel, notifyPlayer, today } from './state';

const C = RULES.construction;

export const CONSTRUCTION_REASONS = {
  noSettlement: 'No such settlement',
  notOwned: 'Not your settlement',
  unknown: 'Unknown building',
  age: (age: string) => `Requires the ${age}`,
  kind: (kind: string) => `Cannot be built in a ${kind.replace(/_/g, ' ')}`,
  requires: (name: string) => `Requires ${name}`,
  maxLevel: 'Already at the highest level',
  ageCap: 'The level cap of your age is reached',
  queueFull: `The construction queue is full (${C.maxQueue})`,
  need: (amount: number, what: string) => `Need ${Math.ceil(amount)} ${what}`,
  debt: 'The treasury is in debt - construction is paused',
  noJob: 'Nothing to cancel',
  landmarkLocked: 'A landmark cannot be cancelled after it is half built',
  notDamaged: 'The building is not damaged',
  notBuilt: 'There is no such building here',
  alreadyRepairing: 'Already being repaired',
  landmarkUnknown: 'Unknown landmark',
} as const;

// ---------------------------------------------------------------------------------------------------
// Costs and time
// ---------------------------------------------------------------------------------------------------

function powInt(base: number, n: number): number {
  let r = 1;
  for (let i = 0; i < n; i++) r *= base;
  return r;
}

export function levelCost(type: BuildingType, level: number): MaterialCost {
  const c = BUILDINGS[type].cost;
  const k = powInt(C.levelCostMultiplier, Math.max(0, level - 1));
  return { wealth: c.wealth * k, timber: (c.timber ?? 0) * k, stone: (c.stone ?? 0) * k, labor: c.labor * k };
}

export function levelDays(type: BuildingType, level: number): number {
  return BUILDINGS[type].buildDays * powInt(C.levelTimeMultiplier, Math.max(0, level - 1));
}

export function nominalCrew(type: BuildingType, level: number): number {
  return levelCost(type, level).labor / levelDays(type, level);
}

export function isLandmarkJob(job: ConstructionJob): boolean {
  return !!job.landmarkId;
}

/** Duration (days at full crew ratio 1) of a job. */
export function jobDays(job: ConstructionJob): number {
  if (job.landmarkId) return landmarkDef(job.landmarkId)?.buildDays ?? 60;
  if (job.repair) {
    const crew = jobCrew(job);
    return Math.max(1, (job.paid.labor > 0 ? job.paid.labor : levelCost(job.type, job.targetLevel).labor * 0.25) / crew);
  }
  return levelDays(job.type, job.targetLevel);
}

/** Nominal crew of a job (v1 jobs carry 0 = derive from the definition). */
export function jobCrew(job: ConstructionJob): number {
  if (job.crew > 0) return job.crew;
  if (job.landmarkId) {
    const lm = landmarkDef(job.landmarkId);
    return lm ? lm.cost.labor / lm.buildDays : 100;
  }
  return nominalCrew(job.type, job.targetLevel);
}

/** Builders available in a settlement today. */
export function buildersOf(s: SettlementState): number {
  return Math.max(C.minBuilders, s.labor * s.laborAllocation.construction);
}

/** Visual construction stage for a progress value (RULES.construction.stages). */
export function constructionStage(progress: number): { id: string; label: string } {
  let st: { id: string; label: string } = C.stages[0];
  for (const s of C.stages) if (progress >= s.from) st = s;
  return { id: st.id, label: st.label };
}

/** Highest level built or queued for a type (next upgrade targets this + 1). */
export function plannedLevel(s: SettlementState, type: BuildingType): number {
  let lvl = 0;
  for (const b of s.buildings) if (b.type === type) lvl = Math.max(lvl, b.level);
  for (const j of s.construction) if (!j.landmarkId && !j.repair && j.type === type) lvl = Math.max(lvl, j.targetLevel);
  return lvl;
}

function canAfford(world: WorldState, factionId: FactionId, cost: MaterialCost): string | null {
  const f = world.factions[factionId];
  if (!f) return CONSTRUCTION_REASONS.notOwned;
  if (f.treasury < cost.wealth) return CONSTRUCTION_REASONS.need(cost.wealth, 'wealth');
  if (f.materials.timber < cost.timber) return CONSTRUCTION_REASONS.need(cost.timber, 'timber');
  if (f.materials.stone < cost.stone) return CONSTRUCTION_REASONS.need(cost.stone, 'stone');
  return null;
}

function pay(world: WorldState, factionId: FactionId, cost: MaterialCost): void {
  const f = world.factions[factionId]!;
  f.treasury -= cost.wealth;
  f.materials.timber -= cost.timber;
  f.materials.stone -= cost.stone;
  addMonthToDate(world, factionId, 'construction', cost.wealth);
}

// ---------------------------------------------------------------------------------------------------
// Validation + queueing
// ---------------------------------------------------------------------------------------------------

export interface BuildCheck {
  ok: boolean;
  reason: string | null;
  targetLevel: number;
  cost: MaterialCost;
  days: number;
  /** A new building (level 1) needs a cell; null when not needed or nothing fits. */
  placement: { cell: GridCell; rot: Rotation } | null;
  /** True for upgrades (no placement). */
  upgrade: boolean;
}

/**
 * Full check of a `build` command: ownership, age, settlement kind, requirements, level caps, queue, placement
 * (given cell or the best automatic spot) and costs. Reasons are user-facing.
 */
export function validateBuild(world: WorldState, factionId: FactionId, settlementId: string, type: BuildingType, cell?: GridCell, rot: Rotation = 0): BuildCheck {
  const R = CONSTRUCTION_REASONS;
  const zero: MaterialCost = { wealth: 0, timber: 0, stone: 0, labor: 0 };
  const res: BuildCheck = { ok: false, reason: null, targetLevel: 0, cost: zero, days: 0, placement: null, upgrade: false };
  const s = world.settlements[settlementId];
  if (!s) return { ...res, reason: R.noSettlement };
  if (s.ownerFactionId !== factionId) return { ...res, reason: R.notOwned };
  if (!(BUILDING_TYPES as readonly string[]).includes(type)) return { ...res, reason: R.unknown };
  const def = BUILDINGS[type];
  const f = world.factions[factionId]!;
  const target = plannedLevel(s, type) + 1;
  res.targetLevel = target;
  res.upgrade = target > 1;
  res.cost = levelCost(type, target);
  res.days = levelDays(type, target);
  const age = buildingAge(type);
  if (ageIdx(f.age) < ageIdx(age)) return { ...res, reason: R.age(AGES[age].name) };
  if (!def.allowedIn.includes(s.kind)) return { ...res, reason: R.kind(s.kind) };
  for (const req of def.requires) if (!s.buildings.some((b) => b.type === req && b.level > 0)) return { ...res, reason: R.requires(BUILDINGS[req].name) };
  if (target > def.maxLevel) return { ...res, reason: R.maxLevel };
  if (target > buildingLevelCap(world, factionId, type)) return { ...res, reason: R.ageCap };
  if (s.construction.length >= C.maxQueue) return { ...res, reason: R.queueFull };
  if (!res.upgrade && footprintOf(type)?.placement !== 'perimeter') {
    if (cell) {
      const p = validatePlacement(world, settlementId, type, cell, rot);
      if (!p.ok) return { ...res, reason: p.reason };
      res.placement = { cell: [cell[0], cell[1]], rot };
    } else {
      const p = autoPlace(world, settlementId, type);
      if (!p) return { ...res, reason: PLACEMENT_REASONS.noRoom };
      res.placement = p;
    }
  }
  const afford = canAfford(world, factionId, res.cost);
  if (afford) return { ...res, reason: afford };
  res.ok = true;
  return res;
}

/** Queue a building / upgrade (pays wealth + materials now). Emits construction_started. */
export function queueBuild(world: WorldState, factionId: FactionId, settlementId: string, type: BuildingType, cell: GridCell | undefined, rot: Rotation | undefined, out: SimEvent[]): BuildCheck {
  const chk = validateBuild(world, factionId, settlementId, type, cell, rot ?? 0);
  if (!chk.ok) return chk;
  const s = world.settlements[settlementId]!;
  pay(world, factionId, chk.cost);
  const job: ConstructionJob = {
    type,
    targetLevel: chk.targetLevel,
    progress: 0,
    startedDay: today(world),
    laborAssigned: 0,
    paid: { ...chk.cost },
    crew: chk.cost.labor / chk.days,
  };
  if (chk.placement) {
    job.cell = chk.placement.cell;
    job.rot = chk.placement.rot;
  }
  s.construction.push(job);
  out.push({ kind: 'construction_started', settlementId, building: type, level: chk.targetLevel, landmarkId: null });
  return chk;
}

export interface LandmarkCheck {
  ok: boolean;
  reason: string | null;
  cost: MaterialCost;
  placement: { cell: GridCell; rot: Rotation } | null;
}

/** Can `landmarkId` be started at `settlementId` (requirements, exclusivity, site kind, placement, costs)? */
export function validateLandmark(world: WorldState, factionId: FactionId, landmarkId: string, settlementId: string, cell: GridCell | null | undefined, rot: Rotation = 0): LandmarkCheck {
  const R = CONSTRUCTION_REASONS;
  const lm: LandmarkDef | undefined = landmarkDef(landmarkId);
  const zero: MaterialCost = { wealth: 0, timber: 0, stone: 0, labor: 0 };
  if (!lm) return { ok: false, reason: R.landmarkUnknown, cost: zero, placement: null };
  const res: LandmarkCheck = { ok: false, reason: null, cost: { ...lm.cost }, placement: null };
  const f = world.factions[factionId];
  const s = world.settlements[settlementId];
  if (!f) return { ...res, reason: R.notOwned };
  if (!s) return { ...res, reason: R.noSettlement };
  if (s.ownerFactionId !== factionId) return { ...res, reason: R.notOwned };
  if (lm.factionId !== factionId) return { ...res, reason: AGE_REASONS.notYours };
  if (ageIdx(lm.age) !== ageIdx(f.age) + 1) return { ...res, reason: AGE_REASONS.wrongAge };
  if (landmarkChosenForAge(world, factionId, lm.age)) return { ...res, reason: AGE_REASONS.otherChosen };
  if (!ageChecklist(world, factionId).allMet) return { ...res, reason: AGE_REASONS.requirements };
  if (!lm.allowedIn.includes(s.kind)) return { ...res, reason: AGE_REASONS.kind(lm.allowedIn) };
  if (s.construction.length >= C.maxQueue) return { ...res, reason: R.queueFull };
  if (lm.footprint.placement !== 'perimeter') {
    if (cell) {
      const p = validatePlacement(world, settlementId, landmarkId, cell, rot);
      if (!p.ok) return { ...res, reason: p.reason };
      res.placement = { cell: [cell[0], cell[1]], rot };
    } else {
      const p = autoPlace(world, settlementId, landmarkId);
      if (!p) return { ...res, reason: PLACEMENT_REASONS.noRoom };
      res.placement = p;
    }
  }
  const afford = canAfford(world, factionId, res.cost);
  if (afford) return { ...res, reason: afford };
  res.ok = true;
  return res;
}

export function startLandmark(world: WorldState, factionId: FactionId, landmarkId: string, settlementId: string, cell: GridCell | null | undefined, rot: Rotation | undefined, out: SimEvent[]): LandmarkCheck {
  const chk = validateLandmark(world, factionId, landmarkId, settlementId, cell, rot ?? 0);
  if (!chk.ok) return chk;
  const lm = landmarkDef(landmarkId)!;
  const s = world.settlements[settlementId]!;
  pay(world, factionId, chk.cost);
  const job: ConstructionJob = {
    type: 'palace',
    targetLevel: 1,
    progress: 0,
    startedDay: today(world),
    laborAssigned: 0,
    landmarkId,
    paid: { ...chk.cost },
    crew: lm.cost.labor / lm.buildDays,
  };
  if (chk.placement) {
    job.cell = chk.placement.cell;
    job.rot = chk.placement.rot;
  }
  s.construction.push(job);
  out.push({ kind: 'landmark_started', factionId, settlementId, landmarkId });
  out.push({ kind: 'construction_started', settlementId, building: 'palace', level: 1, landmarkId });
  addChronicle(world, factionId, `Work began on ${lm.name} at ${s.name}.`, 1);
  return chk;
}

export interface RepairCheck {
  ok: boolean;
  reason: string | null;
  cost: MaterialCost;
}

export function validateRepair(world: WorldState, factionId: FactionId, settlementId: string, type: BuildingType): RepairCheck {
  const R = CONSTRUCTION_REASONS;
  const zero: MaterialCost = { wealth: 0, timber: 0, stone: 0, labor: 0 };
  const s = world.settlements[settlementId];
  if (!s) return { ok: false, reason: R.noSettlement, cost: zero };
  if (s.ownerFactionId !== factionId) return { ok: false, reason: R.notOwned, cost: zero };
  const b = s.buildings.find((x) => x.type === type);
  if (!b) return { ok: false, reason: R.notBuilt, cost: zero };
  if (b.condition >= 0.999) return { ok: false, reason: R.notDamaged, cost: zero };
  if (s.construction.some((j) => j.repair && j.type === type)) return { ok: false, reason: R.alreadyRepairing, cost: zero };
  if (s.construction.length >= C.maxQueue) return { ok: false, reason: R.queueFull, cost: zero };
  const lc = levelCost(type, b.level);
  const k = C.repairCostFactor * (1 - b.condition);
  const cost: MaterialCost = { wealth: lc.wealth * k, timber: lc.timber * k, stone: lc.stone * k, labor: lc.labor * k };
  const afford = canAfford(world, factionId, cost);
  return { ok: !afford, reason: afford, cost };
}

export function queueRepair(world: WorldState, factionId: FactionId, settlementId: string, type: BuildingType, out: SimEvent[]): RepairCheck {
  const chk = validateRepair(world, factionId, settlementId, type);
  if (!chk.ok) return chk;
  const s = world.settlements[settlementId]!;
  const b = s.buildings.find((x) => x.type === type)!;
  pay(world, factionId, chk.cost);
  s.construction.push({ type, targetLevel: b.level, progress: 0, startedDay: today(world), laborAssigned: 0, repair: true, paid: { ...chk.cost }, crew: nominalCrew(type, b.level) });
  out.push({ kind: 'construction_started', settlementId, building: type, level: b.level, landmarkId: null });
  return chk;
}

export interface CancelResult {
  ok: boolean;
  reason: string | null;
  refund: MaterialCost;
}

/** Cancel a job (queue index wins over type). Refunds paid x (1 - progress) x 0.9. */
export function cancelConstruction(world: WorldState, factionId: FactionId, settlementId: string, type: BuildingType, jobIndex: number | undefined, out: SimEvent[]): CancelResult {
  const R = CONSTRUCTION_REASONS;
  const zero: MaterialCost = { wealth: 0, timber: 0, stone: 0, labor: 0 };
  const s = world.settlements[settlementId];
  if (!s) return { ok: false, reason: R.noSettlement, refund: zero };
  if (s.ownerFactionId !== factionId) return { ok: false, reason: R.notOwned, refund: zero };
  let idx = -1;
  if (jobIndex !== undefined && jobIndex >= 0 && jobIndex < s.construction.length) idx = jobIndex;
  else {
    // Latest non-landmark job of that type (upgrades are cancelled from the end of the queue).
    for (let i = s.construction.length - 1; i >= 0; i--) {
      const j = s.construction[i]!;
      if (!j.landmarkId && j.type === type) {
        idx = i;
        break;
      }
    }
  }
  if (idx < 0) return { ok: false, reason: R.noJob, refund: zero };
  const job = s.construction[idx]!;
  if (job.landmarkId && job.progress >= RULES.ages.landmarkLockAt) return { ok: false, reason: R.landmarkLocked, refund: zero };
  const k = (1 - Math.min(1, job.progress)) * C.cancelRefund;
  const refund: MaterialCost = { wealth: job.paid.wealth * k, timber: job.paid.timber * k, stone: job.paid.stone * k, labor: 0 };
  const f = world.factions[factionId]!;
  f.treasury += refund.wealth;
  f.materials.timber += refund.timber;
  f.materials.stone += refund.stone;
  addMonthToDate(world, factionId, 'construction', -refund.wealth);
  s.construction.splice(idx, 1);
  notifyPlayer(world, out, factionId, 'info', `Construction cancelled at ${s.name}: ${Math.round(refund.wealth)} wealth refunded.`);
  return { ok: true, reason: null, refund };
}

// ---------------------------------------------------------------------------------------------------
// Daily progress
// ---------------------------------------------------------------------------------------------------

type EffectRunner = (world: WorldState, effects: readonly Effect[], scope: EventScope, out: SimEvent[]) => void;
let effectRunner: EffectRunner | null = null;
/** events.ts registers the effect DSL runner (landmark onComplete effects) - avoids an import cycle. */
export function registerEffectRunner(fn: EffectRunner): void {
  effectRunner = fn;
}

function monsoonFactor(world: WorldState, job: ConstructionJob): number {
  if (seasonOf(world.calendar) !== 'varsha') return 1;
  if (!job.landmarkId && (job.type === 'housing' || job.type === 'workshop')) return 1;
  return C.monsoonFactor;
}

/**
 * Advance a settlement's jobs by one day; returns idle builders (they repair infrastructure and damage).
 * Paused while the owner's treasury is negative.
 */
export function progressConstruction(world: WorldState, s: SettlementState, out: SimEvent[]): number {
  const builders = buildersOf(s);
  const owner = s.ownerFactionId ? world.factions[s.ownerFactionId] : null;
  if (s.construction.length === 0) return builders;
  if (!owner) return builders;
  if (owner.treasury < 0) {
    for (const j of s.construction) j.laborAssigned = 0;
    return 0;
  }
  let remaining = builders;
  const speed = factionMod(world, owner.id, 'constructionSpeed');
  const done: number[] = [];
  for (let i = 0; i < s.construction.length; i++) {
    const job = s.construction[i]!;
    if (i >= C.parallelJobs || remaining <= 0) {
      job.laborAssigned = 0;
      continue;
    }
    const crew = jobCrew(job);
    const assigned = Math.min(remaining, C.maxCrewRatio * crew);
    remaining -= assigned;
    job.laborAssigned = assigned;
    job.progress += (Math.min(C.maxCrewRatio, assigned / crew) / jobDays(job)) * speed * monsoonFactor(world, job);
    if (job.progress >= 1) done.push(i);
  }
  for (let k = done.length - 1; k >= 0; k--) {
    const job = s.construction.splice(done[k]!, 1)[0]!;
    completeJob(world, s, job, out);
  }
  return remaining;
}

function completeJob(world: WorldState, s: SettlementState, job: ConstructionJob, out: SimEvent[]): void {
  const owner = s.ownerFactionId;
  if (job.landmarkId) {
    completeLandmark(world, s, job, out);
    return;
  }
  if (job.repair) {
    const b = s.buildings.find((x) => x.type === job.type);
    if (b) b.condition = 1;
    out.push({ kind: 'construction_complete', settlementId: s.id, building: job.type, level: job.targetLevel });
    return;
  }
  const existing = s.buildings.find((b) => b.type === job.type);
  if (existing) {
    existing.level = Math.max(existing.level, job.targetLevel);
    existing.condition = 1;
  } else {
    const b: SettlementState['buildings'][number] = { type: job.type, level: job.targetLevel, condition: 1 };
    if (job.cell) {
      b.cell = job.cell;
      b.rot = job.rot ?? 0;
    }
    s.buildings.push(b);
  }
  if (BUILDINGS[job.type].effects.fortLevel) {
    const before = s.fortLevel;
    updateFortifications(world, s);
    s.wallHp += Math.max(0, s.fortLevel - before) * RULES.siege.wallHpPerLevel * factionMod(world, owner, 'fortDefense');
    s.wallHp = Math.min(s.wallHp, maxWallHp(world, s));
  }
  addStat(world, owner, 'buildings_completed', 1);
  out.push({ kind: 'construction_complete', settlementId: s.id, building: job.type, level: job.targetLevel });
  notifyPlayer(world, out, owner, 'success', `${BUILDINGS[job.type].name}${job.targetLevel > 1 ? ` (level ${job.targetLevel})` : ''} complete at ${s.name}.`, { x: s.x, z: s.z });
}

/** Landmark completion: instance, faction landmark list, age switch, onComplete effects. */
export function completeLandmark(world: WorldState, s: SettlementState, job: ConstructionJob, out: SimEvent[]): void {
  const lm = landmarkDef(job.landmarkId as string);
  const fid = s.ownerFactionId;
  if (!lm || !fid) return;
  const f = world.factions[fid]!;
  const inst: SettlementState['landmarks'][number] = { id: lm.id, builtBy: fid, completedDay: today(world), condition: 1 };
  if (job.cell) {
    inst.cell = job.cell;
    inst.rot = job.rot ?? 0;
  }
  s.landmarks.push(inst);
  if (!f.landmarks.includes(lm.id)) f.landmarks.push(lm.id);
  addStat(world, fid, 'landmarks', 1);
  addStat(world, fid, 'buildings_completed', 1);
  out.push({ kind: 'construction_complete', settlementId: s.id, building: 'palace', level: 1 });
  let advanced = false;
  if (ageIdx(lm.age) === ageIdx(f.age) + 1) {
    f.age = lm.age;
    advanced = true;
    addStat(world, fid, 'ages_advanced', 1);
  }
  if (effectRunner && lm.onComplete.length) effectRunner(world, lm.onComplete, { factionId: fid, settlementId: s.id, provinceId: s.provinceId, characterId: null, armyId: null }, out);
  updateFortifications(world, s);
  if (advanced) {
    out.push({ kind: 'age_advanced', factionId: fid, age: lm.age, landmarkId: lm.id, settlementId: s.id });
    addChronicle(world, fid, `${lm.name} was completed at ${s.name}; ${f.name} entered the ${AGES[lm.age].name}.`, 2);
    notifyPlayer(world, out, fid, 'success', `${lm.name} complete - the ${AGES[lm.age].name} begins!`, { x: s.x, z: s.z });
  } else {
    addChronicle(world, fid, `${lm.name} was completed at ${s.name}.`, 1);
  }
}

// ---------------------------------------------------------------------------------------------------
// Fortifications
// ---------------------------------------------------------------------------------------------------

export function maxWallHp(world: WorldState, s: SettlementState): number {
  return s.fortLevel * RULES.siege.wallHpPerLevel * factionMod(world, s.ownerFactionId, 'fortDefense');
}

/** Recompute fortLevel and clamp wallHp to its maximum. */
export function updateFortifications(world: WorldState, s: SettlementState): void {
  s.fortLevel = fortLevelOf(world, s, naturalFortLevel(s.id));
  const max = maxWallHp(world, s);
  if (s.wallHp > max) s.wallHp = max;
}

/** Daily wall repair (2% of max per day while not besieged). */
export function repairWallsDaily(world: WorldState, s: SettlementState): void {
  updateFortifications(world, s);
  if (s.besiegedBy) return;
  const max = maxWallHp(world, s);
  if (s.wallHp < max) s.wallHp = Math.min(max, s.wallHp + 0.02 * max);
}
