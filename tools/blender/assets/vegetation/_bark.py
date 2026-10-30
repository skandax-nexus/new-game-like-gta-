"""
WP4 bark texture synthesis (package-local helper, not an asset): seamless tiling bark height / albedo / roughness
for the four bark families of ART_BIBLE §7.2 (fig smooth grey, furrowed dark, fibrous light, palm ringed).
OWNER: Technical Artist D (TA-04).

    maps = bark_maps("furrowed", res=1024, tile_m=1.0, base=linear_rgb, rng=rng)
    -> {"albedo" (linear rgb), "normal" (encoded 0..1), "orm" (AO, rough, metal 0), "height" (m)}

Everything is periodic over the tile (texgen noise in tile units); +V runs up the trunk (cylinder_uv / tube UVs).
"""
from __future__ import annotations

import numpy as np

from lib import texgen as tg

F = np.float32


def _stretch(rng: np.random.Generator, x: np.ndarray, y: np.ndarray, cells: tuple[int, int], octaves: int,
             ridged: bool = False) -> np.ndarray:
    return tg.fbm(x, y, cells, octaves, rng, ridged=ridged)


def bark_maps(family: str, res: int, tile_m: float, base: np.ndarray, rng: np.random.Generator) -> dict[str, np.ndarray]:
    x, y = tg.coords(res, res)
    texel = tile_m / res
    if family == "fig":
        # smooth grey skin (Ficus): broad light / dark mottling, pale lichen-like patches, faint vertical folds,
        # horizontal lenticel dashes and wrinkle rings
        mott = tg.fbm(x, y, 3, 5, rng)
        folds = tg.fbm(x, y, (6, 1), 3, rng)
        lx, ly = tg.warp(x, y, 0.02, 4, 2, rng)
        f1, f2, cid = tg.worley(lx, ly * 0.35, (26, 9), rng, jitter=0.9)
        dash = np.clip(1.0 - f1 / 0.3, 0, 1) ** 2 * (cid > 0.3)
        wr = np.abs(tg.fbm(x, y, (2, 11), 3, rng))
        wrinkle = np.clip(1 - wr / 0.1, 0, 1) * np.clip(tg.fbm(x, y, (3, 2), 2, rng) + 0.3, 0, 1)
        h = 0.003 * folds + 0.001 * mott - 0.0009 * dash + 0.0008 * wrinkle
        pale = tg.smoothstep(0.5, 0.72, tg.fbm(x + 0.31, y, 4, 5, rng) * 0.5 + 0.5)
        dark = tg.smoothstep(0.58, 0.8, tg.fbm(x, y + 0.7, 6, 4, rng) * 0.5 + 0.5)
        col = base[None, None, :] * (1.0 + 0.22 * mott[..., None] + 0.08 * folds[..., None])
        col = col * (1 - 0.45 * dash[..., None]) * (1 - 0.25 * wrinkle[..., None])
        col = col * (1 - 0.5 * pale[..., None]) + tg.hex_to_linear("#b4b2a2") * 0.5 * pale[..., None]
        col = col * (1 - 0.55 * dark[..., None]) + tg.hex_to_linear("#4a4a3c") * 0.25 * dark[..., None]
        rough = 0.72 + 0.1 * pale - 0.05 * folds
    elif family == "furrowed":
        # long vertical ridges separated by deep interlacing furrows (ridged noise stretched 1:6), short cross checks
        # on the ridges, weathered grey ridge tops, dark red-brown furrows
        wx, wy = tg.warp(x, y, 0.03, 3, 3, rng)
        r1 = tg.fbm(wx, wy, (9, 2), 4, rng, ridged=True)
        r2 = tg.fbm(wx + 0.17, wy, (14, 3), 3, rng, ridged=True)
        ridge = np.clip(0.65 * r1 + 0.45 * r2, 0, 1)
        furrow = 1.0 - tg.smoothstep(0.18, 0.55, ridge)
        cx_ = np.abs(tg.fbm(x, y, (5, 26), 3, rng))
        check = np.clip(1 - cx_ / 0.07, 0, 1) * tg.smoothstep(0.45, 0.75, ridge)
        micro = tg.fbm(x, y, 40, 3, rng)
        h = 0.016 * tg.smoothstep(0.1, 0.8, ridge) - 0.003 * check + 0.0008 * micro
        top = tg.smoothstep(0.6, 0.95, ridge)
        col = base[None, None, :] * (0.7 + 0.45 * ridge[..., None]) * (1 + 0.15 * micro[..., None])
        col = col * (1 - 0.35 * check[..., None])
        grey = np.mean(col, axis=-1, keepdims=True)
        col = col * (1 - 0.4 * top[..., None]) + grey * 1.3 * 0.4 * top[..., None]
        furrow_col = tg.hex_to_linear("#2e1f15")
        col = col * (1 - 0.8 * furrow[..., None]) + furrow_col * 0.8 * furrow[..., None]
        rough = 0.86 + 0.07 * furrow - 0.05 * top
    elif family == "fibrous":
        # long vertical fibre strips, shallow, peeling edges
        st = tg.fbm(x, y, (22, 2), 4, rng, ridged=True)
        bands = tg.fbm(x, y, (6, 1), 3, rng)
        peel = tg.smoothstep(0.6, 0.85, tg.fbm(x, y, (9, 3), 4, rng) * 0.5 + 0.5)
        h = 0.003 * st + 0.002 * bands + 0.0015 * peel
        col = base[None, None, :] * (0.82 + 0.25 * st[..., None] + 0.08 * bands[..., None])
        col = col * (1 + 0.12 * peel[..., None])
        rough = 0.83 + 0.05 * (1 - st)
    elif family == "palm":
        # rings (leaf-base scars) every 9-16 cm with jitter, fibrous rough skin between, vertical cracks
        n_rings = max(6, int(round(tile_m / 0.12)))
        ph = (y * n_rings + 0.15 * tg.fbm(x, y, (3, 2), 2, rng)) % 1.0
        ring = np.exp(-((ph - 0.5) / 0.07) ** 2)
        ring2 = np.exp(-((ph - 0.62) / 0.03) ** 2) * 0.5
        fib = tg.fbm(x, y, (30, 6), 3, rng)
        crack = np.clip(1 - np.abs(tg.fbm(x, y, (9, 1), 3, rng)) / 0.05, 0, 1)
        h = 0.006 * ring + 0.002 * ring2 + 0.0009 * fib - 0.002 * crack
        col = base[None, None, :] * (0.85 + 0.2 * fib[..., None]) * (1 - 0.3 * ring[..., None]) * (1 - 0.3 * crack[..., None])
        col = col * (1 + 0.15 * ring2[..., None])
        rough = 0.88 + 0.05 * ring
    else:
        raise ValueError(family)
    h = h.astype(F)
    n = tg.normal_from_height(h, texel, 1.0)
    ao = tg.horizon_ao(h, texel, radius_m=min(0.03, tile_m * 0.03), directions=8, steps=8)
    ao = 0.55 + 0.45 * ao
    col = np.clip(col, 0.004, 1.0).astype(F)
    # calibrate the mean to the family base colour (ASSET_LIST §0.4: +-6 %)
    mean = col.reshape(-1, 3).mean(axis=0)
    col = np.clip(col * (base / np.maximum(mean, 1e-5))[None, None, :], 0, 1).astype(F)
    orm = np.stack([ao, np.clip(rough, 0, 1), np.zeros_like(ao)], axis=-1).astype(F)
    return {"albedo": col, "normal": tg.encode_normal(n), "orm": orm, "height": h}


__all__ = ["bark_maps"]
