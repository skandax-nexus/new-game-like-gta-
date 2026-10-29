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
import type { HeroMissionResult, SimEvent, WorldState } from '../../../src/core/types';
import { SANDBOX_PRESETS } from '../../../src/data/campaign';
import { RULES } from '../../../src/data/rules';
import { getEventDef } from '../../../src/data/events';
import { getRegionHeightfield } from '../../../src/sim/strategic/world';
import { applyEffect, checkObjectives, resolveEventChoice, severityScaled } from '../../../src/sim/strategic/events';
import { armySoldiers, createEngagement, makeArmy } from '../../../src/sim/strategic/armies';
import { battleSetupFromEngagement, decideEngagement, predictBattle, retreatLossShare, STANCE_AGGRESSION } from '../../../src/sim/strategic/autoresolve';
import { computeScore, endGameStats } from '../../../src/sim/strategic/statistics';
import { victoryBreakdowns } from '../../../src/sim/strategic/victory';
import { applyDialogueEffects, applyHeroMissionResult, availableHeroMissions, heroMissionDoneFlag } from '../../../src/sim/strategic/hero';
import { campaign, quiet, runDays, sandbox, withPendingData } from './helpers';

const scope = (fid = 'heartland', settlementId: string | null = null) => ({ factionId: fid, settlementId, provinceId: null, characterId: null, armyId: null });

describe('whole campaigns', () => {
  it('The Broken Crown with every event auto-resolved ends mixed - never defeat - on 6/6 seeds', () => {
    withPendingData(() => {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const w = campaign(seed);
        runDays(w, 545);
        expect(w.victory.status, `seed ${seed}: ${w.victory.outcomeId}`).toBe('ended');
        expect(['out_restored', 'out_iron']).toContain(w.victory.outcomeId);
        expect(w.victory.endedDay).toBe(540);
        expect(w.settlements.rajapura!.ownerFactionId).toBe('heartland');
      }
    });
  }, 600_000);

  it('The Seven Hills runs 540 days without exceptions', () => {
    withPendingData(() => {
      const w = campaign(3, 'seven_hills', 'hard');
      runDays(w, 545);
      expect(w.calendar.totalHours).toBeGreaterThan(0);
      expect(['ended', 'victory', 'defeat']).toContain(w.victory.status);
    });
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
    withPendingData(() => {
      const w = campaign(5);
      runDays(w, 200);
      const st = w.statistics.heartland!;
      expect(st.grain_harvested ?? 0).toBeGreaterThan(0);
      expect(st.events_resolved ?? 0).toBeGreaterThan(0);
      const rows = endGameStats(w);
      expect(rows.map((r) => r.def.id)).toContain('famine_days');
    });
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
