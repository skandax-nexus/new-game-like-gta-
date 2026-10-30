"""
@asset sandstone_carved_red
@kind material
@style materials:MATERIAL_PRESETS.sandstone_carved_red, palette:ALBEDO_LIMITS, palette:SATURATION_LIMITS

Carved red sandstone TRIM SHEET (class S since WP1-09: 1024 shipped from a 2048 master; 2 m x 2 m per tile, seamless
in U and V). Band layout shared with `sandstone_buff` (tools/blender/assets/materials/_sandstone.py):
    ashlar_base 0.32 m | vine_scroll 0.24 | dentil 0.12 | padma 0.20 | bead_reel 0.08 |
    medallion_frieze 0.40 | ashlar 0.64 (two 0.32 m courses)
Map a face's V range onto a band to "trim" it (plinths, cornices, railing bars, copings); map whole faces to the
sheet for a richly carved wall; map courses of a dome / floor to the ashlar band. Decal regions: spiral_rosette,
lotus_medallion (metadata.decals).
Look: Fatehpur Sikri / Mathura red sandstone - brick-red to purple-brown, buff beds, reduction spots, weathered
(eroded relief, spalls, honeycomb, chipped arrises, hairline cracks, grime, dust, streaks).
WP1-09 retune (ART_BIBLE §15 review): -12 % saturation (chroma scatter compressed, mean on the preset), per-block hue
jitter +-3 %, grey-green lichen and soot crusts at macro scale (0.5-2 m), seamless iron banding; calibrated to the
preset average. Reserved for city-state architecture and accents (the heartland default is sandstone_buff).
Target (MATERIAL_PRESETS.sandstone_carved_red): average #a8644c, roughness 0.78 (0.62-0.92).

Period notes: Mathura red sandstone carving (Shunga-Kushan) and the Sanchi / Bharhut motif vocabulary.
OWNER: Technical Artist A (TA-01) (sheet originally by the Technical Art Director).
"""
import pathlib
import sys
from dataclasses import replace

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

from lib import stone, texgen as tg  # noqa: E402
import _matkit as K  # noqa: E402
import _sandstone as SS  # noqa: E402

kit = K.Kit(__file__, cls="S", size=SS.SIZE, target="materials:MATERIAL_PRESETS.sandstone_carved_red",
            family="sandstone", saturation_limit="medium")

RED = replace(stone.RED_SANDSTONE, banding=0.0)  # seamless banding in _sandstone.iron_banding


def finishing(kit: K.Kit, c: dict) -> tuple[np.ndarray, np.ndarray]:
    alb, rough = c["albedo"], c["rough"]
    sid = c["masks"]["stone"]
    nrm = c["normal"]
    ao = c["ao"]
    alb = SS.iron_banding(kit, alb, 1.0)
    alb = SS.block_jitter(alb, sid, 0.012, 0.05)  # +-3 % of the hue circle split between stone tints and this
    # macro weathering: grey-green lichen colonies and soot / biological crust (0.5-2 m patches, low frequency so
    # the 2 m repeat reads as weather, not as a stamp)
    lz = tg.smoothstep(0.55, 0.78, kit.fbm(1.0, 4) * 0.5 + 0.5)
    lz = lz * tg.smoothstep(0.35, 0.65, kit.fbm(0.03, 3) * 0.5 + 0.5)  # granular colonies inside the zones
    up = tg.smoothstep(0.05, 0.45, nrm[..., 1])
    alb = K.tint(alb, "#6f705c", 0.45 * lz * (0.5 + 0.5 * up))
    soot = tg.smoothstep(0.45, 0.75, kit.fbm(0.7, 4) * 0.5 + 0.5) * (0.5 + 0.5 * tg.smoothstep(0.05, 0.35, 1.0 - ao))
    alb = K.tint(alb, "#2e2622", 0.35 * soot)
    # -12 % saturation: keep 75 % of the chroma scatter; calibration then puts the mean on the preset
    alb = K.compress_chroma(alb, 0.6)
    alb = K.saturate_by(alb, 0.88)
    r = rough + 0.05 * lz + 0.03 * soot
    return alb, r


SS.build(kit, RED, finishing,
         "Weathered carved red sandstone trim sheet: ashlar, creeper scroll, dentils, padma, bead-and-reel, lotus "
         "medallion frieze; per-block hue jitter, lichen and soot crusts (WP1-09 retune).")
