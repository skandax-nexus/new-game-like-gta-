/**
 * Deterministic settlement site resolution: turns hand-authored normalized positions (data/region.ts)
 * into buildable terrain sites + flatten pads. Owned by the CTO. Three-free.
 */
import type { FlattenPad, SettlementDef, SettlementKind, TerrainSpec, Vec2 } from '../types';
import { dcos, dsin, smoothstep, TWO_PI } from '../math';
import { TerrainGenerator } from './heightfield';

/** Ring directions for the waterfront bank scan (fixed, deterministic). */
const BANK_DIRS = 24;
const BANK_DIR_X = Array.from({ length: BANK_DIRS }, (_, k) => dsin((k / BANK_DIRS) * TWO_PI));
const BANK_DIR_Z = Array.from({ length: BANK_DIRS }, (_, k) => dcos((k / BANK_DIRS) * TWO_PI));

/** Flat pad radius (m) per settlement kind. Render layouts must fit inside radius + falloff/2. */
export const SETTLEMENT_PAD_RADIUS: Readonly<Record<SettlementKind, number>> = {
  village: 70,
  town: 110,
  city: 150,
  capital: 200,
  fort: 95,
  port: 110,
  temple_town: 110,
};

export const SETTLEMENT_PAD_FALLOFF = 70;

/**
 * Waterfront kinds - the port (harbor, docks) and the temple town (ghats) - keep their river bank inside the strategic
 * placement grid (sim/strategic/placement.ts: the square of half-size radius + 60 m around the centre, where shore
 * buildings must touch a cell within 20 m of water), so those buildings can be placed: the first water, with the
 * settlement's own flatten pad applied, lies between the pad edge and pad radius + WATERFRONT_BANK_MAX m.
 * Other kinds keep the original riverside preference (bank ~120 m beyond 0.6 x pad radius, clear of the pad falloff).
 */
export const WATERFRONT_KINDS: ReadonlySet<SettlementKind> = new Set<SettlementKind>(['port', 'temple_town']);
export const WATERFRONT_BANK_MAX = 48;
/** Preferred waterline distance beyond the pad radius (m): ghats and jetties at the edge of town, not under it. */
const WATERFRONT_BANK_WANT = 24;

export interface ResolvedSite {
  id: string;
  x: number;
  z: number;
  pad: FlattenPad;
}

/**
 * Resolve every settlement to a site near its (u, v) target honoring its `site` preference, keeping
 * a minimum spacing and avoiding water/steep ground. Order of `defs` matters (earlier = priority).
 */
export function resolveSettlementSites(
  spec: TerrainSpec,
  defs: readonly Pick<SettlementDef, 'id' | 'u' | 'v' | 'site' | 'kind'>[],
): ResolvedSite[] {
  const gen = new TerrainGenerator({ ...spec, pads: [] });
  const size = spec.sizeMeters;
  const half = size / 2;
  const placed: Vec2[] = [];
  const out: ResolvedSite[] = [];
  const step = 40;
  const searchR = 640;
  const waterLevel = spec.waterLevel;
  /**
   * Distance (m) from (cx, cz) to the nearest water of the pad-free terrain blended with this candidate's own flatten
   * pad (the same blend TerrainGenerator.height applies), sampled on rings out to `maxR`; Infinity if none.
   */
  const bankDistance = (cx: number, cz: number, padR: number, maxR: number): number => {
    const padH = Math.max(gen.baseHeight(cx, cz, 100), waterLevel + 1.2);
    const outer = padR + SETTLEMENT_PAD_FALLOFF;
    for (let r = padR + 8; r <= maxR; r += 8) {
      const w = 1 - smoothstep(padR, outer, r);
      for (let k = 0; k < BANK_DIRS; k++) {
        const x = cx + BANK_DIR_X[k]! * r;
        const z = cz + BANK_DIR_Z[k]! * r;
        const h = gen.baseHeight(x, z, 100);
        // 0.25 m below the waterline: the channel survives the region grid's interpolation, not just a wet film.
        if (h + (padH - h) * w < waterLevel - 0.25) return r;
      }
    }
    return Infinity;
  };
  for (const def of defs) {
    const tx = spec.centerX + (def.u - 0.5) * size;
    const tz = spec.centerZ + (def.v - 0.5) * size;
    const padR = SETTLEMENT_PAD_RADIUS[def.kind];
    const spacing = padR + 330;
    let bestX = tx;
    let bestZ = tz;
    let bestScore = -Infinity;
    // Pass 0 (waterfront kinds only): the bank inside the placement grid. Pass 1: the site preference alone - also the
    // fallback should no candidate within the search radius give a waterfront its bank (never seen on the shipped map).
    for (let pass = WATERFRONT_KINDS.has(def.kind) ? 0 : 1; pass < 2 && bestScore === -Infinity; pass++) {
      for (let oz = -searchR; oz <= searchR; oz += step) {
        for (let ox = -searchR; ox <= searchR; ox += step) {
          const d = Math.sqrt(ox * ox + oz * oz);
          if (d > searchR) continue;
          const x = tx + ox;
          const z = tz + oz;
          if (x < -half + 250 || x > half - 250 || z < -half + 250 || z > half - 250) continue;
          let tooClose = false;
          for (const p of placed) {
            const dx = p.x - x;
            const dz = p.z - z;
            if (dx * dx + dz * dz < spacing * spacing) {
              tooClose = true;
              break;
            }
          }
          if (tooClose) continue;
          const r = gen.riverAt(x, z);
          const riverDist = r.dist; // copy: riverAt() returns a shared object reused by baseHeight()
          const clearance = r.which >= 0 ? r.dist - r.halfWidth : Infinity;
          if (clearance < padR * 0.6 + 40) continue;
          const h = gen.baseHeight(x, z, 100);
          if (h < spec.waterLevel + 1) continue;
          const e = 30;
          const hx = gen.baseHeight(x + e, z, 100);
          const hz = gen.baseHeight(x, z + e, 100);
          const gx = (hx - h) / e;
          const gz = (hz - h) / e;
          const slope = Math.sqrt(gx * gx + gz * gz);
          let score = -d / 260 - slope * 55;
          if (pass === 0) {
            // The bank inside the placement grid, but the channel never under the flat pad (cheap river test first).
            if (clearance < padR || clearance > padR + WATERFRONT_BANK_MAX + 120) continue;
            const bank = bankDistance(x, z, padR, padR + WATERFRONT_BANK_MAX);
            if (bank === Infinity) continue;
            score += 3 - Math.abs(bank - (padR + WATERFRONT_BANK_WANT)) / 24;
          } else switch (def.site) {
            case 'riverside':
            case 'crossing': {
              const want = padR * 0.6 + 120;
              score += clearance < want + 160 ? 3 - Math.abs(clearance - want) / 90 : -2;
              break;
            }
            case 'hilltop':
              score += (h - spec.waterLevel) / 18 + gen.hillsMask(x, z) * 2 + gen.plateauMask(x, z) * 2;
              break;
            case 'forest_edge': {
              const f = gen.forestNoise(x, z) + gen.moisture(x, z, riverDist) * 0.6;
              score += 2 - Math.abs(f - 0.95) * 6;
              break;
            }
            case 'plain':
            default:
              score += gen.moisture(x, z, riverDist) * 2 - gen.hillsMask(x, z) * 2;
              break;
          }
          if (score > bestScore) {
            bestScore = score;
            bestX = x;
            bestZ = z;
          }
        }
      }
    }
    placed.push({ x: bestX, z: bestZ });
    out.push({
      id: def.id,
      x: bestX,
      z: bestZ,
      pad: { x: bestX, z: bestZ, radius: padR, falloff: SETTLEMENT_PAD_FALLOFF, height: null },
    });
  }
  return out;
}
