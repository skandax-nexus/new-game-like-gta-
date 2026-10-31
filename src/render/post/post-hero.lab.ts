/**
 * Post-stack lab: `?scene=lab&lab=post-hero`. OWNER: Graphics Developer - Lighting, Atmosphere & Post (GFX-01).
 *
 * Shows what the game scenes do not drive yet (STUDIO.md W6): TAA on / off at hero distance, hero DoF focus,
 * shafts through a colonnade against a low sun, SSR on a rain-wet polished plaza, bloom + lens dirt on oil
 * lamps, and a battle-distance spear field for SMAA / FXAA / the low-tier single merged pass.
 *
 * URL: &view=hero|battle (default hero)  &taa=0|1|auto (default auto = TAA in the hero band on ultra)
 *      &focus=<m> (hero DoF focus override)  &tonemap=aces|agx
 *      &dofnear=0 (single-layer DoF: the round-1 'before')  &near=1 (a pillar 1.6 m in front of the lens, left third:
 *      the near-field DoF test with the focus on the hero)
 *   __SAMRAJYA__.call('post.view', 'battle')   __SAMRAJYA__.call('post.taa', false)
 *   __SAMRAJYA__.call('post.focus', 12)        __SAMRAJYA__.call('post.tonemap', 'agx')
 *   __SAMRAJYA__.call('post.info')             -> PostPipeline.info()
 */
import * as THREE from 'three';
import type { AppContext } from '../../app/contracts';
import { DEBUG_UNHANDLED } from '../../app/contracts';
import { MATERIALS, METALS } from '../style/palette';
import type { LabHost, LabInstance, LabModule } from '../../scenes/lab/types';
import type { TaaMode, ToneMapper } from '../post';

type View = 'hero' | 'battle';

function urlParam(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

function parseTaa(v: unknown): TaaMode {
  if (v === true || v === '1' || v === 'true' || v === 'on') return true;
  if (v === false || v === '0' || v === 'false' || v === 'off') return false;
  return 'auto';
}

function build(ctx: AppContext, host: LabHost): LabInstance {
  const { scene } = host;
  const post = ctx.render.post;
  const root = new THREE.Group();
  root.name = 'post_hero_lab';
  const stone = host.own(new THREE.MeshStandardMaterial({ color: new THREE.Color(MATERIALS.sandstone), roughness: 0.78 }));
  const polished = host.own(new THREE.MeshStandardMaterial({ color: new THREE.Color(MATERIALS.polishedSandstone), roughness: 0.3 }));
  // Rain-wet plaza: low roughness -> screen-space reflections (ultra).
  const wet = host.own(new THREE.MeshStandardMaterial({ color: new THREE.Color(MATERIALS.granite).multiplyScalar(0.55), roughness: 0.08 }));
  const cloth = host.own(new THREE.MeshStandardMaterial({ color: new THREE.Color('#c2412d'), roughness: 0.85 }));
  const skin = host.own(new THREE.MeshStandardMaterial({ color: new THREE.Color('#8f5d40'), roughness: 0.6 }));
  const iron = host.own(new THREE.MeshStandardMaterial({ color: new THREE.Color(METALS.iron), roughness: 0.35, metalness: 1 }));
  const gold = host.own(new THREE.MeshStandardMaterial({ color: new THREE.Color(METALS.goldLeaf), roughness: 0.25, metalness: 1 }));
  const flame = host.own(new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.62, 0.25).multiplyScalar(14) }));
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root): THREE.Mesh => {
    host.own(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  // Content-pipeline skies, the dominant preset's LUT and the WP7 lens dirt (main.ts does not attach them to the
  // render context yet - see the GFX-01 request to the CTO); procedural fallbacks when assets are off.
  host.env.setAssets(ctx.assets);
  // Golden hour, wet ground (?hour= / ?weather= win); the stage turns so the sun stands behind the colonnade.
  if (ctx.params.hour === null) host.setEnvironment({ hour: 17.4 });
  const sun = host.env.solarDirection(new THREE.Vector3());
  const stageYaw = Math.atan2(-sun.x, -sun.z);
  const stage = new THREE.Group();
  stage.rotation.y = stageYaw;
  root.add(stage);
  stage.updateMatrixWorld();

  // Plaza and colonnade (the sun sits behind it in the hero view: shafts through the gaps).
  const plaza = mesh(new THREE.CircleGeometry(16, 64), wet, 0, 0.02, 0, stage);
  plaza.rotation.x = -Math.PI / 2;
  plaza.castShadow = false;
  const colonnade = new THREE.Group();
  stage.add(colonnade);
  for (let i = -4; i <= 4; i++) {
    mesh(new THREE.BoxGeometry(1.1, 0.4, 1.1), stone, i * 2.2, 0.2, 0, colonnade);
    mesh(new THREE.CylinderGeometry(0.32, 0.38, 6, 24), polished, i * 2.2, 3.4, 0, colonnade);
  }
  mesh(new THREE.BoxGeometry(20.4, 0.8, 1.5), stone, 0, 6.8, 0, colonnade);
  // Far markers for the DoF background.
  for (let i = 0; i < 6; i++) mesh(new THREE.CylinderGeometry(0.5, 0.6, 9, 16), stone, -30 + i * 12, 4.5, -45 - (i % 2) * 20, stage);

  // Hero figure with a spear (thin, long: the TAA / SMAA edge test) and a lamp-lit shrine.
  const hero = new THREE.Group();
  stage.add(hero);
  mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.9, 16), cloth, 0, 1.15, 0, hero);
  mesh(new THREE.SphereGeometry(0.14, 24, 16), skin, 0, 1.75, 0, hero);
  mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.8, 8), skin, -0.1, 0.4, 0, hero);
  mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.8, 8), skin, 0.1, 0.4, 0, hero);
  const spear = mesh(new THREE.CylinderGeometry(0.012, 0.012, 2.8, 6), iron, 0.32, 1.4, 0.05, hero);
  spear.rotation.z = 0.08;
  mesh(new THREE.ConeGeometry(0.03, 0.18, 8), gold, 0.43, 2.86, 0.05, hero);
  hero.position.set(0, 0, 4);
  for (const x of [-2.6, 2.6]) {
    mesh(new THREE.CylinderGeometry(0.18, 0.24, 1.1, 12), stone, x, 0.55, 2.6, stage);
    mesh(new THREE.SphereGeometry(0.07, 12, 8), flame, x, 1.2, 2.6, stage).castShadow = false;
    host.env.addPractical('oilLamp', stage.localToWorld(new THREE.Vector3(x, 1.25, 2.6)));
  }
  // Railing behind the hero (fine high-contrast edges for the AA comparison).
  for (let i = 0; i < 25; i++) mesh(new THREE.BoxGeometry(0.03, 0.9, 0.03), iron, -6 + i * 0.5, 0.45, 1.4, stage);
  mesh(new THREE.BoxGeometry(12.2, 0.04, 0.04), iron, 0, 0.9, 1.4, stage);

  // Battle-distance spear field (InstancedMesh): 30 x 20 men with spears.
  const field = new THREE.Group();
  field.position.set(0, 0, -160);
  root.add(field);
  const bodyGeo = host.own(new THREE.BoxGeometry(0.5, 1.7, 0.35));
  const spearGeo = host.own(new THREE.BoxGeometry(0.04, 3.2, 0.04));
  const n = 600;
  const bodies = host.own(new THREE.InstancedMesh(bodyGeo, cloth, n));
  const spears = host.own(new THREE.InstancedMesh(spearGeo, iron, n));
  const mtx = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (let i = 0; i < n; i++) {
    const x = (i % 30) * 1.4 - 21;
    const z = Math.floor(i / 30) * 1.6 - 16;
    mtx.makeTranslation(x, 0.85, z);
    bodies.setMatrixAt(i, mtx);
    e.set(0.25, 0, 0.05 * Math.sin(i * 1.7));
    q.setFromEuler(e);
    mtx.compose(new THREE.Vector3(x + 0.3, 1.9, z - 0.2), q, new THREE.Vector3(1, 1, 1));
    spears.setMatrixAt(i, mtx);
  }
  for (const im of [bodies, spears]) {
    im.castShadow = true;
    im.receiveShadow = true;
    field.add(im);
  }
  scene.add(root);

  let view: View = urlParam('view') === 'battle' ? 'battle' : 'hero';
  let taa: TaaMode = parseTaa(urlParam('taa'));
  const focusParam = Number(urlParam('focus'));
  let focus: number | null = Number.isFinite(focusParam) && focusParam > 0 ? focusParam : null;
  const tm = urlParam('tonemap');
  if (tm === 'agx' || tm === 'aces') post.setToneMapping(tm);
  const heroTarget = stage.localToWorld(new THREE.Vector3(0, 1.5, 4));
  post.setDofNearField(urlParam('dofnear') !== '0');
  // Near pillar (placed in front of the lens once the hero view is framed): foreground bokeh over a sharp subject.
  const nearPillar = urlParam('near') === '1' ? mesh(new THREE.CylinderGeometry(0.16, 0.18, 5, 24), polished, 0, 2.5, 0) : null;
  const placeNearPillar = (): void => {
    if (!nearPillar) return;
    nearPillar.visible = view === 'hero';
    const cam = host.camera;
    cam.updateMatrixWorld();
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3().crossVectors(fwd, cam.up).normalize();
    const p = cam.position.clone().addScaledVector(fwd, 1.6).addScaledVector(right, -0.42);
    nearPillar.position.set(p.x, 2.5, p.z);
  };

  const applyView = (): void => {
    // Camera opposite the sun (looking into it) so the colonnade throws shafts toward the lens.
    const yaw = (stageYaw * 180) / Math.PI;
    if (view === 'hero') host.frame(heroTarget, 4.5, yaw, 6);
    else host.frame({ x: 0, y: 0, z: -160 }, 220, yaw + 25, 42);
    post.setTaa(taa);
    post.setFocus(view === 'hero' ? focus : null);
    placeNearPillar();
    info();
  };
  const info = (): void => {
    const a = (post.info().active ?? {}) as Record<string, boolean>;
    const on = Object.keys(a).filter((k) => a[k]);
    host.setInfo([`View ${view} - TAA ${String(taa)} - focus ${focus ?? 'auto'} - tone map ${post.toneMapping}`, `Passes: ${on.join(' · ') || '(warming up)'}`]);
  };
  applyView();
  let infoT = 0;

  return {
    update(dt: number) {
      infoT += dt;
      if (infoT > 1) {
        infoT = 0;
        info();
      }
    },
    dispose() {
      host.env.setAssets(null);
      post.setTaa('auto');
      post.setFocus(null);
      post.setToneMapping('aces');
      post.setDofNearField(true);
      scene.remove(root);
      root.clear();
    },
    debugCommand(name: string, args: readonly unknown[]) {
      const v = args[0];
      if (name === 'post.view') {
        view = v === 'battle' ? 'battle' : 'hero';
        applyView();
        return { view };
      }
      if (name === 'post.taa') {
        taa = parseTaa(v);
        applyView();
        return { taa };
      }
      if (name === 'post.focus') {
        focus = typeof v === 'number' && v > 0 ? v : null;
        applyView();
        return { focus };
      }
      if (name === 'post.tonemap') {
        const m: ToneMapper = v === 'agx' ? 'agx' : 'aces';
        post.setToneMapping(m);
        info();
        return { toneMapping: m };
      }
      if (name === 'post.info') return post.info();
      return DEBUG_UNHANDLED;
    },
  };
}

export const LAB: LabModule = {
  id: 'post-hero',
  title: 'Post stack - hero distance (TAA, DoF, shafts, SSR, bloom) and battle AA',
  description: 'GFX-01 lab: TAA on/off, DoF focus, colonnade shafts, wet-plaza SSR, lamp bloom, spear field for SMAA / merged low pass.',
  sceneSize: 400,
  setup: (ctx, host) => build(ctx, host),
};
