/**
 * Generates src/assets/manifest.ts from the build record (tools/assets/published.json).
 * OWNER: Technical Artist G (TA-07, CTO grant for Sprint 1) - CTO + Technical Art Director review.
 * The output is typed against src/assets/types.ts (keep both in sync).
 */
import fs from 'node:fs';
import path from 'node:path';
import { MANIFEST_TS, PIPELINE_VERSION, TIERS } from './config.mjs';

const round = (v, d = 4) => (typeof v === 'number' ? Math.round(v * 10 ** d) / 10 ** d : v);
const roundVec = (v, d = 4) => (Array.isArray(v) ? v.map((x) => round(x, d)) : v);

function tiered(fn) {
  return Object.fromEntries(TIERS.map((t) => [t, fn(t)]));
}

/** Only the tiers present in `src` (TierMap). */
function tierMap(src, fn) {
  const out = {};
  for (const t of TIERS) if (src && src[t]) out[t] = fn(src[t]);
  return out;
}

function setEntry(set) {
  const maps = {};
  for (const [map, tiers] of Object.entries(set.maps)) maps[map] = tierMap(tiers, (f) => ({ url: f.path, bytes: f.bytes, size: f.size }));
  return { maps };
}

function bounds(b) {
  const z = { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], radius: 0 };
  if (!b) return z;
  return { min: roundVec(b.min), max: roundVec(b.max), center: roundVec(b.center), radius: round(b.radius) };
}

function lodDistance(dist, i) {
  return dist[i] ?? (i === 0 ? 0 : 50 * 2 ** (i - 1));
}

function entryFor(a) {
  const m = a.meta ?? {};
  const base = {
    kind: a.kind,
    id: a.id,
    category: a.category,
    hash: a.inputHash.slice(0, 10),
    description: m.description ?? '',
    bytes: a.bytes,
    tiers: a.tiers ?? [...TIERS],
    fallback: a.fallback ?? null,
  };
  switch (a.kind) {
    case 'material':
      return {
        ...base,
        tileSizeMeters: m.tileSizeMeters ?? [1, 1],
        averageColor: m.averageColor ?? '#808080',
        roughness: round(m.roughness ?? 0.8, 3),
        metalness: round(m.metalness ?? 0, 3),
        normalScale: round(m.normalScale ?? 1, 3),
        trims: (m.trims ?? []).map((t) => ({ name: t.name, v0: round(t.v0, 6), v1: round(t.v1, 6), heightMeters: round(t.heightMeters, 4) })),
        ...setEntry(a.set),
      };
    case 'model': {
      const dist = m.lodDistances ?? [];
      const c = m.construction;
      return {
        ...base,
        lods: a.lods.map((l, i) => ({ lod: l.lod, url: l.path, bytes: l.bytes, triangles: l.triangles, drawCalls: l.drawCalls, distance: lodDistance(dist, i) })),
        minLod: m.minLod ?? tiered(() => 0),
        bounds: bounds(m.bounds),
        clips: m.clips ?? [],
        skinned: a.lods.some((l) => l.skinned),
        clipEvents: Object.fromEntries(
          Object.entries(m.clipEvents ?? {}).map(([clip, evs]) => [
            clip,
            [...evs].sort((x, y) => x.time - y.time).map((e) => ({ type: e.type, time: round(e.time, 4), ...(e.data !== undefined ? { data: String(e.data) } : {}) })),
          ]),
        ),
        rootMotion: Object.fromEntries(Object.entries(m.rootMotion ?? {}).map(([clip, r]) => [clip, { translation: roundVec(r.translation), yawDeg: round(r.yawDeg ?? 0, 3) }])),
        construction: c
          ? {
              footprint: a.footprint ? { url: a.footprint.path, bytes: a.footprint.bytes, triangles: a.footprint.triangles } : null,
              scaffold: c.scaffold.map((s) => ({ module: s.module, position: roundVec(s.position), rotationY: round(s.rotationY ?? 0), scale: roundVec(s.scale ?? [1, 1, 1]) })),
              courseHeights: c.courseHeights ?? {},
            }
          : null,
        sockets: Object.fromEntries(
          Object.entries(m.sockets ?? {}).map(([k, s]) => [k, { bone: s.bone ?? null, position: roundVec(s.position), rotation: roundVec(s.rotation ?? [0, 0, 0, 1], 6) }]),
        ),
        variants: (m.variants ?? []).map((v) => ({ name: v.name, kind: v.kind, nodes: v.nodes })),
        meta: m.meta ?? {},
        materialSets: m.materialSets ?? [],
        sets: Object.fromEntries(Object.entries(a.sets ?? {}).map(([k, v]) => [k, setEntry(v)])),
        footprintMeters: m.footprintMeters ?? null,
      };
    }
    case 'hdri': {
      const h = a.hdri;
      return {
        ...base,
        files: tierMap(h.files, (f) => ({ url: f.path, bytes: f.bytes, width: f.width, height: f.height })),
        sun: m.sun,
        ambientIrradiance: m.ambientIrradiance ?? 0,
      };
    }
    case 'vat': {
      const v = a.vat;
      const dist = m.lodDistances ?? [];
      const lodMeta = m.lods ?? [];
      const imp = v.impostor;
      return {
        ...base,
        fps: m.fps ?? 15,
        frames: m.frames,
        clips: m.clips.map((c) => ({
          name: c.name,
          startFrame: c.startFrame,
          frames: c.frames,
          fps: c.fps,
          loop: !!c.loop,
          strideMeters: c.strideMeters === undefined || c.strideMeters === null ? null : round(c.strideMeters, 4),
          speed: c.speed === undefined || c.speed === null ? null : round(c.speed, 4),
        })),
        lods: v.lods.map((l, i) => ({
          lod: l.lod,
          url: l.path,
          bytes: l.bytes,
          triangles: l.triangles,
          vertices: l.vertices,
          distance: lodDistance(dist, i),
          errorMm: round(lodMeta.find((x) => x.lod === l.lod)?.errorMm ?? 0, 4),
          vat: { url: l.vat.path, bytes: l.vat.bytes, rawBytes: l.vat.rawBytes, width: l.vat.width, height: l.vat.height, rowsPerFrame: l.vat.rowsPerFrame },
        })),
        minLod: m.minLod ?? tiered(() => 0),
        bounds: bounds(m.bounds),
        restBounds: bounds(m.restBounds),
        vertexColors: m.vertexColors !== false,
        parts: m.parts ?? [],
        partColors: m.partColors ?? [],
        impostor:
          imp && m.impostor
            ? {
                cols: m.impostor.cols,
                rows: m.impostor.rows,
                directions: m.impostor.directions ?? m.impostor.cols,
                frames: m.impostor.frames ?? [],
                maps: Object.fromEntries(
                  Object.entries(imp.maps).map(([k, tiers]) => [k, tierMap(tiers, (f) => ({ url: f.path, bytes: f.bytes, size: f.size, framePx: f.framePx }))]),
                ),
                radius: round(m.impostor.radius ?? 1),
                centerY: round(m.impostor.centerY ?? 0),
              }
            : null,
        materialSets: m.materialSets ?? [],
        sets: Object.fromEntries(Object.entries(v.sets ?? {}).map(([k, s]) => [k, setEntry(s)])),
      };
    }
    case 'impostor':
      return {
        ...base,
        layout: m.layout ?? 'hemi-octahedral',
        grid: m.grid ?? 8,
        radius: round(m.radius),
        center: roundVec(m.center ?? [0, 0, 0]),
        switchDistance: round(m.switchDistance ?? 120, 2),
        depthRange: round(m.depthRange ?? 2 * m.radius),
        source: m.source ?? null,
        maps: Object.fromEntries(
          Object.entries(a.impostor.maps).map(([k, tiers]) => [k, tierMap(tiers, (f) => ({ url: f.path, bytes: f.bytes, size: f.size, framePx: f.framePx }))]),
        ),
      };
    case 'flipbook': {
      const n = m.cols * m.rows;
      return {
        ...base,
        cols: m.cols,
        rows: m.rows,
        fps: m.fps ?? 24,
        loop: m.loop !== false,
        sequences: (m.sequences ?? [{ name: 'all', start: 0, count: m.frames ?? n, fps: m.fps ?? 24, loop: m.loop !== false }]).map((s) => ({
          name: s.name,
          start: s.start,
          count: s.count,
          fps: s.fps ?? m.fps ?? 24,
          loop: s.loop ?? m.loop !== false,
          blend: s.blend ?? null,
          lit: s.lit ?? null,
        })),
        maps: Object.fromEntries(Object.entries(a.flipbook.maps).map(([k, tiers]) => [k, tierMap(tiers, (f) => ({ url: f.path, bytes: f.bytes, width: f.width, height: f.height }))])),
        blend: m.blend ?? 'alpha',
        lit: !!m.lit,
        softFadeMeters: round(m.softFadeMeters ?? 0.5, 3),
        emissiveIntensity: round(m.emissiveIntensity ?? 1, 3),
        sizeMeters: m.sizeMeters ? roundVec(m.sizeMeters, 3) : null,
        tint: m.tint ?? '#ffffff',
      };
    }
    case 'lut':
      return {
        ...base,
        size: m.size ?? 32,
        layout: 'strip-horizontal',
        files: tierMap(a.lut.files, (f) => ({ url: f.path, bytes: f.bytes, width: f.width, height: f.height })),
        source: m.source ?? 'generated',
        strength: round(m.strength ?? 1, 3),
      };
    case 'image':
      return {
        ...base,
        files: tierMap(a.image.files, (f) => ({ url: f.path, bytes: f.bytes, width: f.width, height: f.height })),
        colorSpace: m.colorSpace ?? 'srgb',
        alpha: !!m.alpha,
        hdrScale: round(m.hdrScale ?? 1, 4),
        usage: m.usage ?? '',
      };
    default:
      throw new Error(`manifest: unknown kind ${a.kind} (${a.id})`);
  }
}

const KIND_IDS = [
  ['MaterialAssetId', 'material'],
  ['ModelAssetId', 'model'],
  ['HdriAssetId', 'hdri'],
  ['VatAssetId', 'vat'],
  ['ImpostorAssetId', 'impostor'],
  ['FlipbookAssetId', 'flipbook'],
  ['LutAssetId', 'lut'],
  ['ImageAssetId', 'image'],
];

/** Render the manifest module. Returns { path, upToDate }. dryRun only compares. */
export function writeManifest(rec, { dryRun = false } = {}) {
  const assets = {};
  for (const id of Object.keys(rec.assets).sort()) assets[id] = entryFor(rec.assets[id]);
  const totals = tiered((t) => Object.values(rec.assets).reduce((s, a) => s + (a.bytes?.[t] ?? 0), 0));
  const body = JSON.stringify({ version: PIPELINE_VERSION, totals, assets }, null, 2);
  const unions = KIND_IDS.map(([name, kind]) => `export type ${name} = { [K in AssetId]: Assets[K]['kind'] extends '${kind}' ? K : never }[AssetId];`).join('\n');
  const src = `/**
 * GENERATED by tools/assets/build.mjs from tools/assets/published.json - DO NOT EDIT.
 * Regenerate with \`npm run assets -- <ids>\` (or \`npm run assets -- --republish <ids>\`). OWNER: pipeline (TA-07).
 * URLs are relative to <base>/assets/ (public/assets in the repo); the AssetManager adds the base URL and
 * a cache-busting \`?v=<hash>\`.
 */
import type { AssetManifest } from './types';

export const ASSET_MANIFEST = ${body} as const satisfies AssetManifest;

export type AssetId = keyof typeof ASSET_MANIFEST.assets;
type Assets = typeof ASSET_MANIFEST.assets;
${unions}
`;
  const prev = fs.existsSync(MANIFEST_TS) ? fs.readFileSync(MANIFEST_TS, 'utf8') : '';
  const upToDate = prev === src;
  if (!dryRun && !upToDate) {
    fs.mkdirSync(path.dirname(MANIFEST_TS), { recursive: true });
    const tmp = `${MANIFEST_TS}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, src);
    fs.renameSync(tmp, MANIFEST_TS);
  }
  return { path: MANIFEST_TS, upToDate };
}
