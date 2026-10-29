/**
 * Persistent user settings (localStorage `samrajya.settings`). OWNER: CTO (Contracts v2 fields by CORE-01).
 *
 * loadSettings() merges what is stored over DEFAULT_SETTINGS field by field (nested groups too), drops values
 * of the wrong type and never throws, so settings written by an older build gain every new field's default.
 */
import type { GameSettings } from './types';
import { KEY_PRESETS } from './types';
import { STORAGE_PREFIX } from './constants';

export const DEFAULT_SETTINGS: Readonly<GameSettings> = Object.freeze({
  quality: 'auto',
  qualityOverrides: {},
  masterVolume: 0.8,
  musicVolume: 0.6,
  sfxVolume: 0.8,
  ambienceVolume: 0.7,
  uiVolume: 0.8,
  uiScale: 1,
  edgeScroll: true,
  invertZoom: false,
  cameraSpeed: 1,
  showHints: true,
  reducedMotion: false,
  colorblind: 'none',
  keybindings: {},
  // --- Contracts v2 (DESIGN_SPEC §8.8, §12.3-§12.6) ---
  keyPreset: 'classic',
  autoPause: { battleStart: true, commanderFallen: true, formationRouted: true, narrativeEvents: true },
  hintsSeen: [],
  simpleMode: 'auto',
  relationColoring: false,
  minimapNorthUp: false,
  holdToToggle: { guard: false, run: false },
  subtitles: true,
}) as GameSettings;

const KEY = `${STORAGE_PREFIX}settings`;

/** A fresh, fully mutable copy of the defaults (nested groups and arrays are not shared). */
export function defaultSettings(): GameSettings {
  return {
    ...DEFAULT_SETTINGS,
    qualityOverrides: {},
    keybindings: {},
    autoPause: { ...DEFAULT_SETTINGS.autoPause },
    hintsSeen: [],
    holdToToggle: { ...DEFAULT_SETTINGS.holdToToggle },
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Copy `from[k]` into `into[k]` when the stored value has the same type as the default. */
function mergeSameType<T extends object>(into: T, from: Record<string, unknown>): void {
  const target = into as Record<string, unknown>;
  for (const k of Object.keys(target)) {
    const v = from[k];
    if (v === undefined) continue;
    const d = target[k];
    if (isObject(d)) {
      if (isObject(v)) mergeSameType(d, v);
    } else if (Array.isArray(d)) {
      if (Array.isArray(v)) target[k] = v.slice();
    } else if (typeof v === typeof d) {
      target[k] = v;
    }
  }
}

/** Sanitize a parsed settings object (any shape) into complete GameSettings. Exported for tests. */
export function normalizeSettings(parsed: unknown): GameSettings {
  const s = defaultSettings();
  if (!isObject(parsed)) return s;
  // Free-form maps: keep as stored (validated by their consumers).
  const { qualityOverrides, keybindings, simpleMode, ...rest } = parsed;
  mergeSameType(s, rest);
  if (isObject(qualityOverrides)) s.qualityOverrides = qualityOverrides as GameSettings['qualityOverrides'];
  if (isObject(keybindings)) s.keybindings = keybindings as GameSettings['keybindings'];
  if (simpleMode === 'auto' || typeof simpleMode === 'boolean') s.simpleMode = simpleMode;
  if (!(KEY_PRESETS as readonly string[]).includes(s.keyPreset)) s.keyPreset = DEFAULT_SETTINGS.keyPreset;
  s.hintsSeen = s.hintsSeen.filter((h): h is string => typeof h === 'string');
  return s;
}

export function loadSettings(): GameSettings {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (!raw) return defaultSettings();
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: GameSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage unavailable - settings stay in memory
  }
}
