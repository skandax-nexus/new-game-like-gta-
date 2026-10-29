/**
 * Publish step: Blender cache outputs -> optimized, tiered runtime files in public/assets/.
 * OWNER: Technical Artist G (TA-07, CTO grant for Sprint 1) - CTO + Technical Art Director review.
 * Formats: docs/ARCHITECTURE.md §18 and docs/adr/0003-crowd-impostor-fx-assets.md.
 *
 * Naming (all lowercase snake_case ids, files keyed by pixel size so equal-size tiers share a file):
 *   textures/<material id>/<map>_<size>.webp          shared tiling material sets
 *   models/<model id>/<model id>.lod<N>.glb            meshopt-compressed, texture-less GLBs (+ .footprint.glb)
 *   models/<model id>/<set>.<map>_<size>.webp          model-local texture sets (e.g. macro.macro_1024)
 *   hdri/<hdri id>_<width>.exr                         half-float DWAB equirect environments
 *   vat/<id>/<id>.lod<N>.glb                            rest-pose GLB, vertex order == VAT columns (no reorder/weld)
 *   vat/<id>/<id>.lod<N>.vat                            gzip(byte-shuffled RGB16F rest offsets + RG8 octahedral normals)
 *   vat/<id>/impostor_<map>_<size>.webp                optional 8-direction animated impostor sheet
 *   impostors/<id>/<map>_<size>.webp                   hemi-octahedral 8x8 atlases: albedo (+coverage), normal (+depth)
 *   fx/<id>/<map>_<size>.webp                           flipbook atlases: color (+alpha), normal, emissive
 *   luts/<id>.png                                       32^3 LUT as a lossless 1024 x 32 strip (three LUTImageLoader layout)
 *   images/<id>/<id>_<width>.webp                      sRGB images (sun sprite, lens dirt, portraits, key art)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, flatten, join, meshopt, prune, quantize, reorder, resample, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import {
  CLIP_EVENT_TYPES,
  FLIPBOOK_MAPS,
  FLIPBOOK_NORMAL_SCALE,
  IMPOSTOR_FRAME_PX,
  IMPOSTOR_MAPS,
  IMPOSTOR_NORMAL_SCALE,
  IMPOSTOR_MAX_TEXTURE,
  PUBLIC_DIR,
  TEXTURE_ENCODING,
  TEXTURE_MAPS,
  TIERS,
  TIER_MAX_TEXTURE,
  VAT_MAX_TEXTURE,
} from './config.mjs';

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

/** Group the shipped tiers by an output size so equal sizes share one file. */
function bySize(tiers, sizeOf) {
  const m = new Map();
  for (const t of tiers) {
    const s = sizeOf(t);
    if (!m.has(s)) m.set(s, []);
    m.get(s).push(t);
  }
  return m;
}

// =========================================================================================== textures
/** Encode one square source texture into per-tier WebP files. Returns { [tier]: {path, bytes, size} }. */
async function publishTexture(srcPath, map, relPrefix, outFiles, tierScale = 1, tiers = TIERS) {
  const meta = await sharp(srcPath).metadata();
  const srcSize = Math.max(meta.width ?? 0, meta.height ?? 0);
  if (!srcSize) throw new Error(`cannot read ${srcPath}`);
  if ((meta.width ?? 0) !== (meta.height ?? 0)) throw new Error(`${srcPath}: textures must be square (got ${meta.width}x${meta.height})`);
  const enc = TEXTURE_ENCODING[map] ?? TEXTURE_ENCODING.baseColor;
  const result = {};
  for (const [size, ts] of bySize(tiers, (t) => Math.min(srcSize, Math.max(64, Math.round(TIER_MAX_TEXTURE[t] * tierScale))))) {
    const relPath = `${relPrefix}${map}_${size}.webp`;
    const out = path.join(PUBLIC_DIR, relPath);
    ensureDir(out);
    let img = sharp(srcPath, { limitInputPixels: false });
    if (size !== srcSize) img = img.resize(size, size, { kernel: 'lanczos3', fit: 'fill' });
    // Keep values as stored (no ICC conversion): base color is sRGB-encoded, data maps are linear.
    await img.removeAlpha().webp(enc).toFile(out);
    const f = record(outFiles, relPath, ts, { kind: 'texture', map, size });
    for (const t of ts) result[t] = { path: relPath, bytes: f.bytes, size };
  }
  return result;
}

/**
 * Publish the texture maps of one set. `setName` null = the material asset itself (files whose role
 * is a map name), otherwise model-local set files ({set, map}).
 */
export async function publishTextureSet(assetId, srcDir, metaFiles, kindDir, setName, outFiles, tiers = TIERS) {
  const maps = {};
  const files = metaFiles.filter((f) =>
    setName === null ? TEXTURE_MAPS.includes(f.role) && !f.set && f.ship !== false : f.set === setName && f.ship !== false,
  );
  for (const f of files) {
    const map = setName === null ? f.role : f.map;
    if (!TEXTURE_MAPS.includes(map)) throw new Error(`${assetId}: unknown texture map "${map}"`);
    const prefix = setName === null ? `${kindDir}/${assetId}/` : `${kindDir}/${assetId}/${setName}.`;
    maps[map] = await publishTexture(path.join(srcDir, f.path), map, prefix, outFiles, f.tierScale ?? 1, tiers);
  }
  if (!Object.keys(maps).length) throw new Error(`${assetId}: texture set ${setName ?? '(material)'} has no shippable maps`);
  return { maps };
}

/** Fill the RGB of (nearly) transparent texels from opaque neighbours so filtering never pulls in black. */
function bleedRgb(buf, w, h, iterations = 12, threshold = 8) {
  const known = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) known[i] = buf[i * 4 + 3] > threshold ? 1 : 0;
  let frontier = known.slice();
  for (let it = 0; it < iterations; it++) {
    const next = frontier.slice();
    let changed = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (frontier[i]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w || (!dx && !dy)) continue;
            const j = yy * w + xx;
            if (!frontier[j]) continue;
            r += buf[j * 4];
            g += buf[j * 4 + 1];
            b += buf[j * 4 + 2];
            n++;
          }
        }
        if (n) {
          buf[i * 4] = Math.round(r / n);
          buf[i * 4 + 1] = Math.round(g / n);
          buf[i * 4 + 2] = Math.round(b / n);
          next[i] = 1;
          changed++;
        }
      }
    }
    frontier = next;
    if (!changed) break;
  }
  // Whatever is still unknown gets the average known color (smooth, cheap to compress).
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < w * h; i++)
    if (known[i]) {
      r += buf[i * 4];
      g += buf[i * 4 + 1];
      b += buf[i * 4 + 2];
      n++;
    }
  if (n) for (let i = 0; i < w * h; i++) if (!frontier[i]) [buf[i * 4], buf[i * 4 + 1], buf[i * 4 + 2]] = [r / n, g / n, b / n].map(Math.round);
  return buf;
}

/**
 * Resample a cols x rows atlas frame by frame (no bleeding across frames) to frames of fw x fh.
 * Returns raw RGBA. `bleed` re-fills transparent RGB after resampling (sharp premultiplies).
 */
async function resampleAtlas(srcPath, cols, rows, fw, fh, { bleed = true, alpha = true } = {}) {
  const { data, info } = await sharp(srcPath, { limitInputPixels: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const sw = info.width / cols;
  const sh = info.height / rows;
  if (!Number.isInteger(sw) || !Number.isInteger(sh)) throw new Error(`${srcPath}: ${info.width}x${info.height} is not a ${cols}x${rows} grid`);
  const W = cols * fw;
  const H = rows * fh;
  const out = Buffer.alloc(W * H * 4);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      let frame;
      if (sw === fw && sh === fh) {
        frame = Buffer.alloc(fw * fh * 4);
        for (let y = 0; y < fh; y++) data.copy(frame, y * fw * 4, ((r * sh + y) * info.width + c * sw) * 4, ((r * sh + y) * info.width + c * sw + sw) * 4);
      } else {
        frame = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
          .extract({ left: c * sw, top: r * sh, width: sw, height: sh })
          .resize(fw, fh, { kernel: 'lanczos3', fit: 'fill' })
          .raw()
          .toBuffer();
      }
      for (let y = 0; y < fh; y++) frame.copy(out, ((r * fh + y) * W + c * fw) * 4, y * fw * 4, (y + 1) * fw * 4);
    }
  if (bleed && alpha) bleedRgb(out, W, H);
  return { data: out, width: W, height: H };
}

async function writeWebpRaw(raw, relPath, enc, { alpha = true, verify = null } = {}) {
  const out = path.join(PUBLIC_DIR, relPath);
  ensureDir(out);
  let img = sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } });
  if (!alpha) img = img.removeAlpha();
  if (!verify) {
    await img.webp({ ...enc, ...(alpha ? { exact: true } : {}) }).toFile(out);
    return;
  }
  // verify the ENCODED file before it replaces the published one (a failed check leaves public/ untouched)
  const tmp = `${out}.verify.webp`;
  await img.webp({ ...enc, ...(alpha ? { exact: true } : {}) }).toFile(tmp);
  try {
    await verify(tmp);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  fs.renameSync(tmp, out);
}

// =========================================================================================== glTF
let encoderReady = null;

async function gltfIo() {
  encoderReady ??= Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  await encoderReady;
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
}

function countDoc(doc) {
  let triangles = 0;
  let vertices = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const n = prim.getAttribute('POSITION').getCount();
      vertices += n;
      triangles += Math.floor((idx ? idx.getCount() : n) / 3);
    }
  return { triangles, vertices, drawCalls: doc.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().length, 0) };
}

async function optimizeGlb(src, dst, { skinned = false, keepNodes = false } = {}) {
  const io = await gltfIo();
  const doc = await io.read(src);
  const steps = [dedup()];
  if (!skinned && !keepNodes) steps.push(flatten(), join({ keepNamed: false }));
  steps.push(
    weld(),
    resample(),
    // Proxy materials carry no textures: keep UVs/tangents the runtime-bound textures need.
    prune({ keepAttributes: true, keepExtras: true, keepLeaves: keepNodes }),
    reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 14, quantizeColor: 8, quantizeWeight: 8 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  await doc.transform(...steps);
  ensureDir(dst);
  await io.write(dst, doc);
  const c = countDoc(doc);
  return { triangles: c.triangles, drawCalls: c.drawCalls, skins: doc.getRoot().listSkins().length, animations: doc.getRoot().listAnimations().map((a) => a.getName()) };
}

/**
 * VAT meshes: the vertex buffer order IS the VAT column order, so no weld / reorder / position quantization.
 * EXT_meshopt_compression (lossless byte codec) still shrinks the file; positions are verified bit-exact.
 */
async function optimizeVatGlb(src, dst, expectVertices) {
  const io = await gltfIo();
  const doc = await io.read(src);
  const before = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives().map((p) => Float32Array.from(p.getAttribute('POSITION').getArray())));
  await doc.transform(prune({ keepAttributes: true, keepExtras: true, keepLeaves: false }));
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  ensureDir(dst);
  await io.write(dst, doc);
  const back = await io.read(dst);
  const after = back.getRoot().listMeshes().flatMap((m) => m.listPrimitives().map((p) => p.getAttribute('POSITION').getArray()));
  if (before.length !== 1 || after.length !== 1) throw new Error(`${src}: VAT GLBs must hold exactly one primitive (got ${after.length})`);
  const a = before[0];
  const b = after[0];
  if (a.length !== b.length || a.some((v, i) => v !== b[i])) throw new Error(`${src}: VAT vertex buffer changed during publish`);
  if (expectVertices && a.length / 3 !== expectVertices) throw new Error(`${src}: ${a.length / 3} vertices, VAT expects ${expectVertices}`);
  const c = countDoc(back);
  const attrs = back.getRoot().listMeshes()[0].listPrimitives()[0].listSemantics();
  return { triangles: c.triangles, vertices: c.vertices, drawCalls: c.drawCalls, attributes: attrs };
}

/** Model: LOD GLBs (roles lod0, lod1, ...) + optional footprint GLB + model-local texture sets ({set, map}). */
export async function publishModelFiles(assetId, srcDir, metaFiles, outFiles, tiers = TIERS) {
  const lods = [];
  for (const f of metaFiles.filter((x) => /^lod\d+$/.test(x.role)).sort((a, b) => Number(a.role.slice(3)) - Number(b.role.slice(3)))) {
    const n = Number(f.role.slice(3));
    const relPath = `models/${assetId}/${assetId}.lod${n}.glb`;
    const stats = await optimizeGlb(path.join(srcDir, f.path), path.join(PUBLIC_DIR, relPath), { skinned: !!f.skinned, keepNodes: !!f.keepNodes });
    if (f.skinned && !stats.skins) throw new Error(`${assetId}: lod${n} is marked skinned but lost its skin during optimization`);
    const rf = record(outFiles, relPath, tiers, { kind: 'model', lod: n, triangles: stats.triangles });
    lods.push({ lod: n, path: relPath, bytes: rf.bytes, triangles: stats.triangles, drawCalls: stats.drawCalls, skinned: !!f.skinned, animations: stats.animations });
  }
  if (!lods.length) throw new Error(`${assetId}: model has no lod0 file`);
  let footprint = null;
  const fp = metaFiles.find((x) => x.role === 'footprint');
  if (fp) {
    const relPath = `models/${assetId}/${assetId}.footprint.glb`;
    const stats = await optimizeGlb(path.join(srcDir, fp.path), path.join(PUBLIC_DIR, relPath), {});
    const rf = record(outFiles, relPath, tiers, { kind: 'model', role: 'footprint', triangles: stats.triangles });
    footprint = { path: relPath, bytes: rf.bytes, triangles: stats.triangles };
  }
  const sets = {};
  for (const name of [...new Set(metaFiles.filter((f) => f.set).map((f) => f.set))].sort())
    sets[name] = await publishTextureSet(assetId, srcDir, metaFiles, 'models', name, outFiles, tiers);
  return { lods, sets, footprint };
}

// =========================================================================================== HDRI
/** HDRI: EXR tiers written by Blender (roles hdri_<tier>) are copied (deduplicated by width). */
export async function publishHdri(assetId, srcDir, metaFiles, outFiles, tiers = TIERS) {
  const files = {};
  for (const t of tiers) {
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

// =========================================================================================== VAT
/** Shuffle 16-bit elements into byte planes (all low bytes, then all high bytes): ~2x better gzip. */
export function shuffle16(bytes) {
  const n = bytes.length >> 1;
  const out = Buffer.alloc(bytes.length);
  for (let i = 0; i < n; i++) {
    out[i] = bytes[2 * i];
    out[n + i] = bytes[2 * i + 1];
  }
  return out;
}

async function publishVat(asset, srcDir, meta, outFiles, tiers) {
  const m = meta.vat ?? {};
  const files = meta.files;
  const lods = [];
  const lodMeta = m.lods ?? [];
  for (const f of files.filter((x) => /^lod\d+$/.test(x.role)).sort((a, b) => Number(a.role.slice(3)) - Number(b.role.slice(3)))) {
    const n = Number(f.role.slice(3));
    const lm = lodMeta.find((l) => l.lod === n);
    if (!lm) throw new Error(`${asset.id}: vat.lods has no entry for lod${n}`);
    const pos = files.find((x) => x.role === `lod${n}_pos`);
    const nrm = files.find((x) => x.role === `lod${n}_nrm`);
    if (!pos || !nrm) throw new Error(`${asset.id}: lod${n} needs lod${n}_pos and lod${n}_nrm VAT files`);
    const { width, height, vertices, rowsPerFrame } = lm;
    if (width > VAT_MAX_TEXTURE || height > VAT_MAX_TEXTURE) throw new Error(`${asset.id}: lod${n} VAT ${width}x${height} exceeds ${VAT_MAX_TEXTURE}`);
    if (rowsPerFrame !== Math.ceil(vertices / width)) throw new Error(`${asset.id}: lod${n} rowsPerFrame mismatch`);
    const posBuf = fs.readFileSync(path.join(srcDir, pos.path));
    const nrmBuf = fs.readFileSync(path.join(srcDir, nrm.path));
    if (posBuf.length !== width * height * 6) throw new Error(`${asset.id}: lod${n}_pos is ${posBuf.length} bytes, expected ${width * height * 6} (RGB half)`);
    if (nrmBuf.length !== width * height * 2) throw new Error(`${asset.id}: lod${n}_nrm is ${nrmBuf.length} bytes, expected ${width * height * 2} (RG8)`);
    const glbRel = `vat/${asset.id}/${asset.id}.lod${n}.glb`;
    const stats = await optimizeVatGlb(path.join(srcDir, f.path), path.join(PUBLIC_DIR, glbRel), vertices);
    const glbRec = record(outFiles, glbRel, tiers, { kind: 'vat-mesh', lod: n, triangles: stats.triangles });
    const vatRel = `vat/${asset.id}/${asset.id}.lod${n}.vat`;
    const packed = zlib.gzipSync(Buffer.concat([shuffle16(posBuf), nrmBuf]), { level: 9, memLevel: 9 });
    ensureDir(path.join(PUBLIC_DIR, vatRel));
    fs.writeFileSync(path.join(PUBLIC_DIR, vatRel), packed);
    const vatRec = record(outFiles, vatRel, tiers, { kind: 'vat-data', lod: n });
    lods.push({
      lod: n,
      path: glbRel,
      bytes: glbRec.bytes,
      triangles: stats.triangles,
      vertices: stats.vertices,
      attributes: stats.attributes,
      vat: { path: vatRel, bytes: vatRec.bytes, rawBytes: posBuf.length + nrmBuf.length, width, height, rowsPerFrame },
    });
  }
  if (!lods.length) throw new Error(`${asset.id}: vat has no lod0`);
  let impostor = null;
  const ia = files.find((x) => x.role === 'impostor_albedo');
  if (ia) {
    const im = m.impostor ?? {};
    const cols = im.cols;
    const rows = im.rows;
    if (!cols || !rows) throw new Error(`${asset.id}: vat.impostor needs cols/rows`);
    const maps = {};
    for (const map of ['albedo', 'normal']) {
      const f = files.find((x) => x.role === `impostor_${map}`);
      if (!f) continue;
      maps[map] = {};
      const scale = map === 'normal' ? IMPOSTOR_NORMAL_SCALE : 1;
      for (const [px, ts] of bySize(tiers, (t) => Math.max(16, Math.round(Math.min(im.framePx ?? 128, IMPOSTOR_FRAME_PX[t]) * scale)))) {
        const raw = await resampleAtlas(path.join(srcDir, f.path), cols, rows, px, px);
        const relPath = `vat/${asset.id}/impostor_${map}_${raw.width}.webp`;
        await writeWebpRaw(raw, relPath, map === 'albedo' ? TEXTURE_ENCODING.color_alpha : TEXTURE_ENCODING.impostor_normal);
        const rf = record(outFiles, relPath, ts, { kind: 'vat-impostor', map, size: raw.width });
        for (const t of ts) maps[map][t] = { path: relPath, bytes: rf.bytes, size: raw.width, framePx: px };
      }
    }
    impostor = { maps };
  }
  const sets = {};
  for (const name of [...new Set(files.filter((f) => f.set).map((f) => f.set))].sort())
    sets[name] = await publishTextureSet(asset.id, srcDir, files, 'vat', name, outFiles, tiers);
  return { lods, impostor, sets };
}

// =========================================================================================== impostor
async function publishImpostor(asset, srcDir, meta, outFiles, tiers) {
  const m = meta.impostor ?? {};
  const grid = m.grid ?? 8;
  const maps = {};
  for (const map of IMPOSTOR_MAPS) {
    const f = meta.files.find((x) => x.role === map);
    if (!f) throw new Error(`${asset.id}: impostor needs an "${map}" atlas`);
    maps[map] = {};
    const framePx = m.framePx ?? IMPOSTOR_FRAME_PX;
    const scale = map === 'normal' ? (m.normalScale ?? IMPOSTOR_NORMAL_SCALE) : 1;
    for (const [px, ts] of bySize(tiers, (t) => Math.max(16, Math.round((framePx[t] ?? IMPOSTOR_FRAME_PX[t]) * scale)))) {
      // A size shared by several tiers must fit the STRICTEST of them.
      const strict = ts.reduce((a, t) => (IMPOSTOR_MAX_TEXTURE[t] < IMPOSTOR_MAX_TEXTURE[a] ? t : a), ts[0]);
      if (px * grid > IMPOSTOR_MAX_TEXTURE[strict]) throw new Error(`${asset.id}: ${map} ${px * grid}px exceeds the ${strict} impostor limit`);
      const raw = await resampleAtlas(path.join(srcDir, f.path), grid, grid, px, px);
      const relPath = `impostors/${asset.id}/${map}_${raw.width}.webp`;
      await writeWebpRaw(raw, relPath, map === 'albedo' ? TEXTURE_ENCODING.color_alpha : TEXTURE_ENCODING.impostor_normal);
      const rf = record(outFiles, relPath, ts, { kind: 'impostor', map, size: raw.width });
      for (const t of ts) maps[map][t] = { path: relPath, bytes: rf.bytes, size: raw.width, framePx: px };
    }
  }
  return { maps };
}

// =========================================================================================== flipbook
export const FLIPBOOK_BORDER_PX = 2;
export const FLIPBOOK_BORDER_LIMIT = 2; // 0-255 (lib/flipbook.py BORDER_LIMIT = 2/255)

/**
 * Flipbook border guard on an ENCODED atlas (decoded back to 8-bit RGBA): the outer `px` pixels of every frame edge
 * its sequence does not open (`openEdges`) must stay <= `limit` (0-255). `signal` 'alpha' checks coverage (alpha
 * books: their transparent RGB is bled colour), 'rgb' the emission (additive books, stored without alpha), 'both'
 * both (premultiplied). Frames no sequence uses are skipped. Returns one message per failing frame edge.
 * The bake (lib/flipbook.py write) checks the source frames; this catches what WebP compression adds - ringing,
 * 4:2:0 chroma and bleed from a neighbouring frame's open edge.
 */
export function flipbookBorderProblems(data, width, height, channels, { cols, rows, sequences, signal, px = FLIPBOOK_BORDER_PX, limit = FLIPBOOK_BORDER_LIMIT }) {
  const fw = width / cols;
  const fh = height / rows;
  if (!Number.isInteger(fw) || !Number.isInteger(fh)) throw new Error(`${width}x${height} is not a ${cols}x${rows} grid`);
  const owner = new Map();
  for (const s of sequences ?? []) for (let k = s.start; k < s.start + s.count; k++) owner.set(k, s);
  const level = (x, y) => {
    const i = (y * width + x) * channels;
    const a = channels > 3 ? data[i + 3] : 0;
    if (signal === 'alpha') return a;
    const e = Math.max(data[i], data[i + 1], data[i + 2]);
    return signal === 'rgb' ? e : Math.max(a, e);
  };
  const problems = [];
  for (let k = 0; k < cols * rows; k++) {
    const s = owner.get(k);
    if (!s) continue;
    const open = new Set(s.openEdges ?? []);
    const x0 = (k % cols) * fw;
    const y0 = Math.floor(k / cols) * fh;
    const strips = {
      top: [x0, y0, fw, px],
      bottom: [x0, y0 + fh - px, fw, px],
      left: [x0, y0, px, fh],
      right: [x0 + fw - px, y0, px, fh],
    };
    for (const [edge, [sx, sy, sw, sh]] of Object.entries(strips)) {
      if (open.has(edge)) continue;
      let worst = 0;
      for (let y = sy; y < sy + sh; y++) for (let x = sx; x < sx + sw; x++) worst = Math.max(worst, level(x, y));
      if (worst > limit) problems.push(`frame ${k} (${s.name}) ${edge} edge ${worst}/255`);
    }
  }
  return problems;
}

async function checkEncodedBorders(asset, relPath, file, m, signal) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const sequences = m.sequences ?? [{ name: 'all', start: 0, count: m.frames ?? m.cols * m.rows }];
  const problems = flipbookBorderProblems(data, info.width, info.height, info.channels, { cols: m.cols, rows: m.rows, sequences, signal });
  if (problems.length)
    throw new Error(
      `${asset.id}: flipbook border guard failed on the encoded ${relPath} (> ${FLIPBOOK_BORDER_LIMIT}/255 in the outer ${FLIPBOOK_BORDER_PX} px ` +
        `after WebP compression):\n  ${problems.slice(0, 12).join('\n  ')}${problems.length > 12 ? `\n  ... and ${problems.length - 12} more` : ''}\n` +
        'Publish it near-lossless / lossless (asset meta "encoding"), or keep open-edge frames away from closed edges in the atlas.',
    );
}

async function publishFlipbook(asset, srcDir, meta, outFiles, tiers) {
  const m = meta.flipbook ?? {};
  const { cols, rows } = m;
  if (!cols || !rows) throw new Error(`${asset.id}: flipbook needs cols and rows`);
  const maps = {};
  // Additive everywhere (no sequence overrides the blend): the color atlas is premultiplied emission, no alpha.
  const additiveOnly = m.blend === 'additive' && (m.sequences ?? []).every((s) => (s.blend ?? 'additive') === 'additive');
  for (const map of FLIPBOOK_MAPS) {
    const f = meta.files.find((x) => x.role === map);
    if (!f) {
      if (map === 'color') throw new Error(`${asset.id}: flipbook needs a "color" atlas`);
      continue;
    }
    const info = await sharp(path.join(srcDir, f.path)).metadata();
    const srcMax = Math.max(info.width ?? 0, info.height ?? 0);
    const atlasPx = m.atlasPx ?? {};
    const mapScale = map === 'normal' ? (m.normalScale ?? FLIPBOOK_NORMAL_SCALE) : 1;
    maps[map] = {};
    for (const [size, ts] of bySize(tiers, (t) => Math.min(srcMax, Math.round(Math.min(atlasPx[t] ?? TIER_MAX_TEXTURE[t], TIER_MAX_TEXTURE[t]) * mapScale)))) {
      const scale = size / srcMax;
      const fw = Math.max(1, Math.round(((info.width ?? 0) / cols) * scale));
      const fh = Math.max(1, Math.round(((info.height ?? 0) / rows) * scale));
      const hasAlpha = map === 'color' && !additiveOnly;
      // RGB bleed into transparent texels (mip / filter fringes) only for straight-alpha books: a premultiplied atlas
      // stores emission where alpha is 0 (fire), so its RGB there is data, and bled colour would be ADDED on screen.
      const bleed = hasAlpha && m.blend !== 'premultiplied';
      const raw = await resampleAtlas(path.join(srcDir, f.path), cols, rows, fw, fh, { alpha: hasAlpha, bleed });
      const relPath = `fx/${asset.id}/${map}_${raw.width}.webp`;
      const override = m.encoding === 'lossless' ? TEXTURE_ENCODING.flipbook_lossless : m.encoding === 'near_lossless' ? TEXTURE_ENCODING.flipbook_near_lossless : null;
      if (m.encoding && !override) throw new Error(`${asset.id}: unknown flipbook encoding "${m.encoding}" (lossless | near_lossless)`);
      const enc =
        map === 'normal'
          ? TEXTURE_ENCODING.flipbook_normal
          : map === 'color'
            ? (override ??
              (hasAlpha
                ? TEXTURE_ENCODING.color_alpha
                : TEXTURE_ENCODING.color_additive))
            : (override ?? TEXTURE_ENCODING.emissive);
      const signal = map === 'emissive' ? 'rgb' : !hasAlpha ? 'rgb' : m.blend === 'premultiplied' ? 'both' : m.blend === 'additive' ? 'rgb' : 'alpha';
      const verify = map === 'normal' ? null : (file) => checkEncodedBorders(asset, relPath, file, m, signal);
      await writeWebpRaw(raw, relPath, enc, { alpha: hasAlpha, verify });
      const rf = record(outFiles, relPath, ts, { kind: 'flipbook', map, size: raw.width });
      for (const t of ts) maps[map][t] = { path: relPath, bytes: rf.bytes, width: raw.width, height: raw.height };
    }
  }
  return { maps };
}

// =========================================================================================== LUT
async function publishLut(asset, srcDir, meta, outFiles, tiers) {
  const m = meta.lut ?? {};
  const size = m.size ?? 32;
  const f = meta.files.find((x) => x.role === 'lut');
  if (!f) throw new Error(`${asset.id}: lut needs a "lut" strip`);
  const src = path.join(srcDir, f.path);
  const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== size * size || info.height !== size) throw new Error(`${asset.id}: LUT strip must be ${size * size}x${size} (got ${info.width}x${info.height})`);
  const relPath = `luts/${asset.id}.png`;
  const out = path.join(PUBLIC_DIR, relPath);
  ensureDir(out);
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).png({ compressionLevel: 9, adaptiveFiltering: true, palette: false }).toFile(out);
  const check = await sharp(out).removeAlpha().raw().toBuffer();
  if (!check.equals(data)) throw new Error(`${asset.id}: LUT re-encode is not lossless`);
  const rf = record(outFiles, relPath, tiers, { kind: 'lut', size });
  const files = {};
  for (const t of tiers) files[t] = { path: relPath, bytes: rf.bytes, width: info.width, height: info.height };
  return { files };
}

// =========================================================================================== image
async function publishImage(asset, srcDir, meta, outFiles, tiers) {
  const m = meta.image ?? {};
  const f = meta.files.find((x) => x.role === 'image');
  if (!f) throw new Error(`${asset.id}: image needs an "image" file`);
  const src = path.join(srcDir, f.path);
  const info = await sharp(src).metadata();
  const w0 = info.width ?? 0;
  const h0 = info.height ?? 0;
  const alpha = m.alpha ?? !!info.hasAlpha;
  const tierPx = m.tierPx ?? {};
  const files = {};
  for (const [width, ts] of bySize(tiers, (t) => Math.min(w0, tierPx[t] ?? TIER_MAX_TEXTURE[t]))) {
    const height = Math.round((h0 * width) / w0);
    const strict = ts.reduce((a, t) => (TIER_MAX_TEXTURE[t] < TIER_MAX_TEXTURE[a] ? t : a), ts[0]);
    if (Math.max(width, height) > TIER_MAX_TEXTURE[strict] && !m.allowLarge) throw new Error(`${asset.id}: ${width}x${height} exceeds the ${strict} texture limit`);
    let raw;
    if (alpha) {
      const { data } = await sharp(src).ensureAlpha().resize(width, height, { kernel: 'lanczos3', fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
      raw = { data: bleedRgb(data, width, height), width, height };
    } else {
      const { data } = await sharp(src).ensureAlpha().resize(width, height, { kernel: 'lanczos3', fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
      raw = { data, width, height };
    }
    const relPath = `images/${asset.id}/${asset.id}_${width}.webp`;
    await writeWebpRaw(raw, relPath, TEXTURE_ENCODING.image, { alpha });
    const rf = record(outFiles, relPath, ts, { kind: 'image', width, height });
    for (const t of ts) files[t] = { path: relPath, bytes: rf.bytes, width, height };
  }
  return { files };
}

// =========================================================================================== dispatch
/** Publish one asset's cache outputs. Returns the kind-specific record fields (files go into outFiles). */
export async function publishAsset(asset, srcDir, meta, outFiles) {
  const tiers = asset.tiers ?? TIERS;
  switch (asset.kind) {
    case 'material':
      return { set: await publishTextureSet(asset.id, srcDir, meta.files, 'textures', null, outFiles, tiers) };
    case 'model':
      return publishModelFiles(asset.id, srcDir, meta.files, outFiles, tiers);
    case 'hdri':
      return { hdri: await publishHdri(asset.id, srcDir, meta.files, outFiles, tiers) };
    case 'vat':
      return { vat: await publishVat(asset, srcDir, meta, outFiles, tiers) };
    case 'impostor':
      return { impostor: await publishImpostor(asset, srcDir, meta, outFiles, tiers) };
    case 'flipbook':
      return { flipbook: await publishFlipbook(asset, srcDir, meta, outFiles, tiers) };
    case 'lut':
      return { lut: await publishLut(asset, srcDir, meta, outFiles, tiers) };
    case 'image':
      return { image: await publishImage(asset, srcDir, meta, outFiles, tiers) };
    default:
      throw new Error(`${asset.id}: unknown kind ${asset.kind}`);
  }
}

// =========================================================================================== validation
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isVec = (v, n) => Array.isArray(v) && v.length === n && v.every(isNum);

/** JSON-only passthrough metadata (no functions/NaN), <= 16 KB, camelCase keys. */
function validateJson(v, where, depth = 0) {
  if (depth > 8) throw new Error(`${where}: nested too deeply`);
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`${where}: non-finite number`);
    return;
  }
  if (Array.isArray(v)) return v.forEach((x, i) => validateJson(x, `${where}[${i}]`, depth + 1));
  if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k)) throw new Error(`${where}: bad key "${k}"`);
      validateJson(x, `${where}.${k}`, depth + 1);
    }
    return;
  }
  throw new Error(`${where}: not JSON (${typeof v})`);
}

/** Validate the typed optional model metadata (A4) so a bad script fails at publish, not at runtime. */
function validateModelMeta(id, m, clips) {
  const where = `${id}.model`;
  if (m.clipEvents !== undefined) {
    if (!isObj(m.clipEvents)) throw new Error(`${where}.clipEvents must be {clip: events[]}`);
    for (const [clip, evs] of Object.entries(m.clipEvents)) {
      if (clips.length && !clips.includes(clip)) throw new Error(`${where}.clipEvents: unknown clip "${clip}"`);
      if (!Array.isArray(evs)) throw new Error(`${where}.clipEvents.${clip} must be an array`);
      for (const e of evs) {
        if (!isObj(e) || !isNum(e.time) || typeof e.type !== 'string') throw new Error(`${where}.clipEvents.${clip}: events are {type, time}`);
        if (!CLIP_EVENT_TYPES.includes(e.type) && !e.type.startsWith('x_')) throw new Error(`${where}.clipEvents.${clip}: unknown event "${e.type}" (custom: x_<name>)`);
      }
    }
  }
  if (m.rootMotion !== undefined) {
    if (!isObj(m.rootMotion)) throw new Error(`${where}.rootMotion must be {clip: {translation, yawDeg}}`);
    for (const [clip, r] of Object.entries(m.rootMotion))
      if (!isObj(r) || !isVec(r.translation, 3) || !isNum(r.yawDeg ?? 0)) throw new Error(`${where}.rootMotion.${clip}: {translation: [x,y,z], yawDeg}`);
  }
  if (m.construction !== undefined) {
    const c = m.construction;
    if (!isObj(c) || !Array.isArray(c.scaffold) || !isObj(c.courseHeights ?? {})) throw new Error(`${where}.construction: {footprint, scaffold[], courseHeights}`);
    for (const s of c.scaffold) if (!isObj(s) || typeof s.module !== 'string' || !isVec(s.position, 3)) throw new Error(`${where}.construction.scaffold: {module, position, rotationY?, scale?}`);
  }
  if (m.sockets !== undefined) {
    if (!isObj(m.sockets)) throw new Error(`${where}.sockets must be {name: socket}`);
    for (const [k, s] of Object.entries(m.sockets))
      if (!isObj(s) || !isVec(s.position, 3) || (s.rotation !== undefined && !isVec(s.rotation, 4))) throw new Error(`${where}.sockets.${k}: {bone?, position, rotation? (quat xyzw)}`);
  }
  if (m.variants !== undefined) {
    if (!Array.isArray(m.variants)) throw new Error(`${where}.variants must be an array`);
    for (const v of m.variants) if (!isObj(v) || typeof v.name !== 'string' || typeof v.kind !== 'string' || !Array.isArray(v.nodes)) throw new Error(`${where}.variants: {name, kind, nodes[]}`);
  }
  if (m.meta !== undefined) {
    validateJson(m.meta, `${where}.meta`);
    if (JSON.stringify(m.meta).length > 16384) throw new Error(`${where}.meta exceeds 16 KB`);
  }
}

/** Structural checks of one build-record entry (publish time and `--check`). */
export function validateRecordEntry(a) {
  const tiers = a.tiers ?? TIERS;
  if (!a.files?.length) throw new Error(`${a.id}: no published files`);
  for (const f of a.files) for (const t of f.tiers) if (!tiers.includes(t)) throw new Error(`${a.id}: ${f.path} ships on ${t}, outside @tiers`);
  const m = a.meta ?? {};
  switch (a.kind) {
    case 'model':
      validateModelMeta(a.id, m, m.clips ?? []);
      break;
    case 'vat': {
      if (!Array.isArray(m.clips) || !m.clips.length) throw new Error(`${a.id}: vat needs a clip table`);
      const frames = m.frames;
      for (const c of m.clips) {
        if (typeof c.name !== 'string' || !isNum(c.startFrame) || !isNum(c.frames) || !isNum(c.fps)) throw new Error(`${a.id}: bad clip ${JSON.stringify(c)}`);
        if (c.startFrame + c.frames > frames) throw new Error(`${a.id}: clip ${c.name} exceeds ${frames} frames`);
      }
      for (const l of a.vat?.lods ?? []) if (l.vat.height !== frames * l.vat.rowsPerFrame) throw new Error(`${a.id}: lod${l.lod} VAT height != frames x rowsPerFrame`);
      break;
    }
    case 'flipbook': {
      const n = (m.cols ?? 0) * (m.rows ?? 0);
      for (const s of m.sequences ?? []) if (s.start + s.count > n) throw new Error(`${a.id}: sequence ${s.name} exceeds ${n} frames`);
      break;
    }
    case 'impostor':
      if (!isNum(m.radius) || m.radius <= 0) throw new Error(`${a.id}: impostor radius missing`);
      break;
    default:
      break;
  }
}
