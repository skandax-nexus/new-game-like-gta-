#!/usr/bin/env node
/**
 * GFX-01 evidence capture (lighting, atmosphere, post, materials, renderer). OWNER: Graphics Developer -
 * Lighting, Atmosphere & Post (GFX-01).
 *
 *   npx vite build --outDir .build/gfx-01 --emptyOutDir
 *   NODE_PATH=$(npm root -g) node scripts/shots/gfx-01.cjs [--only=presets,low,csm,zoom,labs,budgets,tiers,context]
 *
 * Env: SHOTS_PORT (default 4403), SHOTS_DIST (default .build/gfx-01), SHOTS_OUT (default docs/sprint1/gfx-01).
 * Starts `vite preview` on the ticket port, opens deep links in headless Chromium (SwiftShader: frame times mean
 * nothing - judge draw calls, passes and pixels), waits for sceneReady, drains the GPU queue (a synchronous
 * __SAMRAJYA__.screenshot()) and saves PNGs plus docs/sprint1/gfx-01/report.json:
 *   presets  battle (preset=plains, tactical) + hero (Rajapura) x 8 lighting presets on ultra (16 PNGs)
 *   low      battle + hero at noon / golden / night on low (6 PNGs); night tactical lower-half luminance
 *   csm      ?csm=1 cascade colours (ultra 4, high 3, medium 2) - contact shadows reported per tier
 *   zoom     operational battle overview (650 m) and the strategic world overview (4.2 km): map edge melts into the
 *            horizon haze (largest row-to-row jump of the mean colour in the top 45 % is reported)
 *   labs     post-hero lab: TAA on / off, DoF focus override, AgX, battle view SMAA (ultra) / merged pass (low);
 *            surface lab (clearcoat, sheen, subsurface, foliage, wet + puddles, LOD dither)
 *   budgets  draw calls: battle 1000 @high, river 5000 @high, mobile 600 @low (before / after table)
 *   tiers    low -> ultra -> low x3: renderer.info.memory textures / geometries and post render targets unchanged
 *   context  WEBGL_lose_context: rendering pauses, restores, no errors
 * Fails (exit 1) on console errors, page errors or failed budgets / checks.
 */
'use strict';
const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.SHOTS_PORT || 4403);
const DIST = process.env.SHOTS_DIST || '.build/gfx-01';
const OUT = path.resolve(ROOT, process.env.SHOTS_OUT || 'docs/sprint1/gfx-01');
const args = Object.fromEntries(process.argv.slice(2).map((a) => (/^--([^=]+)=?(.*)$/.exec(a) || [null, a, '1']).slice(1)));
const ONLY = args.only ? new Set(args.only.split(',')) : null;
const want = (k) => !ONLY || ONLY.has(k);
const sharp = require(path.join(ROOT, 'node_modules', 'sharp'));
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));

/** Lighting presets (ART_BIBLE §4.1) as URL environment overrides. */
const PRESETS = [
  { id: 'dawn', env: 'hour=6.2&season=sharad&weather=clear' },
  { id: 'noon', env: 'hour=12.5&season=sharad&weather=clear' },
  { id: 'golden', env: 'hour=17.4&season=sharad&weather=clear' },
  { id: 'dusk', env: 'hour=18.9&season=sharad&weather=clear' },
  { id: 'night', env: 'hour=22&season=sharad&weather=clear' },
  { id: 'monsoon', env: 'hour=13&season=varsha&weather=monsoon_rain' },
  { id: 'dry_haze', env: 'hour=13&season=grishma&weather=hazy' },
  { id: 'winter_fog', env: 'hour=8&season=shishira&weather=fog' },
];
const BATTLE = 'scene=battle&seed=7&soldiers=1000&preset=plains';
const HERO = 'scene=hero';
/** Draw calls measured on the baseline (before GFX-01, same deep links, SwiftShader 1280x720 / 844x390). */
const BEFORE = { 'battle-1000-high': 81, 'battle-river-5000-high': 81, 'battle-mobile-low': 26 };
const BUDGETS = { 'battle-1000-high': 400, 'battle-river-5000-high': 500, 'battle-mobile-low': 150 };

function wait(url, ms) {
  const t0 = Date.now();
  return new Promise((res, rej) => {
    const once = () => http.get(url, (r) => (r.resume(), res())).on('error', () => (Date.now() - t0 > ms ? rej(new Error('no server')) : setTimeout(once, 300)));
    once();
  });
}

/** Mean sRGB luma (0..1) and mean linear luminance of a PNG region (rows y0..y1 as fractions). */
async function luminance(file, y0 = 0, y1 = 1) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const a = Math.floor(info.height * y0);
  const b = Math.floor(info.height * y1);
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  let luma = 0;
  let linear = 0;
  let n = 0;
  for (let y = a; y < b; y++)
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const bl = data[i + 2] / 255;
      luma += 0.2126 * r + 0.7152 * g + 0.0722 * bl;
      linear += 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bl);
      n++;
    }
  return { luma: luma / n, linear: linear / n };
}

/** Mean luminance of a box (fractions x0, x1, y0, y1 of the frame). */
async function regionLuminance(file, box) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const [x0, x1, y0, y1] = [box[0] * info.width, box[1] * info.width, box[2] * info.height, box[3] * info.height].map(Math.floor);
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  let luma = 0;
  let linear = 0;
  let n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * info.width + x) * info.channels;
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      luma += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      linear += 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      n++;
    }
  return { luma: luma / n, linear: linear / n };
}

/** Hero frame regions (fractions of 1280x720, Rajapura default camera): lime plaster walls, red base, terrain. */
const WET_REGIONS = {
  plasterNear: [770 / 1280, 880 / 1280, 180 / 720, 215 / 720],
  plasterFar: [600 / 1280, 740 / 1280, 110 / 720, 150 / 720],
  redBase: [950 / 1280, 1250 / 1280, 150 / 720, 330 / 720],
  terrain: [100 / 1280, 500 / 1280, 550 / 720, 700 / 720],
};

/** Largest row-to-row jump of the mean colour in a band (horizon seam check). */
async function maxRowJump(file, y0, y1) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let prev = null;
  let worst = 0;
  for (let y = Math.floor(info.height * y0); y < Math.floor(info.height * y1); y++) {
    let s = 0;
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      s += (data[i] + data[i + 1] + data[i + 2]) / 3;
    }
    s /= info.width;
    if (prev !== null) worst = Math.max(worst, Math.abs(s - prev));
    prev = s;
  }
  return worst;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const report = { generated: new Date().toISOString(), shots: [], checks: {}, budgets: [], tiers: null, context: null };
  const failures = [];
  let browser;
  try {
    await wait(`http://127.0.0.1:${PORT}/`, 30000);
    browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });

    /** Open a deep link, wait, optionally advance / evaluate, drain the GPU, capture. */
    async function shot(name, query, opts = {}) {
      const vp = opts.vp || [1280, 720];
      const page = await browser.newPage({ viewport: { width: vp[0], height: vp[1] }, isMobile: !!opts.mobile, hasTouch: !!opts.mobile });
      const errors = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 300)));
      page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
      page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()}`));
      const t0 = Date.now();
      await page.goto(`http://127.0.0.1:${PORT}/?${query}&paused=1&noaudio=1`);
      await page.waitForFunction(() => window.__SAMRAJYA__ && window.__SAMRAJYA__.sceneReady, null, { timeout: 600000, polling: 500 });
      // Evidence hygiene (AD round 1): pin the resolution scale so non-ultra shots show the tier, not SwiftShader speed.
      await page.evaluate((sc) => window.__SAMRAJYA_GFX__.pinResolutionScale && window.__SAMRAJYA_GFX__.pinResolutionScale(sc), opts.scale ?? 1);
      if (opts.advance) await page.evaluate((n) => window.__SAMRAJYA__.step(n), opts.advance);
      if (opts.before) await page.evaluate(opts.before);
      await page.evaluate(() => window.__SAMRAJYA__.waitFrames(4));
      await page.evaluate(() => window.__SAMRAJYA__.freeze(true));
      await page.evaluate(() => void window.__SAMRAJYA__.screenshot());
      const gfx = await page.evaluate(() => window.__SAMRAJYA_GFX__.info());
      const prof = await page.evaluate(() => window.__SAMRAJYA__.getProfile());
      const file = path.join(OUT, `${name}.png`);
      if (!opts.noCapture) await page.screenshot({ path: file, timeout: 600000 });
      const extra = opts.after ? await page.evaluate(opts.after) : undefined;
      // Optional A/B in the same frozen frame (e.g. wetness override): `alt = { suffix, before }`.
      if (opts.alt) {
        await page.evaluate(opts.alt.before);
        await page.evaluate(() => window.__SAMRAJYA__.waitFrames(4));
        await page.evaluate(() => void window.__SAMRAJYA__.screenshot());
        await page.screenshot({ path: path.join(OUT, `${name}-${opts.alt.suffix}.png`), timeout: 600000 });
      }
      await page.close();
      const r = {
        name,
        query,
        ms: Date.now() - t0,
        drawCalls: prof.render.drawCalls,
        shadowDrawCalls: gfx.stats.shadowDrawCalls,
        triangles: prof.render.triangles,
        textures: gfx.memory.textures,
        geometries: gfx.memory.geometries,
        tier: gfx.tier,
        passes: gfx.post.passes,
        look: gfx.post.look,
        env: gfx.env ? { preset: gfx.env.dominant, exposure: gfx.env.exposure, effectiveIrradiance: gfx.env.effectiveIrradiance, bakedSky: gfx.env.bakedSky, cascades: gfx.env.cascades, look: gfx.env.look, wetness: gfx.env.wetness } : null,
        extra,
        errors,
      };
      report.shots.push(r);
      console.log(JSON.stringify({ name, ms: r.ms, draws: r.drawCalls, shadow: r.shadowDrawCalls, passes: r.passes.join('+'), errors: errors.length }));
      if (errors.length) failures.push(`${name}: ${errors[0]}`);
      return r;
    }

    if (want('presets')) {
      for (const p of PRESETS) {
        await shot(`battle-${p.id}-ultra`, `${BATTLE}&quality=ultra&noui=1&${p.env}`, { advance: 200 });
        // Monsoon: the same frozen frame again with the surface wetness forced to 0 (AD round 1, blocker 1).
        const alt = p.id === 'monsoon' ? { suffix: 'dry', before: () => window.__SAMRAJYA_GFX__.setWetnessOverride(0) } : undefined;
        await shot(`hero-${p.id}-ultra`, `${HERO}&quality=ultra&noui=1&${p.env}`, { alt });
      }
    }
    // Wetness (ART_BIBLE §4.1 monsoon 0.85): luminance of fixed regions of the hero frame (deterministic camera),
    // monsoon wet / monsoon dry (same frame: only the surface wetness differs) and monsoon / noon (also the light).
    {
      const wet = path.join(OUT, 'hero-monsoon-ultra.png');
      const dry = path.join(OUT, 'hero-monsoon-ultra-dry.png');
      const noon = path.join(OUT, 'hero-noon-ultra.png');
      if (fs.existsSync(wet) && fs.existsSync(dry)) {
        const out = {};
        for (const [id, box] of Object.entries(WET_REGIONS)) {
          const w = await regionLuminance(wet, box);
          const d = await regionLuminance(dry, box);
          const n = fs.existsSync(noon) ? await regionLuminance(noon, box) : null;
          out[id] = {
            wetOverDry: { luma: +(w.luma / d.luma).toFixed(3), linear: +(w.linear / d.linear).toFixed(3) },
            wetOverNoon: n ? { luma: +(w.luma / n.luma).toFixed(3), linear: +(w.linear / n.linear).toFixed(3) } : null,
          };
        }
        report.checks.wetness = out;
        console.log(JSON.stringify({ wetness: out }));
        const pl = out.plasterNear.wetOverDry.linear;
        if (!(pl <= 0.8)) failures.push(`wetness: plaster linear luminance only x${pl} wet vs dry`);
      }
    }
    if (want('low')) {
      for (const p of PRESETS.filter((x) => ['noon', 'golden', 'night'].includes(x.id))) {
        await shot(`battle-${p.id}-low`, `${BATTLE}&quality=low&noui=1&${p.env}`, { advance: 200 });
        await shot(`hero-${p.id}-low`, `${HERO}&quality=low&noui=1&${p.env}`);
      }
      // Phone portrait (AD round 1, blocker 2): the low tier's single cascade at 390x844 (no acne, no saw-tooth).
      for (const p of PRESETS.filter((x) => ['noon', 'golden'].includes(x.id))) {
        await shot(`hero-${p.id}-low-phone`, `${HERO}&quality=low&noui=1&${p.env}`, { vp: [390, 844], mobile: true });
      }
    }
    // Night readability: lower half of the tactical battle (the armies) must stay >= 12 % mean luma.
    for (const tier of ['ultra', 'low']) {
      const f = path.join(OUT, `battle-night-${tier}.png`);
      if (!fs.existsSync(f)) continue;
      const l = await luminance(f, 0.5, 1);
      report.checks[`nightLowerHalf_${tier}`] = { luma: +l.luma.toFixed(4), linear: +l.linear.toFixed(4), pass: l.luma >= 0.12 };
      if (l.luma < 0.12) failures.push(`night ${tier}: lower-half luma ${l.luma.toFixed(3)} < 0.12`);
    }
    if (want('csm')) {
      for (const tier of ['ultra', 'high', 'medium']) {
        const r = await shot(`battle-csm-${tier}`, `${BATTLE}&quality=${tier}&noui=1&hour=15&season=sharad&weather=clear&csm=1`, {
          advance: 200,
          after: () => {
            const i = window.__SAMRAJYA_GFX__.info();
            return { cascades: i.env && i.env.cascades, filter: i.env && i.env.shadowFilter, distance: i.env && i.env.shadowDistance, contactPass: i.post.passes.includes('contact') };
          },
        });
        report.checks[`csm_${tier}`] = r.extra;
      }
    }
    if (want('zoom')) {
      for (const [name, q] of [
        ['battle-operational', `${BATTLE}&quality=high&noui=1&hour=16&season=sharad&weather=clear&camera=overview`],
        ['world-strategic', 'scene=world&quality=high&noui=1&hour=16&season=sharad&weather=clear&camera=overview'],
      ]) {
        await shot(`zoom-${name}`, q, { advance: name.startsWith('battle') ? 50 : 0 });
        report.checks[`horizonRowJump_${name}`] = +(await maxRowJump(path.join(OUT, `zoom-${name}.png`), 0, 0.45)).toFixed(2);
      }
    }
    if (want('labs')) {
      const lab = 'scene=lab&lab=post-hero&noui=1';
      const info = () => window.__SAMRAJYA_GFX__.info().post;
      report.checks.labHeroTaa = (await shot('lab-post-hero-taa-on', `${lab}&quality=ultra&taa=1`, { after: info })).extra;
      report.checks.labHeroNoTaa = (await shot('lab-post-hero-taa-off', `${lab}&quality=ultra&taa=0`, { after: info })).extra;
      report.checks.labHeroFocus = (await shot('lab-post-hero-dof-focus12', `${lab}&quality=ultra&focus=12`, { after: info })).extra;
      // Near-field DoF (AD round 1, blocker 3): the same frame with the single-layer DoF ('before'), and a pillar
      // 1.6 m in front of the lens with the focus on the hero (4.5 m), both layers vs single layer.
      await shot('lab-post-hero-dof-focus12-single', `${lab}&quality=ultra&focus=12&dofnear=0`);
      await shot('lab-post-hero-dof-nearpillar', `${lab}&quality=ultra&focus=4.5&near=1`);
      await shot('lab-post-hero-dof-nearpillar-single', `${lab}&quality=ultra&focus=4.5&near=1&dofnear=0`);
      {
        // Bands beside the cape's left edge (x ~600 px at 1280x720, rows 340-470): just outside (the foreground must
        // spread over the scene behind it: darker with the near layer) and just inside (background bitten into the
        // cape by the far gather: darker = fewer bites).
        const band = (x0, x1) => [x0 / 1280, x1 / 1280, 340 / 720, 470 / 720];
        const out = {};
        for (const [id, box] of [['outside', band(590, 598)], ['inside', band(600, 606)]]) {
          const a = await regionLuminance(path.join(OUT, 'lab-post-hero-dof-focus12-single.png'), box);
          const b = await regionLuminance(path.join(OUT, 'lab-post-hero-dof-focus12.png'), box);
          out[id] = { singleLayer: +a.luma.toFixed(4), nearLayer: +b.luma.toFixed(4) };
        }
        report.checks.dofNearField = out;
        console.log(JSON.stringify({ dofNearField: out }));
      }
      await shot('lab-post-hero-agx', `${lab}&quality=ultra&tonemap=agx`);
      report.checks.labBattleSmaa = (await shot('lab-post-battle-smaa-ultra', `${lab}&quality=ultra&view=battle`, { after: info })).extra;
      report.checks.labBattleMerged = (await shot('lab-post-battle-merged-low', `${lab}&quality=low&view=battle`, { after: info })).extra;
      const merged = report.checks.labBattleMerged;
      if (!merged || merged.passes.join('+') !== 'scene+final') failures.push(`low tier is not a single merged pass: ${merged && merged.passes.join('+')}`);
      if (!report.checks.labHeroTaa.active.taa) failures.push('TAA did not run in the hero lab on ultra');
      await shot('lab-surface-wet-ultra', 'scene=lab&lab=surface&noui=1&quality=ultra&wet=0.9');
      await shot('lab-surface-dry-high', 'scene=lab&lab=surface&noui=1&quality=high&wet=0');
    }
    if (want('budgets')) {
      const list = [
        ['battle-1000-high', 'scene=battle&seed=7&soldiers=1000&preset=plains&quality=high', { advance: 500 }],
        ['battle-river-5000-high', 'scene=battle&seed=11&soldiers=5000&preset=river_crossing&hour=17&quality=high', { advance: 300 }],
        ['battle-mobile-low', 'scene=battle&seed=7&soldiers=600&preset=plains&quality=low', { advance: 400, vp: [844, 390], mobile: true }],
      ];
      for (const [name, q, o] of list) {
        const r = await shot(`budget-${name}`, q, o);
        const row = { name, before: BEFORE[name], after: r.drawCalls, shadow: r.shadowDrawCalls, budget: BUDGETS[name], pass: r.drawCalls < BUDGETS[name], passes: r.passes };
        report.budgets.push(row);
        if (!row.pass) failures.push(`${name}: ${r.drawCalls} draw calls >= ${BUDGETS[name]}`);
      }
    }
    if (want('tiers') || want('context')) {
      const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
      const errors = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 300)));
      page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
      await page.goto(`http://127.0.0.1:${PORT}/?scene=battle&seed=7&soldiers=600&preset=plains&quality=low&noui=1&paused=1&noaudio=1`);
      await page.waitForFunction(() => window.__SAMRAJYA__ && window.__SAMRAJYA__.sceneReady, null, { timeout: 600000, polling: 500 });
      await page.evaluate(() => window.__SAMRAJYA__.freeze(true));
      if (want('tiers')) {
        report.tiers = await page.evaluate(() => {
          const S = window.__SAMRAJYA__;
          const snap = (label) => {
            S.screenshot();
            S.screenshot();
            const i = window.__SAMRAJYA_GFX__.info();
            return { label, tier: i.tier, textures: i.memory.textures, geometries: i.memory.geometries, postRenderTargets: i.memory.postRenderTargets, passes: i.post.passes.join('+') };
          };
          const rows = [snap('start')];
          for (let k = 1; k <= 3; k++) for (const t of ['medium', 'high', 'ultra', 'high', 'medium', 'low']) {
            S.setQuality(t);
            rows.push(snap(`cycle${k}:${t}`));
          }
          return rows;
        });
        const lows = report.tiers.filter((r) => r.tier === 'low');
        const same = lows.every((r) => r.textures === lows[0].textures && r.geometries === lows[0].geometries && r.postRenderTargets === lows[0].postRenderTargets);
        report.checks.tierCyclingLeakFree = same;
        if (!same) failures.push(`tier cycling changed GPU memory: ${JSON.stringify(lows)}`);
      }
      if (want('context')) {
        report.context = await page.evaluate(async () => {
          const S = window.__SAMRAJYA__;
          const gl = document.querySelector('canvas').getContext('webgl2');
          const ext = gl.getExtension('WEBGL_lose_context');
          if (!ext) return { supported: false };
          ext.loseContext();
          await new Promise((r) => setTimeout(r, 300));
          const lost = window.__SAMRAJYA_GFX__.info().contextLost;
          const capWhileLost = S.screenshot();
          ext.restoreContext();
          await new Promise((r) => setTimeout(r, 1500));
          S.screenshot();
          const i = window.__SAMRAJYA_GFX__.info();
          const url = S.screenshot();
          return { supported: true, reportedLost: lost, captureWhileLost: capWhileLost ? 'data' : null, restored: !i.contextLost, passes: i.post.passes.join('+'), drawCalls: i.stats.drawCalls, captureBytes: url ? url.length : 0 };
        });
        if (report.context.supported && !(report.context.reportedLost && report.context.restored && report.context.drawCalls > 0)) failures.push(`context restore failed: ${JSON.stringify(report.context)}`);
        // The crash overlay reports the loss (main.ts) - that console error is expected here.
        report.context.errors = errors.filter((e) => !/context was lost|CONTEXT_LOST|context lost/i.test(e));
        if (report.context.errors.length) failures.push(`context: ${report.context.errors[0]}`);
      } else if (errors.length) failures.push(`tiers: ${errors[0]}`);
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
  report.failures = failures;
  const prev = fs.existsSync(path.join(OUT, 'report.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'report.json'), 'utf8')) : null;
  // --only runs merge into the previous report (keep the other sections).
  const merged = prev && ONLY ? { ...prev, ...report, shots: [...prev.shots.filter((s) => !report.shots.some((r) => r.name === s.name)), ...report.shots], checks: { ...prev.checks, ...report.checks }, budgets: report.budgets.length ? report.budgets : prev.budgets, tiers: report.tiers ?? prev.tiers, context: report.context ?? prev.context } : report;
  fs.writeFileSync(path.join(OUT, 'report.json'), `${JSON.stringify(merged, null, 2)}\n`);
  console.log(JSON.stringify({ checks: report.checks, budgets: report.budgets, failures }, null, 1));
  if (failures.length) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
