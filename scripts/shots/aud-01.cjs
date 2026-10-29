#!/usr/bin/env node
/**
 * AUD-01 evidence captures (OWNER: Audio Developer - Procedural Score, Ambience & SFX).
 *
 *   NODE_PATH=$(npm root -g) node scripts/shots/aud-01.cjs
 *
 * Env: SHOTS_PORT (default 4423), SHOTS_DIST (default .build/aud-01/dist), SHOTS_SKIP_BUILD=1, SHOTS_OUT
 * (default docs/sprint1/aud-01). Builds into SHOTS_DIST (never the shared dist/), serves it with vite preview
 * and drives headless Chromium (SwiftShader, CLAUDE.md launch args, autoplay allowed) with AUDIO ENABLED
 * (no ?noaudio) through window.__SAMRAJYA__ and the read-only window.__SAMRAJYA_AUDIO__ hook (?debug=1 /
 * ?profiler=1). SwiftShader makes frame rates meaningless; audio CPU numbers are what is checked.
 *
 *   audio-lab.png          ?scene=lab&lab=audio @high 1280x720: world score at dawn, temple district ambience,
 *                          an 80-sound positional burst (voice cap + stealing) and an age-up stinger
 *   audio-lab-mobile.png   the same lab at 390x844 @low (16 voices, equal-power panning, touch layout)
 *   battle-audio.png       1,000-soldier plains battle (AI vs AI) in the melee with the profiler overlay; the
 *                          'audio' system timing (main thread ms / frame) is printed and checked < 1 ms
 *   world-audio.png        campaign world map with audio enabled (world score + environment beds)
 *   hero-audio.png         hero exploration with audio enabled (district ambience)
 *   (gesture, no shot)     DEFAULT autoplay policy (own browser, no --autoplay-policy flag): the context starts
 *                          suspended and the first click on the shielded main-menu UI resumes it and the score
 *                          streams (desktop click and mobile tap)
 *   shots-report.json      every check with its observed value, the audio stats of each capture
 * Exit 1 on any failed check, console error, page error, failed request or crash report.
 */
'use strict';
const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.SHOTS_PORT || 4423);
const DIST = process.env.SHOTS_DIST || '.build/aud-01/dist';
const OUT = path.resolve(ROOT, process.env.SHOTS_OUT || 'docs/sprint1/aud-01');
const TIMEOUT = 300000;
const LAUNCH_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const want = (name) => ONLY.length === 0 || ONLY.includes(name);

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

const report = { port: PORT, dist: DIST, checks: [], shots: [], audio: {} };
let failed = false;
function check(name, ok, observed) {
  report.checks.push({ name, ok: !!ok, observed });
  console.log(`[aud-01] ${ok ? 'ok  ' : 'FAIL'} ${name}${observed !== undefined ? `  -> ${JSON.stringify(observed)}` : ''}`);
  if (!ok) failed = true;
}

async function newPage(browser, viewport, mobile) {
  const context = await browser.newContext({ viewport: { width: viewport[0], height: viewport[1] }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  const page = await context.newPage();
  const errors = [];
  const warnings = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
    else if (m.type() === 'warning' && /audio/i.test(m.text())) warnings.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`));
  return { context, page, errors, warnings };
}

async function waitReady(page) {
  await page.waitForFunction('window.__SAMRAJYA__ && window.__SAMRAJYA__.ready && window.__SAMRAJYA__.sceneReady', null, { timeout: TIMEOUT, polling: 250 });
  await page.evaluate(() => window.__SAMRAJYA__.waitFrames(2));
}

/** Resume the context and wait until the score is streaming (mode picked, >= 0.4 s buffered). */
async function waitAudio(page, label) {
  await page.waitForFunction('!!window.__SAMRAJYA_AUDIO__', null, { timeout: TIMEOUT, polling: 250 });
  await page.evaluate(() => window.__SAMRAJYA_AUDIO__.resume());
  const ok = await page
    .waitForFunction(
      () => {
        const s = window.__SAMRAJYA_AUDIO__.stats();
        return s.state === 'running' && s.music.stream !== 'pending' && s.music.bufferedSec >= 0.4;
      },
      null,
      { timeout: 120000, polling: 250 },
    )
    .then(() => true)
    .catch(() => false);
  const s = await stats(page);
  check(`${label}: AudioContext running, workers up, score streaming (${s.music.stream}, ${s.music.bufferedSec}s buffered)`, ok && s.state === 'running' && s.workers === 'worker', { state: s.state, workers: s.workers, stream: s.music.stream, sampleRate: s.sampleRate });
  return s;
}

function stats(page) {
  return page.evaluate(() => window.__SAMRAJYA_AUDIO__.stats());
}

/** Master output level over ~1 s (analyser after the limiter): max RMS / peak dBFS of 10 windows. */
function level(page) {
  return page.evaluate(async () => {
    const a = window.__SAMRAJYA_AUDIO__.analyser;
    if (!a) return { rmsDb: -Infinity, peakDb: -Infinity };
    const buf = new Float32Array(a.fftSize);
    let rms = 0;
    let peak = 0;
    for (let k = 0; k < 10; k++) {
      a.getFloatTimeDomainData(buf);
      let s = 0;
      for (let i = 0; i < buf.length; i++) {
        s += buf[i] * buf[i];
        peak = Math.max(peak, Math.abs(buf[i]));
      }
      rms = Math.max(rms, Math.sqrt(s / buf.length));
      await new Promise((r) => setTimeout(r, 100));
    }
    const db = (x) => (x > 0 ? Math.round(2000 * Math.log10(x)) / 100 : -999);
    return { rmsDb: db(rms), peakDb: db(peak) };
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name, note) {
  await page.evaluate(() => window.__SAMRAJYA__ && window.__SAMRAJYA__.freeze(true)).catch(() => undefined);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), timeout: TIMEOUT });
  await page.evaluate(() => window.__SAMRAJYA__ && window.__SAMRAJYA__.freeze(false)).catch(() => undefined);
  report.shots.push({ name: `${name}.png`, note });
  console.log(`[aud-01] shot ${name}.png  ${note}`);
}

async function finish(ctx, label) {
  const crash = await ctx.page.evaluate(() => (window.__SAMRAJYA__ ? window.__SAMRAJYA__.getErrors().map((r) => r.message) : [])).catch(() => []);
  check(`${label}: no console errors, page errors, failed requests or crash reports (audio enabled)`, ctx.errors.length === 0 && crash.length === 0, [...ctx.errors, ...crash]);
  check(`${label}: no audio warnings (worker errors)`, ctx.warnings.length === 0, ctx.warnings);
  await ctx.context.close();
}

const call = (page, name, ...args) => page.evaluate(([n, a]) => window.__SAMRAJYA__.call(n, ...a), [name, args]);

async function captureLab(browser, base) {
  const ctx = await newPage(browser, [1280, 720], false);
  const { page } = ctx;
  await page.goto(`${base}?scene=lab&lab=audio&quality=high&debug=1`, { waitUntil: 'load', timeout: TIMEOUT });
  await waitReady(page);
  let s = await waitAudio(page, 'audio-lab');
  check('audio-lab: score streams through the AudioWorklet (main-thread hitches cannot starve it)', s.music.stream === 'worklet', s.music.stream);
  check('audio-lab: high tier = 48 voices, HRTF panning', s.voices.cap === 48 && s.hrtf === true, { cap: s.voices.cap, hrtf: s.hrtf });
  await call(page, 'audio.mood', 'world', 0.4);
  await call(page, 'audio.env', 'dawn');
  await call(page, 'audio.district', 'd_temple');
  await sleep(6000);
  const lv = await level(page);
  check(`audio-lab: audible master output (max RMS ${lv.rmsDb} dBFS, peak ${lv.peakDb} dBFS)`, lv.rmsDb > -50 && lv.peakDb <= 0.01, lv);
  s = await stats(page);
  check('audio-lab: district + dawn ambience layers active', s.ambience.some((l) => l.key === 'temple_bells') && s.ambience.some((l) => l.key === 'dawn_birds'), s.ambience.map((l) => l.key));
  // First burst requests every SFX kind on demand; the second (all rendered by then) has to steal voices.
  await call(page, 'audio.burst', 80);
  // Wait until every requested SFX is actually rendered (`bank.keys` counts requests, so under CPU contention the
  // second burst could find most kinds still rendering and nothing to steal).
  await page
    .waitForFunction(
      () => {
        const b = window.__SAMRAJYA_AUDIO__.bank;
        const keys = [...b.m.keys()].filter((k) => k.startsWith('sfx:'));
        return keys.length >= 36 && keys.every((k) => b.has(k));
      },
      null,
      { timeout: 180000, polling: 500 },
    )
    .catch(() => undefined);
  await sleep(1500);
  await call(page, 'audio.burst', 80);
  await sleep(300);
  s = await stats(page);
  const live = s.voices.sfx + s.voices.ambience + s.voices.flat;
  check(`audio-lab: 80-sound burst stays within the voice cap (${live}/${s.voices.cap} live, ${s.voices.stolen} stolen, ${s.voices.rejected} merged/rejected)`, live <= s.voices.cap && s.voices.stolen > 0, s.voices);
  await call(page, 'audio.stinger', 'age_up');
  await sleep(1500);
  s = await stats(page);
  check(`audio-lab: main-thread audio update ${s.mainMs.avg} ms avg (< 1 ms)`, s.mainMs.avg < 1, s.mainMs);
  report.audio.lab = s;
  await shot(page, 'audio-lab', `audio lab @high: world score (${s.music.score ? `${s.music.score.raga} / ${s.music.score.tala} / ${s.music.score.section}` : 'score'}), dawn + temple district ambience, 80-sound burst, age-up stinger; bank ${s.bank.mb} MB, ${s.music.underruns} underruns`);
  await finish(ctx, 'audio-lab');
}

async function captureLabMobile(browser, base) {
  const ctx = await newPage(browser, [390, 844], true);
  const { page } = ctx;
  await page.goto(`${base}?scene=lab&lab=audio&quality=low&debug=1`, { waitUntil: 'load', timeout: TIMEOUT });
  await waitReady(page);
  let s = await waitAudio(page, 'audio-lab-mobile');
  check('audio-lab-mobile: low tier = 16 voices, equal-power panning', s.voices.cap === 16 && s.hrtf === false, { cap: s.voices.cap, hrtf: s.hrtf });
  await call(page, 'audio.mood', 'hero_explore', 0.3);
  await call(page, 'audio.env', 'monsoon');
  await sleep(5000);
  await call(page, 'audio.burst', 40);
  await sleep(400);
  s = await stats(page);
  const live = s.voices.sfx + s.voices.ambience + s.voices.flat;
  check(`audio-lab-mobile: 40-sound burst within the 16-voice cap (${live} live)`, live <= 16, s.voices);
  check(`audio-lab-mobile: monsoon beds active`, s.ambience.some((l) => l.key === 'rain_monsoon'), s.ambience.map((l) => l.key));
  report.audio.labMobile = s;
  await shot(page, 'audio-lab-mobile', `audio lab 390x844 @low: hero_explore score, monsoon environment; ${s.voices.cap} voices, bank ${s.bank.mb} MB`);
  await finish(ctx, 'audio-lab-mobile');
}

async function captureBattle(browser, base) {
  const ctx = await newPage(browser, [1280, 720], false);
  const { page } = ctx;
  // The lab attaches the shared profiler to the AudioManager (main.ts does not pass it yet - see the AUD-01
  // report); goto('battle') then starts the skirmish from the URL params with the same AudioManager.
  await page.goto(`${base}?scene=lab&lab=audio&quality=high&profiler=1&preset=plains&seed=2&soldiers=1000&aivsai=1`, { waitUntil: 'load', timeout: TIMEOUT });
  await waitReady(page);
  await waitAudio(page, 'battle-audio (lab boot)');
  await page.evaluate(() => window.__SAMRAJYA__.goto('battle'));
  await waitReady(page);
  await page.evaluate(() => window.__SAMRAJYA__.issueBattleCommand({ kind: 'begin_battle' }));
  // Step the authoritative sim to the melee, then let it run in real time so battle events reach the audio.
  let st = await page.evaluate(() => window.__SAMRAJYA__.getState().sceneState);
  const lost = (x) => x.sides.reduce((a, y) => a + (y.initial - y.soldiers), 0);
  const total = (x) => x.sides.reduce((a, y) => a + y.initial, 0);
  for (let t = 0; t < 6000 && !(st.phase !== 'deployment' && lost(st) >= total(st) * 0.06); t += 100) {
    await page.evaluate(() => window.__SAMRAJYA__.step(100));
    st = await page.evaluate(() => window.__SAMRAJYA__.getState().sceneState);
  }
  check(`battle-audio: the lines are in melee (t=${st.time}s, ${lost(st)} lost)`, lost(st) >= total(st) * 0.06 && !st.outcome, { tick: st.tick, lost: lost(st) });
  await page.evaluate(() => window.__SAMRAJYA__.resume());
  await sleep(12000);
  // SwiftShader runs the battle at ~2 FPS, so 12 s of wall time can hold no audible event (BattleScene emits
  // volleys / clashes only near the camera): keep running until the first battle SFX has played (max 60 s).
  await page.waitForFunction(() => window.__SAMRAJYA_AUDIO__.stats().triggers > 0, null, { timeout: 60000, polling: 500 }).catch(() => undefined);
  const s = await stats(page);
  const prof = await page.evaluate(() => window.__SAMRAJYA__.getProfile());
  const a = prof.systems.audio;
  report.audio.battle = s;
  report.audio.battleProfile = { audio: a, frames: prof.frames, fps: prof.fps, frameMs: prof.frameMs, counters: { voices: prof.counters['audio.voices'], underruns: prof.counters['audio.underruns'] } };
  console.log(`[aud-01] battle profiler 'audio': avg ${a ? a.avg.toFixed(3) : '?'} ms, max ${a ? a.max.toFixed(3) : '?'} ms, last ${a ? a.last.toFixed(3) : '?'} ms per frame; AudioManager EMA ${s.mainMs.avg} ms (max ${s.mainMs.max}); worker ${s.music.workerMsPerChunk} ms / 250 ms chunk; ${s.triggers} triggers; bank ${s.bank.mb} MB`);
  check(`battle-audio: profiler 'audio' system < 1 ms per frame on the main thread (avg ${a ? a.avg.toFixed(3) : 'missing'} ms)`, !!a && a.avg < 1, a);
  check(`battle-audio: battle score + battle bed (mood ${s.music.mood}, layers ${s.ambience.map((l) => l.key).join(', ')})`, s.music.mood === 'battle' && s.ambience.some((l) => l.key === 'battle_roar'), { mood: s.music.mood, ambience: s.ambience });
  check(`battle-audio: battle SFX triggered (${s.triggers})`, s.triggers > 0, s.triggers);
  await shot(page, 'battle-audio', `plains seed 2, 1,000 soldiers AI vs AI in the melee with audio enabled; profiler 'audio' ${a ? a.avg.toFixed(3) : '?'} ms avg / ${a ? a.max.toFixed(3) : '?'} ms max per frame; ${s.music.score ? `${s.music.score.raga} ${s.music.score.tala} ${s.music.score.section}` : ''}; bank ${s.bank.mb} MB; ${s.music.underruns} underruns`);
  await finish(ctx, 'battle-audio');
}

/** Default autoplay policy: the first click / tap on the (shielded) main-menu UI must start the audio. */
async function captureGesture(base) {
  const { chromium } = requirePlaywright();
  const browser = await chromium.launch({ args: LAUNCH_ARGS.filter((a) => !a.startsWith('--autoplay-policy')) });
  try {
    for (const [label, viewport, mobile, quality] of [['gesture-desktop', [1280, 720], false, 'high'], ['gesture-mobile', [390, 844], true, 'low']]) {
      const ctx = await newPage(browser, viewport, mobile);
      const { page } = ctx;
      // Autoplay-policy notices are expected before the first gesture; anything else still fails the run.
      await page.goto(`${base}?scene=menu&quality=${quality}&debug=1`, { waitUntil: 'load', timeout: TIMEOUT });
      await waitReady(page);
      await page.waitForFunction('!!window.__SAMRAJYA_AUDIO__', null, { timeout: TIMEOUT, polling: 250 });
      await sleep(1000);
      const before = (await stats(page)).state;
      // A point on the menu UI that is not a button (so nothing navigates), preferring a shielded panel.
      const pt = await page.evaluate(() => {
        const W = innerWidth;
        const H = innerHeight;
        for (let y = H - 12; y > 0; y -= 24) {
          for (let x = W / 2; x > 0 && x < W; x += x <= W / 2 ? -37 : 37) {
            const el = document.elementFromPoint(x, y);
            if (el && el !== document.body && el.tagName !== 'CANVAS' && !el.closest('button,a,input,select,[role=button]')) return { x, y, tag: el.tagName, cls: String(el.className).slice(0, 40) };
            if (x <= 37) break;
          }
        }
        return { x: W / 2, y: H - 12, tag: 'none', cls: '' };
      });
      if (mobile) await page.touchscreen.tap(pt.x, pt.y);
      else await page.mouse.click(pt.x, pt.y);
      const ok = await page
        .waitForFunction(() => { const s = window.__SAMRAJYA_AUDIO__.stats(); return s.state === 'running' && s.music.bufferedSec >= 0.3; }, null, { timeout: 60000, polling: 250 })
        .then(() => true)
        .catch(() => false);
      const s = await stats(page);
      report.audio[label] = { before, after: s.state, clicked: pt, stream: s.music.stream, bufferedSec: s.music.bufferedSec };
      check(`${label}: context ${before} before any gesture, ${s.state} after the first ${mobile ? 'tap' : 'click'} on the menu UI (<${pt.tag.toLowerCase()} class="${pt.cls}">), score streaming`, before === 'suspended' && ok, report.audio[label]);
      // The browser's own autoplay notice before the first gesture is the expected path here, not a worker error.
      ctx.warnings.splice(0, ctx.warnings.length, ...ctx.warnings.filter((w) => !/not allowed to start|user gesture/i.test(w)));
      await finish(ctx, label);
    }
  } finally {
    await browser.close();
  }
}

async function captureScene(browser, base, name, query, expectMood) {
  const ctx = await newPage(browser, [1280, 720], false);
  const { page } = ctx;
  await page.goto(`${base}?${query}&debug=1`, { waitUntil: 'load', timeout: TIMEOUT });
  await waitReady(page);
  await waitAudio(page, name);
  await sleep(5000);
  const s = await stats(page);
  const lv = await level(page);
  report.audio[name] = { ...s, level: lv };
  check(`${name}: score mood ${s.music.mood} (expected ${expectMood.join(' / ')}), output ${lv.rmsDb} dBFS RMS`, expectMood.includes(s.music.mood) && lv.rmsDb > -60 && lv.peakDb <= 0.01, { mood: s.music.mood, level: lv, ambience: s.ambience.map((l) => l.key) });
  await shot(page, name, `${query} with audio enabled: mood ${s.music.mood}, ambience ${s.ambience.map((l) => l.key).join(', ') || 'none'}, ${s.music.stream} stream, bank ${s.bank.mb} MB`);
  await finish(ctx, name);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  if (!process.env.SHOTS_SKIP_BUILD) {
    console.log(`[aud-01] building into ${DIST}`);
    execSync(`npx vite build --outDir ${DIST} --emptyOutDir`, { cwd: ROOT, stdio: 'inherit' });
  }
  const server = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const base = `http://127.0.0.1:${PORT}/`;
  let browser;
  try {
    await waitForServer(base, 60000);
    const { chromium } = requirePlaywright();
    browser = await chromium.launch({ args: LAUNCH_ARGS });
    if (want('lab')) await captureLab(browser, base);
    if (want('mobile')) await captureLabMobile(browser, base);
    if (want('battle')) await captureBattle(browser, base);
    if (want('world')) await captureScene(browser, base, 'world-audio', 'scene=world&quality=medium', ['world', 'city']);
    if (want('hero')) await captureScene(browser, base, 'hero-audio', 'scene=hero&quality=medium', ['hero_explore', 'city']);
    if (want('gesture')) await captureGesture(base);
  } catch (e) {
    check(`run completed without exceptions`, false, String(e && e.stack ? e.stack : e));
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
  if (ONLY.length === 0) fs.writeFileSync(path.join(OUT, 'shots-report.json'), JSON.stringify(report, null, 2));
  const bad = report.checks.filter((c) => !c.ok).length;
  console.log(`[aud-01] ${report.checks.length - bad}/${report.checks.length} checks passed, ${report.shots.length} shots -> ${path.relative(ROOT, OUT)}`);
  process.exit(failed ? 1 : 0);
})();
