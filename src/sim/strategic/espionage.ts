/**
 * Espionage & intelligence (GDD §7: networks that limit what rivals know). OWNER: Lead AI & Simulation.
 * Baseline by the CTO: agent bookkeeping, progress/capture rolls, intel decay.
 *
 * Required behavior: missions (gather_intel raises intel[owner][target], counter_intelligence protects,
 * sabotage_supply damages depots/roads, incite_unrest raises settlement unrest, spread_rumors lowers
 * opinion/legitimacy, protect_court guards against plots). Intel level gates what the UI may show about
 * rival armies/settlements (fog of war on the strategic map) and what AI knows of the player.
 */
import type { AgentId, CharacterId, FactionId, SettlementId, SimEvent, SpyAgent, SpyMission, WorldState } from '../../core/types';
import { nextWorldId, sortedKeys } from '../../core/ids';
import { BALANCE } from '../../data/balance';
import { totalDays } from './seasons';
import { withWorldRng } from './state';

export function startSpyMission(
  world: WorldState,
  owner: FactionId,
  target: FactionId,
  mission: SpyMission,
  settlementId: SettlementId | null,
  characterId: CharacterId | null,
  out: SimEvent[],
): boolean {
  if (!world.factions[target] || owner === target) return false;
  const agent: SpyAgent = {
    id: nextWorldId(world, 'agent') as AgentId,
    characterId,
    ownerFactionId: owner,
    targetFactionId: target,
    targetSettlementId: settlementId,
    mission,
    progress: 0,
    risk: 0.1,
    skill: characterId ? (world.characters[characterId]?.skills.intrigue ?? 8) : 8,
    status: 'active',
    startedDay: totalDays(world.calendar),
  };
  world.espionage.agents[agent.id] = agent;
  void out;
  return true;
}

/** How much `observer` knows about `target` (0..1). */
export function intelLevel(world: WorldState, observer: FactionId, target: FactionId): number {
  if (observer === target) return 1;
  return world.espionage.intel[observer]?.[target]?.level ?? 0;
}

export function updateEspionageDaily(world: WorldState, out: SimEvent[]): void {
  const e = BALANCE.espionage;
  for (const id of sortedKeys(world.espionage.agents)) {
    const a = world.espionage.agents[id]!;
    if (a.status !== 'active') continue;
    withWorldRng(world, (rng) => {
      if (rng.chance(e.baseRiskPerDay * (1 + a.risk) * (1 - a.skill / 30))) {
        a.status = 'captured';
        out.push({ kind: 'spy_report', agentId: a.id, success: false, text: 'An agent has been captured.' });
        return;
      }
      a.progress += e.baseSuccessPerDay * (0.5 + a.skill / 20) * (0.5 + rng.next());
      if (a.progress >= 1) {
        a.status = 'returned';
        if (a.mission === 'gather_intel') {
          const row = (world.espionage.intel[a.ownerFactionId] ??= {});
          const cur = row[a.targetFactionId] ?? { level: 0, lastUpdatedDay: 0, armiesVisibleUntilDay: null };
          row[a.targetFactionId] = { level: Math.min(1, cur.level + 0.35), lastUpdatedDay: totalDays(world.calendar), armiesVisibleUntilDay: cur.armiesVisibleUntilDay };
        }
        out.push({ kind: 'spy_report', agentId: a.id, success: true, text: `Mission "${a.mission}" succeeded.` });
      }
    });
  }
  // Intel decays slowly (applied daily).
  for (const obs of sortedKeys(world.espionage.intel)) {
    const row = world.espionage.intel[obs]!;
    for (const t of sortedKeys(row)) {
      if (t === obs) continue;
      const st = row[t]!;
      st.level = Math.max(0.05, st.level - e.intelDecayPerMonth / 30);
    }
  }
}
