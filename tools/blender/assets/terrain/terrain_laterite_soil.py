"""
@asset terrain_laterite_soil
@kind material
@style terrain:TERRAIN_LAYERS.laterite_soil, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@inputs tools/blender/assets/materials/_matkit.py

Laterite soil splat layer (class T, 4 m x 4 m, seamless, macro-neutral): iron-red gravelly soil of the plateau rim
and the eastern forest edge - a crust of rounded ferruginous pisolith gravel (2-12 mm, dark rust to black-brown)
in a brick-red clay matrix, small vesicular laterite fragments, wash channels where rain has sorted the gravel,
a few dry grass blades and leaves.
Target (TERRAIN_LAYERS.laterite_soil): average #8e5038, roughness 0.93.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
from _terrainkit import K, finish_terrain, layers  # noqa: E402

S = 4.0
kit = K.Kit(__file__, cls="T", size=(S, S), target="terrain:TERRAIN_LAYERS.laterite_soil", family="soilDry",
            rough_spread=0.04)

with core.timer("soil"):
    h = 0.004 * kit.fbm(0.3, 3) + 0.0015 * kit.fbm(0.05, 3) + 0.0003 * kit.fbm(0.006, 2)
    # rain wash: shallow braided channels where the fines are washed out and gravel concentrates
    wx, wy = kit.warp(0.2, 0.6, 3)
    wash = tg.smoothstep(0.75, 0.95, 1.0 - np.abs(kit.fbm(0.5, 3, x=wx, y=wy, aniso=(3.0, 1.0))) * 2.0)
    h -= 0.004 * wash
    gravel_d = tg.smoothstep(0.2, 0.7, kit.fbm(0.25, 3) * 0.5 + 0.5) * 0.6 + 0.4 * wash + 0.25

with core.timer("gravel"):
    specs = [
        dict(cell=0.024, shape=K.shape_pebble(0.007, 0.006, 0.005, 0.6, 0.15), z=0.0, density=0.8, density_map=gravel_d),
        dict(cell=0.015, shape=K.shape_pebble(0.0045, 0.004, 0.0035, 0.6, 0.15), z=0.0, density=0.85, density_map=gravel_d),
        dict(cell=0.055, shape=K.shape_pebble(0.02, 0.015, 0.01, 0.5, 0.45), z=0.0, density=0.3),  # vesicular fragments
        dict(cell=0.09, shape=K.shape_blade(0.08, 0.0015, 0.002, 0.4), z=0.0, density=0.15),
        dict(cell=0.11, shape=K.shape_leaf(0.06, 0.025, 0.002), z=0.001, density=0.06),
    ]
    L = layers(kit, specs)
    top = L["h"] + h
    over = (L["h"] > -1e5) & (top > h)
    h = np.where(over, top, h)
    idx, gid = L["idx"], L["id"]
    # vesicles in the fragments
    vf1, _, vid = kit.worley(0.006, 1.0)
    ves = tg.smoothstep(0.35, 0.15, vf1) * (vid > 0.5) * (over & (idx == 2))
    h -= 0.002 * ves

with core.timer("albedo"):
    t = np.clip(0.5 + 0.25 * kit.fbm(0.12, 3) + 0.1 * kit.fbm(0.02, 2), 0, 1)
    clay = K.ramp(t, [(0.0, "#7a412c"), (0.4, "#934f33"), (0.75, "#a65e3e"), (1.0, "#b86d4c")])
    clay = K.tint(clay, "#b07a5c", 0.25 * tg.smoothstep(0.6, 0.85, kit.fbm(0.08, 3) * 0.5 + 0.5))  # dusty dry crust
    pis = K.ramp(gid, [(0.0, "#3c241a"), (0.4, "#5a2f20"), (0.75, "#7a3d26"), (1.0, "#93502f")])
    frag = K.ramp(gid, [(0.0, "#6a3524"), (1.0, "#9a5a3c")])
    frag = K.mul(frag, 1.0 - 0.5 * ves)
    grass = K.ramp(gid, [(0.0, "#8a7a52"), (1.0, "#a99a68")])
    leaf = K.ramp(gid, [(0.0, "#6e4a2c"), (1.0, "#8a6038")])
    col = np.where((idx <= 1)[..., None], pis, np.where((idx == 2)[..., None], frag, np.where((idx == 3)[..., None], grass, leaf)))
    alb = np.where(over[..., None], col, clay)
    alb = K.mul(alb, 1.0 - 0.1 * wash)
    alb = K.compress_chroma(alb, 0.8)

with core.timer("roughness"):
    rough = 0.94 + 0.02 * kit.fbm(0.05, 2) - 0.1 * (over & (idx <= 1)) + 0.02 * wash

finish_terrain(kit, h, alb, rough, ao_distance=0.03,
               description="Laterite soil (4 m): brick-red clay with ferruginous pisolith gravel, vesicular laterite "
                           "fragments, rain-wash channels, dry grass and leaves; macro-neutral.")
