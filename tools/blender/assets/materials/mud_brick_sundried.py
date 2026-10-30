"""
@asset mud_brick_sundried
@kind material
@style materials:MATERIAL_PRESETS.mud_brick_sundried, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS

Sun-dried mud brick masonry (class C, 2 m x 2 m, seamless): 0.4 x 0.1 m brick faces in running bond with flush
mud mortar, arrises heavily rounded and gullied by rain, some bricks slumped / melted at the face, straw temper
fibres, shrinkage cracks, eroded mortar in places and proud mortar in others, a few brick faces spalled back,
pale sun-bleached and darker damp bricks.
Target (MATERIAL_PRESETS.mud_brick_sundried): average #a88866, roughness 0.95 (0.88-1.00).

Period notes: sun-dried (kachcha) brick in mud mortar - frontier and village walls in every period; often plastered
with mud (mud_plaster) and re-surfaced after the monsoon.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
import _matkit as K  # noqa: E402

W = H = 2.0
kit = K.Kit(__file__, cls="C", size=(W, H), target="materials:MATERIAL_PRESETS.mud_brick_sundried", family="soilDry")

with core.timer("bond"):
    # hand-laid courses: wavy, bricks of slightly varying length (0.36-0.44 m), thin flush mud joints
    bx, by = kit.warp(0.012, 0.7, 3)
    b = kit.bond(H / 18.0, (0.36, 0.44), 0.005, stagger=0.5, x=bx, y=by)  # 18 courses: 0.1 m brick + ~1 cm joint
    bid = b["id"]
    # erosion: wobbly brick outlines and heavily rounded arrises; gullies from rain running down
    ew = 0.001 + 0.006 * (kit.fbm(0.05, 3) * 0.5 + 0.5)
    d = b["d"] - ew
    inside = tg.smoothstep(-0.003, 0.006, d)
    rnd = K.Kit.edge_round(np.maximum(d, 0.0), 0.03, 0.009)
    gully = tg.smoothstep(0.55, 0.85, kit.fbm(0.04, 3, aniso=(0.4, 3.0)) * 0.5 + 0.5)
    slump = ((bid * 7.7) % 1.0) < 0.12
    face = 0.004 * kit.fbm(0.12, 3) + 0.0015 * kit.fbm(0.03, 3) + 0.0008 * kit.fbm(0.012, 2) - 0.004 * gully
    runnel = tg.smoothstep(0.72, 0.9, kit.fbm(0.04, 3, aniso=(0.3, 3.0), ridged=True)) * (1.0 - b["lv"])
    runnel = runnel * tg.smoothstep(-0.2, 0.4, kit.fbm(0.3, 2))
    face -= 0.0012 * runnel  # rain runnels from the brick above
    face += np.where(slump, -0.006 * (1.0 - b["lv"]) + 0.003 * kit.fbm(0.03, 2), 0.0)
    spall = (((bid * 3.3) % 1.0) < 0.06) * tg.smoothstep(0.45, 0.65, kit.fbm(0.06, 3) * 0.5 + 0.5)
    face -= 0.012 * spall
    c1, c2, _ = kit.worley(0.09, 1.0, x=kit.warp(0.006, 0.04, 2)[0])
    crack = tg.smoothstep(0.012, 0.0, c2 - c1) * tg.smoothstep(0.5, 0.75, kit.fbm(0.2, 3) * 0.5 + 0.5)
    face -= 0.003 * crack
    straw = kit.scatter(0.025, K.shape_blade(0.022, 0.0007, 0.0005, 0.4), density=0.25)
    face += straw.height(0.0) * 0.5
    proud = tg.smoothstep(0.0, 0.5, kit.fbm(0.3, 3))  # mortar proud of the face here, eroded there
    mortar_h = -0.005 + 0.006 * proud + 0.001 * kit.fbm(0.01, 2)
    brick_h = 0.006 + rnd + face
    h = mortar_h + (brick_h - mortar_h) * inside

with core.timer("albedo"):
    t = np.clip(0.5 + 0.18 * (bid - 0.5) + 0.16 * kit.fbm(0.12, 3) + 0.07 * kit.fbm(0.015, 2), 0, 1)
    brick = K.ramp(t, [(0.0, "#8a6c4f"), (0.4, "#9e7f5f"), (0.75, "#b0926f"), (1.0, "#c0a280")])
    bleach = tg.smoothstep(0.55, 0.85, kit.fbm(0.35, 3) * 0.5 + 0.5)  # sun-bleached zones, not single bricks
    brick = K.tint(brick, "#c2ab8a", 0.3 * bleach)
    damp = tg.smoothstep(0.55, 0.85, kit.fbm(0.5, 3) * 0.5 + 0.5)
    brick = K.mul(brick, 1.0 - 0.15 * damp - 0.15 * gully - 0.3 * crack)
    brick = K.tint(brick, "#8a6c50", 0.3 * spall)
    brick = K.tint(brick, "#b9a273", 0.35 * straw.mask)
    brick = K.mul(brick, 1.0 - 0.1 * runnel)
    mortar = K.ramp(np.clip(0.5 + 0.3 * kit.fbm(0.03, 3), 0, 1), [(0.0, "#86694d"), (1.0, "#a08262")])
    mortar = K.tint(mortar, "#b09878", 0.3 * bleach)
    alb = mortar * (1.0 - inside[..., None]) + brick * inside[..., None]
    alb = K.compress_chroma(alb, 0.7)

with core.timer("roughness"):
    rough = 0.95 + 0.02 * kit.fbm(0.05, 2) - 0.03 * straw.mask + 0.02 * gully - 0.03 * damp

kit.finish(height=h, albedo=alb, rough=rough, ao="cycles", ao_distance=0.03, ao_samples=32,
           description="Sun-dried mud brick (2 m): 0.4 x 0.1 m bricks in mud mortar, rain-rounded arrises and gullies, "
                       "slumped and spalled bricks, straw temper, cracks.",
           preview="wall", preview_opts=dict(floor_band=None, samples=64))
