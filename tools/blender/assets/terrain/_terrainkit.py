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
    """Bare human footprint (DEPTH map, positive inside), 0.24-0.27 m long along +u (AD-3: anatomical, not a
    'bone'): a deep oval heel, the shallow LATERAL contact band of the arch (the medial arch leaves no print), a
    wide ball, a gap, then a large separate big toe and four smaller toes stepping down to the little toe.
    e2 < 0.5 = right foot, else left (mirrored)."""
    def fn(lu, lv, e1, e2):
        L = 0.25 * (0.94 + 0.12 * e1)
        mirror = np.where(e2 < 0.5, 1.0, -1.0)
        t = lu / L
        yy = lv * mirror / L  # +y = medial (big-toe) side
        heel = ((t + 0.33) / 0.15) ** 2 + ((yy + 0.01) / 0.145) ** 2
        lateral = ((t + 0.07) / 0.27) ** 2 + ((yy + 0.085) / 0.1) ** 2
        ball = ((t - 0.19) / 0.11) ** 2 + ((yy - 0.01) / 0.2) ** 2
        d = np.full(np.shape(lu), -1e9, np.float32)
        for q, k in ((heel, 1.0), (lateral, 0.72), (ball, 0.9)):
            d = np.maximum(d, np.where(q < 1.0, depth * k * (0.55 + 0.45 * np.sqrt(np.clip(1.0 - q, 0, 1))), -1e9))
        for tx, ty, rx, ry, k in ((0.41, 0.12, 0.07, 0.06, 0.85), (0.385, 0.015, 0.042, 0.037, 0.6),
                                  (0.36, -0.065, 0.038, 0.034, 0.55), (0.325, -0.13, 0.034, 0.031, 0.5),
                                  (0.28, -0.185, 0.03, 0.028, 0.45)):
            q = ((t - tx) / rx) ** 2 + ((yy - ty) / ry) ** 2
            d = np.maximum(d, np.where(q < 1.0, depth * k * np.sqrt(np.clip(1.0 - q, 0, 1)), -1e9))
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


def shape_leaf_ovate(length: float, width: float, h: float = 0.0025, curl: float = 0.012,
                     arch: float = 0.004) -> "callable":
    """Ovate sal / teak leaf with an ACUTE tip (AD-6: not a paper disc), petiole at lu = -L/2, widest at ~35 % of
    the length; lamina 1.5-3 mm thick, edges cupped / curled up by up to `curl` (dry leaves), arched along the
    midrib, raised midrib and pinnate lateral veins. Returns height (m) or -1e9."""
    def fn(lu, lv, e1, e2):
        L = length * (0.75 + 0.5 * e1)
        Wd = width * (0.8 + 0.4 * e2)
        t = lu / L + 0.5  # 0 petiole .. 1 tip
        tc = np.clip(t, 0.0, 1.0)
        half = Wd * 0.5 * np.sin(np.pi * tc ** 0.75) ** 0.9 * (1.0 - tc ** 4) ** 0.6 * np.where(tc > 0.7, (1.0 - tc) / 0.3, 1.0) ** 0.35
        inside = (t > 0.0) & (t < 1.0) & (np.abs(lv) < half)
        rel = np.abs(lv) / np.maximum(half, 1e-6)
        dry = e2  # some leaves flat and soft, others crisp and curled
        lam = h * (0.6 + 0.4 * e1) + curl * dry * rel ** 2.2 + arch * np.sin(np.pi * tc) * (0.4 + 0.6 * e1)
        rib = 0.0012 * np.exp(-(lv / (0.025 * Wd)) ** 2)
        veins = 0.0004 * (np.abs(np.sin(np.pi * (tc * 9.0 - rel * 2.2))) > 0.93)
        return np.where(inside, lam + rib + veins, -1e9)
    return fn


def _cuts(rng, total: float, spacing: tuple[float, float]) -> list[float]:
    """Random partition of [0, total) into pieces in `spacing` (rescaled to fill exactly); returns the cut starts."""
    w: list[float] = []
    while sum(w) < total - 1e-6:
        w.append(float(rng.uniform(spacing[0], spacing[1])))
    if len(w) > 1 and sum(w) - total > 0.5 * w[-1]:
        w.pop()
    sc = total / sum(w)
    off = float(rng.uniform(0.0, total))
    return sorted(((np.cumsum([0.0] + [a * sc for a in w[:-1]]) + off) % total).tolist())


def joint_bands(kit: "K.Kit", spacing: tuple[float, float], amp: float, feature: float,
                vspacing: tuple[float, float], carry: float = 0.3, tilt: float = 0.1, wander: float = 0.1,
                vfeature: float = 0.8, pinch: bool = False) -> dict[str, np.ndarray]:
    """Rock-face joint system for triplanar rock layers (v = up), periodic over the tile:
    sub-horizontal sheet / bedding joints (thickness drawn from `spacing`, each an independent wavy curve of
    amplitude `amp`, so beds thin and thicken along u) and, per band, vertical joints (spacing `vspacing`), each
    tilted (+-tilt m/m) and wandering (+-wander m); a fraction `carry` of a band's joints continue the joint of
    the band below (offset a little), the rest stop at the bed boundary. `pinch` lets neighbouring curves cross,
    so thin beds pinch out into lenses.
    Returns band (index), below / above (m to the joint below / above), side (m to the nearest vertical joint),
    left (m from the left joint), width (block width, m), lu (0..1 across the block), block (id 0..1),
    rand1..rand3 (per-block randoms), open_h / open_v (per-joint openness bias of the nearest joint, 0..1),
    thick (band thickness at this u, m), nb (number of bands)."""
    W, H = kit.size
    rng = kit.rng
    u = kit.x * W
    v = kit.y * H
    starts = _cuts(rng, H, spacing)
    nb = len(starts)
    thick_min = min(((starts[(i + 1) % nb] - starts[i]) % H) or H for i in range(nb))
    a_eff = amp if pinch else min(amp, 0.3 * thick_min)  # pinch: curves may cross -> beds thin out to lenses
    yc = np.zeros_like(kit.y)
    curves = []
    for k in range(nb):
        n = kit.fbm(feature, 3, x=kit.x, y=yc + 0.173 * k)
        curves.append(starts[k] + a_eff * n)
    dks = np.stack([(v - c) % H for c in curves])  # height above each curve
    band = np.argmin(dks, axis=0)
    below = np.min(dks, axis=0)
    above = np.min(np.stack([(c - v) % H for c in curves]), axis=0)
    open_curve = rng.uniform(0.0, 1.0, nb)
    up_idx = (band + 1) % nb
    open_h = np.where(below < above, open_curve[band], open_curve[up_idx]).astype(F)
    out = {k: np.zeros(u.shape, F) for k in ("side", "left", "width", "lu", "block", "rand1", "rand2", "rand3", "open_v")}
    prev: list[float] = []
    nv = kit.fbm(vfeature, 3, x=yc + 0.31, y=kit.y)  # wander along v (one noise, shifted per joint)
    for b in range(nb):
        cuts = _cuts(rng, W, vspacing)
        for pu in prev:
            if rng.uniform() < carry and cuts:
                j = int(np.argmin([abs(((c - pu + W / 2) % W) - W / 2) for c in cuts]))
                cuts[j] = (pu + float(rng.uniform(-0.12, 0.12))) % W
        cuts = sorted(cuts)
        prev = cuts
        nj = len(cuts)
        tilts = rng.uniform(-tilt, tilt, nj)
        shifts = rng.uniform(0.0, 1.0, nj)
        opens = rng.uniform(0.0, 1.0, nj)
        rnd = rng.uniform(0.0, 1.0, (nj, 4))
        mid = starts[b] + 0.5 * (((starts[(b + 1) % nb] - starts[b]) % H) or H)
        sel = band == b
        uu, vv = u[sel], v[sel]
        dv_mid = ((vv - mid + H / 2) % H) - H / 2
        nvs = nv[sel]
        pos = np.stack([(c + tilts[j] * dv_mid + wander * np.roll(nvs, 0) * (0.6 + 0.8 * shifts[j])) for j, c in enumerate(cuts)])
        e = (uu[None, :] - pos) % W  # distance to the right of each joint
        jl = np.argmin(e, axis=0)
        left = np.min(e, axis=0)
        right = np.min((pos - uu[None, :]) % W, axis=0)
        jr = np.argmin((pos - uu[None, :]) % W, axis=0)
        width = left + right
        out["left"][sel] = left
        out["side"][sel] = np.minimum(left, right)
        out["width"][sel] = width
        out["lu"][sel] = left / np.maximum(width, 1e-4)
        out["block"][sel] = rnd[jl, 0]
        out["rand1"][sel] = rnd[jl, 1]
        out["rand2"][sel] = rnd[jl, 2]
        out["rand3"][sel] = rnd[jl, 3]
        out["open_v"][sel] = np.where(left < right, opens[jl], opens[jr])
    out.update(band=band.astype(F), below=below.astype(F), above=above.astype(F), open_h=open_h,
               thick=(below + above).astype(F), nb=np.array(nb))
    return out


def finish_terrain(kit: "K.Kit", height: np.ndarray, albedo: np.ndarray, rough: np.ndarray, description: str,
                   macro_sigma: float = 0.6, macro_amount: float = 0.9, height_hp: float = 0.85, ao_distance: float = 0.04,
                   ao_height_mix: float = 0.3, preview: str = "ground", preview_opts: dict | None = None,
                   orm_span_min: float = 0.32, **kw) -> None:
    alb = kit.macro_flatten(albedo, macro_sigma, macro_amount)
    h = kit.height_highpass(height, max(macro_sigma * 1.5, 0.5), height_hp)
    po = dict(samples=48)
    po.update(preview_opts or {})
    kit.finish(height=h, albedo=alb, rough=rough, ao="cycles", ao_distance=ao_distance, ao_samples=40,
               ao_height_mix=ao_height_mix, orm_span_min=orm_span_min, description=description, preview=preview, preview_opts=po, **kw)


__all__ = ["K", "finish_terrain", "joint_bands", "layers", "shape_foot", "shape_hoof", "shape_leaf_ovate"]
