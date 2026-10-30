/**
 * World HUD resource bar + date block models (DESIGN_SPEC §8.1, §12.2): six resources in RESOURCE_BAR_ORDER with
 * value, trend and the stated tooltip rows, plus the date / season / weather / monsoon forecast line. Pure (no DOM):
 * the HUD renders it, tests check the numbers and strings. OWNER: UI Engineer - In-game HUD, Command Card, Minimap &
 * Input (UI-02).
 */
import type { EconomyResource, FactionId, Season, WeatherKind, WorldState } from '../../core/types';
import { RESOURCE_BAR_ORDER, RESOURCE_DISPLAY } from '../../data/resources';
import { BUILDINGS } from '../../data/buildings';
import { formatDate, SEASON_NAMES, seasonOf } from '../../sim/strategic/seasons';
import { materialsProduction, projectLedger, reserveDays, settlementFoodBalance } from '../../sim/strategic/economy';
import { armyFoodNeed } from '../../sim/strategic/supply';
import { stageEffect } from '../../sim/strategic/modifiers';
import { RULES } from '../../data/rules';
import { fmtCompact, fmtDays, fmtInt, fmtSigned } from '../dom';

export type TrendTone = 'positive' | 'danger' | 'muted';

export interface ResourceRow {
  label: string;
  value: string;
  tone?: 'positive' | 'danger' | 'warning' | null;
}

export interface ResourceEntry {
  id: EconomyResource;
  name: string;
  /** Theme icon id (RESOURCE_DISPLAY.icon) and colour class (.res-*). */
  icon: string;
  colorClass: string;
  value: number;
  /** Full value text ("2,82,000" or "8,200 / 12,000"). */
  text: string;
  /** Compact text for phones ("2.82L"). */
  compact: string;
  trend: number;
  /** "+120/d", "-12/d", "+340/mo" ('' = none). */
  trendText: string;
  trendTone: TrendTone;
  /** Idle-builders badge (labor) / null. */
  badge: number | null;
  tooltipTitle: string;
  rows: ResourceRow[];
  hint: string;
}

export interface DateBlock {
  date: string;
  season: Season;
  seasonName: string;
  seasonEnglish: string;
  seasonIcon: string;
  weather: WeatherKind;
  weatherLabel: string;
  weatherIcon: string;
  /** "Monsoon forecast: strong rains (1.15)" during month 3, else null. */
  forecast: string | null;
  forecastTone: 'positive' | 'warning' | 'danger' | null;
}

const WEATHER_ICON: Readonly<Record<WeatherKind, string>> = {
  clear: 'w_clear',
  hazy: 'w_haze',
  cloudy: 'w_cloud',
  overcast: 'w_cloud',
  light_rain: 'w_rain',
  monsoon_rain: 'w_rain',
  storm: 'w_storm',
  dust_storm: 'w_dust',
  fog: 'w_haze',
};

const WEATHER_LABEL: Readonly<Record<WeatherKind, string>> = {
  clear: 'Clear skies',
  hazy: 'Hazy',
  cloudy: 'Cloudy',
  overcast: 'Overcast',
  light_rain: 'Light rain',
  monsoon_rain: 'Monsoon rain',
  storm: 'Storm',
  dust_storm: 'Dust storm',
  fog: 'Fog',
};

/** Monsoon forecast wording (§7.3.3: < 0.7 failed, > 1.2 flood). */
export function forecastText(m: number): { text: string; tone: 'positive' | 'warning' | 'danger' } {
  if (m < 0.7) return { text: `Monsoon forecast: the rains may fail (${m.toFixed(2)})`, tone: 'danger' };
  if (m < 0.9) return { text: `Monsoon forecast: weak rains (${m.toFixed(2)})`, tone: 'warning' };
  if (m <= 1.2) return { text: `Monsoon forecast: good rains (${m.toFixed(2)})`, tone: 'positive' };
  return { text: `Monsoon forecast: heavy rains, flood risk (${m.toFixed(2)})`, tone: 'warning' };
}

export function dateBlock(world: Readonly<WorldState>): DateBlock {
  const season = seasonOf(world.calendar);
  const sn = SEASON_NAMES[season];
  const fc = world.monsoon?.forecast ?? null;
  const f = fc !== null ? forecastText(fc) : null;
  return {
    date: formatDate(world.calendar),
    season,
    seasonName: sn.name,
    seasonEnglish: sn.english,
    seasonIcon: `season_${season}`,
    weather: world.weather.kind,
    weatherLabel: WEATHER_LABEL[world.weather.kind],
    weatherIcon: WEATHER_ICON[world.weather.kind],
    forecast: f?.text ?? null,
    forecastTone: f?.tone ?? null,
  };
}

function trendTone(v: number): TrendTone {
  return v > 0.5 ? 'positive' : v < -0.5 ? 'danger' : 'muted';
}

/** Settlements of a faction whose builders stand idle (construction share > 0, empty queue). */
export function idleBuilderSettlements(world: Readonly<WorldState>, factionId: FactionId): string[] {
  const out: string[] = [];
  for (const id of Object.keys(world.settlements).sort()) {
    const s = world.settlements[id]!;
    if (s.ownerFactionId !== factionId) continue;
    if (s.laborAllocation.construction > 0.001 && s.construction.length === 0 && s.labor * s.laborAllocation.construction >= 1) out.push(id);
  }
  return out;
}

/** The six-resource bar of a faction (DESIGN_SPEC §8.1 table). */
export function resourceBar(world: Readonly<WorldState>, factionId: FactionId): ResourceEntry[] {
  const w = world as WorldState;
  const f = w.factions[factionId];
  const owned = Object.keys(w.settlements)
    .sort()
    .map((id) => w.settlements[id]!)
    .filter((s) => s.ownerFactionId === factionId);
  // Grain
  let stored = 0;
  let net = 0;
  const reserve: { name: string; days: number }[] = [];
  for (const s of owned) {
    stored += s.foodStored;
    net += settlementFoodBalance(w, s).net;
    reserve.push({ name: s.name, days: reserveDays(s) });
  }
  let armyNeed = 0;
  for (const id of Object.keys(w.armies).sort()) {
    const a = w.armies[id]!;
    if (a.factionId !== factionId || a.status === 'garrisoned' || a.status === 'disbanded') continue;
    armyNeed += armyFoodNeed(w, a);
  }
  const grainTotal = stored + (f?.foodReserve ?? 0);
  const grainNet = net - armyNeed;
  reserve.sort((a, b) => a.days - b.days);
  // Materials
  let timberDay = 0;
  let stoneDay = 0;
  const timberSrc: string[] = [];
  const stoneSrc: string[] = [];
  let timberCommitted = 0;
  let stoneCommitted = 0;
  let jobs = 0;
  for (const s of owned) {
    const m = materialsProduction(w, s);
    timberDay += m.timber;
    stoneDay += m.stone;
    if (m.timber > 0.05) timberSrc.push(`${s.name} +${m.timber.toFixed(1)}`);
    if (m.stone > 0.05) stoneSrc.push(`${s.name} +${m.stone.toFixed(1)}`);
    for (const j of s.construction) {
      jobs++;
      timberCommitted += j.paid.timber * (1 - j.progress);
      stoneCommitted += j.paid.stone * (1 - j.progress);
    }
  }
  // Labor
  const alloc = { farming: 0, construction: 0, crafts: 0, military: 0 };
  let labor = 0;
  for (const s of owned) {
    labor += s.labor;
    alloc.farming += s.labor * s.laborAllocation.farming;
    alloc.construction += s.labor * s.laborAllocation.construction;
    alloc.crafts += s.labor * s.laborAllocation.crafts;
    alloc.military += s.labor * s.laborAllocation.military;
  }
  const idle = idleBuilderSettlements(w, factionId);
  // Recruits
  let pool = 0;
  let cap = 0;
  let regen = 0;
  for (const s of owned) {
    pool += s.recruitPool;
    cap += s.recruitmentPotential;
    regen += Math.max(0, Math.min(s.recruitmentPotential - s.recruitPool, s.recruitmentPotential * RULES.recruitment.regenPerMonth * (0.5 + 0.5 * s.loyalty) * (1 / Math.max(0.5, s.grainPrice)) * stageEffect(s).recruitment));
  }
  let soldiers = 0;
  for (const id of Object.keys(w.armies)) {
    const a = w.armies[id]!;
    if (a.factionId === factionId) for (const u of a.units) soldiers += u.soldiers;
  }
  const projected = f ? projectLedger(w, factionId) : null;
  const ledger = f?.ledger ?? null;

  const out: ResourceEntry[] = [];
  for (const id of RESOURCE_BAR_ORDER) {
    const d = RESOURCE_DISPLAY[id];
    const base = { id, name: d.name, icon: d.icon, colorClass: `res-${id}`, badge: null as number | null, tooltipTitle: `${d.name} (${d.aoeAnalogue})` };
    switch (id) {
      case 'grain':
        out.push({
          ...base,
          value: grainTotal,
          text: fmtInt(grainTotal),
          compact: fmtCompact(grainTotal),
          trend: grainNet,
          trendText: `${fmtSigned(grainNet)}/d`,
          trendTone: trendTone(grainNet),
          rows: [
            ...reserve.slice(0, 3).map((r) => ({ label: r.name, value: fmtDays(r.days), tone: r.days < 30 ? ('danger' as const) : r.days < 60 ? ('warning' as const) : null })),
            { label: 'Royal reserve', value: fmtInt(f?.foodReserve ?? 0) },
            { label: 'Armies need', value: `${fmtSigned(-armyNeed)} / day`, tone: armyNeed > 0 ? 'danger' : null },
          ],
          hint: grainNet < 0 ? 'Why is this red? Stores fall each day: settlements and armies eat more than the fields bring in.' : 'Reserve days per settlement (worst three), the royal reserve and what the armies eat.',
        });
        break;
      case 'timber':
        out.push({
          ...base,
          value: f?.materials.timber ?? 0,
          text: fmtInt(f?.materials.timber ?? 0),
          compact: fmtCompact(f?.materials.timber ?? 0),
          trend: timberDay,
          trendText: timberDay > 0.05 ? `${fmtSigned(timberDay, Math.abs(timberDay) >= 10 ? 0 : 1)}/d` : '',
          trendTone: trendTone(timberDay),
          rows: [...(timberSrc.length ? timberSrc.slice(0, 4).map((t) => ({ label: t.split(' +')[0]!, value: `+${t.split(' +')[1]}/d` })) : [{ label: 'Producing', value: 'none (build Workshops)', tone: 'warning' as const }]), { label: 'Committed to building', value: fmtInt(timberCommitted) }],
          hint: `Workshops cut ${BUILDINGS.workshop.produces?.timber ?? 0} loads a day per level near forests.`,
        });
        break;
      case 'stone':
        out.push({
          ...base,
          value: f?.materials.stone ?? 0,
          text: fmtInt(f?.materials.stone ?? 0),
          compact: fmtCompact(f?.materials.stone ?? 0),
          trend: stoneDay,
          trendText: stoneDay > 0.05 ? `${fmtSigned(stoneDay, Math.abs(stoneDay) >= 10 ? 0 : 1)}/d` : '',
          trendTone: trendTone(stoneDay),
          rows: [...(stoneSrc.length ? stoneSrc.slice(0, 4).map((t) => ({ label: t.split(' +')[0]!, value: `+${t.split(' +')[1]}/d` })) : [{ label: 'Producing', value: 'none (build a Quarry)', tone: 'warning' as const }]), { label: 'Committed to building', value: fmtInt(stoneCommitted) }],
          hint: 'Quarries need a stone, iron or copper deposit.',
        });
        break;
      case 'wealth': {
        const pnet = projected?.net ?? 0;
        out.push({
          ...base,
          value: f?.treasury ?? 0,
          text: fmtInt(f?.treasury ?? 0),
          compact: fmtCompact(f?.treasury ?? 0),
          trend: pnet,
          trendText: `${fmtSigned(pnet)}/mo`,
          trendTone: trendTone(pnet),
          rows: [
            { label: 'Last month', value: fmtSigned(ledger?.net ?? 0), tone: (ledger?.net ?? 0) < 0 ? 'danger' : 'positive' },
            { label: 'Taxes (projected)', value: fmtInt(projected?.taxIncome ?? 0) },
            { label: 'Trade (projected)', value: fmtInt(projected?.tradeIncome ?? 0) },
            { label: 'Army upkeep', value: fmtSigned(-(projected?.armyUpkeep ?? 0)), tone: 'danger' },
            { label: 'Projection', value: fmtSigned(pnet), tone: pnet < 0 ? 'danger' : 'positive' },
          ],
          hint: 'Open Economy for the full ledger, tax policy and the royal reserve.',
        });
        break;
      }
      case 'labor':
        out.push({
          ...base,
          value: labor,
          text: fmtInt(labor),
          compact: fmtCompact(labor),
          trend: 0,
          trendText: '',
          trendTone: 'muted',
          badge: idle.length > 0 ? idle.length : null,
          rows: [
            { label: 'Farming', value: fmtInt(alloc.farming) },
            { label: 'Construction', value: fmtInt(alloc.construction) },
            { label: 'Crafts', value: fmtInt(alloc.crafts) },
            { label: 'Military', value: fmtInt(alloc.military) },
            { label: 'Idle builders', value: idle.length ? `${idle.length} settlement${idle.length > 1 ? 's' : ''}` : 'none', tone: idle.length ? 'warning' : null },
          ],
          hint: idle.length ? `${jobs} jobs under way. Tap the badge or press . to visit idle builders.` : `${jobs} construction jobs under way.`,
        });
        break;
      case 'manpower':
        out.push({
          ...base,
          value: pool,
          text: fmtInt(pool),
          compact: fmtCompact(pool),
          trend: regen,
          trendText: regen > 0.5 ? `${fmtSigned(regen)}/mo` : '',
          trendTone: trendTone(regen),
          rows: [
            { label: 'Recruits ready', value: fmtInt(pool) },
            { label: 'Pool limit', value: fmtInt(cap) },
            { label: 'Refill per month', value: fmtSigned(regen) },
            { label: 'Soldiers under arms', value: fmtInt(soldiers) },
            { label: 'Upkeep per month', value: fmtSigned(-(projected?.armyUpkeep ?? 0)), tone: 'danger' },
          ],
          hint: 'Famine, high grain prices and unrest slow the refill.',
        });
        break;
    }
  }
  return out;
}

/** Phone collapsed bar: Grain / Wealth / Recruits (+ expand chevron). */
export const PHONE_RESOURCES: readonly EconomyResource[] = ['grain', 'wealth', 'manpower'];
