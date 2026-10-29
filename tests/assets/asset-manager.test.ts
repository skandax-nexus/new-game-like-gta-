/**
 * AssetManager ref counting under partial failure (TA-07 rework round 1, CTO blocker 5). OWNER: Technical Artist G (TA-07).
 *
 * The multi-part loaders (loadVat, loadImpostor, loadFlipbook, loadModel) acquire several cache entries in
 * parallel. Before AcquireScope, a part that resolved AFTER a sibling had failed pushed its key into an array that
 * had already been released: its refs never returned to 0 and its texture / GLB stayed on the GPU until
 * AssetManager.dispose(). These tests run the real loaders against the published pipeline-test / WP7 files with a
 * mocked fetch (per-URL delays and failures), a stub renderer and a stub createImageBitmap, and check that:
 *   - refs reach 0 and every texture / geometry is disposed after release;
 *   - a shared entry stays alive until its last holder releases;
 *   - when one of three parts fails, the parts that resolved earlier AND later are both released;
 *   - a part still loading when the load fails is disposed as soon as it arrives.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { AssetManager } from '../../src/assets/AssetManager';
import { ASSET_MANIFEST } from '../../src/assets/manifest';
import { AcquireScope } from '../../src/assets/loaders/scope';
import type { AssetManifest } from '../../src/assets/types';

const PUBLIC = path.join(__dirname, '..', '..', 'public', 'assets');
const BASE = 'http://assets.test/assets/';

interface Route {
  delay?: number;
  fail?: boolean;
}

let routes: Array<[RegExp, Route]> = [];
let fetched: string[] = [];
let bitmapsOpen = 0;
let bitmapsClosed = 0;

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function route(url: string): Route {
  for (const [re, r] of routes) if (re.test(url)) return r;
  return {};
}

async function mockFetch(input: RequestInfo | URL): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  fetched.push(url);
  const r = route(url);
  if (r.delay) await wait(r.delay);
  if (r.fail) return new Response('nope', { status: 404 });
  const rel = new URL(url).pathname.replace(/^\/assets\//, '');
  const file = path.join(PUBLIC, decodeURIComponent(rel));
  if (!fs.existsSync(file)) return new Response('missing', { status: 404 });
  return new Response(new Uint8Array(fs.readFileSync(file)), { status: 200 });
}

function stubRenderer(): THREE.WebGLRenderer {
  return { initTexture: () => undefined } as unknown as THREE.WebGLRenderer;
}

function manager(): AssetManager {
  return new AssetManager({ renderer: stubRenderer(), tier: 'high', baseUrl: BASE, manifest: ASSET_MANIFEST as AssetManifest });
}

/** Wait until every mocked transfer (and the decode chain behind it) has settled. */
const settle = (): Promise<void> => wait(250);

beforeEach(() => {
  routes = [];
  fetched = [];
  bitmapsOpen = 0;
  bitmapsClosed = 0;
  vi.stubGlobal('fetch', mockFetch);
  // three's FileLoader (GLTFLoader) reports progress with ProgressEvent, which Node lacks.
  if (typeof globalThis.ProgressEvent === 'undefined')
    vi.stubGlobal(
      'ProgressEvent',
      class extends Event {
        readonly lengthComputable: boolean;
        readonly loaded: number;
        readonly total: number;
        constructor(type: string, init: { lengthComputable?: boolean; loaded?: number; total?: number } = {}) {
          super(type);
          this.lengthComputable = !!init.lengthComputable;
          this.loaded = init.loaded ?? 0;
          this.total = init.total ?? 0;
        }
      },
    );
  vi.stubGlobal('createImageBitmap', async () => {
    bitmapsOpen++;
    return { width: 64, height: 64, close: () => void bitmapsClosed++ } as unknown as ImageBitmap;
  });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AcquireScope', () => {
  it('releases resolved parts on release() and late parts on arrival, exactly once', async () => {
    const scope = new AcquireScope();
    const released: string[] = [];
    let lateResolve: (v: string) => void = () => undefined;
    const late = new Promise<string>((r) => (lateResolve = r));
    const a = scope.track(Promise.resolve('a'), (v) => released.push(v));
    const b = scope.track(Promise.reject(new Error('b failed')), () => released.push('b'));
    const c = scope.track(late, (v) => released.push(v));
    await expect(Promise.all([a, b, c])).rejects.toThrow('b failed');
    scope.release();
    expect(released).toEqual(['a']);
    expect(scope.inFlight).toBe(1);
    lateResolve('c');
    await c;
    expect(released).toEqual(['a', 'c']);
    scope.release();
    expect(released).toEqual(['a', 'c']);
    expect(scope.held).toBe(0);
  });
});

describe('AssetManager partial-failure ref counting', () => {
  it('flipbook: refs reach 0 and every atlas is disposed after release', async () => {
    const am = manager();
    const h = await am.loadFlipbook('fx_smoke');
    expect(h).not.toBeNull();
    const parts = (h!.normal ? 1 : 0) + 1 + (h!.emissive ? 1 : 0);
    expect(am.stats().textures).toBe(parts);
    const disposed = vi.fn();
    h!.color.addEventListener('dispose', disposed);
    h!.release();
    h!.release(); // idempotent
    expect(am.stats().textures).toBe(0);
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(bitmapsClosed).toBe(bitmapsOpen);
  });

  it('a shared atlas stays alive until its last holder releases', async () => {
    const am = manager();
    const [a, b] = await Promise.all([am.loadImpostor('impostor_test_tree'), am.loadImpostor('impostor_test_tree')]);
    expect(a && b).toBeTruthy();
    expect(a!.albedo).toBe(b!.albedo);
    expect(am.stats().textures).toBe(2);
    a!.release();
    expect(am.stats().textures).toBe(2);
    expect(bitmapsClosed).toBe(0);
    b!.release();
    expect(am.stats().textures).toBe(0);
    expect(bitmapsClosed).toBe(2);
  });

  it('impostor: the part still loading when its sibling fails is disposed when it arrives', async () => {
    routes = [
      [/impostors\/.*albedo/, { delay: 5, fail: true }],
      [/impostors\/.*normal/, { delay: 120 }],
    ];
    const am = manager();
    const h = await am.loadImpostor('impostor_test_tree');
    expect(h).toBeNull();
    // The normal atlas is still in flight here; it must not survive its arrival.
    await settle();
    expect(am.stats().textures).toBe(0);
    expect(bitmapsOpen).toBe(1);
    expect(bitmapsClosed).toBe(1);
  });

  it('vat: one of three parts fails (LOD1 payload) - LOD0 GLB + payload and LOD1 GLB are all released', async () => {
    const entry = ASSET_MANIFEST.assets.vat_test_dummy;
    expect(entry.kind).toBe('vat');
    // LOD0 GLB resolves before the failure, the LOD1 GLB and the LOD0 payload only after it.
    routes = [
      [/lod1\.vat/, { delay: 20, fail: true }],
      [/lod0\.glb/, { delay: 1 }],
      [/lod1\.glb/, { delay: 150 }],
      [/lod0\.vat/, { delay: 120 }],
    ];
    const am = manager();
    const disposedGeometries: THREE.BufferGeometry[] = [];
    const origDispose = THREE.BufferGeometry.prototype.dispose;
    vi.spyOn(THREE.BufferGeometry.prototype, 'dispose').mockImplementation(function (this: THREE.BufferGeometry) {
      disposedGeometries.push(this);
      origDispose.call(this);
    });
    const h = await am.loadVat('vat_test_dummy', { lods: [0, 1] });
    expect(h).toBeNull();
    await settle();
    await settle();
    expect(fetched.filter((u) => /\.glb|\.vat/.test(u)).length).toBe(4);
    const s = am.stats();
    expect(s.models).toBe(0);
    expect(s.vats).toBe(0);
    expect(s.materials).toBe(0);
    expect(disposedGeometries.length).toBeGreaterThanOrEqual(2);
  }, 20_000);

  it('vat: a full load + release returns every cache to empty', async () => {
    const am = manager();
    const h = await am.loadVat('vat_test_dummy', { lods: [0, 1] });
    expect(h).not.toBeNull();
    expect(h!.lods.length).toBe(2);
    expect(am.stats().models).toBe(2);
    expect(am.stats().vats).toBe(2);
    h!.release();
    const s = am.stats();
    expect([s.models, s.vats, s.materials, s.textures]).toEqual([0, 0, 0, 0]);
  }, 20_000);

  it('flipbook: color resolves before and emissive after a failing normal - both released', async () => {
    // fx_fire ships color only; build a synthetic three-map entry from fx_smoke's files for this test.
    const smoke = ASSET_MANIFEST.assets.fx_smoke;
    const color = smoke.maps.color.high!;
    const normal = smoke.maps.normal!.high!;
    const synthetic = {
      ...smoke,
      id: 'fx_three_maps',
      maps: { color: { high: color }, normal: { high: normal }, emissive: { high: { ...color, url: color.url.replace('color_', 'color_') + '#e' } } },
    };
    const manifest = { ...ASSET_MANIFEST, assets: { ...ASSET_MANIFEST.assets, fx_three_maps: synthetic } } as unknown as AssetManifest;
    routes = [
      [/#e/, { delay: 150 }],
      [/normal_/, { delay: 20, fail: true }],
      [/color_/, { delay: 1 }],
    ];
    const am = new AssetManager({ renderer: stubRenderer(), tier: 'high', baseUrl: BASE, manifest });
    const h = await am.loadFlipbook('fx_three_maps');
    expect(h).toBeNull();
    await settle();
    expect(am.stats().textures).toBe(0);
    expect(bitmapsOpen).toBe(2);
    expect(bitmapsClosed).toBe(2);
  });
});
