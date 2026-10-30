#!/usr/bin/env node
/**
 * GP-01 evidence captures (OWNER: Gameplay Engineer - Tactical Battle Simulation).
 *
 *   NODE_PATH=$(npm root -g) node scripts/shots/gp-01.cjs
 *
 * Env: SHOTS_PORT (default 4407), SHOTS_DIST (default .build/gp-01), SHOTS_SKIP_BUILD=1, SHOTS_OUT
 * (default docs/sprint1/gp-01). Builds into SHOTS_DIST (never the shared dist/), serves it with vite preview and
 * drives headless Chromium (SwiftShader, CLAUDE.md launch args) through window.__SAMRAJYA__.
 *
 * In-engine (the authoritative formation sim + soldier layer stepped with __SAMRAJYA__.step(n), then rendered):
 *   battle-melee.png            1,000-soldier skirmish on the open plain (AI vs AI), default camera, lines in melee
 *   battle-melee-close.png      the same tick, cursor-anchored wheel zoom onto the melee (soldier layer close up)
 *   battle-melee-overview.png   the same moment from the overview camera (650 m)
 *   battle-river-melee.png      the Ford (river_crossing) at the first clash, overview camera
 *   battle-result.png           the same plains battle stepped to its outcome (result screen)
 *   battle-mobile-melee.png     390x844 @low quality, default camera, mid-melee
 * Headless traces (tests/sim/tactical/tools/trace.ts via vite-node), drawn top-down on a canvas:
 *   tactical-plains.png         plains skirmish: terrain, trails (dashed = routing), footprints at peak melee,
 *                               contact / rout markers; soldiers and morale timelines; outcome
 *   tactical-river.png          the Ford: both hosts route through the shallow ford (never deep water)
 *   tactical-siege.png          scripted assault: elephants break the main gate, ram built, ladders on the east wall;
 *                               the garrison's melee blocks rout but its arrowless archers still stand on their own
 *                               walls and hold the field ([REQ GP-01] in DESIGN_SPEC 6.8 / 6.6.5), so the attacker
 *                               wins by holding the breach 60 s (siege_breach)
 *   traces.json                 the trace data behind the three maps
 *   shots-report.json           every assertion with its observed value (full runs only; --only=maps|engine skips it)
 * Every in-engine shot is checked for a blank 3D view (a WebGL canvas that presented nothing, so the page background
 * shows through - seen once under SwiftShader load, likely a dynamic-resolution resize right before freeze); a blank
 * shot is re-rendered and retaken up to 3 times, then fails the run instead of passing silently.
 * Exit 1 on any failed assertion, console error, page error, failed request, crash report or blank shot.
 */
'use strict';
const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.SHOTS_PORT || 4407);
const DIST = process.env.SHOTS_DIST || '.build/gp-01';
const OUT = path.resolve(ROOT, process.env.SHOTS_OUT || 'docs/sprint1/gp-01');
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
  console.log(`[gp-01] ${ok ? 'ok  ' : 'FAIL'} ${name}${observed !== undefined ? `  -> ${JSON.stringify(observed)}` : ''}`);
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

/**
 * Share of a screenshot taken by its single most common colour. A rendered battle frame measures <= 2.5 % (every
 * GP-01 evidence and smoke image: 1.0-2.3 %); a blank WebGL canvas with the dark page background showing through
 * measured 32.7 % at 390x844 (the HUD covers the rest). Decoded in the page with a 2D canvas (no npm dependencies).
 */
async function dominantColourShare(page, png) {
  return page.evaluate(async (b64) => {
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
    for (let i = 0; i < d.length; i += 4) {
      const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      const n = (counts.get(k) || 0) + 1;
      counts.set(k, n);
      if (n > best) best = n;
    }
    return best / (d.length / 4);
  }, png.toString('base64'));
}

/** Dominant-colour share at or above which a shot counts as a blank 3D view. */
const BLANK_SHARE = 0.15;

async function shot(page, name, note) {
  const file = path.join(OUT, `${name}.png`);
  let share = 1;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) {
      console.log(`[gp-01] ${name}: blank 3D view (dominant colour ${(share * 100).toFixed(1)} %), re-rendering and retaking (attempt ${attempt})`);
      // The battle is paused: frames re-render the same state (no sim step).
      await page.evaluate(() => window.__SAMRAJYA__.waitFrames(30)).catch(() => undefined);
    }
    await page.evaluate(() => window.__SAMRAJYA__ && window.__SAMRAJYA__.freeze(true)).catch(() => undefined);
    const png = await page.screenshot({ path: file, timeout: TIMEOUT });
    await page.evaluate(() => window.__SAMRAJYA__ && window.__SAMRAJYA__.freeze(false)).catch(() => undefined);
    share = await dominantColourShare(page, png);
    if (share < BLANK_SHARE) break;
  }
  check(`${name}: the 3D view rendered (not a blank canvas)`, share < BLANK_SHARE, { dominantColourShare: Number(share.toFixed(4)) });
  report.shots.push({ name: `${name}.png`, note });
  console.log(`[gp-01] shot ${name}.png  ${note}`);
}

async function finish(ctx, label) {
  const crash = await ctx.page.evaluate(() => (window.__SAMRAJYA__ ? window.__SAMRAJYA__.getErrors().map((r) => r.message) : [])).catch(() => []);
  check(`${label}: no console errors, page errors, failed requests or crash reports`, ctx.errors.length === 0 && crash.length === 0, [...ctx.errors, ...crash]);
  await ctx.context.close();
}

function battleInfo(page) {
  return page.evaluate(() => window.__SAMRAJYA__.getState().sceneState);
}

/** Step the paused battle in chunks until `pred(sceneState)` holds (or `maxTicks`). Returns the scene state. */
async function stepUntil(page, pred, maxTicks, chunk = 100) {
  let s = await battleInfo(page);
  for (let t = 0; t < maxTicks && !pred(s); t += chunk) {
    await page.evaluate((n) => window.__SAMRAJYA__.step(n), chunk);
    s = await battleInfo(page);
  }
  await page.evaluate(() => window.__SAMRAJYA__.waitFrames(3));
  return s;
}

const lost = (s) => s.sides.reduce((a, x) => a + (x.initial - x.soldiers), 0);
const total = (s) => s.sides.reduce((a, x) => a + x.initial, 0);
const fmt = (s) => `t=${s.time}s phase=${s.phase} soldiers ${s.sides.map((x) => `${x.soldiers}/${x.initial}`).join(' vs ')} morale ${s.sides.map((x) => x.morale).join('/')}${s.outcome ? ` outcome ${s.outcome.winner} ${s.outcome.reason}` : ''}`;

async function begin(page) {
  const err = await page.evaluate(() => window.__SAMRAJYA__.issueBattleCommand({ kind: 'begin_battle' }));
  return err;
}

/** Screen point (1280x720, default camera) where the plains seed-2 melee sits at the battle-melee tick. */
const CLOSE_ANCHOR = [600, 162];

async function capturePlains(browser, base) {
  // Default camera, then the overview of the same deterministic battle (same seed, same steps => same state hash).
  const runs = [
    ['battle-melee', '', 'default camera (165 m behind the player line)'],
    ['battle-melee-overview', '&camera=overview', 'overview camera (650 m)'],
  ];
  const hashes = [];
  for (const [name, cam, note] of runs) {
    const ctx = await newPage(browser, [1280, 720], false);
    const { page } = ctx;
    await page.goto(`${base}?scene=battle&preset=plains&seed=2&soldiers=1000&aivsai=1&paused=1&quality=high&noaudio=1${cam}`, { waitUntil: 'load', timeout: TIMEOUT });
    await waitReady(page);
    await begin(page);
    const s = await stepUntil(page, (x) => x.phase !== 'deployment' && lost(x) >= total(x) * 0.08, 6000);
    check(`${name}: the lines are in melee (>= 8% losses) - ${fmt(s)}`, lost(s) >= total(s) * 0.08 && !s.outcome, { tick: s.tick, lost: lost(s) });
    hashes.push(await page.evaluate(() => window.__SAMRAJYA__.hash()));
    await shot(page, name, `plains seed 2, 1,000 soldiers AI vs AI, ${note}: ${fmt(s)}`);
    if (!cam) {
      // Close-up: cursor-anchored wheel zoom onto the melee (same seed + ticks + start camera => same screen spot).
      await page.mouse.move(CLOSE_ANCHOR[0], CLOSE_ANCHOR[1]);
      let cs = await battleInfo(page);
      for (let i = 0; i < 16 && cs.camera.distance > 48; i++) {
        await page.mouse.wheel(0, -240);
        await page.evaluate(() => window.__SAMRAJYA__.waitFrames(8));
        cs = await battleInfo(page);
      }
      await page.evaluate(() => window.__SAMRAJYA__.waitFrames(30));
      cs = await battleInfo(page);
      check(`battle-melee-close: camera zoomed onto the melee (distance ${Math.round(cs.camera.distance)} m)`, cs.camera.distance < 80, cs.camera);
      await shot(page, 'battle-melee-close', `the same tick, wheel-zoomed onto the melee at ${Math.round(cs.camera.distance)} m: soldier layer in contact (attack / hit / die anims, gaps filled from behind)`);
      const r = await stepUntil(page, (x) => !!x.outcome, 12000, 200);
      check(`battle-result: the battle reaches an outcome - ${fmt(r)}`, !!r.outcome, r.outcome);
      await page.evaluate(() => window.__SAMRAJYA__.waitFrames(6));
      await shot(page, 'battle-result', `plains seed 2 stepped to the end: ${fmt(r)}`);
    }
    await finish(ctx, name);
  }
  check('in-engine plains battle is deterministic across page loads (same tick => same state hash)', hashes.length === 2 && hashes[0] === hashes[1], hashes);
}

async function captureRiver(browser, base) {
  const ctx = await newPage(browser, [1280, 720], false);
  const { page } = ctx;
  await page.goto(`${base}?scene=battle&preset=river_crossing&seed=11&soldiers=1000&aivsai=1&paused=1&quality=high&noaudio=1&camera=overview&hour=17`, { waitUntil: 'load', timeout: TIMEOUT });
  await waitReady(page);
  await begin(page);
  const s = await stepUntil(page, (x) => x.phase !== 'deployment' && lost(x) >= total(x) * 0.05, 6000);
  check(`battle-river-melee: first clash at the ford - ${fmt(s)}`, lost(s) >= total(s) * 0.05, { tick: s.tick, lost: lost(s) });
  await shot(page, 'battle-river-melee', `the Ford seed 11, 17:00, overview camera at the first clash: ${fmt(s)}`);
  await finish(ctx, 'battle-river-melee');
}

async function captureMobile(browser, base) {
  const ctx = await newPage(browser, [390, 844], true);
  const { page } = ctx;
  await page.goto(`${base}?scene=battle&preset=plains&seed=2&soldiers=1000&aivsai=1&paused=1&quality=low&noaudio=1`, { waitUntil: 'load', timeout: TIMEOUT });
  await waitReady(page);
  await begin(page);
  const s = await stepUntil(page, (x) => x.phase !== 'deployment' && lost(x) >= total(x) * 0.08, 6000);
  check(`battle-mobile-melee: melee at 390x844 low - ${fmt(s)}`, lost(s) >= total(s) * 0.08, { tick: s.tick });
  await shot(page, 'battle-mobile-melee', `390x844 @low, default camera, plains seed 2 mid-melee: ${fmt(s)}`);
  await finish(ctx, 'battle-mobile-melee');
}

// ---------------------------------------------------------------------------------------------------
// Top-down tactical maps from headless traces
// ---------------------------------------------------------------------------------------------------

const MAP_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#fcfcfb;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
canvas{display:block}
</style></head><body><canvas id="c" width="1280" height="800"></canvas></body></html>`;

/** Runs in the page: draws one trace. Colors: categorical slots 1-2 (validated), text ink, muted terrain. */
function drawTrace(t, title, subtitle) {
  const C = { surface: '#fcfcfb', ink: '#0b0b0b', ink2: '#52514e', muted: '#8a8984', grid: '#e7e6e2', side: ['#2a78d6', '#eb6834'], critical: '#e34948' };
  const TERRAIN = { open: '#eef0e5', road: '#dccfb8', farmland: '#f2ebd3', forest: '#cbdac3', hills: '#e3dac6', rough: '#ddd7cb', marsh: '#d3e0d5', shallow_water: '#bfdaee', deep_water: '#8fb6d9', urban: '#d8d2cc' };
  const ABBR = { spearmen: 'SP', archers: 'AR', elite_guards: 'EG', cavalry: 'CV', war_elephants: 'EL', scouts: 'SC', supply_train: 'SU', engineers: 'EN', chariots: 'CH' };
  const cv = document.getElementById('c');
  const g = cv.getContext('2d');
  g.fillStyle = C.surface;
  g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = C.ink;
  g.font = '600 18px system-ui, sans-serif';
  g.fillText(title, 16, 30);
  g.fillStyle = C.ink2;
  g.font = '13px system-ui, sans-serif';
  g.fillText(subtitle, 16, 52);

  // --- crop: everything that moved, plus the fort
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  // Formed troops only: routers running off the map would zoom the map out to nothing.
  for (const fr of t.frames) for (const f of fr.f) {
    if (f[5] <= 0 || f[7] === 7) continue;
    minX = Math.min(minX, f[0]); maxX = Math.max(maxX, f[0]); minZ = Math.min(minZ, f[1]); maxZ = Math.max(maxZ, f[1]);
  }
  if (t.fort) { minX = Math.min(minX, t.fort.cx - t.fort.r); maxX = Math.max(maxX, t.fort.cx + t.fort.r); minZ = Math.min(minZ, t.fort.cz - t.fort.r); maxZ = Math.max(maxZ, t.fort.cz + t.fort.r); }
  const pad = 60;
  const gx1 = t.grid.minX + t.grid.cols * t.grid.cell, gz1 = t.grid.minZ + t.grid.rows * t.grid.cell;
  const span = Math.min(Math.max(maxX - minX, maxZ - minZ) + pad * 2, gx1 - t.grid.minX, gz1 - t.grid.minZ);
  const cx0 = Math.min(Math.max((minX + maxX) / 2 - span / 2, t.grid.minX), gx1 - span);
  const cz0 = Math.min(Math.max((minZ + maxZ) / 2 - span / 2, t.grid.minZ), gz1 - span);
  const M = { x: 16, y: 68, size: 716 };
  const k = M.size / span;
  const sx = (x) => M.x + (x - cx0) * k;
  const sy = (z) => M.y + (z - cz0) * k;
  g.save();
  g.beginPath(); g.rect(M.x, M.y, M.size, M.size); g.clip();
  // terrain
  const gr = t.grid;
  for (let r = 0; r < gr.rows; r++) for (let c = 0; c < gr.cols; c++) {
    const x = gr.minX + c * gr.cell, z = gr.minZ + r * gr.cell;
    if (x + gr.cell < cx0 || z + gr.cell < cz0 || x > cx0 + span || z > cz0 + span) continue;
    g.fillStyle = TERRAIN[t.classes[gr.cls[r * gr.cols + c]]] || '#e9e9e4';
    g.fillRect(Math.floor(sx(x)), Math.floor(sy(z)), Math.ceil(gr.cell * k) + 1, Math.ceil(gr.cell * k) + 1);
  }
  // fort
  if (t.fort && t.siege) {
    const n = t.siege.segments.length;
    for (let i = 0; i < n; i++) {
      const s = t.siege.segments[i];
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      g.beginPath();
      for (let j = 0; j <= 16; j++) {
        const a = a0 + ((a1 - a0) * j) / 16;
        const px = sx(t.fort.cx + Math.sin(a) * t.fort.r), pz = sy(t.fort.cz + Math.cos(a) * t.fort.r);
        if (j === 0) g.moveTo(px, pz); else g.lineTo(px, pz);
      }
      g.lineWidth = 5; g.strokeStyle = s.hp > 0 ? '#5d5850' : C.critical; g.setLineDash(s.hp > 0 ? [] : [6, 4]); g.stroke(); g.setLineDash([]);
      if (s.ladder) {
        const a = (a0 + a1) / 2;
        for (let q = -2; q <= 2; q++) {
          const aa = a + q * 0.025;
          g.beginPath();
          g.moveTo(sx(t.fort.cx + Math.sin(aa) * (t.fort.r - 4)), sy(t.fort.cz + Math.cos(aa) * (t.fort.r - 4)));
          g.lineTo(sx(t.fort.cx + Math.sin(aa) * (t.fort.r + 9)), sy(t.fort.cz + Math.cos(aa) * (t.fort.r + 9)));
          g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke();
        }
        g.textAlign = 'right';
        label(sx(t.fort.cx + Math.sin(a) * (t.fort.r - 12)), sy(t.fort.cz + Math.cos(a) * (t.fort.r - 12)) + 4, 'ladders up', C.ink, '600 12px system-ui');
        g.textAlign = 'left';
      }
    }
    for (const gate of t.siege.gates) {
      const seg = gate.segment, a = ((seg + 0.5) / n) * Math.PI * 2;
      const px = sx(t.fort.cx + Math.sin(a) * t.fort.r), pz = sy(t.fort.cz + Math.cos(a) * t.fort.r);
      if (gate.hp > 0) { g.fillStyle = C.ink; g.fillRect(px - 5, pz - 5, 10, 10); label(px + 10, pz + 4, 'gate', C.ink2, '12px system-ui'); }
      else { g.strokeStyle = C.critical; g.lineWidth = 3; g.beginPath(); g.moveTo(px - 7, pz - 7); g.lineTo(px + 7, pz + 7); g.moveTo(px + 7, pz - 7); g.lineTo(px - 7, pz + 7); g.stroke(); label(px + 12, pz - 6, 'gate broken', C.ink, '600 12px system-ui'); }
    }
  }
  for (const w of t.works || []) {
    if (w.work === 'ram') { g.fillStyle = '#7a5a3a'; g.fillRect(sx(w.x) - 4, sy(w.z) - 4, 8, 8); label(sx(w.x) + 8, sy(w.z) + 16, w.formation >= 0 ? 'ram' : 'ram (abandoned)', C.ink, '12px system-ui'); }
  }
  // trails (dashed while routing)
  const nF = t.formations.length;
  for (let i = 0; i < nF; i++) {
    const side = t.formations[i].side;
    g.strokeStyle = C.side[side]; g.lineWidth = 2; g.globalAlpha = 0.55;
    let prev = null;
    for (const fr of t.frames) {
      const f = fr.f[i];
      if (f[5] <= 0) { prev = null; continue; }
      if (prev) {
        g.setLineDash(f[7] === 7 ? [4, 4] : []);
        g.beginPath(); g.moveTo(sx(prev[0]), sy(prev[1])); g.lineTo(sx(f[0]), sy(f[1])); g.stroke();
      }
      prev = f;
    }
    g.setLineDash([]); g.globalAlpha = 1;
  }
  // snapshot: the frame with the most soldiers in melee
  let snap = 0, best = -1;
  t.frames.forEach((fr, idx) => { const e = fr.f.reduce((a, f) => a + (f[7] === 2 ? f[5] : 0), 0); if (e > best) { best = e; snap = idx; } });
  const S = t.frames[snap];
  for (let i = 0; i < nF; i++) {
    const f = S.f[i];
    if (f[5] <= 0) continue;
    const side = t.formations[i].side;
    const th = f[2], w = Math.max(f[3], 3), d = Math.max(f[4], 3);
    const fx = Math.sin(th), fz = Math.cos(th), rx = Math.cos(th), rz = -Math.sin(th);
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [sx(f[0] + rx * a * w / 2 + fx * b * d / 2), sy(f[1] + rz * a * w / 2 + fz * b * d / 2)]);
    g.beginPath(); pts.forEach((p, j) => (j ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath();
    g.globalAlpha = f[7] === 7 ? 0.35 : 0.9; g.fillStyle = C.side[side]; g.fill(); g.globalAlpha = 1;
    g.lineWidth = 2; g.strokeStyle = C.surface; g.stroke();
    // front edge
    g.beginPath(); g.moveTo(pts[2][0], pts[2][1]); g.lineTo(pts[3][0], pts[3][1]); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke();
    const lx = sx(f[0] - fx * (d / 2 + 9)), lz = sy(f[1] - fz * (d / 2 + 9));
    label(lx, lz + 4, (ABBR[t.formations[i].cls] || '?') + (f[7] === 7 ? ' (routing)' : ''), C.ink, '600 11px system-ui', true);
  }
  // events
  for (const e of t.events) {
    if (e.x === undefined || e.x === null) continue;
    if (e.kind === 'contact') { g.strokeStyle = C.ink; g.lineWidth = 1.5; const px = sx(e.x), pz = sy(e.z); g.beginPath(); g.moveTo(px - 4, pz - 4); g.lineTo(px + 4, pz + 4); g.moveTo(px + 4, pz - 4); g.lineTo(px - 4, pz + 4); g.stroke(); }
    if (e.kind === 'formation_routed' && e.formation !== null) { g.strokeStyle = C.side[t.formations[e.formation].side]; g.lineWidth = 2; g.beginPath(); g.arc(sx(e.x), sy(e.z), 6, 0, Math.PI * 2); g.stroke(); }
  }
  g.restore();
  g.strokeStyle = C.grid; g.lineWidth = 1; g.strokeRect(M.x + 0.5, M.y + 0.5, M.size - 1, M.size - 1);
  // scale bar + north
  const bar = 100 * k;
  g.fillStyle = C.ink; g.fillRect(M.x + 14, M.y + M.size - 20, bar, 3);
  label(M.x + 14, M.y + M.size - 26, '100 m', C.ink, '12px system-ui', true);
  label(M.x + M.size - 26, M.y + 22, 'N ↑', C.ink, '600 12px system-ui', true);
  label(M.x + 10, M.y + 18, `Formations at ${mmss(S.t)} (most soldiers in melee)`, C.ink, '600 12px system-ui', true);

  // --- right column: legend, two charts, outcome
  const R = { x: 760, w: 504 };
  let y = 80;
  g.font = '600 13px system-ui'; g.fillStyle = C.ink; g.fillText('Legend', R.x, y); y += 8;
  const items = [
    ['swatch', C.side[0], t.factionNames[0] + ' (side 0)'], ['swatch', C.side[1], t.factionNames[1] + ' (side 1)'],
    ['line', C.ink2, 'trail every 2 s; dashed = routing'], ['x', C.ink, 'melee contact'], ['ring', C.ink2, 'formation routed (side colour)'],
    ['front', C.ink, 'front edge of a formation'],
  ];
  items.forEach((it, j) => {
    const col = j % 2, row = Math.floor(j / 2);
    const ix = R.x + col * 252, iy = y + 14 + row * 22;
    if (it[0] === 'swatch') { g.fillStyle = it[1]; g.fillRect(ix, iy - 9, 14, 10); }
    if (it[0] === 'line') { g.strokeStyle = it[1]; g.lineWidth = 2; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(ix, iy - 4); g.lineTo(ix + 16, iy - 4); g.stroke(); g.setLineDash([]); }
    if (it[0] === 'x') { g.strokeStyle = it[1]; g.lineWidth = 1.5; g.beginPath(); g.moveTo(ix + 3, iy - 8); g.lineTo(ix + 11, iy); g.moveTo(ix + 11, iy - 8); g.lineTo(ix + 3, iy); g.stroke(); }
    if (it[0] === 'ring') { g.strokeStyle = it[1]; g.lineWidth = 2; g.beginPath(); g.arc(ix + 7, iy - 4, 6, 0, Math.PI * 2); g.stroke(); }
    if (it[0] === 'front') { g.fillStyle = C.side[0]; g.fillRect(ix, iy - 10, 16, 8); g.fillStyle = it[1]; g.fillRect(ix, iy - 2, 16, 2); }
    g.fillStyle = C.ink2; g.font = '12px system-ui'; g.fillText(it[2], ix + 22, iy);
  });
  y += 14 + 3 * 22 + 6;
  g.fillStyle = C.ink2; g.font = '11px system-ui';
  g.fillText('SP spearmen  AR archers  EG elite guards  CV cavalry  EL war elephants', R.x, y);
  g.fillText('SC scouts  SU supply train  EN engineers  CH chariots', R.x, y + 15);
  y += 36;
  const T = t.frames[t.frames.length - 1].t;
  const maxS = Math.max(t.frames[0].sides[0], t.frames[0].sides[1], 1);
  y = chart(R.x, y, R.w, 190, 'Soldiers standing', 0, Math.ceil(maxS / 100) * 100, (fr, s) => fr.sides[s], T, null);
  y = chart(R.x, y + 16, R.w, 190, 'Average morale (0-100)', 0, 100, (fr, s) => fr.sides[2 + s], T, t.wavering);
  // outcome
  y += 26;
  g.fillStyle = C.ink; g.font = '600 13px system-ui';
  const o = t.outcome;
  const wName = o ? (o.winner === null ? 'Draw' : t.factionNames[o.winner]) : 'No outcome';
  g.fillText(o ? `Outcome: ${wName} - ${o.reason.replace('_', ' ')} after ${mmss(o.durationSec)} of battle` : 'No outcome', R.x, y);
  if (o) {
    g.font = '12px system-ui'; g.fillStyle = C.ink2;
    o.sides.forEach((sd, s) => {
      y += 18;
      g.fillText(`${t.factionNames[s]}: ${sd.startSoldiers} -> ${sd.survivors} standing (${sd.killed} killed, ${sd.captured} captured,`, R.x, y);
      y += 16;
      g.fillText(`    ${sd.pursuitLosses} lost in the pursuit), ${sd.routs} formation routs, commander ${sd.commanderFate}`, R.x, y);
    });
    y += 18;
    g.fillText(`${t.volleys} volleys loosed; ${t.events.filter((e) => e.kind === 'contact').length} melee contacts, ${t.events.filter((e) => e.kind === 'formation_routed').length} routs, ${t.events.filter((e) => e.kind === 'formation_rallied').length} rallies.`, R.x, y);
  }

  function mmss(sec) { const m = Math.floor(sec / 60), s = Math.round(sec - m * 60); return `${m}:${String(s).padStart(2, '0')}`; }
  function label(x, y2, text, color, font, halo) {
    g.font = font; g.textBaseline = 'alphabetic';
    if (halo !== false) { g.lineWidth = 3; g.strokeStyle = 'rgba(252,252,251,0.9)'; g.strokeText(text, x, y2); }
    g.fillStyle = color; g.fillText(text, x, y2);
  }
  function chart(x, y0, w, h, name, lo, hi, val, tMax, ref) {
    g.fillStyle = C.ink; g.font = '600 13px system-ui'; g.fillText(name, x, y0 + 4);
    const P = { x: x + 40, y: y0 + 16, w: w - 40 - 120, h: h - 40 };
    g.font = '11px system-ui';
    for (let q = 0; q <= 4; q++) {
      const v = lo + ((hi - lo) * q) / 4, py = P.y + P.h - (P.h * q) / 4;
      g.strokeStyle = C.grid; g.lineWidth = 1; g.beginPath(); g.moveTo(P.x, py + 0.5); g.lineTo(P.x + P.w, py + 0.5); g.stroke();
      g.fillStyle = C.ink2; g.textAlign = 'right'; g.fillText(String(Math.round(v)), P.x - 6, py + 4); g.textAlign = 'left';
    }
    const ticks = Math.max(1, Math.ceil(tMax / 60));
    for (let m = 0; m <= ticks; m++) {
      const px = P.x + (P.w * m * 60) / Math.max(60, ticks * 60);
      g.fillStyle = C.ink2; g.textAlign = 'center'; g.fillText(`${m}:00`, px, P.y + P.h + 16); g.textAlign = 'left';
    }
    const X = (tt) => P.x + (P.w * tt) / Math.max(60, ticks * 60);
    const Y = (v) => P.y + P.h - (P.h * (v - lo)) / (hi - lo);
    if (ref !== null) {
      g.strokeStyle = C.muted; g.lineWidth = 1; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(P.x, Y(ref)); g.lineTo(P.x + P.w, Y(ref)); g.stroke(); g.setLineDash([]);
      g.fillStyle = C.ink2; g.fillText(`wavering < ${ref}`, P.x + 4, Y(ref) - 4);
    }
    const ends = [];
    for (let s = 0; s < 2; s++) {
      g.strokeStyle = C.side[s]; g.lineWidth = 2; g.beginPath();
      t.frames.forEach((fr, j) => { const px = X(Math.max(0, fr.t)), py = Y(val(fr, s)); if (j) g.lineTo(px, py); else g.moveTo(px, py); });
      g.stroke();
      const last = t.frames[t.frames.length - 1];
      ends.push({ s, x: X(Math.max(0, last.t)), y: Y(val(last, s)), v: val(last, s) });
    }
    // direct labels at line ends (nudged apart)
    ends.sort((a, b) => a.y - b.y);
    if (ends.length === 2 && ends[1].y - ends[0].y < 16) { const m = (ends[0].y + ends[1].y) / 2; ends[0].y = m - 8; ends[1].y = m + 8; }
    for (const e of ends) {
      g.fillStyle = C.side[e.s]; g.beginPath(); g.arc(e.x, e.y, 4, 0, Math.PI * 2); g.fill();
      g.fillStyle = C.ink; g.font = '12px system-ui'; g.fillText(`${t.factionNames[e.s].split(' ')[0]} ${Math.round(e.v)}`, e.x + 8, e.y + 4);
    }
    return y0 + h;
  }
}

async function captureMaps(browser) {
  const tracePath = path.join(OUT, 'traces.json');
  console.log('[gp-01] generating headless traces (vite-node tests/sim/tactical/tools/trace.ts)');
  execSync(`"${path.join(ROOT, 'node_modules', '.bin', 'vite-node')}" tests/sim/tactical/tools/trace.ts "${tracePath}"`, { cwd: ROOT, stdio: 'inherit' });
  const traces = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
  // River: never in deep water.
  const river = traces.river;
  const deepIdx = river.classes.indexOf('deep_water');
  let deepTicks = 0;
  for (const fr of river.frames) for (const f of fr.f) {
    if (f[5] <= 0) continue;
    const c = Math.floor((f[0] - river.grid.minX) / river.grid.cell), r = Math.floor((f[1] - river.grid.minZ) / river.grid.cell);
    if (c >= 0 && r >= 0 && c < river.grid.cols && r < river.grid.rows && river.grid.cls[r * river.grid.cols + c] === deepIdx) deepTicks++;
  }
  check('tactical-river: no formation centroid sampled in a deep-water cell', deepTicks === 0, deepTicks);
  for (const [key, o] of Object.entries({ plains: traces.plains, river: traces.river })) {
    const m = o.outcome ? o.outcome.durationSec / 60 : 0;
    check(`tactical-${key}: the 1,000-soldier skirmish ends in 3-8 min (or near it)`, !!o.outcome && m >= 2.5 && m <= 8, o.outcome && { winner: o.outcome.winner, reason: o.outcome.reason, minutes: Math.round(m * 100) / 100 });
  }
  const sg = traces.siege;
  // §6.6.5 + §6.8 [REQ GP-01]: the garrison's arrowless archers standing on their own walls (inside the ring within
  // WALL_WALK_DEPTH = 15 m of the radius) still hold the field after its melee blocks rout, so the attacker has to
  // take the town by holding the breach 60 s (siege_breach), not by a rout of the garrison.
  const def = sg.fort && typeof sg.fort.defenderSide === 'number' ? sg.fort.defenderSide : 1;
  const atk = 1 - def;
  const last = sg.frames[sg.frames.length - 1];
  const dry = new Set(sg.events.filter((e) => e.kind === 'ammo_depleted' && e.side === def).map((e) => e.formation));
  const wallArchers = sg.formations.filter((f) => {
    if (f.side !== def || !dry.has(f.index)) return false;
    const x = last.f[f.index];
    const r = Math.hypot(x[0] - sg.fort.cx, x[1] - sg.fort.cz);
    return x[5] > 0 && x[7] !== 7 && r <= sg.fort.r && r >= sg.fort.r - 15;
  });
  const meleeRouted = sg.formations.filter((f) => f.side === def && f.cls !== 'archers').every((f) => last.f[f.index][5] <= 0 || last.f[f.index][7] === 7);
  check(
    "tactical-siege: the main gate is broken, a ladder is up, the garrison's melee has routed but its dry archers still stand on their walls, and the attacker wins by holding the breach (siege_breach)",
    sg.siege.gates.some((x) => x.hp <= 0) && sg.siege.segments.some((x) => x.ladder) && meleeRouted && wallArchers.length > 0 && sg.outcome && sg.outcome.winner === atk && sg.outcome.reason === 'siege_breach',
    { gates: sg.siege.gates.map((x) => Math.round(x.hp)), ladders: sg.siege.segments.map((x, i) => (x.ladder ? i : -1)).filter((i) => i >= 0), meleeRouted, dryWallArchers: wallArchers.map((f) => `${f.index}:${last.f[f.index][5]}`), winner: sg.outcome && sg.outcome.winner, outcome: sg.outcome && sg.outcome.reason, minutes: sg.outcome && Math.round((sg.outcome.durationSec / 60) * 100) / 100 },
  );

  const ctx = await newPage(browser, [1280, 800], false);
  const { page } = ctx;
  await page.setContent(MAP_HTML);
  const maps = [
    ['tactical-plains', traces.plains, 'The Open Plain - 1,000-soldier balanced skirmish, AI vs AI (seed 2)', 'Headless authoritative formation sim (20 Hz). Trails every 2 s; footprints at the moment the most soldiers are in melee.'],
    ['tactical-river', traces.river, 'The Ford - 1,000 soldiers, AI vs AI (seed 11, 17:00)', 'Flow-field pathing: both hosts route through the shallow ford; no formation enters deep water.'],
    ['tactical-siege', traces.siege, 'Siege assault - town walls (level 2), ram, ladders, elephants (scripted orders, seed 77)', 'Elephants batter the main gate open while the ram is still being built; ladders go up on the east wall; the garrison melee routs, its dry wall archers hold the walls until the breach is held 60 s.'],
  ];
  for (const [name, t, title, sub] of maps) {
    await page.evaluate(`(${drawTrace.toString()})(${JSON.stringify(t)}, ${JSON.stringify(title)}, ${JSON.stringify(sub)})`);
    await page.locator('#c').screenshot({ path: path.join(OUT, `${name}.png`), timeout: TIMEOUT });
    report.shots.push({ name: `${name}.png`, note: title });
    console.log(`[gp-01] shot ${name}.png  ${title}`);
  }
  await finish(ctx, 'tactical maps');
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
  const want = (k) => only.length === 0 || only.includes(k);
  if (!process.env.SHOTS_SKIP_BUILD && (want('engine') || only.length === 0)) {
    console.log(`[gp-01] building into ${DIST}`);
    execSync(`"${process.execPath}" "${path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')}" build --outDir "${DIST}" --emptyOutDir`, { cwd: ROOT, stdio: 'inherit' });
  }
  const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const server = want('engine') ? spawn(process.execPath, [viteBin, 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }) : null;
  const base = `http://127.0.0.1:${PORT}/`;
  const { chromium } = requirePlaywright();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
    if (want('maps')) await captureMaps(browser);
    if (want('engine')) {
      await waitForServer(base, 30000);
      await capturePlains(browser, base);
      await captureRiver(browser, base);
      await captureMobile(browser, base);
    }
  } catch (err) {
    check('script ran to completion', false, String(err && err.stack ? err.stack : err));
  } finally {
    if (browser) await browser.close();
    if (server) {
      server.kill('SIGTERM');
      server.stdout.destroy();
      server.stderr.destroy();
    }
  }
  // A partial run (--only=...) does not overwrite the full report.
  if (only.length === 0) fs.writeFileSync(path.join(OUT, 'shots-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(failed ? '[gp-01] FAILED' : `[gp-01] all ${report.checks.length} checks passed -> ${path.relative(ROOT, OUT)}/`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
