/**
 * Siege battle AI (DESIGN_SPEC §6.6.5, §6.1 siege deploy zones; SIM-02 spec 1 "siege attack / defence"). OWNER: AI
 * Engineer - Battle AI, Intents & Campaign AI (SIM-02).
 *
 * Attack (the side outside the ring). The plan is laid along the approach axis of the target gate (the main gate while
 * it stands): the ram's path to the gate is kept clear, everything else stands to the sides of it.
 *  - Wall reach: every known wall shooter (an enemy shooter with arrows on or inside the walls) reaches its effective
 *    range (walls x1.2, tower x1.2 - projectiles.ts, + the height bonus) plus SIEGE_AI.standoffMargin (15 m). Points
 *    beyond that are "out of bow shot".
 *  - Engineer works: the first engineer formation builds the ram out of bow shot on the approach axis; the next ones
 *    raise a palisade (40 s, 20 m, 300 HP) 15 m in front of each pair of archer firing slots; once the archers have
 *    closed, free engineers raise ladders against the segments flanking the gate. A ram whose crew routed is taken over
 *    by the next free engineer formation (construct 'ram' at the abandoned ram re-crews it).
 *  - The ram waits out of bow shot until its cover is ready (the palisades are up, or there is nobody left to build
 *    them, or SIEGE_AI.coverWaitSec has passed), then goes in on the axis to the gate. Elephants go in with it (or at
 *    once when no ram is coming) and batter the gate (siege x soldiers HP/s).
 *  - Archers stand off beyond the walls' reach, in loose order, on both sides of the axis, until the ram is within
 *    SIEGE_AI.commitRamDist (60 m) of the gate, ladders are up or there is a way in; then they close to their firing
 *    slots behind the palisades (SIEGE_AI.fireShare x their range from the wall shooters over the gate) and shoot the
 *    defenders there.
 *  - Infantry waits out of bow shot behind the archers until the gate breaks, a wall falls or ladders are up, then
 *    storms: the first block in holds the inside of the breach (siege victory after 60 s uncontested, `breachHold`),
 *    the others fight the defenders contesting it. Stormers have right of way: every other formation keeps
 *    SIEGE_AI.corridor (40 m) clear of the breach approach. The mounted stay outside, on the flanks, against sallies.
 *  - Withdrawal (the reason is kept in the side's plan memory, `withdrawReason`): nothing left to breach the walls with
 *    (no engineer, elephant, crewed ram, breach or ladder) for 30 s; or the assault is spent (below
 *    SIEGE_AI.spentShare of its starting strength with no way in yet).
 * Defence (the garrison):
 *  - Archers man the intact towers nearest the threatened point (breach, ladder, the gate under attack) first - the
 *    nearest free archer to each tower, towers in order of distance from the threat, as long as the threat is within
 *    their range from there - then fan along the wall walk around the threat (orders.ts keeps them at their post).
 *  - Spears and guards defend the inside of the threatened point (radius 35-45 m).
 *  - Engineers repair the most damaged intact gate (+10 HP/s).
 *  - Sally: mounted (else guards) ride out through an intact gate against a ram crew or engineers at work within 150 m
 *    of the walls when nothing stronger guards them, and come back inside afterwards.
 * Plan memory (BattleSideState.aiMemory): `sgPhase` (prepare / approach / cover / storm), `sgRamDone`, `sgRun`,
 * `hopeless`, `withdrawReason`, `sgStart` (starting strength).
 */
import type { EngineerWorkState, FormationState } from '../../../core/types';
import { dcos, dsin, facingOf, PI } from '../../../core/math';
import { UNITS } from '../../../data/units';
import type { FortGeometry } from '../fort';
import { angleFromCenter, distFromCenter, GATE_HALF_WIDTH, ringPoint, segmentMidAngle } from '../fort';
import { effectiveRange } from '../projectiles';
import { breachPoint } from '../siege';
import { isShooter } from '../stats';
import type { AiSide } from './common';
import { dist, formationStrength, gap, give, logPlan, shape, stance } from './common';

/** Siege plan numbers (SIM-02 review round 1, Creative Director rules). */
export const SIEGE_AI = {
  /** Out of bow shot: beyond every wall shooter's effective range plus this (m). */
  standoffMargin: 15,
  /** The archers close once the ram is this near the gate (m), or ladders are up, or there is a way in. */
  commitRamDist: 60,
  /** A palisade stands this far in front of the archers' front edge (m). */
  palisadeAhead: 15,
  /** Formations that do not storm keep this clear of the breach approach (m) - the stormers' right of way. */
  corridor: 40,
  /** Firing slot: this share of the archers' effective range from the wall shooters over the gate. */
  fireShare: 0.85,
  /** A finished ram waits at most this long (s) for its palisade cover before it goes in. */
  coverWaitSec: 90,
  /** Screen blocks (melee blocks walking ahead of the ram to draw the walls' volleys). */
  screens: 2,
  /** The screen stands this far nearer the walls than the leading batterer (m). */
  screenLead: 22,
  /** ... but never nearer the wall face than this (m, plus half its depth). */
  screenMinOut: 6,
  /** Half width of the ram's lane the screen keeps clear (m). */
  lane: 14,
  /** A screen block falls back to regroup below this share of its men or below screenMorale... */
  screenKeep: 0.6,
  screenMorale: 40,
  /** ... and only blocks above this share (and screenMorale + 10) take the screen. */
  screenFresh: 0.75,
  /** The stormers gather this far outside the way in (m) ... */
  stageOut: 45,
  /** ... and go in together once gathered, or after this long (s). */
  stageSec: 60,
  /** Without a way in, the assault withdraws below this share of its starting strength. */
  spentShare: 0.35,
  /** ... and after this long (s) with nothing left to breach the walls with. */
  hopelessSec: 30,
} as const;

const p = { x: 0, z: 0 };
const q = { x: 0, z: 0 };

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
// Wall reach (what the walls can shoot) - rebuilt every think from the side's own knowledge
// ---------------------------------------------------------------------------------------------------

/** Known enemy shooters (with arrows) on or inside the walls and their effective range (no height term). */
const shooters: FormationState[] = [];
const shooterReach: number[] = [];
const shooterH: number[] = [];

function collectShooters(ai: AiSide, g: FortGeometry): void {
  shooters.length = 0;
  shooterReach.length = 0;
  shooterH.length = 0;
  for (const e of ai.known) {
    if (e.ammo <= 0 || !isShooter(ai.ctx.stats[e.index]!)) continue;
    if (distFromCenter(g, e.x, e.z) > g.radius + 3) continue;
    shooters.push(e);
    shooterReach.push(effectiveRange(ai.state, ai.ctx, e, null));
    shooterH.push(ai.terrain.heightAt(e.x, e.z));
  }
}

/** Is (x, z) within bow shot of a wall shooter (+ the stand-off margin + `margin`)? */
function exposed(ai: AiSide, x: number, z: number, margin: number): boolean {
  if (shooters.length === 0) return false;
  const h = ai.terrain.heightAt(x, z);
  for (let i = 0; i < shooters.length; i++) {
    const e = shooters[i]!;
    const dh = shooterH[i]! - h;
    // projectiles.ts height bonus: x (1 + 0.1 x dh / 10) for a shooter above its target.
    const r = shooterReach[i]! * (dh > 0 ? 1 + 0.01 * dh : 1) + SIEGE_AI.standoffMargin + margin;
    const dx = e.x - x;
    const dz = e.z - z;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

/** Smallest t >= t0 (5 m steps, at most 600 m further) with (ox, oz) + t x (dx, dz) out of bow shot. */
function standoff(ai: AiSide, ox: number, oz: number, dx: number, dz: number, t0: number, margin: number): number {
  let t = t0;
  for (let k = 0; k < 120 && exposed(ai, ox + dx * t, oz + dz * t, margin); k++) t += 5;
  return t;
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

/** The approach axis: the target gate (or way in) point and its outward / sideways unit vectors. */
interface Axis {
  /** Target gate index (-1: none intact). */
  gate: number;
  /** Point on the ring the assault goes for (gate, breach or ladder). */
  x: number;
  z: number;
  /** Outward radial unit vector at that point. */
  ux: number;
  uz: number;
  /** Sideways unit vector (along the wall). */
  vx: number;
  vz: number;
  /** Facing toward the walls along the axis. */
  inward: number;
}

const axis: Axis = { gate: -1, x: 0, z: 0, ux: 0, uz: 1, vx: -1, vz: 0, inward: PI };

/** Target gate: the main gate while it stands, else the intact gate nearest the attackers. */
function targetGate(ai: AiSide, g: FortGeometry): number {
  const s = ai.state.siege!;
  if (s.gates[0] && s.gates[0].hp > 0) return 0;
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < s.gates.length; i++) {
    if (s.gates[i]!.hp <= 0) continue;
    ringPoint(g, g.gateAngle[i]!, g.radius, p);
    const d = (p.x - ai.ownX) * (p.x - ai.ownX) + (p.z - ai.ownZ) * (p.z - ai.ownZ);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

function setAxis(g: FortGeometry, a: number, gate: number): void {
  ringPoint(g, a, g.radius, p);
  axis.gate = gate;
  axis.x = p.x;
  axis.z = p.z;
  axis.ux = dsin(a);
  axis.uz = dcos(a);
  axis.vx = -dcos(a);
  axis.vz = dsin(a);
  axis.inward = a + PI;
}

/** Point t m out from the axis point and l m to the side. */
function onAxis(t: number, l: number, out: { x: number; z: number }): { x: number; z: number } {
  out.x = axis.x + axis.ux * t + axis.vx * l;
  out.z = axis.z + axis.uz * t + axis.vz * l;
  return out;
}

/** Lateral offset of a point from the axis line (signed). */
function lateralOf(x: number, z: number): number {
  return (x - axis.x) * axis.vx + (z - axis.z) * axis.vz;
}

/** Distance out along the axis (negative = inside the ring). */
function outwardOf(x: number, z: number): number {
  return (x - axis.x) * axis.ux + (z - axis.z) * axis.uz;
}

function setPhase(ai: AiSide, phase: string, why: string): void {
  if (ai.mem.sgPhase === phase) return;
  ai.mem.sgPhase = phase;
  logPlan(ai, `siege attack: ${phase} - ${why}`);
}

function withdraw(ai: AiSide, reason: string): void {
  if (ai.state.sides[ai.side].withdrawn) return;
  ai.mem.withdrawReason = reason;
  setPhase(ai, 'withdraw', reason);
  ai.cmds.push({ kind: 'withdraw_all' });
}

const engineers: FormationState[] = [];
const elephants: FormationState[] = [];
const archers: FormationState[] = [];
const melee: FormationState[] = [];
const mounted: FormationState[] = [];
const stormers: FormationState[] = [];
const screens: FormationState[] = [];
const batterers: FormationState[] = [];
const ordered: FormationState[] = [];

/**
 * Keep `list` in a stable left-to-right order across thinks (memory `key`: formation indices). Newcomers are slotted by
 * their lateral position, so formations take the posts on their own side of the axis and do not cross each other.
 */
function rowOrder(ai: AiSide, key: string, list: FormationState[]): void {
  ordered.length = 0;
  const prev = typeof ai.mem[key] === 'string' && (ai.mem[key] as string).length > 0 ? (ai.mem[key] as string).split(',') : [];
  for (const id of prev) {
    const f = list.find((m) => m.index === Number(id));
    if (f) ordered.push(f);
  }
  for (const f of list) {
    if (ordered.includes(f)) continue;
    const l = lateralOf(f.x, f.z);
    let k = 0;
    while (k < ordered.length && lateralOf(ordered[k]!.x, ordered[k]!.z) > l) k++;
    ordered.splice(k, 0, f);
  }
  list.length = 0;
  for (const f of ordered) list.push(f);
  const sig = list.map((f) => f.index).join(',');
  if (ai.mem[key] !== sig) ai.mem[key] = sig;
}

/** A melee block fit to screen: fresh enough to stand the walls' volleys (a hurt one falls back to regroup). */
function screenFit(f: FormationState, keep: boolean): boolean {
  const share = f.soldiers / Math.max(1, f.maxSoldiers);
  return keep ? share >= SIEGE_AI.screenKeep && f.morale >= SIEGE_AI.screenMorale : share >= SIEGE_AI.screenFresh && f.morale >= SIEGE_AI.screenMorale + 10;
}

/** Screen blocks kept in memory (`sgScreen`) while fit; refilled from the strongest fit melee blocks. */
function pickScreens(ai: AiSide): void {
  screens.length = 0;
  const prev = typeof ai.mem.sgScreen === 'string' && (ai.mem.sgScreen as string).length > 0 ? (ai.mem.sgScreen as string).split(',') : [];
  for (const id of prev) {
    const f = melee.find((m) => m.index === Number(id));
    if (f && screens.length < SIEGE_AI.screens && screenFit(f, true)) screens.push(f);
  }
  // Keep one block back when there are 3+ (the storm's first wave).
  const want = Math.min(SIEGE_AI.screens, melee.length >= 3 ? melee.length - 1 : melee.length);
  while (screens.length < want) {
    let best: FormationState | null = null;
    for (const f of melee) {
      if (screens.includes(f) || !screenFit(f, false)) continue;
      if (!best || f.soldiers > best.soldiers) best = f;
    }
    if (!best) break;
    screens.push(best);
  }
  // Left-to-right by position (screen 0 takes the + side).
  screens.sort((a, b) => lateralOf(b.x, b.z) - lateralOf(a.x, a.z) || a.index - b.index);
  const sig = screens.map((f) => f.index).join(',');
  if (ai.mem.sgScreen !== sig) ai.mem.sgScreen = sig;
}

function attack(ai: AiSide, g: FortGeometry): void {
  const s = ai.state;
  const siege = s.siege!;
  engineers.length = 0;
  elephants.length = 0;
  archers.length = 0;
  melee.length = 0;
  mounted.length = 0;
  stormers.length = 0;
  batterers.length = 0;
  for (const f of ai.own) {
    if (f.unitClass === 'engineers') engineers.push(f);
    else if (f.unitClass === 'war_elephants') elephants.push(f);
    else if (UNITS[f.unitClass].category === 'ranged' && isShooter(ai.ctx.stats[f.index]!)) archers.push(f);
    else if (UNITS[f.unitClass].category === 'infantry') melee.push(f);
    else if (f.unitClass !== 'supply_train') mounted.push(f);
  }
  if (typeof ai.mem.sgStart !== 'number') ai.mem.sgStart = Math.max(1, ai.ownStr);
  collectShooters(ai, g);
  const kind = assaultPoint(ai, g, q);
  const target = { x: q.x, z: q.z };
  const gi = targetGate(ai, g);
  if (kind) setAxis(g, angleFromCenter(g, target.x, target.z), gi);
  else if (gi >= 0) setAxis(g, g.gateAngle[gi]!, gi);
  else setAxis(g, g.mainAngle, -1);
  rowOrder(ai, 'sgRowM', melee);
  rowOrder(ai, 'sgRowA', archers);
  rowOrder(ai, 'sgRowH', mounted);
  rowOrder(ai, 'sgRowE', engineers);

  // --- Rams: one crewed (its crew standing - siege.ts drops the crew of a ram whose engineers rout) is a tool; an
  // abandoned one is a tool only while an engineer formation is left to take it over.
  let ram: EngineerWorkState | null = null;
  let building: EngineerWorkState | null = null;
  let abandoned: EngineerWorkState | null = null;
  for (const w of s.works) {
    if (w.side !== ai.side || w.work !== 'ram' || w.hp <= 0) continue;
    if (w.progress < 1) building ??= w;
    else if (w.formation >= 0 && s.formations[w.formation]?.soldiers) ram ??= w;
    else abandoned ??= w;
  }
  const crew = ram ? s.formations[ram.formation]! : null;
  if (ram && typeof ai.mem.sgRamDone !== 'number') {
    ai.mem.sgRamDone = s.time;
    logPlan(ai, 'siege attack: the ram is ready');
  }

  // --- Withdrawal: nothing left to breach the walls with, or the assault is spent before it found a way in.
  const hasTools = engineers.length > 0 || elephants.length > 0 || ram !== null;
  if (!kind && !hasTools) {
    if (typeof ai.mem.hopeless !== 'number') ai.mem.hopeless = s.time;
    if (s.time - (ai.mem.hopeless as number) > SIEGE_AI.hopelessSec) {
      withdraw(ai, 'nothing left to breach the walls with (no engineers, elephants, crewed ram, breach or ladder)');
      return;
    }
  } else delete ai.mem.hopeless;
  if (!kind && ai.ownStr < SIEGE_AI.spentShare * (ai.mem.sgStart as number)) {
    withdraw(ai, `the assault is spent (${Math.round((100 * ai.ownStr) / (ai.mem.sgStart as number))}% of its strength left and no way in)`);
    return;
  }

  // --- Geometry of this think: out of bow shot on the axis, the archers' slots and their palisades.
  const tOff = standoff(ai, axis.x, axis.z, axis.ux, axis.uz, 30, 12);
  const laddersUp = siege.segments.some((x) => x.ladder && x.hp > 0);
  // Wall shooter over the gate the archers aim at (else the gate itself, on the wall walk).
  let aimX = axis.x - axis.ux * 12;
  let aimZ = axis.z - axis.uz * 12;
  let ad = 90;
  for (const e of shooters) {
    const d = dist(e, axis);
    if (d < ad) {
      ad = d;
      aimX = e.x;
      aimZ = e.z;
    }
  }
  const slots = archerSlots(ai, aimX, aimZ);
  const palisades = shooters.length > 0 ? Math.ceil(archers.length / 2) : 0;
  let palisadesPending = 0;
  let palisadeOut = Infinity;
  for (let k = 0; k < palisades; k++) {
    if (!palisadeDone(ai, k, slots)) palisadesPending++;
    palisadeSite(k, slots, p);
    palisadeOut = Math.min(palisadeOut, outwardOf(p.x, p.z));
  }
  // The ram site (kept while it stays out of bow shot: the builders do not chase a moving point).
  if (typeof ai.mem.sgRamX !== 'number' || exposed(ai, ai.mem.sgRamX as number, ai.mem.sgRamZ as number, 6) || ai.mem.sgGate !== axis.gate) {
    onAxis(tOff, 0, p);
    ai.mem.sgRamX = Math.round(p.x);
    ai.mem.sgRamZ = Math.round(p.z);
    ai.mem.sgGate = axis.gate;
  }
  const ramX = ai.mem.sgRamX as number;
  const ramZ = ai.mem.sgRamZ as number;
  const ramOut = Math.max(tOff, outwardOf(ramX, ramZ));

  // --- The batterers: the crewed ram and the elephants. The way in is battered from the gate.
  if (crew && axis.gate >= 0) batterers.push(crew);
  for (const f of elephants) if (axis.gate >= 0 && !kind) batterers.push(f);
  const noRamComing = !ram && !building && !(abandoned && engineers.length > 0) && !engineers.some((f) => f.order.type === 'construct' && f.order.work === 'ram');
  // Batterer nearest the walls (outward distance along the axis).
  let lead = Infinity;
  for (const f of batterers) lead = Math.min(lead, outwardOf(f.x, f.z));
  const ramDist = crew ? dist(crew, axis) : Infinity;
  const committed = kind !== null || laddersUp || ramDist <= SIEGE_AI.commitRamDist || (crew === null && elephants.length > 0 && lead <= SIEGE_AI.commitRamDist);

  // --- The screen: the freshest melee blocks walk ahead of the batterers and draw the walls' volleys (wall shooters
  // loose at the nearest enemy, and their quivers run dry) - first in front of the palisade sites while those go up,
  // then ahead of the ram. A block worn below SIEGE_AI.screenKeep falls back out of bow shot and another takes over.
  pickScreens(ai);
  const toolsReady = ram !== null || (noRamComing && elephants.length > 0);
  const screened = shooters.length > 0 && screens.length > 0 && !kind && toolsReady;
  const screenOut = Math.max(30, Math.min(tOff - 20, palisadeOut - 30));
  let screenPosted = !screened;
  if (screened) {
    screenPosted = true;
    for (let i = 0; i < screens.length; i++) {
      screenPost(i, screens[i]!, screenOut, p);
      if (dist(screens[i]!, p) > 25) screenPosted = false;
    }
    if (screenPosted && typeof ai.mem.sgScreenAt !== 'number') ai.mem.sgScreenAt = s.time;
  }

  // --- Phase: prepare (ram building) -> screen (the screen walks out, palisades go up behind it) -> approach (the ram
  // and the elephants go in behind the screen) -> cover (the ram is within commitRamDist: archers close) -> storm.
  let going = typeof ai.mem.sgRun === 'number';
  if (!going && toolsReady && !kind) {
    const waited = typeof ai.mem.sgScreenAt === 'number' ? s.time - (ai.mem.sgScreenAt as number) : 0;
    const builders = engineers.some((f) => f !== crew);
    if (screenPosted && (palisadesPending === 0 || !builders || waited >= SIEGE_AI.coverWaitSec)) {
      ai.mem.sgRun = s.time;
      going = true;
    }
  }
  if (kind) setPhase(ai, 'storm', kind === 'breach' ? 'the way in is open' : 'ladders are up');
  else if (committed) setPhase(ai, 'cover', laddersUp ? 'ladders are up: the archers close to their palisades' : 'the ram is near the gate: the archers close to their palisades');
  else if (going) setPhase(ai, 'approach', `${crew ? 'the ram goes' : 'the elephants go'} in behind the screen${palisadesPending === 0 && palisades > 0 ? ' (palisades up)' : ''}`);
  else if (toolsReady) setPhase(ai, 'screen', screened ? 'the screen walks out to draw the walls’ arrows; palisades go up behind it' : 'palisades go up');
  else setPhase(ai, 'prepare', 'the ram is built out of bow shot');

  // --- Engineers.
  let ramJob = !ram && !building && axis.gate >= 0 && kind !== 'breach';
  let recrew = ramJob ? abandoned : null;
  if (recrew) ramJob = false;
  let wait = 0;
  for (const f of engineers) {
    if (f === crew || f.engagedWith.length > 0) continue;
    const busy = f.order.type === 'construct' ? f.order : null;
    if (busy && busy.work === 'ram' && building && dist(building, busy) < 8) continue; // building the ram
    if (recrew) {
      give(ai, f, { type: 'construct', work: 'ram', x: recrew.x, z: recrew.z, facing: recrew.facing });
      recrew = null;
      continue;
    }
    if (ramJob) {
      give(ai, f, { type: 'construct', work: 'ram', x: ramX, z: ramZ, facing: axis.inward });
      ramJob = false;
      continue;
    }
    // A palisade for each pair of archer slots still without one (one engineer formation per palisade), once the screen
    // stands in front of the sites (or there is no screen).
    if (busy && busy.work === 'palisade' && !palisadeAt(ai, busy.x, busy.z, true)) continue;
    if (toolsReady && screenPosted) {
      let k = -1;
      for (let j = 0; j < palisades && k < 0; j++) if (!palisadeDone(ai, j, slots) && !palisadeClaimed(ai, j, slots)) k = j;
      if (k >= 0) {
        palisadeSite(k, slots, p);
        give(ai, f, { type: 'construct', work: 'palisade', x: p.x, z: p.z, facing: slots.face[2 * k]! });
        continue;
      }
    }
    // Ladders once the archers cover the walls: segments either side of the gate's segment (alternating).
    if (committed && axis.gate >= 0 && kind !== 'breach' && ladder(ai, g, f)) continue;
    // Otherwise wait out of bow shot beside the ram site, ready to take over a ram.
    const side = wait++ % 2 === 0 ? 1 : -1;
    onAxis(ramOut + 10, side * (SIEGE_AI.lane + 30 + f.width / 2), p);
    give(ai, f, { type: 'move_to', x: p.x, z: p.z, facing: axis.inward, run: false });
  }

  // --- Batterers: out of bow shot (the elephants behind the ram) until the cover is ready, then in to the gate.
  for (const f of batterers) {
    if (f.engagedWith.length > 0) continue;
    if (f.unitClass === 'war_elephants') {
      const out = nearestOutside(ai, g, f, 90);
      if (out) {
        give(ai, f, { type: 'charge', target: out.index });
        continue;
      }
    }
    const gate = axis.gate;
    if (going || committed) {
      ringPoint(g, g.gateAngle[gate]!, g.radius + 4 + f.depth / 2, p);
      give(ai, f, { type: 'move_to', x: p.x, z: p.z, facing: g.gateAngle[gate]! + PI, run: false });
    } else if (f === crew) {
      onAxis(Math.max(ramOut, outwardOf(f.x, f.z)), 0, p);
      give(ai, f, { type: 'move_to', x: p.x, z: p.z, facing: axis.inward, run: false });
    } else {
      onAxis(ramOut + 22 + f.depth / 2, 0, p);
      give(ai, f, { type: 'move_to', x: p.x, z: p.z, facing: axis.inward, run: false });
    }
  }
  // Elephants with a way in storm.
  for (const f of elephants) if (!batterers.includes(f) && f.engagedWith.length === 0 && kind) stormers.push(f);

  // --- Screen posts: ahead of the batterers once they go in, else in front of the palisade sites.
  if (screened) {
    for (let i = 0; i < screens.length; i++) {
      const f = screens[i]!;
      if (f.engagedWith.length > 0) continue;
      const out = going || committed ? Math.max(SIEGE_AI.screenMinOut + f.depth / 2, Math.min(screenOut, lead - SIEGE_AI.screenLead)) : screenOut;
      screenPost(i, f, out, p);
      give(ai, f, { type: 'move_to', x: p.x, z: p.z, facing: axis.inward, run: false });
    }
  }

  // --- Archers: out of bow shot (loose) until the ram is close to the gate / ladders are up; then their firing slots.
  for (let i = 0; i < archers.length; i++) {
    const f = archers[i]!;
    if (f.engagedWith.length > 0) continue;
    if (shooters.length > 0) shape(ai, f, 'loose');
    const fx = slots.x[i]!;
    const fz = slots.z[i]!;
    const face = slots.face[i]!;
    if (committed) {
      give(ai, f, { type: 'move_to', x: fx, z: fz, facing: face, run: false });
    } else {
      // Back along the slot's line (away from the aim point) until out of bow shot.
      const bx = dsin(face + PI);
      const bz = dcos(face + PI);
      const t = standoff(ai, fx, fz, bx, bz, 0, f.depth / 2 + 4);
      give(ai, f, { type: 'move_to', x: fx + bx * t, z: fz + bz * t, facing: face, run: false });
    }
  }
  // --- Infantry: the screen as above; the others wait in a row out of bow shot behind the ram site, and storm once
  // there is a way in.
  let rowW = 0;
  for (const f of melee) rowW += f.width + 10;
  let rowL = rowW / 2;
  for (const f of melee) {
    const l = rowL - f.width / 2 - 5;
    rowL -= f.width + 10;
    if (f.engagedWith.length > 0) continue;
    if (kind) {
      stormers.push(f);
      continue;
    }
    const near = nearestOutside(ai, g, f, 60);
    if (near) {
      give(ai, f, { type: 'attack_target', target: near.index, run: false });
      continue;
    }
    if (screened && screens.includes(f)) continue;
    onAxis(ramOut + 45 + f.depth / 2, l, p);
    give(ai, f, { type: 'move_to', x: p.x, z: p.z, facing: axis.inward, run: false });
  }
  if (kind) storming(ai, g, target);
  // --- Mounted: outside, on the flanks of the axis (left half left, right half right), against sallies.
  for (let i = 0; i < mounted.length; i++) {
    const f = mounted[i]!;
    if (f.engagedWith.length > 0) continue;
    const out = nearestOutside(ai, g, f, 250);
    if (out) {
      give(ai, f, { type: 'charge', target: out.index });
      continue;
    }
    const right = i < mounted.length / 2;
    const k = right ? i : mounted.length - 1 - i;
    // Lateral +: the side of (vx, vz); an angle step around the ring clockwise moves along -v.
    const a = angleFromCenter(g, axis.x, axis.z) + (right ? -1 : 1) * (0.35 + 0.1 * k);
    const r = standoff(ai, g.cx, g.cz, dsin(a), dcos(a), g.radius + 40, f.depth / 2 + 6);
    ringPoint(g, a, r, p);
    give(ai, f, { type: 'move_to', x: p.x, z: p.z, facing: a + PI, run: false });
  }
  // --- Right of way: once there is a way in, every formation that does not storm keeps the approach clear.
  if (kind) {
    for (const f of ai.own) {
      if (f.engagedWith.length > 0 || stormers.includes(f)) continue;
      clearCorridor(ai, f);
    }
  }
}

/** Post of screen block i at `out` m along the axis: blocks side by side, clear of the batterers' lane. */
function screenPost(i: number, f: FormationState, out: number, o: { x: number; z: number }): { x: number; z: number } {
  // At the wall the blocks stand beside the gate; further out they leave the ram's lane free.
  const lane = out < 25 ? GATE_HALF_WIDTH + 6 : SIEGE_AI.lane;
  const side = i % 2 === 0 ? 1 : -1;
  const l = side * (lane + f.width / 2 + Math.floor(i / 2) * (f.width + 6));
  return onAxis(out, l, o);
}

/**
 * The storm: the stormers gather SIEGE_AI.stageOut m outside the way in (side by side, out of the corridor's middle)
 * and go in together once gathered or after SIEGE_AI.stageSec; those already inside fight on. The one nearest the way in
 * holds the inside of the breach, the others fight the defenders contesting it.
 */
function storming(ai: AiSide, g: FortGeometry, target: { x: number; z: number }): void {
  const s = ai.state;
  stormers.sort((a, b) => dist(a, target) - dist(b, target) || a.index - b.index);
  if (typeof ai.mem.sgStage !== 'number') {
    ai.mem.sgStage = s.time;
    logPlan(ai, `siege attack: ${stormers.length} stormers gather before the way in`);
  }
  let gathered = true;
  for (let i = 0; i < stormers.length; i++) {
    const f = stormers[i]!;
    if (distFromCenter(g, f.x, f.z) < g.radius - 4 || f.engagedWith.length > 0) continue;
    stagePost(i, f, p);
    if (dist(f, p) > 30) gathered = false;
  }
  const go = ai.mem.sgGo === true || gathered || s.time - (ai.mem.sgStage as number) >= SIEGE_AI.stageSec;
  if (go && ai.mem.sgGo !== true) {
    ai.mem.sgGo = true;
    logPlan(ai, `siege attack: the storm goes in (${gathered ? 'all gathered' : 'the wait is over'})`);
  }
  for (let i = 0; i < stormers.length; i++) {
    const f = stormers[i]!;
    const inside = distFromCenter(g, f.x, f.z) < g.radius - 4;
    if (!go && !inside) {
      stagePost(i, f, p);
      give(ai, f, { type: 'move_to', x: p.x, z: p.z, facing: axis.inward, run: false });
      continue;
    }
    storm(ai, g, f, target, i === 0);
  }
}

/** Gathering post of stormer i before the way in. */
function stagePost(i: number, f: FormationState, o: { x: number; z: number }): { x: number; z: number } {
  const k = i === 0 ? 0 : (i % 2 === 1 ? 1 : -1) * Math.ceil(i / 2);
  return onAxis(SIEGE_AI.stageOut + f.depth / 2 + Math.floor(Math.abs(k) / 2) * 12, k * (f.width + 8), o);
}

/** Firing slots of the archers (two per palisade, pairs alternating sides of the axis) and their facings. */
interface Slots {
  x: number[];
  z: number[];
  face: number[];
  /** Lateral offset of each slot from the axis. */
  l: number[];
}
const slotBuf: Slots = { x: [], z: [], face: [], l: [] };

function archerSlots(ai: AiSide, aimX: number, aimZ: number): Slots {
  const sl = slotBuf;
  sl.x.length = 0;
  sl.z.length = 0;
  sl.face.length = 0;
  sl.l.length = 0;
  const side = [0, 0];
  for (let i = 0; i < archers.length; i++) {
    const f = archers[i]!;
    const pair = Math.floor(i / 2);
    const s = pair % 2 === 0 ? 1 : -1;
    const k = s > 0 ? 0 : 1;
    // Edge of the corridor plus the formations already placed on this side.
    const w = Math.max(f.width, UNITS[f.unitClass].stats.menPerFormation * 0.4);
    const l = s * (SIEGE_AI.corridor + side[k]! + w / 2);
    side[k] = side[k]! + w + 8;
    // Distance out along the axis that puts the aim point at fireShare x range from the slot.
    const r = SIEGE_AI.fireShare * Math.min(ai.ctx.stats[f.index]!.range, effectiveRange(ai.state, ai.ctx, f, null));
    const dx = axis.x - aimX + axis.vx * l;
    const dz = axis.z - aimZ + axis.vz * l;
    const b = dx * axis.ux + dz * axis.uz;
    const c = dx * dx + dz * dz - r * r;
    const disc = b * b - c;
    const t = disc > 0 ? Math.max(20, -b + Math.sqrt(disc)) : 20;
    onAxis(t, l, p);
    sl.x.push(p.x);
    sl.z.push(p.z);
    sl.face.push(facingOf(aimX - p.x, aimZ - p.z));
    sl.l.push(l);
  }
  return sl;
}

/** Palisade k: 15 m in front of the front edge of archer slots 2k / 2k + 1 (their middle). */
function palisadeSite(k: number, sl: Slots, out: { x: number; z: number }): { x: number; z: number } {
  const a = 2 * k;
  const b = Math.min(sl.x.length - 1, a + 1);
  const mx = (sl.x[a]! + sl.x[b]!) / 2;
  const mz = (sl.z[a]! + sl.z[b]!) / 2;
  const f = archers[a]!;
  const ahead = Math.max(f.depth, 10) / 2 + SIEGE_AI.palisadeAhead;
  out.x = mx + dsin(sl.face[a]!) * ahead;
  out.z = mz + dcos(sl.face[a]!) * ahead;
  return out;
}

/** An own palisade (finished, or any when `any`) within 10 m of (x, z). */
function palisadeAt(ai: AiSide, x: number, z: number, finished: boolean): EngineerWorkState | null {
  for (const w of ai.state.works) {
    if (w.side !== ai.side || w.work !== 'palisade' || w.hp <= 0) continue;
    if (finished && w.progress < 1) continue;
    if ((w.x - x) * (w.x - x) + (w.z - z) * (w.z - z) <= 100) return w;
  }
  return null;
}

function palisadeDone(ai: AiSide, k: number, sl: Slots): boolean {
  palisadeSite(k, sl, p);
  return palisadeAt(ai, p.x, p.z, true) !== null;
}

/** Another engineer formation already builds palisade k. */
function palisadeClaimed(ai: AiSide, k: number, sl: Slots): boolean {
  palisadeSite(k, sl, p);
  for (const f of engineers) {
    const o = f.order;
    if (o.type === 'construct' && o.work === 'palisade' && (o.x - p.x) * (o.x - p.x) + (o.z - p.z) * (o.z - p.z) <= 100) return true;
  }
  return false;
}

/** Ladders on the segments either side of the gate's segment (alternating by formation), skipping laddered ones. */
function ladder(ai: AiSide, g: FortGeometry, f: FormationState): boolean {
  const siege = ai.state.siege!;
  const seg0 = g.gateSegment[axis.gate]!;
  for (let k = 1; k <= g.segments / 2; k++) {
    const seg = (seg0 + (f.index % 2 === 1 ? k : -k) + g.segments) % g.segments;
    const st = siege.segments[seg]!;
    if (st.ladder || st.hp <= 0) continue;
    const a = segmentMidAngle(seg, g.segments);
    ringPoint(g, a, g.radius + 8, p);
    give(ai, f, { type: 'construct', work: 'ladder', x: p.x, z: p.z, facing: a + PI });
    return true;
  }
  return false;
}

/** Step aside out of the breach approach (SIEGE_AI.corridor m from the axis, outside the ring). */
function clearCorridor(ai: AiSide, f: FormationState): void {
  const t = outwardOf(f.x, f.z);
  if (t < -6) return; // inside the ring: not in the approach
  const l = lateralOf(f.x, f.z);
  const need = SIEGE_AI.corridor + f.width / 2;
  if (Math.abs(l) >= need) return;
  const s = l >= 0 ? 1 : -1;
  onAxis(Math.max(t, 15 + f.depth / 2), s * (need + 6), p);
  give(ai, f, { type: 'move_to', x: p.x, z: p.z, facing: axis.inward, run: true });
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
  // Contesting defenders within 70 m of the breach: fight them (the holder only those inside 40 m).
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

const dArchers: FormationState[] = [];
const dMelee: FormationState[] = [];
const dMounted: FormationState[] = [];
const dEngineers: FormationState[] = [];
const towerOrder: number[] = [];
const manned: FormationState[] = [];

function defend(ai: AiSide, g: FortGeometry): void {
  const s = ai.state;
  const siege = s.siege!;
  const tp = { x: 0, z: 0 };
  const level = threatPoint(ai, g, tp);
  const ta = angleFromCenter(g, tp.x, tp.z);
  dArchers.length = 0;
  dMelee.length = 0;
  dMounted.length = 0;
  dEngineers.length = 0;
  manned.length = 0;
  for (const f of ai.own) {
    if (f.unitClass === 'engineers') dEngineers.push(f);
    else if (UNITS[f.unitClass].category === 'ranged' && isShooter(ai.ctx.stats[f.index]!)) dArchers.push(f);
    else if (UNITS[f.unitClass].category === 'mounted') dMounted.push(f);
    else if (f.unitClass !== 'supply_train') dMelee.push(f);
  }
  // --- Archers: the intact towers nearest the threat first (nearest free archer to each), then the wall walk.
  towerOrder.length = 0;
  for (let t = 0; t < siege.towers.length; t++) if (siege.towers[t]!.hp > 0) towerOrder.push(t);
  towerOrder.sort((x, y) => Math.abs(angleDiff(g.towerAngle[x]!, ta)) - Math.abs(angleDiff(g.towerAngle[y]!, ta)) || x - y);
  for (const t of towerOrder) {
    if (manned.length >= dArchers.length) break;
    const a = g.towerAngle[t]!;
    ringPoint(g, a, g.radius, p);
    // A tower is worth manning only while the threat is within bow shot from it.
    let best: FormationState | null = null;
    let bd = Infinity;
    for (const f of dArchers) {
      if (manned.includes(f) || f.engagedWith.length > 0) continue;
      const d = dist(f, p);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    if (!best) break;
    if (dist(p, tp) > 0.9 * ai.ctx.stats[best.index]!.range) break;
    manned.push(best);
    ringPoint(g, a, g.radius - 9 - best.depth / 2, p);
    if (dist(best, p) > 6) give(ai, best, { type: 'move_to', x: p.x, z: p.z, facing: a, run: false });
  }
  let slot = 0;
  for (const f of dArchers) {
    if (manned.includes(f) || f.engagedWith.length > 0) continue;
    const i = slot++;
    if (f.activity === 'shooting' && f.ammo > 0 && Math.abs(angleDiff(angleFromCenter(g, f.x, f.z), ta)) < 0.9) continue;
    const k = i === 0 ? 0 : (i % 2 === 1 ? 1 : -1) * Math.ceil(i / 2);
    const a = ta + (k * (f.width + 10)) / g.radius + (level === 2 ? 0.25 * (i % 2 === 0 ? 1 : -1) : 0);
    ringPoint(g, a, g.radius - 9 - f.depth / 2, p);
    give(ai, f, { type: 'move_to', x: p.x, z: p.z, facing: a, run: false });
  }
  // --- Sally against a ram crew / engineers at work near the walls.
  const sallyTarget = sallyCandidate(ai, g);
  const sallyForce = dMounted.length > 0 ? dMounted : dMelee.filter((f) => f.unitClass === 'elite_guards' && !f.hasCommander);
  for (const f of sallyForce) {
    if (f.engagedWith.length > 0) continue;
    if (sallyTarget && formationStrength(s, f) > 0.7 * guardStrength(ai, sallyTarget)) {
      give(ai, f, { type: 'attack_target', target: sallyTarget.index, run: true });
      ai.mem.sally = s.time;
    }
  }
  // --- Melee: defend the inside of the threatened point; mounted not sallying wait in the middle.
  dMelee.forEach((f, i) => {
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
  for (const f of dMounted) {
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
  for (const f of dEngineers) {
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
function guardStrength(ai: AiSide, t: FormationState): number {
  let s = 0;
  for (const e of ai.known) if (gap(e, t) < 60) s += formationStrength(ai.state, e);
  return s;
}
