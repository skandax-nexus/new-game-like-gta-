/**
 * Shared HUD components for every screen owner (UI-01 menus / hero dialogue reuse them): icons, widgets (meters, pips,
 * ring, faction chip, tabs, slider / stepper, sparkline, portrait, panel frame, stat cell, section), tooltips, the
 * AoE command grid and the minimap. Styles: src/ui/components/hud.css (loaded by the UIManager).
 * OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 */
export { ICON_IDS, ICON_PATHS_HUD, THEME_ICON_IDS, icon, iconUrl, setIcon, unitIcon } from './icons';
export {
  factionChip,
  factionClass,
  initials,
  meter,
  panelFrame,
  pips,
  portrait,
  ringProgress,
  section,
  setFactionChip,
  setVar,
  slider,
  sparkline,
  statCell,
  stepper,
  tabs,
  type Meter,
  type MeterKind,
  type PanelFrame,
  type Slider,
  type SliderOpts,
  type TabItem,
  type Tabs,
} from './widgets';
export { TooltipService, type TooltipContent, type TooltipProvider, type Tone } from './tooltip';
export { CommandGrid, slotTooltip, type CommandGridOptions } from './commandGrid';
export { Minimap, type MinimapOptions, type PingSeverity } from './minimap';
