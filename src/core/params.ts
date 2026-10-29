/**
 * URL parameters (deep links for QA, screenshots and testing). Owned by the CTO.
 *
 *   ?scene=menu|world|battle|hero     start directly in a scene (default: menu)
 *   &mode=campaign|sandbox|skirmish   game mode for world/battle scenes
 *   &scenario=<id>                    campaign scenario id (data/campaign.ts)
 *   &seed=N                           deterministic seed (world / skirmish / hero)
 *   &quality=low|medium|high|ultra    force a quality tier
 *   &soldiers=N                       total soldiers in a skirmish battle (default 1000, max 6000)
 *   &preset=plains|river_crossing|hills|forest_edge|plateau_fort|capital   battle terrain preset
 *   &faction=<id>&enemy=<id>          player / enemy faction for skirmish & sandbox
 *   &hour=0..24  &season=<ritu>  &weather=<kind>   environment overrides (screenshots)
 *   &freeze=1                         freeze time of day / weather changes
 *   &speed=0.5..8  &paused=1          initial sim speed / start paused
 *   &settlement=<id>                  hero scene location (default: player capital)
 *   &camera=<preset>                  camera preset name understood by the scene (e.g. overview, close, cinematic)
 *   &aivsai=1                         skirmish spectator mode
 *   &debug=1  &profiler=1             debug helpers / profiler overlay
 *   &noaudio=1  &noui=1               disable audio / hide HUD (clean screenshots)
 *   &asset=<id>                       asset viewer subject (content-pipeline manifest id, ?scene=assetviewer)
 *   &assets=ultra|high|mobile|off     force the content-pipeline asset tier (off = procedural fallbacks)
 *   &hdri=<id>  &lod=N                asset viewer environment (HDRI asset id) / forced model LOD
 */
import type { GameMode, QualityTier, SceneId, Season, TerrainPreset, WeatherKind } from './types';
import { GAME_MODES, QUALITY_TIERS, SCENE_IDS, SEASONS, TERRAIN_PRESETS, WEATHER_KINDS } from './types';
import { MAX_SOLDIERS } from './constants';

export interface UrlParams {
  scene: SceneId | null;
  mode: GameMode | null;
  scenario: string | null;
  seed: number | null;
  quality: QualityTier | null;
  soldiers: number | null;
  preset: TerrainPreset | null;
  faction: string | null;
  enemy: string | null;
  hour: number | null;
  season: Season | null;
  weather: WeatherKind | null;
  freeze: boolean;
  speed: number | null;
  paused: boolean;
  settlement: string | null;
  camera: string | null;
  aiVsAi: boolean;
  debug: boolean;
  profiler: boolean;
  noAudio: boolean;
  noUi: boolean;
  asset: string | null;
  assetTier: 'ultra' | 'high' | 'mobile' | 'off' | null;
  hdri: string | null;
  lod: number | null;
}

function oneOf<T extends string>(v: string | null, allowed: readonly T[]): T | null {
  return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

function num(v: string | null, min: number, max: number): number | null {
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function flag(v: string | null): boolean {
  return v !== null && v !== '0' && v !== 'false';
}

export function parseUrlParams(search: string): UrlParams {
  const q = new URLSearchParams(search);
  const seed = num(q.get('seed'), 0, 4294967295);
  const soldiers = num(q.get('soldiers'), 2, MAX_SOLDIERS);
  const lod = num(q.get('lod'), 0, 8);
  return {
    scene: oneOf(q.get('scene'), SCENE_IDS),
    mode: oneOf(q.get('mode'), GAME_MODES),
    scenario: q.get('scenario'),
    seed: seed === null ? null : Math.floor(seed),
    quality: oneOf(q.get('quality'), QUALITY_TIERS),
    soldiers: soldiers === null ? null : Math.floor(soldiers),
    preset: oneOf(q.get('preset'), TERRAIN_PRESETS),
    faction: q.get('faction'),
    enemy: q.get('enemy'),
    hour: num(q.get('hour'), 0, 24),
    season: oneOf(q.get('season'), SEASONS),
    weather: oneOf(q.get('weather'), WEATHER_KINDS),
    freeze: flag(q.get('freeze')),
    speed: num(q.get('speed'), 0.5, 8),
    paused: flag(q.get('paused')),
    settlement: q.get('settlement'),
    camera: q.get('camera'),
    aiVsAi: flag(q.get('aivsai')),
    debug: flag(q.get('debug')),
    profiler: flag(q.get('profiler')),
    noAudio: flag(q.get('noaudio')),
    noUi: flag(q.get('noui')),
    asset: q.get('asset'),
    assetTier: oneOf(q.get('assets'), ['ultra', 'high', 'mobile', 'off'] as const),
    hdri: q.get('hdri'),
    lod: lod === null ? null : Math.floor(lod),
  };
}

/** Params for the current page (empty in non-browser environments). */
export function currentUrlParams(): UrlParams {
  return parseUrlParams(typeof location !== 'undefined' ? location.search : '');
}
