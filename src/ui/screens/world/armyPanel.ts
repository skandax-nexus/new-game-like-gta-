/**
 * Army panel and province panel (DESIGN_SPEC §12.2). Army: commander portrait + skills, units (class icon,
 * strength and morale bars, experience chevrons, split selection), supply bar (days of food, line intact icon, source
 * and every reason grain does not arrive), stance, forced march. Province: governor (portrait, loyalty, interest),
 * autonomy, settlements list (tap to select), fertility and resources.
 * OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 */
import type { AppContext } from '../../../app/contracts';
import type { ArmyStance, WorldState } from '../../../core/types';
import { UNITS } from '../../../data/units';
import { RESOURCE_KIND_FEEDS } from '../../../data/resources';
import { armySupplyView, commandReason } from '../../../sim/strategic/selectors';
import { append, clear, fmtDays, fmtInt, fmtPct, h, label, setAttr, setClass, setHidden, setText, syncList } from '../../dom';
import type { Screen, UIManager } from '../../ui';
import { icon, unitIcon } from '../../components/icons';
import { factionChip, meter, panelFrame, portrait, section, setFactionChip, statCell } from '../../components/widgets';
import { factionName, sfx } from './common';

const STANCES: readonly { id: ArmyStance; label: string; icon: string }[] = [
  { id: 'aggressive', label: 'Bold', icon: 'a_stance_aggressive' },
  { id: 'balanced', label: 'Steady', icon: 'a_stance_balanced' },
  { id: 'cautious', label: 'Wary', icon: 'a_stance_cautious' },
];

/** Experience rank 0..3 (drawn as stacked chevron icons by CSS from data-rank, like the battle cards). */
function chevronRank(exp: number): number {
  return exp >= 0.75 ? 3 : exp >= 0.45 ? 2 : exp >= 0.2 ? 1 : 0;
}

export function armyPanel(ctx: AppContext, ui: UIManager): Screen<'army_panel'> {
  let world: WorldState | null = null;
  let armyId = '';
  const splitSel = new Set<string>();
  const chip = factionChip(null, 'lg');
  const frame = panelFrame({ id: 'army_panel', variant: 'drawer', title: '', onClose: () => ui.hide('army_panel'), lead: chip });
  const cmdBox = h('div', { class: 'ap-commander' });
  const supplyMeter = meter('progress');
  const supplyLine = h('div', { class: 'ap-supply-line' });
  const supplyReasons = h('ul', { class: 'ap-reasons' });
  const supplyText = h('div', { class: 'ap-supply-text' });
  const supply = section('Supply', h('div', { class: 'ap-supply' }, supplyText, supplyMeter.el, supplyLine), supplyReasons);
  const stanceRow = h('div', { class: 'seg', role: 'group', 'aria-label': 'Stance' });
  const stanceBtns = new Map<ArmyStance, HTMLButtonElement>();
  for (const s of STANCES) {
    const b = h('button', { class: 'btn small', type: 'button', onclick: () => (ctx.actions.issueStrategic({ kind: 'set_army_stance', armyId, stance: s.id }), sfx(ctx)) }, icon(s.icon), s.label);
    stanceBtns.set(s.id, b);
    stanceRow.append(b);
  }
  const forcedBtn = h('button', { class: 'btn small', type: 'button' }, icon('a_forced_march'), h('span', null, 'Forced march'));
  forcedBtn.addEventListener('click', () => {
    const a = world?.armies[armyId];
    if (!a) return;
    ctx.actions.issueStrategic({ kind: 'forced_march', armyId, on: !a.forcedMarch });
    sfx(ctx);
  });
  const ordersSection = section('Orders', stanceRow, h('div', { class: 'btn-row' }, forcedBtn));
  const units = h('div', { class: 'ap-units' });
  const splitBtn = h('button', { class: 'btn small', type: 'button', disabled: true }, icon('a_split'), h('span', null, 'Split selected'));
  splitBtn.addEventListener('click', () => {
    if (!splitSel.size) return;
    ctx.actions.issueStrategic({ kind: 'split_army', armyId, unitIds: [...splitSel] });
    splitSel.clear();
    sfx(ctx, 'ui_confirm');
  });
  const unitsSection = section('Units', units, h('div', { class: 'btn-row' }, splitBtn));
  append(frame.body, cmdBox, supply, ordersSection, unitsSection);

  const render = (): void => {
    const w = world;
    const a = w?.armies[armyId];
    if (!w || !a) return;
    const mine = a.factionId === w.playerFactionId;
    const sv = armySupplyView(w, armyId);
    setFactionChip(chip, a.factionId);
    frame.setTitle(a.name, `${factionName(a.factionId)} · ${label(a.status)} · ${fmtInt(sv?.soldiers ?? 0)} soldiers`);
    // Commander
    clear(cmdBox);
    const c = a.commanderId ? w.characters[a.commanderId] : null;
    if (c) {
      append(
        cmdBox,
        portrait({ name: c.name, factionId: a.factionId, badgeIcon: 'sword', size: 'md' }),
        h(
          'div',
          { class: 'ap-cmd-text' },
          h('div', { class: 'ap-cmd-name' }, c.name),
          h('div', { class: 'ap-cmd-traits muted' }, c.traits.map((t) => label(t)).join(' · ') || 'No notable traits'),
          h('div', { class: 'ap-skills' }, ...(['martial', 'stewardship', 'diplomacy', 'intrigue', 'learning'] as const).map((k) => h('span', { class: 'skill', title: label(k) }, h('i', null, label(k).slice(0, 3)), h('b', null, String(c.skills[k]))))),
        ),
      );
    } else append(cmdBox, h('div', { class: 'muted' }, 'No named commander: a captain leads this host.'));
    // Supply
    if (sv) {
      setText(supplyText, `${fmtDays(sv.days)} of food · ${fmtInt(sv.food)} / ${fmtInt(sv.capacity)} · ${fmtInt(sv.needPerDay)} a day`);
      supplyMeter.set(Math.min(1, sv.days / 60), { warn: sv.days < 10 });
      clear(supplyLine);
      append(supplyLine, icon(sv.lineIntact ? 'check' : 'cross', sv.lineIntact ? 'positive' : 'danger'), h('span', null, sv.lineIntact ? 'Supply line intact' : 'Supply line cut'), sv.sourceId ? h('span', { class: 'muted' }, ` · from ${w.settlements[sv.sourceId]?.name ?? (sv.sourceKind === 'depot' ? 'a depot' : sv.sourceKind ?? '')}`) : null, sv.foraging ? h('span', { class: 'warning' }, ' · foraging') : null);
      syncList(supplyReasons, mine ? sv.reasons : [], (r) => r, (r) => h('li', { class: 'warning' }, icon('alert'), r), () => undefined);
    }
    // Orders
    setHidden(ordersSection, !mine);
    for (const [s, b] of stanceBtns) {
      setClass(b, 'active', a.stance === s);
      b.setAttribute('aria-pressed', a.stance === s ? 'true' : 'false');
    }
    const fmReason = mine ? commandReason(w, w.playerFactionId, { kind: 'forced_march', armyId, on: !a.forcedMarch }) : 'Not your army';
    forcedBtn.disabled = !!fmReason;
    forcedBtn.title = fmReason ?? 'x1.3 speed, +0.1 fatigue a day, 0.2% attrition a day';
    setClass(forcedBtn, 'active', a.forcedMarch);
    // Units
    for (const id of [...splitSel]) if (!a.units.some((u) => u.id === id)) splitSel.delete(id);
    syncList(
      units,
      a.units,
      (u) => u.id,
      (u) => {
        const str = meter('strength');
        const mor = meter('morale');
        const row = h(
          'button',
          { class: 'ap-unit', type: 'button', 'aria-pressed': 'false' },
          icon(unitIcon(u.unitClass)),
          h('div', { class: 'ap-unit-main' }, h('div', { class: 'ap-unit-line' }, h('span', { class: 'ap-unit-name' }), h('span', { class: 'ap-unit-n' }), h('span', { class: 'ap-chev', role: 'img', dataset: { rank: '0' } }, icon('chevron_up'), icon('chevron_up'), icon('chevron_up'))), str.el, mor.el),
        );
        (row as unknown as { __m: [typeof str, typeof mor] }).__m = [str, mor];
        row.addEventListener('click', () => {
          if (!mine) return;
          if (splitSel.has(u.id)) splitSel.delete(u.id);
          else splitSel.add(u.id);
          sfx(ctx);
          render();
        });
        return row;
      },
      (row, u) => {
        const [str, mor] = (row as unknown as { __m: [ReturnType<typeof meter>, ReturnType<typeof meter>] }).__m;
        setText(row.querySelector('.ap-unit-name')!, UNITS[u.unitClass].name);
        setText(row.querySelector('.ap-unit-n')!, `${fmtInt(u.soldiers)} / ${fmtInt(u.maxSoldiers)}`);
        const chev = row.querySelector('.ap-chev')!;
        const rank = chevronRank(u.experience);
        setAttr(chev, 'data-rank', String(rank));
        setAttr(chev, 'aria-label', rank ? `Experience ${rank} of 3` : null);
        str.set(u.soldiers / Math.max(1, u.maxSoldiers));
        mor.set(u.morale / 100, { warn: u.morale < 40 });
        setClass(row, 'selected', splitSel.has(u.id));
        row.setAttribute('aria-pressed', splitSel.has(u.id) ? 'true' : 'false');
        row.setAttribute('aria-label', `${UNITS[u.unitClass].name}: ${fmtInt(u.soldiers)} men, morale ${Math.round(u.morale)}, experience ${fmtPct(u.experience)}`);
      },
    );
    const canSplit = mine && splitSel.size > 0 && splitSel.size < a.units.length;
    splitBtn.disabled = !canSplit;
    splitBtn.title = canSplit ? 'The selected units march off as a new army' : 'Tap units to choose who splits off (keep at least one)';
    setHidden(splitBtn, !mine);
  };

  return {
    id: 'army_panel',
    layer: 'panel',
    el: frame.el,
    update(p) {
      world = p.world as WorldState;
      if (p.armyId !== armyId) {
        armyId = p.armyId;
        splitSel.clear();
      }
      render();
    },
  };
}

export function provincePanel(ctx: AppContext, ui: UIManager): Screen<'province_panel'> {
  let world: WorldState | null = null;
  let pid = '';
  const chip = factionChip(null, 'lg');
  const frame = panelFrame({ id: 'province_panel', variant: 'drawer', title: '', onClose: () => ui.hide('province_panel'), lead: chip });
  const govBox = h('div', { class: 'ap-commander' });
  const cells = { unrest: statCell('Unrest', 'alert'), autonomy: statCell('Autonomy', 'flag'), fertility: statCell('Fertility', 'sheaf') };
  const autoMeter = meter('progress');
  const list = h('div', { class: 'pp-settlements' });
  const res = h('div', { class: 'pp-res' });
  append(frame.body, govBox, h('div', { class: 'vitals-grid three' }, ...Object.values(cells).map((c) => c.el)), section('Autonomy', autoMeter.el), section('Settlements', list), section('Resources', res));
  return {
    id: 'province_panel',
    layer: 'panel',
    el: frame.el,
    update(p) {
      world = p.world as WorldState;
      pid = p.provinceId;
      const w = world;
      const pr = w.provinces[pid];
      if (!pr) return;
      setFactionChip(chip, pr.ownerFactionId);
      frame.setTitle(pr.name, `${label(pr.zone)} · ${factionName(pr.ownerFactionId)}`);
      clear(govBox);
      const g = pr.governorId ? w.characters[pr.governorId] : null;
      if (g) {
        const happy = g.loyalty >= 0.5;
        append(govBox, portrait({ name: g.name, factionId: g.factionId, badgeIcon: 'crown' }), h('div', { class: 'ap-cmd-text' }, h('div', { class: 'ap-cmd-name' }, `Governor ${g.name}`), h('div', { class: 'muted' }, `Loyalty ${fmtPct(g.loyalty)} · wants ${label(g.interest)}`), h('div', { class: happy ? 'positive' : 'warning' }, happy ? 'Content with his charge' : 'Restless: his interest is not served')));
      } else append(govBox, h('div', { class: 'muted' }, 'No governor: the province answers to the court directly.'));
      setText(cells.unrest.value, fmtPct(pr.unrest));
      setText(cells.unrest.note, label(pr.rebellionStage));
      setText(cells.autonomy.value, fmtPct(pr.autonomy));
      setText(cells.fertility.value, fmtPct(pr.fertility));
      autoMeter.set(pr.autonomy);
      syncList(
        list,
        pr.settlementIds.map((id) => w.settlements[id]).filter((s): s is NonNullable<typeof s> => !!s),
        (s) => s.id,
        (s) => {
          const b = h('button', { class: 'pp-settlement', type: 'button' }, factionChip(s.ownerFactionId, 'sm'), h('span', { class: 'pp-name' }), h('span', { class: 'pp-pop muted' }));
          b.addEventListener('click', () => {
            sfx(ctx);
            ctx.bus.emit('ui:world_select', { kind: 'settlement', id: s.id });
            ctx.bus.emit('ui:camera_focus', { x: s.x, z: s.z, distance: null });
          });
          return b;
        },
        (b, s) => {
          setFactionChip(b.firstElementChild as HTMLElement, s.ownerFactionId);
          setText(b.querySelector('.pp-name')!, s.name);
          setText(b.querySelector('.pp-pop')!, `${label(s.kind)} · ${fmtInt(s.population)}`);
        },
      );
      syncList(res, pr.resources, (r) => r, (r) => h('span', { class: 'chip' }, label(r), h('span', { class: 'muted' }, ` · ${RESOURCE_KIND_FEEDS[r].label}`)), () => undefined);
    },
  };
}
