/**
 * SIM-01 phase E: diplomacy, espionage, dynasty and council (DESIGN_SPEC §7.10-§7.12). OWNER: Simulation Engineer -
 * Strategic World Simulation.
 *
 * Peace ends wars (truce), tributary direction (a overlord, b payer), acceptance utility with the three largest terms
 * as reasons, proposals to and from the player, treaty breaking costs, war declarations and allies, marriages,
 * monthly opinion / weariness / occupation; espionage progress, risk, effects, tiers; aging, births, every succession
 * law, regency, adoption, crises; council advice, following and ignoring.
 */
import { describe, expect, it } from 'vitest';
import type { SimEvent, WorldState } from '../../../src/core/types';
import { RULES } from '../../../src/data/rules';
import {
  breakTreaty,
  createTreaty,
  declareWar,
  DIPLOMACY_REASONS,
  effectiveOpinion,
  emptyTerms,
  evaluateAcceptance,
  getRelation,
  hasTreaty,
  propose,
  updateDiplomacyMonthly,
  validateMarriage,
} from '../../../src/sim/strategic/diplomacy';
import { computeLedger, effectiveAutonomy } from '../../../src/sim/strategic/economy';
import { paysTributeTo } from '../../../src/sim/strategic/treaties';
import { applyEffect } from '../../../src/sim/strategic/events';
import {
  ESPIONAGE_REASONS,
  intelView,
  maxAgents,
  missionProgressPerDay,
  missionRiskPerDay,
  startMission,
  updateEspionageDaily,
} from '../../../src/sim/strategic/espionage';
import { agingHealthLoss, designateHeir, DYNASTY_REASONS, handleDeath, lawfulSuccessor, updateCharactersYearly } from '../../../src/sim/strategic/dynasty';
import { appointCouncil, computeCouncilAdvice, COUNCIL_REASONS, ignoreAdvisor, noteCommandForCouncil, updateCouncilMonthly } from '../../../src/sim/strategic/council';
import { factionMod } from '../../../src/sim/strategic/modifiers';
import { campaign, cmd, issue, quiet, runDays, sandbox } from './helpers';

const scope = { factionId: 'heartland', settlementId: null, provinceId: null, characterId: null, armyId: null };

function rel(w: WorldState, a: string, b: string) {
  return getRelation(w, a, b)!;
}

describe('peace and war (DESIGN_SPEC §7.10)', () => {
  it('sign_treaty peace ends the war and starts a 360-day truce that blocks a new declaration', () => {
    const w = campaign(5);
    const r = rel(w, 'heartland', 'highland');
    expect(r.atWar).toBe(true);
    const out: SimEvent[] = [];
    applyEffect(w, { kind: 'sign_treaty', a: { kind: 'player' }, b: { kind: 'faction', id: 'highland' }, type: 'peace' }, scope, out);
    expect(r.atWar).toBe(false);
    expect(r.warScore).toBe(0);
    expect(hasTreaty(w, 'heartland', 'highland', 'peace')).toBe(true);
    expect(out.some((e) => e.kind === 'peace_made')).toBe(true);
    expect(r.truceUntilDay).toBe(w.calendar.totalHours / 24 + 360 - ((w.calendar.totalHours / 24) % 1));
    expect(propose(w, 'heartland', 'highland', 'declare_war', emptyTerms(), out).reason).toBe(DIPLOMACY_REASONS.truce(r.truceUntilDay!));
    w.calendar.totalHours += 24 * 361;
    expect(propose(w, 'heartland', 'highland', 'declare_war', emptyTerms(), out).reason).toBeNull();
    expect(r.atWar).toBe(true);
    // Declaring broke the peace treaty: opinion -40, trust -0.15 with everyone.
    expect(hasTreaty(w, 'heartland', 'highland', 'peace')).toBe(false);
  });

  it('declaring war without a grievance costs 0.03 legitimacy; with one it does not', () => {
    const run = (grievance: boolean): number => {
      const w = campaign(5);
      const r = rel(w, 'heartland', 'forest');
      r.grievances = grievance ? [{ kind: 'raid', day: 0, amount: -10 }] : [];
      r.opinion = 10;
      const leg = w.factions.heartland!.legitimacy;
      expect(declareWar(w, 'heartland', 'forest', [], false)).toBeNull();
      expect(r.atWar).toBe(true);
      expect(r.grievances.some((g) => g.kind === 'war')).toBe(true);
      return w.factions.heartland!.legitimacy - leg;
    };
    expect(run(false)).toBeCloseTo(-0.03, 10);
    expect(run(true)).toBeCloseTo(0, 10);
  });

  it('a mutual-defense partner with a good opinion of the defender joins its war', () => {
    const w = campaign(5);
    createTreaty(w, 'mutual_defense', 'forest', 'frontier');
    rel(w, 'forest', 'frontier').opinion = 30;
    const out: SimEvent[] = [];
    declareWar(w, 'highland', 'frontier', out, false);
    expect(rel(w, 'highland', 'frontier').atWar).toBe(true);
    expect(rel(w, 'forest', 'highland').atWar).toBe(true);
    expect(out.filter((e) => e.kind === 'war_declared').length).toBe(2);
  });

  it('war weariness +3 a month; occupation +2 a month per enemy settlement held; opinion drifts toward 0', () => {
    const w = campaign(5);
    const r = rel(w, 'heartland', 'highland');
    const ww = r.warWeariness;
    w.settlements.pashanagram!.ownerFactionId = 'heartland';
    const score = r.warScore;
    r.opinion = -35;
    updateDiplomacyMonthly(w, []);
    expect(r.warWeariness).toBe(ww + 3);
    expect(r.warScore - score).toBe(r.a === 'heartland' ? 2 : -2);
    expect(r.opinion).toBe(-33);
  });
});

describe('tributaries (DESIGN_SPEC §7.10)', () => {
  it('sign_treaty a,b tributary: a is the overlord, b the payer (10% of income, payer autonomy +0.25)', () => {
    const w = campaign(5);
    applyEffect(w, { kind: 'sign_treaty', a: { kind: 'faction', id: 'heartland' }, b: { kind: 'faction', id: 'frontier' }, type: 'tributary' }, scope, []);
    const t = paysTributeTo(w, 'frontier')[0]!;
    expect(t.terms.overlord).toBe('heartland');
    expect(t.terms.payer).toBe('frontier');
    expect(paysTributeTo(w, 'heartland')).toEqual([]);
    w.factions.frontier!.ledger.taxIncome = 800;
    w.factions.frontier!.ledger.tradeIncome = 200;
    const lav = w.settlements.lavanapura!;
    expect(effectiveAutonomy(w, lav)).toBeCloseTo(Math.min(1, w.provinces[lav.provinceId]!.autonomy + 0.25), 10);
    const payer = computeLedger(w, 'frontier');
    const lord = computeLedger(w, 'heartland');
    expect(payer.tributeOut).toBeCloseTo(100, 6);
    expect(lord.tributeIn).toBeCloseTo(payer.tributeOut, 6);
  });

  it('demand_tribute accepted makes the proposer the overlord', () => {
    const w = campaign(5);
    // A crushing army so the forest realm kneels.
    for (const a of Object.values(w.armies)) if (a.factionId === 'forest') a.units = a.units.slice(0, 1);
    for (const a of Object.values(w.armies)) if (a.factionId === 'heartland') a.units.push(...a.units.map((u) => ({ ...u, id: u.id + '_x' })));
    rel(w, 'heartland', 'forest').opinion = 50;
    const res = propose(w, 'heartland', 'forest', 'demand_tribute', emptyTerms(), []);
    expect(res.reason).toBeNull();
    const p = w.diplomacy.proposals.find((x) => x.id === res.proposalId)!;
    expect(p.status).toBe('accepted');
    const t = paysTributeTo(w, 'forest')[0]!;
    expect(t.terms.overlord).toBe('heartland');
  });
});

describe('acceptance utility (DESIGN_SPEC §7.10)', () => {
  it('the reply lists the three largest terms, largest first, with signed values', () => {
    const w = campaign(5);
    const r = rel(w, 'heartland', 'forest');
    r.opinion = 40;
    r.grievances = [{ kind: 'raid', day: 0, amount: -10 }];
    const acc = evaluateAcceptance(w, 'heartland', 'forest', 'trade');
    expect(acc.reasons.length).toBe(3);
    const vals = acc.terms.map((t) => t.value).sort((a, b) => Math.abs(b) - Math.abs(a)).slice(0, 3);
    const shown = acc.reasons.map((s) => Number(/\(([+-]\d+)\)$/.exec(s)![1]));
    expect(shown).toEqual(vals.map((v) => Math.round(v)));
    expect(acc.reasons.some((s) => s.startsWith('They remember your raids'))).toBe(true);
    expect(acc.utility).toBeCloseTo(acc.terms.reduce((t, x) => t + x.value, 0), 10);
    expect(acc.accept).toBe(acc.utility > 0);
  });

  it('trade: 15 + 0.5 x opinion; refused when grievances sour the opinion', () => {
    const w = campaign(5);
    const r = rel(w, 'heartland', 'forest');
    r.opinion = 0;
    r.grievances = [{ kind: 'broken_treaty', day: 0, amount: -40 }, { kind: 'raid', day: 0, amount: -10 }];
    const no = evaluateAcceptance(w, 'heartland', 'forest', 'trade');
    expect(no.accept).toBe(false);
    r.grievances = [];
    r.opinion = 20;
    for (const t of Object.values(w.diplomacy.treaties)) if (t.type === 'trade') t.endDay = 0;
    const yes = evaluateAcceptance(w, 'heartland', 'forest', 'trade');
    expect(yes.accept).toBe(true);
    const res = propose(w, 'heartland', 'forest', 'trade', emptyTerms(), []);
    expect(res.reason).toBeNull();
    expect(hasTreaty(w, 'heartland', 'forest', 'trade')).toBe(true);
    const reasons = w.diplomacy.proposals.find((p) => p.id === res.proposalId)!.reasons;
    const op = Math.round(0.5 * factionMod(w, 'forest', 'diplomacyOpinion') * 20);
    expect(reasons).toEqual(['Trade profits both (+15)', `They think well of you (+${op})`]);
  });

  it('proposals are validated: age gates, existing treaties, war', () => {
    const w = campaign(5);
    w.factions.heartland!.age = 'janapada';
    expect(propose(w, 'heartland', 'forest', 'military_access', emptyTerms(), []).reason).toBe('Requires the Mahajanapada Age');
    expect(propose(w, 'heartland', 'highland', 'trade', emptyTerms(), []).reason).toBe(DIPLOMACY_REASONS.atWar);
    expect(propose(w, 'heartland', 'forest', 'peace', emptyTerms(), []).reason).toBe(DIPLOMACY_REASONS.notAtWar);
    createTreaty(w, 'trade', 'heartland', 'forest');
    expect(propose(w, 'heartland', 'forest', 'trade', emptyTerms(), []).reason).toBe(DIPLOMACY_REASONS.already);
    const out = issue(w, { kind: 'propose', to: 'forest', type: 'trade', terms: emptyTerms() });
    expect(out.some((e) => e.kind === 'notification' && e.text === DIPLOMACY_REASONS.already)).toBe(true);
  });

  it('an AI proposal to the player waits for respond_proposal (validated)', () => {
    const w = campaign(5);
    rel(w, 'heartland', 'forest').opinion = 30;
    const out: SimEvent[] = [];
    const res = propose(w, 'forest', 'heartland', 'non_aggression', emptyTerms(), out);
    expect(out.some((e) => e.kind === 'proposal_received')).toBe(true);
    expect(w.diplomacy.proposals.find((p) => p.id === res.proposalId)!.status).toBe('pending');
    issue(w, { kind: 'respond_proposal', proposalId: res.proposalId!, accept: true }, 'highland');
    expect(hasTreaty(w, 'heartland', 'forest', 'non_aggression')).toBe(false);
    expect(w.diplomacy.proposals.find((p) => p.id === res.proposalId)!.status).toBe('pending');
    issue(w, { kind: 'respond_proposal', proposalId: res.proposalId!, accept: true });
    expect(hasTreaty(w, 'heartland', 'forest', 'non_aggression')).toBe(true);
  });
});

describe('breaking treaties and marriages (DESIGN_SPEC §7.10)', () => {
  it('breaking a trade treaty: opinion -20, trust -0.15 with everyone, a grievance', () => {
    const w = campaign(5);
    const t = createTreaty(w, 'trade', 'heartland', 'forest');
    const r = rel(w, 'heartland', 'forest');
    const o = r.opinion;
    const trusts = Object.values(w.diplomacy.relations).filter((x) => x.a === 'heartland' || x.b === 'heartland').map((x) => x.trust);
    expect(breakTreaty(w, 'heartland', t.id, [])).toBeNull();
    expect(r.opinion).toBe(o - 20);
    expect(r.grievances.some((g) => g.kind === 'broken_treaty')).toBe(true);
    Object.values(w.diplomacy.relations)
      .filter((x) => x.a === 'heartland' || x.b === 'heartland')
      .forEach((x, i) => expect(x.trust).toBeCloseTo(Math.max(0, trusts[i]! - 0.15), 10));
    expect(breakTreaty(w, 'heartland', t.id, [])).toBe(DIPLOMACY_REASONS.noTreaty);
  });

  it('a cross-realm marriage is a marriage-alliance proposal: spouses linked, opinion +30, trust +0.2; it ends with a spouse', () => {
    const w = campaign(5);
    const r = rel(w, 'heartland', 'highland');
    r.atWar = false;
    r.opinion = 40;
    expect(validateMarriage(w, 'char_heir', 'char_giri_raja')).toBe(DIPLOMACY_REASONS.marriage); // he is a ruler, but married? both 16-40
    expect(validateMarriage(w, 'char_regent', 'char_heir')).toBe(DIPLOMACY_REASONS.marriage); // 44
    expect(validateMarriage(w, 'char_heir', 'char_giri_kumari')).toBeNull();
    const o = r.opinion;
    const trust = r.trust;
    issue(w, { kind: 'arrange_marriage', characterId: 'char_heir', otherCharacterId: 'char_giri_kumari' });
    expect(w.characters.char_heir!.spouseId).toBe('char_giri_kumari');
    expect(hasTreaty(w, 'heartland', 'highland', 'marriage_alliance')).toBe(true);
    expect(r.opinion).toBe(Math.min(100, o + 30));
    expect(r.trust).toBeCloseTo(Math.min(1, trust + 0.2), 10);
    handleDeath(w, 'char_giri_kumari', []);
    runDays(w, 1, { autoEvents: false, autoEngagements: false });
    expect(hasTreaty(w, 'heartland', 'highland', 'marriage_alliance')).toBe(false);
    expect(w.characters.char_heir!.spouseId).toBeNull();
  });

  it('breaking a marriage alliance costs 60 opinion and 0.1 legitimacy', () => {
    const w = campaign(5);
    rel(w, 'heartland', 'forest').opinion = 0;
    const t = createTreaty(w, 'marriage_alliance', 'heartland', 'forest');
    const leg = w.factions.heartland!.legitimacy;
    breakTreaty(w, 'heartland', t.id, []);
    expect(rel(w, 'heartland', 'forest').opinion).toBe(30 - 60);
    expect(w.factions.heartland!.legitimacy).toBeCloseTo(leg - 0.1, 10);
    expect(effectiveOpinion(w, 'heartland', 'forest')).toBe(-30 - 10);
  });
});

describe('espionage (DESIGN_SPEC §7.11)', () => {
  it('max agents = 1 + spymaster intrigue / 5; nominal days at skill 10 without a network', () => {
    const w = campaign(5);
    const sm = w.characters[w.factions.heartland!.council.spymaster!]!;
    expect(maxAgents(w, 'heartland')).toBe(1 + Math.floor(sm.skills.intrigue / 5));
    const res = startMission(w, 'heartland', 'highland', 'gather_intel', null, null);
    const a = w.espionage.agents[res.agentId!]!;
    a.skill = 10;
    (w.espionage.network.heartland ??= {}).highland = 0;
    expect((missionProgressPerDay(w, a) * RULES.espionage.missionDays.gather_intel) / factionMod(w, 'heartland', 'espionage')).toBeCloseTo(1, 10);
    expect(missionRiskPerDay(w, a)).toBeCloseTo(0.01 * 1 * 1, 10);
    w.factions.highland!.counterIntel = 0.3;
    w.factions.highland!.counterIntelUntilDay = 1e9;
    expect(missionRiskPerDay(w, a)).toBeCloseTo(0.01 * 1.45, 10);
    for (let i = 1; i < maxAgents(w, 'heartland'); i++) startMission(w, 'heartland', 'forest', 'gather_intel', null, null);
    expect(startMission(w, 'heartland', 'forest', 'gather_intel', null, null).reason).toBe(ESPIONAGE_REASONS.tooMany(maxAgents(w, 'heartland')));
  });

  it('gather_intel: intel +0.4 and their armies visible for 60 days; tiers widen what is seen', () => {
    const w = campaign(5);
    const res = startMission(w, 'heartland', 'highland', 'gather_intel', null, null);
    const a = w.espionage.agents[res.agentId!]!;
    a.skill = 30; // no risk
    expect(intelView(w, 'heartland', 'highland').tier).toBe(0);
    for (let d = 0; d < 30 && a.status === 'active'; d++) updateEspionageDaily(w, []);
    expect(a.status).toBe('returned');
    const st = w.espionage.intel.heartland!.highland!;
    expect(st.level).toBeGreaterThanOrEqual(0.39);
    expect(st.armiesVisibleUntilDay).toBe(Math.floor(w.calendar.totalHours / 24) + 60);
    st.level = 0.45;
    const v1 = intelView(w, 'heartland', 'highland');
    expect(v1.tier).toBe(1);
    expect(v1.treasuryBracket).not.toBeNull();
    expect(v1.treasury).toBeNull();
    st.level = 0.7;
    const v2 = intelView(w, 'heartland', 'highland');
    expect(v2.tier).toBe(2);
    expect(v2.treasury).toBe(Math.round(w.factions.highland!.treasury));
    expect(v2.armies.every((x) => x.exact)).toBe(true);
  });

  it('a caught agent: grievance spy_caught (-20); a character agent is imprisoned', () => {
    const w = campaign(5);
    w.factions.highland!.counterIntel = 1;
    w.factions.highland!.counterIntelUntilDay = 1e9;
    const res = startMission(w, 'heartland', 'highland', 'incite_unrest', 'giridurg', 'char_spymaster');
    expect(res.reason).toBeNull();
    const a = w.espionage.agents[res.agentId!]!;
    a.skill = 0;
    for (let d = 0; d < 400 && a.status === 'active'; d++) updateEspionageDaily(w, []);
    if (a.status === 'captured') {
      expect(w.characters.char_spymaster!.captiveOf).toBe('highland');
      expect(rel(w, 'heartland', 'highland').grievances.some((g) => g.kind === 'spy_caught' && g.amount === -20)).toBe(true);
    } else {
      expect(a.status).toBe('returned');
    }
    expect(startMission(w, 'heartland', 'highland', 'incite_unrest', 'rajapura', null).reason).toBe(ESPIONAGE_REASONS.notTheirs);
  });

  it('incite_unrest +0.2 (+0.3 where a claimant lives); spread_rumors halved by protect_court', () => {
    const w = campaign(5);
    const s = w.settlements.giridurg!;
    const u = s.unrest;
    const res = startMission(w, 'highland', 'heartland', 'incite_unrest', 'ratnapura', null);
    w.espionage.agents[res.agentId!]!.skill = 30;
    const r = w.settlements.ratnapura!;
    const ru = r.unrest;
    for (let d = 0; d < 60; d++) updateEspionageDaily(w, []);
    expect(r.unrest).toBeCloseTo(Math.min(1, ru + 0.3), 6); // Devavarman governs Ratnadesha
    void u;
    w.factions.heartland!.protectCourtUntilDay = 1e9;
    const leg = w.factions.heartland!.legitimacy;
    const res2 = startMission(w, 'highland', 'heartland', 'spread_rumors', null, null);
    w.espionage.agents[res2.agentId!]!.skill = 30;
    for (let d = 0; d < 60; d++) updateEspionageDaily(w, []);
    expect(w.factions.heartland!.legitimacy).toBeCloseTo(leg - 0.025, 6);
  });

  it('intel decays 0.08 a month', () => {
    const w = campaign(5);
    (w.espionage.intel.heartland ??= {}).forest = { level: 0.5, lastUpdatedDay: 0, armiesVisibleUntilDay: null };
    for (let d = 0; d < 30; d++) updateEspionageDaily(w, []);
    expect(w.espionage.intel.heartland!.forest!.level).toBeCloseTo(0.42, 6);
  });
});

describe('dynasty (DESIGN_SPEC §7.12)', () => {
  it('aging: -0.03 a year from 50, -0.06 from 60, -0.12 from 70', () => {
    expect(agingHealthLoss(40)).toBe(0);
    expect(agingHealthLoss(55)).toBeCloseTo(0.03, 10);
    expect(agingHealthLoss(65)).toBeCloseTo(0.06, 10);
    expect(agingHealthLoss(75)).toBeCloseTo(0.12, 10);
  });

  it('designated heir (Suvarna): the heir succeeds, generation + 1, a new heir is sought', () => {
    const w = campaign(5);
    const f = w.factions.heartland!;
    const gen = w.dynasties.dyn_suvarna!.generation;
    const out: SimEvent[] = [];
    handleDeath(w, 'char_regent', out);
    expect(f.rulerId).toBe('char_heir');
    expect(w.characters.char_heir!.roles).toContain('ruler');
    expect(w.dynasties.dyn_suvarna!.generation).toBe(gen + 1);
    expect(w.dynasties.dyn_suvarna!.headId).toBe('char_heir');
    expect(out.some((e) => e.kind === 'succession' && e.newRulerId === 'char_heir')).toBe(true);
  });

  it('council election (Giridurga): the best martial + diplomacy + prestige / 10 of the house or the generals', () => {
    const w = campaign(5);
    const expected = lawfulSuccessor(w, 'highland', 'char_giri_raja')!;
    const cands = Object.values(w.characters).filter((c) => c.alive && c.factionId === 'highland' && c.id !== 'char_giri_raja' && (c.dynastyId === 'dyn_giri' || c.roles.includes('general')));
    const best = cands.sort((a, b) => b.skills.martial + b.skills.diplomacy + b.prestige / 10 - (a.skills.martial + a.skills.diplomacy + a.prestige / 10))[0]!;
    expect(expected.id).toBe(best.id);
    handleDeath(w, 'char_giri_raja', []);
    expect(w.factions.highland!.rulerId).toBe(best.id);
  });

  it('a child heir rules through a regency (legitimacy -0.1); no heir -> a loyal general is adopted (-0.2)', () => {
    const w = campaign(5);
    const f = w.factions.heartland!;
    w.characters.char_heir!.birthYear = w.calendar.year - 10;
    const leg = f.legitimacy;
    w.factions.heartland!.legitimacy = 1; // no crisis
    handleDeath(w, 'char_regent', []);
    expect(f.rulerId).toBe('char_heir');
    expect(f.legitimacy).toBeCloseTo(0.9, 10);
    expect(f.flags.regency_until_year).toBe(w.characters.char_heir!.birthYear + 16);
    void leg;
    // Forest: kill the queen with no family -> adoption or a new house.
    const w2 = campaign(5);
    const g = w2.factions.forest!;
    g.legitimacy = 1;
    handleDeath(w2, g.rulerId!, []);
    expect(g.rulerId).not.toBeNull();
    expect(w2.characters[g.rulerId!]!.alive).toBe(true);
    expect(g.legitimacy).toBeCloseTo(0.8, 10);
  });

  it('a succession crisis: the claimant raises his province in revolt and leads the rebels', () => {
    let crises = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const w = quiet(campaign(seed));
      const f = w.factions.heartland!;
      f.legitimacy = 0; // chance 0.35 x 1 x 2 = 0.7
      const out: SimEvent[] = [];
      handleDeath(w, 'char_regent', out);
      const ev = out.find((e) => e.kind === 'succession') as Extract<SimEvent, { kind: 'succession' }>;
      if (!ev.crisis) continue;
      crises++;
      const rebels = Object.values(w.armies).filter((a) => a.factionId === 'rebels' && a.rebelSettlementId === 'ratnapura');
      expect(rebels.length).toBe(1);
      expect(rebels[0]!.commanderId).toBe('char_claimant');
      expect(w.settlements.ratnapura!.rebellionStage).toBe('revolt');
    }
    expect(crises).toBeGreaterThanOrEqual(4);
    expect(crises).toBeLessThanOrEqual(12);
  });

  it('births: married couples (wife 18-40) have about a 10% chance a year', () => {
    let born = 0;
    let child = null as null | { dynastyId: string | null; factionId: string };
    for (let seed = 1; seed <= 10; seed++) {
      const w = quiet(campaign(seed));
      w.characters.char_heir!.spouseId = 'char_giri_kumari';
      w.characters.char_giri_kumari!.spouseId = 'char_heir';
      for (let y = 0; y < 20; y++) {
        const out: SimEvent[] = [];
        updateCharactersYearly(w, out);
        born += out.filter((e) => e.kind === 'character_born').length;
        w.calendar.year += 1;
      }
      child ??= Object.values(w.characters).find((c) => c.parentIds.includes('char_heir')) ?? null;
    }
    // 10 couples x 20 fertile years x 10% = 20 expected.
    expect(born).toBeGreaterThanOrEqual(8);
    expect(born).toBeLessThanOrEqual(40);
    expect(child!.dynastyId).toBe('dyn_suvarna');
    expect(child!.factionId).toBe('heartland');
  });

  it('every sandbox realm starts with a court: a ruler at court, a spouse, an adult heir of the house and a general leading the host (review B4)', () => {
    for (const seed of [1, 2, 3]) {
      for (const player of ['heartland', 'highland', 'forest', 'frontier']) {
        const w = sandbox(seed, { playerFactionId: player, rivalFactionIds: ['heartland', 'highland', 'forest', 'frontier'].filter((x) => x !== player) });
        for (const f of Object.values(w.factions)) {
          const ruler = w.characters[f.rulerId!]!;
          const court = Object.values(w.characters).filter((c) => c.factionId === f.id);
          expect(court.length, f.id).toBeGreaterThanOrEqual(3);
          // The ruling house: the dynasty exists, ruler and heir belong to it.
          const dyn = w.dynasties[f.dynastyId!]!;
          expect(dyn, f.id).toBeDefined();
          expect(dyn.headId).toBe(ruler.id);
          expect(ruler.dynastyId).toBe(dyn.id);
          // An adult heir of the house, 16-30, the ruler's child.
          const heir = w.characters[f.heirId!]!;
          expect(heir, f.id).toBeDefined();
          expect(heir.roles).toContain('heir');
          expect(heir.dynastyId).toBe(dyn.id);
          expect(heir.parentIds).toContain(ruler.id);
          const age = w.calendar.year - heir.birthYear;
          expect(age).toBeGreaterThanOrEqual(RULES.dynasty.adultAge);
          expect(age).toBeLessThanOrEqual(30);
          expect(lawfulSuccessor(w, f.id, ruler.id), f.id).not.toBeNull();
          // The ruler does not command; a general leads the starting host and sits on the council.
          const hosts = Object.values(w.armies).filter((a) => a.factionId === f.id);
          expect(hosts.length).toBe(1);
          expect(ruler.armyId).toBeNull();
          const general = w.characters[hosts[0]!.commanderId!]!;
          expect(general.roles).toContain('general');
          expect(general.id).not.toBe(ruler.id);
          expect(general.armyId).toBe(hosts[0]!.id);
          expect(f.council.commander).toBe(general.id);
          // A spouse; names never repeat at one court.
          expect(w.characters[ruler.spouseId!]!.spouseId).toBe(ruler.id);
          expect(new Set(court.map((c) => c.name)).size).toBe(court.length);
        }
      }
    }
  });

  it('a sandbox realm survives the death of its general and of its ruler (the heir succeeds; no line_ended)', () => {
    const w = sandbox(1, { playerFactionId: 'highland', rivalFactionIds: ['heartland', 'forest', 'frontier'] });
    const f = w.factions.highland!;
    const host = Object.values(w.armies).find((a) => a.factionId === 'highland')!;
    const out: SimEvent[] = [];
    handleDeath(w, host.commanderId!, out);
    expect(f.alive).toBe(true);
    expect(w.victory.status).toBe('ongoing');
    const heirId = f.heirId!;
    const expected = lawfulSuccessor(w, 'highland', f.rulerId);
    f.legitimacy = 1; // no crisis
    handleDeath(w, f.rulerId!, out);
    expect(w.victory.status).toBe('ongoing');
    expect(f.rulerId).toBe(expected!.id);
    expect(w.characters[f.rulerId!]!.alive).toBe(true);
    expect(out.some((e) => e.kind === 'succession')).toBe(true);
    void heirId;
    // The default sandbox runs a year without any realm's line ending.
    const w2 = sandbox(1);
    runDays(w2, 360);
    expect(w2.victory.outcomeId).not.toBe('line_ended');
  }, 120_000);

  it('designate_heir validates the person', () => {
    const w = campaign(5);
    expect(designateHeir(w, 'heartland', 'char_regent')).toBe(DYNASTY_REASONS.ruler);
    expect(designateHeir(w, 'heartland', 'char_giri_raja')).toBe(DYNASTY_REASONS.notYours);
    expect(designateHeir(w, 'heartland', 'char_heir')).toBe(DYNASTY_REASONS.already);
    expect(designateHeir(w, 'heartland', 'char_claimant')).toBeNull();
    expect(w.factions.heartland!.heirId).toBe('char_claimant');
    expect(w.characters.char_heir!.roles).not.toContain('heir');
  });
});

describe('council (DESIGN_SPEC §7.12)', () => {
  it('appoint_council validates; each seat recommends at most one action', () => {
    const w = campaign(5);
    expect(appointCouncil(w, 'heartland', 'treasurer', 'char_regent')).toBe(COUNCIL_REASONS.ruler);
    expect(appointCouncil(w, 'heartland', 'treasurer', 'char_giri_raja')).toBe(COUNCIL_REASONS.notYours);
    w.settlements.kusumpur!.unrest = 0.5;
    w.settlements.kusumpur!.rebellionStage = 'tax_refusal';
    w.factions.heartland!.foodReserve = 1e6;
    const advice = computeCouncilAdvice(w, 'heartland');
    const seats = advice.map((a) => a.seat);
    expect(new Set(seats).size).toBe(seats.length);
    const cm = advice.find((a) => a.seat === 'chief_minister')!;
    expect(cm.suggestion).toEqual({ kind: 'negotiate_rebels', settlementId: 'kusumpur', offer: 'relief' });
  });

  it('following advice +5; ignoring it -3; three ignored in a row -> -10 more and rivals learn about us', () => {
    const w = campaign(5);
    const f = w.factions.heartland!;
    w.settlements.kusumpur!.unrest = 0.5;
    w.settlements.kusumpur!.rebellionStage = 'tax_refusal';
    f.foodReserve = 1e6;
    updateCouncilMonthly(w, []);
    const cm = w.characters[f.council.chief_minister!]!;
    const op = cm.opinionOfRuler;
    const advice = f.councilAdvice.find((a) => a.seat === 'chief_minister')!;
    noteCommandForCouncil(w, cmd(w, advice.suggestion!));
    expect(cm.opinionOfRuler).toBe(Math.min(100, op + 5));
    expect(f.councilAdvice.some((a) => a.seat === 'chief_minister')).toBe(false);
    const tr = w.characters[f.council.treasurer!]!;
    const top = tr.opinionOfRuler;
    const intel = w.espionage.intel.highland?.heartland?.level ?? 0;
    ignoreAdvisor(w, 'heartland', 'treasurer', []);
    ignoreAdvisor(w, 'heartland', 'treasurer', []);
    expect(tr.opinionOfRuler).toBe(top - 6);
    ignoreAdvisor(w, 'heartland', 'treasurer', []);
    expect(tr.opinionOfRuler).toBe(top - 9 - 10);
    expect(f.advisorIgnored.treasurer).toBe(0);
    expect(w.espionage.intel.highland!.heartland!.level).toBeCloseTo(Math.min(1, intel + 0.1), 10);
  });

  it('an event choice follows its seat and ignores the competing seats', () => {
    const w = campaign(5);
    const f = w.factions.heartland!;
    const inst = w.events.pending.find((p) => p.scope.factionId === 'heartland');
    // Use the court succession event if pending, else fire one via the scheduler.
    const runChoice = (): void => {
      const pending = w.events.pending.find((p) => p.defId === 'evt_court_succession')!;
      issue(w, { kind: 'event_choice', eventInstanceId: pending.id, choiceId: 'name_heir' });
    };
    void inst;
    w.events.scheduled.push({ eventId: 'evt_court_succession', day: Math.floor(w.calendar.totalHours / 24), scope: { factionId: 'heartland', settlementId: 'rajapura', provinceId: null, characterId: null, armyId: null } });
    for (let h = 0; h < 30 && !w.events.pending.some((p) => p.defId === 'evt_court_succession'); h++) issue(w, { kind: 'set_tax_policy', policy: 'standard' });
    expect(w.events.pending.some((p) => p.defId === 'evt_court_succession')).toBe(true);
    const cmOp = w.characters[f.council.chief_minister!]!.opinionOfRuler;
    const scOp = w.characters[f.council.court_scholar!]!.opinionOfRuler;
    runChoice();
    expect(w.characters[f.council.chief_minister!]!.opinionOfRuler).toBe(Math.min(100, cmOp + 5));
    expect(w.characters[f.council.court_scholar!]!.opinionOfRuler).toBe(scOp - 3);
  });
});
