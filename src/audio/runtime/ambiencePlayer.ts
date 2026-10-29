/**
 * Ambience player (WebAudio adapter): for every active layer, a looped bed played by two sources half a
 * loop apart (panned left / right -> decorrelated stereo from one mono loop) through a smoothly faded
 * layer gain, plus spot one-shots scheduled as a Poisson process and placed around the listener
 * (random azimuth / distance / height from the spot spec) through the spatial ambience voice pool.
 * Layers that stay silent are torn down; their beds are released from the bank after a while.
 * OWNER: Audio Developer (AUD-01).
 */
import { type AmbienceDef, ambienceDef, bedId, firstSpotDelay, SPOT_ROLLOFF, spotId } from '../ambience/meta';
import { dbToGain } from '../synth/core';
import { airAbsorptionHz, distanceGain, type ListenerPose, reverbSend } from '../spatial/model';
import type { SoundBank } from './bank';
import type { Mixer } from './mixer';
import { makePlayParams, type VoicePlayer } from './voicePlayer';

interface Layer {
  key: string;
  def: AmbienceDef;
  target: number;
  bedKey: string;
  spotKeys: string[];
  gain: GainNode | null;
  srcA: AudioBufferSourceNode | null;
  srcB: AudioBufferSourceNode | null;
  panA: StereoPannerNode | null;
  panB: StereoPannerNode | null;
  nextSpot: Float64Array;
  silentSince: number;
  started: number;
}

export class AmbiencePlayer {
  private readonly layers = new Map<string, Layer>();
  private readonly params = makePlayParams();
  /** Spot variants requested per spot (tier). */
  spotVariants = 3;
  spotsPlayed = 0;

  constructor(
    private readonly ctx: AudioContext,
    private readonly mixer: Mixer,
    private readonly bank: SoundBank,
    private readonly voices: VoicePlayer,
  ) {}

  /** Set the target gain of a layer (0 fades it out). Unknown keys are ignored (reported once by the caller). */
  setTarget(key: string, gain: number): boolean {
    let l = this.layers.get(key);
    if (!l) {
      if (gain <= 0.001) return true;
      const def = ambienceDef(key);
      if (!def) return false;
      l = {
        key,
        def,
        target: 0,
        bedKey: bedId(key),
        spotKeys: def.spots.map((s) => spotId(key, s.name)),
        gain: null,
        srcA: null,
        srcB: null,
        panA: null,
        panB: null,
        nextSpot: new Float64Array(def.spots.length),
        silentSince: -1,
        started: this.ctx.currentTime,
      };
      const now = this.ctx.currentTime;
      def.spots.forEach((s, i) => (l!.nextSpot[i] = now + firstSpotDelay(s, Math.random())));
      this.layers.set(key, l);
      if (def.bed) this.bank.request(l.bedKey, 1, 82);
      l.spotKeys.forEach((k, i) => this.bank.request(k, Math.min(this.spotVariants, (def.spots[i] as { variants: number }).variants), 70));
    }
    const g = Math.max(0, Math.min(1.5, gain));
    if (Math.abs(g - l.target) < 0.01 && !(g === 0 && l.target > 0)) return true;
    l.target = g;
    if (l.gain && l.def.bed) {
      const now = this.ctx.currentTime;
      l.gain.gain.cancelScheduledValues(now);
      l.gain.gain.setTargetAtTime(l.target * dbToGain(l.def.bed.gainDb), now, l.target > 0 ? 0.9 : 1.4);
    }
    return true;
  }

  /** Every layer not in `keep` fades out. */
  fadeAllExcept(keep: ReadonlySet<string>): void {
    for (const l of this.layers.values()) if (!keep.has(l.key) && l.target > 0) this.setTarget(l.key, 0);
  }

  get activeLayers(): number {
    let n = 0;
    for (const l of this.layers.values()) if (l.target > 0.001) n++;
    return n;
  }

  /** For stats / the lab: current targets. */
  snapshot(out: { key: string; gain: number }[]): void {
    out.length = 0;
    for (const l of this.layers.values()) if (l.target > 0.001) out.push({ key: l.key, gain: +l.target.toFixed(3) });
  }

  update(listener: ListenerPose): void {
    const now = this.ctx.currentTime;
    for (const l of this.layers.values()) {
      // Bed.
      if (l.def.bed && !l.srcA && l.target > 0.001) this.startBed(l);
      // Spots.
      if (l.target > 0.02) {
        l.silentSince = -1;
        for (let i = 0; i < l.def.spots.length; i++) {
          if (now < (l.nextSpot[i] as number)) continue;
          const spec = l.def.spots[i]!;
          this.playSpot(l, i, listener);
          const rate = (spec.perMinute / 60) * Math.max(0.25, Math.min(1.5, l.target));
          l.nextSpot[i] = now - Math.log(1 - Math.random()) / rate;
        }
      } else if (l.silentSince < 0) {
        l.silentSince = now;
      } else if (now - l.silentSince > 4) {
        this.stopBed(l);
        if (now - l.silentSince > 60) {
          this.bank.release(l.bedKey);
          for (const k of l.spotKeys) this.bank.release(k);
          this.layers.delete(l.key);
        }
      }
    }
  }

  private startBed(l: Layer): void {
    const buf = this.bank.get(l.bedKey, 0);
    if (!buf || !l.def.bed) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(l.target * dbToGain(l.def.bed.gainDb), now, 1.2);
    g.connect(this.mixer.ambience);
    const make = (offset: number, pan: number): [AudioBufferSourceNode, StereoPannerNode] => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      s.connect(p).connect(g);
      s.start(now + 0.02, offset);
      return [s, p];
    };
    [l.srcA, l.panA] = make(Math.random() * buf.duration * 0.2, -0.7);
    [l.srcB, l.panB] = make((buf.duration * (0.5 + Math.random() * 0.1)) % buf.duration, 0.7);
    l.gain = g;
  }

  private stopBed(l: Layer): void {
    if (!l.srcA) return;
    const now = this.ctx.currentTime;
    for (const s of [l.srcA, l.srcB]) {
      try {
        s?.stop(now);
      } catch {
        /* stopped */
      }
    }
    l.gain?.disconnect();
    l.srcA = null;
    l.srcB = null;
    l.panA = null;
    l.panB = null;
    l.gain = null;
  }

  private playSpot(l: Layer, i: number, li: ListenerPose): void {
    const spec = l.def.spots[i]!;
    const key = l.spotKeys[i]!;
    const buf = this.bank.pick(key);
    if (!buf) return;
    const d = spec.distance[0] + (spec.distance[1] - spec.distance[0]) * Math.random();
    const az = (Math.random() * 2 - 1) * Math.PI;
    const h = spec.height ? spec.height[0] + (spec.height[1] - spec.height[0]) * Math.random() : 0;
    const gDb = spec.gainDb[0] + (spec.gainDb[1] - spec.gainDb[0]) * Math.random();
    const near = spec.distance[0];
    const p = this.params;
    p.kind = key;
    p.priority = 12;
    p.buffer = buf;
    p.gain = dbToGain(gDb) * Math.min(1.2, l.target) * distanceGain(d, near, spec.distance[1] * 4, SPOT_ROLLOFF);
    p.rate = Math.pow(2, ((Math.random() * 2 - 1) * 60) / 1200);
    p.when = 0;
    p.maxInstances = 2;
    p.minIntervalMs = 150;
    // World position around the listener (azimuth relative to world +Z; the panner does the rest).
    p.x = li.x + Math.sin(az) * d;
    p.y = li.y + h;
    p.z = li.z + Math.cos(az) * d;
    p.lowpass = airAbsorptionHz(d);
    p.send = reverbSend(0.15, d, near) * 0.8;
    if (this.voices.play(p)) this.spotsPlayed++;
  }

  dispose(): void {
    for (const l of this.layers.values()) this.stopBed(l);
    this.layers.clear();
  }
}
