"""
@asset sky_dawn
@kind hdri
@style lighting:LIGHTING_PRESETS.dawn

Dawn (ASSET_LIST WP7-01, P0): sun 6 deg above the eastern horizon (95 deg), pink-gold scattering,
thin cloud (0.25) catching the first light.
Built by _skykit.py from LIGHTING_PRESETS.dawn (Nishita parameters, light, fog tones) and calibrated so its
ambientIrradiance equals the preset's sky.irradiance (environmentIntensity 1 under the matching preset).
OWNER: Technical Artist G (TA-07).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import _skykit  # noqa: E402

ctx = _skykit.build(__file__, "dawn", treatment="clear",
                    description="Dawn, sun 6 deg E, pink-gold haze, thin clouds.")
ctx.finish()
