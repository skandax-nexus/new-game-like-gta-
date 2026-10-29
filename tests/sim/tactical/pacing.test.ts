/**
 * Battle pacing (DESIGN_SPEC §13.1; GP-01 acceptance): a headless 1,000-soldier balanced skirmish at default settings
 * (Balanced Host vs Balanced Host, Suvarna vs Giridurga, Minister, the open plain, full-resolution battle terrain, both
 * sides AI) ends in 3-8 minutes of battle time on >= 8 of 10 seeds. The table is printed for the report.
 * OWNER: Gameplay Engineer - Tactical Battle Simulation.
 */
import { describe, expect, it } from 'vitest';
import type { BattleEventRecord } from '../../../src/core/types';
import { BATTLE_DT } from '../../../src/core/constants';
import { Heightfield } from '../../../src/core/terrain/heightfield';
import { createBattle, createSkirmishSetup, stepBattle } from '../../../src/sim/tactical/battle';

describe('§13.1 battle length', () => {
  it('1,000-soldier balanced skirmish: 3-8 minutes on >= 8 of 10 seeds', () => {
    const rows: string[] = [];
    const minutes: number[] = [];
    for (let seed = 1; seed <= 10; seed++) {
      const setup = createSkirmishSetup({ seed, preset: 'plains', totalSoldiers: 1000, playerFactionId: 'heartland', enemyFactionId: 'highland', armies: null, playerSide: 0, hour: 9, season: 'sharad', weather: 'clear', difficulty: 'normal', aiVsAi: true, compositions: ['balanced', 'balanced'] });
      const hf = Heightfield.generate(setup.terrain);
      const state = createBattle(setup, hf);
      const out: BattleEventRecord[] = [];
      let lines = -1;
      while (!state.outcome) {
        out.length = 0;
        stepBattle(state, BATTLE_DT, hf, out);
        if (lines < 0) {
          for (const e of out) {
            if (e.kind !== 'contact' || e.formation === null || e.other === null) continue;
            const a = state.formations[e.formation]!.unitClass;
            const b = state.formations[e.other]!.unitClass;
            if ((a === 'spearmen' || a === 'elite_guards') && (b === 'spearmen' || b === 'elite_guards')) lines = state.time - state.deploymentEndsAt;
          }
        }
      }
      const o = state.outcome!;
      const min = o.durationSec / 60;
      minutes.push(min);
      rows.push(
        `seed ${String(seed).padStart(2)}: ${min.toFixed(2)} min  winner ${o.winner} (${o.reason})  lines met at ${lines.toFixed(0)} s  losses ${o.sides[0].killed}/${o.sides[1].killed}  pursuit ${o.sides[0].pursuitLosses}/${o.sides[1].pursuitLosses}  routs ${o.sides[0].routs}/${o.sides[1].routs}`,
      );
    }
    const inBand = minutes.filter((m) => m >= 3 && m <= 8).length;
    const sorted = minutes.slice().sort((a, b) => a - b);
    console.log(`[pacing] 1,000-soldier balanced skirmish (plains, Minister, AI vs AI):\n  ${rows.join('\n  ')}\n  median ${((sorted[4]! + sorted[5]!) / 2).toFixed(2)} min, ${inBand}/10 within 3-8 min`);
    expect(inBand).toBeGreaterThanOrEqual(8);
  });
});
