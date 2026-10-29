/**
 * Ambience catalog metadata (main-thread safe, no DSP). Every key the scenes may send in 'audio:ambience'
 * (all HeroDistrictDef.ambience values + world beds + the battle bed) with:
 *  - an optional BED: a seamless mono loop (played as two offset playheads -> decorrelated stereo),
 *  - SPOTS: one-shot events scheduled as a Poisson process around the listener (positional, random
 *    azimuth / distance, low voice priority), so loops never feel repeated.
 * Renderers live in `ambience/render.ts` (worker / node only).
 * OWNER: Audio Developer (AUD-01).
 */
import type { EnvironmentState } from '../../core/types';

export type AmbienceCategory = 'district' | 'world' | 'battle';

export interface BedSpec {
  /** Loop length (s). */
  seconds: number;
  /** Render at the full context rate or half of it (dark textures: half the memory). */
  rate: 'full' | 'half';
  /** Mix trim (dB) at layer gain 1. */
  gainDb: number;
}

export interface SpotSpec {
  /** Sound id `spot:<key>:<name>` is rendered by ambience/render.ts. */
  name: string;
  variants: number;
  /** Mean events per minute at layer gain 1. */
  perMinute: number;
  /** Playback gain range (dB). */
  gainDb: readonly [number, number];
  /** Distance range from the listener (m). */
  distance: readonly [number, number];
  /** Elevation range (m above listener) - birds, bells on towers. */
  height?: readonly [number, number];
}

export interface AmbienceDef {
  key: string;
  category: AmbienceCategory;
  label: string;
  bed?: BedSpec;
  spots: readonly SpotSpec[];
}

const D = (key: string, label: string, bed: BedSpec | undefined, spots: SpotSpec[]): AmbienceDef => ({ key, category: 'district', label, bed, spots });
const W = (key: string, label: string, bed: BedSpec | undefined, spots: SpotSpec[]): AmbienceDef => ({ key, category: 'world', label, bed, spots });
const S = (name: string, variants: number, perMinute: number, gainDb: readonly [number, number], distance: readonly [number, number], height?: readonly [number, number]): SpotSpec => ({ name, variants, perMinute, gainDb, distance, height });

export const AMBIENCE_DEFS: readonly AmbienceDef[] = [
  // --- Rajaghat: the royal ghats ---
  D('river_lap', 'River lapping at the ghat steps', { seconds: 16, rate: 'full', gainDb: -10 }, [S('lap_splash', 4, 6, [-16, -8], [3, 14])]),
  D('temple_bells_far', 'Far temple bells across the water', undefined, [S('handbell_far', 4, 2.4, [-14, -7], [120, 320], [5, 20]), S('ghanta_far', 3, 0.8, [-12, -6], [150, 400], [5, 20])]),
  D('boatmen_calls', 'Boatmen calling on the river', undefined, [S('boatman_call', 5, 2, [-12, -5], [40, 160]), S('oar', 4, 4, [-16, -9], [15, 70])]),
  D('crows', 'House crows', undefined, [S('crow', 6, 6, [-14, -6], [12, 80], [4, 18])]),
  // --- Dhanyakoshtha: the granary quarter ---
  D('threshing', 'Threshing floor: flails and winnowing', undefined, [S('flail', 4, 6, [-14, -7], [10, 40]), S('winnow', 3, 3, [-16, -9], [8, 30])]),
  D('scribes_counting', 'Scribes counting measures', { seconds: 14, rate: 'half', gainDb: -16 }, [S('count_voice', 5, 4, [-14, -8], [4, 15]), S('stylus', 4, 6, [-20, -12], [2, 8]), S('weights', 3, 3, [-16, -10], [3, 10])]),
  D('oxcarts', 'Ox-carts creaking past', undefined, [S('oxcart', 4, 3, [-12, -6], [8, 45])]),
  // --- Vipani: the great bazaar ---
  D('bazaar_crowd', 'Bazaar crowd murmur', { seconds: 18, rate: 'half', gainDb: -8 }, [S('laugh', 4, 5, [-16, -9], [5, 25]), S('bargain', 5, 6, [-14, -8], [4, 18])]),
  D('hawkers', 'Hawkers crying their wares', undefined, [S('hawker', 6, 10, [-12, -6], [8, 45])]),
  D('copper_beaten', 'Coppersmiths beating vessels', undefined, [S('copper', 5, 6, [-14, -7], [10, 40])]),
  D('cart_bells', 'Cart bells and jingles', undefined, [S('cartbell', 4, 4, [-14, -8], [6, 35])]),
  // --- Devalaya: the temple precinct ---
  D('temple_bells', 'Temple bells rung by priests', undefined, [S('handbell', 4, 4, [-12, -6], [15, 50], [2, 10]), S('ghanta', 3, 1.5, [-10, -5], [20, 60], [3, 12])]),
  D('chanting_low', 'Low Vedic chanting', { seconds: 20, rate: 'half', gainDb: -9 }, []),
  D('water_drip', 'Dripping water in the stepwell', { seconds: 12, rate: 'half', gainDb: -26 }, [S('drip', 6, 30, [-18, -8], [2, 10])]),
  // --- Rajaprasada: the palace citadel ---
  D('court_murmur', 'Court murmur under the pillars', { seconds: 18, rate: 'half', gainDb: -10 }, [S('bangles', 4, 3, [-18, -11], [4, 18]), S('herald', 3, 0.8, [-12, -7], [15, 40])]),
  D('fountain', 'Palace fountain', { seconds: 12, rate: 'full', gainDb: -11 }, []),
  D('conch_far', 'Far conch', undefined, [S('conch_far', 3, 0.6, [-10, -5], [300, 800], [5, 20])]),
  // --- Shastrashala: arms yard and elephant lines ---
  D('drill_drums', 'Drill drums and shouted drill', undefined, [S('drill', 4, 3, [-10, -5], [20, 60])]),
  D('elephant_rumble', 'Elephant lines: rumbles and chains', undefined, [S('rumble', 4, 3, [-10, -4], [15, 50]), S('trumpet_far', 3, 0.5, [-12, -7], [60, 160]), S('chains', 3, 2, [-18, -10], [10, 35])]),
  D('blades_clash', 'Sparring blades', undefined, [S('sparring', 5, 5, [-12, -6], [10, 40])]),
  // --- Shilpivithi: the artisans' lane ---
  D('potters_wheel', 'Potters’ wheels', { seconds: 12, rate: 'half', gainDb: -16 }, [S('clay_slap', 4, 8, [-16, -9], [4, 18])]),
  D('looms', 'Handlooms', undefined, [S('loom', 4, 7, [-12, -6], [5, 25])]),
  D('children', 'Children playing', undefined, [S('child', 6, 10, [-14, -7], [10, 50])]),
  // --- Tirthaghat (duel set piece) ---
  D('river_wide', 'The wide river', { seconds: 18, rate: 'half', gainDb: -8 }, [S('fish_jump', 3, 2, [-16, -10], [10, 60]), S('kingfisher', 3, 1, [-16, -9], [20, 80], [2, 8])]),
  D('conch', 'Conch blown nearby', undefined, [S('conch_near', 3, 0.8, [-8, -3], [25, 80])]),
  D('chanting_far', 'Far chanting', { seconds: 20, rate: 'half', gainDb: -14 }, []),
  // --- World beds (season / weather / time of day) ---
  W('wind', 'Wind', { seconds: 16, rate: 'half', gainDb: -10 }, []),
  W('wind_storm', 'Storm / dust-storm wind', { seconds: 16, rate: 'half', gainDb: -6 }, []),
  W('rain_light', 'Light rain', { seconds: 12, rate: 'full', gainDb: -12 }, []),
  W('rain_monsoon', 'Monsoon downpour', { seconds: 14, rate: 'full', gainDb: -7 }, [S('peacock', 3, 1.2, [-12, -7], [40, 150])]),
  W('thunder_far', 'Distant thunder', undefined, [S('thunder', 4, 1.6, [-6, 0], [2500, 8000])]),
  W('dawn_birds', 'Dawn chorus', { seconds: 20, rate: 'full', gainDb: -16 }, [S('koel', 4, 2, [-12, -6], [20, 80], [4, 15]), S('bulbul', 4, 4, [-14, -8], [8, 40], [2, 8]), S('sparrows', 4, 6, [-16, -10], [5, 25], [1, 6]), S('dove', 3, 2, [-16, -10], [10, 40], [3, 10])]),
  W('day_birds', 'Daytime birds', undefined, [S('myna', 4, 3, [-14, -8], [8, 40], [2, 8]), S('sparrows', 4, 4, [-16, -10], [5, 25], [1, 6]), S('dove', 3, 1.5, [-16, -10], [10, 40], [3, 10]), S('kingfisher', 3, 0.6, [-18, -10], [20, 80], [2, 8])]),
  W('cicadas', 'Noon cicadas', { seconds: 14, rate: 'full', gainDb: -20 }, []),
  W('night_crickets', 'Night crickets', { seconds: 14, rate: 'full', gainDb: -18 }, [S('owl', 3, 1, [-14, -8], [30, 120], [5, 15]), S('jackals', 3, 0.4, [-14, -8], [300, 900])]),
  W('night_frogs', 'Monsoon frogs', { seconds: 14, rate: 'half', gainDb: -14 }, []),
  // --- Battle bed (crowd roar scaled by engaged soldiers, distant drums) ---
  { key: 'battle_roar', category: 'battle', label: 'Battle roar of engaged soldiers', bed: { seconds: 16, rate: 'half', gainDb: -6 }, spots: [S('war_cry', 5, 6, [-12, -6], [20, 120]), S('melee', 6, 10, [-14, -6], [15, 90])] },
  { key: 'battle_drums', category: 'battle', label: 'Distant war drums', bed: { seconds: 0, rate: 'half', gainDb: -10 }, spots: [S('horn_far', 3, 0.8, [-12, -6], [200, 600])] },
];

const BY_KEY = new Map(AMBIENCE_DEFS.map((d) => [d.key, d]));

export function ambienceDef(key: string): AmbienceDef | undefined {
  return BY_KEY.get(key);
}

export const AMBIENCE_KEYS: readonly string[] = AMBIENCE_DEFS.map((d) => d.key);

/** Battle drum loop: 8 bars of 4/4 at this tempo, so the rhythm continues across the seam. */
export const BATTLE_DRUM_BPM = 108;
export function battleDrumLoopSeconds(): number {
  return (8 * 4 * 60) / BATTLE_DRUM_BPM;
}

export function bedSeconds(def: AmbienceDef): number {
  if (!def.bed) return 0;
  return def.key === 'battle_drums' ? battleDrumLoopSeconds() : def.bed.seconds;
}

/** Distance exponent for ambience spots (gentler than SFX: the gain range already spreads them). */
export const SPOT_ROLLOFF = 0.6;

/**
 * First event of a spot type after its layer starts: within the first mean interval, capped at 6 s, so a
 * district announces itself soon after the player arrives. `u` is uniform [0, 1).
 */
export function firstSpotDelay(spot: SpotSpec, u: number): number {
  return u * Math.min(6, 60 / Math.max(0.01, spot.perMinute));
}

/** Sound id of an ambience bed / spot (bank keys shared by the worker and the runtime). */
export const bedId = (key: string): string => `bed:${key}`;
export const spotId = (key: string, name: string): string => `spot:${key}:${name}`;

export interface AmbienceLayer {
  key: string;
  gain: number;
}

function window01(h: number, a: number, b: number, c: number, d: number): number {
  // 0 before a, ramps to 1 by b, holds to c, ramps to 0 by d (hours; handles wrap past midnight).
  const hh = ((h % 24) + 24) % 24;
  const x = d < a && hh < a ? hh + 24 : hh;
  const dd = d < a ? d + 24 : d;
  const cc = c < a ? c + 24 : c;
  const bb = b < a ? b + 24 : b;
  if (x <= a || x >= dd) return 0;
  if (x < bb) return (x - a) / (bb - a);
  if (x <= cc) return 1;
  return 1 - (x - cc) / (dd - cc);
}

/**
 * World beds for an environment (season, weather, hour): wind by wind speed, rain by precipitation,
 * thunder in storms, dawn chorus, day birds, noon cicadas in the hot seasons, night crickets, monsoon
 * frogs and peacocks. Appends into `out` (cleared first) and returns it.
 */
export function worldBedLayers(env: Pick<EnvironmentState, 'hour' | 'season' | 'weather'>, out: AmbienceLayer[] = []): AmbienceLayer[] {
  out.length = 0;
  const w = env.weather;
  const rain = Math.max(0, Math.min(1, w.rain));
  const wind = Math.max(0, Math.min(1, w.windSpeed / 14));
  const storm = w.kind === 'storm' || w.kind === 'dust_storm';
  const h = env.hour;
  out.push({ key: 'wind', gain: 0.25 + 0.6 * wind });
  if (storm || wind > 0.7) out.push({ key: 'wind_storm', gain: storm ? 0.85 : (wind - 0.7) * 2 });
  if (rain > 0.02) {
    if (rain < 0.45 && w.kind !== 'monsoon_rain' && w.kind !== 'storm') out.push({ key: 'rain_light', gain: 0.4 + rain });
    else out.push({ key: 'rain_monsoon', gain: 0.5 + 0.5 * rain });
  }
  if (w.kind === 'storm' || (w.kind === 'monsoon_rain' && rain > 0.6)) out.push({ key: 'thunder_far', gain: storm ? 1 : 0.5 });
  const quiet = 1 - 0.8 * rain;
  const dawn = window01(h, 4.8, 5.8, 7.3, 9) * quiet;
  if (dawn > 0.01) out.push({ key: 'dawn_birds', gain: dawn });
  const day = window01(h, 7.5, 9, 16.5, 18.5) * quiet;
  if (day > 0.01) out.push({ key: 'day_birds', gain: day * 0.8 });
  const hot = env.season === 'grishma' || env.season === 'vasanta' ? 1 : env.season === 'sharad' ? 0.4 : 0;
  const noon = window01(h, 10, 12, 15, 17) * hot * quiet;
  if (noon > 0.01) out.push({ key: 'cicadas', gain: noon });
  const cold = env.season === 'shishira' ? 0.35 : env.season === 'hemanta' ? 0.7 : 1;
  const night = window01(h, 18.5, 20, 4.5, 5.5);
  if (night > 0.01) out.push({ key: 'night_crickets', gain: night * cold * (1 - 0.5 * rain) });
  if (env.season === 'varsha' && night > 0.01) out.push({ key: 'night_frogs', gain: night * (0.5 + 0.5 * rain) });
  return out;
}
