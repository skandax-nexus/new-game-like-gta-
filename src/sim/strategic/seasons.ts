/**
 * Calendar, seasons (six ritus), weather and environment state. OWNER: Lead AI & Simulation Engineer.
 * Baseline implementation by the CTO: calendar math + simple seasonal weather. Sim code: deterministic,
 * three-free, uses world.rng only.
 *
 * TODO(owner): monsoon strength/variability, droughts, floods raising `weather.flood`, sandbox
 * `monsoonStrength`/`droughtRisk`, forecasts for the UI.
 */
import type { CalendarState, EnvironmentState, RoadQuality, Season, TerrainClass, WeatherKind, WeatherState, WorldState } from '../../core/types';
import { DAYS_PER_MONTH, DAYS_PER_YEAR, HOURS_PER_DAY, MONTHS_PER_YEAR, SEASONS } from '../../core/types';
import { Rng } from '../../core/rng';
import { BALANCE } from '../../data/balance';

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

/** Roll new weather when the current spell ends (call once per day). */
export function updateWeatherDaily(world: WorldState): WeatherKind | null {
  const w = world.weather;
  w.daysRemaining -= 1;
  const season = seasonOf(world.calendar);
  // Ground slowly dries or soaks.
  w.wetness = Math.min(1, Math.max(0, w.wetness + (w.rain > 0 ? 0.15 * w.rain : -0.08)));
  if (w.daysRemaining > 0) return null;
  const rng = new Rng(world.rng);
  const table = SEASON_WEATHER[season];
  const idx = rng.weightedIndex(table.map((t) => t[1]));
  const kind = (table[idx] as [WeatherKind, number])[0];
  const next = makeWeather(kind, season, w.windDirection + rng.range(-0.4, 0.4));
  next.daysRemaining = rng.int(2, 6);
  next.wetness = w.wetness;
  world.rng = rng.getState();
  const changed = next.kind !== w.kind;
  Object.assign(w, next);
  return changed ? kind : null;
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
