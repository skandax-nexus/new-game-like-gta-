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
import { PostPipeline } from './post';

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
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.applyRendererQuality();
    this.post = new PostPipeline(renderer, quality);
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.onContextLost?.();
    });
    this.resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    this.resizeObserver?.observe(canvas);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  private applyRendererQuality(): void {
    const q = this.quality;
    this.renderer.shadowMap.enabled = q.shadows.enabled;
    this.renderer.shadowMap.type = q.shadows.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.renderer.shadowMap.needsUpdate = true;
  }

  setQuality(q: QualitySettings): void {
    this.quality = q;
    this.resolutionScale = Math.min(this.resolutionScale, q.dynamicResolution.maxScale);
    this.applyRendererQuality();
    this.post.setQuality(q);
    this.resize();
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
