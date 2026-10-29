"""
@asset model_test_tree
@kind model

Pipeline test asset (TA-07): the 12 m broadleaf test tree as a regular model (LOD0 ~10k tris, LOD1 decimated)
- the "mesh" side of the impostor A/B (`impostor_test_tree` is captured from the identical builder in
_test_tree.py). Factor-only proxy materials (no texture sets). OWNER: Technical Artist G (TA-07).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import _test_tree  # noqa: E402
from lib import core, export, lod, render  # noqa: E402

ctx = core.begin(__file__, kind="model")
wood, leaves = _test_tree.build(detail=1)
w1 = lod.decimate(wood, 0.4, "test_tree_wood_lod1")
l1 = lod.decimate(leaves, 0.25, "test_tree_leaves_lod1")
info0 = export.gltf(ctx.path(f"{ctx.id}.lod0.glb"), [wood, leaves], extras={"id": ctx.id})
info1 = export.gltf(ctx.path(f"{ctx.id}.lod1.glb"), [w1, l1], extras={"id": ctx.id})
ctx.add_file("lod0", ctx.path(f"{ctx.id}.lod0.glb"))
ctx.add_file("lod1", ctx.path(f"{ctx.id}.lod1.glb"))
ctx.meta.update({
    "description": "Pipeline test: 12 m broadleaf tree (mesh side of the impostor A/B).",
    "bounds": info0["bounds"],
    "lodDistances": [0, 60],
    "triangles": [info0["triangles"], info1["triangles"]],
})
if ctx.preview:
    for o in (w1, l1):
        o.hide_render = True
    p = render.preview(ctx.path("preview.png"), [wood, leaves], azimuth=200, elevation=8, lens=40, sun_elevation=35,
                       sun_azimuth=230, res=(1024, 1024), samples=ctx.samples(64, 8), margin=1.02)
    ctx.add_file("preview", p)
ctx.finish()
