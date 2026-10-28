/**
 * Cloth banners (standards) with a wind-driven vertex shader, placed on standard-bearer soldiers.
 * OWNER: Lead Graphics Engineer (+ Art Director for faction emblems). Baseline by the CTO.
 * TODO(owner): faction emblem textures generated from FactionDef.banner patterns, tattered banners
 * when formations are routed, banner LOD.
 */
import * as THREE from 'three';
import type { SoldierBuffers } from '../../core/types';
import { SOLDIER_FLAG } from '../../core/types';

export class BannerRenderer {
  readonly object: THREE.InstancedMesh;
  private readonly poles: THREE.InstancedMesh;
  private readonly uniforms = { uTime: { value: 0 }, uWind: { value: 0.6 } };
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly colors: [THREE.Color, THREE.Color];
  readonly group = new THREE.Group();

  constructor(private readonly buffers: SoldierBuffers, sideColors: [string, string], max = 128) {
    this.colors = [new THREE.Color(sideColors[0]), new THREE.Color(sideColors[1])];
    const geo = new THREE.PlaneGeometry(1.4, 0.9, 8, 4);
    geo.translate(0.7, 0, 0);
    const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.85 });
    mat.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, this.uniforms);
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float k = transformed.x / 1.4;
           #ifdef USE_INSTANCING
           float ph = instanceMatrix[3][0] * 0.3 + instanceMatrix[3][2] * 0.2;
           #else
           float ph = 0.0;
           #endif
           transformed.z += sin(uTime * 5.0 + k * 5.0 + ph) * 0.18 * k * uWind;
           transformed.y += sin(uTime * 3.0 + k * 3.0 + ph) * 0.05 * k;`,
        );
    };
    this.object = new THREE.InstancedMesh(geo, mat, max);
    this.object.frustumCulled = false;
    this.object.castShadow = true;
    const poleGeo = new THREE.CylinderGeometry(0.025, 0.025, 3.4, 5);
    poleGeo.translate(0, 1.7, 0);
    this.poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: '#4a3220' }), max);
    this.poles.frustumCulled = false;
    this.group.add(this.object, this.poles);
  }

  update(dt: number, alpha: number, wind: number): void {
    this.uniforms.uTime.value += dt;
    this.uniforms.uWind.value = 0.4 + wind;
    const b = this.buffers;
    let n = 0;
    const max = this.object.instanceMatrix.count;
    for (let i = 0; i < b.count && n < max; i++) {
      if (!((b.flags[i] as number) & SOLDIER_FLAG.standardBearer) || !b.alive[i]) continue;
      const x = (b.prevX[i] as number) + ((b.posX[i] as number) - (b.prevX[i] as number)) * alpha;
      const y = (b.prevY[i] as number) + ((b.posY[i] as number) - (b.prevY[i] as number)) * alpha;
      const z = (b.prevZ[i] as number) + ((b.posZ[i] as number) - (b.prevZ[i] as number)) * alpha;
      this.q.setFromAxisAngle(this.up, (b.facing[i] as number) + Math.PI / 2);
      this.v.set(x + 0.3, y, z);
      this.m.compose(this.v, this.q, this.one);
      this.poles.setMatrixAt(n, this.m);
      this.v.set(x + 0.3, y + 2.9, z);
      this.m.compose(this.v, this.q, this.one);
      this.object.setMatrixAt(n, this.m);
      this.object.setColorAt(n, this.colors[(b.side[i] as number) & 1] as THREE.Color);
      n++;
    }
    this.object.count = n;
    this.poles.count = n;
    this.object.instanceMatrix.needsUpdate = true;
    this.poles.instanceMatrix.needsUpdate = true;
    if (this.object.instanceColor) this.object.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    for (const m of [this.object, this.poles]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      m.dispose();
    }
  }
}
