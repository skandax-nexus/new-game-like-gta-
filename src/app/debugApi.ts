/**
 * window.__SAMRAJYA__ implementation (QA / automation / smoke tests). OWNER: CTO (call / showScreen / labs by
 * CORE-01). Contract: src/core/debug.ts (SamrajyaDebugApi).
 */
import type { GameMode, SceneId } from '../core/types';
import type { SamrajyaDebugApi } from '../core/debug';
import { BUILD_VERSION } from '../core/constants';
import { DEFAULT_SCENARIO_ID, defaultSandbox } from '../data/campaign';
import type { AppContext } from './contracts';
import { DEBUG_UNHANDLED, isScreenId, SCREEN_IDS } from './contracts';
import type { GameSession } from './session';
import { skirmishFromParams } from './session';
import { SCREEN_REGISTRY } from '../ui/screens/index';
import { listLabs } from '../scenes/lab/registry';

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
  /** Built-in commands answered by the API when the active scene does not (GameScene.debugCommand contract). */
  const builtins: Record<string, (args: readonly unknown[]) => unknown> = {
    noop: (args) => ({ scene: ctx.scenes.currentId, handledBy: 'api', args: [...args] }),
    'scene.info': () => api.getState(),
    'ui.screens': () => api.screens(),
    labs: () => api.labs(),
  };

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
        case 'assetviewer':
          await ctx.scenes.go({ scene: 'assetviewer', assetId: str(params.asset) ?? ctx.params.asset });
          break;
        case 'lab':
          await ctx.scenes.go({ scene: 'lab', labId: str(params.lab) ?? ctx.params.lab });
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
    async call(name: string, ...args: unknown[]) {
      const scene = ctx.scenes.current;
      if (scene?.debugCommand) {
        const result: unknown = await scene.debugCommand(name, args);
        if (result !== DEBUG_UNHANDLED) return result;
      }
      const builtin = builtins[name];
      if (builtin) return builtin(args);
      throw new Error(`Unknown debug command '${name}' for scene '${ctx.scenes.currentId ?? 'none'}'`);
    },
    showScreen(id: string, props: Record<string, unknown> = {}) {
      if (!isScreenId(id)) throw new Error(`Unknown screen id '${id}' (see SCREEN_IDS in src/app/contracts.ts)`);
      const live: Record<string, unknown> = {
        $world: session.world,
        $faction: session.world?.playerFactionId ?? session.skirmish?.playerFactionId ?? null,
      };
      const resolved = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, typeof v === 'string' && v in live ? live[v] : v]));
      ctx.ui.show(id, resolved as never);
    },
    hideScreen(id: string) {
      if (isScreenId(id)) ctx.ui.hide(id);
    },
    screens: () => SCREEN_IDS.map((id) => ({ id, source: SCREEN_REGISTRY.source[id] })),
    labs: () => listLabs(),
  };
  return api;
}
