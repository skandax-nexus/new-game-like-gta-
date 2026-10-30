/**
 * Short battle labels that fit the HUD without ellipses (ART_BIBLE §11.3, Art Director review UI-02 round 1):
 * formation titles as class word + roman index ("Levy I", "Levy II", "Guards"), the caps class codes of compact
 * slots (SPR ARC GRD ...), and the battle control-group row derived from BattleState.sides[side].groups.
 * Pure functions (no DOM). OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 */
import type { BattleState, FormationIndex, SideIndex, UnitClass } from '../../core/types';
import { UNITS } from '../../data/units';
import type { BattleControlGroup } from './hudCommands';

/** One-word class names for formation cards (the full formation name stays in the tooltip / long-press). */
export const CLASS_WORD: Readonly<Record<UnitClass, string>> = {
  spearmen: 'Levy',
  archers: 'Archers',
  elite_guards: 'Guards',
  cavalry: 'Horse',
  chariots: 'Chariots',
  war_elephants: 'Elephants',
  engineers: 'Engineers',
  scouts: 'Scouts',
  supply_train: 'Supply',
};

/** Caps class code of compact slots and chips (UnitDef.shortName: SPR ARC GRD CAV CHR ELE ENG SCT SUP). */
export function classCode(cls: UnitClass): string {
  return UNITS[cls]?.shortName ?? cls.slice(0, 3).toUpperCase();
}

const ROMAN: readonly [number, string][] = [
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

/** 1 -> I, 4 -> IV, 12 -> XII (formations per class stay well below 40). */
export function roman(n: number): string {
  let v = Math.max(1, Math.floor(n));
  let out = '';
  for (const [k, s] of ROMAN) {
    while (v >= k) {
      out += s;
      v -= k;
    }
  }
  return out;
}

/**
 * Card titles of one side's formations: the class word, plus a roman index when the side fields more than one
 * formation of that class (in formation-index order, destroyed ones keep their number so titles never shift).
 */
export function formationTitles(b: Readonly<BattleState>, side: SideIndex): Map<FormationIndex, string> {
  const perClass = new Map<UnitClass, FormationIndex[]>();
  for (const f of b.formations) {
    if (f.side !== side) continue;
    const list = perClass.get(f.unitClass) ?? [];
    list.push(f.index);
    perClass.set(f.unitClass, list);
  }
  const out = new Map<FormationIndex, string>();
  for (const [cls, list] of perClass) {
    const word = CLASS_WORD[cls] ?? UNITS[cls]?.name ?? cls;
    list.forEach((idx, i) => out.set(idx, list.length > 1 ? `${word} ${roman(i + 1)}` : word));
  }
  return out;
}

/** Group numbers in the order the row shows them (keys 1..9 then 0). */
export const GROUP_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

/**
 * Control groups of a side as the HUD row shows them: only groups with a living formation; label = the formation
 * title for one formation, else "N formations"; count = living formations.
 */
export function battleGroupsFrom(b: Readonly<BattleState>, side: SideIndex, titles?: ReadonlyMap<FormationIndex, string>): BattleControlGroup[] {
  const groups = b.sides[side]?.groups ?? [];
  const names = titles ?? formationTitles(b, side);
  const out: BattleControlGroup[] = [];
  for (const g of GROUP_ORDER) {
    const members = groups[g] ?? [];
    let alive = 0;
    let first: FormationIndex = -1;
    for (const i of members) {
      const f = b.formations[i];
      if (!f || f.side !== side || f.soldiers <= 0 || f.activity === 'destroyed') continue;
      if (first < 0) first = i;
      alive++;
    }
    if (alive === 0) continue;
    out.push({ group: g, label: alive === 1 ? names.get(first) ?? 'Formation' : `${alive} formations`, count: alive });
  }
  return out;
}
