/**
 * Settlement renderer: instanced architecture pieces from SettlementLayouts.
 * OWNER: Lead Graphics Engineer. Baseline by the CTO.
 *
 * One InstancedMesh per (kind, style) - draw calls scale with variety, not building count.
 * TODO(owner): LOD/impostors for the strategic zoom, night window glow + lamps (bloom), smoke from
 * hearths, damage/fire states from SettlementState.damage, flags in owner colors.
 */
import * as THREE from 'three';
import type { ArchitectureKind, TerrainQuery } from '../../core/types';
import type { ArchitectureStyle, SettlementLayout } from './layout';
import { buildArchitectureGeometry } from './buildings';

const geometryCache = new Map<string, THREE.BufferGeometry>();

/** Shared geometry per (kind, style). Disposed via disposeArchitectureCache() when the app exits. */
export function getArchitectureGeometry(kind: ArchitectureKind, style: ArchitectureStyle): THREE.BufferGeometry {
  const key = `${kind}|${style}`;
  let g = geometryCache.get(key);
  if (!g) {
    g = buildArchitectureGeometry(kind, style);
    geometryCache.set(key, g);
  }
  return g;
}

export function disposeArchitectureCache(): void {
  for (const g of geometryCache.values()) g.dispose();
  geometryCache.clear();
}

export class SettlementRenderer {
  readonly object = new THREE.Group();
  readonly material: THREE.MeshStandardMaterial;
  private meshes: THREE.InstancedMesh[] = [];

  constructor(private readonly castShadows: boolean) {
    this.object.name = 'settlements';
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.02 });
  }

  /** Build instanced meshes for layouts (replaces previous content). */
  setLayouts(layouts: readonly SettlementLayout[], terrain: TerrainQuery): void {
    this.clear();
    const groups = new Map<string, { kind: ArchitectureKind; style: ArchitectureStyle; items: SettlementLayout['pieces'] }>();
    for (const l of layouts) {
      for (const p of l.pieces) {
        const key = `${p.kind}|${l.style}`;
        let g = groups.get(key);
        if (!g) {
          g = { kind: p.kind, style: l.style, items: [] };
          groups.set(key, g);
        }
        g.items.push(p);
      }
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const g of groups.values()) {
      const geo = getArchitectureGeometry(g.kind, g.style);
      const mesh = new THREE.InstancedMesh(geo, this.material, g.items.length);
      g.items.forEach((p, i) => {
        // Sit on the lowest corner so nothing floats on slopes.
        let y = Infinity;
        for (const [dx, dz] of [
          [-p.hx, -p.hz],
          [p.hx, -p.hz],
          [-p.hx, p.hz],
          [p.hx, p.hz],
          [0, 0],
        ] as const)
          y = Math.min(y, terrain.heightAt(p.x + dx, p.z + dz));
        if (g.kind === 'ghat' || g.kind === 'harbor_jetty') y = Math.max(y, terrain.spec.waterLevel + 0.5);
        pos.set(p.x, y - 0.05, p.z);
        q.setFromAxisAngle(up, p.rot);
        scl.setScalar(p.scale);
        m.compose(pos, q, scl);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = this.castShadows;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      mesh.name = `arch_${g.kind}_${g.style}`;
      this.meshes.push(mesh);
      this.object.add(mesh);
    }
  }

  get pieceCount(): number {
    return this.meshes.reduce((a, m) => a + m.count, 0);
  }

  private clear(): void {
    for (const m of this.meshes) {
      this.object.remove(m);
      m.dispose();
    }
    this.meshes = [];
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
  }
}
