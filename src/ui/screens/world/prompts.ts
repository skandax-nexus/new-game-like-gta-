/**
 * Blocking world prompts: event modal (illustration, body, choice cards with advisor portraits "Recommended by",
 * disabled choices with the unmet requirement, auto-resolve countdown), engagement prompt (two sides, prediction bar,
 * factor lines, queue + "Autoresolve all") and scenario results (epilogue, objectives, statistics link).
 * OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 */
import type { AppContext } from '../../../app/contracts';
import type { EventDef, WorldState } from '../../../core/types';
import { getEventDef } from '../../../data/events';
import { SCENARIOS } from '../../../data/campaign';
import { evalCondition, formatEventText } from '../../../sim/strategic/events';
import { totalDays } from '../../../sim/strategic/seasons';
import { append, clear, fmtInt, fmtPct, h, label, setStyle } from '../../dom';
import type { Screen, UIManager } from '../../ui';
import { icon } from '../../components/icons';
import { factionChip, panelFrame, portrait, section } from '../../components/widgets';
import { describeCondition, factionName, SEAT_ICONS, SEAT_NAMES, sfx } from './common';

const ILLUSTRATION_ICON: Readonly<Record<EventDef['illustration'], string>> = {
  granary: 'b_granary',
  court: 'council',
  battle: 'swords',
  river: 'b_ghat',
  temple: 'b_temple',
  market: 'b_market',
  monsoon: 'season_varsha',
  drought: 'season_grishma',
  fire: 'a_raid',
  crowd: 'villager',
  messenger: 'scroll',
  wedding: 'lotus',
  funeral: 'lotus',
  fort: 'b_fort_walls',
};

export function eventModal(ctx: AppContext, ui: UIManager): Screen<'event_modal'> {
  const frame = panelFrame({ id: 'event_modal', variant: 'modal', title: '', parchment: true, torana: true });
  frame.el.classList.add('event-card');
  const illus = h('div', { class: 'event-illus' });
  const body = h('p', { class: 'prose event-body' });
  const meta = h('div', { class: 'event-meta' });
  const choices = h('div', { class: 'event-choices' });
  frame.el.insertBefore(illus, frame.header);
  append(frame.body, h('div', { class: 'divider-lotus' }), body, meta, choices);
  let shownId = '';
  // The choice cards print 1, 2, 3...: those keys pick them (before the world context turns digits into control
  // groups), like dialogue choices in hero mode.
  const onKey = (e: KeyboardEvent): void => {
    if (!ui.isVisible('event_modal') || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    const btn = m ? (choices.children[Number(m[1]) - 1] as HTMLElement | undefined) : undefined;
    if (!btn) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    btn.click();
  };
  if (typeof window !== 'undefined') window.addEventListener('keydown', onKey, true);
  return {
    id: 'event_modal',
    layer: 'modal',
    el: frame.el,
    dispose() {
      if (typeof window !== 'undefined') window.removeEventListener('keydown', onKey, true);
    },
    update(p) {
      const w = p.world as WorldState;
      const inst = w.events.pending.find((e) => e.id === p.instanceId);
      const def = inst ? getEventDef(inst.defId) : undefined;
      if (!inst || !def) {
        ui.hide('event_modal');
        return;
      }
      const t = formatEventText(w, inst);
      frame.setTitle(t.title, label(def.category));
      clear(illus);
      illus.className = `event-illus illus-${def.illustration} cat-${def.category}`;
      append(illus, icon(ILLUSTRATION_ICON[def.illustration] ?? 'scroll'), h('span', { class: 'illus-cap' }, label(def.illustration)));
      body.textContent = t.body;
      clear(meta);
      if (def.autoResolveDays !== null) {
        const left = Math.max(0, def.autoResolveDays - (totalDays(w.calendar) - inst.day));
        const first = t.choices[0];
        append(meta, h('div', { class: 'event-countdown' }, icon('hourglass'), `Decides itself in ${left} day${left === 1 ? '' : 's'}${first ? `: "${first.label}"` : ''}`));
      }
      if (shownId !== inst.id) {
        shownId = inst.id;
        ctx.bus.emit('ui:hint', { key: 'world.event_received' });
      }
      clear(choices);
      const f = w.factions[w.playerFactionId];
      def.choices.forEach((c, i) => {
        const tc = t.choices[i]!;
        const ok = !c.requires || evalCondition(w, c.requires, inst.scope);
        const advId = c.advisorSeat ? f?.council[c.advisorSeat] : undefined;
        const adv = advId ? w.characters[advId] : null;
        const btn = h(
          'button',
          { class: `event-choice card${ok ? '' : ' disabled'}`, type: 'button', 'aria-disabled': ok ? null : 'true' },
          h('span', { class: 'choice-key' }, String(i + 1)),
          h(
            'div',
            { class: 'choice-main' },
            h('b', { class: 'choice-label' }, tc.label),
            h('div', { class: 'choice-desc' }, tc.description),
            c.advisorSeat ? h('div', { class: 'choice-adv' }, portrait({ name: adv?.name ?? SEAT_NAMES[c.advisorSeat] ?? 'Advisor', factionId: w.playerFactionId, badgeIcon: SEAT_ICONS[c.advisorSeat], size: 'sm' }), h('span', null, `Recommended by the ${SEAT_NAMES[c.advisorSeat] ?? label(c.advisorSeat)}${adv ? `, ${adv.name}` : ''}`)) : null,
            !ok && c.requires ? h('div', { class: 'choice-req' }, icon('lock'), describeCondition(c.requires, w)) : null,
          ),
        );
        btn.addEventListener('click', () => {
          if (!ok) {
            sfx(ctx, 'ui_error');
            return;
          }
          sfx(ctx, 'ui_confirm');
          ctx.actions.resolveEvent(inst.id, c.id);
          ui.hide('event_modal');
        });
        choices.append(btn);
      });
    },
  };
}

export function engagementPrompt(ctx: AppContext, ui: UIManager): Screen<'engagement_prompt'> {
  const frame = panelFrame({ id: 'engagement_prompt', variant: 'modal', title: 'Battle is Joined', torana: true });
  frame.el.classList.add('engagement');
  const queue = h('div', { class: 'eng-queue' });
  const sides = h('div', { class: 'eng-sides' });
  const bar = h('div', { class: 'eng-bar' });
  const factors = h('ul', { class: 'eng-factors list-lotus' });
  const buttons = h('div', { class: 'btn-row eng-buttons' });
  append(frame.body, queue, sides, bar, factors, buttons);
  return {
    id: 'engagement_prompt',
    layer: 'modal',
    el: frame.el,
    update(p) {
      const w = p.world as WorldState;
      const e = w.engagements[p.engagementId];
      if (!e) return;
      const me = w.playerFactionId;
      const playerSide = e.sides[1].some((id) => w.armies[id]?.factionId === me) ? 1 : 0;
      const pending = ctx.session.pendingEngagements ?? [];
      const where = e.settlementId ? w.settlements[e.settlementId]?.name : null;
      frame.setTitle('Battle is Joined', `${label(e.kind)}${where ? ` at ${where}` : ''}`);
      clear(queue);
      if (pending.length > 1) {
        const idx = Math.max(0, pending.indexOf(p.engagementId));
        append(
          queue,
          h('span', { class: 'chip' }, icon('swords'), `Battle ${idx + 1} of ${pending.length}`),
          h(
            'button',
            {
              class: 'btn small',
              type: 'button',
              onclick: () => {
                sfx(ctx, 'ui_confirm');
                ui.hide('engagement_prompt');
                for (const id of pending) void ctx.actions.decideEngagement(id, 'autoresolve');
              },
            },
            icon('hourglass'),
            'Autoresolve all',
          ),
        );
      }
      clear(sides);
      e.sides.forEach((ids, i) => {
        const armies = ids.map((id) => w.armies[id]).filter((a): a is NonNullable<typeof a> => !!a);
        const fac = armies[0]?.factionId ?? null;
        const men = armies.reduce((n, a) => n + a.units.reduce((m, u) => m + u.soldiers, 0), 0);
        const cmd = armies.map((a) => (a.commanderId ? w.characters[a.commanderId]?.name : null)).find((n) => !!n);
        sides.append(
          h(
            'div',
            { class: `eng-side${i === playerSide ? ' mine' : ''}` },
            h('div', { class: 'eng-side-head' }, factionChip(fac, 'lg'), h('div', null, h('b', null, factionName(fac)), h('div', { class: 'muted' }, i === 0 ? 'Attacker' : 'Defender'), i === playerSide ? h('span', { class: 'chip you' }, 'You') : null)),
            h('div', { class: 'eng-men' }, fmtInt(men), h('span', { class: 'muted' }, ' soldiers')),
            h('div', { class: 'muted' }, armies.map((a) => a.name).join(', ')),
            cmd ? h('div', { class: 'muted' }, icon('sword'), ` ${cmd}`) : null,
          ),
        );
        if (i === 0) sides.append(h('div', { class: 'eng-vs' }, icon('swords')));
      });
      const pr = p.prediction;
      const mine = playerSide === 0 ? pr.attackerWinChance : 1 - pr.attackerWinChance;
      clear(bar);
      const fill = h('i', { class: 'eng-fill' });
      setStyle(fill, 'width', `${Math.round(pr.attackerWinChance * 100)}%`);
      append(
        bar,
        h('div', { class: 'eng-bar-label' }, h('span', null, `Your chance: ${fmtPct(mine)}`), h('span', { class: 'muted' }, `Expected losses ${fmtInt(pr.expectedLosses[playerSide])} / ${fmtInt(pr.expectedLosses[1 - playerSide])}`)),
        h('div', { class: `eng-track side-${playerSide}`, role: 'meter', 'aria-valuenow': String(Math.round(mine * 100)), 'aria-label': 'Attacker win chance' }, fill, h('span', { class: 'eng-mid' })),
      );
      clear(factors);
      for (const fct of pr.factors.slice(0, 4)) factors.append(h('li', null, fct));
      clear(buttons);
      const go = (d: 'fight' | 'autoresolve' | 'retreat'): void => {
        sfx(ctx, 'ui_confirm');
        ui.hide('engagement_prompt');
        void ctx.actions.decideEngagement(p.engagementId, d);
      };
      append(
        buttons,
        h('button', { class: 'btn primary big', type: 'button', onclick: () => go('fight') }, icon('swords'), 'Take command'),
        h('button', { class: 'btn big', type: 'button', onclick: () => go('autoresolve') }, icon('hourglass'), 'Let the generals decide'),
        h('button', { class: 'btn danger big', type: 'button', onclick: () => go('retreat') }, icon('a_retreat'), 'Retreat'),
      );
      ctx.bus.emit('ui:hint', { key: 'world.engagement_prompt' });
    },
  };
}

export function scenarioResults(ctx: AppContext, ui: UIManager): Screen<'scenario_results'> {
  const frame = panelFrame({ id: 'scenario_results', variant: 'modal', title: 'The Chronicle Ends', parchment: true, torana: true });
  frame.el.classList.add('wide', 'scenario-results');
  const banner = h('div', { class: 'sr-banner' });
  const epi = h('p', { class: 'prose epigraph sr-epilogue' });
  const objs = h('ul', { class: 'list-lotus sr-objectives' });
  const btns = h('div', { class: 'btn-row sr-buttons' });
  append(frame.body, banner, epi, section('Objectives', objs), btns);
  return {
    id: 'scenario_results',
    layer: 'modal',
    el: frame.el,
    update(p) {
      const w = p.world as WorldState;
      const sc = w.scenarioId ? SCENARIOS[w.scenarioId] : null;
      const oc = sc?.outcomes.find((o) => o.id === w.victory.outcomeId);
      frame.setTitle(oc?.title ?? 'The Chronicle Ends', sc?.title ?? '');
      clear(banner);
      const kind = oc?.kind ?? (w.victory.status === 'victory' ? 'victory' : w.victory.status === 'defeat' ? 'defeat' : 'mixed');
      banner.className = `sr-banner ${kind}`;
      append(banner, icon(kind === 'victory' ? 'crown' : kind === 'defeat' ? 'flag' : 'lotus'), h('span', null, kind === 'victory' ? 'Victory' : kind === 'defeat' ? 'Defeat' : 'An uncertain peace'));
      epi.textContent = oc?.epilogue ?? '';
      clear(objs);
      for (const o of sc?.objectives ?? []) {
        const st = w.victory.objectives[o.id] ?? 'pending';
        objs.append(h('li', { class: st === 'complete' ? 'done' : st === 'failed' ? 'failed' : '' }, o.label, h('span', { class: 'muted' }, ` · ${st}`)));
      }
      clear(btns);
      append(
        btns,
        h('button', { class: 'btn primary', type: 'button', onclick: () => (sfx(ctx, 'ui_open'), ui.show('game_stats', { world: w, from: 'scenario_results' })) }, icon('scroll'), 'Statistics'),
        h('button', { class: 'btn', type: 'button', onclick: () => void ctx.actions.quitToMenu() }, 'Return to menu'),
      );
    },
  };
}
