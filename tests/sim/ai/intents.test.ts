/**
 * Intent orders (DESIGN_SPEC §6.4): each of the eight intents produces the tabled placement / behaviour on synthetic
 * maps. OWNER: AI Engineer - Battle AI, Intents & Campaign AI (SIM-02).
 *
 * The battles are real (createBattle / stepBattle): intents are issued as commands and translated by the sim every
 * 1 s (AI_THINK_TICKS); the tests read where the formations stand and which orders they carry.
 */
import { describe, expect, it } from 'vitest';
import type { BattleState, FormationState, IntentOrder, SideIndex, TerrainClass } from '../../../src/core/types';
import { angleDelta } from '../../../src/core/math';
import { issueBattleCommand } from '../../../src/sim/tactical/battle';
import { CROSSING, INTENT, crossingLayout, highGroundPoint, screenStation } from '../../../src/sim/tactical/ai/intents';
import { runFor, testBattle, TestTerrain } from '../tactical/helpers';
import type { TestBattle } from '../tactical/helpers';

const PI = Math.PI;

function intent(b: TestBattle, side: SideIndex, formations: number[], i: IntentOrder): void {
  expect(issueBattleCommand(b.state, side, { kind: 'intent', formations, intent: i })).toBeNull();
}

function f(b: TestBattle, i: number): FormationState {
  return b.state.formations[i]!;
}

function gap(a: FormationState, c: FormationState): number {
  return Math.hypot(a.x - c.x, a.z - c.z) - a.depth / 2 - c.depth / 2;
}

/** A river along x (deep |z| < 20) with a ford (shallow) for |x| < 15. */
function riverClass(x: number, z: number): TerrainClass {
  if (Math.abs(z) >= 20) return 'open';
  return Math.abs(x) < 15 ? 'shallow_water' : 'deep_water';
}

describe('hold_crossing (§6.4)', () => {
  const terrain = new TestTerrain({ classAt: riverClass });
  const make = (): TestBattle =>
    testBattle({
      terrain,
      sides: [
        [
          { cls: 'spearmen', x: -60, z: 170, facing: PI },
          { cls: 'spearmen', x: 60, z: 170, facing: PI },
          { cls: 'archers', x: 0, z: 200, facing: PI },
          { cls: 'cavalry', x: 120, z: 200, facing: PI },
          { cls: 'cavalry', x: -120, z: 200, facing: PI },
        ],
        [{ cls: 'spearmen', x: 0, z: -150, facing: 0 }],
      ],
    });
  const crossing: IntentOrder = { type: 'hold_crossing', x: 0, z: 0, radius: 60 };

  it('spears in line across the ford axis at the near bank facing the far bank; archers 25 m behind; mounted 60 m back on the flanks', () => {
    const b = make();
    intent(b, 0, [0, 1, 2, 3, 4], crossing);
    runFor(b, 150);
    const lay = crossingLayout(b.state, 0, crossing as Extract<IntentOrder, { type: 'hold_crossing' }>, terrain, f(b, 0).depth);
    // The ford runs across z (the river along x); the near bank of side 0 (deployed at +z) is at z = +20.
    expect(lay.axis.river).toBe(true);
    expect(lay.axis.nz).toBeCloseTo(1, 3);
    expect(Math.abs(lay.axis.nx)).toBeLessThan(1e-6);
    expect(lay.axis.nearBank).toBeGreaterThanOrEqual(20);
    expect(lay.axis.nearBank).toBeLessThanOrEqual(24);
    const [s0, s1, arc, c0, c1] = [f(b, 0), f(b, 1), f(b, 2), f(b, 3), f(b, 4)];
    // Line on dry ground just off the near bank, straddling the ford axis (x = 0), facing the far bank (-z).
    for (const s of [s0, s1]) {
      expect(terrain.isWater(s.x, s.z)).toBe(false);
      expect(s.z - s.depth / 2).toBeGreaterThanOrEqual(20);
      expect(s.z).toBeLessThan(20 + CROSSING.bankStandoff + s.depth + 6);
      expect(Math.abs(angleDelta(s.facing, PI))).toBeLessThan(0.1);
    }
    expect(Math.abs(s0.z - s1.z)).toBeLessThan(2);
    expect(Math.min(s0.x, s1.x)).toBeLessThan(0);
    expect(Math.max(s0.x, s1.x)).toBeGreaterThan(0);
    expect(Math.abs((s0.x + s1.x) / 2)).toBeLessThan(4);
    const lineZ = (s0.z + s1.z) / 2;
    // Archers 25 m behind the line (centre to centre), on the axis.
    expect(arc.z - lineZ).toBeGreaterThan(CROSSING.archersBehind - 3);
    expect(arc.z - lineZ).toBeLessThan(CROSSING.archersBehind + 3);
    expect(Math.abs(arc.x)).toBeLessThan(4);
    // Mounted 60 m back, one on each flank beyond the line's ends.
    const halfLine = (Math.max(s0.x, s1.x) + Math.max(s0.width, s1.width) / 2) | 0;
    for (const c of [c0, c1]) {
      expect(c.z - lineZ).toBeGreaterThan(CROSSING.mountedBack - 4);
      expect(c.z - lineZ).toBeLessThan(CROSSING.mountedBack + 4);
      expect(Math.abs(c.x)).toBeGreaterThan(halfLine);
    }
    expect(Math.sign(c0.x)).not.toBe(Math.sign(c1.x));
  });

  it('engages only enemies inside r and never past the far bank', () => {
    const b = make();
    intent(b, 0, [0, 1, 2, 3, 4], crossing);
    runFor(b, 120);
    // The enemy waits beyond the far bank (outside r): the line stays at the bank.
    const enemy = f(b, 5);
    enemy.x = 0;
    enemy.z = -75;
    runFor(b, 20);
    expect(f(b, 0).order.type).not.toBe('attack_target');
    expect(f(b, 1).order.type).not.toBe('attack_target');
    expect(Math.min(f(b, 0).z, f(b, 1).z)).toBeGreaterThan(20);
    // It wades into the ford (inside r): the nearest spears attack it.
    enemy.z = -8;
    runFor(b, 2);
    const attacking = [f(b, 0), f(b, 1)].filter((s) => s.order.type === 'attack_target' && s.order.target === enemy.index);
    expect(attacking.length).toBeGreaterThan(0);
    // Back beyond the far bank: the spears return to the bank instead of pursuing.
    enemy.z = -90;
    runFor(b, 2);
    for (const s of [f(b, 0), f(b, 1)]) expect(s.order.type === 'attack_target' && s.order.target === enemy.index).toBe(false);
  });
});

describe('protect_formation (§6.4)', () => {
  it('stands between the protected formation and the nearest threat at 25 m; intercepts a melee enemy within 120 m', () => {
    const b = testBattle({
      sides: [
        [
          { cls: 'archers', x: 0, z: 100, facing: PI },
          { cls: 'spearmen', x: 80, z: 160, facing: PI },
        ],
        [
          { cls: 'spearmen', x: 0, z: -200, facing: 0 },
          { cls: 'cavalry', x: 350, z: -300, facing: 0 },
        ],
      ],
    });
    intent(b, 0, [1], { type: 'protect_formation', target: 0 });
    runFor(b, 90);
    const arc = f(b, 0);
    const spr = f(b, 1);
    const threat = f(b, 2);
    // On the line from the archers to the threat, 25 m (footprint gap) in front of the archers, facing the threat.
    expect(gap(arc, spr)).toBeGreaterThan(INTENT.protectGap - 3);
    expect(gap(arc, spr)).toBeLessThan(INTENT.protectGap + 3);
    expect(Math.abs(spr.x - arc.x)).toBeLessThan(4);
    expect(spr.z).toBeLessThan(arc.z);
    expect(Math.abs(angleDelta(spr.facing, Math.atan2(threat.x - spr.x, threat.z - spr.z)))).toBeLessThan(0.15);
    // Enemy horse comes within 120 m of the archers: intercept it.
    const cav = f(b, 3);
    cav.x = 70;
    cav.z = 40;
    runFor(b, 1.05);
    expect(spr.order.type).toBe('attack_target');
    expect(spr.order.type === 'attack_target' && spr.order.target).toBe(cav.index);
    // Gone again: return to the guard post.
    cav.x = 380;
    cav.z = -380;
    runFor(b, 1.05);
    expect(spr.order.type).toBe('move_to');
  });
});

describe('hold_high_ground (§6.4)', () => {
  // A 24 m hill centred at (90, 60).
  const hill = (x: number, z: number): number => 1 + 24 * Math.exp(-((x - 90) * (x - 90) + (z - 60) * (z - 60)) / (2 * 30 * 30));
  const terrain = new TestTerrain({ heightAt: hill });

  it('the 16-sample search finds the highest sample within r', () => {
    const p = highGroundPoint(terrain, 40, 40, 60);
    // Brute force over the same 16 samples (centre, 5 at r/2, 10 at r).
    const pts: [number, number][] = [[40, 40]];
    for (let i = 0; i < 5; i++) pts.push([40 + Math.sin((i / 5) * 2 * PI) * 30, 40 + Math.cos((i / 5) * 2 * PI) * 30]);
    for (let i = 0; i < 10; i++) pts.push([40 + Math.sin(((i + 0.5) / 10) * 2 * PI) * 60, 40 + Math.cos(((i + 0.5) / 10) * 2 * PI) * 60]);
    expect(pts.length).toBe(16);
    const best = Math.max(...pts.map(([x, z]) => hill(x, z)));
    expect(p.height).toBeCloseTo(best, 6);
    expect(p.height).toBeGreaterThan(hill(40, 40) + 5);
  });

  it('moves to the highest point within r, faces the nearest enemy and holds; archers shoot from it', () => {
    const b = testBattle({
      terrain,
      sides: [
        [
          { cls: 'spearmen', x: 0, z: 160, facing: PI },
          { cls: 'archers', x: -40, z: 170, facing: PI },
        ],
        [{ cls: 'spearmen', x: 60, z: -150, facing: 0 }],
      ],
    });
    intent(b, 0, [0, 1], { type: 'hold_high_ground', x: 40, z: 40, radius: 60 });
    runFor(b, 180);
    const top = highGroundPoint(terrain, 40, 40, 60);
    const s = f(b, 0);
    const a = f(b, 1);
    const enemy = f(b, 2);
    // Both stand on the summit row (laterally side by side around the chosen point).
    const cx = (s.x + a.x) / 2;
    const cz = (s.z + a.z) / 2;
    expect(Math.hypot(cx - top.x, cz - top.z)).toBeLessThan(6);
    for (const g of [s, a]) {
      expect(terrain.heightAt(g.x, g.z)).toBeGreaterThan(hill(40, 40) + 4);
      expect(Math.abs(angleDelta(g.facing, Math.atan2(enemy.x - top.x, enemy.z - top.z)))).toBeLessThan(0.15);
      expect(g.order.type === 'hold' || g.order.type === 'move_to').toBe(true);
    }
    // The height adds range: the archers reach the enemy from farther than their flat range once it comes close.
    enemy.x = top.x;
    enemy.z = top.z - 165;
    runFor(b, 12);
    expect(b.events.some((e) => e.kind === 'volley' && e.formation === a.index) || a.ammo < 20).toBe(true);
  });
});

describe('pin_enemy (§6.4)', () => {
  it('advances to 60 m of the target and holds facing it; falls back 30 m when charged', () => {
    const b = testBattle({
      sides: [[{ cls: 'spearmen', x: 0, z: 250, facing: PI }], [{ cls: 'cavalry', x: 0, z: -150, facing: 0 }]],
    });
    intent(b, 0, [0], { type: 'pin_enemy', target: 1 });
    runFor(b, 300);
    const s = f(b, 0);
    const t = f(b, 1);
    expect(gap(s, t)).toBeGreaterThan(INTENT.pinGap - 10);
    expect(gap(s, t)).toBeLessThan(INTENT.pinGap + 10);
    expect(Math.abs(angleDelta(s.facing, Math.atan2(t.x - s.x, t.z - s.z)))).toBeLessThan(0.2);
    // The target charges: the pinning block gives ground (30 m) instead of standing.
    expect(issueBattleCommand(b.state, 1, { kind: 'order', formations: [1], order: { type: 'charge', target: 0 }, queue: false })).toBeNull();
    const z0 = s.z;
    let fell = false;
    for (let k = 0; k < 40 && !fell; k++) {
      runFor(b, 0.25);
      if (s.order.type === 'move_to' && s.order.run && s.order.z > z0 + 20) fell = true;
    }
    expect(fell).toBe(true);
  });

  it('ranged formations pin from inside their skirmish band and shoot', () => {
    const b = testBattle({
      sides: [[{ cls: 'archers', x: 0, z: 250, facing: PI }], [{ cls: 'spearmen', x: 0, z: -150, facing: 0 }]],
    });
    intent(b, 0, [0], { type: 'pin_enemy', target: 1 });
    runFor(b, 220);
    const a = f(b, 0);
    expect(gap(a, f(b, 1))).toBeGreaterThan(INTENT.pinGap - 5);
    expect(gap(a, f(b, 1))).toBeLessThan(0.9 * 160);
    expect(a.ammo).toBeLessThan(20);
  });
});

describe('screen_flank (§6.4)', () => {
  it('keeps 40 m beyond the chosen flank facing outward; intercepts mounted enemies inside 150 m', () => {
    const b = testBattle({
      sides: [
        [
          { cls: 'spearmen', x: 0, z: 100, facing: PI },
          { cls: 'cavalry', x: 0, z: 220, facing: PI },
        ],
        [
          { cls: 'spearmen', x: 0, z: -250, facing: 0 },
          { cls: 'cavalry', x: -400, z: -400, facing: 0 },
        ],
      ],
    });
    intent(b, 0, [1], { type: 'screen_flank', protect: 0, side: 'left' });
    runFor(b, 80);
    const p = f(b, 0);
    const c = f(b, 1);
    const st = screenStation(p, c, 'left');
    expect(Math.hypot(c.x - st.x, c.z - st.z)).toBeLessThan(5);
    // A block facing -z (PI) has its right on +x (right = (-cos f, sin f)), so its left flank is -x; the screen stands
    // beyond it and faces outward (-x).
    expect(p.x - c.x).toBeGreaterThan(p.width / 2 + INTENT.screenBeyond - 2);
    expect(Math.abs(angleDelta(c.facing, -PI / 2))).toBeLessThan(0.15);
    // Enemy horse inside 150 m: intercept.
    const e = f(b, 3);
    e.x = -160;
    e.z = 40;
    runFor(b, 1.05);
    expect(c.order.type === 'attack_target' && c.order.target === e.index).toBe(true);
  });
});

describe('pursue_routers (§6.4)', () => {
  it('mounted ride down the nearest router within 400 m, skip routers by steady enemies, and return when none remain', () => {
    const b = testBattle({
      sides: [
        [
          { cls: 'cavalry', x: 0, z: 100, facing: PI },
          { cls: 'spearmen', x: 100, z: 100, facing: PI },
        ],
        [
          { cls: 'spearmen', x: 0, z: -60, facing: 0, morale: 5 },
          { cls: 'archers', x: -300, z: -100, facing: 0, morale: 5 },
          { cls: 'spearmen', x: -300, z: -130, facing: 0 },
        ],
      ],
    });
    intent(b, 0, [0, 1], { type: 'pursue_routers' });
    runFor(b, 0.5);
    expect(f(b, 2).activity).toBe('routing');
    expect(f(b, 3).activity).toBe('routing');
    runFor(b, 1.2);
    const cav = f(b, 0);
    // The router by the steady spear block is ignored; the open one is chased.
    const chasing = (cav.order.type === 'move_to' && cav.order.run) || (cav.order.type === 'attack_target' && cav.order.target === 2);
    expect(chasing).toBe(true);
    if (cav.order.type === 'move_to') expect(Math.hypot(cav.order.x - f(b, 2).x, cav.order.z - f(b, 2).z)).toBeLessThan(Math.hypot(cav.order.x - f(b, 3).x, cav.order.z - f(b, 3).z));
    // Infantry carrying the intent do not pursue.
    expect(f(b, 1).order.type).toBe('hold');
    // No router left: the riders return to the own lines.
    for (const i of [2, 3]) {
      const r = f(b, i);
      r.soldiers = 0;
      r.activity = 'destroyed';
    }
    runFor(b, 1.05);
    expect(cav.order.type === 'move_to' || cav.order.type === 'hold').toBe(true);
    if (cav.order.type === 'move_to') expect(cav.order.run).toBe(false);
  });
});

describe('scout_area (§6.4)', () => {
  it('runs to the area, reveals hidden enemies there and keeps 100 m from any enemy', () => {
    const forest = (x: number, z: number): TerrainClass => (Math.abs(x - 0) < 60 && Math.abs(z + 120) < 40 ? 'forest' : 'open');
    const b = testBattle({
      kind: 'ambush',
      attackerSide: 0,
      terrain: new TestTerrain({ classAt: forest }),
      // Side 0 is Nilavana: its Forest Runners see 1.2 x farther (scouts reveal hidden formations within half of it,
      // 450 m) - so they start 570 m away.
      sides: [[{ cls: 'scouts', x: 0, z: 450, facing: PI }], [{ cls: 'archers', x: 0, z: -120, facing: 0 }]],
    });
    const hidden = f(b, 1);
    expect(hidden.hidden).toBe(true);
    intent(b, 0, [0], { type: 'scout_area', x: 0, z: 40, radius: 60 });
    runFor(b, 80);
    const sc = f(b, 0);
    // Revealed by the scouts' eyes (half their vision) before getting close.
    expect(hidden.hidden).toBe(false);
    expect(gap(sc, hidden)).toBeGreaterThan(INTENT.scoutKeep - 5);
    // An enemy closes inside 100 m: fall back.
    hidden.x = sc.x;
    hidden.z = sc.z - 70;
    runFor(b, 1.05);
    expect(sc.order.type).toBe('move_to');
    expect(sc.order.type === 'move_to' && sc.order.run && sc.order.z > sc.z).toBe(true);
  });
});

describe('escort_supply (§6.4)', () => {
  it('follows the train at 20 m on the enemy side and intercepts attackers within 80 m', () => {
    const b = testBattle({
      sides: [
        [
          { cls: 'supply_train', x: 0, z: 150, facing: PI },
          { cls: 'spearmen', x: 60, z: 220, facing: PI },
        ],
        [
          { cls: 'spearmen', x: 0, z: -250, facing: 0 },
          { cls: 'cavalry', x: 400, z: -400, facing: 0 },
        ],
      ],
    });
    intent(b, 0, [1], { type: 'escort_supply', target: 0 });
    runFor(b, 80);
    const train = f(b, 0);
    const esc = f(b, 1);
    expect(gap(train, esc)).toBeGreaterThan(INTENT.escortGap - 3);
    expect(gap(train, esc)).toBeLessThan(INTENT.escortGap + 3);
    expect(esc.z).toBeLessThan(train.z); // the enemy side
    // The train moves; the escort follows.
    expect(issueBattleCommand(b.state, 0, { kind: 'order', formations: [0], order: { type: 'move_to', x: 120, z: 160, facing: null, run: false }, queue: false })).toBeNull();
    runFor(b, 90);
    expect(gap(train, esc)).toBeLessThan(INTENT.escortGap + 6);
    // A rider comes within 80 m of the train: intercept.
    const cav = f(b, 3);
    cav.x = train.x + 50;
    cav.z = train.z - 60;
    runFor(b, 1.05);
    expect(esc.order.type === 'attack_target' && esc.order.target === cav.index).toBe(true);
  });
});

/** Keep the type import used (state helpers for future cases). */
export type { BattleState };
