/**
 * Asset manifest contract (shape of the generated src/assets/manifest.ts) and runtime asset types.
 * OWNER: CTO + Technical Art Director. The generator is tools/assets/manifest.mjs - keep both in sync.
 */

/** Shipped quality tiers of the content pipeline (textures: 2048 / 1024 / 512 px). */
export const ASSET_TIERS = ['ultra', 'high', 'mobile'] as const;
export type AssetTier = (typeof ASSET_TIERS)[number];

/** Texture maps a texture set can carry. baseColor/emissive are sRGB, the rest linear data. */
export type TextureMapName = 'baseColor' | 'normal' | 'orm' | 'macro' | 'emissive' | 'height';

export type Tiered<T> = { readonly [K in AssetTier]: T };

export interface TextureFileEntry {
  /** Relative to <base>/assets/. */
  readonly url: string;
  readonly bytes: number;
  /** Square size in pixels. */
  readonly size: number;
}

export interface TextureSetEntry {
  readonly maps: { readonly [K in TextureMapName]?: Tiered<TextureFileEntry> };
}

export interface TrimEntry {
  readonly name: string;
  /** UV v range (0 = bottom of the sheet, 1 = top), Blender/OpenGL convention. */
  readonly v0: number;
  readonly v1: number;
  readonly heightMeters: number;
}

interface AssetEntryBase {
  readonly id: string;
  readonly category: string;
  /** Content hash prefix (cache busting). */
  readonly hash: string;
  readonly description: string;
  /** Payload per tier in bytes (everything this asset ships for that tier). */
  readonly bytes: Tiered<number>;
}

export interface MaterialAssetEntry extends AssetEntryBase, TextureSetEntry {
  readonly kind: 'material';
  readonly tileSizeMeters: readonly [number, number] | readonly number[];
  /** sRGB hex - procedural fallback color. */
  readonly averageColor: string;
  readonly roughness: number;
  readonly metalness: number;
  readonly normalScale: number;
  readonly trims: readonly TrimEntry[];
}

export interface ModelLodEntry {
  readonly lod: number;
  readonly url: string;
  readonly bytes: number;
  readonly triangles: number;
  readonly drawCalls: number;
  /** Camera distance (m) from which this LOD is used. */
  readonly distance: number;
}

export interface BoundsEntry {
  /** three.js space (+Y up), meters. */
  readonly min: readonly number[];
  readonly max: readonly number[];
  readonly center: readonly number[];
  readonly radius: number;
}

export interface ModelAssetEntry extends AssetEntryBase {
  readonly kind: 'model';
  readonly lods: readonly ModelLodEntry[];
  /** First LOD loaded per tier (mobile may skip LOD0). */
  readonly minLod: Tiered<number>;
  readonly bounds: BoundsEntry;
  /** Animation clip names (standard names, tools/blender/lib/anim.py). */
  readonly clips: readonly string[];
  /** Shared material assets the model binds at runtime (material extras `samrajya_set`). */
  readonly materialSets: readonly string[];
  /** Model-local texture sets, referenced as "<model id>:<set>" from material extras. */
  readonly sets: { readonly [name: string]: TextureSetEntry };
  readonly footprintMeters: readonly number[] | null;
}

export interface HdriFileEntry {
  readonly url: string;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
}

export interface SunEntry {
  /** Unit vector towards the sun, three.js space. */
  readonly direction: readonly number[];
  /** Linear RGB, max component 1. */
  readonly color: readonly number[];
  /** DirectionalLight intensity matching the env map at envMapIntensity 1. */
  readonly intensity: number;
  readonly elevationDeg: number;
  readonly azimuthDeg: number;
}

export interface HdriAssetEntry extends AssetEntryBase {
  readonly kind: 'hdri';
  readonly files: Tiered<HdriFileEntry>;
  readonly sun: SunEntry;
  /** Sky irradiance on a horizontal plane (luminance), for fill-light / exposure heuristics. */
  readonly ambientIrradiance: number;
}

export type AssetEntry = MaterialAssetEntry | ModelAssetEntry | HdriAssetEntry;
export type AssetKind = AssetEntry['kind'];

export interface AssetManifest {
  readonly version: number;
  readonly totals: Tiered<number>;
  readonly assets: { readonly [id: string]: AssetEntry };
}
