/**
 * UI manager: screen registry, layers (hud / panel / modal / toast / loading), show/update/hide.
 * OWNER: Lead UI/UX Engineer. Baseline by the CTO.
 *
 * Scenes push state with `ui.show(id, props)` / `ui.update(id, props)` (throttle to ~4-10 Hz);
 * screens call `ctx.actions.*` (GameActions) for anything that changes the game, and emit `ui:*` bus
 * events for view-only requests (selection, camera focus, overlays).
 */
import './theme.css';
import './base.css';
import type { AppContext, ScreenId, ScreenPropsMap } from '../app/contracts';
import type { NotifySeverity } from '../core/events';
import { h, shield } from './dom';
import { SCREEN_FACTORIES } from './screens/index';

export type UILayer = 'hud' | 'panel' | 'modal' | 'fullscreen';

export interface Screen<K extends ScreenId = ScreenId> {
  readonly id: K;
  readonly layer: UILayer;
  readonly el: HTMLElement;
  update(props: ScreenPropsMap[K]): void;
  dispose?(): void;
}

export type ScreenFactory<K extends ScreenId> = (ctx: AppContext, ui: UIManager) => Screen<K>;

export class UIManager {
  private readonly layers: Record<UILayer | 'toast' | 'loading', HTMLElement>;
  private readonly screens = new Map<ScreenId, Screen>();
  private ctx: AppContext | null = null;
  private loadingEl: HTMLElement | null = null;
  private loadingBar: HTMLElement | null = null;
  private loadingLabel: HTMLElement | null = null;

  constructor(private readonly root: HTMLElement) {
    const mk = (name: string): HTMLElement => {
      const el = h('div', { class: `ui-layer ui-layer-${name}` });
      root.appendChild(el);
      return el;
    };
    this.layers = { fullscreen: mk('fullscreen'), hud: mk('hud'), panel: mk('panel'), modal: mk('modal'), toast: mk('toast'), loading: mk('loading') };
  }

  /** Late binding (the context is created after the UI). */
  attach(ctx: AppContext): void {
    this.ctx = ctx;
    if (ctx.params.noUi) this.root.classList.add('ui-noui');
  }

  setScale(scale: number): void {
    document.documentElement.style.setProperty('--ui-scale', String(scale));
  }

  show<K extends ScreenId>(id: K, props: ScreenPropsMap[K]): void {
    let s = this.screens.get(id) as Screen<K> | undefined;
    if (!s) {
      const factory = SCREEN_FACTORIES[id] as ScreenFactory<K> | undefined;
      if (!factory || !this.ctx) throw new Error(`No screen factory for ${id}`);
      s = factory(this.ctx, this);
      shield(s.el);
      this.screens.set(id, s as unknown as Screen);
      this.layers[s.layer].appendChild(s.el);
    }
    s.el.classList.remove('ui-hidden');
    s.update(props);
    this.refreshModalBackdrop();
  }

  /** Update only if visible. */
  update<K extends ScreenId>(id: K, props: ScreenPropsMap[K]): void {
    const s = this.screens.get(id) as Screen<K> | undefined;
    if (s && !s.el.classList.contains('ui-hidden')) s.update(props);
  }

  isVisible(id: ScreenId): boolean {
    const s = this.screens.get(id);
    return !!s && !s.el.classList.contains('ui-hidden');
  }

  hide(id: ScreenId): void {
    const s = this.screens.get(id);
    if (s) s.el.classList.add('ui-hidden');
    this.refreshModalBackdrop();
  }

  /** Destroy a screen (frees DOM). */
  destroy(id: ScreenId): void {
    const s = this.screens.get(id);
    if (!s) return;
    s.dispose?.();
    s.el.remove();
    this.screens.delete(id);
    this.refreshModalBackdrop();
  }

  /** Destroy every screen (scene changes). */
  hideAll(): void {
    for (const id of [...this.screens.keys()]) this.destroy(id);
  }

  private refreshModalBackdrop(): void {
    const modal = this.layers.modal;
    const anyVisible = [...modal.children].some((c) => !(c as HTMLElement).classList.contains('ui-hidden'));
    modal.classList.toggle('has-modal', anyVisible);
  }

  toast(text: string, severity: NotifySeverity = 'info', ms = 3200): void {
    const el = h('div', { class: `toast ${severity}` }, text);
    this.layers.toast.appendChild(el);
    while (this.layers.toast.children.length > 4) this.layers.toast.firstChild?.remove();
    setTimeout(() => el.remove(), ms);
  }

  setLoading(label: string, progress: number): void {
    if (!this.loadingEl) {
      this.loadingBar = h('i', { style: { width: '0%' } });
      this.loadingLabel = h('div', { class: 'label' });
      this.loadingEl = h('div', { class: 'loading' }, h('div', { class: 'panel-title', style: { fontSize: 'var(--fs-xl)', letterSpacing: '0.3em' } }, 'SAMRAJYA'), this.loadingLabel, h('div', { class: 'bar' }, this.loadingBar));
      this.layers.loading.appendChild(this.loadingEl);
    }
    this.loadingLabel!.textContent = label;
    this.loadingBar!.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
  }

  hideLoading(): void {
    this.loadingEl?.remove();
    this.loadingEl = null;
  }

  dispose(): void {
    this.hideAll();
    this.root.innerHTML = '';
  }
}
