/**
 * Skirmish army composition (DESIGN_SPEC §10.1; GP-01 rework round 1, CD blocking item 1): composeArmy never creates a
 * formation below half strength (except a sole spearmen / archers formation), never a separate remainder formation,
 * never more soldiers than the side budget, and only classes on the faction roster.
 * OWNER: Gameplay Engineer - Tactical Battle Simulation.
 */
import { describe, expect, it } from 'vitest';
import type { UnitClass } from '../../../src/core/types';
import { MAX_FORMATIONS_PER_SIDE } from '../../../src/core/constants';
import { FACTIONS } from '../../../src/data/factions';
import { SKIRMISH_COMPOSITIONS, SKIRMISH_SIZES } from '../../../src/data/skirmish';
import { UNITS } from '../../../src/data/units';
import { composeArmy, createSkirmishSetup } from '../../../src/sim/tactical/battle';

/** Per-side budget exactly as createSkirmishSetup computes it. */
function sideBudget(totalSoldiers: number): number {
  return Math.max(2, Math.floor(totalSoldiers / 2));
}

function counts(army: { unitClass: UnitClass; soldiers: number }[]): string {
  return army.map((f) => `${f.unitClass}:${f.soldiers}`).join(' ');
}

describe('§10.1 composeArmy', () => {
  it('no formation below half strength (except a sole spearmen/archers one) for every faction x composition x size', () => {
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
            if (!roster.has(f.unitClass)) problems.push(`${tag} -> ${f.unitClass} is not on the roster`);
            if (f.soldiers > per) problems.push(`${tag} -> ${f.unitClass}:${f.soldiers} overfills a formation of ${per}`);
            if (f.soldiers < 1) problems.push(`${tag} -> empty ${f.unitClass} formation`);
            const sole = perClass.get(f.unitClass) === 1 && (f.unitClass === 'spearmen' || f.unitClass === 'archers');
            if (f.soldiers < per * 0.5 && !sole) problems.push(`${tag} -> ${f.unitClass}:${f.soldiers} below half of ${per}`);
          }
          // Formations of one class are an even split (sizes differ by at most one man): no remainder formation.
          for (const [cls, k] of perClass) {
            if (k < 2) continue;
            const sizes = army.filter((f) => f.unitClass === cls).map((f) => f.soldiers);
            if (Math.max(...sizes) - Math.min(...sizes) > 1) problems.push(`${tag} -> uneven ${cls} split ${sizes.join('/')}`);
          }
        }
      }
    }
    expect(combos).toBe(6 * SKIRMISH_COMPOSITIONS.length * SKIRMISH_SIZES.length);
    expect(problems).toEqual([]);
  });

  it('the review examples now field no 4-man formations', () => {
    // Suvarna Riders of the Frontier at Battle 1,000: was spearmen:4 archers:4 cavalry:4 chariots:4 scouts:4 extras.
    const riders = composeArmy(500, 'heartland', 'mobile');
    // Nilavana Balanced Host at 1,000: was elite_guards:7 war_elephants:4 scouts:4 supply_train:4 extras.
    const nila = composeArmy(500, 'forest', 'balanced');
    for (const army of [riders, nila]) {
      for (const f of army) expect(f.soldiers, counts(army)).toBeGreaterThanOrEqual(UNITS[f.unitClass].stats.menPerFormation * 0.5);
    }
    console.log(`[compose] Suvarna Riders 1,000: ${counts(riders)}\n[compose] Nilavana Balanced 1,000: ${counts(nila)}`);
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
