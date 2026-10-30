/**
 * Headless stand-in for RenderContext (no WebGL) so EnvironmentRig logic runs under vitest. OWNER: Graphics
 * Developer - Lighting, Atmosphere & Post (GFX-01).
 */
import * as THREE from 'three';
import type { QualitySettings, QualityTier } from '../../../src/core/types';
import { buildQualitySettings } from '../../../src/core/quality';
import type { FrameHook, RenderContext } from '../../../src/render/renderer';
import type { GradeParams } from '../../../src/render/post';
import type { ZoomLook } from '../../../src/render/style/zoom';

export interface FakePost {
  grade: GradeParams | null;
  bloom: [number, number, number] | null;
  ao: [number, number] | null;
  look: ZoomLook | null;
  setGrade(g: GradeParams): void;
  setBloom(strength: number, radius: number, threshold: number): void;
  setAmbientOcclusion(intensity: number, radiusM: number): void;
  applyZoomLook(look: ZoomLook): void;
}

export interface FakeRender {
  ctx: RenderContext;
  hooks: FrameHook[];
  post: FakePost;
  renderer: { toneMappingExposure: number; extensions: { has(name: string): boolean } };
  quality: QualitySettings;
  qualityListeners: ((q: QualitySettings) => void)[];
  /** Run the scene's frame hooks with a camera (what RenderContext.render does before drawing). */
  frame(scene: THREE.Scene, camera: THREE.Camera, dt?: number): void;
  setQuality(tier: QualityTier): void;
}

export function fakeRenderContext(tier: QualityTier = 'high'): FakeRender {
  const hooks: FrameHook[] = [];
  const qualityListeners: ((q: QualitySettings) => void)[] = [];
  const post: FakePost = {
    grade: null,
    bloom: null,
    ao: null,
    look: null,
    setGrade(g) {
      this.grade = { ...g, tint: [g.tint[0], g.tint[1], g.tint[2]] };
    },
    setBloom(s, r, t) {
      this.bloom = [s, r, t];
    },
    setAmbientOcclusion(i, r) {
      this.ao = [i, r];
    },
    applyZoomLook(l) {
      this.look = l;
    },
  };
  const renderer = { toneMappingExposure: 1, extensions: { has: () => false } };
  const quality = buildQualitySettings(tier);
  const ctx = {
    quality,
    renderer,
    pmrem: {},
    post,
    assets: null,
    addFrameHook(h: FrameHook) {
      hooks.push(h);
      return () => {
        const i = hooks.indexOf(h);
        if (i >= 0) hooks.splice(i, 1);
      };
    },
    onQualityChange(fn: (q: QualitySettings) => void) {
      qualityListeners.push(fn);
      return () => undefined;
    },
    onContextRestored() {
      return () => undefined;
    },
  };
  const fake: FakeRender = {
    ctx: ctx as unknown as RenderContext,
    hooks,
    post,
    renderer,
    quality,
    qualityListeners,
    frame(scene, camera, dt = 1 / 60) {
      camera.updateMatrixWorld();
      for (const h of hooks) if (h.scene === scene) h.beforeRender(camera, dt);
    },
    setQuality(t) {
      const q = buildQualitySettings(t);
      (ctx as { quality: QualitySettings }).quality = q;
      fake.quality = q;
      for (const fn of qualityListeners) fn(q);
    },
  };
  return fake;
}
