/**
 * Asset viewer / lookdev scene for content-pipeline assets. OWNER: Technical Artist G (TA-07, CTO grant for
 * Sprint 1) - CTO + Technical Art Director review.
 *
 *   ?scene=assetviewer&asset=stupa_sanchi&hdri=sky_golden&camera=hero|close|detail|top|overview|front|turntable&lod=1
 *   ?scene=assetviewer&asset=banner_cloth[&variant=pennant]  model variants side by side (banners: runtime bannerSvg)
 *   ?scene=assetviewer&asset=sandstone_carved_red        material lookdev (wall corner, column, sphere)
 *   ?scene=assetviewer&asset=sky_dawn                    HDRI probes (chrome / grey / rough spheres)
 *   ?scene=assetviewer&asset=<vat>&clip=walk&count=500   VAT crowd grid (phase offsets, two team tints; no clip =
 *                                                        idle / walk / attack mix), one InstancedMesh per LOD
 *   ?scene=assetviewer&asset=<impostor>&dist=220&mode=ab|mesh|impostor   impostor vs source mesh (distance slider)
 *   ?scene=assetviewer&asset=<flipbook>&sun=az,el&frame=N        flipbook playback (every sequence), lit by the sun
 *                                                        (&phase=0..1 still of every sequence, &tint=none|rrggbb,
 *                                                        lit books: &wrap=w&skyvis=k&nscale=s medium-lighting lookdev)
 *   ?scene=assetviewer&asset=<lut>&split=0.5             LUT A/B split over the stupa (left ungraded)
 *   ?scene=assetviewer&asset=<image>                     image on a quad (sun sprite additive)
 *   ?scene=assetviewer&asset=<skinned model>&clip=attack two independent clones + clipEvents timeline (&memtest=1)
 *   ?scene=assetviewer&splat=a,b,c,d                     4-layer height-blended terrain lookdev (TA-01)
 *   ?scene=assetviewer&kit=id1,id2,...&count=N           instanced kit grid, draw calls per piece (TA-02 / TA-03;
 *                                                        skinned models as independent clones)
 *   &assets=ultra|high|mobile|off  &hdri=<id>  &sun=az,el  &t=<seconds> (frozen animation time)  &crossfade=1
 *
 * Lighting = the HDRI (PMREM IBL + background) calibrated like the game (ART_BIBLE §4.4): the matching
 * LIGHTING_PRESETS entry gives the target sky irradiance (environmentIntensity = target / manifest
 * ambientIrradiance), exposure and grade; the DirectionalLight reproduces the sun the bake removed. A sky
 * picker lists every HDRI. Orbit with mouse / touch.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { AppContext, GameScene, SceneParams } from '../app/contracts';
import type {
  FlipbookHandle,
  HdriHandle,
  ImageHandle,
  ImpostorHandle,
  LutHandle,
  MaterialHandle,
  ModelInstance,
  Releasable,
} from '../assets/AssetManager';
import type { AssetEntry, ModelAssetEntry } from '../assets/types';
import { createVatDepthMaterial, createVatInstancedMesh, createVatMaterial, setVatInstance } from '../assets/loaders/vat';
import { createImpostorMesh } from '../assets/loaders/impostor';
import { createFlipbookMaterial } from '../assets/loaders/flipbook';
import { installPrepassGuard } from '../assets/loaders/prepass';
import { createLutPassMaterial } from '../assets/loaders/lut';
import { instanceObject, type InstancedKit } from '../assets/loaders/instancing';
import { createDetailTexture, createNoiseNormalMap } from '../render/environment/textures';
import { createSplatMaterial, toGltfUv } from '../render/materials';
import type { GradeParams } from '../render/post';
import {
  BANNER_SHAPES,
  DYES,
  EMBLEMS,
  FACTION_ART,
  LIGHTING_PRESETS,
  bannerSvg,
  environmentIntensityFor,
  fogRadiance,
  presetToResolved,
  type BannerShape,
  type LightingPreset,
} from '../render/style';
import type { BannerPattern } from '../core/types';

const DEFAULT_HDRI = 'sky_day';
const GROUND_MATERIAL = 'ground_dry_earth';
const LUT_SUBJECT = 'stupa_sanchi';
/** Neutral lookdev grades (judge assets, not mood) for skies without a lighting preset. */
const LOOKDEV_GRADE: Record<'day' | 'golden', GradeParams> = {
  day: { contrast: 1.06, saturation: 1.03, warmth: 0.03, lift: 0.008, vignette: 0.26, tint: [1, 1, 1] },
  golden: { contrast: 1.08, saturation: 0.98, warmth: 0.05, lift: 0.01, vignette: 0.32, tint: [1, 1, 1] },
};

type ViewerMode = 'model' | 'material' | 'hdri' | 'vat' | 'impostor' | 'flipbook' | 'lut' | 'image' | 'skinned' | 'splat' | 'kit';

interface ViewerOptions {
  clip: string | null;
  count: number | null;
  mode: string | null;
  dist: number | null;
  sun: [number, number] | null;
  split: number | null;
  splat: string[] | null;
  kit: string[] | null;
  frame: number | null;
  time: number | null;
  memtest: boolean;
  crossfade: boolean;
  /** Model variant to show alone (default: all variants side by side). */
  variant: string | null;
  /** Flipbooks: show every sequence at this fraction of its length (0..1) - stills of one-shots mid-effect. */
  phase: number | null;
  /** Flipbooks: particle tint override ('none' = white; default: the entry's tint). */
  tint: string | null;
  /**
   * Override-material pass handling (prepass tag, loaders/prepass.ts): default = the helpers' tags; 'skip' =
   * crowds left out of the AO pre-pass; 'off' = flipbook quads untagged (pre-rework A/B: cards in GTAO).
   */
  prepass: 'skip' | 'off' | null;
  /** Flipbooks: build the quads but hide them (backdrop-only reference shot for the GTAO card A/B). */
  hidefx: boolean;
  /** Lit flipbooks: lookdev overrides of the medium lighting (`&wrap=0.5&skyvis=0.5`; default: the material's). */
  wrap: number | null;
  skyvis: number | null;
  /** Lit flipbooks, lookdev: scale of the atlas normals' tilt (`&nscale=1.4`). */
  nscale: number | null;
}

function viewerOptions(): ViewerOptions {
  const q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
  const num = (k: string): number | null => {
    const v = q.get(k);
    if (v === null || v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const list = (k: string): string[] | null => {
    const v = q.get(k);
    return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : null;
  };
  const sun = list('sun')?.map(Number);
  return {
    clip: q.get('clip'),
    count: num('count'),
    mode: q.get('mode'),
    dist: num('dist'),
    sun: sun && sun.length === 2 && sun.every(Number.isFinite) ? [sun[0]!, sun[1]!] : null,
    split: num('split'),
    splat: list('splat'),
    kit: list('kit'),
    frame: num('frame'),
    time: num('t'),
    memtest: q.get('memtest') === '1',
    crossfade: q.get('crossfade') === '1',
    variant: q.get('variant'),
    phase: num('phase'),
    tint: q.get('tint'),
    prepass: q.get('prepass') === 'skip' ? 'skip' : q.get('prepass') === 'off' ? 'off' : null,
    hidefx: q.get('hidefx') === '1',
    wrap: num('wrap'),
    skyvis: num('skyvis'),
    nscale: num('nscale'),
  };
}

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

/** Rasterize an SVG string into a CanvasTexture (flipY false: glTF UV convention), or null when unsupported. */
async function svgTexture(svg: string, w: number, h: number): Promise<THREE.CanvasTexture | null> {
  if (typeof document === 'undefined') return null;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  try {
    await img.decode();
  } catch {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.drawImage(img, 0, 0, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** The lighting preset a baked sky belongs to: by id, else by its Nishita sun position. */
function presetForSky(entry: { id: string; sun: { elevationDeg: number; azimuthDeg: number } } | null): LightingPreset | null {
  if (!entry) return null;
  const all = Object.values(LIGHTING_PRESETS);
  const byPos = all.find(
    (p) => Math.abs(p.sky.nishita.sunElevationDeg - entry.sun.elevationDeg) < 1.01 && Math.abs(p.sky.nishita.sunAzimuthDeg - entry.sun.azimuthDeg) < 1.01,
  );
  const night = entry.id.includes('night') ? LIGHTING_PRESETS.night : null;
  return all.find((p) => p.sky.hdri === entry.id && p.id !== 'noon') ?? night ?? byPos ?? null;
}

interface CrowdLod {
  mesh: THREE.InstancedMesh;
  material: THREE.Material;
  depth: THREE.Material;
  /** Per frame: color draws (no override), AO pre-pass draws (VAT-posed replacement), shadow-map draws. */
  draws: { main: number; prepass: number; shadow: number };
}

interface SkinnedClone {
  instance: ModelInstance;
  mixer: THREE.AnimationMixer;
  action: THREE.AnimationAction;
  clip: string;
  fired: string[];
  lastTime: number;
  bar: HTMLElement | null;
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
  private panel: HTMLElement | null = null;
  private hudTimer = 0;
  private bounds = new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
  private assetId = '';
  private fallback = false;
  private mode: ViewerMode = 'model';
  private opts: ViewerOptions = viewerOptions();
  private preset: LightingPreset | null = null;
  private time = 0;
  // mode state
  private crowd: CrowdLod[] = [];
  /** renderer.render(scene) calls in the last frame (main pass + e.g. the GTAO normal pre-pass on high+). */
  private scenePasses = { count: 0 };
  private vatTime: { value: number } | null = null;
  private flipMats: { mat: THREE.Material; fps: number; count: number; loop: boolean; mesh: THREE.Mesh }[] = [];
  private impostorRadius = 1;
  private impostorCenter = new THREE.Vector3();
  private impostorDist = 60;
  private lutPass: ShaderPass | null = null;
  private clones: SkinnedClone[] = [];
  private kits: InstancedKit[] = [];
  private kitDraws: { id: string; meshes: number; triangles: number; box?: number[] }[] = [];
  private memtest: {
    phase: 'baseline' | 'loading' | 'loaded' | 'released' | 'done';
    frames: number;
    baseline: { geometries: number; textures: number } | null;
    loaded: { geometries: number; textures: number } | null;
    released: { geometries: number; textures: number } | null;
  } | null = null;
  private notes: string[] = [];

  constructor(private readonly ctx: AppContext) {}

  async enter(params: SceneParams): Promise<void> {
    const ctx = this.ctx;
    const assets = ctx.assets;
    this.opts = viewerOptions();
    const requested = params.scene === 'assetviewer' ? params.assetId : null;
    const firstModel = assets.list('model')[0] ?? assets.list()[0] ?? null;
    this.assetId = requested ?? (this.opts.splat ? 'splat' : this.opts.kit ? 'kit' : (firstModel ?? 'none'));
    this.entry = assets.entry(this.assetId);
    this.mode = this.opts.splat ? 'splat' : this.opts.kit ? 'kit' : this.modeFor(this.entry);
    const offProgress = assets.onProgress((p) =>
      ctx.bus.emit('scene:loading', { scene: 'assetviewer', progress: 0.1 + 0.85 * p.progress, label: p.label || 'Loading assets' }),
    );
    try {
      assets.setProgressLabel(`Loading ${this.assetId}`);
      ctx.bus.emit('scene:loading', { scene: 'assetviewer', progress: 0.05, label: `Loading ${this.assetId}` });
      // ---- environment
      const hdriId = ctx.params.hdri ?? (this.entry?.kind === 'hdri' ? this.assetId : DEFAULT_HDRI);
      await this.loadSky(hdriId);
      // ---- subject
      switch (this.mode) {
        case 'material':
          await this.buildMaterialLookdev(this.assetId);
          break;
        case 'hdri':
          this.buildHdriProbes();
          break;
        case 'vat':
          await this.buildCrowd();
          break;
        case 'impostor':
          await this.buildImpostorAb();
          break;
        case 'flipbook':
          await this.buildFlipbooks();
          break;
        case 'lut':
          await this.buildLutSubject();
          break;
        case 'image':
          await this.buildImage();
          break;
        case 'skinned':
          await this.buildSkinned();
          break;
        case 'splat':
          await this.buildSplat(this.opts.splat ?? []);
          break;
        case 'kit':
          await this.buildKit(this.opts.kit ?? []);
          break;
        default:
          await this.buildModel();
      }
      if (this.mode !== 'splat') await this.buildGround();
    } finally {
      offProgress();
    }
    this.fitShadow();
    // ---- camera + controls
    // RenderSystem.resize() returns early when the canvas size is unchanged, so this fresh camera would keep
    // aspect 1 (every 16:9 frame stretched 1.78x horizontally, and the 'front' fit computed for a square view).
    this.camera.aspect = Math.max(1, ctx.canvas.clientWidth) / Math.max(1, ctx.canvas.clientHeight);
    this.camera.updateProjectionMatrix();
    this.controls = new OrbitControls(this.camera, ctx.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.applyCameraPreset(ctx.params.camera ?? (this.mode === 'vat' || this.mode === 'kit' ? 'overview' : 'hero'));
    ctx.render.setView(this.scene, this.camera);
    this.applyGrade();
    ctx.render.resize();
    this.camera.aspect = Math.max(1, ctx.canvas.clientWidth) / Math.max(1, ctx.canvas.clientHeight);
    this.camera.updateProjectionMatrix();
    if (this.mode === 'lut') this.installLutPass();
    if (!ctx.params.noUi) this.createHud();
    ctx.bus.emit('scene:loading', { scene: 'assetviewer', progress: 1, label: 'Ready' });
  }

  private modeFor(e: AssetEntry | null): ViewerMode {
    // Unknown ids go through loadModel too: registered procedural fallback or a bounds block.
    if (!e) return 'model';
    switch (e.kind) {
      case 'model':
        return e.skinned ? 'skinned' : 'model';
      case 'material':
      case 'hdri':
      case 'vat':
      case 'impostor':
      case 'flipbook':
      case 'lut':
      case 'image':
        return e.kind;
    }
  }

  // ------------------------------------------------------------------ lighting

  private async loadSky(id: string): Promise<void> {
    if (this.hdri) {
      const i = this.handles.indexOf(this.hdri);
      if (i >= 0) this.handles.splice(i, 1);
      this.hdri.release();
      this.hdri = null;
    }
    this.hdri = await this.ctx.assets.loadHdri(id);
    if (this.hdri) this.handles.push(this.hdri);
    this.preset = presetForSky(this.hdri?.entry ?? null);
    this.setupLighting();
  }

  private setupLighting(): void {
    const q = this.ctx.quality.settings;
    const h = this.hdri;
    if (this.hemi) {
      this.hemi.removeFromParent();
      this.hemi.dispose();
      this.hemi = null;
    }
    if (h) {
      this.scene.environment = h.envMap;
      this.scene.background = h.texture;
      const r = this.preset ? presetToResolved(this.preset) : null;
      // Calibrated IBL (ART_BIBLE §4.4): sky irradiance of the preset over the bake's recorded irradiance.
      const env = r ? environmentIntensityFor(r, h.entry.ambientIrradiance) : 1.6;
      this.scene.environmentIntensity = env;
      this.scene.backgroundIntensity = r ? env : 1;
      const d = h.sun.direction;
      this.sun.position.set(d[0]! * 100, d[1]! * 100, d[2]! * 100);
      this.sun.color.setRGB(h.sun.color[0]!, h.sun.color[1]!, h.sun.color[2]!, THREE.LinearSRGBColorSpace);
      this.sun.intensity = d[1]! > -0.02 ? h.sun.intensity : 0;
    } else {
      // Procedural fallback: warm sun + sky/ground hemisphere and a flat sky color.
      this.scene.background = new THREE.Color(0x9fb7d0);
      this.hemi = new THREE.HemisphereLight(0xbfd4ee, 0x7a6248, 1.1);
      this.scene.add(this.hemi);
      this.sun.position.set(60, 70, 50);
      this.sun.color.set(0xfff0dc);
      this.sun.intensity = 3.2;
    }
    if (this.opts.sun) {
      const [az, el] = this.opts.sun;
      const e = THREE.MathUtils.degToRad(el);
      const a = THREE.MathUtils.degToRad(az);
      this.sun.position.set(Math.cos(e) * Math.sin(a) * 100, Math.sin(e) * 100, -Math.cos(e) * Math.cos(a) * 100);
      if (this.sun.intensity <= 0) this.sun.intensity = 3;
    }
    this.sun.castShadow = q.shadows.enabled;
    this.sun.shadow.mapSize.set(q.shadows.mapSize, q.shadows.mapSize);
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    if (!this.sun.parent) this.scene.add(this.sun, this.sun.target);
    // Aerial perspective: fog tinted with the sky's horizon radiance (or the preset fog color).
    const fogColor = this.preset
      ? new THREE.Color().setRGB(...fogRadiance(presetToResolved(this.preset).fogColor, this.preset.exposure), THREE.LinearSRGBColorSpace)
      : ((h && horizonColor(h.texture)) ?? new THREE.Color(0xc9d4dc));
    this.scene.fog = new THREE.FogExp2(fogColor, this.mode === 'impostor' ? 0.0009 : 0.0032);
  }

  private applyGrade(): void {
    const golden = (this.hdri?.sun.elevationDeg ?? 40) < 15;
    const p = this.preset;
    this.ctx.render.post.setGrade(p ? { ...p.grade, tint: [...p.grade.tint] as [number, number, number] } : LOOKDEV_GRADE[golden ? 'golden' : 'day']);
    this.ctx.render.renderer.toneMappingExposure = p ? p.exposure : golden ? 1.05 : 1.0;
  }

  // ------------------------------------------------------------------ subjects: models / materials / hdri

  private async buildModel(): Promise<void> {
    const lod = this.ctx.params.lod ?? undefined;
    const entry = this.ctx.assets.resolve(this.assetId, 'model');
    if (entry && entry.variants.length > 1 && !this.opts.variant) {
      await this.buildVariants(entry);
      return;
    }
    const inst = await this.ctx.assets.loadModel(this.assetId, { lod, crossFade: this.opts.crossfade });
    this.model = inst;
    this.handles.push(inst);
    this.fallback = inst.fallback;
    this.scene.add(inst.object);
    const e = inst.entry as ModelAssetEntry | null;
    const only = e && this.opts.variant ? e.variants.find((v) => v.name === this.opts.variant) : null;
    if (e && only) {
      const all = new Set(e.variants.flatMap((v) => v.nodes));
      inst.object.traverse((o) => {
        if (all.has(o.name)) o.visible = only.nodes.includes(o.name);
      });
    }
    if (e) this.bounds.set(new THREE.Vector3(...(e.bounds.min as [number, number, number])), new THREE.Vector3(...(e.bounds.max as [number, number, number])));
    else this.bounds.setFromObject(inst.object);
  }

  /**
   * Variant layout: one clone per variant side by side (other variants' nodes hidden). Models whose COLOR_0 is
   * data (banner_cloth) get a runtime bannerSvg() texture per shape on their cloth - proves the cloth UVs.
   */
  private async buildVariants(entry: ModelAssetEntry): Promise<void> {
    const all = new Set(entry.variants.flatMap((v) => v.nodes));
    const width = entry.bounds.max[0]! - entry.bounds.min[0]! + 0.8;
    const patterns = Object.keys(EMBLEMS) as BannerPattern[];
    const looks = Object.values(FACTION_ART);
    const isBanner = entry.meta.vertexColors === 'data';
    const n = entry.variants.length;
    for (let i = 0; i < n; i++) {
      const v = entry.variants[i]!;
      const inst = await this.ctx.assets.loadModel(entry.id, { crossFade: false });
      this.handles.push(inst);
      if (i === 0) {
        this.model = inst;
        this.fallback = inst.fallback;
      }
      const keep = new Set(v.nodes);
      inst.object.traverse((o) => {
        if (all.has(o.name)) o.visible = keep.has(o.name);
      });
      inst.object.position.x = (i - (n - 1) / 2) * width;
      this.scene.add(inst.object);
      if (isBanner && v.name in BANNER_SHAPES) {
        const look = looks[i % looks.length]!;
        const svg = bannerSvg(patterns[i % patterns.length]!, v.name as BannerShape, { primary: look.clothDye, secondary: look.clothDyeSecondary, accent: look.trimMetal });
        const tex = await svgTexture(svg, 256, 384);
        if (!tex) continue;
        this.owned.push(tex);
        inst.object.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh || !keep.has(m.name)) return;
          const src = m.material as THREE.MeshStandardMaterial;
          const mat = src.clone();
          mat.map = tex;
          mat.color.set(0xffffff);
          mat.alphaTest = 0.5;
          m.material = mat;
          this.owned.push(mat);
        });
      }
    }
    const min = new THREE.Vector3(...(entry.bounds.min as [number, number, number]));
    const max = new THREE.Vector3(...(entry.bounds.max as [number, number, number]));
    min.x -= ((n - 1) / 2) * width;
    max.x += ((n - 1) / 2) * width;
    this.bounds.set(min, max);
    this.notes.push(`${n} variants: ${entry.variants.map((v) => v.name).join(', ')}`);
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

  // ------------------------------------------------------------------ VAT crowd

  private async buildCrowd(): Promise<void> {
    const vat = await this.ctx.assets.loadVat(this.assetId);
    if (!vat) {
      this.fallback = true;
      this.notes.push('VAT unavailable (assets off / failed): no crowd');
      this.bounds.set(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 2, 5));
      return;
    }
    this.handles.push(vat);
    const passes = this.scenePasses;
    this.scene.onBeforeRender = () => {
      passes.count++;
    };
    const count = Math.max(1, Math.min(6000, Math.round(this.opts.count ?? 500)));
    const cols = Math.ceil(Math.sqrt(count * 1.6));
    const rows = Math.ceil(count / cols);
    const spacing = 1.25;
    const lods = vat.lods;
    // Near half on LOD0, far half on LOD1 (one InstancedMesh each: 1 draw + 1 shadow draw per LOD).
    const split = lods.length > 1 ? Math.ceil(rows / 2) : rows;
    const time = { value: 0 };
    this.vatTime = time;
    const partColors = vat.entry.partColors.map((h) => new THREE.Color(h));
    const teamA = new THREE.Color(DYES.saffron);
    const teamB = new THREE.Color(DYES.indigoLight);
    const clips = this.opts.clip ? [vat.clip(this.opts.clip)].filter((c): c is NonNullable<typeof c> => !!c) : [];
    const mix = ['idle', 'walk', 'attack'].map((n) => vat.clip(n)).filter((c): c is NonNullable<typeof c> => !!c);
    const use = clips.length ? clips : mix.length ? mix : [vat.entry.clips[0]!];
    let rng = 12345;
    const rand = (): number => ((rng = (rng * 1664525 + 1013904223) >>> 0) / 4294967296);
    const counts = [Math.min(count, split * cols), Math.max(0, count - split * cols)];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let li = 0; li < Math.min(2, lods.length); li++) {
      const n = counts[li]!;
      if (n <= 0) continue;
      const lod = lods[li]!;
      const material = createVatMaterial(lod, { partColors: partColors.length ? partColors : undefined, time, clothVariation: 0.18 });
      const depth = createVatDepthMaterial(lod, time);
      const mesh = createVatInstancedMesh(lod, n, material, { depth, prepass: this.opts.prepass === 'skip' ? 'skip' : 'replace' });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const draws = { main: 0, prepass: 0, shadow: 0 };
      // Chain the prepass guard installed by createVatInstancedMesh (never replace it).
      const guard = mesh.onBeforeRender;
      mesh.onBeforeRender = function (renderer, scene, camera, geometry, mat, group) {
        if ((scene as THREE.Scene).overrideMaterial) draws.prepass++;
        else draws.main++;
        guard.call(this, renderer, scene, camera, geometry, mat, group);
      };
      mesh.onBeforeShadow = () => {
        draws.shadow++;
      };
      for (let k = 0; k < n; k++) {
        const idx = li === 0 ? k : split * cols + k;
        const r = Math.floor(idx / cols);
        const c = idx % cols;
        const x = (c - (cols - 1) / 2) * spacing + (rand() - 0.5) * 0.3;
        const z = (r - (rows - 1) / 2) * spacing * 1.1 + (rand() - 0.5) * 0.3;
        const team = c < cols / 2 ? teamA : teamB;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (c < cols / 2 ? 0.5 : -0.5) * Math.PI + (rand() - 0.5) * 0.25);
        m4.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(1, 1, 1));
        mesh.setMatrixAt(k, m4);
        const clip = use[(r + (c % 3)) % use.length]!;
        setVatInstance(mesh, k, clip, rand() * 4, 0.9 + rand() * 0.2, team);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.scene.add(mesh);
      this.crowd.push({ mesh, material, depth, draws });
      this.owned.push({ dispose: () => ((mesh.userData.dispose as () => void)(), mesh.dispose(), material.dispose(), depth.dispose()) });
    }
    const w = cols * spacing;
    const d = rows * spacing * 1.1;
    this.bounds.set(new THREE.Vector3(-w / 2, 0, -d / 2), new THREE.Vector3(w / 2, 2, d / 2));
    this.notes.push(`crowd ${count} x ${vat.entry.id}, clips ${use.map((c) => c.name).join('/')}`);
  }

  // ------------------------------------------------------------------ impostor A/B

  private async buildImpostorAb(): Promise<void> {
    const assets = this.ctx.assets;
    const imp = await assets.loadImpostor(this.assetId);
    const e = this.entry && this.entry.kind === 'impostor' ? this.entry : null;
    const mode = this.opts.mode ?? 'ab';
    this.impostorRadius = e?.radius ?? 5;
    if (e) this.impostorCenter.set(e.center[0]!, e.center[1]!, e.center[2]!);
    const sep = this.impostorRadius * 2.4;
    if (mode !== 'impostor' && mode !== 'none' && e?.source) {
      const inst = await assets.loadModel(e.source, { lod: 0 });
      this.handles.push(inst);
      inst.object.position.x = mode === 'ab' ? -sep / 2 : 0;
      this.scene.add(inst.object);
      this.model = inst;
    }
    if (mode !== 'mesh' && mode !== 'none' && imp) {
      this.handles.push(imp as ImpostorHandle);
      const mesh = createImpostorMesh(imp);
      mesh.position.x = mode === 'ab' ? sep / 2 : 0;
      this.scene.add(mesh);
      this.owned.push({ dispose: () => (mesh.userData.dispose as () => void)() });
    }
    if (!imp) {
      this.fallback = true;
      this.notes.push('impostor unavailable (assets off / failed)');
    }
    this.impostorDist = this.opts.dist ?? 60;
    const r = this.impostorRadius;
    this.bounds.set(new THREE.Vector3(-sep / 2 - r, 0, -r), new THREE.Vector3(sep / 2 + r, 2 * r, r));
  }

  private placeImpostorCamera(): void {
    const target = new THREE.Vector3(0, this.impostorCenter.y, 0);
    const d = this.impostorDist;
    this.camera.position.set(0, this.impostorCenter.y + d * Math.tan(THREE.MathUtils.degToRad(6)), d);
    this.camera.near = 0.5;
    this.camera.far = Math.max(2000, d * 6);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(target);
    if (this.controls) {
      this.controls.target.copy(target);
      this.controls.update();
    }
  }

  /** Screen rectangles (CSS pixels, top-left origin) of every flipbook quad (GTAO card A/B measurements). */
  private fxQuadRects(): { x: number; y: number; w: number; h: number }[] {
    const box = this.ctx.render.renderer.domElement.getBoundingClientRect();
    const out: { x: number; y: number; w: number; h: number }[] = [];
    for (const f of this.flipMats) {
      const geo = f.mesh.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      const b = geo.boundingBox!;
      f.mesh.updateMatrixWorld(true);
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const [px, py] of [[b.min.x, b.min.y], [b.max.x, b.min.y], [b.min.x, b.max.y], [b.max.x, b.max.y]] as const) {
        const p = new THREE.Vector3(px, py, 0).applyMatrix4(f.mesh.matrixWorld).project(this.camera);
        const x = box.left + (p.x * 0.5 + 0.5) * box.width;
        const y = box.top + (1 - (p.y * 0.5 + 0.5)) * box.height;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
      out.push({ x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) });
    }
    return out;
  }

  /** Screen rectangle (pixels, top-left origin) of the impostor subject's bounding sphere. */
  private subjectRect(): { x: number; y: number; w: number; h: number } | null {
    if (this.mode !== 'impostor') return null;
    // CSS pixels of the canvas (screenshots are taken at deviceScaleFactor 1, the render size may be scaled).
    const box = this.ctx.render.renderer.domElement.getBoundingClientRect();
    const width = box.width;
    const height = box.height;
    const c = this.impostorCenter.clone();
    const r = this.impostorRadius;
    const pts = [-1, 1].flatMap((sx) => [-1, 1].flatMap((sy) => [-1, 1].map((sz) => c.clone().add(new THREE.Vector3(sx * r, sy * r, sz * r)))));
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of pts) {
      p.project(this.camera);
      const x = box.left + (p.x * 0.5 + 0.5) * width;
      const y = box.top + (1 - (p.y * 0.5 + 0.5)) * height;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    return { x: Math.max(0, Math.floor(x0)), y: Math.max(0, Math.floor(y0)), w: Math.ceil(x1 - x0), h: Math.ceil(y1 - y0) };
  }

  // ------------------------------------------------------------------ flipbooks

  private async buildFlipbooks(): Promise<void> {
    const fb = await this.ctx.assets.loadFlipbook(this.assetId);
    if (!fb) {
      this.fallback = true;
      this.notes.push('flipbook unavailable (assets off / failed)');
      this.bounds.set(new THREE.Vector3(-2, 0, -1), new THREE.Vector3(2, 3, 1));
      return;
    }
    this.handles.push(fb as FlipbookHandle);
    const e = fb.entry;
    const seqs = e.sequences;
    // Quads at the effect's authored sizeMeters (mist 8 x 6 m, lightning 600 x 1200 m ...): aspect as in the game.
    const size = e.sizeMeters ?? [2, 2];
    const w = size[0] ?? 2;
    const h = size[1] ?? w;
    const cols = Math.min(seqs.length, 4);
    seqs.forEach((s, i) => {
      const tint = this.opts.tint === 'none' ? undefined : this.opts.tint ? `#${this.opts.tint.replace(/^#/, '')}` : e.tint !== '#ffffff' ? e.tint : undefined;
      const mat = createFlipbookMaterial(fb, {
        sequence: s.name,
        tint,
        ...(this.opts.wrap !== null ? { wrap: this.opts.wrap } : {}),
        ...(this.opts.skyvis !== null ? { skyVisibility: this.opts.skyvis } : {}),
        ...(this.opts.nscale !== null ? { normalScale: this.opts.nscale } : {}),
      });
      const geo = new THREE.PlaneGeometry(w, h);
      const mesh = new THREE.Mesh(geo, mat);
      // Particles never reach the GTAO / SSAO normal pre-pass (they were drawn as opaque cards there).
      // ?prepass=off shows the pre-rework behaviour for A/B evidence.
      if (this.opts.prepass !== 'off') installPrepassGuard(mesh, 'skip');
      const c = i % cols;
      const r = Math.floor(i / cols);
      // grounded books (fire, dust): sink the quad by groundLine so the base sits on the ground, like the game
      const sink = e.groundLine !== null ? e.groundLine * h : -0.05;
      mesh.position.set((c - (cols - 1) / 2) * w * 1.15, h / 2 - sink + r * h * 1.15, 0);
      mesh.renderOrder = 10;
      mesh.visible = !this.opts.hidefx;
      this.scene.add(mesh);
      this.flipMats.push({ mat, fps: s.fps, count: s.count, loop: s.loop, mesh });
      this.owned.push(geo, mat);
    });
    const rowsN = Math.ceil(seqs.length / cols);
    this.bounds.set(new THREE.Vector3((-cols / 2) * w * 1.15, 0, -0.5), new THREE.Vector3((cols / 2) * w * 1.15, rowsN * h * 1.15, 0.5));
    // Backdrop: a dark wall so additive / pale effects read.
    const wallGeo = new THREE.PlaneGeometry(cols * w * 1.6 + 4, rowsN * h * 1.4 + 4);
    // dark for emissive (additive / premultiplied) books, a mid sky-grey for lit / alpha ones so their shading reads
    const wallMat = new THREE.MeshStandardMaterial({ color: e.blend === 'alpha' ? 0x7d8994 : 0x2a2622, roughness: 0.95 });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.set(0, (rowsN * h * 1.4 + 4) / 2 - 0.2, -Math.max(w, h) * 0.9);
    wall.receiveShadow = true;
    this.scene.add(wall);
    this.owned.push(wallGeo, wallMat);
  }

  // ------------------------------------------------------------------ LUT A/B

  private async buildLutSubject(): Promise<void> {
    const lut = await this.ctx.assets.loadLut(this.assetId);
    if (lut) this.handles.push(lut as LutHandle);
    else {
      this.fallback = true;
      this.notes.push('LUT unavailable (assets off / failed / not shipped on this tier)');
    }
    const inst = await this.ctx.assets.loadModel(LUT_SUBJECT);
    this.model = inst;
    this.handles.push(inst);
    this.scene.add(inst.object);
    const e = inst.entry;
    if (e) this.bounds.set(new THREE.Vector3(...(e.bounds.min as [number, number, number])), new THREE.Vector3(...(e.bounds.max as [number, number, number])));
    else this.bounds.setFromObject(inst.object);
    if (lut) this.lutHandle = lut;
  }

  private lutHandle: LutHandle | null = null;

  private installLutPass(): void {
    const lut = this.lutHandle;
    if (!lut) return;
    const composer = this.ctx.render.post.composer;
    const mat = createLutPassMaterial(lut.texture, lut.size, 1, this.opts.split ?? 0.5);
    const pass = new ShaderPass(mat);
    const passes = composer.passes;
    const gradeIdx = passes.findIndex((p) => (p as ShaderPass).material?.name === 'SamrajyaGrade');
    const outIdx = passes.findIndex((p) => p.constructor.name === 'OutputPass');
    const at = gradeIdx >= 0 ? gradeIdx + 1 : outIdx >= 0 ? outIdx + 1 : passes.length;
    composer.insertPass(pass, at);
    this.lutPass = pass;
    this.owned.push({ dispose: () => (composer.removePass(pass), mat.dispose(), pass.dispose()) });
  }

  // ------------------------------------------------------------------ images

  private async buildImage(): Promise<void> {
    const img = await this.ctx.assets.loadImage(this.assetId);
    if (!img) {
      this.fallback = true;
      this.notes.push('image unavailable (assets off / not shipped on this tier)');
      this.bounds.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
      return;
    }
    this.handles.push(img as ImageHandle);
    const aspect = img.width / img.height;
    const hgt = 3;
    const geo = new THREE.PlaneGeometry(hgt * aspect, hgt);
    toGltfUv(geo);
    const additive = img.entry.usage.includes('sun') || img.entry.usage.includes('lens');
    const mat = new THREE.MeshBasicMaterial({
      map: img.texture,
      transparent: true,
      depthWrite: !additive,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: true,
    });
    mat.color.setScalar(additive ? Math.min(img.hdrScale, 8) : 1);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, hgt / 2 + 0.3, 0);
    this.scene.add(mesh);
    const backGeo = new THREE.PlaneGeometry(hgt * aspect * 1.3, hgt * 1.3);
    const backMat = new THREE.MeshBasicMaterial({ color: 0x07080c });
    const back = new THREE.Mesh(backGeo, backMat);
    back.position.set(0, hgt / 2 + 0.3, -0.05);
    if (additive) this.scene.add(back);
    this.owned.push(geo, mat, backGeo, backMat);
    this.bounds.set(new THREE.Vector3((-hgt * aspect) / 2, 0.3, -0.5), new THREE.Vector3((hgt * aspect) / 2, hgt + 0.3, 0.5));
  }

  // ------------------------------------------------------------------ skinned clones + clip events

  private memInfo(): { geometries: number; textures: number } {
    const m = this.ctx.render.renderer.info.memory;
    return { geometries: m.geometries, textures: m.textures };
  }

  private async buildSkinned(): Promise<void> {
    if (this.opts.memtest) {
      // Frame-driven (update()): render the empty stage for a few frames -> baseline, load both clones and render
      // -> loaded, release them and render -> released (must equal the baseline).
      this.memtest = { phase: 'baseline', frames: 0, baseline: null, loaded: null, released: null };
      this.bounds.set(new THREE.Vector3(-2.2, 0, -1), new THREE.Vector3(2.2, 1.9, 1));
      return;
    }
    await this.loadSkinnedClones();
  }

  private async loadSkinnedClones(): Promise<void> {
    const a = await this.ctx.assets.loadModel(this.assetId, { crossFade: false });
    const b = await this.ctx.assets.loadModel(this.assetId, { crossFade: false });
    this.model = a;
    this.fallback = a.fallback;
    const clipNames = a.animations.map((c) => c.name);
    const first = this.opts.clip && clipNames.includes(this.opts.clip) ? this.opts.clip : (clipNames.includes('walk') ? 'walk' : clipNames[0]) ?? null;
    const second = clipNames.find((n) => n !== first && n === 'attack') ?? clipNames.find((n) => n !== first) ?? first;
    const pairs: [ModelInstance, string | null, number][] = [
      [a, first, -0.9],
      [b, second, 0.9],
    ];
    for (const [inst, clipName, x] of pairs) {
      this.handles.push(inst);
      inst.object.position.x = x;
      this.scene.add(inst.object);
      const clip = inst.animations.find((c) => c.name === clipName) ?? null;
      if (!clip) continue;
      const mixer = new THREE.AnimationMixer(inst.object);
      const action = mixer.clipAction(clip);
      action.play();
      this.clones.push({ instance: inst, mixer, action, clip: clip.name, fired: [], lastTime: 0, bar: null });
    }
    const e = a.entry;
    if (e) {
      const bb = e.bounds;
      this.bounds.set(new THREE.Vector3(bb.min[0]! - 1.3, bb.min[1]!, bb.min[2]!), new THREE.Vector3(bb.max[0]! + 1.3, bb.max[1]!, bb.max[2]!));
    } else this.bounds.set(new THREE.Vector3(-2, 0, -1), new THREE.Vector3(2, 2, 1));
  }

  /** memtest state machine, one step per rendered frame (3 frames per phase so every upload has happened). */
  private stepMemtest(): void {
    const m = this.memtest;
    if (!m) return;
    m.frames++;
    if (m.phase === 'baseline' && m.frames >= 3) {
      m.baseline = this.memInfo();
      m.phase = 'loading';
      this.loadSkinnedClones().then(
        () => {
          m.phase = 'loaded';
          m.frames = 0;
        },
        (err: unknown) => {
          this.notes.push(`memtest load failed: ${err instanceof Error ? err.message : String(err)}`);
          m.phase = 'done';
        },
      );
    } else if (m.phase === 'loaded' && m.frames >= 3) {
      m.loaded = this.memInfo();
      this.releaseClones();
      m.phase = 'released';
      m.frames = 0;
    } else if (m.phase === 'released' && m.frames >= 3) {
      m.released = this.memInfo();
      m.phase = 'done';
    }
  }

  /** Release both clones (and, with the last reference, the shared model cache). */
  private releaseClones(): void {
    for (const c of this.clones) {
      c.mixer.stopAllAction();
      c.mixer.uncacheRoot(c.instance.object);
      const i = this.handles.indexOf(c.instance);
      if (i >= 0) this.handles.splice(i, 1);
      c.instance.release();
    }
    this.clones = [];
    this.model = null;
  }

  // ------------------------------------------------------------------ splat terrain (TA-01)

  private async buildSplat(ids: string[]): Promise<void> {
    const assets = this.ctx.assets;
    const layers = [];
    for (const id of ids.slice(0, 4)) {
      const h = await assets.loadTextureSet(id);
      this.handles.push(h);
      const e = assets.entry(id);
      const tile = e && e.kind === 'material' ? (e.tileSizeMeters[0] ?? 4) : 4;
      layers.push({ textures: h.textures, tileMeters: tile });
      if (!h.complete) this.notes.push(`layer ${id}: fallback`);
    }
    if (!layers.length) layers.push({ textures: {}, tileMeters: 4 });
    // Weights: four broad regions with noisy, height-blended borders (RGBA = layers 0..3).
    const n = 256;
    const data = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const u = x / n;
        const v = y / n;
        const nz = Math.sin(u * 23.1 + Math.sin(v * 17.3) * 2) * 0.05 + Math.sin(v * 29.7 + u * 7.1) * 0.04;
        const w = [
          Math.max(0, 1 - Math.abs(u - 0.2 + nz) * 3.2),
          Math.max(0, 1 - Math.abs(u - 0.45 - nz) * 3.2),
          Math.max(0, 1 - Math.abs(u - 0.7 + nz) * 3.2),
          Math.max(0, 1 - Math.abs(u - 0.95 - nz) * 3.2),
        ];
        const s = w.reduce((p, q) => p + q, 0) || 1;
        for (let c = 0; c < 4; c++) data[(y * n + x) * 4 + c] = Math.round((w[c]! / s) * 255);
      }
    const weights = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
    weights.needsUpdate = true;
    weights.wrapS = THREE.ClampToEdgeWrapping;
    weights.wrapT = THREE.ClampToEdgeWrapping;
    weights.magFilter = THREE.LinearFilter;
    weights.minFilter = THREE.LinearFilter;
    const mat = createSplatMaterial(layers, { weights, heightBlend: 0.18 });
    const geo = new THREE.PlaneGeometry(48, 48, 64, 64);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, Math.sin(pos.getX(i) * 0.21) * 0.35 + Math.cos(pos.getZ(i) * 0.17) * 0.3);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.owned.push(geo, mat, weights);
    // 18 % grey card (albedo 0.18, matte) standing on the patch: the exposure / albedo reference for judging layers
    // (Art Director: judge TA-01 albedo against a grey card under sky_noon).
    const cardGeo = new THREE.BoxGeometry(0.6, 0.9, 0.04);
    const cardMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.18, 0.18, 0.18, THREE.LinearSRGBColorSpace), roughness: 0.95 });
    const card = new THREE.Mesh(cardGeo, cardMat);
    card.position.set(0, 0.157 + 0.44, 6); // patch height at (0, 6) is 0.157 m
    card.rotation.x = -0.12;
    card.castShadow = true;
    card.name = 'grey_card_18';
    this.scene.add(card);
    this.owned.push(cardGeo, cardMat);
    this.bounds.set(new THREE.Vector3(-24, -0.5, -24), new THREE.Vector3(24, 1.5, 24));
    this.notes.push(`splat layers: ${ids.join(', ') || '(none)'} + 18 % grey card`);
  }

  // ------------------------------------------------------------------ kit grid (TA-02 / TA-03)

  private async buildKit(ids: string[]): Promise<void> {
    const count = Math.max(1, Math.min(64, Math.round(this.opts.count ?? 4)));
    let x = 0;
    let maxH = 2;
    let depth = 2;
    for (const id of ids) {
      const inst = await this.ctx.assets.loadModel(id, { lod: 0 });
      this.handles.push(inst);
      const box = new THREE.Box3().setFromObject(inst.object);
      const size = box.getSize(new THREE.Vector3());
      const gap = Math.max(1.5, size.x * 0.25);
      const per = Math.ceil(Math.sqrt(count));
      const mats: THREE.Matrix4[] = [];
      for (let k = 0; k < count; k++) {
        const c = k % per;
        const r = Math.floor(k / per);
        mats.push(new THREE.Matrix4().makeTranslation(x + c * (size.x + gap) - box.min.x, 0, r * (size.z + gap) - box.min.z));
      }
      if (inst.skinned) {
        // Skinned meshes cannot share one InstancedMesh (per-copy skeletons): independent clones, one draw per
        // primitive per copy - battle crowds use VAT instead (?asset=vat_test_dummy).
        let prims = 0;
        const placed = new THREE.Box3();
        for (let k = 0; k < count; k++) {
          const clone = k === 0 ? inst : await this.ctx.assets.loadModel(id, { lod: 0 });
          if (k > 0) this.handles.push(clone);
          clone.object.applyMatrix4(mats[k]!);
          placed.expandByObject(clone.object);
          this.scene.add(clone.object);
          clone.object.traverse((o) => {
            if ((o as THREE.Mesh).isMesh && o.visible) prims++;
          });
        }
        this.kitDraws.push({ id, meshes: prims, triangles: inst.triangles * count, box: [...placed.min.toArray(), ...placed.max.toArray()].map((v) => +v.toFixed(2)) });
      } else {
        const kit = instanceObject(inst.object, mats);
        this.scene.add(kit.group);
        this.kits.push(kit);
        this.owned.push({ dispose: () => kit.dispose() });
        this.kitDraws.push({ id, meshes: kit.meshes.length, triangles: inst.triangles * count });
      }
      x += per * (size.x + gap) + gap * 2;
      maxH = Math.max(maxH, size.y);
      depth = Math.max(depth, per * (size.z + gap));
    }
    this.bounds.set(new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.max(x, 2), maxH, depth));
  }

  // ------------------------------------------------------------------ ground / shadows / camera

  private async buildGround(): Promise<void> {
    // Large enough that the gap below the horizon (atan(eye height / radius)) stays under ~2 px at hero framing.
    const size = Math.max(4000, this.bounds.getSize(new THREE.Vector3()).length() * 12, this.impostorDist * 6);
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
    if (this.mode === 'impostor') {
      this.placeImpostorCamera();
      return;
    }
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
      case 'front': {
        // straight-on elevation that fits the full width (variant line-ups, banners)
        const aspect = this.camera.aspect || 16 / 9;
        const halfH = Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * aspect);
        const d = Math.max(r * 1.2, (size.x / 2 / Math.tan(halfH)) * 1.12, (size.y / 2 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.15);
        target.set(c.x, b.min.y + size.y * 0.5, c.z);
        pos.set(c.x, b.min.y + size.y * 0.42, b.max.z + d);
        break;
      }
      case 'top':
        pos.set(c.x + 0.01, b.max.y + r * 2.2, c.z + r * 0.4);
        target.copy(c);
        break;
      case 'overview':
        if (this.mode === 'vat') {
          // RTS-like 3/4 view over the crowd (AoE camera pitch ~50 deg).
          target.set(c.x, 0.8, c.z + size.z * 0.05);
          pos.set(c.x - r * 0.15, r * 0.95, c.z + r * 0.9);
        } else pos.set(c.x - r * 1.6, b.min.y + r * 1.3, c.z + r * 2.1);
        break;
      default: // hero 3/4 front-left view, the front (+Z) feature kept in frame
        if (this.mode === 'splat') {
          // A flat terrain patch needs height: the object framing below puts the eye at ground level (edge-on).
          target.set(c.x, b.min.y + size.y * 0.5, c.z + size.z * 0.08);
          pos.set(c.x - r * 0.35, b.min.y + r * 0.42, c.z + r * 0.78);
          break;
        }
        target.set(c.x + size.x * 0.06, b.min.y + size.y * 0.34, c.z + size.z * 0.16);
        pos.set(c.x - r * 0.78, b.min.y + size.y * 0.26, c.z + r * 1.85);
        break;
    }
    this.camera.position.copy(pos);
    this.camera.near = Math.max(0.05, r * 0.01);
    this.camera.far = Math.max(r * 400, 3000);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(target);
    if (this.controls) {
      this.controls.target.copy(target);
      this.controls.autoRotate = preset === 'turntable';
      this.controls.autoRotateSpeed = 0.6;
      this.controls.update();
    }
  }

  // ------------------------------------------------------------------ HUD

  private createHud(): void {
    const el = document.createElement('div');
    el.style.cssText =
      'position:absolute;left:max(12px,env(safe-area-inset-left));bottom:max(12px,env(safe-area-inset-bottom));' +
      'padding:8px 12px;border-radius:6px;background:rgba(18,13,31,0.62);color:#f3e6c8;font:12px/1.45 ui-monospace,monospace;' +
      // wraps on phones instead of running off the screen (lead review: mobile HUD clipped)
      'pointer-events:none;white-space:pre-wrap;overflow-wrap:anywhere;box-sizing:border-box;' +
      'max-width:calc(100vw - max(24px, env(safe-area-inset-left) + env(safe-area-inset-right) + 24px));';
    if (window.innerWidth < 600) el.style.fontSize = '10px';
    this.ctx.uiRoot.appendChild(el);
    this.hud = el;
    // Controls panel (sky picker, impostor distance): touch-friendly, events shielded from the canvas.
    const panel = document.createElement('div');
    panel.style.cssText =
      'position:absolute;right:max(12px,env(safe-area-inset-right));top:max(12px,env(safe-area-inset-top));display:flex;' +
      'flex-direction:column;gap:8px;padding:8px;border-radius:6px;background:rgba(18,13,31,0.62);color:#f3e6c8;font:12px ui-monospace,monospace;';
    for (const ev of ['pointerdown', 'pointermove', 'wheel', 'touchstart', 'keydown']) panel.addEventListener(ev, (e) => e.stopPropagation());
    const hdris = this.ctx.assets.list('hdri');
    if (hdris.length) {
      const sel = document.createElement('select');
      sel.style.cssText = 'min-height:44px;min-width:160px;font:13px ui-monospace,monospace;background:#1b1830;color:#f3e6c8;border:1px solid #c99a3b;border-radius:4px;';
      sel.setAttribute('aria-label', 'Sky');
      for (const id of hdris) {
        const o = document.createElement('option');
        o.value = id;
        o.textContent = id;
        sel.appendChild(o);
      }
      sel.value = this.hdri?.entry.id ?? DEFAULT_HDRI;
      sel.addEventListener('change', () => void this.switchSky(sel.value));
      panel.appendChild(sel);
    }
    if (this.mode === 'impostor') {
      const lab = document.createElement('label');
      lab.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
      const span = document.createElement('span');
      span.textContent = `distance ${this.impostorDist.toFixed(0)} m`;
      const range = document.createElement('input');
      range.type = 'range';
      range.min = '10';
      range.max = '400';
      range.step = '5';
      range.value = String(this.impostorDist);
      range.style.cssText = 'min-height:44px;width:180px;';
      range.addEventListener('input', () => {
        this.impostorDist = Number(range.value);
        span.textContent = `distance ${this.impostorDist.toFixed(0)} m`;
        this.placeImpostorCamera();
      });
      lab.append(span, range);
      panel.appendChild(lab);
    }
    if (this.mode === 'skinned') {
      for (const c of this.clones) {
        const row = document.createElement('div');
        row.style.cssText = 'position:relative;width:220px;height:22px;background:rgba(255,255,255,0.08);border-radius:3px;';
        const bar = document.createElement('div');
        bar.style.cssText = 'position:absolute;left:0;top:0;bottom:0;width:0;background:rgba(233,185,73,0.45);';
        row.appendChild(bar);
        const evs = this.model?.clipEvents[c.clip] ?? [];
        const dur = c.action.getClip().duration || 1;
        for (const e of evs) {
          const tick = document.createElement('div');
          tick.title = e.type;
          tick.style.cssText = `position:absolute;top:0;bottom:0;width:2px;left:${(e.time / dur) * 100}%;background:${e.type.startsWith('hit') ? '#ec5a40' : e.type === 'cancel' ? '#8ccf72' : '#f6ecd6'};`;
          row.appendChild(tick);
        }
        const label = document.createElement('span');
        label.style.cssText = 'position:absolute;left:4px;top:3px;font-size:11px;';
        label.textContent = c.clip;
        row.appendChild(label);
        panel.appendChild(row);
        c.bar = bar;
      }
    }
    this.ctx.uiRoot.appendChild(panel);
    this.panel = panel;
    this.updateHud();
  }

  private async switchSky(id: string): Promise<void> {
    await this.loadSky(id);
    this.fitShadow();
    this.applyGrade();
  }

  private crowdDraws(): { lod: number; main: number; prepass: number; shadow: number; instances: number; scenePasses: number; perPass: number }[] {
    const passes = Math.max(1, this.scenePasses.count);
    return this.crowd.map((c, i) => ({
      lod: i,
      main: c.draws.main,
      prepass: c.draws.prepass,
      shadow: c.draws.shadow,
      instances: c.mesh.count,
      scenePasses: passes,
      // one InstancedMesh per LOD: color draw + its shadow draw (the AO pre-pass, when present, adds one posed draw)
      perPass: (c.draws.main + c.draws.shadow) / Math.max(1, c.draws.main),
    }));
  }

  private updateHud(): void {
    if (!this.hud) return;
    const r = this.ctx.render.getStats();
    const e = this.entry;
    const tier = this.ctx.assets.tier;
    const bytes = e && tier !== 'off' ? `${(e.bytes[tier] / 1048576).toFixed(2)} MB` : '-';
    let extra = '';
    if (this.model?.object instanceof THREE.LOD) extra += `\nlod ${this.model.object.getCurrentLevel()} (auto${this.opts.crossfade ? ', cross-fade' : ''})`;
    else if (this.ctx.params.lod !== null) extra += `\nlod ${this.ctx.params.lod}`;
    if (this.mode === 'vat')
      extra += `\n${this.crowdDraws().map((d) => `LOD${d.lod}: ${d.instances} inst, color ${d.main} + shadow ${d.shadow} + AO pre-pass ${d.prepass} (posed)`).join('  ')}`;
    if (this.mode === 'impostor') extra += `\ndistance ${this.impostorDist.toFixed(0)} m  mode ${this.opts.mode ?? 'ab'}`;
    if (this.mode === 'skinned') extra += `\n${this.clones.map((c) => `${c.clip}: ${c.fired.slice(-3).join(' ')}`).join('\n')}`;
    if (this.mode === 'kit') extra += `\n${this.kitDraws.map((k) => `${k.id}: ${k.meshes} draws`).join('  ')}`;
    if (this.notes.length) extra += `\n${this.notes.join('\n')}`;
    this.hud.textContent =
      `${this.assetId} (${e?.kind ?? this.mode})${this.fallback ? '  [procedural fallback]' : ''}\n` +
      `tier ${tier}  payload ${bytes}  hdri ${this.hdri?.entry.id ?? 'procedural'}${this.preset ? ` (${this.preset.id})` : ''}${extra}\n` +
      `${r.drawCalls} draws  ${(r.triangles / 1000).toFixed(1)}k tris  ${r.width}x${r.height}`;
  }

  // ------------------------------------------------------------------ loop

  fixedUpdate(_step: number): void {}

  update(dt: number, _alpha: number): void {
    const ctx = this.ctx;
    const input = ctx.input.frame();
    for (const a of input.actions) if (a.action === 'toggle_profiler') ctx.profiler.toggleOverlay();
    this.time = this.opts.time ?? this.time + dt;
    const t = this.time;
    if (this.vatTime) this.vatTime.value = t;
    for (const f of this.flipMats) {
      const frame = this.opts.phase !== null ? Math.max(0, Math.min(1, this.opts.phase)) * (f.count - 1) : this.opts.frame ?? t * f.fps;
      (f.mat.userData.flipbookFrame as { value: number }).value = f.loop ? frame : Math.min(frame % (f.count + f.fps * 0.75), f.count - 1);
    }
    for (const c of this.clones) {
      const dur = c.action.getClip().duration || 1;
      if (this.opts.time !== null) c.mixer.setTime(this.opts.time);
      else c.mixer.update(dt);
      const now = c.action.time % dur;
      for (const e of this.model?.clipEvents[c.clip] ?? []) {
        const crossed = now >= c.lastTime ? e.time > c.lastTime && e.time <= now : e.time > c.lastTime || e.time <= now;
        if (crossed) c.fired.push(`${e.type}@${e.time.toFixed(2)}`);
      }
      if (c.fired.length > 20) c.fired.splice(0, c.fired.length - 20);
      c.lastTime = now;
      if (c.bar) c.bar.style.width = `${(now / dur) * 100}%`;
    }
    for (const c of this.crowd) {
      c.draws.main = 0;
      c.draws.prepass = 0;
      c.draws.shadow = 0;
    }
    this.scenePasses.count = 0;
    this.controls?.update(dt);
    ctx.render.render(dt);
    this.stepMemtest();
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
    for (const c of this.clones) c.mixer.stopAllAction();
    this.clones = [];
    for (const o of this.owned.splice(0)) o.dispose();
    for (const h of this.handles.splice(0)) h.release();
    this.crowd = [];
    this.kits = [];
    this.flipMats = [];
    this.lutPass = null;
    this.sun.dispose();
    this.hemi?.dispose();
    this.hud?.remove();
    this.hud = null;
    this.panel?.remove();
    this.panel = null;
    this.scene.environment = null;
    this.scene.background = null;
    this.scene.clear();
  }

  debugState(): unknown {
    return {
      scene: 'assetviewer',
      asset: this.assetId,
      kind: this.entry?.kind ?? null,
      mode: this.mode,
      tier: this.ctx.assets.tier,
      fallback: this.fallback,
      hdri: this.hdri?.entry.id ?? null,
      preset: this.preset?.id ?? null,
      sun: this.hdri ? { ...this.hdri.sun } : null,
      ambientIrradiance: this.hdri?.entry.ambientIrradiance ?? null,
      environmentIntensity: this.scene.environmentIntensity,
      triangles: this.model?.triangles ?? null,
      lod: this.model?.object instanceof THREE.LOD ? this.model.object.getCurrentLevel() : this.ctx.params.lod,
      crowd: this.mode === 'vat' ? { lods: this.crowdDraws(), instances: this.crowd.reduce((s, c) => s + c.mesh.count, 0) } : null,
      impostor: this.mode === 'impostor' ? { distance: this.impostorDist, mode: this.opts.mode ?? 'ab', rect: this.subjectRect(), radius: this.impostorRadius } : null,
      skinned: this.mode === 'skinned' ? { clones: this.clones.map((c) => ({ clip: c.clip, time: c.action.time, fired: c.fired })), memtest: this.memtest } : null,
      kit: this.mode === 'kit' ? this.kitDraws : null,
      lut: this.mode === 'lut' ? { split: this.opts.split ?? 0.5, installed: !!this.lutPass } : null,
      flipbooks: this.flipMats.length,
      fxQuads: this.flipMats.length ? this.fxQuadRects() : null,
      prepass: this.opts.prepass ?? 'tagged',
      notes: this.notes,
    };
  }

  stateHash(): string | null {
    return null;
  }
}
