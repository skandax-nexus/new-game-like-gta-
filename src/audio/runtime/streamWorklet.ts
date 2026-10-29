/**
 * AudioWorklet that plays the score streamed straight from the music worker over a MessageChannel, so
 * main-thread hitches (scene loads, shader compiles) never starve the music: the worklet pulls 0.25 s
 * chunks from the worker itself, copies them into the output quantum by quantum (no allocation), hands
 * the chunk arrays back for reuse, and reports buffer / underrun / latency stats to the main thread four
 * times a second. The processor is plain JS (registered from a Blob URL, so it also works in the
 * single-file build) and is unit-tested in node by evaluating this source with fake worklet globals.
 * OWNER: Audio Developer (AUD-01).
 */

export const STREAM_PROCESSOR = 'samrajya-score-stream';

/** Options passed as `processorOptions` (frames, not seconds). */
export interface StreamProcessorOptions {
  chunk: number;
  ahead: number;
  preroll: number;
}

/** Stats posted by the processor on its node port. */
export interface StreamWorkletStats {
  t: 'stats';
  buffered: number;
  underruns: number;
  chunks: number;
  latencyMs: number;
  maxLatencyMs: number;
  workerMs: number;
  prerolling: boolean;
}

/** Control messages the main thread sends to the processor. */
export type StreamControl =
  | { t: 'port'; port: MessagePort }
  | { t: 'config'; ahead?: number; preroll?: number }
  | { t: 'stop' };

export const STREAM_PROCESSOR_SOURCE = `
class ScoreStreamProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.chunk = o.chunk || 12000;
    this.ahead = o.ahead || 48000;
    this.preroll = o.preroll || 24000;
    this.queue = [];
    this.offset = 0;
    this.buffered = 0;
    this.inFlight = 0;
    this.prerolling = true;
    this.underruns = 0;
    this.chunks = 0;
    this.spare = [];
    this.stream = null;
    this.stopped = false;
    this.reportEvery = Math.round(sampleRate / 4);
    this.sinceReport = 0;
    this.sentAt = new Float64Array(8);
    this.sentHead = 0;
    this.sentTail = 0;
    this.latency = 0;
    this.maxLatency = 0;
    this.workerMs = 0;
    this.port.onmessage = (e) => this.control(e.data);
  }
  control(m) {
    if (!m) return;
    if (m.t === 'port') {
      this.stream = m.port;
      this.stream.onmessage = (e) => this.receive(e.data);
      this.pull();
    } else if (m.t === 'config') {
      if (m.ahead) this.ahead = m.ahead;
      if (m.preroll) this.preroll = m.preroll;
      this.pull();
    } else if (m.t === 'stop') {
      this.stopped = true;
      if (this.stream) {
        this.stream.onmessage = null;
        if (this.stream.close) this.stream.close();
        this.stream = null;
      }
    }
  }
  pull() {
    const s = this.stream;
    if (!s || this.stopped) return;
    while (this.inFlight < 3 && this.buffered + this.inFlight * this.chunk < this.ahead) {
      this.inFlight++;
      this.sentAt[this.sentTail] = currentTime;
      this.sentTail = (this.sentTail + 1) & 7;
      const r = this.spare.pop();
      if (r && r.L.length === this.chunk && r.R.length === this.chunk) {
        s.postMessage({ t: 'pull', frames: this.chunk, recycle: [r.L, r.R] }, [r.L.buffer, r.R.buffer]);
      } else {
        s.postMessage({ t: 'pull', frames: this.chunk });
      }
    }
  }
  receive(m) {
    if (!m || m.t !== 'chunk') return;
    if (this.inFlight > 0) this.inFlight--;
    if (this.sentHead !== this.sentTail) {
      this.latency = (currentTime - this.sentAt[this.sentHead]) * 1000;
      this.sentHead = (this.sentHead + 1) & 7;
      if (this.latency > this.maxLatency) this.maxLatency = this.latency;
    }
    this.queue.push(m);
    this.buffered += m.frames;
    this.chunks++;
    this.workerMs += m.ms || 0;
    if (this.prerolling && this.buffered >= this.preroll) this.prerolling = false;
    this.pull();
  }
  process(inputs, outputs) {
    if (this.stopped) return false;
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const L = out[0];
    const R = out.length > 1 ? out[1] : null;
    const n = L.length;
    if (!this.prerolling) {
      let i = 0;
      while (i < n) {
        const c = this.queue[0];
        if (!c) {
          this.underruns++;
          this.prerolling = true;
          break;
        }
        const off = this.offset;
        const k = Math.min(n - i, c.frames - off);
        const cl = c.L;
        const cr = c.R;
        for (let j = 0; j < k; j++) L[i + j] = cl[off + j];
        if (R) for (let j = 0; j < k; j++) R[i + j] = cr[off + j];
        i += k;
        this.offset += k;
        this.buffered -= k;
        if (this.offset >= c.frames) {
          this.queue.shift();
          this.offset = 0;
          if (this.spare.length < 4) this.spare.push(c);
        }
      }
    }
    this.sinceReport += n;
    if (this.sinceReport >= this.reportEvery) {
      this.sinceReport = 0;
      this.port.postMessage({
        t: 'stats',
        buffered: this.buffered / sampleRate,
        underruns: this.underruns,
        chunks: this.chunks,
        latencyMs: this.latency,
        maxLatencyMs: this.maxLatency,
        workerMs: this.workerMs,
        prerolling: this.prerolling,
      });
    }
    this.pull();
    return true;
  }
}
registerProcessor('${STREAM_PROCESSOR}', ScoreStreamProcessor);
`;

const loaded = new WeakMap<BaseAudioContext, Promise<void>>();

/** Register the processor on `ctx` once (Blob URL module). Rejects when AudioWorklet is unavailable. */
export function loadStreamWorklet(ctx: BaseAudioContext): Promise<void> {
  let p = loaded.get(ctx);
  if (!p) {
    const worklet = (ctx as { audioWorklet?: AudioWorklet }).audioWorklet;
    if (!worklet || typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      p = Promise.reject(new Error('AudioWorklet unavailable'));
    } else {
      const url = URL.createObjectURL(new Blob([STREAM_PROCESSOR_SOURCE], { type: 'application/javascript' }));
      p = worklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    }
    loaded.set(ctx, p);
  }
  return p;
}
