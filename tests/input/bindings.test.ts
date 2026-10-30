/**
 * Classic / Grid key presets (DESIGN_SPEC §8.8, §11.8), the key resolver, hero override, overlay modes and the
 * rebinding API with conflict detection. OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 */
import { describe, expect, it } from 'vitest';
import type { InputAction, KeyPreset } from '../../src/core/types';
import { INPUT_ACTIONS, KEY_PRESETS } from '../../src/core/types';
import {
  ACTION_INFO,
  actionContexts,
  bindingsFor,
  buildChordTable,
  CARD_SLOT_ACTIONS,
  cardSlotIndex,
  chordLabel,
  findConflicts,
  hotkeyLabel,
  normalizeChord,
  parseChord,
  rebind,
  rebindableActions,
  resetBinding,
  resolveChord,
  unbind,
  type BindingScope,
} from '../../src/input/bindings';

function keys(preset: KeyPreset, scope: BindingScope, chord: string, overrides = {}): readonly InputAction[] {
  const table = buildChordTable(preset, scope, overrides);
  const c = parseChord(chord);
  if (!c) throw new Error(`bad chord ${chord}`);
  return resolveChord(table, c);
}

const BATTLE: BindingScope = { context: 'battle' };
const WORLD: BindingScope = { context: 'world' };
const HERO: BindingScope = { context: 'hero' };

const ORDER_ACTIONS: readonly InputAction[] = ['order_hold', 'order_advance', 'order_attack', 'order_charge', 'order_flank', 'order_defend', 'order_withdraw', 'order_regroup', 'order_run_toggle', 'order_stance', 'commander_rally', 'select_all'];
const SHAPE_ACTIONS: readonly InputAction[] = ['shape_line', 'shape_column', 'shape_square', 'shape_wedge', 'shape_loose', 'shape_circle'];

describe('chords', () => {
  it('parses, normalizes and labels chords', () => {
    expect(parseChord('Ctrl+KeyA')).toEqual({ code: 'KeyA', ctrl: true, shift: false, alt: false });
    expect(normalizeChord('Shift+Ctrl+KeyA')).toBe('Ctrl+Shift+KeyA');
    expect(normalizeChord('Bogus+KeyA')).toBeNull();
    expect(chordLabel('Ctrl+KeyA')).toBe('Ctrl+A');
    expect(chordLabel('Shift+KeyG')).toBe('Shift+G');
    expect(chordLabel('Period')).toBe('.');
    expect(chordLabel('Alt+KeyQ')).toBe('Alt+Q');
    expect(chordLabel('Digit3')).toBe('3');
    expect(cardSlotIndex('card_slot_7')).toBe(7);
    expect(cardSlotIndex('order_hold')).toBe(-1);
  });

  it('labels every input action (settings screen)', () => {
    for (const a of INPUT_ACTIONS) expect(ACTION_INFO[a]?.label, a).toBeTruthy();
  });
});

describe('Classic preset (DESIGN_SPEC §8.8 table)', () => {
  const p: KeyPreset = 'classic';
  it('battle orders and shapes use the mnemonic letters', () => {
    const want: [string, InputAction][] = [
      ['KeyH', 'order_hold'],
      ['KeyT', 'order_advance'],
      ['KeyX', 'order_attack'],
      ['KeyC', 'order_charge'],
      ['KeyY', 'order_flank'],
      ['KeyU', 'order_defend'],
      ['KeyB', 'order_withdraw'],
      ['KeyG', 'order_regroup'],
      ['KeyN', 'order_run_toggle'],
      ['KeyJ', 'shape_line'],
      ['KeyI', 'shape_column'],
      ['KeyO', 'shape_square'],
      ['KeyP', 'shape_wedge'],
      ['KeyK', 'shape_loose'],
      ['Shift+KeyK', 'shape_circle'],
      ['KeyL', 'commander_rally'],
      ['KeyZ', 'select_all'],
      ['KeyV', 'camera_toggle_cinematic'],
    ];
    for (const [chord, action] of want) expect(keys(p, BATTLE, chord), chord).toEqual([action]);
  });

  it('Shift queues: Shift+H is still Hold (the event carries shift)', () => {
    expect(keys(p, BATTLE, 'Shift+KeyH')).toEqual(['order_hold']);
  });

  it('speed keys moved off , and . which cycle idle builders / armies (AoE)', () => {
    expect(keys(p, WORLD, 'Period')).toEqual(['idle_builders_next']);
    expect(keys(p, WORLD, 'Comma')).toEqual(['idle_army_next']);
    expect(keys(p, WORLD, 'Equal')).toEqual(['speed_up']);
    expect(keys(p, WORLD, 'Minus')).toEqual(['speed_down']);
    expect(keys(p, WORLD, 'Backspace')).toEqual(['speed_reset']);
    expect(keys(p, WORLD, 'Space')).toEqual(['pause']);
  });

  it('world: H capital, M / K / L overlays; K and L mean other things in battle (contexts never overlap)', () => {
    expect(keys(p, WORLD, 'KeyH')).toEqual(['select_capital']);
    expect(keys(p, WORLD, 'KeyM')).toEqual(['overlay_supply']);
    expect(keys(p, WORLD, 'KeyK')).toEqual(['overlay_terrain']);
    expect(keys(p, WORLD, 'KeyL')).toEqual(['overlay_borders']);
    expect(keys(p, BATTLE, 'KeyK')).toEqual(['shape_loose']);
    expect(keys(p, BATTLE, 'KeyL')).toEqual(['commander_rally']);
  });

  it('command-card slots on Alt + the grid letters, Tab switches the card tab', () => {
    const letters = ['Q', 'W', 'E', 'R', 'T', 'A', 'S', 'D', 'F', 'G', 'Z', 'X', 'C', 'V', 'B'];
    letters.forEach((l, i) => {
      expect(keys(p, WORLD, `Alt+Key${l}`)).toEqual([CARD_SLOT_ACTIONS[i]]);
      expect(keys(p, BATTLE, `Alt+Key${l}`)).toEqual([CARD_SLOT_ACTIONS[i]]);
    });
    expect(keys(p, WORLD, 'Tab')).toEqual(['card_next_tab']);
    expect(keys(p, BATTLE, 'Tab')).toEqual(['card_next_tab']);
    // Plain Q is the camera (held key), not a slot.
    expect(keys(p, WORLD, 'KeyQ')).toEqual([]);
  });
});

describe('Grid preset (AoE IV)', () => {
  const p: KeyPreset = 'grid';
  it('battle page 1: Q W E R T / A S D F G orders, Z X C V B shapes', () => {
    const want: [string, InputAction][] = [
      ['KeyQ', 'order_hold'],
      ['KeyW', 'order_advance'],
      ['KeyE', 'order_attack'],
      ['KeyR', 'order_charge'],
      ['KeyT', 'order_flank'],
      ['KeyA', 'order_defend'],
      ['KeyS', 'order_withdraw'],
      ['KeyD', 'order_regroup'],
      ['KeyF', 'order_run_toggle'],
      ['KeyG', 'order_stance'],
      ['KeyZ', 'shape_line'],
      ['KeyX', 'shape_column'],
      ['KeyC', 'shape_square'],
      ['KeyV', 'shape_wedge'],
      ['KeyB', 'shape_loose'],
      ['Shift+KeyB', 'shape_circle'],
      ['Shift+KeyG', 'commander_rally'],
      ['Ctrl+KeyA', 'select_all'],
      ['Home', 'camera_toggle_cinematic'],
    ];
    for (const [chord, action] of want) expect(keys(p, BATTLE, chord), chord).toEqual([action]);
  });

  it('battle pages after the first (intents) turn the letters into card slots', () => {
    expect(keys(p, { context: 'battle', page: 1 }, 'KeyQ')).toEqual(['card_slot_0']);
    expect(keys(p, { context: 'battle', page: 1 }, 'KeyB')).toEqual(['card_slot_14']);
    // Modified chords of page 0 survive (Ctrl+A select all, Shift+G rally).
    expect(keys(p, { context: 'battle', page: 1 }, 'Ctrl+KeyA')).toEqual(['select_all']);
    expect(keys(p, { context: 'battle', page: 1 }, 'Shift+KeyG')).toEqual(['commander_rally']);
  });

  it('world: the letters are card slots, F1 / F2 / F4 overlays, H capital, . and , idle cycling', () => {
    expect(keys(p, WORLD, 'KeyQ')).toEqual(['card_slot_0']);
    expect(keys(p, WORLD, 'KeyG')).toEqual(['card_slot_9']);
    expect(keys(p, WORLD, 'F1')).toEqual(['overlay_supply']);
    expect(keys(p, WORLD, 'F2')).toEqual(['overlay_terrain']);
    expect(keys(p, WORLD, 'F4')).toEqual(['overlay_borders']);
    expect(keys(p, WORLD, 'KeyH')).toEqual(['select_capital']);
    expect(keys(p, WORLD, 'Period')).toEqual(['idle_builders_next']);
    expect(keys(p, WORLD, 'Comma')).toEqual(['idle_army_next']);
  });
});

describe('hero context overrides the RTS keys (DESIGN_SPEC §11.8)', () => {
  for (const p of KEY_PRESETS) {
    it(`${p}: Q guard, E interact, R salve, Space roll, Tab lock-on, Esc leave, mouse attacks, digits = dialogue`, () => {
      expect(keys(p, HERO, 'KeyQ')).toEqual(['hero_guard']);
      expect(keys(p, HERO, 'KeyE')).toEqual(['hero_interact']);
      expect(keys(p, HERO, 'KeyR')).toEqual(['hero_salve']);
      expect(keys(p, HERO, 'Space')).toEqual(['hero_roll']);
      expect(keys(p, HERO, 'Tab')).toEqual(['hero_lock_on']);
      expect(keys(p, HERO, 'Escape')).toEqual(['hero_exit']);
      expect(keys(p, HERO, 'Mouse0')).toEqual(['hero_attack_light']);
      expect(keys(p, HERO, 'Mouse2')).toEqual(['hero_attack_heavy']);
      expect(keys(p, HERO, 'Mouse1')).toEqual(['hero_lock_on']);
      expect(keys(p, HERO, 'ShiftLeft')).toEqual(['hero_run']);
      expect(keys(p, HERO, 'Digit3')).toEqual(['dialogue_choice_3']);
      // RTS meanings are gone.
      expect(keys(p, HERO, 'Equal')).toEqual([]);
    });
  }
});

describe('overlay modes', () => {
  for (const p of KEY_PRESETS) {
    it(`${p}: placement - R rotates, Esc cancels; targeting - Esc cancels`, () => {
      expect(keys(p, { context: 'world', mode: 'placement' }, 'KeyR')).toEqual(['placement_rotate']);
      expect(keys(p, { context: 'world', mode: 'placement' }, 'Escape')).toEqual(['cancel']);
      expect(keys(p, { context: 'battle', mode: 'targeting' }, 'Escape')).toEqual(['cancel']);
      expect(keys(p, { context: 'world' }, 'Escape')).toEqual(['menu']);
    });
  }
});

describe('keyboard reachability of every battle order and shape (both presets)', () => {
  for (const p of KEY_PRESETS) {
    it(p, () => {
      for (const a of [...ORDER_ACTIONS, ...SHAPE_ACTIONS]) expect(hotkeyLabel(p, BATTLE, a), `${p} ${a}`).not.toBe('');
    });
  }
});

describe('conflicts and rebinding (UI-01 settings)', () => {
  it('the shipped presets have no conflicts in any context, page or mode', () => {
    for (const p of KEY_PRESETS) expect(findConflicts(p), p).toEqual([]);
  });

  it('rebinding Hold onto Advance\'s key reports the clash in battle', () => {
    const r = rebind('classic', {}, 'order_hold', ['KeyT']);
    expect(r.ok).toBe(true);
    expect(r.conflicts.length).toBeGreaterThan(0);
    expect(r.conflicts[0]!.context).toBe('battle');
    expect(r.conflicts[0]!.actions.sort()).toEqual(['order_advance', 'order_hold']);
  });

  it('a plain key that is a held camera key is a conflict (Classic W pans)', () => {
    const r = rebind('classic', {}, 'order_hold', ['KeyW']);
    expect(r.conflicts.some((c) => c.held && c.chord === 'KeyW')).toBe(true);
    // ...but Grid has no WASD camera.
    expect(rebind('grid', {}, 'order_charge', ['Semicolon']).conflicts).toEqual([]);
  });

  it('a clean rebind applies; reset and unbind restore / free it', () => {
    const r = rebind('classic', {}, 'order_hold', ['Semicolon']);
    expect(r.conflicts).toEqual([]);
    expect(keys('classic', BATTLE, 'Semicolon', r.overrides)).toEqual(['order_hold']);
    expect(keys('classic', BATTLE, 'KeyH', r.overrides)).toEqual([]);
    const back = resetBinding(r.overrides, 'order_hold');
    expect(keys('classic', BATTLE, 'KeyH', back)).toEqual(['order_hold']);
    // Resolve a conflict by unbinding the other action.
    const clash = rebind('classic', {}, 'order_hold', ['KeyT']);
    const freed = unbind(clash.overrides, 'order_advance');
    expect(findConflicts('classic', freed)).toEqual([]);
  });

  it('invalid chords are refused; an override never leaks into contexts where the action is not bound', () => {
    expect(rebind('classic', {}, 'order_hold', ['Bogus+KeyQ']).ok).toBe(false);
    const r = rebind('classic', {}, 'hero_guard', ['KeyG']);
    expect(keys('classic', BATTLE, 'KeyG', r.overrides)).toEqual(['order_regroup']);
    expect(keys('classic', HERO, 'KeyG', r.overrides)).toEqual(['hero_guard']);
    expect(actionContexts('classic', 'hero_guard')).toEqual(['hero']);
  });

  it('lists rebindable actions by group, without pointer-only actions', () => {
    const groups = rebindableActions('grid');
    const all = groups.flatMap((g) => g.actions);
    expect(all).toContain('order_hold');
    expect(all).toContain('card_slot_14');
    expect(all).not.toContain('box_select');
    expect(groups.map((g) => g.group)).toContain('Hero');
  });

  it('bindingsFor stays source-compatible (merged action -> chords)', () => {
    expect(bindingsFor('battle').order_hold).toEqual(['KeyH']);
    expect(bindingsFor('battle', {}, 'grid').order_hold).toEqual(['KeyQ']);
    expect(bindingsFor('hero').pause).toBeUndefined();
  });
});
