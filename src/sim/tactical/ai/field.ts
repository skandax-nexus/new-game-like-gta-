/**
 * Field battle AI (DESIGN_SPEC §6.1, §6.3, §6.5-§6.11, §10.4; GDD §9 utility AI). OWNER: AI Engineer - Battle AI,
 * Intents & Campaign AI (SIM-02).
 *
 * One plan per side, re-made every `battleAiReplanSec` (3 / 2 / 1.5 / 1 s by difficulty) - formation-level utility
 * scoring, never per-soldier decision trees:
 *  - Deployment (first think of the deployment phase): posture rolled from the battle profile, the best site in the
 *    deploy zone (height over the ground ahead, footing, forest cover for a holding side) and the line order around it:
 *    elephants 25 m in front, spears / guards in line, archers 20 m behind, horse on the wings, scouts forward, the
 *    reserve, engineers and carts to the rear. Archers loose against missiles or elephants. Formations placed by the
 *    setup (scripted battles) keep their positions. During the fight guards form square while horse, chariots or
 *    elephants are within 100 m and return to line beyond 180 m.
 *  - Posture: `aggression` is the chance the side attacks rather than holds, shifted by the strength ratio, who
 *    out-shoots whom and the ground; a holding side attacks when the enemy will not come (patience 25-95 s by
 *    aggression), when it is out-shot, or when the enemy is beaten. `withdrawAt`: below that share of its starting
 *    strength - and losing - the side orders withdraw_all.
 *  - Roles: line, reserve (`reserve` share held 150 m back until committed), missile, shock (elephants), mounted flank
 *    force (`flanking` share, wing by geometry) and screen, skirmishers, engineers, carts.
 *  - Line: rank-matched to the enemy front so the line meets it as a line; extra blocks wrap the enemy ends (flank
 *    orders), the line paces itself to arrive together, charges only targets that are not braced.
 *  - Missiles: counters-aware focus - elephants (panic) and chariots first, blocks overlapping the own flanks and
 *    anything charging the archers next, enemies already in melee with friends last (friendly fire).
 *  - Mounted: around the flank to archers / engineers / carts / scouts and into the flank or rear of enemy blocks in
 *    melee; never into braced spears or elephants; screens protect the archers; only mounted pursue routers.
 *  - Elephants: shock against unbraced blocks (moving, or in melee seen from the flank), horse and chariots.
 *  - Reserve: committed when a line block wavers or is flanked, an enemy turns the flank, or the fight is decided.
 *  - Commander: stays behind the centre; Rally when it swings morale (routers that can rally, wavering blocks).
 * Cost: per-think memos of per-enemy facts (engaged with us, gap to our archers, shielding spears) and a pruned target
 * scan for the horse keep a 40-formation think under 0.1 ms (tests/sim/ai/perf.test.ts).
 */
import type { FormationState, FormationOrder } from '../../../core/types';
import { dcos, dlog, dsin, facingOf } from '../../../core/math';
import { RULES } from '../../../data/rules';
import { UNITS } from '../../../data/units';
import { effectiveRange } from '../projectiles';
import { isShooter } from '../stats';
import type { AiSide, Role } from './common';
import { along, bracedAgainst, closing, counterLog, dist, formationStrength, gap, give, lateral, ROLE, shape, speedOf, stance } from './common';
import { badFooting, siteScore } from './terrain';

/** ln 2 (log2 x = dlog(x) / LN2; Math.log2 is not deterministic across engines). */
const LN2 = 0.6931471805599453;

// ---------------------------------------------------------------------------------------------------
// Memory accessors
// ---------------------------------------------------------------------------------------------------

function num(ai: AiSide, key: string, def: number): number {
  const v = ai.mem[key];
  return typeof v === 'number' ? v : def;
}

function str(ai: AiSide, key: string, def: string): string {
  const v = ai.mem[key];
  return typeof v === 'string' ? v : def;
}

function roleOf(ai: AiSide, f: FormationState): Role {
  const roles = str(ai, 'roles', '');
  return (roles[f.index] as Role | undefined) ?? ROLE.none;
}

// ---------------------------------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------------------------------

function baseRole(f: FormationState): Role {
  switch (f.unitClass) {
    case 'spearmen':
    case 'elite_guards':
      return ROLE.line;
    case 'archers':
      return ROLE.missile;
    case 'war_elephants':
      return ROLE.shock;
    case 'cavalry':
    case 'chariots':
      return ROLE.screen;
    case 'scouts':
      return ROLE.skirmisher;
    case 'engineers':
      return ROLE.engineer;
    case 'supply_train':
      return ROLE.cart;
  }
}

/** Assign roles once (start of the battle): flank share of the mounted by wing, reserve share of the line. */
function assignRoles(ai: AiSide): void {
  const n = ai.state.formations.length;
  const roles: string[] = Array.from({ length: n }, () => ROLE.none);
  const mounted: FormationState[] = [];
  const line: FormationState[] = [];
  let combat = 0;
  for (const f of ai.ownAlive) {
    const r = baseRole(f);
    roles[f.index] = r;
    if (r === ROLE.screen) mounted.push(f);
    if (r === ROLE.line) line.push(f);
    if (r === ROLE.line || r === ROLE.missile || r === ROLE.shock || r === ROLE.screen) combat++;
  }
  // Flank force: the `flanking` share of the mounted, taken from the outer wings first.
  mounted.sort((a, b) => Math.abs(lateral(ai, b.x, b.z)) - Math.abs(lateral(ai, a.x, a.z)) || a.index - b.index);
  const nFlank = Math.round(ai.profile.flanking * mounted.length + 1e-6);
  for (let i = 0; i < mounted.length; i++) {
    const f = mounted[i]!;
    if (i < nFlank) roles[f.index] = lateral(ai, f.x, f.z) < 0 ? ROLE.flankLeft : ROLE.flankRight;
  }
  // Reserve: the `reserve` share of the combat formations, from the line (guards with the commander first), keeping at
  // least two blocks in the line.
  const nRes = Math.min(Math.round(ai.profile.reserve * combat), Math.max(0, line.length - 2));
  line.sort((a, b) => reservePriority(b) - reservePriority(a) || Math.abs(lateral(ai, a.x, a.z)) - Math.abs(lateral(ai, b.x, b.z)) || a.index - b.index);
  for (let i = 0; i < nRes; i++) roles[line[i]!.index] = ROLE.reserve;
  ai.mem.roles = roles.join('');
}

function reservePriority(f: FormationState): number {
  return (f.hasCommander ? 2 : 0) + (f.unitClass === 'elite_guards' ? 1 : 0);
}

// ---------------------------------------------------------------------------------------------------
// Line geometry
// ---------------------------------------------------------------------------------------------------

interface Slot {
  f: FormationState;
  lat: number;
  /** Frontage (m) the block should take (its own width unless the line is thinned to match the enemy front). */
  width: number;
}

const lineSlots: Slot[] = [];
const enemyFront: FormationState[] = [];
const tmpP = { x: 0, z: 0 };

/** Widest frontage (m) a block can take: two ranks (formations.setFrontage limit). */
function maxWidth(f: FormationState): number {
  const st = UNITS[f.unitClass].stats;
  const spread = RULES.battle.shapes[f.shape].spread;
  return Math.ceil(f.soldiers / 2) * st.spacingX * spread;
}

/**
 * Own line formations sorted by lateral position, with contiguous slot offsets (8 m gaps) centred on 0. When the known
 * enemy front is wider than the line (it would overlap a flank), line blocks thin their ranks - never below two - to
 * match its span (the drag-to-width rule, §6.3), so the line is not turned. Returns the line width.
 */
function layoutLine(ai: AiSide, list: FormationState[], span: number): number {
  list.sort((a, b) => lateral(ai, a.x, a.z) - lateral(ai, b.x, b.z) || a.index - b.index);
  let w = -8;
  for (const f of list) w += f.width + 8;
  lineSlots.length = 0;
  let scale = 1;
  if (list.length > 0 && span > w + 10) {
    let cap = -8;
    for (const f of list) cap += Math.max(f.width, maxWidth(f)) + 8;
    const target = Math.min(span, cap);
    const blocks = w - 8 * (list.length - 1);
    scale = Math.max(1, (target - 8 * (list.length - 1)) / Math.max(1, blocks));
  }
  let total = -8;
  for (const f of list) total += Math.min(Math.max(f.width, maxWidth(f)), f.width * scale) + 8;
  let off = -total / 2;
  for (const f of list) {
    const width = Math.min(Math.max(f.width, maxWidth(f)), f.width * scale);
    lineSlots.push({ f, lat: off + width / 2, width });
    off += width + 8;
  }
  return Math.max(0, total);
}

/** Lateral span (m) of the known enemy front (outer edge to outer edge). */
function enemySpan(ai: AiSide): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const e of enemyFront) {
    const l = lateral(ai, e.x, e.z);
    lo = Math.min(lo, l - e.width / 2);
    hi = Math.max(hi, l + e.width / 2);
  }
  return hi > lo ? hi - lo : 0;
}

/** Known enemy blocks forming its front (infantry / elephants within 50 m of its most forward one), by lateral. */
function findEnemyFront(ai: AiSide): void {
  enemyFront.length = 0;
  let front = Infinity;
  for (const e of ai.known) {
    const c = UNITS[e.unitClass].category;
    if (c !== 'infantry' && c !== 'beast') continue;
    front = Math.min(front, along(ai, e.x, e.z) - e.depth / 2);
  }
  for (const e of ai.known) {
    const c = UNITS[e.unitClass].category;
    if (front === Infinity ? c === 'support' : c !== 'infantry' && c !== 'beast') continue;
    if (front !== Infinity && along(ai, e.x, e.z) - e.depth / 2 > front + 50) continue;
    enemyFront.push(e);
  }
  enemyFront.sort((a, b) => lateral(ai, a.x, a.z) - lateral(ai, b.x, b.z) || a.index - b.index);
}

/** Point at lateral `lat` and forward `fwd` m from an anchor facing `facing`. */
function at(x: number, z: number, facing: number, lat: number, fwd: number, out: { x: number; z: number }): { x: number; z: number } {
  out.x = x - dcos(facing) * lat + dsin(facing) * fwd;
  out.z = z + dsin(facing) * lat + dcos(facing) * fwd;
  return out;
}

function clampToMap(ai: AiSide, p: { x: number; z: number }): { x: number; z: number } {
  const b = ai.terrain.bounds;
  p.x = Math.min(b.maxX - 25, Math.max(b.minX + 25, p.x));
  p.z = Math.min(b.maxZ - 25, Math.max(b.minZ + 25, p.z));
  return p;
}

// ---------------------------------------------------------------------------------------------------
// Deployment
// ---------------------------------------------------------------------------------------------------

/** Per-side index of a formation in its setup list (formations are created side 0 first). */
function setupEntry(ai: AiSide, f: FormationState): { x: number | null; z: number | null } | null {
  let k = 0;
  for (const o of ai.state.formations) {
    if (o === f) break;
    if (o.side === f.side) k++;
  }
  return ai.state.setup.sides[f.side].formations[k] ?? null;
}

/** Initial posture roll (DESIGN_SPEC §10.4: aggression = chance to attack vs hold), shifted by the situation. */
function rollPosture(ai: AiSide): 'attack' | 'hold' {
  ai.mem.pA = attackChance(ai);
  return ai.rng.next() < (ai.mem.pA as number) ? 'attack' : 'hold';
}

function attackChance(ai: AiSide): number {
  const s = ai.state;
  let p = ai.profile.aggression;
  const ratio = ai.ownStr / Math.max(1, ai.enemyStr);
  // Stronger -> attack; weaker -> hold (log2 ratio, +-1 = double / half).
  p += 0.25 * Math.max(-1, Math.min(1, dlog(Math.max(1e-3, ratio)) / LN2));
  // Out-shot -> must close; out-shooting -> let them come.
  const mt = ai.ownMissile + ai.enemyMissile;
  if (mt > 0) p += 0.4 * ((ai.enemyMissile - ai.ownMissile) / mt);
  // High ground: hold it.
  const hOwn = ai.terrain.heightAt(ai.ownX, ai.ownZ);
  const hEnemy = ai.terrain.heightAt(ai.enemyX, ai.enemyZ);
  p -= 0.25 * Math.max(-1, Math.min(1, (hOwn - hEnemy) / 10));
  // World battles: the attacker came to fight; a defender of a river crossing holds the bank.
  if (s.setup.origin.kind === 'world') p += s.setup.attackerSide === ai.side ? 0.15 : -0.15;
  if (s.setup.kind === 'river_crossing' && s.setup.attackerSide !== ai.side) p -= 0.1;
  if (s.setup.kind === 'ambush' && s.setup.attackerSide !== ai.side) p -= 0.3;
  return Math.max(0.05, Math.min(0.95, p));
}

/** Dry, passable ground for f at (x, z) within the zone (no water under the centre or either end of the block). */
function dryFooting(ai: AiSide, f: FormationState, x: number, z: number): boolean {
  const zone = ai.state.setup.sides[ai.side].deployZone;
  if (x < zone.minX - 1 || x > zone.maxX + 1 || z < zone.minZ - 1 || z > zone.maxZ + 1) return false;
  const rx = -dcos(ai.facing) * f.width * 0.5;
  const rz = dsin(ai.facing) * f.width * 0.5;
  for (let k = -1; k <= 1; k++) {
    const px = x + rx * k;
    const pz = z + rz * k;
    if (!ai.terrain.inBounds(px, pz) || ai.terrain.isWater(px, pz)) return false;
    if (!ai.ctx.grid.passableAt(px, pz, ai.ctx.profile[f.index]!, ai.side)) return false;
  }
  return true;
}

/** Footing along a line at (x, z): -0.8 per bad sample (centre and both ends). */
function footingScore(ai: AiSide, x: number, z: number, facing: number, halfWidth: number): number {
  let s = 0;
  const rx = -dcos(facing);
  const rz = dsin(facing);
  for (let k = -1; k <= 1; k++) {
    const px = x + rx * halfWidth * k;
    const pz = z + rz * halfWidth * k;
    if (!ai.terrain.inBounds(px, pz)) s -= 2;
    else if (badFooting(ai.terrain, px, pz)) s -= 0.8;
  }
  return s;
}

function deploy(ai: AiSide): void {
  const s = ai.state;
  const setup = s.setup;
  const zone = setup.sides[ai.side].deployZone;
  const posture = rollPosture(ai);
  ai.mem.posture = posture;
  ai.mem.pt = s.time;
  const facing = ai.facing;
  const line: FormationState[] = [];
  for (const f of ai.own) if (roleOf(ai, f) === ROLE.line) line.push(f);
  const w = layoutLine(ai, line, 0);
  // Best anchor in the zone: 5 x 4 candidates.
  const hold = posture === 'hold';
  const ambusher = setup.kind === 'ambush' && setup.attackerSide !== ai.side;
  let best = -Infinity;
  let ax = (zone.minX + zone.maxX) / 2;
  let az = (zone.minZ + zone.maxZ) / 2;
  const cx = ax;
  const cz = az;
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 4; j++) {
      const x = zone.minX + 30 + ((zone.maxX - zone.minX - 60) * i) / 4;
      const z = zone.minZ + 30 + ((zone.maxZ - zone.minZ - 60) * j) / 3;
      if (ai.terrain.isWater(x, z)) continue;
      const fwd = (x - cx) * ai.fwdX + (z - cz) * ai.fwdZ;
      const lat = Math.abs((x - cx) * ai.rightX + (z - cz) * ai.rightZ);
      // A holding side wants height, footing and (ambushers) cover; an attacking side wants the front of its zone (every
      // metre given here is walked under the enemy's arrows later) with good footing.
      // (Height is worth giving ground for only when it is real: 10 m of rise outweighs 125 m of forward position.)
      let score = hold || ambusher ? siteScore(ai.terrain, x, z, facing, Math.max(30, w / 2), true) + 0.008 * fwd : footingScore(ai, x, z, facing, Math.max(30, w / 2)) + 0.02 * fwd;
      score -= 0.004 * lat;
      if (score > best + 1e-9) {
        best = score;
        ax = x;
        az = z;
      }
    }
  }
  ai.mem.ax = ax;
  ai.mem.az = az;
  ai.mem.af = facing;
  const enemyMissile = ai.enemyMissile > 0;
  const enemyElephants = ai.known.some((e) => e.unitClass === 'war_elephants');
  // Lay out around the anchor.
  const archers: FormationState[] = [];
  const reserve: FormationState[] = [];
  const left: FormationState[] = [];
  const right: FormationState[] = [];
  const shockList: FormationState[] = [];
  const rear: FormationState[] = [];
  const scouts: FormationState[] = [];
  for (const f of ai.own) {
    const r = roleOf(ai, f);
    if (r === ROLE.missile) archers.push(f);
    else if (r === ROLE.reserve) reserve.push(f);
    else if (r === ROLE.shock) shockList.push(f);
    else if (r === ROLE.flankLeft) left.push(f);
    else if (r === ROLE.flankRight) right.push(f);
    else if (r === ROLE.screen) (lateral(ai, f.x, f.z) < 0 ? left : right).push(f);
    else if (r === ROLE.skirmisher) scouts.push(f);
    else if (r === ROLE.engineer || r === ROLE.cart) rear.push(f);
  }
  const lineDepth = line.reduce((m, f) => Math.max(m, f.depth), 0);
  const place = (f: FormationState, lat: number, fwd: number): void => {
    const e = setupEntry(ai, f);
    if (e && e.x !== null && e.z !== null) return;
    if (ambusher && f.hidden) return;
    at(ax, az, facing, lat, fwd, tmpP);
    // Clamp into the zone first, then step back out of water / impassable ground (as the line-order auto-deploy does).
    tmpP.x = Math.min(zone.maxX, Math.max(zone.minX, tmpP.x));
    tmpP.z = Math.min(zone.maxZ, Math.max(zone.minZ, tmpP.z));
    for (let k = 0; k < 40 && !dryFooting(ai, f, tmpP.x, tmpP.z); k++) {
      tmpP.x -= dsin(facing) * 8;
      tmpP.z -= dcos(facing) * 8;
    }
    if (!dryFooting(ai, f, tmpP.x, tmpP.z)) return;
    ai.cmds.push({ kind: 'deploy', formation: f.index, x: tmpP.x, z: tmpP.z, facing });
  };
  for (const sl of lineSlots) place(sl.f, sl.lat, 0);
  shockList.forEach((f, i) => place(f, (i - (shockList.length - 1) / 2) * (f.width + 12), lineDepth / 2 + 25 + f.depth / 2));
  const span = Math.max(w, 40);
  archers.forEach((f, i) => place(f, ((i + 0.5) / archers.length - 0.5) * span, -(lineDepth / 2 + 20 + f.depth / 2)));
  reserve.forEach((f, i) => place(f, (i - (reserve.length - 1) / 2) * (f.width + 12), -(lineDepth / 2 + 70)));
  left.forEach((f, i) => place(f, -(span / 2 + 25 + f.width / 2 + i * (f.width + 12)), -10));
  right.forEach((f, i) => place(f, span / 2 + 25 + f.width / 2 + i * (f.width + 12), -10));
  scouts.forEach((f, i) => place(f, (i % 2 === 0 ? -1 : 1) * (span / 2 + 10), lineDepth / 2 + 45));
  rear.forEach((f, i) => place(f, (i - (rear.length - 1) / 2) * (f.width + 15), -(lineDepth / 2 + 95)));
  // Shapes and stances (the pre-orders): every formation's stance is confirmed for the battle.
  for (const f of ai.own) {
    const r = roleOf(ai, f);
    if (f.unitClass === 'elite_guards') shape(ai, f, 'line');
    if (r === ROLE.missile) shape(ai, f, enemyMissile || enemyElephants ? 'loose' : 'line');
    const want = r === ROLE.missile ? 'skirmish' : r === ROLE.engineer || r === ROLE.cart ? 'defensive' : 'aggressive';
    ai.cmds.push({ kind: 'set_stance', formations: [f.index], stance: want });
  }
  ai.mem.deployed = true;
}

// ---------------------------------------------------------------------------------------------------
// Posture
// ---------------------------------------------------------------------------------------------------

function anyEngaged(ai: AiSide): boolean {
  for (const f of ai.ownAlive) if (f.engagedWith.length > 0) return true;
  return false;
}

/** Hold -> attack transitions (patience, out-shot, enemy beaten); records first contact. */
function updatePosture(ai: AiSide): void {
  const s = ai.state;
  const t = s.time;
  if (typeof ai.mem.posture !== 'string') {
    ai.mem.posture = rollPosture(ai);
    ai.mem.pt = t;
  }
  if (anyEngaged(ai) && typeof ai.mem.contact !== 'number') ai.mem.contact = t;
  const d = dist({ x: ai.ownX, z: ai.ownZ }, { x: ai.enemyX, z: ai.enemyZ });
  // Approach tracking: the last time the gap closed by 15 m.
  const markD = num(ai, 'md', d);
  if (typeof ai.mem.md !== 'number' || d < markD - 15) {
    ai.mem.md = d;
    ai.mem.mt = t;
  } else if (d > markD + 15) ai.mem.md = d;
  if (ai.mem.posture !== 'hold') return;
  const ratio = ai.ownStr / Math.max(1, ai.enemyStr);
  const sinceApproach = t - num(ai, 'mt', t);
  const patience = 25 + 70 * (1 - ai.profile.aggression);
  let attack = false;
  // The enemy is beaten or has thinned out: press.
  if (ai.known.length > 0 && ratio > 2) attack = true;
  // Out-shot while it will not come: close the distance.
  if (ai.enemyMissile > ai.ownMissile * 1.25 && sinceApproach > 10 && underFire(ai)) attack = true;
  // Patience: neither side comes - attack if not much weaker (a much weaker side keeps its ground).
  if (sinceApproach > patience && !anyEngaged(ai) && ratio > 0.55) attack = true;
  if (sinceApproach > patience * 2.5 && !anyEngaged(ai)) attack = true;
  if (attack) {
    ai.mem.posture = 'attack';
    ai.mem.pt = t;
  }
}

function underFire(ai: AiSide): boolean {
  const t = ai.state.time;
  for (const f of ai.own) if (f.engagedWith.length === 0 && t - f.lastHitTime < 8) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------------
// Target scoring
// ---------------------------------------------------------------------------------------------------

// Per-think memo of per-enemy facts (roles are fixed once assigned, positions do not change within a think).
let thinkStamp = 0;
let memoStamp = new Int32Array(64);
let memoEngaged = new Int8Array(64);
let memoMissileGap = new Float64Array(64);
let memoShield = new Int32Array(64);
const M_ENGAGED = 1;
const M_GAP = 2;
const M_SHIELD = 4;
let memoFlags = new Int8Array(64);

function memoFor(n: number): void {
  if (memoStamp.length < n) {
    memoStamp = new Int32Array(n * 2);
    memoEngaged = new Int8Array(n * 2);
    memoMissileGap = new Float64Array(n * 2);
    memoShield = new Int32Array(n * 2);
    memoFlags = new Int8Array(n * 2);
  }
}

function memo(i: number): void {
  if (memoStamp[i] !== thinkStamp) {
    memoStamp[i] = thinkStamp;
    memoFlags[i] = 0;
  }
}

/** Height difference bound for the missile range pre-check (m; battle maps stay well within it). */
const MAX_DH = 300;

function engagedWithSide(ai: AiSide, e: FormationState): boolean {
  const i = e.index;
  memo(i);
  if (memoFlags[i]! & M_ENGAGED) return memoEngaged[i] === 1;
  let v = 0;
  for (const oi of e.engagedWith) if (ai.state.formations[oi]?.side === ai.side) {
    v = 1;
    break;
  }
  memoEngaged[i] = v;
  memoFlags[i] = memoFlags[i]! | M_ENGAGED;
  return v === 1;
}

/** Smallest gap from `e` to any own (not routing) missile formation. */
function missileGap(ai: AiSide, e: FormationState): number {
  const i = e.index;
  memo(i);
  if (memoFlags[i]! & M_GAP) return memoMissileGap[i]!;
  let g = Infinity;
  for (const f of ai.ownAlive) {
    if (roleOf(ai, f) !== ROLE.missile || f.activity === 'routing') continue;
    const d = gap(f, e);
    if (d < g) g = d;
  }
  memoMissileGap[i] = g;
  memoFlags[i] = memoFlags[i]! | M_GAP;
  return g;
}

/** Enemy within `r` m (gap) of any own missile formation. */
function threatensArchers(ai: AiSide, e: FormationState, r: number): boolean {
  return missileGap(ai, e) < r;
}

/** Enemy spears / guards standing free within 35 m of `e` (they would catch horse riding at it). */
function shieldsOf(ai: AiSide, e: FormationState): number {
  const i = e.index;
  memo(i);
  if (memoFlags[i]! & M_SHIELD) return memoShield[i]!;
  let n = 0;
  for (const o of ai.known) if ((o.unitClass === 'spearmen' || o.unitClass === 'elite_guards') && o.engagedWith.length === 0 && gap(o, e) < 35) n++;
  memoShield[i] = n;
  memoFlags[i] = memoFlags[i]! | M_SHIELD;
  return n;
}

/** Missile target value of `e` for shooter `a` (-Infinity = out of range). */
function missileScore(ai: AiSide, a: FormationState, e: FormationState, reach: number, halfLine: number): number {
  const d = dist(a, e);
  // Cheap bound first: effectiveRange <= base x height bonus x walls x tower; far beyond it the exact range is moot.
  const st = ai.ctx.stats[a.index]!;
  const base = Math.min(st.range, RULES.battle.weather.rangeVsVisibility * ai.state.setup.environment.weather.visibility);
  if (d > base * (1 + 0.01 * MAX_DH) * RULES.battle.walls.range * 1.2 * reach) return -Infinity;
  const r = effectiveRange(ai.state, ai.ctx, a, e);
  if (d > r * reach) return -Infinity;
  let s = 1 + 2 * counterLog(a, e);
  if (e.unitClass === 'war_elephants') s += 2.5;
  else if (e.unitClass === 'chariots') s += 1.5;
  if (engagedWithSide(ai, e) && e.unitClass !== 'war_elephants') s -= 1.6;
  if (Math.abs(lateral(ai, e.x, e.z)) > halfLine + 10 && UNITS[e.unitClass].category !== 'support') s += 1.2;
  if (UNITS[e.unitClass].category !== 'ranged' && threatensArchers(ai, e, 90)) s += 1.5;
  if (closing(a, e) > 0.5) s += 0.4;
  if (e.morale < 40) s += 0.4;
  if (e.shape === 'loose') s -= 0.6;
  s -= (0.8 * d) / Math.max(1, r);
  if (e.index === a.target) s += 0.3;
  return s;
}

/**
 * Strike value of `e` for a mounted formation `f` (cavalry, chariots). `floor`: a caller looking for the best target
 * passes its best score so far - the path check (which can only lower the score) is skipped when the rest cannot beat
 * it (the result is then <= floor, never above the true score).
 */
function mountedScore(ai: AiSide, f: FormationState, e: FormationState, floor = -Infinity): number {
  mDangerous = false;
  if (e.unitClass === 'war_elephants') return -10;
  // A square or circle is braced on every face and has no flank: never ride into one.
  if ((e.shape === 'square' || e.shape === 'circle') && (e.unitClass === 'spearmen' || e.unitClass === 'elite_guards')) return -9;
  const engaged = engagedWithSide(ai, e);
  if (bracedAgainst(e, f) && !engaged) return -8;
  mDangerous = !engaged;
  let s = 2.5 * counterLog(f, e) - 1.5 * counterLog(e, f);
  const soft = e.unitClass === 'archers' || e.unitClass === 'engineers' || e.unitClass === 'supply_train' || e.unitClass === 'scouts';
  if (soft) s += 1.5;
  if (engaged) s += 1.6;
  if (UNITS[e.unitClass].category === 'mounted' && threatensArchers(ai, e, 160)) s += 1.5;
  // Shielded soft targets: enemy spears / guards standing close by (not in melee) would catch the horse.
  if (soft) for (let k = shieldsOf(ai, e); k > 0; k--) s -= 1.5;
  s -= dist(f, e) / 220;
  if (e.morale < 40) s += 0.5;
  if (e.index === f.target) s += 0.3;
  // Deep behind an enemy front that is not yet pinned, or across the path of its blocks: a ride to destruction.
  if (!engaged && s > floor) s -= 1.5 * dangerOnPath(ai, f, e);
  return s;
}

/**
 * How many standing enemy combat blocks (spears, guards, elephants, horse) not in melee lie within 45 m of the straight
 * ride from f to e (e itself excluded) - each would catch the riders on the way in or out.
 */
function dangerOnPath(ai: AiSide, f: FormationState, e: FormationState): number {
  let n = 0;
  const dx = e.x - f.x;
  const dz = e.z - f.z;
  const len2 = dx * dx + dz * dz || 1;
  for (const o of ai.known) {
    if (o === e || o.engagedWith.length > 0) continue;
    const c = UNITS[o.unitClass].category;
    if (c === 'ranged' || c === 'support' || o.unitClass === 'scouts') continue;
    const t = Math.max(0, Math.min(1, ((o.x - f.x) * dx + (o.z - f.z) * dz) / len2));
    const px = f.x + dx * t - o.x;
    const pz = f.z + dz * t - o.z;
    const r = 45 + Math.max(o.width, o.depth) / 2;
    if (px * px + pz * pz < r * r) n++;
  }
  return n;
}

/** Charge value of `e` for war elephants. */
function shockScore(ai: AiSide, f: FormationState, e: FormationState): number {
  if (UNITS[e.unitClass].category === 'support' && e.unitClass !== 'supply_train') return -3;
  const engaged = engagedWithSide(ai, e);
  let s = 2 * counterLog(f, e);
  if (bracedAgainst(e, f)) s -= 4;
  if (engaged) s += 1.8;
  if (UNITS[e.unitClass].category === 'mounted') s += 0.8;
  if (e.unitClass === 'archers' && !engaged) s -= 0.6;
  if (speedOf(e) > 0.4 && UNITS[e.unitClass].category === 'infantry') s += 1;
  s -= dist(f, e) / 160;
  if (e.index === f.target) s += 0.3;
  return s;
}

// ---------------------------------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------------------------------

const lineList: FormationState[] = [];

/** The field plan for this think. */
export function runField(ai: AiSide): void {
  const s = ai.state;
  thinkStamp = (thinkStamp + 1) | 0;
  memoFor(s.formations.length);
  if (typeof ai.mem.roles !== 'string') assignRoles(ai);
  if (typeof ai.mem.initStr !== 'number') ai.mem.initStr = ai.ownStr;
  if (s.phase === 'deployment') {
    if (ai.mem.deployed !== true) deploy(ai);
    return;
  }
  if (withdrawCheck(ai)) return;
  if (s.sides[ai.enemySide].withdrawn) {
    letThemGo(ai);
    return;
  }
  updatePosture(ai);
  if (futile(ai)) return;
  rallyCheck(ai);
  const posture = ai.mem.posture as string;
  // Line formations and the line geometry; a holding side's committed reserve extends the line until the melee starts.
  findEnemyFront(ai);
  lineList.length = 0;
  for (const f of ai.own) if (roleOf(ai, f) === ROLE.line) lineList.push(f);
  let lineWidth = layoutLine(ai, lineList, enemySpan(ai));
  if (ai.mem.rc !== true && shouldCommitReserve(ai, lineWidth)) ai.mem.rc = true;
  if (ai.mem.rc === true && posture !== 'attack' && !anyEngaged(ai)) {
    let added = false;
    for (const f of ai.own) {
      if (roleOf(ai, f) !== ROLE.reserve) continue;
      lineList.push(f);
      added = true;
    }
    if (added) lineWidth = layoutLine(ai, lineList, enemySpan(ai));
  }
  const halfLine = Math.max(30, lineWidth / 2);
  // Hold anchor: the deployment anchor (or the line centroid when there was no deployment phase).
  if (typeof ai.mem.ax !== 'number') {
    let x = 0;
    let z = 0;
    let n = 0;
    for (const f of lineList) {
      x += f.x;
      z += f.z;
      n++;
    }
    ai.mem.ax = n ? x / n : ai.ownX;
    ai.mem.az = n ? z / n : ai.ownZ;
    ai.mem.af = ai.facing;
  }
  if (posture === 'attack') attackLine(ai);
  else holdLine(ai);
  for (const f of ai.own) if (f.unitClass === 'elite_guards') guardShape(ai, f);
  for (const f of ai.own) {
    if (f.engagedWith.length > 0 && f.unitClass !== 'cavalry' && f.unitClass !== 'chariots') continue;
    switch (roleOf(ai, f)) {
      case ROLE.missile:
        missile(ai, f, halfLine, posture === 'attack');
        break;
      case ROLE.shock:
        elephants(ai, f, posture === 'attack');
        break;
      case ROLE.flankLeft:
      case ROLE.flankRight:
      case ROLE.screen:
        mounted(ai, f, posture === 'attack', halfLine);
        break;
      case ROLE.reserve:
        if (!lineSlots.some((sl) => sl.f === f)) reserveUnit(ai, f, ai.mem.rc === true);
        break;
      case ROLE.skirmisher:
        skirmisher(ai, f, halfLine);
        break;
      case ROLE.engineer:
      case ROLE.cart:
        support(ai, f);
        break;
      default:
        break;
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// Withdraw and rally
// ---------------------------------------------------------------------------------------------------

/** Fighting weight of own formations: soldiers x (attack + defence + ranged) x hp / 10; routers that may still rally count half. */
function baseStrength(ai: AiSide): number {
  let w = 0;
  for (const f of ai.ownAlive) {
    const st = ai.ctx.stats[f.index]!;
    const v = f.soldiers * (st.meleeAttack + st.meleeDefense + st.rangedAttack) * (st.hp / 10);
    if (f.activity !== 'routing') w += v;
    else if (f.rallies < RULES.battle.rout.maxRallies) w += 0.5 * v;
  }
  return w;
}

/**
 * withdrawAt (§10.4): the side orders withdraw_all when its fighting weight falls below `withdrawAt` of the start while
 * it is losing (its strength under 0.75 of the enemy's), on two plans in a row. A besieged garrison never withdraws.
 */
function withdrawCheck(ai: AiSide): boolean {
  const s = ai.state;
  if (s.sides[ai.side].withdrawn) return true;
  const fort = s.setup.fortification;
  if (fort && fort.defenderSide === ai.side) return false;
  const base = baseStrength(ai);
  if (typeof ai.mem.initBase !== 'number') ai.mem.initBase = base;
  const init = ai.mem.initBase as number;
  const losing = init > 0 && base < ai.profile.withdrawAt * init && ai.ownStr < 0.75 * ai.enemyStr;
  const streak = losing ? num(ai, 'wd', 0) + 1 : 0;
  ai.mem.wd = streak;
  if (streak >= 2) {
    ai.cmds.push({ kind: 'withdraw_all' });
    ai.mem.withdrew = s.time;
    return true;
  }
  return false;
}

/**
 * A side that cannot hurt the enemy - only horse / skirmishers left and none has a target worth riding at (e.g. riders
 * facing elephants) - leaves the field after 45 s instead of circling until the time limit.
 */
function futile(ai: AiSide): boolean {
  if (ai.known.length === 0) return false;
  for (const f of ai.own) {
    const c = UNITS[f.unitClass].category;
    if (c === 'infantry' || c === 'ranged' || c === 'beast') {
      ai.mem.fu = -1;
      return false;
    }
    if (c !== 'mounted') continue;
    for (const e of ai.known) {
      if (mountedScore(ai, f, e) > -2) {
        ai.mem.fu = -1;
        return false;
      }
    }
  }
  const since = num(ai, 'fu', -1);
  if (since < 0) {
    ai.mem.fu = ai.state.time;
    return false;
  }
  if (ai.state.time - since < 45) return false;
  ai.cmds.push({ kind: 'withdraw_all' });
  ai.mem.withdrew = ai.state.time;
  return true;
}

/**
 * The enemy ordered withdraw_all: the battle ends once it has disengaged (withdrawal). Foot and elephants stand (no
 * chasing a host that is leaving in order); the mounted ride down routers only.
 */
function letThemGo(ai: AiSide): void {
  for (const f of ai.own) {
    if (f.engagedWith.length > 0) continue;
    // Keep clear of the withdrawing host (its withdrawal completes once no enemy is within 150 m of it).
    const near = nearestKnown(ai, f, 165);
    if (near) {
      const dx = f.x - near.x;
      const dz = f.z - near.z;
      const d = Math.sqrt(dx * dx + dz * dz) || 1;
      tmpP.x = f.x + (dx / d) * 80;
      tmpP.z = f.z + (dz / d) * 80;
      clampToMap(ai, tmpP);
      give(ai, f, { type: 'move_to', x: tmpP.x, z: tmpP.z, facing: facingOf(-dx, -dz), run: f.fatigue < 0.5 });
      continue;
    }
    if (isMountedRole(f) && pursue(ai, f, 165)) continue;
    give(ai, f, { type: 'hold' });
  }
}

function isMountedRole(f: FormationState): boolean {
  return UNITS[f.unitClass].category === 'mounted';
}

function rallyCheck(ai: AiSide): void {
  const s = ai.state;
  const side = s.sides[ai.side];
  if (!side.commanderAlive || side.commanderFormation < 0 || s.time < side.rallyCooldownUntil) return;
  const c = s.formations[side.commanderFormation];
  if (!c || c.soldiers <= 0 || c.activity === 'routing' || c.activity === 'surrendered' || c.engagedWith.length > 0) return;
  const R = RULES.battle.commander.rallyRadius;
  let value = 0;
  for (const f of ai.ownAlive) {
    if (dist(f, c) > R) continue;
    if (f.activity === 'routing' && f.morale > RULES.battle.commander.rallyRoutersAbove - 6 && f.rallies < RULES.battle.rout.maxRallies) value += 2;
    else if (f.activity !== 'routing' && f.morale < 42 && (f.engagedWith.length > 0 || s.time - f.lastHitTime < 5)) value += 1;
  }
  if (value >= 2) ai.cmds.push({ kind: 'rally' });
}

// ---------------------------------------------------------------------------------------------------
// Line
// ---------------------------------------------------------------------------------------------------

function holdLine(ai: AiSide): void {
  const ax = num(ai, 'ax', ai.ownX);
  const az = num(ai, 'az', ai.ownZ);
  const af = num(ai, 'af', ai.facing);
  for (const sl of lineSlots) {
    const f = sl.f;
    if (f.engagedWith.length > 0) continue;
    // Help a neighbour: an enemy in melee with a friend within 60 m that nothing threatens us from the front.
    const helpT = helpTarget(ai, f, 60);
    if (helpT) {
      give(ai, f, { type: 'attack_target', target: helpT.index, run: false });
      continue;
    }
    at(ax, az, af, sl.lat, 0, tmpP);
    clampToMap(ai, tmpP);
    give(ai, f, withWidth({ type: 'move_to', x: tmpP.x, z: tmpP.z, facing: af, run: false }, f, sl.width));
  }
}

/**
 * Guards (DESIGN_SPEC §14.4 GP-01 note): in line against foot, square when horse, chariots or elephants close in (within
 * 100 m and not already locked in melee with foot); back to line once none is within 180 m. Never mid-melee.
 */
function guardShape(ai: AiSide, f: FormationState): void {
  if (f.engagedWith.length > 0 || f.shapeChangeUntil > ai.state.time) return;
  let horse = Infinity;
  for (const e of ai.known) {
    const c = UNITS[e.unitClass].category;
    if (c !== 'mounted' && c !== 'beast') continue;
    if (e.unitClass === 'scouts') continue;
    horse = Math.min(horse, gap(f, e));
  }
  if (f.shape !== 'square' && horse < 100) shape(ai, f, 'square');
  else if (f.shape === 'square' && horse > 180) shape(ai, f, 'line');
}

/** A move_to that also sets the block's frontage when it should change by more than 3 m. */
function withWidth(o: Extract<FormationOrder, { type: 'move_to' }>, f: FormationState, width: number): FormationOrder {
  if (Math.abs(width - f.width) > 3) o.width = width;
  return o;
}

/** An enemy fighting a friend within `r` m that we can hit (not braced against us), if nothing closes on us. */
function helpTarget(ai: AiSide, f: FormationState, r: number): FormationState | null {
  let best: FormationState | null = null;
  let bd = r;
  for (const e of ai.known) {
    if (!engagedWithSide(ai, e)) continue;
    const g = gap(f, e);
    if (g < bd) {
      bd = g;
      best = e;
    }
  }
  if (!best) return null;
  // Not while another enemy is closing on us head-on.
  for (const e of ai.known) if (e !== best && e.engagedWith.length === 0 && gap(f, e) < 60 && closing(f, e) > 0.4) return null;
  return best;
}

function attackLine(ai: AiSide): void {
  const nE = enemyFront.length;
  const nL = lineSlots.length;
  if (nL === 0) return;
  if (nE === 0) {
    // Enemy unseen: advance on its last known centre / zone along the axis.
    for (const sl of lineSlots) {
      at(ai.enemyX, ai.enemyZ, ai.facing, sl.lat, -60, tmpP);
      clampToMap(ai, tmpP);
      give(ai, sl.f, { type: 'move_to', x: tmpP.x, z: tmpP.z, facing: ai.facing, run: false });
    }
    return;
  }
  // Pace: blocks far ahead of the slowest wait for it while the lines are still apart.
  let minAlong = Infinity;
  for (const sl of lineSlots) if (sl.f.engagedWith.length === 0) minAlong = Math.min(minAlong, along(ai, sl.f.x, sl.f.z));
  const shift = nL >= nE ? Math.floor((nL - nE) / 2) : -Math.round((nE - nL) / 2);
  for (let i = 0; i < nL; i++) {
    const sl = lineSlots[i]!;
    const f = sl.f;
    if (f.engagedWith.length > 0) continue;
    const j = i - shift;
    const extraLeft = j < 0;
    const extraRight = j >= nE;
    const t = enemyFront[Math.min(nE - 1, Math.max(0, j))]!;
    const g = gap(f, t);
    if (extraLeft || extraRight) {
      wrapEnd(ai, f, t, extraLeft ? 'left' : 'right', g);
      continue;
    }
    if (g > 70) {
      if (g > 110 && along(ai, f.x, f.z) - minAlong > 25) {
        give(ai, f, { type: 'hold' });
        continue;
      }
      const dx = t.x - f.x;
      const dz = t.z - f.z;
      const d = Math.sqrt(dx * dx + dz * dz) || 1;
      const stand = t.depth / 2 + f.depth / 2 + 45;
      tmpP.x = t.x - (dx / d) * stand;
      tmpP.z = t.z - (dz / d) * stand;
      clampToMap(ai, tmpP);
      give(ai, f, withWidth({ type: 'move_to', x: tmpP.x, z: tmpP.z, facing: facingOf(dx, dz), run: false }, f, sl.width));
      continue;
    }
    engage(ai, f, t, g);
  }
}

/** Close with `t`: charge an unbraced target from 45 m, else walk in. */
function engage(ai: AiSide, f: FormationState, t: FormationState, g: number): void {
  if (!bracedAgainst(t, f) && g < 45 && f.fatigue < 0.45 && t.unitClass !== 'war_elephants') give(ai, f, { type: 'charge', target: t.index });
  else give(ai, f, { type: 'attack_target', target: t.index, run: false });
}

/** An extra line block beyond the enemy's end: wait beside the end, then into its flank once it is pinned. */
function wrapEnd(ai: AiSide, f: FormationState, t: FormationState, side: 'left' | 'right', g: number): void {
  // Enemy left as seen from us = the target's own right when it faces us; flank orders name the target's side.
  const tSide = flankSideOf(t, f);
  if (t.engagedWith.length > 0 || g < 40) {
    give(ai, f, { type: 'flank', target: t.index, side: tSide });
    return;
  }
  const sgn = side === 'left' ? -1 : 1;
  tmpP.x = t.x - ai.fwdX * (t.depth / 2 + f.depth / 2 + 50) + ai.rightX * sgn * (t.width / 2 + f.width / 2 + 25);
  tmpP.z = t.z - ai.fwdZ * (t.depth / 2 + f.depth / 2 + 50) + ai.rightZ * sgn * (t.width / 2 + f.width / 2 + 25);
  clampToMap(ai, tmpP);
  give(ai, f, { type: 'move_to', x: tmpP.x, z: tmpP.z, facing: facingOf(t.x - tmpP.x, t.z - tmpP.z), run: false });
}

/** Which of t's flanks (in t's own frame) `f` stands on. */
function flankSideOf(t: FormationState, f: FormationState): 'left' | 'right' {
  // t's right vector = (-cos, sin); positive projection = t's right.
  const px = (f.x - t.x) * -dcos(t.facing) + (f.z - t.z) * dsin(t.facing);
  return px >= 0 ? 'right' : 'left';
}

// ---------------------------------------------------------------------------------------------------
// Missiles
// ---------------------------------------------------------------------------------------------------

function missile(ai: AiSide, f: FormationState, halfLine: number, attacking: boolean): void {
  const st = ai.ctx.stats[f.index]!;
  if (!isShooter(st)) return;
  // Out of arrows: back behind the line (the cart resupplies).
  if (f.ammo <= 0) {
    at(num(ai, 'ax', ai.ownX), num(ai, 'az', ai.ownZ), num(ai, 'af', ai.facing), lateral(ai, f.x, f.z), -60, tmpP);
    clampToMap(ai, tmpP);
    give(ai, f, { type: 'move_to', x: tmpP.x, z: tmpP.z, facing: ai.facing, run: false });
    return;
  }
  let best: FormationState | null = null;
  let bs = -Infinity;
  for (const e of ai.known) {
    const sc = missileScore(ai, f, e, attacking ? 1.1 : 0.98, halfLine);
    if (sc > bs) {
      bs = sc;
      best = e;
    }
  }
  if (best) {
    give(ai, f, { type: 'skirmish', target: best.index });
    return;
  }
  // Nothing in range: keep station behind the line.
  const lineX = lineSlots.length ? lineCentre(true) : ai.ownX;
  const lineZ = lineSlots.length ? lineCentre(false) : ai.ownZ;
  const af = attacking ? ai.facing : num(ai, 'af', ai.facing);
  const ownMissiles = countRole(ai, ROLE.missile);
  const k = missileIndex(ai, f);
  const span = Math.max(40, halfLine * 2);
  at(lineX, lineZ, af, ((k + 0.5) / Math.max(1, ownMissiles) - 0.5) * span, -(lineDepth() / 2 + 20 + f.depth / 2), tmpP);
  clampToMap(ai, tmpP);
  give(ai, f, { type: 'move_to', x: tmpP.x, z: tmpP.z, facing: af, run: false });
}

function lineCentre(xAxis: boolean): number {
  let s = 0;
  for (const sl of lineSlots) s += xAxis ? sl.f.x : sl.f.z;
  return s / Math.max(1, lineSlots.length);
}

function lineDepth(): number {
  let d = 0;
  for (const sl of lineSlots) d = Math.max(d, sl.f.depth);
  return d;
}

function countRole(ai: AiSide, r: Role): number {
  let n = 0;
  for (const f of ai.own) if (roleOf(ai, f) === r) n++;
  return n;
}

function missileIndex(ai: AiSide, f: FormationState): number {
  let k = 0;
  for (const o of ai.own) {
    if (o === f) break;
    if (roleOf(ai, o) === ROLE.missile) k++;
  }
  return k;
}

// ---------------------------------------------------------------------------------------------------
// Elephants
// ---------------------------------------------------------------------------------------------------

function elephants(ai: AiSide, f: FormationState, attacking: boolean): void {
  let best: FormationState | null = null;
  let bs = -Infinity;
  for (const e of ai.known) {
    const sc = shockScore(ai, f, e);
    if (sc > bs) {
      bs = sc;
      best = e;
    }
  }
  // Elephants fight with the line: targets within 140 m of it (or of the elephants while holding), or blocks already in
  // melee with friends - they do not chase horse across the field.
  const lx0 = lineSlots.length ? lineCentre(true) : f.x;
  const lz0 = lineSlots.length ? lineCentre(false) : f.z;
  const nearLine = best ? Math.min(dist(best, { x: lx0, z: lz0 }), dist(best, f)) : Infinity;
  const reach = attacking ? 170 : 140;
  if (best && bs > -0.5 && (nearLine < reach || engagedWithSide(ai, best))) {
    give(ai, f, { type: 'charge', target: best.index });
    return;
  }
  // No good target: 25 m in front of the line centre (attack) or the hold anchor - behind the line once it is in melee,
  // waiting for a flank to open.
  const lx = lineSlots.length ? lineCentre(true) : ai.ownX;
  const lz = lineSlots.length ? lineCentre(false) : ai.ownZ;
  const af = attacking ? ai.facing : num(ai, 'af', ai.facing);
  const locked = lineSlots.some((sl) => sl.f.engagedWith.length > 0);
  at(attacking || locked ? lx : num(ai, 'ax', lx), attacking || locked ? lz : num(ai, 'az', lz), af, 0, locked ? -(lineDepth() / 2 + 30 + f.depth / 2) : lineDepth() / 2 + 25 + f.depth / 2, tmpP);
  clampToMap(ai, tmpP);
  give(ai, f, { type: 'move_to', x: tmpP.x, z: tmpP.z, facing: af, run: false });
}

// ---------------------------------------------------------------------------------------------------
// Mounted
// ---------------------------------------------------------------------------------------------------

let mBase = new Float64Array(64);
let mNeed = new Uint8Array(64);
/** Set by mountedScore: the score is still subject to the path check (not in melee). */
let mDangerous = false;

function mounted(ai: AiSide, f: FormationState, attacking: boolean, halfLine: number): void {
  const role = roleOf(ai, f);
  // In melee: horse does not stay in a slogging match with spears, guards or elephants - break off and re-form.
  if (f.engagedWith.length > 0) {
    for (const oi of f.engagedWith) {
      const e = ai.state.formations[oi];
      if (!e) continue;
      const bad = e.unitClass === 'spearmen' || e.unitClass === 'elite_guards' || e.unitClass === 'war_elephants';
      if (bad && f.morale < 55 && counterLog(e, f) > 0) {
        tmpP.x = f.x - ai.fwdX * 80;
        tmpP.z = f.z - ai.fwdZ * 80;
        clampToMap(ai, tmpP);
        give(ai, f, { type: 'withdraw', x: tmpP.x, z: tmpP.z });
        return;
      }
    }
    return;
  }
  // Re-forming after a break-off: let the withdraw finish.
  if (f.order.type === 'withdraw') return;
  const linesEngaged = lineSlots.some((sl) => sl.f.engagedWith.length > 0);
  // Pursuit (mounted only): routers within 400 m when the enemy is beaten or nothing better is on offer.
  // Best strike target. The path check only lowers a score, so it runs only for candidates whose other terms can still
  // beat (or tie, earlier in perception order - the plain scan's tie rule) the best so far.
  const k = ai.known.length;
  if (mBase.length < k) {
    mBase = new Float64Array(k * 2);
    mNeed = new Uint8Array(k * 2);
  }
  let top = -1;
  for (let i = 0; i < k; i++) {
    mBase[i] = mountedScore(ai, f, ai.known[i]!, Infinity);
    mNeed[i] = mDangerous ? 1 : 0;
    if (top < 0 || mBase[i]! > mBase[top]!) top = i;
  }
  let best: FormationState | null = null;
  let bs = -Infinity;
  let bi = -1;
  // The best base first (it sets a high bar), then every other candidate that could still beat or tie it.
  for (let j = -1; j < k; j++) {
    const i = j < 0 ? top : j;
    if (i < 0 || (j >= 0 && i === top)) continue;
    if (mBase[i]! < bs || (mBase[i] === bs && i > bi)) continue;
    const sc = mNeed[i] ? mBase[i]! - 1.5 * dangerOnPath(ai, f, ai.known[i]!) : mBase[i]!;
    if (sc > bs || (sc === bs && i < bi)) {
      bs = sc;
      best = ai.known[i]!;
      bi = i;
    }
  }
  const beaten = ai.ownStr > 2 * ai.enemyStr;
  // Riding down routers keeps them from rallying - once the lines are locked, the enemy is beaten or nothing better offers.
  if ((bs < 0.5 || beaten || linesEngaged) && !(best && UNITS[best.unitClass].category === 'mounted' && threatensArchers(ai, best, 160)) && pursue(ai, f)) return;
  const flanker = role === ROLE.flankLeft || role === ROLE.flankRight;
  const strikeOk = best !== null && bs > 0.8;
  // Screens strike threats to the archers at once; flankers strike when the lines are engaged or they are in place;
  // a holding side strikes only targets of opportunity (aggression = chance to attack rather than hold).
  if (strikeOk && best) {
    const threat = UNITS[best.unitClass].category === 'mounted' && threatensArchers(ai, best, 160);
    const opportunity = !attacking && !linesEngaged ? rollOpportunity(ai, f, best) : true;
    const inPlace = flanker ? atStaging(ai, f, role === ROLE.flankLeft ? -1 : 1) : true;
    if (threat || (opportunity && (linesEngaged || inPlace || (attacking && dist(f, best) < 200)))) {
      strike(ai, f, best);
      return;
    }
  }
  // Station: flankers wide of the enemy's end, screens on the own wings.
  const sgn = role === ROLE.flankLeft ? -1 : role === ROLE.flankRight ? 1 : lateral(ai, f.x, f.z) < 0 ? -1 : 1;
  if (flanker && attacking) stagingPoint(ai, f, sgn, tmpP);
  else {
    const lx = lineSlots.length ? lineCentre(true) : ai.ownX;
    const lz = lineSlots.length ? lineCentre(false) : ai.ownZ;
    const af = attacking ? ai.facing : num(ai, 'af', ai.facing);
    at(attacking ? lx : num(ai, 'ax', lx), attacking ? lz : num(ai, 'az', lz), af, sgn * (halfLine + 30 + f.width / 2), -15, tmpP);
  }
  clampToMap(ai, tmpP);
  give(ai, f, { type: 'move_to', x: tmpP.x, z: tmpP.z, facing: facingOf(ai.enemyX - tmpP.x, ai.enemyZ - tmpP.z), run: false });
}

/** Wide of the enemy front's end on our `sgn` wing (-1 left, +1 right), level with its front. */
function stagingPoint(ai: AiSide, f: FormationState, sgn: number, out: { x: number; z: number }): void {
  const end = sgn < 0 ? enemyFront[0] : enemyFront[enemyFront.length - 1];
  if (!end) {
    at(ai.enemyX, ai.enemyZ, ai.facing, sgn * 160, -120, out);
    return;
  }
  out.x = end.x - ai.fwdX * (end.depth / 2 + 40) + ai.rightX * sgn * (end.width / 2 + f.width / 2 + 70);
  out.z = end.z - ai.fwdZ * (end.depth / 2 + 40) + ai.rightZ * sgn * (end.width / 2 + f.width / 2 + 70);
}

function atStaging(ai: AiSide, f: FormationState, sgn: number): boolean {
  stagingPoint(ai, f, sgn, tmpP);
  return dist(f, tmpP) < 40;
}

/** Charge soft / mounted targets, flank blocks already in melee. */
function strike(ai: AiSide, f: FormationState, e: FormationState): void {
  const soft = UNITS[e.unitClass].category !== 'infantry';
  if (!soft && e.engagedWith.length > 0 && !facesToward2(e, f)) give(ai, f, { type: 'charge', target: e.index });
  else if (!soft) give(ai, f, { type: 'flank', target: e.index, side: flankSideOf(e, f) });
  else give(ai, f, { type: 'charge', target: e.index });
}

function facesToward2(e: FormationState, f: FormationState): boolean {
  const dx = f.x - e.x;
  const dz = f.z - e.z;
  const d = Math.sqrt(dx * dx + dz * dz) || 1;
  return (dx * dsin(e.facing) + dz * dcos(e.facing)) / d > 0.3;
}

/** One roll per (formation, target): does a holding side's rider take this opportunity? */
function rollOpportunity(ai: AiSide, f: FormationState, e: FormationState): boolean {
  const key = `p${f.index}`;
  const prev = ai.mem[key];
  if (typeof prev === 'string' && prev.startsWith(`${e.index}:`)) return prev.endsWith('y');
  const yes = ai.rng.next() < ai.profile.aggression;
  ai.mem[key] = `${e.index}:${yes ? 'y' : 'n'}`;
  return yes;
}

/**
 * Ride down the nearest router within 400 m (not one sheltering by a steady enemy: spears / guards within 30 m, or any
 * standing enemy within `shelter` m).
 */
function pursue(ai: AiSide, f: FormationState, shelter = 0): boolean {
  let best: FormationState | null = null;
  let bd = 400;
  for (const r of ai.routers) {
    const d = gap(f, r);
    if (d >= bd) continue;
    let covered = false;
    for (const e of ai.known) if (((e.unitClass === 'spearmen' || e.unitClass === 'elite_guards') && gap(e, r) < 30) || gap(e, r) < shelter) covered = true;
    if (covered) continue;
    bd = d;
    best = r;
  }
  if (!best) return false;
  if (bd > 50) {
    tmpP.x = best.x + best.vx * 4;
    tmpP.z = best.z + best.vz * 4;
    clampToMap(ai, tmpP);
    give(ai, f, { type: 'move_to', x: tmpP.x, z: tmpP.z, facing: null, run: true });
  } else give(ai, f, { type: 'attack_target', target: best.index, run: true });
  return true;
}

// ---------------------------------------------------------------------------------------------------
// Reserve, skirmishers, support
// ---------------------------------------------------------------------------------------------------

function shouldCommitReserve(ai: AiSide, lineWidth: number): boolean {
  const s = ai.state;
  // The enemy front overlaps the line (by more than a block) and is closing: extend / refuse the flank in time.
  if (enemyFront.length > 0 && enemySpan(ai) > lineWidth + 20) {
    let nearest = Infinity;
    for (const e of enemyFront) nearest = Math.min(nearest, along(ai, e.x, e.z));
    if (nearest < 320) return true;
  }
  let engaged = 0;
  for (const sl of lineSlots) {
    const f = sl.f;
    if (f.engagedWith.length === 0) continue;
    engaged++;
    if (f.morale < 45) return true;
    for (const oi of f.engagedWith) {
      const e = s.formations[oi];
      if (e && !facesToward2(f, e)) return true; // hit in the flank / rear
    }
  }
  for (const e of ai.known) if (UNITS[e.unitClass].category !== 'ranged' && threatensArchers(ai, e, 70)) return true;
  if (lineSlots.length > 0 && engaged === lineSlots.length) return true;
  const contact = num(ai, 'contact', -1);
  if (contact >= 0 && s.time - contact > 45) return true;
  if (ai.ownStr > 1.8 * ai.enemyStr && ai.known.length > 0) return true;
  return false;
}

function reserveUnit(ai: AiSide, f: FormationState, committed: boolean): void {
  if (!committed) {
    const lx = lineSlots.length ? lineCentre(true) : ai.ownX;
    const lz = lineSlots.length ? lineCentre(false) : ai.ownZ;
    const posture = ai.mem.posture;
    const af = posture === 'attack' ? ai.facing : num(ai, 'af', ai.facing);
    const k = reserveIndex(ai, f);
    at(posture === 'attack' ? lx : num(ai, 'ax', lx), posture === 'attack' ? lz : num(ai, 'az', lz), af, (k - 0.5 * (countRole(ai, ROLE.reserve) - 1)) * (f.width + 12), -150, tmpP);
    clampToMap(ai, tmpP);
    // A threat to the reserve itself is met where it stands.
    const near = nearestKnown(ai, f, 40);
    if (near) {
      give(ai, f, { type: 'attack_target', target: near.index, run: false });
      return;
    }
    give(ai, f, { type: 'move_to', x: tmpP.x, z: tmpP.z, facing: af, run: false });
    return;
  }
  // Committed: the most dangerous enemy - one hitting a friend's flank, else one fighting the weakest friend, else the
  // nearest overlap / threat to the archers.
  let best: FormationState | null = null;
  let bs = -Infinity;
  for (const e of ai.known) {
    let sc = -dist(f, e) / 80 + 1.5 * counterLog(f, e) - 1.2 * counterLog(e, f);
    for (const oi of e.engagedWith) {
      const o = ai.state.formations[oi];
      if (!o || o.side !== ai.side) continue;
      sc += 1.5 + (60 - Math.min(60, o.morale)) / 20;
      if (!facesToward2(o, e)) sc += 2;
    }
    if (UNITS[e.unitClass].category !== 'ranged' && threatensArchers(ai, e, 90)) sc += 2;
    if (bracedAgainst(e, f)) sc -= 0.5;
    if (sc > bs) {
      bs = sc;
      best = e;
    }
  }
  if (!best) return;
  if (best.engagedWith.length > 0 && gap(f, best) < 80) {
    const side = flankSideOf(best, f);
    give(ai, f, gap(f, best) < 30 ? { type: 'attack_target', target: best.index, run: false } : { type: 'flank', target: best.index, side });
  } else engage(ai, f, best, gap(f, best));
}

function reserveIndex(ai: AiSide, f: FormationState): number {
  let k = 0;
  for (const o of ai.own) {
    if (o === f) break;
    if (roleOf(ai, o) === ROLE.reserve) k++;
  }
  return k;
}

function nearestKnown(ai: AiSide, f: FormationState, maxGap: number): FormationState | null {
  let best: FormationState | null = null;
  let bd = maxGap;
  for (const e of ai.known) {
    const g = gap(f, e);
    if (g < bd) {
      bd = g;
      best = e;
    }
  }
  return best;
}

function skirmisher(ai: AiSide, f: FormationState, halfLine: number): void {
  if (pursue(ai, f) && ai.ownStr > 1.5 * ai.enemyStr) return;
  // Harass what javelins hurt (elephants panic, carts, engineers, archers), from a distance; never into melee.
  let best: FormationState | null = null;
  let bs = -Infinity;
  const st = ai.ctx.stats[f.index]!;
  for (const e of ai.known) {
    if (f.ammo <= 0 || !isShooter(st)) break;
    let sc = 2 * counterLog(f, e) - dist(f, e) / 150;
    if (e.unitClass === 'war_elephants') sc += 1.5;
    if (UNITS[e.unitClass].category === 'mounted' && e.unitClass !== 'scouts') sc -= 3;
    if (bracedAgainst(e, f) || e.unitClass === 'elite_guards') sc -= 0.5;
    if (sc > bs) {
      bs = sc;
      best = e;
    }
  }
  if (best && bs > 0 && dist(f, best) < 300) {
    give(ai, f, { type: 'skirmish', target: best.index });
    return;
  }
  if (pursue(ai, f)) return;
  const sgn = lateral(ai, f.x, f.z) < 0 ? -1 : 1;
  const lx = lineSlots.length ? lineCentre(true) : ai.ownX;
  const lz = lineSlots.length ? lineCentre(false) : ai.ownZ;
  at(lx, lz, ai.facing, sgn * (halfLine + 15), 40, tmpP);
  clampToMap(ai, tmpP);
  give(ai, f, { type: 'move_to', x: tmpP.x, z: tmpP.z, facing: ai.facing, run: false });
}

function support(ai: AiSide, f: FormationState): void {
  if (f.unitClass === 'supply_train') {
    // Resupply the archers lowest on arrows (below half, not in melee, within 300 m).
    let best: FormationState | null = null;
    let low = 0.5;
    for (const o of ai.own) {
      const st = ai.ctx.stats[o.index]!;
      if (!isShooter(st) || o.engagedWith.length > 0 || o.unitClass === 'supply_train') continue;
      const share = o.ammo / Math.max(1, st.ammo);
      if (share < low && dist(f, o) < 300) {
        low = share;
        best = o;
      }
    }
    if (best && !nearestKnown(ai, best, 80)) {
      give(ai, f, { type: 'resupply', target: best.index });
      return;
    }
  }
  // Keep well behind the line, away from enemies.
  const lx = lineSlots.length ? lineCentre(true) : ai.ownX;
  const lz = lineSlots.length ? lineCentre(false) : ai.ownZ;
  const af = ai.mem.posture === 'attack' ? ai.facing : num(ai, 'af', ai.facing);
  const near = nearestKnown(ai, f, 90);
  const back = near ? 160 : 100;
  at(lx, lz, af, 0, -back, tmpP);
  clampToMap(ai, tmpP);
  give(ai, f, { type: 'move_to', x: tmpP.x, z: tmpP.z, facing: af, run: near !== null });
}

/** Strength share of a side still standing vs its start (for reports). */
export function strengthShare(ai: AiSide): number {
  const init = num(ai, 'initStr', ai.ownStr);
  return init > 0 ? ai.ownStr / init : 1;
}

/** Re-export for the siege module: an order helper that respects the current plan. */
export function orderUnit(ai: AiSide, f: FormationState, o: FormationOrder): void {
  give(ai, f, o);
}

export { formationStrength, stance };
