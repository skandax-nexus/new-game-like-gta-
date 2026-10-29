/**
 * OWNER: Engine Developer - Contracts & Save Schema (CORE-01). Parallel-work registries:
 *  - every ScreenId resolves to a static factory, a discovered *.screen.ts module or the themed placeholder;
 *  - discovered modules can never shadow static screens (nor each other);
 *  - UI services and feature labs are discovered by file name with the documented rules.
 * Prints the current placeholder list (the screens still to build) for the sprint board.
 */
import { describe, expect, it } from 'vitest';
import type { ScreenId } from '../../src/app/contracts';
import { SCREEN_IDS } from '../../src/app/contracts';
import type { ScreenFactory } from '../../src/ui/ui';
import { SCREEN_FACTORIES, SCREEN_REGISTRY, STATIC_SCREEN_FACTORIES, UI_REGISTRY_ERRORS, UI_SERVICES } from '../../src/ui/screens/index';
import { buildScreenRegistry, collectUiServices, PLANNED_SCREEN_OWNERS, type ScreenFactoryMap } from '../../src/ui/screens/registry';
import { summarizeProp } from '../../src/ui/screens/placeholder';
import { buildLabIndex, labFromModule, labIdFromPath, LAB_INDEX, listLabs } from '../../src/scenes/lab/registry';

const fakeFactory = (() => ({})) as unknown as ScreenFactory<ScreenId>;
const placeholder = <K extends ScreenId>(id: K): ScreenFactory<K> => {
  const f = (() => ({ id })) as unknown as ScreenFactory<K>;
  (f as unknown as { placeholderFor: string }).placeholderFor = id;
  return f;
};

describe('screen registry', () => {
  it('resolves every ScreenId to a factory (static, discovered or placeholder)', () => {
    for (const id of SCREEN_IDS) {
      expect(typeof SCREEN_FACTORIES[id], id).toBe('function');
      expect(['static', 'discovered', 'placeholder']).toContain(SCREEN_REGISTRY.source[id]);
    }
    expect(Object.keys(SCREEN_FACTORIES).sort()).toEqual([...SCREEN_IDS].sort());
    expect(UI_REGISTRY_ERRORS).toEqual([]);
  });

  it('keeps the 18 v1 screens static', () => {
    expect(Object.keys(STATIC_SCREEN_FACTORIES)).toHaveLength(18);
    for (const id of Object.keys(STATIC_SCREEN_FACTORIES) as ScreenId[]) expect(SCREEN_REGISTRY.source[id]).toBe('static');
  });

  it('lists the screens still served by the placeholder (owner tickets)', () => {
    const rows = SCREEN_REGISTRY.placeholders.map((id) => `${id.padEnd(18)} -> ${PLANNED_SCREEN_OWNERS[id] ?? '?'}`);
    console.log(`[registry] placeholder screens (${rows.length}):\n  ${rows.join('\n  ')}`);
    for (const id of SCREEN_REGISTRY.placeholders) expect(PLANNED_SCREEN_OWNERS[id], `${id} needs an owner`).toBeTruthy();
    const discovered = SCREEN_IDS.filter((id) => SCREEN_REGISTRY.source[id] === 'discovered');
    console.log(`[registry] discovered *.screen.ts screens (${discovered.length}): ${discovered.map((id) => `${id} (${SCREEN_REGISTRY.modules[id]})`).join(', ') || 'none yet'}`);
  });

  it('discovered modules never shadow static screens (or each other)', () => {
    const statics: Partial<ScreenFactoryMap> = { main_menu: fakeFactory as ScreenFactory<'main_menu'> };
    const reg = buildScreenRegistry(
      statics,
      {
        './b/shadow.screen.ts': { SCREENS: [{ id: 'main_menu', factory: fakeFactory }] },
        './a/market.screen.ts': { SCREENS: [{ id: 'market', factory: fakeFactory }] },
        './c/market-again.screen.ts': { SCREENS: [{ id: 'market', factory: fakeFactory }] },
        './d/bogus.screen.ts': { SCREENS: [{ id: 'not_a_screen', factory: fakeFactory }] },
        './e/empty.screen.ts': { default: 1 },
      },
      placeholder,
    );
    expect(reg.factories.main_menu).toBe(statics.main_menu);
    expect(reg.source.main_menu).toBe('static');
    expect(reg.source.market).toBe('discovered');
    expect(reg.modules.market).toBe('./a/market.screen.ts');
    expect(reg.errors).toHaveLength(4);
    expect(reg.errors.join('\n')).toMatch(/shadow\.screen\.ts: screen 'main_menu' is static/);
    expect(reg.errors.join('\n')).toMatch(/market-again\.screen\.ts: screen 'market' is already registered/);
    expect(reg.errors.join('\n')).toMatch(/unknown screen id "not_a_screen"/);
    expect(reg.errors.join('\n')).toMatch(/must export SCREENS/);
    expect((reg.factories.game_stats as unknown as { placeholderFor: string }).placeholderFor).toBe('game_stats');
    expect(reg.placeholders).not.toContain('market');
    expect(reg.placeholders).toContain('game_stats');
  });

  it('summarizes placeholder props without walking big state', () => {
    expect(summarizeProp({ calendar: { totalHours: 720 }, factions: { a: 1, b: 2 }, settlements: { s: 1 } })).toBe('WorldState · day 30 · 2 factions · 1 settlements');
    expect(summarizeProp('heartland')).toBe('"heartland"');
    expect(summarizeProp([1, 2, 3, 4])).toBe('array of 4: 1, 2, 3');
    expect(summarizeProp(null)).toBe('null');
    expect(summarizeProp({ grain: 1, timber: 2 })).toBe('{ grain, timber }');
  });
});

describe('UI services', () => {
  it('collects SERVICES from *.service.ts modules and rejects duplicates', () => {
    const start = (): (() => void) => () => undefined;
    const r = collectUiServices({
      '../frontend/hints.service.ts': { SERVICES: [{ id: 'hints', start }] },
      '../services/feed.service.ts': { SERVICES: [{ id: 'feed', start }, { id: 'hints', start }] },
      '../x/broken.service.ts': { SERVICES: [{ id: 3 }] },
    });
    expect(r.services.map((s) => s.id)).toEqual(['hints', 'feed']);
    expect(r.errors).toHaveLength(2);
    expect(Array.isArray(UI_SERVICES)).toBe(true);
  });
});

describe('feature labs', () => {
  it('derives lab ids from file names', () => {
    expect(labIdFromPath('/src/scenes/lab/example.lab.ts')).toBe('example');
    expect(labIdFromPath('/src/render/post/post-hero.lab.ts')).toBe('post-hero');
    expect(labIdFromPath('/src/render/Bad Name.lab.ts')).toBeNull();
    expect(labIdFromPath('/src/render/x.ts')).toBeNull();
  });

  it('indexes discovered labs (example included) and rejects duplicate ids', () => {
    expect(listLabs()).toContain('example');
    expect(LAB_INDEX.errors).toEqual([]);
    const load = (): Promise<unknown> => Promise.resolve({});
    const idx = buildLabIndex({ '/src/a/x.lab.ts': load, '/src/b/x.lab.ts': load, '/src/c/Y.lab.ts': load });
    expect(Object.keys(idx.entries)).toEqual(['x']);
    expect(idx.entries.x!.path).toBe('/src/a/x.lab.ts');
    expect(idx.errors).toHaveLength(2);
  });

  it('the example lab module exports a valid LAB', async () => {
    const mod = await LAB_INDEX.entries.example!.load();
    const lab = labFromModule(mod, 'example', LAB_INDEX.entries.example!.path);
    expect(lab.id).toBe('example');
    expect(lab.title.length).toBeGreaterThan(5);
    expect(() => labFromModule({ LAB: { ...lab, id: 'other' } }, 'example', 'x')).toThrow(/must equal the file name/);
    expect(() => labFromModule({}, 'example', 'x')).toThrow(/does not export LAB/);
  });
});
