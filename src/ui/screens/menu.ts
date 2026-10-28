/**
 * Menu screens: main menu, mode setup (campaign / sandbox / skirmish), pause, settings, save/load.
 * OWNER: Lead UI/UX Engineer. Baseline by the CTO.
 */
import type { AppContext, ScreenPropsMap } from '../../app/contracts';
import type { Difficulty, GameMode, QualityTier, Season, SkirmishSetup, TerrainPreset, WeatherKind } from '../../core/types';
import { DIFFICULTIES, QUALITY_TIERS, SEASONS, TERRAIN_PRESETS, WEATHER_KINDS } from '../../core/types';
import { DEFAULT_SKIRMISH_SOLDIERS, GAME_TITLE } from '../../core/constants';
import { FACTIONS, PLAYABLE_FACTION_IDS } from '../../data/factions';
import { SCENARIOS, defaultSandbox } from '../../data/campaign';
import { h, append, clear } from '../dom';
import type { Screen, UIManager } from '../ui';

const sfx = (ctx: AppContext): void => ctx.bus.emit('audio:sfx', { sfx: 'ui_click' });

function select<T extends string>(label: string, options: readonly T[], value: T, names?: (v: T) => string): { el: HTMLElement; get: () => T } {
  const s = h('select', null, ...options.map((o) => h('option', { value: o, selected: o === value }, names ? names(o) : o.replace(/_/g, ' '))));
  return { el: h('label', { class: 'field' }, h('span', { class: 'muted' }, label), s), get: () => s.value as T };
}

function range(label: string, min: number, max: number, step: number, value: number, fmt: (v: number) => string = String): { el: HTMLElement; get: () => number } {
  const out = h('b', null, fmt(value));
  const r = h('input', { type: 'range', min, max, step, value });
  r.addEventListener('input', () => (out.textContent = fmt(Number(r.value))));
  return { el: h('label', { class: 'field' }, h('span', { class: 'muted' }, label, ' ', out), r), get: () => Number(r.value) };
}

// -------------------------------------------------------------------------------------------------

export function mainMenu(ctx: AppContext, ui: UIManager): Screen<'main_menu'> {
  const version = h('div', { class: 'muted', style: { position: 'absolute', right: 'max(14px, var(--safe-right))', bottom: 'max(10px, var(--safe-bottom))', fontSize: 'var(--fs-xs)' } });
  const btn = (label: string, fn: () => void, primary = false): HTMLButtonElement =>
    h('button', { class: `btn ${primary ? 'primary' : ''}`, style: { width: '100%' }, onclick: () => (sfx(ctx), fn()) }, label);
  const panel = h(
    'div',
    { class: 'panel', style: { width: 'min(340px, 86vw)', display: 'flex', flexDirection: 'column', gap: '10px' } },
    btn('Campaign', () => ui.show('mode_setup', { mode: 'campaign' }), true),
    btn('Sandbox', () => ui.show('mode_setup', { mode: 'sandbox' })),
    btn('Skirmish', () => ui.show('mode_setup', { mode: 'skirmish' })),
    btn('Explore the Capital', () => void ctx.actions.visitSettlement(null)),
    btn('Load Chronicle', () => ui.show('save_load', { mode: 'load', slots: ctx.saves.list() })),
    btn('Settings', () => ui.show('settings', { settings: ctx.settings, detection: ctx.quality.detection, tier: ctx.quality.tier })),
  );
  const title = h(
    'div',
    { style: { textAlign: 'left', textShadow: '0 4px 24px rgba(0,0,0,0.6)' } },
    h('div', { style: { fontFamily: 'var(--font-display)', fontSize: 'var(--fs-title)', letterSpacing: 'var(--letter-title)', color: 'var(--c-gold)' } }, 'SAMRAJYA'),
    h('div', { style: { fontFamily: 'var(--font-display)', fontSize: 'clamp(14px, 2.4vw, 22px)', letterSpacing: '0.45em', color: 'var(--c-ivory)', textTransform: 'uppercase' } }, 'Echoes of Bharat'),
    h('div', { class: 'divider', style: { width: 'min(420px, 80vw)' } }),
    h('div', { class: 'muted', style: { fontStyle: 'italic' } }, 'Build a kingdom. Unite a civilization. Rewrite history.'),
  );
  const el = h(
    'div',
    {
      class: 'screen-main-menu',
      style: {
        position: 'absolute',
        inset: '0',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: '28px',
        padding: 'max(24px, var(--safe-top)) max(24px, var(--safe-right)) max(24px, var(--safe-bottom)) max(5vw, var(--safe-left))',
        background: 'linear-gradient(90deg, rgba(12,7,20,0.72) 0%, rgba(12,7,20,0.25) 45%, rgba(0,0,0,0) 70%)',
      },
    },
    title,
    panel,
    version,
  );
  return {
    id: 'main_menu',
    layer: 'fullscreen',
    el,
    update(p: ScreenPropsMap['main_menu']) {
      version.textContent = `${GAME_TITLE} - build ${p.version}`;
    },
  };
}

// -------------------------------------------------------------------------------------------------

export function modeSetup(ctx: AppContext, ui: UIManager): Screen<'mode_setup'> {
  const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
  const el = h('div', { class: 'panel modal' }, body);
  const seed = (): number => ctx.params.seed ?? Math.floor(Math.random() * 1e9);
  const factionName = (id: string): string => FACTIONS[id]?.name ?? id;
  const render = (mode: GameMode): void => {
    clear(body);
    const close = h('button', { class: 'btn ghost', onclick: () => ui.hide('mode_setup') }, 'Back');
    if (mode === 'campaign') {
      const ids = Object.keys(SCENARIOS);
      const sc = select('Chapter', ids, ids[0] as string, (id) => `${SCENARIOS[id]?.chapter}. ${SCENARIOS[id]?.title}`);
      const diff = select<Difficulty>('Difficulty', DIFFICULTIES, 'normal');
      const desc = h('p', { class: 'muted' }, SCENARIOS[ids[0] as string]?.description ?? '');
      sc.el.querySelector('select')?.addEventListener('change', () => (desc.textContent = SCENARIOS[sc.get()]?.description ?? ''));
      append(body, 
        h('div', { class: 'panel-title' }, 'Campaign'),
        sc.el,
        desc,
        diff.el,
        h('div', { class: 'btn-row' }, close, h('button', { class: 'btn primary', onclick: () => (sfx(ctx), void ctx.actions.startCampaign(sc.get(), diff.get())) }, 'Begin the Chronicle')),
      );
    } else if (mode === 'sandbox') {
      const fac = select('Your realm', PLAYABLE_FACTION_IDS, PLAYABLE_FACTION_IDS[0] as string, factionName);
      const fert = range('Fertility', 0.5, 1.5, 0.05, 1, (v) => `${Math.round(v * 100)}%`);
      const mon = range('Monsoon strength', 0.5, 1.5, 0.05, 1, (v) => `${Math.round(v * 100)}%`);
      const aggr = range('Rival aggression', 0, 1, 0.05, 0.5, (v) => `${Math.round(v * 100)}%`);
      const diff = select<Difficulty>('Difficulty', DIFFICULTIES, 'normal');
      append(body, 
        h('div', { class: 'panel-title' }, 'Sandbox'),
        h('p', { class: 'muted' }, 'A custom start in the River of Kings. No scripted story - only the world and its consequences.'),
        fac.el,
        fert.el,
        mon.el,
        aggr.el,
        diff.el,
        h(
          'div',
          { class: 'btn-row' },
          close,
          h(
            'button',
            {
              class: 'btn primary',
              onclick: () => {
                sfx(ctx);
                const sb = defaultSandbox(seed());
                const player = fac.get();
                void ctx.actions.startSandbox({
                  ...sb,
                  playerFactionId: player,
                  rivalFactionIds: ['heartland', 'highland', 'forest', 'frontier'].filter((f) => f !== player),
                  fertility: fert.get(),
                  monsoonStrength: mon.get(),
                  aiAggression: aggr.get(),
                  difficulty: diff.get(),
                });
              },
            },
            'Found the Realm',
          ),
        ),
      );
    } else {
      const fac = select('Your army', PLAYABLE_FACTION_IDS, PLAYABLE_FACTION_IDS[0] as string, factionName);
      const enemy = select('Enemy', Object.keys(FACTIONS), 'highland', factionName);
      const preset = select<TerrainPreset>('Battlefield', TERRAIN_PRESETS.filter((p) => p !== 'region' && p !== 'capital'), 'river_crossing');
      const soldiers = range('Combatants', 200, 6000, 100, ctx.params.soldiers ?? DEFAULT_SKIRMISH_SOLDIERS, (v) => v.toLocaleString('en-IN'));
      const hour = range('Hour', 5, 20, 0.5, ctx.params.hour ?? 8.5, (v) => `${Math.floor(v)}:${v % 1 ? '30' : '00'}`);
      const season = select<Season>('Season', SEASONS, ctx.params.season ?? 'sharad');
      const weather = select<WeatherKind>('Weather', WEATHER_KINDS, ctx.params.weather ?? 'clear');
      const diff = select<Difficulty>('Difficulty', DIFFICULTIES, 'normal');
      append(body, 
        h('div', { class: 'panel-title' }, 'Skirmish'),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' } }, fac.el, enemy.el, preset.el, diff.el, soldiers.el, hour.el, season.el, weather.el),
        h(
          'div',
          { class: 'btn-row' },
          close,
          h(
            'button',
            {
              class: 'btn primary',
              onclick: () => {
                sfx(ctx);
                const setup: SkirmishSetup = {
                  seed: seed(),
                  preset: preset.get(),
                  totalSoldiers: soldiers.get(),
                  playerFactionId: fac.get(),
                  enemyFactionId: enemy.get(),
                  armies: null,
                  playerSide: 0,
                  hour: hour.get(),
                  season: season.get(),
                  weather: weather.get(),
                  difficulty: diff.get(),
                  aiVsAi: false,
                };
                void ctx.actions.startSkirmish(setup);
              },
            },
            'To Battle',
          ),
        ),
      );
    }
  };
  return { id: 'mode_setup', layer: 'modal', el, update: (p) => render(p.mode) };
}

// -------------------------------------------------------------------------------------------------

export function pauseMenu(ctx: AppContext, ui: UIManager): Screen<'pause_menu'> {
  const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } });
  const el = h('div', { class: 'panel modal', style: { width: 'min(340px, 100%)' } }, h('div', { class: 'panel-title', style: { textAlign: 'center' } }, 'Paused'), body);
  return {
    id: 'pause_menu',
    layer: 'modal',
    el,
    update(p) {
      clear(body);
      const b = (label: string, fn: () => void, primary = false, disabled = false): HTMLButtonElement => h('button', { class: `btn ${primary ? 'primary' : ''}`, disabled, onclick: () => (sfx(ctx), fn()) }, label);
      append(body, 
        b('Resume', () => {
          ui.hide('pause_menu');
          ctx.actions.setPaused(false);
        }, true),
        b('Save', () => ui.show('save_load', { mode: 'save', slots: ctx.saves.list() }), false, !p.canSave),
        b('Load', () => ui.show('save_load', { mode: 'load', slots: ctx.saves.list() })),
        b('Settings', () => ui.show('settings', { settings: ctx.settings, detection: ctx.quality.detection, tier: ctx.quality.tier })),
        b('Quit to Main Menu', () => void ctx.actions.quitToMenu()),
      );
    },
  };
}

// -------------------------------------------------------------------------------------------------

export function settingsScreen(ctx: AppContext, ui: UIManager): Screen<'settings'> {
  const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } });
  const el = h('div', { class: 'panel modal' }, h('div', { class: 'panel-title' }, 'Settings'), body);
  return {
    id: 'settings',
    layer: 'modal',
    el,
    update(p) {
      clear(body);
      const q = select<QualityTier | 'auto'>('Graphics quality', ['auto', ...QUALITY_TIERS], p.settings.quality, (v) => (v === 'auto' ? `Auto (${p.detection.tier})` : v));
      const master = range('Master volume', 0, 1, 0.05, p.settings.masterVolume, (v) => `${Math.round(v * 100)}%`);
      const music = range('Music', 0, 1, 0.05, p.settings.musicVolume, (v) => `${Math.round(v * 100)}%`);
      const sfxV = range('Effects', 0, 1, 0.05, p.settings.sfxVolume, (v) => `${Math.round(v * 100)}%`);
      const scale = range('Interface scale', 0.8, 1.4, 0.05, p.settings.uiScale, (v) => `${Math.round(v * 100)}%`);
      const edge = h('input', { type: 'checkbox', checked: p.settings.edgeScroll });
      const inv = h('input', { type: 'checkbox', checked: p.settings.invertZoom });
      append(body, 
        q.el,
        h('div', { class: 'muted', style: { fontSize: 'var(--fs-xs)' } }, `GPU: ${p.detection.gpuRenderer || 'unknown'} - ${p.detection.reasons.join('; ')}`),
        master.el,
        music.el,
        sfxV.el,
        scale.el,
        h('label', { class: 'field', style: { flexDirection: 'row', alignItems: 'center' } }, edge, 'Edge scrolling'),
        h('label', { class: 'field', style: { flexDirection: 'row', alignItems: 'center' } }, inv, 'Invert zoom'),
        h(
          'div',
          { class: 'btn-row' },
          h('button', { class: 'btn ghost', onclick: () => ui.hide('settings') }, 'Close'),
          h(
            'button',
            {
              class: 'btn primary',
              onclick: () => {
                sfx(ctx);
                ctx.actions.updateSettings({ masterVolume: master.get(), musicVolume: music.get(), sfxVolume: sfxV.get(), uiScale: scale.get(), edgeScroll: edge.checked, invertZoom: inv.checked });
                ctx.actions.setQuality(q.get());
                ui.hide('settings');
              },
            },
            'Apply',
          ),
        ),
      );
    },
  };
}

// -------------------------------------------------------------------------------------------------

export function saveLoad(ctx: AppContext, ui: UIManager): Screen<'save_load'> {
  const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
  const title = h('div', { class: 'panel-title' });
  const el = h('div', { class: 'panel modal' }, title, body);
  return {
    id: 'save_load',
    layer: 'modal',
    el,
    update(p) {
      title.textContent = p.mode === 'save' ? 'Save Chronicle' : 'Load Chronicle';
      clear(body);
      const slots = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'quick', 'auto'];
      for (const slot of slots) {
        if (p.mode === 'save' && (slot === 'auto' || slot === 'quick')) continue;
        const info = p.slots.find((s) => s.slot === slot);
        if (p.mode === 'load' && !info) continue;
        const label = info ? `${info.meta.name} - ${info.meta.summary}` : 'Empty';
        append(body, 
          h(
            'button',
            {
              class: 'btn',
              style: { justifyContent: 'flex-start', textAlign: 'left', fontFamily: 'var(--font-body)' },
              onclick: () => {
                sfx(ctx);
                if (p.mode === 'save') {
                  ctx.actions.saveGame(slot);
                  ui.hide('save_load');
                } else void ctx.actions.loadGame(slot);
              },
            },
            h('b', null, slot.toUpperCase(), ' '),
            h('span', { class: 'muted' }, label),
          ),
        );
      }
      if (p.mode === 'load' && body.children.length === 0) append(body, h('p', { class: 'muted' }, 'No saved chronicles yet.'));
      append(body, h('button', { class: 'btn ghost', onclick: () => ui.hide('save_load') }, 'Close'));
    },
  };
}
