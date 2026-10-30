"""
@asset sandstone_polished_mauryan
@kind material
@style materials:MATERIAL_PRESETS.sandstone_polished_mauryan, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS

Mauryan polished Chunar sandstone (class C, 2 m x 2 m, seamless): the mirror polish of the monolithic pillars and
capitals - creamy buff stone with a soft cloud mottle (+-4 %), faint pinkish and grey bedding wisps, fine dark
mineral speckle (~4 %), almost no relief (micro speckle 0.05 mm, faint grinding waves, a few fine scratches),
polish dulled in weathered patches and where dust settles. No joints: monoliths. Use with clearcoat 0.6 / 0.12
(MATERIAL_PRESETS.sandstone_polished_mauryan.clearcoat) in the runtime material.
Target (MATERIAL_PRESETS.sandstone_polished_mauryan): average #cdbb9a, roughness 0.18 (0.10-0.32).

Period notes: the "Mauryan polish" of Ashokan pillars (Chunar sandstone, 3rd c. BCE) - the empire's signature
surface; no inscriptions here (they are decals / geometry), no later Gupta-period ornament.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
import _matkit as K  # noqa: E402

W = H = 2.0
kit = K.Kit(__file__, cls="C", size=(W, H), target="materials:MATERIAL_PRESETS.sandstone_polished_mauryan",
            family="sandstone")

with core.timer("relief"):
    h = 0.00005 * kit.fbm(0.004, 2) + 0.00012 * kit.fbm(0.3, 3)
    # faint grinding waves (the polishing stroke direction is mostly along u)
    h += 0.00006 * np.sin(2 * np.pi * (kit.y * 57.0 + 0.5 * kit.fbm(0.4, 3, aniso=(4.0, 1.0))))
    # a few fine scratches
    sc = kit.scatter(0.25, K.shape_blade(0.18, 0.0004, 0.00008, 0.1), density=0.25)
    h -= sc.height(0.0)

with core.timer("albedo"):
    mottle = kit.fbm(0.4, 3)
    t = np.clip(0.5 + 0.22 * mottle + 0.08 * kit.fbm(0.08, 3), 0, 1)
    alb = K.ramp(t, [(0.0, "#bba985"), (0.45, "#c9b796"), (0.8, "#d4c4a4"), (1.0, "#ddd0b2")])
    wx, wy = kit.warp(0.06, 0.8, 3)
    wisp = tg.smoothstep(0.85, 0.98, np.sin(2 * np.pi * (wy * 3.0 + 0.3 * kit.fbm(1.0, 2, x=wx, y=wy))))
    alb = K.tint(alb, "#c9aa98", 0.2 * wisp * tg.smoothstep(-0.2, 0.3, kit.fbm(0.6, 2)))
    alb = K.tint(alb, "#a8a294", 0.15 * tg.smoothstep(0.3, 0.7, kit.fbm(0.5, 3)))  # greyer clouds
    speck = tg.smoothstep(0.72, 0.85, kit.fbm(0.0025, 1) * 0.5 + 0.5)
    alb = K.tint(alb, "#5e5446", 0.5 * speck)
    alb = K.mul(alb, 1.0 - 0.15 * sc.mask)

with core.timer("roughness"):
    dull = tg.smoothstep(0.35, 0.75, kit.fbm(0.35, 4) * 0.5 + 0.5)
    rough = 0.14 + 0.12 * dull + 0.03 * kit.fbm(0.05, 2) + 0.08 * sc.mask

kit.finish(height=h, albedo=alb, rough=rough, ao="horizon", ao_distance=0.005, rough_blur_px=0.5,
           description="Mauryan mirror-polished Chunar sandstone (2 m): cloud mottle, faint bedding wisps, dark "
                       "speckle, grinding waves; polish dulled in patches. Use with clearcoat 0.6.",
           preview="wall", preview_opts=dict(floor_band=None, samples=64))
