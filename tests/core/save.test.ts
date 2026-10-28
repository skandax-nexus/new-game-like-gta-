import { describe, expect, it } from 'vitest';
import type { SaveGame } from '../../src/core/types';
import { MemorySaveStore, SaveError, SaveManager, decodeJson, deserializeSave, encodeJson, hashState, migrateSave, registerMigration, serializeSave } from '../../src/core/save';
import { SAVE_VERSION } from '../../src/core/constants';
import { createWorld } from '../../src/sim/strategic/world';

function makeSave(): SaveGame {
  const world = createWorld({ kind: 'scenario', scenarioId: 'broken_crown', seed: 5, difficulty: 'normal' });
  return {
    format: 'samrajya-save',
    version: SAVE_VERSION,
    meta: { slot: 'slot1', name: 'Test', mode: 'campaign', scene: 'world', playerFactionId: world.playerFactionId, calendar: { ...world.calendar }, createdAt: '2026-01-01T00:00:00.000Z', playtimeSec: 1, buildVersion: 'test', summary: 'test', thumbnail: null },
    session: { mode: 'campaign', scene: 'world', skirmish: null, activeEngagementId: null },
    world,
    battle: null,
  };
}

describe('save/load', () => {
  it('round-trips a full world losslessly', () => {
    const game = makeSave();
    const text = serializeSave(game);
    const back = deserializeSave(text);
    expect(hashState(back.world)).toBe(hashState(game.world));
    expect(back.meta).toEqual(game.meta);
  });

  it('round-trips typed arrays and non-finite numbers', () => {
    const v = { a: new Float32Array([1.5, -2, 3]), b: new Uint16Array([7, 65535]), c: Infinity, d: -Infinity, e: [NaN] };
    const back = decodeJson<typeof v>(encodeJson(v));
    expect(back.a).toBeInstanceOf(Float32Array);
    expect(Array.from(back.a)).toEqual([1.5, -2, 3]);
    expect(Array.from(back.b)).toEqual([7, 65535]);
    expect(back.c).toBe(Infinity);
    expect(back.d).toBe(-Infinity);
    expect(Number.isNaN(back.e[0])).toBe(true);
  });

  it('detects corruption', () => {
    const text = serializeSave(makeSave());
    const broken = text.replace('"Test"', '"Tost"');
    expect(() => deserializeSave(broken)).toThrow(SaveError);
    expect(() => deserializeSave('{"format":"other"}')).toThrow(SaveError);
  });

  it('runs migrations up to the current version', () => {
    registerMigration(-1, (raw) => ({ ...raw, migratedFromMinus1: true }));
    const out = migrateSave({ format: 'samrajya-save', version: -1 }, 0);
    expect(out.version).toBe(0);
    expect(out.migratedFromMinus1).toBe(true);
    expect(() => migrateSave({ version: SAVE_VERSION + 1 })).toThrow(SaveError);
  });

  it('hashState ignores key order', () => {
    expect(hashState({ a: 1, b: { c: 2, d: 3 } })).toBe(hashState({ b: { d: 3, c: 2 }, a: 1 }));
    expect(hashState({ a: 1 })).not.toBe(hashState({ a: 2 }));
  });

  it('SaveManager stores, lists and loads slots', () => {
    const mgr = new SaveManager(new MemorySaveStore());
    const g = makeSave();
    mgr.save(g);
    expect(mgr.list().map((s) => s.slot)).toEqual(['slot1']);
    expect(hashState(mgr.load('slot1').world)).toBe(hashState(g.world));
    expect(() => mgr.load('nope')).toThrow(SaveError);
    const imported = mgr.importText(mgr.exportText('slot1'), 'slot2');
    expect(imported.meta.slot).toBe('slot2');
  });
});
