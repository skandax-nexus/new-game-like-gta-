/**
 * UI-02 screens and services are registered: the four AoE screens are discovered (*.screen.ts, not placeholders),
 * every in-game screen of the v1 set is static, and the market-history + ui-debug services are found.
 * OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 */
import { describe, expect, it } from 'vitest';
import { SCREEN_REGISTRY, UI_REGISTRY_ERRORS, UI_SERVICES } from '../../../src/ui/screens/index';
import { PLANNED_SCREEN_OWNERS } from '../../../src/ui/screens/registry';

describe('UI-02 registration', () => {
  it('build_placement, market, age_panel and economy_panel are real screens', () => {
    const mine = Object.entries(PLANNED_SCREEN_OWNERS)
      .filter(([, t]) => t === 'UI-02')
      .map(([id]) => id);
    expect(mine.sort()).toEqual(['age_panel', 'build_placement', 'economy_panel', 'market']);
    for (const id of mine) expect(SCREEN_REGISTRY.source[id as keyof typeof SCREEN_REGISTRY.source], id).toBe('discovered');
    expect(SCREEN_REGISTRY.modules.market).toMatch(/world\/aoe\.screen\.ts$/);
  });

  it('in-game v1 screens are static and the registry is clean', () => {
    for (const id of ['world_hud', 'settlement_panel', 'army_panel', 'province_panel', 'diplomacy', 'council', 'chronicle', 'event_modal', 'engagement_prompt', 'scenario_results', 'battle_hud', 'battle_results', 'hero_hud'] as const) {
      expect(SCREEN_REGISTRY.source[id], id).toBe('static');
    }
    expect(UI_REGISTRY_ERRORS).toEqual([]);
  });

  it('UI services: market history and the QA debug hooks', () => {
    const ids = UI_SERVICES.map((s) => s.id);
    expect(ids).toContain('market-history');
    expect(ids).toContain('ui-debug');
  });
});
