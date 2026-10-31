/**
 * WebGL2 renderer bootstrap: color management, tone mapping, shadows, post pipeline, resize,
 * dynamic resolution, stats, screenshots, context-loss handling.
 * OWNER: Graphics Developer - Lighting, Atmosphere & Post (GFX-01; baseline by the CTO).
 *
 * Conventions: physically based lighting (three r170 defaults), sRGB output, ACES Filmic tone
 * mapping, HDR (HalfFloat + depth texture) post chain (render/post.ts). Scenes call setView(scene, camera) once and
 * render(dt) per frame.
 *   Stats -> profiler: draw calls / triangles (RenderStats), counters `render.shadowDraws` (shadow-map draws inside
 *     the frame's total) and `render.postPasses`, timings `render.shadows` and `render.submit` (F3 overlay).
 *   Dynamic resolution: proportional controller on the averaged frame time (pixels ~ scale^2), quantised to 0.05
 *     steps with a dead band so render targets are not rebuilt every second (dynamicResolutionStep, tested).
 *   Context loss: rendering pauses while lost; on restore the post pipeline is rebuilt, shadow maps are re-rendered
 *     and onContextRestored listeners re-bake GPU-generated content (sky / PMREM).
 *   Tier switches (setQuality) rebuild post passes, cascades, light pools and sky resolution without leaking GPU
 *     resources (verified by scripts/shots/gfx-01.cjs: tier cycling keeps renderer.info.memory constant).
 */
import * as THREE from 'three';
import type { QualitySettings } from '../core/types';
import type { Profiler, RenderStats } from '../core/profiler';
import { PostPipeline, type PostLutHandle } from './post';
import type { SkyAssetSource } from './environment/sky';
import { G, g, installShaderGlobals, resetShaderGlobals } from './materials/chunks/globals';
// Global shader patches (registered on import, applied by installShaderGlobals before any material compiles).
import './lighting/shadowChunks';
import './materials/chunks/surface';
import { WETNESS_DEBUG } from './materials/chunks/wetness';
import { CSM_DEBUG } from './lighting/csm';
import './post/ssr';
import './environment/atmosphere/heightFog';

/** Frame-time budget dead band: no change while the frame time is within [0.87, 1.15] x budget. */
export const DYNRES_DEADBAND: readonly [number, number] = [0.87, 1.15];
/** Resolution scale quantum (render targets are only rebuilt on 0.05 steps). */
export const DYNRES_QUANTUM = 0.05;

/**
 * One dynamic-resolution decision (pure): GPU cost ~ pixel count ~ scale^2, so the new scale is
 * scale x sqrt(budget / frame), limited to +-0.1 per step, quantised to DYNRES_QUANTUM and clamped to [min, max].
 */
export function dynamicResolutionStep(scale: number, avgFrameMs: number, budgetMs: number, min: number, max: number): number {
  if (avgFrameMs <= 0 || budgetMs <= 0) return scale;
  const load = avgFrameMs / budgetMs;
  if (load >= DYNRES_DEADBAND[0] && load <= DYNRES_DEADBAND[1]) return scale;
  const target = scale * Math.sqrt(1 / load);
  const limited = Math.min(scale + 0.1, Math.max(scale - 0.1, target));
  const q = Math.round(limited / DYNRES_QUANTUM) * DYNRES_QUANTUM;
  return Math.min(max, Math.max(min, Math.round(q * 1000) / 1000));
}

/**
 * Per-frame participant bound to one scene (EnvironmentRig): called right before that scene renders with the camera
 * actually used, after the scene's own update. Several hooks may target the same scene.
 */
export interface FrameHook {
  readonly scene: THREE.Scene;
  beforeRender(camera: THREE.Camera, dt: number): void;
  /** Optional plain-data diagnostics (window.__SAMRAJYA_GFX__.info()). */
  info?(): Record<string, unknown>;
}

/**
 * Asset loaders the render layer may use (baked skies, sun sprite, lens dirt, LUTs). Structural subset of the
 * AssetManager - attach it once with attachAssets(ctx.assets) (main.ts) so EnvironmentRig / PostPipeline prefer
 * baked content; without it everything stays procedural (single-file build, ?assets=off).
 */
export type RenderAssetSource = SkyAssetSource & {
  loadLut?(id: string): Promise<PostLutHandle | null>;
};

export class RenderContext {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly post: PostPipeline;
  /** Shared PMREM generator for environment maps (IBL). */
  readonly pmrem: THREE.PMREMGenerator;
  quality: QualitySettings;
  width = 1;
  height = 1;
  pixelRatio = 1;
  /** Dynamic resolution scale applied on top of the device pixel ratio. */
  resolutionScale = 1;
  /** Resolution scale pinned by pinResolutionScale (null = dynamic). */
  private pinnedScale: number | null = null;
  /** Set false to render without post (debug / low-end fallback). */
  usePost = true;
  private scene: THREE.Scene | null = null;
  private camera: THREE.Camera | null = null;
  private lastDynAdjust = 0;
  private readonly resizeObserver: ResizeObserver | null;
  onContextLost: (() => void) | null = null;
  private readonly hooks: FrameHook[] = [];
  private readonly qualityListeners: ((q: QualitySettings) => void)[] = [];
  private readonly restoreListeners: (() => void)[] = [];
  /** Optional content-pipeline loaders (see RenderAssetSource). */
  assets: RenderAssetSource | null = null;
  private lost = false;
  private shadowDraws = 0;
  private lastShadowDraws = 0;
  private readonly frameStats: RenderStats = { drawCalls: 0, triangles: 0, points: 0, lines: 0, geometries: 0, textures: 0, programs: 0, resolutionScale: 1, pixelRatio: 1, width: 0, height: 0 };

  constructor(canvas: HTMLCanvasElement, quality: QualitySettings, private readonly profiler: Profiler | null = null) {
    this.canvas = canvas;
    this.quality = quality;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.info.autoReset = false;
    this.renderer = renderer;
    // Count shadow-map draws (they are part of info.render.calls) and time them for the profiler.
    const shadowMap = renderer.shadowMap as unknown as { render: (lights: THREE.Light[], scene: THREE.Object3D, camera: THREE.Camera) => void };
    const renderShadows = shadowMap.render.bind(shadowMap);
    shadowMap.render = (lights, scene, camera) => {
      const before = renderer.info.render.calls;
      this.profiler?.begin('render.shadows');
      renderShadows(lights, scene, camera);
      this.profiler?.end('render.shadows');
      this.shadowDraws += renderer.info.render.calls - before;
    };
    // Global shader hooks (height fog, cascades, material globals) must be in place before any material compiles.
    installShaderGlobals();
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.applyRendererQuality();
    this.post = new PostPipeline(renderer, quality);
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
      this.onContextLost?.();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      // three re-creates GL state lazily (textures / geometry re-upload on use); our render targets and their
      // contents (post chain, PMREM, shadow maps) must be rebuilt.
      this.lost = false;
      this.post.setQuality(this.quality);
      this.renderer.shadowMap.needsUpdate = true;
      for (const fn of this.restoreListeners) fn();
    });
    if (typeof window !== 'undefined') {
      // QA / evidence scripts: lighting, post and memory state of the frame being rendered (plain data).
      // pinResolutionScale(s | null): evidence scripts pin dynamic resolution (1 = show the tier, not SwiftShader speed);
      // setWetnessOverride(w | null): A/B the surface wetness in the same frame (monsoon wet vs dry).
      (window as unknown as { __SAMRAJYA_GFX__?: unknown }).__SAMRAJYA_GFX__ = {
        info: () => this.diagnostics(),
        pinResolutionScale: (scale: number | null) => this.pinResolutionScale(scale),
        setWetnessOverride: (w: number | null) => {
          WETNESS_DEBUG.override = w === null || !Number.isFinite(w) ? -1 : Math.min(1, Math.max(0, w));
        },
        // setShadowIntensity(s | null): A/B the key's cast shadows in the same frame (0 = unshadowed; twilight lit:shadow).
        setShadowIntensity: (v: number | null) => {
          CSM_DEBUG.shadowIntensity = v === null || !Number.isFinite(v) ? -1 : Math.min(1, Math.max(0, v));
        },
        // probe(x, y): surface under a canvas pixel and the screen size (px) of one cascade-0 shadow texel there.
        probe: (x: number, y: number) => this.probe(x, y),
      };
    }
    this.resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    this.resizeObserver?.observe(canvas);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  private applyRendererQuality(): void {
    const q = this.quality;
    this.renderer.shadowMap.enabled = q.shadows.enabled;
    // low: 'hard' = PCF with a fixed 1-texel radius (no penumbra growth, but no aliased saw-tooth edges either - AD
    // round 1); medium: PCF with a radius from the sun's angular size; high / ultra: PCSS in the cascade chunk
    // (lighting/shadowChunks.ts) - PCF is the define other shadowed lights fall back to.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.needsUpdate = true;
  }

  setQuality(q: QualitySettings): void {
    this.quality = q;
    this.resolutionScale = this.pinnedScale ?? Math.min(this.resolutionScale, q.dynamicResolution.maxScale);
    this.applyRendererQuality();
    this.post.setQuality(q);
    this.resize();
    for (const fn of this.qualityListeners) fn(q);
  }

  /** Listen for runtime tier changes (EnvironmentRig rebuilds cascades, light pools, fog mode). */
  onQualityChange(fn: (q: QualitySettings) => void): () => void {
    this.qualityListeners.push(fn);
    return () => {
      const i = this.qualityListeners.indexOf(fn);
      if (i >= 0) this.qualityListeners.splice(i, 1);
    };
  }

  /** Listen for WebGL context restoration (re-bake GPU-generated content). */
  onContextRestored(fn: () => void): () => void {
    this.restoreListeners.push(fn);
    return () => {
      const i = this.restoreListeners.indexOf(fn);
      if (i >= 0) this.restoreListeners.splice(i, 1);
    };
  }

  /** Register a per-frame hook for a scene (returns the remover). */
  addFrameHook(hook: FrameHook): () => void {
    this.hooks.push(hook);
    return () => {
      const i = this.hooks.indexOf(hook);
      if (i >= 0) this.hooks.splice(i, 1);
    };
  }

  /** Is the WebGL context currently lost (rendering paused)? */
  get contextLost(): boolean {
    return this.lost;
  }

  /** Plain-data diagnostics of the bound scene's hooks, the post pipeline and GPU memory. */
  diagnostics(): Record<string, unknown> {
    const hooks: Record<string, unknown>[] = [];
    for (const h of this.hooks) if (h.scene === this.scene && h.info) hooks.push(h.info());
    const m = this.renderer.info.memory;
    return {
      tier: this.quality.tier,
      env: hooks[0] ?? null,
      post: this.post.info(),
      memory: { geometries: m.geometries, textures: m.textures, postRenderTargets: this.post.renderTargetCount() },
      stats: { ...this.getStats(), shadowDrawCalls: this.lastShadowDraws },
      contextLost: this.lost,
      assetsAttached: !!this.assets,
    };
  }

  /**
   * Debug / evidence (not per frame; allocates): ray-cast the bound view at canvas pixel (x, y) (CSS px), and measure
   * how many screen pixels one shadow texel of the key's first cascade ('sun') covers on that surface: a texel step
   * along each light-space axis, slid along the light onto the surface plane, projected to the screen.
   */
  probe(x: number, y: number): Record<string, unknown> | null {
    const scene = this.scene;
    const camera = this.camera;
    if (!scene || !camera) return null;
    const el = this.renderer.domElement;
    const w = el.clientWidth || el.width;
    const h = el.clientHeight || el.height;
    const ndc = new THREE.Vector2((x / w) * 2 - 1, 1 - (y / h) * 2);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(scene.children, true).find((i) => i.object.name !== 'sky' && (i.object as THREE.Mesh).isMesh && !!i.face);
    if (!hit || !hit.face) return null;
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    const out: Record<string, unknown> = {
      object: hit.object.name || hit.object.parent?.name || hit.object.type,
      distance: +hit.distance.toFixed(3),
      point: hit.point.toArray().map((v) => +v.toFixed(3)),
      normal: n.toArray().map((v) => +v.toFixed(3)),
    };
    const sun = scene.getObjectByName('sun') as THREE.DirectionalLight | undefined;
    if (!sun?.isDirectionalLight || !sun.castShadow) return out;
    const cam = sun.shadow.camera as THREE.OrthographicCamera;
    cam.updateMatrixWorld();
    const ax = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    const ay = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1).normalize();
    const toLight = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 2).normalize();
    const tx = (cam.right - cam.left) / sun.shadow.mapSize.x;
    const ty = (cam.top - cam.bottom) / sun.shadow.mapSize.y;
    const ndl = n.dot(toLight);
    const p0 = hit.point.clone().project(camera);
    const stepPx = (axis: THREE.Vector3, t: number): number => {
      // Q = P + t axis + s toLight with (Q - P) . n = 0.
      const s = Math.abs(ndl) > 1e-3 ? (-t * axis.dot(n)) / ndl : 0;
      const q = hit.point.clone().addScaledVector(axis, t).addScaledVector(toLight, s).project(camera);
      return Math.hypot(((q.x - p0.x) * w) / 2, ((q.y - p0.y) * h) / 2);
    };
    const px = stepPx(ax, tx);
    const py = stepPx(ay, ty);
    out.shadowTexelM = [+tx.toFixed(4), +ty.toFixed(4)];
    out.screenPxPerTexel = [+px.toFixed(2), +py.toFixed(2)];
    out.maxScreenPxPerTexel = +Math.max(px, py).toFixed(2);
    out.nDotL = +ndl.toFixed(3);
    out.toLight = toLight.toArray().map((v) => +v.toFixed(3));
    // What shadows this point (first surface toward the key light), for diagnosing shadow shapes.
    const occ = new THREE.Raycaster(hit.point.clone().addScaledVector(n, 0.05), toLight, 0, 400)
      .intersectObjects(scene.children, true)
      .find((i) => i.object.name !== 'sky' && (i.object as THREE.Mesh).isMesh && i.object !== (sun as THREE.Object3D));
    out.occluder = occ ? { object: occ.object.name || occ.object.parent?.name || occ.object.type, distance: +occ.distance.toFixed(2), point: occ.point.toArray().map((v) => +v.toFixed(2)) } : null;
    return out;
  }

  /** Attach the content-pipeline loaders (main.ts: render.attachAssets(assets)). */
  attachAssets(assets: RenderAssetSource | null): void {
    this.assets = assets;
  }

  /** The bound view (null before the first setView). */
  get view(): { scene: THREE.Scene; camera: THREE.Camera } | null {
    return this.scene && this.camera ? { scene: this.scene, camera: this.camera } : null;
  }

  /** Bind the active scene + camera (post passes are rebuilt for it). */
  setView(scene: THREE.Scene, camera: THREE.Camera): void {
    this.scene = scene;
    this.camera = camera;
    this.post.setView(scene, camera);
  }

  readonly resize = (): void => {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio) * this.resolutionScale;
    const changed = w !== this.width || h !== this.height || Math.abs(dpr - this.pixelRatio) > 1e-3;
    this.width = w;
    this.height = h;
    this.pixelRatio = dpr;
    if (!changed && this.renderer.domElement.width > 1) return;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h, dpr);
    if (this.camera instanceof THREE.PerspectiveCamera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  };

  /** Pin the resolution scale (evidence captures, profiling); null returns control to the dynamic controller. */
  pinResolutionScale(scale: number | null): void {
    this.pinnedScale = scale === null || !Number.isFinite(scale) ? null : Math.min(2, Math.max(0.25, scale));
    if (this.pinnedScale !== null && Math.abs(this.pinnedScale - this.resolutionScale) > 1e-3) {
      this.resolutionScale = this.pinnedScale;
      this.resize();
    }
  }

  /** Adjust resolution scale from the measured frame time (call once per frame; decisions at most every 750 ms). */
  updateDynamicResolution(avgFrameMs: number, nowMs: number): void {
    const d = this.quality.dynamicResolution;
    if (this.pinnedScale !== null) return;
    if (!d.enabled || avgFrameMs <= 0 || nowMs - this.lastDynAdjust < 750) return;
    this.lastDynAdjust = nowMs;
    const s = dynamicResolutionStep(this.resolutionScale, avgFrameMs, 1000 / this.quality.targetFps, d.minScale, d.maxScale);
    if (Math.abs(s - this.resolutionScale) > 1e-3) {
      this.resolutionScale = s;
      this.resize();
    }
  }

  /** Render the bound view through the post pipeline (or directly). */
  render(dt: number): void {
    if (!this.scene || !this.camera || this.lost) return;
    this.renderer.info.reset();
    this.shadowDraws = 0;
    // Frame globals belong to the scene being drawn: neutral unless one of its hooks fills them.
    resetShaderGlobals();
    // Tier compensations every material reads (low: emissive x1.3, baked AO x1.2).
    const boost = g(G.MATERIAL_BOOST);
    boost.x = this.quality.emissiveBoost - 1;
    boost.y = this.quality.bakedAoBoost - 1;
    for (const h of this.hooks) if (h.scene === this.scene) h.beforeRender(this.camera, dt);
    this.profiler?.begin('render.submit');
    if (this.usePost) this.post.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.profiler?.end('render.submit');
    this.lastShadowDraws = this.shadowDraws;
    if (this.profiler) {
      // The profiler copies the fields (Object.assign): one reused object, no per-frame allocation.
      this.profiler.setRenderStats(this.writeStats(this.frameStats));
      this.profiler.setCounter('render.shadowDraws', this.shadowDraws);
      this.profiler.setCounter('render.postPasses', this.usePost ? this.post.enabledPassCount() : 0);
    }
  }

  /** Render stats of the last frame (a new object; the per-frame profiler feed reuses one). */
  getStats(): RenderStats {
    return this.writeStats({ drawCalls: 0, triangles: 0, points: 0, lines: 0, geometries: 0, textures: 0, programs: 0, resolutionScale: 1, pixelRatio: 1, width: 0, height: 0 });
  }

  private writeStats(out: RenderStats): RenderStats {
    const i = this.renderer.info;
    out.drawCalls = i.render.calls;
    out.triangles = i.render.triangles;
    out.points = i.render.points;
    out.lines = i.render.lines;
    out.geometries = i.memory.geometries;
    out.textures = i.memory.textures;
    out.programs = i.programs?.length ?? 0;
    out.resolutionScale = this.resolutionScale;
    out.pixelRatio = this.pixelRatio;
    out.width = Math.round(this.width * this.pixelRatio);
    out.height = Math.round(this.height * this.pixelRatio);
    return out;
  }

  /** Render now and return the canvas as a PNG data URL (QA screenshots). */
  capture(): string | null {
    if (!this.scene || !this.camera) return null;
    this.render(0);
    try {
      return this.canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.resize);
    this.post.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
  }
}

/** Dispose every geometry/material/texture under an object (scene exit helper). */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (mat) {
      for (const m of Array.isArray(mat) ? mat : [mat]) {
        for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
        m.dispose();
      }
    }
    if (o instanceof THREE.InstancedMesh) o.dispose();
  });
}
