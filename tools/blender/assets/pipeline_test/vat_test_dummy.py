"""
@asset vat_test_dummy
@kind vat

Pipeline test asset (TA-07): a rigged low-poly spear-bearer with idle / walk / attack baked to vertex animation
textures at 15 fps - LOD0 (~700 tris) and a decimated, re-baked LOD1 (~200 tris), vertex colors R team mask,
G cloth seed, B part id. Proves lib/vat.py end to end (reconstruction error, clip table, stride) and feeds the
asset viewer crowd mode (`?scene=assetviewer&asset=vat_test_dummy&clip=walk&count=500`).
Period note: quilted jacket, antariya, turban, bamboo spear and hide shield (ART_BIBLE §9.2 spearmen).
OWNER: Technical Artist G (TA-07).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import bpy  # noqa: E402

import _dummy  # noqa: E402
from lib import core, render, vat  # noqa: E402
from lib.texgen import hex_to_linear  # noqa: E402

ctx = vat.begin(__file__)
arm, body, labels = _dummy.build(detail=1)
body.name = f"{ctx.id}_lod0"
vat.set_vertex_colors(body, labels["team"], labels["cloth"], labels["part"])
_dummy.add_clips(arm)
lod1 = vat.decimate_lod(body, arm, 0.3, f"{ctx.id}_lod1")
cloth = hex_to_linear(_dummy.PART_COLORS["cloth"])
meta = vat.bake(
    ctx, arm, [body, lod1], fps=15, rest=("idle", 0), parts=_dummy.PARTS, lod_distances=[0, 35],
    material=vat.proxy_material(f"{ctx.id}_mat", fallback_color=tuple(float(c) for c in cloth), roughness=0.78),
)
ctx.meta.update(meta)
# Texture-less unit: per-part colors for the runtime palette (team part neutral so the team tint multiplies).
ctx.meta["partColors"] = [_dummy.PART_COLORS[p] if p != "team" else "#ece6da" for p in _dummy.PARTS]
ctx.meta["description"] = "Pipeline test: rigged spear-bearer, idle/walk/attack VAT (15 fps), LOD0 + re-baked LOD1."

if ctx.preview:
    # Contact strip of baked poses: rest, idle mid, walk contact / passing, attack wind-up / thrust (LOD0 and LOD1).
    mat = _dummy.preview_material()
    poses = [("idle", 1.0), ("idle", 25.0), ("walk", 1.0), ("walk", 9.0), ("walk", 17.0), ("attack", 8.0), ("attack", 12.0)]
    acts = {name: act for name, act, _, _ in vat.clip_actions(arm)}
    shown = []
    for row, src in enumerate((body, lod1)):
        for k, (clip, frame) in enumerate(poses):
            vat._use_action(arm, acts[clip])
            vat._set_time(frame)
            dg = bpy.context.evaluated_depsgraph_get()
            me = bpy.data.meshes.new_from_object(src.evaluated_get(dg), depsgraph=dg)
            o = bpy.data.objects.new(f"pose_{row}_{k}", me)
            bpy.context.scene.collection.objects.link(o)
            o.matrix_world = src.matrix_world.copy()
            o.location = (k * 0.92 + row * 6.9 - 6.35, 0, 0)
            o.data.materials.clear()
            o.data.materials.append(mat)
            shown.append(o)
    vat._use_action(arm, None)
    for o in (body, lod1):
        o.hide_render = True
    arm.hide_render = True
    render.setup_world(35, 230, 0.35)
    render.add_sun(35, 230, 4.0)
    render.add_ground(color="#6b5a46")
    # LOD0 poses (left) and the same poses on LOD1 (right), seen from the front-left at soldier eye level.
    render.look_at_camera((-1.0, -17.5, 2.0), (0.0, 0.0, 1.05), lens=46)
    p = render.render(ctx.path("preview.png"), (1600, 520), ctx.samples(48, 8))
    ctx.add_file("preview", p)
ctx.finish()
