"""
@asset sandstone_red_ashlar
@kind material
@style materials:MATERIAL_PRESETS.sandstone_red_ashlar, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@tiers ultra,high
@fallback sandstone_carved_red

Plain spotted red sandstone ashlar (class C, 3 m x 3 m, seamless; P2 - ultra / high, mobile falls back to
sandstone_carved_red): seven courses of 0.43 m dressed blocks (0.7-1.1 m long, mean ~0.9 m), 4 mm lime joints,
fine point-dressed faces, slightly rounded arrises with chips, Sikri-type iron-oxide spotting (pale reduction spots
with dark rims, liesegang specks), faint cross-bedding, per-block hue / value jitter, grime on lower block edges.
Target (MATERIAL_PRESETS.sandstone_red_ashlar): average #a46450, roughness 0.80 (0.66-0.92).

Period notes: city-state walls and gates in Vindhyan red sandstone (Fatehpur Sikri / Mathura type quarries).
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
import _matkit as K  # noqa: E402

W = H = 3.0
kit = K.Kit(__file__, cls="C", size=(W, H), target="materials:MATERIAL_PRESETS.sandstone_red_ashlar", family="sandstone",
            saturation_limit="medium")

with core.timer("blocks"):
    b = kit.bond(H / 7.0, (0.7, 1.1), 0.004, stagger=None)
    d, bid = b["d"], b["id"]
    inside = tg.smoothstep(0.0018, 0.004, d)
    arris = K.Kit.edge_round(np.maximum(d - 0.002, 0.0), 0.012, 0.004)
    chips = tg.smoothstep(0.25, 0.55, kit.fbm(0.04, 4)) * tg.smoothstep(0.035, 0.0, d)
    tilt = 0.0015 * (((bid * 7.7) % 1.0) - 0.5) * (b["lu"] - 0.5) + 0.001 * (((bid * 3.1) % 1.0) - 0.5)
    dress = 0.0004 * kit.fbm(0.006, 2) + 0.0006 * kit.fbm(0.05, 3) + 0.0008 * kit.fbm(0.3, 3)
    h = (dress + arris + tilt - 0.005 * chips) * inside - 0.006 * (1.0 - inside)

with core.timer("albedo"):
    t = np.clip(0.5 + 0.12 * kit.fbm(0.25, 3) + 0.06 * kit.fbm(0.03, 2), 0, 1)
    rock = K.ramp(t, [(0.0, "#8a4c3a"), (0.4, "#9c5a45"), (0.75, "#ac6a52"), (1.0, "#b9785e")])
    j1 = (bid * 7.137 + 0.21) % 1.0 - 0.5
    j2 = (bid * 3.711 + 0.57) % 1.0 - 0.5
    rock = K.mul(K.hue_rotate(rock, j1 * 0.015), 1.0 + j2 * 0.08)
    # cross-bedding: faint inclined laminae, per block a different dip (block-local, so seamless)
    vl = b["lv"] * (H / 7.0)
    ul = b["lu"] * b["ulen"]
    dip = (((bid * 5.3) % 1.0) - 0.5) * 0.5
    lam = np.sin(2 * np.pi * (vl + dip * ul) / 0.012 + 3.0 * kit.fbm(0.2, 2))
    rock = K.mul(rock, 1.0 + 0.035 * lam)
    # iron-oxide spotting: pale reduction spots with dark rims + dark liesegang specks
    # reduction spots: sparse and clustered in some blocks (an even polka-dot scatter reads as a print)
    s1, _, sid = kit.worley(0.12, 1.0, x=kit.warp(0.015, 0.08, 2)[0])
    rad = 0.12 + 0.22 * ((sid * 3.7) % 1.0)
    spot = (sid > 0.7) & (((bid * 5.9) % 1.0) < 0.45)
    core_ = tg.smoothstep(rad, rad * 0.6, s1) * spot
    rim = tg.smoothstep(0.04, 0.0, np.abs(s1 - rad)) * spot
    rock = K.tint(rock, "#c09a84", 0.3 * core_)
    rock = K.tint(rock, "#5a2e22", 0.3 * rim)
    speck = tg.smoothstep(0.8, 0.9, kit.fbm(0.006, 1) * 0.5 + 0.5)
    rock = K.tint(rock, "#4a2a20", 0.5 * speck)
    rock = K.tint(rock, "#c08a70", 0.35 * chips)
    grime = tg.smoothstep(0.12, 0.0, b["lv"]) * tg.smoothstep(0.3, 0.7, kit.fbm(0.2, 3) * 0.5 + 0.5)
    rock = K.tint(rock, "#4a3a32", 0.25 * grime)
    patina = tg.smoothstep(0.55, 0.85, kit.fbm(0.6, 3) * 0.5 + 0.5)
    rock = K.tint(rock, "#6e6458", 0.18 * patina)
    joint = K.ramp(np.clip(0.5 + 0.3 * kit.fbm(0.03, 2), 0, 1), [(0.0, "#8a7e70"), (1.0, "#b0a492")])
    alb = rock * inside[..., None] + joint * (1.0 - inside[..., None])
    alb = K.compress_chroma(alb, 0.8)

with core.timer("roughness"):
    rough = 0.8 + 0.04 * kit.fbm(0.1, 3) - 0.06 * chips + 0.04 * grime + 0.03 * core_
    rough = rough * inside + 0.9 * (1.0 - inside)

kit.finish(height=h, albedo=alb, rough=rough, ao="cycles", ao_distance=0.02, ao_samples=32,
           description="Plain spotted red sandstone ashlar (3 m): 0.43 m courses, 4 mm lime joints, point-dressed "
                       "faces, reduction spots with dark rims, cross-bedding, chipped arrises, grime.",
           preview="wall", preview_opts=dict(floor_band=None, samples=64))
