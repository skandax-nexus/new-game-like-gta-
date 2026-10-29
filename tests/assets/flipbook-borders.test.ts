/**
 * Flipbook border guard on the SHIPPED atlases (TA-07 rework round 1). OWNER: Technical Artist G (TA-07).
 *
 * A particle quad shows its frame edge as a hard straight cut when the sprite touches it, so every frame's outer
 * 2 px must stay <= 2/255 (coverage for alpha books, emission for additive, both for premultiplied) on every edge
 * its sequence does not open (`openEdges`). lib/flipbook.py write() checks the source frames at bake time; this test
 * decodes every published tier atlas (after WebP compression: ringing, 4:2:0 chroma and bleed from a neighbouring
 * open-edge frame show up only there) and also exercises the runner's own check (tools/assets/publish.mjs
 * flipbookBorderProblems, which fails a publish) on synthetic atlases.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { ASSET_MANIFEST } from '../../src/assets/manifest';
import type { AssetEntry, FlipbookAssetEntry, FlipbookSequenceEntry } from '../../src/assets/types';

const ROOT = resolve(__dirname, '..', '..');
const PUBLIC = join(ROOT, 'public', 'assets');
const PX = 2;
const LIMIT = 2;
const EDGES = ['top', 'bottom', 'left', 'right'] as const;
const assets = ASSET_MANIFEST.assets as unknown as Record<string, AssetEntry>;
const flipbooks = Object.values(assets).filter((a): a is FlipbookAssetEntry => a.kind === 'flipbook');

type Signal = 'alpha' | 'rgb' | 'both';

/** Same rule as the runner: worst level on each closed edge strip of each frame a sequence uses. */
function problems(data: Uint8Array, width: number, height: number, cols: number, rows: number, seqs: readonly FlipbookSequenceEntry[], signal: Signal): string[] {
  const fw = width / cols;
  const fh = height / rows;
  const out: string[] = [];
  for (const s of seqs) {
    for (let k = s.start; k < s.start + s.count; k++) {
      const x0 = (k % cols) * fw;
      const y0 = Math.floor(k / cols) * fh;
      for (const edge of EDGES) {
        if (s.openEdges.includes(edge)) continue;
        const [sx, sy, sw, sh] =
          edge === 'top' ? [x0, y0, fw, PX] : edge === 'bottom' ? [x0, y0 + fh - PX, fw, PX] : edge === 'left' ? [x0, y0, PX, fh] : [x0 + fw - PX, y0, PX, fh];
        let worst = 0;
        for (let y = sy; y < sy + sh; y++)
          for (let x = sx; x < sx + sw; x++) {
            const i = (y * width + x) * 4;
            const a = data[i + 3]!;
            const e = Math.max(data[i]!, data[i + 1]!, data[i + 2]!);
            worst = Math.max(worst, signal === 'alpha' ? a : signal === 'rgb' ? e : Math.max(a, e));
          }
        if (worst > LIMIT) out.push(`frame ${k} (${s.name}) ${edge} edge ${worst}/255`);
      }
    }
  }
  return out;
}

describe('published flipbook atlases keep their frame borders clear', () => {
  it('there are flipbooks to check', () => {
    expect(flipbooks.length).toBeGreaterThanOrEqual(9);
  });
  for (const fb of flipbooks) {
    it(`${fb.id}: every tier, every closed edge <= ${LIMIT}/255 after encoding`, async () => {
      const files = new Map<string, number>();
      for (const map of ['color', 'emissive'] as const) {
        for (const f of Object.values(fb.maps[map] ?? {})) if (f) files.set(f.url, map === 'emissive' ? 1 : 0);
      }
      expect(files.size).toBeGreaterThan(0);
      for (const [url, emissive] of files) {
        const p = join(PUBLIC, url);
        expect(existsSync(p), url).toBe(true);
        const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        // additive books are stored without alpha (decoded as 255): their signal is the emission
        const signal: Signal = emissive || fb.blend === 'additive' ? 'rgb' : fb.blend === 'premultiplied' ? 'both' : 'alpha';
        const bad = problems(new Uint8Array(data), info.width, info.height, fb.cols, fb.rows, fb.sequences, signal);
        expect(bad, `${url}:\n${bad.slice(0, 8).join('\n')}`).toEqual([]);
      }
    });
  }
});

describe('atlas layout rule (tools/assets/publish.mjs flipbookLayoutProblems)', () => {
  /** Runs the runner's layout check in a child node process. */
  function layout(cols: number, rows: number, sequences: unknown): string[] {
    const code = `
      import('${join(ROOT, 'tools', 'assets', 'publish.mjs').replace(/\\/g, '/')}').then((m) => {
        process.stdout.write(JSON.stringify(m.flipbookLayoutProblems({ cols: ${cols}, rows: ${rows}, sequences: ${JSON.stringify(sequences)} })));
      });`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr);
    return JSON.parse(r.stdout) as string[];
  }

  it('an open edge against a closed neighbour fails; atlas borders and open-open seams pass', () => {
    const bolt = (k: number) => ({ name: `bolt${k}`, start: k, count: 1, openEdges: ['bottom'] });
    // the old 2 x 2 lightning: bolt0 / bolt1 strike into the closed tops of bolt2 / bolt3
    expect(layout(2, 2, [0, 1, 2, 3].map(bolt))).toEqual([
      'frame 0 (bolt0) bottom edge open meets frame 2 (bolt2) top edge closed',
      'frame 1 (bolt1) bottom edge open meets frame 3 (bolt3) top edge closed',
    ]);
    expect(layout(4, 1, [0, 1, 2, 3].map(bolt))).toEqual([]);
    const trail = [
      { name: 'noise', start: 0, count: 1, openEdges: ['top', 'bottom', 'left', 'right'] },
      { name: 'trail', start: 1, count: 1, openEdges: ['left'] },
      { name: 'noise_b', start: 2, count: 1, openEdges: ['top', 'bottom', 'left', 'right'] },
      { name: 'trail_wide', start: 3, count: 1, openEdges: ['left'] },
    ];
    expect(layout(2, 2, trail)).toEqual([]);
  });

  it('every published flipbook follows the layout rule', () => {
    for (const fb of flipbooks) expect(layout(fb.cols, fb.rows, fb.sequences), fb.id).toEqual([]);
  });
});

describe('runner check (tools/assets/publish.mjs flipbookBorderProblems)', () => {
  /** Runs the runner's function in a child node process on a synthetic 2 x 2 atlas of 8 px frames. */
  function runnerCheck(setup: string, sequences: unknown, signal: Signal): string[] {
    const code = `
      import('${join(ROOT, 'tools', 'assets', 'publish.mjs').replace(/\\/g, '/')}').then((m) => {
        const W = 16, H = 16, data = new Uint8Array(W * H * 4);
        const set = (x, y, r, g, b, a) => { const i = (y * W + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a; };
        ${setup}
        const out = m.flipbookBorderProblems(data, W, H, 4, { cols: 2, rows: 2, sequences: ${JSON.stringify(sequences)}, signal: '${signal}' });
        process.stdout.write(JSON.stringify(out));
      });`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr);
    return JSON.parse(r.stdout) as string[];
  }
  const four = (open: Record<number, string[]> = {}) =>
    [0, 1, 2, 3].map((k) => ({ name: `s${k}`, start: k, count: 1, openEdges: open[k] ?? [] }));

  it('clean frames pass; a 3/255 pixel in a closed edge fails with its frame and edge', () => {
    expect(runnerCheck('set(4, 4, 255, 255, 255, 255);', four(), 'alpha')).toEqual([]);
    // frame 2 = bottom-left; its top edge rows are y 8..9
    expect(runnerCheck('set(3, 9, 0, 0, 0, 3);', four(), 'alpha')).toEqual(['frame 2 (s2) top edge 3/255']);
    expect(runnerCheck('set(3, 9, 0, 0, 0, 2);', four(), 'alpha')).toEqual([]);
  });

  it('open edges are skipped; signals pick alpha / emission / both', () => {
    // frame 0 bright on the middle of its bottom edge (a ground-strike bolt): fine when that edge is open
    expect(runnerCheck('for (let x = 3; x < 6; x++) set(x, 7, 255, 255, 255, 255);', four({ 0: ['bottom'] }), 'rgb')).toEqual([]);
    expect(runnerCheck('for (let x = 3; x < 6; x++) set(x, 7, 255, 255, 255, 255);', four(), 'rgb')).toEqual(['frame 0 (s0) bottom edge 255/255']);
    // alpha books ignore the bled RGB of transparent pixels; additive books ignore alpha
    expect(runnerCheck('set(15, 15, 200, 200, 200, 0);', four(), 'alpha')).toEqual([]);
    expect(runnerCheck('set(15, 15, 0, 0, 0, 200);', four(), 'rgb')).toEqual([]);
    expect(runnerCheck('set(15, 15, 0, 0, 0, 200);', four(), 'both')).toEqual(['frame 3 (s3) bottom edge 200/255', 'frame 3 (s3) right edge 200/255']);
  });
});
