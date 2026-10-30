/**
 * Skirmish army composition (DESIGN_SPEC §10.1; GP-01 rework round 1, CD blocking item 1; round 2, CD item 2 [REQ GP-01]):
 * each class budget is split evenly into k = ceil(budget / floor(1.25 x menPerFormation)) formations, so composeArmy
 * never creates a formation above 1.25 x menPerFormation, never one below half strength (except a sole spearmen /
 * archers formation; with k >= 2 none below 62.5%), never a separate remainder formation, never more soldiers than
 * the side budget, and only classes on the faction roster.
 * OWNER: Gameplay Engineer - Tactical Battle Simulation.
 */
import { describe, expect, it } from 'vitest';
import type { UnitClass } from '../../../src/core/types';
import { MAX_FORMATIONS_PER_SIDE } from '../../../src/core/constants';
import { FACTIONS } from '../../../src/data/factions';
import { SKIRMISH_COMPOSITIONS, SKIRMISH_SIZES } from '../../../src/data/skirmish';
import { UNITS } from '../../../src/data/units';
import { composeArmy, createSkirmishSetup } from '../../../src/sim/tactical/battle';
import { skirmishBlockCap } from '../../../src/sim/tactical/setup';

/** Per-side budget exactly as createSkirmishSetup computes it. */
function sideBudget(totalSoldiers: number): number {
  return Math.max(2, Math.floor(totalSoldiers / 2));
}

function counts(army: { unitClass: UnitClass; soldiers: number }[]): string {
  return army.map((f) => `${f.unitClass}:${f.soldiers}`).join(' ');
}

describe('§10.1 composeArmy', () => {
  it('blocks of at most 1.25 x per, none below half strength (except a sole spearmen/archers one), k = ceil(budget / cap), even splits - every faction x composition x size', () => {
    const problems: string[] = [];
    let combos = 0;
    for (const factionId of Object.keys(FACTIONS).sort()) {
      const roster = new Set(FACTIONS[factionId]!.roster);
      for (const comp of SKIRMISH_COMPOSITIONS) {
        for (const size of SKIRMISH_SIZES) {
          combos++;
          const budget = sideBudget(size.totalSoldiers);
          const army = composeArmy(budget, factionId, comp.id);
          const tag = `${factionId} / ${comp.id} / ${size.totalSoldiers}: ${counts(army)}`;
          const total = army.reduce((a, f) => a + f.soldiers, 0);
          if (total > budget) problems.push(`${tag} -> ${total} soldiers > budget ${budget}`);
          if (army.length === 0 || army.length > MAX_FORMATIONS_PER_SIDE) problems.push(`${tag} -> ${army.length} formations`);
          const perClass = new Map<UnitClass, number>();
          for (const f of army) perClass.set(f.unitClass, (perClass.get(f.unitClass) ?? 0) + 1);
          for (const f of army) {
            const per = UNITS[f.unitClass].stats.menPerFormation;
            const k = perClass.get(f.unitClass)!;
            if (!roster.has(f.unitClass)) problems.push(`${tag} -> ${f.unitClass} is not on the roster`);
            if (f.soldiers > 1.25 * per) problems.push(`${tag} -> ${f.unitClass}:${f.soldiers} above 1.25 x ${per}`);
            if (f.soldiers < 1) problems.push(`${tag} -> empty ${f.unitClass} formation`);
            const sole = k === 1 && (f.unitClass === 'spearmen' || f.unitClass === 'archers');
            if (f.soldiers < per * 0.5 && !sole) problems.push(`${tag} -> ${f.unitClass}:${f.soldiers} below half of ${per}`);
            // With k >= 2 every block holds >= 62.5% of per (floor: the even split rounds down by under one man).
            if (k >= 2 && f.soldiers < Math.floor(0.625 * per)) problems.push(`${tag} -> ${f.unitClass}:${f.soldiers} below 62.5% of ${per} in a ${k}-way split`);
          }
          for (const [cls, k] of perClass) {
            const sizes = army.filter((f) => f.unitClass === cls).map((f) => f.soldiers);
            const sum = sizes.reduce((a, n) => a + n, 0);
            // k = ceil(class budget / floor(1.25 x per)) (also when MAX_FORMATIONS_PER_SIDE caps k: the class is then
            // filled to k full blocks).
            if (k !== Math.max(1, Math.ceil(sum / skirmishBlockCap(cls)))) problems.push(`${tag} -> ${cls} in ${k} formations, rule says ${Math.ceil(sum / skirmishBlockCap(cls))}`);
            // Formations of one class are an even split (sizes differ by at most one man): no remainder formation.
            if (k >= 2 && Math.max(...sizes) - Math.min(...sizes) > 1) problems.push(`${tag} -> uneven ${cls} split ${sizes.join('/')}`);
          }
        }
      }
    }
    expect(combos).toBe(6 * SKIRMISH_COMPOSITIONS.length * SKIRMISH_SIZES.length);
    expect(problems).toEqual([]);
  });

  it('the review examples: no 4-man formations (round 1), small overflows stay one fuller block (round 2)', () => {
    // Suvarna Riders of the Frontier at Battle 1,000 (500 per side). Round 0: spearmen:4 archers:4 cavalry:4 chariots:4
    // scouts:4 extras; round 1: spearmen 61/61, archers 51/51, cavalry 46/46/46/45, chariots 16/16, scouts 21/20/20.
    const riders = composeArmy(500, 'heartland', 'mobile');
    expect(counts(riders)).toBe('spearmen:122 archers:102 cavalry:61 cavalry:61 cavalry:61 chariots:16 chariots:16 scouts:31 scouts:30');
    // Nilavana Elephant Shock at 1,000. Round 1: spearmen 90/90/89, archers 56/56, guards 34/33, elephants 6/6/6,
    // scouts 17/17 (12 formations).
    const shock = composeArmy(500, 'forest', 'shock');
    expect(counts(shock)).toBe('spearmen:135 spearmen:134 archers:112 elite_guards:67 war_elephants:9 war_elephants:9 scouts:34');
    // Nilavana Balanced Host at 1,000. Round 0: elite_guards:7 war_elephants:4 scouts:4 supply_train:4 extras.
    const nila = composeArmy(500, 'forest', 'balanced');
    for (const army of [riders, shock, nila]) {
      for (const f of army) expect(f.soldiers, counts(army)).toBeGreaterThanOrEqual(UNITS[f.unitClass].stats.menPerFormation * 0.5);
    }
    console.log(`[compose] Suvarna Riders 1,000: ${counts(riders)}\n[compose] Nilavana Elephant Shock 1,000: ${counts(shock)}\n[compose] Nilavana Balanced 1,000: ${counts(nila)}`);
  });

  it('prints the split statistics over all 120 combinations (CD round 2: overflow splits, average fill, dropped)', () => {
    let allocations = 0;
    let overflowSplits = 0;
    let formations = 0;
    let fill = 0;
    let dropped = 0;
    let minFill = Infinity;
    let maxFill = 0;
    for (const factionId of Object.keys(FACTIONS).sort()) {
      for (const comp of SKIRMISH_COMPOSITIONS) {
        for (const size of SKIRMISH_SIZES) {
          const budget = sideBudget(size.totalSoldiers);
          const army = composeArmy(budget, factionId, comp.id);
          dropped += budget - army.reduce((a, f) => a + f.soldiers, 0);
          const byClass = new Map<UnitClass, number[]>();
          for (const f of army) byClass.set(f.unitClass, [...(byClass.get(f.unitClass) ?? []), f.soldiers]);
          for (const [cls, sizes] of byClass) {
            const per = UNITS[cls].stats.menPerFormation;
            const sum = sizes.reduce((a, n) => a + n, 0);
            allocations++;
            // An overflow split: more formations than round(budget / per), i.e. a small overflow made into an extra block.
            if (sizes.length >= 2 && sizes.length > Math.round(sum / per)) overflowSplits++;
            for (const n of sizes) {
              formations++;
              fill += n / per;
              minFill = Math.min(minFill, n / per);
              maxFill = Math.max(maxFill, n / per);
            }
          }
        }
      }
    }
    console.log(
      `[compose] all 120 faction x composition x size: ${allocations} class allocations, ${formations} formations, overflow splits ${overflowSplits} (round 1 rule: 240), ` +
        `average fill ${((100 * fill) / formations).toFixed(1)}% (round 1: 86.9%), fill range ${(100 * minFill).toFixed(1)}-${(100 * maxFill).toFixed(1)}%, soldiers dropped ${dropped}`,
    );
    expect(maxFill).toBeLessThanOrEqual(1.25);
    expect(overflowSplits).toBeLessThan(allocations / 10);
  });

  it('the class budgets add up to the side budget (largest remainder) and the setup uses them', () => {
    // Balanced Host at 500 per side: exact shares 235.3 / 98.0 / 58.8 / 58.8 / 7.8 / 29.4 / 11.8 -> 235 / 98 / 59 / 59 / 8 / 29 / 12.
    const army = composeArmy(500, 'heartland', 'balanced');
    const byClass = (cls: UnitClass): number => army.filter((f) => f.unitClass === cls).reduce((a, f) => a + f.soldiers, 0);
    expect(byClass('spearmen')).toBe(235);
    expect(army.filter((f) => f.unitClass === 'spearmen').map((f) => f.soldiers)).toEqual([118, 117]);
    expect(byClass('archers')).toBe(98);
    expect(byClass('elite_guards')).toBe(59);
    expect(byClass('cavalry')).toBe(59);
    expect(byClass('war_elephants')).toBe(8);
    expect(byClass('scouts')).toBe(29);
    expect(byClass('supply_train')).toBe(12);
    expect(army.reduce((a, f) => a + f.soldiers, 0)).toBe(500);
    // Classes off the roster are skipped (Giridurga fields no elephants).
    const giri = composeArmy(500, 'highland', 'shock');
    expect(giri.some((f) => f.unitClass === 'war_elephants')).toBe(false);
    const setup = createSkirmishSetup({ seed: 3, preset: 'plains', totalSoldiers: 1000, playerFactionId: 'heartland', enemyFactionId: 'forest', armies: null, playerSide: 0, hour: 9, season: 'sharad', weather: 'clear', difficulty: 'normal', aiVsAi: true, compositions: ['mobile', 'balanced'] });
    expect(setup.sides[0].formations.map((f) => `${f.unitClass}:${f.soldiers}`)).toEqual(riders500());
  });

  it('a sole small spearmen or archers formation is allowed; other small classes are dropped', () => {
    // Clash 600 Hill Fort Garrison: engineers 0.08 share of 300 = 22.6 >= 20 (half of 40) -> one formation.
    const clash = composeArmy(300, 'citystates', 'fortress');
    expect(clash.filter((f) => f.unitClass === 'engineers').length).toBe(1);
    // A tiny army keeps a sole small spear and archer formation but no sub-half cavalry / guards.
    const tiny = composeArmy(40, 'citystates', 'balanced');
    for (const f of tiny) expect(['spearmen', 'archers']).toContain(f.unitClass);
    expect(tiny.reduce((a, f) => a + f.soldiers, 0)).toBeLessThanOrEqual(40);
  });
});

function riders500(): string[] {
  return composeArmy(500, 'heartland', 'mobile').map((f) => `${f.unitClass}:${f.soldiers}`);
}
