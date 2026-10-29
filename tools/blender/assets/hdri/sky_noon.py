"""
@asset sky_noon
@kind hdri
@style lighting:LIGHTING_PRESETS.noon

Noon (WP7-02, P1): sun 62 deg high in the south (170 deg), clear air, light cumulus (0.18) - replaces
sky_day as the noon key light.
Built by _skykit.py from LIGHTING_PRESETS.noon (Nishita parameters, light, fog tones) and calibrated so its
ambientIrradiance equals the preset's sky.irradiance (environmentIntensity 1 under the matching preset).
OWNER: Technical Artist G (TA-07).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import _skykit  # noqa: E402

ctx = _skykit.build(__file__, "noon", treatment="clear",
                    description="Noon, sun 62 deg S, clear with light cumulus (noon key).")
ctx.finish()
