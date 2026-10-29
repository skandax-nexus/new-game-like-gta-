/**
 * Application entry: crash reporter, quality detection, renderer, UI, input, audio, scenes, session,
 * debug API, URL deep links. Owned by the CTO.
 */
import { installConsoleCapture } from './core/log';
import { CrashReporter } from './core/crash';
import { currentUrlParams } from './core/params';
import { loadSettings } from './core/settings';
import { detectQuality, QualityManager } from './core/quality';
import { createGameBus } from './core/events';
import { Profiler } from './core/profiler';
import { GameLoop } from './core/loop';
import { createDefaultSaveStore, SaveManager } from './core/save';
import { installDebugApi } from './core/debug';
import { BUILD_VERSION } from './core/constants';
import { RenderContext } from './render/renderer';
import { UIManager } from './ui/ui';
import { InputManager } from './input/input';
import { AudioManager } from './audio/audio';
import { SceneManager } from './scenes/SceneManager';
import { MenuScene } from './scenes/MenuScene';
import { WorldScene } from './scenes/WorldScene';
import { BattleScene } from './scenes/BattleScene';
import { HeroScene } from './scenes/HeroScene';
import { AssetViewerScene } from './scenes/AssetViewerScene';
import { AssetManager, assetTierForQuality } from './assets/AssetManager';
import { registerDefaultFallbacks } from './assets/fallbacks';
import { GameSession, skirmishFromParams } from './app/session';
import { createDebugApi } from './app/debugApi';
import type { AppContext } from './app/contracts';
import { DEFAULT_SCENARIO_ID, defaultSandbox } from './data/campaign';

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing #${id}`);
  return e as T;
}

function hideSplash(): void {
  const s = document.getElementById('boot-splash');
  if (!s) return;
  s.classList.add('hidden');
  setTimeout(() => s.remove(), 700);
}

function webgl2Available(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  installConsoleCapture();
  const overlayRoot = el<HTMLElement>('overlay-root');
  const crash = new CrashReporter({ overlayParent: overlayRoot });
  crash.install();
  const params = currentUrlParams();
  if (!webgl2Available()) {
    hideSplash();
    crash.report(new Error('WebGL2 is not available in this browser. Please use a recent Chrome, Edge, Firefox or Safari.'), 'manual', 'boot');
    return;
  }
  const settings = loadSettings();
  const detection = detectQuality(params.quality, settings.quality);
  const quality = new QualityManager(detection, settings.qualityOverrides);
  const bus = createGameBus();
  bus.onHandlerError = (err, type) => crash.report(err, 'manual', `bus:${type}`);
  const profiler = new Profiler();
  profiler.attachOverlay(overlayRoot);
  if (params.profiler) profiler.setOverlayVisible(true);
  const loop = new GameLoop({ fixedStep: 1 / 30 });
  loop.onError = (err) => crash.report(err, 'manual', 'loop');
  loop.onSpeedChange = (timeScale, paused) => bus.emit('loop:speed', { timeScale, paused });
  const canvas = el<HTMLCanvasElement>('game');
  const render = new RenderContext(canvas, quality.settings, profiler);
  render.onContextLost = () => crash.report(new Error('The graphics context was lost (GPU reset or memory pressure).'), 'webglcontextlost');
  const assets = new AssetManager({
    renderer: render.renderer,
    tier: params.assetTier ?? assetTierForQuality(quality.tier),
    anisotropy: quality.settings.anisotropy,
  });
  registerDefaultFallbacks(assets);
  quality.onChange((q) => {
    render.setQuality(q);
    if (!params.assetTier) assets.setTier(assetTierForQuality(q.tier), q.anisotropy);
  });
  const ui = new UIManager(el<HTMLElement>('ui-root'));
  ui.setScale(settings.uiScale);
  const input = new InputManager(canvas, bus, settings);
  const audio = new AudioManager(bus, settings, params.noAudio);
  const saves = new SaveManager(createDefaultSaveStore());
  const scenes = new SceneManager();
  const session = new GameSession();
  const ctx: AppContext = {
    canvas,
    uiRoot: el<HTMLElement>('ui-root'),
    overlayRoot,
    params,
    bus,
    loop,
    quality,
    profiler,
    crash,
    saves,
    settings,
    render,
    input,
    audio,
    ui,
    scenes,
    assets,
    actions: session,
    session,
  };
  ui.attach(ctx);
  scenes.attach(ctx);
  session.attach(ctx);
  scenes.register('menu', (c) => new MenuScene(c));
  scenes.register('world', (c) => new WorldScene(c));
  scenes.register('battle', (c) => new BattleScene(c));
  scenes.register('hero', (c) => new HeroScene(c));
  scenes.register('assetviewer', (c) => new AssetViewerScene(c));
  assets.onProgress((p) => bus.emit('assets:progress', p));
  crash.setContextProvider(() => ({
    scene: scenes.currentId,
    mode: session.mode,
    quality: quality.tier,
    gpu: detection.gpuRenderer,
    mobile: detection.isMobile,
    build: BUILD_VERSION,
    sceneState: scenes.current?.debugState() ?? null,
  }));
  crash.setReturnToMenu(() => void session.quitToMenu());
  bus.on('ui:notify', (n) => ui.toast(n.text, n.severity));
  const api = createDebugApi(ctx, session);
  installDebugApi(api);
  loop.setTarget(scenes);
  loop.start();

  // Deep links.
  if (params.speed) loop.setTimeScale(params.speed);
  switch (params.scene) {
    case 'world':
      if (params.mode === 'sandbox') await session.startSandbox({ ...defaultSandbox(params.seed ?? 1234), playerFactionId: params.faction ?? 'heartland' });
      else await session.startCampaign(params.scenario ?? DEFAULT_SCENARIO_ID, 'normal');
      break;
    case 'battle':
      await session.startSkirmish(skirmishFromParams(params));
      break;
    case 'hero':
      await session.visitSettlement(params.settlement);
      break;
    case 'assetviewer':
      await scenes.go({ scene: 'assetviewer', assetId: params.asset });
      break;
    default:
      await scenes.go({ scene: 'menu' });
  }
  if (params.paused) loop.pause();
  hideSplash();
  api.ready = true;
  bus.emit('app:ready', { version: BUILD_VERSION });
}

void boot().catch((err: unknown) => {
  hideSplash();
  console.error(err);
  // The crash reporter may not exist yet if boot failed very early.
  const c = new CrashReporter({ overlayParent: document.body });
  c.report(err, 'manual', 'boot');
});
