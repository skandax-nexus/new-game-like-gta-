/**
 * Local (soldier-level) simulation - GDD §9 third level. OWNER: Gameplay Engineer - Tactical Battle Simulation (GP-01).
 * Baseline by the CTO.
 *
 * The soldier layer VISUALIZES the authoritative formation state; it never changes outcomes:
 *  - spawn(): one soldier per formation member on its slot (formations.ts slot convention), with role flags:
 *    standard bearer (front rank middle), drummer and conch blower (formations with a standard), officers (front rank
 *    ends), the commander (second rank middle of the commander's formation) and `mounted` for riders / crews.
 *  - Casualties decided by combat.ts are realized here: in melee the soldiers nearest the enemy fall (front ranks),
 *    under arrows a random soldier; the soldier behind steps forward into the gap (files stay full, the rear rank
 *    thins). Roles pass to a neighbour when their holder dies; a routing formation drops its standard (flag cleared)
 *    and raises it again when it rallies. A shape / frontage change re-slots everyone front-first (they walk to it).
 *  - Animation (SOLDIER_ANIM + animVariant + animStart; animTime kept for the procedural renderer): idle / walk / run
 *    by speed, charge while the formation charges, attack (3 variants, staggered) in the contact ranks, brace for
 *    spears and guards facing a charge and for the rear ranks of a spear wall, shoot synced to the formation's volley
 *    (the release frame lands on the launch tick) then reload until the next volley, work for engineers building,
 *    rout (scattering toward the formation's flight), hit flinches next to fresh casualties, die (2 variants) -> dead,
 *    cheer for the victors.
 *  - Separation between neighbours near the camera; LOD scheduling by distance to the camera focus: near every step
 *    (20 Hz), mid every 2nd (10 Hz), far every 4th (5 Hz), culled every 8th.
 * No per-step allocations. Uses its own cosmetic RNG (seeded from the battle seed), never state.rng.
 */
import type { BattleState, FormationState, Rect, SoldierBuffers, TerrainQuery, Vec2 } from '../../core/types';
import { SOLDIER_ANIM, SOLDIER_FLAG, SOLDIER_LOD, UNIT_CLASS_INDEX } from '../../core/types';
import { Rng, deriveSeed } from '../../core/rng';
import { SpatialHash2D } from '../../core/spatial';
import { approachAngle, dcos, dsin, facingOf } from '../../core/math';
import { UNITS } from '../../data/units';
import { shapeMods } from './stats';

export function createSoldierBuffers(capacity: number): SoldierBuffers {
  return {
    capacity,
    count: 0,
    posX: new Float32Array(capacity),
    posY: new Float32Array(capacity),
    posZ: new Float32Array(capacity),
    prevX: new Float32Array(capacity),
    prevY: new Float32Array(capacity),
    prevZ: new Float32Array(capacity),
    facing: new Float32Array(capacity),
    prevFacing: new Float32Array(capacity),
    velX: new Float32Array(capacity),
    velZ: new Float32Array(capacity),
    anim: new Uint8Array(capacity),
    animTime: new Float32Array(capacity),
    animSpeed: new Float32Array(capacity).fill(1),
    formation: new Uint16Array(capacity),
    slot: new Uint16Array(capacity),
    side: new Uint8Array(capacity),
    unitClass: new Uint8Array(capacity),
    alive: new Uint8Array(capacity),
    lod: new Uint8Array(capacity),
    variant: new Uint8Array(capacity),
    flags: new Uint8Array(capacity),
    target: new Int32Array(capacity).fill(-1),
    deathTime: new Float32Array(capacity),
    animVariant: new Uint8Array(capacity),
    animStart: new Float32Array(capacity),
  };
}

export interface SoldierSimOptions {
  /** LOD distances (m) from the camera focus. */
  lodNear: number;
  lodMid: number;
  lodFar: number;
}

/** Seconds from the start of the 'shoot' clip to the release (the volley's launch tick). */
export const SHOOT_RELEASE_SEC = 0.55;
/** Length of the shoot clip before falling back to reload (s). */
export const SHOOT_CLIP_SEC = 1.2;
/** Die clip length before the corpse pose (s). */
export const DIE_CLIP_SEC = 1.4;
/** Hit flinch length (s). */
export const HIT_CLIP_SEC = 0.35;

const ROLE_MASK = SOLDIER_FLAG.commander | SOLDIER_FLAG.standardBearer | SOLDIER_FLAG.drummer | SOLDIER_FLAG.officer | SOLDIER_FLAG.conch;
const neighbors = new Int32Array(24);
const tmp: Vec2 = { x: 0, z: 0 };

export class SoldierSim {
  readonly buffers: SoldierBuffers;
  private readonly fStart: Int32Array;
  private readonly fCount: Int32Array;
  private readonly fAlive: Int32Array;
  private readonly fFiles: Int32Array;
  private readonly fRanks: Int32Array;
  private readonly fShape: Int8Array;
  private readonly fRouting: Uint8Array;
  private readonly fVolley: Float64Array;
  /** Per-formation slot -> soldier index (block of 2 x count entries starting at 2 x fStart). */
  private readonly slotMap: Int32Array;
  /** Banner role holder lost (dropped standard) - per formation, to restore on rally. */
  private readonly fDropped: Uint8Array;
  private readonly hash: SpatialHash2D;
  private readonly rng: Rng;
  private stepIndex = 0;

  constructor(state: BattleState, bounds: Rect) {
    let total = 0;
    for (const f of state.formations) total += Math.max(0, f.soldiers);
    this.buffers = createSoldierBuffers(Math.max(1, total));
    const n = state.formations.length;
    this.fStart = new Int32Array(n);
    this.fCount = new Int32Array(n);
    this.fAlive = new Int32Array(n);
    this.fFiles = new Int32Array(n);
    this.fRanks = new Int32Array(n);
    this.fShape = new Int8Array(n);
    this.fRouting = new Uint8Array(n);
    this.fVolley = new Float64Array(n).fill(-1);
    this.fDropped = new Uint8Array(n);
    this.slotMap = new Int32Array(Math.max(2, total * 2 + n * 2)).fill(-1);
    this.hash = new SpatialHash2D(bounds, 4, this.buffers.capacity);
    this.rng = new Rng(deriveSeed(state.setup.seed, 'soldiers'));
  }

  /** Create soldiers on their formation slots (call once after createBattle / when attaching to a running battle). */
  spawn(state: BattleState, terrain: TerrainQuery): void {
    const b = this.buffers;
    let i = 0;
    for (const f of state.formations) {
      const count = Math.max(0, f.soldiers);
      this.fStart[f.index] = i;
      this.fCount[f.index] = count;
      this.fAlive[f.index] = count;
      this.fFiles[f.index] = f.files;
      this.fRanks[f.index] = f.ranks;
      this.fShape[f.index] = shapeIndex(f);
      this.fRouting[f.index] = f.activity === 'routing' ? 1 : 0;
      this.fDropped[f.index] = 0;
      const cls = UNIT_CLASS_INDEX[f.unitClass];
      const mounted = isMountedVisual(f);
      const base = this.slotBase(f.index);
      for (let s = 0; s < count * 2; s++) this.slotMap[base + s] = -1;
      for (let s = 0; s < count; s++, i++) {
        this.slotPosition(f, s, tmp);
        b.posX[i] = b.prevX[i] = tmp.x;
        b.posZ[i] = b.prevZ[i] = tmp.z;
        b.posY[i] = b.prevY[i] = terrain.heightAt(tmp.x, tmp.z);
        b.facing[i] = b.prevFacing[i] = f.facing;
        b.velX[i] = 0;
        b.velZ[i] = 0;
        b.anim[i] = SOLDIER_ANIM.idle;
        b.animSpeed[i] = 0.9 + this.rng.next() * 0.2;
        b.animStart[i] = state.time - this.rng.next() * 2;
        b.animTime[i] = (state.time - b.animStart[i]!) * b.animSpeed[i]!;
        b.animVariant[i] = 0;
        b.formation[i] = f.index;
        b.slot[i] = s;
        this.slotMap[base + s] = i;
        b.side[i] = f.side;
        b.unitClass[i] = cls;
        b.alive[i] = 1;
        b.lod[i] = SOLDIER_LOD.near;
        b.variant[i] = this.rng.int(0, 255);
        b.flags[i] = (mounted ? SOLDIER_FLAG.mounted : 0) | roleFor(f, s);
        b.target[i] = -1;
        b.deathTime[i] = 0;
      }
      if (f.activity === 'routing') this.dropStandard(f);
    }
    b.count = i;
  }

  private slotBase(fi: number): number {
    return 2 * (this.fStart[fi] as number) + 2 * fi;
  }

  /** World position of slot `s` of f (same convention as formations.ts slotWorldPosition, inlined constants). */
  private slotPosition(f: FormationState, s: number, out: Vec2): Vec2 {
    const st = UNITS[f.unitClass].stats;
    const spread = shapeMods(f.shape).spread;
    const files = Math.max(1, f.files);
    const ranks = Math.max(1, f.ranks);
    const file = s % files;
    const rank = Math.floor(s / files);
    let lx = (file - (files - 1) / 2) * st.spacingX * spread;
    let lz = ((ranks - 1) / 2 - rank) * st.spacingZ * spread;
    if (f.shape === 'wedge') lz -= Math.abs(lx) * 0.6 - files * st.spacingX * spread * 0.15;
    else if (f.shape === 'circle' && f.soldiers > 6) {
      const ringCap = Math.max(6, Math.round(files * 2.2));
      const ring = Math.floor(s / ringCap);
      const idx = s % ringCap;
      const r = (1 + ring) * st.spacingZ * 1.4 + 2;
      const a = (idx / ringCap) * 6.283185307179586;
      lx = dsin(a) * r;
      lz = dcos(a) * r;
    }
    const sn = dsin(f.facing);
    const cs = dcos(f.facing);
    out.x = f.x + lx * -cs + lz * sn;
    out.z = f.z + lx * sn + lz * cs;
    return out;
  }

  /** Advance the soldier layer by dt. focus = camera ground focus for LOD. */
  step(state: BattleState, dt: number, terrain: TerrainQuery, focusX: number, focusZ: number, opts: SoldierSimOptions): void {
    const b = this.buffers;
    this.stepIndex++;
    b.prevX.set(b.posX);
    b.prevY.set(b.posY);
    b.prevZ.set(b.posZ);
    b.prevFacing.set(b.facing);
    const time = state.time;
    for (const f of state.formations) {
      if (f.index >= this.fStart.length) continue;
      this.syncLayout(f);
      this.syncCasualties(state, f);
      this.syncRoles(f);
    }
    this.markVolleys(state);
    this.hash.build(b.count, b.posX, b.posZ, b.alive);
    const near2 = opts.lodNear * opts.lodNear;
    const mid2 = opts.lodMid * opts.lodMid;
    const far2 = opts.lodFar * opts.lodFar;
    const outcome = state.outcome;

    for (const f of state.formations) {
      const fi = f.index;
      if (fi >= this.fStart.length) continue;
      const start = this.fStart[fi]!;
      const end = start + this.fCount[fi]!;
      const def = UNITS[f.unitClass];
      const st = def.stats;
      const maxSpeed = st.runSpeed * 1.3;
      const routing = f.activity === 'routing';
      const surrendered = f.activity === 'surrendered';
      const engaged = f.engagedWith.length > 0 && !routing;
      const charging = f.activity === 'charging' || (f.panicUntil > time && f.unitClass === 'war_elephants');
      const working = f.activity === 'constructing' && f.unitClass === 'engineers';
      const cheering = !!outcome && outcome.winner === f.side && !routing && !surrendered;
      const shooter = st.rangedAttack > 0 && st.range > 0;
      const volleyAt = this.fVolley[fi]!;
      const reloading = shooter && f.ammo > 0 && f.target >= 0 && f.reload > 0 && !engaged && f.activity !== 'moving';
      const bracing = !engaged && canBraceVisual(f) && chargedBy(state, f);
      const spearWall = engaged && canBraceVisual(f);
      let enemyFacing = f.facing;
      let ex = f.x;
      let ez = f.z;
      if (engaged) {
        const e = state.formations[f.engagedWith[0]!];
        if (e) {
          enemyFacing = facingOf(e.x - f.x, e.z - f.z);
          ex = e.x;
          ez = e.z;
        }
      }
      const files = Math.max(1, f.files);
      const sn = dsin(enemyFacing);
      const cs = dcos(enemyFacing);
      for (let i = start; i < end; i++) {
        if (!b.alive[i]) {
          if (b.anim[i] === SOLDIER_ANIM.die && time - b.deathTime[i]! > DIE_CLIP_SEC) this.setAnim(i, SOLDIER_ANIM.dead, b.animVariant[i]!, time, time);
          b.animTime[i] += dt;
          continue;
        }
        const dxF = b.posX[i]! - focusX;
        const dzF = b.posZ[i]! - focusZ;
        const d2 = dxF * dxF + dzF * dzF;
        const lod = d2 < near2 ? SOLDIER_LOD.near : d2 < mid2 ? SOLDIER_LOD.mid : d2 < far2 ? SOLDIER_LOD.far : SOLDIER_LOD.culled;
        b.lod[i] = lod;
        const every = lod === SOLDIER_LOD.near ? 1 : lod === SOLDIER_LOD.mid ? 2 : lod === SOLDIER_LOD.far ? 4 : 8;
        b.animTime[i] += dt * b.animSpeed[i]!;
        if ((this.stepIndex + i) % every !== 0) continue;
        const sdt = dt * every;
        const slot = b.slot[i]!;
        const rank = Math.floor(slot / files);

        // --- Target position.
        let tx: number;
        let tz: number;
        this.slotPosition(f, slot, tmp);
        if (routing) {
          const v = b.variant[i]! / 255;
          const jitter = (v - 0.5) * 1.4;
          const away = f.facing + jitter * 0.5;
          // Loose scatter around the fleeing block, running ahead of it.
          tx = tmp.x + (tmp.x - f.x) * 0.6 + dsin(away) * 6;
          tz = tmp.z + (tmp.z - f.z) * 0.6 + dcos(away) * 6;
        } else {
          tx = tmp.x;
          tz = tmp.z;
          if (engaged && rank < 2) {
            // Contact ranks press toward the enemy and sway with the fight.
            const sway = dsin(time * 2.1 + (b.variant[i]! / 255) * 6.283) * 0.35;
            tx += sn * (0.8 + sway);
            tz += cs * (0.8 + sway);
          }
        }
        let vx = (tx - b.posX[i]!) * 2.2;
        let vz = (tz - b.posZ[i]!) * 2.2;
        if (lod === SOLDIER_LOD.near) {
          const r = st.radius * 2.2;
          const nn = this.hash.queryRadius(b.posX[i]!, b.posZ[i]!, r, neighbors, b.posX, b.posZ);
          for (let q = 0; q < nn; q++) {
            const j = neighbors[q] as number;
            if (j === i) continue;
            const sx = b.posX[i]! - b.posX[j]!;
            const sz = b.posZ[i]! - b.posZ[j]!;
            const dd = sx * sx + sz * sz;
            if (dd < 1e-4 || dd > r * r) continue;
            const dist = Math.sqrt(dd);
            const push = (r - dist) * 3;
            vx += (sx / dist) * push;
            vz += (sz / dist) * push;
          }
        }
        const sp = Math.sqrt(vx * vx + vz * vz);
        if (sp > maxSpeed) {
          vx = (vx / sp) * maxSpeed;
          vz = (vz / sp) * maxSpeed;
        }
        if (surrendered) {
          vx = 0;
          vz = 0;
        }
        b.velX[i] = vx;
        b.velZ[i] = vz;
        b.posX[i] = b.posX[i]! + vx * sdt;
        b.posZ[i] = b.posZ[i]! + vz * sdt;
        b.posY[i] = terrain.heightAt(b.posX[i]!, b.posZ[i]!);
        const speed = Math.min(sp, maxSpeed);
        const wantFacing = speed > 0.6 && !engaged ? facingOf(vx, vz) : engaged ? facingOf(ex - b.posX[i]!, ez - b.posZ[i]!) : f.facing;
        b.facing[i] = approachAngle(b.facing[i]!, wantFacing, 6 * sdt);

        // --- Animation.
        const cur = b.anim[i]!;
        let anim: number = SOLDIER_ANIM.idle;
        if (cheering) anim = SOLDIER_ANIM.cheer;
        else if (surrendered) anim = SOLDIER_ANIM.idle;
        else if (routing) anim = SOLDIER_ANIM.rout;
        else if (cur === SOLDIER_ANIM.hit && time - b.animStart[i]! < HIT_CLIP_SEC) anim = SOLDIER_ANIM.hit;
        else if (charging && speed > st.walkSpeed) anim = SOLDIER_ANIM.charge;
        else if (engaged) anim = rank < 2 ? SOLDIER_ANIM.attack : spearWall ? SOLDIER_ANIM.brace : SOLDIER_ANIM.idle;
        else if (working) anim = SOLDIER_ANIM.work;
        else if (shooter && volleyAt >= 0 && time - volleyAt < SHOOT_CLIP_SEC - SHOOT_RELEASE_SEC) anim = SOLDIER_ANIM.shoot;
        else if (speed > st.walkSpeed * 1.35) anim = SOLDIER_ANIM.run;
        else if (speed > 0.25) anim = SOLDIER_ANIM.walk;
        else if (bracing) anim = SOLDIER_ANIM.brace;
        else if (reloading) anim = SOLDIER_ANIM.reload;
        if (anim !== cur) {
          if (anim === SOLDIER_ANIM.shoot) {
            // The release frame lands on the volley's launch tick, with a ragged +-0.15 s spread.
            this.setAnim(i, anim, 0, volleyAt - SHOOT_RELEASE_SEC + ((b.variant[i]! / 255) - 0.5) * 0.3, time);
          } else if (anim === SOLDIER_ANIM.attack) this.setAnim(i, anim, b.variant[i]! % 3, time - (b.variant[i]! / 255) * 1.2, time);
          else if (anim === SOLDIER_ANIM.cheer) this.setAnim(i, anim, 0, time - (b.variant[i]! / 255) * 0.8, time);
          else this.setAnim(i, anim, 0, time, time);
        }
        b.animSpeed[i] =
          anim === SOLDIER_ANIM.walk || anim === SOLDIER_ANIM.run || anim === SOLDIER_ANIM.charge || anim === SOLDIER_ANIM.rout
            ? Math.max(0.6, speed / (anim === SOLDIER_ANIM.walk ? st.walkSpeed : st.runSpeed))
            : 0.9 + (b.variant[i]! / 255) * 0.2;
      }
    }
  }

  /** Switch anim; `start` = battle time the clip started (may be in the past for staggering / sync), `now` = battle time. */
  private setAnim(i: number, anim: number, variant: number, start: number, now: number): void {
    const b = this.buffers;
    b.anim[i] = anim;
    b.animVariant[i] = variant;
    b.animStart[i] = start;
    b.animTime[i] = Math.max(0, now - start);
  }

  /** Volleys launched this step (shoot sync). */
  private markVolleys(state: BattleState): void {
    const vs = state.volleys;
    for (let k = 0; k < vs.length; k++) {
      const v = vs[k]!;
      if (v.launchTime > state.time - 0.051 && v.shooter < this.fVolley.length) this.fVolley[v.shooter] = v.launchTime;
    }
  }

  /** Re-slot a formation front-first when its files / ranks / shape changed. */
  private syncLayout(f: FormationState): void {
    const fi = f.index;
    const sh = shapeIndex(f);
    if (this.fFiles[fi] === f.files && this.fRanks[fi] === f.ranks && this.fShape[fi] === sh) return;
    this.fFiles[fi] = f.files;
    this.fRanks[fi] = f.ranks;
    this.fShape[fi] = sh;
    const b = this.buffers;
    const base = this.slotBase(fi);
    const cap = 2 * this.fCount[fi]!;
    // Alive soldiers in their old slot order go to slots 0, 1, 2... (front rank first).
    let next = 0;
    for (let s = 0; s < cap; s++) {
      const i = this.slotMap[base + s]!;
      if (i < 0) continue;
      this.slotMap[base + s] = -1;
      if (!b.alive[i]) continue;
      b.target[i] = next++;
    }
    for (let i = this.fStart[fi]!; i < this.fStart[fi]! + this.fCount[fi]!; i++) {
      if (!b.alive[i]) continue;
      const s = b.target[i]!;
      if (s < 0 || s >= cap) continue;
      b.slot[i] = s;
      this.slotMap[base + s] = i;
      b.target[i] = -1;
    }
  }

  /** Kill soldiers until the visual alive count matches the authoritative strength (surrendered: frozen). */
  private syncCasualties(state: BattleState, f: FormationState): void {
    if (f.activity === 'surrendered') return;
    const fi = f.index;
    let excess = this.fAlive[fi]! - Math.max(0, f.soldiers);
    if (excess <= 0) return;
    const b = this.buffers;
    const start = this.fStart[fi]!;
    const end = start + this.fCount[fi]!;
    const engaged = f.engagedWith.length > 0;
    const enemy = engaged ? state.formations[f.engagedWith[0]!] : undefined;
    let guard = 0;
    while (excess > 0 && guard++ < 4096) {
      let victim = -1;
      if (enemy) {
        // Melee: one of the few soldiers nearest the enemy (front ranks fall first).
        let best = Infinity;
        for (let i = start; i < end; i++) {
          if (!b.alive[i]) continue;
          const dx = b.posX[i]! - enemy.x;
          const dz = b.posZ[i]! - enemy.z;
          const d = Math.sqrt(dx * dx + dz * dz) + this.rng.next() * 2.5;
          if (d < best) {
            best = d;
            victim = i;
          }
        }
      } else {
        // Missiles / pursuit: a random soldier.
        const alive = this.fAlive[fi]!;
        const n = this.rng.int(0, Math.max(0, alive - 1));
        let seen = 0;
        for (let i = start; i < end; i++) {
          if (!b.alive[i]) continue;
          if (seen++ === n) {
            victim = i;
            break;
          }
        }
      }
      if (victim < 0) break;
      this.kill(state, f, victim, engaged);
      excess--;
    }
  }

  private kill(state: BattleState, f: FormationState, i: number, melee: boolean): void {
    const b = this.buffers;
    const fi = f.index;
    b.alive[i] = 0;
    this.fAlive[fi]--;
    b.deathTime[i] = state.time;
    b.velX[i] = 0;
    b.velZ[i] = 0;
    const variant = this.rng.int(0, 1);
    this.setAnim(i, SOLDIER_ANIM.die, variant, state.time, state.time);
    // Hand the role over to the nearest living comrade (standards are dropped while routing).
    const roles = b.flags[i]! & ROLE_MASK;
    b.flags[i] = b.flags[i]! & ~ROLE_MASK;
    // The soldier behind steps forward into the gap; the hole moves to the rear rank.
    const files = Math.max(1, f.files);
    const base = this.slotBase(fi);
    const cap = 2 * this.fCount[fi]!;
    let cur = b.slot[i]!;
    if (cur < cap && this.slotMap[base + cur] === i) {
      for (;;) {
        const behind = cur + files;
        const j = behind < cap ? this.slotMap[base + behind]! : -1;
        if (j < 0 || !b.alive[j]) {
          this.slotMap[base + cur] = -1;
          break;
        }
        this.slotMap[base + cur] = j;
        b.slot[j] = cur;
        cur = behind;
      }
    }
    if (roles) {
      const heir = this.nearestAlive(f, b.posX[i]!, b.posZ[i]!);
      if (heir >= 0) {
        const keep = f.activity === 'routing' ? roles & ~SOLDIER_FLAG.standardBearer : roles;
        b.flags[heir] = b.flags[heir]! | keep;
        if (keep !== roles) this.fDropped[fi] = 1;
      }
    }
    if (melee) {
      // Neighbours flinch.
      const n = this.hash.queryRadius(b.posX[i]!, b.posZ[i]!, 1.6, neighbors, b.posX, b.posZ);
      for (let q = 0; q < n && q < 3; q++) {
        const j = neighbors[q] as number;
        if (j !== i && b.alive[j] && b.formation[j] === fi && b.anim[j] !== SOLDIER_ANIM.hit) this.setAnim(j, SOLDIER_ANIM.hit, 0, state.time, state.time);
      }
    }
  }

  private nearestAlive(f: FormationState, x: number, z: number): number {
    const b = this.buffers;
    const start = this.fStart[f.index]!;
    const end = start + this.fCount[f.index]!;
    let best = -1;
    let bd = Infinity;
    for (let i = start; i < end; i++) {
      if (!b.alive[i]) continue;
      const d = (b.posX[i]! - x) * (b.posX[i]! - x) + (b.posZ[i]! - z) * (b.posZ[i]! - z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /** Routing formations drop their standard; rallied ones raise it again. */
  private syncRoles(f: FormationState): void {
    const fi = f.index;
    const routing = f.activity === 'routing' ? 1 : 0;
    if (routing === this.fRouting[fi]) return;
    this.fRouting[fi] = routing;
    if (routing) this.dropStandard(f);
    else if (this.fDropped[fi] && UNITS[f.unitClass].visual.hasStandard) {
      const b = this.buffers;
      const front = this.slotMap[this.slotBase(fi) + Math.floor(Math.max(1, f.files) / 2)]!;
      const holder = front >= 0 && b.alive[front] ? front : this.nearestAlive(f, f.x, f.z);
      if (holder >= 0) b.flags[holder] = b.flags[holder]! | SOLDIER_FLAG.standardBearer;
      this.fDropped[fi] = 0;
    }
  }

  private dropStandard(f: FormationState): void {
    const b = this.buffers;
    const start = this.fStart[f.index]!;
    const end = start + this.fCount[f.index]!;
    for (let i = start; i < end; i++) {
      if (b.flags[i]! & SOLDIER_FLAG.standardBearer) {
        b.flags[i] = b.flags[i]! & ~SOLDIER_FLAG.standardBearer;
        this.fDropped[f.index] = 1;
      }
    }
  }

  /** Alive soldiers in the visual layer. */
  aliveCount(): number {
    let n = 0;
    for (let i = 0; i < this.fAlive.length; i++) n += this.fAlive[i] as number;
    return n;
  }
}

function shapeIndex(f: FormationState): number {
  switch (f.shape) {
    case 'line':
      return 0;
    case 'column':
      return 1;
    case 'square':
      return 2;
    case 'wedge':
      return 3;
    case 'loose':
      return 4;
    default:
      return 5;
  }
}

function isMountedVisual(f: FormationState): boolean {
  const m = UNITS[f.unitClass].visual.mount;
  return m !== 'none';
}

function canBraceVisual(f: FormationState): boolean {
  return f.unitClass === 'spearmen' || f.unitClass === 'elite_guards';
}

/** An enemy formation is charging this one (its charge target) - the spears brace. */
function chargedBy(state: BattleState, f: FormationState): boolean {
  if (f.vx * f.vx + f.vz * f.vz > 0.09) return false;
  for (const e of state.formations) {
    if (e.side === f.side || e.soldiers <= 0) continue;
    const o = e.order;
    if ((o.type === 'charge' || (o.type === 'flank' && e.activity === 'charging')) && o.target === f.index) {
      const dx = e.x - f.x;
      const dz = e.z - f.z;
      if (dx * dx + dz * dz < 150 * 150) return true;
    }
  }
  return false;
}

/** Role bits for slot `s` of a freshly spawned formation. */
function roleFor(f: FormationState, s: number): number {
  const files = Math.max(1, f.files);
  const mid = Math.floor(files / 2);
  const std = UNITS[f.unitClass].visual.hasStandard;
  let flags = 0;
  if (f.hasCommander && f.commanderAlive && s === mid + (f.soldiers > files ? files : 0)) flags |= SOLDIER_FLAG.commander;
  if (std && s === mid) flags |= SOLDIER_FLAG.standardBearer;
  if (std && f.soldiers > 20 && s === Math.min(files - 1, mid + 2)) flags |= SOLDIER_FLAG.drummer;
  if (std && f.soldiers > 40 && s === Math.max(0, mid - 2)) flags |= SOLDIER_FLAG.conch;
  if (files > 2 && (s === 0 || s === files - 1)) flags |= SOLDIER_FLAG.officer;
  return flags;
}
