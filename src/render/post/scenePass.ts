/**
 * Scene pass: renders the scene into the HDR buffer with a sampled depth texture (GTAO, contact shadows, SSR,
 * shafts, DoF and TAA reprojection read it) and applies the TAA sub-pixel jitter (Halton 2,3; 8 phases) while
 * TAA is active. OWNER: Graphics Developer - Lighting, Atmosphere & Post (GFX-01).
 */
import * as THREE from 'three';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import type { PostFrame } from './shared';

/** Halton sequence (base b) in (0, 1). */
export function halton(index: number, base: number): number {
  let f = 1;
  let r = 0;
  let i = index;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

export const TAA_JITTER_PHASES = 8;

export class ScenePass extends Pass {
  readonly name = 'scene';
  readonly target: THREE.WebGLRenderTarget;
  /** Jitter the projection this frame (TAA). */
  jitter = false;
  /** Jitter of the last render in pixels (x, y), (0, 0) when off. */
  readonly jitterPx = new THREE.Vector2();
  private phase = 0;

  constructor(private readonly frame: PostFrame) {
    super();
    this.needsSwap = false;
    const depth = new THREE.DepthTexture(1, 1, THREE.FloatType);
    depth.format = THREE.DepthFormat;
    depth.minFilter = THREE.NearestFilter;
    depth.magFilter = THREE.NearestFilter;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture: depth,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.target.texture.name = 'post.scene';
  }

  override setSize(width: number, height: number): void {
    this.target.setSize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
  }

  override render(renderer: THREE.WebGLRenderer): void {
    const f = this.frame;
    const cam = f.camera;
    cam.updateMatrixWorld();
    f.projection.copy(cam.projectionMatrix);
    f.projectionInverse.copy(cam.projectionMatrixInverse);
    const jitter = this.jitter && f.perspective;
    if (jitter) {
      this.phase = (this.phase + 1) % TAA_JITTER_PHASES;
      const jx = halton(this.phase + 1, 2) - 0.5;
      const jy = halton(this.phase + 1, 3) - 0.5;
      this.jitterPx.set(jx, jy);
      const e = cam.projectionMatrix.elements;
      e[8] = e[8]! + (2 * jx) / f.width;
      e[9] = e[9]! + (2 * jy) / f.height;
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    } else this.jitterPx.set(0, 0);
    renderer.setRenderTarget(this.target);
    renderer.render(f.scene, cam);
    if (jitter) {
      cam.projectionMatrix.copy(f.projection);
      cam.projectionMatrixInverse.copy(f.projectionInverse);
    }
    f.sceneColor = this.target.texture;
    f.hdr = this.target.texture;
    f.depth = this.target.depthTexture;
  }

  override dispose(): void {
    this.target.depthTexture?.dispose();
    this.target.dispose();
  }
}
