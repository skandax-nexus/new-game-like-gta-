/**
 * GFX-01 IBL calibration (ART_BIBLE §4.4). OWNER: Graphics Developer - Lighting, Atmosphere & Post (GFX-01).
 *
 * - environmentIntensity for the baked sky_day (manifest source 0.58) under the noon preset lands the irradiance the
 *   shader sees (EXR data x environmentIntensity) on the 0.75 target within 2 %;
 * - every baked WP7 sky decodes (three's EXRLoader, as the AssetManager loads it) to its manifest ambientIrradiance;
 * - the PMREM sky shader has no sun-disc term (the visible dome draws the sun separately);
 * - cube readback integration (the runtime measurement) and its sampling inverse;
 * - bloom threshold mapping and the PCF / PCSS radius helpers.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as THREE from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { ASSET_MANIFEST } from '../../../src/assets/manifest';
import { LIGHTING_PRESETS, presetToResolved, resolveLighting } from '../../../src/render/style/lighting';
import {
  bloomThresholdLinear,
  calibratedEnvironmentIntensity,
  cubeFaceDirection,
  cubeHorizontalIrradiance,
  equirectHorizontalIrradiance,
  pcfRadiusFromSoftness,
  pcssPenumbraUv,
  sampleCubeFaces,
} from '../../../src/render/lighting/ibl';
import { AFTERGLOW, AFTERGLOW_DEG, afterglowStrength, buildSkyShader, NIGHT_SKY, preethamFor } from '../../../src/render/environment/sky';

interface ExrData {
  data: Float32Array;
  width: number;
  height: number;
}

function loadExr(url: string): ExrData {
  const buf = fs.readFileSync(`public/assets/${url}`);
  const loader = new EXRLoader();
  loader.setDataType(THREE.FloatType);
  return loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)) as unknown as ExrData;
}

function hdriEntry(id: string): { ambientIrradiance: number; files: Record<string, { url: string }> } {
  const e = (ASSET_MANIFEST.assets as unknown as Record<string, { kind: string; ambientIrradiance?: number; files?: Record<string, { url: string }> }>)[id];
  if (!e || e.kind !== 'hdri' || e.ambientIrradiance === undefined || !e.files) throw new Error(`${id} is not a published hdri`);
  return { ambientIrradiance: e.ambientIrradiance, files: e.files };
}

describe('IBL calibration (ART_BIBLE §4.4)', () => {
  it('sky_day (source ~0.58) under the noon preset reaches the 0.75 sky-irradiance target within 2 %', () => {
    const noon = presetToResolved(LIGHTING_PRESETS.noon);
    const day = hdriEntry('sky_day');
    expect(day.ambientIrradiance).toBeCloseTo(0.58, 1);
    const k = calibratedEnvironmentIntensity(noon, day.ambientIrradiance);
    // What the GPU integrates: the decoded map (three's EXRLoader, as AssetManager.loadHdri loads it) x intensity.
    const exr = loadExr(day.files.mobile!.url);
    const seen = equirectHorizontalIrradiance(exr.data, exr.width, exr.height) * k;
    expect(Math.abs(seen - 0.75) / 0.75).toBeLessThan(0.02);
    // Same through the resolver at a clear noon (sun 62 deg).
    const r = resolveLighting({ sunElevationDeg: 62, hour: 12.5, season: 'sharad', weather: { kind: 'clear', cloudCover: 0.1, rain: 0 } });
    expect(Math.abs(calibratedEnvironmentIntensity(r, day.ambientIrradiance) * day.ambientIrradiance - r.skyIrradiance)).toBeLessThan(1e-9);
  });

  it('every baked WP7 sky decodes to its manifest ambientIrradiance (rows bottom-up, as three uploads them)', () => {
    for (const id of ['sky_day', 'sky_noon', 'sky_golden', 'sky_dawn', 'sky_dusk', 'sky_night', 'sky_overcast', 'sky_haze']) {
      const e = hdriEntry(id);
      const exr = loadExr(e.files.mobile!.url);
      const measured = equirectHorizontalIrradiance(exr.data, exr.width, exr.height);
      expect(Math.abs(measured - e.ambientIrradiance) / e.ambientIrradiance, id).toBeLessThan(0.02);
    }
  });

  it('the PMREM sky shader contains no sun-disc term; the visible dome draws the sun separately', () => {
    const env = buildSkyShader({ envBake: true });
    for (const term of ['19000', 'sundisk', 'sunAngularDiameterCos', 'samSunDisc', 'uSunTex', 'samMoonDisc', 'samStars']) {
      expect(env.fragmentShader.includes(term), term).toBe(false);
    }
    expect(env.defines.SAM_ENV_BAKE).toBe('');
    const vis = buildSkyShader({ envBake: false });
    expect(vis.fragmentShader).toContain('samSunDisc');
    expect(vis.fragmentShader).toContain('samSkyDomeFog');
    expect(vis.fragmentShader.includes('19000')).toBe(false);
  });

  it('night fallback constants follow ART_BIBLE §4.4 rule 3', () => {
    expect(NIGHT_SKY).toMatchObject({ zenith: '#0f1326', horizon: '#1b2236', irradiance: 0.08, belowDeg: -4 });
    expect(LIGHTING_PRESETS.night.sky.irradiance).toBe(NIGHT_SKY.irradiance);
  });

  it('blends the Preetham parameters like the resolver (pure preset -> its own parameters)', () => {
    const v = new THREE.Vector4();
    for (const id of ['dawn', 'noon', 'golden', 'dusk', 'night'] as const) {
      preethamFor(presetToResolved(LIGHTING_PRESETS[id]), v);
      const p = LIGHTING_PRESETS[id].sky.preetham;
      expect([v.x, v.y, v.z, v.w]).toEqual([p.turbidity, p.rayleigh, p.mieCoefficient, p.mieDirectionalG].map((x) => expect.closeTo(x, 9)));
    }
  });
});

describe('cube readback integration (runtime sourceIrradiance)', () => {
  const N = 32;
  function uniformCube(upper: number, lower: number): Float32Array[] {
    const faces: Float32Array[] = [];
    const d: [number, number, number] = [0, 0, 0];
    for (let f = 0; f < 6; f++) {
      const buf = new Float32Array(N * N * 4);
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          cubeFaceDirection(f, ((x + 0.5) / N) * 2 - 1, -(((y + 0.5) / N) * 2 - 1), d);
          const L = d[1] > 0 ? upper : lower;
          buf.set([L, L, L, 1], (y * N + x) * 4);
        }
      faces.push(buf);
    }
    return faces;
  }

  it('a uniform sky of radiance L integrates to pi L (sun-free, ground ignored)', () => {
    const e = cubeHorizontalIrradiance(uniformCube(0.25, 7), N);
    expect(e).toBeCloseTo(Math.PI * 0.25, 2);
    expect(cubeHorizontalIrradiance(uniformCube(0, 3), N)).toBe(0);
  });

  it('sampleCubeFaces inverts cubeFaceDirection on every face', () => {
    const faces: Float32Array[] = [];
    for (let f = 0; f < 6; f++) {
      const buf = new Float32Array(N * N * 4);
      for (let i = 0; i < N * N; i++) buf.set([f, i % N, Math.floor(i / N), 1], i * 4);
      faces.push(buf);
    }
    const d: [number, number, number] = [0, 0, 0];
    const out: [number, number, number] = [0, 0, 0];
    for (let f = 0; f < 6; f++)
      for (const [x, y] of [
        [3, 5],
        [16, 16],
        [30, 1],
      ] as const) {
        cubeFaceDirection(f, ((x + 0.5) / N) * 2 - 1, -(((y + 0.5) / N) * 2 - 1), d);
        sampleCubeFaces(faces, N, d[0], d[1], d[2], out);
        expect(out).toEqual([f, x, y]);
      }
  });
});

describe('light-scale helpers', () => {
  it('maps the exposed bloom threshold to scene-linear (threshold / exposure)', () => {
    expect(bloomThresholdLinear(presetToResolved(LIGHTING_PRESETS.noon))).toBeCloseTo(4.5 / 0.8, 9);
    expect(bloomThresholdLinear(presetToResolved(LIGHTING_PRESETS.night))).toBeCloseTo(1.4 / 2.5, 9);
    expect(bloomThresholdLinear({ bloomThreshold: 3, exposure: 0 })).toBeCloseTo(3000, 6);
  });

  it('sizes PCSS penumbras from the sun angular radius (d tan theta / frustum width)', () => {
    expect(pcssPenumbraUv(0.35, 10, 100)).toBeCloseTo((10 * Math.tan((0.35 * Math.PI) / 180)) / 100, 12);
    expect(pcssPenumbraUv(8, 10, 100)).toBeGreaterThan(pcssPenumbraUv(0.35, 10, 100) * 20);
    expect(pcssPenumbraUv(1, 0, 100)).toBe(0);
    // Wider cascades -> smaller UV penumbra for the same world penumbra.
    expect(pcssPenumbraUv(1, 10, 400)).toBeCloseTo(pcssPenumbraUv(1, 10, 100) / 4, 12);
  });

  it('PCF radius grows with softness and is clamped to 1..6 texels', () => {
    const texel = 0.1;
    expect(pcfRadiusFromSoftness(0.35, texel)).toBe(1);
    const monsoon = pcfRadiusFromSoftness(8, texel);
    expect(monsoon).toBe(6);
    const mid = pcfRadiusFromSoftness(1.5, texel);
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(6);
    expect(pcfRadiusFromSoftness(1.5, texel * 2)).toBeLessThan(mid);
  });
});

describe('twilight afterglow (AD round 1: dusk never appeared)', () => {
  it('full above -4 deg, gone below -10 deg, monotonic; warm band low toward the sun, plum above', () => {
    expect(afterglowStrength(-2)).toBe(1);
    expect(afterglowStrength(-4)).toBe(1);
    expect(afterglowStrength(-10)).toBe(0);
    expect(afterglowStrength(-12)).toBe(0);
    let prev = 0;
    for (let e = -12; e <= 0; e += 0.5) {
      const v = afterglowStrength(e);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(AFTERGLOW_DEG).toEqual([-4, -10]);
    // Warm: R > G > B; plum: R and B above G.
    expect(AFTERGLOW.warm[0]).toBeGreaterThan(AFTERGLOW.warm[1]);
    expect(AFTERGLOW.warm[1]).toBeGreaterThan(AFTERGLOW.warm[2]);
    expect(AFTERGLOW.plum[2]).toBeGreaterThan(AFTERGLOW.plum[1]);
    // In both the visible dome and the IBL source (it is part of the sky radiance, never of the sun disc).
    for (const envBake of [false, true]) expect(buildSkyShader({ envBake }).fragmentShader).toContain('night += glow * ( lobe * uNight.z );');
  });
});
