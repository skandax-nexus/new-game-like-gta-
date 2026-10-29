/**
 * Screen registry (ScreenId -> factory) + UI service discovery. OWNER: Lead UI/UX Engineer (static screens);
 * discovery contract by CORE-01 (rules in ./registry.ts, docs/ARCHITECTURE.md "Contracts v2").
 *
 *  - STATIC_SCREEN_FACTORIES: the v1 screens, edited in place by their owners.
 *  - New screens: add `src/ui/screens/<area>/<name>.screen.ts` exporting
 *      `export const SCREENS: ScreenRegistration[] = [defineScreen('market', marketScreen)];`
 *    It is discovered at build time (no shared file to edit). Ids without a factory show the themed placeholder.
 *  - UI services: `src/ui/<area>/<name>.service.ts` exporting `SERVICES: UiService[]` -> UI_SERVICES.
 */
import type { ScreenFactory } from '../ui';
import { mainMenu, modeSetup, pauseMenu, saveLoad, settingsScreen } from './menu';
import { armyPanel, chronicleScreen, councilScreen, diplomacyScreen, engagementPrompt, eventModal, provincePanel, scenarioResults, settlementPanel, worldHud } from './world';
import { battleHud, battleResults } from './battle';
import { heroHud } from './hero';
import { buildScreenRegistry, collectUiServices, type ScreenFactoryMap, type ScreenRegistry, type UiService } from './registry';
import { placeholderScreen } from './placeholder';

/** Screens wired statically (v1 set). A discovered *.screen.ts module may not register these ids. */
export const STATIC_SCREEN_FACTORIES: Partial<ScreenFactoryMap> = {
  main_menu: mainMenu,
  mode_setup: modeSetup,
  pause_menu: pauseMenu,
  settings: settingsScreen,
  save_load: saveLoad,
  world_hud: worldHud,
  settlement_panel: settlementPanel,
  army_panel: armyPanel,
  province_panel: provincePanel,
  diplomacy: diplomacyScreen,
  council: councilScreen,
  chronicle: chronicleScreen,
  event_modal: eventModal,
  engagement_prompt: engagementPrompt,
  scenario_results: scenarioResults,
  battle_hud: battleHud,
  battle_results: battleResults,
  hero_hud: heroHud,
} satisfies { [K in keyof ScreenFactoryMap]?: ScreenFactory<K> };

/** Static + discovered + placeholder resolution of every ScreenId (see ./registry.ts). */
export const SCREEN_REGISTRY: ScreenRegistry = buildScreenRegistry(STATIC_SCREEN_FACTORIES, import.meta.glob('./**/*.screen.ts', { eager: true }), placeholderScreen);

/** Every ScreenId -> factory. UIManager.show() resolves screens here. */
export const SCREEN_FACTORIES: ScreenFactoryMap = SCREEN_REGISTRY.factories;

const serviceScan = collectUiServices(import.meta.glob('../**/*.service.ts', { eager: true }));

/** Discovered UI services (`src/ui/**\/*.service.ts`); the UIManager (UI-02) starts and stops them. */
export const UI_SERVICES: readonly UiService[] = serviceScan.services;

/** Registration problems of screens and services (printed once at startup; tests require none). */
export const UI_REGISTRY_ERRORS: readonly string[] = [...SCREEN_REGISTRY.errors, ...serviceScan.errors];
for (const e of UI_REGISTRY_ERRORS) console.error(`[ui registry] ${e}`);

export type { ScreenRegistration, UiService } from './registry';
export { defineScreen } from './registry';
