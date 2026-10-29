/**
 * Audio worker logic (pure, testable in node with an injected `post`): the 'music' role owns a
 * ScoreEngine and answers chunk requests immediately; the 'bank' role renders queued sound keys (highest
 * priority first, one per tick so cancellations and new urgent requests get in between).
 * The worker script (audio.worker.ts) is a thin shell around this; the main thread can also run it
 * inline (no Worker support) through RenderClient's fallback.
 * OWNER: Audio Developer (AUD-01).
 */
import type { AudioStinger } from '../../core/events';
import { renderBed, renderSpot } from '../ambience/render';
import { ScoreEngine } from '../music/engine';
import { hasStinger, renderStinger } from '../music/stingers';
import { renderSfx } from '../sfx/render';
import { isSfxSoundId, sfxRenderRate } from '../sfx/meta';
import { ambienceDef, spotRenderRate } from '../ambience/meta';
import { impulseResponse } from '../synth/reverb';
import type { FromWorker, SoundKey, StreamToWorker, ToWorker, WorkerRole } from './protocol';

export type Post = (msg: FromWorker, transfer: ArrayBuffer[]) => void;
export type Defer = (fn: () => void) => void;

interface Job {
  key: SoundKey;
  variant: number;
  priority: number;
  order: number;
}

export interface RenderedSound {
  channels: Float32Array[];
  sampleRate: number;
}

/** Render one sound key + variant (shared by the worker and inline fallback). */
export function renderSoundKey(key: SoundKey, variant: number, sr: number, seed: number): RenderedSound {
  const [kind, a, b] = key.split(':') as [string, string | undefined, string | undefined];
  switch (kind) {
    case 'sfx':
      if (a && isSfxSoundId(a)) {
        const rate = sfxRenderRate(a, sr);
        return { channels: [renderSfx(a, variant, rate, seed)], sampleRate: rate };
      }
      break;
    case 'spot':
      if (a && b) {
        const spec = ambienceDef(a)?.spots.find((x) => x.name === b);
        const rate = spec ? spotRenderRate(spec, sr) : sr;
        return { channels: [renderSpot(a, b, variant, rate, seed)], sampleRate: rate };
      }
      break;
    case 'bed':
      if (a) {
        const bed = renderBed(a, sr, seed);
        return { channels: [bed.data], sampleRate: bed.sampleRate };
      }
      break;
    case 'stinger':
      if (a && hasStinger(a)) {
        // 'stinger:<id>:half' = half rate (low tier: half the memory, phone speakers lose little).
        const rate = b === 'half' ? Math.round(sr / 2) : sr;
        const s = renderStinger(a as AudioStinger, rate, seed);
        return { channels: [s.L, s.R], sampleRate: rate };
      }
      break;
    case 'ir': {
      const secs = Number(b ?? 2);
      const s = impulseResponse(sr, Number.isFinite(secs) ? secs : 2, { seed: seed + 77, predelayMs: 10, brightness: 0.55, early: 0.4 });
      return { channels: [s.L, s.R], sampleRate: sr };
    }
  }
  throw new Error(`audio: unknown sound key "${key}"`);
}

export class WorkerHost {
  private role: WorkerRole | null = null;
  private sr = 48000;
  private seed = 1;
  private engine: ScoreEngine | null = null;
  private readonly queue: Job[] = [];
  private order = 0;
  private pumping = false;
  private seq = 0;
  private readonly now: () => number;

  constructor(
    private readonly post: Post,
    private readonly defer: Defer = (fn) => setTimeout(fn, 0),
    now?: () => number,
  ) {
    this.now = now ?? (() => (typeof performance !== 'undefined' ? performance.now() : 0));
  }

  get roleName(): WorkerRole | null {
    return this.role;
  }

  get pendingJobs(): number {
    return this.queue.length;
  }

  onMessage(msg: ToWorker): void {
    try {
      switch (msg.t) {
        case 'init':
          this.role = msg.role;
          this.sr = msg.sampleRate;
          this.seed = msg.seed;
          if (msg.role === 'music') this.engine = new ScoreEngine(msg.sampleRate, msg.seed);
          this.post({ t: 'ready', role: msg.role }, []);
          this.warm();
          break;
        case 'render':
          if (!this.queue.some((j) => j.key === msg.key && j.variant === msg.variant)) {
            this.queue.push({ key: msg.key, variant: msg.variant, priority: msg.priority, order: this.order++ });
            this.queue.sort((x, y) => y.priority - x.priority || x.order - y.order);
          }
          this.pump();
          break;
        case 'cancel':
          for (let i = this.queue.length - 1; i >= 0; i--) if ((this.queue[i] as Job).key === msg.key) this.queue.splice(i, 1);
          break;
        case 'mood':
          this.engine?.setMood(msg.mood, msg.intensity);
          this.warm();
          break;
        case 'intensity':
          this.engine?.setIntensity(msg.value);
          break;
        case 'context':
          this.engine?.setContext(msg.ctx);
          this.warm();
          break;
        case 'cue':
          this.engine?.cue(msg.stinger);
          break;
        case 'chunk':
          this.renderChunk(msg.frames, msg.recycle, this.post, true);
          break;
        case 'stream': {
          const port = msg.port;
          const post: Post = (m, transfer) => port.postMessage(m, transfer);
          port.onmessage = (e: MessageEvent<StreamToWorker>) => this.onStream(e.data, post);
          break;
        }
      }
    } catch (err) {
      this.post({ t: 'error', message: err instanceof Error ? err.message : String(err) }, []);
    }
  }

  /** A pull from the stream AudioWorklet (reply on its port; score stats go to the main thread). */
  onStream(msg: StreamToWorker, reply: Post): void {
    try {
      if (msg && msg.t === 'pull') this.renderChunk(msg.frames, msg.recycle, reply, false);
    } catch (err) {
      this.post({ t: 'error', message: err instanceof Error ? err.message : String(err) }, []);
    }
  }

  private renderChunk(n: number, recycle: [Float32Array, Float32Array] | undefined, reply: Post, statsInline: boolean): void {
    if (!this.engine) return;
    const L = recycle && recycle[0].length === n ? recycle[0] : new Float32Array(n);
    const R = recycle && recycle[1].length === n ? recycle[1] : new Float32Array(n);
    const t0 = this.now();
    this.engine.render(L, R, 0, n);
    const ms = this.now() - t0;
    const seq = this.seq++;
    const stats = seq % 8 === 0 ? this.engine.stats() : null;
    reply({ t: 'chunk', seq, frames: n, L, R, ms, stats: statsInline ? stats : null }, [L.buffer as ArrayBuffer, R.buffer as ArrayBuffer]);
    if (stats && !statsInline) this.post({ t: 'score', stats }, []);
  }

  private warming = false;

  /** Music role: render the active arrangement's caches in idle slices (30 ms) between chunk requests. */
  private warm(): void {
    if (this.warming || !this.engine) return;
    this.warming = true;
    this.defer(() => {
      this.warming = false;
      if (this.engine && !this.engine.prewarm(30, this.now)) this.warm();
    });
  }

  private pump(): void {
    if (this.pumping || this.queue.length === 0) return;
    this.pumping = true;
    this.defer(() => {
      this.pumping = false;
      const job = this.queue.shift();
      if (job) {
        try {
          const t0 = this.now();
          const r = renderSoundKey(job.key, job.variant, this.sr, this.seed);
          const ms = this.now() - t0;
          this.post({ t: 'sound', key: job.key, variant: job.variant, sampleRate: r.sampleRate, channels: r.channels, ms }, r.channels.map((c) => c.buffer as ArrayBuffer));
        } catch (err) {
          this.post({ t: 'error', message: err instanceof Error ? err.message : String(err), key: job.key }, []);
        }
      }
      this.pump();
    });
  }
}
