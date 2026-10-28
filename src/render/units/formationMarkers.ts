/**
 * Formation decals: side-colored ground rings under each formation, selection highlight, order
 * target markers. OWNER: Lead Graphics Engineer (+ Lead UI/UX for readability). Baseline by the CTO.
 * TODO(owner): projected decals conforming to terrain, morale/cohesion bars, order path arrows,
 * hover highlight, formation preview ghost while dragging a line on PC/touch.
 */
import * as THREE from 'three';
import type { BattleState, FormationIndex, SideIndex, TerrainQuery } from '../../core/types';
import { ACCENTS } from '../style/palette';

export class FormationMarkers {
  readonly object = new THREE.Group();
  private readonly ring: THREE.InstancedMesh;
  private readonly target: THREE.InstancedMesh;
  private readonly colorSide: [THREE.Color, THREE.Color];
  private readonly selectColor = new THREE.Color(ACCENTS.select);
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(
    max: number,
    sideColors: [string, string],
    private readonly playerSide: SideIndex,
  ) {
    this.object.name = 'formation-markers';
    this.colorSide = [new THREE.Color(sideColors[0]), new THREE.Color(sideColors[1])];
    const ringGeo = new THREE.RingGeometry(0.975, 1, 64, 1);
    ringGeo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false });
    this.ring = new THREE.InstancedMesh(ringGeo, mat, max);
    this.ring.frustumCulled = false;
    this.ring.renderOrder = 5;
    const tgtGeo = new THREE.RingGeometry(0.6, 1, 4, 1);
    tgtGeo.rotateX(-Math.PI / 2);
    this.target = new THREE.InstancedMesh(tgtGeo, new THREE.MeshBasicMaterial({ color: ACCENTS.gold, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }), max);
    this.target.frustumCulled = false;
    this.target.renderOrder = 5;
    this.object.add(this.ring, this.target);
  }

  update(state: BattleState, selection: ReadonlySet<FormationIndex>, terrain: TerrainQuery, alphaTime: number): void {
    let n = 0;
    let t = 0;
    const pulse = 0.85 + Math.sin(alphaTime * 5) * 0.15;
    for (const f of state.formations) {
      if (f.soldiers <= 0) continue;
      const sel = selection.has(f.index);
      const r = Math.max(f.width, f.depth) * 0.55 + 1.5;
      this.p.set(f.x, terrain.heightAt(f.x, f.z) + 0.3, f.z);
      this.q.setFromAxisAngle(this.up, f.facing);
      this.s.set(r * (sel ? pulse : 1), 1, r * (sel ? pulse : 1));
      this.m.compose(this.p, this.q, this.s);
      this.ring.setMatrixAt(n, this.m);
      this.ring.setColorAt(n, sel ? this.selectColor : (this.colorSide[f.side] as THREE.Color));
      n++;
      if (sel && f.side === this.playerSide && f.order.type === 'move_to') {
        this.p.set(f.order.x, terrain.heightAt(f.order.x, f.order.z) + 0.4, f.order.z);
        this.s.set(3, 1, 3);
        this.m.compose(this.p, this.q, this.s);
        this.target.setMatrixAt(t++, this.m);
      }
    }
    this.ring.count = n;
    this.ring.instanceMatrix.needsUpdate = true;
    if (this.ring.instanceColor) this.ring.instanceColor.needsUpdate = true;
    this.target.count = t;
    this.target.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
    this.ring.dispose();
    this.target.geometry.dispose();
    (this.target.material as THREE.Material).dispose();
    this.target.dispose();
  }
}
