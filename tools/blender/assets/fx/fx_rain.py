"""
@asset fx_rain
@kind flipbook

Monsoon rain atlas (8 x 8 frames of 64 px = 512, ASSET_LIST WP7-12, ART_BIBLE §10 rain): `streak` (soft 1.5-3 cm
x 30-60 cm drop streak with a brighter head, stretched by speed and angled by wind at runtime), `splash`
(4 x 4 = 16 frames: crown splash - a ring of droplets thrown up and out, falling back, side view), `ripple`
(8 frames: expanding concentric rings - the NORMAL map carries the ripple normals for puddles / water, the
color frames a faint highlight), `drip` (eave drip: a hanging drop with a thin tail, hero mode).
Straight alpha, unlit (droplets pick up the sky via the runtime tint). OWNER: Technical Artist G (TA-07).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

import _fxkit as kit  # noqa: E402
from lib import flipbook as fb  # noqa: E402

ctx = fb.begin(__file__)
PX = 128
x, y = kit.coords(PX)
rng = np.random.default_rng(3)
WATER = kit.srgb("#e6eef2")
color: list = []
normals: list = []
seqs: list = []
FLAT = np.concatenate([np.full((PX, PX, 2), 0.5, np.float32), np.ones((PX, PX, 1), np.float32)], axis=-1)


def rgba(a: np.ndarray, tint: np.ndarray = WATER) -> np.ndarray:
    a = np.clip(a, 0, 1).astype(np.float32)
    return np.concatenate([np.broadcast_to(tint, a.shape + (3,)), a[..., None]], axis=-1).astype(np.float32)


def seq(name: str, imgs: list, fps: float, loop: bool = False, nrm: list | None = None) -> None:
    seqs.append({"name": name, "start": len(color), "count": len(imgs), "fps": fps, "loop": loop})
    color.extend(imgs)
    normals.extend(nrm if nrm is not None else [FLAT] * len(imgs))


# streak: thin, soft, brighter towards the leading (bottom) end
w = 0.035
s = np.exp(-(x / w) ** 2) * np.clip(1.0 - np.abs(y) / 0.95, 0, 1) ** 0.6 * (0.45 + 0.55 * np.clip((0.9 - y) / 1.8, 0, 1))
seq("streak", [rgba(s * 0.85)], 1)

# splash: crown of droplets (side view, ground at y = -0.75)
drops = [(rng.uniform(-1.0, 1.0), rng.uniform(1.4, 2.4), rng.uniform(0.03, 0.055)) for _ in range(20)]
imgs = []
for f in range(16):
    t = f / 15.0
    a = np.zeros_like(x)
    crown_h = 0.5 * np.sin(np.pi * min(1.0, t * 1.6)) * (1 - t)
    cw = 0.14 + 0.6 * t
    crown = np.exp(-((np.abs(x) - cw) / 0.05) ** 2) * ((y > -0.75) & (y < -0.75 + crown_h + 0.02)) * (1 - t) ** 0.8
    a += crown * 0.9
    sheet = np.exp(-((y + 0.75) / 0.03) ** 2) * np.clip(1 - np.abs(x) / (cw + 0.05), 0, 1) * (1 - t) * 0.7
    a += sheet
    for vx, vy, r in drops:
        px_ = vx * 0.8 * t
        py_ = -0.75 + vy * t - 2.5 * t * t
        if py_ < -0.78:
            continue
        a += np.exp(-(((x - px_) / r) ** 2 + ((y - py_) / (r * 1.4)) ** 2)) * (1 - t * 0.6)
    imgs.append(rgba(a))
seq("splash", imgs, 30)

# ripple: concentric expanding rings; normals from the ring height field
imgs, nrms = [], []
r = np.hypot(x, y)
for f in range(8):
    t = (f + 0.5) / 8.0
    h = np.zeros_like(x)
    for k, delay in enumerate((0.0, 0.18, 0.36)):
        tt = max(0.0, t - delay)
        if tt <= 0:
            continue
        rad = 0.1 + 0.85 * tt
        h += np.sin((r - rad) * 26.0) * np.exp(-((r - rad) / 0.09) ** 2) * (1 - tt) ** 1.5 * (0.8 ** k)
    gy, gx = np.gradient(h)
    n = np.stack([-gx * 9.0, gy * 9.0, np.ones_like(h)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    fade = np.clip(1.0 - r, 0, 1) ** 0.5
    n = n * fade[..., None] + np.array([0, 0, 1.0]) * (1 - fade[..., None])
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    nrms.append((n * 0.5 + 0.5).astype(np.float32))
    imgs.append(rgba(np.clip(np.abs(h) * 1.6, 0, 0.6) * fade))
seq("ripple", imgs, 16, loop=False, nrm=nrms)

# drip: hanging drop with a thin tail
d = np.exp(-((x / 0.11) ** 2 + ((y + 0.35) / 0.15) ** 2)) + np.exp(-(x / 0.025) ** 2) * np.clip((y + 0.3) / 1.2, 0, 1) * (y < 0.85) * 0.6
seq("drip", [rgba(np.clip(d, 0, 1) * 0.9)], 1)

meta = fb.write(ctx, color, 8, 8, fps=30, loop=False, sequences=seqs, normals=normals, blend="alpha", lit=False,
                soft_fade_m=0.05, size_m=(0.04, 0.5), atlas_px={"ultra": 512, "high": 512, "mobile": 512},
                labels=kit.label_sequences(seqs),
                description="Rain: streak, 4x4 crown splash, 8-frame ripple (normal map), eave drip.")
meta["tint"] = "#c9d6dc"
ctx.meta.update(meta)
ctx.finish()
