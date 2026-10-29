/**
 * Example feature lab: `?scene=lab&lab=example`. OWNER: Engine Developer - Contracts (CORE-01).
 *
 * Shows how a lab uses its host (src/scenes/lab/types.ts): environment at a chosen hour, owned resources,
 * camera framing, HUD info lines, per-frame update and lab debug commands. The subject is a lookdev set in the
 * palette of the Art Bible: a Mauryan polished-sandstone pillar with a lotus-bell capital and a dharma wheel,
 * flanked by material probes (polished sandstone, gold leaf, aged bronze, lac-red lacquer) on sandstone plinths.
 *
 *   __SAMRAJYA__.call('example.spin', 0.4)    wheel speed (rad/s)
 *   __SAMRAJYA__.call('example.state')        { spin, angle, probes }
 */
import * as THREE from 'three';
import type { AppContext } from '../../app/contracts';
import { DEBUG_UNHANDLED } from '../../app/contracts';
import { MATERIALS, METALS } from '../../render/style/palette';
import type { LabHost, LabInstance, LabModule } from './types';

function lathe(points: readonly [number, number][], segments = 48): THREE.LatheGeometry {
  return new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  );
}

function build(ctx: AppContext, host: LabHost): LabInstance {
  const { scene } = host;
  const sandstone = host.own(new THREE.MeshStandardMaterial({ color: new THREE.Color(MATERIALS.polishedSandstone), roughness: 0.32, metalness: 0 }));
  const plinthStone = host.own(new THREE.MeshStandardMaterial({ color: new THREE.Color(MATERIALS.sandstone), roughness: 0.82, metalness: 0 }));
  const gold = host.own(new THREE.MeshStandardMaterial({ color: new THREE.Color(METALS.goldLeaf), roughness: 0.28, metalness: 1 }));
  const bronze = host.own(new THREE.MeshStandardMaterial({ color: new THREE.Color(METALS.bronzeAged), roughness: 0.45, metalness: 1 }));
  const lacquer = host.own(new THREE.MeshStandardMaterial({ color: new THREE.Color(MATERIALS.lacquerRed), roughness: 0.38, metalness: 0 }));

  const root = new THREE.Group();
  root.name = 'example_lab';
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rotY = 0): THREE.Mesh => {
    host.own(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    m.castShadow = true;
    m.receiveShadow = true;
    root.add(m);
    return m;
  };

  // Pillar: stepped base, tapering monolithic shaft, inverted-lotus bell, abacus, wheel.
  add(new THREE.BoxGeometry(3.2, 0.35, 3.2), plinthStone, 0, 0.175, 0);
  add(new THREE.BoxGeometry(2.4, 0.3, 2.4), plinthStone, 0, 0.5, 0);
  add(new THREE.CylinderGeometry(0.34, 0.44, 6.2, 48), sandstone, 0, 0.65 + 3.1, 0);
  const bell: [number, number][] = [
    [0.3, 0],
    [0.52, 0.06],
    [0.66, 0.2],
    [0.68, 0.36],
    [0.56, 0.52],
    [0.4, 0.64],
    [0.34, 0.72],
    [0, 0.72],
  ];
  add(lathe(bell), sandstone, 0, 6.85, 0);
  add(new THREE.CylinderGeometry(0.62, 0.62, 0.22, 32), sandstone, 0, 7.68, 0);
  const wheel = new THREE.Group();
  wheel.position.set(0, 8.55, 0);
  const rim = host.own(new THREE.TorusGeometry(0.62, 0.07, 12, 64));
  const hub = host.own(new THREE.CylinderGeometry(0.12, 0.12, 0.16, 24));
  hub.rotateX(Math.PI / 2);
  const spoke = host.own(new THREE.CylinderGeometry(0.025, 0.025, 1.2, 8));
  for (const [geo, mat] of [
    [rim, gold],
    [hub, gold],
  ] as const) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    wheel.add(m);
  }
  for (let i = 0; i < 12; i++) {
    const s = new THREE.Mesh(spoke, gold);
    s.rotation.z = (i / 12) * Math.PI;
    s.castShadow = true;
    wheel.add(s);
  }
  root.add(wheel);

  // Material probes on plinths: two each side of the pillar, slightly forward, leaving its base in view.
  const probes = [
    { name: 'polished sandstone', mat: sandstone, x: -5.2, z: 1.6 },
    { name: 'gold leaf', mat: gold, x: -3.2, z: 2.6 },
    { name: 'aged bronze', mat: bronze, x: 3.2, z: 2.6 },
    { name: 'lac-red lacquer', mat: lacquer, x: 5.2, z: 1.6 },
  ];
  for (const p of probes) {
    add(new THREE.CylinderGeometry(0.62, 0.7, 0.7, 32), plinthStone, p.x, 0.35, p.z);
    add(new THREE.SphereGeometry(0.55, 64, 48), p.mat, p.x, 0.7 + 0.55, p.z);
  }
  scene.add(root);

  // Golden hour unless the URL picked one (?hour=, ?season=, ?weather= are applied by the host).
  if (ctx.params.hour === null) host.setEnvironment({ hour: 17.2 });
  host.frame({ x: 0, y: 4.1, z: 0.6 }, 16.5, 16, 8);
  let spin = 0.35;
  let angle = 0;
  const info = (): void => host.setInfo([`Probes: ${probes.map((p) => p.name).join(' · ')}`, `Wheel ${spin.toFixed(2)} rad/s - call('example.spin', v)`]);
  info();

  return {
    update(dt: number) {
      angle += spin * dt;
      wheel.rotation.z = angle;
    },
    dispose() {
      scene.remove(root);
      root.clear();
    },
    debugCommand(name: string, args: readonly unknown[]) {
      if (name === 'example.spin') {
        const v = args[0];
        if (typeof v === 'number' && Number.isFinite(v)) spin = v;
        info();
        return { spin };
      }
      if (name === 'example.state') return { spin, angle, probes: probes.map((p) => p.name) };
      return DEBUG_UNHANDLED;
    },
  };
}

export const LAB: LabModule = {
  id: 'example',
  title: 'Example lab - pillar and material probes',
  description: 'Host API demo: environment rig, orbit camera, owned resources, debug commands.',
  sceneSize: 260,
  setup: (ctx, host) => build(ctx, host),
};
