#!/usr/bin/env node
/**
 * SIM-01 evidence captures (OWNER: Simulation Engineer - Strategic World Simulation).
 *
 *   NODE_PATH=$(npm root -g) node scripts/shots/sim-01.cjs
 *
 * Env: SHOTS_PORT (default 4405), SHOTS_DIST (default .build/sim-01), SHOTS_SKIP_BUILD=1, SHOTS_OUT
 * (default docs/sprint1/sim-01). Builds into SHOTS_DIST (never the shared dist/), serves it with vite preview and
 * drives headless Chromium (SwiftShader, CLAUDE.md launch args) through window.__SAMRAJYA__.
 *
 * Captures + assertions (exit 1 on any failure, console errors, page errors, failed requests or crash reports):
 *   world-day0.png         The Broken Crown at the start (overview camera)
 *   world-march.png        the Royal Host ordered to besiege Giridurg (issueStrategicCommand), 6 days of marching
 *   world-day60.png        60 simulated days later: harvest, prices, events, AI moves - the HUD numbers changed
 *   game-stats.png         showScreen('game_stats') after 60 days (statistics counters tracked by the sim)
 *   world-mobile.png       390x844 low quality after 10 days
 *   shots-report.json      every assertion with its observed value (state hashes, day, treasury, armies); two
 *                          browser runs of the same seed + command give the same world hash
 */
'use strict';
const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.SHOTS_PORT || 4405);
const DIST = process.env.SHOTS_DIST || '.build/sim-01';
const OUT = path.resolve(ROOT, process.env.SHOTS_OUT || 'docs/sprint1/sim-01');
const TIMEOUT = 300000;
const LAUNCH_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];

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
    const once = () =>
      http
        .get(url, (res) => {
          res.resume();
          if (res.statusCode && res.statusCode < 500) resolve();
          else retry();
        })
        .on('error', retry);
    const retry = () => (Date.now() - t0 > ms ? reject(new Error(`server not up at ${url}`)) : setTimeout(once, 300));
    once();
  });
}

const report = { port: PORT, dist: DIST, checks: [], shots: [] };
let failed = false;
function check(name, ok, observed) {
  report.checks.push({ name, ok: !!ok, observed });
  console.log(`[sim-01] ${ok ? 'ok  ' : 'FAIL'} ${name}${observed !== undefined ? `  -> ${JSON.stringify(observed)}` : ''}`);
  if (!ok) failed = true;
}

async function newPage(browser, viewport, mobile) {
  const context = await browser.newContext({ viewport: { width: viewport[0], height: viewport[1] }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`));
  return { context, page, errors };
}

async function waitReady(page) {
  await page.waitForFunction('window.__SAMRAJYA__ && window.__SAMRAJYA__.ready && window.__SAMRAJYA__.sceneReady', null, { timeout: TIMEOUT, polling: 250 });
  await page.evaluate(() => window.__SAMRAJYA__.waitFrames(2));
}

async function shot(page, name, note) {
  await page.evaluate(() => window.__SAMRAJYA__ && window.__SAMRAJYA__.waitFrames(2)).catch(() => undefined);
  await page.evaluate(() => window.__SAMRAJYA__ && window.__SAMRAJYA__.freeze(true)).catch(() => undefined);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, timeout: TIMEOUT });
  report.shots.push({ name: `${name}.png`, note });
  console.log(`[sim-01] shot ${name}.png  ${note}`);
  await page.evaluate(() => window.__SAMRAJYA__ && window.__SAMRAJYA__.freeze(false)).catch(() => undefined);
}

async function finish(ctx, label) {
  const crash = await ctx.page.evaluate(() => (window.__SAMRAJYA__ ? window.__SAMRAJYA__.getErrors().map((r) => r.message) : [])).catch(() => []);
  check(`${label}: no console errors, page errors, failed requests or crash reports`, ctx.errors.length === 0 && crash.length === 0, [...ctx.errors, ...crash]);
  await ctx.context.close();
}

/** World summary read through the debug API (sceneState is the world scene's own summary). */
async function worldInfo(page) {
  return page.evaluate(() => {
    const api = window.__SAMRAJYA__;
    const st = api.getState();
    return { scene: st.scene, paused: st.paused, hash: api.hash(), sceneState: st.sceneState };
  });
}

/**
 * Advance `days` simulated days. The world scene stops on player prompts (event modal, engagement prompt), so the
 * player's first (safe default) event choice is clicked and engagements are autoresolved - like the headless runs.
 */
async function advanceDays(page, days) {
  const day0 = (await worldInfo(page)).sceneState.world.day;
  for (let guard = 0; guard < days * 6; guard++) {
    const info = await worldInfo(page);
    const st = info.sceneState;
    if (st.world.day >= day0 + days || st.world.victory !== 'ongoing') break;
    if (st.blocked) {
      const clicked = await page.evaluate(() => {
        // An engagement prompt wins ("Let the Generals Decide" = autoresolve); otherwise the newest modal's first choice.
        const auto = [...document.querySelectorAll('button')].find((b) => /generals decide|autoresolve|auto-resolve|auto resolve/i.test(b.textContent || ''));
        const modals = [...document.querySelectorAll('.panel.modal')];
        const modal = modals[modals.length - 1];
        const buttons = modal ? [...modal.querySelectorAll('button.btn')] : [];
        const target = auto || buttons[0];
        if (!target) return null;
        target.click();
        return (target.textContent || '').slice(0, 40);
      });
      report.clicks = report.clicks || [];
      report.clicks.push({ day: st.world.day, clicked });
      await page.evaluate(() => window.__SAMRAJYA__.waitFrames(3));
      continue;
    }
    await page.evaluate(() => window.__SAMRAJYA__.step(24));
  }
  await page.evaluate(() => window.__SAMRAJYA__.waitFrames(2));
}

async function captureWorld(browser, base) {
  const ctx = await newPage(browser, [1280, 720], false);
  const { page } = ctx;
  await page.goto(`${base}?scene=world&seed=7&paused=1&camera=overview&quality=high&noaudio=1`, { waitUntil: 'load', timeout: TIMEOUT });
  await waitReady(page);
  const start = await worldInfo(page);
  check('world: The Broken Crown loads paused with a state hash', start.scene === 'world' && typeof start.hash === 'string', { hash: start.hash, paused: start.paused });
  report.start = start;
  await shot(page, 'world-day0', 'The Broken Crown, day 0, overview camera');
  // Order the Royal Host to besiege Giridurg and let it march.
  await page.evaluate(() => window.__SAMRAJYA__.issueStrategicCommand({ kind: 'army_order', armyId: 'army_royal', order: { kind: 'besiege', settlementId: 'giridurg' } }));
  await advanceDays(page, 6);
  const march = await worldInfo(page);
  check('world: the besiege order and six days change the authoritative state', march.hash !== start.hash, { before: start.hash, after: march.hash });
  report.march = march;
  await shot(page, 'world-march', 'army_royal ordered to besiege Giridurg (issueStrategicCommand), 6 days later');
  await advanceDays(page, 54);
  const later = await worldInfo(page);
  check('world: 60 simulated days later the world has moved on', later.hash !== march.hash, { hash: later.hash, sceneState: later.sceneState });
  report.day60 = later;
  await shot(page, 'world-day60', '60 days: harvest, prices, events and AI moves (HUD values changed)');
  // Statistics screen over the live world (UI-01 owns the screen; the counters are SIM-01's).
  const screens = await page.evaluate(() => window.__SAMRAJYA__.screens().map((s) => `${s.id}:${s.source}`));
  report.screens = screens;
  await page.evaluate(() => {
    const api = window.__SAMRAJYA__;
    api.pause();
    api.showScreen('game_stats', { world: '$world', from: 'pause_menu' });
  });
  await page.evaluate(() => window.__SAMRAJYA__.waitFrames(3));
  await shot(page, 'game-stats', "showScreen('game_stats', { world: '$world' }) after 60 days");
  await finish(ctx, 'world');
}

async function captureMobile(browser, base) {
  const ctx = await newPage(browser, [390, 844], true);
  const { page } = ctx;
  await page.goto(`${base}?scene=world&seed=7&paused=1&quality=low&noaudio=1`, { waitUntil: 'load', timeout: TIMEOUT });
  await waitReady(page);
  const day0 = (await worldInfo(page)).sceneState.world.day;
  await advanceDays(page, 10);
  const info = await worldInfo(page);
  check('world-mobile: 10 days at low quality', info.scene === 'world' && info.sceneState.world.day >= day0 + 10, { hash: info.hash, day: info.sceneState.world.day });
  await shot(page, 'world-mobile', '390x844 low quality, 10 days in');
  await finish(ctx, 'world-mobile');
}

async function determinism(browser, base) {
  // Same URL + same commands in two pages => the same world hash.
  const hashes = [];
  for (let i = 0; i < 2; i++) {
    const ctx = await newPage(browser, [640, 360], false);
    const { page } = ctx;
    await page.goto(`${base}?scene=world&seed=7&paused=1&quality=low&noaudio=1`, { waitUntil: 'load', timeout: TIMEOUT });
    await waitReady(page);
    // 20 paused hours of day 0 (before the first prompt): no real-time ticks can sneak in.
    await page.evaluate(() => window.__SAMRAJYA__.issueStrategicCommand({ kind: 'army_order', armyId: 'army_royal', order: { kind: 'besiege', settlementId: 'giridurg' } }));
    await page.evaluate(() => window.__SAMRAJYA__.step(20));
    hashes.push((await worldInfo(page)).hash);
    await finish(ctx, `determinism-${i + 1}`);
  }
  check('determinism: two browser runs with the same seed and commands hash alike', hashes[0] === hashes[1] && hashes[0] !== null, hashes);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  if (!process.env.SHOTS_SKIP_BUILD) {
    console.log('[sim-01] building...');
    execSync(`npx vite build --outDir ${DIST} --emptyOutDir`, { cwd: ROOT, stdio: 'inherit' });
  }
  const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--outDir', DIST], { cwd: ROOT, stdio: 'ignore' });
  const base = `http://localhost:${PORT}/`;
  let browser;
  try {
    await waitForServer(base, 60000);
    const { chromium } = requirePlaywright();
    browser = await chromium.launch({ args: LAUNCH_ARGS });
    await captureWorld(browser, base);
    await captureMobile(browser, base);
    await determinism(browser, base);
  } catch (e) {
    check('run completed', false, String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
  } finally {
    if (browser) await browser.close();
    preview.kill('SIGTERM');
    fs.writeFileSync(path.join(OUT, 'shots-report.json'), JSON.stringify(report, null, 1));
  }
  console.log(`[sim-01] ${failed ? 'FAILED' : 'all checks passed'} -> ${path.relative(ROOT, OUT)}/`);
  process.exit(failed ? 1 : 0);
})();
