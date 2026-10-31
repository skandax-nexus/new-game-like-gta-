/**
 * UI manager: layers, lazy screens (static + discovered *.screen.ts + themed placeholder), UI services, loading
 * screen hook, safe areas, UI scale, layout mode, accessibility datasets, HUD command channel, scene feeds,
 * tooltips and the UI + input CPU budget. OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 *
 * Scenes push state with `ui.show(id, props)` / `ui.update(id, props)`; updates are diffed by the screens and
 * throttled here (HUD screens <= 10 Hz, panels <= 5 Hz; the latest props always win). Between full renders,
 * `Screen.track(props)` moves screen-anchored elements on every push (scenes push anchors every frame). While a
 * pointer is pressed inside a panel or modal its re-renders wait for the release (a rebuild under a press would swallow the
 * click), and keyboard focus survives re-renders that rebuild DOM. Screens act through
 * `ctx.actions.*` (GameActions), input actions (`ctx.input.injectAction`), `ui:*` bus events or `ui.commands`
 * (HUD -> scene requests such as building placement, ui/services/hudCommands.ts).
 *
 * Layers inside #ui-root (bottom to top): fullscreen, anchors (screen-anchored floating cards / bars, not scaled
 * by --ui-scale), hud, panel, modal, toast, tooltip, loading. hud / panel / modal / toast / tooltip are zoomed by
 * the UI scale (80-150%).
 * <html> datasets (ART_BIBLE §17 item 4): data-colorblind, data-reduced-motion, data-relation (relation colouring),
 * data-layout = pc | phone | phone-landscape, data-touch.
 */
import './theme.css';
import './base.css';
import './components/hud.css';
import type { AppContext, ScreenId, ScreenPropsMap } from '../app/contracts';
import type { NotifySeverity, SfxKind } from '../core/events';
import type { GameSettings } from '../core/types';
import { h, setText, shield, uiClock } from './dom';
import { SCREEN_FACTORIES, UI_SERVICES } from './screens/index';
import { createHudCommandBus, HudFeeds, type HudCommandBus } from './services/hudCommands';
import { TooltipService } from './components/tooltip';

export type UILayer = 'hud' | 'panel' | 'modal' | 'fullscreen';

export interface Screen<K extends ScreenId = ScreenId> {
  readonly id: K;
  readonly layer: UILayer;
  readonly el: HTMLElement;
  update(props: ScreenPropsMap[K]): void;
  /**
   * Optional: position screen-anchored elements (floating formation cards, enemy bars, lock-on reticle, prompt
   * bubble) from a props push that the throttle defers. Called on every push between full renders, so anchors follow
   * the camera at frame rate when the scene pushes every frame; must only write transforms of existing nodes.
   */
  track?(props: ScreenPropsMap[K]): void;
  dispose?(): void;
}

export type ScreenFactory<K extends ScreenId> = (ctx: AppContext, ui: UIManager) => Screen<K>;

/** Custom loading screen (UI-01): created on the first setLoading, disposed by hideLoading. */
export interface LoadingView {
  update(label: string, progress: number): void;
  dispose(): void;
}
export type LoadingRenderer = (host: HTMLElement) => LoadingView;

export type LayoutMode = 'pc' | 'phone' | 'phone-landscape';

/** Layout rule: phones are small (short side <= 500 px, or <= 600 px with a coarse pointer). */
export function layoutFor(width: number, height: number, coarse: boolean): LayoutMode {
  const short = Math.min(width, height);
  const phone = short <= 500 || (coarse && short <= 600);
  if (!phone) return 'pc';
  return width > height ? 'phone-landscape' : 'phone';
}

const HUD_INTERVAL_MS = 100;
const PANEL_INTERVAL_MS = 200;
/** A press inside a screen defers its re-renders until release (at most this long, e.g. a lost pointerup). */
const PRESS_HOLD_MAX_MS = 4000;

/** Child-index path of `node` inside `root` (focus restore across a screen re-render). */
function nodePath(root: Element, node: Element): number[] | null {
  const path: number[] = [];
  let n: Element | null = node;
  while (n && n !== root) {
    const p: Element | null = n.parentElement;
    if (!p) return null;
    path.push(Array.prototype.indexOf.call(p.children, n) as number);
    n = p;
  }
  return n === root ? path.reverse() : null;
}

function nodeAt(root: Element, path: readonly number[]): HTMLElement | null {
  let n: Element | undefined = root;
  for (const i of path) {
    n = n?.children[i];
    if (!n) return null;
  }
  return n instanceof HTMLElement ? n : null;
}

export class UIManager {
  private readonly layers: Record<UILayer | 'anchors' | 'toast' | 'tooltip' | 'loading', HTMLElement>;
  private readonly screens = new Map<ScreenId, Screen>();
  private readonly lastProps = new Map<ScreenId, unknown>();
  private readonly pending = new Map<ScreenId, unknown>();
  private readonly lastUpdate = new Map<ScreenId, number>();
  private readonly timers = new Map<ScreenId, ReturnType<typeof setTimeout>>();
  private readonly patches = new Map<ScreenId, Record<string, unknown>>();
  /** Screens with a pointer pressed inside them (their re-renders wait for the release, so no click is lost). */
  private readonly pressed = new Map<ScreenId, number>();
  private ctx: AppContext | null = null;
  private loadingEl: HTMLElement | null = null;
  private loadingBar: HTMLElement | null = null;
  private loadingLabel: HTMLElement | null = null;
  private loadingView: LoadingView | null = null;
  private loadingRenderer: LoadingRenderer | null = null;
  private readonly serviceStops: (() => void)[] = [];
  private readonly offs: (() => void)[] = [];
  private readonly layoutListeners = new Set<(m: LayoutMode) => void>();
  private _layout: LayoutMode = 'pc';
  private _scale = 1;
  private uiMs = 0;
  private emaUi = 0;
  private emaInput = 0;
  private maxWin = 0;
  private maxShown = 0;
  private frames = 0;
  /** HUD -> scene requests (placement, targeting, minimap move). */
  readonly commands: HudCommandBus = createHudCommandBus();
  /** Scene -> HUD data outside ScreenPropsMap (camera frustum, world control groups). */
  readonly feeds = new HudFeeds();
  readonly tooltips: TooltipService;

  constructor(private readonly root: HTMLElement) {
    const mk = (name: string): HTMLElement => {
      const el = h('div', { class: `ui-layer ui-layer-${name}` });
      root.appendChild(el);
      return el;
    };
    this.layers = {
      fullscreen: mk('fullscreen'),
      anchors: mk('anchors'),
      hud: mk('hud'),
      panel: mk('panel'),
      modal: mk('modal'),
      toast: mk('toast'),
      tooltip: mk('tooltip'),
      loading: mk('loading'),
    };
    this.tooltips = new TooltipService(this.layers.tooltip);
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.onResize);
      window.addEventListener('orientationchange', this.onResize);
      // Capture phase: screens shield() their pointer events from window bubble listeners.
      window.addEventListener('pointerup', this.onRelease, true);
      window.addEventListener('pointercancel', this.onRelease, true);
      window.addEventListener('blur', this.onRelease);
      this.onResize();
    }
  }

  /**
   * Pointer released anywhere: screens pressed until now render their deferred props after the click that follows
   * this pointerup has been dispatched (a rebuild between pointerdown and click would swallow the click).
   */
  private readonly onRelease = (): void => {
    if (this.pressed.size === 0) return;
    const ids = [...this.pressed.keys()];
    this.pressed.clear();
    setTimeout(() => {
      for (const id of ids) this.flushPending(id);
    }, 0);
  };

  private isPressed(id: ScreenId): boolean {
    const t = this.pressed.get(id);
    if (t === undefined) return false;
    if (uiClock.now() - t <= PRESS_HOLD_MAX_MS) return true;
    this.pressed.delete(id);
    return false;
  }

  private flushPending(id: ScreenId): void {
    const p = this.pending.get(id);
    const s = this.screens.get(id);
    if (p === undefined || !s || this.timers.has(id) || this.isPressed(id)) return;
    this.pending.delete(id);
    if (s.el.classList.contains('ui-hidden')) return;
    const t0 = performance.now();
    this.render(id, s, p as never);
    this.uiMs += performance.now() - t0;
  }

  /** Late binding (the context is created after the UI): datasets, key preset override, services, profiler hook. */
  attach(ctx: AppContext): void {
    this.ctx = ctx;
    if (ctx.params.noUi) this.root.classList.add('ui-noui');
    ctx.input.setPresetOverride?.(ctx.params.keyPreset);
    this.applySettings(ctx.settings);
    this.offs.push(ctx.bus.on('settings:changed', ({ settings }) => this.applySettings(settings)));
    for (const s of UI_SERVICES) {
      try {
        this.serviceStops.push(s.start(ctx, this));
      } catch (err) {
        console.error(`[ui] service '${s.id}' failed to start`, err);
      }
    }
    // UI + input CPU budget (ARCHITECTURE §15: < 1 ms PC, < 2 ms mobile) as profiler counters, once per frame.
    const prev = ctx.scenes.onFrame;
    ctx.scenes.onFrame = (): void => {
      prev?.();
      this.frameTick();
    };
  }

  get context(): AppContext | null {
    return this.ctx;
  }

  /** Apply the accessibility / layout settings to <html> (colour-blind remaps, reduced motion, relation colours). */
  applySettings(s: GameSettings): void {
    if (typeof document === 'undefined') return;
    const d = document.documentElement.dataset;
    const p = this.ctx?.params;
    const cb = p?.colorblind ?? s.colorblind;
    if (cb && cb !== 'none') d.colorblind = cb;
    else delete d.colorblind;
    const rm = p?.reducedMotion ?? s.reducedMotion;
    if (rm) d.reducedMotion = '1';
    else delete d.reducedMotion;
    if (s.relationColoring) d.relation = '1';
    else delete d.relation;
    this.setScale(s.uiScale);
  }

  setScale(scale: number): void {
    const v = Math.max(0.8, Math.min(1.5, Number.isFinite(scale) ? scale : 1));
    this._scale = v;
    this.tooltips.scale = v;
    if (typeof document !== 'undefined') document.documentElement.style.setProperty('--ui-scale', String(v));
  }

  get scale(): number {
    return this._scale;
  }

  get layout(): LayoutMode {
    return this._layout;
  }

  /** Subscribe to layout mode changes (pc / phone / phone-landscape); returns the unsubscribe. */
  onLayout(fn: (m: LayoutMode) => void): () => void {
    this.layoutListeners.add(fn);
    return () => this.layoutListeners.delete(fn);
  }

  private readonly onResize = (): void => {
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const m = layoutFor(window.innerWidth, window.innerHeight, coarse);
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.layout = m;
      document.documentElement.dataset.touch = coarse ? '1' : '0';
    }
    if (m === this._layout) return;
    this._layout = m;
    for (const fn of this.layoutListeners) fn(m);
  };

  /** Floating, screen-anchored elements (formation cards, hero bars): not zoomed, positioned in CSS px. */
  get anchorsLayer(): HTMLElement {
    return this.layers.anchors;
  }

  // ------------------------------------------------------------------ screens

  show<K extends ScreenId>(id: K, props: ScreenPropsMap[K]): void {
    const t0 = performance.now();
    let s = this.screens.get(id) as Screen<K> | undefined;
    if (!s) {
      const factory = SCREEN_FACTORIES[id] as ScreenFactory<K> | undefined;
      if (!factory || !this.ctx) throw new Error(`No screen factory for ${id}`);
      s = factory(this.ctx, this);
      shield(s.el);
      // Panels and modals rebuild rows / buttons on update: hold them under a press. HUD screens keep their nodes
      // (keyed lists, reused slots) and host continuous controls (touch stick, hold buttons), so they never wait.
      if (s.layer !== 'hud') s.el.addEventListener('pointerdown', () => this.pressed.set(id, uiClock.now()));
      this.screens.set(id, s as unknown as Screen);
      this.layers[s.layer].appendChild(s.el);
    }
    this.clearPending(id);
    const wasHidden = s.el.classList.contains('ui-hidden');
    s.el.classList.remove('ui-hidden');
    this.render(id, s, props);
    if (wasHidden && s.layer === 'modal') this.ctx?.bus.emit('audio:sfx', { sfx: 'ui_open' });
    this.refreshModalBackdrop();
    this.uiMs += performance.now() - t0;
  }

  /** Update only if visible. Throttled per screen (latest props win). */
  update<K extends ScreenId>(id: K, props: ScreenPropsMap[K]): void {
    const s = this.screens.get(id) as Screen<K> | undefined;
    if (!s || s.el.classList.contains('ui-hidden')) return;
    const t0 = performance.now();
    const now = uiClock.now();
    const minMs = s.layer === 'hud' ? HUD_INTERVAL_MS : PANEL_INTERVAL_MS;
    const last = this.lastUpdate.get(id) ?? 0;
    const held = this.isPressed(id);
    if (held || now - last < minMs) {
      // Anchored elements follow every push (frame rate); the full render waits for the throttle / the release.
      if (s.track) {
        const patch = this.patches.get(id);
        s.track(patch ? ({ ...(props as object), ...patch } as ScreenPropsMap[K]) : props);
      }
      this.pending.set(id, props);
      if (!held && !this.timers.has(id)) {
        this.timers.set(
          id,
          setTimeout(() => {
            this.timers.delete(id);
            this.flushPending(id);
          }, minMs - (now - last)),
        );
      }
      this.uiMs += performance.now() - t0;
      return;
    }
    this.render(id, s, props);
    this.uiMs += performance.now() - t0;
  }

  private render<K extends ScreenId>(id: K, s: Screen<K>, props: ScreenPropsMap[K]): void {
    this.lastUpdate.set(id, uiClock.now());
    this.lastProps.set(id, props);
    const patch = this.patches.get(id);
    // Screens that rebuild parts of their DOM would drop keyboard focus: restore it on the node at the same place.
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    const path = active && active !== s.el && s.el.contains(active) ? nodePath(s.el, active) : null;
    s.update(patch ? ({ ...(props as object), ...patch } as ScreenPropsMap[K]) : props);
    if (path && !(document.activeElement && s.el.contains(document.activeElement))) nodeAt(s.el, path)?.focus({ preventScroll: true });
  }

  private clearPending(id: ScreenId): void {
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
    this.pending.delete(id);
  }

  /** Re-render a visible screen with its last props (local state changed, e.g. a tab). */
  refresh(id: ScreenId): void {
    const s = this.screens.get(id);
    const p = this.lastProps.get(id);
    if (s && p !== undefined && !s.el.classList.contains('ui-hidden')) this.render(id, s, p as never);
  }

  /** A modal (event, engagement, market...) is open: transient toasts wait in the feed instead of covering it. */
  get modalOpen(): boolean {
    return this.layers.modal.classList.contains('has-modal');
  }

  isVisible(id: ScreenId): boolean {
    const s = this.screens.get(id);
    return !!s && !s.el.classList.contains('ui-hidden');
  }

  /** Props last pushed to a screen (debug / QA). */
  propsOf<K extends ScreenId>(id: K): ScreenPropsMap[K] | undefined {
    return this.lastProps.get(id) as ScreenPropsMap[K] | undefined;
  }

  hide(id: ScreenId): void {
    const s = this.screens.get(id);
    this.clearPending(id);
    if (s && !s.el.classList.contains('ui-hidden')) {
      s.el.classList.add('ui-hidden');
      if (s.layer === 'modal' || s.layer === 'panel') this.ctx?.bus.emit('audio:sfx', { sfx: 'ui_close' });
    }
    this.refreshModalBackdrop();
  }

  /** Destroy a screen (frees DOM). */
  destroy(id: ScreenId): void {
    const s = this.screens.get(id);
    this.clearPending(id);
    this.pressed.delete(id);
    if (!s) return;
    s.dispose?.();
    s.el.remove();
    this.screens.delete(id);
    this.lastProps.delete(id);
    this.refreshModalBackdrop();
  }

  /** Destroy every screen (scene changes) and reset scene feeds. */
  hideAll(): void {
    for (const id of [...this.screens.keys()]) this.destroy(id);
    this.layers.anchors.textContent = '';
    this.tooltips.hide();
    this.feeds.reset();
  }

  private refreshModalBackdrop(): void {
    const modal = this.layers.modal;
    let any = false;
    for (const c of modal.children) if (!(c as HTMLElement).classList.contains('ui-hidden')) any = true;
    const opened = any && !modal.classList.contains('has-modal');
    modal.classList.toggle('has-modal', any);
    // A modal just opened (throttled pushes can land after a same-tick toast): drop the transient toasts - their text
    // is already in the notification feed - so none sits on the modal (Art Director round 1, overlay leaks).
    if (opened) for (const t of [...this.layers.toast.querySelectorAll('.toast[data-transient]')]) t.remove();
  }

  /**
   * QA / evidence: merge a sticky patch into every props push of a screen (e.g. battle_hud anchors or deployment
   * before GP-04 pushes them); null removes it. Re-renders immediately when visible.
   */
  debugPatch(id: ScreenId, patch: Record<string, unknown> | null): void {
    if (patch) this.patches.set(id, patch);
    else this.patches.delete(id);
    this.refresh(id);
  }

  // ------------------------------------------------------------------ toasts, loading

  /**
   * Show a toast. `transient`: it repeats a notification-feed entry, so it is dropped when a modal opens (explicit
   * feedback such as 'Chronicle saved' is not transient and stays above the modal).
   */
  toast(text: string, severity: NotifySeverity = 'info', ms = 3200, transient = false): void {
    const el = h('div', { class: `toast ${severity}`, role: 'status' }, text);
    if (transient) el.dataset.transient = '1';
    this.layers.toast.appendChild(el);
    while (this.layers.toast.children.length > 4) this.layers.toast.firstChild?.remove();
    setTimeout(() => el.remove(), ms);
  }

  /** UI-01 hook: replace the built-in loading overlay. null restores the default. */
  setLoadingRenderer(fn: LoadingRenderer | null): void {
    this.loadingRenderer = fn;
  }

  setLoading(label: string, progress: number): void {
    const p = Math.max(0, Math.min(1, progress));
    if (this.loadingRenderer) {
      if (!this.loadingView) {
        this.layers.loading.classList.add('active');
        this.loadingView = this.loadingRenderer(this.layers.loading);
      }
      this.loadingView.update(label, p);
      return;
    }
    if (!this.loadingEl) {
      this.loadingBar = h('i', { style: { width: '0%' } });
      this.loadingLabel = h('div', { class: 'label' });
      this.loadingEl = h('div', { class: 'loading' }, h('div', { class: 'loading-torana' }), h('div', { class: 'loading-title' }, 'SAMRAJYA'), this.loadingLabel, h('div', { class: 'bar' }, this.loadingBar));
      this.layers.loading.appendChild(this.loadingEl);
    }
    setText(this.loadingLabel!, label);
    this.loadingBar!.style.width = `${Math.round(p * 100)}%`;
  }

  hideLoading(): void {
    this.loadingEl?.remove();
    this.loadingEl = null;
    if (this.loadingView) {
      this.loadingView.dispose();
      this.loadingView = null;
      this.layers.loading.textContent = '';
      this.layers.loading.classList.remove('active');
    }
  }

  // ------------------------------------------------------------------ helpers, budget

  sfx(kind: SfxKind): void {
    this.ctx?.bus.emit('audio:sfx', { sfx: kind });
  }

  /** Run UI work and count its CPU time against the UI budget. */
  measure<T>(fn: () => T): T {
    const t0 = performance.now();
    try {
      return fn();
    } finally {
      this.uiMs += performance.now() - t0;
    }
  }

  addCpu(ms: number): void {
    this.uiMs += ms;
  }

  /** UI CPU ms accumulated since the last frame tick (QA bench); resets the accumulator. */
  consumeUiMs(): number {
    const v = this.uiMs;
    this.uiMs = 0;
    return v;
  }

  private frameTick(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const inputMs = ctx.input.consumeCpuMs?.() ?? 0;
    const ui = this.uiMs;
    this.uiMs = 0;
    this.emaUi = this.emaUi * 0.92 + ui * 0.08;
    this.emaInput = this.emaInput * 0.92 + inputMs * 0.08;
    this.maxWin = Math.max(this.maxWin, ui + inputMs);
    if (++this.frames >= 120) {
      this.frames = 0;
      this.maxShown = this.maxWin;
      this.maxWin = 0;
    }
    const p = ctx.profiler;
    p.setCounter('ui.ms', Math.round(this.emaUi * 1000) / 1000);
    p.setCounter('input.ms', Math.round(this.emaInput * 1000) / 1000);
    p.setCounter('uiInput.ms', Math.round((this.emaUi + this.emaInput) * 1000) / 1000);
    p.setCounter('uiInput.maxMs', Math.round(Math.max(this.maxShown, this.maxWin) * 1000) / 1000);
  }

  dispose(): void {
    for (const stop of this.serviceStops.splice(0)) stop();
    for (const off of this.offs.splice(0)) off();
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.onResize);
      window.removeEventListener('orientationchange', this.onResize);
      window.removeEventListener('pointerup', this.onRelease, true);
      window.removeEventListener('pointercancel', this.onRelease, true);
      window.removeEventListener('blur', this.onRelease);
    }
    this.hideAll();
    this.root.innerHTML = '';
  }
}
