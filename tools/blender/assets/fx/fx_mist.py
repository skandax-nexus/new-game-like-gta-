"""
@asset fx_mist
@kind flipbook

Four ground-mist / river-mist sprites (2 x 2 atlas of 256 px = 512, ASSET_LIST WP7-13, ART_BIBLE §10 morning mist
over rivers, monsoon valley fog): soft fbm wisps inside a feathered ellipse whose edges fall to exactly zero, so
dozens of large camera-facing or ground-aligned quads overlap without visible borders. `bank` (wide, low, flat
top), `wisp` (stretched streamers for river surfaces), `puff` (round, for cold breath / valley pockets) and
`sheet` (thin, near-uniform, for distance layering). Alpha blended and lit: a soft normal map from the density
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


def feather(rx: float, ry: float, cy: float = 0.0, power: float = 1.6, core: float = 0.3) -> np.ndarray:
    """Ellipse with a flat core (d < core) feathering to exactly 0 at d = 1."""
    d = np.sqrt((x / rx) ** 2 + ((y - cy) / ry) ** 2)
    return kit.smoothstep(1.0, core, d) ** power


def noise(sx: float, sy: float, seed: int, octaves: int = 6, freq: float = 1.6) -> np.ndarray:
    """fbm normalized to [0, 1] by its 2nd / 98th percentiles."""
    n = kit.fbm2(x * sx, y * sy, seed, octaves, freq)
    lo, hi = np.percentile(n, [2, 98])
    return np.clip((n - lo) / max(hi - lo, 1e-6), 0, 1)


def add(name: str, a: np.ndarray, strength: float = 1.6) -> None:
    a = np.clip(a, 0, 1).astype(np.float32)
    # Edges must reach zero: hard guarantee on the outer 3 px ring.
    ring = np.ones_like(a)
    ring[:3, :] = ring[-3:, :] = 0
    ring[:, :3] = ring[:, -3:] = 0
    a = a * ring
    seqs.append({"name": name, "start": len(color), "count": 1, "fps": 1, "loop": True})
    color.append(np.concatenate([np.broadcast_to(WHITE, a.shape + (3,)), a[..., None]], axis=-1).astype(np.float32))
    normals.append(fb.normal_from_alpha(a, strength=strength, blur_px=4.0, bulge=0.8))


# bank: wide and low, flatter top edge, billowy break-up
n = noise(1.0, 1.7, 101, 4, 1.4)
a = feather(0.98, 0.7, -0.1, 1.3, 0.35) * (0.35 + 0.65 * kit.smoothstep(0.15, 0.85, n + 0.25 * (0.2 - y)))
add("bank", a * 0.9)

# wisp: horizontal streamers
n = noise(0.6, 3.6, 202, 6, 1.4)
a = feather(0.98, 0.6, 0.0, 1.2, 0.3) * (0.15 + 0.85 * kit.smoothstep(0.25, 0.9, n))
add("wisp", a * 0.85, 1.2)

# puff: round soft pocket
n = noise(1.3, 1.3, 303, 4, 1.4)
a = feather(0.95, 0.95, 0.0, 1.2, 0.2) * (0.3 + 0.7 * kit.smoothstep(0.1, 0.85, n))
add("puff", a * 0.9)

# sheet: thin, near-uniform veil with very low-frequency variation
n = noise(0.7, 1.0, 404, 4, 1.2)
a = feather(0.98, 0.85, 0.0, 1.0, 0.4) * (0.55 + 0.45 * n)
add("sheet", a * 0.6, 0.6)

meta = fb.write(ctx, color, 2, 2, fps=1, loop=True, sequences=seqs, normals=normals, blend="alpha", lit=True,
                soft_fade_m=2.0, size_m=(12.0, 5.0), atlas_px={"ultra": 512, "high": 512, "mobile": 512},
                labels=kit.label_sequences(seqs),
                description="Mist sprites: bank, wisp, puff, sheet; feathered to zero at the edges, lit via soft normals.")
meta["tint"] = "#dfe3e6"
ctx.meta.update(meta)
ctx.finish()
