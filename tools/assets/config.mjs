/**
 * Asset pipeline configuration: tiers, budgets, encoders, paths. OWNER: CTO + Technical Art Director.
 * Changing anything here changes outputs -> bump PIPELINE_VERSION so incremental builds re-publish.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PIPELINE_VERSION = 1;

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BLENDER_DIR = path.join(ROOT, 'tools', 'blender');
export const SCRIPTS_DIR = path.join(BLENDER_DIR, 'assets');
export const LIB_DIR = path.join(BLENDER_DIR, 'lib');
export const CACHE_DIR = path.join(ROOT, '.asset-cache');
export const PUBLIC_DIR = path.join(ROOT, 'public', 'assets');
export const PUBLISHED_JSON = path.join(ROOT, 'tools', 'assets', 'published.json');
export const MANIFEST_TS = path.join(ROOT, 'src', 'assets', 'manifest.ts');
export const BLENDER_PY = process.env.BLENDER_PY || '/root/.venvs/blender/bin/python';

/** Quality tiers. The runtime maps QualityTier -> AssetTier (ultra -> ultra, high -> high, medium/low -> mobile). */
export const TIERS = /** @type {const} */ (['ultra', 'high', 'mobile']);
export const TIER_MAX_TEXTURE = { ultra: 2048, high: 1024, mobile: 512 };

/** Shipped payload budgets per tier (bytes) - the build fails above them. */
export const BUDGETS = {
  totalBytes: { ultra: 80 * 1024 * 1024, high: 40 * 1024 * 1024, mobile: 15 * 1024 * 1024 },
  /** Single shipped file. */
  fileBytes: 8 * 1024 * 1024,
};

/**
 * WebP encoder settings per texture map. Lossy WebP is 4:2:0 by default; `smartSubsample` keeps
 * chroma edges sharp. Normal maps use near-lossless (no chroma subsampling, bounded per-pixel error).
 */
export const TEXTURE_ENCODING = {
  baseColor: { quality: 88, smartSubsample: true, effort: 5 },
  orm: { quality: 86, smartSubsample: true, effort: 5 },
  macro: { quality: 86, smartSubsample: true, effort: 5 },
  emissive: { quality: 86, smartSubsample: true, effort: 5 },
  normal: { nearLossless: true, quality: 60, effort: 5 },
  height: { lossless: true, effort: 5 },
};

/** Texture maps the runtime understands (anything else is cache-only). */
export const TEXTURE_MAPS = ['baseColor', 'normal', 'orm', 'macro', 'emissive', 'height'];
export const SRGB_MAPS = new Set(['baseColor', 'emissive']);
