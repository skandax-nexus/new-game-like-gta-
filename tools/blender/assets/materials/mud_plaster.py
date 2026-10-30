"""
@asset mud_plaster
@kind material
@style materials:MATERIAL_PRESETS.mud_plaster, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS

Finger-smoothed mud and cow-dung plaster (class S, 2.5 m x 2.5 m tile, seamless): overlapping hand sweeps (fan
arcs ~0.2 m radius, four finger grooves each, 1 mm relief, a ridge where each sweep stops), straw / chaff
fibres bound in the mud (~3 % flecks, some proud of the surface), dung fibre grain, shrinkage cracks on
0.15-0.35 m cells (wider where the coat is thick), a few spalls showing the darker base coat, slightly glossier
burnished ridges. Mandana borders (ochre / white) are decals (decals_settlement), not part of this set.
Target (MATERIAL_PRESETS.mud_plaster): average #a8835f, roughness 0.94 (0.86-1.00).

Period notes: mud and dung plaster, renewed every season and smoothed by hand, is the village wall of every
period on the Gangetic plain and the frontier; no lime, no paint.
OWNER: Technical Artist A (TA-01).
"""
import math
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
import _matkit as K  # noqa: E402

W = H = 2.5
kit = K.Kit(__file__, cls="S", size=(W, H), target="materials:MATERIAL_PRESETS.mud_plaster", family="soilDry")


def sweep_shape(lu, lv, e1, e2):
    """One hand sweep: a fan of four finger grooves on arcs around a pivot behind the palm."""
    R = 0.16 + 0.06 * e1
    py = lv + R
    r = np.sqrt(lu * lu + py * py)
    ang = np.arctan2(lu, py)
    span = 0.5 + 0.3 * e2
    inside = (np.abs(ang) < span) & (np.abs(r - R) < 0.032)
    # four fingers: grooves 16 mm apart, ridges between them; fade at the sweep ends
    k = (r - R + 0.032) / 0.064
    grooves = 0.5 + 0.5 * np.cos(2 * np.pi * k * 4.0)
    fade = tg.smoothstep(span, span * 0.7, np.abs(ang))
    stop = tg.smoothstep(span * 0.85, span, ang) * 0.6  # mud pushed up where the sweep stops
    hgt = 0.0009 * grooves * fade + 0.0012 * stop * tg.smoothstep(0.032, 0.0, np.abs(r - R))
    return np.where(inside, 0.0004 + hgt, -1e9)


with core.timer("sweeps"):
    h = 0.0018 * kit.fbm(0.5, 3) + 0.0006 * kit.fbm(0.08, 3)  # uneven hand-laid coat
    # cells >= the sweep extent (R sin(span) ~ 0.16 m) so no sweep is clipped at a lattice-cell border
    sw = kit.scatter(0.24, sweep_shape, density=0.9)
    sw2 = kit.scatter(0.2, sweep_shape, density=0.7)
    swp = np.maximum(sw.height(0.0), sw2.height(0.0))
    smooth = tg.smoothstep(0.0, 0.0004, swp)  # burnished by the palm
    h += swp
    # dung fibre grain and sand
    h += 0.0002 * kit.fbm(0.004, 2, aniso=(1.0, 3.0)) + 0.00012 * kit.fbm(0.0015, 1)

with core.timer("straw"):
    straw = np.full(h.shape, -1e9, np.float32)
    sid = np.zeros(h.shape, np.float32)
    for cell, L, Wd, hh in ((0.03, 0.018, 0.0009, 0.0006), (0.022, 0.012, 0.0008, 0.0005)):
        sc = kit.scatter(cell, K.shape_blade(L, Wd, hh, bend=0.3), density=0.3)
        better = sc.h > straw
        straw = np.where(better, sc.h, straw)
        sid = np.where(better, sc.id, sid)
    straw_m = (straw > -1e5).astype(np.float32)
    h += np.where(straw > -1e5, straw * (sid > 0.5), 0.0)  # half of the fibres stand proud

with core.timer("cracks"):
    thick = tg.smoothstep(-0.3, 0.5, kit.fbm(0.6, 3))  # thicker coat cracks wider
    cx, cy = kit.warp(0.03, 0.12, 3)
    c1, c2, ccid = kit.worley(0.24, 1.0, x=cx, y=cy)
    width = 0.006 + 0.012 * thick
    crack = tg.smoothstep(width, 0.0, c2 - c1) * tg.smoothstep(0.1, 0.45, kit.fbm(0.5, 3) * 0.5 + 0.5 + 0.2 * thick)
    fine1, fine2, _ = kit.worley(0.09, 1.0, x=cx, y=cy)
    fine = tg.smoothstep(0.012, 0.0, fine2 - fine1) * tg.smoothstep(0.55, 0.8, kit.fbm(0.3, 3) * 0.5 + 0.5)
    h -= 0.0025 * crack + 0.0008 * fine
    # spalls: a few flakes of the finish coat lost (darker base coat)
    sp = kit.fbm(0.18, 4) + 0.2 * kit.fbm(0.03, 2)
    thr = float(np.percentile(sp, 98.2))
    spall = tg.smoothstep(thr, thr + 0.02, sp)
    h -= 0.003 * spall

with core.timer("albedo"):
    t = np.clip(0.5 + 0.22 * kit.fbm(0.7, 4) + 0.1 * kit.fbm(0.1, 3) + 0.05 * kit.fbm(0.01, 2), 0, 1)
    alb = K.ramp(t, [(0.0, "#8a6a4b"), (0.4, "#9f7b58"), (0.7, "#ad8964"), (1.0, "#bd9a72")])
    # dung-rich patches greyer-greener, sun-dried patches paler
    alb = K.tint(alb, "#8b7d63", 0.25 * tg.smoothstep(0.1, 0.6, kit.fbm(0.35, 3)))
    alb = K.tint(alb, "#c4a782", 0.2 * tg.smoothstep(0.2, 0.7, kit.fbm(0.45, 3)))
    # burnished sweep ridges slightly darker / richer (compacted, damp when smoothed)
    alb = K.mul(alb, 1.0 - 0.05 * tg.blur(smooth, 2.0))
    # dung fibre specks (dark) and fine sand glints (pale)
    alb = K.mul(alb, 1.0 - 0.12 * tg.smoothstep(0.6, 0.85, kit.fbm(0.003, 2) * 0.5 + 0.5))
    alb = K.tint(alb, "#c4a86a", 0.85 * straw_m)  # straw flecks
    alb = K.mul(alb, 1.0 - 0.45 * crack - 0.15 * fine)
    alb = K.tint(alb, "#7d6249", 0.4 * spall)
    alb = K.compress_chroma(alb, 0.7)

with core.timer("roughness"):
    rough = 0.95 + 0.02 * kit.fbm(0.1, 2) - 0.07 * smooth + 0.03 * crack - 0.03 * straw_m + 0.02 * spall

kit.finish(height=h, albedo=alb, rough=rough, ao="cycles", ao_distance=0.025, ao_samples=48,
           description="Finger-smoothed mud and dung plaster (2.5 m): hand sweeps with finger grooves, straw flecks, "
                       "shrinkage cracks, spalls; mandana borders are decals.",
           preview="wall", preview_opts=dict(floor_band=None, samples=64))
