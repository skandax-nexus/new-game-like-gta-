"""
@asset terrain_alluvial_silt
@kind material
@style terrain:TERRAIN_LAYERS.alluvial_silt, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@inputs tools/blender/assets/materials/_matkit.py

Gangetic alluvium splat layer (class T, 4 m x 4 m, seamless, macro-neutral): fine grey-brown silt, patches of
dried current ripples (asymmetric, 6-9 cm wavelength, bifurcating), thin curled mud-crack flakes where puddles
dried, sparse cattle hoof prints and bare footprints (low contrast, varied, never a landmark), a dusting of pale
dry silt on crests, darker damp hollows, fine sand grains and a few rootlets.
Target (TERRAIN_LAYERS.alluvial_silt): average #8d7d64, roughness 0.92.
OWNER: Technical Artist A (TA-01).
"""
import math
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
from _terrainkit import K, finish_terrain, layers, shape_foot, shape_hoof  # noqa: E402

S = 4.0
kit = K.Kit(__file__, cls="T", size=(S, S), target="terrain:TERRAIN_LAYERS.alluvial_silt", family="soilDry",
            rough_spread=0.04)
x, y = kit.x, kit.y

with core.timer("silt"):
    h = 0.003 * kit.fbm(0.35, 3) + 0.0012 * kit.fbm(0.06, 3) + 0.00025 * kit.fbm(0.006, 2)
    # dried ripples: two current directions in patches
    rip = np.zeros_like(h)
    # integer wave vectors per tile (kx, ky) = ripples at ~20 and ~110 deg, 7.5 / 6.5 cm: seamless
    for kx, ky in ((50, 18), (-20, 58)):
        wx, wy = kit.warp(0.05, 0.3, 3)
        ph = wx * kx + wy * ky + 0.6 * kit.fbm(0.25, 3)
        p = ph % 1.0
        prof = np.where(p < 0.7, p / 0.7, (1.0 - p) / 0.3)  # gentle stoss, steep lee
        zone = tg.smoothstep(0.45, 0.65, kit.fbm(0.45, 3) * 0.5 + 0.5)
        rip = np.maximum(rip, 0.0045 * tg.smoothstep(0.0, 1.0, prof) * zone)
    h += rip
    # mud-crack flakes in dried puddle zones: polygons whose edges curl up
    low = tg.smoothstep(0.58, 0.72, kit.fbm(0.4, 3) * 0.5 + 0.5)
    cx, cy = kit.warp(0.008, 0.05, 2)
    f1, f2, cid = kit.worley(0.07, 1.0, x=cx, y=cy)
    edge = f2 - f1
    curl = tg.smoothstep(0.25, 0.02, edge) * low
    crack = tg.smoothstep(0.03, 0.0, edge) * low
    h += 0.0015 * curl - 0.004 * crack

with core.timer("prints"):
    trail = tg.smoothstep(0.45, 0.65, kit.fbm(0.6, 3) * 0.5 + 0.5)  # where people and cattle walk
    feet = kit.scatter(0.45, shape_foot(0.008), density=0.3, density_map=trail)
    hooves = kit.scatter(0.3, shape_hoof(0.014), density=0.35, density_map=trail)
    d = np.maximum(feet.height(0.0), hooves.height(0.0))
    rim = tg.blur(d, 3.0)  # displaced silt pushed up around the prints
    h += 0.4 * np.clip(rim - d, 0.0, None) - d

with core.timer("albedo"):
    t = np.clip(0.5 + 0.3 * kit.fbm(0.15, 3) + 0.15 * kit.fbm(0.03, 2) + 0.08 * kit.fbm(0.004, 2), 0, 1)
    alb = K.ramp(t, [(0.0, "#6e624f"), (0.4, "#837562"), (0.7, "#93836b"), (1.0, "#a69779")])
    # pale dry silt on ripple crests and flake tops, damper darker troughs / prints / cracks
    crest = np.clip(rip / 0.0045, 0, 1)
    alb = K.tint(alb, "#b9ab8e", 0.45 * crest ** 2 + 0.35 * curl)
    alb = K.mul(alb, 1.0 - 0.4 * crack)
    alb = K.mul(alb, 1.0 - 0.12 * np.clip(d / 0.008, 0, 1))
    alb = K.tint(alb, "#5f5546", 0.25 * tg.smoothstep(0.65, 0.85, kit.fbm(0.12, 3) * 0.5 + 0.5))  # damp hollows
    # sparse dark rootlets and pale shell / mica grains
    roots = kit.scatter(0.12, K.shape_blade(0.05, 0.0006, 0.0005, 0.6), density=0.2)
    alb = K.tint(alb, "#4a3f31", 0.6 * roots.mask)
    alb = K.mul(alb, 1.0 + 0.12 * tg.smoothstep(0.7, 0.9, kit.fbm(0.002, 1) * 0.5 + 0.5))
    alb = K.compress_chroma(alb, 0.8)

with core.timer("roughness"):
    rough = 0.92 + 0.03 * kit.fbm(0.05, 2) - 0.05 * tg.smoothstep(0.65, 0.85, kit.fbm(0.12, 3) * 0.5 + 0.5) + 0.03 * crest

finish_terrain(kit, h, alb, rough, ao_distance=0.03,
               description="Gangetic alluvial silt (4 m): dried ripple patches, curled mud-crack flakes, sparse hoof "
                           "and foot prints, pale crests, damp hollows; macro-neutral.")
