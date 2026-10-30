/**
 * HUD components on the DOM shim (./domShim.ts): CommandGrid renders a card model (15 slots, printed hotkeys, tabs),
 * explains disabled slots instead of acting, arms confirm slots; RadialWheel lays out and fires items and closes on
 * Esc without letting the key reach the game; syncList keeps nodes; meters and tabs reflect their state.
 * OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { installDom, ShimElement, ShimEvent } from './domShim';
import type { CardModel, CardSlot } from '../../../src/ui/services/commandCards';
import type { TooltipService } from '../../../src/ui/components/tooltip';

let dom: ReturnType<typeof installDom>;
beforeAll(() => {
  dom = installDom();
});
afterAll(() => dom.uninstall());

function stubTooltips(): TooltipService & { opened: unknown[] } {
  const opened: unknown[] = [];
  return { opened, attach: () => () => {}, open: (_el: unknown, c: unknown) => opened.push(c), hide: () => {} } as unknown as TooltipService & { opened: unknown[] };
}

function slot(i: number, over: Partial<CardSlot> = {}): CardSlot {
  return { slot: i, id: `s${i}`, label: `L${i}`, name: `Name ${i}`, icon: 'o_hold', hotkey: `Alt+${'QWERTASDFGZXCVB'[i]}`, enabled: true, reason: null, active: false, badge: null, progress: null, cost: [], description: '', confirm: false, command: { kind: 'none' }, ...over };
}

function model(slots: (CardSlot | null)[]): CardModel {
  return { kind: 'battle', title: 'T', subtitle: 'S', tabs: [{ id: 'orders', label: 'Orders', icon: 'o_attack', badge: null }, { id: 'shapes', label: 'Shapes', icon: 's_wedge', badge: 2 }], tab: 'orders', slots };
}

describe('CommandGrid', () => {
  it('renders 15 slots with labels, printed hotkeys, empty and disabled states', async () => {
    const { CommandGrid } = await import('../../../src/ui/components/commandGrid');
    const tips = stubTooltips();
    const onActivate = vi.fn();
    const g = new CommandGrid({ tooltips: tips, onActivate, onTab: () => {} });
    const slots = Array.from({ length: 15 }, (_, i) => (i === 14 ? null : slot(i, i === 3 ? { enabled: false, reason: 'Too exhausted to charge' } : {})));
    g.set(model(slots));
    const el = g.el as unknown as ShimElement;
    const btns = el.querySelectorAll('.btn.slot');
    expect(btns).toHaveLength(15);
    expect(btns[0]!.querySelector('.slot-label')!.textContent).toBe('L0');
    expect(btns[0]!.querySelector('kbd')!.textContent).toBe('Alt+Q');
    expect(btns[14]!.classList.contains('empty')).toBe(true);
    expect(btns[14]!.getAttribute('tabindex')).toBe('-1');
    expect(btns[3]!.classList.contains('disabled')).toBe(true);
    expect(btns[3]!.getAttribute('aria-label')).toContain('Too exhausted to charge');
    // Tabs: two, the active one marked, the badge shown.
    const tabs = el.querySelectorAll('.btn.tab');
    expect(tabs.map((t) => t.dataset.tab)).toEqual(['orders', 'shapes']);
    expect(tabs[0]!.classList.contains('active')).toBe(true);
    expect(tabs[1]!.querySelector('.badge')!.textContent).toBe('2');
  });

  it('a press activates; a disabled press explains why and does not act', async () => {
    const { CommandGrid } = await import('../../../src/ui/components/commandGrid');
    const tips = stubTooltips();
    const onActivate = vi.fn();
    const onRefused = vi.fn();
    const g = new CommandGrid({ tooltips: tips, onActivate, onTab: () => {}, onRefused });
    g.set(model([slot(0), slot(1, { enabled: false, reason: 'Select formations first' })]));
    const btns = (g.el as unknown as ShimElement).querySelectorAll('.btn.slot');
    btns[0]!.click({ shiftKey: true });
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate.mock.calls[0]![1]).toBe(true);
    btns[1]!.click();
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onRefused).toHaveBeenCalledTimes(1);
    expect(tips.opened).toHaveLength(1);
    expect((tips.opened[0] as { hint: string }).hint).toBe('Select formations first');
    // Hotkey path.
    expect(g.activate(0)).toBe(true);
    expect(g.activate(9)).toBe(false);
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('confirm slots arm on the first press and act on the second', async () => {
    const { CommandGrid } = await import('../../../src/ui/components/commandGrid');
    const onActivate = vi.fn();
    const g = new CommandGrid({ tooltips: stubTooltips(), onActivate, onTab: () => {} });
    g.set(model([slot(0, { confirm: true, label: 'Disband' })]));
    const b = (g.el as unknown as ShimElement).querySelectorAll('.btn.slot')[0]!;
    b.click();
    expect(onActivate).not.toHaveBeenCalled();
    expect(b.classList.contains('armed')).toBe(true);
    expect(b.querySelector('.slot-label')!.textContent).toBe('Confirm?');
    b.click();
    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});

describe('RadialWheel', () => {
  it('lays items on two rings, fires enabled items, refuses disabled ones', async () => {
    const { RadialWheel } = await import('../../../src/ui/screens/battle/radial');
    const onPick = vi.fn();
    const onRefused = vi.fn();
    const r = new RadialWheel(stubTooltips(), onPick, onRefused);
    r.show(10, 10, 390, 844, { inner: [slot(0), slot(1, { enabled: false, reason: 'No' })], outer: [slot(10), slot(11), slot(12)] });
    expect(r.isOpen).toBe(true);
    const el = r.el as unknown as ShimElement;
    expect(el.querySelectorAll('.radial-item.inner')).toHaveLength(2);
    expect(el.querySelectorAll('.radial-item.outer')).toHaveLength(3);
    // Clamped inside the phone: the ring centre moved off the corner.
    const ring = el.querySelector('.radial-ring')!;
    expect(parseFloat(String(ring.style.left))).toBeGreaterThanOrEqual(187);
    el.querySelectorAll('.radial-item.inner')[1]!.click();
    expect(onRefused).toHaveBeenCalledTimes(1);
    expect(r.isOpen).toBe(true);
    el.querySelectorAll('.radial-item.outer')[0]!.click();
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(r.isOpen).toBe(false);
  });

  it('Esc closes the wheel and is swallowed before the game input sees it', async () => {
    const { RadialWheel } = await import('../../../src/ui/screens/battle/radial');
    const r = new RadialWheel(stubTooltips(), () => {}, () => {});
    r.show(200, 400, 390, 844, { inner: [slot(0)], outer: [] });
    const win = (globalThis as unknown as { window: ShimElement }).window;
    // The game's InputManager listens on window (bubble phase); the key event targets the page body.
    const game = vi.fn();
    win.addEventListener('keydown', game);
    const ev = Object.assign(new ShimEvent('keydown', { bubbles: true }), { key: 'Escape' });
    dom.document.body.dispatchEvent(ev);
    expect(r.isOpen).toBe(false);
    expect(ev.defaultPrevented).toBe(true);
    expect(game).not.toHaveBeenCalled();
    // Closed: Esc reaches the game again.
    dom.document.body.dispatchEvent(Object.assign(new ShimEvent('keydown', { bubbles: true }), { key: 'Escape' }));
    expect(game).toHaveBeenCalledTimes(1);
  });
});

describe('dom helpers and widgets', () => {
  it('syncList reuses nodes by key and keeps item order', async () => {
    const { h, syncList } = await import('../../../src/ui/dom');
    const list = h('ul');
    const make = vi.fn((s: string) => h('li', null, s));
    const a = syncList(list, ['a', 'b', 'c'], (s) => s, make, () => {});
    const b = syncList(list, ['c', 'a'], (s) => s, make, () => {});
    expect(make).toHaveBeenCalledTimes(3);
    expect(b[0]).toBe(a[2]);
    expect(b[1]).toBe(a[0]);
    expect((list as unknown as ShimElement).children.map((n) => n.textContent)).toEqual(['c', 'a']);
  });

  it('meter fills and warns; tabs mark the active tab', async () => {
    const { meter, tabs } = await import('../../../src/ui/components/widgets');
    const m = meter('morale');
    m.set(0.35, { warn: true });
    const el = m.el as unknown as ShimElement;
    expect(el.classList.contains('warn')).toBe(true);
    const fill = el.querySelector('i')!;
    expect(String(fill.style.width)).toBe('35%');
    const onSelect = vi.fn();
    const t = tabs(onSelect);
    t.set([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], 'b');
    const b = (t.el as unknown as ShimElement).querySelectorAll('.btn.tab');
    expect(b[1]!.classList.contains('active')).toBe(true);
    expect(b[1]!.getAttribute('aria-selected')).toBe('true');
    b[0]!.click();
    expect(onSelect).toHaveBeenCalledWith('a');
  });
});
