/**
 * window.__SAMRAJYA__ implementation (QA / automation / smoke tests). Owned by the CTO.
 * Contract: src/core/debug.ts (SamrajyaDebugApi).
 */
import type { GameMode, SceneId } from '../core/types';
import type { SamrajyaDebugApi } from '../core/debug';
import { BUILD_VERSION } from '../core/constants';
import { DEFAULT_SCENARIO_ID, defaultSandbox } from '../data/campaign';
import type { AppContext } from './contracts';
import type { GameSession } from './session';
import { skirmishFromParams } from './session';

export function createDebugApi(ctx: AppContext, session: GameSession): SamrajyaDebugApi {
  const frameWaiters: { remaining: number; resolve: () => void }[] = [];
  const prevOnFrame = ctx.scenes.onFrame;
  ctx.scenes.onFrame = (): void => {
    prevOnFrame?.();
    api.scene = ctx.scenes.currentId;
    api.sceneReady = ctx.scenes.sceneReady;
    for (let i = frameWaiters.length - 1; i >= 0; i--) {
      const w = frameWaiters[i]!;
      if (--w.remaining <= 0) {
        frameWaiters.splice(i, 1);
        w.resolve();
      }
    }
  };
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

  const api: SamrajyaDebugApi = {
    version: BUILD_VERSION,
    ready: false,
    sceneReady: false,
    scene: null,
    params: ctx.params,
    getState() {
      return {
        scene: ctx.scenes.currentId,
        mode: session.mode,
        paused: ctx.loop.paused,
        timeScale: ctx.loop.timeScale,
        quality: ctx.quality.tier,
        sceneState: ctx.scenes.current?.debugState() ?? null,
        fps: ctx.profiler.snapshot().fps,
        errors: ctx.crash.getReports().length,
      };
    },
    async goto(scene: SceneId, params: Record<string, unknown> = {}) {
      api.sceneReady = false;
      switch (scene) {
        case 'world':
          if (session.world) await session.returnToWorld();
          else await session.startCampaign(str(params.scenario) ?? DEFAULT_SCENARIO_ID, 'normal');
          break;
        case 'battle':
          await session.startSkirmish(skirmishFromParams(ctx.params, { seed: num(params.seed) ?? ctx.params.seed ?? 1234, totalSoldiers: num(params.soldiers) ?? ctx.params.soldiers ?? 1000 }));
          break;
        case 'hero':
          await session.visitSettlement(str(params.settlement) ?? null);
          break;
        default:
          await session.quitToMenu();
      }
    },
    async startMode(mode: GameMode, opts: Record<string, unknown> = {}) {
      api.sceneReady = false;
      const seed = num(opts.seed) ?? ctx.params.seed ?? 1234;
      if (mode === 'campaign') await session.startCampaign(str(opts.scenario) ?? DEFAULT_SCENARIO_ID, 'normal');
      else if (mode === 'sandbox') await session.startSandbox({ ...defaultSandbox(seed), playerFactionId: str(opts.faction) ?? 'heartland' });
      else
        await session.startSkirmish(
          skirmishFromParams(ctx.params, {
            seed,
            totalSoldiers: num(opts.soldiers) ?? ctx.params.soldiers ?? 1000,
            ...(str(opts.preset) ? { preset: str(opts.preset) as never } : {}),
            ...(str(opts.faction) ? { playerFactionId: str(opts.faction)! } : {}),
            ...(str(opts.enemy) ? { enemyFactionId: str(opts.enemy)! } : {}),
          }),
        );
    },
    setTimeScale: (s) => ctx.loop.setTimeScale(s),
    pause: () => ctx.loop.pause(),
    resume: () => ctx.loop.resume(),
    step: (n = 1) => ctx.loop.stepNow(n),
    setQuality: (tier) => session.setQuality(tier),
    setEnvironment: (patch) => ctx.scenes.current?.setEnvironment?.(patch),
    issueBattleCommand: (cmd) => session.issueBattle(cmd),
    issueStrategicCommand: (cmd) => session.issueStrategic(cmd),
    getProfile: () => ctx.profiler.snapshot(),
    getErrors: () => ctx.crash.getReports(),
    clearErrors: () => ctx.crash.clear(),
    waitForSceneReady(timeoutMs = 60000) {
      return new Promise<boolean>((resolve) => {
        const t0 = performance.now();
        const poll = (): void => {
          if (ctx.scenes.sceneReady) resolve(true);
          else if (performance.now() - t0 > timeoutMs) resolve(false);
          else setTimeout(poll, 50);
        };
        poll();
      });
    },
    waitFrames(n: number) {
      return new Promise<void>((resolve) => frameWaiters.push({ remaining: Math.max(1, n), resolve }));
    },
    freeze(frozen: boolean) {
      if (frozen) ctx.loop.stop();
      else ctx.loop.start();
    },
    screenshot: () => ctx.render.capture(),
    save(slot = 'quick') {
      session.saveGame(slot);
      return slot;
    },
    load: (slot = 'quick') => session.loadGame(slot),
    hash: () => ctx.scenes.current?.stateHash() ?? null,
    toggleProfiler: () => ctx.profiler.toggleOverlay(),
  };
  return api;
}
