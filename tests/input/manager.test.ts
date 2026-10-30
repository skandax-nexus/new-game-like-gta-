/**
 * InputManager end to end with synthetic DOM events (node: EventTarget shims for window / document / canvas):
 * presets, control groups, hero holds (hold-to-charge, hold-to-toggle), overlay modes and touch gestures.
 * OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GameSettings, InputAction, InputActionEvent } from '../../src/core/types';
import { createGameBus } from '../../src/core/events';
import { defaultSettings } from '../../src/core/settings';
import { InputManager } from '../../src/input/input';

const g = globalThis as unknown as Record<'window' | 'document', unknown>;
let saved: { window: unknown; document: unknown };
let canvas: EventTarget & { getBoundingClientRect(): DOMRect; setPointerCapture(): void; focus(): void };

function ev(type: string, props: Record<string, unknown>): Event {
  const e = new Event(type, { cancelable: true });
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v });
  return e;
}

function key(type: 'keydown' | 'keyup', code: string, mods: { shift?: boolean; ctrl?: boolean; alt?: boolean } = {}): void {
  (g.window as EventTarget).dispatchEvent(ev(type, { code, shiftKey: !!mods.shift, ctrlKey: !!mods.ctrl, metaKey: false, altKey: !!mods.alt, repeat: false }));
}
function press(code: string, mods: { shift?: boolean; ctrl?: boolean; alt?: boolean } = {}): void {
  key('keydown', code, mods);
  key('keyup', code, {});
}

let pid = 1;
function pointer(type: string, x: number, y: number, opts: { id?: number; kind?: string; button?: number } = {}): void {
  const target: EventTarget = type === 'pointerdown' ? canvas : (g.window as EventTarget);
  target.dispatchEvent(ev(type, { pointerId: opts.id ?? pid, pointerType: opts.kind ?? 'mouse', button: opts.button ?? 0, clientX: x, clientY: y, shiftKey: false, ctrlKey: false, metaKey: false, movementX: 0, movementY: 0 }));
}

function make(patch: Partial<GameSettings> = {}): { input: InputManager; seen: InputActionEvent[] } {
  const bus = createGameBus();
  const seen: InputActionEvent[] = [];
  bus.on('input:action', (e) => seen.push(e));
  const s = { ...defaultSettings(), ...patch };
  const input = new InputManager(canvas as unknown as HTMLElement, bus, s);
  return { input, seen };
}

function actions(input: InputManager): InputAction[] {
  return input.frame().actions.map((a) => a.action);
}

beforeEach(() => {
  saved = { window: g.window, document: g.document };
  g.window = new EventTarget();
  g.document = Object.assign(new EventTarget(), { pointerLockElement: null, hasFocus: () => true });
  canvas = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
    setPointerCapture: () => undefined,
    focus: () => undefined,
  });
});

afterEach(() => {
  g.window = saved.window;
  g.document = saved.document;
});

describe('keyboard per preset', () => {
  it('Classic battle: H hold, Shift+H queued hold, Alt+Q card slot 0', () => {
    const { input } = make({ keyPreset: 'classic' });
    input.setContext('battle');
    press('KeyH');
    press('KeyH', { shift: true });
    press('KeyQ', { alt: true });
    const f = input.frame().actions;
    expect(f.map((a) => a.action)).toEqual(['order_hold', 'order_hold', 'card_slot_0']);
    expect(f[1]!.shift).toBe(true);
  });

  it('Grid battle: Q hold; after the HUD switches to the intents page, Q is card slot 0', () => {
    const { input } = make({ keyPreset: 'grid' });
    input.setContext('battle');
    press('KeyQ');
    expect(actions(input)).toEqual(['order_hold']);
    input.setCardPage(1);
    press('KeyQ');
    expect(actions(input)).toEqual(['card_slot_0']);
  });

  it('the ?keypreset= override wins over settings', () => {
    const { input } = make({ keyPreset: 'classic' });
    input.setPresetOverride('grid');
    input.setContext('battle');
    press('KeyQ');
    expect(actions(input)).toEqual(['order_hold']);
    expect(input.preset).toBe('grid');
  });

  it('control groups: Ctrl+1 assigns, 1 selects, Shift+1 adds, a double press centres the camera', () => {
    const { input } = make();
    input.setContext('world');
    press('Digit1', { ctrl: true });
    press('Digit1');
    press('Digit1', { shift: true });
    const a = input.frame().actions;
    expect(a.map((x) => [x.action, x.group, x.shift])).toEqual([
      ['group_assign', 1, false],
      ['group_select', 1, false],
      ['group_select', 1, true],
    ]);
    press('Digit2');
    press('Digit2');
    expect(input.frame().actions.map((x) => [x.action, x.group])).toEqual([
      ['group_select', 2],
      ['group_select', 2],
      ['camera_focus', 2],
    ]);
  });

  it('placement mode: R rotates and stops tilting, Esc cancels', () => {
    const { input } = make({ keyPreset: 'classic' });
    input.setContext('world');
    input.setMode('placement');
    key('keydown', 'KeyR');
    const f = input.frame();
    expect(f.actions.map((a) => a.action)).toEqual(['placement_rotate']);
    expect(f.tilt).toBe(0);
    key('keyup', 'KeyR');
    press('Escape');
    expect(actions(input)).toEqual(['cancel']);
    input.setMode(null);
    key('keydown', 'KeyR');
    expect(input.frame().tilt).toBeGreaterThan(0);
  });

  it('held camera keys pan in Classic (WASD) and Grid (arrows only)', () => {
    const c = make({ keyPreset: 'classic' }).input;
    c.setContext('world');
    key('keydown', 'KeyD');
    expect(c.frame().panX).toBe(1);
    key('keyup', 'KeyD');
    const gr = make({ keyPreset: 'grid' }).input;
    gr.setContext('world');
    key('keydown', 'KeyD');
    expect(gr.frame().panX).toBe(0);
    key('keydown', 'ArrowRight');
    expect(gr.frame().panX).toBe(1);
  });
});

describe('hero', () => {
  it('Q guard is a hold; holdToToggle latches it', () => {
    const { input } = make();
    input.setContext('hero');
    key('keydown', 'KeyQ');
    expect(input.isHeld('hero_guard')).toBe(true);
    key('keyup', 'KeyQ');
    expect(input.isHeld('hero_guard')).toBe(false);
    const t = make({ holdToToggle: { guard: true, run: false } }).input;
    t.setContext('hero');
    press('KeyQ');
    expect(t.isHeld('hero_guard')).toBe(true);
    press('KeyQ');
    expect(t.isHeld('hero_guard')).toBe(false);
  });

  it('RMB hold-to-charge: releasedFor reports the held seconds for one frame', async () => {
    const { input } = make();
    input.setContext('hero');
    pointer('pointerdown', 400, 300, { button: 2 });
    expect(actions(input)).toEqual(['hero_attack_heavy']);
    expect(input.isHeld('hero_attack_heavy')).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    pointer('pointerup', 400, 300, { button: 2 });
    input.frame();
    expect(input.releasedFor('hero_attack_heavy')).toBeGreaterThan(0.02);
    input.frame();
    expect(input.releasedFor('hero_attack_heavy')).toBe(-1);
  });

  it('Space rolls instead of pausing; LMB click is a light attack', () => {
    const { input } = make();
    input.setContext('hero');
    press('Space');
    pointer('pointerdown', 400, 300, { button: 0 });
    pointer('pointerup', 400, 300, { button: 0 });
    expect(actions(input)).toEqual(['hero_roll', 'hero_attack_light']);
  });

  it('touch: left-half stick moves, past 80% runs', () => {
    const { input } = make();
    input.setContext('hero');
    pointer('pointerdown', 100, 400, { id: 7, kind: 'touch' });
    pointer('pointermove', 100, 340, { id: 7, kind: 'touch' });
    const f = input.frame();
    expect(f.moveY).toBeCloseTo(1, 5);
    expect(f.run).toBe(true);
    pointer('pointerup', 100, 340, { id: 7, kind: 'touch' });
    expect(input.frame().moveY).toBe(0);
  });
});

describe('touch gestures -> actions', () => {
  it('world: tap selects, long press is the context command, two-finger tap pauses', async () => {
    const { input } = make();
    input.setContext('world');
    pointer('pointerdown', 300, 300, { id: 1, kind: 'touch' });
    pointer('pointerup', 300, 300, { id: 1, kind: 'touch' });
    expect(actions(input)).toEqual(['select']);
    pointer('pointerdown', 320, 300, { id: 2, kind: 'touch' });
    await new Promise((r) => setTimeout(r, 560));
    expect(actions(input)).toEqual(['context_command']);
    pointer('pointerup', 320, 300, { id: 2, kind: 'touch' });
    pointer('pointerdown', 300, 300, { id: 3, kind: 'touch' });
    pointer('pointerdown', 360, 300, { id: 4, kind: 'touch' });
    pointer('pointerup', 300, 300, { id: 3, kind: 'touch' });
    pointer('pointerup', 360, 300, { id: 4, kind: 'touch' });
    expect(actions(input)).toEqual(['pause']);
  });

  it('battle: long press opens the radial wheel; a drag from the selection is a move (context_command + box)', async () => {
    const { input } = make();
    input.setContext('battle');
    input.setSelectionHitTest((x, y) => Math.hypot(x - 200, y - 200) < 40);
    pointer('pointerdown', 500, 300, { id: 1, kind: 'touch' });
    await new Promise((r) => setTimeout(r, 560));
    expect(actions(input)).toEqual(['radial_menu']);
    pointer('pointerup', 500, 300, { id: 1, kind: 'touch' });
    pointer('pointerdown', 200, 200, { id: 2, kind: 'touch' });
    for (let i = 1; i <= 5; i++) pointer('pointermove', 200 + i * 30, 200, { id: 2, kind: 'touch' });
    expect(input.touchDrag).toEqual({ x0: 200, y0: 200, x1: 350, y1: 200 });
    pointer('pointerup', 350, 200, { id: 2, kind: 'touch' });
    const f = input.frame();
    expect(f.actions.map((a) => a.action)).toEqual(['context_command']);
    expect(f.actions[0]!.box).toEqual({ x0: 200, y0: 200, x1: 350, y1: 200 });
    expect(f.dragX).toBe(0);
  });

  it('battle: a drag on empty ground pans; pinch zooms', () => {
    const { input } = make();
    input.setContext('battle');
    pointer('pointerdown', 400, 300, { id: 1, kind: 'touch' });
    pointer('pointermove', 450, 320, { id: 1, kind: 'touch' });
    pointer('pointerup', 450, 320, { id: 1, kind: 'touch' });
    const f = input.frame();
    expect(f.dragX).toBe(50);
    expect(f.dragY).toBe(20);
    pointer('pointerdown', 300, 300, { id: 2, kind: 'touch' });
    pointer('pointerdown', 400, 300, { id: 3, kind: 'touch' });
    pointer('pointermove', 250, 300, { id: 2, kind: 'touch' });
    pointer('pointermove', 450, 300, { id: 3, kind: 'touch' });
    expect(input.frame().zoom).toBeGreaterThan(0);
  });
});
