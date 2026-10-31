/**
 * UIManager update flow on the DOM shim (./domShim.ts): throttled pushes keep the latest props and render them after
 * the interval; between renders Screen.track() receives every push (screen-anchored elements follow the camera); a
 * pointer pressed inside a screen holds its re-renders until the release, and the deferred render runs only after
 * the click that follows the pointerup (a rebuild between pointerdown and click would swallow the click).
 * OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02). Added by the Lead UI/UX review.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { installDom, ShimElement, ShimEvent } from './domShim';

let dom: ReturnType<typeof installDom>;
beforeAll(() => {
  dom = installDom();
});
afterAll(() => dom.uninstall());
afterEach(() => {
  vi.useRealTimers();
});

interface Probe {
  updates: unknown[];
  tracks: unknown[];
  el: ShimElement;
}

async function setup(layer: 'modal' | 'hud' = 'modal'): Promise<{ ui: import('../../../src/ui/ui').UIManager; probe: Probe; clock: { t: number }; restore: () => void }> {
  const { UIManager } = await import('../../../src/ui/ui');
  const { SCREEN_FACTORIES } = await import('../../../src/ui/screens/index');
  const { uiClock } = await import('../../../src/ui/dom');
  const factories = SCREEN_FACTORIES as unknown as Record<string, unknown>;
  const saved = factories.council;
  const probe: Probe = { updates: [], tracks: [], el: new ShimElement('div') };
  factories.council = () => ({ id: 'council', layer, el: probe.el, update: (p: unknown) => probe.updates.push(p), track: (p: unknown) => probe.tracks.push(p) });
  const clock = { t: 1000 };
  const realNow = uiClock.now;
  uiClock.now = () => clock.t;
  const root = new ShimElement('div');
  dom.document.body.appendChild(root);
  const ui = new UIManager(root as unknown as HTMLElement);
  (ui as unknown as { ctx: unknown }).ctx = { bus: { emit: () => {} } };
  return {
    ui,
    probe,
    clock,
    restore: () => {
      ui.dispose();
      root.remove();
      factories.council = saved;
      uiClock.now = realNow;
    },
  };
}

describe('UIManager: throttle, anchor tracking, press hold', () => {
  it('throttled pushes go to track() at once and render the latest props after the interval', async () => {
    vi.useFakeTimers();
    const { ui, probe, clock, restore } = await setup();
    try {
      ui.show('council', { n: 1 } as never);
      expect(probe.updates).toEqual([{ n: 1 }]);
      clock.t = 1050;
      ui.update('council', { n: 2 } as never);
      clock.t = 1100;
      ui.update('council', { n: 3 } as never);
      expect(probe.updates).toHaveLength(1);
      expect(probe.tracks).toEqual([{ n: 2 }, { n: 3 }]);
      clock.t = 1250;
      vi.advanceTimersByTime(200);
      expect(probe.updates).toEqual([{ n: 1 }, { n: 3 }]);
    } finally {
      restore();
    }
  });

  it('a press inside the screen holds re-renders until the pointer is released, then renders after the click', async () => {
    vi.useFakeTimers();
    const { ui, probe, clock, restore } = await setup();
    try {
      ui.show('council', { n: 1 } as never);
      probe.el.dispatchEvent(new ShimEvent('pointerdown', { bubbles: true }));
      clock.t = 1500;
      ui.update('council', { n: 2 } as never);
      clock.t = 2000;
      vi.advanceTimersByTime(1000);
      ui.update('council', { n: 3 } as never);
      // Held: nothing rebuilt under the finger, but anchors still follow.
      expect(probe.updates).toEqual([{ n: 1 }]);
      expect(probe.tracks).toEqual([{ n: 2 }, { n: 3 }]);
      (globalThis as unknown as { window: ShimElement }).window.dispatchEvent(new ShimEvent('pointerup'));
      // The click that follows pointerup is dispatched in the same task: still the old DOM.
      expect(probe.updates).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(probe.updates).toEqual([{ n: 1 }, { n: 3 }]);
    } finally {
      restore();
    }
  });

  it('HUD screens never wait for a release (touch stick and hold buttons live there)', async () => {
    vi.useFakeTimers();
    const { ui, probe, clock, restore } = await setup('hud');
    try {
      ui.show('council', { n: 1 } as never);
      probe.el.dispatchEvent(new ShimEvent('pointerdown', { bubbles: true }));
      clock.t = 1500;
      ui.update('council', { n: 2 } as never);
      expect(probe.updates).toEqual([{ n: 1 }, { n: 2 }]);
    } finally {
      restore();
    }
  });

  it('a press that never sees its release stops holding after a few seconds', async () => {
    vi.useFakeTimers();
    const { ui, probe, clock, restore } = await setup();
    try {
      ui.show('council', { n: 1 } as never);
      probe.el.dispatchEvent(new ShimEvent('pointerdown', { bubbles: true }));
      clock.t = 10_000;
      ui.update('council', { n: 2 } as never);
      expect(probe.updates).toEqual([{ n: 1 }, { n: 2 }]);
    } finally {
      restore();
    }
  });

  it('opening a modal drops transient (feed-duplicate) toasts; explicit toasts stay', async () => {
    vi.useFakeTimers();
    const { ui, restore } = await setup('modal');
    try {
      const layer = (ui as unknown as { layers: { toast: ShimElement } }).layers.toast;
      ui.toast('Objective complete', 'success', 3600, true);
      ui.toast('Chronicle saved', 'success', 1600);
      expect(layer.children.length).toBe(2);
      ui.show('council', { n: 1 } as never);
      expect(ui.modalOpen).toBe(true);
      expect(layer.children.map((c) => c.textContent)).toEqual(['Chronicle saved']);
    } finally {
      restore();
    }
  });
});
