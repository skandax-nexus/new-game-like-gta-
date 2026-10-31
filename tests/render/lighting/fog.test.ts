/**
 * GFX-01 height fog, mist slab, sky-dome fog and aerial perspective (ART_BIBLE §4.5). OWNER: Graphics Developer -
 * Lighting, Atmosphere & Post (GFX-01).
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { EnvironmentState, QualityTier } from '../../../src/core/types';
import { makeEnvironment, makeWeather } from '../../../src/sim/strategic/seasons';
import { EnvironmentRig } from '../../../src/render/environment/environment';
import { atmosphereSnapshot, EXP2_DENSITY_SCALE, fogModeFor } from '../../../src/render/environment/atmosphere/atmosphere';
import { fogOpticalDepth, skyDomeFogAlpha, SKY_FOG_CLAMP, SKY_FOG_DISTANCE_M, MIST_NOISE } from '../../../src/render/environment/atmosphere/fogMath';
import { heightFogInstalled, injectHeightFog } from '../../../src/render/environment/atmosphere/heightFog';
import { buildSkyShader, sampleEquirectHorizon, type SkyHdriHandle } from '../../../src/render/environment/sky';
import { buildQualitySettings } from '../../../src/core/quality';
import { G, g, installShaderGlobals } from '../../../src/render/materials/chunks/globals';
import { fakeRenderContext } from './fakeContext';

const rigs: EnvironmentRig[] = [];
afterEach(() => {
  while (rigs.length) rigs.pop()!.dispose();
});

function setup(tier: QualityTier, e: EnvironmentState, camDist = 220): { rig: EnvironmentRig; frame: (dt?: number) => void; scene: THREE.Scene } {
  const fake = fakeRenderContext(tier);
  const scene = new THREE.Scene();
  const rig = new EnvironmentRig(fake.ctx, scene, { sceneSize: 1024, bounds: { minX: -512, minZ: -512, maxX: 512, maxZ: 512 } });
  rig.sky.bakeEnabled = false;
  rigs.push(rig);
  rig.setEnvironment(e);
  const cam = new THREE.PerspectiveCamera(42, 16 / 9, 0.5, 12000);
  cam.position.set(0, camDist * 0.7, camDist * 0.7);
  cam.lookAt(0, 0, 0);
  const focus = new THREE.Vector3(0, 0, 0);
  return {
    rig,
    scene,
    frame: (dt = 1 / 60) => {
      rig.update(dt, focus);
      fake.frame(scene, cam, dt);
    },
  };
}

const dawn = (): EnvironmentState => makeEnvironment(6.4, 'hemanta', 'clear');

describe('the rig applies the sky-dome fog and the mist slab from ResolvedLighting (ART_BIBLE §4.5)', () => {
  it('sky-dome fog: d = 20 km, clamp 0.6, on every tier', () => {
    for (const tier of ['low', 'medium', 'high', 'ultra'] as const) {
      const { frame } = setup(tier, dawn());
      frame();
      const s = atmosphereSnapshot();
      expect(s.skyFogDistance).toBe(20000);
      expect(s.skyFogClamp).toBe(0.6);
      rigs.pop()!.dispose();
    }
    expect(SKY_FOG_DISTANCE_M).toBe(20000);
    expect(SKY_FOG_CLAMP).toBe(0.6);
    // The visible dome shader applies it; the PMREM source does not (IBL stays calibrated).
    expect(buildSkyShader({ envBake: false }).fragmentShader).toContain('sky = samSkyDomeFog( sky, dir );');
    expect(buildSkyShader({ envBake: true }).fragmentShader.includes('samSkyDomeFog(')).toBe(false);
  });

  it('density x ZoomLook fogDensityScale; mist top / density from the resolver; noise 40 m + 9 m at 0.5 (high)', () => {
    const { rig, frame } = setup('high', dawn());
    frame();
    const r = rig.resolved;
    const look = rig.look;
    const s = atmosphereSnapshot();
    expect(r.mistDensity).toBeGreaterThan(0);
    expect(s.mode).toBe(2);
    expect(s.density).toBeCloseTo(r.fogDensity * look.atmosphere.fogDensityScale, 12);
    expect(s.falloff).toBeCloseTo(r.fogHeightFalloff, 12);
    expect(s.baseHeight).toBeCloseTo(r.fogBaseHeight, 12);
    expect(s.maxOpacity).toBeCloseTo(r.fogMaxOpacity, 6);
    expect(s.mistTop).toBeCloseTo(r.fogBaseHeight + r.mistTopM, 6);
    expect(s.mistDensity).toBeCloseTo(r.mistDensity * look.atmosphere.fogDensityScale, 12);
    expect(s.mistNoiseAmplitude).toBe(MIST_NOISE.amplitude);
    expect(s.mistNoiseScalesM.map((v) => Math.round(v))).toEqual([40, 9]);
    expect(s.horizonValid).toBe(false); // no GPU readback in node
    expect(s.edge).not.toBeNull();
  });

  it('fog base and mist slab follow the ground under the focus (AD round 1: Rajapura sits above y = 0)', () => {
    const fake = fakeRenderContext('high');
    const scene = new THREE.Scene();
    const rig = new EnvironmentRig(fake.ctx, scene, { sceneSize: 1024 });
    rig.sky.bakeEnabled = false;
    rigs.push(rig);
    rig.setEnvironment(dawn());
    const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 6000);
    cam.position.set(0, 40, 5);
    cam.lookAt(0, 38, 0);
    const focus = new THREE.Vector3(0, 37, 0);
    rig.update(1 / 60, focus);
    fake.frame(scene, cam, 1 / 60);
    const r = rig.resolved;
    let s = atmosphereSnapshot();
    expect(s.baseHeight).toBeCloseTo(r.fogBaseHeight + 37, 9);
    expect(s.mistTop).toBeCloseTo(r.fogBaseHeight + 37 + r.mistTopM, 6);
    // The focus walks down a hill: the layer eases toward the new ground (no pumping), and arrives.
    focus.y = 17;
    rig.update(0.1, focus);
    fake.frame(scene, cam, 0.1);
    s = atmosphereSnapshot();
    expect(s.baseHeight - r.fogBaseHeight).toBeLessThan(37);
    expect(s.baseHeight - r.fogBaseHeight).toBeGreaterThan(30);
    for (let i = 0; i < 80; i++) {
      rig.update(0.25, focus);
      fake.frame(scene, cam, 0.25);
    }
    expect(atmosphereSnapshot().baseHeight - r.fogBaseHeight).toBeCloseTo(17, 1);
  });

  it('the hero band thickens the fog (x1.25) and the strategic band thins it (x0.35)', () => {
    const near = setup('ultra', dawn(), 4.5);
    near.frame();
    const dNear = atmosphereSnapshot().density;
    const rNear = near.rig.resolved.fogDensity;
    const far = setup('ultra', dawn(), 2600);
    far.frame();
    const dFar = atmosphereSnapshot().density;
    expect(dNear / rNear).toBeCloseTo(1.25, 1);
    expect(dFar / far.rig.resolved.fogDensity).toBeCloseTo(0.35, 1);
  });

  it('mist noise scrolls with the wind at 0.3x', () => {
    const e = { ...dawn(), weather: { ...dawn().weather, windSpeed: 4, windDirection: 0 } };
    const { frame } = setup('high', e);
    frame(0.2);
    const a = g(G.FOG_MIST).clone();
    frame(0.2);
    const b = g(G.FOG_MIST);
    const moved = Math.hypot(b.z - a.z, b.w - a.w);
    expect(moved).toBeCloseTo(4 * MIST_NOISE.windScroll * 0.2, 6);
  });

  it('tiers: low keeps FogExp2 x0.6 (mode 0), medium height fog (1), high / ultra + mist noise (2)', () => {
    expect((['low', 'medium', 'high', 'ultra'] as const).map((t) => fogModeFor(buildQualitySettings(t)))).toEqual([0, 1, 2, 2]);
    const { rig, frame, scene } = setup('low', dawn());
    frame();
    expect(scene.fog).toBe(rig.fog);
    expect(rig.fog.density).toBeCloseTo(rig.resolved.fogDensity * EXP2_DENSITY_SCALE * rig.look.atmosphere.fogDensityScale, 12);
    expect(atmosphereSnapshot().mode).toBe(0);
    expect(atmosphereSnapshot().mistNoiseAmplitude).toBe(0);
  });

  it('monsoon / winter fog overlays thicken the fog the rig writes', () => {
    const clear = setup('high', makeEnvironment(12.5, 'sharad', 'clear'));
    clear.frame();
    const dClear = atmosphereSnapshot().density;
    const fogEnv = makeEnvironment(8, 'shishira', 'clear');
    const fog = setup('high', { ...fogEnv, weather: makeWeather('fog', 'shishira', 0.4) });
    fog.frame();
    expect(atmosphereSnapshot().density).toBeGreaterThan(dClear * 10);
  });
});

describe('fog maths', () => {
  it('the analytic optical depth matches numeric integration, including steep downward rays', () => {
    const density = 0.0008;
    const b = 0.03;
    for (const [camY, dirY, dist] of [
      [2, 0, 3000],
      [2, 0.2, 2000],
      [300, -0.6, 900],
      [2600, -0.9, 3000],
    ] as const) {
      let num = 0;
      const n = 20000;
      for (let i = 0; i < n; i++) {
        const t = ((i + 0.5) / n) * dist;
        num += density * Math.exp(-b * (camY + dirY * t)) * (dist / n);
      }
      const an = fogOpticalDepth(density, b, 0, camY, dirY, dist);
      expect(Number.isFinite(an)).toBe(true);
      expect(Math.abs(an - num) / Math.max(num, 1e-12)).toBeLessThan(1e-3);
    }
  });

  it('the sky-dome fog is strongest at the horizon and clamped to 0.6', () => {
    const horizon = skyDomeFogAlpha(0.00018, 0.0025, 0, 2, 0.01);
    const zenith = skyDomeFogAlpha(0.00018, 0.0025, 0, 2, 1);
    expect(horizon).toBe(0.6);
    expect(zenith).toBeLessThan(0.1);
  });

  it('global chunks and injectHeightFog give custom shaders the shared uniform', () => {
    installShaderGlobals();
    expect(heightFogInstalled()).toBe(true);
    const hand = injectHeightFog({ uniforms: {} as Record<string, THREE.IUniform>, vertexShader: 'void main(){}', fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }' });
    expect(hand.uniforms.samG).toBeDefined();
    expect(hand.fragmentShader).toContain('samApplyFogWorld');
    const chunked = injectHeightFog({ uniforms: {} as Record<string, THREE.IUniform>, vertexShader: '#include <fog_vertex>', fragmentShader: '#include <fog_fragment>' });
    expect(chunked.fragmentShader).toBe('#include <fog_fragment>');
    expect(THREE.ShaderLib.standard.uniforms.samG).toBeDefined();
    expect(THREE.UniformsLib.fog).toHaveProperty('samG');
  });
});

/** Equirect test texture (rows bottom-up like EXRLoader): R / B follow the azimuth, G = 1. */
function equirect(width: number, height: number, half: boolean, rgb?: [number, number, number]): { data: Float32Array | Uint16Array; width: number; height: number } {
  const f = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const i = (y * width + x) * 4;
      f[i] = rgb ? rgb[0] : 1 + 0.5 * Math.cos(2 * Math.PI * u);
      f[i + 1] = rgb ? rgb[1] : 1;
      f[i + 2] = rgb ? rgb[2] : 1 + 0.5 * Math.sin(2 * Math.PI * u);
      f[i + 3] = 1;
    }
  if (!half) return { data: f, width, height };
  const h = new Uint16Array(f.length);
  for (let i = 0; i < f.length; i++) h[i] = THREE.DataUtils.toHalfFloat(f[i]!);
  return { data: h, width, height };
}

describe('baked skies keep the horizon ring (review: no map-edge seam once assets are attached)', () => {
  it('sampleEquirectHorizon reads the 8 ring azimuths in samHorizon order, with the dome yaw, float or half', () => {
    const spread = (1 + 2 * Math.cos((5 * Math.PI) / 180) + 2 * Math.cos((10 * Math.PI) / 180)) / 5;
    for (const half of [false, true]) {
      for (const yaw of [0, 0.7, -2.1]) {
        const t = equirect(256, 128, half);
        const out = new Float32Array(24);
        expect(sampleEquirectHorizon(t.data, t.width, t.height, half, yaw, out)).toBe(true);
        for (let k = 0; k < 8; k++) {
          const theta = (k / 8) * Math.PI * 2 - Math.PI - yaw;
          // u = theta / 2pi + 0.5  =>  cos(2 pi u) = -cos(theta), sin(2 pi u) = -sin(theta).
          expect(out[k * 3]!).toBeCloseTo(1 - 0.5 * spread * Math.cos(theta), 2);
          expect(out[k * 3 + 1]!).toBeCloseTo(1, 2);
          expect(out[k * 3 + 2]!).toBeCloseTo(1 - 0.5 * spread * Math.sin(theta), 2);
        }
      }
    }
    expect(sampleEquirectHorizon(new Float32Array(4), 0, 0, false, 0, new Float32Array(24))).toBe(false);
  });

  it('the rig feeds the baked sky ring (calibrated) to aerial perspective and the map-edge fade', async () => {
    const ring = async (rgb: [number, number, number]): Promise<THREE.Vector4> => {
      const t = equirect(128, 64, true, rgb);
      const tex = new THREE.DataTexture(t.data, t.width, t.height, THREE.RGBAFormat, THREE.HalfFloatType);
      const handle: SkyHdriHandle = { texture: tex, envMap: new THREE.Texture(), sun: { azimuthDeg: 170, elevationDeg: 62 }, entry: { id: 'sky_day', ambientIrradiance: 0.58 }, release: () => undefined };
      const fake = fakeRenderContext('high');
      const scene = new THREE.Scene();
      const rig = new EnvironmentRig(fake.ctx, scene, { sceneSize: 1024, bounds: { minX: -512, minZ: -512, maxX: 512, maxZ: 512 }, assets: { enabled: true, has: () => true, loadHdri: async () => handle } });
      rig.sky.bakeEnabled = false;
      rigs.push(rig);
      rig.setEnvironment(makeEnvironment(12.5, 'sharad', 'clear'));
      await Promise.resolve();
      await Promise.resolve();
      const cam = new THREE.PerspectiveCamera(42, 16 / 9, 0.5, 12000);
      cam.position.set(0, 600, 600);
      cam.lookAt(0, 0, 0);
      rig.update(1 / 60, new THREE.Vector3());
      fake.frame(scene, cam);
      expect(rig.sky.bakedActive).toBe(true);
      expect(rig.sky.bakedHorizonValid).toBe(true);
      const snap = atmosphereSnapshot();
      expect(snap.horizonValid).toBe(true);
      expect(snap.edge).not.toBeNull();
      return g(G.HORIZON_RING + 2).clone();
    };
    const warm = await ring([3, 1, 0.3]);
    const cool = await ring([0.3, 1, 3]);
    // The ring carries the baked sky's own colour (through the 0.6-clamped sky-dome fog).
    expect(warm.x).toBeGreaterThan(cool.x);
    expect(warm.z).toBeLessThan(cool.z);
  });
});
