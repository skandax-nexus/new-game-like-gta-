"""
Carved sandstone trim sheets (package-local helper): ONE band layout shared by `sandstone_carved_red` and
`sandstone_buff`, so models re-skin by changing `samrajya_set` only (same trims, same decal regions).
OWNER: Technical Artist A (TA-01).

Bands (bottom -> top of the 2 m x 2 m sheet; UV v ranges are written to metadata.trims / the manifest):
    ashlar_base 0.32 m | vine_scroll 0.24 | dentil 0.12 | padma 0.20 | bead_reel 0.08 |
    medallion_frieze 0.40 | ashlar 0.64 (two 0.32 m courses)
Decals (single motifs in sheet UV): 8 x spiral_rosette (vine scroll), 4 x lotus_medallion (frieze).

Pipeline: numpy ornament height fields (lib/ornament) at 2048 -> weathering (lib/stone) -> Cycles ray-traced AO
of the displaced heightfield -> lib/stone albedo/roughness -> per-style finishing layers (per-block hue/value
jitter, bands, lichen / soot crusts, black lichen on up-faces) -> the kit calibrates to the preset and writes
the class-sized maps (H: 2048, S: 1024 from the 2048 master).
"""
from __future__ import annotations

from typing import Callable

import numpy as np

from lib import bake, core, ornament as orn, stone, texgen as tg
import _matkit as K

F = np.float32
SIZE = (2.0, 2.0)

BANDS = [
    orn.Band("ashlar_base", 0.00, 0.32, orn.ashlar, dict(courses=1, min_len=0.6, max_len=1.1)),
    orn.Band("vine_scroll", 0.32, 0.56, orn.vine_scroll, dict(period=0.5)),
    orn.Band("dentil", 0.56, 0.68, orn.dentil, dict(period=0.1)),
    orn.Band("padma", 0.68, 0.88, orn.padma, dict(period=0.125)),
    orn.Band("bead_reel", 0.88, 0.96, orn.bead_reel, dict(period=0.08)),
    orn.Band("medallion_frieze", 0.96, 1.36, orn.medallion_frieze, dict(panels=4)),
    orn.Band("ashlar", 1.36, 2.00, orn.ashlar, dict(courses=2)),
]


def build(kit: K.Kit, style: stone.StoneStyle, finish_layers: Callable, description: str,
          weather_amount: float = 1.0) -> None:
    """Compose + weather + surface at the kit's internal resolution (2048 master), then `finish_layers(kit, ctx)`
    returns (albedo, rough) given a context dict (height, ao, masks, wm, normal, sheet)."""
    N = kit.N
    with core.timer("compose sheet"):
        sheet = orn.compose_sheet(N, N, SIZE, BANDS, kit.rng)
    masks = {"stone": sheet.stone, "tool": sheet.tool, "carve": sheet.carve, "joint": sheet.joint}
    with core.timer("weathering"):
        height, wm = stone.weather_height(sheet.height, masks, SIZE, kit.rng, amount=weather_amount)
    # AO at the shipped data resolution (S: 1024 from the 2048 master), upsampled for the surface synthesis
    res = kit.data_res
    ao = bake.bake_heightfield_ao(height if res == N else tg.resize(height, res, res), SIZE, res,
                                  samples=kit.ctx.samples(64, 12), distance=0.06, mesh_verts=min(res, 1280))
    ao = tg.blur(ao, 0.6)
    if res != N:
        ao = tg.resize(ao, N, N)
    normal = tg.normal_from_height(height, kit.texel)
    with core.timer("surface"):
        albedo, rough = stone.surface(height, ao, masks, wm, SIZE, kit.rng, style, normal)
    with core.timer("finishing layers"):
        albedo, rough = finish_layers(kit, dict(height=height, ao=ao, masks=masks, wm=wm, normal=normal, sheet=sheet,
                                                albedo=albedo, rough=rough))
    kit.finish(height=height, albedo=albedo, rough=rough, ao=ao, description=description, trims=sheet.trims(),
               decals=sheet.decals(), preview="trim", preview_opts=dict(floor_band=(0.68, 1.0), samples=96))


def iron_banding(kit: K.Kit, albedo: np.ndarray, strength: float = 1.0) -> np.ndarray:
    """Seamless iron banding (broad tone waves + faint liesegang lines). Replaces lib/stone's banding, whose phase
    uses non-integer cycles per tile (a faint seam at the tile border; requested fix in the TA-01 report): the
    styles here set banding=0 and call this instead (integer wave vector: 5 cycles in v, 2 in u per 2 m tile)."""
    wx, wy = kit.warp(0.16, 1.6, 3)
    phase = wy * 5.0 + wx * 2.0
    out = K.mul(albedo, 1.0 + 0.06 * np.sin(2 * np.pi * phase) * strength)
    lines = tg.smoothstep(0.965, 0.995, np.sin(2 * np.pi * phase * 2.0)) * strength
    lines = lines * tg.smoothstep(-0.1, 0.4, kit.fbm(1.4, 3))
    return K.mul(out, 1.0 - 0.14 * lines)


def block_jitter(albedo: np.ndarray, stone_id: np.ndarray, hue_turns: float = 0.03, value: float = 0.06) -> np.ndarray:
    """Per-block hue rotation within +-hue_turns of the colour circle and value within +-value."""
    j1 = (stone_id * 7.137 + 0.21) % 1.0 - 0.5
    j2 = (stone_id * 3.711 + 0.57) % 1.0 - 0.5
    out = K.hue_rotate(albedo, j1 * 2.0 * hue_turns)
    return K.mul(out, 1.0 + j2 * 2.0 * value)


__all__ = ["BANDS", "SIZE", "block_jitter", "build", "iron_banding"]
