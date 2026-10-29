#!/usr/bin/env node
/**
 * CORE-01 evidence captures (OWNER: Engine Developer - Contracts & Save Schema).
 *
 *   NODE_PATH=$(npm root -g) node scripts/shots/core-01.cjs
 *
 * Env: SHOTS_PORT (default 4401), SHOTS_DIST (default .build/core-01), SHOTS_SKIP_BUILD=1, SHOTS_OUT
 * (default docs/sprint1/core-01). Builds into SHOTS_DIST (never the shared dist/), serves it with vite preview and
 * drives headless Chromium (SwiftShader, CLAUDE.md launch args).
 *
 * Captures + assertions (exit 1 on any failure, console errors, page errors, failed requests or crash reports):
 *   splash.png / splash-mobile.png            boot splash held before the bundle runs (Tiro title, indigo radial)
 *   placeholder-market(-mobile).png           __SAMRAJYA__.showScreen('market', ...) over the world scene
 *   placeholder-game_stats.png                __SAMRAJYA__.showScreen('game_stats', ...)
 *   lab-example(-mobile).png                  ?scene=lab&lab=example reaches sceneReady, call('noop') round-trips
 *                                             to the lab scene, lab commands answer
 *   lab-unknown.png                           ?scene=lab&lab=<unknown> -> themed error panel + fallback to the menu
 *   shots-report.json                         every assertion with its observed value
 */
'use strict';
const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.SHOTS_PORT || 4401);
const DIST = process.env.SHOTS_DIST || '.build/core-01';
const OUT = path.resolve(ROOT, process.env.SHOTS_OUT || 'docs/sprint1/core-01');
const TIMEOUT = 240000;
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
  console.log(`[core-01] ${ok ? 'ok  ' : 'FAIL'} ${name}${observed !== undefined ? `  -> ${JSON.stringify(observed)}` : ''}`);
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

async function waitReady(page, predicate = 'true') {
  await page.waitForFunction(`window.__SAMRAJYA__ && window.__SAMRAJYA__.ready && window.__SAMRAJYA__.sceneReady && (${predicate})`, null, { timeout: TIMEOUT, polling: 250 });
  await page.evaluate(() => window.__SAMRAJYA__.waitFrames(2));
}

async function shot(page, name, note) {
  await page.evaluate(() => window.__SAMRAJYA__ && window.__SAMRAJYA__.freeze(true)).catch(() => undefined);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, timeout: TIMEOUT });
  report.shots.push({ name: `${name}.png`, note });
  console.log(`[core-01] shot ${name}.png  ${note}`);
}

async function finish(ctx, label) {
  const crash = await ctx.page.evaluate(() => (window.__SAMRAJYA__ ? window.__SAMRAJYA__.getErrors().map((r) => r.message) : [])).catch(() => []);
  check(`${label}: no console errors, page errors, failed requests or crash reports`, ctx.errors.length === 0 && crash.length === 0, [...ctx.errors, ...crash]);
  await ctx.context.close();
}

async function captureSplash(browser, base, viewport, name, mobile) {
  const ctx = await newPage(browser, viewport, mobile);
  // Hold the main bundle so the page stays on the boot splash (the request simply never completes).
  await ctx.page.route(/\/assets\/index-[^/]*\.js$/, () => undefined);
  // Module scripts delay DOMContentLoaded, so wait for the commit and the parsed splash element instead.
  await ctx.page.goto(`${base}?noaudio=1`, { waitUntil: 'commit', timeout: TIMEOUT });
  await ctx.page.waitForSelector('#boot-splash .title', { timeout: TIMEOUT });
  const font = await ctx.page.evaluate(async () => {
    await document.fonts.ready;
    const title = document.querySelector('#boot-splash .title');
    return { tiro: document.fonts.check('48px "Tiro Devanagari Sanskrit"'), family: getComputedStyle(title).fontFamily, bg: getComputedStyle(document.getElementById('boot-splash')).backgroundImage };
  });
  check(`${name}: title font Tiro Devanagari Sanskrit loaded`, font.tiro && /Tiro Devanagari Sanskrit/.test(font.family), font.family);
  check(`${name}: radial indigo background (#2a2546 -> #17142a -> #0d0b18)`, /radial-gradient/.test(font.bg) && /42, 37, 70/.test(font.bg) && /13, 11, 24/.test(font.bg), font.bg);
  await ctx.page.screenshot({ path: path.join(OUT, `${name}.png`), timeout: TIMEOUT });
  report.shots.push({ name: `${name}.png`, note: `boot splash ${viewport.join('x')}` });
  console.log(`[core-01] shot ${name}.png`);
  await ctx.context.close();
}

async function capturePlaceholders(browser, base) {
  for (const [viewport, mobile, suffix, quality] of [
    [[1280, 720], false, '', 'high'],
    [[390, 844], true, '-mobile', 'low'],
  ]) {
    const ctx = await newPage(browser, viewport, mobile);
    const { page } = ctx;
    await page.goto(`${base}?scene=world&seed=7&paused=1&quality=${quality}&noaudio=1`, { waitUntil: 'load', timeout: TIMEOUT });
    await waitReady(page);
    const screens = await page.evaluate(() => window.__SAMRAJYA__.screens());
    const ph = screens.filter((s) => s.source === 'placeholder').map((s) => s.id);
    check(`placeholders${suffix}: market and game_stats resolve to the placeholder`, ph.includes('market') && ph.includes('game_stats'), ph);
    await page.evaluate(() => {
      const api = window.__SAMRAJYA__;
      api.pause();
      api.showScreen('market', { world: '$world', factionId: '$faction' });
    });
    await page.waitForSelector('[data-placeholder="market"]', { state: 'visible', timeout: TIMEOUT });
    const keys = await page.$eval('[data-placeholder="market"]', (el) => el.dataset.propKeys);
    check(`placeholders${suffix}: market prints its prop keys`, keys === 'world,factionId', keys);
    await shot(page, `placeholder-market${suffix}`, 'showScreen(market) over the world scene: themed placeholder listing its props');
    if (!mobile) {
      await page.evaluate(() => window.__SAMRAJYA__.freeze(false));
      await page.evaluate(() => {
        const api = window.__SAMRAJYA__;
        api.hideScreen('market');
        api.showScreen('game_stats', { world: '$world', from: 'scenario_results' });
      });
      await page.waitForSelector('[data-placeholder="game_stats"]', { state: 'visible', timeout: TIMEOUT });
      const k2 = await page.$eval('[data-placeholder="game_stats"]', (el) => el.dataset.propKeys);
      check('placeholders: game_stats prints its prop keys', k2 === 'world,from', k2);
      await shot(page, 'placeholder-game_stats', 'showScreen(game_stats) - statistics placeholder (UI-01)');
      // call('noop') on a scene without debugCommand -> API built-in.
      await page.evaluate(() => window.__SAMRAJYA__.freeze(false));
      const noop = await page.evaluate(() => window.__SAMRAJYA__.call('noop', 1));
      check('call(noop) on the world scene answers (API built-in until GP-03 adds debugCommand)', noop && noop.scene === 'world', noop);
      const unknown = await page.evaluate(() => window.__SAMRAJYA__.call('no.such.command').then(() => 'resolved', (e) => String(e.message)));
      check('call(unknown) rejects with a readable error', /Unknown debug command/.test(unknown), unknown);
      let threw = '';
      try {
        await page.evaluate(() => window.__SAMRAJYA__.showScreen('not_a_screen', {}));
      } catch (e) {
        threw = String(e.message);
      }
      check('showScreen(unknown id) throws', /Unknown screen id/.test(threw), threw.split('\n')[0]);
    }
    await finish(ctx, `placeholders${suffix}`);
  }
}

async function captureLabs(browser, base) {
  for (const [viewport, mobile, suffix, quality] of [
    [[1280, 720], false, '', 'high'],
    [[390, 844], true, '-mobile', 'low'],
  ]) {
    const ctx = await newPage(browser, viewport, mobile);
    const { page } = ctx;
    await page.goto(`${base}?scene=lab&lab=example&quality=${quality}&noaudio=1`, { waitUntil: 'load', timeout: TIMEOUT });
    await waitReady(page, "window.__SAMRAJYA__.scene === 'lab'");
    const state = await page.evaluate(() => window.__SAMRAJYA__.getState());
    check(`lab-example${suffix}: reaches sceneReady in the lab scene`, state.scene === 'lab' && state.sceneState && state.sceneState.lab === 'example' && !state.sceneState.failure, state.sceneState);
    if (!mobile) {
      const noop = await page.evaluate(() => window.__SAMRAJYA__.call('noop', 'ping'));
      check("lab: call('noop') round-trips to the scene's debugCommand", noop && noop.scene === 'lab' && noop.handledBy === 'scene' && noop.args[0] === 'ping', noop);
      const info = await page.evaluate(() => window.__SAMRAJYA__.call('lab.info'));
      check("lab: call('lab.info')", info && info.id === 'example' && /example\.lab\.ts$/.test(info.path), info);
      const spin = await page.evaluate(() => window.__SAMRAJYA__.call('example.spin', 0.6));
      check("lab: lab-specific call('example.spin') reaches the lab instance", spin && spin.spin === 0.6, spin);
      const labs = await page.evaluate(() => window.__SAMRAJYA__.labs());
      check('lab: __SAMRAJYA__.labs() lists the example', labs.includes('example'), labs);
      const prof = await page.evaluate(() => window.__SAMRAJYA__.getProfile());
      report.labProfile = { drawCalls: prof.render ? prof.render.drawCalls : prof.drawCalls, triangles: prof.render ? prof.render.triangles : prof.triangles };
    }
    await shot(page, `lab-example${suffix}`, `?scene=lab&lab=example @${quality} ${viewport.join('x')}`);
    await finish(ctx, `lab-example${suffix}`);
  }
  // Unknown lab id: themed error panel, then the menu.
  const ctx = await newPage(browser, [1280, 720], false);
  const { page } = ctx;
  await page.goto(`${base}?scene=lab&lab=no-such-lab&quality=high&noaudio=1`, { waitUntil: 'load', timeout: TIMEOUT });
  await waitReady(page, "window.__SAMRAJYA__.scene === 'menu'");
  const panel = await page.$eval('[data-testid="lab-error"]', (el) => ({ visible: el.getBoundingClientRect().height > 40, text: el.textContent })).catch(() => null);
  check('lab-unknown: themed error panel shown', panel && panel.visible && /Lab not found/.test(panel.text) && /no-such-lab/.test(panel.text) && /example/.test(panel.text), panel && panel.text);
  check('lab-unknown: fell back to the main menu', (await page.evaluate(() => window.__SAMRAJYA__.scene)) === 'menu');
  await shot(page, 'lab-unknown', '?scene=lab&lab=no-such-lab: error panel listing the available labs over the main menu');
  await finish(ctx, 'lab-unknown');
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  if (!process.env.SHOTS_SKIP_BUILD) {
    console.log(`[core-01] building into ${DIST}`);
    execSync(`"${process.execPath}" "${path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')}" build --outDir "${DIST}" --emptyOutDir`, { cwd: ROOT, stdio: 'inherit' });
  }
  const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const server = spawn(process.execPath, [viteBin, 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = `http://127.0.0.1:${PORT}/`;
  const { chromium } = requirePlaywright();
  let browser;
  try {
    await waitForServer(base, 30000);
    browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
    await captureSplash(browser, base, [1280, 720], 'splash', false);
    await captureSplash(browser, base, [390, 844], 'splash-mobile', true);
    await capturePlaceholders(browser, base);
    await captureLabs(browser, base);
  } catch (err) {
    check('script ran to completion', false, String(err && err.stack ? err.stack : err));
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
    server.stdout.destroy();
    server.stderr.destroy();
  }
  fs.writeFileSync(path.join(OUT, 'shots-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(failed ? '[core-01] FAILED' : `[core-01] all ${report.checks.length} checks passed -> ${path.relative(ROOT, OUT)}/`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
