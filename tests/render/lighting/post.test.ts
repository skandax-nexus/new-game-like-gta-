/**
 * GFX-01 post stack (ART_BIBLE §4.7 / §13): tier pass plans, shafts gating, DoF circle of confusion, TAA jitter,
 * lens dirt, the SSR material mask and the final grade shader contract. OWNER: Graphics Developer - Lighting,
 * Atmosphere & Post (GFX-01).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildQualitySettings } from '../../../src/core/quality';
import { planPasses, PostPipeline } from '../../../src/render/post';
import { createZoomLook } from '../../../src/render/style/zoom';
import { shaftsActive, SHAFTS_MAX_ELEVATION_DEG } from '../../../src/render/post/shafts';
import { circleOfConfusionPx } from '../../../src/render/post/dof';
import { halton, TAA_JITTER_PHASES } from '../../../src/render/post/scenePass';
import { lensDirtPixels, LENS_DIRT_SIZE } from '../../../src/render/post/bloom';
import { SSR_MASK_GLSL } from '../../../src/render/post/ssr';
import { FinalPass, LUT_STRENGTH } from '../../../src/render/post/final';
import { createPostFrame } from '../../../src/render/post/shared';
import { installShaderGlobals } from '../../../src/render/materials/chunks/globals';

describe('tier plans (ART_BIBLE §13 "Post" row)', () => {
  const plan = (t: 'low' | 'medium' | 'high' | 'ultra') => planPasses(buildQualitySettings(t));

  it('low: one merged fullscreen pass (grade + vignette + FXAA), nothing else', () => {
    const p = plan('low');
    expect(p.merged).toBe(true);
    expect([p.ao, p.shafts, p.contact, p.ssr, p.bloom, p.dof, p.taa, p.smaa, p.fxaa, p.composite]).toEqual([null, null, false, false, false, false, false, false, false, false]);
    expect(p.final.fxaa).toBe(true);
    expect(p.final.grade && p.final.vignette).toBe(true);
  });

  it('medium: bloom, half-res shafts (24), separate FXAA; no GTAO / DoF / LUT', () => {
    const p = plan('medium');
    expect(p.merged).toBe(false);
    expect(p.ao).toBeNull();
    expect(p.shafts).toEqual({ samples: 24, scale: 0.5 });
    expect(p.bloom && p.fxaa).toBe(true);
    expect(p.smaa || p.taa || p.dof || p.final.lut).toBe(false);
  });

  it('high: GTAO half, shafts 32 half, bloom, DoF (hero), LUT, SMAA', () => {
    const p = plan('high');
    expect(p.ao).toEqual({ scale: 0.5, slices: 2 });
    expect(p.shafts).toEqual({ samples: 32, scale: 0.5 });
    expect(p.bloom && p.dof && p.smaa && p.final.lut).toBe(true);
    expect(p.taa || p.ssr || p.contact || p.final.dirt).toBe(false);
  });

  it('ultra: GTAO full, contact shadows, SSR, full-res shafts (48), lens dirt, TAA (hero) + SMAA', () => {
    const p = plan('ultra');
    expect(p.ao).toEqual({ scale: 1, slices: 3 });
    expect(p.shafts).toEqual({ samples: 48, scale: 1 });
    expect(p.contact && p.ssr && p.composite && p.final.dirt && p.final.lut && p.final.chromaticAberration).toBe(true);
    expect(p.taa && p.smaa).toBe(true);
    expect(LUT_STRENGTH).toBe(0.35);
  });
});

describe('shafts gating (sun below 35 deg or strength > 0.3)', () => {
  it('runs for a low sun, a strong preset, never with no samples / band / visibility', () => {
    expect(SHAFTS_MAX_ELEVATION_DEG).toBe(35);
    expect(shaftsActive(32, 0.45, 8, 1, 1)).toBe(true);
    expect(shaftsActive(32, 0.2, 60, 1, 1)).toBe(false);
    expect(shaftsActive(32, 0.5, 60, 1, 1)).toBe(true);
    expect(shaftsActive(0, 0.6, 8, 1, 1)).toBe(false);
    expect(shaftsActive(32, 0.6, 8, 0, 1)).toBe(false);
    expect(shaftsActive(32, 0.6, 8, 1, 0)).toBe(false);
  });
});

describe('depth of field', () => {
  it('in focus at the focus distance, grows with defocus, capped at maxPx x strength, weaker at small apertures', () => {
    expect(circleOfConfusionPx(4.5, 4.5, 2.8, 10, 1)).toBe(0);
    const far = circleOfConfusionPx(1e6, 4.5, 2.8, 10, 1);
    const mid = circleOfConfusionPx(20, 4.5, 2.8, 10, 1);
    expect(far).toBeGreaterThan(mid);
    expect(far).toBeLessThanOrEqual(10);
    expect(circleOfConfusionPx(0.5, 4.5, 2.8, 10, 1)).toBe(10);
    expect(circleOfConfusionPx(1e6, 4.5, 8, 10, 1)).toBeLessThan(far);
    expect(circleOfConfusionPx(1e6, 45, 8, 4, 0)).toBe(0);
  });
});

describe('TAA jitter', () => {
  it('Halton (2, 3) over 8 phases stays inside the pixel and averages to its centre', () => {
    let sx = 0;
    let sy = 0;
    for (let i = 1; i <= TAA_JITTER_PHASES; i++) {
      const x = halton(i, 2) - 0.5;
      const y = halton(i, 3) - 0.5;
      expect(Math.abs(x)).toBeLessThan(0.5);
      expect(Math.abs(y)).toBeLessThan(0.5);
      sx += x;
      sy += y;
    }
    expect(Math.abs(sx / TAA_JITTER_PHASES)).toBeLessThan(0.07);
    expect(Math.abs(sy / TAA_JITTER_PHASES)).toBeLessThan(0.07);
  });
});

describe('lens dirt and shader contracts', () => {
  it('procedural lens dirt is deterministic and mostly dark', () => {
    const a = lensDirtPixels();
    expect(a.length).toBe(LENS_DIRT_SIZE.width * LENS_DIRT_SIZE.height * 4);
    let sum = 0;
    for (let i = 0; i < a.length; i += 4) sum += a[i]!;
    const mean = sum / (a.length / 4) / 255;
    expect(mean).toBeGreaterThan(0.01);
    expect(mean).toBeLessThan(0.25);
    expect(lensDirtPixels()).toBe(a);
  });

  it('SSR mask: only opaque standard / physical materials, off when the cut-off is 0; patched into three', () => {
    expect(SSR_MASK_GLSL).toContain('#if defined( STANDARD ) && defined( OPAQUE )');
    expect(SSR_MASK_GLSL).toContain('if ( samSsrCut > 0.0 )');
    installShaderGlobals();
    expect(THREE.ShaderChunk.opaque_fragment).toContain('samSsrCut');
  });

  it("the final pass keeps the 'SamrajyaGrade' material name and the merged low variant carries FXAA", () => {
    const black = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    const lut = new THREE.Data3DTexture(new Uint8Array(32), 2, 2, 2);
    const features = { bloom: false, shafts: false, dirt: false, lut: false, chromaticAberration: false, grade: true, vignette: true, fxaa: true, toneMapper: 'aces' as const };
    const fp = new FinalPass(createPostFrame(), features, { black, lut });
    expect(fp.material.name).toBe('SamrajyaGrade');
    expect(fp.material.defines.SAM_FXAA).toBe(1);
    expect(fp.material.fragmentShader).toContain('samACES');
    fp.dispose();
  });
});

describe('PostPipeline per-scene inputs (the pipeline outlives scenes)', () => {
  /** Minimal renderer surface the pipeline touches outside render() (node: no WebGL). */
  const fakeRenderer = (): THREE.WebGLRenderer =>
    ({ toneMappingExposure: 1, getPixelRatio: () => 1, getSize: (v: THREE.Vector2) => v.set(1, 1) }) as unknown as THREE.WebGLRenderer;
  const focusOf = (p: PostPipeline): unknown => p.info().focus;

  it('a new scene drops the previous focus override, forced TAA, zoom look and AgX; a new camera keeps them', () => {
    installShaderGlobals();
    const post = new PostPipeline(fakeRenderer(), buildQualitySettings('low'));
    const sceneA = new THREE.Scene();
    const sceneB = new THREE.Scene();
    const camA = new THREE.PerspectiveCamera();
    const camB = new THREE.PerspectiveCamera();
    post.setView(sceneA, camA);
    post.setFocus(6, 2, 8);
    post.setTaa(true);
    post.applyZoomLook(createZoomLook(), 6);
    post.setToneMapping('agx');
    // Cutscene camera in the same scene: the scene's choices stay.
    post.setView(sceneA, camB);
    expect(focusOf(post)).toEqual({ distance: 6, fStop: 2, maxBlurPx: 8, strength: 1 });
    expect(post.info().taaMode).toBe(true);
    expect(post.toneMapping).toBe('agx');
    // Next scene: neutral again (no hero DoF / forced TAA / AgX leaking into a battle).
    post.setView(sceneB, camA);
    expect(focusOf(post)).toEqual({ distance: 220, auto: true });
    expect(post.info().taaMode).toBe('auto');
    expect(post.info().look).toBeNull();
    expect(post.toneMapping).toBe('aces');
    post.dispose();
  });
});
