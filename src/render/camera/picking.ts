/**
 * Screen -> ground picking against the heightfield (ray march + bisection). OWNER: Lead Graphics
 * Engineer. Baseline by the CTO. Used by scenes for orders, selection and zoom anchoring.
 */
import * as THREE from 'three';
import type { TerrainQuery, Vec2 } from '../../core/types';

const ray = new THREE.Ray();
const tmp = new THREE.Vector3();
const origin = new THREE.Vector3();
const dir = new THREE.Vector3();

/** World ground point under NDC (x, y in -1..1) or null if the ray misses the terrain. */
export function pickGround(camera: THREE.Camera, ndcX: number, ndcY: number, terrain: TerrainQuery, maxDist = 20000, out: Vec2 = { x: 0, z: 0 }): Vec2 | null {
  origin.setFromMatrixPosition(camera.matrixWorld);
  dir.set(ndcX, ndcY, 0.5).unproject(camera).sub(origin).normalize();
  ray.set(origin, dir);
  let prevT = 0;
  let t = 0;
  let step = 2;
  for (let i = 0; i < 2000 && t < maxDist; i++) {
    ray.at(t, tmp);
    const h = terrain.heightAt(tmp.x, tmp.z);
    const water = terrain.spec.waterLevel;
    const ground = Math.max(h, water);
    if (tmp.y <= ground) {
      // Bisection between prevT and t.
      let lo = prevT;
      let hi = t;
      for (let k = 0; k < 20; k++) {
        const mid = (lo + hi) / 2;
        ray.at(mid, tmp);
        if (tmp.y <= Math.max(terrain.heightAt(tmp.x, tmp.z), water)) hi = mid;
        else lo = mid;
      }
      ray.at(hi, tmp);
      out.x = tmp.x;
      out.z = tmp.z;
      return out;
    }
    prevT = t;
    step = Math.max(1, Math.min(40, (tmp.y - ground) * 0.5));
    t += step;
  }
  return null;
}

/** Project a world point to CSS pixels in a canvas (for HUD labels). Returns false if behind camera. */
export function worldToScreen(camera: THREE.Camera, x: number, y: number, z: number, width: number, height: number, out: { x: number; y: number }): boolean {
  tmp.set(x, y, z).project(camera);
  out.x = (tmp.x * 0.5 + 0.5) * width;
  out.y = (-tmp.y * 0.5 + 0.5) * height;
  return tmp.z < 1;
}
