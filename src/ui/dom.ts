/**
 * Tiny DOM helpers (no framework). OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 *
 *   h('div', { class: 'panel', onclick: fn }, 'text', child)      element factory (props, events, dataset, aria-*)
 *   svg('path', { d: '...' })                                       SVG element factory
 *   setText / setAttr / setStyle / setClass / setWidth              write only when the value changed (no thrash)
 *   syncList(container, items, key, create, update)                 keyed list reconciliation (reuses nodes)
 *   fmtInt / fmtPct / fmtSigned / fmtCompact / fmtDuration          number formatting (en-IN digit grouping)
 *   shield(el)                                                      stop pointer events reaching window handlers
 * Screens update at 4-10 Hz: every helper compares before writing so a steady HUD costs no style recalculation.
 */
type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown> & { class?: string; style?: Partial<CSSStyleDeclaration> | string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) applyProps(el, props);
  append(el, ...children);
  return el;
}

function applyProps(el: Element, props: Props): void {
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.setAttribute('class', String(v));
    else if (k === 'style') {
      if (typeof v === 'string') el.setAttribute('style', v);
      else Object.assign((el as HTMLElement).style, v);
    } else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'dataset' && typeof v === 'object') {
      Object.assign((el as HTMLElement).dataset, v);
    } else if (k in el && typeof v !== 'string' && !(el instanceof SVGElement)) {
      (el as unknown as Record<string, unknown>)[k] = v;
    } else {
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg<K extends keyof SVGElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  if (props) applyProps(el, props);
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}

export function append(el: Element, ...children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Replace text only when it changed (cheap periodic HUD refresh). */
export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

/** Inline style property write only on change (custom properties '--x' included). */
export function setStyle(el: HTMLElement | SVGElement, prop: string, value: string): void {
  const st = el.style;
  if (prop.startsWith('--')) {
    if (st.getPropertyValue(prop) !== value) st.setProperty(prop, value);
  } else if ((st as unknown as Record<string, string>)[prop] !== value) (st as unknown as Record<string, string>)[prop] = value;
}

export function setClass(el: Element, cls: string, on: boolean): void {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

/** Width as a percentage of 0..1 (meters). */
export function setWidth(el: HTMLElement, frac: number): void {
  const v = `${Math.round(Math.max(0, Math.min(1, frac)) * 1000) / 10}%`;
  setStyle(el, 'width', v);
}

export function setHidden(el: Element, hidden: boolean): void {
  setClass(el, 'ui-hidden', hidden);
}

/**
 * Keyed list reconciliation: keeps one node per key, creates missing ones, removes stale ones, keeps order and
 * calls update(node, item) for every item. Returns the nodes in item order.
 */
export function syncList<T, N extends Element>(container: Element, items: readonly T[], key: (item: T) => string, create: (item: T) => N, update: (node: N, item: T, index: number) => void): N[] {
  const store = (container as unknown as { __keyed?: Map<string, N> }).__keyed ?? new Map<string, N>();
  (container as unknown as { __keyed?: Map<string, N> }).__keyed = store;
  const seen = new Set<string>();
  const nodes: N[] = [];
  let i = 0;
  for (const item of items) {
    const k = key(item);
    seen.add(k);
    let node = store.get(k);
    if (!node) {
      node = create(item);
      store.set(k, node);
    }
    update(node, item, i);
    const at = container.children[i];
    if (at !== node) container.insertBefore(node, at ?? null);
    nodes.push(node);
    i++;
  }
  for (const [k, node] of store) {
    if (!seen.has(k)) {
      node.remove();
      store.delete(k);
    }
  }
  return nodes;
}

// ---------------------------------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------------------------------

const IN = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export function fmtInt(n: number): string {
  return IN.format(Math.round(n) || 0);
}

export function fmtPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** "+120", "-12", "0". */
export function fmtSigned(n: number, digits = 0): string {
  const r = digits > 0 ? Math.round(n * 10 ** digits) / 10 ** digits : Math.round(n);
  if (r === 0) return '0';
  const body = digits > 0 ? Math.abs(r).toFixed(digits) : IN.format(Math.abs(r));
  return `${r > 0 ? '+' : '-'}${body}`;
}

/** Compact Indian notation for tight HUD slots: 9,870 / 45.2k / 2.82L / 1.2Cr. */
export function fmtCompact(n: number): string {
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  if (a < 10_000) return `${s}${IN.format(Math.round(a))}`;
  if (a < 1_00_000) return `${s}${trimZero((a / 1000).toFixed(1))}k`;
  if (a < 1_00_00_000) return `${s}${trimZero((a / 1_00_000).toFixed(a < 10_00_000 ? 2 : 1))}L`;
  return `${s}${trimZero((a / 1_00_00_000).toFixed(1))}Cr`;
}

function trimZero(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** Seconds as m:ss (battle clock, cooldowns). */
export function fmtClock(sec: number): string {
  const t = Math.max(0, Math.floor(sec));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

/** Days as "12 days" / "1 day" / "2 mo" for long spans. */
export function fmtDays(d: number): string {
  if (!Number.isFinite(d)) return '∞';
  const r = Math.max(0, Math.round(d));
  if (r >= 120) return `${Math.round(r / 30)} months`;
  return r === 1 ? '1 day' : `${r} days`;
}

/** Title case for ids ('war_elephants' -> 'War elephants'). */
export function label(id: string): string {
  const s = id.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------------

/** Stop pointer/wheel events from reaching window-level game handlers (the canvas never sees UI events). */
export function shield(el: HTMLElement): HTMLElement {
  for (const ev of ['pointerdown', 'pointerup', 'wheel', 'contextmenu', 'click', 'dblclick']) el.addEventListener(ev, (e) => e.stopPropagation());
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  return el;
}

/** Long-press detector for touch + mouse (control-group assign, tooltips). Returns a disposer. */
export function onLongPress(el: HTMLElement, ms: number, fn: (e: PointerEvent) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fired = false;
  let sx = 0;
  let sy = 0;
  const cancel = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const down = (e: PointerEvent): void => {
    fired = false;
    sx = e.clientX;
    sy = e.clientY;
    cancel();
    timer = setTimeout(() => {
      fired = true;
      fn(e);
    }, ms);
  };
  const move = (e: PointerEvent): void => {
    if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel();
  };
  const click = (e: Event): void => {
    if (fired) {
      e.stopImmediatePropagation();
      e.preventDefault();
      fired = false;
    }
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('click', click, true);
  return () => {
    cancel();
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', cancel);
    el.removeEventListener('pointerleave', cancel);
    el.removeEventListener('pointercancel', cancel);
    el.removeEventListener('click', click, true);
  };
}

/** Clock of the UI throttles (performance.now; the QA bench in ui-debug swaps in a virtual 60 fps clock). */
export const uiClock = { now: (): number => performance.now() };

/**
 * Throttle gate for HUD selectors (scene pushes arrive at up to 10 Hz): true when `key` changed, or when `clock`
 * (sim hours / battle tick) moved and at least `ms` passed since the last true. Expensive selectors behind a gate run
 * at most 1000/ms times a second while the game runs, and not at all while it is paused and nothing changed.
 */
export function clockGate(ms: number): (key: string, clock: number) => boolean {
  let lastKey: string | null = null;
  let lastClock = Number.NaN;
  let at = Number.NEGATIVE_INFINITY;
  return (key, clock) => {
    const now = uiClock.now();
    if (key === lastKey && (clock === lastClock || now - at < ms)) return false;
    lastKey = key;
    lastClock = clock;
    at = now;
    return true;
  };
}
