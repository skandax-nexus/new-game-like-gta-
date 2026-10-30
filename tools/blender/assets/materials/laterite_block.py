"""
@asset laterite_block
@kind material
@style materials:MATERIAL_PRESETS.laterite_block, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS

Laterite block masonry (class C, 2 m x 2 m, seamless): 0.6 x 0.3 m blocks of vesicular laterite, cut soft and
hardened in the air - riddled with interconnected worm-like tubes and pockets (2-25 mm), rust-red with ochre-yellow and
dark iron mottles, pale lithomarge clay filling some cavities, case-hardened darker block margins, near-dry joints (5 mm lime-mud pointing, mostly washed out),
blocks slightly proud / sunk, chipped corners and broken arrises, black algae / dust crust in patches.
Target (MATERIAL_PRESETS.laterite_block): average #8f4a34, roughness 0.90 (0.80-0.98).

Period notes: laterite blocks quarried and cut wet (Malabar / Konkan / Odisha) - southern walls, bastions and
parapets; dressed square, laid dry or with mud mortar.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
import _matkit as K  # noqa: E402

W = H = 2.0
kit = K.Kit(__file__, cls="C", size=(W, H), target="materials:MATERIAL_PRESETS.laterite_block", family="brickTerracotta",
            saturation_limit="medium")

with core.timer("blocks"):
    b = kit.bond(H / 7.0, (0.6, 0.6), 0.005, stagger=0.5, choices=[0.6, 0.6, 0.5, 0.67], choice_jitter=0.05)
    d, bid = b["d"], b["id"]
    jw = 0.003 + 0.003 * (kit.fbm(0.08, 2) * 0.5 + 0.5)
    inside = tg.smoothstep(jw - 0.001, jw + 0.002, d)
    arris = K.Kit.edge_round(np.maximum(d - jw, 0.0), 0.012, 0.005)
    chipn = kit.fbm(0.05, 4) * 0.5 + 0.5
    chips = tg.smoothstep(0.55, 0.75, chipn) * tg.smoothstep(0.05, 0.0, d - jw)
    tilt = 0.003 * (((bid * 7.7) % 1.0) - 0.5) + 0.0015 * (((bid * 3.1) % 1.0) - 0.5) * (b["lu"] - 0.5)
    face = 0.0012 * kit.fbm(0.12, 3) + 0.0004 * kit.fbm(0.02, 2)

with core.timer("vesicles"):
    # vermicular laterite: interconnected worm-like tubes and pockets (ridged-noise networks at two scales, density
    # varying in patches), a few rounder pits; pale clay (lithomarge) fills some of them
    wx, wy = kit.warp(0.02, 0.08, 3)
    r1 = kit.fbm(0.07, 3, ridged=True, x=wx, y=wy)
    r2 = kit.fbm(0.035, 2, ridged=True, x=wy, y=wx)
    dens = tg.smoothstep(-0.35, 0.35, kit.fbm(0.22, 3))
    tube = np.maximum(tg.smoothstep(0.72, 0.87, r1), 0.8 * tg.smoothstep(0.76, 0.9, r2)) * (0.2 + 0.8 * dens)
    v1a, _, v1id = kit.worley(0.03, 1.0, x=kit.warp(0.004, 0.03, 2)[0])
    pit = tg.smoothstep(0.32, 0.12, v1a) * (v1id > 0.6) * dens
    cav = np.clip(np.maximum(tube, pit), 0.0, 1.0)
    cav_sharp = tg.smoothstep(0.15, 0.45, cav)
    face -= 0.011 * cav_sharp + 0.003 * tg.smoothstep(0.45, 0.9, cav)
    clay = cav_sharp * tg.smoothstep(0.55, 0.75, kit.fbm(0.12, 3) * 0.5 + 0.5)  # clay-filled cavities: nearly flush
    face += 0.009 * clay

h = (0.004 + face + arris + tilt - 0.008 * chips) * inside + (-0.009 + 0.001 * kit.fbm(0.02, 2)) * (1.0 - inside)

with core.timer("albedo"):
    mx, my = kit.warp(0.03, 0.1, 3)
    m1 = kit.fbm(0.09, 3, x=mx, y=my)
    t = np.clip(0.5 + 0.15 * (bid - 0.5) + 0.3 * m1 + 0.06 * kit.fbm(0.02, 2), 0, 1)
    rock = K.ramp(t, [(0.0, "#5a2a1c"), (0.35, "#7a3826"), (0.65, "#8e4630"), (1.0, "#9a5536")])
    yel = tg.smoothstep(0.58, 0.8, kit.fbm(0.07, 3, x=my, y=mx) * 0.5 + 0.5)
    rock = K.tint(rock, "#a87440", 0.55 * yel)  # ochre-yellow (goethite) mottles
    dark = tg.smoothstep(0.62, 0.85, kit.fbm(0.1, 3) * 0.5 + 0.5)
    rock = K.tint(rock, "#3e2419", 0.45 * dark)  # dark iron / manganese mottles
    rind = tg.smoothstep(0.05, 0.0, d - jw)
    rock = K.mul(rock, 1.0 - 0.12 * rind)  # case-hardened, darker block margins
    rock = K.mul(rock, 1.0 - 0.55 * cav_sharp * (1.0 - clay))  # open cavities read dark
    rock = K.tint(rock, "#b8946a", 0.75 * clay)  # pale lithomarge clay fills
    rock = K.tint(rock, "#a9704c", 0.4 * chips)  # fresh breaks are lighter, more orange
    crust = tg.smoothstep(0.55, 0.85, kit.fbm(0.6, 4) * 0.5 + 0.5)
    rock = K.tint(rock, "#3b302a", 0.35 * crust)  # black algae / dust crust patches
    joint = K.ramp(np.clip(0.5 + 0.3 * kit.fbm(0.03, 2), 0, 1), [(0.0, "#3a2a22"), (1.0, "#5e4838")])
    alb = rock * inside[..., None] + joint * (1.0 - inside[..., None])
    alb = K.compress_chroma(alb, 0.65)

with core.timer("roughness"):
    rough = 0.88 + 0.04 * kit.fbm(0.1, 3) + 0.06 * cav_sharp - 0.05 * chips + 0.03 * crust - 0.04 * clay
    rough = rough * inside + 0.95 * (1.0 - inside)

kit.finish(height=h, albedo=alb, rough=rough, ao="cycles", ao_distance=0.03, ao_samples=32,
           description="Laterite block masonry (2 m): 0.6 x 0.3 m vesicular red-brown blocks with ochre and pale "
                       "clay-lined pits, manganese spots, chipped arrises, dry joints, dark crust patches.",
           preview="wall", preview_opts=dict(floor_band=None, samples=64))
