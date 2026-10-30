import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, meshopt, prune, quantize, reorder, resample, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const src = process.argv[2];
async function size(drop, primFilter) {
  const doc = await io.read(src);
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    if (primFilter && !primFilter(p)) { p.dispose(); continue; }
    for (const s of drop) if (p.getAttribute(s)) p.setAttribute(s, null);
  }
  await doc.transform(dedup(), weld(), resample(), prune({ keepAttributes: true, keepExtras: true }), reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 14, quantizeColor: 8 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const b = await io.writeBinary(doc);
  return b.length;
}
const all = await size([]);
console.log('all', all);
for (const s of ['NORMAL', 'TEXCOORD_0', 'TEXCOORD_1', 'TEXCOORD_2', 'COLOR_0']) console.log('without', s, all - await size([s]));
const leavesOnly = await size([], (p) => p.getMaterial()?.getName().includes('leaves'));
console.log('leaves prim only', leavesOnly, 'wood only', await size([], (p) => !p.getMaterial()?.getName().includes('leaves')));
