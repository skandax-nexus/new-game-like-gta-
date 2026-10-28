/**
 * Hero exploration controller (GDD §3: limited hero mode for missions, negotiations and local
 * inspection). Three-free movement + collision against settlement layout footprints.
 * OWNER: Lead Gameplay Engineer. Baseline by the CTO.
 * TODO(owner): NPC conversations (petitions -> events), mission objectives, mounted travel, stairs/ghats.
 */
import type { ArchitectureKind, TerrainQuery } from '../core/types';
import { SOLDIER_ANIM } from '../core/types';
import type { SettlementLayout } from '../render/architecture/layout';

export interface Collider {
  x: number;
  z: number;
  hx: number;
  hz: number;
  rot: number;
}

export interface PointOfInterest {
  id: string;
  kind: ArchitectureKind;
  label: string;
  x: number;
  z: number;
  radius: number;
  settlementId: string;
}

const POI_LABEL: Partial<Record<ArchitectureKind, string>> = {
  granary: 'Inspect the granary',
  palace: 'Enter the palace court',
  shikhara_temple: 'Visit the temple',
  shrine: 'Visit the shrine',
  stupa: 'Walk around the stupa',
  market_stall: 'Speak with merchants',
  well: 'Hear the villagers at the well',
  stepwell: 'Descend the stepwell',
  barracks: 'Review the garrison',
  workshop: 'Visit the workshops',
  ghat: 'Go down to the ghat',
  pillar: 'Read the edict pillar',
};

export function collidersFromLayouts(layouts: readonly SettlementLayout[]): Collider[] {
  const out: Collider[] = [];
  for (const l of layouts) for (const p of l.pieces) if (p.kind !== 'field_plot' && p.kind !== 'ghat') out.push({ x: p.x, z: p.z, hx: p.hx * 0.92, hz: p.hz * 0.92, rot: p.rot });
  return out;
}

export function pointsOfInterest(layouts: readonly SettlementLayout[]): PointOfInterest[] {
  const out: PointOfInterest[] = [];
  for (const l of layouts) {
    const seen = new Set<string>();
    for (const p of l.pieces) {
      const label = POI_LABEL[p.kind];
      if (!label || (p.kind === 'market_stall' && seen.has(p.kind))) continue;
      seen.add(p.kind);
      out.push({ id: `${l.id}:${p.kind}:${out.length}`, kind: p.kind, label, x: p.x, z: p.z, radius: Math.max(p.hx, p.hz) + 5, settlementId: l.id });
    }
  }
  return out;
}

export class HeroController {
  x: number;
  z: number;
  y = 0;
  facing = 0;
  speed = 0;
  anim: number = SOLDIER_ANIM.idle;
  animTime = 0;

  constructor(x: number, z: number) {
    this.x = x;
    this.z = z;
  }

  update(dt: number, moveX: number, moveY: number, run: boolean, camFwdX: number, camFwdZ: number, terrain: TerrainQuery, colliders: readonly Collider[]): void {
    // Camera-relative movement: forward = camera forward on the ground, right = forward rotated.
    const rx = -camFwdZ;
    const rz = camFwdX;
    let vx = camFwdX * moveY + rx * moveX;
    let vz = camFwdZ * moveY + rz * moveX;
    const len = Math.sqrt(vx * vx + vz * vz);
    const max = run ? 6 : 2.4;
    if (len > 0.01) {
      vx = (vx / Math.max(1, len)) * max;
      vz = (vz / Math.max(1, len)) * max;
      this.facing = Math.atan2(vx, vz);
    } else {
      vx = 0;
      vz = 0;
    }
    let nx = this.x + vx * dt;
    let nz = this.z + vz * dt;
    // Resolve collisions (push out of oriented boxes, radius 0.4).
    for (const c of colliders) {
      const dx = nx - c.x;
      const dz = nz - c.z;
      if (Math.abs(dx) > c.hx + c.hz + 1 && Math.abs(dz) > c.hx + c.hz + 1) continue;
      const s = Math.sin(c.rot);
      const co = Math.cos(c.rot);
      const lx = dx * -co + dz * s;
      const lz = dx * s + dz * co;
      const ex = c.hx + 0.4 - Math.abs(lx);
      const ez = c.hz + 0.4 - Math.abs(lz);
      if (ex > 0 && ez > 0) {
        let px = 0;
        let pz = 0;
        if (ex < ez) px = Math.sign(lx) * ex;
        else pz = Math.sign(lz) * ez;
        nx += px * -co + pz * s;
        nz += px * s + pz * co;
      }
    }
    if (terrain.isWater(nx, nz) && terrain.waterDepthAt(nx, nz) > 0.8) {
      nx = this.x;
      nz = this.z;
    }
    const b = terrain.bounds;
    nx = Math.min(b.maxX - 5, Math.max(b.minX + 5, nx));
    nz = Math.min(b.maxZ - 5, Math.max(b.minZ + 5, nz));
    this.speed = Math.sqrt((nx - this.x) * (nx - this.x) + (nz - this.z) * (nz - this.z)) / Math.max(1e-4, dt);
    this.x = nx;
    this.z = nz;
    this.y = terrain.heightAt(nx, nz);
    const anim = this.speed > 4 ? SOLDIER_ANIM.run : this.speed > 0.3 ? SOLDIER_ANIM.walk : SOLDIER_ANIM.idle;
    if (anim !== this.anim) {
      this.anim = anim;
      this.animTime = 0;
    }
    this.animTime += dt * (anim === SOLDIER_ANIM.walk ? this.speed / 1.6 : anim === SOLDIER_ANIM.run ? this.speed / 5 : 1);
  }
}
