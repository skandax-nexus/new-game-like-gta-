#!/usr/bin/env node
/**
 * TA-01 evidence capture (WP1 PBR materials, terrain layers, decal atlas). OWNER: Technical Artist A (TA-01).
 *
 *   npx vite build --outDir .build/ta-01/dist --emptyOutDir
 *   NODE_PATH=$(npm root -g) node scripts/shots/ta-01.cjs [--only=deltas,budgets,previews,tiling,swatches,decals,viewer,splat,slope,stupa,mobile,varsha]
 *                                                         [--ids=a,b] [--fast] [--reuse]
 *
 * Env: SHOTS_PORT (default 4404), SHOTS_DIST (default .build/ta-01/dist), SHOTS_OUT (default docs/sprint1/ta-01).
 *
 *   deltas    mean baseColor of every PUBLISHED WebP (all tiers; linear mean per channel -> sRGB) against the Art
 *             Director's target (MATERIAL_PRESETS / TERRAIN_LAYERS baseColor via `npm run assets -- --style`):
 *             per-channel and luminance delta in %, PASS within +-6 %. Also (round 1 review): the ultra WebP mean vs
 *             the cache asset.json QA meanColor (B2: they must agree), HSV saturation p98 / value p98 / lime share
 *             (AD-4) and, for terrain layers, the ORM.r (height-blend proxy) 5th..95th percentile span (B6: >= 0.3).
 *             Art Director desk rulings (docs/art/reviews/ta-01.md AD-8) replace a preset that still holds its old
 *             value. -> deltas.md, stats.md, report.json
 *   budgets   WP1 bytes per tier from the generated manifest vs the ASSET_LIST budget (36 / 16 / 5.3 MB)
 *   previews  Cycles previews in docs/screenshots/pipeline/wp1 (copied by the runner's --previews-dir) re-encoded
 *             to JPEG (q82, tiling shots 768 px) to keep the repository small
 *   tiling    3 x 3 repeats under raking golden light (Cycles, the runner's preview_tiling) -> tiling/<id>.jpg +
 *             tiling_sheet.jpg
 *   swatches  256 px swatch board (target / measured chips) -> swatches.png, palette.png
 *   viewer    asset viewer lookdev (wall corner, column, sphere) at ~1.2 m (camera=detail) and ~9 m
 *             (camera=overview) under sky_day and sky_golden -> viewer/<id>.jpg (2 x 2 contact sheet)
 *   splat     4-layer height-blended splat lookdev of every BIOME_TERRAIN recipe under sky_golden and sky_day ->
 *             splat/<biome>_<sky>.jpg + splat_sheet_golden.jpg / splat_sheet_day.jpg
 *   decals    the shipped decal atlas composited by its ORM.b opacity over wall (plaster) / ground (earth)
 *             backdrops per region, labelled with the metadata.decals regions -> decals_atlas.png
 *   stupa     stupa_sanchi as published (samrajya_set sandstone_carved_red) and re-skinned to sandstone_buff by
 *             rewriting the GLB JSON chunk in flight (page.route) -> proves the shared trim-band layout; golden + day
 *   mobile    every P0 set on the MOBILE texture tier (assets=mobile, quality=low): architecture in the viewer at
 *             ~1.2 m and ~9 m under sky_day, terrain layers as a single-layer splat patch -> mobile/<id>.jpg
 *   slope     the three triplanar rock layers on a 38-58 deg escarpment (world-space triplanar injected into the
 *             viewer page, v = up), ultra golden / day / day close and mobile day -> slope/<id>_*.jpg + slope_sheet.jpg
 *   varsha    marsh and farmland splat recipes wet (monsoon): the splat wetness uniform (MATERIAL_GLOBALS.wetness,
 *             reached through three.js' __THREE_DEVTOOLS__ observe hook) at 0.85 -> varsha_sheet.jpg
 * Fails (exit 1) on console errors, page errors, failed requests or a delta outside +-6 %.
 */
'use strict';
const { spawn, execFileSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.SHOTS_PORT || 4404);
const DIST = process.env.SHOTS_DIST || '.build/ta-01/dist';
const OUT = path.resolve(ROOT, process.env.SHOTS_OUT || 'docs/sprint1/ta-01');
const RAW = path.join(ROOT, '.build', 'ta-01', 'shots');
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = (/^--([^=]+)=?(.*)$/.exec(a) || [null, a, '1']).slice(1);
  return [k, v === '' ? '1' : v]; // bare flags (--fast, --reuse) are true
}));
const ONLY = args.only ? new Set(args.only.split(',')) : null;
const run = (g) => !ONLY || ONLY.has(g);
const sharp = require(path.join(ROOT, 'node_modules', 'sharp'));
const MANIFEST = fs.readFileSync(path.join(ROOT, 'src', 'assets', 'manifest.ts'), 'utf8');
const MANIFEST_JSON = JSON.parse(MANIFEST.slice(MANIFEST.indexOf('{', MANIFEST.indexOf('ASSET_MANIFEST =')), MANIFEST.indexOf('} as const') + 1));
const PUB = path.join(ROOT, 'public', 'assets');
const CACHE = path.join(ROOT, '.asset-cache');
const PREVIEWS = path.join(ROOT, 'docs', 'screenshots', 'pipeline', 'wp1');
const TOL = 6;
const BUDGET = { ultra: 36, high: 16, mobile: 5.3 };
const TIERS = ['ultra', 'high', 'mobile'];

// ------------------------------------------------------------------ WP1 discovery (script docstring tags)
function discover() {
  const out = [];
  for (const cat of ['materials', 'terrain', 'decals']) {
    const dir = path.join(ROOT, 'tools', 'blender', 'assets', cat);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.py') && !n.startsWith('_')).sort()) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      const id = /@asset[ \t]+(\w+)/.exec(src)?.[1];
      if (!id) continue;
      const styles = (/@style[ \t]+([^\n]+)/.exec(src)?.[1] ?? '').split(/[,\s]+/).filter(Boolean);
      const target = styles.find((s) => /^(materials:MATERIAL_PRESETS|terrain:TERRAIN_LAYERS)\./.test(s)) ?? null;
      const cls = /cls="(\w)"/.exec(src)?.[1] ?? '?';
      out.push({ id, cat, target, cls });
    }
  }
  return out;
}
let SETS = discover();
if (args.ids) {
  const keep = new Set(args.ids.split(','));
  SETS = SETS.filter((s) => keep.has(s.id));
}

// Art Director desk rulings (docs/art/reviews/ta-01.md AD-8), mirrored from tools/blender/assets/materials/_matkit.py
// AD_RULINGS: applied only while the preset still holds the old value.
const AD_RULINGS = {
  'materials:MATERIAL_PRESETS.roof_tile_terracotta': ['#a65a3c', '#a6644a'],
  'terrain:TERRAIN_LAYERS.laterite_soil': ['#8e5038', '#8e5a44'],
  'materials:MATERIAL_PRESETS.laterite_block': ['#8f4a34', '#8f5240'],
};

function styleValues(refs) {
  if (!refs.length) return {};
  const outp = execFileSync(process.execPath, [path.join(ROOT, 'tools', 'assets', 'build.mjs'), '--style', ...refs], { cwd: ROOT, maxBuffer: 1 << 26 }).toString();
  const vals = JSON.parse(outp.slice(outp.indexOf('{')));
  for (const [ref, [from, to]] of Object.entries(AD_RULINGS))
    if (vals[ref] && String(vals[ref].baseColor).toLowerCase() === from) vals[ref] = { ...vals[ref], baseColor: to, adRuling: `${from} -> ${to}` };
  return vals;
}

/** HSV saturation / value percentiles and the lime share (hue 70-110 deg, S > 0.55, V > 0.40) of an sRGB image. */
async function hsvStats(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const sat = new Float32Array(n);
  const val = new Float32Array(n);
  let lime = 0;
  for (let i = 0; i < n; i++) {
    const r = data[i * 3] / 255;
    const g = data[i * 3 + 1] / 255;
    const b = data[i * 3 + 2] / 255;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const sv = mx > 1e-6 ? (mx - mn) / mx : 0;
    sat[i] = sv;
    val[i] = mx;
    let hue = 0;
    if (mx - mn > 1e-6) {
      if (mx === r) hue = 60 * (((g - b) / (mx - mn)) % 6);
      else if (mx === g) hue = 60 * ((b - r) / (mx - mn) + 2);
      else hue = 60 * ((r - g) / (mx - mn) + 4);
      if (hue < 0) hue += 360;
    }
    if (hue >= 70 && hue <= 110 && sv > 0.55 && mx > 0.4) lime++;
  }
  const pct = (a, q) => Float32Array.from(a).sort()[Math.min(n - 1, Math.floor(q * n))];
  return { satP98: +pct(sat, 0.98).toFixed(3), valueP98: +pct(val, 0.98).toFixed(3), limePct: +((lime / n) * 100).toFixed(2) };
}

/** HSV hue (deg) / saturation / value per pixel of an sRGB image (optionally resized to `size`). */
async function hsvPixels(file, size = null) {
  let img = sharp(file).removeAlpha();
  if (size) img = img.resize(size, size, { kernel: 'lanczos3', fit: 'fill' });
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const H = new Float32Array(n);
  const S = new Float32Array(n);
  const V = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * 3] / 255;
    const g = data[i * 3 + 1] / 255;
    const b = data[i * 3 + 2] / 255;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    let hue = 0;
    if (mx - mn > 1e-6) {
      if (mx === r) hue = 60 * (((g - b) / (mx - mn)) % 6);
      else if (mx === g) hue = 60 * ((b - r) / (mx - mn) + 2);
      else hue = 60 * ((r - g) / (mx - mn) + 4);
      if (hue < 0) hue += 360;
    }
    H[i] = hue;
    S[i] = mx > 1e-6 ? (mx - mn) / mx : 0;
    V[i] = mx;
  }
  return { H, S, V, n, width: info.width };
}
const pctl = (a, q) => Float32Array.from(a).sort()[Math.min(a.length - 1, Math.floor(q * a.length))];
const hexHue = (hex) => {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (mx - mn < 1e-6) return 0;
  let h = mx === r ? 60 * (((g - b) / (mx - mn)) % 6) : mx === g ? 60 * ((b - r) / (mx - mn) + 2) : 60 * ((r - g) / (mx - mn) + 4);
  return h < 0 ? h + 360 : h;
};

/** 5th / 95th percentile of a channel (0..1) of an image. */
async function channelSpan(file, ch) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) v[i] = data[i * info.channels + ch] / 255;
  v.sort();
  const p5 = v[Math.floor(0.05 * n)];
  const p95 = v[Math.floor(0.95 * n)];
  return { p5: +p5.toFixed(3), p95: +p95.toFixed(3), span: +(p95 - p5).toFixed(3) };
}

// ------------------------------------------------------------------ colour helpers
const lin = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const enc = (l) => 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbToHex = (c) => '#' + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
const lum = (l) => 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];

/** Linear mean per channel of an sRGB image (alpha ignored), re-encoded to sRGB 0..255. */
async function meanColor(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const s = [0, 0, 0];
  const n = info.width * info.height;
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) s[c] += lin(data[i * 3 + c]);
  const m = s.map((v) => v / n);
  return { srgb: m.map(enc), linear: m };
}

// ------------------------------------------------------------------ sheets
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function labelSvg(w, h, text, { size = 15, fill = '#f3e6c8', bg = 'rgba(18,13,31,0.78)', align = 'left' } = {}) {
  const x = align === 'left' ? 8 : w / 2;
  const anchor = align === 'left' ? 'start' : 'middle';
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${bg}"/>` +
      `<text x="${x}" y="${Math.round(h * 0.68)}" font-family="DejaVu Sans, sans-serif" font-size="${size}" fill="${fill}" text-anchor="${anchor}">${esc(text)}</text></svg>`,
  );
}

/** Grid contact sheet: items [{file, label}] -> JPEG (or PNG by extension). */
async function sheet(items, cols, cw, ch, out, title) {
  const lh = 24;
  const th = title ? 34 : 0;
  const rows = Math.ceil(items.length / cols);
  const W = cols * cw;
  const H = th + rows * (ch + lh);
  const comps = [];
  if (title) comps.push({ input: labelSvg(W, th, title, { size: 18, bg: '#120d1f' }), left: 0, top: 0 });
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const x = (i % cols) * cw;
    const y = th + Math.floor(i / cols) * (ch + lh);
    if (it.file && fs.existsSync(it.file)) comps.push({ input: await sharp(it.file).resize(cw, ch, { fit: 'cover' }).toBuffer(), left: x, top: y });
    comps.push({ input: labelSvg(cw, lh, it.label, { size: 13 }), left: x, top: y + ch });
  }
  const img = sharp({ create: { width: W, height: H, channels: 3, background: '#1a1626' } }).composite(comps);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (out.endsWith('.png')) await img.png().toFile(out);
  else await img.jpeg({ quality: 84, mozjpeg: true }).toFile(out);
}

// ------------------------------------------------------------------ browser plumbing (pattern of ta-07.cjs)
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
    const tryOnce = () =>
      http
        .get(url, (res) => {
          res.resume();
          if (res.statusCode && res.statusCode < 500) resolve();
          else retry();
        })
        .on('error', retry);
    const retry = () => (Date.now() - t0 > ms ? reject(new Error(`server not up at ${url}`)) : setTimeout(tryOnce, 300));
    tryOnce();
  });
}

/** glTF binary with every `"samrajya_set": "<from>"` in the JSON chunk replaced by `<to>` (chunk re-padded). */
function rewriteGlb(buf, from, to) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLen = buf.readUInt32LE(12);
  const jsonType = buf.readUInt32LE(16);
  const json = buf.subarray(20, 20 + jsonLen).toString('utf8');
  let count = 0;
  let j2 = json.replace(new RegExp(`("samrajya_set"\\s*:\\s*")${from}(")`, 'g'), (_, a, b) => {
    count++;
    return a + to + b;
  });
  const pad = (4 - (Buffer.byteLength(j2) % 4)) % 4;
  j2 += ' '.repeat(pad);
  const jb = Buffer.from(j2, 'utf8');
  const rest = buf.subarray(20 + jsonLen);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(buf.readUInt32LE(4), 4);
  header.writeUInt32LE(12 + 8 + jb.length + rest.length, 8);
  const chunk = Buffer.alloc(8);
  chunk.writeUInt32LE(jb.length, 0);
  chunk.writeUInt32LE(jsonType, 4);
  return { buf: Buffer.concat([header, chunk, jb, rest]), count };
}

/**
 * Page function (runs in the asset viewer with `asset=<rock layer>`): the review asked for the triplanar rock layers
 * on a real 35-60 deg slope, not a flat splat patch (AD-11). The viewer's material lookdev has already loaded the
 * shipped texture set; this hides the lookdev pieces and adds a 40 m escarpment (faces 41-59 deg, flat top and foot)
 * whose material samples the SAME textures with world-space TRIPLANAR projection (v = world up on the side
 * projections, as the layers are authored; the top projection on the ledges; blend weights |n|^4). The camera is
 * set in scene.onBeforeRender (the viewer's camera is not reachable otherwise). three.js is not global: the
 * constructors come from the viewer's own objects.
 */
function SLOPE_LOOKDEV(o) {
  const scenes = window.__ta01Scenes || [];
  let src = null;
  let scene = null;
  for (const sc of scenes)
    sc.traverse((m) => {
      if (!src && m.isMesh && m.material && m.material.map && m.material.normalMap && m.geometry && m.geometry.type === 'PlaneGeometry') {
        src = m;
        scene = sc;
      }
    });
  if (!src) return 'no lookdev mesh with a texture set found';
  const sm = src.material;
  scene.traverse((m) => {
    if (m.isMesh && m.material && m.material.map === sm.map) m.visible = false;
    if (m.isMesh && m.material && sm.normalMap && m.material.normalMap === sm.normalMap) m.visible = false;
  });
  const geo = new src.geometry.constructor(44, 36, 220, 180);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position');
  const H = 13;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const zc = -4 + 2.4 * Math.sin(0.23 * x + 0.4) + 1.3 * Math.sin(0.61 * x + 1.0);
    const k = 3.0 + 0.95 * Math.sin(0.19 * x + 2.0); // max slope H / 4k: 0.79..1.6 m/m = 38..58 deg
    const t = (zc - z) / k;
    const y = H / (1 + Math.exp(-t)) + 0.35 * Math.sin(0.9 * x) * Math.exp(-t * t);
    pos.setY(i, y + 0.03);
  }
  geo.computeVertexNormals();
  // move the escarpment (and the camera, below) 30 m east of the viewer's lookdev rig: whatever the rig leaves in
  // its screen-space buffers (contact shadow / AO of the hidden column) then stays out of frame
  geo.translate(30, 0, 0);
  const mat = new sm.constructor({ map: sm.map, normalMap: sm.normalMap, roughnessMap: sm.roughnessMap, aoMap: sm.roughnessMap, metalness: 0, roughness: 1 });
  mat.normalScale.copy(sm.normalScale);
  mat.aoMapIntensity = 1;
  mat.customProgramCacheKey = () => 'ta01-triplanar';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTpTile = { value: 1 / o.tile };
    shader.uniforms.uTpVs = { value: sm.map.flipY ? 1 : -1 };
    shader.vertexShader = 'varying vec3 vTpPos;\nvarying vec3 vTpN;\n' + shader.vertexShader.replace('#include <fog_vertex>',
      '#include <fog_vertex>\n vTpPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n vTpN = normalize(mat3(modelMatrix) * objectNormal);');
    const fns = `
vec3 tpW() { vec3 n = normalize(vTpN); vec3 w = pow(abs(n), vec3(4.0)); return w / (w.x + w.y + w.z); }
vec2 tpUvX() { float s = vTpN.x >= 0.0 ? 1.0 : -1.0; return vec2(-s * vTpPos.z, uTpVs * vTpPos.y) * uTpTile; }
vec2 tpUvY() { return vec2(vTpPos.x, vTpPos.z) * uTpTile; }
vec2 tpUvZ() { float s = vTpN.z >= 0.0 ? 1.0 : -1.0; return vec2(s * vTpPos.x, uTpVs * vTpPos.y) * uTpTile; }
vec4 tpSample(sampler2D t) { vec3 w = tpW(); return texture2D(t, tpUvX()) * w.x + texture2D(t, tpUvY()) * w.y + texture2D(t, tpUvZ()) * w.z; }
vec3 tpNormal() {
  vec3 w = tpW();
  vec3 a = texture2D(normalMap, tpUvX()).xyz * 2.0 - 1.0; a.xy *= normalScale;
  vec3 b = texture2D(normalMap, tpUvY()).xyz * 2.0 - 1.0; b.xy *= normalScale;
  vec3 c = texture2D(normalMap, tpUvZ()).xyz * 2.0 - 1.0; c.xy *= normalScale;
  float sx = vTpN.x >= 0.0 ? 1.0 : -1.0; float sy = vTpN.y >= 0.0 ? 1.0 : -1.0; float sz = vTpN.z >= 0.0 ? 1.0 : -1.0;
  vec3 nx = vec3(sx * a.z, uTpVs * a.y, -sx * a.x);
  vec3 ny = vec3(b.x, sy * b.z, b.y);
  vec3 nz = vec3(sz * c.x, uTpVs * c.y, sz * c.z);
  return normalize(nx * w.x + ny * w.y + nz * w.z);
}
`;
    shader.fragmentShader = 'varying vec3 vTpPos;\nvarying vec3 vTpN;\nuniform float uTpTile;\nuniform float uTpVs;\n' + shader.fragmentShader
      .replace('#include <clipping_planes_pars_fragment>', '#include <clipping_planes_pars_fragment>\n' + fns)
      .replace('#include <map_fragment>', 'diffuseColor *= tpSample( map );')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * tpSample( roughnessMap ).g;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize( ( viewMatrix * vec4( tpNormal(), 0.0 ) ).xyz );')
      .replace('#include <aomap_fragment>', `float ambientOcclusion = ( tpSample( aoMap ).r - 1.0 ) * aoMapIntensity + 1.0;
reflectedLight.indirectDiffuse *= ambientOcclusion;
#if defined( USE_ENVMAP ) && defined( STANDARD )
  float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
  reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
#endif`);
  };
  // the hidden lookdev pieces (wall corner, column, sphere) must not keep casting their shadows onto the escarpment
  for (const sc of scenes) sc.traverse((m) => {
    if (!m.isMesh) return;
    m.castShadow = false;
    // the column / sphere may carry cloned materials (same image source): hide them too, or they poke through the hill
    const mm = m.material;
    if (mm && ((mm.map && sm.map && mm.map.source === sm.map.source) || (mm.normalMap && sm.normalMap && mm.normalMap.source === sm.normalMap.source))) m.visible = false;
    // anything small left of the lookdev rig (contact-shadow blobs, helpers) would show through the hill
    if (m.geometry) {
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      const r = m.geometry.boundingSphere ? m.geometry.boundingSphere.radius * Math.max(m.scale.x, m.scale.y, m.scale.z) : 0;
      if (r < 30) m.visible = false;
    }
  });
  const hill = new src.constructor(geo, mat);
  hill.name = 'ta01_slope_lookdev';
  hill.castShadow = false;
  hill.receiveShadow = false;
  scene.add(hill);
  const prev = scene.onBeforeRender;
  const eye = [o.eye[0] + 30, o.eye[1], o.eye[2]];
  const at = [o.at[0] + 30, o.at[1], o.at[2]];
  scene.onBeforeRender = function (renderer, sc, camera, rt) {
    if (prev) prev.call(this, renderer, sc, camera, rt);
    if (renderer && renderer.shadowMap) renderer.shadowMap.needsUpdate = true; // re-render shadows without the hidden pieces
    if (camera && camera.isPerspectiveCamera) {
      camera.position.set(eye[0], eye[1], eye[2]);
      camera.lookAt(at[0], at[1], at[2]);
      camera.far = Math.max(camera.far, 3000);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
    }
  };
  return 'ok';
}

/** Review round 2 measurements (AD-4 on every tier, AD-11 sandstone laminae, B4 basalt flow top). */
async function round2Stats(failures, report) {
  const out = ['## Review round 2', ''];
  // AD-4: grass_lush saturation p98 <= 0.50 and lime 0 % in the SHIPPED WebP on every tier
  const g = MANIFEST_JSON.assets.terrain_grass_lush;
  if (g) {
    out.push('**AD-4 terrain_grass_lush** (shipped lossy WebP; target sat p98 <= 0.50, lime 0 %, blade hue 65-85 deg, V p98 <= 0.55):', '');
    out.push('| tier | file | sat p98 | value p98 | lime % | hue p5 / p50 / p95 (deg) |', '|---|---|---|---|---|---|');
    const rows = {};
    for (const t of TIERS) {
      const m = g.maps?.baseColor?.[t];
      if (!m) continue;
      const f = path.join(PUB, m.url);
      const hs = await hsvStats(f);
      const px = await hsvPixels(f);
      const hues = px.H.filter((_, i) => px.S[i] > 0.2);
      const hq = [0.05, 0.5, 0.95].map((q) => pctl(hues, q).toFixed(0));
      rows[t] = { ...hs, hue: hq.map(Number) };
      out.push(`| ${t} | ${m.url} | ${hs.satP98} | ${hs.valueP98} | ${hs.limePct} | ${hq.join(' / ')} |`);
      if (hs.satP98 > 0.5 || hs.limePct > 0) failures.push(`terrain_grass_lush ${t}: sat p98 ${hs.satP98} / lime ${hs.limePct} % (AD-4)`);
    }
    report.ad4 = rows;
    out.push('');
  }
  // AD-11: rock_sandstone lamina hue within +-6 deg of #a88a6c, saturation <= 0.45, value contrast <= 8 % at the
  // lamina scale (value high-passed at ~0.3 m: |V - local mean| / mean, p95)
  const sd = MANIFEST_JSON.assets.terrain_rock_sandstone;
  if (sd) {
    const m = sd.maps.baseColor.ultra;
    const px = await hsvPixels(path.join(PUB, m.url));
    const th = hexHue('#a88a6c');
    const dh = Float32Array.from(px.H, (h) => ((h - th + 540) % 360) - 180);
    const w = px.width;
    const tile = sd.tileSizeMeters?.[0] ?? 10;
    const rad = Math.max(1, Math.round((0.3 / tile) * w));
    // box mean of V over a (2 rad + 1)^2 window (wrapping), via a summed-area table
    const sat = new Float64Array((w + 1) * (w + 1));
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) sat[(y + 1) * (w + 1) + x + 1] = px.V[y * w + x] + sat[y * (w + 1) + x + 1] + sat[(y + 1) * (w + 1) + x] - sat[y * (w + 1) + x];
    const box = (x0, y0, x1, y1) => sat[y1 * (w + 1) + x1] - sat[y0 * (w + 1) + x1] - sat[y1 * (w + 1) + x0] + sat[y0 * (w + 1) + x0];
    const rel = new Float32Array(w * w);
    let k = 0;
    for (let y = rad; y < w - rad; y++)
      for (let x = rad; x < w - rad; x++) {
        const mu = box(x - rad, y - rad, x + rad + 1, y + rad + 1) / ((2 * rad + 1) ** 2);
        rel[k++] = Math.abs(px.V[y * w + x] - mu) / Math.max(mu, 1e-4);
      }
    const relv = rel.subarray(0, k);
    const res = {
      hueDevP5: +pctl(dh, 0.05).toFixed(1),
      hueDevP95: +pctl(dh, 0.95).toFixed(1),
      satP98: +pctl(px.S, 0.98).toFixed(3),
      laminaValueContrastP90: +(pctl(relv, 0.9) * 100).toFixed(1),
    };
    report.ad11 = res;
    out.push('**AD-11 terrain_rock_sandstone** (ultra baseColor; target hue within +-6 deg of #a88a6c, saturation <= 0.45, lamina value contrast <= 8 %):', '');
    out.push(`- hue deviation from #a88a6c (${th.toFixed(0)} deg): p5 ${res.hueDevP5} / p95 ${res.hueDevP95} deg`);
    out.push(`- HSV saturation p98: ${res.satP98}`);
    out.push(`- value contrast at the lamina scale (|V - 0.3 m local mean| / mean), p90: ${res.laminaValueContrastP90} %`, '');
    if (Math.abs(res.hueDevP5) > 6 || Math.abs(res.hueDevP95) > 6 || res.satP98 > 0.45 || res.laminaValueContrastP90 > 8)
      failures.push(`terrain_rock_sandstone: AD-11 ${JSON.stringify(res)}`);
  }
  // B4: basalt flow-top value within -10 % / +8 % of #5a5650 (flow top = the recessed band: lowest 8 % of the cached
  // height, measured on the shipped ultra baseColor)
  const bs = MANIFEST_JSON.assets.terrain_rock_basalt;
  const hpng = path.join(CACHE, 'terrain_rock_basalt', 'terrain_rock_basalt_height.png');
  if (bs && fs.existsSync(hpng)) {
    const m = bs.maps.baseColor.ultra;
    const px = await hsvPixels(path.join(PUB, m.url));
    const { data: hd, info: hi } = await sharp(hpng).resize(px.width, px.width, { kernel: 'cubic', fit: 'fill' }).extractChannel(0).raw({ depth: 'ushort' }).toBuffer({ resolveWithObject: true });
    const hv = new Float32Array(hi.width * hi.height);
    const u16 = new Uint16Array(hd.buffer, hd.byteOffset, hv.length);
    for (let i = 0; i < hv.length; i++) hv[i] = u16[i];
    const thr = pctl(hv, 0.08);
    let s = 0;
    let n = 0;
    for (let i = 0; i < hv.length; i++) if (hv[i] <= thr) {
      s += px.V[i];
      n++;
    }
    const target = Math.max(...hexToRgb('#5a5650')) / 255;
    const ratio = n ? s / n / target - 1 : null;
    report.b4 = { flowTopValue: n ? +(s / n).toFixed(3) : null, target: +target.toFixed(3), deltaPct: ratio === null ? null : +(ratio * 100).toFixed(1) };
    out.push('**B4 terrain_rock_basalt** flow top (recessed band = lowest 8 % of the height) mean HSV value vs #5a5650:', '');
    out.push(`- ${report.b4.flowTopValue} vs ${report.b4.target}: ${report.b4.deltaPct} % (target -10 % .. +8 %)`, '');
    if (ratio !== null && (ratio < -0.1 || ratio > 0.08)) failures.push(`terrain_rock_basalt: flow-top value ${report.b4.deltaPct} % (B4)`);
  }
  return out;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(RAW, { recursive: true });
  const report = { generated: new Date().toISOString(), tolerancePct: TOL, sets: {}, budgets: null, shots: [], failures: [] };
  const failures = report.failures;

  // ---------------------------------------------------------------- deltas
  const targets = styleValues([...new Set(SETS.map((s) => s.target).filter(Boolean))]);
  if (run('deltas')) {
    const rows = [];
    for (const s of SETS) {
      const e = MANIFEST_JSON.assets[s.id];
      if (!e) {
        failures.push(`${s.id}: not in the manifest (not published)`);
        continue;
      }
      const t = s.target ? targets[s.target]?.baseColor : null;
      const r = { id: s.id, class: s.cls, target: t ?? null, tiers: {} };
      for (const tier of TIERS) {
        const m = e.maps?.baseColor?.[tier];
        if (!m) continue;
        const mc = await meanColor(path.join(PUB, m.url));
        const hex = rgbToHex(mc.srgb);
        const row = { url: m.url, size: m.size, mean: hex };
        if (t) {
          const tc = hexToRgb(t);
          row.deltaRgbPct = mc.srgb.map((v, c) => +(((v - tc[c]) / Math.max(tc[c], 1)) * 100).toFixed(2));
          row.deltaLumPct = +((lum(mc.linear) / lum(tc.map(lin)) - 1) * 100).toFixed(2);
          row.pass = row.deltaRgbPct.every((d) => Math.abs(d) <= TOL) && Math.abs(row.deltaLumPct) <= TOL;
          if (!row.pass) failures.push(`${s.id} ${tier}: mean ${hex} vs ${t} outside +-${TOL} %`);
        }
        r.tiers[tier] = row;
      }
      report.sets[s.id] = r;
      const u = r.tiers.ultra;
      const worst = t ? Math.max(...TIERS.flatMap((k) => (r.tiers[k] ? [...r.tiers[k].deltaRgbPct.map(Math.abs), Math.abs(r.tiers[k].deltaLumPct)] : []))) : null;
      rows.push({ id: s.id, cls: s.cls, t, u: u?.mean, h: r.tiers.high?.mean, m: r.tiers.mobile?.mean, d: u?.deltaRgbPct, dl: u?.deltaLumPct, worst });
      console.log(`[ta-01] ${s.id.padEnd(28)} ${s.cls} target ${t ?? '  (none)'}  ultra ${u?.mean} ${u?.deltaRgbPct ? u.deltaRgbPct.join('/') + ' %' : ''}  worst tier |d| ${worst ?? '-'} %`);
    }
    const md = [
      '# TA-01 - WP1 mean baseColor vs target',
      '',
      `Measured by \`scripts/shots/ta-01.cjs\` from the PUBLISHED WebP of every tier (sharp decode, linear mean per channel,`,
      `re-encoded to sRGB). Delta = (measured - target) / target per sRGB channel, luminance delta on linear luminance.`,
      `Tolerance +-${TOL} %. The decal atlas has no single target (n/a).`,
      '',
      '| id | class | target | ultra | high | mobile | ultra dR/dG/dB % | ultra dLum % | worst tier abs % | pass |',
      '|---|---|---|---|---|---|---|---|---|---|',
      ...rows.map((r) => `| ${r.id} | ${r.cls} | ${r.t ?? 'n/a'} | ${r.u ?? '-'} | ${r.h ?? '-'} | ${r.m ?? '-'} | ${r.d ? r.d.join(' / ') : 'n/a'} | ${r.dl ?? 'n/a'} | ${r.worst ?? 'n/a'} | ${r.t ? (r.worst <= TOL ? 'PASS' : 'FAIL') : 'n/a'} |`),
      '',
    ].join('\n');
    fs.writeFileSync(path.join(OUT, 'deltas.md'), md);

    // round-1 review statistics: B2 (cache QA mean == shipped WebP mean), AD-4 (saturation / lime), B6 (ORM.r span)
    const st = [];
    for (const s of SETS) {
      const e = MANIFEST_JSON.assets[s.id];
      const bc = e?.maps?.baseColor?.ultra;
      if (!bc) continue;
      const r = report.sets[s.id] ?? (report.sets[s.id] = { id: s.id, tiers: {} });
      const qaPath = path.join(CACHE, s.id, 'asset.json');
      const qa = fs.existsSync(qaPath) ? JSON.parse(fs.readFileSync(qaPath, 'utf8'))?.material?.qa ?? null : null;
      const shipped = r.tiers.ultra?.mean ?? rgbToHex((await meanColor(path.join(PUB, bc.url))).srgb);
      let qaDelta = null;
      if (qa?.meanColor) {
        const a = hexToRgb(qa.meanColor);
        const b = hexToRgb(shipped);
        qaDelta = Math.max(...a.map((v, c) => Math.abs(v - b[c])));
      }
      const hs = await hsvStats(path.join(PUB, bc.url));
      let orm = null;
      const om = e.maps?.orm?.ultra;
      if (s.cat === 'terrain' || s.id === 'ground_dry_earth') if (om) orm = await channelSpan(path.join(PUB, om.url), 0);
      r.stats = { qaMean: qa?.meanColor ?? null, shippedMean: shipped, qaVsShippedMaxLevels: qaDelta, ...hs, ormR: orm };
      if (qaDelta !== null && qaDelta > 2) failures.push(`${s.id}: cache QA mean ${qa.meanColor} != shipped ${shipped} (B2)`);
      if (orm && orm.span < 0.3) failures.push(`${s.id}: ORM.r p5..p95 span ${orm.span} < 0.3 (B6)`);
      st.push(`| ${s.id} | ${qa?.meanColor ?? '-'} | ${shipped} | ${qaDelta ?? '-'} | ${hs.satP98} | ${hs.valueP98} | ${hs.limePct} | ${orm ? `${orm.p5} / ${orm.p95} / **${orm.span}**` : 'n/a'} |`);
    }
    fs.writeFileSync(
      path.join(OUT, 'stats.md'),
      [
        '# TA-01 - review statistics (published WebP)',
        '',
        '- **B2**: the cache QA mean (asset.json `material.qa.meanColor`, float64 means since round 1) against the mean of the',
        '  shipped ultra WebP (max abs difference in sRGB levels; > 2 fails).',
        '- **AD-4**: HSV saturation p98, value p98 and the lime share (hue 70-110 deg, S > 0.55, V > 0.40).',
        '- **B6**: ORM.r (the splat height-blend proxy) 5th / 95th percentile and span for every terrain layer (>= 0.3).',
        '',
        '| id | cache QA mean | shipped mean | max diff (levels) | sat p98 | value p98 | lime % | ORM.r p5 / p95 / span |',
        '|---|---|---|---|---|---|---|---|',
        ...st,
        '',
        ...(await round2Stats(failures, report)),
      ].join('\n'),
    );
  }

  // ---------------------------------------------------------------- budgets
  if (run('budgets')) {
    const all = discover();
    const sum = { ultra: 0, high: 0, mobile: 0 };
    const rows = [];
    for (const s of all) {
      const e = MANIFEST_JSON.assets[s.id];
      if (!e) continue;
      for (const t of TIERS) sum[t] += e.bytes?.[t] ?? 0;
      rows.push(`| ${s.id} | ${s.cat} | ${s.cls} | ${(e.tiers ?? TIERS).join(',')} | ${TIERS.map((t) => ((e.bytes?.[t] ?? 0) / 1024).toFixed(0)).join(' | ')} |`);
    }
    const MB = (b) => (b / (1024 * 1024)).toFixed(2);
    report.budgets = { bytes: sum, budgetMB: BUDGET, withinBudget: TIERS.every((t) => sum[t] / (1024 * 1024) <= BUDGET[t]) };
    const md = [
      '# TA-01 - WP1 texture budget (published WebP, from src/assets/manifest.ts)',
      '',
      '| id | category | class | tiers | ultra KB | high KB | mobile KB |',
      '|---|---|---|---|---|---|---|',
      ...rows,
      `| **total** | | | | **${MB(sum.ultra)} MB** | **${MB(sum.high)} MB** | **${MB(sum.mobile)} MB** |`,
      `| budget (ASSET_LIST WP1) | | | | ${BUDGET.ultra} MB | ${BUDGET.high} MB | ${BUDGET.mobile} MB |`,
      '',
    ].join('\n');
    fs.writeFileSync(path.join(OUT, 'budgets.md'), md);
    console.log(`[ta-01] WP1 totals: ultra ${MB(sum.ultra)} MB / high ${MB(sum.high)} MB / mobile ${MB(sum.mobile)} MB (budget ${BUDGET.ultra} / ${BUDGET.high} / ${BUDGET.mobile})`);
    if (!report.budgets.withinBudget) failures.push('WP1 over budget');
  }

  // ---------------------------------------------------------------- Cycles previews -> JPEG
  if (run('previews') && fs.existsSync(PREVIEWS)) {
    for (const f of fs.readdirSync(PREVIEWS).filter((n) => n.endsWith('.png'))) {
      const src = path.join(PREVIEWS, f);
      let img = sharp(src);
      if (f.includes('_tiling')) img = img.resize(768, 768);
      await img.jpeg({ quality: 82, mozjpeg: true }).toFile(src.replace(/\.png$/, '.jpg'));
      fs.unlinkSync(src);
    }
  }

  // ---------------------------------------------------------------- tiling + swatches
  const previewFile = (id, suffix) => {
    for (const p of [path.join(CACHE, id, `preview${suffix}.png`), path.join(PREVIEWS, `${id}_cycles${suffix}.jpg`), path.join(PREVIEWS, `${id}_cycles${suffix}.png`)])
      if (fs.existsSync(p)) return p;
    return null;
  };
  if (run('tiling')) {
    const items = [];
    fs.mkdirSync(path.join(OUT, 'tiling'), { recursive: true });
    for (const s of SETS.filter((x) => x.cat !== 'decals')) {
      const f = previewFile(s.id, '_tiling');
      if (!f) {
        failures.push(`${s.id}: no tiling preview`);
        continue;
      }
      const out = path.join(OUT, 'tiling', `${s.id}.jpg`);
      await sharp(f).resize(640, 640).jpeg({ quality: 80, mozjpeg: true }).toFile(out);
      items.push({ file: out, label: `${s.id} (${s.cls})` });
    }
    await sheet(items, 6, 320, 320, path.join(OUT, 'tiling_sheet.jpg'), 'WP1 - 3 x 3 repeats under raking golden light (sun 11 deg, Cycles, shipped maps)');
  }
  if (run('swatches')) {
    const comps = [];
    const cols = 8;
    const cw = 256;
    const chH = 26;
    const lh = 40;
    const sets = SETS.filter((s) => fs.existsSync(path.join(CACHE, s.id, 'swatch.png')));
    const rows = Math.ceil(sets.length / cols);
    for (let i = 0; i < sets.length; i++) {
      const s = sets[i];
      const x = (i % cols) * cw;
      const y = Math.floor(i / cols) * (cw + chH + lh);
      comps.push({ input: await sharp(path.join(CACHE, s.id, 'swatch.png')).resize(cw, cw).toBuffer(), left: x, top: y });
      const t = s.target ? targets[s.target]?.baseColor : null;
      const meas = report.sets[s.id]?.tiers?.ultra?.mean ?? MANIFEST_JSON.assets[s.id]?.averageColor ?? '#808080';
      const chip = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${chH}"><rect x="0" width="${cw / 2}" height="${chH}" fill="${t ?? '#1a1626'}"/>` +
          `<rect x="${cw / 2}" width="${cw / 2}" height="${chH}" fill="${meas}"/></svg>`,
      );
      comps.push({ input: chip, left: x, top: y + cw });
      comps.push({ input: labelSvg(cw, lh / 2, `${s.id}`, { size: 12 }), left: x, top: y + cw + chH });
      comps.push({ input: labelSvg(cw, lh / 2, `target ${t ?? 'n/a'} | measured ${meas}`, { size: 11, fill: '#c9bfa8' }), left: x, top: y + cw + chH + lh / 2 });
    }
    await sharp({ create: { width: cols * cw, height: rows * (cw + chH + lh), channels: 3, background: '#1a1626' } })
      .composite(comps)
      .png()
      .toFile(path.join(OUT, 'swatches.png'));
    // palette board: target vs measured chips per tier, grouped
    const pc = [];
    const rowH = 30;
    const W = 1100;
    pc.push({ input: labelSvg(W, rowH, 'id                              target      ultra       high        mobile', { size: 13, bg: '#120d1f' }), left: 0, top: 0 });
    sets.forEach((s, i) => {
      const y = (i + 1) * rowH;
      const t = s.target ? targets[s.target]?.baseColor : null;
      const r = report.sets[s.id]?.tiers ?? {};
      const cells = [t, r.ultra?.mean, r.high?.mean, r.mobile?.mean];
      let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${rowH}"><rect width="100%" height="100%" fill="#1a1626"/>`;
      svg += `<text x="8" y="20" font-family="DejaVu Sans Mono, monospace" font-size="13" fill="#f3e6c8">${esc(s.id)}</text>`;
      cells.forEach((c, k) => {
        if (!c) return;
        const x = 300 + k * 200;
        svg += `<rect x="${x}" y="3" width="110" height="${rowH - 6}" fill="${c}"/><text x="${x + 116}" y="20" font-family="DejaVu Sans Mono, monospace" font-size="12" fill="#c9bfa8">${c}</text>`;
      });
      svg += '</svg>';
      pc.push({ input: Buffer.from(svg), left: 0, top: y });
    });
    await sharp({ create: { width: W, height: (sets.length + 1) * rowH, channels: 3, background: '#1a1626' } })
      .composite(pc)
      .png()
      .toFile(path.join(OUT, 'palette.png'));
  }

  // ---------------------------------------------------------------- decal atlas composite (shipped maps)
  if (run('decals') && MANIFEST_JSON.assets.decals_settlement) {
    const e = MANIFEST_JSON.assets.decals_settlement;
    const pub = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'assets', 'published.json'), 'utf8'));
    const regions = pub.assets.decals_settlement?.meta?.decals ?? [];
    const bc = await sharp(path.join(PUB, e.maps.baseColor.ultra.url)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const orm = await sharp(path.join(PUB, e.maps.orm.ultra.url)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const N = bc.info.width;
    const out = Buffer.alloc(N * N * 3);
    const wall = hexToRgb('#cdbfa6').map(lin);
    const ground = hexToRgb('#9a7e5e').map(lin);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const u = (x + 0.5) / N;
        const v = 1 - (y + 0.5) / N;
        const r = regions.find((q) => u >= q.u0 && u < q.u1 && v >= q.v0 && v < q.v1);
        const back = r && r.surface === 'wall' ? wall : ground;
        const i = (y * N + x) * 3;
        const a = orm.data[(y * orm.info.width + Math.floor((x * orm.info.width) / N)) * 3 + 2] / 255;
        for (let c = 0; c < 3; c++) out[i + c] = Math.round(enc(back[c] * (1 - a) + lin(bc.data[i + c]) * a));
      }
    const labels = regions.map((q) => {
      const x = Math.round(q.u0 * N) + 4;
      const y = Math.round((1 - q.v1) * N) + 4;
      return `<text x="${x}" y="${y + 11}" font-family="DejaVu Sans, sans-serif" font-size="11" fill="#120d1f" stroke="#f3e6c8" stroke-width="2.5" paint-order="stroke">${esc(q.name)}</text>` +
        `<rect x="${Math.round(q.u0 * N) + 0.5}" y="${Math.round((1 - q.v1) * N) + 0.5}" width="${Math.round((q.u1 - q.u0) * N) - 1}" height="${Math.round((q.v1 - q.v0) * N) - 1}" fill="none" stroke="#120d1f" stroke-opacity="0.35"/>`;
    });
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${N}" height="${N}">${labels.join('')}</svg>`);
    await sharp(out, { raw: { width: N, height: N, channels: 3 } }).composite([{ input: svg, left: 0, top: 0 }]).png().toFile(path.join(OUT, 'decals_atlas.png'));
    report.decals = regions.map((q) => ({ name: q.name, category: q.category, surface: q.surface, tileU: q.tileU, uv: [q.u0, q.v0, q.u1, q.v1], sizeMeters: q.sizeMeters }));
    console.log(`[ta-01] decal atlas: ${regions.length} regions composited over wall / ground backdrops (ORM.b opacity) -> decals_atlas.png`);
  }

  // ---------------------------------------------------------------- browser groups
  const needBrowser = run('viewer') || run('splat') || run('slope') || run('stupa') || run('mobile') || run('varsha');
  if (needBrowser) {
    if (!fs.existsSync(path.join(ROOT, DIST, 'index.html'))) throw new Error(`${DIST} not built: npx vite build --outDir ${DIST} --emptyOutDir`);
    const { chromium } = requirePlaywright();
    const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
    const server = spawn(process.execPath, [viteBin, 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    const base = `http://127.0.0.1:${PORT}/`;
    let browser;
    const vp = args.fast ? [640, 360] : [960, 540];

    async function blank(file) {
      const st = await sharp(file).stats();
      return Math.max(...st.channels.slice(0, 3).map((c) => c.stdev)) < 1.5;
    }

    async function shootOnce(file, query, opts = {}) {
      const v = opts.vp ?? vp;
      const context = await browser.newContext({ viewport: { width: v[0], height: v[1] }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const errors = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
      });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`));
      let routed = null;
      if (opts.wet !== undefined || opts.slope) {
        // three.js r170 announces every Scene to window.__THREE_DEVTOOLS__ ('observe'); keep them so the splat
        // material's shared wetness uniform (MATERIAL_GLOBALS.wetness) can be set like the weather rig does.
        await page.addInitScript(() => {
          const t = new EventTarget();
          window.__ta01Scenes = [];
          t.addEventListener('observe', (e) => {
            if (e.detail && e.detail.isScene) window.__ta01Scenes.push(e.detail);
          });
          window.__THREE_DEVTOOLS__ = t;
        });
      }
      if (opts.reskin) {
        // the loader appends a cache-buster (?v=<hash>), so match on the path, not a glob
        await page.route((u) => u.pathname.endsWith('.glb'), async (route) => {
          const resp = await route.fetch();
          const body = await resp.body();
          const url = route.request().url();
          if (!url.includes(opts.reskin.model)) return route.fulfill({ response: resp, body });
          const r = rewriteGlb(body, opts.reskin.from, opts.reskin.to);
          routed = (routed ?? 0) + r.count;
          return route.fulfill({ response: resp, body: r.buf, headers: { ...resp.headers(), 'content-length': String(r.buf.length) } });
        });
      }
      const url = `${base}?scene=assetviewer&quality=${opts.quality || 'high'}&noaudio=1&noui=1&${query}`;
      const t0 = Date.now();
      let state = null;
      try {
        await page.goto(url, { waitUntil: 'load', timeout: 240000 });
        await page.waitForFunction(() => window.__SAMRAJYA__ && window.__SAMRAJYA__.ready && window.__SAMRAJYA__.sceneReady, null, { timeout: 240000, polling: 250 });
        await page.evaluate((n) => window.__SAMRAJYA__.waitFrames(n), 4);
        await page.waitForFunction(() => !document.getElementById('boot-splash'), null, { timeout: 30000, polling: 100 }).catch(() => undefined);
        if (opts.wet !== undefined) {
          const n = await page.evaluate((w) => {
            let count = 0;
            for (const sc of window.__ta01Scenes || [])
              sc.traverse((o) => {
                const u = o.material && o.material.userData && o.material.userData.samrajyaUniforms;
                if (u && u.uWetness) {
                  u.uWetness.value = w;
                  count++;
                }
              });
            return count;
          }, opts.wet);
          if (!n) errors.push('varsha: no splat material with a uWetness uniform found');
          await page.evaluate((n2) => window.__SAMRAJYA__.waitFrames(n2), 3);
        }
        if (opts.slope) {
          const res = await page.evaluate(SLOPE_LOOKDEV, opts.slope);
          if (res !== 'ok') errors.push(`slope: ${res}`);
          await page.evaluate((n2) => window.__SAMRAJYA__.waitFrames(n2), 6);
        }
        state = await page.evaluate(() => window.__SAMRAJYA__.getState().sceneState);
        await page.evaluate(() => window.__SAMRAJYA__.freeze(true));
        for (const c of await page.evaluate(() => window.__SAMRAJYA__.getErrors().map((r) => r.message))) errors.push(`crash: ${c}`);
        await page.screenshot({ path: file, timeout: 240000 });
      } catch (err) {
        errors.push(`shots: ${err && err.message ? err.message : String(err)}`);
      }
      await context.close();
      const ms = Date.now() - t0;
      return { url, ms, errors, state, routed };
    }

    async function shoot(name, file, query, opts = {}) {
      let r = await shootOnce(file, query, opts);
      for (let k = 0; k < 2 && fs.existsSync(file) && (await blank(file)); k++) r = await shootOnce(file, query, opts);
      report.shots.push({ name, url: r.url, ms: r.ms, errors: r.errors, routed: r.routed ?? undefined });
      console.log(`[ta-01] ${r.errors.length ? 'FAIL' : 'ok  '} ${name.padEnd(44)} ${String(r.ms).padStart(6)} ms`);
      for (const e of r.errors) console.log(`         ${e}`);
      if (r.errors.length) failures.push(name);
      return r;
    }

    try {
      await waitForServer(base, 30000);
      browser = await chromium.launch({
        headless: true,
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
      });

      if (run('viewer')) {
        fs.mkdirSync(path.join(OUT, 'viewer'), { recursive: true });
        const views = [
          ['sky_day', 'detail', '~1.2 m, sky_day (crop on the material)'],
          ['sky_day', 'overview', '~9 m, sky_day'],
          ['sky_golden', 'detail', '~1.2 m, sky_golden (crop on the material)'],
          ['sky_golden', 'overview', '~9 m, sky_golden'],
        ];
        // architecture sets only: terrain layers are judged in the splat group (their real context), and the decal
        // atlas is not a surface material (ORM.b = opacity) - see decals_atlas.png and the Cycles atlas preview
        for (const s of SETS.filter((x) => x.cat === 'materials')) {
          const items = [];
          for (const [sky, cam, label] of views) {
            const file = path.join(RAW, `viewer_${s.id}_${sky}_${cam}.png`);
            if (cam === 'detail') {
              // AD-8: the 1.2 m frame must be >= 60 % material. The viewer's detail preset puts the lookdev set in the
              // right half, so shoot at 1600 x 900 and crop the 16:9 window around the wall, column and sphere
              // (no rescaling up: the crop keeps the native ~1.2 m texel density).
              // The material occupies x 0.6..1.0, y 0..0.6 of the 1600 x 900 detail frame: a 720 x 405 window at
              // (880, 0) is ~85 % material (wall, column, sphere) and is only downscaled for the sheet.
              // --reuse: re-crop the raw frames of an earlier run without shooting again.
              const full = file.replace(/\.png$/, '_full.png');
              if (!(args.reuse && fs.existsSync(full)))
                await shoot(`viewer ${s.id} ${sky} ${cam}`, full, `asset=${s.id}&hdri=${sky}&camera=${cam}&assets=ultra`, { vp: [1600, 900] });
              if (fs.existsSync(full)) await sharp(full).extract({ left: 880, top: 0, width: 720, height: 405 }).toFile(file);
            } else if (!(args.reuse && fs.existsSync(file))) await shoot(`viewer ${s.id} ${sky} ${cam}`, file, `asset=${s.id}&hdri=${sky}&camera=${cam}&assets=ultra`);
            items.push({ file, label });
          }
          await sheet(items, 2, 640, 360, path.join(OUT, 'viewer', `${s.id}.jpg`), `${s.id} - asset viewer lookdev (wall corner, column, sphere), quality high, ultra textures`);
        }
      }

      if (run('splat')) {
        fs.mkdirSync(path.join(OUT, 'splat'), { recursive: true });
        const terr = fs.readFileSync(path.join(ROOT, 'src', 'render', 'style', 'terrain.ts'), 'utf8');
        const layerAsset = {};
        for (const m of terr.matchAll(/^\s+(\w+): L\(\{ id: '(\w+)'.*?assetId: (?:'(\w+)'|null)/gm)) layerAsset[m[1]] = m[3] ?? null;
        const bt = terr.slice(terr.indexOf('export const BIOME_TERRAIN'));
        report.splat = report.splat ?? {};
        for (const sky of ['sky_golden', 'sky_day']) {
          const items = [];
          for (const m of bt.matchAll(/^\s+(\w+): \{ layers: \[([^\]]+)\]/gm)) {
            const biome = m[1];
            const keys = m[2].split(',').map((x) => x.trim().replace(/'/g, ''));
            const ids = keys.map((k) => layerAsset[k] ?? k);
            const missing = ids.filter((id) => !MANIFEST_JSON.assets[id]);
            const file = path.join(RAW, `splat_${biome}_${sky}.png`);
            await shoot(`splat ${biome} ${sky}`, file, `splat=${ids.join(',')}&hdri=${sky}&assets=ultra`);
            const out = path.join(OUT, 'splat', `${biome}_${sky.replace('sky_', '')}.jpg`);
            if (fs.existsSync(file)) await sharp(file).jpeg({ quality: 84, mozjpeg: true }).toFile(out);
            items.push({ file: out, label: `${biome}: ${keys.join(', ')}${missing.length ? ` (fallback: ${missing.join(', ')})` : ''}` });
            report.splat[biome] = { layers: keys, assets: ids, fallback: missing };
          }
          await sheet(items, 3, 640, 360, path.join(OUT, `splat_sheet_${sky.replace('sky_', '')}.jpg`),
            `BIOME_TERRAIN recipes - 4-layer height-blended splat (layers left -> right), ${sky}, 18 % grey card`);
        }
      }

      if (run('slope')) {
        // AD-11: the three triplanar rock layers on a 38-58 deg escarpment (world-space triplanar, v = up), ultra
        // golden / ultra day / mobile day, at ~24 m (escarpment read) and ~7 m (face read)
        fs.mkdirSync(path.join(OUT, 'slope'), { recursive: true });
        const rocks = ['terrain_rock_sandstone', 'terrain_rock_granite', 'terrain_rock_basalt'].filter((id) => SETS.some((x) => x.id === id));
        const items = [];
        for (const id of rocks) {
          const tile = MANIFEST_JSON.assets[id]?.tileSizeMeters?.[0] ?? 10;
          for (const [tier, sky, cam, quality] of [['ultra', 'sky_golden', 'far', 'high'], ['ultra', 'sky_day', 'far', 'high'], ['ultra', 'sky_day', 'near', 'high'], ['mobile', 'sky_day', 'far', 'low']]) {
            const view = cam === 'far' ? { eye: [-3, 4.5, 22], at: [0, 6.5, -3] } : { eye: [-1.5, 6.5, 3.0], at: [0.0, 6.2, -4.5] };
            const file = path.join(RAW, `slope_${id}_${tier}_${sky}_${cam}.png`);
            if (!(args.reuse && fs.existsSync(file)))
              await shoot(`slope ${id} ${tier} ${sky} ${cam}`, file, `asset=${id}&hdri=${sky}&camera=overview&assets=${tier}`, { quality, slope: { tile, ...view } });
            const out = path.join(OUT, 'slope', `${id}_${tier}_${sky.replace('sky_', '')}_${cam}.jpg`);
            if (fs.existsSync(file)) await sharp(file).jpeg({ quality: 84, mozjpeg: true }).toFile(out);
            items.push({ file: out, label: `${id} - ${tier} tier, ${sky}, ${cam === 'far' ? '~24 m' : '~7 m'}, triplanar 38-58 deg face` });
          }
        }
        await sheet(items, 4, 480, 270, path.join(OUT, 'slope_sheet.jpg'), 'Rock layers on a 38-58 deg escarpment, world-space triplanar (v = up): ultra golden / ultra day / ultra day close / mobile day');
      }
      if (run('mobile')) {
        // P0 sets on the mobile texture tier, as a phone renders them (quality=low)
        fs.mkdirSync(path.join(OUT, 'mobile'), { recursive: true });
        const P0 = ['sandstone_buff', 'lime_plaster_weathered', 'brick_fired_old', 'roof_tile_terracotta', 'thatch_grass', 'mud_plaster',
          'bamboo_lattice', 'timber_teak_carved', 'sandstone_carved_red', 'terrain_grass_lush', 'terrain_grass_dry', 'terrain_alluvial_silt',
          'terrain_farmland_tilled', 'terrain_road_earth', 'terrain_river_sand', 'terrain_rock_sandstone', 'terrain_flagstone', 'terrain_mud_wet',
          'ground_dry_earth'];
        const items = [];
        for (const id of P0.filter((x) => SETS.some((s2) => s2.id === x))) {
          const terr = id.startsWith('terrain_') || id === 'ground_dry_earth';
          const views = terr ? [['hero', `splat=${id}`]] : [['detail', `asset=${id}&camera=detail`], ['overview', `asset=${id}&camera=overview`]];
          for (const [cam, q] of views) {
            const file = path.join(RAW, `mobile_${id}_${cam}.png`);
            await shoot(`mobile ${id} ${cam}`, file, `${q}&hdri=sky_day&assets=mobile`, { quality: 'low' });
            const out = path.join(OUT, 'mobile', `${id}_${cam}.jpg`);
            if (fs.existsSync(file)) await sharp(file).jpeg({ quality: 84, mozjpeg: true }).toFile(out);
            items.push({ file: out, label: `${id} - mobile tier, ${terr ? 'splat patch' : cam === 'detail' ? '~1.2 m' : '~9 m'}, sky_day` });
          }
        }
        await sheet(items, 4, 480, 270, path.join(OUT, 'mobile_sheet.jpg'), 'P0 sets on the MOBILE texture tier (assets=mobile, quality=low), sky_day');
      }

      if (run('varsha')) {
        // monsoon lookdev of the wet biomes (AD-9): marsh (mud_wet base) and farmland, dry vs wet 0.85
        const terr = fs.readFileSync(path.join(ROOT, 'src', 'render', 'style', 'terrain.ts'), 'utf8');
        const layerAsset = {};
        for (const m of terr.matchAll(/^\s+(\w+): L\(\{ id: '(\w+)'.*?assetId: (?:'(\w+)'|null)/gm)) layerAsset[m[1]] = m[3] ?? null;
        const bt = terr.slice(terr.indexOf('export const BIOME_TERRAIN'));
        const items = [];
        for (const biome of ['marsh', 'farmland']) {
          const m = new RegExp(`^\\s+${biome}: \\{ layers: \\[([^\\]]+)\\]`, 'm').exec(bt);
          if (!m) {
            failures.push(`varsha: biome ${biome} not in BIOME_TERRAIN`);
            continue;
          }
          const ids = m[1].split(',').map((x) => layerAsset[x.trim().replace(/'/g, '')] ?? x.trim().replace(/'/g, ''));
          for (const [wet, label] of [[0, 'dry'], [0.85, 'varsha wet 0.85']]) {
            const file = path.join(RAW, `varsha_${biome}_${label.split(' ')[0]}.png`);
            await shoot(`varsha ${biome} ${label}`, file, `splat=${ids.join(',')}&hdri=sky_overcast&assets=ultra`, { wet });
            items.push({ file, label: `${biome} (${ids.join(', ')}) - ${label}, sky_overcast` });
          }
        }
        await sheet(items, 2, 640, 360, path.join(OUT, 'varsha_sheet.jpg'), 'Monsoon lookdev: splat wetness 0 vs 0.85 (darkened porous albedo, lowered roughness)');
      }

      if (run('stupa')) {
        const a = path.join(RAW, 'stupa_red.png');
        const b = path.join(RAW, 'stupa_buff.png');
        const c = path.join(RAW, 'stupa_buff_close.png');
        const dday = path.join(RAW, 'stupa_buff_day.png');
        await shoot('stupa_sanchi samrajya_set=sandstone_carved_red', a, 'asset=stupa_sanchi&hdri=sky_golden&camera=hero&assets=ultra');
        const r = await shoot('stupa_sanchi samrajya_set=sandstone_buff', b, 'asset=stupa_sanchi&hdri=sky_golden&camera=hero&assets=ultra', {
          reskin: { model: 'stupa_sanchi', from: 'sandstone_carved_red', to: 'sandstone_buff' },
        });
        await shoot('stupa_sanchi buff close', c, 'asset=stupa_sanchi&hdri=sky_golden&camera=close&assets=ultra', {
          reskin: { model: 'stupa_sanchi', from: 'sandstone_carved_red', to: 'sandstone_buff' },
        });
        await shoot('stupa_sanchi buff sky_day', dday, 'asset=stupa_sanchi&hdri=sky_day&camera=hero&assets=ultra', {
          reskin: { model: 'stupa_sanchi', from: 'sandstone_carved_red', to: 'sandstone_buff' },
        });
        report.stupaReskin = { replacedSetReferences: r.routed };
        if (!r.routed) failures.push('stupa reskin: no samrajya_set reference rewritten');
        await sheet(
          [
            { file: a, label: 'as published: samrajya_set = sandstone_carved_red' },
            { file: b, label: `samrajya_set -> sandstone_buff (${r.routed ?? 0} refs rewritten in the GLB)` },
            { file: c, label: 'sandstone_buff, camera=close (trim bands: ashlar, vine, dentil, padma, bead-reel, frieze)' },
            { file: dday, label: 'sandstone_buff under sky_day (AD-9)' },
          ],
          2,
          640,
          360,
          path.join(OUT, 'stupa_reskin.jpg'),
          'stupa_sanchi re-skinned by changing samrajya_set only (same trim-band layout)',
        );
      }
    } finally {
      if (browser) await browser.close();
      server.kill('SIGTERM');
    }
  }

  // merge with an earlier partial run (--only / --ids): newer groups and shots replace older ones by name
  const reportFile = path.join(OUT, 'report.json');
  if (fs.existsSync(reportFile) && (ONLY || args.ids)) {
    try {
      const prev = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
      const names = new Set(report.shots.map((x) => x.name));
      report.shots = [...(prev.shots ?? []).filter((x) => !names.has(x.name)), ...report.shots];
      report.sets = { ...(prev.sets ?? {}), ...report.sets };
      for (const k of ['budgets', 'splat', 'stupaReskin', 'decals']) if (report[k] === undefined && prev[k] !== undefined) report[k] = prev[k];
    } catch {
      // unreadable earlier report: start fresh
    }
  }
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
  console.log(`[ta-01] ${failures.length ? `FAIL (${failures.length})` : 'all ok'} -> ${path.relative(ROOT, OUT)}`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
