/**
 * Tiny DOM helpers (no framework). OWNER: Lead UI/UX Engineer. Baseline by the CTO.
 *   h('div', { class: 'panel', onclick: fn }, 'text', child)
 */
type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown> & { class?: string; style?: Partial<CSSStyleDeclaration> | string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style') {
        if (typeof v === 'string') el.setAttribute('style', v);
        else Object.assign(el.style, v);
      } else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k === 'dataset' && typeof v === 'object') {
        Object.assign(el.dataset, v);
      } else if (k in el && typeof v !== 'string') {
        (el as unknown as Record<string, unknown>)[k] = v;
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  append(el, ...children);
  return el;
}

export function append(el: HTMLElement, ...children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Replace children only when the rendered key changes (cheap periodic HUD refresh). */
export function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-IN');
}

export function fmtPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** Stop pointer/wheel events from reaching the game canvas. */
export function shield(el: HTMLElement): HTMLElement {
  for (const ev of ['pointerdown', 'pointerup', 'wheel', 'contextmenu', 'click']) el.addEventListener(ev, (e) => e.stopPropagation());
  return el;
}
