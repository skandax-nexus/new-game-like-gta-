/**
 * Soldier layer (SoldierSim, GP-01 item 8): realizes the authoritative casualties faithfully - front ranks in melee,
 * random under arrows, gaps filled from behind - and drives the CORE-01 SoldierBuffers fields (anim + animVariant +
 * animStart, role flags, LOD). It never writes BattleState. OWNER: Gameplay Engineer - Tactical Battle Simulation.
 */
import { describe, expect, it } from 'vitest';
import type { BattleEventRecord } from '../../../src/core/types';
import { SOLDIER_ANIM, SOLDIER_FLAG, SOLDIER_LOD } from '../../../src/core/types';
import { BATTLE_DT } from '../../../src/core/constants';
import { hashState } from '../../../src/core/save';
import { issueBattleCommand, stepBattle } from '../../../src/sim/tactical/battle';
import { SHOOT_RELEASE_SEC, SoldierSim } from '../../../src/sim/tactical/soldiers';
import { testBattle } from './helpers';
import type { TestBattle, TestSetupOptions } from './helpers';

const PI = Math.PI;
const LOD = { lodNear: 70, lodMid: 220, lodFar: 900 };

function withSoldiers(o: TestSetupOptions): TestBattle & { sim: SoldierSim } {
  const b = testBattle(o);
  const sim = new SoldierSim(b.state, b.terrain.bounds);
  sim.spawn(b.state, b.terrain);
  return { ...b, sim };
}

/** Step battle + soldier layer together (focus at (fx, fz)); `each` runs after every step. */
function run(b: TestBattle & { sim: SoldierSim }, seconds: number, fx = 0, fz = 0, each?: () => void): void {
  const out: BattleEventRecord[] = [];
  for (let i = 0; i < Math.round(seconds / BATTLE_DT) && !b.state.outcome; i++) {
    out.length = 0;
    stepBattle(b.state, BATTLE_DT, b.terrain, out);
    for (const e of out) b.events.push(e);
    b.sim.step(b.state, BATTLE_DT, b.terrain, fx, fz, LOD);
    each?.();
  }
}

function soldiersOf(b: TestBattle & { sim: SoldierSim }, fi: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < b.sim.buffers.count; i++) if (b.sim.buffers.formation[i] === fi) out.push(i);
  return out;
}

describe('spawn and role flags', () => {
  it('one soldier per man on its slot; standard bearer, drummer, conch, officers, commander, riders', () => {
    const b = withSoldiers({
      sides: [
        [
          { cls: 'elite_guards', x: 0, z: 0, facing: 0, commander: true },
          { cls: 'cavalry', x: 60, z: 0, facing: 0 },
          { cls: 'war_elephants', x: -60, z: 0, facing: 0 },
        ],
        [{ cls: 'spearmen', x: 0, z: 400, facing: PI }],
      ],
    });
    const buf = b.sim.buffers;
    expect(buf.count).toBe(60 + 60 + 8 + 120);
    expect(b.sim.aliveCount()).toBe(buf.count);
    const count = (fi: number, flag: number): number => soldiersOf(b, fi).filter((i) => (buf.flags[i]! & flag) !== 0).length;
    for (const fi of [0, 1, 2, 3]) expect(count(fi, SOLDIER_FLAG.standardBearer)).toBe(1);
    expect(count(0, SOLDIER_FLAG.commander)).toBe(1);
    expect(count(3, SOLDIER_FLAG.commander)).toBe(1); // the largest formation commands side 1
    expect(count(1, SOLDIER_FLAG.commander)).toBe(0);
    expect(count(0, SOLDIER_FLAG.drummer)).toBe(1);
    expect(count(0, SOLDIER_FLAG.conch)).toBe(1);
    expect(count(0, SOLDIER_FLAG.officer)).toBe(2);
    expect(count(1, SOLDIER_FLAG.mounted)).toBe(60);
    expect(count(2, SOLDIER_FLAG.mounted)).toBe(8);
    expect(count(0, SOLDIER_FLAG.mounted)).toBe(0);
  });
});

describe('casualty realization', () => {
  it('melee: the front ranks fall and the soldiers behind step into the gaps; visual strength = authoritative', () => {
    const b = withSoldiers({
      sides: [[{ cls: 'spearmen', x: 0, z: 3.6, facing: PI, morale: 90 }], [{ cls: 'elite_guards', x: 0, z: -3.6, facing: 0, morale: 95 }]],
      factions: ['citystates', 'forest'],
    });
    const buf = b.sim.buffers;
    const f = b.state.formations[0]!;
    const deadDist: number[] = [];
    const aliveDist: number[] = [];
    run(b, 30, 0, 0, () => {
      expect(soldiersOf(b, 0).filter((i) => buf.alive[i]).length).toBe(f.soldiers);
    });
    const enemy = b.state.formations[1]!;
    for (const i of soldiersOf(b, 0)) {
      const d = Math.hypot(buf.posX[i]! - enemy.x, buf.posZ[i]! - enemy.z);
      (buf.alive[i] ? aliveDist : deadDist).push(d);
    }
    expect(deadDist.length).toBeGreaterThan(5);
    const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
    expect(mean(deadDist)).toBeLessThan(mean(aliveDist));
    // Front rank still full: slots 0..files-1 are held by living soldiers.
    const front = soldiersOf(b, 0).filter((i) => buf.alive[i] && buf.slot[i]! < f.files).length;
    expect(front).toBe(Math.min(f.files, f.soldiers));
  });

  it('arrows: casualties fall at random through the block (rear ranks too)', () => {
    const b = withSoldiers({
      sides: [[{ cls: 'archers', x: 0, z: 120, facing: PI }, { cls: 'archers', x: 40, z: 125, facing: PI }], [{ cls: 'spearmen', x: 0, z: 0, facing: 0 }]],
      factions: ['forest', 'citystates'],
    });
    issueBattleCommand(b.state, 1, { kind: 'set_stance', formations: [2], stance: 'hold_fire' });
    const buf = b.sim.buffers;
    run(b, 60);
    const target = b.state.formations[2]!;
    const dead = soldiersOf(b, 2).filter((i) => !buf.alive[i]);
    expect(dead.length).toBe(target.killed);
    // Not only the front: dead bodies lie in the rear half of the block too.
    const rear = dead.filter((i) => {
      const lz = (buf.posX[i]! - target.x) * Math.sin(target.facing) + (buf.posZ[i]! - target.z) * Math.cos(target.facing);
      return lz < 0;
    });
    expect(rear.length).toBeGreaterThan(0);
  });

  it('surrendered men stay standing (captured, not killed) and the layer never writes BattleState', () => {
    const b = withSoldiers({ sides: [[{ cls: 'spearmen', x: 0, z: 0, facing: 0 }, { cls: 'spearmen', x: -200, z: 0, facing: 0 }], [{ cls: 'spearmen', x: 0, z: 300, facing: PI }]] });
    issueBattleCommand(b.state, 0, { kind: 'surrender' });
    const h = hashState(b.state);
    b.sim.step(b.state, BATTLE_DT, b.terrain, 0, 0, LOD);
    expect(hashState(b.state)).toBe(h);
    expect(b.sim.aliveCount()).toBe(360);
  });
});

describe('animation sync', () => {
  it('contact ranks attack (3 variants, staggered starts); the dead play die (2 variants) then lie dead', () => {
    const b = withSoldiers({
      sides: [[{ cls: 'spearmen', x: 0, z: 3.6, facing: PI, morale: 90 }], [{ cls: 'spearmen', x: 0, z: -3.6, facing: 0, morale: 90 }]],
      factions: ['citystates', 'forest'],
    });
    const buf = b.sim.buffers;
    run(b, 12);
    const attackers = soldiersOf(b, 0).filter((i) => buf.alive[i] && buf.anim[i] === SOLDIER_ANIM.attack);
    expect(attackers.length).toBeGreaterThan(20);
    const variants = new Set(attackers.map((i) => buf.animVariant[i]));
    expect([...variants].every((v) => v! <= 2)).toBe(true);
    expect(variants.size).toBe(3);
    expect(new Set(attackers.map((i) => buf.animStart[i]!.toFixed(2))).size).toBeGreaterThan(10);
    // Rear ranks of a spear wall lower their spears (brace).
    expect(soldiersOf(b, 0).some((i) => buf.alive[i] && buf.anim[i] === SOLDIER_ANIM.brace)).toBe(true);
    const dead = soldiersOf(b, 0).filter((i) => !buf.alive[i]);
    expect(dead.length).toBeGreaterThan(0);
    for (const i of dead) {
      expect(buf.animVariant[i]!).toBeLessThanOrEqual(1);
      if (b.state.time - buf.deathTime[i]! > 1.5) expect(buf.anim[i]).toBe(SOLDIER_ANIM.dead);
    }
  });

  it('archers loose on the volley tick (release frame at launch) and reload until the next volley', () => {
    const b = withSoldiers({ sides: [[{ cls: 'archers', x: 0, z: 120, facing: PI }], [{ cls: 'spearmen', x: 0, z: 0, facing: 0 }]], factions: ['forest', 'citystates'] });
    issueBattleCommand(b.state, 1, { kind: 'set_stance', formations: [1], stance: 'hold_fire' });
    const buf = b.sim.buffers;
    let checked = 0;
    let sawReload = false;
    const out: BattleEventRecord[] = [];
    for (let k = 0; k < 20 * 20; k++) {
      out.length = 0;
      stepBattle(b.state, BATTLE_DT, b.terrain, out);
      b.sim.step(b.state, BATTLE_DT, b.terrain, 0, 60, LOD);
      const v = out.find((e) => e.kind === 'volley' && e.formation === 0);
      const arc = soldiersOf(b, 0).filter((i) => buf.alive[i]);
      if (v) {
        const shooting = arc.filter((i) => buf.anim[i] === SOLDIER_ANIM.shoot);
        expect(shooting.length).toBe(arc.length);
        for (const i of shooting) expect(Math.abs(buf.animStart[i]! - (v.time - SHOOT_RELEASE_SEC))).toBeLessThanOrEqual(0.151);
        checked++;
      }
      if (arc.some((i) => buf.anim[i] === SOLDIER_ANIM.reload)) sawReload = true;
    }
    expect(checked).toBeGreaterThanOrEqual(2);
    expect(sawReload).toBe(true);
  });

  it('spears brace for an incoming charge; the horse charges (charge anim)', () => {
    const b = withSoldiers({ sides: [[{ cls: 'spearmen', x: 0, z: 0, facing: 0 }], [{ cls: 'cavalry', x: 0, z: 150, facing: PI }]] });
    issueBattleCommand(b.state, 1, { kind: 'order', formations: [1], order: { type: 'charge', target: 0 }, queue: false });
    const buf = b.sim.buffers;
    let braced = 0;
    let charging = 0;
    run(b, 30, 0, 60, () => {
      if (b.state.formations[0]!.engagedWith.length) return;
      braced = Math.max(braced, soldiersOf(b, 0).filter((i) => buf.anim[i] === SOLDIER_ANIM.brace).length);
      charging = Math.max(charging, soldiersOf(b, 1).filter((i) => buf.anim[i] === SOLDIER_ANIM.charge).length);
    });
    expect(braced).toBeGreaterThan(100);
    expect(charging).toBeGreaterThan(40);
  });

  it('routers drop the standard (raised again on rally); engineers work; victors cheer', () => {
    const b = withSoldiers({
      sides: [
        [{ cls: 'spearmen', x: 0, z: 0, facing: 0 }, { cls: 'engineers', x: -80, z: -80, facing: 0 }, { cls: 'spearmen', x: 150, z: 0, facing: 0 }],
        [{ cls: 'spearmen', x: 0, z: 400, facing: PI }],
      ],
    });
    const buf = b.sim.buffers;
    const std = (fi: number): number => soldiersOf(b, fi).filter((i) => buf.alive[i] && buf.flags[i]! & SOLDIER_FLAG.standardBearer).length;
    issueBattleCommand(b.state, 0, { kind: 'order', formations: [1], order: { type: 'construct', work: 'palisade', x: -80, z: -78, facing: 0 }, queue: false });
    b.state.formations[0]!.morale = 10;
    run(b, 1);
    expect(b.state.formations[0]!.activity).toBe('routing');
    expect(std(0)).toBe(0);
    expect(soldiersOf(b, 1).some((i) => buf.anim[i] === SOLDIER_ANIM.work)).toBe(true);
    // Rally: the standard goes up again.
    const f = b.state.formations[0]!;
    f.morale = 80;
    f.lastHitTime = -100;
    run(b, 1);
    expect(f.activity).toBe('rallying');
    expect(std(0)).toBe(1);
    // Victory: the enemy breaks; side 0 cheers.
    b.state.formations[3]!.morale = 5;
    run(b, 1);
    expect(b.state.outcome?.winner).toBe(0);
    b.sim.step(b.state, BATTLE_DT, b.terrain, 0, 0, LOD);
    const cheering = soldiersOf(b, 2).filter((i) => buf.anim[i] === SOLDIER_ANIM.cheer).length;
    expect(cheering).toBe(120);
  });
});

describe('LOD scheduling', () => {
  it('near soldiers update every step (20 Hz), mid every 2nd (10 Hz), far every 4th (5 Hz)', () => {
    const b = withSoldiers({
      sides: [
        [{ cls: 'spearmen', x: 0, z: 0, facing: 0 }, { cls: 'spearmen', x: 150, z: 0, facing: 0 }, { cls: 'spearmen', x: 400, z: 0, facing: 0 }],
        [{ cls: 'spearmen', x: 0, z: -480, facing: 0 }],
      ],
    });
    for (const fi of [0, 1, 2]) issueBattleCommand(b.state, 0, { kind: 'order', formations: [fi], order: { type: 'move_to', x: b.state.formations[fi]!.x, z: 200, facing: null, run: false }, queue: false });
    const buf = b.sim.buffers;
    const probe = [soldiersOf(b, 0)[50]!, soldiersOf(b, 1)[50]!, soldiersOf(b, 2)[50]!];
    const moves = [0, 0, 0];
    run(b, 2, 0, 0); // settle
    expect(buf.lod[probe[0]!]).toBe(SOLDIER_LOD.near);
    expect(buf.lod[probe[1]!]).toBe(SOLDIER_LOD.mid);
    expect(buf.lod[probe[2]!]).toBe(SOLDIER_LOD.far);
    const steps = 40;
    for (let k = 0; k < steps; k++) {
      const before = probe.map((i) => buf.posZ[i]!);
      run(b, BATTLE_DT, 0, 0);
      probe.forEach((i, j) => {
        if (buf.posZ[i]! !== before[j]) moves[j]!++;
      });
    }
    expect(moves[0]).toBe(steps);
    expect(moves[1]).toBe(steps / 2);
    expect(moves[2]).toBe(steps / 4);
  });
});
