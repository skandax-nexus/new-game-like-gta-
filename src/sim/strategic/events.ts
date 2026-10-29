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
import { nextWorldId, sortedKeys } from '../../core/ids';
import { EVENT_HISTORY_LIMIT } from '../../core/constants';
import { EVENTS, getEventDef } from '../../data/events';
import { SCENARIOS } from '../../data/campaign';
import { seasonOf, totalDays } from './seasons';
import { addChronicle, withWorldRng } from './state';
import { armySoldiers } from './armies';
import { createTreaty, declareWar, hasTreaty } from './diplomacy';
import { registerEffectRunner } from './construction';
import { forceRebellionStage } from './politics';
import { transferOwnership } from './siege';

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
      return sortedKeys(world.settlements)
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

/** Apply one effect. */
export function applyEffect(world: WorldState, effect: Effect, scope: EventScope, out: SimEvent[]): void {
  switch (effect.kind) {
    case 'settlement_var':
      for (const s of resolveSettlements(world, effect.target, scope)) {
        const rec = s as unknown as Record<string, number>;
        rec[effect.variable] = applyOp(rec[effect.variable] ?? 0, effect.op, effect.value);
      }
      return;
    case 'faction_var': {
      const f = resolveFaction(world, effect.target, scope);
      if (f) f[effect.variable] = applyOp(f[effect.variable], effect.op, effect.value);
      return;
    }
    case 'character_var': {
      const c = resolveCharacter(world, effect.target, scope);
      if (c) c[effect.variable] = applyOp(c[effect.variable], effect.op, effect.value);
      return;
    }
    case 'set_flag':
      world.events.flags[effect.flag] = effect.value;
      return;
    case 'clear_flag':
      delete world.events.flags[effect.flag];
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
      if (a && b && a.id !== b.id) createTreaty(world, effect.type, a.id, b.id);
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
      if (c && c.alive) {
        c.alive = false;
        c.deathYear = world.calendar.year;
        out.push({ kind: 'character_died', characterId: c.id });
      }
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
    case 'spawn_army':
    case 'damage_road':
      // TODO(Lead AI & Simulation): spawn rebel/relief armies; damage road edges (condition).
      return;
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
  for (const fid of sortedKeys(world.factions)) {
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
  for (const e of choice.effects) applyEffect(world, e, inst.scope, out);
  inst.status = 'resolved';
  inst.choiceId = choiceId;
  inst.resolvedDay = totalDays(world.calendar);
  world.events.pending.splice(idx, 1);
  world.events.history.push(inst);
  if (world.events.history.length > EVENT_HISTORY_LIMIT) world.events.history.splice(0, world.events.history.length - EVENT_HISTORY_LIMIT);
  return true;
}

/** Event text with {placeholders} substituted. */
export function formatEventText(world: WorldState, inst: EventInstance): { title: string; body: string } {
  const def = getEventDef(inst.defId);
  if (!def) return { title: inst.defId, body: '' };
  const body = def.body.replace(/\{(\w+)\}/g, (_m, k: string) => String(inst.params[k] ?? ''));
  void world;
  return { title: def.title, body };
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
    const hardDefeat = oc.kind === 'defeat' && evalCondition(world, oc.condition, scope);
    if (hardDefeat || (timeUp && evalCondition(world, oc.condition, scope))) {
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
