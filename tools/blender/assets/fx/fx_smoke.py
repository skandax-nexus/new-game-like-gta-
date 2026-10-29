"""
@asset fx_smoke
@kind flipbook

Billowing smoke puff over its life (8 x 8 = 64 frames, one-shot): a curl-noise particle volume expanding,
rising and thinning out, rendered with Cycles as an occlusion-only albedo plus a tangent-space normal map
from its optical depth, so the runtime lights it with the sun (ART_BIBLE §10 "sun-lit tops", no unlit puffs).
Plumes are built from many of these (10-40 m, life 8-15 s); tint by the particle color (building smoke
`#4a4038`, steam / dust lighter). Atlas 1024 / 1024 / 512 (ASSET_LIST WP7-09). OWNER: Technical Artist G (TA-07).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import _fxkit as kit  # noqa: E402
from lib import flipbook as fb  # noqa: E402

ctx = fb.begin(__file__)
FRAMES = 64
EXTENT = (2.4, 2.4, 3.0)
grid = 64 if not ctx.draft else 40
px = ctx.res(128, 64)
dens = kit.puff_frames(11, FRAMES, 4.0, EXTENT, grid=grid, count=2600 if not ctx.draft else 1100, origin=(0.0, 0.0, 0.7),
                       radius=0.42, clusters=16, burst=0.42, rise=0.9, drag=0.85, turbulence=0.2, curl_freq=2.2,
                       life=(1.0, 1.15), fade_out=0.45)
vox = max(EXTENT) / (grid - 1)
k = 4.5 / max(kit.peak_density(dens, vox), 1e-6)
color, normals = kit.lit_volume_frames(dens, EXTENT, px, k_ext=k, albedo=(0.6, 0.585, 0.565), samples=ctx.samples(16, 6),
                                       flatten=0.4)
meta = fb.write(ctx, color, 8, 8, fps=16, loop=False, normals=normals, blend="alpha", lit=True, soft_fade_m=0.8,
                size_m=(4.0, 5.0), atlas_px={"ultra": 1024, "high": 1024, "mobile": 512},
                description="Billowing smoke puff over life (64 frames, one-shot), lit via normals; tint #4a4038 for fires.")
meta["tint"] = "#4a4038"
ctx.meta.update(meta)
ctx.finish()
