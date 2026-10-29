/**
 * Mood -> arrangement: which raga, tala, tempo range, instruments and layers the score uses for each
 * AUDIO_MOODS entry, refined by context (time of day and season for the world - the samay of ragas -,
 * hero lighting mood and district for exploration, war for the strategic map). Intensity (0..1) moves
 * the performance from alap (free, drone + melody) through jor (pulse) to gat (percussion), and fades
 * in the war layer (nagara, horns, choir) where the mood has one.
 * OWNER: Audio Developer (AUD-01).
 */
import type { AudioMood } from '../../core/events';
import type { HeroMood, Season } from '../../core/types';
import type { DrumKit } from '../synth/sources/drums';
import type { RagaId, TalaId } from './theory';

export interface MusicContext {
  hour?: number;
  season?: Season;
  /** 0..1 precipitation. */
  rain?: number;
  heroMood?: HeroMood;
  /** HeroDistrictDef.id (e.g. 'd_temple') or a district flavour inferred from ambience keys. */
  district?: string;
}

export type MelodyMode = 'bansuri' | 'vina' | 'both';

export interface Arrangement {
  /** Stable id: a mood change that keeps the id only changes intensity (no crossfade). */
  id: string;
  raga: RagaId;
  tala: TalaId;
  /** Matras per minute at intensity 0 and 1. */
  tempo: readonly [number, number];
  melody: MelodyMode;
  /** Classical percussion (gat sections). */
  kit: DrumKit | null;
  /** War layer: nagara / dhol ostinato, horn calls, choir; fades in with intensity >= warFrom. */
  war: boolean;
  warFrom: number;
  /** Tanpura level 0..1. */
  drone: number;
  /** Bell activity 0..1 (temple hand bells, chimes on sam). */
  bells: number;
  /** Choir drone level 0..1 (temple / war). */
  choir: number;
  /** Intensity thresholds: below `jor` = alap, below `gat` = jor, else gat. */
  jor: number;
  gat: number;
  /** Melody register centre (semitones from Sa; 12 = bansuri middle octave). */
  register: number;
  reverb: { rt60: number; damping: number; wet: number };
  /** Master trim (linear) applied after the mix. */
  level: number;
  /** Target RMS window (dBFS) over 30 s of the mood at its typical intensity; the AGC aims at its middle. */
  rms: readonly [number, number];
}

const BASE: Omit<Arrangement, 'id' | 'raga' | 'tala'> = {
  tempo: [60, 120],
  melody: 'bansuri',
  kit: 'pakhawaj',
  war: false,
  warFrom: 0.6,
  drone: 0.9,
  bells: 0.15,
  choir: 0,
  jor: 0.3,
  gat: 0.6,
  register: 12,
  reverb: { rt60: 3, damping: 5000, wet: 0.32 },
  level: 1,
  rms: [-26, -18],
};

function arr(id: string, raga: RagaId, tala: TalaId, over: Partial<Arrangement>): Arrangement {
  return { ...BASE, ...over, id, raga, tala };
}

/** Raga by time of day (and the monsoon), the classical samay. */
export function ragaForHour(hour: number, season?: Season, rain = 0): RagaId {
  if (season === 'varsha' && rain > 0.2) return 'megh';
  const h = ((hour % 24) + 24) % 24;
  if (h >= 4.5 && h < 8) return 'bhairav';
  if (h >= 8 && h < 11.5) return 'kafi';
  if (h >= 11.5 && h < 15.5) return 'sarang';
  if (h >= 15.5 && h < 17.5) return 'kafi';
  if (h >= 17.5 && h < 22) return 'yaman';
  return 'malkauns';
}

const HERO_MOOD_RAGA: Record<HeroMood, RagaId> = {
  dawn_mist: 'bhairav',
  golden_dust: 'yaman',
  noon_haze: 'sarang',
  monsoon_wet: 'megh',
  lamp_night: 'malkauns',
  incense_dim: 'bhairav',
};

type Flavour = 'temple' | 'bazaar' | 'palace' | 'ghat' | 'arms' | 'artisans' | 'granary' | 'none';

/** District id (HeroDistrictDef.id) -> musical flavour. */
export function districtFlavour(district: string | undefined): Flavour {
  if (!district) return 'none';
  if (/temple|devalaya|river_temple|tirtha_temple/.test(district)) return 'temple';
  if (/bazaar|vipani/.test(district)) return 'bazaar';
  if (/palace|prasada/.test(district)) return 'palace';
  if (/ghat/.test(district)) return 'ghat';
  if (/barracks|arms|shastra/.test(district)) return 'arms';
  if (/artisan|shilpi/.test(district)) return 'artisans';
  if (/granary|dhanya/.test(district)) return 'granary';
  return 'none';
}

/** Infer a district flavour from the ambience keys a scene sends (when it does not name the district). */
export function flavourFromAmbience(keys: readonly string[]): string | undefined {
  const has = (k: string): boolean => keys.includes(k);
  if (has('chanting_low') || has('temple_bells')) return 'd_temple';
  if (has('bazaar_crowd') || has('hawkers')) return 'd_bazaar';
  if (has('court_murmur') || has('fountain')) return 'd_palace';
  if (has('drill_drums') || has('elephant_rumble') || has('blades_clash')) return 'd_barracks';
  if (has('potters_wheel') || has('looms')) return 'd_artisans';
  if (has('threshing') || has('scribes_counting')) return 'd_granary';
  if (has('river_lap') || has('boatmen_calls') || has('river_wide')) return 'd_rajaghat';
  return undefined;
}

export function arrangementFor(mood: AudioMood, ctx: MusicContext = {}): Arrangement {
  switch (mood) {
    case 'menu':
      return arr('menu', 'yaman', 'jhaptal', { tempo: [52, 84], melody: 'both', drone: 1, bells: 0.15, choir: 0.15, jor: 0.25, gat: 0.7, reverb: { rt60: 3.4, damping: 4800, wet: 0.36 }, level: 1, rms: [-26, -18] });
    case 'world': {
      const raga = ragaForHour(ctx.hour ?? 17.5, ctx.season, ctx.rain ?? 0);
      return arr(`world:${raga}`, raga, raga === 'malkauns' || raga === 'bhairav' ? 'chautal' : 'rupak', {
        tempo: [56, 96], melody: raga === 'kafi' || raga === 'sarang' ? 'both' : 'bansuri', kit: 'pakhawaj', war: true, warFrom: 0.62,
        drone: 0.9, bells: raga === 'bhairav' ? 0.35 : 0.1, choir: 0.1, jor: 0.28, gat: 0.55, reverb: { rt60: 3.2, damping: 5000, wet: 0.33 }, rms: [-27, -19],
      });
    }
    case 'city':
      return arr('city', 'kafi', 'keherwa', { tempo: [84, 120], melody: 'both', kit: 'mridangam', drone: 0.7, bells: 0.25, jor: 0.05, gat: 0.15, reverb: { rt60: 2.4, damping: 5500, wet: 0.26 }, rms: [-25, -17] });
    case 'hero_explore': {
      const raga = ctx.heroMood ? HERO_MOOD_RAGA[ctx.heroMood] : ragaForHour(ctx.hour ?? 7, ctx.season, ctx.rain ?? 0);
      const fl = districtFlavour(ctx.district);
      const tala: TalaId = fl === 'temple' ? 'chautal' : fl === 'bazaar' || fl === 'granary' ? 'keherwa' : fl === 'palace' ? 'jhaptal' : fl === 'arms' ? 'teental' : 'rupak';
      return arr(`hero:${raga}:${fl}`, raga, tala, {
        tempo: fl === 'bazaar' ? [80, 112] : [54, 92],
        melody: fl === 'bazaar' || fl === 'artisans' || fl === 'granary' ? 'vina' : fl === 'palace' ? 'both' : 'bansuri',
        kit: fl === 'bazaar' || fl === 'artisans' || fl === 'granary' ? 'mridangam' : 'pakhawaj',
        drone: 0.9,
        bells: fl === 'temple' ? 0.8 : fl === 'ghat' ? 0.3 : 0.1,
        choir: fl === 'temple' ? 0.45 : fl === 'palace' ? 0.15 : 0,
        jor: 0.15,
        gat: fl === 'bazaar' || fl === 'arms' ? 0.3 : 0.5,
        reverb: fl === 'temple' ? { rt60: 4.2, damping: 4200, wet: 0.42 } : { rt60: 2.8, damping: 5200, wet: 0.3 },
        rms: [-27, -19],
      });
    }
    case 'hero_combat':
      return arr('hero_combat', 'kirwani', 'teental', { tempo: [150, 220], melody: 'both', kit: 'pakhawaj', war: true, warFrom: 0.3, drone: 0.6, bells: 0, choir: 0.25, jor: 0, gat: 0, register: 12, reverb: { rt60: 2.2, damping: 5500, wet: 0.24 }, rms: [-23, -15] });
    case 'duel':
      return arr('duel', 'marwa', 'teental', { tempo: [72, 176], melody: 'both', kit: 'pakhawaj', war: true, warFrom: 0.55, drone: 0.8, bells: 0.45, choir: 0.2, jor: 0.1, gat: 0.35, reverb: { rt60: 3.6, damping: 4500, wet: 0.36 }, rms: [-24, -16] });
    case 'battle':
      return arr('battle', 'kirwani', 'war', { tempo: [96, 140], melody: 'bansuri', kit: 'pakhawaj', war: true, warFrom: 0.05, drone: 0.55, bells: 0, choir: 0.6, jor: 0.0, gat: 0.45, register: 12, reverb: { rt60: 2.8, damping: 4800, wet: 0.3 }, rms: [-23, -15] });
    case 'siege':
      return arr('siege', 'darbari', 'war', { tempo: [76, 108], melody: 'bansuri', kit: 'pakhawaj', war: true, warFrom: 0, drone: 0.7, bells: 0, choir: 0.85, jor: 0, gat: 0.55, register: 7, reverb: { rt60: 3.4, damping: 4000, wet: 0.34 }, rms: [-23, -15] });
    case 'victory':
      return arr('victory', 'bhupali', 'dadra', { tempo: [96, 120], melody: 'both', kit: 'mridangam', war: true, warFrom: 0.85, drone: 0.8, bells: 0.7, choir: 0.3, jor: 0, gat: 0.2, reverb: { rt60: 3.2, damping: 5200, wet: 0.32 }, rms: [-24, -16] });
    case 'defeat':
      return arr('defeat', 'bhairavi', 'rupak', { tempo: [40, 60], melody: 'bansuri', kit: null, war: false, drone: 1, bells: 0.1, choir: 0.35, jor: 0.7, gat: 1.1, register: 12, reverb: { rt60: 4, damping: 3800, wet: 0.4 }, rms: [-29, -20] });
  }
}

/** Typical intensity each mood is played at (tests and offline renders; scenes send their own). */
export const TYPICAL_INTENSITY: Record<AudioMood, number> = {
  menu: 0.3,
  world: 0.3,
  city: 0.4,
  hero_explore: 0.3,
  hero_combat: 0.8,
  duel: 0.6,
  battle: 0.7,
  siege: 0.7,
  victory: 0.6,
  defeat: 0.3,
};
