/**
 * Campaign AI goals and perceived threats (GDD §9 hierarchical goals, SIM-02 spec 4). OWNER: AI Engineer - Battle
 * AI, Intents & Campaign AI (SIM-02).
 *
 * Goal utility = personality weight x situation, for the six goal kinds of the contract (`AiGoal`): defend a
 * threatened settlement, conquer the siege target, develop the settlement with the worst grain / housing need,
 * stabilize a restless settlement, ally with the realm that shares a threat, secure the supply of a hungry army. The
 * top six are written to `FactionState.ai.goals` (the realm's own plan memory, shown by intel tier 0.6 and the
 * debug API); `ai.threat` holds the perceived threat of every other realm (0..1). The planners read the goals:
 * construction favours the develop / stabilize settlements, the treaty planner the ally, the military the conquest.
 */
import type { AiGoal, FactionId } from '../../../core/types';
import { sortedKeys } from '../../../core/ids';
import { effectiveOpinion } from '../diplomacy';
import { atWarWith } from '../state';
import type { Situation } from './core';
import { armySupplyDays, note, str } from './core';
import { grainOutlook } from './economy';

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Recompute goals and threats (strategy runs). */
export function planGoals(sit: Situation): void {
  const { world, fid, f } = sit;
  const w = sit.personality.weights;
  const goals: AiGoal[] = [];
  for (const t of sit.threats) {
    if (!t.besieged && t.threat < 0.3 * Math.max(1, t.defense)) continue;
    goals.push({ kind: 'defend', settlementId: t.s.id, priority: round2(w.defend * Math.min(3, t.threat / Math.max(1, t.defense)) + (t.besieged ? 1 : 0)) });
  }
  const margin = grainOutlook(sit).marginDays;
  let devBest: string | null = null;
  let devNeed = 0;
  for (const s of sit.owned) {
    const crowd = s.population / Math.max(1, s.housing);
    const grain = margin < 60 ? (60 - Math.max(-60, margin)) / 60 : 0;
    const n = Math.max(0, crowd - 0.9) * 3 + grain + (s.foodStored > 0.85 * s.foodCapacity ? 0.4 : 0);
    if (n > devNeed) {
      devNeed = n;
      devBest = s.id;
    }
    const restless = s.unrest + Math.max(0, 0.5 - s.loyalty);
    if (s.rebellionStage !== 'calm' || s.loyalty < 0.45) goals.push({ kind: 'stabilize', settlementId: s.id, priority: round2(((w.defend + w.develop) / 2) * (0.3 + restless)) });
  }
  if (devBest) goals.push({ kind: 'develop', settlementId: devBest, priority: round2(w.develop * (0.3 + devNeed)) });
  for (const a of sit.armies) {
    const op = str(sit, `op_${a.id}`, '');
    if (op.startsWith('siege:') || op.startsWith('assault:')) goals.push({ kind: 'conquer', settlementId: op.slice(op.indexOf(':') + 1), priority: round2(w.expand * 1.2) });
    const days = armySupplyDays(world, a);
    if (days < 10) goals.push({ kind: 'secure_supply', armyId: a.id, priority: round2(((w.expand + w.defend) / 2) * (1 - days / 10)) });
  }
  let ally: FactionId | null = null;
  let allyScore = 0;
  for (const o of sortedKeys(world.factions)) {
    if (o === fid || !world.factions[o]!.alive || atWarWith(world, fid, o)) continue;
    let shared = 0;
    for (const e of sit.enemies) if (e !== o && atWarWith(world, o, e)) shared = 1;
    const sc = shared + effectiveOpinion(world, fid, o) / 100;
    if (sc > allyScore) {
      allyScore = sc;
      ally = o;
    }
  }
  if (ally) goals.push({ kind: 'ally', factionId: ally, priority: round2(w.diplomacy * allyScore) });
  goals.sort((a, b) => b.priority - a.priority || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
  const top = goals.slice(0, 6);
  const before = f.ai.goals[0];
  f.ai.goals = top;
  const head = top[0];
  if (head && (!before || before.kind !== head.kind || goalTarget(before) !== goalTarget(head))) note(sit, 'goal', `top goal: ${head.kind.replace('_', ' ')} ${goalTarget(head)} (utility ${head.priority})`);
  // Perceived threat per realm: relative strength x hostility.
  const own = Math.max(1, sit.strength[fid] ?? 0);
  const threat: Record<FactionId, number> = {};
  for (const o of sortedKeys(world.factions)) {
    if (o === fid || !world.factions[o]!.alive) continue;
    const hostility = atWarWith(world, fid, o) ? 1 : effectiveOpinion(world, fid, o) < -30 ? 0.6 : 0.25;
    threat[o] = round2(Math.min(1, ((sit.strength[o] ?? 0) / own) * hostility));
  }
  f.ai.threat = threat;
}

function goalTarget(g: AiGoal): string {
  return g.kind === 'ally' ? g.factionId : g.kind === 'secure_supply' ? g.armyId : g.settlementId;
}

/** Settlement ids named by develop / stabilize goals (construction boost). */
export function goalSettlements(sit: Situation): Set<string> {
  const out = new Set<string>();
  for (const g of sit.f.ai.goals) if (g.kind === 'develop' || g.kind === 'stabilize') out.add(g.settlementId);
  return out;
}
