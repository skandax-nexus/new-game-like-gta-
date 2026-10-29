"""
@asset sky_overcast
@kind hdri
@style lighting:LIGHTING_PRESETS.monsoon

Monsoon overcast (WP7-05, P0): CIE overcast dome over a 95 % cloud deck, aerosol 4, soft diffuse light.
Built by _skykit.py from LIGHTING_PRESETS.monsoon (Nishita parameters, light, fog tones) and calibrated so its
ambientIrradiance equals the preset's sky.irradiance (environmentIntensity 1 under the matching preset).
OWNER: Technical Artist G (TA-07).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import _skykit  # noqa: E402

ctx = _skykit.build(__file__, "monsoon", treatment="overcast",
                    description="Monsoon overcast: heavy cloud deck, soft diffuse light.")
ctx.finish()
