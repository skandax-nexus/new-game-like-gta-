/**
 * Orders, stances, deployment and command rules of the formation sim (DESIGN_SPEC §6.1-§6.5, §6.8, §6.11; GP-01).
 * OWNER: Gameplay Engineer - Tactical Battle Simulation.
 *
 * Every FormationOrder (hold, advance, move_to, attack_target, charge, flank, withdraw, regroup, defend, skirmish,
 * construct, resupply), shift-queues, shape-change timing, movement speed, turning cost, deployment-zone clamping,
 * the commander's Rally (radius / cooldown), rout and rally limits, surrender and the pursuit formula.
 */
import { describe, expect, it } from 'vitest';
import type { BattleCommand, FormationOrder, SideIndex } from '../../../src/core/types';
import { BATTLE_DT } from '../../../src/core/constants';
import { issueBattleCommand, stepBattle } from '../../../src/sim/tactical/battle';
import { formationSpeed } from '../../../src/sim/tactical/formations';
import { pursuitRate } from '../../../src/sim/tactical/outcome';
import { RULES } from '../../../src/data/rules';
import { hpLost, runFor, testBattle, TestTerrain, within } from './helpers';
import type { TestBattle } from './helpers';

const PI = Math.PI;

function order(b: TestBattle, side: SideIndex, idx: number, o: FormationOrder, queue = false): string | null {
  return issueBattleCommand(b.state, side, { kind: 'order', formations: [idx], order: o, queue });
}

function cmd(b: TestBattle, side: SideIndex, c: BattleCommand): string | null {
  return issueBattleCommand(b.state, side, c);
}

/** One formation per side far apart (no interaction) - for movement tests. */
function lone(cls: Parameters<typeof testBattle>[0]['sides'][0][number]['cls'] = 'spearmen', extra: Partial<Parameters<typeof testBattle>[0]> = {}): TestBattle {
  return testBattle({ sides: [[{ cls, x: 0, z: 0, facing: 0 }], [{ cls: 'spearmen', x: 450, z: 450, facing: 0 }]], ...extra });
}

describe('movement: speed formula, turning, move_to, advance', () => {
  it('speed = walk x terrain x (1 - 0.35 F) x shape x mud', () => {
    const b = lone();
    const f = b.state.formations[0]!;
    expect(formationSpeed(b.ctx, f, false)).toBeCloseTo(1.5 * (1 - 0.25 * b.state.setup.environment.weather.wetness), 6);
    f.fatigue = 0.4;
    f.shape = 'column';
    expect(formationSpeed(b.ctx, f, true)).toBeCloseTo(3.5 * (1 - 0.35 * 0.4) * 1.15 * (1 - 0.25 * b.state.setup.environment.weather.wetness), 6);
    f.fatigue = 0.6; // exhausted: cannot run
    expect(formationSpeed(b.ctx, f, true)).toBeCloseTo(formationSpeed(b.ctx, f, false), 6);
    const water = testBattle({ terrain: new TestTerrain({ classAt: () => 'shallow_water' }), sides: [[{ cls: 'spearmen', x: 0, z: 0 }], [{ cls: 'spearmen', x: 450, z: 450 }]] });
    expect(formationSpeed(water.ctx, water.state.formations[0]!, false) / formationSpeed(b.ctx, { ...f, fatigue: 0, shape: 'line' }, false)).toBeCloseTo(0.4, 5);
  });

  it('move_to arrives and turns to the ordered facing; run is faster than walk', () => {
    const walk = lone();
    expect(order(walk, 0, 0, { type: 'move_to', x: 0, z: 60, facing: PI / 2, run: false })).toBeNull();
    runFor(walk, 120, (s) => s.formations[0]!.order.type === 'hold');
    const fw = walk.state.formations[0]!;
    expect(Math.hypot(fw.x, fw.z - 60)).toBeLessThan(1);
    expect(fw.facing).toBeCloseTo(PI / 2, 2);
    const tWalk = walk.state.time;
    const run = lone();
    order(run, 0, 0, { type: 'move_to', x: 0, z: 60, facing: null, run: true });
    runFor(run, 120, (s) => s.formations[0]!.order.type === 'hold');
    expect(run.state.time).toBeLessThan(tWalk * 0.6);
  });

  it('move_to with a right-drag width sets the frontage (files) on arrival', () => {
    const b = lone();
    const o = { type: 'move_to', x: 0, z: 20, facing: 0, run: false, width: 40 } as FormationOrder;
    order(b, 0, 0, o);
    runFor(b, 60, (s) => s.formations[0]!.order.type === 'hold');
    const f = b.state.formations[0]!;
    expect(f.files).toBe(40);
    expect(f.ranks).toBe(3);
    expect(f.width).toBeCloseTo(40, 5);
  });

  it('advance walks 30 m (default) along the facing; a queued advance uses the facing when it starts', () => {
    const b = lone();
    order(b, 0, 0, { type: 'advance', distance: 0 });
    order(b, 0, 0, { type: 'move_to', x: 0, z: 30, facing: PI / 2, run: false }, true);
    order(b, 0, 0, { type: 'advance', distance: 20 }, true);
    const f = b.state.formations[0]!;
    expect(f.queue.length).toBe(2);
    runFor(b, 200, (s) => s.formations[0]!.order.type === 'hold' && s.formations[0]!.queue.length === 0);
    // Arrival radius is 0.6 m.
    expect(Math.abs(f.x - 20)).toBeLessThan(1);
    expect(Math.abs(f.z - 30)).toBeLessThan(1);
  });

  it('turning more than 90 deg in place costs 0.1 cohesion (about-face), small turns are free', () => {
    const b = lone();
    const f = b.state.formations[0]!;
    order(b, 0, 0, { type: 'move_to', x: 0, z: 0.3, facing: PI, run: false });
    runFor(b, 20, (s) => s.formations[0]!.order.type === 'hold');
    expect(f.cohesion).toBeGreaterThan(0.89);
    expect(f.cohesion).toBeLessThan(0.91);
    const c = lone();
    order(c, 0, 0, { type: 'move_to', x: 0, z: 0.3, facing: 1, run: false });
    runFor(c, 20, (s) => s.formations[0]!.order.type === 'hold');
    expect(c.state.formations[0]!.cohesion).toBe(1);
  });
});

describe('shape change and shift-queue', () => {
  it('a shape change takes 3 s + 0.02 s per soldier with cohesion capped at 0.6', () => {
    const b = lone();
    const f = b.state.formations[0]!;
    expect(cmd(b, 0, { kind: 'set_shape', formations: [0], shape: 'square' })).toBeNull();
    expect(f.shapeChangeUntil).toBeCloseTo(3 + 0.02 * 120, 6);
    expect(f.files).toBe(11);
    runFor(b, 5);
    expect(f.cohesion).toBeLessThanOrEqual(0.6);
    runFor(b, 1);
    expect(f.shapeChangeUntil).toBe(0);
    runFor(b, 5);
    expect(f.cohesion).toBeGreaterThan(0.65);
    expect(cmd(b, 0, { kind: 'set_shape', formations: [0], shape: 'loose' })).toBe('That formation cannot take this shape');
  });

  it('queued orders run in sequence; a non-queued order replaces the queue', () => {
    const b = lone();
    order(b, 0, 0, { type: 'move_to', x: 0, z: 20, facing: null, run: false });
    order(b, 0, 0, { type: 'move_to', x: 20, z: 20, facing: null, run: false }, true);
    order(b, 0, 0, { type: 'move_to', x: 20, z: 0, facing: null, run: false }, true);
    const f = b.state.formations[0]!;
    const seen: number[] = [];
    for (let i = 0; i < 20 * 120 && (f.order.type !== 'hold' || f.queue.length); i++) {
      runFor(b, BATTLE_DT);
      if (f.order.type === 'move_to' && !seen.includes(f.order.x * 100 + f.order.z)) seen.push(f.order.x * 100 + f.order.z);
    }
    expect(seen).toEqual([20, 2020, 2000]);
    expect(Math.hypot(f.x - 20, f.z)).toBeLessThan(1);
    order(b, 0, 0, { type: 'move_to', x: 0, z: 0, facing: null, run: false }, true);
    order(b, 0, 0, { type: 'hold' });
    expect(f.queue.length).toBe(0);
  });
});

describe('attack, charge, flank', () => {
  it('attack_target: melee formations approach and engage on contact', () => {
    const b = testBattle({ sides: [[{ cls: 'spearmen', x: 0, z: 0, facing: 0 }], [{ cls: 'spearmen', x: 0, z: 60, facing: 0, }]] });
    cmd(b, 1, { kind: 'set_stance', formations: [1], stance: 'defensive' });
    order(b, 0, 0, { type: 'attack_target', target: 1, run: false });
    runFor(b, 60, (s) => s.formations[0]!.engagedWith.length > 0);
    expect(b.state.formations[0]!.engagedWith).toEqual([1]);
    expect(b.events.some((e) => e.kind === 'contact')).toBe(true);
  });

  it('attack_target / skirmish with archers: close to range, shoot, keep 0.4-0.9 x range; out of ammo -> hold ("No arrows")', () => {
    const b = testBattle({ sides: [[{ cls: 'archers', x: 0, z: 0, facing: 0 }], [{ cls: 'spearmen', x: 0, z: 300, facing: PI }]] });
    cmd(b, 1, { kind: 'set_stance', formations: [1], stance: 'defensive' });
    order(b, 0, 0, { type: 'skirmish', target: 1 });
    runFor(b, 150, (s) => s.formations[0]!.ammo < 15);
    const f = b.state.formations[0]!;
    const d = Math.hypot(f.x, f.z - 300);
    expect(d).toBeLessThanOrEqual(160 * 0.9 + 2);
    expect(d).toBeGreaterThanOrEqual(160 * 0.4);
    f.ammo = 1;
    runFor(b, 30, (s) => s.formations[0]!.order.type === 'hold');
    expect(f.order.type).toBe('hold');
    expect(b.events.some((e) => e.kind === 'ammo_depleted' && e.text === 'No arrows')).toBe(true);
  });

  it('charge: walks until 40 m (foot) / 90 m (mounted), then runs; impact only after >= 20 m running', () => {
    const b = testBattle({ sides: [[{ cls: 'cavalry', x: 0, z: 0, facing: 0 }], [{ cls: 'archers', x: 0, z: 200, facing: PI }]] });
    cmd(b, 1, { kind: 'set_stance', formations: [1], stance: 'hold_fire' });
    order(b, 0, 0, { type: 'charge', target: 1 });
    const cav = b.state.formations[0]!;
    let runStartGap = -1;
    for (let i = 0; i < 20 * 120 && cav.engagedWith.length === 0; i++) {
      runFor(b, BATTLE_DT);
      if (runStartGap < 0 && cav.activity === 'charging') runStartGap = Math.hypot(cav.x, cav.z - 200) - cav.depth / 2 - b.state.formations[1]!.depth / 2;
    }
    expect(runStartGap).toBeGreaterThan(80);
    expect(runStartGap).toBeLessThanOrEqual(90.5);
    const ch = b.events.find((e) => e.kind === 'charge');
    expect(ch).toBeDefined();
    expect(ch!.text).toBeNull(); // archers cannot brace

    const foot = testBattle({ sides: [[{ cls: 'elite_guards', x: 0, z: 0, facing: 0 }], [{ cls: 'archers', x: 0, z: 120, facing: PI }]] });
    cmd(foot, 1, { kind: 'set_stance', formations: [1], stance: 'hold_fire' });
    order(foot, 0, 0, { type: 'charge', target: 1 });
    const g = foot.state.formations[0]!;
    let gStart = -1;
    for (let i = 0; i < 20 * 200 && g.engagedWith.length === 0; i++) {
      runFor(foot, BATTLE_DT);
      if (gStart < 0 && g.activity === 'charging') gStart = Math.hypot(g.x, g.z - 120) - g.depth / 2 - foot.state.formations[1]!.depth / 2;
    }
    expect(gStart).toBeGreaterThan(36);
    expect(gStart).toBeLessThanOrEqual(40.5);
    expect(foot.events.some((e) => e.kind === 'charge')).toBe(true);

    // Too short a run-in: no impact.
    const short = testBattle({ sides: [[{ cls: 'cavalry', x: 0, z: 0, facing: 0 }], [{ cls: 'archers', x: 0, z: 26, facing: PI }]] });
    cmd(short, 1, { kind: 'set_stance', formations: [1], stance: 'hold_fire' });
    order(short, 0, 0, { type: 'charge', target: 1 });
    runFor(short, 20, (s) => s.formations[0]!.engagedWith.length > 0);
    expect(short.state.formations[0]!.engagedWith.length).toBe(1);
    expect(short.events.some((e) => e.kind === 'charge')).toBe(false);
  });

  it('exhausted formations cannot charge', () => {
    const b = testBattle({ sides: [[{ cls: 'cavalry', x: 0, z: 0, facing: 0, fatigue: 0.6 }], [{ cls: 'archers', x: 0, z: 200, facing: PI }]] });
    expect(order(b, 0, 0, { type: 'charge', target: 1 })).toBe('Too exhausted to charge');
  });

  it('a holding spear line receives a charge braced instead of stepping out (aggressive stance)', () => {
    const b = testBattle({ sides: [[{ cls: 'spearmen', x: 0, z: 0, facing: 0 }], [{ cls: 'cavalry', x: 0, z: 160, facing: PI }]] });
    order(b, 1, 0 + 1, { type: 'charge', target: 0 });
    runFor(b, 60, (s) => s.formations[0]!.engagedWith.length > 0);
    const ch = b.events.find((e) => e.kind === 'charge');
    expect(ch?.text).toBe('braced');
  });

  it('flank: runs to the target flank and charges it (flank impact); converts to attack_target after 30 s', () => {
    const b = testBattle({ sides: [[{ cls: 'cavalry', x: -40, z: 30, facing: 0 }], [{ cls: 'spearmen', x: 0, z: 100, facing: PI }]] });
    cmd(b, 1, { kind: 'set_stance', formations: [1], stance: 'hold_fire' });
    order(b, 0, 0, { type: 'flank', target: 1, side: 'right' });
    runFor(b, 90, (s) => s.formations[0]!.engagedWith.length > 0);
    const ch = b.events.find((e) => e.kind === 'charge');
    expect(ch).toBeDefined();
    expect(ch!.text).toBeNull(); // not braced: hit in the flank
    expect(b.state.formations[1]!.moraleEvents.some((e) => e.kind === 'flank_attacked' || e.kind === 'rear_attacked')).toBe(true);
    // Timeout: a flank order that cannot finish becomes attack_target after 30 s.
    const t = testBattle({ sides: [[{ cls: 'spearmen', x: -400, z: -400, facing: 0 }], [{ cls: 'spearmen', x: 400, z: 400, facing: PI }]] });
    order(t, 0, 0, { type: 'flank', target: 1, side: 'left' });
    runFor(t, 31);
    expect(t.state.formations[0]!.order.type).toBe('attack_target');
  });
});

describe('withdraw, regroup, defend', () => {
  it('withdraw: backs away facing the enemy at 50% speed, disengaging costs x1.5 damage for 3 s, no morale penalty', () => {
    const b = testBattle({ sides: [[{ cls: 'spearmen', x: 0, z: 0, facing: 0, morale: 60 }], [{ cls: 'spearmen', x: 0, z: 7.4, facing: PI, morale: 60 }]] });
    cmd(b, 1, { kind: 'set_stance', formations: [1], stance: 'defensive' });
    runFor(b, 1);
    const f = b.state.formations[0]!;
    expect(f.engagedWith).toEqual([1]);
    const before = hpLost(b, 0);
    expect(order(b, 0, 0, { type: 'withdraw', x: 0, z: -150 })).toBeNull();
    expect(f.disengageUntil).toBeCloseTo(b.state.time + 3, 6);
    const facing = f.facing;
    const morale = f.morale;
    runFor(b, 2);
    expect(hpLost(b, 0) - before).toBeGreaterThan(0);
    runFor(b, 6);
    expect(f.facing).toBeCloseTo(facing, 3);
    expect(f.activity).toBe('withdrawing');
    const sp = Math.hypot(f.vx, f.vz);
    expect(sp).toBeLessThan(0.8);
    expect(sp).toBeGreaterThan(0.5);
    expect(f.morale).toBeGreaterThan(morale - 10);
    runFor(b, 120, (s) => s.formations[0]!.order.type === 'hold');
    expect(f.z).toBeLessThan(-145);
  });

  it('regroup: +5 morale once when not engaged; cohesion recovers x2.5', () => {
    const a = lone();
    const b = lone();
    for (const t of [a, b]) {
      t.state.formations[0]!.cohesion = 0.5;
      t.state.formations[0]!.morale = 50;
    }
    order(a, 0, 0, { type: 'regroup' });
    expect(a.state.formations[0]!.morale).toBe(55);
    runFor(a, 4);
    runFor(b, 4);
    const ra = a.state.formations[0]!.cohesion - 0.5;
    const rb = b.state.formations[0]!.cohesion - 0.5;
    expect(ra / rb).toBeCloseTo(2.5, 1);
  });

  it('defend: radius clamped to 20..150 m, engages enemies inside, returns to the anchor', () => {
    const b = testBattle({ sides: [[{ cls: 'spearmen', x: 0, z: 0, facing: 0 }], [{ cls: 'spearmen', x: 0, z: 300, facing: PI }]] });
    order(b, 0, 0, { type: 'defend', x: 0, z: 0, radius: 500 });
    const o = b.state.formations[0]!.order;
    expect(o.type === 'defend' && o.radius).toBe(150);
    order(b, 0, 0, { type: 'defend', x: 0, z: 0, radius: 5 });
    const o2 = b.state.formations[0]!.order;
    expect(o2.type === 'defend' && o2.radius).toBe(20);
    order(b, 0, 0, { type: 'defend', x: 0, z: 0, radius: 60 });
    // Enemy walks into the radius -> engaged.
    order(b, 1, 1, { type: 'move_to', x: 0, z: 40, facing: null, run: false });
    runFor(b, 200, (s) => s.formations[0]!.engagedWith.length > 0);
    expect(b.state.formations[0]!.engagedWith).toEqual([1]);
    // Enemy leaves (teleported away for the test): back to the anchor.
    const e = b.state.formations[1]!;
    e.x = 400;
    e.z = 400;
    e.order = { type: 'hold' };
    runFor(b, 120, (s) => Math.hypot(s.formations[0]!.x, s.formations[0]!.z) < 5);
    expect(Math.hypot(b.state.formations[0]!.x, b.state.formations[0]!.z)).toBeLessThan(5.5);
  });
});

describe('stances', () => {
  it('aggressive engages enemies within 30 m; defensive does not move but faces a flank threat', () => {
    const agg = testBattle({ sides: [[{ cls: 'spearmen', x: 0, z: 0, facing: 0 }], [{ cls: 'spearmen', x: 0, z: 34, facing: 0 }]] });
    cmd(agg, 1, { kind: 'set_stance', formations: [1], stance: 'defensive' });
    runFor(agg, 1);
    expect(agg.state.formations[0]!.order.type).toBe('attack_target');
    const def = testBattle({ sides: [[{ cls: 'spearmen', x: 0, z: 0, facing: 0 }], [{ cls: 'cavalry', x: 40, z: 0, facing: -PI / 2 }]] });
    cmd(def, 0, { kind: 'set_stance', formations: [0], stance: 'defensive' });
    cmd(def, 1, { kind: 'set_stance', formations: [1], stance: 'defensive' });
    runFor(def, 8);
    const f = def.state.formations[0]!;
    expect(f.order.type).toBe('hold');
    expect(Math.abs(f.facing - PI / 2)).toBeLessThan(0.05);
  });

  it('hold_fire archers do not fire at will; skirmish archers step back from a melee threat', () => {
    const b = testBattle({ sides: [[{ cls: 'archers', x: 0, z: 0, facing: 0 }], [{ cls: 'spearmen', x: 0, z: 100, facing: PI }]] });
    cmd(b, 0, { kind: 'set_stance', formations: [0], stance: 'hold_fire' });
    cmd(b, 1, { kind: 'set_stance', formations: [1], stance: 'defensive' });
    runFor(b, 20);
    expect(b.events.some((e) => e.kind === 'volley')).toBe(false);
    cmd(b, 0, { kind: 'set_stance', formations: [0], stance: 'skirmish' });
    runFor(b, 10);
    expect(b.events.some((e) => e.kind === 'volley')).toBe(true);
    order(b, 1, 1, { type: 'attack_target', target: 0, run: false });
    const z0 = b.state.formations[0]!.z;
    runFor(b, 30);
    expect(b.state.formations[0]!.z).toBeLessThan(z0 - 5);
  });
});

describe('engineers and supply', () => {
  it('construct: a palisade takes 40 s; contact interrupts it and the progress is kept', () => {
    // (Side 0 needs a combat formation: engineers alone are a broken side, §6.8.)
    const b = testBattle({ sides: [[{ cls: 'engineers', x: 0, z: 0, facing: 0 }, { cls: 'spearmen', x: -300, z: -300, facing: 0 }], [{ cls: 'spearmen', x: 0, z: 400, facing: PI }]] });
    expect(order(b, 0, 0, { type: 'construct', work: 'palisade', x: 0, z: 2, facing: 0 })).toBeNull();
    expect(order(b, 0, 1, { type: 'construct', work: 'palisade', x: 0, z: 2, facing: 0 })).toBe('Only engineers build works');
    runFor(b, 20);
    const w = b.state.works[0]!;
    expect(w.progress).toBeGreaterThan(0.3);
    expect(w.progress).toBeLessThan(0.6);
    // Interrupted by contact.
    const e = b.state.formations[2]!;
    e.x = 0;
    e.z = 10;
    e.facing = PI;
    cmd(b, 1, { kind: 'set_stance', formations: [2], stance: 'defensive' });
    runFor(b, 1);
    const kept = w.progress;
    runFor(b, 3);
    expect(w.progress).toBe(kept);
    e.x = 400;
    e.z = 400;
    runFor(b, 30, (s) => s.works[0]!.progress >= 1);
    expect(w.progress).toBe(1);
    runFor(b, 0.05); // the pathing overlay is rebuilt at the start of the next tick
    expect(b.ctx.grid.passableAt(0, 2, b.ctx.profile[0]!, 0)).toBe(false);
  });

  it('resupply: +25% of max ammo every 30 s while both stand still', () => {
    const b = testBattle({ sides: [[{ cls: 'supply_train', x: -40, z: 0, facing: 0 }, { cls: 'archers', x: 0, z: 0, facing: 0 }], [{ cls: 'spearmen', x: 400, z: 400, facing: PI }]] });
    const arc = b.state.formations[1]!;
    arc.ammo = 2;
    expect(order(b, 0, 0, { type: 'resupply', target: 1 })).toBeNull();
    expect(order(b, 0, 1, { type: 'resupply', target: 0 })).toBe('Only supply trains resupply');
    // ~17 s to close to 30 m at cart pace, then +5 volleys (25% of 20) every 30 s.
    runFor(b, 50);
    expect(arc.ammo).toBe(7);
    runFor(b, 30);
    expect(arc.ammo).toBe(12);
  });
});

describe('deployment', () => {
  it('positions are clamped to the deploy zone; deploy / begin_battle rules; the phase lasts deploymentSec', () => {
    const b = testBattle({ deploymentSec: 30, sides: [[{ cls: 'spearmen', x: 0, z: 150, facing: PI }], [{ cls: 'spearmen', x: 0, z: -150, facing: 0 }]] });
    expect(b.state.phase).toBe('deployment');
    const zone = b.state.setup.sides[0].deployZone;
    expect(cmd(b, 0, { kind: 'deploy', formation: 0, x: 9999, z: -9999, facing: 1 })).toBeNull();
    const f = b.state.formations[0]!;
    expect(f.x).toBe(zone.maxX);
    expect(f.z).toBe(zone.minZ);
    expect(f.facing).toBe(1);
    expect(cmd(b, 0, { kind: 'deploy', formation: 1, x: 0, z: 0, facing: 0 })).toBe('Not your formation');
    // Orders given during deployment wait for the battle.
    order(b, 0, 0, { type: 'move_to', x: zone.minX, z: zone.minZ, facing: null, run: false });
    runFor(b, 10);
    expect(f.x).toBe(zone.maxX);
    expect(b.state.phase).toBe('deployment');
    runFor(b, 21);
    expect(b.state.phase).toBe('active');
    expect(b.events.some((e) => e.kind === 'deployment_ended')).toBe(true);
    expect(cmd(b, 0, { kind: 'deploy', formation: 0, x: 0, z: 0, facing: 0 })).toBe('Deployment is over');
    const c = testBattle({ deploymentSec: 60, sides: [[{ cls: 'spearmen', x: 0, z: 150, facing: PI }], [{ cls: 'spearmen', x: 0, z: -150, facing: 0 }]] });
    runFor(c, 2);
    expect(cmd(c, 0, { kind: 'begin_battle' })).toBeNull();
    expect(c.state.phase).toBe('active');
    expect(c.state.deploymentEndsAt).toBeCloseTo(2, 6);
  });

  it('the battle AI runs during deployment (pre-orders) and an AI side cannot end a human deployment early', () => {
    const b = testBattle({ deploymentSec: 30, controllers: ['player', 'ai'], sides: [[{ cls: 'spearmen', x: 0, z: 150, facing: PI }], [{ cls: 'spearmen', x: 0, z: -150, facing: 0 }]] });
    runFor(b, 2);
    expect(b.state.commandLog.some((c) => c.side === 1)).toBe(true);
    expect(b.state.formations[1]!.z).toBe(-150);
    expect(cmd(b, 1, { kind: 'begin_battle' })).toBe('Waiting for the opponent');
  });
});

describe('commander rally (§6.11)', () => {
  it('own formations within 120 m gain +15 morale and rally if routing (> 35); 90 s cooldown; not while engaged', () => {
    const b = testBattle({
      sides: [
        [
          { cls: 'elite_guards', x: 0, z: 0, facing: 0, commander: true },
          { cls: 'spearmen', x: 60, z: 0, facing: 0 },
          { cls: 'spearmen', x: 200, z: 0, facing: 0 },
          { cls: 'archers', x: -80, z: 0, facing: 0 },
        ],
        [{ cls: 'spearmen', x: 400, z: 400, facing: PI }],
      ],
    });
    runFor(b, 1);
    const [, near, far, router] = b.state.formations;
    near!.morale = 50;
    far!.morale = 50;
    router!.activity = 'routing';
    router!.morale = 40;
    expect(cmd(b, 0, { kind: 'rally' })).toBeNull();
    expect(near!.morale).toBe(65);
    expect(far!.morale).toBe(50);
    expect(near!.moraleEvents.some((e) => e.kind === 'rallied')).toBe(true);
    expect(router!.activity).toBe('rallying');
    expect(router!.rallies).toBe(1);
    expect(b.state.sides[0].rallyCooldownUntil).toBeCloseTo(b.state.time + 90, 6);
    expect(cmd(b, 0, { kind: 'rally' })).toMatch(/Rally ready in 90 s/);
    runFor(b, 90.1);
    expect(cmd(b, 0, { kind: 'rally' })).toBeNull();
    b.state.formations[0]!.engagedWith.push(4);
    b.state.sides[0].rallyCooldownUntil = 0;
    expect(cmd(b, 0, { kind: 'rally' })).toBe('The commander is in the fight');
  });
});

describe('rout, rally limits, surrender, pursuit (§6.8)', () => {
  it('a formation below 30 routs, runs for its own edge and leaves the field; at most 2 rallies, the third rout is final', () => {
    const b = testBattle({ sides: [[{ cls: 'spearmen', x: 0, z: 300, facing: PI }, { cls: 'spearmen', x: -400, z: 0, facing: PI }], [{ cls: 'spearmen', x: 0, z: -400, facing: 0 }]] });
    const f = b.state.formations[0]!;
    f.rallies = 2;
    f.morale = 20;
    runFor(b, 0.1);
    expect(f.activity).toBe('routing');
    expect(b.events.find((e) => e.kind === 'formation_routed')?.text).toBe('shattered');
    expect(cmd(b, 0, { kind: 'order', formations: [0], order: { type: 'hold' }, queue: false })).toBe('No formation can take that order');
    runFor(b, 120);
    // Side 0 deploys on +axis (+Z here): routers leave over the +Z edge, never rallying (3rd rout).
    expect(f.z).toBeGreaterThan(512);
    expect(f.activity).toBe('routing');
    expect(f.rallies).toBe(2);
  });

  it('routing + morale < 8 + enemies within 30 m on two aspects -> surrendered (all captured)', () => {
    const b = testBattle({
      sides: [
        [{ cls: 'spearmen', x: 0, z: 0, facing: 0, n: 80 }],
        [
          { cls: 'spearmen', x: 0, z: 30, facing: PI },
          { cls: 'spearmen', x: 35, z: 0, facing: -PI / 2 },
        ],
      ],
    });
    for (const i of [1, 2]) cmd(b, 1, { kind: 'set_stance', formations: [i], stance: 'defensive' });
    const f = b.state.formations[0]!;
    f.activity = 'routing';
    f.morale = 5;
    f.moraleEvents.push({ kind: 'commander_fallen', time: 0, magnitude: -1, decaySec: 600 });
    runFor(b, 0.1);
    expect(f.activity).toBe('surrendered');
    expect(f.captured).toBe(80);
    expect(f.soldiers).toBe(0);
    expect(b.events.some((e) => e.kind === 'formation_surrendered')).toBe(true);
    expect(b.state.outcome?.reason).toBe('surrender');
    expect(b.state.outcome?.sides[1].prisoners).toBe(80);
  });

  it('pursuit: routing soldiers x (0.15 + 0.1 x winner mounted share) x (1 - 0.5 x loser mounted share), 70% killed / 30% captured', () => {
    expect(pursuitRate(0, 0)).toBeCloseTo(0.15, 9);
    expect(pursuitRate(0.5, 0.2)).toBeCloseTo((0.15 + 0.05) * 0.9, 9);
    const b = testBattle({
      sides: [
        [{ cls: 'spearmen', x: 0, z: 0, facing: 0 }, { cls: 'cavalry', x: 60, z: 0, facing: 0 }],
        [{ cls: 'spearmen', x: 0, z: -200, facing: 0 }],
      ],
    });
    const loser = b.state.formations[2]!;
    loser.activity = 'routing';
    loser.morale = 10;
    runFor(b, 0.1);
    const o = b.state.outcome!;
    expect(o.winner).toBe(0);
    const rate = pursuitRate(60 / 180, 0);
    const lost = Math.floor(120 * rate);
    expect(o.sides[1].pursuitLosses).toBe(lost);
    expect(o.sides[1].captured).toBe(Math.floor(lost * RULES.battle.pursuit.capturedShare));
    expect(o.sides[1].survivors).toBe(120 - lost);
    expect(o.sides[0].prisoners).toBe(o.sides[1].captured);
  });
});

describe('side surrender', () => {
  it('takes every formation still on the field; routers that already fled off the map are not captured', () => {
    const b = testBattle({
      sides: [
        [{ cls: 'spearmen', x: 0, z: 0, facing: 0 }, { cls: 'archers', x: 0, z: 600, facing: 0 }],
        [{ cls: 'spearmen', x: 0, z: -200, facing: 0 }],
      ],
    });
    const fled = b.state.formations[1]!;
    fled.activity = 'routing';
    fled.morale = 10;
    expect(issueBattleCommand(b.state, 0, { kind: 'surrender' })).toBeNull();
    expect(b.state.formations[0]!.activity).toBe('surrendered');
    expect(fled.activity).toBe('routing');
    runFor(b, 0.1);
    const o = b.state.outcome!;
    expect(o.winner).toBe(1);
    expect(o.reason).toBe('surrender');
    expect(o.sides[0].captured).toBe(120);
    expect(o.sides[0].survivors).toBe(100);
    expect(o.sides[0].pursuitLosses).toBe(0);
  });
});

describe('within helper', () => {
  it('sanity', () => {
    expect(within(105, 100)).toBe(true);
    expect(within(111, 100)).toBe(false);
    void stepBattle;
  });
});
