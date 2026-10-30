/**
 * Battle HUD labels and control groups (src/ui/services/battleLabels.ts): formation card titles are short and unique
 * ("Levy I", "Levy II", "Guards"), roman numerals, the control-group row derived from BattleState.sides[].groups,
 * and the shared control-group row component (5 slots on touch, assigned groups on PC; tap selects, double-tap
 * centres, long-press assigns - all through ctx.input.injectAction).
 * OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installDom, ShimElement, ShimEvent } from './domShim';
import { battleGroupsFrom, classCode, formationTitles, roman } from '../../../src/ui/services/battleLabels';
import { testBattle } from '../../sim/tactical/helpers';

let dom: ReturnType<typeof installDom>;
beforeAll(() => {
  dom = installDom();
});
afterAll(() => dom.uninstall());

const tb = testBattle({
  factions: ['heartland', 'highland'],
  sides: [
    [
      { cls: 'spearmen', x: -40, z: 100 },
      { cls: 'spearmen', x: 0, z: 100 },
      { cls: 'elite_guards', x: 40, z: 100 },
      { cls: 'cavalry', x: 120, z: 100 },
      { cls: 'supply_train', x: 0, z: 160 },
    ],
    [{ cls: 'spearmen', x: 0, z: -100 }],
  ],
});
const b = tb.state;

describe('formation titles', () => {
  it('class word + roman index only when a class repeats; titles are unique and short', () => {
    expect(roman(1)).toBe('I');
    expect(roman(4)).toBe('IV');
    expect(roman(9)).toBe('IX');
    expect(roman(14)).toBe('XIV');
    const t = formationTitles(b, 0);
    const own = b.formations.filter((f) => f.side === 0);
    expect(own.map((f) => t.get(f.index))).toEqual(['Levy I', 'Levy II', 'Guards', 'Horse', 'Supply']);
    expect(new Set(t.values()).size).toBe(t.size);
    for (const v of t.values()) expect(v.length).toBeLessThanOrEqual(12);
    expect(formationTitles(b, 1).get(b.formations.find((f) => f.side === 1)!.index)).toBe('Levy');
    expect(classCode('war_elephants')).toBe('ELE');
    expect(classCode('elite_guards')).toBe('GRD');
  });
});

describe('battle control groups', () => {
  it('only groups with living formations, in key order 1..9, 0; label = title or count', () => {
    const own = b.formations.filter((f) => f.side === 0).map((f) => f.index);
    const groups = b.sides[0].groups.map(() => [] as number[]);
    groups[2] = [own[0]!, own[1]!];
    groups[1] = [own[2]!];
    groups[0] = [own[4]!];
    groups[5] = [];
    const bb = { ...b, sides: [{ ...b.sides[0], groups }, b.sides[1]] } as typeof b;
    expect(battleGroupsFrom(bb, 0)).toEqual([
      { group: 1, label: 'Guards', count: 1 },
      { group: 2, label: '2 formations', count: 2 },
      { group: 0, label: 'Supply', count: 1 },
    ]);
    // A destroyed member drops out.
    const dead = { ...bb, formations: bb.formations.map((f) => (f.index === own[2] ? { ...f, soldiers: 0 } : f)) } as typeof b;
    expect(battleGroupsFrom(dead, 0).map((g) => g.group)).toEqual([2, 0]);
  });

  it('row: 5 slots on touch (empty ones say how to assign), assigned only on PC; tap / double-tap / long-press', async () => {
    const { controlGroupRow } = await import('../../../src/ui/screens/world/cardActions');
    const actions: [string, unknown][] = [];
    const ctx = { input: { injectAction: (a: string, x: unknown) => actions.push([a, x]) }, bus: { emit: () => {} } };
    const row = controlGroupRow(ctx as never);
    const el = row.el as unknown as ShimElement;
    row.set([{ group: 2, label: 'Levy I', count: 1 }], true);
    const slots = el.querySelectorAll('.group-slot');
    expect(slots).toHaveLength(5);
    expect(slots.map((s) => s.querySelector('.group-num')!.textContent)).toEqual(['1', '2', '3', '4', '5']);
    expect(slots[0]!.classList.contains('empty')).toBe(true);
    expect(slots[0]!.getAttribute('aria-label')).toContain('long-press to assign');
    expect(slots[1]!.querySelector('.group-label')!.textContent).toBe('Levy I');
    slots[1]!.click();
    slots[1]!.click();
    expect(actions.map((a) => a[0])).toEqual(['group_select', 'group_select', 'camera_focus']);
    expect(actions[2]![1]).toEqual({ group: 2 });
    // Long press assigns (pointerdown held past the threshold).
    actions.length = 0;
    slots[3]!.dispatchEvent(Object.assign(new ShimEvent('pointerdown', { bubbles: true }), { pointerId: 1, clientX: 0, clientY: 0, button: 0 }));
    await new Promise((r) => setTimeout(r, 600));
    expect(actions.map((a) => a[0])).toContain('group_assign');
    expect(actions.find((a) => a[0] === 'group_assign')![1]).toEqual({ group: 4 });
    // PC: only assigned groups; none = hidden row.
    row.set([{ group: 7, label: '3 formations', count: 3 }], false);
    expect(el.querySelectorAll('.group-slot').map((s) => s.querySelector('.group-num')!.textContent)).toEqual(['7']);
    row.set([], false);
    expect(el.classList.contains('ui-hidden')).toBe(true);
  });
});
