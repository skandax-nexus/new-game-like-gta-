"""
@asset fx_weapon_trail
@kind flipbook

Hero weapon-arc trail textures (2 x 2 atlas of 128 px = 256, ASSET_LIST WP7-15, ART_BIBLE §10 melee VFX): mapped on
the ribbon mesh the hero controller builds from the blade's last N positions with u = age (0 = the blade edge
now, 1 = the oldest tail point) and v = across the ribbon (0 = blade root, 1 = blade tip).
  `trail`      white-hot leading edge -> saffron-gold -> transparent tail, brightest towards the tip
  `trail_wide` softer and wider, for heavy / finisher swings
  `noise`      tileable-in-u grayscale streak noise, scrolled along u and multiplied in to break the ribbon up
  `noise_b`    a second, finer noise to cross-scroll against `noise`
Additive (premultiplied emission x emissiveIntensity 3). Border guard: the trail gradients are bright at their LEFT
edge by design (u = 0 is the blade edge now) and the noises tile in u (and wrap in v), so those sequences open
exactly those edges (`open_edges`); every other edge fades to 0. Published near-lossless (28 KB): lossy WebP
ringing put 4-8/255 on the trails' closed top / right edges. OWNER: Technical Artist G (TA-07).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402

import _fxkit as kit  # noqa: E402
from lib import flipbook as fb  # noqa: E402

ctx = fb.begin(__file__)
PX = 256  # supersampled, published at 128 px frames
v_, u_ = np.mgrid[0:PX, 0:PX].astype(np.float32)
u = (u_ + 0.5) / PX  # age along the trail (left = newest)
v = 1.0 - (v_ + 0.5) / PX  # across the ribbon (bottom = root, top = tip)
frames: list = []
seqs: list = []


def seq(name: str, img: np.ndarray, **extra: object) -> None:
    seqs.append({"name": name, "start": len(frames), "count": 1, "fps": 1, "loop": True, **extra})
    frames.append(img.astype(np.float32))


def trail(width_pow: float, edge_w: float, tail_pow: float, gain: float) -> np.ndarray:
    fade_age = (1.0 - u) ** tail_pow
    edge = np.exp(-(u / edge_w) ** 2)  # the white-hot leading edge
    across = kit.smoothstep(0.03, 0.25, v) * kit.smoothstep(0.97, 0.82, v) * (0.35 + 0.65 * v ** width_pow)
    fade_age = fade_age * kit.smoothstep(0.98, 0.88, u)  # the oldest tail point reaches exactly 0
    i = (fade_age * 0.95 + edge * 0.8) * across * gain
    return kit.emissive_frame(i, "#fff2c0", "#e8892b", 0.8)


seq("trail", trail(1.6, 0.05, 1.5, 1.2), open_edges=["left"])
seq("trail_wide", trail(0.8, 0.1, 1.1, 0.85), open_edges=["left"])


def streak_noise(seed: int, rows: int, stretch: float) -> np.ndarray:
    """Noise tileable along u: rows of 1D periodic signals, smoothly varying across v."""
    rng = np.random.default_rng(seed)
    acc = np.zeros_like(u)
    for k in range(rows):
        cy = rng.uniform(0, 1)
        w = rng.uniform(0.008, 0.035)
        freq = rng.integers(1, 5)
        ph = rng.uniform(0, 2 * np.pi)
        band = np.exp(-(((v - cy + 0.5) % 1.0 - 0.5) / w) ** 2)
        acc += band * (0.5 + 0.5 * np.sin(2 * np.pi * freq * u + ph)) ** stretch * rng.uniform(0.5, 1.0)
    acc = acc / max(float(acc.max()), 1e-6)
    return np.clip(acc * 1.3, 0, 1)


for name, seed, rows, stretch in (("noise", 5, 44, 1.0), ("noise_b", 6, 80, 2.0)):
    n = streak_noise(seed, rows, stretch)
    # grayscale multiplier stored as white-on-black emission with alpha = value (sampled as data, not drawn alone)
    seq(name, np.concatenate([np.repeat(n[..., None], 3, axis=-1), n[..., None]], axis=-1), blend="additive", lit=False,
        open_edges=["all"])

meta = fb.write(ctx, frames, 2, 2, fps=1, loop=True, sequences=seqs, blend="additive", lit=False, emissive_intensity=3.0,
                soft_fade_m=0.0, size_m=(1.2, 1.0), atlas_px={"ultra": 256, "high": 256, "mobile": 256},
                labels=kit.label_sequences(seqs), srgb=True,
                description="Weapon trail: gradient (edge -> saffron -> tail), wide variant, two u-tileable streak noises.")
meta["tint"] = "#ffffff"
meta["encoding"] = "near_lossless"
ctx.meta.update(meta)
ctx.finish()
