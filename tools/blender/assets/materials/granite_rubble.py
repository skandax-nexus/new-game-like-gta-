"""
@asset granite_rubble
@kind material
@style materials:MATERIAL_PRESETS.granite_rubble, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS

Dry-laid granite rubble masonry (class C, 3 m x 3 m, seamless): irregular roughly-coursed blocks 0.3-0.9 m
(warped Voronoi with a horizontal bias), rock-faced with rounded weathered edges, deep dark joints packed with
small chinking stones and soil, speckled granite grain (pink feldspar, white quartz, black biotite), per-block
tone, black water staining from the joints, orange and grey-green lichen on the upper faces of blocks.
Target (MATERIAL_PRESETS.granite_rubble): average #8a8680, roughness 0.82 (0.70-0.95).

Period notes: dry-laid granite rubble walls are the hill-fort masonry of the Deccan in every early period;
no mortar, no dressed ashlar.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
import _matkit as K  # noqa: E402

W = H = 3.0
kit = K.Kit(__file__, cls="C", size=(W, H), target="materials:MATERIAL_PRESETS.granite_rubble", family="sandstone")

with core.timer("blocks"):
    st = kit.stones(0.55, warp_m=0.09, jitter=0.85, aniso=(1.5, 0.7))
    d, sid = st["d"], st["id"]
    gap = 0.014 + 0.022 * (kit.fbm(0.3, 2) * 0.5 + 0.5)
    inside = tg.smoothstep(gap, gap + 0.006, d)
    # rock-faced, pillowed blocks with rounded weathered edges, per-block projection
    bulge = 0.06 * np.clip((d - gap) / 0.14, 0.0, 1.0) ** 0.6 + 0.02 * (sid - 0.5)
    # rock-faced: a few broad facets per block (pitched faces) + granular roughness
    fac = np.abs(kit.fbm(0.18, 2)) * 0.012
    face = 0.01 * kit.fbm(0.12, 4) + fac + 0.002 * kit.fbm(0.02, 3) + 0.0004 * kit.fbm(0.004, 2)
    block_h = bulge + face
    joint_floor = -0.05
    h = joint_floor + (block_h - joint_floor) * inside
    # chinking stones in the joints
    ch = kit.scatter(0.04, K.shape_pebble(0.016, 0.012, 0.02, 0.5, 0.4), density=0.75, density_map=1.0 - inside)
    chm = (ch.h > -1e5) & (inside < 0.5)
    h = np.where(chm, np.maximum(h, joint_floor + 0.02 + ch.height(0.0)), h)

with core.timer("albedo"):
    t = np.clip(0.5 + 0.4 * (sid - 0.5) + 0.12 * kit.fbm(0.3, 3) + 0.05 * kit.fbm(0.03, 2), 0, 1)
    rock = K.ramp(t, [(0.0, "#6c6862"), (0.4, "#827d76"), (0.75, "#968f86"), (1.0, "#aaa398")])
    rock = np.where(((sid * 4.7) % 1.0 < 0.25)[..., None], K.tint(rock, "#a08a7e", 0.3), rock)  # pinker blocks
    grain = kit.fbm(0.004, 1)
    rock = K.tint(rock, "#b49a8c", 0.3 * tg.smoothstep(0.35, 0.6, grain))
    rock = K.tint(rock, "#2a2724", 0.4 * tg.smoothstep(-0.35, -0.6, grain))
    soil = K.ramp(np.clip(0.5 + 0.3 * kit.fbm(0.03, 2), 0, 1), [(0.0, "#2c2620"), (1.0, "#4a4036")])
    chink = K.ramp(ch.id, [(0.0, "#5e5a54"), (1.0, "#8a847a")])
    alb = rock * inside[..., None] + soil * (1.0 - inside[..., None])
    alb = np.where(chm[..., None], chink, alb)
    # water staining from the joints downward, dirt rim around blocks
    src = (1.0 - inside) * tg.smoothstep(0.3, 0.6, kit.fbm(0.1, 3, aniso=(0.3, 1.0)) * 0.5 + 0.5)
    stain = np.clip(tg.blur(tg.directional_blur_down(src, int(kit.px(0.25)), 0.97), 1.5), 0, 1) * inside
    alb = K.tint(alb, "#3a3834", 0.35 * stain)
    alb = K.tint(alb, "#4e463c", 0.3 * tg.smoothstep(gap + 0.03, gap, d) * inside)
    # lichen on upper block faces: orange spots and grey-green crusts
    lf1, _, lid = kit.worley(0.04, 1.0)
    blob = tg.smoothstep(0.55, 0.3, lf1 + 0.15 * kit.fbm(0.012, 2)) * inside
    top = tg.smoothstep(0.35, 0.95, np.clip((d - gap) / 0.15, 0, 1)) * (0.4 + 0.6 * tg.smoothstep(0.3, 0.7, kit.fbm(0.5, 3) * 0.5 + 0.5))
    orange = blob * (lid > 0.72) * top
    green = blob * (lid < 0.2) * top
    alb = K.tint(alb, "#c07a32", 0.7 * orange)
    alb = K.tint(alb, "#8a8f74", 0.45 * green)
    alb = K.compress_chroma(alb, 0.9)

with core.timer("roughness"):
    rough = 0.8 + 0.05 * kit.fbm(0.1, 3) + 0.1 * (1.0 - inside) + 0.06 * (orange + green) - 0.06 * stain

kit.finish(height=h, albedo=alb, rough=rough, ao="cycles", ao_distance=0.08, ao_samples=32,
           description="Dry-laid granite rubble (3 m): irregular rock-faced blocks, deep joints with chinking stones, "
                       "speckled grain, water stains, orange and grey lichen.",
           preview="wall", preview_opts=dict(floor_band=None, samples=64))
