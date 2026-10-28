/**
 * Persistent user settings (localStorage `samrajya.settings`). Owned by the CTO.
 */
import type { GameSettings } from './types';
import { STORAGE_PREFIX } from './constants';

export const DEFAULT_SETTINGS: Readonly<GameSettings> = Object.freeze({
  quality: 'auto',
  qualityOverrides: {},
  masterVolume: 0.8,
  musicVolume: 0.6,
  sfxVolume: 0.8,
  ambienceVolume: 0.7,
  uiScale: 1,
  edgeScroll: true,
  invertZoom: false,
  cameraSpeed: 1,
  showHints: true,
  reducedMotion: false,
  colorblind: 'none',
  keybindings: {},
}) as GameSettings;

const KEY = `${STORAGE_PREFIX}settings`;

export function loadSettings(): GameSettings {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (!raw) return { ...DEFAULT_SETTINGS, qualityOverrides: {}, keybindings: {} };
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed, qualityOverrides: parsed.qualityOverrides ?? {}, keybindings: parsed.keybindings ?? {} };
  } catch {
    return { ...DEFAULT_SETTINGS, qualityOverrides: {}, keybindings: {} };
  }
}

export function saveSettings(s: GameSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage unavailable - settings stay in memory
  }
}
