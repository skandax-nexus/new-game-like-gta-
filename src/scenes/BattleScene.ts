/**
 * Real-time battle scene: authoritative formation sim (stepBattle) + local soldier layer + rendering,
 * selection and orders (mouse, keyboard, touch, HUD), battle HUD, results.
 * OWNER: Lead Gameplay Engineer. Baseline by the CTO.
 *
 * TODO(owner): drag-to-form lines (width + facing) on right-drag / two-finger drag, targeting cursor
 * feedback, radial command wheel on touch (ui), deployment phase UI, replay playback from
 * state.commandLog, siege fortifications from setup.fortification, nearby settlement buildings.
 */
import * as THREE from 'three';
import type { AppContext, EnvironmentOverride, GameScene, SceneParams, ScreenPropsMap } from '../app/contracts';
import { makeWeather } from '../sim/strategic/seasons';
import type { BattleCommand, BattleEventRecord, BattleSetup, BattleState, FormationIndex, FormationOrder, FormationShape, SideIndex } from '../core/types';
import { BATTLE_DT } from '../core/constants';
import { hashState } from '../core/save';
import { getHeightfield } from '../core/terrain/cache';
import type { Heightfield } from '../core/terrain/heightfield';
import { EnvironmentRig } from '../render/environment/environment';
import { TerrainRenderer } from '../render/environment/terrain';
import { WaterRenderer } from '../render/environment/water';
import { VegetationRenderer } from '../render/environment/vegetation';
import { WeatherRenderer } from '../render/environment/weather';
import { SoldierRenderer } from '../render/units/soldierRenderer';
import { FormationMarkers } from '../render/units/formationMarkers';
import { BannerRenderer } from '../render/fx/banners';
import { ProjectileRenderer } from '../render/fx/projectiles';
import { ParticleSystem } from '../render/fx/particles';
import { RtsCameraController } from '../render/camera/rtsCamera';
import { pickGround, worldToScreen } from '../render/camera/picking';
import { createBattle, issueBattleCommand, stepBattle } from '../sim/tactical/battle';
import { SoldierSim } from '../sim/tactical/soldiers';
import { UNITS } from '../data/units';
import { applyEnvParams, factionColor } from './common';

type Targeting = { kind: 'attack' | 'charge' | 'flank' | 'defend' } | null;

export class BattleScene implements GameScene {
  readonly id = 'battle' as const;
  readonly fixedStep = BATTLE_DT;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.5, 12000);
  private setup!: BattleSetup;
  private state!: BattleState;
  private hf!: Heightfield;
  private soldiers!: SoldierSim;
  private env!: EnvironmentRig;
  private terrain!: TerrainRenderer;
  private water!: WaterRenderer;
  private veg!: VegetationRenderer;
  private weather!: WeatherRenderer;
  private soldierRenderer!: SoldierRenderer;
  private markers!: FormationMarkers;
  private banners!: BannerRenderer;
  private arrows!: ProjectileRenderer;
  private particles!: ParticleSystem;
  private cam!: RtsCameraController;
  private playerSide: SideIndex = 0;
  private readonly selection = new Set<FormationIndex>();
  private targeting: Targeting = null;
  private runToggle = false;
  private readonly events: BattleEventRecord[] = [];
  private ended = false;
  private hudTimer = 0;
  private time = 0;
  private readonly offs: (() => void)[] = [];
  private readonly ground = { x: 0, z: 0 };
  private readonly focus = new THREE.Vector3();
  private readonly scr = { x: 0, y: 0 };

  constructor(private readonly ctx: AppContext) {}

  async enter(params: SceneParams): Promise<void> {
    if (params.scene !== 'battle') throw new Error('BattleScene needs battle params');
    const ctx = this.ctx;
    const q = ctx.quality.settings;
    this.setup = params.setup;
    const step = async (p: number, label: string): Promise<void> => {
      ctx.bus.emit('scene:loading', { scene: 'battle', progress: p, label });
      await new Promise((r) => setTimeout(r, 0));
    };
    await step(0.1, 'Surveying the battlefield');
    const spec = q.tier === 'low' ? { ...this.setup.terrain, resolution: 257 } : this.setup.terrain;
    this.hf = getHeightfield(spec);
    const hf = this.hf;
    this.state = params.state ?? createBattle(this.setup, hf);
    ctx.session.attachBattle(this.state);
    const ps = this.setup.sides.findIndex((s) => s.controller === 'player');
    this.playerSide = (ps < 0 ? 0 : ps) as SideIndex;
    await step(0.35, 'Mustering the armies');
    this.soldiers = new SoldierSim(this.state, hf.bounds);
    this.soldiers.spawn(this.state, hf);
    const colors: [string, string] = [factionColor(this.setup.sides[0].factionId, '#d9792b'), factionColor(this.setup.sides[1].factionId, '#2f4b8a')];
    this.env = new EnvironmentRig(ctx.render, this.scene, { sceneSize: hf.spec.sizeMeters });
    this.terrain = new TerrainRenderer(hf, { quality: q, detailTile: 9 });
    this.water = new WaterRenderer(hf.bounds, hf.spec.waterLevel, q);
    await step(0.6, 'Planting the groves');
    const zones = this.setup.sides.map((s) => s.deployZone);
    this.veg = new VegetationRenderer(hf, {
      quality: q,
      seed: this.setup.seed,
      exclude: (x, z) => zones.some((r) => x > r.minX - 20 && x < r.maxX + 20 && z > r.minZ - 20 && z < r.maxZ + 20),
    });
    this.weather = new WeatherRenderer(q);
    this.soldierRenderer = new SoldierRenderer(this.soldiers.buffers, { quality: q, sideColors: colors });
    this.markers = new FormationMarkers(this.state.formations.length + 4, colors, this.playerSide);
    this.banners = new BannerRenderer(this.soldiers.buffers, colors, 128);
    this.arrows = new ProjectileRenderer(q.tier === 'low' ? 1200 : 4000, q.tier === 'low' ? 16 : 40);
    this.particles = new ParticleSystem(Math.max(200, q.particles));
    this.scene.add(this.terrain.object, this.water.object, this.veg.object, this.weather.object, this.soldierRenderer.object, this.markers.object, this.banners.group, this.arrows.object, this.particles.object);
    await step(0.85, 'Raising the banners');
    this.cam = new RtsCameraController(this.camera, hf, {
      bounds: { minX: hf.bounds.minX + 40, minZ: hf.bounds.minZ + 40, maxX: hf.bounds.maxX - 40, maxZ: hf.bounds.maxZ - 40 },
      minDistance: 14,
      maxDistance: 900,
      pitchNear: 0.28,
      pitchFar: 1.05,
    });
    this.placeInitialCamera();
    const env = applyEnvParams(this.setup.environment, ctx.params);
    this.env.setEnvironment(env);
    this.terrain.setEnvironment(env);
    this.water.setEnvironment(env);
    this.veg.setEnvironment(env, this.env.wind, this.env.windStrength);
    this.weather.setEnvironment(env);
    ctx.render.setView(this.scene, this.camera);
    ctx.render.resize();
    const own = this.state.formations.filter((f) => f.side === this.playerSide).map((f) => f.index);
    if (own.length) this.selection.add(own[0] as number);
    ctx.ui.show('battle_hud', this.hudProps());
    ctx.bus.emit('audio:mood', { mood: 'battle', intensity: Math.min(1, this.state.formations.length / 30) });
    ctx.bus.emit('audio:sfx', { sfx: 'conch' });
    this.offs.push(
      ctx.bus.on('ui:select_formations', (e) => {
        if (!e.additive) this.selection.clear();
        for (const i of e.formations) this.selection.add(i);
        this.emitSelection();
      }),
      ctx.bus.on('ui:camera_focus', (e) => this.cam.focus(e.x, e.z, e.distance)),
    );
  }

  private placeInitialCamera(): void {
    const own = this.state.formations.filter((f) => f.side === this.playerSide && f.soldiers > 0);
    const enemy = this.state.formations.filter((f) => f.side !== this.playerSide && f.soldiers > 0);
    const c = (arr: typeof own): { x: number; z: number } => ({ x: arr.reduce((s, f) => s + f.x, 0) / Math.max(1, arr.length), z: arr.reduce((s, f) => s + f.z, 0) / Math.max(1, arr.length) });
    const a = c(own);
    const b = c(enemy);
    // Look from behind the player's army toward the enemy.
    const yaw = Math.atan2(a.x - b.x, a.z - b.z);
    const preset = this.ctx.params.camera;
    const dist = preset === 'close' ? 55 : preset === 'overview' ? 650 : 165;
    const fx = a.x + (b.x - a.x) * (preset === 'close' ? 0.12 : 0.3);
    const fz = a.z + (b.z - a.z) * (preset === 'close' ? 0.12 : 0.3);
    this.cam.setState({ x: fx, z: fz, distance: dist, yaw, tilt: preset === 'close' ? -0.05 : 0 });
  }

  private hudProps(): ScreenPropsMap['battle_hud'] {
    return { battle: this.state, playerSide: this.playerSide, selection: [...this.selection], timeScale: this.ctx.loop.timeScale, paused: this.ctx.loop.paused };
  }

  private emitSelection(): void {
    this.ctx.bus.emit('battle:selection', { formations: [...this.selection] });
  }

  issueBattleCommand(cmd: BattleCommand): void {
    this.ctx.actions.issueBattle(cmd);
  }

  fixedUpdate(_step: number): void {
    if (this.ended) return;
    const ctx = this.ctx;
    // Player commands are applied at the step boundary (deterministic + logged for replay).
    for (const cmd of ctx.session.takeBattleCommands()) issueBattleCommand(this.state, this.playerSide, cmd);
    ctx.profiler.begin('sim.tactical');
    stepBattle(this.state, BATTLE_DT, this.hf, this.events);
    ctx.profiler.end('sim.tactical');
    ctx.profiler.begin('sim.soldiers');
    const lod = ctx.quality.settings.soldierLod;
    this.soldiers.step(this.state, BATTLE_DT, this.hf, this.cam.current.x, this.cam.current.z, { lodNear: lod.near, lodMid: lod.mid, lodFar: lod.far });
    ctx.profiler.end('sim.soldiers');
    if (this.events.length) {
      for (const e of this.events) this.onBattleEvent(e);
      ctx.bus.emit('battle:events', { events: this.events.slice() });
      this.events.length = 0;
    }
    if (this.state.outcome && !this.ended) {
      this.ended = true;
      ctx.bus.emit('battle:ended', { outcome: this.state.outcome });
      ctx.bus.emit('audio:mood', { mood: this.state.outcome.winner === this.playerSide ? 'victory' : 'defeat', intensity: 0.5 });
      ctx.session.onBattleEnded(this.state);
    }
  }

  private onBattleEvent(e: BattleEventRecord): void {
    const bus = this.ctx.bus;
    const near = e.x !== null && e.z !== null ? Math.hypot(e.x - this.cam.current.x, e.z - this.cam.current.z) < 260 : false;
    switch (e.kind) {
      case 'volley':
        if (near) bus.emit('audio:sfx', { sfx: 'arrow_volley', volume: 0.6 });
        break;
      case 'charge':
        bus.emit('audio:sfx', { sfx: 'charge_horn', volume: near ? 0.9 : 0.4 });
        if (e.x !== null && e.z !== null) this.particles.emit('dust', e.x, this.hf.heightAt(e.x, e.z), e.z, 24, 10);
        break;
      case 'contact':
        if (near) bus.emit('audio:sfx', { sfx: 'clash' });
        if (e.x !== null && e.z !== null) this.particles.emit('dust', e.x, this.hf.heightAt(e.x, e.z), e.z, 12, 8);
        break;
      case 'formation_routed':
        bus.emit('audio:sfx', { sfx: 'rout_cry', volume: near ? 0.8 : 0.3 });
        if (e.side === this.playerSide) this.ctx.ui.toast('A formation is breaking!', 'warning');
        else this.ctx.ui.toast('The enemy wavers - a formation flees!', 'success');
        break;
      case 'commander_fallen':
        bus.emit('audio:sfx', { sfx: 'conch' });
        this.ctx.ui.toast(e.side === this.playerSide ? 'Our commander has fallen!' : 'The enemy commander has fallen!', e.side === this.playerSide ? 'danger' : 'success');
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ input -> orders

  private ownFormationAt(x: number, z: number, side: SideIndex | null): number {
    let best = -1;
    let bestD = Infinity;
    for (const f of this.state.formations) {
      if (f.soldiers <= 0 || (side !== null && f.side !== side)) continue;
      const r = Math.max(f.width, f.depth) * 0.6 + 6;
      const d = Math.hypot(f.x - x, f.z - z);
      if (d < r && d < bestD) {
        bestD = d;
        best = f.index;
      }
    }
    return best;
  }

  private selected(): FormationIndex[] {
    return [...this.selection].filter((i) => (this.state.formations[i]?.soldiers ?? 0) > 0);
  }

  private order(order: FormationOrder): void {
    const sel = this.selected();
    if (!sel.length) return;
    this.ctx.actions.issueBattle({ kind: 'order', formations: sel, order, queue: false });
    this.ctx.bus.emit('audio:sfx', { sfx: 'order_ack' });
  }

  private handleActions(): void {
    const ctx = this.ctx;
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
        case 'toggle_profiler':
          ctx.profiler.toggleOverlay();
          break;
        case 'menu':
        case 'cancel':
          if (this.targeting) this.targeting = null;
          else {
            ctx.actions.setPaused(true);
            ctx.ui.show('pause_menu', { mode: ctx.session.mode, canSave: true });
          }
          break;
        case 'select':
        case 'select_add': {
          if (!a.pointer || !pickGround(this.camera, a.pointer.ndcX, a.pointer.ndcY, this.hf, 20000, this.ground)) break;
          if (this.targeting) {
            this.applyTargeting(this.ground.x, this.ground.z);
            break;
          }
          const idx = this.ownFormationAt(this.ground.x, this.ground.z, this.playerSide);
          if (a.action === 'select' && !a.shift) this.selection.clear();
          if (idx >= 0) {
            if (this.selection.has(idx) && a.shift) this.selection.delete(idx);
            else this.selection.add(idx);
          } else if (a.pointer.kind === 'touch' && this.selected().length) {
            // Touch: tap on empty ground with a selection = move there.
            this.commandAt(this.ground.x, this.ground.z, null);
          }
          this.emitSelection();
          ctx.bus.emit('audio:sfx', { sfx: 'ui_click' });
          break;
        }
        case 'box_select': {
          if (!a.box) break;
          const x0 = Math.min(a.box.x0, a.box.x1);
          const x1 = Math.max(a.box.x0, a.box.x1);
          const y0 = Math.min(a.box.y0, a.box.y1);
          const y1 = Math.max(a.box.y0, a.box.y1);
          if (!a.shift) this.selection.clear();
          for (const f of this.state.formations) {
            if (f.side !== this.playerSide || f.soldiers <= 0) continue;
            if (!worldToScreen(this.camera, f.x, this.hf.heightAt(f.x, f.z) + 1, f.z, ctx.render.width, ctx.render.height, this.scr)) continue;
            if (this.scr.x >= x0 && this.scr.x <= x1 && this.scr.y >= y0 && this.scr.y <= y1) this.selection.add(f.index);
          }
          this.emitSelection();
          break;
        }
        case 'context_command': {
          if (!a.pointer || !pickGround(this.camera, a.pointer.ndcX, a.pointer.ndcY, this.hf, 20000, this.ground)) break;
          let facing: number | null = null;
          if (a.box && pickGround(this.camera, ((a.box.x0 / Math.max(1, ctx.render.width)) * 2 - 1), -((a.box.y0 / Math.max(1, ctx.render.height)) * 2 - 1), this.hf, 20000, this.scr2)) {
            // Right-drag: start = position, drag direction = facing.
            const dx = this.ground.x - this.scr2.x;
            const dz = this.ground.z - this.scr2.z;
            if (Math.hypot(dx, dz) > 4) {
              facing = Math.atan2(dx, dz);
              this.ground.x = this.scr2.x;
              this.ground.z = this.scr2.z;
            }
          }
          this.commandAt(this.ground.x, this.ground.z, facing);
          break;
        }
        case 'select_all':
          this.selection.clear();
          for (const f of this.state.formations) if (f.side === this.playerSide && f.soldiers > 0) this.selection.add(f.index);
          this.emitSelection();
          break;
        case 'group_assign':
          if (a.group !== null) ctx.actions.issueBattle({ kind: 'set_group', group: a.group, formations: this.selected() });
          break;
        case 'group_select':
          if (a.group !== null) {
            this.selection.clear();
            for (const i of this.state.sides[this.playerSide].groups[a.group] ?? []) this.selection.add(i);
            this.emitSelection();
          }
          break;
        case 'order_hold':
          this.order({ type: 'hold' });
          break;
        case 'order_advance':
          this.order({ type: 'advance', distance: 40 });
          break;
        case 'order_withdraw':
          this.order({ type: 'withdraw', x: null, z: null });
          break;
        case 'order_regroup':
          this.order({ type: 'regroup' });
          break;
        case 'order_attack':
          this.targeting = { kind: 'attack' };
          ctx.ui.toast('Choose an enemy formation to attack', 'info', 1800);
          break;
        case 'order_charge':
          this.targeting = { kind: 'charge' };
          ctx.ui.toast('Choose an enemy formation to charge', 'info', 1800);
          break;
        case 'order_flank':
          this.targeting = { kind: 'flank' };
          ctx.ui.toast('Choose an enemy formation to outflank', 'info', 1800);
          break;
        case 'order_defend':
          this.targeting = { kind: 'defend' };
          ctx.ui.toast('Choose a point to defend', 'info', 1800);
          break;
        case 'order_run_toggle':
          this.runToggle = !this.runToggle;
          ctx.ui.toast(this.runToggle ? 'Formations will run' : 'Formations will march', 'info', 1400);
          break;
        case 'shape_line':
        case 'shape_column':
        case 'shape_square':
        case 'shape_wedge': {
          const shape = a.action.slice(6) as FormationShape;
          const sel = this.selected();
          if (sel.length) ctx.actions.issueBattle({ kind: 'set_shape', formations: sel, shape });
          break;
        }
        case 'camera_focus': {
          const sel = this.selected();
          const f = sel.length ? this.state.formations[sel[0] as number] : null;
          if (f) this.cam.focus(f.x, f.z, null);
          break;
        }
        case 'camera_reset':
          this.placeInitialCamera();
          break;
        default:
          break;
      }
    }
    this.cam.update(this.lastDt, input, ctx.settings, ctx.render.height);
  }

  private readonly scr2 = { x: 0, z: 0 };
  private lastDt = 0;

  private applyTargeting(x: number, z: number): void {
    const t = this.targeting;
    this.targeting = null;
    if (!t) return;
    if (t.kind === 'defend') {
      this.order({ type: 'defend', x, z, radius: 60 });
      return;
    }
    const enemy = this.ownFormationAt(x, z, (1 - this.playerSide) as SideIndex);
    if (enemy < 0) {
      this.ctx.ui.toast('No enemy formation there', 'warning', 1400);
      return;
    }
    if (t.kind === 'attack') this.order({ type: 'attack_target', target: enemy, run: this.runToggle });
    else if (t.kind === 'charge') this.order({ type: 'charge', target: enemy });
    else this.order({ type: 'flank', target: enemy, side: 'left' });
  }

  /** Context command at a ground point: attack an enemy under the cursor, otherwise move there. */
  private commandAt(x: number, z: number, facing: number | null): void {
    const sel = this.selected();
    if (!sel.length) return;
    const enemy = this.ownFormationAt(x, z, (1 - this.playerSide) as SideIndex);
    if (enemy >= 0) {
      const ranged = sel.every((i) => UNITS[this.state.formations[i]!.unitClass].stats.range > 0);
      this.order(ranged ? { type: 'skirmish', target: enemy } : { type: 'attack_target', target: enemy, run: this.runToggle });
      return;
    }
    // Spread multiple formations side by side around the target point.
    const fs = sel.map((i) => this.state.formations[i]!);
    const cx = fs.reduce((s, f) => s + f.x, 0) / fs.length;
    const cz = fs.reduce((s, f) => s + f.z, 0) / fs.length;
    const face = facing ?? Math.atan2(x - cx, z - cz);
    const rx = -Math.cos(face);
    const rz = Math.sin(face);
    const total = fs.reduce((s, f) => s + f.width + 6, -6);
    let off = -total / 2;
    const cmds: BattleCommand[] = [];
    for (const f of fs) {
      const lateral = off + f.width / 2;
      off += f.width + 6;
      cmds.push({ kind: 'order', formations: [f.index], order: { type: 'move_to', x: x + rx * lateral, z: z + rz * lateral, facing: face, run: this.runToggle }, queue: false });
    }
    for (const c of cmds) this.ctx.actions.issueBattle(c);
    this.ctx.bus.emit('audio:sfx', { sfx: 'order_ack' });
  }

  update(dt: number, alpha: number): void {
    const ctx = this.ctx;
    this.time += dt;
    this.lastDt = dt;
    this.handleActions();
    this.cam.getFocus(this.focus);
    ctx.profiler.begin('render.prep');
    this.env.update(dt, this.focus);
    this.water.update(dt);
    this.veg.update(dt);
    this.weather.update(dt, this.camera);
    const a = ctx.loop.paused ? 1 : alpha;
    this.soldierRenderer.update(a, this.camera);
    this.banners.update(dt, a, this.env.windStrength);
    this.arrows.update(this.state, this.state.time - BATTLE_DT * (1 - a), this.hf);
    this.particles.update(dt, ctx.render.height);
    this.markers.update(this.state, this.selection, this.hf, this.time);
    ctx.profiler.end('render.prep');
    ctx.profiler.setCounter('soldiers.visible', this.soldierRenderer.visibleCount);
    ctx.profiler.setCounter('soldiers.alive', this.state.sides[0].soldiers + this.state.sides[1].soldiers);
    ctx.profiler.setCounter('volleys', this.state.volleys.length);
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.12;
      ctx.ui.update('battle_hud', this.hudProps());
    }
    ctx.profiler.begin('render');
    ctx.render.render(dt);
    ctx.profiler.end('render');
  }

  setEnvironment(patch: EnvironmentOverride): void {
    const base = this.setup.environment;
    const season = patch.season ?? base.season;
    const env = { ...base, hour: patch.hour ?? base.hour, season, weather: patch.weather ? makeWeather(patch.weather, season, base.weather.windDirection) : base.weather };
    this.env.setEnvironment(env);
    this.terrain.setEnvironment(env);
    this.water.setEnvironment(env);
    this.veg.setEnvironment(env, this.env.wind, this.env.windStrength);
    this.weather.setEnvironment(env);
  }

  exit(): void {
    this.ctx.session.attachBattle(null);
    for (const off of this.offs) off();
    this.env.dispose();
    this.terrain.dispose();
    this.water.dispose();
    this.veg.dispose();
    this.weather.dispose();
    this.soldierRenderer.dispose();
    this.markers.dispose();
    this.banners.dispose();
    this.arrows.dispose();
    this.particles.dispose();
    this.scene.clear();
  }

  debugState(): unknown {
    const s = this.state;
    return {
      battleId: s.id,
      time: Math.round(s.time * 10) / 10,
      tick: s.tick,
      phase: s.phase,
      sides: s.sides.map((x) => ({ faction: x.factionId, soldiers: x.soldiers, initial: x.initialSoldiers, routed: x.routedFormations, morale: Math.round(x.averageMorale) })),
      formations: s.formations.length,
      soldierCapacity: this.soldiers.buffers.count,
      visibleSoldiers: this.soldierRenderer.visibleCount,
      outcome: s.outcome ? { winner: s.outcome.winner, reason: s.outcome.reason } : null,
      selection: [...this.selection],
      camera: this.cam.getState(),
    };
  }

  stateHash(): string | null {
    return hashState(this.state);
  }
}
