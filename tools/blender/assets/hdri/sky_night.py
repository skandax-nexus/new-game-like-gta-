"""
@asset sky_night
@kind hdri
@style lighting:LIGHTING_PRESETS.night

Night (WP7-04, P0): moonlit dome with stars and a faint Milky Way, thin moonlit clouds; the moon disc is
removed and given to the light (manifest sun = the moon, 42 deg / 150 deg), irradiance 0.08.
Built by _skykit.py from LIGHTING_PRESETS.night (Nishita parameters, light, fog tones) and calibrated so its
ambientIrradiance equals the preset's sky.irradiance (environmentIntensity 1 under the matching preset).
OWNER: Technical Artist G (TA-07).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import _skykit  # noqa: E402

ctx = _skykit.build(__file__, "night", treatment="night", stars=True,
                    description="Moonlit night: stars, Milky Way, thin clouds; moon = manifest sun, irradiance 0.08.")
ctx.finish()
