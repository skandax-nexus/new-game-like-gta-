"""
@asset granite_rubble
@kind material
@style materials:MATERIAL_PRESETS.granite_rubble, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS

Dry-laid granite rubble masonry (class C, 3 m x 3 m, seamless): irregular roughly-coursed blocks 0.3-0.9 m
(warped Voronoi with a horizontal bias), rock-faced and bulging (3-7 cm pillow broken into pitched planar facets),
joints of varying depth (soil-filled stretches and deep dark voids) pinned with flat wedge stones, speckled granite
grain (pink feldspar, white quartz, black biotite), stone value within +-10 % of the target, per-block tone, water
staining from the joints, orange and grey-green crustose lichen with lobed rosettes on upward faces and drip lines.
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
    gap = 0.006 + 0.014 * (kit.fbm(0.3, 2) * 0.5 + 0.5)  # joints 12-40 mm, varying along each joint
    inside = tg.smoothstep(gap, gap + 0.006, d)
    # AD-5: bulging rock-faced blocks - a pillow that rises 3-7 cm from the arris, broken into a few pitched
    # planar facets (hammer-dressed), per-block projection
    pill = (0.03 + 0.04 * ((sid * 7.7) % 1.0)) * np.clip((d - gap) / 0.16, 0.0, 1.0) ** 0.55
    fac = kit.facets(0.13, slope=0.16)
    face = pill + 0.35 * fac["h"] * np.clip((d - gap) / 0.08, 0.0, 1.0) + 0.02 * (sid - 0.5)
    face += 0.004 * kit.fbm(0.12, 3) + 0.0015 * kit.fbm(0.02, 3) + 0.0004 * kit.fbm(0.004, 2)
    # joints of varying depth: shallow soil-filled stretches and deep dark voids
    jdepth = 0.03 + 0.06 * tg.smoothstep(-0.2, 0.5, kit.fbm(0.25, 3))
    joint_floor = -jdepth
    h = joint_floor + (face - joint_floor) * inside
    void = (1.0 - inside) * tg.smoothstep(0.06, 0.085, jdepth)
    # wedge (pinning) stones hammered into the wider joints: flat, angular, 30-80 mm
    ch = kit.scatter(0.07, K.shape_pebble(0.035, 0.016, 0.03, 0.4, 0.5), density=0.65,
                     density_map=(1.0 - inside) * tg.smoothstep(0.012, 0.018, gap), angle=(-0.5, 0.5))
    chm = (ch.h > -1e5) & (inside < 0.5)
    h = np.where(chm, np.maximum(h, joint_floor + 0.025 + ch.height(0.0)), h)

with core.timer("albedo"):
    # stone value kept within +-10 % of #8a8680 (AD-5): narrow per-block tone, joints not much darker than needed
    t = np.clip(0.5 + 0.3 * (sid - 0.5) + 0.1 * kit.fbm(0.3, 3) + 0.05 * kit.fbm(0.03, 2), 0, 1)
    rock = K.ramp(t, [(0.0, "#7b7771"), (0.5, "#8a8680"), (1.0, "#99948c")])
    rock = np.where(((sid * 4.7) % 1.0 < 0.25)[..., None], K.tint(rock, "#93857d", 0.35), rock)  # pinker blocks
    g1, _, gid = kit.worley(0.005, 1.0)  # granite grain: feldspar, quartz, biotite
    rock = K.tint(rock, "#a68f84", 0.3 * (gid < 0.2))
    rock = K.tint(rock, "#b0aca4", 0.25 * ((gid > 0.2) & (gid < 0.32)))
    rock = K.tint(rock, "#2e2b28", 0.45 * ((gid > 0.92) & (g1 < 0.45)))
    rock = K.tint(rock, "#9a948a", 0.07 * tg.smoothstep(0.004, 0.0, fac["d"]))  # faint fresh facet arrises
    # AD-5: joint fill close to the stone value (dusty grus and soil, only the deep voids dark), so calibration does
    # not have to push the stones toward white to reach the set mean: stones stay within +-10 % of #8a8680
    soil = K.ramp(np.clip(0.5 + 0.3 * kit.fbm(0.03, 2), 0, 1), [(0.0, "#6a6255"), (1.0, "#7e7566")])
    soil = K.mul(soil, 1.0 - 0.45 * void)  # deep voids read dark (AO adds the rest)
    chink = K.ramp(ch.id, [(0.0, "#77726a"), (1.0, "#8d877e")])
    alb = rock * inside[..., None] + soil * (1.0 - inside[..., None])
    alb = np.where(chm[..., None], chink, alb)
    # water staining from the joints downward, dirt rim around blocks
    src = (1.0 - inside) * tg.smoothstep(0.3, 0.6, kit.fbm(0.1, 3, aniso=(0.3, 1.0)) * 0.5 + 0.5)
    stain = np.clip(tg.blur(tg.directional_blur_down(src, int(kit.px(0.25)), 0.97), 1.5), 0, 1) * inside
    alb = K.tint(alb, "#5a5650", 0.25 * stain)
    alb = K.tint(alb, "#5e564b", 0.25 * tg.smoothstep(gap + 0.025, gap, d) * inside)
    # lichen: crustose patches and lobed rosettes on the upward faces and along the drip lines (AD-5)
    gy = -np.gradient(tg.blur(h, kit.px(0.03)), axis=0) / kit.texel
    up = np.clip(tg.smoothstep(0.0, 0.3, gy) * inside + 0.5 * stain, 0, 1)
    lic = kit.lichen(up, coverage=0.07, patch_m=0.25, rosette_m=0.025, rosette_density=0.4)
    lsel = kit.white(0.09)
    orange = np.clip(lic["rosette"] * (lsel > 0.55) + lic["crust"] * (kit.fbm(0.8, 2) > 0.25), 0, 1) * inside
    green = np.clip(lic["rosette"] * (lsel <= 0.55) + lic["crust"] * (kit.fbm(0.8, 2) <= 0.25), 0, 1) * inside
    alb = K.tint(alb, "#a8794b", 0.6 * orange)
    alb = K.tint(alb, "#8b8d77", 0.5 * green)
    alb = K.tint(alb, "#b4ae9e", 0.25 * lic["centre"] * inside)
    h = h + lic["h"] * inside
    alb = K.compress_chroma(alb, 0.9)

with core.timer("roughness"):
    rough = 0.8 + 0.05 * kit.fbm(0.1, 3) + 0.1 * (1.0 - inside) + 0.06 * (orange + green) - 0.06 * stain

kit.finish(height=h, albedo=alb, rough=rough, ao="cycles", ao_distance=0.08, ao_samples=32,
           description="Dry-laid granite rubble (3 m): bulging rock-faced blocks with pitched facets, joints of varying "
                       "depth with wedge stones and voids, speckled grain, water stains, crustose lichen.",
           preview="wall", preview_opts=dict(floor_band=None, samples=64))
