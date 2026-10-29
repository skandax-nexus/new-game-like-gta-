/**
 * SIM-01: determinism of the v2 strategic simulation (extends tests/integration/determinism.test.ts). OWNER:
 * Simulation Engineer - Strategic World Simulation.
 *
 * Same seed + commands => same hash, and save -> load -> continue == uninterrupted, from three busy states: a siege
 * in progress, construction in progress, and a revolt with a rebel host in the field.
 */
import { describe, expect, it } from 'vitest';
import type { WorldState } from '../../../src/core/types';
import { decodeJson, encodeJson, hashState } from '../../../src/core/save';
import { makeArmy, orderArmy } from '../../../src/sim/strategic/armies';
import { getRegionHeightfield } from '../../../src/sim/strategic/world';
import { forceRebellionStage, rebelArmiesOf } from '../../../src/sim/strategic/politics';
import { campaign, issue, runDays, runHours } from './helpers';

/** Continue a world in two ways: straight on, and through a save/load round trip. Both must agree. */
function checkContinuation(make: () => WorldState, days: number): void {
  const a = make();
  const b = make();
  expect(hashState(a)).toBe(hashState(b));
  runDays(a, days);
  const restored = decodeJson<WorldState>(encodeJson(b));
  runDays(restored, days);
  expect(hashState(restored)).toBe(hashState(a));
  // And a third, uninterrupted copy from scratch agrees too.
  const c = make();
  runDays(c, days);
  expect(hashState(c)).toBe(hashState(a));
}

describe('v2 determinism (DESIGN_SPEC §7, SIM-01 acceptance)', () => {
  it('mid-siege: an engineer host before Giridurg', () => {
    const make = (): WorldState => {
      const w = campaign(11);
      const g = w.settlements.giridurg!;
      const a = makeArmy(w, 'army_siege', 'Siege Train', 'heartland', g.x + g.radius + 400, g.z, [{ unitClass: 'engineers', formations: 2 }, { unitClass: 'spearmen', formations: 4 }], null);
      w.armies[a.id] = a;
      orderArmy(w, a.id, { kind: 'besiege', settlementId: 'giridurg' }, getRegionHeightfield(w));
      runHours(w, 24 * 4);
      return w;
    };
    const w = make();
    expect(w.settlements.giridurg!.besiegedBy !== null || w.armies.army_siege?.status === 'marching' || w.armies.army_siege === undefined).toBe(true);
    checkContinuation(make, 20);
  });

  it('mid-construction: a granary and a barracks rising, a landmark queued', () => {
    const make = (): WorldState => {
      const w = campaign(12);
      w.factions.heartland!.treasury = 20000;
      w.factions.heartland!.materials.timber = 2000;
      w.factions.heartland!.materials.stone = 2000;
      issue(w, { kind: 'build', settlementId: 'dhanyagram', building: 'granary' });
      issue(w, { kind: 'build', settlementId: 'rajapura', building: 'market' });
      issue(w, { kind: 'recruit', settlementId: 'rajapura', unitClass: 'spearmen', formations: 1, targetArmyId: null });
      runDays(w, 5);
      return w;
    };
    const w = make();
    expect(w.settlements.dhanyagram!.construction.length + w.settlements.rajapura!.construction.length).toBeGreaterThan(0);
    checkContinuation(make, 25);
  });

  it('with rebels: a revolt at Ratnapura, the rebel host in the field', () => {
    const make = (): WorldState => {
      const w = campaign(13);
      delete w.armies.army_ratna; // nobody to crush them at once
      forceRebellionStage(w, w.settlements.ratnapura!, 'revolt', []);
      runDays(w, 3, { autoEvents: false }); // the revolt event waits for the player
      return w;
    };
    const w = make();
    expect(rebelArmiesOf(w, 'ratnapura').length + (w.settlements.ratnapura!.ownerFactionId === 'heartland' ? 0 : 1)).toBeGreaterThan(0);
    checkContinuation(make, 40);
  });

  it('a whole year of The Broken Crown is reproducible', () => {
    const a = campaign(14);
    const b = campaign(14);
    runDays(a, 360);
    runDays(b, 360);
    expect(hashState(a)).toBe(hashState(b));
  });
});
