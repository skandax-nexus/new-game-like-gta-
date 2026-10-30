"""
@asset terrain_forest_litter
@kind material
@style terrain:TERRAIN_LAYERS.forest_litter, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@inputs tools/blender/assets/materials/_matkit.py

Forest floor splat layer (class T, 3 m x 3 m, seamless, macro-neutral): sal and teak leaf litter - broad ovate sal
leaves 12-22 cm and huge teak leaves 25-35 cm in four layers (dark decomposing skeletons at the bottom, curled
tan-brown dry leaves on top), midribs and lateral veins, twigs and small branches, dark humus in the gaps, a few
seed husks and moss cushions.
Target (TERRAIN_LAYERS.forest_litter): average #5a4a35, roughness 0.90.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
from _terrainkit import K, finish_terrain, layers  # noqa: E402

S = 3.0
kit = K.Kit(__file__, cls="T", size=(S, S), target="terrain:TERRAIN_LAYERS.forest_litter", family="foliage",
            saturation_limit="medium", rough_spread=0.06)

with core.timer("litter"):
    humus = 0.003 * kit.fbm(0.15, 3) + 0.0008 * kit.fbm(0.01, 2)
    specs = [
        dict(cell=0.16, shape=K.shape_leaf(0.17, 0.09, 0.004, 1.2), z=0.000, density=0.95),  # decomposing sal
        dict(cell=0.3, shape=K.shape_leaf(0.3, 0.18, 0.004, 1.1), z=0.002, density=0.5),  # teak
        dict(cell=0.15, shape=K.shape_leaf(0.16, 0.085, 0.006, 1.2), z=0.004, density=0.85),  # sal
        dict(cell=0.33, shape=K.shape_blade(0.22, 0.004, 0.006, 0.25), z=0.006, density=0.6),  # twigs
        dict(cell=0.14, shape=K.shape_leaf(0.15, 0.08, 0.008, 1.2), z=0.008, density=0.6),  # fresh sal on top
        dict(cell=0.05, shape=K.shape_disc(0.008, 0.004, 0.5), z=0.0, density=0.25),  # moss cushions / husks
    ]
    L = layers(kit, specs)
    cov = L["h"] > -1e5
    h = np.where(cov, np.maximum(L["h"], humus), humus)
    idx, gid, lu, lv = L["idx"], L["id"], L["lu"], L["lv"]

with core.timer("albedo"):
    hum = K.ramp(np.clip(0.5 + 0.3 * kit.fbm(0.05, 2), 0, 1), [(0.0, "#1e1810"), (1.0, "#33281b")])
    # leaf colour by layer: bottom dark decomposing, top dry tan / rust, some still yellow-green
    t = np.clip(gid + 0.15 * kit.fbm(0.03, 2), 0, 1)
    dark = K.ramp(t, [(0.0, "#2b2116"), (1.0, "#4a3a28")])
    dry = K.ramp(t, [(0.0, "#5e4027"), (0.35, "#7a5634"), (0.7, "#93703f"), (0.9, "#a8875a"), (1.0, "#8a8048")])
    teak = K.ramp(t, [(0.0, "#5a4430"), (1.0, "#7d6448")])
    twig = K.ramp(t, [(0.0, "#3a2e22"), (1.0, "#5a4834")])
    moss = K.ramp(t, [(0.0, "#3a4426"), (1.0, "#556035")])
    col = np.where((idx == 0)[..., None], dark,
                   np.where((idx == 1)[..., None], teak,
                            np.where((idx == 3)[..., None], twig,
                                     np.where((idx == 5)[..., None], moss, dry))))
    # midrib and veins slightly lighter, holes (decay) in the bottom layer show humus
    rib = np.exp(-(lv / 0.004) ** 2)
    col = K.tint(col, "#a08560", 0.25 * rib * ((idx == 2) | (idx == 4)))
    holes = tg.smoothstep(0.55, 0.7, kit.fbm(0.02, 2) * 0.5 + 0.5) * (idx == 0)
    col = col * (1.0 - holes[..., None]) + hum * holes[..., None]
    alb = np.where(cov[..., None], col, hum)
    alb = K.compress_chroma(alb, 0.85)

with core.timer("roughness"):
    rough = np.where(cov, 0.86 + 0.06 * (gid - 0.5), 0.95) - 0.06 * ((idx == 4) & (gid < 0.15)) + 0.03 * kit.fbm(0.05, 2)

finish_terrain(kit, h, alb, rough, ao_distance=0.04, ao_height_mix=0.3,
               description="Forest floor (3 m): sal and teak leaf litter in four layers, twigs, dark humus, moss "
                           "cushions; macro-neutral.")
