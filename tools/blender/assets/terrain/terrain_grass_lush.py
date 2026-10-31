"""
@asset terrain_grass_lush
@kind material
@style terrain:TERRAIN_LAYERS.grass_lush, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@inputs tools/blender/assets/materials/_matkit.py

Monsoon grass splat layer (class T, 3 m x 3 m, seamless, macro-neutral): five stacked layers of grass blades seen
from above (2-7 cm, lying in all directions with a weak prevailing lean), clover patches (trifoliate leaflets),
a few dry straw blades and seed heads, dark humus soil showing in ~15 % gaps. Olive-emerald, never lime: the
greens stay below the large-surface saturation budget; the GPU grass blades (GFX-03) sit on top of it.
Target (TERRAIN_LAYERS.grass_lush): average #5f6f3a, roughness 0.9.
OWNER: Technical Artist A (TA-01).
"""
import math
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
from _terrainkit import K, finish_terrain, layers  # noqa: E402

S = 3.0
# AD-4: olive-emerald, never lime - every texel at HSV saturation <= 0.5 and value <= 0.55 (enforced in calibration)
kit = K.Kit(__file__, cls="T", size=(S, S), target="terrain:TERRAIN_LAYERS.grass_lush", family="grass",
            rough_spread=0.05, sat_cap=0.452, value_cap=0.55)
# AD-4 (round 2): the shipped baseColor is lossy WebP (q88, 4:2:0); its quantisation moves the dark blue channel of
# an olive green by +-3 levels = +-0.03 HSV saturation, so a sward calibrated to the preset's own saturation (0.477)
# cannot ship at p98 <= 0.50. Calibrate to an encode-safe mean inside the +-6 % tolerance instead: #606c3c =
# preset #5f6f3a with R +1 %, G -2.7 %, B +3.4 % (hue 75 deg, saturation 0.444; measured in ta-01.cjs deltas/stats).
ENCODE_SAFE = "#606c3c"
kit.preset["baseColor"] = ENCODE_SAFE
SAT_T = 0.444


def clover(lu, lv, e1, e2):
    """Three round leaflets around a centre (6-9 mm), slight central crease."""
    r = 0.0055 * (0.8 + 0.4 * e1)
    best = np.full(lu.shape, -1e9, np.float32)
    for k in range(3):
        a = 2 * math.pi * k / 3 + e2
        cx, cy = np.cos(a) * r * 1.05, np.sin(a) * r * 1.05
        d = np.sqrt((lu - cx) ** 2 + (lv - cy) ** 2) / r
        hh = np.where(d < 1.0, 0.003 * (0.6 + 0.4 * np.sqrt(np.clip(1 - d * d, 0, 1))), -1e9)
        best = np.maximum(best, hh)
    return best


with core.timer("soil"):
    soil = 0.002 * kit.fbm(0.08, 3) + 0.0008 * kit.fbm(0.01, 2)
    cf1, _, cid = kit.worley(0.015, 1.0)
    soil += 0.0012 * tg.smoothstep(0.5, 0.0, cf1) * (cid > 0.5)  # crumbs
    # gaps: where the sward is thin (meso-scale only: the splat supplies the macro variation)
    thin = tg.smoothstep(0.15, 0.55, kit.fbm(0.18, 3) * 0.5 + 0.5 + 0.25 * kit.fbm(0.05, 2))
    sward = 1.0 - 0.75 * thin
    clover_zone = tg.smoothstep(0.64, 0.78, kit.fbm(0.12, 3) * 0.5 + 0.5 + 0.12 * kit.fbm(0.03, 2))

with core.timer("tufts"):
    # AD-4: blades grow in TUFTS (clumps 6-14 cm) that radiate from their crowns; the sward is denser and higher at
    # the crown, so the height map carries the clumping
    tf1, _, tid = kit.worley(0.09, 0.95)
    tuft_r = 0.09 * (0.7 + 0.6 * tid)
    crown = np.clip(1.0 - tf1 * 0.09 / tuft_r, 0.0, 1.0)  # 1 at the tuft centre .. 0 at the rim
    gy_, gx_ = np.gradient(kit.blur(tf1, 0.004))
    radial = np.arctan2(-gy_, gx_).astype(np.float32)  # blades lean away from the crown (image rows run down)
    tdens = np.clip(sward * (0.3 + 0.95 * crown), 0.0, 1.0)

with core.timer("grass layers"):
    lean = 0.6  # weak prevailing lean (rad) on top of the radial splay
    # blades of varied width (2-4.5 mm) and taper, lengths 3-9 cm (shape_blade varies both per blade)
    specs = [
        dict(cell=0.034, shape=K.shape_blade(0.055, 0.0032, 0.004, 0.35), z=0.000, density=0.95, density_map=tdens,
             angle=(-0.5, 0.5), angle_map=radial),
        dict(cell=0.028, shape=K.shape_blade(0.05, 0.0026, 0.004, 0.35), z=0.002, density=0.9, density_map=tdens,
             angle=(-0.7, 0.7), angle_map=radial),
        dict(cell=0.024, shape=K.shape_blade(0.045, 0.0022, 0.004, 0.3), z=0.004, density=0.85, density_map=tdens,
             angle=(lean - 1.4, lean + 1.4)),
        dict(cell=0.012, shape=clover, z=0.002, density=0.8, density_map=clover_zone),
        dict(cell=0.026, shape=K.shape_blade(0.065, 0.0036, 0.004, 0.25), z=0.006, density=0.6, density_map=tdens,
             angle=(-0.4, 0.4), angle_map=radial),
        dict(cell=0.05, shape=K.shape_blade(0.07, 0.0016, 0.003, 0.4), z=0.008, density=0.22),  # dry straw blades
    ]
    L = layers(kit, specs)
    veg = L["h"] > -1e5
    h = np.where(veg, np.maximum(L["h"], soil), soil)
    h = h + 0.025 * crown ** 1.5 * veg  # tuft crowns stand up out of the sward

with core.timer("albedo"):
    # soil gaps: olive-brown thatch of dead blades, close to the sward in value AND chroma (AD-4: the lossy
    # 4:2:0 WebP re-attaches blade chroma to darker neighbours - a dark gap next to a saturated blade turns lime)
    soil_col = K.ramp(np.clip(0.5 + 0.3 * kit.fbm(0.05, 3), 0, 1), [(0.0, "#434029"), (0.5, "#4d4930"), (1.0, "#575236")])
    idx = L["idx"]
    gid = L["id"]
    # blade colour: olive to emerald-olive, lighter tips, darker lower layers (self-shadowed sward); narrow value
    # range - the blade detail is carried by the normal map and the AO, not by albedo contrast
    tip = np.clip(L["lu"] / 0.06, 0, 1)
    g = np.clip(0.5 + 0.35 * (gid - 0.5) + 0.2 * tip + 0.1 * kit.fbm(0.1, 3) + 0.15 * (crown - 0.5), 0, 1)
    grass = K.ramp(g, [(0.0, "#46522b"), (0.35, "#505e30"), (0.65, "#5a6835"), (1.0, "#64703c")])
    depth = np.clip(idx.astype(np.float32) / 5.0, 0.0, 1.0)
    grass = K.mul(grass, 0.88 + 0.12 * depth)
    clov = K.ramp(np.clip(0.5 + 0.3 * (gid - 0.5), 0, 1), [(0.0, "#38432a"), (1.0, "#434e2f")])  # darker, olive, not teal
    straw = K.ramp(np.clip(gid, 0, 1), [(0.0, "#7f7650"), (1.0, "#958a5e")])
    col = np.where((idx == 3)[..., None], clov, grass)
    col = np.where((idx == 5)[..., None], straw, col)
    alb = np.where(veg[..., None], col, soil_col)
    alb = K.compress_chroma(alb, 0.7)
    # AD-4: pre-filter chroma to the shipped resolution's 2 x 2 block (what the 4:2:0 encoder keeps anyway): the
    # chroma becomes smooth at 6 mm, so the encode cannot move blade chroma onto darker texels (no lime, p98 holds)
    srgb = tg.linear_to_srgb(np.clip(alb, 0.0, 1.0))
    Y = 0.299 * srgb[..., 0] + 0.587 * srgb[..., 1] + 0.114 * srgb[..., 2]
    cb = kit.blur(srgb[..., 2] - Y, 0.006)
    cr = kit.blur(srgb[..., 0] - Y, 0.006)
    Y = 0.35 * Y + 0.65 * kit.blur(Y, 0.003)  # albedo luma smooth at the shipped 2 x 2 block too (blade detail lives in the normal map)
    r_ = Y + cr
    b_ = Y + cb
    g_ = (Y - 0.299 * r_ - 0.114 * b_) / 0.587
    alb = tg.srgb_to_linear(np.clip(np.stack([r_, g_, b_], axis=-1), 0.0, 1.0)).astype(np.float32)
    # AD-4: tight saturation - every texel keeps its value but its HSV saturation is set from the target's (brighter
    # tips a little less saturated, as sunlit blades are) and its hue is held within +-5 deg of the sward mean, so the
    # shipped lossy WebP (quantisation error ~+-0.02 S) stays at p98 <= 0.50 and never reaches lime
    srgb = tg.linear_to_srgb(np.clip(alb, 0.0, 1.0)).astype(np.float32)
    mx = srgb.max(axis=-1)
    mn = srgb.min(axis=-1)
    v_mean = float(mx.mean(dtype=np.float64))
    hsv_h = np.zeros_like(mx)
    d = np.maximum(mx - mn, 1e-6)
    r0, g0, b0 = srgb[..., 0], srgb[..., 1], srgb[..., 2]
    hsv_h = np.where(mx == r0, ((g0 - b0) / d) % 6.0, np.where(mx == g0, (b0 - r0) / d + 2.0, (r0 - g0) / d + 4.0)) * 60.0
    is_veg = veg & (idx != 5)
    h_mean = float(np.median(hsv_h[is_veg]))
    hue = np.where(is_veg, h_mean + np.clip(hsv_h - h_mean, -5.0, 5.0), hsv_h)
    sat = np.where(is_veg, SAT_T - 0.06 * np.clip((mx - v_mean) / max(v_mean, 1e-3), -0.5, 0.5), np.minimum((mx - mn) / np.maximum(mx, 1e-6), 0.44))
    c = mx * sat
    hp = (hue / 60.0) % 6.0
    xx = c * (1.0 - np.abs(hp % 2.0 - 1.0))
    z = np.zeros_like(c)
    hq = hp[..., None]
    rgb = np.select([hq < 1, hq < 2, hq < 3, hq < 4, hq < 5], [np.stack([c, xx, z], -1), np.stack([xx, c, z], -1), np.stack([z, c, xx], -1),
                    np.stack([z, xx, c], -1), np.stack([xx, z, c], -1)], np.stack([c, z, xx], -1))
    rgb = rgb + (mx - c)[..., None]
    alb = tg.srgb_to_linear(np.clip(rgb, 0.0, 1.0)).astype(np.float32)

with core.timer("roughness"):
    rough = np.where(veg, 0.86 + 0.06 * (gid - 0.5), 0.97) + 0.02 * kit.fbm(0.05, 2)
    rough = np.where(idx == 3, 0.8, rough)

finish_terrain(kit, h, alb, rough, ao_distance=0.03,
               description="Monsoon grass splat layer (3 m): olive-emerald blades in five layers, clover, dry straw, "
                           "dark soil gaps; macro-neutral.")
