"""
@asset terrain_black_soil
@kind material
@style terrain:TERRAIN_LAYERS.black_cotton_soil, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@inputs tools/blender/assets/materials/_matkit.py

Black cotton soil (regur) splat layer (class T, 4 m x 4 m, seamless, macro-neutral): Deccan vertisol in the dry
season - deep polygonal shrinkage cracks (primary polygons 0.3-0.7 m, cracks 1.5-4 cm wide and dark, secondary
hairline cracks inside), slightly domed, self-mulching granular crust of fine aggregates on the polygon tops,
a few calcareous nodules (kankar, pale), stubble and leaf bits. The wet look (tar-black, glossy) comes from the
runtime wetness / porosity, not from this map.
Target (TERRAIN_LAYERS.black_cotton_soil): average #3e3a33, roughness 0.90.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
from _terrainkit import K, finish_terrain, layers  # noqa: E402

S = 4.0
kit = K.Kit(__file__, cls="T", size=(S, S), target="terrain:TERRAIN_LAYERS.black_cotton_soil", family="soilWet",
            rough_spread=0.05)

with core.timer("polygons"):
    st = kit.stones(0.5, warp_m=0.05, jitter=0.95)
    d = st["d"]
    cw = 0.01 + 0.018 * (kit.fbm(0.4, 3) * 0.5 + 0.5)  # crack half-width 10-28 mm
    crack = tg.smoothstep(cw, cw * 0.4, d)
    dome = 0.012 * np.clip(d / 0.2, 0.0, 1.0) ** 0.5
    edge_crumble = 0.004 * kit.fbm(0.02, 3) * tg.smoothstep(cw + 0.04, cw, d)
    h = dome + edge_crumble - 0.05 * crack
    # secondary cracks inside the polygons
    sx, sy = kit.warp(0.01, 0.06, 2)
    s1, s2, _ = kit.worley(0.14, 1.0, x=sx, y=sy)
    sec = tg.smoothstep(0.02, 0.0, s2 - s1) * tg.smoothstep(0.45, 0.7, kit.fbm(0.2, 3) * 0.5 + 0.5) * (1.0 - crack)
    h -= 0.006 * sec
    # self-mulching granular crust
    specs = [
        dict(cell=0.012, shape=K.shape_pebble(0.004, 0.0035, 0.0025, 0.6, 0.35), z=0.0, density=0.85, density_map=1.0 - crack),
        dict(cell=0.06, shape=K.shape_pebble(0.008, 0.006, 0.005, 0.6, 0.4), z=0.0, density=0.12, density_map=1.0 - crack),  # kankar
        dict(cell=0.08, shape=K.shape_blade(0.07, 0.0016, 0.0025, 0.3), z=0.0, density=0.12, density_map=1.0 - crack),
    ]
    L = layers(kit, specs)
    top = L["h"] + h
    over = (L["h"] > -1e5) & (top > h)
    h = np.where(over, top, h)

with core.timer("albedo"):
    t = np.clip(0.5 + 0.25 * kit.fbm(0.1, 3) + 0.12 * kit.fbm(0.015, 2), 0, 1)
    soil = K.ramp(t, [(0.0, "#2d2a25"), (0.4, "#38342e"), (0.75, "#46413a"), (1.0, "#544e45")])
    soil = K.tint(soil, "#5d574d", 0.3 * tg.smoothstep(0.6, 0.9, kit.fbm(0.05, 3) * 0.5 + 0.5))  # dry grey crust
    soil = K.mul(soil, 1.0 - 0.6 * crack - 0.3 * sec)
    idx, gid = L["idx"], L["id"]
    crumbs = K.mul(soil, 0.9 + 0.25 * gid[..., None])
    kankar = K.ramp(gid, [(0.0, "#8c8476"), (1.0, "#b0a896")])
    stub = K.ramp(gid, [(0.0, "#6e6448"), (1.0, "#8e8160")])
    col = np.where((idx == 0)[..., None], crumbs, np.where((idx == 1)[..., None], kankar, stub))
    alb = np.where(over[..., None], col, soil)
    alb = K.compress_chroma(alb, 0.85)

with core.timer("roughness"):
    rough = 0.91 + 0.03 * kit.fbm(0.05, 2) + 0.04 * crack - 0.06 * (over & (idx == 1))

finish_terrain(kit, h, alb, rough, ao_distance=0.06, height_hp=0.5, ao_height_mix=0.4,
               description="Black cotton soil (4 m, dry season): deep polygonal shrinkage cracks, secondary cracks, "
                           "self-mulching granular crust, kankar nodules, stubble; macro-neutral.")
