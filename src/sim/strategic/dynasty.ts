/**
 * Dynasty: aging, births, deaths, succession laws, regency, succession crises (DESIGN_SPEC §7.12).
 * OWNER: Simulation Engineer - Strategic World Simulation (SIM-01).
 *
 *  - Aging (new year): health -0.03/year from 50, -0.06 from 60, -0.12 from 70; health 0 = death.
 *  - Births (new year): married couples whose wife is 18-40 have a 10% chance of a child (dynasty of the parent of
 *    the ruling house; regional name; claim 0.5 for a ruler's or heir's child, else 0.2).
 *  - Death: vacates governorships, council seats, army commands; widows may remarry; a dead heir is replaced by the
 *    succession law's choice; a dead ruler triggers the succession.
 *  - Succession by SuccessionLaw: designated_heir (the heir) / primogeniture (eldest living child) /
 *    council_election (dynasty member or general with the highest martial + diplomacy + prestige / 10) / seniority
 *    (eldest adult of the dynasty); fallbacks: heir -> eldest child -> any dynasty member -> adopt a loyal general or
 *    governor (legitimacy -0.2) -> the line ends (sandbox player: defeat; AI and scenarios: a new house is raised).
 *    An heir under 16 rules through a regency (legitimacy -0.1). Crisis chance 0.35 x (1 - legitimacy) x (claimant ?
 *    2 : 1) (cap 0.9): the claimant's province revolts and he leads the rebels; legitimacy -0.05.
 *    dynasty.generation + 1.
 *  - designate_heir with validation.
 */
import type { CharacterState, DynastyState, FactionId, FactionState, GovernorInterest, SimEvent, SuccessionLaw, WorldState } from '../../core/types';
import { GOVERNOR_INTERESTS } from '../../core/types';
import { nextWorldId, sortedKeys } from '../../core/ids';
import { BALANCE } from '../../data/balance';
import { FACTIONS } from '../../data/factions';
import { NAME_POOLS, PERSON_NAMES } from '../../data/names';
import { RULES } from '../../data/rules';
import { forceRebellionStage, rebelArmiesOf } from './politics';
import { totalDays } from './seasons';
import { addChronicle, notifyPlayer, worldRandom } from './state';
import { registerWritebackHooks } from './writeback';

const DY = RULES.dynasty;

export const DYNASTY_REASONS = {
  noCharacter: 'No such person',
  notYours: 'Not one of your people',
  dead: 'That person is dead',
  captive: 'That person is a prisoner',
  ruler: 'The ruler cannot be the heir',
  already: 'Already the heir',
} as const;

export function characterAge(world: WorldState, c: CharacterState): number {
  return world.calendar.year - c.birthYear;
}

export function isAdult(world: WorldState, c: CharacterState): boolean {
  return characterAge(world, c) >= DY.adultAge;
}

/** Yearly health loss at an age (the highest band reached). */
export function agingHealthLoss(age: number): number {
  let loss = 0;
  for (const b of DY.aging) if (age >= b.from) loss = -b.healthPerYear;
  return loss;
}

function dynastyOf(world: WorldState, f: FactionState): DynastyState | null {
  return f.dynastyId ? (world.dynasties[f.dynastyId] ?? null) : null;
}

export function successionLaw(world: WorldState, f: FactionState): SuccessionLaw {
  return dynastyOf(world, f)?.successionLaw ?? 'primogeniture';
}

function living(world: WorldState, pred: (c: CharacterState) => boolean): CharacterState[] {
  const out: CharacterState[] = [];
  for (const id of sortedKeys(world.characters)) {
    const c = world.characters[id] as CharacterState;
    if (c.alive && !c.captiveOf && pred(c)) out.push(c);
  }
  return out;
}

/** Oldest first; ties by id. */
function byAge(a: CharacterState, b: CharacterState): number {
  return a.birthYear - b.birthYear || (a.id < b.id ? -1 : 1);
}

/** The successor the law names (null = none). Excludes `exclude` (the dead ruler). */
export function lawfulSuccessor(world: WorldState, factionId: FactionId, exclude: string | null = null): CharacterState | null {
  const f = world.factions[factionId];
  if (!f) return null;
  const dyn = dynastyOf(world, f);
  const ruler = f.rulerId ? world.characters[f.rulerId] : null;
  const ok = (c: CharacterState): boolean => c.id !== exclude && c.factionId === factionId;
  const heir = f.heirId ? world.characters[f.heirId] : null;
  const children = ruler ? living(world, (c) => ok(c) && c.parentIds.includes(ruler.id)).sort(byAge) : [];
  const members = dyn ? living(world, (c) => ok(c) && c.dynastyId === dyn.id && c.id !== ruler?.id).sort(byAge) : [];
  switch (successionLaw(world, f)) {
    case 'designated_heir':
      if (heir && heir.alive && !heir.captiveOf && ok(heir)) return heir;
      break;
    case 'primogeniture':
      if (children[0]) return children[0];
      break;
    case 'council_election': {
      const pool = living(world, (c) => ok(c) && c.id !== ruler?.id && isAdult(world, c) && (c.dynastyId === dyn?.id || c.roles.includes('general')));
      pool.sort((a, b) => b.skills.martial + b.skills.diplomacy + b.prestige / 10 - (a.skills.martial + a.skills.diplomacy + a.prestige / 10) || (a.id < b.id ? -1 : 1));
      if (pool[0]) return pool[0];
      break;
    }
    case 'seniority': {
      const adults = members.filter((c) => isAdult(world, c));
      if (adults[0]) return adults[0];
      break;
    }
  }
  if (heir && heir.alive && !heir.captiveOf && ok(heir)) return heir;
  if (children[0]) return children[0];
  if (members[0]) return members[0];
  return null;
}

/** Heir the law would name today (used to refill f.heirId except under designated_heir). */
function refreshHeir(world: WorldState, f: FactionState): void {
  const cur = f.heirId ? world.characters[f.heirId] : null;
  if (cur && cur.alive && cur.id !== f.rulerId) return;
  if (cur) cur.roles = cur.roles.filter((r) => r !== 'heir');
  f.heirId = null;
  const next = lawfulSuccessor(world, f.id, f.rulerId);
  if (next && successionLaw(world, f) !== 'designated_heir') setHeir(world, f, next);
  else if (next && successionLaw(world, f) === 'designated_heir' && next.parentIds.includes(f.rulerId ?? '')) setHeir(world, f, next);
}

function setHeir(world: WorldState, f: FactionState, c: CharacterState): void {
  const old = f.heirId ? world.characters[f.heirId] : null;
  if (old) old.roles = old.roles.filter((r) => r !== 'heir');
  f.heirId = c.id;
  if (!c.roles.includes('heir')) c.roles.push('heir');
}

export function validateDesignateHeir(world: WorldState, factionId: FactionId, characterId: string): string | null {
  const f = world.factions[factionId];
  const c = world.characters[characterId];
  if (!f || !c) return DYNASTY_REASONS.noCharacter;
  if (c.factionId !== factionId) return DYNASTY_REASONS.notYours;
  if (!c.alive) return DYNASTY_REASONS.dead;
  if (c.captiveOf) return DYNASTY_REASONS.captive;
  if (f.rulerId === c.id) return DYNASTY_REASONS.ruler;
  if (f.heirId === c.id) return DYNASTY_REASONS.already;
  return null;
}

export function designateHeir(world: WorldState, factionId: FactionId, characterId: string): string | null {
  const reason = validateDesignateHeir(world, factionId, characterId);
  if (reason) return reason;
  const f = world.factions[factionId] as FactionState;
  const c = world.characters[characterId] as CharacterState;
  setHeir(world, f, c);
  addChronicle(world, factionId, `${c.name} was named heir.`, 1);
  return null;
}

function namePool(world: WorldState, f: FactionState | undefined, gender: 'male' | 'female'): readonly string[] {
  const arch = f ? FACTIONS[f.id]?.archetype : undefined;
  const pool = arch ? NAME_POOLS[arch]?.[gender] : undefined;
  return pool && pool.length > 0 ? pool : PERSON_NAMES[gender];
}

function pick<T>(world: WorldState, list: readonly T[]): T {
  return list[Math.min(list.length - 1, Math.floor(worldRandom(world) * list.length))] as T;
}

/** A newborn (or a raised noble when a line ends). */
function newCharacter(world: WorldState, factionId: FactionId, dynastyId: string | null, birthYear: number, parents: string[]): CharacterState {
  const f = world.factions[factionId];
  const gender: 'male' | 'female' = worldRandom(world) < 0.5 ? 'male' : 'female';
  const skill = (): number => 3 + Math.floor(worldRandom(world) * 10);
  const c: CharacterState = {
    id: nextWorldId(world, 'char'),
    name: pick(world, namePool(world, f, gender)),
    dynastyId,
    factionId,
    gender,
    birthYear,
    alive: true,
    deathYear: null,
    health: 1,
    traits: [],
    skills: { martial: skill(), stewardship: skill(), diplomacy: skill(), intrigue: skill(), learning: skill() },
    roles: [],
    loyalty: 0.8,
    ambition: Math.round(worldRandom(world) * 100) / 100,
    interest: pick(world, GOVERNOR_INTERESTS) as GovernorInterest,
    opinionOfRuler: 50,
    spouseId: null,
    parentIds: parents,
    childIds: [],
    claim: 0.2,
    locationSettlementId: f?.capitalSettlementId ?? null,
    armyId: null,
    governsProvinceId: null,
    councilSeat: null,
    prestige: 0,
    captiveOf: null,
  };
  world.characters[c.id] = c;
  if (dynastyId && world.dynasties[dynastyId]) world.dynasties[dynastyId]!.memberIds.push(c.id);
  return c;
}

// ---------------------------------------------------------------------------------------------------
// Death and succession
// ---------------------------------------------------------------------------------------------------

/** A character dies (old age, battle, events). Vacates offices; heirs and rulers are replaced. */
export function handleDeath(world: WorldState, characterId: string, out: SimEvent[]): void {
  const c = world.characters[characterId];
  if (!c) return;
  const wasAlive = c.alive;
  c.alive = false;
  c.health = 0;
  if (c.deathYear === null) c.deathYear = world.calendar.year;
  if (wasAlive) out.push({ kind: 'character_died', characterId: c.id });
  // Offices.
  if (c.governsProvinceId) {
    const p = world.provinces[c.governsProvinceId];
    if (p && p.governorId === c.id) p.governorId = null;
    c.governsProvinceId = null;
  }
  const f = world.factions[c.factionId];
  if (f) {
    for (const seat of sortedKeys(f.council) as (keyof typeof f.council)[]) if (f.council[seat] === c.id) delete f.council[seat];
  }
  c.councilSeat = null;
  if (c.armyId) {
    const a = world.armies[c.armyId];
    if (a && a.commanderId === c.id) a.commanderId = null;
    c.armyId = null;
  }
  for (const id of sortedKeys(world.armies)) if (world.armies[id]!.commanderId === c.id) world.armies[id]!.commanderId = null;
  if (c.spouseId) {
    const sp = world.characters[c.spouseId];
    if (sp && sp.spouseId === c.id) sp.spouseId = null;
  }
  if (!f) return;
  if (f.rulerId === c.id) succession(world, f.id, out);
  else if (f.heirId === c.id) {
    f.heirId = null;
    refreshHeir(world, f);
    notifyPlayer(world, out, f.id, 'warning', `${c.name}, the heir, is dead.`);
  }
  if (wasAlive) addChronicle(world, c.factionId, `${c.name} died.`, f.rulerId === c.id || f.heirId === c.id ? 2 : 1);
}

registerWritebackHooks({ death: handleDeath });

/** A free, pressing claimant of the faction (role 'claimant', loyalty < 0.5). */
function claimantOf(world: WorldState, factionId: FactionId, exclude: string | null): CharacterState | null {
  return living(world, (c) => c.factionId === factionId && c.roles.includes('claimant') && c.id !== exclude && c.loyalty < 0.5)[0] ?? null;
}

/** Crisis chance: 0.35 x (1 - legitimacy) x (claimant ? 2 : 1), cap 0.9. */
export function crisisChance(world: WorldState, factionId: FactionId, newRulerId: string | null): number {
  const f = world.factions[factionId];
  if (!f) return 0;
  const claimant = claimantOf(world, factionId, newRulerId);
  return Math.min(DY.crisisCap, BALANCE.politics.successionCrisisChance * (1 - f.legitimacy) * (claimant ? 2 : 1));
}

/** The ruler is dead: the law names a successor (or a regency / adoption / a new house). */
export function succession(world: WorldState, factionId: FactionId, out: SimEvent[]): void {
  const f = world.factions[factionId];
  if (!f) return;
  const old = f.rulerId ? world.characters[f.rulerId] : null;
  if (old && old.alive) return;
  let next = lawfulSuccessor(world, factionId, old?.id ?? null);
  let adopted = false;
  if (!next) {
    // Adopt a loyal general or governor.
    const pool = living(world, (c) => c.factionId === factionId && isAdult(world, c) && c.loyalty >= 0.5 && (c.roles.includes('general') || c.roles.includes('governor')));
    pool.sort((a, b) => b.loyalty - a.loyalty || byAge(a, b));
    if (pool[0]) {
      next = pool[0];
      adopted = true;
      f.legitimacy = Math.max(0, f.legitimacy + DY.adoptedHeirLegitimacy);
    }
  }
  if (!next) {
    if (f.isPlayer && world.mode === 'sandbox') {
      world.victory.status = 'defeat';
      world.victory.outcomeId = 'line_ended';
      world.victory.endedDay = totalDays(world.calendar);
      addChronicle(world, factionId, `The line of ${f.name} ended.`, 2);
      out.push({ kind: 'scenario_ended', outcomeId: 'line_ended', result: 'defeat' });
      return;
    }
    // A new house takes the throne (AI realms and scenarios continue).
    next = newCharacter(world, factionId, f.dynastyId, world.calendar.year - 30, []);
    next.roles.push('general');
    adopted = true;
    f.legitimacy = Math.max(0, f.legitimacy + DY.adoptedHeirLegitimacy);
  }
  if (old) old.roles = old.roles.filter((r) => r !== 'ruler');
  next.roles = next.roles.filter((r) => r !== 'heir' && r !== 'claimant');
  if (!next.roles.includes('ruler')) next.roles.push('ruler');
  if (next.governsProvinceId) {
    const p = world.provinces[next.governsProvinceId];
    if (p && p.governorId === next.id) p.governorId = null;
    next.governsProvinceId = null;
    next.roles = next.roles.filter((r) => r !== 'governor');
  }
  f.rulerId = next.id;
  if (f.heirId === next.id) f.heirId = null;
  next.loyalty = 1;
  const dyn = dynastyOf(world, f);
  if (dyn) {
    dyn.headId = next.id;
    dyn.generation += 1;
    if (adopted && !dyn.memberIds.includes(next.id)) dyn.memberIds.push(next.id);
  }
  if (adopted && f.dynastyId) next.dynastyId = f.dynastyId;
  // Regency for a child.
  if (!isAdult(world, next)) {
    f.legitimacy = Math.max(0, f.legitimacy + DY.regencyLegitimacy);
    f.flags.regency_until_year = next.birthYear + DY.regencyBelowAge;
    addChronicle(world, factionId, `A regency council rules for the young ${next.name}.`, 1);
  }
  // Crisis.
  let crisis = false;
  const chance = crisisChance(world, factionId, next.id);
  if (chance > 0 && worldRandom(world) < chance) {
    crisis = true;
    f.legitimacy = Math.max(0, f.legitimacy + DY.newRulerLegitimacy);
    const claimant = claimantOf(world, factionId, next.id);
    const prov = claimant?.governsProvinceId ? world.provinces[claimant.governsProvinceId] : null;
    const seat = prov ? world.settlements[prov.capitalSettlementId] : claimant?.locationSettlementId ? world.settlements[claimant.locationSettlementId] : null;
    if (claimant && seat && seat.ownerFactionId === factionId && seat.id !== f.capitalSettlementId) {
      forceRebellionStage(world, seat, 'revolt', out);
      const host = rebelArmiesOf(world, seat.id)[0];
      if (host) {
        host.commanderId = claimant.id;
        host.name = `Host of ${claimant.name}`;
        claimant.armyId = host.id;
      }
      addChronicle(world, factionId, `${claimant.name} raised his banner at ${seat.name} against the new ruler.`, 2);
    }
  }
  refreshHeir(world, f);
  out.push({ kind: 'succession', factionId, newRulerId: next.id, crisis });
  addChronicle(world, factionId, `${next.name} succeeded to the throne of ${f.name}${crisis ? ' - and the realm is divided' : ''}.`, 2);
  notifyPlayer(world, out, factionId, crisis ? 'danger' : 'info', `${next.name} now rules${crisis ? '; a succession crisis has begun' : ''}.`);
}

/** Baseline-compatible name. */
export function checkSuccession(world: WorldState, factionId: FactionId, out: SimEvent[]): void {
  succession(world, factionId, out);
}

// ---------------------------------------------------------------------------------------------------
// Yearly: aging and births
// ---------------------------------------------------------------------------------------------------

export function updateCharactersYearly(world: WorldState, out: SimEvent[]): void {
  const year = world.calendar.year;
  // Aging and deaths.
  for (const id of sortedKeys(world.characters)) {
    const c = world.characters[id]!;
    if (!c.alive) continue;
    c.health = Math.max(0, c.health - agingHealthLoss(year - c.birthYear));
    if (c.health <= 0) handleDeath(world, c.id, out);
  }
  // Births: one roll per married couple with a wife of 18-40.
  const [lo, hi] = DY.fertileAges;
  for (const id of sortedKeys(world.characters)) {
    const c = world.characters[id]!;
    if (!c.alive || c.gender !== 'female' || !c.spouseId) continue;
    const h = world.characters[c.spouseId];
    if (!h || !h.alive || h.spouseId !== c.id) continue;
    const age = year - c.birthYear;
    if (age < lo || age > hi) continue;
    if (worldRandom(world) >= DY.birthChancePerYear) continue;
    // The child belongs to the ruling house of whichever parent has one (the father's otherwise).
    const fH = world.factions[h.factionId];
    const fC = world.factions[c.factionId];
    const houseParent = fC && c.dynastyId && c.dynastyId === fC.dynastyId && !(fH && h.dynastyId === fH.dynastyId) ? c : h;
    const child = newCharacter(world, houseParent.factionId, houseParent.dynastyId, year, [h.id, c.id]);
    h.childIds.push(child.id);
    c.childIds.push(child.id);
    const ruling = [h, c].some((p) => world.factions[p.factionId]?.rulerId === p.id || world.factions[p.factionId]?.heirId === p.id);
    child.claim = ruling ? 0.5 : 0.2;
    out.push({ kind: 'character_born', characterId: child.id });
    if (ruling) addChronicle(world, houseParent.factionId, `A child, ${child.name}, was born to ${h.name} and ${c.name}.`, 1);
    const f = world.factions[houseParent.factionId];
    if (f && !f.heirId) refreshHeir(world, f);
  }
  // Regencies end at the ruler's majority.
  for (const fid of sortedKeys(world.factions)) {
    const f = world.factions[fid]!;
    const until = f.flags.regency_until_year;
    if (typeof until === 'number' && year >= until) {
      delete f.flags.regency_until_year;
      addChronicle(world, fid, `The regency of ${f.name} ended.`, 1);
    }
  }
}
