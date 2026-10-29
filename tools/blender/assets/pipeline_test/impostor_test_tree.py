"""
@asset impostor_test_tree
@kind impostor

Pipeline test asset (TA-07): hemi-octahedral impostor (8 x 8 frames, 256 / 192 / 128 px per tier; albedo +
coverage, object-space normal + depth) of the 12 m test tree, captured with lib/impostor.py from the same
builder as model_test_tree. The asset viewer A/B (`?asset=impostor_test_tree&dist=220`) compares it with the
mesh; scripts/shots/ta-07.cjs measures the luminance difference of the crop (< 5 %). OWNER: Technical Artist G (TA-07).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import _test_tree  # noqa: E402
from lib import impostor  # noqa: E402

ctx = impostor.begin(__file__)
objs = _test_tree.build(detail=1)
ctx.meta.update(impostor.capture(ctx, objs, grid=8, frame_px=256, samples=16, switch_distance=90.0, source="model_test_tree"))
ctx.meta["description"] = "Pipeline test: hemi-octahedral impostor of the 12 m test tree (A/B with model_test_tree)."
ctx.finish()
