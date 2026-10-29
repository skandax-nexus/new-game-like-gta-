/**
 * Melee faces and shares (DESIGN_SPEC §6.6.1, §6.2; GP-01 rework round 1, CD blocking item 2). OWNER: Gameplay
 * Engineer - Tactical Battle Simulation.
 *
 * Shares are counted per real aspect of the striking formation (front / left / right / rear). Face sizes: files on the
 * front, ranks on each flank, half the files on the rear; all-round shapes (square, circle) present their files on
 * every aspect, so a surrounded square strikes each attacker with its full files. The defender-side aspect multiplier
 * (attackAspect) is unchanged: 1 for all-round shapes.
 */
import { describe, expect, it } from 'vitest';
import type { BattleEventRecord, FormationShape } from '../../../src/core/types';
import { BATTLE_DT } from '../../../src/core/constants';
import { RULES } from '../../../src/data/rules';
import { stepBattle } from '../../../src/sim/tactical/battle';
import { attackAspect, faceSize, faceToward, meleeDamagePerSecond, meleeFrontage } from '../../../src/sim/tactical/combat';
import type { TestBattle } from './helpers';
import { hpLost, runFor, testBattle } from './helpers';

const PI = Math.PI;
/** Spear reach against non-spear foes (line / square with >= 2 ranks), §6.6.1. */
const REACH = 1.25;

/**
 * A 120-spear block (facing +Z) with 20-horse formations snapped onto the requested faces with a 0.3 m gap.
 * Flank attackers sit level with the block's centroid unless that would overlap the front attacker, in which case
 * they slide back (still on the flank). One tick is stepped so contacts are established by the real sim.
 */
function surrounded(shape: FormationShape, faces: ('front' | 'left' | 'right')[], n = 20): TestBattle {
  const horses = faces.map((f) => ({
    cls: 'cavalry' as const,
    n,
    x: f === 'front' ? 0 : f === 'left' ? -80 : 80,
    z: f === 'front' ? 80 : 0,
    facing: f === 'front' ? PI : f === 'left' ? PI / 2 : -PI / 2,
    shape: 'line' as const,
  }));
  const b = testBattle({ sides: [[{ cls: 'spearmen', x: 0, z: 0, facing: 0, shape }], horses], factions: ['citystates', 'citystates'] });
  const fs = b.state.formations;
  const sp = fs[0]!;
  const gap = 0.3;
  const front = faces.indexOf('front') >= 0 ? fs[1 + faces.indexOf('front')]! : null;
  if (front) front.z = sp.depth / 2 + front.depth / 2 + gap;
  faces.forEach((f, i) => {
    if (f === 'front') return;
    const h = fs[1 + i]!;
    const sgn = f === 'left' ? -1 : 1;
    h.x = sgn * (sp.width / 2 + h.depth / 2 + gap);
    h.z = 0;
    // Rotated by 90 degrees the flank horse spans its width along Z; slide it back if it would overlap the front one.
    if (front && Math.abs(h.x) - h.depth / 2 < front.width / 2) h.z = Math.min(0, front.z - front.depth / 2 - h.width / 2 - 0.5);
  });
  const out: BattleEventRecord[] = [];
  stepBattle(b.state, BATTLE_DT, b.terrain, out);
  return b;
}

/** Total expected HP/s the spear block deals to every formation in contact. */
function dealt(b: TestBattle): { total: number; per: number[]; faces: number[]; frontage: number[] } {
  const sp = b.state.formations[0]!;
  const per: number[] = [];
  const faces: number[] = [];
  const frontage: number[] = [];
  for (const oi of sp.engagedWith) {
    const h = b.state.formations[oi]!;
    per.push(meleeDamagePerSecond(b.state, b.ctx, sp, h));
    faces.push(faceToward(sp, h));
    frontage.push(meleeFrontage(b.state, sp, h));
  }
  return { total: per.reduce((a, v) => a + v, 0), per, faces, frontage };
}

describe('§6.6.1 melee faces: shares per real aspect', () => {
  it('a surrounded square strikes each attacker with its full files (CD probe: 120 spears, horse front / left / right)', () => {
    const sq = surrounded('square', ['front', 'left', 'right']);
    const sp = sq.state.formations[0]!;
    expect(sp.engagedWith.length).toBe(3);
    const d = dealt(sq);
    // Three different aspects (front, left, right), each its own face with one share.
    expect(new Set(d.faces).size).toBe(3);
    for (const fr of d.frontage) expect(fr).toBeCloseTo(sp.files * REACH, 6);
    // The defender-side multiplier of an all-round shape stays 1 (horse hitting the square from any side).
    for (let i = 1; i <= 3; i++) expect(attackAspect(sq.state.formations[i]!, sp)).toBe(0);
    // Same square, one attacker on the front only: the surrounded square deals three times that (the one real tick
    // of fighting moves cohesion / morale by a hair, hence 1%).
    const one = surrounded('square', ['front']);
    const single = dealt(one).total;
    expect(Math.abs(d.total - 3 * single)).toBeLessThanOrEqual(0.01 * d.total);
    console.log(`[faces] surrounded square: ${d.total.toFixed(2)} HP/s total (frontage ${d.frontage.map((v) => v.toFixed(2)).join(' / ')}); one attacker ${single.toFixed(2)} HP/s`);
  });

  it('the surrounded square deals >= 0.9 x the same block in line (strikers; HP/s net of the square attack modifier)', () => {
    const sq = dealt(surrounded('square', ['front', 'left', 'right']));
    const ln = surrounded('line', ['front', 'left', 'right']);
    const line = dealt(ln);
    const lsp = ln.state.formations[0]!;
    // The line meets front, left and right on three distinct faces: files + ranks + ranks.
    expect(new Set(line.faces)).toEqual(new Set([0, 1, 2]));
    const strikersSq = sq.frontage.reduce((a, v) => a + v, 0);
    const strikersLn = line.frontage.reduce((a, v) => a + v, 0);
    expect(strikersLn).toBeCloseTo((lsp.files + 2 * lsp.ranks) * REACH, 6);
    expect(strikersSq).toBeGreaterThanOrEqual(0.9 * strikersLn);
    // HP/s also carries the §6.2 shape attack modifiers (square 0.9, line 1.0): compare net of that data ratio.
    const shapeRatio = RULES.battle.shapes.square.meleeAttack / RULES.battle.shapes.line.meleeAttack;
    expect(sq.total).toBeGreaterThanOrEqual(0.9 * line.total * shapeRatio);
    console.log(
      `[faces] surrounded: square ${sq.total.toFixed(2)} HP/s (strikers ${strikersSq.toFixed(2)}) vs line ${line.total.toFixed(2)} HP/s (strikers ${strikersLn.toFixed(2)}); HP/s ratio ${(sq.total / line.total).toFixed(3)}, strikers ratio ${(strikersSq / strikersLn).toFixed(3)}, shape attack ratio ${shapeRatio}`,
    );
  });

  it('two attackers on opposite flanks each get the full ranks (left and right are separate faces)', () => {
    const b = surrounded('line', ['left', 'right'], 60);
    const sp = b.state.formations[0]!;
    expect(sp.engagedWith.length).toBe(2);
    const d = dealt(b);
    expect(new Set(d.faces)).toEqual(new Set([1, 2]));
    for (const fr of d.frontage) expect(fr).toBeCloseTo(sp.ranks * REACH, 6);
    expect(faceSize(sp, 1)).toBe(sp.ranks);
    expect(faceSize(sp, 2)).toBe(sp.ranks);
    console.log(`[faces] opposite flanks: frontage ${d.frontage.map((v) => v.toFixed(2)).join(' / ')} (ranks ${sp.ranks} x reach ${REACH})`);
  });

  it('two attackers on the same face still split it; the rear presents half the files', () => {
    const b = testBattle({
      sides: [
        [{ cls: 'spearmen', x: 0, z: 0, facing: 0, shape: 'line' }],
        [
          { cls: 'cavalry', n: 20, x: -7, z: 30, facing: PI, shape: 'line' },
          { cls: 'cavalry', n: 20, x: 13, z: 30, facing: PI, shape: 'line' },
        ],
      ],
      factions: ['citystates', 'citystates'],
    });
    const fs = b.state.formations;
    const sp = fs[0]!;
    for (const h of [fs[1]!, fs[2]!]) h.z = sp.depth / 2 + h.depth / 2 + 0.3;
    fs[1]!.x = -fs[1]!.width / 2 - 0.4;
    fs[2]!.x = fs[2]!.width / 2 + 0.4;
    stepBattle(b.state, BATTLE_DT, b.terrain, []);
    expect(sp.engagedWith.length).toBe(2);
    const d = dealt(b);
    expect(d.faces).toEqual([0, 0]);
    for (const fr of d.frontage) expect(fr).toBeCloseTo((sp.files * REACH) / 2, 6);
    expect(faceSize(sp, 3)).toBe(sp.files / 2);
    expect(faceSize(sp, 0)).toBe(sp.files);
    // All-round shapes present files on every aspect.
    const sq = surrounded('square', ['front']).state.formations[0]!;
    for (const a of [0, 1, 2, 3] as const) expect(faceSize(sq, a)).toBe(sq.files);
  });

  it('the simulated exchange applies it: the surrounded square takes 3 x the single-attacker toll over 1 s (+-15%)', () => {
    const three = surrounded('square', ['front', 'left', 'right']);
    const one = surrounded('square', ['front']);
    const expectThree = dealt(three).total;
    runFor(three, 1);
    runFor(one, 1);
    const lostThree = hpLost(three, 1) + hpLost(three, 2) + hpLost(three, 3);
    const lostOne = hpLost(one, 1);
    console.log(`[faces] simulated 1 s: surrounded square dealt ${lostThree.toFixed(2)} HP (expected ~${expectThree.toFixed(2)}), single front ${lostOne.toFixed(2)} HP`);
    expect(Math.abs(lostThree - expectThree)).toBeLessThanOrEqual(0.15 * expectThree);
    expect(lostThree).toBeGreaterThan(2.4 * lostOne);
  });
});
