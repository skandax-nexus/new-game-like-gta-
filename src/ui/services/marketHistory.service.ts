/**
 * Market price history for the market screen's sparklines (DESIGN_SPEC §12.2 Market: price sparkline). The world
 * keeps only the current price factors (FactionState.marketPrices); this UI service samples them once per game day
 * from the session world (`world:tick`) into a 60-day ring per resource. OWNER: UI Engineer - In-game HUD, Command
 * Card, Minimap & Input (UI-02). Discovered by src/ui/screens/index.ts (UI_SERVICES), started by the UIManager.
 */
import type { AppContext } from '../../app/contracts';
import type { MarketResource } from '../../core/types';
import type { UiService } from '../screens/registry';

const DAYS = 60;
const history = new Map<string, number[]>();
let lastKey = '';

/** Sampled price factors (oldest first) of a faction's market lot; empty before the first day. */
export function marketHistory(factionId: string, res: MarketResource): readonly number[] {
  return history.get(`${factionId}|${res}`) ?? [];
}

/** Record one sample (also used by tests). */
export function recordMarketSample(factionId: string, res: MarketResource, factor: number): void {
  const k = `${factionId}|${res}`;
  const list = history.get(k) ?? [];
  list.push(factor);
  if (list.length > DAYS) list.splice(0, list.length - DAYS);
  history.set(k, list);
}

export function clearMarketHistory(): void {
  history.clear();
  lastKey = '';
}

export const SERVICES: UiService[] = [
  {
    id: 'market-history',
    start(ctx: AppContext) {
      const off = ctx.bus.on('world:tick', ({ calendar }) => {
        const w = ctx.session.world;
        if (!w) return;
        const key = `${w.seed}|${Math.floor(calendar.totalHours / 24)}`;
        if (key === lastKey) return;
        lastKey = key;
        const f = w.factions[w.playerFactionId];
        if (!f) return;
        for (const r of ['grain', 'timber', 'stone'] as const) recordMarketSample(f.id, r, f.marketPrices[r]);
      });
      const offMode = ctx.bus.on('session:mode', () => clearMarketHistory());
      return () => {
        off();
        offMode();
      };
    },
  },
];
