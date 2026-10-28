/**
 * Procedural textures generated at runtime (no asset files). OWNER: Lead Graphics Engineer.
 * Baseline by the CTO: tileable value-noise detail + normal maps.
 */
import * as THREE from 'three';
import { hash2 } from '../../core/math';

/** Tileable fBm value noise in [0,1], `size` x `size`, period = size. */
export function tileableNoise(size: number, seed: number, octaves = 5, baseCells = 8): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let norm = 0;
  let cells = baseCells;
  for (let o = 0; o < octaves; o++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells;
        const fy = (y / size) * cells;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        const tx = fx - ix;
        const ty = fy - iy;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const h = (a: number, b: number): number => hash2(((a % cells) + cells) % cells, ((b % cells) + cells) % cells, seed + o * 131);
        const v = (h(ix, iy) * (1 - sx) + h(ix + 1, iy) * sx) * (1 - sy) + (h(ix, iy + 1) * (1 - sx) + h(ix + 1, iy + 1) * sx) * sy;
        out[y * size + x] += v * amp;
      }
    }
    norm += amp;
    amp *= 0.5;
    cells *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

/** Grayscale detail texture (linear data, R channel) for albedo modulation. */
export function createDetailTexture(size = 256, seed = 7): THREE.DataTexture {
  const n = tileableNoise(size, seed, 6, 6);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = Math.round(Math.min(1, Math.max(0, (n[i] as number) * 1.25 - 0.12)) * 255);
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Tangent-space normal map from tileable noise (strength = bump height). */
export function createNoiseNormalMap(size = 256, seed = 11, strength = 2.5, baseCells = 8): THREE.DataTexture {
  const h = tileableNoise(size, seed, 5, baseCells);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)] as number;
      const r = h[y * size + ((x + 1) % size)] as number;
      const d = h[((y - 1 + size) % size) * size + x] as number;
      const u = h[((y + 1) % size) * size + x] as number;
      let nx = (l - r) * strength;
      let ny = (d - u) * strength;
      let nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * size + x) * 4;
      data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
