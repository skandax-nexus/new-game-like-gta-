/**
 * Screen + UI-service registry rules. OWNER: Engine Developer - Contracts (CORE-01); consumed by the UIManager
 * (UI-02) through src/ui/screens/index.ts. Pure functions (no DOM, no import.meta.glob) so node tests run them.
 *
 * Parallel-work scaffolding (docs/ARCHITECTURE.md "Contracts v2"):
 *  - Screens wired in index.ts are STATIC (the 18 v1 screens; their owners edit them in place).
 *  - Any `src/ui/screens/**\/<name>.screen.ts` module exporting `SCREENS: ScreenRegistration[]` is DISCOVERED
 *    (eager import.meta.glob) - a new screen needs no edit of a shared file. A discovered id must not already be
 *    static or registered by another module (reported as an error; the first registration wins).
 *  - Every ScreenId without a factory resolves to the themed PLACEHOLDER (placeholder.ts), so scenes may already
 *    `ui.show('market', props)` before the screen exists.
 *  - `src/ui/**\/<name>.service.ts` modules exporting `SERVICES: UiService[]` become UI_SERVICES; the UIManager
 *    starts each with start(ctx, ui) and calls the returned stop function on dispose.
 * Modules must not use ui.ts values at module top level (index.ts imports them eagerly: import cycle).
 */
import type { AppContext, ScreenId } from '../../app/contracts';
import { isScreenId, SCREEN_IDS } from '../../app/contracts';
import type { ScreenFactory, UIManager } from '../ui';

/** One screen of a `*.screen.ts` module (id and factory are type-correlated). */
export type ScreenRegistration = { [K in ScreenId]: { id: K; factory: ScreenFactory<K> } }[ScreenId];

/** Typed helper for `*.screen.ts` modules: `export const SCREENS = [defineScreen('market', marketScreen)];` */
export function defineScreen<K extends ScreenId>(id: K, factory: ScreenFactory<K>): ScreenRegistration {
  return { id, factory } as ScreenRegistration;
}

/** A long-lived UI behaviour (tutorial hints, notification feed, minimap feed...) started by the UIManager. */
export interface UiService {
  /** Unique id, e.g. 'hints'. */
  id: string;
  /** Start listening (bus, DOM); return the stop function (called on UIManager.dispose). */
  start(ctx: AppContext, ui: UIManager): () => void;
}

export type ScreenFactoryMap = { [K in ScreenId]: ScreenFactory<K> };
export type ScreenSource = 'static' | 'discovered' | 'placeholder';

export interface ScreenRegistry {
  /** Every ScreenId -> its factory (static, discovered, or placeholder). */
  factories: ScreenFactoryMap;
  source: Record<ScreenId, ScreenSource>;
  /** Module path of each discovered screen. */
  modules: Partial<Record<ScreenId, string>>;
  /** Ids still served by the placeholder (sorted). */
  placeholders: ScreenId[];
  /** Registration problems (also printed with console.error at startup). */
  errors: string[];
}

/** Ticket that implements each Contracts v2 screen (shown on the placeholder; docs/STUDIO.md board). */
export const PLANNED_SCREEN_OWNERS: Readonly<Partial<Record<ScreenId, string>>> = {
  build_placement: 'UI-02',
  market: 'UI-02',
  age_panel: 'UI-02',
  economy_panel: 'UI-02',
  mission_card: 'UI-01',
  hero_dialogue: 'UI-01',
  hero_negotiation: 'UI-01',
  mission_result: 'UI-01',
  game_stats: 'UI-01',
  hint_card: 'UI-01',
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Merge static factories, discovered `*.screen.ts` modules (path -> module namespace) and the placeholder
 * into the complete ScreenId -> factory map. Deterministic: modules are visited in sorted path order.
 */
export function buildScreenRegistry(
  staticFactories: Partial<ScreenFactoryMap>,
  modules: Readonly<Record<string, unknown>>,
  placeholder: <K extends ScreenId>(id: K) => ScreenFactory<K>,
): ScreenRegistry {
  const errors: string[] = [];
  const found = new Map<ScreenId, { path: string; factory: ScreenFactory<ScreenId> }>();
  for (const path of Object.keys(modules).sort()) {
    const mod = modules[path];
    const list = isRecord(mod) ? mod.SCREENS : undefined;
    if (!Array.isArray(list)) {
      errors.push(`${path}: a *.screen.ts module must export SCREENS: ScreenRegistration[]`);
      continue;
    }
    for (const entry of list as unknown[]) {
      const id = isRecord(entry) ? entry.id : undefined;
      const factory = isRecord(entry) ? entry.factory : undefined;
      if (!isScreenId(id)) {
        errors.push(`${path}: unknown screen id ${JSON.stringify(id)} (add it to ScreenPropsMap in src/app/contracts.ts via the CTO)`);
        continue;
      }
      if (typeof factory !== 'function') {
        errors.push(`${path}: screen '${id}' has no factory function`);
        continue;
      }
      if (staticFactories[id]) {
        errors.push(`${path}: screen '${id}' is static (src/ui/screens/index.ts) - a discovered module must not shadow it`);
        continue;
      }
      const prev = found.get(id);
      if (prev) {
        errors.push(`${path}: screen '${id}' is already registered by ${prev.path}`);
        continue;
      }
      found.set(id, { path, factory: factory as ScreenFactory<ScreenId> });
    }
  }
  const factories = {} as Record<ScreenId, ScreenFactory<ScreenId>>;
  const source = {} as Record<ScreenId, ScreenSource>;
  const moduleOf: Partial<Record<ScreenId, string>> = {};
  const placeholders: ScreenId[] = [];
  for (const id of SCREEN_IDS) {
    const st = staticFactories[id] as ScreenFactory<ScreenId> | undefined;
    const disc = found.get(id);
    if (st) {
      factories[id] = st;
      source[id] = 'static';
    } else if (disc) {
      factories[id] = disc.factory;
      source[id] = 'discovered';
      moduleOf[id] = disc.path;
    } else {
      factories[id] = placeholder(id) as ScreenFactory<ScreenId>;
      source[id] = 'placeholder';
      placeholders.push(id);
    }
  }
  return { factories: factories as unknown as ScreenFactoryMap, source, modules: moduleOf, placeholders: placeholders.sort(), errors };
}

/** Collect `SERVICES` from discovered `*.service.ts` modules (sorted by path; duplicate ids rejected). */
export function collectUiServices(modules: Readonly<Record<string, unknown>>): { services: UiService[]; errors: string[] } {
  const services: UiService[] = [];
  const errors: string[] = [];
  const seen = new Map<string, string>();
  for (const path of Object.keys(modules).sort()) {
    const mod = modules[path];
    const list = isRecord(mod) ? mod.SERVICES : undefined;
    if (!Array.isArray(list)) {
      errors.push(`${path}: a *.service.ts module must export SERVICES: UiService[]`);
      continue;
    }
    for (const s of list as unknown[]) {
      if (!isRecord(s) || typeof s.id !== 'string' || typeof s.start !== 'function') {
        errors.push(`${path}: invalid UiService (needs { id: string; start(ctx, ui): () => void })`);
        continue;
      }
      const prev = seen.get(s.id);
      if (prev) {
        errors.push(`${path}: UI service '${s.id}' is already registered by ${prev}`);
        continue;
      }
      seen.set(s.id, path);
      services.push(s as unknown as UiService);
    }
  }
  return { services, errors };
}
