/**
 * Strategic-map army tokens: a small block of soldier figurines + a banner in faction colors,
 * interpolated between hourly sim ticks. OWNER: Lead Graphics Engineer. Baseline by the CTO.
 * TODO(owner): composition-aware figurines (elephants/cavalry), marching animation, supply train
 * tail, path preview line, fog-of-war fading by intel level, siege camp visuals.
 */
import * as THREE from 'three';
import type { ArmyState, TerrainQuery } from '../../core/types';
import { FACTIONS } from '../../data/factions';
import { buildUnitGeometry } from './unitModels';

const PER_ARMY = 12;

export class ArmyMarkerRenderer {
  readonly object = new THREE.Group();
  private readonly figures: THREE.InstancedMesh;
  private readonly flags: THREE.InstancedMesh;
  private readonly poles: THREE.InstancedMesh;
  private readonly prev = new Map<string, { x: number; z: number }>();
  private readonly cur = new Map<string, { x: number; z: number }>();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly sc = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly color = new THREE.Color();
  /** Visual scale of figurines on the strategic map (they are tokens, not to scale). */
  tokenScale = 6;

  constructor(maxArmies = 64) {
    this.object.name = 'army-markers';
    const fig = buildUnitGeometry('spearmen');
    this.figures = new THREE.InstancedMesh(fig, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), maxArmies * PER_ARMY);
    this.figures.castShadow = true;
    this.figures.frustumCulled = false;
    const flagGeo = new THREE.PlaneGeometry(1.6, 1);
    flagGeo.translate(0.8, 0, 0);
    this.flags = new THREE.InstancedMesh(flagGeo, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 }), maxArmies);
    this.flags.frustumCulled = false;
    this.flags.castShadow = true;
    const poleGeo = new THREE.CylinderGeometry(0.03, 0.03, 3, 5);
    poleGeo.translate(0, 1.5, 0);
    this.poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: '#5b3d22' }), maxArmies);
    this.poles.frustumCulled = false;
    this.object.add(this.figures, this.flags, this.poles);
  }

  /** Call after each strategic tick to set new target positions. */
  syncTick(armies: Record<string, ArmyState>): void {
    for (const [id, a] of Object.entries(armies)) {
      const c = this.cur.get(id);
      this.prev.set(id, c ? { ...c } : { x: a.x, z: a.z });
      this.cur.set(id, { x: a.x, z: a.z });
    }
    for (const id of [...this.cur.keys()]) if (!armies[id]) {
      this.cur.delete(id);
      this.prev.delete(id);
    }
  }

  update(armies: Record<string, ArmyState>, alpha: number, terrain: TerrainQuery, time: number): void {
    let fi = 0;
    let ai = 0;
    const s = this.tokenScale;
    for (const [id, a] of Object.entries(armies)) {
      if (ai >= this.flags.instanceMatrix.count) break;
      const p0 = this.prev.get(id) ?? a;
      const p1 = this.cur.get(id) ?? a;
      const x = p0.x + (p1.x - p0.x) * alpha;
      const z = p0.z + (p1.z - p0.z) * alpha;
      const facing = a.facing;
      const def = FACTIONS[a.factionId];
      this.color.set(def?.colors.primary ?? '#cccccc');
      const cs = Math.cos(facing);
      const sn = Math.sin(facing);
      const n = Math.min(PER_ARMY, Math.max(3, Math.round(a.units.reduce((t, u) => t + u.soldiers, 0) / 80)));
      for (let k = 0; k < n; k++) {
        const col = (k % 4) - 1.5;
        const row = Math.floor(k / 4) - 1;
        const lx = col * 1.1 * s;
        const lz = -row * 1.3 * s;
        const wx = x + lx * cs + lz * sn;
        const wz = z - lx * sn + lz * cs;
        const bob = a.status === 'marching' ? Math.abs(Math.sin(time * 6 + k)) * 0.15 * s : 0;
        this.v.set(wx, terrain.heightAt(wx, wz) + bob, wz);
        this.q.setFromAxisAngle(this.up, facing);
        this.sc.setScalar(s);
        this.m.compose(this.v, this.q, this.sc);
        this.figures.setMatrixAt(fi, this.m);
        this.figures.setColorAt(fi, this.color);
        fi++;
      }
      const h = terrain.heightAt(x, z);
      this.v.set(x, h, z);
      this.q.identity();
      this.sc.setScalar(s * 1.6);
      this.m.compose(this.v, this.q, this.sc);
      this.poles.setMatrixAt(ai, this.m);
      this.v.set(x, h + 2.4 * s * 1.6, z);
      this.q.setFromAxisAngle(this.up, Math.sin(time * 2 + ai) * 0.25 + 0.6);
      this.m.compose(this.v, this.q, this.sc);
      this.flags.setMatrixAt(ai, this.m);
      this.flags.setColorAt(ai, this.color);
      ai++;
    }
    this.figures.count = fi;
    this.flags.count = ai;
    this.poles.count = ai;
    this.figures.instanceMatrix.needsUpdate = true;
    if (this.figures.instanceColor) this.figures.instanceColor.needsUpdate = true;
    this.flags.instanceMatrix.needsUpdate = true;
    if (this.flags.instanceColor) this.flags.instanceColor.needsUpdate = true;
    this.poles.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const m of [this.figures, this.flags, this.poles]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      m.dispose();
    }
  }
}
