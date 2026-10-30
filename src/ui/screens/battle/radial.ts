/**
 * Touch radial command wheel (DESIGN_SPEC §8.8 touch): opened by a long-press on the battlefield; orders on the
 * inner ring, shapes and intents on the outer ring, cancel in the centre. Items are the battle command-card slots, so
 * disabled items explain themselves and activation shares runCardSlot with the card and the keyboard.
 * OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 */
import { h, setAttr, setClass, setStyle } from '../../dom';
import { icon } from '../../components/icons';
import type { CardModel, CardSlot } from '../../services/commandCards';
import type { TooltipService } from '../../components/tooltip';
import { slotTooltip } from '../../components/commandGrid';

export interface RadialItems {
  inner: readonly CardSlot[];
  outer: readonly CardSlot[];
}

/** Ring radii (CSS px): 10 inner items (50 px) and up to 14 outer items (50 px) keep >= 8 px gaps. */
export const RADIAL_INNER_R = 94;
export const RADIAL_OUTER_R = 160;
/** Half-size of the wheel incl. outer item radius (clamping on screen): 187 px fits a 390 px phone with no clip. */
export const RADIAL_EXTENT = RADIAL_OUTER_R + 27;

/**
 * Wheel items from the three battle card pages: the nine orders + stance on the inner ring, the six shapes and the
 * eight intents on the outer ring ("clear intent" stays on the card). Shared with tests (touch reachability).
 */
export function radialItemsFrom(orders: CardModel, shapes: CardModel, intents: CardModel): RadialItems {
  const pick = (m: CardModel, ok: (id: string) => boolean): CardSlot[] => m.slots.filter((s): s is CardSlot => !!s && ok(s.id));
  return {
    inner: pick(orders, (id) => id.startsWith('order:') && !id.startsWith('order:shape_')),
    outer: [...pick(shapes, (id) => id.startsWith('shape:')), ...pick(intents, (id) => id.startsWith('intent:') && id !== 'intent:clear')],
  };
}

/** Positions of n items on a ring starting at the top, clockwise (px offsets from the centre). */
export function ringPositions(n: number, r: number, start = -Math.PI / 2): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = start + (i / Math.max(1, n)) * Math.PI * 2;
    out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return out;
}

/** Clamp the wheel centre so the whole wheel stays inside a viewport of w x h (with a margin). */
export function clampWheel(x: number, y: number, w: number, hgt: number, margin = 8): { x: number; y: number } {
  const e = RADIAL_EXTENT + margin;
  return { x: Math.max(e, Math.min(w - e, x)), y: Math.max(e, Math.min(hgt - e, y)) };
}

export class RadialWheel {
  readonly el: HTMLElement;
  private readonly ring: HTMLElement;
  private open = false;

  constructor(
    private readonly tooltips: TooltipService,
    private readonly onPick: (slot: CardSlot) => void,
    private readonly onRefused: (slot: CardSlot) => void,
  ) {
    const cancel = h('button', { class: 'btn icon radial-center', type: 'button', 'aria-label': 'Close the wheel', onclick: () => this.close() }, icon('close'));
    this.ring = h('div', { class: 'radial-ring' }, h('div', { class: 'radial-disc outer' }), h('div', { class: 'radial-disc inner' }), cancel);
    this.el = h('div', { class: 'radial ui-hidden', role: 'menu', 'aria-label': 'Command wheel' }, this.ring);
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target === this.el) this.close();
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Open at (x, y) in layer CSS px; `vw` / `vh` = layer size for clamping. */
  show(x: number, y: number, vw: number, vh: number, items: RadialItems): void {
    for (const c of [...this.ring.querySelectorAll('.radial-item')]) c.remove();
    const add = (list: readonly CardSlot[], r: number, cls: string): void => {
      const pos = ringPositions(list.length, r);
      list.forEach((s, i) => {
        const b = h('button', { class: `radial-item ${cls}${s.enabled ? '' : ' disabled'}${s.active ? ' active' : ''}`, type: 'button', role: 'menuitem', 'aria-label': `${s.name}${s.reason ? ` - ${s.reason}` : ''}` }, icon(s.icon), h('span', null, s.label));
        setStyle(b, 'transform', `translate(${pos[i]!.x.toFixed(1)}px, ${pos[i]!.y.toFixed(1)}px)`);
        setAttr(b, 'aria-disabled', s.enabled ? null : 'true');
        b.addEventListener('click', () => {
          if (!s.enabled) {
            this.tooltips.open(b, slotTooltip(s), true);
            this.onRefused(s);
            return;
          }
          this.onPick(s);
          this.close();
        });
        this.tooltips.attach(b, () => slotTooltip(s));
        this.ring.appendChild(b);
      });
    };
    add(items.inner, RADIAL_INNER_R, 'inner');
    add(items.outer, RADIAL_OUTER_R, 'outer');
    const c = clampWheel(x, y, vw, vh);
    setStyle(this.ring, 'left', `${c.x}px`);
    setStyle(this.ring, 'top', `${c.y}px`);
    this.el.classList.remove('ui-hidden');
    if (!this.open && typeof window !== 'undefined') window.addEventListener('keydown', this.onKey, true);
    this.open = true;
    setClass(this.el, 'opening', true);
    requestAnimationFrame?.(() => setClass(this.el, 'opening', false));
  }

  close(): void {
    if (this.open && typeof window !== 'undefined') window.removeEventListener('keydown', this.onKey, true);
    this.open = false;
    this.el.classList.add('ui-hidden');
    this.tooltips.hide();
  }

  /** Esc closes the wheel only: swallowed before the game input sees it (no pause menu behind the wheel). */
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.close();
  };
}
