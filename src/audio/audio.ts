/**
 * Procedural WebAudio: ambience beds, war drums, UI + battle SFX (no audio files).
 * OWNER: Lead UI/UX Engineer (audio developer). Baseline by the CTO.
 *
 * Listens to the bus: 'audio:sfx' (one-shots), 'audio:mood' (ambience/music intensity).
 * The AudioContext starts suspended and is resumed on the first user gesture (browser policy).
 *
 * TODO(owner): raga-inspired drone/tanpura bed + percussion (mridangam/dhol-like patterns) that
 * intensify with battle size, conch shells and horns at charges, elephant trumpets, distance-based
 * mixing of battle sounds from SoldierBuffers, monsoon rain ambience, positional audio.
 */
import type { GameBus, SfxKind } from '../core/events';
import type { GameSettings } from '../core/types';

type Mood = 'menu' | 'world' | 'battle' | 'city' | 'victory' | 'defeat';

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private ambBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private windSrc: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  private droneOsc: OscillatorNode[] = [];
  private droneGain: GainNode | null = null;
  private drumTimer: ReturnType<typeof setInterval> | null = null;
  private mood: Mood = 'menu';
  private intensity = 0;
  private readonly offs: (() => void)[] = [];

  constructor(
    bus: GameBus,
    private settings: GameSettings,
    readonly disabled: boolean,
  ) {
    if (disabled) return;
    this.offs.push(bus.on('audio:sfx', (e) => this.play(e.sfx, e.volume ?? 1, e.pan ?? 0)));
    this.offs.push(bus.on('audio:mood', (e) => this.setMood(e.mood, e.intensity)));
    const resume = (): void => {
      this.ensure();
      void this.ctx?.resume();
    };
    window.addEventListener('pointerdown', resume, { once: false, passive: true });
    window.addEventListener('keydown', resume, { once: false });
  }

  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  private ensure(): void {
    if (this.ctx || this.disabled) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.ambBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    for (const b of [this.sfxBus, this.ambBus, this.musicBus]) b.connect(this.master);
    const len = ctx.sampleRate * 2;
    this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    this.startBeds();
    this.setMood(this.mood, this.intensity);
  }

  setSettings(s: GameSettings): void {
    this.settings = s;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.master) return;
    const s = this.settings;
    this.master.gain.value = s.masterVolume;
    this.sfxBus!.gain.value = s.sfxVolume;
    this.ambBus!.gain.value = s.ambienceVolume;
    this.musicBus!.gain.value = s.musicVolume;
  }

  private startBeds(): void {
    const ctx = this.ctx!;
    // Wind bed: looped noise through a slowly modulated low-pass.
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain).connect(lp.frequency);
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.05;
    src.connect(lp).connect(this.windGain).connect(this.ambBus!);
    src.start();
    lfo.start();
    this.windSrc = src;
    // Drone (tanpura-like fifths) for menu/world music bed.
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.droneGain.connect(this.musicBus!);
    for (const f of [110, 164.81, 220]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const flt = ctx.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.value = 700;
      const g = ctx.createGain();
      g.gain.value = 0.05;
      o.connect(flt).connect(g).connect(this.droneGain);
      o.start();
      this.droneOsc.push(o);
    }
  }

  setMood(mood: Mood, intensity: number): void {
    this.mood = mood;
    this.intensity = intensity;
    const ctx = this.ctx;
    if (!ctx || !this.droneGain || !this.windGain) return;
    const t = ctx.currentTime;
    const drone = mood === 'menu' ? 0.5 : mood === 'world' || mood === 'city' ? 0.25 : mood === 'battle' ? 0.12 : 0.4;
    this.droneGain.gain.setTargetAtTime(drone, t, 1.5);
    this.windGain.gain.setTargetAtTime(mood === 'battle' ? 0.03 : 0.06, t, 1.5);
    if (this.drumTimer) clearInterval(this.drumTimer);
    this.drumTimer = null;
    if (mood === 'battle') {
      let beat = 0;
      this.drumTimer = setInterval(() => {
        const accent = beat % 4 === 0;
        if (beat % 2 === 0 || this.intensity > 0.5) this.play('drum_hit', accent ? 0.8 : 0.45 * (0.5 + this.intensity), 0);
        beat++;
      }, 420 - Math.round(this.intensity * 140));
    }
  }

  /** Synthesize a one-shot. */
  play(kind: SfxKind, volume = 1, pan = 0): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.sfxBus) return;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = volume;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(panner).connect(this.sfxBus);
    const tone = (freq: number, dur: number, type: OscillatorType, gain: number, glide = 0): void => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + glide), t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + dur + 0.05);
    };
    const noise = (dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass'): void => {
      const s = ctx.createBufferSource();
      s.buffer = this.noiseBuffer;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f).connect(g).connect(out);
      s.start(t, Math.random());
      s.stop(t + dur + 0.05);
    };
    switch (kind) {
      case 'ui_click':
      case 'ui_hover':
        tone(kind === 'ui_hover' ? 1400 : 900, 0.06, 'triangle', kind === 'ui_hover' ? 0.03 : 0.08);
        break;
      case 'ui_open':
      case 'ui_confirm':
        tone(660, 0.12, 'triangle', 0.08);
        tone(990, 0.18, 'sine', 0.05);
        break;
      case 'ui_close':
        tone(520, 0.1, 'triangle', 0.06, -200);
        break;
      case 'ui_error':
        tone(180, 0.2, 'square', 0.05);
        break;
      case 'notify':
      case 'bell':
        tone(1320, 0.8, 'sine', 0.06);
        tone(1980, 0.5, 'sine', 0.03);
        break;
      case 'order_ack':
      case 'conch':
        tone(233, kind === 'conch' ? 1.4 : 0.35, 'sawtooth', 0.05, 8);
        tone(466, kind === 'conch' ? 1.2 : 0.3, 'sine', 0.03);
        break;
      case 'charge_horn':
        tone(196, 1.2, 'sawtooth', 0.07, 60);
        break;
      case 'drum_hit':
        tone(70, 0.35, 'sine', 0.35, -30);
        noise(0.08, 1800, 0.8, 0.15);
        break;
      case 'arrow_volley':
        noise(0.9, 3200, 0.6, 0.12, 'highpass');
        break;
      case 'arrow_impact':
        noise(0.12, 1200, 2, 0.1);
        break;
      case 'clash':
        noise(0.18, 2600, 4, 0.18);
        tone(1800 + Math.random() * 900, 0.15, 'square', 0.02);
        break;
      case 'elephant_trumpet':
        tone(520, 0.9, 'sawtooth', 0.08, 300);
        break;
      case 'horse_neigh':
        tone(700, 0.6, 'sawtooth', 0.04, -300);
        break;
      case 'cheer':
      case 'rout_cry':
        noise(1.2, kind === 'cheer' ? 900 : 600, 0.7, 0.12);
        break;
      case 'build':
      case 'coins':
      case 'harvest':
        tone(880, 0.1, 'triangle', 0.06);
        tone(1320, 0.14, 'triangle', 0.05);
        break;
      case 'thunder':
        noise(2.5, 120, 0.5, 0.5, 'lowpass');
        break;
      case 'march':
        noise(0.15, 300, 1, 0.08, 'lowpass');
        break;
    }
  }

  dispose(): void {
    for (const off of this.offs) off();
    if (this.drumTimer) clearInterval(this.drumTimer);
    this.windSrc?.stop();
    for (const o of this.droneOsc) o.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}
