/**
 * DESIGN_SPEC §13.3 battle balance with the SIM-02 battle AI - CI-light version (40 seeds per row; the 200-run version
 * is scripts/sim-ai/matchups.mjs -> docs/sprint1/sim-02/matchups.md). OWNER: AI Engineer - Battle AI, Intents &
 * Campaign AI (SIM-02).
 *
 * Rows with a one-sided target ("spearmen win >= 75%") must meet it with the 40-seed rate itself. Rows with a band
 * ("guards win 45-60%", "45-55%") must be statistically consistent with it: the 95% Wilson interval of 40 runs overlaps
 * the band (a 40-run sample cannot pin a 10-point band; the 200-run script reports the point estimate against it). The
 * commander row is paired: the same seeds with and without the scripted death, defeat rate difference >= 30 points.
 */
import { describe, expect, it } from 'vitest';
import { MATCHUPS, consistentWithTarget, formatRate, runMatchup } from './harness/matchups';

const SEEDS = 40;

describe('DESIGN_SPEC §13.3 matchups (AI vs AI, 40 seeds each)', () => {
  for (const row of MATCHUPS) {
    it(`${row.matchup} -> ${row.expected}`, () => {
      const r = runMatchup(row, SEEDS);
      const what = r.diff !== undefined ? `defeat rate ${formatRate(r.rate)} vs ${formatRate(r.baseRate!)} untouched (+${formatRate(r.diff)})` : `${formatRate(r.rate)} [95% ${formatRate(r.ci[0])}-${formatRate(r.ci[1])}]`;
      console.log(`[matchups] ${row.id}: ${what}, median ${r.medianMin.toFixed(2)} min, ${JSON.stringify(r.reasons)}`);
      if (r.diff !== undefined) expect(r.diff, row.id).toBeGreaterThanOrEqual(row.min ?? 0);
      else if (row.max === undefined) expect(r.rate, row.id).toBeGreaterThanOrEqual(row.min ?? 0);
      else expect(consistentWithTarget(r), `${row.id} ${formatRate(r.rate)} [${formatRate(r.ci[0])}, ${formatRate(r.ci[1])}]`).toBe(true);
    }, 300_000);
  }
});
