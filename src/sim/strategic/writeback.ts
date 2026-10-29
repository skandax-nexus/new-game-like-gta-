/**
 * Battle outcome write-back to the world (DESIGN_SPEC §6.12 items 1-8, §6.8 prisoners, §6.11 commanders and
 * experience). OWNER: Simulation Engineer - Strategic World Simulation (SIM-01). GP-01 fills the BattleOutcome; this
 * module stamps `day`, `placeName`, `warScore` and `chronicle` and applies:
 *   1 casualties by armyUnitId (units below 10% merge into a same-class unit of the same army);
 *   2 army morale winner +10 / loser -25 (5..100), fatigue +0.1 / +0.2;
 *   3 the loser retreats along roads to the nearest friendly settlement or depot, or disbands if it has none; the
 *     armies holding the field resume their orders (resumeAfterBattle);
 *   4 captured supply: 50% of the grain carried by destroyed enemy supply trains;
 *   5 prisoners (AI winners decide at once: ransom if greedy / expansionist, else release), commander fate (killed /
 *     wounded -0.3 health / captured), experience (+0.1 won / +0.05 lost, +0.05 per enemy formation routed);
 *   6 war score 20 x (enemy losses - own losses) / both starts to the winner (+-20);
 *   7 chronicle "The Battle of {place}: {winner} defeated {loser}; {killed} fell.";
 *   8 a won siege battle captures the settlement (siege.ts).
 * Idempotent per engagement + outcome. Statistics: battles_won / battles_fought / enemies_killed / soldiers_lost /
 * largest_battle / formations_routed.
 */
import type { ArmyState, BattleOutcome, EngagementId, FactionId, SettlementState, SideIndex, SimEvent, TerrainQuery, Vec2, WorldState } from '../../core/types';
import { isRebelFaction } from '../../core/types';
import { FACTIONS } from '../../data/factions';
import { REGION_FEATURES } from '../../data/region';
import { RULES } from '../../data/rules';
import { removeArmy, orderArmy } from './armies';
import { addChronicle, addStat, maxStat, notifyPlayer, pushBattleHistory, regionTerrain, stableKeys, today } from './state';
import { relationOf } from './treaties';

type CaptureFn = (world: WorldState, s: SettlementState, captor: FactionId, out: SimEvent[], how: 'assault' | 'surrender' | 'undefended') => void;
type RebelsDefeatedFn = (world: WorldState, settlementId: string, out: SimEvent[]) => void;
type DeathFn = (world: WorldState, characterId: string, out: SimEvent[]) => void;
const hooks: { capture: CaptureFn | null; rebelsDefeated: RebelsDefeatedFn | null; death: DeathFn | null } = { capture: null, rebelsDefeated: null, death: null };
/** siege.ts / politics.ts / dynasty.ts register their handlers (avoids import cycles). */
export function registerWritebackHooks(h: Partial<typeof hooks>): void {
  Object.assign(hooks, h);
}

/** Display name of a side: faction short name, or "the rebels of X". */
export function sideName(world: WorldState, factionId: FactionId, armyIds: readonly string[]): string {
  if (isRebelFaction(factionId)) {
    const a = armyIds.map((id) => world.armies[id]).find((x) => x?.rebelSettlementId);
    const s = a?.rebelSettlementId ? world.settlements[a.rebelSettlementId] : null;
    return s ? `the rebels of ${s.name}` : 'the rebels';
  }
  return FACTIONS[factionId]?.shortName ?? factionId;
}

/** Position of a REGION_FEATURES entry: a bridge/ford crossing near its settlement, else the settlement. */
export function featurePosition(world: WorldState, featureId: string): Vec2 | null {
  const f = REGION_FEATURES.find((x) => x.id === featureId);
  if (!f) return null;
  const s = world.settlements[f.nearSettlement];
  if (!s) return null;
  if (f.kind === 'bridge' || f.kind === 'ford') {
    const terrain = regionTerrain(world);
    let best: Vec2 | null = null;
    let bd = Infinity;
    for (const eid of world.roads.adjacency[`node_${s.id}`] ?? []) {
      const e = world.roads.edges[eid];
      if (!e || (f.kind === 'bridge' ? !e.bridge : !e.ford)) continue;
      for (const p of e.points) {
        if (!terrain.isWater(p.x, p.z)) continue;
        const d = (p.x - s.x) * (p.x - s.x) + (p.z - s.z) * (p.z - s.z);
        if (d < bd) {
          bd = d;
          best = { x: p.x, z: p.z };
        }
      }
    }
    if (best) return best;
  }
  return { x: s.x, z: s.z };
}

/** `{place}` of the chronicle line: nearest REGION_FEATURES name within 600 m, else the nearest settlement. */
export function battlePlaceName(world: WorldState, x: number, z: number): string {
  let best: string | null = null;
  let bd = 600 * 600;
  for (const f of REGION_FEATURES) {
    const p = featurePosition(world, f.id);
    if (!p) continue;
    const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
    if (d <= bd) {
      bd = d;
      best = f.name.replace(/^The /, 'the ');
    }
  }
  if (best) return best;
  let sn = 'the plains';
  let sd = Infinity;
  for (const id of stableKeys('settlements', world.settlements as Record<string, unknown>)) {
    const s = world.settlements[id]!;
    const d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
    if (d < sd) {
      sd = d;
      sn = s.name;
    }
  }
  return sn;
}

function capitalizeFirst(t: string): string {
  return t.length ? t[0]!.toUpperCase() + t.slice(1) : t;
}

/** War score change from side 0's perspective (§6.12 item 6). */
export function battleWarScore(outcome: BattleOutcome): number {
  const [s0, s1] = outcome.sides;
  const lost0 = s0.startSoldiers - s0.survivors;
  const lost1 = s1.startSoldiers - s1.survivors;
  const both = Math.max(1, s0.startSoldiers + s1.startSoldiers);
  const v = (RULES.diplomacy.warScore.battlePerShare * (lost1 - lost0)) / both;
  return Math.max(-20, Math.min(20, v));
}

/** Minimum distance (map m) of a retreat destination that is not a walled refuge. */
export const RETREAT_MIN_DISTANCE = 300;
/** A walled own settlement within this distance takes the beaten army inside its walls. */
export const REFUGE_DISTANCE = 600;

/**
 * Where a beaten army falls back (§6.12 item 3): inside the walls of a nearby own fortified settlement, else the nearest
 * own settlement or depot at least 300 m away (so it actually breaks contact). Null = nowhere (it disbands).
 */
export function retreatDestination(world: WorldState, a: ArmyState): { kind: 'garrison'; settlementId: string } | { kind: 'point'; x: number; z: number } | null {
  let refuge: SettlementState | null = null;
  let rd = REFUGE_DISTANCE * REFUGE_DISTANCE;
  let best: Vec2 | null = null;
  let bd = Infinity;
  const min2 = RETREAT_MIN_DISTANCE * RETREAT_MIN_DISTANCE;
  for (const id of stableKeys('settlements', world.settlements as Record<string, unknown>)) {
    const s = world.settlements[id]!;
    if (s.ownerFactionId !== a.factionId || s.besiegedBy) continue;
    const d = (s.x - a.x) * (s.x - a.x) + (s.z - a.z) * (s.z - a.z);
    if (s.fortLevel >= 1 && d <= rd) {
      rd = d;
      refuge = s;
    }
    if (d >= min2 && d < bd) {
      bd = d;
      best = { x: s.x + s.radius * 0.5, z: s.z + s.radius * 0.5 };
    }
  }
  if (refuge) return { kind: 'garrison', settlementId: refuge.id };
  for (const id of stableKeys('depots', world.depots as Record<string, unknown>)) {
    const d0 = world.depots[id]!;
    if (d0.factionId !== a.factionId) continue;
    const d = (d0.x - a.x) * (d0.x - a.x) + (d0.z - a.z) * (d0.z - a.z);
    if (d >= min2 && d < bd) {
      bd = d;
      best = { x: d0.x, z: d0.z };
    }
  }
  return best ? { kind: 'point', x: best.x, z: best.z } : null;
}

/** AI prisoner decision (§6.8): ransom if greedy / expansionist, else release. */
function aiPrisonerDecision(world: WorldState, factionId: FactionId): 'ransom' | 'release' {
  const f = world.factions[factionId];
  const ruler = f?.rulerId ? world.characters[f.rulerId] : null;
  return f?.ai.personality === 'expansionist' || ruler?.traits.includes('greedy') ? 'ransom' : 'release';
}

/**
 * Prisoner decision for a won battle: ransom (the loser pays 5 per prisoner, capped at 30% of its treasury; opinion -5)
 * or release (opinion +5 per 100 released, max +20). Returns a reason when refused.
 */
export const PRISONER_REASONS = {
  noBattle: 'No such battle',
  notVictor: 'Only the victor decides the fate of prisoners',
  done: 'The prisoners have already been dealt with',
} as const;

export function validatePrisoners(world: WorldState, factionId: FactionId, engagementId: string): string | null {
  const e = world.engagements[engagementId];
  if (!e || !e.outcome) return PRISONER_REASONS.noBattle;
  const o = e.outcome;
  if (o.winner === null || o.sides[o.winner].factionId !== factionId) return PRISONER_REASONS.notVictor;
  if (e.prisonerDecision !== null) return PRISONER_REASONS.done;
  return null;
}

export function decidePrisoners(world: WorldState, factionId: FactionId, engagementId: string, decision: 'ransom' | 'release', out: SimEvent[]): string | null {
  const reason = validatePrisoners(world, factionId, engagementId);
  if (reason) return reason;
  const e = world.engagements[engagementId]!;
  const o = e.outcome!;
  if (o.winner === null) return PRISONER_REASONS.notVictor;
  const loser = o.sides[(1 - o.winner) as SideIndex].factionId;
  const prisoners = o.sides[o.winner].prisoners;
  e.prisonerDecision = decision;
  const rel = relationOf(world, factionId, loser);
  const pb = RULES.battle.prisoners;
  if (decision === 'ransom') {
    const lf = world.factions[loser];
    const wf = world.factions[factionId];
    if (lf && wf) {
      const pay = Math.min(prisoners * pb.ransomPerSoldier, Math.max(0, lf.treasury) * 0.3);
      lf.treasury -= pay;
      wf.treasury += pay;
      notifyPlayer(world, out, factionId, 'info', `The prisoners were ransomed for ${Math.round(pay)} wealth.`);
    }
    if (rel) rel.opinion = Math.max(-100, rel.opinion - 5);
  } else {
    if (rel) rel.opinion = Math.min(100, rel.opinion + Math.min(20, pb.releaseOpinion * (prisoners / 100)));
    notifyPlayer(world, out, factionId, 'info', 'The prisoners were released.');
  }
  return null;
}

/** Apply a battle outcome to the armies of an engagement (items 1-8). Idempotent. */
export function applyBattleOutcome(world: WorldState, engagementId: EngagementId, outcome: BattleOutcome, out: SimEvent[]): void {
  const e = world.engagements[engagementId];
  if (!e) return;
  if (e.status === 'resolved' && e.outcome === outcome) return;
  e.outcome = outcome;
  e.status = 'resolved';
  e.battle = null;
  const day = today(world);
  outcome.day = day;
  outcome.warScore = battleWarScore(outcome);
  const place = battlePlaceName(world, e.x, e.z);
  outcome.placeName = place;
  const names = [sideName(world, outcome.sides[0].factionId, e.sides[0]), sideName(world, outcome.sides[1].factionId, e.sides[1])];
  const killed = outcome.sides[0].killed + outcome.sides[1].killed;
  outcome.chronicle =
    outcome.winner === null
      ? `The Battle of ${place}: neither ${names[0]} nor ${names[1]} could claim the field; ${killed} fell.`
      : `The Battle of ${place}: ${capitalizeFirst(names[outcome.winner]!)} defeated ${names[1 - outcome.winner]}; ${killed} fell.`;
  pushBattleHistory(world, outcome);
  const engaged = outcome.sides[0].startSoldiers + outcome.sides[1].startSoldiers;
  const terrain = regionTerrain(world);
  // Field armies that hold the field (winners, the defender of a draw, rebels) - they resume their orders at the end.
  const holders: ArmyState[] = [];
  // Rebel settlements involved (read before armies are removed).
  const rebelSettlement: [string | null, string | null] = [null, null];
  for (const side of [0, 1] as const) {
    for (const id of e.sides[side]) {
      const a = world.armies[id];
      if (a?.rebelSettlementId) rebelSettlement[side] = a.rebelSettlementId;
    }
  }

  for (const side of [0, 1] as const) {
    const res = outcome.sides[side];
    const won = outcome.winner === side;
    const lost = outcome.winner !== null && !won;
    const fid = res.factionId;
    const other = outcome.sides[(1 - side) as SideIndex];
    // Statistics.
    addStat(world, fid, 'battles_fought', 1);
    if (won) addStat(world, fid, 'battles_won', 1);
    addStat(world, fid, 'enemies_killed', other.killed);
    addStat(world, fid, 'soldiers_lost', res.killed + res.captured);
    addStat(world, fid, 'formations_routed', other.routs);
    maxStat(world, fid, 'largest_battle', engaged);
    // 1 casualties + experience per unit.
    const survivors = new Map<string, number>();
    const routedBy = new Map<string, number>();
    for (const fr of res.formations) {
      if (!fr.armyUnitId) continue;
      survivors.set(fr.armyUnitId, (survivors.get(fr.armyUnitId) ?? 0) + fr.survivors);
      routedBy.set(fr.armyUnitId, (routedBy.get(fr.armyUnitId) ?? 0) + fr.routedEnemies);
    }
    for (const armyId of e.sides[side]) {
      const a = world.armies[armyId];
      if (!a) continue;
      let lostTrainGrain = 0;
      for (const u of a.units) {
        const sv = survivors.get(u.id);
        if (sv === undefined) continue;
        if (u.unitClass === 'supply_train' && sv <= 0) lostTrainGrain += Math.min(a.supply.food, u.soldiers * RULES.supply.cartLoad);
        u.soldiers = Math.max(0, Math.min(u.soldiers, sv));
        const ex = RULES.battle.experience;
        if (u.soldiers > 0) u.experience = Math.min(1, u.experience + (won ? ex.winGain : ex.lossGain) + 0.05 * (routedBy.get(u.id) ?? 0));
      }
      a.units = a.units.filter((u) => u.soldiers > 0);
      // Units below 10% strength merge into a same-class unit of the same army.
      for (const u of a.units.slice()) {
        if (u.soldiers >= 0.1 * u.maxSoldiers) continue;
        const host = a.units.find((o) => o !== u && o.unitClass === u.unitClass && o.soldiers >= 0.1 * o.maxSoldiers);
        if (!host) continue;
        host.soldiers += u.soldiers;
        a.units = a.units.filter((o) => o !== u);
      }
      // 4 captured supply: the winner takes half of what the destroyed trains carried.
      if (lostTrainGrain > 0) {
        a.supply.food = Math.max(0, a.supply.food - lostTrainGrain);
        const taken = outcome.sides[(1 - side) as SideIndex].capturedSupply > 0 ? 0 : lostTrainGrain * 0.5;
        const winnerArmy = world.armies[e.sides[(1 - side) as SideIndex][0] ?? ''];
        if (winnerArmy && taken > 0) winnerArmy.supply.food += taken;
      }
      // 2 morale + fatigue.
      a.morale = Math.max(5, Math.min(100, a.morale + (won ? 10 : lost ? -25 : -5)));
      a.fatigue = Math.min(1, a.fatigue + (won ? 0.1 : lost ? 0.2 : 0.15));
      for (const u of a.units) {
        u.morale = Math.max(5, Math.min(100, u.morale + (won ? 10 : lost ? -25 : -5)));
        u.fatigue = a.fatigue;
      }
      a.engagementId = null;
      a.status = 'camped';
      a.path = [];
      a.pathIndex = 0;
      if (a.units.length === 0) {
        removeArmy(world, a, false);
        continue;
      }
      // Garrison armies return to the walls.
      if (a.id.startsWith('garrison_')) continue;
      // 3 the loser (or, on a draw, the attacker) falls back.
      const fallsBack = outcome.winner === null ? side === 0 : lost;
      if (!fallsBack || isRebelFaction(a.factionId)) holders.push(a);
      if (fallsBack && !isRebelFaction(a.factionId)) {
        const to = retreatDestination(world, a);
        if (!to) {
          removeArmy(world, a, false);
          notifyPlayer(world, out, a.factionId, 'danger', `${a.name} had nowhere to retreat and scattered.`);
          continue;
        }
        if (to.kind === 'garrison') orderArmy(world, a.id, { kind: 'garrison', settlementId: to.settlementId }, terrain);
        else orderArmy(world, a.id, { kind: 'retreat', x: to.x, z: to.z }, terrain);
      }
    }
    // Captured supply reported by the battle sim.
    if (res.capturedSupply > 0) {
      const a = world.armies[e.sides[side][0] ?? ''];
      if (a) a.supply.food += res.capturedSupply;
    }
    // 5 commander fate.
    if (res.commanderId) {
      const c = world.characters[res.commanderId];
      if (c && c.alive) {
        if (res.commanderFate === 'killed') {
          if (hooks.death) hooks.death(world, c.id, out);
          else {
            c.alive = false;
            c.deathYear = world.calendar.year;
            out.push({ kind: 'character_died', characterId: c.id });
          }
        } else if (res.commanderFate === 'wounded') c.health = Math.max(0.05, c.health - 0.3);
        else if (res.commanderFate === 'captured' && outcome.winner !== null) {
          c.captiveOf = outcome.sides[outcome.winner].factionId;
          if (c.armyId) {
            const ca = world.armies[c.armyId];
            if (ca && ca.commanderId === c.id) ca.commanderId = null;
            c.armyId = null;
          }
        }
      }
    }
  }
  // Garrison armies hand their survivors back to the settlement.
  for (const side of [0, 1] as const) {
    for (const armyId of e.sides[side]) {
      const a = world.armies[armyId];
      if (!a || !a.id.startsWith('garrison_')) continue;
      const s = world.settlements[a.id.slice('garrison_'.length)];
      if (s && s.ownerFactionId === a.factionId) for (const u of a.units) s.garrison.push(u);
      delete world.armies[a.id];
    }
  }
  // 6 war score between the two realms.
  const fa = outcome.sides[0].factionId;
  const fb = outcome.sides[1].factionId;
  const rel = relationOf(world, fa, fb);
  if (rel && rel.atWar) {
    const fromA = fa === rel.a ? outcome.warScore : -outcome.warScore;
    rel.warScore = Math.max(-100, Math.min(100, rel.warScore + fromA));
  }
  // 5 prisoners: AI winners decide at once.
  if (outcome.winner !== null) {
    const wf = outcome.sides[outcome.winner].factionId;
    if (world.factions[wf] && !world.factions[wf]!.isPlayer && outcome.sides[outcome.winner].prisoners > 0) decidePrisoners(world, wf, engagementId, aiPrisonerDecision(world, wf), out);
  }
  // 7 chronicle.
  const wf = outcome.winner === null ? null : outcome.sides[outcome.winner].factionId;
  addChronicle(world, wf && !isRebelFaction(wf) ? wf : null, outcome.chronicle, 1);
  // 8 siege capture; rebels defeated.
  if (e.kind === 'siege' && e.settlementId && outcome.winner === 0) {
    const s = world.settlements[e.settlementId];
    if (s && hooks.capture && s.ownerFactionId !== outcome.sides[0].factionId) hooks.capture(world, s, outcome.sides[0].factionId, out, 'assault');
  }
  for (const side of [0, 1] as const) {
    if (!isRebelFaction(outcome.sides[side].factionId) || outcome.winner === side) continue;
    const sid = rebelSettlement[side];
    // A beaten rebel host scatters.
    for (const id of e.sides[side]) {
      const a = world.armies[id];
      if (a) removeArmy(world, a, false);
    }
    if (sid && hooks.rebelsDefeated) hooks.rebelsDefeated(world, sid, out);
  }
  for (const a of holders) resumeAfterBattle(world, a, terrain);
  out.push({ kind: 'engagement_resolved', engagementId, winnerFactionId: wf });
}

/**
 * An army that holds the field takes up its order again from where the battle caught it: a march, a siege camp, a
 * garrison post, a patrol, an escort (`attack_army` pursuits re-plan on their own; idle / forage stay put). Without
 * this the write-back's cleared path left it camped with a stale order - e.g. standing in the middle of a ford for
 * the rest of the campaign while the enemy re-engaged it every week.
 */
export function resumeAfterBattle(world: WorldState, a: ArmyState, terrain: TerrainQuery): void {
  if (world.armies[a.id] !== a || a.engagementId || a.status !== 'camped' || a.units.length === 0) return;
  const o = a.order;
  if (o.kind === 'idle' || o.kind === 'forage' || o.kind === 'attack_army') return;
  // A won assault captured the town: the siege order is done.
  if ((o.kind === 'besiege' || o.kind === 'assault' || o.kind === 'raid') && world.settlements[o.settlementId]?.ownerFactionId === a.factionId) {
    a.order = { kind: 'idle' };
    return;
  }
  orderArmy(world, a.id, o, terrain);
}
