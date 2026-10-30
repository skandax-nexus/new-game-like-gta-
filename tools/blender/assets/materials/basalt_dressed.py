"""
@asset basalt_dressed
@kind material
@style materials:MATERIAL_PRESETS.basalt_dressed, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS

Chisel-dressed basalt (class C, 3 m x 3 m, seamless): coursed ashlar of dark Deccan basalt, courses 0.375 m, blocks
0.5-1.1 m, tight 3 mm joints, every block face dressed with fine diagonal chisel striations (direction and pitch
vary per block), drafted margins, a few hairline cracks and chipped corners, smoother and slightly glossier where
hands and shoulders touch, a pale grey weathering rind in patches and white salt bloom in damp zones (fully
periodic; foot bands come from the model macro map).
Target (MATERIAL_PRESETS.basalt_dressed): average #57534f, roughness 0.70 (0.50-0.88).

Period notes: rock-cut chaitya halls (Bhaja, Karla) and highland gates are cut in Deccan Trap basalt with point and
flat chisels; dressed blockwork appears in gates and plinths.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
import _matkit as K  # noqa: E402

W = H = 3.0
kit = K.Kit(__file__, cls="C", size=(W, H), target="materials:MATERIAL_PRESETS.basalt_dressed", family="soilWet")
vm = kit.y * H

with core.timer("blocks"):
    b = kit.bond(H / 8.0, (0.5, 1.1), 0.003, stagger=None)
    d, bid = b["d"], b["id"]
    inside = tg.smoothstep(0.0015, 0.003, d)
    # chisel striations: diagonal, per-block angle and pitch
    ang = (bid * 2.0 - 1.0) * 0.9 + 0.785
    pitch = 0.004 + 0.003 * ((bid * 5.1) % 1.0)
    ul = b["lu"] * b["ulen"]  # block-local coords: continuous across the tile seam (blocks wrap)
    vl = b["lv"] * (H / 8.0)
    ph = (ul * np.cos(ang) + vl * np.sin(ang)) / pitch + 0.8 * kit.fbm(0.1, 2)
    stri = (0.5 + 0.5 * np.sin(2 * np.pi * ph)) ** 2
    margin = tg.smoothstep(0.025, 0.04, d)
    face = 0.0004 * stri * margin + 0.0006 * kit.fbm(0.1, 3) + 0.0002 * kit.fbm(0.01, 2)
    # drafted margin: slightly sunk smooth border band
    face -= 0.0006 * (1.0 - margin)
    arris = K.Kit.edge_round(np.maximum(d - 0.0015, 0.0), 0.006, 0.003)
    chipn = kit.fbm(0.04, 4)
    chips = tg.smoothstep(0.2, 0.5, chipn) * tg.smoothstep(0.03, 0.0, d)
    c1, c2, cid = kit.worley(0.4, 1.0, x=kit.warp(0.02, 0.1, 2)[0])
    crack = tg.smoothstep(0.006, 0.0, c2 - c1) * (cid > 0.75)
    tilt = 0.0012 * (((bid * 7.7) % 1.0) - 0.5) * (b["lu"] - 0.5)
    h = (face + arris + tilt - 0.005 * chips - 0.0015 * crack) * inside - 0.008 * (1.0 - inside)

with core.timer("albedo"):
    t = np.clip(0.5 + 0.3 * (bid - 0.5) + 0.12 * kit.fbm(0.3, 3) + 0.06 * kit.fbm(0.03, 2), 0, 1)
    rock = K.ramp(t, [(0.0, "#3c3a37"), (0.4, "#4a4744"), (0.75, "#595551"), (1.0, "#6a6560")])
    rock = K.mul(rock, 1.0 + 0.08 * (stri - 0.5) * margin)  # tool marks catch light dust
    rind = tg.smoothstep(0.35, 0.75, kit.fbm(0.5, 3) * 0.5 + 0.5)
    rock = K.tint(rock, "#7a756c", 0.3 * rind)
    rock = K.tint(rock, "#8a8478", 0.35 * chips)
    rock = K.mul(rock, 1.0 - 0.4 * crack)
    # hand-polished patches: darker, smoother
    touch = tg.smoothstep(0.55, 0.8, kit.fbm(0.6, 3) * 0.5 + 0.5)  # hand-worn patches (periodic)
    rock = K.mul(rock, 1.0 - 0.1 * touch)
    # salt bloom in damp zones (the foot band itself is the model macro map's)
    salt = tg.smoothstep(0.6, 0.85, kit.fbm(0.5, 3) * 0.5 + 0.5) * tg.smoothstep(0.3, 0.7, kit.fbm(0.05, 4) * 0.5 + 0.5)
    rock = K.tint(rock, "#cfcac0", 0.35 * salt)
    joint = K.ramp(np.clip(0.5 + 0.3 * kit.fbm(0.02, 2), 0, 1), [(0.0, "#1f1d1b"), (1.0, "#33302c")])
    alb = rock * inside[..., None] + joint * (1.0 - inside[..., None])
    alb = K.compress_chroma(alb, 0.9)

with core.timer("roughness"):
    rough = 0.72 + 0.05 * kit.fbm(0.2, 3) + 0.06 * stri * margin - 0.2 * touch + 0.1 * salt + 0.08 * rind
    rough = rough * inside + 0.9 * (1.0 - inside)

kit.finish(height=h, albedo=alb, rough=rough, ao="cycles", ao_distance=0.02, ao_samples=32,
           description="Chisel-dressed basalt ashlar (3 m): diagonal tooling per block, drafted margins, tight joints, "
                       "hand-polished patches, weathering rind, salt bloom.",
           preview="wall", preview_opts=dict(floor_band=None, samples=64))
