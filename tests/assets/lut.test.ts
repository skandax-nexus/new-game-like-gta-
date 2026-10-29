/**
 * Grading LUTs (TA-07 A4 / B5). OWNER: Technical Artist G (TA-07).
 * - The identity LUT reproduces every 8-bit RGB input (all 256^3) within 1/255 through the runtime decode path
 *   (strip -> Data3DTexture order) and the trilinear lookup the GPU performs (sampleLut mirrors the GLSL).
 * - The published strips use the three LUTImageLoader layout and the interim LUTs equal the lookdev grade math
 *   (render/post.ts GradeShader without vignette) applied to GRADE_PRESETS at every lattice point.
 * - All seven WP7 LUT ids are published.
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { ASSET_MANIFEST } from '../../src/assets/manifest';
import type { AssetEntry, LutAssetEntry } from '../../src/assets/types';
import { identityStrip, sampleLut, stripToVolume } from '../../src/assets/loaders/lut';
import { GRADE_PRESETS } from '../../src/render/style/palette';
import type { GradeParams } from '../../src/render/post';

const PUBLIC = join(__dirname, '..', '..', 'public', 'assets');
const WP7_LUTS = ['lut_dawn', 'lut_golden', 'lut_dusk', 'lut_night', 'lut_monsoon', 'lut_haze', 'lut_fog'];
const assets = ASSET_MANIFEST.assets as unknown as Record<string, AssetEntry>;

function lutEntry(id: string): LutAssetEntry | null {
  const e = assets[id];
  return e && e.kind === 'lut' ? e : null;
}

async function strip(e: LutAssetEntry): Promise<Uint8Array> {
  const f = e.files.ultra ?? e.files.high ?? e.files.mobile;
  if (!f) throw new Error(`${e.id}: no file`);
  const { data, info } = await sharp(join(PUBLIC, f.url)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  expect(info.width).toBe(e.size * e.size);
  expect(info.height).toBe(e.size);
  return new Uint8Array(data);
}

/** render/post.ts GradeShader (display space), vignette excluded. */
function grade(c: [number, number, number], g: GradeParams): [number, number, number] {
  let [r, gg, b] = [c[0] * g.tint[0], c[1] * g.tint[1], c[2] * g.tint[2]];
  r += g.warmth * 0.04 * (0.5 + r);
  gg += g.warmth * 0.012 * (0.5 + gg);
  b += -g.warmth * 0.04 * (0.5 + b);
  const l = r * 0.2126 + gg * 0.7152 + b * 0.0722;
  [r, gg, b] = [l + (r - l) * g.saturation, l + (gg - l) * g.saturation, l + (b - l) * g.saturation];
  [r, gg, b] = [(r - 0.5) * g.contrast + 0.5, (gg - 0.5) * g.contrast + 0.5, (b - 0.5) * g.contrast + 0.5];
  [r, gg, b] = [r + g.lift * (1 - r), gg + g.lift * (1 - gg), b + g.lift * (1 - b)];
  const cl = (v: number): number => Math.min(1, Math.max(0, v));
  return [cl(r), cl(gg), cl(b)];
}

describe('LUTs', () => {
  it('identity reproduces every 8-bit value within 1/255 (all 256^3 inputs)', () => {
    const n = 32;
    const vol = stripToVolume(identityStrip(n), n);
    // Exhaustive check with the same math as sampleLut, inlined for speed.
    const v = new Float32Array(vol.length);
    for (let i = 0; i < vol.length; i++) v[i] = vol[i]! / 255;
    let worst = 0;
    const idx = new Int32Array(256);
    const frac = new Float32Array(256);
    for (let k = 0; k < 256; k++) {
      const f = (k / 255) * (n - 1);
      idx[k] = Math.min(Math.floor(f), n - 2);
      frac[k] = f - idx[k]!;
    }
    for (let bi = 0; bi < 256; bi++) {
      const z0 = idx[bi]!;
      const tz = frac[bi]!;
      for (let gi = 0; gi < 256; gi++) {
        const y0 = idx[gi]!;
        const ty = frac[gi]!;
        for (let ri = 0; ri < 256; ri++) {
          const x0 = idx[ri]!;
          const tx = frac[ri]!;
          const base = ((z0 * n + y0) * n + x0) * 4;
          for (let c = 0; c < 3; c++) {
            const o = base + c;
            const sx = 4;
            const sy = n * 4;
            const sz = n * n * 4;
            const c00 = v[o]! * (1 - tx) + v[o + sx]! * tx;
            const c10 = v[o + sy]! * (1 - tx) + v[o + sy + sx]! * tx;
            const c01 = v[o + sz]! * (1 - tx) + v[o + sz + sx]! * tx;
            const c11 = v[o + sz + sy]! * (1 - tx) + v[o + sz + sy + sx]! * tx;
            const out = (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz;
            const want = (c === 0 ? ri : c === 1 ? gi : bi) / 255;
            const d = Math.abs(out - want);
            if (d > worst) worst = d;
          }
        }
      }
    }
    expect(worst * 255).toBeLessThanOrEqual(1);
    // sampleLut (the exported CPU reference) agrees on a few points.
    expect(sampleLut(vol, n, 0.5, 0.25, 1)[2]).toBeCloseTo(1, 2);
  });

  it('publishes the identity strip byte-exact in the three LUTImageLoader layout', async () => {
    const e = lutEntry('lut_identity');
    expect(e, 'lut_identity published').not.toBeNull();
    const got = await strip(e!);
    const want = identityStrip(e!.size);
    let diff = 0;
    for (let i = 0, j = 0; i < want.length; i += 4, j += 3) diff = Math.max(diff, Math.abs(got[j]! - want[i]!), Math.abs(got[j + 1]! - want[i + 1]!), Math.abs(got[j + 2]! - want[i + 2]!));
    expect(diff).toBe(0);
  });

  it('publishes all seven WP7 LUTs', () => {
    for (const id of WP7_LUTS) {
      const e = lutEntry(id);
      expect(e, id).not.toBeNull();
      expect(e!.size).toBe(32);
      expect(e!.layout).toBe('strip-horizontal');
      for (const f of Object.values(e!.files)) expect(existsSync(join(PUBLIC, f!.url)), f!.url).toBe(true);
    }
  });

  it('interim LUTs equal GRADE_PRESETS through the lookdev grade math (every lattice point)', async () => {
    for (const id of WP7_LUTS) {
      const e = lutEntry(id);
      if (!e || !e.source.startsWith('GRADE_PRESETS.')) continue;
      const preset = e.source.split('.')[1] as keyof typeof GRADE_PRESETS;
      const g = GRADE_PRESETS[preset];
      const px = await strip(e);
      const n = e.size;
      let worst = 0;
      for (let gi = 0; gi < n; gi++)
        for (let bi = 0; bi < n; bi++)
          for (let ri = 0; ri < n; ri++) {
            const want = grade([ri / (n - 1), gi / (n - 1), bi / (n - 1)], g);
            const o = (gi * n * n + bi * n + ri) * 3;
            for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(px[o + c]! / 255 - want[c]!));
          }
      expect(worst * 255, `${id} vs GRADE_PRESETS.${preset}`).toBeLessThanOrEqual(1);
    }
  });
});
