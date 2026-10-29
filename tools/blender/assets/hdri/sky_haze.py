"""
@asset sky_haze
@kind hdri
@style lighting:LIGHTING_PRESETS.dry_haze

Dry-season haze (WP7-06, P1, grishma): aerosol 5, almost cloudless, dusty ochre horizon band.
Built by _skykit.py from LIGHTING_PRESETS.dry_haze (Nishita parameters, light, fog tones) and calibrated so its
ambientIrradiance equals the preset's sky.irradiance (environmentIntensity 1 under the matching preset).
OWNER: Technical Artist G (TA-07).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import _skykit  # noqa: E402

ctx = _skykit.build(__file__, "dry_haze", treatment="haze",
                    description="Grishma haze: dusty ochre horizon, almost cloudless.")
ctx.finish()
