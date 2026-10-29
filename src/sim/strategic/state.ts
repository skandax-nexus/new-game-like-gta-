/**
 * Shared strategic-sim helpers with no dependency on the other strategic modules (breaks import cycles).
 * OWNER: Simulation Engineer - Strategic World Simulation (SIM-01, AI & Simulation team).
 *
 * Contents: world RNG binding, day/flag/statistics helpers, chronicle + battle history bookkeeping, player
 * notifications, static region lookups (settlement defs, natural fort level, base housing) and an
 * allocation-free stable key cache for hot hourly loops. Pure, deterministic, three-free.
 */
import type {
  ArmyState,
  BattleOutcome,
  FactionId,
  FactionState,
  SettlementDef,
  SettlementId,
  SettlementState,
  SimEvent,
  Vec2,
  WorldState,
} from '../../core/types';
import { BATTLE_HISTORY_LIMIT, CHRONICLE_LIMIT } from '../../core/constants';
import { relationKey, sortedKeys } from '../../core/ids';
import { isRebelFaction } from '../../core/types';
import { Rng } from '../../core/rng';
import { BUILDINGS } from '../../data/buildings';
import { REGION } from '../../data/region';
import { totalDays } from './seasons';

// ---------------------------------------------------------------------------------------------------
// RNG + time
// ---------------------------------------------------------------------------------------------------

/** Run `fn` with an Rng bound to world.rng and write the advanced state back. */
export function withWorldRng<T>(world: WorldState, fn: (rng: Rng) => T): T {
  const rng = new Rng(world.rng);
  const r = fn(rng);
  world.rng = rng.getState();
  return r;
}

/** One uniform draw from the world RNG (no closure allocation). */
export function worldRandom(world: WorldState): number {
  const rng = new Rng(world.rng);
  const v = rng.next();
  rng.saveTo(world.rng);
  return v;
}

/** Whole days since the start of the game (the "day" every rule refers to). */
export function today(world: WorldState): number {
  return totalDays(world.calendar);
}

// ---------------------------------------------------------------------------------------------------
// Chronicle, history, notifications, statistics
// ---------------------------------------------------------------------------------------------------

export function addChronicle(world: WorldState, factionId: FactionId | null, text: string, importance: 0 | 1 | 2 = 1): void {
  world.chronicle.push({ day: totalDays(world.calendar), factionId, text, importance });
  if (world.chronicle.length > CHRONICLE_LIMIT) world.chronicle.splice(0, world.chronicle.length - CHRONICLE_LIMIT);
}

export function pushBattleHistory(world: WorldState, outcome: BattleOutcome): void {
  if (world.battleHistory.includes(outcome)) return;
  world.battleHistory.push(outcome);
  if (world.battleHistory.length > BATTLE_HISTORY_LIMIT) world.battleHistory.splice(0, world.battleHistory.length - BATTLE_HISTORY_LIMIT);
}

/** Push a notification for the player only (AI factions read state, not toasts). */
export function notifyPlayer(
  world: WorldState,
  out: SimEvent[],
  factionId: FactionId | null,
  severity: 'info' | 'warning' | 'danger' | 'success',
  text: string,
  focus: Vec2 | null = null,
): void {
  if (factionId !== null && !world.factions[factionId]?.isPlayer) return;
  out.push({ kind: 'notification', factionId, severity, text, focus });
}

/** Add to a WorldState.statistics counter (END_GAME_STATS ids + SIM-01 helper counters). */
export function addStat(world: WorldState, factionId: FactionId | null | undefined, key: string, delta: number): void {
  if (!factionId || !world.factions[factionId]) return;
  const row = (world.statistics[factionId] ??= {});
  row[key] = (row[key] ?? 0) + delta;
}

/** Raise a WorldState.statistics counter to at least `value` (peaks, largest battle). */
export function maxStat(world: WorldState, factionId: FactionId | null | undefined, key: string, value: number): void {
  if (!factionId || !world.factions[factionId]) return;
  const row = (world.statistics[factionId] ??= {});
  if ((row[key] ?? 0) < value) row[key] = value;
}

export function getStat(world: WorldState, factionId: FactionId, key: string): number {
  return world.statistics[factionId]?.[key] ?? 0;
}

/** Month-to-date ledger accumulators live in statistics under this prefix (reset at the month rollover). */
export const MTD_PREFIX = 'mtd_';
export function addMonthToDate(world: WorldState, factionId: FactionId | null, key: 'construction' | 'recruitment' | 'other_income' | 'other_cost' | 'market', delta: number): void {
  addStat(world, factionId, MTD_PREFIX + key, delta);
}

/** Pay wealth from a faction treasury (no checks). */
export function spendWealth(world: WorldState, factionId: FactionId, amount: number): void {
  const f = world.factions[factionId];
  if (f) f.treasury -= amount;
}

// ---------------------------------------------------------------------------------------------------
// Static region lookups (never stored in state; derived from data/region.ts)
// ---------------------------------------------------------------------------------------------------

const DEF_BY_ID: ReadonlyMap<SettlementId, SettlementDef> = new Map(REGION.settlements.map((d) => [d.id, d]));

export function settlementDef(id: SettlementId): SettlementDef | undefined {
  return DEF_BY_ID.get(id);
}

/** Population the settlement was founded with (housing = pop0 x 1.1 + building housing, DESIGN_SPEC §7.2). */
export function foundingPopulation(s: SettlementState): number {
  return DEF_BY_ID.get(s.id)?.population ?? Math.max(50, s.population);
}

/**
 * Natural fort levels of the site (hilltops, river forts): the region's starting fortLevel minus what its starting
 * walls provide. Giridurg: fort 3 with Walls 2 -> 1 natural level (DESIGN_SPEC §3.3, §7.8: 3 x 1,000 x 1.4 = 4,200).
 */
export function naturalFortLevel(id: SettlementId): number {
  const def = DEF_BY_ID.get(id);
  if (!def) return 0;
  let walls = 0;
  for (const b of def.buildings) walls += (BUILDINGS[b.type].effects.fortLevel ?? 0) * b.level;
  return Math.max(0, def.fortLevel - walls);
}

// ---------------------------------------------------------------------------------------------------
// Iteration helpers
// ---------------------------------------------------------------------------------------------------

interface KeyCache {
  rec: object;
  keys: string[];
}
const keyCaches = new Map<string, KeyCache>();

/**
 * Sorted keys of a record, cached by `slot` and re-validated without allocating: the cached list is reused while
 * every cached key is still present and the record holds the same number of keys (counted with for-in). Use in
 * hourly hot loops (armies); daily code can use sortedKeys() directly.
 */
export function stableKeys(slot: string, rec: Record<string, unknown>): readonly string[] {
  const c = keyCaches.get(slot);
  if (c && c.rec === rec) {
    let n = 0;
    for (const k in rec) {
      void k;
      n++;
    }
    if (n === c.keys.length) {
      let same = true;
      for (let i = 0; i < c.keys.length; i++) {
        if (!((c.keys[i] as string) in rec)) {
          same = false;
          break;
        }
      }
      if (same) return c.keys;
    }
  }
  const keys = sortedKeys(rec);
  keyCaches.set(slot, { rec, keys });
  return keys;
}

/** Owned settlements of a faction in stable id order (allocates; daily/monthly code). */
export function ownedSettlements(world: WorldState, factionId: FactionId): SettlementState[] {
  const out: SettlementState[] = [];
  for (const id of sortedKeys(world.settlements)) {
    const s = world.settlements[id] as SettlementState;
    if (s.ownerFactionId === factionId) out.push(s);
  }
  return out;
}

export function livingFactions(world: WorldState): FactionState[] {
  const out: FactionState[] = [];
  for (const id of sortedKeys(world.factions)) {
    const f = world.factions[id] as FactionState;
    if (f.alive) out.push(f);
  }
  return out;
}

export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

/** Clamp helper (inline-friendly). */
export function clampN(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ---------------------------------------------------------------------------------------------------
// Hostility (wars + rebels, DESIGN_SPEC §7.9: rebels are hostile only to the owner of their settlement)
// ---------------------------------------------------------------------------------------------------

/** Faction-level war check (no rebels). */
export function atWarWith(world: WorldState, a: FactionId, b: FactionId): boolean {
  if (a === b) return false;
  return world.diplomacy.relations[relationKey(a, b)]?.atWar ?? false;
}

/** Owner a rebel army fights (null when it is not a rebel army or its settlement is gone). */
export function rebelTarget(world: WorldState, army: ArmyState): FactionId | null {
  if (!isRebelFaction(army.factionId) || !army.rebelSettlementId) return null;
  return world.settlements[army.rebelSettlementId]?.ownerFactionId ?? null;
}

/** Is `army` an enemy of faction `factionId`? */
export function hostileToArmy(world: WorldState, factionId: FactionId | null, army: ArmyState): boolean {
  if (!factionId) return false;
  if (army.factionId === factionId) return false;
  if (isRebelFaction(army.factionId)) return rebelTarget(world, army) === factionId;
  if (isRebelFaction(factionId)) return false;
  return atWarWith(world, factionId, army.factionId);
}

/** Are two armies enemies (wars, rebels vs the owner of their settlement)? */
export function armiesHostile(world: WorldState, a: ArmyState, b: ArmyState): boolean {
  if (a.factionId === b.factionId) return false;
  if (isRebelFaction(a.factionId)) return rebelTarget(world, a) === b.factionId;
  if (isRebelFaction(b.factionId)) return rebelTarget(world, b) === a.factionId;
  return atWarWith(world, a.factionId, b.factionId);
}
