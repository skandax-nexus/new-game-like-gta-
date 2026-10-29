/**
 * End-of-game statistics and score (DESIGN_SPEC §8.9): pure selectors over WorldState.statistics counters (tracked by
 * the systems that cause them) and the monthly world.stats samples. OWNER: Simulation Engineer - Strategic World
 * Simulation (SIM-01).
 *
 *   score = 100 x settlements + 10 x population / 1,000 + wealth earned / 100 + 50 x battles won
 *         + 0.2 x enemies killed + 40 x treaties + 250 x landmarks + 300 x ages advanced + 150 x objectives completed
 *
 * Counters (WorldState.statistics[faction][id]): soldiers_raised, enemies_killed, soldiers_lost, battles_won,
 * battles_fought, largest_battle, settlements_captured, formations_routed, grain_harvested, wealth_earned,
 * trade_income, buildings_completed, landmarks, ages_advanced, famine_days, revolts, events_resolved,
 * treaties_signed, treaties_broken, wars, marriages (+ helper counters).
 */
import type { FactionId, WorldState } from '../../core/types';
import { sortedKeys } from '../../core/ids';
import { AGES } from '../../data/ages';
import { RULES } from '../../data/rules';
import { END_GAME_STATS, type StatDef } from '../../data/statistics';
import { totalDays } from './seasons';
import { getStat } from './state';

export interface ScoreBreakdown {
  total: number;
  terms: { id: string; label: string; value: number }[];
}

function ownedSettlements(world: WorldState, fid: FactionId): number {
  let n = 0;
  for (const id of sortedKeys(world.settlements)) if (world.settlements[id]!.ownerFactionId === fid) n++;
  return n;
}

function population(world: WorldState, fid: FactionId): number {
  let p = 0;
  for (const id of sortedKeys(world.settlements)) {
    const s = world.settlements[id]!;
    if (s.ownerFactionId === fid) p += s.population;
  }
  return p;
}

/** Objectives the player completed (scenario); 0 for AI factions. */
function objectivesCompleted(world: WorldState, fid: FactionId): number {
  if (fid !== world.playerFactionId) return 0;
  return Object.values(world.victory.objectives).filter((s) => s === 'complete').length;
}

/** Score (§8.9, RULES.score) with its terms. */
export function computeScore(world: WorldState, fid: FactionId): ScoreBreakdown {
  const S = RULES.score;
  const terms = [
    { id: 'settlements', label: 'Settlements', value: S.perSettlement * ownedSettlements(world, fid) },
    { id: 'population', label: 'Population', value: (S.perThousandPopulation * population(world, fid)) / 1000 },
    { id: 'wealth', label: 'Wealth earned', value: (S.perHundredWealth * getStat(world, fid, 'wealth_earned')) / 100 },
    { id: 'battles', label: 'Battles won', value: S.perBattleWon * getStat(world, fid, 'battles_won') },
    { id: 'killed', label: 'Enemies killed', value: S.perEnemyKilled * getStat(world, fid, 'enemies_killed') },
    { id: 'treaties', label: 'Treaties', value: S.perTreaty * getStat(world, fid, 'treaties_signed') },
    { id: 'landmarks', label: 'Landmarks', value: S.perLandmark * getStat(world, fid, 'landmarks') },
    { id: 'ages', label: 'Ages advanced', value: S.perAge * getStat(world, fid, 'ages_advanced') },
    { id: 'objectives', label: 'Objectives', value: S.perObjective * objectivesCompleted(world, fid) },
  ];
  return { total: Math.round(terms.reduce((t, x) => t + x.value, 0)), terms };
}

export interface StatCell {
  factionId: FactionId;
  /** Numeric value (NaN for text-only stats). */
  value: number;
  text: string;
  best: boolean;
}

export interface StatRow {
  def: StatDef;
  cells: StatCell[];
}

function sampleSeries(world: WorldState, fid: FactionId, key: 'treasury' | 'population' | 'stability'): number[] {
  const out: number[] = [];
  for (const s of world.stats) {
    const f = s.factions[fid];
    if (f) out.push(f[key]);
  }
  return out;
}

function valueOf(world: WorldState, fid: FactionId, id: string): { value: number; text: string } {
  const f = world.factions[fid]!;
  const n = (v: number): { value: number; text: string } => ({ value: v, text: String(Math.round(v)) });
  switch (id) {
    case 'score':
      return n(computeScore(world, fid).total);
    case 'outcome':
      return { value: Number.NaN, text: fid === world.playerFactionId ? (world.victory.outcomeId ?? world.victory.status) : f.alive ? 'endured' : 'fallen' };
    case 'days':
      return n(totalDays(world.calendar));
    case 'age':
      return { value: Number.NaN, text: AGES[f.age].name };
    case 'battles_won': {
      const won = getStat(world, fid, 'battles_won');
      const fought = getStat(world, fid, 'battles_fought');
      return { value: won, text: `${Math.round(won)} / ${Math.round(fought)}` };
    }
    case 'peak_treasury': {
      const s = sampleSeries(world, fid, 'treasury');
      return n(Math.max(f.treasury, ...s));
    }
    case 'peak_population': {
      const s = sampleSeries(world, fid, 'population');
      return n(Math.max(population(world, fid), ...s));
    }
    case 'avg_stability': {
      const s = sampleSeries(world, fid, 'stability');
      const v = s.length > 0 ? s.reduce((t, x) => t + x, 0) / s.length : f.stability;
      return { value: v, text: `${Math.round(v * 100)}%` };
    }
    default:
      return n(getStat(world, fid, id));
  }
}

/** The statistics screen: one row per END_GAME_STATS entry, the player first, then every other faction. */
export function endGameStats(world: WorldState): StatRow[] {
  const ids = [world.playerFactionId, ...sortedKeys(world.factions).filter((id) => id !== world.playerFactionId)];
  return END_GAME_STATS.map((def) => {
    const cells = ids.map((fid) => ({ factionId: fid, ...valueOf(world, fid, def.id), best: false }));
    const nums = cells.filter((c) => !Number.isNaN(c.value)).map((c) => c.value);
    if (nums.length > 0) {
      const best = def.higherIsBetter ? Math.max(...nums) : Math.min(...nums);
      for (const c of cells) c.best = !Number.isNaN(c.value) && c.value === best;
    }
    return { def, cells };
  });
}
