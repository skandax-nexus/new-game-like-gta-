/**
 * SFX metadata (main-thread safe, no DSP): mix bus, priority, gain trim, variant count, instance limits,
 * spatial distances, reverb send, music ducking and per-trigger random variation for every SFX_KINDS
 * entry plus the internal effect sounds the audio director uses (hero:combat extras, far thunder).
 * The renderers live in `sfx/render.ts` (worker / node only).
 * OWNER: Audio Developer (AUD-01).
 */
import { SFX_KINDS, type SfxKind } from '../../core/events';

/** Internal one-shots (not requestable through 'audio:sfx'; triggered by the audio director). */
export const INTERNAL_SFX = ['fx_perfect_dodge', 'fx_finisher_boom', 'fx_hit_metal', 'fx_thunder_far'] as const;
export type InternalSfx = (typeof INTERNAL_SFX)[number];
export type SfxSoundId = SfxKind | InternalSfx;
export const ALL_SFX: readonly SfxSoundId[] = [...SFX_KINDS, ...INTERNAL_SFX];

export type SfxBus = 'sfx' | 'ui';

export interface SfxMeta {
  bus: SfxBus;
  /** 0..100; higher steals lower when the voice pool is full. */
  priority: number;
  /** Mix trim (dB) applied at playback; renders are peak-normalized. */
  gainDb: number;
  /** Variants rendered at the `high` tier (scaled by tier, min 2). */
  variants: number;
  /** Max simultaneous instances of this sound. */
  maxInstances: number;
  /** Re-trigger guard (ms): a repeat inside it is merged into the playing instance. */
  minIntervalMs: number;
  /** Full volume within this distance (m). */
  refDistance: number;
  /** Silent beyond this distance (m). */
  maxDistance: number;
  /** Distance exponent (1 = inverse distance). */
  rolloff: number;
  /** Reverb send at the reference distance (rises with distance). */
  reverbSend: number;
  /** Music duck while it plays (dB, 0 = none). */
  duckMusicDb: number;
  /** Random pitch per trigger (+- cents, via playbackRate). */
  pitchCents: number;
  /** Random gain per trigger (+- dB). */
  gainJitterDb: number;
  /** Peak level the render is normalized to (dBFS, <= -1). */
  peakDb: number;
  /** Render at the context rate or half of it (long, dark sounds: half the memory and render time). */
  rate: 'full' | 'half';
}

const UI: Partial<SfxMeta> = { bus: 'ui', priority: 90, maxInstances: 3, minIntervalMs: 40, refDistance: 1, maxDistance: 1, rolloff: 0, reverbSend: 0, duckMusicDb: -3, pitchCents: 25, gainJitterDb: 0.8 };
const MELEE: Partial<SfxMeta> = { priority: 80, maxInstances: 4, minIntervalMs: 25, refDistance: 3, maxDistance: 70, rolloff: 1, reverbSend: 0.12, pitchCents: 70, gainJitterDb: 1.5 };
const FOOT: Partial<SfxMeta> = { priority: 20, variants: 8, maxInstances: 4, minIntervalMs: 60, refDistance: 2, maxDistance: 35, rolloff: 1.2, reverbSend: 0.08, pitchCents: 120, gainJitterDb: 2.5, gainDb: -10 };

function m(base: Partial<SfxMeta>, over: Partial<SfxMeta>): SfxMeta {
  return {
    bus: 'sfx',
    priority: 50,
    gainDb: 0,
    variants: 4,
    maxInstances: 4,
    minIntervalMs: 50,
    refDistance: 10,
    maxDistance: 400,
    rolloff: 1,
    reverbSend: 0.15,
    duckMusicDb: 0,
    pitchCents: 50,
    gainJitterDb: 1.5,
    peakDb: -3,
    rate: 'full',
    ...base,
    ...over,
  };
}

export const SFX_META: Record<SfxSoundId, SfxMeta> = {
  // --- UI (non-spatial, ui bus) ---
  ui_click: m(UI, { gainDb: -9, variants: 4, peakDb: -3 }),
  ui_hover: m(UI, { gainDb: -20, variants: 3, priority: 40, duckMusicDb: 0, minIntervalMs: 60 }),
  ui_open: m(UI, { gainDb: -10, variants: 3 }),
  ui_close: m(UI, { gainDb: -11, variants: 3 }),
  ui_confirm: m(UI, { gainDb: -8, variants: 3, duckMusicDb: -4 }),
  ui_error: m(UI, { gainDb: -9, variants: 2, pitchCents: 10 }),
  notify: m(UI, { gainDb: -8, variants: 3, priority: 88, duckMusicDb: -4, minIntervalMs: 250 }),
  // --- Orders and battle ---
  order_ack: m({}, { bus: 'ui', priority: 70, gainDb: -8, variants: 5, maxInstances: 2, minIntervalMs: 150, refDistance: 1, maxDistance: 1, rolloff: 0, reverbSend: 0, duckMusicDb: -2, pitchCents: 40 }),
  march: m({}, { rate: 'half', priority: 30, gainDb: -6, variants: 3, maxInstances: 3, minIntervalMs: 300, refDistance: 12, maxDistance: 350, reverbSend: 0.1 }),
  charge_horn: m({}, { rate: 'half', priority: 75, gainDb: -2, variants: 4, maxInstances: 2, minIntervalMs: 400, refDistance: 40, maxDistance: 1600, rolloff: 0.8, reverbSend: 0.35, duckMusicDb: -3, pitchCents: 60 }),
  conch: m({}, { rate: 'half', priority: 78, gainDb: -1, variants: 3, maxInstances: 2, minIntervalMs: 500, refDistance: 50, maxDistance: 2000, rolloff: 0.7, reverbSend: 0.4, duckMusicDb: -5, pitchCents: 40 }),
  drum_hit: m({}, { rate: 'half', priority: 60, gainDb: -2, variants: 4, maxInstances: 4, minIntervalMs: 60, refDistance: 30, maxDistance: 1200, rolloff: 0.85, reverbSend: 0.3, pitchCents: 60 }),
  arrow_volley: m({}, { priority: 50, gainDb: -3, variants: 4, maxInstances: 3, minIntervalMs: 120, refDistance: 25, maxDistance: 500, reverbSend: 0.15, pitchCents: 80 }),
  arrow_impact: m({}, { priority: 40, gainDb: -5, variants: 4, maxInstances: 3, minIntervalMs: 120, refDistance: 15, maxDistance: 300, reverbSend: 0.1, pitchCents: 90 }),
  clash: m({}, { priority: 55, gainDb: -3, variants: 6, maxInstances: 4, minIntervalMs: 90, refDistance: 18, maxDistance: 450, reverbSend: 0.15, pitchCents: 90 }),
  elephant_trumpet: m({}, { rate: 'half', priority: 72, gainDb: -2, variants: 2, maxInstances: 2, minIntervalMs: 600, refDistance: 30, maxDistance: 1100, rolloff: 0.85, reverbSend: 0.3, duckMusicDb: -2, pitchCents: 80 }),
  horse_neigh: m({}, { rate: 'half', priority: 45, gainDb: -5, variants: 4, maxInstances: 2, minIntervalMs: 500, refDistance: 12, maxDistance: 450, reverbSend: 0.2, pitchCents: 90 }),
  cheer: m({}, { rate: 'half', priority: 60, gainDb: -3, variants: 3, maxInstances: 2, minIntervalMs: 800, refDistance: 30, maxDistance: 900, rolloff: 0.85, reverbSend: 0.25, pitchCents: 40 }),
  rout_cry: m({}, { rate: 'half', priority: 58, gainDb: -4, variants: 4, maxInstances: 2, minIntervalMs: 800, refDistance: 30, maxDistance: 900, rolloff: 0.85, reverbSend: 0.25, pitchCents: 40 }),
  // --- World / economy ---
  build: m({}, { priority: 35, gainDb: -6, variants: 5, maxInstances: 3, minIntervalMs: 150, refDistance: 15, maxDistance: 650, reverbSend: 0.18 }),
  coins: m({}, { priority: 50, gainDb: -8, variants: 4, maxInstances: 2, minIntervalMs: 120, refDistance: 6, maxDistance: 250, reverbSend: 0.1, pitchCents: 60 }),
  harvest: m({}, { priority: 40, gainDb: -6, variants: 4, maxInstances: 2, minIntervalMs: 200, refDistance: 12, maxDistance: 400, reverbSend: 0.12 }),
  thunder: m({}, { rate: 'half', priority: 65, gainDb: -1, variants: 3, maxInstances: 2, minIntervalMs: 1500, refDistance: 600, maxDistance: 20000, rolloff: 0.5, reverbSend: 0.15, pitchCents: 120, gainJitterDb: 3, duckMusicDb: -2 }),
  bell: m({}, { priority: 50, gainDb: -7, variants: 3, maxInstances: 2, minIntervalMs: 200, refDistance: 10, maxDistance: 450, reverbSend: 0.3, pitchCents: 30 }),
  // --- Melee (hero:combat drives most of these) ---
  sword_light: m(MELEE, { gainDb: -6, variants: 6 }),
  sword_heavy: m(MELEE, { gainDb: -4, variants: 5 }),
  parry_ring: m(MELEE, { gainDb: -3, variants: 4, priority: 85, duckMusicDb: -2, pitchCents: 50 }),
  block_thud: m(MELEE, { gainDb: -4, variants: 5 }),
  roll_cloth: m(MELEE, { gainDb: -7, variants: 4, priority: 65 }),
  body_hit: m(MELEE, { gainDb: -4, variants: 6 }),
  stagger_grunt: m(MELEE, { gainDb: -6, variants: 5, priority: 70, minIntervalMs: 250 }),
  salve: m(MELEE, { gainDb: -6, variants: 3, priority: 75, maxInstances: 1, minIntervalMs: 500 }),
  // --- World events, construction, sieges, surfaces ---
  bell_temple: m({}, { rate: 'half', priority: 55, gainDb: -4, variants: 3, maxInstances: 2, minIntervalMs: 600, refDistance: 40, maxDistance: 1600, rolloff: 0.8, reverbSend: 0.4, pitchCents: 30 }),
  construction_complete: m({}, { rate: 'half', priority: 70, gainDb: -3, variants: 3, maxInstances: 2, minIntervalMs: 500, refDistance: 60, maxDistance: 3000, rolloff: 0.6, reverbSend: 0.25, duckMusicDb: -3, pitchCents: 20 }),
  landmark_complete: m({}, { rate: 'half', priority: 95, gainDb: -1, variants: 2, maxInstances: 1, minIntervalMs: 2000, refDistance: 150, maxDistance: 8000, rolloff: 0.4, reverbSend: 0.35, duckMusicDb: -6, pitchCents: 10 }),
  age_up_fanfare: m({}, { rate: 'half', priority: 96, gainDb: 0, variants: 2, maxInstances: 1, minIntervalMs: 3000, refDistance: 200, maxDistance: 10000, rolloff: 0.3, reverbSend: 0.35, duckMusicDb: -8, pitchCents: 0 }),
  market_coins: m({}, { priority: 50, gainDb: -7, variants: 4, maxInstances: 2, minIntervalMs: 200, refDistance: 8, maxDistance: 300, reverbSend: 0.12 }),
  gate_break: m({}, { rate: 'half', priority: 88, gainDb: 0, variants: 3, maxInstances: 1, minIntervalMs: 800, refDistance: 50, maxDistance: 2000, rolloff: 0.75, reverbSend: 0.3, duckMusicDb: -4, pitchCents: 60 }),
  wall_crumble: m({}, { rate: 'half', priority: 86, gainDb: 0, variants: 2, maxInstances: 2, minIntervalMs: 800, refDistance: 60, maxDistance: 2200, rolloff: 0.75, reverbSend: 0.3, duckMusicDb: -4, pitchCents: 60 }),
  ram_hit: m({}, { rate: 'half', priority: 70, gainDb: -2, variants: 4, maxInstances: 2, minIntervalMs: 250, refDistance: 35, maxDistance: 1300, rolloff: 0.85, reverbSend: 0.28, pitchCents: 70 }),
  fire_crackle: m({}, { rate: 'half', priority: 30, gainDb: -8, variants: 4, maxInstances: 3, minIntervalMs: 300, refDistance: 6, maxDistance: 220, reverbSend: 0.1, pitchCents: 120 }),
  river_splash: m({}, { priority: 35, gainDb: -6, variants: 5, maxInstances: 3, minIntervalMs: 80, refDistance: 6, maxDistance: 220, reverbSend: 0.12, pitchCents: 150 }),
  footstep_stone: m(FOOT, {}),
  footstep_dirt: m(FOOT, {}),
  // --- Internal ---
  fx_perfect_dodge: m(MELEE, { gainDb: -6, variants: 2, priority: 82, maxInstances: 1, duckMusicDb: -6, pitchCents: 0, minIntervalMs: 300 }),
  fx_finisher_boom: m(MELEE, { rate: 'half', gainDb: -3, variants: 3, priority: 84, maxInstances: 1, duckMusicDb: -4, minIntervalMs: 200 }),
  fx_hit_metal: m(MELEE, { gainDb: -8, variants: 4, priority: 60 }),
  fx_thunder_far: m({}, { rate: 'half', priority: 40, gainDb: -6, variants: 2, maxInstances: 2, minIntervalMs: 2500, refDistance: 2000, maxDistance: 40000, rolloff: 0.4, reverbSend: 0.1, pitchCents: 150, gainJitterDb: 3 }),
};

export type SfxGroup = 'ui' | 'world' | 'battle' | 'hero';

/**
 * Which contexts need a sound loaded (the bank keeps only the groups of the current mood: UI always).
 * A sound requested outside its groups is rendered on demand (its first trigger is silent).
 */
export const SFX_GROUPS: Record<SfxSoundId, readonly SfxGroup[]> = {
  ui_click: ['ui'], ui_hover: ['ui'], ui_open: ['ui'], ui_close: ['ui'], ui_confirm: ['ui'], ui_error: ['ui'], notify: ['ui'], order_ack: ['ui'],
  march: ['world', 'battle'], charge_horn: ['world', 'battle'], conch: ['world', 'battle', 'hero'], drum_hit: ['world', 'battle'],
  arrow_volley: ['battle'], arrow_impact: ['battle'], clash: ['battle'], elephant_trumpet: ['battle', 'hero'], horse_neigh: ['world', 'battle', 'hero'],
  cheer: ['world', 'battle'], rout_cry: ['battle'],
  build: ['world'], coins: ['world'], harvest: ['world'], thunder: ['world', 'battle', 'hero'], bell: ['world', 'hero'],
  sword_light: ['hero'], sword_heavy: ['hero'], parry_ring: ['hero'], block_thud: ['hero'], roll_cloth: ['hero'], body_hit: ['hero'], stagger_grunt: ['hero'], salve: ['hero'],
  bell_temple: ['world', 'hero'], construction_complete: ['world'], landmark_complete: ['world'], age_up_fanfare: ['world'], market_coins: ['world', 'hero'],
  gate_break: ['battle'], wall_crumble: ['battle', 'world'], ram_hit: ['battle'], fire_crackle: ['world', 'battle', 'hero'], river_splash: ['world', 'hero'],
  footstep_stone: ['hero'], footstep_dirt: ['hero'],
  fx_perfect_dodge: ['hero'], fx_finisher_boom: ['hero'], fx_hit_metal: ['hero'], fx_thunder_far: ['world', 'battle', 'hero'],
};

/** Variant count at a quality tier (low 0.5x, medium 0.75x, high 1x, ultra 1.25x; at least 2). */
export function variantsForTier(meta: SfxMeta, tier: 'low' | 'medium' | 'high' | 'ultra'): number {
  const k = tier === 'low' ? 0.5 : tier === 'medium' ? 0.75 : tier === 'ultra' ? 1.25 : 1;
  return Math.max(2, Math.round(meta.variants * k));
}

/** Sample rate an SFX is rendered at for a context running at `sr`. */
export function sfxRenderRate(id: SfxSoundId, sr: number): number {
  return SFX_META[id].rate === 'half' ? Math.round(sr / 2) : sr;
}

export function isSfxSoundId(id: string): id is SfxSoundId {
  return Object.prototype.hasOwnProperty.call(SFX_META, id);
}
