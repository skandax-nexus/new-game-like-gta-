"""
@asset terrain_salt_crust
@kind material
@style terrain:TERRAIN_LAYERS.salt_crust, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@inputs tools/blender/assets/materials/_matkit.py
@tiers ultra,high
@fallback terrain_river_sand

Salt-flat crust splat layer (class T, 6 m x 6 m, seamless, macro-neutral; P2 - ultra / high, mobile falls back to
terrain_river_sand, the palest published layer): the White Flats - polygonal salt crust plates 0.6-1.6 m across
with buckled, raised pressure ridges (2-5 cm) along the polygon edges, blistered / popcorn crust texture on the
plates, grey mud showing in a few ridge cracks, a pink-grey tint (halophile bloom) along the ridges, faint drying
rings. Albedo kept <= 0.7 (TERRAIN_LAYERS.salt_crust note).
Target (TERRAIN_LAYERS.salt_crust): average #d9d2c4, roughness 0.70.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
from _terrainkit import K, finish_terrain  # noqa: E402

S = 6.0
kit = K.Kit(__file__, cls="T", size=(S, S), target="terrain:TERRAIN_LAYERS.salt_crust", family="limePlaster",
            rough_spread=0.08, channel_max_srgb=236)

with core.timer("polygons"):
    st = kit.stones(1.0, warp_m=0.12, jitter=0.95)
    d = st["d"]
    rw = 0.035 + 0.05 * (kit.fbm(0.6, 3) * 0.5 + 0.5)  # ridge half-width
    ridge = tg.smoothstep(rw, 0.0, d)
    buckle = 0.5 + 0.5 * kit.fbm(0.05, 3)
    h = 0.03 * ridge ** 0.7 * (0.6 + 0.6 * buckle)
    crackr = tg.smoothstep(0.006, 0.0, d) * tg.smoothstep(0.55, 0.75, kit.fbm(0.3, 3) * 0.5 + 0.5)
    h -= 0.02 * crackr
    # blistered popcorn crust on the plates
    b1, b2, _ = kit.worley(0.03, 1.0)
    blister = tg.smoothstep(0.5, 0.0, b1)
    h += 0.0025 * blister * (1.0 - ridge) + 0.0012 * kit.fbm(0.012, 2)
    # faint drying rings inside the plates
    rings = 0.5 + 0.5 * np.sin(2 * np.pi * st["f1"] / 0.09 + 2.0 * kit.fbm(0.3, 2))
    h += 0.0006 * rings * (1.0 - ridge)
    # plates gently dished
    h -= 0.004 * np.clip(d / 0.4, 0, 1)

with core.timer("albedo"):
    t = np.clip(0.5 + 0.25 * kit.fbm(0.15, 3) + 0.1 * kit.fbm(0.02, 2), 0, 1)
    salt = K.ramp(t, [(0.0, "#bdb4a5"), (0.45, "#d0c8b9"), (0.8, "#ddd6c8"), (1.0, "#e6e0d4")])
    salt = K.mul(salt, 0.96 + 0.06 * blister * (1.0 - ridge))
    salt = K.tint(salt, "#cdb4ac", 0.45 * ridge * (0.5 + 0.5 * buckle))  # pink-grey bloom along the ridges
    salt = K.tint(salt, "#8c8478", 0.5 * tg.smoothstep(0.0, 0.5, ridge) * tg.smoothstep(0.6, 0.85, kit.fbm(0.2, 3) * 0.5 + 0.5))
    salt = K.tint(salt, "#5e574d", 0.85 * crackr)  # grey mud in ridge cracks
    salt = K.mul(salt, 1.0 - 0.04 * rings * (1.0 - ridge))
    alb = K.compress_chroma(salt, 0.9)

with core.timer("roughness"):
    rough = 0.68 + 0.06 * blister - 0.08 * ridge + 0.1 * crackr + 0.03 * kit.fbm(0.05, 2)

finish_terrain(kit, h, alb, rough, macro_sigma=0.9, ao_distance=0.08, height_hp=0.6, ao_height_mix=0.3,
               description="Salt-flat crust (6 m): polygonal plates with buckled pressure ridges, popcorn crust, "
                           "pink-grey bloom along the ridges, mud in ridge cracks; macro-neutral, albedo <= 0.7.")
