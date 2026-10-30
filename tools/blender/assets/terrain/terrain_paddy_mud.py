"""
@asset terrain_paddy_mud
@kind material
@style terrain:TERRAIN_LAYERS.paddy_mud, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS
@inputs tools/blender/assets/materials/_matkit.py

Puddled paddy-field mud splat layer (class T, 3 m x 3 m, seamless, macro-neutral): smooth, glossy, puddled clay
levelled by the plank, sheet water standing over ~55 % of it (STANDING-WATER MASK: cache-only `<id>_waterMask.png`
until publish.mjs keeps baseColor alpha - TA-01 request; also lowest ORM.r), low mud islands, footprints of the
transplanters, floating straw and duckweed specks, a film of algae at the water edges. Seedling rows are
geometry / cards (GFX-03), not texture.
Target (TERRAIN_LAYERS.paddy_mud): average #5b5443, roughness 0.35.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import core, texgen as tg  # noqa: E402
from _terrainkit import K, finish_terrain, layers, shape_foot  # noqa: E402

S = 3.0
kit = K.Kit(__file__, cls="T", size=(S, S), target="terrain:TERRAIN_LAYERS.paddy_mud", family="soilWet",
            rough_range=(0.03, 0.6))

with core.timer("mud"):
    h = 0.012 * kit.fbm(0.45, 3) + 0.003 * kit.fbm(0.08, 3) + 0.0005 * kit.fbm(0.01, 2)
    feet = kit.scatter(0.3, shape_foot(0.02), density=0.5, angle=(-0.6, 0.6))
    d = feet.height(0.0)
    h += 0.5 * np.clip(tg.blur(d, 3.0) - d, 0.0, None) - d
    hb = tg.blur(h, 1.0)
    level = float(np.percentile(hb, 55.0))
    depth = np.clip(level - hb, 0.0, None)
    water = tg.smoothstep(0.0, 0.0012, depth)
    h_w = np.where(water > 0, np.maximum(h, level), h)
    shore = tg.smoothstep(0.004, 0.0, np.abs(hb - level))

with core.timer("floaters"):
    specs = [
        dict(cell=0.08, shape=K.shape_blade(0.07, 0.0016, 0.0005, 0.4), z=0.0, density=0.25, density_map=water),
        dict(cell=0.012, shape=K.shape_disc(0.0025, 0.0003, 0.4), z=0.0, density=0.5,
             density_map=water * tg.smoothstep(0.55, 0.75, kit.fbm(0.3, 3) * 0.5 + 0.5)),  # duckweed
    ]
    L = layers(kit, specs)
    fl = (L["h"] > -1e5).astype(np.float32)
    idx, gid = L["idx"], L["id"]

with core.timer("albedo"):
    t = np.clip(0.5 + 0.25 * kit.fbm(0.12, 3) + 0.1 * kit.fbm(0.015, 2), 0, 1)
    mud = K.ramp(t, [(0.0, "#3d372b"), (0.4, "#4f4838"), (0.75, "#625a47"), (1.0, "#756b55")])
    mud = K.tint(mud, "#7d735e", 0.25 * tg.smoothstep(0.004, 0.015, hb - level))  # drying island crests
    under = K.mul(K.tint(mud, "#4a4434", 0.4), 0.75)  # silty water over mud
    alb = mud * (1.0 - water[..., None]) + under * water[..., None]
    alb = K.tint(alb, "#4e5634", 0.35 * shore)  # algae film at the water edge
    straw = K.ramp(gid, [(0.0, "#7a6e4a"), (1.0, "#988a5c")])
    weed = K.ramp(gid, [(0.0, "#46562c"), (1.0, "#5e6e38")])
    alb = np.where((fl > 0)[..., None], np.where((idx == 0)[..., None], straw, weed), alb)
    alb = K.compress_chroma(alb, 0.85)

with core.timer("roughness"):
    rough = 0.42 + 0.06 * kit.fbm(0.05, 2) + 0.1 * tg.smoothstep(0.004, 0.015, hb - level)
    rough = rough * (1.0 - water) + 0.02 * water
    rough = np.where(fl > 0, 0.7, rough)

# standing-water mask: cache-only until publish.mjs ships baseColor alpha (an RGBA source is premultiplied by the resize)
mask_png = tg.write_png(kit.ctx.path(f"{kit.ctx.id}_waterMask.png"), kit._down(water, kit.albedo_res), 8)
kit.ctx.add_file("waterMask", mask_png, colorSpace="linear", ship=False)
finish_terrain(kit, h_w, alb, rough, ao_distance=0.03, height_hp=0.0, ao_height_mix=0.45, macro_amount=0.85,
               description="Puddled paddy mud (3 m): glossy levelled clay, standing water over ~55 % (mask: cache "
                           "file, lowest ORM.r), footprints, floating straw and duckweed, algae at the edges.",
               extra_meta=dict(waterMask=dict(file=f"{kit.ctx.id}_waterMask.png", shipped=False, heightPercentile=55,
                                              note="lowest ORM.r; moves to baseColor.a when publish keeps alpha")))
