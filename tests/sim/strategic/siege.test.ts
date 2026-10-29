/**
 * SIM-01 phase C: sieges and captures (DESIGN_SPEC §7.8 "Sieges", "Capture"). OWNER: Simulation Engineer - Strategic
 * World Simulation.
 *
 * Giridurg's 4,200 wallHp against one engineer formation (~52 days at siegeStrength 1), breach + ladders -> assault
 * availability, the starve-out surrender curve, unwalled settlements taken at once, and the occupy / plunder /
 * liberate capture choices.
 */
import { describe, expect, it } from 'vitest';
import type { ArmyState, SimEvent, WorldState } from '../../../src/core/types';
import { FACTIONS } from '../../../src/data/factions';
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
import { campaign, issue } from './helpers';

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
