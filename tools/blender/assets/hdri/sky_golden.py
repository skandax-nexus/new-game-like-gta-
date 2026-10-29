"""
@asset sky_golden
@kind hdri

Golden-hour sky (sun 7 deg above the western horizon), warm dusty haze - the cinematic key-art light
for hero mode and cutscenes. OWNER: Technical Art Director.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from lib import core, sky  # noqa: E402

ctx = core.begin(__file__, kind="hdri")
ctx.meta.update(sky.bake_sky(ctx, sun_elevation=7.0, sun_azimuth=258.0, aerosol=3.2, air=1.3, ozone=1.2,
                             ground_albedo=(0.26, 0.19, 0.12), clouds=0.38, cloud_scale=0.8))
ctx.meta["description"] = "Golden hour, sun 7 deg W, warm dusty haze (cinematic / hero mode)."
ctx.finish()
