/**
 * River / water surface. OWNER: Lead Graphics Engineer. Baseline by the CTO: one plane at the
 * terrain water level with an animated procedural normal map and IBL reflections.
 *
 * TODO(owner): planar or screen-space reflections on high+ (quality.water.reflections === 'planar'),
 * depth-based color/opacity + shoreline foam using the scene depth, flow direction along the river
 * (TerrainGenerator.riverAt gives the channel), monsoon flood level (env.weather.flood), rain ripples.
 */
import * as THREE from 'three';
import type { EnvironmentState, QualitySettings, Rect } from '../../core/types';
import { MATERIALS } from '../style/palette';
import { createNoiseNormalMap } from './textures';

export class WaterRenderer {
  readonly object: THREE.Mesh;
  private readonly material: THREE.MeshPhysicalMaterial;
  private readonly normal: THREE.DataTexture;
  private time = 0;
  private baseLevel: number;

  constructor(bounds: Rect, waterLevel: number, quality: QualitySettings) {
    void quality;
    this.baseLevel = waterLevel;
    this.normal = createNoiseNormalMap(256, 23, 4, 6);
    const w = bounds.maxX - bounds.minX;
    const d = bounds.maxZ - bounds.minZ;
    this.normal.repeat.set(w / 40, d / 40);
    this.material = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(MATERIALS.waterDeep),
      roughness: 0.05,
      metalness: 0,
      ior: 1.333,
      reflectivity: 0.6,
      clearcoat: 0.6,
      clearcoatRoughness: 0.08,
      normalMap: this.normal,
      normalScale: new THREE.Vector2(0.35, 0.35),
      transparent: true,
      opacity: 0.9,
      envMapIntensity: 1.3,
    });
    const geo = new THREE.PlaneGeometry(w, d, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.object = new THREE.Mesh(geo, this.material);
    this.object.position.set((bounds.minX + bounds.maxX) / 2, waterLevel, (bounds.minZ + bounds.maxZ) / 2);
    this.object.receiveShadow = true;
    this.object.renderOrder = 1;
    this.object.name = 'water';
  }

  setEnvironment(env: EnvironmentState): void {
    this.object.position.y = this.baseLevel + env.weather.flood * 0.6;
    this.material.normalScale.setScalar(0.25 + env.weather.windSpeed * 0.03 + env.weather.rain * 0.2);
    this.material.color.set(env.season === 'varsha' ? '#4a5a3c' : MATERIALS.waterDeep);
  }

  update(dt: number): void {
    this.time += dt;
    this.normal.offset.set(this.time * 0.012, this.time * 0.007);
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.material.dispose();
    this.normal.dispose();
  }
}
