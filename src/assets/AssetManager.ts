/**
 * Runtime asset manager for content-pipeline assets (tools/assets -> public/assets -> manifest.ts).
 * OWNER: Technical Artist G (TA-07, CTO grant for Sprint 1) - CTO + Technical Art Director review.
 * Formats and API: docs/ARCHITECTURE.md §18, docs/adr/0003-crowd-impostor-fx-assets.md.
 *
 *   const assets = ctx.assets;                                    // created in main.ts
 *   const sky = await assets.loadHdri('sky_day');                 // { texture, envMap, sun, release } | null
 *   const stupa = await assets.loadModel('stupa_sanchi', { crossFade: true });   // { object (THREE.LOD), ... }
 *   const stone = await assets.loadMaterial('sandstone_carved_red', { uvScale: [2, 1] });
 *   const crowd = await assets.loadVat('vat_test_dummy');         // VAT LODs (geometry + textures) | null
 *   const tree = await assets.loadImpostor('impostor_test_tree'); // impostor atlases | null
 *   const smoke = await assets.loadFlipbook('fx_smoke');          // flipbook atlases | null
 *   const grade = await assets.loadLut('lut_golden');             // Data3DTexture | null
 *   const sun = await assets.loadImage('sun_sprite');             // sRGB texture | null
 *   assets.onProgress((p) => ...);                                // loading-screen progress (bytes + items)
 *   ... later: every handle.release()                             // ref-counted; GPU memory freed at 0
 *
 * - Tier: AssetTier from the quality tier (ultra -> ultra, high -> high, medium/low -> mobile) or
 *   ?assets=ultra|high|mobile|off. 'off' (and the single-file build) never fetch: procedural fallbacks.
 *   Assets that do not ship on the active tier (`@tiers`) resolve to their `@fallback` asset, else null.
 * - Decoding stays off the main thread where possible: textures via fetch + createImageBitmap (no
 *   premultiply / color conversion, flipY false like glTF), VAT payloads via DecompressionStream + typed arrays;
 *   everything is uploaded during loading (renderer.initTexture) so the first frame does not hitch.
 * - Models: GLTFLoader + MeshoptDecoder; texture-less proxy materials are replaced by PBR materials bound
 *   to the shared (tier-appropriate) texture sets named in their glTF extras (tools/blender/lib/export.py).
 *   Skinned models return independently animatable SkeletonUtils clones (LOD levels share LOD0's skeleton)
 *   plus their AnimationClips and clipEvents; `crossFade` returns a dithered CrossFadeLOD.
 * - Fallbacks: a missing/failed asset never breaks the game - models fall back to a registered procedural
 *   factory (registerModelFallback) or a bounds-sized block; materials to factor-only PBR; every other loader
 *   resolves to null (the caller keeps its procedural sky / particles / grade). Failures are console.warn'ed.
 */
import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { QualityTier } from '../core/types';
import { configureSetTexture, createPbrMaterial, disposePbrMaterial, type PbrTextures } from '../render/materials/pbr';
import {
  ASSET_MANIFEST,
  type AssetId,
  type FlipbookAssetId,
  type HdriAssetId,
  type ImageAssetId,
  type ImpostorAssetId,
  type LutAssetId,
  type MaterialAssetId,
  type ModelAssetId,
  type VatAssetId,
} from './manifest';
import type {
  AssetEntry,
  AssetManifest,
  AssetTier,
  ClipEventEntry,
  HdriAssetEntry,
  ImageAssetEntry,
  MaterialAssetEntry,
  ModelAssetEntry,
  SunEntry,
  TextureMapName,
  TextureSetEntry,
} from './types';
import { ASSET_TIERS } from './types';
import { decodeBitmap, bitmapPixels, fetchBytes, mimeOf } from './loaders/decode';
import { applyVatBounds, createVatTextures, decodeVat, type VatHandle, type VatLodData } from './loaders/vat';
import type { ImpostorHandle } from './loaders/impostor';
import type { FlipbookHandle } from './loaders/flipbook';
import { createLutTexture, stripToVolume, type LutHandle } from './loaders/lut';
import { makeCrossFadeLod, type CrossFadeOptions } from './loaders/lodFade';

export type { VatHandle, VatLodData } from './loaders/vat';
export type { ImpostorHandle } from './loaders/impostor';
export type { FlipbookHandle } from './loaders/flipbook';
export type { LutHandle } from './loaders/lut';

declare const __ASSETS_ENABLED__: boolean;
/** False in the single-file build (assets are not inlined): everything uses procedural fallbacks. */
export const ASSETS_ENABLED: boolean = typeof __ASSETS_ENABLED__ !== 'undefined' ? __ASSETS_ENABLED__ : true;

export type AssetTierSetting = AssetTier | 'off';

export function assetTierForQuality(tier: QualityTier): AssetTier {
  return tier === 'ultra' ? 'ultra' : tier === 'high' ? 'high' : 'mobile';
}

export function parseAssetTier(v: string | null | undefined): AssetTierSetting | null {
  return v === 'off' || (ASSET_TIERS as readonly string[]).includes(v ?? '') ? (v as AssetTierSetting) : null;
}

export interface AssetProgress {
  /** Finished loads / total started since the last idle point. */
  loaded: number;
  total: number;
  bytesLoaded: number;
  bytesTotal: number;
  /** 0..1 (bytes when known). */
  progress: number;
  label: string;
}

export interface Releasable {
  release(): void;
}

export interface TextureSetHandle extends Releasable {
  readonly textures: PbrTextures;
  /** True when every map loaded (false = partial or fallback). */
  readonly complete: boolean;
}

export interface MaterialHandle extends Releasable {
  readonly material: THREE.MeshStandardMaterial;
  readonly fallback: boolean;
}

export interface ModelInstance extends Releasable {
  /** THREE.LOD when the model has several LODs (CrossFadeLOD with `crossFade`), else the scene group. */
  readonly object: THREE.Object3D;
  readonly animations: readonly THREE.AnimationClip[];
  /** Gameplay markers per clip (seconds), from the manifest (empty for fallbacks). */
  readonly clipEvents: { readonly [clip: string]: readonly ClipEventEntry[] };
  readonly skinned: boolean;
  readonly entry: ModelAssetEntry | null;
  readonly fallback: boolean;
  readonly triangles: number;
}

export interface HdriHandle extends Releasable {
  /** Equirectangular HDR texture (scene.background). */
  readonly texture: THREE.Texture;
  /** PMREM-filtered environment (scene.environment). */
  readonly envMap: THREE.Texture;
  readonly sun: SunEntry;
  readonly entry: HdriAssetEntry;
}

export interface ImageHandle extends Releasable {
  readonly entry: ImageAssetEntry;
  /** sRGB (or linear) texture, flipY false, clamp, mipmapped. */
  readonly texture: THREE.Texture;
  readonly width: number;
  readonly height: number;
  /** Multiply the sampled color by this for HDR use (sun sprite). */
  readonly hdrScale: number;
}

export interface ModelLoadOptions {
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Force a single LOD level (index into entry.lods) instead of a THREE.LOD. */
  lod?: number;
  /** Multiplies every LOD switch distance (quality / FOV scaling). */
  lodDistanceScale?: number;
  /** Dithered cross-fade between LOD levels (CrossFadeLOD + per-level dither materials). */
  crossFade?: boolean | CrossFadeOptions;
}

export interface VatLoadOptions {
  /** LOD indices to load (default: from the tier's minLod to the last). */
  lods?: readonly number[];
}

export interface MaterialLoadOptions {
  tint?: THREE.ColorRepresentation;
  uvScale?: readonly [number, number];
  normalScale?: number;
  roughnessScale?: number;
  detailAo?: number;
  vertexTangents?: boolean;
  physical?: boolean;
  side?: THREE.Side;
}

export interface AssetManagerOptions {
  renderer: THREE.WebGLRenderer;
  tier: AssetTierSetting;
  anisotropy?: number;
  /** Base URL of the published asset tree (default `${import.meta.env.BASE_URL}assets/`). */
  baseUrl?: string;
  manifest?: AssetManifest;
}

interface CacheEntry<T> {
  promise: Promise<T>;
  value: T | null;
  refs: number;
  dispose: (v: T) => void;
}

interface LoadedGltf {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

interface AtlasConfig {
  srgb: boolean;
  mipmaps?: boolean;
  repeat?: boolean;
}

const TEXTURE_FETCH_OPTIONS: ImageBitmapOptions = { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' };

export class AssetManager {
  readonly manifest: AssetManifest;
  private tierSetting: AssetTierSetting;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly baseUrl: string;
  private anisotropy: number;
  private readonly textures = new Map<string, CacheEntry<THREE.Texture>>();
  private readonly gltfs = new Map<string, CacheEntry<LoadedGltf>>();
  private readonly hdris = new Map<string, CacheEntry<{ texture: THREE.Texture; envMap: THREE.Texture }>>();
  private readonly materials = new Map<string, CacheEntry<THREE.MeshStandardMaterial>>();
  private readonly vatData = new Map<string, CacheEntry<{ positions: THREE.DataTexture; normals: THREE.DataTexture }>>();
  private readonly luts = new Map<string, CacheEntry<THREE.Data3DTexture>>();
  private readonly modelFallbacks = new Map<string, () => THREE.Object3D>();
  private readonly listeners = new Set<(p: AssetProgress) => void>();
  private readonly warned = new Set<string>();
  /** Loaders are imported lazily (own chunk) the first time a model / HDRI is requested. */
  private loaders: Promise<{ gltf: GLTFLoader; exr: EXRLoader }> | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private progress = { loaded: 0, total: 0, bytesLoaded: 0, bytesTotal: 0, label: '' };
  private inflightBytes = new Map<number, number>();
  private nextLoadId = 1;

  constructor(opts: AssetManagerOptions) {
    this.renderer = opts.renderer;
    this.manifest = opts.manifest ?? ASSET_MANIFEST;
    this.tierSetting = ASSETS_ENABLED ? opts.tier : 'off';
    this.anisotropy = opts.anisotropy ?? 4;
    const base = opts.baseUrl ?? `${typeof import.meta.env !== 'undefined' ? import.meta.env.BASE_URL : './'}assets/`;
    this.baseUrl = base.endsWith('/') ? base : `${base}/`;
  }

  private getLoaders(): Promise<{ gltf: GLTFLoader; exr: EXRLoader }> {
    this.loaders ??= (async () => {
      const [g, e, m] = await Promise.all([
        import('three/examples/jsm/loaders/GLTFLoader.js'),
        import('three/examples/jsm/loaders/EXRLoader.js'),
        import('three/examples/jsm/libs/meshopt_decoder.module.js'),
      ]);
      const gltf = new g.GLTFLoader();
      gltf.setMeshoptDecoder(m.MeshoptDecoder);
      const exr = new e.EXRLoader();
      exr.setDataType(THREE.HalfFloatType);
      return { gltf, exr };
    })();
    return this.loaders;
  }

  // ------------------------------------------------------------------ configuration / queries

  /** Active tier ('off' = procedural fallbacks only). */
  get tier(): AssetTierSetting {
    return this.tierSetting;
  }

  /** Change tier (affects future loads; cached assets keep their tier until released). */
  setTier(tier: AssetTierSetting, anisotropy?: number): void {
    this.tierSetting = ASSETS_ENABLED ? tier : 'off';
    if (anisotropy !== undefined) this.anisotropy = anisotropy;
  }

  get enabled(): boolean {
    return this.tierSetting !== 'off';
  }

  has(id: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.manifest.assets, id);
  }

  entry(id: string): AssetEntry | null {
    return this.has(id) ? (this.manifest.assets[id] ?? null) : null;
  }

  /**
   * Entry to load for `id` on the active tier: the asset itself when it ships on this tier, else its
   * `@fallback` chain (same kind), else null (feature off / procedural fallback).
   */
  resolve<K extends AssetEntry['kind']>(id: string, kind: K): Extract<AssetEntry, { kind: K }> | null {
    const tier = this.tierSetting;
    let e = this.entry(id);
    for (let guard = 0; e && guard < 8; guard++) {
      if (e.kind !== kind) return null;
      if (tier === 'off') return null;
      if (e.tiers.includes(tier)) return e as Extract<AssetEntry, { kind: K }>;
      e = e.fallback ? this.entry(e.fallback) : null;
    }
    return null;
  }

  material(id: MaterialAssetId): MaterialAssetEntry {
    return this.manifest.assets[id] as MaterialAssetEntry;
  }

  model(id: ModelAssetId): ModelAssetEntry {
    return this.manifest.assets[id] as ModelAssetEntry;
  }

  hdri(id: HdriAssetId): HdriAssetEntry {
    return this.manifest.assets[id] as HdriAssetEntry;
  }

  /** Ids of every manifest asset of a kind. */
  list(kind?: AssetEntry['kind']): AssetId[] {
    return Object.keys(this.manifest.assets).filter((k) => !kind || this.manifest.assets[k]?.kind === kind) as AssetId[];
  }

  /** Bytes the given assets ship for the active tier (loading-screen estimates). */
  bytesFor(ids: readonly string[]): number {
    const t = this.tierSetting === 'off' ? null : this.tierSetting;
    return t ? ids.reduce((s, id) => s + (this.entry(id)?.bytes[t] ?? 0), 0) : 0;
  }

  /** Procedural replacement used when a model is unavailable (tier off, missing, failed). */
  registerModelFallback(id: string, factory: () => THREE.Object3D): void {
    this.modelFallbacks.set(id, factory);
  }

  onProgress(cb: (p: AssetProgress) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Label shown with progress events (e.g. "Carving the stupa"). */
  setProgressLabel(label: string): void {
    this.progress.label = label;
    this.emitProgress();
  }

  stats(): { textures: number; models: number; hdris: number; materials: number; vats: number; luts: number } {
    return {
      textures: this.textures.size,
      models: this.gltfs.size,
      hdris: this.hdris.size,
      materials: this.materials.size,
      vats: this.vatData.size,
      luts: this.luts.size,
    };
  }

  // ------------------------------------------------------------------ texture sets

  /**
   * Load a texture set: a material asset id ("sandstone_carved_red") or a model-local set
   * ("stupa_sanchi:macro"). Missing maps are simply absent (factor fallback).
   */
  async loadTextureSet(ref: string): Promise<TextureSetHandle> {
    const resolved = this.resolveSet(ref);
    const tier = this.tierSetting;
    if (!resolved || tier === 'off') {
      if (tier !== 'off') this.warnOnce(ref, `texture set "${ref}" not in the manifest`);
      return { textures: {}, complete: false, release: () => undefined };
    }
    const { set, hash } = resolved;
    const urls: string[] = [];
    const textures: PbrTextures = {};
    let complete = true;
    await Promise.all(
      (Object.keys(set.maps) as TextureMapName[]).map(async (map) => {
        const file = set.maps[map]?.[tier];
        if (!file || map === 'height') return;
        const url = this.url(file.url, hash);
        try {
          const tex = await this.acquireTexture(url, map, file.bytes);
          urls.push(url);
          (textures as Record<string, THREE.Texture>)[map] = tex;
        } catch (err) {
          complete = false;
          this.warnOnce(url, `texture ${file.url} failed: ${String(err)}`);
        }
      }),
    );
    let released = false;
    return {
      textures,
      complete,
      release: () => {
        if (released) return;
        released = true;
        for (const u of urls) this.releaseFrom(this.textures, u);
      },
    };
  }

  /** PBR material for a material asset (shared per option set, ref-counted). */
  async loadMaterial(id: MaterialAssetId | string, opts: MaterialLoadOptions = {}): Promise<MaterialHandle> {
    const key = `${id}|${JSON.stringify(opts)}`;
    const entry = this.entry(id);
    const shipped = this.resolve(id, 'material');
    const fallback = !shipped;
    const value = await this.acquire(this.materials, key, async () => {
      const set = shipped ? await this.loadTextureSet(shipped.id) : null;
      const base = shipped ?? (entry && entry.kind === 'material' ? entry : null);
      const mat = createPbrMaterial(set?.textures ?? {}, {
        name: id,
        fallbackColor: base ? base.averageColor : '#808080',
        roughness: base ? base.roughness : 0.8,
        ...opts,
        normalScale: (opts.normalScale ?? 1) * (base ? base.normalScale : 1),
      });
      mat.userData.setHandle = set;
      return mat;
    }, (m) => {
      (m.userData.setHandle as TextureSetHandle | null)?.release();
      disposePbrMaterial(m);
    });
    let released = false;
    return {
      material: value,
      fallback,
      release: () => {
        if (released) return;
        released = true;
        this.releaseFrom(this.materials, key);
      },
    };
  }

  // ------------------------------------------------------------------ models

  async loadModel(id: ModelAssetId | string, opts: ModelLoadOptions = {}): Promise<ModelInstance> {
    const entry = this.resolve(id, 'model');
    const raw = this.entry(id);
    if (!entry || this.tierSetting === 'off') {
      if (this.tierSetting !== 'off' && !raw) this.warnOnce(id, `model "${id}" not in the manifest`);
      return this.fallbackModel(id, raw && raw.kind === 'model' ? raw : null);
    }
    const tier = this.tierSetting;
    const minLod = Math.min(entry.minLod[tier] ?? 0, entry.lods.length - 1);
    const levels = opts.lod !== undefined ? [entry.lods[Math.min(opts.lod, entry.lods.length - 1)]!] : entry.lods.slice(minLod);
    const acquiredGltf: string[] = [];
    const acquiredMats: Releasable[] = [];
    try {
      const loaded = await Promise.all(
        levels.map(async (lod) => {
          const url = this.url(lod.url, entry.hash);
          const gltf = await this.acquire(this.gltfs, url, () => this.fetchGltf(url, lod.bytes), (g) => disposeGltf(g));
          acquiredGltf.push(url);
          return { lod, gltf };
        }),
      );
      const scale = opts.lodDistanceScale ?? 1;
      let root: THREE.Object3D = loaded.length > 1 ? new THREE.LOD() : new THREE.Group();
      root.name = entry.id;
      let triangles = 0;
      let animations: THREE.AnimationClip[] = [];
      const skinned = entry.skinned || loaded.some((l) => l.gltf.animations.length > 0);
      let primary: THREE.Object3D | null = null;
      for (let i = 0; i < loaded.length; i++) {
        const { lod, gltf } = loaded[i]!;
        const scene = (skinned ? SkeletonUtils.clone(gltf.scene) : gltf.scene.clone(true)) as THREE.Group;
        scene.name = `${entry.id}_lod${lod.lod}`;
        await this.bindMaterials(entry.id, scene, acquiredMats);
        // meta.vertexColors === 'data': COLOR_0 carries data (e.g. banner cloth weights), not albedo.
        const colorIsData = entry.meta.vertexColors === 'data';
        scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = opts.castShadow ?? true;
            m.receiveShadow = opts.receiveShadow ?? true;
            if (colorIsData) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.vertexColors = false;
          }
        });
        if (skinned) {
          if (!primary) primary = scene;
          else shareSkeleton(primary, scene);
        }
        if (root instanceof THREE.LOD) root.addLevel(scene, i === 0 ? 0 : lod.distance * scale);
        else root.add(scene);
        if (i === 0) {
          triangles = lod.triangles;
          animations = gltf.animations;
        }
      }
      let disposeFade: (() => void) | null = null;
      if (opts.crossFade && root instanceof THREE.LOD) {
        const cf = makeCrossFadeLod(root, typeof opts.crossFade === 'object' ? opts.crossFade : {});
        root = cf.lod;
        disposeFade = cf.dispose;
      }
      let released = false;
      const object = root;
      return {
        object,
        animations,
        clipEvents: entry.clipEvents,
        skinned,
        entry,
        fallback: false,
        triangles,
        release: () => {
          if (released) return;
          released = true;
          object.removeFromParent();
          // SkeletonUtils clones own their Skeleton (and its bone texture): free them.
          object.traverse((o) => {
            const sm = o as THREE.SkinnedMesh;
            if (sm.isSkinnedMesh) sm.skeleton.dispose();
          });
          disposeFade?.();
          for (const m of acquiredMats) m.release();
          for (const u of acquiredGltf) this.releaseFrom(this.gltfs, u);
        },
      };
    } catch (err) {
      for (const m of acquiredMats) m.release();
      for (const u of acquiredGltf) this.releaseFrom(this.gltfs, u);
      this.warnOnce(id, `model "${id}" failed to load: ${String(err)}`);
      return this.fallbackModel(id, entry);
    }
  }

  private async fetchGltf(url: string, bytes: number): Promise<LoadedGltf> {
    const id = this.beginLoad(bytes);
    try {
      const { gltf: loader } = await this.getLoaders();
      const gltf = await loader.loadAsync(url, (e: ProgressEvent) => this.updateLoad(id, e.loaded));
      return { scene: gltf.scene, animations: gltf.animations };
    } finally {
      this.endLoad(id, bytes);
    }
  }

  /** Replace proxy materials (extras.samrajya_set) with runtime PBR materials. */
  private async bindMaterials(modelId: string, scene: THREE.Object3D, acquired: Releasable[]): Promise<void> {
    const meshes: THREE.Mesh[] = [];
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    const cache = new Map<string, Promise<THREE.Material>>();
    for (const mesh of meshes) {
      const src = mesh.material as THREE.MeshStandardMaterial;
      const ud = src.userData as Record<string, unknown>;
      const set = typeof ud.samrajya_set === 'string' ? ud.samrajya_set : null;
      if (!set) continue;
      const hasTangents = !!mesh.geometry.getAttribute('tangent');
      const opts = {
        tint: typeof ud.samrajya_tint === 'string' ? ud.samrajya_tint : undefined,
        uvScale: Array.isArray(ud.samrajya_uv_scale) ? (ud.samrajya_uv_scale as [number, number]) : undefined,
        normalScale: typeof ud.samrajya_normal_scale === 'number' ? ud.samrajya_normal_scale : undefined,
        roughnessScale: typeof ud.samrajya_roughness_scale === 'number' ? ud.samrajya_roughness_scale : undefined,
        detailAo: typeof ud.samrajya_detail_ao === 'number' ? ud.samrajya_detail_ao : undefined,
        vertexTangents: hasTangents,
        side: src.side,
      };
      const macroRef = typeof ud.samrajya_macro === 'string' ? ud.samrajya_macro : null;
      const key = `${set}|${macroRef ?? ''}|${JSON.stringify(opts)}`;
      let p = cache.get(key);
      if (!p) {
        p = this.modelMaterial(modelId, set, macroRef, opts, src, acquired);
        cache.set(key, p);
      }
      mesh.material = await p;
    }
  }

  private async modelMaterial(
    modelId: string,
    setRef: string,
    macroRef: string | null,
    opts: MaterialLoadOptions,
    proxy: THREE.MeshStandardMaterial,
    acquired: Releasable[],
  ): Promise<THREE.Material> {
    const key = `model:${modelId}|${setRef}|${macroRef ?? ''}|${JSON.stringify(opts)}|${this.tierSetting}`;
    const mat = await this.acquire(this.materials, key, async () => {
      const set = await this.loadTextureSet(setRef);
      const macro = macroRef ? await this.loadTextureSet(macroRef) : null;
      const matEntry = this.entry(setRef);
      const m = createPbrMaterial(
        { ...set.textures, macro: macro?.textures.macro ?? null },
        {
          name: setRef,
          // Proxy factors = average color x tint and roughness (graceful fallback when textures fail).
          fallbackColor: proxy.color,
          roughness: proxy.roughness,
          ...opts,
          tint: set.textures.baseColor ? opts.tint : 0xffffff,
          normalScale: (opts.normalScale ?? 1) * (matEntry && matEntry.kind === 'material' ? matEntry.normalScale : 1),
        },
      );
      m.userData.setHandles = [set, macro];
      return m;
    }, (m) => {
      for (const h of (m.userData.setHandles as (TextureSetHandle | null)[]) ?? []) h?.release();
      disposePbrMaterial(m);
    });
    let released = false;
    acquired.push({
      release: () => {
        if (released) return;
        released = true;
        this.releaseFrom(this.materials, key);
      },
    });
    return mat;
  }

  private fallbackModel(id: string, entry: ModelAssetEntry | null): ModelInstance {
    const factory = this.modelFallbacks.get(id);
    let object: THREE.Object3D;
    if (factory) object = factory();
    else {
      const b = entry?.bounds;
      const size = b ? new THREE.Vector3(b.max[0]! - b.min[0]!, b.max[1]! - b.min[1]!, b.max[2]! - b.min[2]!) : new THREE.Vector3(1, 1, 1);
      const geo = new THREE.BoxGeometry(Math.max(size.x, 0.1), Math.max(size.y, 0.1), Math.max(size.z, 0.1));
      const mat = new THREE.MeshStandardMaterial({ color: 0x8a6a58, roughness: 0.9 });
      const mesh = new THREE.Mesh(geo, mat);
      if (b) mesh.position.set(b.center[0]!, b.center[1]!, b.center[2]!);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      object = new THREE.Group();
      object.add(mesh);
    }
    object.name = `${id}_fallback`;
    let released = false;
    return {
      object,
      animations: [],
      clipEvents: {},
      skinned: false,
      entry,
      fallback: true,
      triangles: 0,
      release: () => {
        if (released) return;
        released = true;
        object.removeFromParent();
        const own = object.userData.dispose as (() => void) | undefined;
        own?.();
        if (!factory) {
          object.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh) {
              m.geometry.dispose();
              (m.material as THREE.Material).dispose();
            }
          });
        }
      },
    };
  }

  // ------------------------------------------------------------------ HDRIs

  /** HDR sky: equirect texture + PMREM env map + sun description. null when unavailable. */
  async loadHdri(id: HdriAssetId | string): Promise<HdriHandle | null> {
    const entry = this.resolve(id, 'hdri');
    if (!entry || this.tierSetting === 'off') {
      if (this.tierSetting !== 'off' && !this.entry(id)) this.warnOnce(id, `hdri "${id}" not in the manifest`);
      return null;
    }
    const file = entry.files[this.tierSetting];
    if (!file) return null;
    const url = this.url(file.url, entry.hash);
    try {
      const v = await this.acquire(
        this.hdris,
        url,
        async () => {
          const lid = this.beginLoad(file.bytes);
          try {
            const { exr } = await this.getLoaders();
            const tex = await exr.loadAsync(url, (e: ProgressEvent) => this.updateLoad(lid, e.loaded));
            tex.mapping = THREE.EquirectangularReflectionMapping;
            tex.colorSpace = THREE.LinearSRGBColorSpace;
            tex.minFilter = THREE.LinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.generateMipmaps = false;
            this.pmrem ??= new THREE.PMREMGenerator(this.renderer);
            const rt = this.pmrem.fromEquirectangular(tex);
            return { texture: tex as THREE.Texture, envMap: rt.texture as THREE.Texture, rt };
          } finally {
            this.endLoad(lid, file.bytes);
          }
        },
        (h) => {
          h.texture.dispose();
          (h as { rt?: THREE.WebGLRenderTarget }).rt?.dispose();
        },
      );
      let released = false;
      return {
        texture: v.texture,
        envMap: v.envMap,
        sun: entry.sun,
        entry,
        release: () => {
          if (released) return;
          released = true;
          this.releaseFrom(this.hdris, url);
        },
      };
    } catch (err) {
      this.warnOnce(url, `hdri ${file.url} failed: ${String(err)}`);
      return null;
    }
  }

  // ------------------------------------------------------------------ VAT crowds

  /**
   * Vertex-animation crowd unit: per LOD the rest-pose geometry (vertex i == VAT column i), its bound
   * material and the position / normal textures. Build materials with loaders/vat createVatMaterial.
   */
  async loadVat(id: VatAssetId | string, opts: VatLoadOptions = {}): Promise<VatHandle | null> {
    const entry = this.resolve(id, 'vat');
    if (!entry || this.tierSetting === 'off') {
      if (this.tierSetting !== 'off' && !this.entry(id)) this.warnOnce(id, `vat "${id}" not in the manifest`);
      return null;
    }
    const tier = this.tierSetting;
    const minLod = Math.min(entry.minLod[tier] ?? 0, entry.lods.length - 1);
    const wanted = opts.lods ? entry.lods.filter((l) => opts.lods!.includes(l.lod)) : entry.lods.slice(minLod);
    const gltfUrls: string[] = [];
    const dataUrls: string[] = [];
    const mats: Releasable[] = [];
    const releaseAll = (): void => {
      for (const m of mats) m.release();
      for (const u of gltfUrls) this.releaseFrom(this.gltfs, u);
      for (const u of dataUrls) this.releaseFrom(this.vatData, u);
    };
    try {
      const lods = await Promise.all(
        wanted.map(async (lod): Promise<VatLodData> => {
          const gurl = this.url(lod.url, entry.hash);
          const durl = this.url(lod.vat.url, entry.hash);
          const [gltf, data] = await Promise.all([
            this.acquire(this.gltfs, gurl, () => this.fetchGltf(gurl, lod.bytes), (g) => disposeGltf(g)).then((g) => {
              gltfUrls.push(gurl);
              return g;
            }),
            this.acquire(
              this.vatData,
              durl,
              async () => {
                const lid = this.beginLoad(lod.vat.bytes);
                try {
                  const bytes = await fetchBytes(durl, (n) => this.updateLoad(lid, n));
                  const tex = createVatTextures(await decodeVat(bytes, lod), lod);
                  this.initTexture(tex.positions);
                  this.initTexture(tex.normals);
                  return tex;
                } finally {
                  this.endLoad(lid, lod.vat.bytes);
                }
              },
              (t) => {
                t.positions.dispose();
                t.normals.dispose();
              },
            ).then((d) => {
              dataUrls.push(durl);
              return d;
            }),
          ]);
          let mesh: THREE.Mesh | null = null;
          gltf.scene.traverse((o) => {
            if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
          });
          if (!mesh) throw new Error(`${lod.url}: no mesh`);
          const m = mesh as THREE.Mesh;
          const geo = m.geometry;
          if (geo.getAttribute('position').count !== lod.vertices) throw new Error(`${lod.url}: ${geo.getAttribute('position').count} vertices, VAT has ${lod.vertices}`);
          const color = geo.getAttribute('color');
          if (color && !geo.getAttribute('vatColor')) geo.setAttribute('vatColor', color);
          else if (!color && !geo.getAttribute('vatColor'))
            geo.setAttribute('vatColor', new THREE.BufferAttribute(new Uint8Array(lod.vertices * 4).fill(0), 4, true));
          applyVatBounds(geo, entry);
          const holder = new THREE.Group();
          const proxy = new THREE.Mesh(geo, m.material);
          holder.add(proxy);
          await this.bindMaterials(entry.id, holder, mats);
          const material = proxy.material as THREE.MeshStandardMaterial;
          return { lod: lod.lod, entry: lod, geometry: geo, material, positions: data.positions, normals: data.normals };
        }),
      );
      let released = false;
      return {
        entry,
        lods,
        clip: (name: string) => entry.clips.find((c) => c.name === name) ?? null,
        release: () => {
          if (released) return;
          released = true;
          releaseAll();
        },
      };
    } catch (err) {
      releaseAll();
      this.warnOnce(id, `vat "${id}" failed to load: ${String(err)}`);
      return null;
    }
  }

  // ------------------------------------------------------------------ impostors, flipbooks, images, LUTs

  /** Hemi-octahedral impostor atlases (albedo + normal/depth) for the active tier, or null. */
  async loadImpostor(id: ImpostorAssetId | string): Promise<ImpostorHandle | null> {
    const entry = this.resolve(id, 'impostor');
    const tier = this.tierSetting;
    if (!entry || tier === 'off') {
      if (tier !== 'off' && !this.entry(id)) this.warnOnce(id, `impostor "${id}" not in the manifest`);
      return null;
    }
    const a = entry.maps.albedo[tier];
    const n = entry.maps.normal[tier];
    if (!a || !n) return null;
    const got: string[] = [];
    try {
      const [albedo, normal] = await Promise.all([
        this.acquireAtlas(this.url(a.url, entry.hash), a.bytes, { srgb: true }).then((t) => (got.push(this.url(a.url, entry.hash)), t)),
        this.acquireAtlas(this.url(n.url, entry.hash), n.bytes, { srgb: false }).then((t) => (got.push(this.url(n.url, entry.hash)), t)),
      ]);
      return { entry, albedo, normal, framePx: a.framePx, release: this.releaser(this.textures, got) };
    } catch (err) {
      for (const u of got) this.releaseFrom(this.textures, u);
      this.warnOnce(id, `impostor "${id}" failed to load: ${String(err)}`);
      return null;
    }
  }

  /** Flipbook atlases (color + optional normal / emissive) for the active tier, or null. */
  async loadFlipbook(id: FlipbookAssetId | string): Promise<FlipbookHandle | null> {
    const entry = this.resolve(id, 'flipbook');
    const tier = this.tierSetting;
    if (!entry || tier === 'off') {
      if (tier !== 'off' && !this.entry(id)) this.warnOnce(id, `flipbook "${id}" not in the manifest`);
      return null;
    }
    const got: string[] = [];
    const load = async (f: { url: string; bytes: number } | undefined, srgb: boolean): Promise<THREE.Texture | null> => {
      if (!f) return null;
      const url = this.url(f.url, entry.hash);
      const t = await this.acquireAtlas(url, f.bytes, { srgb });
      got.push(url);
      return t;
    };
    try {
      const [color, normal, emissive] = await Promise.all([
        load(entry.maps.color[tier], true),
        load(entry.maps.normal?.[tier], false),
        load(entry.maps.emissive?.[tier], true),
      ]);
      if (!color) throw new Error('no color atlas for this tier');
      return {
        entry,
        color,
        normal,
        emissive,
        sequence: (name: string) => entry.sequences.find((s) => s.name === name) ?? null,
        release: this.releaser(this.textures, got),
      };
    } catch (err) {
      for (const u of got) this.releaseFrom(this.textures, u);
      this.warnOnce(id, `flipbook "${id}" failed to load: ${String(err)}`);
      return null;
    }
  }

  /** sRGB image (sun sprite, lens dirt, portraits, key art) for the active tier, or null. */
  async loadImage(id: ImageAssetId | string): Promise<ImageHandle | null> {
    const entry = this.resolve(id, 'image');
    const tier = this.tierSetting;
    if (!entry || tier === 'off') {
      if (tier !== 'off' && !this.entry(id)) this.warnOnce(id, `image "${id}" not in the manifest`);
      return null;
    }
    const f = entry.files[tier];
    if (!f) return null;
    const url = this.url(f.url, entry.hash);
    try {
      const texture = await this.acquireAtlas(url, f.bytes, { srgb: entry.colorSpace === 'srgb' });
      return { entry, texture, width: f.width, height: f.height, hdrScale: entry.hdrScale, release: this.releaser(this.textures, [url]) };
    } catch (err) {
      this.warnOnce(id, `image "${id}" failed to load: ${String(err)}`);
      return null;
    }
  }

  /** 32^3 grading LUT as a Data3DTexture (display-referred, applied after tone mapping + grade), or null. */
  async loadLut(id: LutAssetId | string): Promise<LutHandle | null> {
    const entry = this.resolve(id, 'lut');
    const tier = this.tierSetting;
    if (!entry || tier === 'off') {
      if (tier !== 'off' && !this.entry(id)) this.warnOnce(id, `lut "${id}" not in the manifest`);
      return null;
    }
    const f = entry.files[tier];
    if (!f) return null;
    const url = this.url(f.url, entry.hash);
    try {
      const texture = await this.acquire(
        this.luts,
        url,
        async () => {
          const lid = this.beginLoad(f.bytes);
          try {
            const bytes = await fetchBytes(url, (n) => this.updateLoad(lid, n));
            const bmp = await decodeBitmap(bytes, 'image/png');
            try {
              if (bmp.width !== entry.size * entry.size || bmp.height !== entry.size) throw new Error(`LUT strip is ${bmp.width}x${bmp.height}`);
              const tex = createLutTexture(stripToVolume(bitmapPixels(bmp), entry.size), entry.size);
              tex.name = url;
              return tex;
            } finally {
              bmp.close();
            }
          } finally {
            this.endLoad(lid, f.bytes);
          }
        },
        (t) => t.dispose(),
      );
      return { entry, texture, size: entry.size, strength: entry.strength, release: this.releaser(this.luts, [url]) };
    } catch (err) {
      this.warnOnce(id, `lut "${id}" failed to load: ${String(err)}`);
      return null;
    }
  }

  /** Warm the caches for a set of assets (loading screens). Resolves when all settled. */
  async preload(ids: readonly string[], label = 'Loading assets'): Promise<void> {
    this.setProgressLabel(label);
    const handles: Releasable[] = [];
    await Promise.all(
      ids.map(async (id) => {
        const e = this.entry(id);
        if (!e) return;
        let h: Releasable | null = null;
        switch (e.kind) {
          case 'material':
            h = await this.loadTextureSet(id);
            break;
          case 'model':
            h = await this.loadModel(id);
            break;
          case 'hdri':
            h = await this.loadHdri(id);
            break;
          case 'vat':
            h = await this.loadVat(id);
            break;
          case 'impostor':
            h = await this.loadImpostor(id);
            break;
          case 'flipbook':
            h = await this.loadFlipbook(id);
            break;
          case 'lut':
            h = await this.loadLut(id);
            break;
          case 'image':
            h = await this.loadImage(id);
            break;
        }
        if (h) handles.push(h);
      }),
    );
    // Keep the cache warm for one frame so the caller's own loads hit it, then drop our refs.
    setTimeout(() => handles.forEach((h) => h.release()), 0);
  }

  dispose(): void {
    for (const map of [this.materials, this.gltfs, this.hdris, this.textures, this.vatData, this.luts] as Map<string, CacheEntry<unknown>>[]) {
      for (const e of map.values()) if (e.value) e.dispose(e.value);
      map.clear();
    }
    this.pmrem?.dispose();
    this.pmrem = null;
    this.listeners.clear();
  }

  // ------------------------------------------------------------------ internals

  private url(rel: string, hash: string): string {
    return `${this.baseUrl}${rel}${hash ? `?v=${hash}` : ''}`;
  }

  /** Texture set of a material asset (following @fallback on this tier) or a model-local set. */
  private resolveSet(ref: string): { set: TextureSetEntry; hash: string } | null {
    const [id, local] = ref.split(':') as [string, string | undefined];
    if (local) {
      const e = this.entry(id);
      if (!e) return null;
      const set = e.kind === 'model' || e.kind === 'vat' ? (e.sets[local] ?? null) : null;
      return set ? { set, hash: e.hash } : null;
    }
    const m = this.resolve(id, 'material');
    return m ? { set: m, hash: m.hash } : null;
  }

  private releaser<T>(map: Map<string, CacheEntry<T>>, keys: readonly string[]): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const k of keys) this.releaseFrom(map, k);
    };
  }

  private async acquire<T>(map: Map<string, CacheEntry<T>>, key: string, create: () => Promise<T>, dispose: (v: T) => void): Promise<T> {
    let e = map.get(key);
    if (!e) {
      const entry: CacheEntry<T> = { promise: create(), value: null, refs: 0, dispose };
      e = entry;
      map.set(key, entry);
      entry.promise.then(
        (v) => {
          entry.value = v;
          // Released while loading: dispose now.
          if (entry.refs <= 0 && map.get(key) !== entry) dispose(v);
        },
        () => {
          if (map.get(key) === entry) map.delete(key);
        },
      );
    }
    e.refs++;
    try {
      return await e.promise;
    } catch (err) {
      e.refs--;
      throw err;
    }
  }

  private releaseFrom<T>(map: Map<string, CacheEntry<T>>, key: string): void {
    const e = map.get(key);
    if (!e) return;
    e.refs--;
    if (e.refs > 0) return;
    map.delete(key);
    if (e.value) e.dispose(e.value);
  }

  private async acquireTexture(url: string, map: TextureMapName, bytes: number): Promise<THREE.Texture> {
    return this.acquire(this.textures, url, async () => {
      const tex = await this.fetchTexture(url, bytes);
      configureSetTexture(tex, map === 'height' ? 'orm' : map, this.anisotropy);
      this.initTexture(tex);
      return tex;
    }, (t) => t.dispose());
  }

  /** Atlas / image texture: clamp to edge, mipmapped, sRGB or linear. Cached by URL. */
  private async acquireAtlas(url: string, bytes: number, cfg: AtlasConfig): Promise<THREE.Texture> {
    return this.acquire(this.textures, url, async () => {
      const tex = await this.fetchTexture(url, bytes);
      tex.flipY = false;
      tex.colorSpace = cfg.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.wrapS = cfg.repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      tex.wrapT = tex.wrapS;
      tex.generateMipmaps = cfg.mipmaps !== false;
      tex.minFilter = tex.generateMipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = Math.max(1, this.anisotropy);
      tex.needsUpdate = true;
      this.initTexture(tex);
      return tex;
    }, (t) => t.dispose());
  }

  private initTexture(tex: THREE.Texture): void {
    try {
      this.renderer.initTexture(tex);
    } catch {
      // upload lazily on first use
    }
  }

  private async fetchTexture(url: string, bytes: number): Promise<THREE.Texture> {
    const id = this.beginLoad(bytes);
    try {
      const data = await fetchBytes(url, (n) => this.updateLoad(id, n));
      let tex: THREE.Texture;
      if (typeof createImageBitmap === 'function') {
        const blob = new Blob([data], { type: mimeOf(url) });
        let bmp: ImageBitmap;
        try {
          bmp = await createImageBitmap(blob, TEXTURE_FETCH_OPTIONS);
        } catch {
          bmp = await createImageBitmap(blob);
        }
        tex = new THREE.Texture(bmp);
        tex.userData.bitmap = bmp;
        tex.addEventListener('dispose', () => bmp.close());
      } else {
        tex = new THREE.Texture(await blobToImage(new Blob([data], { type: mimeOf(url) })));
      }
      tex.name = url;
      return tex;
    } finally {
      this.endLoad(id, bytes);
    }
  }

  private beginLoad(bytes: number): number {
    const id = this.nextLoadId++;
    this.progress.total++;
    this.progress.bytesTotal += bytes;
    this.inflightBytes.set(id, 0);
    this.emitProgress();
    return id;
  }

  private updateLoad(id: number, loaded: number): void {
    if (!this.inflightBytes.has(id)) return;
    this.inflightBytes.set(id, loaded);
    this.emitProgress();
  }

  private endLoad(id: number, bytes: number): void {
    this.inflightBytes.delete(id);
    this.progress.loaded++;
    this.progress.bytesLoaded += bytes;
    this.emitProgress();
    if (this.progress.loaded >= this.progress.total) {
      // Idle: reset counters for the next batch.
      this.progress = { loaded: 0, total: 0, bytesLoaded: 0, bytesTotal: 0, label: this.progress.label };
    }
  }

  private emitProgress(): void {
    if (!this.listeners.size) return;
    let inflight = 0;
    for (const v of this.inflightBytes.values()) inflight += v;
    const p = this.progress;
    const bytesLoaded = Math.min(p.bytesTotal, p.bytesLoaded + inflight);
    const ev: AssetProgress = {
      loaded: p.loaded,
      total: p.total,
      bytesLoaded,
      bytesTotal: p.bytesTotal,
      progress: p.bytesTotal > 0 ? bytesLoaded / p.bytesTotal : p.total > 0 ? p.loaded / p.total : 1,
      label: p.label,
    };
    for (const l of this.listeners) l(ev);
  }

  private warnOnce(key: string, msg: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(`[assets] ${msg} - using procedural fallback`);
  }
}

/** Rebind every SkinnedMesh under `other` to the bones (by name) of `primary`: one mixer drives all LODs. */
function shareSkeleton(primary: THREE.Object3D, other: THREE.Object3D): void {
  const bones = new Map<string, THREE.Bone>();
  primary.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
  });
  other.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh) return;
    const sk = sm.skeleton;
    const mapped = sk.bones.map((b) => bones.get(b.name) ?? b);
    const old = sk;
    sm.bind(new THREE.Skeleton(mapped, sk.boneInverses), sm.bindMatrix);
    old.dispose();
  });
}

function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image decode failed'));
    };
    img.src = url;
  });
}

function disposeGltf(g: LoadedGltf): void {
  g.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose();
  });
}
