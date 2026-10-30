const sharp = require('sharp');
const S = process.argv[2];
function bleed(buf, w, h) { // same idea as publish.mjs bleedRgb (iterative 3x3 fill), simplified 12 iterations
  const known = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) known[i] = buf[i * 4 + 3] > 8 ? 1 : 0;
  let fr = known.slice();
  for (let it = 0; it < 12; it++) { const nx = fr.slice(); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (fr[i]) continue; let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const j = yy * w + xx; if (!fr[j]) continue; r += buf[j * 4]; g += buf[j * 4 + 1]; b += buf[j * 4 + 2]; n++; }
    if (n) { buf[i * 4] = r / n; buf[i * 4 + 1] = g / n; buf[i * 4 + 2] = b / n; nx[i] = 1; } } fr = nx; }
  return buf;
}
(async () => {
  for (const f of ['alb_bin1','alb_hard1','alb_bin2','alb_hard2']) {
    const row = [];
    for (const fpx of [256, 192, 128]) {
      const W = fpx * 8;
      const { data } = await sharp(`${S}/${f}.png`).resize(W, W, { kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      bleed(data, W, W);
      const b = await sharp(data, { raw: { width: W, height: W, channels: 4 } }).webp({ quality: 86, alphaQuality: 90, smartSubsample: true, effort: 6, exact: true }).toBuffer();
      row.push(`${fpx}px ${(b.length / 1024).toFixed(0)} KB`);
    }
    console.log(f.padEnd(12), row.join('  '));
  }
})();
