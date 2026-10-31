"""
@asset timber_weathered_grey
@kind material
@style materials:MATERIAL_PRESETS.timber_weathered_grey, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@tiers ultra,high
@fallback timber_sal_weathered

Sun-bleached grey timber (class C, 2 m x 2 m, seamless; P2 - ships on ultra / high, mobile falls back to
timber_sal_weathered): seven vertical boards (grain along v, 0.2-0.36 m wide), silver-grey weathered surface with
the soft earlywood eroded so the latewood stands proud, long tapered checks that wander with the grain, end-grain cross joints
with pegged (nail-free) battens, round hardwood pegs, a few knots, brown left in the deepest grooves, faint lichen.
Target (MATERIAL_PRESETS.timber_weathered_grey): average #80776a, roughness 0.88 (0.78-0.96).

Period notes: frontier doors, carts and jetties - pegged and lashed joinery, no iron nails or sawn-board regularity.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
import _matkit as K  # noqa: E402

W = H = 2.0
kit = K.Kit(__file__, cls="C", size=(W, H), target="materials:MATERIAL_PRESETS.timber_weathered_grey", family="timber",
            saturation_limit="medium")
x, y = kit.x, kit.y

with core.timer("boards"):
    wob = 0.01 * kit.fbm(0.8, 3, aniso=(1.0, 4.0))
    widths = kit.rng.uniform(0.2, 0.36, 7)
    widths = widths * W / widths.sum(dtype=np.float64)
    edges = np.concatenate([[0.0], np.cumsum(widths)])
    uw = (x * W + wob) % W
    pid = np.clip(np.searchsorted(edges, uw, side="right") - 1, 0, 6)
    pu = (uw - edges[pid]) / widths[pid]
    pidr = ((pid * 0.618 + 0.29) % 1.0).astype(np.float32)
    gap = tg.smoothstep(0.02, 0.0, np.minimum(pu, 1.0 - pu) * widths[pid] / 0.25)
    # end-grain butt joints: one per board at a per-board height (boards are shorter than the 2 m repeat)
    jv = (y * H + pidr * H) % H
    butt = tg.smoothstep(0.008, 0.0, np.abs(jv - 1.0))
    crown = 0.003 * np.sin(np.pi * np.clip(pu, 0, 1)) ** 0.6 - 0.0015 * np.abs(pu - 0.5) * (pidr > 0.5)  # cupping
    wx, wy = kit.warp(0.012, 0.3, 3)
    ph = wx * 400.0 + 7.0 * kit.fbm(0.5, 3, x=wx, y=wy, aniso=(1.0, 10.0)) + pid * 0.37
    grain = 0.5 + 0.5 * np.sin(2 * np.pi * ph)
    ridge = grain ** 3  # latewood stands proud, earlywood eroded
    h = crown + 0.0007 * ridge + 0.00015 * kit.fbm(0.002, 2, aniso=(1.0, 20.0))
    # P2 round 2: drying CHECKS follow the grain - long tapered splits (0.15-0.7 m, up to 3 mm open in the middle,
    # closing to nothing at both ends) that wander gently with the grain lines and sometimes run in echelon;
    # no Voronoi zig-zag, no straight polylines
    def check_shape(lu, lv, e1, e2):
        L = 0.15 + 0.55 * e1 ** 1.5
        t = lu / L
        wv = 0.0025 * np.sin(lu * (9.0 + 14.0 * e2) + 6.28 * e2) + 0.0012 * np.sin(lu * 37.0 + 3.0 * e1)
        wmax = 0.0006 + 0.0024 * e2 * (0.4 + 0.6 * e1)
        w = wmax * np.clip(1.0 - (2.0 * t) ** 2, 0.0, 1.0) ** 0.8
        q = np.abs(lv - wv) / np.maximum(w, 1e-6)
        inside = (np.abs(t) < 0.5) & (q < 1.0)
        return np.where(inside, (0.4 + 0.6 * w / 0.003) * np.sqrt(np.clip(1.0 - q * q, 0.0, 1.0)), -1e9)

    ck = kit.scatter((0.09, 0.45), check_shape, density=0.55, jitter=0.9, angle=(np.pi / 2 - 0.02, np.pi / 2 + 0.02),
                     x=(uw / W) % 1.0, y=y)
    check = np.clip(ck.mask * np.clip(ck.h, 0.0, 1.0), 0.0, 1.0) * (1.0 - gap)
    check = check * tg.smoothstep(0.004, 0.012, np.minimum(pu, 1.0 - pu) * widths[pid])  # not on the board edge
    h -= 0.006 * check + 0.012 * gap + 0.006 * butt
    kf1, _, kid = kit.worley(0.4, 0.9)
    knot = tg.smoothstep(0.1, 0.0, kf1) * (kid > 0.8)
    h += 0.0015 * knot
    # pegged battens across the boards at two heights (periodic) with round pegs per board
    bat_v = (y * H) % 1.0
    batten = tg.smoothstep(0.065, 0.06, np.abs(bat_v - 0.35))
    h = np.where(batten > 0, np.maximum(h, 0.018 * batten + 0.0006 * np.sin(2 * np.pi * kit.y * 600.0)), h)
    peg_u = (pu - 0.5) * widths[pid]
    peg = tg.smoothstep(0.011, 0.008, np.sqrt(peg_u ** 2 + (bat_v - 0.35) ** 2))
    h += 0.002 * peg

with core.timer("albedo"):
    t = np.clip(0.5 + 0.25 * (pidr - 0.5) + 0.15 * (grain - 0.5) + 0.15 * kit.fbm(0.12, 3, aniso=(1.0, 6.0)), 0, 1)
    silver = K.ramp(t, [(0.0, "#5f5a52"), (0.45, "#77706a"), (0.8, "#8c857a"), (1.0, "#9c958a")])
    brown = K.ramp(t, [(0.0, "#3e3226"), (1.0, "#5c4a38")])
    deep = np.clip(check + gap + 0.6 * (1.0 - grain) * 0.5 + butt, 0, 1)
    alb = silver * (1.0 - 0.5 * deep[..., None]) + brown * (0.5 * deep[..., None])
    alb = K.mul(alb, 1.0 - 0.45 * check - 0.6 * gap - 0.4 * butt)
    alb = K.tint(alb, "#4a3e32", 0.5 * knot)
    alb = K.tint(alb, "#6a5e50", 0.4 * peg)
    lich = tg.smoothstep(0.7, 0.85, kit.fbm(0.05, 3) * 0.5 + 0.5) * tg.smoothstep(0.4, 0.7, kit.fbm(0.5, 3) * 0.5 + 0.5)
    alb = K.tint(alb, "#8d8f7a", 0.35 * lich)
    streak = tg.smoothstep(0.55, 0.85, kit.fbm(0.06, 3, aniso=(1.0, 12.0)) * 0.5 + 0.5)
    alb = K.tint(alb, "#4a463e", 0.25 * streak)
    # battens: a different board, grain across (along u), slightly browner and darker under their edges
    bgrain = 0.5 + 0.5 * np.sin(2 * np.pi * (y * 600.0 + 5.0 * kit.fbm(0.4, 3, aniso=(10.0, 1.0))))
    bat_col = K.ramp(np.clip(0.45 + 0.3 * (bgrain - 0.5) + 0.1 * kit.fbm(0.1, 2), 0, 1), [(0.0, "#605548"), (1.0, "#8a8072")])
    alb = alb * (1.0 - batten[..., None]) + bat_col * batten[..., None]
    alb = K.mul(alb, 1.0 - 0.35 * tg.smoothstep(0.075, 0.065, np.abs(bat_v - 0.35)) * (1.0 - batten))
    alb = K.tint(alb, "#4e4236", 0.6 * peg)
    alb = K.compress_chroma(alb, 0.8)

with core.timer("roughness"):
    rough = 0.88 + 0.04 * (grain - 0.5) + 0.04 * check - 0.05 * knot + 0.03 * lich

kit.finish(height=h, albedo=alb, rough=rough, ao="cycles", ao_distance=0.02, ao_samples=32,
           description="Sun-bleached grey timber (2 m, grain along v): boards with eroded earlywood, split checks, "
                       "butt joints, pegged battens, knots, brown in the grooves, faint lichen.",
           extra_meta=dict(grainAxis="v"),
           preview="wall", preview_opts=dict(floor_band=None, samples=64))
