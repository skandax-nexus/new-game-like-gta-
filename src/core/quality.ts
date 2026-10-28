/**
 * Quality tier detection + settings presets. Owned by the CTO.
 *
 * Detection order: URL ?quality= override > saved user setting > heuristics
 * (mobile/touch, deviceMemory, hardwareConcurrency, WebGL renderer string, max texture size).
 * Render modules MUST read every visual knob from `QualitySettings` (never sniff the device themselves).
 */
import type { QualityDetection, QualitySettings, QualityTier } from './types';
import { QUALITY_TIERS } from './types';
import { MAX_SOLDIERS } from './constants';

export const QUALITY_PRESETS: Readonly<Record<QualityTier, QualitySettings>> = {
  low: {
    tier: 'low',
    targetFps: 30,
    maxPixelRatio: 1,
    dynamicResolution: { enabled: true, minScale: 0.6, maxScale: 1 },
    shadows: { enabled: true, mapSize: 1024, cascades: 1, distance: 260, soft: false },
    ao: 'off',
    aoHalfRes: true,
    bloom: false,
    antialias: 'fxaa',
    colorGrading: true,
    vignette: true,
    fog: true,
    envMapSize: 64,
    water: { reflections: 'envmap', resolutionScale: 0.25 },
    terrain: { chunkSegments: 32, detailTextures: false, textureSize: 256 },
    vegetation: { density: 0.35, grassDistance: 50, treeDistance: 700, windAnimation: false },
    soldierLod: { near: 35, mid: 110, far: 400 },
    localSimRadius: 60,
    maxSoldiers: 1500,
    particles: 400,
    anisotropy: 1,
    banners: false,
    weatherParticles: 1500,
  },
  medium: {
    tier: 'medium',
    targetFps: 30,
    maxPixelRatio: 1.5,
    dynamicResolution: { enabled: true, minScale: 0.65, maxScale: 1 },
    shadows: { enabled: true, mapSize: 2048, cascades: 2, distance: 400, soft: true },
    ao: 'off',
    aoHalfRes: true,
    bloom: true,
    antialias: 'fxaa',
    colorGrading: true,
    vignette: true,
    fog: true,
    envMapSize: 128,
    water: { reflections: 'envmap', resolutionScale: 0.5 },
    terrain: { chunkSegments: 64, detailTextures: true, textureSize: 512 },
    vegetation: { density: 0.6, grassDistance: 90, treeDistance: 1200, windAnimation: true },
    soldierLod: { near: 50, mid: 160, far: 600 },
    localSimRadius: 90,
    maxSoldiers: 3000,
    particles: 1200,
    anisotropy: 4,
    banners: true,
    weatherParticles: 4000,
  },
  high: {
    tier: 'high',
    targetFps: 60,
    maxPixelRatio: 2,
    dynamicResolution: { enabled: true, minScale: 0.7, maxScale: 1 },
    shadows: { enabled: true, mapSize: 4096, cascades: 3, distance: 600, soft: true },
    ao: 'gtao',
    aoHalfRes: true,
    bloom: true,
    antialias: 'smaa',
    colorGrading: true,
    vignette: true,
    fog: true,
    envMapSize: 256,
    water: { reflections: 'planar', resolutionScale: 0.5 },
    terrain: { chunkSegments: 128, detailTextures: true, textureSize: 1024 },
    vegetation: { density: 1, grassDistance: 140, treeDistance: 2000, windAnimation: true },
    soldierLod: { near: 70, mid: 220, far: 900 },
    localSimRadius: 140,
    maxSoldiers: 5000,
    particles: 3000,
    anisotropy: 8,
    banners: true,
    weatherParticles: 9000,
  },
  ultra: {
    tier: 'ultra',
    targetFps: 60,
    maxPixelRatio: 2,
    dynamicResolution: { enabled: false, minScale: 0.85, maxScale: 1 },
    shadows: { enabled: true, mapSize: 4096, cascades: 4, distance: 900, soft: true },
    ao: 'gtao',
    aoHalfRes: false,
    bloom: true,
    antialias: 'smaa',
    colorGrading: true,
    vignette: true,
    fog: true,
    envMapSize: 512,
    water: { reflections: 'planar', resolutionScale: 1 },
    terrain: { chunkSegments: 192, detailTextures: true, textureSize: 2048 },
    vegetation: { density: 1.5, grassDistance: 220, treeDistance: 3000, windAnimation: true },
    soldierLod: { near: 100, mid: 300, far: 1400 },
    localSimRadius: 220,
    maxSoldiers: MAX_SOLDIERS,
    particles: 6000,
    anisotropy: 16,
    banners: true,
    weatherParticles: 16000,
  },
};

export function isQualityTier(v: unknown): v is QualityTier {
  return typeof v === 'string' && (QUALITY_TIERS as readonly string[]).includes(v);
}

/** Preset merged with user overrides (deep for nested groups). */
export function buildQualitySettings(tier: QualityTier, overrides: Partial<QualitySettings> = {}): QualitySettings {
  const base = QUALITY_PRESETS[tier];
  const merged: QualitySettings = {
    ...base,
    ...overrides,
    tier,
    dynamicResolution: { ...base.dynamicResolution, ...(overrides.dynamicResolution ?? {}) },
    shadows: { ...base.shadows, ...(overrides.shadows ?? {}) },
    water: { ...base.water, ...(overrides.water ?? {}) },
    terrain: { ...base.terrain, ...(overrides.terrain ?? {}) },
    vegetation: { ...base.vegetation, ...(overrides.vegetation ?? {}) },
    soldierLod: { ...base.soldierLod, ...(overrides.soldierLod ?? {}) },
  };
  return merged;
}

export interface DetectionInput {
  userAgent: string;
  maxTouchPoints: number;
  coarsePointer: boolean;
  deviceMemoryGb: number | null;
  cores: number;
  gpuRenderer: string;
  gpuVendor: string;
  webgl2: boolean;
  maxTextureSize: number;
  screenMinSide: number;
}

/** Collect detection inputs from the browser (creates a throwaway WebGL2 context). */
export function gatherDetectionInput(): DetectionInput {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  let gpuRenderer = '';
  let gpuVendor = '';
  let webgl2 = false;
  let maxTextureSize = 0;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (gl) {
      webgl2 = true;
      maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) {
        gpuRenderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
        gpuVendor = String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL));
      } else {
        gpuRenderer = String(gl.getParameter(gl.RENDERER));
        gpuVendor = String(gl.getParameter(gl.VENDOR));
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    // ignore
  }
  const dm = (nav as (Navigator & { deviceMemory?: number }) | undefined)?.deviceMemory;
  return {
    userAgent: nav?.userAgent ?? '',
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
    coarsePointer: typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)').matches : false,
    deviceMemoryGb: typeof dm === 'number' ? dm : null,
    cores: nav?.hardwareConcurrency ?? 4,
    gpuRenderer,
    gpuVendor,
    webgl2,
    maxTextureSize,
    screenMinSide: typeof screen !== 'undefined' ? Math.min(screen.width, screen.height) : 1080,
  };
}

const TIER_RANK: Record<QualityTier, number> = { low: 0, medium: 1, high: 2, ultra: 3 };
const RANK_TIER: QualityTier[] = ['low', 'medium', 'high', 'ultra'];

/** Pure heuristic: detection input -> tier + reasons. Exported for unit tests. */
export function detectTier(inp: DetectionInput): QualityDetection {
  const reasons: string[] = [];
  const ua = inp.userAgent;
  const iPadOs = /Macintosh/.test(ua) && inp.maxTouchPoints > 1;
  const isMobile = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua) || iPadOs;
  const isTouch = inp.maxTouchPoints > 0 || inp.coarsePointer;
  const r = inp.gpuRenderer.toLowerCase();
  const software = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(r);

  let rank = isMobile ? 1 : 2;
  reasons.push(isMobile ? 'mobile device -> medium baseline' : 'desktop -> high baseline');

  if (!inp.webgl2) {
    rank = 0;
    reasons.push('no WebGL2');
  }
  if (software) {
    rank = 0;
    reasons.push(`software renderer (${inp.gpuRenderer})`);
  } else if (r) {
    if (/rtx\s*(30|40|50)\d\d|rx\s*(6|7|9)\d\d\d|radeon pro w|apple m[1-4] (pro|max|ultra)/.test(r)) {
      rank = Math.max(rank, 3);
      reasons.push('high-end discrete GPU');
    } else if (/rtx|gtx\s*1[06-9]\d\d|gtx\s*16|rx\s*5\d\d\d|apple m[1-4]|iris xe|radeon(tm)? graphics|arc/.test(r) && !isMobile) {
      rank = Math.max(rank, 2);
      reasons.push('capable GPU');
    } else if (/intel.*(hd|uhd) graphics|mali-[gt]?[1-5]\d|adreno.*[3-5]\d\d|powervr|videocore/.test(r)) {
      rank = Math.min(rank, isMobile ? 0 : 1);
      reasons.push('entry-level GPU');
    } else if (/adreno.*(6[4-9]\d|7\d\d|8\d\d)|mali-g(7[1-9]|[6-9]\d\d|715|720)|apple gpu|immortalis/.test(r)) {
      rank = Math.max(rank, 1);
      reasons.push('modern mobile GPU');
    }
  }
  if (inp.deviceMemoryGb !== null && inp.deviceMemoryGb <= 2) {
    rank = Math.min(rank, 0);
    reasons.push(`low memory (${inp.deviceMemoryGb} GB)`);
  } else if (inp.deviceMemoryGb !== null && inp.deviceMemoryGb <= 4) {
    rank = Math.min(rank, 1);
    reasons.push(`limited memory (${inp.deviceMemoryGb} GB)`);
  }
  if (inp.cores <= 2) {
    rank = Math.min(rank, 0);
    reasons.push(`${inp.cores} CPU cores`);
  } else if (inp.cores <= 4 && isMobile) {
    rank = Math.min(rank, 1);
  }
  if (inp.maxTextureSize > 0 && inp.maxTextureSize < 8192) {
    rank = Math.min(rank, 1);
    reasons.push(`max texture ${inp.maxTextureSize}`);
  }
  return {
    tier: RANK_TIER[Math.max(0, Math.min(3, rank))] as QualityTier,
    reasons,
    isMobile,
    isTouch,
    gpuRenderer: inp.gpuRenderer,
    gpuVendor: inp.gpuVendor,
    deviceMemoryGb: inp.deviceMemoryGb,
    cores: inp.cores,
    webgl2: inp.webgl2,
    maxTextureSize: inp.maxTextureSize,
    softwareRenderer: software,
    overridden: false,
  };
}

/** Full detection with overrides (URL param > saved setting > heuristics). */
export function detectQuality(urlOverride: QualityTier | null, saved: QualityTier | 'auto' | null): QualityDetection {
  const det = detectTier(gatherDetectionInput());
  if (urlOverride) {
    return { ...det, tier: urlOverride, overridden: true, reasons: [...det.reasons, `URL override -> ${urlOverride}`] };
  }
  if (saved && saved !== 'auto') {
    return { ...det, tier: saved, overridden: true, reasons: [...det.reasons, `saved setting -> ${saved}`] };
  }
  return det;
}

/** One tier lower (used by automatic downgrade when frame time stays far above budget). */
export function lowerTier(t: QualityTier): QualityTier {
  return RANK_TIER[Math.max(0, TIER_RANK[t] - 1)] as QualityTier;
}

/** Holds the active settings; notifies listeners on change. */
export class QualityManager {
  private _settings: QualitySettings;
  private listeners: ((s: QualitySettings) => void)[] = [];
  readonly detection: QualityDetection;

  constructor(detection: QualityDetection, overrides: Partial<QualitySettings> = {}) {
    this.detection = detection;
    this._settings = buildQualitySettings(detection.tier, overrides);
  }

  get settings(): QualitySettings {
    return this._settings;
  }

  get tier(): QualityTier {
    return this._settings.tier;
  }

  setTier(tier: QualityTier, overrides: Partial<QualitySettings> = {}): void {
    this._settings = buildQualitySettings(tier, overrides);
    for (const l of this.listeners) l(this._settings);
  }

  onChange(fn: (s: QualitySettings) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }
}
