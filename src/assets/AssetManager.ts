/**
 * Runtime asset manager for content-pipeline assets (tools/assets -> public/assets -> manifest.ts).
 * OWNER: CTO + Technical Art Director.
 *
 *   const assets = ctx.assets;                                    // created in main.ts
 *   const sky = await assets.loadHdri('sky_day');                 // { texture, envMap, sun, release }
 *   const stupa = await assets.loadModel('stupa_sanchi');         // { object (THREE.LOD), entry, release }
 *   const stone = await assets.loadMaterial('sandstone_carved_red', { uvScale: [2, 1] });
 *   assets.onProgress((p) => ...);                                // loading-screen progress (bytes + items)
 *   ... later: stupa.release(); stone.release(); sky.release();   // ref-counted; GPU memory freed at 0
 *
 * - Tier: AssetTier from the quality tier (ultra -> ultra, high -> high, medium/low -> mobile) or
 *   ?assets=ultra|high|mobile|off. 'off' (and the single-file build) never fetch: procedural fallbacks.
 * - Textures: fetch -> createImageBitmap (no premultiply / color conversion, flipY false like glTF) ->
 *   uploaded during loading (renderer.initTexture) so the first frame does not hitch.
 * - Models: GLTFLoader + MeshoptDecoder; texture-less proxy materials are replaced by PBR materials bound
 *   to the shared (tier-appropriate) texture sets named in their glTF extras (see tools/blender/lib/export.py).
 * - Fallbacks: a missing/failed asset never breaks the game - models fall back to a registered procedural
 *   factory (registerModelFallback) or a bounds-sized block in the asset's average color; materials to
 *   factor-only PBR; HDRIs resolve to null (caller keeps its procedural sky). Failures are console.warn'ed.
 */
import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { QualityTier } from '../core/types';
import { configureSetTexture, createPbrMaterial, disposePbrMaterial, type PbrTextures } from '../render/materials/pbr';
import { ASSET_MANIFEST, type AssetId, type HdriAssetId, type MaterialAssetId, type ModelAssetId } from './manifest';
import type {
  AssetEntry,
  AssetManifest,
  AssetTier,
  HdriAssetEntry,
  MaterialAssetEntry,
  ModelAssetEntry,
  SunEntry,
  TextureMapName,
  TextureSetEntry,
} from './types';
import { ASSET_TIERS } from './types';

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
  /** THREE.LOD when the model has several LODs, else the scene group. Add it to your scene. */
  readonly object: THREE.Object3D;
  readonly animations: readonly THREE.AnimationClip[];
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

export interface ModelLoadOptions {
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Force a single LOD level (index into entry.lods) instead of a THREE.LOD. */
  lod?: number;
  /** Multiplies every LOD switch distance (quality / FOV scaling). */
  lodDistanceScale?: number;
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

  stats(): { textures: number; models: number; hdris: number; materials: number } {
    return { textures: this.textures.size, models: this.gltfs.size, hdris: this.hdris.size, materials: this.materials.size };
  }

  // ------------------------------------------------------------------ texture sets

  /**
   * Load a texture set: a material asset id ("sandstone_carved_red") or a model-local set
   * ("stupa_sanchi:macro"). Missing maps are simply absent (factor fallback).
   */
  async loadTextureSet(ref: string): Promise<TextureSetHandle> {
    const set = this.resolveSet(ref);
    const tier = this.tierSetting;
    if (!set || tier === 'off') {
      if (tier !== 'off') this.warnOnce(ref, `texture set "${ref}" not in the manifest`);
      return { textures: {}, complete: false, release: () => undefined };
    }
    const hash = this.entry(ref.split(':')[0] ?? ref)?.hash ?? '';
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
    const fallback = !entry || entry.kind !== 'material' || this.tierSetting === 'off';
    const value = await this.acquire(this.materials, key, async () => {
      const set = fallback ? null : await this.loadTextureSet(id);
      const mat = createPbrMaterial(set?.textures ?? {}, {
        name: id,
        fallbackColor: entry && entry.kind === 'material' ? entry.averageColor : '#808080',
        roughness: entry && entry.kind === 'material' ? entry.roughness : 0.8,
        ...opts,
        normalScale: (opts.normalScale ?? 1) * (entry && entry.kind === 'material' ? entry.normalScale : 1),
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
    const entry = this.entry(id);
    if (!entry || entry.kind !== 'model' || this.tierSetting === 'off') {
      if (this.tierSetting !== 'off') this.warnOnce(id, `model "${id}" not in the manifest`);
      return this.fallbackModel(id, entry && entry.kind === 'model' ? entry : null);
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
      const root = loaded.length > 1 ? new THREE.LOD() : new THREE.Group();
      root.name = id;
      let triangles = 0;
      let animations: THREE.AnimationClip[] = [];
      for (let i = 0; i < loaded.length; i++) {
        const { lod, gltf } = loaded[i]!;
        const scene = (gltf.animations.length ? SkeletonUtils.clone(gltf.scene) : gltf.scene.clone(true)) as THREE.Group;
        scene.name = `${id}_lod${lod.lod}`;
        await this.bindMaterials(id, scene, acquiredMats);
        scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = opts.castShadow ?? true;
            m.receiveShadow = opts.receiveShadow ?? true;
          }
        });
        if (root instanceof THREE.LOD) root.addLevel(scene, i === 0 ? 0 : lod.distance * scale);
        else root.add(scene);
        if (i === 0) {
          triangles = lod.triangles;
          animations = gltf.animations;
        }
      }
      let released = false;
      return {
        object: root,
        animations,
        entry,
        fallback: false,
        triangles,
        release: () => {
          if (released) return;
          released = true;
          root.removeFromParent();
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
    const key = `model:${modelId}|${setRef}|${macroRef ?? ''}|${JSON.stringify(opts)}`;
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
      if (this.tierSetting !== 'off') this.warnOnce(id, `hdri "${id}" not in the manifest`);
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

  /** Warm the caches for a set of assets (loading screens). Resolves when all settled. */
  async preload(ids: readonly string[], label = 'Loading assets'): Promise<void> {
    this.setProgressLabel(label);
    const handles: Releasable[] = [];
    await Promise.all(
      ids.map(async (id) => {
        const e = this.entry(id);
        if (!e) return;
        if (e.kind === 'material') handles.push(await this.loadTextureSet(id));
        else if (e.kind === 'model') handles.push(await this.loadModel(id));
        else {
          const h = await this.loadHdri(id);
          if (h) handles.push(h);
        }
      }),
    );
    // Keep the cache warm for one frame so the caller's own loads hit it, then drop our refs.
    setTimeout(() => handles.forEach((h) => h.release()), 0);
  }

  dispose(): void {
    for (const map of [this.materials, this.gltfs, this.hdris, this.textures] as Map<string, CacheEntry<unknown>>[]) {
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

  private resolveSet(ref: string): TextureSetEntry | null {
    const [id, local] = ref.split(':') as [string, string | undefined];
    const e = this.entry(id);
    if (!e) return null;
    if (local) return e.kind === 'model' ? (e.sets[local] ?? null) : null;
    return e.kind === 'material' ? e : null;
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
    return this.acquire(this.textures, url, () => this.fetchTexture(url, map, bytes), (t) => t.dispose());
  }

  private async fetchTexture(url: string, map: TextureMapName, bytes: number): Promise<THREE.Texture> {
    const id = this.beginLoad(bytes);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let blob: Blob;
      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          got += value.byteLength;
          this.updateLoad(id, got);
        }
        blob = new Blob(chunks, { type: res.headers.get('content-type') ?? 'image/webp' });
      } else blob = await res.blob();
      let tex: THREE.Texture;
      if (typeof createImageBitmap === 'function') {
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
        const img = await blobToImage(blob);
        tex = new THREE.Texture(img);
      }
      tex.name = url;
      configureSetTexture(tex, map === 'height' ? 'orm' : map, this.anisotropy);
      try {
        this.renderer.initTexture(tex);
      } catch {
        // upload lazily on first use
      }
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
