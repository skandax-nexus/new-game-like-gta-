"""
@asset thatch_grass
@kind material
@style materials:MATERIAL_PRESETS.thatch_grass, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS

Grass / straw thatch (class S, 2 m x 2 m tile, seamless). Map u along the eave and v UP the slope: combed straw
laid in courses of 0.25 m (3-4 cm thick, rounded butt tufts at each course's lower edge, cut stem ends showing,
casting a stepped shadow line),
bundles 0.22-0.3 m wide bulging between them, thousands of individual stems running down-slope (scattered tapered
blades over stretched fibre noise), raised twisted coir rope bands every 0.667 m (three per tile, 22 mm, 3-ply
lay), a few straws lying over them. Colour: straw gold aging to
weathered grey (#857a62) on the exposed top layer (weather mask), fresher gold in repairs and under the ropes,
dark gaps between stems.
Target (MATERIAL_PRESETS.thatch_grass): average #a8935e, roughness 0.96 (0.90-1.00).

Period notes: grass and rice-straw thatch on bamboo frames is the village roof of the Gangetic plain in every
period; coir / munj grass rope ties. (Ragged eave fringe: geometry cards or an alpha strip - see the TA-01 report.)
OWNER: Technical Artist A (TA-01).
"""
import math
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
import _matkit as K  # noqa: E402

W = H = 2.0
kit = K.Kit(__file__, cls="S", size=(W, H), target="materials:MATERIAL_PRESETS.thatch_grass", family="soilDry",
            saturation_limit="large")
x, y = kit.x, kit.y
vm = y * H
COURSE = H / 8.0  # 0.25 m courses (bible §14: combed bundles 0.25 m, 2-4 cm relief per course)
ROPE_EVERY = H / 3.0

with core.timer("courses and bundles"):
    # courses: each laid over the one below; lower edge = ragged butt line, then thinning up-slope
    bx = x + 0.05 * kit.fbm(0.4, 3, aniso=(1.0, 2.0)) / W  # bundle seams wander, never straight verticals
    cb = kit.bond(COURSE, (0.2, 0.3), 0.0, stagger=None, x=bx)
    lv = cb["lv"]
    # each bundle's butt hangs lower in its middle than at its seams (rounded tufts), plus a shaggy +-1.5 cm fringe
    tuft = 0.035 * (1.0 - np.sin(np.pi * np.clip(cb["lu"], 0, 1)) ** 0.7) * (0.6 + 0.8 * ((cb["id"] * 5.3) % 1.0))
    ragged = tuft + 0.012 * kit.fbm(0.008, 3, aniso=(1.0, 5.0)) + 0.008 * kit.fbm(0.04, 2)
    lvr = np.clip(lv - ragged / COURSE, 0.0, 1.0)
    below_butt = (lv * COURSE < ragged).astype(np.float32)  # above the butt line: the course below shows
    # course relief: 3-4 cm thick butt ends thinning up-slope; under the butt line the lower course's top (low)
    relief = 0.036 * (1.0 - lvr) ** 0.7
    h = np.where(below_butt > 0, 0.004 * (lv * COURSE / np.maximum(ragged, 1e-4)), relief)
    butt_face = tg.smoothstep(0.08, 0.0, lvr) * (1.0 - below_butt)  # the cut stem ends facing down-slope
    h += 0.005 * kit.fbm(0.3, 3) + 0.003 * kit.fbm(0.08, 2, aniso=(1.0, 3.0))  # shaggy, uneven coat
    # bundles: combed bulges between bundle seams (random widths)
    bund = np.sin(np.pi * np.clip(cb["lu"], 0, 1)) ** 1.2
    h += 0.01 * bund * (0.5 + 0.5 * ((cb["id"] * 3.7) % 1.0)) * (1.0 - below_butt)
    # cut stem ends on the butt face: tiny dark tubes 2-4 mm
    ef1, _, eid = kit.worley(0.0035, 1.0)
    endgrain = butt_face * tg.smoothstep(0.45, 0.2, ef1)
    h -= 0.0015 * endgrain

with core.timer("stems"):
    # stretched fibre noise (stems along v), two scales
    fib = kit.fbm(0.005, 3, aniso=(1.0, 120.0)) * 0.6 + kit.fbm(0.0025, 2, aniso=(1.0, 150.0)) * 0.4
    h += 0.0022 * fib
    # individual straw blades, nearly vertical (down-slope), several layers; each bundle is combed in its own
    # direction (+-6 deg) and fans out a little toward its edges, so the coat is not a uniform printed streak
    comb = (((cb["id"] * 7.1) % 1.0) - 0.5) * 0.22 + (np.clip(cb["lu"], 0, 1) - 0.5) * 0.16
    stems = np.full(h.shape, -1e9, np.float32)
    sid = np.zeros(h.shape, np.float32)
    # stems read at 2 mm/texel (class S): long strands of 3-5 mm (a few straws each), nearly parallel
    for k, (cell, L, Wd, hh) in enumerate(((0.045, 0.36, 0.0045, 0.006), (0.035, 0.3, 0.0038, 0.0055),
                                          (0.027, 0.24, 0.0032, 0.005), (0.02, 0.18, 0.0028, 0.0045))):
        sc = kit.scatter((cell * 0.35, L * 1.45), K.shape_blade(L, Wd, hh, bend=0.06), density=0.97,
                         angle=(-math.pi / 2 - 0.08, -math.pi / 2 + 0.08), angle_map=comb.astype(np.float32))
        better = sc.h > stems
        stems = np.where(better, sc.h, stems)
        sid = np.where(better, sc.id, sid)
    stem_mask = (stems > -1e5).astype(np.float32)
    h += np.where(stems > -1e5, stems, 0.0)

with core.timer("ropes"):
    # twisted coir rope along u at three heights; thatch pinched under it
    rv = (vm % ROPE_EVERY) - ROPE_EVERY * 0.55
    rv = rv + 0.015 * kit.fbm(0.5, 2) + 0.004 * kit.fbm(0.1, 2)  # the rope sags and wanders
    # raised rope bands (AD-1): continuous, a few straws lying over them in places
    R = 0.011
    rope_prof = np.sqrt(np.clip(1.0 - (rv / R) ** 2, 0.0, 1.0))
    show = 1.0 - 0.6 * tg.smoothstep(0.72, 0.85, kit.fbm(0.08, 3) * 0.5 + 0.5)
    strand = np.abs(np.sin(np.pi * (x * 125.0 + rv / 0.016)))  # 3-ply lay, 125 twists per tile: seamless
    rope_prof = rope_prof * show
    rope = rope_prof * (0.65 + 0.35 * strand ** 0.5)
    pinch = tg.smoothstep(0.05, 0.01, np.abs(rv))
    h = h * (1.0 - 0.5 * pinch) + rope * 0.022
    twist = strand
    rope_mask = tg.smoothstep(0.0, 0.25, rope_prof)

with core.timer("albedo"):
    # straw: gold to tan per stem, weathered grey top layer (weather mask), fresh gold under ropes / in repairs
    t = np.clip(0.5 + 0.6 * (sid - 0.5) * stem_mask + 0.25 * fib + 0.1 * kit.fbm(0.05, 3) + 0.22 * (((cb["id"] * 3.3) % 1.0) - 0.5), 0, 1)
    straw = K.ramp(t, [(0.0, "#7d6a42"), (0.35, "#9c8653"), (0.7, "#b49d64"), (1.0, "#c6b27a")])
    weather = tg.smoothstep(0.3, 0.75, kit.fbm(0.7, 4) * 0.5 + 0.5 + 0.2 * kit.fbm(0.08, 3))
    grey = K.ramp(t, [(0.0, "#625b4b"), (0.5, "#857a62"), (1.0, "#9d927a")])
    # weather mask (AD-1): exposed top layer greys toward #857a62, the butts under each course stay golder
    w = np.clip(0.7 * weather + 0.2 * (1.0 - lvr) * (1.0 - below_butt), 0.0, 0.85)
    alb = straw * (1.0 - w[..., None]) + grey * w[..., None]
    alb = K.tint(alb, "#c2a96c", 0.35 * pinch)  # protected straw under the rope stays golden
    # deep gaps between stems and under the course butts: dark
    gaps = tg.smoothstep(0.0, -0.6, fib) * (1.0 - stem_mask)
    butt = tg.smoothstep(0.12, 0.0, lvr) * tg.smoothstep(0.3, 0.6, kit.fbm(0.05, 2) * 0.5 + 0.5)
    alb = K.mul(alb, 1.0 - 0.45 * gaps - 0.1 * butt - 0.35 * endgrain - 0.3 * below_butt * (1.0 - lv * COURSE / np.maximum(ragged, 1e-4)))
    rope_col = K.ramp(np.clip(0.5 + 0.4 * (twist - 0.5) + 0.2 * kit.fbm(0.01, 2), 0, 1), [(0.0, "#5e4c32"), (0.6, "#7a6442"), (1.0, "#927a52")])
    alb = alb * (1.0 - rope_mask[..., None]) + rope_col * rope_mask[..., None]
    # dark mould / soot streaks running down-slope in places
    mould = tg.smoothstep(0.62, 0.85, kit.fbm(0.06, 3, aniso=(1.0, 10.0)) * 0.5 + 0.5) * tg.smoothstep(0.0, 0.4, kit.fbm(0.6, 2))
    alb = K.mul(alb, 1.0 - 0.3 * mould)
    alb = K.compress_chroma(alb, 0.6)

with core.timer("roughness"):
    rough = 0.96 + 0.02 * kit.fbm(0.02, 2) - 0.05 * stem_mask * (sid > 0.7) + 0.03 * gaps - 0.02 * rope_mask

kit.finish(height=h, albedo=alb, rough=rough, ao="cycles", ao_distance=0.04, ao_samples=48,
           description="Grass/straw thatch (2 m): combed stems in 0.25 m courses with 3-4 cm butt steps, bundles, raised coir rope bands every "
                       "0.67 m, weathered grey top layer. u = along the eave, v = up the slope.",
           extra_meta=dict(vUp="v points UP the roof slope (stems hang toward -v)"),
           preview="roof", preview_opts=dict(samples=64, pitch=35.0))
