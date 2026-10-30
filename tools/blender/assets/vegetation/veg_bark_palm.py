"""
@asset veg_bark_palm
@kind material

WP4 bark set "palm" (C class: albedo 1024, normal / ORM 512; tierScale 0.5 -> 1024 / 512 / 256): seamless tiling bark
for the trunks and limbs of tree LOD0 (far LODs use the bark swatch inside the leaf atlas). Species pick their family
and tint it with samrajya_tint (TREE_SPECIES.trunk.bark / family colour). Procedural numpy synthesis (_bark.py), no
scans. OWNER: Technical Artist D (TA-04).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import _vegassets  # noqa: E402

_vegassets.bark_set(__file__, "palm")
