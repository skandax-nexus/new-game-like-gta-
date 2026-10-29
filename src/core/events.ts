/**
 * Typed event bus + the app-wide event map. OWNER: CTO (Contracts v2 events/SFX added by CORE-01).
 * Three-free, DOM-free.
 *
 * - Sim code does NOT use the bus (it writes `SimEvent[]` / `BattleEventRecord[]` into out-arrays).
 *   Scenes forward those batches to the bus for UI/audio.
 * - Handlers run synchronously in subscription order. A throwing handler is reported through
 *   `onHandlerError` and does not stop other handlers.
 * - Subscription lists are copy-on-write, so emit() allocates nothing.
 */
import type {
  BattleEventRecord,
  BattleOutcome,
  CalendarState,
  FormationIndex,
  GameMode,
  GameSettings,
  InputActionEvent,
  QualitySettings,
  SceneId,
  SimEvent,
} from './types';

export type Handler<T> = (payload: T) => void;
export type Unsubscribe = () => void;

export class EventBus<M extends object> {
  private handlers: { [K in keyof M]?: Handler<M[K]>[] } = {};
  /** Called when a handler throws (wired to the crash reporter by main.ts). */
  onHandlerError: ((err: unknown, type: string) => void) | null = null;

  on<K extends keyof M>(type: K, fn: Handler<M[K]>): Unsubscribe {
    const list = this.handlers[type];
    this.handlers[type] = list ? [...list, fn] : [fn];
    return () => this.off(type, fn);
  }

  once<K extends keyof M>(type: K, fn: Handler<M[K]>): Unsubscribe {
    const wrapped: Handler<M[K]> = (p) => {
      off();
      fn(p);
    };
    const off = this.on(type, wrapped);
    return off;
  }

  off<K extends keyof M>(type: K, fn: Handler<M[K]>): void {
    const list = this.handlers[type];
    if (!list) return;
    const idx = list.indexOf(fn);
    if (idx < 0) return;
    const next = list.slice();
    next.splice(idx, 1);
    this.handlers[type] = next;
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const list = this.handlers[type];
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      try {
        (list[i] as Handler<M[K]>)(payload);
      } catch (err) {
        if (this.onHandlerError) this.onHandlerError(err, String(type));
        else throw err;
      }
    }
  }

  listenerCount<K extends keyof M>(type: K): number {
    return this.handlers[type]?.length ?? 0;
  }

  /** A scope collects subscriptions so a scene/screen can drop them all at once. */
  scope(): BusScope<M> {
    return new BusScope(this);
  }

  clear(): void {
    this.handlers = {};
  }
}

export class BusScope<M extends object> {
  private offs: Unsubscribe[] = [];
  constructor(private readonly bus: EventBus<M>) {}

  on<K extends keyof M>(type: K, fn: Handler<M[K]>): Unsubscribe {
    const off = this.bus.on(type, fn);
    this.offs.push(off);
    return off;
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    this.bus.emit(type, payload);
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs = [];
  }
}

/** Procedural sound effects (audio module synthesizes these; anyone may request via 'audio:sfx'). */
export const SFX_KINDS = [
  'ui_click',
  'ui_hover',
  'ui_open',
  'ui_close',
  'ui_confirm',
  'ui_error',
  'notify',
  'order_ack',
  'march',
  'charge_horn',
  'conch',
  'drum_hit',
  'arrow_volley',
  'arrow_impact',
  'clash',
  'elephant_trumpet',
  'horse_neigh',
  'cheer',
  'rout_cry',
  'build',
  'coins',
  'harvest',
  'thunder',
  'bell',
  // --- Contracts v2 (AUD-01 synthesizes them; DESIGN_SPEC §11.7 melee, §8 AoE feedback, §6.6.5 sieges) ---
  // melee (hero:combat drives most of these)
  'sword_light',
  'sword_heavy',
  'parry_ring',
  'block_thud',
  'roll_cloth',
  'body_hit',
  'stagger_grunt',
  'salve',
  // world, construction, sieges, surfaces
  'bell_temple',
  'construction_complete',
  'landmark_complete',
  'age_up_fanfare',
  'market_coins',
  'gate_break',
  'wall_crumble',
  'ram_hit',
  'fire_crackle',
  'river_splash',
  'footstep_stone',
  'footstep_dirt',
] as const;
export type SfxKind = (typeof SFX_KINDS)[number];

/** Music moods for 'audio:mood' (v2 adds hero exploration, hero combat, the duel and sieges). */
export const AUDIO_MOODS = ['menu', 'world', 'battle', 'city', 'victory', 'defeat', 'hero_explore', 'hero_combat', 'duel', 'siege'] as const;
export type AudioMood = (typeof AUDIO_MOODS)[number];

/** One-shot musical stingers for 'audio:stinger' (DESIGN_SPEC §8.4 fanfare, §8.2 chime, §11.6 duel bells). */
export const AUDIO_STINGERS = [
  'age_up',
  'landmark_complete',
  'construction_complete',
  'harvest',
  'battle_start',
  'duel_phase',
  'mission_success',
  'mission_failure',
  'victory',
  'defeat',
] as const;
export type AudioStinger = (typeof AUDIO_STINGERS)[number];

/** Hero melee feedback kinds for 'hero:combat' (audio, camera shake, hit-stop VFX). */
export type HeroCombatKind = 'hit' | 'parry' | 'perfect_dodge' | 'guard_break' | 'stagger' | 'finisher';

/** Minimap / map ping kinds for 'world:alert' (red attack/siege/revolt, amber shortage/supply, gold good news). */
export type WorldAlertKind =
  | 'attack'
  | 'siege'
  | 'revolt'
  | 'army_sighted'
  | 'shortage'
  | 'supply_low'
  | 'construction'
  | 'landmark'
  | 'age'
  | 'treaty'
  | 'event';
export type WorldAlertSeverity = 'danger' | 'warning' | 'success';

export type NotifySeverity = 'info' | 'warning' | 'danger' | 'success';

/** App-wide events. Add new events here via a CTO contract request. */
export interface GameEventMap {
  'app:ready': { version: string };
  'scene:loading': { scene: SceneId; progress: number; label: string };
  /** Content-pipeline downloads (src/assets/AssetManager.ts): items, bytes, 0..1 progress. */
  'assets:progress': { loaded: number; total: number; bytesLoaded: number; bytesTotal: number; progress: number; label: string };
  'scene:entered': { scene: SceneId };
  /** Scene has rendered its first stable frames (screenshot tests wait for this). */
  'scene:ready': { scene: SceneId };
  'scene:exited': { scene: SceneId };
  'loop:speed': { timeScale: number; paused: boolean };
  /** Once at boot (main.ts, initial tier, before any scene enters), then on every tier change. */
  'quality:changed': { settings: QualitySettings };
  'settings:changed': { settings: GameSettings };
  'input:action': InputActionEvent;
  /** Batch of strategic sim events produced since the last frame. */
  'sim:events': { events: readonly SimEvent[] };
  'world:tick': { calendar: CalendarState };
  'world:selection': { kind: 'army' | 'settlement' | 'province' | 'none'; id: string | null };
  'battle:events': { events: readonly BattleEventRecord[] };
  'battle:selection': { formations: readonly FormationIndex[] };
  'battle:ended': { outcome: BattleOutcome };
  'session:mode': { mode: GameMode | null };
  'save:written': { slot: string };
  'save:loaded': { slot: string };
  'ui:notify': { text: string; severity: NotifySeverity };
  /** UI asks the battle scene to change selection (formation cards, control groups). */
  'ui:select_formations': { formations: readonly FormationIndex[]; additive: boolean };
  /** UI asks the world scene to select an entity (list click, notification). */
  'ui:world_select': { kind: 'army' | 'settlement' | 'province' | 'none'; id: string | null };
  /** UI asks the active scene to move its camera to a ground point. */
  'ui:camera_focus': { x: number; z: number; distance: number | null };
  /** Toggle a map overlay (supply lines, terrain classes, borders). */
  'ui:overlay': { overlay: 'supply' | 'terrain' | 'borders'; visible: boolean };
  /** One-shot sound. v2: `position` (world m) makes it spatial (PannerNode); `pan` is ignored when set. */
  'audio:sfx': { sfx: SfxKind; volume?: number; pan?: number; position?: { x: number; y: number; z: number } };
  /** Ambience intensity hints for the audio director. */
  'audio:mood': { mood: AudioMood; intensity: number };
  error: { message: string; fatal: boolean };
  // --- Contracts v2 (Sprint 1; docs/ARCHITECTURE.md "Contracts v2") ---
  /** A tutorial trigger key fired (DESIGN_SPEC §12.4, e.g. 'world.build_mode'); the hints service decides. */
  'ui:hint': { key: string };
  /** A hero mission ended (after completeHeroMission / accept failure; not on abandon). */
  'hero:mission_end': { missionId: string; success: boolean };
  /** Hero melee feedback at a world position; strength 0..1 (audio, shake, VFX). */
  'hero:combat': { kind: HeroCombatKind; x: number; y: number; z: number; strength: number };
  /** Map / minimap alert ping (expanding ring: danger red, warning amber, success gold). */
  'world:alert': { kind: WorldAlertKind; x: number; z: number; severity: WorldAlertSeverity };
  /** Camera shake request (amplitude m, damped noise); ignored under settings.reducedMotion. */
  'camera:shake': { amplitude: number; durationSec: number };
  /** Audio listener pose (world position + forward), from the active camera, ~10 Hz. */
  'audio:listener': { x: number; y: number; z: number; fx: number; fy: number; fz: number };
  /** Ambience layer mix (HeroDistrictDef.ambience keys, world beds); layers not listed fade out. */
  'audio:ambience': { layers: readonly { key: string; gain: number }[] };
  /** One-shot musical stinger over the score. */
  'audio:stinger': { stinger: AudioStinger };
}

export type GameBus = EventBus<GameEventMap>;

export function createGameBus(): GameBus {
  return new EventBus<GameEventMap>();
}
