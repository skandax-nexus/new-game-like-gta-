"""
@asset lime_plaster_weathered
@kind material
@style materials:MATERIAL_PRESETS.lime_plaster_weathered, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS

Hand-troweled lime plaster on fired brick (class H, 3 m x 3 m tile, seamless). Fully periodic (no foot band): rising damp at
the wall foot is the model macro map's job (uv1) plus the decals_settlement damp strips; the set carries only
scattered damp patches with pale salt fringes.
Layers: trowel swirls and arcs (1.5 mm), lime-wash coats of slightly different whiteness, sand grain and pores,
craze cracks on 0.25 m cells (1 mm deep) plus a few long settlement cracks, ~6.5 % fallen finish coat (3 mm, grey
base render) whose larger cores (~1 %) go 8 mm deep through to the brick masonry (0.42 x 0.07 m bricks, lime joints) with ragged, undercut plaster edges, rain
streaks washing down from above, grime in cracks and at patch edges.
Target (MATERIAL_PRESETS.lime_plaster_weathered): average #e4dac6 (never above sRGB 236), roughness 0.86 (0.75-0.95).

Period notes: lime plaster over brick and timber is attested for Mauryan Pataliputra (Megasthenes' "timber and
brick" city) and later stupa domes; finish is hand-troweled, never machine-smooth; no cement, no paint.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
import _matkit as K  # noqa: E402

W = H = 3.0
kit = K.Kit(__file__, cls="H", size=(W, H), target="materials:MATERIAL_PRESETS.lime_plaster_weathered",
            family="limePlaster", channel_max_srgb=236)
x, y = kit.x, kit.y
vm = y * H  # meters above the wall foot (v up)

with core.timer("plaster relief"):
    # broad hand-trowel undulation + overlapping trowel sweeps (concentric arcs around random pivots)
    h = 0.0015 * kit.fbm(0.6, 3, gain=0.5)
    f1, f2, cid = kit.worley(0.42, 0.9)
    arcs = np.sin(2 * np.pi * (f1 * 0.42 / 0.055 + cid * 3.0))
    sweep = tg.smoothstep(0.0, 0.5, kit.fbm(0.35, 3)) * tg.smoothstep(0.75, 0.2, f1)
    h += 0.00012 * arcs * sweep * tg.smoothstep(0.0, 0.6, kit.fbm(0.2, 2))
    # trowel-edge ridges: thin ridges where sweeps overlap (cell borders of the sweep cells)
    h += 0.0003 * tg.smoothstep(0.06, 0.0, np.abs(f2 - f1 - 0.05)) * sweep
    # lime-wash coats: slightly raised, smoother areas
    coat = tg.smoothstep(0.0, 0.25, kit.fbm(0.5, 4))
    h += 0.0002 * coat
    # sand grain and pores
    h += 0.00012 * kit.fbm(0.004, 2) + 0.00006 * kit.fbm(0.0015, 1)
    pf1, _, pid = kit.worley(0.012, 1.0)
    pores = tg.smoothstep(0.32, 0.12, pf1) * (pid > 0.8)
    h -= 0.0004 * pores

with core.timer("cracks"):
    # craze cracks on ~0.25 m cells, gated so only part of the network shows
    cx, cy = kit.warp(0.02, 0.2, 2)
    c1, c2, ccid = kit.worley(0.25, 1.0, x=cx, y=cy)
    craze_gate = tg.smoothstep(0.05, 0.35, kit.fbm(0.8, 3)) * (ccid > 0.25)
    craze = tg.smoothstep(0.016, 0.0, c2 - c1) * craze_gate
    # long settlement cracks (sparse, wandering): borders of big warped cells, gated hard
    sx, sy = kit.warp(0.12, 0.5, 3)
    s1, s2, sid = kit.worley(1.0, 1.0, x=sx, y=sy)
    settle = tg.smoothstep(0.01, 0.0, s2 - s1) * tg.smoothstep(0.35, 0.6, kit.fbm(1.0, 3) * 0.5 + 0.5)
    crack = np.clip(craze * 0.8 + settle, 0.0, 1.0)
    h -= 0.001 * craze + 0.0018 * settle

with core.timer("fallen patches"):
    # ~6.5 % of the area has lost its lime finish coat (3 mm, revealing the coarse grey-buff base render); the cores
    # of the largest losses (~0.7 %) go through to the brick (8 mm). Losses cluster in 1-2 weathered zones per tile
    # (mixed scales inside) so the wall does not read as an even scatter of specks.
    # losses cluster (1-2 weathered zones per tile, 1.2 m features) instead of a uniform scatter of specks
    cluster = kit.fbm(1.2, 3)
    pn = 2.2 * cluster + 0.8 * kit.fbm(0.35, 4) + 0.25 * kit.fbm(0.08, 3) + 0.08 * kit.fbm(0.02, 2)
    thr = float(np.percentile(pn, 93.5))
    thr_deep = float(np.percentile(pn, 99.3))
    patch = tg.smoothstep(thr, thr + 0.015, pn)  # finish coat lost
    deep = tg.smoothstep(thr_deep, thr_deep + 0.015, pn)  # through to the brick
    edge = tg.smoothstep(thr - 0.05, thr, pn) * (1.0 - patch)  # loose, undercut rim around losses
    base_coat = -0.003 + 0.0006 * kit.fbm(0.01, 3)  # coarse sandy render
    # brick masonry under the render
    b = kit.bond(0.078, (0.43, 0.43), 0.008, stagger=0.5)
    bj = tg.smoothstep(0.0035, 0.0055, b["d"])  # 1 inside brick, 0 in the joint
    brick_h = -0.008 + 0.0025 * bj + 0.0006 * kit.fbm(0.02, 3) - 0.001 * (1.0 - bj)
    # remnant render crumbs on the brick face
    crumbs = tg.smoothstep(0.3, 0.55, kit.fbm(0.03, 3) * 0.5 + 0.5) * (1.0 - deep * 0.5)
    under = base_coat * (1.0 - deep) + deep * (brick_h + 0.003 * crumbs)
    h = h * (1.0 - patch) + patch * under
    h -= 0.0012 * edge * tg.smoothstep(0.3, 0.7, kit.fbm(0.02, 2) * 0.5 + 0.5)

with core.timer("albedo"):
    # warm off-white lime, coats of slightly different whiteness, faint ochre and grey clouds (+-3 %)
    t = 0.5 + 0.18 * kit.fbm(0.9, 4) + 0.12 * coat + 0.06 * kit.fbm(0.08, 3) + 0.04 * kit.fbm(0.01, 2)
    alb = K.ramp(t, [(0.0, "#d2c8b2"), (0.4, "#ddd3bf"), (0.7, "#e6ddca"), (1.0, "#ece4d3")])
    alb = K.tint(alb, "#d9c7a4", 0.25 * tg.smoothstep(0.1, 0.6, kit.fbm(1.2, 3)))  # ochre-tinged wash
    alb = K.mul(alb, 1.0 - 0.06 * pores)
    # brick and mortar in the fallen patches
    bid = b["id"]
    bt = np.clip(0.5 + 0.35 * (bid - 0.5) + 0.12 * kit.fbm(0.05, 3), 0, 1)
    brick = K.ramp(bt, [(0.0, "#6e3a2a"), (0.35, "#8a4e37"), (0.7, "#9c5a40"), (1.0, "#b0705a")])
    brick = K.tint(brick, "#c9bda6", 0.6 * (1.0 - bj))  # lime mortar joints
    brick = K.tint(brick, "#bfb39c", 0.75 * crumbs)  # render crumbs
    render_col = K.ramp(0.5 + 0.3 * kit.fbm(0.05, 3) + 0.15 * kit.fbm(0.006, 2), [(0.0, "#a89d88"), (0.5, "#bcb19b"), (1.0, "#cdc3ad")])
    under_col = render_col * (1.0 - deep[..., None]) + brick * deep[..., None]
    alb = alb * (1.0 - patch[..., None]) + under_col * patch[..., None]
    # grime: cracks, patch rims (dust and soot collect in the undercut), pores
    grime = np.clip(crack * 0.8 + edge * 0.45, 0, 1)
    alb = K.tint(alb, "#6b6253", 0.55 * grime)
    # rain streaks: vertical stretched noise washing down (darker grey, -10 %), plus lighter washed runs
    streak = tg.smoothstep(0.62, 0.9, kit.fbm(0.06, 3, aniso=(1.0, 25.0)) * 0.5 + 0.5)
    streak *= tg.smoothstep(0.0, 0.45, kit.fbm(0.8, 3))
    alb = K.mul(alb, 1.0 - 0.14 * streak * (1.0 - patch))
    alb = K.tint(alb, "#b8b09f", 0.12 * streak * (1.0 - patch))
    # damp patches (periodic - the tile repeats up tall walls): the rising-damp band at the wall foot comes from
    # the model macro map (uv1, ART_BIBLE §0.2 / ASSET_LIST §0.2) and the decals_settlement "damp_rising" strips
    damp = tg.smoothstep(0.6, 0.85, kit.fbm(0.45, 4) * 0.5 + 0.5) * 0.6
    salt = tg.smoothstep(0.03, 0.0, np.abs(kit.fbm(0.45, 4) * 0.5 + 0.5 - 0.6)) * tg.smoothstep(-0.2, 0.4, kit.fbm(0.15, 3)) * 0.5
    alb = K.tint(alb, "#b9b09a", 0.45 * damp)
    alb = K.tint(alb, "#8f8f78", 0.12 * damp * tg.smoothstep(0.0, 0.6, kit.fbm(0.2, 3) * 0.5 + 0.5))
    alb = K.tint(alb, "#efeadf", 0.3 * salt * (1.0 - patch))

with core.timer("roughness"):
    rough = 0.86 + 0.03 * kit.fbm(0.3, 3) - 0.03 * coat + 0.04 * pores + 0.05 * crack
    rough = rough - 0.09 * damp + 0.04 * salt
    rough = rough * (1.0 - patch) + patch * ((0.92 * (1.0 - deep)) + deep * (0.84 + 0.06 * (1.0 - bj)))

kit.finish(height=h, albedo=alb, rough=rough, ao="cycles", ao_distance=0.03, ao_samples=48,
           description="Weathered hand-troweled lime plaster (3 m): trowel sweeps, craze and settlement cracks, "
                       "fallen finish coat over brick, rain streaks, damp patches with salt fringes.",
           preview="wall", preview_opts=dict(floor_band=None, samples=64))
