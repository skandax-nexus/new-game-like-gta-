/**
 * AoE command card: tabs + 5 x 3 slot grid (DESIGN_SPEC §8.8, ART_BIBLE §11.5 `.btn.slot`). OWNER: UI Engineer -
 * In-game HUD, Command Card, Minimap & Input (UI-02). Renders a CardModel (ui/services/commandCards.ts); slots are
 * reused between updates (only changed attributes are written). Disabled slots stay focusable and tappable: a tap
 * shows why (tooltip) instead of doing nothing. Slots needing confirmation (disband) arm on the first press.
 *
 * Slot grammar (ui_kit, Art Director review round 1): an 18 x 18 single-key chip top-right; when every hotkey of the
 * card shares a modifier (Classic world cards: Alt+Q..Alt+B) it is printed once, as a chip at the end of the tab row
 * (and in each tooltip); mixed pages print a one-glyph modifier in the chip (⇧K, ⌥Z) with a legend in the tab row.
 * The level badge sits top-left (4 px inset); the 28 px icon keeps 6 px clear of both. Compact slots (landscape
 * phones) print the caps code (SPR, GRN, ...) instead of the word.
 */
import { h, setAttr, setClass, setHidden, setStyle, setText } from '../dom';
import type { CardModel, CardSlot } from '../services/commandCards';
import { CARD_SLOTS, slotCode } from '../services/commandCards';
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
  text: HTMLElement;
  code: HTMLElement;
  kbd: HTMLElement;
  badge: HTMLElement;
  progress: HTMLElement;
  model: CardSlot | null;
}

const MOD_GLYPH: Readonly<Record<string, string>> = { Shift: '⇧', Alt: '⌥', Ctrl: '⌃', Meta: '⌘' };
const MOD_RE = /^((?:(?:Ctrl|Alt|Shift|Meta)\+)*)(.+)$/;

/** 'Alt+Q' -> { mod: 'Alt', key: 'Q' }; 'Ctrl+Shift+K' -> { mod: 'Ctrl+Shift', key: 'K' }; 'H' -> { mod: '', key: 'H' }. */
export function splitHotkey(label: string): { mod: string; key: string } {
  const m = MOD_RE.exec(label);
  if (!m) return { mod: '', key: label };
  return { mod: (m[1] ?? '').replace(/\+$/, ''), key: m[2] ?? '' };
}

/** One-glyph modifier prefix (mixed pages): 'Alt' -> '⌥', 'Ctrl+Shift' -> '⌃⇧'. */
export function modGlyphs(mod: string): string {
  return mod ? mod.split('+').map((m) => MOD_GLYPH[m] ?? m).join('') : '';
}

export interface ChipPlan {
  /** Chip text per slot ('' = none). */
  chips: string[];
  /** Tab-row chip: the shared modifier ('Alt'), a glyph legend ('⇧ Shift  ⌥ Alt') or ''. */
  mod: string;
  legend: boolean;
}

/** How a card prints its hotkeys (pure; tested). */
export function planChips(hotkeys: readonly (string | null | undefined)[]): ChipPlan {
  const parts = hotkeys.map((k) => (k ? splitHotkey(k) : null));
  const mods = new Set(parts.filter((p): p is { mod: string; key: string } => !!p).map((p) => p.mod));
  if (mods.size <= 1) {
    const mod = mods.size ? [...mods][0]! : '';
    return { chips: parts.map((p) => (p ? p.key : '')), mod: mod.replace(/\+/g, ' '), legend: false };
  }
  const used = new Set<string>();
  for (const m of mods) for (const x of m ? m.split('+') : []) used.add(x);
  return {
    chips: parts.map((p) => (p ? `${modGlyphs(p.mod)}${p.key}` : '')),
    mod: [...used].sort().map((m) => `${MOD_GLYPH[m] ?? ''} ${m}`).join('  '),
    legend: true,
  };
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
  private readonly modChip: HTMLElement;
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
    this.modChip = h('kbd', { class: 'kbd card-mod ui-hidden', 'aria-hidden': 'true' });
    const tabRow = h('div', { class: 'card-tabrow' }, this.tabsView.el, this.modChip);
    this.el = h('div', { class: 'command-card', dataset: { anchor: 'command-card' } }, o.header === false ? null : this.head, tabRow, this.grid);
  }

  private makeSlot(i: number): SlotView {
    const ic = icon('info');
    const text = h('span', { class: 'slot-text' });
    const code = h('span', { class: 'slot-code', 'aria-hidden': 'true' });
    const lbl = h('span', { class: 'slot-label' }, text, code);
    const kbd = h('kbd', { class: 'kbd' });
    const badge = h('span', { class: 'badge slot-badge ui-hidden' });
    const progress = h('i', { class: 'slot-progress ui-hidden' });
    const btn = h('button', { class: 'btn slot', type: 'button', dataset: { slot: String(i) } }, ic, lbl, kbd, badge, progress);
    const v: SlotView = { btn, icon: ic, label: lbl, text, code, kbd, badge, progress, model: null };
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
        setText(this.views[m.slot]!.text, 'Confirm?');
        setTimeout(() => {
          if (this.armed?.slot === m.slot) {
            this.armed = null;
            setClass(btn, 'armed', false);
            setText(this.views[m.slot]!.text, m.label);
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
    const plan = planChips(model.slots.map((m) => m?.hotkey));
    setText(this.modChip, plan.mod);
    setHidden(this.modChip, !plan.mod);
    setClass(this.modChip, 'legend', plan.legend);
    setAttr(this.modChip, 'title', plan.mod ? (plan.legend ? `Modifier keys: ${plan.mod}` : `Hold ${plan.mod} with the slot keys`) : null);
    for (let i = 0; i < CARD_SLOTS; i++) {
      const v = this.views[i]!;
      const m = model.slots[i] ?? null;
      v.model = m;
      const b = v.btn;
      setClass(b, 'empty', !m);
      if (!m) {
        setText(v.text, '');
        setText(v.code, '');
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
      if (!(this.armed && this.armed.slot === i)) setText(v.text, m.label);
      setText(v.code, slotCode(m));
      const chip = plan.chips[i] ?? '';
      setText(v.kbd, chip);
      setHidden(v.kbd, !chip);
      setClass(v.kbd, 'wide', chip.length > 1);
      setClass(b, 'has-badge', !!m.badge);
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
