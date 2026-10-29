"""
@asset lens_dirt
@kind image
@tiers ultra

Subtle lens-dirt mask for the bloom composite (1024 px, ultra only, ASSET_LIST WP7-17, ART_BIBLE §4.7 "bloom
restrained"): a few large faint smudges, dried droplet rings, fine dust specks and soft hexagonal aperture ghosts,
all very low contrast. The post stack multiplies the bloom texture by (0.25 + dirt x strength) so dirt only shows
where bright light (sun, fires) blooms - never as a static overlay. Grayscale with a hint of warmth, sRGB, no alpha.
The sprite never ships to high / mobile (no @fallback: the loader returns null and the bloom stays clean).
OWNER: Technical Artist G (TA-07).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

import _image  # noqa: E402
from lib import texgen as tg  # noqa: E402

ctx = _image.begin(__file__)
PX = 1024
x, y = _image.coords(PX)
x = x * 16 / 9  # authored for a 16:9 screen, sampled stretched
rng = np.random.default_rng(int(ctx.seed) % (2 ** 32))
d = np.zeros_like(x)


def blob(cx: float, cy: float, rx: float, ry: float, ang: float) -> np.ndarray:
    c, s = np.cos(ang), np.sin(ang)
    u = ((x - cx) * c + (y - cy) * s) / rx
    v = (-(x - cx) * s + (y - cy) * c) / ry
    return np.exp(-(u * u + v * v))


# large, faint smudges (finger wipes)
for _ in range(9):
    d += blob(rng.uniform(-1.6, 1.6), rng.uniform(-0.9, 0.9), rng.uniform(0.25, 0.7), rng.uniform(0.08, 0.3),
              rng.uniform(0, np.pi)) * rng.uniform(0.06, 0.16)
# dried droplets: soft disc + brighter rim
for _ in range(28):
    cx, cy = rng.uniform(-1.75, 1.75), rng.uniform(-0.98, 0.98)
    rad = rng.uniform(0.01, 0.045)
    rr = np.hypot(x - cx, y - cy) / rad
    d += (np.exp(-rr ** 4) * 0.08 + np.exp(-((rr - 1.0) / 0.25) ** 2) * 0.16) * rng.uniform(0.3, 1.0)
# hexagonal aperture ghosts (very soft)
ang = np.arctan2(y, x)
for _ in range(6):
    cx, cy = rng.uniform(-1.5, 1.5), rng.uniform(-0.8, 0.8)
    rad = rng.uniform(0.06, 0.14)
    a = np.arctan2(y - cy, x - cx)
    hexr = rad * np.cos(np.pi / 6) / np.cos(((a + np.pi / 6) % (np.pi / 3)) - np.pi / 6)
    rr = np.hypot(x - cx, y - cy)
    d += np.clip((hexr - rr) / (rad * 0.6), 0, 1) * rng.uniform(0.03, 0.07)
# fine dust specks
n = 420
sx = rng.integers(0, PX, n)
sy = rng.integers(0, PX, n)
specks = np.zeros_like(x)
specks[sy, sx] = rng.uniform(0.1, 0.6, n)
specks = tg.blur(specks, 1.1) * 4.0
d += specks
d = np.clip(d, 0, 1)
rgb = np.stack([d, d * 0.97, d * 0.92], axis=-1)
_image.write(ctx, rgb, alpha=False, color_space="srgb", hdr_scale=1.0,
             tier_px={"ultra": 1024},
             usage="bloom dirt mask: bloom *= 0.25 + dirt * strength (ultra only)",
             description="Lens dirt: smudges, droplet rings, dust specks, faint hexagonal ghosts (low contrast).")
ctx.finish()
