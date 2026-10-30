/**
 * Settlement panel queues on the DOM shim (./domShim.ts): construction and recruitment rows both carry a cancel
 * button (ticket UI-02 item 2). Recruitment cancel is feature-detected (src/ui/services/recruitCancel.ts): while the
 * simulation has no cancel_recruitment command the button is shown disabled with its reason and does not issue
 * anything; once the validator knows the command, the button issues it with the row's queue index.
 * OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installDom, ShimElement } from './domShim';
import type { StrategicCommand, WorldState } from '../../../src/core/types';
import { campaign } from '../../sim/strategic/helpers';
import { cancelRecruitmentCommand, RECRUIT_CANCEL_HINT, RECRUIT_CANCEL_UNAVAILABLE, recruitCancelState, recruitCancelSupported } from '../../../src/ui/services/recruitCancel';
import { commandReason } from '../../../src/sim/strategic/selectors';

let dom: ReturnType<typeof installDom>;
beforeAll(() => {
  dom = installDom();
});
afterAll(() => dom.uninstall());

function worldWithQueues(): WorldState {
  const w = campaign(7);
  const sid = w.factions[w.playerFactionId]!.capitalSettlementId!;
  const s = w.settlements[sid]!;
  s.recruitment.push({ unitClass: 'archers', formations: 2, progress: 0.4, startedDay: 3, targetArmyId: null });
  s.recruitment.push({ unitClass: 'cavalry', formations: 1, progress: 0, startedDay: 4, targetArmyId: null });
  return w;
}

/** A validator that knows cancel_recruitment (what SIM-01 will ship), delegating everything else to the real sim. */
function futureValidator(w: WorldState): (c: StrategicCommand) => string | null {
  return (c) => {
    const k = (c as { kind: string }).kind;
    if (k === 'cancel_recruitment') {
      const cc = c as unknown as { settlementId: string; index: number };
      const s = w.settlements[cc.settlementId];
      if (!s) return 'No such settlement';
      return cc.index >= 0 && cc.index < s.recruitment.length ? null : 'No such recruitment';
    }
    return commandReason(w, w.playerFactionId, c);
  };
}

describe('recruitment cancel feature detection', () => {
  it('today the simulation does not know cancel_recruitment: disabled with the reason', () => {
    const w = worldWithQueues();
    const v = (c: StrategicCommand): string | null => commandReason(w, w.playerFactionId, c);
    expect(recruitCancelSupported(v, true)).toBe(false);
    const st = recruitCancelState(v, w.factions[w.playerFactionId]!.capitalSettlementId!, 0, true);
    expect(st).toEqual({ visible: true, enabled: false, reason: RECRUIT_CANCEL_UNAVAILABLE });
    // Foreign settlements never show it.
    expect(recruitCancelState(v, 'x', 0, false).visible).toBe(false);
    // A known command kind is detected (construction cancel answers the probe with a reason).
    expect(commandReason(w, w.playerFactionId, { kind: 'cancel_construction', settlementId: '\u0000ui-probe', building: 'granary' })).not.toBeNull();
  });

  it('once the validator knows the command it is enabled per row with the refund hint', () => {
    const w = worldWithQueues();
    const v = futureValidator(w);
    expect(recruitCancelSupported(v, true)).toBe(true);
    const sid = w.factions[w.playerFactionId]!.capitalSettlementId!;
    expect(recruitCancelState(v, sid, 1, true)).toEqual({ visible: true, enabled: true, reason: RECRUIT_CANCEL_HINT });
    expect(recruitCancelState(v, sid, 5, true)).toEqual({ visible: true, enabled: false, reason: 'No such recruitment' });
    expect(cancelRecruitmentCommand(sid, 1)).toEqual({ kind: 'cancel_recruitment', settlementId: sid, index: 1 });
    recruitCancelSupported(v, true);
    // Reset the memo for the panel test below (real sim again).
    recruitCancelSupported((c) => commandReason(w, w.playerFactionId, c), true);
  });

  it('an inconclusive probe (faction-level refusal) is not memoized', () => {
    expect(recruitCancelSupported(() => 'Unknown or defeated faction', true)).toBe(false);
    expect(recruitCancelSupported(futureValidator(worldWithQueues()))).toBe(true);
    recruitCancelSupported(() => null, true);
  });
});

describe('settlement panel queues', () => {
  it('construction and recruitment rows carry a cancel button; recruitment explains why it is disabled', async () => {
    const { settlementPanel } = await import('../../../src/ui/screens/world/settlementPanel');
    const w = worldWithQueues();
    const sid = w.factions[w.playerFactionId]!.capitalSettlementId!;
    w.settlements[sid]!.construction.push({ type: 'granary', targetLevel: 2, progress: 0.3, startedDay: 1, laborAssigned: 10, paid: { wealth: 100, timber: 10, stone: 0, labor: 0 }, crew: 10 });
    recruitCancelSupported((c) => commandReason(w, w.playerFactionId, c), true);
    const issued: StrategicCommand[] = [];
    const opened: unknown[] = [];
    const ctx = { actions: { issueStrategic: (c: StrategicCommand) => issued.push(c) }, bus: { emit: () => {} } };
    const ui = { tooltips: { attach: () => () => {}, open: (_e: unknown, c: unknown) => opened.push(c), hide: () => {} }, hide: () => {} };
    const scr = settlementPanel(ctx as never, ui as never);
    scr.update({ world: w, settlementId: sid } as never);
    const el = scr.el as unknown as ShimElement;
    const lists = el.querySelectorAll('.queue-list');
    expect(lists).toHaveLength(2);
    const [construction, recruitment] = lists;
    expect(construction!.querySelectorAll('.queue-row')).toHaveLength(1);
    expect(construction!.querySelector('.q-cancel')).not.toBeNull();
    const rows = recruitment!.querySelectorAll('.queue-row');
    expect(rows).toHaveLength(2);
    expect(rows[1]!.querySelector('.q-days')!.textContent).toContain('queued');
    const cancel = rows[0]!.querySelector('.q-cancel')!;
    expect(cancel.classList.contains('disabled')).toBe(true);
    expect(cancel.getAttribute('aria-label')).toContain(RECRUIT_CANCEL_UNAVAILABLE);
    cancel.click();
    expect(issued).toEqual([]);
    expect(opened).toHaveLength(1);
  });
});
