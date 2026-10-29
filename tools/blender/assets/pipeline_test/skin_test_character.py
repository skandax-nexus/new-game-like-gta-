"""
@asset skin_test_character
@kind model

Pipeline test asset (TA-07): the test spear-bearer as a SKINNED character (not VAT) - close-up detail body,
six proxy materials, standard skeleton, clips idle / walk / attack / die, a decimated LOD1 that shares the
skeleton at runtime. Carries every typed model metadata field the runtime exposes: clipEvents (attack hit
window + cancel, walk footsteps), rootMotion (walk stride), sockets (weapon on hand.R, banner on the back) and
a validated meta passthrough. Proves gltf-transform keeps skins / joints / weights / clips through publish and
that loadModel returns independently animatable SkeletonUtils clones (viewer: `?asset=skin_test_character`).
OWNER: Technical Artist G (TA-07).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

import _dummy  # noqa: E402
from lib import anim, core, export, lod, render, rig  # noqa: E402

ctx = core.begin(__file__, kind="model")
arm, body, labels = _dummy.build(detail=2)
body.name = f"{ctx.id}_lod0"
# One proxy material per part (factor colors; no texture sets for the test character).
mats = [export.runtime_material(f"{ctx.id}_{p}", fallback_color=_dummy.PART_COLORS[p],
                                roughness={"metal": 0.42, "skin": 0.62}.get(p, 0.82),
                                metallic=1.0 if p == "metal" else 0.0)
        for p in _dummy.PARTS]
for m in mats:
    body.data.materials.append(m)
part = labels["part"]
poly_part = np.array([part[p.vertices[0]] for p in body.data.polygons], np.int32)
body.data.polygons.foreach_set("material_index", poly_part)
clips = _dummy.add_clips(arm, die=True)
lod1 = lod.decimate(body, 0.35, f"{ctx.id}_lod1")
rig.bind(lod1, arm)
anim.rest(arm)
bpy.context.view_layer.update()

info0 = export.gltf(ctx.path(f"{ctx.id}.lod0.glb"), [body, arm], animations=True, extras={"id": ctx.id})
info1 = export.gltf(ctx.path(f"{ctx.id}.lod1.glb"), [lod1, arm], animations=True, extras={"id": ctx.id})
ctx.add_file("lod0", ctx.path(f"{ctx.id}.lod0.glb"), skinned=True)
ctx.add_file("lod1", ctx.path(f"{ctx.id}.lod1.glb"), skinned=True)
ctx.meta.update({
    "description": "Pipeline test: skinned spear-bearer (standard skeleton), idle/walk/attack/die, clipEvents, sockets.",
    "clips": clips,
    "bounds": info0["bounds"],
    "lodDistances": [0, 14],
    "triangles": [info0["triangles"], info1["triangles"]],
    "clipEvents": {"attack": _dummy.ATTACK_EVENTS, "walk": _dummy.WALK_EVENTS},
    # In-place clips: the walk covers its planted-foot stride per loop (measured on vat_test_dummy: 1.247 m).
    "rootMotion": {"walk": {"translation": [0.0, 0.0, 1.247], "yawDeg": 0.0},
                   "attack": {"translation": [0.0, 0.0, 0.0], "yawDeg": 0.0}},
    "sockets": {
        "weapon": {"bone": "hand.R", "position": [0.0, 0.05, 0.0], "rotation": [0.0, 0.0, 0.0, 1.0]},
        "banner": {"bone": "chest", "position": [0.0, 0.12, 0.16], "rotation": [0.0, 0.0, 0.0, 1.0]},
    },
    "meta": {"heightMeters": 1.75, "faction": "test", "notes": "TA-07 pipeline test character"},
})

if ctx.preview:
    shown = []
    acts = {t.name: t.strips[0].action for t in arm.animation_data.nla_tracks}
    for k, (clip, frame) in enumerate([("idle", 1), ("walk", 9), ("attack", 12), ("die", 36)]):
        arm.animation_data.action = acts[clip]
        if arm.animation_data.action_slot is None and len(acts[clip].slots):
            arm.animation_data.action_slot = acts[clip].slots[0]
        bpy.context.scene.frame_set(frame)
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(body.evaluated_get(dg), depsgraph=dg)
        o = bpy.data.objects.new(f"pose_{k}", me)
        bpy.context.scene.collection.objects.link(o)
        o.matrix_world = body.matrix_world.copy()
        o.location = (k * 1.25 - 1.9, 0, 0)
        shown.append(o)
    arm.animation_data.action = None
    body.hide_render = True
    lod1.hide_render = True
    p = render.preview(ctx.path("preview.png"), shown, azimuth=205, elevation=10, lens=50, sun_elevation=35,
                       sun_azimuth=230, res=(1280, 640), samples=ctx.samples(64, 8), margin=1.0)
    ctx.add_file("preview", p)
ctx.finish()
