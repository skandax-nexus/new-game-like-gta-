/**
 * SIM-01 rework round 2, review S4: the player can see why grain does not arrive. OWNER: Simulation Engineer -
 * Strategic World Simulation.
 *
 * settlementVitals.cutOff / cutOffBy / cutOffReason(s): not in the capital's road component (no relief, no internal
 * market with the capital) and which army holds the road. armySupplyView.sourceId / sourceKind / delivering / reason(s):
 * where an army's grain comes from and why the daily draw brings nothing (DESIGN_SPEC §7.3.5, §7.7, §7.8).
 */
import { describe, expect, it } from 'vitest';
import type { ArmyState, SimEvent, WorldState } from '../../../src/core/types';
import { RULES } from '../../../src/data/rules';
import { makeArmy } from '../../../src/sim/strategic/armies';
import { updateEconomyDaily } from '../../../src/sim/strategic/economy';
import { CUT_OFF_REASONS, nearAnyRoad, nearEdge, nearestNode, provinceAtPoint, ROAD_BLOCK_RADIUS, settlementCutOff } from '../../../src/sim/strategic/network';
import { armySupplyView, settlementVitals } from '../../../src/sim/strategic/selectors';
import { armyFoodNeed, SUPPLY_SOURCE_REASONS } from '../../../src/sim/strategic/supply';
import { campaign } from './helpers';

const R = SUPPLY_SOURCE_REASONS;

function setWar(w: WorldState, a: string, b: string, atWar: boolean): void {
  for (const r of Object.values(w.diplomacy.relations)) if ((r.a === a && r.b === b) || (r.a === b && r.b === a)) r.atWar = atWar;
}

function place(w: WorldState, id: string, factionId: string, x: number, z: number, formations = 1): ArmyState {
  const a = makeArmy(w, id, id, factionId, x, z, [{ unitClass: 'spearmen', formations }], null);
  w.armies[id] = a;
  return a;
}

/** A point `t` (0..1) of the way along an edge polyline (by vertex index). */
function along(w: WorldState, edgeId: string, t: number): { x: number; z: number } {
  const pts = w.roads.edges[edgeId]!.points;
  return pts[Math.min(pts.length - 1, Math.round(t * (pts.length - 1)))]!;
}

/** A vertex of `edgeId` (from its middle outwards) within ROAD_BLOCK_RADIUS of no other road. */
function soleOn(w: WorldState, edgeId: string): { x: number; z: number } {
  for (const t of [0.5, 0.6, 0.4, 0.7, 0.3, 0.8, 0.2]) {
    const p = along(w, edgeId, t);
    const others = Object.keys(w.roads.edges).filter((id) => id !== edgeId && nearEdge(w.roads.edges[id]!, p.x, p.z, ROAD_BLOCK_RADIUS));
    if (others.length === 0) return p;
  }
  throw new Error(`no point on ${edgeId} away from the other roads`);
}

/** Broken Crown seed 5, no armies: Suvarna at war with Giridurga, at peace with everyone else. */
function emptyMap(): WorldState {
  const w = campaign(5);
  w.armies = {};
  w.events.scheduled = [];
  w.events.pending = [];
  setWar(w, 'heartland', 'highland', true);
  return w;
}

describe('settlementVitals: cut off from the capital (review S4)', () => {
  it('Setupur behind an enemy army on the Rajapura road is cut off by that army; an escort reconnects it', () => {
    const w = emptyMap();
    const p = soleOn(w, 'road_1');
    place(w, 'army_giri', 'highland', p.x, p.z);
    const v = settlementVitals(w, 'setupur')!;
    expect(v.cutOff).toBe(true);
    expect(v.cutOffBy).toBe('army_giri');
    expect(v.cutOffReason).toBe(CUT_OFF_REASONS.army);
    expect(v.cutOffReason).toBe('Cut off: an enemy army holds the road');
    // The capital and the towns on open roads are not.
    for (const id of ['rajapura', 'kusumpur', 'dhanyagram', 'ratnapura']) {
      const o = settlementVitals(w, id)!;
      expect(o.cutOff, id).toBe(false);
      expect(o.cutOffBy, id).toBeNull();
      expect(o.cutOffReasons, id).toEqual([]);
    }
    const q = along(w, 'road_1', 0.2);
    place(w, 'army_escort', 'heartland', q.x, q.z);
    expect(settlementVitals(w, 'setupur')!.cutOff).toBe(false);
  });

  it('cutOff is exactly what the economy sees: no relief reaches a cut-off town, it does once the road is open', () => {
    const run = (blocked: boolean): { relief: number; cutOff: boolean } => {
      const w = emptyMap();
      if (blocked) {
        const p = along(w, 'road_1', 0.5);
        place(w, 'army_giri', 'highland', p.x, p.z);
      }
      const s = w.settlements.setupur!;
      w.factions.heartland!.foodReserve = 20_000;
      w.factions.heartland!.policies.holdReserve = false;
      s.foodStored = 10 * s.foodConsumption;
      const cutOff = settlementVitals(w, 'setupur')!.cutOff;
      const out: SimEvent[] = [];
      updateEconomyDaily(w, out);
      return { relief: s.reliefThisMonth, cutOff };
    };
    const blocked = run(true);
    const open = run(false);
    expect(blocked.cutOff).toBe(true);
    expect(blocked.relief).toBe(0);
    expect(open.cutOff).toBe(false);
    expect(open.relief).toBeGreaterThan(0);
  });

  it('a ruined road and a town with no road through own land are cut off with their own reasons', () => {
    const w = emptyMap();
    w.roads.edges.road_1!.condition = 0.4; // below the 0.5 trade minimum
    const v = settlementVitals(w, 'setupur')!;
    expect(v.cutOff).toBe(true);
    expect(v.cutOffBy).toBeNull();
    expect(v.cutOffReasons).toEqual([CUT_OFF_REASONS.roads]);
    // A ruined road that an enemy also holds: both causes, the army first.
    const p = along(w, 'road_1', 0.5);
    place(w, 'army_giri', 'highland', p.x, p.z);
    expect(settlementVitals(w, 'setupur')!.cutOffReasons).toEqual([CUT_OFF_REASONS.army, CUT_OFF_REASONS.roads]);
    expect(settlementVitals(w, 'setupur')!.cutOffBy).toBe('army_giri');
    // Kandaravasa handed to Suvarna: its roads lead only to Giridurga and Nilavana.
    w.settlements.kandaravasa!.ownerFactionId = 'heartland';
    const k = settlementCutOff(w, w.settlements.kandaravasa!);
    expect(k).toEqual({ cutOff: true, cutOffBy: null, reasons: [CUT_OFF_REASONS.land] });
  });

  it('the blocker named lies on the way back with the fewest obstacles, whatever the army ids', () => {
    for (const [nearId, farId] of [
      ['army_a', 'army_z'],
      ['army_z', 'army_a'],
    ] as const) {
      const w = emptyMap();
      // Kusumpur <- road_4 -> Dhanyagram <- road_3 -> Rajapura: block road_2 (Kusumpur - Rajapura), road_4 and road_3.
      const a = soleOn(w, 'road_4');
      const b = soleOn(w, 'road_3');
      const c = soleOn(w, 'road_2');
      place(w, nearId, 'highland', a.x, a.z);
      place(w, farId, 'highland', b.x, b.z);
      place(w, 'army_m', 'highland', c.x, c.z);
      const v = settlementVitals(w, 'kusumpur')!;
      expect(v.cutOff).toBe(true);
      // Fewest obstacles: one blocked road (road_2, held by army_m) beats two (road_4 + road_3).
      expect(v.cutOffBy).toBe('army_m');
      // army_m marches off: road_2 is open again and Kusumpur is reconnected.
      w.armies.army_m!.status = 'marching';
      const open = settlementVitals(w, 'kusumpur')!;
      expect(open.cutOff).toBe(false);
      expect(open.cutOffBy).toBeNull();
    }
  });
});

describe('armySupplyView: source and reason (review S4)', () => {
  it('the Royal Host beside a Rajapura below 30 days with the reserve empty: both reasons, nothing delivered', () => {
    const w = emptyMap();
    const r = w.settlements.rajapura!;
    const royal = campaign(5).armies.army_royal!;
    w.armies.army_royal = royal;
    expect(Math.hypot(royal.x - r.x, royal.z - r.z)).toBeLessThanOrEqual(r.radius + RULES.supply.resupplyRadius);
    royal.supply.food = armyFoodNeed(w, royal) * 2;
    r.foodStored = 25 * r.foodConsumption;
    w.factions.heartland!.foodReserve = 0;
    const v = armySupplyView(w, 'army_royal')!;
    expect(v.sourceKind).toBe('reserve');
    expect(v.sourceId).toBe('rajapura');
    expect(v.delivering).toBe(0);
    expect(v.reason).toBe('Rajapura is below 30 days of grain');
    expect(v.reasons).toEqual(['Rajapura is below 30 days of grain', 'The royal reserve is empty']);
    // Grain in the reserve: the convoy comes (3 days of need), no reason.
    w.factions.heartland!.foodReserve = 10_000;
    const v2 = armySupplyView(w, 'army_royal')!;
    expect(v2.sourceKind).toBe('reserve');
    expect(v2.delivering).toBeGreaterThan(0);
    expect(v2.reason).toBeNull();
    expect(v2.reasons).toEqual([]);
    // Rajapura above its floor: rule 1.
    r.foodStored = 100 * r.foodConsumption;
    const v3 = armySupplyView(w, 'army_royal')!;
    expect(v3.sourceKind).toBe('settlement');
    expect(v3.sourceId).toBe('rajapura');
    expect(v3.delivering).toBeGreaterThan(0);
    expect(v3.reason).toBeNull();
    // A full train needs nothing: no reason even with an empty reserve and a hungry town.
    r.foodStored = 25 * r.foodConsumption;
    w.factions.heartland!.foodReserve = 0;
    royal.supply.food = royal.supply.foodCapacity;
    expect(armySupplyView(w, 'army_royal')!.reason).toBeNull();
  });

  it('a siege camp: no depot -> it forages the town; a depot being built, empty, then full', () => {
    const w = emptyMap();
    const g = w.settlements.giridurg!;
    const a = place(w, 'army_eng', 'heartland', g.x + g.radius + 100, g.z);
    a.status = 'besieging';
    a.order = { kind: 'besiege', settlementId: 'giridurg' };
    g.besiegedBy = a.id;
    a.supply.food = 0;
    const v = armySupplyView(w, 'army_eng')!;
    expect(v.sourceKind).toBe('forage');
    expect(v.sourceId).toBe('giridurg');
    expect(v.reason).toBe(R.noSiegeDepot);
    expect(v.reason).toBe('No depot within 400 m of the siege');
    const day = Math.floor(w.calendar.totalHours / 24);
    w.depots.depot_s = { id: 'depot_s', factionId: 'heartland', x: a.x + 70, z: a.z, settlementId: null, food: 0, capacity: 6000, condition: 1, escortArmyId: null, raided: false, readyOnDay: day + 5 };
    expect(armySupplyView(w, 'army_eng')!.reasons).toEqual([R.depotBuilding]);
    w.depots.depot_s.readyOnDay = day;
    expect(armySupplyView(w, 'army_eng')!.reasons).toEqual([R.depotEmpty]);
    w.depots.depot_s.food = 6000;
    const full = armySupplyView(w, 'army_eng')!;
    expect(full.sourceKind).toBe('depot');
    expect(full.sourceId).toBe('depot_s');
    expect(full.delivering).toBeGreaterThan(0);
    expect(full.reason).toBeNull();
  });

  it('cut off: a host by its besieged town whose roads an enemy holds; outside the realm there is no line at all', () => {
    const w = emptyMap();
    const s = w.settlements.setupur!;
    const besieger = place(w, 'army_giri', 'highland', s.x + s.radius + 60, s.z);
    besieger.status = 'besieging';
    besieger.order = { kind: 'besiege', settlementId: 'setupur' };
    s.besiegedBy = besieger.id;
    /** A spot `d` m from Setupur off the roads, in its province, with Setupur its nearest road node. */
    const spotAt = (d: number): { x: number; z: number } => {
      for (let k = 0; k < 72; k++) {
        const ang = (k / 72) * Math.PI * 2;
        const x = s.x + Math.cos(ang) * d;
        const z = s.z + Math.sin(ang) * d;
        if (nearestNode(w, x, z).id !== 'node_setupur' || provinceAtPoint(w, x, z) !== s.provinceId || nearAnyRoad(w, x, z, 150)) continue;
        return { x, z };
      }
      throw new Error(`no spot ${d} m from Setupur`);
    };
    // Within rule 1's reach of the besieged town: it cannot give, and the supply line is cut.
    const p1 = spotAt(s.radius + RULES.supply.resupplyRadius - 60);
    const host = place(w, 'army_relief', 'heartland', p1.x, p1.z);
    host.supply.food = 0;
    const v = armySupplyView(w, 'army_relief')!;
    expect(v.sourceKind).toBe('forage');
    expect(v.delivering).toBe(0);
    expect(v.reasons).toEqual([R.townBesieged('Setupur'), 'Cut off: an enemy army holds the road']);
    expect(v.reason).toBe('Setupur is besieged');
    // Beyond it: only the cut road.
    const p2 = spotAt(s.radius + RULES.supply.resupplyRadius + 60);
    host.x = p2.x;
    host.z = p2.z;
    expect(armySupplyView(w, 'army_relief')!.reasons).toEqual(['Cut off: an enemy army holds the road']);
    // Lift the siege and the line through Setupur is whole again (Setupur is the nearest own town).
    besieger.status = 'marching';
    s.besiegedBy = null;
    const lifted = armySupplyView(w, 'army_relief')!;
    expect(lifted.sourceKind).toBe('reserve');
    expect(lifted.sourceId).toBe('setupur');
    expect(lifted.reason).toBeNull();
    // Deep in Giridurga's land: no supply line can start there.
    const k = w.settlements.kandaravasa!;
    const raider = place(w, 'army_raider', 'heartland', k.x + k.radius + 200, k.z);
    raider.supply.food = 0;
    const v2 = armySupplyView(w, 'army_raider')!;
    expect(v2.sourceKind).toBe('forage');
    expect(v2.reasons).toEqual([R.outsideRealm]);
  });

  it('a host garrisoned in an empty town says so; garrisoned in a fed town it has no reason', () => {
    const w = emptyMap();
    const r = w.settlements.rajapura!;
    const host = place(w, 'army_g', 'heartland', r.x, r.z);
    host.status = 'garrisoned';
    host.order = { kind: 'garrison', settlementId: 'rajapura' };
    host.supply.food = 0;
    const fed = armySupplyView(w, 'army_g')!;
    expect(fed.sourceKind).toBe('settlement');
    expect(fed.sourceId).toBe('rajapura');
    expect(fed.reason).toBeNull();
    r.foodStored = 0;
    const empty = armySupplyView(w, 'army_g')!;
    expect(empty.sourceKind).toBe('settlement');
    expect(empty.reason).toBe('Rajapura has no grain left');
  });
});
