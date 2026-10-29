/**
 * Visible villagers (DESIGN_SPEC §8.3): how many cosmetic villagers a settlement shows and what they do, derived from
 * labor and its allocation. OWNER: Simulation Engineer - Strategic World Simulation (SIM-01). Consumed by GFX-06
 * (VillagerSystem) and GP-03; pure, allocation-light, no state.
 *
 * Count = min(cap, labor x 0.01), split by laborAllocation (largest-remainder rounding so the parts sum to the count).
 * Construction villagers work on active sites; the share of builders left idle sits in the shade (`constructionIdle`).
 * A small group of water carriers is always present (`carriers`, part of the total, taken from the largest group).
 */
import type { SettlementState } from '../../core/types';
import { RULES } from '../../data/rules';

export interface VillagerAllocation {
  total: number;
  farming: number;
  construction: number;
  /** Of `construction`: builders without a job (idle pose near the well). */
  constructionIdle: number;
  crafts: number;
  military: number;
  /** Water carriers between well / ghat and houses (always some). */
  carriers: number;
  /** Builders per active job (queue order), for scaffolds. */
  perJob: number[];
}

/** Labor per visible villager (labor x 0.01). */
export const VILLAGERS_PER_LABOR = 0.01;

export function villagerAllocation(s: SettlementState, cap: number): VillagerAllocation {
  const total = Math.max(0, Math.min(Math.floor(cap), Math.floor(s.labor * VILLAGERS_PER_LABOR)));
  const a = s.laborAllocation;
  const keys = ['farming', 'construction', 'crafts', 'military'] as const;
  const sum = a.farming + a.construction + a.crafts + a.military || 1;
  const parts = keys.map((k) => (total * a[k]) / sum);
  const floors = parts.map((p) => Math.floor(p));
  let left = total - floors.reduce((x, y) => x + y, 0);
  const order = parts.map((p, i) => ({ i, r: p - Math.floor(p) })).sort((x, y) => y.r - x.r || x.i - y.i);
  for (const o of order) {
    if (left <= 0) break;
    floors[o.i] = (floors[o.i] as number) + 1;
    left--;
  }
  const res: VillagerAllocation = { total, farming: floors[0] as number, construction: floors[1] as number, crafts: floors[2] as number, military: floors[3] as number, constructionIdle: 0, carriers: 0, perJob: [] };
  // Builders on jobs vs idle, by the builders the sim assigned today.
  const builders = Math.max(RULES.construction.minBuilders, s.labor * a.construction);
  let assigned = 0;
  for (let i = 0; i < s.construction.length && i < RULES.construction.parallelJobs; i++) assigned += s.construction[i]!.laborAssigned;
  const busyShare = builders > 0 ? Math.min(1, assigned / builders) : 0;
  const busy = Math.round(res.construction * busyShare);
  res.constructionIdle = res.construction - busy;
  let rest = busy;
  for (let i = 0; i < s.construction.length && i < RULES.construction.parallelJobs; i++) {
    const n = assigned > 0 ? Math.round((busy * s.construction[i]!.laborAssigned) / assigned) : 0;
    const take = Math.min(rest, n);
    res.perJob.push(take);
    rest -= take;
  }
  // Water carriers: 5% of the total (at least 1 when anyone is shown), drawn from farming.
  if (total > 0) {
    res.carriers = Math.min(res.farming, Math.max(1, Math.round(total * 0.05)));
    res.farming -= res.carriers;
  }
  return res;
}
