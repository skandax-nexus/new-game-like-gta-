"""
@asset fx_nature
@kind flipbook

Ambient nature particles (8 x 8 atlas of 64 px = 512, ASSET_LIST WP7-14, ART_BIBLE §10 seasonal ambience):
`leaf_sal` and `leaf_peepal` (8-frame tumble each: the leaf turns about a tilted axis, the silhouette narrows to
its edge and flips its shaded side - grishma leaf fall), `palash` (8-frame tumble of a flame-of-the-forest petal,
vasanta), `kash` (kash-grass seed tuft, sharad river banks), `firefly` (2 frames, glow pulse) and `mote` (2 dust
motes for god-ray shafts). Leaves / petals / seeds are alpha blended and lit (normal map from the leaf shape and
a midrib crease); fireflies and motes override the blend per sequence to additive and unlit.
OWNER: Technical Artist G (TA-07).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

import _fxkit as kit  # noqa: E402
from lib import flipbook as fb  # noqa: E402

ctx = fb.begin(__file__)
PX = 128  # supersampled, published at 64 px frames
x, y = kit.coords(PX)
color: list = []
normals: list = []
seqs: list = []
FLAT = np.concatenate([np.full((PX, PX, 2), 0.5, np.float32), np.ones((PX, PX, 1), np.float32)], axis=-1)
WIN = fb.frame_window(PX, 0.03, 0.06)  # nothing may touch a frame border (flipbook border guard)


def seq(name: str, frames: list, nrm: list | None, fps: float, loop: bool = True, **extra: object) -> None:
    seqs.append({"name": name, "start": len(color), "count": len(frames), "fps": fps, "loop": loop, **extra})
    color.extend(frames)
    normals.extend(nrm if nrm is not None else [FLAT] * len(frames))


def _peepal_outline() -> np.ndarray:
    """Closed outline (u, v), petiole notch at the bottom, drip tip at the top: a classic heart curve (point up)
    whose upper third is drawn out into a long tapering tail."""
    s_ = np.linspace(0.0, 2 * np.pi, 181)[:-1]
    hu = 16 * np.sin(s_) ** 3
    hv = -(13 * np.cos(s_) - 5 * np.cos(2 * s_) - 2 * np.cos(3 * s_) - np.cos(4 * s_))
    u_, v_ = hu / 17.0 * 0.7, hv / 17.0 * 0.62 - 0.12  # blade: notch at v ~ -0.5, point at v ~ +0.5
    t = np.clip((v_ - 0.05) / 0.45, 0, 1)                # 0 below the shoulders, 1 at the point
    u_ = u_ * (1.0 - 0.86 * t ** 0.7)                   # concave taper
    v_ = v_ + 0.66 * t ** 2.0                            # draw the point out into a long drip tip
    return np.stack([u_ * 0.82, v_ * 0.8 - 0.08], axis=1).astype(np.float32)


_PEEPAL = _peepal_outline()


def leaf_shape(u: np.ndarray, v: np.ndarray, kind: str) -> np.ndarray:
    """Coverage of a leaf in its own frame (v along the midrib from the petiole at -v to the tip at +v)."""
    if kind == "peepal":
        # Ficus religiosa: a broad heart-shaped (cordate) blade - two rounded basal lobes meeting at the petiole in a
        # notch - tapering with concave sides into a long, narrow drip tip (~30 % of the length). ART_BIBLE §1.2.
        return np.maximum((fb.polygon_sdf(u, v, _PEEPAL) < 0).astype(np.float32),
                          ((np.abs(u) < 0.022) & (v > -0.86) & (v < -0.3)).astype(np.float32))
    # sal: broad ovate, blunt tip
    w = 0.48 * np.clip(1.0 - ((v - 0.0) / 0.85) ** 2, 0, 1) ** 0.6
    return (np.abs(u) < w).astype(np.float32)


def tumble(shape, kind: str, base: str, edge: str, frames: int = 8, seed: int = 0, colorize=None) -> tuple[list, list]:
    """Rotate the leaf about its midrib (squash u by cos) while it slowly spins in the image plane."""
    rng = np.random.default_rng(seed)
    spin0 = rng.uniform(0, np.pi)
    out_c, out_n = [], []
    for f in range(frames):
        ang = 2 * np.pi * f / frames
        c = np.cos(ang)
        rot = spin0 + 0.35 * np.sin(ang)
        cr, sr = np.cos(rot), np.sin(rot)
        u0 = (x * cr + y * sr) / 0.95
        v0 = (-x * sr + y * cr) / 0.95
        sq = max(abs(c), 0.12)
        u = u0 / sq
        cov = shape(u, v0, kind)
        cov = fb.blur2(cov, 0.8) * WIN
        # front (upper surface) darker and glossier green, back paler; edge-on frames get the edge color
        face = colorize(u, v0, c >= 0) if colorize else (kit.srgb(base) if c >= 0 else kit.srgb(edge))
        vein = np.exp(-(u * sq / 0.025) ** 2) * (np.abs(v0) < 0.8) * 0.25
        side_veins = np.exp(-((np.abs(u * sq) * 0.7 - (v0 - 0.0) * 0.25) % 0.16 - 0.08) ** 2 / 0.0006) * 0.08
        tint = (1.0 - vein - side_veins)[..., None] * face * (0.85 + 0.15 * abs(c))
        out_c.append(np.concatenate([tint, cov[..., None]], axis=-1).astype(np.float32))
        # normal: cylindrical crease across the midrib (u) + the tumble tilt
        nx = np.clip(u * sq, -1, 1) * 0.45 * np.sign(c if c != 0 else 1) * cr
        ny = np.clip(u * sq, -1, 1) * 0.45 * np.sign(c if c != 0 else 1) * sr
        n = np.stack([nx + 0.5 * np.sin(ang) * cr, ny + 0.5 * np.sin(ang) * sr, np.ones_like(nx)], axis=-1)
        n /= np.linalg.norm(n, axis=-1, keepdims=True)
        n = n * cov[..., None] + np.array([0, 0, 1.0]) * (1 - cov[..., None])
        out_n.append((n * 0.5 + 0.5).astype(np.float32))
    return out_c, out_n


c, n = tumble(leaf_shape, "sal", "#6b7a2f", "#a3a35a", seed=1)
seq("leaf_sal", c, n, 8)
c, n = tumble(leaf_shape, "peepal", "#57702c", "#9fae62", seed=2)
seq("leaf_peepal", c, n, 8)


# palash (Butea monosperma, flame of the forest): the keel petal is a curved, beak-like claw - broad and blunt at the
# base (with the dark velvety calyx), sweeping round into a pointed tip.
_ARC = [np.array([-0.05 + 0.52 * np.sin(a) ** 1.2 * 0.95, -0.72 + 1.45 * (1 - np.cos(a)) * 0.62]) for a in np.linspace(0.0, 1.45, 24)]


def petal(u: np.ndarray, v: np.ndarray, kind: str) -> np.ndarray:
    d = np.full(u.shape, 9.0, np.float32)
    tt = np.zeros(u.shape, np.float32)
    n = len(_ARC) - 1
    for i in range(n):
        di = fb.segment_distance(u, v, _ARC[i], _ARC[i + 1])
        closer = di < d
        d = np.where(closer, di, d)
        tt = np.where(closer, (i + 0.5) / n, tt)
    w = 0.25 * (1.0 - tt) ** 0.85 + 0.012
    return (d < w).astype(np.float32)


def palash_colour(u: np.ndarray, v: np.ndarray, front: bool) -> np.ndarray:
    """Flame gradient along the petal: deep red-orange at the base -> bright saffron-orange at the tip, with the dark
    velvety calyx at the base; the back is a little paler."""
    g = np.clip((v + 0.72) / 1.3, 0, 1)[..., None]
    col = kit.srgb("#c8361a") * (1 - g) + kit.srgb("#f7902e") * g
    calyx = np.clip((-0.56 - v) / 0.16, 0, 1)[..., None]
    col = col * (1 - calyx) + kit.srgb("#3a2a14") * calyx
    return col if front else col * 0.85 + kit.srgb("#f5b070") * 0.15


def palash_tumble() -> tuple[list, list]:
    return tumble(petal, "palash", "#e2571e", "#f5822a", seed=3, colorize=palash_colour)


c, n = palash_tumble()
seq("palash", c, n, 10)

# kash seed tuft: thin seed with radiating silky hairs
r = np.hypot(x, y)
ang = np.arctan2(y, x)
hairs = np.zeros_like(x)
rng = np.random.default_rng(9)
for a0 in rng.uniform(-np.pi, np.pi, 34):
    L = rng.uniform(0.45, 0.85)
    hairs += kit.streak(x, y, (0.0, -0.1), (np.cos(a0) * L * 0.8, np.sin(a0) * L * 0.6 + 0.25), 0.012, 1.0) * rng.uniform(0.4, 0.9)
seed = np.exp(-((x / 0.04) ** 2 + ((y + 0.25) / 0.14) ** 2))
cov = np.clip(hairs * 0.9 + seed, 0, 1)
kash = np.concatenate([np.broadcast_to(kit.srgb("#f1ece0"), cov.shape + (3,)) * (1 - 0.5 * seed[..., None]), cov[..., None]], axis=-1)
seq("kash", [kash.astype(np.float32)], [fb.normal_from_alpha(cov, 0.8, 1.0, 0.6)], 1)

# firefly: soft green-gold glow, two pulse frames (additive, unlit)
ff = []
for k, s in enumerate((1.0, 0.55)):
    i = kit.glow(x, y, 0, 0, 0.06 * (1 + 0.3 * k), 2.0) * s * 1.4
    ff.append(kit.emissive_frame(i, "#f5ffb0", "#9fd23a", 0.85))
seq("firefly", ff, None, 3, loop=True, blend="additive", lit=False)

# motes: tiny soft specks for light shafts (additive, unlit)
mt = []
for k in range(2):
    i = kit.glow(x, y, 0, 0, 0.09 + 0.05 * k, 2.4) * (0.9 - 0.3 * k)
    mt.append(kit.emissive_frame(i, "#fff6e0", "#e8d8b8", 0.95))
seq("mote", mt, None, 1, loop=True, blend="additive", lit=False)

meta = fb.write(ctx, color, 8, 8, fps=8, loop=True, sequences=seqs, normals=normals, blend="alpha", lit=True,
                soft_fade_m=0.05, size_m=(0.12, 0.12), atlas_px={"ultra": 512, "high": 512, "mobile": 512},
                labels=kit.label_sequences(seqs),
                description="Nature: sal / peepal leaves and palash petals (8-frame tumbles), kash seed, fireflies + motes (additive).")
meta["tint"] = "#ffffff"
ctx.meta.update(meta)
ctx.finish()
