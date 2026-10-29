/**
 * AoE settlement layer (DESIGN_SPEC §7.6, §8.2-§8.6): placement classes and reasons, construction timing (crew ratio,
 * constructionSpeed, monsoon), parallel jobs and queue, refunds, caps and requirements, landmarks and ages, walls,
 * recruitment rules and villager allocation. SIM-01.
 */
import { describe, expect, it } from 'vitest';
import type { GridCell, SettlementState, SimEvent, WorldState } from '../../../src/core/types';
import {
  autoPlace,
  footprintCells,
  footprintOf,
  getSettlementGrid,
  GRID_FLAGS,
  PLACEMENT_REASONS,
  placedFootprints,
  validatePlacement,
} from '../../../src/sim/strategic/placement';
import {
  CONSTRUCTION_REASONS,
  cancelConstruction,
  constructionStage,
  levelCost,
  levelDays,
  maxWallHp,
  queueBuild,
  startLandmark,
  validateBuild,
} from '../../../src/sim/strategic/construction';
import { ageChecklist, landmarkOptions } from '../../../src/sim/strategic/ages';
import { factionMod } from '../../../src/sim/strategic/modifiers';
import { hasElephantSource, newRecruit, queueRecruit, recruitCost, validateRecruit } from '../../../src/sim/strategic/recruitment';
import { villagerAllocation } from '../../../src/sim/strategic/villagers';
import { RULES } from '../../../src/data/rules';
import { campaign, issue, runDays, sandbox } from './helpers';

const S = (w: WorldState, id: string): SettlementState => w.settlements[id]!;

function rich(w: WorldState, fid = 'heartland'): void {
  const f = w.factions[fid]!;
  f.treasury = 100_000;
  f.materials.timber = 50_000;
  f.materials.stone = 50_000;
}

/** First grid cell (NW corner for a 1x1 probe) whose flags match. */
function findCell(w: WorldState, s: SettlementState, pred: (flags: number, dist: number) => boolean): GridCell | null {
  const g = getSettlementGrid(w, s);
  for (let k = 0; k < g.order.length; k++) {
    const idx = g.order[k]!;
    if (pred(g.flags[idx]!, g.dist[idx]!)) return [(idx % g.size) - g.n, Math.floor(idx / g.size) - g.n];
  }
  return null;
}

/** Day count until the settlement has no construction left (or `max`). */
function daysUntilDone(w: WorldState, s: SettlementState, max = 400): number {
  let days = 0;
  while (s.construction.length > 0 && days < max) {
    runDays(w, 1, { autoEvents: true });
    days++;
  }
  return days;
}

describe('placement (DESIGN_SPEC §8.2)', () => {
  it('starting buildings receive non-overlapping cells; footprints are multiples of 4 m', () => {
    const w = campaign(4);
    for (const s of Object.values(w.settlements)) {
      for (const b of s.buildings) {
        const fp = footprintOf(b.type)!;
        expect(fp.w % 4, b.type).toBe(0);
        expect(fp.d % 4, b.type).toBe(0);
        if (fp.placement === 'perimeter') continue;
        expect(b.cell, `${s.id}.${b.type}`).toBeDefined();
      }
      // No two footprints share a cell.
      const seen = new Set<string>();
      for (const p of placedFootprints(s)) {
        const { wc, dc } = footprintCells(p.fp, p.rot);
        for (let j = 0; j < dc; j++) for (let i = 0; i < wc; i++) {
          const k = `${p.cell[0] + i},${p.cell[1] + j}`;
          expect(seen.has(k), `${s.id} overlap at ${k}`).toBe(false);
          seen.add(k);
        }
      }
    }
  });

  it('inner and outer classes accept their ring and reject the other with the documented reasons', () => {
    const w = campaign(4);
    const s = S(w, 'dhanyagram');
    const inner = autoPlace(w, s.id, 'granary')!;
    expect(validatePlacement(w, s.id, 'granary', inner.cell, inner.rot).ok).toBe(true);
    const outer = autoPlace(w, s.id, 'farm_fields')!;
    expect(validatePlacement(w, s.id, 'farm_fields', outer.cell, outer.rot).ok).toBe(true);
    expect(validatePlacement(w, s.id, 'granary', outer.cell, 0).reason).toBe(PLACEMENT_REASONS.inner);
    expect(validatePlacement(w, s.id, 'farm_fields', inner.cell, 0).reason).toBe(PLACEMENT_REASONS.outer);
    expect(validatePlacement(w, s.id, 'granary', [500, 500], 0).reason).toBe(PLACEMENT_REASONS.outsideGrid);
    expect(validatePlacement(w, s.id, 'granary', null, 0).reason).toBe(PLACEMENT_REASONS.noCell);
  });

  it('rotation swaps the footprint (90-degree steps)', () => {
    const fp = footprintOf('granary')!; // 12 x 16
    expect(footprintCells(fp, 0)).toEqual({ wc: 3, dc: 4 });
    expect(footprintCells(fp, 1)).toEqual({ wc: 4, dc: 3 });
    expect(footprintCells(fp, 2)).toEqual({ wc: 3, dc: 4 });
  });

  it('shore: accepted on the river bank, "Needs the river bank" elsewhere', () => {
    const w = campaign(4);
    const s = S(w, 'tirthaghat');
    s.buildings = s.buildings.filter((b) => b.type !== 'ghat');
    const p = autoPlace(w, s.id, 'ghat');
    expect(p).not.toBeNull();
    expect(validatePlacement(w, s.id, 'ghat', p!.cell, p!.rot).ok).toBe(true);
    const inner = autoPlace(w, s.id, 'granary')!;
    expect(validatePlacement(w, s.id, 'ghat', inner.cell, 0).reason).toBe(PLACEMENT_REASONS.shore);
    // A settlement without a bank in its grid.
    expect(autoPlace(w, 'dhanyagram', 'ghat')).toBeNull();
  });

  it('road: accepted beside a road, rejected away from roads or beyond 200 m', () => {
    const w = campaign(4);
    const s = S(w, 'rajapura');
    const p = autoPlace(w, s.id, 'road_station')!;
    expect(p).not.toBeNull();
    expect(validatePlacement(w, s.id, 'road_station', p.cell, p.rot).ok).toBe(true);
    // A 2x3 probe centred on a non-road cell far from any road.
    let far: GridCell | null = null;
    const g = getSettlementGrid(w, s);
    for (let k = 0; k < g.order.length && !far; k++) {
      const idx = g.order[k]!;
      const ci = (idx % g.size) - g.n;
      const cj = Math.floor(idx / g.size) - g.n;
      let clear = true;
      for (let j = -2; j <= 4 && clear; j++) for (let i = -2; i <= 3 && clear; i++) {
        const ii = ci + i + g.n;
        const jj = cj + j + g.n;
        if (ii < 0 || jj < 0 || ii >= g.size || jj >= g.size) clear = false;
        else if (g.flags[ii + jj * g.size]! & GRID_FLAGS.roadAdjacent) clear = false;
      }
      if (clear && g.dist[idx]! < 150) far = [ci, cj];
    }
    expect(validatePlacement(w, s.id, 'road_station', far!, 0).reason).toBe(PLACEMENT_REASONS.road);
    const distant = findCell(w, s, (f, d) => d > 215 && (f & GRID_FLAGS.road) !== 0);
    if (distant) expect(validatePlacement(w, s.id, 'road_station', distant, 0).reason).toBe(PLACEMENT_REASONS.roadTooFar);
  });

  it('resource: near the deposit marker; elsewhere "Must be near the deposit"; no deposit -> reason', () => {
    const w = campaign(4);
    const s = S(w, 'shilapur');
    s.buildings = s.buildings.filter((b) => b.type !== 'mine');
    const g = getSettlementGrid(w, s);
    expect(g.deposits.length).toBe(2); // stone + copper
    const p = autoPlace(w, s.id, 'mine')!;
    expect(validatePlacement(w, s.id, 'mine', p.cell, p.rot).ok).toBe(true);
    // The opposite side of the settlement from every deposit.
    const d0 = g.deposits[0]!;
    const opp: GridCell = [Math.round((2 * s.x - d0.x - s.x) / 4) - 1, Math.round((2 * s.z - d0.z - s.z) / 4) - 1];
    const res = validatePlacement(w, s.id, 'mine', opp, 0);
    expect([PLACEMENT_REASONS.resource, PLACEMENT_REASONS.occupied, PLACEMENT_REASONS.steep, PLACEMENT_REASONS.onRoad]).toContain(res.reason);
    if (res.reason === PLACEMENT_REASONS.resource) expect(res.ok).toBe(false);
    expect(validatePlacement(w, 'dhanyagram', 'mine', [0, 0], 0).reason).toBe(PLACEMENT_REASONS.noDeposit);
  });

  it('perimeter buildings need no cell; water, steep ground, roads and other buildings block', () => {
    const w = campaign(4);
    expect(validatePlacement(w, 'setupur', 'fort_walls', null, 0).ok).toBe(true);
    const raj = S(w, 'rajapura');
    // Every reason a ghat (shore) and a watchtower (outer) meet across Rajapura's grid.
    const reasons = new Set<string>();
    const g = getSettlementGrid(w, raj);
    for (let j = -g.n; j < g.n; j += 1) {
      for (let i = -g.n; i < g.n; i += 1) {
        for (const b of ['ghat', 'watchtower', 'sanitation'] as const) {
          const r = validatePlacement(w, raj.id, b, [i, j], 0);
          if (r.reason) reasons.add(r.reason);
        }
      }
    }
    for (const r of [PLACEMENT_REASONS.water, PLACEMENT_REASONS.steep, PLACEMENT_REASONS.onRoad, PLACEMENT_REASONS.occupied, PLACEMENT_REASONS.shore, PLACEMENT_REASONS.outer, PLACEMENT_REASONS.inner, PLACEMENT_REASONS.outsideGrid]) {
      expect(reasons, r).toContain(r);
    }
    const granary = raj.buildings.find((b) => b.type === 'granary')!;
    expect(validatePlacement(w, raj.id, 'sanitation', granary.cell!, 0).reason).toBe(PLACEMENT_REASONS.occupied);
    const road = findCell(w, raj, (f, d) => (f & GRID_FLAGS.road) !== 0 && d > 30 && d < 150)!;
    expect(validatePlacement(w, raj.id, 'sanitation', road, 0).reason).toBe(PLACEMENT_REASONS.onRoad);
  });
});

describe('construction (DESIGN_SPEC §7.6)', () => {
  it('level n costs x1.6^(n-1) and takes x1.3^(n-1); stages follow progress', () => {
    expect(levelCost('granary', 1)).toEqual({ wealth: 200, timber: 120, stone: 40, labor: 2500 });
    expect(levelCost('granary', 2).wealth).toBeCloseTo(320, 9);
    expect(levelCost('granary', 3).timber).toBeCloseTo(120 * 2.56, 9);
    expect(levelDays('granary', 2)).toBeCloseTo(32.5, 9);
    expect(constructionStage(0.05).id).toBe('foundation');
    expect(constructionStage(0.3).id).toBe('scaffolding');
    expect(constructionStage(0.7).id).toBe('roofing');
    expect(constructionStage(1).id).toBe('complete');
  });

  it('Granary L1 at Dhanyagram completes in 20 +- 1 days and is paid at queue', () => {
    const w = campaign(5);
    const s = S(w, 'dhanyagram');
    s.buildings = s.buildings.filter((b) => b.type !== 'granary');
    const f = w.factions.heartland!;
    const t0 = f.treasury;
    const timber0 = f.materials.timber;
    const out = issue(w, { kind: 'build', settlementId: s.id, building: 'granary' });
    expect(out.some((e) => e.kind === 'construction_started')).toBe(true);
    expect(f.materials.timber).toBe(timber0 - 120);
    expect(f.treasury).toBeLessThanOrEqual(t0 - 200 + 1e-6);
    expect(s.construction[0]!.cell).toBeDefined();
    const days = daysUntilDone(w, s);
    expect(days).toBeGreaterThanOrEqual(19);
    expect(days).toBeLessThanOrEqual(21);
    const g = s.buildings.find((b) => b.type === 'granary')!;
    expect(g.level).toBe(1);
    expect(g.cell).toBeDefined();
  });

  it('Palace at Rajapura: 144 days at constructionSpeed 1 (131 for Suvarna x1.1), crew capped at 1.25', () => {
    for (const [owner, expected] of [['forest', 144], ['heartland', 144 / 1.1]] as const) {
      // Sandbox (no scenario outcome ends the run when Rajapura changes hands); start in Ashvina (no monsoon).
      const w = sandbox(5, { startMonth: 6 });
      const s = S(w, 'rajapura');
      s.buildings = s.buildings.filter((b) => b.type !== 'palace');
      s.ownerFactionId = owner;
      rich(w, owner);
      const chk = queueBuild(w, owner, s.id, 'palace', undefined, undefined, []);
      expect(chk.ok, chk.reason ?? '').toBe(true);
      expect(s.construction[0]!.crew).toBeCloseTo(30000 / 180, 6);
      const days = daysUntilDone(w, s);
      expect(Math.abs(days - expected), `${owner}: ${days}`).toBeLessThanOrEqual(2);
    }
  });

  it('refuses with "Need 120 timber" and other documented reasons', () => {
    const w = campaign(5);
    const dh = S(w, 'dhanyagram');
    dh.buildings = dh.buildings.filter((b) => b.type !== 'granary');
    w.factions.heartland!.materials.timber = 10;
    expect(validateBuild(w, 'heartland', dh.id, 'granary').reason).toBe('Need 120 timber');
    rich(w);
    expect(validateBuild(w, 'heartland', dh.id, 'stables').reason).toBe(CONSTRUCTION_REASONS.requires('Barracks'));
    expect(validateBuild(w, 'heartland', dh.id, 'market').reason).toBe(CONSTRUCTION_REASONS.kind('village'));
    expect(validateBuild(w, 'heartland', 'giridurg', 'granary').reason).toBe(CONSTRUCTION_REASONS.notOwned);
    // Janapada Marudesha: no stepwell (Mahajanapada), fields capped at 3.
    rich(w, 'frontier');
    expect(validateBuild(w, 'frontier', 'lavanapura', 'stepwell').reason).toBe('Requires the Mahajanapada Age');
    expect(validateBuild(w, 'frontier', 'lavanapura', 'farm_fields').reason).toBe(CONSTRUCTION_REASONS.ageCap);
    expect(validateBuild(w, 'heartland', 'ratnapura', 'road_station').reason).toBe(CONSTRUCTION_REASONS.maxLevel);
  });

  it('3 jobs progress in parallel, queue max 5, refunds 90% of the unspent cost', () => {
    const w = campaign(5);
    rich(w);
    const s = S(w, 'rajapura');
    for (const b of ['granary', 'market', 'temple', 'workshop', 'housing'] as const) expect(queueBuild(w, 'heartland', s.id, b, undefined, undefined, []).ok).toBe(true);
    expect(validateBuild(w, 'heartland', s.id, 'barracks').reason).toBe(CONSTRUCTION_REASONS.queueFull);
    runDays(w, 1);
    const prog = s.construction.map((j) => j.progress);
    expect(prog[0]).toBeGreaterThan(0);
    expect(prog[1]).toBeGreaterThan(0);
    expect(prog[2]).toBeGreaterThan(0);
    expect(prog[3]).toBe(0);
    expect(prog[4]).toBe(0);
    const job = s.construction[0]!;
    const f = w.factions.heartland!;
    const t0 = f.treasury;
    const timber0 = f.materials.timber;
    const p = job.progress;
    const res = cancelConstruction(w, 'heartland', s.id, job.type, 0, []);
    expect(res.ok).toBe(true);
    expect(f.treasury - t0).toBeCloseTo(job.paid.wealth * (1 - p) * 0.9, 6);
    expect(f.materials.timber - timber0).toBeCloseTo(job.paid.timber * (1 - p) * 0.9, 6);
    expect(s.construction.length).toBe(4);
  });

  it('the monsoon slows outdoor works (x0.7) but not housing', () => {
    const w = campaign(6);
    rich(w);
    w.calendar.month = 4; // varsha
    const s = S(w, 'rajapura');
    queueBuild(w, 'heartland', s.id, 'housing', undefined, undefined, []);
    queueBuild(w, 'heartland', s.id, 'granary', undefined, undefined, []);
    runDays(w, 1);
    const [h, g] = s.construction;
    const expectedH = (1.25 / levelDays('housing', 4)) * 1.1;
    const expectedG = (1.25 / levelDays('granary', 3)) * 1.1 * RULES.construction.monsoonFactor;
    expect(h!.progress).toBeCloseTo(expectedH, 6);
    expect(g!.progress).toBeCloseTo(expectedG, 6);
  });

  it('construction pauses while the treasury is in debt', () => {
    const w = campaign(6);
    rich(w);
    const s = S(w, 'rajapura');
    queueBuild(w, 'heartland', s.id, 'granary', undefined, undefined, []);
    w.factions.heartland!.treasury = -100;
    runDays(w, 2);
    expect(s.construction[0]!.progress).toBe(0);
  });
});

describe('ages and landmarks (DESIGN_SPEC §8.4-§8.5)', () => {
  function samrajyaReady(): WorldState {
    const w = campaign(7);
    for (const id of ['tirthaghat', 'naukapattana', 'shilapur']) S(w, id).ownerFactionId = 'heartland';
    w.provinces.prov_tira!.ownerFactionId = 'heartland';
    rich(w);
    return w;
  }

  it('requirements checklist rows', () => {
    const w = campaign(7);
    const c = ageChecklist(w, 'heartland');
    expect(c.nextAge).toBe('samrajya');
    expect(c.items.find((i) => i.id === 'settlements')).toMatchObject({ current: 5, required: 8, met: false });
    expect(c.allMet).toBe(false);
    expect(landmarkOptions(w, 'heartland').filter((o) => o.landmark.age === 'samrajya').every((o) => o.status === 'locked')).toBe(true);
    expect(ageChecklist(samrajyaReady(), 'heartland').allMet).toBe(true);
  });

  it('starting one landmark hides the other; no cancel after 50%; completion switches the age with bonuses', () => {
    const w = samrajyaReady();
    const opts = landmarkOptions(w, 'heartland').filter((o) => o.landmark.age === 'samrajya');
    expect(opts.map((o) => o.status)).toEqual(['available', 'available']);
    const leg0 = w.factions.heartland!.legitimacy;
    const out: SimEvent[] = [];
    const chk = startLandmark(w, 'heartland', 'lm_edict_pillars', 'rajapura', null, 0, out);
    expect(chk.ok, chk.reason ?? '').toBe(true);
    expect(out.some((e) => e.kind === 'landmark_started')).toBe(true);
    const after = landmarkOptions(w, 'heartland');
    expect(after.find((o) => o.landmark.id === 'lm_edict_pillars')!.status).toBe('in_progress');
    expect(after.find((o) => o.landmark.id === 'lm_great_road')!.status).toBe('hidden');
    const s = S(w, 'rajapura');
    const job = s.construction.find((j) => j.landmarkId === 'lm_edict_pillars')!;
    job.progress = 0.55;
    expect(cancelConstruction(w, 'heartland', 'rajapura', 'palace', s.construction.indexOf(job), []).reason).toBe(CONSTRUCTION_REASONS.landmarkLocked);
    const gov0 = factionMod(w, 'heartland', 'governanceCost');
    const events = runDays(w, 200, { until: (x) => x.factions.heartland!.age === 'samrajya' });
    expect(w.factions.heartland!.age).toBe('samrajya');
    expect(events.some((e) => e.kind === 'age_advanced' && e.age === 'samrajya')).toBe(true);
    expect(w.factions.heartland!.landmarks).toContain('lm_edict_pillars');
    expect(w.factions.heartland!.legitimacy).toBeGreaterThan(leg0 - 0.05);
    // Samrajya bonus x0.9 and the landmark's x0.85 on governing costs.
    expect(factionMod(w, 'heartland', 'governanceCost')).toBeCloseTo(gov0 * 0.9 * 0.85, 9);
    // Losing the host settlement loses the landmark's effects but not the age.
    s.ownerFactionId = 'highland';
    expect(factionMod(w, 'heartland', 'governanceCost')).toBeCloseTo(gov0 * 0.9, 9);
    expect(w.factions.heartland!.age).toBe('samrajya');
  });
});

describe('walls (DESIGN_SPEC §7.8, §8.6)', () => {
  it('Giridurg: fort level 3 (hilltop + walls 2) x 1,000 x 1.4 = 4,200 wall HP; walls repair 2%/day', () => {
    const w = campaign(8);
    const g = S(w, 'giridurg');
    expect(g.fortLevel).toBe(3);
    expect(g.wallHp).toBeCloseTo(4200, 6);
    expect(maxWallHp(w, g)).toBeCloseTo(4200, 6);
    g.wallHp = 1000;
    runDays(w, 1);
    expect(g.wallHp).toBeCloseTo(1000 + 84, 6);
  });
});

describe('recruitment (DESIGN_SPEC §7.6, §5.7-§5.8)', () => {
  it('needs the unlocking building, the age, an elephant source and the pool', () => {
    const w = campaign(9);
    rich(w);
    expect(validateRecruit(w, 'heartland', 'dhanyagram', 'spearmen', 1, null).reason).toBe('Needs a building that trains Spearmen');
    expect(validateRecruit(w, 'heartland', 'rajapura', 'spearmen', 5, null).reason).toBe('Raise 1 to 4 formations at a time');
    expect(hasElephantSource(w, 'heartland')).toBe(true); // trade treaty with Nilavana (elephants)
    w.diplomacy.treaties = {};
    for (const r of Object.values(w.diplomacy.relations)) r.treatyIds = [];
    expect(validateRecruit(w, 'heartland', 'rajapura', 'war_elephants', 1, null).reason).toMatch(/^War elephants need/);
    w.factions.frontier!.treasury = 50_000;
    expect(validateRecruit(w, 'frontier', 'lavanapura', 'cavalry', 1, null).reason).toBe('Requires the Mahajanapada Age');
    S(w, 'rajapura').recruitPool = 10;
    expect(validateRecruit(w, 'heartland', 'rajapura', 'spearmen', 1, null).reason).toBe('Need 120 recruits');
  });

  it('horses discount mounted classes 20%; Royal Levy raises in 8 days; AI pays the difficulty multiplier', () => {
    const w = campaign(9, 'broken_crown', 'hard');
    expect(recruitCost(w, 'highland', 'cavalry', 1).wealth).toBeCloseTo(720 * 0.8 * 0.9, 6); // horses at Dvaradurga, AI hard x0.9
    expect(recruitCost(w, 'heartland', 'cavalry', 1).wealth).toBeCloseTo(720, 6);
    expect(recruitCost(w, 'heartland', 'spearmen', 1).days).toBeCloseTo(10 * 0.8, 6);
  });

  it('new formations carry barracks + age experience, supply trains load 3,600 grain, rally to an army', () => {
    const w = campaign(9);
    rich(w);
    const raj = S(w, 'rajapura');
    raj.foodStored = 100_000;
    issue(w, { kind: 'set_rally_point', settlementId: 'rajapura', rallyPoint: { kind: 'army', armyId: 'army_royal' } });
    const army = w.armies.army_royal!;
    const units0 = army.units.length;
    expect(queueRecruit(w, 'heartland', 'rajapura', 'spearmen', 1, null).ok).toBe(true);
    expect(queueRecruit(w, 'heartland', 'rajapura', 'supply_train', 1, null).ok).toBe(true);
    runDays(w, 20);
    expect(army.units.length).toBe(units0 + 2);
    const spear = army.units[units0]!;
    expect(spear.experience).toBeCloseTo(0.1 + 0.1 + 0.05, 9); // barracks L2, Mahajanapada
    const fresh = newRecruit(w, 'heartland', raj, 'spearmen');
    expect(fresh.morale).toBeCloseTo(60 * 0.95 + 3, 9); // Royal Levy x0.95, age +3
    expect(army.supply.foodCapacity).toBeGreaterThan(2 * 3600);
  });
});

describe('villagers (DESIGN_SPEC §8.3)', () => {
  it('count = min(cap, labor x 0.01), split by allocation and summing to the total', () => {
    const w = campaign(10);
    const s = S(w, 'rajapura');
    const v = villagerAllocation(s, 120);
    expect(v.total).toBe(Math.min(120, Math.floor(s.labor * 0.01)));
    expect(v.farming + v.construction + v.crafts + v.military + v.carriers).toBe(v.total);
    expect(v.constructionIdle).toBe(v.construction);
    const small = villagerAllocation(S(w, 'gajavana'), 200);
    expect(small.total).toBe(Math.floor(S(w, 'gajavana').labor * 0.01));
    expect(villagerAllocation(s, 30).total).toBe(30);
  });
});

