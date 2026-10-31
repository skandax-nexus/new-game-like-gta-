/**
 * SIM-02 campaign AI acceptance: 3-year AI-only sandboxes (6 realms, 4 seeds), the war / peace rules, the age-up, The
 * Broken Crown default run, and targeted planner checks (economy, military prudence, recruitment ceiling, landmark
 * choice, schedule, passive switch, determinism). OWNER: AI Engineer - Battle AI, Intents & Campaign AI (SIM-02).
 */
import { describe, expect, it } from 'vitest';
import type { SimEvent, WorldState } from '../../../src/core/types';
import { decodeJson, encodeJson, hashState } from '../../../src/core/save';
import { AI_PERSONALITY_DEFS } from '../../../src/data/difficulty';
import { aiJournal, aiSchedule, resetAiJournal, runCampaignAI, setAiPassive, warRule } from '../../../src/sim/strategic/ai';
import { situate } from '../../../src/sim/strategic/ai/core';
import { daysToNextHarvest, grainOutlook, planGrain, planLabor, planTaxes, planTreasury } from '../../../src/sim/strategic/ai/economy';
import { preferredLandmark } from '../../../src/sim/strategic/ai/build';
import { planMilitary } from '../../../src/sim/strategic/ai/military';
import { planDemobilize, planRecruitment, pressed, recruitRoom, soldierCeiling } from '../../../src/sim/strategic/ai/recruit';
import { considerPeace, considerTreaties, peaceCase } from '../../../src/sim/strategic/ai/diplomacy';
import { armyStrength, makeArmy } from '../../../src/sim/strategic/armies';
import { createTreaty, validateProposal } from '../../../src/sim/strategic/diplomacy';
import { recruitCost } from '../../../src/sim/strategic/recruitment';
import { applyStrategicCommand, getRegionHeightfield } from '../../../src/sim/strategic/world';
import { relationKey } from '../../../src/core/ids';
import { campaign, runDays } from '../strategic/helpers';
import type { CampaignAudit } from './harness/campaign';
import { aiSandbox, runAudited } from './harness/campaign';
import { stallWatch } from './harness/stalls';

const YEARS3 = 1080;

function setWar(w: WorldState, a: string, b: string, atWar: boolean): void {
  const r = w.diplomacy.relations[relationKey(a, b)]!;
  r.atWar = atWar;
  r.warStartDay = atWar ? 0 : null;
}

function checkAudit(seed: number, a: CampaignAudit): void {
  // No treasury death spiral: never more than 60 consecutive days below zero.
  for (const [fid, streak] of Object.entries(a.worstDebtStreak)) expect(streak, `seed ${seed} ${fid} debt streak`).toBeLessThanOrEqual(60);
  // Wars only per the rule: every AI declaration held the rule the hour before (independent evaluation, 10% drift
  // margin for the day's own updates) with no truce / forbidding treaty; anything else is an ally call or an event.
  for (const war of a.wars) {
    const tag = `seed ${seed} day ${war.day} ${war.a} -> ${war.b}`;
    if (war.byAi) {
      expect(war.blockedBefore, tag).toBeNull();
      expect(war.ratio, tag).toBeGreaterThan(0.9 * war.threshold);
    } else expect(war.other, tag).not.toBe('unexplained');
  }
  // Peace is sued within 31 days of falling below peaceWarScore (spells that had 31 days to run).
  for (const p of a.peace) {
    if (p.belowSince > a.days - 31) continue;
    const tag = `seed ${seed} ${p.a} vs ${p.b} below since ${p.belowSince}`;
    expect(p.sued, tag).not.toBeNull();
    expect(p.sued! - p.belowSince, tag).toBeLessThanOrEqual(31);
  }
  // A realm whose next age is open starts its landmark within 150 days (saving for it included).
  for (const [fid, streak] of Object.entries(a.worstReadyStreak)) expect(streak, `seed ${seed} ${fid} ready streak`).toBeLessThanOrEqual(150);
}

describe('AI-only sandbox, 3 years, 6 realms (SIM-02 acceptance)', () => {
  const ageUps: CampaignAudit['ageUps'] = [];
  const kinds = new Set<string>();
  for (const seed of [1, 2, 3, 4]) {
    it(`seed ${seed}: no debt spiral, wars per the rule, peace sued, landmarks started`, () => {
      resetAiJournal(true);
      const w = aiSandbox(seed);
      const stalls = stallWatch();
      const audit = runAudited(w, YEARS3, (world) => stalls.day(world));
      expect(audit.days).toBe(YEARS3);
      checkAudit(seed, audit);
      // Stall audit (CD-B1 d): while at war no AI field army keeps the same operation for more than 45 days (a siege
      // camp runs as long as the walls hold and is not a stall).
      // No landed realm is eliminated before day 180 (CD review round 1).
      for (const e of audit.eliminated) if (e.landed) expect(e.day, `seed ${seed}: ${e.factionId} eliminated on day ${e.day}`).toBeGreaterThanOrEqual(180);
      const worst = stalls.worst()[0];
      if (worst) expect(worst.days, `seed ${seed}: ${stalls.report().join(', ')}`).toBeLessThanOrEqual(45);
      expect(audit.wars.some((x) => x.byAi), `seed ${seed}: the AI declared no war in 3 years`).toBe(true);
      for (const e of aiJournal()) kinds.add(e.kind);
      ageUps.push(...audit.ageUps);
    }, 300_000);
  }
  it('across the seeds: at least one realm aged up; every planner acted', () => {
    expect(ageUps.length).toBeGreaterThan(0);
    for (const k of ['war', 'peace', 'diplomacy', 'economy', 'build', 'recruit', 'army', 'spy', 'goal', 'age']) expect(kinds.has(k), k).toBe(true);
  });
});

describe('The Broken Crown default run (campaign AI active)', () => {
  it('ends mixed - never defeat - on 6/6 seeds; the AI realms stay solvent', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const w = campaign(seed);
      const debt: Record<string, number> = {};
      const worst: Record<string, number> = {};
      let hour = 0;
      runDays(w, 545, {
        onHour: () => {
          if (++hour % 24 !== 0) return;
          for (const f of Object.values(w.factions)) {
            if (f.isPlayer) continue;
            debt[f.id] = f.treasury < 0 ? (debt[f.id] ?? 0) + 1 : 0;
            worst[f.id] = Math.max(worst[f.id] ?? 0, debt[f.id]!);
          }
        },
      });
      expect(w.victory.status, `seed ${seed}: ${w.victory.outcomeId}`).toBe('ended');
      expect(['out_restored', 'out_iron']).toContain(w.victory.outcomeId);
      expect(w.settlements.rajapura!.ownerFactionId).toBe('heartland');
      for (const [fid, s] of Object.entries(worst)) expect(s, `seed ${seed} ${fid}`).toBeLessThanOrEqual(60);
    }
  }, 600_000);
});

describe('the war rule (DESIGN_SPEC §7.14)', () => {
  it('ratio = own / target strength x (1 - opinion / 200) against warRatio - aggression bonus', () => {
    const w = aiSandbox(7);
    const sit = situate(w, 'frontier');
    const r = warRule(sit, 'forest');
    const own = sit.strength.frontier!;
    const target = Math.max(1, sit.strength.forest!);
    const rel = w.diplomacy.relations[relationKey('frontier', 'forest')]!;
    expect(rel.grievances.length).toBe(0);
    expect(r.ratio).toBeCloseTo((own / target) * (1 - rel.opinion / 200), 9);
    expect(r.threshold).toBeCloseTo(AI_PERSONALITY_DEFS.raider!.warRatio, 9);
    expect(r.ok).toBe(r.ratio > r.threshold);
  });

  it('the sandbox slider and difficulty move the threshold', () => {
    const hard = aiSandbox(7, { difficulty: 'very_hard', aiAggression: 1 });
    const r = warRule(situate(hard, 'frontier'), 'forest');
    expect(r.threshold).toBeCloseTo(AI_PERSONALITY_DEFS.raider!.warRatio - 0.2 - 0.5, 9);
  });

  it('a truce or a non-aggression pact blocks the declaration whatever the odds', () => {
    const w = aiSandbox(7);
    for (const a of Object.values(w.armies)) if (a.factionId === 'forest') a.units = a.units.slice(0, 1);
    expect(warRule(situate(w, 'frontier'), 'forest').ok).toBe(true);
    w.diplomacy.relations[relationKey('frontier', 'forest')]!.truceUntilDay = 400;
    expect(warRule(situate(w, 'frontier'), 'forest').blocked).toBe('truce');
    w.diplomacy.relations[relationKey('frontier', 'forest')]!.truceUntilDay = null;
    createTreaty(w, 'non_aggression', 'frontier', 'forest');
    const r = warRule(situate(w, 'frontier'), 'forest');
    expect(r.ok).toBe(false);
    expect(r.blocked).toContain('non_aggression');
  });

  it('the opportunist adds +0.3 against a starving realm', () => {
    const w = aiSandbox(7);
    w.factions.forest!.ai.personality = 'opportunist';
    const before = warRule(situate(w, 'forest'), 'frontier');
    expect(before.opportunity).toBe(false);
    w.settlements.lavanapura!.starvationDays = 3;
    const after = warRule(situate(w, 'forest'), 'frontier');
    expect(after.opportunity).toBe(true);
    expect(after.ratio).toBeCloseTo(before.ratio + 0.3, 9);
  });
});

describe('planners', () => {
  it('a grain shortfall puts the hands in the fields and orders rationing', () => {
    const w = aiSandbox(3);
    runDays(w, 2, { autoEvents: false, autoEngagements: false });
    for (const s of Object.values(w.settlements)) if (s.ownerFactionId === 'highland') s.foodStored = 5 * s.foodConsumption;
    w.factions.highland!.foodReserve = 0;
    const sit = situate(w, 'highland');
    expect(grainOutlook(sit).marginDays).toBeLessThan(0);
    expect(daysToNextHarvest(sit)).toBeGreaterThan(0);
    planLabor(sit);
    planGrain(sit);
    const labor = sit.commands.filter((c) => c.cmd.kind === 'set_labor');
    expect(labor.length).toBeGreaterThan(0);
    for (const c of labor) if (c.cmd.kind === 'set_labor') expect(c.cmd.allocation.farming).toBeGreaterThanOrEqual(0.75);
    expect(sit.commands.some((c) => c.cmd.kind === 'set_policy' && c.cmd.policy === 'rationing' && c.cmd.on)).toBe(true);
  });

  it('in debt the realm taxes harder, sells surplus materials and spends nothing', () => {
    const w = aiSandbox(3);
    runDays(w, 2, { autoEvents: false, autoEngagements: false });
    const f = w.factions.heartland!;
    f.treasury = -400;
    f.materials.timber = 3000;
    const sit = situate(w, 'heartland');
    const crisis = planTreasury(sit);
    expect(crisis).toBe(true);
    planTaxes(sit);
    planRecruitment(sit, crisis);
    expect(sit.commands.some((c) => c.cmd.kind === 'set_tax_policy' && (c.cmd.policy === 'emergency' || c.cmd.policy === 'heavy'))).toBe(true);
    expect(sit.commands.some((c) => c.cmd.kind === 'market_trade' && !c.cmd.buy && c.cmd.resource === 'timber')).toBe(true);
    expect(sit.commands.some((c) => c.cmd.kind === 'recruit' || c.cmd.kind === 'build')).toBe(false);
  });

  it('a weaker army never marches on a stronger host; a stronger one relieves the town', () => {
    const run = (enemyFormations: number): string[] => {
      const w = aiSandbox(5);
      runDays(w, 1, { autoEvents: false, autoEngagements: false });
      const s = w.settlements.giridurg!;
      const e = makeArmy(w, 'army_enemy', 'Raiders', 'heartland', s.x + s.radius + 300, s.z, [{ unitClass: 'spearmen', formations: enemyFormations }], null);
      e.visibility.highland = 1;
      w.armies[e.id] = e;
      setWar(w, 'highland', 'heartland', true);
      const sit = situate(w, 'highland');
      planMilitary(sit, false);
      return sit.commands.filter((c) => c.cmd.kind === 'army_order' && c.cmd.order.kind === 'attack_army').map((c) => (c.cmd.kind === 'army_order' ? c.cmd.armyId : ''));
    };
    const w0 = aiSandbox(5);
    const host = Object.values(w0.armies).find((a) => a.factionId === 'highland')!;
    expect(armyStrength(host)).toBeGreaterThan(0);
    expect(run(2).length).toBe(1);
    expect(run(20).length).toBe(0);
  });

  it('recruitment stops at 0.04 x population (x1.3 expansionist, x0.7 mercantile)', () => {
    const w = aiSandbox(3);
    const sit = situate(w, 'heartland');
    expect(soldierCeiling(sit)).toBeCloseTo(0.04 * sit.realmPop * 1.3, 6);
    w.factions.heartland!.ai.personality = 'mercantile';
    expect(soldierCeiling(situate(w, 'heartland'))).toBeCloseTo(0.04 * sit.realmPop * 0.7, 6);
    // At the ceiling: nothing is raised however rich the realm - garrisons included (the ceiling counts every soldier).
    w.factions.heartland!.treasury = 1e6;
    const host = Object.values(w.armies).find((a) => a.factionId === 'heartland')!;
    while (situate(w, 'heartland').soldiers < soldierCeiling(situate(w, 'heartland'))) host.units.push({ ...host.units[0]!, id: `u_extra_${host.units.length}` });
    for (const s of Object.values(w.settlements)) if (s.ownerFactionId === 'heartland') s.garrison = [];
    setWar(w, 'heartland', 'highland', true);
    const over = situate(w, 'heartland');
    expect(over.soldiers).toBeGreaterThanOrEqual(soldierCeiling(over));
    expect(over.soldiers).toBeLessThan(1.4 * soldierCeiling(over));
    planRecruitment(over, false);
    expect(over.commands.filter((c) => c.cmd.kind === 'recruit').map((c) => JSON.stringify(c.cmd))).toEqual([]);
  });

  it('every soldier raised fits under the ceiling (garrison levies and field recruits alike)', () => {
    const w = aiSandbox(3);
    w.factions.heartland!.treasury = 1e6;
    setWar(w, 'heartland', 'highland', true);
    for (const s of Object.values(w.settlements)) if (s.ownerFactionId === 'heartland') s.garrison = [];
    const host = Object.values(w.armies).find((a) => a.factionId === 'heartland')!;
    // Just under the ceiling: room for at most one more formation.
    const sit0 = situate(w, 'heartland');
    while (situate(w, 'heartland').soldiers + 130 < soldierCeiling(sit0)) host.units.push({ ...host.units[0]!, id: `u_extra_${host.units.length}` });
    const sit = situate(w, 'heartland');
    planRecruitment(sit, false);
    let raised = 0;
    for (const c of sit.commands) if (c.cmd.kind === 'recruit') raised += recruitCost(w, 'heartland', c.cmd.unitClass, c.cmd.formations).recruits;
    expect(sit.soldiers + raised).toBeLessThanOrEqual(soldierCeiling(sit));
  });

  it('engineers and supply trains are raised one formation per job; a host carries 1 engineer formation, 2 for a fort level 2+ target (CD-B2)', () => {
    const w = aiSandbox(3);
    w.factions.heartland!.treasury = 1e6;
    setWar(w, 'heartland', 'highland', true);
    const host = Object.values(w.armies).find((a) => a.factionId === 'heartland' && !a.id.startsWith('garrison_'))!;
    host.units = host.units.filter((u) => u.unitClass !== 'engineers');
    const sit = situate(w, 'heartland');
    planRecruitment(sit, false);
    const eng = sit.commands.filter((c) => c.cmd.kind === 'recruit' && c.cmd.unitClass === 'engineers');
    expect(eng.length, JSON.stringify(sit.commands.map((c) => c.cmd))).toBe(1);
    expect(eng[0]!.cmd.kind === 'recruit' && eng[0]!.cmd.formations).toBe(1);
    for (const c of sit.commands) if (c.cmd.kind === 'recruit' && (c.cmd.unitClass === 'engineers' || c.cmd.unitClass === 'supply_train')) expect(c.cmd.formations).toBe(1);
    // With one engineer formation in the host: none more - unless the planned siege is of a fort level 2+ town.
    host.units.push({ ...host.units[0]!, id: 'u_eng_1', unitClass: 'engineers', soldiers: 40 });
    const again = situate(w, 'heartland');
    planRecruitment(again, false);
    expect(again.commands.some((c) => c.cmd.kind === 'recruit' && c.cmd.unitClass === 'engineers')).toBe(false);
    w.settlements.giridurg!.fortLevel = 3;
    w.factions.heartland!.ai.memory[`op_${host.id}`] = 'siege:giridurg';
    const walls = situate(w, 'heartland');
    planRecruitment(walls, false);
    const second = walls.commands.filter((c) => c.cmd.kind === 'recruit' && c.cmd.unitClass === 'engineers');
    expect(second.length).toBe(1);
    expect(second[0]!.cmd.kind === 'recruit' && second[0]!.cmd.formations).toBe(1);
  });

  it('at war the landmark saving and the 3-month floor do not starve recruitment (treasury less one month of upkeep)', () => {
    const w = aiSandbox(3);
    const f = w.factions.heartland!;
    f.ai.memory.upkeep = 1000;
    f.ai.memory.saveWealth = 4000;
    f.ai.memory.net = 1000;
    f.treasury = 4500;
    const peaceSit = situate(w, 'heartland');
    // In peace and unthreatened: 4,500 - 3 x 1,000 - 4,000 < 0: nothing to spend.
    peaceSit.enemies = [];
    peaceSit.threats = [];
    expect(pressed(peaceSit)).toBe(false);
    expect(recruitRoom(peaceSit)).toBe(4500 - 3000 - 4000);
    setWar(w, 'heartland', 'highland', true);
    const warSit = situate(w, 'heartland');
    expect(recruitRoom(warSit)).toBe(3500);
    planRecruitment(warSit, false);
    expect(warSit.commands.some((c) => c.cmd.kind === 'recruit'), JSON.stringify(warSit.commands.map((c) => c.cmd))).toBe(true);
  });

  it('a resupplying host is done at 60% of its train; with no grain gained in 3 days it goes to a town with grain to spare (CD-B1 a)', () => {
    const w = aiSandbox(3);
    runDays(w, 2, { autoEvents: false, autoEngagements: false });
    const host = Object.values(w.armies).find((a) => a.factionId === 'heartland' && !a.id.startsWith('garrison_'))!;
    const f = w.factions.heartland!;
    host.order = { kind: 'resupply', sourceId: 'rajapura' };
    host.supply.food = host.supply.foodCapacity * 0.62;
    let sit = situate(w, 'heartland');
    planMilitary(sit, false);
    expect(sit.commands.some((c) => c.cmd.kind === 'army_order' && c.cmd.armyId === host.id && c.cmd.order.kind === 'idle')).toBe(true);
    // Below 60% and no gain for 3 days at a town pinned at its floor: another town with grain to spare is chosen.
    host.order = { kind: 'resupply', sourceId: 'rajapura' };
    host.supply.food = host.supply.foodCapacity * 0.3;
    f.ai.memory[`rsp_${host.id}`] = `${situate(w, 'heartland').day - 4},${Math.round(host.supply.food)}`;
    w.settlements.rajapura!.foodStored = 30 * w.settlements.rajapura!.foodConsumption;
    sit = situate(w, 'heartland');
    planMilitary(sit, false);
    const re = sit.commands.find((c) => c.cmd.kind === 'army_order' && c.cmd.armyId === host.id && c.cmd.order.kind === 'resupply');
    const relief = sit.commands.find((c) => c.cmd.kind === 'send_relief');
    expect(re !== undefined || relief !== undefined, JSON.stringify(sit.commands.map((c) => c.cmd))).toBe(true);
    if (re && re.cmd.kind === 'army_order' && re.cmd.order.kind === 'resupply') {
      expect(re.cmd.order.sourceId).not.toBe('rajapura');
      const src = w.settlements[re.cmd.order.sourceId!]!;
      expect(src.foodStored - 30 * src.foodConsumption).toBeGreaterThan(0);
    }
  });

  it('the main host retakes its own lost town before hunting or besieging elsewhere (CD-B1 c)', () => {
    const w = aiSandbox(3);
    runDays(w, 2, { autoEvents: false, autoEngagements: false });
    setWar(w, 'heartland', 'frontier', true);
    const host = Object.values(w.armies).find((a) => a.factionId === 'heartland' && !a.id.startsWith('garrison_'))!;
    // Marudesha's host is elsewhere (no threat to defend against); it holds Suvarna's Dhanyagram with a token garrison.
    for (const a of Object.values(w.armies)) if (a.factionId === 'frontier') delete w.armies[a.id];
    const t = w.settlements.dhanyagram!;
    t.ownerFactionId = 'frontier';
    t.garrison = t.garrison.slice(0, 1);
    host.supply.food = host.supply.foodCapacity;
    const sit = situate(w, 'heartland');
    planMilitary(sit, true);
    const o = sit.commands.find((c) => c.cmd.kind === 'army_order' && c.cmd.armyId === host.id);
    expect(o && o.cmd.kind === 'army_order' ? o.cmd.order : null, JSON.stringify(sit.commands.map((c) => c.cmd))).toEqual({ kind: 'besiege', settlementId: 'dhanyagram' });
  });

  it('peace: sued only below peaceWarScore with field strength under 1.5x the enemy; much weaker it offers tribute (CD-B3)', () => {
    const w = aiSandbox(3);
    setWar(w, 'heartland', 'frontier', true);
    const r = w.diplomacy.relations[relationKey('heartland', 'frontier')]!;
    // Marudesha's host is down to a fifth of its men.
    for (const a of Object.values(w.armies)) if (a.factionId === 'frontier') for (const u of a.units) u.soldiers = Math.max(1, Math.floor(u.soldiers * 0.2));
    // Marudesha losing badly: it sues - as a tributary of Suvarna (strength ratio under its tributaryRatio).
    r.warScore = r.a === 'frontier' ? -60 : 60;
    const weak = situate(w, 'frontier');
    const c = peaceCase(weak, 'heartland');
    expect(c.sue).toBe(true);
    expect(c.tributary).toBe(true);
    considerPeace(weak);
    const p = weak.commands.find((x) => x.cmd.kind === 'propose');
    expect(p && p.cmd.kind === 'propose' ? [p.cmd.type, p.cmd.terms.overlord, p.cmd.terms.payer] : null).toEqual(['peace', 'heartland', 'frontier']);
    const income = w.factions.frontier!.ledger.taxIncome + w.factions.frontier!.ledger.tradeIncome;
    expect(p && p.cmd.kind === 'propose' ? p.cmd.terms.tributePerMonth : 0).toBe(Math.max(1, Math.round(0.1 * income)));
    // Suvarna with a losing war score but a field host 1.5x+ Marudesha's: no peace - it retakes instead.
    r.warScore = r.a === 'heartland' ? -60 : 60;
    const strong = situate(w, 'heartland');
    expect(peaceCase(strong, 'frontier').fieldRatio).toBeGreaterThanOrEqual(1.5);
    considerPeace(strong);
    expect(strong.commands.some((x) => x.cmd.kind === 'propose')).toBe(false);
  });

  it('no proposal the world would refuse is issued or journaled (validateProposal first)', () => {
    resetAiJournal(true);
    const w = aiSandbox(3);
    setWar(w, 'heartland', 'frontier', true);
    const sit = situate(w, 'heartland');
    // At war: no treaty proposal but peace is valid; a demand for tribute at war would be refused, so none is made.
    sit.f.ai.memory.lastProposalDay = -999;
    considerTreaties(sit);
    for (const c of sit.commands) {
      if (c.cmd.kind !== 'propose') continue;
      expect(validateProposal(w, 'heartland', c.cmd.to, c.cmd.type, c.cmd.terms), JSON.stringify(c.cmd)).toBeNull();
    }
    expect(sit.commands.some((c) => c.cmd.kind === 'propose' && c.cmd.type === 'demand_tribute')).toBe(false);
  });

  it('demobilisation: formations split off to be stood down are disbanded the next day, never merged back', () => {
    const w = aiSandbox(3);
    runDays(w, 12, { autoEvents: false, autoEngagements: false });
    const hf = getRegionHeightfield(w);
    const fid = 'heartland';
    const f = w.factions[fid]!;
    // One field host of several formations, a month in the red and an empty treasury for 20 days.
    const hosts = Object.values(w.armies).filter((a) => a.factionId === fid && !a.id.startsWith('garrison_') && a.units.length > 0);
    expect(hosts.length).toBe(1);
    const host = hosts[0]!;
    while (host.units.length < 6) host.units.push({ ...host.units[0]!, id: `u_more_${host.units.length}` });
    const sit = situate(w, fid);
    f.treasury = -200;
    f.ai.memory.net = -400;
    f.ai.memory.crisisSince = sit.day - 11;
    planDemobilize(sit);
    const split = sit.commands.find((c) => c.cmd.kind === 'split_army');
    expect(split, JSON.stringify(sit.commands.map((c) => c.cmd.kind))).toBeDefined();
    expect(typeof f.ai.memory.standDown).toBe('string');
    const out: SimEvent[] = [];
    for (const c of sit.commands) applyStrategicCommand(w, c, out, hf);
    const detachments = Object.values(w.armies).filter((a) => a.factionId === fid && a.id !== host.id && !a.id.startsWith('garrison_') && a.units.length > 0);
    expect(detachments.length).toBe(1);
    const det = detachments[0]!;
    // The detachment (the costliest formations, often the strongest) is no field army: never the main host, never merged.
    const next = situate(w, fid);
    expect(next.armies.map((a) => a.id)).not.toContain(det.id);
    expect(next.standDown.map((a) => a.id)).toEqual([det.id]);
    planMilitary(next, true);
    expect(next.commands.some((c) => c.cmd.kind === 'merge_armies')).toBe(false);
    // The realm's next daily run (in the real tick) disbands it and forgets the plan; the remaining host stays.
    const left = host.units.length;
    runDays(w, 1, { autoEvents: false, autoEngagements: false });
    expect(w.armies[det.id]).toBeUndefined();
    expect(w.armies[host.id]?.units.length).toBe(left);
    expect(f.ai.memory.standDown).toBeUndefined();
  });

  it('the landmark follows the top weights: the expansionist Suvarna raise the Royal Granary, a mercantile court the Hall', () => {
    const w = aiSandbox(3);
    const f = w.factions.heartland!;
    f.age = 'janapada';
    expect(preferredLandmark(situate(w, 'heartland'))!.id).toBe('lm_royal_granary');
    f.ai.personality = 'mercantile';
    expect(preferredLandmark(situate(w, 'heartland'))!.id).toBe('lm_hundred_pillars');
    const h = w.factions.highland!;
    h.ai.personality = 'diplomatic';
    expect(preferredLandmark(situate(w, 'highland'))!.id).toBe('lm_cave_assembly');
    h.ai.personality = 'defensive';
    expect(preferredLandmark(situate(w, 'highland'))!.id).toBe('lm_thousand_steps');
  });

  it('ages up when the requirements hold: Marudesha starts the Salt Caravanserai and enters the Mahajanapada Age', () => {
    const w = aiSandbox(9);
    for (const f of Object.values(w.factions)) if (f.id !== 'frontier') setAiPassive(w, f.id, true);
    for (const r of Object.values(w.diplomacy.relations)) r.atWar = false;
    // A third settlement, the people and the court the Mahajanapada Age asks for.
    const t = w.settlements.tirthaghat!;
    t.ownerFactionId = 'frontier';
    w.settlements.lavanapura!.population = 9000;
    const f = w.factions.frontier!;
    f.treasury = 4000;
    f.legitimacy = 0.6;
    f.stability = 0.6;
    expect(f.age).toBe('janapada');
    let started = -1;
    let day = 0;
    while (day < 200 && f.age === 'janapada') {
      runDays(w, 1, { autoEvents: true, autoEngagements: true });
      day++;
      if (started < 0 && Object.values(w.settlements).some((s) => s.construction.some((j) => j.landmarkId === 'lm_salt_caravanserai'))) started = day;
    }
    expect(started, 'landmark started').toBeGreaterThan(0);
    expect(started).toBeLessThanOrEqual(30);
    expect(f.age).toBe('mahajanapada');
    expect(f.landmarks).toContain('lm_salt_caravanserai');
  }, 120_000);

  it('the schedule keeps heavy planners off the month rollover and runs each once per period', () => {
    for (let slot = 0; slot < 6; slot++) {
      let strategy = 0;
      let economy = 0;
      let diplomacy = 0;
      for (let day = 0; day < 360; day++) {
        const s = aiSchedule(day, day % 30, slot);
        if (day % 30 === 0) expect(s.strategy || s.economy || s.diplomacy).toBe(false);
        strategy += s.strategy ? 1 : 0;
        economy += s.economy ? 1 : 0;
        diplomacy += s.diplomacy ? 1 : 0;
      }
      expect(strategy).toBeGreaterThanOrEqual(70);
      expect(economy).toBeGreaterThanOrEqual(70);
      expect(diplomacy).toBeGreaterThanOrEqual(23);
    }
  });

  it('a passive realm issues nothing; the player realm is never run', () => {
    const w = aiSandbox(3);
    const hf = getRegionHeightfield(w);
    setAiPassive(w, 'forest', true);
    expect(runCampaignAI(w, 'forest', hf)).toEqual([]);
    setAiPassive(w, 'forest', false);
    w.factions.forest!.isPlayer = true;
    expect(runCampaignAI(w, 'forest', hf)).toEqual([]);
  });
});

describe('determinism with the campaign AI', () => {
  it('an AI-only sandbox continues identically from a mid-run save', () => {
    const a = aiSandbox(11);
    runDays(a, 60);
    const b = decodeJson<WorldState>(encodeJson(a));
    expect(hashState(b)).toBe(hashState(a));
    runDays(a, 90);
    runDays(b, 90);
    expect(hashState(b)).toBe(hashState(a));
    const c = aiSandbox(11);
    runDays(c, 150);
    expect(hashState(c)).toBe(hashState(a));
  }, 120_000);
});
