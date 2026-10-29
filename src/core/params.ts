/**
 * URL parameters (deep links for QA, screenshots and testing). OWNER: CTO (Contracts v2 params by CORE-01).
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
 * Contracts v2 (Sprint 1; each consumer named - params are parsed here, applied by their owner):
 *   ?scene=lab&lab=<id>               feature lab: loads <id>.lab.ts (LabScene, CORE-01)
 *   &mission=<id>                     hero mission to start (HERO_MISSIONS id; GP-02 / GP-03)
 *   &mood=<HeroMood>                  hero district mood override (dawn_mist, golden_dust, ...; GP-02 / GFX-01)
 *   &district=<id>                    hero district to start in (HERO_DISTRICTS id; GP-02)
 *   &camdist=M                        RTS camera distance to focus at construction (m; GFX-05)
 *   &cine=<shot id>                   cinematic shot to hold for stills (e.g. c3; GFX-05 / GP-02)
 *   &colorblind=protan|deutan|tritan|none   colour-blind remap override (UI-02 dataset, GFX-04 tints)
 *   &reducedmotion=0|1                reduced-motion override (no shake / slow-mo; UI-02, GFX-05, GP-02)
 *   &keypreset=classic|grid           key preset override (UI-02 input)
 *   &bench=1                          deterministic benchmark mode (GP-04 BattleScene, QA-01 scripts/bench.cjs)
 *   &age=janapada|mahajanapada|samrajya   player faction age override for captures (GP-03 / GFX-06)
 *   &deploy=N                         battle deployment seconds override; 0 = skip deployment (GP-04)
 *   &csm=1                            colour shadow cascades (GFX-01 debug view)
 *   &splat=a,b,c,d                    4-layer terrain lookdev material ids (TA-07 viewer, GFX-02 lab)
 *   &clip=<name>  &count=N            VAT clip / instance count (TA-07 viewer, GFX-04 crowd lab)
 *   &kit=id1,id2,...                  multi-asset kit grid (TA-07 viewer; TA-02 / TA-03 evidence)
 *   &audioworklet=0                   score streamed as scheduled AudioBuffers instead of the AudioWorklet (AUD-01;
 *                                     default on). AUD-01 also reads `debug` / `profiler` (window.__SAMRAJYA_AUDIO__).
 */
import type { AgeId, GameMode, HeroMood, KeyPreset, QualityTier, SceneId, Season, TerrainPreset, WeatherKind } from './types';
import { AGE_IDS, GAME_MODES, HERO_MOODS, KEY_PRESETS, QUALITY_TIERS, SCENE_IDS, SEASONS, TERRAIN_PRESETS, WEATHER_KINDS } from './types';
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
  // --- Contracts v2 ---
  /** ?lab= feature lab id (with ?scene=lab). */
  lab: string | null;
  mission: string | null;
  mood: HeroMood | null;
  district: string | null;
  /** RTS camera distance (m), 5..12000. */
  camdist: number | null;
  cine: string | null;
  colorblind: 'none' | 'protan' | 'deutan' | 'tritan' | null;
  /** null = use the setting. */
  reducedMotion: boolean | null;
  keyPreset: KeyPreset | null;
  bench: boolean;
  age: AgeId | null;
  /** Deployment seconds override (0 = skip deployment), null = rules default. */
  deploy: number | null;
  csm: boolean;
  /** Up to 4 terrain layer material ids. */
  splat: string[] | null;
  clip: string | null;
  /** Instance count, 1..20000. */
  count: number | null;
  kit: string[] | null;
  /** Score through the AudioWorklet stream (default true; ?audioworklet=0 or =false -> buffers fallback). */
  audioWorklet: boolean;
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

/** Tri-state flag: absent -> null, '0'/'false' -> false, anything else -> true. */
function optFlag(v: string | null): boolean | null {
  return v === null ? null : flag(v);
}

/** Comma list of ids (trimmed, empty entries dropped, at most `max`), null when absent or empty. */
function list(v: string | null, max = 64): string[] | null {
  if (v === null) return null;
  const out = v
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
    .slice(0, max);
  return out.length ? out : null;
}

function int(v: number | null): number | null {
  return v === null ? null : Math.floor(v);
}

export function parseUrlParams(search: string): UrlParams {
  const q = new URLSearchParams(search);
  const seed = num(q.get('seed'), 0, 4294967295);
  const soldiers = num(q.get('soldiers'), 2, MAX_SOLDIERS);
  const lod = num(q.get('lod'), 0, 8);
  const str = (k: string): string | null => {
    const v = q.get(k);
    return v === null || v.trim() === '' ? null : v.trim();
  };
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
    lab: str('lab'),
    mission: str('mission'),
    mood: oneOf(q.get('mood'), HERO_MOODS),
    district: str('district'),
    camdist: num(q.get('camdist'), 5, 12000),
    cine: str('cine'),
    colorblind: oneOf(q.get('colorblind'), ['none', 'protan', 'deutan', 'tritan'] as const),
    reducedMotion: optFlag(q.get('reducedmotion')),
    keyPreset: oneOf(q.get('keypreset'), KEY_PRESETS),
    bench: flag(q.get('bench')),
    age: oneOf(q.get('age'), AGE_IDS),
    deploy: int(num(q.get('deploy'), 0, 600)),
    csm: flag(q.get('csm')),
    splat: list(q.get('splat'), 4),
    clip: str('clip'),
    count: int(num(q.get('count'), 1, 20000)),
    kit: list(q.get('kit')),
    audioWorklet: optFlag(q.get('audioworklet')) ?? true,
  };
}

/** Params for the current page (empty in non-browser environments). */
export function currentUrlParams(): UrlParams {
  return parseUrlParams(typeof location !== 'undefined' ? location.search : '');
}
