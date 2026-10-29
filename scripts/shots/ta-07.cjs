#!/usr/bin/env node
/**
 * TA-07 evidence capture (pipeline extensions + WP7 content). OWNER: Technical Artist G (TA-07).
 *
 *   npx vite build --outDir .build/ta-07 --emptyOutDir
 *   NODE_PATH=$(npm root -g) node scripts/shots/ta-07.cjs [--only=crowd,impostor,skies,fx,lut,skinned,kit,splat,images,off,mobile]
 *
 * Env: SHOTS_PORT (default 4402), SHOTS_DIST (default .build/ta-07), SHOTS_OUT (default docs/sprint1/ta-07).
 * Starts `vite preview` on the ticket port, opens asset-viewer deep links in headless Chromium (SwiftShader),
 * waits for sceneReady, saves PNGs and prints / writes the measured numbers (docs/sprint1/ta-07/report.json):
 * crowd draw calls per LOD, impostor A/B luminance difference at 220 m, sky sun / irradiance table, smoke
 * shading under two sun directions, skinned clone memory (renderer.info.memory) before / after release, kit
 * draw calls, assets=off null checks. Fails (exit 1) on console errors, page errors or failed requests.
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

/** Mean luminance over pixels where `file` differs from the empty background shot (the object mask). */
async function maskedLum(file, bgFile, rect) {
  const a = await lumStats(file, rect);
  const b = await lumStats(bgFile, rect);
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.info.width * a.info.height; i++) {
    const d = Math.abs(a.data[i * 3] - b.data[i * 3]) + Math.abs(a.data[i * 3 + 1] - b.data[i * 3 + 1]) + Math.abs(a.data[i * 3 + 2] - b.data[i * 3 + 2]);
    if (d < 12) continue;
    sum += 0.2126 * lin(a.data[i * 3]) + 0.7152 * lin(a.data[i * 3 + 1]) + 0.0722 * lin(a.data[i * 3 + 2]);
    n++;
  }
  return { mean: n ? sum / n : 0, pixels: n };
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

  async function shoot(name, query, opts = {}) {
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
      state = await page.evaluate(() => window.__SAMRAJYA__.getState().sceneState);
      if (opts.memory) state.memory = await page.evaluate(() => window.__SAMRAJYA__.getProfile());
      await page.evaluate(() => window.__SAMRAJYA__.freeze(true));
      for (const c of await page.evaluate(() => window.__SAMRAJYA__.getErrors().map((r) => r.message))) errors.push(`crash: ${c}`);
      await page.screenshot({ path: path.join(OUT, `${name}.png`) });
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
      if (crowd) for (const l of crowd.lods) console.log(`[ta-07] crowd LOD${l.lod}: ${l.instances} instances, draw calls per frame ${l.main} main + ${l.shadow} shadow = ${l.main + l.shadow}`);
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
        const ma = await maskedLum(path.join(OUT, 'impostor_mesh_220m.png'), path.join(OUT, 'impostor_none_220m.png'), rect);
        const mb = await maskedLum(path.join(OUT, 'impostor_imp_220m.png'), path.join(OUT, 'impostor_none_220m.png'), rect);
        const crop = Math.abs(a.mean - b.mean) / a.mean;
        const obj = Math.abs(ma.mean - mb.mean) / Math.max(ma.mean, 1e-9);
        await sharp(path.join(OUT, 'impostor_mesh_220m.png')).extract({ left: rect.x, top: rect.y, width: rect.w, height: rect.h }).resize(rect.w * 4, rect.h * 4, { kernel: 'nearest' }).toFile(path.join(OUT, 'impostor_mesh_220m_crop.png'));
        await sharp(path.join(OUT, 'impostor_imp_220m.png')).extract({ left: rect.x, top: rect.y, width: rect.w, height: rect.h }).resize(rect.w * 4, rect.h * 4, { kernel: 'nearest' }).toFile(path.join(OUT, 'impostor_imp_220m_crop.png'));
        report.numbers.impostor = { rect, cropMeshLum: a.mean, cropImpostorLum: b.mean, cropDiff: crop, objectMeshLum: ma.mean, objectImpostorLum: mb.mean, objectPixels: [ma.pixels, mb.pixels], objectDiff: obj };
        console.log(`[ta-07] impostor A/B at 220 m: crop ${rect.w}x${rect.h} px, mean luminance mesh ${a.mean.toFixed(4)} vs impostor ${b.mean.toFixed(4)} -> ${(crop * 100).toFixed(2)} % (object pixels only: ${(obj * 100).toFixed(2)} %, ${ma.pixels}/${mb.pixels} px)`);
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
      for (const sky of idsOfKind('hdri')) await shoot(`sky_${sky.slice(4)}_probes`, `asset=${sky}&noui=1`, { quality: 'high' });
    }

    // ---------------------------------------------------------------- flipbooks
    if (run('fx')) {
      for (const fx of idsOfKind('flipbook')) await shoot(`${fx}_playback`, `asset=${fx}&hdri=sky_day&t=0.55`, { quality: 'ultra' });
      if (idsOfKind('flipbook').includes('fx_smoke')) {
        await shoot('fx_smoke_sun_east', 'asset=fx_smoke&hdri=sky_day&sun=90,25&frame=20&noui=1', { quality: 'ultra' });
        await shoot('fx_smoke_sun_west', 'asset=fx_smoke&hdri=sky_day&sun=270,25&frame=20&noui=1', { quality: 'ultra' });
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

    // ---------------------------------------------------------------- LUT A/B
    if (run('lut')) for (const lut of idsOfKind('lut')) await shoot(`${lut}_split`, `asset=${lut}&hdri=sky_golden&split=0.5&camera=hero&noui=1`, { quality: 'ultra' });

    // ---------------------------------------------------------------- skinned clones + memory
    if (run('skinned')) {
      await shoot('skinned_clones', 'asset=skin_test_character&clip=walk&hdri=sky_golden&camera=hero&t=0.4', { quality: 'ultra' });
      const s = await shoot('skinned_memtest', 'asset=skin_test_character&clip=walk&hdri=sky_day&memtest=1&noui=1', { quality: 'high', frames: 8 });
      const mt = s?.skinned?.memtest ?? null;
      report.numbers.skinnedMemory = mt;
      if (mt) console.log(`[ta-07] skinned memory (renderer.info.memory): baseline ${JSON.stringify(mt.baseline)} -> loaded ${JSON.stringify(mt.loaded)} -> released ${JSON.stringify(mt.released)} ${mt.released && mt.released.geometries === mt.baseline.geometries && mt.released.textures === mt.baseline.textures ? 'OK (back to baseline)' : 'LEAK'}`);
    }

    // ---------------------------------------------------------------- kit + splat
    if (run('kit')) {
      const s = await shoot('kit_grid', 'kit=stupa_sanchi,model_test_tree,skin_test_character&count=4&hdri=sky_day&camera=overview', { quality: 'high' });
      report.numbers.kit = s?.kit ?? null;
      if (s?.kit) console.log(`[ta-07] kit draw calls: ${s.kit.map((k) => `${k.id} ${k.meshes}`).join(', ')}`);
    }
    if (run('splat')) await shoot('splat_lookdev', 'splat=ground_dry_earth,sandstone_carved_red&hdri=sky_golden&camera=hero', { quality: 'high' });

    // ---------------------------------------------------------------- images
    if (run('images')) for (const img of idsOfKind('image')) await shoot(`${img}_view`, `asset=${img}&hdri=sky_day&noui=1`, { quality: 'ultra' });

    // ---------------------------------------------------------------- assets=off: every new loader returns null, no errors
    if (run('off')) {
      const off = {};
      for (const [kind, id] of [['vat', 'vat_test_dummy'], ['impostor', 'impostor_test_tree'], ['flipbook', idsOfKind('flipbook')[0]], ['lut', 'lut_golden'], ['image', idsOfKind('image')[0]], ['skinned', 'skin_test_character']]) {
        if (!id) continue;
        const s = await shoot(`off_${kind}`, `asset=${id}&assets=off`, { quality: 'medium' });
        off[kind] = s ? { fallback: s.fallback, tier: s.tier, notes: s.notes } : null;
      }
      report.numbers.assetsOff = off;
      console.log(`[ta-07] assets=off: ${Object.entries(off).map(([k, v]) => `${k} fallback=${v && v.fallback}`).join(', ')}`);
    }

    // ---------------------------------------------------------------- mobile
    if (run('mobile')) await shoot('vat_crowd_mobile', 'asset=vat_test_dummy&count=200&camera=overview&t=0.9', { quality: 'low', viewport: [390, 844], mobile: true });
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
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
