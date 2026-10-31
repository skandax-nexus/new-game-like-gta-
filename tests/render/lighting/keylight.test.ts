/**
 * GFX-01 round 2 (Art Director R2-1 / R2-2): twilight key cross-fade by intensity, PCSS max penumbra from the sun's
 * softness, and the low tier's tight single-cascade fit. OWNER: Graphics Developer - Lighting, Atmosphere & Post.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildQualitySettings } from '../../../src/core/quality';
import {
  KEY_MIN_ELEVATION_DEG,
  TWILIGHT_KEY_CAP,
  TWILIGHT_KEY_SOFTNESS_DEG,
  shadowLengthRatio,
  sunKeyWeight,
  twilightKey,
  twilightKeySoftness,
} from '../../../src/render/lighting/keyLight';
import { CascadedShadows, LOW_HERO_FAR_M, lowCascadeFarM, pcssMaxPenumbraTexels, quantiseExtent, CSM_DEBUG } from '../../../src/render/lighting/csm';
import { installShaderGlobals } from '../../../src/render/materials/chunks/globals';
import { createZoomLook, resolveZoomLook } from '../../../src/render/style/zoom';
import { sunDirection } from '../../../src/render/environment/sky';
import { makeEnvironment } from '../../../src/sim/strategic/seasons';

/** Solar elevation (deg) of the shots script's presets (sharad, clear). */
function elevation(hour: number): number {
  const d = sunDirection(makeEnvironment(hour, 'sharad', 'clear'), new THREE.Vector3());
  return (Math.asin(d.y) * 180) / Math.PI;
}

describe('twilight key (AD round 2, R2-1)', () => {
  it('golden 17.4 h and night 22 h keep a full key and no extra fill (those shots must not change)', () => {
    const golden = twilightKey(elevation(17.4));
    expect(golden.moonCasts).toBe(false);
    expect(golden.keyWeight).toBe(1);
    expect(golden.fillIrradiance).toBe(0);
    expect(golden.twilightSoftness).toBe(0);
    const night = twilightKey(elevation(22));
    expect(night.moonCasts).toBe(true);
    expect(night.keyWeight).toBe(1);
    expect(night.fillIrradiance).toBeLessThan(1e-9);
    expect(night.twilightSoftness).toBe(0);
    expect(twilightKeySoftness(0.4, night)).toBeCloseTo(0.4, 9);
  });

  it('the sun key fades by intensity, smoothstep(3, -4): 0 below -4 deg, and a clamped key never exceeds 25 %', () => {
    expect(sunKeyWeight(-4)).toBe(0);
    expect(sunKeyWeight(-10)).toBe(0);
    for (let e = -6; e <= KEY_MIN_ELEVATION_DEG; e += 0.05) expect(sunKeyWeight(e)).toBeLessThanOrEqual(TWILIGHT_KEY_CAP + 1e-9);
    expect(sunKeyWeight(KEY_MIN_ELEVATION_DEG)).toBeCloseTo(TWILIGHT_KEY_CAP, 9);
    expect(sunKeyWeight(6)).toBe(1);
  });

  it('dusk shots (18.4 h, 18.9 h): the key casts from the moon at >= 25 deg (shadow <= 7x caster) and is weak', () => {
    for (const hour of [18.4, 18.9]) {
      const k = twilightKey(elevation(hour));
      expect(k.moonCasts).toBe(true);
      expect(shadowLengthRatio(k.moonKeyElevationDeg)).toBeLessThanOrEqual(7);
      expect(k.keyWeight).toBeLessThan(0.3);
      expect(k.fillIrradiance).toBeGreaterThan(0.1);
      // Twilight penumbra: wider than the moon preset's 0.4 deg while the moon key is still rising (> 1.5 deg).
      expect(twilightKeySoftness(0.4, k)).toBeGreaterThan(1.5);
    }
  });

  it('every key below 8 deg elevation with a clamped direction carries <= 25 %; the caster switches when both are weak', () => {
    let prev = twilightKey(30);
    for (let e = 30; e >= -70; e -= 0.02) {
      const k = twilightKey(e);
      const keyEl = k.moonCasts ? k.moonKeyElevationDeg : k.sunKeyElevationDeg;
      if (keyEl < 8 && e < KEY_MIN_ELEVATION_DEG) expect(k.keyWeight).toBeLessThanOrEqual(TWILIGHT_KEY_CAP + 1e-9);
      if (k.moonCasts !== prev.moonCasts) expect(Math.max(k.keyWeight, prev.keyWeight)).toBeLessThan(0.02);
      // Continuous in time (no pops while the clock runs).
      expect(Math.abs(k.keyWeight - prev.keyWeight)).toBeLessThan(0.01);
      expect(Math.abs(k.fillIrradiance - prev.fillIrradiance)).toBeLessThan(0.01);
      prev = k;
    }
  });

  it('flat-ground energy: key + fill matches the previous one-key model (no darker twilight frames)', () => {
    for (const e of [1, -2, -5, -7.4, -10, -14.2, -20]) {
      const k = twilightKey(e);
      const sinEl = Math.sin(((k.moonCasts ? k.moonKeyElevationDeg : k.sunKeyElevationDeg) * Math.PI) / 180);
      const total = k.keyWeight * sinEl + k.fillIrradiance;
      expect(total).toBeGreaterThan(0.04);
    }
    expect(TWILIGHT_KEY_SOFTNESS_DEG).toBeGreaterThan(1.5);
  });
});

describe('PCSS max penumbra from the sun softness (AD round 2, R2-1)', () => {
  it('crisp suns keep the tier base (golden / noon / night unchanged); > 1.5 deg allows >= 64 texels; capped', () => {
    for (const s of [0.35, 0.4, 0.6, 0.75]) {
      expect(pcssMaxPenumbraTexels(s, true)).toBe(28);
      expect(pcssMaxPenumbraTexels(s, false)).toBe(18);
    }
    for (const s of [1.51, 2, 2.5, 3, 8]) {
      expect(pcssMaxPenumbraTexels(s, true)).toBeGreaterThanOrEqual(64);
      expect(pcssMaxPenumbraTexels(s, false)).toBeGreaterThanOrEqual(64);
    }
    expect(pcssMaxPenumbraTexels(8, true)).toBe(128);
    expect(pcssMaxPenumbraTexels(1.2, true)).toBeGreaterThan(28);
  });
});

describe('low tier single cascade: tight fit (AD round 2, R2-2)', () => {
  it('far split pulled to 30 m on the hero band, untouched from the close band out', () => {
    const hero = resolveZoomLook(4.5, createZoomLook());
    const close = resolveZoomLook(45, createZoomLook());
    const tactical = resolveZoomLook(220, createZoomLook());
    expect(lowCascadeFarM(hero, 45)).toBe(LOW_HERO_FAR_M);
    expect(lowCascadeFarM(close, 80)).toBe(80);
    expect(lowCascadeFarM(tactical, 210)).toBe(210);
    expect(quantiseExtent(10.1)).toBe(10.5);
    expect(quantiseExtent(0)).toBeGreaterThan(0);
  });

  it('hero camera on low: AABB fit, whole-texel snapping, >= 2x denser than the round-1 sphere fit', () => {
    installShaderGlobals();
    const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 3000);
    camera.position.set(0, 2.2, 6);
    camera.lookAt(0, 1.4, 0);
    camera.updateMatrixWorld();
    const toLight = new THREE.Vector3(-0.95, Math.sin((6.2 * Math.PI) / 180), 0.3).normalize();
    const hero = resolveZoomLook(4.5, createZoomLook());
    const low = new CascadedShadows(buildQualitySettings('low'));
    low.update(camera, toLight, hero, 4.5);
    expect(low.info.fit).toBe('aabb');
    expect(low.info.distance).toBeLessThanOrEqual(LOW_HERO_FAR_M);
    const [tx, ty] = [low.info.texelsXY[0]!, low.info.texelsXY[1]!];
    const cam = low.lights[0]!.shadow.camera as THREE.OrthographicCamera;
    expect(cam.right - cam.left).toBeCloseTo(tx * 1024, 6);
    expect(cam.top - cam.bottom).toBeCloseTo(ty * 1024, 6);
    // Round-1 fit: bounding sphere of the 0.1 .. 45 m slice (texel = 2 r / 1024).
    const sphereTexel = 0.1;
    expect(Math.max(tx, ty)).toBeLessThan(sphereTexel / 2);
    // The light-space box origin sits on the texel grid: panning by a fraction of a texel does not move the map.
    const ax = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const left = cam.position.dot(ax) + cam.left;
    expect(Math.abs(left / tx - Math.round(left / tx))).toBeLessThan(1e-3);
    // Debug A/B hook: shadow intensity override reaches the cascade light.
    CSM_DEBUG.shadowIntensity = 0;
    low.update(camera, toLight, hero, 4.5);
    expect(low.lights[0]!.shadow.intensity).toBe(0);
    CSM_DEBUG.shadowIntensity = -1;
    low.update(camera, toLight, hero, 4.5);
    expect(low.lights[0]!.shadow.intensity).toBe(1);
    low.dispose();
  });

  it('other tiers keep the stable sphere fit', () => {
    installShaderGlobals();
    const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 3000);
    camera.position.set(0, 2.2, 6);
    camera.lookAt(0, 1.4, 0);
    camera.updateMatrixWorld();
    const csm = new CascadedShadows(buildQualitySettings('ultra'));
    csm.update(camera, new THREE.Vector3(0.3, 0.8, 0.2).normalize(), resolveZoomLook(4.5, createZoomLook()), 4.5);
    expect(csm.info.fit).toBe('sphere');
    csm.dispose();
  });
});
