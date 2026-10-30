#!/usr/bin/env node
/**
 * TA-07 evidence capture (pipeline extensions + WP7 content). OWNER: Technical Artist G (TA-07).
 *
 *   npx vite build --outDir .build/ta-07 --emptyOutDir
 *   NODE_PATH=$(npm root -g) node scripts/shots/ta-07.cjs [--only=crowd,impostor,skies,fx,gtao,r2,lut,skinned,banners,kit,splat,images,off,mobile]
 *
 * Env: SHOTS_PORT (default 4402), SHOTS_DIST (default .build/ta-07), SHOTS_OUT (default docs/sprint1/ta-07).
 * Starts `vite preview` on the ticket port, opens asset-viewer deep links in headless Chromium (SwiftShader),
 * waits for sceneReady, saves PNGs and prints / writes the measured numbers (docs/sprint1/ta-07/report.json):
 * crowd draw calls per LOD (color / shadow / AO pre-pass), impostor A/B luminance difference at 220 m, sky sun /
 * irradiance table, sky horizon-seam rows, smoke shading under two sun directions, flipbook quads vs the GTAO
 * pre-pass (empty quad area vs the backdrop, prepass tag on vs off), skinned clone memory (renderer.info.memory)
 * before / after release, kit draw calls, assets=off null checks. Round 2 (`r2`, Art Director R2-B1..B4): lit smoke /
 * dust value statistics over the effect's own pixels (atlas alpha >= 0.5) under golden / noon on ultra and mobile, the
 * east / west sun difference inside the smoke, fire night emission hue + 4x-boosted crops, shipped-atlas frame strips
 * (fire 14-48 and the loop seam, parry flash, finisher, trail), weapon-trail tail 4x crops with flat-run counts.
 * Fails (exit 1) on console errors, page errors or failed requests.
 */
'use strict';
const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.SHOTS_PORT || 4402);
const DIST = process.env.SHOTS_DIST || '.build/ta-07';
const OUT = path.resolve(ROOT, process.env.SHOTS_OUT || 'docs/sprint1/ta-07');
const args = Object.fromEntries(process.argv.slice(2).map((a) => (/^--([^=]+)=?(.*)$/.exec(a) || [null, a, '1']).slice(1)));
const ONLY = args.only ? new Set(args.only.split(',')) : null;
const sharp = require(path.join(ROOT, 'node_modules', 'sharp'));
const MANIFEST = fs.readFileSync(path.join(ROOT, 'src', 'assets', 'manifest.ts'), 'utf8');
/** The generated manifest object (JSON between `ASSET_MANIFEST =` and `} as const`). */
const MANIFEST_JSON = JSON.parse(MANIFEST.slice(MANIFEST.indexOf('{', MANIFEST.indexOf('ASSET_MANIFEST =')), MANIFEST.indexOf('} as const') + 1));
const PUB = path.join(ROOT, 'public', 'assets');

/** Decoded RGBA of a file. */
async function rgba(file) {
  const { data, info } = await sharp(file, { limitInputPixels: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Nearest sample of atlas frame k at (u, v) in [0, 1] (v = 0 at the frame top), channel ch, as [0, 1]. */
function atlasSample(img, cols, rows, k, u, v, ch) {
  const fw = img.width / cols;
  const fh = img.height / rows;
  const x = Math.min(fw - 1, Math.max(0, Math.floor(u * fw))) + (k % cols) * fw;
  const y = Math.min(fh - 1, Math.max(0, Math.floor(v * fh))) + Math.floor(k / cols) * fh;
  return img.data[(y * img.width + x) * 4 + ch] / 255;
}

/** Linear rgb of a gradient-map ramp at v (the runtime's flipRampColor). */
function rampAt(ramp, v) {
  const n = ramp.length;
  const x = Math.min(1, Math.max(0, v)) * (n - 1);
  const i = Math.min(Math.floor(x), n - 2);
  const f = x - i;
  return [0, 1, 2].map((c) => ramp[i][c] + (ramp[i + 1][c] - ramp[i][c]) * f);
}
const encodeSrgb = (l) => (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);

/**
 * Atlas frames as a strip PNG (cell px, nearest), shaded like the runtime: ramp books through their ramp, others as
 * stored rgb (premultiplied / additive emission over black; alpha books over grey), with an optional gain.
 */
async function atlasStrip(id, tier, frames, file, { cell = 192, gain = 1 } = {}) {
  const e = MANIFEST_JSON.assets[id];
  const img = await rgba(path.join(PUB, e.maps.color[tier].url));
  const fw = img.width / e.cols;
  const out = Buffer.alloc(cell * frames.length * cell * 3);
  const W = cell * frames.length;
  frames.forEach((k, i) => {
    for (let y = 0; y < cell; y++)
      for (let x = 0; x < cell; x++) {
        const u = (x + 0.5) / cell;
        const v = (y + 0.5) / cell;
        const px = Math.min(fw - 1, Math.floor(u * fw)) + (k % e.cols) * fw;
        const py = Math.min(fw - 1, Math.floor(v * fw)) + Math.floor(k / e.cols) * fw;
        const j = (py * img.width + px) * 4;
        let rgb;
        if (e.ramp) rgb = rampAt(e.ramp, img.data[j] / 255).map((c) => encodeSrgb(Math.min(1, c * gain)));
        else if (e.blend === 'alpha') {
          const a = img.data[j + 3] / 255;
          rgb = [0, 1, 2].map((c) => (img.data[j + c] / 255) * a + 0.3 * (1 - a));
        } else rgb = [0, 1, 2].map((c) => Math.min(1, (img.data[j + c] / 255) * gain));
        const o = (y * W + i * cell + x) * 3;
        for (let c = 0; c < 3; c++) out[o + c] = Math.round(Math.min(1, Math.max(0, rgb[c] + 0.04)) * 255);
      }
  });
  await sharp(out, { raw: { width: W, height: cell, channels: 3 } }).png().toFile(file);
}

/** Quantile of a numeric array (sorted copy). */
function quantile(arr, q) {
  if (!arr.length) return NaN;
  const s = Float64Array.from(arr).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
}

/**
 * Lit-effect statistics of a viewer shot over the effect's own pixels: every screen pixel inside a quad rect whose
 * atlas alpha (frames k0 / k1 mixed by a, same uv as the quad) is >= minAlpha. V = HSV value (max channel / 255).
 */
async function litStats(file, rects, framesPerQuad, atlas, cols, rows, minAlpha = 0.5) {
  const shot = await rgba(file);
  const V = [];
  for (let qi = 0; qi < rects.length; qi++) {
    const r = rects[qi];
    const { k0, k1, a } = framesPerQuad[qi];
    for (let y = Math.max(0, r.y); y < Math.min(shot.height, r.y + r.h); y++)
      for (let x = Math.max(0, r.x); x < Math.min(shot.width, r.x + r.w); x++) {
        const u = (x + 0.5 - r.x) / r.w;
        const v = (y + 0.5 - r.y) / r.h;
        const al = atlasSample(atlas, cols, rows, k0, u, v, 3) * (1 - a) + atlasSample(atlas, cols, rows, k1, u, v, 3) * a;
        if (al < minAlpha) continue;
        const i = (y * shot.width + x) * 4;
        V.push(Math.max(shot.data[i], shot.data[i + 1], shot.data[i + 2]) / 255);
      }
  }
  const med = quantile(V, 0.5);
  return {
    pixels: V.length,
    minValue: V.length ? Math.min(...V) : NaN,
    p2Value: quantile(V, 0.02),
    medianValue: med,
    p2OverMedian: quantile(V, 0.02) / med,
    shadowOverLit: quantile(V, 0.05) / quantile(V, 0.95),
    p10OverP90: quantile(V, 0.1) / quantile(V, 0.9),
  };
}

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

/** Ids of a kind from the generated manifest (text scan; no TS loader needed). */
function idsOfKind(kind) {
  const out = [];
  const re = /"kind": "(\w+)",\s*"id": "(\w+)"/g;
  let m;
  while ((m = re.exec(MANIFEST))) if (m[1] === kind) out.push(m[2]);
  return out;
}

async function lumStats(file, rect) {
  const img = sharp(file);
  const meta = await img.metadata();
  const r = rect ? { left: Math.max(0, rect.x), top: Math.max(0, rect.y), width: Math.min(rect.w, meta.width - rect.x), height: Math.min(rect.h, meta.height - rect.y) } : null;
  const { data, info } = await (r ? sharp(file).extract(r) : sharp(file)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  let sum = 0;
  for (let i = 0; i < info.width * info.height; i++) sum += 0.2126 * lin(data[i * 3]) + 0.7152 * lin(data[i * 3 + 1]) + 0.0722 * lin(data[i * 3 + 2]);
  return { mean: sum / (info.width * info.height), data, info };
}

/**
 * Mean luminance of two shots over the SAME object mask: pixels where either shot differs from the empty
 * background shot (union), so both means cover identical pixels.
 */
async function maskedLumAB(fileA, fileB, bgFile, rect) {
  const a = await lumStats(fileA, rect);
  const b = await lumStats(fileB, rect);
  const g = await lumStats(bgFile, rect);
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = (d, i) => 0.2126 * lin(d[i * 3]) + 0.7152 * lin(d[i * 3 + 1]) + 0.0722 * lin(d[i * 3 + 2]);
  const differs = (d, i) => Math.abs(d[i * 3] - g.data[i * 3]) + Math.abs(d[i * 3 + 1] - g.data[i * 3 + 1]) + Math.abs(d[i * 3 + 2] - g.data[i * 3 + 2]) >= 12;
  let sa = 0;
  let sb = 0;
  let n = 0;
  for (let i = 0; i < a.info.width * a.info.height; i++) {
    if (!differs(a.data, i) && !differs(b.data, i)) continue;
    sa += lum(a.data, i);
    sb += lum(b.data, i);
    n++;
  }
  return { meanA: n ? sa / n : 0, meanB: n ? sb / n : 0, pixels: n };
}

async function main() {
  const { chromium } = requirePlaywright();
  fs.mkdirSync(OUT, { recursive: true });
  if (!fs.existsSync(path.join(ROOT, DIST, 'index.html'))) throw new Error(`${DIST} not built: npx vite build --outDir ${DIST} --emptyOutDir`);
  const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const server = spawn(process.execPath, [viteBin, 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = `http://127.0.0.1:${PORT}/`;
  const report = { shots: [], numbers: {} };
  const failures = [];
  let browser;
  const run = (group) => !ONLY || ONLY.has(group);

  /**
   * Why a capture is blank, or null. Two signatures: a flat frame (stdev < 1.5), and an empty canvas behind the
   * HUD - the central region shows only the page background #0d0b18 (the canvas was resized / not presented when
   * the screenshot ran; the HUD text keeps the whole-frame stdev high, so the stdev test alone misses it).
   */
  async function blankReason(file) {
    const st = await sharp(file).stats();
    const spread = Math.max(...st.channels.slice(0, 3).map((c) => c.stdev));
    if (spread < 1.5) return `stdev ${spread.toFixed(2)}`;
    const meta = await sharp(file).metadata();
    const rect = { left: Math.round(meta.width * 0.25), top: Math.round(meta.height * 0.1), width: Math.round(meta.width * 0.5), height: Math.round(meta.height * 0.5) };
    const { data, info } = await sharp(file).extract(rect).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let bg = 0;
    for (let i = 0; i < info.width * info.height; i++) {
      const r = data[i * 3];
      const g = data[i * 3 + 1];
      const b = data[i * 3 + 2];
      if (Math.abs(r - 13) <= 3 && Math.abs(g - 11) <= 3 && Math.abs(b - 24) <= 3) bg++;
    }
    const share = bg / (info.width * info.height);
    return share > 0.9 ? `canvas empty (${(share * 100).toFixed(0)} % page background)` : null;
  }

  /** Retry (twice) when a capture comes back blank (SwiftShader loses the context / a resize lands under load). */
  async function shoot(name, query, opts = {}) {
    let state = await shootOnce(name, query, opts);
    const file = path.join(OUT, `${name}.png`);
    if (opts.allowBlank) return state;
    for (let attempt = 0; attempt < 2 && fs.existsSync(file); attempt++) {
      const why = await blankReason(file);
      if (!why) break;
      console.log(`[ta-07] ${name}: blank capture (${why}), retrying`);
      report.shots.pop(); // console errors of the blank attempt stay in `failures`: a retry never hides an error
      state = await shootOnce(name, query, opts);
    }
    return state;
  }

  async function shootOnce(name, query, opts = {}) {
    const vp = opts.viewport || [1280, 720];
    const context = await browser.newContext({ viewport: { width: vp[0], height: vp[1] }, deviceScaleFactor: 1, isMobile: !!opts.mobile, hasTouch: !!opts.mobile });
    const page = await context.newPage();
    const errors = [];
    const warnings = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
      if (m.type() === 'warning') warnings.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`));
    const url = `${base}?scene=assetviewer&quality=${opts.quality || 'high'}&noaudio=1&${query}`;
    const t0 = Date.now();
    let state = null;
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 240000 });
      await page.waitForFunction(() => window.__SAMRAJYA__ && window.__SAMRAJYA__.ready && window.__SAMRAJYA__.sceneReady, null, { timeout: 240000, polling: 250 });
      await page.evaluate((n) => window.__SAMRAJYA__.waitFrames(n), opts.frames || 4);
      // evidence hygiene: the boot-splash title fades out over 0.6 s and is then removed - never shoot through it
      await page.waitForFunction(() => !document.getElementById('boot-splash'), null, { timeout: 30000, polling: 100 }).catch(() => undefined);
      if (opts.until) await page.waitForFunction(opts.until, null, { timeout: 240000, polling: 500 });
      state = await page.evaluate(() => window.__SAMRAJYA__.getState().sceneState);
      if (opts.memory) state.memory = await page.evaluate(() => window.__SAMRAJYA__.getProfile());
      await page.evaluate(() => window.__SAMRAJYA__.freeze(true));
      for (const c of await page.evaluate(() => window.__SAMRAJYA__.getErrors().map((r) => r.message))) errors.push(`crash: ${c}`);
      await page.screenshot({ path: path.join(OUT, `${name}.png`), timeout: 240000 });
    } catch (err) {
      errors.push(`shots: ${err && err.message ? err.message : String(err)}`);
    }
    await context.close();
    const ms = Date.now() - t0;
    report.shots.push({ name, url, ms, errors, warnings: warnings.slice(0, 8) });
    console.log(`[ta-07] ${errors.length ? 'FAIL' : 'ok  '} ${name.padEnd(28)} ${String(ms).padStart(6)} ms`);
    for (const e of errors) console.log(`         ${e}`);
    if (errors.length) failures.push(name);
    return state;
  }

  try {
    await waitForServer(base, 30000);
    browser = await chromium.launch({
      headless: true,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
    });

    // ---------------------------------------------------------------- VAT crowd
    if (run('crowd')) {
      const s = await shoot('vat_crowd', 'asset=vat_test_dummy&count=500&hdri=sky_golden&camera=overview&t=1.37&noui=1', { quality: 'high' });
      const s2 = await shoot('vat_crowd_hud', 'asset=vat_test_dummy&count=500&hdri=sky_golden&camera=overview&t=1.37', { quality: 'high' });
      await shoot('vat_crowd_walk', 'asset=vat_test_dummy&clip=walk&count=500&hdri=sky_day&camera=overview&t=0.61&noui=1', { quality: 'high' });
      await shoot('vat_crowd_close', 'asset=vat_test_dummy&count=60&hdri=sky_golden&camera=hero&t=2.1&noui=1', { quality: 'ultra' });
      const crowd = (s2 || s)?.crowd ?? null;
      report.numbers.crowd = crowd;
      if (crowd)
        for (const l of crowd.lods)
          console.log(
            `[ta-07] crowd LOD${l.lod}: ${l.instances} instances in ONE InstancedMesh -> 1 draw per pass: color ${l.main}, ` +
              `GTAO normal pre-pass ${l.prepass} (posed: prepass 'replace' - VAT pose, not the rest pose), shadow ${l.shadow} ` +
              `(three re-renders the shadow map in each of the ${l.scenePasses} renderer.render calls: main + GTAO pre-pass)`,
          );
    }

    // ---------------------------------------------------------------- impostor A/B
    if (run('impostor')) {
      await shoot('impostor_ab_60m', 'asset=impostor_test_tree&mode=ab&dist=60&hdri=sky_day', { quality: 'high' });
      const m = await shoot('impostor_mesh_220m', 'asset=impostor_test_tree&mode=mesh&dist=220&hdri=sky_day&noui=1', { quality: 'high' });
      await shoot('impostor_imp_220m', 'asset=impostor_test_tree&mode=impostor&dist=220&hdri=sky_day&noui=1', { quality: 'high' });
      await shoot('impostor_none_220m', 'asset=impostor_test_tree&mode=none&dist=220&hdri=sky_day&noui=1', { quality: 'high' });
      const rect = m?.impostor?.rect ?? null;
      if (rect) {
        const a = await lumStats(path.join(OUT, 'impostor_mesh_220m.png'), rect);
        const b = await lumStats(path.join(OUT, 'impostor_imp_220m.png'), rect);
        const m = await maskedLumAB(path.join(OUT, 'impostor_mesh_220m.png'), path.join(OUT, 'impostor_imp_220m.png'), path.join(OUT, 'impostor_none_220m.png'), rect);
        const crop = Math.abs(a.mean - b.mean) / a.mean;
        const obj = Math.abs(m.meanA - m.meanB) / Math.max(m.meanA, 1e-9);
        await sharp(path.join(OUT, 'impostor_mesh_220m.png')).extract({ left: rect.x, top: rect.y, width: rect.w, height: rect.h }).resize(rect.w * 4, rect.h * 4, { kernel: 'nearest' }).toFile(path.join(OUT, 'impostor_mesh_220m_crop.png'));
        await sharp(path.join(OUT, 'impostor_imp_220m.png')).extract({ left: rect.x, top: rect.y, width: rect.w, height: rect.h }).resize(rect.w * 4, rect.h * 4, { kernel: 'nearest' }).toFile(path.join(OUT, 'impostor_imp_220m_crop.png'));
        report.numbers.impostor = { rect, cropMeshLum: a.mean, cropImpostorLum: b.mean, cropDiff: crop, objectMeshLum: m.meanA, objectImpostorLum: m.meanB, objectPixels: m.pixels, objectDiff: obj };
        console.log(`[ta-07] impostor A/B at 220 m: crop ${rect.w}x${rect.h} px, mean luminance mesh ${a.mean.toFixed(4)} vs impostor ${b.mean.toFixed(4)} -> ${(crop * 100).toFixed(2)} %; tree pixels only (shared mask, ${m.pixels} px): ${m.meanA.toFixed(4)} vs ${m.meanB.toFixed(4)} -> ${(obj * 100).toFixed(2)} %`);
      }
    }

    // ---------------------------------------------------------------- skies on the stupa
    if (run('skies')) {
      const table = [];
      for (const sky of ['sky_dawn', 'sky_noon', 'sky_golden', 'sky_dusk', 'sky_night', 'sky_overcast', 'sky_haze', 'sky_fog', 'sky_day']) {
        if (!idsOfKind('hdri').includes(sky)) continue;
        const s = await shoot(`sky_${sky.slice(4)}_stupa`, `asset=stupa_sanchi&hdri=${sky}&camera=hero&noui=1`, { quality: 'ultra' });
        if (s && s.sun) table.push({ sky, preset: s.preset, elevationDeg: s.sun.elevationDeg, azimuthDeg: s.sun.azimuthDeg, direction: s.sun.direction, sunIntensity: s.sun.intensity, ambientIrradiance: s.ambientIrradiance, environmentIntensity: s.environmentIntensity });
      }
      report.numbers.skies = table;
      for (const r of table) console.log(`[ta-07] ${r.sky.padEnd(13)} sun el ${String(r.elevationDeg).padStart(4)} az ${String(r.azimuthDeg).padStart(4)} dir [${r.direction.map((v) => v.toFixed(3)).join(', ')}] I ${r.sunIntensity}  ambient ${r.ambientIrradiance}  env x${(r.environmentIntensity ?? 0).toFixed(3)} (${r.preset})`);
      if (process.env.SHOTS_PROBES) for (const sky of idsOfKind('hdri')) await shoot(`sky_${sky.slice(4)}_probes`, `asset=${sky}&noui=1`, { quality: 'high' });
    }

    // ---------------------------------------------------------------- flipbooks
    if (run('fx')) {
      for (const fx of idsOfKind('flipbook')) await shoot(`${fx}_playback`, `asset=${fx}&hdri=sky_day&camera=front&phase=0.35`, { quality: 'ultra' });
      // emissive books: how much of the effect clips to near-white at runtime emissiveIntensity (Art Director:
      // fire <= ~15 % of the flame area, sparks <= 10-15 % core). Effect pixels = differ from the backdrop-only shot.
      const clipRows = [];
      for (const [fx, sky, phase] of [['fx_fire', 'sky_day', 0.35], ['fx_fire', 'sky_night', 0.35], ['fx_sparks_embers', 'sky_day', 0.3]]) {
        if (!idsOfKind('flipbook').includes(fx)) continue;
        const q = `asset=${fx}&hdri=${sky}&camera=front&phase=${phase}&noui=1`;
        const tag = `${fx}_${sky.slice(4)}`;
        await shoot(`${tag}_fxclip`, q, { quality: 'ultra' });
        await shoot(`${tag}_fxclip_bg`, `${q}&hidefx=1`, { quality: 'ultra' });
        const A = await sharp(path.join(OUT, `${tag}_fxclip.png`)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const B = await sharp(path.join(OUT, `${tag}_fxclip_bg.png`)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        let fxPx = 0;
        let white = 0;
        let pale = 0;
        for (let i = 0; i < A.data.length; i += 3) {
          const d = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]);
          if (d < 24) continue;
          fxPx++;
          const lo = Math.min(A.data[i], A.data[i + 1], A.data[i + 2]);
          if (lo >= 245) white++;
          // pale core: #fff2c0-like or whiter (every channel >= 191, brightest >= 230)
          if (lo >= 191 && Math.max(A.data[i], A.data[i + 1], A.data[i + 2]) >= 230) pale++;
        }
        const pct = (n) => (fxPx ? n / fxPx : 0);
        clipRows.push({ fx, sky, effectPixels: fxPx, nearWhite: white, fraction: pct(white), paleCore: pale, paleFraction: pct(pale) });
        console.log(`[ta-07] ${fx} under ${sky}: ${fxPx} effect pixels, ${(100 * pct(white)).toFixed(1)} % near-white (min channel >= 245), ${(100 * pct(pale)).toFixed(1)} % pale core (all channels >= 191)`);
        fs.rmSync(path.join(OUT, `${tag}_fxclip_bg.png`), { force: true });
      }
      report.numbers.emissiveClip = clipRows;
      if (idsOfKind('flipbook').includes('fx_smoke')) {
        await shoot('fx_smoke_sun_east', 'asset=fx_smoke&hdri=sky_day&camera=front&sun=90,25&frame=20&tint=none&noui=1', { quality: 'ultra' });
        await shoot('fx_smoke_sun_west', 'asset=fx_smoke&hdri=sky_day&camera=front&sun=270,25&frame=20&tint=none&noui=1', { quality: 'ultra' });
        const a = await sharp(path.join(OUT, 'fx_smoke_sun_east.png')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const b = await sharp(path.join(OUT, 'fx_smoke_sun_west.png')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        let diff = 0;
        let n = 0;
        for (let i = 0; i < a.data.length; i += 3) {
          const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
          if (d > 6) n++;
          diff += d;
        }
        report.numbers.smokeLighting = { meanAbsDiff: diff / (a.data.length), changedPixels: n };
        console.log(`[ta-07] fx_smoke lit from east vs west: mean |diff| ${(diff / a.data.length).toFixed(2)} / 255, ${n} pixels changed > 6`);
      }
    }

    // ---------------------------------------------------------------- flipbook quads vs the GTAO pre-pass (ultra)
    // Three shots per effect at quality=ultra (GTAO on): quads tagged 'skip' (default), quads hidden (backdrop
    // reference) and untagged quads (?prepass=off, the pre-rework behaviour). In the outer corners of every quad
    // (no effect content there - the border guard keeps frames empty at their edges) the tagged shot must match
    // the backdrop within 1/255; the untagged one shows the card.
    if (run('gtao')) {
      const rows = [];
      for (const fx of ['fx_rain', 'fx_nature', 'fx_dust', 'fx_smoke', 'fx_mist'].filter((f) => idsOfKind('flipbook').includes(f))) {
        const q = `asset=${fx}&hdri=sky_golden&camera=front&phase=0.35&noui=1`;
        const st = await shoot(`gtao_${fx}_tagged`, q, { quality: 'ultra' });
        await shoot(`gtao_${fx}_backdrop`, `${q}&hidefx=1`, { quality: 'ultra' });
        await shoot(`gtao_${fx}_untagged`, `${q}&prepass=off`, { quality: 'ultra' });
        const quads = st?.fxQuads ?? [];
        const img = async (n) => sharp(path.join(OUT, `${n}.png`)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const [A, B, C] = await Promise.all([img(`gtao_${fx}_tagged`), img(`gtao_${fx}_backdrop`), img(`gtao_${fx}_untagged`)]);
        const W = A.info.width;
        const H = A.info.height;
        let worstTagged = 0;
        let worstUntagged = 0;
        for (const r of quads) {
          const c = Math.max(3, Math.round(Math.min(r.w, r.h) * 0.05));
          for (const [cx, cy] of [[r.x + 2, r.y + 2], [r.x + r.w - 2 - c, r.y + 2], [r.x + 2, r.y + r.h - 2 - c], [r.x + r.w - 2 - c, r.y + r.h - 2 - c]]) {
            let da = 0;
            let dc = 0;
            let n = 0;
            for (let y = cy; y < cy + c; y++)
              for (let x = cx; x < cx + c; x++) {
                if (x < 0 || y < 0 || x >= W || y >= H) continue;
                const i = (y * W + x) * 3;
                for (let k = 0; k < 3; k++) {
                  da += Math.abs(A.data[i + k] - B.data[i + k]);
                  dc += Math.abs(C.data[i + k] - B.data[i + k]);
                }
                n += 3;
              }
            if (n) {
              worstTagged = Math.max(worstTagged, da / n);
              worstUntagged = Math.max(worstUntagged, dc / n);
            }
          }
        }
        rows.push({ fx, quads: quads.length, worstCornerDiffTagged: worstTagged, worstCornerDiffUntagged: worstUntagged });
        console.log(`[ta-07] GTAO card check ${fx.padEnd(14)} ${quads.length} quads: empty-corner |diff| vs backdrop tagged ${worstTagged.toFixed(2)}/255 (target <= 1), untagged ${worstUntagged.toFixed(2)}/255`);
      }
      report.numbers.gtaoCards = rows;
    }

    // ---------------------------------------------------------------- round 2 (Art Director R2-B1 .. R2-B4)
    if (run('r2')) {
      const r2 = {};
      // R2-B1: lit smoke (frame 30, building-smoke tint) and dust (phase 0.35, ground tint) under golden and noon, on
      // ultra and on mobile (quality low, 390 x 844), plus smoke on mobile overcast. Effect pixels: atlas alpha >= 0.5.
      const litRows = [];
      const cases = [];
      for (const sky of ['sky_golden', 'sky_noon']) for (const tier of ['ultra', 'mobile']) cases.push(['fx_smoke', sky, tier], ['fx_dust', sky, tier]);
      cases.push(['fx_smoke', 'sky_overcast', 'mobile']);
      for (const [fx, sky, tier] of cases) {
        const e = MANIFEST_JSON.assets[fx];
        const q = fx === 'fx_smoke' ? `asset=${fx}&hdri=${sky}&camera=front&frame=30&noui=1` : `asset=${fx}&hdri=${sky}&camera=front&phase=0.35&noui=1`;
        const name = `r2_${fx.slice(3)}_${sky.slice(4)}_${tier}`;
        const opts = tier === 'mobile' ? { quality: 'low', viewport: [390, 844], mobile: true } : { quality: 'ultra' };
        const st = await shoot(name, q, opts);
        const rects = st?.fxQuads ?? [];
        if (!rects.length) continue;
        const atlas = await rgba(path.join(PUB, e.maps.color[tier].url));
        const frames = e.sequences.map((sq) => {
          if (fx === 'fx_smoke') return { k0: sq.start + 30, k1: sq.start + 30, a: 0 };
          const f = 0.35 * (sq.count - 1);
          return { k0: sq.start + Math.floor(f), k1: sq.start + Math.min(sq.count - 1, Math.floor(f) + 1), a: f - Math.floor(f) };
        });
        const stats = await litStats(path.join(OUT, `${name}.png`), rects, frames, atlas, e.cols, e.rows);
        litRows.push({ fx, sky, tier, ...stats });
        console.log(
          `[ta-07] R2-B1 ${fx.padEnd(9)} ${sky.padEnd(12)} ${tier.padEnd(6)} ${stats.pixels} px: min V ${(stats.minValue * 100).toFixed(1)} % (>= 8), ` +
            `p2 / median ${stats.p2OverMedian.toFixed(2)} (>= 0.30), shadow / lit p5 / p95 ${stats.shadowOverLit.toFixed(2)} (0.35-0.6), p10 / p90 ${stats.p10OverP90.toFixed(2)}`,
        );
        // 2x crop of the effect (crease check)
        if (tier === 'ultra' && rects[0]) {
          const r = rects[0];
          const meta = await sharp(path.join(OUT, `${name}.png`)).metadata();
          const left = Math.max(0, r.x + Math.round(r.w * 0.12));
          const top = Math.max(0, r.y + Math.round(r.h * 0.12));
          const w = Math.min(meta.width - left, Math.round(r.w * 0.76));
          const h = Math.min(meta.height - top, Math.round(r.h * 0.76));
          await sharp(path.join(OUT, `${name}.png`)).extract({ left, top, width: w, height: h }).resize(w * 2, h * 2, { kernel: 'nearest' }).toFile(path.join(OUT, `${name}_2x.png`));
        }
      }
      r2.lit = litRows;
      // the sun east / west test inside the smoke (frame 20, untinted, alpha >= 0.1)
      {
        const st = await shoot('fx_smoke_sun_east', 'asset=fx_smoke&hdri=sky_day&camera=front&sun=90,25&frame=20&tint=none&noui=1', { quality: 'ultra' });
        await shoot('fx_smoke_sun_west', 'asset=fx_smoke&hdri=sky_day&camera=front&sun=270,25&frame=20&tint=none&noui=1', { quality: 'ultra' });
        const e = MANIFEST_JSON.assets.fx_smoke;
        const atlas = await rgba(path.join(PUB, e.maps.color.ultra.url));
        const A = await rgba(path.join(OUT, 'fx_smoke_sun_east.png'));
        const B = await rgba(path.join(OUT, 'fx_smoke_sun_west.png'));
        const r = st?.fxQuads?.[0];
        let sum = 0;
        let n = 0;
        if (r)
          for (let y = Math.max(0, r.y); y < Math.min(A.height, r.y + r.h); y++)
            for (let x = Math.max(0, r.x); x < Math.min(A.width, r.x + r.w); x++) {
              if (atlasSample(atlas, e.cols, e.rows, 20, (x + 0.5 - r.x) / r.w, (y + 0.5 - r.y) / r.h, 3) < 0.1) continue;
              const i = (y * A.width + x) * 4;
              sum += (Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2])) / 3;
              n++;
            }
        r2.smokeEastWest = { pixels: n, meanAbsDiff: n ? sum / n : 0 };
        console.log(`[ta-07] R2-B1 fx_smoke sun east vs west inside the smoke (alpha >= 0.1, ${n} px): mean |diff| ${(n ? sum / n : 0).toFixed(2)} / 255 (>= 8)`);
      }

      // R2-B2b: fire at night - emission added to the sky (shot - backdrop) never leans green / blue; 4x-boosted crops
      const chroma = [];
      for (const tier of ['ultra', 'mobile']) {
        const opts = tier === 'mobile' ? { quality: 'low', viewport: [390, 844], mobile: true } : { quality: 'ultra' };
        const q = 'asset=fx_fire&hdri=sky_night&camera=front&phase=0.35&noui=1';
        const name = `r2_fire_night_${tier}`;
        const st = await shoot(name, q, opts);
        await shoot(`${name}_bg`, `${q}&hidefx=1`, opts);
        const A = await rgba(path.join(OUT, `${name}.png`));
        const B = await rgba(path.join(OUT, `${name}_bg.png`));
        let px = 0;
        let bad = 0;
        for (let i = 0; i < A.data.length; i += 4) {
          const d = [0, 1, 2].map((c) => A.data[i + c] - B.data[i + c]);
          if (d[0] + d[1] + d[2] < 12) continue;
          px++;
          if (d[1] > d[0] + 2 || d[2] > d[1] + 2) bad++;
        }
        chroma.push({ tier, emittingPixels: px, greenOrBlueLeaning: bad });
        console.log(`[ta-07] R2-B2b fx_fire night ${tier}: ${px} pixels with added emission, ${bad} lean green / blue (dG > dR or dB > dG by > 2)`);
        const r = st?.fxQuads?.[0];
        if (r) {
          // the flame tips and the air around them (where lossy chroma blocks showed), 4x nearest, brightness x4
          const left = Math.max(0, r.x + Math.round(r.w * 0.25));
          const top = Math.max(0, r.y + Math.round(r.h * 0.12));
          const w = Math.min(A.width - left, Math.round(r.w * 0.5));
          const h = Math.min(A.height - top, Math.round(r.h * 0.55));
          const crop = await sharp(path.join(OUT, `${name}.png`)).extract({ left, top, width: w, height: h }).removeAlpha().raw().toBuffer();
          for (let i = 0; i < crop.length; i++) crop[i] = Math.min(255, crop[i] * 4);
          await sharp(crop, { raw: { width: w, height: h, channels: 3 } }).resize(w * 4, h * 4, { kernel: 'nearest' }).png().toFile(path.join(OUT, `${name}_x4.png`));
        }
        fs.rmSync(path.join(OUT, `${name}_bg.png`), { force: true });
      }
      r2.fireChroma = chroma;

      // R2-B2a: fire frames 14-48 (as the Art Director's rim strip) from the shipped ultra atlas, ramp-shaded
      await atlasStrip('fx_fire', 'ultra', [14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 36, 48], path.join(OUT, 'r2_fire_frames_14-48.png'), { cell: 160 });
      await atlasStrip('fx_fire', 'ultra', [0, 1, 2, 3, 4, 60, 61, 62, 63], path.join(OUT, 'r2_fire_frames_loopseam.png'), { cell: 160 });

      // R2-B3: weapon trail at ultra - 4x crop of the dim tail of `trail` and `trail_wide`
      const ts = await shoot('r2_weapon_trail_ultra', 'asset=fx_weapon_trail&hdri=sky_day&camera=front&phase=0.35&noui=1', { quality: 'ultra' });
      const tq = ts?.fxQuads ?? [];
      const te = MANIFEST_JSON.assets.fx_weapon_trail;
      const runs = [];
      for (const name of ['trail', 'trail_wide']) {
        const si = te.sequences.findIndex((x) => x.name === name);
        const r = tq[si];
        if (!r) continue;
        const left = Math.max(0, r.x + Math.round(r.w * 0.35));
        const top = Math.max(0, r.y + Math.round(r.h * 0.15));
        const w = Math.round(r.w * 0.55);
        const h = Math.round(r.h * 0.7);
        const crop = await sharp(path.join(OUT, 'r2_weapon_trail_ultra.png')).extract({ left, top, width: w, height: h }).removeAlpha().raw().toBuffer();
        await sharp(crop, { raw: { width: w, height: h, channels: 3 } }).resize(w * 4, h * 4, { kernel: 'nearest' }).png().toFile(path.join(OUT, `r2_weapon_${name}_tail_x4.png`));
        // flat runs of identical displayed colour along the trail (contour bands = long runs then a step)
        let total = 0;
        let count = 0;
        let longest = 0;
        for (let y = Math.round(h * 0.3); y < Math.round(h * 0.7); y++) {
          let run = 1;
          for (let x = 1; x < w; x++) {
            const i = (y * w + x) * 3;
            const same = crop[i] === crop[i - 3] && crop[i + 1] === crop[i - 2] && crop[i + 2] === crop[i - 1];
            if (same) run++;
            else {
              total += run;
              count++;
              longest = Math.max(longest, run);
              run = 1;
            }
          }
        }
        runs.push({ sequence: name, meanFlatRun: total / Math.max(count, 1), longestFlatRun: longest });
        console.log(`[ta-07] R2-B3 fx_weapon_trail ${name} tail (screen, ultra): mean flat run ${(total / Math.max(count, 1)).toFixed(2)} px, longest ${longest} px`);
      }
      r2.trailRuns = runs;
      await atlasStrip('fx_weapon_trail', 'ultra', [1, 3], path.join(OUT, 'r2_weapon_trail_frames.png'), { cell: 256, gain: 3 });

      // R2-B4: parry_flash frames (atlas 11-18) and the finisher (19-29) from the shipped atlas, x6 like the runtime
      await atlasStrip('fx_sparks_embers', 'ultra', [11, 12, 13, 14, 15, 16, 17, 18], path.join(OUT, 'r2_parry_flash_frames.png'), { cell: 160, gain: 1 });
      await atlasStrip('fx_sparks_embers', 'ultra', [19, 21, 23, 25, 27, 29], path.join(OUT, 'r2_finisher_frames.png'), { cell: 160, gain: 1 });
      await shoot('r2_sparks_parry_night', 'asset=fx_sparks_embers&hdri=sky_night&camera=front&phase=0.3&noui=1', { quality: 'ultra' });
      report.numbers.r2 = r2;
    }

    // ---------------------------------------------------------------- LUT A/B
    if (run('lut')) for (const lut of idsOfKind('lut')) await shoot(`${lut}_split`, `asset=${lut}&hdri=sky_golden&split=0.5&camera=hero&noui=1`, { quality: 'ultra' });

    // ---------------------------------------------------------------- skinned clones + memory
    if (run('skinned')) {
      await shoot('skinned_clones', 'asset=skin_test_character&clip=walk&hdri=sky_golden&camera=front&t=0.4', { quality: 'ultra' });
      const s = await shoot('skinned_memtest', 'asset=skin_test_character&clip=walk&hdri=sky_day&memtest=1&noui=1', { quality: 'high', frames: 4, until: () => { const s = window.__SAMRAJYA__.getState().sceneState; return !!(s && s.skinned && s.skinned.memtest && s.skinned.memtest.released); } });
      const mt = s?.skinned?.memtest ?? null;
      report.numbers.skinnedMemory = mt;
      if (mt) console.log(`[ta-07] skinned memory (renderer.info.memory): baseline ${JSON.stringify(mt.baseline)} -> loaded ${JSON.stringify(mt.loaded)} -> released ${JSON.stringify(mt.released)} ${mt.released && mt.released.geometries === mt.baseline.geometries && mt.released.textures === mt.baseline.textures ? 'OK (back to baseline)' : 'LEAK'}`);
    }

    // ---------------------------------------------------------------- banners (6 BannerShape variants, runtime bannerSvg textures)
    if (run('banners') && idsOfKind('model').includes('banner_cloth')) {
      const s = await shoot('banner_cloth_variants', 'asset=banner_cloth&hdri=sky_golden&camera=front&noui=1', { quality: 'ultra' });
      report.numbers.banners = s ? { notes: s.notes, fallback: s.fallback } : null;
    }

    // ---------------------------------------------------------------- kit + splat
    if (run('kit')) {
      const s = await shoot('kit_grid', 'kit=stupa_sanchi,model_test_tree,skin_test_character&count=4&hdri=sky_day&camera=overview', { quality: 'high' });
      // skinned kit pieces are human-sized next to 40 m stupas: a close kit shot shows the independent clones too
      const s2 = await shoot('kit_grid_skinned', 'kit=skin_test_character&count=4&hdri=sky_day&camera=overview', { quality: 'high' });
      report.numbers.kit = [...(s?.kit ?? []), ...((s2?.kit ?? []).map((k) => ({ ...k, id: `${k.id} (alone)` })))];
      if (s?.kit) console.log(`[ta-07] kit draw calls: ${s.kit.map((k) => `${k.id} ${k.meshes}`).join(', ')}`);
    }
    // TA-01 lookdev under the neutral noon sky with an 18 % grey card (Art Director: golden was too dark to judge albedo)
    if (run('splat')) await shoot('splat_lookdev', 'splat=ground_dry_earth,sandstone_carved_red&hdri=sky_noon&camera=hero', { quality: 'high' });

    // ---------------------------------------------------------------- images
    if (run('images')) for (const img of idsOfKind('image')) await shoot(`${img}_view`, `asset=${img}&hdri=sky_day&camera=front&noui=1`, { quality: 'ultra' });

    // ---------------------------------------------------------------- assets=off: every new loader returns null, no errors
    if (run('off')) {
      const off = {};
      for (const [kind, id] of [['vat', 'vat_test_dummy'], ['impostor', 'impostor_test_tree'], ['flipbook', idsOfKind('flipbook')[0]], ['lut', 'lut_golden'], ['image', idsOfKind('image')[0]], ['skinned', 'skin_test_character']]) {
        if (!id) continue;
        // SHOTS_SINGLE=1 (with SHOTS_DIST=.build/ta-07-single): the single-file build itself, no ?assets=off needed
        const s = await shoot(`off_${kind}`, `asset=${id}${process.env.SHOTS_SINGLE ? '' : '&assets=off'}`, { quality: 'medium' });
        off[kind] = s ? { fallback: s.fallback, tier: s.tier, notes: s.notes } : null;
      }
      report.numbers.assetsOff = off;
      console.log(`[ta-07] ${process.env.SHOTS_SINGLE ? 'single-file build' : 'assets=off'}: ${Object.entries(off).map(([k, v]) => `${k} fallback=${v && v.fallback}`).join(', ')}`);
    }

    // ---------------------------------------------------------------- mobile
    if (run('mobile')) await shoot('vat_crowd_mobile', 'asset=vat_test_dummy&count=200&camera=overview&t=0.9', { quality: 'low', viewport: [390, 844], mobile: true });
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
  // Merge with the previous report so partial runs (--only=...) keep the other groups' numbers.
  const reportPath = path.join(OUT, 'report.json');
  let merged = report;
  try {
    const prev = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const names = new Set(report.shots.map((s) => s.name));
    merged = { shots: [...(prev.shots ?? []).filter((s) => !names.has(s.name)), ...report.shots], numbers: { ...(prev.numbers ?? {}), ...report.numbers } };
  } catch {
    // first run
  }
  fs.writeFileSync(reportPath, JSON.stringify(merged, null, 2));
  if (failures.length) {
    console.error(`[ta-07] FAILED: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log(`[ta-07] ${report.shots.length} shots -> ${path.relative(ROOT, OUT)}/`);
}

main().catch((err) => {
  console.error('[ta-07] error:', err);
  process.exit(1);
});
