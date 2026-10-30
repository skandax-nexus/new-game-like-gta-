"""
@asset sandstone_buff
@kind material
@style materials:MATERIAL_PRESETS.sandstone_buff, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS

Buff Sanchi / Chunar sandstone as a carved TRIM SHEET (class H, 2 m x 2 m, seamless in U and V) with exactly
the band layout of `sandstone_carved_red` (ashlar 0.32 m courses, creeper scroll, dentils, lotus petals,
bead-and-reel, lotus medallion frieze, two ashlar courses) so `stupa_sanchi` and every other trim-mapped model
re-skins by changing `samrajya_set` only. The default heartland stone: ghats, plinths, stupas, toranas.
Look: grey-buff Vindhyan stone of Sanchi (fine-grained, cream to grey-buff, faint pink-mauve bedding), chipped
arrises, black lichen on up-faces and weathering crusts, rain-washed paler tops, grime in the carving.
Target (MATERIAL_PRESETS.sandstone_buff): average #c2a985, roughness 0.76 (0.60-0.90).

Period notes: Sanchi's railings and toranas (2nd-1st c. BCE, Shunga-Satavahana) and the Mauryan Chunar quarries
(3rd c. BCE) both work this buff stone; carving vocabulary (vedika medallions, padma, bead-and-reel, patra-lata
scroll) is attested at Sanchi and Bharhut. No later (Gupta or medieval) motifs.
OWNER: Technical Artist A (TA-01).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import stone, texgen as tg  # noqa: E402
import _matkit as K  # noqa: E402
import _sandstone as SS  # noqa: E402

kit = K.Kit(__file__, cls="H", size=SS.SIZE, target="materials:MATERIAL_PRESETS.sandstone_buff", family="sandstone")

BUFF = stone.StoneStyle(
    "buff_sandstone_sanchi",
    stops=[(0.0, "#8c806c"), (0.3, "#a5967e"), (0.55, "#b9a98e"), (0.78, "#c9b99d"), (1.0, "#d7c9ae")],
    # per-block tints: warm cream, pinkish, grey-green, plain - Sanchi blocks differ subtly bed to bed
    tints=["#ffffff", "#fcf6f0", "#f3f2ec", "#fff9ef", "#f5f0ea", "#f9f3ee", "#eeece4"],
    spot_color="#ddd1bb",
    dirt_color="#3a342c",
    dust_color="#cbbb9f",
    lichen_color="#3f3e36",
    streak_dark=0.24,
    spots=0.3,
    lichen=0.8,
    banding=0.55,
    roughness=0.8,
    bed_color="#c9a08a",
    beds=0.55,
)


def finishing(kit: K.Kit, c: dict) -> tuple[np.ndarray, np.ndarray]:
    alb, rough = c["albedo"], c["rough"]
    sid = c["masks"]["stone"]
    nrm = c["normal"]
    ao = c["ao"]
    joint = c["masks"]["joint"]
    # per-block hue jitter +-3 % (half a turn-percent each way: +-5 deg), value +-6 % (ART_BIBLE §14)
    alb = SS.block_jitter(alb, sid, 0.015, 0.06)
    # faint pink-mauve bedding bands (sin y x noise, ~8 % #c9a08a)
    wx, wy = kit.warp(0.05, 0.6, 3)
    band = np.sin(2 * np.pi * (wy * SS.SIZE[1] * 1.6 + 0.35 * kit.fbm(0.9, 3, x=wx, y=wy)))
    band = tg.smoothstep(0.35, 0.95, band) * tg.smoothstep(-0.2, 0.35, kit.fbm(0.7, 3))
    alb = K.tint(alb, "#c9a08a", 0.16 * band)
    # black lichen colonies: noise(0.15, 4) > 0.72 -> #3a3630 at up to 70 %, on up-faces and in damp crusts
    lich = tg.smoothstep(0.42, 0.62, kit.fbm(0.15, 4) * 0.5 + 0.5 + 0.25 * kit.fbm(0.9, 3))
    speck = tg.smoothstep(0.55, 0.85, kit.fbm(0.012, 2) * 0.5 + 0.5)
    up = tg.smoothstep(0.05, 0.45, nrm[..., 1])
    damp = tg.smoothstep(0.1, 0.5, 1.0 - ao)
    lichen = np.clip(lich * (0.5 + 0.5 * np.maximum(up, damp)) * (0.55 + 0.45 * speck), 0.0, 1.0)
    alb = K.tint(alb, "#3a3630", 0.75 * lichen)
    # rain-washed, paler upper faces of mouldings; grey-green tint in shaded recesses
    alb = K.tint(alb, "#d9ccb4", 0.18 * tg.smoothstep(0.2, 0.7, nrm[..., 1]) * (1.0 - lichen))
    alb = K.tint(alb, "#7d7a66", 0.12 * damp)
    # roughness: joints 0.9, worn convex tops ~0.62, lichen rough
    curv = tg.curvature(c["height"], kit.texel, 1.2)
    # keep half of the hue/saturation scatter (lib/stone mottling is tuned for the red stone): grey-buff, not patchwork
    alb = K.compress_chroma(alb, 0.5)
    r = rough + 0.08 * tg.smoothstep(0.006, 0.0, joint) + 0.06 * lichen - 0.12 * tg.smoothstep(0.0, 8.0, curv) * (1.0 - lichen)
    return alb, r


SS.build(kit, BUFF, finishing,
         "Buff Sanchi/Chunar sandstone trim sheet (same bands as sandstone_carved_red): ashlar, creeper scroll, "
         "dentils, padma, bead-and-reel, lotus medallion frieze; black lichen, pink bedding, chipped arrises.")
