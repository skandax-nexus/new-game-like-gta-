"""
@asset lut_identity
@kind lut
@tiers ultra,high

Exact identity 32^3 LUT (lattice (r, g, b) = round(255 * (r, g, b) / 31)): the neutral reference for LUT A/B
splits and the guard of tests/assets/lut.test.ts (every 8-bit input reproduced within 1/255).
OWNER: Technical Artist G (TA-07).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import _lut  # noqa: E402

_lut.build(__file__, preset=None)
