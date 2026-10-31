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
 *  - Peace (CD review round 1, B3): a realm whose war score is below its personality's peaceWarScore sues (once per
 *    30 days per enemy) - but only while its field strength is under 1.5x the enemy's (a stronger host retakes its
 *    towns instead, military.ts). Below its personality's tributaryRatio of the enemy's strength it offers peace as a
 *    tributary: overlord = the enemy, payer = itself, tributePerMonth = 10% of its monthly income. The receiver answers by
 *    the SIM-01 acceptance utility (`evaluateAcceptance`).
 *  - Tribute: a winner (expansionist / raider appetite, 2.5x the enemy's strength, war score > 20) offers peace on
 *    tribute: overlord = itself, payer = the enemy, 10% of the enemy's monthly income. Until SIM-01 signs the tributary
 *    with such a peace, the realms bound by it propose the tributary itself after the peace (`planTributeAfterPeace`).
 *  - Treaties (monthly, by the diplomacy / trade weights): trade with realms that would accept, non-aggression with a
 *    stronger neighbour it fears, mutual defence against a shared threat - each proposed only when the receiver's
 *    utility says it would accept.
 *  - Every proposal (war, peace, treaty) is checked with SIM-01 `validateProposal` before it is issued or journaled: the
 *    journal records only proposals the world accepts for consideration.
 */
import type { FactionId, ProposalType, TreatyTerms, TreatyType } from '../../../core/types';
import { sortedKeys } from '../../../core/ids';
import { FACTIONS } from '../../../data/factions';
import { effectiveOpinion, emptyTerms, evaluateAcceptance, getRelation, validateProposal } from '../diplomacy';
import { treatyUnlocked } from '../ages';
import { activeTreaty } from '../treaties';
import { atWarWith } from '../state';
import type { Situation } from './core';
import { dist, forget, issue, note, num, recently, remember, str } from './core';
import { fieldStrength } from './military';

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
  if (!proposeChecked(sit, best, 'declare_war', emptyTerms())) return;
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

/** Issue a proposal only when SIM-01 `validateProposal` admits it (nothing is journaled otherwise). */
function proposeChecked(sit: Situation, to: FactionId, type: ProposalType, terms: TreatyTerms): boolean {
  if (validateProposal(sit.world, sit.fid, to, type, terms)) return false;
  issue(sit, { kind: 'propose', to, type, terms });
  return true;
}

/** A realm's monthly income (tax + trade, last month's ledger). */
function monthlyIncome(sit: Situation, fid: FactionId): number {
  const l = sit.world.factions[fid]?.ledger;
  return l ? Math.max(0, l.taxIncome + l.tradeIncome) : 0;
}

/** Peace terms with `payer` paying `overlord` 10% of the payer's monthly income (TRIBUTE_SHARE). */
export function tributeTerms(sit: Situation, overlord: FactionId, payer: FactionId): TreatyTerms {
  const t = emptyTerms();
  t.overlord = overlord;
  t.payer = payer;
  t.tributePerMonth = Math.max(1, Math.round(TRIBUTE_SHARE * monthlyIncome(sit, payer)));
  return t;
}

/** Share of the payer's monthly income a tributary pays (CD review round 1, B3). */
export const TRIBUTE_SHARE = 0.1;

export interface PeaceCase {
  /** Our war score against b. */
  score: number;
  /** Below peaceWarScore. */
  losing: boolean;
  /** Own field strength / b's field strength. */
  fieldRatio: number;
  /** Losing and our field strength under 1.5x b's: we sue. */
  sue: boolean;
  /** Our realm strength / b's under our tributaryRatio: we offer tribute with the peace. */
  tributary: boolean;
}

/** Whether `sit`'s realm owes a peace proposal to b (CD-B3 d) and on what terms (pure; the audit uses it too). */
export function peaceCase(sit: Situation, b: FactionId): PeaceCase {
  const score = warScoreFor(sit, b);
  const losing = score < sit.personality.peaceWarScore;
  const own = fieldStrength(sit, sit.fid);
  const theirs = fieldStrength(sit, b);
  const fieldRatio = own / Math.max(1, theirs);
  const ratio = (sit.strength[sit.fid] ?? 0) / Math.max(1, sit.strength[b] ?? 0);
  return { score, losing, fieldRatio, sue: losing && fieldRatio < PEACE_FIELD_RATIO, tributary: ratio < sit.personality.tributaryRatio };
}

/** A losing realm sues only while its field strength is under this multiple of the enemy's (CD-B3 d). */
export const PEACE_FIELD_RATIO = 1.5;

/**
 * A quiet war: neither side has a host bearing on the other (no threat from b to our towns, no own operation against
 * b - the strategy planner found no target, memory `noTarget`) for QUIET_WAR_DAYS. Memory `quiet_<b>`: first quiet day.
 */
function quietWar(sit: Situation, b: FactionId): boolean {
  const { world } = sit;
  let active = !recently(sit, 'noTarget', 6);
  for (const t of sit.threats) if (t.enemy && t.enemy.factionId === b && (t.threat > 0 || t.besieged)) active = true;
  for (const a of sit.armies) {
    const op = str(sit, `op_${a.id}`, '');
    const id = op.split(':')[1] ?? '';
    if (world.settlements[id]?.ownerFactionId === b || world.armies[id]?.factionId === b) active = true;
  }
  const key = `quiet_${b}`;
  if (active) {
    if (key in sit.f.ai.memory) forget(sit, key);
    return false;
  }
  if (!(key in sit.f.ai.memory)) remember(sit, key, sit.day);
  return sit.day - num(sit, key, sit.day) >= QUIET_WAR_DAYS;
}

/** A war with no operation either way for this many days is ended by a status-quo peace offer. */
export const QUIET_WAR_DAYS = 60;

/**
 * Sue for peace below peaceWarScore (daily check, once per 30 days per enemy) - as a tributary when much weaker; and
 * offer a status-quo peace in a quiet war (no host can reach the other side's towns for 60 days), once per 30 days.
 */
export function considerPeace(sit: Situation): void {
  for (const b of sit.enemies) {
    const c = peaceCase(sit, b);
    if (!c.sue) {
      if (quietWar(sit, b) && !recently(sit, `peace_${b}`, 30) && proposeChecked(sit, b, 'peace', emptyTerms())) {
        remember(sit, `peace_${b}`, sit.day);
        const acc = evaluateAcceptance(sit.world, sit.fid, b, 'peace');
        note(sit, 'peace', `offers ${FACTIONS[b]?.shortName ?? b} a status-quo peace: the war has been quiet for ${QUIET_WAR_DAYS}+ days (${sit.world.factions[b]?.isPlayer ? 'the player decides' : acc.accept ? 'they accept' : `they refuse: ${acc.reasons.join('; ')}`})`);
      }
      continue;
    }
    if (recently(sit, `peace_${b}`, 30)) continue;
    const terms = c.tributary ? tributeTerms(sit, b, sit.fid) : emptyTerms();
    if (!proposeChecked(sit, b, 'peace', terms)) continue;
    remember(sit, `peace_${b}`, sit.day);
    if (c.tributary) remember(sit, `tributePeace_${b}`, `${b}|${sit.fid}|${terms.tributePerMonth}|${sit.day}`);
    const acc = evaluateAcceptance(sit.world, sit.fid, b, 'peace');
    note(
      sit,
      'peace',
      `sues ${FACTIONS[b]?.shortName ?? b} for peace${c.tributary ? ` as a tributary (${terms.tributePerMonth} a month)` : ''}: war score ${c.score.toFixed(0)} < ${sit.personality.peaceWarScore}, field strength ${c.fieldRatio.toFixed(2)}x theirs (${sit.world.factions[b]?.isPlayer ? 'the player decides' : acc.accept ? `they accept: ${acc.reasons.join('; ')}` : `they refuse: ${acc.reasons.join('; ')}`})`,
    );
  }
}

/**
 * The winner's side of tribute (CD-B3 c): at war with an enemy it outmatches 2.5x and winning (war score > 20), an
 * expansionist / raider offers peace on tribute (the enemy pays 10% of its monthly income). Diplomacy runs, once per 30
 * days per enemy; only when the enemy's utility accepts the peace.
 */
function demandTributePeace(sit: Situation): boolean {
  const w = sit.personality.weights;
  if ((w.expand + w.raid) / 2 < 1) return false;
  const own = sit.strength[sit.fid] ?? 0;
  for (const b of sit.enemies) {
    if (own <= 2.5 * (sit.strength[b] ?? 0) || warScoreFor(sit, b) <= 20 || recently(sit, `peace_${b}`, 30)) continue;
    if (!accepts(sit, b, 'peace')) continue;
    const terms = tributeTerms(sit, sit.fid, b);
    if (!proposeChecked(sit, b, 'peace', terms)) continue;
    remember(sit, `peace_${b}`, sit.day);
    remember(sit, `tributePeace_${b}`, `${sit.fid}|${b}|${terms.tributePerMonth}|${sit.day}`);
    remember(sit, 'lastProposalDay', sit.day);
    note(sit, 'diplomacy', `offers ${FACTIONS[b]?.shortName ?? b} peace on tribute (${terms.tributePerMonth} a month to us)`);
    return true;
  }
  return false;
}

/**
 * After a peace made on tribute terms (memory `tributePeace_<b>` "overlord|payer|amount|day"): if no tributary binds
 * the two yet, the side whose age allows it proposes the tributary itself (the payer as 'tributary', or the overlord as
 * 'demand_tribute'), validated. Kept for 60 days; dropped once a tributary stands or the attempt fails.
 */
export function planTributeAfterPeace(sit: Situation): void {
  for (const k of Object.keys(sit.f.ai.memory).sort()) {
    if (!k.startsWith('tributePeace_')) continue;
    const b = k.slice('tributePeace_'.length);
    const [overlord, payer, amount, day] = str(sit, k, '').split('|');
    if (!overlord || !payer || sit.day - Number(day) > 60 || !sit.world.factions[b]?.alive) {
      forget(sit, k);
      continue;
    }
    if (atWarWith(sit.world, sit.fid, b)) continue; // the peace has not been made (yet)
    if (activeTreaty(sit.world, sit.fid, b, 'tributary')) {
      forget(sit, k);
      continue;
    }
    const terms = emptyTerms();
    terms.overlord = overlord;
    terms.payer = payer;
    terms.tributePerMonth = Number(amount);
    const type: ProposalType = sit.fid === payer ? 'tributary' : 'demand_tribute';
    forget(sit, k);
    if (!proposeChecked(sit, b, type, terms)) continue;
    note(sit, 'diplomacy', `${type === 'tributary' ? 'becomes a tributary of' : 'binds as its tributary'} ${FACTIONS[b]?.shortName ?? b} per the peace (${terms.tributePerMonth} a month)`);
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
  if (demandTributePeace(sit)) return;
  const options: { b: FactionId; type: ProposalType; value: number }[] = [];
  for (const b of sortedKeys(world.factions)) {
    if (b === fid || !world.factions[b]!.alive) continue;
    const their = sit.strength[b] ?? 0;
    const opinion = effectiveOpinion(world, fid, b);
    const near = realmDistance(sit, b) < 4000;
    if (atWarWith(world, fid, b)) continue;
    if (canPropose(sit, b, 'trade') && opinion > -10) options.push({ b, type: 'trade', value: w.trade * (1 + opinion / 100) });
    if (near && canPropose(sit, b, 'non_aggression') && their > 1.3 * own && opinion > -40) options.push({ b, type: 'non_aggression', value: (w.defend + w.diplomacy) / 2 });
    if (near && canPropose(sit, b, 'mutual_defense') && opinion > 10 && sharedEnemy(sit, b)) options.push({ b, type: 'mutual_defense', value: w.diplomacy * 1.1 });
  }
  options.sort((x, y) => y.value - x.value || (x.b < y.b ? -1 : x.b > y.b ? 1 : 0));
  for (const o of options) {
    if (o.value < 0.8) break;
    if (!accepts(sit, o.b, o.type)) continue;
    if (!proposeChecked(sit, o.b, o.type, emptyTerms())) continue;
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
