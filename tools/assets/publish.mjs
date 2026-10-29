/**
 * Publish step: Blender cache outputs -> optimized, tiered runtime files in public/assets/.
 * OWNER: CTO + Technical Art Director.
 *
 * Naming (all lowercase snake_case ids, files keyed by pixel size so equal-size tiers share a file):
 *   textures/<material id>/<map>_<size>.webp          shared tiling material sets
 *   models/<model id>/<model id>.lod<N>.glb            meshopt-compressed, texture-less GLBs
 *   models/<model id>/<set>.<map>_<size>.webp          model-local texture sets (e.g. macro.macro_1024)
 *   hdri/<hdri id>_<width>.exr                         half-float DWAB equirect environments
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, meshopt, prune, quantize, reorder, resample, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { PUBLIC_DIR, TEXTURE_ENCODING, TEXTURE_MAPS, TIERS, TIER_MAX_TEXTURE } from './config.mjs';

sharp.concurrency(2);

function ensureDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

function record(outFiles, relPath, tiers, extra) {
  const bytes = fs.statSync(path.join(PUBLIC_DIR, relPath)).size;
  const existing = outFiles.find((f) => f.path === relPath);
  if (existing) {
    for (const t of tiers) if (!existing.tiers.includes(t)) existing.tiers.push(t);
    return existing;
  }
  const f = { path: relPath, bytes, tiers: [...tiers], ...extra };
  outFiles.push(f);
  return f;
}

/** Encode one source texture into per-tier WebP files. Returns { [tier]: {path, bytes, size} }. */
async function publishTexture(srcPath, map, relPrefix, outFiles, tierScale = 1) {
  const meta = await sharp(srcPath).metadata();
  const srcSize = Math.max(meta.width ?? 0, meta.height ?? 0);
  if (!srcSize) throw new Error(`cannot read ${srcPath}`);
  if ((meta.width ?? 0) !== (meta.height ?? 0)) throw new Error(`${srcPath}: textures must be square (got ${meta.width}x${meta.height})`);
  const enc = TEXTURE_ENCODING[map] ?? TEXTURE_ENCODING.baseColor;
  const bySize = new Map();
  for (const t of TIERS) {
    const size = Math.min(srcSize, Math.max(64, Math.round(TIER_MAX_TEXTURE[t] * tierScale)));
    if (!bySize.has(size)) bySize.set(size, []);
    bySize.get(size).push(t);
  }
  const result = {};
  for (const [size, tiers] of bySize) {
    const relPath = `${relPrefix}${map}_${size}.webp`;
    const out = path.join(PUBLIC_DIR, relPath);
    ensureDir(out);
    let img = sharp(srcPath, { limitInputPixels: false });
    if (size !== srcSize) img = img.resize(size, size, { kernel: 'lanczos3', fit: 'fill' });
    // Keep values as stored (no ICC conversion): base color is sRGB-encoded, data maps are linear.
    await img.removeAlpha().webp(enc).toFile(out);
    const f = record(outFiles, relPath, tiers, { kind: 'texture', map, size });
    for (const t of tiers) result[t] = { path: relPath, bytes: f.bytes, size };
  }
  return result;
}

/**
 * Publish the texture maps of one set. `setName` null = the material asset itself (files whose role
 * is a map name), otherwise model-local set files ({set, map}).
 */
export async function publishTextureSet(assetId, srcDir, metaFiles, kindDir, setName, outFiles) {
  const maps = {};
  const files = metaFiles.filter((f) =>
    setName === null ? TEXTURE_MAPS.includes(f.role) && !f.set && f.ship !== false : f.set === setName && f.ship !== false,
  );
  for (const f of files) {
    const map = setName === null ? f.role : f.map;
    if (!TEXTURE_MAPS.includes(map)) throw new Error(`${assetId}: unknown texture map "${map}"`);
    const prefix = setName === null ? `${kindDir}/${assetId}/` : `${kindDir}/${assetId}/${setName}.`;
    maps[map] = await publishTexture(path.join(srcDir, f.path), map, prefix, outFiles, f.tierScale ?? 1);
  }
  if (!Object.keys(maps).length) throw new Error(`${assetId}: texture set ${setName ?? '(material)'} has no shippable maps`);
  return { maps };
}

let encoderReady = null;

async function optimizeGlb(src, dst, { skinned = false } = {}) {
  encoderReady ??= MeshoptEncoder.ready;
  await encoderReady;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.read(src);
  const steps = [dedup()];
  if (!skinned) steps.push(flatten(), join({ keepNamed: false }));
  steps.push(
    weld(),
    resample(),
    // Proxy materials carry no textures: keep UVs/tangents the runtime-bound textures need.
    prune({ keepAttributes: true, keepExtras: true, keepLeaves: false }),
    reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 14, quantizeColor: 8, quantizeWeight: 8 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  await doc.transform(...steps);
  let triangles = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      triangles += Math.floor((idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3);
    }
  ensureDir(dst);
  await io.write(dst, doc);
  return { triangles, drawCalls: doc.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().length, 0) };
}

/** Model: LOD GLBs (roles lod0, lod1, ...) + model-local texture sets ({set, map} files). */
export async function publishModelFiles(assetId, srcDir, metaFiles, outFiles) {
  const lods = [];
  for (const f of metaFiles.filter((x) => /^lod\d+$/.test(x.role)).sort((a, b) => a.role.localeCompare(b.role))) {
    const n = Number(f.role.slice(3));
    const relPath = `models/${assetId}/${assetId}.lod${n}.glb`;
    const stats = await optimizeGlb(path.join(srcDir, f.path), path.join(PUBLIC_DIR, relPath), { skinned: !!f.skinned });
    const rf = record(outFiles, relPath, [...TIERS], { kind: 'model', lod: n, triangles: stats.triangles });
    lods.push({ lod: n, path: relPath, bytes: rf.bytes, triangles: stats.triangles, drawCalls: stats.drawCalls });
  }
  if (!lods.length) throw new Error(`${assetId}: model has no lod0 file`);
  const sets = {};
  for (const name of [...new Set(metaFiles.filter((f) => f.set).map((f) => f.set))].sort())
    sets[name] = await publishTextureSet(assetId, srcDir, metaFiles, 'models', name, outFiles);
  return { lods, sets };
}

/** HDRI: EXR tiers written by Blender (roles hdri_<tier>) are copied (deduplicated by width). */
export async function publishHdri(assetId, srcDir, metaFiles, outFiles) {
  const files = {};
  for (const t of TIERS) {
    const f = metaFiles.find((x) => x.role === `hdri_${t}`);
    if (!f) throw new Error(`${assetId}: missing hdri_${t}`);
    const relPath = `hdri/${assetId}_${f.width}.exr`;
    const out = path.join(PUBLIC_DIR, relPath);
    ensureDir(out);
    fs.copyFileSync(path.join(srcDir, f.path), out);
    const rf = record(outFiles, relPath, [t], { kind: 'hdri', width: f.width, height: f.height });
    files[t] = { path: relPath, bytes: rf.bytes, width: f.width, height: f.height };
  }
  return { files };
}
