"""
@asset veg_tree_peepal_impostor
@kind impostor
@depends veg_leaves_a, veg_bark_fig
@style vegetation:TREE_SPECIES.peepal

WP4-02 Peepal impostor: hemi-octahedral 8 x 8 capture (256 / 192 / 128 px frames, TA-07 'impostor' kind) of tree_peepal
variant a with the leaf atlas (alpha cut 0.5), vertex AO and bent normals; normal + depth at a quarter of the frame
size. Used beyond 220 m (QualitySettings.treeImpostorDistance x ZoomLook.lodBias). Species basis: Ficus religiosa
(native; not in BANNED_PLANTS). OWNER: Technical Artist D (TA-04).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import _vegassets  # noqa: E402

_vegassets.tree_impostor(__file__, "peepal", "a")
