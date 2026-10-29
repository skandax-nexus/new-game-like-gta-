/**
 * Pooled voice chains (WebAudio adapter over the pure VoicePool). Every slot owns its nodes for the
 * lifetime of the pool; a trigger creates exactly one AudioBufferSourceNode (WebAudio sources are
 * single-use) and touches no other allocation.
 *   spatial: source -> low-pass (air absorption) -> gain -> PannerNode (HRTF high/ultra, equal-power
 *            low/medium; distance handled by our model, rolloff 0) -> bus; gain -> send -> reverb
 *   flat:    source -> gain -> StereoPanner -> (ui | sfx) routing gains; gain -> send -> reverb
 * A stolen slot fades its old source out over ~15 ms and starts the new one right after.
 * OWNER: Audio Developer (AUD-01).
 */
import { VoicePool } from '../spatial/voices';

export interface PlayParams {
  kind: string;
  priority: number;
  buffer: AudioBuffer | null;
  gain: number;
  rate: number;
  /** AudioContext time; 0 = now. */
  when: number;
  maxInstances: number;
  minIntervalMs: number;
  /** Flat pools: stereo pan -1..1. */
  pan: number;
  /** Flat pools: route to the UI bus instead of SFX. */
  ui: boolean;
  /** Spatial pools: world position (NaN x = place in front of the listener). */
  x: number;
  y: number;
  z: number;
  /** Low-pass corner (Hz) for air absorption. */
  lowpass: number;
  /** Reverb send 0..1. */
  send: number;
}

export function makePlayParams(): PlayParams {
  return { kind: '', priority: 50, buffer: null, gain: 1, rate: 1, when: 0, maxInstances: 4, minIntervalMs: 0, pan: 0, ui: false, x: Number.NaN, y: 0, z: 0, lowpass: 20000, send: 0 };
}

interface Chain {
  filter: BiquadFilterNode | null;
  gain: GainNode;
  panner: PannerNode | null;
  stereo: StereoPannerNode | null;
  toUi: GainNode | null;
  toSfx: GainNode | null;
  send: GainNode;
  source: AudioBufferSourceNode | null;
  end: number;
}

export type PoolKind = 'spatial' | 'flat';

export class VoicePlayer {
  readonly pool: VoicePool;
  private chains: Chain[] = [];
  private hrtf: boolean;
  /** Triggers that were played / merged or refused. */
  played = 0;

  constructor(
    private readonly ctx: AudioContext,
    readonly kind: PoolKind,
    cap: number,
    private readonly out: AudioNode,
    private readonly sendBus: AudioNode,
    hrtf: boolean,
    private readonly uiOut: AudioNode | null = null,
  ) {
    this.hrtf = hrtf;
    this.pool = new VoicePool(cap);
    this.ensureChains(cap);
  }

  private makeChain(): Chain {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const send = ctx.createGain();
    send.gain.value = 0;
    gain.connect(send).connect(this.sendBus);
    if (this.kind === 'spatial') {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 20000;
      filter.Q.value = 0.5;
      const panner = ctx.createPanner();
      panner.panningModel = this.hrtf ? 'HRTF' : 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = 1;
      panner.rolloffFactor = 0;
      panner.maxDistance = 100000;
      filter.connect(gain).connect(panner).connect(this.out);
      return { filter, gain, panner, stereo: null, toUi: null, toSfx: null, send, source: null, end: 0 };
    }
    const stereo = ctx.createStereoPanner();
    const toSfx = ctx.createGain();
    const toUi = ctx.createGain();
    gain.connect(stereo);
    stereo.connect(toSfx).connect(this.out);
    stereo.connect(toUi).connect(this.uiOut ?? this.out);
    return { filter: null, gain, panner: null, stereo, toUi, toSfx, send, source: null, end: 0 };
  }

  private ensureChains(cap: number): void {
    while (this.chains.length < cap) this.chains.push(this.makeChain());
  }

  resize(cap: number): void {
    this.pool.resize(cap);
    this.ensureChains(cap);
  }

  setHrtf(on: boolean): void {
    if (this.hrtf === on) return;
    this.hrtf = on;
    for (const c of this.chains) if (c.panner) c.panner.panningModel = on ? 'HRTF' : 'equalpower';
  }

  active(now = this.ctx.currentTime): number {
    return this.pool.active(now);
  }

  /** Play a buffer through a pooled chain. Returns false when merged / refused by the pool. */
  play(p: PlayParams): boolean {
    const buf = p.buffer;
    if (!buf) return false;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const when = Math.max(now, p.when);
    const dur = buf.duration / Math.max(0.05, p.rate);
    const slot = this.pool.allocate({ kind: p.kind, priority: p.priority, now: when, duration: dur, gain: p.gain, maxInstances: p.maxInstances, minIntervalMs: p.minIntervalMs });
    if (slot < 0) return false;
    const c = this.chains[slot] as Chain;
    let start = when;
    const g = c.gain.gain;
    g.cancelScheduledValues(when);
    if (c.source && c.end > when) {
      // Steal: quick fade of the old voice, then the new one.
      g.setValueAtTime(g.value, when);
      g.linearRampToValueAtTime(0, when + 0.015);
      try {
        c.source.stop(when + 0.016);
      } catch {
        /* already stopped */
      }
      start = when + 0.018;
    }
    g.setValueAtTime(p.gain, start);
    c.send.gain.setValueAtTime(p.send, start);
    if (c.filter) c.filter.frequency.setValueAtTime(p.lowpass, start);
    if (c.panner) {
      if (Number.isNaN(p.x)) {
        // Non-positional in a spatial pool: just in front of the listener.
        const l = ctx.listener;
        const lx = l.positionX ? l.positionX.value : 0;
        const ly = l.positionY ? l.positionY.value : 0;
        const lz = l.positionZ ? l.positionZ.value : 0;
        const fx = l.forwardX ? l.forwardX.value : 0;
        const fz = l.forwardZ ? l.forwardZ.value : -1;
        setPos(c.panner, lx + fx * 2 + -fz * p.pan * 2, ly, lz + fz * 2 + fx * p.pan * 2);
      } else setPos(c.panner, p.x, p.y, p.z);
    }
    if (c.stereo) {
      c.stereo.pan.setValueAtTime(Math.max(-1, Math.min(1, p.pan)), start);
      (c.toUi as GainNode).gain.setValueAtTime(p.ui ? 1 : 0, start);
      (c.toSfx as GainNode).gain.setValueAtTime(p.ui ? 0 : 1, start);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = p.rate;
    src.connect(c.filter ?? c.gain);
    src.start(start);
    c.source = src;
    c.end = start + dur;
    this.played++;
    return true;
  }

  stopAll(): void {
    const now = this.ctx.currentTime;
    for (const c of this.chains) {
      if (c.source) {
        try {
          c.source.stop(now);
        } catch {
          /* already stopped */
        }
        c.source = null;
      }
      c.end = 0;
    }
    this.pool.clear();
  }
}

function setPos(p: PannerNode, x: number, y: number, z: number): void {
  if (p.positionX) {
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
  } else {
    (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(x, y, z);
  }
}
