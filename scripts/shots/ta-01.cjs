#!/usr/bin/env node
/**
 * TA-01 evidence capture (WP1 PBR materials, terrain layers, decal atlas). OWNER: Technical Artist A (TA-01).
 *
 *   npx vite build --outDir .build/ta-01/dist --emptyOutDir
 *   NODE_PATH=$(npm root -g) node scripts/shots/ta-01.cjs [--only=deltas,budgets,previews,tiling,swatches,decals,viewer,splat,stupa]
 *                                                         [--ids=a,b] [--fast]
 *
 * Env: SHOTS_PORT (default 4404), SHOTS_DIST (default .build/ta-01/dist), SHOTS_OUT (default docs/sprint1/ta-01).
 *
 *   deltas    mean baseColor of every PUBLISHED WebP (all tiers; linear mean per channel -> sRGB) against the Art
 *             Director's target (MATERIAL_PRESETS / TERRAIN_LAYERS baseColor via `npm run assets -- --style`):
 *             per-channel and luminance delta in %, PASS within +-6 %. -> deltas.md, report.json
 *   budgets   WP1 bytes per tier from the generated manifest vs the ASSET_LIST budget (36 / 16 / 5.3 MB)
 *   previews  Cycles previews in docs/screenshots/pipeline/wp1 (copied by the runner's --previews-dir) re-encoded
 *             to JPEG (q86) to keep the repository small
 *   tiling    3 x 3 repeats under raking golden light (Cycles, the runner's preview_tiling) -> tiling/<id>.jpg +
 *             tiling_sheet.jpg
 *   swatches  256 px swatch board (target / measured chips) -> swatches.png, palette.png
 *   viewer    asset viewer lookdev (wall corner, column, sphere) at ~1.2 m (camera=detail) and ~9 m
 *             (camera=overview) under sky_day and sky_golden -> viewer/<id>.jpg (2 x 2 contact sheet)
 *   splat     4-layer height-blended splat lookdev of every BIOME_TERRAIN recipe -> splat/<biome>.jpg + splat_sheet.jpg
 *   decals    the shipped decal atlas composited by its ORM.b opacity over wall (plaster) / ground (earth)
 *             backdrops per region, labelled with the metadata.decals regions -> decals_atlas.png
 *   stupa     stupa_sanchi as published (samrajya_set sandstone_carved_red) and re-skinned to sandstone_buff by
 *             rewriting the GLB JSON chunk in flight (page.route) -> proves the shared trim-band layout
 * Fails (exit 1) on console errors, page errors, failed requests or a delta outside +-6 %.
 */
'use strict';
const { spawn, execFileSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.SHOTS_PORT || 4404);
const DIST = process.env.SHOTS_DIST || '.build/ta-01/dist';
const OUT = path.resolve(ROOT, process.env.SHOTS_OUT || 'docs/sprint1/ta-01');
const RAW = path.join(ROOT, '.build', 'ta-01', 'shots');
const args = Object.fromEntries(process.argv.slice(2).map((a) => (/^--([^=]+)=?(.*)$/.exec(a) || [null, a, '1']).slice(1)));
const ONLY = args.only ? new Set(args.only.split(',')) : null;
const run = (g) => !ONLY || ONLY.has(g);
const sharp = require(path.join(ROOT, 'node_modules', 'sharp'));
const MANIFEST = fs.readFileSync(path.join(ROOT, 'src', 'assets', 'manifest.ts'), 'utf8');
const MANIFEST_JSON = JSON.parse(MANIFEST.slice(MANIFEST.indexOf('{', MANIFEST.indexOf('ASSET_MANIFEST =')), MANIFEST.indexOf('} as const') + 1));
const PUB = path.join(ROOT, 'public', 'assets');
const CACHE = path.join(ROOT, '.asset-cache');
const PREVIEWS = path.join(ROOT, 'docs', 'screenshots', 'pipeline', 'wp1');
const TOL = 6;
const BUDGET = { ultra: 36, high: 16, mobile: 5.3 };
const TIERS = ['ultra', 'high', 'mobile'];

// ------------------------------------------------------------------ WP1 discovery (script docstring tags)
function discover() {
  const out = [];
  for (const cat of ['materials', 'terrain', 'decals']) {
    const dir = path.join(ROOT, 'tools', 'blender', 'assets', cat);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.py') && !n.startsWith('_')).sort()) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      const id = /@asset[ \t]+(\w+)/.exec(src)?.[1];
      if (!id) continue;
      const styles = (/@style[ \t]+([^\n]+)/.exec(src)?.[1] ?? '').split(/[,\s]+/).filter(Boolean);
      const target = styles.find((s) => /^(materials:MATERIAL_PRESETS|terrain:TERRAIN_LAYERS)\./.test(s)) ?? null;
      const cls = /cls="(\w)"/.exec(src)?.[1] ?? '?';
      out.push({ id, cat, target, cls });
    }
  }
  return out;
}
let SETS = discover();
if (args.ids) {
  const keep = new Set(args.ids.split(','));
  SETS = SETS.filter((s) => keep.has(s.id));
}

function styleValues(refs) {
  if (!refs.length) return {};
  const outp = execFileSync(process.execPath, [path.join(ROOT, 'tools', 'assets', 'build.mjs'), '--style', ...refs], { cwd: ROOT, maxBuffer: 1 << 26 }).toString();
  return JSON.parse(outp.slice(outp.indexOf('{')));
}

// ------------------------------------------------------------------ colour helpers
const lin = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const enc = (l) => 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbToHex = (c) => '#' + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
const lum = (l) => 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];

/** Linear mean per channel of an sRGB image (alpha ignored), re-encoded to sRGB 0..255. */
async function meanColor(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const s = [0, 0, 0];
  const n = info.width * info.height;
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) s[c] += lin(data[i * 3 + c]);
  const m = s.map((v) => v / n);
  return { srgb: m.map(enc), linear: m };
}

// ------------------------------------------------------------------ sheets
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function labelSvg(w, h, text, { size = 15, fill = '#f3e6c8', bg = 'rgba(18,13,31,0.78)', align = 'left' } = {}) {
  const x = align === 'left' ? 8 : w / 2;
  const anchor = align === 'left' ? 'start' : 'middle';
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${bg}"/>` +
      `<text x="${x}" y="${Math.round(h * 0.68)}" font-family="DejaVu Sans, sans-serif" font-size="${size}" fill="${fill}" text-anchor="${anchor}">${esc(text)}</text></svg>`,
  );
}

/** Grid contact sheet: items [{file, label}] -> JPEG (or PNG by extension). */
async function sheet(items, cols, cw, ch, out, title) {
  const lh = 24;
  const th = title ? 34 : 0;
  const rows = Math.ceil(items.length / cols);
  const W = cols * cw;
  const H = th + rows * (ch + lh);
  const comps = [];
  if (title) comps.push({ input: labelSvg(W, th, title, { size: 18, bg: '#120d1f' }), left: 0, top: 0 });
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const x = (i % cols) * cw;
    const y = th + Math.floor(i / cols) * (ch + lh);
    if (it.file && fs.existsSync(it.file)) comps.push({ input: await sharp(it.file).resize(cw, ch, { fit: 'cover' }).toBuffer(), left: x, top: y });
    comps.push({ input: labelSvg(cw, lh, it.label, { size: 13 }), left: x, top: y + ch });
  }
  const img = sharp({ create: { width: W, height: H, channels: 3, background: '#1a1626' } }).composite(comps);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (out.endsWith('.png')) await img.png().toFile(out);
  else await img.jpeg({ quality: 84, mozjpeg: true }).toFile(out);
}

// ------------------------------------------------------------------ browser plumbing (pattern of ta-07.cjs)
function requirePlaywright() {
  try {
    return require('playwright');
  } catch {
    return require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
  }
}
function waitForServer(url, ms) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () =>
      http
        .get(url, (res) => {
          res.resume();
          if (res.statusCode && res.statusCode < 500) resolve();
          else retry();
        })
        .on('error', retry);
    const retry = () => (Date.now() - t0 > ms ? reject(new Error(`server not up at ${url}`)) : setTimeout(tryOnce, 300));
    tryOnce();
  });
}

/** glTF binary with every `"samrajya_set": "<from>"` in the JSON chunk replaced by `<to>` (chunk re-padded). */
function rewriteGlb(buf, from, to) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLen = buf.readUInt32LE(12);
  const jsonType = buf.readUInt32LE(16);
  const json = buf.subarray(20, 20 + jsonLen).toString('utf8');
  let count = 0;
  let j2 = json.replace(new RegExp(`("samrajya_set"\\s*:\\s*")${from}(")`, 'g'), (_, a, b) => {
    count++;
    return a + to + b;
  });
  const pad = (4 - (Buffer.byteLength(j2) % 4)) % 4;
  j2 += ' '.repeat(pad);
  const jb = Buffer.from(j2, 'utf8');
  const rest = buf.subarray(20 + jsonLen);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(buf.readUInt32LE(4), 4);
  header.writeUInt32LE(12 + 8 + jb.length + rest.length, 8);
  const chunk = Buffer.alloc(8);
  chunk.writeUInt32LE(jb.length, 0);
  chunk.writeUInt32LE(jsonType, 4);
  return { buf: Buffer.concat([header, chunk, jb, rest]), count };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(RAW, { recursive: true });
  const report = { generated: new Date().toISOString(), tolerancePct: TOL, sets: {}, budgets: null, shots: [], failures: [] };
  const failures = report.failures;

  // ---------------------------------------------------------------- deltas
  const targets = styleValues([...new Set(SETS.map((s) => s.target).filter(Boolean))]);
  if (run('deltas')) {
    const rows = [];
    for (const s of SETS) {
      const e = MANIFEST_JSON.assets[s.id];
      if (!e) {
        failures.push(`${s.id}: not in the manifest (not published)`);
        continue;
      }
      const t = s.target ? targets[s.target]?.baseColor : null;
      const r = { id: s.id, class: s.cls, target: t ?? null, tiers: {} };
      for (const tier of TIERS) {
        const m = e.maps?.baseColor?.[tier];
        if (!m) continue;
        const mc = await meanColor(path.join(PUB, m.url));
        const hex = rgbToHex(mc.srgb);
        const row = { url: m.url, size: m.size, mean: hex };
        if (t) {
          const tc = hexToRgb(t);
          row.deltaRgbPct = mc.srgb.map((v, c) => +(((v - tc[c]) / Math.max(tc[c], 1)) * 100).toFixed(2));
          row.deltaLumPct = +((lum(mc.linear) / lum(tc.map(lin)) - 1) * 100).toFixed(2);
          row.pass = row.deltaRgbPct.every((d) => Math.abs(d) <= TOL) && Math.abs(row.deltaLumPct) <= TOL;
          if (!row.pass) failures.push(`${s.id} ${tier}: mean ${hex} vs ${t} outside +-${TOL} %`);
        }
        r.tiers[tier] = row;
      }
      report.sets[s.id] = r;
      const u = r.tiers.ultra;
      const worst = t ? Math.max(...TIERS.flatMap((k) => (r.tiers[k] ? [...r.tiers[k].deltaRgbPct.map(Math.abs), Math.abs(r.tiers[k].deltaLumPct)] : []))) : null;
      rows.push({ id: s.id, cls: s.cls, t, u: u?.mean, h: r.tiers.high?.mean, m: r.tiers.mobile?.mean, d: u?.deltaRgbPct, dl: u?.deltaLumPct, worst });
      console.log(`[ta-01] ${s.id.padEnd(28)} ${s.cls} target ${t ?? '  (none)'}  ultra ${u?.mean} ${u?.deltaRgbPct ? u.deltaRgbPct.join('/') + ' %' : ''}  worst tier |d| ${worst ?? '-'} %`);
    }
    const md = [
      '# TA-01 - WP1 mean baseColor vs target',
      '',
      `Measured by \`scripts/shots/ta-01.cjs\` from the PUBLISHED WebP of every tier (sharp decode, linear mean per channel,`,
      `re-encoded to sRGB). Delta = (measured - target) / target per sRGB channel, luminance delta on linear luminance.`,
      `Tolerance +-${TOL} %. The decal atlas has no single target (n/a).`,
      '',
      '| id | class | target | ultra | high | mobile | ultra dR/dG/dB % | ultra dLum % | worst tier abs % | pass |',
      '|---|---|---|---|---|---|---|---|---|---|',
      ...rows.map((r) => `| ${r.id} | ${r.cls} | ${r.t ?? 'n/a'} | ${r.u ?? '-'} | ${r.h ?? '-'} | ${r.m ?? '-'} | ${r.d ? r.d.join(' / ') : 'n/a'} | ${r.dl ?? 'n/a'} | ${r.worst ?? 'n/a'} | ${r.t ? (r.worst <= TOL ? 'PASS' : 'FAIL') : 'n/a'} |`),
      '',
    ].join('\n');
    fs.writeFileSync(path.join(OUT, 'deltas.md'), md);
  }

  // ---------------------------------------------------------------- budgets
  if (run('budgets')) {
    const all = discover();
    const sum = { ultra: 0, high: 0, mobile: 0 };
    const rows = [];
    for (const s of all) {
      const e = MANIFEST_JSON.assets[s.id];
      if (!e) continue;
      for (const t of TIERS) sum[t] += e.bytes?.[t] ?? 0;
      rows.push(`| ${s.id} | ${s.cat} | ${s.cls} | ${(e.tiers ?? TIERS).join(',')} | ${TIERS.map((t) => ((e.bytes?.[t] ?? 0) / 1024).toFixed(0)).join(' | ')} |`);
    }
    const MB = (b) => (b / (1024 * 1024)).toFixed(2);
    report.budgets = { bytes: sum, budgetMB: BUDGET, withinBudget: TIERS.every((t) => sum[t] / (1024 * 1024) <= BUDGET[t]) };
    const md = [
      '# TA-01 - WP1 texture budget (published WebP, from src/assets/manifest.ts)',
      '',
      '| id | category | class | tiers | ultra KB | high KB | mobile KB |',
      '|---|---|---|---|---|---|---|',
      ...rows,
      `| **total** | | | | **${MB(sum.ultra)} MB** | **${MB(sum.high)} MB** | **${MB(sum.mobile)} MB** |`,
      `| budget (ASSET_LIST WP1) | | | | ${BUDGET.ultra} MB | ${BUDGET.high} MB | ${BUDGET.mobile} MB |`,
      '',
    ].join('\n');
    fs.writeFileSync(path.join(OUT, 'budgets.md'), md);
    console.log(`[ta-01] WP1 totals: ultra ${MB(sum.ultra)} MB / high ${MB(sum.high)} MB / mobile ${MB(sum.mobile)} MB (budget ${BUDGET.ultra} / ${BUDGET.high} / ${BUDGET.mobile})`);
    if (!report.budgets.withinBudget) failures.push('WP1 over budget');
  }

  // ---------------------------------------------------------------- Cycles previews -> JPEG
  if (run('previews') && fs.existsSync(PREVIEWS)) {
    for (const f of fs.readdirSync(PREVIEWS).filter((n) => n.endsWith('.png'))) {
      const src = path.join(PREVIEWS, f);
      await sharp(src).jpeg({ quality: 86, mozjpeg: true }).toFile(src.replace(/\.png$/, '.jpg'));
      fs.unlinkSync(src);
    }
  }

  // ---------------------------------------------------------------- tiling + swatches
  const previewFile = (id, suffix) => {
    for (const p of [path.join(CACHE, id, `preview${suffix}.png`), path.join(PREVIEWS, `${id}_cycles${suffix}.jpg`), path.join(PREVIEWS, `${id}_cycles${suffix}.png`)])
      if (fs.existsSync(p)) return p;
    return null;
  };
  if (run('tiling')) {
    const items = [];
    fs.mkdirSync(path.join(OUT, 'tiling'), { recursive: true });
    for (const s of SETS.filter((x) => x.cat !== 'decals')) {
      const f = previewFile(s.id, '_tiling');
      if (!f) {
        failures.push(`${s.id}: no tiling preview`);
        continue;
      }
      const out = path.join(OUT, 'tiling', `${s.id}.jpg`);
      await sharp(f).resize(768, 768).jpeg({ quality: 84, mozjpeg: true }).toFile(out);
      items.push({ file: out, label: `${s.id} (${s.cls})` });
    }
    await sheet(items, 6, 320, 320, path.join(OUT, 'tiling_sheet.jpg'), 'WP1 - 3 x 3 repeats under raking golden light (sun 11 deg, Cycles, shipped maps)');
  }
  if (run('swatches')) {
    const comps = [];
    const cols = 8;
    const cw = 256;
    const chH = 26;
    const lh = 40;
    const sets = SETS.filter((s) => fs.existsSync(path.join(CACHE, s.id, 'swatch.png')));
    const rows = Math.ceil(sets.length / cols);
    for (let i = 0; i < sets.length; i++) {
      const s = sets[i];
      const x = (i % cols) * cw;
      const y = Math.floor(i / cols) * (cw + chH + lh);
      comps.push({ input: await sharp(path.join(CACHE, s.id, 'swatch.png')).resize(cw, cw).toBuffer(), left: x, top: y });
      const t = s.target ? targets[s.target]?.baseColor : null;
      const meas = report.sets[s.id]?.tiers?.ultra?.mean ?? MANIFEST_JSON.assets[s.id]?.averageColor ?? '#808080';
      const chip = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${chH}"><rect x="0" width="${cw / 2}" height="${chH}" fill="${t ?? '#1a1626'}"/>` +
          `<rect x="${cw / 2}" width="${cw / 2}" height="${chH}" fill="${meas}"/></svg>`,
      );
      comps.push({ input: chip, left: x, top: y + cw });
      comps.push({ input: labelSvg(cw, lh / 2, `${s.id}`, { size: 12 }), left: x, top: y + cw + chH });
      comps.push({ input: labelSvg(cw, lh / 2, `target ${t ?? 'n/a'} | measured ${meas}`, { size: 11, fill: '#c9bfa8' }), left: x, top: y + cw + chH + lh / 2 });
    }
    await sharp({ create: { width: cols * cw, height: rows * (cw + chH + lh), channels: 3, background: '#1a1626' } })
      .composite(comps)
      .png()
      .toFile(path.join(OUT, 'swatches.png'));
    // palette board: target vs measured chips per tier, grouped
    const pc = [];
    const rowH = 30;
    const W = 1100;
    pc.push({ input: labelSvg(W, rowH, 'id                              target      ultra       high        mobile', { size: 13, bg: '#120d1f' }), left: 0, top: 0 });
    sets.forEach((s, i) => {
      const y = (i + 1) * rowH;
      const t = s.target ? targets[s.target]?.baseColor : null;
      const r = report.sets[s.id]?.tiers ?? {};
      const cells = [t, r.ultra?.mean, r.high?.mean, r.mobile?.mean];
      let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${rowH}"><rect width="100%" height="100%" fill="#1a1626"/>`;
      svg += `<text x="8" y="20" font-family="DejaVu Sans Mono, monospace" font-size="13" fill="#f3e6c8">${esc(s.id)}</text>`;
      cells.forEach((c, k) => {
        if (!c) return;
        const x = 300 + k * 200;
        svg += `<rect x="${x}" y="3" width="110" height="${rowH - 6}" fill="${c}"/><text x="${x + 116}" y="20" font-family="DejaVu Sans Mono, monospace" font-size="12" fill="#c9bfa8">${c}</text>`;
      });
      svg += '</svg>';
      pc.push({ input: Buffer.from(svg), left: 0, top: y });
    });
    await sharp({ create: { width: W, height: (sets.length + 1) * rowH, channels: 3, background: '#1a1626' } })
      .composite(pc)
      .png()
      .toFile(path.join(OUT, 'palette.png'));
  }

  // ---------------------------------------------------------------- decal atlas composite (shipped maps)
  if (run('decals') && MANIFEST_JSON.assets.decals_settlement) {
    const e = MANIFEST_JSON.assets.decals_settlement;
    const pub = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'assets', 'published.json'), 'utf8'));
    const regions = pub.assets.decals_settlement?.meta?.decals ?? [];
    const bc = await sharp(path.join(PUB, e.maps.baseColor.ultra.url)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const orm = await sharp(path.join(PUB, e.maps.orm.ultra.url)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const N = bc.info.width;
    const out = Buffer.alloc(N * N * 3);
    const wall = hexToRgb('#cdbfa6').map(lin);
    const ground = hexToRgb('#9a7e5e').map(lin);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const u = (x + 0.5) / N;
        const v = 1 - (y + 0.5) / N;
        const r = regions.find((q) => u >= q.u0 && u < q.u1 && v >= q.v0 && v < q.v1);
        const back = r && r.surface === 'wall' ? wall : ground;
        const i = (y * N + x) * 3;
        const a = orm.data[(y * orm.info.width + Math.floor((x * orm.info.width) / N)) * 3 + 2] / 255;
        for (let c = 0; c < 3; c++) out[i + c] = Math.round(enc(back[c] * (1 - a) + lin(bc.data[i + c]) * a));
      }
    const labels = regions.map((q) => {
      const x = Math.round(q.u0 * N) + 4;
      const y = Math.round((1 - q.v1) * N) + 4;
      return `<text x="${x}" y="${y + 11}" font-family="DejaVu Sans, sans-serif" font-size="11" fill="#120d1f" stroke="#f3e6c8" stroke-width="2.5" paint-order="stroke">${esc(q.name)}</text>` +
        `<rect x="${Math.round(q.u0 * N) + 0.5}" y="${Math.round((1 - q.v1) * N) + 0.5}" width="${Math.round((q.u1 - q.u0) * N) - 1}" height="${Math.round((q.v1 - q.v0) * N) - 1}" fill="none" stroke="#120d1f" stroke-opacity="0.35"/>`;
    });
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${N}" height="${N}">${labels.join('')}</svg>`);
    await sharp(out, { raw: { width: N, height: N, channels: 3 } }).composite([{ input: svg, left: 0, top: 0 }]).png().toFile(path.join(OUT, 'decals_atlas.png'));
    report.decals = regions.map((q) => ({ name: q.name, category: q.category, surface: q.surface, tileU: q.tileU, uv: [q.u0, q.v0, q.u1, q.v1], sizeMeters: q.sizeMeters }));
    console.log(`[ta-01] decal atlas: ${regions.length} regions composited over wall / ground backdrops (ORM.b opacity) -> decals_atlas.png`);
  }

  // ---------------------------------------------------------------- browser groups
  const needBrowser = run('viewer') || run('splat') || run('stupa');
  if (needBrowser) {
    if (!fs.existsSync(path.join(ROOT, DIST, 'index.html'))) throw new Error(`${DIST} not built: npx vite build --outDir ${DIST} --emptyOutDir`);
    const { chromium } = requirePlaywright();
    const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
    const server = spawn(process.execPath, [viteBin, 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    const base = `http://127.0.0.1:${PORT}/`;
    let browser;
    const vp = args.fast ? [640, 360] : [960, 540];

    async function blank(file) {
      const st = await sharp(file).stats();
      return Math.max(...st.channels.slice(0, 3).map((c) => c.stdev)) < 1.5;
    }

    async function shootOnce(file, query, opts = {}) {
      const context = await browser.newContext({ viewport: { width: vp[0], height: vp[1] }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const errors = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
      });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`));
      let routed = null;
      if (opts.reskin) {
        // the loader appends a cache-buster (?v=<hash>), so match on the path, not a glob
        await page.route((u) => u.pathname.endsWith('.glb'), async (route) => {
          const resp = await route.fetch();
          const body = await resp.body();
          const url = route.request().url();
          if (!url.includes(opts.reskin.model)) return route.fulfill({ response: resp, body });
          const r = rewriteGlb(body, opts.reskin.from, opts.reskin.to);
          routed = (routed ?? 0) + r.count;
          return route.fulfill({ response: resp, body: r.buf, headers: { ...resp.headers(), 'content-length': String(r.buf.length) } });
        });
      }
      const url = `${base}?scene=assetviewer&quality=${opts.quality || 'high'}&noaudio=1&noui=1&${query}`;
      const t0 = Date.now();
      let state = null;
      try {
        await page.goto(url, { waitUntil: 'load', timeout: 240000 });
        await page.waitForFunction(() => window.__SAMRAJYA__ && window.__SAMRAJYA__.ready && window.__SAMRAJYA__.sceneReady, null, { timeout: 240000, polling: 250 });
        await page.evaluate((n) => window.__SAMRAJYA__.waitFrames(n), 4);
        await page.waitForFunction(() => !document.getElementById('boot-splash'), null, { timeout: 30000, polling: 100 }).catch(() => undefined);
        state = await page.evaluate(() => window.__SAMRAJYA__.getState().sceneState);
        await page.evaluate(() => window.__SAMRAJYA__.freeze(true));
        for (const c of await page.evaluate(() => window.__SAMRAJYA__.getErrors().map((r) => r.message))) errors.push(`crash: ${c}`);
        await page.screenshot({ path: file, timeout: 240000 });
      } catch (err) {
        errors.push(`shots: ${err && err.message ? err.message : String(err)}`);
      }
      await context.close();
      const ms = Date.now() - t0;
      return { url, ms, errors, state, routed };
    }

    async function shoot(name, file, query, opts = {}) {
      let r = await shootOnce(file, query, opts);
      for (let k = 0; k < 2 && fs.existsSync(file) && (await blank(file)); k++) r = await shootOnce(file, query, opts);
      report.shots.push({ name, url: r.url, ms: r.ms, errors: r.errors, routed: r.routed ?? undefined });
      console.log(`[ta-01] ${r.errors.length ? 'FAIL' : 'ok  '} ${name.padEnd(44)} ${String(r.ms).padStart(6)} ms`);
      for (const e of r.errors) console.log(`         ${e}`);
      if (r.errors.length) failures.push(name);
      return r;
    }

    try {
      await waitForServer(base, 30000);
      browser = await chromium.launch({
        headless: true,
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
      });

      if (run('viewer')) {
        fs.mkdirSync(path.join(OUT, 'viewer'), { recursive: true });
        const views = [
          ['sky_day', 'detail', '~1.2 m, sky_day'],
          ['sky_day', 'overview', '~9 m, sky_day'],
          ['sky_golden', 'detail', '~1.2 m, sky_golden'],
          ['sky_golden', 'overview', '~9 m, sky_golden'],
        ];
        // the decal atlas is not a surface material (ORM.b = opacity, not metalness): its lookdev is the Cycles atlas
        // preview (docs/screenshots/pipeline/wp1/decals_settlement_cycles.jpg)
        for (const s of SETS.filter((x) => x.cat !== 'decals')) {
          const items = [];
          for (const [sky, cam, label] of views) {
            const file = path.join(RAW, `viewer_${s.id}_${sky}_${cam}.png`);
            await shoot(`viewer ${s.id} ${sky} ${cam}`, file, `asset=${s.id}&hdri=${sky}&camera=${cam}&assets=ultra`);
            items.push({ file, label });
          }
          await sheet(items, 2, 640, 360, path.join(OUT, 'viewer', `${s.id}.jpg`), `${s.id} - asset viewer lookdev (wall corner, column, sphere), quality high, ultra textures`);
        }
      }

      if (run('splat')) {
        fs.mkdirSync(path.join(OUT, 'splat'), { recursive: true });
        const terr = fs.readFileSync(path.join(ROOT, 'src', 'render', 'style', 'terrain.ts'), 'utf8');
        const layerAsset = {};
        for (const m of terr.matchAll(/^\s+(\w+): L\(\{ id: '(\w+)'.*?assetId: (?:'(\w+)'|null)/gm)) layerAsset[m[1]] = m[3] ?? null;
        const bt = terr.slice(terr.indexOf('export const BIOME_TERRAIN'));
        const items = [];
        for (const m of bt.matchAll(/^\s+(\w+): \{ layers: \[([^\]]+)\]/gm)) {
          const biome = m[1];
          const keys = m[2].split(',').map((x) => x.trim().replace(/'/g, ''));
          const ids = keys.map((k) => layerAsset[k] ?? k);
          const missing = ids.filter((id) => !MANIFEST_JSON.assets[id]);
          const file = path.join(RAW, `splat_${biome}.png`);
          await shoot(`splat ${biome}`, file, `splat=${ids.join(',')}&hdri=sky_golden&assets=ultra`);
          const out = path.join(OUT, 'splat', `${biome}.jpg`);
          if (fs.existsSync(file)) await sharp(file).jpeg({ quality: 84, mozjpeg: true }).toFile(out);
          items.push({ file: out, label: `${biome}: ${keys.join(', ')}${missing.length ? ` (fallback: ${missing.join(', ')})` : ''}` });
          report.splat = report.splat ?? {};
          report.splat[biome] = { layers: keys, assets: ids, fallback: missing };
        }
        await sheet(items, 3, 640, 360, path.join(OUT, 'splat_sheet.jpg'), 'BIOME_TERRAIN recipes - 4-layer height-blended splat (layers left -> right), sky_golden, 18 % grey card');
      }

      if (run('stupa')) {
        const a = path.join(RAW, 'stupa_red.png');
        const b = path.join(RAW, 'stupa_buff.png');
        const c = path.join(RAW, 'stupa_buff_close.png');
        await shoot('stupa_sanchi samrajya_set=sandstone_carved_red', a, 'asset=stupa_sanchi&hdri=sky_golden&camera=hero&assets=ultra');
        const r = await shoot('stupa_sanchi samrajya_set=sandstone_buff', b, 'asset=stupa_sanchi&hdri=sky_golden&camera=hero&assets=ultra', {
          reskin: { model: 'stupa_sanchi', from: 'sandstone_carved_red', to: 'sandstone_buff' },
        });
        await shoot('stupa_sanchi buff close', c, 'asset=stupa_sanchi&hdri=sky_golden&camera=close&assets=ultra', {
          reskin: { model: 'stupa_sanchi', from: 'sandstone_carved_red', to: 'sandstone_buff' },
        });
        report.stupaReskin = { replacedSetReferences: r.routed };
        if (!r.routed) failures.push('stupa reskin: no samrajya_set reference rewritten');
        await sheet(
          [
            { file: a, label: 'as published: samrajya_set = sandstone_carved_red' },
            { file: b, label: `samrajya_set -> sandstone_buff (${r.routed ?? 0} refs rewritten in the GLB)` },
            { file: c, label: 'sandstone_buff, camera=close (trim bands: ashlar, vine, dentil, padma, bead-reel, frieze)' },
          ],
          3,
          640,
          360,
          path.join(OUT, 'stupa_reskin.jpg'),
          'stupa_sanchi re-skinned by changing samrajya_set only (same trim-band layout)',
        );
      }
    } finally {
      if (browser) await browser.close();
      server.kill('SIGTERM');
    }
  }

  // merge with an earlier partial run (--only / --ids): newer groups and shots replace older ones by name
  const reportFile = path.join(OUT, 'report.json');
  if (fs.existsSync(reportFile) && (ONLY || args.ids)) {
    try {
      const prev = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
      const names = new Set(report.shots.map((x) => x.name));
      report.shots = [...(prev.shots ?? []).filter((x) => !names.has(x.name)), ...report.shots];
      report.sets = { ...(prev.sets ?? {}), ...report.sets };
      for (const k of ['budgets', 'splat', 'stupaReskin', 'decals']) if (report[k] === undefined && prev[k] !== undefined) report[k] = prev[k];
    } catch {
      // unreadable earlier report: start fresh
    }
  }
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
  console.log(`[ta-01] ${failures.length ? `FAIL (${failures.length})` : 'all ok'} -> ${path.relative(ROOT, OUT)}`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
