/**
 * Phone simple-mode formation presets (DESIGN_SPEC §12.3): one tap turns into concrete BattleCommands for the
 * player's formations - "Line up", "Archers behind", "Horse to the wings". Pure (no DOM): the battle HUD issues the
 * result through GameActions.issueBattle, tests check the geometry. OWNER: UI Engineer - In-game HUD, Command Card,
 * Minimap & Input (UI-02).
 *
 * Geometry: the front faces from the player's centroid toward the enemy centroid (facing convention:
 * forward = (sin f, cos f)); the lateral axis is (cos f, -sin f). Formations are placed abreast with 6 m gaps.
 */
import type { BattleCommand, BattleState, FormationState, SideIndex } from '../../core/types';
import { isMounted } from '../../sim/tactical/stats';

export type BattlePreset = 'line_up' | 'archers_behind' | 'horse_wings';

export const BATTLE_PRESETS: readonly { id: BattlePreset; label: string; icon: string; desc: string }[] = [
  { id: 'line_up', label: 'Line up', icon: 's_line', desc: 'Every formation in one line facing the enemy.' },
  { id: 'archers_behind', label: 'Archers behind', icon: 'unit-archers', desc: 'Bowmen 25 m behind the foot.' },
  { id: 'horse_wings', label: 'Horse to the wings', icon: 'unit-cavalry', desc: 'Horse and chariots out on both flanks.' },
];

const GAP = 6;

function usable(f: FormationState, side: SideIndex, time: number): boolean {
  return f.side === side && f.soldiers > 0 && f.activity !== 'routing' && f.activity !== 'surrendered' && f.activity !== 'destroyed' && f.rallyingUntil <= time;
}

function isRanged(f: FormationState): boolean {
  return f.unitClass === 'archers';
}

function isHorse(f: FormationState): boolean {
  return isMounted(f.unitClass) || f.unitClass === 'scouts';
}

interface Frame {
  cx: number;
  cz: number;
  facing: number;
  fx: number;
  fz: number;
  rx: number;
  rz: number;
}

/** Player front frame: centroid and facing toward the enemy (or the current mean facing when no enemy is known). */
export function battleFrame(battle: Readonly<BattleState>, side: SideIndex): Frame | null {
  const own = battle.formations.filter((f) => usable(f, side, battle.time));
  if (!own.length) return null;
  let cx = 0;
  let cz = 0;
  for (const f of own) ((cx += f.x), (cz += f.z));
  cx /= own.length;
  cz /= own.length;
  const enemy = battle.formations.filter((f) => f.side !== side && f.soldiers > 0 && f.activity !== 'destroyed' && f.activity !== 'surrendered');
  let facing: number;
  if (enemy.length) {
    let ex = 0;
    let ez = 0;
    for (const f of enemy) ((ex += f.x), (ez += f.z));
    facing = Math.atan2(ex / enemy.length - cx, ez / enemy.length - cz);
  } else {
    let sx = 0;
    let sz = 0;
    for (const f of own) ((sx += Math.sin(f.facing)), (sz += Math.cos(f.facing)));
    facing = Math.atan2(sx, sz);
  }
  const fx = Math.sin(facing);
  const fz = Math.cos(facing);
  return { cx, cz, facing, fx, fz, rx: fz, rz: -fx };
}

/** Lateral coordinate of a formation in the frame (for stable left-to-right ordering). */
function lateral(fr: Frame, f: FormationState): number {
  return (f.x - fr.cx) * fr.rx + (f.z - fr.cz) * fr.rz;
}

function placeRow(fr: Frame, row: FormationState[], forward: number, centerLat: number, out: BattleCommand[], shape: 'line' | null): void {
  if (!row.length) return;
  const sorted = row.slice().sort((a, b) => lateral(fr, a) - lateral(fr, b) || a.index - b.index);
  const widths = sorted.map((f) => Math.max(8, f.width));
  const total = widths.reduce((a, b) => a + b, 0) + GAP * (sorted.length - 1);
  let off = centerLat - total / 2;
  sorted.forEach((f, i) => {
    const w = widths[i]!;
    const lat = off + w / 2;
    off += w + GAP;
    if (shape && f.shape !== shape) out.push({ kind: 'set_shape', formations: [f.index], shape });
    out.push({ kind: 'order', formations: [f.index], order: { type: 'move_to', x: fr.cx + fr.fx * forward + fr.rx * lat, z: fr.cz + fr.fz * forward + fr.rz * lat, facing: fr.facing, run: false }, queue: false });
  });
}

/** Commands for a preset (empty when no formation can take it). */
export function presetCommands(battle: Readonly<BattleState>, side: SideIndex, preset: BattlePreset): BattleCommand[] {
  const fr = battleFrame(battle, side);
  if (!fr) return [];
  const own = battle.formations.filter((f) => usable(f, side, battle.time) && f.unitClass !== 'supply_train');
  const out: BattleCommand[] = [];
  switch (preset) {
    case 'line_up':
      placeRow(fr, own, 0, 0, out, 'line');
      break;
    case 'archers_behind': {
      const melee = own.filter((f) => !isRanged(f) && !isHorse(f));
      const ranged = own.filter(isRanged);
      if (!ranged.length) return [];
      placeRow(fr, ranged, melee.length ? -25 : -10, 0, out, null);
      break;
    }
    case 'horse_wings': {
      const horse = own.filter(isHorse);
      if (!horse.length) return [];
      const foot = own.filter((f) => !isHorse(f));
      let half = 40;
      for (const f of foot) half += (Math.max(8, f.width) + GAP) / 2;
      const left = horse.filter((_, i) => i % 2 === 0);
      const right = horse.filter((_, i) => i % 2 === 1);
      placeRow(fr, left, -10, -half, out, null);
      placeRow(fr, right, -10, half, out, null);
      break;
    }
  }
  return out;
}
