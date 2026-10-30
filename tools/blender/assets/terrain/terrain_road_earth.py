"""
@asset terrain_road_earth
@kind material
@style terrain:TERRAIN_LAYERS.road_packed_earth, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@inputs tools/blender/assets/materials/_matkit.py

Packed-earth road splat layer (class T, 4 m x 4 m, seamless, macro-neutral). u runs ALONG the road: two bullock-
cart wheel ruts 1.4 m apart (centres at v = 1.3 m and 2.7 m, 0.22 m wide, 1.5-3 cm deep, several overlapping
wheel lines with pushed-up lips), the hoof-churned strip between them where the oxen walk (cloven prints, loose
dust), foot-packed shoulders, a scatter of pebbles pushed outward, straw bits and fine dust. Ruts are kept shallow
and low-contrast so the layer still reads as packed ground where it is splatted without road alignment
(settlement yards); roads should orient the layer's u along the road tangent (metadata.ruts).
Target (TERRAIN_LAYERS.road_packed_earth): average #9a7e5e, roughness 0.88.
OWNER: Technical Artist A (TA-01).
"""
import math
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
from _terrainkit import K, finish_terrain, layers, shape_foot, shape_hoof  # noqa: E402

S = 4.0
kit = K.Kit(__file__, cls="T", size=(S, S), target="terrain:TERRAIN_LAYERS.road_packed_earth", family="soilDry",
            rough_spread=0.05)
x, y = kit.x, kit.y
vm = y * S
RUTS = (1.3, 2.7)
RW = 0.22

with core.timer("ruts"):
    h = 0.0025 * kit.fbm(0.3, 3) + 0.001 * kit.fbm(0.05, 3) + 0.0003 * kit.fbm(0.006, 2)
    wob = 0.14 * kit.fbm(0.7, 3, aniso=(2.0, 1.0)) + 0.03 * kit.fbm(0.25, 2, aniso=(2.0, 1.0))
    rut = np.zeros_like(h)
    lip = np.zeros_like(h)
    for c in RUTS:
        for k, (off, depth) in enumerate(((0.0, 0.022), (0.035, 0.012), (-0.03, 0.01))):
            dv = vm - c - off - wob - 0.012 * kit.fbm(0.4, 2, aniso=(5.0, 1.0))
            w = RW * (0.55 if k else 0.9)
            prof = np.clip(1.0 - (dv / (w * 0.5)) ** 2, 0.0, 1.0) ** 0.7
            rut = np.maximum(rut, depth * prof * np.clip(0.65 + 0.5 * kit.fbm(0.4, 3, aniso=(5.0, 1.0)), 0.25, 1.2))
        dv0 = np.abs(vm - c - wob)
        lip = np.maximum(lip, tg.smoothstep(RW * 0.95, RW * 0.6, dv0) * tg.smoothstep(RW * 0.35, RW * 0.6, dv0))
    h += -rut + 0.004 * lip
    # compacted crust with fine cracks on the shoulders and the crown
    c1, c2, _ = kit.worley(0.1, 1.0, x=kit.warp(0.008, 0.05, 2)[0])
    crust_crack = tg.smoothstep(0.025, 0.0, c2 - c1) * tg.smoothstep(0.55, 0.75, kit.fbm(0.25, 3) * 0.5 + 0.5)
    h -= 0.0015 * crust_crack
    in_rut = tg.smoothstep(0.004, 0.012, rut)
    between = tg.smoothstep(RUTS[0] + 0.2, RUTS[0] + 0.35, vm) * tg.smoothstep(RUTS[1] - 0.2, RUTS[1] - 0.35, vm)
    shoulder = 1.0 - tg.smoothstep(RUTS[0] - 0.5, RUTS[0] - 0.25, vm) * tg.smoothstep(RUTS[1] + 0.5, RUTS[1] + 0.25, vm)

with core.timer("prints"):
    # oxen walk between the ruts (cloven prints, dense, overlapping), people on the shoulders
    hooves = kit.scatter(0.16, shape_hoof(0.012, 0.075), density=0.55, density_map=0.2 + 0.8 * between, angle=(-0.4, 0.4))
    feet = kit.scatter(0.4, shape_foot(0.006), density=0.25, density_map=shoulder,
                       angle=(-0.3, 0.3))
    d = np.maximum(hooves.height(0.0), feet.height(0.0))
    h += 0.5 * np.clip(tg.blur(d, 2.5) - d, 0.0, None) - d
    churn = tg.blur(hooves.mask, 6.0)

with core.timer("scatter"):
    specs = [
        dict(cell=0.05, shape=K.shape_pebble(0.012, 0.009, 0.006, 0.6, 0.3), z=0.0, density=0.35,
             density_map=0.25 + 0.75 * shoulder * (1.0 - in_rut)),
        dict(cell=0.025, shape=K.shape_pebble(0.005, 0.004, 0.0025), z=0.0, density=0.45, density_map=1.0 - in_rut),
        dict(cell=0.07, shape=K.shape_blade(0.06, 0.0014, 0.002, 0.4), z=0.0, density=0.25, density_map=shoulder + 0.3 * between),
    ]
    L = layers(kit, specs)
    top = L["h"] + h
    over = (L["h"] > -1e5) & (top > h)
    h = np.where(over, top, h)

with core.timer("albedo"):
    t = np.clip(0.5 + 0.25 * kit.fbm(0.12, 3) + 0.1 * kit.fbm(0.02, 2), 0, 1)
    soil = K.ramp(t, [(0.0, "#735b42"), (0.4, "#8a7052"), (0.7, "#9c8060"), (1.0, "#b0957a")])
    soil = K.tint(soil, "#b9a284", 0.35 * churn * between + 0.2 * tg.smoothstep(0.0, 1.0, lip))  # loose dust
    soil = K.mul(soil, 1.0 - 0.12 * in_rut)  # compacted, darker rut floors
    soil = K.mul(soil, 1.0 - 0.18 * np.clip(d / 0.01, 0, 1) - 0.25 * crust_crack)
    idx, gid = L["idx"], L["id"]
    peb = K.ramp(gid, [(0.0, "#6a6158"), (0.5, "#857a6c"), (1.0, "#a2957f")])
    straw = K.ramp(gid, [(0.0, "#8a7a52"), (1.0, "#b19f6e")])
    col = np.where((idx == 2)[..., None], straw, K.tint(peb, "#9c8060", 0.35))  # dust-coated stones
    alb = np.where(over[..., None], col, soil)
    alb = K.compress_chroma(alb, 0.85)

with core.timer("roughness"):
    rough = 0.9 + 0.03 * kit.fbm(0.05, 2) - 0.1 * in_rut + 0.04 * churn * between - 0.08 * (over & (idx < 2))

finish_terrain(kit, h, alb, rough, ao_distance=0.05, height_hp=0.6,
               description="Packed-earth road (4 m, u along the road): two bullock-cart ruts 1.4 m apart, hoof-churned "
                           "centre, footprints on the shoulders, pebbles, straw, dust; macro-neutral.",
               extra_meta=dict(ruts=dict(axis="u", centersMeters=list(RUTS), widthMeters=RW, gaugeMeters=1.4)))
