/**
 * Test helpers for the strategic simulation suites (SIM-01). OWNER: Simulation Engineer - Strategic World Simulation.
 * Deterministic world runners: tick N days, auto-resolve the player's events (first choice = the safe default) and
 * engagements (autoresolve) and issue commands.
 */
import type { IssuedStrategicCommand, SandboxSetup, SimEvent, StrategicCommand, WorldState } from '../../../src/core/types';
import { createWorld, getRegionHeightfield, tickWorld } from '../../../src/sim/strategic/world';
import { defaultSandbox } from '../../../src/data/campaign';
import { getEventDef } from '../../../src/data/events';

export function campaign(seed = 1, scenarioId = 'broken_crown', difficulty: WorldState['difficulty'] = 'normal'): WorldState {
  return createWorld({ kind: 'scenario', scenarioId, seed, difficulty });
}

export function sandbox(seed = 1, patch: Partial<SandboxSetup> = {}): WorldState {
  return createWorld({ kind: 'sandbox', sandbox: { ...defaultSandbox(seed), ...patch } });
}

export interface RunOptions {
  /** Resolve the player's pending events with their first (safe default) choice. Default true. */
  autoEvents?: boolean;
  /** Autoresolve engagements waiting for the player. Default true. */
  autoEngagements?: boolean;
  /** Called after every hour with that hour's events. */
  onHour?: (events: readonly SimEvent[]) => void;
  /** Stop early when this returns true (checked every hour). */
  until?: (w: WorldState) => boolean;
}

/** Run the world for `hours` game hours. Returns all SimEvents produced (flattened). */
export function runHours(world: WorldState, hours: number, opts: RunOptions = {}): SimEvent[] {
  const hf = getRegionHeightfield(world);
  const out: SimEvent[] = [];
  const all: SimEvent[] = [];
  for (let h = 0; h < hours; h++) {
    if (world.victory.status !== 'ongoing') break;
    out.length = 0;
    tickWorld(world, [], out, hf);
    if (opts.autoEvents !== false) {
      for (const inst of world.events.pending.slice()) {
        if (inst.scope.factionId !== world.playerFactionId) continue;
        const def = getEventDef(inst.defId);
        if (!def || !def.choices[0]) continue;
        tickWorld(world, [cmd(world, { kind: 'event_choice', eventInstanceId: inst.id, choiceId: def.choices[0].id })], out, hf);
      }
    }
    if (opts.autoEngagements !== false) {
      for (const eng of Object.values(world.engagements)) {
        if (eng.status === 'pending_player') tickWorld(world, [cmd(world, { kind: 'engagement_decision', engagementId: eng.id, decision: 'autoresolve' })], out, hf);
      }
    }
    opts.onHour?.(out);
    for (const e of out) all.push(e);
    if (opts.until?.(world)) break;
  }
  return all;
}

export function runDays(world: WorldState, days: number, opts: RunOptions = {}): SimEvent[] {
  return runHours(world, days * 24, opts);
}

/** Wrap a command as issued by the player (or `factionId`). */
export function cmd(world: WorldState, c: StrategicCommand, factionId = world.playerFactionId): IssuedStrategicCommand {
  return { factionId, hour: world.calendar.totalHours, cmd: c };
}

/** Apply one command through a tick (advances one hour). Returns that hour's events. */
export function issue(world: WorldState, c: StrategicCommand, factionId = world.playerFactionId): SimEvent[] {
  const out: SimEvent[] = [];
  tickWorld(world, [cmd(world, c, factionId)], out, getRegionHeightfield(world));
  return out;
}

/** Advance whole hours until the next day rollover (calendar.hour === 0). */
export function toNextDay(world: WorldState): void {
  const hours = (24 - world.calendar.hour) % 24 || 24;
  runHours(world, hours, { autoEvents: false, autoEngagements: false });
}

/** Remove armies, scheduled scenario events and pending events (economy-only harnesses). */
export function quiet(world: WorldState): WorldState {
  world.armies = {};
  world.events.scheduled = [];
  world.events.pending = [];
  return world;
}
