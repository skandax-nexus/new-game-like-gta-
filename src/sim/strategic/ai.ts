/**
 * Campaign AI (strategic). OWNER: Lead AI & Simulation Engineer. Baseline by the CTO.
 *
 * Required (GDD §9 specialized AI): hierarchical goals per faction (defend, conquer, develop,
 * stabilize, ally, secure supply) scored by utility with personality + difficulty; army tasking with
 * supply awareness; economy (build/recruit/tax); diplomacy proposals; event responses via aiWeight.
 * Must be deterministic (world.rng only) and cheap: plan at most daily per faction, measurable
 * objectives (GDD §14 "Weak strategic AI" mitigation: automated simulation tests).
 */
import type { ArmyState, FactionId, IssuedStrategicCommand, TerrainQuery, WorldState } from '../../core/types';
import { sortedKeys } from '../../core/ids';
import { totalDays } from './seasons';
import { armyStrength, isHostile } from './armies';

/** Commands an AI faction wants to issue today. Baseline: idle armies attack weaker nearby enemies weekly. */
export function runCampaignAI(world: WorldState, factionId: FactionId, terrain: TerrainQuery): IssuedStrategicCommand[] {
  void terrain;
  const day = totalDays(world.calendar);
  const f = world.factions[factionId];
  if (!f || day % 7 !== 0) return [];
  f.ai.lastPlanHour = world.calendar.totalHours;
  const out: IssuedStrategicCommand[] = [];
  const aggression = world.sandbox?.aiAggression ?? 0.5;
  for (const id of sortedKeys(world.armies)) {
    const a = world.armies[id] as ArmyState;
    if (a.factionId !== factionId || a.status !== 'camped' || a.engagementId) continue;
    let best: ArmyState | null = null;
    let bestD = 2500 * 2500;
    for (const oid of sortedKeys(world.armies)) {
      const o = world.armies[oid] as ArmyState;
      if (!isHostile(world, factionId, o.factionId)) continue;
      const d = (o.x - a.x) * (o.x - a.x) + (o.z - a.z) * (o.z - a.z);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    if (best && armyStrength(a) > armyStrength(best) * (1.4 - aggression * 0.6)) {
      out.push({ factionId, hour: 0, cmd: { kind: 'army_order', armyId: a.id, order: { kind: 'attack_army', targetArmyId: best.id } } });
    }
  }
  return out;
}
