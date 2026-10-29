/**
 * AUD-01 runtime: voice cap per quality tier and priority stealing, the audio worker protocol, the spatial
 * model, cue coverage, and the WebAudio adapters against a fake AudioContext (gapless score scheduling,
 * exactly one node created per SFX trigger after warm-up). OWNER: Audio Developer (AUD-01).
 */
import { describe, expect, it } from 'vitest';
import { QUALITY_PRESETS } from '../../src/core/quality';
import { BATTLE_EVENT_KINDS, type BattleEventRecord, QUALITY_TIERS, type SimEvent } from '../../src/core/types';
import { SFX_KINDS } from '../../src/core/events';
import { splitVoiceCap, VoicePool } from '../../src/audio/spatial/voices';
import { airAbsorptionHz, distanceGain, relativeAzimuth, reverbSend, thunderDelaySec } from '../../src/audio/spatial/model';
import { battleBedLayers, cuesForBattleEvent, cuesForSimEvent, heroCombatCues } from '../../src/audio/cues';
import { ambienceDef } from '../../src/audio/ambience/meta';
import { ALL_SFX, SFX_GROUPS, SFX_META } from '../../src/audio/sfx/meta';
import { renderSoundKey, WorkerHost } from '../../src/audio/runtime/workerHost';
import type { FromWorker } from '../../src/audio/runtime/protocol';
import { MusicStream } from '../../src/audio/runtime/musicStream';
import { STREAM_PROCESSOR, STREAM_PROCESSOR_SOURCE } from '../../src/audio/runtime/streamWorklet';
import type { StreamToWorker } from '../../src/audio/runtime/protocol';
import { makePlayParams, VoicePlayer } from '../../src/audio/runtime/voicePlayer';
import type { RenderPort } from '../../src/audio/runtime/renderPort';
import { measure } from '../../src/audio/synth/buffer';

// ------------------------------------------------------------------------------------ fake WebAudio

class FakeParam {
  value = 0;
  events = 0;
  setValueAtTime(v: number): this {
    this.value = v;
    this.events++;
    return this;
  }
  linearRampToValueAtTime(v: number): this {
    this.value = v;
    this.events++;
    return this;
  }
  setTargetAtTime(v: number): this {
    this.value = v;
    this.events++;
    return this;
  }
  cancelScheduledValues(): this {
    return this;
  }
}

class FakeNode {
  connections = 0;
  connect<T>(n: T): T {
    this.connections++;
    return n;
  }
  disconnect(): void {}
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}
class FakeFilter extends FakeNode {
  type = 'lowpass';
  frequency = new FakeParam();
  Q = new FakeParam();
}
class FakePanner extends FakeNode {
  panningModel = 'equalpower';
  distanceModel = 'inverse';
  refDistance = 1;
  rolloffFactor = 1;
  maxDistance = 10000;
  positionX = new FakeParam();
  positionY = new FakeParam();
  positionZ = new FakeParam();
}
class FakeStereo extends FakeNode {
  pan = new FakeParam();
}
class FakeBuffer {
  readonly duration: number;
  readonly data: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.duration = length / sampleRate;
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  copyToChannel(src: Float32Array, ch: number): void {
    this.data[ch]!.set(src);
  }
}
class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  playbackRate = new FakeParam();
  loop = false;
  startedAt = -1;
  start(t: number): void {
    this.startedAt = t;
  }
  stop(): void {}
}

class FakeContext {
  currentTime = 0;
  sampleRate = 48000;
  created: Record<string, number> = {};
  sources: FakeSource[] = [];
  listener = { positionX: new FakeParam(), positionY: new FakeParam(), positionZ: new FakeParam(), forwardX: new FakeParam(), forwardY: new FakeParam(), forwardZ: new FakeParam() };
  private count(k: string): void {
    this.created[k] = (this.created[k] ?? 0) + 1;
  }
  createGain(): FakeGain {
    this.count('gain');
    return new FakeGain();
  }
  createBiquadFilter(): FakeFilter {
    this.count('filter');
    return new FakeFilter();
  }
  createPanner(): FakePanner {
    this.count('panner');
    return new FakePanner();
  }
  createStereoPanner(): FakeStereo {
    this.count('stereo');
    return new FakeStereo();
  }
  createBufferSource(): FakeSource {
    this.count('source');
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createBuffer(ch: number, len: number, sr: number): FakeBuffer {
    this.count('buffer');
    return new FakeBuffer(ch, len, sr);
  }
  total(): number {
    return Object.values(this.created).reduce((a, b) => a + b, 0);
  }
}

class FakePort implements RenderPort {
  onMessage: ((msg: FromWorker) => void) | null = null;
  readonly inline = true;
  sent: unknown[] = [];
  post(msg: unknown): void {
    this.sent.push(msg);
  }
  dispose(): void {}
}

// -------------------------------------------------------------------------------------------- tests

describe('voice pool', () => {
  it('caps voices per quality tier (16 low / 32 medium / 48 high) and splits them across pools', () => {
    expect(QUALITY_PRESETS.low.audio.voices).toBe(16);
    expect(QUALITY_PRESETS.medium.audio.voices).toBe(32);
    expect(QUALITY_PRESETS.high.audio.voices).toBe(48);
    expect(QUALITY_PRESETS.low.audio.hrtf).toBe(false);
    expect(QUALITY_PRESETS.high.audio.hrtf).toBe(true);
    for (const t of QUALITY_TIERS) {
      const cap = QUALITY_PRESETS[t].audio.voices;
      const s = splitVoiceCap(cap);
      expect(s.flat + s.sfx + s.ambience).toBe(cap);
      const pool = new VoicePool(cap);
      let ok = 0;
      for (let i = 0; i < cap * 3; i++) if (pool.allocate({ kind: `k${i}`, priority: 10, now: 0, duration: 10, gain: 1, maxInstances: 99, minIntervalMs: 0 }) >= 0) ok++;
      expect(pool.active(0)).toBe(cap);
      expect(ok).toBe(cap * 3); // equal priority: later voices steal the oldest
    }
  });

  it('steals the least important voice and never a higher-priority one', () => {
    const pool = new VoicePool(3);
    const req = (kind: string, priority: number, gain = 1, duration = 5, now = 0) => ({ kind, priority, now, duration, gain, maxInstances: 9, minIntervalMs: 0 });
    expect(pool.allocate(req('a', 50))).toBe(0);
    expect(pool.allocate(req('b', 20))).toBe(1);
    expect(pool.allocate(req('c', 80))).toBe(2);
    // Full: a priority-60 sound steals the priority-20 voice.
    expect(pool.allocate(req('d', 60, 1, 5, 0.1))).toBe(1);
    expect(pool.lastStolen).toBe(true);
    expect(pool.kindAt(1)).toBe('d');
    // A priority-10 request cannot steal anything (all playing voices are more important).
    expect(pool.allocate(req('e', 10, 1, 5, 0.2))).toBe(-1);
    expect(pool.lastReject).toBe('busy');
    // Among equal priorities the quietest / nearly finished goes first.
    const p2 = new VoicePool(2);
    p2.allocate(req('x', 40, 1, 10));
    p2.allocate(req('y', 40, 0.1, 10));
    expect(p2.allocate(req('z', 40, 1, 1, 0.5))).toBe(1);
    // Finished voices free their slot.
    expect(pool.allocate(req('f', 1, 1, 1, 6))).toBeGreaterThanOrEqual(0);
  });

  it('merges re-triggers inside the min interval and recycles a kind at its instance limit', () => {
    const pool = new VoicePool(8);
    const r = (now: number) => ({ kind: 'clash', priority: 50, now, duration: 2, gain: 1, maxInstances: 2, minIntervalMs: 90 });
    const a = pool.allocate(r(0));
    expect(pool.allocate(r(0.05))).toBe(-1);
    expect(pool.lastReject).toBe('interval');
    const b = pool.allocate(r(0.1));
    expect(b).not.toBe(a);
    const c = pool.allocate(r(0.2));
    expect(c).toBe(a); // third instance recycles the oldest clash
    expect(pool.active(0.2)).toBe(2);
  });
});

describe('audio worker host', () => {
  it('streams deterministic score chunks and renders bank keys by priority', () => {
    const out: FromWorker[] = [];
    const jobs: (() => void)[] = [];
    const host = new WorkerHost((m) => out.push(m), (fn) => jobs.push(fn));
    host.onMessage({ t: 'init', role: 'music', sampleRate: 24000, seed: 3 });
    host.onMessage({ t: 'mood', mood: 'world', intensity: 0.4 });
    host.onMessage({ t: 'chunk', frames: 6000 });
    host.onMessage({ t: 'chunk', frames: 6000 });
    const chunks = out.filter((m): m is Extract<FromWorker, { t: 'chunk' }> => m.t === 'chunk');
    expect(chunks.length).toBe(2);
    expect(chunks[0]!.L.length).toBe(6000);
    expect(chunks[1]!.seq).toBe(1);
    expect(measure(chunks[1]!.L).nan).toBe(0);

    const bankOut: FromWorker[] = [];
    const q: (() => void)[] = [];
    const bank = new WorkerHost((m) => bankOut.push(m), (fn) => q.push(fn));
    bank.onMessage({ t: 'init', role: 'bank', sampleRate: 24000, seed: 1 });
    bank.onMessage({ t: 'render', key: 'sfx:clash', variant: 0, priority: 10 });
    bank.onMessage({ t: 'render', key: 'sfx:ui_click', variant: 0, priority: 100 });
    bank.onMessage({ t: 'render', key: 'stinger:harvest', variant: 0, priority: 5 });
    bank.onMessage({ t: 'cancel', key: 'stinger:harvest' });
    while (q.length) q.shift()!();
    const sounds = bankOut.filter((m): m is Extract<FromWorker, { t: 'sound' }> => m.t === 'sound');
    expect(sounds.map((s) => s.key)).toEqual(['sfx:ui_click', 'sfx:clash']);
  });

  it('renders every key type at the right rate', () => {
    expect(renderSoundKey('sfx:ui_click', 0, 48000, 1).sampleRate).toBe(48000);
    expect(renderSoundKey('sfx:thunder', 0, 48000, 1).sampleRate).toBe(24000);
    expect(renderSoundKey('spot:crows:crow', 0, 48000, 1).sampleRate).toBe(24000);
    expect(renderSoundKey('spot:temple_bells:handbell', 0, 48000, 1).sampleRate).toBe(48000);
    expect(renderSoundKey('bed:fountain', 0, 48000, 1).channels.length).toBe(1);
    expect(renderSoundKey('stinger:duel_phase', 0, 48000, 1).channels.length).toBe(2);
    expect(renderSoundKey('ir:hall:1.2', 0, 48000, 1).channels[0]!.length).toBeGreaterThan(48000);
    expect(() => renderSoundKey('nope:x', 0, 48000, 1)).toThrow();
  });

  it('every half-rate SFX renders clean at half rate', () => {
    for (const id of ALL_SFX) {
      if (SFX_META[id].rate !== 'half') continue;
      const r = renderSoundKey(`sfx:${id}`, 0, 48000, 1);
      const st = measure(r.channels[0]!);
      expect(st.nan, id).toBe(0);
      expect(st.peakDb, id).toBeLessThanOrEqual(-1);
    }
  });
});

describe('score stream AudioWorklet', () => {
  interface ProcPort {
    onmessage: ((e: { data: unknown }) => void) | null;
    postMessage(m: unknown): void;
  }
  interface Proc {
    port: ProcPort;
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
  }
  /** Evaluate the processor source with fake worklet globals; returns a constructed processor. */
  function makeProcessor(sr: number, opts: { chunk: number; ahead: number; preroll: number }, clock: { t: number }, stats: unknown[]): Proc {
    let Ctor: (new (o: unknown) => Proc) | null = null;
    let name = '';
    class Base {
      port: ProcPort = { onmessage: null, postMessage: (m: unknown) => stats.push(m) };
    }
    const globals = { AudioWorkletProcessor: Base, registerProcessor: (n: string, c: new (o: unknown) => Proc) => ((name = n), (Ctor = c)), sampleRate: sr };
    // currentTime is read live: expose it through a getter on a scope object.
    const scope = Object.defineProperty({ ...globals }, 'currentTime', { get: () => clock.t });
    new Function('scope', `with (scope) {\n${STREAM_PROCESSOR_SOURCE}\n}`)(scope);
    expect(name).toBe(STREAM_PROCESSOR);
    return new (Ctor as unknown as new (o: unknown) => Proc)({ processorOptions: opts });
  }

  it('pulls chunks from the worker port, plays them back to back and recycles the arrays', () => {
    const sr = 1000;
    const chunk = 250;
    const clock = { t: 0 };
    const stats: unknown[] = [];
    const proc = makeProcessor(sr, { chunk, ahead: 1000, preroll: 500 }, clock, stats);
    const pulls: StreamToWorker[] = [];
    const workerPort: ProcPort = { onmessage: null, postMessage: (m: unknown) => pulls.push(m as StreamToWorker) };
    proc.port.onmessage!({ data: { t: 'port', port: workerPort } });
    expect(pulls.length).toBe(3); // at most 3 in flight
    let seq = 0;
    const answer = (): void => {
      const p = pulls.shift()!;
      const L = p.recycle ? p.recycle[0] : new Float32Array(p.frames);
      const R = p.recycle ? p.recycle[1] : new Float32Array(p.frames);
      for (let i = 0; i < p.frames; i++) {
        L[i] = seq * p.frames + i;
        R[i] = -(seq * p.frames + i);
      }
      seq++;
      workerPort.onmessage!({ data: { t: 'chunk', seq, frames: p.frames, L, R, ms: 2, stats: null } });
    };
    const outL = new Float32Array(128);
    const outR = new Float32Array(128);
    const played: number[] = [];
    let recycled = 0;
    for (let q = 0; q < 40; q++) {
      while (pulls.length) {
        if (pulls[0]!.recycle) recycled++;
        answer();
      }
      outL.fill(0);
      outR.fill(0);
      expect(proc.process([], [[outL, outR]])).toBe(true);
      for (let i = 0; i < 128; i++) {
        played.push(outL[i]!);
        expect(outR[i]).toBe(-outL[i]!);
      }
      clock.t += 128 / sr;
    }
    // Continuous ramp 0, 1, 2, ... across chunk boundaries: gapless, in order.
    for (let i = 0; i < played.length; i++) expect(played[i]).toBe(i);
    expect(recycled).toBeGreaterThan(5);
    const last = stats[stats.length - 1] as { t: string; underruns: number; chunks: number };
    expect(last.t).toBe('stats');
    expect(last.underruns).toBe(0);
    expect(last.chunks).toBeGreaterThan(20);
  });

  it('counts an underrun, outputs silence and pre-rolls again when the worker stalls', () => {
    const sr = 1000;
    const clock = { t: 0 };
    const stats: unknown[] = [];
    const proc = makeProcessor(sr, { chunk: 200, ahead: 600, preroll: 400 }, clock, stats);
    const pulls: StreamToWorker[] = [];
    const workerPort: ProcPort = { onmessage: null, postMessage: (m: unknown) => pulls.push(m as StreamToWorker) };
    proc.port.onmessage!({ data: { t: 'port', port: workerPort } });
    const answer = (): void => {
      const p = pulls.shift()!;
      workerPort.onmessage!({ data: { t: 'chunk', seq: 0, frames: p.frames, L: new Float32Array(p.frames).fill(0.5), R: new Float32Array(p.frames).fill(0.5), ms: 1, stats: null } });
    };
    answer(); // 200 frames < pre-roll: still silent
    const L = new Float32Array(128);
    const R = new Float32Array(128);
    proc.process([], [[L, R]]);
    expect(L[0]).toBe(0);
    answer(); // 400 frames: playing
    proc.process([], [[L, R]]);
    expect(L[0]).toBe(0.5);
    pulls.length = 0; // the worker stops answering
    for (let q = 0; q < 6; q++) {
      L.fill(0);
      proc.process([], [[L, R]]);
    }
    expect(L[127]).toBe(0);
    for (let q = 0; q < 10; q++) proc.process([], [[L, R]]); // flush a stats report
    const last = stats[stats.length - 1] as { underruns: number; prerolling: boolean };
    expect(last.underruns).toBe(1);
    expect(last.prerolling).toBe(true);
  });

  it('the music worker serves pulls arriving on a stream MessagePort', async () => {
    const out: FromWorker[] = [];
    const host = new WorkerHost((m) => out.push(m), (fn) => fn());
    host.onMessage({ t: 'init', role: 'music', sampleRate: 24000, seed: 3 });
    host.onMessage({ t: 'mood', mood: 'menu', intensity: 0.2 });
    const ch = new MessageChannel();
    host.onMessage({ t: 'stream', port: ch.port2 });
    const got = new Promise<Extract<FromWorker, { t: 'chunk' }>>((resolve) => {
      ch.port1.onmessage = (e: MessageEvent<FromWorker>) => {
        if (e.data.t === 'chunk') resolve(e.data);
      };
    });
    const pull: StreamToWorker = { t: 'pull', frames: 3000 };
    ch.port1.postMessage(pull);
    const chunk = await got;
    expect(chunk.frames).toBe(3000);
    expect(chunk.L.length).toBe(3000);
    expect(measure(chunk.L).nan).toBe(0);
    // Score stats go to the main thread (first chunk), not over the stream port.
    expect(out.some((m) => m.t === 'score')).toBe(true);
    ch.port1.close();
    ch.port2.close();
  });
});

describe('spatial model', () => {
  it('attenuates with distance, absorbs highs and sends more reverb far away', () => {
    expect(distanceGain(1, 10, 400, 1)).toBe(1);
    expect(distanceGain(20, 10, 400, 1)).toBeCloseTo(0.5, 5);
    expect(distanceGain(400, 10, 400, 1)).toBe(0);
    expect(distanceGain(800, 10, 400, 1, 4)).toBeGreaterThan(0); // strategic camera scale
    let prev = Infinity;
    for (const d of [0, 10, 50, 100, 300, 1000, 5000]) {
      const f = airAbsorptionHz(d);
      expect(f).toBeLessThanOrEqual(prev);
      prev = f;
    }
    expect(airAbsorptionHz(0)).toBe(20000);
    expect(reverbSend(0.1, 500, 10)).toBeGreaterThan(reverbSend(0.1, 20, 10));
  });

  it('computes listener-relative azimuth (+X east, +Z south) and thunder delays', () => {
    // Listener at the origin facing north (-Z): a source to the east is on the right.
    const l = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: -1 };
    expect(relativeAzimuth(l, 10, 0).azimuth).toBeCloseTo(Math.PI / 2, 5);
    expect(relativeAzimuth(l, 0, -10).azimuth).toBeCloseTo(0, 5);
    expect(Math.abs(relativeAzimuth(l, 0, 10).azimuth)).toBeCloseTo(Math.PI, 5);
    expect(thunderDelaySec(343 * 2.5, 0.5)).toBeCloseTo(2.5, 5);
    expect(thunderDelaySec(50, 0.5)).toBe(1);
    expect(thunderDelaySec(10000, 0.5)).toBe(4);
    const r = thunderDelaySec(null, 0.25);
    expect(r).toBeGreaterThanOrEqual(1);
    expect(r).toBeLessThanOrEqual(4);
  });
});

describe('cues', () => {
  it('map hero combat, sim and battle events to real sounds', () => {
    for (const k of ['hit', 'parry', 'perfect_dodge', 'guard_break', 'stagger', 'finisher'] as const) {
      const cues = heroCombatCues(k, 0.8);
      expect(cues.length, k).toBeGreaterThan(0);
      for (const c of cues) expect(ALL_SFX).toContain(c.sfx);
    }
    for (const kind of BATTLE_EVENT_KINDS) {
      const e: BattleEventRecord = { time: 0, kind, side: 0, formation: 0, other: null, x: 0, z: 0, value: null, text: null };
      const c = cuesForBattleEvent(e, 0);
      if (c.sfx) expect(SFX_KINDS).toContain(c.sfx);
    }
    expect(cuesForBattleEvent({ time: 0, kind: 'battle_ended', side: 1, formation: null, other: null, x: null, z: null, value: null, text: null }, 0).stinger).toBe('defeat');
    const age: SimEvent = { kind: 'age_advanced', factionId: 'heartland', age: 'mahajanapada', landmarkId: null, settlementId: null };
    expect(cuesForSimEvent(age, 'heartland').stinger).toBe('age_up');
    expect(cuesForSimEvent(age, 'highland').stinger).toBeNull();
    for (const l of battleBedLayers(400, 1000, 80)) expect(ambienceDef(l.key)).toBeDefined();
    expect(battleBedLayers(1000, 1000, 10)[0]!.gain).toBeGreaterThan(battleBedLayers(50, 1000, 10)[0]!.gain);
    for (const id of ALL_SFX) expect(SFX_GROUPS[id].length, id).toBeGreaterThan(0);
  });
});

describe('WebAudio adapters (fake context)', () => {
  it('schedules score chunks gaplessly on a sample-exact timeline (buffers mode)', async () => {
    const ctx = new FakeContext();
    const port = new FakePort();
    const out = new FakeNode();
    const stream = new MusicStream(ctx as unknown as AudioContext, port, out as unknown as AudioNode);
    stream.update();
    expect(port.sent.length).toBe(0); // nothing requested until a mode is picked
    // An inline port (or no AudioWorklet in node) falls back to scheduled buffers.
    expect(await stream.start(true)).toBe('buffers');
    stream.update();
    expect(port.sent.length).toBeGreaterThan(0);
    const n = stream.chunkFrames;
    // Pre-roll: nothing plays until 0.75 s is buffered, then the whole pre-roll is scheduled back to back.
    stream.onChunk(new Float32Array(n), new Float32Array(n), n, 3, null);
    expect(ctx.sources.length).toBe(0);
    for (let k = 0; k < 5; k++) stream.onChunk(new Float32Array(n), new Float32Array(n), n, 3, null);
    const starts = ctx.sources.map((s) => s.startedAt);
    expect(starts.length).toBe(6);
    for (let k = 1; k < starts.length; k++) expect(starts[k]! - starts[k - 1]!).toBeCloseTo(n / ctx.sampleRate, 9);
    expect(stream.underruns).toBe(0);
    // The context clock overtakes the timeline: an underrun is counted, a new pre-roll collected, re-based.
    ctx.currentTime = starts[starts.length - 1]! + 5;
    for (let k = 0; k < 3; k++) stream.onChunk(new Float32Array(n), new Float32Array(n), n, 3, null);
    expect(stream.underruns).toBe(1);
    expect(ctx.sources.length).toBe(9);
    expect(ctx.sources[ctx.sources.length - 3]!.startedAt).toBeGreaterThan(ctx.currentTime);
  });

  it('a trigger creates exactly one node (the buffer source) after warm-up', () => {
    const ctx = new FakeContext();
    const bus = new FakeNode();
    const player = new VoicePlayer(ctx as unknown as AudioContext, 'spatial', 8, bus as unknown as AudioNode, bus as unknown as AudioNode, true);
    const buf = ctx.createBuffer(1, 4800, 48000) as unknown as AudioBuffer;
    const p = makePlayParams();
    p.buffer = buf;
    p.kind = 'clash';
    p.maxInstances = 99;
    const before = ctx.total();
    for (let i = 0; i < 20; i++) {
      ctx.currentTime += 0.05;
      p.x = i;
      p.y = 0;
      p.z = -5;
      expect(player.play(p)).toBe(true);
    }
    expect(ctx.total() - before).toBe(20);
    expect(ctx.created.source).toBe(20);
    // Cap 8: the pool never holds more than 8 voices.
    expect(player.active(ctx.currentTime)).toBeLessThanOrEqual(8);
  });
});
