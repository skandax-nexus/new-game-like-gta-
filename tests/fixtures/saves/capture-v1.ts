/**
 * OWNER: Engine Developer - Contracts & Save Schema (CORE-01). Purpose: one-off generator of the FROZEN
 * save-format v1 fixtures in this folder (tests/contracts/migration.test.ts loads them through every
 * future migration).
 *
 * The fixtures were captured from the v1 build (commit 04b6dbb, SAVE_VERSION 1) BEFORE Contracts v2
 * touched any type, by driving the real sim exactly like the game session does (GameSession.saveGame /
 * applyNow / BattleScene): player events take their first (safe-default) choice, player engagements are
 * autoresolved except the one fought in the field-battle fixture.
 *
 *   npx vite-node tests/fixtures/saves/capture-v1.ts      (refuses to run on any build other than v1)
 *
 * Never regenerate them on a newer build: they must stay what a real v1 player has on disk.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BattleEventRecord, BattleState, EngagementId, IssuedStrategicCommand, SaveGame, SaveSession, SimEvent, SkirmishSetup, StrategicCommand, WorldState } from '../../../src/core/types';
import { BATTLE_DT, SAVE_VERSION } from '../../../src/core/constants';
import { hashState, serializeSave } from '../../../src/core/save';
import { getHeightfield } from '../../../src/core/terrain/cache';
import { applyStrategicCommand, createWorld, getRegionHeightfield, tickWorld } from '../../../src/sim/strategic/world';
import { battleSetupFromEngagement } from '../../../src/sim/strategic/autoresolve';
import { formatDate } from '../../../src/sim/strategic/seasons';
import { createBattle, createSkirmishSetup, stepBattle } from '../../../src/sim/tactical/battle';
import { defaultSandbox } from '../../../src/data/campaign';
import { getEventDef } from '../../../src/data/events';
import { FACTIONS } from '../../../src/data/factions';

if (Number(SAVE_VERSION) !== 1) {
  throw new Error(`capture-v1 must run on the v1 build (SAVE_VERSION 1, commit 04b6dbb); this build is v${SAVE_VERSION}. The fixtures are frozen.`);
}

const OUT = join(__dirname);

/** The v1 session record (Contracts v2 added `hero`; this generator only ever ran on v1). */
type V1Session = Omit<SaveSession, 'hero'>;
const BUILD = '0.1.0+04b6dbb';
const CREATED_AT = '2026-10-29T11:00:00.000Z';

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

/** Player commands by world hour (queued like session.issueStrategic, applied by the next tick). */
type Schedule = Map<number, StrategicCommand[]>;

/** Advance `hours` like WorldScene.fixedUpdate (+ session prompt handling). Returns a fought engagement id if any. */
function runWorld(world: WorldState, hours: number, fightEngagement: (id: EngagementId) => boolean = () => false, schedule: Schedule = new Map()): EngagementId | null {
  const hf = getRegionHeightfield(world);
  const out: SimEvent[] = [];
  for (let h = 0; h < hours; h++) {
    out.length = 0;
    const cmds: IssuedStrategicCommand[] = (schedule.get(world.calendar.totalHours) ?? []).map((cmd) => ({ factionId: world.playerFactionId, hour: 0, cmd }));
    tickWorld(world, cmds, out, hf);
    const fought = settlePlayerPrompts(world, out, fightEngagement);
    if (fought) return fought;
  }
  return null;
}

/** Step the battle until melee contact (max `maxSteps`), then `afterContact` more steps: a true mid-battle save. */
function stepIntoMelee(state: BattleState, maxSteps: number, afterContact: number): void {
  const hf = getHeightfield(state.setup.terrain);
  const sink: BattleEventRecord[] = [];
  const inMelee = (): boolean => state.formations.some((f) => f.engagedWith.length > 0);
  let left = -1;
  for (let i = 0; i < maxSteps && !state.outcome; i++) {
    sink.length = 0;
    stepBattle(state, BATTLE_DT, hf, sink);
    if (left > 0) left--;
    else if (left < 0 && inMelee()) left = afterContact;
    // Stop on a tick where formations are locked in melee (engagedWith, damage pools and morale events live).
    if (left === 0 && inMelee()) return;
  }
}

function saveOf(slot: string, name: string, session: V1Session, world: WorldState | null, battle: BattleState | null, playtimeSec: number): SaveGame {
  const v1: Omit<SaveGame, 'session'> & { session: V1Session } = {
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
  return v1 as SaveGame;
}

interface FixtureInfo {
  file: string;
  description: string;
  saveVersion: number;
  worldSchema: number | null;
  scene: string;
  worldHash: string | null;
  battleHash: string | null;
  bytes: number;
  notes: string[];
}
const manifest: FixtureInfo[] = [];

function write(file: string, description: string, game: SaveGame, notes: string[]): void {
  const text = serializeSave(game);
  writeFileSync(join(OUT, file), text);
  const battle = game.battle ?? (game.session.activeEngagementId ? (game.world?.engagements[game.session.activeEngagementId]?.battle ?? null) : null);
  manifest.push({
    file,
    description,
    saveVersion: SAVE_VERSION,
    worldSchema: game.world?.schema ?? null,
    scene: game.session.scene,
    worldHash: game.world ? hashState(game.world) : null,
    battleHash: battle ? hashState(battle) : null,
    bytes: text.length,
    notes,
  });
  console.log(`[capture-v1] ${file} ${(text.length / 1024).toFixed(0)} KB  ${notes.join('; ')}`);
}

mkdirSync(OUT, { recursive: true });

// 1. Campaign (The Broken Crown) at day 30 - world scene.
{
  const world = createWorld({ kind: 'scenario', scenarioId: 'broken_crown', seed: 42, difficulty: 'normal' });
  // Jobs in flight at the save point: construction, recruitment, a spy mission and a proposal.
  const schedule: Schedule = new Map([
    [24 * 22, [
      { kind: 'build', settlementId: 'dhanyagram', building: 'granary' },
      { kind: 'build', settlementId: 'rajapura', building: 'temple' },
      { kind: 'recruit', settlementId: 'rajapura', unitClass: 'spearmen', formations: 2, targetArmyId: null },
      { kind: 'spy_mission', targetFactionId: 'highland', mission: 'gather_intel', settlementId: null, agentCharacterId: null },
    ]],
    [24 * 29, [{ kind: 'propose', to: 'forest', type: 'trade', terms: { tributePerMonth: 0, payer: null, overlord: null, autonomy: 0, marriage: null, durationDays: 720 } }]],
  ]);
  runWorld(world, 24 * 30, () => false, schedule);
  const jobs = Object.values(world.settlements).reduce((a, s) => a + s.construction.length + s.recruitment.length, 0);
  const notes = [`day ${Math.floor(world.calendar.totalHours / 24)}`, `${jobs} construction/recruitment jobs`, `${Object.keys(world.espionage.agents).length} agents`, `${world.diplomacy.proposals.length} proposals`, `${Object.keys(world.engagements).length} engagements`, `${world.events.history.length} events in history`, `${Object.keys(world.armies).length} armies`];
  write('campaign-day30.v1.sav', 'Campaign broken_crown seed 42, normal, world scene at day 30', saveOf('fixture_campaign', 'Fixture: campaign day 30', { mode: 'campaign', scene: 'world', skirmish: null, activeEngagementId: null }, world, null, 60), notes);
}

// 2. Skirmish mid-battle (smoke 'battle' setup: seed 7, 1,000 soldiers, plains) - battle scene.
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
  stepIntoMelee(state, 6000, 240);
  const engaged = state.formations.filter((f) => f.engagedWith.length > 0).length;
  const notes = [`t=${state.time.toFixed(1)}s`, `phase ${state.phase}`, `${engaged} formations in melee`, `${state.volleys.length} volleys in flight`, `outcome ${state.outcome ? 'set' : 'none'}`];
  write('skirmish-midbattle.v1.sav', 'Skirmish seed 7 plains 1,000 soldiers, saved mid-battle (SaveGame.battle)', saveOf('fixture_skirmish', 'Fixture: skirmish mid-battle', { mode: 'skirmish', scene: 'battle', skirmish, activeEngagementId: null }, null, state, 55), notes);
}

// 3. Sandbox at month 6 - world scene.
{
  const world = createWorld({ kind: 'sandbox', sandbox: defaultSandbox(7) });
  const cap = world.factions[world.playerFactionId]!.capitalSettlementId!;
  const schedule: Schedule = new Map([
    [24 * 170, [
      { kind: 'build', settlementId: cap, building: 'housing' },
      { kind: 'recruit', settlementId: cap, unitClass: 'archers', formations: 1, targetArmyId: null },
      { kind: 'set_tax_policy', policy: 'heavy' },
    ]],
  ]);
  runWorld(world, 24 * 30 * 6, () => false, schedule);
  const distant = Object.values(world.engagements).filter((e) => e.battle).length;
  const notes = [`${formatDate(world.calendar)}`, `${Object.keys(world.engagements).length} engagements (${distant} with a live BattleState)`, `${world.battleHistory.length} battles in history`, `${world.stats.length} stat samples`];
  write('sandbox-month6.v1.sav', 'Sandbox defaultSandbox(7), world scene after 6 months', saveOf('fixture_sandbox', 'Fixture: sandbox month 6', { mode: 'sandbox', scene: 'world', skirmish: null, activeEngagementId: null }, world, null, 900), notes);
}

// 4. Campaign field battle saved mid-fight: BattleState nested in world.engagements[id].battle.
{
  const world = createWorld({ kind: 'scenario', scenarioId: 'broken_crown', seed: 42, difficulty: 'normal' });
  const hf = getRegionHeightfield(world);
  const sink: SimEvent[] = [];
  const target = world.armies.army_giri!;
  applyStrategicCommand(world, { factionId: world.playerFactionId, hour: 0, cmd: { kind: 'move_army', armyId: 'army_royal', x: target.x, z: target.z } }, sink, hf);
  const eng = runWorld(world, 24 * 40, (id) => world.engagements[id]!.sides.some((s) => s.includes('army_royal')));
  if (!eng) throw new Error('capture-v1: the Royal Host never met an enemy army');
  const setup = battleSetupFromEngagement(world, eng, true);
  const state = createBattle(setup, getHeightfield(setup.terrain));
  world.engagements[eng]!.battle = state;
  stepIntoMelee(state, 6000, 240);
  const engaged = state.formations.filter((f) => f.engagedWith.length > 0).length;
  const notes = [`${eng} on day ${Math.floor(world.calendar.totalHours / 24)}`, `t=${state.time.toFixed(1)}s`, `phase ${state.phase}`, `${engaged} formations in melee`, `outcome ${state.outcome ? 'set' : 'none'}`];
  write('campaign-fieldbattle.v1.sav', 'Campaign broken_crown: the Royal Host fights a field battle, saved mid-battle (engagement.battle)', saveOf('fixture_fieldbattle', 'Fixture: campaign field battle', { mode: 'campaign', scene: 'battle', skirmish: null, activeEngagementId: eng }, world, state, 300), notes);
}

writeFileSync(join(OUT, 'manifest.v1.json'), `${JSON.stringify({ capturedFrom: 'commit 04b6dbb (SAVE_VERSION 1, WORLD_SCHEMA_VERSION 1)', generator: 'tests/fixtures/saves/capture-v1.ts', fixtures: manifest }, null, 2)}\n`);
console.log('[capture-v1] done');
