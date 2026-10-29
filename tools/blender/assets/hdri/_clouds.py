"""
Package-local helper (hdri): sun-shaded cloud layers and the monsoon nimbostratus deck for the WP7 skies.
OWNER: Technical Artist G (TA-07). Not an asset (leading underscore). Used by _skykit.py.

Clouds live on a flat layer above the observer (equirect direction d -> layer point d.xy / d.z), like lib/sky.py,
but are SHADED BY THE SUN instead of being flat fills (Art Director review of sky_dawn):
  - density: domain-warped fBm, edges eroded by a finer noise (wispy, torn edges; cores stay solid);
  - light: optical depth marched through the layer towards the sun (in-plane, 8 steps) -> transmittance; a 3-tone
    ramp (shadow -> mid -> lit) gives a readable lit side facing the sun and a darker far side;
  - bases: thick cores darken (seen from below);
  - silver lining: thin edges glow with a forward-scattering lobe within ~35 deg of the sun (backlit rims).
Everything is deterministic numpy (seeded gradient tables), evaluated at the equirect resolution.
"""
from __future__ import annotations

import math
from typing import Sequence

import numpy as np

F = np.float32


def _smooth(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


class Noise2:
    """Periodic 2D gradient noise with fixed (seeded) gradient tables per octave - re-evaluable at any point."""

    def __init__(self, seed: int, octaves: int = 6, period: int = 256, gain: float = 0.5, lacunarity: float = 2.0) -> None:
        rng = np.random.default_rng(seed)
        self.tables = []
        for _ in range(octaves):
            ang = rng.uniform(0, 2 * np.pi, (period, period))
            off = rng.uniform(0, period, 2)
            self.tables.append((np.cos(ang).astype(F), np.sin(ang).astype(F), off))
        self.period = period
        self.gain = gain
        self.lac = lacunarity

    def _octave(self, x: np.ndarray, y: np.ndarray, k: int) -> np.ndarray:
        gx, gy, off = self.tables[k]
        x = x + off[0]
        y = y + off[1]
        p = self.period
        xi = np.floor(x)
        yi = np.floor(y)
        xf = (x - xi).astype(F)
        yf = (y - yi).astype(F)
        x0 = xi.astype(np.int64) % p
        y0 = yi.astype(np.int64) % p
        x1 = (x0 + 1) % p
        y1 = (y0 + 1) % p
        u = xf * xf * xf * (xf * (xf * 6 - 15) + 10)
        v = yf * yf * yf * (yf * (yf * 6 - 15) + 10)
        n00 = gx[y0, x0] * xf + gy[y0, x0] * yf
        n10 = gx[y0, x1] * (xf - 1) + gy[y0, x1] * yf
        n01 = gx[y1, x0] * xf + gy[y1, x0] * (yf - 1)
        n11 = gx[y1, x1] * (xf - 1) + gy[y1, x1] * (yf - 1)
        a = n00 + (n10 - n00) * u
        b = n01 + (n11 - n01) * u
        return ((a + (b - a) * v) * 1.4142).astype(F)

    def fbm(self, x: np.ndarray, y: np.ndarray, octaves: int | None = None) -> np.ndarray:
        """fBm in ~[0, 1] (0.5 mean)."""
        n = octaves or len(self.tables)
        acc = np.zeros(np.shape(x), F)
        amp, f, tot = 1.0, 1.0, 0.0
        for k in range(n):
            acc += amp * self._octave(x * f, y * f, k)
            tot += amp
            amp *= self.gain
            f *= self.lac
        return (acc / tot * 0.5 + 0.5).astype(F)


def directions(H: int, W: int) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Equirect (lib/sky layout, top row = zenith): latitude, azimuth phi (Blender, from +X towards +Y), dx, dy, dz."""
    lat = (0.5 - (np.arange(H) + 0.5) / H) * math.pi
    phi = (0.5 - (np.arange(W) + 0.5) / W) * 2 * math.pi
    LAT, PHI = np.meshgrid(lat, phi, indexing="ij")
    return LAT, PHI, np.cos(LAT) * np.cos(PHI), np.cos(LAT) * np.sin(PHI), np.sin(LAT)


def cloud_density(noise: Noise2, warp: Noise2, erode: Noise2, px: np.ndarray, py: np.ndarray, coverage: float,
                  wisp: float = 1.0) -> np.ndarray:
    """Cloud coverage 0..1 at layer points: domain-warped fBm, edges eroded by a fine noise (cores untouched)."""
    wx = warp.fbm(px * 0.6 + 3.1, py * 0.6 - 7.7, 4) - 0.5
    wy = warp.fbm(px * 0.6 - 11.3, py * 0.6 + 2.9, 4) - 0.5
    base = noise.fbm(px + 1.2 * wx, py + 1.2 * wy)
    lo = 0.6 - 0.3 * coverage
    core = _smooth(lo, lo + 0.22, base)
    fine = erode.fbm(px * 5.0, py * 5.0, 4)
    raw = base - wisp * 0.16 * (fine - 0.35) * (1.0 - core)
    return _smooth(lo, lo + 0.12, raw).astype(F)


def cloud_layer(sky: np.ndarray, sun_dir: Sequence[float], sun_rgb: np.ndarray, coverage: float, seed: int, *,
                scale: float = 1.0, ambient_rgb: np.ndarray | None = None, lit_gain: float = 0.3, rim_gain: float = 1.0,
                rim_deg: float = 35.0, thickness: float = 2.2, wisp: float = 1.0, horizon_fade: tuple[float, float] = (0.05, 0.3),
                max_alpha: float = 0.95, march_len: float = 0.5, march_steps: int = 10, sun_white: float = 0.3,
                base_dark: float = 0.35, shadow_gain: float = 1.0) -> tuple[np.ndarray, np.ndarray]:
    """Composite a sun-shaded cloud layer over an equirect sky. `sun_dir` in Blender axes (z up; may be slightly
    below the horizon for dusk afterglow), `sun_rgb` = sun radiance scale (color x intensity in the sky's units).
    Returns (sky with clouds, cloud alpha)."""
    if coverage <= 0:
        return sky, np.zeros(sky.shape[:2], F)
    H, W = sky.shape[:2]
    LAT, _, dx, dy, dz = directions(H, W)
    up = dz > 0.004
    t = np.where(up, 1.0 / np.maximum(dz, 0.004), 0.0)
    k = 1.6 * scale
    px, py = (dx * t * k).astype(F), (dy * t * k).astype(F)
    noise = Noise2(seed, 6)
    warp = Noise2(seed + 1, 4)
    erode = Noise2(seed + 2, 4)
    dens = cloud_density(noise, warp, erode, px, py, coverage, wisp)
    dens *= _smooth(horizon_fade[0], horizon_fade[1], dz) * up
    s = np.array(sun_dir, np.float64)
    s /= max(np.linalg.norm(s), 1e-9)
    # in-plane march towards the sun: the lower the sun, the longer the path through the layer per unit height
    horiz = math.hypot(s[0], s[1])
    if horiz > 1e-4:
        sx, sy = s[0] / horiz, s[1] / horiz
        slope = min(horiz / max(abs(s[2]), 0.08), 6.0)
    else:
        sx, sy, slope = 0.0, 0.0, 0.0
    steps = int(march_steps)
    tau = np.zeros_like(dens)
    for i in range(1, steps + 1):
        qx, qy = px + sx * march_len * k * i / steps, py + sy * march_len * k * i / steps
        tau += cloud_density(noise, warp, erode, qx, qy, coverage, wisp)
    # optical depth through the body towards the sun (+ own thickness when the sun is high)
    tau = tau / steps * (0.6 + 0.4 * slope / 6.0) + dens * (1.0 - slope / 6.0) * 0.6
    trans = np.exp(-thickness * tau)
    # 3-tone ramp: shadow -> mid -> lit
    s1 = _smooth(0.12, 0.32, trans)
    s2 = _smooth(0.45, 0.7, trans)
    mu = dx * s[0] + dy * s[1] + dz * s[2]
    amb = ambient_rgb if ambient_rgb is not None else sky[: H // 2].reshape(-1, 3).mean(axis=0)
    sun_soft = sun_rgb * (1 - sun_white) + float(sun_rgb.max()) * sun_white  # less saturated than the raw disc colour
    lit = sun_soft[None, None, :] * lit_gain * (0.85 + 0.35 * np.clip(mu, 0, 1) ** 2)[..., None]
    shadow = amb[None, None, :] * shadow_gain * (1.05 - 0.3 * dens)[..., None]
    mid = shadow * 0.45 + lit * 0.55
    col = shadow * (1 - s1[..., None]) + mid * s1[..., None]
    col = col * (1 - s2[..., None]) + lit * s2[..., None]
    # thick cores (bases seen from below) darken
    col = col * (1.0 - base_dark * _smooth(0.55, 1.0, dens))[..., None]
    # silver lining: thin edges near the sun, forward scattering (Henyey-Greenstein g = 0.8, normalized to 1 at mu = 1)
    g = 0.8
    hg = (1 - g * g) / np.power(np.maximum(1 + g * g - 2 * g * mu, 1e-6), 1.5) * ((1 - g) ** 2 / (1 - g * g))
    near = _smooth(math.cos(math.radians(rim_deg)), 1.0, mu)
    edge = np.clip(4.0 * dens * (1.0 - dens), 0, 1) ** 1.5
    col = col + sun_rgb[None, None, :] * (rim_gain * 0.35 * hg * near * edge)[..., None]
    a = (max_alpha * dens)[..., None]
    out = (sky * (1 - a) + col * a).astype(F)
    return out, (a[..., 0]).astype(F)


def nimbostratus(sky_shape: tuple[int, int], deck_rgb: np.ndarray, haze_lo: np.ndarray, haze_hi: np.ndarray, seed: int, *,
                 thin_az_deg: float = 180.0, shafts: Sequence[float] = (250.0, 35.0)) -> tuple[np.ndarray, dict[str, float]]:
    """Monsoon overcast dome (Art Director review): a continuous nimbostratus deck over the whole upper hemisphere,
    darker rain-laden bases (0.6-0.75 x deck), ragged lighter thinning towards azimuth `thin_az_deg`, a brighter
    wet-haze band in the last ~8 deg above the horizon (fog family haze_lo -> haze_hi) and distant rain shafts.
    Radiance is relative (the caller calibrates the irradiance). Returns (sky, stats)."""
    H, W = sky_shape
    LAT, PHI, dx, dy, dz = directions(H, W)
    up = dz > 0
    t = np.where(up, 1.0 / np.maximum(dz, 0.02), 0.0)
    px, py = (dx * t * 0.9).astype(F), (dy * t * 0.9).astype(F)
    n1 = Noise2(seed, 6)
    n2 = Noise2(seed + 1, 5)
    n3 = Noise2(seed + 2, 4)
    el = np.degrees(np.clip(LAT, 0, None))
    # azimuth convention (sun_dir_bl): compass az -> rot = 90 - az, phi = rot
    az = (90.0 - np.degrees(PHI)) % 360.0

    def near_az(target: float, width: float) -> np.ndarray:
        d = np.abs(((az - target) + 180.0) % 360.0 - 180.0)
        return np.exp(-(d / width) ** 2)

    # deck: soft large undulations (+-10 %), stretched along one axis (stratiform), plus fine mottling
    deck = 0.9 + 0.2 * n1.fbm(px * 0.55, py * 1.1, 5)
    deck = deck * (0.94 + 0.12 * n3.fbm(px * 3.0 + 9.0, py * 3.0, 4))
    # rain-laden bases: soft-edged darker regions down to ~0.64 x, with streaky inner texture
    bn = n2.fbm(px * 0.8 + 4.0, py * 1.3 - 2.0, 5)
    bases = _smooth(0.44, 0.74, bn) * (0.75 + 0.25 * n3.fbm(px * 1.8 - 3.0, py * 4.0, 3))
    lum = deck * (1.0 - 0.38 * bases)
    # ragged thinning towards az 180, low-mid elevations: brighter, torn, larger breaks
    thin = near_az(thin_az_deg, 45.0) * _smooth(40.0, 4.0, el)
    rag = _smooth(0.42, 0.68, n3.fbm(px * 0.9 - 6.0, py * 0.9 + 1.0, 4))
    lum = lum * (1.0 + thin * (0.18 + 0.55 * rag))
    # zenith slightly brighter than the mid deck (CIE overcast), horizon handled by the haze band
    lum = lum * (0.9 + 0.2 * np.sin(np.clip(LAT, 0, None)))
    col = deck_rgb[None, None, :] * lum[..., None]
    # distant rain shafts: greyer, vertically streaked columns from the deck base down into the haze band
    streak = Noise2(seed + 3, 3)
    for sh in shafts:
        m = near_az(sh, 6.0) * _smooth(18.0, 6.0, el) * up
        st = streak.fbm(np.degrees(PHI).astype(F) * 1.6, el.astype(F) * 0.05, 3)
        k = (m * (0.5 + 0.5 * st))[..., None]
        col = col * (1 - 0.45 * k) + deck_rgb[None, None, :] * 0.55 * (0.45 * k)
    # wet-haze band: the last ~8 deg brighten into the fog family (#8c989a above -> #c6cecc at the horizon)
    band = _smooth(9.0, 0.0, el)[..., None] * up[..., None]
    hz = haze_lo[None, None, :] * (1 - band) + haze_hi[None, None, :] * band
    dl = float((deck_rgb * np.array([0.2126, 0.7152, 0.0722])).sum())
    hl = float((haze_hi * np.array([0.2126, 0.7152, 0.0722])).sum())
    hz = hz / max(hl, 1e-6) * dl * 1.6
    col = col * (1 - band * 0.9) + hz * (band * 0.9)
    covered = float(((bases + (1 - thin)) > 0).mean())
    stats = {"basesMin": float(1.0 - 0.38), "thinArea": float((thin * rag > 0.3).sum() / max(int(up.sum()), 1)), "covered": covered}
    return np.where(up[..., None], col, 0.0).astype(F), stats


__all__ = ["Noise2", "cloud_density", "cloud_layer", "directions", "nimbostratus"]
