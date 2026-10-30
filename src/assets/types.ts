/**
 * Asset manifest contract (shape of the generated src/assets/manifest.ts) and runtime asset types.
 * OWNER: Technical Artist G (TA-07, CTO grant for Sprint 1) - CTO + Technical Art Director review.
 * The generator is tools/assets/manifest.mjs - keep both in sync. Formats: docs/adr/0003-crowd-impostor-fx-assets.md.
 */

/** Shipped quality tiers of the content pipeline (textures: 2048 / 1024 / 512 px). */
export const ASSET_TIERS = ['ultra', 'high', 'mobile'] as const;
export type AssetTier = (typeof ASSET_TIERS)[number];

/** Every asset kind the pipeline publishes (docstring `@kind`). */
export const ASSET_KINDS = ['material', 'model', 'hdri', 'vat', 'impostor', 'flipbook', 'lut', 'image'] as const;

/** Texture maps a texture set can carry. baseColor/emissive are sRGB, the rest linear data. */
export type TextureMapName = 'baseColor' | 'normal' | 'orm' | 'macro' | 'emissive' | 'height';

/** A value for every tier. */
export type Tiered<T> = { readonly [K in AssetTier]: T };
/** A value for the tiers the asset ships on (`@tiers`); absent tiers use the entry's `fallback`. */
export type TierMap<T> = { readonly [K in AssetTier]?: T };

/** Plain JSON (validated passthrough metadata). */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface TextureFileEntry {
  /** Relative to <base>/assets/. */
  readonly url: string;
  readonly bytes: number;
  /** Square size in pixels. */
  readonly size: number;
}

export interface TextureSetEntry {
  readonly maps: { readonly [K in TextureMapName]?: TierMap<TextureFileEntry> };
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
  /** Payload per tier in bytes (everything this asset ships for that tier; 0 = not shipped). */
  readonly bytes: Tiered<number>;
  /** Tiers the asset ships on (docstring `@tiers`, default all). */
  readonly tiers: readonly AssetTier[];
  /** Same-kind asset substituted on the other tiers (`@fallback`); null = procedural fallback / feature off. */
  readonly fallback: string | null;
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

/** Gameplay / audio / FX markers inside a clip (DESIGN_SPEC §11.7 frame data). Time in seconds from clip start. */
export interface ClipEventEntry {
  /** hit_start | hit_end | cancel | iframe_start | iframe_end | footstep | parry_start | parry_end | release | sfx | fx | x_<custom> */
  readonly type: string;
  readonly time: number;
  /** Optional detail (foot 'L'/'R', sfx kind, fx id...). */
  readonly data?: string;
}

/** Root motion of a clip baked out of the root bone (the clip itself plays in place). */
export interface RootMotionEntry {
  /** Total displacement over the clip, three.js space (+Z forward for +Z-facing models), meters. */
  readonly translation: readonly number[];
  /** Total yaw over the clip (degrees, +Y). */
  readonly yawDeg: number;
}

/** AoE-style construction staging (ASSET_LIST WP2 "Construction stages"). */
export interface ConstructionEntry {
  /** Footprint mesh URL (foundation stage, string lines snap to it), or null. */
  readonly footprint: { readonly url: string; readonly bytes: number; readonly triangles: number } | null;
  /** Scaffold modules (construction_kit ids) placed around the building, model space. */
  readonly scaffold: readonly { readonly module: string; readonly position: readonly number[]; readonly rotationY: number; readonly scale: readonly number[] }[];
  /** Course height (m) per material set for the course-reveal shader. */
  readonly courseHeights: { readonly [materialSet: string]: number };
}

/** Attachment point: banner, weapon, rider, howdah... (bone-relative for skinned models). */
export interface SocketEntry {
  readonly bone: string | null;
  readonly position: readonly number[];
  /** Quaternion x, y, z, w. */
  readonly rotation: readonly number[];
}

/** Age / damage / state variant: the named nodes to show (all other variant nodes hidden). */
export interface VariantEntry {
  readonly name: string;
  readonly kind: string;
  readonly nodes: readonly string[];
}

export interface ModelAssetEntry extends AssetEntryBase {
  readonly kind: 'model';
  readonly lods: readonly ModelLodEntry[];
  /** First LOD loaded per tier (mobile may skip LOD0). */
  readonly minLod: Tiered<number>;
  readonly bounds: BoundsEntry;
  /** Animation clip names (standard names, tools/blender/lib/anim.py). */
  readonly clips: readonly string[];
  /** True when the LODs carry a skin (independently animatable clones via SkeletonUtils). */
  readonly skinned: boolean;
  readonly clipEvents: { readonly [clip: string]: readonly ClipEventEntry[] };
  readonly rootMotion: { readonly [clip: string]: RootMotionEntry };
  readonly construction: ConstructionEntry | null;
  readonly sockets: { readonly [name: string]: SocketEntry };
  readonly variants: readonly VariantEntry[];
  /** Validated JSON passthrough for feature-specific data (<= 16 KB). */
  readonly meta: { readonly [key: string]: JsonValue };
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
  /** Unit vector towards the sun (the moon for night skies), three.js space. */
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
  readonly files: TierMap<HdriFileEntry>;
  readonly sun: SunEntry;
  /** Sky irradiance on a horizontal plane (luminance, sun excluded): environmentIntensity = target / this. */
  readonly ambientIrradiance: number;
}

// ------------------------------------------------------------------------------------------- VAT
export interface VatClipEntry {
  readonly name: string;
  /** First frame (row block) of the clip in the VAT. */
  readonly startFrame: number;
  readonly frames: number;
  /** Bake rate (15 for crowds). */
  readonly fps: number;
  /** Looping clips: the last baked frame is followed by the first (no duplicate end frame). */
  readonly loop: boolean;
  /** Ground distance covered by one loop (locomotion; drive playback speed from it to avoid sliding). */
  readonly strideMeters: number | null;
  /** Locomotion speed the clip was authored for (m/s) = strideMeters x fps / frames. */
  readonly speed: number | null;
}

export interface VatDataEntry {
  /** gzip(byte-shuffled RGB16F rest offsets, then RG8 octahedral normals). */
  readonly url: string;
  readonly bytes: number;
  readonly rawBytes: number;
  /** Texture width (<= 4096): vertex columns wrap into `rowsPerFrame` rows per frame. */
  readonly width: number;
  /** frames x rowsPerFrame. */
  readonly height: number;
  readonly rowsPerFrame: number;
}

export interface VatLodEntry {
  readonly lod: number;
  /** Rest-pose GLB; vertex i == VAT column i (gl_VertexID). */
  readonly url: string;
  readonly bytes: number;
  readonly triangles: number;
  readonly vertices: number;
  /** Suggested camera distance from which this LOD is used (crowds use QualitySettings.soldierLod). */
  readonly distance: number;
  /** Max reconstruction error of the bake (mm). */
  readonly errorMm: number;
  readonly vat: VatDataEntry;
}

export interface AtlasFileEntry {
  readonly url: string;
  readonly bytes: number;
  /** Atlas width in pixels. */
  readonly size: number;
  /** One frame's size in pixels. */
  readonly framePx: number;
}

/** Far-LOD impostor sheet of a VAT unit: `directions` columns x key frames (rows). */
export interface VatImpostorEntry {
  readonly cols: number;
  readonly rows: number;
  /** Yaw directions captured (columns), starting at the model's front (+Z), counter-clockwise from above. */
  readonly directions: number;
  /** Row r shows clip `frames[r].clip` at frame `frames[r].frame`. */
  readonly frames: readonly { readonly clip: string; readonly frame: number }[];
  readonly maps: { readonly albedo: TierMap<AtlasFileEntry>; readonly normal?: TierMap<AtlasFileEntry> };
  /** Billboard half-size and center height (m). */
  readonly radius: number;
  readonly centerY: number;
}

export interface VatAssetEntry extends AssetEntryBase {
  readonly kind: 'vat';
  readonly fps: number;
  /** Total baked frames (all clips). */
  readonly frames: number;
  readonly clips: readonly VatClipEntry[];
  readonly lods: readonly VatLodEntry[];
  readonly minLod: Tiered<number>;
  /** Bounds over every frame of every clip (instanced culling). */
  readonly bounds: BoundsEntry;
  /** Rest-pose bounds (the GLB). */
  readonly restBounds: BoundsEntry;
  /** Vertex color convention (COLOR_0): R team mask, G cloth-variation seed, B part id / 255. */
  readonly vertexColors: boolean;
  /** Part names by id (B channel x 255). */
  readonly parts: readonly string[];
  /** Optional sRGB hex color per part (texture-less units / previews); empty when the material is textured. */
  readonly partColors: readonly string[];
  readonly impostor: VatImpostorEntry | null;
  readonly materialSets: readonly string[];
  readonly sets: { readonly [name: string]: TextureSetEntry };
}

// ------------------------------------------------------------------------------------------- impostor
export interface ImpostorAssetEntry extends AssetEntryBase {
  readonly kind: 'impostor';
  /** 'hemi-octahedral': views over the upper hemisphere only (ground objects). */
  readonly layout: 'hemi-octahedral' | 'octahedral';
  /** Frames per atlas side (8 -> 64 views). */
  readonly grid: number;
  /** Bounding sphere (object space, three.js axes): the billboard is 2 x radius wide. */
  readonly radius: number;
  readonly center: readonly number[];
  /** Suggested mesh -> impostor switch distance (m, before ZoomLook.lodBias). */
  readonly switchDistance: number;
  /** Depth (normal map alpha) 0..1 spans [-radius, +radius] along the view axis; 0.5 = sphere center. */
  readonly depthRange: number;
  /** Model asset the impostor was captured from (A/B in the viewer), or null. */
  readonly source: string | null;
  /** albedo: sRGB + coverage alpha; normal: object-space normal (xyz * 0.5 + 0.5) + depth alpha. */
  readonly maps: { readonly albedo: TierMap<AtlasFileEntry>; readonly normal: TierMap<AtlasFileEntry> };
}

// ------------------------------------------------------------------------------------------- flipbook
export interface FlipbookSequenceEntry {
  readonly name: string;
  /** First frame index (row-major, top-left = 0). */
  readonly start: number;
  readonly count: number;
  readonly fps: number;
  readonly loop: boolean;
  /** Per-sequence blend override (e.g. additive fireflies in a lit leaf atlas); null = the atlas blend. */
  readonly blend: 'alpha' | 'additive' | 'premultiplied' | null;
  /** Per-sequence lighting override; null = the atlas `lit`. */
  readonly lit: boolean | null;
  /**
   * Frame edges this sequence's content legitimately reaches (weapon-trail ribbons: 'left' = the blade now;
   * ground-strike bolts: 'bottom'; tileable noises: all four). Every other edge is clear: the outer 2 px of the
   * encoded atlas carry <= 2/255 (flipbook border guard, checked at bake and on every published tier).
   */
  readonly openEdges: readonly FlipbookEdge[];
}

export type FlipbookEdge = 'top' | 'bottom' | 'left' | 'right';

export interface FlipbookFileEntry {
  readonly url: string;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
}

export interface FlipbookAssetEntry extends AssetEntryBase {
  readonly kind: 'flipbook';
  readonly cols: number;
  readonly rows: number;
  /** Default playback of the whole atlas. */
  readonly fps: number;
  readonly loop: boolean;
  /** Named sub-animations and single sprites (count 1). */
  readonly sequences: readonly FlipbookSequenceEntry[];
  /** color: sRGB rgb + linear alpha; normal: tangent-space (OpenGL +Y) from density; emissive: sRGB. */
  readonly maps: {
    readonly color: TierMap<FlipbookFileEntry>;
    readonly normal?: TierMap<FlipbookFileEntry>;
    readonly emissive?: TierMap<FlipbookFileEntry>;
  };
  /** 'alpha' straight alpha, 'additive' (color x alpha added), 'premultiplied'. */
  readonly blend: 'alpha' | 'additive' | 'premultiplied';
  /** Lit by sun + ambient (normal map) - ART_BIBLE §10: no unlit white puffs. */
  readonly lit: boolean;
  /** Depth-fade distance for soft particles (m). */
  readonly softFadeMeters: number;
  /** HDR multiplier for emissive / additive color (fire 6-12). */
  readonly emissiveIntensity: number;
  /** Typical world size of one sprite (m), or null. */
  readonly sizeMeters: readonly number[] | null;
  /**
   * Grounded effects (fire base, dust contact): fraction of the frame height ABOVE the frame's bottom edge where the
   * effect meets the ground - sink the quad by groundLine x height so the base sits on the terrain (the content keeps
   * that margin so lossy encoding never smears it onto the border). null = free-floating (smoke, sparks, mist).
   */
  readonly groundLine: number | null;
  /** Suggested particle tint (sRGB hex) for neutral atlases, e.g. building smoke `#4a4038`. */
  readonly tint: string;
  /**
   * Gradient-mapped emission (fx_fire, fx_weapon_trail), or null. The color atlas then stores ONE channel: v = the
   * sRGB-encoded luminance of the emission (R = G = B, sampled WITHOUT colour conversion) plus alpha, and the colour
   * is rgb = ramp(v): `ramp` holds 2..33 linear-rgb stops evenly spaced over v in [0, 1] (piecewise linear),
   * ramp[0] = [0, 0, 0] and R >= G >= B at every stop (no green / blue drift - TA-07 R2). Data sequences of such a
   * book (the trail noises) are read raw from .r by their consumer.
   */
  readonly ramp: readonly (readonly number[])[] | null;
}

// ------------------------------------------------------------------------------------------- LUT / image
export interface LutFileEntry {
  readonly url: string;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
}

export interface LutAssetEntry extends AssetEntryBase {
  readonly kind: 'lut';
  /** Lattice size (32 -> 1024 x 32 strip). */
  readonly size: number;
  /** three LUTImageLoader layout: blue slice b at x = b * size, red along x, green along y with green 0 at the top row. */
  readonly layout: 'strip-horizontal';
  readonly files: TierMap<LutFileEntry>;
  /** 'docs/art/luts/<id>.cube' (Art Director) or 'GRADE_PRESETS.<preset>' (generated interim). */
  readonly source: string;
  /** Applied in display space after tone mapping (+ grade); suggested blend strength (ART_BIBLE §4.7). */
  readonly strength: number;
}

export interface ImageFileEntry {
  readonly url: string;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
}

export interface ImageAssetEntry extends AssetEntryBase {
  readonly kind: 'image';
  readonly files: TierMap<ImageFileEntry>;
  readonly colorSpace: 'srgb' | 'linear';
  readonly alpha: boolean;
  /** Multiply the decoded color by this for HDR use (sun sprite luminance 50). */
  readonly hdrScale: number;
  readonly usage: string;
}

export type AssetEntry =
  | MaterialAssetEntry
  | ModelAssetEntry
  | HdriAssetEntry
  | VatAssetEntry
  | ImpostorAssetEntry
  | FlipbookAssetEntry
  | LutAssetEntry
  | ImageAssetEntry;
export type AssetKind = AssetEntry['kind'];

export interface AssetManifest {
  readonly version: number;
  readonly totals: Tiered<number>;
  readonly assets: { readonly [id: string]: AssetEntry };
}
