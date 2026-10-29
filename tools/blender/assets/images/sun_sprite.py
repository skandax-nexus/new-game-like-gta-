"""
@asset sun_sprite
@kind image

HDR sun disc + glow sprite (512 px, ASSET_LIST WP7-17): a limb-darkened photosphere (0.53 deg disc, linear limb
darkening u = 0.6) inside a two-lobe glow (tight aureole + wide halo) and a faint 6-spoke starburst. Stored as
L / 50 sRGB-encoded (the sRGB curve keeps precision in the dim halo); the runtime multiplies the decoded texel by
`hdrScale` 50, so the disc reaches ~50x a white sky texel. Drawn additively at the sun direction, ~6 deg wide,
tinted by the active preset's sun color. Same art on every tier (512 / 512 / 256). OWNER: Technical Artist G (TA-07).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

import _image  # noqa: E402

ctx = _image.begin(__file__)
PX = 1024  # supersampled, published at 512 / 256
x, y = _image.coords(PX)
r = np.hypot(x, y)  # 1.0 = half the sprite = 3 deg
DISC = 0.53 / 2 / 3.0  # disc radius in sprite units
mu = np.sqrt(np.clip(1.0 - (r / DISC) ** 2, 0, 1))
disc = (r < DISC) * (1.0 - 0.6 * (1.0 - mu)) * 50.0
# soft disc edge (anti-aliased over ~1.5 px at the published 512 px)
edge = np.clip((DISC - r) / (1.5 / 256), 0, 1)
disc = disc * edge
aureole = 6.0 * np.exp(-((r / (DISC * 2.2)) ** 2))
halo = 0.9 / (1.0 + (r / 0.12) ** 2.2)
ang = np.arctan2(y, x)
spokes = 0.35 * np.abs(np.cos(3.0 * ang)) ** 40 * np.exp(-r / 0.25)
L = disc + aureole + halo + spokes
# fade to exactly zero at the sprite border
L *= np.clip((1.0 - r) / 0.15, 0, 1) ** 2
# warm-white photosphere, slightly warmer halo (tinted again at runtime by the preset's sun color)
rgb = np.stack([L * 1.0, L * 0.97, L * 0.92], axis=-1)
rgb[..., 2] -= halo * 0.06
_image.write(ctx, np.clip(rgb / 50.0, 0, 1), alpha=False, color_space="srgb", hdr_scale=50.0,
             tier_px={"ultra": 512, "high": 512, "mobile": 256},
             usage="additive sun sprite: L = texel x hdrScale, tinted by the preset sun color, ~6 deg on screen",
             description="HDR sun disc (limb darkened) + aureole + halo + faint starburst; L / 50, sRGB.")
ctx.finish()
