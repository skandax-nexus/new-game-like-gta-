"""
@asset bamboo_lattice
@kind material
@style materials:MATERIAL_PRESETS.bamboo_lattice, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS

Bamboo poles, coir lashing and split-lath weave as a TRIM SHEET (class S, 1.5 m x 1.5 m, seamless in u; trims
listed in metadata.trims / the manifest, v from the bottom):
    pole_a / pole_b / pole_c   0.175 m each   culm skins unwrapped: u = along the pole, v = around it (the band
                                               height is the circumference of a 5.6 cm culm; scale v for 4-8 cm);
                                               nodes every 0.3-0.4 m, sheath scars, striations, glossy skin
    lashing                    0.15 m         coir rope coils running ACROSS u (wrap a pole joint's u range)
    weave                      0.825 m        2/2 twill of 25 mm split laths (chatai) for fences, screens, cart
                                               canopies; tiles in u, and in v on its own 0.825 m band
Colour: straw-tan culms (#b39a63 average) with darker nodes, sun-bleached #c4b07a skins, grey weathering, black
mould specks; laths show the glossy outer skin and, where twisted, the paler matte pith.
Target (MATERIAL_PRESETS.bamboo_lattice): average #b39a63, roughness 0.55 (0.40-0.75).

Period notes: bamboo scaffolds lashed with coir / munj rope and woven split-bamboo mats are ancient and universal
in the Gangetic plain and the eastern forests; no metal fasteners.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
import _matkit as K  # noqa: E402

W = H = 1.5
kit = K.Kit(__file__, cls="S", size=(W, H), target="materials:MATERIAL_PRESETS.bamboo_lattice", family="timber",
            saturation_limit="medium")
x, y = kit.x, kit.y
u = x * W
v = y * H
POLE = 0.175
BANDS = [("pole_a", 0.0, POLE), ("pole_b", POLE, 2 * POLE), ("pole_c", 2 * POLE, 3 * POLE),
         ("lashing", 3 * POLE, 3 * POLE + 0.15), ("weave", 3 * POLE + 0.15, H)]
h = np.zeros(x.shape, np.float32)
alb = np.zeros(x.shape + (3,), np.float32)
rough = np.zeros(x.shape, np.float32)

with core.timer("poles"):
    for i, (name, v0, v1) in enumerate(BANDS[:3]):
        sel = (v >= v0) & (v < v1)
        t = (v - v0) / (v1 - v0)  # 0..1 around the culm (periodic: seam-free on a cylinder)
        # nodes: 4-5 per 1.5 m with jitter (spacing 0.3-0.4 m)
        n_nodes = 4 + (i % 2)
        base = np.arange(n_nodes) * (W / n_nodes) + kit.rng.uniform(0, W)
        nodes = np.sort((base + kit.rng.uniform(-0.035, 0.035, n_nodes)) % W)
        ext = np.concatenate([nodes - W, nodes, nodes + W])
        idx = np.searchsorted(ext, u, side="right") - 1
        dn = np.minimum(u - ext[idx], ext[np.minimum(idx + 1, len(ext) - 1)] - u)  # distance to nearest node (m)
        sgn = np.where(u - ext[idx] < ext[np.minimum(idx + 1, len(ext) - 1)] - u, 1.0, -1.0)  # above / below
        seg_id = ((idx % n_nodes) * 0.618 + i * 0.37) % 1.0
        node_ridge = 0.0022 * np.exp(-((dn / 0.004) ** 2))  # raised node ring
        sheath = 0.0007 * tg.smoothstep(0.012, 0.004, dn) * (sgn > 0)  # sheath scar band above the node
        groove = -0.0006 * np.exp(-(((dn - 0.008) / 0.003) ** 2)) * (sgn < 0)
        # longitudinal striations (along u) - periodic in t
        stri = kit.fbm(0.003, 2, x=x, y=t, aniso=(60.0, 1.0)) * 0.00012
        swell = 0.0006 * np.sin(np.pi * np.clip(dn / 0.2, 0, 1))  # internodes bulge slightly
        hp = node_ridge + sheath + groove + stri + swell + 0.00008 * kit.fbm(0.002, 1, x=x, y=t)
        # colour: per-segment tone, bleached sun side, darker nodes, mould specks, grey weathering
        tt = np.clip(0.5 + 0.35 * (seg_id - 0.5) + 0.15 * kit.fbm(0.08, 3, x=x, y=t, aniso=(6.0, 1.0)), 0, 1)
        col = K.ramp(tt, [(0.0, "#8f7a4c"), (0.4, "#aa915c"), (0.75, "#bba36c"), (1.0, "#c9b47e")])
        sun = tg.smoothstep(0.2, 0.8, 0.5 + 0.5 * np.cos(2 * np.pi * (t - 0.25 - 0.2 * i)))
        col = K.tint(col, "#c4b07a", 0.35 * sun)
        col = K.tint(col, "#5a4630", 0.65 * np.exp(-((dn / 0.006) ** 2)))
        col = K.tint(col, "#8a8170", 0.3 * tg.smoothstep(0.1, 0.6, kit.fbm(0.15, 3, x=x, y=t)))
        mould = tg.smoothstep(0.62, 0.85, kit.fbm(0.006, 2, x=x, y=t) * 0.5 + 0.5) * tg.smoothstep(0.0, 0.5, kit.fbm(0.2, 2, x=x, y=t))
        col = K.tint(col, "#2e2a24", 0.6 * mould)
        col = K.mul(col, 1.0 + 0.08 * kit.fbm(0.006, 3, x=x, y=t, aniso=(50.0, 1.0)))  # long skin streaks
        # waxy white bloom just below each node, brown sheath remnants above it
        col = K.tint(col, "#d8d0b8", 0.35 * tg.smoothstep(0.03, 0.006, dn) * (sgn < 0) * tg.smoothstep(0.3, 0.7, kit.fbm(0.01, 2, x=x, y=t) * 0.5 + 0.5))
        col = K.tint(col, "#7a6040", 0.4 * tg.smoothstep(0.02, 0.006, dn) * (sgn > 0))
        rp = 0.45 + 0.08 * kit.fbm(0.1, 2, x=x, y=t) + 0.15 * np.exp(-((dn / 0.008) ** 2)) + 0.2 * mould + 0.08 * (1.0 - sun)
        h = np.where(sel, hp, h)
        alb = np.where(sel[..., None], col, alb)
        rough = np.where(sel, rp, rough)

with core.timer("lashing"):
    name, v0, v1 = BANDS[3]
    sel = (v >= v0) & (v < v1)
    t = (v - v0) / (v1 - v0)
    pitch = W / 166.0  # ~9 mm coils across u
    cu = (u % pitch) / pitch - 0.5
    coil = np.sqrt(np.clip(1.0 - (cu * 2.0) ** 2, 0.0, 1.0))
    ply = 0.5 + 0.5 * np.sin(2 * np.pi * (u / 0.0045 + t * 0.15 * H / 0.0045))  # 3-ply twist at ~45 deg
    hairs = kit.fbm(0.0015, 2, x=x, y=t)
    hl = 0.004 * coil * (0.8 + 0.2 * ply) + 0.0002 * hairs
    tl = np.clip(0.5 + 0.3 * (ply - 0.5) + 0.2 * kit.fbm(0.03, 3, x=x, y=t) + 0.15 * hairs, 0, 1)
    coir = K.ramp(tl, [(0.0, "#3e2f1f"), (0.5, "#6a5233"), (1.0, "#8a6c45")])
    coir = K.mul(coir, 0.55 + 0.45 * coil)
    h = np.where(sel, hl, h)
    alb = np.where(sel[..., None], coir, alb)
    rough = np.where(sel, 0.85 + 0.05 * hairs, rough)

with core.timer("weave"):
    name, v0, v1 = BANDS[4]
    sel = (v >= v0) & (v < v1)
    vb = v - v0
    nu, nv = 60, 32  # laths across u / v; 2/2 twill repeats every 4 -> band tiles in u and in v
    cw_u, cw_v = W / nu, (v1 - v0) / nv
    iu = np.floor(u / cw_u).astype(np.int64)
    iv = np.floor(vb / cw_v).astype(np.int64)
    fu = u / cw_u - iu
    fv = vb / cw_v - iv
    warp_top = ((iu + iv) % 4) < 2  # warp laths (running along v) on top
    across = np.where(warp_top, fu, fv)  # across the visible lath
    along = np.where(warp_top, fv, fu)  # along it
    lath_id = np.where(warp_top, (iu * 0.618) % 1.0, (iv * 0.381 + 0.5) % 1.0)
    # rounded lath cross-section, 1.5 mm gaps between laths, dips where the lath dives under its neighbour
    prof = np.sqrt(np.clip(1.0 - ((across - 0.5) * 2.0) ** 2, 0.0, 1.0))
    gap = tg.smoothstep(0.06, 0.0, np.minimum(across, 1.0 - across))
    # the visible lath rises over 2 cells: height peaks in the middle of its float
    run = np.where(warp_top, ((iu + iv) % 4) == 1, ((iu + iv) % 4) == 3)
    float_pos = np.where(run, along * 0.5 + 0.5, along * 0.5)
    hw = 0.0014 * prof + 0.0012 * np.sin(np.pi * float_pos) - 0.0025 * gap
    fib = kit.fbm(0.002, 2, x=x, y=y, aniso=(1.0, 1.0))
    dir_fib = np.where(warp_top, kit.fbm(0.002, 2, aniso=(1.0, 25.0)), kit.fbm(0.002, 2, aniso=(25.0, 1.0)))
    hw += 0.00012 * dir_fib
    pith = (((lath_id * 7.7) % 1.0) < 0.08)  # a few laths turned pith-side up
    tw = np.clip(0.5 + 0.4 * (lath_id - 0.5) + 0.15 * dir_fib + 0.08 * kit.fbm(0.1, 3), 0, 1)
    skin = K.ramp(tw, [(0.0, "#94804f"), (0.5, "#b39a63"), (1.0, "#c8b27a")])
    pithc = K.ramp(tw, [(0.0, "#a99a72"), (1.0, "#c2b48c")])
    wc = np.where(pith[..., None], pithc, skin)
    # lath nodes: darker bars across a lath every ~0.35 m along its length
    nodepos = np.where(warp_top, vb, u) + lath_id * 0.35
    nd = np.abs(((nodepos / 0.35) % 1.0) - 0.5) * 0.35
    wc = K.tint(wc, "#6b5435", 0.55 * tg.smoothstep(0.006, 0.0, nd))
    wc = K.mul(wc, 1.0 - 0.6 * gap)
    wc = K.tint(wc, "#8a8170", 0.25 * tg.smoothstep(0.1, 0.6, kit.fbm(0.3, 3)))
    rw = 0.5 + 0.06 * fib + 0.22 * pith + 0.2 * gap
    h = np.where(sel, hw, h)
    alb = np.where(sel[..., None], wc, alb)
    rough = np.where(sel, rw, rough)

alb = K.compress_chroma(alb, 0.75)
trims = [{"name": n, "v0": round(a / H, 6), "v1": round(b / H, 6), "heightMeters": round(b - a, 4)} for n, a, b in BANDS]
kit.finish(height=h, albedo=alb, rough=rough, ao="cycles", ao_distance=0.02, ao_samples=48, trims=trims,
           description="Bamboo trim sheet (1.5 m): three culm-skin bands (nodes 0.3-0.4 m), coir lashing coils, "
                       "2/2 twill split-lath weave (0.825 m band).",
           preview="pole", preview_opts=dict(samples=64, panel_band=(BANDS[4][1] / H, 1.0),
                                              pole_band=(BANDS[0][1] / H, BANDS[0][2] / H),
                                              lash_band=(BANDS[3][1] / H, BANDS[3][2] / H)))
