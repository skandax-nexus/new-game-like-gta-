/**
 * SIM-01 phase D: politics (DESIGN_SPEC §7.9, §7.13 GDD §6 chain). OWNER: Simulation Engineer - Strategic World
 * Simulation.
 *
 * The rebellion ladder with hysteresis, loyalty / unrest terms, the careless GDD §6 chain reaching revolt with a
 * rebel host of pop x 0.03 (2:1 spearmen : archers), secession after 30 days, rebels beaten or appeased, a careful
 * year staying calm, negotiate_rebels, governors (interests, demands, secession attempts, slots) and the monthly
 * stability / legitimacy drift.
 */
import { describe, expect, it } from 'vitest';
import type { SimEvent, WorldState } from '../../../src/core/types';
import { REBEL_FACTION_ID } from '../../../src/core/types';
import { RULES } from '../../../src/data/rules';
import { dailyConsumption } from '../../../src/sim/strategic/economy';
import { getRegionHeightfield, tickWorld } from '../../../src/sim/strategic/world';
import { makeArmy } from '../../../src/sim/strategic/armies';
import {
  appointGovernor,
  forceRebellionStage,
  governorTerm,
  interestSatisfied,
  loyaltyTerms,
  negotiateRebels,
  nextStage,
  POLITICS_REASONS,
  rebelArmiesOf,
  reliefCost,
  stabilityTarget,
  stageForUnrest,
  unrestTerms,
  updatePoliticsDaily,
  updatePoliticsMonthly,
} from '../../../src/sim/strategic/politics';
import { applyEffect } from '../../../src/sim/strategic/events';
import { campaign, cmd, issue, quiet, runDays, sandbox } from './helpers';

/** A careless ruler's answer to each event of the chain. */
const CARELESS: Record<string, string> = { evt_protest: 'ignore', evt_tax_refusal: 'force', evt_riots: 'let_burn', evt_governor_demands: 'coerce', evt_prices_rise: 'ignore', evt_revolt: 'crush' };

function peace(w: WorldState): WorldState {
  for (const r of Object.values(w.diplomacy.relations)) r.atWar = false;
  return w;
}

/** Run days answering the player's events carelessly. */
function runCareless(w: WorldState, days: number, onHour?: (ev: readonly SimEvent[]) => void, until?: () => boolean): void {
  const hf = getRegionHeightfield(w);
  runDays(w, days, {
    autoEvents: false,
    until,
    onHour: (ev) => {
      onHour?.(ev);
      for (const inst of w.events.pending.slice()) {
        const choice = inst.scope.factionId === w.playerFactionId ? CARELESS[inst.defId] : undefined;
        if (choice) tickWorld(w, [cmd(w, { kind: 'event_choice', eventInstanceId: inst.id, choiceId: choice })], [], hf);
      }
    },
  });
}

describe('rebellion ladder (DESIGN_SPEC §7.9)', () => {
  it('stages follow the unrest thresholds 0.15 / 0.30 / 0.45 / 0.60 / 0.75 / 0.90', () => {
    expect(stageForUnrest(0)).toBe('calm');
    expect(stageForUnrest(0.15)).toBe('grumbling');
    expect(stageForUnrest(0.3)).toBe('protest');
    expect(stageForUnrest(0.45)).toBe('tax_refusal');
    expect(stageForUnrest(0.6)).toBe('unrest');
    expect(stageForUnrest(0.75)).toBe('revolt');
    expect(stageForUnrest(0.95)).toBe('secession');
  });

  it('goes up at once but down only below threshold - 0.05 (hysteresis), one stage at a time', () => {
    expect(nextStage('calm', 0.62)).toBe('unrest');
    expect(nextStage('protest', 0.27)).toBe('protest');
    expect(nextStage('protest', 0.249)).toBe('grumbling');
    expect(nextStage('revolt', 0.5)).toBe('tax_refusal');
    expect(nextStage('revolt', 0.72)).toBe('revolt');
  });

  it('stage effects multiply tax / trade / recruits / production as in the spec table', () => {
    const e = RULES.politics.stageEffects;
    expect([e.protest.tax, e.protest.trade, e.protest.recruitment]).toEqual([0.85, 0.9, 0.8]);
    expect([e.tax_refusal.tax, e.unrest.production, e.revolt.production]).toEqual([0, 0.85, 0.7]);
    expect([e.unrest.conditionLossPerDay, e.revolt.conditionLossPerDay]).toEqual([0.005, 0.01]);
  });
});

describe('loyalty and unrest terms (DESIGN_SPEC §7.9)', () => {
  it('loyalty target: tax above 15%, price, requisition, unrest and occupation terms', () => {
    const w = campaign(5);
    const s = w.settlements.dhanyagram!;
    s.taxRate = 0.25;
    s.grainPrice = 1.5;
    s.unrest = 0.2;
    s.requisitionedFood = s.population * 0.1 * 30 * 2; // capped term
    s.occupiedSinceDay = 0;
    const t = Object.fromEntries(loyaltyTerms(w, s).map((x) => [x.id, x.value]));
    expect(t.base).toBe(0.5);
    expect(t.tax).toBeCloseTo(-0.1, 10);
    expect(t.price).toBeCloseTo(-0.075, 10);
    expect(t.requisition).toBeCloseTo(-0.15, 10);
    expect(t.unrest).toBeCloseTo(-0.06, 10);
    expect(t.occupation).toBeCloseTo(-0.2, 10);
    expect(t.legitimacy).toBeCloseTo(0.3 * (w.factions.heartland!.legitimacy - 0.5), 10);
  });

  it('unrest: starving +0.02 and price +0.001 per 0.1 above 1.3; sandbox rebelliousness scales the gains only', () => {
    const w = campaign(5);
    const s = w.settlements.dhanyagram!;
    s.starvationDays = 2;
    s.grainPrice = 2.3;
    s.loyalty = 0.5;
    const t = Object.fromEntries(unrestTerms(w, s).map((x) => [x.id, x.value]));
    expect(t.starving).toBeCloseTo(0.02, 10);
    expect(t.price).toBeCloseTo(0.01, 10);
    expect(t.order).toBeCloseTo(-0.004 * s.publicOrder, 10);
    const sb = sandbox(5, { rebelliousness: 1 });
    const s2 = Object.values(sb.settlements).find((x) => x.ownerFactionId)!;
    s2.starvationDays = 1;
    const t2 = Object.fromEntries(unrestTerms(sb, s2).map((x) => [x.id, x.value]));
    expect(t2.starving).toBeCloseTo(0.04, 10);
    expect(t2.order).toBeCloseTo(-0.004 * s2.publicOrder, 10);
  });

  it('public order drifts toward 0.5 + order effects + garrison bonus - 0.2 x unrest', () => {
    const w = quiet(campaign(5));
    const s = w.settlements.kusumpur!;
    s.unrest = 0.5;
    s.publicOrder = 0.9;
    for (let i = 0; i < 200; i++) {
      s.unrest = 0.5;
      updatePoliticsDaily(w, []);
    }
    expect(s.publicOrder).toBeLessThan(0.45);
    expect(s.publicOrder).toBeGreaterThan(0.3);
  });
});

describe('the GDD §6 chain (DESIGN_SPEC §7.13)', () => {
  it('a careless ruler: requisition, heavy taxes, no relief -> protest ... revolt and a rebel host of pop x 0.03', () => {
    const w = peace(quiet(campaign(5)));
    const s = w.settlements.dhanyagram!;
    issue(w, { kind: 'set_tax_rate', settlementId: 'dhanyagram', rate: 0.3 });
    issue(w, { kind: 'set_tax_policy', policy: 'heavy' });
    issue(w, { kind: 'set_policy', policy: 'hold_reserve', on: true });
    const stages: string[] = [];
    let spawned: Extract<SimEvent, { kind: 'rebels_spawned' }> | null = null;
    let popBefore = 0;
    for (let d = 0; d < 200 && !spawned; d++) {
      if (d % 15 === 0) issue(w, { kind: 'requisition_grain', settlementId: 'dhanyagram', amount: Math.floor(s.foodStored * 0.6), toArmyId: null, toDepotId: null });
      popBefore = s.population;
      runCareless(w, 1, (ev) => {
        for (const e of ev) {
          if (e.kind === 'rebellion_stage' && e.settlementId === 'dhanyagram') stages.push(e.stage);
          if (e.kind === 'rebels_spawned' && e.settlementId === 'dhanyagram') spawned = e;
        }
      });
    }
    expect(spawned).not.toBeNull();
    const ev = spawned as unknown as Extract<SimEvent, { kind: 'rebels_spawned' }>;
    // Every rung was climbed on the way.
    for (const st of ['grumbling', 'protest', 'tax_refusal', 'unrest', 'revolt']) expect(stages).toContain(st);
    expect(stages.indexOf('revolt')).toBeGreaterThan(stages.indexOf('protest'));
    expect(ev.soldiers).toBe(Math.round(popBefore * 0.03));
    const rebels = w.armies[ev.armyId]!;
    expect(rebels.factionId).toBe(REBEL_FACTION_ID);
    expect(rebels.rebelSettlementId).toBe('dhanyagram');
    expect(rebels.status).toBe('besieging');
    const spears = rebels.units.filter((u) => u.unitClass === 'spearmen').reduce((n, u) => n + u.soldiers, 0);
    const archers = rebels.units.filter((u) => u.unitClass === 'archers').reduce((n, u) => n + u.soldiers, 0);
    expect(spears + archers).toBe(ev.soldiers);
    expect(spears).toBe(Math.round((ev.soldiers * 2) / 3));
    expect(s.revoltSinceDay).not.toBeNull();
    expect(s.loyalty).toBeLessThan(0.2);
    // Left alone for 30 days, the village secedes; it is its province's capital, so Kusumpur is unsettled too.
    const kusUnrest = w.settlements.kusumpur!.unrest;
    let seceded = false;
    runCareless(w, 40, (e2) => {
      if (e2.some((e) => e.kind === 'secession' && e.settlementId === 'dhanyagram')) seceded = true;
    }, () => seceded);
    expect(seceded).toBe(true);
    expect(s.ownerFactionId).toBeNull();
    expect(rebelArmiesOf(w, 'dhanyagram')).toEqual([]);
    expect(s.garrison.length).toBeGreaterThan(0); // the rebels hold the town
    expect(w.provinces.prov_dhanyakshetra!.capitalSettlementId).toBe('dhanyagram');
    expect(w.settlements.kusumpur!.unrest).toBeGreaterThan(kusUnrest + 0.1);
  });

  it('a careful year (normal monsoon, standard tax, peace) keeps every settlement of the realm calm for 12 months', () => {
    const w = peace(quiet(campaign(5)));
    w.monsoon.strength = 1;
    const max: Record<string, number> = {};
    runDays(w, 360, {
      onHour: () => {
        for (const s of Object.values(w.settlements)) if (s.ownerFactionId === 'heartland') max[s.id] = Math.max(max[s.id] ?? 0, s.unrest);
      },
    });
    expect(Object.keys(max).sort()).toEqual(['dhanyagram', 'kusumpur', 'rajapura', 'ratnapura', 'setupur']);
    for (const [id, u] of Object.entries(max)) expect(u, id).toBeLessThan(0.15);
    for (const s of Object.values(w.settlements)) if (s.ownerFactionId === 'heartland') expect(s.rebellionStage, s.id).toBe('calm');
  });
});

describe('rebels (DESIGN_SPEC §7.9)', () => {
  function revolting(): { w: WorldState; armyId: string } {
    const w = peace(quiet(campaign(5)));
    const s = w.settlements.ratnapura!;
    const out: SimEvent[] = [];
    forceRebellionStage(w, s, 'revolt', out);
    const ev = out.find((e) => e.kind === 'rebels_spawned') as Extract<SimEvent, { kind: 'rebels_spawned' }>;
    return { w, armyId: ev.armyId };
  }

  it('beating the rebels in battle ends the revolt (unrest -0.2)', () => {
    const { w, armyId } = revolting();
    const s = w.settlements.ratnapura!;
    const reb = w.armies[armyId]!;
    expect(s.rebellionStage).toBe('revolt');
    const loyal = makeArmy(w, 'army_loyal', 'Loyal Host', 'heartland', reb.x + 40, reb.z, [{ unitClass: 'spearmen', formations: 6 }, { unitClass: 'archers', formations: 3 }], null);
    w.armies[loyal.id] = loyal;
    runDays(w, 2, { until: () => !w.armies[armyId] });
    expect(w.armies[armyId]).toBeUndefined();
    expect(s.revoltSinceDay).toBeNull();
    expect(s.unrest).toBeLessThan(0.5);
    expect(['tax_refusal', 'unrest', 'protest', 'grumbling', 'calm']).toContain(s.rebellionStage);
    expect(s.ownerFactionId).toBe('heartland');
  });

  it('appeasing the town below the revolt threshold disperses the rebel host back into the town', () => {
    const { w, armyId } = revolting();
    const s = w.settlements.ratnapura!;
    const pop = s.population;
    const n = w.armies[armyId]!.units.reduce((t, u) => t + u.soldiers, 0);
    w.factions.heartland!.foodReserve = 1e6;
    w.factions.heartland!.treasury = 1e6;
    expect(negotiateRebels(w, 'heartland', 'ratnapura', 'relief', [])).toBeNull();
    expect(s.unrest).toBeCloseTo(0.75 - 0.25, 6);
    expect(w.armies[armyId]).toBeUndefined();
    expect(s.population).toBeCloseTo(pop + n, 6);
    expect(s.revoltSinceDay).toBeNull();
  });

  it('set_rebellion_stage raises unrest to the stage so the ladder holds; secession secedes at once', () => {
    const w = peace(quiet(campaign(5)));
    const s = w.settlements.kusumpur!;
    const out: SimEvent[] = [];
    applyEffect(w, { kind: 'set_rebellion_stage', target: { kind: 'settlement', id: 'kusumpur' }, stage: 'tax_refusal' }, { factionId: 'heartland', settlementId: null, provinceId: null, characterId: null, armyId: null }, out);
    expect(s.rebellionStage).toBe('tax_refusal');
    expect(s.unrest).toBeGreaterThanOrEqual(0.45);
    updatePoliticsDaily(w, out);
    expect(s.rebellionStage).toBe('tax_refusal');
    applyEffect(w, { kind: 'set_rebellion_stage', target: { kind: 'settlement', id: 'kusumpur' }, stage: 'secession' }, { factionId: 'heartland', settlementId: null, provinceId: null, characterId: null, armyId: null }, out);
    expect(s.ownerFactionId).toBeNull();
    expect(out.some((e) => e.kind === 'secession' && e.settlementId === 'kusumpur')).toBe(true);
  });
});

describe('negotiate_rebels (DESIGN_SPEC §7.9)', () => {
  function protesting(): WorldState {
    const w = peace(quiet(campaign(5)));
    const s = w.settlements.ratnapura!;
    s.unrest = 0.4;
    s.rebellionStage = 'protest';
    s.loyalty = 0.5;
    return w;
  }

  it('refuses when calm or not yours', () => {
    const w = protesting();
    expect(negotiateRebels(w, 'heartland', 'rajapura', 'relief', [])).toBe(POLITICS_REASONS.calm);
    expect(negotiateRebels(w, 'highland', 'ratnapura', 'relief', [])).toBe(POLITICS_REASONS.notOwned);
    const out = issue(w, { kind: 'negotiate_rebels', settlementId: 'rajapura', offer: 'tax_cut' });
    expect(out.some((e) => e.kind === 'notification' && e.text === POLITICS_REASONS.calm)).toBe(true);
  });

  it('relief: 30 days of grain from the reserve + 2 wealth per 100 people; unrest -0.25, loyalty +0.1', () => {
    const w = protesting();
    const s = w.settlements.ratnapura!;
    const f = w.factions.heartland!;
    const c = reliefCost(w, s);
    expect(c.food).toBeCloseTo(dailyConsumption(w, s) * 30, 6);
    expect(c.wealth).toBeCloseTo((s.population / 100) * 2, 6);
    f.foodReserve = c.food - 1;
    expect(negotiateRebels(w, 'heartland', 'ratnapura', 'relief', [])).toBe(POLITICS_REASONS.noReserve(c.food));
    f.foodReserve = c.food + 100;
    const store = s.foodStored;
    const treasury = f.treasury;
    expect(negotiateRebels(w, 'heartland', 'ratnapura', 'relief', [])).toBeNull();
    expect(f.foodReserve).toBeCloseTo(100, 6);
    expect(f.treasury).toBeCloseTo(treasury - c.wealth, 6);
    expect(s.foodStored).toBeCloseTo(store + c.food, 6);
    expect(s.unrest).toBeCloseTo(0.15, 10);
    expect(s.loyalty).toBeCloseTo(0.6, 10);
  });

  it('tax cut: -5 points for 180 days (restored after), unrest -0.15, loyalty +0.05', () => {
    const w = protesting();
    const s = w.settlements.ratnapura!;
    const rate = s.taxRate;
    expect(negotiateRebels(w, 'heartland', 'ratnapura', 'tax_cut', [])).toBeNull();
    expect(s.taxRate).toBeCloseTo(rate - 0.05, 10);
    expect(s.unrest).toBeCloseTo(0.25, 10);
    expect(negotiateRebels(w, 'heartland', 'ratnapura', 'tax_cut', [])).toBe(POLITICS_REASONS.taxCutRunning);
    w.calendar.totalHours += 24 * 180;
    updatePoliticsDaily(w, []);
    expect(s.taxRelief).toBeNull();
    expect(s.taxRate).toBeCloseTo(rate, 10);
  });

  it('autonomy: province autonomy +0.25, unrest -0.3, governor loyalty +0.2, legitimacy -0.02', () => {
    const w = protesting();
    const s = w.settlements.ratnapura!;
    const p = w.provinces[s.provinceId]!;
    const gov = w.characters[p.governorId!]!;
    const gl = gov.loyalty;
    const leg = w.factions.heartland!.legitimacy;
    expect(negotiateRebels(w, 'heartland', 'ratnapura', 'autonomy', [])).toBeNull();
    expect(p.autonomy).toBeCloseTo(0.25, 10);
    expect(s.unrest).toBeCloseTo(0.1, 10);
    expect(gov.loyalty).toBeCloseTo(Math.min(1, gl + 0.2), 10);
    expect(w.factions.heartland!.legitimacy).toBeCloseTo(leg - 0.02, 10);
  });

  it('coercion needs a garrison of 2% of the people or an army at hand; unrest -0.35, loyalty -0.15', () => {
    const w = protesting();
    const s = w.settlements.ratnapura!;
    expect(negotiateRebels(w, 'heartland', 'ratnapura', 'coercion', [])).toBe(POLITICS_REASONS.noForce(s.population * 0.02));
    w.armies.army_g = makeArmy(w, 'army_g', 'Guard', 'heartland', s.x + 50, s.z, [{ unitClass: 'spearmen', formations: 2 }], null);
    expect(negotiateRebels(w, 'heartland', 'ratnapura', 'coercion', [])).toBeNull();
    expect(s.unrest).toBeCloseTo(0.05, 10);
    expect(s.loyalty).toBeCloseTo(0.35, 10);
  });

  it('coercion of a disloyal town (loyalty < 0.3) backfires 30% of the time: one stage up instead', () => {
    let backfired = 0;
    let worked = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const w = peace(quiet(campaign(seed)));
      const s = w.settlements.ratnapura!;
      s.unrest = 0.4;
      s.rebellionStage = 'protest';
      s.loyalty = 0.2;
      w.armies.army_g = makeArmy(w, 'army_g', 'Guard', 'heartland', s.x + 50, s.z, [{ unitClass: 'spearmen', formations: 2 }], null);
      negotiateRebels(w, 'heartland', 'ratnapura', 'coercion', []);
      if ((s.rebellionStage as string) === 'tax_refusal') backfired++;
      else if (s.unrest < 0.1) worked++;
    }
    expect(backfired + worked).toBe(40);
    expect(backfired).toBeGreaterThanOrEqual(5);
    expect(backfired).toBeLessThanOrEqual(20);
  });
});

describe('governors (DESIGN_SPEC §7.9)', () => {
  it('appoint_governor validates the province and the character', () => {
    const w = campaign(5);
    expect(appointGovernor(w, 'heartland', 'prov_dakshinagiri', 'char_senapati', [])).toBe(POLITICS_REASONS.provinceNotOwned);
    expect(appointGovernor(w, 'heartland', 'prov_tira', 'char_giri_raja', [])).toBe(POLITICS_REASONS.notYourCharacter);
    expect(appointGovernor(w, 'heartland', 'prov_tira', 'char_regent', [])).toBe(POLITICS_REASONS.ruler);
    w.characters.char_senapati!.alive = false;
    expect(appointGovernor(w, 'heartland', 'prov_tira', 'char_senapati', [])).toBe(POLITICS_REASONS.dead);
    w.characters.char_senapati!.alive = true;
    expect(appointGovernor(w, 'heartland', 'prov_tira', 'char_senapati', [])).toBeNull();
    expect(w.provinces.prov_tira!.governorId).toBe('char_senapati');
    expect(w.characters.char_senapati!.governsProvinceId).toBe('prov_tira');
    // Moving him vacates Tira.
    expect(appointGovernor(w, 'heartland', 'prov_rajakshetra', 'char_senapati', [])).toBeNull();
    expect(w.provinces.prov_tira!.governorId).toBeNull();
    expect(appointGovernor(w, 'heartland', 'prov_rajakshetra', null, [])).toBeNull();
    expect(w.characters.char_senapati!.governsProvinceId).toBeNull();
  });

  it('interests: wealth (tax <= 15%), land (2+ settlements), power (autonomy >= 0.25 or a council seat)', () => {
    const w = campaign(5);
    const p = w.provinces.prov_dhanyakshetra!;
    const g = w.characters[p.governorId!]!;
    g.interest = 'wealth';
    expect(interestSatisfied(w, g, p)).toBe(true);
    w.settlements.dhanyagram!.taxRate = 0.3;
    expect(interestSatisfied(w, g, p)).toBe(false);
    g.interest = 'land';
    expect(interestSatisfied(w, g, p)).toBe(true); // Dhanyagram + Kusumpur
    g.interest = 'power';
    expect(interestSatisfied(w, g, p)).toBe(false);
    p.autonomy = 0.25;
    expect(interestSatisfied(w, g, p)).toBe(true);
    // The loyalty term: (loyalty - 0.5) x 0.2 + 0.05.
    g.loyalty = 0.8;
    expect(governorTerm(w, w.settlements.dhanyagram!)).toBeCloseTo(0.3 * 0.2 + 0.05, 10);
  });

  it('a disloyal ambitious governor issues demands; one below 0.15 tries to secede (+0.3 unrest)', () => {
    const w = campaign(5);
    const p = w.provinces.prov_dhanyakshetra!;
    const g = w.characters[p.governorId!]!;
    g.loyalty = 0.2;
    g.ambition = 0.8;
    const out: SimEvent[] = [];
    updatePoliticsMonthly(w, out);
    expect(out.some((e) => e.kind === 'governor_demand' && e.characterId === g.id)).toBe(true);
    expect(w.events.scheduled.some((e) => e.eventId === 'evt_governor_demands' && e.scope.provinceId === p.id)).toBe(true);
    g.loyalty = 0.05;
    const before = p.settlementIds.map((id) => w.settlements[id]!.unrest);
    updatePoliticsMonthly(w, out);
    p.settlementIds.forEach((id, i) => expect(w.settlements[id]!.unrest).toBeCloseTo(Math.min(1, before[i]! + 0.3), 10));
  });

  it('each governor above the age slots (Janapada 2) costs 0.02 legitimacy a month', () => {
    const run = (extra: boolean): number => {
      const w = campaign(5);
      w.factions.heartland!.age = 'janapada';
      if (extra) expect(appointGovernor(w, 'heartland', 'prov_tira', 'char_senapati', [])).toBeNull();
      const leg = w.factions.heartland!.legitimacy;
      updatePoliticsMonthly(w, []);
      return w.factions.heartland!.legitimacy - leg;
    };
    expect(run(true) - run(false)).toBeCloseTo(-0.02, 10);
  });
});

describe('stability and legitimacy (DESIGN_SPEC §7.9)', () => {
  it('stability drifts 10% a month toward 0.5 + 0.3 (legitimacy - 0.5) + 0.2 avg loyalty - 0.3 troubled share ...', () => {
    const w = campaign(5);
    const f = w.factions.heartland!;
    f.stability = 0.2;
    const target = stabilityTarget(w, 'heartland');
    updatePoliticsMonthly(w, []);
    expect(f.stability).toBeCloseTo(0.2 + (target - 0.2) * 0.1, 10);
    // Two settlements in protest lower the target by 0.3 x 2/5.
    w.settlements.kusumpur!.rebellionStage = 'protest';
    w.settlements.setupur!.rebellionStage = 'unrest';
    expect(stabilityTarget(w, 'heartland')).toBeCloseTo(target - 0.3 * (2 / 5), 10);
  });

  it('legitimacy: -0.02 a month with a living claimant and no heir; +0.01 when the succession is settled', () => {
    const w = campaign(5);
    const f = w.factions.heartland!;
    f.heirId = null;
    let leg = f.legitimacy;
    updatePoliticsMonthly(w, []);
    expect(f.legitimacy).toBeCloseTo(leg - 0.02, 10);
    f.heirId = 'char_heir';
    w.characters.char_claimant!.loyalty = 0.9; // reconciled
    leg = f.legitimacy;
    updatePoliticsMonthly(w, []);
    expect(f.legitimacy).toBeCloseTo(Math.min(1, leg + 0.01), 10);
  });
});
