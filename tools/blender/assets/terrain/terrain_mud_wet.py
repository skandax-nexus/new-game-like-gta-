"""
@asset terrain_mud_wet
@kind material
@style terrain:TERRAIN_LAYERS.mud_wet, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@inputs tools/blender/assets/materials/_matkit.py

Monsoon wet-mud overlay splat layer (class T, 3 m x 3 m, seamless, macro-neutral): churned, glossy dark mud -
overlapping hoof and bare-foot prints, cart-churned wheel slots and squeezed-up ridges, a few straw bits and
pebbles pressed in, standing water in every hollow below the water line. The PUDDLE MASK is the baseColor ALPHA
(1 = standing water; cache PNG RGBA - see the TA-01 report: publish.mjs currently strips alpha, the request to
keep it is with the CTO) and is also implied by the height: water fills exactly the texels below the level, so
ORM.r (height proxy) is lowest there. Puddles: flat (normal +Z), roughness ~0.04, albedo the darkened mud floor.
Target (TERRAIN_LAYERS.mud_wet): average #4f4636, roughness 0.30.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
from _terrainkit import K, finish_terrain, layers, shape_foot, shape_hoof  # noqa: E402

S = 3.0
kit = K.Kit(__file__, cls="T", size=(S, S), target="terrain:TERRAIN_LAYERS.mud_wet", family="soilWet",
            rough_range=(0.05, 0.55))
x, y = kit.x, kit.y

with core.timer("churned mud"):
    h = 0.012 * kit.fbm(0.35, 3) + 0.004 * kit.fbm(0.08, 3) + 0.0008 * kit.fbm(0.012, 2)
    # wheel slots: a couple of meandering cart grooves along u with squeezed-up ridges
    wob = 0.16 * kit.fbm(0.7, 3, aniso=(2.0, 1.0))
    seg = np.clip(0.55 + 0.6 * kit.fbm(0.35, 3, aniso=(3.0, 1.0)), 0.1, 1.2)  # slot depth varies along u -> pools
    slot = np.zeros_like(h)
    for c in (0.9, 2.3):
        dv = y * S - c - wob
        slot = np.maximum(slot, np.clip(1.0 - (dv / 0.1) ** 2, 0, 1) ** 0.6)
        h += 0.006 * np.exp(-((np.abs(dv) - 0.12) / 0.03) ** 2)
    h -= 0.014 * slot * seg
    hooves = kit.scatter(0.13, shape_hoof(0.016, 0.075), density=0.5,
                         density_map=tg.smoothstep(0.3, 0.7, kit.fbm(0.4, 3) * 0.5 + 0.5))
    feet = kit.scatter(0.35, shape_foot(0.013), density=0.35)
    d = np.maximum(hooves.height(0.0), feet.height(0.0))
    h += 0.6 * np.clip(tg.blur(d, 3.0) - d, 0.0, None) - d  # squeezed-up rims
    specs = [
        dict(cell=0.07, shape=K.shape_blade(0.07, 0.0016, 0.002, 0.4), z=0.0, density=0.2),
        dict(cell=0.06, shape=K.shape_pebble(0.008, 0.006, 0.004), z=0.0, density=0.12),
    ]
    L = layers(kit, specs)
    top = L["h"] + h
    over = (L["h"] > -1e5) & (top > h)
    h = np.where(over, top, h)

with core.timer("puddles"):
    # water level at the 30th height percentile -> standing water in hollows, slots and prints
    hb = tg.blur(h, 1.0)
    level = float(np.percentile(hb, 17.0))
    depth = np.clip(level - hb, 0.0, None)
    puddle = tg.smoothstep(0.0, 0.0015, depth)
    h_w = np.where(puddle > 0.0, np.maximum(h, level), h)  # water surface is flat at the level

with core.timer("albedo"):
    t = np.clip(0.5 + 0.25 * kit.fbm(0.1, 3) + 0.12 * kit.fbm(0.015, 2), 0, 1)
    mud = K.ramp(t, [(0.0, "#2e271e"), (0.4, "#3f3528"), (0.75, "#514533"), (1.0, "#665843")])
    # drier, lighter crests; wet sheen does the rest
    crest = tg.smoothstep(0.0, 0.01, hb - level)
    mud = K.tint(mud, "#6d5f4a", 0.3 * tg.smoothstep(0.006, 0.02, hb - level))
    idx, gid = L["idx"], L["id"]
    straw = K.ramp(gid, [(0.0, "#6e623f"), (1.0, "#8f8052")])
    peb = K.ramp(gid, [(0.0, "#4a443c"), (1.0, "#6a6255")])
    col = np.where((idx == 0)[..., None], straw, peb)
    alb = np.where(over[..., None], K.mul(col, 0.8), mud)
    # standing water: dark, slightly silty-brown floor seen through it
    alb = alb * (1.0 - puddle[..., None]) + K.mul(K.tint(alb, "#3a3226", 0.5), 0.6) * puddle[..., None]
    alb = K.compress_chroma(alb, 0.85)

with core.timer("roughness"):
    rough = 0.42 + 0.06 * kit.fbm(0.05, 2) + 0.12 * crest - 0.05 * (1.0 - crest)
    rough = rough * (1.0 - puddle) + 0.02 * puddle

finish_terrain(kit, h_w, alb, rough, ao_distance=0.04, height_hp=0.0, ao_height_mix=0.45, macro_amount=0.85,
               alpha=puddle, alpha_usage="puddleMask",
               description="Monsoon wet mud overlay (3 m): churned hoof and foot prints, cart slots, squeezed rims, "
                           "straw; standing water below the level (puddle mask in baseColor alpha).",
               extra_meta=dict(puddleMask=dict(channel="baseColor.a", heightPercentile=17,
                                               note="also lowest ORM.r; publish keeps alpha once the CTO request lands")))
