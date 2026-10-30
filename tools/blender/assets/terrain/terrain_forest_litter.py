"""
@asset terrain_forest_litter
@kind material
@style terrain:TERRAIN_LAYERS.forest_litter, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@inputs tools/blender/assets/materials/_matkit.py

Forest floor splat layer (class T, 3 m x 3 m, seamless, macro-neutral): sal and teak leaf litter (AD-6) - ovate
sal leaves 15-26 cm and teak leaves 26-40 cm with acute tips, in four layers (dark decomposing leaves at the bottom,
cupped and curled tan-brown dry leaves on top: curl, arch and lamina thickness are in the height), raised midribs
and pinnate veins, twigs and twiglets, brown humus crumbs and leaf fragments in the gaps (no dark voids).
Target (TERRAIN_LAYERS.forest_litter): average #5a4a35, roughness 0.90.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
from _terrainkit import K, finish_terrain, layers, shape_leaf_ovate  # noqa: E402

S = 3.0
kit = K.Kit(__file__, cls="T", size=(S, S), target="terrain:TERRAIN_LAYERS.forest_litter", family="foliage",
            saturation_limit="medium", rough_spread=0.06)

with core.timer("litter"):
    humus = 0.003 * kit.fbm(0.15, 3) + 0.0008 * kit.fbm(0.01, 2)
    hf1, _, hid = kit.worley(0.008, 1.0)
    crumbs = tg.smoothstep(0.5, 0.15, hf1) * (hid > 0.45)  # humus crumbs and leaf fragments
    humus += 0.0015 * crumbs
    # AD-6: ovate sal (20-26 cm) and teak (28-40 cm) leaves with acute tips, cupped / curled edges and thickness in
    # the height, twigs and humus crumbs between them - no flat discs, no voids
    specs = [
        dict(cell=0.15, shape=shape_leaf_ovate(0.2, 0.1, 0.0015, 0.004, 0.002), z=0.000, density=0.95),  # decomposed sal
        dict(cell=0.3, shape=shape_leaf_ovate(0.34, 0.2, 0.002, 0.016, 0.006), z=0.004, density=0.45),  # teak
        dict(cell=0.15, shape=shape_leaf_ovate(0.22, 0.11, 0.002, 0.012, 0.004), z=0.007, density=0.8),  # sal
        dict(cell=0.3, shape=K.shape_blade(0.24, 0.005, 0.007, 0.3), z=0.009, density=0.55),  # twigs
        dict(cell=0.08, shape=K.shape_blade(0.07, 0.0025, 0.004, 0.5), z=0.006, density=0.35),  # twiglets
        dict(cell=0.14, shape=shape_leaf_ovate(0.21, 0.105, 0.002, 0.018, 0.005), z=0.012, density=0.55),  # fresh sal
    ]
    L = layers(kit, specs)
    cov = L["h"] > -1e5
    h = np.where(cov, np.maximum(L["h"], humus), humus)
    idx, gid, lu, lv = L["idx"], L["id"], L["lu"], L["lv"]

with core.timer("albedo"):
    hum = K.ramp(np.clip(0.5 + 0.3 * kit.fbm(0.05, 2) + 0.2 * (hid - 0.5) * crumbs, 0, 1), [(0.0, "#2c2117"), (0.5, "#3c2e20"), (1.0, "#54412c")])
    # leaf colour by layer: bottom dark decomposing, top dry tan / rust, some still yellow-green
    t = np.clip(gid + 0.15 * kit.fbm(0.03, 2), 0, 1)
    dark = K.ramp(t, [(0.0, "#2b2116"), (1.0, "#4a3a28")])
    dry = K.ramp(t, [(0.0, "#5e4027"), (0.35, "#7a5634"), (0.7, "#93703f"), (0.9, "#a8875a"), (1.0, "#8a8048")])
    teak = K.ramp(t, [(0.0, "#5a4430"), (1.0, "#7d6448")])
    twig = K.ramp(t, [(0.0, "#3a2e22"), (1.0, "#5a4834")])
    moss = K.ramp(t, [(0.0, "#3a4426"), (1.0, "#556035")])
    col = np.where((idx == 0)[..., None], dark,
                   np.where((idx == 1)[..., None], teak,
                            np.where(((idx == 3) | (idx == 4))[..., None], twig, dry)))
    del moss
    # midrib and veins slightly lighter, holes (decay) in the bottom layer show humus
    rib = np.exp(-(lv / 0.004) ** 2)
    col = K.tint(col, "#a08560", 0.25 * rib * ((idx == 2) | (idx == 5)))
    holes = tg.smoothstep(0.55, 0.7, kit.fbm(0.02, 2) * 0.5 + 0.5) * (idx == 0)
    col = col * (1.0 - holes[..., None]) + hum * holes[..., None]
    alb = np.where(cov[..., None], col, hum)
    alb = K.compress_chroma(alb, 0.85)

with core.timer("roughness"):
    rough = np.where(cov, 0.86 + 0.06 * (gid - 0.5), 0.95) - 0.06 * ((idx == 5) & (gid < 0.15)) + 0.03 * kit.fbm(0.05, 2)

finish_terrain(kit, h, alb, rough, ao_distance=0.04, ao_height_mix=0.3,
               description="Forest floor (3 m): ovate sal and teak leaves (acute tips, cupped and curled) in four "
                           "layers, twigs, humus crumbs; macro-neutral.")
