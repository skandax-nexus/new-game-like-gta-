/**
 * Siege battle AI (DESIGN_SPEC §6.6.5, §6.1 siege deploy zones). OWNER: AI Engineer - Battle AI, Intents & Campaign AI
 * (SIM-02).
 *
 * Attack (the side outside the ring):
 *  - Engineer works: the first engineer formation builds a ram out of bow shot (radius + 205 m, in front of the main
 *    gate) and carries it to the gate (orders.ts moves a finished ram to the nearest intact gate); further engineer
 *    formations raise ladders against the segments flanking the gate, away from the towers' arc where possible, and a
 *    palisade screen for the archers when the walls out-range them.
 *  - Elephants batter the main gate (siege x soldiers HP/s) once the ram is on its way or no ram is coming.
 *  - Archers shoot the defenders on the walls over the gate, covering the ram crew.
 *  - Infantry waits out of bow shot until the gate breaks, a wall falls or ladders are up, then storms the breach: the
 *    first block in holds the inside of the breach (siege victory after 60 s uncontested, `breachHold`), the others
 *    fight the defenders contesting it; the mounted stay outside to run down sallies and routers.
 *  - Without engineers, elephants, breaches or ladders the assault is hopeless: after 30 s the side withdraws.
 * Defence (the garrison):
 *  - Archers keep the wall walk (orders.ts keeps them at their post against enemies beyond the intact wall) and shift
 *    along it toward the threatened gate / ladders / breach.
 *  - Spears and guards defend the inside of the main gate (radius 40 m), then the breach or the laddered segment.
 *  - Engineers repair a damaged gate (+10 HP/s).
 *  - Sally: mounted (else guards) ride out through an intact gate against a ram crew or engineers at work within 150 m
 *    of the walls when nothing stronger guards them, and come back inside afterwards.
 */
import type { FormationState } from '../../../core/types';
import { dcos, dsin, facingOf, PI } from '../../../core/math';
import { UNITS } from '../../../data/units';
import type { FortGeometry } from '../fort';
import { angleFromCenter, distFromCenter, ringPoint, segmentMidAngle } from '../fort';
import { breachPoint } from '../siege';
import { isShooter } from '../stats';
import type { AiSide } from './common';
import { dist, formationStrength, gap, give, stance } from './common';

const p = { x: 0, z: 0 };

function num(ai: AiSide, key: string, def: number): number {
  const v = ai.mem[key];
  return typeof v === 'number' ? v : def;
}

/** Siege plan for one think (the side is attacker or defender of `g`). */
export function runSiege(ai: AiSide, g: FortGeometry): void {
  if (ai.state.phase === 'deployment') {
    if (ai.mem.deployed !== true) {
      for (const f of ai.own) {
        const want = UNITS[f.unitClass].category === 'ranged' ? 'skirmish' : f.unitClass === 'engineers' || f.unitClass === 'supply_train' ? 'defensive' : 'aggressive';
        ai.cmds.push({ kind: 'set_stance', formations: [f.index], stance: want });
      }
      ai.mem.deployed = true;
    }
    return;
  }
  if (ai.side === g.attackerSide) attack(ai, g);
  else defend(ai, g);
}

// ---------------------------------------------------------------------------------------------------
// Attack
// ---------------------------------------------------------------------------------------------------

/** Breach (or broken gate / laddered segment) the assault aims at: its point on the ring, or null. */
function assaultPoint(ai: AiSide, g: FortGeometry, out: { x: number; z: number }): 'breach' | 'ladder' | null {
  const s = ai.state.siege!;
  let best = -1;
  let bd = Infinity;
  for (let k = 0; k < s.breaches.length; k++) {
    breachPoint(ai.state, g, k, p);
    const d = (p.x - ai.ownX) * (p.x - ai.ownX) + (p.z - ai.ownZ) * (p.z - ai.ownZ);
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  if (best >= 0) {
    breachPoint(ai.state, g, best, out);
    return 'breach';
  }
  for (let i = 0; i < s.segments.length; i++) {
    const seg = s.segments[i]!;
    if (!seg.ladder || seg.hp <= 0) continue;
    ringPoint(g, segmentMidAngle(i, g.segments), g.radius, p);
    const d = (p.x - ai.ownX) * (p.x - ai.ownX) + (p.z - ai.ownZ) * (p.z - ai.ownZ);
    if (d < bd) {
      bd = d;
      out.x = p.x;
      out.z = p.z;
    }
  }
  return bd < Infinity ? 'ladder' : null;
}

function attack(ai: AiSide, g: FortGeometry): void {
  const s = ai.state;
  const siege = s.siege!;
  const main = g.mainAngle;
  const engineers: FormationState[] = [];
  const elephants: FormationState[] = [];
  const archers: FormationState[] = [];
  const melee: FormationState[] = [];
  const mounted: FormationState[] = [];
  for (const f of ai.own) {
    if (f.unitClass === 'engineers') engineers.push(f);
    else if (f.unitClass === 'war_elephants') elephants.push(f);
    else if (UNITS[f.unitClass].category === 'ranged' && isShooter(ai.ctx.stats[f.index]!)) archers.push(f);
    else if (f.unitClass === 'spearmen' || f.unitClass === 'elite_guards') melee.push(f);
    else if (f.unitClass !== 'supply_train') mounted.push(f);
  }
  const gateIntact = siege.gates.some((gt) => gt.hp > 0);
  const kind = assaultPoint(ai, g, p);
  const target = { x: p.x, z: p.z };
  const hasTools = engineers.length > 0 || elephants.length > 0;
  if (!kind && !hasTools && !s.works.some((w) => w.side === ai.side && w.work === 'ram' && w.progress >= 1)) {
    if (typeof ai.mem.hopeless !== 'number') ai.mem.hopeless = s.time;
    if (s.time - (ai.mem.hopeless as number) > 30 && !s.sides[ai.side].withdrawn) {
      ai.cmds.push({ kind: 'withdraw_all' });
      return;
    }
  }
  // --- Engineers: ram first, then ladders beside the main gate.
  engineers.forEach((f, i) => {
    if (f.engagedWith.length > 0) return;
    const ram = s.works.find((w) => w.side === ai.side && w.work === 'ram' && w.hp > 0 && w.formation === f.index);
    if (ram) return; // carrying a ram: orders.ts drives it to the gate
    if (i === 0 && gateIntact) {
      const site = ringPoint(g, main, g.radius + 205, { x: 0, z: 0 });
      give(ai, f, { type: 'construct', work: 'ram', x: site.x, z: site.z, facing: main + PI });
      return;
    }
    // Ladders on the segments either side of the gate's segment (alternating), skipping laddered / breached ones.
    const seg0 = Math.floor(((((main / (2 * PI)) % 1) + 1) % 1) * g.segments);
    for (let k = 1; k <= g.segments / 2; k++) {
      const seg = (seg0 + (i % 2 === 1 ? k : -k) + g.segments) % g.segments;
      const st = siege.segments[seg]!;
      if (st.ladder || st.hp <= 0) continue;
      const a = segmentMidAngle(seg, g.segments);
      const site = ringPoint(g, a, g.radius + 8, { x: 0, z: 0 });
      give(ai, f, { type: 'construct', work: 'ladder', x: site.x, z: site.z, facing: a + PI });
      return;
    }
  });
  // --- Elephants batter the main gate (or charge defenders that came out / stand in the breach).
  const gateIdx = siege.gates.findIndex((gt) => gt.hp > 0);
  for (const f of elephants) {
    if (f.engagedWith.length > 0) continue;
    const out = nearestOutside(ai, g, f, 90);
    if (out) {
      give(ai, f, { type: 'charge', target: out.index });
      continue;
    }
    if (gateIdx >= 0) {
      const ga = g.gateAngle[gateIdx]!;
      ringPoint(g, ga, g.radius + 4 + f.depth / 2, p);
      give(ai, f, { type: 'move_to', x: p.x, z: p.z, facing: ga + PI, run: false });
    } else if (kind) {
      storm(ai, g, f, target, false);
    }
  }
  // --- Archers: cover the gate - shoot the defenders on the walls there, from the edge of bow range.
  for (const f of archers) {
    if (f.engagedWith.length > 0) continue;
    let best: FormationState | null = null;
    let bd = Infinity;
    for (const e of ai.known) {
      const d = dist(f, e) + (kind ? dist(e, target) * 0.5 : 0);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (best && dist(f, best) < 175) {
      give(ai, f, { type: 'skirmish', target: best.index });
      continue;
    }
    const a = main + (archers.indexOf(f) - (archers.length - 1) / 2) * 0.12;
    ringPoint(g, a, g.radius + 150, p);
    give(ai, f, { type: 'move_to', x: p.x, z: p.z, facing: a + PI, run: false });
  }
  // --- Infantry: wait out of bow shot; storm once there is a way in.
  melee.forEach((f, i) => {
    if (f.engagedWith.length > 0) return;
    if (kind) {
      storm(ai, g, f, target, i === 0);
      return;
    }
    const near = nearestOutside(ai, g, f, 60);
    if (near) {
      give(ai, f, { type: 'attack_target', target: near.index, run: false });
      return;
    }
    const a = main + (i - (melee.length - 1) / 2) * 0.16;
    ringPoint(g, a, g.radius + 230, p);
    give(ai, f, { type: 'move_to', x: p.x, z: p.z, facing: a + PI, run: false });
  });
  // --- Mounted: outside, against sallies and on the flanks of the gate.
  mounted.forEach((f, i) => {
    if (f.engagedWith.length > 0) return;
    const out = nearestOutside(ai, g, f, 250);
    if (out) {
      give(ai, f, { type: 'charge', target: out.index });
      return;
    }
    const a = main + (i % 2 === 0 ? -1 : 1) * (0.35 + 0.1 * Math.floor(i / 2));
    ringPoint(g, a, g.radius + 190, p);
    give(ai, f, { type: 'move_to', x: p.x, z: p.z, facing: a + PI, run: false });
  });
}

/** March on the way in; the first block holds the inside of the breach, the rest fight the defenders contesting it. */
function storm(ai: AiSide, g: FortGeometry, f: FormationState, target: { x: number; z: number }, holder: boolean): void {
  const inside = distFromCenter(g, f.x, f.z) < g.radius - 4;
  const a = angleFromCenter(g, target.x, target.z);
  if (!inside) {
    // Through the breach toward the inside point.
    ringPoint(g, a, g.radius - 22 - f.depth / 2, p);
    give(ai, f, { type: 'move_to', x: p.x, z: p.z, facing: a + PI, run: false });
    return;
  }
  // Contesting defenders within 60 m of the breach: fight them (the holder only those inside 40 m).
  let best: FormationState | null = null;
  let bd = holder ? 40 : 70;
  for (const e of ai.known) {
    const d = dist(e, target);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  if (best) {
    give(ai, f, { type: 'attack_target', target: best.index, run: false });
    return;
  }
  ringPoint(g, a, g.radius - 22 - f.depth / 2, p);
  if (holder) give(ai, f, { type: 'move_to', x: p.x, z: p.z, facing: a + PI, run: false });
  else {
    const e = nearestInside(ai, g, f);
    if (e) give(ai, f, { type: 'attack_target', target: e.index, run: false });
    else give(ai, f, { type: 'move_to', x: p.x, z: p.z, facing: a + PI, run: false });
  }
}

/** Nearest known enemy standing outside the ring within `r` m of f. */
function nearestOutside(ai: AiSide, g: FortGeometry, f: FormationState, r: number): FormationState | null {
  let best: FormationState | null = null;
  let bd = r;
  for (const e of ai.known) {
    if (distFromCenter(g, e.x, e.z) < g.radius + 2) continue;
    const d = gap(f, e);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

function nearestInside(ai: AiSide, g: FortGeometry, f: FormationState): FormationState | null {
  let best: FormationState | null = null;
  let bd = Infinity;
  for (const e of ai.known) {
    if (distFromCenter(g, e.x, e.z) > g.radius) continue;
    const d = gap(f, e);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------
// Defence
// ---------------------------------------------------------------------------------------------------

/** The threatened point of the ring: a breach, a laddered segment, the gate under attack, else the main gate. */
function threatPoint(ai: AiSide, g: FortGeometry, out: { x: number; z: number }): number {
  const s = ai.state.siege!;
  if (s.breaches.length > 0) {
    // The breach nearest to the attackers.
    let bd = Infinity;
    for (let k = 0; k < s.breaches.length; k++) {
      breachPoint(ai.state, g, k, p);
      const d = (p.x - ai.enemyX) * (p.x - ai.enemyX) + (p.z - ai.enemyZ) * (p.z - ai.enemyZ);
      if (d < bd) {
        bd = d;
        out.x = p.x;
        out.z = p.z;
      }
    }
    return 2;
  }
  for (let i = 0; i < s.segments.length; i++) {
    if (!s.segments[i]!.ladder) continue;
    ringPoint(g, segmentMidAngle(i, g.segments), g.radius, out);
    return 1;
  }
  // The gate nearest to the enemy.
  let bd = Infinity;
  for (let i = 0; i < g.gateAngle.length; i++) {
    ringPoint(g, g.gateAngle[i]!, g.radius, p);
    const d = (p.x - ai.enemyX) * (p.x - ai.enemyX) + (p.z - ai.enemyZ) * (p.z - ai.enemyZ);
    if (d < bd) {
      bd = d;
      out.x = p.x;
      out.z = p.z;
    }
  }
  return 0;
}

function defend(ai: AiSide, g: FortGeometry): void {
  const s = ai.state;
  const siege = s.siege!;
  const tp = { x: 0, z: 0 };
  const level = threatPoint(ai, g, tp);
  const ta = angleFromCenter(g, tp.x, tp.z);
  const archers: FormationState[] = [];
  const melee: FormationState[] = [];
  const mounted: FormationState[] = [];
  const engineers: FormationState[] = [];
  for (const f of ai.own) {
    if (f.unitClass === 'engineers') engineers.push(f);
    else if (UNITS[f.unitClass].category === 'ranged' && isShooter(ai.ctx.stats[f.index]!)) archers.push(f);
    else if (UNITS[f.unitClass].category === 'mounted') mounted.push(f);
    else if (f.unitClass !== 'supply_train') melee.push(f);
  }
  // --- Archers: on the wall walk, fanned around the threatened point (stay put while shooting).
  archers.forEach((f, i) => {
    if (f.engagedWith.length > 0) return;
    if (f.activity === 'shooting' && f.ammo > 0 && Math.abs(angleDiff(angleFromCenter(g, f.x, f.z), ta)) < 0.9) return;
    const slot = i === 0 ? 0 : (i % 2 === 1 ? 1 : -1) * Math.ceil(i / 2);
    const a = ta + (slot * (f.width + 10)) / g.radius + (level === 2 ? 0.25 * (i % 2 === 0 ? 1 : -1) : 0);
    ringPoint(g, a, g.radius - 9 - f.depth / 2, p);
    give(ai, f, { type: 'move_to', x: p.x, z: p.z, facing: a, run: false });
  });
  // --- Sally against a ram crew / engineers at work near the walls.
  const sallyTarget = sallyCandidate(ai, g);
  const sallyForce = mounted.length > 0 ? mounted : melee.filter((f) => f.unitClass === 'elite_guards' && !f.hasCommander);
  for (const f of sallyForce) {
    if (f.engagedWith.length > 0) continue;
    if (sallyTarget && formationStrength(s, f) > 0.7 * guardStrength(ai, g, sallyTarget)) {
      give(ai, f, { type: 'attack_target', target: sallyTarget.index, run: true });
      ai.mem.sally = s.time;
    }
  }
  // --- Melee: defend the inside of the threatened point; mounted not sallying wait in the middle.
  melee.forEach((f, i) => {
    if (f.engagedWith.length > 0) return;
    if (sallyForce.includes(f) && f.order.type === 'attack_target') {
      const t = s.formations[f.order.target];
      if (t && t.soldiers > 0 && t.activity !== 'routing' && distFromCenter(g, t.x, t.z) < g.radius + 160) return;
    }
    const row = Math.floor(i / 3);
    const col = (i % 3) - 1;
    const r = g.radius - 30 - row * 26;
    ringPoint(g, ta, r, p);
    const rx = -dcos(ta);
    const rz = dsin(ta);
    const x = p.x + rx * col * (f.width + 8);
    const z = p.z + rz * col * (f.width + 8);
    give(ai, f, { type: 'defend', x, z, radius: level === 2 ? 45 : 35 });
  });
  for (const f of mounted) {
    if (f.engagedWith.length > 0) continue;
    if (f.order.type === 'attack_target') {
      const t = s.formations[f.order.target];
      if (t && t.soldiers > 0 && t.activity !== 'routing' && distFromCenter(g, t.x, t.z) < g.radius + 160) continue;
    }
    ringPoint(g, ta, g.radius * 0.35, p);
    give(ai, f, { type: 'move_to', x: p.x, z: p.z, facing: ta, run: false });
  }
  // --- Engineers: repair the most damaged intact gate.
  let gi = -1;
  let worst = 1;
  for (let i = 0; i < siege.gates.length; i++) {
    const gt = siege.gates[i]!;
    const share = gt.hp / Math.max(1, gt.maxHp);
    if (gt.hp > 0 && share < worst - 1e-6) {
      worst = share;
      gi = i;
    }
  }
  for (const f of engineers) {
    if (f.engagedWith.length > 0) continue;
    stance(ai, f, 'defensive');
    if (gi >= 0) {
      ringPoint(g, g.gateAngle[gi]!, g.radius - 12, p);
      give(ai, f, { type: 'construct', work: 'repair_gate', x: p.x, z: p.z, facing: g.gateAngle[gi]! });
    } else {
      ringPoint(g, ta, g.radius * 0.3, p);
      give(ai, f, { type: 'move_to', x: p.x, z: p.z, facing: ta, run: false });
    }
  }
  void num;
  void facingOf;
}

function angleDiff(a: number, b: number): number {
  let d = (b - a) % (2 * PI);
  if (d > PI) d -= 2 * PI;
  if (d < -PI) d += 2 * PI;
  return d;
}

/** An enemy ram crew (or engineers at work) within 150 m outside the walls. */
function sallyCandidate(ai: AiSide, g: FortGeometry): FormationState | null {
  let best: FormationState | null = null;
  let bd = 150;
  for (const e of ai.known) {
    if (e.unitClass !== 'engineers') continue;
    const d = distFromCenter(g, e.x, e.z) - g.radius;
    if (d < 0 || d > bd) continue;
    bd = d;
    best = e;
  }
  return best;
}

/** Strength of the enemy formations within 60 m of `t` (its guard), t included. */
function guardStrength(ai: AiSide, g: FortGeometry, t: FormationState): number {
  let s = 0;
  for (const e of ai.known) if (gap(e, t) < 60) s += formationStrength(ai.state, e);
  void g;
  return s;
}
