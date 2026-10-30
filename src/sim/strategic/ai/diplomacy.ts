/**
 * Campaign AI diplomacy: the war declaration rule, suing for peace, treaty proposals (DESIGN_SPEC §7.10, §7.14,
 * §10.4). OWNER: AI Engineer - Battle AI, Intents & Campaign AI (SIM-02).
 *
 *  - War (§7.14): declare on b when (own strength / b's strength) x (1 - opinion / 200) > warRatio - aggression bonus
 *    (difficulty aiAggressionBonus + the sandbox slider - 0.5), the opportunist adding +0.3 to the ratio against a realm
 *    with a famine (a starving settlement), a revolt or a battle lost in the last 60 days. Never during a truce or while
 *    a treaty forbids it (non-aggression, mutual defence, marriage alliance, tributary, military access). On top of the
 *    rule the AI is prudent: one new war at a time (not while already fighting a realm half its strength or more), at
 *    most one declaration per 90 days, only on a realm whose lands lie within 3,500 m of its own.
 *  - Peace: sues the realm it is at war with when its war score falls below its personality's peaceWarScore (once per
 *    30 days per enemy); the receiver answers by the SIM-01 acceptance utility (`evaluateAcceptance`).
 *  - Treaties (monthly, by the diplomacy / trade weights): trade with realms that would accept, non-aggression with a
 *    stronger neighbour it fears, mutual defence against a shared threat, tribute demanded of a much weaker enemy
 *    (expansionist / raider) - each proposed only when the receiver's utility says it would accept.
 */
import type { FactionId, ProposalType, TreatyType } from '../../../core/types';
import { sortedKeys } from '../../../core/ids';
import { FACTIONS } from '../../../data/factions';
import { effectiveOpinion, emptyTerms, evaluateAcceptance, getRelation } from '../diplomacy';
import { treatyUnlocked } from '../ages';
import { activeTreaty } from '../treaties';
import { atWarWith } from '../state';
import type { Situation } from './core';
import { dist, issue, note, num, recently, remember } from './core';

/** Treaties that forbid a war declaration while active. */
export const WAR_FORBIDDING_TREATIES: readonly TreatyType[] = ['non_aggression', 'mutual_defense', 'marriage_alliance', 'tributary', 'military_access'];

export interface WarRuleResult {
  /** (own / target strength) x (1 - opinion / 200), + 0.3 for an opportunist against a weakened target. */
  ratio: number;
  /** warRatio - aggression bonus. */
  threshold: number;
  /** The opportunist bonus applied. */
  opportunity: boolean;
  /** Why war is not allowed at all (truce, treaty, already at war...), else null. */
  blocked: string | null;
  /** The rule holds and nothing blocks it. */
  ok: boolean;
}

/** Is realm b weakened (famine, revolt, battle lost in the last 60 days)? - the opportunist's trigger. */
export function weakened(sit: Pick<Situation, 'world' | 'day'>, b: FactionId): boolean {
  const { world } = sit;
  for (const id of sortedKeys(world.settlements)) {
    const s = world.settlements[id]!;
    if (s.ownerFactionId !== b) continue;
    if (s.starvationDays > 0 || s.foodStored <= 0) return true;
    if (s.rebellionStage === 'revolt' || s.rebellionStage === 'secession') return true;
  }
  for (const o of world.battleHistory) {
    if (o.day === null || sit.day - o.day > 60 || o.winner === null) continue;
    const loser = o.sides[1 - o.winner]!;
    if (loser.factionId === b) return true;
  }
  return false;
}

/** The DESIGN_SPEC §7.14 war declaration rule for a -> b (pure; exported for tests and the UI). */
export function warRule(sit: Situation, b: FactionId): WarRuleResult {
  const { world, fid } = sit;
  const res: WarRuleResult = { ratio: 0, threshold: sit.personality.warRatio - sit.aggressionBonus, opportunity: false, blocked: null, ok: false };
  const fb = world.factions[b];
  if (!fb || !fb.alive || b === fid) {
    res.blocked = 'no such realm';
    return res;
  }
  const rel = getRelation(world, fid, b);
  if (!rel) {
    res.blocked = 'no relation';
    return res;
  }
  if (rel.atWar) res.blocked = 'already at war';
  else if (rel.truceUntilDay !== null && rel.truceUntilDay > sit.day) res.blocked = 'truce';
  else for (const t of WAR_FORBIDDING_TREATIES) if (activeTreaty(world, fid, b, t)) res.blocked = `treaty: ${t}`;
  const own = sit.strength[fid] ?? 0;
  const target = Math.max(1, sit.strength[b] ?? 0);
  const opinion = effectiveOpinion(world, fid, b);
  res.ratio = (own / target) * (1 - opinion / 200);
  if (sit.f.ai.personality === 'opportunist' && weakened(sit, b)) {
    res.ratio += 0.3;
    res.opportunity = true;
  }
  res.ok = res.blocked === null && res.ratio > res.threshold;
  return res;
}

/** Nearest distance between the two realms' settlements (m). */
function realmDistance(sit: Situation, b: FactionId): number {
  let best = Infinity;
  for (const id of sortedKeys(sit.world.settlements)) {
    const t = sit.world.settlements[id]!;
    if (t.ownerFactionId !== b) continue;
    for (const s of sit.owned) best = Math.min(best, dist(s, t));
  }
  return best;
}

/** Consider declaring a war (strategy runs). Records the decision for audit (memory `war_<target>`). */
export function considerWar(sit: Situation): void {
  const { world, fid } = sit;
  if (recently(sit, 'lastWarDay', 90)) return;
  // Already fighting a serious enemy: no second front.
  for (const e of sit.enemies) if ((sit.strength[e] ?? 0) > 0.5 * (sit.strength[fid] ?? 0)) return;
  let best: FactionId | null = null;
  let bestMargin = 0;
  let bestRule: WarRuleResult | null = null;
  for (const b of sortedKeys(world.factions)) {
    if (b === fid || !world.factions[b]!.alive) continue;
    const r = warRule(sit, b);
    if (!r.ok) continue;
    if (realmDistance(sit, b) > 3500) continue;
    const margin = r.ratio - r.threshold;
    if (margin > bestMargin) {
      bestMargin = margin;
      best = b;
      bestRule = r;
    }
  }
  if (!best || !bestRule) return;
  issue(sit, { kind: 'propose', to: best, type: 'declare_war', terms: emptyTerms() });
  remember(sit, 'lastWarDay', sit.day);
  remember(sit, `war_${best}`, `${sit.day}|${bestRule.ratio.toFixed(3)}|${bestRule.threshold.toFixed(3)}${bestRule.opportunity ? '|opportunity' : ''}`);
  note(sit, 'war', `declares war on ${FACTIONS[best]?.shortName ?? best}: strength ratio x opinion ${bestRule.ratio.toFixed(2)} > ${bestRule.threshold.toFixed(2)} (war ratio ${sit.personality.warRatio}, aggression bonus ${sit.aggressionBonus.toFixed(2)})${bestRule.opportunity ? ', +0.3 they are weakened' : ''}`);
}

/** War score of the relation from `fid`'s point of view. */
export function warScoreFor(sit: Situation, b: FactionId): number {
  const rel = getRelation(sit.world, sit.fid, b);
  if (!rel) return 0;
  return rel.a === sit.fid ? rel.warScore : -rel.warScore;
}

/** Sue for peace below peaceWarScore (daily check, once per 30 days per enemy). */
export function considerPeace(sit: Situation): void {
  for (const b of sit.enemies) {
    const score = warScoreFor(sit, b);
    if (score >= sit.personality.peaceWarScore) continue;
    if (recently(sit, `peace_${b}`, 30)) continue;
    remember(sit, `peace_${b}`, sit.day);
    const acc = evaluateAcceptance(sit.world, sit.fid, b, 'peace');
    issue(sit, { kind: 'propose', to: b, type: 'peace', terms: emptyTerms() });
    note(sit, 'peace', `sues ${FACTIONS[b]?.shortName ?? b} for peace: war score ${score.toFixed(0)} < ${sit.personality.peaceWarScore} (${sit.world.factions[b]?.isPlayer ? 'the player decides' : acc.accept ? `they accept: ${acc.reasons.join('; ')}` : `they refuse: ${acc.reasons.join('; ')}`})`);
  }
}

/** Would `b` accept this proposal from us (SIM-01 utility)? */
function accepts(sit: Situation, b: FactionId, type: ProposalType): boolean {
  if (sit.world.factions[b]?.isPlayer) return true; // the player decides; propose when it suits us
  return evaluateAcceptance(sit.world, sit.fid, b, type).accept;
}

function canPropose(sit: Situation, b: FactionId, t: TreatyType): boolean {
  if (atWarWith(sit.world, sit.fid, b)) return false;
  if (!treatyUnlocked(sit.world, sit.fid, t)) return false;
  return !activeTreaty(sit.world, sit.fid, b, t);
}

/**
 * Monthly treaty work (one proposal per run), by personality: trade (trade weight), non-aggression with a feared
 * neighbour, mutual defence against a shared threat (diplomacy weight), tribute demanded of a beaten enemy.
 */
export function considerTreaties(sit: Situation): void {
  const { world, fid } = sit;
  const w = sit.personality.weights;
  const own = sit.strength[fid] ?? 0;
  if (recently(sit, 'lastProposalDay', 25)) return;
  const options: { b: FactionId; type: ProposalType; value: number }[] = [];
  for (const b of sortedKeys(world.factions)) {
    if (b === fid || !world.factions[b]!.alive) continue;
    const their = sit.strength[b] ?? 0;
    const opinion = effectiveOpinion(world, fid, b);
    const near = realmDistance(sit, b) < 4000;
    if (atWarWith(world, fid, b)) {
      // Tribute from a beaten enemy instead of fighting on (expansionist / raider appetite).
      if ((w.expand + w.raid) / 2 >= 1 && own > 2.5 * their && warScoreFor(sit, b) > 20) options.push({ b, type: 'demand_tribute', value: w.expand + 0.5 });
      continue;
    }
    if (canPropose(sit, b, 'trade') && opinion > -10) options.push({ b, type: 'trade', value: w.trade * (1 + opinion / 100) });
    if (near && canPropose(sit, b, 'non_aggression') && their > 1.3 * own && opinion > -40) options.push({ b, type: 'non_aggression', value: (w.defend + w.diplomacy) / 2 });
    if (near && canPropose(sit, b, 'mutual_defense') && opinion > 10 && sharedEnemy(sit, b)) options.push({ b, type: 'mutual_defense', value: w.diplomacy * 1.1 });
  }
  options.sort((x, y) => y.value - x.value || (x.b < y.b ? -1 : x.b > y.b ? 1 : 0));
  for (const o of options) {
    if (o.value < 0.8) break;
    if (!accepts(sit, o.b, o.type)) continue;
    issue(sit, { kind: 'propose', to: o.b, type: o.type, terms: emptyTerms() });
    remember(sit, 'lastProposalDay', sit.day);
    note(sit, 'diplomacy', `proposes ${o.type.replace('_', ' ')} to ${FACTIONS[o.b]?.shortName ?? o.b}`);
    return;
  }
}

function sharedEnemy(sit: Situation, b: FactionId): boolean {
  for (const e of sit.enemies) if (e !== b && atWarWith(sit.world, b, e)) return true;
  return false;
}

/** Days since the realm last declared a war (Infinity when never). */
export function daysSinceWar(sit: Situation): number {
  const d = num(sit, 'lastWarDay', -1);
  return d < 0 ? Infinity : sit.day - d;
}
