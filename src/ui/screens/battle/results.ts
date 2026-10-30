/**
 * Battle results (DESIGN_SPEC §6.12, §12.2): victory / defeat banner with the reason, per-side table (start,
 * survivors, killed, captured, pursuit losses), the player's formations (start -> survivors, routed, experience
 * gained), prisoners choice (Ransom / Release, world battles), commander fate, chronicle line, Continue.
 * OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 */
import type { AppContext } from '../../../app/contracts';
import type { BattleEndReason, BattleSideResult, PrisonerDecision } from '../../../core/types';
import { UNITS } from '../../../data/units';
import { append, clear, fmtClock, fmtInt, h } from '../../dom';
import type { Screen, UIManager } from '../../ui';
import { icon, unitIcon } from '../../components/icons';
import { factionChip, panelFrame, section } from '../../components/widgets';
import { factionName } from '../world/common';

const REASON: Readonly<Record<BattleEndReason, string>> = {
  rout: 'The enemy broke and fled',
  annihilation: 'An army was destroyed',
  withdrawal: 'An army withdrew from the field',
  surrender: 'An army laid down its arms',
  time_limit: 'Night fell on the field',
  objective: 'The objective was decided',
  siege_breach: 'The walls were breached and held',
  siege_held: 'The walls held',
};

function fate(s: BattleSideResult, name: string | null): string {
  const who = name ?? 'The commander';
  switch (s.commanderFate) {
    case 'safe':
      return `${who} is safe`;
    case 'wounded':
      return `${who} was wounded`;
    case 'killed':
      return `${who} fell in battle`;
    case 'captured':
      return `${who} was taken prisoner`;
    default:
      return 'No commander took the field';
  }
}

export function battleResults(ctx: AppContext, ui: UIManager): Screen<'battle_results'> {
  void ui;
  const frame = panelFrame({ id: 'battle_results', variant: 'modal', title: '', torana: true });
  frame.el.classList.add('wide', 'battle-results');
  const banner = h('div', { class: 'br-banner' });
  const table = h('table', { class: 'br-table' });
  const forms = h('div', { class: 'br-forms' });
  const prisoners = h('div', { class: 'br-prisoners' });
  const fates = h('div', { class: 'br-fates' });
  const chronicle = h('p', { class: 'epigraph br-chronicle' });
  const btns = h('div', { class: 'btn-row br-buttons' });
  append(frame.body, banner, table, section('Your formations', forms), prisoners, fates, chronicle, btns);
  let decided: PrisonerDecision | null = null;
  let decidedFor: string | null = null;
  const syncPrisonerButtons = (): void => {
    for (const b of prisoners.querySelectorAll('button')) (b as HTMLButtonElement).disabled = decided !== null;
  };
  return {
    id: 'battle_results',
    layer: 'modal',
    el: frame.el,
    update(p) {
      const o = p.outcome;
      const ps = p.playerSide;
      const won = o.winner === ps;
      const draw = o.winner === null;
      if (decidedFor !== o.battleId) {
        decidedFor = o.battleId;
        decided = null;
      }
      frame.setTitle(draw ? 'An Indecisive Field' : won ? 'Victory' : 'Defeat', `${REASON[o.reason]} · ${fmtClock(o.durationSec)}${o.placeName ? ` · ${o.placeName}` : ''}`);
      clear(banner);
      banner.className = `br-banner ${draw ? 'mixed' : won ? 'victory' : 'defeat'}`;
      append(banner, icon(draw ? 'lotus' : won ? 'crown' : 'flag'), ...o.summary.slice(0, 2).map((s) => h('span', null, s)));
      clear(table);
      table.append(h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Started'), h('th', null, 'Survived'), h('th', null, 'Killed'), h('th', null, 'Captured'), h('th', null, 'In pursuit'))));
      const tb = h('tbody');
      o.sides.forEach((s, i) => tb.append(h('tr', { class: i === ps ? 'mine' : '' }, h('td', null, factionChip(s.factionId, 'sm'), ` ${factionName(s.factionId)}${i === ps ? ' (you)' : ''}`), h('td', null, fmtInt(s.startSoldiers)), h('td', null, fmtInt(s.survivors)), h('td', null, fmtInt(s.killed)), h('td', null, fmtInt(s.captured)), h('td', null, fmtInt(s.pursuitLosses)))));
      table.append(tb);
      clear(forms);
      for (const f of o.sides[ps].formations) {
        forms.append(h('div', { class: `br-form${f.routed ? ' routed' : ''}` }, icon(unitIcon(f.unitClass)), h('span', { class: 'br-fname' }, UNITS[f.unitClass].name), h('span', null, `${fmtInt(f.startSoldiers)} → ${fmtInt(f.survivors)}`), f.routed ? h('span', { class: 'danger' }, 'routed') : null, f.experienceGained > 0 ? h('span', { class: 'positive' }, `+${Math.round(f.experienceGained * 100)}% exp`) : null, f.routedEnemies > 0 ? h('span', { class: 'muted' }, `${f.routedEnemies} routed`) : null));
      }
      clear(prisoners);
      const mine = o.sides[ps];
      if (won && mine.prisoners > 0 && p.engagementId) {
        const choose = (d: PrisonerDecision): void => {
          decided = d;
          if (ctx.actions.decidePrisoners) ctx.actions.decidePrisoners(p.engagementId!, d);
          else ctx.actions.issueStrategic({ kind: 'prisoners', engagementId: p.engagementId!, decision: d });
          ctx.bus.emit('audio:sfx', { sfx: d === 'ransom' ? 'coins' : 'ui_confirm' });
          syncPrisonerButtons();
        };
        append(
          prisoners,
          section(
            `${fmtInt(mine.prisoners)} prisoners`,
            h('div', { class: 'muted' }, 'Ransom them for silver, or release them for honour (their realm thinks better of you).'),
            h('div', { class: 'btn-row' }, h('button', { class: `btn${decided === 'ransom' ? ' active' : ''}`, type: 'button', disabled: decided !== null, onclick: () => choose('ransom') }, icon('coins'), 'Ransom'), h('button', { class: `btn${decided === 'release' ? ' active' : ''}`, type: 'button', disabled: decided !== null, onclick: () => choose('release') }, icon('lotus'), 'Release')),
          ),
        );
      }
      clear(fates);
      o.sides.forEach((s) => fates.append(h('div', { class: `br-fate ${s.commanderFate === 'killed' || s.commanderFate === 'captured' ? 'danger' : ''}` }, icon('crown'), `${factionName(s.factionId)}: ${fate(s, null)}`)));
      chronicle.textContent = o.chronicle ? `"${o.chronicle}"` : '';
      clear(btns);
      append(btns, h('button', { class: 'btn primary big', type: 'button', onclick: () => void ctx.actions.continueAfterBattle() }, p.continueLabel));
    },
  };
}
