/**
 * Strategic (world) screens: HUD, settlement / army / province panels, diplomacy, council, chronicle,
 * event modal, engagement prompt, scenario results. OWNER: Lead UI/UX Engineer. Baseline by the CTO.
 * Screens read the (readonly) WorldState passed in props and act via ctx.actions / ui:* bus events.
 */
import type { AppContext } from '../../app/contracts';
import type { BuildingType, SimEvent, UnitClass, WorldState } from '../../core/types';
import { BUILDING_TYPES, UNIT_CLASSES } from '../../core/types';
import { FACTIONS } from '../../data/factions';
import { BUILDINGS } from '../../data/buildings';
import { UNITS } from '../../data/units';
import { SCENARIOS } from '../../data/campaign';
import { getEventDef } from '../../data/events';
import { formatDate, SEASON_NAMES, seasonOf } from '../../sim/strategic/seasons';
import { formatEventText } from '../../sim/strategic/events';
import { relationKey } from '../../core/ids';
import { h, append, clear, fmtInt, fmtPct, setText } from '../dom';
import type { Screen, UIManager } from '../ui';

const sfx = (ctx: AppContext, s: 'ui_click' | 'ui_open' | 'ui_confirm' = 'ui_click'): void => ctx.bus.emit('audio:sfx', { sfx: s });

function closeBtn(ui: UIManager, id: Parameters<UIManager['hide']>[0]): HTMLButtonElement {
  return h('button', { class: 'btn icon ghost', style: { position: 'absolute', top: '8px', right: '8px' }, 'aria-label': 'Close', onclick: () => ui.hide(id) }, '✕');
}

const SIM_TEXT: Partial<Record<SimEvent['kind'], (e: SimEvent, w: WorldState) => string>> = {
  harvest: (e, w) => (e.kind === 'harvest' ? `Harvest in ${w.settlements[e.settlementId]?.name}: ${fmtInt(e.amount)} grain` : ''),
  shortage: (e, w) => (e.kind === 'shortage' ? `Food shortage in ${w.settlements[e.settlementId]?.name}` : ''),
  construction_complete: (e, w) => (e.kind === 'construction_complete' ? `${BUILDINGS[e.building].name} completed in ${w.settlements[e.settlementId]?.name}` : ''),
  recruitment_complete: (e, w) => (e.kind === 'recruitment_complete' ? `${UNITS[e.unitClass].name} raised at ${w.settlements[e.settlementId]?.name}` : ''),
  army_arrived: (e, w) => (e.kind === 'army_arrived' ? `${w.armies[e.armyId]?.name ?? 'An army'} has arrived` : ''),
  army_starving: (e, w) => (e.kind === 'army_starving' ? `${w.armies[e.armyId]?.name ?? 'An army'} is starving` : ''),
  engagement_started: () => 'Armies have met in the field!',
  settlement_captured: (e, w) => (e.kind === 'settlement_captured' ? `${w.settlements[e.settlementId]?.name} has fallen to ${FACTIONS[e.to]?.name}` : ''),
  rebellion_stage: (e, w) => (e.kind === 'rebellion_stage' ? `${w.settlements[e.settlementId]?.name}: ${e.stage.replace('_', ' ')}` : ''),
  war_declared: (e) => (e.kind === 'war_declared' ? `War: ${FACTIONS[e.a]?.shortName} against ${FACTIONS[e.b]?.shortName}` : ''),
  peace_made: (e) => (e.kind === 'peace_made' ? `Peace between ${FACTIONS[e.a]?.shortName} and ${FACTIONS[e.b]?.shortName}` : ''),
  season_changed: (e) => (e.kind === 'season_changed' ? `The season turns: ${SEASON_NAMES[e.season].name} (${SEASON_NAMES[e.season].english})` : ''),
  notification: (e) => (e.kind === 'notification' ? e.text : ''),
};

// -------------------------------------------------------------------------------------------------

export function worldHud(ctx: AppContext, ui: UIManager): Screen<'world_hud'> {
  let world: WorldState | null = null;
  const date = h('div', { style: { fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', color: 'var(--c-gold)' } });
  const season = h('div', { class: 'muted', style: { fontSize: 'var(--fs-sm)' } });
  const realm = h('div', { style: { fontFamily: 'var(--font-display)' } });
  const chips = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } });
  const speedBtns = new Map<number, HTMLButtonElement>();
  const pauseBtn = h('button', { class: 'btn icon', title: 'Pause (Space)', onclick: () => (sfx(ctx), ctx.actions.togglePause()) }, '❚❚');
  const speeds = h('div', { class: 'btn-row', style: { gap: '4px' } }, pauseBtn);
  for (const s of [1, 2, 4, 8]) {
    const b = h('button', { class: 'btn icon', style: { fontFamily: 'var(--font-body)', fontSize: 'var(--fs-sm)' }, onclick: () => (sfx(ctx), ctx.actions.setTimeScale(s), ctx.actions.setPaused(false)) }, `${s}×`);
    speedBtns.set(s, b);
    speeds.append(b);
  }
  const top = h(
    'div',
    { class: 'panel', style: { position: 'absolute', top: 'max(8px, var(--safe-top))', left: 'max(8px, var(--safe-left))', right: 'max(8px, var(--safe-right))', display: 'flex', alignItems: 'center', gap: '14px', padding: '8px 14px', flexWrap: 'wrap' } },
    h('div', null, realm, season),
    h('div', null, date),
    h('div', { style: { flex: '1' } }, chips),
    speeds,
    h('button', { class: 'btn icon', title: 'Menu (Esc)', onclick: () => (sfx(ctx), ctx.actions.setPaused(true), ui.show('pause_menu', { mode: ctx.session.mode, canSave: true })) }, '☰'),
  );
  const feed = h('div', { style: { position: 'absolute', right: 'max(8px, var(--safe-right))', top: 'calc(86px + var(--safe-top))', width: 'min(300px, 46vw)', display: 'flex', flexDirection: 'column', gap: '4px', pointerEvents: 'none' } });
  const selCard = h('div', { class: 'panel ui-hidden', style: { position: 'absolute', left: 'max(8px, var(--safe-left))', bottom: 'max(8px, var(--safe-bottom))', width: 'min(360px, 92vw)' } });
  const actionsBar = h(
    'div',
    { class: 'btn-row', style: { position: 'absolute', right: 'max(8px, var(--safe-right))', bottom: 'max(8px, var(--safe-bottom))' } },
    h('button', { class: 'btn', onclick: () => world && (sfx(ctx, 'ui_open'), ui.show('council', { world, recommendations: [] })) }, 'Council'),
    h('button', { class: 'btn', onclick: () => world && (sfx(ctx, 'ui_open'), ui.show('diplomacy', { world })) }, 'Diplomacy'),
    h('button', { class: 'btn', onclick: () => world && (sfx(ctx, 'ui_open'), ui.show('chronicle', { world })) }, 'Chronicle'),
    h('button', { class: 'btn primary', onclick: () => (sfx(ctx), void ctx.actions.visitSettlement(null)) }, 'Visit Capital'),
  );
  const el = h('div', { class: 'screen-world-hud', style: { position: 'absolute', inset: '0', pointerEvents: 'none' } }, top, feed, selCard, actionsBar);
  for (const c of [top, selCard, actionsBar]) c.style.pointerEvents = 'auto';
  const offs = [
    ctx.bus.on('sim:events', ({ events }) => {
      if (!world) return;
      for (const e of events) {
        if ('factionId' in e && e.factionId && e.factionId !== world.playerFactionId && e.kind !== 'event_fired') continue;
        const fn = SIM_TEXT[e.kind];
        const text = fn?.(e, world);
        if (!text) continue;
        const item = h('div', { class: 'toast', style: { animation: 'toast-in .25s ease' } }, text);
        feed.prepend(item);
        while (feed.children.length > 6) feed.lastChild?.remove();
        setTimeout(() => item.remove(), 9000);
      }
    }),
  ];
  let selKey = '';
  return {
    id: 'world_hud',
    layer: 'hud',
    el,
    update(p) {
      world = p.world as WorldState;
      const w = world;
      const f = w.factions[w.playerFactionId];
      setText(realm, f?.name ?? '');
      setText(date, formatDate(w.calendar));
      const s = seasonOf(w.calendar);
      setText(season, `${SEASON_NAMES[s].name} (${SEASON_NAMES[s].english}) · ${w.weather.kind.replace('_', ' ')}`);
      let food = 0;
      let pop = 0;
      for (const st of Object.values(w.settlements)) if (st.ownerFactionId === w.playerFactionId) {
        food += st.foodStored;
        pop += st.population;
      }
      const chipHtml = `<span class="chip">Treasury <b>${fmtInt(f?.treasury ?? 0)}</b></span><span class="chip">Grain <b>${fmtInt(food)}</b></span><span class="chip">People <b>${fmtInt(pop)}</b></span><span class="chip">Stability <b>${fmtPct(f?.stability ?? 0)}</b></span><span class="chip">Legitimacy <b>${fmtPct(f?.legitimacy ?? 0)}</b></span>`;
      if (chips.innerHTML !== chipHtml) chips.innerHTML = chipHtml;
      pauseBtn.classList.toggle('active', p.paused);
      for (const [sp, b] of speedBtns) b.classList.toggle('active', !p.paused && Math.abs(p.timeScale - sp) < 0.01);
      // Selection card
      const key = `${p.selection.kind}:${p.selection.id}:${w.calendar.totalHours >> 2}`;
      if (key === selKey) return;
      selKey = key;
      clear(selCard);
      if (p.selection.kind === 'settlement' && p.selection.id) {
        const st = w.settlements[p.selection.id];
        if (st) {
          append(selCard, 
            h('div', { class: 'panel-title' }, st.name),
            h('div', { class: 'muted' }, `${st.kind.replace('_', ' ')} · ${st.ownerFactionId ? FACTIONS[st.ownerFactionId]?.name : 'Independent'}`),
            h('div', { class: 'stat-grid', style: { marginTop: '6px' } }, h('span', null, h('span', { class: 'k' }, 'Population '), fmtInt(st.population)), h('span', null, h('span', { class: 'k' }, 'Grain '), fmtInt(st.foodStored)), h('span', null, h('span', { class: 'k' }, 'Loyalty '), fmtPct(st.loyalty)), h('span', null, h('span', { class: 'k' }, 'Order '), st.rebellionStage.replace('_', ' '))),
            h('div', { class: 'btn-row', style: { marginTop: '8px' } }, h('button', { class: 'btn', onclick: () => (sfx(ctx, 'ui_open'), ui.show('settlement_panel', { world: w, settlementId: st.id })) }, 'Govern'), h('button', { class: 'btn ghost', onclick: () => void ctx.actions.visitSettlement(st.id) }, 'Visit')),
          );
        }
      } else if (p.selection.kind === 'army' && p.selection.id) {
        const a = w.armies[p.selection.id];
        if (a) {
          const men = a.units.reduce((t, u) => t + u.soldiers, 0);
          append(selCard, 
            h('div', { class: 'panel-title' }, a.name),
            h('div', { class: 'muted' }, `${FACTIONS[a.factionId]?.name} · ${a.status} · ${fmtInt(men)} soldiers`),
            h('div', { class: 'stat-grid', style: { marginTop: '6px' } }, h('span', null, h('span', { class: 'k' }, 'Morale '), Math.round(a.morale)), h('span', null, h('span', { class: 'k' }, 'Supply '), `${Math.floor(a.supply.food / Math.max(1, a.supply.dailyConsumption))} days`), h('span', null, h('span', { class: 'k' }, 'Fatigue '), fmtPct(a.fatigue))),
            a.factionId === w.playerFactionId ? h('div', { class: 'muted', style: { marginTop: '6px', fontSize: 'var(--fs-xs)' } }, 'Right-click (long-press on touch) on the map to march.') : null,
            h('div', { class: 'btn-row', style: { marginTop: '8px' } }, h('button', { class: 'btn', onclick: () => (sfx(ctx, 'ui_open'), ui.show('army_panel', { world: w, armyId: a.id })) }, 'Details')),
          );
        }
      }
      selCard.classList.toggle('ui-hidden', selCard.children.length === 0);
    },
    dispose() {
      for (const off of offs) off();
    },
  };
}

// -------------------------------------------------------------------------------------------------

export function settlementPanel(ctx: AppContext, ui: UIManager): Screen<'settlement_panel'> {
  const body = h('div');
  const el = h('div', { class: 'panel', style: { position: 'absolute', right: 'max(8px, var(--safe-right))', top: 'calc(80px + var(--safe-top))', width: 'min(420px, 94vw)', maxHeight: '72vh', overflow: 'auto' } }, closeBtn(ui, 'settlement_panel'), body);
  return {
    id: 'settlement_panel',
    layer: 'panel',
    el,
    update(p) {
      const w = p.world;
      const s = w.settlements[p.settlementId];
      clear(body);
      if (!s) return;
      const mine = s.ownerFactionId === w.playerFactionId;
      const row = (k: string, v: string): HTMLElement => h('span', null, h('span', { class: 'k' }, `${k} `), v);
      append(body, 
        h('div', { class: 'panel-title' }, s.name),
        h('div', { class: 'muted' }, `${s.kind.replace('_', ' ')} · ${w.provinces[s.provinceId]?.name ?? ''} · ${s.ownerFactionId ? FACTIONS[s.ownerFactionId]?.name : 'Independent'}`),
        h('div', { class: 'divider' }),
        h(
          'div',
          { class: 'stat-grid' },
          row('Population', fmtInt(s.population)),
          row('Labor', fmtInt(s.labor)),
          row('Grain stored', `${fmtInt(s.foodStored)} / ${fmtInt(s.foodCapacity)}`),
          row('Food / day', `${fmtInt(s.foodProduction)} - ${fmtInt(s.foodConsumption)}`),
          row('Grain price', s.grainPrice.toFixed(2)),
          row('Water', fmtPct(s.waterAvailability)),
          row('Irrigation', fmtPct(s.irrigation)),
          row('Housing', fmtInt(s.housing)),
          row('Sanitation', fmtPct(s.sanitation)),
          row('Public order', fmtPct(s.publicOrder)),
          row('Wealth', fmtInt(s.wealth)),
          row('Tax rate', fmtPct(s.taxRate)),
          row('Trade', fmtInt(s.tradeIncome)),
          row('Recruits', fmtInt(s.recruitPool)),
          row('Loyalty', fmtPct(s.loyalty)),
          row('Infrastructure', fmtPct(s.infrastructure)),
          row('Flood risk', fmtPct(s.disasterExposure.flood)),
          row('Unrest', `${fmtPct(s.unrest)} (${s.rebellionStage.replace('_', ' ')})`),
        ),
        h('div', { class: 'divider' }),
        h('div', { class: 'muted' }, 'Buildings: ', s.buildings.map((b) => `${BUILDINGS[b.type].name} ${b.level}`).join(', ') || 'none'),
        s.construction.length ? h('div', { class: 'muted' }, `Building: ${BUILDINGS[s.construction[0]!.type].name} (${fmtPct(s.construction[0]!.progress)})`) : null,
      );
      if (mine) {
        const bsel = h('select', null, ...BUILDING_TYPES.filter((t) => BUILDINGS[t].allowedIn.includes(s.kind)).map((t) => h('option', { value: t }, BUILDINGS[t].name)));
        const usel = h('select', null, ...UNIT_CLASSES.filter((c) => FACTIONS[w.playerFactionId]?.roster.includes(c)).map((c) => h('option', { value: c }, UNITS[c].name)));
        const tax = h('input', { type: 'range', min: 0, max: 0.5, step: 0.01, value: s.taxRate });
        append(body, 
          h('div', { class: 'divider' }),
          h('div', { class: 'field' }, h('span', { class: 'muted' }, 'Construct'), h('div', { class: 'btn-row' }, bsel, h('button', { class: 'btn', onclick: () => (sfx(ctx, 'ui_confirm'), ctx.actions.issueStrategic({ kind: 'build', settlementId: s.id, building: bsel.value as BuildingType })) }, 'Build'))),
          h('div', { class: 'field' }, h('span', { class: 'muted' }, 'Recruit'), h('div', { class: 'btn-row' }, usel, h('button', { class: 'btn', onclick: () => (sfx(ctx, 'ui_confirm'), ctx.actions.issueStrategic({ kind: 'recruit', settlementId: s.id, unitClass: usel.value as UnitClass, formations: 1, targetArmyId: null })) }, 'Raise'))),
          h('label', { class: 'field' }, h('span', { class: 'muted' }, 'Tax rate'), tax),
        );
        tax.addEventListener('change', () => ctx.actions.issueStrategic({ kind: 'set_tax_rate', settlementId: s.id, rate: Number(tax.value) }));
      }
    },
  };
}

export function armyPanel(ctx: AppContext, ui: UIManager): Screen<'army_panel'> {
  const body = h('div');
  const el = h('div', { class: 'panel', style: { position: 'absolute', right: 'max(8px, var(--safe-right))', top: 'calc(80px + var(--safe-top))', width: 'min(400px, 94vw)', maxHeight: '72vh', overflow: 'auto' } }, closeBtn(ui, 'army_panel'), body);
  return {
    id: 'army_panel',
    layer: 'panel',
    el,
    update(p) {
      const a = p.world.armies[p.armyId];
      clear(body);
      if (!a) return;
      append(body, 
        h('div', { class: 'panel-title' }, a.name),
        h('div', { class: 'muted' }, `${FACTIONS[a.factionId]?.name} · ${a.status} · stance ${a.stance}`),
        h('div', { class: 'divider' }),
        ...a.units.map((u) => h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px' } }, h('span', null, UNITS[u.unitClass].name), h('span', { class: 'muted' }, `${u.soldiers}/${u.maxSoldiers} · morale ${Math.round(u.morale)}`))),
        h('div', { class: 'divider' }),
        h('div', { class: 'stat-grid' }, h('span', null, h('span', { class: 'k' }, 'Food '), fmtInt(a.supply.food)), h('span', null, h('span', { class: 'k' }, 'Per day '), fmtInt(a.supply.dailyConsumption)), h('span', null, h('span', { class: 'k' }, 'Supply line '), a.supply.lineIntact ? 'intact' : 'cut')),
      );
      if (a.factionId === p.world.playerFactionId) {
        append(body, 
          h(
            'div',
            { class: 'btn-row', style: { marginTop: '8px' } },
            ...(['aggressive', 'balanced', 'cautious'] as const).map((st) => h('button', { class: `btn ${a.stance === st ? 'active' : ''}`, onclick: () => (sfx(ctx), ctx.actions.issueStrategic({ kind: 'set_army_stance', armyId: a.id, stance: st })) }, st)),
          ),
        );
      }
    },
  };
}

export function provincePanel(ctx: AppContext, ui: UIManager): Screen<'province_panel'> {
  const body = h('div');
  const el = h('div', { class: 'panel', style: { position: 'absolute', right: 'max(8px, var(--safe-right))', top: 'calc(80px + var(--safe-top))', width: 'min(380px, 94vw)' } }, closeBtn(ui, 'province_panel'), body);
  void ctx;
  return {
    id: 'province_panel',
    layer: 'panel',
    el,
    update(p) {
      const pr = p.world.provinces[p.provinceId];
      clear(body);
      if (!pr) return;
      const gov = pr.governorId ? p.world.characters[pr.governorId] : null;
      append(body, h('div', { class: 'panel-title' }, pr.name), h('div', { class: 'muted' }, `${pr.zone.replace('_', ' ')} · governor: ${gov?.name ?? 'none'}`), h('div', { class: 'muted' }, `Unrest ${fmtPct(pr.unrest)} · ${pr.rebellionStage.replace('_', ' ')}`));
    },
  };
}

export function diplomacyScreen(ctx: AppContext, ui: UIManager): Screen<'diplomacy'> {
  const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
  const el = h('div', { class: 'panel modal' }, closeBtn(ui, 'diplomacy'), h('div', { class: 'panel-title' }, 'Diplomacy'), body);
  return {
    id: 'diplomacy',
    layer: 'modal',
    el,
    update(p) {
      const w = p.world;
      clear(body);
      for (const fid of Object.keys(w.factions).sort()) {
        if (fid === w.playerFactionId) continue;
        const rel = w.diplomacy.relations[relationKey(fid, w.playerFactionId)];
        const def = FACTIONS[fid];
        const terms = { tributePerMonth: 0, payer: null, overlord: null, autonomy: 0, marriage: null, durationDays: 360 };
        append(body, 
          h(
            'div',
            { class: 'panel', style: { padding: '10px' } },
            h('div', { style: { display: 'flex', justifyContent: 'space-between' } }, h('b', { style: { color: def?.colors.primary } }, def?.name ?? fid), h('span', { class: rel?.atWar ? 'danger' : 'muted' }, rel?.atWar ? 'At war' : `Opinion ${Math.round(rel?.opinion ?? 0)}`)),
            h(
              'div',
              { class: 'btn-row', style: { marginTop: '6px' } },
              rel?.atWar
                ? h('button', { class: 'btn', onclick: () => (sfx(ctx, 'ui_confirm'), ctx.actions.issueStrategic({ kind: 'propose', to: fid, type: 'peace', terms })) }, 'Offer peace')
                : h('button', { class: 'btn', onclick: () => (sfx(ctx, 'ui_confirm'), ctx.actions.issueStrategic({ kind: 'propose', to: fid, type: 'trade', terms })) }, 'Propose trade'),
              rel?.atWar ? null : h('button', { class: 'btn ghost', onclick: () => (sfx(ctx), ctx.actions.issueStrategic({ kind: 'propose', to: fid, type: 'declare_war', terms })) }, 'Declare war'),
            ),
          ),
        );
      }
    },
  };
}

export function councilScreen(ctx: AppContext, ui: UIManager): Screen<'council'> {
  const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
  const el = h('div', { class: 'panel modal' }, closeBtn(ui, 'council'), h('div', { class: 'panel-title' }, 'Royal Council'), body);
  void ctx;
  return {
    id: 'council',
    layer: 'modal',
    el,
    update(p) {
      clear(body);
      const f = p.world.factions[p.world.playerFactionId];
      for (const [seat, id] of Object.entries(f?.council ?? {})) {
        const c = id ? p.world.characters[id] : null;
        const rec = p.recommendations.find((r) => r.seat === seat);
        append(body, h('div', null, h('b', null, seat.replace('_', ' '), ': '), c?.name ?? 'vacant', rec ? h('div', { class: 'muted' }, `"${rec.text}"`) : null));
      }
      if (!body.children.length) append(body, h('p', { class: 'muted' }, 'The council chamber is empty.'));
    },
  };
}

export function chronicleScreen(ctx: AppContext, ui: UIManager): Screen<'chronicle'> {
  const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '60vh', overflow: 'auto' } });
  const el = h('div', { class: 'panel modal' }, closeBtn(ui, 'chronicle'), h('div', { class: 'panel-title' }, 'The Chronicle'), body);
  void ctx;
  return {
    id: 'chronicle',
    layer: 'modal',
    el,
    update(p) {
      clear(body);
      for (const e of p.world.chronicle.slice().reverse()) append(body, h('div', null, h('span', { class: 'muted' }, `Day ${e.day}: `), e.text));
    },
  };
}

export function eventModal(ctx: AppContext, ui: UIManager): Screen<'event_modal'> {
  const body = h('div');
  const el = h('div', { class: 'panel modal' }, body);
  return {
    id: 'event_modal',
    layer: 'modal',
    el,
    update(p) {
      clear(body);
      const inst = p.world.events.pending.find((e) => e.id === p.instanceId);
      const def = inst ? getEventDef(inst.defId) : undefined;
      if (!inst || !def) {
        ui.hide('event_modal');
        return;
      }
      const t = formatEventText(p.world as WorldState, inst);
      append(body, 
        h('div', { style: { height: '90px', borderRadius: 'var(--radius-sm)', marginBottom: '10px', background: 'linear-gradient(135deg, var(--c-indigo), var(--c-saffron-deep))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', letterSpacing: '0.3em', color: 'var(--c-gold)' } }, def.illustration.toUpperCase()),
        h('div', { class: 'panel-title' }, t.title),
        h('p', null, t.body),
        h('div', { class: 'divider' }),
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
          ...def.choices.map((c) =>
            h(
              'button',
              { class: 'btn', style: { textAlign: 'left', fontFamily: 'var(--font-body)', display: 'block' }, onclick: () => (sfx(ctx, 'ui_confirm'), ctx.actions.resolveEvent(inst.id, c.id), ui.hide('event_modal')) },
              h('b', null, c.label),
              h('div', { class: 'muted', style: { fontSize: 'var(--fs-sm)' } }, c.description, c.advisorSeat ? ` · advised by the ${c.advisorSeat.replace('_', ' ')}` : ''),
            ),
          ),
        ),
      );
    },
  };
}

export function engagementPrompt(ctx: AppContext, ui: UIManager): Screen<'engagement_prompt'> {
  const body = h('div');
  const el = h('div', { class: 'panel modal' }, body);
  return {
    id: 'engagement_prompt',
    layer: 'modal',
    el,
    update(p) {
      clear(body);
      const e = p.world.engagements[p.engagementId];
      if (!e) return;
      const names = e.sides.map((s) => s.map((id) => p.world.armies[id]?.name ?? '').join(', '));
      const pr = p.prediction;
      const go = (d: 'fight' | 'autoresolve' | 'retreat'): void => {
        sfx(ctx, 'ui_confirm');
        ui.hide('engagement_prompt');
        void ctx.actions.decideEngagement(p.engagementId, d);
      };
      append(body, 
        h('div', { class: 'panel-title' }, 'Battle is Joined'),
        h('p', null, `${names[0]} confronts ${names[1]}.`),
        h('div', { class: 'stat-grid' }, h('span', null, h('span', { class: 'k' }, 'Attacker win chance '), fmtPct(pr.attackerWinChance)), h('span', null, h('span', { class: 'k' }, 'Expected losses '), `${fmtInt(pr.expectedLosses[0])} / ${fmtInt(pr.expectedLosses[1])}`)),
        ...pr.factors.map((f) => h('div', { class: 'muted' }, `· ${f}`)),
        h('div', { class: 'divider' }),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', onclick: () => go('fight') }, 'Take Command'), h('button', { class: 'btn', onclick: () => go('autoresolve') }, 'Let the Generals Decide'), h('button', { class: 'btn ghost', onclick: () => go('retreat') }, 'Retreat')),
      );
    },
  };
}

export function scenarioResults(ctx: AppContext, ui: UIManager): Screen<'scenario_results'> {
  const body = h('div');
  const el = h('div', { class: 'panel modal' }, body);
  void ui;
  return {
    id: 'scenario_results',
    layer: 'modal',
    el,
    update(p) {
      clear(body);
      const sc = p.world.scenarioId ? SCENARIOS[p.world.scenarioId] : null;
      const oc = sc?.outcomes.find((o) => o.id === p.world.victory.outcomeId);
      append(body, 
        h('div', { class: 'panel-title', style: { fontSize: 'var(--fs-xl)' } }, oc?.title ?? 'The Chronicle Ends'),
        h('p', null, oc?.epilogue ?? ''),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', onclick: () => void ctx.actions.quitToMenu() }, 'Return to Menu')),
      );
    },
  };
}
