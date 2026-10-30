/**
 * Versioned save/load + state hashing. OWNER: CTO (save format v2 + migration by CORE-01).
 *
 * Format: JSON text of `SaveGame` (see types.ts) with:
 *   - `format: 'samrajya-save'`, `version: SAVE_VERSION`
 *   - typed arrays encoded as { "$ta": "<Type>", "b64": "<base64>" } (if any appear)
 *   - non-finite numbers encoded as { "$num": "Infinity" | "-Infinity" | "NaN" }
 * Loading runs registered migrations v(n) -> v(n+1) until SAVE_VERSION, then validates the shape
 * (`describeSaveProblems`: every Contracts v2 field present with the right type, no rebel faction entry).
 *
 * Migrations: v1 -> v2 (Contracts v2, Sprint 1) adds every new persistent field with the same value a fresh
 * v2 world/battle would hold, computed from content where it depends on it (faction starting age and materials,
 * settlement owner at game start, scenario monsoon) - so this module reads src/data/** (campaign, factions,
 * region, balance). It is purely additive: every v1 value is kept (tests/contracts/migration.test.ts).
 * v2 -> v3 (GP-01 requests) seeds FormationState.routedEnemies of every battle from its log's rout credits.
 *
 * Storage: `SaveStore` abstraction - LocalStorageSaveStore in the browser, MemorySaveStore in tests.
 * The sim never reads wall-clock time; `meta.createdAt` is informational only.
 */
import type {
  AgeId,
  BattleEventRecord,
  BattleOutcome,
  BattleState,
  CouncilSeat,
  FactionId,
  SaveGame,
  SaveMeta,
  SaveSlotInfo,
  WorldState,
} from './types';
import { AGE_IDS, COUNCIL_SEATS, REBEL_FACTION_ID } from './types';
import { SAVE_VERSION, STORAGE_PREFIX, WORLD_SCHEMA_VERSION } from './constants';
import { SCENARIOS } from '../data/campaign';
import { FACTIONS } from '../data/factions';
import { REGION } from '../data/region';
import { BALANCE } from '../data/balance';
import { RULES } from '../data/rules';

// ---------------------------------------------------------------------------------------------
// Base64 (works in browser and node without Buffer)
// ---------------------------------------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = (() => {
  const t = new Uint8Array(128);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==';
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64_LOOKUP[clean.charCodeAt(i)];
    const b = B64_LOOKUP[clean.charCodeAt(i + 1)];
    const c = i + 2 < clean.length ? B64_LOOKUP[clean.charCodeAt(i + 2)] : 0;
    const d = i + 3 < clean.length ? B64_LOOKUP[clean.charCodeAt(i + 3)] : 0;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// JSON with typed arrays + non-finite numbers
// ---------------------------------------------------------------------------------------------

type TypedArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;

const TA_CTORS: Record<string, new (buf: ArrayBuffer) => TypedArray> = {
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
};

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return { $num: Number.isNaN(value) ? 'NaN' : value > 0 ? 'Infinity' : '-Infinity' };
  }
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const ta = value as TypedArray;
    const bytes = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
    return { $ta: ta.constructor.name, b64: bytesToBase64(bytes) };
  }
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v.$num === 'string') {
      return v.$num === 'NaN' ? NaN : v.$num === 'Infinity' ? Infinity : -Infinity;
    }
    if (typeof v.$ta === 'string' && typeof v.b64 === 'string') {
      const Ctor = TA_CTORS[v.$ta];
      if (!Ctor) throw new SaveError(`Unknown typed array ${v.$ta}`);
      const bytes = base64ToBytes(v.b64);
      const copy = new Uint8Array(bytes.length);
      copy.set(bytes);
      return new Ctor(copy.buffer);
    }
  }
  return value;
}

/** JSON.stringify with typed-array + Infinity support (stable for a given object shape). */
export function encodeJson(value: unknown, pretty = false): string {
  return JSON.stringify(value, replacer, pretty ? 2 : undefined);
}

export function decodeJson<T = unknown>(text: string): T {
  return JSON.parse(text, reviver) as T;
}

/** Deep clone of plain sim state (structured, preserves typed arrays). */
export function cloneState<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return decodeJson<T>(encodeJson(value));
}

// ---------------------------------------------------------------------------------------------
// Hashing (determinism tests, save integrity)
// ---------------------------------------------------------------------------------------------

/** FNV-1a 32-bit over a string -> 8 hex chars. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Canonical JSON with sorted object keys (so key insertion order never changes the hash). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value, new WeakSet()), replacer);
}

function sortKeysDeep(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value)) return value;
  if (seen.has(value)) throw new SaveError('Cyclic state cannot be serialized');
  seen.add(value);
  let out: unknown;
  if (Array.isArray(value)) {
    out = value.map((v) => sortKeysDeep(v, seen));
  } else {
    const obj = value as Record<string, unknown>;
    const res: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      const v = obj[k];
      if (v !== undefined) res[k] = sortKeysDeep(v, seen);
    }
    out = res;
  }
  seen.delete(value);
  return out;
}

/** Hash of any plain state object (WorldState / BattleState). Equal states => equal hashes. */
export function hashState(value: unknown): string {
  return fnv1a(canonicalJson(value));
}

// ---------------------------------------------------------------------------------------------
// Save format + migrations
// ---------------------------------------------------------------------------------------------

export class SaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveError';
  }
}

/** migrations[v] upgrades a raw save object from version v to v + 1. */
const migrations: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

/** Register a migration from `fromVersion` to `fromVersion + 1` (call at module init). */
export function registerMigration(fromVersion: number, fn: (raw: Record<string, unknown>) => Record<string, unknown>): void {
  migrations[fromVersion] = fn;
}

export function migrateSave(raw: Record<string, unknown>, targetVersion = SAVE_VERSION): Record<string, unknown> {
  let v = typeof raw.version === 'number' ? raw.version : 0;
  if (v > targetVersion) throw new SaveError(`Save version ${v} is newer than this build (${targetVersion})`);
  let cur = raw;
  while (v < targetVersion) {
    const m = migrations[v];
    if (!m) throw new SaveError(`No migration from save version ${v}`);
    cur = m(cur);
    v += 1;
    cur.version = v;
  }
  return cur;
}

/** Serialize a SaveGame to text. Adds a payload checksum line for integrity. */
export function serializeSave(game: SaveGame): string {
  const body = encodeJson({ ...game, format: 'samrajya-save', version: SAVE_VERSION });
  return `${body}\n#${fnv1a(body)}`;
}

/** Parse + verify + migrate + validate a save produced by serializeSave(). */
export function deserializeSave(text: string): SaveGame {
  const nl = text.lastIndexOf('\n#');
  let body = text;
  if (nl >= 0) {
    body = text.slice(0, nl);
    const sum = text.slice(nl + 2).trim();
    if (sum !== fnv1a(body)) throw new SaveError('Save file is corrupted (checksum mismatch)');
  }
  let raw: Record<string, unknown>;
  try {
    raw = decodeJson<Record<string, unknown>>(body);
  } catch (err) {
    throw new SaveError(`Save file is not valid JSON: ${(err as Error).message}`);
  }
  if (!raw || raw.format !== 'samrajya-save') throw new SaveError('Not a SAMRAJYA save file');
  try {
    const game = migrateSave(raw) as unknown as SaveGame;
    validateSave(game);
    return game;
  } catch (err) {
    // Migrations and the shape walk assume the v1 skeleton; a hand-edited / truncated file fails with a TypeError
    // there. Callers (session, import) handle SaveError only, so report it as one.
    if (err instanceof SaveError) throw err;
    throw new SaveError(`Save file is malformed: ${(err as Error).message}`);
  }
}

/** Structural validation of a current-version save (throws SaveError listing the first problems). */
export function validateSave(game: SaveGame): void {
  if (!game.meta || typeof game.meta.slot !== 'string') throw new SaveError('Save missing meta');
  if (!game.session || typeof game.session.mode !== 'string') throw new SaveError('Save missing session');
  if (game.world !== null) {
    const w = game.world;
    if (typeof w !== 'object' || !w.calendar || !w.factions || !w.settlements || !Array.isArray(w.rng)) {
      throw new SaveError('Save has a malformed world state');
    }
  }
  if (game.battle !== null) {
    const b = game.battle;
    if (typeof b !== 'object' || !Array.isArray(b.formations) || !b.setup) throw new SaveError('Save has a malformed battle state');
  }
  const problems = describeSaveProblems(game);
  if (problems.length) {
    throw new SaveError(`Save does not match format v${SAVE_VERSION}: ${problems.slice(0, 5).join('; ')}${problems.length > 5 ? ` (+${problems.length - 5} more)` : ''}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Contracts v2 shape check (also used by tests/contracts and QA tools)
// ---------------------------------------------------------------------------------------------

type Kind = 'number' | 'string' | 'boolean' | 'object' | 'array' | 'number|null' | 'string|null' | 'object|null';

function kindOk(v: unknown, kind: Kind): boolean {
  const nullable = kind.endsWith('|null');
  if (v === null) return nullable;
  const base = nullable ? kind.slice(0, -5) : kind;
  if (base === 'array') return Array.isArray(v);
  if (base === 'object') return typeof v === 'object' && !Array.isArray(v);
  return typeof v === base;
}

class ShapeChecker {
  readonly problems: string[] = [];
  need(o: unknown, path: string, fields: Readonly<Record<string, Kind>>): void {
    if (typeof o !== 'object' || o === null) {
      this.problems.push(`${path} is not an object`);
      return;
    }
    const rec = o as Record<string, unknown>;
    for (const [k, kind] of Object.entries(fields)) {
      if (!(k in rec)) this.problems.push(`${path}.${k} missing`);
      else if (!kindOk(rec[k], kind)) this.problems.push(`${path}.${k} is not ${kind}`);
    }
  }
  /** Optional members: absent is fine, present must have the right type. */
  may(o: unknown, path: string, fields: Readonly<Record<string, Kind>>): void {
    if (typeof o !== 'object' || o === null) return;
    const rec = o as Record<string, unknown>;
    for (const [k, kind] of Object.entries(fields)) {
      if (k in rec && !kindOk(rec[k], kind)) this.problems.push(`${path}.${k} is not ${kind}`);
    }
  }
}

const COST_FIELDS = { wealth: 'number', timber: 'number', stone: 'number', labor: 'number' } as const;

function checkOutcome(c: ShapeChecker, o: BattleOutcome, path: string): void {
  c.need(o, path, { warScore: 'number', chronicle: 'string', placeName: 'string|null', day: 'number|null' });
  (o.sides ?? []).forEach((s, i) => {
    c.need(s, `${path}.sides[${i}]`, { prisoners: 'number', routs: 'number', capturedSupply: 'number', commanderId: 'string|null' });
    (s.formations ?? []).forEach((f, j) => c.need(f, `${path}.sides[${i}].formations[${j}]`, { routedEnemies: 'number' }));
  });
}

function checkBattle(c: ShapeChecker, b: BattleState, path: string): void {
  c.need(b, path, { deploymentEndsAt: 'number', siege: 'object|null', works: 'array', phase: 'string' });
  if (b.phase !== 'deployment' && b.phase !== 'active' && b.phase !== 'ended') c.problems.push(`${path}.phase '${String(b.phase)}' unknown`);
  (b.setup?.sides ?? []).forEach((s, i) => c.need(s, `${path}.setup.sides[${i}]`, { aggression: 'number|null' }));
  (b.sides ?? []).forEach((s, i) => c.need(s, `${path}.sides[${i}]`, { rallyCooldownUntil: 'number', aiMemory: 'object' }));
  (b.formations ?? []).forEach((f, i) => {
    c.need(f, `${path}.formations[${i}]`, {
      rallies: 'number',
      shapeChangeUntil: 'number',
      panicUntil: 'number',
      rallyingUntil: 'number',
      disengageUntil: 'number',
      chargeRun: 'number',
      orderTime: 'number',
      hidden: 'boolean',
    });
    // Save v3. Optional until GP-01's makeFormation writes it (types.ts): fresh battles may still lack it.
    c.may(f, `${path}.formations[${i}]`, { routedEnemies: 'number' });
  });
  b.works.forEach((w, i) => c.need(w, `${path}.works[${i}]`, { maxHp: 'number', progress: 'number', formation: 'number' }));
  if (b.siege) {
    c.need(b.siege, `${path}.siege`, { segments: 'array', gates: 'array', towers: 'array', breaches: 'array', breachHold: 'object|null' });
  }
  if (b.outcome) checkOutcome(c, b.outcome, `${path}.outcome`);
}

function checkWorld(c: ShapeChecker, w: WorldState): void {
  if (w.schema !== WORLD_SCHEMA_VERSION) c.problems.push(`world.schema ${w.schema} != ${WORLD_SCHEMA_VERSION}`);
  if (REBEL_FACTION_ID in w.factions) c.problems.push(`world.factions must not contain the reserved '${REBEL_FACTION_ID}' faction`);
  c.need(w, 'world', { monsoon: 'object', statistics: 'object' });
  if (w.monsoon) c.need(w.monsoon, 'world.monsoon', { strength: 'number', year: 'number', forecast: 'number|null' });
  for (const [fid, f] of Object.entries(w.factions)) {
    const p = `world.factions.${fid}`;
    c.need(f, p, {
      age: 'string',
      landmarks: 'array',
      materials: 'object',
      policies: 'object',
      marketPrices: 'object',
      ghosts: 'object',
      counterIntel: 'number',
      counterIntelUntilDay: 'number|null',
      protectCourtUntilDay: 'number|null',
      advisorIgnored: 'object',
      councilAdvice: 'array',
      culturePoints: 'number',
      prosperityDays: 'number',
    });
    if (!(AGE_IDS as readonly string[]).includes(f.age)) c.problems.push(`${p}.age '${String(f.age)}' unknown`);
    c.need(f.materials, `${p}.materials`, { timber: 'number', stone: 'number' });
    c.need(f.policies, `${p}.policies`, { holdReserve: 'boolean', rationingUntilDay: 'number|null' });
    c.need(f.marketPrices, `${p}.marketPrices`, { grain: 'number', timber: 'number', stone: 'number' });
    c.need(f.advisorIgnored, `${p}.advisorIgnored`, Object.fromEntries(COUNCIL_SEATS.map((seat) => [seat, 'number' as const])));
    c.need(f.ai, `${p}.ai`, { memory: 'object' });
    if (!w.statistics || typeof w.statistics[fid] !== 'object') c.problems.push(`world.statistics.${fid} missing`);
  }
  for (const [sid, s] of Object.entries(w.settlements)) {
    const p = `world.settlements.${sid}`;
    c.need(s, p, {
      initialOwnerFactionId: 'string|null',
      occupiedSinceDay: 'number|null',
      pendingCapture: 'object|null',
      starvationDays: 'number',
      revoltSinceDay: 'number|null',
      taxRelief: 'object|null',
      reliefThisMonth: 'number',
      ladderProgress: 'number',
      landmarks: 'array',
    });
    c.need(s.kharif, `${p}.kharif`, { laborAtSowing: 'number' });
    c.need(s.rabi, `${p}.rabi`, { laborAtSowing: 'number' });
    s.construction.forEach((j, i) => {
      c.need(j, `${p}.construction[${i}]`, { paid: 'object', crew: 'number' });
      if (j.paid) c.need(j.paid, `${p}.construction[${i}].paid`, COST_FIELDS);
    });
  }
  for (const [id, a] of Object.entries(w.armies)) c.need(a, `world.armies.${id}`, { forcedMarch: 'boolean' });
  for (const [id, ch] of Object.entries(w.characters)) c.need(ch, `world.characters.${id}`, { captiveOf: 'string|null' });
  for (const [id, d] of Object.entries(w.depots)) c.need(d, `world.depots.${id}`, { readyOnDay: 'number' });
  for (const [k, r] of Object.entries(w.diplomacy.relations)) c.need(r, `world.diplomacy.relations.${k}`, { warWeariness: 'number', truceUntilDay: 'number|null' });
  for (const [o, row] of Object.entries(w.espionage.intel)) {
    for (const [t, i] of Object.entries(row)) c.need(i, `world.espionage.intel.${o}.${t}`, { armiesVisibleUntilDay: 'number|null' });
  }
  for (const [id, e] of Object.entries(w.engagements)) {
    c.need(e, `world.engagements.${id}`, { prisonerDecision: 'string|null' });
    if (e.battle) checkBattle(c, e.battle, `world.engagements.${id}.battle`);
    if (e.outcome) checkOutcome(c, e.outcome, `world.engagements.${id}.outcome`);
  }
  w.battleHistory.forEach((o, i) => checkOutcome(c, o, `world.battleHistory[${i}]`));
}

/**
 * Every way `game` differs from the current save format (empty = valid). Cheap (one pass, no allocation per
 * valid field beyond the walk); used by validateSave, the migration tests and QA tools.
 */
export function describeSaveProblems(game: SaveGame): string[] {
  const c = new ShapeChecker();
  if (game.version !== SAVE_VERSION) c.problems.push(`version ${game.version} != ${SAVE_VERSION}`);
  c.need(game.session, 'session', { hero: 'object|null' });
  if (game.world) checkWorld(c, game.world);
  if (game.battle) checkBattle(c, game.battle, 'battle');
  return c.problems;
}

// ---------------------------------------------------------------------------------------------
// Migration v1 -> v2 (Contracts v2, Sprint 1 / CORE-01)
// ---------------------------------------------------------------------------------------------

type Raw = Record<string, unknown>;

/** Set `key` only when absent: migrations never overwrite what a newer writer already stored. */
function fill<T extends object, K extends keyof T>(o: T, key: K, value: T[K]): void {
  if (!(key in o)) o[key] = value;
}

const ZERO_COST = (): { wealth: number; timber: number; stone: number; labor: number } => ({ wealth: 0, timber: 0, stone: 0, labor: 0 });

/** Faction age at game start: ScenarioDef.startingAges > FactionDef.startingAge > 'janapada' (DESIGN_SPEC §14.3). */
export function initialFactionAge(scenarioId: string | null, factionId: FactionId): AgeId {
  const scenario = scenarioId ? SCENARIOS[scenarioId] : undefined;
  return scenario?.startingAges?.[factionId] ?? FACTIONS[factionId]?.startingAge ?? 'janapada';
}

/** Owner of a settlement at game start, exactly as createWorld assigns it (null = independent). */
function initialOwner(w: WorldState, settlementId: string): FactionId | null {
  const def = REGION.settlements.find((d) => d.id === settlementId);
  if (!def) return null;
  const scenario = w.scenarioId ? SCENARIOS[w.scenarioId] : undefined;
  const inPlay = new Set<FactionId>(scenario ? scenario.factionIds : [w.playerFactionId, ...(w.sandbox?.rivalFactionIds ?? [])]);
  let owner: FactionId | null = def.defaultOwner;
  if (scenario && def.id in scenario.settlementOwners) owner = scenario.settlementOwners[def.id] ?? null;
  if (owner && !inPlay.has(owner)) owner = null;
  return owner;
}

/**
 * War score of a battle from side 0's perspective, exactly as v2 derives it from the casualties (BattleOutcome.warScore:
 * 20 x (side-1 losses - side-0 losses) / both starts, clamped to -20..20). `rounded`: the tactical outcome
 * (sim/tactical outcome.ts) stores it to 0.01; the strategic write-back (writeback.ts battleWarScore) stores it unrounded.
 */
function outcomeWarScore(o: BattleOutcome, rounded: boolean): number {
  const [s0, s1] = o.sides;
  const lost0 = s0.startSoldiers - s0.survivors;
  const lost1 = s1.startSoldiers - s1.survivors;
  const both = Math.max(1, s0.startSoldiers + s1.startSoldiers);
  const v = Math.max(-20, Math.min(20, (RULES.diplomacy.warScore.battlePerShare * (lost1 - lost0)) / both));
  return rounded ? Math.round(v * 100) / 100 : v;
}

/**
 * Enemy formations each formation routed, counted from the battle log the way the tactical outcome does
 * (formation_routed events crediting `other`). v1 logged `other: null`, so a real v1 log credits nobody.
 */
function routedCredits(events: readonly BattleEventRecord[] | null): Map<number, number> {
  const out = new Map<number, number>();
  for (const e of events ?? []) {
    if (e.kind !== 'formation_routed' || e.other === null || e.other < 0) continue;
    out.set(e.other, (out.get(e.other) ?? 0) + 1);
  }
  return out;
}

/**
 * Upgrade a v1 BattleOutcome in place. `battleLog` is the log of the battle that produced it (null when gone);
 * `tactical` = the outcome still sits on its BattleState (rounded war score) rather than in the world's history.
 */
function migrateOutcomeV1(o: BattleOutcome, setupSides: BattleState['setup']['sides'] | null, day: number | null, battleLog: readonly BattleEventRecord[] | null, tactical: boolean): void {
  fill(o, 'warScore', outcomeWarScore(o, tactical));
  fill(o, 'chronicle', o.summary?.[0] ?? '');
  fill(o, 'placeName', null);
  fill(o, 'day', day);
  const credits = routedCredits(battleLog);
  o.sides.forEach((s, i) => {
    const other = o.sides[i === 0 ? 1 : 0];
    fill(s, 'prisoners', other?.captured ?? 0);
    fill(s, 'routs', s.formations.filter((f) => f.routed).length);
    fill(s, 'capturedSupply', 0);
    fill(s, 'commanderId', setupSides?.[i]?.commanderId ?? null);
    for (const f of s.formations) fill(f, 'routedEnemies', credits.get(f.index) ?? 0);
  });
}

/**
 * Upgrade a v1 BattleState in place (skirmish saves and world engagements). Values a v1 battle never recorded take
 * what the v2 rules would hold at load time: the fighting began at the logged deployment end (else at
 * setup.deploymentSec, never after `time`), and once the fighting has begun every formation's current order starts
 * its v2 clocks (flank timeout, withdraw step-back) at load - as endDeployment / startOrder stamp `orderTime`.
 */
export function migrateBattleV1toV2(b: BattleState): void {
  const fighting = b.phase !== 'deployment';
  const ended = fighting ? b.events.find((e) => e.kind === 'deployment_ended') : undefined;
  fill(b, 'deploymentEndsAt', fighting ? Math.min(b.setup.deploymentSec, ended ? ended.time : b.time) : b.setup.deploymentSec);
  fill(b, 'siege', null);
  for (const s of b.setup.sides) fill(s, 'aggression', null);
  for (const s of b.sides) {
    fill(s, 'rallyCooldownUntil', 0);
    fill(s, 'aiMemory', {});
  }
  for (const f of b.formations) {
    fill(f, 'rallies', 0);
    fill(f, 'shapeChangeUntil', 0);
    fill(f, 'panicUntil', 0);
    fill(f, 'rallyingUntil', 0);
    fill(f, 'disengageUntil', 0);
    fill(f, 'chargeRun', 0);
    fill(f, 'orderTime', fighting ? b.time : 0);
    fill(f, 'hidden', false);
  }
  for (const wk of b.works) {
    fill(wk, 'maxHp', wk.hp);
    fill(wk, 'progress', 1);
    fill(wk, 'formation', -1);
  }
  if (b.outcome) migrateOutcomeV1(b.outcome, b.setup.sides, null, b.events, true);
}

/** Upgrade a v1 WorldState in place with the values a fresh v2 world would hold. */
export function migrateWorldV1toV2(w: WorldState): void {
  const today = Math.floor(w.calendar.totalHours / 24);
  const scenario = w.scenarioId ? SCENARIOS[w.scenarioId] : undefined;
  w.schema = WORLD_SCHEMA_VERSION;
  fill(w, 'monsoon', {
    strength: w.sandbox ? w.sandbox.monsoonStrength : scenario && w.calendar.year === scenario.startYear ? (scenario.monsoonStrength ?? 1) : 1,
    year: w.calendar.year,
    forecast: null,
  });
  fill(w, 'statistics', {});
  for (const fid of Object.keys(w.factions)) fill(w.statistics, fid, {});
  for (const [fid, f] of Object.entries(w.factions)) {
    fill(f, 'age', initialFactionAge(w.scenarioId, fid));
    fill(f, 'landmarks', []);
    fill(f, 'materials', { timber: scenario?.materials?.[fid]?.timber ?? 0, stone: scenario?.materials?.[fid]?.stone ?? 0 });
    fill(f, 'policies', { holdReserve: false, rationingUntilDay: null });
    fill(f, 'marketPrices', { grain: 1, timber: 1, stone: 1 });
    fill(f, 'ghosts', {});
    fill(f, 'counterIntel', 0);
    fill(f, 'counterIntelUntilDay', null);
    fill(f, 'protectCourtUntilDay', null);
    fill(f, 'advisorIgnored', Object.fromEntries(COUNCIL_SEATS.map((seat) => [seat, 0])) as Record<CouncilSeat, number>);
    fill(f, 'councilAdvice', []);
    fill(f, 'culturePoints', 0);
    fill(f, 'prosperityDays', 0);
    fill(f.ai, 'memory', {});
  }
  for (const s of Object.values(w.settlements)) {
    fill(s.kharif, 'laborAtSowing', 0);
    fill(s.rabi, 'laborAtSowing', 0);
    fill(s, 'initialOwnerFactionId', initialOwner(w, s.id));
    fill(s, 'occupiedSinceDay', null);
    fill(s, 'pendingCapture', null);
    fill(s, 'starvationDays', 0);
    // A v1 revolt starts its 30-day secession clock on load instead of seceding at once.
    fill(s, 'revoltSinceDay', s.rebellionStage === 'revolt' || s.rebellionStage === 'secession' ? today : null);
    fill(s, 'taxRelief', null);
    fill(s, 'reliefThisMonth', 0);
    fill(s, 'ladderProgress', 0);
    fill(s, 'landmarks', []);
    for (const job of s.construction) {
      fill(job, 'paid', ZERO_COST()); // v1 charged nothing
      fill(job, 'crew', 0); // 0 = derive from the definition
    }
  }
  for (const a of Object.values(w.armies)) fill(a, 'forcedMarch', false);
  for (const ch of Object.values(w.characters)) fill(ch, 'captiveOf', null);
  for (const d of Object.values(w.depots)) fill(d, 'readyOnDay', 0);
  const wearinessPerMonth = BALANCE.diplomacy.warWearinessPerMonth;
  for (const r of Object.values(w.diplomacy.relations)) {
    const months = r.atWar && r.warStartDay !== null ? Math.floor(Math.max(0, today - r.warStartDay) / 30) : 0;
    fill(r, 'warWeariness', months * wearinessPerMonth);
    fill(r, 'truceUntilDay', null);
  }
  for (const row of Object.values(w.espionage.intel)) for (const i of Object.values(row)) fill(i, 'armiesVisibleUntilDay', null);
  const dayOfBattle = new Map<string, number>();
  for (const e of Object.values(w.engagements)) {
    const day = Math.floor(e.startedHour / 24);
    fill(e, 'prisonerDecision', null);
    if (e.battle) migrateBattleV1toV2(e.battle);
    if (e.outcome) {
      migrateOutcomeV1(e.outcome, e.battle?.setup.sides ?? null, day, e.battle?.events ?? null, false);
      dayOfBattle.set(e.outcome.battleId, day);
    }
  }
  for (const o of w.battleHistory) migrateOutcomeV1(o, null, dayOfBattle.get(o.battleId) ?? null, null, false);
}

registerMigration(1, (raw: Raw): Raw => {
  const game = raw as unknown as SaveGame;
  if (game.world) migrateWorldV1toV2(game.world);
  if (game.battle) migrateBattleV1toV2(game.battle);
  if (game.session) fill(game.session, 'hero', game.session.scene === 'hero' ? { settlementId: null, missionId: null } : null);
  return raw;
});

// ---------------------------------------------------------------------------------------------
// Migration v2 -> v3 (GP-01 requests: live rout credits on the formation)
// ---------------------------------------------------------------------------------------------

/**
 * Upgrade a v2 BattleState in place: every formation's `routedEnemies` = the rout credits its log already holds
 * (formation_routed events crediting it as `other`) - exactly what the v2 outcome would have counted for the routs
 * so far, so a battle saved mid-fight keeps them once the outcome reads the live counter. A fresh battle (empty log)
 * gets 0, the creation default; a v1 log credits nobody, so v1 saves get 0. Idempotent (`fill`).
 */
export function migrateBattleV2toV3(b: BattleState): void {
  const credits = routedCredits(b.events);
  for (const f of b.formations) fill(f, 'routedEnemies', credits.get(f.index) ?? 0);
}

/** Upgrade a v2 WorldState in place (its engagements' battles; the world's own fields are unchanged). */
export function migrateWorldV2toV3(w: WorldState): void {
  for (const e of Object.values(w.engagements)) if (e.battle) migrateBattleV2toV3(e.battle);
}

registerMigration(2, (raw: Raw): Raw => {
  const game = raw as unknown as SaveGame;
  if (game.world) migrateWorldV2toV3(game.world);
  if (game.battle) migrateBattleV2toV3(game.battle);
  return raw;
});

// ---------------------------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------------------------

export interface SaveStore {
  list(): SaveSlotInfo[];
  write(slot: string, text: string, meta: SaveMeta): void;
  read(slot: string): string | null;
  remove(slot: string): void;
}

export class MemorySaveStore implements SaveStore {
  private data = new Map<string, { text: string; meta: SaveMeta }>();
  list(): SaveSlotInfo[] {
    return [...this.data.entries()]
      .map(([slot, v]) => ({ slot, meta: v.meta, sizeBytes: v.text.length }))
      .sort((a, b) => (a.meta.createdAt < b.meta.createdAt ? 1 : -1));
  }
  write(slot: string, text: string, meta: SaveMeta): void {
    this.data.set(slot, { text, meta });
  }
  read(slot: string): string | null {
    return this.data.get(slot)?.text ?? null;
  }
  remove(slot: string): void {
    this.data.delete(slot);
  }
}

/** localStorage-backed store: `samrajya.save.<slot>` + an index of metas. */
export class LocalStorageSaveStore implements SaveStore {
  private readonly indexKey = `${STORAGE_PREFIX}saves.index`;
  private slotKey(slot: string): string {
    return `${STORAGE_PREFIX}save.${slot}`;
  }
  private readIndex(): Record<string, { meta: SaveMeta; sizeBytes: number }> {
    try {
      const raw = localStorage.getItem(this.indexKey);
      return raw ? (JSON.parse(raw) as Record<string, { meta: SaveMeta; sizeBytes: number }>) : {};
    } catch {
      return {};
    }
  }
  private writeIndex(idx: Record<string, { meta: SaveMeta; sizeBytes: number }>): void {
    localStorage.setItem(this.indexKey, JSON.stringify(idx));
  }
  list(): SaveSlotInfo[] {
    const idx = this.readIndex();
    return Object.entries(idx)
      .map(([slot, v]) => ({ slot, meta: v.meta, sizeBytes: v.sizeBytes }))
      .sort((a, b) => (a.meta.createdAt < b.meta.createdAt ? 1 : -1));
  }
  write(slot: string, text: string, meta: SaveMeta): void {
    try {
      localStorage.setItem(this.slotKey(slot), text);
    } catch (err) {
      throw new SaveError(`Could not write save (storage full?): ${(err as Error).message}`);
    }
    const idx = this.readIndex();
    idx[slot] = { meta, sizeBytes: text.length };
    this.writeIndex(idx);
  }
  read(slot: string): string | null {
    try {
      return localStorage.getItem(this.slotKey(slot));
    } catch {
      return null;
    }
  }
  remove(slot: string): void {
    localStorage.removeItem(this.slotKey(slot));
    const idx = this.readIndex();
    delete idx[slot];
    this.writeIndex(idx);
  }
}

/** High-level save manager used by the session + UI. */
export class SaveManager {
  constructor(readonly store: SaveStore) {}

  list(): SaveSlotInfo[] {
    return this.store.list();
  }

  save(game: SaveGame): void {
    const text = serializeSave(game);
    this.store.write(game.meta.slot, text, game.meta);
  }

  load(slot: string): SaveGame {
    const text = this.store.read(slot);
    if (text === null) throw new SaveError(`No save in slot "${slot}"`);
    return deserializeSave(text);
  }

  remove(slot: string): void {
    this.store.remove(slot);
  }

  /** Text for a downloadable .samrajya file. */
  exportText(slot: string): string {
    const text = this.store.read(slot);
    if (text === null) throw new SaveError(`No save in slot "${slot}"`);
    return text;
  }

  /** Import a downloaded save file into a slot (validates first). */
  importText(text: string, slot?: string): SaveGame {
    const game = deserializeSave(text);
    if (slot) game.meta = { ...game.meta, slot };
    this.save(game);
    return game;
  }
}

/** Create the default store for the current environment. */
export function createDefaultSaveStore(): SaveStore {
  try {
    if (typeof localStorage !== 'undefined') {
      const k = `${STORAGE_PREFIX}probe`;
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return new LocalStorageSaveStore();
    }
  } catch {
    // fall through (private mode / disabled storage)
  }
  return new MemorySaveStore();
}
