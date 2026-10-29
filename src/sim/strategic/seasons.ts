/**
 * Calendar, seasons (six ritus), weather, the monsoon roll and floods (DESIGN_SPEC §7.1, §7.3.3).
 * OWNER: Simulation Engineer - Strategic World Simulation (SIM-01). Baseline calendar math by the CTO.
 * Sim code: deterministic, three-free; weather uses world.rng, the monsoon uses a per-year derived seed so the
 * month-3 forecast and the month-4 roll agree (the forecast is computed from the same draw, +-0.15 noise).
 */
import type { CalendarState, EnvironmentState, MonsoonState, RoadQuality, Season, SimEvent, TerrainClass, WeatherKind, WeatherState, WorldState } from '../../core/types';
import { DAYS_PER_MONTH, DAYS_PER_YEAR, HOURS_PER_DAY, MONTHS_PER_YEAR, SEASONS } from '../../core/types';
import { deriveSeed, Rng } from '../../core/rng';
import { BALANCE } from '../../data/balance';
import { RULES } from '../../data/rules';
import { SCENARIOS } from '../../data/campaign';

export const MONTH_NAMES = [
  'Chaitra',
  'Vaishakha',
  'Jyeshtha',
  'Ashadha',
  'Shravana',
  'Bhadrapada',
  'Ashvin',
  'Kartika',
  'Margashirsha',
  'Pausha',
  'Magha',
  'Phalguna',
] as const;

export const SEASON_NAMES: Readonly<Record<Season, { name: string; english: string }>> = {
  vasanta: { name: 'Vasanta', english: 'Spring' },
  grishma: { name: 'Grishma', english: 'Summer' },
  varsha: { name: 'Varsha', english: 'Monsoon' },
  sharad: { name: 'Sharad', english: 'Autumn' },
  hemanta: { name: 'Hemanta', english: 'Pre-winter' },
  shishira: { name: 'Shishira', english: 'Winter' },
};

/** Season for a month index (two months per ritu). */
export function seasonOfMonth(month: number): Season {
  return SEASONS[Math.floor((((month % 12) + 12) % 12) / 2)] as Season;
}

export function seasonOf(cal: CalendarState): Season {
  return seasonOfMonth(cal.month);
}

export function dayOfYear(cal: CalendarState): number {
  return cal.month * DAYS_PER_MONTH + cal.day;
}

/** Whole days since campaign start. */
export function totalDays(cal: CalendarState): number {
  return Math.floor(cal.totalHours / HOURS_PER_DAY);
}

export function createCalendar(year: number, month: number): CalendarState {
  return { year, month, day: 0, hour: 8, totalHours: 8 };
}

export interface CalendarAdvance {
  newDay: boolean;
  newMonth: boolean;
  newYear: boolean;
  seasonChanged: boolean;
}

/** Advance by whole hours (mutates). */
export function advanceCalendar(cal: CalendarState, hours: number, out: CalendarAdvance): CalendarAdvance {
  out.newDay = false;
  out.newMonth = false;
  out.newYear = false;
  out.seasonChanged = false;
  const seasonBefore = seasonOfMonth(cal.month);
  for (let i = 0; i < hours; i++) {
    cal.totalHours += 1;
    cal.hour += 1;
    if (cal.hour >= HOURS_PER_DAY) {
      cal.hour = 0;
      cal.day += 1;
      out.newDay = true;
      if (cal.day >= DAYS_PER_MONTH) {
        cal.day = 0;
        cal.month += 1;
        out.newMonth = true;
        if (cal.month >= MONTHS_PER_YEAR) {
          cal.month = 0;
          cal.year += 1;
          out.newYear = true;
        }
      }
    }
  }
  out.seasonChanged = seasonOfMonth(cal.month) !== seasonBefore;
  return out;
}

/** "12 Shravana, 300 BCE" */
export function formatDate(cal: CalendarState): string {
  const y = cal.year < 0 ? `${-cal.year} BCE` : `${cal.year} CE`;
  return `${cal.day + 1} ${MONTH_NAMES[cal.month]}, ${y}`;
}

const SEASON_WEATHER: Readonly<Record<Season, readonly [WeatherKind, number][]>> = {
  vasanta: [
    ['clear', 5],
    ['hazy', 3],
    ['cloudy', 1],
  ],
  grishma: [
    ['clear', 4],
    ['hazy', 4],
    ['dust_storm', 1],
  ],
  varsha: [
    ['monsoon_rain', 5],
    ['overcast', 3],
    ['light_rain', 2],
    ['storm', 1],
  ],
  sharad: [
    ['clear', 5],
    ['cloudy', 2],
    ['light_rain', 1],
  ],
  hemanta: [
    ['clear', 5],
    ['hazy', 2],
    ['fog', 1],
  ],
  shishira: [
    ['clear', 4],
    ['fog', 3],
    ['cloudy', 1],
  ],
};

const SEASON_TEMP: Readonly<Record<Season, number>> = { vasanta: 27, grishma: 36, varsha: 29, sharad: 27, hemanta: 21, shishira: 16 };

/** A plausible weather state for a kind + season (used for initial state and overrides). */
export function makeWeather(kind: WeatherKind, season: Season, windDirection = 0.6): WeatherState {
  const wet = kind === 'monsoon_rain' || kind === 'storm' ? 0.85 : kind === 'light_rain' ? 0.45 : season === 'varsha' ? 0.5 : 0.1;
  const cloud: Record<WeatherKind, number> = {
    clear: 0.08,
    hazy: 0.2,
    cloudy: 0.5,
    overcast: 0.85,
    light_rain: 0.75,
    monsoon_rain: 0.95,
    storm: 1,
    dust_storm: 0.4,
    fog: 0.3,
  };
  const rain: Record<WeatherKind, number> = {
    clear: 0,
    hazy: 0,
    cloudy: 0,
    overcast: 0,
    light_rain: 0.35,
    monsoon_rain: 0.8,
    storm: 1,
    dust_storm: 0,
    fog: 0,
  };
  const vis: Record<WeatherKind, number> = {
    clear: 9000,
    hazy: 4000,
    cloudy: 7000,
    overcast: 5000,
    light_rain: 3000,
    monsoon_rain: 1200,
    storm: 600,
    dust_storm: 500,
    fog: 350,
  };
  return {
    kind,
    cloudCover: cloud[kind],
    rain: rain[kind],
    windDirection,
    windSpeed: kind === 'storm' || kind === 'dust_storm' ? 12 : kind === 'monsoon_rain' ? 7 : 3,
    temperatureC: SEASON_TEMP[season],
    humidity: season === 'varsha' ? 0.9 : season === 'grishma' ? 0.35 : 0.55,
    visibility: vis[kind],
    wetness: wet,
    flood: season === 'varsha' ? 0.3 : 0,
    daysRemaining: 3,
  };
}

/** Varsha weather when the monsoon fails (M < 0.7) or floods (M > 1.2). */
const VARSHA_FAILED: readonly [WeatherKind, number][] = [
  ['hazy', 3],
  ['clear', 3],
  ['cloudy', 2],
  ['light_rain', 2],
  ['dust_storm', 1],
];
const VARSHA_FLOOD: readonly [WeatherKind, number][] = [
  ['monsoon_rain', 6],
  ['storm', 2],
  ['overcast', 2],
  ['light_rain', 1],
];

function weatherTable(world: WorldState, season: Season): readonly [WeatherKind, number][] {
  if (season === 'varsha') {
    const m = world.monsoon.strength;
    if (m < RULES.harvest.monsoon.droughtBelow) return VARSHA_FAILED;
    if (m > RULES.harvest.monsoon.floodAbove) return VARSHA_FLOOD;
  }
  return SEASON_WEATHER[season];
}

/** Roll new weather when the current spell ends (call once per day). Keeps wetness and the monsoon flood level. */
export function updateWeatherDaily(world: WorldState): WeatherKind | null {
  const w = world.weather;
  w.daysRemaining -= 1;
  const season = seasonOf(world.calendar);
  // Ground slowly dries or soaks.
  w.wetness = Math.min(1, Math.max(0, w.wetness + (w.rain > 0 ? 0.15 * w.rain : -0.08)));
  w.flood = floodLevel(world.calendar.month, world.monsoon.strength);
  if (w.daysRemaining > 0) return null;
  const rng = new Rng(world.rng);
  const table = weatherTable(world, season);
  const idx = rng.weightedIndex(table.map((t) => t[1]));
  const kind = (table[idx] as [WeatherKind, number])[0];
  const next = makeWeather(kind, season, w.windDirection + rng.range(-0.4, 0.4));
  next.daysRemaining = rng.int(2, 6);
  next.wetness = w.wetness;
  next.flood = w.flood;
  world.rng = rng.getState();
  const changed = next.kind !== w.kind;
  Object.assign(w, next);
  return changed ? kind : null;
}

// ---------------------------------------------------------------------------------------------------
// The monsoon (DESIGN_SPEC §7.3.2-§7.3.3)
// ---------------------------------------------------------------------------------------------------

/** Calendar month of the roll (varsha) and the day within it ("day 1 of month 4" = calendar.day 1). */
export const MONSOON_ROLL_MONTH = 4;
export const MONSOON_ROLL_DAY = 1;
/** Flags are cleared on the first day of this month (after the kharif harvest). */
export const MONSOON_FLAGS_CLEAR_MONTH = 8;

/**
 * River flood stage for a month given this year's monsoon M: `clamp01((M - 0.9) x 2)` at the varsha peak (month 5),
 * rising in month 4 and receding in month 6. Fords close while flood > 0.5 (M > 1.15 at the peak).
 */
export function floodLevel(month: number, m: number): number {
  const peak = Math.min(1, Math.max(0, (m - 0.9) * 2));
  if (month === 5) return peak;
  if (month === 4) return peak * 0.5;
  if (month === 6) return peak * 0.25;
  return 0;
}

/** Mean monsoon for the world: 1 x sandbox monsoonStrength (campaigns: 1). */
export function monsoonMean(world: WorldState): number {
  return 1 * (world.sandbox?.monsoonStrength ?? 1);
}

/**
 * The monsoon strength M of display year `year`, drawn from a seed derived from (world seed, year) so the month-3
 * forecast can quote it before the month-4 roll. A scenario's monsoonStrength fixes its start year; sandbox drought
 * years (probability droughtRisk) draw M = U(0.45, 0.7); otherwise clamp(normal(mean, 0.18), 0.4, 1.4).
 */
export function monsoonStrengthFor(world: WorldState, year: number): number {
  const sc = world.scenarioId ? SCENARIOS[world.scenarioId] : undefined;
  if (sc && sc.monsoonStrength !== undefined && year === sc.startYear) return sc.monsoonStrength;
  const r = RULES.harvest.monsoon;
  const rng = new Rng(deriveSeed(world.seed, 'monsoon', year | 0));
  const drought = world.sandbox ? rng.chance(world.sandbox.droughtRisk) : false;
  const normal = rng.normal(r.mean * monsoonMean(world), r.sd);
  const droughtM = rng.range(0.45, r.droughtBelow);
  const m = drought ? droughtM : normal;
  return Math.min(r.max, Math.max(r.min, m));
}

export function monsoonResult(m: number): 'failed' | 'normal' | 'flood' {
  return m < RULES.harvest.monsoon.droughtBelow ? 'failed' : m > RULES.harvest.monsoon.floodAbove ? 'flood' : 'normal';
}

/** Forecast quoted in month 3: M +- 0.15 (exact when the player's court scholar has learning >= 12). */
export function monsoonForecastFor(world: WorldState, year: number): number {
  const m = monsoonStrengthFor(world, year);
  const p = world.factions[world.playerFactionId];
  const scholar = p?.council.court_scholar ? world.characters[p.council.court_scholar] : null;
  if (scholar && scholar.alive && scholar.skills.learning >= 12) return m;
  const rng = new Rng(deriveSeed(world.seed, 'monsoon_forecast', year | 0));
  return Math.round((m + rng.range(-0.15, 0.15)) * 100) / 100;
}

/**
 * Daily monsoon bookkeeping (call on every new day, before the economy): month-3 forecast, the month-4 day-1 roll
 * (flags monsoon_failed / monsoon_flood + SimEvent), flag clearing in month 8, flood stage.
 */
export function updateMonsoonDaily(world: WorldState, out: SimEvent[]): void {
  const cal = world.calendar;
  const mon: MonsoonState = world.monsoon;
  if (cal.month === 3 && cal.day === 0) mon.forecast = monsoonForecastFor(world, cal.year);
  if (cal.month === MONSOON_ROLL_MONTH && cal.day === MONSOON_ROLL_DAY) {
    mon.strength = monsoonStrengthFor(world, cal.year);
    mon.year = cal.year;
    mon.forecast = null;
    const result = monsoonResult(mon.strength);
    delete world.events.flags.monsoon_failed;
    delete world.events.flags.monsoon_flood;
    if (result === 'failed') world.events.flags.monsoon_failed = true;
    if (result === 'flood') world.events.flags.monsoon_flood = true;
    out.push({ kind: 'monsoon_roll', strength: mon.strength, year: mon.year, result });
  }
  if (cal.month === MONSOON_FLAGS_CLEAR_MONTH && cal.day === 0) {
    delete world.events.flags.monsoon_failed;
    delete world.events.flags.monsoon_flood;
  }
  world.weather.flood = floodLevel(cal.month, mon.strength);
}

/** Kharif / rabi yield multipliers for monsoon M and settlement irrigation (DESIGN_SPEC §7.3.2). */
export function monsoonYields(m: number, irrigation: number): { ym: number; kharif: number; rabi: number } {
  const e = BALANCE.economy;
  const ym = m >= 1 ? 1 + (e.monsoonYieldBonus * (m - 1)) / 0.4 : Math.max(0.3, 1 - (e.droughtYieldPenalty * (1 - m)) / 0.3);
  const irr = Math.min(1, Math.max(0, irrigation));
  const shield = irr * RULES.harvest.irrigationShield;
  const kharif = ym * (1 - shield) + shield * (1 + e.irrigationYieldBonus);
  const rabi = (0.7 + 0.3 * Math.min(m, 1.2)) * (1 - irr * 0.5) + irr * 0.5 * (1 + e.irrigationYieldBonus);
  return { ym, kharif, rabi };
}

/** Environment for render/audio from the world state (time of day, season, weather). */
export function getEnvironmentState(world: WorldState): EnvironmentState {
  return {
    hour: world.calendar.hour,
    dayOfYear: dayOfYear(world.calendar),
    season: seasonOf(world.calendar),
    weather: { ...world.weather },
    latitude: 25,
    moonPhase: (totalDays(world.calendar) % 30) / 30,
  };
}

/** Standalone environment (skirmish / hero / menu). */
export function makeEnvironment(hour: number, season: Season, weather: WeatherKind): EnvironmentState {
  const monthOfSeason = SEASONS.indexOf(season) * 2;
  return {
    hour,
    dayOfYear: monthOfSeason * DAYS_PER_MONTH + 15,
    season,
    weather: makeWeather(weather, season),
    latitude: 25,
    moonPhase: 0.5,
  };
}

/** Strategic travel speed multiplier (terrain, road, season/weather). 1 = nominal offroad pace. */
export function travelFactor(season: Season, weather: WeatherState, terrain: TerrainClass, road: RoadQuality | null): number {
  const m = BALANCE.military;
  let f = road ? m.marchKmPerDay[road] / m.marchKmPerDay.offroad : 1;
  if (!road) {
    if (terrain === 'forest' || terrain === 'marsh') f *= 0.6;
    else if (terrain === 'hills' || terrain === 'rough') f *= 0.7;
    else if (terrain === 'shallow_water') f *= 0.4;
    else if (terrain === 'deep_water') f *= 0.1;
  }
  if (season === 'varsha') f *= m.monsoonMarchFactor + (road === 'royal_road' ? 0.2 : 0);
  f *= 1 - 0.3 * weather.wetness * (road ? 0.4 : 1);
  return Math.max(0.05, f);
}

export { DAYS_PER_YEAR };
