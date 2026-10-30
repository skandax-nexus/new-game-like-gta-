/**
 * Realm screens: diplomacy (faction list with heraldry, opinion bar, trust, treaty icons, war score; proposal composer
 * with the AI's predicted answer and reason lines; envoys awaiting an answer; past replies with their reasons),
 * council (five seats with portraits and "Do it") and chronicle (by month, important entries emphasised).
 * OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 */
import type { AppContext } from '../../../app/contracts';
import type { FactionId, ProposalType, TreatyTerms, WorldState } from '../../../core/types';
import { COUNCIL_SEATS } from '../../../core/types';
import { relationKey } from '../../../core/ids';
import { MONTH_NAMES, totalDays } from '../../../sim/strategic/seasons';
import { commandReason, evaluateAcceptance, pendingProposals } from '../../../sim/strategic/selectors';
import { append, clear, fmtInt, fmtPct, h, label, setClass, setHidden, setText, syncList } from '../../dom';
import type { Screen, UIManager } from '../../ui';
import { icon } from '../../components/icons';
import { factionChip, meter, panelFrame, portrait, section, stepper } from '../../components/widgets';
import { factionName, SEAT_ICONS, SEAT_NAMES, sfx } from './common';

const PROPOSALS: readonly { type: ProposalType; label: string; icon: string }[] = [
  { type: 'peace', label: 'Peace', icon: 'diplomacy' },
  { type: 'ceasefire', label: 'Ceasefire', icon: 'hourglass' },
  { type: 'trade', label: 'Trade pact', icon: 'coins' },
  { type: 'non_aggression', label: 'Non-aggression', icon: 'a_stance_cautious' },
  { type: 'military_access', label: 'Military access', icon: 'a_move' },
  { type: 'mutual_defense', label: 'Mutual defence', icon: 'o_defend' },
  { type: 'tributary', label: 'Offer tribute', icon: 'crown' },
  { type: 'demand_tribute', label: 'Demand tribute', icon: 'crown' },
  { type: 'declare_war', label: 'Declare war', icon: 'swords' },
];

const TREATY_ICON: Readonly<Record<string, string>> = { peace: 'diplomacy', trade: 'coins', military_access: 'a_move', mutual_defense: 'o_defend', tributary: 'crown', marriage_alliance: 'lotus', non_aggression: 'a_stance_cautious' };


/**
 * One AI reason line, coloured and iconed by its sign (Art Director polish: "+20" positive with a plus, "-13" danger
 * with a minus; colour is never the only cue). Lines without a signed number stay neutral.
 */
function reasonItem(r: string): HTMLElement {
  const m = /(^|\s|\()([+\-\u2212])\s?\d/.exec(r);
  const sign = m ? (m[2] === '+' ? 'positive' : 'danger') : null;
  return h('li', { class: sign ? `dip-reason ${sign}` : 'dip-reason' }, sign ? icon(sign === 'positive' ? 'plus' : 'minus', 'dip-sign') : null, h('span', null, r));
}

export function diplomacyScreen(ctx: AppContext, ui: UIManager): Screen<'diplomacy'> {
  let world: WorldState | null = null;
  let selected: FactionId | null = null;
  let ptype: ProposalType = 'trade';
  let tribute = 50;
  const frame = panelFrame({ id: 'diplomacy', variant: 'modal', title: 'Diplomacy', subtitle: 'Envoys, treaties and war', onClose: () => ui.hide('diplomacy'), torana: true });
  frame.el.classList.add('wide', 'diplomacy');
  const list = h('div', { class: 'dip-list', role: 'listbox', 'aria-label': 'Realms' });
  const detail = h('div', { class: 'dip-detail' });
  const back = h('button', { class: 'btn small ghost dip-back', type: 'button', onclick: () => ((selected = null), render()) }, icon('chevron_right'), 'All realms');
  append(frame.body, h('div', { class: 'dip-cols' }, list, h('div', { class: 'dip-right' }, back, detail)));

  const render = (): void => {
    const w = world;
    if (!w) return;
    const me = w.playerFactionId;
    const others = Object.keys(w.factions)
      .sort()
      .filter((f) => f !== me && w.factions[f]!.alive);
    if (!selected || !others.includes(selected)) selected = ui.layout === 'pc' ? (others[0] ?? null) : selected && others.includes(selected) ? selected : null;
    setClass(frame.el, 'has-detail', !!selected);
    syncList(
      list,
      others,
      (f) => f,
      (f) => {
        const op = meter('morale', 'opinion');
        const row = h('button', { class: 'dip-row', type: 'button', role: 'option' }, factionChip(f, 'md'), h('div', { class: 'dip-row-main' }, h('div', { class: 'dip-row-top' }, h('b', { class: 'dip-name' }), h('span', { class: 'dip-status' })), op.el, h('div', { class: 'dip-treaties' })));
        (row as unknown as { __op: typeof op }).__op = op;
        row.addEventListener('click', () => {
          selected = f;
          sfx(ctx);
          render();
        });
        return row;
      },
      (row, f) => {
        const rel = w.diplomacy.relations[relationKey(f, me)];
        const atWar = !!rel?.atWar;
        setText(row.querySelector('.dip-name')!, factionName(f));
        const st = row.querySelector('.dip-status') as HTMLElement;
        setText(st, atWar ? `At war · score ${rel ? Math.round(rel.a === me ? rel.warScore : -rel.warScore) : 0}` : `Opinion ${Math.round(rel?.opinion ?? 0)} · trust ${fmtPct(rel?.trust ?? 0)}`);
        setClass(st, 'danger', atWar);
        // At war: the chip carries the enemy ring style (spiked red ring), not only red text (ART_BIBLE §11.6).
        setClass(row.querySelector('.faction-chip') as HTMLElement, 'rel-enemy', atWar);
        (row as unknown as { __op: ReturnType<typeof meter> }).__op.set(((rel?.opinion ?? 0) + 100) / 200, { warn: (rel?.opinion ?? 0) < -25 });
        const tr = row.querySelector('.dip-treaties') as HTMLElement;
        clear(tr);
        for (const tid of rel?.treatyIds ?? []) {
          const t = w.diplomacy.treaties[tid];
          if (t && !t.brokenBy) tr.append(h('span', { class: 'treaty-icon', title: label(t.type) }, icon(TREATY_ICON[t.type] ?? 'scroll'), label(t.type)));
        }
        setClass(row, 'selected', selected === f);
        row.setAttribute('aria-selected', selected === f ? 'true' : 'false');
      },
    );
    clear(detail);
    if (!selected) {
      append(detail, h('div', { class: 'muted dip-empty' }, 'Choose a realm to send an envoy.'));
      return;
    }
    const f = selected;
    const rel = w.diplomacy.relations[relationKey(f, me)];
    append(detail, h('div', { class: 'dip-head' }, factionChip(f, 'lg'), h('div', null, h('div', { class: 'panel-title' }, factionName(f)), h('div', { class: 'panel-sub' }, rel?.atWar ? 'At war with you' : `Opinion ${Math.round(rel?.opinion ?? 0)} · trust ${fmtPct(rel?.trust ?? 0)}${rel?.truceUntilDay ? ' · truce' : ''}`))));
    // Envoys waiting for our answer.
    const waiting = pendingProposals(w, me).filter((p) => p.from === f);
    for (const p of waiting) {
      append(
        detail,
        h(
          'div',
          { class: 'card dip-incoming' },
          h('div', null, icon('scroll'), h('b', null, ` ${factionName(f)} proposes: ${label(p.type)}`), h('span', { class: 'muted' }, ` · ${p.daysLeft} days to answer`)),
          h('ul', { class: 'dip-reasons' }, ...p.reasons.map(reasonItem)),
          h('div', { class: 'btn-row' }, h('button', { class: 'btn primary small', type: 'button', onclick: () => (ctx.actions.issueStrategic({ kind: 'respond_proposal', proposalId: p.id, accept: true }), sfx(ctx, 'ui_confirm')) }, 'Accept'), h('button', { class: 'btn small', type: 'button', onclick: () => (ctx.actions.issueStrategic({ kind: 'respond_proposal', proposalId: p.id, accept: false }), sfx(ctx)) }, 'Refuse')),
        ),
      );
    }
    // Composer
    const types = PROPOSALS.filter((p) => (rel?.atWar ? p.type === 'peace' || p.type === 'ceasefire' : p.type !== 'peace' && p.type !== 'ceasefire'));
    if (!types.some((t) => t.type === ptype)) ptype = types[0]!.type;
    const seg = h('div', { class: 'seg wrap', role: 'radiogroup', 'aria-label': 'Proposal' });
    for (const t of types) {
      seg.append(
        h(
          'button',
          {
            class: `btn small${t.type === ptype ? ' active' : ''}${t.type === 'declare_war' ? ' danger' : ''}`,
            type: 'button',
            role: 'radio',
            'aria-checked': t.type === ptype ? 'true' : 'false',
            onclick: () => {
              ptype = t.type;
              sfx(ctx);
              render();
            },
          },
          icon(t.icon),
          t.label,
        ),
      );
    }
    const terms: TreatyTerms = { tributePerMonth: 0, payer: null, overlord: null, autonomy: 0, marriage: null, durationDays: 360 };
    let termsRow: HTMLElement | null = null;
    if (ptype === 'tributary' || ptype === 'demand_tribute') {
      terms.tributePerMonth = tribute;
      terms.payer = ptype === 'tributary' ? me : f;
      terms.overlord = ptype === 'tributary' ? f : me;
      const st = stepper({ label: 'Tribute per month', min: 10, max: 500, value: tribute, format: (v) => `${fmtInt(v * 10)} wealth / month`, onChange: (v) => ((tribute = v * 10), render()) });
      st.set(Math.round(tribute / 10), 50);
      termsRow = h('div', { class: 'dip-terms' }, h('span', { class: 'muted' }, 'Terms'), st.el);
    }
    const cmd = { kind: 'propose' as const, to: f, type: ptype, terms };
    const reason = commandReason(w, me, cmd);
    const acc = ptype === 'declare_war' ? null : evaluateAcceptance(w, me, f, ptype);
    const send = h('button', { class: `btn ${ptype === 'declare_war' ? 'danger' : 'primary'}`, type: 'button', disabled: !!reason, title: reason ?? '', onclick: () => (ctx.actions.issueStrategic(cmd), sfx(ctx, 'ui_confirm')) }, icon(ptype === 'declare_war' ? 'swords' : 'scroll'), ptype === 'declare_war' ? 'Declare war' : 'Send the envoy');
    append(
      detail,
      section(
        'Proposal',
        seg,
        termsRow,
        acc
          ? h(
              'div',
              { class: `dip-reply ${acc.accept ? 'positive' : 'danger'}` },
              h('div', { class: 'dip-reply-head' }, icon(acc.accept ? 'check' : 'cross'), h('b', null, acc.accept ? 'They would likely accept' : 'They would likely refuse')),
              h('ul', { class: 'dip-reasons' }, ...acc.reasons.map(reasonItem)),
            )
          : null,
        reason ? h('div', { class: 'danger dip-why' }, icon('alert'), reason) : null,
        h('div', { class: 'btn-row' }, send),
      ),
    );
    // Recent replies with reasons.
    const past = w.diplomacy.proposals.filter((p) => p.from === me && p.to === f && p.status !== 'pending').slice(-3).reverse();
    if (past.length) {
      append(
        detail,
        section(
          'Their replies',
          ...past.map((p) => h('div', { class: `card dip-past ${p.status === 'accepted' ? 'positive' : 'danger'}` }, h('div', null, icon(p.status === 'accepted' ? 'check' : 'cross'), h('b', null, ` ${label(p.type)}: ${p.status}`), h('span', { class: 'muted' }, ` · day ${p.day}`)), h('ul', { class: 'dip-reasons' }, ...p.reasons.map(reasonItem)))),
        ),
      );
    }
  };

  return {
    id: 'diplomacy',
    layer: 'modal',
    el: frame.el,
    update(p) {
      world = p.world as WorldState;
      render();
    },
  };
}

export function councilScreen(ctx: AppContext, ui: UIManager): Screen<'council'> {
  const frame = panelFrame({ id: 'council', variant: 'modal', title: 'Royal Council', subtitle: 'Five seats advise the throne', onClose: () => ui.hide('council'), torana: true });
  const seats = h('div', { class: 'council-seats' });
  append(frame.body, seats);
  return {
    id: 'council',
    layer: 'modal',
    el: frame.el,
    update(p) {
      const w = p.world as WorldState;
      const f = w.factions[w.playerFactionId];
      clear(seats);
      for (const seat of COUNCIL_SEATS) {
        const id = f?.council[seat];
        const c = id ? w.characters[id] : null;
        const rec = p.recommendations.find((r) => r.seat === seat);
        const reason = rec?.suggestion ? commandReason(w, w.playerFactionId, rec.suggestion) : null;
        seats.append(
          h(
            'div',
            { class: `card council-seat${rec && rec.urgency >= 0.5 ? ' urgent' : ''}` },
            portrait({ name: c?.name ?? 'Vacant', factionId: w.playerFactionId, badgeIcon: SEAT_ICONS[seat], size: 'md' }),
            h(
              'div',
              { class: 'seat-main' },
              h('div', { class: 'seat-title' }, h('b', null, SEAT_NAMES[seat] ?? label(seat)), h('span', { class: 'muted' }, ` · ${c?.name ?? 'vacant'}`)),
              c ? h('div', { class: 'muted seat-op' }, `Loyalty ${fmtPct(c.loyalty)} · opinion of the ruler ${Math.round(c.opinionOfRuler)}`) : null,
              rec ? h('div', { class: 'seat-rec' }, `"${rec.text}"`) : h('div', { class: 'faint' }, 'No advice this month.'),
              rec?.suggestion
                ? h('div', { class: 'btn-row' }, h('button', { class: 'btn small primary', type: 'button', disabled: !!reason, title: reason ?? '', onclick: () => (ctx.actions.issueStrategic(rec.suggestion!), sfx(ctx, 'ui_confirm')) }, icon('check'), 'Do it'), reason ? h('span', { class: 'danger small-text' }, reason) : null)
                : null,
            ),
          ),
        );
      }
    },
  };
}

export function chronicleScreen(ctx: AppContext, ui: UIManager): Screen<'chronicle'> {
  void ctx;
  const frame = panelFrame({ id: 'chronicle', variant: 'modal', title: 'The Chronicle', onClose: () => ui.hide('chronicle'), parchment: true, torana: true });
  const body = h('div', { class: 'chronicle-list' });
  append(frame.body, body);
  let lastLen = -1;
  return {
    id: 'chronicle',
    layer: 'modal',
    el: frame.el,
    update(p) {
      const w = p.world;
      if (w.chronicle.length === lastLen) return;
      lastLen = w.chronicle.length;
      clear(body);
      let month = '';
      const cal = w.calendar;
      const today = totalDays(cal);
      const nowAbs = (cal.year * 12 + cal.month) * 30 + cal.day;
      for (const e of w.chronicle.slice().reverse()) {
        const abs = nowAbs - (today - e.day);
        const mi = ((Math.floor(abs / 30) % 12) + 12) % 12;
        const yr = Math.floor(abs / 360);
        const key = `${MONTH_NAMES[mi]}, ${yr < 0 ? `${-yr} BCE` : `${yr} CE`}`;
        if (key !== month) {
          month = key;
          body.append(h('div', { class: 'chron-month' }, key));
        }
        body.append(h('div', { class: `chron-entry imp-${e.importance}` }, h('span', { class: 'chron-day' }, `Day ${e.day}`), h('span', null, e.text)));
      }
      setHidden(body, false);
      if (!w.chronicle.length) body.append(h('div', { class: 'muted' }, 'Nothing is written yet.'));
    },
  };
}
