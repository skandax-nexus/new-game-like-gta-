"""
@asset terrain_rock_sandstone
@kind material
@style terrain:TERRAIN_LAYERS.rock_sandstone_cliff, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@inputs tools/blender/assets/materials/_matkit.py

Sandstone cliff splat layer for TRIPLANAR projection (class T, 10 m x 10 m, seamless; v = world up on the side
projections). Horizontal beds 0.25-1.6 m thick of different hardness (hard beds stand out as ledges with
undercut lips, soft beds recess and honeycomb), cross-bedded laminae inside the beds (inclined sets that change
dip from bed to bed), vertical joints every 1-3 m with darker water-stained faces, tafoni (honeycomb) pits in the
soft beds, buff to red to purple-grey colour banding, dark varnish / water streaks running down from the ledges,
grey-green lichen on the ledge tops, sparse fallen grit.
Target (TERRAIN_LAYERS.rock_sandstone_cliff): average #a88a6c, roughness 0.82.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
from _terrainkit import K, finish_terrain  # noqa: E402

S = 10.0
kit = K.Kit(__file__, cls="T", size=(S, S), target="terrain:TERRAIN_LAYERS.rock_sandstone_cliff", family="sandstone",
            rough_spread=0.07)
x, y = kit.x, kit.y

with core.timer("beds"):
    # bed boundaries: irregular thicknesses summing to the tile height, gently undulating
    thick: list[float] = []
    while sum(thick) < S:
        thick.append(float(kit.rng.uniform(0.25, 1.6)))
    sc = S / sum(thick)
    tops = np.cumsum([t * sc for t in thick])
    bottoms = np.concatenate([[0.0], tops[:-1]])
    undul = 0.12 * kit.fbm(1.2, 3, aniso=(3.0, 1.0)) + 0.04 * kit.fbm(0.3, 3)
    vm = (y * S + undul) % S
    bed = np.searchsorted(tops, vm, side="right").clip(0, len(tops) - 1)
    b0 = bottoms[bed]
    b1 = tops[bed]
    lv = (vm - b0) / (b1 - b0)
    hard = (np.array([kit.rng.uniform(0, 1) for _ in thick], np.float32))[bed]
    tone = (np.array([kit.rng.uniform(0, 1) for _ in thick], np.float32))[bed]
    lam_len = np.array([kit.rng.uniform(0.03, 0.05) for _ in thick], np.float32)
    # laminae dip per bed, quantized so the phase wraps exactly across the 10 m tile (seamless in u)
    kdip = np.array([round(kit.rng.uniform(-0.6, 0.6) * S / l) for l in lam_len], np.float32)
    # bed profile: hard beds bulge out with an undercut lip at their base; soft beds recess
    out = 0.08 + 0.16 * hard
    prof = np.sin(np.pi * np.clip(lv, 0, 1)) ** 0.6
    lip = tg.smoothstep(0.0, 0.08, lv) * (hard > 0.55)
    h = out * prof * (0.6 + 0.4 * lip) - 0.05 * (1.0 - hard) * prof
    # cross-bedded laminae: inclined lines inside each bed
    lam = np.sin(2 * np.pi * (vm / lam_len[bed] + kdip[bed] * x + 2.0 * kit.fbm(0.8, 3)))
    h += 0.004 * lam * (0.4 + 0.6 * (1.0 - hard))

with core.timer("joints + weathering"):
    # joints: per bed a set of vertical joints (3-7 per tile -> periodic), half of the beds continue the joints of
    # the bed below, so some cracks run through several beds and others stop at bedding planes
    nb = len(thick)
    nj = [int(kit.rng.integers(3, 8)) for _ in range(nb)]
    off = [float(kit.rng.uniform(0, S)) for _ in range(nb)]
    for i in range(1, nb):
        if kit.rng.uniform() < 0.5:
            nj[i], off[i] = nj[i - 1], off[i - 1]
    nj_a = np.array(nj, np.float32)[bed]
    off_a = np.array(off, np.float32)[bed]
    sp_a = S / nj_a
    jw = 0.08 * kit.fbm(0.8, 3, aniso=(0.3, 1.0)) + 0.02 * kit.fbm(0.15, 2)
    fr = ((x * S - off_a + jw) % sp_a)
    dj = np.minimum(fr, sp_a - fr)
    joint = tg.smoothstep(0.045, 0.0, dj) * tg.smoothstep(-0.4, 0.1, kit.fbm(0.7, 2, aniso=(0.4, 1.0)))
    h -= 0.15 * joint
    block = ((np.floor((x * S - off_a + jw) / sp_a) * 0.618 + bed * 0.31) % 1.0).astype(np.float32)
    h += 0.05 * (block - 0.5) * prof  # blocks between joints stand at slightly different depths
    # tafoni / honeycomb in the soft beds
    hf1, _, hid = kit.worley(0.09, 0.9)
    bowl = np.clip(1.0 - (hf1 / (0.45 + 0.25 * hid)) ** 2, 0.0, 1.0)
    zone = (1.0 - hard) * tg.smoothstep(0.0, 0.5, kit.fbm(1.2, 3))
    honey = zone * bowl ** 1.2
    h -= 0.035 * honey
    # spalls and granular surface
    sp = tg.smoothstep(0.25, 0.3, kit.fbm(0.6, 5))
    h -= 0.015 * sp
    h += 0.03 * kit.fbm(0.5, 4) + 0.012 * kit.fbm(0.12, 3) + 0.0015 * kit.fbm(0.02, 3)

with core.timer("albedo"):
    t = np.clip(0.5 + 0.6 * (tone - 0.5) + 0.12 * kit.fbm(0.8, 3) + 0.08 * kit.fbm(0.05, 3), 0, 1)
    alb = K.ramp(t, [(0.0, "#7f5a4a"), (0.3, "#96705a"), (0.55, "#a8886b"), (0.8, "#bea27f"), (1.0, "#cdb593")])
    # purple-grey reduced beds and red iron bands
    alb = K.tint(alb, "#857269", 0.35 * tg.smoothstep(0.75, 0.95, tone))
    alb = K.tint(alb, "#a2624a", 0.25 * tg.smoothstep(0.2, 0.05, tone))
    alb = K.mul(alb, 1.0 + 0.05 * lam)
    # water / varnish streaks running down from ledges (under hard-bed lips) and down joints
    src = (lip * (lv < 0.12)).astype(np.float32) + joint
    streak = tg.directional_blur_down(src * tg.smoothstep(0.2, 0.6, kit.fbm(0.2, 3, aniso=(0.15, 1.0)) * 0.5 + 0.5),
                                      int(kit.px(0.9)), 0.985)
    streak = np.clip(tg.blur(streak, 1.5), 0, 1)
    alb = K.tint(alb, "#4b3d33", 0.45 * streak)
    alb = K.tint(alb, "#5a4a3e", 0.5 * joint)
    # honeycomb interiors darker, spall scars fresher / pinker
    alb = K.mul(alb, 1.0 - 0.35 * honey)
    alb = K.tint(alb, "#c39878", 0.3 * sp)
    # lichen on ledge tops (upper part of hard beds)
    ledge = tg.smoothstep(0.75, 0.95, lv) * (hard > 0.55)
    lich = ledge * tg.smoothstep(0.45, 0.7, kit.fbm(0.08, 3) * 0.5 + 0.5)
    alb = K.tint(alb, "#7d7b62", 0.5 * lich)
    alb = K.compress_chroma(alb, 0.8)

with core.timer("roughness"):
    rough = 0.82 + 0.05 * kit.fbm(0.3, 3) + 0.06 * honey + 0.05 * lich - 0.08 * streak - 0.05 * sp

finish_terrain(kit, h, alb, rough, macro_sigma=2.5, macro_amount=0.6, height_hp=0.3, ao_distance=0.4,
               ao_height_mix=0.35, preview="cliff",
               description="Sandstone cliff for triplanar projection (10 m, v = up): beds of varying hardness with "
                           "ledges and undercuts, cross-bedding, joints, honeycomb, varnish streaks, lichen.",
               extra_meta=dict(projection="triplanar", vUp="v = world up on side projections"))
