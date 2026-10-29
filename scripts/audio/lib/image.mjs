/**
 * Minimal RGB raster for the offline audio tools: rectangles, lines, a 5x7 bitmap font, the magma
 * colormap and a labelled spectrogram + waveform panel. OWNER: Audio Developer (AUD-01).
 */

// 5x7 glyphs, one 5-bit row per entry (MSB = left).
const GLYPHS = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31], 3: [31, 2, 4, 2, 1, 17, 14],
  4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14], 6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8],
  8: [14, 17, 17, 14, 17, 17, 14], 9: [14, 17, 17, 15, 1, 2, 12],
  ' ': [0, 0, 0, 0, 0, 0, 0], '.': [0, 0, 0, 0, 0, 12, 12], '-': [0, 0, 0, 31, 0, 0, 0], ':': [0, 12, 12, 0, 12, 12, 0],
  '/': [1, 1, 2, 4, 8, 16, 16], '(': [2, 4, 8, 8, 8, 4, 2], ')': [8, 4, 2, 2, 2, 4, 8], _: [0, 0, 0, 0, 0, 0, 31],
  '%': [24, 25, 2, 4, 8, 19, 3], '+': [0, 4, 4, 31, 4, 4, 0], '=': [0, 0, 31, 0, 31, 0, 0], ',': [0, 0, 0, 0, 12, 4, 8],
  '#': [10, 10, 31, 10, 31, 10, 10], '<': [2, 4, 8, 16, 8, 4, 2], '>': [8, 4, 2, 1, 2, 4, 8], '|': [4, 4, 4, 4, 4, 4, 4],
};

export class Raster {
  constructor(width, height, bg = [12, 10, 16]) {
    this.width = width;
    this.height = height;
    this.rgb = new Uint8Array(width * height * 3);
    this.fill(0, 0, width, height, bg);
  }
  set(x, y, c) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 3;
    this.rgb[i] = c[0];
    this.rgb[i + 1] = c[1];
    this.rgb[i + 2] = c[2];
  }
  fill(x, y, w, h, c) {
    for (let yy = Math.max(0, y); yy < Math.min(this.height, y + h); yy++) for (let xx = Math.max(0, x); xx < Math.min(this.width, x + w); xx++) this.set(xx, yy, c);
  }
  hline(x0, x1, y, c) {
    for (let x = x0; x <= x1; x++) this.set(x, y, c);
  }
  vline(x, y0, y1, c) {
    for (let y = y0; y <= y1; y++) this.set(x, y, c);
  }
  text(x, y, str, c, scale = 1) {
    let cx = x;
    for (const ch of String(str).toUpperCase()) {
      const g = GLYPHS[ch] ?? GLYPHS[' '];
      for (let r = 0; r < 7; r++) for (let b = 0; b < 5; b++) if (g[r] & (16 >> b)) this.fill(cx + b * scale, y + r * scale, scale, scale, c);
      cx += 6 * scale;
    }
    return cx;
  }
  blit(src, ox, oy) {
    for (let y = 0; y < src.height; y++)
      for (let x = 0; x < src.width; x++) {
        const i = (y * src.width + x) * 3;
        this.set(ox + x, oy + y, [src.rgb[i], src.rgb[i + 1], src.rgb[i + 2]]);
      }
  }
}

// Magma colormap control points (t, r, g, b).
const MAGMA = [
  [0.0, 0, 0, 4], [0.13, 28, 16, 68], [0.25, 79, 18, 123], [0.38, 129, 37, 129], [0.5, 181, 54, 122],
  [0.63, 229, 80, 100], [0.75, 251, 135, 97], [0.88, 254, 194, 135], [1.0, 252, 253, 191],
];
export function magma(t) {
  const u = Math.max(0, Math.min(1, t));
  for (let i = 1; i < MAGMA.length; i++) {
    const b = MAGMA[i];
    if (u <= b[0]) {
      const a = MAGMA[i - 1];
      const k = (u - a[0]) / (b[0] - a[0]);
      return [Math.round(a[1] + (b[1] - a[1]) * k), Math.round(a[2] + (b[2] - a[2]) * k), Math.round(a[3] + (b[3] - a[3]) * k)];
    }
  }
  return [252, 253, 191];
}

const INK = [228, 214, 190];
const DIM = [120, 110, 100];
const GRID = [70, 64, 72];
const CLIP = [255, 40, 40];

/**
 * Labelled panel: title + stats line, waveform strip (peak envelope per column, -1 dBFS ceiling line,
 * red where a column reaches it), log-frequency spectrogram (magma, -100..0 dBFS) with frequency and
 * time grid. `spec` comes from analysis.spectrogram(); `channels` are the Float32Arrays rendered.
 */
export function spectrogramPanel({ title, subtitle, channels, sr, spec, width, specHeight = 220, waveHeight = 46, floorDb = -100 }) {
  const left = 46;
  const top = 30;
  const H = top + waveHeight + 6 + specHeight + 22;
  const img = new Raster(width, H);
  img.text(6, 5, title, INK, 2);
  if (subtitle) img.text(6, 20, subtitle, DIM, 1);
  const plotW = width - left - 8;
  // Waveform strip.
  const wy = top;
  img.fill(left, wy, plotW, waveHeight, [20, 18, 26]);
  const ceil = Math.pow(10, -1 / 20);
  const n = channels[0].length;
  for (let x = 0; x < plotW; x++) {
    const s = Math.floor((x / plotW) * n);
    const e = Math.max(s + 1, Math.floor(((x + 1) / plotW) * n));
    let pk = 0;
    for (const ch of channels) for (let i = s; i < e; i++) pk = Math.max(pk, Math.abs(ch[i]));
    const h = Math.round(pk * (waveHeight / 2 - 1));
    const mid = wy + waveHeight / 2;
    img.vline(left + x, Math.round(mid - h), Math.round(mid + h), pk >= ceil ? CLIP : [150, 190, 210]);
  }
  const cl = Math.round(ceil * (waveHeight / 2 - 1));
  for (let x = 0; x < plotW; x += 3) {
    img.set(left + x, wy + waveHeight / 2 - cl, GRID);
    img.set(left + x, wy + waveHeight / 2 + cl, GRID);
  }
  img.text(4, wy + waveHeight / 2 - 3, '-1DB', DIM);
  // Spectrogram.
  const sy = wy + waveHeight + 6;
  for (let y = 0; y < specHeight; y++) {
    const row = Math.min(spec.height - 1, Math.floor((y / specHeight) * spec.height));
    for (let x = 0; x < plotW; x++) {
      const col = Math.min(spec.width - 1, Math.floor((x / plotW) * spec.width));
      const db = spec.db[row * spec.width + col];
      img.set(left + x, sy + y, magma((db - floorDb) / -floorDb));
    }
  }
  const lnMin = Math.log(spec.fMin);
  const lnMax = Math.log(spec.fMax);
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
    if (f < spec.fMin || f > spec.fMax) continue;
    const y = sy + Math.round(((lnMax - Math.log(f)) / (lnMax - lnMin)) * specHeight);
    for (let x = 0; x < plotW; x += 4) img.set(left + x, y, GRID);
    img.text(2, y - 3, f >= 1000 ? `${f / 1000}K` : `${f}`, DIM);
  }
  const secs = spec.seconds;
  const step = secs > 40 ? 10 : secs > 12 ? 5 : secs > 4 ? 1 : secs > 1.5 ? 0.5 : 0.1;
  for (let t = 0; t <= secs + 1e-9; t += step) {
    const x = left + Math.round((t / secs) * (plotW - 1));
    img.vline(x, sy + specHeight, sy + specHeight + 3, DIM);
    if (t + step <= secs + 1e-9 || t === 0) img.text(x - 6, sy + specHeight + 6, `${Math.round(t * 10) / 10}S`, DIM);
  }
  img.text(width - 132, 5, `${sr / 1000}KHZ ${floorDb}..0DB`, DIM);
  return img;
}

/** Stack panels vertically into one image (contact sheet). */
export function stack(panels, gap = 6) {
  const w = Math.max(...panels.map((p) => p.width));
  const h = panels.reduce((s, p) => s + p.height + gap, 0);
  const out = new Raster(w, h, [6, 5, 8]);
  let y = 0;
  for (const p of panels) {
    out.blit(p, 0, y);
    y += p.height + gap;
  }
  return out;
}
