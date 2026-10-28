/**
 * Procedural ancient-Indian-inspired architecture pieces (merged, vertex-colored geometry; origin at
 * ground center, front facing +Z). OWNER: Lead Graphics Engineer (+ Art Director for forms/palette).
 * Baseline by the CTO: recognizable silhouettes for every ArchitectureKind.
 *
 * TODO(owner): carved detail via normal maps, curvilinear shikhara with urushringa clusters, jali
 * screens, torana gate carvings, roof tiles, weathering/AO baked into vertex colors, per-style
 * variations (brick vs stone vs timber), LODs, damaged/burnt variants for sieges.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ArchitectureKind } from '../../core/types';
import type { ArchitectureStyle } from './layout';
import { MATERIALS } from '../style/palette';

interface StylePalette {
  wall: string;
  wall2: string;
  roof: string;
  trim: string;
  stone: string;
  wood: string;
}

export const STYLE_PALETTES: Readonly<Record<ArchitectureStyle, StylePalette>> = {
  heartland_brick: { wall: MATERIALS.limeWash, wall2: MATERIALS.brick, roof: MATERIALS.terracotta, trim: MATERIALS.gold, stone: MATERIALS.sandstone, wood: MATERIALS.teak },
  highland_stone: { wall: MATERIALS.granite, wall2: MATERIALS.sandstone, roof: MATERIALS.laterite, trim: MATERIALS.bronze, stone: MATERIALS.granite, wood: MATERIALS.teak },
  coastal_timber: { wall: MATERIALS.limeWash, wall2: MATERIALS.teak, roof: MATERIALS.terracotta, trim: MATERIALS.gold, stone: MATERIALS.sandstone, wood: MATERIALS.teak },
  forest_timber: { wall: MATERIALS.mudPlaster, wall2: MATERIALS.teak, roof: MATERIALS.thatch, trim: MATERIALS.bronze, stone: MATERIALS.laterite, wood: MATERIALS.teak },
  frontier_mud: { wall: MATERIALS.mudPlaster, wall2: MATERIALS.sandstone, roof: MATERIALS.mudPlaster, trim: MATERIALS.terracotta, stone: MATERIALS.sandstone, wood: MATERIALS.teak },
  city_sandstone: { wall: MATERIALS.redSandstone, wall2: MATERIALS.sandstone, roof: MATERIALS.redSandstone, trim: MATERIALS.gold, stone: MATERIALS.redSandstone, wood: MATERIALS.teak },
};

const tmpColor = new THREE.Color();

function paint(geo: THREE.BufferGeometry, hex: string, shade = 1): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  tmpColor.set(hex).multiplyScalar(shade);
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = tmpColor.r;
    col[i * 3 + 1] = tmpColor.g;
    col[i * 3 + 2] = tmpColor.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  if (g.getAttribute('normal')) g.deleteAttribute('normal');
  return g;
}

class Builder {
  readonly parts: THREE.BufferGeometry[] = [];
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: string, rotY = 0): this {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rotY) g.rotateY(rotY);
    g.translate(x, y + h / 2, z);
    this.parts.push(paint(g, color));
    return this;
  }
  cyl(rTop: number, rBot: number, h: number, x: number, y: number, z: number, color: string, seg = 10, open = false): this {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
    g.translate(x, y + h / 2, z);
    this.parts.push(paint(g, color));
    return this;
  }
  cone(r: number, h: number, x: number, y: number, z: number, color: string, seg = 4, rotY = Math.PI / 4): this {
    const g = new THREE.ConeGeometry(r, h, seg);
    g.rotateY(rotY);
    g.translate(x, y + h / 2, z);
    this.parts.push(paint(g, color));
    return this;
  }
  dome(r: number, x: number, y: number, z: number, color: string, squash = 1, seg = 12): this {
    const g = new THREE.SphereGeometry(r, seg, Math.max(4, seg / 2), 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(1, squash, 1);
    g.translate(x, y, z);
    this.parts.push(paint(g, color));
    return this;
  }
  /** Gable roof prism along X. */
  gable(w: number, h: number, d: number, x: number, y: number, z: number, color: string): this {
    const g = new THREE.CylinderGeometry(d / Math.sqrt(3), d / Math.sqrt(3), w, 3, 1);
    g.rotateZ(Math.PI / 2);
    g.rotateX(Math.PI);
    g.scale(1, (h / (d / Math.sqrt(3))) * 0.67, 1);
    g.translate(x, y + h * 0.33, z);
    this.parts.push(paint(g, color));
    return this;
  }
  lathe(points: [number, number][], x: number, y: number, z: number, color: string, seg = 12): this {
    const g = new THREE.LatheGeometry(
      points.map(([r, h]) => new THREE.Vector2(r, h)),
      seg,
    );
    g.translate(x, y, z);
    this.parts.push(paint(g, color));
    return this;
  }
  pillars(n: number, radius: number, h: number, y: number, color: string, r = 0.3, square = false): this {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.PI / n;
      const x = Math.sin(a) * radius;
      const z = Math.cos(a) * radius;
      if (square) this.box(r * 2, h, r * 2, x, y, z, color);
      else this.cyl(r * 0.85, r, h, x, y, z, color, 8);
    }
    return this;
  }
  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

const DARK = '#2a1d16';

function chhatri(b: Builder, x: number, y: number, z: number, s: number, p: StylePalette): void {
  b.box(3.4 * s, 0.4 * s, 3.4 * s, x, y, z, p.stone);
  for (const [dx, dz] of [
    [-1.3, -1.3],
    [1.3, -1.3],
    [-1.3, 1.3],
    [1.3, 1.3],
  ] as const)
    b.cyl(0.18 * s, 0.22 * s, 2.4 * s, x + dx * s, y + 0.4 * s, z + dz * s, p.stone, 6);
  b.box(3.8 * s, 0.35 * s, 3.8 * s, x, y + 2.8 * s, z, p.stone);
  b.dome(1.6 * s, x, y + 3.15 * s, z, p.wall, 1.05);
  b.cyl(0.08 * s, 0.25 * s, 0.7 * s, x, y + 4.7 * s, z, p.trim, 6);
}

/** Build geometry for an architecture kind in a style. Deterministic; cache by (kind, style). */
export function buildArchitectureGeometry(kind: ArchitectureKind, style: ArchitectureStyle): THREE.BufferGeometry {
  const p = STYLE_PALETTES[style];
  const b = new Builder();
  switch (kind) {
    case 'thatch_hut':
      b.cyl(2.1, 2.2, 2.1, 0, 0, 0, MATERIALS.mudPlaster, 10).cone(2.9, 2.5, 0, 2.0, 0, MATERIALS.thatch, 10, 0).box(0.9, 1.5, 0.2, 0, 0, 2.1, DARK);
      break;
    case 'mud_house':
      b.box(5.2, 2.8, 4.2, 0, 0, 0, p.wall === MATERIALS.granite ? MATERIALS.mudPlaster : p.wall)
        .box(5.6, 0.25, 0.3, 0, 0.1, 2.15, MATERIALS.terracotta)
        .cone(4.4, 2.2, 0, 2.8, 0, MATERIALS.thatch, 4)
        .box(1, 1.8, 0.2, 0, 0, 2.15, DARK);
      break;
    case 'brick_house':
      b.box(6.2, 3.6, 5.2, 0, 0, 0, p.wall2)
        .box(6.6, 0.4, 5.6, 0, 3.6, 0, p.stone)
        .box(3.4, 2.4, 3.2, -1.2, 4, -0.6, p.wall)
        .box(3.8, 0.3, 3.6, -1.2, 6.4, -0.6, p.roof)
        .box(1.1, 2.0, 0.2, 0.8, 0, 2.62, DARK)
        .box(0.8, 0.8, 0.2, -1.8, 1.6, 2.62, DARK);
      break;
    case 'mansion':
      b.box(12, 1, 11, 0, 0, 0, p.stone)
        .box(10.5, 5, 9.5, 0, 1, 0, p.wall)
        .box(11, 0.5, 10, 0, 6, 0, p.stone)
        .box(6, 3.4, 5.5, 0, 6.5, 0, p.wall)
        .box(6.6, 0.4, 6.2, 0, 9.9, 0, p.roof)
        .box(2, 3, 0.3, 0, 1, 4.8, DARK);
      chhatri(b, -4, 6.5, -3.5, 0.6, p);
      chhatri(b, 4, 6.5, -3.5, 0.6, p);
      break;
    case 'granary':
      for (const [x, z] of [
        [-3.4, -2],
        [0, -2],
        [3.4, -2],
        [-3.4, 2],
        [0, 2],
        [3.4, 2],
      ] as const)
        b.cyl(0.25, 0.3, 1.4, x, 0, z, p.wood, 6);
      b.box(8.6, 3.2, 5.4, 0, 1.4, 0, MATERIALS.mudPlaster).gable(9.4, 2.6, 6.4, 0, 4.6, 0, MATERIALS.thatch).box(1.2, 1.6, 0.2, 0, 1.6, 2.75, DARK);
      break;
    case 'stupa':
      b.cyl(11, 11, 0.8, 0, 0, 0, p.stone, 24)
        .cyl(10.3, 10.3, 1.4, 0, 0.8, 0, MATERIALS.sandstone, 32, true)
        .cyl(7.4, 7.6, 2.4, 0, 0.8, 0, MATERIALS.sandstone, 24)
        .dome(7.0, 0, 3.2, 0, MATERIALS.limeWash, 0.92, 24)
        .box(2.4, 1.4, 2.4, 0, 9.6, 0, MATERIALS.sandstone)
        .cyl(0.12, 0.12, 3.4, 0, 11, 0, MATERIALS.bronze, 6)
        .cyl(1.4, 1.4, 0.18, 0, 11.6, 0, MATERIALS.sandstone, 12)
        .cyl(1.0, 1.0, 0.18, 0, 12.5, 0, MATERIALS.sandstone, 12)
        .cyl(0.7, 0.7, 0.18, 0, 13.3, 0, MATERIALS.sandstone, 12);
      for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        const x = Math.sin(a) * 11.6;
        const z = Math.cos(a) * 11.6;
        const tx = Math.cos(a) * 1.4;
        const tz = -Math.sin(a) * 1.4;
        b.box(0.5, 5, 0.5, x + tx, 0, z + tz, MATERIALS.sandstone).box(0.5, 5, 0.5, x - tx, 0, z - tz, MATERIALS.sandstone);
        for (const y of [3.6, 4.3, 5.0]) b.box(Math.abs(tx) * 2 + 1.2, 0.35, Math.abs(tz) * 2 + 1.2, x, y, z, MATERIALS.sandstone);
      }
      break;
    case 'shikhara_temple':
    case 'shrine': {
      const s = kind === 'shrine' ? 0.42 : 1;
      b.box(15 * s, 1.6 * s, 17 * s, 0, 0, 0, p.stone);
      // Mandapa (hall) with pyramidal roof.
      b.box(8 * s, 4 * s, 7 * s, 0, 1.6 * s, 4 * s, p.wall2).cone(6.4 * s, 3.2 * s, 0, 5.6 * s, 4 * s, p.roof, 4);
      for (const x of [-3, -1, 1, 3]) b.cyl(0.25 * s, 0.3 * s, 3.4 * s, x * s, 1.6 * s, 7.8 * s, p.stone, 6);
      // Garbhagriha + curvilinear shikhara (lathe profile) + amalaka + kalasha.
      b.box(7.5 * s, 5 * s, 7.5 * s, 0, 1.6 * s, -3.5 * s, p.wall2);
      b.lathe(
        [
          [0.01, 0],
          [5.0, 0],
          [4.9, 2.5],
          [4.5, 5.2],
          [3.8, 7.8],
          [2.8, 10],
          [1.8, 11.6],
          [0.9, 12.4],
          [0.01, 12.6],
        ].map(([r, h]) => [r * s, h * s] as [number, number]),
        0,
        6.6 * s,
        -3.5 * s,
        p.stone,
        8,
      );
      b.cyl(1.5 * s, 1.5 * s, 0.7 * s, 0, 19 * s, -3.5 * s, p.stone, 16).dome(0.6 * s, 0, 19.7 * s, -3.5 * s, MATERIALS.gold, 1.4, 8);
      b.box(1.4 * s, 2.6 * s, 0.3 * s, 0, 1.6 * s, 7.6 * s, DARK);
      break;
    }
    case 'palace': {
      b.box(46, 2, 34, 0, 0, 0, p.stone)
        .box(44, 0.4, 32, 0, 2, 0, MATERIALS.sandstone)
        .box(34, 8, 18, 0, 2.4, -4, p.wall)
        .box(35.5, 0.7, 19.5, 0, 10.4, -4, p.stone)
        .box(18, 5, 10, 0, 11.1, -5, p.wall)
        .box(19, 0.6, 11, 0, 16.1, -5, p.roof);
      // Colonnade (pillared hall front).
      for (let i = -7; i <= 7; i++) b.cyl(0.38, 0.45, 7.6, i * 2.3, 2.4, 6.6, p.stone, 8);
      b.box(36, 0.8, 4.4, 0, 10, 6.6, p.stone);
      // Steps.
      for (let i = 0; i < 4; i++) b.box(12 - i, 0.5, 1.2, 0, i * 0.5, 17.6 - i * 1.1, MATERIALS.sandstone);
      chhatri(b, -15, 10.8, -11, 1, p);
      chhatri(b, 15, 10.8, -11, 1, p);
      chhatri(b, -7, 16.7, -8, 0.8, p);
      chhatri(b, 7, 16.7, -8, 0.8, p);
      b.dome(3.4, 0, 16.7, -5, MATERIALS.limeWash, 1.15, 16).cyl(0.12, 0.45, 1.6, 0, 20.5, -5, MATERIALS.gold, 8);
      b.box(4, 5.6, 0.4, 0, 2.4, 5.0, DARK);
      break;
    }
    case 'chhatri':
      chhatri(b, 0, 0, 0, 1, p);
      break;
    case 'pavilion':
      b.box(10, 1, 10, 0, 0, 0, p.stone).pillars(8, 4, 3.8, 1, p.stone, 0.28).box(10.6, 0.6, 10.6, 0, 4.8, 0, p.roof).cone(7.2, 2, 0, 5.4, 0, p.roof, 4);
      break;
    case 'fort_wall':
      b.box(14, 7, 3.2, 0, 0, 0, p.stone === MATERIALS.sandstone ? MATERIALS.laterite : p.stone).box(14, 0.6, 3.6, 0, 7, 0, MATERIALS.sandstone);
      for (let i = -3; i <= 3; i++) b.box(1.2, 1.3, 0.8, i * 2, 7.6, 1.4, MATERIALS.laterite);
      break;
    case 'fort_gate':
      b.cyl(3.6, 4, 12, -6.5, 0, 0, MATERIALS.laterite, 12).cyl(3.6, 4, 12, 6.5, 0, 0, MATERIALS.laterite, 12);
      b.dome(3.0, -6.5, 12, 0, p.wall, 1.1, 12).dome(3.0, 6.5, 12, 0, p.wall, 1.1, 12);
      b.box(9.5, 11, 6, 0, 0, 0, MATERIALS.laterite).box(5, 7, 0.4, 0, 0, 3.1, DARK).box(10.5, 0.8, 7, 0, 11, 0, MATERIALS.sandstone);
      chhatri(b, 0, 11.8, 0, 0.8, p);
      break;
    case 'tower':
      b.cyl(3.2, 3.8, 11, 0, 0, 0, MATERIALS.laterite, 12).cyl(3.9, 3.9, 0.8, 0, 11, 0, MATERIALS.sandstone, 12);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        b.box(1, 1.2, 1, Math.sin(a) * 3.4, 11.8, Math.cos(a) * 3.4, MATERIALS.laterite);
      }
      b.dome(2, 0, 11.8, 0, p.wall, 1.1, 10);
      break;
    case 'ghat':
      for (let i = 0; i < 7; i++) b.box(22, 0.55, 2, 0, -i * 0.55, -5 + i * 1.6, MATERIALS.sandstone);
      chhatri(b, -9, 0, -6, 0.7, p);
      chhatri(b, 9, 0, -6, 0.7, p);
      break;
    case 'stepwell':
      b.box(14, 0.8, 1, 0, 0, -6.5, MATERIALS.sandstone).box(14, 0.8, 1, 0, 0, 6.5, MATERIALS.sandstone).box(1, 0.8, 12, -6.5, 0, 0, MATERIALS.sandstone).box(1, 0.8, 12, 6.5, 0, 0, MATERIALS.sandstone);
      for (let i = 0; i < 5; i++) b.box(12 - i * 2.2, 0.4, 12 - i * 2.2, 0, -0.4 - i * 0.9, 0, i % 2 ? MATERIALS.sandstone : MATERIALS.redSandstone);
      b.box(2.6, 0.2, 2.6, 0, -5, 0, MATERIALS.waterShallow);
      chhatri(b, 0, 0.8, -6.5, 0.6, p);
      break;
    case 'well':
      b.cyl(1.3, 1.4, 0.9, 0, 0, 0, MATERIALS.sandstone, 12).cyl(1.0, 1.0, 0.92, 0, 0, 0, DARK, 12, true).box(0.2, 2.2, 0.2, -1.2, 0, 0, p.wood).box(0.2, 2.2, 0.2, 1.2, 0, 0, p.wood).box(2.8, 0.18, 0.18, 0, 2.1, 0, p.wood);
      break;
    case 'market_stall': {
      const cloth = ['#e8892b', '#33407a', '#d4452b', '#e9b949'][(kind.length * 7) % 4] as string;
      for (const [x, z] of [
        [-1.4, -1.2],
        [1.4, -1.2],
        [-1.4, 1.2],
        [1.4, 1.2],
      ] as const)
        b.box(0.14, 2.4, 0.14, x, 0, z, p.wood);
      b.box(3.4, 0.08, 3, 0, 2.4, 0, cloth).box(2.6, 0.8, 1.2, 0, 0, 0.4, p.wood).box(2.4, 0.3, 1, 0, 0.8, 0.4, '#c9a24a');
      break;
    }
    case 'barracks':
      b.box(18, 3.6, 7, 0, 0, 0, MATERIALS.mudPlaster).gable(19, 2.6, 8, 0, 3.6, 0, MATERIALS.thatch).box(1.4, 2.2, 0.2, -5, 0, 3.6, DARK).box(1.4, 2.2, 0.2, 5, 0, 3.6, DARK);
      break;
    case 'stable':
      b.box(16, 3.2, 0.5, 0, 0, -3, p.wood).box(0.5, 3.2, 6, -8, 0, 0, p.wood).box(0.5, 3.2, 6, 8, 0, 0, p.wood);
      for (let i = -3; i <= 3; i++) b.box(0.3, 3.2, 0.3, i * 2.6, 0, 3, p.wood);
      b.gable(17, 2.2, 7, 0, 3.2, 0, MATERIALS.thatch);
      break;
    case 'workshop':
      b.box(7, 3.4, 6, 0, 0, 0, MATERIALS.mudPlaster).cone(5.4, 1.8, 0, 3.4, 0, MATERIALS.terracotta, 4).cyl(0.9, 1.2, 2.4, 4.6, 0, 1.5, MATERIALS.brick, 8).box(1.2, 2, 0.2, 0, 0, 3.05, DARK);
      break;
    case 'pillar':
      b.box(2.2, 0.8, 2.2, 0, 0, 0, MATERIALS.sandstone)
        .cyl(0.42, 0.5, 11, 0, 0.8, 0, '#d9c49a', 14)
        .lathe(
          [
            [0.4, 0],
            [0.85, 0.6],
            [0.95, 1.1],
            [0.6, 1.2],
          ],
          0,
          11.8,
          0,
          '#d9c49a',
          14,
        )
        .cyl(1.0, 1.0, 0.45, 0, 13, 0, '#d9c49a', 16)
        .dome(0.7, 0, 13.45, 0, MATERIALS.gold, 1.2, 10);
      break;
    case 'harbor_jetty':
      b.box(4, 0.4, 20, 0, 0.6, 10, p.wood);
      for (let i = 0; i < 6; i++) b.cyl(0.18, 0.18, 2.5, i % 2 ? 1.8 : -1.8, -1.5, 2 + i * 3.4, p.wood, 6);
      b.box(2.4, 1.0, 9, 4.2, 0, 14, MATERIALS.teak).box(0.12, 5, 0.12, 4.2, 1, 14, p.wood);
      break;
    case 'bridge':
      b.box(7, 0.8, 30, 0, 1.6, 0, p.wood);
      for (let i = -2; i <= 2; i++) b.box(6, 3, 1.2, 0, -1.4, i * 7, MATERIALS.sandstone);
      break;
    case 'palisade':
      for (let i = -4; i <= 4; i++) b.cyl(0.02, 0.22, 3.6 + (i % 2) * 0.4, i * 1.1, 0, 0, p.wood, 5);
      break;
    case 'field_plot':
      b.box(30, 0.15, 20, 0, 0, 0, '#a8a24a');
      break;
  }
  return b.build();
}
