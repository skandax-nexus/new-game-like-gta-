/**
 * Reachability of every battle order, shape, stance and intent (DESIGN_SPEC §8.8) in both key presets, and on touch.
 * Keyboard: from card page 0, Tab (card_next_tab) reaches every page, and on each page every card slot has a key
 * that fires it there - its own action (Classic mnemonic letters) or card_slot_N (Alt+letters / Grid letters) - and
 * the label printed on the slot is that key. Touch: every item is on the radial wheel or on the card pages behind
 * "More"; the wheel fits a 390 px phone without overlapping items. Also the world card (settlement / army).
 * OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 */
import { describe, expect, it } from 'vitest';
import type { InputAction, KeyPreset } from '../../src/core/types';
import { buildChordTable, CARD_SLOT_ACTIONS, chordLabel, parseChord, resolveChord, type BindingScope } from '../../src/input/bindings';
import { armyCard, BATTLE_ORDER_SLOTS, BATTLE_PAGES, battleCard, INTENT_DEFS, settlementCard, SETTLEMENT_TABS, type CardModel, type CardSlot } from '../../src/ui/services/commandCards';
import { clampWheel, RADIAL_EXTENT, RADIAL_INNER_R, RADIAL_OUTER_R, radialItemsFrom, ringPositions } from '../../src/ui/screens/battle/radial';
import { testBattle } from '../sim/tactical/helpers';
import { campaign } from '../sim/strategic/helpers';

const PRESETS: KeyPreset[] = ['classic', 'grid'];

const tb = testBattle({
  factions: ['heartland', 'highland'],
  sides: [
    [
      { cls: 'spearmen', x: -60, z: 100 },
      { cls: 'archers', x: 0, z: 130 },
      { cls: 'cavalry', x: 80, z: 100 },
      { cls: 'supply_train', x: 0, z: 200 },
    ],
    [{ cls: 'spearmen', x: 0, z: -100 }],
  ],
});
const battle = tb.state;
const own = battle.formations.filter((f) => f.side === 0).map((f) => f.index);

/** What a slot fires when its key is pressed on its page. */
function slotActions(s: CardSlot): InputAction[] {
  const out: InputAction[] = [CARD_SLOT_ACTIONS[s.slot]!];
  if (s.command.kind === 'input') out.push(s.command.action);
  return out;
}

/** The chord (if any) on this scope whose label is the slot's printed hotkey and which fires the slot. */
function keyFor(preset: KeyPreset, scope: BindingScope, s: CardSlot): string | null {
  const table = buildChordTable(preset, scope);
  const want = slotActions(s);
  for (const chord of table.keys()) {
    if (chordLabel(chord) !== s.hotkey) continue;
    const c = parseChord(chord);
    if (c && resolveChord(table, c).some((a) => want.includes(a))) return chord;
  }
  return null;
}

/** Every battle item a player must be able to give. */
const ALL_BATTLE_ITEMS = [
  ...BATTLE_ORDER_SLOTS.map((d) => d!.action as string),
  'shape_circle',
  'stance:aggressive',
  'stance:defensive',
  'stance:skirmish',
  'stance:hold_fire',
  ...INTENT_DEFS.map((d) => `intent:${d.intent}`),
  'intent:clear',
];

function itemKey(s: CardSlot): string {
  if (s.command.kind === 'input') return s.command.action;
  return s.id;
}

describe('battle: keyboard reachability (Classic and Grid)', () => {
  for (const preset of PRESETS) {
    it(`${preset}: Tab cycles the pages and every slot's printed key fires it`, () => {
      const reached = new Set<string>();
      for (let p = 0; p < BATTLE_PAGES.length; p++) {
        const scope: BindingScope = { context: 'battle', page: p };
        const table = buildChordTable(preset, scope);
        expect(resolveChord(table, parseChord('Tab')!), `Tab on page ${p}`).toContain('card_next_tab');
        const m = battleCard(battle, 0, own, BATTLE_PAGES[p]!.id, { preset, overrides: {} });
        for (const s of m.slots) {
          if (!s) continue;
          expect(s.hotkey, `${preset} page ${p} slot ${s.slot} (${s.id}) has a key`).not.toBe('');
          expect(keyFor(preset, scope, s), `${preset} page ${p} slot ${s.slot} (${s.id}) key ${s.hotkey} fires it`).not.toBeNull();
          reached.add(itemKey(s));
        }
      }
      for (const item of ALL_BATTLE_ITEMS) expect(reached.has(item), `${preset}: ${item}`).toBe(true);
    });
  }

  it('Grid: letters are orders on page 0 and card slots on the other pages', () => {
    const p0 = buildChordTable('grid', { context: 'battle', page: 0 });
    const p1 = buildChordTable('grid', { context: 'battle', page: 1 });
    expect(resolveChord(p0, parseChord('KeyQ')!)).toContain('order_hold');
    expect(resolveChord(p1, parseChord('KeyQ')!)).toContain('card_slot_0');
    expect(resolveChord(p0, parseChord('KeyZ')!)).toContain('shape_line');
  });

  it('Classic: mnemonic letters stay orders on every page; Alt+letters are the slots', () => {
    for (let p = 0; p < 3; p++) {
      const t = buildChordTable('classic', { context: 'battle', page: p });
      expect(resolveChord(t, parseChord('KeyH')!)).toContain('order_hold');
      expect(resolveChord(t, parseChord('Alt+KeyQ')!)).toContain('card_slot_0');
    }
  });
});

describe('battle: touch reachability', () => {
  const ctx = { preset: 'classic' as const, overrides: {} };
  const pages: CardModel[] = BATTLE_PAGES.map((p) => battleCard(battle, 0, own, p.id, ctx));
  const wheel = radialItemsFrom(pages[0]!, pages[1]!, pages[2]!);

  it('the radial wheel carries every order, shape and intent; "More" pages carry the rest', () => {
    const onWheel = new Set([...wheel.inner, ...wheel.outer].map(itemKey));
    for (const d of BATTLE_ORDER_SLOTS.slice(0, 10)) expect(onWheel.has(d!.action), d!.action).toBe(true);
    for (const s of ['shape_line', 'shape_column', 'shape_square', 'shape_wedge', 'shape_loose', 'shape_circle']) expect(onWheel.has(s), s).toBe(true);
    for (const d of INTENT_DEFS) expect(onWheel.has(`intent:${d.intent}`), d.intent).toBe(true);
    const onCards = new Set(pages.flatMap((m) => m.slots.filter((s): s is CardSlot => !!s).map(itemKey)));
    for (const item of ALL_BATTLE_ITEMS) expect(onWheel.has(item) || onCards.has(item), item).toBe(true);
  });

  it('the wheel fits a 390 x 844 phone and its items do not overlap (50 px items)', () => {
    expect(wheel.inner.length).toBeLessThanOrEqual(10);
    expect(wheel.outer.length).toBeLessThanOrEqual(14);
    const minGap = (n: number, r: number): number => {
      const pos = ringPositions(n, r);
      let g = Infinity;
      for (let i = 0; i < n; i++) {
        const a = pos[i]!;
        const b = pos[(i + 1) % n]!;
        g = Math.min(g, Math.hypot(a.x - b.x, a.y - b.y));
      }
      return g;
    };
    expect(minGap(wheel.inner.length, RADIAL_INNER_R)).toBeGreaterThanOrEqual(56);
    expect(minGap(wheel.outer.length, RADIAL_OUTER_R)).toBeGreaterThanOrEqual(56);
    expect(RADIAL_OUTER_R - RADIAL_INNER_R).toBeGreaterThanOrEqual(56);
    for (const [w, h] of [
      [390, 844],
      [844, 390],
    ] as const) {
      for (const [x, y] of [
        [0, 0],
        [w, h],
        [w / 2, h / 2],
      ]) {
        const c = clampWheel(x, y, w, h);
        expect(c.x - RADIAL_EXTENT).toBeGreaterThanOrEqual(0);
        expect(c.x + RADIAL_EXTENT).toBeLessThanOrEqual(w);
        expect(c.y - RADIAL_EXTENT).toBeGreaterThanOrEqual(0);
        expect(c.y + RADIAL_EXTENT).toBeLessThanOrEqual(h);
      }
    }
  });
});

describe('world card: keyboard reachability', () => {
  const world = campaign(7);
  const me = world.playerFactionId;
  const cap = world.factions[me]!.capitalSettlementId!;
  const army = Object.keys(world.armies)
    .sort()
    .find((id) => world.armies[id]!.factionId === me)!;
  for (const preset of PRESETS) {
    it(`${preset}: every settlement tab slot and army order has a working key; Tab cycles the tabs`, () => {
      const scope: BindingScope = { context: 'world' };
      const table = buildChordTable(preset, scope);
      expect(resolveChord(table, parseChord('Tab')!)).toContain('card_next_tab');
      const models = [...SETTLEMENT_TABS.map((t) => settlementCard(world, cap, t.id, { preset, overrides: {} })), armyCard(world, army, { preset, overrides: {} })];
      for (const m of models)
        for (const s of m.slots) {
          if (!s) continue;
          expect(keyFor(preset, scope, s), `${preset} ${m.kind}/${m.tab} slot ${s.slot} (${s.id}) key ${s.hotkey}`).not.toBeNull();
        }
    });
  }
});
