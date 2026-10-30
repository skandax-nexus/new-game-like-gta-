import { describe, expect, it } from 'vitest';
import { Heightfield, createLocalTerrainSpec, createRegionTerrainSpec, findPresetSite } from '../../src/core/terrain/heightfield';
import { resolveSettlementSites, SETTLEMENT_PAD_RADIUS, WATERFRONT_KINDS } from '../../src/core/terrain/sites';
import { traceRoad } from '../../src/core/terrain/roads';
import { fnv1a } from '../../src/core/save';
import { REGION } from '../../src/data/region';

function hashHeights(h: Heightfield): string {
  return fnv1a(Array.from(h.heights, (v) => v.toFixed(4)).join(',')) + fnv1a(Array.from(h.biomes).join(''));
}

describe('heightfield', () => {
  const spec = { ...createRegionTerrainSpec(1337), resolution: 129 };

  it('is deterministic for a spec', () => {
    const a = Heightfield.generate(spec);
    const b = Heightfield.generate(spec);
    expect(hashHeights(a)).toBe(hashHeights(b));
    expect(a.heightAt(123.4, -567.8)).toBe(b.heightAt(123.4, -567.8));
  });

  it('changes with the seed', () => {
    const a = Heightfield.generate(spec);
    const b = Heightfield.generate({ ...createRegionTerrainSpec(1338), resolution: 129 });
    expect(hashHeights(a)).not.toBe(hashHeights(b));
  });

  it('has a river, hills and dry land', () => {
    const h = Heightfield.generate({ ...spec, resolution: 257 });
    let water = 0;
    for (let i = 0; i < h.heights.length; i++) if (h.heights[i]! < spec.waterLevel) water++;
    const frac = water / h.heights.length;
    expect(frac).toBeGreaterThan(0.005);
    expect(frac).toBeLessThan(0.1);
    expect(h.maxHeight - h.minHeight).toBeGreaterThan(40);
    expect(h.riverDistanceAt(0, 0)).toBeLessThan(5000);
  });

  it('battle windows match the region terrain (same world function)', () => {
    const region = Heightfield.generate({ ...createRegionTerrainSpec(1337), resolution: 513 });
    const site = findPresetSite(region.spec, 'plains');
    const local = Heightfield.generate(createLocalTerrainSpec(region.spec, site.x, site.z, 512, 129, 'plains'));
    let maxDiff = 0;
    for (let i = 0; i < 50; i++) {
      const x = site.x - 200 + (i % 10) * 40;
      const z = site.z - 200 + Math.floor(i / 10) * 80;
      maxDiff = Math.max(maxDiff, Math.abs(region.heightAt(x, z) - local.heightAt(x, z)));
    }
    // Only fine detail octaves + grid interpolation differ.
    expect(maxDiff).toBeLessThan(4);
  });

  it('river crossing sites sit on a ford of the main river', () => {
    const r = createRegionTerrainSpec(1337);
    const site = findPresetSite(r, 'river_crossing');
    const local = Heightfield.generate(createLocalTerrainSpec(r, site.x, site.z, 1024, 129, 'river_crossing'));
    expect(local.riverDistanceAt(site.x, site.z)).toBeLessThan(150);
  });

  it('resolves settlement sites on dry, distinct ground and traces roads', () => {
    const sites = resolveSettlementSites(REGION.terrain, REGION.settlements);
    expect(sites.length).toBe(REGION.settlements.length);
    const h = Heightfield.generate({ ...REGION.terrain, resolution: 257, pads: sites.map((s) => s.pad) });
    for (const s of sites) expect(h.isWater(s.x, s.z)).toBe(false);
    for (let i = 0; i < sites.length; i++)
      for (let j = i + 1; j < sites.length; j++) expect(Math.hypot(sites[i]!.x - sites[j]!.x, sites[i]!.z - sites[j]!.z)).toBeGreaterThan(300);
    const a = sites[0]!;
    const b = sites[1]!;
    const road = traceRoad(h, a.x, a.z, b.x, b.z);
    expect(road.points[0]).toEqual({ x: a.x, z: a.z });
    expect(road.points[road.points.length - 1]).toEqual({ x: b.x, z: b.z });
    expect(road.length).toBeGreaterThanOrEqual(Math.hypot(a.x - b.x, a.z - b.z) - 1e-6);
  });

  it('waterfront settlements keep their bank inside the placement grid; the Pilgrim Ford is a river crossing', () => {
    const sites = resolveSettlementSites(REGION.terrain, REGION.settlements);
    const h = Heightfield.generate({ ...REGION.terrain, pads: sites.map((s) => s.pad) });
    const site = (id: string) => sites.find((s) => s.id === id)!;
    const waterfront = REGION.settlements.filter((d) => WATERFRONT_KINDS.has(d.kind));
    expect(waterfront.map((d) => d.id).sort()).toEqual(['naukapattana', 'tirthaghat']);
    for (const d of waterfront) {
      const s = site(d.id);
      // Nearest water (4 m scan) inside the strategic placement grid: half-size pad radius + 60 m.
      const reach = SETTLEMENT_PAD_RADIUS[d.kind] + 60;
      let nearest = Infinity;
      for (let dz = -reach; dz <= reach; dz += 4) for (let dx = -reach; dx <= reach; dx += 4) if (h.isWater(s.x + dx, s.z + dz)) nearest = Math.min(nearest, Math.hypot(dx, dz));
      expect(nearest, d.id).toBeGreaterThan(SETTLEMENT_PAD_RADIUS[d.kind]);
      expect(nearest, d.id).toBeLessThan(reach);
    }
    // DESIGN_SPEC §3.4: Tirthaghat - Ratnapura (track) fords the Rajavahini; Tirthaghat's roads to Setupur and
    // Nilavanapura stay on the south bank (no bridge besides the Setu).
    const cross = (a: string, b: string) => traceRoad(h, site(a).x, site(a).z, site(b).x, site(b).z).crossesWater;
    expect(cross('tirthaghat', 'ratnapura')).toBe(true);
    expect(cross('setupur', 'tirthaghat')).toBe(false);
    expect(cross('tirthaghat', 'nilavanapura')).toBe(false);
  });
});
