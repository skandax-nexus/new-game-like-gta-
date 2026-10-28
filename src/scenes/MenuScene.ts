/**
 * Main menu with a living 3D backdrop: the capital at golden hour, slowly orbiting camera.
 * OWNER: Lead UI/UX Engineer (backdrop composition with Art Director). Baseline by the CTO.
 */
import * as THREE from 'three';
import type { AppContext, GameScene, SceneParams } from '../app/contracts';
import { BUILD_VERSION, HERO_MAP_SIZE } from '../core/constants';
import { getHeightfield } from '../core/terrain/cache';
import { createLocalTerrainSpec, type Heightfield } from '../core/terrain/heightfield';
import { EnvironmentRig } from '../render/environment/environment';
import { TerrainRenderer } from '../render/environment/terrain';
import { WaterRenderer } from '../render/environment/water';
import { VegetationRenderer } from '../render/environment/vegetation';
import { SettlementRenderer } from '../render/architecture/settlement';
import { GRADE_PRESETS } from '../render/style/palette';
import { makeEnvironment } from '../sim/strategic/seasons';
import { resolveRegionTerrain } from '../sim/strategic/world';
import { applyEnvParams, layoutsFromRegionData } from './common';

export class MenuScene implements GameScene {
  readonly id = 'menu' as const;
  readonly fixedStep = 1 / 30;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.5, 9000);
  private env: EnvironmentRig | null = null;
  private terrain: TerrainRenderer | null = null;
  private water: WaterRenderer | null = null;
  private veg: VegetationRenderer | null = null;
  private settlements: SettlementRenderer | null = null;
  private hf: Heightfield | null = null;
  private center = new THREE.Vector3();
  private t = 0;

  constructor(private readonly ctx: AppContext) {}

  async enter(_params: SceneParams): Promise<void> {
    const ctx = this.ctx;
    const q = ctx.quality.settings;
    ctx.bus.emit('scene:loading', { scene: 'menu', progress: 0.1, label: 'Raising the capital' });
    const { terrain, sites } = resolveRegionTerrain();
    const cap = sites.find((s) => s.id === 'rajapura') ?? sites[0]!;
    this.center.set(cap.x, 0, cap.z);
    const spec = createLocalTerrainSpec(terrain, cap.x, cap.z, HERO_MAP_SIZE * 1.5, q.tier === 'low' ? 193 : 289, 'capital');
    const hf = getHeightfield(spec);
    this.hf = hf;
    this.center.y = hf.heightAt(cap.x, cap.z);
    ctx.bus.emit('scene:loading', { scene: 'menu', progress: 0.5, label: 'Lighting the lamps' });
    await new Promise((r) => setTimeout(r, 0));
    this.env = new EnvironmentRig(ctx.render, this.scene, { sceneSize: spec.sizeMeters });
    this.terrain = new TerrainRenderer(hf, { quality: q, maxChunksPerSide: 2, detailTile: 14 });
    this.scene.add(this.terrain.object);
    this.water = new WaterRenderer(hf.bounds, spec.waterLevel, q);
    this.scene.add(this.water.object);
    const layouts = layoutsFromRegionData(hf);
    this.settlements = new SettlementRenderer(q.shadows.enabled);
    this.settlements.setLayouts(layouts, hf);
    this.scene.add(this.settlements.object);
    this.veg = new VegetationRenderer(hf, {
      quality: q,
      seed: 4,
      maxInstances: q.tier === 'low' ? 1500 : 5000,
      exclude: (x, z) => layouts.some((l) => (x - l.centerX) ** 2 + (z - l.centerZ) ** 2 < (l.radius * 1.1) ** 2),
    });
    this.scene.add(this.veg.object);
    const env = applyEnvParams(makeEnvironment(17.6, 'sharad', 'hazy'), ctx.params);
    this.env.setEnvironment(env);
    this.terrain.setEnvironment(env);
    this.water.setEnvironment(env);
    this.veg.setEnvironment(env, this.env.wind, this.env.windStrength);
    ctx.render.setView(this.scene, this.camera);
    ctx.render.post.setGrade(GRADE_PRESETS.menu);
    ctx.render.resize();
    this.placeCamera(0);
    ctx.ui.show('main_menu', { canContinue: ctx.saves.list().length > 0, version: BUILD_VERSION });
    ctx.bus.emit('audio:mood', { mood: 'menu', intensity: 0.3 });
    ctx.bus.emit('scene:loading', { scene: 'menu', progress: 1, label: 'Ready' });
  }

  private placeCamera(t: number): void {
    const a = 2.3 + t * 0.025;
    const r = 260;
    const hf = this.hf!;
    const x = this.center.x + Math.sin(a) * r;
    const z = this.center.z + Math.cos(a) * r;
    const y = Math.max(hf.heightAt(x, z), hf.spec.waterLevel) + 70;
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.center.x, this.center.y + 18, this.center.z);
  }

  fixedUpdate(_step: number): void {}

  update(dt: number, _alpha: number): void {
    const ctx = this.ctx;
    const input = ctx.input.frame();
    for (const a of input.actions) if (a.action === 'toggle_profiler') ctx.profiler.toggleOverlay();
    this.t += ctx.params.paused ? 0 : dt;
    this.placeCamera(this.t);
    this.env?.update(dt, this.center);
    this.water?.update(dt);
    this.veg?.update(dt);
    ctx.render.render(dt);
  }

  exit(): void {
    this.env?.dispose();
    this.terrain?.dispose();
    this.water?.dispose();
    this.veg?.dispose();
    this.settlements?.dispose();
    this.scene.clear();
  }

  debugState(): unknown {
    return { scene: 'menu', center: { x: this.center.x, z: this.center.z } };
  }

  stateHash(): string | null {
    return null;
  }
}
