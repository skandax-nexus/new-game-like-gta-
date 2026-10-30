/**
 * HDR bloom (medium+; ART_BIBLE §4.7 / §13): soft-knee threshold in scene-linear units (ResolvedLighting
 * bloomThreshold / exposure, so the authored threshold is an *exposed* luminance), Karis-weighted prefilter,
 * 13-tap downsample chain from half resolution and a 3x3 tent upsample chain whose spread follows bloomRadius.
 * Ultra adds lens dirt (WP7 `lens_dirt` image when assets are on, a procedural smudge texture otherwise), applied
 * in the final pass. OWNER: Graphics Developer - Lighting, Atmosphere & Post (GFX-01).
 */
import * as THREE from 'three';
import { colorTarget, postMaterial, QuadPass, type PostFrame } from './shared';

const PREFILTER_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
uniform float uClamp;
varying vec2 vUv;
float lumaW( vec3 c ) { return 1.0 / ( 1.0 + dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ) ); }
void main() {
  vec3 a = min( texture2D( tColor, vUv + uTexel * vec2( -1.0, -1.0 ) ).rgb, vec3( uClamp ) );
  vec3 b = min( texture2D( tColor, vUv + uTexel * vec2( 1.0, -1.0 ) ).rgb, vec3( uClamp ) );
  vec3 c = min( texture2D( tColor, vUv + uTexel * vec2( -1.0, 1.0 ) ).rgb, vec3( uClamp ) );
  vec3 d = min( texture2D( tColor, vUv + uTexel * vec2( 1.0, 1.0 ) ).rgb, vec3( uClamp ) );
  float wa = lumaW( a ), wb = lumaW( b ), wc = lumaW( c ), wd = lumaW( d );
  vec3 col = ( a * wa + b * wb + c * wc + d * wd ) / max( wa + wb + wc + wd, 1e-4 );
  float br = max( col.r, max( col.g, col.b ) );
  float soft = clamp( br - uThreshold + uKnee, 0.0, 2.0 * uKnee );
  soft = soft * soft / ( 4.0 * uKnee + 1e-5 );
  float contrib = max( soft, br - uThreshold ) / max( br, 1e-5 );
  gl_FragColor = vec4( col * max( contrib, 0.0 ), 1.0 );
}
`;

const DOWN_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
vec3 s( vec2 o ) { return texture2D( tSrc, vUv + uTexel * o ).rgb; }
void main() {
  vec3 col = s( vec2( 0.0 ) ) * 0.125;
  col += ( s( vec2( -2.0, 2.0 ) ) + s( vec2( 2.0, 2.0 ) ) + s( vec2( -2.0, -2.0 ) ) + s( vec2( 2.0, -2.0 ) ) ) * 0.03125;
  col += ( s( vec2( 0.0, 2.0 ) ) + s( vec2( -2.0, 0.0 ) ) + s( vec2( 2.0, 0.0 ) ) + s( vec2( 0.0, -2.0 ) ) ) * 0.0625;
  col += ( s( vec2( -1.0, 1.0 ) ) + s( vec2( 1.0, 1.0 ) ) + s( vec2( -1.0, -1.0 ) ) + s( vec2( 1.0, -1.0 ) ) ) * 0.125;
  gl_FragColor = vec4( col, 1.0 );
}
`;

const UP_FRAG = /* glsl */ `
uniform sampler2D tLow;
uniform sampler2D tCurrent;
uniform vec2 uTexelLow;
uniform float uSpread;
varying vec2 vUv;
vec3 s( vec2 o ) { return texture2D( tLow, vUv + uTexelLow * o ).rgb; }
void main() {
  vec3 t = s( vec2( 0.0 ) ) * 4.0;
  t += ( s( vec2( -1.0, 0.0 ) ) + s( vec2( 1.0, 0.0 ) ) + s( vec2( 0.0, -1.0 ) ) + s( vec2( 0.0, 1.0 ) ) ) * 2.0;
  t += s( vec2( -1.0, -1.0 ) ) + s( vec2( 1.0, -1.0 ) ) + s( vec2( -1.0, 1.0 ) ) + s( vec2( 1.0, 1.0 ) );
  gl_FragColor = vec4( texture2D( tCurrent, vUv ).rgb + t * ( uSpread / 16.0 ), 1.0 );
}
`;

export class BloomPass extends QuadPass {
  readonly name = 'bloom';
  private readonly down: THREE.WebGLRenderTarget[] = [];
  private readonly up: THREE.WebGLRenderTarget[] = [];
  private readonly prefilter: THREE.ShaderMaterial;
  private readonly downMat: THREE.ShaderMaterial;
  private readonly upMat: THREE.ShaderMaterial;
  /** Scene-linear threshold, radius 0..1 (upsample spread). */
  threshold = 5;
  radius = 0.5;
  /** Normalisation of the summed levels (read by the final pass). */
  normalisation = 1;
  private levels = 0;

  constructor(
    private readonly frame: PostFrame,
    private readonly maxLevels = 6,
  ) {
    super();
    this.needsSwap = false;
    this.prefilter = postMaterial('SamrajyaBloomPrefilter', PREFILTER_FRAG, {
      tColor: { value: null },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uThreshold: { value: 5 },
      uKnee: { value: 2.5 },
      uClamp: { value: 256 },
    });
    this.downMat = postMaterial('SamrajyaBloomDown', DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2(1, 1) } });
    this.upMat = postMaterial('SamrajyaBloomUp', UP_FRAG, {
      tLow: { value: null },
      tCurrent: { value: null },
      uTexelLow: { value: new THREE.Vector2(1, 1) },
      uSpread: { value: 0.8 },
    });
  }

  override setSize(width: number, height: number): void {
    let w = Math.max(1, Math.round(width / 2));
    let h = Math.max(1, Math.round(height / 2));
    const levels = Math.max(2, Math.min(this.maxLevels, Math.floor(Math.log2(Math.max(2, Math.min(w, h)))) - 2));
    if (levels !== this.levels) {
      for (const rt of this.down) rt.dispose();
      for (const rt of this.up) rt.dispose();
      this.down.length = 0;
      this.up.length = 0;
      for (let i = 0; i < levels; i++) this.down.push(colorTarget(1, 1, { name: `post.bloom.down${i}` }));
      for (let i = 0; i < levels - 1; i++) this.up.push(colorTarget(1, 1, { name: `post.bloom.up${i}` }));
      this.levels = levels;
    }
    for (let i = 0; i < levels; i++) {
      this.down[i]!.setSize(w, h);
      if (i < levels - 1) this.up[i]!.setSize(w, h);
      w = Math.max(1, Math.round(w / 2));
      h = Math.max(1, Math.round(h / 2));
    }
    const src = this.frame;
    (this.prefilter.uniforms.uTexel!.value as THREE.Vector2).set(0.5 / Math.max(1, src.width), 0.5 / Math.max(1, src.height));
  }

  override render(renderer: THREE.WebGLRenderer): void {
    const f = this.frame;
    if (!f.hdr || this.levels === 0) {
      f.bloom = null;
      return;
    }
    const p = this.prefilter.uniforms;
    p.tColor!.value = f.hdr;
    (p.uTexel!.value as THREE.Vector2).set(0.5 / Math.max(1, f.width), 0.5 / Math.max(1, f.height));
    p.uThreshold!.value = this.threshold;
    p.uKnee!.value = Math.max(1e-3, this.threshold * 0.5);
    p.uClamp!.value = this.threshold * 48;
    this.draw(renderer, this.prefilter, this.down[0]!);
    const d = this.downMat.uniforms;
    for (let i = 1; i < this.levels; i++) {
      const src = this.down[i - 1]!;
      d.tSrc!.value = src.texture;
      (d.uTexel!.value as THREE.Vector2).set(1 / src.width, 1 / src.height);
      this.draw(renderer, this.downMat, this.down[i]!);
    }
    const spread = 0.55 + 0.45 * Math.min(1, Math.max(0, this.radius));
    const u = this.upMat.uniforms;
    u.uSpread!.value = spread;
    for (let i = this.levels - 2; i >= 0; i--) {
      const low = i === this.levels - 2 ? this.down[i + 1]! : this.up[i + 1]!;
      u.tLow!.value = low.texture;
      u.tCurrent!.value = this.down[i]!.texture;
      (u.uTexelLow!.value as THREE.Vector2).set(1 / low.width, 1 / low.height);
      this.draw(renderer, this.upMat, this.up[i]!);
    }
    let norm = 0;
    let k = 1;
    for (let i = 0; i < this.levels; i++) {
      norm += k;
      k *= spread;
    }
    this.normalisation = 1 / norm;
    f.bloom = this.up[0]!.texture;
  }

  override dispose(): void {
    super.dispose();
    for (const rt of this.down) rt.dispose();
    for (const rt of this.up) rt.dispose();
    this.prefilter.dispose();
    this.downMat.dispose();
    this.upMat.dispose();
  }
}

let dirtPixels: Uint8Array | null = null;
export const LENS_DIRT_SIZE = { width: 384, height: 216 } as const;

/** Procedural lens dirt (deterministic): soft smudges, a few bokeh rings and fine dust on black. RGBA8. */
export function lensDirtPixels(): Uint8Array {
  if (dirtPixels) return dirtPixels;
  const { width: w, height: h } = LENS_DIRT_SIZE;
  const acc = new Float32Array(w * h);
  let seed = 0x5a3c91;
  const rnd = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const splat = (cx: number, cy: number, r: number, amp: number, ring: boolean): void => {
    const x0 = Math.max(0, Math.floor(cx - r - 1));
    const x1 = Math.min(w - 1, Math.ceil(cx + r + 1));
    const y0 = Math.max(0, Math.floor(cy - r - 1));
    const y1 = Math.min(h - 1, Math.ceil(cy + r + 1));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / r;
        if (d >= 1) continue;
        const v = ring ? 0.35 + 0.65 * Math.max(0, (d - 0.75) / 0.25) * (1 - Math.max(0, (d - 0.92) / 0.08)) : (1 - d * d) * (1 - d * d);
        acc[y * w + x] = acc[y * w + x]! + v * amp;
      }
  };
  for (let i = 0; i < 36; i++) splat(rnd() * w, rnd() * h, 10 + rnd() * 34, 0.12 + rnd() * 0.25, false);
  for (let i = 0; i < 14; i++) splat(rnd() * w, rnd() * h, 5 + rnd() * 9, 0.25 + rnd() * 0.3, true);
  for (let i = 0; i < 260; i++) splat(rnd() * w, rnd() * h, 0.8 + rnd() * 1.8, 0.3 + rnd() * 0.5, false);
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    // Stronger toward the frame edge (where real lens dirt catches the light).
    const x = (i % w) / w - 0.5;
    const y = Math.floor(i / w) / h - 0.5;
    const edge = 0.45 + 0.55 * Math.min(1, Math.sqrt(x * x + y * y) * 1.6);
    const v = Math.min(1, acc[i]! * edge);
    out[i * 4] = Math.round(v * 255);
    out[i * 4 + 1] = Math.round(v * 240);
    out[i * 4 + 2] = Math.round(v * 220);
    out[i * 4 + 3] = 255;
  }
  dirtPixels = out;
  return out;
}

/** A GPU texture of the procedural lens dirt (caller disposes). */
export function createLensDirtTexture(): THREE.DataTexture {
  const { width, height } = LENS_DIRT_SIZE;
  const t = new THREE.DataTexture(lensDirtPixels(), width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.name = 'post.lensDirt';
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
