/**
 * ScoreEngine: the adaptive raga score as a pure streaming renderer (Float32Array in, no WebAudio).
 *
 *   const e = new ScoreEngine(48000, seed);
 *   e.setMood('battle', 0.4); e.setContext({ hour: 17 });
 *   e.render(L, R);                       // any chunk size; output is identical to one big render
 *   e.setIntensity(0.9); e.cue('battle_start');
 *
 * Internals: fixed 128-frame quanta behind a FIFO (chunk-size independent, deterministic); one
 * Performer per arrangement (moods.ts) - a tanpura cycle, a tala beat clock with theka / fills,
 * composer-driven bansuri and vina phrases (call and response), sympathetic strings, war ostinato,
 * horn calls, choir pads and bells - mixed on 7 buses whose gains follow intensity and section
 * (alap -> jor -> gat). Mood changes crossfade performers; a shared FDN reverb, a slow AGC (+-4 dB toward
 * the mood's loudness target) and a ceiling limiter finish the mix.
 * Runs in the audio worker (streams chunks to the main thread) and in node (tests, offline renders).
 * OWNER: Audio Developer (AUD-01).
 */
import type { AudioMood, AudioStinger } from '../../core/events';
import { clamp, dbToGain, hashSeed, Rand } from '../synth/core';
import { FdnReverb } from '../synth/reverb';
import { SympatheticBank } from '../synth/string';
import type { DrumKit, DrumStroke } from '../synth/sources/drums';
import { type Phrase, Composer, type Section } from './composer';
import { Bansuri, type BellKind, renderBell, renderChoir, renderConchCall, renderHornCall, renderStroke, renderTanpuraString, renderVinaNote } from './instruments';
import { type Arrangement, arrangementFor, type MusicContext, TYPICAL_INTENSITY } from './moods';
import { RAGAS, type RagaDef, swaraHz, TALAS, type TalaDef } from './theory';

export const QUANTUM = 128;

const B_DRONE = 0;
const B_FLUTE = 1;
const B_VINA = 2;
const B_PERC = 3;
const B_WAR = 4;
const B_BELLS = 5;
const B_CHOIR = 6;
const BUSES = 7;
/** Base level and reverb send per bus. */
const BUS_LEVEL = [0.34, 0.4, 0.36, 0.46, 0.52, 0.24, 0.3];
const BUS_SEND = [0.3, 0.42, 0.36, 0.16, 0.28, 0.5, 0.55];

interface Voice {
  data: Float32Array;
  start: number;
  gl: number;
  gr: number;
  bus: number;
}

/** Shared caches of rendered notes (per engine). */
class Cache {
  private readonly m = new Map<string, Float32Array>();
  constructor(
    readonly sr: number,
    readonly seed: number,
  ) {}
  get(key: string, make: () => Float32Array): Float32Array {
    let v = this.m.get(key);
    if (!v) {
      v = make();
      this.m.set(key, v);
    }
    return v;
  }
  get bytes(): number {
    let b = 0;
    for (const v of this.m.values()) b += v.byteLength;
    return b;
  }
}

/** Bol -> strokes on the classical kit. */
const BOL: Record<string, readonly DrumStroke[]> = {
  dha: ['dha'], dhin: ['dhin'], dhi: ['dhi'], din: ['dhin'], tin: ['tin'], ti: ['tin'], ta: ['na'], na: ['na'],
  ge: ['ge'], ke: ['ke'], ka: ['ke'], te: ['te'], tun: ['tun'], boom: ['boom'], rim: ['rim'],
};

const FILLS: readonly (readonly string[])[] = [
  ['dha te', 'te dha', 'te te', 'dha -'],
  ['te te', 'ke te', 'dha te', 'te dha'],
  ['dha -', 'te te', 'dha -', 'te te'],
  ['ge na', 'dha te', 'ge na', 'dha -'],
];

function smooth(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

class Performer {
  readonly raga: RagaDef;
  readonly tala: TalaDef;
  private readonly voices: Voice[] = [];
  private readonly busL: Float32Array[] = [];
  private readonly busR: Float32Array[] = [];
  private readonly busGain = new Float64Array(BUSES);
  private readonly tmp = new Float32Array(QUANTUM);
  fade = 0;
  fadeTarget = 1;
  /** Seconds for the performer fade (in or out). */
  fadeSec = 2.5;
  private beatFrame: number;
  private matra = 0;
  private cycle = 0;
  bpm: number;
  section: Section;
  private fill: readonly string[] | null = null;
  private tanFrame: number;
  private tanIdx = 0;
  private readonly flute: Bansuri;
  private readonly composer: Composer;
  private melodyFree: number;
  private lastVinaHz = 0;
  private readonly sym: SympatheticBank;
  private nextChoir: number;
  private choirFlip = 0;
  private nextBell: number;
  private nextHornCycle = 4;
  private readonly rng: Rand;
  intensityFloor = 0;
  private floorUntil = 0;
  duelPhase = 0;
  private pendingConch = false;

  constructor(
    readonly arr: Arrangement,
    private readonly cache: Cache,
    private readonly sr: number,
    seed: number,
    startFrame: number,
    intensity: number,
  ) {
    this.raga = RAGAS[arr.raga];
    this.tala = TALAS[arr.tala];
    this.rng = new Rand(hashSeed('performer', arr.id, seed, startFrame));
    for (let b = 0; b < BUSES; b++) {
      this.busL.push(new Float32Array(QUANTUM));
      this.busR.push(new Float32Array(QUANTUM));
    }
    this.bpm = arr.tempo[0] + (arr.tempo[1] - arr.tempo[0]) * intensity;
    this.section = this.sectionFor(intensity);
    this.beatFrame = startFrame + Math.round(0.4 * sr);
    this.tanFrame = startFrame + Math.round(0.05 * sr);
    this.flute = new Bansuri(sr, hashSeed(seed, arr.id));
    this.composer = new Composer(this.raga, this.rng.fork('composer'), arr.register);
    this.melodyFree = startFrame + Math.round((1.2 + this.rng.next()) * sr);
    const symNotes = this.raga.notes.flatMap((pc) => [swaraHz(this.raga, pc), swaraHz(this.raga, pc + 12)]);
    this.sym = new SympatheticBank(symNotes.slice(0, 13), sr, 3.2, 0.3);
    this.nextChoir = startFrame + Math.round(0.5 * sr);
    this.nextBell = startFrame + Math.round((3 + this.rng.next() * 6) * sr);
    for (let b = 0; b < BUSES; b++) this.busGain[b] = this.busTarget(b, intensity);
  }

  sectionFor(i: number): Section {
    return i < this.arr.jor ? 'alap' : i < this.arr.gat ? 'jor' : 'gat';
  }

  effectiveIntensity(i: number, frame: number): number {
    const floor = frame < this.floorUntil ? this.intensityFloor : 0;
    return Math.max(i, floor, this.duelPhase > 0 ? 0.25 + 0.25 * this.duelPhase : 0);
  }

  cue(stinger: AudioStinger, frame: number): void {
    if (stinger === 'battle_start') {
      this.intensityFloor = Math.max(this.intensityFloor, 0.75);
      this.floorUntil = frame + 20 * this.sr;
      this.pendingConch = true;
      this.fill = FILLS[0] as readonly string[];
    } else if (stinger === 'duel_phase') {
      this.duelPhase = Math.min(3, this.duelPhase + 1);
      this.fill = FILLS[1] as readonly string[];
      this.nextBell = frame;
    }
  }

  private busTarget(b: number, i: number): number {
    const a = this.arr;
    const sec = this.sectionFor(i);
    const warOn = a.war ? smooth((i - a.warFrom) / 0.25) : 0;
    switch (b) {
      case B_DRONE:
        return a.drone * (sec === 'gat' ? 0.8 : 1) * (1 - 0.35 * warOn);
      case B_FLUTE:
        return a.melody === 'vina' ? 0 : 1;
      case B_VINA:
        return a.melody === 'bansuri' ? (sec === 'alap' ? 0.4 : 0.55) : 1;
      case B_PERC:
        return a.kit && sec === 'gat' ? 0.55 + 0.45 * i : 0;
      case B_WAR:
        return warOn;
      case B_BELLS:
        return a.bells > 0 ? 1 : 0;
      case B_CHOIR:
        return a.choir * (a.war ? 0.35 + 0.65 * warOn : sec === 'alap' ? 0.7 : 1);
    }
    return 0;
  }

  private addVoice(data: Float32Array, start: number, bus: number, gain: number, pan: number): void {
    const p = (clamp(pan, -1, 1) + 1) * 0.25 * Math.PI;
    this.voices.push({ data, start: Math.round(start), gl: Math.cos(p) * gain, gr: Math.sin(p) * gain, bus });
  }

  private stroke(kit: DrumKit, s: DrumStroke): Float32Array {
    const v = this.rng.int(2);
    return this.cache.get(`stroke:${kit}:${s}:${v}`, () => renderStroke(kit, s, v, this.sr, this.cache.seed));
  }

  private bell(kind: BellKind, semis: number): Float32Array {
    const v = this.rng.int(2);
    return this.cache.get(`bell:${kind}:${this.raga.id}:${semis}:${v}`, () => renderBell(kind, semis, this.raga, this.sr, this.cache.seed + v));
  }

  // --------------------------------------------------------------------------------------- schedule

  private schedule(horizon: number, i: number): void {
    const sr = this.sr;
    // Tanpura: P(or M/N) - S - S - S(low), cyclic, humanized.
    if (this.fadeTarget > 0) {
      while (this.tanFrame < horizon) {
        const k = this.tanIdx % 4;
        const semis = k === 0 ? this.raga.tanpura - 12 : k === 3 ? -12 : 0;
        const hz = swaraHz(this.raga, semis);
        const variant = k === 2 ? 1 : 0;
        const data = this.cache.get(`tan:${Math.round(hz * 100)}:${variant}`, () => renderTanpuraString(hz, sr, this.cache.seed + variant));
        this.addVoice(data, this.tanFrame, B_DRONE, [0.8, 0.7, 0.7, 0.95][k] as number, [-0.3, 0.12, 0.3, -0.12][k] as number);
        this.tanFrame += Math.round((k === 3 ? 1.65 : 1.18) * (1 + this.rng.bi() * 0.04) * sr);
        this.tanIdx++;
      }
    }
    // Beat clock (tala).
    while (this.beatFrame < horizon) {
      this.beat(Math.round(this.beatFrame), i);
      this.beatFrame += (60 / this.bpm) * sr;
    }
    // Melody.
    if (this.fadeTarget > 0 && this.melodyFree < horizon + 0.3 * sr) this.melody(i);
    // Choir pads.
    if (this.arr.choir > 0 && this.fadeTarget > 0 && this.nextChoir < horizon) {
      const swaras = this.raga.notes.includes(7) ? (this.choirFlip++ % 3 === 2 ? [0, 5] : [0, 7]) : [0, 12];
      const vowel = this.arr.id.startsWith('hero') ? 'o' : 'a';
      const data = this.cache.get(`choir:${this.raga.id}:${swaras.join(',')}:${vowel}`, () => renderChoir(this.raga, swaras.map((s) => s - 12), 9, sr, this.cache.seed, vowel));
      this.addVoice(data, this.nextChoir, B_CHOIR, 0.75, -0.45);
      this.addVoice(data, this.nextChoir + Math.round(0.013 * sr), B_CHOIR, 0.75, 0.45);
      this.nextChoir += Math.round(7.4 * sr);
    }
    // Bells (temple hand bells, the occasional great bell).
    if (this.arr.bells >= 0.3 && this.fadeTarget > 0 && this.nextBell < horizon) {
      if (this.rng.chance(0.25)) this.addVoice(this.bell('ghanta', 12), this.nextBell, B_BELLS, 0.7, this.rng.bi() * 0.5);
      else this.addVoice(this.bell('ghanti_ring', 36), this.nextBell, B_BELLS, 0.55, this.rng.bi() * 0.7);
      this.nextBell += Math.round((6 + 14 * (1 - this.arr.bells) + this.rng.next() * 8) * sr);
    }
  }

  private beat(at: number, i: number): void {
    const sr = this.sr;
    const tala = this.tala;
    const beatLen = (60 / this.bpm) * sr;
    if (this.matra === 0) this.onSam(at, i);
    const sec = this.section;
    const kit = this.arr.kit;
    const vibStart = tala.matras - (tala.vibhags[tala.vibhags.length - 1] as number);
    // Classical percussion (gat).
    if (kit && sec === 'gat' && tala.id !== 'war' && this.fadeTarget > 0) {
      const bol = this.fill && this.matra >= vibStart ? (this.fill[(this.matra - vibStart) % this.fill.length] as string) : (tala.theka[this.matra] as string);
      const parts = bol.split(' ');
      const accent = this.matra === 0 ? 1 : this.matra === tala.khali ? 0.62 : 0.78;
      parts.forEach((p, k) => {
        const strokes = BOL[p];
        if (!strokes) return;
        for (const s of strokes) this.addVoice(this.stroke(kit, s), at + (k * beatLen) / parts.length, B_PERC, accent * (0.75 + 0.25 * i) * (k > 0 ? 0.8 : 1), this.rng.bi() * 0.15);
      });
    }
    // War layer.
    if (this.arr.war && i >= this.arr.warFrom - 0.1 && this.fadeTarget > 0) {
      if (tala.id === 'war') {
        const parts = (tala.theka[this.matra] as string).split(' ');
        parts.forEach((p, k) => {
          if (p === '-') return;
          const big = p === 'boom' && (this.matra === 0 || this.matra === 4) && k === 0;
          const data = big ? this.stroke('nagara', 'boom') : p === 'boom' ? this.stroke('dhol', 'boom') : this.stroke('dhol', 'rim');
          this.addVoice(data, at + (k * beatLen) / parts.length, B_WAR, (big ? 1 : 0.7) * (0.7 + 0.3 * i), big ? 0 : this.rng.bi() * 0.35);
        });
      } else {
        let off = 0;
        for (const v of tala.vibhags) {
          if (this.matra === off) this.addVoice(this.stroke(off === 0 ? 'nagara' : 'dhol', 'boom'), at, B_WAR, off === 0 ? 1 : 0.6, 0);
          off += v;
        }
      }
      if (this.pendingConch) {
        this.pendingConch = false;
        this.addVoice(this.cache.get(`conch:${this.raga.id}`, () => renderConchCall(this.raga, sr, this.cache.seed)), at, B_WAR, 0.9, 0);
      }
    }
    // Vina jor pulse / jhala on the chikari (high Sa).
    if ((sec === 'jor' || (sec === 'gat' && i > 0.7)) && this.fadeTarget > 0) {
      const sub = sec === 'jor' ? 1 : i > 0.85 ? 4 : 2;
      const chik = this.cache.get(`chikari:${this.raga.id}`, () => renderVinaNote(swaraHz(this.raga, 24), 0.2, sr, new Rand(hashSeed('chik', this.cache.seed)), { bright: 0.78, vel: 1, hardness: 0.35 }));
      const chikP = this.cache.get(`chikariP:${this.raga.id}`, () => renderVinaNote(swaraHz(this.raga, this.raga.tanpura + 12), 0.2, sr, new Rand(hashSeed('chikP', this.cache.seed)), { bright: 0.78, vel: 1, hardness: 0.35 }));
      for (let k = 0; k < sub; k++) {
        const data = k === 0 && this.matra % 2 === 1 ? chikP : chik;
        this.addVoice(data, at + (k * beatLen) / sub, B_VINA, (sec === 'jor' ? 0.2 : 0.15) * (k === 0 ? 1 : 0.7), 0.35);
      }
    }
    this.matra++;
    if (this.matra >= tala.matras) {
      this.matra = 0;
      this.cycle++;
    }
  }

  private onSam(at: number, i: number): void {
    const a = this.arr;
    // Tempo drifts toward the intensity target (at most 10% per cycle - laya grows like a performance).
    const target = a.tempo[0] + (a.tempo[1] - a.tempo[0]) * i;
    this.bpm = clamp(target, this.bpm * 0.9, this.bpm * 1.1);
    this.section = this.sectionFor(i);
    // Fill on the last vibhag of this cycle?
    if (!this.fill || this.cycle > 0) this.fill = this.section === 'gat' && this.rng.chance(0.2 + 0.45 * i) ? (this.rng.pick(FILLS) as readonly string[]) : null;
    if (a.bells > 0 && this.rng.chance(a.bells * 0.35)) this.addVoice(this.bell('chime', this.rng.pick([24, 31, 36])), at, B_BELLS, 0.45, this.rng.bi() * 0.6);
    if (a.war && i > 0.55 && this.cycle >= this.nextHornCycle && this.fadeTarget > 0) {
      this.nextHornCycle = this.cycle + 3 + this.rng.int(4);
      const leap = this.rng.chance(0.6) ? 7 : 12;
      const data = this.cache.get(`horn:${this.raga.id}:${leap}`, () => renderHornCall(this.raga, this.sr, this.cache.seed, this.raga.notes.includes(leap % 12) ? leap : 12));
      this.addVoice(data, at, B_WAR, 0.75, this.rng.bi() * 0.4);
    }
  }

  private melody(i: number): void {
    const sr = this.sr;
    const sec = this.section;
    const phrase = this.composer.phrase(sec, i);
    // Beat length: alap is free (a slow pulse of its own), jor / gat follow the tala.
    const beatLen = sec === 'alap' ? (0.62 + this.rng.next() * 0.2) * sr : (60 / this.bpm) * sr;
    let start = this.melodyFree;
    if (sec !== 'alap') {
      // Align to the next beat of the tala clock.
      const k = Math.ceil((start - this.beatFrame) / beatLen);
      start = this.beatFrame + k * beatLen;
    }
    const lead = this.arr.melody === 'vina' ? 'vina' : 'flute';
    this.play(phrase, start, beatLen, lead);
    let end = start + phrase.totalBeats * beatLen;
    if (this.arr.melody === 'both' && sec !== 'alap' && this.rng.chance(0.7)) {
      const ans = this.composer.answer(sec, i);
      this.play(ans, end, beatLen, 'vina');
      end += ans.totalBeats * beatLen;
    }
    this.melodyFree = Math.round(end);
  }

  private play(p: Phrase, start: number, beatLen: number, inst: 'flute' | 'vina'): void {
    const sr = this.sr;
    p.notes.forEach((n, idx) => {
      const at = Math.round(start + n.beat * beatLen);
      const frames = Math.max(1, Math.round(n.beats * beatLen));
      const hz = swaraHz(this.raga, n.semis);
      if (inst === 'flute') {
        this.flute.push({
          start: at,
          frames,
          hz,
          meend: n.meend ? Math.min(0.35, (n.beats * beatLen) / sr * 0.45) : 0.025,
          kanHz: n.kan !== null ? swaraHz(this.raga, n.kan) : 0,
          andolan: n.andolan,
          vel: n.vel,
          attack: idx === 0,
        });
      } else {
        const vhz = swaraHz(this.raga, n.semis - 12);
        const from = n.meend && this.lastVinaHz > 0 ? this.lastVinaHz : vhz;
        const data = renderVinaNote(vhz, (frames / sr) * 1.2, sr, this.rng, { fromHz: from, glideSec: n.meend ? Math.min(0.3, (frames / sr) * 0.4) : 0, andolan: n.andolan, vel: n.vel });
        this.addVoice(data, at, B_VINA, 0.9, -0.25 + this.rng.bi() * 0.1);
        this.lastVinaHz = vhz;
      }
    });
  }

  // ----------------------------------------------------------------------------------------- render

  /** Render [frame, frame + n) adding dry / send into the engine buffers. Returns false when silent and faded out. */
  render(frame: number, n: number, i: number, dryL: Float32Array, dryR: Float32Array, sendL: Float32Array, sendR: Float32Array): boolean {
    const sr = this.sr;
    const ie = this.effectiveIntensity(i, frame);
    this.schedule(frame + n, ie);
    for (let b = 0; b < BUSES; b++) {
      this.busL[b]?.fill(0);
      this.busR[b]?.fill(0);
    }
    // Sample voices.
    let w = 0;
    for (let k = 0; k < this.voices.length; k++) {
      const v = this.voices[k] as Voice;
      const from = Math.max(frame, v.start);
      const to = Math.min(frame + n, v.start + v.data.length);
      if (to > from) {
        const L = this.busL[v.bus] as Float32Array;
        const R = this.busR[v.bus] as Float32Array;
        const d = v.data;
        for (let f = from; f < to; f++) {
          const x = d[f - v.start];
          L[f - frame] += x * v.gl;
          R[f - frame] += x * v.gr;
        }
      }
      if (v.start + v.data.length > frame + n) this.voices[w++] = v;
    }
    this.voices.length = w;
    // Bansuri (mono, slightly right of centre).
    const t = this.tmp;
    t.fill(0);
    this.flute.render(t, 0, frame, n, 0.9);
    const fl = this.busL[B_FLUTE] as Float32Array;
    const fr = this.busR[B_FLUTE] as Float32Array;
    for (let k = 0; k < n; k++) {
      fl[k] += t[k] * 0.62;
      fr[k] += t[k] * 0.78;
    }
    // Sympathetic strings ring with the vina.
    const vl = this.busL[B_VINA] as Float32Array;
    const vr = this.busR[B_VINA] as Float32Array;
    for (let k = 0; k < n; k++) {
      const s = this.sym.process(vl[k] + vr[k]) * 0.6;
      vl[k] += s * 0.4;
      vr[k] += s * 0.6;
    }
    // Bus gains follow the targets (~1.5 s), performer fade.
    const kGain = 1 - Math.exp(-n / (1.5 * sr));
    const kFade = n / (this.fadeSec * sr);
    this.fade = this.fadeTarget > this.fade ? Math.min(this.fadeTarget, this.fade + kFade) : Math.max(this.fadeTarget, this.fade - kFade);
    const fade = smooth(this.fade);
    for (let b = 0; b < BUSES; b++) {
      this.busGain[b] += (this.busTarget(b, ie) - this.busGain[b]) * kGain;
      const g = this.busGain[b] * (BUS_LEVEL[b] as number) * fade;
      if (g < 1e-6) continue;
      const s = g * (BUS_SEND[b] as number);
      const L = this.busL[b] as Float32Array;
      const R = this.busR[b] as Float32Array;
      for (let k = 0; k < n; k++) {
        dryL[k] += L[k] * g;
        dryR[k] += R[k] * g;
        sendL[k] += L[k] * s;
        sendR[k] += R[k] * s;
      }
    }
    return !(this.fadeTarget === 0 && this.fade <= 0);
  }
}

export interface ScoreStats {
  mood: AudioMood;
  arrangement: string;
  raga: string;
  tala: string;
  section: Section;
  bpm: number;
  intensity: number;
  performers: number;
  cacheBytes: number;
  agcDb: number;
}

export class ScoreEngine {
  private frame = 0;
  private readonly cache: Cache;
  private active: Performer | null = null;
  private old: Performer | null = null;
  private mood: AudioMood = 'menu';
  private intensityTarget = 0.3;
  private intensity = 0.3;
  private ctx: MusicContext = {};
  private readonly reverb: FdnReverb;
  private readonly dryL = new Float32Array(QUANTUM);
  private readonly dryR = new Float32Array(QUANTUM);
  private readonly sendL = new Float32Array(QUANTUM);
  private readonly sendR = new Float32Array(QUANTUM);
  private readonly fifoL = new Float32Array(QUANTUM);
  private readonly fifoR = new Float32Array(QUANTUM);
  private fifoPos = QUANTUM;
  private readonly rv = new Float64Array(2);
  private wet = 0.32;
  private level = 1;
  private agc = 1;
  private loud = 0;
  private limEnv = 0;
  private started = false;
  private readonly seed: number;

  constructor(
    readonly sampleRate: number,
    seed = 1,
  ) {
    this.seed = seed;
    this.cache = new Cache(sampleRate, seed);
    this.reverb = new FdnReverb(sampleRate, { rt60: 3, damping: 5000, size: 1.5, predelayMs: 22, modulation: 4 });
  }

  /** Absolute frames rendered so far (sample clock of the stream). */
  get frames(): number {
    return this.frame - (QUANTUM - this.fifoPos);
  }

  setMood(mood: AudioMood, intensity?: number): void {
    this.mood = mood;
    if (intensity !== undefined) this.intensityTarget = clamp(intensity, 0, 1);
    // The very first mood starts at its intensity (no ramp from the default).
    if (!this.started) this.intensity = this.intensityTarget;
    this.rearrange();
  }

  setIntensity(intensity: number): void {
    this.intensityTarget = clamp(intensity, 0, 1);
  }

  setContext(ctx: MusicContext): void {
    this.ctx = { ...this.ctx, ...ctx };
    if (this.started) this.rearrange();
  }

  cue(stinger: AudioStinger): void {
    this.active?.cue(stinger, this.frame);
  }

  stats(): ScoreStats {
    const a = this.active;
    return {
      mood: this.mood,
      arrangement: a?.arr.id ?? '-',
      raga: a?.raga.name ?? '-',
      tala: a?.tala.name ?? '-',
      section: a?.section ?? 'alap',
      bpm: Math.round(a?.bpm ?? 0),
      intensity: +this.intensity.toFixed(3),
      performers: (a ? 1 : 0) + (this.old ? 1 : 0),
      cacheBytes: this.cache.bytes,
      agcDb: +(20 * Math.log10(this.agc)).toFixed(2),
    };
  }

  /** The arrangement currently leading the mix. */
  get arrangement(): Arrangement | null {
    return this.active?.arr ?? null;
  }

  private rearrange(): void {
    this.started = true;
    const arr = arrangementFor(this.mood, this.ctx);
    if (this.active && this.active.arr.id === arr.id) return;
    if (this.old) this.old = null;
    if (this.active) {
      this.active.fadeTarget = 0;
      this.active.fadeSec = 3.5;
      this.old = this.active;
    }
    const p = new Performer(arr, this.cache, this.sampleRate, this.seed, this.frame, this.intensity);
    p.fade = this.old ? 0 : 0.35;
    p.fadeSec = this.old ? 3 : 1.5;
    this.active = p;
    this.reverb.setRt60(arr.reverb.rt60);
    this.reverb.setDamping(arr.reverb.damping);
    this.wet = arr.reverb.wet;
    this.level = arr.level;
  }

  /** Render n frames into L / R starting at `offset` (overwrites). */
  render(L: Float32Array, R: Float32Array, offset = 0, n = L.length - offset): void {
    if (!this.started) this.rearrange();
    let i = 0;
    while (i < n) {
      if (this.fifoPos >= QUANTUM) {
        this.quantum();
        this.fifoPos = 0;
      }
      const m = Math.min(QUANTUM - this.fifoPos, n - i);
      L.set(this.fifoL.subarray(this.fifoPos, this.fifoPos + m), offset + i);
      R.set(this.fifoR.subarray(this.fifoPos, this.fifoPos + m), offset + i);
      this.fifoPos += m;
      i += m;
    }
  }

  private quantum(): void {
    const n = QUANTUM;
    const sr = this.sampleRate;
    // Intensity: rises in ~2.5 s, falls in ~7 s.
    const up = this.intensityTarget > this.intensity;
    this.intensity += (this.intensityTarget - this.intensity) * (1 - Math.exp(-n / ((up ? 2.5 : 7) * sr)));
    this.dryL.fill(0);
    this.dryR.fill(0);
    this.sendL.fill(0);
    this.sendR.fill(0);
    if (this.old && !this.old.render(this.frame, n, this.intensity, this.dryL, this.dryR, this.sendL, this.sendR)) this.old = null;
    this.active?.render(this.frame, n, this.intensity, this.dryL, this.dryR, this.sendL, this.sendR);
    const target = this.active ? dbToGain((this.active.arr.rms[0] + this.active.arr.rms[1]) / 2) : 0.1;
    const kLoud = 1 - Math.exp(-n / (10 * sr));
    const kAgc = 1 - Math.exp(-n / (6 * sr));
    const rv = this.rv;
    let e = 0;
    for (let k = 0; k < n; k++) {
      this.reverb.tick(this.sendL[k], this.sendR[k], rv);
      const l = this.dryL[k] + rv[0] * this.wet * 2;
      const r = this.dryR[k] + rv[1] * this.wet * 2;
      this.dryL[k] = l;
      this.dryR[k] = r;
      e += l * l + r * r;
    }
    // Slow loudness AGC (+-4 dB around the arrangement's target).
    const ms = e / (2 * n);
    if (this.loud === 0) this.loud = target * target;
    this.loud += (ms - this.loud) * kLoud;
    const want = clamp(target / Math.sqrt(Math.max(1e-9, this.loud)), 0.63, 1.58);
    this.agc += (want - this.agc) * kAgc;
    const g = this.level * this.agc;
    const ceil = 0.85;
    const rel = Math.exp(-1 / (0.15 * sr));
    for (let k = 0; k < n; k++) {
      let l = this.dryL[k] * g;
      let r = this.dryR[k] * g;
      const pk = Math.max(Math.abs(l), Math.abs(r));
      this.limEnv = pk > this.limEnv ? pk : this.limEnv * rel + pk * (1 - rel);
      if (this.limEnv > 0.7) {
        const lg = 0.7 / this.limEnv + (1 - 0.7 / this.limEnv) * 0.3;
        l *= lg;
        r *= lg;
      }
      l = l > ceil ? ceil : l < -ceil ? -ceil : l;
      r = r > ceil ? ceil : r < -ceil ? -ceil : r;
      this.fifoL[k] = Math.abs(l) < 1e-20 ? 0 : l;
      this.fifoR[k] = Math.abs(r) < 1e-20 ? 0 : r;
    }
    this.frame += n;
  }
}

/** Offline: render `seconds` of a mood at a fixed intensity (tests, scripts/audio/render.mjs). */
export function renderMood(mood: AudioMood, seconds: number, sr: number, seed = 1, intensity = TYPICAL_INTENSITY[mood], ctx: MusicContext = {}): { L: Float32Array; R: Float32Array; stats: ScoreStats } {
  const e = new ScoreEngine(sr, seed);
  e.setContext(ctx);
  e.setMood(mood, intensity);
  const n = Math.round(seconds * sr);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  e.render(L, R);
  return { L, R, stats: e.stats() };
}
