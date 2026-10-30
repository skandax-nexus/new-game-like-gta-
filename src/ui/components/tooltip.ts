/**
 * Tooltips: hover (pointer, 280 ms) and keyboard focus on PC; tap-and-hold (450 ms) on touch, closed by the next tap
 * anywhere (DESIGN_SPEC §12.3: no hover-only information). OWNER: UI Engineer - In-game HUD, Command Card, Minimap &
 * Input (UI-02). One reusable `.tooltip` element (theme.css skin) in the UIManager's tooltip layer.
 *
 *   const off = ui.tooltips.attach(el, () => ({ title: 'Granary', icon: 'b_granary', rows: [['Wealth', '200']] }));
 * Providers run when the tooltip opens, so costs and reasons are always current.
 */
import { append, clear, h, onLongPress, setStyle } from '../dom';
import { icon } from './icons';

export type Tone = 'positive' | 'danger' | 'warning' | 'muted' | null;

export interface TooltipContent {
  title?: string;
  icon?: string;
  iconClass?: string;
  /** Label / value rows (value tinted by tone). */
  rows?: readonly (readonly [string, string, Tone?])[];
  /** Free text paragraph. */
  text?: string;
  /** Footer hint ("Why is this red?", hotkey, disabled reason). */
  hint?: string;
  /** Hint tone (danger = disabled reason). */
  hintTone?: Tone;
}

export type TooltipProvider = () => TooltipContent | null;

export class TooltipService {
  private readonly el: HTMLElement;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private anchor: HTMLElement | null = null;
  private touchOpen = false;
  /** UI scale of the layer (tooltip coordinates are divided by it). */
  scale = 1;

  constructor(private readonly layer: HTMLElement) {
    this.el = h('div', { class: 'tooltip ui-hidden', role: 'tooltip' });
    layer.appendChild(this.el);
    if (typeof document !== 'undefined') {
      document.addEventListener(
        'pointerdown',
        (e) => {
          if (this.touchOpen && !(e.target instanceof Node && this.anchor?.contains(e.target))) this.hide();
        },
        true,
      );
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this.hide();
      });
    }
  }

  /** Attach a provider to an element; returns the detach function. */
  attach(el: HTMLElement, provider: TooltipProvider): () => void {
    const enter = (e: PointerEvent): void => {
      if (e.pointerType !== 'mouse') return;
      this.cancel();
      this.timer = setTimeout(() => this.open(el, provider, false), 280);
    };
    const leave = (e: PointerEvent): void => {
      if (e.pointerType !== 'mouse') return;
      this.cancel();
      if (this.anchor === el && !this.touchOpen) this.hide();
    };
    const focus = (): void => {
      if (el.matches(':focus-visible')) this.open(el, provider, false);
    };
    const blur = (): void => {
      if (this.anchor === el && !this.touchOpen) this.hide();
    };
    const offLong = onLongPress(el, 450, (e) => {
      if (e.pointerType === 'mouse') return;
      this.open(el, provider, true);
    });
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('focus', focus);
    el.addEventListener('blur', blur);
    return () => {
      offLong();
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('focus', focus);
      el.removeEventListener('blur', blur);
      if (this.anchor === el) this.hide();
    };
  }

  /** Show content at an element right now (e.g. a disabled slot tapped: its reason). */
  open(el: HTMLElement, provider: TooltipProvider | TooltipContent, touch: boolean): void {
    this.cancel();
    const c = typeof provider === 'function' ? provider() : provider;
    if (!c) return;
    this.render(c);
    this.anchor = el;
    this.touchOpen = touch;
    this.el.classList.remove('ui-hidden');
    this.place(el.getBoundingClientRect());
  }

  hide(): void {
    this.cancel();
    this.anchor = null;
    this.touchOpen = false;
    this.el.classList.add('ui-hidden');
  }

  get visible(): boolean {
    return !this.el.classList.contains('ui-hidden');
  }

  private cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private render(c: TooltipContent): void {
    const el = this.el;
    clear(el);
    if (c.title) append(el, h('div', { class: 'tt-title' }, c.icon ? icon(c.icon, c.iconClass ?? '') : null, c.title));
    if (c.text) append(el, h('div', { class: 'tt-text' }, c.text));
    for (const [k, v, tone] of c.rows ?? []) append(el, h('div', { class: 'tt-row' }, h('span', null, k), h('b', { class: tone ?? '' }, v)));
    if (c.hint) append(el, h('div', { class: `tt-hint${c.hintTone ? ` ${c.hintTone}` : ''}` }, c.hint));
  }

  private place(r: DOMRect): void {
    const z = this.scale || 1;
    const vw = (typeof window !== 'undefined' ? window.innerWidth : 1280) / z;
    const vh = (typeof window !== 'undefined' ? window.innerHeight : 720) / z;
    const el = this.el;
    // Measure once (single read after the write above), then position.
    const w = el.offsetWidth;
    const hgt = el.offsetHeight;
    const ax = (r.left + r.width / 2) / z;
    const top = r.top / z;
    const bottom = r.bottom / z;
    let x = ax - w / 2;
    x = Math.max(8, Math.min(vw - w - 8, x));
    let y = top - hgt - 10;
    if (y < 8) y = Math.min(vh - hgt - 8, bottom + 10);
    setStyle(el, 'left', `${Math.round(x)}px`);
    setStyle(el, 'top', `${Math.round(y)}px`);
  }
}
