#!/usr/bin/env node
/**
 * AUD-01 offline renders: WAV files + labelled spectrogram PNGs (+ contact sheets and a stats report)
 * for every music mood (30 s), ambience key, stinger and SFX (all variants back to back).
 * OWNER: Audio Developer (AUD-01).
 *
 *   node scripts/audio/render.mjs                       everything -> docs/sprint1/aud-01/
 *   node scripts/audio/render.mjs --only=sfx --filter=parry
 *   node scripts/audio/render.mjs --out=/tmp/aud --sr=44100 --seconds=20 --no-wav --ogg
 *
 * Options: --only=sfx,ambience,music,stingers  --filter=<regex on id>  --out=<dir>  --sr=<Hz>
 *          --seconds=<music seconds, default 30>  --amb-seconds=<ambience seconds, default 24>
 *          --seed=<n>  --no-wav (PNGs + report only)  --ogg (also Opus .ogg via ffmpeg when present)
 *
 * Output layout: <out>/{music,ambience,stingers,sfx}/<id>.wav|.png, <out>/sheets/<group>-<n>.png,
 * <out>/render-report.json (peak / RMS / centroid / NaN / denormal counts per render), <out>/index.html
 * (listening page for the reviewer).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadTs, ROOT } from './lib/load.mjs';
import { encodePng, encodeWav } from './lib/encode.mjs';
import { spectrogramPanel, stack } from './lib/image.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)=?(.*)$/.exec(a);
    return m ? [m[1], m[2] === '' ? true : m[2]] : [a, true];
  }),
);
const OUT = path.resolve(ROOT, typeof args.out === 'string' ? args.out : 'docs/sprint1/aud-01');
const SR = Number(args.sr ?? 48000);
const SECONDS = Number(args.seconds ?? 30);
const AMB_SECONDS = Number(args['amb-seconds'] ?? 24);
const SEED = Number(args.seed ?? 1);
const ONLY = typeof args.only === 'string' ? new Set(args.only.split(',')) : null;
const FILTER = typeof args.filter === 'string' ? new RegExp(args.filter) : null;
const WAV = !args['no-wav'];
let OGG = !!args.ogg;
if (OGG) {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    console.warn('[render] ffmpeg not found - skipping .ogg');
    OGG = false;
  }
}

/** Opus preview bitrates (the committed listening copies; the WAVs are the masters). */
const OGG_KBPS = { music: '96k', stingers: '80k', ambience: '56k', sfx: '64k' };

const { mod: A, close } = await loadTs('src/audio/offline.ts');
const { mod: AN } = await loadTs('src/audio/synth/analysis.ts');

const report = { sampleRate: SR, seed: SEED, generated: new Date().toISOString(), items: [] };
const sheets = {};

function stats(chans) {
  let peak = 0;
  let sum2 = 0;
  let nan = 0;
  let den = 0;
  let n = 0;
  for (const c of chans) {
    for (let i = 0; i < c.length; i++) {
      const x = c[i];
      if (!Number.isFinite(x)) {
        nan++;
        continue;
      }
      const a = Math.abs(x);
      if (a > peak) peak = a;
      if (a !== 0 && a < 1.1754943508222875e-38) den++;
      sum2 += x * x;
      n++;
    }
  }
  const db = (g) => (g <= 1e-12 ? -240 : 20 * Math.log10(g));
  return { peakDb: +db(peak).toFixed(2), rmsDb: +db(Math.sqrt(sum2 / Math.max(1, n))).toFixed(2), nan, denormals: den, seconds: +(chans[0].length / SR).toFixed(3) };
}

function write(group, id, chans, subtitle, extra = {}) {
  const dir = path.join(OUT, group);
  fs.mkdirSync(dir, { recursive: true });
  const st = stats(chans);
  const mono = chans.length === 1 ? chans[0] : (() => {
    const m = new Float32Array(chans[0].length);
    for (let i = 0; i < m.length; i++) m[i] = 0.5 * (chans[0][i] + chans[1][i]);
    return m;
  })();
  const centroid = Math.round(AN.spectralCentroid(mono, SR));
  const width = group === 'music' || group === 'ambience' ? 1200 : 900;
  const spec = AN.spectrogram(mono, SR, Math.min(width - 54, Math.max(200, Math.round(mono.length / 512))), 220);
  const panel = spectrogramPanel({
    title: `${group}/${id}`,
    subtitle: `${subtitle ?? ''}  PEAK ${st.peakDb}DB  RMS ${st.rmsDb}DB  CENTROID ${centroid}HZ`,
    channels: chans,
    sr: SR,
    spec,
    width,
  });
  fs.writeFileSync(path.join(dir, `${id}.png`), encodePng(panel.width, panel.height, panel.rgb));
  if (WAV) {
    const wavPath = path.join(dir, `${id}.wav`);
    fs.writeFileSync(wavPath, encodeWav(chans, SR, 16));
    if (OGG) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wavPath, '-c:a', 'libopus', '-b:a', OGG_KBPS[group] ?? '64k', path.join(dir, `${id}.ogg`)]);
  }
  (sheets[group] ??= []).push(panel);
  report.items.push({ group, id, ...st, centroidHz: centroid, ...extra });
  console.log(`[render] ${group.padEnd(9)} ${id.padEnd(26)} ${String(st.seconds).padStart(7)}s  peak ${String(st.peakDb).padStart(7)} dB  rms ${String(st.rmsDb).padStart(7)} dB  centroid ${String(centroid).padStart(5)} Hz${st.nan || st.denormals ? `  NAN ${st.nan} DEN ${st.denormals}` : ''}`);
}

/** Reviewer listening page: every render with its player (Opus when encoded, else WAV) and spectrogram. */
function listeningPage(rep) {
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const titles = { music: 'Score - 30 s per mood', stingers: 'Stingers', ambience: 'Ambience - district keys, world beds, battle bed', sfx: 'SFX - all variants back to back' };
  const sections = ['music', 'stingers', 'ambience', 'sfx']
    .map((g) => {
      const items = rep.items.filter((it) => it.group === g).sort((a, b) => a.id.localeCompare(b.id));
      if (items.length === 0) return '';
      const cards = items
        .map((it) => {
          const base = `${g}/${it.id}`;
          const src = fs.existsSync(path.join(OUT, `${base}.ogg`)) ? `${base}.ogg` : fs.existsSync(path.join(OUT, `${base}.wav`)) ? `${base}.wav` : null;
          const facts = [it.raga && `${it.raga} / ${it.tala} / ${it.section}`, `${it.seconds}s`, `peak ${it.peakDb} dB`, `RMS ${it.rmsDb} dB`, `centroid ${it.centroidHz} Hz`, it.variants && `${it.variants} variants`, it.seam && `seam ${it.seam.levelDiffDb.toFixed(1)} dB`].filter(Boolean).join(' · ');
          return `<article><h3>${esc(it.id)}</h3><p>${esc(facts)}</p>${src ? `<audio controls preload="none" src="${esc(src)}"></audio>` : '<p class="na">render with WAV / --ogg to listen</p>'}<img loading="lazy" src="${esc(base)}.png" alt="spectrogram of ${esc(it.id)}"></article>`;
        })
        .join('');
      return `<section><h2>${esc(titles[g])} <small>${items.length}</small></h2>${cards}</section>`;
    })
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AUD-01 Renders</title>
<style>:root{--bg:#f7f5f0;--fg:#1d1b18;--muted:#6b665d;--card:#fff;--line:#e2ddd3}@media (prefers-color-scheme:dark){:root{--bg:#16140f;--fg:#eee9df;--muted:#a59f93;--card:#211e18;--line:#38332a}}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:1240px;margin:0 auto}
h1{font-size:22px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 12px;border-bottom:1px solid var(--line);padding-bottom:6px}h2 small{color:var(--muted);font-weight:400}
section{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,560px),1fr));gap:12px}section h2{grid-column:1/-1}
article{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;min-width:0}article h3{margin:0;font-size:15px}article p{margin:2px 0 8px;color:var(--muted);font-size:13px}
audio{width:100%;height:36px}img{display:block;width:100%;height:auto;margin-top:8px;border-radius:4px}.na{font-style:italic}</style></head>
<body><main><h1>AUD-01 procedural audio - offline renders</h1><p>${esc(rep.items.length)} renders at ${esc(rep.sampleRate)} Hz, seed ${esc(rep.seed)}. Regenerate: <code>node scripts/audio/render.mjs --ogg</code>. Spectrograms are log-frequency (30 Hz - Nyquist), magma scale.</p>${sections}</main></body></html>
`;
}

const want = (group, id) => (!ONLY || ONLY.has(group)) && (!FILTER || FILTER.test(id));
const t0 = Date.now();

// ---------------------------------------------------------------------------------------------- MUSIC
const MOODS = ['menu', 'world', 'city', 'hero_explore', 'hero_combat', 'duel', 'battle', 'siege', 'victory', 'defeat'];
if (!ONLY || ONLY.has('music')) {
  for (const mood of MOODS) {
    if (!want('music', mood)) continue;
    const t1 = Date.now();
    const r = A.renderMood(mood, SECONDS, SR, SEED);
    const ms = Date.now() - t1;
    const s = r.stats;
    write('music', mood, [r.L, r.R], `${s.raga.toUpperCase()}  ${s.tala.toUpperCase()}  ${s.section.toUpperCase()}  ${s.bpm} BPM  I=${s.intensity}  RENDER ${(ms / 1000 / SECONDS).toFixed(3)}X RT`, { ...s, renderMsPerSec: Math.round(ms / SECONDS) });
  }
}

// ------------------------------------------------------------------------------------------- STINGERS
const STINGERS = ['age_up', 'landmark_complete', 'construction_complete', 'harvest', 'battle_start', 'duel_phase', 'mission_success', 'mission_failure', 'victory', 'defeat'];
if (!ONLY || ONLY.has('stingers')) {
  for (const id of STINGERS) {
    if (!want('stingers', id)) continue;
    const s = A.renderStinger(id, SR, SEED);
    write('stingers', id, [s.L, s.R], 'STINGER');
  }
}

// ------------------------------------------------------------------------------------------------ SFX
if (!ONLY || ONLY.has('sfx')) {
  for (const id of A.ALL_SFX) {
    if (!want('sfx', id)) continue;
    const vars = A.renderSfxVariants(id, SR, SEED);
    const gap = Math.round(0.3 * SR);
    const total = vars.reduce((s, v) => s + v.length + gap, 0);
    const cat = new Float32Array(total);
    let o = 0;
    for (const v of vars) {
      cat.set(v, o);
      o += v.length + gap;
    }
    write('sfx', id, [cat], `${vars.length} VARIANTS`, { variants: vars.length, variantSeconds: vars.map((v) => +(v.length / SR).toFixed(3)) });
  }
}

// ------------------------------------------------------------------------------------------ AMBIENCE
if (!ONLY || ONLY.has('ambience')) {
  for (const key of A.AMBIENCE_KEYS) {
    if (!want('ambience', key)) continue;
    const def = A.ambienceDef(key);
    const st = A.simulateAmbience(key, AMB_SECONDS, SR, SEED);
    const extra = { category: def.category, spots: def.spots.map((x) => x.name) };
    if (def.bed) {
      const bed = A.renderBed(key, SR, SEED);
      extra.bedSeconds = +(bed.data.length / bed.sampleRate).toFixed(3);
      extra.bedRate = bed.sampleRate;
      extra.seam = AN.loopSeam(bed.data, bed.sampleRate);
    }
    write('ambience', key, [st.L, st.R], `${def.category.toUpperCase()}  ${def.bed ? `BED ${extra.bedSeconds}S LOOP` : 'SPOTS ONLY'}  ${def.spots.length} SPOT TYPES`, extra);
  }
}

// ----------------------------------------------------------------------------------- contact sheets
fs.mkdirSync(path.join(OUT, 'sheets'), { recursive: true });
for (const [group, panels] of Object.entries(sheets)) {
  const per = group === 'sfx' ? 6 : 4;
  for (let i = 0; i < panels.length; i += per) {
    const img = stack(panels.slice(i, i + per));
    fs.writeFileSync(path.join(OUT, 'sheets', `${group}-${String(i / per + 1).padStart(2, '0')}.png`), encodePng(img.width, img.height, img.rgb));
  }
}
const prev = fs.existsSync(path.join(OUT, 'render-report.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'render-report.json'), 'utf8')) : null;
if (prev && (ONLY || FILTER)) {
  // Partial run: merge into the existing report.
  const key = (it) => `${it.group}/${it.id}`;
  const fresh = new Set(report.items.map(key));
  report.items = [...prev.items.filter((it) => !fresh.has(key(it))), ...report.items];
}
fs.writeFileSync(path.join(OUT, 'render-report.json'), JSON.stringify(report, null, 1));
fs.writeFileSync(path.join(OUT, 'index.html'), listeningPage(report));
console.log(`[render] ${report.items.length} renders in ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${path.relative(ROOT, OUT)}/`);
await close();
process.exit(0);
