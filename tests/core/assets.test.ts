/**
 * Content-pipeline manifest guard (OWNER: Technical Artist G, TA-07 - CTO grant): every manifest file is
 * published in public/assets with the recorded size, tier texture limits and payload budgets hold, tier
 * control (@tiers / @fallback) is consistent, and model material bindings reference shipped texture sets.
 * Regenerate assets with `npm run assets -- <ids>`.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ASSET_MANIFEST } from '../../src/assets/manifest';
import type { AssetEntry, AssetTier, TextureSetEntry, TierMap } from '../../src/assets/types';
import { ASSET_KINDS, ASSET_TIERS } from '../../src/assets/types';
import { assetTierForQuality, parseAssetTier } from '../../src/assets/AssetManager';

const PUBLIC = join(__dirname, '..', '..', 'public', 'assets');
const MAX_TEXTURE: Record<AssetTier, number> = { ultra: 2048, high: 1024, mobile: 512 };
const MAX_IMPOSTOR: Record<AssetTier, number> = { ultra: 2048, high: 1536, mobile: 1024 };
const BUDGET_MB: Record<AssetTier, number> = { ultra: 80, high: 40, mobile: 15 };
const assets = Object.values(ASSET_MANIFEST.assets) as AssetEntry[];

interface FileRef {
  url: string;
  bytes: number;
  tier: AssetTier | null;
  /** Longest edge in pixels (textures), when known. */
  px?: number;
  what: string;
}

function tierFiles<T extends { url: string; bytes: number }>(m: TierMap<T> | undefined, what: string, px?: (f: T) => number): FileRef[] {
  const out: FileRef[] = [];
  if (!m) return out;
  for (const t of ASSET_TIERS) {
    const f = m[t];
    if (f) out.push({ url: f.url, bytes: f.bytes, tier: t, px: px?.(f), what });
  }
  return out;
}

function setFiles(set: TextureSetEntry, what: string): FileRef[] {
  return Object.entries(set.maps).flatMap(([map, tiers]) => tierFiles(tiers, `${what}${map}`, (f) => f.size));
}

/** Every file an entry references, by kind. */
function filesOf(a: AssetEntry): FileRef[] {
  switch (a.kind) {
    case 'material':
      return setFiles(a, '');
    case 'model':
      return [
        ...a.lods.map((l) => ({ url: l.url, bytes: l.bytes, tier: null, what: `lod${l.lod}` })),
        ...Object.entries(a.sets).flatMap(([k, s]) => setFiles(s, `${k}.`)),
        ...(a.construction?.footprint ? [{ ...a.construction.footprint, tier: null, what: 'footprint' }] : []),
      ];
    case 'hdri':
      return tierFiles(a.files, 'hdri', (f) => f.width);
    case 'vat':
      return [
        ...a.lods.flatMap((l) => [
          { url: l.url, bytes: l.bytes, tier: null, what: `lod${l.lod}` },
          { url: l.vat.url, bytes: l.vat.bytes, tier: null, what: `lod${l.lod}.vat` },
        ]),
        ...(a.impostor ? Object.entries(a.impostor.maps).flatMap(([k, m]) => tierFiles(m, `impostor.${k}`, (f) => f.size)) : []),
        ...Object.entries(a.sets).flatMap(([k, s]) => setFiles(s, `${k}.`)),
      ];
    case 'impostor':
      return Object.entries(a.maps).flatMap(([k, m]) => tierFiles(m, k, (f) => f.size));
    case 'flipbook':
      return Object.entries(a.maps).flatMap(([k, m]) => tierFiles(m, k, (f) => Math.max(f.width, f.height)));
    case 'lut':
      return tierFiles(a.files, 'lut');
    case 'image':
      return tierFiles(a.files, 'image', (f) => Math.max(f.width, f.height));
  }
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

  it('only contains known kinds', () => {
    for (const a of assets) expect(ASSET_KINDS as readonly string[], a.id).toContain(a.kind);
  });

  it('publishes every referenced file with the recorded size', () => {
    for (const a of assets) {
      const files = filesOf(a);
      expect(files.length, a.id).toBeGreaterThan(0);
      for (const f of files) {
        const p = join(PUBLIC, f.url);
        expect(existsSync(p), `${a.id}: ${f.url}`).toBe(true);
        expect(statSync(p).size, `${a.id}: ${f.url}`).toBe(f.bytes);
        expect(f.bytes, `${f.url} exceeds the 8 MB single-file budget`).toBeLessThanOrEqual(8 * 1024 * 1024);
      }
    }
  });

  it('ships tier-specific files exactly on the declared tiers and resolves fallbacks', () => {
    for (const a of assets) {
      expect(a.tiers.length, a.id).toBeGreaterThan(0);
      for (const f of filesOf(a)) if (f.tier) expect(a.tiers, `${a.id} ${f.what} ${f.tier}`).toContain(f.tier);
      for (const t of ASSET_TIERS) {
        if (a.tiers.includes(t)) continue;
        expect(a.bytes[t], `${a.id} ships nothing on ${t}`).toBe(0);
        if (!a.fallback) continue;
        const fb = ASSET_MANIFEST.assets[a.fallback as keyof typeof ASSET_MANIFEST.assets] as AssetEntry | undefined;
        expect(fb?.kind, `${a.id} -> @fallback ${a.fallback}`).toBe(a.kind);
        expect(fb?.tiers, `${a.id} -> @fallback ${a.fallback} on ${t}`).toContain(t);
      }
    }
  });

  it('respects per-tier texture sizes and payload budgets', () => {
    for (const a of assets) {
      for (const f of filesOf(a)) {
        if (!f.tier || f.px === undefined || a.kind === 'hdri') continue;
        // Impostor atlases (8 x 8 frames of 256 / 192 / 128 px) replace whole meshes: one step above sets.
        const lim = a.kind === 'impostor' || f.what.startsWith('impostor') ? MAX_IMPOSTOR[f.tier] : MAX_TEXTURE[f.tier];
        expect(f.px, `${a.id} ${f.url}`).toBeLessThanOrEqual(lim);
      }
    }
    for (const t of ASSET_TIERS) expect(ASSET_MANIFEST.totals[t] / 1048576).toBeLessThanOrEqual(BUDGET_MB[t]);
  });

  it('binds models only to shipped material sets', () => {
    for (const a of assets) {
      if (a.kind !== 'model' && a.kind !== 'vat') continue;
      for (const id of a.materialSets) expect(ASSET_MANIFEST.assets[id as keyof typeof ASSET_MANIFEST.assets]?.kind, `${a.id} -> ${id}`).toBe('material');
      expect(a.lods[0]?.lod).toBe(0);
      for (let i = 1; i < a.lods.length; i++) expect(a.lods[i]!.distance).toBeGreaterThan(a.lods[i - 1]!.distance);
    }
  });

  it('keeps model metadata consistent with the clips', () => {
    for (const a of assets) {
      if (a.kind !== 'model') continue;
      for (const [clip, evs] of Object.entries(a.clipEvents)) {
        expect(a.clips, `${a.id} clipEvents.${clip}`).toContain(clip);
        for (const e of evs) expect(e.time, `${a.id} ${clip} ${e.type}`).toBeGreaterThanOrEqual(0);
      }
      for (const clip of Object.keys(a.rootMotion)) expect(a.clips, `${a.id} rootMotion.${clip}`).toContain(clip);
    }
  });

  it('describes VAT layouts that fit WebGL2 limits', () => {
    for (const a of assets) {
      if (a.kind !== 'vat') continue;
      for (const c of a.clips) expect(c.startFrame + c.frames, `${a.id} ${c.name}`).toBeLessThanOrEqual(a.frames);
      for (const l of a.lods) {
        expect(l.vat.width, `${a.id} lod${l.lod}`).toBeLessThanOrEqual(4096);
        expect(l.vat.height, `${a.id} lod${l.lod}`).toBeLessThanOrEqual(4096);
        expect(l.vat.rowsPerFrame).toBe(Math.ceil(l.vertices / l.vat.width));
        expect(l.vat.height).toBe(a.frames * l.vat.rowsPerFrame);
        expect(l.vat.rawBytes).toBe(l.vat.width * l.vat.height * 8);
        expect(l.errorMm, `${a.id} lod${l.lod} reconstruction error`).toBeLessThanOrEqual(1);
      }
    }
  });
});
