/**
 * Game session: mode flow (menu -> campaign/sandbox world -> battles -> results; skirmish; hero),
 * player command queues, save/load, settings. Implements GameActions (UI -> game) and SessionView.
 * OWNER: Lead Gameplay Engineer. Scaffolded by the CTO (keep the GameActions/SessionView contracts).
 */
import type {
  BattleCommand,
  BattleOutcome,
  BattleState,
  Difficulty,
  EngagementId,
  EventInstanceId,
  GameMode,
  GameSettings,
  IssuedStrategicCommand,
  QualityTier,
  SandboxSetup,
  SaveGame,
  ScenarioId,
  SettlementId,
  SimEvent,
  SkirmishSetup,
  StrategicCommand,
  WorldState,
} from '../core/types';
import type { AppContext, GameActions, SessionView } from './contracts';
import type { UrlParams } from '../core/params';
import { BUILD_VERSION, DEFAULT_SKIRMISH_SOLDIERS, SAVE_VERSION } from '../core/constants';
import { saveSettings } from '../core/settings';
import { buildQualitySettings } from '../core/quality';
import { applyStrategicCommand, addChronicle, createWorld, getRegionHeightfield, pushBattleHistory } from '../sim/strategic/world';
import { applyBattleOutcome } from '../sim/strategic/armies';
import { battleSetupFromEngagement } from '../sim/strategic/autoresolve';
import { formatDate } from '../sim/strategic/seasons';
import { createSkirmishSetup } from '../sim/tactical/battle';
import { DEFAULT_SCENARIO_ID } from '../data/campaign';
import { FACTIONS } from '../data/factions';

/** Skirmish setup from URL params (QA deep links / smoke tests). */
export function skirmishFromParams(p: UrlParams, overrides: Partial<SkirmishSetup> = {}): SkirmishSetup {
  return {
    seed: p.seed ?? 1234,
    preset: p.preset ?? 'river_crossing',
    totalSoldiers: p.soldiers ?? DEFAULT_SKIRMISH_SOLDIERS,
    playerFactionId: p.faction && FACTIONS[p.faction] ? p.faction : 'heartland',
    enemyFactionId: p.enemy && FACTIONS[p.enemy] ? p.enemy : 'highland',
    armies: null,
    playerSide: 0,
    hour: p.hour ?? 8.5,
    season: p.season ?? 'sharad',
    weather: p.weather ?? 'clear',
    difficulty: 'normal',
    aiVsAi: p.aiVsAi,
    ...overrides,
  };
}

export class GameSession implements GameActions, SessionView {
  mode: GameMode | null = null;
  world: WorldState | null = null;
  activeEngagementId: EngagementId | null = null;
  skirmish: SkirmishSetup | null = null;
  lastOutcome: BattleOutcome | null = null;
  private battle: BattleState | null = null;
  private strategicQueue: StrategicCommand[] = [];
  private battleQueue: BattleCommand[] = [];
  private readonly simOut: SimEvent[] = [];
  private ctxRef: AppContext | null = null;
  private startedAt = 0;

  attach(ctx: AppContext): void {
    this.ctxRef = ctx;
    ctx.bus.on('sim:events', ({ events }) => {
      if (events.some((e) => e.kind === 'new_month') && this.world) {
        try {
          this.saveGame('auto', 'Autosave');
        } catch (err) {
          ctx.crash.report(err, 'manual', 'autosave');
        }
      }
    });
  }

  private get ctx(): AppContext {
    if (!this.ctxRef) throw new Error('GameSession not attached');
    return this.ctxRef;
  }

  private setMode(mode: GameMode | null): void {
    this.mode = mode;
    this.ctx.bus.emit('session:mode', { mode });
  }

  private resetLoop(): void {
    const loop = this.ctx.loop;
    loop.setTimeScale(this.ctx.params.speed ?? 1);
    loop.setPaused(false);
  }

  // ------------------------------------------------------------------ SessionView

  takeStrategicCommands(): StrategicCommand[] {
    const q = this.strategicQueue;
    this.strategicQueue = [];
    return q;
  }

  takeBattleCommands(): BattleCommand[] {
    const q = this.battleQueue;
    this.battleQueue = [];
    return q;
  }

  attachBattle(state: BattleState | null): void {
    this.battle = state;
  }

  onBattleEnded(state: BattleState): void {
    this.lastOutcome = state.outcome;
    if (!state.outcome) return;
    const playerSide = state.setup.sides[1].controller === 'player' ? 1 : 0;
    this.ctx.ui.show('battle_results', { outcome: state.outcome, playerSide, continueLabel: this.activeEngagementId ? 'Return to the Realm' : 'Return to Menu' });
  }

  // ------------------------------------------------------------------ GameActions

  async startCampaign(scenarioId: ScenarioId, difficulty: Difficulty): Promise<void> {
    this.world = createWorld({ kind: 'scenario', scenarioId: scenarioId || DEFAULT_SCENARIO_ID, seed: this.ctx.params.seed, difficulty });
    this.skirmish = null;
    this.activeEngagementId = null;
    this.startedAt = performance.now();
    this.setMode('campaign');
    this.resetLoop();
    await this.ctx.scenes.go({ scene: 'world' });
  }

  async startSandbox(setup: SandboxSetup): Promise<void> {
    this.world = createWorld({ kind: 'sandbox', sandbox: setup });
    this.skirmish = null;
    this.activeEngagementId = null;
    this.startedAt = performance.now();
    this.setMode('sandbox');
    this.resetLoop();
    await this.ctx.scenes.go({ scene: 'world' });
  }

  async startSkirmish(setup: SkirmishSetup): Promise<void> {
    this.world = null;
    this.skirmish = setup;
    this.activeEngagementId = null;
    this.setMode('skirmish');
    this.resetLoop();
    await this.ctx.scenes.go({ scene: 'battle', setup: createSkirmishSetup(setup), state: null, returnTo: 'menu' });
  }

  async visitSettlement(settlementId: SettlementId | null): Promise<void> {
    this.ctx.loop.setPaused(false);
    await this.ctx.scenes.go({ scene: 'hero', settlementId, returnTo: this.world ? 'world' : 'menu' });
  }

  async returnToWorld(): Promise<void> {
    if (!this.world) return this.quitToMenu();
    this.ctx.loop.setPaused(false);
    await this.ctx.scenes.go({ scene: 'world' });
  }

  async quitToMenu(): Promise<void> {
    this.world = null;
    this.skirmish = null;
    this.activeEngagementId = null;
    this.battle = null;
    this.setMode(null);
    this.resetLoop();
    await this.ctx.scenes.go({ scene: 'menu' });
  }

  issueStrategic(cmd: StrategicCommand): void {
    this.strategicQueue.push(cmd);
  }

  issueBattle(cmd: BattleCommand): void {
    this.battleQueue.push(cmd);
  }

  /** Apply a player command right now (between ticks) - used for modal decisions. */
  private applyNow(cmd: StrategicCommand): boolean {
    const w = this.world;
    if (!w) return false;
    const issued: IssuedStrategicCommand = { factionId: w.playerFactionId, hour: w.calendar.totalHours, cmd };
    this.simOut.length = 0;
    const ok = applyStrategicCommand(w, issued, this.simOut, getRegionHeightfield(w));
    if (this.simOut.length) this.ctx.bus.emit('sim:events', { events: this.simOut.slice() });
    return ok;
  }

  async decideEngagement(engagementId: EngagementId, decision: 'fight' | 'autoresolve' | 'retreat'): Promise<void> {
    const w = this.world;
    if (!w) return;
    this.applyNow({ kind: 'engagement_decision', engagementId, decision });
    if (decision !== 'fight') {
      this.ctx.loop.setPaused(false);
      return;
    }
    const setup = battleSetupFromEngagement(w, engagementId, true);
    this.activeEngagementId = engagementId;
    const existing = w.engagements[engagementId]?.battle ?? null;
    this.ctx.loop.setPaused(false);
    await this.ctx.scenes.go({ scene: 'battle', setup: existing?.setup ?? setup, state: existing, returnTo: 'world' });
  }

  resolveEvent(instanceId: EventInstanceId, choiceId: string): void {
    this.applyNow({ kind: 'event_choice', eventInstanceId: instanceId, choiceId });
  }

  async continueAfterBattle(): Promise<void> {
    const w = this.world;
    const eng = this.activeEngagementId;
    const outcome = this.lastOutcome;
    this.ctx.ui.hide('battle_results');
    if (w && eng && outcome) {
      this.simOut.length = 0;
      pushBattleHistory(w, outcome);
      applyBattleOutcome(w, eng, outcome, this.simOut);
      const winner = outcome.winner === null ? null : outcome.sides[outcome.winner].factionId;
      addChronicle(w, winner, outcome.summary[0] ?? 'A battle was fought.', 2);
      const e = w.engagements[eng];
      if (e) e.battle = null;
      this.activeEngagementId = null;
      this.battle = null;
      if (this.simOut.length) this.ctx.bus.emit('sim:events', { events: this.simOut.slice() });
      await this.returnToWorld();
      return;
    }
    await this.quitToMenu();
  }

  saveGame(slot: string, name?: string): void {
    const ctx = this.ctx;
    const w = this.world;
    // Keep a world battle's live formation-level state inside the world (distant-battle hand-off).
    if (w && this.activeEngagementId && this.battle) {
      const e = w.engagements[this.activeEngagementId];
      if (e) e.battle = this.battle;
    }
    const scene = ctx.scenes.currentId ?? 'menu';
    const game: SaveGame = {
      format: 'samrajya-save',
      version: SAVE_VERSION,
      meta: {
        slot,
        name: name ?? (slot === 'quick' ? 'Quicksave' : `Chronicle ${slot.replace('slot', '')}`),
        mode: this.mode ?? 'skirmish',
        scene,
        playerFactionId: w?.playerFactionId ?? this.skirmish?.playerFactionId ?? null,
        calendar: w ? { ...w.calendar } : null,
        createdAt: new Date().toISOString(),
        playtimeSec: Math.round((performance.now() - this.startedAt) / 1000),
        buildVersion: BUILD_VERSION,
        summary: w ? `${FACTIONS[w.playerFactionId]?.name ?? ''}, ${formatDate(w.calendar)}` : `Skirmish ${this.battle ? `(${Math.round(this.battle.time)}s)` : ''}`,
        thumbnail: null,
      },
      session: { mode: this.mode ?? 'skirmish', scene, skirmish: this.skirmish, activeEngagementId: this.activeEngagementId, hero: null },
      world: w,
      battle: !w && this.battle ? this.battle : null,
    };
    try {
      ctx.saves.save(game);
      ctx.bus.emit('save:written', { slot });
      if (slot !== 'auto') ctx.ui.toast('Chronicle saved', 'success', 1600);
    } catch (err) {
      ctx.ui.toast(`Save failed: ${(err as Error).message}`, 'danger');
      throw err;
    }
  }

  async loadGame(slot: string): Promise<void> {
    const ctx = this.ctx;
    let game: SaveGame;
    try {
      game = ctx.saves.load(slot);
    } catch (err) {
      ctx.ui.toast(`Could not load: ${(err as Error).message}`, 'danger');
      return;
    }
    ctx.ui.hide('save_load');
    ctx.ui.hide('pause_menu');
    this.world = game.world;
    this.skirmish = game.session.skirmish;
    this.activeEngagementId = game.session.activeEngagementId;
    this.setMode(game.session.mode);
    this.resetLoop();
    ctx.bus.emit('save:loaded', { slot });
    if (game.session.scene === 'battle') {
      const eng = this.world && this.activeEngagementId ? this.world.engagements[this.activeEngagementId] : null;
      const state = eng?.battle ?? game.battle;
      if (state) {
        await ctx.scenes.go({ scene: 'battle', setup: state.setup, state, returnTo: this.world ? 'world' : 'menu' });
        return;
      }
    }
    if (this.world) await ctx.scenes.go({ scene: 'world' });
    else if (this.skirmish) await this.startSkirmish(this.skirmish);
    else await ctx.scenes.go({ scene: 'menu' });
  }

  setTimeScale(scale: number): void {
    this.ctx.loop.setTimeScale(scale);
  }

  togglePause(): void {
    this.ctx.loop.togglePause();
  }

  setPaused(paused: boolean): void {
    this.ctx.loop.setPaused(paused);
  }

  setQuality(tier: QualityTier | 'auto'): void {
    const ctx = this.ctx;
    const settings = ctx.settings;
    settings.quality = tier;
    saveSettings(settings);
    const resolved: QualityTier = tier === 'auto' ? ctx.quality.detection.tier : tier;
    ctx.quality.setTier(resolved, settings.qualityOverrides);
    ctx.render.setQuality(buildQualitySettings(resolved, settings.qualityOverrides));
    ctx.bus.emit('quality:changed', { settings: ctx.quality.settings });
  }

  updateSettings(patch: Partial<GameSettings>): void {
    const ctx = this.ctx;
    Object.assign(ctx.settings, patch);
    saveSettings(ctx.settings);
    ctx.audio.setSettings(ctx.settings);
    ctx.input.setSettings(ctx.settings);
    ctx.ui.setScale(ctx.settings.uiScale);
    ctx.bus.emit('settings:changed', { settings: ctx.settings });
  }
}
