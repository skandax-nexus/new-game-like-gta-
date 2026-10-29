#!/usr/bin/env node
/**
 * SAMRAJYA asset pipeline runner. OWNER: CTO + Technical Art Director.
 *
 *   npm run assets                       build every asset (incremental: content hash of script + lib + deps)
 *   npm run assets -- stupa_sanchi       build one asset (and any dirty dependency first)
 *   npm run assets -- --force [ids]      ignore caches
 *   npm run assets -- --draft [ids]      fast iteration (quarter-res textures, few samples); NOT for commits
 *   npm run assets -- --no-preview       skip Cycles preview renders
 *   npm run assets -- --republish        re-run the optimize/publish step from .asset-cache (no Blender)
 *   npm run assets -- --list             list assets, kinds, dependencies and state
 *   npm run assets -- --check            verify published files + manifest + budgets (no Blender, CI-safe)
 *   npm run assets -- --selftest         run tools/blender/selftest.py (library regression test)
 *
 * Stages per asset:
 *   1. Blender  : BLENDER_PY tools/blender/assets/<category>/<id>.py  -> .asset-cache/<id>/ (+ asset.json)
 *   2. Publish  : textures -> WebP tiers (sharp), models -> gltf-transform (dedup, flatten, join, weld,
 *                 prune(keep attributes), reorder, quantize, meshopt), HDRIs -> EXR tiers
 *                 -> public/assets/{textures,models,hdri}/
 *   3. Record   : tools/assets/published.json (committed build record: hashes, files, bytes, metadata)
 *   4. Manifest : src/assets/manifest.ts (generated, typed; never edit by hand)
 * Budgets (tools/assets/config.mjs) are enforced at the end.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  BLENDER_DIR,
  BLENDER_PY,
  BUDGETS,
  CACHE_DIR,
  LIB_DIR,
  PIPELINE_VERSION,
  PUBLIC_DIR,
  PUBLISHED_JSON,
  ROOT,
  SCRIPTS_DIR,
  TIERS,
} from './config.mjs';
import { publishHdri, publishModelFiles, publishTextureSet } from './publish.mjs';
import { writeManifest } from './manifest.mjs';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const ids = argv.filter((a) => !a.startsWith('--'));
const FORCE = flags.has('--force');
const DRAFT = flags.has('--draft');
const PREVIEW = !flags.has('--no-preview');

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const sha = (...parts) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(typeof p === 'string' || Buffer.isBuffer(p) ? p : JSON.stringify(p));
  return h.digest('hex');
};

// ------------------------------------------------------------------------------------ discovery
function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.py') && !e.name.startsWith('_')) out.push(p);
  }
  return out.sort();
}

/** Parse `@asset`, `@kind`, `@depends` tags from a script's module docstring. */
function discover() {
  const assets = new Map();
  for (const file of walk(SCRIPTS_DIR)) {
    const src = fs.readFileSync(file, 'utf8');
    const head = src.slice(0, 4000);
    const id = /@asset\s+([a-z0-9_]+)/.exec(head)?.[1] ?? path.basename(file, '.py');
    const kind = /@kind\s+(material|model|hdri)/.exec(head)?.[1];
    if (!kind) throw new Error(`${rel(file)}: missing "@kind material|model|hdri" tag in the docstring`);
    if (id !== path.basename(file, '.py')) throw new Error(`${rel(file)}: @asset id "${id}" must equal the file name`);
    if (!/^[a-z][a-z0-9_]*$/.test(id)) throw new Error(`${rel(file)}: asset ids are snake_case ([a-z][a-z0-9_]*)`);
    const depends = (/@depends\s+([^\n]+)/.exec(head)?.[1] ?? '')
      .split(/[,\s]+/)
      .filter(Boolean);
    if (assets.has(id)) throw new Error(`duplicate asset id ${id}`);
    assets.set(id, { id, kind, file, category: path.basename(path.dirname(file)), depends, src });
  }
  for (const a of assets.values())
    for (const d of a.depends) if (!assets.has(d)) throw new Error(`${a.id}: unknown dependency ${d}`);
  return assets;
}

function topoOrder(assets, roots) {
  const order = [];
  const state = new Map();
  const visit = (id, chain) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') throw new Error(`dependency cycle: ${[...chain, id].join(' -> ')}`);
    state.set(id, 'visiting');
    for (const d of assets.get(id).depends) visit(d, [...chain, id]);
    state.set(id, 'done');
    order.push(id);
  };
  for (const id of roots) visit(id, []);
  return order;
}

function libHash() {
  const files = fs.readdirSync(LIB_DIR).filter((f) => f.endsWith('.py')).sort();
  return sha(...files.map((f) => f + fs.readFileSync(path.join(LIB_DIR, f), 'utf8')));
}

// ------------------------------------------------------------------------------------ record
function loadPublished() {
  if (!fs.existsSync(PUBLISHED_JSON)) return { pipelineVersion: PIPELINE_VERSION, assets: {} };
  return JSON.parse(fs.readFileSync(PUBLISHED_JSON, 'utf8'));
}

function savePublished(rec) {
  const sorted = { pipelineVersion: PIPELINE_VERSION, assets: {} };
  for (const k of Object.keys(rec.assets).sort()) sorted.assets[k] = rec.assets[k];
  fs.writeFileSync(PUBLISHED_JSON, JSON.stringify(sorted, null, 2) + '\n');
}

// ------------------------------------------------------------------------------------ blender
function runBlender(asset, outDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(outDir, { recursive: true });
    const logPath = path.join(outDir, 'build.log');
    const log = fs.createWriteStream(logPath);
    const t0 = Date.now();
    const child = spawn(BLENDER_PY, [asset.file], {
      cwd: ROOT,
      env: {
        ...process.env,
        SAMRAJYA_ASSET_ID: asset.id,
        SAMRAJYA_ASSET_OUT: outDir,
        SAMRAJYA_ASSET_CACHE: CACHE_DIR,
        SAMRAJYA_DRAFT: DRAFT ? '1' : '0',
        SAMRAJYA_PREVIEW: PREVIEW ? '1' : '0',
        PYTHONHASHSEED: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let pending = '';
    const onData = (d) => {
      log.write(d);
      const lines = (pending + d.toString()).split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) if (/^\[\s*\d/.test(line)) console.log(`  ${asset.id} ${line}`);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (d) => log.write(d));
    child.on('error', (e) => reject(new Error(`cannot start ${BLENDER_PY}: ${e.message} (set BLENDER_PY)`)));
    child.on('close', (code) => {
      log.end();
      if (code === 0) resolve((Date.now() - t0) / 1000);
      else {
        const tail = fs.readFileSync(logPath, 'utf8').split('\n').slice(-30).join('\n');
        reject(new Error(`Blender failed for ${asset.id} (exit ${code}). Log: ${rel(logPath)}\n${tail}`));
      }
    });
  });
}

// ------------------------------------------------------------------------------------ publish
async function publish(asset, outDir, inputHash) {
  const metaPath = path.join(outDir, 'asset.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  if (meta.schema !== 1 || meta.id !== asset.id || meta.kind !== asset.kind)
    throw new Error(`${asset.id}: invalid asset.json (schema/id/kind mismatch)`);
  const entry = {
    id: asset.id,
    kind: asset.kind,
    category: asset.category,
    script: rel(asset.file),
    inputHash,
    draft: !!meta.draft,
    blender: meta.blender,
    meta: meta[asset.kind] ?? {},
    files: [],
  };
  if (asset.kind === 'material') {
    entry.set = await publishTextureSet(asset.id, outDir, meta.files, 'textures', null, entry.files);
  } else if (asset.kind === 'model') {
    Object.assign(entry, await publishModelFiles(asset.id, outDir, meta.files, entry.files));
  } else {
    entry.hdri = await publishHdri(asset.id, outDir, meta.files, entry.files);
  }
  entry.bytes = Object.fromEntries(TIERS.map((t) => [t, entry.files.filter((f) => f.tiers.includes(t)).reduce((s, f) => s + f.bytes, 0)]));
  return entry;
}

function removeStale(prev, next) {
  if (!prev) return;
  const keep = new Set(next.files.map((f) => f.path));
  for (const f of prev.files ?? []) {
    if (keep.has(f.path)) continue;
    const p = path.join(PUBLIC_DIR, f.path);
    if (fs.existsSync(p)) fs.rmSync(p);
  }
}

// ------------------------------------------------------------------------------------ checks
function checkBudgets(rec) {
  const errors = [];
  const totals = Object.fromEntries(TIERS.map((t) => [t, 0]));
  for (const a of Object.values(rec.assets)) {
    for (const f of a.files) {
      const p = path.join(PUBLIC_DIR, f.path);
      if (!fs.existsSync(p)) errors.push(`missing published file ${rel(p)} (run npm run assets -- ${a.id})`);
      else if (fs.statSync(p).size !== f.bytes) errors.push(`${rel(p)} size differs from the build record`);
      if (f.bytes > BUDGETS.fileBytes) errors.push(`${f.path}: ${(f.bytes / 1048576).toFixed(1)} MB > single-file budget`);
    }
    for (const t of TIERS) totals[t] += a.bytes?.[t] ?? 0;
    if (a.draft) errors.push(`${a.id}: published from a --draft build (rebuild without --draft before committing)`);
  }
  for (const t of TIERS)
    if (totals[t] > BUDGETS.totalBytes[t]) errors.push(`tier ${t}: ${(totals[t] / 1048576).toFixed(1)} MB > budget ${(BUDGETS.totalBytes[t] / 1048576).toFixed(0)} MB`);
  return { errors, totals };
}

// ------------------------------------------------------------------------------------ main
async function main() {
  const assets = discover();
  const rec = loadPublished();

  if (flags.has('--selftest')) {
    await runBlender({ id: '_selftest', file: path.join(BLENDER_DIR, 'selftest.py') }, path.join(CACHE_DIR, '_selftest'));
    console.log('[assets] selftest passed');
    return;
  }
  if (flags.has('--list')) {
    for (const a of assets.values()) {
      const pub = rec.assets[a.id];
      console.log(`${a.id.padEnd(28)} ${a.kind.padEnd(9)} ${a.category.padEnd(12)} deps=[${a.depends.join(',')}] ${pub ? `published ${pub.inputHash.slice(0, 8)}` : 'not published'}`);
    }
    return;
  }
  if (flags.has('--check')) {
    const { errors, totals } = checkBudgets(rec);
    for (const id of Object.keys(rec.assets)) if (!assets.has(id)) errors.push(`${id}: published but its script no longer exists`);
    const fresh = writeManifest(rec, { dryRun: true });
    if (!fresh.upToDate) errors.push('src/assets/manifest.ts is out of date (run npm run assets -- --republish)');
    console.log(`[assets] totals: ${TIERS.map((t) => `${t} ${(totals[t] / 1048576).toFixed(2)} MB`).join(', ')}`);
    if (errors.length) {
      for (const e of errors) console.error(`[assets] ERROR ${e}`);
      process.exit(1);
    }
    console.log('[assets] check ok');
    return;
  }

  for (const id of ids) if (!assets.has(id)) throw new Error(`unknown asset "${id}". Known: ${[...assets.keys()].join(', ')}`);
  const roots = ids.length ? ids : [...assets.keys()];
  const order = topoOrder(assets, roots);
  const lib = libHash();
  const hashes = new Map();
  const t0 = Date.now();
  let built = 0;
  for (const id of order) {
    const a = assets.get(id);
    const inputHash = sha(String(PIPELINE_VERSION), lib, a.src, ...a.depends.map((d) => hashes.get(d) ?? rec.assets[d]?.inputHash ?? ''), DRAFT ? 'draft' : 'final');
    hashes.set(id, inputHash);
    const outDir = path.join(CACHE_DIR, id);
    const stampPath = path.join(outDir, '.inputhash');
    const cached = fs.existsSync(stampPath) && fs.readFileSync(stampPath, 'utf8') === inputHash && fs.existsSync(path.join(outDir, 'asset.json'));
    const prev = rec.assets[id];
    const upToDate = prev && prev.inputHash === inputHash && prev.files.every((f) => fs.existsSync(path.join(PUBLIC_DIR, f.path)));
    const explicit = ids.includes(id);
    if (upToDate && !FORCE && !flags.has('--republish')) {
      console.log(`[assets] ${id}: up to date`);
      continue;
    }
    if ((!cached || FORCE) && !flags.has('--republish')) {
      console.log(`[assets] ${id}: blender ${rel(a.file)}${DRAFT ? ' (draft)' : ''}`);
      const secs = await runBlender(a, outDir);
      fs.writeFileSync(stampPath, inputHash);
      console.log(`[assets] ${id}: blender done in ${secs.toFixed(1)} s`);
    } else if (!fs.existsSync(path.join(outDir, 'asset.json'))) {
      if (flags.has('--republish') && !explicit && prev) {
        console.log(`[assets] ${id}: no cache, keeping published files`);
        continue;
      }
      throw new Error(`${id}: no cached build to republish - run without --republish`);
    } else {
      console.log(`[assets] ${id}: using cached Blender output`);
    }
    const entry = await publish(a, outDir, fs.existsSync(stampPath) ? fs.readFileSync(stampPath, 'utf8') : inputHash);
    removeStale(prev, entry);
    rec.assets[id] = entry;
    savePublished(rec);
    built++;
    console.log(`[assets] ${id}: published ${entry.files.length} files (${TIERS.map((t) => `${t} ${(entry.bytes[t] / 1024).toFixed(0)} KB`).join(', ')})`);
  }
  // Drop records of assets whose scripts were deleted.
  for (const id of Object.keys(rec.assets)) {
    if (!assets.has(id)) {
      removeStale(rec.assets[id], { files: [] });
      delete rec.assets[id];
      console.log(`[assets] ${id}: script removed -> unpublished`);
    }
  }
  savePublished(rec);
  const res = writeManifest(rec);
  console.log(`[assets] manifest ${res.upToDate ? 'unchanged' : 'written'}: ${rel(res.path)}`);
  const { errors, totals } = checkBudgets(rec);
  console.log(`[assets] ${built} built in ${((Date.now() - t0) / 1000).toFixed(1)} s; totals: ${TIERS.map((t) => `${t} ${(totals[t] / 1048576).toFixed(2)} MB`).join(', ')}`);
  if (errors.length) {
    for (const e of errors) console.error(`[assets] ${DRAFT ? 'WARN' : 'ERROR'} ${e}`);
    if (!DRAFT) process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[assets] ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});
