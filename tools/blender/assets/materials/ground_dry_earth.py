"""
@asset ground_dry_earth
@kind material
@style terrain:TERRAIN_LAYERS.dry_earth_cracked, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@inputs tools/blender/assets/terrain/_terrainkit.py

Cracked dry earth splat layer (class T, 4 m x 4 m, seamless, macro-neutral; WP1-29 rebuilt with the WP1 kit):
ochre-brown plains soil in grishma - drying-mud polygons (0.15-0.4 m) with curled plate edges in the low zones,
crusted packed earth with fine hairline cracks elsewhere, loose dust and crumbs, scattered half-buried pebbles of
mixed stone (sandstone, quartzite, basalt), sparse straw and dry leaf bits. Western frontier, grishma fields and
settlement yards; also the lookdev ground.
Target (TERRAIN_LAYERS.dry_earth_cracked): average #a88a68, roughness 0.92.
OWNER: Technical Artist A (TA-01) (first version by the Technical Art Director).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "terrain"))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
from _terrainkit import K, finish_terrain, layers  # noqa: E402

S = 4.0
kit = K.Kit(__file__, cls="T", size=(S, S), target="terrain:TERRAIN_LAYERS.dry_earth_cracked", family="soilDry",
            rough_spread=0.05)

with core.timer("soil"):
    # dried puddle / field-low zones: many small zones (0.4 m features, ~55 % cover) so the 4 m repeat shows no
    # recognisable clusters; the splat macro map supplies large-scale variation
    low = tg.smoothstep(0.36, 0.56, kit.fbm(0.45, 4) * 0.5 + 0.5)
    h = 0.003 * kit.fbm(0.3, 3) + 0.0012 * kit.fbm(0.05, 3) + 0.0004 * kit.fbm(0.01, 2)
    # drying-mud polygons in the low zones, plates curl up at the edges
    st = kit.stones(0.24, warp_m=0.03, jitter=0.95)
    cw = 0.003 + 0.007 * (kit.fbm(0.3, 2) * 0.5 + 0.5)
    crack = tg.smoothstep(cw, cw * 0.3, st["d"]) * low
    curl = 0.003 * tg.smoothstep(0.05, 0.0, st["d"] - cw) * low
    h += curl - 0.012 * crack + 0.0015 * low * (st["id"] - 0.5)
    # hairline crust cracks on the packed earth
    hx, hy = kit.warp(0.006, 0.05, 2)
    c1, c2, _ = kit.worley(0.09, 1.0, x=hx, y=hy)
    hair = tg.smoothstep(0.012, 0.0, c2 - c1) * (1.0 - low) * tg.smoothstep(0.45, 0.7, kit.fbm(0.35, 3) * 0.5 + 0.5)
    h -= 0.002 * hair
    loose = tg.smoothstep(0.5, 0.75, kit.fbm(0.18, 3) * 0.5 + 0.5) * (1.0 - low)  # loose dust drifts

with core.timer("scatter"):
    specs = [
        dict(cell=0.02, shape=K.shape_pebble(0.005, 0.004, 0.0025, 0.6, 0.35), density=0.45, density_map=loose + 0.2),  # crumbs
        # AD note: pebbles smaller, fewer and soil-tinted (they read as droppings before)
        dict(cell=0.1, shape=K.shape_pebble(0.012, 0.009, 0.006, 0.6, 0.35), density=0.14, density_map=1.0 - 0.7 * low),
        dict(cell=0.25, shape=K.shape_pebble(0.022, 0.016, 0.009, 0.6, 0.3), density=0.06, density_map=1.0 - 0.7 * low),
        dict(cell=0.1, shape=K.shape_blade(0.08, 0.002, 0.0012, 0.35), density=0.18),
        dict(cell=0.3, shape=K.shape_leaf(0.06, 0.018, 0.0015), density=0.12),
    ]
    L = layers(kit, specs)
    idx, gid = L["idx"], L["id"]
    sink = np.where(idx >= 1, 0.4, 0.15)  # stones half buried
    top = L["h"] * (1.0 - np.where(idx == 1, 0.3, 0.0)) - sink * 0.004 + h
    over = (L["h"] > -1e5) & (top > h)
    h = np.where(over, top, h)

with core.timer("albedo"):
    t = np.clip(0.5 + 0.25 * kit.fbm(0.12, 3) + 0.1 * kit.fbm(0.02, 2), 0, 1)
    soil = K.ramp(t, [(0.0, "#8a6c4e"), (0.4, "#9c7e5e"), (0.75, "#ad8f6d"), (1.0, "#bba07e")])
    soil = K.tint(soil, "#c2a882", 0.22 * loose)  # pale dust
    soil = K.tint(soil, "#8a6a4f", 0.35 * low)  # darker clay of the dried pools
    soil = K.mul(soil, 1.0 - 0.55 * crack - 0.25 * hair)
    soil = K.mul(soil, 1.0 + 0.08 * tg.smoothstep(0.0, 0.003, curl))  # plate rims catch light dust
    crumbs = K.mul(soil, 0.88 + 0.2 * gid[..., None])
    stone = K.ramp(gid, [(0.0, "#7c6a58"), (0.4, "#8e7a62"), (0.7, "#9c8466"), (1.0, "#a8916f")])
    stone = K.tint(stone, "#a48a68", 0.5)  # soil-dusted, close to the ground value
    straw = K.ramp(gid, [(0.0, "#b39a66"), (1.0, "#d0ba88")])
    leaf = K.ramp(gid, [(0.0, "#6e5236"), (1.0, "#8c6c46")])
    col = np.where((idx == 0)[..., None], crumbs,
                   np.where((idx <= 2)[..., None], stone, np.where((idx == 3)[..., None], straw, leaf)))
    alb = np.where(over[..., None], col, soil)
    alb = K.compress_chroma(alb, 0.85)

with core.timer("roughness"):
    rough = 0.93 + 0.03 * kit.fbm(0.05, 2) - 0.04 * low + 0.03 * loose
    rough = np.where(over & (idx >= 1) & (idx <= 2), rough - 0.12, rough)

finish_terrain(kit, h, alb, rough, ao_distance=0.04, height_hp=0.6, ao_height_mix=0.35,
               description="Cracked dry earth (4 m): drying-mud polygons with curled plates, crusted hairline cracks, "
                           "dust drifts, half-buried pebbles, straw and leaf bits; macro-neutral.")
