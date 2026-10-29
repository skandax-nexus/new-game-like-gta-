/**
 * Formation-level combat resolution (authoritative casualties; DESIGN_SPEC §6.6). OWNER: Gameplay Engineer -
 * Tactical Battle Simulation (GP-01). Baseline by the CTO. The soldier layer never decides casualties.
 *
 * All damage is HP added to `damagePool`; whole casualties are realized when the pool exceeds one model's HP.
 * K = 10 x BALANCE.combat.meleeDamageScale = 0.45.
 *
 * Melee (per tick, both directions, §6.6.1):
 *   frontage = face(A -> D) x (A routing ? 0.1 : 1) x spearReach / shares
 *     face: A's files toward an enemy on its front, ranks toward one on its flank, half the files toward its rear
 *     (all-round shapes: files); shares = enemies in contact on that same face (a front split between two foes).
 *     spearReach = 1.25 for spearmen in line / square with >= 2 ranks against non-spear foes (two spear walls
 *     cancel out - this reproduces the §6.6.1 spear-vs-spear example of 4.7 HP/s).
 *   ATK = meleeAttack x bonusVs x terrain.attack x height x (0.5 + morale/200) x (1 - 0.4 F) x (0.6 + 0.4 C)
 *         x (1 + 0.25 exp) x shape.meleeAttack x (escalade 0.7 when climbing ladders against the walls)
 *   DEF = meleeDefense x terrain.defense x (0.6 + 0.4 C) x (1 + 0.15 exp) x shape.meleeDefense x (on walls 1.3) + armor
 *   dmgHP = frontage x ATK / max(1, DEF) x aspect(1 / 1.5 / 2) x rout(3) x disengage(1.5) x K x dt x U(0.85, 1.15)
 *   Side effects: D cohesion -0.01 x aspect x dt; A fatigue +0.003 x dt x fatigueRate x 100 x terrain/heat/long-fight
 *   multipliers; flank/rear hits add a morale event with p = 0.5 dt.
 * Charge impact (§6.6.2), once on contact after >= 20 m run at >= 60% run speed:
 *   impactHP = min(n_A, 2 files_A) x chargeBonus x mass_A / (mass_D + 1) x 0.35 x shape.chargeImpact x U(0.8, 1.2)
 *              x braced(0.35); recoil on a braced target = 0.5 x the unbraced impact (8 elephants: 189 HP).
 * Trample (§6.6.4): panicking elephants crossing a footprint deal 0.5 x the unbraced impact + elephant_panic.
 */
import type { BattleEventRecord, BattleState, FormationState } from '../../core/types';
import type { Rng } from '../../core/rng';
import { clamp } from '../../core/math';
import { BALANCE } from '../../data/balance';
import { FACTIONS } from '../../data/factions';
import { RULES } from '../../data/rules';
import { UNITS } from '../../data/units';
import type { BattleContext } from './context';
import { addMoraleEvent, aspectOfPoint, onWalls } from './morale';
import { canBrace, shapeMods } from './stats';

/** K = damage scale x 10 (§6.6). */
export const MELEE_K = BALANCE.combat.meleeDamageScale * 10;
const MORALE_CHARGE = BALANCE.morale.chargeShock;

/**
 * Which face of `def` the attacker hits: 0 front, 1 flank, 2 rear (box-normalized position of the attacker's
 * centroid in the defender's frame). All-round shapes (square, circle) always count as front.
 */
export function attackAspect(attacker: FormationState, defender: FormationState): 0 | 1 | 2 {
  if (shapeMods(defender.shape).allRound) return 0;
  const a = aspectOfPoint(defender, attacker.x, attacker.z);
  return a === 0 ? 0 : a === 3 ? 2 : 1;
}

export function aspectMultiplier(aspect: 0 | 1 | 2): number {
  return aspect === 0 ? 1 : aspect === 1 ? BALANCE.combat.flankMultiplier : BALANCE.combat.rearMultiplier;
}

/** Soldiers of A that can strike at an enemy on face `face` (0 front, 1 flank, 2 rear) of A. */
function faceSize(a: FormationState, face: 0 | 1 | 2): number {
  const n = a.soldiers;
  if (face === 0 || shapeMods(a.shape).allRound) return Math.min(n, Math.max(1, a.files));
  if (face === 1) return Math.min(n, Math.max(1, a.ranks));
  return Math.min(n, Math.max(1, a.files)) * 0.5;
}

/** A's face toward formation B. */
function faceToward(a: FormationState, b: FormationState): 0 | 1 | 2 {
  if (shapeMods(a.shape).allRound) return 0;
  const p = aspectOfPoint(a, b.x, b.z);
  return p === 0 ? 0 : p === 3 ? 2 : 1;
}

/** Melee frontage of A against D (§6.6.1 with face / share refinements, see header). */
export function meleeFrontage(state: BattleState, att: FormationState, def: FormationState): number {
  const face = faceToward(att, def);
  let shares = 0;
  for (const oi of att.engagedWith) {
    const o = state.formations[oi];
    if (o && o.soldiers > 0 && faceToward(att, o) === face) shares++;
  }
  const reach = att.unitClass === 'spearmen' && (att.shape === 'line' || att.shape === 'square') && att.ranks >= 2 && def.unitClass !== 'spearmen' ? 1.25 : 1;
  return (faceSize(att, face) * (att.activity === 'routing' ? 0.1 : 1) * reach) / Math.max(1, shares);
}

/** Fatigue gain multiplier: terrain fatigue x heat (>= 34 C: x1.3) x prolongedEngagement after 4 minutes of fighting. */
export function fatigueGainMultiplier(state: BattleState, ctx: BattleContext, f: FormationState): number {
  const w = RULES.battle.weather;
  let m = UNITS[f.unitClass].terrain[ctx.grid.classAt(f.x, f.z)].fatigue;
  if (state.setup.environment.weather.temperatureC >= w.heatAboveC) m *= w.heatFatigue;
  if (state.time - state.deploymentEndsAt > 240) m *= FACTIONS[state.setup.sides[f.side].factionId]?.modifiers.prolongedEngagement ?? 1;
  return m;
}

/** Attacker climbing assault ladders against defenders on the walls (escalade, §6.6.5). */
export function isEscalade(ctx: BattleContext, att: FormationState, def: FormationState): boolean {
  const g = ctx.fort;
  if (!g || att.side !== g.attackerSide || !onWalls(ctx, def)) return false;
  const dx = att.x - g.cx;
  const dz = att.z - g.cz;
  return dx * dx + dz * dz > g.radius * g.radius;
}

/** Expected melee attack value ATK of A against D (without the random factor). */
export function meleeAttackValue(state: BattleState, ctx: BattleContext, att: FormationState, def: FormationState): number {
  const st = ctx.stats[att.index]!;
  const ad = UNITS[att.unitClass];
  const t = ctx.terrain;
  const tA = ad.terrain[ctx.grid.classAt(att.x, att.z)].attack;
  const height = 1 + clamp((t.heightAt(att.x, att.z) - t.heightAt(def.x, def.z)) * BALANCE.combat.heightAdvantagePerMeter, -0.3, 0.3);
  const bonus = ad.bonusVs[def.unitClass] ?? 1;
  const xp = RULES.battle.experience;
  let atk =
    st.meleeAttack *
    bonus *
    tA *
    height *
    (0.5 + att.morale / 200) *
    (1 - 0.4 * att.fatigue) *
    (0.6 + 0.4 * att.cohesion) *
    (1 + xp.attackPerExp * att.experience) *
    shapeMods(att.shape).meleeAttack;
  if (isEscalade(ctx, att, def)) atk *= 1 - RULES.siege.escaladePenalty;
  return atk;
}

/** Melee defense value DEF of D. */
export function meleeDefenseValue(ctx: BattleContext, def: FormationState): number {
  const st = ctx.stats[def.index]!;
  const tD = UNITS[def.unitClass].terrain[ctx.grid.classAt(def.x, def.z)].defense;
  const xp = RULES.battle.experience;
  const walls = onWalls(ctx, def) ? RULES.battle.walls.defense : 1;
  return st.meleeDefense * tD * (0.6 + 0.4 * def.cohesion) * (1 + xp.defensePerExp * def.experience) * shapeMods(def.shape).meleeDefense * walls + st.armor;
}

/** Expected melee damage (HP/s) of A on D (random factor = 1). Used by tests and the AI. */
export function meleeDamagePerSecond(state: BattleState, ctx: BattleContext, att: FormationState, def: FormationState): number {
  const aspect = attackAspect(att, def);
  const rout = def.activity === 'routing' ? RULES.battle.rout.meleeDamageTaken : 1;
  const dis = def.disengageUntil > state.time ? RULES.battle.withdraw.disengageDamageTaken : 1;
  return (meleeFrontage(state, att, def) * meleeAttackValue(state, ctx, att, def)) / Math.max(1, meleeDefenseValue(ctx, def)) * aspectMultiplier(aspect) * rout * dis * MELEE_K;
}

/**
 * Apply HP damage to a formation; realizes whole casualties (credited to `attacker` kills). Returns casualties.
 * Records the loss in ctx.loss (heavy-casualty shock, commander checks).
 */
export function applyDamage(state: BattleState, ctx: BattleContext, f: FormationState, hpDamage: number, attacker: FormationState | null, out: BattleEventRecord[]): number {
  if (f.soldiers <= 0 || hpDamage <= 0) return 0;
  const hp = ctx.stats[f.index]!.hp;
  f.damagePool += hpDamage;
  f.lastHitTime = state.time;
  ctx.hurt[f.index] = 1;
  let dead = Math.floor(f.damagePool / hp);
  if (dead <= 0) return 0;
  dead = Math.min(dead, f.soldiers);
  f.damagePool -= dead * hp;
  f.soldiers -= dead;
  f.killed += dead;
  ctx.loss[f.index] += dead;
  if (attacker) attacker.kills += dead;
  if (f.soldiers <= 0) {
    f.soldiers = 0;
    f.damagePool = 0;
    f.activity = 'destroyed';
    f.vx = 0;
    f.vz = 0;
    out.push({ time: state.time, kind: 'formation_destroyed', side: f.side, formation: f.index, other: attacker ? attacker.index : null, x: f.x, z: f.z, value: null, text: null });
  }
  return dead;
}

/** One direction of a melee exchange for dt. */
export function meleeHit(state: BattleState, ctx: BattleContext, att: FormationState, def: FormationState, dt: number, rng: Rng, out: BattleEventRecord[]): void {
  if (att.soldiers <= 0 || def.soldiers <= 0) return;
  const aspect = attackAspect(att, def);
  const am = aspectMultiplier(aspect);
  const dmg = meleeDamagePerSecond(state, ctx, att, def) * dt * rng.range(0.85, 1.15);
  applyDamage(state, ctx, def, dmg, att, out);
  if (aspect > 0 && rng.chance(dt * 0.5)) addMoraleEvent(def, aspect === 1 ? 'flank_attacked' : 'rear_attacked', state.time);
  def.cohesion = Math.max(0, def.cohesion - 0.01 * am * dt);
  const st = ctx.stats[att.index]!;
  att.fatigue = Math.min(1, att.fatigue + BALANCE.combat.fatigueFightPerSec * dt * st.fatigueRate * 100 * fatigueGainMultiplier(state, ctx, att));
}

/** Melee exchange between two engaged formations for dt (both directions). */
export function resolveMelee(state: BattleState, ctx: BattleContext, a: FormationState, b: FormationState, dt: number, rng: Rng, out: BattleEventRecord[]): void {
  meleeHit(state, ctx, a, b, dt, rng, out);
  meleeHit(state, ctx, b, a, dt, rng, out);
}

/**
 * D braces against A's charge (§6.6.2): spearmen or guards, not moving, not routing, hit from the front - or standing
 * in an all-round shape (square / circle).
 */
export function isBraced(att: FormationState, def: FormationState): boolean {
  if (!canBrace(def.unitClass) || def.activity === 'routing') return false;
  if (def.vx * def.vx + def.vz * def.vz > 0.09) return false;
  if (shapeMods(def.shape).allRound) return true;
  return attackAspect(att, def) === 0;
}

/** Unbraced impact HP of A's charge on D (random factor = 1). */
export function chargeImpactHP(ctx: BattleContext, att: FormationState, def: FormationState): number {
  const a = ctx.stats[att.index]!;
  const d = ctx.stats[def.index]!;
  return Math.min(att.soldiers, 2 * Math.max(1, att.files)) * a.chargeBonus * (a.mass / (d.mass + 1)) * BALANCE.combat.chargeImpulse * shapeMods(att.shape).chargeImpact;
}

/** One-off charge impact when a charging formation makes contact. Returns the HP dealt. */
export function resolveChargeImpact(state: BattleState, ctx: BattleContext, att: FormationState, def: FormationState, rng: Rng, out: BattleEventRecord[]): number {
  const ch = RULES.battle.charge;
  const braced = isBraced(att, def);
  const unbraced = chargeImpactHP(ctx, att, def) * rng.range(0.8, 1.2);
  const impact = unbraced * (braced ? ch.bracedFactor : 1);
  applyDamage(state, ctx, def, impact, att, out);
  if (braced) applyDamage(state, ctx, att, unbraced * ch.bracedRecoil, def, out);
  addMoraleEvent(def, 'charged', state.time, MORALE_CHARGE * (braced ? 0.3 : 1));
  const aspect = attackAspect(att, def);
  if (aspect > 0) addMoraleEvent(def, aspect === 1 ? 'flank_attacked' : 'rear_attacked', state.time);
  out.push({ time: state.time, kind: 'charge', side: att.side, formation: att.index, other: def.index, x: def.x, z: def.z, value: impact, text: braced ? 'braced' : null });
  return impact;
}

/** Panicking elephants trample a formation whose footprint they cross (§6.6.4). */
export function resolveTrample(state: BattleState, ctx: BattleContext, ele: FormationState, victim: FormationState, rng: Rng, out: BattleEventRecord[]): void {
  const hp = RULES.battle.elephantPanic.trampleShare * chargeImpactHP(ctx, ele, victim) * rng.range(0.8, 1.2);
  applyDamage(state, ctx, victim, hp, victim.side === ele.side ? null : ele, out);
  addMoraleEvent(victim, 'elephant_panic', state.time);
  out.push({ time: state.time, kind: 'elephant_rampage', side: ele.side, formation: ele.index, other: victim.index, x: victim.x, z: victim.z, value: hp, text: 'trample' });
}
