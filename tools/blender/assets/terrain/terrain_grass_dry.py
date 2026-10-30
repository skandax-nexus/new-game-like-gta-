"""
@asset terrain_grass_dry
@kind material
@style terrain:TERRAIN_LAYERS.grass_dry, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@inputs tools/blender/assets/materials/_matkit.py

Dry grass splat layer (class T, 3 m x 3 m, seamless, macro-neutral): straw-khaki bunch grass in IRREGULAR CLUMPS
(8-25 cm crowds of blades splaying unevenly out of each clump, ragged outlines; AD-6: no radial stamps), long
lodged stems lying across them in the wind direction, loose fallen blades and seed stalks, ~30 % bare dusty earth with crumbs, small
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


with core.timer("soil"):
    soil = 0.0025 * kit.fbm(0.1, 3) + 0.0008 * kit.fbm(0.012, 2)
    cf1, _, cid = kit.worley(0.014, 1.0)
    soil += 0.0012 * tg.smoothstep(0.5, 0.0, cf1) * (cid > 0.55)
    c1, c2, _ = kit.worley(0.12, 1.0, x=kit.warp(0.01, 0.06, 2)[0])
    crack = tg.smoothstep(0.03, 0.0, c2 - c1) * tg.smoothstep(0.55, 0.75, kit.fbm(0.2, 3) * 0.5 + 0.5)
    soil -= 0.002 * crack
    bare = tg.smoothstep(0.5, 0.72, kit.fbm(0.15, 3) * 0.5 + 0.5 + 0.2 * kit.fbm(0.05, 2))  # ~20 % bare earth
    cover = 1.0 - 0.8 * bare

with core.timer("clumps"):
    # AD-6: irregular clumped tufts and lodged stems, never radial stamps. Clumps = blade crowds of 8-25 cm in
    # Worley cells (random radius, ragged edge); each blade leans OUT of its clump along the local gradient of the
    # clump distance (+-0.5 rad), so tufts splay unevenly; long lodged stems lie across them in the wind direction.
    cf, _, clid = kit.worley(0.16, 0.95)
    crad = 0.25 + 0.35 * ((clid * 5.7) % 1.0)  # radius in cell units
    rag = 0.12 * kit.fbm(0.03, 3)
    clump = tg.smoothstep(crad, crad * 0.45, cf + rag) * (clid > 0.12) * cover
    cfb = tg.blur(cf, kit.px(0.01))
    gu = np.gradient(cfb, axis=1)
    gv = -np.gradient(cfb, axis=0)
    out_ang = np.arctan2(gv, gu).astype(np.float32)
    wind = 0.6  # prevailing lodging direction (rad)

with core.timer("layers"):
    specs = [
        dict(cell=0.03, shape=K.shape_blade(0.06, 0.0016, 0.0025, 0.4), z=0.0, density=0.7, density_map=cover),  # litter
        dict(cell=0.02, shape=K.shape_pebble(0.005, 0.004, 0.003), z=0.0, density=0.25, density_map=bare),
        dict(cell=0.022, shape=K.shape_blade(0.07, 0.0018, 0.005, 0.45), z=0.002, density=0.95, density_map=clump,
             angle=(-0.5, 0.5), angle_map=out_ang),
        dict(cell=0.018, shape=K.shape_blade(0.09, 0.0016, 0.006, 0.5), z=0.004, density=0.9, density_map=clump,
             angle=(-0.6, 0.6), angle_map=out_ang),
        dict(cell=(0.24, 0.05), shape=K.shape_blade(0.17, 0.0016, 0.004, 0.15), z=0.006, density=0.45,
             density_map=np.clip(cover * 0.6 + clump, 0, 1), angle=(wind - 0.45, wind + 0.45)),  # lodged stems
        dict(cell=0.06, shape=K.shape_blade(0.09, 0.0012, 0.0035, 0.2), z=0.008, density=0.3, density_map=clump),  # seed stalks
    ]
    L = layers(kit, specs)
    veg = L["h"] > -1e5
    h = np.where(veg, np.maximum(L["h"], soil), soil)

with core.timer("albedo"):
    soil_col = K.ramp(np.clip(0.5 + 0.3 * kit.fbm(0.06, 3), 0, 1), [(0.0, "#7a6648"), (0.5, "#8e7a56"), (1.0, "#a18d66")])
    soil_col = K.mul(soil_col, 1.0 - 0.35 * crack)
    idx, gid = L["idx"], L["id"]
    t = np.clip(0.5 + 0.45 * (gid - 0.5) + 0.12 * kit.fbm(0.05, 3) + 0.2 * np.clip(L["h"] / 0.012, 0, 1) - 0.04 * clump * (1.0 - np.clip(L["h"] / 0.01, 0, 1)), 0, 1)
    straw = K.ramp(t, [(0.0, "#6e6040"), (0.4, "#8f8052"), (0.75, "#a99a66"), (1.0, "#c2b47e")])
    # a few tufts still faintly green at the crown (khaki-olive), stalks paler
    straw = np.where(((idx >= 2) & (idx <= 4))[..., None] & (gid < 0.2)[..., None], K.tint(straw, "#7d7f4f", 0.4), straw)
    peb = K.ramp(gid, [(0.0, "#6f675e"), (0.5, "#8a7f70"), (1.0, "#a39885")])
    col = np.where((idx == 1)[..., None], peb, straw)
    alb = np.where(veg[..., None], col, soil_col)
    alb = K.compress_chroma(alb, 0.85)

with core.timer("roughness"):
    rough = np.where(veg, 0.93 + 0.04 * (gid - 0.5), 0.97) - 0.08 * (idx == 1) + 0.02 * kit.fbm(0.05, 2)

finish_terrain(kit, h, alb, rough, ao_distance=0.04,
               description="Dry grass splat layer (3 m): irregular clumped straw-khaki tufts, lodged stems, seed stalks, "
                           "30 % bare dusty earth with crumbs, pebbles and cracks; macro-neutral.")
