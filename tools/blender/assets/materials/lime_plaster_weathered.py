"""
@asset lime_plaster_weathered
@kind material
@style materials:MATERIAL_PRESETS.lime_plaster_weathered, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS

Hand-troweled lime plaster on fired brick (class H, 3 m x 3 m tile, seamless). Fully periodic (no foot band, no
large brick-revealing losses): rising damp, big losses and brick exposures are the model macro map's job (uv1) and
decals_settlement's (damp strips, plaster cracks), so nothing in the tile is salient enough to repeat visibly.
Layers (all readable at 1-3 m under raking light):
- overlapping TROWEL STROKES: arc bands 9-13 cm wide around random pivots, each with a slightly dished face, a
  1-1.5 mm ridge of squeezed-out lime along its trailing edge and fine drag lines of sand along the stroke; later
  strokes overlap earlier ones; broad hand-laid undulation underneath;
- lime-wash coats of slightly different whiteness (faint), sand grain and pores;
- craze cracks on ~0.25 m cells (1 mm deep), a few faint hairline settlement cracks;
- ~8 % LOSSES at three scales (flakes bounded by the crack net: 10-25 cm, 4-10 cm, 2-4 cm), evenly spread, partly
  spalled with ragged, undercut, grimy rims: the finish coat gone to the coarse grey-buff base render (3 mm), the largest few to the scratch coat
  (6 mm, coarse aggregate);
- RAIN STREAKS washing down (-10 % value, 2-8 cm wide, 0.5-2 m long) with paler washed runs between them;
- small damp patches with pale salt fringes (faint).
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
    # broad hand-laid undulation (2-3 mm over 0.3-0.8 m)
    h = 0.0012 * kit.fbm(0.7, 3, gain=0.5) + 0.0005 * kit.fbm(0.25, 2)

    # overlapping trowel strokes: three passes of arc bands; a later pass covers earlier strokes where they overlap
    def stroke(lu, lv, e1, e2):
        r0 = 0.1 + 0.3 * e2
        w = 0.09 + 0.04 * e1
        r = np.sqrt(lu * lu + lv * lv)
        th = np.arctan2(lv, lu)
        ext = 0.55 + 0.75 * e1  # half angle (rad)
        inside = (r > r0) & (r < r0 + w) & (np.abs(th) < ext)
        return np.where(inside, 1.0 + e1, -1e9)

    tro = np.zeros_like(x)
    ridge = np.zeros_like(x)
    covered = np.zeros_like(x)
    for k, cell in enumerate((0.5, 0.6, 0.43)):
        sc = kit.scatter(cell, stroke, density=0.95)
        m = sc.mask
        r = np.sqrt(sc.lu ** 2 + sc.lv ** 2)
        th = np.arctan2(sc.lv, sc.lu)
        r0 = 0.1 + 0.3 * sc.e2
        w = 0.09 + 0.04 * sc.e1
        ext = 0.55 + 0.75 * sc.e1
        t = np.clip((r - r0) / w, 0.0, 1.0)
        endf = tg.smoothstep(ext, ext - 0.35, np.abs(th))  # strokes feather out at their ends
        # AD-10: BROKEN arcs - the trowel lifts and skips, so no stroke reads as a circle
        brk = tg.smoothstep(-0.15, 0.35, np.sin(th * (2.0 + 3.0 * sc.e1) + 6.28 * sc.e2) + 0.6 * kit.fbm(0.08, 2))
        endf = endf * brk
        # flip the ridge side per stroke (pushed outwards or inwards)
        tt = np.where(sc.e2 > 0.5, t, 1.0 - t)
        prof = (-0.0005 * np.sin(np.pi * t) + 0.0009 * np.exp(-((tt - 0.95) / 0.12) ** 2)) * endf
        drag = 0.00008 * np.sin(2 * np.pi * r / 0.0023 + 6.0 * kit.fbm(0.05, 2)) * endf
        val = prof + drag
        tro = np.where(m > 0, val, tro)
        ridge = np.where(m > 0, np.exp(-((tt - 0.95) / 0.12) ** 2) * endf, ridge)
        covered = np.maximum(covered, m * endf)
    h += tro * (0.75 + 0.25 * tg.smoothstep(-0.3, 0.4, kit.fbm(0.9, 2)))
    # lime-wash coats: slightly raised, smoother areas (faint, mid scale)
    coat = tg.smoothstep(0.0, 0.25, kit.fbm(0.4, 4))
    h += 0.00015 * coat
    # sand grain and pores
    h += 0.00012 * kit.fbm(0.004, 2) + 0.00006 * kit.fbm(0.0015, 1)
    pf1, _, pid = kit.worley(0.012, 1.0)
    pores = tg.smoothstep(0.32, 0.12, pf1) * (pid > 0.8)
    h -= 0.0004 * pores

with core.timer("cracks"):
    # craze cracks on ~0.25 m cells, gated so only part of the network shows
    cx, cy = kit.warp(0.02, 0.2, 2)
    c1, c2, ccid = kit.worley(0.25, 1.0, x=cx, y=cy)
    craze_gate = tg.smoothstep(0.1, 0.4, kit.fbm(0.6, 3)) * (ccid > 0.3)
    craze = tg.smoothstep(0.014, 0.0, c2 - c1) * craze_gate
    # a few settlement cracks: OPEN-ENDED wandering lines 0.6-1.6 m (never closed loops); `near` (0..1 within
    # ~0.25 m of a crack) clusters the losses along them (AD-10)
    def crack_shape(lu, lv, e1, e2):
        L = 0.6 + 1.0 * e2
        t = lu / (0.5 * L)
        cv = lv - 0.08 * L * (e1 - 0.5) * (1.0 - t * t)
        p = 1.0 - np.abs(cv) / 0.25
        return np.where((np.abs(t) < 1.0) & (p > 0.0), p * np.sqrt(np.clip(1.0 - t ** 4, 0.0, 1.0)), -1e9)

    sx, sy = kit.warp(0.06, 0.25, 3)
    scr = kit.scatter(0.85, crack_shape, density=0.55, x=sx, y=sy)
    near_p = np.where(scr.h > -1e5, scr.h, 0.0).astype(np.float32)
    settle = tg.smoothstep(1.0 - 0.0035 / 0.25, 1.0 - 0.0008 / 0.25, near_p) * (0.5 + 0.5 * tg.smoothstep(-0.3, 0.3, kit.fbm(0.4, 2)))
    crack = np.clip(craze * 0.8 + settle * 0.7, 0.0, 1.0)
    h -= 0.001 * craze + 0.0012 * settle

with core.timer("losses"):
    # AD-10: losses have a MACRO distribution - clean zones over ~60 % of the wall, loss zones (0.8-2 m) clustered
    # along the settlement cracks; inside them flakes 3-25 cm bounded by the crack net (sub-3 cm flakes dropped).
    # Two-step depth: the finish coat goes to a 2-3 mm buff-grey lime undercoat (with a chipped, raised, light-catching
    # rim), and in the largest losses (~1/3 of the loss area) the undercoat has gone too, exposing the fired brick
    # courses 8 mm deep. Total loss 5-12 % (solved).
    zone = tg.smoothstep(0.45, 0.62, kit.fbm(0.9, 3) * 0.5 + 0.5 + 0.08 * kit.fbm(0.4, 2))  # weathered zones (several per tile)
    near = near_p ** 2  # 1 on a settlement crack, 0 beyond ~0.25 m
    pfield = zone * (0.4 + 0.8 * near) + 0.2 * kit.fbm(0.22, 3)
    # flake nets: the loss edge follows flake polygons (per-flake random offset), so patches are connected, ragged
    # and polygonal, with a few detached flakes at their margins - not confetti
    jit = np.zeros_like(x)
    for cell_m, amp in ((0.12, 0.3), (0.06, 0.16)):
        wx_, wy_ = kit.warp(cell_m * 0.18, cell_m * 0.8, 2)
        f1, f2, rid = kit.worley(cell_m, 0.95, x=wx_, y=wy_)
        jit += amp * (rid - 0.5)
    score = pfield + jit + 0.03 * kit.fbm(0.015, 2)
    thr = float(np.percentile(score, 100.0 * (1.0 - 0.085)))  # 8.5 % of the wall
    loss = tg.smoothstep(thr - 0.004, thr + 0.004, score).astype(np.float32)
    # drop flakes under ~3 cm (opening: blur, then re-threshold); the lost area is re-solved below
    lo_ = kit.blur(loss, 0.008)
    thr2 = float(np.percentile(lo_, 100.0 * (1.0 - 0.085)))
    loss = tg.smoothstep(max(thr2, 0.45) - 0.05, max(thr2, 0.45) + 0.05, lo_).astype(np.float32)
    loss_size = kit.blur(loss, 0.1)  # local loss density ~ patch size
    # brick: in the interior of the large patches only (eroded mask), and only in part of them
    # brick share solved to ~1/3 of the loss area, in the interior of the large patches (eroded mask)
    bscore = kit.blur(loss, 0.05) + 0.08 * kit.fbm(0.15, 3)  # interiors of the LARGER patches only
    inside = loss > 0.5
    bthr = float(np.percentile(bscore[inside], 100.0 * (1.0 - 0.33))) if inside.any() else 9.0
    deep = (bscore > bthr).astype(np.float32) * loss
    deep = np.clip(kit.blur(deep, 0.003) * 1.6, 0, 1) * loss
    b = kit.bond(0.075, (0.22, 0.3), 0.012, stagger=0.5)
    mortar = tg.smoothstep(0.009, 0.004, b["d"])  # raked, recessed lime mortar joints between brick courses
    brick_h = -0.008 - 0.004 * mortar + 0.0008 * kit.fbm(0.01, 2) + 0.0006 * (b["id"] - 0.5)
    # undercoat: 2.5 mm below the finish, coarse sandy surface
    under_h = -0.0025 + 0.0004 * kit.fbm(0.01, 3) + 0.0002 * kit.fbm(0.003, 2)
    under = under_h * (1.0 - deep) + brick_h * deep
    # chipped raised rim: the finish coat curls / lifts 0.4 mm along the loss edge and is chipped back to fresh lime
    ring = kit.blur(loss, 0.006)
    edge = tg.smoothstep(0.02, 0.35, ring) * (1.0 - loss)
    chip = edge * tg.smoothstep(0.2, 0.6, kit.fbm(0.02, 2) * 0.5 + 0.5)
    h = h * (1.0 - loss) + loss * under
    h += 0.0004 * edge - 0.0005 * chip * tg.smoothstep(0.5, 0.0, ring)
    core.log(f"loss coverage {float(loss.mean(dtype=np.float64)):.3f}, brick {float(deep.mean(dtype=np.float64)):.4f}, "
             f"clean-zone share {float((kit.blur(loss, 0.3) < 0.01).mean()):.2f}")
    patch = loss

with core.timer("albedo"):
    # warm off-white lime, coats of slightly different whiteness, faint ochre and grey clouds (+-2 %)
    t = 0.5 + 0.1 * kit.fbm(0.9, 4) + 0.1 * coat + 0.07 * kit.fbm(0.08, 3) + 0.05 * kit.fbm(0.01, 2)
    alb = K.ramp(t, [(0.0, "#d2c8b4"), (0.4, "#ddd4c1"), (0.7, "#e6decc"), (1.0, "#ece5d4")])
    alb = K.tint(alb, "#dccdb0", 0.15 * tg.smoothstep(0.1, 0.6, kit.fbm(1.0, 3)))  # ochre-tinged wash
    alb = K.mul(alb, 1.0 - 0.06 * pores)
    alb = K.mul(alb, 1.0 + 0.03 * ridge - 0.02 * covered * (1.0 - ridge))  # fresh lime on the stroke ridges
    render_col = K.ramp(0.5 + 0.3 * kit.fbm(0.05, 3) + 0.15 * kit.fbm(0.006, 2), [(0.0, "#ada390"), (0.5, "#bcb39f"), (1.0, "#cbc2ae")])
    # exposed fired brick (#9c5a40) with per-brick tone, lime mortar and lime residue clinging to the brick faces
    btone = np.clip(0.5 + 0.5 * (b["id"] - 0.5) + 0.15 * kit.fbm(0.03, 2), 0, 1)
    brick_col = K.ramp(btone, [(0.0, "#8a4e38"), (0.5, "#9c5a40"), (1.0, "#ab6a4c")])
    brick_col = K.tint(brick_col, "#b9af9a", 0.55 * mortar)
    brick_col = K.tint(brick_col, "#c4baa4", 0.45 * tg.smoothstep(0.45, 0.8, kit.fbm(0.03, 3) * 0.5 + 0.5))  # lime residue
    brick_col = K.tint(brick_col, "#5e4a3e", 0.25 * tg.smoothstep(-0.2, 0.5, kit.fbm(0.08, 2)))  # grime, weathered faces
    under_col = render_col * (1.0 - deep[..., None]) + brick_col * deep[..., None]
    alb = alb * (1.0 - patch[..., None]) + under_col * patch[..., None]
    # grime: cracks, loss rims (dust and soot collect in the undercut)
    grime = np.clip(crack * 0.75 + 0.25 * edge * (1.0 - chip), 0, 1)
    alb = K.tint(alb, "#6b6253", 0.5 * grime)
    alb = K.tint(alb, "#efe9dc", 0.5 * chip)  # chipped rim: fresh lime catches the light
    # rain streaks: -10 % value runs 2-8 cm wide, 0.5-2 m long, washing down; paler washed runs between them
    sn = kit.fbm(0.05, 3, aniso=(1.0, 22.0)) * 0.5 + 0.5
    streak = tg.smoothstep(0.55, 0.78, sn) * tg.smoothstep(-0.25, 0.35, kit.fbm(0.7, 3))
    streak = np.clip(tg.directional_blur_down(streak, int(kit.px(0.15)), 0.97) * 1.2, 0, 1)
    washed = tg.smoothstep(0.35, 0.18, sn) * tg.smoothstep(-0.1, 0.5, kit.fbm(0.8, 3))
    alb = K.mul(alb, 1.0 - 0.1 * streak * (1.0 - 0.5 * patch))
    alb = K.tint(alb, "#a89f8d", 0.08 * streak * (1.0 - patch))
    alb = K.tint(alb, "#ece6d8", 0.25 * washed * (1.0 - patch))
    # small damp patches with salt fringes (faint: the big damp zones are the macro map's / decals')
    dn = kit.fbm(0.3, 4) * 0.5 + 0.5
    damp = tg.smoothstep(0.68, 0.85, dn) * 0.5
    salt = tg.smoothstep(0.025, 0.0, np.abs(dn - 0.68)) * tg.smoothstep(-0.2, 0.4, kit.fbm(0.15, 3)) * 0.4
    alb = K.tint(alb, "#bdb49f", 0.35 * damp)
    alb = K.tint(alb, "#efeadf", 0.25 * salt * (1.0 - patch))

with core.timer("roughness"):
    rough = 0.86 + 0.03 * kit.fbm(0.3, 3) - 0.03 * coat + 0.04 * pores + 0.05 * crack
    rough = rough - 0.09 * damp + 0.04 * salt
    rough = rough - 0.04 * ridge + 0.03 * streak
    rough = rough * (1.0 - patch) + patch * (0.92 * (1.0 - deep) + 0.9 * deep)

kit.finish(height=h, albedo=alb, rough=rough, ao="cycles", ao_distance=0.03, ao_samples=48,
           description="Weathered hand-troweled lime plaster (3 m): overlapping trowel strokes with lime ridges, craze "
                       "cracks, ~8 % multi-scale losses to the base render, rain streaks, faint damp with salt fringes.",
           preview="wall", preview_opts=dict(floor_band=None, samples=64))
