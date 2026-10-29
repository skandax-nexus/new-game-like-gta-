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
    if (OGG) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wavPath, '-c:a', 'libopus', '-b:a', group === 'music' ? '128k' : '96k', path.join(dir, `${id}.ogg`)]);
  }
  (sheets[group] ??= []).push(panel);
  report.items.push({ group, id, ...st, centroidHz: centroid, ...extra });
  console.log(`[render] ${group.padEnd(9)} ${id.padEnd(26)} ${String(st.seconds).padStart(7)}s  peak ${String(st.peakDb).padStart(7)} dB  rms ${String(st.rmsDb).padStart(7)} dB  centroid ${String(centroid).padStart(5)} Hz${st.nan || st.denormals ? `  NAN ${st.nan} DEN ${st.denormals}` : ''}`);
}

const want = (group, id) => (!ONLY || ONLY.has(group)) && (!FILTER || FILTER.test(id));
const t0 = Date.now();

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
console.log(`[render] ${report.items.length} renders in ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${path.relative(ROOT, OUT)}/`);
await close();
process.exit(0);
