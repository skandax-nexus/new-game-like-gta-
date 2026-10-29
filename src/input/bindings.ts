/**
 * Default key bindings per input context (KeyboardEvent.code). OWNER: Lead UI/UX Engineer.
 * Users can override via GameSettings.keybindings (settings screen). Mouse/touch mapping lives in input.ts.
 */
import type { InputAction } from '../core/types';

/** 'lab' (CORE-01 compile-fix): feature labs (?scene=lab) use the global bindings only, like the menu. */
export type InputContext = 'menu' | 'world' | 'battle' | 'hero' | 'lab';

export type BindingMap = Partial<Record<InputAction, string[]>>;

const GLOBAL: BindingMap = {
  pause: ['Space'],
  speed_up: ['Equal', 'NumpadAdd', 'Period'],
  speed_down: ['Minus', 'NumpadSubtract', 'Comma'],
  speed_reset: ['Backspace'],
  menu: ['Escape'],
  quick_save: ['F5'],
  quick_load: ['F9'],
  toggle_profiler: ['F3', 'Backquote'],
  screenshot: ['F12'],
  camera_focus: ['Home'],
  camera_reset: ['End'],
  camera_toggle_cinematic: ['KeyV'],
};

const CONTEXT: Record<InputContext, BindingMap> = {
  menu: {},
  lab: {},
  world: {
    overlay_supply: ['KeyM'],
    overlay_terrain: ['KeyK'],
    overlay_borders: ['KeyL'],
  },
  battle: {
    select_all: ['KeyZ'],
    order_hold: ['KeyH'],
    order_advance: ['KeyT'],
    order_withdraw: ['KeyB'],
    order_regroup: ['KeyG'],
    order_flank: ['KeyY'],
    order_defend: ['KeyU'],
    order_attack: ['KeyX'],
    order_charge: ['KeyC'],
    order_run_toggle: ['KeyN'],
    shape_line: ['KeyJ'],
    shape_column: ['KeyI'],
    shape_square: ['KeyO'],
    shape_wedge: ['KeyP'],
  },
  hero: {
    hero_interact: ['KeyE', 'Enter'],
    hero_run: ['ShiftLeft', 'ShiftRight'],
    hero_exit: ['Escape'],
  },
};

/** Camera / movement keys (held, continuous). */
export const HELD_KEYS = {
  panUp: ['KeyW', 'ArrowUp'],
  panDown: ['KeyS', 'ArrowDown'],
  panLeft: ['KeyA', 'ArrowLeft'],
  panRight: ['KeyD', 'ArrowRight'],
  rotateLeft: ['KeyQ'],
  rotateRight: ['KeyE'],
  tiltUp: ['KeyR', 'PageUp'],
  tiltDown: ['KeyF', 'PageDown'],
  zoomIn: ['NumpadMultiply'],
  zoomOut: ['NumpadDivide'],
  run: ['ShiftLeft', 'ShiftRight'],
} as const;

/** Effective bindings for a context (global + context + user overrides). */
export function bindingsFor(ctx: InputContext, overrides: BindingMap = {}): BindingMap {
  const merged: BindingMap = { ...GLOBAL, ...CONTEXT[ctx] };
  if (ctx === 'hero') delete merged.menu;
  for (const [k, v] of Object.entries(overrides)) if (v) merged[k as InputAction] = v;
  return merged;
}
