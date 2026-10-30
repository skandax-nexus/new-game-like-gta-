/**
 * WP7 effect artifacts on the SHIPPED atlases (TA-07 rework round 2). OWNER: Technical Artist G (TA-07).
 *
 * The Art Director's round-2 blockers, re-measured on what the runtime actually loads (decoded published WebP):
 *  - R2-B1 lit smoke / dust: lit as a medium - mean normal z >= 0.8 wherever alpha > 0.1 (soft, camera-facing
 *    normals; creased solid-looking normals made near-black pockets under golden light).
 *  - R2-B2 fx_fire: (a) no flat-topped glowing block - no frame has a straight top edge longer than 10 % of the frame
 *    width (the bake gates at 6 %); (b) gradient-mapped: every tier decodes with R = G = B exactly and the ramp has
 *    R >= G >= B, so no emitting texel can lean green or blue (lossy chroma blocks).
 *  - R2-B3 fx_weapon_trail: gradient-mapped + dithered - no long flat runs (contour bands) in the dim tail.
 *  - R2-B4 parry_flash: an open radial flash - no closed rim (closure), no 4- / 8-fold spoke symmetry.
 * Plus the runner's ramp helpers (tools/assets/publish.mjs flipbookRampProblems / flipbookChromaSpread).
 */
import { describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { ASSET_MANIFEST } from '../../src/assets/manifest';
import type { AssetEntry, FlipbookAssetEntry } from '../../src/assets/types';
import { rampColor } from '../../src/assets/loaders/flipbook';

const ROOT = resolve(__dirname, '..', '..');
const PUBLIC = join(ROOT, 'public', 'assets');
const assets = ASSET_MANIFEST.assets as unknown as Record<string, AssetEntry>;
const flipbook = (id: string): FlipbookAssetEntry => {
  const e = assets[id];
  if (!e || e.kind !== 'flipbook') throw new Error(`${id} is not a published flipbook`);
  return e as FlipbookAssetEntry;
};

interface Img {
  data: Buffer;
  width: number;
  height: number;
}
async function decode(url: string): Promise<Img> {
  const { data, info } = await sharp(join(PUBLIC, url)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** One frame's channel `ch` (0..3) as floats [0, 1], row-major fw x fh. */
function frameChannel(img: Img, cols: number, rows: number, k: number, ch: number): { v: Float32Array; fw: number; fh: number } {
  const fw = img.width / cols;
  const fh = img.height / rows;
  const x0 = (k % cols) * fw;
  const y0 = Math.floor(k / cols) * fh;
  const v = new Float32Array(fw * fh);
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) v[y * fw + x] = img.data[((y0 + y) * img.width + x0 + x) * 4 + ch]! / 255;
  return { v, fw, fh };
}

/**
 * Longest horizontal top edge (fraction of the frame width): pixels where v rises by more than `edge` from the pixel
 * above into an emitting pixel (> `lit`), +-1 row, joined into runs of adjacent columns (as _fxkit.straight_top_edge).
 */
function straightTopEdge(v: Float32Array, w: number, h: number, edge = 0.05, lit = 0.2): number {
  const up = new Uint8Array(w * h);
  for (let y = 0; y < h - 1; y++)
    for (let x = 0; x < w; x++) {
      const a = v[y * w + x]!;
      const b = v[(y + 1) * w + x]!;
      if (b - a > edge && b > lit) up[y * w + x] = 1;
    }
  let best = 0;
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x < w; x++) {
      const on = up[y * w + x] || (y > 0 && up[(y - 1) * w + x]) || (y < h - 1 && up[(y + 1) * w + x]);
      run = on ? run + 1 : 0;
      best = Math.max(best, run);
    }
  }
  return best / w;
}

describe('gradient-mapped books carry no chroma (R2-B2b, R2-B3)', () => {
  for (const id of ['fx_fire', 'fx_weapon_trail']) {
    it(`${id}: ramp is monotone R >= G >= B from black; every tier decodes with R = G = B`, async () => {
      const e = flipbook(id);
      const ramp = e.ramp;
      expect(ramp).not.toBeNull();
      expect(ramp!.length).toBeGreaterThanOrEqual(2);
      expect(ramp![0]).toEqual([0, 0, 0]);
      for (const c of ramp!) {
        expect(c[0]!).toBeGreaterThanOrEqual(c[1]!);
        expect(c[1]!).toBeGreaterThanOrEqual(c[2]!);
      }
      // shaded colour at every 8-bit v: never G > R or B > G
      for (let i = 0; i <= 255; i++) {
        const [r, g, b] = rampColor(ramp!, i / 255);
        expect(g).toBeLessThanOrEqual(r + 1e-9);
        expect(b).toBeLessThanOrEqual(g + 1e-9);
      }
      const seen = new Set<string>();
      for (const f of Object.values(e.maps.color)) {
        if (!f || seen.has(f.url)) continue;
        seen.add(f.url);
        const img = await decode(f.url);
        let bad = 0;
        for (let i = 0; i < img.width * img.height * 4; i += 4) if (img.data[i] !== img.data[i + 1] || img.data[i + 1] !== img.data[i + 2]) bad++;
        expect(bad, `${f.url}: texels with R != G or G != B`).toBe(0);
      }
    });
  }
});

describe('fx_fire has no flat-topped glowing blocks (R2-B2a)', () => {
  it('no frame of the ultra atlas has a straight top edge longer than 10 % of the frame width', async () => {
    const e = flipbook('fx_fire');
    const img = await decode(e.maps.color.ultra!.url);
    let worst = 0;
    let at = -1;
    for (let k = 0; k < e.cols * e.rows; k++) {
      const { v, fw, fh } = frameChannel(img, e.cols, e.rows, k, 0);
      const s = straightTopEdge(v, fw, fh);
      if (s > worst) [worst, at] = [s, k];
    }
    expect(worst, `frame ${at}`).toBeLessThanOrEqual(0.1);
  });
});

describe('lit smoke and dust are lit as a medium (R2-B1)', () => {
  for (const id of ['fx_smoke', 'fx_dust']) {
    it(`${id}: mean normal z >= 0.8 where alpha > 0.1 (ultra and mobile tiers)`, async () => {
      const e = flipbook(id);
      for (const tier of ['ultra', 'mobile'] as const) {
        const col = await decode(e.maps.color[tier]!.url);
        const nrm = await decode(e.maps.normal![tier]!.url);
        let sum = 0;
        let n = 0;
        for (let y = 0; y < nrm.height; y++)
          for (let x = 0; x < nrm.width; x++) {
            const cx = Math.min(col.width - 1, Math.floor(((x + 0.5) / nrm.width) * col.width));
            const cy = Math.min(col.height - 1, Math.floor(((y + 0.5) / nrm.height) * col.height));
            if (col.data[(cy * col.width + cx) * 4 + 3]! <= 0.1 * 255) continue;
            const i = (y * nrm.width + x) * 4;
            const nx = (nrm.data[i]! / 255) * 2 - 1;
            const ny = (nrm.data[i + 1]! / 255) * 2 - 1;
            const nz = (nrm.data[i + 2]! / 255) * 2 - 1;
            sum += nz / Math.max(Math.hypot(nx, ny, nz), 1e-6);
            n++;
          }
        expect(n).toBeGreaterThan(1000);
        expect(sum / n, `${id} ${tier}`).toBeGreaterThanOrEqual(0.8);
      }
    });
  }
});

describe('fx_weapon_trail is dithered, no contour bands (R2-B3)', () => {
  it('the dim tail of both trails has no long flat runs along the trail', async () => {
    const e = flipbook('fx_weapon_trail');
    const img = await decode(e.maps.color.ultra!.url);
    for (const name of ['trail', 'trail_wide']) {
      const s = e.sequences.find((q) => q.name === name)!;
      const { v, fw, fh } = frameChannel(img, e.cols, e.rows, s.start, 0);
      // rows across the ribbon's middle, u from 30 % to 85 % of the age (the dim tail)
      let runs = 0;
      let total = 0;
      let longest = 0;
      for (let y = Math.round(fh * 0.3); y < Math.round(fh * 0.7); y++) {
        let run = 1;
        for (let x = Math.round(fw * 0.3) + 1; x < Math.round(fw * 0.85); x++) {
          const a = v[y * fw + x]!;
          const b = v[y * fw + x - 1]!;
          if (a === b && a > 0) run++;
          else {
            runs++;
            total += run;
            longest = Math.max(longest, run);
            run = 1;
          }
        }
      }
      expect(total / Math.max(runs, 1), `${name}: mean flat run (px)`).toBeLessThan(2.5);
      expect(longest, `${name}: longest flat run (px)`).toBeLessThan(16);
    }
  });
});

describe('parry_flash is an open radial flash, not a wheel (R2-B4)', () => {
  it('no closed rim and no 4- / 8-fold spoke symmetry in any frame', async () => {
    const e = flipbook('fx_sparks_embers');
    const s = e.sequences.find((q) => q.name === 'parry_flash')!;
    expect(s.count).toBe(8);
    const img = await decode(e.maps.color.ultra!.url);
    let closure = 0;
    let symmetry = 0;
    for (let k = s.start; k < s.start + s.count; k++) {
      const r0 = frameChannel(img, e.cols, e.rows, k, 0);
      const g0 = frameChannel(img, e.cols, e.rows, k, 1);
      const b0 = frameChannel(img, e.cols, e.rows, k, 2);
      const { fw, fh } = r0;
      const v = r0.v.map((x, i) => Math.max(x, g0.v[i]!, b0.v[i]!));
      let max = 0;
      for (const x of v) max = Math.max(max, x);
      if (max <= 0) continue;
      const prof = new Float64Array(360);
      for (let rr = 0.3; rr < 0.85; rr += 0.02) {
        const cov = new Uint8Array(360);
        const seen = new Uint8Array(360);
        for (let y = 0; y < fh; y++)
          for (let x = 0; x < fw; x++) {
            const px = ((x + 0.5) / fw) * 2 - 1;
            const py = 1 - ((y + 0.5) / fh) * 2;
            const r = Math.hypot(px, py);
            const bin = Math.floor(((Math.atan2(py, px) + Math.PI) / (2 * Math.PI)) * 360) % 360;
            if (r > rr && r < rr + 0.02) {
              seen[bin] = 1;
              if (v[y * fw + x]! > 0.15 * max) cov[bin] = 1;
            }
          }
        const ns = seen.reduce((a, b) => a + b, 0);
        if (ns > 90) closure = Math.max(closure, cov.reduce((a, b) => a + b, 0) / ns);
      }
      for (let y = 0; y < fh; y++)
        for (let x = 0; x < fw; x++) {
          const px = ((x + 0.5) / fw) * 2 - 1;
          const py = 1 - ((y + 0.5) / fh) * 2;
          const r = Math.hypot(px, py);
          if (r > 0.15 && r < 0.7) prof[Math.floor(((Math.atan2(py, px) + Math.PI) / (2 * Math.PI)) * 360) % 360] += v[y * fw + x]!;
        }
      const dc = prof.reduce((a, b) => a + b, 0);
      const amp = (m: number): number => {
        let re = 0;
        let im = 0;
        for (let i = 0; i < 360; i++) {
          re += prof[i]! * Math.cos((2 * Math.PI * m * i) / 360);
          im -= prof[i]! * Math.sin((2 * Math.PI * m * i) / 360);
        }
        return Math.hypot(re, im);
      };
      if (dc > 0) symmetry = Math.max(symmetry, Math.max(amp(4), amp(8)) / dc);
    }
    expect(closure, 'share of angles lit at the best radius beyond the core (a ring ~1.0)').toBeLessThan(0.5);
    expect(symmetry, '4- / 8-fold angular power vs the mean (the old wheel: 0.37)').toBeLessThan(0.3);
  });
});

describe('runner ramp helpers (tools/assets/publish.mjs)', () => {
  it('flipbookRampProblems accepts a monotone ramp from black and rejects green / blue drift', async () => {
    // @ts-expect-error - plain ESM module without type declarations
    const pub = (await import('../../tools/assets/publish.mjs')) as {
      flipbookRampProblems: (r: unknown) => string[];
      flipbookChromaSpread: (d: Uint8Array, w: number, h: number, c: number, tol?: number) => { bad: number; worst: number };
    };
    expect(pub.flipbookRampProblems(null)).toEqual([]);
    expect(pub.flipbookRampProblems([[0, 0, 0], [0.8, 0.3, 0.05], [1, 0.9, 0.6]])).toEqual([]);
    expect(pub.flipbookRampProblems([[0, 0, 0], [0.5, 0.6, 0.1]]).join()).toMatch(/R >= G >= B/);
    expect(pub.flipbookRampProblems([[0, 0, 0], [0.5, 0.2, 0.3]]).join()).toMatch(/R >= G >= B/);
    expect(pub.flipbookRampProblems([[0.1, 0, 0], [1, 1, 1]]).join()).toMatch(/stop 0/);
    expect(pub.flipbookRampProblems([[0, 0, 0]]).join()).toMatch(/2\.\.33/);
    const grey = new Uint8Array([10, 10, 10, 255, 200, 200, 200, 0]);
    expect(pub.flipbookChromaSpread(grey, 2, 1, 4)).toEqual({ bad: 0, worst: 0 });
    const tinted = new Uint8Array([10, 11, 10, 255, 200, 200, 197, 0]);
    expect(pub.flipbookChromaSpread(tinted, 2, 1, 4)).toEqual({ bad: 2, worst: 3 });
  });
});
