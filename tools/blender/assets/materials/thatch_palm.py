"""
@asset thatch_palm
@kind material
@style materials:MATERIAL_PRESETS.thatch_palm, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@tiers ultra,high
@fallback thatch_grass

Woven palm-leaf (cadjan) shingle thatch (class C, 2 m x 2 m, seamless; P2 - ultra / high, mobile falls back to
thatch_grass): seven courses (0.286 m rhythm) of plaited coconut-frond mats, u along the ridge, v UP the slope.
Each course: the plaited band (diagonal over-under leaflets) on top, free leaflet ends hanging down-slope in a
ragged fringe with dark gaps between the tips, midribs, split and curled leaflets, sun-bleached grey tips,
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
    cr = ((course * 0.618 + 0.17) % 1.0).astype(np.float32)
    u = kit.x * W + cr * LEAF * 0.5
    li = np.floor(u / LEAF)
    lu = (u - li * LEAF) / LEAF
    li = li % round(W / LEAF)
    lid = ((li * 0.7548 + course * 0.5698) % 1.0).astype(np.float32)
    # fringe: free leaflet ends of varying length hang below the plait (lv < tip); pointed tips
    tip = 0.15 + 0.45 * lid ** 1.5 + 0.12 * (kit.fbm(0.35, 3) * 0.5 + 0.5)
    width_at = np.clip((lv - tip * 0.0) / np.maximum(tip, 1e-3), 0, 1)  # 0 at the very tip
    half = 0.42 * np.clip(width_at * 2.5, 0.0, 1.0) ** 0.7
    in_leaf = np.abs(lu - 0.5) < half
    fringe = lv < tip
    hole = fringe & ~in_leaf  # dark gaps between the tips (the course below shows deep in shadow)
    # plait: diagonal over-under weave on the upper part of the course
    pu = kit.x * 56.0  # even number of plait cycles per tile (seamless), ~36 mm plait pitch
    pv = vy / H * 56.0
    d1 = np.sin(np.pi * (pu + pv))
    d2 = np.sin(np.pi * (pu - pv))
    over = (np.sign(d1) * np.sign(d2)) > 0
    plait = tg.smoothstep(tip, tip + 0.08, lv)
    rib = tg.smoothstep(0.08, 0.0, np.abs(lu - 0.5))  # leaflet midrib
    h = 0.03 * (1.0 - lv) ** 1.2  # course step (shingle)
    leaf_prof = np.sqrt(np.clip(1.0 - (2.0 * (lu - 0.5)) ** 2, 0, 1))
    h += (0.002 * leaf_prof + 0.0006 * rib) * (1.0 - plait)
    weave = np.where(over, np.abs(d1), np.abs(d2))
    h += plait * (0.0025 * weave + 0.001 * over)
    curl = tg.smoothstep(0.1, 0.0, lv) * ((lid * 5.3) % 1.0 > 0.6)
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
    leaf = K.tint(leaf, "#b8ab88", 0.35 * tg.smoothstep(0.15, 0.0, lv) * (1.0 - hole))  # bleached tips
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
                       "every 0.286 m, ragged leaflet fringe with dark gaps, bleached tips.",
           extra_meta=dict(slopeAxis="v"),
           preview="roof", preview_opts=dict(samples=64, pitch=35.0))
