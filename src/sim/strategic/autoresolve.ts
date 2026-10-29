/**
 * Distant battles + autoresolve + engagement decisions (DESIGN_SPEC §6.14). OWNER: Simulation Engineer - Strategic
 * World Simulation (SIM-01).
 *
 *  - Autoresolve: the real tactical sim headless on a 65^2 window, both sides AI; the player's side fights with the
 *    aggression of its army stance (aggressive 0.75 / balanced 0.5 / cautious 0.3). Siege battles carry the town's
 *    walls (FortificationSpec: 12 segments on the settlement radius, segment HP = current wallHp / 12, gates by kind,
 *    towers 1 per 2 segments per fort level).
 *  - Prediction: chance = logistic(4 x (ln(attacker / defender strength) + terrain + morale + supply terms)); up to 4
 *    factor lines, largest first, worded for the player when involved.
 *  - Retreat from the prompt: the retreating armies lose 10% (3% when 20% faster than the fastest enemy) and march one
 *    day toward the nearest friendly settlement.
 *
 * GDD §9: distant battles use formation-level resolution; active battles instantiate detailed
 * entities from the SAME authoritative state; transitions preserve outcomes. Therefore autoresolve
 * runs the real tactical sim (createBattle/stepBattle without the soldier layer) on a coarse terrain
 * window - identical rules, just no visuals. A battle the player leaves keeps stepping here.
 */
import type {
  ArmyStance,
  ArmyState,
  BattleEventRecord,
  BattlePrediction,
  BattleSetup,
  BattleState,
  EngagementId,
  FormationSetup,
  FortificationSpec,
  SimEvent,
  TerrainQuery,
  Vec2,
  WorldState,
} from '../../core/types';
import { BATTLE_DT, BATTLE_MAP_RESOLUTION, BATTLE_MAP_SIZE } from '../../core/constants';
import { deriveSeed } from '../../core/rng';
import { sortedKeys } from '../../core/ids';
import { getHeightfield } from '../../core/terrain/cache';
import { createLocalTerrainSpec } from '../../core/terrain/heightfield';
import { FACTIONS } from '../../data/factions';
import { createBattle, deployZoneFor, forceOutcome, stepBattle } from '../tactical/battle';
import { applyBattleOutcome, armyStrength, planArmyPath, potentialSpeed } from './armies';
import { dexp, dlog } from '../../core/math';
import { RULES } from '../../data/rules';
import { loseShare } from './supply';
import { retreatDestination } from './writeback';
import { getEnvironmentState } from './seasons';

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
      aggression: world.factions[factionId]?.isPlayer && armies[0] ? STANCE_AGGRESSION[armies[0].stance] : null,
    };
  }) as BattleSetup['sides'];
  return {
    id: `battle_${engagementId}`,
    seed: deriveSeed(world.seed, engagementId),
    kind: e.kind,
    terrain,
    fortification: e.kind === 'siege' ? siegeFortification(world, e.settlementId) : null,
    environment: getEnvironmentState(world),
    sides,
    attackerSide: 0,
    timeLimitSec: 60 * 40,
    objectives: [],
    deploymentSec: 0,
    origin: { kind: 'world', engagementId, settlementId: e.settlementId },
  };
}

/** Strategic stance -> battle-AI aggression of the player's side in autoresolve (§6.14). */
export const STANCE_AGGRESSION: Readonly<Record<ArmyStance, number>> = { aggressive: 0.75, balanced: 0.5, cautious: 0.3 };

/** The town's walls for a siege battle (DESIGN_SPEC §6.6.5). */
export function siegeFortification(world: WorldState, settlementId: string | null): FortificationSpec | null {
  const s = settlementId ? world.settlements[settlementId] : null;
  if (!s || s.fortLevel < 1) return null;
  const segments = 12;
  const gates = s.kind === 'city' || s.kind === 'capital' ? 4 : s.kind === 'fort' ? 1 : 2;
  return {
    kind: s.fortLevel >= 3 ? 'stone_wall' : s.fortLevel === 2 ? 'mud_brick_wall' : 'palisade',
    center: { x: s.x, z: s.z },
    radius: Math.min(s.radius, BATTLE_MAP_SIZE * 0.35),
    gates,
    towers: (segments / 2) * s.fortLevel,
    wallHp: Math.max(1, s.wallHp / segments),
    ditch: s.fortLevel >= 2,
    defenderSide: 1,
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

interface PredictionTerm {
  value: number;
  /** Line from the attackers' view: [attackers' advantage text, defenders' advantage text]. */
  text: string;
}

function sideArmies(world: WorldState, ids: readonly string[]): ArmyState[] {
  return ids.map((id) => world.armies[id]).filter((a): a is ArmyState => !!a);
}

function hasClass(armies: readonly ArmyState[], classes: readonly string[]): boolean {
  return armies.some((a) => a.units.some((u) => classes.includes(u.unitClass) && u.soldiers > 0));
}

function avgMorale(armies: readonly ArmyState[]): number {
  let m = 0;
  let n = 0;
  for (const a of armies) for (const u of a.units) {
    m += u.morale * u.soldiers;
    n += u.soldiers;
  }
  return n > 0 ? m / n : 50;
}

/** Pre-battle estimate for the engagement prompt (§6.14). */
export function predictBattle(world: WorldState, engagementId: EngagementId): BattlePrediction {
  const e = world.engagements[engagementId];
  if (!e) return { attackerWinChance: 0.5, expectedLosses: [0, 0], factors: [] };
  const att = sideArmies(world, e.sides[0]);
  const def = sideArmies(world, e.sides[1]);
  const strength = (xs: readonly ArmyState[]): number => xs.reduce((t, a) => t + armyStrength(a), 0);
  const soldiers = (xs: readonly ArmyState[]): number => xs.reduce((t, a) => t + a.units.reduce((n, u) => n + u.soldiers, 0), 0);
  const a = Math.max(1, strength(att));
  const d = Math.max(1, strength(def));
  const playerSide = att.some((x) => world.factions[x.factionId]?.isPlayer) ? 0 : def.some((x) => world.factions[x.factionId]?.isPlayer) ? 1 : -1;
  const you = (side: 0 | 1): string => (playerSide === -1 ? (side === 0 ? 'The attackers' : 'The defenders') : playerSide === side ? 'You' : 'They');
  const your = (side: 0 | 1): string => (playerSide === -1 ? (side === 0 ? "The attackers'" : "The defenders'") : playerSide === side ? 'Your' : 'Their');
  const terms: PredictionTerm[] = [];
  const ratio = dlog(a / d);
  terms.push({ value: ratio, text: ratio >= 0 ? `${your(0)} host is the stronger (${(a / d).toFixed(1)} : 1)` : `${your(1)} host is the stronger (${(d / a).toFixed(1)} : 1)` });
  // Elephants against horse.
  if (hasClass(att, ['war_elephants']) && hasClass(def, ['cavalry', 'chariots'])) terms.push({ value: 0.1, text: `${your(0)} elephants outweigh ${playerSide === 1 ? 'your' : 'their'} horse` });
  if (hasClass(def, ['war_elephants']) && hasClass(att, ['cavalry', 'chariots'])) terms.push({ value: -0.1, text: `${your(1)} elephants outweigh ${playerSide === 0 ? 'your' : 'their'} horse` });
  // High ground.
  const hf = getHeightfield(world.region.terrain);
  const pos = (xs: readonly ArmyState[]): { x: number; z: number } => (xs[0] ? { x: xs[0].x, z: xs[0].z } : { x: e.x, z: e.z });
  const pa = pos(att);
  const pd = pos(def);
  const dh = hf.inBounds(pa.x, pa.z) && hf.inBounds(pd.x, pd.z) ? hf.heightAt(pa.x, pa.z) - hf.heightAt(pd.x, pd.z) : 0;
  if (dh > 15) terms.push({ value: 0.15, text: `${you(0)} hold the high ground` });
  else if (dh < -15) terms.push({ value: -0.15, text: `${you(1)} hold the high ground` });
  // River / walls.
  if (e.kind === 'river_crossing') terms.push({ value: -0.2, text: `${you(0)} must attack across the river` });
  if (e.kind === 'siege' && e.settlementId) {
    const s = world.settlements[e.settlementId];
    if (s && s.fortLevel >= 1) {
      const intact = s.wallHp / Math.max(1, s.fortLevel * RULES.siege.wallHpPerLevel);
      terms.push({ value: -0.15 * s.fortLevel * Math.min(1, intact), text: intact > 0.5 ? `The walls of ${s.name} favour ${playerSide === 1 ? 'you' : 'the defenders'}` : `The walls of ${s.name} are breached` });
    }
  }
  // Morale and hunger.
  const dm = (avgMorale(att) - avgMorale(def)) / 100;
  if (Math.abs(dm) >= 0.1) terms.push({ value: dm * 0.5, text: dm > 0 ? `${your(0)} men are in better heart` : `${your(1)} men are in better heart` });
  if (att.some((x) => x.supply.food <= 0)) terms.push({ value: -0.1, text: `${your(0)} army is hungry: -10 morale` });
  if (def.some((x) => x.supply.food <= 0)) terms.push({ value: 0.1, text: `${your(1)} army is hungry: -10 morale` });
  let x = 0;
  for (const t of terms) x += t.value;
  const chance = Math.min(0.97, Math.max(0.03, 1 / (1 + dexp(-4 * x))));
  const factors = terms
    .slice()
    .sort((p, q) => Math.abs(q.value) - Math.abs(p.value))
    .slice(0, 4)
    .map((t) => t.text);
  return {
    attackerWinChance: chance,
    expectedLosses: [Math.round(soldiers(att) * (0.35 - chance * 0.25)), Math.round(soldiers(def) * (0.1 + chance * 0.25))],
    factors,
  };
}

/** Rearguard share lost when retreating from the prompt: 10%, or 3% when 20% faster than the fastest enemy. */
export function retreatLossShare(world: WorldState, engagementId: EngagementId, side: 0 | 1): number {
  const e = world.engagements[engagementId];
  if (!e) return 0;
  const own = sideArmies(world, e.sides[side]);
  const foes = sideArmies(world, e.sides[side === 0 ? 1 : 0]);
  let slow = Infinity;
  for (const a of own) slow = Math.min(slow, potentialSpeed(world, a));
  let fast = 0;
  for (const a of foes) fast = Math.max(fast, potentialSpeed(world, a));
  return slow >= 1.2 * fast ? 0.03 : 0.1;
}

/** One day's march of `a` along a planned path toward (tx, tz): the path cut at the day's distance. */
function dayMarch(world: WorldState, a: ArmyState, tx: number, tz: number, terrain: TerrainQuery): Vec2[] {
  const path = planArmyPath(world, a, tx, tz, terrain);
  let budget = potentialSpeed(world, a) * 24 * 1.25; // roads are faster than open ground
  const out: Vec2[] = [path[0] ?? { x: a.x, z: a.z }];
  for (let i = 1; i < path.length; i++) {
    const p = out[out.length - 1]!;
    const q = path[i]!;
    const dd = Math.sqrt((q.x - p.x) * (q.x - p.x) + (q.z - p.z) * (q.z - p.z));
    if (dd <= budget) {
      out.push({ x: q.x, z: q.z });
      budget -= dd;
    } else {
      const t = dd > 0 ? budget / dd : 0;
      out.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
      break;
    }
  }
  return out;
}

/** Player's decision on a pending engagement. 'fight' leaves the engagement active for the BattleScene. */
export function decideEngagement(world: WorldState, engagementId: EngagementId, decision: 'fight' | 'autoresolve' | 'retreat', out: SimEvent[], terrain: TerrainQuery): boolean {
  const e = world.engagements[engagementId];
  if (!e || e.status === 'resolved') return false;
  if (decision === 'fight') {
    e.status = 'active';
    return true;
  }
  if (decision === 'retreat') {
    // The player's armies fall back: a rearguard is lost, then one day's march toward a friendly settlement.
    for (const side of [0, 1] as const) {
      const share = retreatLossShare(world, engagementId, side);
      for (const id of e.sides[side]) {
        const a = world.armies[id];
        if (!a || !world.factions[a.factionId]?.isPlayer) continue;
        loseShare(world, a, share);
        a.engagementId = null;
        a.status = 'camped';
        a.morale = Math.max(5, a.morale - 10);
        const dest = retreatDestination(world, a);
        const target = dest ? (dest.kind === 'garrison' ? world.settlements[dest.settlementId]! : dest) : { x: a.x - (e.x - a.x) * 3, z: a.z - (e.z - a.z) * 3 };
        const path = dayMarch(world, a, target.x, target.z, terrain);
        const end = path[path.length - 1]!;
        a.order = { kind: 'retreat', x: end.x, z: end.z };
        a.path = path;
        a.pathIndex = path.length > 1 ? 1 : 0;
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
  // Write-back pushes the history entry and the chronicle line (DESIGN_SPEC §6.12 items 1-8).
  applyBattleOutcome(world, engagementId, outcome, out);
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
