/**
 * Image-based-lighting calibration and light-scale helpers (ART_BIBLE §4.4, §4.1 notes). OWNER: Graphics
 * Developer - Lighting, Atmosphere & Post (GFX-01).
 *
 * Pure functions (no WebGL), shared by the sky system, the environment rig, the post pipeline and the unit tests
 * (tests/render/lighting/ibl.test.ts):
 * - `cubeHorizontalIrradiance`  horizontal irradiance of a cube map read back from the GPU (16-32 px faces), the
 *                               measurement the sky system does once per PMREM bake (`sourceIrradiance`);
 * - `equirectHorizontalIrradiance` the same integral for an equirect HDR (CPU checks of baked skies);
 * - `calibratedEnvironmentIntensity` scene.environmentIntensity = r.skyIrradiance / sourceIrradiance;
 * - `bloomThresholdLinear`      bloom thresholds are authored as EXPOSED luminance: linear = threshold / exposure;
 * - `pcfRadiusFromSoftness` / `pcssPenumbraUv` sun angular size -> shadow filter sizes.
 *
 * Irradiance is luminance-weighted (Rec.709) and cosine-weighted over the upper hemisphere: E = sum L cos(theta) dOmega.
 * A uniform sky of radiance L gives E = pi L.
 */
import { environmentIntensityFor, type ResolvedLighting } from '../style/lighting';

const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

/**
 * Direction (unnormalised, cube-face space as three.js CubeCamera renders it) of texel (u, v) in [-1, 1] on `face`
 * 0..5 (+X, -X, +Y, -Y, +Z, -Z), for pixel rows read back with readRenderTargetPixels (row 0 = first row read).
 * Same mapping as the Art Director's verified lookdev harness (docs/art/tools/lookdev/lookdev.ts).
 */
export function cubeFaceDirection(face: number, u: number, v: number, out: [number, number, number]): [number, number, number] {
  switch (face) {
    case 0:
      out[0] = 1;
      out[1] = -v;
      out[2] = -u;
      break;
    case 1:
      out[0] = -1;
      out[1] = -v;
      out[2] = u;
      break;
    case 2:
      out[0] = u;
      out[1] = 1;
      out[2] = v;
      break;
    case 3:
      out[0] = u;
      out[1] = -1;
      out[2] = -v;
      break;
    case 4:
      out[0] = u;
      out[1] = -v;
      out[2] = 1;
      break;
    default:
      out[0] = -u;
      out[1] = -v;
      out[2] = -1;
  }
  return out;
}

const tmpDir: [number, number, number] = [0, 0, 0];

/**
 * Horizontal (upward) irradiance of a cube map given as 6 RGBA float faces of `size` x `size` texels (row-major,
 * 4 floats per texel, as returned by renderer.readRenderTargetPixels per face). Only the upper hemisphere counts.
 */
export function cubeHorizontalIrradiance(faces: readonly ArrayLike<number>[], size: number): number {
  let e = 0;
  const texelArea = 4 / (size * size);
  for (let f = 0; f < 6; f++) {
    const buf = faces[f];
    if (!buf) continue;
    for (let y = 0; y < size; y++) {
      const v = -(((y + 0.5) / size) * 2 - 1);
      for (let x = 0; x < size; x++) {
        const u = ((x + 0.5) / size) * 2 - 1;
        const d = cubeFaceDirection(f, u, v, tmpDir);
        const len = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
        const cosUp = d[1] / len;
        if (cosUp <= 0) continue;
        const i = (y * size + x) * 4;
        const lum = LUMA_R * (buf[i] as number) + LUMA_G * (buf[i + 1] as number) + LUMA_B * (buf[i + 2] as number);
        // Solid angle of a cube texel: texelArea / len^3.
        e += lum * cosUp * (texelArea / (len * len * len));
      }
    }
  }
  return e;
}

/**
 * Sample a read-back cube (nearest texel) in a world direction. three.js renders cube faces mirrored in x
 * (left-handed cube convention), which `cubeFaceDirection` encodes; this inverts it. Writes linear RGB to `out`.
 */
export function sampleCubeFaces(faces: readonly ArrayLike<number>[], size: number, dx: number, dy: number, dz: number, out: [number, number, number]): [number, number, number] {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const az = Math.abs(dz);
  let face: number;
  let u: number;
  let v: number;
  if (ax >= ay && ax >= az) {
    face = dx > 0 ? 0 : 1;
    // face 0: dir = (1, -v, -u) => u = -dz/ax, v = -dy/ax ; face 1: dir = (-1, -v, u) => u = dz/ax, v = -dy/ax
    u = dx > 0 ? -dz / ax : dz / ax;
    v = -dy / ax;
  } else if (ay >= az) {
    face = dy > 0 ? 2 : 3;
    // face 2: (u, 1, v) ; face 3: (u, -1, -v)
    u = dx / ay;
    v = dy > 0 ? dz / ay : -dz / ay;
  } else {
    face = dz > 0 ? 4 : 5;
    // face 4: (u, -v, 1) ; face 5: (-u, -v, -1)
    u = dz > 0 ? dx / az : -dx / az;
    v = -dy / az;
  }
  const x = Math.min(size - 1, Math.max(0, Math.floor(((u + 1) / 2) * size)));
  const y = Math.min(size - 1, Math.max(0, Math.floor(((1 - v) / 2) * size)));
  const buf = faces[face];
  const i = (y * size + x) * 4;
  out[0] = buf ? (buf[i] as number) : 0;
  out[1] = buf ? (buf[i + 1] as number) : 0;
  out[2] = buf ? (buf[i + 2] as number) : 0;
  return out;
}

/**
 * Horizontal irradiance of an equirectangular map, `channels` floats per texel. Matches the bake's
 * `ambientIrradiance` definition. `rowOrder` 'bottom-up' (default) is three.js texture data as EXRLoader returns it
 * (row 0 = nadir, v = 0); 'top-down' is image order (row 0 = zenith, numpy / tools/blender/lib/sky.py).
 */
export function equirectHorizontalIrradiance(data: ArrayLike<number>, width: number, height: number, channels = 4, rowOrder: 'bottom-up' | 'top-down' = 'bottom-up'): number {
  let e = 0;
  const dLon = (2 * Math.PI) / width;
  const dLat = Math.PI / height;
  for (let y = 0; y < height; y++) {
    const t = (y + 0.5) / height;
    const lat = (rowOrder === 'top-down' ? 0.5 - t : t - 0.5) * Math.PI;
    if (lat <= 0) continue;
    const w = Math.cos(lat) * Math.sin(lat) * dLon * dLat;
    let row = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      row += LUMA_R * (data[i] as number) + LUMA_G * (data[i + 1] as number) + LUMA_B * (data[i + 2] as number);
    }
    e += row * w;
  }
  return e;
}

/** scene.environmentIntensity (and backgroundIntensity) for an IBL source of the given horizontal irradiance. */
export function calibratedEnvironmentIntensity(r: ResolvedLighting, sourceIrradiance: number): number {
  return environmentIntensityFor(r, sourceIrradiance);
}

/** Bloom threshold in scene-linear units (what the bloom prefilter compares against) from the exposed authoring value. */
export function bloomThresholdLinear(r: Pick<ResolvedLighting, 'bloomThreshold' | 'exposure'>): number {
  return r.bloomThreshold / Math.max(1e-3, r.exposure);
}

const DEG = Math.PI / 180;

/**
 * PCF kernel radius (shadow-map texels, three.js `shadow.radius`) for a sun of angular radius `softnessDeg`, used
 * on tiers without a blocker search (medium). `typicalBlockerM` is the occluder-to-receiver distance the kernel is
 * sized for (default 6 m: a wall, a tree, a soldier's shadow at mid range). Clamped to [1, 6] texels.
 */
export function pcfRadiusFromSoftness(softnessDeg: number, texelWorldM: number, typicalBlockerM = 6): number {
  const penumbra = Math.tan(Math.max(0, softnessDeg) * DEG) * typicalBlockerM;
  const texels = penumbra / Math.max(1e-4, texelWorldM);
  return Math.min(6, Math.max(1, texels));
}

/**
 * PCSS penumbra radius in shadow-map UV for a receiver `blockerDistM` metres behind its occluder (along the light)
 * under a sun of angular radius `softnessDeg`, in a cascade whose ortho frustum is `frustumWidthM` wide.
 * (Directional light: penumbra width = 2 d tan(theta), radius = d tan(theta).)
 */
export function pcssPenumbraUv(softnessDeg: number, blockerDistM: number, frustumWidthM: number): number {
  return (Math.max(0, blockerDistM) * Math.tan(Math.max(0, softnessDeg) * DEG)) / Math.max(1e-3, frustumWidthM);
}

/** Linear luminance of an RGB triple (Rec.709). */
export function luminance3(r: number, g: number, b: number): number {
  return LUMA_R * r + LUMA_G * g + LUMA_B * b;
}
