"""
@asset terrain_flagstone
@kind material
@style terrain:TERRAIN_LAYERS.flagstone_paving, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@inputs tools/blender/assets/materials/_matkit.py

Flagstone paving splat layer (class T, 4 m x 4 m, seamless, macro-neutral): irregular buff sandstone slabs
0.35-0.9 m (warped Voronoi), 1-3 cm soil joints with grass, moss and weeds, slabs set at slightly different heights
and tilts, worn smooth and faintly polished along the traffic, chipped edges, pits and spalls, per-slab tone
(buff, grey-buff, pinkish), dirt in the joints and old stains. Royal roads, palace courts, ghat landings.
Target (TERRAIN_LAYERS.flagstone_paving): average #a09582, roughness 0.78.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
from _terrainkit import K, finish_terrain, layers  # noqa: E402

S = 4.0
kit = K.Kit(__file__, cls="T", size=(S, S), target="terrain:TERRAIN_LAYERS.flagstone_paving", family="sandstone",
            rough_spread=0.08)
x, y = kit.x, kit.y

with core.timer("slabs"):
    st = kit.stones(0.6, warp_m=0.06, jitter=0.85)
    d, sid = st["d"], st["id"]
    jw = 0.006 + 0.008 * (kit.fbm(0.3, 3) * 0.5 + 0.5)  # joint half-width 6-14 mm
    inside = tg.smoothstep(jw, jw + 0.004, d)
    # slab top: tilt + set height per slab, worn dish in the middle, rounded / chipped edges
    tiltu = (((sid * 7.3) % 1.0) - 0.5) * 0.012
    tiltv = (((sid * 3.1) % 1.0) - 0.5) * 0.012
    seth = (((sid * 5.7) % 1.0) - 0.5) * 0.008
    top = seth + tiltu * np.sin(2 * np.pi * x) + tiltv * np.sin(2 * np.pi * y)
    edge = K.Kit.edge_round(np.maximum(d - jw, 0.0), 0.02, 0.008)
    chips = tg.smoothstep(0.1, 0.45, kit.fbm(0.05, 4)) * tg.smoothstep(0.035, 0.0, d - jw)
    face = 0.0012 * kit.fbm(0.15, 3) + 0.0004 * kit.fbm(0.02, 3) + 0.00015 * kit.fbm(0.004, 2)
    pf1, _, pid = kit.worley(0.018, 1.0)
    pits = tg.smoothstep(0.35, 0.1, pf1) * (pid > 0.85)
    spall = tg.smoothstep(0.28, 0.32, kit.fbm(0.25, 5)) * inside
    slab = top + edge + face - 0.0015 * pits - 0.003 * spall - 0.006 * chips
    joint_floor = -0.018 + 0.002 * kit.fbm(0.05, 2)
    h = joint_floor + (slab - joint_floor) * inside
    # traffic wear: a polished, slightly dished band along u (the main direction of a road / court axis)
    wear = tg.smoothstep(0.0, 0.6, kit.fbm(0.8, 2, aniso=(4.0, 1.0)) * 0.5 + 0.5)

with core.timer("joint plants"):
    jm = 1.0 - inside
    specs = [
        dict(cell=0.02, shape=K.shape_blade(0.035, 0.0016, 0.004, 0.3), z=0.0, density=0.9, density_map=jm * tg.smoothstep(0.2, 0.6, kit.fbm(0.3, 3) * 0.5 + 0.5)),
        dict(cell=0.012, shape=K.shape_disc(0.005, 0.003, 0.5), z=0.0, density=0.8, density_map=jm),  # moss cushions
    ]
    L = layers(kit, specs)
    top_v = L["h"] + joint_floor
    over = (L["h"] > -1e5) & (top_v > h)
    h = np.where(over, top_v, h)

with core.timer("albedo"):
    tone = (sid * 13.7) % 1.0
    t = np.clip(0.5 + 0.4 * (tone - 0.5) + 0.12 * kit.fbm(0.2, 3) + 0.06 * kit.fbm(0.03, 3), 0, 1)
    stone = K.ramp(t, [(0.0, "#857a68"), (0.35, "#9a8e7a"), (0.7, "#ada08a"), (1.0, "#bfb29b")])
    stone = np.where(((sid * 3.3) % 1.0 < 0.25)[..., None], K.tint(stone, "#b0948a", 0.3), stone)  # pinkish slabs
    stone = np.where(((sid * 9.1) % 1.0 < 0.2)[..., None], K.tint(stone, "#8d8a80", 0.35), stone)  # grey slabs
    stone = K.mul(stone, 1.0 + 0.08 * wear)
    stone = K.mul(stone, 1.0 - 0.25 * pits)
    stone = K.tint(stone, "#c3ae94", 0.4 * spall + 0.35 * chips)
    # old stains (oil, dung, water) and dirt creeping in from the joints
    stain = tg.smoothstep(0.6, 0.85, kit.fbm(0.12, 3) * 0.5 + 0.5)
    stone = K.mul(stone, 1.0 - 0.12 * stain)
    near = tg.smoothstep(jw + 0.03, jw, d)
    stone = K.tint(stone, "#5e5444", 0.35 * near)
    soil = K.ramp(np.clip(0.5 + 0.3 * kit.fbm(0.04, 2), 0, 1), [(0.0, "#3a3127"), (1.0, "#5a4c3c")])
    alb = soil * (1.0 - inside[..., None]) + stone * inside[..., None]
    idx, gid = L["idx"], L["id"]
    grass = K.ramp(gid, [(0.0, "#4a5a2c"), (0.5, "#5d6c36"), (1.0, "#7a7d46")])
    moss = K.ramp(gid, [(0.0, "#3f4a2a"), (1.0, "#56603a")])
    col = np.where((idx == 0)[..., None], grass, moss)
    alb = np.where(over[..., None], col, alb)
    alb = K.compress_chroma(alb, 0.8)

with core.timer("roughness"):
    rough = 0.82 + 0.04 * kit.fbm(0.2, 2) - 0.16 * wear * inside + 0.06 * pits + 0.05 * stain
    rough = rough * inside + (1.0 - inside) * 0.95
    rough = np.where(over, 0.85, rough)

finish_terrain(kit, h, alb, rough, ao_distance=0.05, height_hp=0.4, ao_height_mix=0.4,
               description="Flagstone paving (4 m): irregular buff slabs with soil joints, grass and moss, worn "
                           "traffic polish, chips, spalls and stains; macro-neutral.")
