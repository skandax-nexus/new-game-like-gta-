"""
@asset terrain_pebbles
@kind material
@style terrain:TERRAIN_LAYERS.pebbles_gravel, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@inputs tools/blender/assets/materials/_matkit.py

Pebbles and gravel splat layer (class T, 2 m x 2 m, seamless, macro-neutral): densely packed rounded river pebbles
2-10 cm of mixed lithology (grey granite, buff and red sandstone, dark basalt, white quartz), imbricated (tilted
the same way by the current), smaller gravel and coarse sand in the gaps, a share of angular scree fragments
(scree under cliffs), silt film on the lower halves. Fords, stream beds, bars, cliff feet.
Target (TERRAIN_LAYERS.pebbles_gravel): average #8c8273, roughness 0.75.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
from _terrainkit import K, finish_terrain, layers  # noqa: E402

S = 2.0
kit = K.Kit(__file__, cls="T", size=(S, S), target="terrain:TERRAIN_LAYERS.pebbles_gravel", family="sandstone",
            rough_spread=0.1)


def scree(lu, lv, e1, e2):
    """Angular fragment: a jittered polygon (few facets) seen from above."""
    r = 0.022 * (0.7 + 0.6 * e1)
    ang = np.arctan2(lv, lu)
    k = 5.0 + np.floor(e2 * 3.0)
    facet = np.cos(np.pi / k) / np.cos(((ang + e1 * 6.28) % (2 * np.pi / k)) - np.pi / k)
    rr = np.sqrt(lu * lu + lv * lv) / (r * facet)
    return np.where(rr < 1.0, 0.012 * (0.6 + 0.4 * e2) * (1.0 - rr ** 1.5) ** 0.5 + 0.004 * (lu / r), -1e9)


with core.timer("pebbles"):
    sand = 0.002 * kit.fbm(0.1, 3) + 0.0004 * kit.fbm(0.005, 2)
    tilt = 0.25  # imbrication: pebbles dip upstream (towards -u)
    specs = [
        dict(cell=0.014, shape=K.shape_pebble(0.005, 0.004, 0.003, 0.6, 0.2), z=0.0, density=0.95),
        dict(cell=0.03, shape=K.shape_pebble(0.012, 0.009, 0.008, 0.55, 0.2), z=0.0, density=0.9),
        dict(cell=0.045, shape=scree, z=0.0, density=0.25),
        dict(cell=0.06, shape=K.shape_pebble(0.026, 0.019, 0.016, 0.5, 0.18), z=0.002, density=0.85, angle=(-0.5, 0.5)),
        dict(cell=0.1, shape=K.shape_pebble(0.045, 0.032, 0.026, 0.5, 0.15), z=0.004, density=0.55, angle=(-0.4, 0.4)),
    ]
    L = layers(kit, specs)
    peb = L["h"] > -1e5
    h = np.where(peb, np.maximum(L["h"] + tilt * 0.02 * (L["lu"] / 0.05), sand), sand)
    idx, gid = L["idx"], L["id"]

with core.timer("albedo"):
    sand_col = K.ramp(np.clip(0.5 + 0.3 * kit.fbm(0.03, 2), 0, 1), [(0.0, "#6e6556"), (1.0, "#958a76")])
    lith = (gid * 7.31) % 1.0
    stops = [(0.0, "#4a4744"), (0.15, "#5f5b56"), (0.35, "#7e7a73"), (0.55, "#968a78"), (0.72, "#a88c74"),
             (0.86, "#8a6a58"), (0.95, "#c9c2b4"), (1.0, "#ddd6c8")]
    col = K.ramp(lith, stops)
    # per-pebble mottling, darker silt film on the lower part, lighter dry tops
    col = K.mul(col, 0.9 + 0.2 * (kit.fbm(0.01, 2) * 0.5 + 0.5))
    rel = np.clip((L["h"] - np.percentile(L["h"][peb], 20)) / 0.02, 0.0, 1.0)
    col = K.tint(col, "#5a5246", 0.35 * (1.0 - rel))
    col = K.tint(col, "#b8ae9c", 0.15 * rel)
    alb = np.where(peb[..., None], col, sand_col)
    alb = K.compress_chroma(alb, 0.85)

with core.timer("roughness"):
    rough = np.where(peb, 0.62 + 0.1 * (1.0 - rel) + 0.08 * (idx == 2), 0.92) + 0.03 * kit.fbm(0.02, 2)

finish_terrain(kit, h, alb, rough, macro_sigma=0.4, ao_distance=0.03, height_hp=0.5, ao_height_mix=0.35,
               description="River pebbles and gravel (2 m): packed rounded pebbles 2-10 cm of mixed stone, imbricated, "
                           "angular scree, sand in the gaps, silt film; macro-neutral.")
