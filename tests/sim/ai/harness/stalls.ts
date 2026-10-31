/**
 * Stall audit for the campaign AI (Creative Director CD-B1 d): while its realm is at war, no AI field army keeps the
 * same operation (plan memory `op_<armyId>`, e.g. `resupply`, `hunt:<army>`, `defend:...`, `home:<town>`) for more than
 * 45 days. Not stalls: a siege camp (it runs as long as the walls hold, DESIGN_SPEC §7.8) and standing at home while
 * the strategy planner found no target it could take (memory `noTarget`; such a quiet war ends in a status-quo peace).
 * OWNER: AI Engineer - Battle AI, Intents & Campaign AI (SIM-02).
 */
import type { WorldState } from '../../../../src/core/types';
import { isFieldArmy } from '../../../../src/sim/strategic/ai/core';
import { atWarWith } from '../../../../src/sim/strategic/state';
import { totalDays } from '../../../../src/sim/strategic/seasons';

export interface Stall {
  armyId: string;
  factionId: string;
  op: string;
  from: number;
  days: number;
}

/** Track, day by day, each AI field army's op spell while its realm is at war; `worst()` gives the longest per army. */
export function stallWatch(): { day: (w: WorldState) => void; worst: () => Stall[]; report: () => string[] } {
  const cur = new Map<string, Stall>();
  const best = new Map<string, Stall>();
  return {
    day(w: WorldState): void {
      const today = totalDays(w.calendar);
      const seen = new Set<string>();
      for (const id of Object.keys(w.armies).sort()) {
        const a = w.armies[id]!;
        const f = w.factions[a.factionId];
        if (!f || f.isPlayer || !f.alive || !isFieldArmy(a)) continue;
        const atWar = Object.keys(w.factions).some((o) => o !== f.id && w.factions[o]!.alive && atWarWith(w, f.id, o));
        // Siege camps run as long as the walls hold (DESIGN_SPEC §7.8 pacing): a siege is not a stall.
        const op = String(f.ai.memory[`op_${id}`] ?? (a.status === 'besieging' ? 'siege' : 'none'));
        // Standing at home (or behind walls) is no stall while the strategy planner finds no target it can take (memory
        // `noTarget`, at most 6 days old): the war is then quiet and ends in a status-quo peace (diplomacy.ts).
        const nt = f.ai.memory.noTarget;
        const excused = (op.startsWith('home') || op.startsWith('hold') || op === 'none') && typeof nt === 'number' && today - nt <= 6;
        if (!atWar || excused || op.startsWith('siege') || op.startsWith('assault') || a.status === 'besieging') {
          cur.delete(id);
          continue;
        }
        seen.add(id);
        let s = cur.get(id);
        if (!s || s.op !== op) {
          s = { armyId: id, factionId: a.factionId, op, from: today, days: 0 };
          cur.set(id, s);
        }
        s.days = today - s.from;
        const b = best.get(id);
        if (!b || s.days > b.days) best.set(id, { ...s });
      }
      for (const id of [...cur.keys()]) if (!seen.has(id)) cur.delete(id);
    },
    worst(): Stall[] {
      return [...best.values()].sort((x, y) => y.days - x.days || (x.armyId < y.armyId ? -1 : 1));
    },
    report(): string[] {
      return this.worst()
        .slice(0, 6)
        .map((s) => `${s.armyId} (${s.factionId}) '${s.op}' ${s.days} d from d${s.from}`);
    },
  };
}
