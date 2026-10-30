"""
@asset thatch_palm
@kind material
@style materials:MATERIAL_PRESETS.thatch_palm, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@tiers ultra,high
@fallback thatch_grass

Woven palm-leaf (cadjan) shingle thatch (class C, 2 m x 2 m, seamless; P2 - ultra / high, mobile falls back to
thatch_grass): seven courses (0.286 m rhythm) of plaited coconut-frond mats, u along the ridge, v UP the slope.
Each course: the plaited band (diagonal over-under leaflets) on top, free leaflets of overlapping fronds hanging
down-slope (0.1-0.3 m long, 15-35 mm wide, each with its own droop and splay - no regular comb) with dark gaps
where the fringe thins, midribs, curled leaflets, sun-bleached grey tips,
darker damp undersides in the overlaps.
Target (MATERIAL_PRESETS.thatch_palm): average #9c8a5c, roughness 0.90 (0.80-0.98).

Period notes: coast and forest houses (Malabar, Konkan, Bengal) - plaited coconut / palmyra fronds; no corrugated
or modern sheeting.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
import _matkit as K  # noqa: E402

W = H = 2.0
kit = K.Kit(__file__, cls="C", size=(W, H), target="materials:MATERIAL_PRESETS.thatch_palm", family="soilDry",
            saturation_limit="medium")
NC = 7
CH = H / NC
LEAF = W / 80.0  # 25 mm leaflets

with core.timer("courses"):
    vy = kit.y * H + 0.035 * kit.fbm(0.4, 3) + 0.01 * kit.fbm(0.1, 2)  # courses sag and wander
    course = np.floor(vy / CH)
    lv = (vy - course * CH) / CH  # 0 = lower (fringe) edge of the course, 1 = under the next course
    course = course % NC  # seamless: the course index wraps with the tile
    # AD-7: overlapping fronds, not a zipper comb - free leaflets scattered along each course (two overlapping
    # passes), lengths 0.1-0.3 m, widths 15-35 mm, each drooping / splayed by its own angle; dark gaps where the
    # fringe is thin
    yv = (vy / H) % 1.0
    best = np.full(kit.x.shape, -1e9, np.float32)
    lid = np.zeros_like(kit.x)
    llu = np.zeros_like(kit.x)
    llv = np.zeros_like(kit.x)
    for cellu, Lm, Wm in ((0.05, 0.2, 0.012), (0.04, 0.16, 0.01)):
        sc = kit.scatter((cellu, CH), K.shape_blade(Lm, Wm, 0.004, bend=0.35), density=0.85, jitter=1.0,
                         angle=(-np.pi / 2 - 0.35, -np.pi / 2 + 0.35), x=kit.x, y=yv)
        better = sc.h > best
        best = np.where(better, sc.h, best)
        lid = np.where(better, sc.id, lid)
        llu = np.where(better, sc.lu / Lm, llu)
        llv = np.where(better, sc.lv, llv)
    tip = 0.62  # fringe zone: lower 62 % of each course (the plait band sits above)
    fringe = lv < tip
    in_leaf = best > -1e5
    hole = fringe & ~in_leaf
    leaf_prof = np.where(in_leaf, np.clip(best / 0.004, 0, 1), 0.0)
    rib = tg.smoothstep(0.0015, 0.0, np.abs(llv)) * in_leaf
    # plait: diagonal over-under weave on the upper part of the course
    pu = kit.x * 56.0  # even number of plait cycles per tile (seamless), ~36 mm plait pitch
    pv = vy / H * 56.0
    d1 = np.sin(np.pi * (pu + pv))
    d2 = np.sin(np.pi * (pu - pv))
    over = (np.sign(d1) * np.sign(d2)) > 0
    plait = tg.smoothstep(tip, tip + 0.06, lv + 0.04 * kit.fbm(0.05, 2))
    h = 0.03 * (1.0 - lv) ** 1.2  # course step (shingle)
    h += (0.004 * leaf_prof + 0.0006 * rib) * (1.0 - plait)
    weave = np.where(over, np.abs(d1), np.abs(d2))
    h += plait * (0.0025 * weave + 0.001 * over)
    curl = tg.smoothstep(0.75, 1.0, llu) * ((lid * 5.3) % 1.0 > 0.6) * in_leaf
    h += 0.004 * curl
    h = np.where(hole, h - 0.02, h)
    h += 0.0004 * kit.fbm(0.02, 2, aniso=(1.0, 6.0))

with core.timer("albedo"):
    t = np.clip(0.5 + 0.3 * (lid - 0.5) + 0.12 * kit.fbm(0.2, 3) + 0.08 * kit.fbm(0.03, 2, aniso=(1.0, 5.0)), 0, 1)
    leaf = K.ramp(t, [(0.0, "#7a6a44"), (0.4, "#8f7e52"), (0.75, "#a39261"), (1.0, "#b4a273")])
    old = tg.smoothstep(0.35, 0.75, kit.fbm(0.45, 3) * 0.5 + 0.5)
    patchy = tg.smoothstep(0.55, 0.8, kit.fbm(0.6, 3, aniso=(1.5, 0.6)) * 0.5 + 0.5)  # re-thatched patches
    leaf = K.tint(leaf, "#a89a5e", 0.35 * patchy * (1.0 - old))
    leaf = K.tint(leaf, "#8a8270", 0.5 * old)  # sun-bleached grey fronds
    leaf = K.tint(leaf, "#b8ab88", 0.35 * tg.smoothstep(0.6, 1.0, llu) * in_leaf * (1.0 - plait))  # bleached tips
    leaf = K.mul(leaf, 1.0 + 0.1 * rib * (1.0 - plait) + 0.06 * plait * (over - 0.5))
    damp = tg.smoothstep(0.75, 1.0, lv)
    leaf = K.mul(leaf, 1.0 - 0.25 * damp)
    gapc = K.hexlin("#2a241a")[None, None, :]
    alb = np.where(hole[..., None], gapc + 0.0 * leaf, leaf)
    alb = K.compress_chroma(alb, 0.75)

with core.timer("roughness"):
    rough = 0.88 + 0.04 * kit.fbm(0.1, 2) + 0.06 * hole + 0.03 * old - 0.04 * rib * (1.0 - plait)

kit.finish(height=h, albedo=alb, rough=rough, ao="cycles", ao_distance=0.04, ao_samples=32,
           description="Woven palm-leaf shingle thatch (2 m, u along the ridge, v up-slope): plaited frond courses "
                       "every 0.286 m, overlapping drooping leaflets of varied length with dark gaps, bleached tips.",
           extra_meta=dict(slopeAxis="v"),
           preview="roof", preview_opts=dict(samples=64, pitch=35.0))
