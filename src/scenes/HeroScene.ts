/**
 * Hero exploration scene (GDD §3): walk the capital (or any settlement) in third person, inspect
 * buildings and people. OWNER: Lead Gameplay Engineer. Baseline by the CTO.
 * Reuses SoldierBuffers + SoldierRenderer for the hero and villagers (one GPU animation path).
 */
import * as THREE from 'three';
import type { AppContext, GameScene, SceneParams } from '../app/contracts';
import type { EnvironmentState, SoldierBuffers, TerrainSpec } from '../core/types';
import { SOLDIER_ANIM, UNIT_CLASS_INDEX } from '../core/types';
import { HERO_DT, HERO_MAP_RESOLUTION, HERO_MAP_SIZE } from '../core/constants';
import { getHeightfield } from '../core/terrain/cache';
import { createLocalTerrainSpec, type Heightfield } from '../core/terrain/heightfield';
import { Rng } from '../core/rng';
import { EnvironmentRig } from '../render/environment/environment';
import { TerrainRenderer } from '../render/environment/terrain';
import { WaterRenderer } from '../render/environment/water';
import { VegetationRenderer } from '../render/environment/vegetation';
import { SettlementRenderer } from '../render/architecture/settlement';
import type { SettlementLayout } from '../render/architecture/layout';
import { SoldierRenderer } from '../render/units/soldierRenderer';
import { HeroCameraController } from '../render/camera/heroCamera';
import { createSoldierBuffers } from '../sim/tactical/soldiers';
import { getEnvironmentState, makeEnvironment } from '../sim/strategic/seasons';
import { resolveRegionTerrain } from '../sim/strategic/world';
import { REGION } from '../data/region';
import { HeroController, collidersFromLayouts, pointsOfInterest, type Collider, type PointOfInterest } from '../hero/hero';
import { applyEnvParams, factionColor, layoutsFromRegionData, layoutsFromWorld } from './common';

const VILLAGERS = 40;

export class HeroScene implements GameScene {
  readonly id = 'hero' as const;
  readonly fixedStep = HERO_DT;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(55, 1, 0.2, 6000);
  private hf!: Heightfield;
  private env!: EnvironmentRig;
  private terrain!: TerrainRenderer;
  private water!: WaterRenderer;
  private veg!: VegetationRenderer;
  private settlements!: SettlementRenderer;
  private people!: SoldierRenderer;
  private buffers!: SoldierBuffers;
  private cam!: HeroCameraController;
  private hero!: HeroController;
  private colliders: Collider[] = [];
  private pois: PointOfInterest[] = [];
  private layouts: SettlementLayout[] = [];
  private settlementName = '';
  private settlementId = '';
  private returnTo: 'world' | 'menu' = 'menu';
  private targets: Float32Array = new Float32Array(0);
  private readonly rng = new Rng(77);
  private prompt: PointOfInterest | null = null;
  private hudTimer = 0;
  private readonly fwd = { x: 0, z: -1 };
  private readonly focus = new THREE.Vector3();

  constructor(private readonly ctx: AppContext) {}

  async enter(params: SceneParams): Promise<void> {
    if (params.scene !== 'hero') throw new Error('HeroScene needs hero params');
    const ctx = this.ctx;
    const q = ctx.quality.settings;
    this.returnTo = params.returnTo;
    ctx.bus.emit('scene:loading', { scene: 'hero', progress: 0.1, label: 'Approaching the gates' });
    await new Promise((r) => setTimeout(r, 0));
    const world = ctx.session.world;
    let base: TerrainSpec;
    let cx: number;
    let cz: number;
    let owner: string | null = null;
    let env: EnvironmentState;
    if (world) {
      const id = params.settlementId ?? world.factions[world.playerFactionId]?.capitalSettlementId ?? Object.keys(world.settlements)[0]!;
      const s = world.settlements[id]!;
      base = world.region.terrain;
      cx = s.x;
      cz = s.z;
      owner = s.ownerFactionId;
      this.settlementName = s.name;
      this.settlementId = s.id;
      env = getEnvironmentState(world);
      env.hour = Math.min(17.5, Math.max(7.5, env.hour));
    } else {
      const { terrain, sites } = resolveRegionTerrain();
      const id = params.settlementId ?? ctx.params.settlement ?? 'rajapura';
      const site = sites.find((s) => s.id === id) ?? sites[0]!;
      const def = REGION.settlements.find((s) => s.id === site.id)!;
      base = terrain;
      cx = site.x;
      cz = site.z;
      owner = def.defaultOwner;
      this.settlementName = def.name;
      this.settlementId = def.id;
      env = makeEnvironment(9.5, 'sharad', 'clear');
    }
    env = applyEnvParams(env, ctx.params);
    const spec = createLocalTerrainSpec(base, cx, cz, HERO_MAP_SIZE, q.tier === 'low' ? 257 : HERO_MAP_RESOLUTION, 'capital');
    this.hf = getHeightfield(spec);
    const hf = this.hf;
    ctx.bus.emit('scene:loading', { scene: 'hero', progress: 0.45, label: 'Walking the streets' });
    await new Promise((r) => setTimeout(r, 0));
    this.layouts = world ? layoutsFromWorld(world, hf) : layoutsFromRegionData(hf);
    this.colliders = collidersFromLayouts(this.layouts);
    this.pois = pointsOfInterest(this.layouts);
    this.env = new EnvironmentRig(ctx.render, this.scene, { sceneSize: spec.sizeMeters });
    this.terrain = new TerrainRenderer(hf, { quality: q, maxChunksPerSide: 4, detailTile: 6 });
    this.water = new WaterRenderer(hf.bounds, spec.waterLevel, q);
    this.settlements = new SettlementRenderer(q.shadows.enabled);
    this.settlements.setLayouts(this.layouts, hf);
    const layouts = this.layouts;
    this.veg = new VegetationRenderer(hf, {
      quality: q,
      seed: 99,
      maxInstances: q.tier === 'low' ? 2500 : 9000,
      exclude: (x, z) => layouts.some((l) => (x - l.centerX) ** 2 + (z - l.centerZ) ** 2 < (l.radius + 8) ** 2),
    });
    // Hero spawns at the settlement edge facing the center.
    const main = layouts.find((l) => l.id === this.settlementId) ?? layouts[0];
    const r = (main?.radius ?? 100) * 0.95;
    this.hero = new HeroController(cx, cz + r);
    this.hero.facing = Math.PI;
    // People: hero (index 0) + villagers.
    this.buffers = createSoldierBuffers(1 + VILLAGERS);
    this.buffers.count = 1 + VILLAGERS;
    this.targets = new Float32Array((1 + VILLAGERS) * 2);
    for (let i = 0; i <= VILLAGERS; i++) {
      const b = this.buffers;
      b.unitClass[i] = i === 0 ? UNIT_CLASS_INDEX.elite_guards : i % 6 === 0 ? UNIT_CLASS_INDEX.spearmen : UNIT_CLASS_INDEX.engineers;
      b.side[i] = i === 0 ? 0 : 1;
      b.alive[i] = 1;
      b.variant[i] = this.rng.int(0, 255);
      b.animSpeed[i] = 1;
      if (i > 0) {
        const a = this.rng.range(0, Math.PI * 2);
        const d = this.rng.range(10, r * 0.9);
        b.posX[i] = b.prevX[i] = cx + Math.sin(a) * d;
        b.posZ[i] = b.prevZ[i] = cz + Math.cos(a) * d;
        b.posY[i] = b.prevY[i] = hf.heightAt(b.posX[i]!, b.posZ[i]!);
        this.pickTarget(i, cx, cz, r);
      }
    }
    this.people = new SoldierRenderer(this.buffers, { quality: q, sideColors: [factionColor(owner, '#d9792b'), '#b9a27a'] });
    this.scene.add(this.terrain.object, this.water.object, this.settlements.object, this.veg.object, this.people.object);
    this.cam = new HeroCameraController(this.camera, hf);
    this.cam.yaw = 0;
    this.env.setEnvironment(env);
    this.terrain.setEnvironment(env);
    this.water.setEnvironment(env);
    this.veg.setEnvironment(env, this.env.wind, this.env.windStrength);
    ctx.render.setView(this.scene, this.camera);
    ctx.render.resize();
    ctx.ui.show('hero_hud', { settlementName: this.settlementName, prompt: null });
    ctx.bus.emit('audio:mood', { mood: 'city', intensity: 0.2 });
  }

  private pickTarget(i: number, cx: number, cz: number, r: number): void {
    const a = this.rng.range(0, Math.PI * 2);
    const d = this.rng.range(5, r * 0.9);
    this.targets[i * 2] = cx + Math.sin(a) * d;
    this.targets[i * 2 + 1] = cz + Math.cos(a) * d;
  }

  fixedUpdate(step: number): void {
    // Villagers wander (cosmetic, not part of the authoritative sim).
    const b = this.buffers;
    const main = this.layouts.find((l) => l.id === this.settlementId);
    for (let i = 1; i < b.count; i++) {
      b.prevX[i] = b.posX[i]!;
      b.prevZ[i] = b.posZ[i]!;
      b.prevY[i] = b.posY[i]!;
      b.prevFacing[i] = b.facing[i]!;
      const tx = this.targets[i * 2]!;
      const tz = this.targets[i * 2 + 1]!;
      const dx = tx - b.posX[i]!;
      const dz = tz - b.posZ[i]!;
      const d = Math.hypot(dx, dz);
      if (d < 1.5) {
        if (this.rng.chance(0.01)) this.pickTarget(i, main?.centerX ?? this.hero.x, main?.centerZ ?? this.hero.z, (main?.radius ?? 80) * 0.9);
        if (b.anim[i] !== SOLDIER_ANIM.idle) {
          b.anim[i] = SOLDIER_ANIM.idle;
          b.animTime[i] = 0;
        }
      } else {
        const sp = 1.2;
        b.posX[i] = b.posX[i]! + (dx / d) * sp * step;
        b.posZ[i] = b.posZ[i]! + (dz / d) * sp * step;
        b.facing[i] = Math.atan2(dx, dz);
        if (b.anim[i] !== SOLDIER_ANIM.walk) {
          b.anim[i] = SOLDIER_ANIM.walk;
          b.animTime[i] = 0;
        }
      }
      b.posY[i] = this.hf.heightAt(b.posX[i]!, b.posZ[i]!);
      b.animTime[i] = b.animTime[i]! + step;
    }
  }

  update(dt: number, alpha: number): void {
    const ctx = this.ctx;
    const input = ctx.input.frame();
    for (const a of input.actions) {
      if (a.action === 'hero_exit' || a.action === 'menu') {
        if (this.returnTo === 'world' && ctx.session.world) void ctx.actions.returnToWorld();
        else void ctx.actions.quitToMenu();
        return;
      }
      if (a.action === 'toggle_profiler') ctx.profiler.toggleOverlay();
      if (a.action === 'hero_interact' && this.prompt) this.interact(this.prompt);
    }
    this.cam.forward(this.fwd);
    this.hero.update(dt, Math.max(-1, Math.min(1, input.moveX)), Math.max(-1, Math.min(1, input.moveY)), input.run, this.fwd.x, this.fwd.z, this.hf, this.colliders);
    const b = this.buffers;
    b.prevX[0] = b.posX[0] = this.hero.x;
    b.prevZ[0] = b.posZ[0] = this.hero.z;
    b.prevY[0] = b.posY[0] = this.hero.y;
    b.prevFacing[0] = b.facing[0] = this.hero.facing;
    b.anim[0] = this.hero.anim;
    b.animTime[0] = this.hero.animTime;
    this.cam.update(dt, input, this.hero.x, this.hero.y, this.hero.z);
    // Nearest point of interest.
    let best: PointOfInterest | null = null;
    let bd = Infinity;
    for (const p of this.pois) {
      const d = Math.hypot(p.x - this.hero.x, p.z - this.hero.z);
      if (d < p.radius && d < bd) {
        bd = d;
        best = p;
      }
    }
    this.prompt = best;
    this.focus.set(this.hero.x, this.hero.y, this.hero.z);
    this.env.update(dt, this.focus);
    this.water.update(dt);
    this.veg.update(dt);
    this.people.update(alpha, this.camera);
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.2;
      ctx.ui.update('hero_hud', { settlementName: this.settlementName, prompt: best ? `${best.label}${input.touchMode ? '' : ' (E)'}` : null });
    }
    ctx.render.render(dt);
  }

  private interact(p: PointOfInterest): void {
    const w = this.ctx.session.world;
    const s = w?.settlements[p.settlementId];
    let text = `${p.label.replace(/^(Inspect|Visit|Enter|Speak with|Hear|Walk around|Descend|Review|Go down to|Read) (the )?/i, '')}`;
    if (s) {
      if (p.kind === 'granary') text = `The granary holds ${Math.round(s.foodStored).toLocaleString('en-IN')} measures of grain (price ${s.grainPrice.toFixed(2)}).`;
      else if (p.kind === 'market_stall') text = `Merchants report trade of ${Math.round(s.tradeIncome)} a month. Grain sells at ${s.grainPrice.toFixed(2)}.`;
      else if (p.kind === 'well' || p.kind === 'stepwell') text = `Villagers speak of water at ${Math.round(s.waterAvailability * 100)}% and loyalty at ${Math.round(s.loyalty * 100)}%.`;
      else if (p.kind === 'barracks') text = `${s.recruitPool} recruits drill in the yard.`;
      else text = `${s.name}: public order ${Math.round(s.publicOrder * 100)}%, mood "${s.rebellionStage.replace('_', ' ')}".`;
    } else text = `${p.label} - the people go about their day.`;
    this.ctx.ui.toast(text, 'info', 4200);
    this.ctx.bus.emit('audio:sfx', { sfx: 'bell', volume: 0.5 });
  }

  exit(): void {
    this.env.dispose();
    this.terrain.dispose();
    this.water.dispose();
    this.veg.dispose();
    this.settlements.dispose();
    this.people.dispose();
    this.scene.clear();
  }

  debugState(): unknown {
    return { settlement: this.settlementId, hero: { x: this.hero.x, z: this.hero.z }, prompt: this.prompt?.label ?? null, pois: this.pois.length };
  }

  stateHash(): string | null {
    return null;
  }
}
