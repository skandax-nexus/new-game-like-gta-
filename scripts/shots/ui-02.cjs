#!/usr/bin/env node
/**
 * UI-02 evidence captures (OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input).
 *
 *   NODE_PATH=$(npm root -g) node scripts/shots/ui-02.cjs [--only=world,battle,hero,assetsoff] [--vp=pc,portrait,landscape]
 *
 * Env: SHOTS_PORT (default 4415), SHOTS_DIST (default .build/ui-02), SHOTS_SKIP_BUILD=1, SHOTS_OUT
 * (default docs/sprint1/ui-02). Builds into SHOTS_DIST (never the shared dist/), serves it with vite preview and
 * drives headless Chromium (SwiftShader) through window.__SAMRAJYA__ (scenes, sim stepping) and
 * window.__SAMRAJYA_UI__ (src/ui/services/uiDebug.service.ts: bus events, input actions, screen patches).
 *
 * Every capture is taken at 1280x720 (pc), 390x844 (portrait phone) and 844x390 (landscape phone):
 *   world-settlement-economy / world-settlement-recruit   world HUD, capital selected, command card Economy / Recruit tab
 *   settlement-panel, army-panel                          drawers (bottom sheets on phones)
 *   build-placement                                       placement HUD (props pushed by this script until GP-03 drives it)
 *   market, age-panel, economy-panel, diplomacy           AoE / realm screens (diplomacy: AI reply reasons)
 *   event-modal, engagement-prompt                        real prompts reached by stepping the campaign
 *   minimap-world                                         the minimap element (phones: expanded)
 *   battle-deployment, battle-live, battle-radial         battle HUD: deployment bar; in battle (cards strip, rally ring,
 *                                                         floating cards); radial wheel open (all viewports)
 *   battle-intents                                        Intents page of the battle card (keyboard reachable via Tab)
 *   minimap-battle, battle-results                        minimap element; results of a battle stepped to its end
 *   hero-explore, hero-combat                             hero HUD (v2 props patched until GP-02 pushes them)
 * Checks (exit 1 on failure): no console / page errors, no failed requests or crash reports; text contrast measured
 * on the captured pixels (>= 4.5:1 body, >= 3:1 large text, disabled controls exempt); every interactive element
 * >= 44x44 CSS px on phone captures; UI + input CPU per frame (profiler counters uiInput.ms) printed for world and
 * battle at 1280x720 (< 1 ms). shots-report.json lists every check with its observed values.
 */
'use strict';
const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.SHOTS_PORT || 4415);
const DIST = process.env.SHOTS_DIST || '.build/ui-02';
const OUT = path.resolve(ROOT, process.env.SHOTS_OUT || 'docs/sprint1/ui-02');
const TIMEOUT = 300000;
const LAUNCH_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)=?(.*)$/.exec(a);
    return m ? [m[1], m[2] || '1'] : [a, '1'];
  }),
);
const ONLY = argv.only ? new Set(argv.only.split(',')) : null;
const VIEWPORTS = {
  pc: { size: [1280, 720], mobile: false, quality: 'medium' },
  portrait: { size: [390, 844], mobile: true, quality: 'low' },
  landscape: { size: [844, 390], mobile: true, quality: 'low' },
};
const VPS = argv.vp ? argv.vp.split(',') : Object.keys(VIEWPORTS);

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

const report = { port: PORT, dist: DIST, checks: [], shots: [], audits: [], profile: {} };
let failed = false;
function check(name, ok, observed) {
  report.checks.push({ name, ok: !!ok, observed });
  console.log(`[ui-02] ${ok ? 'ok  ' : 'FAIL'} ${name}${observed !== undefined ? `  -> ${JSON.stringify(observed).slice(0, 600)}` : ''}`);
  if (!ok) failed = true;
}

// ------------------------------------------------------------------------------------------------ PNG + contrast

/** Minimal PNG decoder (8-bit RGB / RGBA, non-interlaced: what Chromium screenshots are). */
function decodePng(buf) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
      if (data[8] !== 8 || data[12] !== 0) throw new Error('unsupported PNG');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!bpp) throw new Error(`unsupported PNG colour type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const px = Buffer.alloc(width * height * 3);
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    raw.copy(cur, 0, y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = cur[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      px[(y * width + x) * 3] = cur[x * bpp];
      px[(y * width + x) * 3 + 1] = cur[x * bpp + 1];
      px[(y * width + x) * 3 + 2] = cur[x * bpp + 2];
    }
    cur.copy(prev);
  }
  return { width, height, px };
}

const lin = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
function parseColor(s) {
  const m = /rgba?\(([^)]+)\)/.exec(s);
  if (!m) return null;
  const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}

/**
 * Text contrast measured on the screenshot: for each visible text run, the pixels of its box that are far from the
 * text colour are the background; the ratio is text colour vs the median background (text alpha / opacity blended).
 */
function contrastAudit(img, items) {
  const fails = [];
  let checked = 0;
  for (const it of items) {
    if (it.disabled) continue;
    const t = parseColor(it.color);
    if (!t) continue;
    const x0 = Math.max(0, Math.floor(it.x));
    const y0 = Math.max(0, Math.floor(it.y));
    const x1 = Math.min(img.width, Math.ceil(it.x + it.w));
    const y1 = Math.min(img.height, Math.ceil(it.y + it.h));
    if (x1 - x0 < 2 || y1 - y0 < 4) continue;
    const step = (x1 - x0) * (y1 - y0) > 6000 ? 2 : 1;
    const samples = [];
    let maxD = 0;
    for (let y = y0; y < y1; y += step)
      for (let x = x0; x < x1; x += step) {
        const i = (y * img.width + x) * 3;
        const d = Math.hypot(img.px[i] - t.r, img.px[i + 1] - t.g, img.px[i + 2] - t.b);
        samples.push([img.px[i], img.px[i + 1], img.px[i + 2], d]);
        if (d > maxD) maxD = d;
      }
    const bg = samples.filter((s) => s[3] >= maxD * 0.6);
    if (!bg.length) continue;
    const med = (k) => {
      const v = bg.map((s) => s[k]).sort((a, b) => a - b);
      return v[v.length >> 1];
    };
    const B = { r: med(0), g: med(1), b: med(2) };
    const a = Math.max(0, Math.min(1, t.a * it.opacity));
    const T = { r: t.r * a + B.r * (1 - a), g: t.g * a + B.g * (1 - a), b: t.b * a + B.b * (1 - a) };
    const cr = ratio(lum(T.r, T.g, T.b), lum(B.r, B.g, B.b));
    const large = it.fontSize >= 24 || (it.fontSize >= 18.66 && it.weight >= 700);
    const need = large ? 3 : 4.5;
    checked++;
    if (cr + 1e-6 < need) fails.push({ text: it.text, ratio: Math.round(cr * 100) / 100, need, fontSize: it.fontSize, color: it.color, bg: `rgb(${B.r},${B.g},${B.b})`, cls: it.cls, at: [Math.round(it.x), Math.round(it.y)] });
  }
  return { checked, fails };
}

/** In-page collectors: text runs (for contrast) and interactive elements (touch size). */
function collectUi() {
  const root = document.getElementById('ui-root') || document.body;
  const vw = innerWidth;
  const vh = innerHeight;
  // With a modal open, the layers below sit under its backdrop (dimmed, not interactive): audit the modal and above.
  const modalOpen = !!document.querySelector('.ui-layer-modal.has-modal');
  // Covered by another UI element (a bottom sheet over the HUD card): not seen, not tappable. The 3D canvas behind
  // pass-through layers does not count as cover.
  const covered = (el, x, y) => {
    const hit = document.elementFromPoint(x, y);
    return !!hit && root.contains(hit) && hit !== el && !el.contains(hit) && !hit.contains(el);
  };
  const visible = (el) => {
    if (el.closest('.ui-hidden, [hidden]')) return false;
    if (modalOpen && !el.closest('.ui-layer-modal, .ui-layer-toast, .ui-layer-tooltip')) return false;
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    }
    return true;
  };
  const opacityOf = (el) => {
    let op = 1;
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
    return op;
  };
  const texts = [];
  const seen = new Set();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = walker.currentNode;
    if (!t.nodeValue || !t.nodeValue.trim()) continue;
    const el = t.parentElement;
    if (!el || seen.has(el) || !visible(el)) continue;
    seen.add(el);
    const r = document.createRange();
    r.selectNodeContents(t);
    const tr = r.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    let x0 = Math.max(tr.left, er.left, 0);
    let y0 = Math.max(tr.top, er.top, 0);
    let x1 = Math.min(tr.right, er.right, vw);
    let y1 = Math.min(tr.bottom, er.bottom, vh);
    // Intersect with every clipping ancestor (scrolling panel bodies, the cards strip); text inside a masked fade
    // (compass strip edges) is intentionally faded and exempt.
    let masked = false;
    for (let e = el.parentElement; e && e !== root; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.overflowY !== 'visible' || cs.overflowX !== 'visible') {
        const pr = e.getBoundingClientRect();
        x0 = Math.max(x0, pr.left);
        y0 = Math.max(y0, pr.top);
        x1 = Math.min(x1, pr.right);
        y1 = Math.min(y1, pr.bottom);
      }
      const mask = cs.maskImage || cs.webkitMaskImage || 'none';
      if (mask && mask !== 'none') {
        const pr = e.getBoundingClientRect();
        const cx = (x0 + x1) / 2;
        if (cx < pr.left + pr.width * 0.2 || cx > pr.right - pr.width * 0.2) masked = true;
      }
    }
    if (masked || x1 - x0 < 6 || y1 - y0 < 4) continue;
    if (covered(el, (x0 + x1) / 2, (y0 + y1) / 2)) continue;
    const cs = getComputedStyle(el);
    texts.push({
      text: t.nodeValue.trim().slice(0, 48),
      x: x0,
      y: y0,
      w: x1 - x0,
      h: y1 - y0,
      color: cs.color,
      fontSize: parseFloat(cs.fontSize) * (er.height && el.offsetHeight ? er.height / el.offsetHeight : 1),
      weight: Number(cs.fontWeight) || 400,
      opacity: opacityOf(el),
      disabled: !!el.closest('button:disabled, [aria-disabled="true"], .disabled, input:disabled'),
      cls: String(el.className || el.tagName).slice(0, 60),
    });
  }
  const targets = [];
  for (const el of root.querySelectorAll('button, [role=button], [role=radio], [role=tab], a[href], input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])')) {
    if (!visible(el) || el.closest('.ui-layer-tooltip')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) continue;
    const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2));
    const cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
    if (covered(el, cx, cy)) continue;
    targets.push({ w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, label: (el.getAttribute('aria-label') || el.textContent || el.className || el.tagName).trim().slice(0, 40), cls: String(el.className).slice(0, 60), at: [Math.round(r.left), Math.round(r.top)] });
  }
  return { texts, targets };
}

// ------------------------------------------------------------------------------------------------ page helpers

async function newPage(browser, vpName) {
  const vp = VIEWPORTS[vpName];
  const context = await browser.newContext({ viewport: { width: vp.size[0], height: vp.size[1] }, deviceScaleFactor: 1, isMobile: vp.mobile, hasTouch: vp.mobile });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`));
  return { context, page, errors, vpName, vp };
}

async function open(s, base, query) {
  await s.page.goto(`${base}?${query}&quality=${s.vp.quality}&noaudio=1`, { waitUntil: 'load', timeout: TIMEOUT });
  await s.page.waitForFunction('window.__SAMRAJYA__ && window.__SAMRAJYA__.ready && window.__SAMRAJYA__.sceneReady && window.__SAMRAJYA_UI__', null, { timeout: TIMEOUT, polling: 250 });
  await frames(s, 4);
}

const frames = (s, n) => s.page.evaluate((k) => window.__SAMRAJYA__.waitFrames(k), n);
const ev = (s, fn, arg) => s.page.evaluate(fn, arg);
async function settle(s, ms = 450) {
  await s.page.waitForTimeout(ms);
  await frames(s, 3);
}

/** Screenshot + contrast / touch audit. */
async function shot(s, name, note) {
  await settle(s, 350);
  const file = path.join(OUT, `${name}-${s.vpName}.png`);
  await s.page.evaluate(() => window.__SAMRAJYA__.freeze(true)).catch(() => undefined);
  const buf = await s.page.screenshot({ path: file, timeout: TIMEOUT });
  const ui = await s.page.evaluate(collectUi);
  await s.page.evaluate(() => window.__SAMRAJYA__.freeze(false)).catch(() => undefined);
  const img = decodePng(buf);
  const contrast = contrastAudit(img, ui.texts);
  const small = s.vp.mobile ? ui.targets.filter((t) => t.w < 43.5 || t.h < 43.5) : [];
  const audit = { shot: `${name}-${s.vpName}.png`, texts: contrast.checked, contrastFails: contrast.fails, targets: ui.targets.length, smallTargets: small };
  report.audits.push(audit);
  report.shots.push({ name: `${name}-${s.vpName}.png`, note });
  console.log(`[ui-02] shot ${name}-${s.vpName}.png  ${note}  (texts ${contrast.checked}, contrast fails ${contrast.fails.length}${s.vp.mobile ? `, targets ${ui.targets.length}, < 44 px ${small.length}` : ''})`);
  for (const f of contrast.fails.slice(0, 8)) console.log(`         contrast ${f.ratio} < ${f.need}: "${f.text}" ${f.color} on ${f.bg} (${f.cls})`);
  for (const t of small.slice(0, 8)) console.log(`         target ${t.w}x${t.h}: "${t.label}" (${t.cls})`);
  return audit;
}

async function elementShot(s, selector, name, note) {
  await settle(s, 300);
  const loc = s.page.locator(selector).first();
  const file = path.join(OUT, `${name}-${s.vpName}.png`);
  await s.page.evaluate(() => window.__SAMRAJYA__.freeze(true)).catch(() => undefined);
  await loc.screenshot({ path: file, timeout: TIMEOUT });
  await s.page.evaluate(() => window.__SAMRAJYA__.freeze(false)).catch(() => undefined);
  report.shots.push({ name: `${name}-${s.vpName}.png`, note });
  console.log(`[ui-02] shot ${name}-${s.vpName}.png  ${note}`);
}

/** Taps / clicks on open map areas reach the game (no transparent HUD container swallowing them). */
async function passThrough(s, label, points) {
  const hits = await ev(s, (pts) => {
    const root = document.getElementById('ui-root') || document.body;
    return pts.map(([fx, fy]) => {
      const hit = document.elementFromPoint(innerWidth * fx, innerHeight * fy);
      return { at: [fx, fy], ui: !!hit && root.contains(hit), el: hit ? `${hit.tagName}.${String(hit.className).slice(0, 40)}` : null };
    });
  }, points);
  check(`${label} (${s.vpName}): open map areas pass pointer events through to the game`, hits.every((h) => !h.ui), hits.filter((h) => h.ui));
}

async function finish(s, label) {
  const crash = await s.page.evaluate(() => (window.__SAMRAJYA__ ? window.__SAMRAJYA__.getErrors().map((r) => r.message) : [])).catch(() => []);
  check(`${label} (${s.vpName}): no console errors, page errors, failed requests or crash reports`, s.errors.length === 0 && crash.length === 0, [...s.errors, ...crash].slice(0, 10));
  await s.context.close();
}

async function click(s, selector, textRe) {
  const ok = await s.page.evaluate(
    ([sel, re]) => {
      const els = [...document.querySelectorAll(sel)].filter((e) => !e.closest('.ui-hidden'));
      const el = re ? els.find((e) => new RegExp(re, 'i').test(e.textContent || e.getAttribute('aria-label') || '')) : els[0];
      if (!el) return false;
      el.click();
      return true;
    },
    [selector, textRe ? textRe.source : null],
  );
  if (!ok) throw new Error(`nothing to click: ${selector} ${textRe || ''}`);
  await settle(s, 250);
}

const closeAll = (s, ids) => ev(s, (list) => list.forEach((id) => window.__SAMRAJYA__.hideScreen(id)), ids);

async function step(s, fn, label) {
  try {
    await fn();
  } catch (err) {
    check(`${label} (${s.vpName})`, false, String(err && err.message ? err.message : err).slice(0, 300));
  }
}

/**
 * UI + input CPU per frame. (1) bench: a virtual 60 fps timeline (src/ui/services/uiDebug.service.ts) at 1x and 4x
 * game speed - the number a player pays; (2) live: the profiler EMA counters over `n` real frames under SwiftShader,
 * where every ~1 s frame carries a full HUD refresh (printed for transparency, not a budget).
 */
/** Answer a blocking prompt like a player (first available event choice, generals decide) and let the scene see it. */
async function dismissPrompts(s) {
  const clicked = await ev(s, () => {
    const u = window.__SAMRAJYA_UI__;
    if (u.visible('engagement_prompt')) {
      const b = [...document.querySelectorAll('.engagement button')].find((x) => /generals/i.test(x.textContent || ''));
      if (b) return b.click(), true;
    }
    if (u.visible('event_modal')) {
      const b = document.querySelector('.event-choice:not(.disabled)');
      if (b) return b.click(), true;
    }
    return false;
  });
  if (clicked) {
    await frames(s, 3);
    await ev(s, () => window.__SAMRAJYA__.pause());
  }
  return clicked;
}

/** Bench in 2 s chunks; prompts are answered between chunks so the world keeps simulating (a blocked world is free). */
async function benchChunks(s, speed, chunks = 5) {
  const parts = [];
  for (let i = 0; i < chunks; i++) {
    await dismissPrompts(s);
    parts.push(await ev(s, (sp) => window.__SAMRAJYA_UI__.bench({ seconds: 2, speed: sp }), speed));
  }
  const frames = parts.reduce((a, p) => a + p.frames, 0);
  const r3 = (v) => Math.round(v * 1000) / 1000;
  return {
    screen: parts[0].screen,
    speed,
    frames,
    updates: parts.reduce((a, p) => a + p.updates, 0),
    steps: parts.reduce((a, p) => a + p.steps, 0),
    avgMs: r3(parts.reduce((a, p) => a + p.avgMs * p.frames, 0) / frames),
    p95Ms: Math.max(...parts.map((p) => p.p95Ms)),
    maxMs: Math.max(...parts.map((p) => p.maxMs)),
  };
}

async function profileUi(s, key, n = 30) {
  const b1 = await benchChunks(s, 1);
  const b4 = await benchChunks(s, 4);
  await ev(s, () => window.__SAMRAJYA__.resume());
  await frames(s, n);
  const live = await ev(s, () => window.__SAMRAJYA_UI__.profile());
  await ev(s, () => window.__SAMRAJYA__.pause());
  report.profile[key] = { bench1x: b1, bench4x: b4, liveSwiftShader: live };
  console.log(`[ui-02] profiler ${key}: 60 fps bench 1x avg ${b1.avgMs} ms (p95 ${b1.p95Ms}, max ${b1.maxMs}, ${b1.updates} HUD updates, ${b1.steps} sim steps); 4x avg ${b4.avgMs} ms (p95 ${b4.p95Ms}, max ${b4.maxMs})`);
  console.log(`[ui-02] profiler ${key}: live SwiftShader EMA ui ${live.ui} + input ${live.input} = ${live.total} ms/frame (a HUD refresh in every ~1 s frame)`);
  check(`profiler ${key}: UI + input < 1 ms/frame at 60 fps (bench avg, 1x and 4x)`, b1.avgMs < 1 && b4.avgMs < 1, { bench1x: b1.avgMs, bench4x: b4.avgMs });
}

// ------------------------------------------------------------------------------------------------ world

async function selectCap0(s) {
  await ev(s, () => {
    const w = window.__SAMRAJYA_UI__.props('world_hud').world;
    window.__SAMRAJYA_UI__.emit('ui:world_select', { kind: 'settlement', id: w.factions[w.playerFactionId].capitalSettlementId });
  });
  await settle(s, 300);
}

async function worldSession(browser, base, vpName) {
  const s = await newPage(browser, vpName);
  const phone = s.vp.mobile;
  await open(s, base, 'scene=world&seed=7&paused=1');
  const info = await ev(s, () => {
    const w = window.__SAMRAJYA_UI__.props('world_hud').world;
    return { me: w.playerFactionId, cap: w.factions[w.playerFactionId].capitalSettlementId };
  });
  const selectCap = () => ev(s, (id) => window.__SAMRAJYA_UI__.emit('ui:world_select', { kind: 'settlement', id }), info.cap);

  await step(s, async () => {
    await selectCap();
    await settle(s, 600);
    await click(s, '.command-card .tabs .btn.tab', /economy/);
    await passThrough(s, 'world HUD', [
      [0.45, 0.35],
      [0.3, 0.45],
    ]);
    await shot(s, 'world-settlement-economy', 'world HUD, Rajapura selected: resource bar, date/season/forecast, speed, realm buttons, objectives, minimap, command card Economy tab');
    await click(s, '.command-card .tabs .btn.tab', /recruit/);
    await shot(s, 'world-settlement-recruit', 'command card Recruit tab (recruit slots by UnitDef.commandSlot, rally point slot 14)');
  }, 'world: settlement selected');

  await step(s, async () => {
    await click(s, '.sel-action');
    await shot(s, 'settlement-panel', 'settlement panel (drawer / bottom sheet): vitals, labor, tax, buildings, queues, garrison');
    await closeAll(s, ['settlement_panel']);
  }, 'world: settlement panel');

  await step(s, async () => {
    await ev(s, () => window.__SAMRAJYA_UI__.emit('ui:world_select', { kind: 'army', id: 'army_royal' }));
    await settle(s, 600);
    if (!phone) await shot(s, 'world-army-card', 'army selected: army command card (orders, stances, forced march, split, merge, disband, visit)');
    await click(s, '.sel-action');
    await shot(s, 'army-panel', 'army panel: commander, supply with reasons, stance, units with split selection');
    await closeAll(s, ['army_panel']);
  }, 'world: army panel');

  await step(s, async () => {
    await selectCap();
    await settle(s, 400);
    await ev(
      s,
      ([sid, touch]) =>
        window.__SAMRAJYA__.showScreen('build_placement', {
          world: '$world',
          settlementId: sid,
          building: 'granary',
          landmarkId: null,
          cell: [12, 7],
          rot: 1,
          valid: false,
          reason: 'Needs flat ground inside the walls',
          cost: { wealth: 200, timber: 120, stone: 40, labor: 2500 },
          repeat: false,
          touch,
        }),
      [info.cap, phone],
    );
    await shot(s, 'build-placement', 'build placement HUD (granary ghost, invalid with reason, cost, rotate / repeat keys; phones: tick / cross / rotate)');
    await closeAll(s, ['build_placement']);
  }, 'world: build placement');

  await step(s, async () => {
    await click(s, '.command-card .tabs .btn.tab', /economy/);
    await click(s, '.card-grid .btn.slot', /trade/);
    await shot(s, 'market', 'market (opened from the Economy tab "Trade" slot): quotes, buy / sell lots, sparkline, reasons');
    await closeAll(s, ['market']);
  }, 'world: market');

  await step(s, async () => {
    await click(s, '.realm-btn', /ages/);
    await shot(s, 'age-panel', 'age panel: requirements checklist, two landmark cards, unlock preview');
    await closeAll(s, ['age_panel']);
    await click(s, '.realm-btn', /economy/);
    await shot(s, 'economy-panel', 'economy panel: ledger and projection, tax policy, royal reserve, rationing, granaries');
    await closeAll(s, ['economy_panel']);
  }, 'world: age / economy panels');

  await step(s, async () => {
    await click(s, '.realm-btn', /diplomacy/);
    await click(s, '.dip-row', /Giri|highland/);
    await shot(s, 'diplomacy', 'diplomacy: realm list, relation, proposal composer with the AI reply and its reasons (evaluateAcceptance)');
    await closeAll(s, ['diplomacy']);
  }, 'world: diplomacy');

  await step(s, async () => {
    if (phone) await click(s, '.minimap-toggle');
    await elementShot(s, '.wh-minimap', 'minimap-world', 'world minimap: terrain bitmap, borders, roads, settlements by relation, armies, fog');
    if (phone) await click(s, '.minimap-toggle');
  }, 'world: minimap');


  // Prompts: step the campaign day by day until an event and an engagement appear (the Royal Host marches on the
  // nearest army of a realm at war with the player).
  await step(s, async () => {
    await closeAll(s, ['settlement_panel', 'army_panel']);
    const target = await ev(s, () => {
      const w = window.__SAMRAJYA_UI__.props('world_hud').world;
      const me = w.playerFactionId;
      const host = w.armies.army_royal;
      let best = null;
      for (const a of Object.values(w.armies)) {
        if (a.factionId === me) continue;
        const key = [me, a.factionId].sort().join('|');
        const rel = w.diplomacy.relations[key];
        if (!rel || !rel.atWar) continue;
        const d = Math.hypot(a.x - host.x, a.z - host.z);
        if (!best || d < best.d) best = { id: a.id, d };
      }
      return best;
    });
    if (target) await ev(s, (id) => window.__SAMRAJYA__.issueStrategicCommand({ kind: 'army_order', armyId: 'army_royal', order: { kind: 'attack_army', targetArmyId: id } }), target.id);
    let gotEvent = false;
    let gotEngagement = false;
    for (let day = 0; day < 90 && !(gotEvent && gotEngagement); day++) {
      await ev(s, () => window.__SAMRAJYA__.step(24));
      await frames(s, 2);
      const st = await ev(s, () => ({ ev: window.__SAMRAJYA_UI__.visible('event_modal'), eng: window.__SAMRAJYA_UI__.visible('engagement_prompt') }));
      if (st.eng && !gotEngagement) {
        await shot(s, 'engagement-prompt', 'engagement prompt: both sides, prediction bar, advisor factors, queue');
        gotEngagement = true;
        await click(s, '.engagement button', /generals|autoresolve/);
        await ev(s, () => window.__SAMRAJYA__.pause());
      } else if (st.ev && !gotEvent) {
        await shot(s, 'event-modal', 'event modal: illustration band, text, choices with advisor recommendation and requirements');
        gotEvent = true;
        await click(s, '.event-choice:not(.disabled)');
        await ev(s, () => window.__SAMRAJYA__.pause());
      } else if (st.ev) {
        await click(s, '.event-choice:not(.disabled)');
        await ev(s, () => window.__SAMRAJYA__.pause());
      }
    }
    check(`world (${vpName}): an event modal was reached`, gotEvent, null);
    check(`world (${vpName}): an engagement prompt was reached`, gotEngagement || !target, target);
  }, 'world: prompts');

  if (vpName === 'pc') {
    await selectCap0(s);
    await step(s, () => profileUi(s, 'world-1280x720'), 'world: profiler');
  }
  await finish(s, 'world');
}

// ------------------------------------------------------------------------------------------------ battle

/** Screen anchors of formations with the RTS camera model (BattleScene options); GP-04 will push the real ones. */
function computeAnchors() {
  const api = window.__SAMRAJYA__;
  const st = api.getState().sceneState;
  const cam = st.camera;
  const b = window.__SAMRAJYA_UI__.props('battle_hud').battle;
  const minD = 14;
  const maxD = 900;
  const t = Math.min(1, Math.max(0, (cam.distance - minD) / (maxD - minD)));
  const pitch = Math.min(1.45, Math.max(0.12, 0.28 + (1.05 - 0.28) * Math.pow(t, 0.6) + cam.tilt));
  const fy = window.__UI02_GROUND__ || 0;
  const horiz = Math.cos(pitch) * cam.distance;
  const C = [cam.x + Math.sin(cam.yaw) * horiz, fy + Math.sin(pitch) * cam.distance, cam.z + Math.cos(cam.yaw) * horiz];
  const L = [cam.x, fy + Math.min(6, cam.distance * 0.02), cam.z];
  const sub = (a, c) => [a[0] - c[0], a[1] - c[1], a[2] - c[2]];
  const dot = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
  const cross = (a, c) => [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
  const norm = (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const f = norm(sub(L, C));
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const W = innerWidth;
  const H = innerHeight;
  const tanH = Math.tan((50 * Math.PI) / 360);
  return b.formations
    .filter((fm) => fm.soldiers > 0)
    .map((fm) => {
      const d = sub([fm.x, fy + 9, fm.z], C);
      const zc = dot(d, f);
      const nx = dot(d, r) / (zc * tanH * (W / H));
      const ny = dot(d, u) / (zc * tanH);
      const x = ((nx + 1) / 2) * W;
      const y = ((1 - ny) / 2) * H;
      return { index: fm.index, x, y, visible: zc > 0 && x > 0 && x < W && y > 0 && y < H, scale: Math.max(0.55, Math.min(1, 260 / zc)) };
    });
}

async function battleSession(browser, base, vpName, outcomeHolder) {
  const s = await newPage(browser, vpName);
  const phone = s.vp.mobile;
  await open(s, base, 'scene=battle&seed=7&soldiers=1000&preset=plains&paused=1');
  await step(s, async () => {
    await settle(s, 600);
    await shot(s, 'battle-deployment', 'battle HUD in deployment: forces bar, deployment timer + Begin, cards strip, command card, simple presets');
  }, 'battle: deployment');

  await step(s, async () => {
    await ev(s, () => window.__SAMRAJYA__.issueBattleCommand({ kind: 'begin_battle' }));
    await ev(s, () => window.__SAMRAJYA__.step(1));
    for (let i = 0; i < 12; i++) {
      await ev(s, () => window.__SAMRAJYA__.step(50));
      const st = await ev(s, () => window.__SAMRAJYA__.getState().sceneState);
      const lost = st.sides.reduce((a, x) => a + x.initial - x.soldiers, 0);
      if (lost > 60) break;
    }
    const sel = await ev(s, () => {
      const p = window.__SAMRAJYA_UI__.props('battle_hud');
      const own = p.battle.formations.filter((f) => f.side === p.playerSide && f.soldiers > 0).map((f) => f.index);
      return own.slice(0, 2);
    });
    await ev(s, (formations) => window.__SAMRAJYA_UI__.emit('ui:select_formations', { formations, additive: false }), sel);
    await settle(s, 500);
    const anchors = await ev(s, computeAnchors);
    await ev(s, (a) => window.__SAMRAJYA_UI__.patch('battle_hud', { anchors: a }), anchors);
    await passThrough(s, 'battle HUD', [
      [0.5, 0.3],
      [0.3, 0.25],
    ]);
    await shot(s, 'battle-live', 'battle HUD in battle: cards strip (strength, morale + cause, fatigue, ammo), selection card, rally ring, floating formation cards (anchors from the camera model), feed');
  }, 'battle: live');

  await step(s, async () => {
    const [W, H] = s.vp.size;
    await ev(s, ([x, y]) => window.__SAMRAJYA_UI__.action('radial_menu', { pointer: { x, y, ndcX: 0, ndcY: 0, kind: 'touch', button: 0 } }), [Math.round(W / 2), Math.round(H * 0.45)]);
    await shot(s, 'battle-radial', 'radial wheel (long press): inner ring orders, outer ring shapes / intents, cancel centre');
    await s.page.keyboard.press('Escape');
    await settle(s, 200);
    const st = await ev(s, () => ({ radial: !!document.querySelector('.radial:not(.ui-hidden)'), pause: window.__SAMRAJYA_UI__.visible('pause_menu') }));
    check(`battle (${s.vpName}): Esc closes the radial wheel without opening the pause menu`, !st.radial && !st.pause, st);
  }, 'battle: radial');

  if (!phone)
    await step(s, async () => {
      await ev(s, () => window.__SAMRAJYA_UI__.action('card_next_tab'));
      await ev(s, () => window.__SAMRAJYA_UI__.action('card_next_tab'));
      await shot(s, 'battle-intents', 'command card Intents page (Tab cycles Orders / Shapes / Intents; slots keyed per preset)');
      await ev(s, () => window.__SAMRAJYA_UI__.action('card_next_tab'));
    }, 'battle: intents page');

  await step(s, async () => {
    if (phone) await click(s, '.minimap-toggle');
    await elementShot(s, '.bh-minimap', 'minimap-battle', 'battle minimap: terrain, deploy zones, formations by side with facing, selection');
    if (phone) await click(s, '.minimap-toggle');
  }, 'battle: minimap');

  if (vpName === 'pc') await step(s, () => profileUi(s, 'battle-1280x720'), 'battle: profiler');

  await step(s, async () => {
    if (!outcomeHolder.outcome) {
      await ev(s, () => window.__SAMRAJYA_UI__.patch('battle_hud', null));
      for (let i = 0; i < 160; i++) {
        await ev(s, () => window.__SAMRAJYA__.step(200));
        const st = await ev(s, () => window.__SAMRAJYA__.getState().sceneState);
        if (st.outcome) break;
      }
      // The session shows the results a moment after the outcome (scene frames, not sim steps).
      let p = null;
      for (let i = 0; i < 40 && !p; i++) {
        await frames(s, 2);
        p = await ev(s, () => (window.__SAMRAJYA_UI__.visible('battle_results') ? window.__SAMRAJYA_UI__.props('battle_results') : null));
      }
      check(`battle (${vpName}): the battle reaches an outcome and the results screen shows`, !!p, p && { winner: p.outcome.winner, reason: p.outcome.reason });
      if (p) outcomeHolder.outcome = p;
    } else {
      await ev(s, (p) => window.__SAMRAJYA__.showScreen('battle_results', p), outcomeHolder.outcome);
    }
    await shot(s, 'battle-results', 'battle results: banner, per-side table, formations, fates, chronicle, Continue');
  }, 'battle: results');

  await finish(s, 'battle');
}

// ------------------------------------------------------------------------------------------------ hero

async function heroSession(browser, base, vpName) {
  const s = await newPage(browser, vpName);
  const phone = s.vp.mobile;
  await open(s, base, 'scene=hero');
  const [W, H] = s.vp.size;
  await step(s, async () => {
    await ev(
      s,
      ([w, h, touch]) =>
        window.__SAMRAJYA_UI__.patch('hero_hud', {
          prompt: 'Speak with the potter',
          promptAnchor: { x: Math.round(w * 0.56), y: Math.round(h * 0.42) },
          objective: 'Find the healer near the temple tank',
          compassHeading: 0.6,
          caption: { speaker: 'Potter', text: 'The healer? She left at dawn for the temple tank - follow the lamps.' },
          combat: null,
          touchControls: touch ? 'explore' : 'none',
        }),
      [W, H, phone],
    );
    await shot(s, 'hero-explore', 'hero HUD exploring: objective, compass strip, prompt bubble at its anchor, caption; phones: stick + interact');
  }, 'hero: explore');

  await step(s, async () => {
    await ev(
      s,
      ([w, h, touch]) =>
        window.__SAMRAJYA_UI__.patch('hero_hud', {
          prompt: null,
          promptAnchor: null,
          objective: 'Defeat Durjaya and his bandits',
          compassHeading: 2.2,
          caption: null,
          touchControls: touch ? 'combat' : 'none',
          combat: {
            hp: 64,
            hpMax: 100,
            stamina: 38,
            staminaMax: 100,
            salveCharges: 2,
            salveMax: 3,
            lockOn: { x: Math.round(w * 0.5), y: Math.round(h * 0.4) },
            slowMotion: false,
            enemies: [
              { id: 'boss', name: 'Durjaya the Red', x: Math.round(w * 0.5), y: Math.round(h * 0.32), visible: true, hp: 310, hpMax: 400, poise: 40, poiseMax: 100, boss: true, unblockable: true },
              { id: 'b1', name: 'Bandit', x: Math.round(w * 0.3), y: Math.round(h * 0.38), visible: true, hp: 30, hpMax: 60, poise: 20, poiseMax: 40, boss: false, unblockable: false },
              { id: 'b2', name: 'Bandit archer', x: Math.round(w * 0.74), y: Math.round(h * 0.36), visible: true, hp: 45, hpMax: 45, poise: 30, poiseMax: 30, boss: false, unblockable: false },
            ],
          },
        }),
      [W, H, phone],
    );
    await passThrough(s, 'hero HUD', [
      [0.5, 0.55],
      [0.25, 0.4],
    ]);
    await shot(s, 'hero-combat', 'hero HUD in combat: HP / stamina / salves, boss bar (unblockable cue), enemy bars, lock-on reticle; phones: combat buttons');
  }, 'hero: combat');
  await finish(s, 'hero');
}

// ------------------------------------------------------------------------------------------------ assets=off

async function assetsOff(browser, base) {
  const s = await newPage(browser, 'pc');
  await s.page.goto(`${base}?scene=world&seed=7&paused=1&assets=off&quality=low&noaudio=1`, { waitUntil: 'load', timeout: TIMEOUT });
  await s.page.waitForFunction('window.__SAMRAJYA__ && window.__SAMRAJYA__.sceneReady && window.__SAMRAJYA_UI__', null, { timeout: TIMEOUT, polling: 250 });
  const vis = await ev(s, () => window.__SAMRAJYA_UI__.visible('world_hud'));
  check('assets=off: the world HUD shows', vis, vis);
  await finish(s, 'assets=off world');
}

// ------------------------------------------------------------------------------------------------ main

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  if (!process.env.SHOTS_SKIP_BUILD) execSync(`npx vite build --outDir ${DIST} --emptyOutDir`, { cwd: ROOT, stdio: 'inherit' });
  const server = spawn('npx', ['vite', 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
  const base = `http://localhost:${PORT}/`;
  let browser = null;
  try {
    await waitForServer(base, 60000);
    browser = await requirePlaywright().chromium.launch({ args: LAUNCH_ARGS });
    const outcome = {};
    for (const vp of VPS) {
      if (!ONLY || ONLY.has('world')) await worldSession(browser, base, vp);
      if (!ONLY || ONLY.has('battle')) await battleSession(browser, base, vp, outcome);
      if (!ONLY || ONLY.has('hero')) await heroSession(browser, base, vp);
    }
    if (!ONLY || ONLY.has('assetsoff')) await assetsOff(browser, base);
    // SHOTS_MERGE=1 (partial re-runs with --only / --vp): keep the other entries of the existing report.
    const file = path.join(OUT, 'shots-report.json');
    if (process.env.SHOTS_MERGE && fs.existsSync(file)) {
      const old = JSON.parse(fs.readFileSync(file, 'utf8'));
      const names = new Set(report.shots.map((x) => x.name));
      const checks = new Set(report.checks.map((x) => x.name));
      const summary = (n) => n.startsWith('contrast:') || n.startsWith('touch:');
      report.shots = [...old.shots.filter((x) => !names.has(x.name)), ...report.shots];
      report.audits = [...old.audits.filter((x) => !names.has(x.shot)), ...report.audits];
      report.checks = [...old.checks.filter((x) => !checks.has(x.name) && !summary(x.name)), ...report.checks];
      report.profile = { ...old.profile, ...report.profile };
      failed = report.checks.some((c) => !c.ok);
    }
    // Contrast + touch summaries.
    const cf = report.audits.flatMap((a) => a.contrastFails.map((f) => ({ shot: a.shot, ...f })));
    const tf = report.audits.flatMap((a) => a.smallTargets.map((t) => ({ shot: a.shot, ...t })));
    check(`contrast: every measured text run >= 4.5:1 (body) / 3:1 (large) on ${report.audits.length} captures`, cf.length === 0, { texts: report.audits.reduce((n, a) => n + a.texts, 0), fails: cf.slice(0, 20) });
    check('touch: every interactive element >= 44x44 px on phone captures', tf.length === 0, { targets: report.audits.reduce((n, a) => n + a.targets, 0), fails: tf.slice(0, 20) });
  } catch (err) {
    check('run', false, String(err && err.stack ? err.stack : err));
  } finally {
    if (browser) await browser.close();
    try {
      process.kill(-server.pid);
    } catch {
      server.kill();
    }
    fs.writeFileSync(path.join(OUT, 'shots-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[ui-02] ${failed ? 'FAILED' : 'passed'}: ${report.checks.filter((c) => c.ok).length}/${report.checks.length} checks, ${report.shots.length} shots -> ${path.relative(ROOT, OUT)}`);
    process.exit(failed ? 1 : 0);
  }
})();
