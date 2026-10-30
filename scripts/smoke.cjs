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
 * for each shot: open URL deep link, wait for window.__SAMRAJYA__.sceneReady and for the boot splash to be
 * removed, optionally advance the sim, let the HUD catch up (SETTLE), save a PNG. Fails (exit 1) on console
 * errors, page errors, crash reports, timeouts or a blank frame (see BLANK below: a black / cleared / unpresented canvas, or a HUD over one,
 * is retaken and then fails even with a clean console).
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
 * Shots. `advance` = sim steps to run (paused, deterministic) before the screenshot. `allowBlank: true` exempts a
 * shot whose 3D view is legitimately empty or flat from the blank-view guard (none today).
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

/**
 * HUD settle. Scenes push HUD props on a timer of frame time, not every frame (BattleScene: every 0.12 s), and a
 * low-tier frame under SwiftShader can take ~5 ms, so 3 frames after `advance` often left the battle HUD showing the
 * pre-advance state ("0:00" with the sim at 20.8 s: 2 of 3 probe loads of battle-mobile; GP-01 round 2 smoke). Before
 * every capture the loop runs at least `frames` frames AND `ms` of wall time (several HUD refresh periods).
 */
const SETTLE = { frames: 3, ms: 500 };

/** Run frames until both SETTLE minimums are met (the loop must be running, i.e. not frozen). */
async function settle(page) {
  await page.evaluate(async ({ frames, ms }) => {
    const api = window.__SAMRAJYA__;
    const t0 = performance.now();
    for (let n = 0; n < frames || performance.now() - t0 < ms; n++) await api.waitFrames(1);
  }, SETTLE);
}

/**
 * Blank-frame guard, two measurements per shot:
 *  - frame: the saved PNG (HUD included, what reviewers look at). One exact colour covering >= `dominant` of it
 *    means a HUD over a blank / unpresented / partly presented canvas (GP-01 measured 32.7 % for a HUD over the page
 *    background at 390x844; every smoke and evidence image measures <= 8.7 %, most 0.2-2.3 %). Same rule as
 *    scripts/shots/gp-01.cjs.
 *  - view3d: a second, unsaved capture with the DOM layers above the WebGL canvas (#ui-root, #overlay-root, splash,
 *    overlays) hidden, so HUD text cannot mask an empty canvas. Blank when one exact colour covers >= `dominant` of it
 *    (black viewport, cleared-but-not-drawn frame, page background #0d0b18 through an unpresented canvas) or its luma
 *    spread is below `lumaStdev` (a flat frame). Rendered scenes measure 0.1-3.2 % dominant colour.
 * A blank frame is re-rendered (SETTLE again) and retaken up to `retries` times (SwiftShader can present an empty
 * frame after a resize under load); every blank attempt is kept in the report, and a frame still blank after the
 * retries fails the shot. `allowBlank` per shot opts out.
 */
const BLANK = { dominant: 0.15, lumaStdev: 3, retries: 2 };

/** Pixel statistics of a PNG: dominant colour share, luma stdev, page-background share (decoded in the page). */
async function pngStats(page, png) {
  const stats = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const counts = new Map();
    let best = 0;
    let bg = 0;
    let sum = 0;
    let sum2 = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const gg = d[i + 1];
      const b = d[i + 2];
      const k = (r << 16) | (gg << 8) | b;
      const m = (counts.get(k) || 0) + 1;
      counts.set(k, m);
      if (m > best) best = m;
      if (Math.abs(r - 13) <= 3 && Math.abs(gg - 11) <= 3 && Math.abs(b - 24) <= 3) bg++;
      const l = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
      sum += l;
      sum2 += l * l;
    }
    const mean = sum / n;
    return { dominantShare: best / n, lumaStdev: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), pageBgShare: bg / n };
  }, png.toString('base64'));
  const round = (v) => Math.round(v * 1000) / 1000;
  return { dominantShare: round(stats.dominantShare), lumaStdev: round(stats.lumaStdev), pageBgShare: round(stats.pageBgShare) };
}

/** Pixel statistics of the canvas-only view (DOM layers over #game hidden for an unsaved capture). */
async function view3dStats(page) {
  const hidden = await page.evaluate(() => {
    const out = [];
    for (const el of Array.from(document.body.children)) {
      if (el.id === 'game' || !(el instanceof HTMLElement)) continue;
      out.push([el, el.style.visibility]);
      el.style.visibility = 'hidden';
    }
    window.__smokeHidden = out;
    return out.length;
  });
  let png;
  try {
    png = await page.screenshot({ timeout: TIMEOUT });
  } finally {
    await page.evaluate(() => {
      for (const [el, v] of window.__smokeHidden || []) el.style.visibility = v;
      delete window.__smokeHidden;
    });
  }
  return { ...(await pngStats(page, png)), layersHidden: hidden };
}

/** Why a shot counts as blank (null = rendered): `frame` = the saved PNG, `view` = the canvas-only capture. */
function blankReason(frame, view) {
  if (frame.dominantShare >= BLANK.dominant) return `one colour covers ${(frame.dominantShare * 100).toFixed(1)} % of the saved frame (HUD over a blank or partly presented canvas)`;
  if (view.dominantShare >= BLANK.dominant) return `one colour covers ${(view.dominantShare * 100).toFixed(1)} % of the 3D view${view.pageBgShare >= BLANK.dominant ? ' (page background: canvas not presented)' : ''}`;
  if (view.lumaStdev < BLANK.lumaStdev) return `flat 3D view (luma stdev ${view.lumaStdev})`;
  return null;
}

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
      let view = null;
      let frame = null;
      const blankAttempts = [];
      try {
        await page.goto(url, { waitUntil: 'load', timeout: TIMEOUT });
        await page.waitForFunction(() => window.__SAMRAJYA__ && window.__SAMRAJYA__.ready && window.__SAMRAJYA__.sceneReady, null, { timeout: TIMEOUT, polling: 250 });
        // main.ts hideSplash() fades #boot-splash (0.6 s) and removes it 700 ms after `ready`; a slow software frame
        // could let the screenshot catch it mid-fade (TA-07: assetviewer-mobile). Every capture waits for its removal.
        await page
          .waitForFunction(() => !document.getElementById('boot-splash'), null, { timeout: TIMEOUT, polling: 100 })
          .catch((err) => {
            throw new Error(`boot splash still in the DOM after ready: ${err && err.message ? err.message : String(err)}`);
          });
        if (shot.advance) {
          await page.evaluate((n) => {
            const api = window.__SAMRAJYA__;
            api.pause();
            api.step(n);
          }, shot.advance);
        }
        await settle(page);
        state = await page.evaluate(() => window.__SAMRAJYA__.getState());
        // Freeze the loop so the screenshot does not wait for another software-rendered frame.
        await page.evaluate(() => window.__SAMRAJYA__.freeze(true));
        const crash = await page.evaluate(() => window.__SAMRAJYA__.getErrors().map((r) => r.message));
        for (const c of crash) errors.push(`crash: ${c}`);
        frame = await pngStats(page, await page.screenshot({ path: path.join(OUT, `${shot.name}.png`), timeout: TIMEOUT }));
        view = await view3dStats(page);
        for (let attempt = 1; !shot.allowBlank && blankReason(frame, view) && attempt <= BLANK.retries; attempt++) {
          blankAttempts.push({ frame, view3d: view, reason: blankReason(frame, view) });
          console.log(`[smoke] ${shot.name}: blank frame (${blankReason(frame, view)}), re-rendering and retaking (retry ${attempt}/${BLANK.retries})`);
          // Paused / frozen state: these frames re-render the same state (no sim step).
          await page.evaluate(() => window.__SAMRAJYA__.freeze(false));
          await page.evaluate(() => window.__SAMRAJYA__.waitFrames(30));
          await settle(page);
          await page.evaluate(() => window.__SAMRAJYA__.freeze(true));
          frame = await pngStats(page, await page.screenshot({ path: path.join(OUT, `${shot.name}.png`), timeout: TIMEOUT }));
          view = await view3dStats(page);
        }
        if (!shot.allowBlank && blankReason(frame, view)) errors.push(`blank: ${blankReason(frame, view)} after ${BLANK.retries} re-renders (frame ${JSON.stringify(frame)}, view3d ${JSON.stringify(view)})`);
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
      report.shots.push({ name: shot.name, url, ms, errors, state, frame, view3d: view, blankAttempts });
      const viewNote = view && frame ? `  frame dominant=${(frame.dominantShare * 100).toFixed(1)}%  view3d dominant=${(view.dominantShare * 100).toFixed(1)}% lumaStdev=${view.lumaStdev.toFixed(1)}` : '';
      console.log(`[smoke] ${errors.length ? 'FAIL' : 'ok  '} ${shot.name.padEnd(18)} ${String(ms).padStart(6)} ms  ${state ? `scene=${state.scene} quality=${state.quality}` : ''}${viewNote}`);
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
