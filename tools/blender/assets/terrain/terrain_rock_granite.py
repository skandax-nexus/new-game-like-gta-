"""
@asset terrain_rock_granite
@kind material
@style terrain:TERRAIN_LAYERS.rock_granite, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@inputs tools/blender/assets/materials/_matkit.py

Granite outcrop splat layer for TRIPLANAR projection (class T, 8 m x 8 m, seamless; v = world up on the side
projections). A Deccan tor face is a weathered, rounded body of rock cut by SPARSE joints - not a lattice of
blocks (B3 round 2: closed Voronoi cells left dark triangular wedges where three joints met, at the same spot in
every tile, in fish-scale rows):
- the surface is a field of broad whaleback swells (isotropic, 0.8-3 m, no shared long axis) with a ridged
  weathering skin;
- joints are OPEN-ENDED curved fractures scattered in three families (steep joints 1.2-3 m long, gently curved
  sheet joints 1.4-3.2 m, short hairline fractures 0.3-0.9 m), each fading out at both ends, so no joint closes a
  cell and no triple junction makes a wedge; openness varies per joint and along it (tight hairline to a
  rounded-shouldered cleft at most ~4 cm deep and 3 cm wide), so no single joint is the darkest feature of the
  tile; corestone rounding only along the open stretches;
- exfoliation: broken arcs of thin sheet steps (1-2 cm) that follow the swells, never closed rings; fresher,
  pinker rock where a sheet has gone;
- angular spall scars, speckled grain (pink feldspar, white quartz, black biotite) and pits;
- black water streaks below the swell shoulders and joint lips, orange and grey-green crustose lichen with lobed
  rosettes on the upward-facing shoulders.
Target (TERRAIN_LAYERS.rock_granite): average #87827a, roughness 0.80.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
from _terrainkit import K, finish_terrain  # noqa: E402

F = np.float32
S = 8.0
kit = K.Kit(__file__, cls="T", size=(S, S), target="terrain:TERRAIN_LAYERS.rock_granite", family="sandstone",
            rough_spread=0.08)
x, y = kit.x, kit.y
rng = kit.rng


def joint_shape(length: tuple[float, float], core_w: tuple[float, float], bow: float):
    """Open-ended, nearly straight fracture along +-u of its seed (granite joints are planar): returns the
    proximity p = 1 - |offset| / R (0..1) inside a shoulder radius R = 6 x the core half-width, -1e9 outside. The core
    (p > 5/6) is the crack itself; it narrows to nothing at both ends. e1 drives the width (and the joint's
    openness), e2 the length and bow."""
    def fn(lu, lv, e1, e2):
        L = length[0] + (length[1] - length[0]) * e2
        w = core_w[0] + (core_w[1] - core_w[0]) * e1 ** 1.5
        t = lu / (0.5 * L)
        cv = lv - bow * L * (e2 - 0.5) * (1.0 - t * t)
        taper = np.clip(1.0 - t ** 10, 0.0, 1.0)
        R = 6.0 * w * (0.6 + 0.4 * taper)
        p = 1.0 - np.abs(cv) / np.maximum(R, 1e-5)
        return np.where((np.abs(t) < 1.0) & (p > 0.0), p * (0.6 + 0.4 * taper), -1e9)
    return fn


with core.timer("swells"):
    # broad isotropic whaleback swells carrying a FRACTURED skin: planar facets at three scales (spalled sheets and
    # chips that meet in steps and creases), rounded by weathering - a rock face, not dough; no block lattice
    wx, wy = kit.warp(0.5, 2.5, 3)
    sw = 0.13 * kit.fbm(2.7, 3, x=wx, y=wy) + 0.012 * kit.fbm(1.0, 3)
    fx, fy = kit.warp(0.15, 0.8, 2)
    fa = kit.facets(1.6, slope=0.05, x=fx, y=fy)
    fb_ = kit.facets(0.55, slope=0.07, x=fx, y=fy)
    fcc = kit.facets(0.18, slope=0.1)
    gate_b = tg.smoothstep(-0.2, 0.3, kit.fbm(1.2, 2))  # the medium chips only over part of the face
    frac = fa["h"] + 0.7 * fb_["h"] * gate_b + 0.35 * fcc["h"] * tg.smoothstep(0.0, 0.4, kit.fbm(0.7, 2))
    frac = kit.blur(frac, 0.05)  # weathered arrises: no bright step lines or dark step shadows
    rounding = tg.smoothstep(-0.3, 0.4, kit.fbm(1.8, 2))  # weathered zones: arrises rounded off
    frac = frac * (1.0 - rounding) + kit.blur(frac, 0.12) * rounding
    sw = sw + frac + 0.003 * (kit.fbm(0.25, 3, ridged=True) - 0.5)
    h = sw.astype(F)
    swn = (sw - float(sw.mean(dtype=np.float64))) / max(float(sw.std(dtype=np.float64)), 1e-6)

with core.timer("joints"):
    # three families of open-ended, nearly planar fractures on a lightly warped plane (no closed cells): a sharp
    # V-notch core and a low rounded shoulder where the joint is open; openness per joint and along it
    jx, jy = kit.warp(0.12, 1.4, 3)
    fams = [  # (cell m, length, core half-width, angle range (rad, around +u), bow, density, max depth m)
        (1.6, (2.4, 3.2), (0.003, 0.012), (np.pi / 2 - 0.35, np.pi / 2 + 0.35), 0.03, 0.4, 0.045),  # steep joints
        (2.0, (3.0, 4.0), (0.003, 0.011), (-0.25, 0.25), 0.05, 0.4, 0.04),                        # sheet joints
        (1.0, (0.8, 1.8), (0.002, 0.005), (0.0, np.pi), 0.06, 0.3, 0.012),                         # secondary
        (0.5, (0.3, 0.8), (0.0012, 0.0025), (0.0, np.pi), 0.05, 0.25, 0.004),                      # short fractures
    ]
    jcore = np.zeros(h.shape, F)
    jdepth = np.zeros(h.shape, F)
    jopen = np.zeros(h.shape, F)
    along = np.clip(0.5 + 0.8 * kit.fbm(0.9, 3), 0.0, 1.0)  # openness varies ALONG every joint
    for cell, ln, cw, ang, bow, dens, dmax in fams:
        sc = kit.scatter(cell, joint_shape(ln, cw, bow), density=dens, angle=ang, x=jx, y=jy)
        p = np.where(sc.h > -1e5, sc.h, 0.0).astype(F)
        op = (0.3 + 0.7 * sc.e1) * along
        notch = np.clip((p - 5.0 / 6.0) * 6.0, 0.0, 1.0) ** 0.7  # V core
        shoulder = tg.smoothstep(0.0, 1.0, p) ** 2 * op  # low rounded arris only where open
        d = dmax * (0.25 + 0.75 * op) * notch + 0.45 * dmax * shoulder
        better = d > jdepth
        jdepth = np.where(better, d, jdepth)
        jopen = np.where(better, op, jopen)
        jcore = np.maximum(jcore, notch * (0.4 + 0.6 * op))
    h = h - jdepth
    crest = np.clip(1.0 - jdepth / 0.012, 0.0, 1.0) * tg.smoothstep(-0.6, 0.8, swn)

with core.timer("exfoliation"):
    # broken arcs of thin sheet steps following iso-lines of the swell field (never a closed ring)
    cw = swn + 0.35 * kit.fbm(0.8, 3) + 0.08 * kit.fbm(0.2, 2)
    sheet = np.zeros(h.shape, F)
    lip = np.zeros(h.shape, F)
    peel = np.zeros(h.shape, F)
    for lvl, ph in ((0.35, 0.13), (1.05, 0.57)):
        arc = tg.smoothstep(0.05, 0.35, kit.fbm(0.9, 3, x=x + ph, y=y, aniso=(1.4, 0.7)))
        s_ = tg.smoothstep(lvl, lvl + 0.04, cw) * arc
        sheet = np.maximum(sheet, s_)
        lip = np.maximum(lip, tg.smoothstep(0.0, 0.3, s_) * tg.smoothstep(1.0, 0.7, s_) * arc)
        peel = np.maximum(peel, arc * (1.0 - s_) * tg.smoothstep(lvl - 0.35, lvl - 0.02, cw))
    h = h + 0.02 * kit.blur(sheet, 0.03)

with core.timer("spalls and grain"):
    fc = kit.facets(0.22, slope=0.15)
    chip_gate = tg.smoothstep(0.66, 0.72, kit.fbm(0.5, 3) * 0.5 + 0.5) * (fc["id"] > 0.5) * crest
    chip = chip_gate * tg.smoothstep(0.0, 0.006, fc["d"])
    h = h + chip * (-0.005 + 0.012 * fc["h"])
    g1, g2, gid = kit.worley(0.006, 1.0)
    pits = tg.smoothstep(0.35, 0.1, g1) * (gid > 0.86)
    h = h + 0.0012 * kit.fbm(0.02, 3) + 0.0005 * kit.fbm(0.006, 2) - 0.0015 * pits
    # grus (granular fill) at the bottom of the open stretches
    grus = jcore * tg.smoothstep(0.45, 0.8, jopen) * tg.smoothstep(0.3, 0.6, kit.fbm(0.1, 3) * 0.5 + 0.5)
    h = h + grus * (0.004 * kit.fbm(0.01, 3) + 0.006)

with core.timer("albedo"):
    t = np.clip(0.52 + 0.12 * kit.fbm(0.7, 3) + 0.06 * kit.fbm(2.0, 2) + 0.06 * kit.fbm(0.05, 2), 0, 1)
    rock = K.ramp(t, [(0.0, "#716c65"), (0.45, "#857f77"), (0.75, "#968f87"), (1.0, "#a49c92")])
    # speckled grain: pink K-feldspar laths, white quartz, black biotite
    rock = K.tint(rock, "#b89a8c", 0.45 * (gid < 0.18))
    rock = K.tint(rock, "#c9c4bb", 0.35 * ((gid > 0.18) & (gid < 0.3)))
    rock = K.tint(rock, "#2c2a28", 0.6 * ((gid > 0.93) & (g1 < 0.4)))
    rock = K.mul(rock, 1.0 - 0.25 * pits)
    rock = K.tint(rock, "#ab9585", 0.3 * peel)  # fresher, pinker rock where a sheet peeled
    rock = K.tint(rock, "#9a9187", 0.25 * chip)
    rock = K.tint(rock, "#5a5249", 0.18 * lip)
    rock = K.tint(rock, "#4e4840", 0.22 * jcore)  # joints read by relief and AO; only a faint grime line
    rock = K.tint(rock, "#7a6a58", 0.35 * grus)
    # black water streaks from swell shoulders and joint lips, running down v (lengths 0.4-2.4 m)
    gyy = np.gradient(tg.blur(h, kit.px(0.12)), axis=0) / kit.texel  # row 0 = v 1: > 0 means the surface falls with v
    shoulder = tg.smoothstep(0.03, 0.2, gyy) * crest
    src = np.clip(shoulder + 0.5 * jcore * (kit.white(0.5) > 0.5), 0, 1)
    src = src * tg.smoothstep(0.55, 0.8, kit.fbm(0.15, 3, aniso=(0.3, 6.0)) * 0.5 + 0.5)
    s_long = tg.directional_blur_down(kit.blur(src * (kit.white(0.7) > 0.6), 0.03), int(kit.px(2.4)), 0.994)
    s_short = tg.directional_blur_down(kit.blur(src, 0.03), int(kit.px(0.6)), 0.985)
    streak = np.clip(kit.blur(np.maximum(0.9 * s_long, 0.7 * s_short), 0.08) * 1.2, 0, 1)
    streak = streak * (0.6 + 0.4 * tg.smoothstep(-0.3, 0.3, kit.fbm(0.8, 2)))
    rock = K.tint(rock, "#3a3835", 0.26 * streak)  # soft, long: never the darkest stamp in the tile
    # lichen on the upward-facing shoulders (dh/dv > 0 seen on a wall = surface facing the sky)
    gy = np.gradient(tg.blur(h, kit.px(0.05)), axis=0) * -1.0 / kit.texel
    up = tg.smoothstep(0.0, 0.2, -gy) * crest * (1.0 - streak)
    lic = kit.lichen(up, coverage=0.07, patch_m=0.3, rosette_m=0.03, rosette_density=0.45)
    sp_ = kit.fbm(0.6, 2) > 0.15  # orange Caloplaca in some patches, grey-green elsewhere
    sr_ = kit.white(0.07) > 0.6
    orange = np.clip(lic["crust"] * sp_ + lic["rosette"] * sr_, 0, 1)
    green = np.clip(lic["crust"] * ~sp_ + lic["rosette"] * ~sr_, 0, 1)
    rock = K.tint(rock, "#a8784a", 0.45 * orange)
    rock = K.tint(rock, "#8c8e78", 0.55 * green)
    rock = K.tint(rock, "#b0aa98", 0.1 * lic["centre"])
    h = h + lic["h"]
    alb = K.compress_chroma(rock, 0.9)

with core.timer("roughness"):
    rough = 0.8 + 0.04 * kit.fbm(0.2, 3) - 0.1 * streak + 0.07 * (orange + green) + 0.06 * grus - 0.04 * peel

finish_terrain(kit, h, alb, rough, macro_sigma=2.0, macro_amount=0.55, height_hp=0.25, ao_distance=0.35,
               ao_height_mix=0.35, preview="cliff",
               description="Granite tor for triplanar projection (8 m, v = up): broad isotropic whaleback swells cut by "
                           "sparse open-ended curved joints (steep, sheet and short fractures; tight to softly open, "
                           "no closed cells or wedges), broken exfoliation arcs, spall chips, speckled grain, black "
                           "water streaks, orange and grey-green crustose lichen.",
               extra_meta=dict(projection="triplanar", vUp="v = world up on side projections"))
