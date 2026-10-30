/**
 * OWNER: CTO. Purpose: one-off generator of the FROZEN save-format v2 fixtures in this folder
 * (tests/contracts/migration.test.ts loads them through every later migration, v2 -> v3 first).
 *
 * Captured from the v2 build (commit 0a4c642, SAVE_VERSION 2, WORLD_SCHEMA_VERSION 2, before save format 3)
 * by driving the real sim the way the game session does. Both fixtures hold a battle in progress whose log already
 * credits routs (`formation_routed` events with `other` = the formation that broke the enemy): the v2 -> v3
 * migration seeds `FormationState.routedEnemies` from exactly those credits, so the fixtures exercise a non-zero
 * seed. Player engagements other than the fought one are autoresolved, player events take their first choice.
 *
 *   npx vite-node tests/fixtures/saves/capture-v2.ts      (refuses to run on any build other than v2)
 *
 * Never regenerate them on a newer build: they must stay what a real v2 player has on disk.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BattleEventRecord, BattleState, EngagementId, SaveGame, SaveSession, SimEvent, SkirmishSetup, WorldState } from '../../../src/core/types';
import { BATTLE_DT, SAVE_VERSION, WORLD_SCHEMA_VERSION } from '../../../src/core/constants';
import { hashState, serializeSave } from '../../../src/core/save';
import { getHeightfield } from '../../../src/core/terrain/cache';
import { applyStrategicCommand, createWorld, getRegionHeightfield, tickWorld } from '../../../src/sim/strategic/world';
import { battleSetupFromEngagement } from '../../../src/sim/strategic/autoresolve';
import { formatDate } from '../../../src/sim/strategic/seasons';
import { createBattle, createSkirmishSetup, stepBattle } from '../../../src/sim/tactical/battle';
import { getEventDef } from '../../../src/data/events';
import { FACTIONS } from '../../../src/data/factions';

if (Number(SAVE_VERSION) !== 2) {
  throw new Error(`capture-v2 must run on the v2 build (SAVE_VERSION 2); this build is v${SAVE_VERSION}. The fixtures are frozen.`);
}

const OUT = join(__dirname);
const BUILD = '0.1.0+save-v2';
const CREATED_AT = '2026-10-30T09:00:00.000Z';

/** Player decisions the session would take: events -> first (safe) choice, engagements -> autoresolve. */
function settlePlayerPrompts(world: WorldState, out: SimEvent[], fightEngagement: (id: EngagementId) => boolean): EngagementId | null {
  const hf = getRegionHeightfield(world);
  for (const e of world.events.pending.slice()) {
    if (e.scope.factionId !== world.playerFactionId) continue;
    const choice = getEventDef(e.defId)?.choices[0]?.id;
    if (choice) applyStrategicCommand(world, { factionId: world.playerFactionId, hour: world.calendar.totalHours, cmd: { kind: 'event_choice', eventInstanceId: e.id, choiceId: choice } }, out, hf);
  }
  for (const eng of Object.values(world.engagements)) {
    if (eng.status !== 'pending_player') continue;
    const fight = fightEngagement(eng.id);
    applyStrategicCommand(world, { factionId: world.playerFactionId, hour: world.calendar.totalHours, cmd: { kind: 'engagement_decision', engagementId: eng.id, decision: fight ? 'fight' : 'autoresolve' } }, out, hf);
    if (fight) return eng.id;
  }
  return null;
}

/** Advance `hours` like WorldScene.fixedUpdate (+ session prompt handling). Returns a fought engagement id if any. */
function runWorld(world: WorldState, hours: number, fightEngagement: (id: EngagementId) => boolean): EngagementId | null {
  const hf = getRegionHeightfield(world);
  const out: SimEvent[] = [];
  for (let h = 0; h < hours; h++) {
    out.length = 0;
    tickWorld(world, [], out, hf);
    const fought = settlePlayerPrompts(world, out, fightEngagement);
    if (fought) return fought;
  }
  return null;
}

/** Rout credits in the battle log (what the v2 outcome counts as FormationResult.routedEnemies). */
function credited(state: BattleState): number {
  return state.events.filter((e) => e.kind === 'formation_routed' && e.other !== null && e.other >= 0).length;
}

/**
 * Step the battle until the log credits at least `routs` routs (max `maxSteps`), then until a tick with formations
 * locked in melee at least `after` steps later: a true mid-battle save with live rout credits. Throws if the battle
 * ends first (the fixture must hold a battle in progress).
 */
function stepPastRouts(state: BattleState, routs: number, maxSteps: number, after: number): void {
  const hf = getHeightfield(state.setup.terrain);
  const sink: BattleEventRecord[] = [];
  let left = -1;
  for (let i = 0; i < maxSteps; i++) {
    if (state.outcome) throw new Error(`capture-v2: the battle ended at t=${state.time.toFixed(1)}s before the save point`);
    sink.length = 0;
    stepBattle(state, BATTLE_DT, hf, sink);
    if (left > 0) left--;
    else if (left < 0 && credited(state) >= routs) left = after;
    if (left === 0 && !state.outcome && state.formations.some((f) => f.engagedWith.length > 0)) return;
  }
  throw new Error(`capture-v2: no save point within ${maxSteps} steps (${credited(state)} credited routs)`);
}

function saveOf(slot: string, name: string, session: SaveSession, world: WorldState | null, battle: BattleState | null, playtimeSec: number): SaveGame {
  return {
    format: 'samrajya-save',
    version: SAVE_VERSION,
    meta: {
      slot,
      name,
      mode: session.mode,
      scene: session.scene,
      playerFactionId: world?.playerFactionId ?? session.skirmish?.playerFactionId ?? null,
      calendar: world ? { ...world.calendar } : null,
      createdAt: CREATED_AT,
      playtimeSec,
      buildVersion: BUILD,
      summary: world ? `${FACTIONS[world.playerFactionId]?.name ?? ''}, ${formatDate(world.calendar)}` : `Skirmish (${Math.round(battle?.time ?? 0)}s)`,
      thumbnail: null,
    },
    session,
    world,
    battle: !world && battle ? battle : null,
  };
}

interface FixtureInfo {
  file: string;
  description: string;
  saveVersion: number;
  worldSchema: number | null;
  scene: string;
  worldHash: string | null;
  battleHash: string | null;
  /** Rout credits in the saved battle's log (sum of the routedEnemies the v2 -> v3 migration seeds). */
  creditedRouts: number;
  bytes: number;
  notes: string[];
}
const manifest: FixtureInfo[] = [];

function write(file: string, description: string, game: SaveGame, battle: BattleState, notes: string[]): void {
  const text = serializeSave(game);
  writeFileSync(join(OUT, file), text);
  manifest.push({
    file,
    description,
    saveVersion: SAVE_VERSION,
    worldSchema: game.world?.schema ?? null,
    scene: game.session.scene,
    worldHash: game.world ? hashState(game.world) : null,
    battleHash: hashState(battle),
    creditedRouts: credited(battle),
    bytes: text.length,
    notes,
  });
  console.log(`[capture-v2] ${file} ${(text.length / 1024).toFixed(0)} KB  ${notes.join('; ')}`);
}

function battleNotes(state: BattleState): string[] {
  const engaged = state.formations.filter((f) => f.engagedWith.length > 0).length;
  const routing = state.formations.filter((f) => f.activity === 'routing').length;
  return [`t=${state.time.toFixed(1)}s`, `phase ${state.phase}`, `${credited(state)} credited routs in the log`, `${routing} formations routing`, `${engaged} formations in melee`, `${state.events.length} log events`, `outcome ${state.outcome ? 'set' : 'none'}`];
}

mkdirSync(OUT, { recursive: true });

// 1. Skirmish mid-battle after the first routs (smoke 'battle' setup: seed 7, 1,000 soldiers, plains) - battle scene.
{
  const skirmish: SkirmishSetup = {
    seed: 7,
    preset: 'plains',
    totalSoldiers: 1000,
    playerFactionId: 'heartland',
    enemyFactionId: 'highland',
    armies: null,
    playerSide: 0,
    hour: 8.5,
    season: 'sharad',
    weather: 'clear',
    difficulty: 'normal',
    aiVsAi: false,
  };
  const setup = createSkirmishSetup(skirmish);
  const state = createBattle(setup, getHeightfield(setup.terrain));
  stepPastRouts(state, 1, 20000, 120);
  write(
    'skirmish-routs.v2.sav',
    'Skirmish seed 7 plains 1,000 soldiers, saved mid-battle after the first credited routs (SaveGame.battle)',
    saveOf('fixture_skirmish_v2', 'Fixture: skirmish routs (v2)', { mode: 'skirmish', scene: 'battle', skirmish, activeEngagementId: null, hero: null }, null, state, 140),
    state,
    battleNotes(state),
  );
}

// 2. Campaign field battle saved mid-fight after the first routs: BattleState nested in world.engagements[id].battle.
{
  const world = createWorld({ kind: 'scenario', scenarioId: 'broken_crown', seed: 42, difficulty: 'normal' });
  const hf = getRegionHeightfield(world);
  const sink: SimEvent[] = [];
  const target = world.armies.army_giri!;
  applyStrategicCommand(world, { factionId: world.playerFactionId, hour: 0, cmd: { kind: 'move_army', armyId: 'army_royal', x: target.x, z: target.z } }, sink, hf);
  const eng = runWorld(world, 24 * 40, (id) => world.engagements[id]!.sides.some((s) => s.includes('army_royal')));
  if (!eng) throw new Error('capture-v2: the Royal Host never met an enemy army');
  const setup = battleSetupFromEngagement(world, eng, true);
  const state = createBattle(setup, getHeightfield(setup.terrain));
  world.engagements[eng]!.battle = state;
  stepPastRouts(state, 1, 20000, 120);
  write(
    'campaign-fieldbattle.v2.sav',
    'Campaign broken_crown seed 42: the Royal Host fights a field battle, saved mid-battle after the first credited routs (engagement.battle)',
    saveOf('fixture_fieldbattle_v2', 'Fixture: campaign field battle (v2)', { mode: 'campaign', scene: 'battle', skirmish: null, activeEngagementId: eng, hero: null }, world, state, 420),
    state,
    [`${eng} on day ${Math.floor(world.calendar.totalHours / 24)}`, `${world.battleHistory.length} battles in history`, ...battleNotes(state)],
  );
}

writeFileSync(
  join(OUT, 'manifest.v2.json'),
  `${JSON.stringify({ capturedFrom: `save format v2 build (SAVE_VERSION ${SAVE_VERSION}, WORLD_SCHEMA_VERSION ${WORLD_SCHEMA_VERSION}), commit 0a4c642`, generator: 'tests/fixtures/saves/capture-v2.ts', fixtures: manifest }, null, 2)}\n`,
);
console.log('[capture-v2] done');
