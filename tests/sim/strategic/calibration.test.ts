/**
 * DESIGN_SPEC §13.2 economy targets measured with the actual strategic sim (SIM-01):
 *  - annual civilian grain balance per realm with a normal monsoon and with M = 0.7 (the Act II crisis),
 *  - Suvarna's month-1 net (+400..+700 wealth).
 * Measurement: a sandbox world started in month 3 (one full kharif + rabi cycle), no armies or events, M forced for the
 * year, 360 days of the real daily economy; balance = grain produced / civilian consumption - 1 per owner.
 * The bands hold with the data change requested from the Creative Director (CD-1, see helpers.PENDING_DATA_REQUESTS);
 * the current-data numbers are reported in docs/sprint1/sim-01/report.md.
 */
import { describe, expect, it } from 'vitest';
import type { SimEvent, WorldState } from '../../../src/core/types';
import { advanceCalendar } from '../../../src/sim/strategic/seasons';
import { updateEconomyDaily } from '../../../src/sim/strategic/economy';
import { campaign, quiet, runDays, sandbox, withPendingData } from './helpers';

/** Annual civilian grain balance per realm. */
export function measureRealmBalance(m: number, seed = 11): Record<string, number> {
  const w: WorldState = quiet(sandbox(seed, { startMonth: 3 }));
  const adv = { newDay: false, newMonth: false, newYear: false, seasonChanged: false };
  const out: SimEvent[] = [];
  const prod: Record<string, number> = {};
  const cons: Record<string, number> = {};
  for (let d = 0; d < 360; d++) {
    advanceCalendar(w.calendar, 24, adv);
    w.monsoon.strength = m;
    for (const s of Object.values(w.settlements)) {
      const o = s.ownerFactionId ?? 'independent';
      cons[o] = (cons[o] ?? 0) + s.population * 0.1;
    }
    out.length = 0;
    updateEconomyDaily(w, out);
  }
  // Grain produced (trickle + harvests) is counted per realm in statistics.grain_harvested.
  for (const fid of Object.keys(w.factions)) prod[fid] = w.statistics[fid]?.grain_harvested ?? 0;
  const res: Record<string, number> = {};
  for (const k of Object.keys(w.factions)) res[k] = prod[k]! / cons[k]! - 1;
  return res;
}

describe('DESIGN_SPEC §13.2 with the actual sim', () => {
  it('normal monsoon: Suvarna +15% (8..25%), Giridurga -9% (-18..-2%), Nilavana +3% (-5..12%), Marudesha -8% (-20..0%)', () => {
    const b = withPendingData(() => measureRealmBalance(1));
    expect(b.heartland!).toBeGreaterThan(0.08);
    expect(b.heartland!).toBeLessThan(0.25);
    expect(b.highland!).toBeGreaterThan(-0.18);
    expect(b.highland!).toBeLessThan(-0.02);
    expect(b.forest!).toBeGreaterThan(-0.05);
    expect(b.forest!).toBeLessThan(0.12);
    expect(b.frontier!).toBeGreaterThan(-0.2);
    expect(b.frontier!).toBeLessThan(0);
  });

  it('M = 0.7: every realm < +2%, Suvarna > -12%', () => {
    const b = withPendingData(() => measureRealmBalance(0.7));
    for (const [k, v] of Object.entries(b)) expect(v, k).toBeLessThan(0.02);
    expect(b.heartland!).toBeGreaterThan(-0.12);
  });

  it('Suvarna month-1 net is between +400 and +700 wealth (The Broken Crown, default choices)', () => {
    for (const pending of [false, true]) {
      const run = (): number => {
        const w = campaign(1);
        runDays(w, 31, { until: (x) => x.calendar.month !== 6 });
        return w.factions.heartland!.ledger.net;
      };
      const net = pending ? withPendingData(run) : run();
      expect(net, pending ? 'with CD-1' : 'current data').toBeGreaterThan(400);
      expect(net, pending ? 'with CD-1' : 'current data').toBeLessThan(700);
    }
  });
});
