/**
 * Event engine: conditions/effects DSL, triggers, scheduled chains, choices, objectives & scenario
 * outcomes. OWNER: Lead AI & Simulation Engineer. Baseline by the CTO (most of the DSL implemented).
 *
 * Required behavior (GDD §6 consequence chains, §8 branching narrative):
 *  - Each day: fire scheduled events whose day arrived; for each EventDef whose trigger holds (and not
 *    on cooldown / once-fired), fire with probability 1/meanDays (meanDays 0 = immediately).
 *  - Player events wait for an `event_choice` command (auto-resolve after autoResolveDays with the
 *    first choice); AI factions pick via aiWeight (ai.chooseAiEventChoice).
 *  - Effects apply in order; `trigger_event` schedules follow-ups (consequence chains).
 *  - Objectives/outcomes evaluated daily; scenario ends on time limit or when a defeat outcome holds.
 */
import type {
  CharacterState,
  CompareOp,
  Condition,
  Effect,
  EventDef,
  EventInstance,
  EventScope,
  FactionState,
  ScopeRef,
  SettlementState,
  SimEvent,
  WorldState,
} from '../../core/types';
import { REBELLION_STAGES } from '../../core/types';
import { nextWorldId } from '../../core/ids';
import { EVENT_HISTORY_LIMIT } from '../../core/constants';
import { EVENTS, getEventDef } from '../../data/events';
import { SCENARIOS } from '../../data/campaign';
import { seasonOf, totalDays } from './seasons';
import { addChronicle, addStat, notifyPlayer, stableKeys, withWorldRng } from './state';
import { clamp01 } from '../../core/math';
import { DIFFICULTY_DEFS } from '../../data/difficulty';
import { armySoldiers, makeArmy } from './armies';
import { createTreaty, declareWar, emptyTerms, hasTreaty } from './diplomacy';
import { registerEffectRunner } from './construction';
import { forceRebellionStage } from './politics';
import { handleDeath } from './dynasty';
import { noteEventChoice } from './council';
import { transferOwnership } from './siege';
import { setRationing } from './economy';

/** Event flag that switches the scope realm's rationing policy on (set_flag) or off (clear_flag). */
export const RATIONING_FLAG = 'rationing';

function cmp(a: number, op: CompareOp, b: number): boolean {
  switch (op) {
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '>=':
      return a >= b;
    case '==':
      return a === b;
    case '!=':
      return a !== b;
    default:
      return false;
  }
}

function resolveFaction(world: WorldState, ref: ScopeRef, scope: EventScope): FactionState | null {
  switch (ref.kind) {
    case 'player':
      return world.factions[world.playerFactionId] ?? null;
    case 'scope_faction':
      return world.factions[scope.factionId] ?? null;
    case 'faction':
      return world.factions[ref.id] ?? null;
    default:
      return null;
  }
}

function resolveSettlements(world: WorldState, ref: ScopeRef, scope: EventScope): SettlementState[] {
  switch (ref.kind) {
    case 'scope_settlement':
      return scope.settlementId && world.settlements[scope.settlementId] ? [world.settlements[scope.settlementId]!] : [];
    case 'settlement':
      return world.settlements[ref.id] ? [world.settlements[ref.id]!] : [];
    case 'capital': {
      const f = world.factions[scope.factionId];
      const c = f?.capitalSettlementId ? world.settlements[f.capitalSettlementId] : null;
      return c ? [c] : [];
    }
    case 'any_owned_settlement':
      return stableKeys('settlements', world.settlements as Record<string, unknown>)
        .map((id) => world.settlements[id]!)
        .filter((s) => s.ownerFactionId === scope.factionId);
    default:
      return [];
  }
}

function resolveCharacter(world: WorldState, ref: ScopeRef, scope: EventScope): CharacterState | null {
  switch (ref.kind) {
    case 'scope_character':
      return scope.characterId ? (world.characters[scope.characterId] ?? null) : null;
    case 'character':
      return world.characters[ref.id] ?? null;
    case 'ruler': {
      const f = world.factions[scope.factionId];
      return f?.rulerId ? (world.characters[f.rulerId] ?? null) : null;
    }
    default:
      return null;
  }
}

/** Evaluate a condition. For 'any_owned_settlement' targets, `matched` receives the first match. */
export function evalCondition(world: WorldState, cond: Condition, scope: EventScope, matched?: { settlementId: string | null }): boolean {
  switch (cond.kind) {
    case 'all':
      return cond.of.every((c) => evalCondition(world, c, scope, matched));
    case 'any':
      return cond.of.some((c) => evalCondition(world, c, scope, matched));
    case 'not':
      return !evalCondition(world, cond.cond, scope);
    case 'settlement_var': {
      for (const s of resolveSettlements(world, cond.target, scope)) {
        if (cmp(s[cond.variable] as number, cond.op, cond.value)) {
          if (matched) matched.settlementId = s.id;
          return true;
        }
      }
      return false;
    }
    case 'faction_var': {
      const f = resolveFaction(world, cond.target, scope);
      return !!f && cmp(f[cond.variable], cond.op, cond.value);
    }
    case 'character_var': {
      const c = resolveCharacter(world, cond.target, scope);
      return !!c && cmp(c[cond.variable], cond.op, cond.value);
    }
    case 'rebellion_stage_at_least':
      return resolveSettlements(world, cond.target, scope).some((s) => REBELLION_STAGES.indexOf(s.rebellionStage) >= REBELLION_STAGES.indexOf(cond.stage));
    case 'season':
      return seasonOf(world.calendar) === cond.season;
    case 'weather':
      return world.weather.kind === cond.weather;
    case 'day_at_least':
      return totalDays(world.calendar) >= cond.day;
    case 'flag':
      return world.events.flags[cond.flag] === cond.value;
    case 'flag_set':
      return cond.flag in world.events.flags && world.events.flags[cond.flag] !== false;
    case 'at_war': {
      const a = resolveFaction(world, cond.a, scope);
      if (!a) return false;
      if (cond.b) {
        const b = resolveFaction(world, cond.b, scope);
        return !!b && Object.values(world.diplomacy.relations).some((r) => r.atWar && ((r.a === a.id && r.b === b.id) || (r.a === b.id && r.b === a.id)));
      }
      return Object.values(world.diplomacy.relations).some((r) => r.atWar && (r.a === a.id || r.b === a.id));
    }
    case 'has_treaty': {
      const a = resolveFaction(world, cond.a, scope);
      const b = resolveFaction(world, cond.b, scope);
      return !!a && !!b && hasTreaty(world, a.id, b.id, cond.type);
    }
    case 'owns_settlement': {
      const f = resolveFaction(world, cond.faction, scope);
      return !!f && world.settlements[cond.settlementId]?.ownerFactionId === f.id;
    }
    case 'battle_won': {
      const f = resolveFaction(world, cond.faction, scope);
      if (!f) return false;
      return world.battleHistory.some((o) => o.winner !== null && o.sides[o.winner].factionId === f.id);
    }
    case 'army_strength_at_least': {
      const f = resolveFaction(world, cond.faction, scope);
      if (!f) return false;
      let n = 0;
      for (const a of Object.values(world.armies)) if (a.factionId === f.id) n += armySoldiers(a);
      return n >= cond.soldiers;
    }
    case 'event_resolved':
      return world.events.history.some((e) => e.defId === cond.eventId && e.status === 'resolved' && (cond.choiceId === null || e.choiceId === cond.choiceId));
    case 'random':
      return withWorldRng(world, (rng) => rng.chance(cond.chance));
    default:
      return false;
  }
}

function applyOp(cur: number, op: 'add' | 'set' | 'mul', v: number): number {
  return op === 'add' ? cur + v : op === 'mul' ? cur * v : v;
}

/** Settlement variables where a rise is a misfortune / a fall is a misfortune (others are never scaled). */
const SETTLEMENT_WORSE_UP: ReadonlySet<string> = new Set(['unrest', 'damage', 'grainPrice']);
const SETTLEMENT_WORSE_DOWN: ReadonlySet<string> = new Set(['foodStored', 'population', 'loyalty', 'wealth', 'publicOrder', 'health', 'recruitPool', 'infrastructure', 'waterAvailability', 'irrigation', 'sanitation', 'housing']);
const CHARACTER_WORSE_DOWN: ReadonlySet<string> = new Set(['loyalty', 'health', 'opinionOfRuler']);
/** Set while a disaster event's effects apply (see applyEffect). */
let severityOn = false;

/**
 * Misfortune severity (DESIGN_SPEC §10.3): a harmful add / mul on the player's own settlement, realm or people is
 * scaled by DIFFICULTY_DEFS[difficulty].eventSeverity (x0.75 Chronicler ... x1.3 Samrat). `worseUp` = a rise hurts.
 */
export function severityScaled(world: WorldState, op: 'add' | 'set' | 'mul', v: number, worseUp: boolean, playerTarget: boolean): number {
  if (!playerTarget || op === 'set' || !severityOn) return v;
  const k = DIFFICULTY_DEFS[world.difficulty]?.eventSeverity ?? 1;
  if (k === 1) return v;
  if (op === 'add') return (worseUp ? v > 0 : v < 0) ? v * k : v;
  // mul
  if (worseUp ? v > 1 : v < 1) return Math.max(0, 1 + (v - 1) * k);
  return v;
}

/**
 * Apply one effect. `misfortune` (effects of disaster events) scales harmful changes to the player's own settlements,
 * realm and people by the difficulty's eventSeverity; choice costs and rewards are never scaled.
 */
export function applyEffect(world: WorldState, effect: Effect, scope: EventScope, out: SimEvent[], misfortune = false): void {
  const prev = severityOn;
  severityOn = misfortune;
  try {
    applyEffectInner(world, effect, scope, out);
  } finally {
    severityOn = prev;
  }
}

function applyEffectInner(world: WorldState, effect: Effect, scope: EventScope, out: SimEvent[]): void {
  switch (effect.kind) {
    case 'settlement_var': {
      const v = effect.variable as string;
      const scaled = SETTLEMENT_WORSE_UP.has(v) || SETTLEMENT_WORSE_DOWN.has(v);
      for (const s of resolveSettlements(world, effect.target, scope)) {
        const rec = s as unknown as Record<string, number>;
        const val = scaled ? severityScaled(world, effect.op, effect.value, SETTLEMENT_WORSE_UP.has(v), s.ownerFactionId === world.playerFactionId) : effect.value;
        rec[effect.variable] = applyOp(rec[effect.variable] ?? 0, effect.op, val);
        if (v === 'unrest' || v === 'loyalty' || v === 'publicOrder' || v === 'health') rec[effect.variable] = clamp01(rec[effect.variable] as number);
      }
      return;
    }
    case 'faction_var': {
      const f = resolveFaction(world, effect.target, scope);
      if (!f) return;
      const val = severityScaled(world, effect.op, effect.value, false, f.id === world.playerFactionId);
      f[effect.variable] = applyOp(f[effect.variable], effect.op, val);
      if (effect.variable === 'legitimacy' || effect.variable === 'stability') f[effect.variable] = clamp01(f[effect.variable]);
      return;
    }
    case 'character_var': {
      const c = resolveCharacter(world, effect.target, scope);
      if (!c) return;
      const val = CHARACTER_WORSE_DOWN.has(effect.variable) ? severityScaled(world, effect.op, effect.value, false, c.factionId === world.playerFactionId) : effect.value;
      c[effect.variable] = applyOp(c[effect.variable], effect.op, val);
      if (effect.variable === 'loyalty' || effect.variable === 'ambition' || effect.variable === 'health' || effect.variable === 'claim') c[effect.variable] = clamp01(c[effect.variable]);
      if (effect.variable === 'health' && c.health <= 0 && c.alive) handleDeath(world, c.id, out);
      return;
    }
    case 'set_flag':
      world.events.flags[effect.flag] = effect.value;
      // Policy flags act on the scope's realm (DESIGN_SPEC §7.3.5 item 5): 'Ration the realm's grain' / 'Ration the
      // clans' start the same 120-day rationing rule as set_policy rationing on.
      if (effect.flag === RATIONING_FLAG && scope.factionId) setRationing(world, scope.factionId, !!effect.value);
      return;
    case 'clear_flag':
      delete world.events.flags[effect.flag];
      if (effect.flag === RATIONING_FLAG && scope.factionId) setRationing(world, scope.factionId, false);
      return;
    case 'trigger_event':
      world.events.scheduled.push({ eventId: effect.eventId, day: totalDays(world.calendar) + effect.delayDays, scope: { ...scope } });
      return;
    case 'opinion': {
      const a = resolveFaction(world, effect.a, scope);
      const b = resolveFaction(world, effect.b, scope);
      if (!a || !b || a.id === b.id) return;
      const rel = Object.values(world.diplomacy.relations).find((r) => (r.a === a.id && r.b === b.id) || (r.a === b.id && r.b === a.id));
      if (rel) rel.opinion = Math.max(-100, Math.min(100, rel.opinion + effect.delta));
      return;
    }
    case 'sign_treaty': {
      const a = resolveFaction(world, effect.a, scope);
      const b = resolveFaction(world, effect.b, scope);
      if (a && b && a.id !== b.id) createTreaty(world, effect.type, a.id, b.id, emptyTerms(), out);
      return;
    }
    case 'declare_war': {
      const a = resolveFaction(world, effect.a, scope);
      const b = resolveFaction(world, effect.b, scope);
      if (a && b && a.id !== b.id) declareWar(world, a.id, b.id, out);
      return;
    }
    case 'set_rebellion_stage':
      // Unrest rises to the stage's threshold so the ladder holds it; 'secession' secedes at once (politics.ts).
      for (const s of resolveSettlements(world, effect.target, scope)) forceRebellionStage(world, s, effect.stage, out);
      return;
    case 'kill_character': {
      const c = resolveCharacter(world, effect.target, scope);
      if (c && c.alive) handleDeath(world, c.id, out); // offices, heirs, succession (dynasty.ts)
      return;
    }
    case 'objective':
      world.victory.objectives[effect.objectiveId] = effect.status;
      out.push({ kind: 'objective_updated', objectiveId: effect.objectiveId, status: effect.status });
      return;
    case 'chronicle':
      addChronicle(world, scope.factionId, effect.text, 1);
      return;
    case 'transfer_settlement': {
      const targets = resolveSettlements(world, effect.settlement, scope);
      const to = resolveFaction(world, effect.to, scope);
      for (const s of targets) {
        if (!to || s.ownerFactionId === to.id) continue;
        const from = s.ownerFactionId;
        transferOwnership(world, s, to.id, out);
        out.push({ kind: 'settlement_captured', settlementId: s.id, from, to: to.id });
      }
      return;
    }
    case 'spawn_army': {
      const f = resolveFaction(world, effect.faction, scope);
      if (!f || !f.alive) return;
      const near = effect.nearSettlement ? world.settlements[effect.nearSettlement] : null;
      const x = effect.x ?? (near ? near.x + near.radius + 150 : null);
      const z = effect.z ?? (near ? near.z : null);
      if (x === null || z === null) return;
      const id = nextWorldId(world, 'army');
      const a = makeArmy(world, id, effect.name, f.id, x, z, effect.units, null);
      world.armies[id] = a;
      notifyPlayer(world, out, null, f.isPlayer ? 'info' : 'warning', `${effect.name} has taken the field.`, { x, z });
      return;
    }
    case 'damage_road': {
      const ids: string[] = [];
      if (effect.edgeId) ids.push(effect.edgeId);
      else if (effect.nearSettlement) ids.push(...(world.roads.adjacency[`node_${effect.nearSettlement}`] ?? []));
      const amount = severityScaled(world, 'add', -Math.abs(effect.amount), false, !!effect.nearSettlement && world.settlements[effect.nearSettlement]?.ownerFactionId === world.playerFactionId);
      for (const id of ids) {
        const e = world.roads.edges[id];
        if (e) e.condition = Math.max(0, e.condition + amount);
      }
      return;
    }
    default:
      return;
  }
}

function fireEvent(world: WorldState, def: EventDef, scope: EventScope, out: SimEvent[]): EventInstance {
  const s = scope.settlementId ? world.settlements[scope.settlementId] : null;
  const f = world.factions[scope.factionId];
  const ruler = f?.rulerId ? world.characters[f.rulerId] : null;
  const inst: EventInstance = {
    id: nextWorldId(world, 'evt'),
    defId: def.id,
    day: totalDays(world.calendar),
    scope,
    status: 'pending',
    choiceId: null,
    resolvedDay: null,
    params: {
      settlement: s?.name ?? '',
      province: s ? (world.provinces[s.provinceId]?.name ?? '') : '',
      faction: f?.name ?? '',
      ruler: ruler?.name ?? 'the ruler',
      character: scope.characterId ? (world.characters[scope.characterId]?.name ?? '') : '',
    },
  };
  world.events.pending.push(inst);
  if (def.once) world.events.firedOnce.push(def.id);
  if (def.cooldownDays > 0) world.events.cooldowns[def.id] = inst.day + def.cooldownDays;
  out.push({ kind: 'event_fired', instanceId: inst.id, factionId: scope.factionId });
  // AI factions resolve immediately.
  if (!f?.isPlayer) {
    const choice = chooseByWeight(world, def);
    resolveEventChoice(world, inst.id, choice, out);
  }
  return inst;
}

function chooseByWeight(world: WorldState, def: EventDef): string {
  if (def.choices.length === 0) return '';
  const idx = withWorldRng(world, (rng) => rng.weightedIndex(def.choices.map((c) => c.aiWeight)));
  return def.choices[idx]?.id ?? def.choices[0]!.id;
}

/** Daily: scheduled events, triggered events, auto-resolution of ignored player events. */
export function evaluateEventsDaily(world: WorldState, out: SimEvent[]): void {
  const day = totalDays(world.calendar);
  const scenario = world.scenarioId ? SCENARIOS[world.scenarioId] : null;
  // Scheduled (consequence chains, scripted).
  const due = world.events.scheduled.filter((s) => s.day <= day);
  world.events.scheduled = world.events.scheduled.filter((s) => s.day > day);
  for (const s of due) {
    const def = getEventDef(s.eventId);
    if (!def || (def.once && world.events.firedOnce.includes(def.id))) continue;
    fireEvent(world, def, s.scope, out);
  }
  // Triggered.
  for (const fid of stableKeys('factions', world.factions as Record<string, unknown>)) {
    const f = world.factions[fid]!;
    if (!f.alive) continue;
    for (const def of EVENTS) {
      if (def.playerOnly && !f.isPlayer) continue;
      if (def.chapter !== null && scenario && scenario.chapter !== def.chapter) continue;
      if (def.once && world.events.firedOnce.includes(def.id)) continue;
      if ((world.events.cooldowns[def.id] ?? -1) > day) continue;
      if (world.events.pending.some((p) => p.defId === def.id && p.scope.factionId === fid)) continue;
      if (def.trigger.kind === 'flag_set' && def.trigger.flag === '__never__') continue;
      const scope: EventScope = { factionId: fid, settlementId: f.capitalSettlementId, provinceId: null, characterId: null, armyId: null };
      const matched = { settlementId: null as string | null };
      if (!evalCondition(world, def.trigger, scope, matched)) continue;
      if (matched.settlementId) scope.settlementId = matched.settlementId;
      const fire = def.meanDays <= 0 || withWorldRng(world, (rng) => rng.chance(1 / def.meanDays));
      if (fire) fireEvent(world, def, scope, out);
    }
  }
  // Auto-resolve ignored player events.
  for (const inst of world.events.pending.slice()) {
    const def = getEventDef(inst.defId);
    if (!def || def.autoResolveDays === null) continue;
    if (day - inst.day >= def.autoResolveDays && def.choices[0]) resolveEventChoice(world, inst.id, def.choices[0].id, out);
  }
}

/** Apply the chosen option of a pending event. */
export function resolveEventChoice(world: WorldState, instanceId: string, choiceId: string, out: SimEvent[]): boolean {
  const idx = world.events.pending.findIndex((p) => p.id === instanceId);
  if (idx < 0) return false;
  const inst = world.events.pending[idx]!;
  const def = getEventDef(inst.defId);
  const choice = def?.choices.find((c) => c.id === choiceId);
  if (!def || !choice) return false;
  if (choice.requires && !evalCondition(world, choice.requires, inst.scope)) return false;
  for (const e of choice.effects) applyEffect(world, e, inst.scope, out, def.category === 'disaster');
  noteEventChoice(world, inst.scope.factionId, def.choices, choiceId, out);
  addStat(world, inst.scope.factionId, 'events_resolved', 1);
  inst.status = 'resolved';
  inst.choiceId = choiceId;
  inst.resolvedDay = totalDays(world.calendar);
  world.events.pending.splice(idx, 1);
  world.events.history.push(inst);
  if (world.events.history.length > EVENT_HISTORY_LIMIT) world.events.history.splice(0, world.events.history.length - EVENT_HISTORY_LIMIT);
  return true;
}

/** One choice of an event instance with its {placeholders} substituted. */
export interface FormattedEventChoice {
  id: string;
  label: string;
  description: string;
}

/** Event text with {placeholders} substituted: title, body and every choice's label + description. */
export function formatEventText(world: WorldState, inst: EventInstance): { title: string; body: string; choices: FormattedEventChoice[] } {
  const def = getEventDef(inst.defId);
  if (!def) return { title: inst.defId, body: '', choices: [] };
  const fill = (text: string): string => text.replace(/\{(\w+)\}/g, (_m, k: string) => String(inst.params[k] ?? ''));
  void world;
  return {
    title: fill(def.title),
    body: fill(def.body),
    choices: def.choices.map((c) => ({ id: c.id, label: fill(c.label), description: fill(c.description) })),
  };
}

/** Daily objective + outcome evaluation for campaign scenarios. */
export function checkObjectives(world: WorldState, out: SimEvent[]): void {
  const scenario = world.scenarioId ? SCENARIOS[world.scenarioId] : null;
  if (!scenario || world.victory.status !== 'ongoing') return;
  const scope: EventScope = { factionId: world.playerFactionId, settlementId: null, provinceId: null, characterId: null, armyId: null };
  for (const o of scenario.objectives) {
    if (world.victory.objectives[o.id] !== 'pending') continue;
    if (o.failCondition && evalCondition(world, o.failCondition, scope)) {
      world.victory.objectives[o.id] = 'failed';
      out.push({ kind: 'objective_updated', objectiveId: o.id, status: 'failed' });
    } else if (evalCondition(world, o.condition, scope)) {
      world.victory.objectives[o.id] = 'complete';
      for (const e of o.reward) applyEffect(world, e, scope, out);
      out.push({ kind: 'objective_updated', objectiveId: o.id, status: 'complete' });
    }
  }
  const day = totalDays(world.calendar);
  const timeUp = scenario.timeLimitDays !== null && day >= scenario.timeLimitDays;
  const outcomes = scenario.outcomes.slice().sort((a, b) => b.priority - a.priority);
  for (const oc of outcomes) {
    // Defeats always end at once; victories marked `immediate` too (§9.6); everything else at the time limit.
    const eligible = oc.kind === 'defeat' || oc.immediate === true || timeUp;
    if (eligible && evalCondition(world, oc.condition, scope)) {
      world.victory.status = oc.kind === 'defeat' ? 'defeat' : oc.kind === 'victory' ? 'victory' : 'ended';
      world.victory.outcomeId = oc.id;
      world.victory.endedDay = day;
      addChronicle(world, world.playerFactionId, `${oc.title}. ${oc.epilogue}`, 2);
      out.push({ kind: 'scenario_ended', outcomeId: oc.id, result: oc.kind });
      return;
    }
  }
}

// Landmark onComplete effects run through the event DSL (registered here to avoid an import cycle).
registerEffectRunner((world, effects, scope, out) => {
  for (const e of effects) applyEffect(world, e, scope, out);
});
