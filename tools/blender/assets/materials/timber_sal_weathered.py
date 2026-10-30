"""
@asset timber_sal_weathered
@kind material
@style materials:MATERIAL_PRESETS.timber_sal_weathered, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS

Weathered sal timber (class C, 2 m x 2 m, seamless). Grain runs along v (palisade stakes, posts, hall columns;
rotate UVs for beams): five adzed planks / split log faces of 0.3-0.55 m per tile with dark seams, overlapping adze scallops
(5-9 cm), coarse interlocked sal grain with open checks (splits along the grain), knots, silvering to grey on the
weathered surfaces with the brown wood surviving in sheltered grooves, dark weather streaks running down, a few
iron-free peg holes.
Target (MATERIAL_PRESETS.timber_sal_weathered): average #5e4631, roughness 0.80 (0.65-0.92).

Period notes: sal (Shorea robusta) palisade posts and beams were excavated at Mauryan Pataliputra (Bulandibagh);
adze-dressed, pegged joints, no sawn boards, no iron nails.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
import _matkit as K  # noqa: E402

W = H = 2.0
kit = K.Kit(__file__, cls="C", size=(W, H), target="materials:MATERIAL_PRESETS.timber_sal_weathered", family="timber",
            saturation_limit="medium")
x, y = kit.x, kit.y

with core.timer("planks"):
    # five planks across u (grain along v); seams wander slightly
    wob = 0.012 * kit.fbm(0.8, 3, aniso=(1.0, 4.0))
    widths = kit.rng.uniform(0.28, 0.55, 5)
    widths = widths * W / widths.sum()
    edges = np.concatenate([[0.0], np.cumsum(widths)])
    uw = (x * W + wob) % W
    pid = np.clip(np.searchsorted(edges, uw, side="right") - 1, 0, 4)
    pu = (uw - edges[pid]) / widths[pid]
    seam = tg.smoothstep(0.025, 0.0, np.minimum(pu, 1.0 - pu))
    pidr = ((pid * 0.618 + 0.13) % 1.0).astype(np.float32)
    # adze scallops: shallow dishes in rows along the grain, staggered per plank
    av = y * 29.0 + pidr * 0.3 / 0.07  # 29 adze rows per tile: seamless
    scal = np.abs(np.sin(np.pi * (av + 0.15 * np.sin(pu * 5.0 + pidr * 9.0)))) ** 0.6
    h = 0.0012 * scal + 0.004 * np.sin(np.pi * np.clip(pu, 0, 1)) ** 0.5 - 0.01 * seam
    # coarse grain: raised latewood ridges (weathered), checks (splits) along v
    wx, wy = kit.warp(0.01, 0.3, 3)
    ph = wx * 333.0 + 6.0 * kit.fbm(0.4, 3, x=wx, y=wy, aniso=(1.0, 10.0))
    grain = np.sin(2 * np.pi * ph)
    h += 0.0004 * grain + 0.00015 * kit.fbm(0.002, 2, aniso=(1.0, 20.0))
    c1, c2, ccid = kit.worley(0.06, 1.0, aniso=(1.0, 8.0))
    check = tg.smoothstep(0.03, 0.0, c2 - c1) * (ccid > 0.6) * tg.smoothstep(0.2, 0.6, kit.fbm(0.3, 3) * 0.5 + 0.5)
    h -= 0.004 * check
    # knots
    kf1, _, kid = kit.worley(0.35, 0.9)
    knot = tg.smoothstep(0.12, 0.0, kf1) * (kid > 0.75)
    h += 0.002 * knot
    # peg holes (round, a few per tile)
    pg = kit.scatter(0.6, K.shape_disc(0.012, 0.01, 0.15), density=0.15)
    h -= pg.height(0.0)

with core.timer("albedo"):
    t = np.clip(0.5 + 0.3 * (pidr - 0.5) + 0.15 * grain + 0.15 * kit.fbm(0.1, 3, aniso=(1.0, 6.0)), 0, 1)
    wood = K.ramp(t, [(0.0, "#3e2c1d"), (0.4, "#523b28"), (0.75, "#664b33"), (1.0, "#7a5b3f")])
    # silvering: grey weathered surface, brown survives in grooves (scallop bottoms, checks, seams)
    silver = tg.smoothstep(0.2, 0.6, kit.fbm(0.5, 3) * 0.5 + 0.5 + 0.25 * scal) * (1.0 - check) * (1.0 - seam)
    grey = K.ramp(t, [(0.0, "#5c5650"), (1.0, "#8a8278")])
    alb = wood * (1.0 - 0.65 * silver[..., None]) + grey * (0.65 * silver[..., None])
    alb = K.mul(alb, 1.0 - 0.5 * check - 0.6 * seam - 0.4 * pg.mask)
    alb = K.tint(alb, "#3a2a1c", 0.5 * knot)
    streak = tg.smoothstep(0.55, 0.85, kit.fbm(0.05, 3, aniso=(1.0, 12.0)) * 0.5 + 0.5)
    alb = K.tint(alb, "#2e261e", 0.3 * streak)
    alb = K.compress_chroma(alb, 0.8)

with core.timer("roughness"):
    rough = 0.82 + 0.04 * grain + 0.06 * silver - 0.06 * knot + 0.05 * check

kit.finish(height=h, albedo=alb, rough=rough, ao="cycles", ao_distance=0.02, ao_samples=32,
           description="Weathered sal timber (2 m, grain along v): five adzed planks, scallops, coarse grain, checks, "
                       "knots, peg holes, silvering with brown in the grooves.",
           extra_meta=dict(grainAxis="v"),
           preview="wall", preview_opts=dict(floor_band=None, samples=64))
