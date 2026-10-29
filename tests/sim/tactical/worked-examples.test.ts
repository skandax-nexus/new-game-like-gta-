/**
 * DESIGN_SPEC worked examples reproduced by the formation sim (GP-01 acceptance: within 10%). OWNER: Gameplay Engineer -
 * Tactical Battle Simulation.
 *
 *  - §6.6.1 two fresh spear blocks (24 files, morale 60): 4.7 HP/s each way; a flank hit x1.5.
 *  - §6.6.2 8 elephants into unbraced spears 378 HP (~38 men); braced 13 men with 189 HP recoil; 60 horsemen into
 *    archers 126 HP (the example leaves out the default wedge's chargeImpact x1.3 - asserted both ways).
 *  - §6.6.3 a 100-archer volley into a spear block at 120 m: ~24 hits -> ~32 HP (3.2 men).
 *  - §6.6.4 8 elephants at morale 70 taking 24 hits: 8.6% panic per volley, ~40% after six; Royal Corps x0.7.
 *  - §6.7 the GDD morale example: target 70 -> commander fallen + flank collapse + supply threatened -> ~25 (rout).
 */
import { describe, expect, it } from 'vitest';
import type { BattleEventRecord, MoraleBreakdown } from '../../../src/core/types';
import { Rng } from '../../../src/core/rng';
import { chargeImpactHP, isBraced, meleeDamagePerSecond } from '../../../src/sim/tactical/combat';
import { addMoraleEvent, elephantPanicChance, recentEventsValue, scoreMorale } from '../../../src/sim/tactical/morale';
import { launchVolley, updateVolleys, volleyDamage } from '../../../src/sim/tactical/projectiles';
import { issueBattleCommand } from '../../../src/sim/tactical/battle';
import { shapeMods, variantStats } from '../../../src/sim/tactical/stats';
import { hpLost, runFor, testBattle, within } from './helpers';

const PI = Math.PI;

describe('§6.6.1 melee: spear block vs spear block', () => {
  const mk = () =>
    testBattle({
      sides: [[{ cls: 'spearmen', x: 0, z: 3.6, facing: PI, morale: 60 }], [{ cls: 'spearmen', x: 0, z: -3.6, facing: 0, morale: 60 }]],
      factions: ['forest', 'citystates'],
    });

  it('24 files, ATK 4.8, DEF 11 -> 4.7 HP/s each way', () => {
    const b = mk();
    const [a, d] = b.state.formations;
    expect(a!.files).toBe(24);
    const ab = meleeDamagePerSecond(b.state, b.ctx, a!, d!);
    const ba = meleeDamagePerSecond(b.state, b.ctx, d!, a!);
    console.log(`[worked] spear vs spear: ${ab.toFixed(2)} / ${ba.toFixed(2)} HP/s (spec 4.7)`);
    expect(within(ab, 4.7)).toBe(true);
    expect(within(ba, 4.7)).toBe(true);
  });

  it('the simulated exchange over 1 s matches (~0.47 men/s each way)', () => {
    const b = mk();
    runFor(b, 1);
    const lostA = hpLost(b, 0);
    const lostB = hpLost(b, 1);
    console.log(`[worked] simulated 1 s: ${lostA.toFixed(2)} / ${lostB.toFixed(2)} HP`);
    expect(within(lostA, 4.7, 0.15)).toBe(true);
    expect(within(lostB, 4.7, 0.15)).toBe(true);
  });

  it('a hit in the flank deals x1.5', () => {
    const b = testBattle({
      sides: [
        [{ cls: 'spearmen', x: 0, z: 0, facing: 0, morale: 60 }],
        [{ cls: 'spearmen', x: 18, z: 0, facing: -PI / 2, morale: 60, shape: 'line' }],
      ],
      factions: ['citystates', 'forest'],
    });
    const [def, att] = b.state.formations;
    const front = testBattle({
      sides: [[{ cls: 'spearmen', x: 0, z: 0, facing: 0, morale: 60 }], [{ cls: 'spearmen', x: 0, z: 8, facing: PI, morale: 60 }]],
      factions: ['citystates', 'forest'],
    });
    const flank = meleeDamagePerSecond(b.state, b.ctx, att!, def!);
    const frontal = meleeDamagePerSecond(front.state, front.ctx, front.state.formations[1]!, front.state.formations[0]!);
    expect(flank / frontal).toBeCloseTo(1.5, 5);
  });
});

describe('§6.6.2 charge impact', () => {
  it('8 elephants into unbraced spearmen: 378 HP (~38 men)', () => {
    const b = testBattle({
      sides: [[{ cls: 'war_elephants', x: 0, z: 30, facing: PI }], [{ cls: 'spearmen', x: 0, z: 0, facing: 0 }]],
      factions: ['maritime', 'citystates'],
    });
    const [ele, spr] = b.state.formations;
    const hp = chargeImpactHP(b.ctx, ele!, spr!);
    console.log(`[worked] elephants -> spears: ${hp.toFixed(1)} HP = ${(hp / 10).toFixed(1)} men (spec 378 / 38)`);
    expect(within(hp, 378)).toBe(true);
    expect(within(hp / b.ctx.stats[1]!.hp, 38)).toBe(true);
  });

  it('into braced spears: ~13 men, and 189 HP recoil (~1.2 elephants)', () => {
    const b = testBattle({
      sides: [[{ cls: 'war_elephants', x: 0, z: 30, facing: PI }], [{ cls: 'spearmen', x: 0, z: 0, facing: 0 }]],
      factions: ['maritime', 'citystates'],
    });
    const [ele, spr] = b.state.formations;
    expect(isBraced(ele!, spr!)).toBe(true);
    const unbraced = chargeImpactHP(b.ctx, ele!, spr!);
    const braced = unbraced * 0.35;
    const recoil = unbraced * 0.5;
    console.log(`[worked] braced: ${(braced / 10).toFixed(1)} men, recoil ${recoil.toFixed(0)} HP = ${(recoil / 160).toFixed(2)} elephants (spec 13 / 189 / 1.2)`);
    expect(within(braced / 10, 13)).toBe(true);
    expect(within(recoil, 189)).toBe(true);
    expect(within(recoil / b.ctx.stats[0]!.hp, 1.2)).toBe(true);
  });

  it('a real charge run: braced spears lose ~13 men per impact and the elephants take the recoil (mean of 24 seeds)', () => {
    let men = 0;
    let recoil = 0;
    const seeds = 24;
    for (let s = 1; s <= seeds; s++) {
      const b = testBattle({
        seed: s,
        sides: [[{ cls: 'war_elephants', x: 0, z: 140, facing: PI }], [{ cls: 'spearmen', x: 0, z: 0, facing: 0 }]],
        factions: ['maritime', 'citystates'],
      });
      expect(issueBattleCommand(b.state, 0, { kind: 'order', formations: [0], order: { type: 'charge', target: 1 }, queue: false })).toBeNull();
      runFor(b, 60, (st) => st.formations[0]!.engagedWith.length > 0);
      const charge = b.events.find((e: BattleEventRecord) => e.kind === 'charge');
      expect(charge?.text).toBe('braced');
      men += charge!.value! / 10;
      recoil += hpLost(b, 0) - 0;
    }
    men /= seeds;
    recoil /= seeds;
    console.log(`[worked] simulated braced charge: ${men.toFixed(1)} men lost, ${recoil.toFixed(0)} HP recoil (spec 13 / 189)`);
    expect(within(men, 13)).toBe(true);
    expect(within(recoil, 189, 0.12)).toBe(true);
  });

  it('60 horsemen into archers: 126 HP before the wedge bonus (16 archers); the default wedge adds x1.3', () => {
    const b = testBattle({
      sides: [[{ cls: 'cavalry', x: 0, z: 40, facing: PI }], [{ cls: 'archers', x: 0, z: 0, facing: 0 }]],
      factions: ['citystates', 'forest'],
    });
    const [cav, arc] = b.state.formations;
    expect(cav!.shape).toBe('wedge');
    expect(cav!.files).toBe(10);
    const hp = chargeImpactHP(b.ctx, cav!, arc!);
    const neutral = hp / shapeMods('wedge').chargeImpact;
    console.log(`[worked] horse -> archers: ${neutral.toFixed(1)} HP shape-neutral (${(neutral / 8).toFixed(1)} archers; spec 126 / 16), ${hp.toFixed(1)} HP in wedge`);
    expect(within(neutral, 126)).toBe(true);
    expect(within(neutral / 8, 16)).toBe(true);
    expect(within(hp, 126 * 1.3)).toBe(true);
  });
});

describe('§6.6.3 missiles', () => {
  it('a 100-archer volley into a spear block at 120 m: ~24 hits, ~32 HP (mean of 400 volleys)', () => {
    const b = testBattle({
      sides: [[{ cls: 'archers', x: 0, z: 120, facing: PI }], [{ cls: 'spearmen', x: 0, z: 0, facing: 0 }]],
      factions: ['forest', 'citystates'],
    });
    const [arc, spr] = b.state.formations;
    expect(volleyDamage(b.ctx, arc!, spr!, 24)).toBeCloseTo(32.4, 1);
    const rng = new Rng(99);
    const out: BattleEventRecord[] = [];
    const sh = new Uint8Array(2);
    let total = 0;
    const n = 400;
    for (let k = 0; k < n; k++) {
      spr!.soldiers = 120;
      spr!.killed = 0;
      spr!.damagePool = 0;
      arc!.ammo = 20;
      const v = launchVolley(b.state, b.ctx, arc!, spr!, rng, out);
      b.state.time = v.impactTime;
      updateVolleys(b.state, b.ctx, rng, sh, out);
      total += spr!.killed * 10 + spr!.damagePool;
    }
    const mean = total / n;
    console.log(`[worked] volley at 120 m: ${mean.toFixed(1)} HP = ${(mean / 10).toFixed(2)} men per volley (spec 32 / 3.2)`);
    expect(within(mean, 32)).toBe(true);
  });
});

describe('§6.6.4 elephant panic', () => {
  it('8 elephants at morale 70 taking 24 hits: 8.6% per volley, ~40% after six; Royal Corps x0.7', () => {
    const p = elephantPanicChance(0.12, 70, 24, 8);
    console.log(`[worked] panic: ${(p * 100).toFixed(2)}% per volley, ${((1 - (1 - p) ** 6) * 100).toFixed(1)}% after six (spec 8.6 / 40)`);
    expect(within(p, 0.086)).toBe(true);
    expect(within(1 - (1 - p) ** 6, 0.4)).toBe(true);
    const royal = variantStats('heartland', 'war_elephants').unruliness;
    expect(elephantPanicChance(royal, 70, 24, 8) / p).toBeCloseTo(0.7, 5);
    expect(elephantPanicChance(0.12, 0, 1000, 8)).toBe(0.5);
  });
});

describe('§6.7 the GDD morale example', () => {
  it('target 70 -> commander falls, flank collapses, supply route threatened -> ~25: the block routs with 80% alive', () => {
    const b = testBattle({
      sides: [[{ cls: 'spearmen', x: 0, z: 200, facing: PI }], [{ cls: 'spearmen', x: 0, z: -200, facing: 0 }]],
      factions: ['citystates', 'forest'],
    });
    const f = b.state.formations[0]!;
    const br: MoraleBreakdown = {
      inputs: { leadership: 0.5, cohesion: 0.5, fatigue: 0, supply: 0.5, tacticalPosition: 10 / 14, recentEvents: 0, perceivedRisk: 0 },
      contributions: { leadership: 0, cohesion: 0, fatigue: 0, supply: 0, tacticalPosition: 0, recentEvents: 0, perceivedRisk: 0 },
      base: 0,
      target: 0,
      trend: 0,
      dominant: 'cohesion',
    };
    scoreMorale(b.ctx, b.state, f, br);
    expect(br.target).toBeCloseTo(70, 6);
    const t = b.state.time;
    addMoraleEvent(f, 'commander_fallen', t);
    addMoraleEvent(f, 'flank_attacked', t);
    addMoraleEvent(f, 'supply_threatened', t);
    br.inputs.recentEvents = recentEventsValue(f, t);
    br.inputs.perceivedRisk = 0.3;
    br.inputs.supply = 0.2;
    scoreMorale(b.ctx, b.state, f, br);
    console.log(`[worked] GDD morale example: R = ${br.inputs.recentEvents.toFixed(2)}, target ${br.target.toFixed(1)} (spec ~25), dominant ${br.dominant}`);
    expect(br.inputs.recentEvents).toBeCloseTo(-1.25, 6);
    expect(within(br.target, 25)).toBe(true);
    expect(br.target).toBeLessThan(30);
    expect(br.dominant).toBe('recentEvents');
  });
});
