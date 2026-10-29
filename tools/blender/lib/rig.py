"""
Armatures and skinning. OWNER: Technical Art Director.

    BoneSpec(name, head, tail, parent=None, roll=0, deform=True)
    create_armature(name, bones, location)          armature object from specs (edit-mode free for callers)
    humanoid(height=1.75, prefix="")                 standard biped skeleton (names below)
    quadruped(length=3.0, height=2.8, prefix="")     elephant/horse-class skeleton
    chain(prefix, points, parent)                    bone chain through points (tails, ropes, banners)
    bind(mesh, armature)                             parent + Armature modifier (no weights changed)
    skin_rigid(mesh, armature, {bone: vertex_indices})          1.0 weights (props, mechanical parts)
    skin_proximity(mesh, armature, bones, blend, max_influences) smooth capsule-distance weights (numpy)
    skin_auto(mesh, armature)                        Blender heat weights, falls back to proximity
    normalize(mesh, max_influences=4)                limit + renormalize (glTF/three use 4 influences)

STANDARD BONE NAMES (crowd VAT baking and runtime retargeting rely on them):
    root, hips, spine, chest, neck, head,
    shoulder.L/R, upper_arm.L/R, forearm.L/R, hand.L/R,
    thigh.L/R, shin.L/R, foot.L/R, toe.L/R,  weapon.R (prop socket, non-deforming), shield.L
Quadrupeds: root, hips, spine, chest, neck, head, trunk.0-3 (elephant), tail.0-2,
    leg_front_upper/lower/foot.L/R, leg_back_upper/lower/foot.L/R
Blender is +Z up; characters face -Y (glTF/three +Z) with feet at Z = 0 and the root bone at origin.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Sequence

import bpy
import numpy as np
from mathutils import Vector

from . import mesh as M

F = np.float32


@dataclass
class BoneSpec:
    name: str
    head: tuple[float, float, float]
    tail: tuple[float, float, float]
    parent: str | None = None
    roll: float = 0.0
    deform: bool = True
    connect: bool = False


def create_armature(name: str, bones: Sequence[BoneSpec], location: Sequence[float] = (0, 0, 0),
                    display: str = "STICK") -> bpy.types.Object:
    data = bpy.data.armatures.new(name)
    data.display_type = display
    arm = bpy.data.objects.new(name, data)
    arm.location = tuple(location)
    M.link(arm)
    for o in [x for x in bpy.context.view_layer.objects if x is not None]:
        o.select_set(False)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    try:
        eb = data.edit_bones
        for b in bones:
            e = eb.new(b.name)
            e.head = Vector(b.head)
            e.tail = Vector(b.tail)
            e.roll = b.roll
            e.use_deform = b.deform
        for b in bones:
            if b.parent:
                e = eb[b.name]
                e.parent = eb[b.parent]
                e.use_connect = b.connect
    finally:
        bpy.ops.object.mode_set(mode="OBJECT")
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return arm


def chain(prefix: str, points: Sequence[Sequence[float]], parent: str | None = None, deform: bool = True
          ) -> list[BoneSpec]:
    out: list[BoneSpec] = []
    prev = parent
    for i in range(len(points) - 1):
        name = f"{prefix}.{i}"
        out.append(BoneSpec(name, tuple(points[i]), tuple(points[i + 1]), prev, deform=deform, connect=prev is not None and i > 0))
        prev = name
    return out


def humanoid(height: float = 1.75, prefix: str = "") -> list[BoneSpec]:
    """Standard biped (T-pose arms along +-X, facing -Y). Proportions ~7.5 heads."""
    s = height / 1.75
    p = prefix

    def v(x: float, y: float, z: float) -> tuple[float, float, float]:
        return (x * s, y * s, z * s)

    bones = [
        BoneSpec(p + "root", v(0, 0, 0), v(0, 0.25, 0), None, deform=False),
        BoneSpec(p + "hips", v(0, 0, 0.95), v(0, 0, 1.08), p + "root"),
        BoneSpec(p + "spine", v(0, 0, 1.08), v(0, 0, 1.25), p + "hips", connect=True),
        BoneSpec(p + "chest", v(0, 0, 1.25), v(0, 0, 1.45), p + "spine", connect=True),
        BoneSpec(p + "neck", v(0, 0, 1.45), v(0, 0, 1.56), p + "chest", connect=True),
        BoneSpec(p + "head", v(0, 0, 1.56), v(0, 0, 1.75), p + "neck", connect=True),
    ]
    for side, sx in (("L", 1.0), ("R", -1.0)):
        bones += [
            BoneSpec(f"{p}shoulder.{side}", v(0.03 * sx, 0, 1.42), v(0.17 * sx, 0, 1.42), p + "chest"),
            BoneSpec(f"{p}upper_arm.{side}", v(0.17 * sx, 0, 1.42), v(0.45 * sx, 0, 1.42), f"{p}shoulder.{side}", connect=True),
            BoneSpec(f"{p}forearm.{side}", v(0.45 * sx, 0, 1.42), v(0.70 * sx, 0, 1.42), f"{p}upper_arm.{side}", connect=True),
            BoneSpec(f"{p}hand.{side}", v(0.70 * sx, 0, 1.42), v(0.80 * sx, 0, 1.42), f"{p}forearm.{side}", connect=True),
            BoneSpec(f"{p}thigh.{side}", v(0.10 * sx, 0, 0.95), v(0.10 * sx, 0, 0.52), p + "hips"),
            BoneSpec(f"{p}shin.{side}", v(0.10 * sx, 0, 0.52), v(0.10 * sx, 0.02, 0.09), f"{p}thigh.{side}", connect=True),
            BoneSpec(f"{p}foot.{side}", v(0.10 * sx, 0.02, 0.09), v(0.10 * sx, -0.12, 0.03), f"{p}shin.{side}", connect=True),
            BoneSpec(f"{p}toe.{side}", v(0.10 * sx, -0.12, 0.03), v(0.10 * sx, -0.19, 0.03), f"{p}foot.{side}", connect=True),
        ]
    bones.append(BoneSpec(p + "weapon.R", v(-0.80, 0, 1.42), v(-0.80, -0.15, 1.42), p + "hand.R", deform=False))
    bones.append(BoneSpec(p + "shield.L", v(0.62, 0.06, 1.42), v(0.62, 0.21, 1.42), p + "forearm.L", deform=False))
    return bones


def quadruped(length: float = 3.0, height: float = 2.8, prefix: str = "", trunk: bool = True, tail: bool = True
              ) -> list[BoneSpec]:
    """Generic quadruped facing -Y (elephant when trunk=True). Shoulder height ~= height."""
    L, H, p = length, height, prefix
    hz = H * 0.62
    bones = [
        BoneSpec(p + "root", (0, 0, 0), (0, 0.4, 0), None, deform=False),
        BoneSpec(p + "hips", (0, L * 0.35, hz + 0.1 * H), (0, L * 0.1, hz + 0.12 * H), p + "root"),
        BoneSpec(p + "spine", (0, L * 0.1, hz + 0.12 * H), (0, -L * 0.15, hz + 0.14 * H), p + "hips", connect=True),
        BoneSpec(p + "chest", (0, -L * 0.15, hz + 0.14 * H), (0, -L * 0.35, hz + 0.12 * H), p + "spine", connect=True),
        BoneSpec(p + "neck", (0, -L * 0.35, hz + 0.12 * H), (0, -L * 0.48, hz + 0.16 * H), p + "chest", connect=True),
        BoneSpec(p + "head", (0, -L * 0.48, hz + 0.16 * H), (0, -L * 0.62, hz + 0.1 * H), p + "neck", connect=True),
    ]
    if trunk:
        pts = [(0, -L * 0.62, hz + 0.05 * H)] + [(0, -L * (0.66 + 0.02 * i), hz - H * (0.12 + 0.17 * i)) for i in range(4)]
        bones += chain(p + "trunk", pts, p + "head")
    if tail:
        pts = [(0, L * 0.36, hz + 0.08 * H)] + [(0, L * (0.38 + 0.02 * i), hz - H * 0.12 * (i + 1)) for i in range(3)]
        bones += chain(p + "tail", pts, p + "hips")
    for side, sx in (("L", 1.0), ("R", -1.0)):
        x = 0.18 * L * sx
        for part, y, par in (("front", -L * 0.3, p + "chest"), ("back", L * 0.3, p + "hips")):
            bones += [
                BoneSpec(f"{p}leg_{part}_upper.{side}", (x, y, hz), (x, y, hz * 0.5), par),
                BoneSpec(f"{p}leg_{part}_lower.{side}", (x, y, hz * 0.5), (x, y, 0.08), f"{p}leg_{part}_upper.{side}", connect=True),
                BoneSpec(f"{p}leg_{part}_foot.{side}", (x, y, 0.08), (x, y - 0.15, 0.02), f"{p}leg_{part}_lower.{side}", connect=True),
            ]
    return bones


def bind(mesh_obj: bpy.types.Object, arm: bpy.types.Object) -> bpy.types.Modifier:
    mesh_obj.parent = arm
    mesh_obj.matrix_parent_inverse = arm.matrix_world.inverted()
    mod = next((m for m in mesh_obj.modifiers if m.type == "ARMATURE"), None)
    if mod is None:
        mod = mesh_obj.modifiers.new("armature", "ARMATURE")
    mod.object = arm
    mod.use_vertex_groups = True
    return mod


def _group(mesh_obj: bpy.types.Object, name: str) -> bpy.types.VertexGroup:
    return mesh_obj.vertex_groups.get(name) or mesh_obj.vertex_groups.new(name=name)


def skin_rigid(mesh_obj: bpy.types.Object, arm: bpy.types.Object, assignment: dict[str, Iterable[int]]) -> None:
    for bone, idx in assignment.items():
        _group(mesh_obj, bone).add([int(i) for i in idx], 1.0, "REPLACE")
    bind(mesh_obj, arm)


def _deform_segments(arm: bpy.types.Object, bones: Sequence[str] | None):
    mw = arm.matrix_world
    names, heads, tails = [], [], []
    for b in arm.data.bones:
        if not b.use_deform or (bones is not None and b.name not in bones):
            continue
        names.append(b.name)
        heads.append(tuple(mw @ b.head_local))
        tails.append(tuple(mw @ b.tail_local))
    return names, np.array(heads, F), np.array(tails, F)


def skin_proximity(mesh_obj: bpy.types.Object, arm: bpy.types.Object, bones: Sequence[str] | None = None,
                   blend: float = 0.06, max_influences: int = 4, power: float = 2.0) -> None:
    """Smooth automatic weights from vertex-to-bone-segment distances (deterministic, fast, robust on
    non-manifold game meshes where heat weighting fails). Vertices are owned by the nearest bone and
    blended with bones whose distance is within `blend` meters of the nearest."""
    names, a, b = _deform_segments(arm, bones)
    if not names:
        raise ValueError("no deform bones")
    p = M.vertex_array(mesh_obj, world=True)
    ab = b - a
    t = np.einsum("vk,bk->vb", p, ab) - np.sum(a * ab, axis=1)[None, :]
    t = np.clip(t / np.maximum(np.sum(ab * ab, axis=1), 1e-9)[None, :], 0.0, 1.0)
    closest = a[None, :, :] + t[..., None] * ab[None, :, :]
    d = np.linalg.norm(p[:, None, :] - closest, axis=2)
    dmin = d.min(axis=1, keepdims=True)
    w = np.clip(1.0 - (d - dmin) / max(blend, 1e-6), 0.0, 1.0) ** power
    k = min(max_influences, len(names))
    idx = np.argsort(-w, axis=1)[:, :k]
    top = np.take_along_axis(w, idx, axis=1)
    top /= np.maximum(top.sum(axis=1, keepdims=True), 1e-9)
    for vg in list(mesh_obj.vertex_groups):
        if vg.name in names:
            mesh_obj.vertex_groups.remove(vg)
    groups = [_group(mesh_obj, n) for n in names]
    for vi in range(len(p)):
        for j in range(k):
            wv = float(top[vi, j])
            if wv > 1e-4:
                groups[idx[vi, j]].add([vi], wv, "REPLACE")
    bind(mesh_obj, arm)


def skin_auto(mesh_obj: bpy.types.Object, arm: bpy.types.Object) -> str:
    """Blender heat-map weights (ARMATURE_AUTO). Returns 'heat' or 'proximity' (fallback)."""
    for o in [x for x in bpy.context.view_layer.objects if x is not None]:
        o.select_set(False)
    mesh_obj.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    try:
        bpy.ops.object.parent_set(type="ARMATURE_AUTO")
        if any(len(v.groups) for v in mesh_obj.data.vertices):
            normalize(mesh_obj)
            return "heat"
    except RuntimeError:
        pass
    skin_proximity(mesh_obj, arm)
    return "proximity"


def normalize(mesh_obj: bpy.types.Object, max_influences: int = 4) -> None:
    """Keep the strongest `max_influences` weights per vertex and renormalize to 1."""
    me = mesh_obj.data
    groups = mesh_obj.vertex_groups
    for v in me.vertices:
        ws = sorted(((g.group, g.weight) for g in v.groups), key=lambda x: -x[1])
        keep = ws[:max_influences]
        drop = ws[max_influences:]
        total = sum(w for _, w in keep) or 1.0
        for gi, _ in drop:
            groups[gi].remove([v.index])
        for gi, w in keep:
            groups[gi].add([v.index], w / total, "REPLACE")


__all__ = [
    "BoneSpec",
    "bind",
    "chain",
    "create_armature",
    "humanoid",
    "normalize",
    "quadruped",
    "skin_auto",
    "skin_proximity",
    "skin_rigid",
]
