/**
 * Runs a command-card slot (world and battle cards share it) and the touch control-group row.
 * OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 */
import type { AppContext, ScreenId } from '../../../app/contracts';
import type { WorldState } from '../../../core/types';
import { h, onLongPress, setClass, setText, syncList } from '../../dom';
import type { UIManager } from '../../ui';
import type { CardSlot } from '../../services/commandCards';
import { emitHud } from '../../services/hudCommands';

/** Screens a card slot may open with `{ world, factionId }` / `{ world }` props. */
export function openWorldScreen(ctx: AppContext, ui: UIManager, screen: ScreenId, world: Readonly<WorldState>): void {
  const factionId = world.playerFactionId;
  switch (screen) {
    case 'market':
      ui.show('market', { world, factionId });
      ctx.bus.emit('ui:hint', { key: 'world.market_opened' });
      break;
    case 'age_panel':
      ui.show('age_panel', { world, factionId });
      break;
    case 'economy_panel':
      ui.show('economy_panel', { world, factionId });
      break;
    case 'diplomacy':
      ui.show('diplomacy', { world });
      ctx.bus.emit('ui:hint', { key: 'world.diplomacy_opened' });
      break;
    case 'council':
      ui.show('council', { world, recommendations: world.factions[factionId]?.councilAdvice ?? [] });
      break;
    case 'chronicle':
      ui.show('chronicle', { world });
      break;
    default:
      break;
  }
}

/** Execute a card slot. `world` is needed for screens; `shift` repeats placement / queues orders. */
export function runCardSlot(ctx: AppContext, ui: UIManager, slot: CardSlot, shift: boolean, world: Readonly<WorldState> | null): void {
  const c = slot.command;
  switch (c.kind) {
    case 'input':
      ctx.input.injectAction(c.action, { shift });
      ctx.bus.emit('audio:sfx', { sfx: 'order_ack' });
      break;
    case 'strategic':
      ctx.actions.issueStrategic(c.cmd);
      ctx.bus.emit('audio:sfx', { sfx: c.cmd.kind === 'build' || c.cmd.kind === 'recruit' ? 'ui_confirm' : 'order_ack' });
      break;
    case 'battle':
      ctx.actions.issueBattle(c.cmd);
      ctx.bus.emit('audio:sfx', { sfx: 'order_ack' });
      break;
    case 'hud':
      if (c.cmd.kind === 'place_building') {
        emitHud(ui.commands, { ...c.cmd, repeat: shift });
        ctx.bus.emit('ui:hint', { key: 'world.build_mode' });
      } else emitHud(ui.commands, c.cmd);
      ctx.bus.emit('audio:sfx', { sfx: 'ui_click' });
      break;
    case 'screen':
      if (world) openWorldScreen(ctx, ui, c.screen, world);
      break;
    case 'visit':
      ctx.bus.emit('audio:sfx', { sfx: 'ui_confirm' });
      void ctx.actions.visitSettlement(c.settlementId);
      break;
    case 'none':
      break;
  }
}

export interface GroupSlotView {
  group: number;
  label: string;
  count: number;
}

/**
 * Control-group row (DESIGN_SPEC §8.8 touch: 5 slots above the card; long-press assigns, tap selects, double-tap
 * centres). PC shows only assigned groups. Actions go through the input manager so scenes see one path.
 */
export function controlGroupRow(ctx: AppContext): { el: HTMLElement; set(groups: readonly GroupSlotView[], touch: boolean): void } {
  const el = h('div', { class: 'group-row', role: 'toolbar', 'aria-label': 'Control groups', dataset: { anchor: 'control-groups' } });
  const lastTap = new Map<number, number>();
  const make = (g: GroupSlotView): HTMLElement => {
    const num = h('b', { class: 'group-num' }, String(g.group));
    const lbl = h('span', { class: 'group-label' });
    // Compact layouts (the landscape battle column, 52 px) print "×N" formations instead of the label (no ellipsis).
    const cnt = h('span', { class: 'group-count', 'aria-hidden': 'true' });
    const btn = h('button', { class: 'btn group-slot', type: 'button' }, num, lbl, cnt);
    btn.addEventListener('click', (e) => {
      const now = performance.now();
      const prev = lastTap.get(g.group) ?? 0;
      lastTap.set(g.group, now);
      ctx.input.injectAction('group_select', { group: g.group, shift: e.shiftKey });
      if (now - prev < 350) ctx.input.injectAction('camera_focus', { group: g.group });
      ctx.bus.emit('audio:sfx', { sfx: 'ui_click' });
    });
    onLongPress(btn, 520, () => {
      ctx.input.injectAction('group_assign', { group: g.group });
      ctx.bus.emit('audio:sfx', { sfx: 'ui_confirm' });
      ctx.bus.emit('ui:hint', { key: 'world.control_groups' });
    });
    return btn;
  };
  return {
    el,
    set(groups, touch) {
      const rows: GroupSlotView[] = [];
      if (touch) {
        for (let i = 1; i <= 5; i++) rows.push(groups.find((g) => g.group === i) ?? { group: i, label: '', count: 0 });
      } else rows.push(...groups.filter((g) => g.count > 0));
      syncList(
        el,
        rows,
        (g) => String(g.group),
        make,
        (node, g) => {
          setText(node.querySelector('.group-label')!, g.count > 0 ? (g.label || String(g.count)) : 'Hold to set');
          setText(node.querySelector('.group-count')!, g.count > 0 ? `\u00d7${g.count}` : '');
          setClass(node, 'empty', g.count === 0);
          node.setAttribute('aria-label', g.count > 0 ? `Group ${g.group}: ${g.label || g.count}` : `Group ${g.group}: empty, long-press to assign`);
        },
      );
      setClass(el, 'ui-hidden', rows.length === 0);
    },
  };
}
