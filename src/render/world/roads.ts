/**
 * Road ribbons draped on the terrain from the strategic RoadGraph (+ bridges over water).
 * OWNER: Lead Graphics Engineer. Baseline by the CTO.
 * TODO(owner): textured dirt/paved materials with wheel ruts, damage state from edge.condition,
 * blending into terrain splat instead of geometry, milestone pillars on royal roads.
 */
import * as THREE from 'three';
import type { RoadGraph, TerrainQuery, Vec2 } from '../../core/types';
import { pointAlong, polylineLength } from '../../core/terrain/roads';
import { MATERIALS } from '../style/palette';

const WIDTH: Record<string, number> = { track: 5, road: 8, royal_road: 12 };

export class RoadRenderer {
  readonly object = new THREE.Group();
  private readonly material: THREE.MeshStandardMaterial;

  constructor(roads: RoadGraph, terrain: TerrainQuery) {
    this.object.name = 'roads';
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const dirt = new THREE.Color(MATERIALS.roadDirt);
    const paved = new THREE.Color(MATERIALS.roadPaved);
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const p: Vec2 = { x: 0, z: 0 };
    const q: Vec2 = { x: 0, z: 0 };
    for (const id of Object.keys(roads.edges).sort()) {
      const e = roads.edges[id]!;
      const pts = e.points;
      const len = polylineLength(pts);
      const w = (WIDTH[e.quality] ?? 6) / 2;
      const col = e.quality === 'royal_road' ? paved : dirt;
      const steps = Math.max(2, Math.ceil(len / 6));
      const base = positions.length / 3;
      for (let i = 0; i <= steps; i++) {
        const d = (i / steps) * len;
        pointAlong(pts, d, p);
        pointAlong(pts, Math.min(len, d + 1), q);
        let dx = q.x - p.x;
        let dz = q.z - p.z;
        if (i === steps) {
          pointAlong(pts, Math.max(0, d - 1), q);
          dx = p.x - q.x;
          dz = p.z - q.z;
        }
        const l = Math.hypot(dx, dz) || 1;
        const nx = -dz / l;
        const nz = dx / l;
        for (const side of [-1, 1]) {
          const x = p.x + nx * w * side;
          const z = p.z + nz * w * side;
          const water = terrain.spec.waterLevel;
          const h = terrain.heightAt(x, z);
          const y = h < water + 0.4 ? water + 1.2 : h + 0.12;
          positions.push(x, y, z);
          const shade = 0.92 + ((i * 7 + side * 3) % 5) * 0.03;
          colors.push(col.r * shade, col.g * shade, col.b * shade);
        }
        if (i < steps) {
          const a = base + i * 2;
          indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.receiveShadow = true;
    this.object.add(mesh);
  }

  dispose(): void {
    for (const c of this.object.children) (c as THREE.Mesh).geometry.dispose();
    this.material.dispose();
  }
}
