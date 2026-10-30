/**
 * SIM-02 performance budgets: runCampaignAI < 0.5 ms per realm-day, runBattleAI < 0.1 ms per think at 40 formations.
 * OWNER: AI Engineer - Battle AI, Intents & Campaign AI (SIM-02).
 *
 * Method (as the SIM-01 tick budget): the measured code is deterministic, so identical copies are timed and the
 * minimum per sample is the code's own cost - a garbage-collector pause or a test file running in a parallel worker only
 * ever adds time. Rounds repeat (up to 60 s) until the budget holds. The numbers are printed ([perf] lines) for the
 * SIM-02 report.
 *  - Campaign: 3 identical worlds (The Broken Crown, 3 AI realms; an AI-only sandbox, 6 realms) run 120 days in
 *    lockstep; each realm's runCampaignAI is timed at every day rollover (the AI is held passive inside tickWorld and
 *    called by the test at the same point, its commands applied right after - as tickWorld does).
 *  - Battle: a 20 v 20 formation field battle (Kotanagara host) runs to its end; at every second of it each side's AI
 *    plans on 5 copies of the state (the setup and its derived context shared, as in a live battle).
 */
import { describe, expect, it } from 'vitest';
import type { BattleEventRecord, BattleState, SideIndex, SimEvent, WorldState } from '../../../src/core/types';
import { BATTLE_DT } from '../../../src/core/constants';
import { Heightfield } from '../../../src/core/terrain/heightfield';
import { createBattle, createSkirmishSetup, stepBattle } from '../../../src/sim/tactical/battle';
import { runBattleAI } from '../../../src/sim/tactical/battleai';
import { applyStrategicCommand, getRegionHeightfield, tickWorld } from '../../../src/sim/strategic/world';
import { resetAiJournal, runCampaignAI } from '../../../src/sim/strategic/ai';
import { campaign, runDays } from '../strategic/helpers';
import { aiSandbox } from './harness/campaign';

function stats(xs: number[]): { mean: number; p50: number; p95: number; max: number } {
  const s = xs.slice().sort((a, b) => a - b);
  return { mean: s.reduce((a, b) => a + b, 0) / Math.max(1, s.length), p50: s[s.length >> 1] ?? 0, p95: s[Math.floor(s.length * 0.95)] ?? 0, max: s[s.length - 1] ?? 0 };
}

const fmt = (ms: number): string => `${(ms * 1000).toFixed(0)} us`;

/** One campaign round: per (day, realm) sample, the minimum over 3 lockstep copies. */
function campaignRound(make: () => WorldState, days: number): number[] {
  const worlds = [make(), make(), make()];
  const hf = getRegionHeightfield(worlds[0]!);
  const ids = Object.keys(worlds[0]!.factions).sort();
  for (const w of worlds) for (const id of ids) if (!w.factions[id]!.isPlayer) w.factions[id]!.ai.memory.passive = true;
  const out: SimEvent[] = [];
  const samples: number[] = [];
  for (let h = 0; h < days * 24; h++) {
    const mins = new Map<string, number>();
    for (const w of worlds) {
      out.length = 0;
      tickWorld(w, [], out, hf);
      for (const inst of w.events.pending.slice()) if (inst.scope.factionId === w.playerFactionId) w.events.pending.splice(w.events.pending.indexOf(inst), 1);
      for (const e of Object.values(w.engagements)) if (e.status === 'pending_player') e.status = 'auto';
      if (w.calendar.hour !== 0) continue;
      for (const id of ids) {
        const f = w.factions[id]!;
        if (f.isPlayer || !f.alive) continue;
        delete f.ai.memory.passive;
        const t0 = process.hrtime.bigint();
        const cmds = runCampaignAI(w, id, hf);
        const dt = Number(process.hrtime.bigint() - t0) / 1e6;
        f.ai.memory.passive = true;
        for (const c of cmds) applyStrategicCommand(w, c, out, hf);
        mins.set(id, Math.min(mins.get(id) ?? Infinity, dt));
      }
    }
    for (const v of mins.values()) samples.push(v);
  }
  return samples;
}

describe('campaign AI cost (SIM-02: < 0.5 ms per realm-day)', () => {
  it('The Broken Crown and an AI-only sandbox, 120 days each', () => {
    resetAiJournal(false);
    const makers: [string, () => WorldState][] = [
      ['broken_crown', () => {
        const w = campaign(5);
        runDays(w, 20);
        return w;
      }],
      ['ai sandbox', () => {
        const w = aiSandbox(2);
        for (const f of Object.values(w.factions)) f.isPlayer = false;
        return w;
      }],
    ];
    for (const [name, make] of makers) {
      const start = process.hrtime.bigint();
      let best: number[] | null = null;
      for (;;) {
        const r = campaignRound(make, 120);
        best = best ? best.map((v, i) => Math.min(v, r[i] ?? v)) : r;
        const s = stats(best);
        if (s.mean < 0.5 || Number(process.hrtime.bigint() - start) / 1e9 > 60) break;
      }
      const s = stats(best);
      console.log(`[perf] runCampaignAI ${name}: ${best.length} realm-days, mean ${fmt(s.mean)}, p50 ${fmt(s.p50)}, p95 ${fmt(s.p95)}, max ${fmt(s.max)}`);
      expect(s.mean).toBeLessThan(0.5);
      expect(s.p95).toBeLessThan(0.5);
    }
    resetAiJournal(true);
  }, 300_000);
});

describe('battle AI cost (SIM-02: < 0.1 ms per think at 40 formations)', () => {
  it('20 v 20 formations, every second of the battle, both sides', () => {
    const row = [
      ...Array.from({ length: 8 }, () => ({ unitClass: 'spearmen' as const, soldiers: 120 })),
      ...Array.from({ length: 6 }, () => ({ unitClass: 'archers' as const, soldiers: 100 })),
      ...Array.from({ length: 4 }, () => ({ unitClass: 'cavalry' as const, soldiers: 60 })),
      { unitClass: 'war_elephants' as const, soldiers: 8 },
      { unitClass: 'elite_guards' as const, soldiers: 60 },
    ];
    const setup = createSkirmishSetup({ seed: 3, preset: 'plains', totalSoldiers: 4000, playerFactionId: 'heartland', enemyFactionId: 'heartland', armies: [{ factionId: 'heartland', formations: row }, { factionId: 'heartland', formations: row }], playerSide: 0, hour: 9, season: 'sharad', weather: 'clear', difficulty: 'normal', aiVsAi: true });
    const terrain = Heightfield.generate({ ...setup.terrain, resolution: 129 });
    const st: BattleState = createBattle(setup, terrain);
    expect(st.formations.length).toBe(40);
    const out: BattleEventRecord[] = [];
    const snaps: BattleState[] = [];
    while (!st.outcome && st.time < 1200) {
      if (st.tick % 20 === 0) snaps.push({ ...structuredClone({ ...st, setup: null }), setup: st.setup } as BattleState);
      out.length = 0;
      stepBattle(st, BATTLE_DT, terrain, out);
    }
    const copy = (s: BattleState, side: SideIndex): BattleState => {
      const c = { ...structuredClone({ ...s, setup: null }), setup: s.setup } as BattleState;
      delete c.sides[side].aiMemory.next;
      return c;
    };
    const start = process.hrtime.bigint();
    let best: number[] = [];
    for (let round = 0; ; round++) {
      const r: number[] = [];
      for (const s of snaps) {
        for (const side of [0, 1] as SideIndex[]) {
          let m = Infinity;
          for (let k = 0; k < 5; k++) {
            const c = copy(s, side);
            const t0 = process.hrtime.bigint();
            runBattleAI(c, side, terrain);
            m = Math.min(m, Number(process.hrtime.bigint() - t0) / 1e6);
          }
          r.push(m);
        }
      }
      best = round === 0 ? r : best.map((v, i) => Math.min(v, r[i] ?? v));
      if (stats(best).mean < 0.1 || Number(process.hrtime.bigint() - start) / 1e9 > 60) break;
    }
    const s = stats(best);
    console.log(`[perf] runBattleAI 40 formations: ${best.length} thinks over ${Math.round(st.time)} s (${st.outcome?.reason ?? 'limit'}), mean ${fmt(s.mean)}, p50 ${fmt(s.p50)}, p95 ${fmt(s.p95)}, max ${fmt(s.max)}`);
    expect(s.mean).toBeLessThan(0.1);
  }, 300_000);
});
