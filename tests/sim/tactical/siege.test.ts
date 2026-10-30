/**
 * Siege battles (DESIGN_SPEC §6.6.5; GP-01): wall ring, gates by settlement kind, towers, a ram breaching a gate,
 * escalade with ladders, defenders on the walls, elephants against gates, gate repair, breach-hold victory.
 * OWNER: Gameplay Engineer - Tactical Battle Simulation.
 */
import { describe, expect, it } from 'vitest';
import type { FortificationSpec, FormationOrder, SideIndex } from '../../../src/core/types';
import { issueBattleCommand } from '../../../src/sim/tactical/battle';
import { meleeAttackValue, meleeDefenseValue } from '../../../src/sim/tactical/combat';
import { createFortificationSpec, gatesForSettlement, ringPoint } from '../../../src/sim/tactical/fort';
import { onWalls } from '../../../src/sim/tactical/morale';
import { effectiveRange, volleyHits } from '../../../src/sim/tactical/projectiles';
import { holdsTheField, sideBroken } from '../../../src/sim/tactical/outcome';
import { breachHeld, wallBetween } from '../../../src/sim/tactical/siege';
import { moveProfile } from '../../../src/sim/tactical/stats';
import { runFor, testBattle } from './helpers';
import type { TestBattle, TestFormation } from './helpers';

const PI = Math.PI;
const R = 120;

/** Town (2 gates) with mud-brick walls (level 2), defender side 1 at the map center; the attacker comes from +Z. */
function fort(): FortificationSpec {
  return createFortificationSpec({ settlementKind: 'town', fortLevel: 2, fortDefense: 1, center: { x: 0, z: 0 }, radius: R, defenderSide: 1 });
}

function siege(attackers: TestFormation[], defenders: TestFormation[]): TestBattle {
  return testBattle({ kind: 'siege', fortification: fort(), attackerSide: 0, sides: [attackers, defenders] });
}

function order(b: TestBattle, side: SideIndex, idx: number, o: FormationOrder, queue = false): string | null {
  return issueBattleCommand(b.state, side, { kind: 'order', formations: [idx], order: o, queue });
}

describe('fortification spec and siege state', () => {
  it('segments, gates by settlement kind, towers per level, HP formulas', () => {
    expect(gatesForSettlement('fort')).toBe(1);
    expect(gatesForSettlement('town')).toBe(2);
    expect(gatesForSettlement('port')).toBe(2);
    expect(gatesForSettlement('temple_town')).toBe(2);
    expect(gatesForSettlement('city')).toBe(4);
    expect(gatesForSettlement('capital')).toBe(4);
    const giridurg = createFortificationSpec({ settlementKind: 'fort', fortLevel: 3, fortDefense: 1.4, center: { x: 0, z: 0 }, radius: 100, defenderSide: 1 });
    expect(giridurg.wallHp).toBe(350); // 3 x 1000 x 1.4 / 12
    expect(giridurg.towers).toBe(18);
    expect(giridurg.kind).toBe('stone_wall');
    const b = siege([{ cls: 'spearmen', x: 0, z: 300, facing: PI }], [{ cls: 'spearmen', x: 0, z: 0, facing: 0 }]);
    const s = b.state.siege!;
    expect(s.segments.length).toBe(12);
    expect(Math.abs(fort().wallHp - 2000 / 12)).toBeLessThan(0.5); // 2 x 1000 x 1.0 / 12, rounded
    expect(s.segments[0]!.maxHp).toBe(fort().wallHp);
    expect(s.gates.length).toBe(2);
    expect(s.gates[0]!.maxHp).toBeCloseTo(1.5 * fort().wallHp, 6);
    expect(s.gates[0]!.segment).toBe(0); // main gate faces the attacker (+Z, segment 0)
    expect(s.gates[1]!.segment).toBe(6);
    expect(s.towers.length).toBe(12);
  });

  it('intact walls block attackers; a laddered or breached segment lets them through; defenders use their own gates', () => {
    const b = siege([{ cls: 'spearmen', x: 0, z: 300, facing: PI }], [{ cls: 'spearmen', x: 0, z: 0, facing: 0 }]);
    runFor(b, 0.05);
    const g = b.ctx.grid;
    const p = moveProfile('spearmen');
    const wallX = Math.sin(PI / 4) * R; // segment 1 (30..60 deg)
    const wallZ = Math.cos(PI / 4) * R;
    expect(g.passableAt(wallX, wallZ, p, 0)).toBe(false);
    expect(g.passableAt(wallX, wallZ, p, 1)).toBe(false);
    const gate = { x: 0, z: 0 };
    ringPoint(b.ctx.fort!, b.ctx.fort!.gateAngle[0]!, R, gate);
    expect(g.passableAt(gate.x, gate.z, p, 0)).toBe(false); // closed to the attacker
    expect(g.passableAt(gate.x, gate.z, p, 1)).toBe(true); // the defenders open their gate
    b.state.siege!.segments[1]!.ladder = true;
    runFor(b, 0.05);
    expect(g.passableAt(wallX, wallZ, p, 0)).toBe(true);
    expect(g.passableAt(wallX, wallZ, p, 1)).toBe(false);
    b.state.siege!.segments[1]!.hp = 0;
    runFor(b, 0.1);
    expect(b.state.siege!.breaches).toContain(1);
    expect(g.passableAt(wallX, wallZ, p, 1)).toBe(true);
    expect(b.events.some((e) => e.kind === 'gate_breached' && e.text === 'wall')).toBe(true);
  });
});

describe('engineers: ram and ladders', () => {
  it('a ram (60 s) is carried to the main gate and breaks it (4 HP/s x engineers / 10)', () => {
    const b = siege(
      [
        { cls: 'engineers', x: 30, z: 200, facing: PI },
        { cls: 'spearmen', x: -100, z: 320, facing: PI },
      ],
      [{ cls: 'spearmen', x: 0, z: -40, facing: 0 }],
    );
    for (const i of [1, 2]) issueBattleCommand(b.state, i === 2 ? 1 : 0, { kind: 'set_stance', formations: [i], stance: 'defensive' });
    expect(order(b, 0, 0, { type: 'construct', work: 'ram', x: 30, z: 200, facing: PI })).toBeNull();
    runFor(b, 59);
    expect(b.state.works[0]!.progress).toBeLessThan(1);
    runFor(b, 2);
    expect(b.state.works[0]!.progress).toBe(1);
    expect(b.state.works[0]!.formation).toBe(0);
    const gate = b.state.siege!.gates[0]!;
    const t0 = b.state.time;
    runFor(b, 120, (s) => s.siege!.gates[0]!.hp <= 0);
    expect(gate.hp).toBe(0);
    expect(b.state.siege!.breaches).toEqual([gate.segment]);
    expect(b.events.some((e) => e.kind === 'gate_breached' && e.text === 'gate')).toBe(true);
    const batter = b.state.time - t0;
    console.log(`[siege] ram built in 60 s, gate (${gate.maxHp.toFixed(0)} HP) broken ${batter.toFixed(1)} s later (walk + ${(gate.maxHp / 16).toFixed(1)} s at 16 HP/s)`);
    expect(batter).toBeGreaterThan(gate.maxHp / 16);
    // The broken gate is open to the attacker (overlay rebuilt on the next tick).
    runFor(b, 0.05);
    const p = { x: 0, z: 0 };
    ringPoint(b.ctx.fort!, b.ctx.fort!.gateAngle[0]!, R, p);
    expect(b.ctx.grid.passableAt(p.x, p.z, moveProfile('spearmen'), 0)).toBe(true);
  });

  it('elephants batter a gate at siege x soldiers HP/s (40 HP/s for 8)', () => {
    // Main gate 0 sits in the middle of segment 0 (15 deg); the elephants stand before it facing the gate.
    const a = PI / 12;
    const gp = { x: Math.sin(a) * (R + 14), z: Math.cos(a) * (R + 14) };
    const b = siege([{ cls: 'war_elephants', x: gp.x, z: gp.z, facing: a + PI }], [{ cls: 'spearmen', x: 0, z: -40, facing: 0 }]);
    issueBattleCommand(b.state, 1, { kind: 'set_stance', formations: [1], stance: 'hold_fire' });
    const gate = b.state.siege!.gates[0]!;
    const before = gate.hp;
    runFor(b, 2);
    expect(before - gate.hp).toBeCloseTo(80, 0);
    runFor(b, 5);
    expect(gate.hp).toBe(0);
  });

  it('ladders (20 s per segment) let attackers climb to defenders on the walls - with the escalade penalty', () => {
    const wallAngle = PI / 4; // segment 1
    const out = { x: 0, z: 0 };
    const walk = { x: 0, z: 0 };
    ringPoint({ cx: 0, cz: 0, radius: R } as Parameters<typeof ringPoint>[0], wallAngle, R + 30, out);
    ringPoint({ cx: 0, cz: 0, radius: R } as Parameters<typeof ringPoint>[0], wallAngle, R - 12, walk);
    const b = siege(
      [
        { cls: 'engineers', x: out.x, z: out.z, facing: wallAngle + PI },
        { cls: 'spearmen', x: out.x + 10, z: out.z + 30, facing: wallAngle + PI },
      ],
      [{ cls: 'spearmen', x: walk.x, z: walk.z, facing: wallAngle, n: 80 }],
    );
    issueBattleCommand(b.state, 1, { kind: 'set_stance', formations: [2], stance: 'defensive' });
    const def = b.state.formations[2]!;
    expect(onWalls(b.ctx, def)).toBe(true);
    // Without ladders the attackers cannot reach the walls.
    order(b, 0, 1, { type: 'attack_target', target: 2, run: false });
    runFor(b, 30);
    expect(b.state.formations[1]!.engagedWith.length).toBe(0);
    expect(order(b, 0, 0, { type: 'construct', work: 'ladder', x: out.x * 0.95, z: out.z * 0.95, facing: 0 })).toBeNull();
    expect(order(b, 1, 2, { type: 'construct', work: 'ladder', x: out.x, z: out.z, facing: 0 })).toBeTruthy();
    runFor(b, 40, (s) => s.siege!.segments[1]!.ladder);
    expect(b.state.siege!.segments[1]!.ladder).toBe(true);
    const att = b.state.formations[1]!;
    const moraleBefore = att.morale;
    runFor(b, 60, (s) => s.formations[1]!.engagedWith.length > 0);
    expect(att.engagedWith).toEqual([2]);
    expect(wallBetween(b.state, b.ctx, att, def)).toBe(false);
    // Escalade: attackers' melee x0.7 and a morale hit on the climb.
    const atk = meleeAttackValue(b.state, b.ctx, att, def);
    const saved = b.state.siege!.segments[1]!.ladder;
    const fortSaved = b.ctx.fort;
    (b.ctx as { fort: typeof fortSaved }).fort = null;
    const atkOpen = meleeAttackValue(b.state, b.ctx, att, def);
    (b.ctx as { fort: typeof fortSaved }).fort = fortSaved;
    expect(saved).toBe(true);
    expect(atk / atkOpen).toBeCloseTo(0.7, 5);
    expect(att.morale).toBeLessThan(moraleBefore + 5);
  });
});

describe('defenders on the walls and in towers', () => {
  it('defense x1.3, missile accuracy x1.2, range x1.2; towers +20% more', () => {
    const walk = { x: 0, z: 0 };
    // A tower stands every 30 deg at level 2 (12 towers from the main gate's segment edge): put the archers at 90 deg.
    ringPoint({ cx: 0, cz: 0, radius: R } as Parameters<typeof ringPoint>[0], PI / 2, R - 12, walk);
    const b = siege(
      [{ cls: 'spearmen', x: 0, z: 350, facing: PI }],
      [
        { cls: 'archers', x: walk.x, z: walk.z, facing: PI / 2 },
        { cls: 'archers', x: 0, z: 0, facing: 0 },
        { cls: 'spearmen', x: walk.x - 5, z: walk.z - 18, facing: PI / 2 },
      ],
    );
    const [att, onWall, inside] = b.state.formations;
    expect(onWalls(b.ctx, onWall!)).toBe(true);
    expect(onWalls(b.ctx, inside!)).toBe(false);
    const rWall = effectiveRange(b.state, b.ctx, onWall!, null);
    const rIn = effectiveRange(b.state, b.ctx, inside!, null);
    const hWall = volleyHits(b.state, b.ctx, onWall!, att!, 100, 0);
    const hIn = volleyHits(b.state, b.ctx, inside!, att!, 100, 0);
    // The walk point sits next to a tower (one per 30 deg at level 2): walls x1.2 and tower x1.2.
    console.log(`[siege] range on wall ${rWall.toFixed(0)} m vs ${rIn.toFixed(0)} m; hits x${(hWall / hIn).toFixed(2)}`);
    expect(rWall / rIn).toBeCloseTo(1.2 * 1.2, 5);
    expect(hWall / hIn).toBeCloseTo(1.2 * 1.2, 5);
    // Melee defense on the walls x1.3 (before armor).
    const wallDef = meleeDefenseValue(b.ctx, onWall!);
    const fortSaved = b.ctx.fort;
    (b.ctx as { fort: typeof fortSaved }).fort = null;
    const openDef = meleeDefenseValue(b.ctx, onWall!);
    (b.ctx as { fort: typeof fortSaved }).fort = fortSaved;
    const armor = b.ctx.stats[onWall!.index]!.armor;
    expect((wallDef - armor) / (openDef - armor)).toBeCloseTo(1.3, 5);
  });

  it('defender engineers repair a damaged gate at +10 HP/s', () => {
    const inner = { x: 0, z: 0 };
    const b = siege([{ cls: 'spearmen', x: 0, z: 350, facing: PI }], [{ cls: 'engineers', x: 0, z: 70, facing: 0 }, { cls: 'spearmen', x: 0, z: -40, facing: 0 }]);
    const g = b.ctx.fort!;
    ringPoint(g, g.gateAngle[0]!, R - 14, inner);
    const gate = b.state.siege!.gates[0]!;
    gate.hp = 100;
    expect(order(b, 1, 1, { type: 'construct', work: 'repair_gate', x: inner.x, z: inner.z, facing: 0 })).toBeNull();
    expect(order(b, 0, 0, { type: 'construct', work: 'repair_gate', x: inner.x, z: inner.z, facing: 0 })).toBeTruthy();
    runFor(b, 60, (s) => s.formations[1]!.activity === 'constructing');
    const hp0 = gate.hp;
    runFor(b, 5);
    expect(gate.hp - hp0).toBeCloseTo(50, 0);
  });
});

describe('siege victory', () => {
  it('an attacker formation holding the inside of a breach for 60 s, uncontested, wins (siege_breach)', () => {
    const breach = { x: 0, z: 0 };
    const inside = { x: 0, z: 0 };
    ringPoint({ cx: 0, cz: 0, radius: R } as Parameters<typeof ringPoint>[0], (1.5 / 12) * 2 * PI, R, breach);
    ringPoint({ cx: 0, cz: 0, radius: R } as Parameters<typeof ringPoint>[0], (1.5 / 12) * 2 * PI, R - 25, inside);
    const b = siege(
      [{ cls: 'spearmen', x: breach.x * 1.3, z: breach.z * 1.3, facing: PI }],
      [{ cls: 'spearmen', x: -breach.x * 0.4, z: -breach.z * 0.4, facing: 0 }],
    );
    issueBattleCommand(b.state, 1, { kind: 'set_stance', formations: [1], stance: 'hold_fire' });
    b.state.siege!.segments[1]!.hp = 0;
    order(b, 0, 0, { type: 'move_to', x: inside.x, z: inside.z, facing: PI, run: false });
    runFor(b, 120, (s) => !!s.siege!.breachHold);
    const hold = b.state.siege!.breachHold!;
    expect(hold.formation).toBe(0);
    runFor(b, 59);
    expect(b.state.outcome).toBeNull();
    expect(breachHeld(b.state)).toBe(false);
    runFor(b, 1.5);
    expect(b.state.outcome?.winner).toBe(0);
    expect(b.state.outcome?.reason).toBe('siege_breach');
    expect(b.state.time - hold.since).toBeGreaterThanOrEqual(60);
  });

  it('a defender within 40 m contests the breach (no hold); the defender wins at the time limit (siege_held)', () => {
    const breach = { x: 0, z: 0 };
    const inside = { x: 0, z: 0 };
    ringPoint({ cx: 0, cz: 0, radius: R } as Parameters<typeof ringPoint>[0], (1.5 / 12) * 2 * PI, R, breach);
    ringPoint({ cx: 0, cz: 0, radius: R } as Parameters<typeof ringPoint>[0], (1.5 / 12) * 2 * PI, R - 25, inside);
    const b = testBattle({
      kind: 'siege',
      fortification: fort(),
      attackerSide: 0,
      timeLimitSec: 90,
      sides: [
        [{ cls: 'spearmen', x: inside.x, z: inside.z, facing: PI }],
        // Beside the breach on the wall walk, ~36 m from it: inside the 40 m contest radius.
        [{ cls: 'spearmen', x: Math.sin((62 * PI) / 180) * (R - 12), z: Math.cos((62 * PI) / 180) * (R - 12), facing: 0 }],
      ],
    });
    for (const s of [0, 1] as const) issueBattleCommand(b.state, s, { kind: 'set_stance', formations: [s], stance: 'hold_fire' });
    b.state.siege!.segments[1]!.hp = 0;
    runFor(b, 100);
    expect(b.state.siege!.breachHold).toBeNull();
    expect(b.state.outcome?.winner).toBe(1);
    expect(b.state.outcome?.reason).toBe('siege_held');
  });
});

/** Point at facing angle `a` (0 = +Z, PI/2 = +X) and distance `r` from the fort center (0, 0). */
function at(a: number, r: number): { x: number; z: number } {
  return ringPoint({ cx: 0, cz: 0, radius: R } as Parameters<typeof ringPoint>[0], a, r, { x: 0, z: 0 });
}

describe("§6.8 / §6.6.5 [REQ GP-01]: a garrison's arrowless archers on their own walls hold the field", () => {
  // The attacker comes from +Z (main gate, segment 0); the garrison archers stand on the west wall walk (270 deg,
  // 12 m inside the radius: onWalls), out of arrows; the garrison spear block is made to rout (morale 5).
  const WEST = (3 * PI) / 2;

  function garrison(archers: { x: number; z: number }, timeLimitSec: number | null): TestBattle {
    const b = testBattle({
      kind: 'siege',
      fortification: fort(),
      attackerSide: 0,
      timeLimitSec,
      sides: [
        [{ cls: 'spearmen', x: 0, z: 320, facing: PI }],
        [
          { cls: 'archers', x: archers.x, z: archers.z, facing: WEST },
          { cls: 'spearmen', x: 0, z: 30, facing: 0 },
        ],
      ],
    });
    b.state.formations[1]!.ammo = 0;
    b.state.formations[2]!.morale = 5;
    return b;
  }

  it('(a) the garrison melee all rout while its dry archers stand on intact walls: not broken, the battle goes on (siege_held at the time limit)', () => {
    const b = garrison(at(WEST, R - 12), 120);
    const arch = b.state.formations[1]!;
    const spear = b.state.formations[2]!;
    expect(onWalls(b.ctx, arch)).toBe(true);
    runFor(b, 10);
    expect(spear.activity).toBe('routing');
    expect(arch.ammo).toBe(0);
    expect(arch.engagedWith.length).toBe(0);
    expect(arch.activity).not.toBe('routing');
    expect(holdsTheField(arch, b.ctx)).toBe(true);
    expect(sideBroken(b.state, 1)).toBe(false);
    expect(b.state.siege!.breaches).toEqual([]);
    expect(b.state.outcome).toBeNull();
    // The walls are never taken (no breach, no ladder): the defender wins at the time limit.
    runFor(b, 200);
    expect(b.state.outcome?.winner).toBe(1);
    expect(b.state.outcome?.reason).toBe('siege_held');
    expect(b.state.outcome?.durationSec).toBeGreaterThanOrEqual(120);
  });

  it('(b) the same dry archers stepped off the walls (inside the town or outside the ring) are broken: the attacker wins by rout', () => {
    for (const [where, p] of [
      ['in the town square', at(WEST, 30)],
      ['outside the ring', at(WEST, R + 30)],
    ] as const) {
      const b = garrison(p, 120);
      const arch = b.state.formations[1]!;
      expect(onWalls(b.ctx, arch), where).toBe(false);
      expect(holdsTheField(arch, b.ctx), where).toBe(false);
      runFor(b, 10);
      const o = b.state.outcome;
      expect(o, where).not.toBeNull();
      expect(o!.winner, where).toBe(0);
      expect(o!.reason, where).toBe('rout');
      expect(o!.durationSec, where).toBeLessThan(10);
      expect(arch.activity, where).not.toBe('routing');
    }
  });

  it('(c) breach-hold victory still ends a siege whose dry wall archers stand elsewhere on the ring (siege_breach after 60 s)', () => {
    const breachA = (1.5 / 12) * 2 * PI; // middle of segment 1 (45 deg)
    const breach = at(breachA, R);
    const inside = at(breachA, R - 25);
    const wall = at(breachA + PI, R - 12); // the opposite wall walk, ~216 m from the breach
    const b = siege([{ cls: 'spearmen', x: breach.x * 1.3, z: breach.z * 1.3, facing: PI }], [{ cls: 'archers', x: wall.x, z: wall.z, facing: breachA + PI }]);
    const arch = b.state.formations[1]!;
    arch.ammo = 0;
    expect(onWalls(b.ctx, arch)).toBe(true);
    expect(holdsTheField(arch, b.ctx)).toBe(true);
    expect(sideBroken(b.state, 1)).toBe(false);
    b.state.siege!.segments[1]!.hp = 0;
    order(b, 0, 0, { type: 'move_to', x: inside.x, z: inside.z, facing: PI, run: false });
    runFor(b, 120, (s) => !!s.siege!.breachHold);
    const hold = b.state.siege!.breachHold!;
    expect(hold.formation).toBe(0);
    // The archers keep the garrison in the battle (without the exception it would have ended at once by rout) ...
    expect(b.state.outcome).toBeNull();
    runFor(b, 59);
    expect(b.state.outcome).toBeNull();
    // ... until the breach has been held 60 s.
    runFor(b, 1.5);
    expect(b.state.outcome?.winner).toBe(0);
    expect(b.state.outcome?.reason).toBe('siege_breach');
    expect(b.state.time - hold.since).toBeGreaterThanOrEqual(60);
    expect(arch.activity).not.toBe('routing');
    expect(onWalls(b.ctx, arch)).toBe(true);
  });
});
