"""
@asset lut_dusk
@kind lut
@tiers ultra,high
@style palette:GRADE_PRESETS.dusk
@inputs docs/art/luts/lut_dusk.cube, docs/art/luts/lut_dusk.png

Dusk - lamps are lit: violet shadows, warm key (LIGHTING_PRESETS.dusk).
32^3 grade LUT as a lossless 1024 x 32 strip (ASSET_LIST WP7-08). Interim: generated from
GRADE_PRESETS.dusk with the lookdev grade math until the Art Director drops docs/art/luts/lut_dusk.cube (the
runner re-bakes automatically: the file is an @inputs dependency). Shipped on ultra / high only - ART_BIBLE
§4.7 applies LUTs at 35 % strength on high / ultra. OWNER: Technical Artist G (TA-07).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import _lut  # noqa: E402

_lut.build(__file__, preset="dusk")
