/**
 * Formation-level combat resolution (authoritative casualties). OWNER: Lead Gameplay Engineer.
 * Baseline by the CTO: Lanchester-style frontage melee with flank/rear multipliers, unit bonuses,
 * terrain, height advantage, charge impact, fatigue; damage accumulates in `damagePool` and is
 * realized as whole casualties. The soldier layer never decides casualties - it only VISUALIZES them.
 */
import type { BattleEventRecord, BattleState, FormationState, TerrainQuery } from '../../core/types';
import { angleDelta, facingOf } from '../../core/math';
import type { Rng } from '../../core/rng';
import { BALANCE } from '../../data/balance';
import { UNITS } from '../../data/units';
import { addMoraleEvent } from './morale';

/** Which side of the defender the attacker hits: 0 front, 1 flank, 2 rear. */
export function attackAspect(attacker: FormationState, defender: FormationState): 0 | 1 | 2 {
  const dirToAttacker = facingOf(attacker.x - defender.x, attacker.z - defender.z);
  const d = Math.abs(angleDelta(defender.facing, dirToAttacker));
  if (d < 0.9) return 0;
  if (d < 2.3) return 1;
  return 2;
}

/** Apply damage (in HP) to a formation; realizes whole casualties. Returns casualties. */
export function applyDamage(state: BattleState, f: FormationState, hpDamage: number, out: BattleEventRecord[]): number {
  if (f.soldiers <= 0 || hpDamage <= 0) return 0;
  const hp = UNITS[f.unitClass].stats.hp;
  f.damagePool += hpDamage;
  let dead = Math.floor(f.damagePool / hp);
  if (dead <= 0) return 0;
  dead = Math.min(dead, f.soldiers);
  f.damagePool -= dead * hp;
  f.soldiers -= dead;
  f.killed += dead;
  // Heavy casualties shock (rate-limited to one event per 3 s).
  if (dead >= Math.max(2, f.maxSoldiers * 0.02)) {
    const last = f.moraleEvents.length ? f.moraleEvents[f.moraleEvents.length - 1] : undefined;
    if (!last || last.kind !== 'heavy_casualties' || state.time - last.time > 3) addMoraleEvent(f, 'heavy_casualties', state.time, -0.12, 20);
  }
  f.lastHitTime = state.time;
  if (f.hasCommander && f.commanderAlive && f.soldiers < f.maxSoldiers * 0.35) {
    // Baseline: the commander falls when the guard formation is mostly destroyed.
    f.commanderAlive = false;
    const side = state.sides[f.side];
    side.commanderAlive = false;
    out.push({ time: state.time, kind: 'commander_fallen', side: f.side, formation: f.index, other: null, x: f.x, z: f.z, value: null, text: null });
    for (const o of state.formations) if (o.side === f.side && o.soldiers > 0) addMoraleEvent(o, 'commander_fallen', state.time, BALANCE.morale.commanderFallenShock, 60);
  }
  if (f.soldiers <= 0) {
    f.activity = 'destroyed';
    f.engagedWith = [];
    out.push({ time: state.time, kind: 'formation_destroyed', side: f.side, formation: f.index, other: null, x: f.x, z: f.z, value: null, text: null });
  }
  return dead;
}

/** Melee exchange between two engaged formations for dt seconds (both directions). */
export function resolveMelee(state: BattleState, a: FormationState, b: FormationState, dt: number, terrain: TerrainQuery, rng: Rng, out: BattleEventRecord[]): void {
  hit(state, a, b, dt, terrain, rng, out);
  if (b.activity !== 'routing') hit(state, b, a, dt, terrain, rng, out);
}

function hit(state: BattleState, att: FormationState, def: FormationState, dt: number, terrain: TerrainQuery, rng: Rng, out: BattleEventRecord[]): void {
  if (att.soldiers <= 0 || def.soldiers <= 0) return;
  const c = BALANCE.combat;
  const ad = UNITS[att.unitClass];
  const dd = UNITS[def.unitClass];
  const frontage = Math.min(att.soldiers, Math.max(1, att.files)) * (att.activity === 'routing' ? 0.1 : 1);
  const aspect = attackAspect(att, def);
  const aspectMul = aspect === 0 ? 1 : aspect === 1 ? c.flankMultiplier : c.rearMultiplier;
  const tA = ad.terrain[terrain.terrainClassAt(att.x, att.z)].attack;
  const tD = dd.terrain[terrain.terrainClassAt(def.x, def.z)].defense;
  const height = 1 + Math.max(-0.3, Math.min(0.3, (terrain.heightAt(att.x, att.z) - terrain.heightAt(def.x, def.z)) * c.heightAdvantagePerMeter));
  const bonus = ad.bonusVs[def.unitClass] ?? 1;
  const morale = 0.5 + att.morale / 200;
  const fatigue = 1 - att.fatigue * 0.4;
  const attack = ad.stats.meleeAttack * bonus * tA * height * morale * fatigue * (0.6 + att.cohesion * 0.4);
  const defense = dd.stats.meleeDefense * tD * (0.6 + def.cohesion * 0.4) + dd.stats.armor;
  const routMul = def.activity === 'routing' ? 3 : 1;
  const dmg = frontage * (attack / Math.max(1, defense)) * aspectMul * routMul * c.meleeDamageScale * 10 * dt * (0.85 + rng.next() * 0.3);
  applyDamage(state, def, dmg, out);
  if (aspect > 0 && rng.chance(dt * 0.5)) addMoraleEvent(def, aspect === 1 ? 'flank_attacked' : 'rear_attacked', state.time, aspect === 1 ? BALANCE.morale.flankShock : BALANCE.morale.rearShock, 25);
  def.cohesion = Math.max(0, def.cohesion - dt * 0.01 * aspectMul);
  att.fatigue = Math.min(1, att.fatigue + c.fatigueFightPerSec * dt * ad.stats.fatigueRate * 100);
}

/** One-off charge impact when a charging formation makes contact. */
export function resolveChargeImpact(state: BattleState, att: FormationState, def: FormationState, rng: Rng, out: BattleEventRecord[]): void {
  const ad = UNITS[att.unitClass].stats;
  const dd = UNITS[def.unitClass].stats;
  const braced = def.unitClass === 'spearmen' && def.activity !== 'moving' && attackAspect(att, def) === 0;
  const impact = Math.min(att.soldiers, att.files * 2) * ad.chargeBonus * (ad.mass / (dd.mass + 1)) * BALANCE.combat.chargeImpulse * (braced ? 0.35 : 1) * (0.8 + rng.next() * 0.4);
  applyDamage(state, def, impact, out);
  if (braced) applyDamage(state, att, impact * 0.5, out);
  addMoraleEvent(def, 'charged', state.time, BALANCE.morale.chargeShock * (braced ? 0.3 : 1), 20);
  out.push({ time: state.time, kind: 'charge', side: att.side, formation: att.index, other: def.index, x: def.x, z: def.z, value: impact, text: null });
}
