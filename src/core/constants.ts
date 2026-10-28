/**
 * Engine-wide constants. Owned by the CTO. Three-free, DOM-free.
 */

declare const __BUILD_VERSION__: string;
declare const __BUILD_TIME__: string;

/** "0.1.0+abc1234" - injected by vite.config.ts `define`. Falls back in tests. */
export const BUILD_VERSION: string = typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : '0.0.0-dev';
export const BUILD_TIME: string = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '';

export const GAME_TITLE = 'SAMRAJYA: Echoes of Bharat';

// ---------------------------------------------------------------------------------------------
// Simulation timing
// ---------------------------------------------------------------------------------------------

/** Battle (tactical + local) fixed step: 20 Hz. */
export const BATTLE_TICK_HZ = 20;
export const BATTLE_DT = 1 / BATTLE_TICK_HZ;

/** One strategic tick advances the calendar by one game hour. */
export const STRATEGIC_TICK_HOURS = 1;
/** At 1x speed: 12 game hours per real second -> one day every 2 s, one year ~ 12 min. */
export const STRATEGIC_HOURS_PER_SECOND = 12;
/** Real seconds per strategic tick at 1x (loop fixed step for the world scene). */
export const STRATEGIC_DT = STRATEGIC_TICK_HOURS / STRATEGIC_HOURS_PER_SECOND;

/** Hero scene fixed step (movement/collision). */
export const HERO_DT = 1 / 30;

/** Allowed simulation speed multipliers (GDD §5: pause + adjustable speed). */
export const TIME_SCALES = [0.5, 1, 2, 4, 8] as const;
export const MIN_TIME_SCALE = 0.5;
export const MAX_TIME_SCALE = 8;
/** Max fixed steps per rendered frame before dropping time (spiral-of-death guard). */
export const MAX_STEPS_PER_FRAME = 24;
/** Frame delta clamp (s) - e.g. after a tab switch. */
export const MAX_FRAME_DT = 0.25;

// ---------------------------------------------------------------------------------------------
// World scale
// ---------------------------------------------------------------------------------------------

/** Strategic region: square, centered at origin. */
export const REGION_SIZE = 6144;
export const REGION_RESOLUTION = 513;
/** Battle maps are windows of the region terrain at higher resolution. */
export const BATTLE_MAP_SIZE = 1024;
export const BATTLE_MAP_RESOLUTION = 513;
/** Hero exploration window around a settlement. */
export const HERO_MAP_SIZE = 768;
export const HERO_MAP_RESOLUTION = 385;
/** Default water surface height (m). */
export const WATER_LEVEL = 0;

// ---------------------------------------------------------------------------------------------
// Battles
// ---------------------------------------------------------------------------------------------

export const DEFAULT_SKIRMISH_SOLDIERS = 1000;
export const MAX_SOLDIERS = 6000;
export const MAX_FORMATIONS_PER_SIDE = 48;
export const BATTLE_EVENT_LOG_LIMIT = 500;

// ---------------------------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------------------------

/** Bump when the SaveGame/WorldState shape changes; add a migration in core/save.ts. */
export const SAVE_VERSION = 1;
export const WORLD_SCHEMA_VERSION = 1;
export const STORAGE_PREFIX = 'samrajya.';
export const CHRONICLE_LIMIT = 300;
export const EVENT_HISTORY_LIMIT = 200;
export const BATTLE_HISTORY_LIMIT = 50;
export const STATS_SAMPLE_LIMIT = 240;
