/**
 * Battle AI + intent translation. OWNER: Lead AI & Simulation Engineer. Baseline by the CTO.
 *
 * Runs inside stepBattle (deterministic) every AI_THINK_TICKS for AI-controlled sides and translates
 * player intent orders (GDD §5: "hold a crossing", "protect archers") into FormationOrders.
 * Required (owner): utility AI per formation (threat, opportunity, terrain value), keep lines intact,
 * protect archers/commander, flank with cavalry, use elephants as shock, retreat/regroup broken
 * formations, difficulty + personality scaling, avoid full decision trees per soldier (GDD §9).
 */
import type { BattleCommand, BattleState, FormationIndex, FormationOrder, FormationState, IntentOrder, SideIndex, TerrainQuery } from '../../core/types';
import { UNITS } from '../../data/units';
import { dcos, dsin } from '../../core/math';

function nearestEnemy(state: BattleState, f: FormationState, filter?: (o: FormationState) => boolean): FormationState | null {
  let best: FormationState | null = null;
  let bd = Infinity;
  for (const o of state.formations) {
    if (o.side === f.side || o.soldiers <= 0 || o.activity === 'routing' || o.activity === 'surrendered') continue;
    if (filter && !filter(o)) continue;
    const dx = o.x - f.x;
    const dz = o.z - f.z;
    const d = dx * dx + dz * dz;
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

/** Commands for an AI side this think. Baseline: archers skirmish, mounted flank/charge, rest attack. */
export function runBattleAI(state: BattleState, side: SideIndex, terrain: TerrainQuery): BattleCommand[] {
  void terrain;
  const cmds: BattleCommand[] = [];
  for (const f of state.formations) {
    if (f.side !== side || f.soldiers <= 0 || f.activity === 'routing' || f.activity === 'surrendered') continue;
    if (f.engagedWith.length > 0) continue;
    const o = f.order;
    const busy = o.type !== 'hold' && !(o.type === 'attack_target' && (state.formations[o.target]?.soldiers ?? 0) <= 0);
    if (busy && state.tick % (20 * 8) !== 0) continue;
    const def = UNITS[f.unitClass];
    if (f.unitClass === 'supply_train' || f.unitClass === 'engineers') continue;
    if (def.stats.rangedAttack > 0 && def.category === 'ranged') {
      const t = nearestEnemy(state, f);
      if (t) cmds.push({ kind: 'order', formations: [f.index], order: { type: 'skirmish', target: t.index }, queue: false });
      continue;
    }
    if (def.category === 'mounted' || def.category === 'beast') {
      const soft = nearestEnemy(state, f, (e) => e.unitClass === 'archers' || e.unitClass === 'engineers' || e.unitClass === 'supply_train');
      const t = soft ?? nearestEnemy(state, f);
      if (t) cmds.push({ kind: 'order', formations: [f.index], order: soft && def.category === 'mounted' ? { type: 'flank', target: t.index, side: f.index % 2 === 0 ? 'left' : 'right' } : { type: 'charge', target: t.index }, queue: false });
      continue;
    }
    const t = nearestEnemy(state, f);
    if (t) cmds.push({ kind: 'order', formations: [f.index], order: { type: 'attack_target', target: t.index, run: false }, queue: false });
  }
  return cmds;
}

/** Translate an intent into a concrete order for one formation (null = keep current order). */
export function translateIntent(state: BattleState, index: FormationIndex, intent: IntentOrder, terrain: TerrainQuery): FormationOrder | null {
  const f = state.formations[index];
  if (!f) return null;
  void terrain;
  switch (intent.type) {
    case 'hold_crossing':
    case 'hold_high_ground':
      return { type: 'defend', x: intent.x, z: intent.z, radius: intent.radius };
    case 'protect_formation': {
      const p = state.formations[intent.target];
      if (!p || p.soldiers <= 0) return { type: 'hold' };
      const threat = nearestEnemy(state, p);
      if (threat) {
        const dx = threat.x - p.x;
        const dz = threat.z - p.z;
        if (dx * dx + dz * dz < 160 * 160) return { type: 'attack_target', target: threat.index, run: true };
      }
      // Stand between the protected formation and the nearest enemy.
      const e = nearestEnemy(state, p);
      const ex = e ? e.x - p.x : 0;
      const ez = e ? e.z - p.z : 1;
      const d = Math.sqrt(ex * ex + ez * ez) || 1;
      return { type: 'move_to', x: p.x + (ex / d) * 30, z: p.z + (ez / d) * 30, facing: null, run: false };
    }
    case 'pin_enemy':
      return { type: 'attack_target', target: intent.target, run: false };
    case 'screen_flank': {
      const p = state.formations[intent.protect];
      if (!p) return null;
      // right = (-cos f, sin f); left flank = -right.
      const s = intent.side === 'left' ? -1 : 1;
      const off = p.width / 2 + f.width / 2 + 20;
      return { type: 'move_to', x: p.x - dcos(p.facing) * s * off, z: p.z + dsin(p.facing) * s * off, facing: p.facing, run: false };
    }
    case 'pursue_routers': {
      let best: FormationState | null = null;
      for (const o of state.formations) if (o.side !== f.side && o.activity === 'routing' && o.soldiers > 0) best = best && best.soldiers > o.soldiers ? best : o;
      return best ? { type: 'attack_target', target: best.index, run: true } : { type: 'hold' };
    }
    case 'scout_area':
      return { type: 'move_to', x: intent.x, z: intent.z, facing: null, run: true };
    case 'escort_supply': {
      const p = state.formations[intent.target];
      return p ? { type: 'move_to', x: p.x, z: p.z + 15, facing: p.facing, run: false } : null;
    }
    default:
      return null;
  }
}
