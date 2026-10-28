/**
 * Weather particles (rain, dust) around the camera. OWNER: Lead Graphics Engineer. Baseline by the CTO.
 * TODO(owner): rain streak shader with motion blur, splashes, lightning, dust storms, wet sheen.
 */
import * as THREE from 'three';
import type { EnvironmentState, QualitySettings } from '../../core/types';

export class WeatherRenderer {
  readonly object: THREE.Points;
  private readonly material: THREE.PointsMaterial;
  private readonly positions: Float32Array;
  private readonly count: number;
  private intensity = 0;
  private readonly box = 120;

  constructor(quality: QualitySettings) {
    this.count = Math.max(100, quality.weatherParticles);
    this.positions = new Float32Array(this.count * 3);
    for (let i = 0; i < this.count; i++) {
      this.positions[i * 3] = (Math.random() - 0.5) * this.box;
      this.positions[i * 3 + 1] = Math.random() * 60;
      this.positions[i * 3 + 2] = (Math.random() - 0.5) * this.box;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.material = new THREE.PointsMaterial({ color: 0xaab8c8, size: 0.12, transparent: true, opacity: 0.55, depthWrite: false });
    this.object = new THREE.Points(geo, this.material);
    this.object.frustumCulled = false;
    this.object.visible = false;
    this.object.name = 'weather';
  }

  setEnvironment(env: EnvironmentState): void {
    this.intensity = env.weather.rain;
    this.object.visible = this.intensity > 0.05;
    this.material.opacity = 0.25 + this.intensity * 0.45;
  }

  update(dt: number, camera: THREE.Camera): void {
    if (!this.object.visible) return;
    const p = this.positions;
    const fall = (18 + this.intensity * 10) * dt;
    const n = Math.floor(this.count * Math.min(1, this.intensity + 0.1));
    for (let i = 0; i < n; i++) {
      p[i * 3 + 1] -= fall;
      if (p[i * 3 + 1] < 0) p[i * 3 + 1] += 60;
    }
    (this.object.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.object.geometry.setDrawRange(0, n);
    this.object.position.set(camera.position.x, Math.max(0, camera.position.y - 40), camera.position.z);
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.material.dispose();
  }
}
