/**
 * Texture-set publish options and material manifest metadata (TA-01 requests, CTO desk). OWNER: CTO (pipeline,
 * with the Technical Art Director).
 *
 * - per-tier size map (`tierSizes`): ASSET_LIST §0.2 class T ships a 512 albedo on mobile, which `tierScale` alone
 *   cannot express (0.5 -> 1024 / 512 / 256);
 * - per-file `encoding` ('near_lossless' | 'lossless') for texture-set maps (terrain_grass_lush baseColor);
 * - baseColor alpha kept STRAIGHT when a file declares an alpha usage (puddle / standing-water masks): RGB and A are
 *   resized separately, so a mask never darkens the colour (sharp premultiplies RGBA resizes: terrain_mud_wet came
 *   out #1c1811 instead of #4f4636);
 * - channel usage, decal regions and material extras reach src/assets/manifest.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ASSET_MANIFEST } from '../../src/assets/manifest';
import { isDecalRegion, type MaterialAssetEntry } from '../../src/assets/types';

interface PublishModule {
  textureTierSize: (src: number, tier: string, opts?: { tierScale?: number; tierSizes?: Record<string, number> | null }) => number;
  channelUsage: (f: Record<string, unknown>) => Record<string, string> | null;
  textureEncodingFor: (map: string, encoding?: string | null) => Record<string, unknown>;
  publishTextureSet: (
    id: string,
    srcDir: string,
    files: Record<string, unknown>[],
    kindDir: string,
    setName: string | null,
    outFiles: { path: string }[],
  ) => Promise<{ maps: Record<string, Record<string, { path: string; size: number }>>; channels?: Record<string, Record<string, string>> }>;
}

let box = '';
let pub: PublishModule;

beforeAll(async () => {
  box = fs.mkdtempSync(path.join(os.tmpdir(), 'samrajya-publish-texture-'));
  // config.mjs reads the path overrides at import time: point PUBLIC_DIR at the sandbox before the first import.
  process.env.SAMRAJYA_ASSETS_PUBLIC = path.join(box, 'public');
  // @ts-expect-error - plain ESM module without type declarations
  pub = (await import('../../tools/assets/publish.mjs')) as PublishModule;
});

afterAll(() => {
  delete process.env.SAMRAJYA_ASSETS_PUBLIC;
  if (box) fs.rmSync(box, { recursive: true, force: true });
});

describe('texture tier sizes', () => {
  it('tierSizes expresses class T (albedo 1024 / 512 / 512); tierScale 0.5 cannot', () => {
    const T = { tierSizes: { ultra: 1024, high: 512, mobile: 512 } };
    expect(['ultra', 'high', 'mobile'].map((t) => pub.textureTierSize(1024, t, T))).toEqual([1024, 512, 512]);
    expect(['ultra', 'high', 'mobile'].map((t) => pub.textureTierSize(1024, t, { tierScale: 0.5 }))).toEqual([1024, 512, 256]);
    // absent tiers fall back to the scale rule; never above the source
    expect(pub.textureTierSize(1024, 'mobile', { tierScale: 0.5, tierSizes: { ultra: 1024 } })).toBe(256);
    expect(pub.textureTierSize(256, 'ultra', T)).toBe(256);
  });

  it('rejects sizes over the tier texture budget', () => {
    expect(() => pub.textureTierSize(2048, 'mobile', { tierSizes: { mobile: 1024 } })).toThrow(/exceeds the mobile limit/);
    expect(() => pub.textureTierSize(2048, 'high', { tierSizes: { high: 300.5 } })).toThrow(/positive integer/);
  });
});

describe('channel usage and encoding overrides', () => {
  it('reads red/green/blue/alpha usage names', () => {
    expect(pub.channelUsage({ role: 'orm', blue: 'decalOpacity' })).toEqual({ blue: 'decalOpacity' });
    expect(pub.channelUsage({ role: 'baseColor', alpha: 'puddleMask' })).toEqual({ alpha: 'puddleMask' });
    expect(pub.channelUsage({ role: 'normal' })).toBeNull();
    expect(() => pub.channelUsage({ role: 'orm', blue: 'decal opacity' })).toThrow(/camelCase/);
  });

  it('maps near_lossless / lossless and rejects unknown encodings', () => {
    expect(pub.textureEncodingFor('baseColor', 'near_lossless')).toMatchObject({ nearLossless: true, quality: 60, effort: 5 });
    expect(pub.textureEncodingFor('baseColor', 'lossless')).toMatchObject({ lossless: true });
    expect(pub.textureEncodingFor('baseColor', null)).toMatchObject({ quality: 88 });
    expect(() => pub.textureEncodingFor('baseColor', 'lossy_90')).toThrow(/unknown texture encoding/);
  });
});

describe('publishTextureSet with a straight alpha mask', () => {
  it('keeps the colour under a puddle mask at every tier and records the channel usage', async () => {
    const N = 512;
    const rgba = Buffer.alloc(N * N * 4);
    let aSum = 0;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = (y * N + x) * 4;
        // mud #4f4636 everywhere; alpha = puddles (blobs of 255 on 0), like terrain_mud_wet's lowest-height mask
        rgba[i] = 0x4f;
        rgba[i + 1] = 0x46;
        rgba[i + 2] = 0x36;
        const a = Math.sin(x * 0.05) * Math.cos(y * 0.07) > 0.35 ? 255 : 0;
        rgba[i + 3] = a;
        aSum += a;
      }
    const src = path.join(box, 'src');
    fs.mkdirSync(src, { recursive: true });
    await sharp(rgba, { raw: { width: N, height: N, channels: 4 } }).png().toFile(path.join(src, 'bc.png'));
    await sharp({ create: { width: N, height: N, channels: 3, background: { r: 200, g: 180, b: 30 } } }).png().toFile(path.join(src, 'orm.png'));
    const out: { path: string }[] = [];
    const set = await pub.publishTextureSet(
      'mask_test',
      src,
      [
        { role: 'baseColor', path: 'bc.png', alpha: 'puddleMask', tierSizes: { ultra: 512, high: 256, mobile: 256 } },
        { role: 'orm', path: 'orm.png', blue: 'decalOpacity', tierScale: 0.25, encoding: 'near_lossless' },
      ],
      'textures',
      null,
      out,
    );
    expect(set.channels).toEqual({ baseColor: { alpha: 'puddleMask' }, orm: { blue: 'decalOpacity' } });
    expect(Object.values(set.maps.baseColor ?? {}).map((f) => f.size)).toEqual([512, 256, 256]);
    expect(Object.values(set.maps.orm ?? {}).map((f) => f.size)).toEqual([512, 256, 128]);
    for (const size of [512, 256]) {
      const file = path.join(box, 'public', 'textures', 'mask_test', `baseColor_${size}.webp`);
      const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
      expect(info.channels, `${size}: alpha kept`).toBe(4);
      const n = info.width * info.height;
      const mean = [0, 0, 0, 0];
      for (let i = 0; i < n; i++) for (let c = 0; c < 4; c++) mean[c] += (data[i * 4 + c] ?? 0) / n;
      // straight alpha: the colour stays #4f4636 (premultiplied resize + removeAlpha gave ~#1c1811)
      expect(Math.abs(mean[0] - 0x4f), `${size} R`).toBeLessThan(2);
      expect(Math.abs(mean[1] - 0x46), `${size} G`).toBeLessThan(2);
      expect(Math.abs(mean[2] - 0x36), `${size} B`).toBeLessThan(2);
      expect(Math.abs(mean[3] - aSum / (N * N)), `${size} mask coverage`).toBeLessThan(3);
    }
    // a near-lossless ORM keeps its values (opacity in blue)
    const orm = await sharp(path.join(box, 'public', 'textures', 'mask_test', 'orm_128.webp')).raw().toBuffer({ resolveWithObject: true });
    expect(orm.info.channels).toBe(3);
    expect(Math.abs((orm.data[2] ?? 0) - 30)).toBeLessThan(3);
  });

  it('refuses an alpha usage on a source without alpha', async () => {
    const src = path.join(box, 'src');
    await expect(
      pub.publishTextureSet('mask_test_bad', src, [{ role: 'baseColor', path: 'orm.png', alpha: 'puddleMask' }], 'textures', null, []),
    ).rejects.toThrow(/no alpha channel/);
  });
});

describe('material manifest metadata', () => {
  const materials = Object.values(ASSET_MANIFEST.assets).filter((a): a is typeof a & MaterialAssetEntry => a.kind === 'material');

  it('every material carries decals; the decal atlas has regions and its opacity channel', () => {
    for (const m of materials) expect(Array.isArray(m.decals), m.id).toBe(true);
    const atlas = materials.find((m) => m.id === 'decals_settlement');
    if (!atlas) return; // asset not published in this checkout
    expect(atlas.decals.length).toBeGreaterThan(0);
    for (const d of atlas.decals) {
      expect(isDecalRegion(d), d.name).toBe(true);
      if (!isDecalRegion(d)) continue;
      expect(d.u1).toBeGreaterThan(d.u0);
      expect(d.v1).toBeGreaterThan(d.v0);
      expect(d.sizeMeters).toHaveLength(2);
    }
    expect(atlas.channels?.orm?.blue).toBe('decalOpacity');
    expect(atlas.decalAtlas?.opacity).toBe('orm.b');
  });

  it('ornament decals and layer metadata (projection, axes, ruts) are typed fields', () => {
    for (const m of materials)
      for (const d of m.decals) if (!isDecalRegion(d)) expect(d.r, `${m.id} ${d.name}`).toBeGreaterThan(0);
    for (const m of materials) if (m.projection !== undefined) expect(['uv', 'triplanar']).toContain(m.projection);
    const road = materials.find((m) => m.id === 'terrain_road_earth');
    if (road) expect(road.ruts?.gaugeMeters).toBeGreaterThan(0);
  });
});
