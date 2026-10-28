/**
 * Hero exploration HUD (GDD §3 limited hero mode). OWNER: Lead UI/UX Engineer. Baseline by the CTO.
 */
import type { AppContext } from '../../app/contracts';
import { h, setText } from '../dom';
import type { Screen, UIManager } from '../ui';

export function heroHud(ctx: AppContext, ui: UIManager): Screen<'hero_hud'> {
  void ui;
  const name = h('div', { class: 'panel-title', style: { margin: '0' } });
  const prompt = h('div', { class: 'panel ui-hidden', style: { position: 'absolute', bottom: 'calc(90px + var(--safe-bottom))', left: '50%', transform: 'translateX(-50%)', padding: '8px 16px' } });
  const top = h(
    'div',
    { class: 'panel', style: { position: 'absolute', top: 'max(8px, var(--safe-top))', left: 'max(8px, var(--safe-left))', padding: '8px 14px', display: 'flex', gap: '12px', alignItems: 'center' } },
    name,
    h('span', { class: 'muted', style: { fontSize: 'var(--fs-sm)' } }, ctx.input.touchMode ? 'Left: move · Right: look' : 'WASD move · Mouse drag look · Shift run · E interact'),
  );
  const exit = h('button', { class: 'btn', style: { position: 'absolute', top: 'max(8px, var(--safe-top))', right: 'max(8px, var(--safe-right))' }, onclick: () => ctx.input.injectAction('hero_exit') }, 'Leave');
  const interact = h('button', { class: 'btn primary', style: { position: 'absolute', right: 'max(18px, var(--safe-right))', bottom: 'max(18px, var(--safe-bottom))', width: '72px', height: '72px', borderRadius: '50%' }, onclick: () => ctx.input.injectAction('hero_interact') }, 'E');
  const el = h('div', { style: { position: 'absolute', inset: '0', pointerEvents: 'none' } }, top, exit, prompt, interact);
  for (const c of [top, exit, interact]) c.style.pointerEvents = 'auto';
  return {
    id: 'hero_hud',
    layer: 'hud',
    el,
    update(p) {
      setText(name, p.settlementName);
      prompt.classList.toggle('ui-hidden', !p.prompt);
      if (p.prompt) setText(prompt, p.prompt);
      interact.classList.toggle('ui-hidden', !p.prompt);
    },
  };
}
