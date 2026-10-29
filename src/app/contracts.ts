/**
 * App-level contracts between scenes, session, UI, render, input and audio. OWNER: CTO (Contracts v2 by CORE-01).
 * (Domain data types live in core/types.ts; this file may reference DOM/three types.)
 *
 * Optional-member convention (STUDIO.md W2): members added in Sprint 1 are OPTIONAL and tagged
 * `@sprint1 implemented by <ticket>`; callers feature-detect them (`ctx.actions.startHeroMission?.(id)`) until the
 * implementing ticket lands. Table of every v2 member -> ticket: docs/ARCHITECTURE.md "Contracts v2 (Sprint 1)".
 */
import type {
  AdvisorRecommendation,
  AgeId,
  BattleCommand,
  BattleOutcome,
  BattlePrediction,
  BattleSetup,
  BattleState,
  BuildingType,
  CaptureDecision,
  Difficulty,
  EngagementId,
  EventInstanceId,
  FactionId,
  FormationIndex,
  GameMode,
  GameSettings,
  GovernorInterest,
  GridCell,
  HeroMissionResult,
  MaterialCost,
  NegotiationTactic,
  PrisonerDecision,
  QualityDetection,
  QualityTier,
  Rect,
  Rotation,
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
  | { scene: 'assetviewer'; assetId: string | null }
  /**
   * v2 feature lab (src/scenes/LabScene.ts): lazily loads the `*.lab.ts` module whose file name is `<labId>.lab.ts`.
   * Unknown / null id -> themed error panel and fallback to the menu.
   */
  | { scene: 'lab'; labId: string | null };

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
  /**
   * v2 QA hook behind `window.__SAMRAJYA__.call(name, ...args)`. Names are namespaced ('world.select',
   * 'settlement.villagers', 'bench.report', 'hero.startMission', 'lab.info'...). Every implementation answers
   * 'noop' (returns `{ scene: id }`) and returns DEBUG_UNHANDLED for names it does not know (the API then tries
   * its built-ins, else throws). May return a Promise. Results must be structured-cloneable plain data.
   * @sprint1 implemented by GP-03 (world), GP-04 (battle, 'bench.report'), GP-02 (hero), CORE-01 (lab)
   */
  debugCommand?(name: string, args: readonly unknown[]): unknown;
}

/** Sentinel a scene's debugCommand returns for names it does not handle. */
export const DEBUG_UNHANDLED: unique symbol = Symbol('samrajya.debug.unhandled');

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
  // --- Contracts v2: OPTIONAL until implemented (feature-detect with `?.`) ---
  /** Enter the hero scene for a mission (mission_card "Begin"); world clock frozen. @sprint1 implemented by GP-03 */
  startHeroMission?(missionId: string): Promise<void>;
  /**
   * End the active mission and apply its effects exactly once via SIM-01 applyHeroMissionResult, then return to
   * the world (mission_result "Continue" / "Accept the outcome"). @sprint1 implemented by GP-03
   */
  completeHeroMission?(result: HeroMissionResult): Promise<void>;
  /** Leave the active mission without applying anything (it stays available). @sprint1 implemented by GP-03 */
  abandonHeroMission?(): Promise<void>;
  /** Prisoners of a won battle: ransom or release (battle_results). @sprint1 implemented by GP-03 */
  decidePrisoners?(engagementId: EngagementId, decision: PrisonerDecision): void;
  /** Occupy / plunder / liberate a captured settlement (capture prompt). @sprint1 implemented by GP-03 */
  decideCapture?(settlementId: SettlementId, decision: CaptureDecision): void;
  /** End the battle deployment phase now ("Begin battle"; issues begin_battle). @sprint1 implemented by GP-03 */
  skipDeployment?(): void;
}

// ---------------------------------------------------------------------------------------------------
// UI screens. Scenes push props with ui.show/update; screens call GameActions or emit ui:* bus events.
// ---------------------------------------------------------------------------------------------------

export interface WorldSelection {
  kind: 'army' | 'settlement' | 'province' | 'none';
  id: string | null;
}

// --- Contracts v2 screen props (DESIGN_SPEC §12.1-§12.2; screens by UI-02 / UI-01, placeholders until then) ---

/** battle_hud: deployment phase info (null / absent outside deployment). */
export interface BattleDeploymentHud {
  /** Seconds left before the battle begins on its own. */
  remainingSec: number;
  /** The player's deploy zone (world rect) for the minimap / hints. */
  zone: Rect;
  canBegin: boolean;
}

/** battle_hud: commander Rally button state. */
export interface BattleRallyHud {
  available: boolean;
  /** Seconds until ready (0 = ready) and the full cooldown, for the cooldown ring. */
  cooldownSec: number;
  cooldownTotalSec: number;
  /** Why it is unavailable ("Commander is engaged", "Commander has fallen"), null when available. */
  reason: string | null;
}

/** Screen-space anchor of a formation (CSS px, batched worldToScreen at 10 Hz by GP-04). */
export interface FormationScreenAnchor {
  index: FormationIndex;
  x: number;
  y: number;
  /** On screen and in front of the camera. */
  visible: boolean;
  /** 0..1 suggested card scale by distance. */
  scale: number;
}

/** hero_hud: one enemy health bar over its head. */
export interface HeroEnemyBar {
  id: string;
  name: string;
  /** CSS px of the bar anchor (above the head). */
  x: number;
  y: number;
  visible: boolean;
  hp: number;
  hpMax: number;
  poise: number;
  poiseMax: number;
  /** Boss / champion bar (Durjaya, the captain) - shown large at the bottom. */
  boss: boolean;
  /** Telegraphing an unblockable attack right now (red flash cue). */
  unblockable: boolean;
}

/** hero_hud: combat block (absent / null outside combat missions). */
export interface HeroCombatHud {
  hp: number;
  hpMax: number;
  stamina: number;
  staminaMax: number;
  salveCharges: number;
  salveMax: number;
  /** Lock-on reticle at the target (CSS px), null = no lock. */
  lockOn: { x: number; y: number } | null;
  enemies: readonly HeroEnemyBar[];
  /** Perfect-dodge slow motion active (UI desaturates edges). */
  slowMotion: boolean;
}

/** hero_dialogue / hero_negotiation: one choice / argument card. */
export interface DialogueChoiceView {
  id: string;
  label: string;
  /** Number key 1..5 shown on the card. */
  key: number;
  enabled: boolean;
  /** Unmet requirement shown on a disabled card. */
  reason: string | null;
  /** Requires a clue the player holds (the card glows). */
  clueGated: boolean;
  tactic: NegotiationTactic | null;
}

/** age_panel / build placement cost line. */
export type CostView = MaterialCost;

/** mission_result: one applied effect line ("+1,500 grain", "Legitimacy +0.05"). */
export interface MissionEffectLine {
  text: string;
  tone: 'positive' | 'negative' | 'neutral';
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
  battle_hud: {
    battle: Readonly<BattleState>;
    playerSide: SideIndex;
    selection: readonly FormationIndex[];
    timeScale: number;
    paused: boolean;
    // --- v2 (optional; @sprint1 GP-04 pushes, UI-02 renders) ---
    deployment?: BattleDeploymentHud | null;
    rally?: BattleRallyHud;
    /** Floating formation cards / hover bars anchors (own and visible enemy formations). */
    anchors?: readonly FormationScreenAnchor[];
  };
  battle_results: {
    outcome: BattleOutcome;
    playerSide: SideIndex;
    continueLabel: string;
    /** v2: world engagement of this battle (prisoners decision via decidePrisoners); null/absent for skirmish. */
    engagementId?: EngagementId | null;
  };
  hero_hud: {
    settlementName: string;
    prompt: string | null;
    // --- v2 (optional; @sprint1 GP-02 pushes, UI-02 renders) ---
    /** Prompt bubble anchor at the target (CSS px). */
    promptAnchor?: { x: number; y: number } | null;
    /** Objective line, top-left. */
    objective?: string | null;
    /** Camera heading (radians, facing convention) for the compass strip. */
    compassHeading?: number;
    /** Subtitle / caption (speaker name + line). */
    caption?: { speaker: string | null; text: string } | null;
    combat?: HeroCombatHud | null;
    /** Which touch controls to show: exploration (stick + look + interact) or combat buttons. */
    touchControls?: 'explore' | 'combat' | 'none';
  };
  pause_menu: { mode: GameMode | null; canSave: boolean };
  settings: { settings: GameSettings; detection: QualityDetection; tier: QualityTier };
  save_load: { mode: 'save' | 'load'; slots: SaveSlotInfo[] };
  scenario_results: { world: Readonly<WorldState> };
  chronicle: { world: Readonly<WorldState> };
  // --- Contracts v2 screens (DESIGN_SPEC §12.1; UI-02: build_placement..economy_panel, UI-01: the rest) ---
  /** AoE placement ghost info: cost, validity reason, rotation, touch tick/cross. Pushed by GP-03 while placing. */
  build_placement: {
    world: Readonly<WorldState>;
    settlementId: SettlementId;
    /** Building being placed, or null while placing a landmark (`landmarkId`). */
    building: BuildingType | null;
    landmarkId: string | null;
    cell: GridCell | null;
    rot: Rotation;
    valid: boolean;
    /** SIM-01 validatePlacement reason ("Needs the river bank", "Need 40 stone"), null when valid. */
    reason: string | null;
    cost: CostView;
    /** Shift held: place and keep placing. */
    repeat: boolean;
    /** Touch flow: show the tick / cross / rotate buttons. */
    touch: boolean;
  };
  /** AoE market (grain / timber / stone lots). Quotes come from SIM-01 selectors over `world`. */
  market: { world: Readonly<WorldState>; factionId: FactionId };
  /** Ages & landmarks: requirements checklist, two landmark cards, unlock preview. */
  age_panel: { world: Readonly<WorldState>; factionId: FactionId };
  /** Ledger + projection, tax policy, royal reserve / hold the reserve, rationing. */
  economy_panel: { world: Readonly<WorldState>; factionId: FactionId };
  /** Hero mission offer (Begin / Later). */
  mission_card: { missionId: string; settlementName: string; canBegin: boolean; reason: string | null };
  /** Cinematic dialogue: speaker, line, up to 5 choice cards. */
  hero_dialogue: {
    treeId: string;
    nodeId: string;
    /** HeroCharacterDef id, 'hero' or 'narrator'. */
    speaker: string;
    speakerName: string;
    text: string;
    choices: readonly DialogueChoiceView[];
  };
  /** Negotiation with a great house (stance bar, patience pips, tactic cards). */
  hero_negotiation: {
    /** HeroCharacterDef id. */
    characterId: string;
    name: string;
    interest: GovernorInterest;
    stance: number;
    winAt: number;
    loseAt: number;
    patience: number;
    patienceMax: number;
    lastTactic: NegotiationTactic | null;
    reaction: 'neutral' | 'lean_in' | 'cross_arms';
    line: string | null;
    tactics: readonly DialogueChoiceView[];
  };
  /** Mission outcome with applied effects; retry for retryable combat missions. */
  mission_result: { missionId: string; success: boolean; effects: readonly MissionEffectLine[]; canRetry: boolean };
  /** End-of-game statistics (§8.9): tabs, every faction side by side, timeline graphs. */
  game_stats: { world: Readonly<WorldState>; from: 'scenario_results' | 'pause_menu' };
  /** Tutorial hint card anchored to a UI element (hints service, UI-01). */
  hint_card: { hintId: string; title: string; text: string; anchor: string | null };
}
export type ScreenId = keyof ScreenPropsMap;

/** Every ScreenId at runtime (registry, placeholder fallback, __SAMRAJYA__.showScreen validation). */
export const SCREEN_IDS = [
  'main_menu',
  'mode_setup',
  'world_hud',
  'settlement_panel',
  'army_panel',
  'province_panel',
  'diplomacy',
  'council',
  'event_modal',
  'engagement_prompt',
  'battle_hud',
  'battle_results',
  'hero_hud',
  'pause_menu',
  'settings',
  'save_load',
  'scenario_results',
  'chronicle',
  'build_placement',
  'market',
  'age_panel',
  'economy_panel',
  'mission_card',
  'hero_dialogue',
  'hero_negotiation',
  'mission_result',
  'game_stats',
  'hint_card',
] as const satisfies readonly ScreenId[];
/** Compile-time proof that SCREEN_IDS lists every ScreenPropsMap key. */
const SCREEN_IDS_COMPLETE: Exclude<ScreenId, (typeof SCREEN_IDS)[number]> extends never ? true : never = true;
void SCREEN_IDS_COMPLETE;

export function isScreenId(v: unknown): v is ScreenId {
  return typeof v === 'string' && (SCREEN_IDS as readonly string[]).includes(v);
}

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
  // --- Contracts v2: OPTIONAL until implemented ---
  /** Hero mission in progress (null = free exploration or not in hero mode). @sprint1 implemented by GP-03 */
  readonly heroMission?: HeroMissionSession | null;
  /** Player engagements waiting for a decision, oldest first (prompt queue, §2.3). @sprint1 implemented by GP-03 */
  readonly pendingEngagements?: readonly EngagementId[];
  /** Difficulty of the running game (world.difficulty / skirmish setup). @sprint1 implemented by GP-03 */
  readonly difficulty?: Difficulty;
}

/** The hero mission the session is running (SessionView.heroMission). */
export interface HeroMissionSession {
  missionId: string;
  settlementId: SettlementId;
  /** 1 = first try; "Try again" increments it. */
  attempt: number;
  /** Player faction age when the mission started (avatar / district dressing). */
  age: AgeId | null;
}
