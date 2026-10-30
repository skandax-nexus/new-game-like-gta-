/**
 * Strategic (world) screens, wired statically by src/ui/screens/index.ts: HUD, settlement / army / province panels,
 * diplomacy, council, chronicle, event modal, engagement prompt, scenario results. The implementations live in
 * ./world/*.ts; the Contracts v2 AoE screens (build_placement, market, age_panel, economy_panel) are discovered from
 * ./world/aoe.screen.ts. OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 */
export { worldHud, hudOptions } from './world/hud';
export { settlementPanel } from './world/settlementPanel';
export { armyPanel, provincePanel } from './world/armyPanel';
export { diplomacyScreen, councilScreen, chronicleScreen } from './world/realm';
export { eventModal, engagementPrompt, scenarioResults } from './world/prompts';
