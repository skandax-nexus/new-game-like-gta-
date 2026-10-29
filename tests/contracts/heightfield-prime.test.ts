/**
 * OWNER: Engine Developer - Contracts & Save Schema (CORE-01). primeHeightfield (GFX-02 Web-Worker hand-off):
 * a heightfield rebuilt from transferred grids must equal the generated one and seed the shared cache.
 */
import { describe, expect, it } from 'vitest';
import type { TerrainSpec } from '../../src/core/types';
import { Heightfield, createLocalTerrainSpec } from '../../src/core/terrain/heightfield';
import { clearHeightfieldCache, extractHeightfieldGrids, getHeightfield, heightfieldFromGrids, heightfieldTransferList, peekHeightfield, primeHeightfield, terrainKey, type HeightfieldGrids } from '../../src/core/terrain/cache';
import { resolveRegionTerrain } from '../../src/sim/strategic/world';

/** What a worker posts back: fresh copies of the grids (structured clone semantics). */
function viaWorker(spec: TerrainSpec): HeightfieldGrids {
  const g = extractHeightfieldGrids(Heightfield.generate(spec));
  return { heights: g.heights.slice(), biomes: g.biomes.slice(), moistureGrid: g.moistureGrid.slice(), minHeight: g.minHeight, maxHeight: g.maxHeight };
}

function battleSpec(res: number): TerrainSpec {
  const { terrain, sites } = resolveRegionTerrain();
  const s = sites.find((x) => x.id === 'setupur') ?? sites[0]!;
  return createLocalTerrainSpec(terrain, s.x, s.z, 1024, res, 'river_crossing');
}

describe('primeHeightfield', () => {
  it('a heightfield rebuilt from worker grids equals the generated one (every field and query)', () => {
    const spec = battleSpec(129);
    const generated = Heightfield.generate(spec);
    const primed = heightfieldFromGrids(spec, viaWorker(spec));
    expect(Object.keys(primed).sort()).toEqual(Object.keys(generated).sort());
    for (const k of ['resolution', 'cellSize', 'minHeight', 'maxHeight', 'minWavelength'] as const) expect(primed[k]).toBe(generated[k]);
    expect(primed.bounds).toEqual(generated.bounds);
    expect(primed.spec).toEqual(generated.spec);
    expect(Array.from(primed.heights)).toEqual(Array.from(generated.heights));
    expect(Array.from(primed.biomes)).toEqual(Array.from(generated.biomes));
    expect(Array.from(primed.moistureGrid)).toEqual(Array.from(generated.moistureGrid));
    expect(primed).toBeInstanceOf(Heightfield);
    const b = generated.bounds;
    const n = { x: 0, y: 0, z: 0 };
    const m = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 200; i++) {
      const x = b.minX + ((i * 37) % 200) * ((b.maxX - b.minX) / 200);
      const z = b.minZ + ((i * 91) % 200) * ((b.maxZ - b.minZ) / 200);
      expect(primed.heightAt(x, z)).toBe(generated.heightAt(x, z));
      expect(primed.biomeAt(x, z)).toBe(generated.biomeAt(x, z));
      expect(primed.terrainClassAt(x, z)).toBe(generated.terrainClassAt(x, z));
      expect(primed.moistureAt(x, z)).toBe(generated.moistureAt(x, z));
      expect(primed.riverDistanceAt(x, z)).toBe(generated.riverDistanceAt(x, z));
      expect(primed.isWater(x, z)).toBe(generated.isWater(x, z));
      expect(primed.normalAt(x, z, n)).toEqual(generated.normalAt(x, z, m));
    }
  });

  it('seeds the cache: getHeightfield returns the primed instance', () => {
    clearHeightfieldCache();
    const spec = battleSpec(65);
    expect(peekHeightfield(spec)).toBeNull();
    const primed = primeHeightfield(spec, viaWorker(spec));
    expect(peekHeightfield(spec)).toBe(primed);
    expect(getHeightfield(spec)).toBe(primed);
    // A copy of the spec (different object, same content) hits the same entry.
    expect(getHeightfield(JSON.parse(JSON.stringify(spec)) as TerrainSpec)).toBe(primed);
    // Priming again keeps the shared instance.
    expect(primeHeightfield(spec, viaWorker(spec))).toBe(primed);
    clearHeightfieldCache();
  });

  it('rejects grids that do not match the spec and lists transferable buffers', () => {
    const spec = battleSpec(65);
    const grids = viaWorker(spec);
    expect(heightfieldTransferList(grids)).toHaveLength(3);
    expect(() => heightfieldFromGrids({ ...spec, resolution: 129 }, grids)).toThrow(/samples/);
  });

  it('cache keys ignore key order and separate resolutions', () => {
    const spec = battleSpec(65);
    const reordered = Object.fromEntries(Object.entries(spec).reverse()) as unknown as TerrainSpec;
    expect(terrainKey(reordered)).toBe(terrainKey(spec));
    expect(terrainKey({ ...spec, resolution: 129 })).not.toBe(terrainKey(spec));
  });
});
