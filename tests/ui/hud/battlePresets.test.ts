/**
 * Simple-mode battle presets (src/ui/services/battlePresets.ts): one-tap deployments become ordinary battle commands
 * (move_to + set_shape) relative to the enemy - a single facing line, archers behind the foot, horse on the wings.
 * OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 */
import { describe, expect, it } from 'vitest';
import type { BattleCommand } from '../../../src/core/types';
import { battleFrame, presetCommands } from '../../../src/ui/services/battlePresets';
import { testBattle } from '../../sim/tactical/helpers';

const tb = testBattle({
  factions: ['heartland', 'highland'],
  sides: [
    [
      { cls: 'spearmen', x: -80, z: 150 },
      { cls: 'spearmen', x: 20, z: 170 },
      { cls: 'archers', x: 90, z: 140 },
      { cls: 'cavalry', x: -10, z: 220 },
      { cls: 'supply_train', x: 0, z: 260 },
    ],
    [{ cls: 'spearmen', x: 0, z: -150 }],
  ],
});
const b = tb.state;
const fr = battleFrame(b, 0)!;

type MoveTo = { formations: number[]; order: { type: 'move_to'; x: number; z: number; facing: number } };
const moves = (cmds: BattleCommand[]): MoveTo[] => cmds.filter((c) => c.kind === 'order' && c.order.type === 'move_to') as unknown as MoveTo[];
const fwd = (m: MoveTo): number => (m.order.x - fr.cx) * fr.fx + (m.order.z - fr.cz) * fr.fz;
const lat = (m: MoveTo): number => (m.order.x - fr.cx) * fr.rx + (m.order.z - fr.cz) * fr.rz;
const cls = (m: MoveTo): string => b.formations[m.formations[0]!]!.unitClass;

describe('battle presets', () => {
  it('the frame faces the enemy (north here: facing PI)', () => {
    expect(Math.abs(Math.abs(fr.facing) - Math.PI)).toBeLessThan(0.3);
  });

  it('line up: every fighting formation in one row facing the enemy, in line shape, no overlaps', () => {
    const cmds = presetCommands(b, 0, 'line_up');
    const m = moves(cmds);
    expect(m.map(cls).sort()).toEqual(['archers', 'cavalry', 'spearmen', 'spearmen']);
    for (const x of m) {
      expect(Math.abs(fwd(x))).toBeLessThan(1e-6);
      expect(x.order.facing).toBeCloseTo(fr.facing);
    }
    const lats = m.map(lat).sort((p, q) => p - q);
    for (let i = 1; i < lats.length; i++) expect(lats[i]! - lats[i - 1]!).toBeGreaterThanOrEqual(8);
    expect(cmds.some((c) => c.kind === 'set_shape')).toBe(true);
  });

  it('archers behind: only the bowmen move, to 25 m behind the line centre (behind every foot formation)', () => {
    const m = moves(presetCommands(b, 0, 'archers_behind'));
    expect(m.map(cls)).toEqual(['archers']);
    const footFwd = b.formations.filter((f) => f.side === 0 && f.unitClass === 'spearmen').map((f) => (f.x - fr.cx) * fr.fx + (f.z - fr.cz) * fr.fz);
    expect(fwd(m[0]!)).toBeCloseTo(-25);
    for (const f of footFwd) expect(fwd(m[0]!)).toBeLessThan(f - 10);
  });

  it('horse to the wings: horse outside the foot line', () => {
    const m = moves(presetCommands(b, 0, 'horse_wings'));
    const horse = m.filter((x) => cls(x) === 'cavalry');
    const foot = m.filter((x) => cls(x) !== 'cavalry');
    expect(horse.length).toBe(1);
    const footMax = Math.max(...foot.map((x) => Math.abs(lat(x))));
    for (const h of horse) expect(Math.abs(lat(h))).toBeGreaterThan(footMax);
  });

  it('nothing to command: no commands', () => {
    expect(presetCommands(b, 1, 'archers_behind').filter((c) => c.kind === 'order')).toHaveLength(0);
  });
});
