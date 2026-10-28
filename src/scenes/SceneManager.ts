/**
 * Scene lifecycle + loop target. Owned by the CTO.
 *
 *   go(params): serialize transitions -> show loading -> exit old scene (dispose) -> enter new scene
 *   (async, progress via 'scene:loading') -> bind loop fixed step -> after READY_FRAMES rendered frames
 *   set `sceneReady`, emit 'scene:ready', hide loading.
 * Errors during enter/update are reported to the crash reporter; a failed scene falls back to the menu.
 */
import type { SceneId } from '../core/types';
import type { LoopTarget } from '../core/loop';
import type { AppContext, GameScene, SceneFactory, SceneParams } from '../app/contracts';

const READY_FRAMES = 3;

export class SceneManager implements LoopTarget {
  private readonly factories: Partial<Record<SceneId, SceneFactory>> = {};
  private _current: GameScene | null = null;
  private loading = false;
  private chain: Promise<void> = Promise.resolve();
  private framesSinceEnter = 0;
  private _ready = false;
  private ctx: AppContext | null = null;
  /** Called every rendered frame after the scene update (debug API / smoke hooks). */
  onFrame: (() => void) | null = null;

  attach(ctx: AppContext): void {
    this.ctx = ctx;
    ctx.bus.on('scene:loading', (e) => ctx.ui.setLoading(e.label, e.progress));
  }

  register(id: SceneId, factory: SceneFactory): void {
    this.factories[id] = factory;
  }

  get current(): GameScene | null {
    return this._current;
  }

  get currentId(): SceneId | null {
    return this._current?.id ?? null;
  }

  /** True once the current scene has loaded and rendered READY_FRAMES frames. */
  get sceneReady(): boolean {
    return this._ready;
  }

  get isLoading(): boolean {
    return this.loading;
  }

  /** Switch scenes (transitions are queued, never concurrent). */
  go(params: SceneParams): Promise<void> {
    this.chain = this.chain.then(() => this.doGo(params)).catch(() => undefined);
    return this.chain;
  }

  private async doGo(params: SceneParams): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) throw new Error('SceneManager not attached');
    const factory = this.factories[params.scene];
    if (!factory) throw new Error(`No scene registered for ${params.scene}`);
    this.loading = true;
    this._ready = false;
    ctx.ui.setLoading('Preparing', 0);
    // Give the browser a frame to paint the loading screen.
    await new Promise((r) => setTimeout(r, 16));
    const old = this._current;
    if (old) {
      try {
        old.exit();
      } catch (err) {
        ctx.crash.report(err, 'manual', `scene.exit:${old.id}`);
      }
      ctx.bus.emit('scene:exited', { scene: old.id });
    }
    this._current = null;
    ctx.ui.hideAll();
    ctx.loop.setTarget(this);
    const scene = factory(ctx);
    try {
      ctx.input.setContext(params.scene);
      await scene.enter(params);
      this._current = scene;
      ctx.loop.setTarget(this, scene.fixedStep);
      this.framesSinceEnter = 0;
      ctx.bus.emit('scene:entered', { scene: scene.id });
    } catch (err) {
      ctx.crash.report(err, 'manual', `scene.enter:${params.scene}`);
      try {
        scene.exit();
      } catch {
        // ignore
      }
      this.loading = false;
      ctx.ui.hideLoading();
      if (params.scene !== 'menu') await this.doGo({ scene: 'menu' });
      return;
    }
    this.loading = false;
  }

  // ------------------------------------------------------------------ LoopTarget

  fixedUpdate(step: number): void {
    const s = this._current;
    if (!s || this.loading || !this.ctx) return;
    const p = this.ctx.profiler;
    p.begin('sim');
    s.fixedUpdate(step);
    p.end('sim');
  }

  update(dt: number, alpha: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.profiler.beginFrame();
    const s = this._current;
    if (s && !this.loading) {
      ctx.profiler.begin('frame');
      s.update(dt, alpha);
      ctx.profiler.end('frame');
      this.framesSinceEnter++;
      if (!this._ready && this.framesSinceEnter >= READY_FRAMES) {
        this._ready = true;
        ctx.ui.hideLoading();
        ctx.bus.emit('scene:ready', { scene: s.id });
      }
      ctx.render.updateDynamicResolution(ctx.profiler.averageFrameMs(), performance.now());
    }
    this.onFrame?.();
    ctx.profiler.endFrame();
  }
}
