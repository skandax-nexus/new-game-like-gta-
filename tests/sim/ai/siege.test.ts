/**
 * Siege battle AI end to end (DESIGN_SPEC §6.6.5, §6.1; SIM-02 spec 1 "siege attack / defence"; SIM-02 review round 1
 * lead items 1-3 and the Creative Director's siege rules a-d). OWNER: AI Engineer - Battle AI, Intents & Campaign AI
 * (SIM-02); the first two tests were added in the SIM-02 lead review.
 *
 * Real battles (createBattle / stepBattle) on the flat test terrain, built by harness/sieges.ts: a town of radius 120 m
 * (fort level 2: 2 gates of 251 HP, 12 towers) at the centre, the besiegers coming from +Z.
 *  - Attack against a garrison that stands still (player-controlled, no orders): the ram is built out of bow shot,
 *    carried to the gate behind the screen, breaks it, and the breach is held 60 s (siege_breach).
 *  - AI against AI ('engineers': 3 spears, 2 archers, 2 engineers, 1 horse against 2 archers, 2 spears, engineers): the
 *    archers stand off beyond the wall archers' reach until the ram is committed, a palisade goes up, the ram reaches
 *    the gate, and the battle ends in a breach or a withdrawal whose reason the plan memory states - never by the time
 *    limit with the assault standing idle.
 *  - Defence: the towers nearest the threatened gate are manned first, a damaged gate is repaired, the horse sallies
 *    against an unguarded ram crew and comes back inside.
 */
import { describe, expect, it } from 'vitest';
import type { EngineerWorkState } from '../../../src/core/types';
import { ringPoint } from '../../../src/sim/tactical/fort';
import { RULES } from '../../../src/data/rules';
import { runFor } from '../tactical/helpers';
import { siegeBattle, summarize, TOWN_RADIUS } from './harness/sieges';
import type { TestBattle } from '../tactical/helpers';

/** A finished ram of side 0 standing uncrewed at (x, z) (its engineers routed). */
function abandonedRam(b: TestBattle, x: number, z: number): EngineerWorkState {
  const w: EngineerWorkState = { work: 'ram', x, z, facing: Math.PI, side: 0, hp: 150, maxHp: 150, progress: 1, formation: -1 };
  b.state.works.push(w);
  return w;
}

describe('siege attack (AI besiegers)', () => {
  it('a free engineer formation takes over a ram whose crew routed', () => {
    const b = siegeBattle('engineers', {
      controllers: ['ai', 'player'],
      attackers: [{ cls: 'spearmen', x: -40, z: 440 }, { cls: 'engineers', x: 60, z: 470 }],
      defenders: [{ cls: 'spearmen', x: 0, z: 40 }],
    });
    const ram = abandonedRam(b, 0, 380);
    runFor(b, 120, (s) => s.works.some((w) => w === ram && w.formation === 1));
    expect(ram.formation, `ram crew (engineer order ${b.state.formations[1]!.order.type})`).toBe(1);
    // ...and carries it toward the gate (no wall shooters: the cover is ready at once).
    const z0 = ram.z;
    runFor(b, 30);
    expect(ram.z).toBeLessThan(z0 - 5);
  });

  it('with no engineer, elephant, crewed ram, breach or ladder left, the assault is given up (withdraw_all) and says why', () => {
    const b = siegeBattle('engineers', {
      controllers: ['ai', 'player'],
      attackers: [{ cls: 'spearmen', x: -40, z: 440 }, { cls: 'spearmen', x: 40, z: 440 }, { cls: 'cavalry', x: 120, z: 440 }],
      defenders: [{ cls: 'spearmen', x: 0, z: 40 }],
    });
    // A finished ram lies abandoned before the gate (its engineers routed): nobody is left to carry it.
    abandonedRam(b, 0, 300);
    runFor(b, 90, (s) => s.sides[0].withdrawn);
    expect(b.state.sides[0].withdrawn).toBe(true);
    expect(b.state.time).toBeLessThan(45);
    expect(String(b.state.sides[0].aiMemory.withdrawReason)).toMatch(/nothing left to breach/);
  });

  it('the ram is built out of bow shot, carried to the gate behind the screen, breaks it, and the breach is held 60 s (siege_breach)', () => {
    // The garrison stands (player-controlled, no orders) on the far side of the town: an archer formation on the south
    // wall walk and a spear block behind it - nobody contests the breach, so the first stormer inside holds it.
    const b = siegeBattle('ram_only', {
      controllers: ['ai', 'player'],
      defenders: [
        { cls: 'archers', x: 0, z: -106 },
        { cls: 'spearmen', x: -20, z: -80 },
      ],
      timeLimitSec: 1800,
    });
    const s = summarize(b, 1800);
    expect(s.ramBuilt, 'ram built').not.toBeNull();
    expect(s.ramAtGate, 'ram carried to the gate').not.toBeNull();
    expect(s.gateBroken, 'gate broken').not.toBeNull();
    expect(s.gateBroken!).toBeGreaterThanOrEqual(s.ramAtGate!);
    expect(s.breachHoldSince, 'breach held').not.toBeNull();
    expect(s.outcome).toBe('siege_breach');
    expect(s.winner).toBe(0);
    // Held for the full 60 s (RULES.battle.walls.holdBreachSec) before the battle ended.
    expect(s.minutes * 60 - s.breachHoldSince!).toBeGreaterThanOrEqual(RULES.battle.walls.holdBreachSec - 0.5);
  }, 120_000);

  it('AI against AI: archers stand off beyond the walls’ reach until committed, a palisade goes up, the ram reaches the gate, and the battle ends in a breach or a reasoned withdrawal', () => {
    const b = siegeBattle('engineers', { controllers: ['ai', 'ai'], timeLimitSec: 1800 });
    const s = summarize(b, 1800);
    // Wall archers reach range x1.2 (walls) x1.2 (tower) = 230 m; the stand-off keeps a margin beyond the wall walk.
    const reach = 160 * RULES.battle.walls.range;
    expect(s.archerExposure, 'attacking archers never closed on a wall archer with arrows before the ram was committed').toBeGreaterThan(reach + 15);
    expect(s.palisades, 'palisade raised for the archers').toBeGreaterThanOrEqual(1);
    expect(s.ramAtGate, 'ram carried to the gate').not.toBeNull();
    expect(s.gateBroken, 'gate broken').not.toBeNull();
    expect(s.stormerJam, 'stormers never stood jammed before the way in').toBeLessThan(20);
    const breach = (s.outcome === 'siege_breach' || s.outcome === 'rout') && s.winner === 0;
    const reasoned = s.outcome === 'withdrawal' && s.withdrawReason !== null;
    expect(breach || reasoned, `${s.outcome} / ${s.withdrawReason}`).toBe(true);
    expect(s.minutes).toBeLessThan(29);
  }, 180_000);
});

describe('siege defence (AI garrison)', () => {
  it('archers man the intact towers nearest the threatened gate first', () => {
    const b = siegeBattle('engineers', {
      controllers: ['player', 'ai'],
      // The attackers stand before the main gate, out of bow shot.
      attackers: [{ cls: 'spearmen', x: 0, z: 400 }, { cls: 'engineers', x: 40, z: 420 }],
      defenders: [
        { cls: 'archers', x: -40, z: -60 },
        { cls: 'archers', x: 40, z: -60 },
        { cls: 'archers', x: 0, z: -20 },
        { cls: 'spearmen', x: 0, z: 0 },
      ],
    });
    const g = b.ctx.fort!;
    const sg = b.state.siege!;
    // Towers by angular distance from the gate nearest the attackers.
    const ga = g.gateAngle[0]!; // the main gate faces the attackers' approach
    const order = sg.towers.map((_, t) => t).sort((x, y) => Math.abs(Math.atan2(Math.sin(g.towerAngle[x]! - ga), Math.cos(g.towerAngle[x]! - ga))) - Math.abs(Math.atan2(Math.sin(g.towerAngle[y]! - ga), Math.cos(g.towerAngle[y]! - ga))));
    runFor(b, 180);
    const manned = sg.towers.map((t, i) => (t.garrison >= 0 ? i : -1)).filter((i) => i >= 0);
    expect(manned.length, `towers ${sg.towers.map((t) => t.garrison).join(',')}`).toBeGreaterThanOrEqual(2);
    // The towers manned are the nearest to the threatened gate (ties: the two flanking the gate's segment).
    const off = (t: number): number => Math.abs(Math.atan2(Math.sin(g.towerAngle[t]! - ga), Math.cos(g.towerAngle[t]! - ga)));
    const kth = off(order[manned.length - 1]!);
    for (const t of manned) expect(off(t), `tower ${t} of ${manned.join(',')} (order ${order.join(',')})`).toBeLessThanOrEqual(kth + 1e-6);
    // Both towers flanking the gate's segment are among them.
    expect(manned).toContain(order[0]);
    expect(manned).toContain(order[1]);
  }, 60_000);

  it('engineers repair a damaged gate', () => {
    const b = siegeBattle('engineers', {
      controllers: ['player', 'ai'],
      attackers: [{ cls: 'spearmen', x: 0, z: 420 }],
      defenders: [{ cls: 'spearmen', x: 0, z: 40 }, { cls: 'engineers', x: 0, z: -40 }],
    });
    const sg = b.state.siege!;
    for (const gt of sg.gates) gt.hp = gt.maxHp * 0.4;
    const before = sg.gates.map((x) => x.hp);
    runFor(b, 240);
    const gained = sg.gates.reduce((s, x, i) => s + (x.hp - before[i]!), 0);
    expect(gained, `gates ${sg.gates.map((x) => x.hp.toFixed(0)).join('/')}`).toBeGreaterThan(100);
  }, 60_000);

  it('the horse sallies against an unguarded ram crew outside the walls, then comes back inside', () => {
    const b = siegeBattle('engineers', {
      controllers: ['player', 'ai'],
      // An engineer formation with a finished ram, standing 70 m before the main gate with nobody guarding it.
      attackers: [{ cls: 'engineers', x: 0, z: 0 }, { cls: 'spearmen', x: 300, z: 600 }],
      defenders: [{ cls: 'cavalry', x: 0, z: 0 }, { cls: 'spearmen', x: 0, z: -40 }],
    });
    const g = b.ctx.fort!;
    const p = { x: 0, z: 0 };
    ringPoint(g, g.mainAngle, TOWN_RADIUS + 70, p);
    const eng = b.state.formations[0]!;
    eng.x = p.x;
    eng.z = p.z;
    b.state.works.push({ work: 'ram', x: p.x, z: p.z, facing: g.mainAngle + Math.PI, side: 0, hp: 150, maxHp: 150, progress: 1, formation: 0 });
    const horse = b.state.formations[2]!;
    let out = false;
    runFor(b, 180, (s) => {
      const d = Math.hypot(horse.x, horse.z);
      if (d > TOWN_RADIUS + 15) out = true;
      return out && (eng.soldiers <= 0 || eng.activity === 'routing');
    });
    expect(out, `horse order ${horse.order.type} at ${horse.x.toFixed(0)},${horse.z.toFixed(0)}`).toBe(true);
    expect(eng.soldiers <= 0 || eng.activity === 'routing' || eng.activity === 'surrendered').toBe(true);
    // ...and returns behind the walls once the crew is gone.
    runFor(b, 240, () => Math.hypot(horse.x, horse.z) < TOWN_RADIUS - 10);
    expect(Math.hypot(horse.x, horse.z)).toBeLessThan(TOWN_RADIUS);
  }, 60_000);
});
