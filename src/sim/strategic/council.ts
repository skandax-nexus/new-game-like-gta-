/**
 * The royal council (DESIGN_SPEC §7.12): seats, monthly recommendations and competing advice.
 * OWNER: Simulation Engineer - Strategic World Simulation (SIM-01).
 *
 *  - Seats (CouncilSeat): chief minister (order, relief, peace), commander (military), treasurer (economy),
 *    spymaster (espionage), court scholar (succession, omens, culture). appoint_council validates the person.
 *  - Each seated advisor recommends at most one action a month on his topic, with a concrete StrategicCommand the UI
 *    offers as "Do it" (FactionState.councilAdvice). Advice competes: the treasurer wants silver, the chief minister
 *    wants the hungry fed.
 *  - Following an advisor (issuing his command, or choosing an event option tagged with his seat) +5 opinion of the
 *    ruler; ignoring -3 (at month end, or when another seat's event option is chosen); three ignored in a row -> a
 *    grievance (-10) and the advisor leaks (every rival's intel on the realm +0.1).
 */
import type { AdvisorRecommendation, CharacterState, CouncilSeat, EventChoiceDef, FactionId, FactionState, IssuedStrategicCommand, SimEvent, StrategicCommand, WorldState } from '../../core/types';
import { COUNCIL_SEATS } from '../../core/types';
import { sortedKeys } from '../../core/ids';
import { RULES } from '../../data/rules';
import { landmarkOptions } from './ages';
import { validateBuild } from './construction';
import { areAtWar, effectiveOpinion, factionStrength, getRelation, validateProposal, emptyTerms } from './diplomacy';
import { dailyConsumption, projectLedger, reserveDays } from './economy';
import { activeAgents, leakIntel, validateSpyMission } from './espionage';
import { lawfulSuccessor } from './dynasty';
import { validateNegotiation } from './politics';
import { validateRecruit } from './recruitment';
import { monsoonForecastFor } from './seasons';
import { addChronicle, notifyPlayer, today } from './state';

const CR = RULES.council;

export const COUNCIL_REASONS = {
  noCharacter: 'No such person',
  notYours: 'Not one of your people',
  dead: 'That person is dead',
  captive: 'That person is a prisoner',
  child: 'Councillors must be adults',
  ruler: 'The ruler presides over the council',
} as const;

export function validateAppointCouncil(world: WorldState, factionId: FactionId, seat: CouncilSeat, characterId: string | null): string | null {
  if (!(COUNCIL_SEATS as readonly string[]).includes(seat)) return 'No such seat';
  if (characterId === null) return null;
  const c = world.characters[characterId];
  if (!c) return COUNCIL_REASONS.noCharacter;
  if (c.factionId !== factionId) return COUNCIL_REASONS.notYours;
  if (!c.alive) return COUNCIL_REASONS.dead;
  if (c.captiveOf) return COUNCIL_REASONS.captive;
  if (world.calendar.year - c.birthYear < RULES.dynasty.adultAge) return COUNCIL_REASONS.child;
  if (world.factions[factionId]?.rulerId === c.id) return COUNCIL_REASONS.ruler;
  return null;
}

/** appoint_council: seat a person (null empties the seat); a person holds one seat. */
export function appointCouncil(world: WorldState, factionId: FactionId, seat: CouncilSeat, characterId: string | null): string | null {
  const reason = validateAppointCouncil(world, factionId, seat, characterId);
  if (reason) return reason;
  const f = world.factions[factionId] as FactionState;
  const old = f.council[seat] ? world.characters[f.council[seat]!] : null;
  if (old) old.councilSeat = null;
  delete f.council[seat];
  if (characterId) {
    const c = world.characters[characterId] as CharacterState;
    if (c.councilSeat && f.council[c.councilSeat] === c.id) delete f.council[c.councilSeat];
    c.councilSeat = seat;
    if (!c.roles.includes('advisor')) c.roles.push('advisor');
    f.council[seat] = c.id;
  }
  f.councilAdvice = f.councilAdvice.filter((a) => a.seat !== seat);
  f.advisorIgnored[seat] = 0;
  return null;
}

// ---------------------------------------------------------------------------------------------------
// Advice
// ---------------------------------------------------------------------------------------------------

type Advice = Omit<AdvisorRecommendation, 'advisorId' | 'seat'>;

function owned(world: WorldState, fid: FactionId): string[] {
  return sortedKeys(world.settlements).filter((id) => world.settlements[id]!.ownerFactionId === fid);
}

function chiefMinister(world: WorldState, f: FactionState): Advice | null {
  // Restless towns first.
  let worst: string | null = null;
  let wu = 0.29;
  for (const id of owned(world, f.id)) {
    const s = world.settlements[id]!;
    if (s.unrest > wu) {
      wu = s.unrest;
      worst = id;
    }
  }
  if (worst) {
    const s = world.settlements[worst]!;
    for (const offer of ['relief', 'tax_cut', 'autonomy'] as const) {
      if (validateNegotiation(world, f.id, worst, offer) === null) {
        const what = offer === 'relief' ? 'Open the granaries for them' : offer === 'tax_cut' ? 'Lighten their taxes' : 'Grant the province its own council';
        return { topic: 'order', text: `${s.name} is close to revolt. ${what} before they take up arms.`, suggestion: { kind: 'negotiate_rebels', settlementId: worst, offer }, urgency: Math.min(1, s.unrest + 0.2) };
      }
    }
  }
  // Hunger: relief from the royal reserve.
  for (const id of owned(world, f.id)) {
    const s = world.settlements[id]!;
    if (reserveDays(s) >= 30 || s.besiegedBy) continue;
    const food = Math.ceil(dailyConsumption(world, s) * 30);
    if (f.foodReserve >= food) return { topic: 'order', text: `${s.name} has less than a month of grain. Send it relief from the royal granaries.`, suggestion: { kind: 'send_relief', settlementId: id, food, wealth: 0 }, urgency: 0.7 };
  }
  // A long, losing war: sue for peace.
  for (const oid of sortedKeys(world.factions)) {
    const rel = getRelation(world, f.id, oid);
    if (!rel || !rel.atWar || rel.warStartDay === null || today(world) - rel.warStartDay < 180) continue;
    const score = rel.a === f.id ? rel.warScore : -rel.warScore;
    if (score < 0 && validateProposal(world, f.id, oid, 'peace', emptyTerms()) === null) {
      return { topic: 'diplomacy', text: `This war is bleeding us. Offer ${world.factions[oid]!.name} peace.`, suggestion: { kind: 'propose', to: oid, type: 'peace', terms: emptyTerms() }, urgency: 0.6 };
    }
  }
  return null;
}

function commander(world: WorldState, f: FactionState): Advice | null {
  // An enemy host near one of our settlements: raise spears there.
  for (const id of owned(world, f.id)) {
    const s = world.settlements[id]!;
    for (const aid of sortedKeys(world.armies)) {
      const a = world.armies[aid]!;
      if (a.factionId === f.id || !areAtWar(world, f.id, a.factionId)) continue;
      const d2 = (a.x - s.x) * (a.x - s.x) + (a.z - s.z) * (a.z - s.z);
      if (d2 > 1500 * 1500) continue;
      if (validateRecruit(world, f.id, id, 'spearmen', 2, null).ok) {
        return { topic: 'military', text: `${a.name} is a day's march from ${s.name}. Raise spearmen there now.`, suggestion: { kind: 'recruit', settlementId: id, unitClass: 'spearmen', formations: 2, targetArmyId: null }, urgency: 0.8 };
      }
    }
  }
  // Stronger than an enemy: take the war to him.
  for (const oid of sortedKeys(world.factions)) {
    if (!areAtWar(world, f.id, oid)) continue;
    if (factionStrength(world, f.id) < 1.3 * factionStrength(world, oid)) continue;
    let army: string | null = null;
    let soldiers = 0;
    for (const aid of sortedKeys(world.armies)) {
      const a = world.armies[aid]!;
      const n = a.units.reduce((t, u) => t + u.soldiers, 0);
      if (a.factionId === f.id && a.status === 'camped' && n > soldiers) {
        soldiers = n;
        army = aid;
      }
    }
    const target = owned(world, oid)[0];
    if (army && target) {
      return { topic: 'military', text: `We are stronger than ${world.factions[oid]!.name}. March on ${world.settlements[target]!.name}.`, suggestion: { kind: 'army_order', armyId: army, order: { kind: 'besiege', settlementId: target } }, urgency: 0.5 };
    }
  }
  return null;
}

function treasurer(world: WorldState, f: FactionState): Advice | null {
  const ledger = projectLedger(world, f.id);
  if (ledger.net < 0 || f.treasury < 0) {
    const next = f.taxPolicy === 'lenient' ? 'standard' : f.taxPolicy === 'standard' ? 'heavy' : null;
    if (next) return { topic: 'economy', text: `We spend ${Math.round(-ledger.net)} more than we take each month. Raise the taxes.`, suggestion: { kind: 'set_tax_policy', policy: next }, urgency: f.treasury < 0 ? 0.9 : 0.6 };
  }
  const cap = f.capitalSettlementId;
  if (cap) {
    for (const b of ['market', 'granary'] as const) {
      const chk = validateBuild(world, f.id, cap, b);
      if (chk.ok && !chk.upgrade && f.treasury > chk.cost.wealth * 3) {
        const why = b === 'market' ? 'A market in the capital will bring silver and grain when we need it.' : 'A granary will stop our grain from rotting.';
        return { topic: 'economy', text: why, suggestion: { kind: 'build', settlementId: cap, building: b }, urgency: 0.4 };
      }
    }
  }
  return null;
}

function spymaster(world: WorldState, f: FactionState): Advice | null {
  let target: FactionId | null = null;
  let best = 0;
  for (const oid of sortedKeys(world.factions)) {
    if (oid === f.id || !world.factions[oid]!.alive) continue;
    const hostile = areAtWar(world, f.id, oid) || effectiveOpinion(world, f.id, oid) < -20;
    if (!hostile) continue;
    const st = factionStrength(world, oid);
    if (st > best) {
      best = st;
      target = oid;
    }
  }
  if (!target) return null;
  if (activeAgents(world, f.id).some((a) => a.targetFactionId === target && a.mission === 'gather_intel')) return null;
  if ((world.espionage.intel[f.id]?.[target]?.level ?? 0) >= 0.6) return null;
  if (validateSpyMission(world, f.id, target, 'gather_intel', null, null) !== null) return null;
  return { topic: 'espionage', text: `We know too little of ${world.factions[target]!.name}. Send an agent to count their spears.`, suggestion: { kind: 'spy_mission', targetFactionId: target, mission: 'gather_intel', settlementId: null, agentCharacterId: null }, urgency: 0.4 };
}

function courtScholar(world: WorldState, f: FactionState): Advice | null {
  const heir = f.heirId ? world.characters[f.heirId] : null;
  if (!heir || !heir.alive) {
    const c = lawfulSuccessor(world, f.id, f.rulerId);
    if (c) return { topic: 'succession', text: `The throne has no named heir. Name ${c.name} before the court divides.`, suggestion: { kind: 'designate_heir', characterId: c.id }, urgency: 0.7 };
  }
  const m = world.calendar.month;
  if (m >= 3 && m <= 4 && !f.policies.rationingUntilDay) {
    const fc = monsoonForecastFor(world, world.calendar.year);
    if (fc < 0.75) return { topic: 'economy', text: `The omens promise a weak monsoon (${fc.toFixed(2)}). Ration the grain now.`, suggestion: { kind: 'set_policy', policy: 'rationing', on: true }, urgency: 0.6 };
  }
  const ready = landmarkOptions(world, f.id).find((o) => o.status === 'available');
  if (ready) return { topic: 'order', text: 'The realm is ready for a new age. Raise a great work to mark it.', suggestion: null, urgency: 0.3 };
  return null;
}

const ADVISORS: Record<CouncilSeat, (world: WorldState, f: FactionState) => Advice | null> = {
  chief_minister: chiefMinister,
  commander,
  treasurer,
  spymaster,
  court_scholar: courtScholar,
};

/** This month's recommendations for a realm (pure; at most one per seated advisor). */
export function computeCouncilAdvice(world: WorldState, factionId: FactionId): AdvisorRecommendation[] {
  const f = world.factions[factionId];
  if (!f) return [];
  const out: AdvisorRecommendation[] = [];
  for (const seat of COUNCIL_SEATS) {
    const id = f.council[seat];
    const c = id ? world.characters[id] : null;
    if (!c || !c.alive || c.captiveOf) continue;
    const a = ADVISORS[seat](world, f);
    if (a) out.push({ advisorId: c.id, seat, ...a });
  }
  return out;
}

/** Recommendations the council screen shows (this month's, or fresh ones before the first month ends). */
export function getCouncilRecommendations(world: WorldState, factionId: FactionId): AdvisorRecommendation[] {
  const f = world.factions[factionId];
  if (!f) return [];
  return f.councilAdvice.length > 0 ? f.councilAdvice : computeCouncilAdvice(world, factionId);
}

// ---------------------------------------------------------------------------------------------------
// Following / ignoring
// ---------------------------------------------------------------------------------------------------

function advisorAt(world: WorldState, f: FactionState, seat: CouncilSeat): CharacterState | null {
  const id = f.council[seat];
  const c = id ? world.characters[id] : null;
  return c && c.alive ? c : null;
}

function adjust(c: CharacterState, delta: number): void {
  c.opinionOfRuler = Math.max(-100, Math.min(100, c.opinionOfRuler + delta));
  c.loyalty = Math.max(0, Math.min(1, c.loyalty + delta / 200));
}

/** An advisor was followed: +5, his ignored streak resets. */
export function followAdvisor(world: WorldState, factionId: FactionId, seat: CouncilSeat): void {
  const f = world.factions[factionId];
  const c = f ? advisorAt(world, f, seat) : null;
  if (!f || !c) return;
  adjust(c, CR.followedOpinion);
  f.advisorIgnored[seat] = 0;
}

/** An advisor was ignored: -3; the third time in a row a grievance (-10) and a leak. */
export function ignoreAdvisor(world: WorldState, factionId: FactionId, seat: CouncilSeat, out: SimEvent[]): void {
  const f = world.factions[factionId];
  const c = f ? advisorAt(world, f, seat) : null;
  if (!f || !c) return;
  adjust(c, CR.ignoredOpinion);
  f.advisorIgnored[seat] = (f.advisorIgnored[seat] ?? 0) + 1;
  if (f.advisorIgnored[seat] >= CR.ignoredStreakForGrievance) {
    adjust(c, CR.grievanceOpinion);
    f.advisorIgnored[seat] = 0;
    leakIntel(world, factionId, 0.1);
    addChronicle(world, factionId, `${c.name}, slighted once too often, began to talk in other courts.`, 1);
    notifyPlayer(world, out, factionId, 'warning', `${c.name} feels ignored - and has been talking to foreign envoys.`);
  }
}

const KEY_FIELDS: Partial<Record<StrategicCommand['kind'], readonly string[]>> = {
  negotiate_rebels: ['settlementId', 'offer'],
  send_relief: ['settlementId'],
  recruit: ['settlementId', 'unitClass'],
  set_tax_policy: ['policy'],
  build: ['settlementId', 'building'],
  spy_mission: ['targetFactionId', 'mission'],
  designate_heir: ['characterId'],
  set_policy: ['policy', 'on'],
  propose: ['to', 'type'],
  army_order: ['armyId'],
};

function matches(s: StrategicCommand, c: StrategicCommand): boolean {
  if (s.kind !== c.kind) return false;
  const keys = KEY_FIELDS[s.kind] ?? [];
  const a = s as unknown as Record<string, unknown>;
  const b = c as unknown as Record<string, unknown>;
  for (const k of keys) if (a[k] !== b[k]) return false;
  if (s.kind === 'army_order' && c.kind === 'army_order') return s.order.kind === c.order.kind;
  return true;
}

/** An accepted player command: does it follow a recommendation? */
export function noteCommandForCouncil(world: WorldState, issued: IssuedStrategicCommand): void {
  const f = world.factions[issued.factionId];
  if (!f || !f.isPlayer || f.councilAdvice.length === 0) return;
  const keep: AdvisorRecommendation[] = [];
  for (const a of f.councilAdvice) {
    if (a.suggestion && matches(a.suggestion, issued.cmd)) followAdvisor(world, f.id, a.seat);
    else keep.push(a);
  }
  f.councilAdvice = keep;
}

/** A player event choice: the chosen option's seat is followed, the other options' seats ignored. */
export function noteEventChoice(world: WorldState, factionId: FactionId, choices: readonly EventChoiceDef[], chosenId: string, out: SimEvent[]): void {
  const f = world.factions[factionId];
  if (!f || !f.isPlayer) return;
  const chosen = choices.find((c) => c.id === chosenId)?.advisorSeat ?? null;
  if (chosen) followAdvisor(world, factionId, chosen);
  const ignored = new Set<CouncilSeat>();
  for (const c of choices) if (c.advisorSeat && c.advisorSeat !== chosen) ignored.add(c.advisorSeat);
  for (const seat of COUNCIL_SEATS) if (ignored.has(seat)) ignoreAdvisor(world, factionId, seat, out);
}

/** Month end: unheeded advice counts as ignored; then each seat speaks again. */
export function updateCouncilMonthly(world: WorldState, out: SimEvent[]): void {
  for (const fid of sortedKeys(world.factions)) {
    const f = world.factions[fid]!;
    if (!f.alive || !f.isPlayer) {
      if (f.councilAdvice.length > 0) f.councilAdvice = [];
      continue;
    }
    for (const a of f.councilAdvice) if (a.suggestion) ignoreAdvisor(world, fid, a.seat, out);
    f.councilAdvice = computeCouncilAdvice(world, fid);
  }
}
