"""
@asset tree_peepal
@kind model
@depends veg_leaves_a, veg_bark_fig
@style vegetation:TREE_SPECIES.peepal

WP4-02 Peepal (Ficus religiosa), shape variant a: tall open irregular crown with light through the gaps, smooth grey
fluted trunk (fig bark set), heart-shaped leaves with drip tips on long petioles that flutter (COLOR_0.B, species
flutter 1.0, WIND leaf 4.5 Hz). LOD0 / 1 / 2 within TREE_SPECIES.tris (14000 / 4000 / 800); LOD1-2 are one material
(trunk in the atlas bark swatch). Vasanta copper flush = leaf tint (TREE_SPECIES.leaf.vasanta) on the same cards;
foliage 0.75 in vasanta drops cards by their random r. Variant c (veg_tree_peepal_c) is the shrine tree with the
stone railing (vedika) and votive threads. Species basis: Ficus religiosa is native to the subcontinent and venerated
since the Indus period - not in BANNED_PLANTS. OWNER: Technical Artist D (TA-04).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import _vegassets  # noqa: E402

_vegassets.tree_model(__file__, "peepal", "a")
