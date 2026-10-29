/**
 * QA / automation API exposed as `window.__SAMRAJYA__`. OWNER: CTO (call / showScreen / labs added by CORE-01).
 * Implemented by src/app (which knows the scenes/session); core only defines the contract so
 * smoke tests, Playwright scripts and developers share one stable surface.
 *
 * Ready flags for screenshot tests:
 *   __SAMRAJYA__.ready       app booted (renderer + UI up)
 *   __SAMRAJYA__.sceneReady  current scene finished loading AND rendered its first stable frames
 *   __SAMRAJYA__.scene       current SceneId
 *
 * Contracts v2 (Sprint 1):
 *   __SAMRAJYA__.call(name, ...args)     forwards to the active scene's debugCommand(name, args) (GameScene, v2);
 *                                        built-ins when the scene does not answer: 'noop', 'scene.info', 'ui.screens'
 *   __SAMRAJYA__.showScreen(id, props)   show any ScreenId with raw props (UI captures; placeholders included)
 *   __SAMRAJYA__.hideScreen(id) / screens() / labs()
 */
import type {
  BattleCommand,
  GameMode,
  QualityTier,
  SceneId,
  Season,
  StrategicCommand,
  WeatherKind,
} from './types';
import type { ProfileSnapshot } from './profiler';
import type { CrashReport } from './crash';
import type { UrlParams } from './params';

export interface DebugState {
  scene: SceneId | null;
  mode: GameMode | null;
  paused: boolean;
  timeScale: number;
  quality: QualityTier;
  /** Scene-specific summary (scene.debugState()). */
  sceneState: unknown;
  fps: number;
  errors: number;
}

export interface SamrajyaDebugApi {
  readonly version: string;
  ready: boolean;
  sceneReady: boolean;
  scene: SceneId | null;
  readonly params: UrlParams;
  getState(): DebugState;
  /** Switch scene with raw params (see app/contracts.ts SceneParams). */
  goto(scene: SceneId, params?: Record<string, unknown>): Promise<void>;
  /** Start a game mode the same way the menu does. opts: { scenario, seed, soldiers, preset, faction, enemy } */
  startMode(mode: GameMode, opts?: Record<string, unknown>): Promise<void>;
  setTimeScale(scale: number): void;
  pause(): void;
  resume(): void;
  /** Run n fixed sim steps immediately. */
  step(n?: number): void;
  setQuality(tier: QualityTier): void;
  setEnvironment(patch: { hour?: number; season?: Season; weather?: WeatherKind }): void;
  issueBattleCommand(cmd: BattleCommand): void;
  issueStrategicCommand(cmd: StrategicCommand): void;
  getProfile(): ProfileSnapshot;
  getErrors(): CrashReport[];
  clearErrors(): void;
  /** Resolves true when sceneReady becomes true (false on timeout). */
  waitForSceneReady(timeoutMs?: number): Promise<boolean>;
  /** Resolves after n rendered frames. */
  waitFrames(n: number): Promise<void>;
  /**
   * Stop (true) / restart (false) the frame loop entirely. Screenshot tools freeze after the scene is
   * ready so capturing does not wait for another (possibly very slow, software-rendered) frame.
   */
  freeze(frozen: boolean): void;
  /** Render + capture the canvas as a PNG data URL. */
  screenshot(): string | null;
  /** Quick save to a slot (default "quick"); returns the slot. */
  save(slot?: string): string;
  load(slot?: string): Promise<void>;
  /** Hash of the authoritative sim state of the current scene (determinism checks), or null. */
  hash(): string | null;
  toggleProfiler(): void;
  // --- Contracts v2 ---
  /**
   * Run a debug command on the active scene (`GameScene.debugCommand`), e.g. call('world.select', 'settlement',
   * 'rajapura'), call('bench.report'), call('noop'). Resolves with the command's (plain-data) result; rejects for
   * unknown names.
   */
  call(name: string, ...args: unknown[]): Promise<unknown>;
  /**
   * Show a UI screen with raw props (throws for an unknown ScreenId). Placeholder screens print their props.
   * Top-level prop values '$world' / '$faction' are replaced by the live session world and the player faction id,
   * e.g. showScreen('game_stats', { world: '$world', from: 'pause_menu' }).
   */
  showScreen(id: string, props?: Record<string, unknown>): void;
  hideScreen(id: string): void;
  /** Every ScreenId and how it resolves: a static screen, a discovered *.screen.ts module or the placeholder. */
  screens(): { id: string; source: 'static' | 'discovered' | 'placeholder' }[];
  /** Lab ids available to ?scene=lab&lab=<id> (empty in the single-file build). */
  labs(): string[];
}

declare global {
  interface Window {
    __SAMRAJYA__?: SamrajyaDebugApi;
  }
}

export function installDebugApi(api: SamrajyaDebugApi): void {
  if (typeof window === 'undefined') return;
  Object.defineProperty(window, '__SAMRAJYA__', { value: api, configurable: true, writable: false, enumerable: false });
}
