/**
 * Lighting lookdev harness. OWNER: Art Director. Not shipped (docs/ is not part of the build).
 * Renders every LIGHTING_PRESET (close + tactical camera) on a test set with the real PBR materials,
 * baked assets, post pipeline, a calibrated disc-free Preetham IBL and a reference exponential HEIGHT FOG
 * shader patch (FOG_FRAG below - the Lead Graphics Engineer may lift it into render/environment).
 * Output: docs/art/lookdev_presets.jpg.
 *
 *   node_modules/.bin/esbuild docs/art/tools/lookdev/lookdev.ts --bundle --format=esm \
 *     --outfile=.asset-cache/lookdev.js --define:__ASSETS_ENABLED__=true
 *   node docs/art/tools/lookdev/serve.cjs &          # http://127.0.0.1:8766 (needs public/assets)
 *   NODE_PATH=$(npm root -g) node docs/art/tools/lookdev/shot.cjs "http://127.0.0.1:8766/?presets=noon,golden&views=close" out.png
 * Query: presets=<ids>, views=close,tactical, nobloom=1, nofog=1, noao=1. The bundle goes to the
 * git-ignored .asset-cache/.
 */
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
// @ts-ignore
import { PostPipeline } from '../../../../src/render/post';
// @ts-ignore
import { QUALITY_PRESETS } from '../../../../src/core/quality';
// @ts-ignore
import { AssetManager } from '../../../../src/assets/AssetManager';
// @ts-ignore
import * as S from '../../../../src/render/style/index';
// @ts-ignore
import { createPbrMaterial, MATERIAL_GLOBALS } from '../../../../src/render/materials/pbr';
void RoomEnvironment;

const W = 480, H = 270;
const params = new URLSearchParams(location.search);
const presetIds: string[] = (params.get('presets') ?? S.LIGHTING_PRESET_IDS.join(',')).split(',');
const views = (params.get('views') ?? 'close,tactical').split(',');

const canvas = document.createElement('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
renderer.setSize(W, H, false);
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const q = { ...QUALITY_PRESETS.high, aoHalfRes: true };
const post = new PostPipeline(renderer, q);
post.setSize(W, H, 1);
const pmrem = new THREE.PMREMGenerator(renderer);

// ------------------------------------------------------------------ height fog patch (reference implementation)
const FOG = {
  uHFColor: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
  uHFInscatter: { value: new THREE.Vector3(1, 0.9, 0.7) },
  uHFSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uHFDensity: { value: 0.0002 },
  uHFFalloff: { value: 0.003 },
  uHFBase: { value: 0 },
  uHFPower: { value: 8 },
  uHFMax: { value: 0.8 },
  uHFMistTop: { value: 0 },
  uHFMistDensity: { value: 0 },
};
const FOG_FRAG = /* glsl */ `
#ifdef USE_FOG
{
  vec3 hfRay = vHFWorld - cameraPosition;
  float hfDist = length(hfRay);
  vec3 hfDir = hfRay / max(hfDist, 1e-4);
  float hfB = max(uHFFalloff, 1e-6);
  float hfDy = hfDir.y * hfDist * hfB;
  float hfFog = uHFDensity * exp(-(cameraPosition.y - uHFBase) * hfB) * hfDist * (abs(hfDy) > 1e-4 ? (1.0 - exp(-hfDy)) / hfDy : 1.0);
  float hfLo = min(cameraPosition.y, vHFWorld.y);
  float hfHi = max(cameraPosition.y, vHFWorld.y);
  float hfTop = uHFBase + uHFMistTop;
  float hfIn = (hfHi - hfLo) < 1e-3 ? step(hfLo, hfTop) : clamp((hfTop - hfLo) / (hfHi - hfLo), 0.0, 1.0);
  hfFog += uHFMistDensity * hfDist * hfIn;
  float hfA = min(1.0 - exp(-hfFog), uHFMax);
  float hfSun = pow(max(dot(hfDir, uHFSunDir), 0.0), uHFPower);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(uHFColor, uHFInscatter, hfSun), hfA);
}
#endif
`;
function patchFog(m: THREE.Material) {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (s: any, r: any) => {
    prev.call(m, s, r);
    Object.assign(s.uniforms, FOG);
    s.vertexShader = 'varying vec3 vHFWorld;\n' + s.vertexShader.replace('#include <fog_vertex>', `#include <fog_vertex>
      vec4 hfw = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        hfw = instanceMatrix * hfw;
      #endif
      vHFWorld = (modelMatrix * hfw).xyz;`);
    s.fragmentShader = 'varying vec3 vHFWorld;\nuniform vec3 uHFColor, uHFInscatter, uHFSunDir;\nuniform float uHFDensity, uHFFalloff, uHFBase, uHFPower, uHFMax, uHFMistTop, uHFMistDensity;\n' +
      s.fragmentShader.replace('#include <fog_fragment>', FOG_FRAG);
  };
  m.customProgramCacheKey = () => prevKey() + '|hf';
  m.needsUpdate = true;
}

// ------------------------------------------------------------------ scene
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 0);
const sky = new Sky();
sky.scale.setScalar(1000);
sky.material.fragmentShader = sky.material.fragmentShader.replace('L0 += ( vSunE * 19000.0 * Fex ) * sundisk;', '');
sky.material.needsUpdate = true;
// Night sky: simple calibrated gradient (Preetham is invalid below the horizon).
const nightSky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false,
  vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: 'varying vec3 vD; void main(){ float h = clamp(vD.y,0.0,1.0); vec3 c = mix(vec3(0.060,0.075,0.12), vec3(0.018,0.026,0.06), pow(h,0.5)); gl_FragColor = vec4(c,1.0); }',
}));
const envScene = new THREE.Scene();
const cubeRT = new THREE.WebGLCubeRenderTarget(32, { type: THREE.FloatType });
const cubeCam = new THREE.CubeCamera(0.1, 5000, cubeRT);
function measureIrradiance(): number {
  cubeCam.update(renderer, envScene);
  const N = 32; const buf = new Float32Array(N * N * 4); let E = 0;
  const fd = (f: number, u: number, v: number): THREE.Vector3 => { switch (f) { case 0: return new THREE.Vector3(1, -v, -u); case 1: return new THREE.Vector3(-1, -v, u); case 2: return new THREE.Vector3(u, 1, v); case 3: return new THREE.Vector3(u, -1, -v); case 4: return new THREE.Vector3(u, -v, 1); default: return new THREE.Vector3(-u, -v, -1); } };
  for (let f = 0; f < 6; f++) {
    renderer.readRenderTargetPixels(cubeRT as any, 0, 0, N, N, buf, f);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const d = fd(f, ((x + 0.5) / N) * 2 - 1, -(((y + 0.5) / N) * 2 - 1)); const len = d.length(); d.divideScalar(len);
      if (d.y <= 0) continue;
      const i = (y * N + x) * 4; E += (0.2126 * buf[i]! + 0.7152 * buf[i + 1]! + 0.0722 * buf[i + 2]!) * d.y * (4 / (N * N)) / (len * len * len);
    }
  }
  return E;
}
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera as THREE.OrthographicCamera;
sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 800;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.4;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.3);
scene.add(hemi);

const assets = new AssetManager({ renderer, tier: 'high', baseUrl: '/public/assets/', anisotropy: 4 });
const mats: THREE.Material[] = [];
function std(hex: string, rough: number, extra: Partial<THREE.MeshPhysicalMaterialParameters> = {}): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(hex), roughness: rough, metalness: 0, ...extra });
  mats.push(m);
  return m;
}
function add(mesh: THREE.Mesh, cast = true) { mesh.castShadow = cast; mesh.receiveShadow = true; scene.add(mesh); return mesh; }

async function build() {
  const ground = await assets.loadMaterial('ground_dry_earth', { uvScale: [60, 60] });
  const groundMesh = add(new THREE.Mesh(new THREE.PlaneGeometry(240, 240).rotateX(-Math.PI / 2), ground.material), false);
  mats.push(ground.material);
  void groundMesh;
  // grass field band behind
  const grass = add(new THREE.Mesh(new THREE.PlaneGeometry(240, 70).rotateX(-Math.PI / 2).translate(0, 0.02, -95), std(S.BIOME_COLORS.grassland, 0.95)), false);
  void grass;
  // water strip in front-right
  const water = add(new THREE.Mesh(new THREE.PlaneGeometry(60, 18).rotateX(-Math.PI / 2).translate(30, 0.03, 30), std(S.WATER_PRESETS.river_clear.deepColor, 0.06, { envMapIntensity: 1, clearcoat: 0 })), false);
  void water;
  const stone = await assets.loadMaterial('sandstone_carved_red', { uvScale: [1, 1] });
  mats.push(stone.material);
  const wallGeo = new THREE.BoxGeometry(14, 4.2, 1.2);
  const uv = wallGeo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 7, 1 - uv.getY(i) * 2.1);
  add(new THREE.Mesh(wallGeo.translate(-6, 2.1, -10), stone.material));
  // Mauryan polished pillar + lion-less bell capital
  const pp = S.MATERIAL_PRESETS.sandstone_polished_mauryan;
  const polished = std(pp.baseColor, pp.roughness, { clearcoat: pp.clearcoat?.strength ?? 0, clearcoatRoughness: pp.clearcoat?.roughness ?? 0.1 });
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.48, 10, 32).translate(6, 5, -6), polished));
  add(new THREE.Mesh(new THREE.SphereGeometry(0.75, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI).translate(6, 10.7, -6), polished));
  // Lime-plastered house with terracotta roof
  add(new THREE.Mesh(new THREE.BoxGeometry(6, 3.4, 5).translate(-16, 1.7, 2), std(S.MATERIALS.limeWash, 0.88)));
  add(new THREE.Mesh(new THREE.ConeGeometry(4.8, 2.2, 4).rotateY(Math.PI / 4).translate(-16, 4.5, 2), std(S.MATERIALS.terracotta, 0.75)));
  add(new THREE.Mesh(new THREE.BoxGeometry(5, 2.8, 4).translate(-22, 1.4, -4), std(S.MATERIALS.mudPlaster, 0.95)));
  add(new THREE.Mesh(new THREE.ConeGeometry(3.9, 2.4, 10).translate(-22, 4, -4), std(S.MATERIALS.thatch, 0.97)));
  // Trees: mango dome + neem
  const mango = S.TREE_SPECIES.mango!, neem = S.TREE_SPECIES.neem!;
  for (const [x, z, sp, s] of [[-30, -20, mango, 1], [14, -26, neem, 0.9], [-8, -34, mango, 1.2], [26, -14, neem, 0.8]] as const) {
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.35 * s, 0.5 * s, 4 * s, 8).translate(x, 2 * s, z), std(sp.trunk.bark, 0.9)));
    add(new THREE.Mesh(new THREE.IcosahedronGeometry(4.2 * s, 2).scale(1.25, 0.85, 1.25).translate(x, 6.5 * s, z), std(sp.leaf.sharad, 0.85, { sheen: 0.3, sheenColor: new THREE.Color('#9fb070') })));
  }
  // Stupa
  try {
    const st = await assets.loadModel('stupa_sanchi', { castShadow: true, receiveShadow: true });
    st.object.position.set(34, 0, -44);
    st.object.rotation.y = -0.4;
    scene.add(st.object);
    st.object.traverse((o: any) => { if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m: THREE.Material) => mats.push(m)); } });
  } catch (e) { console.warn(e); }
  // Soldiers: two blocks (heartland saffron, highland indigo)
  const body = new THREE.CylinderGeometry(0.22, 0.26, 1.15, 8).translate(0, 0.95, 0);
  const head = new THREE.SphereGeometry(0.16, 10, 8).translate(0, 1.66, 0);
  const turban = new THREE.SphereGeometry(0.19, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.3, 1).translate(0, 1.72, 0);
  const shield = new THREE.BoxGeometry(0.62, 1.45, 0.06).translate(0.0, 0.95, 0.32);
  const spear = new THREE.CylinderGeometry(0.02, 0.02, 3.4, 4).translate(0.3, 1.7, 0.1);
  const skin = std(S.SKIN_TONES[2], 0.55);
  const cotton = std(S.DYES.cottonBleached, 0.92, { sheen: 0.4, sheenColor: new THREE.Color('#f2ead8') });
  const bamboo = std(S.MATERIALS.bamboo, 0.55);
  for (const [fx, fz, team] of [[-4, 8, 'heartland'], [6, 14, 'highland']] as const) {
    const v = S.factionVisual(team);
    const dye = std(v.clothDye, 0.9);
    const sh = std(v.colors.primary, 0.7);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) {
      const g = new THREE.Group();
      const m = (geo: THREE.BufferGeometry, mat: THREE.Material) => { const mm = new THREE.Mesh(geo, mat); mm.castShadow = true; mm.receiveShadow = true; g.add(mm); };
      m(body, cotton); m(head, skin); m(turban, dye); m(shield, sh); m(spear, bamboo);
      g.position.set(fx + i * 1.1, 0, fz + j * 1.5);
      g.rotation.y = team === 'heartland' ? Math.PI * 0.1 : Math.PI * 1.05;
      scene.add(g);
    }
  }
  // Torches (practicals)
  const torches: THREE.PointLight[] = [];
  for (const [x, z] of [[-6, 6], [3, 7], [-13, -1]] as const) {
    const pl = new THREE.PointLight(S.PRACTICAL_LIGHTS.torch.color, 0, S.PRACTICAL_LIGHTS.torch.rangeM, 2);
    pl.position.set(x, 2.4, z);
    scene.add(pl);
    torches.push(pl);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.2, 5).translate(x, 1.1, z), std(S.MATERIALS.teak, 0.8)));
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6).scale(1, 1.6, 1).translate(x, 2.35, z), new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 3.2, 0.9) }));
    scene.add(flame);
    (flame as any).isFlame = true;
  }
  for (const m of mats) patchFog(m);
  return torches;
}

const cameras: Record<string, THREE.PerspectiveCamera> = {
  close: (() => { const c = new THREE.PerspectiveCamera(50, W / H, 0.1, 3000); c.position.set(-1.5, 1.7, 21); c.lookAt(2, 2.4, -6); return c; })(),
  tactical: (() => { const c = new THREE.PerspectiveCamera(42, W / H, 1, 5000); c.position.set(-60, 85, 95); c.lookAt(0, 0, -6); return c; })(),
};
const zoomFor: Record<string, string> = { close: 'close', tactical: 'tactical' };

function apply(id: string, view: string, torches: THREE.PointLight[]) {
  const p = (S.LIGHTING_PRESETS as any)[id];
  const r = S.presetToResolved(p);
  const look = S.resolveZoomLook(view === 'close' ? 30 : 220);
  void zoomFor;
  const dir = new THREE.Vector3(...S.sunDirection(p.sun.elevationDeg, p.sun.azimuthDeg));
  // Sky
  const u = sky.material.uniforms as any;
  u.turbidity.value = p.sky.preetham.turbidity;
  u.rayleigh.value = p.sky.preetham.rayleigh;
  u.mieCoefficient.value = p.sky.preetham.mieCoefficient;
  u.mieDirectionalG.value = p.sky.preetham.mieDirectionalG;
  const skyDir = p.sun.elevationDeg < -1 && id === 'night' ? new THREE.Vector3(...S.sunDirection(-18, 300)) : dir;
  u.sunPosition.value.copy(skyDir).multiplyScalar(1000);
  // IBL from the disc-free sky, calibrated to the preset's sky irradiance; same texture as background.
  envScene.clear();
  envScene.add(id === 'night' ? nightSky : sky);
  const E = measureIrradiance();
  const env = pmrem.fromScene(envScene, 0, 0.1, 2000);
  scene.environment = env.texture;
  scene.background = env.texture;
  scene.backgroundBlurriness = 0;
  const cal = S.environmentIntensityFor(r, E);
  scene.environmentIntensity = cal;
  scene.backgroundIntensity = cal;
  (window as any).__cal = ((window as any).__cal ?? []).concat([`${id}: E=${E.toFixed(3)} cal=${cal.toFixed(3)}`]);
  // Sun / moon
  const lightDir = p.sun.elevationDeg < 0 ? new THREE.Vector3(dir.x, 0.05, dir.z).normalize() : dir;
  sun.color.setRGB(...r.sunColor);
  sun.intensity = r.sunIntensity;
  sun.position.copy(lightDir).multiplyScalar(300);
  sun.target.position.set(0, 0, -5);
  sun.shadow.radius = Math.max(1, p.sun.softnessDeg * 3);
  hemi.color.setRGB(...r.hemiSky); hemi.groundColor.setRGB(...r.hemiGround); hemi.intensity = r.hemiIntensity * 0.35;
  // Fog (display-referred colors -> radiance)
  FOG.uHFColor.value.set(...S.fogRadiance(r.fogColor, r.exposure));
  FOG.uHFInscatter.value.set(...S.fogRadiance(r.fogInscatter, r.exposure));
  FOG.uHFSunDir.value.copy(dir);
  FOG.uHFDensity.value = r.fogDensity * look.atmosphere.fogDensityScale;
  FOG.uHFFalloff.value = r.fogHeightFalloff;
  FOG.uHFBase.value = r.fogBaseHeight;
  FOG.uHFPower.value = r.fogInscatterPower;
  FOG.uHFMax.value = r.fogMaxOpacity;
  FOG.uHFMistTop.value = r.mistTopM;
  FOG.uHFMistDensity.value = r.mistDensity;
  // Practicals
  for (const t of torches) t.intensity = S.PRACTICAL_LIGHTS.torch.intensity * r.practicals;
  scene.traverse((o: any) => { if (o.isFlame) o.visible = r.practicals > 0.2; });
  MATERIAL_GLOBALS.wetness.value = r.wetness;
  renderer.toneMappingExposure = r.exposure;
  post.setGrade({ ...r.grade, vignette: r.grade.vignette + look.post.vignetteAdd });
  const bp = (post as any).bloomPass;
  if (bp) { const nb = params.get('nobloom'); bp.strength = nb ? 0 : r.bloomStrength * look.post.bloomScale; bp.radius = r.bloomRadius; bp.threshold = r.bloomThreshold / r.exposure; }
  if (params.get('nofog')) FOG.uHFDensity.value = 0, FOG.uHFMistDensity.value = 0;
  if (params.get('noao')) { const ao = (post as any).aoPass; if (ao) ao.enabled = false; }
  return env;
}

async function main() {
  const torches = await build();
  const out = document.getElementById('out')!;
  for (const id of presetIds) {
    for (const view of views) {
      const cam = cameras[view]!;
      post.setView(scene, cam);
      post.setSize(W, H, 1);
      const env = apply(id, view, torches);
      post.render(0.016);
      post.render(0.016);
      const img = document.createElement('img');
      img.src = canvas.toDataURL('image/png');
      img.width = W; img.height = H;
      const fig = document.createElement('figure');
      fig.appendChild(img);
      const cap = document.createElement('figcaption');
      cap.textContent = `${id} / ${view}`;
      fig.appendChild(cap);
      out.appendChild(fig);
      env.dispose();
    }
  }
  const pre = document.createElement('pre'); pre.textContent = ((window as any).__cal ?? []).join('\n'); document.body.appendChild(pre);
  (window as any).__done = true;
}
main().catch((e) => { console.error(e); (window as any).__done = true; });
