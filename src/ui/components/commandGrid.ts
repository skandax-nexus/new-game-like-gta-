/**
 * AoE command card: tabs + 5 x 3 slot grid (DESIGN_SPEC §8.8, ART_BIBLE §11.5 `.btn.slot`). OWNER: UI Engineer -
 * In-game HUD, Command Card, Minimap & Input (UI-02). Renders a CardModel (ui/services/commandCards.ts); slots are
 * reused between updates (only changed attributes are written). Disabled slots stay focusable and tappable: a tap
 * shows why (tooltip) instead of doing nothing. Slots needing confirmation (disband) arm on the first press.
 */
import { h, setAttr, setClass, setHidden, setStyle, setText } from '../dom';
import type { CardModel, CardSlot } from '../services/commandCards';
import { CARD_SLOTS } from '../services/commandCards';
import { icon, setIcon } from './icons';
import { tabs, type Tabs } from './widgets';
import type { TooltipContent, TooltipService } from './tooltip';

export interface CommandGridOptions {
  tooltips: TooltipService;
  onActivate(slot: CardSlot, shift: boolean): void;
  onTab(tab: string): void;
  /** A disabled slot was pressed (play the error cue). */
  onRefused?(slot: CardSlot): void;
  /** Show the title / subtitle header row. */
  header?: boolean;
}

interface SlotView {
  btn: HTMLButtonElement;
  icon: HTMLElement;
  label: HTMLElement;
  kbd: HTMLElement;
  badge: HTMLElement;
  progress: HTMLElement;
  model: CardSlot | null;
}

export function slotTooltip(s: CardSlot): TooltipContent {
  const rows = s.cost.map((c) => [c.label, c.value, c.short ? 'danger' : null] as const);
  return {
    title: s.name,
    icon: s.icon,
    text: s.description || undefined,
    rows,
    hint: s.reason ? s.reason : s.hotkey ? `Hotkey ${s.hotkey}${s.confirm ? ' - press twice' : ''}` : undefined,
    hintTone: s.reason ? 'danger' : null,
  };
}

export class CommandGrid {
  readonly el: HTMLElement;
  private readonly tabsView: Tabs;
  private readonly title: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly head: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly views: SlotView[] = [];
  private model: CardModel | null = null;
  private armed: { slot: number; until: number } | null = null;

  constructor(private readonly o: CommandGridOptions) {
    this.tabsView = tabs((id) => o.onTab(id), 'card-tabs');
    this.title = h('div', { class: 'card-title' });
    this.subtitle = h('div', { class: 'card-sub' });
    this.head = h('div', { class: 'card-head' }, this.title, this.subtitle);
    this.grid = h('div', { class: 'card-grid', role: 'toolbar', 'aria-label': 'Command card' });
    for (let i = 0; i < CARD_SLOTS; i++) this.views.push(this.makeSlot(i));
    this.el = h('div', { class: 'command-card', dataset: { anchor: 'command-card' } }, o.header === false ? null : this.head, this.tabsView.el, this.grid);
  }

  private makeSlot(i: number): SlotView {
    const ic = icon('info');
    const lbl = h('span', { class: 'slot-label' });
    const kbd = h('kbd', { class: 'kbd' });
    const badge = h('span', { class: 'badge slot-badge ui-hidden' });
    const progress = h('i', { class: 'slot-progress ui-hidden' });
    const btn = h('button', { class: 'btn slot', type: 'button', dataset: { slot: String(i) } }, ic, lbl, kbd, badge, progress);
    const v: SlotView = { btn, icon: ic, label: lbl, kbd, badge, progress, model: null };
    btn.addEventListener('click', (e) => {
      const m = v.model;
      if (!m) return;
      this.press(m, e.shiftKey, btn);
    });
    this.o.tooltips.attach(btn, () => (v.model ? slotTooltip(v.model) : null));
    this.grid.appendChild(btn);
    return v;
  }

  private press(m: CardSlot, shift: boolean, btn: HTMLElement): void {
    if (!m.enabled) {
      this.o.tooltips.open(btn, slotTooltip(m), true);
      this.o.onRefused?.(m);
      return;
    }
    if (m.confirm) {
      const now = Date.now();
      if (!this.armed || this.armed.slot !== m.slot || now > this.armed.until) {
        this.armed = { slot: m.slot, until: now + 3000 };
        setClass(btn, 'armed', true);
        setText(this.views[m.slot]!.label, 'Confirm?');
        setTimeout(() => {
          if (this.armed?.slot === m.slot) {
            this.armed = null;
            setClass(btn, 'armed', false);
            setText(this.views[m.slot]!.label, m.label);
          }
        }, 3000);
        return;
      }
      this.armed = null;
      setClass(btn, 'armed', false);
    }
    setClass(btn, 'flash', false);
    void btn.offsetWidth;
    setClass(btn, 'flash', true);
    this.o.onActivate(m, shift);
  }

  /** Activate slot n as if pressed (hotkeys); returns false when empty. */
  activate(n: number, shift = false): boolean {
    const v = this.views[n];
    if (!v?.model) return false;
    this.press(v.model, shift, v.btn);
    return true;
  }

  get current(): CardModel | null {
    return this.model;
  }

  set(model: CardModel): void {
    this.model = model;
    setText(this.title, model.title);
    setText(this.subtitle, model.subtitle);
    setHidden(this.tabsView.el, model.tabs.length <= 1);
    this.tabsView.set(
      model.tabs.map((t) => ({ id: t.id, label: t.label, icon: t.icon, badge: t.badge })),
      model.tab,
    );
    for (let i = 0; i < CARD_SLOTS; i++) {
      const v = this.views[i]!;
      const m = model.slots[i] ?? null;
      v.model = m;
      const b = v.btn;
      setClass(b, 'empty', !m);
      if (!m) {
        setText(v.label, '');
        setText(v.kbd, '');
        setHidden(v.kbd, true);
        setHidden(v.badge, true);
        setHidden(v.progress, true);
        setClass(b, 'disabled', true);
        setClass(b, 'active', false);
        setAttr(b, 'aria-disabled', 'true');
        setAttr(b, 'aria-label', 'Empty slot');
        setAttr(b, 'tabindex', '-1');
        setIcon(v.icon, 'more');
        continue;
      }
      setIcon(v.icon, m.icon);
      if (!(this.armed && this.armed.slot === i)) setText(v.label, m.label);
      setText(v.kbd, m.hotkey);
      setHidden(v.kbd, !m.hotkey);
      setText(v.badge, m.badge ?? '');
      setHidden(v.badge, !m.badge);
      setHidden(v.progress, m.progress === null);
      if (m.progress !== null) setStyle(v.progress, 'width', `${Math.round(m.progress * 100)}%`);
      setClass(b, 'disabled', !m.enabled);
      setClass(b, 'active', m.active);
      setAttr(b, 'aria-disabled', m.enabled ? null : 'true');
      setAttr(b, 'aria-pressed', m.active ? 'true' : null);
      setAttr(b, 'aria-label', `${m.name}${m.hotkey ? ` (${m.hotkey})` : ''}${m.reason ? ` - ${m.reason}` : ''}`);
      setAttr(b, 'tabindex', null);
      setAttr(b, 'data-id', m.id);
    }
  }
}
