/**
 * Siege works and fortifications in battle (DESIGN_SPEC §6.6.5). OWNER: Gameplay Engineer - Tactical Battle
 * Simulation (GP-01). Geometry: fort.ts; pathing overlay (walls block, gates open for defenders, breaches, ladders,
 * palisades, ditches, bridges): context.ts.
 *
 *  - Wall ring: 12 segments, segment HP = BattleSetup.fortification.wallHp (fortLevel x 1000 x fortDefense / 12 via
 *    `createFortificationSpec`); gates (1 / 2 / 4 by settlement kind) with 1.5 x segment HP; towers (1 per 2 segments
 *    per level) are shooting positions (+20% range / accuracy within 10 m, projectiles.ts) and fall with their segment.
 *  - Engineer works (`construct` order, orders.ts): palisade 40 s (20 m, 300 HP), ditch 60 s (x0.4 speed), bridge
 *    90 s (road speed over a ford / shallows), ram 60 s (then carried by the engineers: 4 HP/s x engineers/10 on a
 *    gate or palisade in reach), ladder 20 s per segment (attackers climb: escalade x0.7 melee, morale -0.15 on the
 *    climb), repair_gate (+10 HP/s). Build time scales with crew (soldiers / formation size) and the siege stat.
 *  - Elephants next to an enemy gate or palisade batter it at siege x soldiers HP/s (5 x 8 = 40 HP/s); foot soldiers
 *    pressed against an enemy palisade hack at it slowly (0.02 HP/s per soldier).
 *  - Defenders on the walls: defense x1.3, accuracy x1.2, range x1.2 (combat.ts, projectiles.ts).
 *  - A segment or gate at 0 HP is breached (passable, `breaches`, `gate_breached` event).
 *  - Siege victory: an attacker formation holding the inside of a breach / broken gate for 60 s with no standing
 *    defender combat formation within 40 m of it -> siege_breach; defenders win at the time limit or if the
 *    attackers break (siege_held).
 */
import type { BattleEventRecord, BattleSetup, BattleSiegeState, BattleState, EngineerWork, EngineerWorkState, FormationState, Vec2 } from '../../core/types';
import { dcos, dsin } from '../../core/math';
import { RULES } from '../../data/rules';
import type { BattleContext } from './context';
import type { FortGeometry } from './fort';
import { angle01, angleFromCenter, createFortGeometry, distFromCenter, GATE_HALF_WIDTH, GATE_REACH, ringPoint, segmentMidAngle, segmentOfAngle, WALL_HALF_BAND } from './fort';
import { isCombatClass } from './stats';
import { standing } from './morale';

/** Build seconds per work for a full formation (§6.6.5); repair_gate is continuous. */
export const WORK_SECONDS: Readonly<Record<EngineerWork, number>> = { palisade: 40, ditch: 60, bridge: 90, ram: 60, ladder: 20, repair_gate: 0 };
/** HP of finished works (palisade 300 per §6.6.5; others nominal). */
export const WORK_HP: Readonly<Record<EngineerWork, number>> = { palisade: 300, ditch: 200, bridge: 400, ram: 150, ladder: 60, repair_gate: 1 };
/** Ram damage per second per 10 engineers at siege stat 4 (§6.6.5: 4 HP/s x engineers / 10). */
export const RAM_HP_PER_10 = 4;
/** Gate repair rate (HP/s). */
export const REPAIR_HP_PER_SEC = 10;
/** Foot soldiers hacking at an enemy palisade (HP/s per soldier). */
export const HACK_HP_PER_SOLDIER = 0.02;
/** Hold radius (m) of a breach for victory and contest radius of defenders. */
export const BREACH_HOLD_RADIUS = 30;
export const BREACH_CONTEST_RADIUS = 40;

/** Initial siege state for a battle with a fortification (null otherwise). */
export function createSiegeState(setup: BattleSetup): BattleSiegeState | null {
  const fort = setup.fortification;
  const g = createFortGeometry(setup);
  if (!fort || !g) return null;
  const segHp = Math.max(1, fort.wallHp);
  return {
    settlementId: setup.origin.kind === 'world' ? setup.origin.settlementId : null,
    segments: Array.from({ length: g.segments }, () => ({ hp: segHp, maxHp: segHp, ladder: false })),
    gates: g.gateSegment.map((segment) => ({ segment, hp: segHp * 1.5, maxHp: segHp * 1.5 })),
    towers: g.towerSegment.map((segment) => ({ segment, hp: segHp, maxHp: segHp, garrison: -1 })),
    breaches: [],
    breachHold: null,
  };
}

const pt: Vec2 = { x: 0, z: 0 };

/** Front-center point of a formation. */
export function frontPoint(f: FormationState, out: Vec2): Vec2 {
  out.x = f.x + dsin(f.facing) * f.depth * 0.5;
  out.z = f.z + dcos(f.facing) * f.depth * 0.5;
  return out;
}

/** Index of the nearest intact gate within `reach` of (x, z) (gate point on the ring), or -1. */
export function gateNear(state: BattleState, g: FortGeometry, x: number, z: number, reach: number, intactOnly = true): number {
  const s = state.siege;
  if (!s) return -1;
  let best = -1;
  let bd = reach * reach;
  for (let i = 0; i < s.gates.length; i++) {
    if (intactOnly && s.gates[i]!.hp <= 0) continue;
    ringPoint(g, g.gateAngle[i]!, g.radius, pt);
    const d = (pt.x - x) * (pt.x - x) + (pt.z - z) * (pt.z - z);
    if (d <= bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** Wall segment index nearest to (x, z) when within `reach` m of the wall line, else -1. */
export function segmentNear(g: FortGeometry, x: number, z: number, reach: number): number {
  const d = distFromCenter(g, x, z);
  if (Math.abs(d - g.radius) > reach) return -1;
  return segmentOfAngle(angleFromCenter(g, x, z), g.segments);
}

/** Is the wall between formations a and b intact (no breach, open gate or ladder for the climber)? */
export function wallBetween(state: BattleState, ctx: BattleContext, a: FormationState, b: FormationState): boolean {
  const g = ctx.fort;
  const s = state.siege;
  if (!g || !s) return false;
  const da = distFromCenter(g, a.x, a.z);
  const db = distFromCenter(g, b.x, b.z);
  const inA = da < g.radius;
  const inB = db < g.radius;
  if (inA === inB) return false;
  const inner = inA ? a : b;
  const outer = inA ? b : a;
  // Point on the wall between them.
  const mx = (inner.x + outer.x) / 2;
  const mz = (inner.z + outer.z) / 2;
  const ang = angleFromCenter(g, mx, mz);
  const seg = segmentOfAngle(ang, g.segments);
  const ws = s.segments[seg];
  if (!ws || ws.hp <= 0) return false;
  for (let i = 0; i < s.gates.length; i++) {
    if (g.gateSegment[i] !== seg || s.gates[i]!.hp > 0) continue;
    const da2 = Math.abs(angle01(ang - g.gateAngle[i]! + Math.PI) - Math.PI);
    if (da2 * g.radius <= GATE_HALF_WIDTH + 8) return false;
  }
  // Ladders: the attacker outside climbs to the defenders on the walls.
  if (ws.ladder && outer.side === g.attackerSide) return false;
  return true;
}

/** Breach / broken-gate points (on the ring) as indices into `breaches` order; writes the point of entry k. */
export function breachPoint(state: BattleState, g: FortGeometry, k: number, out: Vec2): Vec2 {
  const s = state.siege!;
  const seg = s.breaches[k]!;
  // A broken gate sits at its gate angle, a fallen wall at the segment middle.
  let a = segmentMidAngle(seg, g.segments);
  for (let i = 0; i < s.gates.length; i++) if (g.gateSegment[i] === seg && s.gates[i]!.hp <= 0 && s.segments[seg]!.hp > 0) a = g.gateAngle[i]!;
  return ringPoint(g, a, g.radius, out);
}

function markBreach(state: BattleState, seg: number, kind: 'gate' | 'wall', out: BattleEventRecord[], g: FortGeometry): void {
  const s = state.siege!;
  if (!s.breaches.includes(seg)) s.breaches.push(seg);
  ringPoint(g, segmentMidAngle(seg, g.segments), g.radius, pt);
  out.push({ time: state.time, kind: 'gate_breached', side: g.attackerSide, formation: null, other: null, x: pt.x, z: pt.z, value: seg, text: kind });
  for (const t of s.towers) if (t.segment === seg && kind === 'wall') t.hp = 0;
}

/** Damage gate `i`; breaks it at 0 HP. */
export function damageGate(state: BattleState, ctx: BattleContext, i: number, hp: number, out: BattleEventRecord[]): void {
  const s = state.siege;
  const g = ctx.fort;
  if (!s || !g) return;
  const gate = s.gates[i];
  if (!gate || gate.hp <= 0) return;
  gate.hp = Math.max(0, gate.hp - hp);
  if (gate.hp <= 0) markBreach(state, gate.segment, 'gate', out, g);
}

/** Nearest completed enemy palisade whose line passes within `reach` of (x, z), or null. */
function palisadeNear(state: BattleState, side: number, x: number, z: number, reach: number): EngineerWorkState | null {
  for (const w of state.works) {
    if (w.work !== 'palisade' || w.side === side || w.progress < 1 || w.hp <= 0) continue;
    const s = dsin(w.facing);
    const c = dcos(w.facing);
    // Distance from (x, z) to the 20 m segment across the facing.
    const lx = (x - w.x) * -c + (z - w.z) * s;
    const lz = (x - w.x) * s + (z - w.z) * c;
    const ex = Math.max(0, Math.abs(lx) - 10);
    if (ex * ex + lz * lz <= reach * reach) return w;
  }
  return null;
}

function batter(state: BattleState, ctx: BattleContext, f: FormationState, hpPerSec: number, dt: number, out: BattleEventRecord[]): boolean {
  frontPoint(f, pt);
  const g = ctx.fort;
  if (g && state.siege && f.side === g.attackerSide) {
    const gi = gateNear(state, g, pt.x, pt.z, GATE_REACH + f.width * 0.25);
    if (gi >= 0) {
      damageGate(state, ctx, gi, hpPerSec * dt, out);
      return true;
    }
  }
  const p = palisadeNear(state, f.side, pt.x, pt.z, 4);
  if (p) {
    p.hp = Math.max(0, p.hp - hpPerSec * dt);
    return true;
  }
  return false;
}

/** Per-tick siege update: rams, elephants and soldiers vs gates / palisades, breaches, tower garrisons, breach hold. */
export function updateSiegeWorks(state: BattleState, ctx: BattleContext, dt: number, out: BattleEventRecord[]): void {
  // Rams travel with their engineers.
  for (const w of state.works) {
    if (w.work !== 'ram' || w.progress < 1 || w.hp <= 0 || w.formation < 0) continue;
    const f = state.formations[w.formation];
    if (!f || f.soldiers <= 0 || f.activity === 'surrendered') {
      w.formation = -1;
      continue;
    }
    frontPoint(f, pt);
    w.x = pt.x;
    w.z = pt.z;
    w.facing = f.facing;
    if (f.activity === 'routing' || f.engagedWith.length > 0) continue;
    const st = ctx.stats[f.index]!;
    if (batter(state, ctx, f, (RAM_HP_PER_10 * (st.siege / 4) * f.soldiers) / 10, dt, out)) f.activity = 'constructing';
  }
  for (const f of state.formations) {
    if (!standing(f) || f.panicUntil > state.time) continue;
    const st = ctx.stats[f.index]!;
    if (f.unitClass === 'war_elephants') {
      if (f.engagedWith.length === 0) batter(state, ctx, f, st.siege * f.soldiers, dt, out);
    } else if (isCombatClass(f.unitClass) && f.engagedWith.length === 0 && (f.vx * f.vx + f.vz * f.vz) < 0.25) {
      frontPoint(f, pt);
      const p = palisadeNear(state, f.side, pt.x, pt.z, 2.5);
      if (p && f.order.type !== 'hold' && f.order.type !== 'regroup' && f.order.type !== 'defend') p.hp = Math.max(0, p.hp - HACK_HP_PER_SOLDIER * f.soldiers * dt);
    }
  }
  const s = state.siege;
  const g = ctx.fort;
  if (!s || !g) return;
  for (let i = 0; i < s.segments.length; i++) if (s.segments[i]!.hp <= 0 && !s.breaches.includes(i)) markBreach(state, i, 'wall', out, g);
  // Tower garrisons: the nearest defender shooter within reach.
  for (let t = 0; t < s.towers.length; t++) {
    const tw = s.towers[t]!;
    tw.garrison = -1;
    if (tw.hp <= 0) continue;
    ringPoint(g, g.towerAngle[t]!, g.radius, pt);
    let bd = Infinity;
    for (const f of state.formations) {
      if (f.side !== g.defenderSide || !standing(f) || ctx.stats[f.index]!.rangedAttack <= 0) continue;
      const d = (f.x - pt.x) * (f.x - pt.x) + (f.z - pt.z) * (f.z - pt.z);
      const reach = 10 + Math.max(f.width, f.depth) * 0.5;
      if (d <= reach * reach && d < bd) {
        bd = d;
        tw.garrison = f.index;
      }
    }
  }
  updateBreachHold(state, g);
}

/** Attacker formation qualifying as holding breach k (inside, near the entry, uncontested). */
function holdsBreach(state: BattleState, g: FortGeometry, f: FormationState, bx: number, bz: number): boolean {
  if (f.side !== g.attackerSide || !standing(f) || !isCombatClass(f.unitClass)) return false;
  const d = distFromCenter(g, f.x, f.z);
  if (d > g.radius - WALL_HALF_BAND * 0.5) return false;
  const dx = f.x - bx;
  const dz = f.z - bz;
  return dx * dx + dz * dz <= (BREACH_HOLD_RADIUS + f.depth * 0.5) * (BREACH_HOLD_RADIUS + f.depth * 0.5);
}

function contested(state: BattleState, g: FortGeometry, bx: number, bz: number): boolean {
  for (const o of state.formations) {
    if (o.side !== g.defenderSide || !standing(o) || !isCombatClass(o.unitClass)) continue;
    const dx = o.x - bx;
    const dz = o.z - bz;
    if (dx * dx + dz * dz <= BREACH_CONTEST_RADIUS * BREACH_CONTEST_RADIUS) return true;
  }
  return false;
}

function updateBreachHold(state: BattleState, g: FortGeometry): void {
  const s = state.siege!;
  if (s.breaches.length === 0) {
    s.breachHold = null;
    return;
  }
  // Keep the current holder while it still qualifies at any uncontested breach.
  if (s.breachHold) {
    const f = state.formations[s.breachHold.formation];
    let ok = false;
    for (let k = 0; f && k < s.breaches.length && !ok; k++) {
      breachPoint(state, g, k, pt);
      if (holdsBreach(state, g, f, pt.x, pt.z) && !contested(state, g, pt.x, pt.z)) ok = true;
    }
    if (ok) return;
    s.breachHold = null;
  }
  for (let k = 0; k < s.breaches.length; k++) {
    breachPoint(state, g, k, pt);
    if (contested(state, g, pt.x, pt.z)) continue;
    for (const f of state.formations) {
      if (holdsBreach(state, g, f, pt.x, pt.z)) {
        s.breachHold = { formation: f.index, since: state.time };
        return;
      }
    }
  }
}

/** True when the attacker has held a breach for RULES.battle.walls.holdBreachSec (60 s). */
export function breachHeld(state: BattleState): boolean {
  const h = state.siege?.breachHold;
  return !!h && state.time - h.since >= RULES.battle.walls.holdBreachSec;
}

/** Engineer build speed multiplier: crew share (0.25..1.5) x siege stat / 4 (Guild Engineers x1.4). */
export function buildRate(f: FormationState, siegeStat: number, menPerFormation: number): number {
  const crew = Math.min(1.5, Math.max(0.25, f.soldiers / Math.max(1, menPerFormation)));
  return crew * Math.max(0.5, siegeStat / 4);
}

/** Works of `side` of kind `work` within `r` m of (x, z) (in progress or done). */
export function workNear(state: BattleState, side: number, work: EngineerWork, x: number, z: number, r: number): EngineerWorkState | null {
  for (const w of state.works) {
    if (w.side !== side || w.work !== work || w.hp <= 0) continue;
    if (w.work === 'ram' && w.formation >= 0 && w.progress >= 1) continue;
    const dx = w.x - x;
    const dz = w.z - z;
    if (dx * dx + dz * dz <= r * r) return w;
  }
  return null;
}

/** Apply a completed work's one-off effect (ladders go up against the nearest segment). */
export function completeWork(state: BattleState, ctx: BattleContext, w: EngineerWorkState): void {
  w.progress = 1;
  if (w.work === 'ladder' && ctx.fort && state.siege) {
    const seg = segmentNear(ctx.fort, w.x, w.z, 30);
    if (seg >= 0) state.siege.segments[seg]!.ladder = true;
  }
}

/** Gate repair by defender engineers (+10 HP/s on the nearest damaged gate within reach). Returns false when nothing to repair. */
export function repairGate(state: BattleState, ctx: BattleContext, f: FormationState, x: number, z: number, dt: number): boolean {
  const g = ctx.fort;
  const s = state.siege;
  if (!g || !s || f.side !== g.defenderSide) return false;
  const gi = gateNear(state, g, x, z, 30, false);
  if (gi < 0) return false;
  const gate = s.gates[gi]!;
  if (gate.hp <= 0 || gate.hp >= gate.maxHp) return false;
  gate.hp = Math.min(gate.maxHp, gate.hp + REPAIR_HP_PER_SEC * dt * Math.min(1.5, f.soldiers / 40));
  return true;
}
