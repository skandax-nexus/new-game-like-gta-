/**
 * SIM-01 phase C: sieges and captures (DESIGN_SPEC §7.8 "Sieges", "Capture"). OWNER: Simulation Engineer - Strategic
 * World Simulation.
 *
 * Giridurg's 4,200 wallHp against one engineer formation (~52 days at siegeStrength 1), breach + ladders -> assault
 * availability, the starve-out surrender curve, unwalled settlements taken at once, and the occupy / plunder /
 * liberate capture choices. Siege logistics in the real tick (review S1): a depot by the camp feeds the besiegers, a
 * host garrisoned in a besieged town eats from its store with no floor, a host camped outside keeps the 30-day floor.
 */
import { describe, expect, it } from 'vitest';
import type { ArmyState, SimEvent, WorldState } from '../../../src/core/types';
import { FACTIONS } from '../../../src/data/factions';
import { BALANCE } from '../../../src/data/balance';
import { RULES } from '../../../src/data/rules';
import { UNITS } from '../../../src/data/units';
import { getRegionHeightfield } from '../../../src/sim/strategic/world';
import { makeArmy, orderArmy, updateArmiesHourly } from '../../../src/sim/strategic/armies';
import { maxWallHp } from '../../../src/sim/strategic/construction';
import { factionMod } from '../../../src/sim/strategic/modifiers';
import {
  assaultState,
  beginSiege,
  besiegers,
  CAPTURE_DECISION_DAYS,
  captureSettlement,
  decideCapture,
  FIELD_ARMY_FALLBACK_RANGE,
  SIEGE_REASONS,
  surrenderChance,
  updateSiegesDaily,
  wallDamagePerDay,
} from '../../../src/sim/strategic/siege';
import { applyEffect } from '../../../src/sim/strategic/events';
import { dailyConsumption } from '../../../src/sim/strategic/economy';
import { armyFoodNeed, garrisonedArmyFood } from '../../../src/sim/strategic/supply';
import { campaign, issue, runDays } from './helpers';

const scope = (fid = 'heartland') => ({ factionId: fid, settlementId: null, provinceId: null, characterId: null, armyId: null });

function place(w: WorldState, id: string, factionId: string, x: number, z: number, units: { unitClass: Parameters<typeof makeArmy>[6][number]['unitClass']; formations: number }[]): ArmyState {
  const a = makeArmy(w, id, id, factionId, x, z, units, null);
  w.armies[id] = a;
  return a;
}

/** Move every highland army far away so the siege is uncontested (unit tests drive the siege directly). */
function clearDefenders(w: WorldState, factionId: string): void {
  for (const a of Object.values(w.armies)) {
    if (a.factionId !== factionId) continue;
    a.status = 'camped';
    a.order = { kind: 'idle' };
    a.x = 2900;
    a.z = -2900;
  }
}

/** An engineer formation camped outside a settlement with a besiege order, siege begun. */
function engineersAt(w: WorldState, settlementId: string, factionId = 'heartland', formations = 1): ArmyState {
  const s = w.settlements[settlementId]!;
  const a = place(w, 'army_eng', factionId, s.x + s.radius + 100, s.z, [{ unitClass: 'engineers', formations }]);
  a.order = { kind: 'besiege', settlementId };
  beginSiege(w, a, s, [], getRegionHeightfield(w));
  return a;
}

describe('wall damage (DESIGN_SPEC §7.8)', () => {
  it('Giridurg has 3 x 1,000 x 1.4 = 4,200 wallHp', () => {
    const w = campaign(5);
    const g = w.settlements.giridurg!;
    expect(g.fortLevel).toBe(3);
    expect(FACTIONS.highland!.modifiers.fortDefense).toBe(1.4);
    expect(maxWallHp(w, g)).toBeCloseTo(4200, 6);
    expect(g.wallHp).toBeCloseTo(4200, 6);
  });

  it('one engineer formation does 40 x 4 x 0.5 x siegeStrength per day; elephants add 8 x 5 x 0.5', () => {
    const w = campaign(5);
    const ss = factionMod(w, 'heartland', 'siegeStrength');
    const eng = place(w, 'army_e', 'heartland', 0, 0, [{ unitClass: 'engineers', formations: 1 }]);
    expect(UNITS.engineers.stats.menPerFormation * UNITS.engineers.stats.siege * RULES.siege.damageScale).toBe(80);
    expect(wallDamagePerDay(w, eng)).toBeCloseTo(80 * ss, 6);
    const ele = place(w, 'army_el', 'heartland', 0, 0, [{ unitClass: 'war_elephants', formations: 1 }]);
    expect(wallDamagePerDay(w, ele) / ss).toBeCloseTo(20, 6);
  });

  it('Giridurg falls in ~52 days (x siegeStrength) to one engineer formation: breach at 50%, ladders in 5 days', () => {
    const w = campaign(5);
    clearDefenders(w, 'highland');
    const g = w.settlements.giridurg!;
    const ss = factionMod(w, 'heartland', 'siegeStrength');
    const a = engineersAt(w, 'giridurg');
    expect(a.status).toBe('besieging');
    expect(g.besiegedBy).toBe(a.id);
    expect(besiegers(w, g).map((x) => x.id)).toEqual([a.id]);
    expect(assaultState(w, g).available).toBe(false);
    let breachDay = -1;
    let laddersDay = -1;
    let day = 0;
    while (g.wallHp > 0 && day < 120) {
      const out: SimEvent[] = [];
      updateSiegesDaily(w, out);
      day++;
      if (breachDay < 0 && out.some((e) => e.kind === 'siege_breach' && e.settlementId === 'giridurg')) breachDay = day;
      if (laddersDay < 0 && g.ladderProgress >= 1) laddersDay = day;
    }
    expect(g.ownerFactionId).toBe('highland'); // walls down is not a capture: the assault decides
    expect(day * ss).toBeGreaterThan(50);
    expect(day * ss).toBeLessThan(55);
    expect(day).toBe(Math.ceil(4200 / (80 * ss)));
    expect(breachDay).toBe(Math.ceil(2100 / (80 * ss)));
    expect(laddersDay).toBe(RULES.siege.ladderDays);
    expect(g.siegeDays).toBe(day);
    const st = assaultState(w, g);
    expect(st.breach && st.ladders && st.available).toBe(true);
  });

  it('assault is refused before a breach or ladders, then opens a siege battle against the defenders', () => {
    const w = campaign(5);
    clearDefenders(w, 'highland');
    const g = w.settlements.giridurg!;
    const hf = getRegionHeightfield(w);
    const a = engineersAt(w, 'giridurg');
    // A defending garrison formation.
    g.garrison = [{ ...w.armies.army_giri!.units[0]!, id: 'unit_garrison_test' }];
    const out: SimEvent[] = [];
    orderArmy(w, a.id, { kind: 'assault', settlementId: 'giridurg' }, hf);
    updateArmiesHourly(w, out, hf);
    expect(a.engagementId).toBeNull();
    expect(a.order).toEqual({ kind: 'besiege', settlementId: 'giridurg' });
    expect(out.some((n) => n.kind === 'notification' && n.text.includes(SIEGE_REASONS.noBreach))).toBe(true);
    // Ladders after 5 days.
    for (let d = 0; d < RULES.siege.ladderDays; d++) updateSiegesDaily(w, []);
    expect(assaultState(w, g).ladders).toBe(true);
    orderArmy(w, a.id, { kind: 'assault', settlementId: 'giridurg' }, hf);
    updateArmiesHourly(w, out, hf);
    expect(a.engagementId).not.toBeNull();
    const e = w.engagements[a.engagementId!]!;
    expect(e.kind).toBe('siege');
    expect(e.settlementId).toBe('giridurg');
    expect(e.sides[1]).toContain('garrison_giridurg');
    expect(g.garrison).toEqual([]);
  });

  it('an undefended unwalled village is taken on arrival', () => {
    const w = campaign(5);
    clearDefenders(w, 'highland');
    const v = w.settlements.pashanagram!;
    expect(v.fortLevel).toBe(0);
    const a = place(w, 'army_v', 'heartland', v.x + v.radius + 300, v.z, [{ unitClass: 'spearmen', formations: 1 }]);
    const hf = getRegionHeightfield(w);
    orderArmy(w, a.id, { kind: 'besiege', settlementId: v.id }, hf);
    const out: SimEvent[] = [];
    for (let h = 0; h < 72 && v.ownerFactionId === 'highland'; h++) updateArmiesHourly(w, out, hf);
    expect(v.ownerFactionId).toBe('heartland');
    expect(out.some((e) => e.kind === 'settlement_captured' && e.settlementId === v.id)).toBe(true);
  });

  it('besieging a settlement of a faction you are at peace with is refused', () => {
    const w = campaign(5);
    const s = w.settlements.lavanapura!;
    const a = place(w, 'army_p', 'heartland', s.x + s.radius + 100, s.z, [{ unitClass: 'engineers', formations: 1 }]);
    a.order = { kind: 'besiege', settlementId: s.id };
    beginSiege(w, a, s, [], getRegionHeightfield(w));
    expect(a.order.kind).toBe('idle');
    expect(s.besiegedBy).toBeNull();
  });

  it('moving the besieger away lifts the siege', () => {
    const w = campaign(5);
    clearDefenders(w, 'highland');
    const g = w.settlements.giridurg!;
    const a = engineersAt(w, 'giridurg');
    updateSiegesDaily(w, []);
    expect(g.siegeDays).toBe(1);
    orderArmy(w, a.id, { kind: 'move', x: a.x + 500, z: a.z }, getRegionHeightfield(w));
    expect(g.besiegedBy).toBeNull();
    expect(g.siegeDays).toBe(0);
    expect(g.ladderProgress).toBe(0);
  });
});

describe('starve-out (DESIGN_SPEC §7.8)', () => {
  it('surrender chance = 0.1 x starvationDays / 10, capped at 0.6, zero while there is grain', () => {
    const w = campaign(5);
    const g = w.settlements.giridurg!;
    const curve: number[] = [];
    for (const d of [0, 1, 5, 10, 20, 40, 60, 80, 120]) {
      g.starvationDays = d;
      curve.push(surrenderChance(g));
    }
    expect(curve).toEqual([0, 0.01, 0.05, 0.1, 0.2, 0.4, 0.6, 0.6, 0.6].map((x) => expect.closeTo(x, 10)) as unknown as number[]);
  });

  it('a starving besieged fort surrenders to the besieger', () => {
    const w = campaign(5);
    clearDefenders(w, 'highland');
    const g = w.settlements.giridurg!;
    const a = engineersAt(w, 'giridurg');
    g.foodStored = 0;
    g.starvationDays = 30; // 30% a day
    let days = 0;
    const out: SimEvent[] = [];
    while (g.ownerFactionId === 'highland' && days < 60) {
      updateSiegesDaily(w, out);
      days++;
    }
    expect(g.ownerFactionId).toBe('heartland');
    expect(out.some((e) => e.kind === 'settlement_captured' && e.settlementId === 'giridurg')).toBe(true);
    expect(a.status).toBe('camped');
    expect(g.besiegedBy).toBeNull();
    expect(w.chronicle.some((c) => c.text.includes('surrendered'))).toBe(true);
  });

  it('the starve-out run is deterministic', () => {
    const run = (): number => {
      const w = campaign(9);
      clearDefenders(w, 'highland');
      const g = w.settlements.giridurg!;
      engineersAt(w, 'giridurg');
      g.foodStored = 0;
      g.starvationDays = 5;
      let days = 0;
      while (g.ownerFactionId === 'highland' && days < 200) {
        updateSiegesDaily(w, []);
        days++;
      }
      return days;
    };
    expect(run()).toBe(run());
  });
});

describe('capture: occupy / plunder / liberate (DESIGN_SPEC §7.8)', () => {
  it('capture sets loyalty 0.2, unrest +0.3, condition -0.2, loots 30% and scores the war', () => {
    const w = campaign(5);
    const g = w.settlements.giridurg!;
    const wealth = g.wealth;
    const unrest = g.unrest;
    const conds = g.buildings.map((b) => b.condition);
    const treasury = w.factions.heartland!.treasury;
    const rel = Object.values(w.diplomacy.relations).find((r) => (r.a === 'heartland' && r.b === 'highland') || (r.b === 'heartland' && r.a === 'highland'))!;
    const score = rel.warScore;
    const out: SimEvent[] = [];
    captureSettlement(w, g, 'heartland', out, 'assault');
    expect(g.ownerFactionId).toBe('heartland');
    expect(g.loyalty).toBe(RULES.siege.capturedLoyalty);
    expect(g.unrest).toBeCloseTo(Math.min(1, unrest + 0.3), 10);
    g.buildings.forEach((b, i) => expect(b.condition).toBeCloseTo(Math.max(0.1, conds[i]! - 0.2), 10));
    expect(g.wealth).toBeCloseTo(wealth * 0.7, 6);
    expect(w.factions.heartland!.treasury).toBeCloseTo(treasury + wealth * 0.3, 6);
    expect(g.occupiedSinceDay).not.toBeNull();
    expect(g.pendingCapture).toEqual({ factionId: 'heartland', day: expect.any(Number) });
    const delta = rel.a === 'heartland' ? rel.warScore - score : score - rel.warScore;
    expect(delta).toBe(RULES.diplomacy.warScore.settlement);
    expect(w.provinces[g.provinceId]!.ownerFactionId === 'heartland' || w.provinces[g.provinceId]!.capitalSettlementId !== g.id).toBe(true);
    expect(out.some((e) => e.kind === 'settlement_captured')).toBe(true);
  });

  it('occupy is the default after 10 days', () => {
    const w = campaign(5);
    const g = w.settlements.giridurg!;
    captureSettlement(w, g, 'heartland', [], 'assault');
    expect(g.pendingCapture).not.toBeNull();
    w.calendar.totalHours += 24 * CAPTURE_DECISION_DAYS;
    updateSiegesDaily(w, []);
    expect(g.pendingCapture).toBeNull();
    expect(g.ownerFactionId).toBe('heartland');
  });

  it('plunder doubles the loot, kills 10%, unrest +0.3, legitimacy -0.03, opinion -10 with everyone', () => {
    const w = campaign(5);
    const g = w.settlements.giridurg!;
    const wealth = g.wealth;
    const pop = g.population;
    const leg = w.factions.heartland!.legitimacy;
    const treasury = w.factions.heartland!.treasury;
    const opinions = Object.values(w.diplomacy.relations).filter((r) => r.a === 'heartland' || r.b === 'heartland').map((r) => r.opinion);
    captureSettlement(w, g, 'heartland', [], 'assault');
    const unrest = g.unrest;
    expect(decideCapture(w, 'highland', 'giridurg', 'plunder', [])).toBe(SIEGE_REASONS.notCaptor);
    expect(decideCapture(w, 'heartland', 'giridurg', 'liberate', [])).toBe(SIEGE_REASONS.noLiberate);
    expect(decideCapture(w, 'heartland', 'giridurg', 'plunder', [])).toBeNull();
    expect(w.factions.heartland!.treasury).toBeCloseTo(treasury + wealth * 0.6, 6);
    expect(g.wealth).toBeCloseTo(wealth * 0.4, 6);
    expect(g.population).toBeCloseTo(pop * 0.9, 6);
    expect(g.unrest).toBeCloseTo(Math.min(1, unrest + 0.3), 10);
    expect(w.factions.heartland!.legitimacy).toBeCloseTo(Math.max(0, leg - 0.03), 10);
    const after = Object.values(w.diplomacy.relations).filter((r) => r.a === 'heartland' || r.b === 'heartland').map((r) => r.opinion);
    after.forEach((o, i) => expect(o).toBe(Math.max(-100, opinions[i]! - 10)));
    expect(decideCapture(w, 'heartland', 'giridurg', 'occupy', [])).toBe(SIEGE_REASONS.noCapture);
  });

  it('liberating a settlement free at the start makes it independent again: opinion +10, prestige +10', () => {
    const w = campaign(5);
    const s = w.settlements.naukapattana!;
    expect(s.initialOwnerFactionId).toBeNull();
    const prestige = w.factions.heartland!.prestige;
    const opinions = Object.values(w.diplomacy.relations).filter((r) => r.a === 'heartland' || r.b === 'heartland').map((r) => r.opinion);
    captureSettlement(w, s, 'heartland', [], 'assault');
    expect(s.ownerFactionId).toBe('heartland');
    issue(w, { kind: 'capture_decision', settlementId: s.id, decision: 'liberate' });
    expect(s.ownerFactionId).toBeNull();
    expect(s.pendingCapture).toBeNull();
    expect(w.factions.heartland!.prestige).toBe(prestige + 10);
    const after = Object.values(w.diplomacy.relations).filter((r) => r.a === 'heartland' || r.b === 'heartland').map((r) => r.opinion);
    after.forEach((o, i) => expect(o).toBe(Math.min(100, opinions[i]! + 10)));
  });

  it("a town that changes hands sends the old owner's garrison and nearby field armies home (review B3)", () => {
    const w = campaign(1);
    const r = w.settlements.ratnapura!;
    const hh = w.armies.army_ratna!; // Household of Devavarman, camped beside Ratnapura at the start
    const royal = w.armies.army_royal!;
    const d0 = Math.hypot(hh.x - r.x, hh.z - r.z);
    expect(hh.status).toBe('camped');
    expect(d0).toBeLessThanOrEqual(r.radius + FIELD_ARMY_FALLBACK_RANGE);
    // A heartland army marching in to garrison the town and one camped just out of range.
    const inbound = place(w, 'inbound', 'heartland', r.x - 3000, r.z, [{ unitClass: 'spearmen', formations: 1 }]);
    orderArmy(w, inbound.id, { kind: 'garrison', settlementId: r.id }, getRegionHeightfield(w));
    expect(inbound.status).toBe('marching');
    const far = place(w, 'far', 'heartland', r.x, r.z + r.radius + FIELD_ARMY_FALLBACK_RANGE + 200, [{ unitClass: 'spearmen', formations: 1 }]);
    const royalOrder = JSON.stringify(royal.order);
    const out: SimEvent[] = [];
    // 'Let him go': the event transfer that stranded the Household (transfer_settlement -> transferOwnership).
    applyEffect(w, { kind: 'transfer_settlement', settlement: { kind: 'settlement', id: 'ratnapura' }, to: { kind: 'faction', id: 'forest' } }, scope(), out);
    expect(r.ownerFactionId).toBe('forest');
    for (const a of [hh, inbound]) {
      expect(a.status, a.id).toBe('marching');
      expect(['retreat', 'garrison']).toContain(a.order.kind);
      if (a.order.kind === 'garrison') expect(w.settlements[a.order.settlementId]!.ownerFactionId).toBe('heartland');
      expect(a.path.length, a.id).toBeGreaterThan(0);
    }
    expect(out.some((e) => e.kind === 'notification' && e.text === `${hh.name} falls back from ${r.name}.`)).toBe(true);
    expect(far.status).toBe('camped');
    expect(far.order.kind).toBe('idle');
    expect(JSON.stringify(royal.order)).toBe(royalOrder);
    // The Household marches home instead of starving beside a foreign town (the reviewer saw 403 -> 1 by day 255).
    for (let h = 0; h < 24 * 12 && hh.status === 'marching'; h++) updateArmiesHourly(w, [], getRegionHeightfield(w));
    expect(hh.status).not.toBe('marching');
    expect(Math.hypot(hh.x - r.x, hh.z - r.z)).toBeGreaterThan(r.radius + FIELD_ARMY_FALLBACK_RANGE);
    // Home: inside or beside an own settlement (supply rule 1: within 400 m + its radius).
    const home = Object.values(w.settlements).filter((t) => t.ownerFactionId === 'heartland' && Math.hypot(hh.x - t.x, hh.z - t.z) <= t.radius + 400);
    expect(home.length, `${hh.status} at ${hh.x.toFixed(0)},${hh.z.toFixed(0)}`).toBeGreaterThan(0);
  });

  it('the army that liberates a town keeps its position and orders', () => {
    const w = campaign(5);
    const s = w.settlements.naukapattana!;
    const a = place(w, 'liberators', 'heartland', s.x + s.radius + 100, s.z, [{ unitClass: 'spearmen', formations: 2 }]);
    captureSettlement(w, s, 'heartland', [], 'assault');
    issue(w, { kind: 'capture_decision', settlementId: s.id, decision: 'liberate' });
    expect(s.ownerFactionId).toBeNull();
    expect(a.status).toBe('camped');
    expect(a.order.kind).toBe('idle');
    expect(a.x).toBeCloseTo(s.x + s.radius + 100, 6);
  });

  it('a raider AI plunders what it takes; losing the last settlement ends a faction', () => {
    const w = campaign(5);
    const s = w.settlements.dhanyagram!;
    const pop = s.population;
    captureSettlement(w, s, 'frontier', [], 'assault');
    expect(w.factions.frontier!.ai.personality).toBe('raider');
    expect(s.population).toBeCloseTo(pop * 0.9, 6);
    expect(s.pendingCapture).toBeNull();
    // The forest realm falls with its two settlements.
    for (const id of ['gajavana', 'nilavanapura']) captureSettlement(w, w.settlements[id]!, 'heartland', [], 'assault');
    expect(w.factions.forest!.alive).toBe(false);
    expect(Object.values(w.armies).some((a) => a.factionId === 'forest')).toBe(false);
  });
});

describe('siege logistics in the real tick (review S1, DESIGN_SPEC §7.8 rule 1, rule 2 and "Siege logistics")', () => {
  /** Seed 5, every highland field army removed (an uncontested siege), heartland engineers besieging Giridurg. */
  function fedSiege(depotFood: number): { w: WorldState; a: ArmyState; depotId: string } {
    const w = campaign(5);
    for (const x of Object.values(w.armies)) if (x.factionId === 'highland') delete w.armies[x.id];
    const a = engineersAt(w, 'giridurg');
    w.factions.heartland!.foodReserve = 0;
    const depotId = 'depot_siege';
    // A depot 70 m from the siege camp (the reviewer's probe: a full one changed nothing).
    w.depots[depotId] = { id: depotId, factionId: 'heartland', x: a.x + 70, z: a.z, settlementId: null, food: depotFood, capacity: RULES.supply.depot.capacity, condition: 1, escortArmyId: null, raided: false, readyOnDay: 0 };
    return { w, a, depotId };
  }

  /** Run whole days of the real tick until the walls are down; returns the day count and the per-day record. */
  function siegeUntilWallsDown(w: WorldState, a: ArmyState, depotId: string, maxDays = 120): { day: number; starvedDays: number; formulaDay: number; depotDraw: number[] } {
    const g = w.settlements.giridurg!;
    let day = 0;
    let starvedDays = 0;
    let formulaDay = -1;
    let cumulative = 0;
    const depotDraw: number[] = [];
    while (g.wallHp > 0 && day < maxDays) {
      const depot0 = w.depots[depotId]!.food;
      runDays(w, 1);
      day++;
      expect(a.status).toBe('besieging');
      expect(a.supply.sourceId).toBe(depotId);
      expect(a.supply.lineIntact).toBe(true);
      expect(a.supply.foraging).toBe(false);
      if (a.supply.starvationDays > 0) starvedDays++;
      depotDraw.push(depot0 - w.depots[depotId]!.food);
      // Wall damage/day = Σ soldiers x siege x 0.5 x siegeStrength with the soldiers of that day (siege attrition included).
      cumulative += wallDamagePerDay(w, a);
      if (formulaDay < 0 && cumulative >= 4200 - 1e-6) formulaDay = day;
    }
    return { day, starvedDays, formulaDay, depotDraw };
  }

  it('one engineer formation fed by a depot brings Giridurg down with no starvation; the depot pays its daily need', () => {
    const { w, a, depotId } = fedSiege(RULES.supply.depot.capacity);
    const ss = factionMod(w, 'heartland', 'siegeStrength');
    const r = siegeUntilWallsDown(w, a, depotId);
    expect(r.starvedDays).toBe(0);
    expect(a.units[0]!.soldiers).toBeGreaterThan(25);
    // The walls fall on the day the §7.8 formula says, with the soldiers the 0.4%/day siege attrition leaves.
    expect(r.day).toBe(r.formulaDay);
    // 47.7 days at full strength for siegeStrength 1.1 (52.5 at 1); siege attrition thins the formation -> 49-55 days
    // at 1.1 on seeds 1-6 (54-61 at siegeStrength 1). Seed 5: day 51.
    expect(r.day).toBeGreaterThanOrEqual(Math.ceil(4200 / (80 * ss)));
    expect(r.day * ss).toBeLessThan(61);
    // The depot refills what the army ate the day before: never more than a full formation's need, and over the siege
    // about the need of the soldiers left.
    const fullNeed = (40 * UNITS.engineers.stats.upkeepFood * BALANCE.military.soldierFoodPerDay) / factionMod(w, 'heartland', 'supplyEfficiency');
    let total = 0;
    for (const draw of r.depotDraw) {
      expect(draw).toBeGreaterThanOrEqual(0);
      expect(draw).toBeLessThanOrEqual(fullNeed + 1e-6);
      total += draw;
    }
    expect(total).toBeGreaterThan(0.8 * r.day * armyFoodNeed(w, a));
  });

  it('without the 0.4%/day siege attrition the fed formation takes exactly 4,200 / (80 x siegeStrength) days (52.5 at 1)', () => {
    const att = RULES.supply.attrition as { siege: number };
    const siegeAttrition = att.siege;
    att.siege = 0;
    try {
      const { w, a, depotId } = fedSiege(RULES.supply.depot.capacity);
      const ss = factionMod(w, 'heartland', 'siegeStrength');
      const r = siegeUntilWallsDown(w, a, depotId);
      expect(r.starvedDays).toBe(0);
      expect(a.units[0]!.soldiers).toBe(40);
      expect(r.day).toBe(Math.ceil(4200 / (80 * ss)));
      expect(r.day * ss).toBeGreaterThan(52);
      expect(r.day * ss).toBeLessThan(53);
    } finally {
      att.siege = siegeAttrition;
    }
  });

  it('besiegers with no depot forage / plunder the town; an empty depot does not count as a source', () => {
    const { w, a, depotId } = fedSiege(0);
    const g = w.settlements.giridurg!;
    const store = g.foodStored;
    runDays(w, 1);
    expect(a.supply.foraging).toBe(true);
    expect(a.supply.lineIntact).toBe(false);
    expect(a.supply.sourceId).toBeNull();
    expect(w.depots[depotId]!.food).toBe(0);
    expect(g.foodStored).toBeLessThan(store);
  });

  it('a host garrisoned in its besieged town eats from the store (no floor) and loses no one to hunger while it lasts', () => {
    const run = (withHost: boolean): { w: WorldState; host: ArmyState; stores: number[] } => {
      const w = campaign(5);
      const g = w.settlements.giridurg!;
      const host = w.armies.army_giri!; // Host of the Seven Peaks, 732
      for (const x of Object.values(w.armies)) if (x.factionId === 'highland' && x.id !== host.id) delete w.armies[x.id];
      if (withHost) {
        Object.assign(host, { x: g.x, z: g.z, status: 'garrisoned', order: { kind: 'garrison', settlementId: g.id }, path: [], pathIndex: 0 });
      } else delete w.armies[host.id];
      const a = engineersAt(w, 'giridurg');
      w.depots.depot_siege = { id: 'depot_siege', factionId: 'heartland', x: a.x + 70, z: a.z, settlementId: null, food: 6000, capacity: 6000, condition: 1, escortArmyId: null, raided: false, readyOnDay: 0 };
      const stores: number[] = [];
      for (let d = 0; d < 30; d++) {
        runDays(w, 1);
        stores.push(g.foodStored);
      }
      return { w, host, stores };
    };
    const A = run(true);
    const B = run(false);
    const g = A.w.settlements.giridurg!;
    expect(g.besiegedBy).toBe('army_eng');
    expect(A.host.status).toBe('garrisoned');
    const need = armyFoodNeed(A.w, A.host);
    expect(need).toBeGreaterThan(140);
    // It is part of the town's consumption: reserve days, prices and starve-out all see it.
    expect(garrisonedArmyFood(A.w, g)).toBeCloseTo(need, 6);
    expect(dailyConsumption(A.w, g)).toBeCloseTo(dailyConsumption(B.w, B.w.settlements.giridurg!) + need, 3);
    // No hunger and no losses while the store lasts; its own train is untouched.
    expect(A.host.units.reduce((n, u) => n + u.soldiers, 0)).toBe(732);
    expect(A.host.supply.starvationDays).toBe(0);
    expect(A.host.supply.food).toBeCloseTo(A.host.supply.foodCapacity, 6);
    // The store falls by the host's need each day (against the same siege without the host).
    for (let d = 1; d < 30; d++) {
      const extra = A.stores[d - 1]! - A.stores[d]! - (B.stores[d - 1]! - B.stores[d]!);
      // (minus the spoilage the smaller store saves: 0.08%/day of the difference)
      const saved = 0.001 * (B.stores[d - 1]! - A.stores[d - 1]!);
      expect(extra).toBeLessThanOrEqual(need + 1e-6);
      expect(extra).toBeGreaterThan(need - saved - 0.01);
    }
  });

  it('when the besieged store runs out the garrisoned host lives on its train, then starves with the town', () => {
    const w = campaign(5);
    const g = w.settlements.giridurg!;
    const host = w.armies.army_giri!;
    for (const x of Object.values(w.armies)) if (x.factionId === 'highland' && x.id !== host.id) delete w.armies[x.id];
    Object.assign(host, { x: g.x, z: g.z, status: 'garrisoned', order: { kind: 'garrison', settlementId: g.id }, path: [], pathIndex: 0 });
    const a = engineersAt(w, 'giridurg');
    w.depots.depot_siege = { id: 'depot_siege', factionId: 'heartland', x: a.x + 70, z: a.z, settlementId: null, food: 6000, capacity: 6000, condition: 1, escortArmyId: null, raided: false, readyOnDay: 0 };
    g.foodStored = g.foodConsumption * 2;
    const train = host.supply.food;
    runDays(w, 4);
    expect(g.foodStored).toBe(0);
    expect(g.starvationDays).toBeGreaterThan(0);
    expect(host.supply.starvationDays).toBe(0);
    expect(host.supply.food).toBeLessThan(train);
    host.supply.food = 0;
    runDays(w, 1);
    expect(g.ownerFactionId).toBe('highland');
    expect(host.supply.starvationDays).toBeGreaterThan(0);
  });

  it('a host camped outside an own town keeps the 30-day floor (no draw below it); garrisoned inside, it eats', () => {
    const w = campaign(1);
    const r = w.settlements.rajapura!;
    const royal = w.armies.army_royal!; // camped beside Rajapura
    expect(royal.status).toBe('camped');
    expect(Math.hypot(royal.x - r.x, royal.z - r.z)).toBeLessThanOrEqual(r.radius + RULES.supply.resupplyRadius);
    w.events.scheduled = [];
    w.factions.heartland!.foodReserve = 0;
    r.foodStored = 25 * r.foodConsumption;
    royal.supply.food = armyFoodNeed(w, royal) * 2;
    const twin = campaign(1);
    twin.events.scheduled = [];
    twin.factions.heartland!.foodReserve = 0;
    twin.settlements.rajapura!.foodStored = r.foodStored;
    delete twin.armies.army_royal;
    for (let d = 0; d < 4; d++) {
      runDays(w, 1);
      runDays(twin, 1);
    }
    // Below 30 days: the camped host takes nothing (the town's store moves as if it were not there) and starves.
    expect(r.foodStored).toBeCloseTo(twin.settlements.rajapura!.foodStored, 3);
    expect(royal.supply.food).toBe(0);
    expect(royal.supply.starvationDays).toBeGreaterThan(0);
    // Garrisoned inside the walls it is part of the garrison: it eats from the store and the hunger ends.
    orderArmy(w, royal.id, { kind: 'garrison', settlementId: 'rajapura' }, getRegionHeightfield(w));
    runDays(w, 2, { until: () => royal.status === 'garrisoned' });
    expect(royal.status).toBe('garrisoned');
    runDays(w, 1);
    expect(royal.supply.starvationDays).toBe(0);
    expect(r.foodConsumption).toBeCloseTo(dailyConsumption(twin, twin.settlements.rajapura!) + armyFoodNeed(w, royal), -1);
  });

  it("the player's conquest path by commands, campaign AI active: a depot by the camp feeds the Royal Host until Giridurg falls", () => {
    // Lead review (round 2): the tests above clear Giridurga's armies; this one plays the path the player has - the
    // Royal Host with one engineer formation is ordered to besiege, then create_depot behind the camp and
    // requisition_grain from Rajapura (topped up when it runs low) - while every realm's AI and event keeps running.
    const w = campaign(1);
    const host = w.armies.army_royal!;
    const eng = makeArmy(w, 'army_tmp', 'tmp', 'heartland', host.x, host.z, [{ unitClass: 'engineers', formations: 1 }], null);
    host.units.push(...eng.units);
    issue(w, { kind: 'army_order', armyId: host.id, order: { kind: 'besiege', settlementId: 'giridurg' } });
    const g = w.settlements.giridurg!;
    runDays(w, 10, { until: () => host.status === 'besieging' });
    expect(host.status).toBe('besieging');
    expect(g.besiegedBy).toBe(host.id);
    // The depot 150 m behind the camp (away from the walls): an enemy army within 300 m would refuse it.
    const len = Math.hypot(host.x - g.x, host.z - g.z);
    const x = host.x + ((host.x - g.x) / len) * 150;
    const z = host.z + ((host.z - g.z) / len) * 150;
    issue(w, { kind: 'create_depot', x, z, settlementId: null });
    const depotId = Object.keys(w.depots).find((id) => w.depots[id]!.factionId === 'heartland' && Math.hypot(w.depots[id]!.x - x, w.depots[id]!.z - z) < 1);
    expect(depotId).toBeDefined();
    const depot = w.depots[depotId as string]!;
    let fedDays = 0;
    let wallsDownDay = -1;
    for (let day = 0; day < 90 && wallsDownDay < 0; day++) {
      if (depot.food < 1500) {
        const amount = Math.floor(Math.min(depot.capacity - depot.food, 0.5 * w.settlements.rajapura!.foodStored));
        issue(w, { kind: 'requisition_grain', settlementId: 'rajapura', amount, toArmyId: null, toDepotId: depot.id });
      }
      runDays(w, 1);
      expect(host.status).toBe('besieging');
      if (depot.readyOnDay < w.calendar.totalHours / 24 && depot.food > 0) {
        // Rule 2 every day the depot is ready and holds grain: the siege camp is fed, never hungry.
        expect(host.supply.sourceId).toBe(depot.id);
        expect(host.supply.foraging).toBe(false);
        expect(host.supply.starvationDays).toBe(0);
        fedDays++;
      }
      if (g.wallHp <= 0) wallsDownDay = day;
    }
    // Engineers (88/day for Suvarna) + 8 war elephants (22/day): ~40 days at full strength, more with siege attrition.
    expect(wallsDownDay).toBeGreaterThan(30);
    expect(wallsDownDay).toBeLessThan(70);
    expect(fedDays).toBeGreaterThan(wallsDownDay - 8);
    expect(host.units.some((u) => u.unitClass === 'engineers' && u.soldiers > 0)).toBe(true);
  });
});
