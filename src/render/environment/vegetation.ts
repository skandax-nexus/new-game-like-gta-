/**
 * Instanced, wind-swayed vegetation placed deterministically from terrain biomes.
 * OWNER: Lead Graphics Engineer. Baseline by the CTO: 4 procedural tree/bush species as
 * InstancedMeshes with vertex-shader wind sway.
 *
 * TODO(owner): grass blades/cards near camera (quality.vegetation.grassDistance), crops in farmland
 * (rice paddies, wheat, sugarcane by season), billboard impostors beyond treeDistance, banyan
 * aerial roots, palms along rivers, seasonal color (monsoon lush vs. grishma dry), leaf translucency.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Biome, EnvironmentState, QualitySettings } from '../../core/types';
import type { Heightfield } from '../../core/terrain/heightfield';
import { hash2 } from '../../core/math';
import { SEASON_TINT } from '../style/palette';

type Species = 'broadleaf' | 'palm' | 'acacia' | 'bush';
const SPECIES: Species[] = ['broadleaf', 'palm', 'acacia', 'bush'];

/** Trees per 100 m^2 per biome and species weights. */
const BIOME_VEG: Partial<Record<Biome, { density: number; mix: Partial<Record<Species, number>> }>> = {
  dense_forest: { density: 0.7, mix: { broadleaf: 0.75, bush: 0.25 } },
  forest: { density: 0.38, mix: { broadleaf: 0.6, bush: 0.3, palm: 0.1 } },
  grassland: { density: 0.025, mix: { broadleaf: 0.5, acacia: 0.3, bush: 0.2 } },
  floodplain: { density: 0.04, mix: { palm: 0.5, broadleaf: 0.3, bush: 0.2 } },
  farmland: { density: 0.008, mix: { broadleaf: 0.6, palm: 0.4 } },
  scrub: { density: 0.05, mix: { acacia: 0.5, bush: 0.5 } },
  dry_plain: { density: 0.012, mix: { acacia: 0.7, bush: 0.3 } },
  hills: { density: 0.05, mix: { acacia: 0.4, bush: 0.4, broadleaf: 0.2 } },
  plateau: { density: 0.025, mix: { acacia: 0.5, bush: 0.5 } },
  marsh: { density: 0.04, mix: { palm: 0.4, bush: 0.6 } },
};

function colored(geo: THREE.BufferGeometry, hex: string, jitter = 0): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = 1 + (jitter ? (hash2(i, 3, 17) - 0.5) * jitter : 0);
    col[i * 3] = c.r * v;
    col[i * 3 + 1] = c.g * v;
    col[i * 3 + 2] = c.b * v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}

function speciesGeometry(s: Species): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  switch (s) {
    case 'broadleaf': {
      parts.push(colored(new THREE.CylinderGeometry(0.25, 0.45, 4.2, 6).translate(0, 2.1, 0), '#5a3d26'));
      const blobs: [number, number, number, number][] = [
        [0, 5.6, 0, 2.6],
        [1.5, 5.0, 0.6, 1.9],
        [-1.4, 5.2, -0.5, 2.0],
        [0.3, 6.6, -1.0, 1.7],
        [-0.4, 4.6, 1.4, 1.6],
      ];
      blobs.forEach(([x, y, z, r], i) => parts.push(colored(new THREE.IcosahedronGeometry(r, 0).translate(x, y, z), i % 2 ? '#3f6a2c' : '#4b7a33', 0.25)));
      break;
    }
    case 'palm': {
      parts.push(colored(new THREE.CylinderGeometry(0.16, 0.26, 8, 5).translate(0, 4, 0), '#7a5a3a'));
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const leaf = new THREE.ConeGeometry(0.5, 3.6, 3);
        leaf.rotateZ(Math.PI / 2 + 0.5);
        leaf.translate(1.6, 7.6, 0);
        leaf.rotateY(a);
        parts.push(colored(leaf, '#4f7d2e', 0.2));
      }
      break;
    }
    case 'acacia': {
      parts.push(colored(new THREE.CylinderGeometry(0.15, 0.3, 3, 5).translate(0, 1.5, 0), '#5b4330'));
      const canopy = new THREE.IcosahedronGeometry(2.6, 0);
      canopy.scale(1.3, 0.35, 1.3);
      canopy.translate(0, 3.4, 0);
      parts.push(colored(canopy, '#6d7a3a', 0.2));
      break;
    }
    case 'bush': {
      const b = new THREE.IcosahedronGeometry(1.1, 0);
      b.scale(1.2, 0.8, 1.2);
      b.translate(0, 0.7, 0);
      parts.push(colored(b, '#4d6b30', 0.3));
      break;
    }
  }
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  merged.computeVertexNormals();
  return merged;
}

export interface VegetationOptions {
  quality: QualitySettings;
  seed: number;
  /** Return true where vegetation must not grow (settlements, roads, deploy zones...). */
  exclude?: (x: number, z: number) => boolean;
  /** Override instance cap. */
  maxInstances?: number;
}

export class VegetationRenderer {
  readonly object = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly material: THREE.MeshStandardMaterial;
  private readonly uniforms = {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector3(1, 0, 0) },
    uWindStrength: { value: 0.3 },
    uTint: { value: new THREE.Color(1, 1, 1) },
  };

  constructor(hf: Heightfield, opts: VegetationOptions) {
    this.object.name = 'vegetation';
    const q = opts.quality;
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, flatShading: true });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec3 uWind;\nuniform float uWindStrength;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          #else
            vec3 ip = vec3(0.0);
          #endif
          float sway = max(0.0, transformed.y - 1.0) * 0.035 * uWindStrength;
          float ph = uTime * 1.7 + ip.x * 0.11 + ip.z * 0.07;
          transformed.xz += uWind.xz * sway * (sin(ph) * 0.7 + sin(ph * 2.3) * 0.3);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uTint;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= uTint;');
    };
    const cap = opts.maxInstances ?? Math.round(({ low: 4000, medium: 12000, high: 26000, ultra: 45000 } as const)[q.tier] * Math.min(1.5, q.vegetation.density));
    const lists: Record<Species, number[]> = { broadleaf: [], palm: [], acacia: [], bush: [] };
    const b = hf.bounds;
    const step = 5;
    let total = 0;
    // Pass 1: expected count -> scale density so the cap is spread over the whole map.
    let expected = 0;
    for (let z = b.minZ + step / 2; z < b.maxZ; z += step * 4) {
      for (let x = b.minX + step / 2; x < b.maxX; x += step * 4) {
        const veg = BIOME_VEG[hf.biomeAt(x, z)];
        if (veg) expected += veg.density * q.vegetation.density * ((step * step) / 100) * 16;
      }
    }
    const density = q.vegetation.density * Math.min(1, cap / Math.max(1, expected));
    outer: for (let z = b.minZ + step / 2; z < b.maxZ; z += step) {
      for (let x = b.minX + step / 2; x < b.maxX; x += step) {
        const ix = Math.round(x / step);
        const iz = Math.round(z / step);
        const r0 = hash2(ix, iz, opts.seed);
        const veg = BIOME_VEG[hf.biomeAt(x, z)];
        if (!veg) continue;
        const p = veg.density * density * ((step * step) / 100);
        void q;
        if (r0 >= p) continue;
        const jx = x + (hash2(ix, iz, opts.seed + 1) - 0.5) * step;
        const jz = z + (hash2(ix, iz, opts.seed + 2) - 0.5) * step;
        if (hf.isWater(jx, jz) || hf.slopeAt(jx, jz) > 0.6) continue;
        if (opts.exclude?.(jx, jz)) continue;
        const r1 = hash2(ix, iz, opts.seed + 3);
        let acc = 0;
        let sp: Species = 'bush';
        const mixTotal = Object.values(veg.mix).reduce((a, v) => a + (v ?? 0), 0);
        for (const s of SPECIES) {
          acc += (veg.mix[s] ?? 0) / mixTotal;
          if (r1 < acc) {
            sp = s;
            break;
          }
        }
        lists[sp].push(jx, jz, hash2(ix, iz, opts.seed + 4), hash2(ix, iz, opts.seed + 5));
        if (++total >= cap) break outer;
      }
    }
    const m = new THREE.Matrix4();
    const qrot = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const s of SPECIES) {
      const arr = lists[s];
      const n = arr.length / 4;
      if (n === 0) continue;
      const geo = speciesGeometry(s);
      const mesh = new THREE.InstancedMesh(geo, this.material, n);
      for (let i = 0; i < n; i++) {
        const x = arr[i * 4] as number;
        const z = arr[i * 4 + 1] as number;
        const sc = 0.7 + (arr[i * 4 + 2] as number) * 0.7;
        qrot.setFromAxisAngle(up, (arr[i * 4 + 3] as number) * Math.PI * 2);
        pos.set(x, hf.heightAt(x, z) - 0.2, z);
        scl.set(sc, sc * (0.85 + (arr[i * 4 + 2] as number) * 0.3), sc);
        m.compose(pos, qrot, scl);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = q.shadows.enabled;
      mesh.receiveShadow = true;
      mesh.name = `veg_${s}`;
      mesh.computeBoundingSphere();
      this.meshes.push(mesh);
      this.object.add(mesh);
    }
  }

  get instanceCount(): number {
    return this.meshes.reduce((a, m) => a + m.count, 0);
  }

  setEnvironment(env: EnvironmentState, wind: THREE.Vector3, windStrength: number): void {
    const t = SEASON_TINT[env.season];
    this.uniforms.uTint.value.setRGB(t[0], t[1], t[2]);
    this.uniforms.uWind.value.copy(wind);
    this.uniforms.uWindStrength.value = 0.3 + windStrength;
  }

  update(dt: number): void {
    this.uniforms.uTime.value += dt;
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      m.dispose();
    }
    this.material.dispose();
  }
}
