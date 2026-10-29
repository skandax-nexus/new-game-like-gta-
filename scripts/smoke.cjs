#!/usr/bin/env node
/**
 * SAMRAJYA smoke test (owned by the CTO; QA Lead may extend SHOTS).
 *
 *   npm run smoke                      build + preview + screenshots of every scene
 *   npm run smoke -- --scenes=menu,battle --quality=medium
 *
 * Env: SMOKE_PORT (default 4317), SMOKE_SKIP_BUILD=1, SMOKE_OUT (default docs/screenshots),
 *      SMOKE_DIST (build/preview dir, default dist - use .build/<ticket-id> when teammates run concurrently),
 *      (asset-viewer shots need the published content in public/assets - see `npm run assets`)
 *      SMOKE_TIMEOUT_MS (per scene, default 240000), SMOKE_HEADED=1.
 *
 * Steps: vite build -> vite preview on a fixed port -> headless Chromium (SwiftShader WebGL2) ->
 * for each shot: open URL deep link, wait for window.__SAMRAJYA__.sceneReady, optionally advance
 * the sim, save a PNG. Fails (exit 1) on console errors, page errors, crash reports or timeouts.
 * Note: SwiftShader is a software renderer - FPS numbers here are NOT representative.
 */
'use strict';
const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.SMOKE_PORT || 4317);
const OUT = path.resolve(ROOT, process.env.SMOKE_OUT || 'docs/screenshots');
const TIMEOUT = Number(process.env.SMOKE_TIMEOUT_MS || 240000);
const DIST = process.env.SMOKE_DIST || 'dist';
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)=?(.*)$/.exec(a);
    return m ? [m[1], m[2] || '1'] : [a, '1'];
  }),
);
const QUALITY = args.quality || 'high';

function requirePlaywright() {
  try {
    return require('playwright');
  } catch {
    const globalRoot = execSync('npm root -g').toString().trim();
    return require(path.join(globalRoot, 'playwright'));
  }
}

/**
 * Shots. `advance` = sim steps to run (paused, deterministic) before the screenshot.
 * QA Lead: add shots here (keep names stable - docs reference them).
 */
const SHOTS = [
  { name: 'menu', scene: 'menu', query: '', viewport: [1280, 720] },
  { name: 'world', scene: 'world', query: 'seed=7&paused=1', viewport: [1280, 720] },
  { name: 'world-overview', scene: 'world', query: 'seed=7&paused=1&camera=overview', viewport: [1280, 720] },
  { name: 'battle', scene: 'battle', query: 'seed=7&soldiers=1000&preset=plains', viewport: [1280, 720], advance: 500 },
  { name: 'battle-close', scene: 'battle', query: 'seed=7&soldiers=1000&preset=plains&camera=close', viewport: [1280, 720], advance: 700 },
  { name: 'battle-river-5000', scene: 'battle', query: 'seed=11&soldiers=5000&preset=river_crossing&hour=17', viewport: [1280, 720], advance: 300 },
  { name: 'hero', scene: 'hero', query: '', viewport: [1280, 720] },
  { name: 'menu-mobile', scene: 'menu', query: '', viewport: [390, 844], quality: 'low', mobile: true },
  { name: 'battle-mobile', scene: 'battle', query: 'seed=7&soldiers=600&preset=plains', viewport: [844, 390], quality: 'low', mobile: true, advance: 400 },
  // Content pipeline (tools/assets -> public/assets): in-engine lookdev of the reference assets.
  { name: 'assetviewer-stupa', scene: 'assetviewer', query: 'asset=stupa_sanchi&hdri=sky_golden&camera=hero&noui=1', viewport: [1280, 720], quality: 'ultra' },
  { name: 'assetviewer-torana', scene: 'assetviewer', query: 'asset=stupa_sanchi&hdri=sky_golden&camera=close&noui=1', viewport: [1280, 720], quality: 'ultra' },
  { name: 'assetviewer-sandstone', scene: 'assetviewer', query: 'asset=sandstone_carved_red&hdri=sky_day&noui=1', viewport: [1280, 720], quality: 'ultra' },
  { name: 'assetviewer-mobile', scene: 'assetviewer', query: 'asset=stupa_sanchi&hdri=sky_day&camera=overview', viewport: [390, 844], quality: 'low', mobile: true },
  { name: 'assetviewer-fallback', scene: 'assetviewer', query: 'asset=stupa_sanchi&assets=off', viewport: [1280, 720] },
];

function waitForServer(url, ms) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      http
        .get(url, (res) => {
          res.resume();
          if (res.statusCode && res.statusCode < 500) resolve();
          else retry();
        })
        .on('error', retry);
    };
    const retry = () => (Date.now() - t0 > ms ? reject(new Error(`server not up at ${url}`)) : setTimeout(tryOnce, 300));
    tryOnce();
  });
}

async function main() {
  const { chromium } = requirePlaywright();
  fs.mkdirSync(OUT, { recursive: true });
  if (!process.env.SMOKE_SKIP_BUILD) {
    console.log('[smoke] building...');
    execSync(`"${process.execPath}" "${path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')}" build --outDir "${DIST}" --emptyOutDir`, { cwd: ROOT, stdio: 'inherit' });
  }
  console.log(`[smoke] starting preview on :${PORT}`);
  // Spawn vite directly (not through npx) so the server process can be killed reliably.
  const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const server = spawn(process.execPath, [viteBin, 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));
  const base = `http://127.0.0.1:${PORT}/`;
  const failures = [];
  const report = { build: null, quality: QUALITY, shots: [] };
  let browser;
  try {
    await waitForServer(base, 30000);
    browser = await chromium.launch({
      headless: !process.env.SMOKE_HEADED,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
    });
    const only = args.scenes ? new Set(args.scenes.split(',')) : null;
    for (const shot of SHOTS) {
      if (only && !only.has(shot.scene) && !only.has(shot.name)) continue;
      const t0 = Date.now();
      const errors = [];
      const context = await browser.newContext({
        viewport: { width: shot.viewport[0], height: shot.viewport[1] },
        deviceScaleFactor: 1,
        isMobile: !!shot.mobile,
        hasTouch: !!shot.mobile,
      });
      const page = await context.newPage();
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
      });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`));
      const q = shot.quality || QUALITY;
      const url = `${base}?scene=${shot.scene}&quality=${q}&noaudio=1${shot.query ? `&${shot.query}` : ''}`;
      let state = null;
      try {
        await page.goto(url, { waitUntil: 'load', timeout: TIMEOUT });
        await page.waitForFunction(() => window.__SAMRAJYA__ && window.__SAMRAJYA__.ready && window.__SAMRAJYA__.sceneReady, null, { timeout: TIMEOUT, polling: 250 });
        if (shot.advance) {
          await page.evaluate((n) => {
            const api = window.__SAMRAJYA__;
            api.pause();
            api.step(n);
          }, shot.advance);
        }
        await page.evaluate(() => window.__SAMRAJYA__.waitFrames(3));
        state = await page.evaluate(() => window.__SAMRAJYA__.getState());
        // Freeze the loop so the screenshot does not wait for another software-rendered frame.
        await page.evaluate(() => window.__SAMRAJYA__.freeze(true));
        const crash = await page.evaluate(() => window.__SAMRAJYA__.getErrors().map((r) => r.message));
        for (const c of crash) errors.push(`crash: ${c}`);
        await page.screenshot({ path: path.join(OUT, `${shot.name}.png`), timeout: TIMEOUT });
        if (!report.build) report.build = await page.evaluate(() => window.__SAMRAJYA__.version);
      } catch (err) {
        errors.push(`smoke: ${err && err.message ? err.message : String(err)}`);
        try {
          await page.screenshot({ path: path.join(OUT, `${shot.name}-FAILED.png`) });
        } catch {
          /* ignore */
        }
      }
      const ms = Date.now() - t0;
      report.shots.push({ name: shot.name, url, ms, errors, state });
      console.log(`[smoke] ${errors.length ? 'FAIL' : 'ok  '} ${shot.name.padEnd(18)} ${String(ms).padStart(6)} ms  ${state ? `scene=${state.scene} quality=${state.quality}` : ''}`);
      for (const e of errors) console.log(`         ${e}`);
      if (errors.length) failures.push(shot.name);
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
    server.stdout.destroy();
    server.stderr.destroy();
  }
  fs.writeFileSync(path.join(OUT, 'smoke-report.json'), JSON.stringify(report, null, 2));
  if (failures.length) {
    console.error(`[smoke] FAILED: ${failures.join(', ')}`);
    if (/EADDRINUSE|already in use/i.test(serverLog)) console.error(`[smoke] port ${PORT} busy - set SMOKE_PORT`);
    process.exit(1);
  }
  console.log(`[smoke] all ${report.shots.length} shots passed -> ${path.relative(ROOT, OUT)}/`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[smoke] error:', err);
  process.exit(1);
});
