/**
 * Sound bank (main thread): AudioBuffers rendered by the bank worker, per sound key and variant.
 * Requests are de-duplicated and prioritized; `pick` returns a random ready variant (allocation-free).
 * OWNER: Audio Developer (AUD-01).
 */
import type { SoundKey } from './protocol';
import type { RenderPort } from './renderPort';

interface Entry {
  variants: (AudioBuffer | null)[];
  requested: number;
  ready: number;
}

export class SoundBank {
  private readonly m = new Map<SoundKey, Entry>();
  private bytesTotal = 0;
  private rndState = 0x2545f491;
  /** Called when a key gets its first ready variant. */
  onReady: ((key: SoundKey) => void) | null = null;
  renderMs = 0;
  renders = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly port: RenderPort,
  ) {}

  get bytes(): number {
    return this.bytesTotal;
  }

  get keys(): number {
    return this.m.size;
  }

  /** Ask for `variants` variants of `key` (no-op for already requested ones). */
  request(key: SoundKey, variants: number, priority: number): void {
    let e = this.m.get(key);
    if (!e) {
      e = { variants: [], requested: 0, ready: 0 };
      this.m.set(key, e);
    }
    while (e.requested < variants) {
      e.variants.push(null);
      this.port.post({ t: 'render', key, variant: e.requested, priority: priority - e.requested * 0.01 });
      e.requested++;
    }
  }

  isRequested(key: SoundKey): boolean {
    return this.m.has(key);
  }

  has(key: SoundKey): boolean {
    return (this.m.get(key)?.ready ?? 0) > 0;
  }

  /** A random ready variant (xorshift, no allocation), or null. */
  pick(key: SoundKey): AudioBuffer | null {
    const e = this.m.get(key);
    if (!e || e.ready === 0) return null;
    let x = this.rndState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rndState = x >>> 0;
    const n = e.variants.length;
    let i = this.rndState % n;
    for (let k = 0; k < n; k++, i = (i + 1) % n) {
      const b = e.variants[i];
      if (b) return b;
    }
    return null;
  }

  get(key: SoundKey, variant = 0): AudioBuffer | null {
    return this.m.get(key)?.variants[variant] ?? null;
  }

  /** Worker delivered a rendered sound. */
  receive(key: SoundKey, variant: number, sampleRate: number, channels: Float32Array[], ms: number): void {
    const e = this.m.get(key);
    if (!e || channels.length === 0) return;
    const len = (channels[0] as Float32Array).length;
    const buf = this.ctx.createBuffer(channels.length, Math.max(1, len), sampleRate);
    channels.forEach((c, i) => buf.copyToChannel(c, i));
    const had = e.ready > 0;
    if (!e.variants[variant]) {
      e.ready++;
      this.bytesTotal += len * 4 * channels.length;
    }
    e.variants[variant] = buf;
    this.renderMs += ms;
    this.renders++;
    if (!had) this.onReady?.(key);
  }

  /** Drop a key (e.g. a bed nobody plays any more) and its memory. */
  release(key: SoundKey): void {
    const e = this.m.get(key);
    if (!e) return;
    for (const b of e.variants) if (b) this.bytesTotal -= b.length * 4 * b.numberOfChannels;
    this.m.delete(key);
    this.port.post({ t: 'cancel', key });
  }
}
