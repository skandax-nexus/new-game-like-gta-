const sharp = require('sharp');
const S = process.argv[2];
(async () => {
  const kb = (b) => (b.length / 1024).toFixed(0) + ' KB';
  for (const [name, w, opts, alpha] of [
    ['albedo', 2048, { quality: 86, alphaQuality: 90, smartSubsample: true, effort: 6 }, true],
    ['albedo', 1536, { quality: 86, alphaQuality: 90, smartSubsample: true, effort: 6 }, true],
    ['albedo', 1024, { quality: 86, alphaQuality: 90, smartSubsample: true, effort: 6 }, true],
    ['albedo', 1024, { quality: 75, alphaQuality: 70, smartSubsample: true, effort: 6 }, true],
    ['normal', 1024, { quality: 92, alphaQuality: 95, smartSubsample: true, effort: 6 }, true],
    ['normal', 512, { quality: 92, alphaQuality: 95, smartSubsample: true, effort: 6 }, true],
    ['normal', 256, { quality: 92, alphaQuality: 95, smartSubsample: true, effort: 6 }, true],
    ['atlas_color', 1024, { quality: 88, alphaQuality: 92, smartSubsample: true, effort: 6 }, true],
    ['atlas_color', 512, { quality: 88, alphaQuality: 92, smartSubsample: true, effort: 6 }, true],
    ['atlas_color', 256, { quality: 88, alphaQuality: 92, smartSubsample: true, effort: 6 }, true],
    ['atlas_normal', 512, { quality: 88, smartSubsample: true, effort: 6 }, false],
    ['atlas_normal', 512, { nearLossless: true, quality: 60, effort: 6 }, false],
    ['atlas_orm', 512, { quality: 88, smartSubsample: true, effort: 6 }, false],
  ]) {
    let img = sharp(`${S}/${name}.png`).resize(w, w, { kernel: 'lanczos3' });
    if (!alpha) img = img.removeAlpha();
    const b = await img.webp(opts).toBuffer();
    console.log(name.padEnd(14), String(w).padStart(5), JSON.stringify(opts).slice(0, 60).padEnd(62), kb(b));
  }
})();
