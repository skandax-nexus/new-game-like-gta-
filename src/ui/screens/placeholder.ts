/**
 * Themed placeholder for screens that have no factory yet. OWNER: Engine Developer - Contracts (CORE-01).
 *
 * Every ScreenId without a static or discovered factory resolves here (registry.ts), so scenes and QA can
 * `ui.show(id, props)` / `__SAMRAJYA__.showScreen(id, props)` before the real screen exists. The panel uses the
 * theme tokens only (carved lacquer frame, torana title, parchment props sheet) and prints the screen id, the
 * ticket that implements it and every prop key with a short value summary - a live spec for the UI developer.
 */
import type { AppContext, ScreenId, ScreenPropsMap } from '../../app/contracts';
import { clear, h } from '../dom';
import type { Screen, ScreenFactory, UIManager, UILayer } from '../ui';
import { PLANNED_SCREEN_OWNERS } from './registry';

const TITLES: Readonly<Partial<Record<ScreenId, string>>> = {
  build_placement: 'Build Placement',
  market: 'The Market',
  age_panel: 'Ages and Landmarks',
  economy_panel: 'Treasury and Granaries',
  mission_card: 'Hero Mission',
  hero_dialogue: 'Dialogue',
  hero_negotiation: 'Negotiation',
  mission_result: 'Mission Result',
  game_stats: 'Statistics of the Realm',
  hint_card: 'Hint',
};

/** Non-blocking screens stay on the HUD layer (placement ghost info, hint cards); the rest are modal. */
const HUD_SCREENS: ReadonlySet<ScreenId> = new Set<ScreenId>(['build_placement', 'hint_card', 'hero_hud', 'battle_hud', 'world_hud']);

const STYLE_ID = 'samrajya-placeholder-style';
const CSS = `
.ph-screen { width: min(600px, 100%); display: flex; flex-direction: column; gap: var(--sp-2, 8px); }
.ph-screen.ph-hud { position: absolute; left: 50%; bottom: max(16px, var(--safe-bottom, 0px)); transform: translateX(-50%); width: min(460px, calc(100vw - 32px)); }
.ph-screen .title-torana { margin: 0; font-size: var(--fs-xl); letter-spacing: 0.06em; }
.ph-screen .ph-sub { text-align: center; font-size: var(--fs-sm); color: var(--ui-text-dim); letter-spacing: 0.08em; text-transform: uppercase; }
.ph-screen .ph-ids { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; }
.ph-screen .divider-lotus { width: min(320px, 80%); margin: 2px auto; flex: none; }
.ph-screen .ph-sheet { padding: 12px 16px; border-radius: var(--radius-md); }
.ph-screen .ph-sheet-title { font-family: var(--font-display); font-size: var(--fs-md); margin-bottom: 6px; }
.ph-screen .ph-row { display: grid; grid-template-columns: minmax(110px, 34%) 1fr; gap: 12px; padding: 5px 0; border-top: 1px solid rgba(90, 70, 50, 0.22); font-size: var(--fs-sm); }
.ph-screen .ph-row:first-of-type { border-top: none; }
.ph-screen .ph-key { font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.ph-screen .ph-val { color: var(--ui-text-dark-dim); overflow-wrap: anywhere; }
.ph-screen .ph-empty { font-style: italic; color: var(--ui-text-dark-dim); font-size: var(--fs-sm); }
.ph-screen .btn-row { justify-content: center; }
.ph-screen .btn { min-height: var(--touch-min, 44px); min-width: 120px; }
`;

function ensureStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

function titleOf(id: ScreenId): string {
  return TITLES[id] ?? id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function trunc(s: string, n = 56): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Short human summary of a prop value (no deep walks: props can hold the whole WorldState). */
export function summarizeProp(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return `"${trunc(v)}"`;
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('en-IN') : v.toFixed(3);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'function') return 'function';
  if (Array.isArray(v)) return v.length === 0 ? 'array (empty)' : `array of ${v.length}: ${trunc(v.slice(0, 3).map((x) => (typeof x === 'object' && x !== null ? '{…}' : String(x))).join(', '), 40)}`;
  if (ArrayBuffer.isView(v)) return `${v.constructor.name} (${(v as unknown as ArrayLike<number>).length})`;
  const o = v as Record<string, unknown>;
  if ('calendar' in o && 'factions' in o && 'settlements' in o) {
    const cal = o.calendar as { totalHours?: number } | undefined;
    const day = Math.floor((cal?.totalHours ?? 0) / 24);
    return `WorldState · day ${day} · ${Object.keys(o.factions as object).length} factions · ${Object.keys(o.settlements as object).length} settlements`;
  }
  if ('formations' in o && 'setup' in o) return `BattleState · ${(o.formations as unknown[]).length} formations`;
  const keys = Object.keys(o);
  return keys.length === 0 ? 'object (empty)' : `{ ${trunc(keys.slice(0, 5).join(', '), 48)}${keys.length > 5 ? ', …' : ''} }`;
}

/** Factory of the themed placeholder for `id`. */
export function placeholderScreen<K extends ScreenId>(id: K): ScreenFactory<K> {
  return (ctx: AppContext, ui: UIManager): Screen<K> => {
    void ctx;
    ensureStyle();
    const hud = HUD_SCREENS.has(id);
    const owner = PLANNED_SCREEN_OWNERS[id];
    const rows = h('div', { class: 'ph-rows' });
    const sheet = h('div', { class: 'panel parchment ph-sheet' }, h('div', { class: 'ph-sheet-title' }, 'Props received'), rows);
    const el = h(
      'div',
      { class: `panel ${hud ? 'ph-hud' : 'modal'} ph-screen`, role: 'dialog', 'aria-label': `${titleOf(id)} (placeholder)`, dataset: { placeholder: id } },
      h('h2', { class: 'title-torana' }, titleOf(id)),
      h('div', { class: 'ph-sub' }, owner ? `Screen in development · ${owner}` : 'Screen in development'),
      h('div', { class: 'ph-ids' }, h('span', { class: 'chip' }, 'screen ', h('b', null, id)), h('span', { class: 'chip' }, 'placeholder')),
      h('div', { class: 'divider-lotus' }),
      sheet,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', onclick: () => ui.hide(id) }, 'Close')),
    );
    const layer: UILayer = hud ? 'hud' : 'modal';
    return {
      id,
      layer,
      el,
      update(props: ScreenPropsMap[K]) {
        clear(rows);
        const entries = Object.entries((props ?? {}) as Record<string, unknown>);
        if (entries.length === 0) rows.appendChild(h('div', { class: 'ph-empty' }, 'No props'));
        for (const [k, v] of entries) rows.appendChild(h('div', { class: 'ph-row' }, h('span', { class: 'ph-key' }, k), h('span', { class: 'ph-val' }, summarizeProp(v))));
        el.dataset.propKeys = entries.map(([k]) => k).join(',');
      },
    };
  };
}
