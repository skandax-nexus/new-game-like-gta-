"""
@asset sky_fog
@kind hdri
@style lighting:LIGHTING_PRESETS.winter_fog
@tiers ultra,high
@fallback sky_overcast

Winter fog (WP7-07, P2, shishira): aerosol 6, low sun (12 deg), pale fog wall at the horizon. High / ultra
only; the mobile tier falls back to sky_overcast.
Built by _skykit.py from LIGHTING_PRESETS.winter_fog (Nishita parameters, light, fog tones) and calibrated so its
ambientIrradiance equals the preset's sky.irradiance (environmentIntensity 1 under the matching preset).
OWNER: Technical Artist G (TA-07).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import _skykit  # noqa: E402

ctx = _skykit.build(__file__, "winter_fog", treatment="fog", tiers={"ultra": 2048, "high": 1024},
                    description="Shishira fog: low sun, pale fog wall (high / ultra; mobile -> sky_overcast).")
ctx.finish()
