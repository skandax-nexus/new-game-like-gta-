/**
 * WebAudio mix graph (thin adapter):
 *
 *   score chunks ─► musicDuck ─┐
 *   stingers ──────────────────┴► music ─┐
 *   sfx voices ─► slowmo LPF ─► sfx ─────┤
 *   ui voices ─────────────────► ui ─────┼─► master ─► limiter ─► analyser ─► destination
 *   ambience beds / spots ────► ambience ┤
 *   voice sends ─► sfxSend / ambSend ─► convolver (procedural IR) ─► reverbReturn ┘
 *
 * Bus volumes follow GameSettings (UI uses sfxVolume until a dedicated setting exists). Ducking keeps the
 * deepest active request; the slow-motion effect dips the SFX low-pass for a perfect dodge.
 * OWNER: Audio Developer (AUD-01).
 */
import type { GameSettings } from '../../core/types';

interface Duck {
  db: number;
  until: number;
}

export class Mixer {
  readonly master: GainNode;
  readonly limiter: DynamicsCompressorNode;
  readonly analyser: AnalyserNode;
  readonly music: GainNode;
  readonly musicDuck: GainNode;
  readonly stingers: GainNode;
  readonly sfx: GainNode;
  readonly sfxFilter: BiquadFilterNode;
  readonly sfxIn: GainNode;
  readonly ui: GainNode;
  readonly ambience: GainNode;
  readonly sfxSend: GainNode;
  readonly ambSend: GainNode;
  private readonly convolver: ConvolverNode;
  private readonly reverbReturn: GainNode;
  /** Preallocated duck requests; the first `duckCount` are active (no allocation per request). */
  private readonly ducks: Duck[] = Array.from({ length: 8 }, () => ({ db: 0, until: 0 }));
  private duckCount = 0;
  private duckDb = 0;
  private slowmoUntil = 0;
  private slowmoOn = false;
  private hasIr = false;

  constructor(private readonly ctx: AudioContext) {
    this.master = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -4;
    this.limiter.knee.value = 4;
    this.limiter.ratio.value = 16;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.18;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.6;
    this.master.connect(this.limiter).connect(this.analyser).connect(ctx.destination);

    this.music = ctx.createGain();
    this.musicDuck = ctx.createGain();
    this.stingers = ctx.createGain();
    this.musicDuck.connect(this.music);
    this.stingers.connect(this.music);
    this.music.connect(this.master);

    this.sfxIn = ctx.createGain();
    this.sfxFilter = ctx.createBiquadFilter();
    this.sfxFilter.type = 'lowpass';
    this.sfxFilter.frequency.value = 20000;
    this.sfxFilter.Q.value = 0.5;
    this.sfx = ctx.createGain();
    this.sfxIn.connect(this.sfxFilter).connect(this.sfx).connect(this.master);

    this.ui = ctx.createGain();
    this.ui.connect(this.master);
    this.ambience = ctx.createGain();
    this.ambience.connect(this.master);

    this.convolver = ctx.createConvolver();
    this.convolver.normalize = false;
    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = 0.5;
    this.sfxSend = ctx.createGain();
    this.ambSend = ctx.createGain();
    this.sfxSend.connect(this.convolver);
    this.ambSend.connect(this.convolver);
    this.convolver.connect(this.reverbReturn).connect(this.master);
  }

  get hasReverb(): boolean {
    return this.hasIr;
  }

  setImpulse(ir: AudioBuffer): void {
    this.convolver.buffer = ir;
    this.hasIr = true;
  }

  setVolumes(s: GameSettings): void {
    const t = this.ctx.currentTime;
    const set = (p: AudioParam, v: number): void => {
      p.cancelScheduledValues(t);
      p.setTargetAtTime(Math.max(0, Math.min(1, v)), t, 0.05);
    };
    set(this.master.gain, s.masterVolume);
    set(this.music.gain, s.musicVolume);
    set(this.sfx.gain, s.sfxVolume);
    set(this.sfxSend.gain, s.sfxVolume);
    set(this.ui.gain, s.sfxVolume * 0.9);
    set(this.ambience.gain, s.ambienceVolume);
    set(this.ambSend.gain, s.ambienceVolume);
  }

  /** Duck the score by `db` (negative) for `holdSec` from now. */
  duck(db: number, holdSec: number): void {
    if (db >= 0) return;
    const until = this.ctx.currentTime + holdSec;
    for (let i = 0; i < this.duckCount; i++) {
      const d = this.ducks[i] as Duck;
      if (d.db === db) {
        d.until = Math.max(d.until, until);
        return;
      }
    }
    if (this.duckCount < this.ducks.length) {
      const d = this.ducks[this.duckCount++] as Duck;
      d.db = db;
      d.until = until;
    }
  }

  /** Perfect-dodge slow motion: muffle the world for `sec`. */
  slowmo(sec: number): void {
    this.slowmoUntil = Math.max(this.slowmoUntil, this.ctx.currentTime + sec);
  }

  /** Per frame: apply the deepest active duck and the slow-mo filter (AudioParam automation only on change). */
  update(dialogue: boolean): void {
    const now = this.ctx.currentTime;
    let deepest = dialogue ? -9 : 0;
    for (let i = this.duckCount - 1; i >= 0; i--) {
      const d = this.ducks[i] as Duck;
      if (d.until <= now) {
        // Swap with the last active request (object reuse, no allocation).
        const last = this.ducks[this.duckCount - 1] as Duck;
        this.ducks[i] = last;
        this.ducks[this.duckCount - 1] = d;
        this.duckCount--;
      } else if (d.db < deepest) deepest = d.db;
    }
    if (deepest !== this.duckDb) {
      const down = deepest < this.duckDb;
      this.duckDb = deepest;
      const g = Math.pow(10, deepest / 20);
      this.musicDuck.gain.cancelScheduledValues(now);
      this.musicDuck.gain.setTargetAtTime(g, now, down ? 0.04 : 0.45);
    }
    const slow = now < this.slowmoUntil;
    if (slow !== this.slowmoOn) {
      this.slowmoOn = slow;
      this.sfxFilter.frequency.cancelScheduledValues(now);
      this.sfxFilter.frequency.setTargetAtTime(slow ? 900 : 20000, now, slow ? 0.03 : 0.25);
    }
  }

  dispose(): void {
    try {
      this.master.disconnect();
    } catch {
      /* already disconnected */
    }
  }
}
