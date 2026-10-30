"""
@asset terrain_mud_wet
@kind material
@style terrain:TERRAIN_LAYERS.mud_wet, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@inputs tools/blender/assets/materials/_matkit.py

Monsoon wet-mud overlay splat layer (class T, 3 m x 3 m, seamless, macro-neutral): churned, glossy dark mud -
overlapping hoof and bare-foot prints, short curving wheel / drag churn (0.4-1.5 m, random directions, never
world-aligned lines) with squeezed-up ridges, a few straw bits and
pebbles pressed in, standing water in every hollow below the water line. PUDDLE MASK (1 = standing water): a
cache-only file `<id>_puddleMask.png` today, destined for the baseColor ALPHA once publish.mjs keeps alpha (TA-01
request to the CTO: its resize premultiplies, so an RGBA source darkens the high / mobile tiers); it is also
implied by the height - water fills exactly the texels below the level, so ORM.r (height proxy) is lowest there. Puddles: flat (normal +Z), roughness ~0.04, albedo the darkened mud floor.
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
    # AD-3: no world-aligned ruts (marsh uses this layer as base layer 0). Churn = short (0.4-1.5 m), curving,
    # intermittent wheel / hoof-drag grooves in random directions with squeezed-up ridges; the long straight ruts
    # belong to terrain_road_earth and the decals_settlement rut end-cap.
    def churn(lu, lv, e1, e2):
        L = 0.4 + 1.1 * e1
        w = 0.035 + 0.04 * e2
        bend = (e2 - 0.5) * 1.2 / L
        c = lv - bend * lu * lu
        tt = np.abs(lu) / (0.5 * L)
        inside = (tt < 1.0) & (np.abs(c) < w)
        prof = np.clip(1.0 - (c / w) ** 2, 0, 1) ** 0.6 * np.clip((1.0 - tt) / 0.3, 0, 1)
        return np.where(inside, 0.009 * (0.5 + 0.5 * e1) * prof, -1e9)

    groove = np.zeros_like(h)
    for cell, dens in ((0.9, 0.55), (0.6, 0.45)):
        g = kit.scatter(cell, churn, density=dens).height(0.0)
        groove = np.maximum(groove, g)
    h += 0.7 * np.clip(tg.blur(groove, kit.px(0.03)) - groove, 0.0, None) - groove
    hooves = kit.scatter(0.15, shape_hoof(0.016, 0.075), density=0.32, scale=(0.75, 1.25),
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

# puddle mask: cache-only until publish.mjs ships baseColor alpha (an RGBA source is premultiplied by the resize)
mask_png = tg.write_png(kit.ctx.path(f"{kit.ctx.id}_puddleMask.png"), kit._down(puddle, kit.albedo_res), 8)
kit.ctx.add_file("puddleMask", mask_png, colorSpace="linear", ship=False)
finish_terrain(kit, h_w, alb, rough, ao_distance=0.04, height_hp=0.0, ao_height_mix=0.45, macro_amount=0.85,
               description="Monsoon wet mud overlay (3 m): churned hoof and foot prints, short curving churn, squeezed rims, "
                           "straw; standing water below the level (puddle mask: cache file, lowest ORM.r).",
               extra_meta=dict(puddleMask=dict(file=f"{kit.ctx.id}_puddleMask.png", shipped=False, heightPercentile=17,
                                               note="lowest ORM.r; moves to baseColor.a when publish keeps alpha")))
