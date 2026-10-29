/**
 * Asset viewer / lookdev scene for content-pipeline assets. OWNER: CTO + Technical Art Director.
 *
 *   ?scene=assetviewer&asset=stupa_sanchi&hdri=sky_golden&camera=hero|close|detail|top|turntable&lod=1
 *   ?scene=assetviewer&asset=sandstone_carved_red        material lookdev (wall corner, column, sphere)
 *   ?scene=assetviewer&asset=sky_day                     HDRI check (chrome / grey / rough spheres)
 *   &assets=ultra|high|mobile|off                        force a tier (off = procedural fallbacks)
 *
 * Lighting = the HDRI asset (PMREM IBL + background) + a DirectionalLight that reproduces the sun the
 * bake removed from the map (direction / color / intensity from the manifest), soft shadows fitted to
 * the subject, the regular post pipeline (GTAO, bloom, ACES, grade, SMAA). Orbit with mouse / touch.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { AppContext, GameScene, SceneParams } from '../app/contracts';
import type { HdriHandle, MaterialHandle, ModelInstance, Releasable } from '../assets/AssetManager';
import type { AssetEntry, ModelAssetEntry } from '../assets/types';
import { createDetailTexture, createNoiseNormalMap } from '../render/environment/textures';
import { toGltfUv } from '../render/materials/pbr';
import type { GradeParams } from '../render/post';

const DEFAULT_HDRI = 'sky_day';
const GROUND_MATERIAL = 'ground_dry_earth';
/** Neutral lookdev grades (judge assets, not mood): mild contrast, near-neutral saturation and warmth. */
const LOOKDEV_GRADE: Record<'day' | 'golden', GradeParams> = {
  day: { contrast: 1.06, saturation: 1.03, warmth: 0.03, lift: 0.008, vignette: 0.26, tint: [1, 1, 1] },
  golden: { contrast: 1.08, saturation: 0.98, warmth: 0.05, lift: 0.01, vignette: 0.32, tint: [1, 1, 1] },
};

/** Average linear radiance of the equirect band around the horizon (fog / haze color). */
function horizonColor(tex: THREE.Texture): THREE.Color | null {
  const img = tex.image as { data?: ArrayLike<number>; width?: number; height?: number } | undefined;
  if (!img?.data || !img.width || !img.height) return null;
  const { data, width: w, height: h } = img as { data: ArrayLike<number>; width: number; height: number };
  const ch = Math.round(data.length / (w * h));
  const half = data instanceof Uint16Array;
  const read = (i: number): number => (half ? THREE.DataUtils.fromHalfFloat(data[i]!) : data[i]!);
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = Math.floor(h * 0.47); y <= Math.floor(h * 0.53); y++) {
    for (let x = 0; x < w; x += 3) {
      const i = (y * w + x) * ch;
      r += read(i);
      g += read(i + 1);
      b += read(i + 2);
      n++;
    }
  }
  return n ? new THREE.Color(r / n, g / n, b / n) : null;
}

export class AssetViewerScene implements GameScene {
  readonly id = 'assetviewer' as const;
  readonly fixedStep = 1 / 30;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 4000);
  private controls: OrbitControls | null = null;
  private readonly handles: Releasable[] = [];
  private readonly owned: { dispose(): void }[] = [];
  private sun = new THREE.DirectionalLight(0xffffff, 3);
  private hemi: THREE.HemisphereLight | null = null;
  private entry: AssetEntry | null = null;
  private model: ModelInstance | null = null;
  private hdri: HdriHandle | null = null;
  private hud: HTMLElement | null = null;
  private hudTimer = 0;
  private bounds = new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
  private assetId = '';
  private fallback = false;

  constructor(private readonly ctx: AppContext) {}

  async enter(params: SceneParams): Promise<void> {
    const ctx = this.ctx;
    const assets = ctx.assets;
    const requested = params.scene === 'assetviewer' ? params.assetId : null;
    const firstModel = assets.list('model')[0] ?? assets.list()[0] ?? null;
    this.assetId = requested ?? firstModel ?? 'none';
    this.entry = assets.entry(this.assetId);
    const offProgress = assets.onProgress((p) =>
      ctx.bus.emit('scene:loading', { scene: 'assetviewer', progress: 0.1 + 0.85 * p.progress, label: p.label || 'Loading assets' }),
    );
    try {
      assets.setProgressLabel(`Loading ${this.assetId}`);
      ctx.bus.emit('scene:loading', { scene: 'assetviewer', progress: 0.05, label: `Loading ${this.assetId}` });
      // ---- environment
      const hdriId = ctx.params.hdri ?? (this.entry?.kind === 'hdri' ? this.assetId : DEFAULT_HDRI);
      this.hdri = await assets.loadHdri(hdriId);
      if (this.hdri) this.handles.push(this.hdri);
      this.setupLighting();
      // ---- subject
      if (this.entry?.kind === 'material') await this.buildMaterialLookdev(this.assetId);
      else if (this.entry?.kind === 'hdri') this.buildHdriProbes();
      else await this.buildModel();
      await this.buildGround();
    } finally {
      offProgress();
    }
    this.fitShadow();
    // ---- camera + controls
    this.controls = new OrbitControls(this.camera, ctx.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.applyCameraPreset(ctx.params.camera ?? 'hero');
    ctx.render.setView(this.scene, this.camera);
    const golden = (this.hdri?.sun.elevationDeg ?? 40) < 15;
    ctx.render.post.setGrade(LOOKDEV_GRADE[golden ? 'golden' : 'day']);
    ctx.render.renderer.toneMappingExposure = golden ? 1.05 : 1.0;
    ctx.render.resize();
    if (!ctx.params.noUi) this.createHud();
    ctx.bus.emit('scene:loading', { scene: 'assetviewer', progress: 1, label: 'Ready' });
  }

  // ------------------------------------------------------------------ setup

  private setupLighting(): void {
    const q = this.ctx.quality.settings;
    const h = this.hdri;
    if (h) {
      this.scene.environment = h.envMap;
      this.scene.background = h.texture;
      this.scene.backgroundIntensity = 1;
      // Physical sky fill is ~15 % of the sun; lift it for readable shadows (art direction, not physics).
      this.scene.environmentIntensity = 1.6;
      const d = h.sun.direction;
      this.sun.position.set(d[0]! * 100, d[1]! * 100, d[2]! * 100);
      this.sun.color.setRGB(h.sun.color[0]!, h.sun.color[1]!, h.sun.color[2]!, THREE.LinearSRGBColorSpace);
      this.sun.intensity = h.sun.intensity;
    } else {
      // Procedural fallback: warm sun + sky/ground hemisphere and a flat sky color.
      this.scene.background = new THREE.Color(0x9fb7d0);
      this.hemi = new THREE.HemisphereLight(0xbfd4ee, 0x7a6248, 1.1);
      this.scene.add(this.hemi);
      this.sun.position.set(60, 70, 50);
      this.sun.color.set(0xfff0dc);
      this.sun.intensity = 3.2;
    }
    this.sun.castShadow = q.shadows.enabled;
    this.sun.shadow.mapSize.set(q.shadows.mapSize, q.shadows.mapSize);
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);
    // Aerial perspective: fog tinted with the sky's horizon radiance blends the ground into the haze.
    const fogColor = (h && horizonColor(h.texture)) ?? new THREE.Color(0xc9d4dc);
    this.scene.fog = new THREE.FogExp2(fogColor, 0.0032);
  }

  private async buildModel(): Promise<void> {
    const lod = this.ctx.params.lod ?? undefined;
    const inst = await this.ctx.assets.loadModel(this.assetId, { lod });
    this.model = inst;
    this.handles.push(inst);
    this.fallback = inst.fallback;
    this.scene.add(inst.object);
    const e = inst.entry as ModelAssetEntry | null;
    if (e) this.bounds.set(new THREE.Vector3(...(e.bounds.min as [number, number, number])), new THREE.Vector3(...(e.bounds.max as [number, number, number])));
    else this.bounds.setFromObject(inst.object);
  }

  private async buildMaterialLookdev(id: string): Promise<void> {
    const assets = this.ctx.assets;
    const wallH: MaterialHandle = await assets.loadMaterial(id, { uvScale: [2, 1] });
    const unitH: MaterialHandle = await assets.loadMaterial(id);
    this.handles.push(wallH, unitH);
    this.fallback = wallH.fallback;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, pos: THREE.Vector3Tuple, rotY = 0): void => {
      toGltfUv(geo);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(...pos);
      m.rotation.y = rotY;
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
      this.owned.push(geo);
    };
    // L-shaped wall corner (2 m tall = one tile), free-standing column (circumference = one tile), sphere
    add(new THREE.PlaneGeometry(4, 2), wallH.material, [-2, 1, 0]);
    add(new THREE.PlaneGeometry(4, 2), wallH.material, [0, 1, 2], -Math.PI / 2);
    add(new THREE.CylinderGeometry(1 / Math.PI, 1 / Math.PI, 2, 96, 1, false), unitH.material, [-2.4, 1, 1.4]);
    add(new THREE.SphereGeometry(0.6, 96, 64), wallH.material, [-1.0, 0.6, 1.3]);
    this.bounds.set(new THREE.Vector3(-4, 0, 0), new THREE.Vector3(0.2, 2, 4));
  }

  private buildHdriProbes(): void {
    const mats = [
      new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.02 }),
      new THREE.MeshStandardMaterial({ color: 0x8c8c8c, metalness: 0, roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ color: 0xc8b9a0, metalness: 0, roughness: 0.35 }),
    ];
    const geo = new THREE.SphereGeometry(0.8, 96, 64);
    this.owned.push(geo, ...mats);
    mats.forEach((m, i) => {
      const s = new THREE.Mesh(geo, m);
      s.position.set((i - 1) * 2, 0.8, 0);
      s.castShadow = true;
      this.scene.add(s);
    });
    this.bounds.set(new THREE.Vector3(-3, 0, -1), new THREE.Vector3(3, 1.6, 1));
  }

  private async buildGround(): Promise<void> {
    const size = Math.max(400, this.bounds.getSize(new THREE.Vector3()).length() * 12);
    const geo = new THREE.CircleGeometry(size / 2, 96);
    geo.rotateX(-Math.PI / 2);
    const entry = this.ctx.assets.entry(GROUND_MATERIAL);
    if (entry?.kind === 'material' && this.ctx.assets.enabled) {
      const tile = entry.tileSizeMeters[0] ?? 4;
      const h = await this.ctx.assets.loadMaterial(GROUND_MATERIAL, { uvScale: [size / tile, size / tile] });
      this.handles.push(h);
      toGltfUv(geo);
      const ground = new THREE.Mesh(geo, h.material);
      ground.receiveShadow = true;
      ground.position.y = -0.02;
      ground.name = 'viewer_ground';
      this.scene.add(ground);
      this.owned.push(geo);
      return;
    }
    const detail = createDetailTexture(256, 21);
    const normal = createNoiseNormalMap(256, 23, 3.0, 8);
    for (const t of [detail, normal]) t.repeat.set(size / 7, size / 7);
    const mat = new THREE.MeshStandardMaterial({ color: 0x9c8466, roughness: 0.96, map: detail, normalMap: normal });
    mat.normalScale.set(0.6, 0.6);
    // Dusty ground: the detail texture is linear data; use it as a gentle albedo modulation.
    detail.colorSpace = THREE.NoColorSpace;
    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = true;
    ground.position.y = -0.02;
    ground.name = 'viewer_ground';
    this.scene.add(ground);
    this.owned.push(geo, mat, detail, normal);
  }

  private fitShadow(): void {
    const c = this.bounds.getCenter(new THREE.Vector3());
    const r = Math.max(2, this.bounds.getSize(new THREE.Vector3()).length() * 0.62);
    const dir = this.sun.position.clone().normalize();
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).addScaledVector(dir, r * 3);
    const cam = this.sun.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 0.1;
    cam.far = r * 6;
    cam.updateProjectionMatrix();
  }

  private applyCameraPreset(preset: string): void {
    const b = this.bounds;
    const c = b.getCenter(new THREE.Vector3());
    const size = b.getSize(new THREE.Vector3());
    const r = Math.max(1, size.length() / 2);
    const target = new THREE.Vector3(c.x, b.min.y + size.y * 0.38, c.z);
    const pos = new THREE.Vector3();
    // Models face +Z (south). Presets are expressed relative to the bounds so they work for any asset.
    switch (preset) {
      case 'close': // gateway / front detail, low heroic angle
        target.set(c.x, b.min.y + size.y * 0.42, b.max.z - size.z * 0.04);
        pos.set(c.x + r * 0.32, b.min.y + size.y * 0.1, b.max.z + r * 0.62);
        break;
      case 'detail':
        target.set(c.x + size.x * 0.12, b.min.y + size.y * 0.12, b.max.z - size.z * 0.08);
        pos.set(c.x + size.x * 0.32, b.min.y + size.y * 0.12, b.max.z + r * 0.18);
        break;
      case 'top':
        pos.set(c.x + 0.01, b.max.y + r * 2.2, c.z + r * 0.4);
        target.copy(c);
        break;
      case 'overview':
        pos.set(c.x - r * 1.6, b.min.y + r * 1.3, c.z + r * 2.1);
        break;
      default: // hero 3/4 front-left view, the front (+Z) feature kept in frame
        target.set(c.x + size.x * 0.06, b.min.y + size.y * 0.34, c.z + size.z * 0.16);
        pos.set(c.x - r * 0.78, b.min.y + size.y * 0.26, c.z + r * 1.85);
        break;
    }
    this.camera.position.copy(pos);
    this.camera.near = Math.max(0.05, r * 0.01);
    this.camera.far = r * 400;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(target);
    if (this.controls) {
      this.controls.target.copy(target);
      this.controls.autoRotate = preset === 'turntable';
      this.controls.autoRotateSpeed = 0.6;
      this.controls.update();
    }
  }

  private createHud(): void {
    const el = document.createElement('div');
    el.style.cssText =
      'position:absolute;left:max(12px,env(safe-area-inset-left));bottom:max(12px,env(safe-area-inset-bottom));' +
      'padding:8px 12px;border-radius:6px;background:rgba(18,13,31,0.62);color:#f3e6c8;font:12px/1.45 ui-monospace,monospace;' +
      'pointer-events:none;white-space:pre;';
    this.ctx.uiRoot.appendChild(el);
    this.hud = el;
    this.updateHud();
  }

  private updateHud(): void {
    if (!this.hud) return;
    const r = this.ctx.render.getStats();
    const e = this.entry;
    const tier = this.ctx.assets.tier;
    const bytes = e && tier !== 'off' ? `${(e.bytes[tier] / 1048576).toFixed(2)} MB` : '-';
    let lodLine = '';
    if (this.model?.object instanceof THREE.LOD) lodLine = `\nlod ${this.model.object.getCurrentLevel()} (auto)`;
    else if (this.ctx.params.lod !== null) lodLine = `\nlod ${this.ctx.params.lod}`;
    this.hud.textContent =
      `${this.assetId} (${e?.kind ?? 'missing'})${this.fallback ? '  [procedural fallback]' : ''}\n` +
      `tier ${tier}  payload ${bytes}  hdri ${this.hdri?.entry.id ?? 'procedural'}${lodLine}\n` +
      `${r.drawCalls} draws  ${(r.triangles / 1000).toFixed(1)}k tris  ${r.width}x${r.height}`;
  }

  // ------------------------------------------------------------------ loop

  fixedUpdate(_step: number): void {}

  update(dt: number, _alpha: number): void {
    const ctx = this.ctx;
    const input = ctx.input.frame();
    for (const a of input.actions) if (a.action === 'toggle_profiler') ctx.profiler.toggleOverlay();
    this.controls?.update(dt);
    ctx.render.render(dt);
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.5;
      this.updateHud();
    }
  }

  onResize(): void {
    this.camera.updateProjectionMatrix();
  }

  exit(): void {
    this.controls?.dispose();
    this.controls = null;
    for (const h of this.handles.splice(0)) h.release();
    for (const o of this.owned.splice(0)) o.dispose();
    this.sun.dispose();
    this.hemi?.dispose();
    this.hud?.remove();
    this.hud = null;
    this.scene.environment = null;
    this.scene.background = null;
    this.scene.clear();
  }

  debugState(): unknown {
    return {
      scene: 'assetviewer',
      asset: this.assetId,
      kind: this.entry?.kind ?? null,
      tier: this.ctx.assets.tier,
      fallback: this.fallback,
      hdri: this.hdri?.entry.id ?? null,
      triangles: this.model?.triangles ?? null,
      lod: this.model?.object instanceof THREE.LOD ? this.model.object.getCurrentLevel() : this.ctx.params.lod,
    };
  }

  stateHash(): string | null {
    return null;
  }
}
