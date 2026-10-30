"""
@asset veg_leaves_a_orm
@kind image
@depends veg_leaves_a

WP4 leaf atlas page A ORM map: R spray ambient occlusion, G roughness, B translucency (leaf thickness) at half the colour
resolution (1024 / 512 / 256), same UVs as veg_leaves_a (eight broadleaf species - see that script for the species
basis). OWNER: Technical Artist D (TA-04).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import _vegassets  # noqa: E402

_vegassets.atlas_map(__file__, "a", "orm")
