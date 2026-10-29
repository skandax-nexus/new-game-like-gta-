"""
Package-local helper (pipeline_test): a deterministic 12 m broadleaf test tree (curved trunk, four limbs,
28 lumpy leaf clumps in three greens) shared by model_test_tree (mesh LODs) and impostor_test_tree (the
octahedral impostor captured from the identical mesh). OWNER: Technical Artist G (TA-07).

The builder uses its own fixed seed (not the asset context's), so both assets get exactly the same tree.
Materials are runtime proxies (lib/export.runtime_material): the Principled base color the impostor captures
is the glTF baseColorFactor the runtime renders, so mesh and impostor match.
"""
from __future__ import annotations

import math

import bpy
import numpy as np

from lib import export, mesh as M

SEED = 20261029
BARK = "#5b4734"
LEAVES = ["#3f5c2b", "#56783a", "#6f8e45"]


def _tube(points: np.ndarray, radii: np.ndarray, sides: int) -> tuple[list, list]:
    verts, faces = [], []
    n = len(points)
    for k in range(n):
        t = points[min(k + 1, n - 1)] - points[max(k - 1, 0)]
        t /= np.linalg.norm(t)
        ref = np.array([0.0, 0.0, 1.0]) if abs(t[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
        u = np.cross(t, ref)
        u /= np.linalg.norm(u)
        v = np.cross(t, u)
        for i in range(sides):
            a = 2 * math.pi * i / sides
            verts.append(points[k] + (u * math.cos(a) + v * math.sin(a)) * radii[k])
    for k in range(n - 1):
        for i in range(sides):
            j = (i + 1) % sides
            faces.append([k * sides + i, k * sides + j, (k + 1) * sides + j, (k + 1) * sides + i])
    verts.append(points[-1])
    tip = len(verts) - 1
    for i in range(sides):
        faces.append([(n - 1) * sides + i, (n - 1) * sides + (i + 1) % sides, tip])
    return verts, faces


def build(detail: int = 1) -> list[bpy.types.Object]:
    """Returns [wood, leaves] mesh objects (Blender axes, base at the origin)."""
    rng = np.random.default_rng(SEED)
    bark = export.runtime_material("test_tree_bark", fallback_color=BARK, roughness=0.92)
    leaf_mats = [export.runtime_material(f"test_tree_leaves_{i}", fallback_color=c, roughness=0.7) for i, c in enumerate(LEAVES)]
    # ---- trunk + limbs
    verts: list = []
    faces: list = []

    def add(vf: tuple[list, list]) -> None:
        o = len(verts)
        verts.extend(vf[0])
        faces.extend([[i + o for i in f] for f in vf[1]])

    t = np.linspace(0, 1, 9)
    trunk = np.stack([0.35 * np.sin(t * 2.2), 0.18 * np.sin(t * 3.1 + 0.4), t * 6.0], axis=1)
    add(_tube(trunk, 0.48 - 0.3 * t ** 0.7, 10 + 2 * detail))
    tips = []
    for k in range(4):
        ang = k * math.pi / 2 + 0.4 + rng.uniform(-0.2, 0.2)
        base = trunk[6 + k % 2]
        dirv = np.array([math.cos(ang) * 0.75, math.sin(ang) * 0.75, 0.9])
        ln = rng.uniform(3.0, 4.0)
        s = np.linspace(0, 1, 6)
        pts = base[None, :] + s[:, None] * dirv[None, :] * ln + np.stack([0 * s, 0 * s, -0.4 * s * s], axis=1)
        add(_tube(pts, 0.17 - 0.12 * s, 6 + detail))
        tips.append(pts[-1])
    wood = M.from_pydata("test_tree_wood", np.array(verts), faces, smooth=True)
    wood.data.materials.append(bark)
    # ---- crown: lumpy clumps around the limb tips and over a dome
    centers = [tip + rng.normal(0, 0.3, 3) for tip in tips]
    for _ in range(24):
        th = rng.uniform(0, 2 * math.pi)
        ph = rng.uniform(0.15, 1.25)
        r = rng.uniform(2.6, 4.2)
        centers.append(np.array([math.cos(th) * math.sin(ph) * r * 1.05, math.sin(th) * math.sin(ph) * r * 1.05,
                                 8.6 + math.cos(ph) * r * 0.62]))
    clumps = []
    for k, c in enumerate(centers):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2 + detail, radius=1.0, location=tuple(c))
        o = bpy.context.active_object
        rad = rng.uniform(1.25, 2.0)
        co = np.array([v.co[:] for v in o.data.vertices])
        d = co / np.linalg.norm(co, axis=1, keepdims=True)
        bump = (0.82 + 0.18 * np.sin(d[:, 0] * 5.1 + k) * np.sin(d[:, 1] * 4.3 + 2 * k) + 0.1 * np.sin(d[:, 2] * 7.0 + k))
        flat = np.where(d[:, 2] < 0, 0.72, 1.0)  # flatter undersides like real crowns
        co = d * (rad * bump)[:, None]
        co[:, 2] *= flat
        o.data.vertices.foreach_set("co", co.reshape(-1))
        o.data.update()
        o.data.materials.append(leaf_mats[int(rng.integers(0, 3))])
        clumps.append(o)
    leaves = M.join(clumps, "test_tree_leaves")
    M.apply_transform(leaves)
    leaves.data.shade_smooth()
    return [wood, leaves]


__all__ = ["build"]
