"""
@asset terrain_grass_lush
@kind material
@style terrain:TERRAIN_LAYERS.grass_lush, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@inputs tools/blender/assets/materials/_matkit.py

Monsoon grass splat layer (class T, 3 m x 3 m, seamless, macro-neutral): five stacked layers of grass blades seen
from above (2-7 cm, lying in all directions with a weak prevailing lean), clover patches (trifoliate leaflets),
a few dry straw blades and seed heads, dark humus soil showing in ~15 % gaps. Olive-emerald, never lime: the
greens stay below the large-surface saturation budget; the GPU grass blades (GFX-03) sit on top of it.
Target (TERRAIN_LAYERS.grass_lush): average #5f6f3a, roughness 0.9.
OWNER: Technical Artist A (TA-01).
"""
import math
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
from _terrainkit import K, finish_terrain, layers  # noqa: E402

S = 3.0
# AD-4: olive-emerald, never lime - every texel at HSV saturation <= 0.5 and value <= 0.55 (enforced in calibration)
kit = K.Kit(__file__, cls="T", size=(S, S), target="terrain:TERRAIN_LAYERS.grass_lush", family="grass",
            rough_spread=0.05, sat_cap=0.5, value_cap=0.55)


def clover(lu, lv, e1, e2):
    """Three round leaflets around a centre (6-9 mm), slight central crease."""
    r = 0.0055 * (0.8 + 0.4 * e1)
    best = np.full(lu.shape, -1e9, np.float32)
    for k in range(3):
        a = 2 * math.pi * k / 3 + e2
        cx, cy = np.cos(a) * r * 1.05, np.sin(a) * r * 1.05
        d = np.sqrt((lu - cx) ** 2 + (lv - cy) ** 2) / r
        hh = np.where(d < 1.0, 0.003 * (0.6 + 0.4 * np.sqrt(np.clip(1 - d * d, 0, 1))), -1e9)
        best = np.maximum(best, hh)
    return best


with core.timer("soil"):
    soil = 0.002 * kit.fbm(0.08, 3) + 0.0008 * kit.fbm(0.01, 2)
    cf1, _, cid = kit.worley(0.015, 1.0)
    soil += 0.0012 * tg.smoothstep(0.5, 0.0, cf1) * (cid > 0.5)  # crumbs
    # gaps: where the sward is thin (meso-scale only: the splat supplies the macro variation)
    thin = tg.smoothstep(0.15, 0.55, kit.fbm(0.18, 3) * 0.5 + 0.5 + 0.25 * kit.fbm(0.05, 2))
    sward = 1.0 - 0.75 * thin
    clover_zone = tg.smoothstep(0.64, 0.78, kit.fbm(0.12, 3) * 0.5 + 0.5 + 0.12 * kit.fbm(0.03, 2))

with core.timer("grass layers"):
    lean = 0.6  # prevailing lean (rad) with spread
    specs = [
        dict(cell=0.03, shape=K.shape_blade(0.05, 0.0018, 0.004, 0.35), z=0.000, density=0.95, density_map=sward),
        dict(cell=0.026, shape=K.shape_blade(0.045, 0.0016, 0.004, 0.35), z=0.002, density=0.9, density_map=sward),
        dict(cell=0.022, shape=K.shape_blade(0.04, 0.0015, 0.004, 0.3), z=0.004, density=0.85, density_map=sward,
             angle=(lean - 1.4, lean + 1.4)),
        dict(cell=0.012, shape=clover, z=0.002, density=0.8, density_map=clover_zone),
        dict(cell=0.024, shape=K.shape_blade(0.06, 0.0017, 0.004, 0.25), z=0.006, density=0.6, density_map=sward,
             angle=(lean - 1.0, lean + 1.0)),
        dict(cell=0.05, shape=K.shape_blade(0.07, 0.0013, 0.003, 0.4), z=0.008, density=0.25),  # dry straw blades
    ]
    L = layers(kit, specs)
    veg = L["h"] > -1e5
    h = np.where(veg, np.maximum(L["h"], soil), soil)

with core.timer("albedo"):
    # soil gaps not much darker than the sward: a dark soil would force the blades brighter and more saturated
    # (lime) to hit the layer mean
    soil_col = K.ramp(np.clip(0.5 + 0.3 * kit.fbm(0.05, 3), 0, 1), [(0.0, "#3a3226"), (0.5, "#463b2c"), (1.0, "#544633")])
    idx = L["idx"]
    gid = L["id"]
    # blade colour: olive to emerald-olive, lighter tips, darker lower layers (self-shadowed sward)
    tip = np.clip(L["lu"] / 0.06, 0, 1)
    g = np.clip(0.5 + 0.45 * (gid - 0.5) + 0.25 * tip + 0.1 * kit.fbm(0.1, 3), 0, 1)
    grass = K.ramp(g, [(0.0, "#3e4a26"), (0.35, "#4f5f2e"), (0.65, "#5d6c37"), (1.0, "#6c7740")])
    depth = np.clip(idx.astype(np.float32) / 5.0, 0.0, 1.0)
    grass = K.mul(grass, 0.8 + 0.2 * depth)
    clov = K.ramp(np.clip(0.5 + 0.3 * (gid - 0.5), 0, 1), [(0.0, "#2f3a22"), (1.0, "#3b4628")])  # darker, olive, not teal
    straw = K.ramp(np.clip(gid, 0, 1), [(0.0, "#8f8455"), (1.0, "#b0a46c")])
    col = np.where((idx == 3)[..., None], clov, grass)
    col = np.where((idx == 5)[..., None], straw, col)
    alb = np.where(veg[..., None], col, soil_col)
    alb = K.compress_chroma(alb, 0.7)

with core.timer("roughness"):
    rough = np.where(veg, 0.86 + 0.06 * (gid - 0.5), 0.97) + 0.02 * kit.fbm(0.05, 2)
    rough = np.where(idx == 3, 0.8, rough)

finish_terrain(kit, h, alb, rough, ao_distance=0.03,
               description="Monsoon grass splat layer (3 m): olive-emerald blades in five layers, clover, dry straw, "
                           "dark soil gaps; macro-neutral.")
