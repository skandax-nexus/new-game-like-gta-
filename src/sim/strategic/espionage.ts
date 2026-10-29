/**
 * Espionage and intelligence (DESIGN_SPEC §7.11). OWNER: Simulation Engineer - Strategic World Simulation (SIM-01).
 *
 *  - Agents: at most 1 + spymaster intrigue / 5 active per realm. A mission's progress per day is
 *    (1 / missionDays) x (0.5 + skill/20) x (1 + network) x espionage modifier / (1 + target counterIntel) - the
 *    nominal days (intel 20, counter 30, sabotage 25, incite 35, rumors 30, protect 30) at skill 10 without a network
 *    (the spec's 0.03/day base is 1/33 days). Risk per day = 0.01 x (1 + 1.5 x target counterIntel) x
 *    (1.5 - skill/20); a failed roll captures the agent: grievance `spy_caught` (-20), a character agent is held
 *    prisoner (captiveOf), the network on that realm shrinks by 0.1.
 *  - On success (network +0.1): gather_intel intel +0.4 and the target's armies visible for 60 days;
 *    counter_intelligence own counterIntel +0.3 for 90 days; sabotage_supply 40% of a depot's or the largest army's
 *    food, or -0.4 condition on a road of the target settlement; incite_unrest +0.2 unrest (+0.3 where a claimant
 *    lives); spread_rumors legitimacy -0.05 (halved by protect_court), stability -0.03, everyone's opinion -10;
 *    protect_court halves plot legitimacy losses for 120 days.
 *  - Intel decays 0.08 a month (daily share). Tiers: < 0.3 scout range + owners; 0.3-0.6 sizes +-25%, treasury and
 *    stability brackets; >= 0.6 exact numbers, governors, loyalty, AI goal (`intelView`).
 */
import type { AgentId, ArmyState, CharacterId, FactionId, SettlementId, SimEvent, SpyAgent, SpyMission, WorldState } from '../../core/types';
import { nextWorldId, sortedKeys } from '../../core/ids';
import { BALANCE } from '../../data/balance';
import { FACTIONS } from '../../data/factions';
import { RULES } from '../../data/rules';
import { addGrievance, addOpinion } from './diplomacy';
import { factionMod } from './modifiers';
import { totalDays } from './seasons';
import { addChronicle, notifyPlayer, worldRandom } from './state';
import { estimatedSoldiers } from './visibility';

const E = RULES.espionage;

export const ESPIONAGE_REASONS = {
  noTarget: 'No such realm',
  self: 'Choose a rival realm',
  dead: 'That realm has fallen',
  tooMany: (n: number) => `Your spymaster can run at most ${n} agent${n === 1 ? '' : 's'}`,
  needSettlement: 'Choose one of their settlements',
  notTheirs: 'That settlement is not theirs',
  noAgent: 'No such agent',
  notYourAgent: 'Not your agent',
  notActive: 'That agent is not in the field',
  badCharacter: 'That person cannot be sent',
  busy: 'That person is already on a mission',
} as const;

function today(world: WorldState): number {
  return totalDays(world.calendar);
}

/** How much `observer` knows about `target` (0..1). */
export function intelLevel(world: WorldState, observer: FactionId, target: FactionId): number {
  if (observer === target) return 1;
  return world.espionage.intel[observer]?.[target]?.level ?? 0;
}

function intelRow(world: WorldState, observer: FactionId, target: FactionId): { level: number; lastUpdatedDay: number; armiesVisibleUntilDay: number | null } {
  const row = (world.espionage.intel[observer] ??= {});
  return (row[target] ??= { level: 0, lastUpdatedDay: today(world), armiesVisibleUntilDay: null });
}

export function networkLevel(world: WorldState, owner: FactionId, target: FactionId): number {
  return world.espionage.network[owner]?.[target] ?? 0;
}

function addNetwork(world: WorldState, owner: FactionId, target: FactionId, d: number): void {
  const row = (world.espionage.network[owner] ??= {});
  row[target] = Math.max(0, Math.min(1, (row[target] ?? 0) + d));
}

/** Max active agents: 1 + spymaster intrigue / 5. */
export function maxAgents(world: WorldState, factionId: FactionId): number {
  const f = world.factions[factionId];
  const sm = f?.council.spymaster ? world.characters[f.council.spymaster] : null;
  return 1 + Math.floor((sm && sm.alive ? sm.skills.intrigue : 0) / 5);
}

export function activeAgents(world: WorldState, factionId: FactionId): SpyAgent[] {
  return sortedKeys(world.espionage.agents)
    .map((id) => world.espionage.agents[id] as SpyAgent)
    .filter((a) => a.ownerFactionId === factionId && a.status === 'active');
}

/** Target counter-intelligence (0 when expired). */
export function counterIntelOf(world: WorldState, factionId: FactionId): number {
  const f = world.factions[factionId];
  if (!f || f.counterIntelUntilDay === null || f.counterIntelUntilDay <= today(world)) return 0;
  return f.counterIntel;
}

/** Daily progress of a mission. */
export function missionProgressPerDay(world: WorldState, a: SpyAgent): number {
  return (
    (1 / E.missionDays[a.mission]) *
    (0.5 + a.skill / 20) *
    (1 + networkLevel(world, a.ownerFactionId, a.targetFactionId)) *
    factionMod(world, a.ownerFactionId, 'espionage') /
    (1 + counterIntelOf(world, a.targetFactionId))
  );
}

/** Daily capture risk of a mission. */
export function missionRiskPerDay(world: WorldState, a: SpyAgent): number {
  return BALANCE.espionage.baseRiskPerDay * (1 + E.counterIntelRiskWeight * counterIntelOf(world, a.targetFactionId)) * Math.max(0, 1.5 - a.skill / 20);
}

export function validateSpyMission(world: WorldState, owner: FactionId, target: FactionId, mission: SpyMission, settlementId: SettlementId | null, characterId: CharacterId | null): string | null {
  const selfMission = mission === 'counter_intelligence' || mission === 'protect_court';
  if (!selfMission) {
    if (!world.factions[target]) return ESPIONAGE_REASONS.noTarget;
    if (target === owner) return ESPIONAGE_REASONS.self;
    if (!world.factions[target]!.alive) return ESPIONAGE_REASONS.dead;
  }
  const max = maxAgents(world, owner);
  if (activeAgents(world, owner).length >= max) return ESPIONAGE_REASONS.tooMany(max);
  if (mission === 'incite_unrest') {
    if (!settlementId) return ESPIONAGE_REASONS.needSettlement;
    if (world.settlements[settlementId]?.ownerFactionId !== target) return ESPIONAGE_REASONS.notTheirs;
  }
  if (characterId) {
    const c = world.characters[characterId];
    if (!c || c.factionId !== owner || !c.alive || c.captiveOf) return ESPIONAGE_REASONS.badCharacter;
    if (activeAgents(world, owner).some((x) => x.characterId === characterId)) return ESPIONAGE_REASONS.busy;
  }
  return null;
}

/** spy_mission. Defensive missions (counter-intelligence, protect court) target the owner itself. */
export function startMission(world: WorldState, owner: FactionId, target: FactionId, mission: SpyMission, settlementId: SettlementId | null, characterId: CharacterId | null): { reason: string | null; agentId: AgentId | null } {
  const selfMission = mission === 'counter_intelligence' || mission === 'protect_court';
  const tgt = selfMission ? owner : target;
  const reason = validateSpyMission(world, owner, tgt, mission, settlementId, characterId);
  if (reason) return { reason, agentId: null };
  const f = world.factions[owner];
  const sm = f?.council.spymaster ? world.characters[f.council.spymaster] : null;
  const skill = characterId ? (world.characters[characterId]?.skills.intrigue ?? 8) : sm && sm.alive ? Math.round(sm.skills.intrigue * 0.6) : 8;
  const agent: SpyAgent = {
    id: nextWorldId(world, 'agent') as AgentId,
    characterId,
    ownerFactionId: owner,
    targetFactionId: tgt,
    targetSettlementId: settlementId,
    mission,
    progress: 0,
    risk: 0,
    skill,
    status: 'active',
    startedDay: today(world),
  };
  agent.risk = missionRiskPerDay(world, agent);
  world.espionage.agents[agent.id] = agent;
  return { reason: null, agentId: agent.id };
}

/** Baseline-compatible wrapper. */
export function startSpyMission(world: WorldState, owner: FactionId, target: FactionId, mission: SpyMission, settlementId: SettlementId | null, characterId: CharacterId | null, out: SimEvent[]): boolean {
  void out;
  return startMission(world, owner, target, mission, settlementId, characterId).reason === null;
}

export function recallAgent(world: WorldState, factionId: FactionId, agentId: AgentId): string | null {
  const a = world.espionage.agents[agentId];
  if (!a) return ESPIONAGE_REASONS.noAgent;
  if (a.ownerFactionId !== factionId) return ESPIONAGE_REASONS.notYourAgent;
  if (a.status !== 'active') return ESPIONAGE_REASONS.notActive;
  a.status = 'returned';
  return null;
}

/** Legitimacy loss from a plot (spread_rumors), halved while protect_court runs. */
export function plotLegitimacyLoss(world: WorldState, factionId: FactionId, loss: number): number {
  const f = world.factions[factionId];
  if (f && f.protectCourtUntilDay !== null && f.protectCourtUntilDay > today(world)) return loss * (1 - E.effects.protect_court.plotReduction);
  return loss;
}

function largestArmy(world: WorldState, factionId: FactionId): ArmyState | null {
  let best: ArmyState | null = null;
  let food = -1;
  for (const id of sortedKeys(world.armies)) {
    const a = world.armies[id] as ArmyState;
    if (a.factionId === factionId && a.supply.food > food) {
      food = a.supply.food;
      best = a;
    }
  }
  return best;
}

function succeed(world: WorldState, a: SpyAgent, out: SimEvent[]): string {
  const d = today(world);
  const owner = a.ownerFactionId;
  const target = a.targetFactionId;
  const tName = FACTIONS[target]?.shortName ?? target;
  switch (a.mission) {
    case 'gather_intel': {
      const st = intelRow(world, owner, target);
      st.level = Math.min(1, st.level + E.effects.gather_intel.intel);
      st.lastUpdatedDay = d;
      st.armiesVisibleUntilDay = d + E.effects.gather_intel.revealDays;
      return `Our agent returned from ${tName} with their muster rolls.`;
    }
    case 'counter_intelligence': {
      const f = world.factions[owner];
      if (f) {
        f.counterIntel = Math.min(1, counterIntelOf(world, owner) + E.effects.counter_intelligence.counterIntel);
        f.counterIntelUntilDay = d + E.effects.counter_intelligence.days;
      }
      return 'Our watchers now guard the court and the roads.';
    }
    case 'sabotage_supply': {
      const fx = E.effects.sabotage_supply;
      for (const id of sortedKeys(world.depots)) {
        const dp = world.depots[id]!;
        if (dp.factionId === target && dp.food > 0) {
          dp.food *= 1 - fx.foodLoss;
          return `A depot of ${tName} went up in flames.`;
        }
      }
      const army = largestArmy(world, target);
      if (army && army.supply.food > 0) {
        army.supply.food *= 1 - fx.foodLoss;
        return `The baggage of ${army.name} was spoiled.`;
      }
      const s = a.targetSettlementId ? world.settlements[a.targetSettlementId] : world.factions[target]?.capitalSettlementId ? world.settlements[world.factions[target]!.capitalSettlementId!] : null;
      const node = s ? world.roads.adjacency[`node_${s.id}`] : undefined;
      const e = node && node[0] ? world.roads.edges[node[0]] : undefined;
      if (e) {
        e.condition = Math.max(0, e.condition - fx.roadDamage);
        return `A road of ${tName} was wrecked.`;
      }
      return 'Our saboteurs found nothing worth burning.';
    }
    case 'incite_unrest': {
      const s = a.targetSettlementId ? world.settlements[a.targetSettlementId] : null;
      if (!s) return 'The agitators found no audience.';
      const claimant = sortedKeys(world.characters).some((cid) => {
        const c = world.characters[cid]!;
        return c.alive && c.roles.includes('claimant') && (c.locationSettlementId === s.id || (c.governsProvinceId !== null && c.governsProvinceId === s.provinceId));
      });
      s.unrest = Math.min(1, s.unrest + (claimant ? E.effects.incite_unrest.withClaimant : E.effects.incite_unrest.unrest));
      return `Agitators stirred up ${s.name}.`;
    }
    case 'spread_rumors': {
      const fx = E.effects.spread_rumors;
      const f = world.factions[target];
      if (f) {
        f.legitimacy = Math.max(0, f.legitimacy + plotLegitimacyLoss(world, target, fx.legitimacy));
        f.stability = Math.max(0, f.stability + fx.stability);
      }
      for (const cid of sortedKeys(world.factions)) if (cid !== target) addOpinion(world, cid, target, fx.opinion);
      return `Rumours about the court of ${tName} spread in every bazaar.`;
    }
    case 'protect_court': {
      const f = world.factions[owner];
      if (f) f.protectCourtUntilDay = d + E.effects.protect_court.days;
      return 'The court is guarded against plots.';
    }
    default:
      return 'The mission ended.';
  }
}

function capture(world: WorldState, a: SpyAgent, out: SimEvent[]): void {
  a.status = a.characterId ? 'captured' : 'dead';
  if (a.targetFactionId !== a.ownerFactionId) {
    addGrievance(world, a.targetFactionId, a.ownerFactionId, 'spy_caught', E.caughtOpinion);
    addNetwork(world, a.ownerFactionId, a.targetFactionId, -0.1);
  }
  if (a.characterId) {
    const c = world.characters[a.characterId];
    if (c && a.targetFactionId !== a.ownerFactionId) c.captiveOf = a.targetFactionId;
  }
  const text = a.characterId ? `${world.characters[a.characterId]?.name ?? 'Our agent'} was seized by ${FACTIONS[a.targetFactionId]?.shortName ?? a.targetFactionId}.` : 'An agent was caught and executed.';
  out.push({ kind: 'spy_report', agentId: a.id, success: false, text });
  notifyPlayer(world, out, a.ownerFactionId, 'danger', text);
  notifyPlayer(world, out, a.targetFactionId, 'info', `We caught a spy of ${FACTIONS[a.ownerFactionId]?.shortName ?? a.ownerFactionId}.`);
}

export function updateEspionageDaily(world: WorldState, out: SimEvent[]): void {
  const d = today(world);
  for (const id of sortedKeys(world.espionage.agents)) {
    const a = world.espionage.agents[id]!;
    if (a.status !== 'active') continue;
    if (!world.factions[a.targetFactionId]?.alive || !world.factions[a.ownerFactionId]?.alive) {
      a.status = 'returned';
      continue;
    }
    a.risk = missionRiskPerDay(world, a);
    if (worldRandom(world) < a.risk) {
      capture(world, a, out);
      continue;
    }
    a.progress = Math.min(1, a.progress + missionProgressPerDay(world, a));
    if (a.progress >= 1) {
      a.status = 'returned';
      const text = succeed(world, a, out);
      if (a.targetFactionId !== a.ownerFactionId) addNetwork(world, a.ownerFactionId, a.targetFactionId, 0.1);
      out.push({ kind: 'spy_report', agentId: a.id, success: true, text });
      notifyPlayer(world, out, a.ownerFactionId, 'success', text);
      addChronicle(world, a.ownerFactionId, text, 0);
    }
  }
  // Expiring counter-intelligence.
  for (const fid of sortedKeys(world.factions)) {
    const f = world.factions[fid]!;
    if (f.counterIntelUntilDay !== null && f.counterIntelUntilDay <= d) {
      f.counterIntel = 0;
      f.counterIntelUntilDay = null;
    }
  }
  // Intel decays 0.08 a month.
  const decay = BALANCE.espionage.intelDecayPerMonth / 30;
  for (const obs of sortedKeys(world.espionage.intel)) {
    const row = world.espionage.intel[obs]!;
    for (const t of sortedKeys(row)) {
      if (t === obs) continue;
      const st = row[t]!;
      st.level = Math.max(0, st.level - decay);
    }
  }
  // Keep the agent table small: drop finished agents after 90 days.
  for (const id of sortedKeys(world.espionage.agents)) {
    const a = world.espionage.agents[id]!;
    if (a.status !== 'active' && d - a.startedDay > 120) delete world.espionage.agents[id];
  }
}

/** Raise every rival's intel on `factionId` (a leaking advisor, §7.12). */
export function leakIntel(world: WorldState, factionId: FactionId, amount: number): void {
  for (const fid of sortedKeys(world.factions)) {
    if (fid === factionId) continue;
    const st = intelRow(world, fid, factionId);
    st.level = Math.min(1, st.level + amount);
    st.lastUpdatedDay = today(world);
  }
}

// ---------------------------------------------------------------------------------------------------
// Intel-tier view (UI selector)
// ---------------------------------------------------------------------------------------------------

export type IntelTier = 0 | 1 | 2;

export interface IntelView {
  factionId: FactionId;
  tier: IntelTier;
  level: number;
  /** Estimated soldiers per army id (exact at tier 2, +-25% at tier 1; only armies in sight at tier 0). */
  armies: { armyId: string; soldiers: number; exact: boolean }[];
  treasuryBracket: string | null;
  stabilityBracket: string | null;
  treasury: number | null;
  stability: number | null;
  governors: { provinceId: string; characterId: string; loyalty: number }[] | null;
  aiGoal: string | null;
}

function topGoal(goals: readonly { kind: string; priority: number }[]): string | null {
  let best: { kind: string; priority: number } | null = null;
  for (const g of goals) if (!best || g.priority > best.priority) best = g;
  return best ? best.kind : null;
}

function bracket(v: number, edges: readonly number[], labels: readonly string[]): string {
  for (let i = 0; i < edges.length; i++) if (v < (edges[i] as number)) return labels[i] as string;
  return labels[labels.length - 1] as string;
}

/** What `observer` knows of `target` (§7.11 tiers). */
export function intelView(world: WorldState, observer: FactionId, target: FactionId): IntelView {
  const level = intelLevel(world, observer, target);
  const tier: IntelTier = level >= 0.6 || observer === target ? 2 : level >= 0.3 ? 1 : 0;
  const f = world.factions[target];
  const armies: IntelView['armies'] = [];
  for (const id of sortedKeys(world.armies)) {
    const a = world.armies[id] as ArmyState;
    if (a.factionId !== target) continue;
    const seen = (a.visibility[observer] ?? 0) > 0;
    if (tier === 0 && !seen) continue;
    armies.push({ armyId: a.id, soldiers: estimatedSoldiers(world, observer, a), exact: tier === 2 });
  }
  const governors: NonNullable<IntelView['governors']> = [];
  if (tier === 2) {
    for (const pid of sortedKeys(world.provinces)) {
      const p = world.provinces[pid]!;
      if (p.ownerFactionId !== target || !p.governorId) continue;
      const g = world.characters[p.governorId];
      if (g) governors.push({ provinceId: pid, characterId: g.id, loyalty: g.loyalty });
    }
  }
  return {
    factionId: target,
    tier,
    level,
    armies,
    treasuryBracket: tier >= 1 && f ? bracket(f.treasury, [0, 2000, 6000, 15000], ['in debt', 'poor', 'comfortable', 'rich', 'very rich']) : null,
    stabilityBracket: tier >= 1 && f ? bracket(f.stability, [0.3, 0.5, 0.7], ['shaky', 'uneasy', 'steady', 'firm']) : null,
    treasury: tier === 2 && f ? Math.round(f.treasury) : null,
    stability: tier === 2 && f ? f.stability : null,
    governors: tier === 2 ? governors : null,
    aiGoal: tier === 2 && f ? topGoal(f.ai.goals) : null,
  };
}
