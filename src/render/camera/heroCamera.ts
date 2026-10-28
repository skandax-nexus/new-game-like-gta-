/**
 * Third-person hero camera (limited exploration mode, GDD §3). OWNER: Lead Graphics Engineer.
 * Baseline by the CTO: orbit behind the hero, look input, terrain clearance, smoothing.
 * TODO(owner): collision with buildings (layout footprints), shoulder offset, dialogue framing.
 */
import * as THREE from 'three';
import type { InputFrame, TerrainQuery } from '../../core/types';

export class HeroCameraController {
  yaw = 0;
  pitch = 0.32;
  distance = 7;
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private initialized = false;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly terrain: TerrainQuery,
  ) {}

  update(dt: number, input: InputFrame | null, heroX: number, heroY: number, heroZ: number): void {
    if (input) {
      this.yaw -= input.lookX * 0.005 + input.rotate;
      this.pitch = THREE.MathUtils.clamp(this.pitch + input.lookY * 0.004 + input.tilt * 0.5, 0.05, 1.1);
      if (input.zoom !== 0) this.distance = THREE.MathUtils.clamp(this.distance * Math.pow(0.88, input.zoom), 2.5, 16);
    }
    const tx = heroX + Math.sin(this.yaw) * Math.cos(this.pitch) * this.distance;
    const tz = heroZ + Math.cos(this.yaw) * Math.cos(this.pitch) * this.distance;
    let ty = heroY + 1.6 + Math.sin(this.pitch) * this.distance;
    const g = this.terrain.heightAt(tx, tz) + 0.8;
    if (ty < g) ty = g;
    const k = this.initialized ? 1 - Math.exp(-10 * dt) : 1;
    this.initialized = true;
    this.pos.lerp(new THREE.Vector3(tx, ty, tz), k);
    this.look.lerp(new THREE.Vector3(heroX, heroY + 1.5, heroZ), k);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    this.camera.updateMatrixWorld();
  }

  /** Forward direction on the ground (for camera-relative movement). */
  forward(out: { x: number; z: number }): { x: number; z: number } {
    out.x = -Math.sin(this.yaw);
    out.z = -Math.cos(this.yaw);
    return out;
  }
}
