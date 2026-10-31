/**
 * SIM-02 campaign AI harness: AI-only sandbox worlds (every realm AI-controlled), day-by-day runs with the audit
 * the campaign tests and the narrative script need. OWNER: AI Engineer - Battle AI, Intents & Campaign AI (SIM-02).
 *
 * The audit, per day: treasury streaks below zero, every war declaration (with the §7.14 rule evaluated independently
 * at hour 23 of the day before, for every AI pair), peace proposals and the realm's war score, age-ups and the days
 * an age's requirements held without a landmark, settlement owners.
 */
import type { FactionId, SandboxSetup, ScenarioId, SimEvent, WorldState } from '../../../../src/core/types';
import { createWorld, getRegionHeightfield, tickWorld } from '../../../../src/sim/strategic/world';
import { defaultSandbox } from '../../../../src/data/campaign';
import { getEventDef } from '../../../../src/data/events';
import { situate } from '../../../../src/sim/strategic/ai/core';
import { aiSchedule } from '../../../../src/sim/strategic/ai';
import { peaceCase, warRule } from '../../../../src/sim/strategic/ai/diplomacy';
import { ageChecklist, landmarkChosenForAge } from '../../../../src/sim/strategic/ages';
import { activeTreaty } from '../../../../src/sim/strategic/treaties';
import { totalDays } from '../../../../src/sim/strategic/seasons';

export const ALL_RIVALS: FactionId[] = ['highland', 'forest', 'frontier', 'maritime', 'citystates'];

/** A sandbox with all six realms where every realm (the nominal player too) is run by the campaign AI. */
export function aiSandbox(seed: number, patch: Partial<SandboxSetup> = {}): WorldState {
  const w = createWorld({ kind: 'sandbox', sandbox: { ...defaultSandbox(seed), rivalFactionIds: ALL_RIVALS.slice(), victoryTypes: [], ...patch } });
  for (const f of Object.values(w.factions)) f.isPlayer = false;
  return w;
}

/** A scenario world with every realm AI-run. */
export function aiScenario(seed: number, scenarioId: ScenarioId = 'broken_crown'): WorldState {
  const w = createWorld({ kind: 'scenario', scenarioId, seed, difficulty: 'normal' });
  for (const f of Object.values(w.factions)) f.isPlayer = false;
  return w;
}

export interface WarRecord {
  day: number;
  a: FactionId;
  b: FactionId;
  /** Declared by the AI's own decision (plan memory stamp `war_<b>` of that day). */
  byAi: boolean;
  /** The rule held for (a, b) at hour 23 of the previous day (independent evaluation). */
  ruleBefore: boolean;
  ratio: number;
  threshold: number;
  /** A truce or a war-forbidding treaty stood at hour 23 of the previous day. */
  blockedBefore: string | null;
  /** Why the declaration happened if not the AI's decision: 'ally call (x)', 'event', or 'unexplained'. */
  other: string | null;
}

export interface PeaceWatch {
  a: FactionId;
  b: FactionId;
  /** First day `a`'s war score against b fell below its peaceWarScore (current spell). */
  belowSince: number;
  /** Day a peace proposal a -> b was made in the spell (or the war ended), null if none yet. */
  sued: number | null;
}

export interface CampaignAudit {
  days: number;
  /** Longest run of consecutive days with treasury < 0, per realm. */
  worstDebtStreak: Record<FactionId, number>;
  debtStreak: Record<FactionId, number>;
  wars: WarRecord[];
  /** Spells where an AI's war score sat below its peaceWarScore, and whether it sued. */
  peace: PeaceWatch[];
  ageUps: { day: number; factionId: FactionId; age: string }[];
  /** Days with the next age's requirements met and no landmark chosen, per realm (current streak, worst streak). */
  readyStreak: Record<FactionId, number>;
  worstReadyStreak: Record<FactionId, number>;
  landmarkStarts: { day: number; factionId: FactionId; landmarkId: string }[];
  captures: { day: number; settlementId: string; from: FactionId | null; to: FactionId }[];
  peaceMade: { day: number; a: FactionId; b: FactionId }[];
  /** Realms that fell (alive -> false) and the day; `landed` = it held a settlement on day 0. */
  eliminated: { day: number; factionId: FactionId; landed: boolean }[];
  events: number;
}

function newAudit(w: WorldState): CampaignAudit {
  const z = (): Record<FactionId, number> => Object.fromEntries(Object.keys(w.factions).map((f) => [f, 0]));
  return { days: 0, worstDebtStreak: z(), debtStreak: z(), wars: [], peace: [], ageUps: [], readyStreak: z(), worstReadyStreak: z(), landmarkStarts: [], captures: [], peaceMade: [], eliminated: [], events: 0 };
}

interface PairRule {
  ok: boolean;
  ratio: number;
  threshold: number;
  blocked: string | null;
}

/** The war rule for every AI realm whose strategy planner runs at the coming day rollover (its declarations). */
function ruleSnapshot(w: WorldState): Map<string, PairRule> {
  const m = new Map<string, PairRule>();
  const ids = Object.keys(w.factions).sort();
  const nextDay = totalDays(w.calendar) + 1;
  const nextDom = (w.calendar.day + 1) % 30;
  for (const a of ids) {
    const fa = w.factions[a]!;
    if (!fa.alive || fa.isPlayer) continue;
    if (!aiSchedule(nextDay, nextDom, ids.indexOf(a)).strategy) continue;
    const sit = situate(w, a);
    for (const b of Object.keys(w.factions).sort()) {
      if (a === b || !w.factions[b]!.alive) continue;
      const r = warRule(sit, b);
      m.set(`${a}>${b}`, { ok: r.ok, ratio: r.ratio, threshold: r.threshold, blocked: r.blocked });
    }
  }
  return m;
}

/** AI-only sandbox: the nominal player realm's fall does not end the world (no human is playing it). */
function reopen(w: WorldState): void {
  if (w.mode !== 'sandbox' || w.victory.status === 'ongoing' || Object.values(w.factions).some((f) => f.isPlayer)) return;
  w.victory.status = 'ongoing';
  w.victory.outcomeId = null;
  w.victory.endedDay = null;
}

/** Run `days` days of an AI-only world, auditing as above. `onDay` runs after each day rollover. */
export function runAudited(w: WorldState, days: number, onDay?: (w: WorldState, audit: CampaignAudit) => void): CampaignAudit {
  const hf = getRegionHeightfield(w);
  const audit = newAudit(w);
  const out: SimEvent[] = [];
  let rules: Map<string, PairRule> | null = null;
  const landed = new Set(Object.values(w.settlements).map((s) => s.ownerFactionId).filter((x): x is FactionId => x !== null));
  const alive = new Set(Object.keys(w.factions).filter((f) => w.factions[f]!.alive));
  for (let d = 0; d < days; d++) {
    for (let h = 0; h < 24; h++) {
      reopen(w);
      if (w.victory.status !== 'ongoing') break;
      if (w.calendar.hour === 23) rules = ruleSnapshot(w);
      out.length = 0;
      tickWorld(w, [], out, hf);
      // Nobody is the player: pending engagements autoresolve.
      for (const e of Object.values(w.engagements)) if (e.status === 'pending_player') e.status = 'auto';
      for (const inst of w.events.pending.slice()) {
        if (inst.status !== 'pending' || !w.factions[inst.scope.factionId]?.isPlayer) continue;
        const def = getEventDef(inst.defId);
        if (def?.choices[0]) tickWorld(w, [{ factionId: inst.scope.factionId, hour: 0, cmd: { kind: 'event_choice', eventInstanceId: inst.id, choiceId: def.choices[0].id } }], out, hf);
      }
      const day = totalDays(w.calendar);
      const fired = new Set<string>();
      for (const e of out) if (e.kind === 'event_fired') fired.add(e.factionId);
      for (const e of out) {
        if (e.kind === 'war_declared') {
          const key = `${e.a}>${e.b}`;
          const r = rules?.get(key) ?? null;
          const mem = w.factions[e.a]?.ai.memory[`war_${e.b}`];
          const byAi = typeof mem === 'string' && Number(mem.split('|')[0]) === day;
          let other: string | null = null;
          if (!byAi) {
            for (const c of Object.keys(w.factions)) {
              if (c === e.a || c === e.b) continue;
              if (activeTreaty(w, e.a, c, 'mutual_defense') || activeTreaty(w, e.a, c, 'tributary')) other = `ally call (${c})`;
            }
            if (!other && (fired.has(e.a) || fired.has(e.b))) other = 'event';
            if (!other) other = 'unexplained';
          }
          audit.wars.push({ day, a: e.a, b: e.b, byAi, ruleBefore: r?.ok ?? false, ratio: r?.ratio ?? 0, threshold: r?.threshold ?? 0, blockedBefore: r?.blocked ?? null, other });
        } else if (e.kind === 'settlement_captured') audit.captures.push({ day, settlementId: e.settlementId, from: e.from, to: e.to });
        else if (e.kind === 'age_advanced') audit.ageUps.push({ day, factionId: e.factionId, age: e.age });
        else if (e.kind === 'landmark_started') audit.landmarkStarts.push({ day, factionId: e.factionId, landmarkId: e.landmarkId });
        else if (e.kind === 'peace_made') audit.peaceMade.push({ day, a: e.a, b: e.b });
        else if (e.kind === 'event_fired') audit.events++;
      }
    }
    reopen(w);
    if (w.victory.status !== 'ongoing') break;
    audit.days++;
    const day = totalDays(w.calendar);
    for (const fid of Object.keys(w.factions).sort()) {
      const f = w.factions[fid]!;
      if (!f.alive && alive.has(fid)) {
        alive.delete(fid);
        audit.eliminated.push({ day, factionId: fid, landed: landed.has(fid) });
      }
      if (!f.alive) {
        audit.debtStreak[fid] = 0;
        // A fallen realm owes no peace proposal.
        for (const p of audit.peace) if (p.a === fid && p.sued === null) p.sued = day;
        continue;
      }
      audit.debtStreak[fid] = f.treasury < 0 ? (audit.debtStreak[fid] ?? 0) + 1 : 0;
      audit.worstDebtStreak[fid] = Math.max(audit.worstDebtStreak[fid] ?? 0, audit.debtStreak[fid]!);
      const cl = ageChecklist(w, fid);
      const ready = cl.allMet && cl.nextAge !== null && !landmarkChosenForAge(w, fid, cl.nextAge);
      audit.readyStreak[fid] = ready ? (audit.readyStreak[fid] ?? 0) + 1 : 0;
      audit.worstReadyStreak[fid] = Math.max(audit.worstReadyStreak[fid] ?? 0, audit.readyStreak[fid]!);
      // Peace watch: each war spell below peaceWarScore, with the realm's field strength under 1.5x the enemy's (CD-B3 d:
      // a stronger host retakes instead), must see a proposal (or the war end) within 31 days.
      const sit = situate(w, fid);
      for (const b of sit.enemies) {
        const owed = peaceCase(sit, b).sue;
        let watch = audit.peace.find((p) => p.a === fid && p.b === b && p.sued === null);
        if (owed) {
          if (!watch) {
            watch = { a: fid, b, belowSince: day, sued: null };
            audit.peace.push(watch);
          }
          if (w.diplomacy.proposals.some((p) => p.from === fid && p.to === b && p.type === 'peace' && p.day >= watch!.belowSince)) watch.sued = day;
        } else if (watch) watch.sued = day; // recovered above the line (or strong enough to retake): nothing owed
      }
      for (const p of audit.peace) if (p.a === fid && p.sued === null && !sit.enemies.includes(p.b)) p.sued = day;
    }
    onDay?.(w, audit);
  }
  return audit;
}
