/**
 * AudioManager: the game's procedural audio director (no audio files - everything is synthesized).
 * OWNER: Audio Developer (AUD-01), reporting to the Lead UI/UX Engineer (audio). Baseline API by the CTO.
 *
 * Bus input (scenes / UI emit, nothing else needed):
 *   'audio:sfx'       one-shot SFX_KINDS entry; `position` -> spatial (HRTF on high/ultra), else `pan`
 *   'audio:mood'      score mood + intensity (alap -> jor -> gat, war layer)          -> music worker
 *   'audio:stinger'   musical stinger over the score (ducks the score; cues the engine)
 *   'audio:ambience'  scene ambience layers (HeroDistrictDef.ambience keys, world / battle beds)
 *   'audio:listener'  camera pose for spatial audio (~10 Hz)
 *   'hero:combat'     hit / parry / perfect dodge / guard break / stagger / finisher -> SFX (cues.ts)
 *   'battle:events'   engagement meter for the automatic battle bed
 *   'world:tick'      hour of day for world beds and the raga of the hour (unless setEnvironment is used)
 *   'settings:changed' / 'quality:changed'   bus volumes / voice cap + HRTF + variant counts
 * Direct API (ctx.audio): setEnvironment, setMusicContext, setDialogue, playAt, stinger, stats,
 * attachProfiler, resume - see the method docs.
 *
 * Threads: two instances of one inline Web Worker - 'music' streams the ScoreEngine in 0.25 s chunks
 * (scheduled gaplessly ~1 s ahead), 'bank' renders SFX variants, ambience beds / spots, stingers and the
 * reverb impulse response. The main thread only schedules nodes: bus handlers enqueue into a ring buffer,
 * update() (own rAF, measured as profiler system 'audio') drains it. No allocation per SFX trigger besides
 * the unavoidable AudioBufferSourceNode.
 * The AudioContext starts suspended and resumes on the first user gesture; ?noaudio=1 disables all of it.
 */
import { AUDIO_STINGERS, type AudioMood, type AudioStinger, type GameBus, type SfxKind } from '../core/events';
import { SEASONS, type EnvironmentState, type GameSettings, type QualitySettings, type QualityTier } from '../core/types';
import type { Profiler } from '../core/profiler';
import { type AmbienceLayer, ambienceDef, worldBedLayers } from './ambience/meta';
import { battleBedLayers, heroCombatCues, type SfxCue } from './cues';
import { flavourFromAmbience, type MusicContext } from './music/moods';
import type { ScoreStats } from './music/engine';
import { ALL_SFX, SFX_GROUPS, SFX_META, type SfxGroup, type SfxSoundId, variantsForTier } from './sfx/meta';
import { dbToGain } from './synth/core';
import { airAbsorptionHz, DEFAULT_LISTENER, distance3, distanceGain, type ListenerPose, reverbSend, thunderDelaySec } from './spatial/model';
import { splitVoiceCap } from './spatial/voices';
import { AmbiencePlayer } from './runtime/ambiencePlayer';
import { SoundBank } from './runtime/bank';
import { Mixer } from './runtime/mixer';
import { MusicStream } from './runtime/musicStream';
import type { FromWorker } from './runtime/protocol';
import { createRenderPort, type RenderPort, type WorkerFactory } from './runtime/renderPort';
import { makePlayParams, VoicePlayer } from './runtime/voicePlayer';
import { createAudioWorker } from './runtime/workerFactory';

/** CORE-01 compile-fix kept: the bus mood union. */
type Mood = AudioMood;

export interface AudioManagerOptions {
  profiler?: Profiler | null;
  /** Worker factory (null = run the renderers inline on the main thread). */
  workerFactory?: WorkerFactory | null;
  /** Stream the score through an AudioWorklet fed directly by the music worker (default true). */
  worklet?: boolean;
  /** Variation seed (default: random per session). */
  seed?: number;
}

export interface AudioStats {
  enabled: boolean;
  state: AudioContextState | 'none';
  sampleRate: number;
  tier: QualityTier;
  hrtf: boolean;
  voices: { sfx: number; ambience: number; flat: number; cap: number; stolen: number; rejected: number };
  triggers: number;
  bank: { keys: number; mb: number; renders: number; renderMs: number };
  music: { mood: Mood; intensity: number; stream: 'pending' | 'worklet' | 'buffers'; bufferedSec: number; underruns: number; chunks: number; workerMsPerChunk: number; latencyMs: number; maxLatencyMs: number; score: ScoreStats | null };
  ambience: { key: string; gain: number }[];
  mainMs: { last: number; avg: number; max: number };
  /** Main-thread time spent handling worker messages (AudioBuffer creation / chunk scheduling). */
  messages: { sound: number; chunk: number; soundMs: number; chunkMs: number; maxMs: number };
  workers: 'worker' | 'inline' | 'none';
}

const RING = 128;
const AUDIO_STINGER_LIST: readonly AudioStinger[] = AUDIO_STINGERS;
const SFX_INDEX = new Map<string, number>(ALL_SFX.map((k, i) => [k, i]));
const SFX_KEYS: readonly string[] = ALL_SFX.map((k) => `sfx:${k}`);
const UI_FIRST: readonly SfxSoundId[] = ['ui_click', 'ui_hover', 'ui_open', 'ui_close', 'ui_confirm', 'ui_error', 'notify', 'order_ack'];
/**
 * Stingers kept rendered per mood (others are released: a stereo stinger costs 1.4-3 MB). The first one is
 * urgent where it opens the mood (battle start conch, duel phase bells); the rest render after the SFX.
 */
const STINGERS_FOR: Record<Mood, readonly AudioStinger[]> = {
  menu: ['construction_complete'],
  world: ['construction_complete', 'harvest', 'age_up', 'landmark_complete'],
  city: ['construction_complete', 'harvest', 'age_up', 'landmark_complete'],
  battle: ['battle_start', 'victory', 'defeat', 'construction_complete'],
  siege: ['battle_start', 'victory', 'defeat', 'construction_complete'],
  hero_explore: ['mission_success', 'mission_failure', 'duel_phase', 'construction_complete'],
  hero_combat: ['mission_success', 'mission_failure', 'duel_phase', 'construction_complete'],
  duel: ['duel_phase', 'mission_success', 'mission_failure', 'construction_complete'],
  victory: ['victory', 'construction_complete'],
  defeat: ['defeat', 'construction_complete'],
};
const URGENT_STINGER: Partial<Record<Mood, AudioStinger>> = { battle: 'battle_start', siege: 'battle_start', duel: 'duel_phase', victory: 'victory', defeat: 'defeat' };
const IR_SECONDS: Record<QualityTier, number> = { low: 1.2, medium: 1.8, high: 2.4, ultra: 3 };
/** SFX groups kept rendered per mood (UI always). */
const GROUPS_FOR: Record<Mood, readonly SfxGroup[]> = {
  menu: ['ui'],
  world: ['ui', 'world'],
  city: ['ui', 'world'],
  battle: ['ui', 'battle'],
  siege: ['ui', 'battle'],
  hero_explore: ['ui', 'hero'],
  hero_combat: ['ui', 'hero'],
  duel: ['ui', 'hero'],
  victory: ['ui', 'battle', 'world'],
  defeat: ['ui', 'battle', 'world'],
};

/** How much larger the audible world is per mood (strategic camera far above the map). */
const DISTANCE_SCALE: Record<Mood, number> = { menu: 3, world: 5, city: 3, battle: 2.5, siege: 2.5, hero_explore: 1, hero_combat: 1, duel: 1, victory: 2.5, defeat: 2.5 };

export class AudioManager {
  private ctx: AudioContext | null = null;
  private mixer: Mixer | null = null;
  private bankPort: RenderPort | null = null;
  private musicPort: RenderPort | null = null;
  private bank: SoundBank | null = null;
  private stream: MusicStream | null = null;
  private sfxVoices: VoicePlayer | null = null;
  private flatVoices: VoicePlayer | null = null;
  private ambVoices: VoicePlayer | null = null;
  private stingerVoices: VoicePlayer | null = null;
  private ambience: AmbiencePlayer | null = null;
  private mood: Mood = 'menu';
  private intensity = 0;
  private sentIntensity = -1;
  private musicCtx: MusicContext = {};
  private tier: QualityTier = 'high';
  private hrtf = true;
  private voiceCap = 48;
  private readonly offs: (() => void)[] = [];
  private profiler: Profiler | null;
  private readonly seed: number;
  private readonly useWorklet: boolean;
  private readonly factory: WorkerFactory | null;
  private raf = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private dialogue = false;
  private listener: ListenerPose = { ...DEFAULT_LISTENER };
  private listenerDirty = true;
  private distanceScale = 3;
  // Trigger ring buffer (bus handlers enqueue; update() drains).
  private readonly rKind = new Int16Array(RING);
  private readonly rVol = new Float32Array(RING);
  private readonly rPan = new Float32Array(RING);
  private readonly rX = new Float64Array(RING);
  private readonly rY = new Float64Array(RING);
  private readonly rZ = new Float64Array(RING);
  private readonly rDelay = new Float32Array(RING);
  private readonly rPos = new Uint8Array(RING);
  private rHead = 0;
  private rTail = 0;
  private readonly params = makePlayParams();
  private readonly cueScratch: SfxCue[] = [];
  // Ambience mixing.
  private sceneLayers: readonly { key: string; gain: number }[] = [];
  private readonly envLayers: AmbienceLayer[] = [];
  private readonly battleLayers: AmbienceLayer[] = [];
  private readonly mergedTargets = new Map<string, number>();
  private readonly keepSet = new Set<string>();
  private envExplicit = false;
  private lastHour = -1;
  private env: Pick<EnvironmentState, 'hour' | 'season' | 'weather'> | null = null;
  private engagement = 0;
  private ambienceDirty = true;
  private readonly warnedKeys = new Set<string>();
  private pendingStinger: { id: AudioStinger; until: number } | null = null;
  // Timing.
  private lastMs = 0;
  private avgMs = 0;
  private maxMs = 0;
  private triggers = 0;
  private suspendedByVisibility = false;
  private readonly ambSnapshot: { key: string; gain: number }[] = [];

  constructor(
    bus: GameBus,
    private settings: GameSettings,
    readonly disabled: boolean,
    opts: AudioManagerOptions = {},
  ) {
    this.profiler = opts.profiler ?? null;
    this.seed = opts.seed ?? (Math.random() * 0x7fffffff) | 0;
    this.factory = opts.workerFactory === undefined ? createAudioWorker : opts.workerFactory;
    this.useWorklet = opts.worklet ?? !/[?&]audioworklet=0(&|$)/.test(typeof location !== 'undefined' ? location.search : '');
    if (disabled) return;
    this.offs.push(
      bus.on('audio:sfx', (e) => this.enqueue(e.sfx, e.volume ?? 1, e.pan ?? 0, e.position ?? null, 0)),
      bus.on('audio:mood', (e) => this.setMood(e.mood, e.intensity)),
      bus.on('audio:stinger', (e) => this.stinger(e.stinger)),
      bus.on('audio:ambience', (e) => this.setAmbience(e.layers)),
      bus.on('audio:listener', (e) => this.setListener(e)),
      bus.on('hero:combat', (e) => {
        for (const c of heroCombatCues(e.kind, e.strength, this.cueScratch)) this.enqueue(c.sfx, c.volume, 0, e, c.delay);
        if (e.kind === 'perfect_dodge') this.mixer?.slowmo(0.6);
      }),
      bus.on('battle:events', (e) => {
        let contacts = 0;
        for (const ev of e.events) if (ev.kind === 'contact' || ev.kind === 'charge') contacts++;
        if (contacts > 0) this.engagement = Math.min(1, this.engagement + contacts * 0.08);
      }),
      bus.on('world:tick', (e) => this.onWorldTick(e.calendar.hour, e.calendar.month)),
      bus.on('settings:changed', (e) => this.setSettings(e.settings)),
      bus.on('quality:changed', (e) => this.applyQuality(e.settings)),
      bus.on('scene:entered', () => {
        this.sceneLayers = [];
        this.ambienceDirty = true;
      }),
    );
    const resume = (): void => {
      void this.resume();
    };
    window.addEventListener('pointerdown', resume, { passive: true });
    window.addEventListener('keydown', resume);
    window.addEventListener('touchend', resume, { passive: true });
    this.offs.push(() => {
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
      window.removeEventListener('touchend', resume);
    });
    const vis = (): void => this.onVisibility();
    document.addEventListener('visibilitychange', vis);
    this.offs.push(() => document.removeEventListener('visibilitychange', vis));
    this.ensure();
    // QA / capture hook (read-only by convention): window.__SAMRAJYA_AUDIO__.stats() with ?debug=1 or ?profiler=1.
    if (/[?&](debug|profiler)=1(&|$)/.test(window.location.search)) (window as unknown as Record<string, unknown>).__SAMRAJYA_AUDIO__ = this;
  }

  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  /** The analyser on the master output (lab meters, captures), or null. */
  get analyser(): AnalyserNode | null {
    return this.mixer?.analyser ?? null;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  /** Profile main-thread audio as system 'audio' (+ counters audio.voices / audio.underruns). */
  attachProfiler(p: Profiler | null): void {
    this.profiler = p;
  }

  /** Resume the context (call from a user gesture; the constructor also listens for the first one). */
  async resume(): Promise<void> {
    this.ensure();
    if (this.ctx && this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {
        /* the browser refused (no gesture yet) - try again on the next one */
      }
    }
  }

  private ensure(): void {
    if (this.ctx || this.disabled) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    let ctx: AudioContext;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch {
      return;
    }
    this.ctx = ctx;
    const mixer = new Mixer(ctx);
    this.mixer = mixer;
    mixer.setVolumes(this.settings);
    this.bankPort = createRenderPort(this.factory);
    this.musicPort = createRenderPort(this.factory);
    const bank = new SoundBank(ctx, this.bankPort);
    this.bank = bank;
    bank.onReady = (key) => this.onSoundReady(key);
    this.bankPort.onMessage = (m) => this.onWorker(m);
    this.musicPort.onMessage = (m) => this.onWorker(m);
    this.bankPort.post({ t: 'init', role: 'bank', sampleRate: ctx.sampleRate, seed: this.seed });
    this.musicPort.post({ t: 'init', role: 'music', sampleRate: ctx.sampleRate, seed: this.seed });
    this.musicPort.post({ t: 'context', ctx: this.musicCtx });
    this.musicPort.post({ t: 'mood', mood: this.mood, intensity: this.intensity });
    this.sentIntensity = this.intensity;
    const stream = new MusicStream(ctx, this.musicPort, mixer.musicDuck);
    this.stream = stream;
    stream.ahead = this.streamAhead();
    void stream.start(this.useWorklet).then(() => {
      stream.ahead = this.streamAhead();
    });
    const split = splitVoiceCap(this.voiceCap);
    this.sfxVoices = new VoicePlayer(ctx, 'spatial', split.sfx, mixer.sfxIn, mixer.sfxSend, this.hrtf);
    this.ambVoices = new VoicePlayer(ctx, 'spatial', split.ambience, mixer.ambience, mixer.ambSend, this.hrtf);
    this.flatVoices = new VoicePlayer(ctx, 'flat', split.flat, mixer.sfxIn, mixer.sfxSend, false, mixer.ui);
    this.stingerVoices = new VoicePlayer(ctx, 'flat', 3, mixer.stingers, mixer.sfxSend, false);
    this.ambience = new AmbiencePlayer(ctx, mixer, bank, this.ambVoices);
    this.ambience.spotVariants = this.tier === 'low' ? 2 : 3;
    this.applyListener();
    // Warm the bank after the boot 'quality:changed' (main.ts emits it right after constructing us), so the
    // variant counts match the real tier.
    setTimeout(() => this.warm(), 0);
    const tick = (): void => {
      this.raf = requestAnimationFrame(tick);
      this.frame();
    };
    this.raf = requestAnimationFrame(tick);
    // Background tabs throttle rAF: keep the stream fed (the context itself is suspended when hidden).
    this.timer = setInterval(() => {
      if (performance.now() - this.lastFrameAt > 250) this.frame();
    }, 250);
  }

  private lastFrameAt = 0;
  private lastBattleMix = 0;

  private warm(): void {
    const bank = this.bank;
    if (!bank) return;
    bank.request(`ir:hall:${IR_SECONDS[this.tier]}`, 1, 98);
    for (const id of UI_FIRST) bank.request(`sfx:${id}`, variantsForTier(SFX_META[id], this.tier), 100);
    this.warmGroups();
    this.warmStingers();
  }

  /** Keep the SFX groups of the current mood rendered; release the others (re-rendered on demand). */
  private warmGroups(): void {
    const bank = this.bank;
    if (!bank) return;
    const want = GROUPS_FOR[this.mood];
    for (const id of ALL_SFX) {
      const key = `sfx:${id}`;
      if (SFX_GROUPS[id].some((g) => want.includes(g))) bank.request(key, variantsForTier(SFX_META[id], this.tier), 40 + SFX_META[id].priority * 0.5);
      else if (bank.has(key) && this.mood !== 'victory' && this.mood !== 'defeat') bank.release(key);
    }
  }

  private warmStingers(): void {
    const bank = this.bank;
    if (!bank) return;
    const keep = STINGERS_FOR[this.mood];
    const urgent = URGENT_STINGER[this.mood];
    keep.forEach((s, i) => bank.request(this.stingerKey(s), 1, s === urgent ? 75 : 20 - i));
    for (const s of AUDIO_STINGER_LIST) {
      for (const key of [`stinger:${s}`, `stinger:${s}:half`]) if (bank.isRequested(key) && (!keep.includes(s) || key !== this.stingerKey(s))) bank.release(key);
    }
  }

  setSettings(s: GameSettings): void {
    this.settings = s;
    this.mixer?.setVolumes(s);
  }

  private applyQuality(q: QualitySettings): void {
    const prevTier = this.tier;
    this.tier = q.tier;
    this.hrtf = q.audio.hrtf;
    this.voiceCap = q.audio.voices;
    const split = splitVoiceCap(this.voiceCap);
    this.sfxVoices?.resize(split.sfx);
    this.ambVoices?.resize(split.ambience);
    this.flatVoices?.resize(split.flat);
    this.sfxVoices?.setHrtf(this.hrtf);
    this.ambVoices?.setHrtf(this.hrtf);
    if (this.ambience) this.ambience.spotVariants = this.tier === 'low' ? 2 : 3;
    if (this.stream) this.stream.ahead = this.streamAhead();
    if (prevTier !== this.tier && this.bank) {
      // Higher tiers render more variants (requests only add what is missing).
      this.warmGroups();
      this.warmStingers();
      this.bank.request(`ir:hall:${IR_SECONDS[this.tier]}`, 1, 90);
    }
  }

  setMood(mood: Mood, intensity: number): void {
    const changed = mood !== this.mood;
    this.mood = mood;
    this.intensity = Math.max(0, Math.min(1, intensity));
    this.distanceScale = DISTANCE_SCALE[mood];
    if (changed) {
      this.musicPort?.post({ t: 'mood', mood, intensity: this.intensity });
      this.sentIntensity = this.intensity;
      this.ambienceDirty = true;
      this.warmGroups();
      this.warmStingers();
    }
  }

  /**
   * Environment for world beds (wind / rain / birds / insects / thunder) and the raga of the hour.
   * Scenes call it whenever they apply an environment (overrides the world:tick hour).
   */
  setEnvironment(env: Pick<EnvironmentState, 'hour' | 'season' | 'weather'>): void {
    this.envExplicit = true;
    this.env = env;
    worldBedLayers(env, this.envLayers);
    this.ambienceDirty = true;
    this.setMusicContext({ hour: env.hour, season: env.season, rain: env.weather.rain });
  }

  /** Musical context: hour / season / rain, hero lighting mood, district id (e.g. 'd_temple'). */
  setMusicContext(ctx: MusicContext): void {
    const next = { ...this.musicCtx, ...ctx };
    if (next.hour !== undefined) next.hour = Math.round(next.hour * 4) / 4;
    const same = next.hour === this.musicCtx.hour && next.season === this.musicCtx.season && next.heroMood === this.musicCtx.heroMood && next.district === this.musicCtx.district && Math.round((next.rain ?? 0) * 5) === Math.round((this.musicCtx.rain ?? 0) * 5);
    this.musicCtx = next;
    if (!same) this.musicPort?.post({ t: 'context', ctx: next });
  }

  /** Dialogue / negotiation on screen: the score ducks -9 dB while active. */
  setDialogue(active: boolean): void {
    this.dialogue = active;
  }

  setListener(p: { x: number; y: number; z: number; fx: number; fy: number; fz: number }): void {
    const l = this.listener;
    l.x = p.x;
    l.y = p.y;
    l.z = p.z;
    l.fx = p.fx;
    l.fy = p.fy;
    l.fz = p.fz;
    this.listenerDirty = true;
  }

  /** Scene ambience layers ('audio:ambience'); layers not listed fade out. */
  setAmbience(layers: readonly { key: string; gain: number }[]): void {
    this.sceneLayers = layers;
    this.ambienceDirty = true;
    if (this.mood === 'hero_explore' && !this.musicCtx.district) {
      const keys: string[] = [];
      for (const l of layers) if (l.gain > 0.05) keys.push(l.key);
      const d = flavourFromAmbience(keys);
      if (d) this.setMusicContext({ district: d });
    }
  }

  /** Non-positional one-shot (kept for the baseline API). */
  play(kind: SfxKind, volume = 1, pan = 0): void {
    this.enqueue(kind, volume, pan, null, 0);
  }

  /** Positional one-shot at a world point. */
  playAt(kind: SfxKind, x: number, y: number, z: number, volume = 1): void {
    this.enqueue(kind, volume, 0, { x, y, z }, 0);
  }

  /** Musical stinger over the score (ducks the score, cues the engine). */
  stinger(id: AudioStinger): void {
    if (this.disabled) return;
    this.musicPort?.post({ t: 'cue', stinger: id });
    if (!this.playStinger(id) && this.ctx) {
      this.bank?.request(this.stingerKey(id), 1, 99);
      this.pendingStinger = { id, until: this.ctx.currentTime + 2 };
    }
  }

  /** Low / medium tiers (phones, small laptops) keep stingers at half rate: half the memory. */
  private stingerKey(id: AudioStinger): string {
    return this.tier === 'low' || this.tier === 'medium' ? `stinger:${id}:half` : `stinger:${id}`;
  }

  private playStinger(id: AudioStinger): boolean {
    const buf = this.bank?.get(this.stingerKey(id), 0) ?? null;
    if (!buf || !this.stingerVoices || !this.mixer) return false;
    const p = this.params;
    p.kind = `stinger:${id}`;
    p.priority = 100;
    p.buffer = buf;
    p.gain = id === 'construction_complete' || id === 'harvest' ? 0.55 : 0.8;
    p.rate = 1;
    p.when = 0;
    p.maxInstances = 2;
    p.minIntervalMs = 400;
    p.pan = 0;
    p.ui = false;
    p.x = Number.NaN;
    p.send = 0;
    const ok = this.stingerVoices.play(p);
    if (ok) this.mixer.duck(-7, buf.duration * 0.75);
    return ok;
  }

  private enqueue(kind: string, volume: number, pan: number, pos: { x: number; y: number; z: number } | null, delay: number): void {
    if (this.disabled) return;
    const idx = SFX_INDEX.get(kind);
    if (idx === undefined) return;
    const next = (this.rHead + 1) % RING;
    if (next === this.rTail) return; // full: drop (a frame never needs 128 sounds)
    const h = this.rHead;
    this.rKind[h] = idx;
    this.rVol[h] = volume;
    this.rPan[h] = pan;
    this.rDelay[h] = delay;
    if (pos) {
      this.rPos[h] = 1;
      this.rX[h] = pos.x;
      this.rY[h] = pos.y;
      this.rZ[h] = pos.z;
    } else this.rPos[h] = 0;
    this.rHead = next;
  }

  private frame(): void {
    const t0 = performance.now();
    this.lastFrameAt = t0;
    this.profiler?.begin('audio');
    this.update();
    this.profiler?.end('audio');
    const ms = performance.now() - t0;
    this.lastMs = ms;
    this.avgMs = this.avgMs * 0.95 + ms * 0.05;
    this.maxMs = Math.max(this.maxMs * 0.995, ms);
    if (this.profiler) {
      this.profiler.setCounter('audio.voices', this.activeVoices());
      this.profiler.setCounter('audio.underruns', this.stream?.underruns ?? 0);
    }
  }

  private activeVoices(): number {
    const now = this.ctx?.currentTime ?? 0;
    return (this.sfxVoices?.active(now) ?? 0) + (this.ambVoices?.active(now) ?? 0) + (this.flatVoices?.active(now) ?? 0);
  }

  /** Per frame (own rAF; also callable by tests / labs). */
  update(): void {
    const ctx = this.ctx;
    const mixer = this.mixer;
    if (!ctx || !mixer) return;
    if (this.listenerDirty) this.applyListener();
    // Drain triggers.
    while (this.rTail !== this.rHead) {
      const i = this.rTail;
      this.playTrigger(i);
      this.rTail = (i + 1) % RING;
    }
    // Score: intensity (debounced), stream refill.
    if (Math.abs(this.intensity - this.sentIntensity) > 0.02) {
      this.musicPort?.post({ t: 'intensity', value: this.intensity });
      this.sentIntensity = this.intensity;
    }
    this.stream?.update();
    if (this.pendingStinger && ctx.currentTime < this.pendingStinger.until) {
      if (this.playStinger(this.pendingStinger.id)) this.pendingStinger = null;
    } else this.pendingStinger = null;
    // Ambience.
    this.engagement *= 0.995;
    // The automatic battle bed follows the engagement meter at 4 Hz.
    if ((this.mood === 'battle' || this.mood === 'siege') && ctx.currentTime - this.lastBattleMix > 0.25) {
      this.lastBattleMix = ctx.currentTime;
      this.ambienceDirty = true;
    }
    if (this.ambienceDirty) this.mixAmbience();
    this.ambience?.update(this.listener);
    mixer.update(this.dialogue);
  }

  private playTrigger(i: number): void {
    const id = ALL_SFX[this.rKind[i] as number] as SfxSoundId;
    const ctx = this.ctx as AudioContext;
    const meta = SFX_META[id];
    let key = SFX_KEYS[this.rKind[i] as number] as string;
    const hasPos = this.rPos[i] === 1;
    let d = 0;
    if (hasPos) d = distance3(this.listener, this.rX[i] as number, this.rY[i] as number, this.rZ[i] as number);
    let delay = this.rDelay[i] as number;
    if (id === 'thunder') {
      delay += thunderDelaySec(hasPos ? d / this.distanceScale : null, Math.random());
      if (hasPos && d / this.distanceScale > 2500) key = 'sfx:fx_thunder_far';
    }
    const buf = this.bank?.pick(key) ?? null;
    if (!buf) {
      // Outside the loaded groups (or still rendering): render on demand for the next trigger.
      if (this.bank && !this.bank.isRequested(key)) this.bank.request(key, 2, 85);
      return;
    }
    const p = this.params;
    p.kind = key;
    p.priority = meta.priority;
    p.buffer = buf;
    p.rate = Math.pow(2, ((Math.random() * 2 - 1) * meta.pitchCents) / 1200);
    p.gain = (this.rVol[i] as number) * dbToGain(meta.gainDb + (Math.random() * 2 - 1) * meta.gainJitterDb);
    p.when = ctx.currentTime + delay;
    p.maxInstances = meta.maxInstances;
    p.minIntervalMs = meta.minIntervalMs;
    p.pan = this.rPan[i] as number;
    p.ui = meta.bus === 'ui';
    let player: VoicePlayer | null;
    if (hasPos && meta.bus !== 'ui') {
      const g = distanceGain(d, meta.refDistance, meta.maxDistance, meta.rolloff, this.distanceScale);
      if (g < 0.002) return;
      p.gain *= g;
      p.x = this.rX[i] as number;
      p.y = this.rY[i] as number;
      p.z = this.rZ[i] as number;
      p.lowpass = airAbsorptionHz(d, this.distanceScale);
      p.send = reverbSend(meta.reverbSend, d, meta.refDistance, this.distanceScale);
      player = this.sfxVoices;
    } else {
      p.x = Number.NaN;
      p.lowpass = 20000;
      p.send = meta.bus === 'ui' ? 0 : meta.reverbSend * 0.5;
      player = this.flatVoices;
    }
    if (player?.play(p)) {
      this.triggers++;
      if (meta.duckMusicDb < 0) this.mixer?.duck(meta.duckMusicDb, Math.min(1.5, Math.max(0.25, buf.duration * 0.6)));
    }
  }

  private mixAmbience(): void {
    this.ambienceDirty = false;
    const amb = this.ambience;
    if (!amb) return;
    const t = this.mergedTargets;
    t.clear();
    const add = (k: string, g: number): void => {
      t.set(k, Math.max(t.get(k) ?? 0, g));
    };
    for (const l of this.sceneLayers) add(l.key, l.gain);
    // World beds: outdoors in the world, the battle and the hero scenes (scenes may override).
    if (this.mood !== 'menu') for (const l of this.envLayers) add(l.key, l.gain * (this.mood === 'world' ? 0.8 : 1));
    // Automatic battle bed unless the scene drives it.
    if ((this.mood === 'battle' || this.mood === 'siege') && !t.has('battle_roar')) {
      const engaged = Math.max(this.engagement, this.intensity * 0.6);
      battleBedLayers(engaged, 1, 120, this.battleLayers);
      for (const l of this.battleLayers) add(l.key, l.gain);
    }
    this.keepSet.clear();
    for (const [k, g] of t) {
      if (!amb.setTarget(k, g)) {
        if (!this.warnedKeys.has(k)) {
          this.warnedKeys.add(k);
          console.warn(`[audio] unknown ambience key "${k}" (see src/audio/ambience/meta.ts AMBIENCE_DEFS)`);
        }
        continue;
      }
      this.keepSet.add(k);
    }
    amb.fadeAllExcept(this.keepSet);
  }

  private onWorldTick(hour: number, month: number): void {
    if (this.envExplicit || hour === this.lastHour) return;
    this.lastHour = hour;
    const season = SEASONS[Math.floor((((month % 12) + 12) % 12) / 2)] ?? 'vasanta';
    const weather = this.env?.weather ?? { kind: 'clear', cloudCover: 0.2, rain: 0, windDirection: 0, windSpeed: 4, temperatureC: 28, humidity: 0.4, visibility: 8000, flood: 0, daysRemaining: 3 };
    this.env = { hour, season, weather: weather as EnvironmentState['weather'] };
    worldBedLayers(this.env, this.envLayers);
    this.ambienceDirty = true;
    this.setMusicContext({ hour, season });
  }

  private applyListener(): void {
    this.listenerDirty = false;
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    const p = this.listener;
    const fl = Math.hypot(p.fx, p.fy, p.fz) || 1;
    const t = ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, t, 0.03);
      l.positionY.setTargetAtTime(p.y, t, 0.03);
      l.positionZ.setTargetAtTime(p.z, t, 0.03);
      l.forwardX.setTargetAtTime(p.fx / fl, t, 0.03);
      l.forwardY.setTargetAtTime(p.fy / fl, t, 0.03);
      l.forwardZ.setTargetAtTime(p.fz / fl, t, 0.03);
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      const legacy = l as unknown as { setPosition(x: number, y: number, z: number): void; setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void };
      legacy.setPosition(p.x, p.y, p.z);
      legacy.setOrientation(p.fx / fl, p.fy / fl, p.fz / fl, 0, 1, 0);
    }
  }

  private onSoundReady(key: string): void {
    if (key.startsWith('ir:')) {
      const b = this.bank?.get(key, 0);
      if (b) this.mixer?.setImpulse(b);
    }
  }

  private readonly msg = { sound: 0, chunk: 0, soundMs: 0, chunkMs: 0, maxMs: 0 };

  private onWorker(m: FromWorker): void {
    const t0 = performance.now();
    this.handleWorker(m);
    const ms = performance.now() - t0;
    if (m.t === 'sound') {
      this.msg.sound++;
      this.msg.soundMs += ms;
    } else if (m.t === 'chunk') {
      this.msg.chunk++;
      this.msg.chunkMs += ms;
    }
    if (ms > this.msg.maxMs) this.msg.maxMs = ms;
  }

  private handleWorker(m: FromWorker): void {
    switch (m.t) {
      case 'sound':
        this.bank?.receive(m.key, m.variant, m.sampleRate, m.channels, m.ms);
        break;
      case 'chunk':
        this.stream?.onChunk(m.L, m.R, m.frames, m.ms, m.stats);
        break;
      case 'score':
        this.stream?.onScore(m.stats);
        break;
      case 'error':
        console.warn(`[audio] worker: ${m.message}${m.key ? ` (${m.key})` : ''}`);
        break;
      case 'ready':
        break;
    }
  }

  /** Seconds of score kept ahead: the worklet path is immune to main-thread hitches, so it needs less. */
  private streamAhead(): number {
    const low = this.tier === 'low';
    return this.stream?.mode === 'worklet' ? (low ? 1.25 : 1.0) : low ? 1.5 : 1.25;
  }

  private onVisibility(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (document.hidden) {
      if (ctx.state === 'running') {
        this.suspendedByVisibility = true;
        void ctx.suspend();
      }
    } else if (this.suspendedByVisibility) {
      this.suspendedByVisibility = false;
      void ctx.resume();
    }
  }

  /** Is an ambience key known to the catalog? */
  static knowsAmbience(key: string): boolean {
    return ambienceDef(key) !== undefined;
  }

  stats(): AudioStats {
    const now = this.ctx?.currentTime ?? 0;
    this.ambience?.snapshot(this.ambSnapshot);
    const stream = this.stream;
    return {
      enabled: !this.disabled,
      state: this.ctx?.state ?? 'none',
      sampleRate: this.ctx?.sampleRate ?? 0,
      tier: this.tier,
      hrtf: this.hrtf,
      voices: {
        sfx: this.sfxVoices?.active(now) ?? 0,
        ambience: this.ambVoices?.active(now) ?? 0,
        flat: this.flatVoices?.active(now) ?? 0,
        cap: this.voiceCap,
        stolen: (this.sfxVoices?.pool.stolen ?? 0) + (this.ambVoices?.pool.stolen ?? 0) + (this.flatVoices?.pool.stolen ?? 0),
        rejected: (this.sfxVoices?.pool.rejected ?? 0) + (this.ambVoices?.pool.rejected ?? 0) + (this.flatVoices?.pool.rejected ?? 0),
      },
      triggers: this.triggers,
      bank: { keys: this.bank?.keys ?? 0, mb: +((this.bank?.bytes ?? 0) / 1048576).toFixed(2), renders: this.bank?.renders ?? 0, renderMs: Math.round(this.bank?.renderMs ?? 0) },
      music: {
        mood: this.mood,
        intensity: this.intensity,
        stream: stream?.mode ?? 'pending',
        bufferedSec: +(stream?.bufferedSec ?? 0).toFixed(3),
        underruns: stream?.underruns ?? 0,
        chunks: stream?.chunks ?? 0,
        workerMsPerChunk: stream && stream.chunks ? +(stream.workerMs / stream.chunks).toFixed(2) : 0,
        latencyMs: stream ? +stream.latencyMs.toFixed(1) : 0,
        maxLatencyMs: stream ? +stream.maxLatencyMs.toFixed(1) : 0,
        score: stream?.lastStats ?? null,
      },
      ambience: this.ambSnapshot.slice(),
      mainMs: { last: +this.lastMs.toFixed(3), avg: +this.avgMs.toFixed(3), max: +this.maxMs.toFixed(3) },
      messages: { sound: this.msg.sound, chunk: this.msg.chunk, soundMs: +this.msg.soundMs.toFixed(2), chunkMs: +this.msg.chunkMs.toFixed(2), maxMs: +this.msg.maxMs.toFixed(2) },
      workers: this.disabled || !this.bankPort ? 'none' : this.bankPort.inline ? 'inline' : 'worker',
    };
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.timer) clearInterval(this.timer);
    this.ambience?.dispose();
    this.sfxVoices?.stopAll();
    this.flatVoices?.stopAll();
    this.ambVoices?.stopAll();
    this.stingerVoices?.stopAll();
    this.stream?.dispose();
    this.bankPort?.dispose();
    this.musicPort?.dispose();
    this.mixer?.dispose();
    void this.ctx?.close();
    this.ctx = null;
  }
}
