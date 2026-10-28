/**
 * Deterministic heightfield + biome + river queries shared by sim AND render. Owned by the CTO.
 * Three-free, DOM-free. Uses only deterministic math (see core/math.ts).
 *
 * One continuous terrain function per seed (`TerrainGenerator`) defines the whole world. A `Heightfield`
 * samples a square window of it into grids:
 *   - the strategic REGION (6 km, 12 m cells),
 *   - BATTLE maps (1 km windows at 2 m cells, centered on the engagement location),
 *   - HERO maps (window around a settlement).
 * Because every window samples the same function, battle terrain matches the strategic map (GDD §5).
 *
 * Coordinates: world meters, +X east, +Z south. Region is centered at (0, 0).
 * Layout of the region (for designers): a major river crosses roughly west->east through the middle
 * with a northern tributary; plateau/escarpment country to the south-west (Deccan-like), hills to the
 * north-east, drier scrub to the west (frontier), wetter forests to the east.
 */
import type { Biome, FlattenPad, Rect, TerrainClass, TerrainPreset, TerrainQuery, TerrainSpec, Vec2, Vec3 } from '../types';
import { BIOMES } from '../types';
import { clamp01, dcos, dsin, lerp, smoothstep, TWO_PI } from '../math';
import { deriveSeed, Rng } from '../rng';
import { REGION_RESOLUTION, REGION_SIZE, WATER_LEVEL } from '../constants';
import { Noise2D } from './noise';

export const BIOME_INDEX: Readonly<Record<Biome, number>> = Object.freeze(
  Object.fromEntries(BIOMES.map((b, i) => [b, i])) as Record<Biome, number>,
);

/** Nominal region extent used for zone gradients (km) so local windows share the same zoning. */
const ZONE_KM = REGION_SIZE / 1000;

export interface RiverSample {
  /** Distance to the nearest river centerline (m). */
  dist: number;
  /** Half channel width at that point (m). */
  halfWidth: number;
  depth: number;
  /** Valley (floodplain) blend width beyond the channel (m). */
  valley: number;
  /** 0 = main river, 1 = tributary, -1 = none. */
  which: number;
}

/** Detail octaves added on top of the macro terrain, filtered by the sampling cell size. */
const DETAIL_OCTAVES: readonly { wl: number; amp: number }[] = [
  { wl: 48, amp: 0.9 },
  { wl: 22, amp: 0.45 },
  { wl: 10, amp: 0.22 },
  { wl: 5, amp: 0.1 },
];

/**
 * The continuous, infinite terrain function for a seed. Window-independent: only `seed`, `reliefMeters`,
 * `waterLevel`, `river`, `pads` and `detail` of the spec are used.
 */
export class TerrainGenerator {
  readonly seed: number;
  readonly relief: number;
  readonly waterLevel: number;
  readonly river: TerrainSpec['river'];
  readonly pads: readonly FlattenPad[];
  readonly detail: number;
  private readonly padHeights: Float64Array;

  private readonly nBase: Noise2D;
  private readonly nWarpA: Noise2D;
  private readonly nWarpB: Noise2D;
  private readonly nMaskA: Noise2D;
  private readonly nMaskB: Noise2D;
  private readonly nHills: Noise2D;
  private readonly nDetail: Noise2D;
  private readonly nRiver: Noise2D;
  private readonly nMoist: Noise2D;
  private readonly nForest: Noise2D;
  private readonly nFarm: Noise2D;

  // river parameters
  private readonly ca: number;
  private readonly sa: number;
  private readonly offset: number;
  private readonly a1: number;
  private readonly f1: number;
  private readonly p1: number;
  private readonly a2: number;
  private readonly f2: number;
  private readonly p2: number;
  private readonly junction: number;
  private readonly b1: number;
  private readonly g1: number;
  private readonly q1: number;
  private readonly junctionAcross: number;

  private readonly dTmp = { d: 0 };
  private readonly tmpRiver: RiverSample = { dist: Infinity, halfWidth: 0, depth: 0, valley: 0, which: -1 };

  constructor(spec: TerrainSpec) {
    this.seed = spec.seed >>> 0;
    this.relief = spec.reliefMeters;
    this.waterLevel = spec.waterLevel;
    this.river = spec.river;
    this.pads = spec.pads;
    this.detail = spec.detail;
    const s = this.seed;
    this.nBase = new Noise2D(deriveSeed(s, 'base'));
    this.nWarpA = new Noise2D(deriveSeed(s, 'warpA'));
    this.nWarpB = new Noise2D(deriveSeed(s, 'warpB'));
    this.nMaskA = new Noise2D(deriveSeed(s, 'maskA'));
    this.nMaskB = new Noise2D(deriveSeed(s, 'maskB'));
    this.nHills = new Noise2D(deriveSeed(s, 'hills'));
    this.nDetail = new Noise2D(deriveSeed(s, 'detail'));
    this.nRiver = new Noise2D(deriveSeed(s, 'river'));
    this.nMoist = new Noise2D(deriveSeed(s, 'moist'));
    this.nForest = new Noise2D(deriveSeed(s, 'forest'));
    this.nFarm = new Noise2D(deriveSeed(s, 'farm'));

    const rr = new Rng(deriveSeed(s, 'river-params'));
    this.ca = dcos(spec.river.angle);
    this.sa = dsin(spec.river.angle);
    this.offset = rr.range(-320, 220);
    const m = spec.river.meander;
    this.a1 = 380 * m;
    this.f1 = TWO_PI / 3400;
    this.p1 = rr.range(0, TWO_PI);
    this.a2 = 140 * m;
    this.f2 = TWO_PI / 1300;
    this.p2 = rr.range(0, TWO_PI);
    this.junction = rr.range(-1100, 1100);
    this.b1 = 260 * m;
    this.g1 = TWO_PI / 2600;
    this.q1 = rr.range(0, TWO_PI);
    this.junctionAcross = this.mainCenter(this.junction, this.dTmp);

    // Resolve pad heights from the pad-free macro terrain (identical for every window).
    this.padHeights = new Float64Array(spec.pads.length);
    for (let i = 0; i < spec.pads.length; i++) {
      const p = spec.pads[i] as FlattenPad;
      this.padHeights[i] = p.height ?? Math.max(this.baseHeight(p.x, p.z, 100), this.waterLevel + 1.2);
    }
  }

  /** Main river centerline offset (across-axis) at `along`, and its derivative. */
  private mainCenter(along: number, outD: { d: number }): number {
    const u3 = along / 700;
    const n = this.nRiver.noise1(u3);
    const dn = (this.nRiver.noise1(u3 + 0.01) - this.nRiver.noise1(u3 - 0.01)) / 0.02 / 700;
    outD.d = this.a1 * this.f1 * dcos(along * this.f1 + this.p1) + this.a2 * this.f2 * dcos(along * this.f2 + this.p2) + 50 * dn;
    return this.offset + this.a1 * dsin(along * this.f1 + this.p1) + this.a2 * dsin(along * this.f2 + this.p2) + 50 * n;
  }

  /** Distance + channel info of the nearest river. Returns a shared object (copy if you keep it). */
  riverAt(x: number, z: number): RiverSample {
    const out = this.tmpRiver;
    out.dist = Infinity;
    out.which = -1;
    out.halfWidth = 0;
    out.depth = 0;
    out.valley = 0;
    if (!this.river.enabled) return out;
    const along = x * this.ca + z * this.sa;
    const across = -x * this.sa + z * this.ca;
    const c = this.mainCenter(along, this.dTmp);
    const dc = this.dTmp.d;
    const dMain = Math.abs(across - c) / Math.sqrt(1 + dc * dc);
    const widthVar = 1 + 0.22 * this.nRiver.noise1(along / 900 + 40);
    out.dist = dMain;
    out.halfWidth = this.river.widthMeters * 0.5 * widthVar;
    out.depth = this.river.depthMeters;
    out.valley = 430;
    out.which = 0;
    if (this.river.tributary) {
      const cJ = this.junctionAcross;
      if (across < cJ + 30) {
        const tAlong = this.junction + this.b1 * dsin(across * this.g1 + this.q1) - this.b1 * dsin(cJ * this.g1 + this.q1);
        const dt = this.b1 * this.g1 * dcos(across * this.g1 + this.q1);
        const dTrib = Math.abs(along - tAlong) / Math.sqrt(1 + dt * dt);
        // Fade in only north of the junction so the tributary ends at the main river.
        if (dTrib < dMain) {
          out.dist = dTrib;
          out.halfWidth = this.river.widthMeters * 0.22 * widthVar;
          out.depth = this.river.depthMeters * 0.45;
          out.valley = 210;
          out.which = 1;
        }
      }
    }
    return out;
  }

  /** Plateau mask 0..1 (south-west). */
  plateauMask(x: number, z: number): number {
    const xs = x / 1000;
    const zs = z / 1000;
    const raw = this.nMaskA.noise01(xs * 0.2 + 3.1, zs * 0.2 - 1.7) * 0.8 + (zs / ZONE_KM) * 0.85 - (xs / ZONE_KM) * 0.35;
    return smoothstep(0.52, 0.62, raw);
  }

  /** Hills mask 0..1 (north-east). */
  hillsMask(x: number, z: number): number {
    const xs = x / 1000;
    const zs = z / 1000;
    const raw = this.nMaskB.noise01(xs * 0.24 - 5.3, zs * 0.24 + 2.2) * 0.8 - (zs / ZONE_KM) * 0.75 + (xs / ZONE_KM) * 0.45;
    return smoothstep(0.42, 0.72, raw);
  }

  /**
   * Height before flatten pads. `minWavelength` (m) filters out detail octaves finer than the sampling
   * resolution (pass ~2.5 x cell size) to avoid aliasing.
   */
  baseHeight(x: number, z: number, minWavelength: number): number {
    const xs = x / 1000;
    const zs = z / 1000;
    const wx = xs + 0.55 * this.nWarpA.noise(xs * 0.3, zs * 0.3);
    const wz = zs + 0.55 * this.nWarpB.noise(xs * 0.3 + 7.1, zs * 0.3 - 3.3);
    let h = this.waterLevel + 9.5 + 8 * this.nBase.fbm(wx * 0.34, wz * 0.34, 4);

    const plateau = this.plateauMask(x, z);
    if (plateau > 0) {
      const top = this.relief * 0.42 + 4 * this.nHills.fbm(wx * 1.4 + 9, wz * 1.4, 2);
      h += plateau * top;
    }
    const hills = this.hillsMask(x, z);
    if (hills > 0) {
      h += hills * this.relief * 0.85 * this.nHills.ridged(wx * 0.9, wz * 0.9, 5);
    }
    // Medium detail (250 m .. 62 m) - always present.
    h += 2.2 * this.nDetail.fbm(xs * 4, zs * 4, 3);
    // Fine detail, filtered by resolution.
    if (this.detail > 0) {
      for (let i = 0; i < DETAIL_OCTAVES.length; i++) {
        const o = DETAIL_OCTAVES[i] as { wl: number; amp: number };
        if (o.wl < minWavelength) break;
        h += this.detail * o.amp * this.nDetail.noise(x / o.wl + i * 13.7, z / o.wl - i * 7.9);
      }
    }

    // River valley + channel.
    const r = this.riverAt(x, z);
    if (r.which >= 0) {
      const w = r.halfWidth;
      const v = 1 - smoothstep(w, w + r.valley, r.dist);
      if (v > 0) {
        const flood = this.waterLevel + 1.7 + 0.9 * this.nDetail.noise(xs * 3 + 50, zs * 3 - 20);
        h = lerp(h, flood, v * v * (3 - 2 * v));
      }
      if (r.dist < w + 60) {
        const t = r.dist / w;
        const prof = t < 1 ? this.waterLevel - r.depth * (1 - t * t) : this.waterLevel + (r.dist - w) * 0.06;
        if (prof < h) h = prof;
      } else if (h < this.waterLevel + 0.6) {
        // Keep stray land above water away from rivers (soft clamp).
        h = this.waterLevel + 0.6 + (h - this.waterLevel - 0.6) * 0.1;
      }
    } else if (h < this.waterLevel + 0.6) {
      h = this.waterLevel + 0.6 + (h - this.waterLevel - 0.6) * 0.1;
    }
    return h;
  }

  /** Final height including flatten pads. */
  height(x: number, z: number, minWavelength: number): number {
    let h = this.baseHeight(x, z, minWavelength);
    const pads = this.pads;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i] as FlattenPad;
      const dx = x - p.x;
      const dz = z - p.z;
      const outer = p.radius + p.falloff;
      const d2 = dx * dx + dz * dz;
      if (d2 >= outer * outer) continue;
      const w = 1 - smoothstep(p.radius, outer, Math.sqrt(d2));
      h = lerp(h, this.padHeights[i] as number, w);
    }
    return h;
  }

  /** 0..1 ground moisture (rivers, east wetter, west drier). */
  moisture(x: number, z: number, riverDist: number): number {
    const xs = x / 1000;
    const zs = z / 1000;
    let m = 0.42 + 0.42 * (1 - smoothstep(30, 1300, riverDist)) + 0.28 * this.nMoist.fbm(xs * 0.6, zs * 0.6, 3);
    m -= 0.32 * smoothstep(0, 0.5, -xs / ZONE_KM);
    m += 0.22 * smoothstep(0, 0.5, xs / ZONE_KM);
    return clamp01(m);
  }

  /** 0..1 forest density noise (~800 m blobs). */
  forestNoise(x: number, z: number): number {
    return this.nForest.fbm(x / 800, z / 800, 3) * 0.5 + 0.5;
  }

  /** 0..1 field patchwork noise (~300 m). */
  farmNoise(x: number, z: number): number {
    return this.nFarm.noise01(x / 300, z / 300);
  }

  /** 0..1 how strongly settlement pads encourage farmland at (x, z). */
  padInfluence(x: number, z: number): number {
    let best = 0;
    for (let i = 0; i < this.pads.length; i++) {
      const p = this.pads[i] as FlattenPad;
      const dx = x - p.x;
      const dz = z - p.z;
      const r = p.radius;
      const d2 = dx * dx + dz * dz;
      const outer = r * 6 + 120;
      if (d2 >= outer * outer) continue;
      const v = 1 - smoothstep(r * 1.2, outer, Math.sqrt(d2));
      if (v > best) best = v;
    }
    return best;
  }

  /** Biome classification for a sample. */
  classify(x: number, z: number, h: number, slope: number, moisture: number): Biome {
    const wl = this.waterLevel;
    const r = this.riverAt(x, z);
    if (h < wl) return 'river';
    if (r.which >= 0 && r.dist < r.halfWidth + 24 && h < wl + 1.3) return 'sandbank';
    if (slope > 0.55) return 'rocky';
    const plateau = this.plateauMask(x, z);
    if (plateau > 0.85 && slope < 0.14 && h > wl + this.relief * 0.3) return 'plateau';
    if (slope > 0.24 || h > wl + this.relief * 0.45) return 'hills';
    if (moisture > 0.8 && h < wl + 2.0) return 'marsh';
    const fertile = moisture * (1 - slope * 3);
    const farm = this.farmNoise(x, z);
    const pad = this.padInfluence(x, z);
    if (pad > 0 && fertile > 0.38 && farm > 0.62 - pad * 0.75) return 'farmland';
    const valley = r.which >= 0 ? 1 - smoothstep(r.halfWidth, r.halfWidth + r.valley, r.dist) : 0;
    if (valley > 0.35 && fertile > 0.5 && farm > 0.58) return 'farmland';
    const forest = this.forestNoise(x, z) + moisture * 0.6;
    if (forest > 1.18) return 'dense_forest';
    if (forest > 0.98) return 'forest';
    if (valley > 0.55) return 'floodplain';
    if (moisture < 0.3) return 'dry_plain';
    if (moisture < 0.44) return 'scrub';
    return 'grassland';
  }
}

// -------------------------------------------------------------------------------------------------
// Heightfield (grid window)
// -------------------------------------------------------------------------------------------------

const BIOME_FERTILITY: Readonly<Record<Biome, number>> = {
  river: 0,
  floodplain: 1,
  farmland: 1,
  grassland: 0.75,
  scrub: 0.4,
  dry_plain: 0.3,
  forest: 0.5,
  dense_forest: 0.35,
  hills: 0.25,
  rocky: 0.05,
  plateau: 0.45,
  sandbank: 0.2,
  marsh: 0.3,
};

export class Heightfield implements TerrainQuery {
  readonly spec: TerrainSpec;
  readonly bounds: Rect;
  readonly resolution: number;
  readonly cellSize: number;
  /** Row-major heights: index = iz * resolution + ix. */
  readonly heights: Float32Array;
  /** BIOME_INDEX per sample. */
  readonly biomes: Uint8Array;
  /** Moisture 0..255 per sample. */
  readonly moistureGrid: Uint8Array;
  readonly minHeight: number;
  readonly maxHeight: number;
  readonly generator: TerrainGenerator;
  /** Detail cutoff used for this grid (m). */
  readonly minWavelength: number;

  private constructor(spec: TerrainSpec, gen: TerrainGenerator) {
    this.spec = spec;
    this.generator = gen;
    this.resolution = spec.resolution;
    this.cellSize = spec.sizeMeters / (spec.resolution - 1);
    const half = spec.sizeMeters / 2;
    this.bounds = { minX: spec.centerX - half, minZ: spec.centerZ - half, maxX: spec.centerX + half, maxZ: spec.centerZ + half };
    this.minWavelength = Math.max(4, this.cellSize * 2.5);
    const n = spec.resolution * spec.resolution;
    this.heights = new Float32Array(n);
    this.biomes = new Uint8Array(n);
    this.moistureGrid = new Uint8Array(n);

    const res = spec.resolution;
    let minH = Infinity;
    let maxH = -Infinity;
    for (let iz = 0; iz < res; iz++) {
      const z = this.bounds.minZ + iz * this.cellSize;
      for (let ix = 0; ix < res; ix++) {
        const x = this.bounds.minX + ix * this.cellSize;
        const h = gen.height(x, z, this.minWavelength);
        this.heights[iz * res + ix] = h;
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
      }
    }
    this.minHeight = minH;
    this.maxHeight = maxH;

    for (let iz = 0; iz < res; iz++) {
      const z = this.bounds.minZ + iz * this.cellSize;
      for (let ix = 0; ix < res; ix++) {
        const x = this.bounds.minX + ix * this.cellSize;
        const i = iz * res + ix;
        const slope = this.gridSlope(ix, iz);
        const r = gen.riverAt(x, z);
        const m = gen.moisture(x, z, r.dist);
        this.moistureGrid[i] = Math.round(m * 255);
        this.biomes[i] = BIOME_INDEX[gen.classify(x, z, this.heights[i], slope, m)];
      }
    }
  }

  /** Generate a heightfield for a spec. Pure function of the spec. */
  static generate(spec: TerrainSpec): Heightfield {
    return new Heightfield(spec, new TerrainGenerator(spec));
  }

  private gridSlope(ix: number, iz: number): number {
    const res = this.resolution;
    const x0 = ix > 0 ? ix - 1 : ix;
    const x1 = ix < res - 1 ? ix + 1 : ix;
    const z0 = iz > 0 ? iz - 1 : iz;
    const z1 = iz < res - 1 ? iz + 1 : iz;
    const h = this.heights;
    const dhdx = (h[iz * res + x1] - h[iz * res + x0]) / ((x1 - x0) * this.cellSize || 1);
    const dhdz = (h[z1 * res + ix] - h[z0 * res + ix]) / ((z1 - z0) * this.cellSize || 1);
    return Math.sqrt(dhdx * dhdx + dhdz * dhdz);
  }

  inBounds(x: number, z: number): boolean {
    const b = this.bounds;
    return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
  }

  /** Grid coordinates (fractional) for a world position, clamped to the grid. */
  private gx(x: number): number {
    const g = (x - this.bounds.minX) / this.cellSize;
    return g < 0 ? 0 : g > this.resolution - 1 ? this.resolution - 1 : g;
  }
  private gz(z: number): number {
    const g = (z - this.bounds.minZ) / this.cellSize;
    return g < 0 ? 0 : g > this.resolution - 1 ? this.resolution - 1 : g;
  }

  /** World X of grid column ix. */
  worldX(ix: number): number {
    return this.bounds.minX + ix * this.cellSize;
  }
  /** World Z of grid row iz. */
  worldZ(iz: number): number {
    return this.bounds.minZ + iz * this.cellSize;
  }

  /** Bilinear height (clamped to bounds). THE canonical height query for sim and render placement. */
  heightAt(x: number, z: number): number {
    const fx = this.gx(x);
    const fz = this.gz(z);
    const res = this.resolution;
    let ix = Math.floor(fx);
    let iz = Math.floor(fz);
    if (ix >= res - 1) ix = res - 2;
    if (iz >= res - 1) iz = res - 2;
    const tx = fx - ix;
    const tz = fz - iz;
    const h = this.heights;
    const i = iz * res + ix;
    const h00 = h[i];
    const h10 = h[i + 1];
    const h01 = h[i + res];
    const h11 = h[i + res + 1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  /** Continuous height from the generator at full detail (for higher-res render meshes). */
  sampleExact(x: number, z: number): number {
    return this.generator.height(x, z, 4);
  }

  normalAt(x: number, z: number, out: Vec3): Vec3 {
    const e = this.cellSize;
    const dhdx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dhdz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    const inv = 1 / Math.sqrt(dhdx * dhdx + 1 + dhdz * dhdz);
    out.x = -dhdx * inv;
    out.y = inv;
    out.z = -dhdz * inv;
    return out;
  }

  slopeAt(x: number, z: number): number {
    const e = this.cellSize;
    const dhdx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dhdz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return Math.sqrt(dhdx * dhdx + dhdz * dhdz);
  }

  private nearestIndex(x: number, z: number): number {
    const ix = Math.round(this.gx(x));
    const iz = Math.round(this.gz(z));
    return iz * this.resolution + ix;
  }

  biomeAt(x: number, z: number): Biome {
    return BIOMES[this.biomes[this.nearestIndex(x, z)]] as Biome;
  }

  biomeIndexAt(x: number, z: number): number {
    return this.biomes[this.nearestIndex(x, z)];
  }

  moistureAt(x: number, z: number): number {
    return this.moistureGrid[this.nearestIndex(x, z)] / 255;
  }

  fertilityAt(x: number, z: number): number {
    const b = this.biomeAt(x, z);
    return clamp01(BIOME_FERTILITY[b] * (0.4 + 0.6 * this.moistureAt(x, z)) * (1 - this.slopeAt(x, z) * 2));
  }

  isWater(x: number, z: number): boolean {
    return this.heightAt(x, z) < this.spec.waterLevel;
  }

  waterDepthAt(x: number, z: number): number {
    const d = this.spec.waterLevel - this.heightAt(x, z);
    return d > 0 ? d : 0;
  }

  riverDistanceAt(x: number, z: number): number {
    return this.generator.riverAt(x, z).dist;
  }

  terrainClassAt(x: number, z: number): TerrainClass {
    const depth = this.waterDepthAt(x, z);
    if (depth > 1.2) return 'deep_water';
    if (depth > 0) return 'shallow_water';
    switch (this.biomeAt(x, z)) {
      case 'marsh':
        return 'marsh';
      case 'forest':
      case 'dense_forest':
        return 'forest';
      case 'farmland':
        return 'farmland';
      case 'hills':
      case 'plateau':
        return this.slopeAt(x, z) > 0.35 ? 'rough' : 'hills';
      case 'rocky':
        return 'rough';
      default:
        return 'open';
    }
  }
}

// -------------------------------------------------------------------------------------------------
// Spec helpers
// -------------------------------------------------------------------------------------------------

/** The strategic region spec for a seed (pads added later by world creation). */
export function createRegionTerrainSpec(seed: number, pads: FlattenPad[] = []): TerrainSpec {
  const rng = new Rng(deriveSeed(seed, 'region-spec'));
  return {
    seed: seed >>> 0,
    preset: 'region',
    sizeMeters: REGION_SIZE,
    resolution: REGION_RESOLUTION,
    centerX: 0,
    centerZ: 0,
    reliefMeters: 120,
    waterLevel: WATER_LEVEL,
    river: {
      enabled: true,
      widthMeters: 90,
      depthMeters: 6,
      meander: 0.85,
      tributary: true,
      angle: rng.range(-0.22, 0.22),
    },
    pads,
    detail: 0,
  };
}

/** A window of `base` (region) terrain, e.g. a battle or hero map. Same seed => matching terrain. */
export function createLocalTerrainSpec(
  base: TerrainSpec,
  centerX: number,
  centerZ: number,
  sizeMeters: number,
  resolution: number,
  preset: TerrainPreset,
): TerrainSpec {
  return {
    ...base,
    preset,
    centerX,
    centerZ,
    sizeMeters,
    resolution,
    pads: base.pads.map((p) => ({ ...p })),
    river: { ...base.river },
    detail: 1,
  };
}

/**
 * Pick a deterministic location in a region suited to a battle preset (skirmish maps).
 * Searches a coarse grid of the region interior with the continuous generator.
 */
export function findPresetSite(region: TerrainSpec, preset: TerrainPreset): Vec2 {
  const gen = new TerrainGenerator(region);
  const half = region.sizeMeters * 0.5 - 700;
  const steps = 40;
  let best: Vec2 = { x: 0, z: 0 };
  let bestScore = -Infinity;
  const rng = new Rng(deriveSeed(region.seed, 'site', preset));
  for (let iz = 0; iz <= steps; iz++) {
    for (let ix = 0; ix <= steps; ix++) {
      const x = -half + (2 * half * ix) / steps;
      const z = -half + (2 * half * iz) / steps;
      const h = gen.baseHeight(x, z, 100);
      const e = 40;
      const sx = (gen.baseHeight(x + e, z, 100) - gen.baseHeight(x - e, z, 100)) / (2 * e);
      const sz = (gen.baseHeight(x, z + e, 100) - gen.baseHeight(x, z - e, 100)) / (2 * e);
      const slope = Math.sqrt(sx * sx + sz * sz);
      const r = gen.riverAt(x, z);
      const rd = r.dist;
      const centerBias = -Math.sqrt(x * x + z * z) / region.sizeMeters;
      let score: number;
      switch (preset) {
        case 'river_crossing':
          score = r.which === 0 ? -Math.abs(rd) / 40 - slope * 10 : -1e9;
          break;
        case 'plains':
          score = -slope * 40 - gen.hillsMask(x, z) * 5 - gen.plateauMask(x, z) * 5 + Math.min(rd, 900) / 400;
          break;
        case 'hills':
          score = gen.hillsMask(x, z) * 4 + (h - region.waterLevel) / 40 - (rd < 300 ? 3 : 0);
          break;
        case 'forest_edge': {
          const f = gen.forestNoise(x, z) + gen.moisture(x, z, rd) * 0.6;
          score = -Math.abs(f - 1.0) * 10 - slope * 10 + (rd > 300 ? 0 : -2);
          break;
        }
        case 'plateau_fort': {
          const pm = gen.plateauMask(x, z);
          score = -Math.abs(pm - 0.5) * 6 - (rd < 400 ? 3 : 0);
          break;
        }
        case 'capital':
          score = rd > 150 && rd < 420 ? 4 - slope * 30 : -slope * 30 - rd / 500;
          break;
        default:
          score = -slope * 10;
      }
      score += centerBias * 1.5 + rng.next() * 0.05;
      if (score > bestScore) {
        bestScore = score;
        best = { x, z };
      }
    }
  }
  return best;
}
