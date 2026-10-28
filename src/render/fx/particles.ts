/**
 * GPU-friendly particle system for dust, smoke, fire, sparks and splashes. OWNER: Lead Graphics
 * Engineer. Baseline by the CTO: CPU-simulated pooled billboards (THREE.Points) with additive/normal
 * blending, soft round sprite generated procedurally.
 * TODO(owner): soft particles (depth fade), atlas animation, lit smoke, fire light flicker, emitters
 * bound to formations (dust when marching/charging), burning buildings in sieges.
 */
import * as THREE from 'three';

export type ParticleKind = 'dust' | 'smoke' | 'fire' | 'spark' | 'splash';

const KIND_STYLE: Record<ParticleKind, { color: [number, number, number]; life: number; size: number; rise: number; drag: number }> = {
  dust: { color: [0.62, 0.52, 0.38], life: 2.5, size: 3.2, rise: 0.6, drag: 0.9 },
  smoke: { color: [0.32, 0.31, 0.3], life: 6, size: 5, rise: 2.2, drag: 0.95 },
  fire: { color: [1.6, 0.7, 0.2], life: 0.9, size: 1.6, rise: 2.5, drag: 0.9 },
  spark: { color: [1.8, 1.2, 0.5], life: 0.4, size: 0.4, rise: 0, drag: 0.8 },
  splash: { color: [0.75, 0.85, 0.9], life: 0.8, size: 1.4, rise: 1.5, drag: 0.85 },
};

function spriteTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class ParticleSystem {
  readonly object: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly kind: Uint8Array;
  private next = 0;
  private readonly tex: THREE.CanvasTexture;
  private readonly material: THREE.ShaderMaterial;

  constructor(private readonly capacity: number) {
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.size = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.kind = new Uint8Array(capacity);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.tex = spriteTexture();
    this.material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: this.tex }, uScale: { value: 600 } },
      vertexShader: `attribute vec4 aColor; attribute float aSize; varying vec4 vColor; uniform float uScale;
        void main(){ vColor = aColor; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * uScale / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uMap; varying vec4 vColor; void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vColor.rgb, vColor.a * t.a); if (gl_FragColor.a < 0.01) discard; }`,
      transparent: true,
      depthWrite: false,
    });
    this.object = new THREE.Points(geo, this.material);
    this.object.frustumCulled = false;
    this.object.name = 'particles';
  }

  emit(kind: ParticleKind, x: number, y: number, z: number, count: number, spread = 1): void {
    const st = KIND_STYLE[kind];
    const kinds: ParticleKind[] = ['dust', 'smoke', 'fire', 'spark', 'splash'];
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.capacity;
      this.pos[i * 3] = x + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 1] = y + Math.random() * spread * 0.3;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * spread;
      this.vel[i * 3] = (Math.random() - 0.5) * 1.5;
      this.vel[i * 3 + 1] = st.rise * (0.5 + Math.random());
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * 1.5;
      this.life[i] = st.life * (0.7 + Math.random() * 0.6);
      this.maxLife[i] = this.life[i] as number;
      this.kind[i] = kinds.indexOf(kind);
    }
  }

  update(dt: number, viewportHeight: number): void {
    const kinds: ParticleKind[] = ['dust', 'smoke', 'fire', 'spark', 'splash'];
    for (let i = 0; i < this.capacity; i++) {
      if ((this.life[i] as number) <= 0) {
        this.col[i * 4 + 3] = 0;
        continue;
      }
      const st = KIND_STYLE[kinds[this.kind[i] as number] as ParticleKind];
      this.life[i] = (this.life[i] as number) - dt;
      const t = 1 - (this.life[i] as number) / (this.maxLife[i] as number);
      for (let a = 0; a < 3; a++) {
        this.pos[i * 3 + a] = (this.pos[i * 3 + a] as number) + (this.vel[i * 3 + a] as number) * dt;
        this.vel[i * 3 + a] = (this.vel[i * 3 + a] as number) * Math.pow(st.drag, dt * 10);
      }
      this.col[i * 4] = st.color[0];
      this.col[i * 4 + 1] = st.color[1];
      this.col[i * 4 + 2] = st.color[2];
      this.col[i * 4 + 3] = Math.sin(Math.PI * Math.min(1, t * 1.2)) * 0.6;
      this.size[i] = st.size * (0.6 + t);
    }
    const g = this.object.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    this.material.uniforms.uScale!.value = viewportHeight * 0.9;
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.material.dispose();
    this.tex.dispose();
  }
}
