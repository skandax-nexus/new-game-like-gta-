/**
 * Battle HUD (forces, time, speed, order bar, formation cards, touch radial) + results screen.
 * OWNER: Lead UI/UX Engineer. Baseline by the CTO.
 * Order buttons inject input actions (ctx.input.injectAction) so keyboard, mouse, touch and HUD share
 * one code path in the BattleScene. Formation cards emit 'ui:select_formations'.
 */
import type { AppContext } from '../../app/contracts';
import type { InputAction, UnitClass } from '../../core/types';
import { FACTIONS } from '../../data/factions';
import { UNITS } from '../../data/units';
import { h, append, clear, fmtInt, setText } from '../dom';
import type { Screen, UIManager } from '../ui';

const ABBR: Record<UnitClass, string> = {
  spearmen: 'SPR',
  archers: 'ARC',
  elite_guards: 'GRD',
  cavalry: 'CAV',
  chariots: 'CHR',
  war_elephants: 'ELE',
  engineers: 'ENG',
  scouts: 'SCT',
  supply_train: 'SUP',
};

const ORDERS: [InputAction, string, string][] = [
  ['order_hold', 'Hold', 'H'],
  ['order_advance', 'Advance', 'T'],
  ['order_attack', 'Attack', 'X'],
  ['order_charge', 'Charge', 'C'],
  ['order_flank', 'Flank', 'Y'],
  ['order_defend', 'Defend', 'U'],
  ['order_withdraw', 'Withdraw', 'B'],
  ['order_regroup', 'Regroup', 'G'],
];
const SHAPES: [InputAction, string][] = [
  ['shape_line', 'Line'],
  ['shape_column', 'Column'],
  ['shape_square', 'Square'],
  ['shape_wedge', 'Wedge'],
];

export function battleHud(ctx: AppContext, ui: UIManager): Screen<'battle_hud'> {
  const sideBars = [h('i'), h('i')];
  const sideLabels = [h('span'), h('span')];
  const clock = h('div', { style: { fontFamily: 'var(--font-display)', color: 'var(--c-gold)', minWidth: '64px', textAlign: 'center' } });
  const pauseBtn = h('button', { class: 'btn icon', onclick: () => ctx.actions.togglePause() }, '❚❚');
  const speedBtns = new Map<number, HTMLButtonElement>();
  const speeds = h('div', { class: 'btn-row', style: { gap: '4px' } }, pauseBtn);
  for (const s of [0.5, 1, 2, 4]) {
    const b = h('button', { class: 'btn icon', style: { fontFamily: 'var(--font-body)', fontSize: 'var(--fs-xs)' }, onclick: () => (ctx.actions.setTimeScale(s), ctx.actions.setPaused(false)) }, `${s}×`);
    speedBtns.set(s, b);
    speeds.append(b);
  }
  const forces = h(
    'div',
    { style: { display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '10px', alignItems: 'center', minWidth: 'min(520px, 70vw)' } },
    h('div', null, sideLabels[0]!, h('div', { class: 'bar' }, sideBars[0]!)),
    clock,
    h('div', { style: { textAlign: 'right' } }, sideLabels[1]!, h('div', { class: 'bar', style: { transform: 'scaleX(-1)' } }, sideBars[1]!)),
  );
  const top = h(
    'div',
    { class: 'panel', style: { position: 'absolute', top: 'max(8px, var(--safe-top))', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '12px', alignItems: 'center', padding: '8px 12px', flexWrap: 'wrap', justifyContent: 'center', maxWidth: '98vw' } },
    forces,
    speeds,
    h('button', { class: 'btn icon', onclick: () => (ctx.actions.setPaused(true), ui.show('pause_menu', { mode: ctx.session.mode, canSave: true })) }, '☰'),
  );
  const orderBar = h('div', { class: 'btn-row', style: { justifyContent: 'center' } });
  for (const [a, label, key] of ORDERS) orderBar.append(h('button', { class: 'btn', title: `${label} (${key})`, onclick: () => (ctx.bus.emit('audio:sfx', { sfx: 'order_ack' }), ctx.input.injectAction(a)) }, label));
  const shapeBar = h('div', { class: 'btn-row', style: { justifyContent: 'center' } });
  for (const [a, label] of SHAPES) shapeBar.append(h('button', { class: 'btn ghost', style: { fontSize: 'var(--fs-sm)' }, onclick: () => ctx.input.injectAction(a) }, label));
  shapeBar.append(h('button', { class: 'btn ghost', style: { fontSize: 'var(--fs-sm)' }, onclick: () => ctx.input.injectAction('select_all') }, 'All'));
  const cards = h('div', { style: { display: 'flex', gap: '6px', overflowX: 'auto', padding: '2px', maxWidth: '96vw' } });
  const bottom = h(
    'div',
    { class: 'panel', style: { position: 'absolute', bottom: 'max(8px, var(--safe-bottom))', left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px', maxWidth: '98vw', width: 'max-content' } },
    cards,
    orderBar,
    shapeBar,
  );
  const el = h('div', { class: 'screen-battle-hud', style: { position: 'absolute', inset: '0', pointerEvents: 'none' } }, top, bottom);
  top.style.pointerEvents = 'auto';
  bottom.style.pointerEvents = 'auto';
  let cardKey = '';
  const cardEls = new Map<number, { el: HTMLElement; bar: HTMLElement; count: HTMLElement }>();
  return {
    id: 'battle_hud',
    layer: 'hud',
    el,
    update(p) {
      const b = p.battle;
      for (const side of [0, 1] as const) {
        const s = b.sides[side];
        const f = FACTIONS[s.factionId];
        setText(sideLabels[side]!, `${f?.shortName ?? s.factionId} ${fmtInt(s.soldiers)}${side === p.playerSide ? ' (you)' : ''}`);
        sideBars[side]!.style.width = `${Math.round((s.soldiers / Math.max(1, s.initialSoldiers)) * 100)}%`;
        sideBars[side]!.style.background = f?.colors.primary ?? '';
      }
      const t = Math.floor(b.time);
      setText(clock, `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
      pauseBtn.classList.toggle('active', p.paused);
      for (const [sp, btn] of speedBtns) btn.classList.toggle('active', !p.paused && Math.abs(p.timeScale - sp) < 0.01);
      // Cards for the player's formations.
      const own = b.formations.filter((f) => f.side === p.playerSide);
      const key = own.map((f) => f.index).join(',');
      if (key !== cardKey) {
        cardKey = key;
        clear(cards);
        cardEls.clear();
        for (const f of own) {
          const bar = h('i');
          const count = h('div', { style: { fontSize: 'var(--fs-xs)' } });
          const el = h(
            'button',
            {
              class: 'btn',
              style: { minWidth: '62px', padding: '4px 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', fontFamily: 'var(--font-body)' },
              title: UNITS[f.unitClass].name,
              onclick: (e: MouseEvent) => ctx.bus.emit('ui:select_formations', { formations: [f.index], additive: e.shiftKey }),
            },
            h('b', { style: { fontSize: 'var(--fs-xs)', color: 'var(--c-gold)' } }, ABBR[f.unitClass]),
            count,
            h('div', { class: 'bar', style: { width: '48px', height: '4px' } }, bar),
          );
          cards.append(el);
          cardEls.set(f.index, { el, bar, count });
        }
      }
      const sel = new Set(p.selection);
      for (const f of own) {
        const c = cardEls.get(f.index);
        if (!c) continue;
        setText(c.count, f.soldiers > 0 ? (f.activity === 'routing' ? 'ROUT' : String(f.soldiers)) : '—');
        c.bar.style.width = `${Math.round(f.morale)}%`;
        c.el.classList.toggle('active', sel.has(f.index));
        c.el.style.opacity = f.soldiers > 0 ? '1' : '0.4';
      }
    },
  };
}

export function battleResults(ctx: AppContext, ui: UIManager): Screen<'battle_results'> {
  const body = h('div');
  const el = h('div', { class: 'panel modal' }, body);
  void ui;
  return {
    id: 'battle_results',
    layer: 'modal',
    el,
    update(p) {
      clear(body);
      const o = p.outcome;
      const won = o.winner === p.playerSide;
      const draw = o.winner === null;
      append(body, 
        h('div', { class: 'panel-title', style: { fontSize: 'var(--fs-xl)', textAlign: 'center' } }, draw ? 'An Indecisive Field' : won ? 'Victory' : 'Defeat'),
        h('div', { class: 'divider' }),
        ...o.summary.map((s) => h('p', null, s)),
        h(
          'div',
          { class: 'stat-grid' },
          ...o.sides.map((s, i) => h('span', null, h('span', { class: 'k' }, `${FACTIONS[s.factionId]?.shortName ?? s.factionId}${i === p.playerSide ? ' (you)' : ''}: `), `${fmtInt(s.survivors)} of ${fmtInt(s.startSoldiers)} remain`)),
        ),
        h('div', { class: 'btn-row', style: { justifyContent: 'center', marginTop: '12px' } }, h('button', { class: 'btn primary', onclick: () => void ctx.actions.continueAfterBattle() }, p.continueLabel)),
      );
    },
  };
}
