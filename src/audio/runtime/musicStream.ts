/**
 * Gapless playback of the score streamed from the music worker, in one of two modes:
 *  - 'worklet' (preferred): an AudioWorkletNode pulls 0.25 s chunks straight from the music worker over a
 *    MessageChannel (see streamWorklet.ts) - the main thread is not involved, so scene loads and other
 *    main-thread hitches cannot starve the music;
 *  - 'buffers' (fallback: no AudioWorklet, inline render port): chunks come back to the main thread and
 *    are scheduled back to back as AudioBufferSourceNodes on a sample-exact timeline (base time + frames /
 *    rate), keeping ~1 s buffered ahead of the context clock, with a pre-roll after start / underruns.
 *    AudioBuffers are pooled; chunk Float32Arrays travel back to the worker for reuse.
 * Until `start()` has picked a mode ('pending') nothing is requested.
 * OWNER: Audio Developer (AUD-01).
 */
import type { ScoreStats } from '../music/engine';
import type { RenderPort } from './renderPort';
import { loadStreamWorklet, STREAM_PROCESSOR, type StreamControl, type StreamProcessorOptions, type StreamWorkletStats } from './streamWorklet';

export type StreamMode = 'pending' | 'worklet' | 'buffers';

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
  /** Round trip of the last chunk request (ms) and the worst one seen. */
  latencyMs = 0;
  maxLatencyMs = 0;
  private readonly sentAt = new Float64Array(8);
  private sentHead = 0;
  private sentTail = 0;
  private aheadSec = 1.0;
  enabled = true;
  mode: StreamMode = 'pending';
  private node: AudioWorkletNode | null = null;
  private wStats: StreamWorkletStats | null = null;
  private disposed = false;

  constructor(
    private readonly ctx: AudioContext,
    private readonly port: RenderPort,
    private readonly out: AudioNode,
  ) {
    this.chunkFrames = Math.round(ctx.sampleRate * 0.25);
    this.chunkSec = this.chunkFrames / ctx.sampleRate;
  }

  /** Seconds kept buffered ahead of the context clock. */
  get ahead(): number {
    return this.aheadSec;
  }

  set ahead(sec: number) {
    this.aheadSec = sec;
    this.control({ t: 'config', ahead: Math.round(sec * this.ctx.sampleRate) });
  }

  /**
   * Pick the mode: the AudioWorklet path when allowed and available (falls back to buffers if the module
   * fails to load or takes longer than `timeoutMs`).
   */
  async start(useWorklet: boolean, timeoutMs = 3000): Promise<StreamMode> {
    if (this.mode !== 'pending') return this.mode;
    if (!useWorklet || this.port.inline || typeof AudioWorkletNode === 'undefined' || typeof MessageChannel === 'undefined') {
      this.mode = 'buffers';
      return this.mode;
    }
    const timer = setTimeout(() => {
      if (this.mode === 'pending') this.mode = 'buffers';
    }, timeoutMs);
    try {
      await loadStreamWorklet(this.ctx);
      if (this.mode !== 'pending' || this.disposed) return this.mode;
      const sr = this.ctx.sampleRate;
      const options: StreamProcessorOptions = { chunk: this.chunkFrames, ahead: Math.round(this.aheadSec * sr), preroll: Math.round(Math.min(this.prerollSec, this.aheadSec) * sr) };
      const node = new AudioWorkletNode(this.ctx, STREAM_PROCESSOR, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: options });
      node.port.onmessage = (e: MessageEvent<StreamWorkletStats>) => {
        const w = e.data;
        if (!w || w.t !== 'stats') return;
        this.wStats = w;
        this.underruns = w.underruns;
        this.chunks = w.chunks;
        this.workerMs = w.workerMs;
        this.latencyMs = w.latencyMs;
        this.maxLatencyMs = w.maxLatencyMs;
      };
      const channel = new MessageChannel();
      this.port.post({ t: 'stream', port: channel.port2 }, [channel.port2]);
      const msg: StreamControl = { t: 'port', port: channel.port1 };
      node.port.postMessage(msg, [channel.port1]);
      node.connect(this.out);
      this.node = node;
      this.mode = 'worklet';
    } catch {
      if (this.mode === 'pending') this.mode = 'buffers';
    } finally {
      clearTimeout(timer);
    }
    return this.mode;
  }

  private control(msg: StreamControl): void {
    this.node?.port.postMessage(msg);
  }

  /** Worker score stats (worklet mode: the worker posts them on its main port). */
  onScore(stats: ScoreStats): void {
    this.lastStats = stats;
  }

  /** Seconds of score buffered ahead of the context clock (scheduled or held in the pre-roll). */
  get bufferedSec(): number {
    if (this.mode === 'worklet') return this.wStats?.buffered ?? 0;
    let held = 0;
    for (const s of this.preroll) held += s.buffer.length;
    const sched = this.base < 0 || this.prerolling ? 0 : Math.max(0, this.base + this.framesQueued / this.ctx.sampleRate - this.ctx.currentTime);
    return sched + held / this.ctx.sampleRate;
  }

  private lastChunkAt = 0;

  /** Per frame: keep the pipeline filled (buffers mode; the worklet pulls on its own). */
  update(): void {
    if (!this.enabled || this.mode !== 'buffers') return;
    // Watchdog: a request lost to a worker error must not stall the stream forever.
    if (this.inFlight > 0 && this.lastChunkAt > 0 && performance.now() - this.lastChunkAt > 4000) {
      this.inFlight = 0;
      this.sentHead = this.sentTail;
      this.lastChunkAt = performance.now();
    }
    const want = Math.ceil((this.ahead - Math.max(0, this.bufferedSec)) / this.chunkSec);
    while (want > this.inFlight && this.inFlight < 3) this.requestChunk();
  }

  private requestChunk(): void {
    if (this.lastChunkAt === 0) this.lastChunkAt = performance.now();
    this.inFlight++;
    this.sentAt[this.sentTail] = performance.now();
    this.sentTail = (this.sentTail + 1) & 7;
    const recycle = this.recycle;
    this.recycle = null;
    if (recycle) this.port.post({ t: 'chunk', frames: this.chunkFrames, recycle }, [recycle[0].buffer as ArrayBuffer, recycle[1].buffer as ArrayBuffer]);
    else this.port.post({ t: 'chunk', frames: this.chunkFrames });
  }

  /** Chunks held back until the pre-roll is complete (start / after an underrun). */
  private readonly preroll: Slot[] = [];
  private prerolling = true;
  /** Seconds collected before the timeline (re)starts. */
  prerollSec = 0.75;

  onChunk(L: Float32Array, R: Float32Array, frames: number, ms: number, stats: ScoreStats | null): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.lastChunkAt = performance.now();
    if (this.sentHead !== this.sentTail) {
      this.latencyMs = this.lastChunkAt - (this.sentAt[this.sentHead] as number);
      this.sentHead = (this.sentHead + 1) & 7;
      if (this.latencyMs > this.maxLatencyMs) this.maxLatencyMs = this.latencyMs;
    }
    this.chunks++;
    this.workerMs += ms;
    if (stats) this.lastStats = stats;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const sr = ctx.sampleRate;
    const slot = this.acquire(frames, now);
    slot.buffer.copyToChannel(L, 0);
    slot.buffer.copyToChannel(R, 1);
    slot.end = Infinity;
    this.recycle = [L, R];
    if (!this.prerolling && this.base >= 0 && this.base + this.framesQueued / sr < now + 0.01) {
      // Underrun: the clock overtook the timeline. Collect a fresh pre-roll before restarting.
      this.underruns++;
      this.prerolling = true;
    }
    if (this.prerolling) {
      this.preroll.push(slot);
      let f = 0;
      for (const s of this.preroll) f += s.buffer.length;
      if (f / sr < this.prerollSec) return;
      this.prerolling = false;
      this.base = now + 0.05;
      this.framesQueued = 0;
      for (const s of this.preroll) this.schedule(s);
      this.preroll.length = 0;
      return;
    }
    this.schedule(slot);
  }

  private schedule(slot: Slot): void {
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const start = this.base + this.framesQueued / sr;
    const src = ctx.createBufferSource();
    src.buffer = slot.buffer;
    src.connect(this.out);
    src.start(start);
    slot.end = start + slot.buffer.length / sr;
    this.framesQueued += slot.buffer.length;
  }

  private acquire(frames: number, now: number): Slot {
    for (const s of this.pool) if (s.end < now - 0.05 && s.buffer.length === frames) return s;
    const s: Slot = { buffer: this.ctx.createBuffer(2, frames, this.ctx.sampleRate), end: 0 };
    this.pool.push(s);
    return s;
  }

  /** Forget the timeline (buffers mode: the next chunks pre-roll again). */
  reset(): void {
    if (this.mode === 'worklet') return;
    this.base = -1;
    this.framesQueued = 0;
    this.prerolling = true;
  }

  dispose(): void {
    this.disposed = true;
    this.enabled = false;
    const node = this.node;
    if (node) {
      this.control({ t: 'stop' });
      node.port.onmessage = null;
      node.disconnect();
      this.node = null;
    }
  }
}
