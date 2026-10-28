/**
 * Versioned save/load + state hashing. Owned by the CTO.
 *
 * Format: JSON text of `SaveGame` (see types.ts) with:
 *   - `format: 'samrajya-save'`, `version: SAVE_VERSION`
 *   - typed arrays encoded as { "$ta": "<Type>", "b64": "<base64>" } (if any appear)
 *   - non-finite numbers encoded as { "$num": "Infinity" | "-Infinity" | "NaN" }
 * Loading runs registered migrations v(n) -> v(n+1) until SAVE_VERSION, then validates the shape.
 *
 * Storage: `SaveStore` abstraction - LocalStorageSaveStore in the browser, MemorySaveStore in tests.
 * The sim never reads wall-clock time; `meta.createdAt` is informational only.
 */
import type { SaveGame, SaveMeta, SaveSlotInfo } from './types';
import { SAVE_VERSION, STORAGE_PREFIX } from './constants';

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
  const migrated = migrateSave(raw);
  const game = migrated as unknown as SaveGame;
  validateSave(game);
  return game;
}

/** Shallow structural validation (throws SaveError). */
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
}

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
