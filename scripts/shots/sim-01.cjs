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
 *                          (rework round 2, review S1: once it besieges, a depot is built 150 m behind its camp and
 *                          filled from Rajapura with requisition_grain, topped up on day 40 - the siege is fed)
 *   world-day60.png        60 simulated days later: harvest, prices, events, AI moves - the HUD numbers changed;
 *                          the Royal Host still besieges Giridurg, fed by its depot, with no starving day
 *                          (taken once the day-60 fog lifts, +2 days for seed 7)
 *   game-stats.png         showScreen('game_stats') after 60 days (statistics counters tracked by the sim)
 *   world-mobile.png       390x844 low quality after 10 days
 *   shots-report.json      every assertion with its observed value (state hashes, day, treasury, armies); two
 *                          browser runs of the same seed + command give the same world hash. The world only moves
 *                          by step() (re-paused after every prompt click), so every hash in the report is the same
 *                          from one run of this script to the next.
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
      const clicked = await page.evaluate(async () => {
        const api = window.__SAMRAJYA__;
        // An engagement prompt wins ("Let the Generals Decide" = autoresolve); otherwise the newest modal's first choice.
        const auto = [...document.querySelectorAll('button')].find((b) => /generals decide|autoresolve|auto-resolve|auto resolve/i.test(b.textContent || ''));
        const modals = [...document.querySelectorAll('.panel.modal')];
        const modal = modals[modals.length - 1];
        const buttons = modal ? [...modal.querySelectorAll('button.btn')] : [];
        const target = auto || buttons[0];
        if (!target) return null;
        const label = (target.textContent || '').slice(0, 40);
        target.click();
        // The world scene resumes the game in the frame it sees the prompt closed (WorldScene.update). Pause again
        // at the end of that same frame - before the next frame accumulates time - so the world only ever moves by
        // step() and the hashes in this report are reproducible run to run, not wall-clock dependent.
        for (let i = 0; i < 30; i++) {
          await api.waitFrames(1);
          if (!api.getState().paused) {
            api.pause();
            break;
          }
        }
        return label;
      });
      report.clicks = report.clicks || [];
      report.clicks.push({ day: st.world.day, clicked });
      continue;
    }
    await page.evaluate(() => window.__SAMRAJYA__.step(24));
  }
  await page.evaluate(() => window.__SAMRAJYA__.waitFrames(2));
}

/**
 * The live WorldState, read through a quick save into a probe slot (saving only serializes the world; the slot is
 * removed again). Plain JSON - enough to read armies, depots and settlements.
 */
async function readWorld(page) {
  return page.evaluate(() => {
    const api = window.__SAMRAJYA__;
    const before = api.hash();
    const slot = api.save('sim01probe');
    const key = Object.keys(localStorage).find((k) => k.startsWith('samrajya.save') && k.endsWith(slot));
    const text = (key && localStorage.getItem(key)) || '';
    if (key) localStorage.removeItem(key);
    const nl = text.lastIndexOf('\n#');
    const game = JSON.parse(nl >= 0 ? text.slice(0, nl) : text);
    if (api.hash() !== before) throw new Error('saving changed the world');
    return game.world;
  });
}

/** Issue a strategic command and apply it with one simulated hour (the world is paused; commands apply on a step). */
async function command(page, cmd) {
  await page.evaluate((c) => {
    const api = window.__SAMRAJYA__;
    api.issueStrategicCommand(c);
    api.step(1);
  }, cmd);
}

/** Review S1 in the running game: build a depot behind the Royal Host's siege camp and fill it from Rajapura. */
async function feedTheSiege(page) {
  let w = await readWorld(page);
  for (let i = 0; i < 6 && w.armies.army_royal && w.armies.army_royal.status !== 'besieging'; i++) {
    await advanceDays(page, 1);
    w = await readWorld(page);
  }
  const host = w.armies.army_royal;
  const g = w.settlements.giridurg;
  check('world: the Royal Host reaches Giridurg and besieges it', !!host && host.status === 'besieging' && g.besiegedBy === host.id, { day: Math.floor(w.calendar.totalHours / 24), status: host && host.status, besiegedBy: g.besiegedBy });
  if (!host || host.status !== 'besieging') return null;
  const dx = host.x - g.x;
  const dz = host.z - g.z;
  const len = Math.hypot(dx, dz) || 1;
  const x = host.x + (dx / len) * 150;
  const z = host.z + (dz / len) * 150;
  await command(page, { kind: 'create_depot', x, z, settlementId: null });
  w = await readWorld(page);
  const depotId = Object.keys(w.depots).find((id) => w.depots[id].factionId === w.playerFactionId && Math.hypot(w.depots[id].x - x, w.depots[id].z - z) < 1) || null;
  if (depotId) await command(page, { kind: 'requisition_grain', settlementId: 'rajapura', amount: 6000, toArmyId: null, toDepotId: depotId });
  w = await readWorld(page);
  const depot = depotId ? w.depots[depotId] : null;
  check('world: a depot 150 m behind the siege camp, filled with 6,000 grain requisitioned from Rajapura', !!depot && depot.food >= 6000 - 1e-6, { depotId, food: depot && depot.food, readyOnDay: depot && depot.readyOnDay, x: Math.round(x), z: Math.round(z) });
  report.siege = { day: Math.floor(w.calendar.totalHours / 24), depotId, depot: depot && { x: Math.round(depot.x), z: Math.round(depot.z), food: depot.food } };
  return depotId;
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
  const depotId = await feedTheSiege(page);
  // Top the depot up on day 40 (the Royal Host eats ~170 a day: 6,000 lasts ~35 days).
  await advanceDays(page, 40 - (await worldInfo(page)).sceneState.world.day);
  if (depotId) {
    const w40 = await readWorld(page);
    const room = Math.floor(w40.depots[depotId].capacity - w40.depots[depotId].food);
    if (room > 0) await command(page, { kind: 'requisition_grain', settlementId: 'rajapura', amount: room, toArmyId: null, toDepotId: depotId });
    report.siege.topUp = { day: Math.floor(w40.calendar.totalHours / 24), amount: room };
  }
  await advanceDays(page, 60 - (await worldInfo(page)).sceneState.world.day);
  let later = await worldInfo(page);
  {
    const w60 = await readWorld(page);
    const host = w60.armies.army_royal;
    const observed = host && { status: host.status, soldiers: host.units.reduce((n, u) => n + u.soldiers, 0), food: Math.round(host.supply.food), sourceId: host.supply.sourceId, starvationDays: host.supply.starvationDays, depotFood: depotId && Math.round(w60.depots[depotId].food), wallHp: Math.round(w60.settlements.giridurg.wallHp) };
    report.siege.day60 = observed;
    check('world: day 60 - the Royal Host besieging Giridurg is fed by its depot (review S1), not starving', !!host && host.status === 'besieging' && host.supply.sourceId === depotId && host.supply.starvationDays === 0, observed);
  }
  check('world: 60 simulated days later the world has moved on', later.hash !== march.hash, { hash: later.hash, sceneState: later.sceneState });
  report.day60 = later;
  // Day 60 of seed 7 is a hemanta fog morning (the overview is a grey veil): the shot waits for the fog to lift
  // (whole days, at most 5) so the map is readable; the check above is on day 60 itself.
  let waited = 0;
  while (waited < 5 && later.sceneState?.world?.weather === 'fog') {
    await advanceDays(page, 1);
    later = await worldInfo(page);
    waited++;
  }
  report.day60Shot = { waitedDays: waited, day: later.sceneState?.world?.day, weather: later.sceneState?.world?.weather };
  await shot(page, 'world-day60', `60 days (+${waited} until the fog lifts): harvest, prices, events and AI moves (HUD values changed)`);
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
  // vite itself (not an npx wrapper), so kill() stops the server; a busy port fails the run instead of capturing
  // whatever else is listening there.
  const preview = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--outDir', DIST], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let previewLog = '';
  let previewExit = null;
  preview.stdout.on('data', (d) => (previewLog += d));
  preview.stderr.on('data', (d) => (previewLog += d));
  preview.on('exit', (code) => (previewExit = code));
  const base = `http://localhost:${PORT}/`;
  let browser;
  try {
    await waitForServer(base, 60000);
    await new Promise((r) => setTimeout(r, 500));
    if (previewExit !== null) throw new Error(`vite preview exited (${previewExit}) - port ${PORT} busy? set SHOTS_PORT. ${previewLog.trim().split('\n').slice(-2).join(' | ')}`);
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
