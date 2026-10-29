/**
 * Asset pipeline configuration: kinds, tiers, budgets, encoders, paths. OWNER: Technical Artist G (TA-07,
 * CTO grant for Sprint 1) - CTO + Technical Art Director review.
 * Changing an encoder or a published layout changes outputs -> bump PIPELINE_VERSION so incremental builds
 * re-publish (this re-hashes every asset: justify it in the report). Adding kinds, budgets or tags does not.
 *
 * Path overrides (tests and sandboxes only; never set them for real builds):
 *   SAMRAJYA_ASSETS_ROOT        repo root (default: two levels above this file)
 *   SAMRAJYA_ASSETS_SCRIPTS     tools/blender/assets       SAMRAJYA_ASSETS_CACHE    .asset-cache
 *   SAMRAJYA_ASSETS_PUBLIC      public/assets              SAMRAJYA_ASSETS_RECORD   tools/assets/published.json
 *   SAMRAJYA_ASSETS_MANIFEST    src/assets/manifest.ts
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PIPELINE_VERSION = 1;

const env = process.env;
export const ROOT = path.resolve(env.SAMRAJYA_ASSETS_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
export const BLENDER_DIR = path.join(ROOT, 'tools', 'blender');
export const SCRIPTS_DIR = path.resolve(env.SAMRAJYA_ASSETS_SCRIPTS || path.join(BLENDER_DIR, 'assets'));
export const LIB_DIR = path.join(BLENDER_DIR, 'lib');
export const CACHE_DIR = path.resolve(env.SAMRAJYA_ASSETS_CACHE || path.join(ROOT, '.asset-cache'));
export const PUBLIC_DIR = path.resolve(env.SAMRAJYA_ASSETS_PUBLIC || path.join(ROOT, 'public', 'assets'));
export const PUBLISHED_JSON = path.resolve(env.SAMRAJYA_ASSETS_RECORD || path.join(ROOT, 'tools', 'assets', 'published.json'));
export const MANIFEST_TS = path.resolve(env.SAMRAJYA_ASSETS_MANIFEST || path.join(ROOT, 'src', 'assets', 'manifest.ts'));
export const STYLE_DIR = path.join(ROOT, 'src', 'render', 'style');
export const BLENDER_PY = env.BLENDER_PY || '/root/.venvs/blender/bin/python';

/** Publish lock (A1): exclusive O_EXCL owner record; flock(1)-compatible (see build.mjs `withPublishLock`). */
export const PUBLISH_LOCK = path.join(CACHE_DIR, '.publish.lock');
export const PUBLISH_LOCK_STALE_MS = 30 * 60 * 1000;

/** Asset kinds (docstring `@kind`). Keep in sync with src/assets/types.ts `AssetKind`. */
export const KINDS = /** @type {const} */ (['material', 'model', 'hdri', 'vat', 'impostor', 'flipbook', 'lut', 'image']);

/** Quality tiers. The runtime maps QualityTier -> AssetTier (ultra -> ultra, high -> high, medium/low -> mobile). */
export const TIERS = /** @type {const} */ (['ultra', 'high', 'mobile']);
/** Max texture size (px, longest edge) per tier for tiling sets, model-local sets, images and flipbooks. */
export const TIER_MAX_TEXTURE = { ultra: 2048, high: 1024, mobile: 512 };
/**
 * Impostor atlases (8 x 8 hemi-octahedral frames of 256 / 192 / 128 px, ASSET_LIST WP4) replace a whole
 * mesh at distance, so they are allowed one step above the tiling-set limit on high and mobile.
 */
export const IMPOSTOR_MAX_TEXTURE = { ultra: 2048, high: 1536, mobile: 1024 };
export const IMPOSTOR_FRAME_PX = { ultra: 256, high: 192, mobile: 128 };
/** Normal + depth frames are published at this fraction of the albedo frame size (lighting is low-frequency). */
export const IMPOSTOR_NORMAL_SCALE = 0.5;
/** VAT textures: vertex columns wrap so the width stays <= 4096 (WebGL2 mobile limit), frames as rows. */
export const VAT_MAX_TEXTURE = 4096;

/** Shipped payload budgets per tier (bytes) - the build fails above them. */
export const BUDGETS = {
  totalBytes: { ultra: 80 * 1024 * 1024, high: 40 * 1024 * 1024, mobile: 15 * 1024 * 1024 },
  /** Single shipped file. */
  fileBytes: 8 * 1024 * 1024,
};

const MB = 1024 * 1024;
/**
 * Work-package budgets (docs/ASSET_LIST.md table, ultra / high / mobile MB) keyed by script category
 * (the folder under tools/blender/assets). `--list` prints them, `--check` and every publish enforce them.
 */
export const PACKAGES = {
  wp1: { label: 'WP1 materials & terrain', categories: ['materials', 'terrain', 'decals'], bytes: { ultra: 36 * MB, high: 16 * MB, mobile: 5.3 * MB } },
  wp2: { label: 'WP2 architecture kit', categories: ['architecture', 'props', 'boats'], bytes: { ultra: 5 * MB, high: 3.5 * MB, mobile: 2 * MB } },
  wp3: { label: 'WP3 monuments & fortifications', categories: ['models', 'monuments', 'landmarks', 'fortifications', 'waterfront'], bytes: { ultra: 9 * MB, high: 5.5 * MB, mobile: 2.3 * MB } },
  wp4: { label: 'WP4 vegetation, crops, rocks', categories: ['vegetation', 'crops', 'rocks'], bytes: { ultra: 9 * MB, high: 4.5 * MB, mobile: 1.8 * MB } },
  wp5: { label: 'WP5 crowds, animals, vehicles', categories: ['crowd', 'animals', 'vehicles'], bytes: { ultra: 8 * MB, high: 5 * MB, mobile: 2 * MB } },
  wp6: { label: 'WP6 hero & cinematic characters', categories: ['characters', 'weapons', 'portraits'], bytes: { ultra: 6 * MB, high: 3 * MB, mobile: 0.8 * MB } },
  wp7: { label: 'WP7 skies, LUTs, VFX, banners', categories: ['hdri', 'fx', 'banners', 'luts', 'images'], bytes: { ultra: 4 * MB, high: 2 * MB, mobile: 0.6 * MB } },
  test: { label: 'Pipeline test assets (viewer / QA)', categories: ['pipeline_test'], bytes: { ultra: 4 * MB, high: 3 * MB, mobile: 1.5 * MB } },
};

/** Work package of a script category (null = unassigned: counted in the global budget only). */
export function packageOf(category) {
  for (const [id, p] of Object.entries(PACKAGES)) if (p.categories.includes(category)) return id;
  return null;
}

/**
 * WebP encoder settings per texture map. Lossy WebP is 4:2:0 by default; `smartSubsample` keeps
 * chroma edges sharp. Normal maps use near-lossless (no chroma subsampling, bounded per-pixel error).
 * `*_alpha` variants keep an alpha channel (impostors, flipbooks, images).
 */
export const TEXTURE_ENCODING = {
  baseColor: { quality: 88, smartSubsample: true, effort: 5 },
  orm: { quality: 86, smartSubsample: true, effort: 5 },
  macro: { quality: 86, smartSubsample: true, effort: 5 },
  emissive: { quality: 86, smartSubsample: true, effort: 5 },
  normal: { nearLossless: true, quality: 60, effort: 5 },
  height: { lossless: true, effort: 5 },
  // ---- kinds with alpha
  color_alpha: { quality: 86, alphaQuality: 90, smartSubsample: true, effort: 6 },
  normal_alpha: { nearLossless: true, quality: 60, effort: 6 },
  // Impostor normal + depth atlases (object-space, seen from >= switch distance): lossy is ~3 deg mean error
  // at a third of the near-lossless size (measured on impostor_test_tree: 2.0 MB -> 0.8 MB at 2048).
  impostor_normal: { quality: 92, alphaQuality: 95, smartSubsample: true, effort: 6 },
  image: { quality: 88, alphaQuality: 92, smartSubsample: true, effort: 6 },
};

/** Texture maps the runtime understands (anything else is cache-only). */
export const TEXTURE_MAPS = ['baseColor', 'normal', 'orm', 'macro', 'emissive', 'height'];
export const SRGB_MAPS = new Set(['baseColor', 'emissive']);
/** Flipbook atlas maps: color (sRGB + linear alpha), normal (tangent space, OpenGL +Y), emissive (sRGB). */
export const FLIPBOOK_MAPS = ['color', 'normal', 'emissive'];
/** Impostor atlas maps: albedo (sRGB + coverage alpha), normal (object-space normal + depth in alpha). */
export const IMPOSTOR_MAPS = ['albedo', 'normal'];

/** Clip events the runtime understands (custom events: `x_<name>`). */
export const CLIP_EVENT_TYPES = ['hit_start', 'hit_end', 'cancel', 'iframe_start', 'iframe_end', 'footstep', 'parry_start', 'parry_end', 'release', 'sfx', 'fx'];
