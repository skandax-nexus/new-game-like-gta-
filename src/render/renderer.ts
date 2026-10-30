/**
 * WebGL2 renderer bootstrap: color management, tone mapping, shadows, post pipeline, resize,
 * dynamic resolution, stats, screenshots, context-loss handling.
 * OWNER: Lead Graphics Engineer. Baseline implementation by the CTO.
 *
 * Conventions: physically based lighting (three r170 defaults), sRGB output, ACES Filmic tone
 * mapping, HDR (HalfFloat) post chain. Scenes call setView(scene, camera) once and render(dt) per frame.
 */
import * as THREE from 'three';
import type { QualitySettings } from '../core/types';
import type { Profiler, RenderStats } from '../core/profiler';
import { PostPipeline, type PostLutHandle } from './post';
import type { SkyAssetSource } from './environment/sky';
import { installShaderGlobals, resetShaderGlobals } from './materials/chunks/globals';
// Global shader patches (registered on import, applied by installShaderGlobals before any material compiles).
import './lighting/shadowChunks';
import './environment/atmosphere/heightFog';

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
    // Global shader hooks (height fog, cascades, material globals) must be in place before any material compiles.
    installShaderGlobals();
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.applyRendererQuality();
    this.post = new PostPipeline(renderer, quality);
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.onContextLost?.();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      // three re-creates GL state lazily; render-target contents (PMREM, shadow maps) must be rebuilt.
      for (const fn of this.restoreListeners) fn();
    });
    if (typeof window !== 'undefined') {
      // QA / evidence scripts: lighting, post and memory state of the frame being rendered (plain data).
      (window as unknown as { __SAMRAJYA_GFX__?: unknown }).__SAMRAJYA_GFX__ = { info: () => this.diagnostics() };
    }
    this.resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    this.resizeObserver?.observe(canvas);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  private applyRendererQuality(): void {
    const q = this.quality;
    this.renderer.shadowMap.enabled = q.shadows.enabled;
    // low: hard (one tap); medium: PCF with a radius from the sun's angular size; high / ultra: PCSS in the cascade
    // chunk (lighting/shadowChunks.ts) - PCF is the define other shadowed lights fall back to.
    this.renderer.shadowMap.type = q.shadows.soft ? THREE.PCFShadowMap : THREE.BasicShadowMap;
    this.renderer.shadowMap.needsUpdate = true;
  }

  setQuality(q: QualitySettings): void {
    this.quality = q;
    this.resolutionScale = Math.min(this.resolutionScale, q.dynamicResolution.maxScale);
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

  /** Plain-data diagnostics of the bound scene's hooks, the post pipeline and GPU memory. */
  diagnostics(): Record<string, unknown> {
    const hooks: Record<string, unknown>[] = [];
    for (const h of this.hooks) if (h.scene === this.scene && h.info) hooks.push(h.info());
    const m = this.renderer.info.memory;
    return {
      tier: this.quality.tier,
      env: hooks[0] ?? null,
      post: this.post.info(),
      memory: { geometries: m.geometries, textures: m.textures },
      stats: this.getStats(),
      assetsAttached: !!this.assets,
    };
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

  /** Adjust resolution scale from the measured frame time (call once per frame). */
  updateDynamicResolution(avgFrameMs: number, nowMs: number): void {
    const d = this.quality.dynamicResolution;
    if (!d.enabled || avgFrameMs <= 0 || nowMs - this.lastDynAdjust < 1000) return;
    this.lastDynAdjust = nowMs;
    const budget = 1000 / this.quality.targetFps;
    let s = this.resolutionScale;
    if (avgFrameMs > budget * 1.15) s -= 0.05;
    else if (avgFrameMs < budget * 0.8) s += 0.05;
    s = Math.min(d.maxScale, Math.max(d.minScale, s));
    if (Math.abs(s - this.resolutionScale) > 1e-3) {
      this.resolutionScale = s;
      this.resize();
    }
  }

  /** Render the bound view through the post pipeline (or directly). */
  render(dt: number): void {
    if (!this.scene || !this.camera) return;
    this.renderer.info.reset();
    // Frame globals belong to the scene being drawn: neutral unless one of its hooks fills them.
    resetShaderGlobals();
    for (const h of this.hooks) if (h.scene === this.scene) h.beforeRender(this.camera, dt);
    if (this.usePost) this.post.render(dt);
    else this.renderer.render(this.scene, this.camera);
    if (this.profiler) this.profiler.setRenderStats(this.getStats());
  }

  getStats(): RenderStats {
    const i = this.renderer.info;
    return {
      drawCalls: i.render.calls,
      triangles: i.render.triangles,
      points: i.render.points,
      lines: i.render.lines,
      geometries: i.memory.geometries,
      textures: i.memory.textures,
      programs: i.programs?.length ?? 0,
      resolutionScale: this.resolutionScale,
      pixelRatio: this.pixelRatio,
      width: Math.round(this.width * this.pixelRatio),
      height: Math.round(this.height * this.pixelRatio),
    };
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
