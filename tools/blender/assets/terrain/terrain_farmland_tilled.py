"""
@asset terrain_farmland_tilled
@kind material
@style terrain:TERRAIN_LAYERS.farmland_tilled, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@inputs tools/blender/assets/materials/_matkit.py

Ploughed field splat layer (class T, 4 m x 4 m, seamless, macro-neutral). Furrows run along u (13 per tile =
0.31 m apart; rotate UVs per plot to follow the field axis), drawn by an ox plough: ridges wander +-2 cm, broken
into clods (2-7 cm) on the ridge flanks, crumbly tilth, darker moist furrow bottoms and sun-dried paler ridge
tops, rows of cut straw stubble, scattered straw and a few pebbles.
Target (TERRAIN_LAYERS.farmland_tilled): average #7e6a50, roughness 0.95.
Period notes: the wooden ard / scratch plough (no mouldboard) leaves shallow, slightly irregular furrows.
OWNER: Technical Artist A (TA-01).
"""
import math
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
from _terrainkit import K, finish_terrain, layers  # noqa: E402

S = 4.0
NF = 13
kit = K.Kit(__file__, cls="T", size=(S, S), target="terrain:TERRAIN_LAYERS.farmland_tilled", family="soilDry",
            rough_spread=0.03)
x, y = kit.x, kit.y

with core.timer("furrows"):
    wob = 0.04 * kit.fbm(0.8, 3, aniso=(3.0, 1.0)) + 0.012 * kit.fbm(0.12, 2)
    ph = (y * S + wob) / (S / NF)
    p = ph % 1.0
    fid = np.floor(ph) % NF
    # ridge profile: rounded ridge, V-ish furrow bottom; amplitude varies along the furrow
    prof = 0.5 - 0.5 * np.cos(2 * np.pi * p)
    amp = 0.024 * np.clip(0.75 + 0.45 * kit.fbm(0.25, 3, aniso=(3.0, 1.0)), 0.3, 1.2)
    h = amp * prof ** 0.8
    ridge = prof
    # clods on the ridge flanks + tilth crumbs everywhere
    cl = kit.scatter(0.075, K.shape_pebble(0.034, 0.024, 0.016, 0.6, 0.45), density=0.7, density_map=tg.smoothstep(0.15, 0.7, ridge))
    cl2 = kit.scatter(0.045, K.shape_pebble(0.02, 0.015, 0.01, 0.6, 0.4), density=0.6)
    h = np.maximum(h, h * 0.7 + cl2.height(-1.0) * (cl2.mask > 0))
    h = np.maximum(h, h * 0.6 + cl.height(-1.0) * (cl.mask > 0))
    crumbs = kit.scatter(0.016, K.shape_pebble(0.006, 0.005, 0.004, 0.6, 0.3), density=0.8)
    h = np.maximum(h, h + crumbs.height(0.0) * 0.6)
    h += 0.0015 * kit.fbm(0.03, 3) + 0.0004 * kit.fbm(0.005, 2)

with core.timer("stubble + straw"):
    # stubble rows: cut stalks in rows offset half a furrow (previous crop), seen from above as short strokes
    row = tg.smoothstep(0.18, 0.0, np.abs(((ph + 0.5) % 1.0) - 0.5))
    specs = [
        dict(cell=0.06, shape=K.shape_blade(0.08, 0.0016, 0.003, 0.4), z=0.0, density=0.35),
        dict(cell=0.035, shape=K.shape_disc(0.004, 0.012, 0.4), z=0.0, density=0.7, density_map=row),
        dict(cell=0.08, shape=K.shape_pebble(0.012, 0.009, 0.006), z=0.0, density=0.12),
    ]
    L = layers(kit, specs)
    top = L["h"] + h
    over = (L["h"] > -1e5) & (top > h)
    h = np.where(over, top, h)

with core.timer("albedo"):
    t = np.clip(0.5 + 0.25 * kit.fbm(0.12, 3) + 0.1 * kit.fbm(0.02, 2) + 0.35 * (ridge - 0.5), 0, 1)
    soil = K.ramp(t, [(0.0, "#4f4030"), (0.35, "#64513b"), (0.7, "#7d6a50"), (1.0, "#97836a")])
    soil = K.tint(soil, "#a39078", 0.35 * tg.smoothstep(0.6, 1.0, ridge) * tg.smoothstep(-0.2, 0.4, kit.fbm(0.1, 2)))
    soil = K.mul(soil, 1.0 - 0.15 * tg.smoothstep(0.4, 0.0, ridge))  # moist furrow bottoms
    soil = K.mul(soil, 1.0 + 0.12 * (cl.mask * (cl.id - 0.5)))
    idx, gid = L["idx"], L["id"]
    straw = K.ramp(gid, [(0.0, "#8a7a52"), (1.0, "#b3a170")])
    stub = K.ramp(gid, [(0.0, "#7f7150"), (1.0, "#a09062")])
    peb = K.ramp(gid, [(0.0, "#6b6258"), (1.0, "#8d8272")])
    col = np.where((idx == 0)[..., None], straw, np.where((idx == 1)[..., None], stub, peb))
    alb = np.where(over[..., None], col, soil)
    alb = K.compress_chroma(alb, 0.85)

with core.timer("roughness"):
    rough = 0.96 + 0.02 * kit.fbm(0.05, 2) - 0.04 * tg.smoothstep(0.4, 0.0, ridge) - 0.05 * (over & (idx == 2))

finish_terrain(kit, h, alb, rough, ao_distance=0.06, height_hp=0.5,
               description="Ploughed field (4 m): 13 ox-plough furrows along u (0.31 m), clods, tilth, stubble rows, "
                           "straw; rotate UVs per plot; macro-neutral.",
               extra_meta=dict(furrowAxis="u", furrowSpacingMeters=round(S / NF, 4)))
