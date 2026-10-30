/**
 * Minimal DOM shim for HUD component tests in Vitest's node environment (no jsdom dependency).
 * OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 *
 * Covers what src/ui/dom.ts h() / syncList and the HUD components use: elements (attributes, class list, dataset,
 * inline style with custom properties, children, text), text nodes, events (listeners, dispatch, bubbling, click()),
 * simple selectors (tag, .class, [attr], [attr="v"], compound, descendant) for querySelector / closest, and a few
 * globals (document, window, SVGElement, requestAnimationFrame, performance). installDom() returns the uninstall.
 */

type Listener = (e: ShimEvent) => void;

export class ShimEvent {
  defaultPrevented = false;
  propagationStopped = false;
  immediateStopped = false;
  target: ShimNode | null = null;
  currentTarget: ShimNode | null = null;
  shiftKey = false;
  constructor(
    readonly type: string,
    init: { bubbles?: boolean; shiftKey?: boolean } = {},
  ) {
    this.bubbles = init.bubbles ?? false;
    this.shiftKey = init.shiftKey ?? false;
  }
  readonly bubbles: boolean;
  preventDefault(): void {
    this.defaultPrevented = true;
  }
  stopPropagation(): void {
    this.propagationStopped = true;
  }
  stopImmediatePropagation(): void {
    this.propagationStopped = true;
    this.immediateStopped = true;
  }
}

export class ShimNode {
  parentNode: ShimElement | null = null;
  readonly childNodes: ShimNode[] = [];
  private listeners = new Map<string, { fn: Listener; capture: boolean }[]>();
  readonly nodeType: number = 1;

  get parentElement(): ShimElement | null {
    return this.parentNode;
  }
  get firstChild(): ShimNode | null {
    return this.childNodes[0] ?? null;
  }
  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(v: string) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes.length = 0;
    if (v) this.appendChild(new ShimText(v));
  }
  appendChild<T extends ShimNode>(c: T): T {
    return this.insertBefore(c, null);
  }
  append(...cs: (ShimNode | string)[]): void {
    for (const c of cs) this.appendChild(typeof c === 'string' ? new ShimText(c) : c);
  }
  insertBefore<T extends ShimNode>(c: T, ref: ShimNode | null): T {
    if (c.parentNode) c.parentNode.removeChild(c);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i >= 0) this.childNodes.splice(i, 0, c);
    else this.childNodes.push(c);
    c.parentNode = this as unknown as ShimElement;
    return c;
  }
  removeChild<T extends ShimNode>(c: T): T {
    const i = this.childNodes.indexOf(c);
    if (i >= 0) this.childNodes.splice(i, 1);
    c.parentNode = null;
    return c;
  }
  remove(): void {
    this.parentNode?.removeChild(this);
  }
  addEventListener(type: string, fn: Listener, opts?: boolean | { capture?: boolean }): void {
    const capture = typeof opts === 'boolean' ? opts : !!opts?.capture;
    const l = this.listeners.get(type) ?? [];
    l.push({ fn, capture });
    this.listeners.set(type, l);
  }
  removeEventListener(type: string, fn: Listener, opts?: boolean | { capture?: boolean }): void {
    const capture = typeof opts === 'boolean' ? opts : !!opts?.capture;
    const l = this.listeners.get(type);
    if (l) this.listeners.set(type, l.filter((x) => x.fn !== fn || x.capture !== capture));
  }
  private fire(e: ShimEvent, phase: 'capture' | 'target' | 'bubble'): void {
    e.currentTarget = this;
    for (const l of [...(this.listeners.get(e.type) ?? [])]) {
      if (phase === 'capture' && !l.capture) continue;
      if (phase === 'bubble' && l.capture) continue;
      l.fn(e);
      if (e.immediateStopped) return;
    }
  }
  /** DOM dispatch: capture (root -> parent), target, bubble (parent -> root) when the event bubbles. */
  dispatchEvent(e: ShimEvent): boolean {
    e.target ??= this;
    const path: ShimNode[] = [];
    for (let n = this.parentNode as ShimNode | null; n; n = n.parentNode) path.push(n);
    for (let i = path.length - 1; i >= 0 && !e.propagationStopped; i--) path[i]!.fire(e, 'capture');
    if (!e.propagationStopped) this.fire(e, 'target');
    if (e.bubbles) for (let i = 0; i < path.length && !e.propagationStopped; i++) path[i]!.fire(e, 'bubble');
    return !e.defaultPrevented;
  }
}

export class ShimText extends ShimNode {
  override readonly nodeType = 3;
  constructor(public data: string) {
    super();
  }
  override get textContent(): string {
    return this.data;
  }
  override set textContent(v: string) {
    this.data = v;
  }
}

class ClassList {
  constructor(private readonly el: ShimElement) {}
  private get list(): string[] {
    return (this.el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
  }
  private write(l: string[]): void {
    this.el.setAttribute('class', l.join(' '));
  }
  contains(c: string): boolean {
    return this.list.includes(c);
  }
  add(...cs: string[]): void {
    const l = this.list;
    for (const c of cs) if (!l.includes(c)) l.push(c);
    this.write(l);
  }
  remove(...cs: string[]): void {
    this.write(this.list.filter((c) => !cs.includes(c)));
  }
  toggle(c: string, force?: boolean): boolean {
    const on = force ?? !this.contains(c);
    if (on) this.add(c);
    else this.remove(c);
    return on;
  }
  [Symbol.iterator](): Iterator<string> {
    return this.list[Symbol.iterator]();
  }
}

class Style {
  private readonly props = new Map<string, string>();
  [k: string]: unknown;
  setProperty(k: string, v: string): void {
    this.props.set(k, v);
  }
  getPropertyValue(k: string): string {
    return this.props.get(k) ?? '';
  }
  removeProperty(k: string): void {
    this.props.delete(k);
  }
}

export class ShimElement extends ShimNode {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly classList = new ClassList(this);
  readonly dataset: Record<string, string>;
  readonly style = new Style();
  disabled = false;
  type = '';
  value = '';
  constructor(tag: string) {
    super();
    this.tagName = tag.toUpperCase();
    const attrs = this.attributes;
    // dataset <-> data-* attributes (camelCase keys).
    this.dataset = new Proxy({} as Record<string, string>, {
      get: (_t, k: string) => attrs.get(`data-${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`),
      set: (_t, k: string, v: string) => (attrs.set(`data-${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`, String(v)), true),
      deleteProperty: (_t, k: string) => attrs.delete(`data-${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`),
      has: (_t, k: string) => attrs.has(`data-${String(k).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`),
    });
  }
  get className(): string {
    return this.getAttribute('class') ?? '';
  }
  set className(v: string) {
    this.setAttribute('class', v);
  }
  get children(): ShimElement[] {
    return this.childNodes.filter((c): c is ShimElement => c instanceof ShimElement);
  }
  get offsetWidth(): number {
    return 0;
  }
  get offsetHeight(): number {
    return 0;
  }
  get clientWidth(): number {
    return 0;
  }
  setAttribute(k: string, v: string): void {
    this.attributes.set(k, String(v));
  }
  getAttribute(k: string): string | null {
    return this.attributes.has(k) ? this.attributes.get(k)! : null;
  }
  hasAttribute(k: string): boolean {
    return this.attributes.has(k);
  }
  removeAttribute(k: string): void {
    this.attributes.delete(k);
  }
  getBoundingClientRect(): { left: number; top: number; right: number; bottom: number; width: number; height: number; x: number; y: number } {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
  }
  focus(): void {}
  blur(): void {}
  click(opts: { shiftKey?: boolean } = {}): void {
    if (this.disabled) return;
    this.dispatchEvent(new ShimEvent('click', { bubbles: true, shiftKey: opts.shiftKey }));
  }
  matches(sel: string): boolean {
    return sel.split(',').some((s) => matchChain(this, s.trim().split(/\s+/)));
  }
  closest(sel: string): ShimElement | null {
    for (let e: ShimElement | null = this; e; e = e.parentNode) if (e.matches(sel)) return e;
    return null;
  }
  querySelectorAll(sel: string): ShimElement[] {
    const out: ShimElement[] = [];
    const walk = (n: ShimElement): void => {
      for (const c of n.children) {
        if (c.matches(sel)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel: string): ShimElement | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
}

export class ShimSvgElement extends ShimElement {}

/** One compound selector: tag, .class, [attr], [attr="v"], :not(.x) (single simple selector). */
function matchSimple(el: ShimElement, sel: string): boolean {
  const re = /(:not\(([^)]+)\))|(\.[\w-]+)|(\[[^\]]+\])|(^[\w-]+|\*)/g;
  let m: RegExpExecArray | null;
  let consumed = '';
  while ((m = re.exec(sel))) {
    consumed += m[0];
    if (m[1]) {
      if (matchSimple(el, m[2]!)) return false;
    } else if (m[3]) {
      if (!el.classList.contains(m[3].slice(1))) return false;
    } else if (m[4]) {
      const body = m[4].slice(1, -1);
      const eq = body.indexOf('=');
      if (eq < 0) {
        if (!el.hasAttribute(body)) return false;
      } else {
        const k = body.slice(0, eq);
        const v = body.slice(eq + 1).replace(/^["']|["']$/g, '');
        if (el.getAttribute(k) !== v) return false;
      }
    } else if (m[5] && m[5] !== '*') {
      if (el.tagName !== m[5].toUpperCase()) return false;
    }
  }
  return consumed.length === sel.length;
}

function matchChain(el: ShimElement, parts: string[]): boolean {
  if (!parts.length) return true;
  if (!matchSimple(el, parts[parts.length - 1]!)) return false;
  const rest = parts.slice(0, -1);
  if (!rest.length) return true;
  for (let p = el.parentNode; p; p = p.parentNode) if (matchChain(p, rest)) return true;
  return false;
}

/** Install document / window / SVGElement globals; returns the uninstall function. */
export function installDom(): { document: { body: ShimElement }; uninstall: () => void } {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = new Map<string, unknown>();
  const set = (k: string, v: unknown): void => {
    saved.set(k, g[k]);
    g[k] = v;
  };
  const body = new ShimElement('body');
  const documentElement = new ShimElement('html');
  documentElement.appendChild(body);
  const doc = {
    body,
    documentElement,
    createElement: (t: string) => new ShimElement(t),
    createElementNS: (_ns: string, t: string) => new ShimSvgElement(t),
    createTextNode: (s: string) => new ShimText(s),
    querySelector: (s: string) => documentElement.querySelector(s),
    querySelectorAll: (s: string) => documentElement.querySelectorAll(s),
  };
  const win = new ShimElement('window');
  // window is the root of the event path (capture listeners on window run first, bubble listeners last).
  documentElement.parentNode = win;
  set('document', doc);
  set('window', Object.assign(win, { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 }));
  set('SVGElement', ShimSvgElement);
  set('HTMLElement', ShimElement);
  set('requestAnimationFrame', (fn: (t: number) => void) => setTimeout(() => fn(Date.now()), 0) as unknown as number);
  set('cancelAnimationFrame', (id: number) => clearTimeout(id));
  set('getComputedStyle', () => ({ getPropertyValue: () => '', fontFamily: 'sans-serif' }));
  return {
    document: doc,
    uninstall: () => {
      for (const [k, v] of saved) {
        if (v === undefined) delete g[k];
        else g[k] = v;
      }
    },
  };
}
