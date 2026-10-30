/**
 * Settlement panel (DESIGN_SPEC §12.2): right drawer on PC, 60% bottom sheet on phones. Header, alerts (cut off,
 * siege, capture), vitals with reserve-day colours and "why" tooltips, labor allocation sliders summing <= 100%,
 * tax-rate slider, buildings grid (level pips, condition, repair), construction queue (progress, days, cancel),
 * recruitment queue, garrison. OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 */
import type { AppContext } from '../../../app/contracts';
import type { LaborAllocation, SettlementState, WorldState } from '../../../core/types';
import { BUILDINGS } from '../../../data/buildings';
import { UNITS } from '../../../data/units';
import { LANDMARKS } from '../../../data/ages';
import { RULES } from '../../../data/rules';
import { commandReason, settlementVitals, type SettlementVitals } from '../../../sim/strategic/selectors';
import { append, clear, fmtDays, fmtInt, fmtPct, h, label, setClass, setHidden, setText, syncList } from '../../dom';
import type { Screen, UIManager } from '../../ui';
import { icon, unitIcon } from '../../components/icons';
import { factionChip, meter, panelFrame, pips, section, setFactionChip, slider, statCell, type Slider } from '../../components/widgets';
import { factionName, sfx } from './common';

const LABOR_KEYS: readonly (keyof LaborAllocation)[] = ['farming', 'construction', 'crafts', 'military'];
const LABOR_LABEL: Record<keyof LaborAllocation, string> = { farming: 'Farming', construction: 'Construction', crafts: 'Crafts', military: 'Militia' };

export function settlementPanel(ctx: AppContext, ui: UIManager): Screen<'settlement_panel'> {
  let world: WorldState | null = null;
  let sid = '';
  const chip = factionChip(null, 'lg');
  const frame = panelFrame({ id: 'settlement_panel', variant: 'drawer', title: '', onClose: () => ui.hide('settlement_panel'), lead: chip });
  const alerts = h('div', { class: 'sp-alerts' });
  // Vitals
  const cells = {
    pop: statCell('Population', 'villager'),
    grain: statCell('Grain', 'sheaf'),
    price: statCell('Grain price', 'coins'),
    water: statCell('Water', 'b_water_tank'),
    loyalty: statCell('Loyalty', 'crown'),
    unrest: statCell('Unrest', 'alert'),
    order: statCell('Public order', 'b_temple'),
    health: statCell('Health', 'heart'),
  };
  const vitals = h('div', { class: 'vitals-grid' }, ...Object.values(cells).map((c) => c.el));
  let vit: SettlementVitals | null = null;
  ui.tooltips.attach(cells.loyalty.el, () => (vit ? { title: 'Loyalty', rows: vit.loyaltyTerms.map((t) => [t.label, `${t.value >= 0 ? '+' : ''}${(t.value * 100).toFixed(1)}`, t.value < 0 ? 'danger' : 'positive'] as const), hint: 'Monthly change and its causes.' } : null));
  ui.tooltips.attach(cells.unrest.el, () => (vit ? { title: `Unrest: ${label(vit.stage)}`, rows: vit.unrestTerms.map((t) => [t.label, `${t.value >= 0 ? '+' : ''}${(t.value * 100).toFixed(2)}`, t.value > 0 ? 'danger' : 'positive'] as const), hint: 'Daily change and its causes. Protest or worse hurts taxes and recruits.' } : null));
  ui.tooltips.attach(cells.grain.el, () => (vit ? { title: 'Grain', rows: [['Stored', fmtInt(vit.food.production >= 0 ? (world?.settlements[sid]?.foodStored ?? 0) : 0)], ['Produced / day', fmtInt(vit.food.production)], ['Eaten / day', fmtInt(vit.food.consumption)], ['Net / day', fmtInt(vit.food.net), vit.food.net < 0 ? 'danger' : 'positive']], hint: vit.reserveColor === 'red' ? 'Why is this red? Less than 30 days of grain: prices and unrest rise.' : 'Days of reserve at today\'s consumption.' } : null));
  // Labor
  const laborSliders = new Map<keyof LaborAllocation, Slider>();
  const laborIdle = h('div', { class: 'labor-idle muted' });
  const laborBox = h('div', { class: 'labor-box' });
  const sendLabor = (key: keyof LaborAllocation, v: number): void => {
    const s = world?.settlements[sid];
    if (!s) return;
    const next: LaborAllocation = { ...s.laborAllocation };
    let others = 0;
    for (const k of LABOR_KEYS) if (k !== key) others += next[k];
    next[key] = Math.max(0, Math.min(v, 1 - others));
    ctx.actions.issueStrategic({ kind: 'set_labor', settlementId: sid, allocation: next });
    sfx(ctx);
  };
  for (const k of LABOR_KEYS) {
    const sl = slider({ label: LABOR_LABEL[k], min: 0, max: 1, step: 0.05, value: 0, format: (v) => fmtPct(v), onChange: (v) => sendLabor(k, v) });
    laborSliders.set(k, sl);
    laborBox.append(sl.el);
  }
  const tax = slider({ label: 'Tax rate', min: 0, max: RULES.tax.maxRate, step: 0.01, value: RULES.tax.defaultRate, format: (v) => fmtPct(v), onChange: (v) => (ctx.actions.issueStrategic({ kind: 'set_tax_rate', settlementId: sid, rate: v }), sfx(ctx)) });
  const laborSection = section('Labor and taxes', laborBox, laborIdle, tax.el);
  // Buildings
  const buildings = h('div', { class: 'building-grid' });
  const constructionList = h('div', { class: 'queue-list' });
  const recruitList = h('div', { class: 'queue-list' });
  const garrison = h('div', { class: 'garrison-list' });
  const bSection = section('Buildings', buildings);
  const cSection = section('Construction', constructionList);
  const rSection = section('Recruitment', recruitList);
  const gSection = section('Garrison', garrison);
  append(frame.body, alerts, vitals, laborSection, bSection, cSection, rSection, gSection);

  const render = (): void => {
    const w = world;
    const s = w?.settlements[sid];
    if (!w || !s) return;
    const v = settlementVitals(w, sid);
    vit = v;
    if (!v) return;
    const mine = s.ownerFactionId === w.playerFactionId;
    const prov = w.provinces[s.provinceId];
    setFactionChip(chip, s.ownerFactionId);
    frame.setTitle(s.name, `${label(s.kind)} · ${prov?.name ?? ''} · ${factionName(s.ownerFactionId)}`);
    // Alerts
    clear(alerts);
    if (v.cutOff) append(alerts, h('div', { class: 'alert-row danger' }, icon('alert'), h('span', null, v.cutOffReasons.join(' · '))));
    if (v.besiegedBy) {
      const by = w.armies[v.besiegedBy];
      append(alerts, h('div', { class: 'alert-row danger' }, icon('a_besiege'), h('span', null, `Besieged by ${by?.name ?? 'an enemy host'} · walls ${Math.round((v.wallHp / Math.max(1, v.maxWallHp)) * 100)}% · ${fmtDays(v.reserveDays)} of food · surrender chance ${fmtPct(v.surrenderChance)} a day`)));
    }
    if (s.pendingCapture && s.pendingCapture.factionId === w.playerFactionId) {
      const row = h('div', { class: 'alert-row warning' }, icon('flag'), h('span', null, 'Captured - decide its fate:'));
      const btns = h('div', { class: 'btn-row' });
      for (const d of ['occupy', 'plunder', 'liberate'] as const) {
        const reason = commandReason(w, w.playerFactionId, { kind: 'capture_decision', settlementId: s.id, decision: d });
        btns.append(h('button', { class: `btn small${d === 'occupy' ? ' primary' : ''}`, type: 'button', disabled: !!reason, title: reason ?? '', onclick: () => (ctx.actions.decideCapture ? ctx.actions.decideCapture(s.id, d) : ctx.actions.issueStrategic({ kind: 'capture_decision', settlementId: s.id, decision: d }), sfx(ctx, 'ui_confirm')) }, label(d)));
      }
      append(alerts, row, btns);
    }
    setHidden(alerts, alerts.children.length === 0);
    // Vitals
    setText(cells.pop.value, fmtInt(v.population));
    setText(cells.pop.note, `/ ${fmtInt(v.housing)} housed`);
    setText(cells.grain.value, fmtDays(v.reserveDays));
    setText(cells.grain.note, `${fmtInt(s.foodStored)} stored`);
    for (const c of ['green', 'amber', 'red']) setClass(cells.grain.el, `reserve-${c}`, v.reserveColor === c);
    setText(cells.price.value, `${v.grainPrice.toFixed(2)}×`);
    setClass(cells.price.el, 'danger', v.grainPrice > 1.5);
    setText(cells.price.note, v.grainPrice > 1.5 ? 'dear' : v.grainPrice < 0.8 ? 'cheap' : 'fair');
    setText(cells.water.value, fmtPct(s.waterAvailability));
    setText(cells.water.note, `irrigation ${fmtPct(s.irrigation)}`);
    setText(cells.loyalty.value, fmtPct(v.loyalty));
    setClass(cells.loyalty.el, 'danger', v.loyalty < 0.4);
    setText(cells.unrest.value, label(v.stage));
    setText(cells.unrest.note, fmtPct(v.unrest));
    setClass(cells.unrest.el, 'danger', !['calm', 'grumbling'].includes(v.stage));
    setClass(cells.unrest.el, 'warning', v.stage === 'grumbling');
    setText(cells.order.value, fmtPct(v.publicOrder));
    setText(cells.health.value, fmtPct(v.health));
    setText(cells.health.note, `sanitation ${fmtPct(v.sanitation)}`);
    // Labor + tax
    setHidden(laborSection, !mine);
    if (mine) {
      let sum = 0;
      for (const k of LABOR_KEYS) sum += s.laborAllocation[k];
      for (const k of LABOR_KEYS) laborSliders.get(k)!.set(s.laborAllocation[k], { max: Math.min(1, 1 - (sum - s.laborAllocation[k])), hint: `${fmtInt(s.labor * s.laborAllocation[k])} workers` });
      setText(laborIdle, sum < 0.999 ? `${fmtPct(1 - sum)} of the ${fmtInt(s.labor)} workers idle` : `All ${fmtInt(s.labor)} workers assigned`);
      tax.set(s.taxRate, { hint: `${fmtInt(s.taxIncome)} wealth last month` });
    }
    renderBuildings(w, s, mine);
    renderQueues(w, s, v, mine);
    // Garrison
    syncList(
      garrison,
      s.garrison.filter((u) => u.soldiers > 0),
      (u) => u.id,
      (u) => h('div', { class: 'garrison-unit', title: UNITS[u.unitClass].name }, icon(unitIcon(u.unitClass)), h('span', { class: 'gu-n' })),
      (node, u) => setText(node.querySelector('.gu-n')!, fmtInt(u.soldiers)),
    );
    setText(gSection.firstElementChild!, `Garrison · ${fmtInt(v.garrisonSoldiers)} soldiers · walls level ${v.fortLevel}`);
  };

  const renderBuildings = (w: WorldState, s: SettlementState, mine: boolean): void => {
    syncList(
      buildings,
      s.buildings,
      (b) => b.type,
      (b) => {
        const lv = pips(BUILDINGS[b.type].maxLevel, 'level-pips');
        const cond = meter('progress', 'cond');
        const tile = h('button', { class: 'building-tile', type: 'button' }, icon(`b_${b.type}`), h('span', { class: 'bt-name' }, BUILDINGS[b.type].name), lv.el, cond.el);
        (tile as unknown as { __lv: typeof lv; __cond: typeof cond }).__lv = lv;
        (tile as unknown as { __lv: typeof lv; __cond: typeof cond }).__cond = cond;
        tile.addEventListener('click', () => {
          const st = world?.settlements[sid];
          const inst = st?.buildings.find((x) => x.type === b.type);
          if (!world || !st || !inst || st.ownerFactionId !== world.playerFactionId) return;
          if (inst.condition < 0.95) {
            const reason = commandReason(world, world.playerFactionId, { kind: 'repair_building', settlementId: sid, building: b.type });
            if (reason) {
              ui.tooltips.open(tile, { title: `Repair ${BUILDINGS[b.type].name}`, hint: reason, hintTone: 'danger' }, true);
              sfx(ctx, 'ui_error');
              return;
            }
            ctx.actions.issueStrategic({ kind: 'repair_building', settlementId: sid, building: b.type });
            sfx(ctx, 'ui_confirm');
          } else ui.tooltips.open(tile, tileTip(b.type), true);
        });
        ui.tooltips.attach(tile, () => tileTip(b.type));
        return tile;
      },
      (tile, b) => {
        const t = tile as unknown as { __lv: ReturnType<typeof pips>; __cond: ReturnType<typeof meter> };
        t.__lv.set(b.level, BUILDINGS[b.type].maxLevel);
        t.__cond.set(b.condition, { warn: b.condition < 0.5 });
        setClass(tile, 'damaged', b.condition < 0.5);
        setClass(tile, 'repairable', mine && b.condition < 0.95);
        tile.setAttribute('aria-label', `${BUILDINGS[b.type].name} level ${b.level}, condition ${fmtPct(b.condition)}${mine && b.condition < 0.95 ? ', tap to repair' : ''}`);
      },
    );
  };
  const tileTip = (type: SettlementState['buildings'][number]['type']) => {
    const st = world?.settlements[sid];
    const inst = st?.buildings.find((x) => x.type === type);
    const def = BUILDINGS[type];
    return { title: def.name, icon: `b_${type}`, text: def.description, rows: inst ? ([['Level', `${inst.level} / ${def.maxLevel}`], ['Condition', fmtPct(inst.condition), inst.condition < 0.5 ? 'danger' : null], ['Upkeep', `${def.upkeepWealth} / month`]] as const) : [], hint: inst && inst.condition < 0.95 ? 'Tap to repair.' : undefined };
  };

  const renderQueues = (w: WorldState, s: SettlementState, v: SettlementVitals, mine: boolean): void => {
    syncList(
      constructionList,
      v.construction,
      (j) => `${j.index}:${j.type}:${j.landmarkId ?? ''}`,
      (j) => {
        const m = meter('progress');
        const name = h('span', { class: 'q-name' });
        const days = h('span', { class: 'q-days muted' });
        const cancel = h('button', { class: 'btn icon ghost q-cancel', type: 'button', 'aria-label': 'Cancel' }, icon('close'));
        const row = h('div', { class: 'queue-row' }, icon(j.landmarkId ? 'b_landmark' : `b_${j.type}`), h('div', { class: 'q-main' }, h('div', { class: 'q-line' }, name, days), m.el), cancel);
        (row as unknown as { __m: typeof m }).__m = m;
        cancel.addEventListener('click', () => {
          const cur = settlementVitals(world!, sid)?.construction.find((x) => x.type === j.type && (x.landmarkId ?? null) === (j.landmarkId ?? null));
          if (!cur) return;
          ctx.actions.issueStrategic({ kind: 'cancel_construction', settlementId: sid, building: cur.type, jobIndex: cur.index });
          sfx(ctx, 'ui_close');
        });
        return row;
      },
      (row, j) => {
        const lm = j.landmarkId ? LANDMARKS.find((l) => l.id === j.landmarkId) : null;
        setText(row.querySelector('.q-name')!, lm ? lm.name : `${BUILDINGS[j.type].name}${j.targetLevel > 1 ? ` → ${j.targetLevel}` : ''}`);
        setText(row.querySelector('.q-days')!, `${Math.round(j.progress * 100)}%${j.daysLeft !== null ? ` · ${fmtDays(j.daysLeft)}` : ' · no builders'} · ${j.stage.label}`);
        (row as unknown as { __m: ReturnType<typeof meter> }).__m.set(j.progress);
        const btn = row.querySelector('.q-cancel') as HTMLButtonElement;
        const locked = !!j.landmarkId && j.progress >= 0.5;
        setHidden(btn, !mine);
        btn.disabled = locked;
        btn.title = locked ? 'A landmark cannot be cancelled after 50%' : 'Cancel (90% of the unspent cost is refunded)';
      },
    );
    setHidden(constructionList.parentElement!, v.construction.length === 0 && !mine);
    if (v.construction.length === 0) {
      if (!constructionList.querySelector('.q-empty')) constructionList.append(h('div', { class: 'q-empty muted' }, mine ? 'Nothing under construction. Use the command card to build.' : 'Nothing under construction.'));
    } else constructionList.querySelector('.q-empty')?.remove();
    syncList(
      recruitList,
      s.recruitment,
      (r) => `${r.unitClass}:${r.startedDay}`,
      (r) => {
        const m = meter('progress');
        const row = h('div', { class: 'queue-row' }, icon(unitIcon(r.unitClass)), h('div', { class: 'q-main' }, h('div', { class: 'q-line' }, h('span', { class: 'q-name' }), h('span', { class: 'q-days muted' })), m.el));
        (row as unknown as { __m: typeof m }).__m = m;
        return row;
      },
      (row, r) => {
        setText(row.querySelector('.q-name')!, `${UNITS[r.unitClass].name} × ${r.formations}`);
        setText(row.querySelector('.q-days')!, `${Math.round(r.progress * 100)}%${r.targetArmyId ? ` → ${w.armies[r.targetArmyId]?.name ?? 'army'}` : ''}`);
        (row as unknown as { __m: ReturnType<typeof meter> }).__m.set(r.progress);
      },
    );
    setHidden(recruitList.parentElement!, s.recruitment.length === 0);
  };

  return {
    id: 'settlement_panel',
    layer: 'panel',
    el: frame.el,
    update(p) {
      world = p.world as WorldState;
      if (p.settlementId !== sid) {
        sid = p.settlementId;
        frame.body.scrollTop = 0;
      }
      render();
    },
  };
}
