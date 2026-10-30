/**
 * GFX-01 environment rig (ART_BIBLE §4.2, §4.3, §4.6) on a headless RenderContext. OWNER: Graphics Developer -
 * Lighting, Atmosphere & Post (GFX-01).
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { EnvironmentState } from '../../../src/core/types';
import { makeEnvironment, makeWeather } from '../../../src/sim/strategic/seasons';
import { EnvironmentRig } from '../../../src/render/environment/environment';
import { sunDirection } from '../../../src/render/environment/sky';
import { lerpResolved, LIGHTING_PRESETS, PRACTICAL_LIGHTS, presetToResolved, resolveHeroMood, resolveLighting } from '../../../src/render/style/lighting';
import { blendResolvedInto, cloneResolved } from '../../../src/render/lighting/resolved';
import { LightningFlash } from '../../../src/render/lighting/lightning';
import { PracticalLights } from '../../../src/render/lighting/practicals';
import { MATERIAL_GLOBALS } from '../../../src/render/materials/pbr';
import { surfaceWetnessFromWeather } from '../../../src/render/materials/chunks/wetness';
import { createZoomLook, resolveZoomLook } from '../../../src/render/style/zoom';
import { fakeRenderContext } from './fakeContext';

const rigs: EnvironmentRig[] = [];
function makeRig(tier: 'low' | 'medium' | 'high' | 'ultra' = 'high'): { rig: EnvironmentRig; fake: ReturnType<typeof fakeRenderContext>; scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
  const fake = fakeRenderContext(tier);
  const scene = new THREE.Scene();
  const rig = new EnvironmentRig(fake.ctx, scene, { sceneSize: 1024 });
  rig.sky.bakeEnabled = false;
  rigs.push(rig);
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.5, 12000);
  camera.position.set(0, 160, 160);
  camera.lookAt(0, 0, 0);
  return { rig, fake, scene, camera };
}
afterEach(() => {
  while (rigs.length) rigs.pop()!.dispose();
});

function env(hour: number, weather: Parameters<typeof makeWeather>[0] = 'clear', season: EnvironmentState['season'] = 'sharad'): EnvironmentState {
  const e = makeEnvironment(hour, season, 'clear');
  return weather === 'clear' ? e : { ...e, weather: makeWeather(weather, season, e.weather.windDirection) };
}

describe('EnvironmentRig applies resolveLighting exactly as ART_BIBLE §4.2 shows', () => {
  it('sun / hemi (x0.35 with IBL) / exposure / grade / bloom threshold / wetness / practicals', () => {
    const { rig, fake, scene, camera } = makeRig('high');
    const e = env(12.5);
    rig.setEnvironment(e);
    const dir = sunDirection(e, new THREE.Vector3());
    const elev = (Math.asin(dir.y) * 180) / Math.PI;
    const r = resolveLighting({ sunElevationDeg: elev, hour: e.hour, season: e.season, weather: e.weather });
    expect(rig.sun.intensity).toBeCloseTo(r.sunIntensity, 9);
    expect([rig.sun.color.r, rig.sun.color.g, rig.sun.color.b]).toEqual(r.sunColor.map((v) => expect.closeTo(v, 6)));
    expect(rig.hemi.intensity).toBeCloseTo(r.hemiIntensity * 0.35, 9);
    expect(fake.post.grade).toMatchObject({ contrast: r.grade.contrast, saturation: r.grade.saturation, warmth: r.grade.warmth });
    expect(fake.post.bloom![2]).toBeCloseTo(r.bloomThreshold / r.exposure, 9);
    expect(MATERIAL_GLOBALS.wetness.value).toBeCloseTo(Math.max(r.wetness, surfaceWetnessFromWeather(e.weather.wetness)), 9);
    fake.frame(scene, camera);
    expect(fake.renderer.toneMappingExposure).toBeCloseTo(r.exposure, 9);
    expect(rig.resolved.dominant).toBe(r.dominant);
  });

  it('hemisphere is not reduced without an IBL (envMapSize 0)', () => {
    const { rig, fake } = makeRig('low');
    fake.quality.envMapSize = 0;
    rig.setQuality({ ...fake.quality, envMapSize: 0 });
    rig.setEnvironment(env(12.5));
    expect(rig.hemi.intensity).toBeCloseTo(rig.resolved.hemiIntensity, 9);
  });

  it('monsoon weather -> wetness at least the overlay and the weather wetness', () => {
    const { rig } = makeRig();
    const e = env(14, 'monsoon_rain', 'varsha');
    rig.setEnvironment(e);
    expect(MATERIAL_GLOBALS.wetness.value).toBeGreaterThanOrEqual(e.weather.wetness);
    expect(MATERIAL_GLOBALS.wetness.value).toBeGreaterThan(0.5);
  });

  it('night: moonlit key light high in the sky, night grade, exposure 2.5', () => {
    const { rig, fake, scene, camera } = makeRig();
    rig.setEnvironment(env(22));
    fake.frame(scene, camera);
    const key = rig.sunDirection();
    expect(key.y).toBeGreaterThan(Math.sin((24 * Math.PI) / 180));
    expect(rig.resolved.dominant).toBe('night');
    expect(fake.renderer.toneMappingExposure).toBeCloseTo(LIGHTING_PRESETS.night.exposure, 6);
    expect(rig.sky.night).toBe(1);
  });

  it('the key light never grazes below 3 deg (dawn sun at the horizon)', () => {
    const { rig } = makeRig();
    rig.setEnvironment(env(6.0));
    expect(Math.asin(rig.sunDirection().y)).toBeGreaterThanOrEqual((2.99 * Math.PI) / 180);
  });

  it('setResolved overrides and eases exposure; null returns to the time of day', () => {
    const { rig, fake, scene, camera } = makeRig();
    rig.setEnvironment(env(12.5));
    fake.frame(scene, camera);
    const noonExp = fake.renderer.toneMappingExposure;
    rig.setResolved(resolveHeroMood('incense_dim'));
    expect(rig.resolved.exposure).toBeCloseTo(1.6, 9);
    fake.frame(scene, camera, 0.1);
    const mid = fake.renderer.toneMappingExposure;
    expect(mid).toBeGreaterThan(noonExp);
    expect(mid).toBeLessThan(1.6);
    for (let i = 0; i < 60; i++) fake.frame(scene, camera, 0.1);
    expect(fake.renderer.toneMappingExposure).toBeCloseTo(1.6, 3);
    rig.setResolved(null);
    expect(rig.resolved.dominant).toBe('noon');
  });
});

describe('hero moods (ART_BIBLE §4.3)', () => {
  it('setMoodBlend matches lerpResolved of the moods (the caller owns the 40 m cross-fade)', () => {
    const { rig } = makeRig();
    rig.setEnvironment(env(17.4));
    rig.setMoodBlend([
      { mood: 'golden_dust', weight: 0.3 },
      { mood: 'lamp_night', weight: 0.7 },
    ]);
    const ref = lerpResolved(resolveHeroMood('golden_dust'), resolveHeroMood('lamp_night'), 0.7);
    expect(rig.resolved.exposure).toBeCloseTo(ref.exposure, 9);
    expect(rig.resolved.fogDensity).toBeCloseTo(ref.fogDensity, 12);
    expect(rig.resolved.practicals).toBeCloseTo(ref.practicals, 9);
    expect(rig.resolved.dominant).toBe(ref.dominant);
    rig.setMoodBlend([]);
    expect(rig.resolved.dominant).not.toBe('night');
  });

  it('blendResolvedInto is lerpResolved without allocation (and may alias its first input)', () => {
    const a = presetToResolved(LIGHTING_PRESETS.dawn);
    const b = presetToResolved(LIGHTING_PRESETS.monsoon);
    for (const t of [0, 0.25, 0.5, 0.9, 1]) {
      const ref = lerpResolved(a, b, t);
      const out = blendResolvedInto(cloneResolved(a), a, b, t);
      expect(out).toEqual(ref);
      const alias = cloneResolved(a);
      expect(blendResolvedInto(alias, alias, b, t)).toEqual(ref);
    }
  });
});

describe('lightning (ART_BIBLE §4.6)', () => {
  it('double flash of #d8e2ff at intensity 9 for 80-160 ms, sky +2 EV, then dark', () => {
    let seed = 0.37;
    const flash = new LightningFlash(() => (seed = (seed * 9301 + 49297) % 233280 / 233280));
    const target = new THREE.Vector3();
    expect(flash.update(0.016, target)).toBe(1);
    flash.trigger();
    expect(flash.light.color.getHexString()).toBe(new THREE.Color(PRACTICAL_LIGHTS.lightningFlash.color).getHexString());
    let peak = 0;
    let lit = 0;
    let t = 0;
    let firstEnd = -1;
    for (let i = 0; i < 100; i++) {
      const m = flash.update(0.005, target);
      t += 0.005;
      peak = Math.max(peak, m);
      if (flash.light.intensity > 0) lit += 0.005;
      if (firstEnd < 0 && flash.light.intensity === 0 && lit > 0) firstEnd = t;
    }
    expect(peak).toBeCloseTo(4, 6);
    expect(firstEnd).toBeGreaterThanOrEqual(0.08);
    expect(firstEnd).toBeLessThanOrEqual(0.17);
    expect(flash.light.intensity).toBe(0);
    expect(flash.flashing).toBe(false);
  });

  it('storm weather adds the flash light at setup (no recompile on the first strike); the light count stays stable', () => {
    const { rig, scene } = makeRig();
    rig.setEnvironment(env(15, 'clear', 'sharad'));
    expect(rig.lightning.light.parent).toBeNull();
    rig.setEnvironment(env(15, 'storm', 'varsha'));
    expect(rig.lightning.light.parent).toBe(scene);
    const lights = scene.children.length;
    rig.triggerLightning();
    rig.setEnvironment(env(15, 'clear', 'sharad'));
    expect(scene.children.length).toBe(lights);
    // Any other weather still gets the light on first use (fallback).
    const other = makeRig();
    other.rig.setEnvironment(env(15, 'cloudy', 'sharad'));
    other.rig.triggerLightning();
    expect(other.rig.lightning.light.parent).toBe(other.scene);
  });

  it('every flash comes from its own bearing above the camera focus, wherever the focus is', () => {
    const flash = new LightningFlash(() => 0.5);
    const dir = new THREE.Vector3();
    const up = new THREE.Vector3(0.3, 0.9, -0.2).normalize();
    for (const target of [new THREE.Vector3(0, 0, 0), new THREE.Vector3(1800, 40, -2400), new THREE.Vector3(-900, 10, 600)]) {
      flash.trigger(up);
      flash.update(0.01, target);
      dir.copy(flash.light.position).sub(flash.light.target.position).normalize();
      expect(dir.distanceTo(up)).toBeLessThan(1e-6);
      expect(flash.light.target.position.distanceTo(target)).toBeLessThan(1e-9);
    }
  });
});

describe('practical lights (ART_BIBLE §4.6)', () => {
  it('nearest N are real point lights (pool = QualitySettings.practicalLights), flicker within the kind depth', () => {
    const p = new PracticalLights(4, 1);
    p.weight = 1;
    const cam = new THREE.Vector3(0, 2, 0);
    for (let i = 0; i < 12; i++) p.add('torch', i * 10, 2, 0);
    let minI = Infinity;
    let maxI = 0;
    for (let f = 0; f < 120; f++) {
      p.update(1 / 60, cam);
      const lights = p.object.children.filter((o) => (o as THREE.PointLight).isPointLight) as THREE.PointLight[];
      expect(lights.length).toBe(4);
      for (const l of lights) {
        expect(l.position.x).toBeLessThanOrEqual(30);
        minI = Math.min(minI, l.intensity);
        maxI = Math.max(maxI, l.intensity);
      }
    }
    const def = PRACTICAL_LIGHTS.torch;
    expect(maxI).toBeLessThanOrEqual(def.intensity + 1e-9);
    expect(minI).toBeGreaterThanOrEqual(def.intensity * (1 - def.flicker) - 1e-9);
    expect(maxI - minI).toBeGreaterThan(def.intensity * def.flicker * 0.4);
    expect(p.size).toBe(12);
    p.dispose();
  });

  it('lamps follow r.practicals (off at noon) while burning buildings always burn', () => {
    const p = new PracticalLights(2, 1);
    const cam = new THREE.Vector3();
    p.add('oilLamp', 1, 0, 0);
    const fire = p.add('burningBuilding', 3, 0, 0);
    p.weight = 0;
    p.update(0.016, cam);
    expect(p.litCount).toBe(1);
    p.weight = 1;
    p.update(0.016, cam);
    expect(p.litCount).toBe(2);
    fire.remove();
    p.update(0.016, cam);
    expect(p.litCount).toBe(1);
    p.dispose();
  });

  it('rig.addPractical uses the tier pool size', () => {
    const { rig } = makeRig('ultra');
    rig.addPractical('torch', { x: 0, y: 2, z: 0 });
    const n = rig.practicals.object.children.filter((o) => (o as THREE.PointLight).isPointLight).length;
    expect(n).toBe(16);
  });
});

describe('lifecycle', () => {
  it('dispose removes everything it added and resets wetness', () => {
    const { rig, scene } = makeRig();
    rig.setEnvironment(env(14, 'monsoon_rain', 'varsha'));
    rig.triggerLightning();
    rigs.pop();
    rig.dispose();
    expect(scene.children.length).toBe(0);
    expect(scene.fog).toBeNull();
    expect(MATERIAL_GLOBALS.wetness.value).toBe(0);
  });
});

describe('caller-supplied ZoomLook (GFX-05 contract, review)', () => {
  it('is copied, capped by tier and never aliased: dropping it later leaves the caller object untouched', () => {
    const { rig, fake, scene, camera } = makeRig('high');
    rig.setEnvironment(env(12.5));
    const callers = resolveZoomLook(4.5, createZoomLook()); // hero band: CA > 0, contact shadows on
    const snapshot = JSON.stringify(callers);
    rig.update(1 / 60, camera, callers);
    fake.frame(scene, camera);
    expect(rig.look.id).toBe('hero');
    expect(rig.look.post).not.toBe(callers.post);
    expect(rig.look.post.dof).not.toBe(callers.post.dof);
    expect(rig.look.shadows).not.toBe(callers.shadows);
    // Tier caps apply to the copy (high: no chromatic aberration, no contact shadows), not to the caller's look.
    expect(rig.look.post.chromaticAberration).toBe(0);
    expect(rig.look.shadows.contact).toBe(false);
    // Back to the rig's own camera-distance look (220 m tactical): the caller's object must not change.
    rig.update(1 / 60, camera);
    fake.frame(scene, camera);
    expect(rig.look.id).not.toBe('hero');
    expect(JSON.stringify(callers)).toBe(snapshot);
  });
});
