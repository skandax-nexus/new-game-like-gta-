/**
 * QA / evidence hooks of the in-game UI: `window.__SAMRAJYA_UI__` (screen patches, bus events, input actions, HUD
 * command log, layout probes, UI + input CPU counters). Started by the UIManager like every discovered UI service.
 * OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02). Used by scripts/shots/ui-02.cjs.
 * Nothing here runs per frame; it only answers calls from automation.
 */
import type { AppContext, ScreenId } from '../../app/contracts';
import { isScreenId } from '../../app/contracts';
import type { InputAction, KeyPreset } from '../../core/types';
import type { UiService } from '../screens/registry';
import type { UIManager } from '../ui';
import type { GroundQuad, HudCommandKind, WorldControlGroup } from './hudCommands';

export interface UiDebugApi {
  /** Sticky props patch merged into every push of a screen (null removes it). */
  patch(id: string, patch: Record<string, unknown> | null): void;
  /** Emit any bus event (e.g. 'ui:world_select', 'world:alert'). */
  emit(type: string, payload: unknown): void;
  /** Inject an input action as if a key / touch fired it. */
  action(name: string, extra?: Record<string, unknown>): void;
  press(name: string): void;
  release(name: string): void;
  /** Key preset override (null = settings). */
  setPreset(preset: KeyPreset | null): void;
  preset(): KeyPreset;
  setScale(scale: number): void;
  layout(): string;
  visible(id: string): boolean;
  props(id: string): unknown;
  /** Last HUD -> scene commands (newest last). */
  commands(): { kind: string; payload: unknown }[];
  /** Feed the minimap camera frustum / world control groups (normally the scenes do). */
  setCamera(quad: GroundQuad | null, heading: number): void;
  setWorldGroups(groups: WorldControlGroup[]): void;
  /** UI + input CPU counters (ms per frame, EMA) from the profiler. */
  profile(): { ui: number; input: number; total: number; max: number };
}

declare global {
  interface Window {
    __SAMRAJYA_UI__?: UiDebugApi;
  }
}

const COMMAND_KINDS: readonly HudCommandKind[] = ['place_building', 'place_landmark', 'placement', 'army_target', 'rally_point_target', 'battle_target', 'minimap_move'];

function start(ctx: AppContext, ui: UIManager): () => void {
  if (typeof window === 'undefined') return () => {};
  const log: { kind: string; payload: unknown }[] = [];
  const offs = COMMAND_KINDS.map((k) =>
    ui.commands.on(k, (payload: unknown) => {
      log.push({ kind: k, payload });
      if (log.length > 40) log.shift();
    }),
  );
  const screen = (id: string): ScreenId => {
    if (!isScreenId(id)) throw new Error(`Unknown screen id '${id}'`);
    return id;
  };
  const counter = (name: string): number => ctx.profiler.snapshot().counters[name] ?? 0;
  const api: UiDebugApi = {
    patch: (id, patch) => ui.debugPatch(screen(id), patch),
    emit: (type, payload) => (ctx.bus.emit as (t: string, p: unknown) => void)(type, payload),
    action: (name, extra = {}) => ctx.input.injectAction(name as InputAction, extra),
    press: (name) => ctx.input.pressAction(name as InputAction),
    release: (name) => ctx.input.releaseAction(name as InputAction),
    setPreset: (preset) => ctx.input.setPresetOverride(preset),
    preset: () => ctx.input.preset,
    setScale: (s) => ui.setScale(s),
    layout: () => ui.layout,
    visible: (id) => isScreenId(id) && ui.isVisible(id),
    props: (id) => (isScreenId(id) ? ui.propsOf(id) : undefined),
    commands: () => log.slice(),
    setCamera: (quad, heading) => ui.feeds.setCamera(quad, heading),
    setWorldGroups: (groups) => ui.feeds.setWorldGroups(groups),
    profile: () => ({ ui: counter('ui.ms'), input: counter('input.ms'), total: counter('uiInput.ms'), max: counter('uiInput.maxMs') }),
  };
  window.__SAMRAJYA_UI__ = api;
  return () => {
    for (const off of offs) off();
    if (window.__SAMRAJYA_UI__ === api) delete window.__SAMRAJYA_UI__;
  };
}

export const SERVICES: UiService[] = [{ id: 'ui-debug', start }];
