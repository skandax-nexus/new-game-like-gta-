/**
 * Shared HUD widgets for UI-02 screens and UI-01: notched meter, faction chip + emblem, tabs, slider with steppers,
 * stepper, sparkline, portrait frame, ring progress, panel frame (drawer / bottom sheet / modal). OWNER: UI Engineer -
 * In-game HUD, Command Card, Minimap & Input (UI-02). Skins: theme.css (.meter, .faction-chip, .emblem, .btn.tab,
 * .badge, .kbd) + base.css (layout). Every widget returns its element plus small setters that write only on change.
 */
import type { FactionId } from '../../core/types';
import { FACTIONS } from '../../data/factions';
import { append, h, setAttr, setClass, setStyle, setText, setWidth, svg } from '../dom';
import { icon } from './icons';

// ---------------------------------------------------------------------------------------------------
// Meter (notched every 25%: shape coding, readable without colour)
// ---------------------------------------------------------------------------------------------------

export type MeterKind = 'strength' | 'morale' | 'fatigue' | 'hp' | 'stamina' | 'progress' | 'poise' | 'enemy';

export interface Meter {
  el: HTMLElement;
  set(frac: number, opts?: { warn?: boolean; ghost?: number }): void;
}

/** Notched meter; `ghost` shows a lighter trailing bar (recent loss, AoE damage trail). */
export function meter(kind: MeterKind, extraClass = ''): Meter {
  const fill = h('i');
  const ghost = h('b', { class: 'meter-ghost' });
  const el = h('div', { class: `meter ${kind}${extraClass ? ` ${extraClass}` : ''}`, role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100' }, ghost, fill);
  return {
    el,
    set(frac, opts) {
      const v = Math.max(0, Math.min(1, Number.isFinite(frac) ? frac : 0));
      setWidth(fill, v);
      setWidth(ghost, Math.max(v, opts?.ghost ?? v));
      setClass(el, 'warn', !!opts?.warn);
      setAttr(el, 'aria-valuenow', String(Math.round(v * 100)));
    },
  };
}

/** Row of pips (ammo, salve charges, level, patience): filled / empty with shape (not only colour). */
export function pips(max: number, cls = ''): { el: HTMLElement; set(n: number, max?: number): void } {
  const el = h('span', { class: `pips${cls ? ` ${cls}` : ''}`, role: 'img' });
  let cur = -1;
  let cap = -1;
  const set = (n: number, m = max): void => {
    if (n === cur && m === cap) return;
    if (m !== cap) {
      el.textContent = '';
      for (let i = 0; i < m; i++) el.appendChild(h('i'));
      cap = m;
    }
    cur = n;
    for (let i = 0; i < el.children.length; i++) setClass(el.children[i]!, 'on', i < n);
    setAttr(el, 'aria-label', `${n} of ${m}`);
  };
  set(0, max);
  return { el, set };
}

/** Circular cooldown / progress ring (SVG). frac = 0..1 filled. */
export function ringProgress(size = 56, stroke = 4): { el: SVGSVGElement; set(frac: number): void } {
  const r = size / 2 - stroke / 2 - 1;
  const circ = 2 * Math.PI * r;
  const bg = svg('circle', { cx: size / 2, cy: size / 2, r, class: 'ring-track', 'stroke-width': stroke, fill: 'none' });
  const fg = svg('circle', { cx: size / 2, cy: size / 2, r, class: 'ring-fill', 'stroke-width': stroke, fill: 'none', 'stroke-dasharray': `${circ} ${circ}`, transform: `rotate(-90 ${size / 2} ${size / 2})` });
  const el = svg('svg', { class: 'ring-progress', width: size, height: size, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true' }, bg, fg);
  let last = -1;
  return {
    el,
    set(frac) {
      const v = Math.round(Math.max(0, Math.min(1, frac)) * 200) / 200;
      if (v === last) return;
      last = v;
      fg.setAttribute('stroke-dashoffset', String(circ * (1 - v)));
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Faction chip + emblem (heraldry from data; colour-blind remaps through theme.css data-colorblind)
// ---------------------------------------------------------------------------------------------------

/** `.f-<faction id>` class of a faction (team colour token, theme.css) and its banner pattern. */
export function factionClass(id: FactionId | null): { cls: string; pattern: string } {
  const def = id ? FACTIONS[id] : undefined;
  if (!def) return { cls: id === 'rebels' ? 'f-rebels' : 'f-independent', pattern: id === 'rebels' ? 'tower' : 'lotus' };
  return { cls: `f-${def.id}`, pattern: def.banner === 'solid' ? 'lotus' : def.banner };
}

export function factionChip(id: FactionId | null, size: 'sm' | 'md' | 'lg' = 'md'): HTMLElement {
  const { cls, pattern } = factionClass(id);
  const name = id ? (FACTIONS[id]?.name ?? id) : 'Independent';
  return h('span', { class: `faction-chip ${cls} chip-${size}`, title: name, role: 'img', 'aria-label': name }, h('i', { class: `emblem emblem-${pattern}` }));
}

export function setFactionChip(el: HTMLElement, id: FactionId | null): void {
  if (el.dataset.faction === (id ?? '')) return;
  el.dataset.faction = id ?? '';
  const { cls, pattern } = factionClass(id);
  for (const c of [...el.classList]) if (c.startsWith('f-')) el.classList.remove(c);
  el.classList.add(cls);
  const em = el.firstElementChild as HTMLElement | null;
  if (em) em.className = `emblem emblem-${pattern}`;
  const name = id ? (FACTIONS[id]?.name ?? id) : 'Independent';
  setAttr(el, 'aria-label', name);
  setAttr(el, 'title', name);
}

// ---------------------------------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------------------------------

export interface TabItem {
  id: string;
  label: string;
  icon?: string;
  badge?: number | string | null;
  disabled?: boolean;
}

export interface Tabs {
  el: HTMLElement;
  set(items: readonly TabItem[], active: string): void;
}

export function tabs(onSelect: (id: string) => void, cls = ''): Tabs {
  const el = h('div', { class: `tabs${cls ? ` ${cls}` : ''}`, role: 'tablist' });
  let key = '';
  return {
    el,
    set(items, active) {
      const k = items.map((t) => `${t.id}:${t.label}:${t.badge ?? ''}:${t.disabled ? 1 : 0}`).join('|');
      if (k !== key) {
        key = k;
        el.textContent = '';
        for (const t of items) {
          const b = h(
            'button',
            { class: 'btn tab', type: 'button', role: 'tab', dataset: { tab: t.id }, disabled: !!t.disabled, onclick: () => onSelect(t.id) },
            t.icon ? icon(t.icon) : null,
            h('span', { class: 'tab-label' }, t.label),
            t.badge !== undefined && t.badge !== null && t.badge !== 0 ? h('span', { class: 'badge' }, String(t.badge)) : null,
          );
          el.appendChild(b);
        }
      }
      for (const b of el.children) {
        const on = (b as HTMLElement).dataset.tab === active;
        setClass(b, 'active', on);
        setAttr(b, 'aria-selected', on ? 'true' : 'false');
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Slider with steppers (phone: steppers are the primary control, §12.2) and a plain stepper
// ---------------------------------------------------------------------------------------------------

export interface SliderOpts {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (v: number) => string;
  /** Called on release / stepper tap with the clamped value. */
  onChange: (v: number) => void;
  /** Called while dragging (preview). */
  onInput?: (v: number) => void;
  hint?: string;
}

export interface Slider {
  el: HTMLElement;
  set(v: number, opts?: { max?: number; disabled?: boolean; hint?: string }): void;
  get value(): number;
}

export function slider(o: SliderOpts): Slider {
  let value = o.value;
  let max = o.max;
  let dragging = false;
  const out = h('output', { class: 'slider-value' });
  const range = h('input', { type: 'range', min: String(o.min), max: String(o.max), step: String(o.step), value: String(o.value), 'aria-label': o.label });
  const hint = h('div', { class: 'slider-hint muted' });
  const clamp = (v: number): number => Math.round(Math.max(o.min, Math.min(max, v)) / o.step) * o.step;
  const commit = (v: number): void => {
    value = clamp(v);
    range.value = String(value);
    setText(out, o.format(value));
    show(value);
    o.onChange(value);
  };
  range.addEventListener('input', () => {
    dragging = true;
    const v = clamp(Number(range.value));
    setText(out, o.format(v));
    o.onInput?.(v);
  });
  range.addEventListener('change', () => {
    dragging = false;
    commit(Number(range.value));
  });
  const minus = h('button', { class: 'btn icon stepper-btn', type: 'button', 'aria-label': `Decrease ${o.label}`, onclick: () => commit(value - o.step) }, icon('minus'));
  const plus = h('button', { class: 'btn icon stepper-btn', type: 'button', 'aria-label': `Increase ${o.label}`, onclick: () => commit(value + o.step) }, icon('plus'));
  // Phones hide the range input (steppers only): a notched meter fills the gap between - and + instead.
  const gauge = meter('progress', 'slider-gauge');
  const span = Math.max(1e-9, o.max - o.min);
  const show = (v: number): void => gauge.set((v - o.min) / span);
  const el = h('div', { class: 'slider' }, h('div', { class: 'slider-head' }, h('span', { class: 'slider-label' }, o.label), out), h('div', { class: 'slider-row' }, minus, range, gauge.el, plus), hint);
  setText(out, o.format(value));
  show(value);
  if (o.hint) setText(hint, o.hint);
  return {
    el,
    get value() {
      return value;
    },
    set(v, opts) {
      if (opts?.max !== undefined && opts.max !== max) {
        max = opts.max;
        setAttr(range, 'max', String(o.max));
      }
      const dis = !!opts?.disabled;
      range.disabled = dis;
      minus.disabled = dis || value <= o.min;
      plus.disabled = dis || value >= max - 1e-9;
      if (opts?.hint !== undefined) setText(hint, opts.hint);
      if (dragging) return;
      value = v;
      const s = String(v);
      if (range.value !== s) range.value = s;
      setText(out, o.format(v));
      show(v);
    },
  };
}

/** Compact - value + stepper (phones, counts). */
export function stepper(o: { label: string; min: number; max: number; value: number; format?: (v: number) => string; onChange: (v: number) => void }): { el: HTMLElement; set(v: number, max?: number): void } {
  let value = o.value;
  let max = o.max;
  const out = h('output', { class: 'stepper-value' });
  const fmt = o.format ?? ((v: number) => String(v));
  const minus = h('button', { class: 'btn icon stepper-btn', type: 'button', 'aria-label': `Fewer ${o.label}`, onclick: () => upd(value - 1, true) }, icon('minus'));
  const plus = h('button', { class: 'btn icon stepper-btn', type: 'button', 'aria-label': `More ${o.label}`, onclick: () => upd(value + 1, true) }, icon('plus'));
  const upd = (v: number, fire: boolean): void => {
    value = Math.max(o.min, Math.min(max, v));
    setText(out, fmt(value));
    minus.disabled = value <= o.min;
    plus.disabled = value >= max;
    if (fire) o.onChange(value);
  };
  upd(value, false);
  return { el: h('div', { class: 'stepper', role: 'group', 'aria-label': o.label }, minus, out, plus), set: (v, m) => ((max = m ?? max), upd(v, false)) };
}

// ---------------------------------------------------------------------------------------------------
// Sparkline (SVG polyline, min/max scaled; a dot marks the latest value)
// ---------------------------------------------------------------------------------------------------

export function sparkline(width = 96, height = 28): { el: SVGSVGElement; set(values: readonly number[]): void } {
  const line = svg('polyline', { class: 'spark-line', fill: 'none' });
  const area = svg('polygon', { class: 'spark-area' });
  const dot = svg('circle', { class: 'spark-dot', r: 2.5 });
  // Empty state (fewer than two samples, e.g. day 0): a dashed baseline and "No trades yet" instead of a dark block.
  const base = svg('line', { class: 'spark-base', x1: 3, x2: width - 3, y1: height / 2, y2: height / 2 });
  const empty = svg('text', { class: 'spark-empty', x: width / 2, y: height / 2 - 4, 'text-anchor': 'middle' }, 'No trades yet');
  const el = svg('svg', { class: 'sparkline', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Price trend' }, area, line, dot, base, empty);
  let key = '';
  const setEmpty = (on: boolean): void => {
    el.classList.toggle('empty', on);
  };
  return {
    el,
    set(values) {
      const k = values.map((v) => v.toFixed(3)).join(',');
      if (k === key) return;
      key = k;
      setEmpty(values.length < 2);
      if (values.length < 2) {
        line.setAttribute('points', '');
        area.setAttribute('points', '');
        el.setAttribute('aria-label', 'No trades yet');
        return;
      }
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of values) ((lo = Math.min(lo, v)), (hi = Math.max(hi, v)));
      if (hi - lo < 1e-6) ((lo -= 0.5), (hi += 0.5));
      const n = values.length;
      const pts = values.map((v, i) => {
        const x = n === 1 ? width - 3 : 3 + (i / (n - 1)) * (width - 6);
        const y = 3 + (1 - (v - lo) / (hi - lo)) * (height - 6);
        return [x, y] as const;
      });
      const s = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
      line.setAttribute('points', s);
      area.setAttribute('points', `${pts[0]![0].toFixed(1)},${height} ${s} ${pts[n - 1]![0].toFixed(1)},${height}`);
      const last = pts[n - 1]!;
      dot.setAttribute('cx', last[0].toFixed(1));
      dot.setAttribute('cy', last[1].toFixed(1));
      el.setAttribute('aria-label', `Trend over ${n} samples, latest ${values[n - 1]!.toFixed(2)}`);
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Portrait frame (procedural: monogram over the faction colour, gold ring, seat / role icon badge)
// ---------------------------------------------------------------------------------------------------

export function initials(name: string): string {
  const parts = name.replace(/[^A-Za-z\s-]/g, ' ').split(/[\s-]+/).filter((p) => p.length > 0 && p[0] === p[0]!.toUpperCase());
  const a = parts[0]?.[0] ?? '?';
  const b = parts.length > 1 ? parts[parts.length - 1]![0]! : '';
  return `${a}${b}`;
}

export function portrait(o: { name: string; factionId: FactionId | null; badgeIcon?: string; size?: 'sm' | 'md' | 'lg'; title?: string }): HTMLElement {
  const { cls } = factionClass(o.factionId);
  return h(
    'span',
    { class: `portrait portrait-${o.size ?? 'md'} ${cls}`, role: 'img', 'aria-label': o.title ?? o.name, title: o.title ?? o.name },
    h('span', { class: 'portrait-mono' }, initials(o.name)),
    o.badgeIcon ? h('span', { class: 'portrait-badge' }, icon(o.badgeIcon)) : null,
  );
}

// ---------------------------------------------------------------------------------------------------
// Panel frame: right drawer on PC, bottom sheet on phones (CSS by [data-layout]), or centred modal
// ---------------------------------------------------------------------------------------------------

export interface PanelFrame {
  el: HTMLElement;
  body: HTMLElement;
  header: HTMLElement;
  title: HTMLElement;
  subtitle: HTMLElement;
  actions: HTMLElement;
  setTitle(title: string, subtitle?: string): void;
}

/**
 * Carved panel with a header (title, subtitle, close) and a scrolling body. variant 'drawer' docks right on PC and
 * becomes a 60% bottom sheet on phones (drag handle: tap toggles full height); 'modal' centres (full screen on
 * phones); 'card' is a plain panel.
 */
export function panelFrame(o: { id: string; variant: 'drawer' | 'modal' | 'card'; title: string; subtitle?: string; onClose?: () => void; parchment?: boolean; torana?: boolean; lead?: Node | null }): PanelFrame {
  const title = h(o.torana ? 'h2' : 'div', { class: o.torana ? 'title-torana panel-title-lg' : 'panel-title' }, o.title);
  const subtitle = h('div', { class: 'panel-sub' }, o.subtitle ?? '');
  const actions = h('div', { class: 'panel-actions' });
  const close = o.onClose ? h('button', { class: 'btn icon ghost panel-close', type: 'button', 'aria-label': 'Close', onclick: o.onClose }, icon('close')) : null;
  const handle = o.variant === 'drawer' ? h('button', { class: 'sheet-handle', type: 'button', 'aria-label': 'Expand or collapse', onclick: () => el.classList.toggle('sheet-full') }) : null;
  const header = h('div', { class: 'panel-head' }, o.lead ?? null, h('div', { class: 'panel-head-text' }, title, subtitle), actions, close);
  const body = h('div', { class: 'panel-body' });
  const el = h(
    'section',
    { class: `panel hud-${o.variant}${o.parchment ? ' parchment' : ''}${o.variant === 'modal' ? ' modal' : ''}`, role: o.variant === 'modal' ? 'dialog' : 'region', 'aria-label': o.title, dataset: { screen: o.id } },
    handle,
    header,
    body,
  );
  setHiddenIfEmpty(subtitle);
  return {
    el,
    body,
    header,
    title,
    subtitle,
    actions,
    setTitle(t, s) {
      setText(title, t);
      setText(subtitle, s ?? '');
      setHiddenIfEmpty(subtitle);
      setAttr(el, 'aria-label', t);
    },
  };
}

function setHiddenIfEmpty(el: HTMLElement): void {
  setClass(el, 'ui-hidden', !el.textContent);
}

/** Labelled value cell ("Population 12,400") for vitals grids; returns the value element to update. */
export function statCell(labelText: string, iconId?: string, cls = ''): { el: HTMLElement; value: HTMLElement; note: HTMLElement } {
  const value = h('b', { class: 'stat-v' });
  const note = h('span', { class: 'stat-note' });
  const el = h('div', { class: `stat${cls ? ` ${cls}` : ''}` }, h('span', { class: 'stat-k' }, iconId ? icon(iconId) : null, labelText), h('span', { class: 'stat-vrow' }, value, note));
  return { el, value, note };
}

/** Section heading inside panels. */
export function section(titleText: string, ...children: (Node | null)[]): HTMLElement {
  const el = h('div', { class: 'hud-section' }, h('div', { class: 'hud-section-title' }, titleText));
  append(el, ...children);
  return el;
}

/** Set a CSS custom property only on change (anchored elements). */
export function setVar(el: HTMLElement, name: string, value: string): void {
  setStyle(el, name, value);
}
