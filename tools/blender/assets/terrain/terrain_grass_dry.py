"""
@asset terrain_grass_dry
@kind material
@style terrain:TERRAIN_LAYERS.grass_dry, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@inputs tools/blender/assets/materials/_matkit.py

Dry grass splat layer (class T, 3 m x 3 m, seamless, macro-neutral): straw-khaki bunch-grass tufts (radiating
blades, 6-14 cm), loose fallen blades and seed stalks between them, ~30 % bare dusty earth with crumbs, small
pebbles and drying cracks - grishma fields, scrub, the plateau.
Target (TERRAIN_LAYERS.grass_dry): average #9a8a5a, roughness 0.95.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
from _terrainkit import K, finish_terrain, layers  # noqa: E402

S = 3.0
kit = K.Kit(__file__, cls="T", size=(S, S), target="terrain:TERRAIN_LAYERS.grass_dry", family="soilDry",
            rough_spread=0.04)


def tuft(lu, lv, e1, e2):
    """Bunch-grass tuft seen from above: ~24 blades radiating from a crown, splayed and drooping outwards."""
    R = 0.07 * (0.7 + 0.6 * e1)
    r = np.sqrt(lu * lu + lv * lv) / R
    th = np.arctan2(lv, lu)
    n = 22.0 + 6.0 * e2
    wob = 0.25 * np.sin(th * 3.0 + e1 * 9.0)
    blades = np.clip(np.cos(th * n + 4.0 * r * (e2 - 0.5) + wob * 6.0), 0.0, 1.0) ** 3
    crown = np.clip(1.0 - r * 2.5, 0.0, 1.0)
    hh = 0.012 * (1.0 - r) ** 0.7 * (0.35 + 0.65 * np.maximum(blades, crown))
    reach = 1.0 + 0.25 * np.sin(th * 5.0 + e2 * 6.28)  # ragged outline
    return np.where(r < reach * 0.95, hh, -1e9)


with core.timer("soil"):
    soil = 0.0025 * kit.fbm(0.1, 3) + 0.0008 * kit.fbm(0.012, 2)
    cf1, _, cid = kit.worley(0.014, 1.0)
    soil += 0.0012 * tg.smoothstep(0.5, 0.0, cf1) * (cid > 0.55)
    c1, c2, _ = kit.worley(0.12, 1.0, x=kit.warp(0.01, 0.06, 2)[0])
    crack = tg.smoothstep(0.03, 0.0, c2 - c1) * tg.smoothstep(0.55, 0.75, kit.fbm(0.2, 3) * 0.5 + 0.5)
    soil -= 0.002 * crack
    bare = tg.smoothstep(0.35, 0.6, kit.fbm(0.2, 3) * 0.5 + 0.5 + 0.2 * kit.fbm(0.05, 2))
    cover = 1.0 - 0.85 * bare

with core.timer("layers"):
    specs = [
        dict(cell=0.03, shape=K.shape_blade(0.06, 0.0016, 0.0025, 0.4), z=0.0, density=0.7, density_map=cover),  # litter
        dict(cell=0.02, shape=K.shape_pebble(0.005, 0.004, 0.003), z=0.0, density=0.25, density_map=bare),
        dict(cell=0.11, shape=tuft, z=0.0, density=0.85, density_map=cover),
        dict(cell=0.12, shape=tuft, z=0.002, density=0.6, density_map=cover),
        dict(cell=0.06, shape=K.shape_blade(0.09, 0.0012, 0.0035, 0.2), z=0.006, density=0.3, density_map=cover),  # seed stalks
    ]
    L = layers(kit, specs)
    veg = L["h"] > -1e5
    h = np.where(veg, np.maximum(L["h"], soil), soil)

with core.timer("albedo"):
    soil_col = K.ramp(np.clip(0.5 + 0.3 * kit.fbm(0.06, 3), 0, 1), [(0.0, "#6e5a40"), (0.5, "#85704f"), (1.0, "#9a8562")])
    soil_col = K.mul(soil_col, 1.0 - 0.35 * crack)
    idx, gid = L["idx"], L["id"]
    t = np.clip(0.5 + 0.45 * (gid - 0.5) + 0.12 * kit.fbm(0.05, 3) + 0.2 * np.clip(L["h"] / 0.012, 0, 1), 0, 1)
    straw = K.ramp(t, [(0.0, "#6e6040"), (0.4, "#8f8052"), (0.75, "#a99a66"), (1.0, "#c2b47e")])
    # a few tufts still faintly green at the crown (khaki-olive), stalks paler
    straw = np.where(((idx == 2) | (idx == 3))[..., None] & (gid < 0.2)[..., None], K.tint(straw, "#7d7f4f", 0.4), straw)
    peb = K.ramp(gid, [(0.0, "#6f675e"), (0.5, "#8a7f70"), (1.0, "#a39885")])
    col = np.where((idx == 1)[..., None], peb, straw)
    alb = np.where(veg[..., None], col, soil_col)
    alb = K.compress_chroma(alb, 0.85)

with core.timer("roughness"):
    rough = np.where(veg, 0.93 + 0.04 * (gid - 0.5), 0.97) - 0.08 * (idx == 1) + 0.02 * kit.fbm(0.05, 2)

finish_terrain(kit, h, alb, rough, ao_distance=0.04,
               description="Dry grass splat layer (3 m): straw-khaki bunch-grass tufts, fallen blades, seed stalks, "
                           "30 % bare dusty earth with crumbs, pebbles and cracks; macro-neutral.")
