/**
 * Battle AI + intent translation - public entry points. OWNER: AI Engineer - Battle AI, Intents & Campaign AI (SIM-02),
 * reporting to the Lead AI & Simulation Engineer. Signatures kept from the CTO baseline (W15): `runBattleAI`,
 * `translateIntent`.
 *
 * Both run INSIDE stepBattle (deterministic, part of the authoritative sim) every AI_THINK_TICKS (1 s), also during
 * deployment, so the BattleScene, distant battles and autoresolve resolve the same battle identically.
 *  - `runBattleAI(state, side, terrain)`: commands for an AI-controlled side. The side re-plans every
 *    `DIFFICULTY_DEFS[difficulty].battleAiReplanSec` (3 / 2 / 1.5 / 1 s, an accumulated schedule over the 1 s thinks);
 *    between plans it issues nothing. Field battles: ai/field.ts (deployment, posture, roles, line, missiles, mounted,
 *    elephants, reserve, pursuit, rally, withdrawal). Sieges: ai/siege.ts. The plan lives in
 *    `BattleSideState.aiMemory`; randomness comes from the side's own seeded stream in that memory. The AI sees only
 *    what its side sees (ai/common.ts `perceive`). Formations carrying an intent are left to the intent translation.
 *  - `translateIntent(state, index, intent, terrain)`: the DESIGN_SPEC §6.4 table (ai/intents.ts), for the player and
 *    AI sides alike; null keeps the current order.
 * Budget (ARCHITECTURE §15, SIM-02 spec 5): < 0.1 ms per think at 40 formations (tests/sim/ai/perf.test.ts).
 */
import type { BattleCommand, BattleState, FormationIndex, FormationOrder, IntentOrder, SideIndex, TerrainQuery } from '../../core/types';
import { battleContext } from './context';
import { perceive, replanSeconds, saveRng } from './ai/common';
import { runField } from './ai/field';
import { runSiege } from './ai/siege';
import { translateIntentOrder } from './ai/intents';

/** Commands an AI-controlled side issues at this think (empty between re-plans). */
export function runBattleAI(state: BattleState, side: SideIndex, terrain: TerrainQuery): BattleCommand[] {
  const sideState = state.sides[side];
  if (state.outcome || sideState.withdrawn || sideState.surrendered) return [];
  const mem = sideState.aiMemory;
  const t = state.time;
  if (state.phase === 'deployment') {
    if (mem.deployed === true) return [];
  } else {
    const next = mem.next;
    if (typeof next === 'number' && t + 1e-6 < next) return [];
    const step = replanSeconds(state, side);
    // Accumulated schedule (1.5 s re-plans alternate 1 s / 2 s gaps over the 1 s thinks); never schedules in the past.
    mem.next = typeof next === 'number' && next + step > t ? next + step : t + step;
  }
  const ai = perceive(state, side, terrain);
  const ctx = battleContext(state, terrain);
  if (ctx.fort && state.siege) runSiege(ai, ctx.fort);
  else runField(ai);
  saveRng(ai);
  return ai.cmds;
}

/** Translate an intent into the concrete order formation `index` should execute now (null = keep its order). */
export function translateIntent(state: BattleState, index: FormationIndex, intent: IntentOrder, terrain: TerrainQuery): FormationOrder | null {
  return translateIntentOrder(state, index, intent, terrain);
}
