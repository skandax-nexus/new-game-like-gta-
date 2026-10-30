/**
 * Battle HUD (DESIGN_SPEC §6.13, §8.7, §8.8, §12.2): side strength / morale bars, battle time, speed (0.5x-4x, 8x
 * skirmish), deployment bar (timer, Begin battle), formation cards strip (class icon, strength, morale with its
 * dominant cause, fatigue tier, ammo pips, experience chevrons, current order / intent), command card (Orders /
 * Shapes / Intents pages, hotkeys per preset), commander Rally button with cooldown ring, event feed, battle minimap,
 * floating formation cards + hover bars anchored at the screen positions GP-04 supplies (props.anchors), the touch
 * radial wheel (long-press) and phone simple-mode presets. OWNER: UI Engineer - In-game HUD, Command Card, Minimap &
 * Input (UI-02).
 */
import type { AppContext, BattleRallyHud, FormationScreenAnchor, ScreenPropsMap } from '../../../app/contracts';
import type { BattleEventRecord, BattleState, FormationState, InputActionEvent, MoraleInputs, SideIndex } from '../../../core/types';
import { FACTIONS } from '../../../data/factions';
import { UNITS } from '../../../data/units';
import { RULES } from '../../../data/rules';
import { fatigueTier, variantStats } from '../../../sim/tactical/stats';
import { peekHeightfield, terrainKey } from '../../../core/terrain/cache';
import { append, clockGate, fmtClock, fmtInt, h, label, setAttr, setClass, setHidden, setStyle, setText, syncList } from '../../dom';
import type { Screen, UIManager } from '../../ui';
import { icon, setIcon, unitIcon } from '../../components/icons';
import { factionChip, meter, pips, ringProgress, setFactionChip, type Meter } from '../../components/widgets';
import { CommandGrid } from '../../components/commandGrid';
import { Minimap } from '../../components/minimap';
import { BATTLE_PAGES, battleCard, battlePageIndex, nextBattlePage } from '../../services/commandCards';
import { BATTLE_PRESETS, presetCommands } from '../../services/battlePresets';
import { emitHud } from '../../services/hudCommands';
import { cardSlotIndex } from '../../../input/bindings';
import { runCardSlot } from '../world/cardActions';
import { RadialWheel, radialItemsFrom, type RadialItems } from './radial';

const SPEEDS = [0.5, 1, 2, 4];
const SPEEDS_SKIRMISH = [0.5, 1, 2, 4, 8];
const FEED_MAX = 5;
const FEED_LIFE_MS = 10000;

const DOMINANT_LABEL: Readonly<Record<keyof MoraleInputs, string>> = {
  leadership: 'leadership',
  cohesion: 'ranks broken',
  fatigue: 'tired',
  supply: 'hungry',
  tacticalPosition: 'position',
  recentEvents: 'recent blows',
  perceivedRisk: 'fear',
};

const EVENT_LABEL: Readonly<Record<string, string>> = {
  flank_attacked: 'flank attacked',
  rear_attacked: 'rear attacked',
  commander_fallen: 'commander fallen',
  ally_routed: 'ally routed',
  charged: 'charged',
  heavy_casualties: 'heavy losses',
  volley_hit: 'under arrows',
  elephant_panic: 'elephants',
  enemy_routed: 'enemy routed',
  rallied: 'rallied',
  general_nearby: 'general near',
  victory_near: 'victory near',
  reinforced: 'reinforced',
  supply_threatened: 'supply threatened',
};

/** "Morale 62% - flank attacked": the freshest morale event, else the dominant input. */
export function moraleCause(f: FormationState, time: number): string {
  let best: { kind: string; t: number } | null = null;
  for (const e of f.moraleEvents) if (time - e.time < 12 && (!best || e.time > best.t) && Math.abs(e.magnitude) > 0.05) best = { kind: e.kind, t: e.time };
  if (best) return EVENT_LABEL[best.kind] ?? label(best.kind);
  const d = f.moraleBreakdown?.dominant;
  return d ? DOMINANT_LABEL[d] : '';
}

/** Short order / intent label of a formation for its card. */
export function orderLabel(f: FormationState): string {
  if (f.activity === 'routing') return 'Fleeing';
  if (f.rallyingUntil > 0 && f.activity === 'rallying') return 'Rallying';
  if (f.intent) return label(f.intent.type);
  const q = f.queue.length ? ` +${f.queue.length}` : '';
  switch (f.order.type) {
    case 'hold':
      return f.activity === 'engaged' ? 'Fighting' : f.activity === 'shooting' ? 'Shooting' : `Holding${q}`;
    case 'move_to':
      return `Moving${q}`;
    case 'attack_target':
      return `Attacking${q}`;
    default:
      return `${label(f.order.type)}${q}`;
  }
}

/** Rally state from the battle when GP-04 does not push props.rally (same reasons as the sim). */
export function deriveRally(b: Readonly<BattleState>, side: SideIndex): BattleRallyHud {
  const s = b.sides[side];
  const total = RULES.battle.commander.rallyCooldownSec;
  const cmd = s.commanderFormation >= 0 ? b.formations[s.commanderFormation] : undefined;
  const cooldown = Math.max(0, s.rallyCooldownUntil - b.time);
  let reason: string | null = null;
  if (!cmd || !s.commanderAlive || cmd.soldiers <= 0) reason = 'The commander has fallen';
  else if (cmd.activity === 'routing') reason = 'The commander is fleeing';
  else if (cmd.engagedWith.length > 0) reason = 'The commander is in the fight';
  else if (b.phase === 'deployment') reason = 'The battle has not begun';
  else if (cooldown > 0) reason = `Rally ready in ${Math.ceil(cooldown)} s`;
  return { available: reason === null, cooldownSec: cooldown, cooldownTotalSec: total, reason };
}

interface CardView {
  el: HTMLButtonElement;
  icon: HTMLElement;
  name: HTMLElement;
  count: HTMLElement;
  str: Meter;
  mor: Meter;
  cause: HTMLElement;
  fatigue: HTMLElement;
  ammo: ReturnType<typeof pips>;
  chev: HTMLElement;
  order: HTMLElement;
}

interface FloatView {
  el: HTMLElement;
  str: Meter;
  mor: Meter;
  name: HTMLElement;
}

export function battleHud(ctx: AppContext, ui: UIManager): Screen<'battle_hud'> {
  let props: ScreenPropsMap['battle_hud'] | null = null;
  let page = 'orders';
  let moreOpen = false;
  let terrainSet = false;
  const isSkirmish = ctx.session.mode === 'skirmish';

  // --- top: forces + clock + speed ------------------------------------------------------------
  const side = [0, 1].map(() => ({ chip: factionChip(null, 'md'), name: h('b', { class: 'bh-side-name' }), num: h('span', { class: 'bh-side-num' }), str: meter('strength'), mor: meter('morale') }));
  const clock = h('div', { class: 'bh-clock', role: 'timer' });
  const phase = h('div', { class: 'bh-phase' });
  const forces = h(
    'div',
    { class: 'bh-forces' },
    h('div', { class: 'bh-side left' }, h('div', { class: 'bh-side-head' }, side[0]!.chip, side[0]!.name, side[0]!.num), side[0]!.str.el, side[0]!.mor.el),
    h('div', { class: 'bh-center' }, clock, phase),
    h('div', { class: 'bh-side right' }, h('div', { class: 'bh-side-head' }, side[1]!.num, side[1]!.name, side[1]!.chip), side[1]!.str.el, side[1]!.mor.el),
  );
  const pauseBtn = h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Pause (Space)', onclick: () => (ui.sfx('ui_click'), ctx.actions.togglePause()) }, icon('pause'));
  const speedWrap = h('div', { class: 'bh-speed', role: 'group', 'aria-label': 'Battle speed' }, pauseBtn);
  const speedBtns = new Map<number, HTMLButtonElement>();
  for (const s of isSkirmish ? SPEEDS_SKIRMISH : SPEEDS) {
    const b = h('button', { class: 'btn wh-speed-btn', type: 'button', 'aria-label': `Speed ${s}x`, onclick: () => (ui.sfx('ui_click'), ctx.actions.setTimeScale(s), ctx.actions.setPaused(false)) }, `${s}×`);
    speedBtns.set(s, b);
    speedWrap.append(b);
  }
  const menuBtn = h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Menu (Esc)', onclick: () => (ui.sfx('ui_open'), ctx.actions.setPaused(true), ui.show('pause_menu', { mode: ctx.session.mode, canSave: true })) }, icon('menu'));
  const top = h('header', { class: 'bh-top panel plain', dataset: { anchor: 'battle-top' } }, forces, speedWrap, menuBtn);

  // --- deployment bar -------------------------------------------------------------------------
  const deployTimer = h('b', { class: 'bh-deploy-timer' });
  const deployHint = h('span', { class: 'bh-deploy-hint' });
  const beginBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => begin() }, icon('play'), 'Begin battle');
  const deploy = h('div', { class: 'bh-deploy panel plain ui-hidden', dataset: { anchor: 'deployment' } }, h('div', { class: 'bh-deploy-text' }, h('span', { class: 'bh-deploy-title' }, 'Deployment'), deployTimer, deployHint), beginBtn);
  const begin = (): void => {
    ui.sfx('ui_confirm');
    if (ctx.actions.skipDeployment) ctx.actions.skipDeployment();
    else ctx.actions.issueBattle({ kind: 'begin_battle' });
  };

  // --- minimap --------------------------------------------------------------------------------
  const minimap = new Minimap({
    collapsible: true,
    onJump: (x, z) => (ui.sfx('ui_click'), ctx.bus.emit('ui:camera_focus', { x, z, distance: null })),
    onMove: (x, z) => (emitHud(ui.commands, { kind: 'minimap_move', x, z }), ui.sfx('order_ack')),
    onNorthUp: (v) => ctx.actions.updateSettings({ minimapNorthUp: v }),
  });
  minimap.setNorthUp(ctx.settings.minimapNorthUp);
  const minimapDock = h('div', { class: 'bh-minimap' }, minimap.el);

  // --- formation cards strip ------------------------------------------------------------------
  const strip = h('div', { class: 'bh-strip', role: 'listbox', 'aria-label': 'Your formations', 'aria-multiselectable': 'true', dataset: { anchor: 'formation-cards' } });
  const cardViews = new Map<number, CardView>();
  const lastClick = new Map<number, number>();
  const makeCard = (f: FormationState): HTMLButtonElement => {
    const v: CardView = {
      el: h('button', { class: 'fcard', type: 'button', role: 'option' }),
      icon: icon(unitIcon(f.unitClass)),
      name: h('span', { class: 'fc-name' }),
      count: h('span', { class: 'fc-count' }),
      str: meter('strength'),
      mor: meter('morale'),
      cause: h('span', { class: 'fc-cause' }),
      fatigue: h('span', { class: 'fc-fatigue' }),
      ammo: pips(5, 'ammo-pips'),
      chev: h('span', { class: 'fc-chev' }),
      order: h('span', { class: 'fc-order' }),
    };
    append(v.el, h('div', { class: 'fc-head' }, v.icon, v.name, v.count), v.str.el, v.mor.el, h('div', { class: 'fc-line' }, v.cause, v.chev), h('div', { class: 'fc-line' }, v.fatigue, v.ammo.el), v.order);
    v.el.addEventListener('click', (e) => {
      const now = performance.now();
      const dbl = now - (lastClick.get(f.index) ?? 0) < 320;
      lastClick.set(f.index, now);
      ctx.bus.emit('ui:select_formations', { formations: [f.index], additive: e.shiftKey || e.ctrlKey });
      ui.sfx('ui_click');
      const st = props?.battle.formations[f.index];
      if (dbl && st) ctx.bus.emit('ui:camera_focus', { x: st.x, z: st.z, distance: null });
    });
    ui.tooltips.attach(v.el, () => {
      const st = props?.battle.formations[f.index];
      if (!st) return null;
      const stats = variantStats(props!.battle.sides[st.side].factionId, st.unitClass);
      return {
        title: st.name,
        icon: unitIcon(st.unitClass),
        rows: [
          ['Strength', `${fmtInt(st.soldiers)} / ${fmtInt(st.maxSoldiers)}`],
          ['Morale', `${Math.round(st.morale)}${moraleCause(st, props!.battle.time) ? ` - ${moraleCause(st, props!.battle.time)}` : ''}`, st.morale < 40 ? 'danger' : null],
          ['Fatigue', label(fatigueTier(st.fatigue)), st.fatigue >= 0.5 ? 'warning' : null],
          ['Cohesion', `${Math.round(st.cohesion * 100)}%`],
          ...(stats.ammo > 0 ? ([['Volleys', `${st.ammo} / ${stats.ammo}`, st.ammo === 0 ? 'danger' : null]] as const) : []),
          ['Shape', label(st.shape)],
          ['Stance', label(st.stance)],
        ] as const,
        hint: 'Tap to select, double-tap to look, Shift adds.',
      };
    });
    cardViews.set(f.index, v);
    return v.el;
  };

  // --- command card + rally + select all + simple presets ------------------------------------
  const grid = new CommandGrid({
    tooltips: ui.tooltips,
    header: false,
    onActivate: (slot, shift) => runCardSlot(ctx, ui, slot, shift, null),
    onTab: (id) => setPage(id),
    onRefused: () => ui.sfx('ui_error'),
  });
  const selAll = h('button', { class: 'btn small bh-selall', type: 'button', onclick: () => (ctx.input.injectAction('select_all'), ui.sfx('ui_click')) }, icon('o_select_all'), 'All');
  const ring = ringProgress(64, 5);
  const rallyBtn = h('button', { class: 'btn bh-rally', type: 'button', 'aria-label': 'Commander rally', dataset: { anchor: 'rally' } }, ring.el, icon('o_rally'), h('span', { class: 'bh-rally-label' }, 'Rally'));
  let rallyState: BattleRallyHud | null = null;
  rallyBtn.addEventListener('click', () => {
    if (!rallyState?.available) {
      ui.tooltips.open(rallyBtn, { title: 'Commander rally', hint: rallyState?.reason ?? '', hintTone: 'danger' }, true);
      ui.sfx('ui_error');
      return;
    }
    ctx.actions.issueBattle({ kind: 'rally' });
    ctx.bus.emit('audio:sfx', { sfx: 'conch' });
  });
  ui.tooltips.attach(rallyBtn, () => ({ title: 'Commander rally', text: `Own formations within ${RULES.battle.commander.rallyRadius} m gain +${RULES.battle.commander.rallyMorale} morale; fleeing ones above ${RULES.battle.commander.rallyRoutersAbove} rally. Every ${RULES.battle.commander.rallyCooldownSec} s.`, hint: rallyState?.reason ?? 'Ready', hintTone: rallyState?.available ? 'positive' : 'danger' }));
  const presets = h('div', { class: 'bh-presets', role: 'group', 'aria-label': 'Quick formations' });
  for (const p of BATTLE_PRESETS) {
    const b = h('button', { class: 'btn small bh-preset', type: 'button' }, icon(p.icon), p.label);
    b.addEventListener('click', () => {
      if (!props) return;
      const cmds = presetCommands(props.battle, props.playerSide, p.id);
      if (!cmds.length) {
        ui.toast(p.id === 'archers_behind' ? 'No archers to place' : p.id === 'horse_wings' ? 'No horse to send out' : 'No formation can move', 'warning', 1600);
        ui.sfx('ui_error');
        return;
      }
      for (const c of cmds) ctx.actions.issueBattle(c);
      ui.sfx('order_ack');
    });
    ui.tooltips.attach(b, () => ({ title: p.label, text: p.desc }));
    presets.append(b);
  }
  const moreBtn = h('button', { class: 'btn small bh-more', type: 'button', 'aria-expanded': 'false', onclick: () => ((moreOpen = !moreOpen), ui.sfx('ui_click'), renderMode()) }, icon('more'), 'More');
  presets.append(moreBtn);
  const cardPanel = h('section', { class: 'bh-card panel', 'aria-label': 'Orders' }, grid.el, h('div', { class: 'bh-card-side' }, selAll));
  const bottom = h('div', { class: 'bh-bottom' }, strip, presets, cardPanel);

  // --- feed + radial + floating ---------------------------------------------------------------
  const feed = h('div', { class: 'bh-feed', role: 'log', 'aria-live': 'polite', dataset: { anchor: 'battle-feed' } });
  const feedItems: { key: string; text: string; tone: string; icon: string; t: number; x: number | null; z: number | null }[] = [];
  let feedSeq = 0;
  const radial = new RadialWheel(ui.tooltips, (s) => runCardSlot(ctx, ui, s, false, null), () => ui.sfx('ui_error'));
  const floatLayer = h('div', { class: 'bh-floats' });
  ui.anchorsLayer.append(floatLayer);
  const floats = new Map<number, FloatView>();

  const el = h('div', { class: 'screen-battle-hud hud-root' }, top, deploy, minimapDock, feed, bottom, rallyBtn, radial.el);

  // ------------------------------------------------------------------------------------------- behaviour
  const simple = (): boolean => {
    const s = ctx.settings.simpleMode;
    return s === 'auto' ? ctx.input.touchMode || ui.layout !== 'pc' : s;
  };
  const renderMode = (): void => {
    const sm = simple();
    setHidden(presets, !sm);
    setHidden(cardPanel, sm && !moreOpen);
    setClass(moreBtn, 'active', moreOpen);
    setAttr(moreBtn, 'aria-expanded', moreOpen ? 'true' : 'false');
  };
  const setPage = (id: string): void => {
    page = BATTLE_PAGES.some((p) => p.id === id) ? id : 'orders';
    ctx.input.setCardPage(battlePageIndex(page));
    ui.sfx('ui_click');
    renderCard();
    if (page === 'intents') ctx.bus.emit('ui:hint', { key: 'battle.intent_available' });
  };
  const cardGate = clockGate(250);
  const renderCard = (): void => {
    if (!props) return;
    grid.set(battleCard(props.battle, props.playerSide, props.selection, page, { preset: ctx.input.preset, overrides: ctx.settings.keybindings }));
  };

  const radialItems = (): RadialItems => {
    const p = props!;
    const c = { preset: ctx.input.preset, overrides: ctx.settings.keybindings };
    return radialItemsFrom(battleCard(p.battle, p.playerSide, p.selection, 'orders', c), battleCard(p.battle, p.playerSide, p.selection, 'shapes', c), battleCard(p.battle, p.playerSide, p.selection, 'intents', c));
  };

  const renderFeed = (): void => {
    const now = performance.now();
    for (let i = feedItems.length - 1; i >= 0; i--) if (now - feedItems[i]!.t > FEED_LIFE_MS) feedItems.splice(i, 1);
    while (feedItems.length > (ui.layout === 'pc' ? FEED_MAX : 2)) feedItems.shift();
    syncList(
      feed,
      feedItems,
      (f) => f.key,
      (f) => {
        const b = h('button', { class: `feed-item ${f.tone}`, type: 'button', disabled: f.x === null }, icon(f.icon), h('span', null, f.text));
        b.addEventListener('click', () => {
          if (f.x !== null && f.z !== null) ctx.bus.emit('ui:camera_focus', { x: f.x, z: f.z, distance: null });
        });
        return b;
      },
      () => undefined,
    );
  };
  const feedTimer = setInterval(() => ui.measure(renderFeed), 1000);

  const onBattleEvents = (events: readonly BattleEventRecord[]): void => {
    if (!props) return;
    const ps = props.playerSide;
    const b = props.battle;
    const now = performance.now();
    for (const e of events) {
      const f = e.formation !== null ? b.formations[e.formation] : null;
      const mine = e.side === ps;
      let text = '';
      let tone = 'info';
      let ic = 'flag';
      switch (e.kind) {
        case 'formation_routed':
          text = mine ? `${f?.name ?? 'A formation'} breaks and runs!` : `${f?.name ?? 'An enemy formation'} flees`;
          tone = mine ? 'danger' : 'success';
          ic = 'o_withdraw';
          if (mine) ctx.bus.emit('ui:hint', { key: 'battle.formation_routed' });
          break;
        case 'formation_rallied':
          text = `${f?.name ?? 'A formation'} rallies`;
          tone = mine ? 'success' : 'warning';
          ic = 'o_rally';
          break;
        case 'commander_fallen':
          text = mine ? 'Our commander has fallen!' : 'The enemy commander has fallen!';
          tone = mine ? 'danger' : 'success';
          ic = 'crown';
          break;
        case 'flank_collapsed':
          text = mine ? 'Our flank is collapsing' : 'Their flank collapses';
          tone = mine ? 'danger' : 'success';
          ic = 'o_flank';
          break;
        case 'elephant_rampage':
          text = 'Elephants rampage!';
          tone = 'warning';
          ic = 'unit-war-elephants';
          break;
        case 'gate_breached':
          text = 'The gate is breached!';
          tone = mine ? 'success' : 'danger';
          ic = 'b_fort_walls';
          break;
        case 'ammo_depleted':
          if (!mine) continue;
          text = `${f?.name ?? 'Archers'}: no arrows left`;
          tone = 'warning';
          ic = 'unit-archers';
          break;
        case 'objective_complete':
          text = e.text ?? 'Objective complete';
          tone = mine ? 'success' : 'warning';
          ic = 'star';
          break;
        case 'deployment_ended':
          text = 'The battle begins';
          ic = 'swords';
          ctx.bus.emit('ui:hint', { key: 'battle.start' });
          break;
        case 'side_withdrew':
          text = mine ? 'Our army withdraws' : 'The enemy withdraws';
          tone = mine ? 'danger' : 'success';
          ic = 'a_retreat';
          break;
        default:
          continue;
      }
      feedItems.push({ key: `b${++feedSeq}`, text, tone, icon: ic, t: now, x: e.x ?? f?.x ?? null, z: e.z ?? f?.z ?? null });
      if (e.x !== null && e.z !== null) minimap.ping(e.x, e.z, tone === 'danger' ? 'danger' : tone === 'success' ? 'success' : 'warning');
    }
    renderFeed();
  };

  const onAction = (e: InputActionEvent): void => {
    if (!props) return;
    ui.measure(() => {
      const slot = cardSlotIndex(e.action);
      if (slot >= 0) {
        grid.activate(slot, e.shift);
        return;
      }
      if (e.action === 'card_next_tab') setPage(nextBattlePage(page));
      else if (e.action === 'radial_menu' && e.pointer) {
        const z = ui.scale || 1;
        radial.show(e.pointer.x / z, e.pointer.y / z, (typeof window !== 'undefined' ? window.innerWidth : 1280) / z, (typeof window !== 'undefined' ? window.innerHeight : 720) / z, radialItems());
        ui.sfx('ui_open');
      } else if (e.action === 'cancel' && radial.isOpen) radial.close();
    });
  };

  const offs = [
    ctx.bus.on('input:action', onAction),
    ctx.bus.on('battle:events', ({ events }) => ui.measure(() => onBattleEvents(events))),
    ctx.bus.on('settings:changed', ({ settings }) => {
      minimap.setNorthUp(settings.minimapNorthUp);
      renderMode();
    }),
    ui.onLayout(() => {
      renderMode();
      minimap.setCollapsed(ui.layout !== 'pc');
    }),
  ];
  minimap.setCollapsed(ui.layout !== 'pc');
  ctx.input.setCardPage(0);

  const renderFloats = (anchors: readonly FormationScreenAnchor[] | undefined, b: Readonly<BattleState>, ps: SideIndex, sel: ReadonlySet<number>): void => {
    const seen = new Set<number>();
    for (const a of anchors ?? []) {
      const f = b.formations[a.index];
      if (!f || !a.visible || f.soldiers <= 0) continue;
      seen.add(a.index);
      let v = floats.get(a.index);
      if (!v) {
        const str = meter('strength');
        const mor = meter('morale');
        const name = h('span', { class: 'ff-name' });
        const el = h('div', { class: `ffloat ${f.side === ps ? 'own' : 'enemy'}` }, h('div', { class: 'ff-head' }, icon(unitIcon(f.unitClass)), name), str.el, mor.el);
        v = { el, str, mor, name };
        floats.set(a.index, v);
        floatLayer.append(el);
      }
      const selected = sel.has(a.index);
      setClass(v.el, 'selected', selected);
      setClass(v.el, 'routing', f.activity === 'routing');
      setClass(v.el, 'compact', !selected);
      setText(v.name, selected ? `${f.name} · ${fmtInt(f.soldiers)}` : '');
      v.str.set(f.soldiers / Math.max(1, f.maxSoldiers));
      v.mor.set(f.morale / 100, { warn: f.morale < 40 });
      const s = Math.max(0.6, Math.min(1.2, a.scale)) * (ui.scale || 1);
      setStyle(v.el, 'transform', `translate(${Math.round(a.x)}px, ${Math.round(a.y)}px) translate(-50%, -100%) scale(${s.toFixed(2)})`);
      setHidden(v.el, false);
    }
    for (const [i, v] of floats) if (!seen.has(i)) setHidden(v.el, true);
  };

  return {
    id: 'battle_hud',
    layer: 'hud',
    el,
    update(p) {
      props = p;
      const b = p.battle;
      const ps = p.playerSide;
      if (!terrainSet) {
        terrainSet = true;
        const hf = peekHeightfield(b.setup.terrain);
        if (hf) minimap.setTerrain(hf, terrainKey(b.setup.terrain));
      }
      // Forces
      for (const i of [0, 1] as const) {
        const s = b.sides[i];
        const v = side[i]!;
        setFactionChip(v.chip, s.factionId);
        setText(v.name, `${FACTIONS[s.factionId]?.shortName ?? s.factionId}${i === ps ? ' (you)' : ''}`);
        setText(v.num, fmtInt(s.soldiers));
        v.str.set(s.soldiers / Math.max(1, s.initialSoldiers));
        v.mor.set(s.averageMorale / 100, { warn: s.averageMorale < 40 });
        setAttr(v.str.el, 'aria-label', `${FACTIONS[s.factionId]?.name ?? ''}: ${fmtInt(s.soldiers)} of ${fmtInt(s.initialSoldiers)}`);
      }
      const dep = p.deployment !== undefined ? p.deployment : b.phase === 'deployment' ? { remainingSec: Math.max(0, b.deploymentEndsAt - b.time), zone: b.setup.sides[ps].deployZone, canBegin: true } : null;
      setText(clock, fmtClock(dep ? dep.remainingSec : b.time - b.deploymentEndsAt));
      setText(phase, dep ? 'Deploying' : b.outcome ? 'Over' : p.paused ? 'Paused' : '');
      setClass(top, 'paused', p.paused);
      setClass(pauseBtn, 'active', p.paused);
      for (const [sp, btn] of speedBtns) {
        setClass(btn, 'active', !p.paused && Math.abs(p.timeScale - sp) < 0.01);
        setHidden(btn, ui.layout !== 'pc' && (sp === 0.5 || sp === 8));
      }
      // Deployment
      setHidden(deploy, !dep);
      if (dep) {
        setText(deployTimer, fmtClock(dep.remainingSec));
        setText(deployHint, ctx.input.touchMode ? 'Drag formations inside your zone' : 'Drag formations inside your zone; right-drag sets facing and frontage');
        beginBtn.disabled = !dep.canBegin;
      }
      // Cards strip
      const sel = new Set(p.selection);
      const own = b.formations.filter((f) => f.side === ps && f.soldiers > 0 && f.activity !== 'destroyed');
      syncList(strip, own, (f) => String(f.index), makeCard, (node, f) => {
        const v = cardViews.get(f.index);
        if (!v) return;
        const stats = variantStats(b.sides[ps].factionId, f.unitClass);
        setIcon(v.icon, unitIcon(f.unitClass));
        setText(v.name, f.name.length > 18 ? UNITS[f.unitClass].shortName ?? f.name : f.name);
        setText(v.count, fmtInt(f.soldiers));
        v.str.set(f.soldiers / Math.max(1, f.maxSoldiers));
        v.mor.set(f.morale / 100, { warn: f.morale < 40 });
        const cause = moraleCause(f, b.time);
        setText(v.cause, `Morale ${Math.round(f.morale)}${cause ? ` - ${cause}` : ''}`);
        const tier = fatigueTier(f.fatigue);
        setText(v.fatigue, label(tier));
        setClass(v.fatigue, 'warning', tier === 'tired' || tier === 'exhausted');
        setClass(v.fatigue, 'danger', tier === 'spent');
        setHidden(v.ammo.el, stats.ammo <= 0);
        if (stats.ammo > 0) v.ammo.set(Math.ceil((f.ammo / stats.ammo) * 5), 5);
        const exp = f.experience;
        setText(v.chev, exp >= 0.75 ? '^^^' : exp >= 0.45 ? '^^' : exp >= 0.2 ? '^' : '');
        setText(v.order, orderLabel(f));
        setClass(node, 'selected', sel.has(f.index));
        setClass(node, 'routing', f.activity === 'routing');
        setClass(node, 'wavering', f.morale < 40 && f.activity !== 'routing');
        setAttr(node, 'aria-selected', sel.has(f.index) ? 'true' : 'false');
        setAttr(node, 'aria-label', `${f.name}: ${fmtInt(f.soldiers)} men, morale ${Math.round(f.morale)}, ${label(tier)}, ${orderLabel(f)}`);
      });
      // Card (gated: selection / page / preset change at once, sim changes at most 4 Hz), rally, mode
      if (cardGate(`${p.selection.join(',')}|${page}|${ctx.input.preset}|${JSON.stringify(ctx.settings.keybindings ?? {})}`, b.tick)) renderCard();
      rallyState = p.rally ?? deriveRally(b, ps);
      const frac = rallyState.cooldownTotalSec > 0 ? 1 - rallyState.cooldownSec / rallyState.cooldownTotalSec : 1;
      ring.set(rallyState.available ? 1 : frac);
      setClass(rallyBtn, 'ready', rallyState.available);
      setClass(rallyBtn, 'disabled', !rallyState.available);
      setAttr(rallyBtn, 'aria-disabled', rallyState.available ? null : 'true');
      setAttr(rallyBtn, 'aria-label', `Commander rally${rallyState.reason ? ` - ${rallyState.reason}` : ''}`);
      setHidden(rallyBtn, !!b.outcome);
      renderMode();
      minimap.setBattle(b, ps, p.selection, ui.feeds);
      renderFloats(p.anchors, b, ps, sel);
    },
    dispose() {
      clearInterval(feedTimer);
      for (const off of offs) off();
      minimap.dispose();
      floatLayer.remove();
      ctx.input.setCardPage(0);
    },
  };
}
