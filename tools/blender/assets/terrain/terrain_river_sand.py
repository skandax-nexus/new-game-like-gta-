"""
@asset terrain_river_sand
@kind material
@style terrain:TERRAIN_LAYERS.river_sand, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@inputs tools/blender/assets/materials/_matkit.py

River sand splat layer (class T, 3 m x 3 m, seamless, macro-neutral). Flow runs along +u: current ripples with
crests across the flow (along v), 9-12 cm wavelength, asymmetric (gentle stoss, steep lee facing downstream),
sinuous / linguoid crest lines, dark heavy-mineral sand concentrated in the troughs, pale quartz on the crests,
fine grain, a few shell fragments, pebbles and twigs, sparse bird tracks. (The darker wet band 1.5 m above the
water line is the renderer's: RIVERBANK.wetBandM.) Orient u along the river flow.
Target (TERRAIN_LAYERS.river_sand): average #c4b18e, roughness 0.85.
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
kit = K.Kit(__file__, cls="T", size=(S, S), target="terrain:TERRAIN_LAYERS.river_sand", family=None,
            rough_spread=0.05)
x, y = kit.x, kit.y


def bird_track(lu, lv, e1, e2):
    """Three-toed bird print (DEPTH): toes 3-4 cm forward, one back."""
    L = 0.035 * (0.8 + 0.4 * e1)
    out = np.full(lu.shape, -1e9, np.float32)
    for a in (-0.5, 0.0, 0.5, math.pi):
        ln = L * (0.45 if a == math.pi else 1.0)
        ca, sa = math.cos(a), math.sin(a)
        t = lu * ca + lv * sa
        n = -lu * sa + lv * ca
        m = (t > 0) & (t < ln) & (np.abs(n) < 0.0018)
        out = np.maximum(out, np.where(m, 0.002, -1e9))
    return out


with core.timer("ripples"):
    wx, wy = kit.warp(0.06, 0.35, 3)
    lam = S / 29.0  # 29 ripples per tile: seamless
    # linguoid / sinuous crests: phase along u, bent by a v-dependent sinuosity
    sinu = 0.045 * kit.fbm(0.45, 3, x=wx, y=wy, aniso=(1.0, 1.4)) + 0.012 * kit.fbm(0.12, 2, x=wx, y=wy)
    ph = (wx * S + sinu) / lam + 0.4 * kit.fbm(0.5, 2)
    p = ph % 1.0
    prof = np.where(p < 0.72, p / 0.72, (1.0 - p) / 0.28)  # gentle stoss upstream, steep lee downstream
    amp = 0.012 * np.clip(0.7 + 0.5 * kit.fbm(0.4, 3), 0.25, 1.2)
    crest_breaks = tg.smoothstep(-0.6, -0.2, kit.fbm(0.15, 3))  # crest lines interrupt and bifurcate
    rip = amp * tg.smoothstep(0.0, 1.0, prof) * (0.55 + 0.45 * crest_breaks)
    h = rip + 0.0015 * kit.fbm(0.3, 3) + 0.0003 * kit.fbm(0.004, 2) + 0.00015 * kit.fbm(0.0015, 1)
    trough = tg.smoothstep(0.35, 0.0, prof)

with core.timer("scatter"):
    specs = [
        dict(cell=0.06, shape=K.shape_pebble(0.008, 0.006, 0.004), z=0.0, density=0.12),
        dict(cell=0.05, shape=K.shape_disc(0.005, 0.0012, 0.6), z=0.0, density=0.12),  # shell fragments
        dict(cell=0.12, shape=K.shape_blade(0.08, 0.002, 0.003, 0.3), z=0.0, density=0.06),  # twigs / reed bits
    ]
    L = layers(kit, specs)
    top = L["h"] + h
    over = (L["h"] > -1e5) & (top > h)
    h = np.where(over, top, h)
    birds = kit.scatter(0.25, bird_track, density=0.12, density_map=tg.smoothstep(0.5, 0.7, kit.fbm(0.6, 2) * 0.5 + 0.5))
    h -= birds.height(0.0)

with core.timer("albedo"):
    t = np.clip(0.5 + 0.2 * kit.fbm(0.2, 3) + 0.12 * kit.fbm(0.02, 2) + 0.25 * (np.clip(rip / 0.012, 0, 1) - 0.5), 0, 1)
    sand = K.ramp(t, [(0.0, "#a3916f"), (0.4, "#b8a682"), (0.75, "#c9b893"), (1.0, "#d8c9a6")])
    # dark heavy minerals (magnetite / hornblende) in troughs, fine speckle everywhere
    heavy = trough * tg.smoothstep(0.35, 0.7, kit.fbm(0.03, 3, aniso=(1.0, 4.0)) * 0.5 + 0.5)
    sand = K.tint(sand, "#5d5348", 0.55 * heavy)
    speck = kit.fbm(0.0012, 1)
    sand = K.mul(sand, 1.0 + 0.1 * speck - 0.15 * tg.smoothstep(0.55, 0.8, speck))
    idx, gid = L["idx"], L["id"]
    peb = K.ramp(gid, [(0.0, "#7a7166"), (0.5, "#988c7c"), (1.0, "#bcae98")])
    shell = K.ramp(gid, [(0.0, "#d8d0bd"), (1.0, "#ece6d8")])
    twig = K.ramp(gid, [(0.0, "#5a4a36"), (1.0, "#7d6a4e")])
    col = np.where((idx == 0)[..., None], peb, np.where((idx == 1)[..., None], shell, twig))
    alb = np.where(over[..., None], col, sand)
    alb = K.mul(alb, 1.0 - 0.15 * birds.mask)
    alb = K.compress_chroma(alb, 0.85)

with core.timer("roughness"):
    rough = 0.86 + 0.03 * kit.fbm(0.05, 2) - 0.06 * heavy + 0.03 * np.clip(rip / 0.012, 0, 1) - 0.12 * (over & (idx == 1))

finish_terrain(kit, h, alb, rough, ao_distance=0.04, height_hp=0.6,
               description="River sand (3 m, flow along +u): asymmetric current ripples with dark heavy-mineral troughs, "
                           "pale crests, pebbles, shells, twigs, bird tracks; macro-neutral.",
               extra_meta=dict(flowAxis="+u", rippleWavelengthMeters=round(S / 29.0, 4)))
