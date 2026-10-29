/**
 * SIM-01 phase C: strategic armies (DESIGN_SPEC §7.7, §7.8 supply). OWNER: Simulation Engineer - Strategic World
 * Simulation.
 *
 * Travel times on the broken_crown map, fords closing in flood, the Royal Host's food sums, marching / arrival,
 * forced march, split / merge / disband, visibility + ghosts, contacts and stances, and the daily supply rules
 * (resupply from an own store, foraging, starvation).
 */
import { describe, expect, it } from 'vitest';
import type { ArmyState, SimEvent, WorldState } from '../../../src/core/types';
import { BALANCE } from '../../../src/data/balance';
import { RULES } from '../../../src/data/rules';
import { getRegionHeightfield } from '../../../src/sim/strategic/world';
import { armySpeedMultiplier, edgeHours, edgeUsable, metersPerHourFromKmDay, offRoadHours, planRoute } from '../../../src/sim/strategic/pathing';
import {
  ARMY_REASONS,
  armySoldiers,
  carriedCapacity,
  detectContacts,
  disbandArmy,
  makeArmy,
  makeArmyUnit,
  mergeArmies,
  orderArmy,
  rawFoodNeed,
  splitArmy,
  updateArmiesDaily,
  updateArmiesHourly,
} from '../../../src/sim/strategic/armies';
import { armyFoodNeed, supplyDays } from '../../../src/sim/strategic/supply';
import { estimatedSoldiers, expireGhostsDaily, GHOST_DAYS, sees, updateVisibilityHourly } from '../../../src/sim/strategic/visibility';
import { factionMod } from '../../../src/sim/strategic/modifiers';
import { campaign, issue, runHours } from './helpers';

const M = BALANCE.military;

function infantry(w: WorldState, factionId = 'heartland'): Pick<ArmyState, 'factionId' | 'units'> {
  return { factionId, units: [makeArmyUnit(w, 'spearmen')] };
}

function route(w: WorldState, from: string, to: string, roads = true): ReturnType<typeof planRoute> {
  const a = w.settlements[from]!;
  const b = w.settlements[to]!;
  return planRoute(w, infantry(w), a.x, a.z, b.x, b.z, getRegionHeightfield(w), { roads });
}

/** Spec edge formula: length x travelScale / (marchKmPerDay[q] x 1000 / 24) / (0.5 + 0.5 x condition). */
function specEdgeHours(w: WorldState, id: string): number {
  const e = w.roads.edges[id]!;
  return (e.length * M.travelScale) / ((M.marchKmPerDay[e.quality] * 1000) / 24) / (0.5 + 0.5 * e.condition);
}

/** A loose army placed on the map at (x, z). */
function place(w: WorldState, id: string, factionId: string, x: number, z: number, units: { unitClass: Parameters<typeof makeArmyUnit>[1]; formations: number }[]): ArmyState {
  const a = makeArmy(w, id, id, factionId, x, z, units, null);
  w.armies[id] = a;
  return a;
}

function setWar(w: WorldState, a: string, b: string, atWar: boolean): void {
  for (const r of Object.values(w.diplomacy.relations)) {
    if ((r.a === a && r.b === b) || (r.a === b && r.b === a)) r.atWar = atWar;
  }
}

describe('travel times (DESIGN_SPEC §7.7 examples)', () => {
  it('Rajapura -> Setupur takes about one day along the royal road', () => {
    const w = campaign(5);
    const r = route(w, 'rajapura', 'setupur');
    expect(r.ok).toBe(true);
    expect(r.edges).toEqual(['road_1']);
    expect(w.roads.edges.road_1!.quality).toBe('royal_road');
    const days = r.hours / 24;
    expect(days).toBeGreaterThan(0.9);
    expect(days).toBeLessThan(1.3);
  });

  it('Rajapura -> Giridurg by road follows the spec edge formula (~3.4 days for 81 km of road; this map routes 114 km)', () => {
    const w = campaign(5);
    const r = route(w, 'rajapura', 'giridurg');
    expect(r.ok).toBe(true);
    const roadHours = r.edges.reduce((h, id) => h + specEdgeHours(w, id), 0);
    // The planner's road hours are exactly the spec formula (plus the short off-road legs to the nodes).
    expect(r.hours).toBeGreaterThanOrEqual(roadHours - 1e-6);
    expect(r.hours - roadHours).toBeLessThan(6);
    // The spec's 81 km of 'road' (24 km/day) is 3.4 days.
    expect((81 / M.marchKmPerDay.road)).toBeCloseTo(3.375, 2);
    const days = r.hours / 24;
    expect(days).toBeGreaterThan(3.2);
    expect(days).toBeLessThan(4.6);
  });

  it('Across country takes about twice as long as by road (81 km of open ground = 6.75 days)', () => {
    const w = campaign(5);
    const road = route(w, 'rajapura', 'giridurg');
    const xc = route(w, 'rajapura', 'giridurg', false);
    expect(xc.ok).toBe(true);
    expect(xc.edges).toEqual([]);
    // Open ground: 81 km at 12 km/day.
    const mph = metersPerHourFromKmDay(M.marchKmPerDay.offroad);
    expect(81000 / M.travelScale / mph / 24).toBeCloseTo(6.75, 2);
    const ratio = xc.hours / road.hours;
    expect(ratio).toBeGreaterThan(1.6);
    expect(ratio).toBeLessThan(2.6);
    // The cross-country route bridges / fords the river (the straight line is deep water away from any crossing).
    const a = w.settlements.rajapura!;
    const b = w.settlements.giridurg!;
    expect(offRoadHours(w, infantry(w), getRegionHeightfield(w), a.x, a.z, b.x, b.z)).toBe(Infinity);
    expect(xc.points.length).toBeGreaterThan(2);
  });

  it('fords close while the flood is above 0.5 and routes avoid them', () => {
    const w = campaign(5);
    const ford = Object.values(w.roads.edges).find((e) => e.ford)!;
    expect(ford).toBeTruthy();
    const army = infantry(w);
    w.weather.flood = 0.4;
    expect(edgeUsable(w, army, ford)).toBe(true);
    expect(edgeHours(w, army, ford)).toBeLessThan(Infinity);
    const na = w.roads.nodes[ford.a]!;
    const nb = w.roads.nodes[ford.b]!;
    const hf = getRegionHeightfield(w);
    const dry = planRoute(w, army, na.x, na.z, nb.x, nb.z, hf);
    expect(dry.edges).toContain(ford.id);
    w.weather.flood = 0.6;
    expect(edgeUsable(w, army, ford)).toBe(false);
    expect(edgeHours(w, army, ford)).toBe(Infinity);
    const wet = planRoute(w, army, na.x, na.z, nb.x, nb.z, hf);
    expect(wet.edges).not.toContain(ford.id);
    expect(wet.hours).toBeGreaterThan(dry.hours);
  });

  it('weak bridges do not carry carts, elephants or chariots', () => {
    const w = campaign(5);
    const bridge = w.roads.edges.road_1!;
    expect(bridge.bridge).toBe(true);
    bridge.condition = 0.2;
    expect(edgeUsable(w, infantry(w), bridge)).toBe(true);
    expect(edgeUsable(w, { factionId: 'heartland', units: [makeArmyUnit(w, 'supply_train')] }, bridge)).toBe(false);
  });

  it('a hostile army camped on a road blocks it', () => {
    const w = campaign(5);
    const e = w.roads.edges.road_12!;
    const mid = e.points[Math.floor(e.points.length / 2)]!;
    place(w, 'army_block', 'highland', mid.x, mid.z, [{ unitClass: 'spearmen', formations: 1 }]);
    setWar(w, 'heartland', 'highland', true);
    runHours(w, 24, { autoEvents: false, autoEngagements: false }); // roads block at the day rollover
    expect(e.blockedBy).toBe('army_block');
    expect(edgeUsable(w, infantry(w), e)).toBe(false);
    expect(edgeUsable(w, infantry(w, 'highland'), e)).toBe(true);
  });
});

describe('the Royal Host (DESIGN_SPEC §7.8 example)', () => {
  it('eats ~195 grain/day and carries 4,575 (~23 days raw; faction supply efficiency stretches it)', () => {
    const w = campaign(5);
    const host = w.armies.army_royal!;
    expect(armySoldiers(host)).toBe(820);
    expect(rawFoodNeed(host.units)).toBeCloseTo(195, 6);
    expect(carriedCapacity(host.units)).toBe(4575);
    expect(host.supply.food).toBe(4575);
    expect(4575 / rawFoodNeed(host.units)).toBeCloseTo(23.46, 1);
    const eff = factionMod(w, 'heartland', 'supplyEfficiency');
    expect(armyFoodNeed(w, host)).toBeCloseTo(195 / eff, 6);
    expect(supplyDays(w, host)).toBeCloseTo((4575 * eff) / 195, 6);
  });
});

describe('marching', () => {
  it('an ordered army marches its planned route at its pace and arrives when the plan says', () => {
    const w = campaign(5);
    const s = w.settlements.setupur!;
    const host = w.armies.army_royal!;
    const plan = planRoute(w, host, host.x, host.z, s.x + 150, s.z, getRegionHeightfield(w));
    expect(plan.edges).toContain('road_1');
    // Slowest category: the supply train (support pace 0.85).
    const mul = armySpeedMultiplier(w, host, false);
    expect(mul).toBeCloseTo(0.85 * factionMod(w, 'heartland', 'marchSpeed'), 6);
    issue(w, { kind: 'move_army', armyId: host.id, x: s.x + 150, z: s.z });
    expect(host.status).toBe('marching');
    expect(host.path[0]).toEqual({ x: plan.points[0]!.x, z: plan.points[0]!.z });
    let arrivedAt = -1;
    const start = w.calendar.totalHours;
    runHours(w, 24 * 5, {
      onHour: (out) => {
        if (arrivedAt < 0 && out.some((e) => e.kind === 'army_arrived' && e.armyId === host.id)) arrivedAt = w.calendar.totalHours - start;
      },
      until: () => arrivedAt >= 0,
    });
    const expected = plan.hours / mul;
    expect(arrivedAt).toBeGreaterThan(expected * 0.85);
    expect(arrivedAt).toBeLessThan(expected * 1.2 + 2);
    expect(host.status).toBe('camped');
    expect(Math.hypot(host.x - (s.x + 150), host.z - s.z)).toBeLessThan(1);
  });

  it('forced march is 30% faster', () => {
    const go = (forced: boolean): number => {
      const w = campaign(5);
      const hf = getRegionHeightfield(w);
      const a = place(w, 'army_t', 'heartland', w.settlements.rajapura!.x, w.settlements.rajapura!.z, [{ unitClass: 'spearmen', formations: 1 }]);
      a.forcedMarch = forced;
      orderArmy(w, a.id, { kind: 'move', x: w.settlements.setupur!.x, z: w.settlements.setupur!.z }, hf);
      const out: SimEvent[] = [];
      for (let h = 0; h < 6; h++) updateArmiesHourly(w, out, hf);
      return Math.hypot(a.x - w.settlements.rajapura!.x, a.z - w.settlements.rajapura!.z);
    };
    const normal = go(false);
    const forced = go(true);
    expect(forced / normal).toBeGreaterThan(1.2);
    expect(forced / normal).toBeLessThan(1.4);
  });

  it('a settlement order camps outside the walls (besiege) and garrison orders garrison', () => {
    const w = campaign(5);
    const hf = getRegionHeightfield(w);
    const r = w.settlements.rajapura!;
    const a = place(w, 'army_g', 'heartland', r.x + 300, r.z, [{ unitClass: 'spearmen', formations: 1 }]);
    orderArmy(w, a.id, { kind: 'garrison', settlementId: 'rajapura' }, hf);
    const out: SimEvent[] = [];
    for (let h = 0; h < 72 && a.status === 'marching'; h++) updateArmiesHourly(w, out, hf);
    expect(a.status).toBe('garrisoned');
    expect(a.x).toBe(r.x);
  });
});

describe('split / merge / disband (DESIGN_SPEC §7.7)', () => {
  it('splits formations into a new army with a share of the food, then merges them back', () => {
    const w = campaign(5);
    const host = w.armies.army_royal!;
    const before = armySoldiers(host);
    const food = host.supply.food;
    const ids = host.units.slice(0, 2).map((u) => u.id);
    expect(splitArmy(w, 'heartland', host.id, []).reason).toBe(ARMY_REASONS.noUnits);
    expect(splitArmy(w, 'heartland', host.id, host.units.map((u) => u.id)).reason).toBe(ARMY_REASONS.keepOne);
    expect(splitArmy(w, 'highland', host.id, ids).reason).toBe(ARMY_REASONS.notYours);
    const res = splitArmy(w, 'heartland', host.id, ids);
    expect(res.reason).toBeNull();
    const det = w.armies[res.armyId!]!;
    expect(det.units.map((u) => u.id)).toEqual(ids);
    expect(det.commanderId).toBeNull();
    expect(armySoldiers(host) + armySoldiers(det)).toBe(before);
    expect(host.supply.food + det.supply.food).toBeCloseTo(food, 6);
    // Merge back.
    det.x = host.x + 500;
    expect(mergeArmies(w, 'heartland', host.id, det.id)).toBe(ARMY_REASONS.tooFar);
    det.x = host.x + 50;
    expect(mergeArmies(w, 'heartland', host.id, det.id)).toBeNull();
    expect(w.armies[det.id]).toBeUndefined();
    expect(armySoldiers(host)).toBe(before);
    expect(host.supply.food).toBeCloseTo(food, 6);
  });

  it('disbanding returns half the soldiers to the nearest own recruit pool', () => {
    const w = campaign(5);
    const r = w.settlements.rajapura!;
    r.recruitPool = 0;
    const a = place(w, 'army_d', 'heartland', r.x + 50, r.z, [{ unitClass: 'spearmen', formations: 2 }]);
    const out: SimEvent[] = [];
    expect(disbandArmy(w, 'highland', a.id, out)).toBe(ARMY_REASONS.notYours);
    expect(disbandArmy(w, 'heartland', a.id, out)).toBeNull();
    expect(w.armies[a.id]).toBeUndefined();
    expect(r.recruitPool).toBe(Math.min(r.recruitmentPotential, 120));
  });

  it('split / merge / disband commands go through the world', () => {
    const w = campaign(5);
    const host = w.armies.army_royal!;
    const n = Object.keys(w.armies).length;
    issue(w, { kind: 'split_army', armyId: host.id, unitIds: [host.units[0]!.id] });
    expect(Object.keys(w.armies).length).toBe(n + 1);
  });
});

describe('visibility and ghosts (DESIGN_SPEC §7.7)', () => {
  it('sees enemies within scout range, leaves a ghost where they were last seen and drops it after 5 days', () => {
    const w = campaign(5);
    const hf = getRegionHeightfield(w);
    const out: SimEvent[] = [];
    for (const k of Object.keys(w.espionage.intel.heartland ?? {})) {
      w.espionage.intel.heartland![k]!.level = 0;
      w.espionage.intel.heartland![k]!.armiesVisibleUntilDay = null;
    }
    // An observer far from every heartland settlement, and a highland column marching away from it.
    const gd = w.settlements.giridurg!;
    const obs = place(w, 'army_obs', 'heartland', gd.x + 300, gd.z - 700, [{ unitClass: 'spearmen', formations: 1 }]);
    for (const s of Object.values(w.settlements)) if (s.ownerFactionId === 'heartland') expect(Math.hypot(s.x - obs.x, s.z - obs.z)).toBeGreaterThan(1000);
    const enemy = place(w, 'army_col', 'highland', obs.x + 250, obs.z, [{ unitClass: 'spearmen', formations: 1 }]);
    setWar(w, 'heartland', 'highland', false);
    const sight = RULES.armies.scoutRadius * factionMod(w, 'heartland', 'scoutRange');
    expect(sees(w, 'heartland', enemy)).toBe(true);
    updateVisibilityHourly(w, out);
    expect(enemy.visibility.heartland).toBe(1);
    orderArmy(w, enemy.id, { kind: 'move', x: obs.x + 1200, z: obs.z }, hf);
    let hours = 0;
    while (enemy.visibility.heartland === 1 && hours < 48) {
      updateArmiesHourly(w, out, hf);
      updateVisibilityHourly(w, out);
      hours++;
    }
    expect(enemy.visibility.heartland).toBe(0);
    const ghost = w.factions.heartland!.ghosts[enemy.id]!;
    expect(ghost).toBeTruthy();
    expect(ghost.soldiers).toBeGreaterThan(0);
    // The ghost marks the last seen position: inside the sight radius, behind the column.
    expect(Math.hypot(ghost.x - obs.x, ghost.z - obs.z)).toBeLessThanOrEqual(sight + 1);
    expect(Math.hypot(enemy.x - obs.x, enemy.z - obs.z)).toBeGreaterThan(sight);
    // Regaining sight clears the ghost; losing it again re-creates it; it expires after 5 days.
    enemy.x = obs.x + 100;
    updateVisibilityHourly(w, out);
    expect(w.factions.heartland!.ghosts[enemy.id]).toBeUndefined();
    enemy.x = obs.x + 1500;
    updateVisibilityHourly(w, out);
    expect(w.factions.heartland!.ghosts[enemy.id]).toBeTruthy();
    w.calendar.totalHours += 24 * (GHOST_DAYS + 1);
    expireGhostsDaily(w);
    expect(w.factions.heartland!.ghosts[enemy.id]).toBeUndefined();
  });

  it('intel >= 0.6 reveals every army of that faction with exact numbers; low intel only estimates', () => {
    const w = campaign(5);
    const enemy = place(w, 'army_far', 'highland', -2900, 2900, [{ unitClass: 'spearmen', formations: 3 }]);
    const intel = (w.espionage.intel.heartland ??= {});
    intel.highland = { ...(intel.highland ?? { level: 0, armiesVisibleUntilDay: null }), level: 0.7 } as never;
    expect(sees(w, 'heartland', enemy)).toBe(true);
    expect(estimatedSoldiers(w, 'heartland', enemy)).toBe(360);
    intel.highland!.level = 0.1;
    intel.highland!.armiesVisibleUntilDay = null;
    expect(sees(w, 'heartland', enemy)).toBe(false);
    const est = estimatedSoldiers(w, 'heartland', enemy);
    expect(est).toBeGreaterThanOrEqual(180);
    expect(est).toBeLessThanOrEqual(540);
  });
});

describe('contacts and stances (DESIGN_SPEC §7.7)', () => {
  it('hostile armies within the contact radius start an engagement; allies do not', () => {
    const w = campaign(5);
    const out: SimEvent[] = [];
    const a = place(w, 'army_x', 'heartland', 0, 2000, [{ unitClass: 'spearmen', formations: 2 }]);
    const b = place(w, 'army_y', 'highland', 0 + M.contactRadius * 0.9, 2000, [{ unitClass: 'spearmen', formations: 2 }]);
    setWar(w, 'heartland', 'highland', false);
    detectContacts(w, out);
    expect(a.engagementId).toBeNull();
    setWar(w, 'heartland', 'highland', true);
    detectContacts(w, out);
    expect(a.engagementId).not.toBeNull();
    expect(b.engagementId).toBe(a.engagementId);
    expect(out.some((e) => e.kind === 'engagement_started')).toBe(true);
  });

  it('aggressive stance widens contact (x1.3); a weak, faster cautious army evades', () => {
    const w = campaign(5);
    setWar(w, 'heartland', 'highland', true);
    const out: SimEvent[] = [];
    const a = place(w, 'army_x', 'heartland', 0, 2000, [{ unitClass: 'spearmen', formations: 2 }]);
    place(w, 'army_y', 'highland', M.contactRadius * 1.2, 2000, [{ unitClass: 'spearmen', formations: 2 }]);
    detectContacts(w, out);
    expect(a.engagementId).toBeNull();
    a.stance = 'aggressive';
    expect(RULES.armies.stance.aggressive.contactRadius).toBe(1.3);
    detectContacts(w, out);
    expect(a.engagementId).not.toBeNull();
    // Evasion: cavalry (pace 1.5) against a big infantry host.
    const w2 = campaign(5);
    setWar(w2, 'heartland', 'highland', true);
    const big = place(w2, 'army_big', 'heartland', 0, 2000, [{ unitClass: 'spearmen', formations: 6 }]);
    const riders = place(w2, 'army_riders', 'highland', 50, 2000, [{ unitClass: 'cavalry', formations: 1 }]);
    riders.stance = 'cautious';
    detectContacts(w2, []);
    expect(big.engagementId).toBeNull();
    riders.stance = 'balanced';
    detectContacts(w2, []);
    expect(big.engagementId).not.toBeNull();
  });
});

describe('daily supply (DESIGN_SPEC §7.8)', () => {
  it('an army in its own settlement refills from the store (max 20%/day, store kept above 30 days)', () => {
    const w = campaign(5);
    const r = w.settlements.rajapura!;
    const a = place(w, 'army_s', 'heartland', r.x, r.z, [{ unitClass: 'spearmen', formations: 2 }]);
    a.supply.food = 0;
    const store = r.foodStored;
    updateArmiesDaily(w, []);
    expect(a.supply.food).toBeGreaterThan(0);
    expect(r.foodStored).toBeLessThan(store);
    expect(store - r.foodStored).toBeLessThanOrEqual(store * RULES.supply.maxDrawPerDay + 1e-6);
    expect(a.supply.starvationDays).toBe(0);
  });

  it('without a source and food an army starves: morale -6/day, desertion after 3 days', () => {
    const w = campaign(5);
    // Deep in the eastern wilds, nowhere near a settlement.
    const a = place(w, 'army_lost', 'heartland', 2900, -2900, [{ unitClass: 'spearmen', formations: 2 }]);
    a.supply.food = 0;
    a.morale = 70;
    const soldiers = armySoldiers(a);
    for (let d = 0; d < 6; d++) {
      updateArmiesDaily(w, []);
      w.calendar.totalHours += 24;
    }
    expect(a.supply.starvationDays).toBeGreaterThanOrEqual(5);
    expect(a.morale).toBeLessThan(70 - 6 * 4);
    expect(armySoldiers(a)).toBeLessThan(soldiers);
  });

  it('foraging in enemy land plunders (x1.7) and damages the settlement', () => {
    const w = campaign(5);
    setWar(w, 'heartland', 'highland', true);
    const s = w.settlements.pashanagram!;
    const a = place(w, 'army_f', 'heartland', s.x + s.radius + 100, s.z, [{ unitClass: 'spearmen', formations: 2 }]);
    a.supply.food = 0;
    a.supply.foraging = true;
    a.order = { kind: 'forage' };
    const store = s.foodStored;
    const dmg = s.damage;
    updateArmiesDaily(w, []);
    expect(a.supply.food + armyFoodNeed(w, a)).toBeGreaterThan(0);
    expect(s.foodStored).toBeLessThan(store);
    expect(s.damage).toBeGreaterThan(dmg);
  });
});
