/**
 * Hero-mode API of the strategic world (DESIGN_SPEC §11.9). OWNER: Simulation Engineer - Strategic World Simulation.
 *
 *  - `applyHeroMissionResult(world, factionId, result, out)`: applies a finished mission exactly once - its
 *    onSuccess / onFailure effects (event DSL, player scope, settlement = the mission's), every recorded dialogue
 *    choice's effects (once per choice, see `applyDialogueEffects`), clue flags `clue_<id>`, negotiation flags
 *    `neg_<characterId>` = won | lost, objective flags `hero_obj_<missionId>_<objectiveId>`, `hero_wounded` when the
 *    hero ends below 30% health. The mission is recorded as flag `hero_done_<missionId>` = 'success' | 'failure';
 *    a second call with the same mission is a no-op (returns false).
 *  - `applyDialogueEffects(world, factionId, choiceKeys, out)`: dialogue choices taken in free exploration; each key
 *    (`<treeId>_<choiceId>`, also accepted with a leading `dlg_`) applies its effects once (flag = the key).
 *  - `availableHeroMissions(world, factionId)`: missions whose `availability` holds now and that are not done;
 *    `updateHeroAvailabilityDaily` announces newly available ones to the player (`hero_mission_available`).
 * All state written is world flags / effects, so saving, loading and autoresolving never break the campaign.
 */
import type { DialogueChoiceDef, EventScope, FactionId, HeroMissionDef, HeroMissionResult, SimEvent, WorldState } from '../../core/types';
import { DIALOGUES, HERO_MISSIONS, getHeroMission } from '../../data/hero';
import { applyEffect, evalCondition } from './events';
import { addChronicle, addStat, notifyPlayer, today } from './state';

const FLAGS = (world: WorldState): Record<string, number | boolean | string> => world.events.flags;

export function heroMissionDoneFlag(missionId: string): string {
  return `hero_done_${missionId}`;
}

function scopeFor(world: WorldState, factionId: FactionId, m: HeroMissionDef | null): EventScope {
  const f = world.factions[factionId];
  return { factionId, settlementId: m?.settlementId ?? f?.capitalSettlementId ?? null, provinceId: null, characterId: null, armyId: null };
}

/** Resolve a dialogue choice key (`<treeId>_<choiceId>` or `dlg_<treeId>_<choiceId>`). */
export function findDialogueChoice(key: string): DialogueChoiceDef | null {
  let best: { treeId: string; choice: string } | null = null;
  for (const treeId of Object.keys(DIALOGUES).sort()) {
    for (const prefix of [`${treeId}_`, `dlg_${treeId}_`]) {
      if (key.startsWith(prefix) && (!best || treeId.length > best.treeId.length)) best = { treeId, choice: key.slice(prefix.length) };
    }
  }
  if (!best) return null;
  const tree = DIALOGUES[best.treeId]!;
  for (const nid of Object.keys(tree.nodes).sort()) {
    const c = tree.nodes[nid]!.choices.find((x) => x.id === best!.choice);
    if (c) return c;
  }
  return null;
}

/** Apply dialogue choices' effects, each at most once (the key becomes a world flag). Returns how many applied. */
export function applyDialogueEffects(world: WorldState, factionId: FactionId, choiceKeys: readonly string[], out: SimEvent[]): number {
  const flags = FLAGS(world);
  const scope = scopeFor(world, factionId, null);
  let n = 0;
  for (const key of choiceKeys) {
    if (flags[key] !== undefined) continue;
    const c = findDialogueChoice(key);
    flags[key] = true;
    if (!c) continue;
    for (const e of c.effects) applyEffect(world, e, scope, out);
    n++;
  }
  return n;
}

/**
 * Apply a finished hero mission once (GP-03 `completeHeroMission`). Returns false when the mission is unknown or was
 * already applied.
 */
export function applyHeroMissionResult(world: WorldState, factionId: FactionId, result: HeroMissionResult, out: SimEvent[]): boolean {
  const m = getHeroMission(result.missionId);
  const flags = FLAGS(world);
  const done = heroMissionDoneFlag(result.missionId);
  if (!m || flags[done] !== undefined) return false;
  flags[done] = result.success ? 'success' : 'failure';
  const scope = scopeFor(world, factionId, m);
  for (const e of result.success ? m.onSuccess : m.onFailure) applyEffect(world, e, scope, out);
  applyDialogueEffects(world, factionId, result.dialogueChoices, out);
  for (const clue of result.clues) flags[`clue_${clue}`] = true;
  for (const cid of Object.keys(result.negotiations).sort()) flags[`neg_${cid}`] = result.negotiations[cid] as string;
  for (const oid of result.objectivesCompleted) flags[`hero_obj_${m.id}_${oid}`] = true;
  if (result.heroHealth < 0.3) flags.hero_wounded = true;
  addStat(world, factionId, result.success ? 'hero_missions_won' : 'hero_missions_lost', 1);
  addChronicle(world, factionId, `${m.title}: ${result.success ? 'the prince succeeded' : 'it went badly'}.`, 1);
  return true;
}

/** Missions offered now (availability holds, not yet done). */
export function availableHeroMissions(world: WorldState, factionId: FactionId): HeroMissionDef[] {
  const flags = FLAGS(world);
  const scope = scopeFor(world, factionId, null);
  return HERO_MISSIONS.filter((m) => flags[heroMissionDoneFlag(m.id)] === undefined && evalCondition(world, m.availability, { ...scope, settlementId: m.settlementId }));
}

/** Daily: tell the player about missions that just became available (once each until done). */
export function updateHeroAvailabilityDaily(world: WorldState, out: SimEvent[]): void {
  const p = world.factions[world.playerFactionId];
  if (!p || !p.alive) return;
  const flags = FLAGS(world);
  for (const m of availableHeroMissions(world, p.id)) {
    const key = `hero_avail_${m.id}`;
    if (flags[key] !== undefined) continue;
    flags[key] = today(world);
    out.push({ kind: 'hero_mission_available', missionId: m.id });
    const s = world.settlements[m.settlementId];
    notifyPlayer(world, out, p.id, 'info', `${m.title} - a task for the prince at ${s?.name ?? m.settlementId}.`, s ? { x: s.x, z: s.z } : null);
  }
}
