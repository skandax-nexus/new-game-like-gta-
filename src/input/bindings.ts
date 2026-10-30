/**
 * Key bindings: Classic / Grid presets (DESIGN_SPEC §8.8, §11.8), key chords, the key resolver and the rebinding
 * API with conflict detection used by the settings screen (UI-01). OWNER: UI Engineer - In-game HUD, Command Card,
 * Minimap & Input (UI-02). Pure module (no DOM) so node tests run it.
 *
 * Chords are `KeyboardEvent.code` strings with optional modifiers in canonical order: 'KeyH', 'Shift+KeyG',
 * 'Ctrl+KeyA', 'Alt+KeyQ'. GameSettings.keybindings stores chords per action (user overrides on top of a preset).
 *
 * Layers, from bottom to top, resolved per key press:
 *   global (both presets) -> context (menu | world | battle | hero | lab) -> card page (Grid battle, intents page)
 *   -> mode overlay ('placement' | 'targeting'). An upper layer that binds a chord hides lower bindings of it.
 * Shift is a modifier for queueing (Shift+H = hold, queued): a chord without Shift also fires with Shift held when
 * nothing binds the Shift chord; the event then carries shift = true. Ctrl and Alt must match exactly.
 *
 * Command card slots (`card_slot_0..14`, row-major Q W E R T / A S D F G / Z X C V B):
 *   Grid    - world: the letters themselves; battle: the letters on every card page except the first (whose
 *             letters are the named orders and shapes of §8.8), so the intents page is played with the same keys.
 *   Classic - Alt + the grid letter (the letters are camera keys in Classic).
 * The command card UI resolves a slot event into its order / building / intent (ui/services/commandCards.ts).
 *
 * Control groups are not bindings: Digit1..9 / Digit0 select, Ctrl+digit assigns, Shift+digit adds, a double press
 * centres the camera (input.ts). In hero mode the digits are dialogue choices 1..5.
 */
import type { InputAction, KeyPreset } from '../core/types';
import { INPUT_ACTIONS } from '../core/types';

/** 'lab' (CORE-01 compile-fix): feature labs (?scene=lab) use the global bindings only, like the menu. */
export type InputContext = 'menu' | 'world' | 'battle' | 'hero' | 'lab';
/** Temporary overlays pushed by scenes: building placement (R rotates, Esc cancels) and order targeting (Esc). */
export type InputMode = 'placement' | 'targeting';

export const INPUT_CONTEXTS: readonly InputContext[] = ['menu', 'world', 'battle', 'hero', 'lab'];

/** action -> chords. */
export type BindingMap = Partial<Record<InputAction, string[]>>;

export interface Chord {
  code: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

/** Row-major command-card letters (§8.8). */
export const GRID_LETTERS: readonly string[] = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB'];
export const CARD_SLOT_ACTIONS: readonly InputAction[] = [
  'card_slot_0',
  'card_slot_1',
  'card_slot_2',
  'card_slot_3',
  'card_slot_4',
  'card_slot_5',
  'card_slot_6',
  'card_slot_7',
  'card_slot_8',
  'card_slot_9',
  'card_slot_10',
  'card_slot_11',
  'card_slot_12',
  'card_slot_13',
  'card_slot_14',
];

/** card_slot_N -> N (else -1). */
export function cardSlotIndex(action: InputAction): number {
  return CARD_SLOT_ACTIONS.indexOf(action);
}

// ---------------------------------------------------------------------------------------------------
// Chords
// ---------------------------------------------------------------------------------------------------

export function parseChord(s: string): Chord | null {
  const parts = s.split('+').filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  const c: Chord = { code: '', ctrl: false, shift: false, alt: false };
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (i < parts.length - 1) {
      if (p === 'Ctrl' || p === 'Control' || p === 'Meta' || p === 'Cmd') c.ctrl = true;
      else if (p === 'Shift') c.shift = true;
      else if (p === 'Alt' || p === 'Option') c.alt = true;
      else return null;
    } else c.code = p;
  }
  return c.code ? c : null;
}

export function chordString(c: Chord): string {
  return `${c.ctrl ? 'Ctrl+' : ''}${c.shift ? 'Shift+' : ''}${c.alt ? 'Alt+' : ''}${c.code}`;
}

/** Canonical form of a chord string ('Shift+Ctrl+KeyA' -> 'Ctrl+Shift+KeyA'); null if invalid. */
export function normalizeChord(s: string): string | null {
  const c = parseChord(s);
  return c ? chordString(c) : null;
}

const MODIFIER_CODES = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']);

/** Chord of a key event (Meta counts as Ctrl so Mac Cmd+1 assigns a group). Modifier keys alone keep no modifier flag. */
export function chordFromEvent(e: { code: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): Chord {
  if (MODIFIER_CODES.has(e.code)) return { code: e.code, ctrl: false, shift: false, alt: false };
  return { code: e.code, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey };
}

const CODE_LABELS: Readonly<Record<string, string>> = {
  Space: 'Space',
  Escape: 'Esc',
  Backspace: 'Bksp',
  Enter: 'Enter',
  Tab: 'Tab',
  Period: '.',
  Comma: ',',
  Minus: '-',
  Equal: '+',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /',
  BracketLeft: '[',
  BracketRight: ']',
  Backquote: '`',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Home: 'Home',
  End: 'End',
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift',
  ControlLeft: 'Ctrl',
  AltLeft: 'Alt',
  Mouse0: 'LMB',
  Mouse1: 'MMB',
  Mouse2: 'RMB',
};

/** Short label of a key code ('KeyQ' -> 'Q', 'Digit1' -> '1', 'Period' -> '.'). */
export function codeLabel(code: string): string {
  if (CODE_LABELS[code]) return CODE_LABELS[code]!;
  const m = /^(?:Key|Digit|Numpad)(.+)$/.exec(code);
  if (m) return m[1]!;
  return code;
}

/** Display label of a chord ('Ctrl+KeyA' -> 'Ctrl+A', 'Shift+KeyG' -> 'Shift+G'). */
export function chordLabel(s: string): string {
  const c = parseChord(s);
  if (!c) return s;
  return `${c.ctrl ? 'Ctrl+' : ''}${c.shift ? 'Shift+' : ''}${c.alt ? 'Alt+' : ''}${codeLabel(c.code)}`;
}

// ---------------------------------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------------------------------

export interface PresetDef {
  id: KeyPreset;
  name: string;
  description: string;
  global: BindingMap;
  contexts: Record<InputContext, BindingMap>;
  /** Grid battle: bindings of card pages > 0 (the letters become card slots). */
  battleSlotPages: BindingMap;
  modes: Record<InputMode, BindingMap>;
  held: HeldKeyMap;
}

/** Continuous (held) keys: camera pan/rotate/tilt/zoom and hero movement. */
export interface HeldKeyMap {
  panUp: readonly string[];
  panDown: readonly string[];
  panLeft: readonly string[];
  panRight: readonly string[];
  rotateLeft: readonly string[];
  rotateRight: readonly string[];
  tiltUp: readonly string[];
  tiltDown: readonly string[];
  zoomIn: readonly string[];
  zoomOut: readonly string[];
  run: readonly string[];
  /** Hero movement (WASD + arrows in both presets). */
  moveUp: readonly string[];
  moveDown: readonly string[];
  moveLeft: readonly string[];
  moveRight: readonly string[];
}

const slotsOn = (codes: readonly string[], prefix = ''): BindingMap => {
  const m: BindingMap = {};
  CARD_SLOT_ACTIONS.forEach((a, i) => (m[a] = [`${prefix}${codes[i]!}`]));
  return m;
};

const GLOBAL_COMMON: BindingMap = {
  pause: ['Space'],
  speed_up: ['Equal', 'NumpadAdd'],
  speed_down: ['Minus', 'NumpadSubtract'],
  speed_reset: ['Backspace'],
  menu: ['Escape'],
  quick_save: ['F5'],
  quick_load: ['F9'],
  toggle_profiler: ['F3', 'Backquote'],
  screenshot: ['F12'],
  camera_reset: ['End'],
};

const HERO: BindingMap = {
  hero_interact: ['KeyE', 'Enter'],
  hero_run: ['ShiftLeft', 'ShiftRight'],
  hero_exit: ['Escape'],
  hero_roll: ['Space'],
  hero_guard: ['KeyQ'],
  hero_salve: ['KeyR'],
  hero_lock_on: ['Tab', 'Mouse1'],
  hero_attack_light: ['Mouse0'],
  hero_attack_heavy: ['Mouse2'],
  dialogue_choice_1: ['Digit1', 'Numpad1'],
  dialogue_choice_2: ['Digit2', 'Numpad2'],
  dialogue_choice_3: ['Digit3', 'Numpad3'],
  dialogue_choice_4: ['Digit4', 'Numpad4'],
  dialogue_choice_5: ['Digit5', 'Numpad5'],
  camera_toggle_cinematic: ['KeyV'],
};

/** Actions the hero context removes from the global layer (Space rolls, Esc leaves; the world clock is frozen). */
export const HERO_SUPPRESSED: readonly InputAction[] = ['pause', 'menu', 'speed_up', 'speed_down', 'speed_reset'];

const MODES: Record<InputMode, BindingMap> = {
  placement: { placement_rotate: ['KeyR'], cancel: ['Escape'] },
  targeting: { cancel: ['Escape'] },
};

const HERO_HELD = { moveUp: ['KeyW', 'ArrowUp'], moveDown: ['KeyS', 'ArrowDown'], moveLeft: ['KeyA', 'ArrowLeft'], moveRight: ['KeyD', 'ArrowRight'] } as const;

export const PRESETS: Readonly<Record<KeyPreset, PresetDef>> = {
  classic: {
    id: 'classic',
    name: 'Classic',
    description: 'WASD camera and mnemonic letters (H hold, T advance, C charge). Command-card slots on Alt + Q..B.',
    global: { ...GLOBAL_COMMON, camera_focus: ['Home'] },
    contexts: {
      menu: {},
      lab: {},
      world: {
        overlay_supply: ['KeyM'],
        overlay_terrain: ['KeyK'],
        overlay_borders: ['KeyL'],
        select_capital: ['KeyH'],
        idle_builders_next: ['Period'],
        idle_army_next: ['Comma'],
        card_next_tab: ['Tab'],
        camera_toggle_cinematic: ['KeyV'],
        ...slotsOn(GRID_LETTERS, 'Alt+'),
      },
      battle: {
        select_all: ['KeyZ'],
        order_hold: ['KeyH'],
        order_advance: ['KeyT'],
        order_attack: ['KeyX'],
        order_charge: ['KeyC'],
        order_flank: ['KeyY'],
        order_defend: ['KeyU'],
        order_withdraw: ['KeyB'],
        order_regroup: ['KeyG'],
        order_run_toggle: ['KeyN'],
        order_stance: ['KeyM'],
        shape_line: ['KeyJ'],
        shape_column: ['KeyI'],
        shape_square: ['KeyO'],
        shape_wedge: ['KeyP'],
        shape_loose: ['KeyK'],
        shape_circle: ['Shift+KeyK'],
        commander_rally: ['KeyL'],
        camera_toggle_cinematic: ['KeyV'],
        idle_army_next: ['Comma'],
        card_next_tab: ['Tab'],
        ...slotsOn(GRID_LETTERS, 'Alt+'),
      },
      hero: HERO,
    },
    battleSlotPages: {},
    modes: MODES,
    held: {
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
      ...HERO_HELD,
    },
  },
  grid: {
    id: 'grid',
    name: 'Grid',
    description: 'Age of Empires IV style: the command card on Q W E R T / A S D F G / Z X C V B, camera on arrows, edges and drag, rotate on [ ].',
    global: { ...GLOBAL_COMMON },
    contexts: {
      menu: {},
      lab: {},
      world: {
        overlay_supply: ['F1'],
        overlay_terrain: ['F2'],
        overlay_borders: ['F4'],
        select_capital: ['KeyH'],
        idle_builders_next: ['Period'],
        idle_army_next: ['Comma'],
        card_next_tab: ['Tab'],
        camera_toggle_cinematic: ['Home'],
        ...slotsOn(GRID_LETTERS),
      },
      battle: {
        select_all: ['Ctrl+KeyA'],
        order_hold: ['KeyQ'],
        order_advance: ['KeyW'],
        order_attack: ['KeyE'],
        order_charge: ['KeyR'],
        order_flank: ['KeyT'],
        order_defend: ['KeyA'],
        order_withdraw: ['KeyS'],
        order_regroup: ['KeyD'],
        order_run_toggle: ['KeyF'],
        order_stance: ['KeyG'],
        shape_line: ['KeyZ'],
        shape_column: ['KeyX'],
        shape_square: ['KeyC'],
        shape_wedge: ['KeyV'],
        shape_loose: ['KeyB'],
        shape_circle: ['Shift+KeyB'],
        commander_rally: ['Shift+KeyG'],
        camera_toggle_cinematic: ['Home'],
        idle_army_next: ['Comma'],
        card_next_tab: ['Tab'],
      },
      hero: HERO,
    },
    battleSlotPages: slotsOn(GRID_LETTERS),
    modes: MODES,
    held: {
      panUp: ['ArrowUp'],
      panDown: ['ArrowDown'],
      panLeft: ['ArrowLeft'],
      panRight: ['ArrowRight'],
      rotateLeft: ['BracketLeft'],
      rotateRight: ['BracketRight'],
      tiltUp: ['PageUp'],
      tiltDown: ['PageDown'],
      zoomIn: ['NumpadMultiply'],
      zoomOut: ['NumpadDivide'],
      run: ['ShiftLeft', 'ShiftRight'],
      ...HERO_HELD,
    },
  },
};

/** Back-compat: the Classic held keys (camera / movement). */
export const HELD_KEYS: HeldKeyMap = PRESETS.classic.held;

// ---------------------------------------------------------------------------------------------------
// Effective bindings + resolver
// ---------------------------------------------------------------------------------------------------

/** Where a binding layer applies. `page` > 0 only for battle (card pages); `mode` null = no overlay. */
export interface BindingScope {
  context: InputContext;
  page?: number;
  mode?: InputMode | null;
}

function cloneMap(m: BindingMap): BindingMap {
  const out: BindingMap = {};
  for (const k of Object.keys(m) as InputAction[]) out[k] = [...(m[k] ?? [])];
  return out;
}

function applyOverrides(m: BindingMap, overrides: BindingMap | undefined): void {
  if (!overrides) return;
  for (const k of Object.keys(overrides) as InputAction[]) {
    const v = overrides[k];
    if (!v || !(k in m)) continue;
    m[k] = v.map((c) => normalizeChord(c) ?? c);
  }
}

/** The layers of a scope, bottom first, with user overrides applied per layer. */
export function bindingLayers(preset: KeyPreset, scope: BindingScope, overrides?: BindingMap): BindingMap[] {
  const p = PRESETS[preset] ?? PRESETS.classic;
  const g = cloneMap(p.global);
  if (scope.context === 'hero') for (const a of HERO_SUPPRESSED) delete g[a];
  const layers: BindingMap[] = [g, cloneMap(p.contexts[scope.context])];
  if (scope.context === 'battle' && (scope.page ?? 0) > 0 && Object.keys(p.battleSlotPages).length) layers.push(cloneMap(p.battleSlotPages));
  if (scope.mode && scope.context !== 'hero') layers.push(cloneMap(p.modes[scope.mode]));
  for (const l of layers) applyOverrides(l, overrides);
  return layers;
}

/** Flattened chord -> actions table for a scope (an upper layer that binds a chord hides lower layers' actions). */
export function buildChordTable(preset: KeyPreset, scope: BindingScope, overrides?: BindingMap): Map<string, InputAction[]> {
  const table = new Map<string, InputAction[]>();
  for (const layer of bindingLayers(preset, scope, overrides)) {
    const here = new Map<string, InputAction[]>();
    for (const action of Object.keys(layer) as InputAction[]) {
      for (const raw of layer[action] ?? []) {
        const chord = normalizeChord(raw);
        if (!chord) continue;
        const list = here.get(chord) ?? [];
        if (!list.includes(action)) list.push(action);
        here.set(chord, list);
      }
    }
    for (const [chord, acts] of here) table.set(chord, acts);
  }
  return table;
}

/** Back-compat: merged action -> chords for a context (global + context + overrides), Classic unless a preset is given. */
export function bindingsFor(ctx: InputContext, overrides: BindingMap = {}, preset: KeyPreset = 'classic'): BindingMap {
  const merged: BindingMap = {};
  const table = buildChordTable(preset, { context: ctx }, overrides);
  for (const [chord, acts] of table) for (const a of acts) (merged[a] ??= []).push(chord);
  return merged;
}

/**
 * Actions a key press fires in a scope. Exact chord first; with Shift held and no Shift binding, the chord without
 * Shift (queue modifier). Mouse chords ('Mouse0'..'Mouse2') resolve the same way.
 */
export function resolveChord(table: ReadonlyMap<string, readonly InputAction[]>, c: Chord): readonly InputAction[] {
  const exact = table.get(chordString(c));
  if (exact) return exact;
  if (c.shift) {
    const loose = table.get(chordString({ ...c, shift: false }));
    if (loose) return loose;
  }
  return [];
}

/** Chords bound to `action` in a scope (top layer wins), e.g. for card hotkey labels. */
export function chordsFor(preset: KeyPreset, scope: BindingScope, action: InputAction, overrides?: BindingMap): string[] {
  const table = buildChordTable(preset, scope, overrides);
  const out: string[] = [];
  for (const [chord, acts] of table) if (acts.includes(action)) out.push(chord);
  return out;
}

/** First chord label of an action in a scope ('' when unbound). Prefers keyboard over mouse chords. */
export function hotkeyLabel(preset: KeyPreset, scope: BindingScope, action: InputAction, overrides?: BindingMap): string {
  const chords = chordsFor(preset, scope, action, overrides).sort((a, b) => Number(a.includes('Mouse')) - Number(b.includes('Mouse')));
  return chords.length ? chordLabel(chords[0]!) : '';
}

/** Held keys of a preset. */
export function heldKeysFor(preset: KeyPreset): HeldKeyMap {
  return (PRESETS[preset] ?? PRESETS.classic).held;
}

// ---------------------------------------------------------------------------------------------------
// Rebinding (UI-01 settings): conflicts, rebind, reset
// ---------------------------------------------------------------------------------------------------

export interface BindingConflict {
  chord: string;
  /** Where both actions are live. */
  context: InputContext;
  page: number;
  mode: InputMode | null;
  actions: InputAction[];
  /** Also clashes with a held camera / movement key of the preset. */
  held: boolean;
}

/** Every scope a chord can be live in (contexts x battle pages x modes). */
export function allScopes(): BindingScope[] {
  const out: BindingScope[] = [];
  for (const context of INPUT_CONTEXTS) {
    const pages = context === 'battle' ? [0, 1] : [0];
    const modes: (InputMode | null)[] = context === 'world' ? [null, 'placement', 'targeting'] : context === 'battle' ? [null, 'targeting'] : [null];
    for (const page of pages) for (const mode of modes) out.push({ context, page, mode });
  }
  return out;
}

function heldCodes(preset: KeyPreset, context: InputContext, mode: InputMode | null): Set<string> {
  const h = heldKeysFor(preset);
  const s = new Set<string>();
  if (context === 'menu' || context === 'lab') return s;
  const add = (l: readonly string[]): void => l.forEach((c) => s.add(c));
  if (context === 'hero') {
    add(h.moveUp);
    add(h.moveDown);
    add(h.moveLeft);
    add(h.moveRight);
    return s;
  }
  add(h.panUp);
  add(h.panDown);
  add(h.panLeft);
  add(h.panRight);
  add(h.rotateLeft);
  add(h.rotateRight);
  add(h.zoomIn);
  add(h.zoomOut);
  // Placement mode borrows R for rotation: tilt is suspended while placing.
  if (mode !== 'placement') {
    add(h.tiltUp);
    add(h.tiltDown);
  }
  return s;
}

/** Actions that legitimately share a chord inside one layer (one key, two names: none in the shipped presets). */
const ALLOWED_PAIRS: ReadonlySet<string> = new Set<string>([]);

/**
 * Conflicts of a preset with user overrides: two actions answering the same chord in one scope, or an unmodified
 * action chord that is also a held camera / movement key there. The shipped presets have none (tested).
 */
export function findConflicts(preset: KeyPreset, overrides: BindingMap = {}): BindingConflict[] {
  const out: BindingConflict[] = [];
  const seen = new Set<string>();
  for (const scope of allScopes()) {
    const table = buildChordTable(preset, scope, overrides);
    const held = heldCodes(preset, scope.context, scope.mode ?? null);
    for (const [chord, acts] of table) {
      const c = parseChord(chord);
      const plain = !!c && !c.ctrl && !c.alt && !c.shift;
      const isHeld = plain && held.has(c!.code) && !acts.every((a) => a === 'hero_run');
      const multi = acts.length > 1 && !ALLOWED_PAIRS.has([...acts].sort().join('|'));
      if (!multi && !isHeld) continue;
      const key = `${scope.context}|${scope.page ?? 0}|${scope.mode ?? ''}|${chord}|${[...acts].sort().join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ chord, context: scope.context, page: scope.page ?? 0, mode: scope.mode ?? null, actions: [...acts], held: isHeld });
    }
  }
  return out;
}

/** Contexts in which an action is bound by the preset (global actions: every context except where suppressed). */
export function actionContexts(preset: KeyPreset, action: InputAction): InputContext[] {
  const p = PRESETS[preset] ?? PRESETS.classic;
  const out: InputContext[] = [];
  for (const ctx of INPUT_CONTEXTS) {
    const inGlobal = action in p.global && !(ctx === 'hero' && HERO_SUPPRESSED.includes(action));
    const inCtx = action in p.contexts[ctx] || (ctx === 'battle' && action in p.battleSlotPages) || (ctx !== 'hero' && Object.values(p.modes).some((m) => action in m));
    if (inGlobal || inCtx) out.push(ctx);
  }
  return out;
}

export interface RebindResult {
  /** New overrides (input object untouched). */
  overrides: BindingMap;
  /** Conflicts that involve the rebound action after the change (empty = clean). */
  conflicts: BindingConflict[];
  /** False when the chord string is invalid or the action cannot be bound. */
  ok: boolean;
}

/** Bind `action` to exactly `chords` (replacing its preset chords) and report the conflicts this creates. */
export function rebind(preset: KeyPreset, overrides: BindingMap, action: InputAction, chords: readonly string[]): RebindResult {
  const norm = chords.map((c) => normalizeChord(c));
  if (norm.some((c) => c === null) || actionContexts(preset, action).length === 0) return { overrides: cloneMap(overrides), conflicts: [], ok: false };
  const next = cloneMap(overrides);
  next[action] = norm as string[];
  const conflicts = findConflicts(preset, next).filter((c) => c.actions.includes(action));
  return { overrides: next, conflicts, ok: true };
}

/** Remove a user override (back to the preset chords). */
export function resetBinding(overrides: BindingMap, action: InputAction): BindingMap {
  const next = cloneMap(overrides);
  delete next[action];
  return next;
}

/** Unbind an action entirely (no chord) - used to resolve a conflict by freeing the other action. */
export function unbind(overrides: BindingMap, action: InputAction): BindingMap {
  const next = cloneMap(overrides);
  next[action] = [];
  return next;
}

// ---------------------------------------------------------------------------------------------------
// Labels for the settings screen
// ---------------------------------------------------------------------------------------------------

export type ActionGroup = 'General' | 'Camera' | 'World' | 'Command card' | 'Battle orders' | 'Formation shapes' | 'Hero';

const L = (label: string, group: ActionGroup): { label: string; group: ActionGroup } => ({ label, group });

/** Human names + settings groups of every action (keys = INPUT_ACTIONS; tested to be complete). */
export const ACTION_INFO: Readonly<Record<InputAction, { label: string; group: ActionGroup }>> = {
  pause: L('Pause', 'General'),
  speed_up: L('Faster', 'General'),
  speed_down: L('Slower', 'General'),
  speed_reset: L('Normal speed', 'General'),
  menu: L('Menu', 'General'),
  quick_save: L('Quick save', 'General'),
  quick_load: L('Quick load', 'General'),
  toggle_profiler: L('Profiler overlay', 'General'),
  screenshot: L('Screenshot', 'General'),
  cancel: L('Cancel', 'General'),
  select: L('Select', 'General'),
  select_add: L('Add to selection', 'General'),
  box_select: L('Box select', 'General'),
  context_command: L('Context command', 'General'),
  radial_menu: L('Command wheel', 'General'),
  select_all: L('Select all formations', 'Battle orders'),
  group_assign: L('Assign control group', 'General'),
  group_select: L('Select control group', 'General'),
  order_hold: L('Hold', 'Battle orders'),
  order_advance: L('Advance', 'Battle orders'),
  order_withdraw: L('Withdraw', 'Battle orders'),
  order_regroup: L('Regroup', 'Battle orders'),
  order_flank: L('Flank', 'Battle orders'),
  order_defend: L('Defend', 'Battle orders'),
  order_attack: L('Attack', 'Battle orders'),
  order_charge: L('Charge', 'Battle orders'),
  order_run_toggle: L('Run / march', 'Battle orders'),
  shape_line: L('Line', 'Formation shapes'),
  shape_column: L('Column', 'Formation shapes'),
  shape_square: L('Square', 'Formation shapes'),
  shape_wedge: L('Wedge', 'Formation shapes'),
  overlay_supply: L('Supply overlay', 'World'),
  overlay_terrain: L('Terrain overlay', 'World'),
  overlay_borders: L('Borders overlay', 'World'),
  camera_focus: L('Focus camera', 'Camera'),
  camera_reset: L('Reset camera', 'Camera'),
  camera_toggle_cinematic: L('Cinematic camera', 'Camera'),
  hero_interact: L('Interact / talk', 'Hero'),
  hero_run: L('Run', 'Hero'),
  hero_exit: L('Leave / pause', 'Hero'),
  shape_loose: L('Loose', 'Formation shapes'),
  shape_circle: L('Circle', 'Formation shapes'),
  order_stance: L('Cycle stance', 'Battle orders'),
  commander_rally: L('Commander rally', 'Battle orders'),
  idle_builders_next: L('Next idle builders', 'World'),
  idle_army_next: L('Next idle army', 'World'),
  select_capital: L('Select capital', 'World'),
  placement_rotate: L('Rotate building', 'World'),
  card_next_tab: L('Next card tab', 'Command card'),
  card_slot_0: L('Card slot 1 (top left)', 'Command card'),
  card_slot_1: L('Card slot 2', 'Command card'),
  card_slot_2: L('Card slot 3', 'Command card'),
  card_slot_3: L('Card slot 4', 'Command card'),
  card_slot_4: L('Card slot 5', 'Command card'),
  card_slot_5: L('Card slot 6', 'Command card'),
  card_slot_6: L('Card slot 7', 'Command card'),
  card_slot_7: L('Card slot 8', 'Command card'),
  card_slot_8: L('Card slot 9', 'Command card'),
  card_slot_9: L('Card slot 10', 'Command card'),
  card_slot_10: L('Card slot 11', 'Command card'),
  card_slot_11: L('Card slot 12', 'Command card'),
  card_slot_12: L('Card slot 13', 'Command card'),
  card_slot_13: L('Card slot 14', 'Command card'),
  card_slot_14: L('Card slot 15 (bottom right)', 'Command card'),
  camera_rotate_left: L('Rotate camera left', 'Camera'),
  camera_rotate_right: L('Rotate camera right', 'Camera'),
  hero_attack_light: L('Light attack', 'Hero'),
  hero_attack_heavy: L('Heavy attack (hold to charge)', 'Hero'),
  hero_roll: L('Dodge roll', 'Hero'),
  hero_guard: L('Guard (tap to parry)', 'Hero'),
  hero_salve: L('Salve', 'Hero'),
  hero_lock_on: L('Lock on', 'Hero'),
  hero_skip_cinematic: L('Skip cinematic (hold)', 'Hero'),
  dialogue_choice_1: L('Dialogue choice 1', 'Hero'),
  dialogue_choice_2: L('Dialogue choice 2', 'Hero'),
  dialogue_choice_3: L('Dialogue choice 3', 'Hero'),
  dialogue_choice_4: L('Dialogue choice 4', 'Hero'),
  dialogue_choice_5: L('Dialogue choice 5', 'Hero'),
};

/** Actions offered for rebinding, grouped for the settings screen (pointer-only actions excluded). */
export function rebindableActions(preset: KeyPreset): { group: ActionGroup; actions: InputAction[] }[] {
  const pointerOnly = new Set<InputAction>(['select', 'select_add', 'box_select', 'context_command', 'radial_menu', 'group_assign', 'group_select']);
  const groups = new Map<ActionGroup, InputAction[]>();
  for (const a of INPUT_ACTIONS) {
    if (pointerOnly.has(a) || actionContexts(preset, a).length === 0) continue;
    const g = ACTION_INFO[a].group;
    const list = groups.get(g) ?? [];
    list.push(a);
    groups.set(g, list);
  }
  return [...groups.entries()].map(([group, actions]) => ({ group, actions }));
}
