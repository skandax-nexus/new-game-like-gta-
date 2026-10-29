/**
 * Victory paths and their progress (DESIGN_SPEC §10.2 sandbox victories, FactionState.victoryProgress for every
 * mode), cultural legacy points and the prosperity streak. OWNER: Simulation Engineer - Strategic World Simulation.
 *
 *  - Unification: own 75% of all settlements and every rival capital.
 *  - Prosperity: 90,000 people, treasury 15,000, stability 0.75 and 120 reserve days everywhere, sustained 180 days
 *    (FactionState.prosperityDays counts the streak).
 *  - Diplomatic hegemony: peace + trade with every surviving rival, >= 2 tributaries (as overlord) or marriage
 *    alliances, every opinion >= 40.
 *  - Cultural legacy: 1,500 culture points (Σ culture effects of owned settlements x 10, added at each month start),
 *    2 landmarks and the Samrajya Age.
 * Progress bars (0..1): the mean of each path's clamped components (prosperity: half conditions, half streak).
 * Sandbox: the player wins on reaching 1 in an enabled path; loses with no settlement left (or the dynasty ending,
 * dynasty.ts). Scenarios use their own outcomes (events.checkObjectives).
 */
import type { FactionId, FactionState, SimEvent, VictoryType, WorldState } from '../../core/types';
import { RULES } from '../../data/rules';
import { ageIdx } from './ages';
import { areAtWar, effectiveOpinion, hasTreaty } from './diplomacy';
import { reserveDays } from './economy';
import { emptyMods, settlementEffects } from './modifiers';
import { activeTreaties } from './treaties';
import { addChronicle, stableKeys, today } from './state';

const V = RULES.victory;
const scratch = emptyMods();

function owned(world: WorldState, fid: FactionId): string[] {
  return stableKeys('settlements', world.settlements as Record<string, unknown>).filter((id) => world.settlements[id]!.ownerFactionId === fid);
}

function rivals(world: WorldState, fid: FactionId): FactionState[] {
  return stableKeys('factions', world.factions as Record<string, unknown>)
    .map((id) => world.factions[id]!)
    .filter((f) => f.id !== fid && f.alive);
}

export interface VictoryBreakdown {
  type: Exclude<VictoryType, 'scenario'>;
  progress: number;
  met: boolean;
  /** Component name -> 0..1. */
  parts: Record<string, number>;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((t, x) => t + x, 0) / xs.length;
}

export function unificationProgress(world: WorldState, fid: FactionId): VictoryBreakdown {
  const total = Object.keys(world.settlements).length;
  const mine = owned(world, fid).length;
  const caps = rivals(world, fid)
    .map((f) => f.capitalSettlementId)
    .filter((c): c is string => !!c);
  const held = caps.filter((c) => world.settlements[c]?.ownerFactionId === fid).length;
  const share = clamp01(mine / Math.max(1, total) / V.unification.settlementShare);
  const capitals = caps.length === 0 ? 1 : held / caps.length;
  return { type: 'unification', progress: mean([share, capitals]), met: share >= 1 && capitals >= 1, parts: { settlements: share, capitals } };
}

/** The prosperity conditions today (without the 180-day streak). */
export function prosperityConditions(world: WorldState, fid: FactionId): { met: boolean; parts: Record<string, number> } {
  const P = V.prosperity;
  const f = world.factions[fid];
  let pop = 0;
  let minRd = Infinity;
  for (const id of owned(world, fid)) {
    const s = world.settlements[id]!;
    pop += s.population;
    minRd = Math.min(minRd, reserveDays(s));
  }
  if (minRd === Infinity) minRd = 0;
  const parts = {
    population: clamp01(pop / P.population),
    treasury: clamp01((f?.treasury ?? 0) / P.treasury),
    stability: clamp01((f?.stability ?? 0) / P.stability),
    reserves: clamp01(minRd / P.reserveDays),
  };
  return { met: parts.population >= 1 && parts.treasury >= 1 && parts.stability >= 1 && parts.reserves >= 1, parts };
}

export function prosperityProgress(world: WorldState, fid: FactionId): VictoryBreakdown {
  const c = prosperityConditions(world, fid);
  const days = world.factions[fid]?.prosperityDays ?? 0;
  const streak = clamp01(days / V.prosperity.sustainDays);
  return { type: 'prosperity', progress: 0.5 * mean(Object.values(c.parts)) + 0.5 * streak, met: streak >= 1, parts: { ...c.parts, sustained: streak } };
}

export function hegemonyProgress(world: WorldState, fid: FactionId): VictoryBreakdown {
  const H = V.diplomatic_hegemony;
  const rs = rivals(world, fid);
  if (rs.length === 0) return { type: 'diplomatic_hegemony', progress: 0, met: false, parts: {} };
  let peaceTrade = 0;
  let friendly = 0;
  let bonds = 0;
  for (const r of rs) {
    if (!areAtWar(world, fid, r.id) && hasTreaty(world, fid, r.id, 'trade')) peaceTrade++;
    if (effectiveOpinion(world, fid, r.id) >= H.opinionAtLeast) friendly++;
    for (const t of activeTreaties(world, fid, r.id)) {
      if (t.type === 'marriage_alliance' || (t.type === 'tributary' && t.terms.overlord === fid)) bonds++;
    }
  }
  const parts = { peaceTrade: peaceTrade / rs.length, bonds: clamp01(bonds / H.tributariesOrMarriages), opinion: friendly / rs.length };
  return { type: 'diplomatic_hegemony', progress: mean(Object.values(parts)), met: parts.peaceTrade >= 1 && parts.bonds >= 1 && parts.opinion >= 1, parts };
}

export function culturalProgress(world: WorldState, fid: FactionId): VictoryBreakdown {
  const C = V.cultural_legacy;
  const f = world.factions[fid];
  const parts = {
    culture: clamp01((f?.culturePoints ?? 0) / C.culturePoints),
    landmarks: clamp01((f?.landmarks.length ?? 0) / C.landmarks),
    age: f ? ageIdx(f.age) / 2 : 0,
  };
  return { type: 'cultural_legacy', progress: mean(Object.values(parts)), met: parts.culture >= 1 && parts.landmarks >= 1 && parts.age >= 1, parts };
}

export function victoryBreakdowns(world: WorldState, fid: FactionId): VictoryBreakdown[] {
  return [unificationProgress(world, fid), prosperityProgress(world, fid), hegemonyProgress(world, fid), culturalProgress(world, fid)];
}

/** Culture produced per month by a faction (Σ culture effects of its settlements x 10). */
export function culturePerMonth(world: WorldState, fid: FactionId): number {
  let c = 0;
  for (const id of owned(world, fid)) c += settlementEffects(world, world.settlements[id]!, scratch).culture;
  return c * 10;
}

/** Daily: culture points, prosperity streak, progress bars; sandbox victory / defeat for the player. */
export function updateVictoryDaily(world: WorldState, out: SimEvent[]): void {
  const monthStart = world.calendar.day === 0;
  for (const fid of stableKeys('factions', world.factions as Record<string, unknown>)) {
    const f = world.factions[fid]!;
    if (!f.alive) continue;
    // Culture accrues monthly; the prosperity streak counts days; bars refresh every 5 days (the player's daily).
    if (monthStart) f.culturePoints += culturePerMonth(world, fid);
    f.prosperityDays = prosperityConditions(world, fid).met ? f.prosperityDays + 1 : 0;
    if (f.isPlayer || world.calendar.day % 5 === 0) for (const b of victoryBreakdowns(world, fid)) f.victoryProgress[b.type] = b.progress;
  }
  if (world.mode !== 'sandbox' || world.victory.status !== 'ongoing') return;
  const p = world.factions[world.playerFactionId];
  if (!p) return;
  const d = today(world);
  if (!p.alive || owned(world, p.id).length === 0) {
    world.victory.status = 'defeat';
    world.victory.outcomeId = 'realm_lost';
    world.victory.endedDay = d;
    addChronicle(world, p.id, `${p.name} has fallen.`, 2);
    out.push({ kind: 'scenario_ended', outcomeId: 'realm_lost', result: 'defeat' });
    return;
  }
  const enabled = world.sandbox?.victoryTypes ?? [];
  for (const b of victoryBreakdowns(world, p.id)) {
    if (!enabled.includes(b.type) || !b.met) continue;
    p.victoryProgress[b.type] = 1;
    world.victory.status = 'victory';
    world.victory.outcomeId = b.type;
    world.victory.endedDay = d;
    addChronicle(world, p.id, `${p.name} achieved ${b.type.replace('_', ' ')}.`, 2);
    out.push({ kind: 'scenario_ended', outcomeId: b.type, result: 'victory' });
    return;
  }
}
