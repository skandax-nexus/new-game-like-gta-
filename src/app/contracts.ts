/**
 * App-level contracts between scenes, session, UI, render, input and audio. Owned by the CTO.
 * (Domain data types live in core/types.ts; this file may reference DOM/three types.)
 */
import type {
  AdvisorRecommendation,
  BattleCommand,
  BattleOutcome,
  BattlePrediction,
  BattleSetup,
  BattleState,
  Difficulty,
  EngagementId,
  EventInstanceId,
  FormationIndex,
  GameMode,
  GameSettings,
  QualityDetection,
  QualityTier,
  SandboxSetup,
  SaveSlotInfo,
  ScenarioId,
  SceneId,
  Season,
  SettlementId,
  SideIndex,
  SkirmishSetup,
  StrategicCommand,
  WeatherKind,
  WorldState,
} from '../core/types';
import type { GameBus } from '../core/events';
import type { GameLoop } from '../core/loop';
import type { QualityManager } from '../core/quality';
import type { Profiler } from '../core/profiler';
import type { CrashReporter } from '../core/crash';
import type { SaveManager } from '../core/save';
import type { UrlParams } from '../core/params';
import type { RenderContext } from '../render/renderer';
import type { InputManager } from '../input/input';
import type { AudioManager } from '../audio/audio';
import type { UIManager } from '../ui/ui';
import type { SceneManager } from '../scenes/SceneManager';
import type { AssetManager } from '../assets/AssetManager';

// ---------------------------------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------------------------------

export type SceneParams =
  | { scene: 'menu' }
  /** World scene renders `session.world` (must be set by the session before entering). */
  | { scene: 'world' }
  /**
   * Battle scene. `state` = continue an existing BattleState (e.g. engagement already stepping or a
   * loaded save); otherwise a new battle is created from `setup`.
   */
  | { scene: 'battle'; setup: BattleSetup; state: BattleState | null; returnTo: 'world' | 'menu' }
  | { scene: 'hero'; settlementId: SettlementId | null; returnTo: 'world' | 'menu' }
  /** Debug / lookdev view of one content-pipeline asset (src/assets/manifest.ts id; null = first model). */
  | { scene: 'assetviewer'; assetId: string | null };

export interface EnvironmentOverride {
  hour?: number;
  season?: Season;
  weather?: WeatherKind;
}

/**
 * A scene owns its three.js scene graph, camera, sim stepping and HUD wiring.
 * Lifecycle: SceneManager calls enter() (async, may report progress) -> loop drives fixedUpdate/update ->
 * exit() MUST dispose every GPU resource, DOM node, timer and bus subscription it created.
 */
export interface GameScene {
  readonly id: SceneId;
  /** Real seconds per fixed sim step at 1x (see core/constants.ts). */
  readonly fixedStep: number;
  enter(params: SceneParams): Promise<void>;
  /** One deterministic sim step. */
  fixedUpdate(step: number): void;
  /** Per frame: input, camera, interpolation (alpha), HUD sync, render. dt = real seconds. */
  update(dt: number, alpha: number): void;
  exit(): void;
  /** Summary for window.__SAMRAJYA__.getState(). */
  debugState(): unknown;
  /** Hash of the authoritative state (determinism checks) or null. */
  stateHash(): string | null;
  setEnvironment?(patch: EnvironmentOverride): void;
  issueBattleCommand?(cmd: BattleCommand): void;
  onResize?(width: number, height: number): void;
}

export type SceneFactory = (ctx: AppContext) => GameScene;

// ---------------------------------------------------------------------------------------------------
// Session actions (UI -> game). Implemented by app/session.ts (GameSession).
// ---------------------------------------------------------------------------------------------------

export interface GameActions {
  startCampaign(scenarioId: ScenarioId, difficulty: Difficulty): Promise<void>;
  startSandbox(setup: SandboxSetup): Promise<void>;
  startSkirmish(setup: SkirmishSetup): Promise<void>;
  /** Hero exploration of a settlement (null = player capital / default). */
  visitSettlement(settlementId: SettlementId | null): Promise<void>;
  returnToWorld(): Promise<void>;
  quitToMenu(): Promise<void>;
  /** Strategic command from the player faction (queued, applied at the next tick). */
  issueStrategic(cmd: StrategicCommand): void;
  /** Battle command from the player side (applied at the next battle step). */
  issueBattle(cmd: BattleCommand): void;
  /** Fight / autoresolve / retreat a pending engagement. */
  decideEngagement(engagementId: EngagementId, decision: 'fight' | 'autoresolve' | 'retreat'): Promise<void>;
  resolveEvent(instanceId: EventInstanceId, choiceId: string): void;
  /** Continue after a battle results screen. */
  continueAfterBattle(): Promise<void>;
  saveGame(slot: string, name?: string): void;
  loadGame(slot: string): Promise<void>;
  setTimeScale(scale: number): void;
  togglePause(): void;
  setPaused(paused: boolean): void;
  setQuality(tier: QualityTier | 'auto'): void;
  updateSettings(patch: Partial<GameSettings>): void;
}

// ---------------------------------------------------------------------------------------------------
// UI screens. Scenes push props with ui.show/update; screens call GameActions or emit ui:* bus events.
// ---------------------------------------------------------------------------------------------------

export interface WorldSelection {
  kind: 'army' | 'settlement' | 'province' | 'none';
  id: string | null;
}

export interface ScreenPropsMap {
  main_menu: { canContinue: boolean; version: string };
  mode_setup: { mode: GameMode };
  world_hud: { world: Readonly<WorldState>; timeScale: number; paused: boolean; selection: WorldSelection };
  settlement_panel: { world: Readonly<WorldState>; settlementId: SettlementId };
  army_panel: { world: Readonly<WorldState>; armyId: string };
  province_panel: { world: Readonly<WorldState>; provinceId: string };
  diplomacy: { world: Readonly<WorldState> };
  council: { world: Readonly<WorldState>; recommendations: AdvisorRecommendation[] };
  event_modal: { world: Readonly<WorldState>; instanceId: EventInstanceId };
  engagement_prompt: { world: Readonly<WorldState>; engagementId: EngagementId; prediction: BattlePrediction };
  battle_hud: { battle: Readonly<BattleState>; playerSide: SideIndex; selection: readonly FormationIndex[]; timeScale: number; paused: boolean };
  battle_results: { outcome: BattleOutcome; playerSide: SideIndex; continueLabel: string };
  hero_hud: { settlementName: string; prompt: string | null };
  pause_menu: { mode: GameMode | null; canSave: boolean };
  settings: { settings: GameSettings; detection: QualityDetection; tier: QualityTier };
  save_load: { mode: 'save' | 'load'; slots: SaveSlotInfo[] };
  scenario_results: { world: Readonly<WorldState> };
  chronicle: { world: Readonly<WorldState> };
}
export type ScreenId = keyof ScreenPropsMap;

// ---------------------------------------------------------------------------------------------------
// App context (dependency container passed to scenes, UI, session)
// ---------------------------------------------------------------------------------------------------

export interface AppContext {
  readonly canvas: HTMLCanvasElement;
  readonly uiRoot: HTMLElement;
  readonly overlayRoot: HTMLElement;
  readonly params: UrlParams;
  readonly bus: GameBus;
  readonly loop: GameLoop;
  readonly quality: QualityManager;
  readonly profiler: Profiler;
  readonly crash: CrashReporter;
  readonly saves: SaveManager;
  readonly settings: GameSettings;
  readonly render: RenderContext;
  readonly input: InputManager;
  readonly audio: AudioManager;
  readonly ui: UIManager;
  readonly scenes: SceneManager;
  /** Content-pipeline assets (GLB models, PBR texture sets, HDR skies) for the active quality tier. */
  readonly assets: AssetManager;
  /** Game session / actions (app/session.ts). */
  readonly actions: GameActions;
  readonly session: SessionView;
}

/** Read-only view of the session for scenes and UI. */
export interface SessionView {
  readonly mode: GameMode | null;
  readonly world: WorldState | null;
  /** Engagement currently being fought in the BattleScene (world battles). */
  readonly activeEngagementId: EngagementId | null;
  readonly skirmish: SkirmishSetup | null;
  /** Last finished battle outcome (results screen). */
  readonly lastOutcome: BattleOutcome | null;
  /** Drain queued player strategic commands (WorldScene calls this each tick). */
  takeStrategicCommands(): StrategicCommand[];
  /** Drain queued player battle commands (BattleScene calls this each step). */
  takeBattleCommands(): BattleCommand[];
  /** BattleScene registers its live state on enter (saves mid-battle, distant-battle hand-off). */
  attachBattle(state: BattleState | null): void;
  /** Called by BattleScene when its battle ends (session decides what happens next). */
  onBattleEnded(state: BattleState): void;
}
