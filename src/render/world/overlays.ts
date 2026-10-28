/**
 * Strategic map overlays: province borders, selection ring, move path, engagement markers.
 * OWNER: Lead Graphics Engineer (+ Lead UI/UX). Baseline by the CTO.
 * TODO(owner): terrain-conforming border decals with owner colors, supply line overlay, terrain
 * class overlay, fog of war by intel, animated path arrows.
 */
import * as THREE from 'three';
import type { ProvinceState, TerrainQuery, Vec2 } from '../../core/types';
import { FACTIONS } from '../../data/factions';
import { ACCENTS } from '../style/palette';

export class MapOverlays {
  readonly object = new THREE.Group();
  private readonly borders = new THREE.Group();
  private readonly selection: THREE.Mesh;
  private readonly pathLine: THREE.Line;
  private readonly pathGeo = new THREE.BufferGeometry();
  private readonly engagementMarkers: THREE.InstancedMesh;

  constructor(private readonly terrain: TerrainQuery) {
    this.object.name = 'map-overlays';
    const ringGeo = new THREE.RingGeometry(0.9, 1, 64);
    ringGeo.rotateX(-Math.PI / 2);
    this.selection = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: ACCENTS.select, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }));
    this.selection.visible = false;
    this.selection.renderOrder = 10;
    this.pathLine = new THREE.Line(this.pathGeo, new THREE.LineDashedMaterial({ color: ACCENTS.gold, dashSize: 30, gapSize: 18, toneMapped: false }));
    this.pathLine.visible = false;
    const crossed = new THREE.TorusGeometry(1, 0.15, 6, 24);
    crossed.rotateX(Math.PI / 2);
    this.engagementMarkers = new THREE.InstancedMesh(crossed, new THREE.MeshBasicMaterial({ color: ACCENTS.vermilion, toneMapped: false }), 32);
    this.engagementMarkers.count = 0;
    this.engagementMarkers.frustumCulled = false;
    this.object.add(this.borders, this.selection, this.pathLine, this.engagementMarkers);
  }

  setProvinces(provinces: Record<string, ProvinceState>): void {
    for (const c of [...this.borders.children]) {
      (c as THREE.Line).geometry.dispose();
      ((c as THREE.Line).material as THREE.Material).dispose();
      this.borders.remove(c);
    }
    for (const id of Object.keys(provinces).sort()) {
      const p = provinces[id]!;
      const pts: THREE.Vector3[] = [];
      const poly = [...p.boundary, p.boundary[0]!];
      for (let i = 0; i < poly.length - 1; i++) {
        const a = poly[i]!;
        const b = poly[i + 1]!;
        for (let k = 0; k < 8; k++) {
          const t = k / 8;
          const x = a.x + (b.x - a.x) * t;
          const z = a.z + (b.z - a.z) * t;
          pts.push(new THREE.Vector3(x, Math.max(this.terrain.heightAt(x, z), this.terrain.spec.waterLevel) + 3, z));
        }
      }
      const color = p.ownerFactionId ? (FACTIONS[p.ownerFactionId]?.colors.primary ?? '#ffffff') : '#d8d0c0';
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55, toneMapped: false }));
      this.borders.add(line);
    }
  }

  setBordersVisible(v: boolean): void {
    this.borders.visible = v;
  }

  setSelection(x: number | null, z: number | null, radius: number): void {
    if (x === null || z === null) {
      this.selection.visible = false;
      return;
    }
    this.selection.visible = true;
    this.selection.position.set(x, this.terrain.heightAt(x, z) + 2, z);
    this.selection.scale.setScalar(radius);
  }

  setPath(points: readonly Vec2[] | null, from: Vec2 | null): void {
    if (!points || points.length === 0 || !from) {
      this.pathLine.visible = false;
      return;
    }
    const pts = [from, ...points].map((p) => new THREE.Vector3(p.x, this.terrain.heightAt(p.x, p.z) + 4, p.z));
    this.pathGeo.setFromPoints(pts);
    this.pathLine.computeLineDistances();
    this.pathLine.visible = true;
  }

  setEngagements(points: readonly Vec2[], time: number): void {
    const m = new THREE.Matrix4();
    let n = 0;
    for (const p of points) {
      if (n >= 32) break;
      const s = 40 + Math.sin(time * 4) * 6;
      m.makeScale(s, s, s).setPosition(p.x, this.terrain.heightAt(p.x, p.z) + 6, p.z);
      this.engagementMarkers.setMatrixAt(n++, m);
    }
    this.engagementMarkers.count = n;
    this.engagementMarkers.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.setProvinces({});
    this.selection.geometry.dispose();
    (this.selection.material as THREE.Material).dispose();
    this.pathGeo.dispose();
    (this.pathLine.material as THREE.Material).dispose();
    this.engagementMarkers.geometry.dispose();
    (this.engagementMarkers.material as THREE.Material).dispose();
    this.engagementMarkers.dispose();
  }
}
