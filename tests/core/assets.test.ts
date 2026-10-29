/**
 * Content-pipeline manifest guard (OWNER: CTO + Technical Art Director): every manifest file is published
 * in public/assets with the recorded size, tier texture limits and payload budgets hold, and model
 * material bindings reference shipped texture sets. Regenerate assets with `npm run assets`.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ASSET_MANIFEST } from '../../src/assets/manifest';
import type { AssetEntry, AssetTier, TextureSetEntry } from '../../src/assets/types';
import { ASSET_TIERS } from '../../src/assets/types';
import { assetTierForQuality, parseAssetTier } from '../../src/assets/AssetManager';

const PUBLIC = join(__dirname, '..', '..', 'public', 'assets');
const MAX_TEXTURE: Record<AssetTier, number> = { ultra: 2048, high: 1024, mobile: 512 };
const BUDGET_MB: Record<AssetTier, number> = { ultra: 80, high: 40, mobile: 15 };
const assets = Object.values(ASSET_MANIFEST.assets) as AssetEntry[];

function setFiles(set: TextureSetEntry): { url: string; bytes: number; size: number; tier: AssetTier }[] {
  const out: { url: string; bytes: number; size: number; tier: AssetTier }[] = [];
  for (const tiers of Object.values(set.maps)) {
    if (!tiers) continue;
    for (const t of ASSET_TIERS) out.push({ ...tiers[t], tier: t });
  }
  return out;
}

describe('asset manifest', () => {
  it('maps quality tiers to asset tiers', () => {
    expect(assetTierForQuality('ultra')).toBe('ultra');
    expect(assetTierForQuality('high')).toBe('high');
    expect(assetTierForQuality('medium')).toBe('mobile');
    expect(assetTierForQuality('low')).toBe('mobile');
    expect(parseAssetTier('off')).toBe('off');
    expect(parseAssetTier('bogus')).toBeNull();
  });

  it('publishes every referenced file with the recorded size', () => {
    for (const a of assets) {
      const files: { url: string; bytes: number }[] = [];
      if (a.kind === 'material') files.push(...setFiles(a));
      if (a.kind === 'model') {
        files.push(...a.lods);
        for (const s of Object.values(a.sets)) files.push(...setFiles(s));
      }
      if (a.kind === 'hdri') files.push(...ASSET_TIERS.map((t) => a.files[t]));
      expect(files.length, a.id).toBeGreaterThan(0);
      for (const f of files) {
        const p = join(PUBLIC, f.url);
        expect(existsSync(p), `${a.id}: ${f.url}`).toBe(true);
        expect(statSync(p).size, `${a.id}: ${f.url}`).toBe(f.bytes);
        expect(f.bytes, `${f.url} exceeds the 8 MB single-file budget`).toBeLessThanOrEqual(8 * 1024 * 1024);
      }
    }
  });

  it('respects per-tier texture sizes and payload budgets', () => {
    for (const a of assets) {
      const sets: TextureSetEntry[] = a.kind === 'material' ? [a] : a.kind === 'model' ? Object.values(a.sets) : [];
      for (const s of sets) for (const f of setFiles(s)) expect(f.size, `${a.id} ${f.url}`).toBeLessThanOrEqual(MAX_TEXTURE[f.tier]);
    }
    for (const t of ASSET_TIERS) expect(ASSET_MANIFEST.totals[t] / 1048576).toBeLessThanOrEqual(BUDGET_MB[t]);
  });

  it('binds models only to shipped material sets', () => {
    for (const a of assets) {
      if (a.kind !== 'model') continue;
      for (const id of a.materialSets) expect(ASSET_MANIFEST.assets[id as keyof typeof ASSET_MANIFEST.assets]?.kind, `${a.id} -> ${id}`).toBe('material');
      expect(a.lods[0]?.lod).toBe(0);
      for (let i = 1; i < a.lods.length; i++) expect(a.lods[i]!.distance).toBeGreaterThan(a.lods[i - 1]!.distance);
    }
  });
});
