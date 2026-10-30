/**
 * World HUD (DESIGN_SPEC §8.1, §8.7, §8.8, §12.2, §12.6): top bar (realm, six-resource bar with trends and tooltips,
 * date / season / weather / monsoon forecast, speed, menu), realm buttons with alert badges, objectives tracker by
 * act, minimap (bottom-left), selection info + AoE command card + control groups (bottom-centre), notification feed
 * (max 5, click to focus). Phones: compact bar (Grain / Wealth / Recruits + chevron), minimap button, card as a
 * bottom sheet, objectives behind a scroll button, feed as toasts.
 * OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 */
import type { AppContext, ScreenId, WorldSelection } from '../../../app/contracts';
import type { InputActionEvent, WorldState } from '../../../core/types';
import { SCENARIOS } from '../../../data/campaign';
import { AGES } from '../../../data/ages';
import { settlementVitals, armySupplyView, pendingProposals, ageView } from '../../../sim/strategic/selectors';
import { regionTerrain } from '../../../sim/strategic/state';
import { terrainKey } from '../../../core/terrain/cache';
import { append, clockGate, fmtCompact, fmtDays, fmtInt, fmtPct, h, label, setAttr, setClass, setHidden, setText, syncList } from '../../dom';
import type { Screen, UIManager } from '../../ui';
import { icon, setIcon } from '../../components/icons';
import { factionChip, meter, setFactionChip } from '../../components/widgets';
import { CommandGrid } from '../../components/commandGrid';
import { Minimap } from '../../components/minimap';
import { armyCard, nextSettlementTab, settlementCard, type CardModel } from '../../services/commandCards';
import { dateBlock, idleBuilderSettlements, PHONE_RESOURCES, resourceBar } from '../../services/resourceBar';
import { emitHud } from '../../services/hudCommands';
import { cardSlotIndex } from '../../../input/bindings';
import { controlGroupRow, openWorldScreen, runCardSlot } from './cardActions';
import { factionName, feedEntry, sfx, type FeedEntry } from './common';

const SPEEDS_PC = [1, 2, 4, 8];
const SPEEDS_PHONE = [1, 2, 4];
const FEED_MAX = 5;
const FEED_LIFE_MS = 14000;

/** World panels the HUD keeps live with the latest world (props other than `world` are kept). */
const LIVE_PANELS: readonly ScreenId[] = ['settlement_panel', 'army_panel', 'province_panel', 'diplomacy', 'market', 'age_panel', 'economy_panel', 'chronicle', 'build_placement'];

interface ResChipView {
  el: HTMLButtonElement;
  value: HTMLElement;
  trend: HTMLElement;
  badge: HTMLElement;
}

export function worldHud(ctx: AppContext, ui: UIManager): Screen<'world_hud'> {
  let world: WorldState | null = null;
  let selection: WorldSelection = { kind: 'none', id: null };
  let tab = 'economy';
  let resModel = [] as ReturnType<typeof resourceBar>;
  let alertsFromBus = false;
  let lastPaused = false;

  // --- top bar -------------------------------------------------------------------------------
  const realmChip = factionChip(null, 'md');
  const realmName = h('span', { class: 'wh-realm-name' });
  const ageBadge = h('span', { class: 'wh-age', title: 'Current age' });
  const realm = h('div', { class: 'wh-realm' }, realmChip, h('div', { class: 'wh-realm-text' }, realmName, ageBadge));
  const resWrap = h('div', { class: 'wh-res', role: 'group', 'aria-label': 'Resources', dataset: { anchor: 'resource-bar' } });
  const resChips = new Map<string, ResChipView>();
  const top = h('header', { class: 'wh-top panel plain', dataset: { anchor: 'top-bar' } });
  const chevron = h('button', { class: 'btn icon ghost wh-res-more', type: 'button', 'aria-label': 'Show all resources', 'aria-expanded': 'false', onclick: () => toggleRes() }, icon('chevron_down'));
  const toggleRes = (): void => {
    const on = !top.classList.contains('res-expanded');
    setClass(top, 'res-expanded', on);
    setAttr(chevron, 'aria-expanded', on ? 'true' : 'false');
    setIcon(chevron.firstElementChild as HTMLElement, on ? 'chevron_up' : 'chevron_down');
  };
  const seasonIcon = icon('season_vasanta');
  const dateText = h('span', { class: 'wh-date-text' });
  const seasonText = h('span', { class: 'wh-season-text' });
  const weatherIcon = icon('w_clear');
  const weatherText = h('span', { class: 'wh-weather-text' });
  const forecast = h('div', { class: 'wh-forecast ui-hidden', role: 'status' });
  const dateEl = h('div', { class: 'wh-date', dataset: { anchor: 'date' } }, h('div', { class: 'wh-date-row' }, seasonIcon, dateText), h('div', { class: 'wh-date-sub' }, seasonText, h('span', { class: 'wh-dot' }, '·'), weatherIcon, weatherText), forecast);
  const pauseBtn = h('button', { class: 'btn icon wh-pause', type: 'button', 'aria-label': 'Pause (Space)', onclick: () => (sfx(ctx), ctx.actions.togglePause()) }, icon('pause'));
  const speedWrap = h('div', { class: 'wh-speed', role: 'group', 'aria-label': 'Game speed', dataset: { anchor: 'speed' } }, pauseBtn);
  const speedBtns = new Map<number, HTMLButtonElement>();
  for (const s of SPEEDS_PC) {
    const b = h('button', { class: 'btn wh-speed-btn', type: 'button', 'aria-label': `Speed ${s}x`, dataset: { speed: String(s) }, onclick: () => (sfx(ctx), ctx.actions.setTimeScale(s), ctx.actions.setPaused(false)) }, `${s}×`);
    speedBtns.set(s, b);
    speedWrap.append(b);
  }
  const menuBtn = h('button', { class: 'btn icon wh-menu', type: 'button', 'aria-label': 'Menu (Esc)', onclick: () => (sfx(ctx, 'ui_open'), ctx.actions.setPaused(true), ui.show('pause_menu', { mode: ctx.session.mode, canSave: true })) }, icon('menu'));
  append(top, realm, resWrap, chevron, dateEl, speedWrap, menuBtn);

  // --- realm buttons -------------------------------------------------------------------------
  const realmDefs: { id: ScreenId; label: string; icon: string; anchor: string }[] = [
    { id: 'diplomacy', label: 'Diplomacy', icon: 'diplomacy', anchor: 'realm-diplomacy' },
    { id: 'council', label: 'Council', icon: 'council', anchor: 'realm-council' },
    { id: 'age_panel', label: 'Ages', icon: 'ages', anchor: 'realm-ages' },
    { id: 'economy_panel', label: 'Economy', icon: 'economy', anchor: 'realm-economy' },
    { id: 'chronicle', label: 'Chronicle', icon: 'scroll', anchor: 'realm-chronicle' },
  ];
  const realmBadges = new Map<ScreenId, HTMLElement>();
  const realmNav = h('nav', { class: 'wh-realm-btns', 'aria-label': 'Realm' });
  let chronicleSeen = 0;
  for (const d of realmDefs) {
    const badge = h('span', { class: 'badge ui-hidden' });
    realmBadges.set(d.id, badge);
    const b = h(
      'button',
      {
        class: 'btn realm-btn',
        type: 'button',
        dataset: { anchor: d.anchor },
        'aria-label': d.label,
        onclick: () => {
          if (!world) return;
          sfx(ctx, 'ui_open');
          if (d.id === 'chronicle') chronicleSeen = world.chronicle.length;
          if (ui.isVisible(d.id)) ui.hide(d.id);
          else openWorldScreen(ctx, ui, d.id, world);
        },
      },
      icon(d.icon),
      h('span', { class: 'realm-label' }, d.label),
      badge,
    );
    ui.tooltips.attach(b, () => ({ title: d.label, text: realmTip(d.id) }));
    realmNav.append(b);
  }
  const realmTip = (id: ScreenId): string => {
    if (!world) return '';
    const me = world.playerFactionId;
    switch (id) {
      case 'diplomacy': {
        const n = pendingProposals(world, me).length;
        return n ? `${n} envoy${n > 1 ? 's' : ''} await an answer.` : 'Treaties, envoys and war.';
      }
      case 'council':
        return `${world.factions[me]?.councilAdvice.length ?? 0} recommendations this month.`;
      case 'age_panel':
        return 'Raise a landmark to enter the next age.';
      case 'economy_panel':
        return 'Ledger, taxes, the royal reserve and rationing.';
      default:
        return 'The record of your reign.';
    }
  };

  // --- objectives ----------------------------------------------------------------------------
  const objTitle = h('div', { class: 'wh-obj-title' });
  const objSub = h('div', { class: 'wh-obj-sub' });
  const objList = h('ul', { class: 'list-lotus wh-obj-list' });
  const objToggle = h('button', { class: 'btn icon wh-obj-toggle', type: 'button', 'aria-label': 'Objectives', 'aria-expanded': 'true', onclick: () => toggleObj() }, icon('scroll'));
  const objectives = h('aside', { class: 'wh-objectives', dataset: { anchor: 'objectives' } }, objToggle, h('div', { class: 'wh-obj-body panel plain' }, objTitle, objSub, objList));
  const toggleObj = (): void => {
    const on = !objectives.classList.contains('collapsed');
    setClass(objectives, 'collapsed', on);
    setAttr(objToggle, 'aria-expanded', on ? 'false' : 'true');
  };

  // --- minimap -------------------------------------------------------------------------------
  const minimap = new Minimap({
    collapsible: true,
    onJump: (x, z) => (sfx(ctx), ctx.bus.emit('ui:camera_focus', { x, z, distance: null })),
    onMove: (x, z) => {
      emitHud(ui.commands, { kind: 'minimap_move', x, z });
      ctx.bus.emit('audio:sfx', { sfx: 'order_ack' });
    },
    onNorthUp: (v) => ctx.actions.updateSettings({ minimapNorthUp: v }),
  });
  minimap.setNorthUp(ctx.settings.minimapNorthUp);
  const minimapDock = h('div', { class: 'wh-minimap' }, minimap.el);

  // --- selection info + command card ---------------------------------------------------------
  const selChip = factionChip(null, 'sm');
  const selName = h('div', { class: 'sel-name' });
  const selSub = h('div', { class: 'sel-sub' });
  const selStats = h('div', { class: 'sel-stats' });
  const selMeters = h('div', { class: 'sel-meters' });
  const selAction = h('button', { class: 'btn small sel-action', type: 'button' });
  const selVisit = h('button', { class: 'btn small ghost sel-visit', type: 'button' }, icon('a_visit'), 'Visit');
  const selInfo = h('div', { class: 'sel-info' }, h('div', { class: 'sel-head' }, selChip, h('div', null, selName, selSub)), selStats, selMeters, h('div', { class: 'sel-actions' }, selAction, selVisit));
  const grid = new CommandGrid({
    tooltips: ui.tooltips,
    onActivate: (slot, shift) => runCardSlot(ctx, ui, slot, shift, world),
    onTab: (id) => {
      tab = id;
      sfx(ctx);
      renderCard();
    },
    onRefused: () => sfx(ctx, 'ui_error'),
  });
  const groups = controlGroupRow(ctx);
  const cardPanel = h('section', { class: 'wh-card panel', 'aria-label': 'Selection and commands' }, h('button', { class: 'sheet-handle', type: 'button', 'aria-label': 'Expand', onclick: () => cardPanel.classList.toggle('sheet-full') }), selInfo, grid.el);
  const bottom = h('div', { class: 'wh-bottom' }, groups.el, cardPanel);

  // --- feed ----------------------------------------------------------------------------------
  const feed = h('div', { class: 'wh-feed', role: 'log', 'aria-live': 'polite', 'aria-label': 'Notifications', dataset: { anchor: 'feed' } });
  const feedItems: (FeedEntry & { t: number })[] = [];

  const el = h('div', { class: 'screen-world-hud hud-root' }, top, realmNav, objectives, minimapDock, bottom, feed);

  // ------------------------------------------------------------------------------------------- behaviour
  const renderFeed = (): void => {
    const now = performance.now();
    for (let i = feedItems.length - 1; i >= 0; i--) if (now - feedItems[i]!.t > FEED_LIFE_MS) feedItems.splice(i, 1);
    const max = ui.layout === 'pc' ? FEED_MAX : 2;
    while (feedItems.length > max) feedItems.shift();
    syncList(
      feed,
      feedItems,
      (f) => f.key,
      (f) => {
        const b = h('button', { class: `feed-item ${f.severity}`, type: 'button', disabled: !f.focus && !f.select }, icon(f.icon), h('span', null, f.text));
        b.addEventListener('click', () => {
          sfx(ctx);
          if (f.focus) ctx.bus.emit('ui:camera_focus', { x: f.focus.x, z: f.focus.z, distance: null });
          if (f.select) ctx.bus.emit('ui:world_select', f.select);
        });
        return b;
      },
      () => undefined,
    );
  };
  const feedTimer = setInterval(() => ui.measure(renderFeed), 1000);

  const resChip = (id: string): ResChipView => {
    let v = resChips.get(id);
    if (v) return v;
    const value = h('b', { class: 'res-value' });
    const trend = h('span', { class: 'res-trend' });
    const badge = h('span', { class: 'badge ui-hidden' });
    const entry = resModel.find((r) => r.id === id)!;
    const b = h('button', { class: 'res-chip chip', type: 'button', dataset: { res: id } }, icon(entry.icon, entry.colorClass), value, trend, badge);
    b.addEventListener('click', () => {
      if (id === 'labor' && world && idleBuilderSettlements(world, world.playerFactionId).length) cycleIdle();
      else ui.tooltips.open(b, () => tipFor(id), true);
    });
    ui.tooltips.attach(b, () => tipFor(id));
    v = { el: b, value, trend, badge };
    resChips.set(id, v);
    resWrap.append(b);
    return v;
  };
  const tipFor = (id: string) => {
    const r = resModel.find((x) => x.id === id);
    if (!r) return null;
    return { title: r.tooltipTitle, icon: r.icon, iconClass: r.colorClass, rows: r.rows.map((x) => [x.label, x.value, x.tone ?? null] as const), hint: r.hint };
  };

  let idleIdx = 0;
  const cycleIdle = (): void => {
    if (!world) return;
    const ids = idleBuilderSettlements(world, world.playerFactionId);
    if (!ids.length) return;
    const id = ids[idleIdx++ % ids.length]!;
    const s = world.settlements[id]!;
    ctx.bus.emit('ui:world_select', { kind: 'settlement', id });
    ctx.bus.emit('ui:camera_focus', { x: s.x, z: s.z, distance: null });
    ctx.bus.emit('ui:hint', { key: 'world.idle_builders' });
  };
  let armyIdx = 0;
  const cycleArmy = (): void => {
    if (!world) return;
    const ids = Object.keys(world.armies)
      .sort()
      .filter((id) => {
        const a = world!.armies[id]!;
        return a.factionId === world!.playerFactionId && (a.order.kind === 'idle' || a.status === 'camped') && a.status !== 'disbanded';
      });
    if (!ids.length) return;
    const a = world.armies[ids[armyIdx++ % ids.length]!]!;
    ctx.bus.emit('ui:world_select', { kind: 'army', id: a.id });
    ctx.bus.emit('ui:camera_focus', { x: a.x, z: a.z, distance: null });
  };

  const currentCard = (): CardModel | null => {
    if (!world) return null;
    const cctx = { preset: ctx.input.preset, overrides: ctx.settings.keybindings };
    if (selection.kind === 'settlement' && selection.id) return settlementCard(world, selection.id, tab, cctx);
    if (selection.kind === 'army' && selection.id) return armyCard(world, selection.id, cctx);
    return null;
  };
  const renderCard = (): void => {
    const m = currentCard();
    setHidden(grid.el, !m || (m.kind === 'settlement' && m.tabs.length === 0));
    if (m) grid.set(m);
  };
  // Throttle gates (sim hours move 12 per second at 1x; the expensive selectors run at most a few times a second).
  const topGate = clockGate(400);
  const selGate = clockGate(300);
  const cardGate = clockGate(500);
  const objGate = clockGate(1000);
  const panelGate = clockGate(400);
  let cardVersion = 0;
  let kbRef: unknown = null;

  const renderSelection = (): void => {
    const w = world;
    if (!w) return;
    const kind = selection.kind;
    setHidden(bottom, kind === 'none' && ui.layout !== 'pc' && ui.feeds.worldGroups.length === 0);
    setClass(cardPanel, 'empty', kind === 'none');
    selStats.textContent = '';
    selMeters.textContent = '';
    setHidden(selVisit, true);
    if (kind === 'settlement' && selection.id) {
      const s = w.settlements[selection.id];
      const v = s ? settlementVitals(w, s.id) : null;
      if (!s || !v) return;
      setFactionChip(selChip, s.ownerFactionId);
      setText(selName, s.name);
      setText(selSub, `${label(s.kind)} · ${factionName(s.ownerFactionId)}`);
      const stat = (ic: string, txt: string, cls = '', tip = ''): HTMLElement => {
        const e = h('span', { class: `sel-stat ${cls}`, title: tip }, icon(ic), txt);
        selStats.append(e);
        return e;
      };
      stat('villager', fmtCompact(v.population), '', 'Population');
      stat('sheaf', fmtDays(v.reserveDays), `reserve-${v.reserveColor}`, 'Grain reserve');
      stat('crown', fmtPct(v.loyalty), v.loyalty < 0.4 ? 'danger' : '', 'Loyalty');
      stat('alert', label(v.stage), v.stage === 'calm' ? 'positive' : ['grumbling'].includes(v.stage) ? 'warning' : 'danger', 'Order');
      const job = v.construction[0];
      if (job) {
        const m = meter('progress');
        m.set(job.progress);
        selMeters.append(h('div', { class: 'sel-job' }, h('span', null, `${job.landmarkId ? 'Landmark' : label(job.type)} ${Math.round(job.progress * 100)}%${job.daysLeft !== null ? ` · ${fmtDays(job.daysLeft)}` : ''}`), m.el));
      }
      if (v.cutOff && v.cutOffReason) selMeters.append(h('div', { class: 'sel-warn danger' }, icon('alert'), v.cutOffReason));
      if (v.besiegedBy) selMeters.append(h('div', { class: 'sel-warn danger' }, icon('a_besiege'), `Besieged · walls ${Math.round((v.wallHp / Math.max(1, v.maxWallHp)) * 100)}%`));
      selAction.textContent = '';
      append(selAction, icon('b_palace'), s.ownerFactionId === w.playerFactionId ? 'Govern' : 'Details');
      selAction.onclick = () => (sfx(ctx, 'ui_open'), ui.show('settlement_panel', { world: w, settlementId: s.id }));
      if (s.ownerFactionId === w.playerFactionId) {
        setHidden(selVisit, false);
        selVisit.onclick = () => (sfx(ctx, 'ui_confirm'), void ctx.actions.visitSettlement(s.id));
      }
    } else if (kind === 'army' && selection.id) {
      const a = w.armies[selection.id];
      const sv = a ? armySupplyView(w, a.id) : null;
      if (!a || !sv) return;
      setFactionChip(selChip, a.factionId);
      setText(selName, a.name);
      const cmd = a.commanderId ? w.characters[a.commanderId]?.name : null;
      setText(selSub, `${fmtInt(sv.soldiers)} soldiers · ${label(a.status)}${cmd ? ` · ${cmd}` : ''}`);
      const sup = meter('progress');
      sup.set(Math.min(1, sv.days / 60), { warn: sv.days < 10 });
      const mor = meter('morale');
      mor.set(a.morale / 100);
      selMeters.append(
        h('div', { class: 'sel-meter' }, h('span', null, icon('sheaf'), `Food ${fmtDays(sv.days)}`), sup.el),
        h('div', { class: 'sel-meter' }, h('span', null, icon('lotus'), `Morale ${Math.round(a.morale)}`), mor.el),
      );
      if (sv.reason && sv.delivering <= 0 && a.factionId === w.playerFactionId) selMeters.append(h('div', { class: 'sel-warn warning' }, icon('alert'), sv.reason));
      selAction.textContent = '';
      append(selAction, icon('flag'), 'Details');
      selAction.onclick = () => (sfx(ctx, 'ui_open'), ui.show('army_panel', { world: w, armyId: a.id }));
    } else if (kind === 'province' && selection.id) {
      const p = w.provinces[selection.id];
      if (!p) return;
      setFactionChip(selChip, p.ownerFactionId);
      setText(selName, p.name);
      setText(selSub, `${label(p.zone)} · ${factionName(p.ownerFactionId)}`);
      selAction.textContent = '';
      append(selAction, icon('flag'), 'Details');
      selAction.onclick = () => (sfx(ctx, 'ui_open'), ui.show('province_panel', { world: w, provinceId: p.id }));
    } else {
      setFactionChip(selChip, w.playerFactionId);
      setText(selName, w.factions[w.playerFactionId]?.name ?? '');
      setText(selSub, ctx.input.touchMode ? 'Tap a settlement or an army' : 'Select a settlement or an army');
      selAction.textContent = '';
      append(selAction, icon('b_palace'), 'Capital');
      selAction.onclick = () => selectCapital();
    }
  };

  const selectCapital = (): void => {
    if (!world) return;
    const cap = world.factions[world.playerFactionId]?.capitalSettlementId;
    const s = cap ? world.settlements[cap] : null;
    if (!s) return;
    sfx(ctx);
    ctx.bus.emit('ui:world_select', { kind: 'settlement', id: s.id });
    ctx.bus.emit('ui:camera_focus', { x: s.x, z: s.z, distance: null });
  };

  const renderObjectives = (): void => {
    const w = world;
    const sc = w?.scenarioId ? SCENARIOS[w.scenarioId] : null;
    if (!w || !sc) {
      setHidden(objectives, true);
      return;
    }
    setHidden(objectives, false);
    const acts = sc.acts ?? [];
    let act = acts[0] ?? null;
    for (const a of acts) if (w.events.flags[a.flag] === a.flagValue) act = a;
    setText(objTitle, act ? `Act ${act.number}: ${act.title}` : sc.title);
    setText(objSub, act?.subtitle ?? sc.subtitle);
    const list = sc.objectives.filter((o) => !act || o.act === undefined || o.act === act.number);
    syncList(
      objList,
      list,
      (o) => o.id,
      (o) => h('li', { title: o.description }, h('span', { class: 'obj-label' }, o.label), o.optional ? h('span', { class: 'obj-opt' }, ' (optional)') : null),
      (li, o) => {
        const st = w.victory.objectives[o.id] ?? 'pending';
        setClass(li, 'done', st === 'complete');
        setClass(li, 'failed', st === 'failed');
        setAttr(li, 'aria-label', `${o.label}: ${st}`);
      },
    );
  };

  const renderSpeed = (p: { timeScale: number; paused: boolean }): void => {
    const phone = ui.layout !== 'pc';
    setClass(pauseBtn, 'active', p.paused);
    setAttr(pauseBtn, 'aria-pressed', p.paused ? 'true' : 'false');
    for (const [sp, b] of speedBtns) {
      setClass(b, 'active', !p.paused && Math.abs(p.timeScale - sp) < 0.01);
      setHidden(b, phone && !SPEEDS_PHONE.includes(sp));
    }
  };

  const renderTop = (): void => {
    const w = world!;
    const me = w.playerFactionId;
    const f = w.factions[me];
    setFactionChip(realmChip, me);
    setText(realmName, f?.name ?? '');
    setText(ageBadge, f ? `${AGES[f.age].numeral} · ${AGES[f.age].name}` : '');
    resModel = resourceBar(w, me);
    const phone = ui.layout !== 'pc';
    for (const r of resModel) {
      const v = resChip(r.id);
      setText(v.value, phone ? r.compact : r.text);
      setText(v.trend, r.trendText);
      setClass(v.trend, 'positive', r.trendTone === 'positive');
      setClass(v.trend, 'danger', r.trendTone === 'danger');
      setText(v.badge, r.badge ? String(r.badge) : '');
      setHidden(v.badge, !r.badge);
      setClass(v.el, 'phone-core', PHONE_RESOURCES.includes(r.id));
      setAttr(v.el, 'aria-label', `${r.name}: ${r.text}${r.trendText ? `, ${r.trendText}` : ''}${r.badge ? `, ${r.badge} idle` : ''}`);
    }
    const d = dateBlock(w);
    setText(dateText, d.date);
    setText(seasonText, d.seasonName);
    setAttr(seasonText, 'title', `${d.seasonName}: ${d.seasonEnglish}`);
    setIcon(seasonIcon, d.seasonIcon);
    setIcon(weatherIcon, d.weatherIcon);
    setText(weatherText, d.weatherLabel);
    setHidden(forecast, !d.forecast);
    if (d.forecast) {
      setText(forecast, d.forecast);
      setClass(forecast, 'danger', d.forecastTone === 'danger');
      setClass(forecast, 'warning', d.forecastTone === 'warning');
      setClass(forecast, 'positive', d.forecastTone === 'positive');
    }
    // Realm badges.
    const bset = (id: ScreenId, n: number | string | null, danger = false): void => {
      const b = realmBadges.get(id)!;
      setText(b, n === null || n === 0 ? '' : String(n));
      setHidden(b, n === null || n === 0);
      setClass(b, 'danger', danger);
    };
    bset('diplomacy', pendingProposals(w, me).length);
    bset('council', f?.councilAdvice.filter((r) => r.urgency >= 0.5).length ?? 0);
    const av = ageView(w, me);
    bset('age_panel', av.landmarks.some((l) => l.status === 'available') ? '!' : null);
    const red = Object.keys(w.settlements).filter((id) => {
      const s = w.settlements[id]!;
      return s.ownerFactionId === me && settlementVitals(w, id)?.reserveColor === 'red';
    }).length;
    bset('economy_panel', red || ((f?.treasury ?? 0) < 0 ? '!' : 0), true);
    bset('chronicle', Math.max(0, w.chronicle.length - chronicleSeen) || null);
  };

  const refreshPanels = (w: WorldState): void => {
    if (!panelGate('', w.calendar.totalHours)) return;
    for (const id of LIVE_PANELS) {
      if (!ui.isVisible(id)) continue;
      const prev = ui.propsOf(id) as Record<string, unknown> | undefined;
      if (prev && prev.world !== w) ui.update(id, { ...prev, world: w } as never);
      else if (prev) ui.update(id, prev as never);
    }
    if (ui.isVisible('council')) ui.update('council', { world: w, recommendations: w.factions[w.playerFactionId]?.councilAdvice ?? [] });
  };

  // ------------------------------------------------------------------------------------------- bus
  const onAction = (e: InputActionEvent): void => {
    if (!world) return;
    ui.measure(() => {
      const slot = cardSlotIndex(e.action);
      if (slot >= 0) {
        if (!grid.el.classList.contains('ui-hidden')) grid.activate(slot, e.shift);
        return;
      }
      switch (e.action) {
        case 'card_next_tab':
          if (selection.kind === 'settlement') {
            tab = nextSettlementTab(tab);
            renderCard();
          }
          break;
        case 'idle_builders_next':
          if (hudOptions.idleHotkeys) cycleIdle();
          break;
        case 'idle_army_next':
          if (hudOptions.idleHotkeys) cycleArmy();
          break;
        case 'select_capital':
          if (hudOptions.idleHotkeys) selectCapital();
          break;
        default:
          break;
      }
    });
  };
  const offs = [
    ctx.bus.on('input:action', onAction),
    ctx.bus.on('sim:events', ({ events }) => {
      if (!world) return;
      ui.measure(() => {
        const now = performance.now();
        for (const ev of events) {
          const f = feedEntry(ev, world!);
          if (!f) continue;
          feedItems.push({ ...f, t: now });
          if (f.ping && f.focus && !alertsFromBus) minimap.ping(f.focus.x, f.focus.z, f.ping);
          if (ui.layout !== 'pc' && (f.severity === 'danger' || f.severity === 'success')) ui.toast(f.text, f.severity, 3600);
        }
        renderFeed();
      });
    }),
    ctx.bus.on('world:alert', (a) => {
      alertsFromBus = true;
      minimap.ping(a.x, a.z, a.severity);
    }),
    ctx.bus.on('settings:changed', ({ settings }) => minimap.setNorthUp(settings.minimapNorthUp)),
    ui.onLayout(() => {
      if (ui.layout !== 'pc') {
        setClass(objectives, 'collapsed', true);
        setAttr(objToggle, 'aria-expanded', 'false');
      }
      if (world) {
        renderTop();
        renderSpeed(lastProps);
      }
      minimap.setCollapsed(ui.layout !== 'pc');
    }),
  ];
  minimap.setCollapsed(ui.layout !== 'pc');
  if (ui.layout !== 'pc') {
    setClass(objectives, 'collapsed', true);
    setAttr(objToggle, 'aria-expanded', 'false');
  }
  let lastProps = { timeScale: 1, paused: false };
  let lastSelKey = '';
  let terrainSet = false;

  return {
    id: 'world_hud',
    layer: 'hud',
    el,
    update(p) {
      world = p.world as WorldState;
      const w = world;
      lastProps = { timeScale: p.timeScale, paused: p.paused };
      const selKey = `${p.selection.kind}:${p.selection.id}`;
      if (selKey !== lastSelKey) {
        lastSelKey = selKey;
        if (p.selection.kind === 'settlement' && p.selection.kind !== selection.kind) tab = 'economy';
        if (p.selection.kind === 'settlement') ctx.bus.emit('ui:hint', { key: 'world.first_settlement_selected' });
        if (p.selection.kind === 'army') ctx.bus.emit('ui:hint', { key: 'world.first_army_selected' });
      }
      selection = p.selection;
      if (!terrainSet) {
        terrainSet = true;
        try {
          minimap.setTerrain(regionTerrain(w), terrainKey(w.region.terrain));
        } catch {
          // terrain unavailable (tests) - plain tint
        }
      }
      const hours = w.calendar.totalHours;
      const kb = ctx.settings.keybindings;
      if (kb !== kbRef) {
        kbRef = kb;
        cardVersion++;
      }
      renderSpeed(p);
      if (topGate(`${ui.layout}`, hours)) renderTop();
      if (selGate(`${selKey}|${ui.layout}|${ctx.input.touchMode}`, hours)) renderSelection();
      if (cardGate(`${selKey}|${tab}|${ctx.input.preset}|${cardVersion}`, hours)) renderCard();
      if (objGate(w.scenarioId ?? '', hours)) renderObjectives();
      const groupList = ui.feeds.worldGroups.map((g) => ({ group: g.group, label: g.label, count: g.count }));
      // Touch: the five slots (long-press assigns) only while an army is selected or a group exists.
      groups.set(groupList, (ctx.input.touchMode || ui.layout !== 'pc') && (p.selection.kind === 'army' || groupList.length > 0));
      minimap.setWorld(w, p.selection, ui.feeds);
      if (p.paused !== lastPaused) lastPaused = p.paused;
      refreshPanels(w);
    },
    dispose() {
      clearInterval(feedTimer);
      for (const off of offs) off();
      minimap.dispose();
    },
  };
}

/** Options GP-03 may flip: the HUD handles '.', ',' and H (idle builders / idle army / capital) by default. */
export const hudOptions = { idleHotkeys: true };
