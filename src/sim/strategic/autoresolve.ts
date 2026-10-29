/**
 * Distant battles + autoresolve + engagement decisions. OWNER: Lead AI & Simulation Engineer.
 * Baseline by the CTO.
 *
 * GDD §9: distant battles use formation-level resolution; active battles instantiate detailed
 * entities from the SAME authoritative state; transitions preserve outcomes. Therefore autoresolve
 * runs the real tactical sim (createBattle/stepBattle without the soldier layer) on a coarse terrain
 * window - identical rules, just no visuals. A battle the player leaves keeps stepping here.
 */
import type {
  BattleEventRecord,
  BattlePrediction,
  BattleSetup,
  BattleState,
  EngagementId,
  FormationSetup,
  SimEvent,
  TerrainQuery,
  WorldState,
} from '../../core/types';
import { BATTLE_DT, BATTLE_MAP_RESOLUTION, BATTLE_MAP_SIZE } from '../../core/constants';
import { deriveSeed } from '../../core/rng';
import { sortedKeys } from '../../core/ids';
import { getHeightfield } from '../../core/terrain/cache';
import { createLocalTerrainSpec } from '../../core/terrain/heightfield';
import { FACTIONS } from '../../data/factions';
import { createBattle, deployZoneFor, forceOutcome, stepBattle } from '../tactical/battle';
import { applyBattleOutcome, armyStrength } from './armies';
import { getEnvironmentState } from './seasons';
import { addChronicle, pushBattleHistory } from './world';

/** Max simulated battle time for autoresolve (s). */
export const AUTORESOLVE_MAX_SEC = 60 * 30;
/** Coarse terrain resolution for headless battles. */
export const AUTORESOLVE_TERRAIN_RES = 65;

/** Build a BattleSetup from an engagement's armies (player side controlled by the player if `playerControlled`). */
export function battleSetupFromEngagement(world: WorldState, engagementId: EngagementId, playerControlled: boolean, resolution = BATTLE_MAP_RESOLUTION): BattleSetup {
  const e = world.engagements[engagementId];
  if (!e) throw new Error(`No engagement ${engagementId}`);
  const terrain = createLocalTerrainSpec(world.region.terrain, e.x, e.z, BATTLE_MAP_SIZE, resolution, 'plains');
  const partial = { terrain };
  const sides = ([0, 1] as const).map((side) => {
    const armies = e.sides[side].map((id) => world.armies[id]).filter((a): a is NonNullable<typeof a> => !!a);
    const factionId = armies[0]?.factionId ?? world.playerFactionId;
    const isPlayer = playerControlled && world.factions[factionId]?.isPlayer === true;
    const commander = armies[0]?.commanderId ? world.characters[armies[0].commanderId] : null;
    const formations: FormationSetup[] = [];
    for (const a of armies) {
      for (const u of a.units) {
        formations.push({
          unitClass: u.unitClass,
          soldiers: u.soldiers,
          experience: u.experience,
          morale: Math.min(u.morale, a.morale + 10),
          fatigue: Math.max(u.fatigue, a.fatigue),
          supply: a.supply.food > 0 ? 1 : 0.3,
          name: null,
          x: null,
          z: null,
          facing: null,
          shape: null,
          hasCommander: false,
          armyUnitId: u.id,
        });
      }
    }
    return {
      factionId,
      armyIds: armies.map((a) => a.id),
      commanderId: commander?.id ?? null,
      commanderName: commander?.name ?? 'Captain',
      commanderSkill: commander?.skills.martial ?? 8,
      controller: isPlayer ? ('player' as const) : ('ai' as const),
      aiPersonality: FACTIONS[factionId]?.aiPersonality ?? 'opportunist',
      difficulty: world.difficulty,
      formations,
      deployZone: deployZoneFor(partial, side),
      supply: armies[0] && armies[0].supply.food > 0 ? 1 : 0.4,
      aggression: null,
    };
  }) as BattleSetup['sides'];
  return {
    id: `battle_${engagementId}`,
    seed: deriveSeed(world.seed, engagementId),
    kind: e.kind,
    terrain,
    fortification: null,
    environment: getEnvironmentState(world),
    sides,
    attackerSide: 0,
    timeLimitSec: 60 * 40,
    objectives: [],
    deploymentSec: 0,
    origin: { kind: 'world', engagementId, settlementId: e.settlementId },
  };
}

/** Run a battle headless to completion (formation level only). */
export function autoresolveBattle(setup: BattleSetup, terrain?: TerrainQuery, maxSec = AUTORESOLVE_MAX_SEC): BattleState {
  const t = terrain ?? getHeightfield({ ...setup.terrain, resolution: AUTORESOLVE_TERRAIN_RES });
  // Both sides AI-controlled for autoresolve.
  const s: BattleSetup = { ...setup, sides: [{ ...setup.sides[0], controller: 'ai' }, { ...setup.sides[1], controller: 'ai' }] };
  const state = createBattle(s, t);
  const sink: BattleEventRecord[] = [];
  const steps = Math.ceil(maxSec / BATTLE_DT);
  for (let i = 0; i < steps && !state.outcome; i++) {
    sink.length = 0;
    stepBattle(state, BATTLE_DT, t, sink);
  }
  if (!state.outcome) state.outcome = forceOutcome(state, 'time_limit');
  state.outcome.autoresolved = true;
  return state;
}

/** Pre-battle estimate for the engagement prompt. */
export function predictBattle(world: WorldState, engagementId: EngagementId): BattlePrediction {
  const e = world.engagements[engagementId];
  if (!e) return { attackerWinChance: 0.5, expectedLosses: [0, 0], factors: [] };
  const strength = (ids: string[]): number => ids.reduce((s, id) => s + (world.armies[id] ? armyStrength(world.armies[id]!) : 0), 0);
  const soldiers = (ids: string[]): number => ids.reduce((s, id) => s + (world.armies[id]?.units.reduce((a, u) => a + u.soldiers, 0) ?? 0), 0);
  const a = strength(e.sides[0]);
  const d = strength(e.sides[1]);
  const p = a / Math.max(1, a + d);
  const chance = Math.min(0.95, Math.max(0.05, 0.5 + (p - 0.5) * 1.8));
  return {
    attackerWinChance: chance,
    expectedLosses: [Math.round(soldiers(e.sides[0]) * (0.35 - chance * 0.25)), Math.round(soldiers(e.sides[1]) * (0.1 + chance * 0.25))],
    factors: [a > d ? 'The attackers have the stronger host.' : 'The defenders have the stronger host.', `Strength ratio ${(a / Math.max(1, d)).toFixed(2)}`],
  };
}

/** Player's decision on a pending engagement. 'fight' leaves the engagement active for the BattleScene. */
export function decideEngagement(world: WorldState, engagementId: EngagementId, decision: 'fight' | 'autoresolve' | 'retreat', out: SimEvent[], terrain: TerrainQuery): boolean {
  const e = world.engagements[engagementId];
  if (!e || e.status === 'resolved') return false;
  void terrain;
  if (decision === 'fight') {
    e.status = 'active';
    return true;
  }
  if (decision === 'retreat') {
    // Retreating side loses a rearguard (5%) and falls back; baseline: whichever side is the player's.
    for (let side = 0; side < 2; side++) {
      for (const id of e.sides[side as 0 | 1]) {
        const a = world.armies[id];
        if (!a || !world.factions[a.factionId]?.isPlayer) continue;
        for (const u of a.units) u.soldiers = Math.max(0, Math.floor(u.soldiers * 0.95));
        a.engagementId = null;
        a.status = 'camped';
        a.morale = Math.max(5, a.morale - 10);
        a.order = { kind: 'retreat', x: a.x - (e.x - a.x) * 3, z: a.z - (e.z - a.z) * 3 };
        a.path = [{ x: a.order.x, z: a.order.z }];
        a.pathIndex = 0;
        a.status = 'marching';
      }
    }
    for (const side of e.sides) for (const id of side) {
      const a = world.armies[id];
      if (a && a.engagementId === engagementId) {
        a.engagementId = null;
        a.status = 'camped';
      }
    }
    e.status = 'resolved';
    out.push({ kind: 'engagement_resolved', engagementId, winnerFactionId: null });
    return true;
  }
  resolveEngagementNow(world, engagementId, out);
  return true;
}

/** Autoresolve an engagement immediately and apply the outcome. */
export function resolveEngagementNow(world: WorldState, engagementId: EngagementId, out: SimEvent[]): void {
  const e = world.engagements[engagementId];
  if (!e || e.status === 'resolved') return;
  const setup = battleSetupFromEngagement(world, engagementId, false, AUTORESOLVE_TERRAIN_RES);
  const state = autoresolveBattle(setup);
  const outcome = state.outcome!;
  pushBattleHistory(world, outcome);
  applyBattleOutcome(world, engagementId, outcome, out);
  const wf = outcome.winner === null ? null : outcome.sides[outcome.winner].factionId;
  addChronicle(world, wf, outcome.summary[0] ?? 'A battle was fought.', 1);
}

/**
 * Advance engagements that are not under player control. Baseline: 'auto' engagements resolve at once.
 * TODO(owner): step `engagement.battle` over several hours so distant battles evolve over time and a
 * player who takes command mid-battle continues from the same BattleState.
 */
export function stepDistantBattles(world: WorldState, out: SimEvent[], terrain: TerrainQuery): void {
  void terrain;
  for (const id of sortedKeys(world.engagements)) {
    const e = world.engagements[id]!;
    if (e.status === 'auto') resolveEngagementNow(world, id, out);
  }
  // Drop resolved engagements older than 30 days.
  for (const id of sortedKeys(world.engagements)) {
    const e = world.engagements[id]!;
    if (e.status === 'resolved' && world.calendar.totalHours - e.startedHour > 24 * 30) delete world.engagements[id];
  }
}
