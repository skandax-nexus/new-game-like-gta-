/**
 * Victory conditions and the BattleOutcome (DESIGN_SPEC §6.8, §6.11, §6.12). OWNER: Gameplay Engineer - Tactical
 * Battle Simulation (GP-01). The strategic write-back (casualties, morale, retreat, prisoners decision, war score,
 * chronicle, capture) is SIM-01's `applyBattleOutcome`; this module fills every outcome field it reads.
 *
 * Ends when: a side is broken (all combat formations routing / destroyed / surrendered; both = draw - archers out of
 * arrows and not in melee count as non-combat like engineers and carts, CD amendment to §6.8); a side has
 * withdrawn (withdraw_all) and disengaged; siege conditions (breach held 60 s -> siege_breach; attackers broken or
 * time limit -> siege_held); a scripted objective completes / fails; the time limit (stronger side, draw within 10%).
 * Pursuit when a side breaks: routing soldiers still on the field x (0.15 + 0.1 x winnerMountedShare) x
 * (1 - 0.5 x loserMountedShare), 70% killed / 30% captured. Commander fate: killed 50% / wounded 30% / captured 20%
 * (always captured if the formation surrendered). Experience +0.1 won / +0.05 lost, +0.05 per enemy formation routed.
 * War score (side 0 view) = 20 x (side-1 losses - side-0 losses) / both starts, +-20.
 */
import type { BattleOutcome, BattleSideResult, BattleState, FormationResult, SideIndex } from '../../core/types';
import { Rng } from '../../core/rng';
import { FACTIONS } from '../../data/factions';
import { RULES } from '../../data/rules';
import { SKIRMISH_MAPS } from '../../data/skirmish';
import { UNITS } from '../../data/units';
import { variantStats, isCombatClass, isMounted } from './stats';

/**
 * Formation that keeps its side in the battle for the side-broken rule (§6.8): a combat class (not engineers or supply
 * trains), and not an archer-category formation that is out of arrows and not in melee (CD rules amendment to §6.8,
 * GP-01 review: arrowless archers standing idle no longer hold a battle open until the time limit).
 */
export function holdsTheField(f: BattleState['formations'][number]): boolean {
  if (!isCombatClass(f.unitClass)) return false;
  if (UNITS[f.unitClass].category === 'ranged' && f.ammo <= 0 && f.engagedWith.length === 0) return false;
  return true;
}

/**
 * True if a side can no longer fight: it surrendered, or every formation that holds the field (`holdsTheField`) is
 * routing / destroyed / surrendered. A side left with only arrowless archers, engineers and carts is broken; both sides
 * at once is a draw (checkOutcome).
 */
export function sideBroken(state: BattleState, side: SideIndex): boolean {
  const s = state.sides[side];
  if (s.surrendered) return true;
  for (const f of state.formations) {
    if (f.side !== side || f.soldiers <= 0) continue;
    if (!holdsTheField(f)) continue;
    if (f.activity !== 'routing' && f.activity !== 'surrendered' && f.activity !== 'destroyed') return false;
  }
  return true;
}

/** Fighting strength used by the time-limit rule and the AI (soldiers x quality x morale, routers excluded). */
export function sideStrength(state: BattleState, side: SideIndex): number {
  let p = 0;
  const fid = state.setup.sides[side].factionId;
  for (const f of state.formations) {
    if (f.side !== side || f.soldiers <= 0 || f.activity === 'routing' || f.activity === 'surrendered') continue;
    const st = variantStats(fid, f.unitClass);
    p += f.soldiers * (st.meleeAttack + st.meleeDefense + st.rangedAttack) * (st.hp / 10) * (0.5 + f.morale / 200);
  }
  return p;
}

/** Formation routed at least once (routing now, rallied before, or surrendered after a rout). */
function everRouted(f: BattleState['formations'][number]): boolean {
  return f.activity === 'routing' || f.activity === 'surrendered' || f.rallies > 0;
}

/** Enemy formations credited to each formation as routed by it (from the battle log). */
function routedCredits(state: BattleState): Int32Array {
  const out = new Int32Array(state.formations.length);
  for (const e of state.events) {
    if (e.kind !== 'formation_routed' || e.other === null) continue;
    if (e.other >= 0 && e.other < out.length) out[e.other]++;
  }
  return out;
}

/** Mounted soldiers / combat soldiers among the given formations of a side (§6.8 pursuit). */
function mountedShare(state: BattleState, side: SideIndex, routing: boolean): number {
  let mounted = 0;
  let combat = 0;
  for (const f of state.formations) {
    if (f.side !== side || f.soldiers <= 0 || !isCombatClass(f.unitClass)) continue;
    if ((f.activity === 'routing') !== routing || f.activity === 'surrendered') continue;
    combat += f.soldiers;
    if (isMounted(f.unitClass)) mounted += f.soldiers;
  }
  return combat > 0 ? mounted / combat : 0;
}

/** Pursuit share of routing soldiers lost (§6.8). */
export function pursuitRate(winnerMountedShare: number, loserMountedShare: number): number {
  const p = RULES.battle.pursuit;
  return (p.base + p.perWinnerMountedShare * winnerMountedShare) * (1 - p.loserMountedShield * loserMountedShare);
}

/** (x, z) lies outside the battle map: a router there has left the battle (§6.8; survivors return to the army). */
export function offField(state: BattleState, x: number, z: number): boolean {
  const t = state.setup.terrain;
  const h = t.sizeMeters / 2;
  return x < t.centerX - h || x > t.centerX + h || z < t.centerZ - h || z > t.centerZ + h;
}

/** Build the outcome (uses a copy of the battle RNG for the commander fate roll; deterministic). */
export function buildOutcome(state: BattleState, winner: SideIndex | null, reason: BattleOutcome['reason']): BattleOutcome {
  const rng = new Rng(state.rng);
  const credits = routedCredits(state);
  const broke = winner !== null && reason !== 'withdrawal' && reason !== 'time_limit' && reason !== 'objective';
  const sides = ([0, 1] as const).map((side): BattleSideResult => {
    const s = state.sides[side];
    const won = winner === side;
    const lost = winner !== null && !won;
    const rate = broke && lost ? pursuitRate(mountedShare(state, (1 - side) as SideIndex, false), mountedShare(state, side, true)) : 0;
    let pursuit = 0;
    const formations: FormationResult[] = [];
    for (const f of state.formations) {
      if (f.side !== side) continue;
      let survivors = f.soldiers;
      let killed = f.killed;
      let captured = f.captured;
      if (rate > 0 && f.activity === 'routing' && survivors > 0 && !offField(state, f.x, f.z)) {
        const lostN = Math.min(survivors, Math.floor(survivors * rate));
        const cap = Math.floor(lostN * RULES.battle.pursuit.capturedShare);
        survivors -= lostN;
        killed += lostN - cap;
        captured += cap;
        pursuit += lostN;
      }
      const xp = RULES.battle.experience;
      const gained = survivors > 0 ? (won ? xp.winGain : xp.lossGain) + 0.05 * credits[f.index]! : 0;
      formations.push({
        index: f.index,
        armyUnitId: f.armyUnitId,
        unitClass: f.unitClass,
        startSoldiers: f.maxSoldiers,
        survivors,
        killed,
        captured,
        morale: f.morale,
        fatigue: f.fatigue,
        experienceGained: Math.round(gained * 1000) / 1000,
        routed: everRouted(f),
        routedEnemies: credits[f.index]!,
      });
    }
    const survivors = formations.reduce((a, fr) => a + fr.survivors, 0);
    const killed = formations.reduce((a, fr) => a + fr.killed, 0);
    const captured = formations.reduce((a, fr) => a + fr.captured, 0);
    const cmdF = s.commanderFormation >= 0 ? state.formations[s.commanderFormation] : null;
    let fate: BattleSideResult['commanderFate'] = 'none';
    if (cmdF) {
      if (cmdF.activity === 'surrendered' || s.surrendered) fate = 'captured';
      else if (s.commanderAlive) fate = 'safe';
      else {
        const r = rng.next();
        fate = r < 0.5 ? 'killed' : r < 0.8 ? 'wounded' : 'captured';
      }
    }
    return {
      factionId: s.factionId,
      startSoldiers: s.initialSoldiers,
      survivors,
      killed,
      captured,
      pursuitLosses: pursuit,
      commanderFate: fate,
      formations,
      prisoners: 0,
      routs: formations.filter((fr) => fr.routed).length,
      capturedSupply: 0,
      commanderId: state.setup.sides[side].commanderId,
    };
  }) as [BattleSideResult, BattleSideResult];
  // Prisoners = enemy soldiers captured (surrender + pursuit); captured supply = 50% of lost enemy carts' grain.
  for (const side of [0, 1] as const) {
    const other = sides[1 - side]!;
    sides[side].prisoners = other.captured;
    if (winner === side) {
      let grain = 0;
      for (const f of state.formations) {
        if (f.side === side || f.unitClass !== 'supply_train') continue;
        if (f.activity === 'surrendered' || f.activity === 'destroyed' || f.soldiers <= 0) grain += f.maxSoldiers * UNITS.supply_train.stats.supplyCapacity * 0.5;
      }
      sides[side].capturedSupply = grain;
    }
  }
  const lost0 = sides[0].startSoldiers - sides[0].survivors;
  const lost1 = sides[1].startSoldiers - sides[1].survivors;
  const both = Math.max(1, sides[0].startSoldiers + sides[1].startSoldiers);
  const warScore = Math.max(-20, Math.min(20, (RULES.diplomacy.warScore.battlePerShare * (lost1 - lost0)) / both));
  const names = sides.map((s) => FACTIONS[s.factionId]?.shortName ?? s.factionId);
  const place = SKIRMISH_MAPS.find((m) => m.preset === state.setup.terrain.preset)?.name ?? 'the Field';
  const fell = sides[0].killed + sides[1].killed;
  const chronicle =
    winner === null
      ? `The Battle of ${place}: neither ${names[0]} nor ${names[1]} could claim the field; ${fell} fell.`
      : `The Battle of ${place}: ${names[winner]} defeated ${names[1 - winner]}; ${fell} fell.`;
  const fighting = Math.max(0, state.time - state.deploymentEndsAt);
  const summary: string[] = [chronicle];
  const why: Record<BattleOutcome['reason'], string> = {
    rout: 'their foes broke and fled',
    annihilation: 'the enemy host was destroyed',
    withdrawal: 'the enemy withdrew from the field',
    surrender: 'the enemy laid down their arms',
    time_limit: 'night fell on a stronger host',
    objective: 'the objective was won',
    siege_breach: 'the walls were breached and held',
    siege_held: 'the walls held',
  };
  if (winner !== null) summary.push(`The ${names[winner]} host carried the field after ${Math.max(1, Math.round(fighting / 60))} minutes: ${why[reason]}.`);
  else summary.push(`Neither side could claim the field after ${Math.max(1, Math.round(fighting / 60))} minutes.`);
  summary.push(`${names[0]} losses: ${sides[0].killed} killed, ${sides[0].captured} taken. ${names[1]} losses: ${sides[1].killed} killed, ${sides[1].captured} taken.`);
  for (const side of [0, 1] as const) {
    const r = sides[side];
    if (r.commanderFate === 'killed' || r.commanderFate === 'wounded' || r.commanderFate === 'captured') summary.push(`The ${names[side]} commander was ${r.commanderFate}.`);
    if (r.pursuitLosses > 0) summary.push(`${r.pursuitLosses} ${names[side]} men were cut down or taken in the rout.`);
    if (r.prisoners > 0) summary.push(`${names[side]} took ${r.prisoners} prisoners.`);
  }
  if (state.siege && state.siege.breaches.length) summary.push(`${state.siege.breaches.length} breach${state.siege.breaches.length > 1 ? 'es' : ''} opened in the walls.`);
  return {
    battleId: state.id,
    winner,
    reason,
    durationSec: fighting,
    sides,
    summary,
    autoresolved: false,
    warScore: Math.round(warScore * 100) / 100,
    chronicle,
    placeName: null,
    day: null,
  };
}

/** Strength-based end (time limit / forced end of a distant battle): stronger side wins, draw within 10%. */
export function forceOutcome(state: BattleState, reason: BattleOutcome['reason']): BattleOutcome {
  if (state.siege && reason === 'time_limit' && state.setup.fortification) return buildOutcome(state, state.setup.fortification.defenderSide, 'siege_held');
  const s0 = sideStrength(state, 0);
  const s1 = sideStrength(state, 1);
  const winner: SideIndex | null = Math.abs(s0 - s1) < 0.1 * Math.max(s0, s1, 1) ? null : s0 > s1 ? 0 : 1;
  return buildOutcome(state, winner, reason);
}
