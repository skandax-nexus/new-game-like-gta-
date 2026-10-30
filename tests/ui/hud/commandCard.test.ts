/**
 * Command-card models (src/ui/services/commandCards.ts): slot mapping per selection (settlement tabs by
 * BuildingDef.category + commandSlot, recruit by UnitDef.commandSlot, army orders, battle pages) and hotkey labels per
 * key preset (Classic: Alt+letters on the world card, mnemonic letters in battle; Grid: bare letters).
 * OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 */
import { describe, expect, it } from 'vitest';
import { BUILDING_TYPES, UNIT_CLASSES } from '../../../src/core/types';
import { BUILDINGS } from '../../../src/data/buildings';
import { UNITS } from '../../../src/data/units';
import { armyCard, BATTLE_ORDER_SLOTS, BATTLE_PAGES, battleCard, battlePageIndex, CARD_SLOTS, INTENT_DEFS, nextBattlePage, nextSettlementTab, settlementCard, SETTLEMENT_TABS, slotForAction, type CardModel } from '../../../src/ui/services/commandCards';
import { ICON_IDS } from '../../../src/ui/components/icons';
import { campaign } from '../../sim/strategic/helpers';
import { testBattle } from '../../sim/tactical/helpers';

const CLASSIC = { preset: 'classic' as const, overrides: {} };
const GRID = { preset: 'grid' as const, overrides: {} };
const LETTERS = ['Q', 'W', 'E', 'R', 'T', 'A', 'S', 'D', 'F', 'G', 'Z', 'X', 'C', 'V', 'B'];

const world = campaign(7);
const me = world.playerFactionId;
const capital = world.factions[me]!.capitalSettlementId!;
const enemyTown = Object.keys(world.settlements)
  .sort()
  .find((id) => world.settlements[id]!.ownerFactionId !== me && world.settlements[id]!.ownerFactionId !== null)!;
const myArmy = Object.keys(world.armies)
  .sort()
  .find((id) => world.armies[id]!.factionId === me)!;

function iconsKnown(m: CardModel): string[] {
  return m.slots.filter((s) => s && !ICON_IDS.has(s.icon)).map((s) => `${s!.id}:${s!.icon}`);
}

describe('settlement card', () => {
  it('maps every building of a tab to its BuildingDef.commandSlot', () => {
    for (const tab of SETTLEMENT_TABS.filter((t) => t.id !== 'recruit')) {
      const m = settlementCard(world, capital, tab.id, CLASSIC);
      expect(m.kind).toBe('settlement');
      expect(m.tab).toBe(tab.id);
      expect(m.slots).toHaveLength(CARD_SLOTS);
      for (const b of BUILDING_TYPES) {
        const def = BUILDINGS[b];
        if ((def.category ?? 'economy') !== tab.id || def.commandSlot === undefined) continue;
        const sl = m.slots[def.commandSlot];
        expect(sl, `${tab.id}: ${b} at slot ${def.commandSlot}`).toBeTruthy();
        expect(sl!.id).toBe(`build:${b}`);
        expect(sl!.slot).toBe(def.commandSlot);
        // Disabled slots always explain themselves.
        if (!sl!.enabled) expect(sl!.reason).toBeTruthy();
      }
      expect(iconsKnown(m)).toEqual([]);
    }
  });

  it('economy tab: Treasury (slot 13) and Trade (slot 14) open the economy panel and the market', () => {
    const m = settlementCard(world, capital, 'economy', CLASSIC);
    expect(m.slots[13]!.command).toEqual({ kind: 'screen', screen: 'economy_panel' });
    expect(m.slots[14]!.command).toEqual({ kind: 'screen', screen: 'market' });
  });

  it('civic tab: Visit (13) and Ages (14)', () => {
    const m = settlementCard(world, capital, 'civic', CLASSIC);
    expect(m.slots[13]!.command).toEqual({ kind: 'visit', settlementId: capital });
    expect(m.slots[14]!.command).toEqual({ kind: 'screen', screen: 'age_panel' });
  });

  it('new buildings go to the placement ghost (HUD command), upgrades to the sim', () => {
    const m = settlementCard(world, capital, 'economy', CLASSIC);
    const s = world.settlements[capital]!;
    for (const sl of m.slots) {
      if (!sl || !sl.id.startsWith('build:')) continue;
      const b = sl.id.slice(6) as (typeof BUILDING_TYPES)[number];
      const have = s.buildings.some((x) => x.type === b);
      if (have) expect(sl.command.kind).toBe('strategic');
      else if (BUILDINGS[b].footprint?.placement !== 'perimeter') expect(sl.command).toMatchObject({ kind: 'hud', cmd: { kind: 'place_building', settlementId: capital, building: b } });
    }
  });

  it('recruit tab: every unit at its UnitDef.commandSlot, the rally point at slot 14', () => {
    const m = settlementCard(world, capital, 'recruit', CLASSIC);
    for (const cls of UNIT_CLASSES) {
      const slot = UNITS[cls].commandSlot;
      if (slot === undefined) continue;
      expect(m.slots[slot]!.id).toBe(`recruit:${cls}`);
      expect(m.slots[slot]!.command).toMatchObject({ kind: 'strategic', cmd: { kind: 'recruit', settlementId: capital, unitClass: cls } });
    }
    expect(m.slots[14]!.command).toEqual({ kind: 'hud', cmd: { kind: 'rally_point_target', settlementId: capital } });
    expect(iconsKnown(m)).toEqual([]);
  });

  it('a foreign settlement shows no tabs and no commands', () => {
    const m = settlementCard(world, enemyTown, 'economy', CLASSIC);
    expect(m.tabs).toEqual([]);
    expect(m.slots.every((s) => s === null)).toBe(true);
  });

  it('hotkey labels follow the preset: Classic Alt+Q..B, Grid Q..B', () => {
    const c = settlementCard(world, capital, 'recruit', CLASSIC);
    const g = settlementCard(world, capital, 'recruit', GRID);
    c.slots.forEach((s, i) => s && expect(s.hotkey).toBe(`Alt+${LETTERS[i]}`));
    g.slots.forEach((s, i) => s && expect(s.hotkey).toBe(LETTERS[i]));
  });

  it('Tab cycles the five tabs', () => {
    let t = 'economy';
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      seen.push(t);
      t = nextSettlementTab(t);
    }
    expect(seen).toEqual(SETTLEMENT_TABS.map((x) => x.id));
    expect(t).toBe('economy');
  });
});

describe('army card', () => {
  it('fixed order layout: move, attack, besiege, garrison, raid, forage, retreat, stances, forced, split, merge, disband, visit', () => {
    const m = armyCard(world, myArmy, CLASSIC);
    const ids = m.slots.map((s) => s?.id ?? null);
    expect(ids.slice(0, 7)).toEqual(['army:move', 'army:attack', 'army:besiege', 'army:garrison', 'army:raid', 'army:forage', 'army:retreat']);
    expect(ids.slice(7, 10)).toEqual(['stance:aggressive', 'stance:balanced', 'stance:cautious']);
    expect(ids.slice(10)).toEqual(['army:forced_march', 'army:split', 'army:merge', 'army:disband', 'army:visit']);
    expect(m.slots[13]!.confirm).toBe(true);
    expect(m.slots[0]!.command).toEqual({ kind: 'hud', cmd: { kind: 'army_target', armyIds: [myArmy], order: 'move' } });
    // The current stance is shown active (and not re-issuable).
    const st = world.armies[myArmy]!.stance;
    const cur = m.slots.find((s) => s?.id === `stance:${st}`)!;
    expect(cur.active).toBe(true);
    expect(iconsKnown(m)).toEqual([]);
  });

  it('another realm\'s army: every order explains "Not your army"', () => {
    const foreign = Object.keys(world.armies)
      .sort()
      .find((id) => world.armies[id]!.factionId !== me)!;
    const m = armyCard(world, foreign, CLASSIC);
    for (const s of m.slots) if (s) expect(s.enabled).toBe(false);
    expect(m.slots[0]!.reason).toBe('Not your army');
  });
});

describe('battle card', () => {
  const tb = testBattle({
    factions: ['heartland', 'highland'],
    sides: [
      [
        { cls: 'spearmen', x: -40, z: 100 },
        { cls: 'archers', x: 40, z: 120 },
        { cls: 'cavalry', x: 120, z: 100 },
      ],
      [{ cls: 'spearmen', x: 0, z: -100 }],
    ],
  });
  const b = tb.state;
  const own = b.formations.filter((f) => f.side === 0).map((f) => f.index);

  it('orders page: the 15 slots follow BATTLE_ORDER_SLOTS; nothing selected = disabled with a reason', () => {
    const empty = battleCard(b, 0, [], 'orders', CLASSIC);
    BATTLE_ORDER_SLOTS.forEach((d, i) => {
      expect(empty.slots[i]!.command).toEqual({ kind: 'input', action: d!.action });
      expect(empty.slots[i]!.enabled).toBe(false);
      expect(empty.slots[i]!.reason).toBe('Select formations first');
    });
    const sel = battleCard(b, 0, own, 'orders', CLASSIC);
    expect(sel.slots[0]!.enabled).toBe(true);
    expect(sel.title).toBe('3 formations');
    expect(iconsKnown(sel)).toEqual([]);
  });

  it('shapes page: five shapes + circle, four stances on the bottom row', () => {
    const m = battleCard(b, 0, own, 'shapes', CLASSIC);
    expect(m.slots.slice(0, 6).map((s) => s!.id)).toEqual(['shape:line', 'shape:column', 'shape:square', 'shape:wedge', 'shape:loose', 'shape:circle']);
    expect(m.slots.slice(10, 14).map((s) => s!.id)).toEqual(['stance:aggressive', 'stance:defensive', 'stance:skirmish', 'stance:hold_fire']);
    expect(m.slots[10]!.command).toEqual({ kind: 'battle', cmd: { kind: 'set_stance', formations: own, stance: 'aggressive' } });
  });

  it('intents page: the eight intents + clear; pursue needs horse, targeted intents ask the scene', () => {
    const m = battleCard(b, 0, own, 'intents', CLASSIC);
    INTENT_DEFS.forEach((d, i) => expect(m.slots[i]!.id).toBe(`intent:${d.intent}`));
    expect(m.slots[9]!.id).toBe('intent:clear');
    expect(m.slots[0]!.command).toEqual({ kind: 'hud', cmd: { kind: 'battle_target', formations: own, intent: 'hold_crossing' } });
    const spearOnly = battleCard(b, 0, [own[0]!], 'intents', CLASSIC);
    expect(spearOnly.slots[5]!.reason).toBe('Only horse, chariots and scouts pursue');
    expect(m.slots[5]!.enabled).toBe(true);
    expect(iconsKnown(m)).toEqual([]);
  });

  it('hotkeys: Classic mnemonic letters on the orders page, Grid letters on every page', () => {
    const c = battleCard(b, 0, own, 'orders', CLASSIC);
    expect(c.slots.slice(0, 10).map((s) => s!.hotkey)).toEqual(['H', 'T', 'X', 'C', 'Y', 'U', 'B', 'G', 'N', 'M']);
    expect(c.slots.slice(10).map((s) => s!.hotkey)).toEqual(['J', 'I', 'O', 'P', 'K']);
    for (const page of BATTLE_PAGES.map((p) => p.id)) {
      const g = battleCard(b, 0, own, page, GRID);
      g.slots.forEach((s, i) => {
        if (!s) return;
        expect(s.hotkey, `${page} slot ${i}`).toBe(LETTERS[i]);
      });
    }
    // Classic intents / shapes pages: Alt+letters (no mnemonic letter for intents).
    const ci = battleCard(b, 0, own, 'intents', CLASSIC);
    ci.slots.forEach((s, i) => s && expect(s.hotkey).toBe(`Alt+${LETTERS[i]}`));
  });

  it('pages cycle with Tab and map to input card pages', () => {
    expect(nextBattlePage('orders')).toBe('shapes');
    expect(nextBattlePage('shapes')).toBe('intents');
    expect(nextBattlePage('intents')).toBe('orders');
    expect(BATTLE_PAGES.map((p) => battlePageIndex(p.id))).toEqual([0, 1, 2]);
  });

  it('slotForAction resolves card_slot_N actions', () => {
    const m = battleCard(b, 0, own, 'intents', CLASSIC);
    expect(slotForAction(m, 'card_slot_3')!.id).toBe('intent:pin_enemy');
    expect(slotForAction(m, 'order_hold')).toBeNull();
  });
});
