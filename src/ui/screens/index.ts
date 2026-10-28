/**
 * Screen registry (ScreenId -> factory). OWNER: Lead UI/UX Engineer.
 */
import type { ScreenId } from '../../app/contracts';
import type { ScreenFactory } from '../ui';
import { mainMenu, modeSetup, pauseMenu, saveLoad, settingsScreen } from './menu';
import { armyPanel, chronicleScreen, councilScreen, diplomacyScreen, engagementPrompt, eventModal, provincePanel, scenarioResults, settlementPanel, worldHud } from './world';
import { battleHud, battleResults } from './battle';
import { heroHud } from './hero';

export const SCREEN_FACTORIES: { [K in ScreenId]: ScreenFactory<K> } = {
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
};
