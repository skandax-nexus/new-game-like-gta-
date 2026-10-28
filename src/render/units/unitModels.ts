/**
 * Procedural unit models with per-vertex animation attributes for GPU skinning-free animation.
 * OWNER: Lead Graphics Engineer (+ Art Director silhouettes). Baseline by the CTO.
 *
 * Vertex attributes (all geometries):
 *   position, normal, color      - base look
 *   aPart  (float)               - PART.* id driving the vertex-shader animation
 *   aPivot (vec3)                - rotation pivot of the part (model space)
 *   aTeam  (float 0..1)          - mask where the faction color replaces the base color
 * Models face +Z, feet at y = 0, 1 unit = 1 m. Distinct silhouettes per class (GDD art goal):
 * spear + tall shield, bow, scale-armored guard with round shield, horse rider, chariot, elephant
 * with howdah, engineer with tools, light rider with javelins, ox cart.
 *
 * TODO(owner): LOD1/LOD2 geometries + impostor atlas, cloth/sash variety, helmets/turbans by faction,
 * banner poles for standard bearers (render/fx/banners.ts), better elephant/horse anatomy.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { UnitClass } from '../../core/types';

export const PART = {
  torso: 0,
  legL: 1,
  legR: 2,
  armL: 3,
  armR: 4,
  weapon: 5,
  mountBody: 6,
  mountLegsFront: 7,
  mountLegsBack: 8,
  static: 9,
  shield: 10,
  wheel: 11,
} as const;

const SKIN = '#9a6646';
const CLOTH = '#e6dcc4';
const DARK_CLOTH = '#5b4a3a';
const METAL = '#9a9a92';
const BRONZE = '#a57a3a';
const WOOD = '#6b4426';
const HORSE = '#6e4a32';
const ELEPHANT = '#7d7670';
const IVORY = '#ece3cc';

const tmpC = new THREE.Color();

class ModelBuilder {
  private parts: THREE.BufferGeometry[] = [];

  add(geo: THREE.BufferGeometry, color: string, part: number, pivot: [number, number, number], team = 0): this {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g.getAttribute('uv')) g.deleteAttribute('uv');
    g.computeVertexNormals();
    const n = g.getAttribute('position').count;
    tmpC.set(color);
    const col = new Float32Array(n * 3);
    const aPart = new Float32Array(n);
    const aPivot = new Float32Array(n * 3);
    const aTeam = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      col[i * 3] = tmpC.r;
      col[i * 3 + 1] = tmpC.g;
      col[i * 3 + 2] = tmpC.b;
      aPart[i] = part;
      aPivot[i * 3] = pivot[0];
      aPivot[i * 3 + 1] = pivot[1];
      aPivot[i * 3 + 2] = pivot[2];
      aTeam[i] = team;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aPart', new THREE.BufferAttribute(aPart, 1));
    g.setAttribute('aPivot', new THREE.BufferAttribute(aPivot, 3));
    g.setAttribute('aTeam', new THREE.BufferAttribute(aTeam, 1));
    this.parts.push(g);
    return this;
  }

  box(w: number, h: number, d: number, x: number, y: number, z: number, color: string, part: number, pivot: [number, number, number], team = 0, rotX = 0): this {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rotX) g.rotateX(rotX);
    g.translate(x, y, z);
    return this.add(g, color, part, pivot, team);
  }

  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

interface HumanOpts {
  y: number;
  seated?: boolean;
  weapon: 'spear' | 'bow' | 'sword' | 'tools' | 'javelin' | 'none';
  shield: 'none' | 'tall' | 'round' | 'small';
  armor: 'none' | 'quilted' | 'scale';
  headgear: 'turban' | 'helmet' | 'none' | 'crested';
  scale?: number;
}

/** Human figure (~1.7 m) with animatable limbs. */
function human(b: ModelBuilder, o: HumanOpts): void {
  const y = o.y;
  const s = o.scale ?? 1;
  const hip = y + 0.88 * s;
  const shoulder = y + 1.45 * s;
  // Legs
  if (o.seated) {
    b.box(0.16 * s, 0.5 * s, 0.18 * s, -0.22 * s, hip - 0.15 * s, 0.1 * s, CLOTH, PART.torso, [0, hip, 0]);
    b.box(0.16 * s, 0.5 * s, 0.18 * s, 0.22 * s, hip - 0.15 * s, 0.1 * s, CLOTH, PART.torso, [0, hip, 0]);
  } else {
    b.box(0.17 * s, 0.86 * s, 0.19 * s, -0.11 * s, y + 0.44 * s, 0, CLOTH, PART.legL, [-0.11 * s, hip, 0]);
    b.box(0.17 * s, 0.86 * s, 0.19 * s, 0.11 * s, y + 0.44 * s, 0, CLOTH, PART.legR, [0.11 * s, hip, 0]);
  }
  // Torso + belt (team sash)
  const torsoColor = o.armor === 'scale' ? BRONZE : o.armor === 'quilted' ? '#cdb991' : SKIN;
  b.box(0.44 * s, 0.6 * s, 0.25 * s, 0, hip + 0.3 * s, 0, torsoColor, PART.torso, [0, hip, 0]);
  b.box(0.46 * s, 0.13 * s, 0.27 * s, 0, hip + 0.03 * s, 0, CLOTH, PART.torso, [0, hip, 0], 1);
  b.box(0.12 * s, 0.6 * s, 0.05 * s, 0.1 * s, hip + 0.3 * s, 0.13 * s, CLOTH, PART.torso, [0, hip, 0], 1);
  // Head + headgear
  const head = new THREE.SphereGeometry(0.12 * s, 8, 6);
  head.translate(0, shoulder + 0.18 * s, 0);
  b.add(head, SKIN, PART.torso, [0, hip, 0]);
  if (o.headgear === 'turban') {
    const t = new THREE.CylinderGeometry(0.13 * s, 0.135 * s, 0.13 * s, 8);
    t.translate(0, shoulder + 0.27 * s, -0.01 * s);
    b.add(t, CLOTH, PART.torso, [0, hip, 0], 1);
  } else if (o.headgear === 'helmet' || o.headgear === 'crested') {
    const h = new THREE.SphereGeometry(0.14 * s, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    h.translate(0, shoulder + 0.2 * s, 0);
    b.add(h, METAL, PART.torso, [0, hip, 0]);
    if (o.headgear === 'crested') b.box(0.04 * s, 0.14 * s, 0.22 * s, 0, shoulder + 0.38 * s, 0, CLOTH, PART.torso, [0, hip, 0], 1);
  }
  // Arms
  b.box(0.11 * s, 0.6 * s, 0.12 * s, -0.29 * s, shoulder - 0.28 * s, 0, SKIN, PART.armL, [-0.29 * s, shoulder, 0]);
  b.box(0.11 * s, 0.6 * s, 0.12 * s, 0.29 * s, shoulder - 0.28 * s, 0, SKIN, PART.armR, [0.29 * s, shoulder, 0]);
  const handY = shoulder - 0.56 * s;
  // Weapons (move with the right arm)
  const rp: [number, number, number] = [0.29 * s, shoulder, 0];
  const lp: [number, number, number] = [-0.29 * s, shoulder, 0];
  switch (o.weapon) {
    case 'spear': {
      const sp = new THREE.CylinderGeometry(0.018 * s, 0.022 * s, 2.7 * s, 5);
      sp.translate(0.31 * s, handY + 0.6 * s, 0.05 * s);
      b.add(sp, WOOD, PART.weapon, rp);
      const tip = new THREE.ConeGeometry(0.045 * s, 0.24 * s, 5);
      tip.translate(0.31 * s, handY + 2.05 * s, 0.05 * s);
      b.add(tip, METAL, PART.weapon, rp);
      break;
    }
    case 'javelin': {
      const jv = new THREE.CylinderGeometry(0.014 * s, 0.016 * s, 1.5 * s, 4);
      jv.rotateX(-0.4);
      jv.translate(0.31 * s, handY + 0.35 * s, 0.1 * s);
      b.add(jv, WOOD, PART.weapon, rp);
      break;
    }
    case 'sword':
      b.box(0.05 * s, 0.75 * s, 0.02 * s, 0.31 * s, handY - 0.28 * s, 0.08 * s, METAL, PART.weapon, rp);
      break;
    case 'tools':
      b.box(0.04 * s, 0.7 * s, 0.04 * s, 0.31 * s, handY - 0.05 * s, 0.05 * s, WOOD, PART.weapon, rp).box(0.22 * s, 0.1 * s, 0.08 * s, 0.31 * s, handY + 0.3 * s, 0.05 * s, METAL, PART.weapon, rp);
      break;
    case 'bow': {
      const bow = new THREE.TorusGeometry(0.62 * s, 0.018 * s, 4, 12, Math.PI * 0.9);
      bow.rotateZ(Math.PI / 2 - Math.PI * 0.45);
      bow.rotateY(Math.PI / 2);
      bow.translate(-0.33 * s, handY + 0.05 * s, 0.08 * s);
      b.add(bow, WOOD, PART.armL, lp);
      b.box(0.12 * s, 0.5 * s, 0.12 * s, 0.05 * s, hip + 0.45 * s, -0.17 * s, DARK_CLOTH, PART.torso, [0, hip, 0], 1);
      break;
    }
    default:
      break;
  }
  if (o.shield === 'tall') b.box(0.5 * s, 1.15 * s, 0.05 * s, -0.36 * s, hip + 0.2 * s, 0.2 * s, WOOD, PART.shield, lp, 1);
  else if (o.shield === 'round' || o.shield === 'small') {
    const r = (o.shield === 'round' ? 0.33 : 0.22) * s;
    const sh = new THREE.CylinderGeometry(r, r, 0.05 * s, 12);
    sh.rotateX(Math.PI / 2);
    sh.translate(-0.37 * s, hip + 0.25 * s, 0.17 * s);
    b.add(sh, BRONZE, PART.shield, lp, 1);
  }
}

function horse(b: ModelBuilder, x: number, z: number, color = HORSE): void {
  const bodyY = 1.25;
  b.box(0.5, 0.62, 1.55, x, bodyY, z, color, PART.mountBody, [x, 0, z]);
  b.box(0.26, 0.7, 0.32, x, bodyY + 0.42, z + 0.82, color, PART.mountBody, [x, 0, z], 0, -0.6);
  b.box(0.22, 0.24, 0.55, x, bodyY + 0.82, z + 1.15, color, PART.mountBody, [x, 0, z]);
  b.box(0.52, 0.12, 0.7, x, bodyY + 0.36, z - 0.05, CLOTH, PART.mountBody, [x, 0, z], 1);
  for (const [lx, lz, part] of [
    [-0.17, 0.6, PART.mountLegsFront],
    [0.17, 0.6, PART.mountLegsBack],
    [-0.17, -0.6, PART.mountLegsBack],
    [0.17, -0.6, PART.mountLegsFront],
  ] as const)
    b.box(0.12, 0.98, 0.14, x + lx, 0.5, z + lz, color, part, [x + lx, 0.98, z + lz]);
  b.box(0.08, 0.6, 0.1, x, bodyY - 0.05, z - 0.85, '#2b1d14', PART.mountBody, [x, 0, z], 0, 0.4);
}

function wheel(b: ModelBuilder, x: number, y: number, z: number, r: number): void {
  const w = new THREE.TorusGeometry(r, 0.05, 4, 12);
  w.rotateY(Math.PI / 2);
  w.translate(x, y, z);
  b.add(w, WOOD, PART.wheel, [x, y, z]);
  const hub = new THREE.CylinderGeometry(0.06, 0.06, 0.2, 6);
  hub.rotateZ(Math.PI / 2);
  hub.translate(x, y, z);
  b.add(hub, WOOD, PART.wheel, [x, y, z]);
  for (let i = 0; i < 4; i++) {
    const sp = new THREE.BoxGeometry(0.03, r * 2, 0.03);
    sp.rotateX((i / 4) * Math.PI);
    sp.translate(x, y, z);
    b.add(sp, WOOD, PART.wheel, [x, y, z]);
  }
}

function elephant(b: ModelBuilder): void {
  const body = new THREE.SphereGeometry(1, 12, 8);
  body.scale(1.05, 1.0, 1.65);
  body.translate(0, 2.35, 0);
  b.add(body, ELEPHANT, PART.mountBody, [0, 0, 0]);
  const head = new THREE.SphereGeometry(0.75, 10, 8);
  head.translate(0, 2.7, 1.75);
  b.add(head, ELEPHANT, PART.mountBody, [0, 0, 0]);
  const trunk = new THREE.CylinderGeometry(0.12, 0.28, 1.9, 8);
  trunk.rotateX(0.25);
  trunk.translate(0, 1.75, 2.25);
  b.add(trunk, ELEPHANT, PART.mountBody, [0, 0, 0]);
  for (const sx of [-1, 1]) {
    b.box(0.08, 0.95, 0.85, sx * 0.72, 2.65, 1.55, '#6c645d', PART.mountBody, [0, 0, 0]);
    const tusk = new THREE.ConeGeometry(0.07, 0.9, 6);
    tusk.rotateX(Math.PI / 2 + 0.5);
    tusk.translate(sx * 0.3, 2.05, 2.4);
    b.add(tusk, IVORY, PART.mountBody, [0, 0, 0]);
  }
  for (const [lx, lz, part] of [
    [-0.55, 0.9, PART.mountLegsFront],
    [0.55, 0.9, PART.mountLegsBack],
    [-0.55, -0.9, PART.mountLegsBack],
    [0.55, -0.9, PART.mountLegsFront],
  ] as const) {
    const leg = new THREE.CylinderGeometry(0.3, 0.34, 1.7, 8);
    leg.translate(lx, 0.85, lz);
    b.add(leg, ELEPHANT, part, [lx, 1.7, lz]);
  }
  // Caparison + howdah (team colors).
  b.box(2.2, 1.0, 2.0, 0, 2.95, -0.1, CLOTH, PART.mountBody, [0, 0, 0], 1);
  b.box(1.5, 0.75, 1.6, 0, 3.75, -0.2, WOOD, PART.mountBody, [0, 0, 0]);
  b.box(1.6, 0.12, 1.7, 0, 4.15, -0.2, '#d9a441', PART.mountBody, [0, 0, 0]);
  human(b, { y: 3.4, seated: true, weapon: 'bow', shield: 'none', armor: 'quilted', headgear: 'turban', scale: 0.85 });
  human(b, { y: 2.9, seated: true, weapon: 'none', shield: 'none', armor: 'none', headgear: 'turban', scale: 0.75 });
}

/** Geometry for one model of a unit class (LOD0). Cache the result per class. */
export function buildUnitGeometry(cls: UnitClass): THREE.BufferGeometry {
  const b = new ModelBuilder();
  switch (cls) {
    case 'spearmen':
      human(b, { y: 0, weapon: 'spear', shield: 'tall', armor: 'quilted', headgear: 'turban' });
      break;
    case 'archers':
      human(b, { y: 0, weapon: 'bow', shield: 'none', armor: 'none', headgear: 'turban' });
      break;
    case 'elite_guards':
      human(b, { y: 0, weapon: 'sword', shield: 'round', armor: 'scale', headgear: 'crested', scale: 1.04 });
      break;
    case 'engineers':
      human(b, { y: 0, weapon: 'tools', shield: 'none', armor: 'none', headgear: 'turban' });
      b.box(0.36, 0.42, 0.2, 0, 1.1, -0.22, DARK_CLOTH, PART.torso, [0, 0.88, 0]);
      break;
    case 'cavalry':
      horse(b, 0, 0);
      human(b, { y: 0.85, seated: true, weapon: 'spear', shield: 'small', armor: 'quilted', headgear: 'helmet' });
      break;
    case 'scouts':
      horse(b, 0, 0, '#8a6a4a');
      human(b, { y: 0.85, seated: true, weapon: 'javelin', shield: 'small', armor: 'none', headgear: 'none' });
      break;
    case 'chariots':
      horse(b, -0.4, 2.0);
      horse(b, 0.4, 2.0);
      b.box(1.5, 0.12, 1.1, 0, 0.75, 0, WOOD, PART.static, [0, 0, 0]);
      b.box(1.5, 0.6, 0.08, 0, 1.08, 0.52, WOOD, PART.static, [0, 0, 0], 1);
      b.box(0.08, 0.5, 1.0, -0.72, 1.05, 0, WOOD, PART.static, [0, 0, 0]);
      b.box(0.08, 0.5, 1.0, 0.72, 1.05, 0, WOOD, PART.static, [0, 0, 0]);
      b.box(0.08, 0.08, 1.6, 0, 0.85, 1.2, WOOD, PART.static, [0, 0, 0]);
      wheel(b, -0.85, 0.6, -0.1, 0.6);
      wheel(b, 0.85, 0.6, -0.1, 0.6);
      human(b, { y: 0.8, weapon: 'none', shield: 'none', armor: 'scale', headgear: 'helmet', scale: 0.95 });
      human(b, { y: 0.8, weapon: 'bow', shield: 'none', armor: 'quilted', headgear: 'turban', scale: 0.95 });
      break;
    case 'war_elephants':
      elephant(b);
      break;
    case 'supply_train':
      b.box(1.6, 0.6, 2.6, 0, 1.0, -0.4, WOOD, PART.static, [0, 0, 0]);
      b.box(1.5, 0.5, 2.4, 0, 1.45, -0.4, '#c9b48a', PART.static, [0, 0, 0], 1);
      wheel(b, -0.9, 0.6, -0.6, 0.6);
      wheel(b, 0.9, 0.6, -0.6, 0.6);
      b.box(0.08, 0.08, 1.8, 0, 0.9, 1.6, WOOD, PART.static, [0, 0, 0]);
      for (const sx of [-0.45, 0.45]) {
        b.box(0.55, 0.65, 1.35, sx, 0.95, 2.5, '#d8d0c0', PART.mountBody, [sx, 0, 2.5]);
        b.box(0.3, 0.32, 0.45, sx, 1.1, 3.35, '#d8d0c0', PART.mountBody, [sx, 0, 2.5]);
        for (const [lx, lz, part] of [
          [-0.18, 2.95, PART.mountLegsFront],
          [0.18, 2.95, PART.mountLegsBack],
          [-0.18, 2.05, PART.mountLegsBack],
          [0.18, 2.05, PART.mountLegsFront],
        ] as const)
          b.box(0.12, 0.62, 0.12, sx + lx, 0.31, lz, '#cfc6b4', part, [sx + lx, 0.62, lz]);
      }
      human(b, { y: 0.9, seated: true, weapon: 'none', shield: 'none', armor: 'none', headgear: 'turban', scale: 0.9 });
      break;
  }
  return b.build();
}
