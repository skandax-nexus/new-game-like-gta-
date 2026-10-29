#!/usr/bin/env node
/**
 * SAMRAJYA asset pipeline runner. OWNER: Technical Artist G (TA-07, CTO grant for Sprint 1) - CTO +
 * Technical Art Director review. Formats and runtime API: docs/adr/0003-crowd-impostor-fx-assets.md.
 *
 *   npm run assets -- stupa_sanchi       build one asset (and any dirty dependency first)
 *   npm run assets                       build every asset (incremental) - NEVER in a shared tree (STUDIO W3)
 *   npm run assets -- --force [ids]      ignore caches
 *   npm run assets -- --draft [ids]      fast iteration (quarter-res textures, few samples); NOT for commits
 *   npm run assets -- --no-preview       skip Cycles preview renders
 *   npm run assets -- --republish [ids]  re-run the optimize/publish step from .asset-cache (no Blender)
 *   npm run assets -- --list             assets, kinds, tiers, payload per tier, work-package budgets
 *   npm run assets -- --check            verify published files + manifest + budgets (no Blender, no lock, CI-safe)
 *   npm run assets -- --selftest         run tools/blender/selftest.py (library regression test)
 *   npm run assets -- --previews [ids] [--previews-dir docs/screenshots/pipeline/wp7]
 *                                        copy Cycles previews (.asset-cache/<id>/preview*.png); with a build,
 *                                        --previews-dir also copies the previews of every asset just baked
 *   npm run assets -- --style lighting:LIGHTING_PRESETS.dawn.sky   print style values (JSON) - used by scripts
 *   npm run assets -- --manifest         regenerate src/assets/manifest.ts from the record (generator changes)
 *   npm run assets -- --restamp          maintenance: re-stamp caches + build record after a change to the
 *                                        runner's hashing scheme only (asset inputs unchanged)
 *
 * Docstring tags (first 4000 chars of the script):
 *   @asset <id>          == file name, snake_case
 *   @kind <kind>         material | model | hdri | vat | impostor | flipbook | lut | image
 *   @depends a, b        assets built first (their cache outputs are inputs)
 *   @tiers ultra,high    tiers the asset ships on (default all); the runtime substitutes @fallback elsewhere
 *   @fallback <id>       same-kind asset used on tiers this one does not ship (P2 sets on mobile...)
 *   @style m:path, ...   style values (src/render/style/<m>.ts exports) the script reads; hashed and passed
 *                        as JSON in SAMRAJYA_STYLE (Art Director edits re-bake exactly the dependent assets)
 *   @inputs a/b.cube     extra repo files hashed as inputs (missing files hash as absent)
 * Incremental hash = script + tools/blender/lib modules it imports (transitively) + package-local helper
 * modules (sibling `_*.py` files the script imports, transitively) + @style values + @inputs files +
 * dependency hashes + PIPELINE_VERSION. Assets without helpers / style / inputs keep their previous hashes.
 *
 * Stages per asset:
 *   1. Blender  : BLENDER_PY tools/blender/assets/<category>/<id>.py  -> .asset-cache/<id>/ (+ asset.json)
 *   2. Publish  : per kind (publish.mjs) -> public/assets/<kind dir>/<id>... (per-asset files, no lock needed)
 *   3. Commit   : UNDER THE PUBLISH LOCK (.asset-cache/.publish.lock): re-read tools/assets/published.json,
 *                 merge this run's entries, write it, regenerate src/assets/manifest.ts, check budgets.
 *                 Blender and publish stages run outside the lock, so two tickets can bake concurrently and
 *                 never lose each other's entries. `flock .asset-cache/.publish.lock npm run assets -- <ids>`
 *                 (STUDIO W3) keeps working: the runner recognizes its own outer flock(1) holder.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  BLENDER_DIR,
  BLENDER_PY,
  BUDGETS,
  CACHE_DIR,
  KINDS,
  LIB_DIR,
  PACKAGES,
  PIPELINE_VERSION,
  PUBLIC_DIR,
  PUBLISHED_JSON,
  PUBLISH_LOCK,
  PUBLISH_LOCK_STALE_MS,
  ROOT,
  SCRIPTS_DIR,
  STYLE_DIR,
  TIERS,
  packageOf,
} from './config.mjs';
import { publishAsset, validateRecordEntry } from './publish.mjs';
import { writeManifest } from './manifest.mjs';

// ------------------------------------------------------------------------------------ arguments
const VALUE_FLAGS = new Set(['--previews-dir']);
const argv = process.argv.slice(2);
const flags = new Set();
const values = new Map();
const ids = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (VALUE_FLAGS.has(a)) values.set(a, argv[++i]);
  else if (a.startsWith('--') && a.includes('=') && VALUE_FLAGS.has(a.split('=')[0])) values.set(a.split('=')[0], a.slice(a.indexOf('=') + 1));
  else if (a.startsWith('--')) flags.add(a);
  else ids.push(a);
}
const FORCE = flags.has('--force');
const DRAFT = flags.has('--draft');
const PREVIEW = !flags.has('--no-preview');
const PREVIEWS_DIR = values.get('--previews-dir') ? path.resolve(ROOT, values.get('--previews-dir')) : null;

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const sha = (...parts) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(typeof p === 'string' || Buffer.isBuffer(p) ? p : JSON.stringify(p));
  return h.digest('hex');
};
const mb = (b) => (b / 1048576).toFixed(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------------------------ style values
/**
 * Evaluate a src/render/style module (TypeScript) without a bundler: transpile with the project's
 * `typescript` devDependency to CommonJS and run it with a require() that resolves relative .ts imports.
 * Type-only imports are erased; style modules must not import runtime libraries (three, DOM).
 */
const styleModules = new Map();
function loadTsModule(file) {
  const abs = path.resolve(file);
  if (styleModules.has(abs)) return styleModules.get(abs).exports;
  const req = createRequire(import.meta.url);
  const ts = req('typescript');
  const src = fs.readFileSync(abs, 'utf8');
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, isolatedModules: true },
    fileName: abs,
  }).outputText;
  const module = { exports: {} };
  styleModules.set(abs, module);
  const localRequire = (spec) => {
    if (!spec.startsWith('.')) throw new Error(`${rel(abs)}: style modules may only import relative modules (got "${spec}")`);
    const base = path.resolve(path.dirname(abs), spec);
    const cand = [`${base}.ts`, path.join(base, 'index.ts'), base].find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
    if (!cand) throw new Error(`${rel(abs)}: cannot resolve "${spec}"`);
    return loadTsModule(cand);
  };
  // eslint-disable-next-line no-new-func
  new Function('exports', 'require', 'module', '__filename', '__dirname', out)(module.exports, localRequire, module, abs, path.dirname(abs));
  return module.exports;
}

/** Resolve "module:EXPORT.path.to.value" against src/render/style/<module>.ts. */
function styleValue(ref) {
  const m = /^([a-z][a-zA-Z0-9_]*):([A-Za-z_$][\w$]*)((?:\.[\w$-]+)*)$/.exec(ref.trim());
  if (!m) throw new Error(`bad @style reference "${ref}" (expected module:EXPORT.path)`);
  const file = path.join(STYLE_DIR, `${m[1]}.ts`);
  if (!fs.existsSync(file)) throw new Error(`@style ${ref}: ${rel(file)} not found`);
  let v = loadTsModule(file)[m[2]];
  if (v === undefined) throw new Error(`@style ${ref}: export ${m[2]} not found`);
  for (const key of m[3].split('.').filter(Boolean)) {
    if (v === null || typeof v !== 'object' || !(key in v)) throw new Error(`@style ${ref}: no "${key}"`);
    v = v[key];
  }
  if (typeof v === 'function') throw new Error(`@style ${ref}: functions are not style values`);
  return JSON.parse(JSON.stringify(v));
}

function styleValues(refs) {
  return Object.fromEntries(refs.map((r) => [r, styleValue(r)]));
}

// ------------------------------------------------------------------------------------ discovery
function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.py') && !e.name.startsWith('_')) out.push(p);
  }
  return out.sort();
}

const listTag = (head, tag) =>
  (new RegExp(`@${tag}[ \\t]+([^\\n]+)`).exec(head)?.[1] ?? '')
    .split(/[,\s]+/)
    .filter(Boolean);

/** Parse the docstring tags of every script. */
function discover() {
  const assets = new Map();
  for (const file of walk(SCRIPTS_DIR)) {
    const src = fs.readFileSync(file, 'utf8');
    const head = src.slice(0, 4000);
    const id = /@asset\s+([a-z0-9_]+)/.exec(head)?.[1] ?? path.basename(file, '.py');
    const kind = new RegExp(`@kind\\s+(${KINDS.join('|')})\\b`).exec(head)?.[1];
    if (!kind) throw new Error(`${rel(file)}: missing "@kind ${KINDS.join('|')}" tag in the docstring`);
    if (id !== path.basename(file, '.py')) throw new Error(`${rel(file)}: @asset id "${id}" must equal the file name`);
    if (!/^[a-z][a-z0-9_]*$/.test(id)) throw new Error(`${rel(file)}: asset ids are snake_case ([a-z][a-z0-9_]*)`);
    const tiersTag = listTag(head, 'tiers');
    for (const t of tiersTag) if (!TIERS.includes(t)) throw new Error(`${rel(file)}: @tiers "${t}" is not one of ${TIERS.join(', ')}`);
    const tiers = tiersTag.length ? TIERS.filter((t) => tiersTag.includes(t)) : [...TIERS];
    const fallback = /@fallback[ \t]+([a-z][a-z0-9_]*)/.exec(head)?.[1] ?? null;
    const style = (/@style[ \t]+([^\n]+)/.exec(head)?.[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const inputs = listTag(head, 'inputs');
    if (assets.has(id)) throw new Error(`duplicate asset id ${id}`);
    assets.set(id, {
      id,
      kind,
      file,
      category: path.basename(path.dirname(file)),
      depends: listTag(head, 'depends'),
      tiers,
      fallback,
      style,
      inputs,
      src,
    });
  }
  for (const a of assets.values()) {
    for (const d of a.depends) if (!assets.has(d)) throw new Error(`${a.id}: unknown dependency ${d}`);
    if (a.fallback) {
      const f = assets.get(a.fallback);
      if (!f) throw new Error(`${a.id}: unknown @fallback ${a.fallback}`);
      if (f.kind !== a.kind) throw new Error(`${a.id}: @fallback ${a.fallback} must be a ${a.kind} (is ${f.kind})`);
      const missing = TIERS.filter((t) => !a.tiers.includes(t));
      const uncovered = missing.filter((t) => !f.tiers.includes(t));
      if (uncovered.length) throw new Error(`${a.id}: @fallback ${a.fallback} does not ship on ${uncovered.join(', ')}`);
    }
  }
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

/**
 * Library modules imported by `src`: "from lib import a, b as c", the parenthesized multi-line form
 * "from lib import (\n a,\n b,\n)", "from lib.x import ..." and (inside lib) "from . import" / "from .x import".
 */
function importedLibModules(src) {
  const mods = new Set();
  const addNames = (list) => {
    for (const part of list.replace(/#[^\n]*/g, '').replace(/[()\\]/g, ' ').split(/[,\n]/)) {
      const name = part.trim().split(/\s+as\s+/)[0]?.trim();
      if (name && /^\w+$/.test(name)) mods.add(name);
    }
  };
  for (const m of src.matchAll(/^[ \t]*from[ \t]+(?:lib|\.)[ \t]+import[ \t]*\(([^)]*)\)/gm)) addNames(m[1]);
  for (const m of src.matchAll(/^[ \t]*from[ \t]+(?:lib|\.)[ \t]+import[ \t]+([^\n(#]+)/gm)) addNames(m[1]);
  for (const m of src.matchAll(/^\s*from\s+(?:lib)?\.(\w+)\s+import/gm)) mods.add(m[1]);
  return mods;
}

/** Package-local helper modules (`_name.py` beside the script) imported by `src`. */
function importedHelpers(src) {
  const mods = new Set();
  for (const m of src.matchAll(/^\s*from\s+(_\w+)\s+import\b/gm)) mods.add(m[1]);
  for (const m of src.matchAll(/^\s*import\s+([^\n#]+)/gm))
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0]?.trim();
      if (name && /^_\w+$/.test(name)) mods.add(name);
    }
  return mods;
}

/** Helper files (transitively) used by a script, sorted. */
function helperFiles(asset) {
  const dir = path.dirname(asset.file);
  const seen = new Map();
  const queue = [...importedHelpers(asset.src)];
  while (queue.length) {
    const m = queue.pop();
    if (seen.has(m)) continue;
    const file = path.join(dir, `${m}.py`);
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    seen.set(m, { file, src });
    for (const d of importedHelpers(src)) queue.push(d);
  }
  return [...seen.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, v]) => ({ name, ...v }));
}

/** Hash of the library modules a set of sources depends on (transitively). */
function libHashFor(...sources) {
  const seen = new Set(['__init__']);
  const queue = sources.flatMap((s) => [...importedLibModules(s)]);
  while (queue.length) {
    const m = queue.pop();
    if (seen.has(m)) continue;
    const file = path.join(LIB_DIR, `${m}.py`);
    if (!fs.existsSync(file)) continue;
    seen.add(m);
    for (const d of importedLibModules(fs.readFileSync(file, 'utf8'))) queue.push(d);
  }
  return sha(...[...seen].sort().map((m) => {
    const f = path.join(LIB_DIR, `${m}.py`);
    return fs.existsSync(f) ? m + fs.readFileSync(f, 'utf8') : m;
  }));
}

/** Extra hashed inputs beyond script + lib (empty for assets that use none -> unchanged legacy hashes). */
function extraInputs(asset) {
  const extras = [];
  const helpers = helperFiles(asset);
  if (helpers.length) extras.push('helpers', sha(...helpers.map((h) => `${h.name}\n${h.src}`)));
  if (asset.style.length) extras.push('style', sha(styleValues(asset.style)));
  if (asset.inputs.length) {
    extras.push(
      'inputs',
      sha(
        ...asset.inputs.map((p) => {
          const f = path.resolve(ROOT, p);
          return fs.existsSync(f) && fs.statSync(f).isFile() ? `${p}\n${sha(fs.readFileSync(f))}` : `${p}\n<absent>`;
        }),
      ),
    );
  }
  return { extras, helpers };
}

function inputHashFor(asset, depHash) {
  const { extras, helpers } = extraInputs(asset);
  const lib = libHashFor(asset.src, ...helpers.map((h) => h.src));
  return sha(String(PIPELINE_VERSION), lib, asset.src, ...asset.depends.map(depHash), DRAFT ? 'draft' : 'final', ...extras);
}

/** Publish options that change outputs without a re-bake (tiers / fallback). '' = defaults (legacy records). */
function publishKeyFor(asset) {
  const tiers = asset.tiers.join(',') === TIERS.join(',') ? '' : asset.tiers.join(',');
  return tiers || asset.fallback ? `tiers=${tiers || TIERS.join(',')};fallback=${asset.fallback ?? ''}` : '';
}

// ------------------------------------------------------------------------------------ record
function loadPublished() {
  if (!fs.existsSync(PUBLISHED_JSON)) return { pipelineVersion: PIPELINE_VERSION, assets: {} };
  return JSON.parse(fs.readFileSync(PUBLISHED_JSON, 'utf8'));
}

function savePublished(rec) {
  const sorted = { pipelineVersion: PIPELINE_VERSION, assets: {} };
  for (const k of Object.keys(rec.assets).sort()) sorted.assets[k] = rec.assets[k];
  const tmp = `${PUBLISHED_JSON}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(PUBLISHED_JSON), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(sorted, null, 2) + '\n');
  fs.renameSync(tmp, PUBLISHED_JSON);
}

// ------------------------------------------------------------------------------------ publish lock
/**
 * Exclusive publish lock (A1). The lock file `.asset-cache/.publish.lock` holds a JSON owner record
 * {pid, host, startedAt, nonce, ids}; it is held iff it contains a live, non-stale record.
 *   - free path          -> mode "excl": the record is written to a private temp file and hard-linked into
 *                           place (link(2) fails with EEXIST when the lock exists), so the lock path is NEVER
 *                           visible empty - an empty file always means a flock(1) sentinel. Release = rename the
 *                           lock aside, verify it is still our record, delete it.
 *   - owner record       -> wait (poll); stale after 30 min or when the owner pid is gone (same host). Breaking a
 *                           stale record is serialized by a second, short-lived lock (`.publish.lock.break`,
 *                           created the same atomic way): the breaker re-reads the record under it, renames the
 *                           stale file aside (atomic), verifies the renamed content is still the stale record and
 *                           only then deletes it (else it links it back). Two waiters can never both break the
 *                           same record, nor delete a fresh lock created in between.
 *   - empty file         -> a flock(1) sentinel (STUDIO W3: `flock .publish.lock npm run assets ...`). If the
 *                           flock holder is one of our ancestors we already own it (mode "flock-outer");
 *                           if another process holds it we wait; if nobody does we take the OS lock with a
 *                           helper `flock -n` process for the critical section (mode "flock-helper").
 *                           In both flock modes the record is written in place and truncated on release, so
 *                           the inode flock(1) users lock stays the same.
 * Test-only hooks (tests/assets/publish-lock.test.ts): SAMRAJYA_PUBLISH_LOCK_TRACE=<file> appends
 * "enter <pid>" / "exit <pid>" around every critical section; SAMRAJYA_PUBLISH_LOCK_TEST_PAUSE_MS="create:300,
 * break:300" stalls right after the lock path appears / right before a stale record is broken, to widen the
 * windows the races lived in.
 */
const LOCK_BREAK = `${PUBLISH_LOCK}.break`;
const LOCK_BREAK_STALE_MS = 60 * 1000;
const TEST_PAUSES = Object.fromEntries(
  String(process.env.SAMRAJYA_PUBLISH_LOCK_TEST_PAUSE_MS || '')
    .split(',')
    .map((p) => p.split(':'))
    .filter(([k, v]) => k && Number(v) > 0)
    .map(([k, v]) => [k.trim(), Number(v)]),
);
const pauseSab = new Int32Array(new SharedArrayBuffer(4));
function testPause(point) {
  const ms = TEST_PAUSES[point];
  if (ms) Atomics.wait(pauseSab, 0, 0, ms);
}
function trace(line) {
  const f = process.env.SAMRAJYA_PUBLISH_LOCK_TRACE;
  if (f) fs.appendFileSync(f, `${line} ${process.pid}\n`);
}
const uniqueName = (file, tag) => `${file}.${tag}.${process.pid}.${randomBytes(5).toString('hex')}`;

function procAncestors() {
  const out = new Set();
  let pid = process.ppid;
  for (let i = 0; i < 64 && pid > 1; i++) {
    out.add(pid);
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      pid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
    } catch {
      break;
    }
  }
  return out;
}

/** PIDs holding a flock(2) on the lock file's inode (/proc/locks), or null when unknown on this platform. */
function flockHolders(st) {
  let text;
  try {
    text = fs.readFileSync('/proc/locks', 'utf8');
  } catch {
    return null;
  }
  const out = [];
  for (const line of text.split('\n')) {
    const f = line.trim().split(/\s+/);
    if (f[1] !== 'FLOCK' || f.length < 6) continue;
    const ino = Number(f[5].split(':')[2]);
    if (ino === st.ino) out.push(Number(f[4]));
  }
  return out;
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function readRecord(file) {
  try {
    const st = fs.statSync(file);
    const text = fs.readFileSync(file, 'utf8');
    let owner = null;
    try {
      const j = JSON.parse(text);
      if (j && typeof j.pid === 'number' && typeof j.startedAt === 'number') owner = j;
    } catch {
      owner = null;
    }
    return { st, text, owner };
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

const readLock = () => readRecord(PUBLISH_LOCK);

function lockStale(owner, staleMs = PUBLISH_LOCK_STALE_MS) {
  if (Date.now() - owner.startedAt > staleMs) return true;
  return owner.host === os.hostname() && !pidAlive(owner.pid);
}

/**
 * Atomically create `file` holding `body`: write a private temp file, hard-link it into place (EEXIST = taken),
 * drop the temp name. The path never exists with partial content. Returns false when the file already exists.
 */
function createAtomic(file, body) {
  const tmp = uniqueName(file, 'new');
  fs.writeFileSync(tmp, body, { flag: 'wx' });
  try {
    fs.linkSync(tmp, file);
  } catch (e) {
    if (e.code === 'EEXIST') return false;
    throw e;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return true;
}

/**
 * Remove `file` only if it still holds exactly `expected`: rename it aside (atomic), compare the renamed content,
 * delete it on a match, else link it back (a newer lock that appeared meanwhile is never touched). True = removed.
 */
function removeIfUnchanged(file, expected) {
  const aside = uniqueName(file, 'aside');
  try {
    fs.renameSync(file, aside);
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
  let got = null;
  try {
    got = fs.readFileSync(aside, 'utf8');
  } catch {
    got = null;
  }
  if (got === expected) {
    fs.rmSync(aside, { force: true });
    return true;
  }
  try {
    fs.linkSync(aside, file);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    console.warn(`[assets] ${rel(file)} changed while it was being removed and a new one exists - leaving the new one`);
  } finally {
    fs.rmSync(aside, { force: true });
  }
  return false;
}

/** Start `flock -n <lock>` holding the OS lock until we close its stdin. Resolves to the child or null. */
function spawnFlockHolder() {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('flock', ['-n', '-E', '75', PUBLISH_LOCK, 'sh', '-c', 'echo locked; exec cat >/dev/null'], { stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      resolve(null);
      return;
    }
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    child.on('error', () => finish(null));
    child.stdout.on('data', (d) => {
      if (String(d).includes('locked')) finish(child);
    });
    child.on('exit', () => finish(null));
  });
}

async function acquirePublishLock(label) {
  fs.mkdirSync(path.dirname(PUBLISH_LOCK), { recursive: true });
  const record = { pid: process.pid, host: os.hostname(), startedAt: Date.now(), nonce: randomBytes(6).toString('hex'), ids: label };
  const body = JSON.stringify(record);
  const timeoutMs = Number(process.env.SAMRAJYA_PUBLISH_LOCK_TIMEOUT_MS || PUBLISH_LOCK_STALE_MS + 5 * 60 * 1000);
  const t0 = Date.now();
  let lastNote = 0;
  const note = (msg) => {
    if (Date.now() - lastNote < 30000) return;
    lastNote = Date.now();
    console.log(`[assets] waiting for the publish lock: ${msg}`);
  };
  const ancestors = procAncestors();
  for (;;) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${rel(PUBLISH_LOCK)}`);
    if (createAtomic(PUBLISH_LOCK, body)) {
      testPause('create');
      return { mode: 'excl', body, release: () => releaseIfOurs(body, 'unlink') };
    }
    const cur = readLock();
    if (!cur) continue;
    if (cur.owner) {
      if (lockStale(cur.owner)) {
        if (!breakStale(cur)) await sleep(50 + Math.random() * 50);
        continue;
      }
      note(`held by pid ${cur.owner.pid} on ${cur.owner.host} since ${new Date(cur.owner.startedAt).toISOString()} (${cur.owner.ids})`);
      await sleep(150 + Math.random() * 100);
      continue;
    }
    // Empty / foreign content: a flock(1) sentinel (excl locks are never empty, see createAtomic).
    const holders = flockHolders(cur.st);
    if (holders && holders.some((p) => ancestors.has(p))) {
      fs.writeFileSync(PUBLISH_LOCK, body);
      return { mode: 'flock-outer', body, release: () => releaseIfOurs(body, 'truncate') };
    }
    if (holders && holders.length) {
      note(`flock(1) held by pid ${holders.join(', ')}`);
      await sleep(150 + Math.random() * 100);
      continue;
    }
    const helper = holders ? await spawnFlockHolder() : null;
    if (holders && !helper) {
      await sleep(100 + Math.random() * 100);
      continue;
    }
    // We hold the OS lock (or the platform has no /proc/locks): claim the sentinel in place - unless it changed
    // (an excl owner replaced it, or it was removed) while we were taking the OS lock.
    const again = readLock();
    if (!again || again.owner || again.st.ino !== cur.st.ino) {
      helper?.stdin.end();
      continue;
    }
    fs.writeFileSync(PUBLISH_LOCK, body);
    return {
      mode: helper ? 'flock-helper' : 'sentinel',
      body,
      release: () => {
        releaseIfOurs(body, 'truncate');
        helper?.stdin.end();
      },
    };
  }
}

function releaseIfOurs(body, how) {
  if (how === 'unlink') {
    if (!removeIfUnchanged(PUBLISH_LOCK, body)) console.warn('[assets] publish lock was taken over while held (stale?) - not releasing it');
    return;
  }
  // flock modes: we hold the OS lock on this inode, nobody else writes it; truncate keeps the inode.
  const cur = readLock();
  if (!cur || cur.text !== body) {
    console.warn('[assets] publish lock was taken over while held (stale?) - not releasing it');
    return;
  }
  fs.truncateSync(PUBLISH_LOCK, 0);
}

/**
 * Break the stale record `seen` (A1 hardening). Serialized by the `.break` lock; returns true when this process
 * performed the break, false when another waiter is breaking (or already broke) it - the caller re-polls.
 */
function breakStale(seen) {
  const mine = JSON.stringify({ pid: process.pid, host: os.hostname(), startedAt: Date.now(), nonce: randomBytes(6).toString('hex') });
  if (!createAtomic(LOCK_BREAK, mine)) {
    // Another waiter is breaking. Its break lock is only held for milliseconds: clear it if its owner died.
    const b = readRecord(LOCK_BREAK);
    if (b && (!b.owner || lockStale(b.owner, LOCK_BREAK_STALE_MS))) removeIfUnchanged(LOCK_BREAK, b.text);
    return false;
  }
  try {
    const now = readLock();
    // Re-validate under the break lock: same file (inode), same record, still stale.
    if (!now || now.text !== seen.text || now.st.ino !== seen.st.ino || !now.owner || !lockStale(now.owner)) return false;
    testPause('break');
    console.warn(`[assets] removing stale publish lock of pid ${now.owner.pid} (${new Date(now.owner.startedAt).toISOString()})`);
    const holders = flockHolders(now.st);
    if (holders && holders.length) {
      // A record written into a flock(1) sentinel whose writer died while a flock(1) wrapper still holds the inode:
      // truncate in place (keep the inode flock(1) users lock). Only flock holders write this inode.
      if (fs.readFileSync(PUBLISH_LOCK, 'utf8') === now.text) fs.truncateSync(PUBLISH_LOCK, 0);
      return true;
    }
    removeIfUnchanged(PUBLISH_LOCK, now.text);
    return true;
  } finally {
    removeIfUnchanged(LOCK_BREAK, mine);
  }
}

async function withPublishLock(label, fn) {
  const t0 = Date.now();
  const lock = await acquirePublishLock(label);
  console.log(`[assets] publish lock acquired (${lock.mode}${Date.now() - t0 > 50 ? `, waited ${((Date.now() - t0) / 1000).toFixed(1)} s` : ''})`);
  trace('enter');
  try {
    const hold = Number(process.env.SAMRAJYA_PUBLISH_LOCK_HOLD_MS || 0);
    if (hold > 0) await sleep(hold); // tests: widen the critical section to force overlap
    return await fn();
  } finally {
    trace('exit');
    lock.release();
    console.log('[assets] publish lock released');
  }
}

// ------------------------------------------------------------------------------------ blender
function runBlender(asset, outDir, extraEnv = {}) {
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
        ...extraEnv,
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
    throw new Error(`${asset.id}: invalid asset.json (schema/id/kind mismatch: ${meta.id}/${meta.kind} vs ${asset.id}/${asset.kind})`);
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
  const pk = publishKeyFor(asset);
  if (pk) {
    entry.publishKey = pk;
    entry.tiers = [...asset.tiers];
    entry.fallback = asset.fallback;
  }
  Object.assign(entry, await publishAsset(asset, outDir, meta, entry.files));
  entry.bytes = Object.fromEntries(TIERS.map((t) => [t, entry.files.filter((f) => f.tiers.includes(t)).reduce((s, f) => s + f.bytes, 0)]));
  validateRecordEntry(entry);
  return entry;
}

function removeStaleFiles(prev, next) {
  if (!prev) return;
  const keep = new Set(next.files.map((f) => f.path));
  for (const f of prev.files ?? []) {
    if (keep.has(f.path)) continue;
    const p = path.join(PUBLIC_DIR, f.path);
    if (fs.existsSync(p)) fs.rmSync(p);
  }
}

// ------------------------------------------------------------------------------------ checks
function packageTotals(rec) {
  const out = Object.fromEntries(Object.keys(PACKAGES).map((k) => [k, Object.fromEntries(TIERS.map((t) => [t, 0]))]));
  for (const a of Object.values(rec.assets)) {
    const p = packageOf(a.category);
    if (p) for (const t of TIERS) out[p][t] += a.bytes?.[t] ?? 0;
  }
  return out;
}

function checkBudgets(rec) {
  const errors = [];
  const totals = Object.fromEntries(TIERS.map((t) => [t, 0]));
  for (const a of Object.values(rec.assets)) {
    for (const f of a.files) {
      const p = path.join(PUBLIC_DIR, f.path);
      if (!fs.existsSync(p)) errors.push(`missing published file ${rel(p)} (run npm run assets -- ${a.id})`);
      else if (fs.statSync(p).size !== f.bytes) errors.push(`${rel(p)} size differs from the build record`);
      if (f.bytes > BUDGETS.fileBytes) errors.push(`${f.path}: ${mb(f.bytes)} MB > single-file budget`);
    }
    for (const t of TIERS) totals[t] += a.bytes?.[t] ?? 0;
    if (a.draft) errors.push(`${a.id}: published from a --draft build (rebuild without --draft before committing)`);
    try {
      validateRecordEntry(a);
    } catch (e) {
      errors.push(String(e.message ?? e));
    }
  }
  for (const t of TIERS)
    if (totals[t] > BUDGETS.totalBytes[t]) errors.push(`tier ${t}: ${mb(totals[t])} MB > budget ${mb(BUDGETS.totalBytes[t])} MB`);
  const pkgs = packageTotals(rec);
  for (const [k, p] of Object.entries(PACKAGES))
    for (const t of TIERS)
      if (pkgs[k][t] > p.bytes[t]) errors.push(`${p.label}: ${t} ${mb(pkgs[k][t])} MB > budget ${mb(p.bytes[t])} MB`);
  return { errors, totals, pkgs };
}

function printTotals(totals, pkgs) {
  console.log(`[assets] totals: ${TIERS.map((t) => `${t} ${mb(totals[t])} MB`).join(', ')} (budget ${TIERS.map((t) => mb(BUDGETS.totalBytes[t])).join(' / ')} MB)`);
  for (const [k, p] of Object.entries(PACKAGES)) {
    const v = pkgs[k];
    if (!TIERS.some((t) => v[t] > 0)) continue;
    console.log(`[assets]   ${k.padEnd(4)} ${TIERS.map((t) => mb(v[t]).padStart(6)).join(' /')} MB  of ${TIERS.map((t) => mb(p.bytes[t])).join(' / ')}  ${p.label}`);
  }
}

// ------------------------------------------------------------------------------------ previews
function copyPreviews(idList, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const id of idList) {
    const dir = path.join(CACHE_DIR, id);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((n) => /^preview.*\.png$/.test(n)).sort()) {
      const name = `${id}_cycles${f.slice('preview'.length)}`;
      fs.copyFileSync(path.join(dir, f), path.join(outDir, name));
      console.log(`[assets] preview ${rel(path.join(outDir, name))}`);
    }
  }
}

// ------------------------------------------------------------------------------------ main
async function main() {
  if (flags.has('--style')) {
    process.stdout.write(JSON.stringify(styleValues(ids)) + '\n');
    return;
  }
  const assets = discover();
  const rec = loadPublished();

  if (flags.has('--selftest')) {
    await runBlender({ id: '_selftest', file: path.join(BLENDER_DIR, 'selftest.py') }, path.join(CACHE_DIR, '_selftest'));
    console.log('[assets] selftest passed');
    return;
  }
  if (flags.has('--list')) {
    const kb = (b) => (b ? `${(b / 1024).toFixed(0)}`.padStart(6) : '     -');
    console.log(`${'id'.padEnd(28)} ${'kind'.padEnd(9)} ${'category'.padEnd(14)} pkg  ${'tiers'.padEnd(18)} ${'KB ultra/high/mobile'.padEnd(22)} state`);
    const hashes = new Map();
    for (const id of topoOrder(assets, [...assets.keys()])) hashes.set(id, inputHashFor(assets.get(id), (d) => hashes.get(d) ?? ''));
    for (const a of assets.values()) {
      const pub = rec.assets[a.id];
      const dirty = pub && (pub.inputHash !== hashes.get(a.id) || (pub.publishKey ?? '') !== publishKeyFor(a));
      const state = pub ? `published ${pub.inputHash.slice(0, 8)}${dirty ? ' (DIRTY: inputs changed)' : ''}` : 'not published';
      const tiers = a.tiers.join(',') + (a.fallback ? ` ->${a.fallback}` : '');
      const bytes = pub ? TIERS.map((t) => kb(pub.bytes?.[t] ?? 0)).join('') : '';
      console.log(`${a.id.padEnd(28)} ${a.kind.padEnd(9)} ${a.category.padEnd(14)} ${(packageOf(a.category) ?? '-').padEnd(4)} ${tiers.padEnd(18)} ${bytes.padEnd(22)} ${state}${a.depends.length ? ` deps=[${a.depends.join(',')}]` : ''}`);
    }
    const { totals, pkgs } = checkBudgets(rec);
    printTotals(totals, pkgs);
    return;
  }
  if (flags.has('--check')) {
    const { errors, totals, pkgs } = checkBudgets(rec);
    for (const id of Object.keys(rec.assets)) if (!assets.has(id)) errors.push(`${id}: published but its script no longer exists`);
    // Out-of-date (DIRTY) assets are a warning, not an error: a teammate may be mid-bake in the shared tree.
    const hashes = new Map();
    for (const id of topoOrder(assets, [...assets.keys()])) hashes.set(id, inputHashFor(assets.get(id), (d) => hashes.get(d) ?? ''));
    for (const a of assets.values()) {
      const pub = rec.assets[a.id];
      if (pub && (pub.inputHash !== hashes.get(a.id) || (pub.publishKey ?? '') !== publishKeyFor(a)))
        console.warn(`[assets] WARN ${a.id}: DIRTY - inputs changed since it was published (npm run assets -- ${a.id})`);
    }
    const fresh = writeManifest(rec, { dryRun: true });
    if (!fresh.upToDate) errors.push('src/assets/manifest.ts is out of date (run npm run assets -- --republish <ids>)');
    printTotals(totals, pkgs);
    if (errors.length) {
      for (const e of errors) console.error(`[assets] ERROR ${e}`);
      process.exit(1);
    }
    console.log('[assets] check ok');
    return;
  }

  for (const id of ids) if (!assets.has(id)) throw new Error(`unknown asset "${id}". Known: ${[...assets.keys()].join(', ')}`);
  if (flags.has('--previews')) {
    copyPreviews(ids.length ? ids : [...assets.keys()], PREVIEWS_DIR ?? path.join(ROOT, 'docs', 'screenshots', 'pipeline'));
    return;
  }
  if (flags.has('--manifest')) {
    // Regenerate src/assets/manifest.ts from the record (after a generator change), under the lock.
    await withPublishLock('manifest', async () => {
      const res = writeManifest(loadPublished());
      console.log(`[assets] manifest ${res.upToDate ? 'unchanged' : 'written'}: ${rel(res.path)}`);
    });
    return;
  }
  if (flags.has('--restamp')) {
    const hashes = new Map();
    for (const id of topoOrder(assets, [...assets.keys()])) {
      const a = assets.get(id);
      const h = inputHashFor(a, (d) => hashes.get(d) ?? '');
      hashes.set(id, h);
      const outDir = path.join(CACHE_DIR, id);
      if (fs.existsSync(path.join(outDir, 'asset.json'))) fs.writeFileSync(path.join(outDir, '.inputhash'), h);
      console.log(`[assets] ${id}: restamped ${h.slice(0, 10)}`);
    }
    await withPublishLock('restamp', async () => {
      const fresh = loadPublished();
      for (const [id, h] of hashes) if (fresh.assets[id]) fresh.assets[id].inputHash = h;
      savePublished(fresh);
      writeManifest(fresh);
    });
    return;
  }

  const roots = ids.length ? ids : [...assets.keys()];
  const order = topoOrder(assets, roots);
  const t0 = Date.now();
  const built = new Map();
  let failure = null;
  try {
    await buildAll(assets, rec, order, built);
  } catch (err) {
    failure = err;
  }
  if (failure && !built.size) throw failure;

  // ---- commit: the only part that touches shared files (record + manifest), under the publish lock.
  const label = ids.length ? ids.join(',') : 'all';
  const result = await withPublishLock(label, async () => {
    const fresh = loadPublished();
    for (const [id, entry] of built) {
      removeStaleFiles(fresh.assets[id], entry);
      fresh.assets[id] = entry;
    }
    // Drop records whose scripts are gone (re-checked on disk: never drop a teammate's new asset).
    for (const id of Object.keys(fresh.assets)) {
      const script = fresh.assets[id].script ? path.join(ROOT, fresh.assets[id].script) : null;
      if (!assets.has(id) && (!script || !fs.existsSync(script))) {
        removeStaleFiles(fresh.assets[id], { files: [] });
        delete fresh.assets[id];
        console.log(`[assets] ${id}: script removed -> unpublished`);
      }
    }
    savePublished(fresh);
    const res = writeManifest(fresh);
    console.log(`[assets] manifest ${res.upToDate ? 'unchanged' : 'written'}: ${rel(res.path)}`);
    return checkBudgets(fresh);
  });
  if (failure) throw failure;
  console.log(`[assets] ${built.size} published in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  printTotals(result.totals, result.pkgs);
  if (result.errors.length) {
    for (const e of result.errors) console.error(`[assets] ${DRAFT ? 'WARN' : 'ERROR'} ${e}`);
    if (!DRAFT) process.exit(1);
  }
}

/** Blender + publish stages (outside the lock). Fills `built` with record entries as they finish. */
async function buildAll(assets, rec, order, built) {
  const hashes = new Map();
  for (const id of order) {
    const a = assets.get(id);
    const inputHash = inputHashFor(a, (d) => hashes.get(d) ?? rec.assets[d]?.inputHash ?? '');
    hashes.set(id, inputHash);
    const outDir = path.join(CACHE_DIR, id);
    const stampPath = path.join(outDir, '.inputhash');
    const cached = fs.existsSync(stampPath) && fs.readFileSync(stampPath, 'utf8') === inputHash && fs.existsSync(path.join(outDir, 'asset.json'));
    const prev = rec.assets[id];
    const publishKey = publishKeyFor(a);
    const upToDate =
      prev && prev.inputHash === inputHash && (prev.publishKey ?? '') === publishKey && prev.files.every((f) => fs.existsSync(path.join(PUBLIC_DIR, f.path)));
    const explicit = ids.includes(id);
    if (upToDate && !FORCE && !flags.has('--republish')) {
      console.log(`[assets] ${id}: up to date`);
      continue;
    }
    if ((!cached || FORCE) && !flags.has('--republish')) {
      console.log(`[assets] ${id}: blender ${rel(a.file)}${DRAFT ? ' (draft)' : ''}`);
      const styleEnv = a.style.length ? { SAMRAJYA_STYLE: JSON.stringify(styleValues(a.style)) } : {};
      // Invalidate the cache stamp first: an interrupted bake followed by reverted inputs must never reuse a
      // half-written cache directory under the old (matching) hash.
      fs.rmSync(stampPath, { force: true });
      const secs = await runBlender(a, outDir, styleEnv);
      fs.writeFileSync(stampPath, inputHash);
      console.log(`[assets] ${id}: blender done in ${secs.toFixed(1)} s`);
      if (PREVIEWS_DIR) copyPreviews([id], PREVIEWS_DIR);
    } else if (!fs.existsSync(path.join(outDir, 'asset.json'))) {
      if (flags.has('--republish') && !explicit && prev) {
        console.log(`[assets] ${id}: no cache, keeping published files`);
        continue;
      }
      throw new Error(`${id}: no cached build to republish - run without --republish`);
    } else {
      if (flags.has('--republish') && !explicit && prev && prev.inputHash === inputHash && (prev.publishKey ?? '') === publishKey) {
        console.log(`[assets] ${id}: dependency up to date, not republished`);
        continue;
      }
      console.log(`[assets] ${id}: using cached Blender output`);
    }
    const entry = await publish(a, outDir, fs.existsSync(stampPath) ? fs.readFileSync(stampPath, 'utf8') : inputHash);
    built.set(id, entry);
    console.log(`[assets] ${id}: published ${entry.files.length} files (${TIERS.map((t) => `${t} ${(entry.bytes[t] / 1024).toFixed(0)} KB`).join(', ')})`);
  }
}

main().catch((err) => {
  console.error(`[assets] ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});
