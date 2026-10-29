"""
@asset fx_rain
@kind flipbook

Monsoon rain atlas (8 x 8 frames of 64 px = 512, ASSET_LIST WP7-12, ART_BIBLE §10 rain): `streak` (soft 1.5-3 cm
x 30-60 cm drop streak with a brighter head, stretched by speed and angled by wind at runtime), `splash`
(16 frames: a coronet - flaring crown walls, 8 rim cusps throwing fingers and droplets, collapsing to a ring), `ripple`
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
WIN = fb.frame_window(PX, 0.03, 0.06)


def rgba(a: np.ndarray, tint: np.ndarray = WATER) -> np.ndarray:
    a = (np.clip(a, 0, 1) * WIN).astype(np.float32)  # every sprite fades to 0 before its frame border
    return np.concatenate([np.broadcast_to(tint, a.shape + (3,)), a[..., None]], axis=-1).astype(np.float32)


def seq(name: str, imgs: list, fps: float, loop: bool = False, nrm: list | None = None) -> None:
    seqs.append({"name": name, "start": len(color), "count": len(imgs), "fps": fps, "loop": loop})
    color.extend(imgs)
    normals.extend(nrm if nrm is not None else [FLAT] * len(imgs))


# streak: thin, soft, brighter towards the leading (bottom) end
w = 0.035
s = np.exp(-(x / w) ** 2) * np.clip(1.0 - np.abs(y) / 0.95, 0, 1) ** 0.6 * (0.45 + 0.55 * np.clip((0.9 - y) / 1.8, 0, 1))
seq("streak", [rgba(s * 0.85)], 1)

# splash: a crown (coronet) seen from the side, slightly from above - a thin sheet whose walls FLARE OUTWARD from the
# impact (wider at the top, never a "[ ]" bucket), a rim of 8 cusps each throwing a finger and a droplet, collapsing
# into a ring while the droplets fall back (ground at y = -0.72).
GROUND = -0.72
cusps = [(2 * np.pi * (k + rng.uniform(-0.2, 0.2)) / 8, rng.uniform(0.8, 1.2)) for k in range(8)]
extra = [(rng.uniform(-1.0, 1.0), rng.uniform(1.2, 2.0), rng.uniform(0.022, 0.04)) for _ in range(10)]
imgs = []
for f in range(16):
    t = (f + 1) / 16.0  # frame 0 already shows the crown rising (no empty first frame)
    grow = np.sin(np.pi * min(1.0, t * 1.5)) * (1.0 - 0.5 * t)
    h = 0.55 * grow                       # crown height
    w0 = 0.12 + 0.35 * t                  # radius at the ground
    w1 = w0 + 0.22 * grow + 0.15 * t      # radius at the rim: flares outward
    a = np.zeros_like(x)
    if h > 0.02:
        # walls: the cylinder's silhouette edges, slanted outward
        for side in (-1.0, 1.0):
            a += kit.streak(x, y, (side * w0, GROUND), (side * w1, GROUND + h), 0.022, 1.0) * 0.85
        # faint sheet between the walls (thinning upward)
        yy = np.clip((y - GROUND) / max(h, 1e-3), 0, 1)
        wy = w0 + (w1 - w0) * yy
        a += (np.abs(x) < wy) * (y > GROUND) * (y < GROUND + h) * (0.18 * (1.0 - yy))
        # rim ellipse (seen slightly from above) with cusps, each throwing a finger + droplet
        for ang, lk in cusps:
            cx = w1 * np.cos(ang)
            cy = GROUND + h + 0.06 * np.sin(ang) * w1
            fl = 0.16 * grow * lk
            tipx = cx * (1.0 + 0.35 * t)
            tipy = cy + fl
            a += kit.streak(x, y, (cx, cy), (tipx, tipy), 0.014, 1.0) * 0.9 * (0.6 + 0.4 * np.sin(ang) ** 2)
            dr = 0.028 * lk
            a += np.exp(-(((x - tipx) / dr) ** 2 + ((y - tipy - dr) / (dr * 1.3)) ** 2)) * 0.95
    # detached droplets flying out and falling back
    for vx, vy, rr in extra:
        px_ = vx * 0.75 * t
        py_ = GROUND + 0.2 + vy * t * 0.7 - 2.2 * t * t
        if py_ < GROUND - 0.02 or t < 0.15:
            continue
        a += np.exp(-(((x - px_) / rr) ** 2 + ((y - py_) / (rr * 1.4)) ** 2)) * (1 - t * 0.5)
    # base ring on the ground as the crown collapses
    a += np.exp(-((y - GROUND) / 0.025) ** 2) * np.exp(-((np.abs(x) - (w0 + 0.1 * t)) / 0.06) ** 2) * t * 0.6
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
