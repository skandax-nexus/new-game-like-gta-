/**
 * Campaign AI core: the situation a realm plans from, its persistent memory, the decision journal and the command
 * buffer. OWNER: AI Engineer - Battle AI, Intents & Campaign AI (SIM-02).
 *
 * Rules the whole campaign AI follows (SIM-02 spec 4-5, W13):
 *  - It acts only through StrategicCommands (the same ones the player issues); the world validates and applies them.
 *    The only state it writes itself is its own `FactionState.ai` (goals, threat, memory, lastPlanHour) - plan memory
 *    that is saved and hashed like all state, so a reloaded game plans exactly like the uninterrupted one.
 *  - Deterministic: records iterated in sorted order, no randomness outside the world RNG (the AI uses none).
 *  - Cheap: heavy planning is staggered over the days (ai.ts schedule), every plan reads plain state.
 * The decision journal is a debug ring buffer outside the state (QA logs, the SIM-02 narrative); it never feeds a
 * decision.
 */
import type { AiPersonalityDef, ArmyState, DifficultyDef, FactionId, FactionLedger, FactionState, IssuedStrategicCommand, SettlementState, StrategicCommand, WorldState } from '../../../core/types';
import { REBEL_FACTION_ID } from '../../../core/types';
import { sortedKeys } from '../../../core/ids';
import { AI_PERSONALITY_DEFS, DIFFICULTY_DEFS } from '../../../data/difficulty';
import { armySoldiers, armyStrength } from '../armies';
import { factionStrength } from '../diplomacy';
import { garrisonSoldiers, reserveDays } from '../economy';
import { totalDays } from '../seasons';
import { atWarWith, hostileToArmy } from '../state';
import { supplyDays } from '../supply';

// ---------------------------------------------------------------------------------------------------
// Journal (debug log, not state)
// ---------------------------------------------------------------------------------------------------

export interface AiJournalEntry {
  day: number;
  factionId: FactionId;
  kind: 'war' | 'peace' | 'diplomacy' | 'economy' | 'build' | 'recruit' | 'age' | 'army' | 'spy' | 'rebels' | 'goal';
  text: string;
}

let journalLimit = 600;
const journal: AiJournalEntry[] = [];
let journalOn = true;

/** Record a decision in the debug journal (bounded ring; QA logs and the SIM-02 narrative). */
export function note(sit: Situation, kind: AiJournalEntry['kind'], text: string): void {
  if (!journalOn) return;
  journal.push({ day: sit.day, factionId: sit.fid, kind, text });
  if (journal.length > journalLimit + 100) journal.splice(0, journal.length - journalLimit);
}

/** The campaign AI's recent decisions (oldest first). */
export function aiJournal(): readonly AiJournalEntry[] {
  return journal;
}

/** Clear the journal (QA runs start fresh), optionally switch it off (perf measurements) or keep more entries. */
export function resetAiJournal(enabled = true, limit = 600): void {
  journal.length = 0;
  journalOn = enabled;
  journalLimit = Math.max(1, Math.floor(limit));
}

// ---------------------------------------------------------------------------------------------------
// Situation
// ---------------------------------------------------------------------------------------------------

export interface SettlementThreat {
  s: SettlementState;
  /** Strength of hostile armies bearing on it (distance-weighted within 2,000 m). */
  threat: number;
  /** Own strength at hand (garrison + own armies within 400 m). */
  defense: number;
  /** The nearest hostile army, if any within 2,000 m. */
  enemy: ArmyState | null;
  besieged: boolean;
}

export interface Situation {
  world: WorldState;
  fid: FactionId;
  f: FactionState;
  day: number;
  personality: AiPersonalityDef;
  difficulty: DifficultyDef;
  owned: SettlementState[];
  capital: SettlementState | null;
  realmPop: number;
  /** Own field armies (not garrison stand-ins, not in battle), sorted by id. */
  armies: ArmyState[];
  /** Soldiers in field armies and garrisons. */
  soldiers: number;
  /** factionStrength of every living faction. */
  strength: Record<FactionId, number>;
  /** Factions at war with this one. */
  enemies: FactionId[];
  threats: SettlementThreat[];
  /** War appetite bonus: difficulty aiAggressionBonus + sandbox slider (0.5 = as designed). */
  aggressionBonus: number;
  commands: IssuedStrategicCommand[];
  /** The projected month, computed on first use in a run (economy.ts). */
  ledger: FactionLedger | null;
}

/** Garrison stand-in armies (siege.ts `garrison_<id>`) are not field armies. */
export function isFieldArmy(a: ArmyState): boolean {
  return !a.id.startsWith('garrison_') && a.units.length > 0 && a.status !== 'disbanded' && a.status !== 'routed';
}

/** Build the situation of a living AI faction. */
export function situate(world: WorldState, fid: FactionId): Situation {
  const f = world.factions[fid]!;
  const personality = AI_PERSONALITY_DEFS[f.ai.personality] ?? AI_PERSONALITY_DEFS.opportunist;
  const difficulty = DIFFICULTY_DEFS[world.difficulty] ?? DIFFICULTY_DEFS.normal;
  const owned: SettlementState[] = [];
  let realmPop = 0;
  let soldiers = 0;
  for (const id of sortedKeys(world.settlements)) {
    const s = world.settlements[id]!;
    if (s.ownerFactionId !== fid) continue;
    owned.push(s);
    realmPop += s.population;
    soldiers += garrisonSoldiers(s);
  }
  const armies: ArmyState[] = [];
  for (const id of sortedKeys(world.armies)) {
    const a = world.armies[id]!;
    if (a.factionId !== fid) continue;
    soldiers += armySoldiers(a);
    if (isFieldArmy(a)) armies.push(a);
  }
  const strength: Record<FactionId, number> = {};
  const enemies: FactionId[] = [];
  for (const oid of sortedKeys(world.factions)) {
    const o = world.factions[oid]!;
    if (!o.alive) continue;
    strength[oid] = factionStrength(world, oid);
    if (oid !== fid && atWarWith(world, fid, oid)) enemies.push(oid);
  }
  const sandboxBonus = world.sandbox ? world.sandbox.aiAggression - 0.5 : 0;
  const sit: Situation = {
    world,
    fid,
    f,
    day: totalDays(world.calendar),
    personality,
    difficulty,
    owned,
    capital: f.capitalSettlementId ? (world.settlements[f.capitalSettlementId] ?? null) : null,
    realmPop,
    armies,
    soldiers,
    strength,
    enemies,
    threats: [],
    aggressionBonus: difficulty.aiAggressionBonus + sandboxBonus,
    commands: [],
    ledger: null,
  };
  sit.threats = assessThreats(sit);
  return sit;
}

/** Strength of a settlement's garrison units. */
export function garrisonStrength(s: SettlementState): number {
  if (s.garrison.length === 0) return 0;
  return armyStrength({ units: s.garrison } as unknown as ArmyState);
}

/**
 * Hostile armies (enemy realms and rebels against us) bearing on each owned settlement. No cheating: an army counts
 * only while the realm sees it (`visibility`), or one besieging its town; a lost one counts at its ghost (last seen
 * position, estimated soldiers) for the 5 days the ghost lasts. An army garrisoned in its own town threatens nobody.
 */
function assessThreats(sit: Situation): SettlementThreat[] {
  const { world, fid } = sit;
  const out: SettlementThreat[] = [];
  const hostile: { a: ArmyState; x: number; z: number; strength: number }[] = [];
  for (const id of sortedKeys(world.armies)) {
    const a = world.armies[id]!;
    if (a.units.length === 0 || a.status === 'disbanded') continue;
    if (!hostileToArmy(world, fid, a)) continue;
    // Behind its own walls it threatens nobody (it counts again when it marches out).
    if (a.status === 'garrisoned') continue;
    if ((a.visibility[fid] ?? 0) > 0 || a.status === 'besieging') {
      hostile.push({ a, x: a.x, z: a.z, strength: armyStrength(a) });
      continue;
    }
    const g = sit.f.ghosts[id];
    if (g) hostile.push({ a, x: g.x, z: g.z, strength: armyStrength(a) * (g.soldiers / Math.max(1, armySoldiers(a))) });
  }
  for (const s of sit.owned) {
    let threat = 0;
    let enemy: ArmyState | null = null;
    let bd = 2000 * 2000;
    for (const h of hostile) {
      const d2 = (h.x - s.x) * (h.x - s.x) + (h.z - s.z) * (h.z - s.z);
      if (d2 > 2000 * 2000) continue;
      const d = Math.sqrt(d2);
      threat += h.strength * (1 - d / 2400);
      if (d2 < bd) {
        bd = d2;
        enemy = h.a;
      }
    }
    let defense = garrisonStrength(s);
    for (const a of sit.armies) {
      const d2 = (a.x - s.x) * (a.x - s.x) + (a.z - s.z) * (a.z - s.z);
      if (d2 < 400 * 400) defense += armyStrength(a);
    }
    out.push({ s, threat, defense, enemy, besieged: s.besiegedBy !== null });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------------------------------

export function num(sit: Situation, key: string, def: number): number {
  const v = sit.f.ai.memory[key];
  return typeof v === 'number' ? v : def;
}

export function str(sit: Situation, key: string, def: string): string {
  const v = sit.f.ai.memory[key];
  return typeof v === 'string' ? v : def;
}

export function remember(sit: Situation, key: string, v: number | string | boolean): void {
  sit.f.ai.memory[key] = v;
}

export function forget(sit: Situation, key: string): void {
  delete sit.f.ai.memory[key];
}

/** True when `key` was stamped within the last `days` days (and stamps it when `stamp`). */
export function recently(sit: Situation, key: string, days: number): boolean {
  const d = sit.f.ai.memory[key];
  return typeof d === 'number' && sit.day - d < days;
}

// ---------------------------------------------------------------------------------------------------
// Commands and shared queries
// ---------------------------------------------------------------------------------------------------

export function issue(sit: Situation, cmd: StrategicCommand): void {
  sit.commands.push({ factionId: sit.fid, hour: 0, cmd });
}

export function dist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Monthly projected net: last month's ledger net (the sim's own number). */
export function monthlyNet(sit: Situation): number {
  return sit.f.ledger.net;
}

/** Lowest reserve days among owned settlements and the capital's. */
export function reserveDaysOf(s: SettlementState): number {
  const d = reserveDays(s);
  return Number.isFinite(d) ? d : 999;
}

/** The army's days of food on hand. */
export function armySupplyDays(world: WorldState, a: ArmyState): number {
  const d = supplyDays(world, a);
  return Number.isFinite(d) ? d : 999;
}

export function isRebel(id: FactionId): boolean {
  return id === REBEL_FACTION_ID;
}
