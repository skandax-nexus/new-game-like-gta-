"""
@asset terrain_rock_granite
@kind material
@style terrain:TERRAIN_LAYERS.rock_granite, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@inputs tools/blender/assets/materials/_matkit.py

Granite outcrop splat layer for TRIPLANAR projection (class T, 8 m x 8 m, seamless; v = world up on the side
projections): rounded exfoliating masses of a Deccan tor - domed blocks 1-3 m between curved joints, onion-skin
exfoliation sheets peeling in arcs, grus (granular disintegration) in the joints, speckled grain (pink feldspar,
white quartz, black biotite), black water stains running down from crests, orange and grey-green lichen
colonies on the upper surfaces.
Target (TERRAIN_LAYERS.rock_granite): average #87827a, roughness 0.80.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
from _terrainkit import K, finish_terrain  # noqa: E402

S = 8.0
kit = K.Kit(__file__, cls="T", size=(S, S), target="terrain:TERRAIN_LAYERS.rock_granite", family="sandstone",
            rough_spread=0.08)
x, y = kit.x, kit.y

with core.timer("masses"):
    st = kit.stones(1.8, warp_m=0.35, jitter=0.9)
    d, sid, f1 = st["d"], st["id"], st["f1"]
    # each mass is domed (exfoliated), rounded towards its joints
    dome = 0.35 * np.clip(d / 0.9, 0.0, 1.0) ** 0.45
    joint = tg.smoothstep(0.06, 0.0, d)
    h = dome - 0.08 * joint
    # onion-skin exfoliation sheets: arcs concentric to the mass centre, partly peeled (steps)
    shells = np.sin(2 * np.pi * (f1 / 0.22 + 0.5 * kit.fbm(0.8, 3)))
    peel = tg.smoothstep(0.6, 0.95, shells) * tg.smoothstep(-0.1, 0.4, kit.fbm(1.0, 3))
    h += 0.02 * peel
    # secondary cracks, grus pits and granular surface
    c1, c2, _ = kit.worley(0.6, 1.0, x=kit.warp(0.05, 0.3, 2)[0])
    crack = tg.smoothstep(0.012, 0.0, c2 - c1) * tg.smoothstep(0.5, 0.75, kit.fbm(0.8, 3) * 0.5 + 0.5)
    h -= 0.02 * crack
    h += 0.02 * kit.fbm(0.5, 4) + 0.006 * kit.fbm(0.08, 3) + 0.0012 * kit.fbm(0.012, 2)
    grain = kit.fbm(0.004, 1)

with core.timer("albedo"):
    t = np.clip(0.5 + 0.25 * (sid - 0.5) + 0.12 * kit.fbm(0.6, 3) + 0.06 * kit.fbm(0.05, 3), 0, 1)
    rock = K.ramp(t, [(0.0, "#6c6862"), (0.4, "#807a72"), (0.75, "#938c82"), (1.0, "#a79f93")])
    # speckle: feldspar pink, quartz white, biotite black
    g1 = tg.smoothstep(0.35, 0.6, grain)
    g2 = tg.smoothstep(-0.35, -0.6, grain)
    rock = K.tint(rock, "#b49a8c", 0.35 * g1)
    rock = K.tint(rock, "#2a2724", 0.45 * g2)
    rock = K.mul(rock, 1.0 + 0.1 * tg.smoothstep(0.7, 0.9, kit.fbm(0.002, 1)))
    # fresh pale rock where sheets peeled; grus in joints (brownish)
    rock = K.tint(rock, "#b5ada0", 0.3 * peel)
    rock = K.tint(rock, "#6e5f4e", 0.55 * joint + 0.4 * crack)
    # black water stains below crests and joints, running down (v)
    src = tg.smoothstep(0.75, 1.0, dome / 0.35) * tg.smoothstep(0.3, 0.6, kit.fbm(0.2, 3, aniso=(0.2, 1.0)) * 0.5 + 0.5)
    streak = tg.directional_blur_down(src, int(kit.px(1.2)), 0.988)
    streak = np.clip(tg.blur(streak, 2.0), 0, 1)
    rock = K.tint(rock, "#2b2a28", 0.55 * streak)
    # lichen: orange (Caloplaca-like) and grey-green colonies on upper surfaces
    lzone = tg.smoothstep(0.5, 0.8, dome / 0.35) * (1.0 - streak)
    lf1, _, lid = kit.worley(0.05, 1.0)
    blob = tg.smoothstep(0.55, 0.3, lf1 + 0.15 * kit.fbm(0.015, 2))
    orange = blob * (lid > 0.7) * lzone * tg.smoothstep(0.1, 0.5, kit.fbm(0.6, 3))
    green = blob * (lid < 0.25) * lzone
    rock = K.tint(rock, "#c07a32", 0.75 * orange)
    rock = K.tint(rock, "#8a8f74", 0.5 * green)
    alb = K.compress_chroma(rock, 0.9)

with core.timer("roughness"):
    rough = 0.8 + 0.05 * kit.fbm(0.2, 3) - 0.1 * streak + 0.08 * (orange + green) + 0.05 * joint

finish_terrain(kit, h, alb, rough, macro_sigma=2.0, macro_amount=0.6, height_hp=0.3, ao_distance=0.3,
               ao_height_mix=0.35, preview="cliff",
               description="Granite tor for triplanar projection (8 m, v = up): rounded exfoliating masses, onion-skin "
                           "sheets, speckled grain, black water stains, orange and grey lichen.",
               extra_meta=dict(projection="triplanar", vUp="v = world up on side projections"))
