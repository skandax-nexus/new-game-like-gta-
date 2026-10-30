"""
@asset brick_fired_old
@kind material
@style materials:MATERIAL_PRESETS.brick_fired_old, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS

Aged fired brick masonry (class S, 2 m x 2 m tile, seamless): large flat period bricks (0.42 x 0.26 x 0.07 m:
stretcher faces 0.42 m and header faces 0.26 m mixed irregularly along each course), 8 mm lime joints recessed
3 mm and eroded deeper in places, worn and chipped arrises, slight pillowing, firing cracks. Per-brick value
+-8 %, ~6 % overfired dark bricks (glossier, near-black spots), ~8 % underfired pale bricks, lime smears on brick
edges, efflorescence (white salt bloom) and soot in damp zones. Fully periodic: the foot band (salt, soot,
rising damp) belongs to the model macro map (uv1) and decals_settlement.
Target (MATERIAL_PRESETS.brick_fired_old): average #9c5a40, roughness 0.84 (0.70-0.95).

Period notes: burnt brick of this large flat format is typical of Mauryan-Shunga sites (Pataliputra, Kausambi,
Sanchi monastery walls: c. 40-45 x 25-28 x 6-8 cm); lime or mud mortar, no cement, no machine-pressed bricks.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
import _matkit as K  # noqa: E402

W = H = 2.0
kit = K.Kit(__file__, cls="S", size=(W, H), target="materials:MATERIAL_PRESETS.brick_fired_old",
            family="brickTerracotta", saturation_limit="large")
vm = kit.y * H

with core.timer("bond"):
    # 26 courses in 2 m: 69 mm brick + 8 mm joint; stretchers and headers mixed along each course
    b = kit.bond(2.0 / 26.0, (0.26, 0.43), 0.008, stagger=None, choices=[0.43, 0.43, 0.27], choice_jitter=0.03)
    joint_half = 0.004
    d = b["d"] - joint_half  # distance from the brick edge (negative inside the joint)
    inside = tg.smoothstep(-0.0005, 0.0008, d)
    bid = b["id"]
    over = (bid * 13.37 % 1.0) < 0.06  # overfired
    under = ((bid * 7.91 % 1.0) < 0.08) & ~over  # underfired

with core.timer("relief"):
    # brick face: slight pillow + tilt per brick, worn rounded arris (r 6 mm), chips, pits, firing cracks
    pill = 0.0012 * np.clip(1.0 - (np.abs(b["lu"] - 0.5) * 2) ** 4, 0, 1) * np.clip(1.0 - (np.abs(b["lv"] - 0.5) * 2) ** 4, 0, 1)
    tilt = 0.0015 * (((bid * 5.3) % 1.0) - 0.5) * (b["lu"] - 0.5) + 0.001 * (((bid * 2.9) % 1.0) - 0.5) * (b["lv"] - 0.5)
    # weathered arrises: radius varies along the edge (soft, eroded corners, never machine-crisp)
    erode_r = 0.006 + 0.016 * (kit.fbm(0.06, 3) * 0.5 + 0.5)  # eroded arris radius 6-22 mm along the edge
    # rounded arris with a per-texel radius (Kit.edge_round takes a scalar radius)
    t_ar = np.clip(np.maximum(d - 0.003 * (kit.fbm(0.03, 3) * 0.5 + 0.5), 0.0) / erode_r, 0.0, 1.0)
    arris = (-0.0055 * (1.0 - np.sqrt(np.clip(1.0 - (1.0 - t_ar) ** 2, 0.0, 1.0)))).astype(np.float32)
    chipn = kit.fbm(0.03, 4)
    chips = tg.smoothstep(0.1, 0.4, chipn) * tg.smoothstep(0.035, 0.0, np.maximum(d, 0.0))
    # weathered face: sanded grain, clay inclusions, irregular pores (never a regular dot pattern)
    face = 0.0007 * kit.fbm(0.05, 3) + 0.0003 * kit.fbm(0.006, 2) + 0.00015 * kit.fbm(0.002, 1)
    pores = tg.smoothstep(0.62, 0.8, kit.fbm(0.008, 2) * 0.5 + 0.5 + 0.15 * kit.fbm(0.05, 2))
    pits = pores
    face -= 0.0007 * pores
    incl = tg.smoothstep(0.7, 0.85, kit.fbm(0.012, 2) * 0.5 + 0.5)  # pale lime / grog inclusions
    cf1, cf2, ccid = kit.worley(0.12, 1.0, x=kit.warp(0.01, 0.05, 2)[0])
    fcrack = tg.smoothstep(0.012, 0.0, cf2 - cf1) * (ccid > 0.7) * tg.smoothstep(0.2, 0.5, kit.fbm(0.3, 2) * 0.5 + 0.5)
    face -= 0.0012 * fcrack
    brick_h = pill + tilt + arris + face - 0.004 * chips * (0.5 + 0.5 * chipn)
    # mortar: recessed 3 mm, sandy, eroded deeper (5-6 mm) in patches
    erode = tg.smoothstep(0.0, 0.5, kit.fbm(0.25, 3))
    mortar_h = -0.003 - 0.0025 * erode + 0.0005 * kit.fbm(0.004, 2)
    h = mortar_h + (brick_h - mortar_h) * inside
    h = np.maximum(h, mortar_h)

with core.timer("albedo"):
    t = np.clip(0.5 + 0.55 * (bid - 0.5) + 0.12 * kit.fbm(0.08, 3) + 0.06 * kit.fbm(0.015, 2), 0, 1)
    brick = K.ramp(t, [(0.0, "#7c4230"), (0.3, "#8f4f38"), (0.6, "#a05e43"), (1.0, "#b36f52")])
    # per-brick value +-8 % and a slight hue walk (some bricks more orange, some more purple-brown)
    brick = K.mul(brick, 1.0 + 0.16 * (((bid * 3.17) % 1.0) - 0.5))
    brick = K.hue_rotate(brick, 0.03 * (((bid * 9.73) % 1.0) - 0.5))
    # firing mottle inside a brick (flashing): darker patches toward one end
    flash = tg.smoothstep(0.1, 0.7, kit.fbm(0.12, 3) * 0.5 + 0.5 + 0.3 * (b["lu"] - 0.5) * (((bid * 4.1) % 1.0) - 0.5) * 4)
    brick = K.mul(brick, 1.0 - 0.15 * flash)
    # overfired: dark purple-brown with near-black vitrified spots; underfired: pale salmon
    dark = K.ramp(np.clip(0.5 + 0.4 * kit.fbm(0.05, 3), 0, 1), [(0.0, "#4a2820"), (0.5, "#6e3a2a"), (1.0, "#7e4836")])
    spots = tg.smoothstep(0.6, 0.85, kit.fbm(0.012, 2) * 0.5 + 0.5)
    dark = K.tint(dark, "#2a1d19", 0.6 * spots)
    pale = K.ramp(np.clip(0.5 + 0.4 * kit.fbm(0.05, 3), 0, 1), [(0.0, "#a8705a"), (1.0, "#c58c6c")])
    brick = np.where(over[..., None], dark, np.where(under[..., None], pale, brick))
    brick = K.mul(brick, 1.0 - 0.25 * pits - 0.4 * fcrack)
    brick = K.tint(brick, "#c79a7c", 0.35 * incl)
    # fresh, paler fired clay where chipped
    brick = K.tint(brick, "#b8785a", 0.35 * chips)
    # lime mortar: warm grey-white, darker where eroded, dirt; lime smears onto brick edges
    mortar = K.ramp(np.clip(0.5 + 0.3 * kit.fbm(0.03, 3) - 0.35 * erode + 0.15 * kit.fbm(0.004, 2), 0, 1),
                    [(0.0, "#5e5548"), (0.5, "#857b69"), (1.0, "#a69b85")])
    smear = tg.smoothstep(0.012, 0.0, np.maximum(d, 0.0)) * tg.smoothstep(0.2, 0.55, kit.fbm(0.04, 3) * 0.5 + 0.5)
    brick = K.tint(brick, "#c2b49b", 0.45 * smear)
    alb = mortar * (1.0 - inside[..., None]) + brick * inside[..., None]
    # efflorescence (white salt bloom) and soot near the foot, washed-out streaks from joints above
    # (kept soft: a 2 m tile repeats up tall walls - strong foot bands belong in the model macro map / decals)
    foot = tg.smoothstep(0.45, 0.8, kit.fbm(0.6, 3) * 0.5 + 0.5)  # damp zones (periodic; the foot band is the macro map's)
    bloom = (0.6 + 0.4 * foot) * tg.smoothstep(0.35, 0.7, kit.fbm(0.08, 4) * 0.5 + 0.5 + 0.2 * kit.fbm(0.5, 2))
    alb = K.tint(alb, "#d8d2c3", 0.25 * bloom)
    soot = (0.4 + 0.6 * foot) * tg.smoothstep(0.0, 0.5, kit.fbm(0.4, 3))
    alb = K.mul(alb, 1.0 - 0.12 * soot)
    # grey dust / soot patina settling on the brick faces, vertical soot streaks
    patina = tg.smoothstep(0.3, 0.8, kit.fbm(0.3, 3) * 0.5 + 0.5)
    alb = K.tint(alb, "#7a6a5e", 0.18 * patina)
    runs = tg.smoothstep(0.65, 0.9, kit.fbm(0.05, 3, aniso=(1.0, 14.0)) * 0.5 + 0.5) * tg.smoothstep(0.0, 0.5, kit.fbm(0.6, 2))
    alb = K.tint(alb, "#b9ab95", 0.18 * runs)
    # gentle large-scale variation (patches of darker, dirtier wall) - kept low for the 2 m repeat
    alb = K.mul(alb, 1.0 + 0.05 * kit.fbm(0.7, 3))
    # weathered brick is dull: keep 60 % of the per-pixel chroma scatter (no fresh-from-the-kiln orange pops)
    alb = K.compress_chroma(alb, 0.5)

with core.timer("roughness"):
    r_b = 0.84 + 0.05 * (((bid * 6.1) % 1.0) - 0.5) + 0.03 * kit.fbm(0.05, 2) - 0.16 * over + 0.04 * under
    r_m = 0.93 + 0.02 * kit.fbm(0.02, 2)
    rough = r_m * (1.0 - inside) + r_b * inside + 0.03 * bloom - 0.04 * soot

kit.finish(height=h, albedo=alb, rough=rough, ao="cycles", ao_distance=0.025, ao_samples=48,
           description="Aged fired brick (2 m): flat 0.42/0.26 x 0.07 m bricks, recessed lime joints, overfired and "
                       "underfired bricks, chipped arrises, efflorescence and soot in damp zones.",
           preview="wall", preview_opts=dict(floor_band=None, samples=64))
