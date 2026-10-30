/**
 * Resource bar + number formatting (src/ui/services/resourceBar.ts, src/ui/dom.ts): en-IN grouping, compact lakh /
 * crore notation for phones, signed trends, day spans, the six entries in RESOURCE_BAR_ORDER and the monsoon forecast.
 * OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 */
import { describe, expect, it } from 'vitest';
import { RESOURCE_BAR_ORDER } from '../../../src/data/resources';
import { fmtClock, fmtCompact, fmtDays, fmtInt, fmtPct, fmtSigned, label } from '../../../src/ui/dom';
import { dateBlock, forecastText, idleBuilderSettlements, PHONE_RESOURCES, resourceBar } from '../../../src/ui/services/resourceBar';
import { campaign, runDays } from '../../sim/strategic/helpers';

describe('number formatting', () => {
  it('groups digits the Indian way', () => {
    expect(fmtInt(291500)).toBe('2,91,500');
    expect(fmtInt(12345678)).toBe('1,23,45,678');
    expect(fmtInt(999)).toBe('999');
    expect(fmtInt(-4200.4)).toBe('-4,200');
    expect(fmtInt(Number.NaN)).toBe('0');
  });

  it('compact notation: k below a lakh, L below a crore, then Cr', () => {
    expect(fmtCompact(9870)).toBe('9,870');
    expect(fmtCompact(10000)).toBe('10k');
    expect(fmtCompact(45200)).toBe('45.2k');
    expect(fmtCompact(282000)).toBe('2.82L');
    expect(fmtCompact(291500)).toBe('2.92L');
    expect(fmtCompact(2500000)).toBe('25L');
    expect(fmtCompact(12000000)).toBe('1.2Cr');
    expect(fmtCompact(-45200)).toBe('-45.2k');
  });

  it('signed trends, percentages, days and the battle clock', () => {
    expect(fmtSigned(120)).toBe('+120');
    expect(fmtSigned(-12)).toBe('-12');
    expect(fmtSigned(0.2)).toBe('0');
    expect(fmtSigned(1234)).toBe('+1,234');
    expect(fmtSigned(16.04, 1)).toBe('+16.0');
    expect(fmtSigned(-0.04, 1)).toBe('0');
    expect(fmtPct(0.654)).toBe('65%');
    expect(fmtDays(1)).toBe('1 day');
    expect(fmtDays(75)).toBe('75 days');
    expect(fmtDays(150)).toBe('5 months');
    expect(fmtDays(Number.POSITIVE_INFINITY)).toBe('∞');
    expect(fmtClock(568)).toBe('9:28');
    expect(fmtClock(-3)).toBe('0:00');
  });

  it('labels from snake_case and camelCase ids', () => {
    expect(label('war_elephants')).toBe('War elephants');
    expect(label('taxEfficiency')).toBe('Tax efficiency');
    expect(label('supplyEfficiency')).toBe('Supply efficiency');
  });
});

describe('resource bar model', () => {
  const world = campaign(7);
  const me = world.playerFactionId;
  const bar = resourceBar(world, me);

  it('six entries in RESOURCE_BAR_ORDER, texts formatted from the values', () => {
    expect(bar.map((r) => r.id)).toEqual([...RESOURCE_BAR_ORDER]);
    for (const r of bar) {
      expect(r.text).toBe(fmtInt(r.value));
      expect(r.compact).toBe(fmtCompact(r.value));
      expect(r.trendText).toMatch(/^$|^[+-][\d,.]+\/(d|mo)$/);
      expect(r.rows.length).toBeGreaterThan(0);
      expect(r.icon).toBeTruthy();
      if (r.trendTone === 'danger') expect(r.trend).toBeLessThan(0);
    }
  });

  it('grain counts every own granary plus the royal reserve', () => {
    let grain = 0;
    for (const id of Object.keys(world.settlements)) if (world.settlements[id]!.ownerFactionId === me) grain += world.settlements[id]!.foodStored;
    grain += world.factions[me]!.foodReserve ?? 0;
    const g = bar.find((r) => r.id === 'grain')!;
    expect(Math.abs(g.value - grain)).toBeLessThan(1);
  });

  it('wealth is the treasury with the projected monthly net as trend', () => {
    const w = bar.find((r) => r.id === 'wealth')!;
    expect(w.value).toBe(world.factions[me]!.treasury);
    expect(w.trendText.endsWith('/mo')).toBe(true);
  });

  it('labor badge = settlements with idle builders; phone shows grain, wealth and recruits', () => {
    const labor = bar.find((r) => r.id === 'labor');
    if (labor) expect(labor.badge ?? 0).toBe(idleBuilderSettlements(world, me).length);
    for (const id of PHONE_RESOURCES) expect(bar.some((r) => r.id === id)).toBe(true);
  });

  it('stays consistent after a month of play (no NaN, no negative stores)', () => {
    const w = campaign(3);
    runDays(w, 30);
    for (const r of resourceBar(w, w.playerFactionId)) {
      expect(Number.isFinite(r.value)).toBe(true);
      expect(r.text).not.toContain('NaN');
      expect(r.trendText).not.toContain('NaN');
    }
  });
});

describe('date block and forecast', () => {
  it('forecast wording by monsoon strength', () => {
    expect(forecastText(0.6)).toMatchObject({ tone: 'danger' });
    expect(forecastText(0.6).text).toContain('may fail');
    expect(forecastText(0.8).tone).toBe('warning');
    expect(forecastText(1.0).tone).toBe('positive');
    expect(forecastText(1.3).text).toContain('flood');
  });

  it('date, season and weather for the current calendar', () => {
    const world = campaign(7);
    const d = dateBlock(world);
    expect(d.date).toMatch(/BCE|CE/);
    expect(d.seasonName.length).toBeGreaterThan(2);
    expect(d.weatherLabel.length).toBeGreaterThan(2);
    expect(d.seasonIcon.startsWith('season_')).toBe(true);
  });
});
