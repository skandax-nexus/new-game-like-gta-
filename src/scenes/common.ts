/**
 * Shared scene helpers: settlement layouts from world/data, faction colors, environment overrides.
 * OWNER: Lead Gameplay Engineer. Baseline by the CTO.
 */
import type { EnvironmentState, SettlementState, TerrainQuery, WorldState } from '../core/types';
import type { UrlParams } from '../core/params';
import { FACTIONS } from '../data/factions';
import { REGION } from '../data/region';
import { generateSettlementLayout, type ArchitectureStyle, type SettlementLayout } from '../render/architecture/layout';
import { makeWeather } from '../sim/strategic/seasons';
import { resolveRegionTerrain } from '../sim/strategic/world';
import { SETTLEMENT_PAD_RADIUS } from '../core/terrain/sites';
import { hashString } from '../core/rng';

export function styleFor(ownerFactionId: string | null): ArchitectureStyle {
  return (ownerFactionId ? FACTIONS[ownerFactionId]?.architectureStyle : undefined) ?? 'heartland_brick';
}

export function factionColor(id: string | null | undefined, fallback = '#cccccc'): string {
  return (id ? FACTIONS[id]?.colors.primary : undefined) ?? fallback;
}

/** Layout for a live settlement (world scene / hero scene with a world). */
export function layoutForSettlement(s: SettlementState, terrain: TerrainQuery): SettlementLayout {
  return generateSettlementLayout(
    { id: s.id, kind: s.kind, x: s.x, z: s.z, radius: s.radius, population: s.population, seed: s.layoutSeed, buildings: s.buildings, fortLevel: s.fortLevel, style: styleFor(s.ownerFactionId) },
    terrain,
  );
}

/** Layouts for settlements straight from region data (menu backdrop / hero mode without a world). */
export function layoutsFromRegionData(terrain: TerrainQuery, filter?: (id: string) => boolean): SettlementLayout[] {
  const { sites } = resolveRegionTerrain();
  const out: SettlementLayout[] = [];
  for (const def of REGION.settlements) {
    if (filter && !filter(def.id)) continue;
    const site = sites.find((s) => s.id === def.id);
    if (!site || !terrain.inBounds(site.x, site.z)) continue;
    out.push(
      generateSettlementLayout(
        { id: def.id, kind: def.kind, x: site.x, z: site.z, radius: SETTLEMENT_PAD_RADIUS[def.kind], population: def.population, seed: hashString(def.id), buildings: def.buildings, fortLevel: def.fortLevel, style: styleFor(def.defaultOwner) },
        terrain,
      ),
    );
  }
  return out;
}

/** World layouts for all settlements inside the terrain bounds. */
export function layoutsFromWorld(world: WorldState, terrain: TerrainQuery): SettlementLayout[] {
  return Object.keys(world.settlements)
    .sort()
    .map((id) => world.settlements[id]!)
    .filter((s) => terrain.inBounds(s.x, s.z))
    .map((s) => layoutForSettlement(s, terrain));
}

/** Apply URL environment overrides (?hour, ?season, ?weather) to an environment state. */
export function applyEnvParams(env: EnvironmentState, params: UrlParams): EnvironmentState {
  const season = params.season ?? env.season;
  const weather = params.weather ? makeWeather(params.weather, season, env.weather.windDirection) : env.weather;
  return { ...env, hour: params.hour ?? env.hour, season, weather };
}
