#!/usr/bin/env node
/**
 * SIM-02 evidence captures (OWNER: AI Engineer - Battle AI, Intents & Campaign AI).
 *
 *   node scripts/sim-ai/autoplay.mjs                  (writes .build/sim-02/ai-year.sav - run first)
 *   NODE_PATH=$(npm root -g) node scripts/shots/sim-02.cjs
 *
 * Env: SHOTS_PORT (default 4418), SHOTS_DIST (default .build/sim-02/dist), SHOTS_SKIP_BUILD=1, SHOTS_OUT
 * (default docs/sprint1/sim-02). Builds into SHOTS_DIST (never the shared dist/), serves it with vite preview and
 * drives headless Chromium (SwiftShader, CLAUDE.md launch args) through window.__SAMRAJYA__.
 *
 * Captures + assertions (exit 1 on any failure, console errors, page errors, failed requests or crash reports):
 *   battle-aivsai-deploy.png   ?aivsai=1 plains battle, 1,500 soldiers (?noui=1): both battle AIs deployed
 *   battle-aivsai-contact.png  the same battle 75 s into the fight: lines in contact, horse on the wings
 *   battle-aivsai-river.png    ?aivsai=1 river crossing, 2,000 soldiers, 90 s in: the AIs at the ford
 *   world-ai-year.png          the world map after an AI-only sandbox year (save from scripts/sim-ai/autoplay.mjs,
 *                              loaded into the game; run on a few days if the year ended in fog): borders, armies and towns as the
 *                              six AIs left them, the expansionist in the Samrajya Age
 *   world-ai-live.png          a fresh sandbox run 45 days in the browser (the player realm passive): the AI realms
 *                              planned every day (plan memory stamped with the current day), built, recruited, moved
 *   shots-report.json          every assertion with its observed value
 */
'use strict';
const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.SHOTS_PORT || 4418);
const DIST = process.env.SHOTS_DIST || '.build/sim-02/dist';
const OUT = path.resolve(ROOT, process.env.SHOTS_OUT || 'docs/sprint1/sim-02');
const SAVE = path.resolve(ROOT, '.build/sim-02/ai-year.sav');
const SAVE_INDEX = path.resolve(ROOT, '.build/sim-02/ai-year.index.json');
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
  console.log(`[sim-02] ${ok ? 'ok  ' : 'FAIL'} ${name}${observed !== undefined ? `  -> ${JSON.stringify(observed)}` : ''}`);
  if (!ok) failed = true;
}

async function newPage(browser, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport[0], height: viewport[1] }, deviceScaleFactor: 1 });
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
  await page.evaluate(() => window.__SAMRAJYA__ && window.__SAMRAJYA__.waitFrames(3)).catch(() => undefined);
  await page.evaluate(() => window.__SAMRAJYA__ && window.__SAMRAJYA__.freeze(true)).catch(() => undefined);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, timeout: TIMEOUT });
  report.shots.push({ name: `${name}.png`, note });
  console.log(`[sim-02] shot ${name}.png  ${note}`);
  await page.evaluate(() => window.__SAMRAJYA__ && window.__SAMRAJYA__.freeze(false)).catch(() => undefined);
}

async function finish(ctx, label) {
  const crash = await ctx.page.evaluate(() => (window.__SAMRAJYA__ ? window.__SAMRAJYA__.getErrors().map((r) => r.message) : [])).catch(() => []);
  check(`${label}: no console errors, page errors, failed requests or crash reports`, ctx.errors.length === 0 && crash.length === 0, [...ctx.errors, ...crash]);
  await ctx.context.close();
}

const sceneState = (page) => page.evaluate(() => window.__SAMRAJYA__.getState().sceneState);

/** Step the battle `seconds` of simulated time (20 Hz fixed steps), in chunks so the page stays responsive. */
async function battleSeconds(page, seconds) {
  for (let left = Math.round(seconds * 20); left > 0; left -= 200) await page.evaluate((n) => window.__SAMRAJYA__.step(n), Math.min(200, left));
}

/** The live battle state, read through a quick save into a probe slot (removed again). */
async function readSave(page, slot) {
  return page.evaluate((probe) => {
    const api = window.__SAMRAJYA__;
    const s = api.save(probe);
    const key = Object.keys(localStorage).find((k) => k.startsWith('samrajya.save') && k.endsWith(s));
    const text = (key && localStorage.getItem(key)) || '';
    if (key) localStorage.removeItem(key);
    const nl = text.lastIndexOf('\n#');
    return JSON.parse(nl >= 0 ? text.slice(0, nl) : text);
  }, slot);
}

async function captureBattle(browser, base) {
  const ctx = await newPage(browser, [1280, 720]);
  const { page } = ctx;
  await page.goto(`${base}?scene=battle&aivsai=1&seed=7&soldiers=1500&preset=plains&paused=1&noaudio=1&noui=1`, { timeout: TIMEOUT });
  await waitReady(page);
  let st = await sceneState(page);
  check('battle: AI vs AI skirmish ready in deployment', st && st.phase === 'deployment', st && { phase: st.phase, formations: st.formations });
  await battleSeconds(page, 30);
  st = await sceneState(page);
  // Shoot first: the probe save below raises a "Chronicle saved" toast.
  await shot(page, 'battle-aivsai-deploy', `deployment over (${st.time}s), phase ${st.phase}`);
  const game = await readSave(page, 'sim02probe');
  const b = game.battle;
  const deployed = b && b.sides.map((s) => s.aiMemory && s.aiMemory.deployed === true);
  check('battle: both sides deployed by the battle AI (plan memory)', deployed && deployed[0] && deployed[1], { deployed, posture: b && b.sides.map((s) => s.aiMemory && s.aiMemory.posture), phase: st.phase });
  await battleSeconds(page, 75);
  st = await sceneState(page);
  check('battle: the fight is on 75 s after deployment (losses on both sides)', st.sides.every((s) => s.soldiers < s.initial) || st.outcome !== null, st.sides);
  await shot(page, 'battle-aivsai-contact', `t=${st.time}s soldiers ${st.sides.map((s) => `${s.soldiers}/${s.initial}`).join(' vs ')}`);
  await finish(ctx, 'battle');

  const ctx2 = await newPage(browser, [1280, 720]);
  await ctx2.page.goto(`${base}?scene=battle&aivsai=1&seed=11&soldiers=2000&preset=river_crossing&paused=1&noaudio=1&noui=1&hour=9`, { timeout: TIMEOUT });
  await waitReady(ctx2.page);
  await battleSeconds(ctx2.page, 90);
  const st2 = await sceneState(ctx2.page);
  check('river battle: running with the AI on both sides', st2 && st2.phase !== 'deployment', st2 && { phase: st2.phase, time: st2.time });
  await shot(ctx2.page, 'battle-aivsai-river', `river crossing t=${st2.time}s soldiers ${st2.sides.map((s) => `${s.soldiers}/${s.initial}`).join(' vs ')}`);
  await finish(ctx2, 'river battle');
}

async function captureAiYear(browser, base) {
  if (!fs.existsSync(SAVE)) {
    check('world: AI-year save present (run node scripts/sim-ai/autoplay.mjs first)', false, SAVE);
    return;
  }
  const text = fs.readFileSync(SAVE, 'utf8');
  const index = fs.readFileSync(SAVE_INDEX, 'utf8');
  const ctx = await newPage(browser, [1280, 720]);
  const { page } = ctx;
  await page.goto(`${base}?scene=menu&noaudio=1`, { timeout: TIMEOUT });
  await waitReady(page);
  await page.evaluate(
    ([t, idx]) => {
      localStorage.setItem('samrajya.save.sim02', t);
      const cur = JSON.parse(localStorage.getItem('samrajya.saves.index') || '{}');
      localStorage.setItem('samrajya.saves.index', JSON.stringify({ ...cur, ...JSON.parse(idx) }));
    },
    [text, index],
  );
  await page.evaluate(() => window.__SAMRAJYA__.load('sim02'));
  await page.waitForFunction("window.__SAMRAJYA__.scene === 'world' && window.__SAMRAJYA__.sceneReady", null, { timeout: TIMEOUT, polling: 250 });
  await page.evaluate(() => window.__SAMRAJYA__.pause());
  // The year may end in fog: let the days run (a few at most) until the sky clears enough to see the map.
  for (let i = 0; i < 30; i++) {
    const w0 = (await sceneState(page)).world;
    if (!['fog', 'storm', 'monsoon_rain', 'overcast'].includes(w0.weather)) break;
    await page.evaluate(() => window.__SAMRAJYA__.step(24));
  }
  await page.evaluate(() => window.__SAMRAJYA__.waitFrames(4));
  const st = await sceneState(page);
  check('world: the AI-year save loads into the world scene', st && st.world && st.world.day >= 360, st && st.world && { day: st.world.day, factions: st.world.factions });
  await shot(page, 'world-ai-year', `after ${st.world.day} days of six AI realms: ${st.world.factions.filter((f) => f.settlements > 0).map((f) => `${f.id} ${f.settlements} towns ${f.soldiers} soldiers`).join(', ')}`);
  report.aiYear = st.world;
  await finish(ctx, 'world (AI year)');
}

async function captureLive(browser, base) {
  const ctx = await newPage(browser, [1280, 720]);
  const { page } = ctx;
  await page.goto(`${base}?scene=world&mode=sandbox&seed=3&paused=1&noaudio=1`, { timeout: TIMEOUT });
  await waitReady(page);
  const days = 45;
  for (let d = 0; d < days * 4; d++) {
    const st = await sceneState(page);
    if (st.world.day >= days) break;
    if (st.blocked) {
      await page.evaluate(async () => {
        const api = window.__SAMRAJYA__;
        const auto = [...document.querySelectorAll('button')].find((b) => /generals decide|autoresolve|auto-resolve|auto resolve/i.test(b.textContent || ''));
        const modals = [...document.querySelectorAll('.panel.modal')];
        const modal = modals[modals.length - 1];
        const target = auto || (modal ? modal.querySelector('button.btn') : null);
        if (target) target.click();
        for (let i = 0; i < 30; i++) {
          await api.waitFrames(1);
          if (!api.getState().paused) {
            api.pause();
            break;
          }
        }
      });
      continue;
    }
    await page.evaluate(() => window.__SAMRAJYA__.step(24));
  }
  const game = await readSave(page, 'sim02probe');
  const w = game.world;
  const day = Math.floor(w.calendar.totalHours / 24);
  const ai = Object.values(w.factions).filter((f) => !f.isPlayer && f.alive && Object.values(w.settlements).some((s) => s.ownerFactionId === f.id));
  const planned = ai.map((f) => ({ id: f.id, lastDay: f.ai.memory.lastDay, goals: f.ai.goals.length, top: f.ai.goals[0] ? `${f.ai.goals[0].kind}` : null }));
  check('live world: every landed AI realm planned today in the browser (plan memory)', planned.length > 0 && planned.every((p) => p.lastDay === day), { day, planned });
  const jobs = Object.values(w.settlements).filter((s) => s.ownerFactionId && !w.factions[s.ownerFactionId].isPlayer).reduce((n, s) => n + s.construction.length + s.recruitment.length, 0);
  const labor = Object.values(w.settlements).filter((s) => s.ownerFactionId && !w.factions[s.ownerFactionId].isPlayer && s.laborAllocation.farming >= 0.8).length;
  check('live world: the AI realms build, recruit and set labour (queues and allocations in the state)', jobs > 0 && labor > 0, { jobs, farmingHeavySettlements: labor });
  await shot(page, 'world-ai-live', `sandbox seed 3, day ${day}: ${planned.map((p) => `${p.id} goal ${p.top}`).join(', ')}`);
  await finish(ctx, 'world (live)');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  if (!process.env.SHOTS_SKIP_BUILD) {
    console.log('[sim-02] building...');
    execSync(`npx vite build --outDir ${DIST} --emptyOutDir`, { cwd: ROOT, stdio: 'inherit' });
  }
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
    await captureBattle(browser, base);
    await captureAiYear(browser, base);
    await captureLive(browser, base);
  } catch (e) {
    check('run completed', false, String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
  } finally {
    if (browser) await browser.close();
    preview.kill('SIGTERM');
    fs.writeFileSync(path.join(OUT, 'shots-report.json'), JSON.stringify(report, null, 1));
  }
  console.log(`[sim-02] ${failed ? 'FAILED' : 'all checks passed'} -> ${path.relative(ROOT, OUT)}/`);
  process.exit(failed ? 1 : 0);
})();
