import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, meshopt, prune, quantize, reorder, resample, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import fs from 'node:fs';
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
for (const src of process.argv.slice(2)) {
  const doc = await io.read(src);
  const keep = process.env.KEEP === '1';
  const steps = [dedup()];
  if (!keep) steps.push(flatten(), join({ keepNamed: false }));
  steps.push(weld(), resample(), prune({ keepAttributes: true, keepExtras: true, keepLeaves: keep }), reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 14, quantizeColor: 8, quantizeWeight: 8 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await doc.transform(...steps);
  const out = src.replace('.glb', '.opt.glb');
  await io.write(out, doc);
  let tris = 0, verts = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { tris += p.getIndices().getCount() / 3; verts += p.getAttribute('POSITION').getCount(); }
  console.log(src.split('/').pop(), 'tris', tris, 'verts', verts, 'bytes', fs.statSync(out).size, 'B/tri', (fs.statSync(out).size / tris).toFixed(1));
}
