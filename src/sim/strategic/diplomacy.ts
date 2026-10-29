/**
 * Diplomacy (DESIGN_SPEC §7.10): relations, treaties and their effects / breaking costs, war and peace, truces,
 * grievances, war score and weariness, proposals with the AI acceptance utility, marriages.
 * OWNER: Simulation Engineer - Strategic World Simulation (SIM-01).
 *
 *  - createTreaty(world, type, a, b): `peace` ends the war (truce 360 days, war score / weariness reset);
 *    `tributary` -> a overlord, b payer (tribute and payer autonomy in economy.ts); `marriage_alliance` opinion +30,
 *    trust +0.2 (ends when a spouse dies). Durations: trade 720, military access 360, mutual defense 720,
 *    non-aggression 360; others permanent.
 *  - Breaking a treaty: opinion peace -40, trade -20, access -15, defense -40, tributary -30, marriage -60 (+
 *    legitimacy -0.1), non-aggression -25; trust -0.15 with everyone; a `broken_treaty` grievance.
 *  - declareWar: refused during a truce; breaks peace / non-aggression / trade / marriage / access / defense treaties
 *    with the target; legitimacy -0.03 without a grievance; a `war` grievance (-20); mutual-defense partners and the
 *    overlord of a tributary join the defender (AI if their opinion of it is > 0; the player is asked).
 *  - Acceptance utility (accept if U > 0) per proposal type, terms x faction diplomacyOpinion on the opinion terms;
 *    the reply lists the three largest terms ("They fear your army (+24)").
 *  - Monthly: opinion drifts toward 0 (toward +10 with a shared enemy) by 2, trade +1 (to +20), grievances decay 10%,
 *    war weariness +3 at war, war score +2 per enemy settlement held. Proposals expire after 30 days.
 * Pure and deterministic; effective opinion = stored opinion + Σ grievances.
 */
import type {
  ArmyState,
  CharacterState,
  DiplomaticProposal,
  FactionId,
  FactionState,
  Grievance,
  ProposalId,
  ProposalType,
  RelationState,
  SimEvent,
  Treaty,
  TreatyTerms,
  TreatyType,
  WorldState,
} from '../../core/types';
import { nextWorldId, relationKey, sortedKeys } from '../../core/ids';
import { AGES } from '../../data/ages';
import { BALANCE } from '../../data/balance';
import { FACTIONS } from '../../data/factions';
import { RULES } from '../../data/rules';
import { treatyAge, treatyUnlocked } from './ages';
import { armyStrength } from './armies';
import { factionMod } from './modifiers';
import { totalDays } from './seasons';
import { addChronicle, notifyPlayer } from './state';
import { activeTreaties, activeTreaty, isTreatyActive, relationOf } from './treaties';

const DR = RULES.diplomacy;

export const DIPLOMACY_REASONS = {
  noFaction: 'No such realm',
  self: 'Choose another realm',
  dead: 'That realm has fallen',
  atWar: 'You are at war with them',
  notAtWar: 'You are not at war with them',
  truce: (day: number) => `A truce holds until day ${day}`,
  already: 'You already have this treaty',
  noTreaty: 'There is no treaty to break',
  noProposal: 'No such proposal',
  notForYou: 'That proposal was not made to you',
  answered: 'That proposal has already been answered',
  marriage: 'Choose two unmarried people aged 16 to 40, at most one of them a ruler',
  noCharacter: 'No such person',
  notYours: 'One of them must be of your court',
  ageGate: (ageName: string) => `Requires the ${ageName}`,
  tributeSelf: 'Tribute needs an overlord and a payer',
} as const;

/** Treaty duration in days (null = permanent). */
export function treatyDuration(type: TreatyType): number | null {
  switch (type) {
    case 'trade':
      return DR.tradeTreatyDays;
    case 'military_access':
      return 360;
    case 'mutual_defense':
      return 720;
    case 'non_aggression':
      return DR.nonAggressionDays;
    default:
      return null;
  }
}

/** Opinion cost of breaking a treaty (§7.10 table). */
export function breakCost(type: TreatyType): number {
  switch (type) {
    case 'peace':
      return -40;
    case 'trade':
      return -20;
    case 'military_access':
      return -15;
    case 'mutual_defense':
      return -40;
    case 'tributary':
      return -30;
    case 'marriage_alliance':
      return DR.breakMarriageOpinion;
    case 'non_aggression':
      return -25;
    default:
      return -20;
  }
}

export function emptyTerms(): TreatyTerms {
  return { tributePerMonth: 0, payer: null, overlord: null, autonomy: 0, marriage: null, durationDays: null };
}

export function getRelation(world: WorldState, a: FactionId, b: FactionId): RelationState | null {
  return world.diplomacy.relations[relationKey(a, b)] ?? null;
}

export function areAtWar(world: WorldState, a: FactionId, b: FactionId): boolean {
  return getRelation(world, a, b)?.atWar ?? false;
}

function today(world: WorldState): number {
  return totalDays(world.calendar);
}

function clampOpinion(v: number): number {
  return Math.max(DR.opinionRange[0], Math.min(DR.opinionRange[1], v));
}

/** Stored opinion + Σ grievance amounts (the opinion the AI acts on). */
export function effectiveOpinion(world: WorldState, a: FactionId, b: FactionId): number {
  const rel = getRelation(world, a, b);
  if (!rel) return 0;
  let o = rel.opinion;
  for (const g of rel.grievances) o += g.amount;
  return clampOpinion(o);
}

export function addGrievance(world: WorldState, a: FactionId, b: FactionId, kind: Grievance['kind'], amount: number): void {
  const rel = getRelation(world, a, b);
  if (rel) rel.grievances.push({ kind, day: today(world), amount });
}

export function addOpinion(world: WorldState, a: FactionId, b: FactionId, delta: number): void {
  const rel = getRelation(world, a, b);
  if (rel) rel.opinion = clampOpinion(rel.opinion + delta);
}

/** Active (not broken, not expired) treaty of a type between a and b. */
export function hasTreaty(world: WorldState, a: FactionId, b: FactionId, type: TreatyType): boolean {
  return activeTreaty(world, a, b, type) !== null;
}

// ---------------------------------------------------------------------------------------------------
// Treaties
// ---------------------------------------------------------------------------------------------------

/** End a war between a and b (peace treaty side effects). */
function endWar(world: WorldState, a: FactionId, b: FactionId, out: SimEvent[] | null): void {
  const rel = getRelation(world, a, b);
  if (!rel) return;
  const wasAtWar = rel.atWar;
  rel.atWar = false;
  rel.warStartDay = null;
  rel.warScore = 0;
  rel.warWeariness = 0;
  rel.truceUntilDay = today(world) + DR.truceDays;
  if (wasAtWar && out) out.push({ kind: 'peace_made', a, b });
}

/**
 * Sign a treaty (events `sign_treaty`, accepted proposals). `peace` ends the war; `tributary` makes a the overlord and
 * b the payer unless the terms name them; `marriage_alliance` +30 opinion, +0.2 trust.
 */
export function createTreaty(world: WorldState, type: TreatyType, a: FactionId, b: FactionId, terms: TreatyTerms = emptyTerms(), out: SimEvent[] | null = null): Treaty {
  const t2: TreatyTerms = { ...terms };
  if (t2.durationDays === null) t2.durationDays = treatyDuration(type);
  if (type === 'tributary') {
    if (!t2.overlord && !t2.payer) {
      t2.overlord = a;
      t2.payer = b;
    } else if (!t2.overlord) t2.overlord = t2.payer === a ? b : a;
    else if (!t2.payer) t2.payer = t2.overlord === a ? b : a;
  }
  // Replace an active treaty of the same type (renewal).
  for (const old of activeTreaties(world, a, b)) if (old.type === type) old.endDay = today(world);
  const t: Treaty = {
    id: nextWorldId(world, 'treaty'),
    type,
    parties: [a, b],
    terms: t2,
    startDay: today(world),
    endDay: t2.durationDays !== null ? today(world) + t2.durationDays : null,
    brokenBy: null,
  };
  world.diplomacy.treaties[t.id] = t;
  const rel = getRelation(world, a, b);
  rel?.treatyIds.push(t.id);
  if (type === 'peace') endWar(world, a, b, out);
  if (type === 'marriage_alliance' && rel) {
    rel.opinion = clampOpinion(rel.opinion + DR.marriageOpinion);
    rel.trust = Math.min(1, rel.trust + DR.marriageTrust);
  }
  out?.push({ kind: 'treaty_signed', treatyId: t.id });
  const fa = FACTIONS[a]?.shortName ?? a;
  const fb = FACTIONS[b]?.shortName ?? b;
  addChronicle(world, a, `${fa} and ${fb} signed a ${type.replace('_', ' ')} treaty.`, type === 'peace' || type === 'marriage_alliance' || type === 'tributary' ? 2 : 1);
  return t;
}

/** Break a treaty (§7.10 costs). */
export function breakTreaty(world: WorldState, by: FactionId, treatyId: string, out: SimEvent[]): string | null {
  const t = world.diplomacy.treaties[treatyId];
  if (!t || !isTreatyActive(world, t)) return DIPLOMACY_REASONS.noTreaty;
  if (t.parties[0] !== by && t.parties[1] !== by) return DIPLOMACY_REASONS.noTreaty;
  const other = t.parties[0] === by ? t.parties[1] : t.parties[0];
  t.brokenBy = by;
  t.endDay = today(world);
  addOpinion(world, by, other, breakCost(t.type));
  addGrievance(world, by, other, 'broken_treaty', -10);
  for (const key of sortedKeys(world.diplomacy.relations)) {
    const r = world.diplomacy.relations[key]!;
    if (r.a === by || r.b === by) r.trust = Math.max(0, r.trust + DR.breakTreatyTrustAll);
  }
  const f = world.factions[by];
  if (t.type === 'marriage_alliance' && f) f.legitimacy = Math.max(0, f.legitimacy + DR.breakMarriageLegitimacy);
  out.push({ kind: 'treaty_broken', treatyId: t.id, by });
  addChronicle(world, by, `${FACTIONS[by]?.shortName ?? by} broke its ${t.type.replace('_', ' ')} treaty with ${FACTIONS[other]?.shortName ?? other}.`, 1);
  return null;
}

// ---------------------------------------------------------------------------------------------------
// War and peace
// ---------------------------------------------------------------------------------------------------

export function validateDeclareWar(world: WorldState, a: FactionId, b: FactionId): string | null {
  if (!world.factions[b]) return DIPLOMACY_REASONS.noFaction;
  if (a === b) return DIPLOMACY_REASONS.self;
  if (!world.factions[b]!.alive) return DIPLOMACY_REASONS.dead;
  const rel = getRelation(world, a, b);
  if (!rel) return DIPLOMACY_REASONS.noFaction;
  if (rel.atWar) return DIPLOMACY_REASONS.atWar;
  if (rel.truceUntilDay !== null && rel.truceUntilDay > today(world)) return DIPLOMACY_REASONS.truce(rel.truceUntilDay);
  return null;
}

/** Does a hold a grievance-worthy cause against b (any grievance in the relation, or opinion <= -30)? */
export function hasCasusBelli(world: WorldState, a: FactionId, b: FactionId): boolean {
  const rel = getRelation(world, a, b);
  if (!rel) return false;
  return rel.grievances.length > 0 || rel.opinion <= -30;
}

/**
 * War (events and the `declare_war` proposal). `force` skips the truce check (scripted events). Breaks the treaties
 * that forbid it, costs legitimacy without a grievance, and calls the defender's allies.
 */
export function declareWar(world: WorldState, a: FactionId, b: FactionId, out: SimEvent[], force = true): string | null {
  const reason = validateDeclareWar(world, a, b);
  if (reason && (!force || reason === DIPLOMACY_REASONS.atWar || reason === DIPLOMACY_REASONS.self || reason === DIPLOMACY_REASONS.noFaction)) return reason;
  const rel = getRelation(world, a, b)!;
  const cause = hasCasusBelli(world, a, b);
  for (const t of activeTreaties(world, a, b)) {
    if (t.type === 'tributary') continue; // a tributary war is a rebellion, not a breach of the peace treaty
    breakTreaty(world, a, t.id, out);
  }
  rel.atWar = true;
  rel.warStartDay = today(world);
  rel.warScore = 0;
  rel.truceUntilDay = null;
  addGrievance(world, a, b, 'war', -20);
  const fa = world.factions[a];
  if (fa && !cause) fa.legitimacy = Math.max(0, fa.legitimacy + RULES.politics.legitimacy.warWithoutGrievance);
  out.push({ kind: 'war_declared', a, b });
  addChronicle(world, a, `${FACTIONS[a]?.shortName ?? a} declared war on ${FACTIONS[b]?.shortName ?? b}.`, 2);
  notifyPlayer(world, out, b, 'danger', `${FACTIONS[a]?.shortName ?? a} has declared war on us!`);
  // Allies of the defender: mutual defense partners and the overlord of a tributary.
  for (const cid of sortedKeys(world.factions)) {
    if (cid === a || cid === b) continue;
    const c = world.factions[cid] as FactionState;
    if (!c.alive) continue;
    const md = activeTreaty(world, b, cid, 'mutual_defense');
    const trib = activeTreaty(world, b, cid, 'tributary');
    const overlord = !!trib && trib.terms.overlord === cid;
    if (!md && !overlord) continue;
    if (getRelation(world, cid, a)?.atWar) continue;
    if (c.isPlayer) {
      notifyPlayer(world, out, cid, 'warning', `${FACTIONS[b]?.shortName ?? b} calls on you to honour your pact against ${FACTIONS[a]?.shortName ?? a}.`);
      continue;
    }
    if (effectiveOpinion(world, cid, b) > 0 || overlord) {
      const rc = getRelation(world, cid, a);
      if (rc && rc.truceUntilDay !== null && rc.truceUntilDay > today(world)) continue;
      declareWar(world, cid, a, out, true);
    }
  }
  return null;
}

export function makePeace(world: WorldState, a: FactionId, b: FactionId, out: SimEvent[]): void {
  const rel = getRelation(world, a, b);
  if (!rel || !rel.atWar) return;
  createTreaty(world, 'peace', a, b, emptyTerms(), out);
}

// ---------------------------------------------------------------------------------------------------
// Strength, threats, acceptance utility
// ---------------------------------------------------------------------------------------------------

/** Total army strength of a faction (field armies + garrisons). */
export function factionStrength(world: WorldState, factionId: FactionId): number {
  let p = 0;
  for (const id of sortedKeys(world.armies)) {
    const a = world.armies[id] as ArmyState;
    if (a.factionId === factionId) p += armyStrength(a);
  }
  for (const id of sortedKeys(world.settlements)) {
    const s = world.settlements[id]!;
    if (s.ownerFactionId !== factionId || s.garrison.length === 0) continue;
    p += armyStrength({ units: s.garrison } as unknown as ArmyState);
  }
  return p;
}

function sharedEnemy(world: WorldState, a: FactionId, b: FactionId): boolean {
  for (const cid of sortedKeys(world.factions)) {
    if (cid === a || cid === b || !world.factions[cid]!.alive) continue;
    if (areAtWar(world, a, cid) && areAtWar(world, b, cid)) return true;
  }
  return false;
}

/** 0..1: a third realm both distrust (opinion < -20 or war) and that is at least as strong as the receiver. */
function sharedThreat(world: WorldState, a: FactionId, b: FactionId): number {
  let best = 0;
  const sb = Math.max(1, factionStrength(world, b));
  for (const cid of sortedKeys(world.factions)) {
    if (cid === a || cid === b || !world.factions[cid]!.alive) continue;
    const hostileA = areAtWar(world, a, cid) || effectiveOpinion(world, a, cid) < -20;
    const hostileB = areAtWar(world, b, cid) || effectiveOpinion(world, b, cid) < -20;
    if (hostileA && hostileB) best = Math.max(best, Math.min(1, factionStrength(world, cid) / sb));
  }
  return best;
}

export interface AcceptanceTerm {
  id: string;
  label: string;
  value: number;
}

export interface Acceptance {
  accept: boolean;
  utility: number;
  terms: AcceptanceTerm[];
  /** The three largest terms as reason lines ("They fear your army (+24)"). */
  reasons: string[];
}

const GRIEVANCE_LABEL: Record<Grievance['kind'], string> = {
  raid: 'They remember your raids',
  broken_treaty: 'You broke your word to them',
  border_incident: 'They remember the border incident',
  insult: 'They remember your insult',
  spy_caught: 'They caught your spies',
  war: 'They remember your war on them',
  marriage_refused: 'You refused their marriage offer',
};

function fmt(v: number): string {
  const r = Math.round(v);
  return r >= 0 ? `+${r}` : `${r}`;
}

/**
 * AI acceptance utility of a proposal from `from` to `to` (§7.10). Opinion terms (stored opinion and each grievance)
 * are x the receiver's diplomacyOpinion.
 */
export function evaluateAcceptance(world: WorldState, from: FactionId, to: FactionId, type: ProposalType): Acceptance {
  const A = DR.acceptance;
  const rel = getRelation(world, from, to);
  const dipl = factionMod(world, to, 'diplomacyOpinion');
  const terms: AcceptanceTerm[] = [];
  const opinionTerms = (w: number): void => {
    if (!rel) return;
    terms.push({ id: 'opinion', label: rel.opinion >= 0 ? 'They think well of you' : 'They think ill of you', value: w * dipl * rel.opinion });
    const byKind = new Map<Grievance['kind'], number>();
    for (const g of rel.grievances) byKind.set(g.kind, (byKind.get(g.kind) ?? 0) + g.amount);
    for (const [k, v] of [...byKind.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) terms.push({ id: `grievance_${k}`, label: GRIEVANCE_LABEL[k], value: w * dipl * v });
  };
  const toF = world.factions[to];
  const personality = toF?.ai.personality;
  const sFrom = Math.max(1, factionStrength(world, from));
  const sTo = Math.max(1, factionStrength(world, to));
  switch (type) {
    case 'peace':
    case 'ceasefire': {
      const p = A.peace;
      terms.push({ id: 'constant', label: 'They are wary of a peace', value: p.constant });
      opinionTerms(p.opinion);
      if (rel) {
        const scoreForTo = rel.a === to ? rel.warScore : -rel.warScore;
        if (scoreForTo < 0) terms.push({ id: 'losing', label: 'They are losing the war', value: p.losingWarScore * -scoreForTo });
        terms.push({ id: 'weariness', label: 'They are tired of war', value: (p.warWearinessPerMonth * rel.warWeariness) / BALANCE.diplomacy.warWearinessPerMonth });
      }
      if (sTo < sFrom) terms.push({ id: 'weaker', label: 'They fear your army', value: p.weakerBonus });
      break;
    }
    case 'trade': {
      const p = A.trade;
      terms.push({ id: 'constant', label: 'Trade profits both', value: p.constant });
      opinionTerms(p.opinion);
      if (personality === 'mercantile') terms.push({ id: 'mercantile', label: 'Their merchants want it', value: p.mercantile });
      break;
    }
    case 'military_access': {
      const p = A.military_access;
      terms.push({ id: 'constant', label: 'They mistrust foreign armies', value: p.constant });
      opinionTerms(p.opinion);
      terms.push({ id: 'trust', label: 'They trust you', value: p.trust * (rel?.trust ?? 0) });
      if (sharedEnemy(world, from, to)) terms.push({ id: 'shared_enemy', label: 'You share an enemy', value: p.sharedEnemy });
      break;
    }
    case 'mutual_defense': {
      const p = A.mutual_defense;
      terms.push({ id: 'constant', label: 'An alliance binds them', value: p.constant });
      opinionTerms(p.opinion);
      terms.push({ id: 'trust', label: 'They trust you', value: p.trust * (rel?.trust ?? 0) });
      const th = sharedThreat(world, from, to);
      if (th > 0) terms.push({ id: 'shared_threat', label: 'You face the same threat', value: p.sharedThreat * th });
      break;
    }
    case 'non_aggression': {
      const p = A.non_aggression;
      terms.push({ id: 'constant', label: 'Quiet borders suit them', value: p.constant });
      opinionTerms(p.opinion);
      const threat = Math.max(0, Math.min(1, sFrom / sTo - 1));
      if (threat > 0) terms.push({ id: 'threat', label: 'They fear your army', value: p.threat * threat });
      break;
    }
    case 'tributary':
    case 'demand_tribute': {
      const p = A.tributary;
      terms.push({ id: 'strength', label: sFrom / sTo >= p.strengthRatioOver ? 'They fear your army' : 'They do not fear your army', value: p.strengthWeight * (sFrom / sTo - p.strengthRatioOver) });
      const sc = rel ? (rel.a === to ? rel.warScore : -rel.warScore) : 0;
      if (rel?.atWar && sc < 0) terms.push({ id: 'losing', label: 'They are losing the war', value: p.losingWar });
      if (personality === 'defensive') terms.push({ id: 'pride', label: 'They are too proud to kneel', value: p.pride });
      opinionTerms(p.opinion);
      break;
    }
    case 'marriage_alliance': {
      const p = A.marriage_alliance;
      terms.push({ id: 'constant', label: 'A royal match honours them', value: p.constant });
      opinionTerms(p.opinion);
      const pf = world.factions[from]?.prestige ?? 0;
      const pt = toF?.prestige ?? 0;
      terms.push({ id: 'prestige', label: pf >= pt ? 'Your house is renowned' : 'Your house is lesser than theirs', value: (p.prestigePer5 * (pf - pt)) / 5 });
      if (personality === 'diplomatic') terms.push({ id: 'diplomatic', label: 'Their court favours alliances', value: p.diplomatic });
      break;
    }
    default:
      terms.push({ id: 'constant', label: 'They will not hear of it', value: -100 });
  }
  let u = 0;
  for (const t of terms) u += t.value;
  const top = terms
    .filter((t) => Math.round(t.value) !== 0)
    .slice()
    .sort((x, y) => Math.abs(y.value) - Math.abs(x.value) || (x.id < y.id ? -1 : 1))
    .slice(0, 3)
    .map((t) => `${t.label} (${fmt(t.value)})`);
  return { accept: u > 0, utility: u, terms, reasons: top };
}

/** Baseline-compatible wrapper (UI / AI). */
export function evaluateProposal(world: WorldState, p: DiplomaticProposal): { accept: boolean; score: number; reasons: string[] } {
  const a = evaluateAcceptance(world, p.from, p.to, p.type);
  return { accept: a.accept, score: a.utility, reasons: a.reasons };
}

// ---------------------------------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------------------------------

function age(world: WorldState, c: CharacterState): number {
  return world.calendar.year - c.birthYear;
}

/** Marriage validity (§7.10): both unmarried, alive, free, 16-40, at most one a ruler. */
export function validateMarriage(world: WorldState, aId: string, bId: string): string | null {
  const a = world.characters[aId];
  const b = world.characters[bId];
  if (!a || !b || a.id === b.id) return DIPLOMACY_REASONS.noCharacter;
  for (const c of [a, b]) {
    if (!c.alive || c.captiveOf || c.spouseId !== null) return DIPLOMACY_REASONS.marriage;
    const y = age(world, c);
    if (y < 16 || y > 40) return DIPLOMACY_REASONS.marriage;
  }
  const ra = world.factions[a.factionId]?.rulerId === a.id;
  const rb = world.factions[b.factionId]?.rulerId === b.id;
  if (ra && rb) return DIPLOMACY_REASONS.marriage;
  return null;
}

export function validateProposal(world: WorldState, from: FactionId, to: FactionId, type: ProposalType, terms: TreatyTerms): string | null {
  if (!world.factions[to]) return DIPLOMACY_REASONS.noFaction;
  if (from === to) return DIPLOMACY_REASONS.self;
  if (!world.factions[to]!.alive) return DIPLOMACY_REASONS.dead;
  const rel = getRelation(world, from, to);
  if (!rel) return DIPLOMACY_REASONS.noFaction;
  switch (type) {
    case 'declare_war':
      return validateDeclareWar(world, from, to);
    case 'peace':
    case 'ceasefire':
      return rel.atWar ? null : DIPLOMACY_REASONS.notAtWar;
    case 'break_treaty':
      return activeTreaties(world, from, to).some((t) => t.type !== 'peace') ? null : DIPLOMACY_REASONS.noTreaty;
    default: {
      if (rel.atWar) return DIPLOMACY_REASONS.atWar;
      const tt: TreatyType = type === 'demand_tribute' ? 'tributary' : type;
      if (!treatyUnlocked(world, from, tt)) return DIPLOMACY_REASONS.ageGate(AGES[treatyAge(tt)].name);
      if (activeTreaty(world, from, to, tt)) return DIPLOMACY_REASONS.already;
      if (tt === 'marriage_alliance') {
        const m = terms.marriage;
        if (!m) return DIPLOMACY_REASONS.marriage;
        const r = validateMarriage(world, m[0], m[1]);
        if (r) return r;
        const fs = [world.characters[m[0]]!.factionId, world.characters[m[1]]!.factionId];
        if (!fs.includes(from) || !fs.includes(to)) return DIPLOMACY_REASONS.notYours;
      }
      return null;
    }
  }
}

/** Marry two characters (spouse links). */
export function marry(world: WorldState, aId: string, bId: string): void {
  const a = world.characters[aId];
  const b = world.characters[bId];
  if (!a || !b) return;
  a.spouseId = b.id;
  b.spouseId = a.id;
  if (!a.roles.includes('consort') && world.factions[b.factionId]?.rulerId === b.id) a.roles.push('consort');
  if (!b.roles.includes('consort') && world.factions[a.factionId]?.rulerId === a.id) b.roles.push('consort');
}

/**
 * Propose (player or AI). AI receivers answer at once with their reasons; the player receives `proposal_received`.
 * Returns the proposal id, or a refusal reason (`{ reason }`).
 */
export function proposeTreaty(world: WorldState, from: FactionId, to: FactionId, type: ProposalType, terms: TreatyTerms, out: SimEvent[]): ProposalId | null {
  return propose(world, from, to, type, terms, out).proposalId;
}

export function propose(world: WorldState, from: FactionId, to: FactionId, type: ProposalType, terms: TreatyTerms, out: SimEvent[]): { reason: string | null; proposalId: ProposalId | null } {
  const reason = validateProposal(world, from, to, type, terms);
  if (reason) return { reason, proposalId: null };
  if (type === 'declare_war') {
    declareWar(world, from, to, out, false);
    return { reason: null, proposalId: null };
  }
  if (type === 'break_treaty') {
    const ts = activeTreaties(world, from, to).filter((t) => t.type !== 'peace');
    const t = ts[ts.length - 1];
    return { reason: t ? breakTreaty(world, from, t.id, out) : DIPLOMACY_REASONS.noTreaty, proposalId: null };
  }
  const p: DiplomaticProposal = { id: nextWorldId(world, 'prop'), from, to, type, terms: { ...terms }, day: today(world), status: 'pending', reasons: [] };
  world.diplomacy.proposals.push(p);
  const toFaction = world.factions[to];
  if (toFaction?.isPlayer) {
    p.reasons = evaluateAcceptance(world, to, from, type).reasons;
    out.push({ kind: 'proposal_received', proposalId: p.id, to });
  } else {
    const ev = evaluateAcceptance(world, from, to, type);
    p.reasons = ev.reasons;
    respondToProposal(world, p.id, ev.accept, out);
    notifyPlayer(world, out, from, ev.accept ? 'success' : 'warning', `${FACTIONS[to]?.shortName ?? to} ${ev.accept ? 'accepted' : 'refused'}: ${ev.reasons.join('; ')}`);
  }
  return { reason: null, proposalId: p.id };
}

export function validateResponse(world: WorldState, factionId: FactionId, proposalId: ProposalId): string | null {
  const p = world.diplomacy.proposals.find((x) => x.id === proposalId);
  if (!p) return DIPLOMACY_REASONS.noProposal;
  if (p.to !== factionId) return DIPLOMACY_REASONS.notForYou;
  if (p.status !== 'pending') return DIPLOMACY_REASONS.answered;
  return null;
}

export function respondToProposal(world: WorldState, proposalId: ProposalId, accept: boolean, out: SimEvent[]): void {
  const p = world.diplomacy.proposals.find((x) => x.id === proposalId);
  if (!p || p.status !== 'pending') return;
  p.status = accept ? 'accepted' : 'rejected';
  if (!accept) {
    if (p.type === 'marriage_alliance') addGrievance(world, p.to, p.from, 'marriage_refused', -10);
    return;
  }
  switch (p.type) {
    case 'peace':
    case 'ceasefire':
      makePeace(world, p.from, p.to, out);
      return;
    case 'tributary':
      createTreaty(world, 'tributary', p.from, p.to, p.terms, out);
      return;
    case 'demand_tribute':
      // Demanded of them: the proposer is the overlord.
      createTreaty(world, 'tributary', p.from, p.to, { ...p.terms, overlord: p.from, payer: p.to }, out);
      return;
    case 'marriage_alliance':
      if (p.terms.marriage) marry(world, p.terms.marriage[0], p.terms.marriage[1]);
      createTreaty(world, 'marriage_alliance', p.from, p.to, p.terms, out);
      return;
    case 'declare_war':
    case 'break_treaty':
      return;
    default:
      createTreaty(world, p.type, p.from, p.to, p.terms, out);
  }
}

/** arrange_marriage: within the realm at once; across realms as a marriage-alliance proposal. */
export function arrangeMarriage(world: WorldState, factionId: FactionId, aId: string, bId: string, out: SimEvent[]): string | null {
  const reason = validateMarriage(world, aId, bId);
  if (reason) return reason;
  const a = world.characters[aId]!;
  const b = world.characters[bId]!;
  if (a.factionId !== factionId && b.factionId !== factionId) return DIPLOMACY_REASONS.notYours;
  if (a.factionId === b.factionId) {
    marry(world, a.id, b.id);
    addChronicle(world, factionId, `${a.name} married ${b.name}.`, 1);
    return null;
  }
  const other = a.factionId === factionId ? b.factionId : a.factionId;
  return propose(world, factionId, other, 'marriage_alliance', { ...emptyTerms(), marriage: [a.id, b.id] }, out).reason;
}

// ---------------------------------------------------------------------------------------------------
// Daily / monthly
// ---------------------------------------------------------------------------------------------------

export function updateDiplomacyDaily(world: WorldState, out: SimEvent[]): void {
  const day = today(world);
  for (const p of world.diplomacy.proposals) if (p.status === 'pending' && day - p.day > DR.proposalDays) p.status = 'expired';
  if (world.diplomacy.proposals.length > 100) world.diplomacy.proposals.splice(0, world.diplomacy.proposals.length - 100);
  // Marriage alliances end when a spouse dies.
  for (const id of sortedKeys(world.diplomacy.treaties)) {
    const t = world.diplomacy.treaties[id] as Treaty;
    if (t.type !== 'marriage_alliance' || !isTreatyActive(world, t) || !t.terms.marriage) continue;
    const [x, y] = t.terms.marriage;
    if (!world.characters[x]?.alive || !world.characters[y]?.alive) t.endDay = day;
  }
  void out;
}

export function updateDiplomacyMonthly(world: WorldState, out: SimEvent[]): void {
  const d = BALANCE.diplomacy;
  for (const key of sortedKeys(world.diplomacy.relations)) {
    const rel = world.diplomacy.relations[key]!;
    if (!world.factions[rel.a]?.alive || !world.factions[rel.b]?.alive) continue;
    // Drift toward the baseline (+10 with a shared enemy).
    const target = sharedEnemy(world, rel.a, rel.b) ? 10 : 0;
    if (rel.opinion > target) rel.opinion = Math.max(target, rel.opinion - d.opinionDecayPerMonth);
    else if (rel.opinion < target) rel.opinion = Math.min(target, rel.opinion + d.opinionDecayPerMonth);
    if (activeTreaty(world, rel.a, rel.b, 'trade') && rel.opinion < 20) rel.opinion = Math.min(20, rel.opinion + d.tradeOpinionBonus);
    for (const g of rel.grievances) g.amount *= 1 - d.grievanceDecayPerMonth;
    rel.grievances = rel.grievances.filter((g) => Math.abs(g.amount) > 0.5);
    if (rel.atWar) {
      rel.warWeariness += d.warWearinessPerMonth;
      // Occupation: +2 a month for every settlement of the enemy's starting lands held.
      let net = 0;
      for (const sid of sortedKeys(world.settlements)) {
        const s = world.settlements[sid]!;
        if (s.ownerFactionId === rel.a && s.initialOwnerFactionId === rel.b) net += DR.warScore.occupationPerMonth;
        else if (s.ownerFactionId === rel.b && s.initialOwnerFactionId === rel.a) net -= DR.warScore.occupationPerMonth;
      }
      rel.warScore = Math.max(-100, Math.min(100, rel.warScore + net));
    }
  }
  void out;
}

export { relationOf };
