/**
 * AUD-01 ambience: every HeroDistrictDef.ambience key is covered, every bed is a seamless loop, every
 * spot renders clean, the world beds follow season / weather / hour, and a simulated mix stays under the
 * ceiling. OWNER: Audio Developer (AUD-01).
 */
import { describe, expect, it } from 'vitest';
import { HERO_DISTRICTS } from '../../src/data/hero';
import type { EnvironmentState, WeatherKind } from '../../src/core/types';
import { AMBIENCE_DEFS, AMBIENCE_KEYS, ambienceDef, bedSeconds, worldBedLayers } from '../../src/audio/ambience/meta';
import { hasBedRenderer, hasSpotRenderer, renderBed, renderSpot, simulateAmbience } from '../../src/audio/ambience/render';
import { measure } from '../../src/audio/synth/buffer';
import { loopSeam } from '../../src/audio/synth/analysis';

const SR = 24000;

function env(hour: number, season: EnvironmentState['season'], kind: WeatherKind, rain = 0, windSpeed = 3): Pick<EnvironmentState, 'hour' | 'season' | 'weather'> {
  return { hour, season, weather: { kind, cloudCover: 0.5, rain, windDirection: 0, windSpeed, temperatureC: 30, humidity: 0.5, visibility: 5000, flood: 0, daysRemaining: 3 } as EnvironmentState['weather'] };
}

describe('ambience catalog', () => {
  it('covers every HeroDistrictDef.ambience key in the data', () => {
    const missing: string[] = [];
    for (const d of HERO_DISTRICTS) for (const k of d.ambience) if (!ambienceDef(k)) missing.push(`${d.id}: ${k}`);
    expect(missing).toEqual([]);
  });

  it('has renderers for every bed and spot', () => {
    for (const def of AMBIENCE_DEFS) {
      if (def.bed) expect(hasBedRenderer(def.key), def.key).toBe(true);
      for (const s of def.spots) expect(hasSpotRenderer(def.key, s.name), `${def.key}:${s.name}`).toBe(true);
      expect(def.bed || def.spots.length > 0, def.key).toBeTruthy();
    }
    expect(new Set(AMBIENCE_KEYS).size).toBe(AMBIENCE_KEYS.length);
  });

  it.each(AMBIENCE_DEFS.filter((d) => d.bed).map((d) => [d.key]))('bed %s is a seamless, clean loop', (key) => {
    const def = ambienceDef(key)!;
    const bed = renderBed(key, SR, 1);
    const st = measure(bed.data);
    expect(st.nan).toBe(0);
    expect(st.denormals).toBe(0);
    expect(st.peakDb).toBeLessThanOrEqual(-1);
    expect(st.rmsDb).toBeGreaterThan(-40);
    expect(bed.data.length).toBe(Math.max(1, Math.round(bedSeconds(def) * bed.sampleRate)));
    const seam = loopSeam(bed.data, bed.sampleRate);
    // The step across the wrap is no larger than ordinary sample steps; no level jump at the seam.
    expect(seam.jumpRatio, `${key} jump`).toBeLessThan(6);
    expect(seam.levelDiffDb, `${key} level`).toBeLessThan(Math.max(3, seam.typicalDiffDb + 1.5));
  });

  it('every spot renders clean (variant 0)', () => {
    for (const def of AMBIENCE_DEFS) {
      for (const s of def.spots) {
        const b = renderSpot(def.key, s.name, 0, SR, 1);
        const st = measure(b);
        expect(st.nan, `${def.key}:${s.name}`).toBe(0);
        expect(st.denormals, `${def.key}:${s.name}`).toBe(0);
        expect(st.peakDb, `${def.key}:${s.name}`).toBeLessThanOrEqual(-1);
        expect(st.peakDb, `${def.key}:${s.name}`).toBeGreaterThan(-6);
      }
    }
  });

  it('world beds follow weather, season and hour', () => {
    const keys = (e: ReturnType<typeof env>): string[] => worldBedLayers(e).filter((l) => l.gain > 0).map((l) => l.key);
    expect(keys(env(6.2, 'vasanta', 'clear'))).toEqual(expect.arrayContaining(['wind', 'dawn_birds']));
    expect(keys(env(13, 'grishma', 'clear'))).toEqual(expect.arrayContaining(['day_birds', 'cicadas']));
    expect(keys(env(23, 'sharad', 'clear'))).toContain('night_crickets');
    expect(keys(env(23, 'varsha', 'monsoon_rain', 0.9))).toEqual(expect.arrayContaining(['rain_monsoon', 'night_frogs', 'thunder_far']));
    expect(keys(env(15, 'varsha', 'storm', 1, 16))).toEqual(expect.arrayContaining(['wind_storm', 'rain_monsoon', 'thunder_far']));
    expect(keys(env(10, 'sharad', 'light_rain', 0.25))).toContain('rain_light');
    expect(keys(env(13, 'shishira', 'clear'))).not.toContain('cicadas');
    for (const l of worldBedLayers(env(5.5, 'varsha', 'storm', 0.8, 18))) {
      expect(ambienceDef(l.key), l.key).toBeDefined();
      expect(l.gain).toBeGreaterThanOrEqual(0);
      expect(l.gain).toBeLessThanOrEqual(1.2);
    }
  });

  it('a simulated district mix stays finite and under the ceiling', () => {
    for (const key of ['river_lap', 'temple_bells', 'battle_drums']) {
      const s = simulateAmbience(key, 8, SR, 2);
      for (const ch of [s.L, s.R]) {
        const st = measure(ch);
        expect(st.nan).toBe(0);
        expect(st.peakDb).toBeLessThanOrEqual(-1);
      }
    }
  });
});
