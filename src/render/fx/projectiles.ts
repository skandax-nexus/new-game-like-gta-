/**
 * Instanced arrows/javelins following authoritative volleys (sim/tactical/projectiles.ts volleyPoint).
 * OWNER: Lead Graphics Engineer. Baseline by the CTO.
 * TODO(owner): per-arrow spread from individual archers, stuck arrows in ground/shields, fire arrow
 * trails + light, motion-blur streaks, impact dust (fx/particles).
 */
import * as THREE from 'three';
import type { BattleState, TerrainQuery, Vec3, Volley } from '../../core/types';
import { volleyPoint } from '../../sim/tactical/projectiles';
import { hash2 } from '../../core/math';

export class ProjectileRenderer {
  readonly object: THREE.InstancedMesh;
  private readonly p: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly p2: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3(0, 0, 1);
  private readonly one = new THREE.Vector3(1, 1, 1);

  constructor(
    private readonly maxArrows = 4000,
    private readonly arrowsPerVolley = 40,
  ) {
    const geo = new THREE.BoxGeometry(0.03, 0.03, 0.9);
    const mat = new THREE.MeshStandardMaterial({ color: '#3d2a1a', roughness: 0.8 });
    this.object = new THREE.InstancedMesh(geo, mat, maxArrows);
    this.object.frustumCulled = false;
    this.object.name = 'arrows';
  }

  update(state: BattleState, time: number, terrain: TerrainQuery): void {
    let n = 0;
    for (const v of state.volleys as Volley[]) {
      if (time < v.launchTime || time > v.impactTime + 0.05) continue;
      const count = Math.min(this.arrowsPerVolley, Math.max(4, Math.round(v.count / 6)));
      for (let k = 0; k < count && n < this.maxArrows; k++) {
        const jx = (hash2(v.id, k, 1) - 0.5) * 14;
        const jz = (hash2(v.id, k, 2) - 0.5) * 14;
        const dt = (hash2(v.id, k, 3) - 0.5) * 0.25;
        const t = time + dt;
        volleyPoint(v, t, this.p);
        volleyPoint(v, t + 0.02, this.p2);
        const u = Math.min(1, Math.max(0, (t - v.launchTime) / Math.max(0.01, v.impactTime - v.launchTime)));
        const x = this.p.x + jx * u;
        const z = this.p.z + jz * u;
        const ground = terrain.heightAt(x, z);
        const base = terrain.heightAt(v.fromX, v.fromZ) * (1 - u) + terrain.heightAt(v.toX, v.toZ) * u;
        this.v.set(x, base + this.p.y, z);
        if (this.v.y < ground) this.v.y = ground + 0.3;
        this.dir.set(this.p2.x - this.p.x, this.p2.y - this.p.y, this.p2.z - this.p.z).normalize();
        this.q.setFromUnitVectors(this.fwd, this.dir);
        this.m.compose(this.v, this.q, this.one);
        this.object.setMatrixAt(n++, this.m);
      }
    }
    this.object.count = n;
    this.object.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.object.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
    this.object.dispose();
  }
}
