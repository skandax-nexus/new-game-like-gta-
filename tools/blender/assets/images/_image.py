"""
Package-local helper (images): `@kind image` context + writer for single 2D textures (sun sprite, lens dirt, ...).
The runner publishes `image` (role) as WebP per tier (`tierPx` caps the width); the manifest carries colorSpace,
alpha, hdrScale (runtime multiplier for HDR use) and a usage note. OWNER: Technical Artist G (TA-07).
"""
from __future__ import annotations

from typing import Any

import numpy as np

from lib import core, texgen as tg
from lib.core import AssetContext, log

F = np.float32


def begin(script_file: str) -> AssetContext:
    # lib/core.py KINDS predates `image` (CTO request filed): start as a model context, then retag.
    ctx = core.begin(script_file, kind="model")
    ctx.kind = "image"
    return ctx


def coords(px: int) -> tuple[np.ndarray, np.ndarray]:
    """Pixel-center coordinates in [-1, 1] (x right, y up)."""
    v = (np.arange(px, dtype=F) + 0.5) / px * 2 - 1
    x, y = np.meshgrid(v, -v)
    return x, y


def write(ctx: AssetContext, img: np.ndarray, *, alpha: bool, color_space: str = "srgb", hdr_scale: float = 1.0,
          usage: str = "", tier_px: dict[str, int] | None = None, description: str = "", linear_input: bool = True) -> None:
    """Write `img` (linear rgb[a] in [0, 1] when linear_input) as a 16-bit PNG source and fill the metadata."""
    a = np.clip(np.asarray(img, F), 0, 1)
    if not alpha and a.shape[-1] == 4:
        a = a[..., :3]
    enc = a.copy()
    if linear_input and color_space == "srgb":
        enc[..., :3] = tg.linear_to_srgb(enc[..., :3])
    p = tg.write_png(ctx.path("image.png"), enc, 16)
    ctx.add_file("image", p)
    if ctx.preview:
        ctx.add_file("preview", tg.write_png(ctx.path("preview.png"), enc, 8))
    meta: dict[str, Any] = {"alpha": alpha, "colorSpace": color_space, "hdrScale": hdr_scale, "usage": usage,
                            "description": description}
    if tier_px:
        meta["tierPx"] = tier_px
    ctx.meta.update(meta)
    log(f"image: {a.shape[1]}x{a.shape[0]} alpha={alpha} {color_space} hdrScale={hdr_scale}")
