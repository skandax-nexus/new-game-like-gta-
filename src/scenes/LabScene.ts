/**
 * Feature lab scene: `?scene=lab&lab=<id>` loads `<id>.lab.ts` (src/scenes/lab/registry.ts) into a ready-made
 * host - renderer view, orbit camera, EnvironmentRig, ground plane, optional region-terrain window, HUD.
 * OWNER: Engine Developer - Contracts (CORE-01). Contract for lab authors: src/scenes/lab/types.ts.
 *
 * Graphics / gameplay tickets show features the game scenes do not drive yet (STUDIO.md W6). Unknown lab ids show
 * a themed error panel (listing the labs that exist) and fall back to the main menu. Like every scene it reaches
 * sceneReady after its first frames, supports freeze / screenshot, and answers __SAMRAJYA__.call(): 'noop',
 * 'lab.info', 'lab.list', 'lab.frame', 'lab.env', then the lab's own debugCommand.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { AppContext, EnvironmentOverride, GameScene, SceneParams } from '../app/contracts';
import { DEBUG_UNHANDLED } from '../app/contracts';
import type { EnvironmentState, Vec3 } from '../core/types';
import { BATTLE_MAP_RESOLUTION, BATTLE_MAP_SIZE } from '../core/constants';
import { getHeightfield } from '../core/terrain/cache';
import { createLocalTerrainSpec } from '../core/terrain/heightfield';
import { EnvironmentRig } from '../render/environment/environment';
import { TerrainRenderer } from '../render/environment/terrain';
import { WaterRenderer } from '../render/environment/water';
import { createDetailTexture, createNoiseNormalMap } from '../render/environment/textures';
import { MATERIALS } from '../render/style/palette';
import { makeEnvironment, makeWeather } from '../sim/strategic/seasons';
import { resolveRegionTerrain } from '../sim/strategic/world';
import { LAB_INDEX, listLabs, loadLab } from './lab/registry';
import type { LabHost, LabInstance, LabModule, LabTerrain, LabTerrainOptions } from './lab/types';

const DEG = Math.PI / 180;
const DEFAULT_HOUR = 16.6;
const ERROR_PANEL_MS = 9000;

export class LabScene implements GameScene {
  readonly id = 'lab' as const;
  readonly fixedStep = 1 / 30;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 8000);
  private controls: OrbitControls | null = null;
  private env: EnvironmentRig | null = null;
  private envState: EnvironmentState | null = null;
  private ground: THREE.Mesh | null = null;
  private terrain: TerrainRenderer | null = null;
  private water: WaterRenderer | null = null;
  private readonly owned: { dispose(): void }[] = [];
  private lab: LabModule | null = null;
  private labPath = '';
  private instance: LabInstance | null = null;
  private labId: string | null = null;
  private failure: string | null = null;
  private fallbackRequested = false;
  private hud: HTMLElement | null = null;
  private hudInfo: HTMLElement | null = null;
  private hudStats: HTMLElement | null = null;
  private hudTimer = 0;
  private info: readonly string[] = [];
  private readonly tmpPos = new THREE.Vector3();

  constructor(private readonly ctx: AppContext) {}

  async enter(params: SceneParams): Promise<void> {
    const ctx = this.ctx;
    this.labId = params.scene === 'lab' ? params.labId : null;
    this.scene.background = new THREE.Color(MATERIALS.basalt).multiplyScalar(0.25);
    ctx.render.setView(this.scene, this.camera);
    ctx.render.resize();
    const id = this.labId;
    if (!id || !LAB_INDEX.entries[id]) {
      this.fail(id ? `No lab named '${id}'.` : 'No lab id given (use ?scene=lab&lab=<id>).');
      return;
    }
    ctx.bus.emit('scene:loading', { scene: 'lab', progress: 0.1, label: `Opening lab ${id}` });
    let loaded: Awaited<ReturnType<typeof loadLab>>;
    try {
      loaded = await loadLab(id);
    } catch (err) {
      this.fail(`Lab '${id}' could not be loaded: ${(err as Error).message}`);
      return;
    }
    if (!loaded) {
      this.fail(`No lab named '${id}'.`);
      return;
    }
    this.lab = loaded.lab;
    this.labPath = loaded.path;
    this.buildHost();
    if (!ctx.params.noUi) this.createHud();
    ctx.bus.emit('scene:loading', { scene: 'lab', progress: 0.35, label: loaded.lab.title });
    this.instance = await loaded.lab.setup(ctx, this.host);
    this.refreshHud();
    ctx.bus.emit('scene:loading', { scene: 'lab', progress: 1, label: 'Ready' });
  }

  // ------------------------------------------------------------------ host

  private host!: LabHost;

  private buildHost(): void {
    const ctx = this.ctx;
    const q = ctx.quality.settings;
    this.env = new EnvironmentRig(ctx.render, this.scene, { sceneSize: 600 });
    const p = ctx.params;
    const season = p.season ?? 'sharad';
    const base = makeEnvironment(p.hour ?? DEFAULT_HOUR, season, 'clear');
    this.envState = p.weather ? { ...base, weather: makeWeather(p.weather, season, base.weather.windDirection) } : base;
    this.env.setEnvironment(this.envState);
    this.ground = this.makeGround(q.anisotropy);
    this.scene.add(this.ground);
    this.controls = new OrbitControls(this.camera, ctx.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 4000;
    this.frame({ x: 0, y: 1, z: 0 }, 16, 35, 16);
    const self = this;
    this.host = {
      scene: this.scene,
      camera: this.camera,
      controls: this.controls,
      env: this.env,
      ground: this.ground,
      labId: this.labId ?? '',
      addTerrain: (opts?: LabTerrainOptions) => self.addTerrain(opts ?? {}),
      setEnvironment: (patch: EnvironmentOverride) => self.setEnvironment(patch),
      frame: (target: Vec3, distance: number, yawDeg?: number, pitchDeg?: number) => self.frame(target, distance, yawDeg, pitchDeg),
      own<T extends { dispose(): void }>(resource: T): T {
        self.owned.push(resource);
        return resource;
      },
      setInfo: (lines: readonly string[]) => {
        self.info = lines.slice();
        self.refreshHud();
      },
      progress: (fraction: number, label: string) => ctx.bus.emit('scene:loading', { scene: 'lab', progress: 0.35 + 0.6 * Math.max(0, Math.min(1, fraction)), label }),
    };
  }

  private makeGround(anisotropy: number): THREE.Mesh {
    const size = 800;
    const geo = new THREE.CircleGeometry(size / 2, 96);
    geo.rotateX(-Math.PI / 2);
    const detail = createDetailTexture(256, 21);
    const normal = createNoiseNormalMap(256, 23, 3.0, 8);
    for (const t of [detail, normal]) {
      t.repeat.set(size / 7, size / 7);
      t.anisotropy = anisotropy;
    }
    detail.colorSpace = THREE.NoColorSpace;
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(MATERIALS.roadDirt), roughness: 0.96, map: detail, normalMap: normal });
    mat.normalScale.set(0.6, 0.6);
    const ground = new THREE.Mesh(geo, mat);
    ground.name = 'lab_ground';
    ground.receiveShadow = true;
    ground.position.y = -0.01;
    this.owned.push(geo, mat, detail, normal);
    return ground;
  }

  private async addTerrain(opts: LabTerrainOptions): Promise<LabTerrain> {
    if (this.terrain) throw new Error('LabHost.addTerrain: one terrain window per lab');
    const q = this.ctx.quality.settings;
    const { terrain: region, sites } = resolveRegionTerrain();
    const home = sites.find((s) => s.id === 'rajapura') ?? sites[0];
    const spec = createLocalTerrainSpec(
      region,
      opts.centerX ?? home?.x ?? 0,
      opts.centerZ ?? home?.z ?? 0,
      opts.sizeMeters ?? BATTLE_MAP_SIZE,
      opts.resolution ?? (q.tier === 'low' ? 257 : BATTLE_MAP_RESOLUTION),
      opts.preset ?? 'plains',
    );
    await new Promise((r) => setTimeout(r, 0));
    const hf = getHeightfield(spec);
    const root = new THREE.Group();
    root.name = 'lab_terrain';
    this.terrain = new TerrainRenderer(hf, { quality: q, maxChunksPerSide: 4, detailTile: 8 });
    root.add(this.terrain.object);
    if (opts.water !== false) {
      this.water = new WaterRenderer(hf.bounds, spec.waterLevel, q);
      root.add(this.water.object);
    }
    if (this.envState) {
      this.terrain.setEnvironment(this.envState);
      this.water?.setEnvironment(this.envState);
    }
    this.scene.add(root);
    if (this.ground) this.ground.visible = false;
    return { heightfield: hf, object: root, heightAt: (x: number, z: number) => hf.heightAt(x, z) };
  }

  private frame(target: Vec3, distance: number, yawDeg = 35, pitchDeg = 18): void {
    const yaw = yawDeg * DEG;
    const pitch = pitchDeg * DEG;
    const d = Math.max(0.2, distance);
    this.camera.position.set(target.x + d * Math.cos(pitch) * Math.sin(yaw), target.y + d * Math.sin(pitch), target.z + d * Math.cos(pitch) * Math.cos(yaw));
    this.camera.near = Math.max(0.05, d * 0.004);
    this.camera.far = Math.max(2000, d * 60);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(target.x, target.y, target.z);
    if (this.controls) {
      this.controls.target.set(target.x, target.y, target.z);
      this.controls.update();
    }
  }

  setEnvironment(patch: EnvironmentOverride): void {
    if (!this.env || !this.envState) return;
    const season = patch.season ?? this.envState.season;
    const weather = patch.weather ? makeWeather(patch.weather, season, this.envState.weather.windDirection) : this.envState.weather;
    this.envState = { ...this.envState, hour: patch.hour ?? this.envState.hour, season, weather };
    this.env.setEnvironment(this.envState);
    this.terrain?.setEnvironment(this.envState);
    this.water?.setEnvironment(this.envState);
  }

  // ------------------------------------------------------------------ failure path

  /** Themed error panel (survives the scene switch) + fallback to the main menu on the first frame. */
  private fail(reason: string): void {
    this.failure = reason;
    const ctx = this.ctx;
    console.warn(`[lab] ${reason}`);
    const labs = listLabs();
    const close = (): void => panel.remove();
    const panel = document.createElement('div');
    panel.className = 'panel lab-error';
    panel.setAttribute('role', 'alert');
    panel.dataset.testid = 'lab-error';
    panel.style.cssText =
      'position:absolute;left:50%;top:max(24px,env(safe-area-inset-top));transform:translateX(-50%);width:min(520px,calc(100vw - 32px));' +
      'pointer-events:auto;font-family:var(--font-body);color:var(--ui-text);font-size:var(--fs-md);text-align:center;z-index:5;';
    const title = document.createElement('div');
    title.className = 'title-torana';
    title.style.cssText = 'font-size:var(--fs-xl);letter-spacing:0.06em;margin:0 0 4px;';
    title.textContent = 'Lab not found';
    const body = document.createElement('div');
    body.style.cssText = 'color:var(--ui-text-dim);margin:2px 0 10px;';
    body.textContent = `${reason} Returning to the main menu.`;
    const chips = document.createElement('div');
    chips.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin-bottom:12px;';
    for (const l of labs.length ? labs : ['(no labs in this build)']) {
      const c = document.createElement('span');
      c.className = 'chip';
      c.textContent = l;
      chips.appendChild(c);
    }
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:var(--fs-sm);color:var(--ui-text-faint);margin-bottom:12px;';
    hint.textContent = 'Available labs above. Add one as <id>.lab.ts exporting LAB (src/scenes/lab/types.ts).';
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.type = 'button';
    btn.textContent = 'Dismiss';
    btn.style.minHeight = 'var(--touch-min, 44px)';
    btn.addEventListener('click', close);
    panel.append(title, body, chips, hint, btn);
    ctx.overlayRoot.appendChild(panel);
    setTimeout(close, ERROR_PANEL_MS);
  }

  // ------------------------------------------------------------------ HUD

  private createHud(): void {
    const lab = this.lab;
    if (!lab) return;
    const el = document.createElement('div');
    el.className = 'panel lab-hud';
    el.style.cssText =
      'position:absolute;left:max(12px,var(--safe-left,0px));top:max(12px,var(--safe-top,0px));max-width:min(380px,calc(100vw - 24px));' +
      'padding:10px 14px;pointer-events:none;font-size:var(--fs-sm);line-height:1.4;';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:8px;';
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = 'LAB';
    const title = document.createElement('span');
    title.style.cssText = 'font-family:var(--font-display);font-size:var(--fs-lg);color:var(--c-gold);letter-spacing:0.04em;';
    title.textContent = lab.title;
    head.append(chip, title);
    el.appendChild(head);
    if (lab.description) {
      const d = document.createElement('div');
      d.style.cssText = 'color:var(--ui-text-dim);margin-top:2px;';
      d.textContent = lab.description;
      el.appendChild(d);
    }
    this.hudInfo = document.createElement('div');
    this.hudInfo.style.cssText = 'margin-top:6px;white-space:pre-wrap;';
    this.hudStats = document.createElement('div');
    this.hudStats.style.cssText = 'margin-top:6px;color:var(--ui-text-faint);font-variant-numeric:tabular-nums;';
    el.append(this.hudInfo, this.hudStats);
    this.ctx.uiRoot.appendChild(el);
    this.hud = el;
  }

  private refreshHud(): void {
    if (this.hudInfo) this.hudInfo.textContent = this.info.join('\n');
    if (this.hudStats) {
      const r = this.ctx.render.getStats();
      this.hudStats.textContent = `${this.labId} · ${this.ctx.quality.tier} · ${r.drawCalls} draws · ${(r.triangles / 1000).toFixed(1)}k tris`;
    }
  }

  // ------------------------------------------------------------------ loop

  fixedUpdate(_step: number): void {}

  update(dt: number, _alpha: number): void {
    const ctx = this.ctx;
    if (this.failure) {
      if (!this.fallbackRequested) {
        this.fallbackRequested = true;
        void ctx.scenes.go({ scene: 'menu' });
      }
      ctx.render.render(dt);
      return;
    }
    const input = ctx.input.frame();
    for (const a of input.actions) if (a.action === 'toggle_profiler') ctx.profiler.toggleOverlay();
    this.controls?.update(dt);
    if (this.env && this.controls) this.env.update(dt, this.tmpPos.copy(this.controls.target));
    this.water?.update(dt);
    this.terrain?.update(this.camera);
    this.instance?.update(dt);
    ctx.render.render(dt);
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.5;
      this.refreshHud();
    }
  }

  onResize(): void {
    this.camera.updateProjectionMatrix();
  }

  exit(): void {
    try {
      this.instance?.dispose();
    } finally {
      this.instance = null;
      for (const o of this.owned.splice(0)) o.dispose();
      this.terrain?.dispose();
      this.water?.dispose();
      this.env?.dispose();
      this.controls?.dispose();
      this.terrain = null;
      this.water = null;
      this.env = null;
      this.controls = null;
      this.hud?.remove();
      this.hud = null;
      this.scene.environment = null;
      this.scene.background = null;
      this.scene.clear();
    }
  }

  debugState(): unknown {
    return {
      scene: 'lab',
      lab: this.labId,
      title: this.lab?.title ?? null,
      path: this.labPath || null,
      failure: this.failure,
      hour: this.envState?.hour ?? null,
    };
  }

  stateHash(): string | null {
    return null;
  }

  debugCommand(name: string, args: readonly unknown[]): unknown {
    switch (name) {
      case 'noop':
        return { scene: 'lab', lab: this.labId, handledBy: 'scene', args: [...args] };
      case 'lab.list':
        return listLabs();
      case 'lab.info':
        return { id: this.labId, title: this.lab?.title ?? null, path: this.labPath || null, info: [...this.info], failure: this.failure };
      case 'lab.frame': {
        const [x, y, z, distance, yaw, pitch] = args.map((a) => (typeof a === 'number' ? a : undefined));
        this.frame({ x: x ?? 0, y: y ?? 1, z: z ?? 0 }, distance ?? 16, yaw, pitch);
        return true;
      }
      case 'lab.env': {
        const patch = (typeof args[0] === 'object' && args[0] !== null ? args[0] : {}) as EnvironmentOverride;
        this.setEnvironment(patch);
        return { hour: this.envState?.hour ?? null, season: this.envState?.season ?? null, weather: this.envState?.weather.kind ?? null };
      }
      default:
        return this.instance?.debugCommand ? this.instance.debugCommand(name, args) : DEBUG_UNHANDLED;
    }
  }
}
