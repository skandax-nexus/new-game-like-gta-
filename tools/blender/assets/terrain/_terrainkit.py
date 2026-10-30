"""
Terrain-layer helpers (package-local, not an asset) for the WP1 splat layers. OWNER: Technical Artist A (TA-01).

Re-exports the shared WP1 kit (tools/blender/assets/materials/_matkit.py - terrain scripts list it in `@inputs`
because the runner hashes sibling helpers only) and adds terrain building blocks:

    layers(kit, specs)            stacked scatter layers (blades, leaves, pebbles) -> height, top-layer index, ids
    soil(kit, ...)                macro-neutral soil base (clods, crumbs, cracks)
    finish_terrain(kit, ...)      macro-flattened albedo + height high-pass, ORM.r = AO x height mix (the splat's
                                  height-blend proxy: stones bright, cavities dark), ground / cliff previews

Every terrain layer is MACRO-NEUTRAL: luminance variation above ~0.6 m is divided out (the splat's world-space
macro map supplies it); inside a 2-4 m tile it would read as repetition at 3 x 3 repeats.
"""
from __future__ import annotations

import pathlib
import sys

import numpy as np

_MAT = pathlib.Path(__file__).resolve().parents[1] / "materials"
if str(_MAT) not in sys.path:
    sys.path.insert(0, str(_MAT))

from lib import bake, core, materials, mesh, nodes, render, texgen as tg  # noqa: E402,F401  (hashed: used by _matkit)
from _matkit import *  # noqa: E402,F401,F403
import _matkit as K  # noqa: E402

F = np.float32


def layers(kit: "K.Kit", specs: list[dict]) -> dict[str, np.ndarray]:
    """Stack scatter layers bottom -> top. Each spec: cell (m or (u, v)), shape (callable), z (base height of the
    layer, m), density, angle (range or None), density_map. Returns height (m, -inf -> soil), layer index of the
    visible element (-1 = soil), its id 0..1, its local coords, e1."""
    h = np.full(kit.x.shape, -1e9, F)
    idx = np.full(kit.x.shape, -1, np.int16)
    ids = np.zeros(kit.x.shape, F)
    lu = np.zeros(kit.x.shape, F)
    lv = np.zeros(kit.x.shape, F)
    e1 = np.zeros(kit.x.shape, F)
    for i, s in enumerate(specs):
        sc = kit.scatter(s["cell"], s["shape"], density=s.get("density", 1.0), jitter=s.get("jitter", 1.0),
                         angle=s.get("angle", (0.0, 2 * np.pi)), scale=s.get("scale", (1.0, 1.0)),
                         density_map=s.get("density_map"), angle_map=s.get("angle_map"))
        hh = np.where(sc.h > -1e5, sc.h + s.get("z", 0.0), -1e9)
        better = hh > h
        h = np.where(better, hh, h)
        idx = np.where(better, i, idx)
        ids = np.where(better, sc.id, ids)
        lu = np.where(better, sc.lu, lu)
        lv = np.where(better, sc.lv, lv)
        e1 = np.where(better, sc.e1, e1)
    return {"h": h, "idx": idx, "id": ids, "lu": lu, "lv": lv, "e1": e1}


def shape_foot(depth: float = 0.008) -> "callable":
    """Bare human footprint (DEPTH map, positive inside): heel, arch, ball, five toes; 0.24-0.27 m long along +u."""
    def fn(lu, lv, e1, e2):
        L = 0.25 * (0.94 + 0.12 * e1)
        mirror = np.where(e2 < 0.5, 1.0, -1.0)  # left / right foot
        y = lv * mirror
        t = lu / L + 0.5  # 0 heel .. 1 toe
        heel = ((lu + 0.36 * L) / (0.075 * L * 1.6)) ** 2 + (y / (0.16 * L)) ** 2
        ball = ((lu - 0.2 * L) / (0.13 * L)) ** 2 + ((y - 0.02 * L) / (0.19 * L)) ** 2
        arch = ((lu + 0.05 * L) / (0.3 * L)) ** 2 + ((y + 0.07 * L) / (0.1 * L)) ** 2
        body = np.minimum(np.minimum(heel, ball), arch)
        d = np.where(body < 1.0, depth * (0.6 + 0.4 * np.sqrt(np.clip(1 - body, 0, 1))), -1e9)
        for k, (tx, ty, tr) in enumerate(((0.43, 0.1, 0.06), (0.4, -0.01, 0.045), (0.37, -0.08, 0.04),
                                          (0.33, -0.14, 0.035), (0.28, -0.19, 0.03))):
            dd = ((lu - tx * L) ** 2 + (y - ty * L) ** 2) / (tr * L) ** 2
            d = np.maximum(d, np.where(dd < 1.0, depth * 0.7 * np.sqrt(np.clip(1 - dd, 0, 1)), -1e9))
        del t
        return d
    return fn


def shape_hoof(depth: float = 0.012, size: float = 0.07) -> "callable":
    """Cloven hoof print of cattle (two half-moons, DEPTH map), pointing +u."""
    def fn(lu, lv, e1, e2):
        s = size * (0.85 + 0.3 * e1)
        out = np.full(lu.shape, -1e9, np.float32)
        for side in (-1.0, 1.0):
            cy = side * 0.27 * s
            dd = (lu / (0.5 * s)) ** 2 + ((lv - cy) / (0.24 * s)) ** 2
            gap = np.abs(lv) < 0.03 * s
            v = np.where((dd < 1.0) & ~gap & (lu > -0.45 * s), depth * (0.7 + 0.3 * np.sqrt(np.clip(1 - dd, 0, 1))), -1e9)
            out = np.maximum(out, v)
        return out
    return fn


def finish_terrain(kit: "K.Kit", height: np.ndarray, albedo: np.ndarray, rough: np.ndarray, description: str,
                   macro_sigma: float = 0.6, macro_amount: float = 0.9, height_hp: float = 0.85, ao_distance: float = 0.04,
                   ao_height_mix: float = 0.3, preview: str = "ground", preview_opts: dict | None = None, **kw) -> None:
    alb = kit.macro_flatten(albedo, macro_sigma, macro_amount)
    h = kit.height_highpass(height, max(macro_sigma * 1.5, 0.5), height_hp)
    po = dict(samples=48)
    po.update(preview_opts or {})
    kit.finish(height=h, albedo=alb, rough=rough, ao="cycles", ao_distance=ao_distance, ao_samples=40,
               ao_height_mix=ao_height_mix, description=description, preview=preview, preview_opts=po, **kw)


__all__ = ["K", "finish_terrain", "layers", "shape_foot", "shape_hoof"]
