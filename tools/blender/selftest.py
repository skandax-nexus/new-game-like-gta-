"""
Self-test of the tools/blender/lib helpers (run after changing the library or upgrading Blender):

    /root/.venvs/blender/bin/python tools/blender/selftest.py          (or: npm run assets -- --selftest)

Builds a tiny skinned mannequin with standard clips, exports it, re-reads the GLB and checks skins,
animations, UV sets, tangents and binding extras; checks decimation, a high->low normal bake and a
procedural texture-set bake. Writes to .asset-cache/_selftest/. Exit code 1 on failure.
OWNER: Technical Art Director.
"""
from __future__ import annotations

import json
import math
import struct
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

from lib import anim, bake, core, export, lod, materials, mesh as M, nodes, rig, texgen as tg  # noqa: E402

OUT = core.REPO_ROOT / ".asset-cache" / "_selftest"
OUT.mkdir(parents=True, exist_ok=True)
results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, bool(ok), detail))
    core.log(("PASS " if ok else "FAIL ") + name + (f" - {detail}" if detail else ""))


def read_glb_json(path: Path) -> dict:
    data = path.read_bytes()
    magic, _version, _length = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67, "not a GLB"
    clen, ctype = struct.unpack_from("<II", data, 12)
    assert ctype == 0x4E4F534A
    return json.loads(data[20:20 + clen])


def test_skinned_export() -> None:
    core.reset_scene()
    bones = rig.humanoid(1.75)
    arm = rig.create_armature("mannequin_rig", bones)
    parts = []
    for b in bones:
        if not b.deform:
            continue
        h, t = np.array(b.head), np.array(b.tail)
        L = float(np.linalg.norm(t - h))
        r = 0.11 if b.name in ("hips", "spine", "chest") else 0.075 if "head" in b.name else 0.05
        bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=r, depth=max(L, 0.02), location=tuple((h + t) / 2))
        o = bpy.context.active_object
        d = (t - h) / max(L, 1e-6)
        o.rotation_mode = "QUATERNION"
        from mathutils import Vector
        o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(Vector(tuple(d)))
        M.apply_transform(o)
        parts.append(o)
    body = M.join(parts, "mannequin")
    M.shade_smooth(body, 50)
    M.box_uv(body, 1.0)
    M.lightmap_uv(body)
    mat = export.runtime_material("mannequin_skin", set_id="selftest_set", tint="#c08060", macro="mannequin:macro",
                                  fallback_color="#a07050")
    body.data.materials.append(mat)
    rig.skin_proximity(body, arm, blend=0.05)
    check("skin: vertex groups", len(body.vertex_groups) >= 15, f"{len(body.vertex_groups)} groups")

    def walk(ph: float) -> dict:
        s = math.sin(ph * 2 * math.pi)
        return {"thigh.L": {"rot": (25 * s, 0, 0)}, "thigh.R": {"rot": (-25 * s, 0, 0)},
                "upper_arm.L": {"rot": (0, -20 * s, 0)}, "upper_arm.R": {"rot": (0, -20 * s, 0)},
                "hips": {"loc": (0, 0, 0.02 * abs(s))}}

    anim.cycle(arm, "walk", 32, walk, samples=8)
    anim.cycle(arm, "idle", 60, lambda ph: {"chest": {"rot": (2 * math.sin(ph * 2 * math.pi), 0, 0)}}, samples=4)
    clip = anim.new_clip(arm, "attack", 24)
    anim.key(clip, arm, 1, "upper_arm.R", rot=(0, 0, 0))
    anim.key(clip, arm, 10, "upper_arm.R", rot=(-80, 0, 0))
    anim.key(clip, arm, 24, "upper_arm.R", rot=(0, 0, 0))
    anim.finish(clip, arm)
    try:
        anim.new_clip(arm, "wiggle", 10)
        check("anim: rejects non-standard names", False)
    except ValueError:
        check("anim: rejects non-standard names", True)
    check("anim: clips stashed", anim.clips_of(arm) == ["attack", "idle", "walk"], str(anim.clips_of(arm)))
    anim.rest(arm)
    info = export.gltf(OUT / "mannequin.glb", [body, arm], animations=True, extras={"id": "mannequin"})
    j = read_glb_json(OUT / "mannequin.glb")
    names = sorted(a["name"] for a in j.get("animations", []))
    check("export: animations", names == ["attack", "idle", "walk"], str(names))
    check("export: skin", len(j.get("skins", [])) == 1 and len(j["skins"][0]["joints"]) >= 15)
    prim = j["meshes"][0]["primitives"][0]["attributes"]
    check("export: TEXCOORD_0 + TEXCOORD_1", "TEXCOORD_0" in prim and "TEXCOORD_1" in prim, str(sorted(prim)))
    check("export: TANGENT", "TANGENT" in prim)
    check("export: JOINTS/WEIGHTS", "JOINTS_0" in prim and "WEIGHTS_0" in prim)
    ex = j["materials"][0].get("extras", {})
    check("export: binding extras", ex.get("samrajya_set") == "selftest_set" and ex.get("samrajya_macro") == "mannequin:macro", str(ex))
    check("export: no images", not j.get("images"))
    check("export: scene extras", j["scenes"][0].get("extras", {}).get("samrajya_id") == "mannequin", str(j["scenes"][0].get("extras")))
    b = info["bounds"]
    check("export: +Y up bounds", abs(b["max"][1] - 1.75) < 0.12 and b["min"][1] > -0.1, str(b))


def test_lod() -> None:
    core.reset_scene()
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, radius=1)
    s = bpy.context.active_object
    M.smart_uv(s)
    base = M.triangle_count(s)
    lods = lod.make_lods(s, (1.0, 0.5, 0.2), "sphere")
    counts = [M.triangle_count(o) for o in lods]
    check("lod: decimate ratios", counts[1] < base * 0.6 and counts[2] < base * 0.25, f"{base} -> {counts}")
    check("lod: names", [o.name for o in lods] == ["sphere_lod0", "sphere_lod1", "sphere_lod2"])


def test_normal_bake() -> None:
    core.reset_scene()
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    high = bpy.context.active_object
    high.name = "high"
    M.bevel(high, width=0.12, segments=4, angle_deg=30)
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    low = bpy.context.active_object
    low.name = "low"
    M.smart_uv(low, margin=0.02)
    bake.configure(samples=1, margin=4)
    img = bake.new_image("nrm", 128, 128)
    arr = bake.bake(low, "NORMAL", img, selected=[high], cage_extrusion=0.1, max_ray_distance=0.3)
    n = tg.decode_normal(arr[..., :3])
    tilt = float(np.mean(n[..., 2] < 0.98))
    tg.write_png(OUT / "bevel_normal.png", tg.encode_normal(n), 8)
    check("bake: high->low normals carry the bevel", 0.05 < tilt < 0.9, f"tilted fraction {tilt:.2f}")


def test_texture_set_bake() -> None:
    core.reset_scene()
    bpy.ops.mesh.primitive_plane_add(size=2.0)
    p = bpy.context.active_object
    mat = bpy.data.materials.new("proc")
    nb = nodes.NodeBuilder(mat)
    vec, w = nb.torus4d(nb.uv(), scale=6)
    nz = nb.noise(vec, w=w, detail=5)
    col = nb.ramp(nz.outputs["Fac"], [(0.3, "#5a2a20"), (0.7, "#c08a6a")])
    nb.principled(base_color=col, roughness=nb.map_range(nz.outputs["Fac"], 0, 1, 0.5, 0.95))
    materials.assign(p, mat)
    out = bake.bake_texture_set(p, 128, maps=("baseColor", "roughness", "metallic", "ao"), ao_samples=8)
    ok = out["baseColor"].shape == (128, 128, 3) and float(out["baseColor"].std()) > 0.01 and "orm" in out
    tile = out["baseColor"]
    seam = float(np.abs(tile[:, 0] - tile[:, -1]).mean())
    tg.write_png(OUT / "procedural_baseColor.png", tile, 8, srgb_encode=True)
    check("bake: procedural texture set", ok, f"std {float(out['baseColor'].std()):.3f}")
    check("bake: torus4d mapping tiles seamlessly", seam < 0.03, f"edge delta {seam:.4f}")


for t in (test_skinned_export, test_lod, test_normal_bake, test_texture_set_bake):
    try:
        t()
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        check(t.__name__, False, repr(e))

failed = [r for r in results if not r[1]]
core.log(f"selftest: {len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
