/**
 * Diplomacy: relations, treaties (peace, trade, access, mutual defense, tributary, marriage,
 * non-aggression), proposals and AI evaluation. OWNER: Lead AI & Simulation Engineer.
 * Baseline by the CTO: data plumbing + trivial evaluation.
 *
 * Required behavior (GDD §7):
 *  - evaluateProposal: utility of the deal for the receiver (relative strength, threat, opinion,
 *    trust, war weariness, tribute value, AI personality) with explanation lines for the UI.
 *  - Monthly: opinion decays toward a baseline, grievances decay, war weariness, tribute transfers,
 *    treaty expiry; broken treaties create grievances and lower trust with ALL factions.
 *  - Mutual defense: joining wars; tributaries: autonomy affects province unrest.
 */
import type { DiplomaticProposal, FactionId, ProposalId, ProposalType, RelationState, SimEvent, Treaty, TreatyTerms, TreatyType, WorldState } from '../../core/types';
import { nextWorldId, relationKey, sortedKeys } from '../../core/ids';
import { BALANCE } from '../../data/balance';
import { totalDays } from './seasons';

export function emptyTerms(): TreatyTerms {
  return { tributePerMonth: 0, payer: null, overlord: null, autonomy: 0, marriage: null, durationDays: null };
}

export function getRelation(world: WorldState, a: FactionId, b: FactionId): RelationState | null {
  return world.diplomacy.relations[relationKey(a, b)] ?? null;
}

export function areAtWar(world: WorldState, a: FactionId, b: FactionId): boolean {
  return getRelation(world, a, b)?.atWar ?? false;
}

export function createTreaty(world: WorldState, type: TreatyType, a: FactionId, b: FactionId, terms: TreatyTerms = emptyTerms()): Treaty {
  const t: Treaty = {
    id: nextWorldId(world, 'treaty'),
    type,
    parties: [a, b],
    terms,
    startDay: totalDays(world.calendar),
    endDay: terms.durationDays !== null ? totalDays(world.calendar) + terms.durationDays : null,
    brokenBy: null,
  };
  world.diplomacy.treaties[t.id] = t;
  getRelation(world, a, b)?.treatyIds.push(t.id);
  return t;
}

export function hasTreaty(world: WorldState, a: FactionId, b: FactionId, type: TreatyType): boolean {
  const rel = getRelation(world, a, b);
  if (!rel) return false;
  return rel.treatyIds.some((id) => {
    const t = world.diplomacy.treaties[id];
    return !!t && t.type === type && t.brokenBy === null;
  });
}

export function declareWar(world: WorldState, a: FactionId, b: FactionId, out: SimEvent[]): void {
  const rel = getRelation(world, a, b);
  if (!rel || rel.atWar) return;
  rel.atWar = true;
  rel.warStartDay = totalDays(world.calendar);
  rel.opinion = Math.min(rel.opinion, -40);
  for (const id of rel.treatyIds) {
    const t = world.diplomacy.treaties[id];
    if (t && t.brokenBy === null && (t.type === 'peace' || t.type === 'non_aggression' || t.type === 'trade')) {
      t.brokenBy = a;
      out.push({ kind: 'treaty_broken', treatyId: t.id, by: a });
    }
  }
  out.push({ kind: 'war_declared', a, b });
}

export function makePeace(world: WorldState, a: FactionId, b: FactionId, out: SimEvent[]): void {
  const rel = getRelation(world, a, b);
  if (!rel || !rel.atWar) return;
  rel.atWar = false;
  rel.warStartDay = null;
  rel.warScore = 0;
  const t = createTreaty(world, 'peace', a, b, { ...emptyTerms(), durationDays: 360 });
  out.push({ kind: 'peace_made', a, b });
  out.push({ kind: 'treaty_signed', treatyId: t.id });
}

/** AI evaluation of a proposal. Baseline: accept if opinion is high enough. */
export function evaluateProposal(world: WorldState, p: DiplomaticProposal): { accept: boolean; score: number; reasons: string[] } {
  const rel = getRelation(world, p.from, p.to);
  const opinion = rel?.opinion ?? 0;
  const score = opinion / 100 + (p.type === 'ceasefire' || p.type === 'peace' ? 0.3 : 0);
  return { accept: score > 0.1, score, reasons: [`Opinion of you: ${Math.round(opinion)}`] };
}

export function proposeTreaty(world: WorldState, from: FactionId, to: FactionId, type: ProposalType, terms: TreatyTerms, out: SimEvent[]): ProposalId {
  const p: DiplomaticProposal = { id: nextWorldId(world, 'prop'), from, to, type, terms, day: totalDays(world.calendar), status: 'pending', reasons: [] };
  world.diplomacy.proposals.push(p);
  if (type === 'declare_war') {
    declareWar(world, from, to, out);
    p.status = 'accepted';
    return p.id;
  }
  const toFaction = world.factions[to];
  if (toFaction?.isPlayer) {
    out.push({ kind: 'proposal_received', proposalId: p.id, to });
  } else {
    const ev = evaluateProposal(world, p);
    p.reasons = ev.reasons;
    respondToProposal(world, p.id, ev.accept, out);
  }
  return p.id;
}

export function respondToProposal(world: WorldState, proposalId: ProposalId, accept: boolean, out: SimEvent[]): void {
  const p = world.diplomacy.proposals.find((x) => x.id === proposalId);
  if (!p || p.status !== 'pending') return;
  p.status = accept ? 'accepted' : 'rejected';
  if (!accept) return;
  if (p.type === 'peace' || p.type === 'ceasefire') makePeace(world, p.from, p.to, out);
  else if (p.type !== 'declare_war' && p.type !== 'demand_tribute' && p.type !== 'break_treaty') {
    const t = createTreaty(world, p.type, p.from, p.to, p.terms);
    out.push({ kind: 'treaty_signed', treatyId: t.id });
  }
}

export function updateDiplomacyDaily(world: WorldState, out: SimEvent[]): void {
  // Expire stale proposals after 30 days.
  const day = totalDays(world.calendar);
  for (const p of world.diplomacy.proposals) if (p.status === 'pending' && day - p.day > 30) p.status = 'expired';
  if (world.diplomacy.proposals.length > 100) world.diplomacy.proposals.splice(0, world.diplomacy.proposals.length - 100);
  void out;
}

export function updateDiplomacyMonthly(world: WorldState, out: SimEvent[]): void {
  const d = BALANCE.diplomacy;
  for (const key of sortedKeys(world.diplomacy.relations)) {
    const rel = world.diplomacy.relations[key]!;
    rel.opinion += rel.opinion > 0 ? -Math.min(rel.opinion, d.opinionDecayPerMonth) : Math.min(-rel.opinion, d.opinionDecayPerMonth);
    for (const g of rel.grievances) g.amount *= 1 - d.grievanceDecayPerMonth;
    rel.grievances = rel.grievances.filter((g) => Math.abs(g.amount) > 0.5);
  }
  void out;
}
