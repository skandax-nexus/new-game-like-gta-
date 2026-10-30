/**
 * Surface lab: `?scene=lab&lab=surface`. OWNER: Graphics Developer - Lighting, Atmosphere & Post (GFX-01).
 *
 * The GFX-01 material features no content drives yet (STUDIO.md W6), lit by the regular EnvironmentRig:
 * Mauryan polished sandstone (clearcoat 0.6 / 0.12 from MATERIAL_PRESETS), court silk (sheen 0.9), skin
 * (subsurface wrap), back-lit foliage cards (leaf thickness in ORM.b -> translucency), a porous plaza that darkens,
 * glosses and grows puddles in the rain (wetness chunk; SSR on ultra), and the per-instance LOD dither ramp.
 *
 * URL: &wet=0..1 (force wetness, default 0.9)   __SAMRAJYA__.call('surface.wet', 0.3)
 */
import * as THREE from 'three';
import type { AppContext } from '../../../app/contracts';
import { DEBUG_UNHANDLED } from '../../../app/contracts';
import type { LabHost, LabInstance, LabModule } from '../../../scenes/lab/types';
import { createPbrMaterial, disposePbrMaterial, MATERIAL_GLOBALS } from '../pbr';
import { MATERIALS } from '../../style/palette';
import { createLodFadeAttribute, installInstancedLodDither } from './lodDither';

/** Procedural leaf-cluster card: baseColor (sRGB, alpha) + ORM (R AO, G roughness, B thickness). */
function leafTextures(): { base: THREE.DataTexture; orm: THREE.DataTexture } {
  const n = 128;
  const base = new Uint8Array(n * n * 4);
  const orm = new Uint8Array(n * n * 4);
  const leaves = [
    [0.32, 0.36, 0.2, 0.11, 0.6],
    [0.66, 0.4, 0.2, 0.1, -0.5],
    [0.5, 0.7, 0.22, 0.12, 0.1],
    [0.3, 0.72, 0.16, 0.09, 0.9],
    [0.72, 0.74, 0.16, 0.09, -0.9],
  ] as const;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n;
      const v = (y + 0.5) / n;
      let best = 2;
      for (const [cx, cy, a, b, rot] of leaves) {
        const dx = u - cx;
        const dy = v - cy;
        const c = Math.cos(rot);
        const s = Math.sin(rot);
        const lx = (dx * c + dy * s) / a;
        const ly = (-dx * s + dy * c) / b;
        best = Math.min(best, lx * lx + ly * ly);
      }
      const i = (y * n + x) * 4;
      const inside = best < 1;
      const t = Math.sqrt(Math.min(1, best));
      base[i] = Math.round(78 + 30 * (1 - t));
      base[i + 1] = Math.round(112 + 40 * (1 - t));
      base[i + 2] = Math.round(52 + 10 * (1 - t));
      base[i + 3] = inside ? 255 : 0;
      orm[i] = 255;
      orm[i + 1] = 150;
      orm[i + 2] = Math.round(255 * (0.85 - 0.55 * t));
      orm[i + 3] = 255;
    }
  const mk = (d: Uint8Array, srgb: boolean): THREE.DataTexture => {
    const t = new THREE.DataTexture(d, n, n, THREE.RGBAFormat);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  };
  return { base: mk(base, true), orm: mk(orm, false) };
}

function build(ctx: AppContext, host: LabHost): LabInstance {
  const { scene } = host;
  const root = new THREE.Group();
  root.name = 'surface_lab';
  if (ctx.params.hour === null) host.setEnvironment({ hour: 17.3 });
  const sun = host.env.solarDirection(new THREE.Vector3());
  const yaw = Math.atan2(-sun.x, -sun.z);
  const stage = new THREE.Group();
  stage.rotation.y = yaw;
  root.add(stage);
  const pbr: THREE.Material[] = [];
  const own = <T extends THREE.Material>(m: T): T => {
    pbr.push(m);
    return m;
  };
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    host.own(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    stage.add(m);
    return m;
  };

  // Porous plaza (wetness + puddles).
  const plazaMat = own(createPbrMaterial({}, { name: 'lab_plaza', fallbackColor: MATERIALS.sandstone, roughness: 0.85, porosity: 1 }));
  const plaza = add(new THREE.CircleGeometry(14, 64), plazaMat, 0, 0.01, 0);
  plaza.rotation.x = -Math.PI / 2;
  plaza.castShadow = false;
  // Probes on plinths.
  const plinth = own(createPbrMaterial({}, { name: 'lab_plinth', fallbackColor: MATERIALS.sandstone, roughness: 0.8, porosity: 0.6 }));
  const probes: { label: string; mat: THREE.Material }[] = [
    { label: 'polished sandstone (clearcoat)', mat: own(createPbrMaterial({}, { name: 'sandstone_polished_mauryan', fallbackColor: MATERIALS.polishedSandstone, roughness: 0.18, porosity: 0.15 })) },
    { label: 'court silk (sheen)', mat: own(createPbrMaterial({}, { name: 'silk_court', fallbackColor: '#b0482c', roughness: 0.42, porosity: 0.6 })) },
    { label: 'skin (subsurface)', mat: own(createPbrMaterial({}, { name: 'skin', fallbackColor: '#9a6a4c', roughness: 0.55, porosity: 0.3 })) },
    { label: 'plain stone (reference)', mat: own(createPbrMaterial({}, { name: 'lab_reference', fallbackColor: MATERIALS.polishedSandstone, roughness: 0.18, porosity: 0.15, clearcoat: null })) },
  ];
  probes.forEach((p, i) => {
    const x = -4.5 + i * 3;
    add(new THREE.CylinderGeometry(0.6, 0.7, 0.8, 32), plinth, x, 0.4, 0);
    add(new THREE.SphereGeometry(0.62, 64, 48), p.mat, x, 1.42, 0);
  });
  // Foliage cards between the camera and the low sun (back-lit translucency).
  const leaf = leafTextures();
  host.own(leaf.base);
  host.own(leaf.orm);
  const leafMat = own(createPbrMaterial({ baseColor: leaf.base, orm: leaf.orm }, { name: 'lab_leaf', foliage: true, side: THREE.DoubleSide }));
  leafMat.alphaTest = 0.5;
  for (let i = 0; i < 9; i++) {
    const card = add(new THREE.PlaneGeometry(1.1, 1.1), leafMat, -3.6 + i * 0.9, 2.6 + Math.sin(i * 1.7) * 0.4, -2.2 + Math.cos(i * 2.3) * 0.4);
    card.rotation.set(0.15 * Math.sin(i), Math.PI + 0.4 * Math.cos(i * 1.3), 0.2 * Math.sin(i * 0.7));
  }
  // Per-instance LOD dither ramp: 17 boxes from fading-in 0 -> solid -> fading-out.
  const count = 17;
  const boxGeo = host.own(new THREE.BoxGeometry(0.42, 0.9, 0.42));
  const fade = createLodFadeAttribute(count);
  boxGeo.setAttribute('instanceLodFade', fade);
  const boxMat = own(createPbrMaterial({}, { name: 'lab_lod', fallbackColor: '#c2412d', roughness: 0.6, porosity: 0 }));
  installInstancedLodDither(boxMat);
  const boxes = host.own(new THREE.InstancedMesh(boxGeo, boxMat, count));
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    m4.makeTranslation(-4.8 + i * 0.6, 0.45, 3.2);
    boxes.setMatrixAt(i, m4);
    const f = i / 8 - 1; // -1 .. 1
    fade.setX(i, f <= 0 ? f + 1 : -f || 1);
  }
  fade.needsUpdate = true;
  boxes.castShadow = true;
  stage.add(boxes);
  scene.add(root);
  stage.updateMatrixWorld(true);

  const wetParam = Number(new URLSearchParams(window.location.search).get('wet'));
  let wet = Number.isFinite(wetParam) && new URLSearchParams(window.location.search).has('wet') ? Math.min(1, Math.max(0, wetParam)) : 0.9;
  const target = stage.localToWorld(new THREE.Vector3(0, 1.4, 1));
  host.frame(target, 9.5, (yaw * 180) / Math.PI, 14);
  const info = (): void => host.setInfo([`Probes: ${probes.map((p) => p.label).join(' · ')}`, `Wetness ${wet.toFixed(2)} (puddles above 0.45) - leaf cards back-lit - LOD dither ramp in front`]);
  info();

  return {
    update() {
      MATERIAL_GLOBALS.wetness.value = wet;
    },
    dispose() {
      MATERIAL_GLOBALS.wetness.value = 0;
      scene.remove(root);
      root.clear();
      for (const m of pbr) disposePbrMaterial(m);
    },
    debugCommand(name: string, args: readonly unknown[]) {
      if (name === 'surface.wet') {
        const v = args[0];
        if (typeof v === 'number' && Number.isFinite(v)) wet = Math.min(1, Math.max(0, v));
        info();
        return { wet };
      }
      return DEBUG_UNHANDLED;
    },
  };
}

export const LAB: LabModule = {
  id: 'surface',
  title: 'Surface lab - clearcoat, sheen, subsurface, foliage translucency, wetness + puddles, LOD dither',
  description: 'GFX-01 material chunks under the regular environment rig.',
  sceneSize: 160,
  setup: (ctx, host) => build(ctx, host),
};
