/**
 * Strategic world scene: the region map, settlements, roads, armies; drives tickWorld at
 * STRATEGIC_DT (1 game hour per step at 1x); selection + army orders; HUD; event / engagement prompts.
 * OWNER: Lead Gameplay Engineer. Baseline by the CTO.
 *
 * TODO(owner): hover tooltips, settlement labels (worldToScreen), supply/terrain overlays, minimap,
 * fog of war by intel, smooth sun motion within the hour, cinematic focus on events.
 */
import * as THREE from 'three';
import type { AppContext, GameScene, SceneParams, WorldSelection } from '../app/contracts';
import type { IssuedStrategicCommand, SimEvent, WorldState } from '../core/types';
import { STRATEGIC_DT } from '../core/constants';
import { hashState } from '../core/save';
import type { Heightfield } from '../core/terrain/heightfield';
import { EnvironmentRig } from '../render/environment/environment';
import { TerrainRenderer } from '../render/environment/terrain';
import { WaterRenderer } from '../render/environment/water';
import { VegetationRenderer } from '../render/environment/vegetation';
import { WeatherRenderer } from '../render/environment/weather';
import { SettlementRenderer } from '../render/architecture/settlement';
import { RoadRenderer } from '../render/world/roads';
import { MapOverlays } from '../render/world/overlays';
import { ArmyMarkerRenderer } from '../render/units/armyMarkers';
import { RtsCameraController } from '../render/camera/rtsCamera';
import { pickGround } from '../render/camera/picking';
import { getRegionHeightfield, summarizeWorld, tickWorld } from '../sim/strategic/world';
import { getEnvironmentState } from '../sim/strategic/seasons';
import { predictBattle } from '../sim/strategic/autoresolve';
import { getCouncilRecommendations } from '../sim/strategic/politics';
import { applyEnvParams, layoutsFromWorld } from './common';

/** Fixed display hour of the strategic map (late morning light). */
const WORLD_MAP_HOUR = 10.5;

export class WorldScene implements GameScene {
  readonly id = 'world' as const;
  readonly fixedStep = STRATEGIC_DT;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 2, 30000);
  private world!: WorldState;
  private hf!: Heightfield;
  private env!: EnvironmentRig;
  private terrain!: TerrainRenderer;
  private water!: WaterRenderer;
  private veg!: VegetationRenderer;
  private weather!: WeatherRenderer;
  private settlements!: SettlementRenderer;
  private roads!: RoadRenderer;
  private overlays!: MapOverlays;
  private armies!: ArmyMarkerRenderer;
  private cam!: RtsCameraController;
  private selection: WorldSelection = { kind: 'none', id: null };
  private readonly events: SimEvent[] = [];
  private hudTimer = 0;
  private time = 0;
  private lastEnvHour = -1;
  private blocked = false;
  private readonly offs: (() => void)[] = [];
  private readonly ground = { x: 0, z: 0 };
  private readonly focus = new THREE.Vector3();

  constructor(private readonly ctx: AppContext) {}

  async enter(_params: SceneParams): Promise<void> {
    const ctx = this.ctx;
    const world = ctx.session.world;
    if (!world) throw new Error('WorldScene requires session.world');
    this.world = world;
    const q = ctx.quality.settings;
    const step = async (p: number, label: string): Promise<void> => {
      ctx.bus.emit('scene:loading', { scene: 'world', progress: p, label });
      await new Promise((r) => setTimeout(r, 0));
    };
    await step(0.1, 'Shaping the land');
    this.hf = getRegionHeightfield(world);
    const hf = this.hf;
    await step(0.35, 'Raising settlements');
    this.env = new EnvironmentRig(ctx.render, this.scene, { sceneSize: hf.spec.sizeMeters });
    this.terrain = new TerrainRenderer(hf, { quality: q, detailTile: 30 });
    this.water = new WaterRenderer(hf.bounds, hf.spec.waterLevel, q);
    const layouts = layoutsFromWorld(world, hf);
    this.settlements = new SettlementRenderer(q.shadows.enabled);
    this.settlements.setLayouts(layouts, hf);
    this.roads = new RoadRenderer(world.roads, hf);
    await step(0.6, 'Planting forests');
    this.veg = new VegetationRenderer(hf, {
      quality: q,
      seed: world.region.terrain.seed,
      // Strategic zoom: fewer, shadowless trees (TODO(graphics): impostors + LOD).
      maxInstances: ({ low: 3000, medium: 6000, high: 10000, ultra: 16000 } as const)[q.tier],
      castShadows: false,
      exclude: (x, z) => {
        for (const l of layouts) {
          const dx = x - l.centerX;
          const dz = z - l.centerZ;
          if (dx * dx + dz * dz < l.radius * l.radius * 1.3) return true;
        }
        return false;
      },
    });
    this.weather = new WeatherRenderer(q);
    this.overlays = new MapOverlays(hf);
    this.overlays.setProvinces(world.provinces);
    this.armies = new ArmyMarkerRenderer(64);
    this.armies.syncTick(world.armies);
    this.scene.add(this.terrain.object, this.water.object, this.settlements.object, this.roads.object, this.veg.object, this.weather.object, this.overlays.object, this.armies.object);
    await step(0.85, 'Gathering the court');
    this.cam = new RtsCameraController(this.camera, hf, { bounds: hf.bounds, minDistance: 90, maxDistance: 5200, pitchNear: 0.42, pitchFar: 1.12 });
    const cap = world.factions[world.playerFactionId]?.capitalSettlementId;
    const capS = cap ? world.settlements[cap] : null;
    this.cam.setState({ x: capS?.x ?? 0, z: (capS?.z ?? 0) + 60, distance: ctx.params.camera === 'overview' ? 4200 : 900, yaw: 0.5, tilt: 0 });
    this.applyEnvironment(true);
    ctx.render.setView(this.scene, this.camera);
    ctx.render.resize();
    ctx.ui.show('world_hud', { world, timeScale: ctx.loop.timeScale, paused: ctx.loop.paused, selection: this.selection });
    ctx.bus.emit('audio:mood', { mood: 'world', intensity: 0.3 });
    this.offs.push(
      ctx.bus.on('ui:world_select', (e) => this.select({ kind: e.kind, id: e.id })),
      ctx.bus.on('ui:camera_focus', (e) => this.cam.focus(e.x, e.z, e.distance)),
      ctx.bus.on('ui:overlay', (e) => {
        if (e.overlay === 'borders') this.overlays.setBordersVisible(e.visible);
      }),
    );
    // Resume any prompt that was pending when the game was saved.
    this.checkBlockingPrompts();
  }

  private applyEnvironment(force: boolean): void {
    // The strategic map changes season/weather daily but keeps a fixed, readable time of day (a day
    // passes every 2 s at 1x - cycling the sun that fast would strobe). ?hour= overrides.
    const day = Math.floor(this.world.calendar.totalHours / 24);
    if (!force && day === this.lastEnvHour) return;
    this.lastEnvHour = day;
    const env = applyEnvParams({ ...getEnvironmentState(this.world), hour: WORLD_MAP_HOUR }, this.ctx.params);
    this.env.setEnvironment(env);
    this.terrain.setEnvironment(env);
    this.water.setEnvironment(env);
    this.veg.setEnvironment(env, this.env.wind, this.env.windStrength);
    this.weather.setEnvironment(env);
  }

  private select(sel: WorldSelection): void {
    this.selection = sel;
    this.ctx.bus.emit('world:selection', sel);
    if (sel.kind === 'army' && sel.id) {
      const a = this.world.armies[sel.id];
      this.overlays.setSelection(a ? a.x : null, a ? a.z : null, 60);
    } else if (sel.kind === 'settlement' && sel.id) {
      const s = this.world.settlements[sel.id];
      this.overlays.setSelection(s ? s.x : null, s ? s.z : null, (s?.radius ?? 100) * 1.25);
    } else this.overlays.setSelection(null, null, 1);
  }

  /** Pause and show the first blocking prompt (player engagement or event), if any. */
  private checkBlockingPrompts(): void {
    const w = this.world;
    const ctx = this.ctx;
    const eng = Object.values(w.engagements).find((e) => e.status === 'pending_player');
    if (eng) {
      this.blocked = true;
      ctx.actions.setPaused(true);
      ctx.ui.show('engagement_prompt', { world: w, engagementId: eng.id, prediction: predictBattle(w, eng.id) });
      this.cam.focus(eng.x, eng.z, 700);
      return;
    }
    const ev = w.events.pending.find((e) => e.scope.factionId === w.playerFactionId);
    if (ev && !ctx.ui.isVisible('event_modal')) {
      this.blocked = true;
      ctx.actions.setPaused(true);
      ctx.ui.show('event_modal', { world: w, instanceId: ev.id });
      ctx.bus.emit('audio:sfx', { sfx: 'notify' });
      return;
    }
    if (w.victory.status !== 'ongoing' && !ctx.ui.isVisible('scenario_results')) {
      this.blocked = true;
      ctx.actions.setPaused(true);
      ctx.ui.show('scenario_results', { world: w });
      return;
    }
    this.blocked = !!eng || !!ev;
  }

  fixedUpdate(_step: number): void {
    if (this.blocked) return;
    const cmds: IssuedStrategicCommand[] = this.ctx.session.takeStrategicCommands().map((cmd) => ({ factionId: this.world.playerFactionId, hour: 0, cmd }));
    tickWorld(this.world, cmds, this.events, this.hf);
    this.armies.syncTick(this.world.armies);
    if (this.events.length) {
      this.ctx.bus.emit('sim:events', { events: this.events.slice() });
      for (const e of this.events) {
        if (e.kind === 'engagement_started' && e.involvesPlayer) this.checkBlockingPrompts();
        else if (e.kind === 'event_fired' && e.factionId === this.world.playerFactionId) this.checkBlockingPrompts();
        else if (e.kind === 'scenario_ended') this.checkBlockingPrompts();
        else if (e.kind === 'engagement_resolved' || e.kind === 'construction_complete') this.ctx.bus.emit('audio:sfx', { sfx: e.kind === 'construction_complete' ? 'build' : 'drum_hit' });
      }
      this.events.length = 0;
    }
    this.ctx.bus.emit('world:tick', { calendar: this.world.calendar });
  }

  update(dt: number, alpha: number): void {
    const ctx = this.ctx;
    this.time += dt;
    // Unblock when the player resolved the prompt.
    if (this.blocked && !ctx.ui.isVisible('engagement_prompt') && !ctx.ui.isVisible('event_modal') && !ctx.ui.isVisible('scenario_results')) {
      this.blocked = false;
      this.checkBlockingPrompts();
      if (!this.blocked && !ctx.ui.isVisible('pause_menu')) ctx.actions.setPaused(false);
    }
    const input = ctx.input.frame();
    for (const a of input.actions) {
      switch (a.action) {
        case 'pause':
          ctx.actions.togglePause();
          break;
        case 'speed_up':
          ctx.actions.setTimeScale(ctx.loop.timeScale * 2);
          break;
        case 'speed_down':
          ctx.actions.setTimeScale(ctx.loop.timeScale / 2);
          break;
        case 'menu':
        case 'cancel':
          if (this.selection.kind !== 'none') this.select({ kind: 'none', id: null });
          else {
            ctx.actions.setPaused(true);
            ctx.ui.show('pause_menu', { mode: ctx.session.mode, canSave: true });
          }
          break;
        case 'toggle_profiler':
          ctx.profiler.toggleOverlay();
          break;
        case 'quick_save':
          ctx.actions.saveGame('quick');
          break;
        case 'quick_load':
          void ctx.actions.loadGame('quick');
          break;
        case 'overlay_borders':
          this.overlays.setBordersVisible(!this.overlays.object.children[0]?.visible);
          break;
        case 'select':
        case 'select_add':
          if (a.pointer) this.pickAt(a.pointer.ndcX, a.pointer.ndcY);
          break;
        case 'camera_focus':
          if (a.pointer && pickGround(this.camera, a.pointer.ndcX, a.pointer.ndcY, this.hf, 30000, this.ground)) this.cam.focus(this.ground.x, this.ground.z, null);
          break;
        case 'context_command':
          if (a.pointer) this.commandAt(a.pointer.ndcX, a.pointer.ndcY);
          break;
        default:
          break;
      }
    }
    this.cam.update(dt, input, ctx.settings, ctx.render.height);
    this.cam.getFocus(this.focus);
    this.applyEnvironment(false);
    this.env.update(dt, this.focus);
    this.water.update(dt);
    this.veg.update(dt);
    this.weather.update(dt, this.camera);
    this.armies.update(this.world.armies, ctx.loop.paused ? 1 : alpha, this.hf, this.time);
    const sel = this.selection.kind === 'army' && this.selection.id ? this.world.armies[this.selection.id] : null;
    if (sel) {
      this.overlays.setSelection(sel.x, sel.z, 60);
      this.overlays.setPath(sel.path.slice(sel.pathIndex), sel);
    } else this.overlays.setPath(null, null);
    this.overlays.setEngagements(
      Object.values(this.world.engagements)
        .filter((e) => e.status !== 'resolved')
        .map((e) => ({ x: e.x, z: e.z })),
      this.time,
    );
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.25;
      ctx.ui.update('world_hud', { world: this.world, timeScale: ctx.loop.timeScale, paused: ctx.loop.paused, selection: this.selection });
      if (ctx.ui.isVisible('settlement_panel') && this.selection.kind === 'settlement' && this.selection.id) ctx.ui.update('settlement_panel', { world: this.world, settlementId: this.selection.id });
      if (ctx.ui.isVisible('council')) ctx.ui.update('council', { world: this.world, recommendations: getCouncilRecommendations(this.world, this.world.playerFactionId) });
    }
    ctx.profiler.begin('render');
    ctx.render.render(dt);
    ctx.profiler.end('render');
  }

  private pickAt(ndcX: number, ndcY: number): void {
    if (!pickGround(this.camera, ndcX, ndcY, this.hf, 30000, this.ground)) return;
    const g = this.ground;
    const tokenR = Math.max(70, this.cam.current.distance * 0.04);
    let best: WorldSelection = { kind: 'none', id: null };
    let bestD = Infinity;
    for (const a of Object.values(this.world.armies)) {
      const d = Math.hypot(a.x - g.x, a.z - g.z);
      if (d < tokenR && d < bestD) {
        bestD = d;
        best = { kind: 'army', id: a.id };
      }
    }
    if (best.kind === 'none') {
      for (const s of Object.values(this.world.settlements)) {
        const d = Math.hypot(s.x - g.x, s.z - g.z);
        if (d < s.radius * 1.3 && d < bestD) {
          bestD = d;
          best = { kind: 'settlement', id: s.id };
        }
      }
    }
    this.select(best);
    this.ctx.bus.emit('audio:sfx', { sfx: 'ui_click' });
  }

  private commandAt(ndcX: number, ndcY: number): void {
    const sel = this.selection;
    if (sel.kind !== 'army' || !sel.id) return;
    const a = this.world.armies[sel.id];
    if (!a || a.factionId !== this.world.playerFactionId) return;
    if (!pickGround(this.camera, ndcX, ndcY, this.hf, 30000, this.ground)) return;
    const g = this.ground;
    const enemy = Object.values(this.world.armies).find((o) => o.factionId !== a.factionId && Math.hypot(o.x - g.x, o.z - g.z) < 80);
    if (enemy) this.ctx.actions.issueStrategic({ kind: 'army_order', armyId: a.id, order: { kind: 'attack_army', targetArmyId: enemy.id } });
    else this.ctx.actions.issueStrategic({ kind: 'move_army', armyId: a.id, x: g.x, z: g.z });
    this.ctx.bus.emit('audio:sfx', { sfx: 'order_ack' });
  }

  exit(): void {
    for (const off of this.offs) off();
    this.env.dispose();
    this.terrain.dispose();
    this.water.dispose();
    this.veg.dispose();
    this.weather.dispose();
    this.settlements.dispose();
    this.roads.dispose();
    this.overlays.dispose();
    this.armies.dispose();
    this.scene.clear();
  }

  debugState(): unknown {
    return { world: summarizeWorld(this.world), selection: this.selection, camera: this.cam.getState(), blocked: this.blocked };
  }

  stateHash(): string | null {
    return hashState(this.world);
  }

  setEnvironment(): void {
    this.applyEnvironment(true);
  }
}
