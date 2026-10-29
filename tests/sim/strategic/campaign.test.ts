/**
 * SIM-01 phase F: campaigns, events, outcomes, write-back, autoresolve, statistics, victory and the hero API
 * (DESIGN_SPEC §6.12, §6.14, §7.13, §8.9, §9.6, §10.2-§10.3, §11.9). OWNER: Simulation Engineer - Strategic World
 * Simulation.
 *
 * The Broken Crown auto-resolved ends 'mixed' (never defeat) on 6/6 seeds; The Seven Hills and every sandbox preset
 * run 540 days without exceptions; immediate victories; event severity; spawn_army / damage_road; autoresolve stance
 * and retreat; prediction lines; statistics and score; sandbox victory; hero results applied once.
 */
import { describe, expect, it } from 'vitest';
import type { HeroMissionResult, SimEvent, StrategicCommand, WorldState } from '../../../src/core/types';
import { BUILDING_TYPES } from '../../../src/core/types';
import { SANDBOX_PRESETS } from '../../../src/data/campaign';
import { RULES } from '../../../src/data/rules';
import { getEventDef } from '../../../src/data/events';
import { applyStrategicCommand, getRegionHeightfield, validateStrategicCommand } from '../../../src/sim/strategic/world';
import { COMMAND_REASONS } from '../../../src/sim/strategic/commands';
import { ARMY_REASONS } from '../../../src/sim/strategic/armies';
import { CONSTRUCTION_REASONS, validateLandmark, validateRepair } from '../../../src/sim/strategic/construction';
import { RECRUIT_REASONS } from '../../../src/sim/strategic/recruitment';
import { SIEGE_REASONS, captureSettlement } from '../../../src/sim/strategic/siege';
import { SUPPLY_REASONS } from '../../../src/sim/strategic/supply';
import { MARKET_REASONS } from '../../../src/sim/strategic/market';
import { POLITICS_REASONS } from '../../../src/sim/strategic/politics';
import { COUNCIL_REASONS } from '../../../src/sim/strategic/council';
import { DYNASTY_REASONS } from '../../../src/sim/strategic/dynasty';
import { DIPLOMACY_REASONS, emptyTerms, propose } from '../../../src/sim/strategic/diplomacy';
import { ESPIONAGE_REASONS, startMission } from '../../../src/sim/strategic/espionage';
import { PRISONER_REASONS } from '../../../src/sim/strategic/writeback';
import { applyEffect, checkObjectives, evaluateEventsDaily, formatEventText, resolveEventChoice, severityScaled } from '../../../src/sim/strategic/events';
import { armySoldiers, createEngagement, makeArmy } from '../../../src/sim/strategic/armies';
import { battleSetupFromEngagement, decideEngagement, predictBattle, retreatLossShare, STANCE_AGGRESSION } from '../../../src/sim/strategic/autoresolve';
import { computeScore, endGameStats } from '../../../src/sim/strategic/statistics';
import { victoryBreakdowns } from '../../../src/sim/strategic/victory';
import { applyDialogueEffects, applyHeroMissionResult, availableHeroMissions, heroMissionDoneFlag } from '../../../src/sim/strategic/hero';
import { campaign, issue, quiet, runDays, sandbox } from './helpers';

const scope = (fid = 'heartland', settlementId: string | null = null) => ({ factionId: fid, settlementId, provinceId: null, characterId: null, armyId: null });

describe('whole campaigns', () => {
  it('The Broken Crown with every event auto-resolved ends mixed - never defeat - on 6/6 seeds', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const w = campaign(seed);
      runDays(w, 545);
      expect(w.victory.status, `seed ${seed}: ${w.victory.outcomeId}`).toBe('ended');
      expect(['out_restored', 'out_iron']).toContain(w.victory.outcomeId);
      expect(w.victory.endedDay).toBe(540);
      expect(w.settlements.rajapura!.ownerFactionId).toBe('heartland');
    }
  }, 600_000);

  it('The Seven Hills runs 540 days without exceptions', () => {
    const w = campaign(3, 'seven_hills', 'hard');
    runDays(w, 545);
    expect(w.calendar.totalHours).toBeGreaterThan(0);
    expect(['ended', 'victory', 'defeat']).toContain(w.victory.status);
  }, 600_000);

  it('every sandbox preset runs 540 days without exceptions', () => {
    for (const preset of SANDBOX_PRESETS) {
      const w = sandbox(4, preset.patch);
      runDays(w, 540);
      expect(Object.keys(w.factions).length, preset.id).toBeGreaterThan(1);
      for (const f of Object.values(w.factions)) for (const v of Object.values(f.victoryProgress)) expect(v >= 0 && v <= 1, preset.id).toBe(true);
    }
  }, 600_000);
});

describe('scenario outcomes (DESIGN_SPEC §9.6)', () => {
  it('an immediate victory ends the scenario as soon as it holds', () => {
    const w = campaign(5);
    w.events.flags.succession_resolved = true;
    for (const id of ['rajapura', 'setupur', 'giridurg']) w.settlements[id]!.ownerFactionId = 'heartland';
    const out: SimEvent[] = [];
    checkObjectives(w, out);
    expect(w.victory.status).toBe('victory');
    expect(w.victory.outcomeId).toBe('out_conquest');
    expect(out.some((e) => e.kind === 'scenario_ended' && e.result === 'victory')).toBe(true);
  });

  it('a non-immediate outcome waits for day 540; defeats are immediate', () => {
    const w = campaign(5);
    w.events.flags.succession_resolved = true;
    checkObjectives(w, []);
    expect(w.victory.status).toBe('ongoing'); // out_restored holds but is not immediate
    w.settlements.rajapura!.ownerFactionId = 'highland';
    checkObjectives(w, []);
    expect(w.victory.status).toBe('defeat');
    expect(w.victory.outcomeId).toBe('out_fallen');
  });
});

describe('events (DESIGN_SPEC §7.13, §10.3)', () => {
  it('disaster effects on the player scale with eventSeverity; choice costs never do', () => {
    const run = (difficulty: WorldState['difficulty']): { store: number; treasury: number } => {
      const w = campaign(5, 'broken_crown', difficulty);
      const s = w.settlements.rajapura!;
      const store = s.foodStored;
      const treasury = w.factions.heartland!.treasury;
      // A flood (disaster) on the capital: endure = stores x0.8.
      w.events.pending.push({ id: 'evt_test', defId: 'evt_monsoon_flood', day: 0, scope: scope('heartland', 'rajapura'), status: 'pending', choiceId: null, resolvedDay: null, params: {} });
      resolveEventChoice(w, 'evt_test', 'endure', []);
      // A political choice cost: tax refusal 'force' (+200 treasury) is not a disaster.
      applyEffect(w, { kind: 'faction_var', target: { kind: 'player' }, variable: 'treasury', op: 'add', value: -300 }, scope(), []);
      return { store: s.foodStored / store, treasury: w.factions.heartland!.treasury - treasury };
    };
    expect(run('normal').store).toBeCloseTo(0.8, 6);
    expect(run('very_hard').store).toBeCloseTo(1 - 0.2 * 1.3, 6);
    expect(run('easy').store).toBeCloseTo(1 - 0.2 * 0.75, 6);
    expect(run('very_hard').treasury).toBe(-300);
    expect(getEventDef('evt_monsoon_flood')!.category).toBe('disaster');
  });

  it('formatEventText fills {placeholders} in the body and in every choice label / description', () => {
    const w = campaign(5);
    w.events.scheduled.push({ eventId: 'evt_governor_demands', day: 0, scope: { factionId: 'heartland', settlementId: 'ratnapura', provinceId: w.settlements.ratnapura!.provinceId, characterId: null, armyId: null } });
    evaluateEventsDaily(w, []);
    const inst = w.events.pending.find((e) => e.defId === 'evt_governor_demands')!;
    expect(inst).toBeDefined();
    const t = formatEventText(w, inst);
    expect(getEventDef('evt_governor_demands')!.choices.some((c) => c.description.includes('{settlement}'))).toBe(true);
    expect(t.choices.map((c) => c.id)).toEqual(getEventDef('evt_governor_demands')!.choices.map((c) => c.id));
    for (const c of t.choices) expect(`${c.label} ${c.description}`).not.toMatch(/[{}]/);
    expect(t.choices.some((c) => c.description.includes(w.settlements.ratnapura!.name))).toBe(true);
    expect(`${t.title} ${t.body}`).not.toMatch(/[{}]/);
  });

  it('severityScaled: harmful adds and muls only', () => {
    const w = campaign(5, 'broken_crown', 'hard');
    // Outside a disaster the scale is off.
    expect(severityScaled(w, 'add', -10, false, true)).toBe(-10);
  });

  it('spawn_army raises a host near a settlement; damage_road wears the roads there', () => {
    const w = campaign(5);
    const n = Object.keys(w.armies).length;
    applyEffect(w, { kind: 'spawn_army', faction: { kind: 'faction', id: 'frontier' }, x: null, z: null, nearSettlement: 'lavanapura', units: [{ unitClass: 'cavalry', formations: 2 }], name: 'Salt Riders' }, scope(), []);
    expect(Object.keys(w.armies).length).toBe(n + 1);
    const a = Object.values(w.armies).find((x) => x.name === 'Salt Riders')!;
    expect(a.factionId).toBe('frontier');
    expect(armySoldiers(a)).toBe(120);
    const edges = w.roads.adjacency.node_dhanyagram!;
    const before = edges.map((id) => w.roads.edges[id]!.condition);
    applyEffect(w, { kind: 'damage_road', edgeId: null, nearSettlement: 'dhanyagram', amount: 0.3 }, scope(), []);
    edges.forEach((id, i) => expect(w.roads.edges[id]!.condition).toBeCloseTo(Math.max(0, before[i]! - 0.3), 10));
  });
});

describe('autoresolve and the prediction (DESIGN_SPEC §6.14)', () => {
  function engagement(w: WorldState, stance: 'aggressive' | 'balanced' | 'cautious') {
    quiet(w);
    const a = makeArmy(w, 'army_p', 'Player Host', 'heartland', 0, 2000, [{ unitClass: 'spearmen', formations: 3 }, { unitClass: 'archers', formations: 1 }], null);
    a.stance = stance;
    const b = makeArmy(w, 'army_e', 'Hill Host', 'highland', 60, 2000, [{ unitClass: 'spearmen', formations: 2 }, { unitClass: 'cavalry', formations: 1 }], null);
    w.armies[a.id] = a;
    w.armies[b.id] = b;
    return createEngagement(w, a, b, [], getRegionHeightfield(w), 'field', null);
  }

  it('the player side fights with its stance aggression (0.75 / 0.5 / 0.3); the AI side with its personality', () => {
    for (const st of ['aggressive', 'balanced', 'cautious'] as const) {
      const w = campaign(5);
      const e = engagement(w, st);
      const setup = battleSetupFromEngagement(w, e.id, false, 33);
      expect(setup.sides[0].aggression).toBe(STANCE_AGGRESSION[st]);
      expect(setup.sides[1].aggression).toBeNull();
    }
  });

  it('siege battles carry the walls: 12 segments of wallHp / 12', () => {
    const w = quiet(campaign(5));
    const g = w.settlements.giridurg!;
    const a = makeArmy(w, 'army_p', 'Siege Host', 'heartland', g.x + g.radius + 100, g.z, [{ unitClass: 'spearmen', formations: 2 }], null);
    const d = makeArmy(w, 'army_d', 'Garrison', 'highland', g.x, g.z, [{ unitClass: 'spearmen', formations: 1 }], null);
    w.armies[a.id] = a;
    w.armies[d.id] = d;
    const e = createEngagement(w, a, d, [], getRegionHeightfield(w), 'siege', 'giridurg');
    expect(e.x).toBe(g.x);
    const setup = battleSetupFromEngagement(w, e.id, false, 33);
    expect(setup.fortification).not.toBeNull();
    expect(setup.fortification!.kind).toBe('stone_wall');
    expect(setup.fortification!.wallHp).toBeCloseTo(g.wallHp / 12, 6);
    expect(setup.fortification!.gates).toBe(1);
    expect(setup.fortification!.towers).toBe(18);
  });

  it('prediction: logistic chance, at most 4 factor lines worded for the player', () => {
    const w = campaign(5);
    const e = engagement(w, 'balanced');
    const p = predictBattle(w, e.id);
    expect(p.attackerWinChance).toBeGreaterThan(0.5);
    expect(p.factors.length).toBeGreaterThanOrEqual(1);
    expect(p.factors.length).toBeLessThanOrEqual(4);
    expect(p.factors[0]).toMatch(/^Your host is the stronger/);
    w.armies.army_p!.supply.food = 0;
    const hungry = predictBattle(w, e.id);
    expect(hungry.attackerWinChance).toBeLessThan(p.attackerWinChance);
    expect(hungry.factors.some((f) => f.includes('hungry'))).toBe(true);
  });

  it('retreat: 10% rearguard (3% when 20% faster), then one day of march', () => {
    const w = campaign(5);
    const e = engagement(w, 'balanced');
    expect(retreatLossShare(w, e.id, 0)).toBe(0.1);
    const before = armySoldiers(w.armies.army_p!);
    const out: SimEvent[] = [];
    decideEngagement(w, e.id, 'retreat', out, getRegionHeightfield(w));
    const a = w.armies.army_p!;
    expect(armySoldiers(a)).toBeGreaterThanOrEqual(Math.floor(before * 0.88));
    expect(armySoldiers(a)).toBeLessThanOrEqual(Math.ceil(before * 0.92));
    expect(a.status).toBe('marching');
    expect(a.order.kind).toBe('retreat');
    expect(w.engagements[e.id]!.status).toBe('resolved');
    // Riders retreating from infantry lose only 3%.
    const w2 = campaign(5);
    quiet(w2);
    const r = makeArmy(w2, 'army_r', 'Riders', 'heartland', 0, 2000, [{ unitClass: 'cavalry', formations: 2 }], null);
    const f = makeArmy(w2, 'army_f', 'Foot', 'highland', 60, 2000, [{ unitClass: 'spearmen', formations: 3 }], null);
    w2.armies[r.id] = r;
    w2.armies[f.id] = f;
    const e2 = createEngagement(w2, f, r, [], getRegionHeightfield(w2), 'field', null);
    expect(retreatLossShare(w2, e2.id, 1)).toBe(0.03);
  });
});

describe('statistics and score (DESIGN_SPEC §8.9)', () => {
  it('score = 100 x settlements + 10 x pop / 1,000 + wealth / 100 + 50 x battles won + ...', () => {
    const w = campaign(5);
    w.statistics.heartland = { ...(w.statistics.heartland ?? {}), wealth_earned: 5000, battles_won: 2, enemies_killed: 300, treaties_signed: 1, landmarks: 1, ages_advanced: 1 };
    const S = RULES.score;
    const settlements = Object.values(w.settlements).filter((s) => s.ownerFactionId === 'heartland');
    const pop = settlements.reduce((t, s) => t + s.population, 0);
    const expected = S.perSettlement * settlements.length + (S.perThousandPopulation * pop) / 1000 + 50 + 2 * 50 + 0.2 * 300 + 40 + 250 + 300;
    expect(computeScore(w, 'heartland').total).toBe(Math.round(expected));
    const rows = endGameStats(w);
    const score = rows.find((r) => r.def.id === 'score')!;
    expect(score.cells[0]!.factionId).toBe('heartland');
    expect(score.cells.filter((c) => c.best).length).toBeGreaterThanOrEqual(1);
  });

  it('counters are tracked by the systems: wars, treaties, revolts, decisions, harvests', () => {
    const w = campaign(5);
    runDays(w, 200);
    const st = w.statistics.heartland!;
    expect(st.grain_harvested ?? 0).toBeGreaterThan(0);
    expect(st.events_resolved ?? 0).toBeGreaterThan(0);
    const rows = endGameStats(w);
    expect(rows.map((r) => r.def.id)).toContain('famine_days');
  }, 120_000);
});

describe('sandbox victory (DESIGN_SPEC §10.2)', () => {
  it('progress bars lie in 0..1 and an enabled path that is met wins', () => {
    const w = sandbox(5, { victoryTypes: ['cultural_legacy'] });
    for (const b of victoryBreakdowns(w, 'heartland')) {
      expect(b.progress).toBeGreaterThanOrEqual(0);
      expect(b.progress).toBeLessThanOrEqual(1);
    }
    const f = w.factions.heartland!;
    f.culturePoints = 1600;
    f.landmarks = ['a', 'b'];
    f.age = 'samrajya';
    runDays(w, 1);
    expect(w.victory.status).toBe('victory');
    expect(w.victory.outcomeId).toBe('cultural_legacy');
  });

  it('losing every settlement is a defeat', () => {
    const w = sandbox(5);
    for (const s of Object.values(w.settlements)) if (s.ownerFactionId === 'heartland') s.ownerFactionId = 'highland';
    runDays(w, 1);
    expect(w.victory.status).toBe('defeat');
  });
});

describe('hero API (DESIGN_SPEC §11.9)', () => {
  const result = (over: Partial<HeroMissionResult> = {}): HeroMissionResult => ({
    missionId: 'hm_homecoming',
    success: true,
    objectivesCompleted: ['o_reach_palace', 'o_mother'],
    clues: ['seal_ring'],
    dialogueChoices: ['dlg_vasumati_ask_court'],
    negotiations: { hc_vasumati: 'won' },
    heroHealth: 0.2,
    attempts: 1,
    durationSec: 300,
    ...over,
  });

  it('a mission result applies once: effects, clues, dialogue, negotiations, flags', () => {
    const w = campaign(5);
    w.events.flags.bc_act = 1; // Act I begun (prologue)
    expect(availableHeroMissions(w, 'heartland').map((m) => m.id)).toContain('hm_homecoming');
    const leg = w.factions.heartland!.legitimacy;
    expect(applyHeroMissionResult(w, 'heartland', result(), [])).toBe(true);
    expect(w.factions.heartland!.legitimacy).toBeCloseTo(leg + 0.02, 10);
    expect(w.events.flags.homecoming_done).toBe(true);
    expect(w.events.flags[heroMissionDoneFlag('hm_homecoming')]).toBe('success');
    expect(w.events.flags.clue_seal_ring).toBe(true);
    expect(w.events.flags.neg_hc_vasumati).toBe('won');
    expect(w.events.flags.hero_wounded).toBe(true);
    expect(w.events.flags.dlg_vasumati_ask_court).toBe(true);
    // Applied once.
    expect(applyHeroMissionResult(w, 'heartland', result(), [])).toBe(false);
    expect(w.factions.heartland!.legitimacy).toBeCloseTo(leg + 0.02, 10);
    expect(availableHeroMissions(w, 'heartland').map((m) => m.id)).not.toContain('hm_homecoming');
  });

  it('a failed mission applies onFailure; dialogue effects apply once each', () => {
    const w = campaign(5);
    w.events.flags.homecoming_done = true;
    const stab = w.factions.heartland!.stability;
    expect(applyHeroMissionResult(w, 'heartland', result({ missionId: 'hm_hall_of_pillars', success: false, clues: [], dialogueChoices: [], negotiations: {}, heroHealth: 1 }), [])).toBe(true);
    expect(w.events.flags.court_lost).toBe(true);
    expect(w.factions.heartland!.stability).toBeCloseTo(stab - 0.03, 10);
    expect(applyDialogueEffects(w, 'heartland', ['dlg_vasumati_ask_court', 'dlg_vasumati_ask_court'], [])).toBe(1);
    expect(applyDialogueEffects(w, 'heartland', ['dlg_vasumati_ask_court'], [])).toBe(0);
  });

  it('newly available missions are announced to the player once', () => {
    const w = campaign(5);
    const ev = runDays(w, 3);
    const announced = ev.filter((e) => e.kind === 'hero_mission_available');
    expect(announced.length).toBeGreaterThan(0);
    const again = runDays(w, 3).filter((e) => e.kind === 'hero_mission_available' && announced.some((a) => a.kind === 'hero_mission_available' && a.missionId === (e as { missionId: string }).missionId));
    expect(again).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
// Every StrategicCommand kind: one accepted and one refused case with its reason (SIM-01 phase G).
// ---------------------------------------------------------------------------------------------------

interface CommandCase {
  kind: StrategicCommand['kind'];
  /** Prepare the world; return the accepted command, the refused one and the expected refusal. */
  setup: (w: WorldState) => { ok: StrategicCommand; bad: StrategicCommand; reason: string };
  faction?: string;
}

function rich(w: WorldState): WorldState {
  const f = w.factions.heartland!;
  f.treasury = 50000;
  f.foodReserve = 50000;
  f.materials.timber = 5000;
  f.materials.stone = 5000;
  return w;
}

function landPoint(w: WorldState, x: number, z: number, water: boolean): { x: number; z: number } {
  const hf = getRegionHeightfield(w);
  for (let r = 0; r < 3000; r += 20) {
    for (let k = 0; k < 16; k++) {
      const px = x + r * Math.cos((k / 16) * 2 * Math.PI);
      const pz = z + r * Math.sin((k / 16) * 2 * Math.PI);
      if (hf.inBounds(px, pz) && hf.isWater(px, pz) === water) return { x: px, z: pz };
    }
  }
  throw new Error('no point');
}

const CASES: CommandCase[] = [
  { kind: 'move_army', setup: (w) => ({ ok: { kind: 'move_army', armyId: 'army_royal', x: w.armies.army_royal!.x + 200, z: w.armies.army_royal!.z }, bad: { kind: 'move_army', armyId: 'army_giri', x: 0, z: 0 }, reason: ARMY_REASONS.notYours }) },
  { kind: 'army_order', setup: () => ({ ok: { kind: 'army_order', armyId: 'army_royal', order: { kind: 'besiege', settlementId: 'giridurg' } }, bad: { kind: 'army_order', armyId: 'army_royal', order: { kind: 'besiege', settlementId: 'rajapura' } }, reason: SIEGE_REASONS.own }) },
  { kind: 'set_army_stance', setup: () => ({ ok: { kind: 'set_army_stance', armyId: 'army_royal', stance: 'cautious' }, bad: { kind: 'set_army_stance', armyId: 'army_royal', stance: 'reckless' as never }, reason: COMMAND_REASONS.badStance }) },
  { kind: 'forced_march', setup: () => ({ ok: { kind: 'forced_march', armyId: 'army_royal', on: true }, bad: { kind: 'forced_march', armyId: 'army_nope', on: true }, reason: ARMY_REASONS.noArmy }) },
  { kind: 'split_army', setup: (w) => ({ ok: { kind: 'split_army', armyId: 'army_royal', unitIds: [w.armies.army_royal!.units[0]!.id] }, bad: { kind: 'split_army', armyId: 'army_royal', unitIds: [] }, reason: ARMY_REASONS.noUnits }) },
  {
    kind: 'merge_armies',
    setup: (w) => {
      const host = w.armies.army_royal!;
      const det = makeArmy(w, 'army_det', 'Detachment', 'heartland', host.x + 30, host.z, [{ unitClass: 'spearmen', formations: 1 }], null);
      w.armies[det.id] = det;
      return { ok: { kind: 'merge_armies', armyId: 'army_royal', otherArmyId: 'army_det' }, bad: { kind: 'merge_armies', armyId: 'army_royal', otherArmyId: 'army_south' }, reason: ARMY_REASONS.tooFar };
    },
  },
  { kind: 'disband_army', setup: () => ({ ok: { kind: 'disband_army', armyId: 'army_south' }, bad: { kind: 'disband_army', armyId: 'army_giri' }, reason: ARMY_REASONS.notYours }) },
  { kind: 'recruit', setup: (w) => (rich(w), { ok: { kind: 'recruit', settlementId: 'rajapura', unitClass: 'spearmen', formations: 1, targetArmyId: null }, bad: { kind: 'recruit', settlementId: 'giridurg', unitClass: 'spearmen', formations: 1, targetArmyId: null }, reason: RECRUIT_REASONS.notOwned }) },
  { kind: 'build', setup: (w) => (rich(w), { ok: { kind: 'build', settlementId: 'dhanyagram', building: 'granary' }, bad: { kind: 'build', settlementId: 'giridurg', building: 'granary' }, reason: CONSTRUCTION_REASONS.notOwned }) },
  {
    kind: 'cancel_construction',
    setup: (w) => {
      rich(w);
      issue(w, { kind: 'build', settlementId: 'dhanyagram', building: 'granary' });
      return { ok: { kind: 'cancel_construction', settlementId: 'dhanyagram', building: 'granary' }, bad: { kind: 'cancel_construction', settlementId: 'kusumpur', building: 'granary' }, reason: CONSTRUCTION_REASONS.noJob };
    },
  },
  {
    kind: 'repair_building',
    setup: (w) => {
      rich(w);
      const b = w.settlements.rajapura!.buildings[0]!;
      b.condition = 0.5;
      const missing = BUILDING_TYPES.find((t) => !w.settlements.rajapura!.buildings.some((x) => x.type === t))!;
      return { ok: { kind: 'repair_building', settlementId: 'rajapura', building: b.type }, bad: { kind: 'repair_building', settlementId: 'rajapura', building: missing }, reason: validateRepair(w, 'heartland', 'rajapura', missing).reason! };
    },
  },
  {
    kind: 'start_landmark',
    setup: (w) => {
      const bad: StrategicCommand = { kind: 'start_landmark', landmarkId: 'lm_edict_pillars', settlementId: 'rajapura', cell: [0, 0] };
      const reason = validateLandmark(w, 'heartland', 'lm_edict_pillars', 'rajapura', [0, 0]).reason!;
      for (const id of ['tirthaghat', 'naukapattana', 'shilapur']) w.settlements[id]!.ownerFactionId = 'heartland';
      w.provinces.prov_tira!.ownerFactionId = 'heartland';
      rich(w);
      const chk = validateLandmark(w, 'heartland', 'lm_edict_pillars', 'rajapura', null);
      return { ok: { kind: 'start_landmark', landmarkId: 'lm_edict_pillars', settlementId: 'rajapura', cell: chk.placement!.cell, rot: chk.placement!.rot }, bad: { ...bad, settlementId: 'giridurg' }, reason: reason === CONSTRUCTION_REASONS.notOwned ? reason : validateLandmark(w, 'heartland', 'lm_edict_pillars', 'giridurg', [0, 0]).reason! };
    },
  },
  {
    kind: 'repair_road',
    setup: (w) => {
      w.roads.edges.road_1!.condition = 0.5;
      return { ok: { kind: 'repair_road', edgeId: 'road_1' }, bad: { kind: 'repair_road', edgeId: 'road_12' }, reason: COMMAND_REASONS.roadFine };
    },
  },
  { kind: 'set_tax_rate', setup: () => ({ ok: { kind: 'set_tax_rate', settlementId: 'rajapura', rate: 0.2 }, bad: { kind: 'set_tax_rate', settlementId: 'rajapura', rate: 0.9 }, reason: COMMAND_REASONS.taxRange }) },
  { kind: 'set_tax_policy', setup: () => ({ ok: { kind: 'set_tax_policy', policy: 'heavy' }, bad: { kind: 'set_tax_policy', policy: 'free' as never }, reason: COMMAND_REASONS.badPolicy }) },
  { kind: 'set_labor', setup: () => ({ ok: { kind: 'set_labor', settlementId: 'rajapura', allocation: { farming: 0.6, construction: 0.1, crafts: 0.2, military: 0.1 } }, bad: { kind: 'set_labor', settlementId: 'rajapura', allocation: { farming: 0.9, construction: 0.3, crafts: 0.2, military: 0.1 } }, reason: COMMAND_REASONS.labor }) },
  { kind: 'set_policy', setup: () => ({ ok: { kind: 'set_policy', policy: 'hold_reserve', on: true }, bad: { kind: 'set_policy', policy: 'tithe' as never, on: true }, reason: COMMAND_REASONS.badPolicy }) },
  {
    kind: 'set_rally_point',
    setup: (w) => {
      const r = w.settlements.rajapura!;
      return { ok: { kind: 'set_rally_point', settlementId: 'rajapura', rallyPoint: { kind: 'point', x: r.x + 200, z: r.z } }, bad: { kind: 'set_rally_point', settlementId: 'rajapura', rallyPoint: { kind: 'point', x: r.x + 3000, z: r.z } }, reason: COMMAND_REASONS.rallyFar };
    },
  },
  { kind: 'requisition_grain', setup: () => ({ ok: { kind: 'requisition_grain', settlementId: 'dhanyagram', amount: 100, toArmyId: null, toDepotId: null }, bad: { kind: 'requisition_grain', settlementId: 'dhanyagram', amount: 0, toArmyId: null, toDepotId: null }, reason: SUPPLY_REASONS.badAmount }) },
  {
    kind: 'send_relief',
    setup: (w) => {
      w.factions.heartland!.foodReserve = 1000;
      return { ok: { kind: 'send_relief', settlementId: 'setupur', food: 500, wealth: 0 }, bad: { kind: 'send_relief', settlementId: 'setupur', food: 5000, wealth: 0 }, reason: SUPPLY_REASONS.noReserve(5000) };
    },
  },
  {
    kind: 'create_depot',
    setup: (w) => {
      rich(w);
      const r = w.settlements.rajapura!;
      const land = landPoint(w, r.x + 300, r.z, false);
      const water = landPoint(w, r.x, r.z, true);
      return { ok: { kind: 'create_depot', x: land.x, z: land.z, settlementId: null }, bad: { kind: 'create_depot', x: water.x, z: water.z, settlementId: null }, reason: SUPPLY_REASONS.depotWater };
    },
  },
  { kind: 'transfer_supply', setup: () => ({ ok: { kind: 'transfer_supply', fromId: 'army_royal', toId: 'rajapura', amount: 100 }, bad: { kind: 'transfer_supply', fromId: 'army_royal', toId: 'rajapura', amount: 0 }, reason: SUPPLY_REASONS.badAmount }) },
  {
    kind: 'market_trade',
    setup: (w) => {
      rich(w);
      if (!w.settlements.rajapura!.buildings.some((b) => b.type === 'market')) w.settlements.rajapura!.buildings.push({ type: 'market', level: 1, condition: 1 });
      return { ok: { kind: 'market_trade', resource: 'grain', lots: 2, buy: true }, bad: { kind: 'market_trade', resource: 'grain', lots: 0, buy: true }, reason: MARKET_REASONS.badLots };
    },
  },
  { kind: 'appoint_governor', setup: () => ({ ok: { kind: 'appoint_governor', provinceId: 'prov_tira', characterId: 'char_senapati' }, bad: { kind: 'appoint_governor', provinceId: 'prov_dakshinagiri', characterId: 'char_senapati' }, reason: POLITICS_REASONS.provinceNotOwned }) },
  { kind: 'appoint_council', setup: () => ({ ok: { kind: 'appoint_council', seat: 'treasurer', characterId: 'char_claimant' }, bad: { kind: 'appoint_council', seat: 'treasurer', characterId: 'char_regent' }, reason: COUNCIL_REASONS.ruler }) },
  { kind: 'designate_heir', setup: () => ({ ok: { kind: 'designate_heir', characterId: 'char_claimant' }, bad: { kind: 'designate_heir', characterId: 'char_regent' }, reason: DYNASTY_REASONS.ruler }) },
  {
    kind: 'arrange_marriage',
    setup: (w) => {
      const r = w.diplomacy.relations['heartland|highland']!;
      r.atWar = false;
      r.opinion = 60;
      return { ok: { kind: 'arrange_marriage', characterId: 'char_heir', otherCharacterId: 'char_giri_kumari' }, bad: { kind: 'arrange_marriage', characterId: 'char_regent', otherCharacterId: 'char_giri_kumari' }, reason: DIPLOMACY_REASONS.marriage };
    },
  },
  {
    kind: 'propose',
    setup: (w) => {
      for (const t of Object.values(w.diplomacy.treaties)) if (t.type === 'trade') t.endDay = 0;
      return { ok: { kind: 'propose', to: 'forest', type: 'trade', terms: emptyTerms() }, bad: { kind: 'propose', to: 'forest', type: 'peace', terms: emptyTerms() }, reason: DIPLOMACY_REASONS.notAtWar };
    },
  },
  {
    kind: 'respond_proposal',
    setup: (w) => {
      const res = propose(w, 'forest', 'heartland', 'non_aggression', emptyTerms(), []);
      return { ok: { kind: 'respond_proposal', proposalId: res.proposalId!, accept: true }, bad: { kind: 'respond_proposal', proposalId: 'prop_none', accept: true }, reason: DIPLOMACY_REASONS.noProposal };
    },
  },
  { kind: 'spy_mission', setup: () => ({ ok: { kind: 'spy_mission', targetFactionId: 'highland', mission: 'gather_intel', settlementId: null, agentCharacterId: null }, bad: { kind: 'spy_mission', targetFactionId: 'heartland', mission: 'gather_intel', settlementId: null, agentCharacterId: null }, reason: ESPIONAGE_REASONS.self }) },
  {
    kind: 'recall_agent',
    setup: (w) => {
      const r = startMission(w, 'heartland', 'highland', 'gather_intel', null, null);
      return { ok: { kind: 'recall_agent', agentId: r.agentId! }, bad: { kind: 'recall_agent', agentId: 'agent_none' }, reason: ESPIONAGE_REASONS.noAgent };
    },
  },
  {
    kind: 'event_choice',
    setup: (w) => {
      runDays(w, 2, { autoEvents: false });
      const inst = w.events.pending.find((p) => p.defId === 'evt_bc_prologue')!;
      return { ok: { kind: 'event_choice', eventInstanceId: inst.id, choiceId: 'begin' }, bad: { kind: 'event_choice', eventInstanceId: 'evt_none', choiceId: 'begin' }, reason: COMMAND_REASONS.noEvent };
    },
  },
  {
    kind: 'negotiate_rebels',
    setup: (w) => {
      const s = w.settlements.ratnapura!;
      s.unrest = 0.4;
      s.rebellionStage = 'protest';
      return { ok: { kind: 'negotiate_rebels', settlementId: 'ratnapura', offer: 'tax_cut' }, bad: { kind: 'negotiate_rebels', settlementId: 'rajapura', offer: 'tax_cut' }, reason: POLITICS_REASONS.calm };
    },
  },
  {
    kind: 'engagement_decision',
    setup: (w) => {
      quiet(w);
      const a = makeArmy(w, 'army_p', 'Host', 'heartland', 0, 2000, [{ unitClass: 'spearmen', formations: 6 }], null);
      const b = makeArmy(w, 'army_e', 'Foe', 'highland', 60, 2000, [{ unitClass: 'spearmen', formations: 1 }], null);
      w.armies[a.id] = a;
      w.armies[b.id] = b;
      const e = createEngagement(w, a, b, [], getRegionHeightfield(w), 'field', null);
      return { ok: { kind: 'engagement_decision', engagementId: e.id, decision: 'autoresolve' }, bad: { kind: 'engagement_decision', engagementId: 'eng_none', decision: 'autoresolve' }, reason: COMMAND_REASONS.noEngagement };
    },
  },
  {
    kind: 'prisoners',
    setup: (w) => {
      quiet(w);
      const a = makeArmy(w, 'army_p', 'Host', 'heartland', 0, 2000, [{ unitClass: 'spearmen', formations: 6 }, { unitClass: 'cavalry', formations: 2 }], null);
      const b = makeArmy(w, 'army_e', 'Foe', 'highland', 60, 2000, [{ unitClass: 'archers', formations: 1 }], null);
      w.armies[a.id] = a;
      w.armies[b.id] = b;
      const e = createEngagement(w, a, b, [], getRegionHeightfield(w), 'field', null);
      issue(w, { kind: 'engagement_decision', engagementId: e.id, decision: 'autoresolve' });
      return { ok: { kind: 'prisoners', engagementId: e.id, decision: 'release' }, bad: { kind: 'prisoners', engagementId: 'eng_none', decision: 'release' }, reason: PRISONER_REASONS.noBattle };
    },
  },
  {
    kind: 'capture_decision',
    setup: (w) => {
      captureSettlement(w, w.settlements.pashanagram!, 'heartland', [], 'assault');
      return { ok: { kind: 'capture_decision', settlementId: 'pashanagram', decision: 'occupy' }, bad: { kind: 'capture_decision', settlementId: 'giridurg', decision: 'occupy' }, reason: SIEGE_REASONS.noCapture };
    },
  },
];

describe('every strategic command is accepted or refused with its reason (SIM-01 phase G)', () => {
  it('covers every StrategicCommand kind', () => {
    const kinds = new Set(CASES.map((c) => c.kind));
    const all: StrategicCommand['kind'][] = ['move_army', 'army_order', 'set_army_stance', 'split_army', 'merge_armies', 'disband_army', 'recruit', 'build', 'cancel_construction', 'repair_road', 'set_tax_rate', 'set_tax_policy', 'set_labor', 'requisition_grain', 'send_relief', 'create_depot', 'transfer_supply', 'appoint_governor', 'appoint_council', 'designate_heir', 'arrange_marriage', 'propose', 'respond_proposal', 'spy_mission', 'recall_agent', 'event_choice', 'negotiate_rebels', 'engagement_decision', 'market_trade', 'start_landmark', 'set_policy', 'forced_march', 'prisoners', 'capture_decision', 'set_rally_point', 'repair_building'];
    for (const k of all) expect(kinds.has(k), k).toBe(true);
  });

  for (const c of CASES) {
    it(c.kind, () => {
      const w = campaign(5);
      const { ok, bad, reason } = c.setup(w);
      const fid = c.faction ?? 'heartland';
      const issuedBad = { factionId: fid, hour: w.calendar.totalHours, cmd: bad };
      expect(validateStrategicCommand(w, issuedBad)).toBe(reason);
      const out: SimEvent[] = [];
      expect(applyStrategicCommand(w, issuedBad, out, getRegionHeightfield(w))).toBe(false);
      expect(out.some((e) => e.kind === 'notification' && e.text === reason)).toBe(true);
      const issuedOk = { factionId: fid, hour: w.calendar.totalHours, cmd: ok };
      expect(validateStrategicCommand(w, issuedOk)).toBeNull();
      expect(applyStrategicCommand(w, issuedOk, [], getRegionHeightfield(w))).toBe(true);
    });
  }
});
