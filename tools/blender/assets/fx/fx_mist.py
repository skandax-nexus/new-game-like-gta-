"""
@asset fx_mist
@kind flipbook

Four ground-mist / river-mist sprites (2 x 2 atlas of 256 px = 512, ASSET_LIST WP7-13, ART_BIBLE §10 morning mist
over rivers, monsoon valley fog): each is an irregular cluster of horizontally stretched soft blobs, domain-warped
and eroded at its edges by a finer noise (no ellipse, no circular iso-lines - mist lies flat, ~2.6:1 to 4:1 on its
8 x 6 m quad), falling to exactly zero before the frame border, so dozens of large quads overlap without visible
borders. `bank` (wide, low, flatter top), `wisp` (thin streamers for river surfaces), `puff` (a smaller pocket for
cold breath / valley pockets, still wider than tall) and `sheet` (a broad thin veil for distance layering). Alpha blended and lit: a soft normal map from the density
lets the sun rim the tops; the runtime tints with the fog color of the active lighting preset.
OWNER: Technical Artist G (TA-07).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

import _fxkit as kit  # noqa: E402
from lib import flipbook as fb  # noqa: E402

ctx = fb.begin(__file__)
PX = 256
x, y = kit.coords(PX)
WHITE = np.ones(3, np.float32)
color: list = []
normals: list = []
seqs: list = []


def noise(sx: float, sy: float, seed: int, octaves: int = 6, freq: float = 1.6) -> np.ndarray:
    """fbm normalized to [0, 1] by its 2nd / 98th percentiles."""
    n = kit.fbm2(x * sx, y * sy, seed, octaves, freq)
    lo, hi = np.percentile(n, [2, 98])
    return np.clip((n - lo) / max(hi - lo, 1e-6), 0, 1)


WIN = fb.frame_window(PX, 0.03, 0.12)


def cloudlet(seed: int, n_blobs: int, spread: tuple[float, float], size: tuple[float, float], erode: float,
             flat_top: float = 0.0) -> np.ndarray:
    """Irregular, horizontally stretched mist body: a cluster of elongated soft blobs (never one ellipse), domain-warped
    by fbm and eroded at its edges by a finer noise, so no circular iso-line survives; exactly 0 at the border."""
    rng = np.random.default_rng(seed)
    wx = (noise(1.1, 2.2, seed + 1, 4, 1.3) - 0.5) * 0.35
    wy = (noise(1.1, 2.2, seed + 2, 4, 1.3) - 0.5) * 0.18
    xx, yy = x + wx, y + wy
    field = np.zeros_like(x)
    for _ in range(n_blobs):
        cx, cy = rng.uniform(-spread[0], spread[0]), rng.uniform(-spread[1], spread[1])
        sx_, sy_ = size[0] * rng.uniform(0.6, 1.3), size[1] * rng.uniform(0.6, 1.3)
        field += np.exp(-(((xx - cx) / sx_) ** 2 + ((yy - cy) / sy_) ** 2)) * rng.uniform(0.6, 1.0)
    if flat_top > 0:
        field *= kit.smoothstep(0.55, 0.55 - flat_top, yy)  # settles: a flatter top edge
    fine = noise(2.4, 4.8, seed + 3, 5, 1.6)
    # erosion only ever removes (no specks outside the body), mostly at the thin edges
    a = kit.smoothstep(0.08, 1.25, field - erode * 0.6 * fine * (1.0 - np.clip(field, 0, 1)) ** 0.5)
    return a * (0.75 + 0.25 * noise(0.8, 1.6, seed + 4, 4, 1.2)) * WIN


def add(name: str, a: np.ndarray, strength: float = 1.6) -> None:
    a = np.clip(a, 0, 1).astype(np.float32)
    seqs.append({"name": name, "start": len(color), "count": 1, "fps": 1, "loop": True})
    color.append(np.concatenate([np.broadcast_to(WHITE, a.shape + (3,)), a[..., None]], axis=-1).astype(np.float32))
    normals.append(fb.normal_from_alpha(a, strength=strength, blur_px=4.0, bulge=0.8))
    ys, xs = np.nonzero(a > 0.1)
    if len(xs):
        print(f"[mist] {name}: aspect {(xs.max() - xs.min() + 1) / (ys.max() - ys.min() + 1):.2f} (texture space)")


# bank: wide, low, lumpy, flatter top
add("bank", cloudlet(101, 9, (0.55, 0.12), (0.32, 0.16), 0.9, flat_top=0.25) * 0.9)
# wisp: thin horizontal streamers
add("wisp", cloudlet(202, 7, (0.6, 0.18), (0.38, 0.07), 1.2) * 0.8, 1.2)
# puff: a smaller pocket, still wider than tall
add("puff", cloudlet(303, 6, (0.35, 0.12), (0.26, 0.15), 1.0) * 0.9)
# sheet: a broad thin veil with ragged edges and low-frequency density variation
add("sheet", cloudlet(404, 12, (0.62, 0.2), (0.34, 0.14), 0.7) * 0.6, 0.6)

meta = fb.write(ctx, color, 2, 2, fps=1, loop=True, sequences=seqs, normals=normals, blend="alpha", lit=True,
                soft_fade_m=2.0, size_m=(8.0, 6.0), atlas_px={"ultra": 512, "high": 512, "mobile": 512},
                labels=kit.label_sequences(seqs),
                description="Mist sprites: bank, wisp, puff, sheet - irregular, wide, noise-eroded clusters; zero at the edges, lit via soft normals.")
meta["tint"] = "#dfe3e6"
ctx.meta.update(meta)
ctx.finish()
