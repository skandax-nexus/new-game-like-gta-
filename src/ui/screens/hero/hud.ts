/**
 * Hero HUD (DESIGN_SPEC §11.7-§11.8, §12.2): minimal Wukong-style frame. Exploration: objective line (top-left),
 * compass strip (top-centre), prompt bubble at the target (tap to interact), captions (bottom). Combat: HP (red) and
 * stamina (gold) bars, salve charges, lock-on reticle, enemy bars over heads, boss bar, unblockable red-flash cue,
 * slow-motion edge. Touch: virtual stick (left), look area (right, the canvas), interact button; combat buttons
 * (attack / heavy hold / roll / guard hold-tap / salve / lock-on) only during combat missions.
 * OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 */
import type { AppContext, HeroCombatHud, HeroEnemyBar, ScreenPropsMap } from '../../../app/contracts';
import type { InputAction } from '../../../core/types';
import { fmtInt, h, setAttr, setClass, setHidden, setStyle, setText, syncList } from '../../dom';
import type { Screen, UIManager } from '../../ui';
import { icon } from '../../components/icons';
import { meter, pips, type Meter } from '../../components/widgets';
import { hotkeyLabel } from '../../../input/bindings';

const TAU = Math.PI * 2;
const COMPASS_PX_PER_RAD = 120;
const COMPASS_MARKS: readonly { b: number; t: string; major: boolean }[] = [
  { b: 0, t: 'N', major: true },
  { b: 45, t: 'NE', major: false },
  { b: 90, t: 'E', major: true },
  { b: 135, t: 'SE', major: false },
  { b: 180, t: 'S', major: true },
  { b: 225, t: 'SW', major: false },
  { b: 270, t: 'W', major: true },
  { b: 315, t: 'NW', major: false },
];

/** Compass bearing (radians clockwise from north) of a facing-convention heading (forward = (sin h, cos h), +Z south). */
export function bearingOf(heading: number): number {
  return (((Math.PI - heading) % TAU) + TAU) % TAU;
}

export function heroHud(ctx: AppContext, ui: UIManager): Screen<'hero_hud'> {
  let props: ScreenPropsMap['hero_hud'] | null = null;
  let combatSeen = false;
  let lowStaminaSent = false;
  let unblockSent = false;

  // --- top: objective, compass, leave -------------------------------------------------------------
  const place = h('div', { class: 'hh-place' });
  const objective = h('div', { class: 'hh-objective' });
  const objBox = h('div', { class: 'hh-obj', dataset: { anchor: 'hero-objective' } }, icon('flag'), h('div', null, objective, place));
  const compassStrip = h('div', { class: 'hh-compass-strip' });
  for (let copy = -1; copy <= 1; copy++) {
    for (const m of COMPASS_MARKS) {
      const x = (copy * 360 + m.b) * (Math.PI / 180) * COMPASS_PX_PER_RAD;
      compassStrip.append(h('span', { class: `hh-mark${m.major ? ' major' : ''}`, style: { left: `${x.toFixed(1)}px` } }, m.t));
    }
    for (let d = 15; d < 360; d += 15) {
      if (d % 45 === 0) continue;
      const x = (copy * 360 + d) * (Math.PI / 180) * COMPASS_PX_PER_RAD;
      compassStrip.append(h('i', { class: 'hh-tick', style: { left: `${x.toFixed(1)}px` } }));
    }
  }
  const compass = h('div', { class: 'hh-compass', role: 'img', 'aria-label': 'Compass' }, compassStrip, h('i', { class: 'hh-compass-needle' }));
  const leave = h('button', { class: 'btn small hh-leave', type: 'button', onclick: () => (ui.sfx('ui_click'), ctx.input.injectAction('hero_exit')) }, icon('exit'), 'Leave');
  const keysHint = h('div', { class: 'hh-keys' });

  // --- prompt bubble + captions -------------------------------------------------------------------
  const promptText = h('span', { class: 'hh-prompt-text' });
  const promptKey = h('kbd', { class: 'kbd' });
  const prompt = h('button', { class: 'hh-prompt ui-hidden', type: 'button', onclick: () => (ui.sfx('ui_click'), ctx.input.injectAction('hero_interact')) }, promptKey, promptText);
  const capSpeaker = h('b', { class: 'hh-cap-speaker' });
  const capText = h('span', { class: 'hh-cap-text' });
  const caption = h('div', { class: 'hh-caption ui-hidden', role: 'status', 'aria-live': 'polite' }, capSpeaker, capText);

  // --- combat: vitals, boss, reticle, enemies, flash ----------------------------------------------
  const hp = meter('hp');
  const st = meter('stamina');
  const hpText = h('span', { class: 'hh-vt' });
  const salves = pips(3, 'salve-pips');
  const vitals = h('div', { class: 'hh-vitals ui-hidden', dataset: { anchor: 'hero-vitals' } }, h('div', { class: 'hh-vrow' }, icon('heart'), hp.el, hpText), h('div', { class: 'hh-vrow' }, icon('breath'), st.el), h('div', { class: 'hh-vrow salves' }, icon('flask'), salves.el));
  const bossName = h('div', { class: 'hh-boss-name' });
  const bossHp = meter('enemy');
  const bossPoise = meter('poise');
  const boss = h('div', { class: 'hh-boss ui-hidden' }, bossName, bossHp.el, bossPoise.el);
  const flash = h('div', { class: 'hh-flash ui-hidden', 'aria-hidden': 'true' });
  const slowmo = h('div', { class: 'hh-slowmo ui-hidden', 'aria-hidden': 'true' });
  const anchorLayer = h('div', { class: 'hh-anchors' });
  const reticle = h('div', { class: 'hh-reticle ui-hidden' }, icon('target'));
  anchorLayer.append(reticle);
  ui.anchorsLayer.append(anchorLayer);
  const enemyViews = new Map<string, { el: HTMLElement; hp: Meter; poise: Meter; name: HTMLElement }>();

  // --- touch controls -----------------------------------------------------------------------------
  const knob = h('i', { class: 'hh-knob' });
  const stick = h('div', { class: 'hh-stick', role: 'application', 'aria-label': 'Move' }, knob);
  let stickId = -1;
  let sx = 0;
  let sy = 0;
  let running = false;
  const stickMove = (e: PointerEvent): void => {
    const r = stick.getBoundingClientRect();
    const rad = r.width / 2;
    let dx = (e.clientX - (r.left + rad)) / rad;
    let dy = (e.clientY - (r.top + rad)) / rad;
    const len = Math.hypot(dx, dy);
    if (len > 1) ((dx /= len), (dy /= len));
    sx = dx;
    sy = dy;
    setStyle(knob, 'transform', `translate(${(dx * rad * 0.62).toFixed(1)}px, ${(dy * rad * 0.62).toFixed(1)}px)`);
    ctx.input.setVirtualStick(dx, -dy);
    const run = len > 0.8;
    if (run !== running) {
      running = run;
      if (run) ctx.input.pressAction('hero_run');
      else ctx.input.releaseAction('hero_run');
    }
  };
  stick.addEventListener('pointerdown', (e) => {
    stickId = e.pointerId;
    stick.setPointerCapture?.(e.pointerId);
    stickMove(e);
  });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId === stickId) stickMove(e);
  });
  const stickEnd = (e: PointerEvent): void => {
    if (e.pointerId !== stickId) return;
    stickId = -1;
    sx = sy = 0;
    setStyle(knob, 'transform', 'translate(0px, 0px)');
    ctx.input.setVirtualStick(0, 0);
    if (running) ctx.input.releaseAction('hero_run');
    running = false;
  };
  stick.addEventListener('pointerup', stickEnd);
  stick.addEventListener('pointercancel', stickEnd);
  void sx;
  void sy;
  const lookHint = h('div', { class: 'hh-look' }, h('span', null, 'Drag to look'));
  const interactBtn = h('button', { class: 'btn primary hh-interact', type: 'button', 'aria-label': 'Interact', onclick: () => (ui.sfx('ui_click'), ctx.input.injectAction('hero_interact')) }, icon('interact'));
  const holdBtn = (action: InputAction, iconId: string, labelText: string, cls: string, tapAction: InputAction | null = null): HTMLButtonElement => {
    const b = h('button', { class: `btn hh-cbtn ${cls}`, type: 'button', 'aria-label': labelText }, icon(iconId), h('span', null, labelText));
    let t0 = 0;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      t0 = performance.now();
      ctx.input.pressAction(action);
      setClass(b, 'held', true);
    });
    const up = (): void => {
      if (!b.classList.contains('held')) return;
      setClass(b, 'held', false);
      ctx.input.releaseAction(action);
      if (tapAction && performance.now() - t0 < 200) ctx.input.injectAction(tapAction);
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', up);
    return b;
  };
  const tapBtn = (action: InputAction, iconId: string, labelText: string, cls: string): HTMLButtonElement => h('button', { class: `btn hh-cbtn ${cls}`, type: 'button', 'aria-label': labelText, onclick: () => ctx.input.injectAction(action) }, icon(iconId), h('span', null, labelText));
  const salveCount = h('span', { class: 'badge hh-salve-n' });
  const salveBtn = tapBtn('hero_salve', 'flask', 'Salve', 'salve');
  salveBtn.append(salveCount);
  const combatBtns = h(
    'div',
    { class: 'hh-combat-btns', dataset: { anchor: 'hero-combat-buttons' } },
    holdBtn('hero_attack_light', 'sword', 'Attack', 'attack primary'),
    holdBtn('hero_attack_heavy', 'heavy', 'Heavy', 'heavy'),
    tapBtn('hero_roll', 'roll', 'Roll', 'roll'),
    holdBtn('hero_guard', 'guard', 'Guard', 'guard'),
    salveBtn,
    tapBtn('hero_lock_on', 'lock', 'Lock', 'lock'),
  );
  const touch = h('div', { class: 'hh-touch' }, stick, lookHint, interactBtn, combatBtns);

  const el = h('div', { class: 'screen-hero-hud hud-root' }, h('div', { class: 'hh-top' }, objBox, compass, leave), keysHint, prompt, caption, vitals, boss, touch, slowmo, flash);

  const renderEnemies = (enemies: readonly HeroEnemyBar[]): void => {
    const own = enemies.filter((e) => !e.boss && e.visible);
    syncList(
      anchorLayer,
      own,
      (e) => e.id,
      (e) => {
        const hpm = meter('enemy');
        const pm = meter('poise');
        const name = h('span', { class: 'he-name' });
        const node = h('div', { class: 'hh-enemy' }, name, hpm.el, pm.el, h('span', { class: 'he-warn' }, icon('alert')));
        enemyViews.set(e.id, { el: node, hp: hpm, poise: pm, name });
        return node;
      },
      (node, e) => {
        const v = enemyViews.get(e.id)!;
        setText(v.name, e.name);
        v.hp.set(e.hp / Math.max(1, e.hpMax));
        v.poise.set(e.poise / Math.max(1, e.poiseMax));
        setClass(node, 'unblockable', e.unblockable);
        setStyle(node, 'transform', `translate(${Math.round(e.x)}px, ${Math.round(e.y)}px) translate(-50%, -100%) scale(${(ui.scale || 1).toFixed(2)})`);
      },
    );
    if (!anchorLayer.contains(reticle)) anchorLayer.append(reticle);
  };

  const renderCombat = (c: HeroCombatHud | null | undefined): void => {
    setHidden(vitals, !c);
    setHidden(boss, true);
    if (!c) {
      setHidden(reticle, true);
      renderEnemies([]);
      setHidden(flash, true);
      setHidden(slowmo, true);
      return;
    }
    if (!combatSeen) {
      combatSeen = true;
      ctx.bus.emit('ui:hint', { key: 'hero.combat_start' });
    }
    hp.set(c.hp / Math.max(1, c.hpMax), { warn: c.hp / Math.max(1, c.hpMax) < 0.3 });
    setText(hpText, `${fmtInt(c.hp)} / ${fmtInt(c.hpMax)}`);
    st.set(c.stamina / Math.max(1, c.staminaMax), { warn: c.stamina < 25 });
    salves.set(c.salveCharges, c.salveMax);
    setText(salveCount, String(c.salveCharges));
    if (c.stamina < 25 && !lowStaminaSent) {
      lowStaminaSent = true;
      ctx.bus.emit('ui:hint', { key: 'hero.low_stamina' });
    }
    const b = c.enemies.find((e) => e.boss && e.visible);
    setHidden(boss, !b);
    if (b) {
      setText(bossName, b.name);
      bossHp.set(b.hp / Math.max(1, b.hpMax));
      bossPoise.set(b.poise / Math.max(1, b.poiseMax));
      setClass(boss, 'unblockable', b.unblockable);
    }
    renderEnemies(c.enemies);
    setHidden(reticle, !c.lockOn);
    if (c.lockOn) setStyle(reticle, 'transform', `translate(${Math.round(c.lockOn.x)}px, ${Math.round(c.lockOn.y)}px) translate(-50%, -50%) scale(${(ui.scale || 1).toFixed(2)})`);
    const unblock = c.enemies.some((e) => e.unblockable && e.visible);
    setHidden(flash, !unblock);
    if (unblock && !unblockSent) {
      unblockSent = true;
      ctx.bus.emit('ui:hint', { key: 'hero.unblockable_seen' });
    }
    setHidden(slowmo, !c.slowMotion);
  };

  return {
    id: 'hero_hud',
    layer: 'hud',
    el,
    update(p) {
      props = p;
      const combat = p.combat ?? null;
      setText(objective, p.objective ?? `Walk the streets of ${p.settlementName}`);
      setText(place, p.objective ? p.settlementName : '');
      setHidden(place, !p.objective);
      const heading = p.compassHeading ?? Math.PI;
      const b = bearingOf(heading);
      setStyle(compassStrip, 'transform', `translateX(${(-b * COMPASS_PX_PER_RAD).toFixed(1)}px)`);
      setAttr(compass, 'aria-label', `Compass: facing ${COMPASS_MARKS[Math.round(((b * 180) / Math.PI) / 45) % 8]!.t}`);
      // Prompt bubble
      setHidden(prompt, !p.prompt);
      if (p.prompt) {
        const key = hotkeyLabel(ctx.input.preset, { context: 'hero' }, 'hero_interact', ctx.settings.keybindings);
        setText(promptKey, ctx.input.touchMode ? 'Tap' : key || 'E');
        setText(promptText, p.prompt.replace(/\s*\(E\)$/, ''));
        const a = p.promptAnchor;
        setClass(prompt, 'anchored', !!a);
        if (a) setStyle(prompt, 'transform', `translate(${Math.round(a.x / (ui.scale || 1))}px, ${Math.round(a.y / (ui.scale || 1))}px) translate(-50%, -120%)`);
        else setStyle(prompt, 'transform', '');
      }
      // Captions
      setHidden(caption, !p.caption);
      if (p.caption) {
        setText(capSpeaker, p.caption.speaker ? `${p.caption.speaker}: ` : '');
        setText(capText, p.caption.text);
      }
      // Keys hint (PC exploration)
      const touchMode = ctx.input.touchMode || ui.layout !== 'pc';
      const tc = p.touchControls ?? (touchMode ? 'explore' : 'none');
      setHidden(keysHint, touchMode || !!combat);
      if (!touchMode) setText(keysHint, ctx.input.preset === 'grid' ? 'WASD / arrows move · Mouse look · Shift run · E interact · Esc leave' : 'WASD move · Mouse look · Shift run · E interact · Esc leave');
      renderCombat(combat);
      // Touch controls
      setHidden(touch, tc === 'none' || !touchMode);
      setHidden(combatBtns, tc !== 'combat');
      setHidden(interactBtn, tc === 'combat' || !p.prompt);
      setHidden(lookHint, tc === 'none');
      setClass(el, 'in-combat', !!combat);
      void props;
    },
    dispose() {
      anchorLayer.remove();
      ctx.input.setVirtualStick(0, 0);
    },
  };
}
