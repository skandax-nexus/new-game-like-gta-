"""
@asset sky_dusk
@kind hdri
@style lighting:LIGHTING_PRESETS.dusk

Dusk (WP7-03, P1): sun 2 deg below the western horizon (280 deg) - sky-only lighting, violet zenith and a
burning afterglow band, clouds 0.3 lit from below.
Built by _skykit.py from LIGHTING_PRESETS.dusk (Nishita parameters, light, fog tones) and calibrated so its
ambientIrradiance equals the preset's sky.irradiance (environmentIntensity 1 under the matching preset).
OWNER: Technical Artist G (TA-07).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import _skykit  # noqa: E402

ctx = _skykit.build(__file__, "dusk", treatment="dusk",
                    description="Dusk, sun -2 deg W, afterglow, sky-only lighting.")
ctx.finish()
