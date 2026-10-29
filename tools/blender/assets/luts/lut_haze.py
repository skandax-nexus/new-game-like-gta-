"""
@asset lut_haze
@kind lut
@tiers ultra,high
@style palette:GRADE_PRESETS.haze
@inputs docs/art/luts/lut_haze.cube, docs/art/luts/lut_haze.png

Grishma dry haze - warm, milky lift, low contrast (LIGHTING_PRESETS.dry_haze).
32^3 grade LUT as a lossless 1024 x 32 strip (ASSET_LIST WP7-08). Interim: generated from
GRADE_PRESETS.haze with the lookdev grade math until the Art Director drops docs/art/luts/lut_haze.cube (the
runner re-bakes automatically: the file is an @inputs dependency). Shipped on ultra / high only - ART_BIBLE
§4.7 applies LUTs at 35 % strength on high / ultra. OWNER: Technical Artist G (TA-07).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import _lut  # noqa: E402

_lut.build(__file__, preset="haze")
