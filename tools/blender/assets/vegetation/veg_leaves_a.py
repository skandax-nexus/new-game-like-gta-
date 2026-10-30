"""
@asset veg_leaves_a
@kind image
@style vegetation:TREE_SPECIES.banyan, vegetation:TREE_SPECIES.peepal, vegetation:TREE_SPECIES.mango, vegetation:TREE_SPECIES.neem, vegetation:TREE_SPECIES.sal, vegetation:TREE_SPECIES.teak, vegetation:TREE_SPECIES.palash, vegetation:TREE_SPECIES.amaltas

WP4 leaf atlas page A, broadleaf trees (A class 2048 / 1024 / 512, sRGB colour + coverage alpha; 8 species blocks of
4 x 2 cells, regions in each tree model's meta):
    banyan  elliptic leathery leaves with paired red figs, aerial-root curtain, bark swatch
    peepal  heart-shaped leaves with long drip tips, purple figs, votive-thread band, bark swatch
    mango   lanceolate leaves in terminal rosettes; flowering alternates (shishira-vasanta) add cream panicles
    neem    pinnate serrate leaflets; alternates (vasanta) add white blossom panicles
    sal     ovate-oblong glossy leaves; alternates (vasanta) add cream flower panicles over the light flush
    teak    huge rough leaves; alternates (varsha) add white flower plumes; bare-twig card for grishma
    palash  trifoliate leaves; alternates (vasanta) = leafless twigs blazing with orange-red flowers; bare twigs
    amaltas pinnate leaves; alternates (grishma) = hanging golden flower chains over thinned leaves
Procedural outlines and vein networks only - no scans. Base regions are painted in TREE_SPECIES.leaf.sharad and
calibrated to it (QA in the meta); alternates carry their own season's colours. Transparent texels are push-pull
filled (alpha floor 10/255). Species basis (none in BANNED_PLANTS): Ficus benghalensis, Ficus religiosa, Mangifera
indica, Azadirachta indica, Shorea robusta, Tectona grandis, Butea monosperma, Cassia fistula - all native to the
subcontinent. OWNER: Technical Artist D (TA-04).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import _vegassets  # noqa: E402

_vegassets.atlas_page(__file__, "a")
