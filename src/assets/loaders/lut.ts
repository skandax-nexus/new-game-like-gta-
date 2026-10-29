/**
 * 3D color LUTs (32^3 as a 1024 x 32 strip): decoding, a CPU reference sampler (tests) and the GLSL used by
 * grade passes. OWNER: Technical Artist G (TA-07). Format: docs/adr/0003-crowd-impostor-fx-assets.md.
 *
 *   const lut = await ctx.assets.loadLut('lut_golden');            // null when off / failed
 *   pass.uniforms.lut.value = lut.texture;                          // THREE.Data3DTexture, RGBA8, linear filter
 *   // fragment (display-referred, after tone mapping + grade):  color = mix(color, samrajyaLut(lut, color, 32.0), strength)
 *
 * Strip layout (three LUTImageLoader, no flip): blue slice b occupies x in [b * N, (b + 1) * N), red runs along
 * x inside the slice, green along y with green 0 on the TOP row. Lattice point (r, g, b) holds the graded
 * color of input (r, g, b) / (N - 1); sampling uses texel centers, so the identity strip reproduces every
 * 8-bit input within 1/255 (tests/assets/lut.test.ts).
 */
import * as THREE from 'three';
import type { LutAssetEntry } from '../types';

export interface LutHandle {
  readonly entry: LutAssetEntry;
  /** size^3 RGBA8 Data3DTexture (linear filtering, clamp). */
  readonly texture: THREE.Data3DTexture;
  readonly size: number;
  /** Suggested blend strength (ART_BIBLE §4.7). */
  readonly strength: number;
  release(): void;
}

/** Convert strip pixels (RGBA8, width = N * N, height = N, row 0 = top) to Data3DTexture order (r fastest, then g, then b). */
export function stripToVolume(pixels: ArrayLike<number>, size: number, channels = 4): Uint8Array {
  const n = size;
  const out = new Uint8Array(n * n * n * 4);
  const w = n * n;
  for (let b = 0; b < n; b++)
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++) {
        const src = (g * w + b * n + r) * channels;
        const dst = ((b * n + g) * n + r) * 4;
        out[dst] = pixels[src]!;
        out[dst + 1] = pixels[src + 1]!;
        out[dst + 2] = pixels[src + 2]!;
        out[dst + 3] = 255;
      }
  return out;
}

/** Identity lattice (exact): value at (r, g, b) = round(255 * i / (N - 1)). Strip order, RGBA8. */
export function identityStrip(size = 32): Uint8Array {
  const n = size;
  const w = n * n;
  const out = new Uint8Array(w * n * 4);
  for (let g = 0; g < n; g++)
    for (let b = 0; b < n; b++)
      for (let r = 0; r < n; r++) {
        const i = (g * w + b * n + r) * 4;
        out[i] = Math.round((255 * r) / (n - 1));
        out[i + 1] = Math.round((255 * g) / (n - 1));
        out[i + 2] = Math.round((255 * b) / (n - 1));
        out[i + 3] = 255;
      }
  return out;
}

export function createLutTexture(volume: Uint8Array, size: number): THREE.Data3DTexture {
  const t = new THREE.Data3DTexture(volume, size, size, size);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.wrapR = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

/**
 * CPU reference of the GPU lookup (trilinear between lattice points, input in [0, 1]) on a Data3DTexture-order
 * volume. Returns [0, 1] floats. Mirrors SAMRAJYA_LUT_GLSL.
 */
export function sampleLut(volume: ArrayLike<number>, size: number, r: number, g: number, b: number): [number, number, number] {
  const n = size;
  const fx = Math.min(Math.max(r, 0), 1) * (n - 1);
  const fy = Math.min(Math.max(g, 0), 1) * (n - 1);
  const fz = Math.min(Math.max(b, 0), 1) * (n - 1);
  const x0 = Math.min(Math.floor(fx), n - 2);
  const y0 = Math.min(Math.floor(fy), n - 2);
  const z0 = Math.min(Math.floor(fz), n - 2);
  const tx = fx - x0;
  const ty = fy - y0;
  const tz = fz - z0;
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const at = (x: number, y: number, z: number): number => volume[((z * n + y) * n + x) * 4 + c]! / 255;
    const c00 = at(x0, y0, z0) * (1 - tx) + at(x0 + 1, y0, z0) * tx;
    const c10 = at(x0, y0 + 1, z0) * (1 - tx) + at(x0 + 1, y0 + 1, z0) * tx;
    const c01 = at(x0, y0, z0 + 1) * (1 - tx) + at(x0 + 1, y0, z0 + 1) * tx;
    const c11 = at(x0, y0 + 1, z0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1, z0 + 1) * tx;
    out[c] = (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz;
  }
  return out;
}

/** GLSL: display-referred LUT lookup at texel centers (sampler3D, RGBA8 linear-filtered). */
export const SAMRAJYA_LUT_GLSL = /* glsl */ `
vec3 samrajyaLut( sampler3D lut, vec3 c, float size ) {
  vec3 uvw = clamp( c, 0.0, 1.0 ) * ( ( size - 1.0 ) / size ) + 0.5 / size;
  return texture( lut, uvw ).rgb;
}
`;

/**
 * Reference LUT grade pass (display space, after OutputPass + grade): `split` in [0, 1] shows the ungraded
 * image left of the split line (A/B lookdev); split <= 0 grades the whole frame. Insert it right after the
 * grade pass of the PostPipeline (GFX-01 owns the production LUT stage).
 */
export function createLutPassMaterial(texture: THREE.Data3DTexture, size: number, strength = 1, split = 0): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'SamrajyaLut',
    uniforms: {
      tDiffuse: { value: null },
      tLut: { value: texture },
      uSize: { value: size },
      uStrength: { value: strength },
      uSplit: { value: split },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }
    `,
    fragmentShader: /* glsl */ `
      precision highp sampler3D;
      uniform sampler2D tDiffuse;
      uniform sampler3D tLut;
      uniform float uSize;
      uniform float uStrength;
      uniform float uSplit;
      varying vec2 vUv;
      ${SAMRAJYA_LUT_GLSL}
      void main() {
        vec4 c = texture2D( tDiffuse, vUv );
        vec3 graded = mix( c.rgb, samrajyaLut( tLut, c.rgb, uSize ), uStrength );
        vec3 o = vUv.x >= uSplit ? graded : c.rgb;
        if ( uSplit > 0.0 && abs( vUv.x - uSplit ) < 0.0012 ) o = vec3( 0.95, 0.8, 0.4 );
        gl_FragColor = vec4( o, c.a );
      }
    `,
  });
}
