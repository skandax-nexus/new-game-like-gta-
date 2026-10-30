/**
 * Practical lights (ART_BIBLE §4.6): oil lamps, torches, braziers and burning buildings. OWNER: Graphics Developer -
 * Lighting, Atmosphere & Post (GFX-01). Used through EnvironmentRig.addPractical(kind, position).
 *
 * - Every practical is drawn as an emissive flame sprite (one InstancedMesh, additive, camera-facing): flame
 *   luminance 8-12 so it blooms; x QualitySettings.emissiveBoost on tiers without bloom (low 1.3).
 * - Only the nearest N to the camera (N = QualitySettings.practicalLights: 1 / 4 / 8 / 16) are real PointLights. The
 *   pool size is fixed per tier (constant light count = no shader recompiles); unused pool lights sit at intensity 0.
 *   The pool is created lazily on the first addPractical(), so scenes without practicals pay nothing.
 * - Flicker: 12-35 % (PRACTICAL_LIGHTS[kind].flicker) at 6-12 Hz from two summed sines with per-light phases.
 * - Weighted by ResolvedLighting.practicals (0 by day -> 1 at night: lamps are lit from dusk). Burning buildings
 *   ignore the weight (a fire is a fire at noon).
 * Allocation-free per frame (typed arrays, fixed index lists).
 */
import * as THREE from 'three';
import { PRACTICAL_LIGHTS } from '../style/lighting';

export type PracticalKind = 'oilLamp' | 'torch' | 'brazier' | 'burningBuilding';
export const PRACTICAL_KINDS: readonly PracticalKind[] = ['oilLamp', 'torch', 'brazier', 'burningBuilding'];

/** Handle returned by addPractical(): move it, scale it (0 = out), or remove it. */
export interface PracticalHandle {
  readonly id: number;
  readonly kind: PracticalKind;
  setPosition(x: number, y: number, z: number): void;
  /** Extra multiplier (e.g. a building fire growing / dying), default 1. */
  setScale(scale: number): void;
  remove(): void;
}

/** Visible flame size (m, sprite height) per kind. */
const FLAME_SIZE: Record<PracticalKind, number> = { oilLamp: 0.12, torch: 0.42, brazier: 0.75, burningBuilding: 5.5 };
/** Flame sprite luminance (scene-linear, ART_BIBLE §4.6: 8-12 so it blooms). */
const FLAME_LUMINANCE: Record<PracticalKind, number> = { oilLamp: 8, torch: 10, brazier: 11, burningBuilding: 12 };
const KIND_INDEX: Record<PracticalKind, number> = { oilLamp: 0, torch: 1, brazier: 2, burningBuilding: 3 };

const SPRITE_VERTEX = /* glsl */ `
attribute vec4 aFlame;   // x = luminance x scale, y = flicker phase, z = kind, w = size (m)
varying vec2 vUv;
varying float vLum;
varying float vKind;
uniform float uTime;
void main() {
  vUv = uv;
  vKind = aFlame.z;
  vec4 c = modelViewMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
  float flick = 0.86 + 0.08 * sin( uTime * 41.0 + aFlame.y * 6.28 ) + 0.06 * sin( uTime * 67.0 + aFlame.y * 11.0 );
  float h = aFlame.w * ( 0.92 + 0.08 * flick );
  // Camera-facing quad, a flame is taller than wide; base at the light position.
  c.xy += vec2( position.x * h * 0.55, ( position.y + 0.42 ) * h );
  vLum = aFlame.x * flick;
  gl_Position = projectionMatrix * c;
}
`;

const SPRITE_FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying float vLum;
varying float vKind;
uniform vec3 uColors[ 4 ];
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  // Teardrop: narrow tip, round base, hot white core.
  float w = mix( 1.0, 0.25, smoothstep( -0.6, 1.0, p.y ) );
  float d = length( vec2( p.x / max( w, 1e-3 ), ( p.y + 0.15 ) * 0.9 ) );
  float body = smoothstep( 1.0, 0.25, d );
  float core = smoothstep( 0.55, 0.0, d );
  vec3 col = uColors[ int( vKind + 0.5 ) ];
  vec3 c = mix( col, vec3( 1.0, 0.92, 0.75 ), core * 0.7 ) * ( body + core );
  float a = body;
  if ( a <= 0.003 ) discard;
  gl_FragColor = vec4( c * vLum * a, 1.0 );
}
`;

export class PracticalLights {
  /** Sprites + pooled point lights; add once to the scene. */
  readonly object = new THREE.Group();
  private capacity = 0;
  private count = 0;
  private kinds = new Uint8Array(0);
  private pos = new Float32Array(0);
  private scale = new Float32Array(0);
  private phase = new Float32Array(0);
  private freq = new Float32Array(0);
  private alive = new Uint8Array(0);
  private ids = new Int32Array(0);
  private nextId = 1;
  private sprites: THREE.InstancedMesh | null = null;
  private spriteAttr: THREE.InstancedBufferAttribute | null = null;
  private spriteMaterial: THREE.ShaderMaterial | null = null;
  private spriteGeometry: THREE.PlaneGeometry | null = null;
  private pool: THREE.PointLight[] = [];
  private poolSize: number;
  private emissiveBoost: number;
  private time = 0;
  /** ResolvedLighting.practicals (0..1). */
  weight = 0;
  private readonly nearest = new Int32Array(64);
  private readonly nearestD = new Float32Array(64);
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpC = new THREE.Color();

  constructor(poolSize: number, emissiveBoost = 1) {
    this.object.name = 'practicals';
    this.poolSize = Math.max(0, Math.min(64, poolSize));
    this.emissiveBoost = emissiveBoost;
  }

  /** Real-light pool size (QualitySettings.practicalLights) and emissive boost; rebuilds the pool if it changed. */
  setQuality(poolSize: number, emissiveBoost: number): void {
    this.emissiveBoost = emissiveBoost;
    const n = Math.max(0, Math.min(64, poolSize));
    if (n === this.poolSize) return;
    this.poolSize = n;
    if (this.pool.length) this.buildPool();
  }

  get size(): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.alive[i]) n++;
    return n;
  }

  /** Number of real point lights in use (diagnostics). */
  get litCount(): number {
    let n = 0;
    for (const l of this.pool) if (l.intensity > 0) n++;
    return n;
  }

  add(kind: PracticalKind, x: number, y: number, z: number): PracticalHandle {
    if (!this.pool.length && this.poolSize > 0) this.buildPool();
    let i = -1;
    for (let k = 0; k < this.count; k++)
      if (!this.alive[k]) {
        i = k;
        break;
      }
    if (i < 0) {
      if (this.count >= this.capacity) this.grow(Math.max(16, this.capacity * 2));
      i = this.count++;
    }
    const id = this.nextId++;
    this.ids[i] = id;
    this.alive[i] = 1;
    this.kinds[i] = KIND_INDEX[kind];
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.scale[i] = 1;
    // Deterministic-looking variety without Math.random (stable across reloads).
    const h = Math.sin(id * 12.9898) * 43758.5453;
    this.phase[i] = h - Math.floor(h);
    this.freq[i] = 6 + 6 * this.phase[i]!;
    const self = this;
    return {
      id,
      kind,
      setPosition(px: number, py: number, pz: number): void {
        const j = self.indexOf(id);
        if (j < 0) return;
        self.pos[j * 3] = px;
        self.pos[j * 3 + 1] = py;
        self.pos[j * 3 + 2] = pz;
      },
      setScale(s: number): void {
        const j = self.indexOf(id);
        if (j >= 0) self.scale[j] = Math.max(0, s);
      },
      remove(): void {
        const j = self.indexOf(id);
        if (j >= 0) self.alive[j] = 0;
      },
    };
  }

  private indexOf(id: number): number {
    for (let i = 0; i < this.count; i++) if (this.ids[i] === id && this.alive[i]) return i;
    return -1;
  }

  private grow(cap: number): void {
    const copy = <T extends Float32Array | Uint8Array | Int32Array>(src: T, n: number, make: (n: number) => T): T => {
      const d = make(n);
      d.set(src.subarray(0, Math.min(src.length, n)));
      return d;
    };
    this.kinds = copy(this.kinds, cap, (n) => new Uint8Array(n));
    this.alive = copy(this.alive, cap, (n) => new Uint8Array(n));
    this.ids = copy(this.ids, cap, (n) => new Int32Array(n));
    this.pos = copy(this.pos, cap * 3, (n) => new Float32Array(n));
    this.scale = copy(this.scale, cap, (n) => new Float32Array(n));
    this.phase = copy(this.phase, cap, (n) => new Float32Array(n));
    this.freq = copy(this.freq, cap, (n) => new Float32Array(n));
    this.capacity = cap;
    this.buildSprites();
  }

  private buildSprites(): void {
    if (this.sprites) {
      this.object.remove(this.sprites);
      this.sprites.dispose();
    }
    this.spriteGeometry ??= new THREE.PlaneGeometry(1, 1);
    if (!this.spriteMaterial) {
      const colors = PRACTICAL_KINDS.map((k) => new THREE.Color(PRACTICAL_LIGHTS[k].color));
      this.spriteMaterial = new THREE.ShaderMaterial({
        name: 'SamrajyaFlame',
        uniforms: { uTime: { value: 0 }, uColors: { value: colors } },
        vertexShader: SPRITE_VERTEX,
        fragmentShader: SPRITE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        // rgb += flame; destination alpha untouched (the HDR buffer's alpha carries the SSR mask).
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        blendSrcAlpha: THREE.ZeroFactor,
        blendDstAlpha: THREE.OneFactor,
        toneMapped: false,
      });
    }
    const geo = this.spriteGeometry.clone();
    this.spriteAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 4), 4);
    this.spriteAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFlame', this.spriteAttr);
    this.sprites = new THREE.InstancedMesh(geo, this.spriteMaterial, this.capacity);
    this.sprites.name = 'practical_flames';
    this.sprites.frustumCulled = false;
    this.sprites.count = 0;
    this.sprites.renderOrder = 10;
    this.object.add(this.sprites);
  }

  private buildPool(): void {
    for (const l of this.pool) {
      this.object.remove(l);
      l.dispose();
    }
    this.pool = [];
    for (let i = 0; i < this.poolSize; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.name = `practical_${i}`;
      l.castShadow = false;
      this.pool.push(l);
      this.object.add(l);
    }
  }

  /** Per frame: flicker, nearest-N selection for the light pool, sprite instances. Allocation-free. */
  update(dt: number, camera: THREE.Vector3): void {
    this.time += dt;
    const t = this.time;
    const n = this.count;
    const N = Math.min(this.pool.length, this.nearest.length);
    let found = 0;
    // Nearest-N insertion (N <= 16 per tier).
    for (let i = 0; i < n; i++) {
      if (!this.alive[i]) continue;
      const k = this.kinds[i]!;
      const w = k === 3 ? 1 : this.weight;
      if (w * this.scale[i]! <= 0.001) continue;
      const dx = this.pos[i * 3]! - camera.x;
      const dy = this.pos[i * 3 + 1]! - camera.y;
      const dz = this.pos[i * 3 + 2]! - camera.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (N === 0) continue;
      let j = found < N ? found++ : N;
      if (j === N) {
        if (d >= this.nearestD[N - 1]!) continue;
        j = N - 1;
      }
      while (j > 0 && this.nearestD[j - 1]! > d) {
        this.nearestD[j] = this.nearestD[j - 1]!;
        this.nearest[j] = this.nearest[j - 1]!;
        j--;
      }
      this.nearestD[j] = d;
      this.nearest[j] = i;
    }
    for (let p = 0; p < this.pool.length; p++) {
      const l = this.pool[p]!;
      if (p >= found) {
        l.intensity = 0;
        continue;
      }
      const i = this.nearest[p]!;
      const kind = PRACTICAL_KINDS[this.kinds[i]!]!;
      const def = PRACTICAL_LIGHTS[kind];
      const w = kind === 'burningBuilding' ? 1 : this.weight;
      const ph = this.phase[i]! * 6.2831;
      const f = this.freq[i]!;
      // Two summed noises at 6-12 Hz, depth = PRACTICAL_LIGHTS.flicker (0.12 lamp .. 0.35 burning building).
      const noise = 0.6 * Math.sin(t * f * 6.2831 + ph) + 0.4 * Math.sin(t * f * 1.618 * 6.2831 + ph * 2.3);
      const flick = 1 - def.flicker * (0.5 + 0.5 * noise);
      l.color.set(def.color);
      l.intensity = def.intensity * w * this.scale[i]! * flick;
      l.distance = def.rangeM;
      l.decay = 2;
      l.position.set(this.pos[i * 3]!, this.pos[i * 3 + 1]!, this.pos[i * 3 + 2]!);
    }
    // Sprites (every practical).
    if (!this.sprites || !this.spriteAttr) return;
    const a = this.spriteAttr.array as Float32Array;
    let m = 0;
    for (let i = 0; i < n; i++) {
      if (!this.alive[i]) continue;
      const k = this.kinds[i]!;
      const kind = PRACTICAL_KINDS[k]!;
      const w = k === 3 ? 1 : this.weight;
      const s = this.scale[i]! * w;
      if (s <= 0.001) continue;
      this.tmpM.makeTranslation(this.pos[i * 3]!, this.pos[i * 3 + 1]!, this.pos[i * 3 + 2]!);
      this.sprites.setMatrixAt(m, this.tmpM);
      a[m * 4] = FLAME_LUMINANCE[kind] * this.emissiveBoost * Math.min(1, s * 1.5);
      a[m * 4 + 1] = this.phase[i]!;
      a[m * 4 + 2] = k;
      a[m * 4 + 3] = FLAME_SIZE[kind] * Math.max(0.3, Math.min(1.5, this.scale[i]!));
      m++;
    }
    this.sprites.count = m;
    if (m > 0) {
      this.sprites.instanceMatrix.needsUpdate = true;
      this.spriteAttr.needsUpdate = true;
    }
    if (this.spriteMaterial) this.spriteMaterial.uniforms.uTime!.value = t;
    void this.tmpC;
  }

  /** Remove every practical (pool and sprite buffers are kept). */
  clear(): void {
    this.alive.fill(0);
    this.count = 0;
  }

  dispose(): void {
    for (const l of this.pool) l.dispose();
    this.pool = [];
    if (this.sprites) {
      this.sprites.geometry.dispose();
      this.sprites.dispose();
    }
    this.spriteGeometry?.dispose();
    this.spriteMaterial?.dispose();
    this.object.clear();
  }
}
