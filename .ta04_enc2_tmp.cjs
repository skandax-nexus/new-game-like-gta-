const sharp = require('sharp');
const S = process.argv[2];
function blurPlane(src, w, h, r) { // box blur radius r, 2 passes
  let a = Float32Array.from(src);
  for (let pass = 0; pass < 2; pass++) for (const horiz of [true, false]) {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let k = -r; k <= r; k++) { const xx = horiz ? x + k : x, yy = horiz ? y : y + k; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; s += a[yy * w + xx]; n++; }
      out[y * w + x] = s / n;
    }
    a = out;
  }
  return a;
}
(async () => {
  for (const fpx of [256, 192, 128]) {
    const W = fpx * 8;
    const { data } = await sharp(`${S}/albedo.png`).resize(W, W, { kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const n = W * W;
    const A = new Float32Array(n); for (let i = 0; i < n; i++) A[i] = data[i * 4 + 3] / 255;
    // close holes: blur alpha then sharpen around 0.5 -> soft but hole-free coverage
    const Ab = blurPlane(A, W, W, Math.max(1, Math.round(fpx / 128)));
    const out = Buffer.alloc(n * 4);
    // colour: alpha-weighted blur (sub-pixel leaf noise removed)
    const ch = [0, 1, 2].map((c) => { const p = new Float32Array(n); for (let i = 0; i < n; i++) p[i] = data[i * 4 + c] * A[i]; return blurPlane(p, W, W, 1); });
    const aw = blurPlane(A, W, W, 1);
    for (let i = 0; i < n; i++) {
      const cov = Math.min(1, Math.max(0, (Ab[i] - 0.5) * 3 + 0.5));
      for (let c = 0; c < 3; c++) out[i * 4 + c] = aw[i] > 1e-3 ? Math.round(ch[c][i] / aw[i]) : 0;
      out[i * 4 + 3] = Math.round(cov * 255);
    }
    const b0 = await sharp(data, { raw: { width: W, height: W, channels: 4 } }).webp({ quality: 86, alphaQuality: 90, smartSubsample: true, effort: 6 }).toBuffer();
    const b1 = await sharp(out, { raw: { width: W, height: W, channels: 4 } }).webp({ quality: 86, alphaQuality: 90, smartSubsample: true, effort: 6 }).toBuffer();
    await sharp(out, { raw: { width: W, height: W, channels: 4 } }).png().toFile(`${S}/albedo_smooth_${fpx}.png`);
    console.log(fpx, 'raw', (b0.length / 1024).toFixed(0), 'KB  smoothed', (b1.length / 1024).toFixed(0), 'KB');
  }
})();
