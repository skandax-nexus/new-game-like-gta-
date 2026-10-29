/**
 * OWNER: Engine Developer - Contracts & Save Schema (CORE-01). Save format v1 -> v2 migration guard.
 *
 * Every frozen v1 fixture (tests/fixtures/saves/*.v1.sav, captured from the v1 build before Contracts v2) must:
 *  - load through deserializeSave (checksum, migration, validation) with no shape problems,
 *  - keep every v1 value (the migration is purely additive),
 *  - re-serialize byte-identically (serialize -> deserialize -> serialize),
 *  - keep simulating with the v2 code (world ticks, battles step), deterministically after a reload.
 * Plus: a fresh v2 world / battle stripped of its v2 fields migrates back to itself (migration defaults ==
 * creation defaults), and malformed / newer / rebel-faction saves are rejected.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BattleEventRecord, BattleState, SaveGame, SimEvent, WorldState } from '../../src/core/types';
import { REBEL_FACTION_ID } from '../../src/core/types';
import { BATTLE_DT, SAVE_VERSION, WORLD_SCHEMA_VERSION } from '../../src/core/constants';
import { decodeJson, describeSaveProblems, deserializeSave, encodeJson, hashState, migrateBattleV1toV2, migrateWorldV1toV2, SaveError, serializeSave } from '../../src/core/save';
import { getHeightfield } from '../../src/core/terrain/cache';
import { Heightfield } from '../../src/core/terrain/heightfield';
import { createWorld, getRegionHeightfield, tickWorld } from '../../src/sim/strategic/world';
import { createBattle, createSkirmishSetup, stepBattle } from '../../src/sim/tactical/battle';
import { autoresolveBattle } from '../../src/sim/strategic/autoresolve';
import { defaultSandbox } from '../../src/data/campaign';

const DIR = join(__dirname, '..', 'fixtures', 'saves');
const FIXTURES = readdirSync(DIR)
  .filter((f) => f.endsWith('.v1.sav'))
  .sort();
const MANIFEST = JSON.parse(readFileSync(join(DIR, 'manifest.v1.json'), 'utf8')) as {
  fixtures: { file: string; worldHash: string | null; battleHash: string | null; saveVersion: number; worldSchema: number | null }[];
};

function readFixture(file: string): string {
  return readFileSync(join(DIR, file), 'utf8');
}

/** The raw v1 object exactly as stored (checksum line stripped, no migration). */
function rawV1(text: string): Record<string, unknown> {
  return decodeJson<Record<string, unknown>>(text.slice(0, text.lastIndexOf('\n#')));
}

/** Every leaf of `before` exists unchanged in `after` (except the listed version paths). Returns the diffs. */
function lostValues(before: unknown, after: unknown, path: string, allow: ReadonlySet<string>, out: string[]): string[] {
  if (out.length > 20) return out;
  if (allow.has(path)) return out;
  if (before === null || typeof before !== 'object') {
    if (!Object.is(before, after)) out.push(`${path}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    return out;
  }
  if (after === null || typeof after !== 'object') {
    out.push(`${path}: object replaced by ${JSON.stringify(after)}`);
    return out;
  }
  if (Array.isArray(before)) {
    if (!Array.isArray(after) || after.length !== before.length) out.push(`${path}: array length changed`);
    else before.forEach((v, i) => lostValues(v, after[i], `${path}[${i}]`, allow, out));
    return out;
  }
  for (const [k, v] of Object.entries(before as Record<string, unknown>)) {
    if (!(k in (after as Record<string, unknown>))) out.push(`${path}.${k}: removed`);
    else lostValues(v, (after as Record<string, unknown>)[k], `${path}.${k}`, allow, out);
  }
  return out;
}

function runWorld(world: WorldState, hours: number): void {
  const hf = getRegionHeightfield(world);
  const out: SimEvent[] = [];
  for (let h = 0; h < hours; h++) {
    out.length = 0;
    tickWorld(world, [], out, hf);
  }
}

function runBattle(state: BattleState, steps: number): void {
  const hf = Heightfield.generate({ ...state.setup.terrain, resolution: 129 });
  const sink: BattleEventRecord[] = [];
  for (let i = 0; i < steps && !state.outcome; i++) {
    sink.length = 0;
    stepBattle(state, BATTLE_DT, hf, sink);
  }
}

/** Battle states held by a save (skirmish battle + world engagements). */
function battlesOf(game: SaveGame): BattleState[] {
  const out: BattleState[] = [];
  if (game.battle) out.push(game.battle);
  if (game.world) for (const e of Object.values(game.world.engagements)) if (e.battle) out.push(e.battle);
  return out;
}

describe('v1 save fixtures', () => {
  it('cover the cases the migration must handle', () => {
    expect(FIXTURES).toEqual(['campaign-day30.v1.sav', 'campaign-fieldbattle.v1.sav', 'sandbox-month6.v1.sav', 'skirmish-midbattle.v1.sav']);
    const games = FIXTURES.map((f) => deserializeSave(readFixture(f)));
    expect(games.some((g) => g.battle !== null)).toBe(true); // skirmish mid-battle
    expect(games.some((g) => g.world && Object.values(g.world.engagements).some((e) => e.battle))).toBe(true); // world battle
    expect(games.some((g) => g.world && g.world.battleHistory.length > 0)).toBe(true); // outcomes
    expect(games.some((g) => g.world && Object.values(g.world.settlements).some((s) => s.construction.length > 0))).toBe(true); // jobs
    expect(games.some((g) => g.world?.mode === 'sandbox')).toBe(true);
  });

  for (const file of FIXTURES) {
    describe(file, () => {
      const text = readFixture(file);

      it('is an untouched v1 capture (matches manifest.v1.json)', () => {
        const raw = rawV1(text) as unknown as SaveGame;
        const entry = MANIFEST.fixtures.find((f) => f.file === file);
        expect(entry).toBeDefined();
        expect(raw.version).toBe(1);
        expect(entry!.saveVersion).toBe(1);
        expect(raw.world ? hashState(raw.world) : null).toBe(entry!.worldHash);
        const battle = raw.battle ?? (raw.session.activeEngagementId ? raw.world?.engagements[raw.session.activeEngagementId]?.battle ?? null : null);
        expect(battle ? hashState(battle) : null).toBe(entry!.battleHash);
      });

      it('loads, migrates to v2 and validates', () => {
        const game = deserializeSave(text);
        expect(game.version).toBe(SAVE_VERSION);
        expect(SAVE_VERSION).toBe(2);
        if (game.world) expect(game.world.schema).toBe(WORLD_SCHEMA_VERSION);
        expect(describeSaveProblems(game)).toEqual([]);
      });

      it('keeps every v1 value (additive migration)', () => {
        const before = rawV1(text);
        const after = deserializeSave(text) as unknown as Record<string, unknown>;
        const lost = lostValues(before, after, '$', new Set(['$.version', '$.world.schema']), []);
        expect(lost).toEqual([]);
      });

      it('serialize -> deserialize -> serialize is byte-identical', () => {
        const game = deserializeSave(text);
        const a = serializeSave(game);
        const b = serializeSave(deserializeSave(a));
        expect(b).toBe(a);
        expect(b.length).toBe(a.length);
      });

      it('migrates deterministically', () => {
        const a = deserializeSave(text);
        const b = deserializeSave(text);
        expect(hashState(a.world)).toBe(hashState(b.world));
        expect(hashState(a.battle)).toBe(hashState(b.battle));
      });

      it('keeps simulating with the v2 code (and a reload continues identically)', () => {
        const game = deserializeSave(text);
        if (game.world) {
          const reloaded = deserializeSave(serializeSave(game)).world!;
          runWorld(game.world, 48);
          runWorld(reloaded, 48);
          expect(describeSaveProblems(game)).toEqual([]);
          expect(hashState(reloaded)).toBe(hashState(game.world));
        }
        for (const b of battlesOf(game)) {
          const copy = decodeJson<BattleState>(encodeJson(b));
          runBattle(b, 200);
          runBattle(copy, 200);
          expect(b.deploymentEndsAt).toBeTypeOf('number');
          expect(hashState(copy)).toBe(hashState(b));
        }
      });
    });
  }
});

// ---------------------------------------------------------------------------------------------------
// Migration defaults == creation defaults
// ---------------------------------------------------------------------------------------------------

const V2_WORLD = ['monsoon', 'statistics'] as const;
const V2_FACTION = ['age', 'landmarks', 'materials', 'policies', 'marketPrices', 'ghosts', 'counterIntel', 'counterIntelUntilDay', 'protectCourtUntilDay', 'advisorIgnored', 'councilAdvice', 'culturePoints', 'prosperityDays'] as const;
const V2_SETTLEMENT = ['initialOwnerFactionId', 'occupiedSinceDay', 'pendingCapture', 'starvationDays', 'revoltSinceDay', 'taxRelief', 'reliefThisMonth', 'ladderProgress', 'landmarks'] as const;
const V2_FORMATION = ['rallies', 'shapeChangeUntil', 'panicUntil', 'rallyingUntil', 'disengageUntil', 'chargeRun', 'orderTime', 'hidden'] as const;

function strip(o: object, keys: readonly string[]): void {
  for (const k of keys) delete (o as Record<string, unknown>)[k];
}

/** Remove every Contracts v2 field from a fresh world (turning it into its v1 shape). */
function toV1World(w: WorldState): WorldState {
  const v1 = decodeJson<WorldState>(encodeJson(w));
  v1.schema = 1;
  strip(v1, V2_WORLD);
  for (const f of Object.values(v1.factions)) {
    strip(f, V2_FACTION);
    strip(f.ai, ['memory']);
  }
  for (const s of Object.values(v1.settlements)) {
    strip(s, V2_SETTLEMENT);
    strip(s.kharif, ['laborAtSowing']);
    strip(s.rabi, ['laborAtSowing']);
    for (const j of s.construction) strip(j, ['paid', 'crew']);
  }
  for (const a of Object.values(v1.armies)) strip(a, ['forcedMarch']);
  for (const c of Object.values(v1.characters)) strip(c, ['captiveOf']);
  for (const d of Object.values(v1.depots)) strip(d, ['readyOnDay']);
  for (const r of Object.values(v1.diplomacy.relations)) strip(r, ['warWeariness', 'truceUntilDay']);
  for (const row of Object.values(v1.espionage.intel)) for (const i of Object.values(row)) strip(i, ['armiesVisibleUntilDay']);
  for (const e of Object.values(v1.engagements)) strip(e, ['prisonerDecision']);
  return v1;
}

function toV1Battle(b: BattleState): BattleState {
  const v1 = decodeJson<BattleState>(encodeJson(b));
  strip(v1, ['deploymentEndsAt', 'siege']);
  for (const s of v1.setup.sides) strip(s, ['aggression']);
  for (const s of v1.sides) strip(s, ['rallyCooldownUntil', 'aiMemory']);
  for (const f of v1.formations) strip(f, V2_FORMATION);
  for (const w of v1.works) strip(w, ['maxHp', 'progress', 'formation']);
  if (v1.outcome) {
    strip(v1.outcome, ['warScore', 'chronicle', 'placeName', 'day']);
    for (const s of v1.outcome.sides) {
      strip(s, ['prisoners', 'routs', 'capturedSupply', 'commanderId']);
      for (const f of s.formations) strip(f, ['routedEnemies']);
    }
  }
  return v1;
}

describe('migration defaults match creation defaults', () => {
  it('campaign and sandbox worlds', () => {
    for (const fresh of [
      createWorld({ kind: 'scenario', scenarioId: 'broken_crown', seed: 3, difficulty: 'normal' }),
      createWorld({ kind: 'scenario', scenarioId: 'seven_hills', seed: 4, difficulty: 'hard' }),
      createWorld({ kind: 'sandbox', sandbox: defaultSandbox(5) }),
    ]) {
      const v1 = toV1World(fresh);
      expect(hashState(v1)).not.toBe(hashState(fresh));
      migrateWorldV1toV2(v1);
      expect(hashState(v1)).toBe(hashState(fresh));
    }
  });

  it('battles (incl. a finished one with an outcome)', () => {
    const setup = createSkirmishSetup({ seed: 21, preset: 'plains', totalSoldiers: 400, playerFactionId: 'heartland', enemyFactionId: 'highland', armies: null, playerSide: 0, hour: 9, season: 'sharad', weather: 'clear', difficulty: 'normal', aiVsAi: true });
    const terrain = getHeightfield({ ...setup.terrain, resolution: 129 });
    const fresh = createBattle(setup, terrain);
    const v1 = toV1Battle(fresh);
    migrateBattleV1toV2(v1);
    expect(hashState(v1)).toBe(hashState(fresh));
    const finished = autoresolveBattle(setup, terrain);
    expect(finished.outcome).not.toBeNull();
    const done = toV1Battle(finished);
    expect(hashState(done)).not.toBe(hashState(finished));
    migrateBattleV1toV2(done);
    expect(hashState(done)).toBe(hashState(finished));
  });

  it('faction ages come from the scenario, then the faction, then janapada', () => {
    const w = createWorld({ kind: 'scenario', scenarioId: 'broken_crown', seed: 3, difficulty: 'normal' });
    expect(w.factions.heartland!.age).toBe('mahajanapada');
    expect(w.factions.frontier!.age).toBe('janapada');
    expect(w.monsoon.strength).toBe(0.7);
    expect(Object.keys(w.statistics).sort()).toEqual(Object.keys(w.factions).sort());
  });
});

describe('save validation', () => {
  function campaignSave(): SaveGame {
    return deserializeSave(readFixture('campaign-day30.v1.sav'));
  }

  it('rejects the reserved rebel faction as a WorldState.factions key', () => {
    const game = campaignSave();
    game.world!.factions[REBEL_FACTION_ID] = { ...game.world!.factions.heartland!, id: REBEL_FACTION_ID };
    expect(describeSaveProblems(game).join(' ')).toContain('reserved');
    expect(() => deserializeSave(serializeSave(game))).toThrow(SaveError);
  });

  it('rejects a v2 save missing a v2 field', () => {
    const game = campaignSave();
    delete (game.world!.factions.heartland as unknown as Record<string, unknown>).age;
    expect(() => deserializeSave(serializeSave(game))).toThrow(/world\.factions\.heartland\.age missing/);
  });

  it('reports a structurally broken v1 save as a SaveError (not a TypeError from the migration)', () => {
    const raw = rawV1(readFixture('campaign-day30.v1.sav'));
    delete (raw.world as Record<string, unknown>).armies;
    delete (raw.world as Record<string, unknown>).diplomacy;
    const body = encodeJson(raw);
    expect(() => deserializeSave(body)).toThrow(SaveError);
    expect(() => deserializeSave(body)).toThrow(/malformed/);
  });

  it('rejects saves from a newer build', () => {
    const text = serializeSave(campaignSave()).replace('"version":2', `"version":${SAVE_VERSION + 1}`);
    const body = text.slice(0, text.lastIndexOf('\n#'));
    expect(() => deserializeSave(body)).toThrow(/newer than this build/);
  });
});
