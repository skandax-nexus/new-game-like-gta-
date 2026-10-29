"""
@asset lens_dirt
@kind image
@tiers ultra

Subtle lens-dirt mask for the bloom composite (1024 px, ultra only, ASSET_LIST WP7-17, ART_BIBLE §4.7 "bloom
restrained"; Art Director review: no star field of specks, no hard-rimmed rings): soft noise-broken smudges and
finger wipes, three faint fingerprint whorls, seven irregular bokeh shapes of varied size with a gentle rim
(rim : centre <= 1.3) and only 40 soft dust specks (sigma 4.5 px), all very low contrast. The post stack multiplies the bloom texture by (0.25 + dirt x strength) so dirt only shows
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


def fbm(seed: int, freq: float, octaves: int = 4) -> np.ndarray:
    """Smooth value-ish fbm in [0, 1] from sums of rotated sines (deterministic)."""
    r = np.random.default_rng(seed)
    acc = np.zeros_like(x)
    amp, tot, f = 1.0, 0.0, freq
    for _ in range(octaves):
        for _ in range(3):
            a0, ph = r.uniform(0, np.pi), r.uniform(0, 2 * np.pi)
            acc += amp * np.sin((x * np.cos(a0) + y * np.sin(a0)) * f + ph)
            tot += amp
        amp *= 0.55
        f *= 2.1
    return acc / tot * 0.5 + 0.5


# soft smudges / finger wipes: elongated, broken up by noise (never clean ellipses)
breakup = fbm(11, 3.0, 5)
for _ in range(8):
    d += blob(rng.uniform(-1.6, 1.6), rng.uniform(-0.85, 0.85), rng.uniform(0.3, 0.75), rng.uniform(0.1, 0.32),
              rng.uniform(0, np.pi)) * rng.uniform(0.05, 0.12) * (0.4 + 1.2 * breakup)
# fingerprints: faint ridge whorls inside a soft oval, very low contrast
for k in range(3):
    cx, cy = rng.uniform(-1.4, 1.4), rng.uniform(-0.7, 0.7)
    ang0 = rng.uniform(0, np.pi)
    c0, s0 = np.cos(ang0), np.sin(ang0)
    u = ((x - cx) * c0 + (y - cy) * s0) / 0.11
    v = (-(x - cx) * s0 + (y - cy) * c0) / 0.15
    rr = np.sqrt(u * u + v * v)
    ridges = 0.5 + 0.5 * np.sin(rr * 24.0 + (u * 0.6 + v * 0.3) ** 2 * 3.0 + fbm(40 + k, 7.0, 3) * 9.0)
    partial = np.clip((fbm(60 + k, 4.0, 3) - 0.35) / 0.3, 0, 1)  # a smeared, partial print - never a clean target
    d += np.exp(-rr ** 2 * 1.1) * ridges * partial * rng.uniform(0.025, 0.04)
# a few irregular bokeh shapes of varied size: soft discs with a gentle rim (rim : centre <= 1.3), wobbly outline
for k in range(7):
    cx, cy = rng.uniform(-1.6, 1.6), rng.uniform(-0.85, 0.85)
    rad = rng.uniform(0.03, 0.16)
    a = np.arctan2(y - cy, x - cx)
    wob = 1.0 + 0.08 * np.sin(a * rng.integers(3, 7) + rng.uniform(0, 6.28)) + 0.05 * np.sin(a * 2 + rng.uniform(0, 6.28))
    rr = np.hypot(x - cx, y - cy) / (rad * wob)
    disc = np.clip((1.0 - rr) / 0.25, 0, 1)
    disc = disc * disc * (3 - 2 * disc)
    rim = np.exp(-((rr - 0.85) / 0.12) ** 2) * 0.28
    d += (disc * (1.0 + rim)) * rng.uniform(0.035, 0.07)
# very few dust specks, soft (sigma >= 4 px)
n = 40
sx = rng.integers(0, PX, n)
sy = rng.integers(0, PX, n)
specks = np.zeros_like(x)
specks[sy, sx] = rng.uniform(0.5, 1.0, n)
specks = tg.blur(specks, 4.5) * 22.0  # gaussian falloff, peak ~0.1-0.17: soft, never a hard dot
d += specks
d = np.clip(d, 0, 1)
rgb = np.stack([d, d * 0.97, d * 0.92], axis=-1)
_image.write(ctx, rgb, alpha=False, color_space="srgb", hdr_scale=1.0,
             tier_px={"ultra": 1024},
             usage="bloom dirt mask: bloom *= 0.25 + dirt * strength (ultra only)",
             description="Lens dirt: soft smudges, fingerprints, a few irregular bokeh shapes, 40 soft specks (low contrast).")
ctx.finish()
