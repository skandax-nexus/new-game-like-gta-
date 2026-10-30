/**
 * Contracts v2 AoE screens (DESIGN_SPEC §8.2, §8.4, §7.5, §12.2), discovered by the screen registry:
 *   build_placement  placement ghost info: building, cost (shortages red), validity reason, rotation, Shift repeat,
 *                    touch rotate / cross / tick buttons (HUD command 'placement' + input action placement_rotate)
 *   market           grain / timber / stone lots: price, buy / sell (Shift or x5 = five lots), price sparkline
 *   age_panel        current age banner, next-age requirements checklist, two landmark cards ('Choose site'),
 *                    unlock preview (buildings, units, treaties, bonuses)
 *   economy_panel    ledger (last month + projection), tax policy, royal reserve + 'Hold the reserve', rationing,
 *                    granaries by reserve days
 * OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 */
import type { AppContext } from '../../../app/contracts';
import type { FactionLedger, MarketResource, TaxPolicy, WorldState } from '../../../core/types';
import { BUILDINGS } from '../../../data/buildings';
import { UNITS } from '../../../data/units';
import { AGES, LANDMARKS } from '../../../data/ages';
import { RULES } from '../../../data/rules';
import { RESOURCE_DISPLAY } from '../../../data/resources';
import { ageView, commandReason, marketQuotes, realmOverview, settlementVitals } from '../../../sim/strategic/selectors';
import { totalDays } from '../../../sim/strategic/seasons';
import { append, clear, fmtDays, fmtInt, fmtSigned, h, label, setClass, setHidden, setText } from '../../dom';
import type { Screen, UIManager } from '../../ui';
import { defineScreen } from '../registry';
import { icon, setIcon, unitIcon } from '../../components/icons';
import { meter, panelFrame, section, sparkline } from '../../components/widgets';
import { emitHud } from '../../services/hudCommands';
import { marketHistory } from '../../services/marketHistory.service';
import { hotkeyLabel } from '../../../input/bindings';
import { sfx } from './common';

// ---------------------------------------------------------------------------------------------------
// build_placement
// ---------------------------------------------------------------------------------------------------

function buildPlacement(ctx: AppContext, ui: UIManager): Screen<'build_placement'> {
  const ic = icon('b_granary');
  const name = h('div', { class: 'bp-name' });
  const where = h('div', { class: 'bp-where muted' });
  const costs = h('div', { class: 'bp-costs' });
  const valid = h('div', { class: 'bp-valid', role: 'status', 'aria-live': 'polite' });
  const keys = h('div', { class: 'bp-keys' });
  const rotateBtn = h('button', { class: 'btn icon big bp-rotate', type: 'button', 'aria-label': 'Rotate', onclick: () => (emitHud(ui.commands, { kind: 'placement', action: 'rotate' }), ctx.input.injectAction('placement_rotate'), sfx(ctx)) }, icon('rotate'));
  const cancelBtn = h('button', { class: 'btn icon big danger bp-cancel', type: 'button', 'aria-label': 'Cancel placement', onclick: () => (emitHud(ui.commands, { kind: 'placement', action: 'cancel' }), sfx(ctx, 'ui_close')) }, icon('cross'));
  const okBtn = h('button', { class: 'btn icon big primary bp-ok', type: 'button', 'aria-label': 'Place here', onclick: () => (emitHud(ui.commands, { kind: 'placement', action: 'confirm' }), sfx(ctx, 'ui_confirm')) }, icon('check'));
  const touchRow = h('div', { class: 'bp-touch' }, cancelBtn, rotateBtn, okBtn);
  const info = h('div', { class: 'bp-info panel', dataset: { anchor: 'build-placement' } }, h('div', { class: 'bp-head' }, ic, h('div', null, name, where)), costs, valid, keys);
  const el = h('div', { class: 'screen-build-placement hud-root' }, info, touchRow);
  return {
    id: 'build_placement',
    layer: 'hud',
    el,
    update(p) {
      const w = p.world as WorldState;
      const f = w.factions[w.playerFactionId];
      const s = w.settlements[p.settlementId];
      const lm = p.landmarkId ? LANDMARKS.find((l) => l.id === p.landmarkId) : null;
      const title = lm ? lm.name : p.building ? BUILDINGS[p.building].name : 'Building';
      const iconId = lm ? 'b_landmark' : p.building ? `b_${p.building}` : 'b_landmark';
      setIcon(ic, iconId);
      setText(name, `Placing: ${title}`);
      setText(where, `${s?.name ?? ''} · facing ${['south', 'east', 'north', 'west'][p.rot] ?? 'south'}${p.repeat ? ' · placing more' : ''}`);
      clear(costs);
      const have: Record<string, number> = { wealth: f?.treasury ?? 0, timber: f?.materials.timber ?? 0, stone: f?.materials.stone ?? 0 };
      for (const k of ['wealth', 'timber', 'stone', 'labor'] as const) {
        const v = p.cost[k];
        if (!v) continue;
        const short = k !== 'labor' && (have[k] ?? 0) < v;
        const res = k === 'labor' ? 'labor' : k;
        costs.append(h('span', { class: `chip cost-chip${short ? ' short' : ''}`, title: short ? `You have ${fmtInt(have[k] ?? 0)}` : '' }, icon(RESOURCE_DISPLAY[res].icon, `res-${res}`), h('b', null, fmtInt(v)), k === 'labor' ? h('span', { class: 'muted' }, ' person-days') : null));
      }
      clear(valid);
      append(valid, icon(p.valid ? 'check' : 'cross'), h('span', null, p.valid ? 'A good site' : (p.reason ?? 'Cannot build here')));
      setClass(valid, 'positive', p.valid);
      setClass(valid, 'danger', !p.valid);
      clear(keys);
      if (!p.touch) {
        const k = (key: string, text: string): HTMLElement => h('span', { class: 'bp-key' }, h('kbd', { class: 'kbd' }, key), text);
        const rot = hotkeyLabel(ctx.input.preset, { context: 'world', mode: 'placement' }, 'placement_rotate', ctx.settings.keybindings) || 'R';
        append(keys, k('LMB', 'place'), k('Shift', 'place more'), k(rot, 'rotate'), k('RMB / Esc', 'cancel'));
      }
      setHidden(keys, p.touch);
      setHidden(touchRow, !p.touch);
      okBtn.disabled = !p.valid;
      okBtn.setAttribute('aria-label', p.valid ? 'Place here' : `Cannot place: ${p.reason ?? ''}`);
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// market
// ---------------------------------------------------------------------------------------------------

function market(ctx: AppContext, ui: UIManager): Screen<'market'> {
  let world: WorldState | null = null;
  let five = false;
  const frame = panelFrame({ id: 'market', variant: 'modal', title: 'The Market', subtitle: 'Lots of 100 at the realm\'s price', onClose: () => ui.hide('market'), torana: true });
  frame.el.classList.add('market');
  const lotToggle = h('button', { class: 'btn small', type: 'button', 'aria-pressed': 'false', onclick: () => ((five = !five), sfx(ctx), render()) }, 'x5 lots');
  const reason = h('div', { class: 'danger market-reason ui-hidden' });
  const rows = h('div', { class: 'market-rows' });
  append(frame.body, h('div', { class: 'market-top' }, h('span', { class: 'muted' }, ctx.input.touchMode ? 'Turn on x5 to trade five lots at once.' : 'Shift-click trades five lots.'), lotToggle), reason, rows);
  const views = new Map<MarketResource, { price: HTMLElement; sell: HTMLElement; stock: HTMLElement; buy: HTMLButtonElement; sellBtn: HTMLButtonElement; spark: ReturnType<typeof sparkline>; factor: HTMLElement }>();
  for (const r of ['grain', 'timber', 'stone'] as const) {
    const d = RESOURCE_DISPLAY[r];
    const price = h('b', { class: 'mk-price' });
    const sell = h('span', { class: 'mk-sell muted' });
    const stock = h('span', { class: 'mk-stock muted' });
    const factor = h('span', { class: 'mk-factor' });
    const spark = sparkline(110, 34);
    const trade = (buy: boolean, e: MouseEvent): void => {
      const lots = e.shiftKey || five ? 5 : 1;
      ctx.actions.issueStrategic({ kind: 'market_trade', resource: r, lots, buy });
      ctx.bus.emit('audio:sfx', { sfx: 'market_coins' });
    };
    const buy = h('button', { class: 'btn primary', type: 'button', onclick: (e: MouseEvent) => trade(true, e) }, icon('plus'), 'Buy');
    const sellBtn = h('button', { class: 'btn', type: 'button', onclick: (e: MouseEvent) => trade(false, e) }, icon('minus'), 'Sell');
    rows.append(h('div', { class: 'market-row card' }, h('div', { class: 'mk-res' }, icon(d.icon, `res-${r}`), h('div', null, h('b', null, d.name), stock)), h('div', { class: 'mk-prices' }, h('div', null, h('span', { class: 'muted' }, 'Buy '), price), h('div', null, sell), factor), spark.el, h('div', { class: 'mk-btns' }, buy, sellBtn)));
    views.set(r, { price, sell, stock, buy, sellBtn, spark, factor });
  }
  const render = (): void => {
    const w = world;
    if (!w) return;
    const me = w.playerFactionId;
    const f = w.factions[me];
    const quotes = marketQuotes(w, me);
    lotToggle.classList.toggle('active', five);
    lotToggle.setAttribute('aria-pressed', five ? 'true' : 'false');
    const anyReason = quotes.find((q) => !q.buy.ok && q.buy.reason)?.buy.reason ?? null;
    setText(reason, anyReason ?? '');
    setHidden(reason, !anyReason);
    let grain = 0;
    for (const id of Object.keys(w.settlements)) if (w.settlements[id]!.ownerFactionId === me) grain += w.settlements[id]!.foodStored;
    for (const q of quotes) {
      const v = views.get(q.resource)!;
      const lots = five ? 5 : 1;
      setText(v.price, `${fmtInt(q.buy.buyPrice * lots)}`);
      setText(v.sell, `Sell ${fmtInt(q.sell.sellPrice * lots)}`);
      setText(v.stock, q.resource === 'grain' ? `${fmtInt(grain + (f?.foodReserve ?? 0))} in store` : `${fmtInt(q.resource === 'timber' ? (f?.materials.timber ?? 0) : (f?.materials.stone ?? 0))} in stock`);
      const fac = f?.marketPrices[q.resource] ?? 1;
      setText(v.factor, fac > 1.05 ? `Dear ${fac.toFixed(2)}×` : fac < 0.95 ? `Cheap ${fac.toFixed(2)}×` : `Fair ${fac.toFixed(2)}×`);
      setClass(v.factor, 'danger', fac > 1.25);
      setClass(v.factor, 'positive', fac < 0.9);
      const buyReason = commandReason(w, me, { kind: 'market_trade', resource: q.resource, lots, buy: true });
      const sellReason = commandReason(w, me, { kind: 'market_trade', resource: q.resource, lots, buy: false });
      v.buy.disabled = !!buyReason;
      v.buy.title = buyReason ?? `Buy ${lots * 100} for ${fmtInt(q.buy.buyPrice * lots)} wealth`;
      v.sellBtn.disabled = !!sellReason;
      v.sellBtn.title = sellReason ?? `Sell ${lots * 100} for ${fmtInt(q.sell.sellPrice * lots)} wealth`;
      const hist = [...marketHistory(me, q.resource), fac];
      v.spark.set(hist.length > 1 ? hist : [fac, fac]);
    }
  };
  return {
    id: 'market',
    layer: 'modal',
    el: frame.el,
    update(p) {
      world = p.world as WorldState;
      render();
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// age_panel
// ---------------------------------------------------------------------------------------------------

function agePanel(ctx: AppContext, ui: UIManager): Screen<'age_panel'> {
  const frame = panelFrame({ id: 'age_panel', variant: 'modal', title: 'Ages and Landmarks', onClose: () => ui.hide('age_panel'), torana: true });
  frame.el.classList.add('wide', 'age-panel');
  const banner = h('div', { class: 'panel carved age-banner' });
  const checklist = h('ul', { class: 'list-lotus age-checklist' });
  const cards = h('div', { class: 'landmark-cards' });
  const unlocks = h('div', { class: 'age-unlocks' });
  const reqSection = section('Requirements', checklist);
  const lmSection = section('Landmarks', cards);
  const unSection = section('Unlocks', unlocks);
  append(frame.body, banner, h('div', { class: 'age-cols' }, h('div', null, reqSection, unSection), lmSection));
  return {
    id: 'age_panel',
    layer: 'modal',
    el: frame.el,
    update(p) {
      const w = p.world as WorldState;
      const f = w.factions[p.factionId];
      if (!f) return;
      const av = ageView(w, p.factionId);
      const cur = AGES[f.age];
      const next = av.checklist.nextAge ? AGES[av.checklist.nextAge] : null;
      clear(banner);
      append(banner, h('div', { class: 'age-numeral' }, cur.numeral), h('div', null, h('div', { class: 'panel-title' }, /\bAge$/.test(cur.name) ? cur.name : `${cur.name} Age`), h('div', { class: 'epigraph' }, cur.title), next ? h('div', { class: 'age-next' }, `Next: ${next.numeral}. ${next.name} - ${next.title}`) : h('div', { class: 'age-next' }, 'The last age: your realm is an empire.')));
      clear(checklist);
      for (const it of av.checklist.items) {
        const pct = it.id === 'legitimacy' || it.id === 'stability';
        const fmt = (v: number): string => (pct ? `${Math.round(v * 100)}%` : it.id === 'previous' ? '' : fmtInt(v));
        checklist.append(h('li', { class: it.met ? 'done met' : 'unmet' }, h('span', null, it.label), it.id === 'previous' ? null : h('span', { class: it.met ? 'positive req-v' : 'danger req-v' }, ` ${fmt(it.current)} / ${fmt(it.required)}`)));
      }
      setHidden(reqSection, !next);
      clear(cards);
      const mine = av.landmarks.filter((l) => l.landmark.age === av.checklist.nextAge || l.status === 'in_progress' || (l.status === 'completed' && l.landmark.age === f.age));
      for (const o of mine.length ? mine : av.landmarks.slice(0, 2)) {
        const lm = o.landmark;
        const c = lm.cost;
        const short = (have: number, need: number): string => (have < need ? 'short' : '');
        const prog = meter('progress');
        prog.set(o.progress);
        const choose = h('button', { class: 'btn stone', type: 'button', disabled: o.status !== 'available' }, icon('b_landmark'), 'Choose site');
        choose.addEventListener('click', () => {
          emitHud(ui.commands, { kind: 'place_landmark', settlementId: o.allowedSettlements[0] ?? null, landmarkId: lm.id });
          sfx(ctx, 'ui_confirm');
          ui.hide('age_panel');
        });
        cards.append(
          h(
            'div',
            { class: `panel carved landmark-card status-${o.status}` },
            h('div', { class: 'lm-head' }, icon('b_landmark'), h('div', null, h('div', { class: 'lm-name' }, lm.name), lm.localName ? h('div', { class: 'lm-local epigraph' }, lm.localName) : null)),
            h('div', { class: 'lm-age' }, `${AGES[lm.age].numeral} · ${AGES[lm.age].name}`),
            h('p', { class: 'lm-summary' }, lm.summary),
            h(
              'div',
              { class: 'lm-cost' },
              h('span', { class: `chip ${short(f.treasury, c.wealth)}` }, icon('coins', 'res-wealth'), fmtInt(c.wealth)),
              h('span', { class: `chip ${short(f.materials.timber, c.timber)}` }, icon('logs', 'res-timber'), fmtInt(c.timber)),
              h('span', { class: `chip ${short(f.materials.stone, c.stone)}` }, icon('block', 'res-stone'), fmtInt(c.stone)),
              h('span', { class: 'chip' }, icon('villager', 'res-labor'), fmtInt(c.labor)),
              h('span', { class: 'chip' }, icon('hourglass'), `${lm.buildDays} days`),
            ),
            h('div', { class: 'lm-where' }, `Raised in a ${lm.allowedIn.map((k) => label(k).toLowerCase()).join(', ')}`),
            o.status === 'in_progress' || o.status === 'completed' ? h('div', { class: 'lm-progress' }, h('span', null, o.status === 'completed' ? `Stands at ${w.settlements[o.settlementId ?? '']?.name ?? ''}` : `Rising at ${w.settlements[o.settlementId ?? '']?.name ?? ''} · ${Math.round(o.progress * 100)}%`), prog.el) : null,
            o.reason ? h('div', { class: 'lm-reason' }, icon('lock'), o.reason) : null,
            o.status === 'available' || o.status === 'locked' ? h('div', { class: 'btn-row' }, choose) : null,
          ),
        );
      }
      clear(unlocks);
      if (next) {
        const row = (title: string, items: HTMLElement[]): HTMLElement => h('div', { class: 'unlock-row' }, h('div', { class: 'unlock-title muted' }, title), h('div', { class: 'unlock-items' }, ...items));
        if (next.unlockBuildings.length) unlocks.append(row('Buildings', next.unlockBuildings.map((b) => h('span', { class: 'unlock', title: BUILDINGS[b].name }, icon(`b_${b}`), BUILDINGS[b].name))));
        if (next.unlockUnits.length) unlocks.append(row('Units', next.unlockUnits.map((u) => h('span', { class: 'unlock', title: UNITS[u].name }, icon(unitIcon(u)), UNITS[u].name))));
        if (next.unlockTreaties.length) unlocks.append(row('Treaties', next.unlockTreaties.map((t) => h('span', { class: 'unlock' }, icon('diplomacy'), label(t)))));
        const bon = Object.entries(next.bonuses).map(([k, v]) => `${label(k)} ×${Number(v).toFixed(2)}`);
        unlocks.append(row('Bonuses', [h('span', { class: 'unlock-text' }, [...bon, `recruits +${Math.round(next.recruitBonus.experience * 100)}% experience, +${next.recruitBonus.morale} morale`, `${next.governorSlots} governors`, `buildings up to level ${next.maxBuildingLevel}`].join(' · '))]));
      }
      setHidden(unSection, !next);
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// economy_panel
// ---------------------------------------------------------------------------------------------------

const LEDGER_ROWS: readonly { key: keyof FactionLedger; label: string; sign: 1 | -1 }[] = [
  { key: 'taxIncome', label: 'Taxes', sign: 1 },
  { key: 'tradeIncome', label: 'Trade', sign: 1 },
  { key: 'tribute', label: 'Tribute', sign: 1 },
  { key: 'armyUpkeep', label: 'Army upkeep', sign: -1 },
  { key: 'buildingUpkeep', label: 'Building upkeep', sign: -1 },
  { key: 'administration', label: 'Administration', sign: -1 },
  { key: 'construction', label: 'Construction', sign: -1 },
  { key: 'recruitment', label: 'Recruitment', sign: -1 },
  { key: 'other', label: 'Other', sign: 1 },
];

const POLICY_TEXT: Readonly<Record<TaxPolicy, string>> = {
  lenient: 'Light hand: less coin, calmer towns, loyal hearts.',
  standard: 'The customary share.',
  heavy: 'More coin; unrest grows and legitimacy erodes.',
  emergency: 'War chest: the most coin, at a steep cost in order.',
};

function economyPanel(ctx: AppContext, ui: UIManager): Screen<'economy_panel'> {
  const frame = panelFrame({ id: 'economy_panel', variant: 'modal', title: 'Treasury and Granaries', onClose: () => ui.hide('economy_panel'), torana: true });
  frame.el.classList.add('wide', 'economy');
  const ledger = h('table', { class: 'ledger' });
  const policies = h('div', { class: 'seg wrap', role: 'radiogroup', 'aria-label': 'Tax policy' });
  const policyText = h('div', { class: 'muted policy-text' });
  const reserve = h('div', { class: 'eco-reserve' });
  const ration = h('div', { class: 'eco-ration' });
  const granaries = h('div', { class: 'eco-granaries' });
  append(frame.body, h('div', { class: 'eco-cols' }, h('div', null, section('Ledger', ledger)), h('div', null, section('Tax policy', policies, policyText), section('Royal reserve', reserve), section('Rationing', ration))), section('Granaries', granaries));
  return {
    id: 'economy_panel',
    layer: 'modal',
    el: frame.el,
    update(p) {
      const w = p.world as WorldState;
      const ov = realmOverview(w, p.factionId);
      const f = w.factions[p.factionId];
      if (!ov || !f) return;
      clear(ledger);
      ledger.append(h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Last month'), h('th', null, 'This month (projected)'))));
      const tb = h('tbody');
      for (const r of LEDGER_ROWS) {
        const a = ov.ledger[r.key] * r.sign;
        const b = ov.projected[r.key] * r.sign;
        if (Math.abs(a) < 0.5 && Math.abs(b) < 0.5) continue;
        tb.append(h('tr', null, h('td', null, r.label), h('td', { class: a < 0 ? 'danger' : '' }, fmtSigned(a)), h('td', { class: b < 0 ? 'danger' : '' }, fmtSigned(b))));
      }
      tb.append(h('tr', { class: 'ledger-net' }, h('td', null, 'Net'), h('td', { class: ov.ledger.net < 0 ? 'danger' : 'positive' }, fmtSigned(ov.ledger.net)), h('td', { class: ov.projected.net < 0 ? 'danger' : 'positive' }, fmtSigned(ov.projected.net))));
      tb.append(h('tr', null, h('td', null, 'Treasury'), h('td', null, ''), h('td', null, fmtInt(f.treasury))));
      ledger.append(tb);
      clear(policies);
      for (const pol of ['lenient', 'standard', 'heavy', 'emergency'] as const) {
        const rule = RULES.tax.policy[pol as keyof typeof RULES.tax.policy] as { income: number } | undefined;
        const on = f.taxPolicy === pol;
        policies.append(h('button', { class: `btn small${on ? ' active' : ''}`, type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', onclick: () => (ctx.actions.issueStrategic({ kind: 'set_tax_policy', policy: pol }), sfx(ctx)) }, label(pol), rule ? h('span', { class: 'muted' }, ` ×${rule.income.toFixed(2)}`) : null));
      }
      setText(policyText, POLICY_TEXT[f.taxPolicy]);
      clear(reserve);
      const holdReason = commandReason(w, p.factionId, { kind: 'set_policy', policy: 'hold_reserve', on: !f.policies.holdReserve });
      append(
        reserve,
        h('div', { class: 'eco-line' }, icon('sheaf', 'res-grain'), h('b', null, fmtInt(f.foodReserve)), h('span', { class: 'muted' }, ' measures in the royal granaries')),
        h('button', { class: `btn small${f.policies.holdReserve ? ' active' : ''}`, type: 'button', 'aria-pressed': f.policies.holdReserve ? 'true' : 'false', disabled: !!holdReason, title: holdReason ?? '', onclick: () => (ctx.actions.issueStrategic({ kind: 'set_policy', policy: 'hold_reserve', on: !f.policies.holdReserve }), sfx(ctx)) }, icon('lock'), f.policies.holdReserve ? 'Holding the reserve' : 'Hold the reserve'),
        h('div', { class: 'muted small-text' }, f.policies.holdReserve ? 'No automatic relief: hungry towns get nothing from the capital.' : 'Hungry towns draw relief automatically (30 days a month at most).'),
      );
      clear(ration);
      const today = totalDays(w.calendar);
      const on = f.policies.rationingUntilDay !== null && f.policies.rationingUntilDay > today;
      const rReason = commandReason(w, p.factionId, { kind: 'set_policy', policy: 'rationing', on: !on });
      append(
        ration,
        h('div', { class: 'eco-line' }, icon(on ? 'alert' : 'check', on ? 'warning' : 'positive'), on ? `Rationing for ${fmtDays((f.policies.rationingUntilDay ?? today) - today)}` : 'No rationing'),
        h('button', { class: `btn small${on ? ' active' : ''}`, type: 'button', 'aria-pressed': on ? 'true' : 'false', disabled: !!rReason, title: rReason ?? '', onclick: () => (ctx.actions.issueStrategic({ kind: 'set_policy', policy: 'rationing', on: !on }), sfx(ctx)) }, on ? 'End rationing' : 'Ration grain'),
        h('div', { class: 'muted small-text' }, 'Everyone eats 15% less for 120 days; health and order suffer.'),
      );
      clear(granaries);
      const owned = Object.keys(w.settlements)
        .sort()
        .map((id) => settlementVitals(w, id))
        .filter((v): v is NonNullable<typeof v> => !!v && v.ownerFactionId === p.factionId)
        .sort((a, b) => a.reserveDays - b.reserveDays);
      for (const v of owned) {
        const m = meter('progress');
        m.set(Math.min(1, v.reserveDays / 120), { warn: v.reserveColor !== 'green' });
        granaries.append(h('button', { class: `granary-row reserve-${v.reserveColor}`, type: 'button', onclick: () => (ctx.bus.emit('ui:world_select', { kind: 'settlement', id: v.id }), sfx(ctx)) }, h('span', { class: 'gr-name' }, v.name), m.el, h('b', { class: 'gr-days' }, fmtDays(v.reserveDays)), h('span', { class: 'muted gr-price' }, `${v.grainPrice.toFixed(2)}×`)));
      }
    },
  };
}

export const SCREENS = [defineScreen('build_placement', buildPlacement), defineScreen('market', market), defineScreen('age_panel', agePanel), defineScreen('economy_panel', economyPanel)];
