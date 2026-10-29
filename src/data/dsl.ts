/**
 * Tiny builders for the event condition/effect DSL (core/types.ts `Condition` / `Effect`). OWNER: Creative
 * Director. Used by campaign.ts, events.ts and hero.ts so authored content stays short and type-checked.
 * Pure functions returning plain JSON data - never store these functions in state.
 */
import type {
  CharacterId,
  CharacterVar,
  CompareOp,
  Condition,
  Effect,
  EventDefId,
  FactionId,
  FactionVar,
  RebellionStage,
  ScopeRef,
  Season,
  SettlementId,
  SettlementVar,
  TreatyType,
} from '../core/types';

// --- scope refs ---------------------------------------------------------------------------------------
export const PLAYER: ScopeRef = { kind: 'player' };
export const SCOPE_FACTION: ScopeRef = { kind: 'scope_faction' };
export const SCOPE_SETTLEMENT: ScopeRef = { kind: 'scope_settlement' };
export const SCOPE_CHARACTER: ScopeRef = { kind: 'scope_character' };
export const CAPITAL: ScopeRef = { kind: 'capital' };
export const ANY_OWNED: ScopeRef = { kind: 'any_owned_settlement' };
export const RULER: ScopeRef = { kind: 'ruler' };
export const faction = (id: FactionId): ScopeRef => ({ kind: 'faction', id });
export const settlement = (id: SettlementId): ScopeRef => ({ kind: 'settlement', id });
export const character = (id: CharacterId): ScopeRef => ({ kind: 'character', id });

// --- conditions ---------------------------------------------------------------------------------------
export const all = (...of: Condition[]): Condition => ({ kind: 'all', of });
export const any = (...of: Condition[]): Condition => ({ kind: 'any', of });
export const not = (cond: Condition): Condition => ({ kind: 'not', cond });
export const flagSet = (flag: string): Condition => ({ kind: 'flag_set', flag });
export const flagIs = (flag: string, value: number | boolean | string): Condition => ({ kind: 'flag', flag, value });
export const dayAtLeast = (day: number): Condition => ({ kind: 'day_at_least', day });
export const inSeason = (season: Season): Condition => ({ kind: 'season', season });
export const chance = (p: number): Condition => ({ kind: 'random', chance: p });
export const owns = (settlementId: SettlementId, who: ScopeRef = PLAYER): Condition => ({ kind: 'owns_settlement', faction: who, settlementId });
export const atWar = (a: ScopeRef, b: ScopeRef | null): Condition => ({ kind: 'at_war', a, b });
export const hasTreaty = (a: ScopeRef, b: ScopeRef, type: TreatyType): Condition => ({ kind: 'has_treaty', a, b, type });
export const fv = (target: ScopeRef, variable: FactionVar, op: CompareOp, value: number): Condition => ({ kind: 'faction_var', target, variable, op, value });
export const sv = (target: ScopeRef, variable: SettlementVar, op: CompareOp, value: number): Condition => ({ kind: 'settlement_var', target, variable, op, value });
export const cv = (target: ScopeRef, variable: CharacterVar, op: CompareOp, value: number): Condition => ({ kind: 'character_var', target, variable, op, value });
export const stageAtLeast = (target: ScopeRef, stage: RebellionStage): Condition => ({ kind: 'rebellion_stage_at_least', target, stage });
export const soldiersAtLeast = (who: ScopeRef, soldiers: number): Condition => ({ kind: 'army_strength_at_least', faction: who, soldiers });
export const battleWon = (who: ScopeRef, withinDays: number): Condition => ({ kind: 'battle_won', faction: who, withinDays });
export const resolved = (eventId: EventDefId, choiceId: string | null = null): Condition => ({ kind: 'event_resolved', eventId, choiceId });
/** Trigger used by chain-only / scheduled-only events: never fires on its own (sim convention). */
export const NEVER: Condition = { kind: 'flag_set', flag: '__never__' };

// --- effects ------------------------------------------------------------------------------------------
export const setFlag = (flag: string, value: number | boolean | string = true): Effect => ({ kind: 'set_flag', flag, value });
export const clearFlag = (flag: string): Effect => ({ kind: 'clear_flag', flag });
export const trigger = (eventId: EventDefId, delayDays = 0): Effect => ({ kind: 'trigger_event', eventId, delayDays });
export const chronicle = (text: string): Effect => ({ kind: 'chronicle', text });
export const addF = (target: ScopeRef, variable: FactionVar, value: number): Effect => ({ kind: 'faction_var', target, variable, op: 'add', value });
export const mulF = (target: ScopeRef, variable: FactionVar, value: number): Effect => ({ kind: 'faction_var', target, variable, op: 'mul', value });
export const addS = (target: ScopeRef, variable: SettlementVar, value: number): Effect => ({ kind: 'settlement_var', target, variable, op: 'add', value });
export const mulS = (target: ScopeRef, variable: SettlementVar, value: number): Effect => ({ kind: 'settlement_var', target, variable, op: 'mul', value });
export const setS = (target: ScopeRef, variable: SettlementVar, value: number): Effect => ({ kind: 'settlement_var', target, variable, op: 'set', value });
export const addC = (target: ScopeRef, variable: CharacterVar, value: number): Effect => ({ kind: 'character_var', target, variable, op: 'add', value });
export const opinion = (a: ScopeRef, b: ScopeRef, delta: number): Effect => ({ kind: 'opinion', a, b, delta });
export const sign = (a: ScopeRef, b: ScopeRef, type: TreatyType): Effect => ({ kind: 'sign_treaty', a, b, type });
export const war = (a: ScopeRef, b: ScopeRef): Effect => ({ kind: 'declare_war', a, b });
export const setStage = (target: ScopeRef, stage: RebellionStage): Effect => ({ kind: 'set_rebellion_stage', target, stage });
export const transfer = (s: ScopeRef, to: ScopeRef): Effect => ({ kind: 'transfer_settlement', settlement: s, to });
export const objective = (objectiveId: string, status: 'complete' | 'failed'): Effect => ({ kind: 'objective', objectiveId, status });
export const damageRoad = (nearSettlement: SettlementId, amount: number): Effect => ({ kind: 'damage_road', edgeId: null, nearSettlement, amount });
