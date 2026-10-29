/**
 * Gapless playback of the score streamed from the music worker. Chunks (0.25 s) are scheduled back to
 * back on a sample-exact timeline (base time + frames / rate), keeping ~1 s buffered ahead of the
 * context clock; at most a few requests are in flight. AudioBuffers are pooled and reused once played;
 * the chunk Float32Arrays travel back to the worker for reuse. An underrun (worker starved) re-bases the
 * timeline a little ahead of `now` and is counted.
 * OWNER: Audio Developer (AUD-01).
 */
import type { ScoreStats } from '../music/engine';
import type { RenderPort } from './renderPort';

interface Slot {
  buffer: AudioBuffer;
  end: number;
}

export class MusicStream {
  readonly chunkFrames: number;
  private readonly chunkSec: number;
  private base = -1;
  private framesQueued = 0;
  private inFlight = 0;
  private readonly pool: Slot[] = [];
  private recycle: [Float32Array, Float32Array] | null = null;
  underruns = 0;
  chunks = 0;
  workerMs = 0;
  lastStats: ScoreStats | null = null;
  /** Seconds kept buffered ahead of the context clock. */
  ahead = 1.0;
  enabled = true;

  constructor(
    private readonly ctx: AudioContext,
    private readonly port: RenderPort,
    private readonly out: AudioNode,
  ) {
    this.chunkFrames = Math.round(ctx.sampleRate * 0.25);
    this.chunkSec = this.chunkFrames / ctx.sampleRate;
  }

  /** Seconds of score scheduled beyond the context clock. */
  get bufferedSec(): number {
    if (this.base < 0) return 0;
    return this.base + this.framesQueued / this.ctx.sampleRate - this.ctx.currentTime;
  }

  /** Per frame: keep the pipeline filled. */
  update(): void {
    if (!this.enabled) return;
    const want = Math.ceil((this.ahead - Math.max(0, this.bufferedSec)) / this.chunkSec);
    while (want > this.inFlight && this.inFlight < 3) this.requestChunk();
  }

  private requestChunk(): void {
    this.inFlight++;
    const recycle = this.recycle;
    this.recycle = null;
    if (recycle) this.port.post({ t: 'chunk', frames: this.chunkFrames, recycle }, [recycle[0].buffer as ArrayBuffer, recycle[1].buffer as ArrayBuffer]);
    else this.port.post({ t: 'chunk', frames: this.chunkFrames });
  }

  onChunk(L: Float32Array, R: Float32Array, frames: number, ms: number, stats: ScoreStats | null): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.chunks++;
    this.workerMs += ms;
    if (stats) this.lastStats = stats;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const sr = ctx.sampleRate;
    let start = this.base < 0 ? -1 : this.base + this.framesQueued / sr;
    if (start < 0 || start < now + 0.01) {
      if (start >= 0) this.underruns++;
      this.base = now + 0.06;
      this.framesQueued = 0;
      start = this.base;
    }
    const slot = this.acquire(frames, now);
    slot.buffer.copyToChannel(L, 0);
    slot.buffer.copyToChannel(R, 1);
    const src = ctx.createBufferSource();
    src.buffer = slot.buffer;
    src.connect(this.out);
    src.start(start);
    slot.end = start + frames / sr;
    this.framesQueued += frames;
    this.recycle = [L, R];
  }

  private acquire(frames: number, now: number): Slot {
    for (const s of this.pool) if (s.end < now - 0.05 && s.buffer.length === frames) return s;
    const s: Slot = { buffer: this.ctx.createBuffer(2, frames, this.ctx.sampleRate), end: 0 };
    this.pool.push(s);
    return s;
  }

  /** Forget the timeline (after a suspend / resume the next chunk re-bases). */
  reset(): void {
    this.base = -1;
    this.framesQueued = 0;
  }
}
