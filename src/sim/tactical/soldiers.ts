/**
 * Local (soldier-level) simulation - GDD §9 third level. OWNER: Lead Gameplay Engineer.
 * Baseline by the CTO.
 *
 * The soldier layer VISUALIZES the authoritative formation state; it never changes outcomes:
 *  - spawn(): one soldier per formation member, laid out on formation slots (see formations.ts).
 *  - step(): soldiers seek their (compacted) slot, play anims (walk/run/attack/shoot/die/rout),
 *    realize casualties decided by combat.ts (front ranks die first in melee, random under arrows),
 *    and do cheap separation near the camera. Distant soldiers update less often (LOD by distance to
 *    the camera focus) so 5,000 combatants stay within budget (docs/ARCHITECTURE.md §Performance).
 *  - Writes SoldierBuffers (SoA typed arrays) that render/units reads with interpolation (prev -> pos).
 * No per-step allocations. Uses its own cosmetic RNG (seeded from the battle seed), never state.rng.
 */
import type { BattleState, FormationState, Rect, SoldierBuffers, TerrainQuery, Vec2 } from '../../core/types';
import { SOLDIER_ANIM, SOLDIER_FLAG, SOLDIER_LOD, UNIT_CLASS_INDEX } from '../../core/types';
import { Rng, deriveSeed } from '../../core/rng';
import { SpatialHash2D } from '../../core/spatial';
import { dcos, dsin, facingOf, approachAngle } from '../../core/math';
import { UNITS } from '../../data/units';
import { slotWorldPosition } from './formations';

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
  };
}

export interface SoldierSimOptions {
  /** LOD distances (m) from the camera focus. */
  lodNear: number;
  lodMid: number;
  lodFar: number;
}

const tmp: Vec2 = { x: 0, z: 0 };
const neighbors = new Int32Array(24);

export class SoldierSim {
  readonly buffers: SoldierBuffers;
  private readonly fStart: Int32Array;
  private readonly fCount: Int32Array;
  private readonly fAlive: Int32Array;
  private readonly fLastReload: Float32Array;
  private readonly hash: SpatialHash2D;
  private readonly rng: Rng;
  private stepIndex = 0;

  constructor(state: BattleState, bounds: Rect) {
    let total = 0;
    for (const f of state.formations) total += f.maxSoldiers;
    this.buffers = createSoldierBuffers(Math.max(1, total));
    const n = state.formations.length;
    this.fStart = new Int32Array(n);
    this.fCount = new Int32Array(n);
    this.fAlive = new Int32Array(n);
    this.fLastReload = new Float32Array(n);
    this.hash = new SpatialHash2D(bounds, 4, this.buffers.capacity);
    this.rng = new Rng(deriveSeed(state.setup.seed, 'soldiers'));
  }

  /** Create soldiers on their formation slots (call once after createBattle / when attaching to a running battle). */
  spawn(state: BattleState, terrain: TerrainQuery): void {
    const b = this.buffers;
    let i = 0;
    for (const f of state.formations) {
      this.fStart[f.index] = i;
      const count = f.soldiers;
      this.fCount[f.index] = count;
      this.fAlive[f.index] = count;
      const cls = UNIT_CLASS_INDEX[f.unitClass];
      const midFile = Math.floor(f.files / 2);
      for (let s = 0; s < count; s++, i++) {
        slotWorldPosition(f, s, tmp);
        b.posX[i] = b.prevX[i] = tmp.x;
        b.posZ[i] = b.prevZ[i] = tmp.z;
        b.posY[i] = b.prevY[i] = terrain.heightAt(tmp.x, tmp.z);
        b.facing[i] = b.prevFacing[i] = f.facing;
        b.velX[i] = 0;
        b.velZ[i] = 0;
        b.anim[i] = SOLDIER_ANIM.idle;
        b.animTime[i] = this.rng.next() * 2;
        b.animSpeed[i] = 0.9 + this.rng.next() * 0.2;
        b.formation[i] = f.index;
        b.slot[i] = s;
        b.side[i] = f.side;
        b.unitClass[i] = cls;
        b.alive[i] = 1;
        b.lod[i] = SOLDIER_LOD.near;
        b.variant[i] = this.rng.int(0, 255);
        let flags = 0;
        if (f.hasCommander && s === midFile + f.files) flags |= SOLDIER_FLAG.commander;
        if (s === midFile && UNITS[f.unitClass].visual.hasStandard) flags |= SOLDIER_FLAG.standardBearer;
        if (s === midFile + 2 && UNITS[f.unitClass].visual.hasStandard && f.soldiers > 20) flags |= SOLDIER_FLAG.drummer;
        if (s === 0 || s === f.files - 1) flags |= SOLDIER_FLAG.officer;
        b.flags[i] = flags;
        b.target[i] = -1;
        b.deathTime[i] = 0;
      }
      this.fLastReload[f.index] = f.reload;
    }
    b.count = i;
  }

  /** Advance the soldier layer by dt. focus = camera ground focus for LOD. */
  step(state: BattleState, dt: number, terrain: TerrainQuery, focusX: number, focusZ: number, opts: SoldierSimOptions): void {
    const b = this.buffers;
    this.stepIndex++;
    // prev <- current
    b.prevX.set(b.posX);
    b.prevY.set(b.posY);
    b.prevZ.set(b.posZ);
    b.prevFacing.set(b.facing);
    const near2 = opts.lodNear * opts.lodNear;
    const mid2 = opts.lodMid * opts.lodMid;
    const far2 = opts.lodFar * opts.lodFar;
    for (const f of state.formations) this.syncCasualties(state, f);
    this.hash.build(b.count, b.posX, b.posZ, b.alive);

    for (const f of state.formations) {
      const start = this.fStart[f.index];
      const count = this.fCount[f.index];
      const def = UNITS[f.unitClass].stats;
      const maxSpeed = def.runSpeed * 1.25;
      const routing = f.activity === 'routing';
      const engaged = f.engagedWith.length > 0;
      const shot = f.reload > this.fLastReload[f.index] + 0.5;
      this.fLastReload[f.index] = f.reload;
      let enemyFacing = f.facing;
      if (engaged) {
        const e = state.formations[f.engagedWith[0] as number];
        if (e) enemyFacing = facingOf(e.x - f.x, e.z - f.z);
      }
      let k = 0;
      for (let i = start; i < start + count; i++) {
        if (!b.alive[i]) {
          if (b.anim[i] === SOLDIER_ANIM.die && state.time - b.deathTime[i] > 1.4) {
            b.anim[i] = SOLDIER_ANIM.dead;
            b.animTime[i] = 0;
          }
          b.animTime[i] += dt;
          continue;
        }
        const slot = k++;
        b.slot[i] = slot;
        const dxF = b.posX[i] - focusX;
        const dzF = b.posZ[i] - focusZ;
        const d2 = dxF * dxF + dzF * dzF;
        const lod = d2 < near2 ? SOLDIER_LOD.near : d2 < mid2 ? SOLDIER_LOD.mid : d2 < far2 ? SOLDIER_LOD.far : SOLDIER_LOD.culled;
        b.lod[i] = lod;
        const every = lod === SOLDIER_LOD.near ? 1 : lod === SOLDIER_LOD.mid ? 2 : 4;
        b.animTime[i] += dt * b.animSpeed[i];
        if ((this.stepIndex + i) % every !== 0) continue;
        const sdt = dt * every;

        // Target position.
        let tx: number;
        let tz: number;
        if (routing) {
          const jitter = ((b.variant[i] / 255) - 0.5) * 1.2;
          const away = f.facing + Math.PI + jitter * 0.6;
          tx = b.posX[i] + dsin(away) * maxSpeed * 2;
          tz = b.posZ[i] + dcos(away) * maxSpeed * 2;
        } else {
          slotWorldPosition(f, slot, tmp);
          tx = tmp.x;
          tz = tmp.z;
          if (engaged && slot < f.files * 2) {
            // Front ranks press toward the enemy.
            tx += dsin(enemyFacing) * 0.8;
            tz += dcos(enemyFacing) * 0.8;
          }
        }
        let vx = (tx - b.posX[i]) * 2.2;
        let vz = (tz - b.posZ[i]) * 2.2;
        // Separation near the camera.
        if (lod === SOLDIER_LOD.near) {
          const r = def.radius * 2.2;
          const n = this.hash.queryRadius(b.posX[i], b.posZ[i], r, neighbors, b.posX, b.posZ);
          for (let q = 0; q < n; q++) {
            const j = neighbors[q] as number;
            if (j === i) continue;
            const sx = b.posX[i] - b.posX[j];
            const sz = b.posZ[i] - b.posZ[j];
            const dd = sx * sx + sz * sz;
            if (dd < 1e-4 || dd > r * r) continue;
            const push = (r - Math.sqrt(dd)) * 3;
            const inv = 1 / Math.sqrt(dd);
            vx += sx * inv * push;
            vz += sz * inv * push;
          }
        }
        const sp = Math.sqrt(vx * vx + vz * vz);
        if (sp > maxSpeed) {
          vx = (vx / sp) * maxSpeed;
          vz = (vz / sp) * maxSpeed;
        }
        b.velX[i] = vx;
        b.velZ[i] = vz;
        b.posX[i] += vx * sdt;
        b.posZ[i] += vz * sdt;
        b.posY[i] = terrain.heightAt(b.posX[i], b.posZ[i]);
        const speed = Math.min(sp, maxSpeed);
        const wantFacing = speed > 0.6 ? facingOf(vx, vz) : engaged ? enemyFacing : f.facing;
        b.facing[i] = approachAngle(b.facing[i], wantFacing, 6 * sdt);

        // Animation state.
        let anim: number;
        if (routing) anim = SOLDIER_ANIM.rout;
        else if (engaged && slot < f.files * 2) anim = SOLDIER_ANIM.attack;
        else if (shot) anim = SOLDIER_ANIM.shoot;
        else if (b.anim[i] === SOLDIER_ANIM.shoot && b.animTime[i] < 1.2) anim = SOLDIER_ANIM.shoot;
        else if (f.activity === 'constructing') anim = SOLDIER_ANIM.work;
        else if (speed > def.walkSpeed * 1.35) anim = SOLDIER_ANIM.run;
        else if (speed > 0.25) anim = SOLDIER_ANIM.walk;
        else if (f.unitClass === 'spearmen' && engaged) anim = SOLDIER_ANIM.brace;
        else anim = SOLDIER_ANIM.idle;
        if (anim !== b.anim[i]) {
          b.anim[i] = anim;
          b.animTime[i] = anim === SOLDIER_ANIM.attack ? (b.variant[i] / 255) * 1.2 : 0;
        }
        b.animSpeed[i] = anim === SOLDIER_ANIM.walk || anim === SOLDIER_ANIM.run ? Math.max(0.6, speed / (anim === SOLDIER_ANIM.run ? def.runSpeed : def.walkSpeed)) : 0.9 + (b.variant[i] / 255) * 0.2;
      }
    }
  }

  /** Kill soldiers until the visual alive count matches the authoritative formation strength. */
  private syncCasualties(state: BattleState, f: FormationState): void {
    const b = this.buffers;
    let excess = this.fAlive[f.index] - Math.max(0, f.soldiers);
    if (excess <= 0) return;
    const start = this.fStart[f.index];
    const count = this.fCount[f.index];
    const melee = f.engagedWith.length > 0;
    const pool = melee ? Math.max(1, f.files * 2) : count;
    let guard = 0;
    while (excess > 0 && guard++ < count * 4) {
      // Pick the n-th alive soldier among the first `pool` alive (front ranks in melee).
      const n = this.rng.int(0, Math.min(pool, this.fAlive[f.index]) - 1);
      let seen = 0;
      for (let i = start; i < start + count; i++) {
        if (!b.alive[i]) continue;
        if (seen++ === n) {
          b.alive[i] = 0;
          b.anim[i] = SOLDIER_ANIM.die;
          b.animTime[i] = 0;
          b.deathTime[i] = state.time;
          b.velX[i] = 0;
          b.velZ[i] = 0;
          this.fAlive[f.index]--;
          excess--;
          break;
        }
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
