"""
@asset sky_day
@kind hdri

Clear late-morning sky over the Gangetic plain (sun 42 deg high in the south-east), hazy horizon.
Physical multiple-scattering sky baked to half-float EXR tiers; the sun disc is removed from the map
and described in the metadata for the runtime DirectionalLight. OWNER: Technical Art Director.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from lib import core, sky  # noqa: E402

ctx = core.begin(__file__, kind="hdri")
ctx.meta.update(sky.bake_sky(ctx, sun_elevation=42.0, sun_azimuth=128.0, aerosol=1.8, air=1.0, ozone=1.0,
                             ground_albedo=(0.24, 0.19, 0.14)))
ctx.meta["description"] = "Clear late-morning sky, sun 42 deg SE, light haze (lookdev / daytime IBL)."
ctx.finish()
